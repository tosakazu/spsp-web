// @ts-check
// src/pages/bracket.js — site/bracket/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/bracket.js にする。
import '../../site/js/html.js';
import '../../site/js/i18n.js';
import '../../site/js/data.js';
import '../../site/js/player_data.js';
import '../../site/seeding/seed_optimizer.js';
import '../../site/seeding/seed_data.js';
import '../../site/seeding/seed_share.js';
import '../../site/bracket/bracket_core.js';
import '../../site/bracket/bracket_app.js';
