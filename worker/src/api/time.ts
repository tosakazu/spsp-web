/** 時刻の書式 (gas/sheet.gs の nowIsoJst_ / todayKeyJst_ / dayKeyOf_ の移植)。固定オフセット。 */

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** オフセット (分) → "+09:00"。 */
export function offsetString(offsetMin: number): string {
  const sign = offsetMin < 0 ? '-' : '+';
  const a = Math.abs(offsetMin);
  return sign + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
}

/** epoch ms → ISO 8601 (固定オフセット、秒精度。例 2026-08-13T23:45:01+09:00)。 */
export function formatIso(ms: number, offsetMin: number): string {
  const shifted = new Date(ms + offsetMin * 60000);
  return shifted.toISOString().slice(0, 19) + offsetString(offsetMin);
}

/** epoch ms → その時刻の日付キー (yyyy-MM-dd、固定オフセット)。 */
export function dayKey(ms: number, offsetMin: number): string {
  return new Date(ms + offsetMin * 60000).toISOString().slice(0, 10);
}

/** ISO 文字列の日付キー。解釈できなければ空文字 (gas/sheet.gs dayKeyOf_)。 */
export function dayKeyOf(ts: string): string {
  const s = String(ts);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** ISO 文字列 → epoch ms。解釈できなければ null (gas/sheet.gs parseTimestamp_)。 */
export function parseTimestamp(ts: string): number | null {
  const ms = Date.parse(String(ts));
  return Number.isNaN(ms) ? null : ms;
}
