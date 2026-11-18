# ソースへのアクセス方法

参照優先順・信頼度は [source-map.md](source-map.md) を参照。

### batspi.com アクセスルール

**batspi.com にアクセスするときは常に `cmd=read&page=` 形式を使うこと。**

```
✅ https://batspi.com/index.php?cmd=read&page=アクセル
❌ https://batspi.com/index.php?アクセル
```

理由: PukiWiki ベースのため、`cmd=read&page=` を付けないと編集画面が返り本文を取得できない。
`&word=` パラメータ付きのカード個別ページ（例: `?スピリット&word=BS53-052`）は `cmd=read` なしでも取得可能。
### 採用版と原文の参照

- [公式エターナル Ver.17.0 PDF](https://asia-en.battlespirits.com/pdf/official-rule-manual_eternal.pdf?ver.17.0=) を版固定のルール原文とする。公式のWeb版は更新される。
- 個別問答は [公式エターナル FAQ](https://www.battlespirits.com/faq/list.php?format=eternal) で検索する。製品別URLにも `format=eternal` を付ける。旧複製を使う場合は取得時点とQ番号を記録する。
- 独自裁定は [独自出典](source-findings-custom.md) を入口に、独自サイト側の `orika-react/src/qaData.js` をqa-IDで確認する。カード本文は同所の `cardData.js`、訂正は `errataData.js`。
- ローカルミラーは取得済み環境の補助。空なら公式ページや独自サイト原文に当たり、原文を取得できなかったときは未確認と記録する。監査スクリプトが読むミラーの準備は [監査入力](full-run-efficiency.md) に従う。
