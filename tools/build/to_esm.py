#!/usr/bin/env python3
"""tools/build/to_esm.py — 共通モジュール (IIFE でグローバルを定義する古典 script) を ES module にする (2026-09-15 の一回限りの移行)。

  python3 tools/build/to_esm.py site/js/links.js …

やること:
  (function (global) { 'use strict'; … global.X = api; (global.SPSP ||= {}).Y = api; if (module) module.exports = api; })(window||globalThis);
  → const global = typeof window !== 'undefined' ? window : globalThis;  … global.X = api; …  export default api; export const { a, b } = api;
グローバル (window.SPSPXxx) は移行中の互換のため残す。ページや他モジュールは import に置き換えていける。
"""
import re, sys, pathlib

def keys_of(literal):
    """オブジェクトリテラルの深さ 1 のキー (識別子) を拾う"""
    keys, depth, i, line_start = [], 0, 0, True
    buf = ''
    for ch in literal:
        if ch in '{[(': depth += 1
        elif ch in '}])': depth -= 1
        if depth == 1:
            buf += ch
    for m in re.finditer(r'(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])', buf):
        keys.append(m.group(1))
    return keys

for f in sys.argv[1:]:
    p = pathlib.Path(f); s = p.read_text()
    if re.search(r'^export ', s, re.M): print(f'{f}: already ESM'); continue
    m = re.search(r'^\(function \((global)?\) \{\n', s, re.M)
    if not m: print(f'{f}: no IIFE header'); continue
    tail = re.search(r"^\}\)\((?:typeof window[^\n]*|window)\);\n?", s, re.M)
    if not tail: print(f'{f}: no IIFE tail'); continue
    head = s[:m.start()]; body = s[m.end():tail.start()]; rest = s[tail.end():]
    body = re.sub(r"^  'use strict';\n", '', body, count=1)
    body = re.sub(r"^  if \(typeof module !== 'undefined' && module\.exports\) module\.exports = \w+;\n", '', body, flags=re.M)
    # api オブジェクト
    exports = []
    api_var = None
    mm = re.search(r'^  (?:var|const|let) (api|API) = \{', body, re.M)
    if mm:
        api_var = mm.group(1); lit = body[mm.end()-1:]
        # 対応する閉じ括弧まで
        depth = 0; end = None
        for i, ch in enumerate(lit):
            if ch == '{': depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0: end = i; break
        keys = keys_of(lit[:end+1])
    else:
        mm = re.search(r'^  global\.(\w+) = (\{|[A-Za-z_]\w*;)', body, re.M)
        if not mm: print(f'{f}: no api object'); continue
        api_var = 'global.' + mm.group(1)
        if mm.group(2) == '{':
            lit = body[mm.end()-1:]; depth = 0; end = None
            for i, ch in enumerate(lit):
                if ch == '{': depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0: end = i; break
            keys = keys_of(lit[:end+1])
        else:
            keys = []
    keys = [k for k in dict.fromkeys(keys) if k not in ('default',)]
    exp = f"\nexport default {api_var};\n"
    # モジュール scope にその名前の宣言があれば export { … }、無ければ (別名や式で入れている) export const k = api.k
    declared = [k for k in keys if re.search(r'^\s*(?:(?:async\s+)?function|const|let|var|class)\s+' + re.escape(k) + r'\b', body, re.M)]
    aliased = [k for k in keys if k not in declared]
    if declared: exp += f"export {{ {', '.join(declared)} }};\n"
    for k in aliased: exp += f"export const {k} = {api_var}.{k};\n"
    new = head + ("const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く\n" if m.group(1) else '') + body + exp + rest
    p.write_text(new)
    print(f'{f}: ESM ({len(keys)} named exports via {api_var})')
