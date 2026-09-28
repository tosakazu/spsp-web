// @ts-check
// src/pages/post.js — site/post.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/post.js にする。
import '../../site/js/html.js';
import '../../site/js/i18n.js';
import '../../site/js/data.js';
import '../../site/nav.js';
import '../../site/js/post_config.js';
import '../../site/js/oauth_state.js';
import '../../site/js/post.js';
