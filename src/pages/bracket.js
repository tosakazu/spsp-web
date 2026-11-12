// @ts-check
// src/pages/bracket.js — site/bracket/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/bracket.js にする。
import './bracket_login_return.js';
// ↑ ログインから戻ったときに #d=… を付け直す (bracket_app.js が読む前に)
import '../../site/js/html.js';
import '../../site/js/i18n.js';
import '../../site/js/data.js';
import '../../site/js/views.js';
import '../../site/js/player_data.js';
import '../../site/seeding/seed_optimizer.js';
import '../../site/seeding/seed_data.js';
import '../../site/seeding/seed_share.js';
import '../../site/bracket/bracket_core.js';
import '../../site/bracket/bracket_app.js';
import './bracket_sgg.js';
// ↑ 組み合わせを start.gg の構造で (共有 URL に start.gg のフェーズの id があるとき)
import './bracket_share.js';
// ↑ 短い URL (?s=)
