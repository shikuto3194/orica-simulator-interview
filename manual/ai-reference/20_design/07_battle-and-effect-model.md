# Battle And Effect Model

## 目的

複数体同時アタックや battle 中の複数効果が重なる局面を、`activeAttack` と即時効果レイヤ、`⑤バトル解決` の group 解決に分けて扱う。

補足: 派生/誘発効果は battle 固有ではなく、どの timing / step の効果でも event を起こし得る。本章は battle で特に複雑になる部分だけ切り出す。スタック窓・フラッシュ優先権ループの共通設計は `08_stack-window-and-priority-loop.md` を参照。

## ActiveAttack の考え方

- `BattleEntity` 自体は合体済みスピリットなどの「戦闘主体」を表す。
- battle 側では `activeAttack` がその主体を束ねる。

現在の `activeAttack` が持つもの:

- `target`
- participant ごとの `blockAssignments`
- `symbolResolutionOrder`

`blockAssignments` は participant ごとに `blockedByEntityIds: string[]`（空=未ブロック）を持つ。通常は 0〜1 件で、`require_multi_block` CE（BSFT01-TR06(B) 型「スピリット2体でないとブロックできず」）が有効なときだけ複数 blocker になり、BP 比較は各 blocker と個別の 1vs1（[05b](../10_rules/05b_multi-attack-designated-attack-lifecap.md)、P2-05 Phase 5 完了）。

現在は `block` action と `joinActiveAttackAsAction()`、さらに `flash_before_block` / `flash_after_block` の最小 open/pass 窓と、battle flash 中の最小 `use_magic` / `use_field_card_effect(timing=flash)` legal action まで接続済み。custom `stack` も同じ priority loop に統合済み（`stack_before_block` / `stack_after_block` 窓）。優先権ループの詳細設計は `08_stack-window-and-priority-loop.md` §4 を参照。

## 複数効果が重なる局面への拡張

アクション解決、離脱処理、SBA は段階を分ける。誘発・バーストは collector が `pendingTriggeredEffects` / `pendingBurstChecks` に積み、カード定義の構造化効果を解決する。

- shared helper 群（`runActionMainResolution()` / `executeBattleResolution()` / `resolve_pending_triggered_effect` / `resolve_pending_burst_check`）は揃っている
- `pendingTriggeredEffects` は source ごとの legal action を出して 1 source ずつ解決する
- `pendingBurstChecks` も `Zone="burst"` と `setBurstStates` を使って source ごとの legal action を出して 1 source ずつ解決する
- `set_burst` は既存 set burst を trash へ送ってから別の burst を置く置き換え set に対応
- 「どの timing / step でも派生誘発を拾う」共通機構は `advanceStep()` からの `step_transition` hook + structured trigger event model で統合済み
- burst の set / reveal / post-resolution 移動を含むフルライフサイクルが実装済み

ただし、実戦のバトスピでは

- 常在効果
- 誘発効果
- 使用時効果
- 置換効果
- 解決途中で有効/無効が変わる効果

が同時に重なるので、effect をもう一段分解したい。

### 拡張候補

以下 4 つは設計時の概念名で、同名の型は実装に無い。現行の対応物: `EffectDescriptor` ≒ DSL の `Effect`（`dsl-types.ts`）と各 `Registered*Action` 登録、`PendingEffect` ≒ `PendingTriggeredEffect` ほか `pending*` 群、`ContinuousEffectLayer` ≒ `ContinuousEffect` / `activeContinuousEffects`、`ResolutionPrompt` ≒ `pending*` プロンプトと `select_pending_to_resolve`。

- `EffectDescriptor`
  - 1 個の効果単位
  - `effectId`
  - `sourceInstanceId`
  - `effectKind`
  - `timing`
  - `targetSpec`
  - `resolutionPolicy`
- `PendingEffect`
  - すでに待機に入った個別効果
  - `chainId`
  - `simultaneousGroupId`
  - `requiresChoice`
  - `canResolve`
- `ContinuousEffectLayer`
  - 常在効果 / `受けない` / `発揮されない` の再計算結果
- `ResolutionPrompt`
  - 同時発揮順
  - 追加対象選択
  - 効果ごとの resolve / skip 判断

少なくとも、複雑化に耐えるには次が必要になる。

- 効果種別の明確化 → `EffectCategory` として型定義済み (下記)
- 同時発揮グループの表現
- 継続効果の再計算ポイント
- 解決途中での source / target / suppression 再評価

今すぐ完全実装は不要だが、battle 窓や複数誘発を広げる前に、設計としてはこの方向を持っておきたい。

### EffectCategory taxonomy (E-2)

`model.ts` に `EffectCategory` 型を定義済み。全効果登録型に `effectCategory?` フィールドあり。

| カテゴリ | 意味 | 登録型のデフォルト |
|---|---|---|
| `activated` | プレイヤーが能動的に発揮 | `RegisteredMagicAction`, `RegisteredHandCardEffectAction`, `RegisteredFieldCardEffectAction` |
| `triggered` | ゲームイベントに反応して誘発 | `RegisteredTriggeredEffectAction`, `RegisteredBurstAction`, `RegisteredBattleImmediateEffectAction` |
| `continuous` | 一定期間持続 (「このターンの間」等) | 明示指定が必要 |
| `replacement` | 他イベントを置換 (「〜の代わりに」) | 明示指定が必要 |
| `delayed` | 今設定して後で解決 | 明示指定が必要 |

ヘルパー `getEffectCategory(registration, defaultCategory)`（`legal/legal-actions-shared.ts`）で、登録型に応じたデフォルトを呼び出し側から渡す設計。ただし現状 `getEffectCategory()` は定義のみで呼び出し元が無く、`effectCategory` は登録時に `triggered` / `activated` が付くメタデータにとどまる（`continuous` / `replacement` / `delayed` を設定する登録も、この値で分岐する処理も無い。2026-11-18 grep）。

## バースト条件は flat enum 増築ではなく structured trigger model へ寄せる

公式側で確認できた burst 条件は、

- `ライフ減少後`
- `アタック後`
- `効果による召喚後`
- `手札増加後`
- `召喚時発揮後`
- `フィールド離れ後`
- `封印後`
- `神技発揮後`

のように family 自体が広い。

このため、`BurstEventKind = "reduce_life" | "attack_after" | ...` を増やし続けるより、

- `family`
- `actionKind` / `effectActivationTiming` / `effectActivationLabel`
- actor / target / related player scope
- `causeKind`
- `validationMode`
- amount / cost / count などの追加 predicate

を持つ structured trigger event へ寄せる方が自然。

ここでいう `validationMode` は、たとえば

- 条件成立時の snapshot だけで足りるもの
- 解決時にも attacker / target / source の存続再確認が必要なもの

を分けるための軸として使う。

実装方針としては、burst だけ別系統にせず、`pendingTriggeredEffects` / `pendingBurstChecks` の両方が同じ event descriptor を共有する形に寄せる。

最初の移行対象は、現状すでにある

- `reduce_life`
- `destroy`
- `attack_after`

の 3 つでよい。ここを

- `family="life"`
- `family="leave_field"`
- `family="action_after", actionKind="attack"`

のような形へ写像できれば、その先の family 追加でも model を崩しにくい。

**現状**: `PendingTriggeredEffect` / `PendingBurstCheck` は shared `event` object（`StructuredTriggerEvent`）を持つ設計へ移行済み（P2-07）。registration 側も `eventKind` 直指定ではなく matcher object (`TriggerEventMatcher`) を受ける形に統一済み。旧 enum は compatibility helper として残存。

## 複数体同時アタックの battle resolution は group 単位で扱う

`CB14-060 ありがと⇄大丈夫` のQ26333/Q26336/Q26337/Q26342 から、

- 一部だけブロックされても、unblocked 側のライフ減少と blocked 側のBP比較は同じ `⑤バトル解決` に属する
- Q26336 のライフ減少後バーストはバトル解決の節目まで待つ。Q26337 の類例ではライフ減少から派生した効果によるBP変化を最終破壊判定に反映する
- 破壊判定は `⑥破壊` で、group 解決の最後に見えているBPで行う
- `アタックしたとき` は participant 数ではなく、その同時アタック group 全体で 1 回として数える場合がある

と読むのが自然。

したがって、battle model では

- `activeAttack`
- `battleResolutionGroup`
- `pendingTriggeredEffects`
- `pendingBurstChecks`

のように、group 中のライフ減少/BP比較/破壊/派生誘発を段階分離する。

## battle 中の即時効果解決と `battle_resolution` は別レイヤにする

`CB14-060 ありがと⇄大丈夫` のQ26329 と、公式ルール改定の
`アタックでライフを減らしたときに発揮する効果について`
を合わせると、

- 同時アタック中でも `アタック時` 効果そのものは turn player が順番を選んで逐次解決する
- これは `アタック時` に限らず、`ブロック時`、フラッシュ、途中参加、指定変更など battle 中に即時で差し込まれる効果一般にも広げて考えるべき
- それらの途中で起きたライフ減少や追加ライフ減少は、その都度 `ライフが減らされたとき` を発生させ得る
- ただし、バースト効果そのものは条件を満たした瞬間に即解決するのではなく、その時点で解決中の効果群をすべて終えたあとで解決待ちへ入れる
- 一方で、通常のアタックによるシンボル減少や blocked pair のBP比較/破壊は `⑤バトル解決` の group として扱う

という 2 層構造が必要になる。

したがって battle 拡張では、

- `battleImmediateEffects`
  - `attackTriggeredEffects`
  - `blockTriggeredEffects`
  - `flashEffects`
  - `joinAttackEffects`
- `battle_resolution` で処理する `symbolDamage / bpCompare / destroyCheck`

を同じ queue に雑に混ぜず、少なくとも phase を分けて扱いたい。

## 現状で入っている最小構成

- `attack` / `block` 宣言後と、途中参加直後の `battleImmediateEffects` prompt queue
- `resolve_battle_immediate_effect` legal action
- 同時アタック中でも、prompt を持つ側が prompt 解決順を選べる最小入口
- `battleImmediateEffects` が残っている間は `block` に進まない最小ガード
- `open_battle_flash` / `pass_battle_flash` による `flash_before_block` / `flash_after_block` の最小 open/pass 窓
- battle flash 中の priority player に出る最小の `use_magic` legal action
  - 使用後は窓を閉じず、priority を相手へ渡して loop を継続する
- battle flash 中の priority player に出る `use_field_card_effect(timing=flash)`
  - field card 側の registration で `timing=flash` を持つ action だけを battle 窓へ出す
  - 使用後は `use_magic` と同様に priority を相手へ渡して loop を継続する
- ブロックが0件なら `decline_block` から直接バトル解決へ進む。一部をブロック済みなら後半フラッシュを開ける
- 1 participant を block 済みでも、未 block participant には追加の `block` legal action を残せる
- `executeBattleResolution()`（`battle/battle-actions.ts`）による `battleResolutionGroup` snapshot 生成と group 解決。ブロックなしの `decline_block`、後半フラッシュ終了、前半フラッシュで攻撃者が全員不在になった場合に呼ばれ、専用の `start_battle_resolution` / `resolve_battle_resolution` legal action は無い（P3-55 Phase B で削除）
  - unblocked 側ライフ減少
  - blocked pair の BP 比較
  - battle 起因破壊待機と flush
  - battle_end 処理後に `window:"none"` / `activeAttack:null` へ戻る

実装済み（上記最小構成に追加）:

- `stack` / `stack_before_block` / `stack_after_block` / `pre_declaration_stack` 窓（`stack` は旧 `main_step_stack`）で、battle 中の `stack` タイミング効果を処理
- burst の set / reveal / resolve / post-resolution 移動を含む完全なバーストライフサイクル（`setBurstStates` / `revealedBurstStates` / `set_burst` action / `resolve_pending_burst_check`）
- `battleResolutionGroup` 終端で `pendingTriggeredEffects` / `pendingBurstChecks` に staging する collector

同時誘発順は前面化と ActionBar で選べる。

残課題:

- コアステップの置換効果対応

補足:

- `⑤バトル解決` 由来の `reduce_life` / `destroy` は、現状でも group 終端で `pendingTriggeredEffects` / `pendingBurstChecks` に積む最小 collector が入っている。
- `pendingTriggeredEffects` と `pendingBurstChecks` は、発揮資格のある発生元に紐づく legal action から構造化効果の解決へ進む。
- burst 効果そのものも、最小の `set_burst` / reveal / post-resolution 移動までは入った。
  - `set_burst` は main step の hand card から burst area への最小 action
  - reveal は `revealedBurstStates`
  - post-resolution は `burst zone に残っていれば trash、別 zone へ移っていればその移動を優先`
  - hand-written post-resolution policy により、`stay_in_burst` のような個別例外を差し込める
- `resolve_pending_burst_check` は `playsSourceCardWithoutCostAfterResolve` / `usesSourceCardWithoutCostAfterResolve` と対象版のフラグを持つ。無償で召喚・配置するカードのコア配置候補は `targetEnterFieldCorePlacementOptions`、無償使用するマジックの対象等は `targetFollowUpMagicOptions` で渡す。
- エンジンとルーム API は `followUpPerTargetInputs` を受け、複数対象をそれぞれ無償使用・召喚できる。通常の画面から複数対象の追加入力を行う経路は未確認。
- `stay_in_burst` は secondary な post-resolution 個別例外として扱う。

- battle 中即時効果でライフが減った場合の burst check は、その event ごとに個別に積む。
- 一方、`⑤バトル解決` の通常ライフ減少に由来する burst check は、同じ group の途中では解決せず、group 終端でまとめて待機へ入れる。
