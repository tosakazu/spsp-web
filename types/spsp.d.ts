// types/spsp.d.ts — サイト共通のグローバル (window.SPSP …) の型。共通モジュールは古典 script でグローバルを定義するので、
// ここで宣言しておくと `// @ts-check` を付けたファイルから型が付く。ビルド出力 (JSON) の型は contracts/ から生成する予定 (§4.7)。
export {};

declare global {
  interface SpspSiteConfig {
    region: string;
    langs: string[];
    defaultLang: string;
    timeZone: string;
    utcOffset: string;
    dataRoot: string;
    canonical: { origin: string; base: string };
    regions: Record<string, string>;
    analytics: { gaId: string };
    support: { contact: string };
    /** キャラ投票: testerUids = 資格判定を免除するテスト用 uid (免除分は集計しない) */
    vote?: { testerUids?: string[] };
    /** ページ間リンクの拡張子を落とす (js/html.js pageHref)。Cloudflare 配信のビルドが true にする */
    cleanUrls?: boolean;
    /** 配信元 (canonical.origin) → start.gg OAuth アプリ。API / redirect は canonical から組む (js/post_config.js)。無い配信元は従来値 */
    auth: Record<string, { clientId: string }>;
    features: { blog: boolean; vote: boolean; seeding: boolean; prefRanking: boolean; sim: boolean };
    geo: { unitKey: string };
    calendar: { weekendRealLabel: boolean };
  }
  /** 言語別の値 ({ ja: '…', en: '…' })。SPSPI18n.pick() で表示言語のものを取る */
  type SpspLangText = Record<string, string>;
  /** data/geo.json (地理単位のカタログ。定義元は smash_database scripts/<地域>/geo.py、契約 = docs/geo_json.md) */
  interface SpspGeoUnit { id: string; order: number; name: SpspLangText; group: string }
  interface SpspGeoGroup { id: string; name: SpspLangText; units: string[] }
  interface SpspGeoSeedGroup { id: string; name: SpspLangText; units: string[]; default: boolean }
  interface SpspGeoCatalog {
    region: string;
    unit: string;
    provisional: boolean;
    names: SpspLangText;
    units: SpspGeoUnit[];
    groups: SpspGeoGroup[];
    seed_groups: SpspGeoSeedGroup[];
  }
  interface SpspI18n {
    t(key: string, params?: Record<string, unknown>): string;
    has(key: string): boolean;
    apply(root?: ParentNode): void;
    setText(el: Element, text: string): void;
    fmtNumber(n: number): string;
    pick<T>(obj: Record<string, T> | null | undefined): T | undefined;
    lang: string;
  }
  interface SpspLinks {
    SELF: object;
    playerHref(prefix: string | object, uid: number | string): string;
    discOf(uid: number | string): string | null;
    uidOfDisc(disc: string): number | null;
    loadDiscriminators(prefix?: string | object): Promise<Record<string, string>>;
    upgradePlayerLinks(root: ParentNode): number;
    tournamentHref(prefix: string, eid: number | string): string;
    charRankingHref(prefix: string, charId: number | string): string;
    prefRankingHref(prefix: string, pref: string): string;
    seriesRankingHref(prefix: string, name: string): string;
    seriesKey(name: string): string;
    a(href: string, text: string, attrs?: string): string;
    playerLink(prefix: string | object, uid: number | string, text: string, attrs?: string): string;
    tournamentLink(prefix: string, eid: number | string, text: string, attrs?: string): string;
  }
  interface SpspNamespace {
    site?: SpspSiteConfig;
    root?: string;       // サイトのルートへの相対パス (js/html.js が決める)。assets/ など
    langRoot?: string;   // ページ木のルートへの相対パス
    pageHref: (rel: string) => string;   // ページ間リンクの形 (js/html.js。config.cleanUrls なら拡張子を落とす)
    data?: string;       // JSON の置き場: config.dataRoot (別ホスト、末尾 /) があればそれ、無ければ root (js/html.js の getter)
    i18n?: SpspI18n;
    Links?: SpspLinks;
    [key: string]: unknown;
  }
  interface Window {
    SPSP: SpspNamespace;
    SPSPI18n: SpspI18n;
    SPSPLinks: SpspLinks;
    SPSP_I18N: Record<string, Record<string, string>>;
    SPSP_I18N_REGION: Record<string, Record<string, Record<string, string>>>;
    escapeHtml(s: unknown): string;
    // nav.js が置くもの (GA4 と お知らせ)
    __SPSP_GA_LOADED?: boolean;
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
    SPSPTrackPage: (title?: string, virtualPath?: string) => void;
    SPSPNews: { refreshUnreadBadge(): void };
    // share.js
    SPSPShare: SpspShare;
    html2canvas: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;   // CDN から遅延読み込み
    // seeding/app/10_skeleton.js が読む (ページ側 src/pages/seed.js が置く)
    SEED_APP_CONFIG?: { mode: 'spsp' | 'csv' };
    // sim/calc.js (スコアシミュレーションの計算コア。src/pages/sim.js が置く)
    SPSPCalc: typeof import('../site/sim/calc.js').default;
  }
  // share.js (共有ボタン / 画像で保存)
  interface SpspShareData { title?: string; text?: string; url?: string }
  interface SpspShare {
    setup(btn: Element | null, getData: SpspShareData | (() => SpspShareData)): void;
    share(getData: SpspShareData | (() => SpspShareData)): Promise<void>;
    copyToClipboard(text: string): Promise<boolean>;
    ensureHtml2Canvas(): Promise<unknown>;
    capturePng(target: HTMLElement): Promise<Blob | null>;
    safeFileName(s: string | null | undefined, fallback?: string): string;
    setupSaveButton(btn: Element | null, capture: () => Promise<Blob | null>, fileName: () => string): void;
  }
  var SPSP: SpspNamespace;
  var SPSPI18n: SpspI18n;
  var SPSPLinks: SpspLinks;
  function escapeHtml(s: unknown): string;

  // ── ランキング一覧 (latest_tjpr_full.jsonl の 1 行、meta.json) ── src/pages/* が読む。ranking-table.js が _display_rank 等を足す
  interface SpspRankRecord {
    user_id: number;
    display: string;
    ranks?: { ensemble?: number | null; tjpr?: number | null; bt_gated?: number | null; global_ensemble?: number | null; global_tjpr?: number | null; global_bt_gated?: number | null; [k: string]: number | null | undefined };
    scores?: {
      tjpr_score?: number; tjpr_elo?: number; tjpr_level?: number; bt_gated_elo?: number; bt_internal_elo?: number;
      ensemble_avg_rank?: number | null; ensemble_avg_score?: number | null; bt_internal_d_last?: number;
      shared_cascade_lv?: number; shared_cascade_ens_r?: number; [k: string]: number | null | undefined;
    };
    metadata?: { tour_count_3y?: number; bt_weekday_included?: boolean; provisional?: boolean; [k: string]: unknown };
    top_tours?: { series: string; num: number; place: number; nent: number; event_id: number }[];
    unranked?: boolean;
    /** メインキャラ (start.gg character id)。フロントが char_emoji.json で絵文字を引く (js/char_emoji.js)。ビルドが出すまでは無い */
    main_char_id?: number | null;
    /** メインキャラ絵文字 (ビルドが埋め込む旧形式。旧サイト用、main_char_id が無いときの代わり) */
    main_char_emoji?: string | null;
    _display_rank?: Record<string, number>;
    _is_overseas?: boolean;
    _is_gray?: boolean;
    [k: string]: unknown;
  }
  interface SpspRankMeta {
    eval_date?: string;
    n_tournaments_total?: number;
    n_tournaments_small?: number;
    min_entrants_for_ranking?: number;
    n_players?: number;
    lookback_days?: number;
    jjpr_lookback_days?: number;
    snapshot_days?: number[];
    snapshot_dates?: string[];
    [k: string]: unknown;
  }

  /** data/character_index.json (使い手一覧 / 使い手ランキングが読む) */
  interface SpspCharacterIndexChar { id: number; name: string; n_main: number; [k: string]: any }
  interface SpspCharacterIndex {
    characters: SpspCharacterIndexChar[];
    /** キャラ id (文字列) → メインにしている選手の uid (全国順位の昇順) */
    main_by_char: Record<string, number[]>;
    [k: string]: unknown;
  }

  /** data/series.json の 1 件 (ローカル大会シリーズ。local/ 一覧とローカルランキングが読む) */
  interface SpspSeriesSummary {
    name: string;
    first_date?: string;
    last_date: string;
    tour_count: number;
    avg_entrants: number;
    participant_count: number;
    /** ローカルランキングの母集団 (uid、参加回数、初参加日、最終参加日) */
    participants?: { uid: number; n: number; first: string; last: string }[];
    is_uchi?: boolean;
    is_special_rules?: boolean;
    restricted?: boolean;
    is_all_small?: boolean;
    [k: string]: any;
  }

  // ── CDN から読む外部ライブラリ (p/ のチャート) ── 最小限の型。オプションは any
  interface ChartInstance {
    destroy(): void;
    update(mode?: string): void;
    resize(): void;
    data: any;
    options: any;
    canvas: HTMLCanvasElement;
    [k: string]: any;
  }
  interface ChartStatic {
    new (ctx: HTMLCanvasElement | CanvasRenderingContext2D | string, config: any): ChartInstance;
    defaults: any;
    register(...items: any[]): void;
    [k: string]: any;
  }
  var Chart: ChartStatic;
  interface Window {
    /** luxon (Chart.js の時間軸アダプタが使う。p/ が既定ゾーンを JST にする) */
    luxon?: { Settings: { defaultZone: string; [k: string]: any }; [k: string]: any };
  }
}

// ── シードツール (site/seeding/app/*.js) が共有する記録の形。状態そのものは app/00_state.js の S (各ファイルが import) ──
declare global {
  /** 手動調整 (app/30_core.js)。base = 基準の並び (uid)、ops = 移動の履歴、hpos = undo 位置、sel = 選択中の uid。
   *  lockSel / lockKind は固定バー (📌) の編集中の状態 (app/40_startgg.js, app/90_spec.js) */
  interface SpspSeedManual {
    base: number[];
    ops: { uid: number; to: number }[];
    hpos: number;
    committed: boolean;
    editing: boolean;
    sel: number | null;
    src?: string | null;
    lockSel?: number | null;
    lockKind?: string | null;
  }
  /** 固定 (📌) の 1 件: 新形式 {kind, target}。旧形式 (localStorage に残っている) は 'pool' | 'wave' の文字列 (対象なし = 移動しない)。
   *  文字列側を交差型にしてあるのは、読む側が `l.kind || l` / `l.target` と書けるように (文字列では undefined になる) */
  type SpspSeedLock = { kind: 'pool' | 'wave'; target: number } | (('pool' | 'wave') & { kind?: undefined; target?: undefined });
  /** シード指定・固定 (app/90_spec.js)。キーは uid (文字列化)。locks は「固定を解除」で delete される */
  interface SpspSeedSpec {
    label: string | null;
    pins: Record<string, number>;
    waves: Record<string, number>;
    locks?: Record<string, SpspSeedLock>;
  }
  /** start.gg の phaseGroups から読んだウェーブ情報 (app/85_waves.js)。取得に失敗したときは error だけを持つ */
  interface SpspSeedWaves {
    poolCount?: number;
    waveCount?: number;
    poolToWave?: number[];
    letters?: string[];
    identifiers?: string[];
    error?: string;
  }
  /** フェーズ連鎖の 1 段 (app/40_startgg.js buildPhasesConfig → bracket/ プレビューの初期構成) */
  interface SpspSeedPhaseConfig { name: string; pools: number; adv?: number }
  /** 取得した event (app/40_startgg.js)。phase 未作成なら phaseId / bracketType / poolCount / waves は null */
  interface SpspSeedEventContext {
    phaseId: number | string | null;
    eventName: string;
    eventId: number | string;
    tournamentName: string;
    bracketType: string | null;
    poolCount: number | null;
    waves: SpspSeedWaves | null;
    phasesConfig?: SpspSeedPhaseConfig[] | null;
  }
  /** csv モードの基準順位ソース (app/80_csv_source.js)。rows = seed_uploader.js parseCsv の行 (列名 → 値) */
  interface SpspSeedCsvSource { rows: Record<string, string>[]; label: string }
  /** 被り回避の適用前の状態 (app/75_series_rematch.js。取り消しで戻す) */
  interface SpspSeedPreOpt { order: number[]; manual: SpspSeedManual | null }
  /** 被り回避の各ラウンドのステップ統計 (app/75_series_rematch.js) */
  interface SpspSeedOptRoundStat { round: number; iters: number; maxIters: number }
  /** 被り回避の結果 (seed_worker.js → app/75_series_rematch.js finishSeedOptimize)。report の中身は seed_optimizer.js が決める */
  interface SpspSeedOptResult {
    seedOrder: number[];
    stoppedEarly?: boolean;
    report: { improvementPct: number; [k: string]: any };
    unsupported?: boolean;
    reason?: string;
    [k: string]: any;
  }
  /** 参加者の 1 行 (app/30_core.js DATA)。ランキングの記録に start.gg の seed 情報が付く。detail 展開で tournaments 等も入る */
  interface SpspSeedRecord extends SpspRankRecord {
    seedId?: string | number | null;
    entrantId?: string | number | null;
    originalSeed?: number;
    discriminator?: string | null;
    scores?: Record<string, any>;
    tournaments?: any[];
    history?: any[];
    recent_matches?: any[];
  }
  /** data/upcoming.json (app/60_upcoming.js の今後の大会ピッカー) */
  interface SpspUpcomingEvent { event_slug: string; event_name?: string; name?: string; num_entrants?: number; numEntrants?: number }
  interface SpspUpcomingTournament {
    tournament_slug: string;
    tournament_name: string;
    start_at: number;
    city?: string | null;
    is_online?: boolean;
    events?: SpspUpcomingEvent[];
  }
  interface SpspUpcomingData { tournaments: SpspUpcomingTournament[] }
}
