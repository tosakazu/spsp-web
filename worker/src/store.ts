/**
 * 保存先の抽象 (スプレッドシート → D1)。
 *
 * ハンドラはこのインターフェースだけを使う。本番は db.ts (D1)、テストは
 * test/_mem_store.mjs (メモリ) が実装する。
 */

/** char_votes シートの 1 行 (列はシートと同じ + ts_ms)。 */
export interface VoteRow {
  ts: string;        // ISO 8601 (固定オフセット)。シートの timestamp 列
  ts_ms: number;     // ts の epoch ms (連投判定用)
  user_id: string;   // currentUser 由来 (INV-1)
  user_slug: string;
  gamer_tag: string;
  char_id: string;
  char_name: string;
  status: string;    // 'pending' (以降は人間が書き換えうる)
}

/** posts シートの 1 行。 */
export interface PostRow {
  ts: string;
  ts_ms: number;
  user_id: string;
  user_slug: string;
  gamer_tag: string;
  body: string;
  status: string;
}

/** errors シートの 1 行。個人を特定できる情報は入れない。 */
export interface ErrorRow {
  ts: string;
  source: string;    // 'server' | 'client'
  action: string;
  code: string;
  user_id: string;   // 数値化できないときは ''
  note: string;
}

/** 連投判定に要る値 (gas/sheet.gs checkRateLimitOn_ が末尾 500 行から拾っていたもの)。 */
export interface RecentActivity {
  latestMs: number | null;   // このユーザーの最新行の ts_ms
  todayCount: number;        // このユーザーの当日 (day キー一致) の行数
}

/** 連投制御つき挿入の条件。満たさなければ挿入しない (GAS のロック内判定に相当)。 */
export interface RateGuard {
  userId: string;
  nowMs: number;
  minIntervalMs: number;
  dayKey: string;
  maxPerDay: number;
}

/** card_settings の 1 行。settings は検証済みの JSON 文字列。 */
export interface CardRow {
  settings: string;
  updated_at: string;
}

/** class_brackets の 1 行 (id と status は D1 が付ける)。 */
export interface ClassBracketRow {
  created_at: string;
  ts_ms: number;
  day: string;
  parent_event_id: number;
  parent_tournament_id: number;
  class_letter: string;
  name: string;
  challonge_id: number;
  challonge_url: string;
  format: string;
  counted: number;          // 1 / 0
  place_min: number;
  place_max: number | null;
  seeding: string;
  entrant_count: number;
  registered_by: string;
}

/** 取得待ちの一覧 (class_waitlist) に出す欄。公開してよいものだけ。 */
export interface ClassWaitItem {
  id: number;
  parent_event_id: number;
  parent_tournament_id: number;
  class_letter: string;
  name: string;
  challonge_id: number;
  challonge_url: string;
  created_at: string;
}

/** class_mine に返す欄 (自分が作ったもの)。 */
export interface ClassMineItem {
  id: number;
  parent_event_id: number;
  parent_tournament_id: number;
  class_letter: string;
  name: string;
  challonge_id: number;
  challonge_url: string;
  counted: boolean;
  status: string;
  created_at: string;
  entrant_count: number;
}

/** class_delete が見る欄。 */
export interface ClassRecord {
  id: number;
  parent_event_id: number;
  challonge_id: number;
  registered_by: string;
  status: string;
}

export type ClassInsertResult = { status: 'ok'; id: number } | { status: 'duplicate' } | { status: 'rate_limited' };

/** title_owned の 1 行。bits = 持っている二つ名、n_pre / n_post = 大会で引いた回数 (site/js/titles.js advanceTitles)、updated = 最後にビットが増えた日 */
export interface TitleOwnedRow { bits: string; updated: string; n_pre: number; n_post: number }
/** title_sync の 1 人分。prev = 同期の道具が読んだときの行 (無ければ null)。prev のままのときだけ書く */
export interface TitleOwnedWrite { uid: string; prev: { bits: string; n_pre: number; n_post: number } | null; bits: string; n_pre: number; n_post: number }
/** csp_reports の 1 行 (書き出し用)。 */
export interface CspRow { directive: string; blocked: string; path: string; sample: string; source: string; hits: number; first_seen: string; last_seen: string }

/** ログインの記録 1 行 (login_log。ユーザー ID・時刻・どのログインか だけ) */
export interface LoginRow { user_id: string; ts_ms: number; flow: string }
/** tool_logs の 1 行 (migrations/0009)。 */
export interface ToolLogRow {
  ts: string; ts_ms: number; day: string; tool: string; action: string;
  user_id: string; gamer_tag: string; verified: number; auth: string;
  tournament_id: number | null; tournament_slug: string; tournament_name: string;
  event_id: number | null; event_name: string; phase_id: number | null; count: number | null; detail: string;
}

/** 試合結果の報告の受付 (report_events、migrations/0012)。token_enc は暗号化したトークン */
export interface ReportEventRow {
  code: string; kind: 'startgg' | 'challonge'; target_id: string;
  event_id: number | null; tournament_id: number | null; class_id: number | null;
  name: string; slug: string; admins: string; token_enc: string; token_exp_ms: number; settings: string;
  /** 報告管理者 (JSON の配列 [{ id, name, disc }]、0016)。古い行・テストの行には無いことがある */
  managers?: string;
  /** start.gg の大会の管理者 (owner と admins の ID、カンマ区切り) と最後に読もうとした時刻 (0020)。古い行・テストの行には無いことがある */
  sgg_admins?: string; sgg_admins_ms?: number;
  /** 大会が終わった時刻 (start.gg の部門が COMPLETED、0023)。0 = まだ */
  ended_ms?: number;
  /** 開始時刻のブラケット自動開始 (0026): 終わった時刻 (0 = まだ)・失敗した回数・結果。古い行・テストの行には無いことがある */
  auto_start_ms?: number; auto_start_tries?: number; auto_start_note?: string;
  status: 'active' | 'stopped'; created_ms: number; expires_ms: number;
}
/** 受付中の一覧 (だれでも読める欄だけ) */
/** 名前をつけて保存した運営の設定 (report_presets) */
export interface ReportPresetRow { name: string; settings: string; updated_ms: number }
/** report_grants の 1 行 (運営のログインのトークン、受付を始めるまで) */
export interface ReportPushSubRow { endpoint: string; user_id: string; p256dh: string; auth: string; created_ms: number }
export interface ReportGrantRow { user_id: string; token_enc: string; token_exp_ms: number; expires_ms: number }
export type ReportEventPublic = Pick<ReportEventRow, 'code' | 'kind' | 'event_id' | 'tournament_id' | 'class_id' | 'name' | 'slug' | 'expires_ms' | 'settings' | 'ended_ms'>;
/** report_sets の 1 行 */
export interface ReportSetRow {
  code: string; set_id: string; state: string; users: string; slots: string; applied: string; note: string;
  floor_id: number; version: number; updated_ms: number;
}
/** report_submissions の 1 行 */
export interface ReportSubmissionRow {
  id?: number; code: string; set_id: string; user_id: string; side: number; ts_ms: number; result: string; outcome: string;
}

/** report_health の 1 行 (start.gg / Challonge の様子、0017) */
export interface ReportHealthRow { kind: string; down_since_ms: number; last_fail_ms: number; last_ok_ms: number; fails: number; probe_ms: number; note: string }
/** report_snapshots の 1 行 (ブラケットの写し、0017) */
export interface ReportSnapshotRow { code: string; data: string; synced_ms: number; lock_ms: number }
/** report_manual_sets の 1 行 (障害中に運営が指定した試合、0017) */
export interface ReportManualRow {
  id?: number; code: string; side: string; group_id: string; slots: string; users: string; station: string; set_id: string;
  status: string; created_by: string; created_ms: number; updated_ms: number;
}

/** report_dqs の 1 行 (運営の DQ、0018) */
export interface ReportDqRow {
  id?: number; code: string; entrant_id: string; name: string; scope: string; set_id?: string; status: string; done_sets: string; note: string;
  created_by: string; created_ms: number; updated_ms: number;
}
/** report_noshows の 1 行 (選手の「対戦相手が見つからない」、0018) */
export interface ReportNoshowRow {
  code: string; set_id: string; user_id: string; users: string; info: string; first_ms: number; last_ms: number; count: number; notified_ms: number; status: string; note: string;
}

/** report_starts の 1 行 (対戦開始、0018・0019)。sgg: 0 = start.gg にまだ / 1 = 入った / 2 = 要らない / -1 = 断られた */
export interface ReportStartRow { set_id: string; user_id: string; ts_ms: number; sgg: number; tried_ms: number; note: string; info: string }

export interface Store {
  /** ログインの記録を 1 行足す。 */
  insertLogin(row: LoginRow): Promise<void>;
  /** ログインの引き継ぎ (0027): h = 乱数の SHA-256、data = 暗号化した結果 */
  putLoginHandoff(h: string, data: string, expiresMs: number, nowMs: number): Promise<void>;
  /** 取り出して消す (1 回だけ)。期限切れ・無ければ null */
  takeLoginHandoff(h: string, nowMs: number): Promise<string | null>;
  /** votes / posts のうちユーザーの直近の様子。 */
  recentActivity(table: 'votes' | 'posts', userId: string, dayKey: string): Promise<RecentActivity>;
  /** 連投条件を満たすときだけ 1 行追記する。追記したら true。 */
  insertVote(row: VoteRow, guard: RateGuard): Promise<boolean>;
  insertPost(row: PostRow, guard: RateGuard): Promise<boolean>;
  /** 1 行追記して、上限を超えていたら古い行から間引く。 */
  insertError(row: ErrorRow, maxRows: number, trimTo: number): Promise<void>;
  /** 全行 (挿入順) と行数。 */
  listVotes(): Promise<{ rows: VoteRow[]; total: number }>;
  /** 末尾 limit 行 (挿入順) と総行数。 */
  listErrors(limit: number): Promise<{ rows: ErrorRow[]; total: number }>;
  /**
   * 署名 state の単回使用。key が未使用なら true。
   * consume=true のときは同時に「使用済み」として記録する (expiresMs まで保持)。
   */
  checkState(key: string, consume: boolean, expiresMs: number, nowMs: number): Promise<boolean>;
  /** CSP の違反を数える。同じ key があれば hits+1、無ければ maxKeys 未満のときだけ追加。 */
  recordCsp(key: string, e: { directive: string; blocked: string; path: string; sample: string; source: string }, ts: string, maxKeys: number): Promise<void>;
  /** 多い順。 */
  listCsp(): Promise<CspRow[]>;
  /** プレイヤーカードの設定。無ければ null。 */
  getCardSettings(uid: string): Promise<CardRow | null>;
  /**
   * 連投条件 (card_writes で判定) を満たすときだけ、書き込みを記録して設定を置き換える
   * (settings が null なら行を消す)。書いたら true、連投で弾いたら false。
   */
  putCardSettings(uid: string, settings: string | null, updatedAt: string, guard: RateGuard): Promise<boolean>;
  /** 同じ challonge_id があるか。 */
  classExists(challongeId: number): Promise<boolean>;
  /** 連投条件 (registered_by ごと) を今満たしているか (Challonge に作る前の確認)。 */
  classRateOk(guard: RateGuard): Promise<boolean>;
  /** 連投条件 (registered_by ごと) を満たし、challonge_id が未登録なら 1 行追加する。 */
  insertClassBracket(row: ClassBracketRow, guard: RateGuard): Promise<ClassInsertResult>;
  /** counted = 1 かつ status = 'waiting' の行 (id 順)。 */
  listClassWaitlist(): Promise<ClassWaitItem[]>;
  /** status を done にする。行が無ければ 'missing'、削除済みなら 'deleted' (変えない)、それ以外は 'done'。 */
  markClassDone(id: number): Promise<'done' | 'deleted' | 'missing'>;
  /** 1 行 (無ければ null)。 */
  getClassBracket(id: number): Promise<ClassRecord | null>;
  /** registered_by = userId かつ ts_ms >= sinceMs かつ削除していない行 (新しい順)。 */
  listClassMine(userId: string, sinceMs: number): Promise<ClassMineItem[]>;
  /** waiting の行だけ deleted にする。結果: 'deleted' / 'done' (取得済みなので消さなかった) / 'missing' (無い・もう削除済み)。 */
  markClassDeleted(id: number, deletedAt: string): Promise<'deleted' | 'done' | 'missing'>;
  /** 持っている二つ名の記録 (無ければ null)。 */
  getTitleOwned(uid: string, lang: string): Promise<TitleOwnedRow | null>;
  /** 行が prev のままのときだけ書く (prev null = 行が無いときだけ作る)。updated はビットが変わったときだけ date にする。
   * 書けなかった (ほかの同期が先に書いた) uid を返す。 */
  casTitleOwnedMany(lang: string, rows: TitleOwnedWrite[], date: string): Promise<string[]>;
  /** uid の昇順に、afterUid より後を limit 件 (同期の道具が今の記録を読む)。 */
  listTitleOwned(lang: string, afterUid: number, limit: number): Promise<({ uid: number } & TitleOwnedRow)[]>;
  /** 連投条件 (user_id と action ごと) を満たすときだけ記録する。記録したら true。 */
  recordClassAction(action: string, guard: RateGuard): Promise<boolean>;
  /** 大会運営ツールの使用記録を 1 行足す。同じユーザーの当日分が maxPerDay 以上なら足さずに false */
  insertToolLog(row: ToolLogRow, maxPerDay: number): Promise<boolean>;
  /** 報告の受付 (無ければ null)。 */
  getReportEvent(code: string): Promise<ReportEventRow | null>;
  /** ブラケットを自動で開始する受付: 開始時刻 (settings.opens_ms) を受付を始めたより後に決めてあり、その時刻が sinceMs〜nowMs、まだ終えていない start.gg の受付 */
  listReportAutoStartDue(nowMs: number, sinceMs: number): Promise<string[]>;
  setReportAutoStart(code: string, v: { ms: number; tries: number; note: string }): Promise<void>;
  /** 同じ大会 (kind, target_id) の受付 (無ければ null)。 */
  getReportEventByTarget(kind: string, targetId: string): Promise<ReportEventRow | null>;
  /** 受付を足す (同じ (kind, target_id) があれば、code と created_ms はそのままでほかを置き換える)。 */
  upsertReportEvent(row: ReportEventRow): Promise<void>;
  /** トークンだけ書き換える (延長したとき)。 */
  updateReportEventToken(code: string, tokenEnc: string, tokenExpMs: number): Promise<void>;
  /** 運営の設定 (JSON) を書き換える。 */
  updateReportEventSettings(code: string, settings: string): Promise<void>;
  /** 運営 (start.gg の大会の管理者で、受付を始めた・加わった人。カンマ区切り) を書き換える。 */
  updateReportEventAdmins(code: string, admins: string): Promise<void>;
  /** 報告管理者 (JSON) を書き換える。 */
  updateReportEventManagers(code: string, managers: string): Promise<void>;
  /** 大会が終わった時刻を入れる (まだ入っていなければ、0023)。ms = 0 なら消す (閉じ忘れと判定したあと動き出した) */
  setReportEventEnded(code: string, ms: number): Promise<void>;
  /** トーナメントプレビューの短い URL (bracket_shares、0024) */
  putBracketShare(row: { id: string; frag: string; sgg: string; user_id: string; user_name: string; created_ms: number; expires_ms: number }): Promise<void>;
  getBracketShare(id: string, nowMs: number): Promise<{ frag: string; sgg: string; expires_ms: number } | null>;
  purgeBracketShares(nowMs: number): Promise<void>;
  /** その人の短い URL (新しい順) */
  listBracketSharesOf(userId: string): Promise<{ id: string; created_ms: number }[]>;
  deleteBracketShare(id: string): Promise<void>;
  /** 運営が確かめた通過順 (report_prog_ok、0021) */
  listReportProgOk(code: string): Promise<{ group_id: string; list: string }[]>;
  putReportProgOk(code: string, groupId: string, list: string, userId: string, ms: number): Promise<void>;
  /** start.gg の大会の管理者一覧と読もうとした時刻を書き換える (ids = null なら時刻だけ)。 */
  updateReportEventSggAdmins(code: string, ids: string | null, ms: number): Promise<void>;
  /** その人の保存した設定 (新しい順)。 */
  listReportPresets(userId: string): Promise<ReportPresetRow[]>;
  /** 名前が同じなら置き換える。名前が新しくて既に max 件あれば足さずに false */
  saveReportPreset(userId: string, row: ReportPresetRow, max: number): Promise<boolean>;
  deleteReportPreset(userId: string, name: string): Promise<void>;
  /** 運営のログインのトークン (期限内だけ)。 */
  getReportGrant(userId: string, nowMs: number): Promise<ReportGrantRow | null>;
  putReportGrant(row: ReportGrantRow): Promise<void>;
  deleteReportGrant(userId: string): Promise<void>;
  /** 運営の通知の送り先 (端末ごと)。同じ endpoint なら置き換える。1 人 max 台まで (古いものから消す) */
  putReportPushSub(row: ReportPushSubRow, max: number): Promise<void>;
  deleteReportPushSub(endpoint: string, userId: string | null): Promise<void>;
  listReportPushSubs(userIds: string[]): Promise<ReportPushSubRow[]>;
  /** 受付を止めてトークンを消す。 */
  stopReportEvent(code: string): Promise<void>;
  /** 期限を過ぎた受付のトークンを消して止める (運営のログインのトークンも)。 */
  purgeReportTokens(nowMs: number): Promise<void>;
  /** 受付中 (active かつ期限内) の一覧。 */
  listActiveReportEvents(nowMs: number): Promise<ReportEventPublic[]>;
  getReportSet(code: string, setId: string): Promise<ReportSetRow | null>;
  /** prevVersion が null なら行が無いときだけ足す。数なら version がその値のときだけ置き換える (row.version は新しい値)。書けたら true */
  casReportSet(row: ReportSetRow, prevVersion: number | null): Promise<boolean>;
  listReportSets(code: string): Promise<ReportSetRow[]>;
  /** その人が選手の行 (受付中の code のどれか)。 */
  listReportSetsForUser(userId: string, codes: string[]): Promise<ReportSetRow[]>;
  /** 1 行足して id を返す。 */
  insertReportSubmission(row: ReportSubmissionRow): Promise<number>;
  setReportSubmissionOutcome(id: number, outcome: string): Promise<void>;
  /** その試合の報告 (id 順)。 */
  listReportSubmissions(code: string, setId: string): Promise<ReportSubmissionRow[]>;
  /** 報告を別の試合に移す (運営が指定した試合 m<id> → 見つかった start.gg の試合、側の入れ替えつき)。 */
  updateReportSubmission(id: number, setId: string, side: number, result: string): Promise<void>;
  deleteReportSet(code: string, setId: string): Promise<void>;
  getReportHealth(kind: string): Promise<ReportHealthRow | null>;
  putReportHealth(row: ReportHealthRow): Promise<void>;
  /** 障害中に試す役を取る (probe_ms が gapMs より前なら now にして true)。 */
  claimReportProbe(kind: string, nowMs: number, gapMs: number): Promise<boolean>;
  getReportSnapshot(code: string): Promise<ReportSnapshotRow | null>;
  /** 写しの中身を読まずに、写した時刻・1 周目が終わったか・試合の数だけ (選手の画面の 15 秒ごとの読みで毎回 0.5 MB を読まないように) */
  getReportSnapshotMeta(code: string): Promise<{ synced_ms: number; full: boolean; sets: number } | null>;
  /** 写しを書く (data と synced_ms。lock は外す)。meta = 中身を開かずに読む値 (圧縮した写し、0022) */
  putReportSnapshot(code: string, data: string, syncedMs: number, meta?: { full: boolean; sets: number }): Promise<void>;
  /** 写す・取り込む役を取る (lock_ms が holdMs より前なら now にして true、行が無ければ作る)。 */
  claimReportSnapshot(code: string, nowMs: number, holdMs: number): Promise<boolean>;
  releaseReportSnapshot(code: string): Promise<void>;
  insertReportManual(row: ReportManualRow): Promise<number>;
  getReportManual(code: string, id: number): Promise<ReportManualRow | null>;
  /** その受付の指定した試合 (新しい順、取り消したものも)。 */
  listReportManual(code: string): Promise<ReportManualRow[]>;
  updateReportManual(code: string, id: number, status: string, setId: string, nowMs: number): Promise<void>;
  /** その人が選手の、指定した試合 (open だけ)。 */
  listReportManualForUser(userId: string, code: string): Promise<ReportManualRow[]>;
  /** 総当たりで選んだ相手 (report_picks)。setId = '' なら消す */
  putReportPick(code: string, userId: string, setId: string, nowMs: number): Promise<void>;
  deleteReportPicksForSet(code: string, setId: string): Promise<void>;
  listReportPicks(code: string, sinceMs: number): Promise<{ user_id: string; set_id: string; ts_ms: number }[]>;
  insertReportDq(row: ReportDqRow): Promise<number>;
  /** その受付の DQ (新しい順) */
  listReportDqs(code: string): Promise<ReportDqRow[]>;
  updateReportDq(code: string, id: number, status: string, doneSets: string, note: string, nowMs: number): Promise<void>;
  getReportNoshow(code: string, setId: string, userId: string): Promise<ReportNoshowRow | null>;
  /** 無ければ足す・あれば last_ms と count を進める (notifiedMs が null なら通知の時刻は変えない) */
  upsertReportNoshow(row: ReportNoshowRow, notifiedMs: number | null): Promise<void>;
  listReportNoshows(code: string, sinceMs: number): Promise<ReportNoshowRow[]>;
  /** その試合の記録を全部 resolved に (結果が出た・DQ にした・運営が対応した) */
  resolveReportNoshows(code: string, setId: string, note: string, userId: string | null): Promise<void>;
  /** 「対戦開始」(最初の 1 回だけ入る。入ったら true) */
  insertReportStart(code: string, setId: string, users: string, userId: string, nowMs: number, info?: string): Promise<boolean>;
  getReportStart(code: string, setId: string): Promise<ReportStartRow | null>;
  /** その受付の対戦開始 (sinceMs 以降) */
  listReportStarts(code: string, sinceMs: number): Promise<ReportStartRow[]>;
  setReportStartSync(code: string, setId: string, sgg: number, note: string, triedMs: number): Promise<void>;
  /** 運営が指定した試合 (m<id>) の対戦開始を、見つかった start.gg の試合に移す */
  moveReportStart(code: string, fromSetId: string, toSetId: string): Promise<void>;
  /** その人が選手の「対戦開始」「見つからない」(sinceMs 以降) */
  listReportStartsForUser(code: string, userId: string, sinceMs: number): Promise<ReportStartRow[]>;
  listReportNoshowsForUser(code: string, userId: string, sinceMs: number): Promise<ReportNoshowRow[]>;
  /** その人が sinceMs 以降に送った数と、最後に送った時刻。 */
  reportSubmissionActivity(userId: string, sinceMs: number): Promise<{ count: number; latestMs: number | null }>;
}
