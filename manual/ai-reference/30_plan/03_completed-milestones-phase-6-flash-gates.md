# フラッシュ効果種別と発揮前提の回帰修正

2026-09-10。報告スナップショット `orica-snapshot-2026-09-10T11-12-41-045Z.json` の公開盤面とカード本文を確認。

- R01 手札召喚の `activationLabel:none` は誤り。見出し付きフラッシュとして X01/M03 両方の発揮前提を受ける。
- CX01〜CX04 のバレットエディット入替は `activationLabel:none`。実行窓をフラッシュ効果種別として数えない。
- 既存 GE テストにも誤った `none` の期待値があったため訂正。実カードを組み合わせ、両者の役割交換、両ゲートの単独/併用、拒否、CX4枚のスピリット/魂状態での入替を16件で回帰化。
- 拒否時に手札起動カードが `in_use` に残る共通処理の漏れも修正。使用の事実は残し、効果を発揮せずトラッシュへ置く（[03d](../10_rules/03d_effect-target-and-prerequisite-gates.md) / [01](../10_rules/01_glossary-and-card-types.md)）。
- ルール根拠と召喚許可の適用範囲は [03c](../10_rules/03c_effect-text-interpretation.md)、調査痕跡は [source-findings-custom](../00_meta/source-findings-custom.md)。Active Board の更新はなし。
- 検証: `bsge01-flash-effect-category.test.ts`、既存GE/発揮前提テスト、`scenario-flash-effect-category.spec.ts` のAlice GUI/Bob REST 4件、`pnpm check` / `pnpm codex:finish-check`。`finish-check:full` は既存R01の発揮履歴期待値1件で停止したため、その訂正後に全Vitestを再実行。
