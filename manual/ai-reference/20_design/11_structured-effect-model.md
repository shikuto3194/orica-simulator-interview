# 構造化効果モデル — 実装ナビゲーション

カードの `textLines` を `CardDefinition.effects` などの構造化定義へ対応付け、共有の登録・解決経路で実行する。
本書は実装入口の地図であり、全カード・全経路の受入済み一覧ではない。

## 正源と現在地

- ルール上の意味: [ルール索引](../README.md) → 関連する `10_rules` と原文・Q&A。
- 定義の形: [dsl-types.ts](../../../packages/rules-core/src/dsl-types.ts) の `Effect` / `EffectStep` / `Action`、[model.ts](../../../packages/rules-core/src/model.ts) の `CardDefinition` / `Timing` / `ConditionClause`。
- 構造の解説: [DSL仕様](12_dsl-specification.md)。旧設計スナップショットは現行型の正源にしない。
- 現役作業: [ToDo](../30_plan/02_detailed-todo.md) と [issue索引](../../../issues/00_index.md)。対応率・未実装一覧は本書に複製しない。
- 完了の根拠: 対象treeで実行した回帰と、実際に確認したGUI/API経路。型や関数の存在だけでは配線・意味・受入を保証しない。

## 定義から実行まで

| 段階 | 主な入口 | 確認する関係 |
|---|---|---|
| カード定義 | [src/cards](../../../packages/card-data/src/cards/) | 面・本文行・副構造とeffectの対応 |
| 登録 | [structured-effect-registrations.ts](../../../packages/rules-core/src/effect/structured-effect-registrations.ts) | timing、対象、chooserから各種操作・誘発を生成 |
| 合法手と入力 | [legal-actions.ts](../../../packages/rules-core/src/legal/legal-actions.ts) / [legal-actions-apply.ts](../../../packages/rules-core/src/legal/legal-actions-apply.ts) | 宣言資格、対象取得、選択者、入力の検証 |
| 解決 | [effect-resolution.ts](../../../packages/rules-core/src/effect/effect-resolution.ts) | 対象effectを選んでインタプリタへ渡す |
| DSL実行 | [effect-interpreter.ts](../../../packages/rules-core/src/effect/effect-interpreter.ts) | applicability、条件、steps、connector、継続再開 |
| 共有アクション | [structured-effect-interpreter.ts](../../../packages/rules-core/src/effect/structured-effect-interpreter.ts) | インタプリタから呼ぶ共通の操作・状態変更 |
| 状態反映 | [state-based-actions.ts](../../../packages/rules-core/src/state-based-actions.ts) / [continuous-effect-rebuild.ts](../../../packages/rules-core/src/effect/continuous-effect-rebuild.ts) | 待機・離脱・再計算と派生反応 |

手書きresolverを受け取る互換経路は残るが、新しいカードの標準手順ではない。
[カード追加判断表](../28_policy/04_card-addition-decision-table.md) に従い、既存DSLと汎用経路を先に使う。

## 調査を始める場所

| 問題 | 実装と回帰の入口 |
|---|---|
| 条件の判定 | [structured-condition-eval.ts](../../../packages/rules-core/src/effect/structured-condition-eval.ts) の `evaluateCondition()` |
| 候補フィルタ | [card-filter.ts](../../../packages/rules-core/src/card/card-filter.ts) / [card-filter.test.ts](../../../packages/rules-core/test/card-filter.test.ts) |
| 数量とstep参照 | [target-resolution.ts](../../../packages/rules-core/src/effect/target-resolution.ts) / [step-execution-context.ts](../../../packages/rules-core/src/step-execution-context.ts) |
| `after_triggers` と離脱 | [after-triggers-connector.test.ts](../../../packages/rules-core/test/after-triggers-connector.test.ts) / [after-triggers-stay-flush-gap.test.ts](../../../packages/rules-core/test/after-triggers-stay-flush-gap.test.ts) |
| 条件付き再発火 | [retrigger-system.ts](../../../packages/rules-core/src/effect/retrigger-system.ts) / [retrigger-system.test.ts](../../../packages/rules-core/test/retrigger-system.test.ts) |
| 本文の帰属と誤った完了主張 | [本文台帳](12a_text-accountability-ledger.md) / [忠実度検出](../00_meta/fidelity-detection.md) |
| カード固有ギミック | [特殊メカニクスの索引](../10_rules/08_advanced-mechanics.md) → 各ルール章と実装入口 |

ここに挙げたテストは調査入口であり、今回の変更で実行すべき全テストを列挙したものではない。
型・登録・解決・GUIの変更範囲に応じて [検証運用](../00_meta/harness-validation.md) を適用する。
`sourceText` や `textRef`、登録の存在だけで、効果本文の意味を再現できたと判断しない。

## 過去の分析

旧DSL移行や当時の対応状況は [DSL移行履歴](../30_plan/03_completed-milestones-phase-6-dsl-v2.md)・[P3-14](../../../issues/archive/P3-14/index.md) とgit履歴を参照する。
旧来の頻出率・カード件数・アクション件数を現在の実装優先順には使わない。
現在のカード構造の集計は `pnpm cards:coverage`、意味的な残件は対応するfidelity出力と根拠から確認する。
