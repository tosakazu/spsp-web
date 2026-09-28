// @ts-check
// src/pages/math.js — site/math.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/math.js にする。
import '../../site/js/i18n.js';
import '../../site/nav.js';
