// @ts-check
// dupe_check.js — 重複参加チェック (dupes/index.html) の計算部分。画面と通信は src/pages/dupes.js (docs/dupe_check_design.md)。
//   ブラウザの中だけで動く。参加者と連携アカウントは start.gg、出場記録は SPSP の公開データ (players/<uid>.json)。
//   normName(s)                 名前の正規化 (NFKC・小文字・カタカナ→ひらがな・記号と空白を除く)
//   romaji(s)                   ひらがな (normName 済み) → ローマ字 (連携アカウントの名前と比べる用。簡易ヘボン式)
//   entrantFromNode(node)       start.gg の entrants のノード → Entrant
//   findCandidates(entrants)    候補の組 [{ a, b, kinds }] (a < b は entrants の添字)
//   summarize(player, tourPref) SPSP の選手レコード → History (部門ごとの勝敗・期間・地域・対戦相手)
//   compare(A, B, kinds, now)   組の判定 { verdict, reasons, shared, sameDay }
//   discordCreated(id)          Discord の ID (snowflake) → 作成日時 (ms)。読めなければ null
//   prefOf(text)                地名 (start.gg の location や都道府県名) → 都道府県名。分からなければ null

/** @typedef {{ type: string, name: string, id: string | null }} Link */
/** @typedef {{ key: string, userId: number | null, disc: string | null, tag: string, prefix: string, location: string, links: Link[] }} Entrant */
/** 部門の id は start.gg の event_id。下位クラスは event_id が無いので「c:親の event_id:クラス」
 * @typedef {{ id: string, date: string, name: string, event: string, nent: number | null, place: number | null, w: number, l: number, dq: boolean, played: boolean, pref: string | null }} HistEvent */
/** @typedef {{ events: Map<string, HistEvent>, count: number, first: string | null, last: string | null, prefs: Record<string, number>, mainPref: string | null, opps: Set<number>, chars: string[] }} History */
/** 組の種類: same_name 同じ名前 (かなと英字はローマ字で) / similar_name 名前が 1 文字違い / link_id 同じ Discord アカウント (ID) / link_name 連携アカウントの名前が同じ (種類は問わない)
 * @typedef {'same_name' | 'similar_name' | 'link_id' | 'link_name'} Kind */
/** 判定: same 同一人物 / likely 可能性が高い / unknown 判断できない / prob_diff たぶん別人 / diff 別人
 * @typedef {'same' | 'likely' | 'unknown' | 'prob_diff' | 'diff'} Verdict */
/** @typedef {{ code: string, params?: Record<string, string | number> }} Reason */
/** 1 人分の材料 (compare に渡す)。hist = SPSP の出場記録 (無ければ null)、sgg = SPSP に無い人の start.gg の参加大会数 (取れなければ null)
 * @typedef {{ e: Entrant, hist: History | null, pref: string | null, sgg: { total: number } | null }} Side */

/** @param {unknown} s */
export function normName(s) {
  const t = String(s == null ? '' : s).normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return t.replace(/[^\p{L}\p{N}]/gu, '');
}

const KANA = {
  'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo', 'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho', 'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
  'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo', 'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo', 'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
  'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo', 'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo', 'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
  'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo', 'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo', 'しぇ': 'she', 'ちぇ': 'che', 'じぇ': 'je',
  'ふぁ': 'fa', 'ふぃ': 'fi', 'ふぇ': 'fe', 'ふぉ': 'fo', 'てぃ': 'ti', 'でぃ': 'di', 'うぃ': 'wi', 'うぇ': 'we', 'ゔぁ': 'va',
  'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o', 'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
  'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so', 'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
  'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no', 'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
  'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo', 'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
  'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro', 'わ': 'wa', 'を': 'wo', 'ん': 'n',
  'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go', 'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
  'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do', 'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
  'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po', 'ゔ': 'vu',
  'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o', 'ゃ': 'ya', 'ゅ': 'yu', 'ょ': 'yo', 'ゎ': 'wa',
};

/** かなを含まなければ空文字 (ローマ字で比べる意味が無い) @param {string} s normName 済み */
export function romaji(s) {
  if (!/[ぁ-ゖ]/.test(s)) return '';
  let out = '';
  let sokuon = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === 'っ') { sokuon = true; continue; }
    if (c === 'ー') { const v = out.match(/[aiueo]$/); if (v) out += v[0]; continue; }
    /** @type {string | undefined} */
    let r = /** @type {any} */ (KANA)[s.slice(i, i + 2)];
    if (r) i++; else r = /** @type {any} */ (KANA)[c];
    if (r == null) return '';   // 漢字など: ローマ字にできない
    if (sokuon) { out += r[0] === 'c' ? 't' : r[0]; sokuon = false; }
    out += r;
  }
  return out;
}

/** a と b の編集距離が 1 以下か (同じなら true) @param {string} a @param {string} b */
function within1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return diff + (la - i) + (lb - j) <= 1;
}

/** @param {any} node start.gg の entrants のノード (participants[0] の user と authorizations) @returns {Entrant} */
export function entrantFromNode(node) {
  const p = (node && node.participants && node.participants[0]) || {};
  const u = p.user || null;
  const loc = (u && u.location) || {};
  /** @type {Link[]} */
  const links = ((u && u.authorizations) || []).filter((/** @type {any} */ a) => a && a.type && a.externalUsername)
    .map((/** @type {any} */ a) => ({ type: String(a.type), name: String(a.externalUsername), id: a.externalId != null ? String(a.externalId) : null }));
  return {
    key: String(node && node.id),
    userId: u && u.id != null ? Number(u.id) : null,
    disc: (u && u.discriminator) || null,
    tag: String(p.gamerTag || (node && node.name) || ''),
    prefix: String(p.prefix || ''),
    location: [loc.state, loc.city].filter(Boolean).join(' '),
    links,
  };
}

/** 名前の比較を始める最短の長さ (正規化後)。これより短い名前は「1 文字違い」を拾わない (同じ名前だけ) */
const SIMILAR_MIN = 3;
/** 連携アカウントの名前を比べる最短の長さ (正規化後。短い名前は偶然の一致が多い) */
const LINK_NAME_MIN = 4;
/** 連携アカウントの名前の正規化 (旧 Discord の #1234 と記号を除く) @param {string} name */
function linkName(name) { return normName(String(name).replace(/#\d{4}$/, '')); }

/** @param {Entrant[]} entrants @returns {{ a: number, b: number, kinds: Kind[] }[]} */
export function findCandidates(entrants) {
  /** @type {Map<string, Set<Kind>>} */
  const pairs = new Map();
  /** @param {number} i @param {number} j @param {Kind} k */
  const add = (i, j, k) => {
    if (i === j) return;
    const ea = entrants[i], eb = entrants[j];
    if (ea.userId != null && ea.userId === eb.userId) return;
    const key = i < j ? i + ',' + j : j + ',' + i;
    let s = pairs.get(key);
    if (!s) pairs.set(key, s = new Set());
    s.add(k);
  };
  const norms = entrants.map((e) => normName(e.tag));
  // 1. 同じ名前 / 1 文字違い (長さごとに分けて、同じ長さと 1 違いだけ比べる)
  /** @type {Map<number, number[]>} */
  const byLen = new Map();
  norms.forEach((n, i) => { if (!n) return; const l = byLen.get(n.length) || []; l.push(i); byLen.set(n.length, l); });
  /** @param {number} i @param {number} j */
  const cmpName = (i, j) => {
    const a = norms[i], b = norms[j];
    if (a === b) add(i, j, 'same_name');
    else if (Math.min(a.length, b.length) >= SIMILAR_MIN && within1(a, b)) add(i, j, 'similar_name');
  };
  for (const [len, idx] of byLen) {
    const longer = byLen.get(len + 1) || [];
    for (let x = 0; x < idx.length; x++) {
      for (let y = x + 1; y < idx.length; y++) cmpName(idx[x], idx[y]);
      for (const j of longer) cmpName(idx[x], j);
    }
  }
  // かなの名前と英字の名前: ローマ字にして同じなら同じ名前 (なつ / Natsu)
  /** @type {Map<string, number[]>} */
  const latin = new Map();
  norms.forEach((n, i) => { if (n.length >= SIMILAR_MIN && /^[a-z0-9]+$/.test(n)) { const l = latin.get(n) || []; l.push(i); latin.set(n, l); } });
  norms.forEach((n, i) => { const r = romaji(n); if (r.length >= SIMILAR_MIN) for (const j of latin.get(r) || []) add(i, j, 'same_name'); });
  // 2. 連携アカウント: 同じ ID (Discord) / 同じ名前 (種類を問わない。Discord の名前と X の名前が同じでもよい)
  /** @type {Map<string, number[]>} */
  const linkIdx = new Map();
  entrants.forEach((e, i) => {
    for (const l of e.links) {
      const keys = [];
      if (l.id) keys.push('id:' + l.type + ':' + l.id);
      const nm = linkName(l.name);
      if (nm.length >= LINK_NAME_MIN) keys.push('name:' + nm);
      for (const k of keys) { const arr = linkIdx.get(k) || []; if (!arr.includes(i)) arr.push(i); linkIdx.set(k, arr); }
    }
  });
  for (const [k, idx] of linkIdx) {
    if (idx.length < 2) continue;
    for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) add(idx[x], idx[y], k.startsWith('id:') ? 'link_id' : 'link_name');
  }
  return [...pairs].map(([k, s]) => {
    const [a, b] = k.split(',').map(Number);
    return { a, b, kinds: /** @type {Kind[]} */ ([...s]) };
  }).sort((x, y) => x.a - y.a || x.b - y.b);
}

/** 都道府県 (名前・ローマ字・地方)。地方は「同じ日に遠くの大会に出ていた」の判定に使う */
const PREFS = [
  ['北海道', 'hokkaido', 'hokkaido'], ['青森県', 'aomori', 'tohoku'], ['岩手県', 'iwate', 'tohoku'], ['宮城県', 'miyagi', 'tohoku'],
  ['秋田県', 'akita', 'tohoku'], ['山形県', 'yamagata', 'tohoku'], ['福島県', 'fukushima', 'tohoku'], ['茨城県', 'ibaraki', 'kanto'],
  ['栃木県', 'tochigi', 'kanto'], ['群馬県', 'gunma', 'kanto'], ['埼玉県', 'saitama', 'kanto'], ['千葉県', 'chiba', 'kanto'],
  ['東京都', 'tokyo', 'kanto'], ['神奈川県', 'kanagawa', 'kanto'], ['新潟県', 'niigata', 'chubu'], ['富山県', 'toyama', 'chubu'],
  ['石川県', 'ishikawa', 'chubu'], ['福井県', 'fukui', 'chubu'], ['山梨県', 'yamanashi', 'chubu'], ['長野県', 'nagano', 'chubu'],
  ['岐阜県', 'gifu', 'chubu'], ['静岡県', 'shizuoka', 'chubu'], ['愛知県', 'aichi', 'chubu'], ['三重県', 'mie', 'kinki'],
  ['滋賀県', 'shiga', 'kinki'], ['京都府', 'kyoto', 'kinki'], ['大阪府', 'osaka', 'kinki'], ['兵庫県', 'hyogo', 'kinki'],
  ['奈良県', 'nara', 'kinki'], ['和歌山県', 'wakayama', 'kinki'], ['鳥取県', 'tottori', 'chugoku'], ['島根県', 'shimane', 'chugoku'],
  ['岡山県', 'okayama', 'chugoku'], ['広島県', 'hiroshima', 'chugoku'], ['山口県', 'yamaguchi', 'chugoku'], ['徳島県', 'tokushima', 'shikoku'],
  ['香川県', 'kagawa', 'shikoku'], ['愛媛県', 'ehime', 'shikoku'], ['高知県', 'kochi', 'shikoku'], ['福岡県', 'fukuoka', 'kyushu'],
  ['佐賀県', 'saga', 'kyushu'], ['長崎県', 'nagasaki', 'kyushu'], ['熊本県', 'kumamoto', 'kyushu'], ['大分県', 'oita', 'kyushu'],
  ['宮崎県', 'miyazaki', 'kyushu'], ['鹿児島県', 'kagoshima', 'kyushu'], ['沖縄県', 'okinawa', 'kyushu'],
];
/** 市の名前だけのとき (start.gg の location はよく市だけ) */
const CITY_PREF = { '横浜': '神奈川県', '川崎': '神奈川県', '相模原': '神奈川県', '名古屋': '愛知県', '神戸': '兵庫県', 'kobe': '兵庫県', '仙台': '宮城県', 'sendai': '宮城県',
  '札幌': '北海道', 'sapporo': '北海道', '浦安': '千葉県', '柏': '千葉県', '船橋': '千葉県', '所沢': '埼玉県', 'tokorozawa': '埼玉県', 'yokohama': '神奈川県', 'nagoya': '愛知県' };

/** @param {unknown} text @returns {string | null} */
export function prefOf(text) {
  const t = String(text == null ? '' : text).normalize('NFKC');
  if (!t.trim()) return null;
  const low = t.toLowerCase();
  for (const [name, ro] of PREFS) {
    const stem = name === '北海道' ? name : name.slice(0, -1);
    if (t.includes(stem) || new RegExp('\\b' + ro + '\\b').test(low)) return name;
  }
  for (const [k, v] of Object.entries(CITY_PREF)) if (t.includes(k) || low.includes(k)) return v;
  return null;
}
/** @param {string | null} p */
function regionOf(p) { const r = PREFS.find((x) => x[0] === p); return r ? r[2] : null; }

/** @param {any} player SPSP の選手レコード (players/<uid>.json の安定部分) @param {Record<string, string>} [tourPref] event_id → 都道府県 @returns {History} */
export function summarize(player, tourPref = {}) {
  /** @type {Map<string, HistEvent>} */
  const events = new Map();
  /** @type {Record<string, number>} */
  const prefs = {};
  let first = null, last = null;
  for (const t of (player && player.tournaments) || []) {
    const id = t.event_id != null ? String(t.event_id) : t.parent_event_id != null ? 'c:' + t.parent_event_id + ':' + (t.class_letter || '') : null;
    if (id == null) continue;
    const w = Number(t.wins) || 0, l = Number(t.losses) || 0;
    const pref = tourPref[t.event_id != null ? id : String(t.parent_event_id)] || null;
    events.set(id, { id, date: String(t.date || ''), name: String(t.name || ''), event: String(t.event || ''), nent: t.nent ?? null,
      place: t.place ?? null, w, l, dq: !!t.is_dq, played: w + l > 0, pref });
    if (pref) prefs[pref] = (prefs[pref] || 0) + 1;
    if (t.date && (!first || t.date < first)) first = t.date;
    if (t.date && (!last || t.date > last)) last = t.date;
  }
  const mainPref = Object.entries(prefs).sort((x, y) => y[1] - x[1])[0];
  /** @type {Set<number>} */
  const opps = new Set();
  for (const m of (player && player.recent_matches) || []) if (m && m.opp_uid != null) opps.add(Number(m.opp_uid));
  const chars = ((player && player.characters) || []).slice(0, 2).map((/** @type {any} */ c) => String(c.name));
  return { events, count: events.size, first, last, prefs, mainPref: mainPref ? mainPref[0] : null, opps, chars };
}

/** @param {string | null | undefined} id @returns {number | null} */
export function discordCreated(id) {
  if (!id || !/^\d{15,20}$/.test(id)) return null;
  try { return Number((BigInt(id) >> 22n) + 1420070400000n); } catch (e) { return null; }
}

const DAY = 86400000;
/** 「作ったばかり」とみる Discord アカウントの古さ */
const NEW_DISCORD_DAYS = 365;

/** @param {Side} s */
function hasHist(s) { return !!(s.hist && s.hist.count > 0); }

/** 組の判定。理由 (reasons) は表示の順 (決め手が先)
 * @param {Side} A @param {Side} B @param {Kind[]} kinds @param {number} [now]
 * @returns {{ verdict: Verdict, reasons: Reason[], shared: { a: HistEvent, b: HistEvent }[], sameDay: { a: HistEvent, b: HistEvent }[] }} */
export function compare(A, B, kinds, now = Date.now()) {
  /** @type {Reason[]} */
  const reasons = [];
  /** @type {{ a: HistEvent, b: HistEvent }[]} */
  const shared = [];
  /** @type {{ a: HistEvent, b: HistEvent }[]} */
  const sameDay = [];
  if (A.hist && B.hist) {
    for (const [id, ea] of A.hist.events) { const eb = B.hist.events.get(id); if (eb) shared.push({ a: ea, b: eb }); }
    /** @type {Map<string, HistEvent[]>} */
    const byDate = new Map();
    for (const eb of B.hist.events.values()) if (eb.played) { const l = byDate.get(eb.date) || []; l.push(eb); byDate.set(eb.date, l); }
    for (const ea of A.hist.events.values()) {
      if (!ea.played) continue;
      for (const eb of byDate.get(ea.date) || []) {
        if (eb.id === ea.id || !ea.pref || !eb.pref) continue;
        if (regionOf(ea.pref) && regionOf(eb.pref) && regionOf(ea.pref) !== regionOf(eb.pref)) sameDay.push({ a: ea, b: eb });
      }
    }
  }
  shared.sort((x, y) => (x.a.date < y.a.date ? -1 : 1));
  const bothPlayed = shared.filter((s) => s.a.played && s.b.played);
  const dqOnly = shared.filter((s) => !(s.a.played && s.b.played));
  const sameId = kinds.includes('link_id');
  const sameLinkName = kinds.includes('link_name');

  /** @type {Verdict} */
  let verdict;
  if (bothPlayed.length || sameDay.length) {
    verdict = 'diff';
    if (bothPlayed.length) reasons.push({ code: 'both_played', params: { n: bothPlayed.length } });
    if (sameDay.length) reasons.push({ code: 'same_day_far', params: { n: sameDay.length } });
    if (sameId) reasons.push({ code: 'link_id_conflict' });
    else if (sameLinkName) reasons.push({ code: 'link_name_conflict' });
  } else if (sameId) {
    verdict = 'same';
    reasons.push({ code: 'link_id' });
  } else if (sameLinkName) {
    verdict = 'likely';
    reasons.push({ code: 'link_name' });
  } else if (hasHist(A) && hasHist(B)) {
    const ha = /** @type {History} */ (A.hist), hb = /** @type {History} */ (B.hist);
    const overlap = !(String(ha.last) < String(hb.first) || String(hb.last) < String(ha.first));
    const prefDiff = !!(A.pref && B.pref && A.pref !== B.pref);
    const linksDiff = distinctLinks(A.e, B.e);
    if (overlap && (prefDiff || linksDiff)) {
      verdict = 'prob_diff';
      reasons.push({ code: 'overlap' });
      if (prefDiff) reasons.push({ code: 'area_differ', params: { a: /** @type {string} */ (A.pref), b: /** @type {string} */ (B.pref) } });
      if (linksDiff) reasons.push({ code: 'links_differ' });
    } else if (overlap) {
      verdict = 'unknown';
      reasons.push({ code: 'overlap_same_area' });
    } else {
      verdict = 'unknown';
      const [early, late] = String(ha.last) < String(hb.first) ? [ha, hb] : [hb, ha];
      reasons.push({ code: 'sequential', params: { last: String(early.last), first: String(late.first) } });
      if (linksDiff) reasons.push({ code: 'links_differ' });
    }
  } else {
    const fresh = [A, B].filter((s) => !hasHist(s));
    const newDiscord = fresh.some((s) => s.e.links.some((l) => l.type === 'DISCORD' && (() => {
      const t = discordCreated(l.id);
      return t != null && now - t < NEW_DISCORD_DAYS * DAY;
    })()));
    const prefDiff = !!(A.pref && B.pref && A.pref !== B.pref);
    if (newDiscord) {
      verdict = 'unknown';
      reasons.push({ code: 'new_discord' });
    } else if (prefDiff && distinctLinks(A.e, B.e)) {
      verdict = 'prob_diff';
      reasons.push({ code: 'area_differ', params: { a: /** @type {string} */ (A.pref), b: /** @type {string} */ (B.pref) } });
      reasons.push({ code: 'links_differ' });
    } else {
      verdict = 'unknown';
      reasons.push({ code: 'no_history' });
    }
  }
  if (dqOnly.length) reasons.push({ code: 'shared_dq_only', params: { n: dqOnly.length } });
  if (A.e.userId == null || B.e.userId == null) reasons.push({ code: 'no_user' });
  return { verdict, reasons, shared, sameDay };
}

/** 同じ種類の連携アカウントを両方が持っていて、どれも違う (Discord は ID、ほかは名前で比べる) @param {Entrant} a @param {Entrant} b */
function distinctLinks(a, b) {
  let compared = false;
  for (const la of a.links) {
    for (const lb of b.links) {
      if (la.type !== lb.type) continue;
      compared = true;
      if (la.id && lb.id ? la.id === lb.id : la.name.toLowerCase() === lb.name.toLowerCase()) return false;
    }
  }
  return compared;
}

/** 判定の並び (確認が要るものが先) */
export const VERDICT_ORDER = /** @type {Verdict[]} */ (['same', 'likely', 'unknown', 'prob_diff', 'diff']);

const API = { normName, romaji, entrantFromNode, findCandidates, prefOf, summarize, discordCreated, compare, VERDICT_ORDER };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むため)
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspDupeCheck = API;
export default API;
