#!/usr/bin/env python3
"""tools/frontend/i18n_extract_templates.py — テンプレートリテラルの中の日本語も辞書に移す (機械的な第 2 段)。

  python3 tools/frontend/i18n_extract_templates.py --ns seed.skeleton --file site/seeding/app/10_skeleton.js [--dry-run] [--min 2]

i18n_extract_literals.py (第 1 段) が飛ばしていたもの:
  - `…` テンプレートリテラルの文字列部分 (HTML のテキストノードや属性値) にある日本語の連続  → ${i18n('<ns>.tN')}
  - `…` の中の ${ … } や、バッククォートを含む行にある '…' / "…" の日本語リテラル            → i18n('<ns>.sN')
文字列・コメント・正規表現は走査で区別する (tools/build/seed_state_module.py と同じ方式)。
テキストの連続は「タグ (<…>) / ${ … } / 引用符 / 改行」で区切った塊。値は前後の空白を除いてそのまま辞書に入れる
(空白は元の位置に残す)。${ … } をまたぐ文は断片になるので、意味が通らないものは後で「文全体 1 キー + {param}」に手で直す。
同じ値は同じキー。i18n() の定義はファイルごとに用意しておくこと。
"""
import argparse, pathlib, re, sys

JA = re.compile(r'[ぁ-んァ-ン一-龥]')
ap = argparse.ArgumentParser()
ap.add_argument('--ns', required=True)
ap.add_argument('--file', required=True)
ap.add_argument('--dict', default='site/i18n/ja.js')
ap.add_argument('--dry-run', action='store_true')
ap.add_argument('--min', type=int, default=1, help='日本語がこの文字数未満の塊は移さない')
a = ap.parse_args()

src = pathlib.Path(a.file).read_text()
dpath = pathlib.Path(a.dict); dsrc = dpath.read_text()
existing = dict(re.findall(r"^  '([^']+)': '((?:[^'\\]|\\.)*)',", dsrc, re.M))
by_value = {v.replace("\\'", "'"): k for k, v in existing.items() if k.startswith(a.ns + '.')}
def next_n(prefix):
    ns = [int(k[len(prefix):]) for k in existing if k.startswith(prefix) and k[len(prefix):].isdigit()]
    return max(ns + [0])
n_t = next_n(a.ns + '.t'); n_s = next_n(a.ns + '.s')
added = {}
def key_for(val, kind):
    global n_t, n_s
    if val in by_value: return by_value[val]
    if kind == 't': n_t += 1; k = f'{a.ns}.t{n_t}'
    else: n_s += 1; k = f'{a.ns}.s{n_s}'
    by_value[val] = k; added[k] = val; return k
def esc(v): return v.replace('\\', '\\\\').replace("'", "\\'")

def ja_count(s): return len(JA.findall(s))

# ── 走査 ──
out = []; i = 0; n = len(src); changed = 0
state = 'code'; tpl_stack = []   # ${ の深さ
def take_string(q, j):
    k = j + 1
    while k < n and src[k] != q:
        if src[k] == '\\': k += 1
        if src[k] == '\n': break
        k += 1
    return k
def emit_text_segment(seg):
    """テンプレートの文字列部分 seg (${ と ` の間) を、タグ・改行・引用符で区切り、日本語の塊を ${i18n('key')} に"""
    global changed
    res = []
    for piece in re.split(r'(<[^<>]*>|\n|"|\')', seg):
        if piece is None or piece == '': continue
        if piece.startswith('<'):
            # タグの中の title / placeholder / aria-label / alt / data-help 属性の日本語 → ${i18n('key')}
            def attr(m):
                global changed
                val = m.group(2)
                if not JA.search(val) or ja_count(val) < a.min or '${' in val or '`' in val: return m.group(0)
                k = key_for(val, 't'); changed += 1
                return m.group(1) + '="${i18n(\'' + k + '\')}"'
            res.append(re.sub(r'\b(title|placeholder|aria-label|alt|data-help)="([^"${}]*)"', attr, piece)); continue
        if piece in ('\n', '"', "'"):
            res.append(piece); continue
        if not JA.search(piece) or ja_count(piece) < a.min: res.append(piece); continue
        m = re.match(r'^(\s*)(.*?)(\s*)$', piece, re.S)
        val = m.group(2)
        if '`' in val or '${' in val or '}' in val: res.append(piece); continue
        k = key_for(val, 't'); changed += 1
        res.append(m.group(1) + "${i18n('" + k + "')}" + m.group(3))
    return ''.join(res)

while i < n:
    c = src[i]; c2 = src[i:i+2]
    if state == 'code':
        if c2 == '//': j = src.find('\n', i); j = n if j < 0 else j; out.append(src[i:j]); i = j; continue
        if c2 == '/*': j = src.find('*/', i + 2); j = n if j < 0 else j + 2; out.append(src[i:j]); i = j; continue
        if c in '\'"':
            j = take_string(c, i); lit = src[i:j+1]; inner = src[i+1:j]
            # ${ } の中や、バッククォートを含む行の '…' (第 1 段が飛ばしたもの)。console.* の引数は除く
            line_start = src.rfind('\n', 0, i) + 1
            line = src[line_start:src.find('\n', i) if src.find('\n', i) >= 0 else n]
            if JA.search(inner) and ja_count(inner) >= a.min and '<' not in inner and '>' not in inner and '${' not in inner and '\\' not in inner and 'console.' not in line and (tpl_stack or '`' in line):
                k = key_for(inner, 's'); changed += 1; out.append("i18n('" + k + "')")
            else:
                out.append(lit)
            i = j + 1; continue
        if c == '`': out.append(c); i += 1; state = 'tpl'; seg_start = i; continue
        if c == '/' :
            p = src[max(0, i-1)]
            if re.match(r'[(,=:\[!&|?{};+\-*%<>~^]', p) or src[max(0, i-6):i].endswith('return'):
                j = i + 1
                while j < n and src[j] != '/' and src[j] != '\n':
                    if src[j] == '\\': j += 1
                    elif src[j] == '[':
                        while j < n and src[j] != ']':
                            if src[j] == '\\': j += 1
                            j += 1
                    j += 1
                out.append(src[i:j+1]); i = j + 1; continue
        if tpl_stack:
            if c == '}':
                if tpl_stack[-1] == 0: tpl_stack.pop(); out.append(c); i += 1; state = 'tpl'; seg_start = i; continue
                tpl_stack[-1] -= 1
            elif c == '{': tpl_stack[-1] += 1
        out.append(c); i += 1; continue
    else:   # tpl: 文字列部分
        if c == '\\': out.append(src[i:i+2]); i += 2; continue
        if c == '`':
            out.append(emit_text_segment(src[seg_start:i])); out.append(c); i += 1; state = 'code'; continue
        if c2 == '${':
            out.append(emit_text_segment(src[seg_start:i])); out.append(c2); i += 2; tpl_stack.append(0); state = 'code'; continue
        i += 1
new_src = ''.join(out)
print(f'{a.file}: {changed} 箇所を置換、辞書に {len(added)} 件追加 ({a.ns})', file=sys.stderr)
if a.dry_run:
    for k, v in added.items(): print(f"  '{k}': '{esc(v)}',")
    sys.exit(0)
if added:
    block = f"\n  // ── {a.ns} ({a.file}) — tools/frontend/i18n_extract_templates.py で機械的に抽出 (テンプレートリテラル) ──\n" + ''.join(f"  '{k}': '{esc(v)}',\n" for k, v in added.items())
    i2 = dsrc.rstrip().rfind('};')
    dpath.write_text(dsrc.rstrip()[:i2].rstrip('\n') + '\n' + block + '};\n')
pathlib.Path(a.file).write_text(new_src)
