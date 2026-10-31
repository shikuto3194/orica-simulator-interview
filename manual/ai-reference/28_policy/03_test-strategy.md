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
- 対象選択
- 主効果
- 派生効果
- トラッシュ移動

### 2. 支払いで消滅したスピリットの遅延移動

- コア支払い
- 消滅待機
- 元効果継続
- 派生効果解決
- 最後にトラッシュ
- `effectQueueEntries` が残っている間は flush されず、`effectQueueSummary` は表示専用として扱う

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
- block が 1 件も無いときは、後半フラッシュを経由せず `start_battle_resolution` に進める
- `start_battle_resolution` legal action で `battleResolutionGroup` snapshot が作られ、blocked / unblocked participant を同じ group に保持できる
- `resolve_battle_resolution` legal action で、unblocked 側ライフ減少 / blocked pair の BP 比較 / battle 起因破壊待機が group として処理される
- `resolve_battle_resolution` が終わる前には `pendingTriggeredEffects` / `pendingBurstChecks` を出さず、group 終端でまとめて待機へ積む
- `pendingTriggeredEffects` に matching source card が複数あるとき、`resolve_pending_triggered_effect` が source ごとの legal action を返す
- 同じ trigger event に 2 source あるなら、1 source 解決後に pending が先頭へ戻り、2 source 目を続けて解決できる
- `pendingBurstChecks` に matching set burst card が複数あるとき、`resolve_pending_burst_check` が source ごとの legal action を返す
- 1つの burst を解決したら対応する `setBurstState` が消費され、残りがあれば pending が先頭へ戻る
- `set_burst` legal action で hand card が burst area へ移り、`burstSetPlayerIdsThisTurn` と `setBurstStates` が更新される
- 既存の set burst があるときは、それを trash へ送ってから別の burst を置き換え set できる
- source-backed burst 解決時に `burst:revealed` が出て、解決後も burst area に残っていれば trash へ移る
- `pendingTriggeredEffects` が残っている間は `resolve_pending_burst_check` を出さず、trigger 解決後に初めて burst reveal へ進む
- burst 効果自身が card を別 zone へ動かしたとき、post-resolution cleanup がその移動を上書きしない
- burst source 自身の no-cost `召喚/配置/使用` を helper と source-backed legal action の両方で固定する
- selected target `magic` の no-cost `使用` を helper と source-backed legal action の両方で固定する
- selected target `spirit / nexus` の no-cost `召喚/配置` を helper と source-backed legal action の両方で固定する
- `playTargetCardWithoutCostAfterResolve` では、target ごとの `enterFieldCorePlacement` 条件を legal action へ載せることを固定する
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
- 2体同時アタック中の `ライフ減少後` バーストや派生効果は、group の途中では解決せず `⑤バトル解決` 終端で積まれる
- 2体同時アタック中の `アタックしたとき` が group 1回扱いになる裁定ケースを再現できる

### 6. エンドステップ

- 終了時効果
- 一時効果失効
- ターン終了

### 7. ライフ混在時のコア移動

- generic な `ライフのコア1個` で通常コアとソウルコアの両方が候補になる
- `to void` のような destination restricted ではソウルコアが候補から外れる
- explicit な `[ソウルコア]` 指定ではソウルコアだけ動く
- `[ソウルコア]以外` 指定では通常コアだけ動く
- `useMagicCardAsAction()` の hand-written resolver registry 経由でも、この 3 パターンが実カードフローで通る
- `EffectActionContext` を使った非マジック source でも、同じ hand-written resolver が流用できる
- `useFieldCardEffectAsAction()` からも `spirit / nexus / system` の 3 source kind で同じ resolver が通る
- `getLegalActions()` が field-card effect を legal action として列挙し、候補 target を effect filter つきで返せる
- `applyLegalAction()` から `useFieldCardEffectAsAction()` へ委譲しても、同じ resolver とログ経路で通る
- `chosenLifeCoreKind` を `useMagicCardAsAction()` / `applyLegalAction()` から渡し、generic なライフ移動でも通常/ソウルの選択を実カードフローで固定できる
- `getLegalActions()` が `availableChosenLifeCoreKinds` / `requiresChosenLifeCoreKind` を返し、追加選択が必要な合法手を表現できる
- `getLegalActions()` が `summon` / `place_nexus` を列挙し、`reducedCost` と支払い候補を返せる
- `applyCardCostPayments()` が reserve / field-card source の両方を処理し、支払い起因消滅を pending leave として発行できる
- `applyLegalAction()` から `summon` / `place_nexus` runner を呼び、`paymentSources` と `enterFieldCorePlacements` を使って実行できる
- `summon` は最低Lvに必要な初期コアが足りないと失敗し、`place_nexus` は 0 コアでも通る
- `enter_field_core_placement_forbidden` を持つ特殊ネクサスでは、`enterFieldCorePlacementRule=forbidden` が legal action に出て、`enterFieldCorePlacements` を渡すと失敗する
- hand-written enter-field placement policy を使うカードでは、`minimum / maximum` が legal action に出て、上限超過や不足が runner 側でも同じ条件で失敗する
- shared enter-field placement registry に登録した cardNo なら、追加 lookup を明示しなくても `getLegalActions()` / `applyLegalAction()` / direct runner の全経路で同じ配置条件が使われる
- `keywordTags` の `enter_field_core_placement_rule_*` / `min_*` / `max_*` を使うカードでも、同じ配置条件が legal action 列挙と runner の両方に出る
- `useSummonAsAction()` / `usePlaceNexusAsAction()` でも、field-card source 支払いでコア不足になったカードは resolver 中は `pendingLeaveCause="cost_payment"` のまま場に残り、chain 終端で flush される
- `runActionMainResolution()` を直接使う battle/action 系でも、pre-existing な `cost_payment` pending leave が queue 中は残り、chain 終端で flush される
- `summon` / `place_nexus` でも `getHandWrittenEffectResolver()` を通じて self-effect resolver が実行され、chain log と cleanup が残る
- hand card action でも `chosenLifeCoreKind` を summon/place 後 resolver へ渡せる
- `getRegisteredHandCardEffectActions()` を使って、target 選択つき summon/place effect を legal action として列挙できる
- `applyLegalAction()` から `summon` / `place_nexus` の resolver へ `targetInstanceIds` を渡し、target 必須/候補外 target を失敗系テストで固定できる
- `queuePendingLeave()` と `createTargetCardPendingLeaveResolver()` を通じて、個別効果 resolver から leave-field override 付き pending leave を発行できる
- その resolver を `magic` と `field-card effect` の両方の実カードフローで通せる

### 8. `GameState` 不変条件の崩れ検知

- `effectQueueEntries` と `effectQueueSummary` のズレを検知する
- `PlayerState.soulCoreLocation` と `CardInstance.soulCoreAttached` の不整合を検知する
- `pendingLeaveEntities` と card 側の pending leave 状態の不整合を検知する

## ログのゴールデンテスト

各シナリオについて、最終盤面だけでなくログ順も固定比較する。

最低限比較するもの:

- action log
- effect log
- chain log
- cleanup log

## カード追加に備えた形

現状テストは `packages/rules-core/test/*.test.ts`（カテゴリ別：`battle-system.test.ts` / `burst-system.test.ts` / `accel-change-system.test.ts` / `core-system.test.ts` / `effect-interpreter.test.ts` など）に直置きしている。想定する将来分類（未整備、**現行リポジトリには未存在**）:

- `fixtures/rules/` — ルール骨格ケース
- `fixtures/cards/` — カード個別ケース
- `fixtures/replays/` — 実戦再現ケース

テスト数が増えて分類の必要が出た段階で fixtures/ ディレクトリへ切り分ける。それまでは `*.test.ts` 単位で題材ごとにファイルを分けている。

## 完了条件

- 主要 P0 ルールに対して、成功系だけでなく失敗系テストがある。
- バグ修正時は再現テストを先に追加する。
- AI 対戦ログを replay で再現できる。
