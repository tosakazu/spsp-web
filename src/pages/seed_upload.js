// @ts-check
// src/pages/seed_upload.js — site/seed-upload/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存。seeding/app/* は ES module (共有状態は app/00_state.js の S)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/seed_upload.js にする)。
import '../../site/js/html.js';
import '../../site/js/i18n.js';
import '../../site/js/links.js';
import '../../site/js/data.js';
import '../../site/js/player_data.js';
import '../../site/js/format.js';
import '../../site/js/tags.js';
import '../../site/seed-upload/seed_uploader.js';
import '../../site/ranking-table.js';
import '../../site/player-detail.js';
import '../../site/seeding/seed_optimizer.js';
import '../../site/seeding/seed_data.js';
import '../../site/seeding/seed_share.js';
import '../../site/nav.js';
import '../../site/seeding/app/00_state.js';
import '../../site/seeding/app/10_skeleton.js';
import '../../site/seeding/app/20_help.js';
import '../../site/seeding/app/30_core.js';
import '../../site/seeding/app/40_startgg.js';
import '../../site/seeding/app/50_events.js';
import '../../site/seeding/app/60_upcoming.js';
import '../../site/seeding/app/70_players_cache.js';
import '../../site/seeding/app/75_series_rematch.js';
import '../../site/seeding/app/80_csv_source.js';
import '../../site/seeding/app/85_waves.js';
import '../../site/seeding/app/90_spec.js';
import '../../site/seeding/app/99_bootstrap.js';

