# Domain Model

## 目的

ルールを無理なく実装するために、カード定義、カード実体、盤面主体、攻撃グループ、効果チェーンを分離する。

この文書は **基礎モデルの入口だけ** を置く。詳細はコア資源 ([06_core-resource-model.md](./06_core-resource-model.md)) / battle と effect model ([07_battle-and-effect-model.md](./07_battle-and-effect-model.md)) を参照。

## 推奨オブジェクト

### CardDefinition

印刷情報と静的メタデータ。

最低限:

- `cardNo`
- `name`
- `printedCategory`
- `colors`
- `cost`
- `reductionSymbols`
- `levelDefs`
- `symbolColors`
- `textLines`
- `keywordTags`
- `sourceUrls`
- `sourceConfidence`

### CardInstance

ゲーム中に存在する 1 枚。

最低限:

- `instanceId`
- `definitionId`
- `ownerPlayerId`
- `controllerPlayerId`
- `zone`
- `normalCoreCount`
- `minimumRequiredCores`
- `exhaustState`
- `pendingLeaveKind`
- `pendingLeaveCause`
- `deferZoneMoveUntilChainEnd`
- `attachedToInstanceId`
- `attachedChildrenIds`

補足:

- ソウルコアはカードごとの boolean ではなく、`PlayerState.soulCoreLocation`（primary pointer。`{ kind: "card", instanceId }` 等）とロケーション別カウント（`CardInstance.soulCoreCount` / `PlayerState.*SoulCoreCount`、P3-101）で管理する。
- 一時効果は `GameState.activeContinuousEffects` の `ContinuousEffect` レイヤで管理する（CardInstance 自体には持たない）。
- 1個のコアの移動元が複数ゾーンにまたがる `core_move` は `CoreLocation.union.sources` を使う。
  移動元専用で、`amount: 1` と解決済みの単一移動先を指定する。所属つき実コンテナを
  `PendingCoreSourceAllocation.candidates[].container` に保持し、既存HUDで物理コアを選ぶ。
  分岐はカード定義に重ねず、`getFieldCoreSourceTakeableCount` と通常core_moveで合法性を判定する。

### BattleEntity

戦闘主体。

用途:

- 合体スピリット
- スピリット状態のブレイヴ
- 通常スピリット
- アルティメット

最低限:

- `entityId`
- `memberInstanceIds`
- `resolvedBp`
- `resolvedSymbols`
- `attackState`

補足: `memberInstanceIds` 中心の軽量表現。`mainCardInstanceId` / `resolvedAbilities` は未導入の候補（`BattleEntity` 型に無い）。

### ActiveAttack

用途:

- 通常の 1 体アタック
- 複数体同時アタック
- 効果解決中の途中参加アタック

最低限:

- `attackId`
- `primaryEntityId`
- `participantEntityIds`
- `groupMode`

補足: `activeAttack` が `BattleEntity` を束ね、`target` / `blockAssignments` / `symbolResolutionOrder` を保持。`blockAssignments` は participant ごとに `blockedByEntityIds: string[]`（1体に複数 blocker 可。`require_multi_block` CE、P2-05 Phase 5）。battle 中即時効果 prompt は `battleImmediateEffects` 側に分離。

### GameState

基礎フィールド:

- `turnNumber` / `activePlayerId` / `playerOrder` / `step` / `window`
- `players` / `cardInstances` / `battleEntities`

バトル関連:

- `activeAttack`（`flashWindowState` は `ActiveAttack` 側に保持）
- `battleResolutionGroup` / `battleImmediateEffects`

スタック窓:

- `stackWindow`（旧 `mainStepStackWindow`。P3-34 で全ステップ共通に一般化）/ `preDeclarationStackWindow`

保留キュー（pending）。以下は主なもので、全件は `model.ts` の `GameState` が正源（`pendingEnterFieldPlacement` / `pendingStepChoice` / `pendingEffectTargetSelection` など多数ある）:

- `pendingLeaveEntities` / `pendingTriggeredEffects` / `pendingBurstChecks`
  - 神託/解封/創界石転醒/配置時神託は `PendingTriggeredEffect.mechanic` 付きエントリとして誘発キューに統合（P3-92。配置時神託は `mechanic.kind:"placement_oracle"`、旧 `pendingPlacementOracle` は存在しない）
- `pendingSoulStateReplacement`（契約カードの魂状態置換選択）
- `pendingDeckReveal` / `pendingZoneSelection`
- `pendingCoreShootSelection` / `pendingCoreSplitSelection`
- `pendingDrawEvents`

バースト/ミラージュ:

- `setBurstStates` / `revealedBurstStates` / `burstSetPlayerIdsThisTurn`
- `mirageSetStates` / `mirageSetPlayerIdsThisTurn`

継続効果:

- `activeContinuousEffects`（retrigger 効果は `modifierTag: "retrigger"` の CE バリアントとして統合管理 — P3-15 問題6 対応 2026-04-17）

ターン内カウンタ（相手効果ライフ減少の累積、宣言回数、BP閾値のライフ減少など）は専用フィールドを持たず、
`effectAccounting` の数量枠・宣言事実として保持する（[効果由来の使用枠](20_effect-usage-accounting.md)）。

効果使用/ログ:

- `effectAccounting` — 効果由来の使用枠・権利・数量・事実・観測の唯一の会計。契約は [使用会計](20_effect-usage-accounting.md)
- `effectQueueEntries` / `effectQueueSummary` / `log`
- `illegalBurstRevealPlayerId`
- `flashCardUsageLog` / `flashEffectActivationLog` — 独自拡張「フラッシュ効果使用後以外」裁定の参照元。2 軸独立（カード使用 vs 効果発揮）、ゲーム終了まで累積保持、`ConditionClause.flash_used` から scope（`latest` / `step` / `battle` / `turn` / `game`）でクエリ（P3-14 C-1 対応 2026-04-17）

ゲーム状態:

- `gameResult` / `preGame`

補足:

- 内部制御は `effectQueueEntries` を使い、`effectQueueSummary` は UI / API / ログ向けの表示用要約。
- `collectGameStateInvariantIssues()` / `assertValidGameState()` で各種整合性を検出。
- `pendingTriggeredEffects` / `pendingBurstChecks` は `StructuredTriggerEvent`（`family` + `actionKind` / `causeKind` / `validationMode`）を共有。`TriggerEventMatcher` ベースのマッチングに移行済み。
- `preGame` は 契約提示→じゃんけん→先後選択→マリガンの pregame フロー用（`PreGameState` / `PreGamePhase` 型。フェーズ一覧は `model.ts`）。

## 重要 enum

### Step

- `start`
- `core`
- `draw`
- `refresh`
- `main`
- `attack`
- `end`

### Window

- `none`
- `stack`（旧 `main_step_stack`）
- `step_start`
- `declare_attack`
- `pre_declaration_stack`
- `flash_before_block`
- `stack_before_block`
- `declare_block`
- `flash_after_block`
- `stack_after_block`
- `battle_resolution`
- `step_end`
- `end_step_effects`
- `end_step_end_effects`
- `end_step_cleanup`

### PendingLeaveKind

- `destroy`
- `vanish`
- `bounce`
- `remove_from_game`（ゲームから除外）
- `rule_cleanup`（ルール上フィールドに存在できない不正状態の清掃。破壊/消滅/バウンス/離場の誘発を出さない）

### ExhaustState

- `recovered`
- `exhausted`
- `heavily_exhausted`

## 設計の要点

### 1. 印刷種別と現在役割を分ける

- ブレイヴは
  - 印刷上は `printedCategory:"brave"`
  - 場で合体中かは `attachedToInstanceId` と、異魔神では右側の `imaginRightCombinedWith` も見て判定する
  に変わる。

### 2. 合体はネストではなく合成ビュー

- 合体スピリットは 1 体として扱う。
- ただし元カードは個別に保持する。
- そのため `BattleEntity` を別途作る。

### 3. 一時効果は attach ではなくレイヤ管理

- `このターンの間`
- `このバトルの間`
- `このスピリットがフィールドにいる間`
  を `GameState.activeContinuousEffects` の `ContinuousEffect` レイヤで管理する。`ContinuousEffect.duration`（`Duration`: `scope` が `turn` / `battle` / `attack` / `step` / `while_on_field` / `permanent` 等、`whose` / `next` で補足。全 scope は `model.ts` の `Duration`）で有効期限を制御し、`recomputeContinuousEffects()` / `removeExpiredContinuousEffects()` で再計算・除去する。

### 4. 遅延処理は pending レイヤで管理

- 消滅や破壊後のトラッシュ遅延は `pendingLeaveEntities` + `flushPendingLeaves()`
- 派生効果は `pendingTriggeredEffects` / `pendingBurstChecks` に staging
- 同時発揮グループは `simultaneousGroupId` で表現

## 詳細の分割先

- コア/ソウルコア/leave-field override/ライフ混在 → [06_core-resource-model.md](./06_core-resource-model.md)
- `activeAttack` / `battleImmediateEffects` / group 解決 / effect model → [07_battle-and-effect-model.md](./07_battle-and-effect-model.md)

## 実装済みの追加フィールド

`CardDefinition` には最低限フィールドに加えて以下が実装済み（抜粋。全フィールドは `model.ts` の `CardDefinition`）:

- `tribe?` — 系統
- `image?` — カード画像パス
- `rarity?` — レアリティ
- `pack?` — 収録パック
- `maxDeckCount?` — デッキ枚数制限
- `maxTokenDeckCount?` — トークンデッキ枚数制限
- `isDoubleSided?` — ダブルフェイスカード
- `backFace?` — 裏面データ
- `relatedTokenCardNos?` — 関連トークン
- `orikaId?` / `orikaIndex?` — 外部ID
- `displayCostText?` — 非数値コスト表示
- `summonCondition?` — アルティメット召喚条件
- `braveCondition?` — 合体条件
- `effects?: Effect[]` — 構造化効果定義（`dsl-types.ts` の `Effect` 型）
