# 使用会計の保存形式と版付き migration

親: [20_effect-usage-accounting.md](20_effect-usage-accounting.md)。契約: `issues/archive/P3-170/compatibility.md`。
ソースは `packages/rules-core/src/`、`test/` は `packages/rules-core/test/` 基準（apps は明記）。
旧形式の使用済みを失う変換は機能不具合として扱う。変換できない旧データは**明示エラー**で、推測補完・空初期化・fallback はしない。

## 版と入口

| 項目                 | 内容                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 会計 schema 版       | `GameState.effectAccounting.version === 1` が新形式。無い、または旧キーが残る state は旧形式。room の raw GameState も同じ印を持つ。                                       |
| snapshot 版          | `GAME_SNAPSHOT_SCHEMA_VERSION` = 4。v1〜v3 は読込時に migration を通す。                                                                                                   |
| 入口                 | `effect-usage/migration.ts::migrateEffectAccounting(raw, { getCardDefinitionById })`。旧形式を変換する入口。検出・旧encoder語彙の参照は `scripts/effect-usage-ssot.mjs` の限定例外。 |
| 呼出し               | `parseGameSnapshot(input, { getCardDefinitionById })`、room の DB 復元 `normalizePersistedState`（game-api）、replay viewer の snapshot / 生 state frame。                  |
| backfill との順序    | migration を必ず `backfillOptionalStateFields` より前に通す。backfill は旧データが非空で会計が無い state を拒否する（`effect-usage/legacy-guard.ts`）。                     |
| 定義解決             | 旧 `effectUsageRecords` / 神技キー / 煌臨キーの変換に必要。非空なのに渡されていなければ `definitions_required`。parser で名前を推測しない。                                |
| 入力                 | 変更しない（deep copy して変換）。成功は `{ok, state, changed}`。変換済みは同じ参照を `changed:false` で返す。                                                              |
| 冪等                 | 2回変換した結果は1回と一致する。変換後は旧キーを除去し、`stepOrdinalThisTurn` が無ければ 0（旧は現在のステップが序数0）。                                                   |
| 新旧両方             | 旧データが空なら旧キーだけ除去。非空は変換結果と既存の会計の使用量・権利が一致するときだけ等価として旧キーを除去し、それ以外は `legacy_new_conflict`。権利・旧 receipt は常に競合。 |
| 未知の会計版         | `unsupported_accounting_version`（`state.effectAccounting.version`）。room は読込時点で拒否するため更新前に弾かれる。新規ゲームを黙って開始しない。                          |
| 会計の形・値         | 版1でも `accounting-shape.ts` が形と値を検査する（`nextOperationSeq`・配列・bucket の量/期間/重複キー・operation の delta）。壊れていれば `invalid_accounting_shape`（path は `state.effectAccounting.…`）で拒否し、TypeError や負量による枠の増加にしない。意味の検査は台帳の consume が行う。 |
| 宣言時消費済みの旧フラグ | `usageLimitConsumedOnPrivateDeclaration`（pending 誘発）・`ContinuousEffect.usageLimitConsumed`・スタックの `mirageSetCountExemptionConsumed`・step 文脈の `consumedUsageGroups` は、対応する枠を一意に特定できないので変換しない。値が真の旧フラグを持つ対戦途中の state は `unconvertible_in_flight_usage_flag`（path 付き）で読込を拒否する（compatibility.md の表「取消可能なpending/receipt」行: 対戦途中の読込を失敗させる）。黙って落とすと解決時に再評価され、必須誘発が消える。 |

## 配備の前提と版の扱い

- 新旧サーバーが同じ room を書き換えない。DB 側に版ガードは無いので、新形式を書く版のデプロイは旧サーバーを止めてから切り替える（ローリング配備しない）。旧サーバーが新形式 room に旧フィールドを足すと、次の読込は `legacy_new_conflict` で明示エラーになる（原本は保持される）。
- DB snapshots の外殻 `schemaVersion: 1` は GameSnapshot の schema（4）と別。APIの状態復元・再生は `normalizePersistedState`、クライアントのsnapshot再生は `parseGameSnapshot` で移行する。取得GETは読める保存値を返し、サーバー用checkpointの state は伏せる。
- 版1の新形式 state の入れ子（`priorStateSnapshot` など）は、同じ書込みで新形式に揃って書かれる前提で検査しない（高速経路）。高速経路の競合検出と形検査には親の会計形式を使う。正常な親から高速経路に入った場合、入れ子単独の混在・破損は検査しない。

## エラー形式

```ts
{ ok: false, error: { code: "usage_accounting_migration_failed", path, reason, detail? } }
```

- `path`: 入れ子を含む構造だけ（`state.effectUsageRecords[3]`、`state.pendingZoneSelection.priorStateSnapshot.usedDivineSkillKeysThisTurn[0]`）。カード名・個体IDは含まない。
- `detail`: 管理用（カード名・個体IDを含みうる）。server ログにだけ出し、利用者・相手プレイヤーへの応答には載せない。
- API: 既存の JSON エラー形式に `code` と `path` を載せる（HTTP 500、一般的な文言、`requestId`）。DB 原本は変更しない。
- snapshot: `parseGameSnapshot` が `{ ok:false, error, migrationError }` を返す。App は既存の `snapshotError` 表示、replay viewer は例外メッセージ。

## 変換規則

期限の判断は旧の `isRecordInDurationScope` と同じ（turn=同ターン、step=同ターンかつ同 step 名、battle=同 attackId、game=常に有効）。期限切れは破棄、game は残す。
変換は各機構の現行の site 構築関数・`usageIdentityOfLabel`・`usageConstraintsOf`・`usageContextOf` と同じ関数で枠を作る（別実装で識別を作らない）。

| 旧                                                                                       | 新                                                                                                                                                             | 拒否条件（reason）                                                                                                                            |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `effectUsageRecords`                                                                     | 定義から引いた制限の一覧で枠を作る。同 duration の制限 m 個は count を m で割る（H3）。記録時の世代・誘発 key を保つ。使用者は playerId、無ければ controller=owner。 | `usage_label_unresolvable` / `usage_record_matches_no_limit` / `usage_record_count_not_divisible` / `usage_record_group_mismatch` / `usage_player_unresolvable` / `definition_not_found` |
| `effectOccurrenceRecords`                                                                | 観測（`recordEffectOccurrence`）を count 回                                                                                                                    | `usage_player_unresolvable`                                                                                                                   |
| `usedDivineSkillKeysThisTurn`                                                            | `divineSkillUsageSite`（once=per_instance、once_per_name=per_card_name、件数=使用回数）＋宣言の観測。turn 制限の無い技の死に書きは回数枠に載せない                | `divine_skill_key_unparsable` / `divine_skill_not_found` / `divine_skill_player_unresolvable` / `divine_skill_limit_mismatch`                   |
| 煌臨 3 配列                                                                              | `adventUsageSite`。`player:名前`（trash host）は使用者付き。`name:` と cardNo は使用者を含まない（H1）ので、その名前の所有者が1人で他者の操作個体も無いときだけ復元 | `advent_user_unresolvable` / `advent_definition_unresolvable` / `advent_key_unparsable`                                                       |
| I05 count gain / I06 tapless / I07 declare gimmick / I10 use-cost-gate / I08 mirage 免除 | 各機構の consume 関数。I07/I13 は CE id で CE を引き、登録時の構造 path（provenance）で枠を作る。mirage `cardNo="*"` と最古の `...UsedPlayerIds` は legacy 枠（player-wide）で期限まで維持 | `continuous_effect_missing`（消えた CE を勝手に捨てない）/ `card_instance_missing` / `*_key_unparsable`                                       |
| I13〜I15（ライフ減少累積・シンボル制限・宣言数）                                         | `recordLifeReductionQuantities` / `recordSymbolAdditionRestrictedCount` / `recordGimmickDeclaration`                                                           | `quantity_player_unresolvable` / `continuous_effect_missing`                                                                                  |
| `pendingAdditionalAttackGrants`（各要素=1権利）、`activeAttack.connectBattleGrant`、`pendingConnectBattleDecision.remainingUses` | 由来不明の synthetic legacy grant（`sourceRef = rule / legacy`）。通常能力の共有枠に混ぜない。決定待ちは `grantId` を参照                                       | `connect_battle_inconsistent` / `grant_not_representable`                                                                                     |
| `recordedUsage` / `refundableUsageEntries` / `declarationUsageDeltas` / `declarationOccurrenceDeltas` | 旧 refund が戻していた枠（現在のターン・ステップの最新の一致記録）を差分に持つ操作を合成し、`operationIds` / `declarationUsageOperationIds` に置き換える。一致記録が無ければ差分なし（旧 refund も no-op） | `receipt_source_ambiguous` / `receipt_limit_mismatch`                                                                                          |

旧ラベルの解決: `effect:N`（`:choice:k` の変種を含む）、`__step:…`、`magic`（制限付きの効果が1つのカードのみ）、場の起動効果 `kind:N` と `hand_activated:N`（登録の生成関数で引く）、`oracle:summon_advent` / `placement_oracle` / `divine_skill:N`（各機構の site）、エンジン固定の `contract_combine_proxy` / `field_magic_pre_cost_trigger`。これ以外は `usage_label_unresolvable`。

## 入れ子と追加ターン

- `GameState` を内包する型は、`model.ts` の型から導出した型グラフ `effect-usage/nested-states.ts`（生成物）だけを訪問する。`priorStateSnapshot` / `effectResolutionBeforeState` / `resumePreviousStepPreState` / `originalState` / `beforeState` / `triggerBeforeState` / `stateSnapshot` / `conditionalCostOriginalState` / `resolutionSegmentBeforeState` と、`ExtraTurnState.returnContext` を持つ約 90 型。各入れ子の state は独立に変換する。
- 型グラフと `model.ts` の一致は `test/effect-usage-nested-states.test.ts` が検査する。食い違ったら `node scripts/generate-effect-usage-nested-states.mjs` で再生成する。
- 運搬フィールド（`recordedUsage` / `refundableUsage` / `normalHandPlayRollback`）は同じ型グラフで訪問する。
- 追加ターン（`returnContext` の連鎖、入れ子を含む）: 台帳は入れ替えない。中断元の turn / step / battle 記録は中断元の時計（`returnContext.turnNumber`・`turnContext.stepOrdinalThisTurn`・`activeAttack.attackId`）で台帳へ移す。game 記録は現行 state が正で、退避側の game 記録は二重加算しない（旧の復帰は現行 game ＋退避の非 game を合成していた）。退避した `turnContext` の旧キーは除去し、`stepOrdinalThisTurn` を補う。

## 検証

`test/effect-usage-migration.test.ts`（通常・変換・競合・復元不能・入れ子・追加ターン・receipt・冪等・snapshot 版）、`test/effect-usage-nested-states.test.ts`、`test/legacy-effect-usage-fixtures.test.ts`（fixture と定義の一致）、`apps/playground-web/test/game-api.test.ts`（room 復元）、`apps/playground-web/test/replay-viewer.test.ts`。
旧形式 fixture は `packages/rules-core/test/fixtures/legacy-effect-usage/`（`real-*.json` は旧コードで作った実スナップショット）。

## 未検証

実 room / GUI / API での旧 room 復元は未実施（unit までの検証）。実 room(認証付き 2 アカウント)の確認は利用者が免除した（2026-11-09。実施した確認ではない）。
