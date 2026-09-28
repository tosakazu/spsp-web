// @ts-check
/* SPSP 共有ボタン共通ロジック.
 *
 * 使い方:
 *   <script src="../share.js"></script>
 *   SPSPShare.setup(document.getElementById('share-icon-btn'), () => ({
 *     title: '...',
 *     text:  '...',
 *     url:   location.href,
 *   }));
 *
 * 挙動:
 *   1. navigator.share あり (= HTTPS / mobile)    → ネイティブ共有シート
 *   2. なし or 失敗 → クリップボードコピー + alert
 *      (Clipboard API → execCommand('copy') の順でフォールバック)
 */
import SPSPI18n from './js/i18n.js';
const i18n = (k, p) => SPSPI18n.t(k, p);   // 文言は i18n/<lang>.js

(function () {
  'use strict';

  /** @param {string} text @returns {Promise<boolean>} */
  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  /** @param {SpspShareData | (() => SpspShareData)} getData */
  async function share(getData) {
    const data = (typeof getData === 'function') ? getData() : getData;
    const payload = {
      title: data.title || document.title,
      text:  data.text  || '',
      url:   data.url   || location.href,
    };
    if (navigator.share) {
      try { await navigator.share(payload); return; }
      catch (err) {
        if (/** @type {Error} */ (err).name === 'AbortError') return;
        // 続行: native share 失敗時は clipboard に fallback
      }
    }
    const ok = await copyToClipboard(payload.url);
    alert(ok ? i18n('share.s1') : i18n('share.copy_failed') + payload.url);
  }

  /**
   * @param {Element | null} btn
   * @param {SpspShareData | (() => SpspShareData)} getData
   */
  function setup(btn, getData) {
    if (!btn) return;
    btn.addEventListener('click', () => share(getData));
  }

  // ── 画像で保存 (html2canvas) ──
  // 以前は p/ と t/ に同じ読み込み・保存の流れがあった。
  /** @type {Promise<unknown> | null} */
  let HTML2CANVAS_LOADED = null;
  function ensureHtml2Canvas() {
    if (HTML2CANVAS_LOADED) return HTML2CANVAS_LOADED;
    HTML2CANVAS_LOADED = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    return HTML2CANVAS_LOADED;
  }

  // target 要素を PNG の Blob にする (白背景・2 倍)。html2canvas は必要なときだけ読む。
  /** @param {HTMLElement} target @returns {Promise<Blob | null>} */
  async function capturePng(target) {
    await ensureHtml2Canvas();
    const w = target.offsetWidth;
    const h = target.offsetHeight;
    const canvas = await window.html2canvas(target, {
      backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false,
      width: w, height: h,
      windowWidth: w, windowHeight: h,
    });
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  // ファイル名に使えない文字を _ に
  /** @param {string | null | undefined} s @param {string} [fallback] @returns {string} */
  function safeFileName(s, fallback) {
    return (s || fallback || 'image').replace(/[\\/:*?"<>|]/g, '_');
  }

  // 「画像で保存」ボタン: 押している間は無効化して「生成中...」、失敗は alert。
  //   capture: () => Promise<Blob>、fileName: () => string (拡張子なし)
  /**
   * @param {Element | null} btn
   * @param {() => Promise<Blob | null>} capture
   * @param {() => string} fileName
   */
  function setupSaveButton(btn, capture, fileName) {
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
      const target = /** @type {HTMLButtonElement} */ (e.target);
      target.disabled = true; target.textContent = i18n('share.s2');
      try {
        const blob = await capture();
        const url = URL.createObjectURL(/** @type {Blob} */ (blob));   // toBlob は null を返しうる (失敗時)。ここでは従来どおり投げる
        const a = document.createElement('a');
        a.href = url; a.download = `${fileName()}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        alert(i18n('share.s3') + /** @type {Error} */ (err).message);
      } finally {
        target.disabled = false; target.textContent = i18n('share.s4');
      }
    });
  }

  window.SPSPShare = { setup, share, copyToClipboard, ensureHtml2Canvas, capturePng, safeFileName, setupSaveButton };
  (window.SPSP = window.SPSP || {}).Share = window.SPSPShare;   // window.SPSP.Share (名前空間。旧名 SPSPShare も残す)
})();

export default window.SPSPShare;
export const { setup, share, copyToClipboard, ensureHtml2Canvas, capturePng, safeFileName, setupSaveButton } = window.SPSPShare;
