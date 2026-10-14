// @ts-check
// titles.js — プレイヤーカードの二つ名 (前半 + 後半)。一覧 (ID 管理) と、選手ごとに持っている二つ名の計算 (docs/card_titles_design.md)。
//   TITLES[lang]             二つ名の一覧。言語ごとに別の一覧 (日本の地域は ja、北米は en)。表示の言語を切り替えても表記は変えない
//   titleById(lang, id)      一覧から 1 つ
//   ownedTitles(lang, uid, tournaments, profile)  その選手が持っている二つ名 (Map: id → { at: 'YYYY-MM-DD', how })。
//                            保存はしない: 選手のデータ (出た大会と日付・メインキャラ・都道府県) から毎回同じ結果になるように計算する (ページと Worker で同じ関数)
//
// 解放のしかた (unlock):
//   'initial' = 最初から全員が持っている
//   'char'    = メインキャラ (profile.chars) が chars のどれかなら持っている (「◯◯使い」「◯◯使いの」)
//   'pref'    = 都道府県 (profile.pref、geo.json の id) が pref なら持っている (「神奈川の」)
//   'random'  = 抽選で引く。まだ持っていないランダム解放の二つ名から 1 つずつ:
//               最初の配布 = 全員に前半 INITIAL_DRAWS.pre・後半 INITIAL_DRAWS.post (日付は公開日)
//               大会 = 公開日以降の大会だけ (公開前の大会はさかのぼらない)。本戦で 1 試合以上した大会 1 つにつき前半 PRE_PER_TOURNAMENT、
//                      本戦の試合 POST_PER_MATCHES.matches 試合ごとに後半 POST_PER_MATCHES.posts
//                      (試合数の端数は次の大会に持ち越す。DQ の試合は選手データの勝ち負けに入っていない)
//               後半は、技名 (kind 'move') か否かを MOVE_SHARE (技名 1/3) で決め (「選手 ID・抽選の名前・kind」のハッシュ)、
//               その中で「選手 ID・抽選の名前・二つ名 ID」のハッシュがいちばん小さいもの (同じ入力なら必ず同じ結果)。
//               技名 / 技名以外の片方を引き切ったら、もう片方から引く。前半・後半それぞれ、引き切ったらそれ以上は増えない。
//               候補は「その大会の日付 (最初の配布は公開日) までに追加されていて、まだ廃止されていない」ものだけ。
//               → あとで二つ名を足しても、過去に引いたものは変わらない (足した日より後の抽選から出る)
// 二つ名は消さない: やめるときは retired (廃止日) を付ける。持っている人は持ったまま、廃止日より後の抽選には出ない
//
// 一覧の 1 件: { id, part: 'pre' | 'post' | 'both', text, unlock, added: 'YYYY-MM-DD', retired?: 'YYYY-MM-DD', kind?: 'move', chars?: number[], pref?: string }
//   part = 使える位置 (前半だけ / 後半だけ / どちらでも)。kind 'move' = スマブラの技名 (抽選で後半の MOVE_SHARE だけ出す)。id は言語 + 連番 (ja-0001)。一度使った id は別の文言に使い回さない
//   chars = start.gg のキャラ ID (unlock 'char')。「ピーチ / デイジー」のような 1 つの ID は、ピーチ使いとデイジー使いの両方に入れる

/** @typedef {{ id: string, part: 'pre' | 'post' | 'both', text: string, unlock: 'initial' | 'random' | 'char' | 'pref', added: string, retired?: string, kind?: 'move', chars?: number[], pref?: string }} Title */
/** @typedef {{ at: string, how: 'initial' | 'char' | 'pref' | 'start' | 'random' }} OwnedTitle */
/** 抽選以外で解放するための選手の情報。chars = メインキャラの start.gg キャラ ID、pref = 都道府県 (geo.json の id、例 '神奈川県')
 * @typedef {{ chars?: (number | string)[] | null, pref?: string | null }} TitleProfile */

/** 二つ名を公開した日。これより前の大会では配らない (代わりに全員に INITIAL_DRAWS) */
export const TITLE_LAUNCH = '2026-10-01';
/** 最初の配布: 全員に前半・後半それぞれ何個 (2026-10-14 の案。数は仮) */
export const INITIAL_DRAWS = { pre: 40, post: 80 };
/** 前半: 本戦で 1 試合以上した大会 1 つにつき何個 */
export const PRE_PER_TOURNAMENT = 2;
/** 後半: 本戦の matches 試合ごとに posts 個 */
export const POST_PER_MATCHES = { posts: 1, matches: 1 };
/** ランダム解放で後半を引くとき、技名 (kind 'move') を引く割合 (num / den) */
export const MOVE_SHARE = { num: 1, den: 3 };

/** @type {Record<string, Title[]>} */
export const TITLES = {
  // Figma「submit」ver.1.5 のサンプル (あとで大量に足す)
  ja: [
    { id: 'ja-0001', part: 'pre', text: '1000年に1度の', unlock: 'initial', added: '2026-10-01' },
    { id: 'ja-0002', part: 'pre', text: 'SSQMの', unlock: 'random', added: '2026-10-01' },
    { id: 'ja-0003', part: 'both', text: 'プロ観戦勢', unlock: 'random', added: '2026-10-01' },
    { id: 'ja-0004', part: 'pre', text: '発生', unlock: 'random', added: '2026-10-01' },
    { id: 'ja-0005', part: 'post', text: 'トリックスター', unlock: 'initial', added: '2026-10-01' },
    { id: 'ja-0006', part: 'post', text: '支配者', unlock: 'random', added: '2026-10-01' },
    { id: 'ja-0007', part: 'post', text: '!みんな元気でね!', unlock: 'random', added: '2026-10-01' },
    { id: 'ja-0008', part: 'post', text: '1f', unlock: 'random', added: '2026-10-01' },
  ],
  // 北米 (英語の一覧は日本語の訳ではなく別に作る。今は仮)
  en: [
    { id: 'en-0001', part: 'pre', text: 'Once-in-a-Millennium', unlock: 'initial', added: '2026-10-01' },
    { id: 'en-0002', part: 'both', text: 'Frame-1', unlock: 'random', added: '2026-10-01' },
    { id: 'en-0003', part: 'post', text: 'Trickster', unlock: 'initial', added: '2026-10-01' },
    { id: 'en-0004', part: 'post', text: 'Overlord', unlock: 'random', added: '2026-10-01' },
  ],
};

/** その二つ名を前半 (pre) / 後半 (post) に使えるか @param {Title} t @param {'pre' | 'post'} slot */
export function usableIn(t, slot) {
  return t.part === 'both' || t.part === slot;
}

/** @param {string} lang @param {string | null | undefined} id @returns {Title | null} */
export function titleById(lang, id) {
  if (!id) return null;
  return (TITLES[lang] || []).find(t => t.id === id) || null;
}

/** FNV-1a (32 bit)。UTF-16 の単位で回す (ページでも Worker でも同じ値) @param {string} s */
export function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 数える大会 = 本戦で 1 試合以上したもの (下位クラスの仮想大会は本戦と同じ日の同じ大会なので数えない)。日付・ID の順
 * @param {{ date?: string, event_id?: number | string, parent_event_id?: number | string | null, wins?: number, losses?: number }[]} tournaments */
export function countedTournaments(tournaments) {
  return (tournaments || [])
    .filter(t => t && t.date && (t.parent_event_id == null || t.parent_event_id === '') && ((t.wins || 0) + (t.losses || 0)) >= 1)
    .slice()
    .sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : String(a.event_id).localeCompare(String(b.event_id))));
}

/** 1 回の抽選で引く 1 つ (ownedTitles の中身)。後半なら技名か否か → 枠の中でハッシュ最小
 * @param {Title[]} list @param {Map<string, OwnedTitle>} owned @param {number | string} uid
 * @param {'pre' | 'post'} side @param {string} key 抽選の名前 (前半 / 後半・最初の配布 / 大会・通し番号。選手の中で重ならない) @param {string} at
 * @returns {Title | null} */
function drawOne(list, owned, uid, side, key, at) {
  // ハッシュの上の位で割合を決める (FNV-1a の下の位は文字の偶奇に引きずられるので使わない)
  const wantMove = hash32(`${uid}|${key}|kind`) < 0x100000000 / MOVE_SHARE.den * MOVE_SHARE.num;
  /** @type {((t: Title) => boolean)[]} */
  const slots = side === 'post' ? [t => (t.kind === 'move') === wantMove, () => true] : [() => true];
  for (const inSlot of slots) {
    /** @type {Title | null} */
    let best = null;
    let bestH = Infinity;
    for (const t of list) {
      if (t.unlock !== 'random' || owned.has(t.id) || !usableIn(t, side) || t.added > at || (t.retired && t.retired <= at) || !inSlot(t)) continue;
      const h = hash32(`${uid}|${key}|${t.id}`);
      if (h < bestH) { bestH = h; best = t; }
    }
    if (best) return best;
  }
  return null;
}

/** その選手が持っている二つ名。uid = start.gg のユーザー ID
 * @param {string} lang @param {number | string} uid @param {{ date?: string, event_id?: number | string, parent_event_id?: number | string | null, wins?: number, losses?: number }[]} tournaments
 * @param {TitleProfile} [profile]
 * @returns {Map<string, OwnedTitle>} */
export function ownedTitles(lang, uid, tournaments, profile) {
  const list = TITLES[lang] || [];
  const chars = new Set(((profile && profile.chars) || []).map(String));
  const pref = (profile && profile.pref) || null;
  /** @type {Map<string, OwnedTitle>} */
  const owned = new Map();
  for (const t of list) {
    if (t.unlock === 'initial') owned.set(t.id, { at: TITLE_LAUNCH, how: 'initial' });
    else if (t.retired) continue;   // キャラ・都道府県のもの: 廃止後は新しく持たない (持っていた人は記録 title_owned に残る)
    else if (t.unlock === 'char' && (t.chars || []).some(c => chars.has(String(c)))) owned.set(t.id, { at: TITLE_LAUNCH, how: 'char' });
    else if (t.unlock === 'pref' && pref && t.pref === pref) owned.set(t.id, { at: TITLE_LAUNCH, how: 'pref' });
  }
  /** @param {'pre' | 'post'} side @param {string} key @param {string} at @param {OwnedTitle['how']} how */
  const draw = (side, key, at, how) => {
    const best = drawOne(list, owned, uid, side, key, at);
    if (best) owned.set(best.id, { at, how });
  };
  for (let i = 1; i <= INITIAL_DRAWS.pre; i++) draw('pre', `pre|start|${i}`, TITLE_LAUNCH, 'start');
  for (let i = 1; i <= INITIAL_DRAWS.post; i++) draw('post', `post|start|${i}`, TITLE_LAUNCH, 'start');
  let nPre = 0, nPost = 0, matches = 0;
  for (const t of countedTournaments(tournaments)) {
    const at = String(t.date).slice(0, 10);
    if (at < TITLE_LAUNCH) continue;
    for (let i = 0; i < PRE_PER_TOURNAMENT; i++) draw('pre', `pre|${++nPre}`, at, 'random');
    matches += (t.wins || 0) + (t.losses || 0);
    while (nPost < Math.floor(matches / POST_PER_MATCHES.matches) * POST_PER_MATCHES.posts) draw('post', `post|${++nPost}`, at, 'random');
  }
  return owned;
}

// ── 持っている二つ名の記録 (D1 title_owned.bits、docs/card_titles_design.md「持っている二つ名の記録」) ──
// ビット列 = 二つ名の通し番号 (id の 4 桁、ja-0001 → 1) を位置にしたもの。位置 n は (n >> 3) バイト目の (n & 7) ビット目 (下位から)。
// base64url (詰め物の = なし) の文字列で持つ。空 ("") = 何も持っていない。ページ・Worker・記録の処理で同じ関数を使う

/** id の通し番号 (ja-0123 → 123)。形が違えば null @param {string} id @returns {number | null} */
export function titleNumber(id) {
  const m = /^[a-z]{2}-(\d{4})$/.exec(String(id || ''));
  return m ? Number(m[1]) : null;
}

/** @param {string} bits @returns {Uint8Array} */
function bitsBytes(bits) {
  const b64 = String(bits || '').replace(/-/g, '+').replace(/_/g, '/');
  if (!b64) return new Uint8Array(0);
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 末尾の 0 のバイトは落とす (同じ中身なら同じ文字列) @param {Uint8Array} bytes @returns {string} */
function bytesBits(bytes) {
  let n = bytes.length;
  while (n > 0 && bytes[n - 1] === 0) n--;
  let bin = '';
  for (let i = 0; i < n; i++) bin += String.fromCharCode(bytes[i]);
  return n ? btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
}

/** id の並びからビット列 (形の違う id は無視) @param {Iterable<string>} ids @returns {string} */
export function bitsFromIds(ids) {
  /** @type {number[]} */
  const nums = [];
  for (const id of ids || []) { const n = titleNumber(id); if (n !== null) nums.push(n); }
  const bytes = new Uint8Array(nums.length ? (Math.max(...nums) >> 3) + 1 : 0);
  for (const n of nums) bytes[n >> 3] |= 1 << (n & 7);
  return bytesBits(bytes);
}

/** ビット列にその id があるか @param {string} bits @param {string} id */
export function bitsHas(bits, id) {
  const n = titleNumber(id);
  if (n === null) return false;
  const bytes = bitsBytes(bits);
  return (n >> 3) < bytes.length && (bytes[n >> 3] & (1 << (n & 7))) !== 0;
}

/** 2 つのビット列の OR @param {string} a @param {string} b @returns {string} */
export function bitsOr(a, b) {
  const x = bitsBytes(a), y = bitsBytes(b);
  const out = new Uint8Array(Math.max(x.length, y.length));
  for (let i = 0; i < out.length; i++) out[i] = (x[i] || 0) | (y[i] || 0);
  return bytesBits(out);
}

/** ビット列の通し番号 (昇順) @param {string} bits @returns {number[]} */
export function bitsNumbers(bits) {
  const bytes = bitsBytes(bits);
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < bytes.length; i++) for (let j = 0; j < 8; j++) if (bytes[i] & (1 << j)) out.push(i * 8 + j);
  return out;
}

/** ビット列の二つ名 (その言語の一覧にあるものだけ) @param {string} lang @param {string} bits @returns {Title[]} */
export function bitsTitles(lang, bits) {
  return (TITLES[lang] || []).filter(t => bitsHas(bits, t.id));
}

const API = { TITLES, TITLE_LAUNCH, INITIAL_DRAWS, PRE_PER_TOURNAMENT, POST_PER_MATCHES, MOVE_SHARE, titleById, usableIn, hash32, countedTournaments, ownedTitles,
  titleNumber, bitsFromIds, bitsHas, bitsOr, bitsNumbers, bitsTitles };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むため)
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspTitles = API;
export default API;
