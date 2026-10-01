// @ts-check
// titles.js — プレイヤーカードの二つ名 (前半 + 後半)。一覧 (ID 管理) と、選手ごとに持っている二つ名の計算 (docs/card_titles_design.md)。
//   TITLES[lang]             二つ名の一覧。言語ごとに別の一覧 (日本の地域は ja、北米は en)。表示の言語を切り替えても表記は変えない
//   titleById(lang, id)      一覧から 1 つ
//   ownedTitles(lang, uid, tournaments)  その選手が持っている二つ名 (Map: id → { at: 'YYYY-MM-DD', how })。
//                            保存はしない: 選手のデータ (出た大会と日付) から毎回同じ結果になるように計算する (ページと Worker で同じ関数)
//
// 解放のしかた (unlock):
//   'initial' = 最初から全員が持っている
//   'random'  = 大会で 1 試合以上するごとに DRAWS_PER_TOURNAMENT (2) つ、まだ持っていないランダム解放の二つ名から引く。
//               k 回目の抽選 (通し番号) は「選手 ID・k・二つ名 ID」のハッシュがいちばん小さいもの (同じ入力なら必ず同じ結果)。
//               候補は「その大会の日付 (公開日より前なら公開日) までに追加されていて、まだ廃止されていない」ものだけ。
//               → あとで二つ名を足しても、過去に引いたものは変わらない (足した日より後の抽選から出る)
// 二つ名は消さない: やめるときは retired (廃止日) を付ける。持っている人は持ったまま、廃止日より後の抽選には出ない
//
// 一覧の 1 件: { id, part: 'pre' | 'post' | 'both', text, unlock: 'initial' | 'random', added: 'YYYY-MM-DD', retired?: 'YYYY-MM-DD' }
//   part = 使える位置 (前半だけ / 後半だけ / どちらでも)。id は言語 + 連番 (ja-0001)。一度使った id は別の文言に使い回さない

/** @typedef {{ id: string, part: 'pre' | 'post' | 'both', text: string, unlock: 'initial' | 'random', added: string, retired?: string }} Title */
/** @typedef {{ at: string, how: 'initial' | 'random' }} OwnedTitle */

/** 二つ名を公開した日。これより前の大会での抽選は、この日の一覧から引く */
export const TITLE_LAUNCH = '2026-10-01';
/** ランダム解放: 1 試合以上した大会 1 つにつき何個 */
export const DRAWS_PER_TOURNAMENT = 2;

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

/** その選手が持っている二つ名。uid = start.gg のユーザー ID
 * @param {string} lang @param {number | string} uid @param {{ date?: string, event_id?: number | string, parent_event_id?: number | string | null, wins?: number, losses?: number }[]} tournaments
 * @returns {Map<string, OwnedTitle>} */
export function ownedTitles(lang, uid, tournaments) {
  const list = TITLES[lang] || [];
  /** @type {Map<string, OwnedTitle>} */
  const owned = new Map();
  for (const t of list) if (t.unlock === 'initial') owned.set(t.id, { at: TITLE_LAUNCH, how: 'initial' });
  const tours = countedTournaments(tournaments);
  const draws = tours.length * DRAWS_PER_TOURNAMENT;
  for (let k = 1; k <= draws; k++) {
    const d = String(tours[Math.ceil(k / DRAWS_PER_TOURNAMENT) - 1].date).slice(0, 10);
    const at = d < TITLE_LAUNCH ? TITLE_LAUNCH : d;
    /** @type {Title | null} */
    let best = null;
    let bestH = Infinity;
    for (const t of list) {
      if (t.unlock !== 'random' || owned.has(t.id) || t.added > at || (t.retired && t.retired <= at)) continue;
      const h = hash32(`${uid}|${k}|${t.id}`);
      if (h < bestH) { bestH = h; best = t; }
    }
    if (best) owned.set(best.id, { at, how: 'random' });
  }
  return owned;
}

const API = { TITLES, TITLE_LAUNCH, DRAWS_PER_TOURNAMENT, titleById, usableIn, hash32, countedTournaments, ownedTitles };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むため)
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspTitles = API;
export default API;
