# Completed Milestones: Phase 6 — P3-13 DSL 汎用性改善 / P3-15 問題2・4・5（プリミティブ層整備）

このファイルは、Phase 6 の「P3-13 DSL 汎用性改善 + P3-15 問題2 (汎用 core_move フォールバック) / 問題4 (プリミティブ層置換) / 問題5 (turn スコープ期限判定共通化)」の完了履歴です。
索引は [03_completed-milestones-phase-6.md](./03_completed-milestones-phase-6.md) から辿ります。

> P3-15 問題1 (V1→Native 実行パス統合) と問題3 (after_triggers コネクタ) は [03_completed-milestones-phase-6-v1-native.md](./03_completed-milestones-phase-6-v1-native.md) に分離。

## Phase 6: データと DSL — P3-13 / P3-15 プリミティブ層

- **`Effect.limitGroupId` 配線復旧** (2026-05-06):
  - 型定義（`dsl-types.ts`）とデータ（BSTH01-X03 レミリア）には `limitGroupId: "nexus_destroy"` が存在したが、`canUseEffectByUsageLimit` / `recordEffectUsageIfLimited` の呼び出し側が `groupId` を渡していなかったため、召喚時 effect とアタック時 effect が「ターンに1回」を共有せず計2回発動可能だった。
  - 対応: 3 つの registration 型 (`RegisteredTargetedEffectActionBase` / `RegisteredTriggeredEffectAction` / `RegisteredBattleImmediateEffectAction`) に `limitGroupId?: string` 追加。`structured-effect-registrations.ts` で `effect.limitGroupId → registration.limitGroupId` に伝搬する `spreadLimitGroupId` ヘルパーを追加し、全 push 箇所で適用。
  - call sites 8 箇所（`legal-actions-availability.ts` 4, `legal-actions-apply.ts` 5, `trigger-system.ts` 1, `turn-system.ts` 2）で `groupId: registration.limitGroupId` を伝搬。`recordEffectUsageIfLimited` に `groupId` 引数追加。`trigger-system.ts` の同バッチ重複排除 key も `limitGroupId` を考慮。
  - `recordEffectUsageIfLimited` レコード保存時に `groupId` を保持し、`canUseEffectByUsageLimit` 側は `groupId` 一致のレコードを `effectLabel` に依らず合算してマッチ。
  - `packages/rules-core/test/limit-group-id.test.ts` 6 ケース追加（registration 伝搬検証 / BSTH01-X03 specifics / canUse 共有挙動）。
  - 1623→1629 unit tests 全通過、`tsc --noEmit` 通過。

- **P3-13 DSL 汎用性改善完了** (2026-04-09)
  - 対策1: `core-system.ts` に `moveCardZone`/`updateCard`/`updatePlayer` プリミティブ関数追加。`advent-system.ts`/`accel-change-system.ts`/`legal-actions-apply.ts` のインライン状態操作をプリミティブ経由に移行。
  - 対策2: `dsl-types.ts` に `CardEventDisposition` 型追加。`Effect.cardEventDisposition` フィールドで revealed/moved_to_trash の処理方法を明示宣言。`resolveCardEventDisposition()` ヘルパーで明示フィールド優先・steps 推論フォールバック。
  - 対策3: `Effect.movedToTrashBonus` フィールド廃止。ボーナスコア移動を DSL `core_move` ステップに変換。`processMovedToTrashEffects()` を `moveCardZone`/`moveNormalCores` プリミティブ層に移行。
  - カードデータ更新: BSTH01-C12/C21/XX02, BSTH02-R11, BSTH05-C11(×3) に `cardEventDisposition` 追加、`movedToTrashBonus` を `core_move` ステップに変換。
  - 全817テスト通過。
- **P3-15 問題2 汎用 core_move フォールバック実装完了** (2026-04-15)
  - `structured-effect-interpreter.ts:executeCoreMove` 末尾に `toSimpleNormalCoreContainer` ヘルパー追加 + `moveNormalCores` プリミティブ（P3-13 対策1）への委譲で reserve→life/trash / trash→reserve/life / this_card→reserve/trash/life 等を一括対応。
  - `from = field / target_card / field_card`（GUI 選択必要）と `from = life`（ライフダメージインターセプション必要）は除外し、明示ブランチに据え置き。`to = life` は許可（インターセプション不要）。
  - `packages/rules-core/test/core-move-fallback.test.ts` 10件追加（reserve→life/trash、trash→reserve/life、this_card→reserve/trash、opponent→self、ガード: life-source 経路分離、コア0件ハンドリング）。968→978 tests 全通過。
- **P3-15 問題4 `legal-actions-apply.ts` プリミティブ置換完了** (2026-04-15)
  - `applyPendingZoneSelectionAction()` 内の 4 ケース（`search_deck` / `return_from_trash` / `discard_hand` / `move_to_set_aside`）で、インライン `cardInstances.map` + `players.map` を `moveCardZone` / `updatePlayer` プリミティブ（P3-13 対策1）に置換。
  - `handCount` は `moveCardZone` 側で自動更新され、明示更新は不要に。`deckCount` は `moveCardZone` の対象外なので `search_deck` で `updatePlayer` 経由で明示更新を維持。
  - 目的: `zone` / `handCount` 同期漏れリスクを集約（P3-15 問題4 の段階的移行）。残: `structured-effect-interpreter.ts` の pending leave 系、`state-based-actions.ts` の pendingLeaveKind 処理。
  - 978 tests 全通過維持。
- **P3-15 問題4 `structured-effect-interpreter.ts` executeDestroy / executeVanish の `queuePendingLeave` 委譲完了** (2026-04-15)
  - `QueuePendingLeaveOptions` に `suppressDestroyedEffects?` フィールド追加（destroy suppression CE を委譲先でも扱えるようにした）。
  - `executeDestroy` のインライン `cardInstances.map` + `pendingLeaveEntities` push を `queuePendingLeave` ループ呼び出しに置換。
  - `executeVanish` は `updateCard` で `normalCoreCount: 0` を反映 + `queuePendingLeave` + `updatePlayer` で `reserveNormalCoreCount` 加算。
  - 副次効果: ブレイヴ分離・待機状態遷移・`pendingLeaveChainId` 同期が自動適用され、従来の latent invariant 違反（`card.pendingLeaveChainId=null` vs `entity.chainId!=null`）を同時解消。
  - 978 tests 全通過維持。
- **P3-15 問題4 `structured-effect-interpreter.ts` executeStayOnField の `updateCard` 置換完了** (2026-04-15)
  - 対象カード列に対するインライン `state.cardInstances.map(...)` を `toStay` 配列 for ループでの `updateCard(nextState, instanceId, c => { ...exhaustState/pendingLeave* クリア... })` 反復呼び出しに変更。
  - 後続の `pendingLeaveEntities` フィルタリング・`pendingTriggeredEffects`/`pendingBurstChecks` 撤回処理も `nextState` 起点に調整。
  - 978 tests 全通過維持。問題4 のプリミティブ置換はこれで全完了。
- **P3-15 問題5 turn スコープ期限判定共通化 Phase 1 完了** (2026-04-15)
  - `legal-actions-shared.ts` に `getDurationTotalTurns` / `shouldExpireDurationAtTurnEnd` / `isDurationActiveAtTurn` の Duration ヘルパー 3 関数を追加。
  - `removeExpiredContinuousEffects` / `removeExpiredRetriggerEffects` / `isRetriggerMatch` の 3 箇所に重複していた turn スコープ経過判定（`turns` + `next` 合成 + `elapsed` 比較）を共通ヘルパー呼び出しに置換。
  - 残余: 新 `while_*` スコープ追加時に本ヘルパー群へ判定増設予定。
  - ロジック不変、978 tests 全通過維持。
- **DSL `override_properties` 系統加算 (`addTribes`) + filter target 動的メンバーシップ + BSTH05.5-C04 [緋想天]アリス effects[3]/[4] 完成** (2026-05-02)
  - `dsl-types.ts`: `OverridePropertiesAction.properties.addTribes?: string[]` を追加。`tribes`（overwrite）と独立に作用し、ベース系統（または overwrite 後系統）と重複除去で結合される。
  - `legal-actions-shared.ts`: `OverriddenProperties.addTribes?` 追加。`getOverriddenProperties` が複数 CE の `addTribes` を集約。新規 `getEffectiveTribes(state, card, def, getDef?)` ヘルパーを公開し、ベース → per-target 上書き（tribes）→ per-target 加算（addTribes）→ 動的フィルタターゲット global CE の `addTribes` の順で実効系統リストを合成。
  - `effect-interpreter.ts:executeOverrideProperties`: `target.kind = "filter"` かつ properties が `addTribes` のみの場合、per-target snapshot ではなく `targetFilter` を持つ単一 global CE として登録。アリス着地後に新規召喚された 青/導界者ネクサスにも自動的にマッチ（動的メンバーシップ）。`matchesOverridePropertiesGlobalCE` で player + category + colors + tribes をベース系統で照合（CE 連鎖再帰回避）。
  - `card-filter.ts:matchesCardFilter`: `MatchCardFilterOptions.effectiveTribes?` を追加。`matchesTribes` が指定時は `def.tribe.split("・")` の代わりに渡された実効系統リストを使う。
  - カードデータ: `BSTH05.5-C04` の stub だった「このスピリットと、自分の青の導界者ネクサスは系統：「起幻」を持つ」を effects[3]（self addTribes）/effects[4]（filter target addTribes）として実装完了。
  - テスト: `bsth05_5-cards.test.ts` に effects[3]/[4] 検証 + 実効系統合成 7 ケース追加（self / 既存 nexus / 後追い nexus / 相手 nexus 除外 / overwrite + addTribes 互換）。1211→1218 tests 全通過。
  - 残: `def.tribe.split("・")` を直接参照する 15+ サイト（advent / oracle / retrigger / structured-effect-interpreter 等）への `getEffectiveTribes` 配線は未対応。現時点で 起幻 を消費するカードがないため需要発生時に着手。
- **BP比べ破壊の cause 帰属分離完了** (2026-07-16)
  - `TriggerEventCause` に `opponent_bp_compare` / `self_bp_compare` を追加し、`deriveTriggerEventCauseFromPendingLeave()` が `pendingLeave.cause === "bp_compare"` と BP比較の勝者 (`causePlayerId`) から対象カード視点の帰属を導出するようにした。
  - cause マッチングを `trigger-cause-match.ts` に集約し、互換用総称 `bp_compare` は両帰属版にマッチさせる。既存 DSL の `[opponent_effect, battle]` も `opponent_bp_compare` を含めて扱う。
  - 文字列バーストの「自分によって/相手によって」は公式 Q&A Q18316/Q18317 に合わせ、対象カードの controller 視点で effect + BP比べ帰属へ展開する。「自分の効果によって/相手の効果によって」は従来通り effect のみに限定。
  - テスト: `burst-registration-builder.test.ts` / `p3-68-cause-attribution.test.ts` / `burst-player-trigger-filter.test.ts` / `bsth03-m01-ultimate-leave-burst.test.ts` / `grant-effect-card-event-cause-overlay.test.ts` に BP比べ帰属・grant/burst cause フィルタ互換の検証を追加。
