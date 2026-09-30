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

export interface Store {
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
  /** 連投条件 (user_id と action ごと) を満たすときだけ記録する。記録したら true。 */
  recordClassAction(action: string, guard: RateGuard): Promise<boolean>;
}
