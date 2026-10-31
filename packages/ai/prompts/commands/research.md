---
name: research
description: 指定トピックを web 検索 + 取得で調べる
allowed-tools: [web_search, web_fetch, read_doc, lookup_card]
args: "調査トピック (例: '煌臨条件の最新裁定')"
---

# Skill: Web リサーチ

`{{ARGS}}` について調査し、根拠付きでまとめる。

# 進め方

1. `read_doc` / `lookup_card` で local に答えがないか先に確認する。完結するなら外部に出ない。
2. `web_search` で 3〜5 件、関連性の高そうな URL を取得 (具体的なクエリで)。
3. 上位の 1〜3 件を `web_fetch` で取得し、要点を抽出。
4. 公式 Q&A / 公式 FAQ / 一次ソース を優先。ファン解説は補助扱い。

# 出力

```
トピック: {{ARGS}}

回答: <短い結論>

根拠:
- <URL>: 「<該当箇所の短い引用>」
- <URL>: 「<該当箇所の短い引用>」

不確実性 / 追加調査:
- <or なし>
```
