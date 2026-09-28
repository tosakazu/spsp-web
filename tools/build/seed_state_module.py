#!/usr/bin/env python3
"""tools/build/seed_state_module.py — シードツール (site/seeding/app/*.js) を ES module にする (2026-09-15 の一回限りの移行)。

以前は 12 ファイルがトップレベルの let / const / function を同じグローバル字句環境で共有していた (結合して読む前提)。
  1. 他ファイルからも使う可変の状態 (let / var) を app/00_state.js の `S` に集約し、参照を `S.NAME` に書き換える
  2. 他ファイルからも使う関数・定数に `export` を付け、使う側に `import { … } from './NN_x.js'` を足す
  3. 各ファイルが `import { S } from './00_state.js'` を持つ
文字列・コメント・テンプレートリテラル (の文字列部分) の中は書き換えない。

  python3 tools/build/seed_state_module.py            # 実行
"""
import re, json, pathlib, collections

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP = ROOT / 'site' / 'seeding' / 'app'
files = sorted(p for p in APP.glob('*.js') if p.name != '00_state.js')
src = {p.name: p.read_text() for p in files}

# ── 宣言と参照の棚卸し ──
decl = {}
for name, s in src.items():
    for m in re.finditer(r'^(const|let|var|async function|function|class)\s+([A-Za-z_$][\w$]*)', s, re.M):
        decl.setdefault(m.group(2), (name, m.group(1)))
IDENT = re.compile(r'[A-Za-z_$][\w$]*')

def walk_code(s, on_ident):
    """コードの部分だけ識別子を on_ident(name, start, end, prev_char, next_char) に渡し、置換後の文字列を返す。
    文字列・コメント・テンプレートの文字列部分は素通し。テンプレートの ${ … } はコード扱い (1 段の入れ子まで)。"""
    out = []; i = 0; n = len(s)
    state = 'code'; tpl_depth = []   # template: brace depth stack
    while i < n:
        c = s[i]; c2 = s[i:i+2]
        if state == 'code':
            if c2 == '//': j = s.find('\n', i); j = n if j < 0 else j; out.append(s[i:j]); i = j; continue
            if c2 == '/*': j = s.find('*/', i + 2); j = n if j < 0 else j + 2; out.append(s[i:j]); i = j; continue
            if c in '\'"':
                q = c; j = i + 1
                while j < n and s[j] != q:
                    if s[j] == '\\': j += 1
                    if s[j] == '\n': break
                    j += 1
                out.append(s[i:j+1]); i = j + 1; continue
            if c == '`': out.append(c); i += 1; state = 'tpl'; continue
            if c == '/' and _regex_ahead(s, i):
                j = i + 1
                while j < n and s[j] != '/':
                    if s[j] == '\\': j += 1
                    elif s[j] == '[':
                        while j < n and s[j] != ']':
                            if s[j] == '\\': j += 1
                            j += 1
                    j += 1
                out.append(s[i:j+1]); i = j + 1; continue
            if tpl_depth and c == '}':
                if tpl_depth[-1] == 0: tpl_depth.pop(); out.append(c); i += 1; state = 'tpl'; continue
                tpl_depth[-1] -= 1; out.append(c); i += 1; continue
            if tpl_depth and c == '{': tpl_depth[-1] += 1; out.append(c); i += 1; continue
            m = IDENT.match(s, i)
            if m and (i == 0 or not (s[i-1].isalnum() or s[i-1] in '_$')):
                name = m.group(0); j = m.end()
                pk = _prev_nonspace(s, i); nk = _next_nonspace(s, j)
                rep = on_ident(name, s[i-1] if i > 0 else '', pk, nk)
                out.append(rep if rep is not None else name); i = j; continue
            out.append(c); i += 1; continue
        elif state == 'tpl':
            if c == '\\': out.append(s[i:i+2]); i += 2; continue
            if c == '`': out.append(c); i += 1; state = 'code'; continue
            if c2 == '${': out.append(c2); i += 2; tpl_depth.append(0); state = 'code'; continue
            out.append(c); i += 1; continue
    return ''.join(out)

def _prev_nonspace(s, i):
    j = i - 1
    while j >= 0 and s[j] in ' \t\n': j -= 1
    if j >= 0 and s[j] == '{' and j >= 1 and s[j-1] == '$': return '${'   # テンプレートの式の始まり (オブジェクトリテラルではない)
    return s[j] if j >= 0 else ''
def _next_nonspace(s, j):
    while j < len(s) and s[j] in ' \t\n': j += 1
    return s[j] if j < len(s) else ''
def _regex_ahead(s, i):
    # '/' が正規表現リテラルの始まりか (直前が値なら除算)
    p = _prev_nonspace(s, i)
    return p == '' or p in '(,=:[!&|?{};+-*%<>~^' or s[max(0, i-6):i].endswith('return')

def uses(name, s):
    found = []
    walk_code(s, lambda nm, pc, pk, nk: found.append(nm) if nm == name and pc != '.' else None)
    return len(found)

if __name__ == '__main__':
    shared = {nm: (o, k) for nm, (o, k) in decl.items() if any(uses(nm, s) for f, s in src.items() if f != o)}
    STATE = sorted(nm for nm, (o, k) in shared.items() if k in ('let', 'var'))
    EXPORTS = collections.defaultdict(list)   # owner -> [names]
    for nm, (o, k) in shared.items():
        if k not in ('let', 'var'): EXPORTS[o].append(nm)

    # ── 1. 状態モジュール ──
    init = {}
    for nm in STATE:
        o = shared[nm][0]
        m = re.search(r'^(?:let|var)\s+' + re.escape(nm) + r'\s*=\s*(.*?);[ \t]*(//[^\n]*)?\n', src[o], re.M)
        assert m, (nm, o)
        init[nm] = (m.group(1), (m.group(2) or '').strip(), o)
        src[o] = src[o].replace(m.group(0), '', 1)
    lines = ['// seeding/app/00_state.js — シードツールの共有状態。以前は seeding/app/*.js がトップレベルの let を同じ字句環境で共有していた',
             '// (結合して読む前提)。ES module にするためここに集約した (2026-09-15)。読み書きは S.NAME。ファイル内だけで使う状態は各ファイルの let のまま。',
             'export const S = {']
    for nm in STATE:
        v, cmt, o = init[nm]
        lines.append(f'  {nm}: {v},' + (f'   {cmt}' if cmt else '') + f'   // {o}')
    lines += ['};', '']
    (APP / '00_state.js').write_text('\n'.join(lines))

    # ── 2. 参照の書き換え (S.NAME) と export / import ──
    STATE_SET = set(STATE)
    def rewrite(fname, s):
        def on_ident(nm, pc, pk, nk):
            if nm not in STATE_SET or pc == '.': return None
            if pk in '{,' and nk == ':': return None            # オブジェクトのキー
            if pk in '{,' and nk in ',}': return f'{nm}: S.{nm}'   # 省略記法の値
            return f'S.{nm}'
        s = walk_code(s, on_ident)
        for nm in EXPORTS.get(fname, []):
            s, k = re.subn(r'^(const|let|var|async function|function|class)(\s+' + re.escape(nm) + r'\b)', r'export \1\2', s, count=1, flags=re.M)
            assert k == 1, (fname, nm)
        return s
    for f in list(src): src[f] = rewrite(f, src[f])

    # import 行: 使っている他ファイルの名前 (S を含む)
    for f, s in src.items():
        needed = collections.defaultdict(list)
        for o, names in EXPORTS.items():
            if o == f: continue
            for nm in names:
                if uses(nm, s): needed[o].append(nm)
        imports = []
        if any(re.search(r'(?<![\w$.])S\.' + re.escape(nm) + r'\b', s) for nm in STATE): imports.append("import { S } from './00_state.js';")
        for o in sorted(needed): imports.append(f"import {{ {', '.join(sorted(needed[o]))} }} from './{o}';")
        if not imports: continue
        m = re.match(r'((?://[^\n]*\n)+)', s); head = m.group(1) if m else ''
        src[f] = head + '\n'.join(imports) + '\n' + s[len(head):]
    for f, s in src.items(): (APP / f).write_text(s)

    print('state:', len(STATE), '| exports:', {o: len(v) for o, v in EXPORTS.items()})
    json.dump({'state': STATE, 'exports': EXPORTS}, open('/tmp/seed_state_module.json', 'w'), ensure_ascii=False, indent=1)
