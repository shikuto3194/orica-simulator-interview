# AI Reference

このフォルダは、公式ルール・独自カードサイトの裁定を AI が読みやすい粒度に分割したものです。

前提: **再利用可能なルールエンジンを中核成果物にする。** UI / AI は上位レイヤ。
**ルール正源は公式エターナル版 (Ver.17.0) のみ。** スタンダード版は対象外。

運用ルールは [CLAUDE.md](../../CLAUDE.md) の **Cross-cutting Rule**。根拠・型・現状・受入の分担は [文書保守](00_meta/documentation-maintenance.md) を参照。

## ディレクトリ構成

| ディレクトリ | 内容                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `00_meta/`   | ソース調査、信頼度、未解決質問、ローカルツール補足（索引: [00_meta/README.md](./00_meta/README.md)）    |
| `10_rules/`  | ゲームルール                                                                                            |
| `20_design/` | エンジン設計（状態モデル、API、コア資源、バトル、スタック窓/優先権、DSL仕様、継続効果整合性、DL対戦AI） |
| `25_gui/`    | GUI/UX/音/シナリオテスト                                                                                |
| `28_policy/` | 運用方針（テスト戦略、カード追加、独自拡張）                                                            |
| `30_plan/`   | ToDo、完了履歴、無人ループ運用                                                                          |

## 目的別索引

- **原文忠実度監査**: [35弾・541面の対照記録](00_meta/fidelity-audit-2026-09-13/README.md) / [類似検出とフルラン引継ぎ](00_meta/fidelity-detection.md)。
- **ルール確認**: 下記の機構別索引から該当章へ。[出典索引](00_meta/source-map.md)で原文・採用条件を確認する。
- **枚数による自己軽減・C04のGUI/REST**: [既存枠の充足と手札/場使用](10_rules/03a_self-reduction-fulfillment.md)。
- **追加ステップ・追加ターンの復帰**: [02d](10_rules/02d_extra-steps-and-turns.md)。
- **コア/ソウルコア**: `10_rules/06_core-system.md` → `20_design/06_core-resource-model.md`。
- **待機コア / スタック後の召喚不成立・宣言違法化**: [10_rules/03f](10_rules/03f_stack-failure-and-waiting-cores.md)。
- **バトル/複数効果**: [バトルの存続と終了](10_rules/02c_battle-lifetime-and-resolution.md) → `20_design/01_domain-model.md` → `20_design/07_battle-and-effect-model.md`。
- **合体と召喚の意味イベント**: [裁定](10_rules/05_brave-and-attack-special-cases.md#合体) → [発行・継続・保存・配送](20_design/17_brave-semantic-events.md)。
- **スタック窓/フラッシュ優先権**: `10_rules/02_turn-flow-and-timing.md` → `20_design/08_stack-window-and-priority-loop.md`（[実装入口](20_design/08a_stack-window-implementation.md)）。
- **効果テキスト文言の解釈（強制/任意・ことで構文 等）**: `10_rules/03c_effect-text-interpretation.md`。人称対象判定・発揮前提ゲートは `10_rules/03d_effect-target-and-prerequisite-gates.md`。常時/継続 vs 誘発/即時判定・時間指定効果の継続・ターンに1回/重複不可は `10_rules/03e_effect-duration-and-repeat-scope.md`。
- **公開情報/非公開情報（誰に何が見えるか）**: `10_rules/01b_information-visibility.md`。裏向きカードの素性は `10_rules/04c_face-down-identity.md`。実装 SSOT は `packages/rules-core/src/state-sanitize.ts`。
- **ルーム通信**: [調査](20_design/18_room-network.md) → [確定・復旧・配備](20_design/19_room-network-protocol.md)。
- **実装設計**: `20_design/00_project-structure.md` → 必要な `20_design/` ファイル。
- **DSL 仕様**: `20_design/12_dsl-specification.md`（4軸構造・型の解説）。
  - 型定義の正源は `packages/rules-core/src/dsl-types.ts`。
  - `manual/_legacy/dsl-v2-design/` は初期設計スナップショット（参考のみ）。現行実装に対し以下が未反映:
    - DynamicCount ソース種・CardFilter 拡張
    - Action 追加種（`stay_on_field` / `enter_soul_state` / `divine_transform` 等）
    - StepCondition 追加種（`ref_count` / `ref_choice`）
    - EffectStep の `chooser` / `retrigger`
- **DSL 実装・回帰の入口**: `20_design/11_structured-effect-model.md`。
- **継続効果の状態整合性 (リビルダ + invariant)**: `20_design/13_continuous-effect-state-integrity.md`。
- **DL 対戦/構築 AI（self-play・状態エンコード・ISMCTS・ガントレット）**:
  現役実行計画は [ISMCTSフルラン](30_plan/ismcts-full-run/README.md)。
  `20_design/14_dl-ai-architecture.md`。AI 観測入力 contract は
  `20_design/16_ai-observation-contract.md`。学習実行構成・出力・評価 gate は
  `20_design/15_ai-training-configuration.md`。
- **効果キューの本文識別**: [15_effect-queue-text.md](25_gui/15_effect-queue-text.md)（登録正源、宣言前後の本文同一性、全カード回帰）。
- **行動ボタンの重複禁止・神技の範囲支払い**: [21_action-button-uniqueness.md](25_gui/21_action-button-uniqueness.md)。
- **タイトルのログイン・素材保存**: [16_title-preload.md](25_gui/16_title-preload.md)（初回一式DL→事前キャッシュ→逐次読み込み、画像・音源の差分保存と起動）。
- **管理者のアカウント・デッキ連携**: [17_account-deck-linking.md](25_gui/17_account-deck-linking.md)（メイン指定・サブ連携・共有のオン／オフ）。
- **幻想符のホーム・外観・二つ名**: [実装仕様・内部出典](25_gui/18_home-lobby.md)。[検討時のモック](25_gui/mockups/README.md)・全身アバター記録も参照。
- **ルーム招待・メッセージ**: [ユーザー選択・未読・明示参加](25_gui/20_room-invitations.md)。
- **運営通知**: [前日分の日次掲載・最新10件・既読](25_gui/23_operation-notices.md)。
- **ルームのデッキ選択**: [保存デッキとの共通表示・準備状態](25_gui/22_room-deck-selection.md)。
- **GUI/UX**: `25_gui/08a_gui-layout-reference.md`（レイアウト）、`25_gui/08b_gui-interaction-reference.md`（インタラクション）、[08c](25_gui/08c_battle-visual-reference.md)（宣言・バトル演出）。
  `25_gui/11_core-selection-hud.md`（コア選択 HUD「掴む→置く」2 phase 統一仕様）、`25_gui/13_public-disclosure-log-plan.md`（公開情報通知・ログ計画）。シナリオテストは `25_gui/10_scenario-test-reference.md`。
- **カード追加・訂正**: [追加判断](28_policy/04_card-addition-decision-table.md) → [本文更新](28_policy/06_card-data-update-flow.md)。
- **離脱時の選択・バースト発動宣言**: [04d_leave-choice-timing.md](10_rules/04d_leave-choice-timing.md)。
- **同一効果の離脱成立・別誘発の資格**: [04e](10_rules/04e_leave-outcomes-and-trigger-eligibility.md)。**効果発揮後と通常バースト**: [04b5](10_rules/04b5_after-effects-and-burst.md)。
- **独自カード/裁定**: `10_rules/07_custom-orica-mechanics.md` + `28_policy/05_custom-extension-policy.md`。
- **紺珠伝・純化・公開デッキ**: [07e](10_rules/07e_kanjuden-mechanics.md)（qa-055〜057、早苗・R03の確認済み裁定）。
- **特殊ギミックのルールと設計（煌臨/転醒/契約/アクセル等）**: `10_rules/08_advanced-mechanics.md`。ルール説明＋実装設計を一体でまとめたリファレンス。
- **新規参入時の現状把握**: [現役Snapshot・Active Board](30_plan/02_detailed-todo.md)。[ロードマップ](30_plan/01_phase-roadmap.md)は過去の計画。
- **次のタスク**: `30_plan/02_detailed-todo.md`。
- **完了履歴**: `30_plan/03_completed-milestones.md`（索引）→ phase 別ファイル。
- **無人ループ運用**: `30_plan/full-run-supervisor.md`（全体正源）→
  `30_plan/full-run-worker-brief.md`（scheduled worker 冒頭の軽量入口）→
  `30_plan/lane-prompt-codex-engine.md` など active lane prompt → `engine-drain-runbook.md`（縦＝stub 解消）/
  `guard-audit-runbook.md`（横＝機械ガード増設）/ `effect-debug-loop-runbook.md`
  （effect-debug-harvest 発見→cluster 修正）/ `autorun-runbook.md` /
  `adversarial-verifier-prompt.md`（commit 前敵対的検証ゲートの正源）。
- **棋譜・ログの容量管理**: [artifact-storage.md](30_plan/artifact-storage.md)（容量上限、保護対象、整理・worker指示）。
- **棋譜の保存・公開版での再生・再戦**: [19_replay-and-rematch.md](25_gui/19_replay-and-rematch.md)。
- **Codex-only 自動復帰**: `scripts/configure-codex-autostart.ps1`（Codex supervisor +
  Telegram relay/inbox を登録し、Claude scheduled tasks を停止/無効化）。
- **技術的負債・改善バックログ**: `issues/00_index.md`。
- **ローカル LLM 補助**: `packages/ai/README.md`。CLI は `pnpm ai:*`。GUI チャット (`ai:gui`) は自然言語で skill 自動起動 / `/<command>` slash command / `orica-snapshot-*.json` 添付で snapshot 紐付き / `web_search`+`web_fetch` で外部リサーチに対応。

## 読み取りルール

- ルール本文そのものではなく、実装用の要約として読む。
- 信頼度・調査メモ・未解決事項は `00_meta/` を起点に辿る (`source-map.md` → `source-findings-*.md` / `open-questions.md`)。
- リサーチ・ソース運用の詳細は `CLAUDE.md` の Cross-cutting Rule を参照。
