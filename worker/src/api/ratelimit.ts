/** 連投判定 (gas/sheet.gs checkRateLimitOn_ の移植)。 */
import { RATE_MAX_PER_DAY, RATE_MIN_INTERVAL_MS } from '../config.ts';
import type { RateGuard, RecentActivity, Store } from '../store.ts';

export const MSG_INTERVAL = '投稿の間隔が短すぎます。1分ほど待ってからやり直してください。';
export const MSG_DAILY = '本日の投稿数の上限 (' + RATE_MAX_PER_DAY + '件) に達しました。';

/**
 * 直近の様子から制限メッセージを返す。問題なければ null。
 * 連投判定は最新行とだけ比べ、当日上限は当日の行数で見る (GAS と同じ)。
 */
export function rateLimitMessage(act: RecentActivity, nowMs: number): string | null {
  if (act.latestMs !== null && nowMs - act.latestMs < RATE_MIN_INTERVAL_MS) return MSG_INTERVAL;
  if (act.todayCount >= RATE_MAX_PER_DAY) return MSG_DAILY;
  return null;
}

export function guardFor(userId: string, nowMs: number, dayKey: string): RateGuard {
  return { userId, nowMs, minIntervalMs: RATE_MIN_INTERVAL_MS, dayKey, maxPerDay: RATE_MAX_PER_DAY };
}

export async function checkRateLimit(store: Store, table: 'votes' | 'posts', userId: string, nowMs: number, dayKey: string): Promise<string | null> {
  return rateLimitMessage(await store.recentActivity(table, userId, dayKey), nowMs);
}
