// types/contracts.d.ts — ビルド出力 (JSON) の型。contracts/*.schema.json と 1 対 1 (手書き。schema を変えたらここも変える。
// tests/meta/contracts.test.cjs が schema と実データ / fixture の整合を見る)。
export {};

declare global {
  /** 何の実績か (spsp_scripts spsp/score.py ↔ js/achievements.js の契約) */
  type SpspAchievementKind =
    | 'peak_rank' | 'peak_tier' | 'climb' | 'uf' | 'spr' | 'losers_run'
    | 'tours' | 'matches' | 'wins' | 'same_opp' | 'tour_series' | 'tour' | 'trend';
  type SpspBucket = 'win' | '2nd' | '3rd' | '4th' | '5th' | 'top8' | 'top16' | 'top32' | 'top64';
  type SpspClassCode = 'B' | 'C' | 'D' | 'E' | 'casual' | null;
  type SpspAchievementParams =
    | { top: 1 | 2 | 3 | 10 | 50 | 100 | 500 | 1000 }
    | { lv: 1 | 2 | 3 | 4 | 5; tier: 'crown' | 'gold' | 'silver' | 'bronze' | 'plus' | 'base' }
    | { n: number }
    | { v: number }
    | { series: string; bucket: SpspBucket; cls: SpspClassCode; count: number }
    | { name: string; bucket: SpspBucket; cls: SpspClassCode }
    | { days: 30 | 90 | 180; n: number; surge: boolean };
  interface SpspBadge {
    /** ビルドが組んだ日本語の文言 (kind が無い / 辞書に無いときの表示) */
    label: string;
    cls: '' | 'gold' | 'silver' | 'bronze' | 'blue' | 'green';
    kind?: SpspAchievementKind;
    params?: SpspAchievementParams;
  }
  interface SpspAchievement extends SpspBadge {
    priority: number;
    /** 大会の実績 (kind: tour / tour_series) だけ: もとになった大会ごとの [日付, 順位評価の素点 tjpr_raw] (集計対象外は除く)。
     *  カードの並び順 = 素点 × 0.5^(経過年数) の最大 (2026-09-30〜) */
    tjpr_pts?: [string, number][];
  }
  interface SpspDynamicBadge extends SpspBadge { kind?: 'trend' }
  interface SpspCharacterUse {
    /** start.gg character id (辞書 char.<id> のキー) */
    id: number;
    /** 日本語名 (表示の fallback) */
    name: string;
    pct?: number;
    n?: number;
    games?: number;
    total?: number;
    src?: string;
  }
  /** players/<uid>.json のうちフロントが読む部分 (contracts/player.schema.json) */
  interface SpspPlayerRecord {
    user_id: number;
    display: string;
    startgg_discriminator?: string | null;
    country?: string | null;
    country_ja?: string | null;
    achievements: SpspAchievement[];
    dynamic_badges: SpspDynamicBadge[];
    characters: SpspCharacterUse[];
    metadata?: Record<string, unknown>;
    scores?: Record<string, number>;
    radar?: Record<string, unknown>;
    tournaments?: unknown[];
    recent_matches?: unknown[];
    [k: string]: unknown;
  }
}
