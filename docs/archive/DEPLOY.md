# 投稿機能のデプロイ手順

設計は [post_feature_design.md](post_feature_design.md)。
サイト全体の配信の仕組みは [deploy_and_environments.md](deploy_and_environments.md)。

## 現在の状態 (2026-08-14)

| | |
|---|---|
| Apps Script プロジェクト | `spsp-post-api` |
| スクリプト ID | `1h5ZC3yDX3cn_BuasqYRvmrV0AE6KdugWsOOa5E1p0zPMp0bRQbqkanfV` |
| エディタ | https://script.google.com/d/1h5ZC3yDX3cn_BuasqYRvmrV0AE6KdugWsOOa5E1p0zPMp0bRQbqkanfV/edit |
| clasp ログイン | 所有者の Google アカウント (`~/.clasprc.json`) |
| `gas/.clasp.json` | 追跡外 (2026-09-07)。`gas/.clasp.json.example` をコピーして自分の scriptId を入れる。本番の scriptId は所有者のローカルにある |
| デプロイ ID | `AKfycbzipXG5iAMHR7YwV-p9RALpxlAGWJcPizpfMbxX58nSNAm_H5CNkdN-diGN1QaBVwRzNQ` |
| /exec URL | `https://script.google.com/macros/s/AKfycbzipXG5iAMHR7YwV-p9RALpxlAGWJcPizpfMbxX58nSNAm_H5CNkdN-diGN1QaBVwRzNQ/exec` |

**この URL は固定して使う。**以降の更新は `-i <デプロイID>` 付きで再デプロイすること
(`-i` 無しで `clasp deploy` すると別 URL の新しいデプロイが増える)。

## 人手作業チェックリスト

- [済] start.gg OAuth アプリ登録 (client_id = `582`、secret 取得、redirect URI 設定)
- [済] Apps Script API 有効化
- [済] `clasp login`
- [済] Apps Script プロジェクト作成 + `clasp push` + 初回 `clasp deploy`
- [済] `gas/config.gs` / `site/js/post_config.js` に `CLIENT_ID` と `GAS_ENDPOINT` を投入
- [済] client secret を `gas/secrets.gs` に用意 (git 管理外。下記参照)
- [済] エディタで `installSecrets` を実行 (スコープ承認 + secret 投入 + シート作成)
- [済] `gas/secrets.gs` を削除して `clasp push` + `clasp deploy -i`
- [済] curl で 7 ケースの応答を確認
- [済] 実アカウントでの結合確認 (2026-08-14。post の一連 + INV-6 + シート書き込み)
- [済] `export_votes` (ビルドへの投票取り込み) — 鍵は client secret から導出するので
  人手の投入は無し (下記「ビルドへの取り込み」)
- [済] キャラ投票の公開 (2026-08-14) — `vote.html` の `noindex` を外し、
  `site/nav.js` のヘッダに選手メニュー (人型アイコン) を足してリンク
- [未] 投稿 (`post.html`) の公開の判断 — `noindex` 外しとナビへのリンク追加

サーバー側は動く状態:

| | |
|---|---|
| /exec | 稼働中 (現在 @15 = login/vote/export_votes 込み)。GET は `bad_request` を返す |
| スクリプトプロパティ | `STARTGG_CLIENT_SECRET` / `SHEET_ID` とも設定済み |
| シート | `spsp posts (非公開)` = `1PsXPPT8TyU1WU2c8JmdwrvjZEtdZZSXhi33z3OzFWyE`。`shared: false` / 所有者のみ (INV-5 確認済み) |

### client secret の置き場所

| 置き場所 | 用途 |
|---|---|
| `~/spsp-secrets/startgg_oauth_client_secret` (`chmod 600`) | サーバー内の保管。**リポジトリ外**。再投入が必要になったらここから読む |
| Apps Script のスクリプトプロパティ | 実際に使われる置き場所。`oauth.gs` はここからのみ読む (INV-3) |
| ~~`gas/secrets.gs`~~ | 投入用の一時ファイル。**投入後に削除済み**。`.gitignore` 済みなので git には入っていない |

`tests/post/page.test.cjs` が、追跡対象のファイルと `site/` 配下に
secret 形状の文字列 (32 桁以上の 16 進) が無いことを検査している。

再投入が必要になったら `gas/secrets.gs` を作り直す:

```sh
cd ~/spsp-ranking && .venv/bin/python3 - <<'PY'
import pathlib
sec = pathlib.Path.home().joinpath('spsp-secrets/startgg_oauth_client_secret').read_text().strip()
pathlib.Path('gas/secrets.gs').write_text(
    "function installSecrets() {\n"
    "  PropertiesService.getScriptProperties()\n"
    "    .setProperty('STARTGG_CLIENT_SECRET', '%s');\n"
    "  setupCheck();\n}\n" % sec, encoding='utf-8')
PY
cd gas && clasp push --force     # → エディタで installSecrets 実行 → rm secrets.gs && clasp push
```

## clasp コマンド (v3.3.0)

設計書に書かれていた v2 系のコマンド名は v3 で変わっている。実際に使うのは以下。

```sh
cd ~/spsp-ranking/gas

clasp push                     # ローカル → Apps Script (HEAD のみ)
clasp deploy -i AKfycbzipXG5iAMHR7YwV-p9RALpxlAGWJcPizpfMbxX58nSNAm_H5CNkdN-diGN1QaBVwRzNQ -d "説明"
clasp list-deployments         # デプロイ一覧 (v2 の clasp deployments)
```

> **`clasp push` だけでは /exec に反映されない。** デプロイは特定の版に固定されていて、
> push が更新するのは HEAD だけ。**コードを変えたら必ず `clasp deploy -i` まで走らせる**
> (これを忘れると、直したはずの箇所が古い版のまま動き続ける。実際に
>  `{{CLIENT_ID}}` のままの版が動いていて `internal` を返していた)。
> エディタから手で関数を実行したときは HEAD が走るので、こちらは push だけで反映される。

- **`clasp create-script --type webapp` は v3 では通らない** (`Invalid container file type`)。
  `--type standalone` で作り、Web アプリ設定は `appsscript.json` の `webapp` ブロックで与える。
- `clasp create-script` は remote の `appsscript.json` を clone してローカルを
  上書きするので、作成直後は `gas/appsscript.json` を確認すること。
- 認証情報は `~/.clasprc.json` (refresh token 入り、`chmod 600`)。**コミットしない**。

## 反映のタイミング (重要)

`site/` を編集した瞬間に **spsp.games には反映されるが、GitHub Pages には反映されない**。
gh-pages は 3 時間ごとの cron でしか追随しない。

**redirect URI は GitHub Pages 固定**なので、投稿フローの結合確認は
gh-pages に載ってからでないとできない。急ぐ場合は手動デプロイ:

```sh
/bin/bash ~/spsp-ranking/deploy/nightly_cron.sh    # 約15分
```

`post.html` / `callback.html` は spsp.games にも出るが、`post.js` が
`location.origin` を見て正規配信元以外では認可を開始しない (`CANONICAL_ORIGIN`)。
`post.html` は `noindex` 付きのまま (未公開)。**公開時に
`<meta name="robots" content="noindex">` を外す** (callback.html の noindex は
公開後も外さない)。ナビ (`site/nav.js`) へのリンク追加も公開時に。
`vote.html` は 2026-08-14 に公開済み (ナビの選手メニューからリンク)。

## 動作確認 (curl)

GAS はリダイレクト経由で応答するので **`-L` 必須**。

> **`-X POST` を付けてはいけない。** `-X` はリダイレクト先にも POST を強制するため、
> `script.googleusercontent.com` 側が受け付けず Google ドライブの
> 「ページが見つかりません」HTML が返ってくる。`--data-binary` (or `-d`) だけ渡せば、
> 初回 POST → リダイレクト後 GET という GAS が期待する形になる。

```sh
EP="https://script.google.com/macros/s/AKfycbzipXG5iAMHR7YwV-p9RALpxlAGWJcPizpfMbxX58nSNAm_H5CNkdN-diGN1QaBVwRzNQ/exec"
H='Content-Type: text/plain;charset=utf-8'

# code 不正 → auth_failed
curl -sL "$EP" -H "$H" --data-binary '{"action":"post","code":"invalid","body":"テスト"}'

# body 超過 → body_invalid
curl -sL "$EP" -H "$H" \
  --data-binary "{\"action\":\"post\",\"code\":\"x\",\"body\":\"$(head -c 1100 /dev/zero | tr '\0' 'a')\"}"

# body 空 → body_invalid / code なし → bad_request / 未知 action → bad_request
curl -sL "$EP" -H "$H" --data-binary '{"action":"post","code":"x","body":"   "}'
curl -sL "$EP" -H "$H" --data-binary '{"action":"post","body":"テスト"}'
curl -sL "$EP" -H "$H" --data-binary '{"action":"nope"}'

# GET → bad_request (403 が返るならスコープ未承認)
curl -sL "$EP"
```

**2026-08-13 に上記 7 ケースすべて設計どおりの応答を確認済み。**

`internal` が返るときは大抵 **設定漏れか、デプロイが古い版のまま**。
`requireProp_` / `requireClientId_` の例外はすべて `internal` に落ちる
(secret を漏らさないため)。まず `clasp deploy -i` を打ち直し、
それでも直らなければエディタで `setupCheck` を実行してログを見る。

連投 (`rate_limited`) は実 code が要るので、実アカウントでの結合確認で見る。

### ブラウザでの確認

1. https://tosakazu.github.io/spsp/post.html で本文を入れて投稿
2. start.gg の認可画面 → 戻ってきたとき **URL に `code=` が残っていない**こと (INV-6)
3. `?posted=1` が付いた投稿ページに戻り、完了表示が出ること
4. シートに 1 行入り、`user_id` / `user_slug` が自分のものであること
5. 続けてもう一度投稿すると `rate_limited` になること (60 秒以内)
6. 戻り先の検証 (INV-7): `state` を書き換えて外部 URL を入れても
   `/spsp/index.html` に戻ること — 自動テストで担保済み (`tests/post/state.test.cjs`)

### fetch が失敗するとき

`callback.html` の CSP `connect-src` は `script.google.com` と
`script.googleusercontent.com` を許可している。GAS のデプロイ先ホストが変わった場合は
ここも直す (ブラウザのコンソールに CSP 違反として出る)。

## テスト

```sh
cd ~/spsp-ranking
NODE_PATH=/tmp/jsdom_inst/node_modules node --test tests/post/*.cjs   # 187 件
OPENBLAS_NUM_THREADS=1 .venv/bin/python3 tests/post/test_char_vote.py
```

`gas/*.gs` は Apps Script API をスタブして vm で実行しているので、
push 前にローカルで回せる。詳細は [tests/post/README.md](../tests/post/README.md)。

## ログイン + キャラ投票 (2026-08-14 追加)

- 設計: [post_feature_design.md](post_feature_design.md) §11 / §12
- 新しい action: `login` (セッショントークン発行) / `vote` (キャラ投票)
- 追加の人手作業は**無し**:
  - `SESSION_SECRET` (トークン署名鍵) はスクリプトプロパティに**初回自動生成**
  - `char_votes` シートは初回投票時に自動作成 (同じスプレッドシート内のタブ)
- 資格判定は GAS が gh-pages の公開データを読む:
  `players/<uid>.json` (404=選手でない / characters 非空=対象外) と `data/char_emoji.json`
- ページ: https://tosakazu.github.io/spsp/vote.html
  (2026-08-14 公開。ヘッダのベルの隣の人型アイコン → 「キャラ投票」)

### curl 確認 (2026-08-14 実施済み・全部設計どおり)

```sh
# login: code 不正 → auth_failed / code なし → bad_request
curl -sL "$EP" -H "$H" --data-binary '{"action":"login","code":"invalid"}'
curl -sL "$EP" -H "$H" --data-binary '{"action":"login"}'
# vote: token 無し・偽 token → auth_failed (シートは動かない)
curl -sL "$EP" -H "$H" --data-binary '{"action":"vote","charId":"1305"}'
curl -sL "$EP" -H "$H" --data-binary '{"action":"vote","token":"abc.def","charId":"1305"}'
```

資格判定 (`not_player` / `char_exists`) は実トークンが要るので、実アカウントでの
結合確認で見る (vote.html から一連で確認できる)。

## ビルドへの取り込み (2026-08-14 追加)

投票をメインキャラ判定に反映する経路。採用規則は
[post_feature_design.md](post_feature_design.md) §12。

```
char_votes シート (非公開)
  └ action="export_votes" (gas/export.gs, 鍵は client secret から導出)
      └ spsp/cli/fetch_char_votes.py  → build/data/char_votes.json
          └ spsp/char_vote.py     → char_usage の並びを補正
              └ プレイヤーページ / ランキングの絵文字 / 使い手ランキング
```

`deploy/update_and_deploy.sh` の **[2.8/5]** で取得する (V4 ビルドより前)。
取得に失敗したときは前回取得分のまま進み、ビルドログに古い `fetched_at` が出る。

### 鍵 (人手作業なし)

シートは非公開で、Web アプリは `ANYONE_ANONYMOUS`。URL さえ分かれば誰でも POST
できるので、**鍵が唯一の防壁**になる。

鍵はどこにも保存せず、**すでにある `STARTGG_CLIENT_SECRET` から導出**する:

```
key = base64url( HMAC-SHA256(key = STARTGG_CLIENT_SECRET, msg = 'spsp:export_votes:v1') )
```

- GAS 側 = `gas/export.gs exportKey_()` (ラベルは `gas/config.gs EXPORT_KEY_LABEL`)
- ビルド側 = `spsp/cli/fetch_char_votes.py derive_key()` (同名の定数)
- 一致は `tests/post/page.test.cjs` (ラベル) と両言語の固定ベクタで縛っている

新しいスクリプトプロパティを人手で入れる必要がないのが狙い。ラベルで用途を分けて
いるので導出鍵を他の用途に流用できないし、HMAC は一方向なので導出鍵が漏れても
client secret は復元できない。**client secret を差し替えたら導出鍵も変わる**ので、
そのときは GAS 側のプロパティとサーバー内のファイルを同時に更新すること
(片方だけだと `auth_failed` になる = 静かに壊れはしない)。

`STARTGG_CLIENT_SECRET` 未設定 → `internal`、鍵違い → `auth_failed`。どちらでも
行は返らない。

```sh
# コードを反映 (push だけでは /exec に出ない)
cd ~/spsp-ranking/gas && clasp push && \
  clasp deploy -i AKfycbzipXG5iAMHR7YwV-p9RALpxlAGWJcPizpfMbxX58nSNAm_H5CNkdN-diGN1QaBVwRzNQ -d "export_votes"

# 疎通確認
cd ~/spsp-ranking && .venv/bin/python3 spsp/cli/fetch_char_votes.py
```

### 返る内容

`timestamp` / `user_id` / `char_id` / `char_name` / `status` だけ。
**`user_slug` と `gamer_tag` は返さない**、`status='debug'` の行も返さない。

`since` (ISO 8601) を渡すとその時刻以降の行だけ返る。ビルドは既定でこれを使い、
手元の `build/data/char_votes.json` にマージする。全件取り直したいときは
`spsp/cli/fetch_char_votes.py --full`。シートの行数 (`total`) が前回より減っていたら
自動で全件取り直す (= 行を消したときに手元が追随する)。

### トーナメント結果予想 (未着手)

設計 TODO: [prediction_feature_todo.md](prediction_feature_todo.md)。
