// @ts-check
// titles.js — プレイヤーカードの二つ名 (前半 + 後半)。一覧 (ID 管理) と、抽選で配る計算 (docs/card_titles_design.md)。
//   TITLES[lang]             二つ名の一覧。言語ごとに別の一覧 (日本の地域は ja = js/titles_ja.js、北米は en)。表示の言語を切り替えても表記は変えない
//   titleById(lang, id)      一覧から 1 つ
//   drawTargets(tournaments) 出た大会から「ここまでに引く回数」(前半・後半)
//   advanceTitles(lang, uid, state, targets, profile, today)  記録 (state) に、まだ引いていない回の抽選を足した新しい記録
//
// 持っている二つ名の正本は記録 (D1 title_owned: ビット列 bits + 引いた回数 n_pre / n_post)。
// 毎日の同期 (tools/titles/sync_owned.mjs) が「出た大会から決まる回数」と「記録の回数」の差だけ新しく引いて記録に足す。
// 引いたものは記録に残り、あとで計算し直さない。なので、一覧の追加・廃止・ジャンルの変更、遅れて取れた大会、大会の取り消しがあっても
// 過去に引いた結果は変わらない (増えた回だけ、その時点の一覧から引く。取り消しで回数が減っても引いたものは消さず、回数が戻るまで引かない)。
//
// 解放のしかた (unlock):
//   'initial' = 最初から全員が持っている
//   'char'    = メインキャラ (profile.chars) が chars のどれかなら持っている (「◯◯使い」「◯◯使いの」)
//   'pref'    = 都道府県 (profile.pref、geo.json の id) が pref なら持っている (「神奈川の」)
//   'random'  = 抽選で引く。まだ持っていないランダム解放の二つ名から 1 つずつ:
//               最初の配布 = 記録を初めて作るときに、ジャンルごとに INITIAL_COUNTS の数ずつ (前半 50・後半 100)
//               大会 = 公開日以降の大会だけ (公開前の大会はさかのぼらない)。DRAW_RULES の数: 本戦で 1 試合以上した大会 1 つにつき前半 prePerTournament、
//                      試合 post.matches 試合ごとに後半 post.posts。試合数は本戦と下位クラス (B〜E クラスの仮想大会の行) の合計
//                      (試合数の端数は次の大会に持ち越す。DQ の試合は選手データの勝ち負けに入っていない)
//               大会での抽選の k 回目は、ジャンルを DRAW_WEIGHTS の比で決め (「選手 ID・位置・k」のハッシュ)、
//               その中で、選手ごとの引く順番 (「選手 ID・二つ名 ID」のハッシュの小さい順) でいちばん前の、まだ持っていないもの。
//               そのジャンルを引き切ったら、同じ位置のほかのジャンル (DRAW_WEIGHTS の並び) から引く。前半・後半それぞれ、引き切ったらそれ以上は増えない。
//               候補は「その日 (today) までに追加されていて (added)、まだ廃止されていない (retired)」もの
// 二つ名は消さない: やめるときは retired (廃止日) を付ける。持っている人は持ったまま、廃止日からは引かない
//
// 一覧の 1 件: { id, part: 'pre' | 'post' | 'both', text, unlock, added: 'YYYY-MM-DD', retired?: 'YYYY-MM-DD', genre?, kind?: 'move', chars?: number[], pref?: string }
//   part = 使える位置 (前半だけ / 後半だけ / どちらでも)。genre = 抽選のジャンル (generic 汎用 / smash スマブラ・大会 / source 元ネタ)。
//   kind 'move' = スマブラの技名 (ジャンル move、後半だけ)。id は言語 + 連番 (ja-0001)。一度使った id は別の文言に使い回さない
//   chars = start.gg のキャラ ID (unlock 'char')。「ピーチ / デイジー」のような 1 つの ID は、ピーチ使いとデイジー使いの両方に入れる
import { JA_ROWS } from './titles_ja.js';
import { titleNumber, titleIdOf, bitsFromNumbers, bitsNumbers } from './title_bits.js';

/** @typedef {{ id: string, part: 'pre' | 'post' | 'both', text: string, unlock: 'initial' | 'random' | 'char' | 'pref', added: string, retired?: string, genre?: 'generic' | 'smash' | 'source', kind?: 'move', chars?: number[], pref?: string }} Title */
/** 抽選以外で解放するための選手の情報。chars = メインキャラの start.gg キャラ ID、pref = 都道府県 (geo.json の id、例 '神奈川県')
 * @typedef {{ chars?: (number | string)[] | null, pref?: string | null }} TitleProfile */
/** 記録 (D1 title_owned の 1 行)。bits = 持っている二つ名、n_pre / n_post = 大会で引いた回数 (最初の配布は数えない)
 * @typedef {{ bits: string, n_pre: number, n_post: number }} TitleState */

/** 二つ名を公開した日。これより前の大会では配らない */
export const TITLE_LAUNCH = '2026-10-01';
/** 最初の配布: ジャンルごとの数 (前半 50・後半 100、2026-10-14 ユーザー決定)。
 * 汎用は前後の組み合わせが作りやすいので多め、技名は長いものが多いので後半の 4 分の 1 */
export const INITIAL_COUNTS = {
  pre: { generic: 25, smash: 15, source: 10 },
  post: { generic: 40, smash: 20, move: 25, source: 15 },
};
/** 大会での抽選のジャンルの比 (2026-10-14 ユーザー決定の 4 ジャンル案)。並び = そのジャンルを引き切ったときに代わりに引く順 */
export const DRAW_WEIGHTS = {
  pre: { generic: 3, smash: 2, source: 1 },
  post: { generic: 6, smash: 3, move: 3, source: 2 },
};
/** 大会で配る数。from 以降の大会にその行を使う。数を変えるときは行を足す (書き換えると過去の大会の回数が変わり、その分をまとめて引くことになる) */
export const DRAW_RULES = [
  { from: TITLE_LAUNCH, prePerTournament: 3, post: { posts: 3, matches: 2 } },
];
/** 今の配る数 (画面の説明用) */
export const PRE_PER_TOURNAMENT = DRAW_RULES[DRAW_RULES.length - 1].prePerTournament;
export const POST_PER_MATCHES = DRAW_RULES[DRAW_RULES.length - 1].post;

/** JA_ROWS の 1 行 → Title @param {any[]} r @returns {Title} */
function jaRow(r) {
  const [n, part, kind, text, ex] = r;
  /** @type {any} */
  const t = { id: `ja-${String(n).padStart(4, '0')}`, part, text, unlock: 'random', added: '2026-10-01' };
  if (kind === 'char' || kind === 'pref') t.unlock = kind;
  else if (kind === 'move') t.kind = 'move';
  else t.genre = kind;
  return /** @type {Title} */ (Object.assign(t, ex || {}));
}

/** @type {Record<string, Title[]>} */
export const TITLES = {
  ja: JA_ROWS.map(r => jaRow(r)),
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
  return byIdIndex(lang).get(id) || null;
}

/** id → Title の索引 (言語ごと)。一覧の配列が差し替わったら作り直す
 * @type {Map<string, { list: Title[], map: Map<string, Title> }>} */
const BY_ID = new Map();
/** @param {string} lang */
function byIdIndex(lang) {
  const list = TITLES[lang] || [];
  let c = BY_ID.get(lang);
  if (!c || c.list !== list) {
    c = { list, map: new Map(list.map(t => [t.id, t])) };
    BY_ID.set(lang, c);
  }
  return c.map;
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

/** @typedef {{ date?: string, event_id?: number | string, parent_event_id?: number | string | null, wins?: number, losses?: number }} TourRow */

/** 下位クラスの仮想大会 (本戦の中の B〜E クラス。parent_event_id = 本戦) か @param {TourRow} t */
const isClassRow = t => !(t.parent_event_id == null || t.parent_event_id === '');

/** 1 試合以上した行 (本戦・下位クラスとも)。日付・ID の順 @param {TourRow[]} tournaments @returns {TourRow[]} */
function playedRows(tournaments) {
  return (tournaments || [])
    .filter(t => t && t.date && ((t.wins || 0) + (t.losses || 0)) >= 1)
    .slice()
    .sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : String(a.event_id).localeCompare(String(b.event_id))));
}

/** 数える大会 = 本戦で 1 試合以上したもの (下位クラスの仮想大会は本戦と同じ日の同じ大会なので数えない)。日付・ID の順
 * @param {TourRow[]} tournaments */
export function countedTournaments(tournaments) {
  return playedRows(tournaments).filter(t => !isClassRow(t));
}

/** 抽選のジャンル (技名は move、ほかは genre。無ければ generic) @param {Title} t @returns {string} */
export function genreOf(t) {
  return t.kind === 'move' ? 'move' : (t.genre || 'generic');
}

/** 出た大会から「ここまでに大会で引く回数」。公開日より前の大会は数えない。
 * 前半は本戦の行だけ、後半の試合数は下位クラスの試合も足す (2026-10-14 ユーザー決定)。端数は DRAW_RULES の行ごとに持ち越す
 * @param {TourRow[]} tournaments @returns {{ pre: number, post: number }} */
export function drawTargets(tournaments) {
  let pre = 0;
  const matches = DRAW_RULES.map(() => 0);
  for (const t of playedRows(tournaments)) {
    const at = String(t.date).slice(0, 10);
    if (at < TITLE_LAUNCH) continue;
    let r = -1;
    for (let i = 0; i < DRAW_RULES.length; i++) if (DRAW_RULES[i].from <= at) r = i;
    if (r < 0) continue;
    if (!isClassRow(t)) pre += DRAW_RULES[r].prePerTournament;
    matches[r] += (t.wins || 0) + (t.losses || 0);
  }
  const post = DRAW_RULES.reduce((n, rule, i) => n + Math.floor(matches[i] / rule.post.matches) * rule.post.posts, 0);
  return { pre, post };
}

/** 選手ごとの引く順番。ランダム解放の二つ名を「選手 ID・二つ名 ID」のハッシュの小さい順に並べ、位置 (前半 / 後半) とジャンルごとの列に分ける。
 * 二つ名ごとのハッシュなので、一覧に足しても消しても、ほかの二つ名どうしの順番は変わらない
 * @param {Title[]} list @param {number | string} uid @returns {Record<'pre' | 'post', Record<string, { items: Title[], start: number }>>} */
function drawQueues(list, uid) {
  /** @type {{ t: Title, h: number }[]} */
  const xs = [];
  for (const t of list) if (t.unlock === 'random') xs.push({ t, h: hash32(`${uid}|${t.id}`) });
  xs.sort((a, b) => a.h - b.h || (a.t.id < b.t.id ? -1 : 1));
  /** @type {Record<'pre' | 'post', Record<string, { items: Title[], start: number }>>} */
  const qs = { pre: {}, post: {} };
  for (const { t } of xs) {
    for (const side of /** @type {const} */ (['pre', 'post'])) {
      if (!usableIn(t, side)) continue;
      const g = genreOf(t);
      (qs[side][g] = qs[side][g] || { items: [], start: 0 }).items.push(t);
    }
  }
  return qs;
}

/** 記録に、まだ引いていない回の抽選を足した新しい記録。state = 今の記録 (無ければ null: 最初の配布もする)。
 * targets = drawTargets の回数。回数が記録より少なければ (大会の取り消し) 何も引かず、記録の回数はそのまま。
 * キャラ・都道府県のものと最初から持っているものも足す。持っているものは消さない (ビット列は増えるだけ)。
 * today = 抽選の日 (YYYY-MM-DD。この日までに追加された・まだ廃止されていないものから引く)
 * @param {string} lang @param {number | string} uid @param {TitleState | null} state @param {{ pre: number, post: number }} targets
 * @param {TitleProfile | null | undefined} profile @param {string} today @returns {TitleState} */
export function advanceTitles(lang, uid, state, targets, profile, today) {
  const list = TITLES[lang] || [];
  const owned = new Set(bitsNumbers(state ? state.bits : ''));
  const chars = new Set(((profile && profile.chars) || []).map(String));
  const pref = (profile && profile.pref) || null;
  const live = (/** @type {Title} */ t) => t.added <= today && !(t.retired && t.retired <= today);
  /** @param {Title} t */
  const add = t => { const n = titleNumber(t.id); if (n !== null) owned.add(n); };
  /** @param {Title} t */
  const has = t => { const n = titleNumber(t.id); return n !== null && owned.has(n); };
  for (const t of list) {
    if (!live(t)) continue;
    if (t.unlock === 'initial') add(t);
    else if (t.unlock === 'char' && (t.chars || []).some(c => chars.has(String(c)))) add(t);
    else if (t.unlock === 'pref' && pref && t.pref === pref) add(t);
  }
  const nPre0 = state ? state.n_pre : 0, nPost0 = state ? state.n_post : 0;
  const nPre = Math.max(nPre0, targets.pre), nPost = Math.max(nPost0, targets.post);
  if (state && nPre === nPre0 && nPost === nPost0) return { bits: bitsFromNumbers(owned), n_pre: nPre, n_post: nPost };

  const qs = drawQueues(list, uid);   // 並べるのは引くときだけ (選手ごとに 1 回)
  /** そのジャンルの列から 1 つ。引き切っていたら同じ位置のほかのジャンルから
   * @param {'pre' | 'post'} side @param {string} genre @param {string[]} order */
  const drawGenre = (side, genre, order) => {
    for (const g of [genre, ...order.filter(x => x !== genre)]) {
      const q = qs[side][g];
      if (!q) continue;
      while (q.start < q.items.length && has(q.items[q.start])) q.start++;
      for (let i = q.start; i < q.items.length; i++) {
        const t = q.items[i];
        if (!has(t) && live(t)) { add(t); return; }
      }
    }
  };
  if (!state) {
    for (const side of /** @type {const} */ (['pre', 'post'])) {
      const order = Object.keys(INITIAL_COUNTS[side]);
      for (const [g, n] of Object.entries(INITIAL_COUNTS[side])) for (let i = 0; i < n; i++) drawGenre(side, g, order);
    }
  }
  /** 大会での k 回目: ジャンルを DRAW_WEIGHTS の比で決める (ハッシュの上の位。FNV-1a の下の位は文字の偶奇に引きずられるので使わない)
   * @param {'pre' | 'post'} side @param {number} k */
  const draw = (side, k) => {
    const w = Object.entries(DRAW_WEIGHTS[side]);
    const total = w.reduce((n, [, c]) => n + c, 0);
    let x = hash32(`${uid}|${side}|${k}|genre`) / 0x100000000 * total;
    let genre = w[w.length - 1][0];
    for (const [g, c] of w) { if (x < c) { genre = g; break; } x -= c; }
    drawGenre(side, genre, w.map(([g]) => g));
  };
  for (let k = nPre0 + 1; k <= nPre; k++) draw('pre', k);
  for (let k = nPost0 + 1; k <= nPost; k++) draw('post', k);
  return { bits: bitsFromNumbers(owned), n_pre: nPre, n_post: nPost };
}

/** 記録が空の状態から、出た大会の分をまとめて引いたときの持ち物 (ビット列)。記録の無い所 (API の無いプレビュー・テスト・配るペースの試算) 用
 * @param {string} lang @param {number | string} uid @param {TourRow[]} tournaments @param {TitleProfile | null} [profile] @param {string} [today] */
export function simulateTitles(lang, uid, tournaments, profile, today = '9999-12-31') {
  return advanceTitles(lang, uid, null, drawTargets(tournaments), profile, today).bits;
}

/** ビット列の二つ名 (その言語の一覧にあるものだけ。一覧に無い番号は飛ばす) @param {string} lang @param {string} bits @returns {Title[]} */
export function bitsTitles(lang, bits) {
  const idx = byIdIndex(lang);
  /** @type {Title[]} */
  const out = [];
  for (const n of bitsNumbers(bits)) {
    const t = idx.get(titleIdOf(lang, n));
    if (t) out.push(t);
  }
  return out;
}

/** その選手が持てる二つ名の数 (持っているもの + まだ引ける抽選のもの。ほかのキャラ・都道府県のものは入れない)
 * @param {string} lang @param {Set<string>} ownedIds @param {string} today */
export function obtainableCount(lang, ownedIds, today) {
  let n = 0;
  for (const t of TITLES[lang] || []) {
    if (ownedIds.has(t.id)) n++;
    else if (t.unlock === 'random' && t.added <= today && !(t.retired && t.retired <= today)) n++;
  }
  return n;
}

const API = { TITLES, TITLE_LAUNCH, INITIAL_COUNTS, DRAW_WEIGHTS, DRAW_RULES, PRE_PER_TOURNAMENT, POST_PER_MATCHES, genreOf, titleById, usableIn, hash32,
  countedTournaments, drawTargets, advanceTitles, simulateTitles, bitsTitles, obtainableCount };
// ほかの共通モジュールと同じく window にも置く
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspTitles = API;
export default API;
