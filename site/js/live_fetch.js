// @ts-nocheck
// live_fetch.js — 参加中の大会の速報を、ブラウザが start.gg から直接読み直す (ログインした人の start.gg のトークンで。js/startgg_identity.js)。
// サーバ (Cloudflare Worker spsp-live、spsp-build deploy/live-worker/live.js) が 5 分ごとに書く live/<地域>/events/<id>.json と同じ形の doc を、
// 前回からの差分 (updatedAfter) で更新する。数え方 (順位・残り人数・ブラケットの位置) は live.js の写し:
//   ★ 下の「live.js の写し」は spsp-build deploy/live-worker/live.js (a9cc651) の同じ関数をそのまま写したもの。変えるときは両方を変える。
// 1 回の更新の問い合わせ: セット (前回以降に更新されたもの) 1 回〜。新しいセットがあったときだけ順位 (と、知らない参加者がいれば参加者) を取り直す。
// フェーズは 5 分おきか、知らないプールのセットが来たとき。何も起きていなければ 1 回だけ。
//   refreshDoc(gql, doc, now)  doc の写しを更新して返す (doc は変えない)
//   makeGql(token)             start.gg を呼ぶ関数 (間隔をあける・1 回の更新で MAX_REQUESTS まで・429 なら一定時間止める)
export const DOC_VERSION = 2;
export const LOWER_CLASS_NAME_PAT = /[BCDEＢＣＤＥ]\s*クラス|(?<![A-Za-z])[BCDE][\s_\-]*class(?![A-Za-z])/i;
export const SET_CURSOR_MARGIN_SEC = 120;   // セットの続きは少し前から読み直す (時計のずれ。live.js と同じ)
const PHASES_MAX_AGE_SEC = 300;
const MAX_REQUESTS = 20;
const MIN_INTERVAL_MS = 400;
const PAUSE_AFTER_429_MS = 60 * 1000;

// ======== live.js の写し (ここから) ========
const PHASES_QUERY = `query LivePhases($eid: ID!) {
  event(id: $eid) {
    phases {
      id name phaseOrder bracketType state numSeeds
      phaseGroups(query: {page: 1, perPage: 256}) { nodes { id displayIdentifier state bracketUrl } }
    }
  }
}`;

const ENTRANTS_QUERY = `query LiveEntrants($eid: ID!, $page: Int!, $perPage: Int!) {
  event(id: $eid) {
    entrants(query: {page: $page, perPage: $perPage}) {
      pageInfo { total totalPages }
      nodes { id name initialSeedNum participants { gamerTag user { id } } }
    }
  }
}`;

const SETS_QUERY = `query LiveSets($eid: ID!, $after: Timestamp, $page: Int!, $perPage: Int!) {
  event(id: $eid) {
    sets(page: $page, perPage: $perPage, sortType: RECENT, filters: {updatedAfter: $after, hideEmpty: false}) {
      pageInfo { total totalPages }
      nodes {
        id state round fullRoundText identifier winnerId startedAt completedAt updatedAt totalGames
        phaseGroup { id }
        slots { prereqType entrant { id } standing { stats { score { value } } } }
        games { orderNum winnerId selections { entrant { id } character { id } } }
      }
    }
  }
}`;

const STANDINGS_QUERY = `query LiveStandings($eid: ID!, $page: Int!, $perPage: Int!) {
  event(id: $eid) {
    standings(query: {page: $page, perPage: $perPage}) {
      pageInfo { total totalPages }
      nodes { placement isFinal entrant { id } }
    }
  }
}`;


// トーナメントの順位の区切り (1, 2, 3, 4, 5, 7, 9, 13, 17, 25, …)
const BUCKETS = (() => {
  const out = [1, 2, 3, 4];
  for (let k = 4; k < 1 << 16; k *= 2) out.push(k + 1, k + k / 2 + 1);
  return out;
})();

// 残り alive 人のうちの 1 人が取りうる最悪の順位 (alive が入る区切り)
export function worstPlacement(alive) {
  if (!(alive > 0)) return null;
  let best = 1;
  for (const b of BUCKETS) {
    if (b > alive) break;
    best = b;
  }
  return best;
}


function isComplexityError(body) {
  return (body?.errors || []).some((e) => /complexity/i.test(e.message || ""));
}

// ページを全部たどる (path = data からのキー列)。複雑すぎると言われたら perPage を半分にしてその位置から続ける
export async function fetchAllNodes(gql, query, variables, path, perPage) {
  const out = [];
  let per = perPage;
  for (let page = 1; ; ) {
    const body = await gql(query, { ...variables, page, perPage: per });
    if (isComplexityError(body) && per > 2) {
      const done = (page - 1) * per;
      per = Math.max(2, Math.floor(per / 2));
      page = Math.floor(done / per) + 1;
      out.length = (page - 1) * per;
      continue;
    }
    let conn = body?.data;
    for (const k of path) conn = conn?.[k];
    if (!conn) throw new Error(`${path.join(".")}: ${JSON.stringify(body?.errors || body).slice(0, 300)}`);
    const nodes = conn.nodes || [];
    out.push(...nodes);
    const totalPages = conn.pageInfo?.totalPages || 1;
    if (!nodes.length || page >= totalPages) return out;
    page++;
  }
}


async function fetchPhases(gql, eid) {
  const body = await gql(PHASES_QUERY, { eid });
  const ev = body?.data?.event;
  if (!ev) throw new Error(`phases of event ${eid}: ${JSON.stringify(body?.errors || body).slice(0, 300)}`);
  return [...(ev.phases || [])]
    .sort((a, b) => (a.phaseOrder || 0) - (b.phaseOrder || 0) || a.id - b.id)
    .map((p) => ({
      id: p.id, name: p.name, order: p.phaseOrder, type: p.bracketType, state: p.state, seeds: p.numSeeds ?? null, cls: LOWER_CLASS_NAME_PAT.test(p.name || ""),
      groups: (p.phaseGroups?.nodes || []).map((g) => ({ id: g.id, ident: g.displayIdentifier, state: g.state, url: g.bracketUrl })),
    }));
}

async function fetchEntrants(gql, eid) {
  const nodes = await fetchAllNodes(gql, ENTRANTS_QUERY, { eid }, ["event", "entrants"], 100);
  const out = {};
  for (const n of nodes) {
    const parts = n.participants || [];
    const solo = parts.length === 1 ? parts[0] : null;
    out[String(n.id)] = { name: n.name, tag: solo?.gamerTag ?? null, uid: solo?.user?.id ?? null, seed: n.initialSeedNum ?? null };
  }
  return out;
}

export function setRecord(s) {
  const slots = s.slots || [];
  const games = [...(s.games || [])].sort((a, b) => (a.orderNum || 0) - (b.orderNum || 0)).map((g) => {
    const c = {};
    for (const x of g.selections || []) c[String(x.entrant?.id)] = x.character?.id ?? null;
    return { w: g.winnerId ?? null, c };
  });
  return {
    id: s.id, pg: s.phaseGroup?.id ?? null, round: s.round ?? null, round_text: s.fullRoundText ?? null,
    ident: s.identifier ?? null, state: s.state ?? null,
    e: slots.map((sl) => sl?.entrant?.id ?? null),
    score: slots.map((sl) => sl?.standing?.stats?.score?.value ?? null),
    winner: s.winnerId ?? null, best_of: s.totalGames ?? null, bye: slots.some((sl) => sl?.prereqType === "bye"),
    started_at: s.startedAt ?? null, completed_at: s.completedAt ?? null, updated_at: s.updatedAt ?? null,
    games: games.length ? games : null,
  };
}

async function fetchStandings(gql, eid) {
  const nodes = await fetchAllNodes(gql, STANDINGS_QUERY, { eid }, ["event", "standings"], 100);
  const out = {};
  for (const n of nodes) if (n.entrant?.id != null) out[String(n.entrant.id)] = [n.placement ?? null, !!n.isFinal];
  return out;
}

// 順位 (start.gg) と、残っている参加者の「最悪でもこの順位」、いま (敗退していれば最後に) いるプール。
// いるプール = その参加者の一番新しいセットのプール (相手待ち・未対戦のセットが一番新しい。次に始まった・終わった時刻の新しいもの)。
// フェーズの phaseOrder は作った順で、進む順とは限らない (TOP8 が TOP96 より前のことがある) ので使わない。
// 同じ部門の中の下位クラス (名前が LOWER_CLASS_NAME_PAT のフェーズ、phases[].cls) にいる参加者は本戦では敗退済み:
// 残り人数に数えない (place_min なし)。
export function applyStandings(doc, standings) {
  const elim = (doc.phases || []).some((p) => !p.cls && /ELIMINATION$/.test(p.type || ""));
  const clsPg = new Set();
  for (const p of doc.phases || []) if (p.cls) for (const g of p.groups || []) clsPg.add(String(g.id));
  const recency = (s) => (s.winner == null && !s.started_at ? Infinity : (s.completed_at || s.started_at || 0));
  const lastPg = {};
  for (const s of doc.sets || []) {
    const r = recency(s);
    for (const id of s.e || []) {
      if (id == null) continue;
      const k = String(id);
      if (!lastPg[k] || r >= lastPg[k][0]) lastPg[k] = [r, s.pg];
    }
  }
  let alive = 0;
  for (const [id, e] of Object.entries(doc.entrants || {})) {
    const [placement, final] = standings[id] || [null, false];
    e.placement = placement;
    e.final = final;
    e.pg = lastPg[id]?.[1] ?? null;
    e.in_class = e.pg != null && clsPg.has(String(e.pg));
    if (!final && !e.in_class) alive++;
  }
  const worst = elim ? worstPlacement(alive) : null;
  for (const e of Object.values(doc.entrants || {})) e.place_min = e.final || e.in_class ? null : worst;
  bracketLabels(doc);   // 敗者側のラベルは負けた人の順位から決まる
}

// ---- ブラケットの位置 (smash_database scripts/common/redownload_matches_v2.py の移植。数え方を変えるときは両方) ----
const CLASS_PHASE_RE = /\b[B-E][- ]?class\b|[B-EＢＣＤＥ][- ]?クラス/i;
const BT_LABEL = { ROUND_ROBIN: "総当たり", SWISS: "スイスドロー", MATCHMAKING: "レート戦" };
const isBracket = (type) => !type || type === "DOUBLE_ELIMINATION" || type === "SINGLE_ELIMINATION";

function classLetter(name) {
  const m = (name || "").match(CLASS_PHASE_RE);
  return m ? m[0][0].replace(/[ＡＢＣＤＥ]/, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).toUpperCase() : null;
}
// プレイインを除いた実質の大きさ (2 の累乗ならそのまま、そうでなければ下の 2 の累乗)
function capacityOf(n) {
  if (!(n > 1)) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p === n ? n : p / 2;
}
// 順位の区切りの上端 1,2,3,4,6,8,12,16,24,…
export function placementBucket(p) {
  if (!(p > 0)) return null;
  if (p <= 4) return p;
  for (let k = 1; k <= 20; k++) {
    if (p <= 3 * 2 ** k) return 3 * 2 ** k;
    if (p <= 2 ** (k + 2)) return 2 ** (k + 2);
  }
  return null;
}
function losersTopX(fromFinal) {   // 敗者側決勝から数えて fromFinal 番目 (1 = 敗者側決勝) のラウンドで負けたときの区切り
  const w2w = fromFinal + 1;
  const k = Math.floor(w2w / 2);
  return w2w % 2 === 0 ? 3 * 2 ** (k - 1) : 2 ** (k + 1);
}

// 各セットに label を付ける。勝者側は全体のラウンド (フェーズを phaseOrder 順につなぎ、プレイインを除く) と本戦の大きさから、
// 敗者側は負けた人の順位の区切りから (まだ終わっていないセットは同じフェーズ・ラウンドの終わったセット、無ければラウンドから)。
// 下位クラスのフェーズは独立したブラケット (頭に "B-" など、大きさはそのフェーズの numSeeds)
export function bracketLabels(doc) {
  const phaseOf = {};
  for (const p of doc.phases || []) for (const g of p.groups || []) phaseOf[String(g.id)] = p;
  const info = new Map();
  const losersMax = {};   // フェーズ → 敗者側ラウンドの |round| の最大 (start.gg は敗者側決勝ほど絶対値が大きい: -4 … -10 = 敗者側決勝)
  let mainSeeds = 0;
  for (const s of doc.sets || []) {
    const p = phaseOf[String(s.pg)];
    if (!p) continue;
    if (!classLetter(p.name)) mainSeeds = Math.max(mainSeeds, p.seeds || 0);
    if (isBracket(p.type) && s.round < 0) losersMax[p.id] = Math.max(losersMax[p.id] || 0, -s.round);
    if (!isBracket(p.type) || s.bye || !(s.round > 0)) continue;
    let i = info.get(p.id);
    if (!i) info.set(p.id, (i = { order: p.order || 0, seeds: p.seeds || 0, counts: {}, se: p.type === "SINGLE_ELIMINATION", letter: classLetter(p.name) }));
    i.counts[s.round] = (i.counts[s.round] || 0) + 1;
  }
  let cumulative = 0;
  const mainOrder = [];
  // 本戦のフェーズは進む順 = 人数 (numSeeds) の多い順につなぐ。phaseOrder は作った順で、進む順とは限らない (TOP8 が TOP96 より前など)。
  // 本戦のフェーズに人数の分からないものがあれば phaseOrder のまま (smash_database の _phase_progress_key と同じ)
  const bySize = [...info.values()].every((i) => i.letter || i.seeds > 0);
  const key = (/** @type {any} */ i) => (bySize && !i.letter ? -i.seeds : 0);
  for (const [, i] of [...info.entries()].sort((a, b) => key(a[1]) - key(b[1]) || a[1].order - b[1].order || a[0] - b[0])) {
    const rounds = Object.keys(i.counts).map(Number).sort((a, b) => a - b);
    i.playIn = new Set();
    for (let k = 0; k < rounds.length - 1; k++) {   // 次のラウンドのちょうど 2 倍でない先頭のラウンドはプレイイン
      if (i.counts[rounds[k]] !== i.counts[rounds[k + 1]] * 2) i.playIn.add(rounds[k]);
      else break;
    }
    i.eff = rounds.filter((r) => !i.playIn.has(r));
    i.offset = i.letter ? 0 : cumulative;
    if (!i.letter) { cumulative += i.eff.length; mainOrder.push(i); }
  }
  // 本戦のフェーズから次のフェーズへ進む人数 (最後のフェーズは 2 = 決勝の 2 人)。敗者側決勝で負けた人はその次の順位
  mainOrder.forEach((i, k) => { i.advance = mainOrder[k + 1]?.seeds || 2; });
  const mainCap = capacityOf(mainSeeds);
  const ent = doc.entrants || {};
  const losersDone = {};   // "<フェーズ>:<ラウンド>" → 終わったセットの区切り
  const label = (s, pending) => {
    const p = phaseOf[String(s.pg)];
    if (!p || s.round == null) return null;
    const letter = classLetter(p.name);
    const pre = letter ? letter + "-" : "";
    if (!isBracket(p.type)) return BT_LABEL[p.type] ? pre + BT_LABEL[p.type] : null;
    const i = info.get(p.id);
    const se = !!i?.se;
    const cap = letter ? capacityOf(p.seeds || 0) : mainCap;
    if (s.round > 0) {
      if (!i) return null;
      if (se && !(cap > 1)) return null;
      if (i.playIn.has(s.round)) return `${pre}Winners TOP ${se ? placementBucket(p.seeds || 0) || cap * 2 : cap * 2}`;
      const idx = i.eff.indexOf(s.round);
      if (idx < 0) return null;
      return `${pre}Winners TOP ${Math.max(2, Math.floor(cap / 2 ** (i.offset + idx)))}`;
    }
    if (s.round < 0) {
      if (se) return null;
      if (!letter) {
        const key = p.id + ":" + s.round;
        if (pending) { if (losersDone[key]) return `Losers TOP ${losersDone[key]}`; }
        else {
          const loser = (s.e || []).find((id) => id != null && String(id) !== String(s.winner));
          const e = loser != null ? ent[String(loser)] : null;
          const b = placementBucket(e?.placement);
          if (b) { losersDone[key] = b; return `Losers TOP ${b}`; }
        }
      }
      const fromFinal = (losersMax[p.id] || -s.round) + s.round + 1;
      const advance = letter ? 2 : info.get(p.id)?.advance || 2;
      return `${pre}Losers TOP ${losersTopX(fromFinal) * Math.max(1, advance / 2)}`;
    }
    return se ? null : `${pre}Grand Final`;
  };
  for (const s of doc.sets || []) if (s.winner != null) s.label = label(s, false);
  for (const s of doc.sets || []) if (s.winner == null) s.label = label(s, true);
}

// ======== live.js の写し (ここまで) ========

let pausedUntil = 0;
/** @param {string} token */
export function makeGql(token, maxRequests = MAX_REQUESTS) {
  let last = 0;
  const client = async (query, variables) => {
    if (Date.now() < pausedUntil) throw new Error('start.gg paused (429)');
    if (client.count >= maxRequests) throw new Error("budget");
    const wait = last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    client.count++;
    const res = await fetch('https://api.start.gg/gql/alpha', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) { pausedUntil = Date.now() + PAUSE_AFTER_429_MS; throw new Error('start.gg 429'); }
    if (res.status === 401 || res.status === 403) { const e = new Error('start.gg ' + res.status); e.auth = true; throw e; }
    if (res.status !== 200) throw new Error('start.gg ' + res.status);
    return res.json();
  };
  client.count = 0;
  return client;
}

/** doc (サーバの速報か、前にブラウザで更新したもの) の写しを start.gg から差分で更新する
 * @param {any} gql @param {any} doc @param {number} now 秒 @returns {Promise<any>} */
export async function refreshDoc(gql, doc, now) {
  const d = JSON.parse(JSON.stringify(doc));
  const eid = d.event_id;
  const cursor = d._sets_after;
  const after = cursor == null ? null : Math.max(0, cursor - SET_CURSOR_MARGIN_SEC);
  const fresh = (await fetchAllNodes(gql, SETS_QUERY, { eid, after }, ['event', 'sets'], 40)).map(setRecord);
  const knownPg = new Set();
  for (const p of d.phases || []) for (const g of p.groups || []) knownPg.add(String(g.id));
  if (!d.phases || !d._phases_at || now - d._phases_at >= PHASES_MAX_AGE_SEC || fresh.some((s) => s.pg != null && !knownPg.has(String(s.pg)))) {
    d.phases = await fetchPhases(gql, eid);
    d._phases_at = now;
  }
  if (!d.entrants || fresh.some((s) => (s.e || []).some((id) => id != null && !d.entrants[String(id)]))) {
    const got = await fetchEntrants(gql, eid);   // 知らない参加者 (後から足された人) がいる: 取り直して重ねる (順位などは下で付け直す)
    d.entrants = d.entrants || {};
    for (const [id, e] of Object.entries(got)) d.entrants[id] = Object.assign(d.entrants[id] || {}, e);
  }
  if (fresh.length) {
    const sets = new Map((d.sets || []).map((s) => [String(s.id), s]));
    for (const s of fresh) sets.set(String(s.id), s);
    d.sets = [...sets.values()].sort((a, b) => String(a.pg).localeCompare(String(b.pg)) || (a.round || 0) - (b.round || 0) || String(a.id).localeCompare(String(b.id)));
    applyStandings(d, await fetchStandings(gql, eid));
  }
  d._sets_after = now;
  d.updated_at = now;
  d._browser = true;   // ブラウザで更新した印 (サーバの doc と比べるときは updated_at で見る)
  return d;
}

const api = { refreshDoc, makeGql, applyStandings, bracketLabels, setRecord, worstPlacement, placementBucket };
export default api;
