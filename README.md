# link-inbox

iPhoneの共有シート（Scriptable）から保存したリンクの受信箱と、それを表示するConfluenceのリンク集一式です。

| 場所 | 中身 |
|---|---|
| `inbox/<UUID>.json` | 受信したリンク（1リンク1ファイル）。Confluenceの「iPhoneから取込」が読み込みます |
| `confluence/` | 一覧ページ側。Confluenceに添付するJSと、HTMLマクロに貼る埋め込みHTML。組み立て方は [confluence/README.md](confluence/README.md) |
| `scriptable/` | iPhoneの Scriptable 用スクリプト（共有シート → GitHub に保存） |
| `.github/workflows/add-thumbnail.yml` | inbox に届いたリンクのページから og:image などを探して画像URLを付ける |

書き込み: このリポジトリ専用の Fine-grained token（Contents: Read and write）のみ
