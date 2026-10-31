// Web Push の送信 (src/api/webpush.ts)。push サービスは偽物 (送った中身を受け手の鍵で復号して確かめる)
import test from 'node:test';
import assert from 'node:assert';
import { b64uDecode, b64uEncode, encryptPayload, sendPush, validSub } from '../src/api/webpush.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

/** 受け手側の復号 (RFC 8291) */
async function decrypt(body, uaPriv, uaPublic, authSecret) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPriv, 256));
  const ikm = await hkdf(authSecret, ecdh, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  assert.strictEqual(plain[end], 2, '最後のレコードの区切り');
  return { text: dec.decode(plain.slice(0, end)), rs, idlen };
}

async function subscriber() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { priv: kp.privateKey, pub, auth, sub: { endpoint: 'https://push.example.net/wpush/abc?x=1', p256dh: b64uEncode(pub), auth: b64uEncode(auth) } };
}
async function vapidPair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { verify: kp.publicKey, jwk, vapid: { publicKey: b64uEncode(raw), privateKey: jwk.d, subject: 'mailto:ops@example.org' } };
}

test('sendPush: 本文は受け手の鍵で復号でき、VAPID の署名・ヘッダが正しい', async () => {
  const s = await subscriber();
  const v = await vapidPair();
  let req = null;
  const fetchFn = async (url, init) => { req = { url, init }; return new Response(null, { status: 201 }); };
  const payload = JSON.stringify({ title: '食い違い', body: 'あばだんご 2-1 Player 2', url: '/jp/report/?c=abc' });
  const now = 1_800_000_000;
  const r = await sendPush(fetchFn, s.sub, payload, v.vapid, { ttl: 600, urgency: 'high', topic: 'set_123' }, now);
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(req.url, s.sub.endpoint);
  const h = req.init.headers;
  assert.strictEqual(h['Content-Encoding'], 'aes128gcm');
  assert.strictEqual(h.TTL, '600');
  assert.strictEqual(h.Urgency, 'high');
  assert.strictEqual(h.Topic, 'set_123');
  const body = new Uint8Array(req.init.body);
  const d = await decrypt(body, s.priv, s.pub, s.auth);
  assert.strictEqual(d.text, payload);
  assert.strictEqual(d.rs, 4096);
  assert.strictEqual(d.idlen, 65);
  // VAPID
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h.Authorization);
  assert.ok(m, h.Authorization);
  assert.strictEqual(m[2], v.vapid.publicKey);
  const [hd, bd, sg] = m[1].split('.');
  assert.deepStrictEqual(JSON.parse(dec.decode(b64uDecode(hd))), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(dec.decode(b64uDecode(bd)));
  assert.deepStrictEqual(claims, { aud: 'https://push.example.net', exp: now + 12 * 3600, sub: 'mailto:ops@example.org' });
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.verify, b64uDecode(sg), enc.encode(hd + '.' + bd)), '署名');
  // JWK の JSON でも同じに送れる
  const r2 = await sendPush(fetchFn, s.sub, 'x', { ...v.vapid, privateKey: JSON.stringify(v.jwk) });
  assert.deepStrictEqual(r2, { ok: true });
  assert.strictEqual((await decrypt(new Uint8Array(req.init.body), s.priv, s.pub, s.auth)).text, 'x');
});

test('sendPush: 404 / 410 は購読が無くなった (gone)、ほかの失敗は gone にしない、本文が大きすぎれば送らない', async () => {
  const s = await subscriber();
  const v = await vapidPair();
  for (const [status, gone] of [[410, true], [404, true], [429, false], [500, false]]) {
    const r = await sendPush(async () => new Response('no', { status }), s.sub, 'hi', v.vapid);
    assert.deepStrictEqual(r, { ok: false, status, gone, note: 'http_' + status });
  }
  const thrown = await sendPush(async () => { throw new Error('net down'); }, s.sub, 'hi', v.vapid);
  assert.strictEqual(thrown.ok, false); assert.strictEqual(thrown.gone, false); assert.match(thrown.note, /^fetch:/);
  let called = false;
  const big = await sendPush(async () => { called = true; return new Response(null, { status: 201 }); }, s.sub, 'あ'.repeat(1200), v.vapid);
  assert.deepStrictEqual(big, { ok: false, status: 0, gone: false, note: 'too_large' });
  assert.strictEqual(called, false);
});

test('encryptPayload: RFC 8291 付録 A の例と同じ本文になる', async () => {
  const sub = {
    endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  };
  const body = await encryptPayload(sub, 'When I grow up, I want to be a watermelon', {
    salt: b64uDecode('DGv6ra1nlYgDCS1FRnbzlw'),
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  });
  assert.strictEqual(b64uEncode(body),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('validSub: ブラウザの toJSON() の形と平らな形を受け、形の違うものは落とす', async () => {
  const s = await subscriber();
  const json = { endpoint: s.sub.endpoint, expirationTime: null, keys: { p256dh: s.sub.p256dh, auth: s.sub.auth } };
  assert.deepStrictEqual(validSub(json), s.sub);
  assert.deepStrictEqual(validSub(s.sub), s.sub);
  const bad = [
    null, [], 'x', {},
    { ...json, endpoint: 'http://push.example.net/x' },
    { ...json, endpoint: 'https://user:pw@push.example.net/x' },
    { ...json, endpoint: 'not a url' },
    { ...json, endpoint: 'https://push.example.net/' + 'a'.repeat(1000) },
    { ...json, keys: { p256dh: s.sub.p256dh.slice(0, 40), auth: s.sub.auth } },
    { ...json, keys: { p256dh: s.sub.p256dh, auth: s.sub.auth + 'AA' } },
    { ...json, keys: { p256dh: s.sub.p256dh, auth: 'bad*chars!!' } },
    { ...json, keys: { p256dh: b64uEncode(new Uint8Array(65).fill(3)), auth: s.sub.auth } },
  ];
  for (const b of bad) assert.strictEqual(validSub(b), null, JSON.stringify(b).slice(0, 80));
});
