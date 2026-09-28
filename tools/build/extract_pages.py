#!/usr/bin/env python3
"""tools/build/extract_pages.py — ページのインライン <script> と共通モジュールの <script src> を src/pages/<id>.js に出す (2026-09-14 の一回限りの移行)。

  python3 tools/build/extract_pages.py [--dry-run]

各ページについて:
  - 共通モジュールの <script src="…"> (region/config.js・i18n/*.js・region/i18n.js のデータ script と、http の CDN は除く) を
    src/pages/<id>.js の先頭に import '…' として並べる (= 以前の読み込み順)
  - ページ固有のインライン <script> (type 無し。ld+json と MathJax 設定は除く) の中身をその後ろに置く
  - HTML からはそれらを消し、最初のインライン script があった位置 (無ければ最後に消した共通 script の位置) に
    <script src="<root>assets/<id>.js"></script> を置く
ビルド (tools/build/build_site.mjs) が src/pages/<id>.js の import の順に各ファイルを esbuild で変換して結合し dist/assets/<id>.js を書く。
"""
import re, sys, pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
SITE = ROOT / 'site'
DRY = '--dry-run' in sys.argv
PAGES = {'index.html': 'index', 'c/index.html': 'c_index', 'c/ranking.html': 'c_ranking', 'local/index.html': 'local_index', 'local/ranking.html': 'local_ranking',
         'pref/index.html': 'pref_index', 'pref/ranking.html': 'pref_ranking', 'events/index.html': 'events', 'news/index.html': 'news', 'p/index.html': 'p',
         't/index.html': 't', 'sim/index.html': 'sim', 'priority/index.html': 'priority', 'seed/index.html': 'seed', 'seed-upload/index.html': 'seed_upload',
         'bracket/index.html': 'bracket', 'vote.html': 'vote', 'post.html': 'post', 'callback.html': 'callback', 'overview.html': 'overview',
         'details.html': 'details', 'math.html': 'math', 'eval.html': 'eval'}
DATA_SCRIPT = re.compile(r'(^|/)(region/config\.js|i18n/[a-z]{2}\.js|region/i18n\.js)$')
TAG = re.compile(r'[ \t]*<script([^>]*)>(.*?)</script>[ \t]*\n?', re.S)

for rel, pid in PAGES.items():
    path = SITE / rel
    html = path.read_text()
    page_dir = rel.rsplit('/', 1)[0] if '/' in rel else ''
    up = '../' * (page_dir.count('/') + 1) if page_dir else ''
    imports, blocks, spans = [], [], []
    for m in TAG.finditer(html):
        attrs, body = m.group(1), m.group(2)
        src = re.search(r'src="([^"]+)"', attrs)
        if src:
            s = src.group(1)
            if s.startswith('http') or DATA_SCRIPT.search(s): continue
            target = (SITE / page_dir / s).resolve() if page_dir else (SITE / s).resolve()
            assert target.exists(), (rel, s)
            imports.append(f"import '../../site/{target.relative_to(SITE).as_posix()}';")
            spans.append((m.start(), m.end(), 'src'))
        else:
            if 'application/ld+json' in attrs or 'type=' in attrs: continue
            if 'MathJax' in body and len(body.strip().split('\n')) < 12: continue   # MathJax の設定はインラインのまま (CDN より前に要る)
            if not body.strip(): spans.append((m.start(), m.end(), 'inline')); continue
            blocks.append(body)
            spans.append((m.start(), m.end(), 'inline'))
    if not spans: print(f'{rel}: nothing'); continue
    # 置き場: 最初のインライン (中身のある) script の位置、無ければ最後に消した共通 script の位置
    inline_spans = [s for s in spans if s[2] == 'inline']
    anchor = inline_spans[0] if inline_spans else spans[-1]
    tag_line = f'<script src="{up}assets/{pid}.js"></script>\n'
    out, pos = [], 0
    for s in sorted(spans):
        out.append(html[pos:s[0]])
        if s == anchor:
            indent = re.search(r'([ \t]*)$', html[pos:s[0]]).group(1) if False else ''
            out.append(tag_line)
        pos = s[1]
    out.append(html[pos:])
    new_html = ''.join(out)
    header = (f"// src/pages/{pid}.js — site/{rel} のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。\n"
              f"// import の並び = 読み込み順 (共通モジュールはグローバルを定義する古典 script。tools/build/build_site.mjs が順に結合して dist/assets/{pid}.js にする)。\n")
    body = '\n'.join(imports) + ('\n\n' + '\n\n'.join(b.strip('\n') + '\n' for b in blocks) if blocks else '\n')
    print(f'{rel}: {len(imports)} imports, {len(blocks)} inline blocks ({sum(b.count(chr(10)) for b in blocks)} lines) → src/pages/{pid}.js')
    if not DRY:
        (ROOT / 'src' / 'pages').mkdir(parents=True, exist_ok=True)
        (ROOT / 'src' / 'pages' / f'{pid}.js').write_text(header + body)
        path.write_text(new_html)
