# link-inbox に保存（Chrome拡張）

PCのChromeで見ているページやリンクを、このリポジトリの `inbox/` に保存する拡張です。
保存形式は iPhone の Scriptable と同じ（`inbox/<UUID>.json`）なので、Confluence のリンク集を開けばそのまま自動で取り込まれます。

## できること

- **ツールバーのボタン / `Alt+Shift+L`**：保存画面を開く。タイトル（og:title）・URL・画像候補（og:image・twitter:image・ページ内の大きい画像）・選択中の文字（メモ）を自動で入れます。タグは最近使ったものから選べます。`Ctrl+Enter` で保存。
- **右クリック**：「このページを link-inbox に保存」「このリンクを link-inbox に保存」で、画面を開かずに保存。ボタンに ✓（保存）／…（保留）／!（失敗）が出ます。
- **送れなかったときは保留**：オフラインなどで送れなかったものは拡張の中に保留し、次に保存したとき・Chromeを起動したとき・30分ごとに自動で再送します。ボタンの赤い数字が保留中の件数です。
- **画像**：保存画面で画像を選ぶとそれを使います。「自動」のままなら、GitHub Actions（`add-thumbnail.yml`）がページから探して付けます。

## インストール

1. このフォルダ（`chrome-extension`）をPCに置きます（リポジトリをダウンロードするか、`link-inbox-chrome-extension.zip` を展開）。
2. Chrome で `chrome://extensions` を開き、右上の「デベロッパーモード」をオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選びます。
4. 設定画面が開くので、トークンを入れて「接続テスト」→「保存」。

トークンは GitHub → Settings → Developer settings → Fine-grained tokens で作ります。

- Repository access：**link-inbox だけ**
- Permissions：**Contents: Read and write**
- iPhone の Scriptable 用とは別のトークンにしておくと、片方だけ取り消せます。

トークンはこのPCの拡張の保存領域（`chrome.storage.local`）にだけ保存され、Chromeの同期には乗りません。

## 権限

| 権限 | 使い道 |
|---|---|
| `activeTab` / `scripting` | ボタンや右クリックを押したタブだけ、タイトルや画像を読む（常時すべてのサイトを読む権限は持ちません） |
| `storage` | 設定・保留中のリンク・最近のタグ |
| `contextMenus` | 右クリックメニュー |
| `alarms` | 保留分の定期再送（30分ごと） |
| `https://api.github.com/*` | GitHub への保存 |

## ファイル

| ファイル | 中身 |
|---|---|
| `manifest.json` | 拡張の定義（Manifest V3） |
| `lib.js` | 保存処理（GitHub API への書き込み、保留キュー、ページ情報の読み取り） |
| `background.js` | 右クリックメニュー、保留分の自動再送 |
| `popup.html` / `popup.js` | 保存画面 |
| `options.html` / `options.js` | 設定画面（リポジトリ・トークン・接続テスト） |
| `style.css` | 見た目（Confluence のリンク集と同じ BIZ UDPゴシック／インディゴ） |
