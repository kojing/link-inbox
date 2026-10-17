# link-inbox

iPhoneの共有シート（Scriptable）から保存したリンクの受信箱です。
Confluenceのリンク収集ツールの「iPhoneから取込」で読み込みます。

保存先: inbox/<UUID>.json（1リンク1ファイル）
書き込み: このリポジトリ専用のFine-grained token（Contents: Read and write）のみ
