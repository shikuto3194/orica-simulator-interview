---
name: web-research
description: 外部ウェブから情報を取得して回答するワークフロー (web_search + web_fetch)
triggers:
  [
    ウェブリサーチ,
    webリサーチ,
    web リサーチ,
    ウェブ検索,
    web検索,
    web 検索,
    ウェブで調べ,
    ネットで調べ,
    オンラインで,
    インターネットで,
    検索して,
    ググ,
    公式サイト,
    公式FAQ,
    公式Q&A,
    最新情報,
    最新の,
    外部ソース,
    外部から,
    URLを開,
    URLを読,
    URL先,
    リンク先,
    リンクを開,
    リンクを読,
    出典,
    引用元,
    web search,
    web fetch,
    search the web,
    look it up,
    look online,
    fetch the url,
    fetch the page,
  ]
allowed-tools: [web_search, web_fetch, read_doc, lookup_card]
---

# Web リサーチ

CLAUDE.md / `manual/ai-reference/` / カードデータに書かれていない外部情報を調べるためのワークフロー。

## 基本フロー

1. **まず local を確認** — `read_doc` / `lookup_card` で既存ドキュメント / カードデータに該当情報がないか確認する。これだけで足りるならそこで終わる (外部に出ない)。
2. **検索** — 足りなければ `web_search` で関連 URL を 3〜5 件取得。クエリは具体的に（例: "バトルスピリッツ 煌臨 Q&A 公式" のように 3〜5 語）。
3. **取得** — 良さそうな URL を `web_fetch` で取得。HTML は自動でタグ除去される。1 ページが不十分なら追加で fetch する。
4. **回答** — 取得した本文を引用 (URL + 該当文の短い抜粋) + 自分の解釈を分けて提示する。

## 注意

- 当てずっぽうで URL を組み立てない (`web_fetch` に渡す URL は必ず `web_search` の結果か、ユーザーが明示した URL のいずれか)。
- 外部情報と orica-simulator 独自ルールが衝突する場合は **CLAUDE.md / 独自カードサイト Q&A が優先** (memory: `project_rule_base`, `project_flash_usage_ruling` 参照)。
- 一次ソースを優先 (公式 Q&A > 公式 FAQ > 公式カード本文 > ファン解説)。
- 取得結果に確信が持てなければ「外部情報。要裏取り」と明示する。

## 出力フォーマット

```
回答: <短い結論>

根拠:
- <URL1>: 「<引用>」
- <URL2>: 「<引用>」

メモ: <注意点 / 不確実性 / 追加調査の余地>
```
