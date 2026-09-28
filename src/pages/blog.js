// @ts-check
// src/pages/blog.js — site/blog/*.html のスクリプト (ナビと GA)。以前は ../nav.js を古典 script で読んでいたが、nav.js が ES module になって
// 読めなくなっていた (2026-09-28 に修正)。tools/build/build_site.mjs が esbuild で束ねて assets/blog.js にする。
import '../../site/js/i18n.js';
import '../../site/nav.js';
