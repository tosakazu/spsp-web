# フロントエンドの技術スタック検討 (2026-09-14)

いまの `site/` は「HTML にインラインの script と style、共通部は素の JS を `<script>` の並び順で読む、ビルド無し、型無し」という
作りで、共通化とリファクタ (docs/refactor/05_frontend_common.md) で整理はしたものの、土台はナイーブなまま。
ここでは制約を確認したうえで、選択肢を比べ、段階的に移る案を出す。**決めるのはユーザー** (§6)。

## 1. 現状の棚卸し (数字は refactor/frontend、2026-09-14)

| | 量 | 問題 |
|---|---|---|
| HTML 23 ページ、10,600 行 | うちインライン `<script>` 5,200 行、インライン `<style>` 2,300 行 | 選手ページは 1 ファイル 2,450 行。ページのロジックが HTML の中にあり、テストは文字列で切り出して動かしている |
| JS 44 ファイル、13,900 行 | `window.SPSPXxx` のグローバルで繋ぐ IIFE。読み込み順の契約を `tests/meta/script_order.test.cjs` で守っている | import/export が無いので依存が暗黙。bundler が無いのでファイルを分けるほど HTTP 要求が増える (シードツールは 12 本) |
| 型 | 無し | ビルド出力 (JSON) の形の変更がフロントで黙って壊れる。§4.7 の契約変更 (ID 化) を安全にやる手段が無い |
| i18n | 実行時に辞書を引く (`data-i18n` + `i18n()`) | 静的な文は HTML に日本語を書いて実行時に差し替えるので、言語別の静的 HTML (SEO / SNS カード / hreflang) が作れない |
| 地域 | `site/regions/<R>/` + symlink | head (canonical / OG / JSON-LD) は静的で日本版固定 (§4.5 の stamp が未実装) |
| CSS | 共通 4 枚 + ページの `<style>` | スコープ無し。cascade の順に依存 |
| データ | トップページが `latest_tjpr_full.jsonl` 13.5 MB を読む | スタックの問題ではないが、移行のときに直すべき最大の UX 問題 |
| テスト | node:test 48 ファイル 11,800 行 + jsdom のスナップショット harness | 本番ホストにブラウザが無いので jsdom で代用している。実ブラウザの見た目は見ていない |

## 2. 変えられない制約

- **静的配信**: spsp.games (ConoHa WING、PHP の front controller で `/jp/` `/na/` を配信) と gh-pages。サーバー側の実行環境は無い (SSR 不可)。
- **データは Python の nightly が作る**: JSON を配信ディレクトリの中に書く。フロントのビルドとは別。形の契約 (§4.7) をどう守るかが要点。
- **ConoHa の CPU 制限** (1 プロセス約 300 秒)。フロントのビルドを本番ホストで回すなら軽いものに限る。GitHub Actions なら制約なし。
- **北米チームとの共同開発**: 彼らが読める・直せる「普通の」構成であることに価値がある (TypeScript + 一般的なツール)。
- **「site/ を編集した瞬間に本番」** は、ビルドを挟むと「push → CI → 配信 (数分)」に変わる。これは手放す前提で考える (プレビューは `/b/` で今までどおり)。

## 3. 選択肢

| 案 | 内容 | 得るもの | 失うもの / コスト |
|---|---|---|---|
| A. 現状 + JSDoc 型 | `tsc --checkJs` で JSDoc の型を検査するだけ。ビルド無し | 型の恩恵の 6 割を無コストで。今日から入れられる | 依存の暗黙さ・インラインの量は変わらない |
| B. TypeScript + Vite (MPA、フレームワーク無し) | `src/` に TS + ES modules、ページごとに entry、Vite が `dist/` に束ねる。DOM の書き方は今のまま | 型・import・bundling・tree shaking・ソースマップ。読み込み順の契約が消える。テストは Vitest | ビルド工程が要る。HTML の shell は依然手書き |
| C. B + 静的サイト生成 (Astro) | ページの shell (head / nav / 言語別の静的文 / 地域の canonical) を Astro がビルド時に生成。ブログは Markdown。動的部分は今の TS | **言語別・地域別の静的 HTML** が作れる (SEO / SNS / hreflang)。§4.5 の stamp と静的 i18n が設計から消える。ブログ執筆が楽 | Astro の学習。ビルドは CI で |
| D. C + 島 (Preact または Solid) | 状態が複雑な部分 (ランキング表の展開・並べ替え、選手ページ、シードツール) だけコンポーネントに | 再描画の一貫性、部品の再利用、テストのしやすさ | ライブラリ 1 つ増える。全部を書き直さない規律が要る |
| E. React / Next 等の SPA | 全体をアプリに | 汎用性 | この規模と静的配信には過剰。SSR 無しで SEO を落とす。ユーザーの直感どおり不向き |

**React について**: 全体 SPA (E) は不向き。ただし「島」として使う React 互換の小さいもの (Preact、4 KB) は選択肢に入る。
React そのもの (40 KB + ランタイム) を入れる理由は無い。JSX が嫌なら Lit (Web Components) や Solid でも同じ役割ができる。

## 4. 推奨

**C を目標にし、A → B → C → D の順で段階的に移る。** 一度に書き直さない。各段階で今の jsdom スナップショット比較 (表示不変) が使える。

```
spsp-site/
  src/
    lib/            共通 TS (format, links, i18n, player_data, ranking_table …)   ← 今の site/js を移す
    pages/          ページごとの TS (index.ts, p.ts, t.ts …)                     ← 今のインライン script を移す
    components/     (D) 島。Preact + signals
    styles/         CSS (Vite の CSS Modules でスコープ)
  i18n/{ja,en}.json 辞書 (静的な文はビルド時に、動的な文は実行時に引く。キーは 1 つ)
  regions/{JP,NA}/  config・上書き・CSS (いまと同じ契約)
  contracts/        ビルド出力の JSON Schema (§4.7 の契約をここで宣言。Python はこれで検証、TS は型を生成)
  pages/ (Astro)    shell。言語 × 地域 で静的 HTML を生成 (/jp/, /na/, hreflang)
  dist/             生成物 = 配信ルート。Python の nightly はここに JSON を書く (git には入れない)
```

- **型と契約**: `contracts/*.schema.json` を唯一の定義にし、Python 側は出力時に jsonschema で検証、TS 側は `json-schema-to-typescript` で型を生成。
  §4.7 の変更 (達成バッジの ID 化・県コード・series_id) をここに書いてから両側を直す、という順にできる。北米チームにもこれが仕様書になる。
- **i18n**: 辞書はそのまま。静的な文は Astro がビルド時に埋める (言語別 HTML)、JS が描く文は今の `i18n()` のまま。
  `?lang=` の実行時切替は残すか、言語別 URL (`/jp/en/`) に寄せるかは C の設計で決める (推奨は言語別 URL。SEO と FOUC の解消)。
- **島**: Preact + signals を第一候補。理由は小ささ、TS との相性、React の知識がそのまま使えること (北米側の採用しやすさ)。
  ランキング表 (8,500 行) は仮想スクロールにするので、細粒度更新が速い Solid も候補。**まず B までを終えてから決める**。
- **テスト**: Vitest (jsdom) に移す (今の node:test をほぼそのまま動かせる)。CI (GitHub Actions) では Playwright で実ブラウザのスクリーンショット比較を追加し、
  jsdom の harness は移行中の「表示不変」検査として残す。
- **ビルドと配信**: GitHub Actions が `dist/` を作って `deploy` ブランチに push。WING は `deploy` ブランチの checkout を配信 (cron で数分ごとに `git pull`、
  nightly の JSON はその checkout に書く)。gh-pages は今のとおりサーバーの nightly が rsync。本番ホストでは Node を回さない。
- **やらないこと**: Tailwind 等の CSS フレームワーク (既存のデザインを保つ)、全体 SPA、サーバー側レンダリング。

## 5. 段階と目安

| 段階 | 内容 | 表示 | 目安 |
|---|---|---|---|
| A. 型検査 | `jsconfig.json` + `tsc --checkJs --noEmit`、主要モジュールに JSDoc 型。ビルド出力の型を `contracts/` から生成して当てる | 不変 | 小 (日単位) |
| B. TS + Vite | インライン script を `src/pages/*.ts` に出し、`site/js/*` を `src/lib/*.ts` に。`import` に置き換えて読み込み順の契約を廃止。Vitest | 不変 (スナップショットで確認) | 中 (週単位)。ページ単位で進められる |
| C. Astro | shell と head を Astro に。言語 × 地域の静的生成。ブログを Markdown に。head stamp (§4.5) は不要になる | 不変 → 言語別 URL を足す | 中 |
| D. 島 | ランキング表・選手ページ・シードツールを Preact に。仮想スクロール。トップの 13.5 MB を分割 | 変わる (改善) | 大。B/C の後 |

B は今の refactor/frontend の延長で、共通化した `site/js/*` がそのまま `src/lib/*` になる。②で辞書化した文言もそのまま使える。
A は今日入れられる (ビルド無し) ので、B の前に型で契約を固めるのに使う。

## 6. 決めてほしいこと

1. 目標を C (Astro) にするか、B (Vite MPA、shell は手書き) で止めるか。
2. 島のライブラリ: Preact / Solid / 入れない。B の後で決めてもよい。
3. 言語は実行時切替 (`?lang=`) のままか、言語別 URL (`/jp/en/`) にするか (C で決まる)。
4. 配信: `deploy` ブランチを WING が pull する方式でよいか (「編集 = 即本番」を手放す)。
5. 着手順: A から始めてよいか (refactor/frontend の上で、表示不変のまま)。
