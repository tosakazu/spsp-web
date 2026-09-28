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
}
