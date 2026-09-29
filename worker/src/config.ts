/**
 * 設定値 (gas/config.gs の移植)。
 *
 * 秘匿値 (client secret / 署名鍵) はコードに書かない。Worker の secret
 * (`wrangler secret put`) から env 経由で読む (INV-3)。
 * 値そのものはログにもレスポンスにも出さない。
 */

/** Worker の env (wrangler.toml の [vars] / secrets / bindings)。 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  // [vars]
  STARTGG_CLIENT_ID?: string;
  REDIRECT_URI?: string;
  DATA_ORIGIN?: string;
  SITE_PREFIX?: string;
  TS_OFFSET?: string;
  SESSION_TTL_MS?: string;
  STATE_TTL_MS?: string;
  /** 投票の資格判定を免除するテスト用 uid (カンマ区切り)。免除された投票は status='debug' で保存し、集計しない。 */
  VOTE_TESTER_UIDS?: string;
  // secrets
  STARTGG_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  EXPORT_KEY?: string;
}

/** developer.start.gg/docs/oauth/ の記載どおり。authorize 側は api. が付かない点に注意。 */
export const TOKEN_URL = 'https://api.start.gg/oauth/access_token';
export const GQL_URL = 'https://api.start.gg/gql/alpha';

/** 認可リクエストと token 交換で同じ値を送る必要がある。 */
export const SCOPE = 'user.identity';

/** 本文の長さ (UTF-16 code unit 数。クライアントの textarea maxlength と同じ数え方)。 */
export const BODY_MIN = 1;
export const BODY_MAX = 1000;

/** スパム制御。 */
export const RATE_MIN_INTERVAL_MS = 60 * 1000; // 同一ユーザーの連投間隔
export const RATE_MAX_PER_DAY = 10;            // 同一ユーザーの当日投稿数

/** プレイヤーカードの設定 (action card_put)。編集画面の「適用」を何度か押す程度は通す。 */
export const CARD_RATE_MIN_INTERVAL_MS = 10 * 1000; // 同一ユーザーの書き込み間隔 (1 分に 6 回まで)
export const CARD_RATE_MAX_PER_DAY = 100;           // 同一ユーザーの当日書き込み数
export const CARD_TEMPLATES = ['standard'];          // テンプレートが増えたらここも増やす
export const CARD_COLORS = ['red', 'blue', 'green', 'purple', 'orange'];
export const CARD_ACH_MAX = 12;                      // 載せる実績の数
export const CARD_ACH_KEY_MAX = 300;                 // 実績の key 1 つの長さ (文字数)

/** errors テーブル。無制限に伸ばさない。超えたら古い行から間引く。 */
export const ERRORS_MAX_ROWS = 3000;
export const ERRORS_TRIM_TO = 2000;
export const ERRLOG_NOTE_MAX = 200;

/**
 * ダブルメイン圏の判定閾値。players/<uid>.json の characters[].pct (使用率, 0..1) で、
 * トップとの差がこの値以内のキャラが 2 体以上いれば「どちらがメインか僅差」とみなす。
 * クライアント (site/js/post_config.js) / ビルド (spsp/char_vote.py) と同じ値にすること。
 */
export const DOUBLE_MAIN_PCT_GAP = 0.20;

/**
 * エクスポート鍵を STARTGG_CLIENT_SECRET から導出するときのラベル。
 * ビルド側 (spsp/cli/fetch_char_votes.py) が同じラベルで同じ値を導出する。
 */
export const EXPORT_KEY_LABEL = 'spsp:export_votes:v1';

/** セッショントークンの有効期間の既定 (180 日)。 */
export const SESSION_TTL_MS_DEFAULT = 180 * 24 * 3600 * 1000;
/** 署名付き state の有効期間の既定 (5 分)。 */
export const STATE_TTL_MS_DEFAULT = 5 * 60 * 1000;

/** クライアントから受け付けるエラー種別。ここに無いものは記録しない (詰め込み防止)。 */
export const CLIENT_ERROR_KINDS: Record<string, 1> = {
  account_mismatch: 1,   // 選んだ選手と認証アカウントが違う (最頻)
  oauth_denied: 1,       // start.gg 側で許可しなかった
  oauth_error: 1,        // start.gg が error= を返した
  state_missing: 1,      // 照合情報がブラウザに残っていない
  state_mismatch: 1,     // 照合に失敗
  no_code: 1,            // code/state が返ってこなかった
  login_failed: 1,       // login が失敗 (server 側にも残るが経路確認用)
  network: 1,            // fetch 自体が失敗
};

/** ハンドラが使う設定 (env から組み立てる。テストでは直接作る)。 */
export interface Config {
  clientId: string;
  redirectUri: string;
  /** 未設定なら undefined。使う直前に requireSecret() で例外にする。 */
  clientSecret?: string;
  sessionSecret?: string;
  exportKey?: string;
  sessionTtlMs: number;
  stateTtlMs: number;
  /** タイムスタンプの固定オフセット (分)。JST = 540。 */
  tsOffsetMin: number;
  /** 資格判定を免除するテスト用 uid (VOTE_TESTER_UIDS)。 */
  voteTesterUids?: string[];
}

function intOr(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : dflt;
}

/** "+09:00" → 540。読めなければ JST。 */
export function parseOffset(s: string | undefined): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return 540;
  const min = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -min : min;
}

export function configFromEnv(env: Env): Config {
  return {
    clientId: String(env.STARTGG_CLIENT_ID || '582'),
    redirectUri: String(env.REDIRECT_URI || ''),
    clientSecret: env.STARTGG_CLIENT_SECRET || undefined,
    sessionSecret: env.SESSION_SECRET || undefined,
    exportKey: env.EXPORT_KEY || undefined,
    sessionTtlMs: intOr(env.SESSION_TTL_MS, SESSION_TTL_MS_DEFAULT),
    stateTtlMs: intOr(env.STATE_TTL_MS, STATE_TTL_MS_DEFAULT),
    tsOffsetMin: parseOffset(env.TS_OFFSET),
    voteTesterUids: String(env.VOTE_TESTER_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/**
 * secret を取得する。未設定なら例外 (呼び出し側が internal で返す)。
 * GAS の requireProp_ に対応。値そのものはログにもレスポンスにも出さない。
 */
export function requireSecret(value: string | undefined, name: string): string {
  if (!value) throw new Error('secret not set: ' + name);
  return value;
}

/** client_id のプレースホルダ置き換え漏れを弾く (GAS の requireClientId_)。 */
export function requireClientId(cfg: Config): string {
  if (!cfg.clientId || cfg.clientId.indexOf('{{') === 0) {
    throw new Error('STARTGG_CLIENT_ID is not configured');
  }
  return cfg.clientId;
}
