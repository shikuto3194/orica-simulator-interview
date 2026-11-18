---
name: rule-qa
description: バトルスピリッツのルール / 裁定への回答 (manual/ai-reference を読みながら)
triggers:
  [
    ルール,
    裁定,
    スタック,
    タイミング,
    フラッシュ,
    煌臨,
    転醒,
    契約,
    アクセル,
    ブレイヴ,
    合体,
    バースト,
  ]
allowed-tools: [read_doc, lookup_card, filter_cards]
---

# ルール QA

- 公式エターナル版 (Ver.17.0) + orica-simulator 独自拡張のみが対象。スタンダード版ルールは扱わない。
- 必ず `read_doc` で関連文書を確認してから回答する。
- 引用するときはパス + 該当節の要約を示す。
- 裁定の優先順位: **Q&A / 裁定 > カード本文 > errata > ユーザー確認**。
- 根拠が薄ければ「根拠不足」と明示し、確認が必要な open question を提示する。

# 参照場所

- 公式ルール: `manual/ai-reference/10_rules/`
- 設計・DSL: `manual/ai-reference/20_design/`
- GUI 仕様: `manual/ai-reference/25_gui/`
- 運用方針: `manual/ai-reference/28_policy/`
- 未確定事項: `manual/ai-reference/00_meta/open-questions.md`
- 独自カード: `manual/ai-reference/10_rules/07_custom-orica-mechanics.md`

# 出力

回答 → 根拠 (ファイルパス + 要約) → 注意点 / 未解決点。
