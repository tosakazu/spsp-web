#!/usr/bin/env python3
"""tools/frontend/i18n_extract_literals.py — JS の日本語の文字列リテラルを辞書 (site/i18n/ja.js) に移す (機械的な第 1 段)。

  python3 tools/frontend/i18n_extract_literals.py --ns seed.core --file site/seeding/app/30_core.js [--dry-run]

対象: 行頭が // でない行にある、完全な '…' / "…" リテラルで、日本語を含み、
      テンプレートリテラル (` を含む行と、複数行テンプレートの中)、HTML (< >)、${、バックスラッシュを含まないもの。console.* の行は除く。
やること: リテラルを i18n('<ns>.s<N>') に置き換え、値をそのまま (1 文字も変えずに) 辞書の末尾に足す。同じ値は同じキー。
残るもの (テンプレートリテラルや HTML 入り) は手で「文全体を 1 キー + {param}」にする (docs/frontend_i18n_review.md §4.3)。
i18n() の定義はファイルごとに用意しておくこと (即時関数なら var i18n = function (k, p) { return window.SPSPI18n.t(k, p); };)。
"""
import argparse, pathlib, re, sys

JA = re.compile(r'[ぁ-んァ-ン一-龥]')
LIT = re.compile(r"""('((?:[^'\\\n])*)'|"((?:[^"\\\n])*)")""")

ap = argparse.ArgumentParser()
ap.add_argument('--ns', required=True)
ap.add_argument('--file', required=True)
ap.add_argument('--dict', default='site/i18n/ja.js')
ap.add_argument('--dry-run', action='store_true')
a = ap.parse_args()

src = pathlib.Path(a.file).read_text()
dpath = pathlib.Path(a.dict)
dsrc = dpath.read_text()
existing = dict(re.findall(r"^  '([^']+)': '((?:[^'\\]|\\.)*)',$", dsrc, re.M))
# 既存の同一値 (この ns の) は再利用
by_value = {v: k for k, v in existing.items() if k.startswith(a.ns + '.')}
n = max([int(k[len(a.ns) + 2:]) for k in existing if k.startswith(a.ns + '.s') and k[len(a.ns) + 2:].isdigit()] + [0])
added = {}
out_lines = []
changed = 0
in_tpl = False   # 複数行のテンプレートリテラルの中 (バッククォートの数で追う)
for line in src.split('\n'):
    st = line.lstrip()
    ticks = len(re.findall(r'(?<!\\)`', line))
    was_in_tpl = in_tpl
    if ticks % 2 == 1: in_tpl = not in_tpl
    if was_in_tpl or ticks or st.startswith('//') or st.startswith('*') or st.startswith('/*') or 'console.' in line or not JA.search(line):
        out_lines.append(line); continue
    def repl(m):
        global n, changed
        val = m.group(2) if m.group(2) is not None else m.group(3)
        if not JA.search(val) or '<' in val or '>' in val or '${' in val or "'" in val:
            return m.group(0)
        key = by_value.get(val)
        if key is None:
            n += 1; key = f'{a.ns}.s{n}'; by_value[val] = key; added[key] = val
        changed += 1
        return f"i18n('{key}')"
    out_lines.append(LIT.sub(repl, line))
new_src = '\n'.join(out_lines)
print(f'{a.file}: {changed} 箇所を置換、辞書に {len(added)} 件追加 ({a.ns})', file=sys.stderr)
if a.dry_run:
    for k, v in added.items(): print(f"  '{k}': '{v}',")
    sys.exit(0)
if added:
    block = f"\n  // ── {a.ns} ({a.file}) — tools/frontend/i18n_extract_literals.py で機械的に抽出 ──\n" + ''.join(f"  '{k}': '{v}',\n" for k, v in added.items())
    assert dsrc.rstrip().endswith('};')
    i = dsrc.rstrip().rfind('};')
    dsrc = dsrc[:i].rstrip('\n') + '\n' + block + '};\n'
    dpath.write_text(dsrc)
pathlib.Path(a.file).write_text(new_src)
