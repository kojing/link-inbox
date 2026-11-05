# リンク集 for Confluence（一覧ページ側） v3.1

Confluence（Server / Data Center）のページに埋め込むリンク集です。
プログラムはページに**添付したJS**、各ページの**HTMLマクロ**には設定と読み込みだけを書く構成です。

```
Confluence
├─ 部品ページ（例:「リンク集の部品」）
│    添付: link-collector.js / link-collector-quick-add.js
├─ 本体ページ（一覧）     HTMLマクロ = link-collector.embed.html
└─ 追加用ページ（ポップアップ） HTMLマクロ = link-collector-quick-add.embed.html
```

| ファイル | 役割 |
|---|---|
| `link-collector.js` | 本体（一覧・検索・タグ・追加/編集/削除・インポート/エクスポート・ブックマークレット・iPhone自動取込）。部品ページに添付 |
| `link-collector.embed.html` | 本体ページのHTMLマクロに貼る（設定＋JSの読み込み） |
| `link-collector-quick-add.js` | ブックマークレットから開く追加専用画面。部品ページに添付 |
| `link-collector-quick-add.embed.html` | 追加用ページのHTMLマクロに貼る |
| `tests/` | 保存処理と取込処理のテスト（`node tests/store.test.js` / `node tests/relay.test.js`） |

## Confluenceでの組み立て

1. **部品ページを作る**
   見られても困らない場所にページを1つ作り（例:「リンク集の部品」）、`link-collector.js` と `link-collector-quick-add.js` を添付します。ページIDを控えます。
2. **JSが読めるか確認する**
   ブラウザで `https://(Confluence)/download/attachments/(部品ページID)/link-collector.js` を開き、プログラムの中身が表示されればOKです。
   Confluence が `/confluence` などのパスの下にある場合は、そのパスも含めます。
3. **本体ページを作る**
   `link-collector.embed.html` の中身を本体ページのHTMLマクロに貼り、次を書き換えます。
   - `src` の `ASSET_PAGE_ID` → 部品ページのID
   - `OWNER_USERNAME` → 自分のConfluenceユーザー名（この人だけ編集ボタンが出ます）
   - `QUICK_ADD_PAGE_URL` → 手順4の追加用ページのURL（使わなければ空のまま）
   - `DISABLED_SPACES` など → 閲覧専用にしたいスペースがあれば
4. **追加用ページを作る**（ブックマークレットを使う場合）
   `link-collector-quick-add.embed.html` を別ページのHTMLマクロに貼り、`ASSET_PAGE_ID`・`TARGETS`（追加先＝本体ページのID）・`OWNER_USERNAME` を書き換えます。
5. **本人で本体ページを開く**
   旧形式（1つのContent Propertyに全件）のデータがあれば、ここで16分割に移行されます（「保存形式を16分割に移行しました」と表示）。
6. **iPhoneからの自動取込を設定する**
   本体の「iPhoneから取込」で、ユーザー名 `kojing`・リポジトリ `link-inbox`・ブランチ `main` を入れ、「ページを開いたときに自動で取り込む」にチェックして「保存して取り込む」。
   **link-inbox は公開リポジトリなので「公開リポジトリ（トークン不要）」にチェックすれば、トークンは要りません。** 非公開に戻した場合は、Contents: Read-only のトークンを入れてください（このブラウザのlocalStorageに保存されます）。

## JSを更新するとき

1. 部品ページで、同じファイル名のまま添付を上書きします。
2. 各ページの埋め込みHTMLの `?v=3.1.0` を新しい番号に変えます（ブラウザが古いJSを使い続けないように）。
3. 本体とポップアップは必ず同じバージョンにそろえます（保存形式を共有しているため）。`tests/store.test.js` は両者の保存処理が一致しているかも確認します。

## データの保存先

ページの Content Property に保存します。

- `link-collector-data` … 索引（タグ一覧・iPhone取込の進み具合＝前回取り込んだコミット）
- `link-collector-data-00`〜`-15` … リンク本体（16分割・1個30,000バイトまで。全体で約480KB、目安1,500〜2,000件）

## iPhone取込の流れ

1. iPhoneの Scriptable（`../scriptable/お気に入りに追加.js`）が `inbox/<UUID>.json` を1件ずつ保存
2. GitHub Actions（`../.github/workflows/add-thumbnail.yml`）がページの og:image などを探して `thumbnailUrl` を追記
3. 本体ページを開くと、前回のコミットからの差分だけを取り込む（新着なしなら通信1回）。後から付いた画像も反映し、Confluenceで削除したリンクは復活しない

## 注意

- 編集ボタンの出し分けは表示上の制御です。ページの編集権限そのものは Confluence 側で絞ってください。
- 管理者の設定で添付ファイルが「ダウンロード扱い」で返される環境では、`<script src>` で読み込めないことがあります。その場合マクロの場所に「スクリプトを読み込めませんでした」と表示されます。
- フォントは BIZ UDPゴシック（Google Fonts）。使えない環境では Windows 標準の BIZ UDPゴシック／ヒラギノで表示されます。
