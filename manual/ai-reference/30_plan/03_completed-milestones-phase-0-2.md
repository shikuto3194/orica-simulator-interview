# Completed Milestones: Phase 0-2

このファイルは、Phase 0 から Phase 2 までの完了履歴です。
通常は [03_completed-milestones.md](./03_completed-milestones.md) から辿ります。

## 2026-09-17: 六・七の軽減シンボル

- 要求側の `<六>` を赤紫緑白黄青、`<七>` をそれらと黒へ展開し、既存の最大マッチングで1枠ずつ軽減するよう修正。印字・効果による追加・置換に共通適用。
- `six-seven-reduction.test.ts` に各色・特殊シンボル除外・重複使用防止・通常色との競合・効果経由の25ケースを追加。BSLH01の誤った七要求の期待値とアーツ支払い額も是正。
- ユーザー指定（信頼度 C）を [コスト支払い](../10_rules/03a_cost-payment.md) に記録。

## Phase 0: 調査基盤

- `manual/README.md` と `manual/ai-reference/README.md` を入口として整備。
- `00_meta/source-map.md` にソース URL と信頼度ラベルを集約。
- `00_meta/open-questions.md` に断定保留項目を逃がす運用を固めた。
- 公式ソースと独自カードサイトの読み順を整理（`Q&A / 裁定 > カード本文 > errata > ユーザー確認`）。

## Phase 1: ルールコア

- TypeScript + Node.js + pnpm workspace で開発基盤を作成。
- `packages/rules-core`、`packages/card-data`、`apps/cli`、`apps/playground-web` を初期化。
- `GameState`、`CardDefinition`、`CardInstance`、`BattleEntity` の骨格を用意。
- `Start -> Core -> Draw -> Refresh -> Main -> Attack -> End` のステップ進行を実装。
- `rules-core` を UI 非依存のコアとして切り出し、`model / turn-system / state-based-actions / summaries` へ整理。
- `GameState` 不変条件バリデータの基礎を整備。
- 各ステップの自動処理を `advanceStep()` に実装:
  - コアステップ: ボイド→リザーブ1コア。ドローステップ: デッキ→手札1枚。スタートステップ: デッキアウト判定。
  - ステップ固定処理は誘発チェック対象外。
- ゲーム開始手順・先攻1ターン目アタック禁止・ボイド初期コアプール（各プレイヤー200個）のルールをマニュアルに記載。
- `initializeGame()` 関数を実装（デッキシャッフル→手札4枚ドロー→ライフ5コア→リザーブ4コア→ボイド382コア）。定数 `CORES_PER_PLAYER=200` / `STARTING_LIFE_CORES=5` / `STARTING_RESERVE_CORES=4` / `STARTING_HAND_SIZE=4` を追加。
- 先攻1ターン目のアタック禁止を `getAvailableAttackLegalActions` に実装（`turnNumber === 1` かつ `playerOrder[0]` のとき空配列）。
- GUI (`BattleScreen.tsx`) と API (`server/game-api.ts`) を `initializeGame()` に統合。旧 `createDemoGameState` のハードコード初期化を廃止し、正規のゲーム開始手順（シャッフル→手札4枚→ライフ5→リザーブ4→ボイド382）で動作するようにした。
- `deckCount` / `handCount` と `cardInstances` の同期バリデーションを `game-state-invariants-core.ts` に追加。デッキゾーンにカードがある場合のみ検証（テスト等の抽象カウンタモードではスキップ）。
- `mulliganHand()` 関数を実装。手札をデッキに戻してシャッフルし再度4枚引く。呼び出し側で1回制限を制御。
- ソウルコアの初期配置選択を `initializeGame()` に追加。→ **Ver.17.0 で強制化**: `useSoulCore` パラメータ削除。リザーブに通常コア3+ソウルコア1で固定。

## Phase 2: コスト・使用・解決

### EDH-0041 スタック後の不成立・待機コア裁定整合（2026-09-04）

- 正源: [待機コアとスタック後の不成立処理](../10_rules/03f_stack-failure-and-waiting-cores.md)。ユーザー確認「スタック効果の結果は残す」を含め、旧 `76ea5fd12` の不足時ロールバック／ブレイヴ0コア成立処理を訂正。
- 待機コアを支払い・維持配置元として共通判定し、コア除去やLvコスト変化で既存待機を消滅へ遷移させない。残存コアは実移動時まで保持する。
- 窓後の必要コア不足はカード種別によらず場入り前にトラッシュへ。宣言自体の違法化だけを支払い差分で取り消し、応答結果を保持。窓前の配置指定も再検証する。
- 任意召喚時誘発の辞退後、元チェーンの支払い待機だけを再flushする。子チェーン／継続の共通終了ゲートを保持し、無関係な待機は対象外。
- verifier指摘の追加回帰: 通常召喚許可の使用回数返却・同ターン再宣言、BSSL01-M01の煌臨元復元と応答によるホスト移動の保持、魂状態/鍵ブレイヴ群の所属復元、BSKB01-M02の宣言由来カウント/保護カウント取消と応答カウントの保持。
- 横展開回帰: BSFT01-X01の宣言違法化では除外した鍵ブレイヴとコア・合体関係も返却する。応答が鍵自身またはホストを移動した結果は保持し、除外コスト選択より前から宣言差分を記録する。
- 回帰: 通常／アルティメット／ブレイヴの不成立、カウント・ソウルコア喪失、待機4種、再配置選択、直接合体／配置禁止例外。実カードシナリオ `edh-0041-waiting-cores` でAlice GUI／Bob RESTの支払い→配置→任意誘発辞退→実移動を確認。
- 元seed `1458180927` の同設定再実行は自然終局1・tickets0。証跡: `artifacts/effect-debug/edh-0041-rule-alignment-20260904/`（ローカル生成物）。

### コスト支払い基盤
- 軽減計算器（ダブルシンボル、多色片側使用対応）。`reducedCost → additionalCost → finalCost` パイプライン。
- `reserve` / field-card source を跨ぐ共通支払い層。
- `life` 混在用 API（`getAvailableLifeCoreMoveChoices` / `moveLifeCoreByEffect` / `resolveLifeDamage`）。
- ソウルコア分岐（`generic` / `explicit [ソウルコア]` / `[ソウルコア]以外`）。

### マジック使用フロー
- 宣言 → コスト確定 → 支払い → target 選択 → 効果解決 → SBA / flush / トラッシュ移動。
- `in_use` ゾーン（hand → in_use → field/trash）。マジック無効化時の使用判定。6段階ログ。
- 実行不能時のロールバック（`tryApplyLegalAction`）。

### pending 待機層と burst
- `pendingTriggeredEffects` / `pendingBurstChecks` の待機層。source ごとの legal action 列挙。
- burst の set / reveal / resolve / post-resolution cleanup ライフサイクル。
- burst source 自身の no-cost 召喚/配置/使用。follow-up card (play target / use target magic) の composition 対応。

### 効果テキスト表現 E-1〜E-10
- **E-1** 強制/任意フラグ: `executionMode` + optional skip。
- **E-2** 効果種別 taxonomy: `EffectCategory`（activated / triggered / continuous / replacement / delayed）。
- **E-3** 効果競合優先順位: `EffectForceLevel`（prohibition / obligation / normal）+ `getForceBlockReasonForTag`。
- **E-4** 効果防止優先順位: `EffectPreventionLevel` + `canEffectPenetrateDefense` + legality / resolver 統合。
- **E-5** 同時効果合成: `createSimultaneousCompositionResolver` + `simultaneousGroupId` + 5経路 composition 反映。
- **E-6** ことで構文: `createConditionalCostCompositionResolver` + 双方向チェック + legality 事前フィルタ。
- **E-7** そうしたとき構文: `createConditionalResultCompositionResolver` + step 0 実行後の成功判定。
- **E-8** 時間指定効果: `ContinuousEffect` layer + `recomputeContinuousEffects` + `recomputeBattleEntityBp` + `bp_modifier` / `symbol_addition` CE の end-to-end。
- **E-9** 使用回数制限: `EffectUsageLimit` + `canUseEffectByUsageLimit` + `recordEffectUsage` + `clearExpiredEffectUsageRecords`。
- **E-10** 解決途中再評価: `EffectReevaluationPoint` + `runReevaluationAtTiming` + target_validity / effect_suppression / prevention_clash。

### 派生効果キュー拡張
- `StructuredTriggerEvent` + `TriggerEventMatcher` で structured trigger model へ移行。
- `collectTriggerEventsFromStateDelta` で enter_field / leave_field / hand_increase / summon / place / vanish / bounce を検出。
- `collectAndQueueTriggerReactions` で trigger collection を共通節目に統合。
- burst 解決後・window 遷移の trigger collection 接続。
