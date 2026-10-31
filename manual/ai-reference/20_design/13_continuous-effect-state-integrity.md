# 継続効果の状態整合性

## 目的

現在値・キャッシュ・解決時snapshotの区別と2026-10-01のエンジン横断監査は、[派生状態の更新責任](13a_derived-state-ownership-audit.md)を参照。

`activeContinuousEffects` (`GameState`) は、フィールド上のカード、およびセット中の発揮を明示したカードが持つ **継続効果 (timing.kind === "continuous") のスナップショット** として機能する。
通常召喚パイプラインを通らないカード配置経路 (シナリオ直接配置・将来のセーブ復元・テストファクトリ) で CE の登録が抜け落ちると、無料マジック使用権・BP 修正・色置換などの効果が機能しない。

この整合性を「(1) 検出」「(2) 補正」の 2 軸で扱うのが本設計の責務。

## 背景: 既存パイプラインの偏り

| 配置経路 | continuous 効果の CE 登録 |
| --- | --- |
| `playHandCardWithPlacement` / `placeNexusAsAction` (通常召喚) | ✅ `runActionMainResolution` の `play_card_action` 中に `tryExecuteEffects` が `effect.timing.kind === "continuous"` のみフィルタして `executeEffect` 経由で push |
| `inst()` (シナリオ直配置) | ❌ `cardInstances` 配列に append するだけ |
| 将来のセーブ復元 | ❌ 想定なし |
| テストファクトリ `createCardInstance` 直配置 | ❌ 同上 |

`recomputeContinuousEffects` (`legal/legal-actions-shared.ts`) は期限・対象在場と、lookupがある場合の元Effectの発揮資格を再評価する。未登録CEの補完は `recomputeAndRebuildContinuousEffects` が担う。

### 発揮資格の正源

- 常時効果はprovenanceで元Effectへ戻り、`isContinuousEffectStillValid` から共通の `evaluateEffectApplicabilityForCard` / `evaluateCondition` を使う。整理用に効果種別ごとのゾーン規則・applicabilityフィールド列挙を持たない。
- 適用先がプレイヤーかは `state.players` のIDで判別する。効果名の許可リストを追加しない。
- 明示ゾーンで発揮中の自己対象CEを、対象がfield外という理由だけで削除しない。他カードへの付与は対象在場を要求する。
- 起動/誘発効果が解決済みなら、発動時のLv・合体状態等を維持条件にしない。既存のdurationに従う。
- 定義/provenanceの無い旧CEのゾーンmetadataは互換用。新しい保持例外のためにコピーせず、元Effectを参照する。定義lookup無しの整理は期間の処理と旧metadataの評価だけに限られる。
- 再発検出は `applicability-header-audit.test.ts`、`applicability-lifecycle.test.ts`、`continuous-effect-card-pool-lifecycle.test.ts`。全カードの本文照合と登録→整理の双方を検証する。監査範囲は [2026-09-26履歴](../30_plan/03_completed-milestones-phase-6-applicability-audit.md) を参照。

## 設計方針

### 検査と補正の分離

```text
collectContinuousEffectIntegrityIssues(state, getDef): Issue[]   // 純粋関数
rebuildContinuousEffectsFromField(state, getDef): GameState       // 副作用あり
```

- **検査**: テスト・CI 用の不変条件チェック。副作用なし
- **補正**: シナリオ初期化・セーブ復元時に明示呼び出し。`executeEffect` をリプレイして CE を登録

### 重複登録回避: provenance + 緩い fallback

`ContinuousEffect.provenance` は `effectIndex` / `stepIndex` と、通常の `effects` 以外を指す場合の `definitionPath` を持つ。チェンジ・アクセル・神技はコンテナへの位置参照であり、発揮条件は元Effectから読む。`definitionPath: null` は定義外の合成効果、未指定は従来の通常 `effects` を意味する。

リビルダは参照先コンテナを区別したうえで `(sourceInstanceId, effectIndex)` ペアを比較し、別コンテナの同じindexを同一効果とみなさない。
旧パイプライン経由の CE は `provenance` が未設定なので、`(sourceInstanceId, modifierTag)` の **緩い一致** に fallback する。

| ケース | 重複検出 |
| --- | --- |
| リビルダ → リビルダ (冪等性) | `provenance.effectIndex` 一致 |
| 通常召喚 → リビルダ (補正後召喚) | `modifierTag` fallback |
| リビルダ → 通常召喚 (将来) | 通常パイプライン側は重複検出しない (要拡張・現状リスク低) |

### executor native provenance

`ExecuteEffectOptions.effectIndex` を経由して、`executeEffect` の step ループが `{ effectIndex, stepIndex }` を `executeNativeAction` 〜各 executor に伝搬する。CE 生成 executor (14 種) は受け取った provenance を新規 CE にそのまま格納する。

```ts
// effect-interpreter.ts: step ループ
const nativeResult = executeNativeAction(
  activeAction, state, actingPlayerId, sourceInstanceId,
  getCardDefinitionById, stepCtx, effect, resolvedTargetIds,
  pendingEffectSimultaneousGroupId,
  coreShootDistribution, coreShootSoulCoreInstanceId,
  { effectIndex, stepIndex: i }   // ← 追加
);

// 各 executor (例: executeBpModify):
const newEffect: ContinuousEffect = {
  effectId: nextCeId("bp_modifier"),
  ...
  ...(provenance ? { provenance } : {}),
};
```

これにより通常召喚パイプラインで生成される CE もすべて provenance を持ち、リビルダは `(sourceInstanceId, effectIndex)` ペアで直接重複検出できる。modifierTag フォールバックは旧 CE 互換のためのみ残置。

## 実装ファイル

| ファイル | 役割 |
| --- | --- |
| `packages/rules-core/src/model.ts` | `ContinuousEffect.provenance` 型定義 |
| `packages/rules-core/src/continuous-effect-rebuild.ts` | `rebuildContinuousEffectsFromField()` 実装 |
| `packages/rules-core/src/game-state-invariants-continuous.ts` | `collectContinuousEffectInvariantIssues()` (検査側) 実装 |
| `packages/rules-core/src/game-state-invariants.ts` | `collectGameStateInvariantIssues(state, options?)` で continuous 検査をルーティング |
| `packages/rules-core/src/effect-interpreter.ts` | step ループで `{ effectIndex, stepIndex }` を executor へ伝搬 |
| `packages/rules-core/src/structured-effect-interpreter.ts` | 14 種 executor が provenance を CE に格納 |
| `apps/playground-web/src/App.tsx` | シナリオ初期化時にリビルダを噛ませる |

## 補正対象ゾーン

`field` / `mirage` / `burst` の 3 種を発揮源候補として走査する。

- `field` は表向きの継続効果を通常どおり登録する。
- `burst` / `mirage` は、`applicability.zone` の `burst_set` / `mirage_set`、native action の `duration.scope: "while_set"`、または `appliesToCard: true` の `treat_as` のいずれかでセット中の発揮を**明示した**効果だけを登録する。単に `timing.kind === "continuous"` である Lv 効果は、セット中には発揮しない。
- `burst` は `setBurstStates` に残るセット状態であることも必要とする。
- `set_aside`（手元）は `applicability.zone: "set_aside"` を明示した効果だけを登録し、手元にある間だけ有効な CE は `duration.scope: "while_in_set_aside"` を使う。`while_set` は burst / mirage のセット状態専用である。

ハンド・デッキ・トラッシュ等は原則対象外だが、extra applicability zone を明記した自己対象効果は既存の例外として扱う。

## 補正時の condition / applicability 評価

`executeEffect` は `evaluateCondition` / `evaluateApplicability` を呼ぶため、リビルダ側で再実装は不要。
`condition unmet` (例: 疲労状態の `self_state: "recovered"`) のときは executor まで届かず CE が登録されない。

## 想定呼び出しタイミング

- ✅ シナリオビルド完了直後
- ✅ テスト初期化時 (整合性確認用)
- ✅ セーブデータ復元直後 (`snapshot.ts` の `restoreSnapshot` 経由。`unsafeAllowDuringBattle: true` でガードバイパス)
- ✅ バトル中・フェーズ進行中は `recomputeAndRebuildContinuousEffects` 経由で資格の失効と未登録CEを再評価する。再登録で期間指定効果の期限を延ばさない。

### 安全ガード (2026-04-29 追加 / 2026-05-03 P3-44 で全 pending 網羅)

`rebuildContinuousEffectsFromField` は state が次の条件をすべて満たさなければ throw する:

- `activeAttack === null`
- `stackWindow === null && preDeclarationStackWindow === null`
- `battleResolutionGroup === null`
- `effectQueueEntries.length === 0`
- `pendingTriggeredEffects.length === 0`
- `pendingDeferredTriggeredEffects.length === 0` (同時誘発の宣言完了待ち分)
- `pendingPrivateDeclarations.length === 0` (非公開ゾーン誘発の宣言待ち)
- `pendingBurstChecks.length === 0`
- `battleImmediateEffects.length === 0`

判定関数は `isSafeStateForContinuousRebuild(state)` として独立公開。
invariant collector のように「リビルダの結果を捨てて差分だけ取り、汚染を気にしない」用途では
`RebuildContinuousEffectsOptions.unsafeAllowDuringBattle: true` でバイパスできる。
盤面進行中の本番再評価とセーブ復元は、各共通入口でこのオプションと適切な再構築範囲を指定する。

## CE 種別と推定 modifierTag マップ (fallback 用)

`inferModifierTagsFromEffect` が返す対応表 ([continuous-effect-rebuild.ts](../../../packages/rules-core/src/effect/continuous-effect-rebuild.ts)):

| Action.kind | 推定 modifierTag |
| --- | --- |
| `cost_modify` | `cost_override`, `additional_cost` |
| `bp_modify` | `bp_modifier` |
| `symbol_addition` | `symbol_addition` |
| `treat_as` | `treat_as_*` 5 種 |
| `effect_immunity` | `defense_immune` |
| `effect_resistance` | `defense_immune`, `defense_suppress`, `effect_suppression`, `cannot_*` 6 種 |
| `unblockable` | `unblockable` |
| `prevent_battle` | `prevent_battle_attack/block/both` |
| `prevent_normal_core_move` | `prevent_normal_core_move` |
| `prevent_life_damage` | `prevent_life_damage` |
| `draw_modify` | `draw_modify` |
| `restrict_flash` | `restrict_flash_hand/field/any`（GUI 表示カテゴリ）。詳細ゾーン配列は `metadata.restrictedZones: Zone[]` に保持。`source: "any"` のみ metadata なし。 |
| `rebirth` | `replace_field_exit` |
| `suppress_effect` | `effect_suppression` |
| `override_properties` | `override_properties` |
| `restrict_use` | `restrict_use` |
| `restrict_manifest` | `restrict_manifest` |

## セーブ復元統合

`packages/rules-core/src/snapshot.ts` の `restoreSnapshot(snapshot, getCardDefinitionById)` がエントリポイント。

```ts
// app 側 (App.tsx)
const parsed = parseGameSnapshot(json);
if (parsed.ok) {
  const { state, warnings } = restoreSnapshot(parsed.snapshot, lookup);
  // warnings: 未知 cardNo / drift 補完件数
  setScreen({ kind: "scenario_battle", initialState: state });
}
```

`restoreSnapshot` 内部:

1. `cardInstances` の definitionId 解決可否を確認 → 未解決は warnings に列挙
2. `rebuildContinuousEffectsFromField(state, lookup, { unsafeAllowDuringBattle: true })` を呼ぶ
   - スナップショット時点と現行カードデータで continuous 効果が増えていれば差分を補完
   - 完備済 state なら provenance 一致で素通り (冪等)
3. 補完が発生したら warnings にカウント付きで記録

サーバ側永続化 (snapshots テーブル / 共有 URL 等) は別途 issue 化予定。
現状の v1 はファイルベースの export / import のみ。

## 完了済の周辺懸念

詳細は [P3-18 issue](../../../issues/archive/P3-18/index.md) を参照。

- バトル中ガード (`isSafeStateForContinuousRebuild`) — 解消済
- retrigger 範囲外 — 解消済
- modifierTag フォールバック方針 (恒久残置) — 解消済
- セーブ復元統合 — 解消済
