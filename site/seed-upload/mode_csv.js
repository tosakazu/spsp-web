// @ts-check
// シードアップロード (CSV) のページ設定。src/pages/seed_upload.js の最初に import する (seeding/app/10_skeleton.js が読む前に置く)。
// 以前は index.html のインライン <script> だった (CSP のため 2026-10-25 に移動)。
/** @type {any} */ (window).SEED_APP_CONFIG = { mode: 'csv' };
