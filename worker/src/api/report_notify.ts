/**
 * 結果報告の運営への通知 (Web Push、2026-11-01、docs/self_report_design.md)。
 *   受付の設定 notify: off = 送らない / action = 運営の対応が要るとき (食い違い・確認・承認待ち) / all = 選手の報告のたび。
 *   送り先 = その受付の運営 (report_events.admins) が「この端末で通知を受け取る」で登録した端末 (report_push_subs)。
 *   本文は { title, body, url, tag }。url は報告ページ (site/report/sw.js の範囲) からの相対。tag が同じ通知は端末で置き換わる (同じ試合の続報)。
 * 送れなくても報告は止めない (呼ぶ側は結果を見ない)。送り先が 404/410 なら購読を消す。
 */
import type { Config } from '../config.ts';
import type { FetchFn } from './oauth.ts';
import type { ReportEventRow, Store } from '../store.ts';
import type { Decision, NSet, Result } from './report_logic.ts';
import { parseSettings, score } from './report_logic.ts';
import { sendPush } from './webpush.ts';

export const PUSH_SUBS_PER_USER = 5;

const admins = (ev: ReportEventRow): string[] => ev.admins.split(',').map((s) => s.trim()).filter(Boolean);

/** 運営の対応が要る状態か */
export function needsAction(state: string, note: string): boolean {
  return state === 'conflict' || state === 'review' || (state === 'pending' && note === 'wait_admin');
}

/** 通知の文 */
export function noticeText(ev: ReportEventRow, set: NSet, d: Pick<Decision, 'state' | 'note'>, result: Result | null): { title: string; body: string } {
  const n0 = set.slots[0] ? set.slots[0].name : '?';
  const n1 = set.slots[1] ? set.slots[1].name : '?';
  let res = '';
  if (result) {
    const [a, b] = score(result);
    res = result.w === 0 ? `${n0} ${a}-${b} ${n1}` : `${n1} ${b}-${a} ${n0}`;
  }
  const head = d.state === 'conflict' ? '食い違い'
    : d.state === 'review' ? '運営の確認が必要'
    : d.state === 'pending' && d.note === 'wait_admin' ? '承認待ち'
    : d.state === 'pending' && d.note === 'wait_delay' ? '報告 (5 分後に反映)'
    : d.state === 'pending' && d.note === 'wait_both' ? '報告 (相手の報告待ち)'
    : '報告';
  return { title: `${head}: ${n0} vs ${n1}`, body: [res, ev.name].filter(Boolean).join('\n') };
}

/** 選手の報告の後に呼ぶ。送った端末の数を返す */
export async function notifyReport(cfg: Config, store: Store, fetchFn: FetchFn, ev: ReportEventRow, set: NSet, d: Pick<Decision, 'state' | 'note'>,
  result: Result | null): Promise<number> {
  const level = parseSettings(ev.settings).notify || 'off';
  if (level === 'off' || !cfg.vapid) return 0;
  if (level === 'action' && !needsAction(d.state, d.note)) return 0;
  const subs = await store.listReportPushSubs(admins(ev));
  if (!subs.length) return 0;
  const t = noticeText(ev, set, d, result);
  const payload = JSON.stringify({ ...t, url: './?c=' + encodeURIComponent(ev.code) + '&admin=1', tag: 'rp-' + ev.code + '-' + set.id });
  return sendAll(cfg, store, fetchFn, subs, payload, needsAction(d.state, d.note) ? 'high' : 'normal');
}

/** 試しに送る (運営の画面の「テスト通知」) */
export async function notifyTest(cfg: Config, store: Store, fetchFn: FetchFn, userId: string, code: string): Promise<number> {
  if (!cfg.vapid) return 0;
  const subs = await store.listReportPushSubs([userId]);
  const payload = JSON.stringify({ title: 'SPSP 結果報告', body: 'テスト通知です。この端末で通知を受け取れます。', url: './?c=' + encodeURIComponent(code) + '&admin=1', tag: 'rp-test' });
  return sendAll(cfg, store, fetchFn, subs, payload, 'normal');
}

async function sendAll(cfg: Config, store: Store, fetchFn: FetchFn, subs: { endpoint: string; p256dh: string; auth: string }[], payload: string,
  urgency: 'normal' | 'high'): Promise<number> {
  const vapid = cfg.vapid;
  if (!vapid) return 0;
  const rs = await Promise.all(subs.map(async (s) => {
    const r = await sendPush(fetchFn, s, payload, vapid, { ttl: 6 * 3600, urgency }).catch(() => ({ ok: false as const, status: 0, gone: false, note: 'throw' }));
    if (!r.ok && r.gone) await store.deleteReportPushSub(s.endpoint, null).catch(() => undefined);
    return r.ok ? 1 : 0;
  }));
  return rs.reduce((a: number, b: number) => a + b, 0);
}
