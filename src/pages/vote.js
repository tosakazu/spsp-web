// @ts-check
// src/pages/vote.js — site/vote.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/vote.js にする。
import '../../site/js/html.js';
import '../../site/js/i18n.js';
import '../../site/js/data.js';
import '../../site/js/player_data.js';
import '../../site/nav.js';
import '../../site/js/post_config.js';
import '../../site/js/oauth_state.js';
import '../../site/js/fighter_number.js';
import '../../site/js/auth.js';
import '../../site/js/vote.js';
