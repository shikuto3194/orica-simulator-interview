# Core Resource Model

## 目的

通常コア、ソウルコア、ライフ混在、leave-field 時のコア移動先を、カード本体移動と分けて安全に扱う。

## 基本方針

- コアはカード本体と一緒に動かさない。
- 支払い、リザーブ、ボイド、ライフ、創界神などで別管理する。
- カード本体の `moveToTrash()` と、コアの移動先決定は別関数にする。

## 実装経緯

一次分離として `CardInstance.normalCoreCount` ＋ `PlayerState.*CoreCount` ＋ `soulCoreLocation` の分離を導入済み。以降に追加実装した内容:

- ライフ減少（`resolveLifeDamage()` / `life_damage` DSL アクション）
- リフレッシュステップでのコア回収（`refreshTrashCoresToReserve()` を `advanceStep()` に統合）
- ソウルコア限定支払い（`includeSoulCore` フラグ / `costPayUseSoul` / `summonUseSoul`）
- カード離脱時のコア移動分離（`resolveCardLeavesFieldCores()` / `LeaveFieldCoreDestinationOverride`）
- コアシュートのソウルコア対応（`coreShootSoulCoreInstanceId`）
- 非 magic 経路のコアシュート GUI 接続（`PendingCoreShootSelection` / `resolve_pending_core_shoot`）
- フィールドカードからのコスト支払い（`availableOnBoardCoreSources`）
- ライフダメージインターセプション（`applyLifeDamageInterception()` / `LifeDamageInterceptionAction`）

### 残タスク（ToDo タスク C 連動）

- **ソウルコア複数個対応**: 現在 `soulCoreLocation` は単一モデル。`costPayUseSoul` / `summonUseSoul` / `soulCoreDisplayOverrides` の boolean → number 化と `declinedSoulLocations` のガード更新が必要。

## 現行モデル（実装フィールド）

- `CardInstance.normalCoreCount`
- `PlayerState.reserveNormalCoreCount`
- `PlayerState.trashNormalCoreCount`
- `PlayerState.lifeNormalCoreCount`
- `PlayerState.voidNormalCoreCount`（プレイヤーごと、初期値=200−ライフ−リザーブ）
- `PlayerState.soulCoreLocation: PlayerScopedSoulCoreLocation | null`
  - `{ kind: "card"; instanceId }`
  - `{ kind: "reserve" }`
  - `{ kind: "life" }`
  - `{ kind: "trash" }`
  - `{ kind: "removed_from_game" }`
  - 注意: ソウルコアの `void` は存在しない（ルール上ソウルコアはボイドに置かれない）。通常コアは `voidNormalCoreCount` で別管理する。

**コンテナ型**:
- `NormalCoreContainer` — `card / reserve / trash / life / void`（通常コアは void あり）
- `SoulCoreContainer` — `card / reserve / trash / life`（`removed_from_game` は `PlayerScopedSoulCoreLocation` 専用）

**公開 API（core-system.ts）**:
- `moveNormalCores()` / `moveSoulCore()`
- `getAvailableLifeCoreMoveChoices()` / `moveLifeCoreByEffect()`
- `resolveLifeDamage()` / `applyLifeDamageInterception()`
- `resolveCardLeavesFieldCores()` / `LeaveFieldCoreDestinationOverride`
- `refreshTrashCoresToReserve()` / `refreshExhaustStates()`
- `getNormalCoreCountAtLocation()` / `getTotalCoresOnCard()` / `getPlayerLifeCoreCount()` / `getPlayerReserveCoreCount()` / `getPlayerTrashCoreCount()`
- `updateCard()` / `updatePlayer()` / `moveCardZone()` — プリミティブ層（P3-13 で共通化）

## Preview projection (core-draft.ts) と GUI facade

確定前のコア配分（リザーブ→カード、コスト支払い、配置、コアシュート、ブレイヴ分離、トラッシュ→フィールド配分）を扱うため、P3-46 で **2 層構造** を導入した。

### L1: rules-core projection — `core-draft.ts`

- 純関数 `applyDraftCoreMoves(state, drafts) → GameState` を提供（[packages/rules-core/src/core-draft.ts](../../../packages/rules-core/src/core/core-draft.ts)）。
- 入力 `DraftCoreMove[]` は `kind: "normal" | "soul"` + `purpose` タグ（`card_cost` / `placement` / `shoot` / `separation` / `core_move` / `trash_distribution`）+ `from` / `to` container。
- 内部は `moveNormalCores` / `moveSoulCore` プリミティブを順次適用するだけの薄いラッパー。
- **SBA / 継続効果再評価は呼ばない**。preview 用なので副作用最小化、確定時は呼び出し側 commit パスが SBA + CE rebuild を担う。
- `recomposeSummonLegalAction` / `recomposeMagicLegalAction` / `recomposeCoreShootLegalAction` / `recomposeBraveSeparationLegalAction` / `recomposeTrashDistributionLegalAction` で drafts → LegalAction payload 変換。集約と順序保持を 1 箇所に集約。

> **GUI HUD / 操作 UX の統一仕様**（「掴む→置く」2 phase + 動詞辞書 + ボタン規則）は [25_gui/11_core-selection-hud.md](../25_gui/11_core-selection-hud.md) を正源とする。本ファイルはエンジン側のコア資源モデルに集中。

### L2: GUI facade — `apps/playground-web/src/coreSelectionFacade.ts`

- `useCoreSelection(state)` フックが `start / addMove / removeMove / removeMovesByPurpose / transitionMode / reset / end` API + `previewState` 派生を提供。
- 散在していた React state（`coreMoveTransfers` / `pendingPlacement.reserveTaken` / `pendingCostPayment.cardAmounts` / `pendingSeparation.coreDistribution` / `pendingCoreShoot.cardAmounts` / `trashDistAllocations` 等）を draft 1 本に統合。
- `previewState` は `useMemo(() => applyDraftCoreMoves(state, drafts), [state, drafts])` で導出。`coreDisplayOverrides` / `soulCoreDisplayOverrides` は `previewState` と現在 `state` の diff 1 本から計算する。
- `transitionMode(next)` は draft を保持したまま mode のみ更新（cost → placement の stage 跨ぎ用）。`start(mode)` は draft purge を伴う通常開始。

### preview の意味論

- preview は **コア配置数 + ソウルコア位置までを正確に表示**する。CE / SBA 派生の盤面変動（Lv 変動による BP 変化、コア解放の連鎖等）は **preview に反映しない**。
- 確定後に `recomputeAndRebuildContinuousEffects` + SBA が走り、最終 state は preview と差分が出ることがある（仕様）。
- 詳細は [issues/archive/P3-46/implementation-plan.md](../../../issues/archive/P3-46/implementation-plan.md) のリスク表を参照。

## Leave-Field 時の設計

leave-field 時のコア移動先は

- 通常コア
- ソウルコア

で別 override を持てるようにすると、`void` と `removed_from_game` の扱いを安全に分けやすい。

## ライフ混在への追加方針

- `resolveLifeDamage()` は `life -> reserve` の特殊ケースとして残す。
- 一方で効果起因のライフ移動は
  - generic な `ライフのコア1個`
  - explicit な `[ソウルコア]`
  - `[ソウルコア]以外`
  を区別できる入口に寄せる。

そのため、少なくとも内部APIでは次を持ちたい。

- `LifeCoreDestination`
- `LifeCoreMoveEffectKind`
- `getAvailableLifeCoreMoveChoices()`
- `moveLifeCoreByEffect()`

## 実カードフローとの接続

### マジック

`useMagicCardAsAction()` に

- `resolveEffect`
- `getHandWrittenEffectResolver(cardNo)`

のどちらかを渡し、cardNo ごとの hand-written resolver から `moveLifeCoreByEffect()` を呼ぶ。

### Leave-Field 系個別効果

cardNo ごとの hand-written resolver から

- `queuePendingLeave()`
- `LeaveFieldCoreDestinationOverride`

を使って、`pendingLeaveKind` とコア移動先 override を同時に発行する。

### Source Kind 非依存レイヤ

resolver 自体は `magic` 専用 context に閉じず、

- `EffectActionContext`
- `HandWrittenEffectResolver`
- `executeHandWrittenEffectResolver()`

のような source-kind 非依存レイヤで、`spirit / nexus / system` 効果へ流用する。

その `EffectActionContext` には、少なくとも

- `chosenLifeCoreKind`

のような入力選択ヒントをオプションで持たせ、generic なライフ移動効果でも action 層から resolver 層へ選択を渡す。

### 実アクション層

実アクション層には

- `useMagicCardAsAction()`
- `useFieldCardEffectAsAction()`
- `useSummonAsAction()`
- `usePlaceNexusAsAction()`

を置き、source kind ごとに宣言/ログ/cleanup を分けつつ、内部 resolver は共有する。

hand card action では、少なくとも

- `paymentSources`
- `enterFieldCorePlacements`

の 2 段入力を受け、コスト支払いと直後コア配置を分離する。

さらに summon/place 後の self-effect を shared resolver で処理するため、

- `chosenLifeCoreKind`
- `getHandWrittenEffectResolver(cardNo)`

も hand card action から渡し、field-card effect 系との実装差分を小さく保つ。
