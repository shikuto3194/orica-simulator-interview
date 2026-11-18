---
name: add-card
description: 新しいカード定義を提案 (textLines → Effect[] への変換補助)
allowed-tools: [lookup_card, filter_cards, read_doc, read_file]
args: "カード番号 (例: BSTH06-X12)。事前に packages/card-data/src/cards/BSTHxx.ts に textLines だけ入った骨格を置いておく前提"
---

# Skill: カード追加提案

# 手順

1. `lookup_card` で対象カードの現状の定義 (textLines のみ) を取得。
2. `filter_cards` で同じパック / 系統の既存カードを 3〜5 件取得し、Effect[] の書き方を参照する。
3. 必要なら `read_doc` で `manual/ai-reference/20_design/12_dsl-specification.md` の関連節を確認。
4. **`Effect[]` を JSON で提案する。書き込みはしない (ファイル編集はユーザーが手動で行う)**。

# 出力フォーマット

```json
{
  "cardNo": "...",
  "name": "...",
  "effects": [...],
  "notes": [
    "確信度の低い箇所",
    "ユーザー確認が必要な裁定"
  ]
}
```

# 注意

- カード本文に明示されない数量・タイミング・対象を勝手に補わない。
- 「○○のとき」「○○したとき」は `card_event` または専用 timing。
- 永続的能力 (テキストにタイミング表記がない) は `timing: { "kind": "continuous" }`。
- 値が不明な場合は `notes` に明示し、Effect は省く。

カード番号: {{ARGS}}
