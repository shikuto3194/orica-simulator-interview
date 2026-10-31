# Completed Milestones: Phase 6 — DSL v2 移行・v1 廃止

このファイルは、Phase 6 の「DSL v2 基盤構築・v1→v2 型定義移行・v1 完全廃止・retrigger/suppress/stub 実装」の完了履歴です。
索引は [03_completed-milestones-phase-6.md](./03_completed-milestones-phase-6.md) から辿ります。

## Phase 6: データと DSL — DSL v2 移行・v1 廃止

- DSL v2 実装基盤 Phase 1-5 完了 + BSTH01 カードデータ移行 (2026-04-04):
  - **Phase 1**: `dsl-v2-types.ts` 新規作成。v2 基盤型（CardFilter, TargetSpec, CoreLocationV2, DynamicCount, Count, Amount, Applicability, StepCondition, Connector）+ V2 namespace 内に38アクション型 + EffectStep / EffectV2。
  - **Phase 2**: `card-filter.ts` 新規作成。統一 CardFilter マッチング実装（filterOr/exclude/colorCount/hasMechanic/soulState/cardName 対応）。`card-filter.test.ts` 28テスト追加。
  - **Phase 3**: `model.ts` の CardDefinition に `effectsV2?: EffectV2[]` フィールド追加（v1/v2 並行運用）。
  - **Phase 4**: v2 インタプリタ基盤。3新規ファイル:
    - `step-execution-context.ts`: クロスステップ参照コンテキスト（StepResult 記録・シリアライズ/デシリアライズ）。
    - `target-resolution.ts`: TargetSpec 解決（self/filter/ref）、DynamicCount 評価（cards_in_zone/cards_from_ref/cores_on）。
    - `effect-interpreter-v2.ts`: v2 インタプリタ本体。Applicability 評価、Connector 実行（simultaneous/sequential/conditional_result/conditional_cost）、StepCondition 評価、v2 Action→v1 EffectAction 変換ブリッジ（26種対応）。
    - `effect-interpreter-v2.test.ts` 10テスト追加。
  - **Phase 5**: エンジン統合。
    - `effect-resolution.ts`: tryExecuteStructuredEffects に v2 優先分岐追加（effectsV2 → executeEffectV2、なければ v1 フォールバック）。
    - `structured-effect-registrations.ts`: v2 レジストレーション生成関数4種追加 + buildXxxLookup 4関数を v2 対応に拡張。
  - **Phase 6 (BSTH01)**: 全27カードに effectsV2 を自動生成・追加。v1 effects も並行保持。
  - 全665テスト通過（既存627 + CardFilter 28 + v2インタプリタ 10）。
- P2-02 DSL v1→v2 Section 3 完了 — TriggerEventKind 全9種を v1 過去分詞 → v2 動詞形にリネーム。BurstEventKind も同様。型チェック通過、518 unit tests 全通過。

- P2-02 DSL v1→v2 型定義移行 Phase 5-6 + Section 2 完了:
  - Phase 5: Summon 3種統合 (`summon_self`/`summon_self_from_hand`/`summon_from_zone` → 統一 `SummonAction { kind:"summon", target:"self"|"other" }`)。カードデータ7file 24箇所 + テスト1箇所を新形式に変換。
  - Phase 6: ContinuousEffectTag 型安全化。`modifierTag: string` → テンプレートリテラル型で動的タグ + 静的タグ10種 + 効果耐性タグ7種 = 計33種を型安全化。
  - Section 2: `StructuredEffect` から deprecated フィールド (`subTiming`, `burstTrigger`) を削除。
  - 型チェック通過、518 unit tests 全通過。

- P3-09 DSL 条件付き再発火パターン（retrigger）実装完了 (2026-04-05):
  - `dsl-v2-types.ts`: `RetriggerConfig` インターフェース + `EffectStep.retrigger` フィールド追加。
  - `model.ts`: `RetriggerEffect`, `RetriggerTriggerFilter` 型 + `GameState.activeRetriggerEffects` 追加。
  - `retrigger-system.ts`: 新規作成。マッチング（イベント/プレイヤー/フィルタ/duration/maxCount）、実行（executeEffectV2 委譲）、期限切れ除去。
  - `effect-interpreter-v2.ts`: retrigger 付きステップは即時実行せず RetriggerEffect 登録。
  - `battle-actions.ts`: アタック宣言時に `executeMatchingRetriggers()` で条件付き再発火を実行。バトル終了時にも retrigger クリーンアップ追加。
  - `turn-system.ts`: ターン終了時の retrigger クリーンアップ追加。
  - `BSTH01-R11` の effectsV2 を retrigger パターンに更新（stub 解消）。
  - `retrigger-system.test.ts` 8テスト追加。全673テスト通過。

- **P2-02 DSL v1→v2 型定義移行 Phase 1-4 完了** (2026-04-04):
  - Phase 1: Zone に `mirage`/`count_area` 追加、EffectResistance 4種追加、PlayerState.countValue / CardInstance.pendingLeaveLvSnapshot 追加。
  - Phase 2: EffectDuration (string union) → Duration (structured object `{ scope, whose?, step?, next? }`)。エンジン4ファイル + カードデータ9ファイル(143箇所) + テスト5ファイル(89箇所) 一括移行。
  - Phase 3: EffectCondition (flat object) → Condition (ConditionClause[] discriminated union)。カードデータ9ファイル(128箇所) 変換。
  - Phase 4: EffectTiming (19-value string union) → Timing (6-variant discriminated union: card_event/game_event/phase/activated/burst/continuous)。登録パイプライン書換え、エンジン7ファイル + カードデータ11ファイル(366箇所) + テスト一括移行。
  - 518 unit tests 全通過。残り: Phase 5 (Summon統合) / Phase 6 (ContinuousEffectTag)。

- **P3-10 DSL 破壊時効果抑制（suppressDestroyedEffects）完了** (2026-04-05):
  - `V2.DestroyAction` / v1 `DestroyAction` / `PendingLeaveEntity` / `PendingTriggeredEffect` / `PendingBurstCheck` に抑制型追加。
  - 2スコープ: `"destroyed_only"`（破壊カード自身の効果のみ抑制）、`"all_opponent"`（相手の一切の効果抑制）。
  - セマンティクス: 「発揮されない」は使用/発動を抑制しない。発動は通常通り行い、resolver スキップで発揮のみ抑制。バーストは発動できる（公開・消費）がバースト効果は空。
  - データフロー: `executeDestroy()` → `PendingLeaveEntity` → `CollectedTriggerEvent` → PTE/PBC に抑制フラグ伝播 → `legal-actions-apply.ts` で resolver スキップ。
  - BSTH01-X03(destroyed_only)、BSTH01-XX02(all_opponent) のカードデータ更新・stub 解消。
  - 型チェック通過、673 unit tests 全通過。

- **P3-11 v2 stub アクション群の実装完了** (2026-04-05):
  - `effect-interpreter-v2.ts` の `convertToV1Action()` で null を返していた全11種の stub を実装。
  - **v1 変換 4種**: discard→discard_hand、search_zone→search_deck/return_from_trash、summon→summon(v1)、set_exhaust_state→recover/exhaust。
  - **v2-native 7種**: move_card（ゾーン間カード移動）、core_distribute（コア分配）、suppress_effect（effect_suppression CE 登録）、override_properties（CE 登録 + metadata）、restrict_use（CE 登録 + targetFilter）、restrict_manifest（CE 登録）、redirect_target（アタック対象変更）。
  - `model.ts` 拡張: ContinuousEffectTag に override_properties/restrict_use/restrict_manifest 追加。ContinuousEffect に metadata フィールドと targetFilter の colors/tribes 追加。
  - v2 アクション全40種が実装済みとなり、stub 起因のスキップが解消。
  - 型チェック通過、673 unit tests 全通過。

- **P3-11 CE 消費側3種実装完了** (2026-04-05):
  - `override_properties`: `getOverriddenProperties()` ヘルパー（copy_self 解決・後勝ちマージ）、`getEffectiveBp()` / `getEffectiveSymbols()` に CE 反映。
  - `restrict_use`: `isCardUseRestricted()` ヘルパー（プレイヤースコープ CE + CardFilter マッチング）、召喚/配置/マジック/アクセル/チェンジ各 legal action に統合。
  - `restrict_manifest`: `isCardManifestRestricted()` ヘルパー（プレイヤースコープ CE + CardFilter マッチング）、フィールドカード効果 legal action に統合。
  - `index.ts` に新関数3種 + 型1種をエクスポート。
  - `ce-consumption.test.ts` 19テスト追加。型チェック通過、692 unit tests 全通過。

- **P3-12 DSL-V1 完全廃止** (2026-04-06):
  - Phase A: 汎用ロジック（evaluateCondition, resolvePlayerRef, executeEffectAction）を共有モジュールとして維持。
  - Phase B: V1-only カード3ファイル（BSTH06/07/10.5）の V2 移行（前提条件として完了済み）。
  - Phase C: V1 ディスパッチ削除（effect-resolution.ts, structured-effect-registrations.ts, legal-actions-apply.ts）。
  - Phase D: StructuredEffect 型・executeStructuredEffect 関数・V1 effects フィールド削除。
  - Phase E: V2 名前空間リネーム（EffectV2→Effect, ActionV2→Action, effectsV2→effects, dsl-v2-types.ts→dsl-types.ts, effect-interpreter-v2.ts→effect-interpreter.ts）。
  - Phase F: 変換スクリプト削除、ドキュメント更新。
  - 新規 DSL 型追加: CountDecreaseAction, CountSetAction, EnterSoulStateAction, LeaveSoulStateAction。
  - 全692テスト通過。
