# BSTH08.5-R12の継続無料化

対象: Telegram `followup-730a92e3c9985c592931`（受付 `629905126`、添付なし）。公開mainへの統合と依頼解消は親runnerが確認する。

カード本文「このカードが手元に置かれたターンの間」に従い、面霊【アクセル】の無料化開始と継続適用を分離する。
根拠は[アクセル裁定](../10_rules/08b_accel-change-zero-counter.md)、[継続性と同名制限](../10_rules/03e_effect-duration-and-repeat-scope.md)、`needs-ruling.jsonl` の2026-10-29ユーザー確認。

`cost_override` CEの `usageLimitConsumed` は付与の開始だけを記録し、付与が有効な間は再消費しない。
取得時に各CEの使用制限を共通判定し、宣言時も現行CEを取得して開始する。通常支払いは開始しない。
カード名による専用分岐やDSL変更は加えず、既存の手元・配置ターン・面霊・アクセル条件を維持する。

受入経路:

- `bsth08-5-r12-accel-tribe-cost-override.test.ts`: 実C20の2枚連続解決、各回コア不減・4枚オープン破棄・手元移動、開始記録1回。
- 同回帰: 通常支払いは未使用、保存復元と再構築、同名別個体・翌ターン再入場の拒否、面霊以外・通常召喚・相手側の除外。
- `scenario-r12-accel-continuation.spec.ts`: Alice GUIで2回の無料/通常表示と無料選択、Bob RESTで2回の無料宣言。実効果の解決後のコア・デッキ・手元・使用記録を照合する。
- GUIはローカルscenarioと本番room投影関数の範囲。実JWTネットワークroom・配備・強さ実証・ISMCTS運用移行とは区別する。

単体確認は最終finishの代替にしない。最終gate・独立査読・検証付きcommit後に条件別受入を登録して親へ統合要求し、公開確認まではpendingを保持する。
