# 原文忠実度監査: BSTH04.5

2026-09-13。中断前の全文監査を引き継ぎ、残存差分と未完疑義を回収した記録。
対象は 1 面。本文・条件・対象・順序・任意性・回数制限・ゾーン・持続期間を照合。

根拠: [保存原文](../../../../packages/card-data/raw/by-pack/BSTH04.5.js)、[DSL](../../../../packages/card-data/src/cards/BSTH04.5.ts)、[解釈ルール](../../10_rules/03c_effect-text-interpretation.md)、[継続・回数](../../10_rules/03e_effect-duration-and-repeat-scope.md)。信頼度 B（保存原文と既存裁定の照合）。独自の未確定裁定は推定実装しない。

| カード | 結果 | 照合・修正 |
| --- | --- | --- |
| BSTH04.5-X01 射命丸 文 | 修正 | 防止量上限、攻撃中の常時効果、手札フラッシュ限定、緑の導界者/創界神条件を修正。 |

検証: `touhou-early-fidelity-audit.test.ts` 32 ケース、上海人形の限定召喚 7 ケース。rules-core 型チェック（composite/incremental を無効にした noEmit）成功。関連回帰と全体検証の統合結果は[監査索引](README.md)に記録する。
