#!/usr/bin/env python3
"""tools/build/imports_everywhere.py — 他モジュールのグローバル (window.SPSPLinks 等) への参照を import に置き換える (2026-09-15 の一回限りの移行)。

  python3 tools/build/imports_everywhere.py [--dry-run]

site/**/*.js と src/pages/*.js で、他のモジュールが定義するグローバル名 (SPSPLinks、SeedData、escapeHtml …) を
bare / global.X / window.X のどの形で参照していても、そのモジュールからの import (default import。escapeHtml は named) に置き換える。
文字列・コメント・テンプレートの文字列部分は触らない (seed_state_module.walk_code と同じ走査)。
モジュール自身が置くグローバル (global.SPSPLinks = api) は互換の公開面として残す。
"""
import re, sys, pathlib, subprocess, collections
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from seed_state_module import walk_code

ROOT = pathlib.Path(__file__).resolve().parents[2]
DRY = '--dry-run' in sys.argv
G = {'SpspAuth': 'site/js/auth.js', 'SPSPData': 'site/js/data.js', 'FIGHTER_NUMBER': 'site/js/fighter_number.js', 'SPSPFormat': 'site/js/format.js',
     'SPSPHtml': 'site/js/html.js', 'escapeHtml': 'site/js/html.js', 'SPSPI18n': 'site/js/i18n.js', 'SPSPLinks': 'site/js/links.js',
     'SPSPListPage': 'site/js/list_page.js', 'SPSPMatch': 'site/js/match.js', 'SpspOAuthState': 'site/js/oauth_state.js', 'SPSPPager': 'site/js/pager.js',
     'SPSPPlayerData': 'site/js/player_data.js', 'SPSP_POST_CONFIG': 'site/js/post_config.js', 'SPSPRankingPage': 'site/js/ranking_page.js',
     'SPSPSuggest': 'site/js/suggest.js', 'SPSPTags': 'site/js/tags.js', 'SPSPLogo': 'site/logo.js', 'SPSPRankingTable': 'site/ranking-table.js',
     'SPSPDetail': 'site/player-detail.js', 'SPSPShare': 'site/share.js', 'SPSPTrackPage': 'site/nav.js', 'SPSPNews': 'site/nav.js',
     'SeedData': 'site/seeding/seed_data.js', 'SeedShare': 'site/seeding/seed_share.js', 'SeedOptimizer': 'site/seeding/seed_optimizer.js',
     'BracketCore': 'site/bracket/bracket_core.js', 'SmashSeed': 'site/seed-upload/seed_uploader.js', 'SPSPCalc': 'site/sim/calc.js'}
NAMED = {'escapeHtml', 'SPSPTrackPage', 'SPSPNews'}   # named export で受けるもの (それ以外は default)

files = [f for f in subprocess.check_output(['git', 'ls-files', 'site', 'src'], text=True, cwd=ROOT).split()
         if f.endswith('.js') and not f.startswith(('site/i18n', 'site/regions', 'site/blog'))]
IMPORT_RE = re.compile(r"^import\s+(?:([\w$]+)(?:,\s*\{([^}]*)\})?\s+from\s+|\{([^}]*)\}\s+from\s+)?'([^']+)';[ \t]*\n", re.M)

for f in files:
    p = ROOT / f; s = p.read_text()
    already = set()
    for m in IMPORT_RE.finditer(s):
        if m.group(1): already.add(m.group(1))
        for grp in (m.group(2), m.group(3)):
            if grp: already.update(x.strip().split(' as ')[-1] for x in grp.split(',') if x.strip())
    used = set()
    def on_ident(nm, pc, pk, nk):
        # global.X / window.X → X、bare X → X。オブジェクトのキー位置や owner 自身は触らない
        if nm not in G or G[nm] == f: return None
        if pk in '{,' and nk == ':': return None
        return nm
    # まず window.X / global.X の前置を落とす (X の直前が '.' で、その前が window/global)
    def drop_prefix(text):
        return re.sub(r'(?<![\w$.])(?:window|global|globalThis)\.(' + '|'.join(re.escape(k) for k in G) + r')\b(?!\s*=[^=])', lambda m: m.group(1) if G[m.group(1)] != f else m.group(0), text)
    # `typeof window !== 'undefined' && window.X` のような存在確認は X が import されれば常に真になるので単純化しない (動作は同じ)
    s2 = walk_code(drop_prefix(s), lambda nm, pc, pk, nk: (used.add(nm) or nm) if (nm in G and G[nm] != f and pc != '.' and not (pk in '{,' and nk == ':')) else None)
    need = sorted(n for n in used if n not in already)
    if not need and s2 == s: continue
    by_owner = collections.defaultdict(list)
    for n in need: by_owner[G[n]].append(n)
    lines = []
    for owner, names in sorted(by_owner.items()):
        rel = pathlib.PurePosixPath(owner).relative_to(pathlib.PurePosixPath(f).parent) if False else None
        import os
        relp = os.path.relpath(str(ROOT / owner), str((ROOT / f).parent)).replace(os.sep, '/')
        if not relp.startswith('.'): relp = './' + relp
        named = [n for n in names if n in NAMED]; default = [n for n in names if n not in NAMED]
        assert len(default) <= 1, (f, owner, default)
        parts = []
        if default: parts.append(default[0])
        if named: parts.append('{ ' + ', '.join(named) + ' }')
        lines.append(f"import {', '.join(parts)} from '{relp}';")
    # 既存の import の後ろ、無ければ先頭コメントの後ろに
    last = None
    for m in IMPORT_RE.finditer(s2): last = m.end()
    if last is not None:
        s3 = s2[:last] + '\n'.join(lines) + ('\n' if lines else '') + s2[last:]
    else:
        m = re.match(r'((?://[^\n]*\n)+)', s2); head = m.group(1) if m else ''
        s3 = head + '\n'.join(lines) + ('\n' if lines else '') + s2[len(head):]
    print(f'{f}: +{len(need)} imports {need}')
    if not DRY: p.write_text(s3)
