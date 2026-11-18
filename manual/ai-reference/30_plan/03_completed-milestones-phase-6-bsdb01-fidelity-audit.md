# BSDB01 全カードDSL原文忠実度監査（2026-09-13）

依頼範囲はBSDB01の全20カード・21面。本文・OC欄とDSLの対照結果、出典、カード別修正は [全面監査表](../00_meta/source-findings-bsdb01-fidelity.md) を参照。

- 11面のOC BP加算を実効BP計算に反映。契約煌臨、単一本文の解決順、任意/強制、回数の共有単位、離場原因、非破壊の破棄、条件と期間を修正。
- 汎用DSLに複数任意stepの `usageGroupId` を追加。辞退は回数を消費せず、同じ発揮中の両stepは一度の消費で処理する。
- 解決した処理種別を本文末または `after_triggers` 境界で通知し、CX01の破壊発揮監視を実破壊件数から分離。選択再開で履歴を保持し、X01の破壊後判定より先に派生反応を解決する。
- 公開カードの `no_duplicate` を選択候補グループとして伝搬し、RESTの不正な複数選択を拒否、GUIでも重複カードを選べないようにした。
- 回帰: 新規33件に加えBSDB01既存回帰、個体制限・バーストセット・本人バトル条件・対価の回帰。GUI/APIはC03の独立任意、C05/C10の重複不可と必須取得、C02の本文統合とOC派生。
- 検証: `pnpm test` は908ファイル・11,997件成功（5ファイル・7件skip）。`pnpm codex:finish-check`、対象コードeslint、rules-core `tsc --noEmit` 成功。GUI/APIは2 spec・6件成功し、Alice/Bobの盤面スクリーンショットを確認。
- `pnpm codex:finish-check:full` も実行したが、共有ツリーの並行編集による整形差分で通し実行は未通過。最終 `format:check` の対象は本監査外のBSSL01シナリオ/テスト4ファイルと `scripts/card-text-accountability-core.mjs`。本監査の型・lint・全件テスト・GUI/APIは上記のとおり個別に検証し、並行変更はコミットから除外する。
- C06のドロー/回収にも孫悟空が必要とユーザー確認（2026-09-13）。既存DSLを維持し、不在時の回帰を追加。`needs-ruling.jsonl` と03bへ解決済み裁定を記録。未確定事項なし。
- Active Board、active issueの更新なし。
