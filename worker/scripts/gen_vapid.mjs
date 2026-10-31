// Web Push (VAPID) の鍵を 1 組作って標準出力に出す (worker/src/api/webpush.ts の形)。ファイルには書かない。
// 使い方: node worker/scripts/gen_vapid.mjs
//   出た値を wrangler secret put VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (--env preview) に貼る。
//   公開鍵 = P-256 の非圧縮の点 (65 バイト) の base64url、秘密鍵 = d (32 バイト) の base64url
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const b64u = (b) => Buffer.from(b).toString('base64url');
console.log('VAPID_PUBLIC_KEY=' + b64u(raw));
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
