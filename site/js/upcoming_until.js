// @ts-check
// upcoming_until.js — 参加予定の大会 (data/upcoming_entrants.json の events) を、いつまで「今後の大会」として出すか。
// 大会が終わるまで出す (2026-11-21。始まると消えていたが、開催中にプールや相手のキャラを見たい。2 日開催の 2 日目も)。
//   untilSec(ev)   出しておく最後の時刻 (秒)。大会の終了予定 end_at があればそこまで (短すぎる予定でも開始から MIN_SEC は出す)、
//                  無いデータ (取得が end_at を付ける前のもの) は開始から FALLBACK_SEC
//   shown(ev, nowSec)
const MIN_SEC = 3 * 3600;
const FALLBACK_SEC = 12 * 3600;

/** @param {{ start_at?: number, end_at?: number | null }} ev */
export function untilSec(ev) {
  const start = Number(ev.start_at) || 0;
  const end = Number(ev.end_at) || 0;
  return end ? Math.max(end, start + MIN_SEC) : start + FALLBACK_SEC;
}
/** @param {{ start_at?: number, end_at?: number | null }} ev @param {number} nowSec */
export const shown = (ev, nowSec) => nowSec < untilSec(ev);

export default { untilSec, shown };
