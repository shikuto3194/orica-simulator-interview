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
公式マニュアルは `/official-rule-manual-eternal/` を参照（通常版 `/official-rule-manual/` はポータルへ転送）。
