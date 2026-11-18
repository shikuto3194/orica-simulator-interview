# Test Strategy

## 方針

テストは「カード個別」より先に「ルール骨格」を固める。

優先順:

1. 状態遷移ユニットテスト
2. シナリオテスト
3. リプレイ再現テスト
4. カード個別回帰テスト

## ユニットテスト対象

- 軽減計算
- コスト支払い
- 消滅判定
- 待機状態遷移
- ターンステップ遷移
- 一時効果の失効
- ライフ混在時のコア選択
- `GameState` 不変条件バリデータ
- 合体/交換/分離
- 指定アタック可否判定

## 最初に作るべきシナリオ

### 1. マジック使用の標準手順

- 宣言
- 支払い
- スタック窓を開き、応答を処理して閉じる
- 窓が閉じた後、解決時に対象を選ぶ
- 主効果
- 派生効果
- トラッシュ移動

### 2. 支払いで消滅したスピリットの遅延移動

- コア支払い
- 消滅待機
- 元効果継続
- 派生効果解決
- 最後にトラッシュ
- 発生元の効果チェーンとその子孫が解決を閉じるまで、支払いで生じた離脱は保留する。無関係なチェーンだけが残るケースと、全体解決が続くケースを区別する。`effectQueueSummary` は表示専用。

### 3. 待機状態中の対象制限

- 消滅待機中カードに通常効果を当てようとして失敗
- 消滅関連効果だけ通る

### 4. ブレイヴの分離

- 追加コア補填
- 疲労状態の引き継ぎ
- 2 体の独立主体化

### 5. 指定アタック

- アタック宣言で発動したバーストを解決し終えたあと、まだ指定アタックが成立していれば通常フラッシュ窓を飛ばす
- 対象が疲労でもブロック扱い
- 対象が消えたら通常アタックへ戻る
- `相手のスピリットのアタック後` バーストは、解決前にアタックしたスピリットがフィールドを離れていたら発動しない

### 5.5. 最小アタック / ブロック宣言

- attack step 中だけ `attack` legal action が出る
- recovered な主体だけ宣言できる
- 宣言時に疲労する
- 同時に 2 体目の宣言はできない
- `window=declare_attack` と `battleEntity.attackState=attacking` が揃う
- `activeAttack` が作られ、primary participant が 1 体で入る
- 効果経由の join helper で 2 体目が参加すると、`activeAttack.groupMode=simultaneous` へ変わる
- `activeAttack` が target / blockAssignments / symbolResolutionOrder を持って初期化される
- defending player の recovered な主体に対して `block` legal action が出る
- `block` 宣言で blocker 側が疲労し、`window=declare_block` と `battleEntity.attackState=blocking` が揃う
- `block` 宣言で `activeAttack.blockAssignments` が更新され、同時アタック時は未ブロック participant に対してだけ次の `block` legal action が残る
- `アタック時` の battle 中即時効果があるなら、`battleImmediateEffects` に prompt が積まれ、`resolve_battle_immediate_effect` legal action が出る
- 同時アタック中でも、turn player がその prompt を好きな順で解決できる
- `battleImmediateEffects` が残っている間は `block` legal action が出ず、即時効果解決後に block へ進む
- `ブロック時` の battle 中即時効果があるなら、`block` 宣言後にも `battleImmediateEffects` に prompt が積まれ、defending player 側の `resolve_battle_immediate_effect` legal action が出る
- `joinActiveAttackAsAction()` による途中参加でも、`join` timing の battle 中即時効果が prompt と legal action に乗る
- battle 中即時効果でライフが減ったとき、`pendingTriggeredEffects` / `pendingBurstChecks` が `source=action_resolution` で積まれる
- `open_battle_flash` / `pass_battle_flash` で `flash_before_block` / `flash_after_block` の最小 open/pass 窓を通せる
- battle flash 窓の priority player に `use_magic` legal action が出て、使用後に priority が相手へ移る
- battle flash 窓の priority player に `timing=flash` の `use_field_card_effect` legal action が出て、使用後に priority が相手へ移る
- block が 1 件も無いまま防御側が `decline_block` を選ぶと、後半フラッシュを経由せず `executeBattleResolution` まで直接進む。block が 1 件でもあれば `decline_block` は「残りはブロックしない」完了宣言（`blockDeclarationCompleted`）になり、`flash_after_block` を `pass_battle_flash` で閉じた時点で同じ解決へ自動連鎖する（開始専用の legal action `start_battle_resolution` / `resolve_battle_resolution` は無い）
- 前半フラッシュ終了時に未ブロックの攻撃参加体が場に残っていなければ、防御側の「ブロックしない」確認を挟まず `executeBattleResolution` に進む。
- `executeBattleResolution` で `window=battle_resolution` に入り、`battleResolutionGroup` snapshot が作られ、blocked / unblocked participant を同じ group に保持できる
- 同じ解決内で、unblocked 側ライフ減少 / blocked pair の BP 比較 / battle 起因破壊待機が group として処理される
- group 終端のステージングで、破壊待機を登録し、ライフ減少と実離脱に由来する反応を同じ同時発揮グループへ集める。反応の収集と発揮を個別に確認する。
- `pendingTriggeredEffects` に matching source card が複数あるとき、`resolve_pending_triggered_effect` が source ごとの legal action を返す
- 同じ trigger event に 2 source あるなら、1 source 解決後に pending が先頭へ戻り、2 source 目を続けて解決できる
- `pendingBurstChecks` に matching set burst card が複数あるとき、`resolve_pending_burst_check` が source ごとの legal action を返す
- 通常のバーストは発動宣言への応答中にセット扱いを保ち、発動成立時に対応する `setBurstState` を消費する。発揮後に残りがあれば次の pending を確認する。
- `set_burst` legal action で hand card が burst area へ移り、`burstSetPlayerIdsThisTurn` と `setBurstStates` が更新される
- 既存の set burst があるときは、それを trash へ送ってから別の burst を置き換え set できる
- 通常の source-backed burst は発動宣言への応答窓を開く際に `burst:revealed` を記録し、効果解決後も burst area に残っていれば trash へ移る。
- 手札誘発と同じ宣言タイミングにバーストの発動可否を選ぶ。発動成立後も先行する派生効果が未解決なら効果発揮宣言を待機し、解決後に発揮宣言へ進む（[バースト](../10_rules/04b_burst-rules.md)）。
- burst 効果自身が card を別 zone へ動かしたとき、post-resolution cleanup がその移動を上書きしない
- burst source 自身の no-cost `召喚/配置/使用` を helper と source-backed legal action の両方で固定する
- selected target `magic` の no-cost `使用` を helper と source-backed legal action の両方で固定する
- selected target `spirit / nexus` の no-cost `召喚/配置` を helper と source-backed legal action の両方で固定する
- `playTargetCardWithoutCostAfterResolve` では、target ごとの配置条件を legal action の `targetEnterFieldCorePlacementOptions` へ載せることを固定する
- `useTargetCardWithoutCostAfterResolve` では、selected target `magic` ごとの nested target / life-core choice 条件が `targetFollowUpMagicOptions` に載ることを固定する
- `applyLegalAction()` から `followUpTargetInstanceIds` / `followUpChosenLifeCoreKind` を渡して、追加 target / life-core choice が必要な follow-up `使用` が通ることを固定する
- 同じ cardNo でも `EffectActionContext.resolutionKind` により、burst 本体と通常の `magic` 使用が別 resolver branch に入ることを固定する
- custom で 1 participant に複数 blocker があり得るなら、そのときの assignment 表現を固定する
- invariant で symbol 解決順や block assignment の不整合を拾える
- invariant で `activeAttack` と `battleEntities` の不整合を拾える
- invariant で `battleImmediateEffects` と `activeAttack` の不整合を拾える
- 2体同時アタック時に、両 participant の `アタック時` 効果があるなら、その解決順をターンプレイヤーが選べる
- これは `アタック時` だけでなく、`ブロック時` やフラッシュで差し込まれた battle 中即時効果にも広げて考える
- battle 中即時効果の1つでライフを減らし、さらに派生効果でもライフを減らしたなら、`ライフが減ったとき` が複数回発揮する
- 2体同時アタックの `⑤バトル解決` では、ライフ減少/BP比較/破壊判定を participant 完全逐次ではなく group 単位で扱う
- 2体同時アタックのライフ減少後バーストがバトル解決の節目まで効果発揮を待つ例（Q26336）と、ライフ減少から派生したBP変化が最終破壊判定に反映される例（Q26337）を区別する。
- 2体同時アタック中の `アタックしたとき` が group 1回扱いになる裁定ケースを再現できる

### 6. エンドステップ

- 終了時効果
- 一時効果失効
- ターン終了

### 7. ライフ混在時のコア移動

- ライフを移動元とする汎用の `ライフのコア1個` では、許された移動先へ通常コアとソウルコアの両方が候補になる。ライフを移動先とする場合、ソウルコアは本文で明示された効果だけが置ける。
- `to void` のような destination restricted ではソウルコアが候補から外れる
- explicit な `[ソウルコア]` 指定ではソウルコアだけ動く
- `[ソウルコア]以外` 指定では通常コアだけ動く
- `playMagicCardAsAction()` の hand-written resolver lookup 経由でも、この 3 パターンが実カードフローで通る
- `EffectActionContext` を使った非マジック source でも、同じ hand-written resolver が流用できる
- `useFieldCardEffectAsAction()` からも `spirit / nexus / system` の 3 source kind で同じ resolver が通る
- `getLegalActions()` が field-card effect を legal action として列挙し、候補 target を effect filter つきで返せる
- `applyLegalAction()` から `useFieldCardEffectAsAction()` へ委譲しても、同じ resolver とログ経路で通る
- `chosenLifeCoreKind` を `playMagicCardAsAction()` / `applyLegalAction()` から渡し、generic なライフ移動でも通常/ソウルの選択を実カードフローで固定できる
- `getLegalActions()` が `availableChosenLifeCoreKinds` / `requiresChosenLifeCoreKind` を返し、追加選択が必要な合法手を表現できる
- `getLegalActions()` が `summon` / `place_nexus` を列挙し、`reducedCost` と支払い候補を返せる
- `applyCardCostPayments()` が reserve / field-card source の両方を処理し、支払い起因消滅を pending leave として発行できる
- `applyLegalAction()` から `summon` / `place_nexus` runner を呼び、`paymentSources` と `enterFieldCorePlacements` を使って実行できる
- `summon` は最低Lvに必要な初期コアが足りないと失敗し、`place_nexus` は 0 コアでも通る
- `enter_field_core_placement_forbidden` を持つ特殊ネクサスでは、`enterFieldCorePlacementRule=forbidden` が legal action に出て、`enterFieldCorePlacements` を渡すと失敗する
- `keywordTags` の `enter_field_core_placement_rule_*` / `min_*` / `max_*` を使うカードでは、`minimum / maximum` が legal action に出て、上限超過や不足が runner 側でも同じ条件で失敗する。配置の基本規則は独立コア管理と印字カード種別、最低数は必要なLvのコア数から判定する。タグは個別上書きに使い、旧カード番号別登録は廃止済み
- `playSummonAsAction()` / `placeNexusAsAction()` でも、field-card source 支払いでコア不足になったカードは resolver 中は `pendingLeaveCause="cost_payment"` のまま場に残り、chain 終端で flush される
- `runActionMainResolution()` を直接使う battle/action 系でも、pre-existing な `cost_payment` pending leave が queue 中は残り、chain 終端で flush される
- `summon` / `place_nexus` でも `getHandWrittenEffectResolver()` を通じて self-effect resolver が実行され、chain log と cleanup が残る
- hand card action でも `chosenLifeCoreKind` を summon/place 後 resolver へ渡せる
- `getRegisteredHandCardEffectActions()` を使って、target 選択つき summon/place effect を legal action として列挙できる
- `applyLegalAction()` から `summon` / `place_nexus` の resolver へ `targetInstanceIds` を渡し、target 必須/候補外 target を失敗系テストで固定できる
- `queuePendingLeave()` と `createTargetCardPendingLeaveResolver()` を通じて、個別効果 resolver から leave-field override 付き pending leave を発行できる
- その resolver を `magic` と `field-card effect` の両方の実カードフローで通せる

### 8. `GameState` 不変条件の崩れ検知

- `effectQueueEntries` と `effectQueueSummary` のズレを検知する
- `PlayerState.soulCoreLocation` と、ソウルコア数フィールド（`CardInstance.soulCoreCount` と各プレイヤーの reserve / trash / life の `*SoulCoreCount`）または指す場のカードとの不整合を検知する（旧 `CardInstance.soulCoreAttached` は snapshot v2 で削除済み）
- `pendingLeaveEntities` と card 側の pending leave 状態の不整合を検知する

## ログ順の検証

最終盤面に加え、次のログ順を検証対象とする。

- action log
- effect log
- chain log
- cleanup log

現在の盤面ログ回帰は各テストが `state.log` の期待値を個別に検査する。共通のログ用ゴールデン基盤を追加するかは保留。

## カード追加に備えた形

現状テストは `packages/rules-core/test/*.test.ts`（カテゴリ別：`battle-system.test.ts` / `burst-effect-activation-e2e.test.ts` / `accel-change-system.test.ts` / `core-system.test.ts` / `effect-interpreter.test.ts` など。合法手・支払い・pending 系の広い回帰は `index.test.ts`）に直置きしている。固定データは `packages/rules-core/test/fixtures/`（snapshot・監査JSON等）、GUI・API 経路は `apps/playground-web/test/` と `e2e/`。
想定する将来分類（未整備、**現行リポジトリには未存在**。上記の既存 fixtures は別用途）:

- `fixtures/rules/` — ルール骨格ケース
- `fixtures/cards/` — カード個別ケース
- `fixtures/replays/` — 実戦再現ケース

テスト数が増えて分類の必要が出た段階で上記へ切り分ける。それまでは `*.test.ts` 単位で題材ごとにファイルを分けている。
単体入口は [単体確認](../00_meta/unit-test-entry.md)、finish/push/merge の検査は [検証運用](../00_meta/harness-validation.md)、e2e は [e2e 実走](../00_meta/e2e-run.md)、乱数対戦の検査は `pnpm fuzz`（固定回帰seedを含む）。

## 完了条件

- 主要 P0 ルールに対して、成功系だけでなく失敗系テストがある。
- バグ修正時は再現テストを先に追加する。
- AI 対戦ログの再現は、行動列の再実行をどこまで完了条件にするか確認待ち。保存棋譜は [盤面フレーム再生](../25_gui/19_replay-and-rematch.md)。ルーム復旧のイベント再実行は `apps/playground-web/test/game-api.test.ts` が、乱数を含むライブ状態との一致を検査する。AI対戦全体の行動再実行の専用回帰は未確認。fuzz の失敗は seed で再現する。
