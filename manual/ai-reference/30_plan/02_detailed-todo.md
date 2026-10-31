# Detailed TODO

運用ルールは `CLAUDE.md` の **Cross-cutting Rule** を正源とする。
完了履歴は [03_completed-milestones.md](./03_completed-milestones.md) 索引から参照。

## Current Snapshot

- engine-drain 着地候補 (2026-10-30, 検証・main統合待ち): Telegram受付の既存source/target pointerをNNの個別公開token特徴へ接続。I0共有旧予約の阻害・親依頼pendingを維持。詳細は[現役タスク](ismcts-full-run/tasks.md)。
- [追加台帳](../00_meta/full-run-audit-2026-10-08-followup.md)のN11原文差は未修復。I0はE1/R1-budgetのscope失効と共有旧予約の未回収が残る。program全体会計・runtime・固定デッキ実行・校正は未達。
- **2026-10-06承認: [ISMCTS program](ismcts-full-run/README.md)は可能なら24時間の自律学習・評価・モデル更新へ**。監査残件を先に修復しI0→I6a/b/c→I7。LLM成果確認は当初120分、一人バトルは旧モデル失敗時も簡易AIへ復帰。監査0で停止しない。
- 残量 (2026-10-29): coverage todo 0 / fidelity stub 0 / needs-dsl open 0 / needs-ruling open 0 /
  `scan:ssot-candidates --gate` 0 probe (green)
- GUI: 完全化完了（P2-05 複数ブロッカー GUI 含む）
- 技術的負債: active issue は [issues/00_index.md](../../../issues/00_index.md)
- 2026-04-25 までの完了ログ raw: [archive/2026-04-25-extracted-from-02.md](./archive/2026-04-25-extracted-from-02.md)

## Active Board

| Pri | ID | 次アクション | 完了条件 | Blocker | 詳細 |
|---|---|---|---|---|---|
| P1 | H-ai-vm | I0の最大阻害を実測し、実smoke予約の全体会計・安全回収、停止/再開・使用量持越しから固定8実戦/探索校正へ進む | 24時間目標のLLM非依存学習・自動更新、簡易AI復帰、120分成果確認 | N11入力確認、I0全体会計/runtime・未回収予約・固定8実戦/校正・開始時資源条件 | [実行タスク](ismcts-full-run/tasks.md) |
| 保留 | H-deploy | 対戦APIのVM移行はユーザー指示で保留。現行PC運用を継続 | ユーザーによる移行再開 | 2026-09-23 保留指示 | [PC運用](../00_meta/local-pc-deployment.md) / [Oracle](../00_meta/oracle-deployment.md) |
| P1 | C-engine | E-5 同時誘発UI / コアステップ置換 | 該当カード追加時 | カード需要 | 複数ブロッカー Phase 1-5 済 |
| P1 | C-rebirth | A面【転醒】本文の「このとき」選択を `postRebirthChoice` へ統合 | 合体/コア配置確定後に face swap/count/転醒時誘発を確定し、B面『転醒時』と分離 | 裁定反映済 | [10_rules/08a §2](../10_rules/08a_advent-rebirth-contract.md), `RebirthAction.postRebirthChoice`, `rebirth-post-choice.ts` |
| P1 | D-card-fix | .js→.ts 変換時の欠落フィールド修正 | 都度対応 | なし | A 並行 |
| P1 | E-dsl | DSL 表現力ギャップ（P3-14 完了。新ギャップは個別 issue で再起票） | 不足遭遇時に追加 | カード需要 | [archive/P3-14](../../../issues/archive/P3-14/index.md) |
| P1 | G-guard | 機械ガード増設ループ（横方向監査）。`scan:ssot-candidates --gate` 未分類 0、probe 卒業待ち | probe が check:ssot RULES へ卒業 | fresh fidelity違反の解消後 | [guard-audit-runbook.md](./guard-audit-runbook.md) |
| P1 | F2-quartz | ✅ set-effect / CB軽減`<七>` 含め全 landed（2026-07-24〜28、[P3-16/residual-risks](../../../issues/P3-16/residual-risks.md)）。BSLH01 stub 0（2026-08-06 確認） | 次はアーツ(T07-T17)等カード追加時に個別対応 | なし | `quartz-system.ts` / 10_rules/07 §4 |

## On-demand Backlog

### Phase 1〜5: エンジン

- E-5 同時誘発効果の解決順選択 UI（エンジン側 `simultaneousGroupId` 導入済み、UI 表示改善のみ残）
- コアステップの置換効果対応
- ソウルコア複数個対応（収録弾 CB 関連）: S1/S2/S3-prep/S3 SSOT切替 完了 (2026-07-09〜14)。残 S3 残(コスト支払い個数拡張/要求充足、consumer実カード不在)〜S5 (GUI/カード変換)。詳細 [P3-101](../../../issues/P3-101_soul-core-multiple.md)

### Phase 6: データと DSL

設計リファレンス: [20_design/11_structured-effect-model.md](../20_design/11_structured-effect-model.md)。完了済みは [03_completed-milestones-phase-6.md](./03_completed-milestones-phase-6.md) 参照。

- P2-07 未対応ギミック基盤は完了。詳細: [archive/P2-07](../../../issues/archive/P2-07/index.md)
  - 転醒・契約・煌臨は P2-07 Phase A〜C、アクセル・チェンジは Phase D、ミラージュは Phase E-2、創界神は Phase F-1/F-2、導界者/導シンボルは Phase F-3、スタックは Phase H-1、黒/七色は Phase H-3 で実装済み
  - ゼロカウンター（E-1）/ 異魔神ブレイヴ（G-1）/ クォーツ（H-2）は型スカフォールド完了。実行ロジックは該当カード追加時に拡張
  - 待機状態 / 星霊衣 / 起導は一般ルールが確定したタイミングで個別 issue 化する

### Phase 7: API / UI / AI

完了済みは [03_completed-milestones-phase-7-8.md](./03_completed-milestones-phase-7-8.md) 参照。

- BGM / SE 生成（ACE-Step 1.5 REST API 連携）→ GUI 再生統合。設計: [25_gui/09_audio-asset-pipeline.md](../25_gui/09_audio-asset-pipeline.md)
- デッキ構築残: SVG/PNG エクスポート
- 効果解決キュー UI: 同時誘発効果の解決順選択（ドラッグ並び替え + 「解決」ボタン、E-5 連動）
- cost_override 分離（`fixedPayment` vs `overrideCost`）の実コスト計算分岐
- DL 対戦AI: 学習開始前ゲート（`PlayerDecision` contract + decision trace +
  `check:ssot` 漏れ検知）は
  [P3-154](../../../issues/P3-154_ai-action-input-coverage.md) で実装済。AI 観測入力 contract は
  [16_ai-observation-contract.md](../20_design/16_ai-observation-contract.md) を正源にする。
  `AiObservation` builder / encoder、学習なしの `trace-smoke` CLI、trace/replay schema validator、
  random/heuristic/MCTS の `rollout-baseline`、config loader、metrics reporter、同時アタック追加参加
  コスト源 chooser、ブレイヴ分離配分 chooser、follow-up 系 chooser、replay buffer sample/batch、
  action encoder 本体昇格、policy/value 推論 adapter、効果デバッグ用の replay 付き
  `effect-debug-harvest` draft ticket 生成と自動駆動デバッグ loop
  （`effect-debug-triage` / 1時間tick / staged clean 停止判定 / Codex Telegram inbox /
  Codex-only 再起動復帰）、最小 policy/value NN、自己対戦 dry-run、head-only actor-critic 更新、
  versioned checkpoint 保存・再開、学習済み policy を使う shadow debug loop、固定デッキ pool 接続、
  先攻/後攻バイアス診断 CLI は実装済。
  運用正源は [effect-debug-loop-runbook.md](./effect-debug-loop-runbook.md)。次は body/optimizer を含む
  固定ガントレット学習 gate、自然終局率改善、先攻/後攻バイアスの原因切り分け。
  GUI 棋譜ビューアの初期読み込み経路は実装済。

### Phase 8: テストと運用

- ルール骨格ユニットテスト、シナリオテスト、ログのゴールデンテスト、リプレイ再生テスト
- バグ修正時は再現テスト先行。カード追加ごとに最小 1 ケース

### カード追加（Task A）の運用詳細

- 弾順: BSTH05.5 → BSTH06 → BSTH07 → BSTH07.8 → BSTH08 → BSTH08.5 → BSTH09 → BSTH09.2 → BSTH10.5 → BSTH001 → BSTH002 → BSTH003 → BSTH004 → BSTH005 → 他弾
- 各弾内はカード番号順。`textLines` を読み解き DSL 形式で `effects` に変換。複雑効果もスキップせず DSL/インタプリタを拡張して対応
- **サブバッチ運用**: 1 弾を 10 枚程度のサブバッチに分割し、サブバッチ完了ごとに小 commit + ユニットテスト実行。`/autorun` 中も同単位で区切り、途中停止時の再開地点を明確化する
- 弾完了ごとに以下を回す:
  1. 弾全体ユニットテストの確認（カードごとに最小 1 ケース、効果実行後の盤面変化を検証）
  2. Playwright GUI + REST API 双方向操作レビュー（`alice` GUI 操作 + `bob` REST API 操作）
- effects 追加時は GUI 自動接続（`structured-effect-registrations.ts` → `BattleScreen.tsx` / `game-api.ts`）が機能する前提。新しい timing 種別追加時は自動生成関数のマッピングも更新
