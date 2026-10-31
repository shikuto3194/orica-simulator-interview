# API Extensions & Presentation

エンジン基礎構成は [02a_engine-architecture.md](02a_engine-architecture.md) を参照。

## 複雑な複数効果環境に備える補足

現状の `legalActions` / `applyLegalAction()` は、

- 単発 action
- 追加 target 選択
- 追加 life-core choice

には対応しやすい。

複数効果が重なる局面へ広げるには、API でも次を扱う。

- 同時発揮グループごとの `choose_resolution_order`
- 継続効果再計算後の `partialState`
- `この効果は今は解決不能` の理由
- source / target / suppression 変化による再判定

つまり、今の action API は方向としては悪くないが、
実戦級の複雑さに耐えるには

- `pendingPrompts`（`pendingDeckReveal` / `pendingZoneSelection` / `pendingCoreShootSelection` で実装済み）
- `simultaneousGroupId`
- `lastResolvedEvents`
- `recomputeContinuousEffects` の節目

を前提にする。

battle 系ではさらに、

- `activeAttack` 単位の `battleResolutionGroup`
- group 中に保留された `life_reduction` / `bp_compare` / `destroy_check`
- group 終端でまとめて積む `burstChecks` / `triggeredEffects`
- burst set 状態を表す field / zone

を持つ。複数体同時アタックを「participant ごとの完全逐次解決」と誤解せずに扱える。

ただし、ここでいう group 解決は `⑤バトル解決` の話であり、

- `アタック時`
- `ブロック時`
- フラッシュ
- 途中参加や target 再指定などの battle 中即時効果
- それらの効果により即時に起きたライフ減少
- そのライフ減少で発生した追加誘発

までを一括遅延する意味ではない。

API / engine 的には、

- `battleImmediateEffects`
- `battleResolutionGroup`

の2段に分け、前者は turn player が順を選んで逐次処理、後者は group 単位で解決、という整理が自然。

ただしこれは battle 特有の整理で、engine 全体としては別に

- `action resolution`
- `trigger / derived effect detection`
- `pendingTriggeredEffects` / `pendingBurstChecks`
- `state-based actions`
- `leave-field flush`

のような一般レイヤを持つ前提で考える。battle はこの上に追加で `battleImmediateEffects` と `battleResolutionGroup` を載せる特殊ケース。

現状はこの一般レイヤのうち、

- `pendingTriggeredEffects`
- `pendingBurstChecks`

の最小状態モデルと、`runActionMainResolution()` / `resolve_battle_resolution` からの最小 staging までは入っている。

ただし、いまの `resolve_pending_triggered_effect` / `resolve_pending_burst_check` は、

- `pendingTriggeredEffects` の source-backed registered / hand-written trigger
- `pendingBurstChecks` の source-backed registered / hand-written burst
- burst set 状態の最小表現
- `advanceStep()` からの `step_transition` source collector

までは入ったが、独立した window 遷移 helper と burst の実カード処理はまだ途中段階。

現状は少なくとも、

- `pendingTriggeredEffects` に matching source card があれば、`resolve_pending_triggered_effect` を source ごとの legal action として列挙できる
- `pendingBurstChecks` に matching burst card があれば、`resolve_pending_burst_check` を source ごとの legal action として列挙できる
- 1 source 解決後に同じ trigger event の残り source があれば、pending を先頭へ戻して続行できる
- `set_burst` により、main step の hand card から burst area へ移し、`burstSetPlayerIdsThisTurn` / `setBurstStates` を更新できる
- 既存の set burst があるときは、それを trash へ送ってから別の burst を置く置き換え set ができる
- source-backed burst 解決では、`revealedBurstStates` を使って reveal を明示し、解決後に burst area に残っていれば trash へ、別 zone へ動いていればその移動を優先する
- burst cleanup には hand-written post-resolution policy hook を差し込めるので、個別例外で `stay_in_burst` のような挙動を上書きできる
- さらに、burst area の source card 自身を `spirit / nexus` として `コストを支払わずに召喚/配置する` shared helper `playBurstSourceCardWithoutPayingCost()` を追加した
  - 実カードでは `この効果発揮後、このカードをコストを支払わずに召喚/配置する` 型が多いので、post-resolution 例外よりこちらを先に共通化する
  - `resolve_pending_burst_check` の source-backed legal action は `playSourceCardWithoutCostAfterResolve` を持てるようになり、`enterFieldCorePlacements` を追加入力として受けて source 自身の no-cost `召喚/配置` を自動で通せる
  - `useBurstSourceMagicCardWithoutPayingCost()` により、source 自身の no-cost `使用` も最小経路まで入った
  - `resolve_pending_burst_check` の source-backed legal action は `useSourceCardWithoutCostAfterResolve` も持てるようになり、source 自身の no-cost `使用` を自動で通せる
  - 同じ cardNo でも burst 本体と通常使用を分けられるよう、`EffectActionContext` に `resolutionKind` を追加した
  - `useBurstFollowUpMagicCardWithoutPayingCost()` により、burst source 以外の selected target `magic` を no-cost で `使用` する最小経路も入った
  - `resolve_pending_burst_check` の source-backed legal action は `useTargetCardWithoutCostAfterResolve` を持てるようになり、`requiredTargetCount=1` の selected target `magic` を自動で no-cost `使用` できる
  - `targetFollowUpMagicOptions` により、selected target `magic` ごとの nested target / life-core choice 条件を legal action に載せられる
  - `applyLegalAction()` は `followUpTargetInstanceIds` / `followUpChosenLifeCoreKind` を受けて、selected target `magic` の follow-up `使用` へ追加入力を渡せる
  - `playBurstFollowUpCardWithoutPayingCost()` により、burst source 以外の selected target `spirit / nexus` を no-cost で `召喚/配置` する最小経路も入った
  - `resolve_pending_burst_check` の source-backed legal action は `playTargetCardWithoutCostAfterResolve` を持てるようになり、target ごとの `enterFieldCorePlacement` 条件を返しつつ selected target `spirit / nexus` の no-cost `召喚/配置` を自動で通せる
  - selected target の no-cost play/use を複数候補 UI へどう見せるかと、より複雑な follow-up `使用` / `召喚` / `配置` の入力モデルが未実装

ところまでは入っている。未実装: 独立した window 遷移 hook の接続、burst の reveal timing 細則、post-resolution 例外の拡張。

現状はこのうち、

- `battleImmediateEffects`
  - `attack` / `block` 宣言後と、`joinActiveAttackAsAction()` による途中参加直後の prompt queue
  - `resolve_battle_immediate_effect` legal action
  - pending 中は `block` を出さない最小ガード
- `open_battle_flash` / `pass_battle_flash`
  - `flash_before_block` / `flash_after_block` の最小 open/pass 窓
  - block が 1 件も無いときは後半フラッシュを経由せず `start_battle_resolution` へ進む
  - 同時アタック中に 1 participant を block 済みでも、未 block participant への `block` legal action は残せる
- `use_magic`
  - battle flash 窓の priority player が、`pass_battle_flash` と並行して使える最小の `フラッシュ` action
  - 使用後は flash 窓を閉じず、priority を相手へ渡して loop を継続する
- `use_field_card_effect`
  - `timing=flash` の registration を持つ field effect は、battle flash 窓の priority player に legal action として出せる
  - 使用後は `use_magic` と同様に priority を相手へ渡す

までは実装済みで、さらに `start_battle_resolution` から `battleResolutionGroup` snapshot を作り、`resolve_battle_resolution` で最小の group 解決

- unblocked 側ライフ減少
- blocked pair の BP 比較
- battle 起因破壊待機と flush

まで通る。custom `stack` は `main_step_stack` / `stack_before_block` / `stack_after_block` / `pre_declaration_stack` 窓で実装済み。残り: バースト待機 / 派生誘発待機の group 整理の完全化（ToDo E-5）。

## REST API エンドポイント（実装）

ベース: `apps/playground-web/server/game-api.ts`

### ルーム API（対人対戦）

- `POST /api/room` — ルーム作成
- `GET /api/room` — JWT本人が参加した未決着ルーム一覧。`rooms` にID・元の席・作成時刻・開始有無・参加人数だけを返す。接続更新なし、`private, no-store`。DB上の所属と `state->>gameResult IS NULL` で絞り込み、100件ずつID順に取得して作成日時降順に返す。
- `GET /api/room/:id` — ルーム状態
- `POST /api/room/:id/join` — ルーム参加
- `POST /api/room/:id/deck` — デッキ登録
- `POST /api/room/:id/start` — ゲーム開始
- `POST /api/room/:id/leave` — 退出
- `POST /api/room/:id/heartbeat` — 接続維持
- `GET /api/room/:id/state/full` — 完全な state snapshot
- `PUT /api/room/:id/state` — 状態直接更新（テスト/シナリオ用）
- `GET /api/room/:id/state/version` — 状態バージョン（楽観ロック）
- `GET /api/room/:id/state/patch?since=N` — バージョン差分パッチ
- `GET /api/room/:id/events` — SSE で state 更新通知

### レガシー API（シングルゲーム・シナリオテスト向け）

- `POST /api/game/start` — ゲーム開始
- `GET /api/game/state` — 現在の状態取得（要約）
- `PUT /api/game/state` — 状態直接更新
- `GET /api/game/state/version` — 状態バージョン
- `GET /api/game/state/full` — 完全な state snapshot
- `GET /api/game/actions/:playerId` — 指定プレイヤーの legal actions
- `POST /api/game/action` — legal action 適用
- `POST /api/game/step` — ステップ遷移
- `POST /api/game/reset` — ゲームリセット

本節の一覧は要求・応答の完全な仕様ではない。実装時は [API handler](../../../apps/playground-web/server/game-api.ts) と [API回帰](../../../apps/playground-web/test/game-api.test.ts) でmethod/body/statusを確認する。
認証・席・公開範囲は [情報可視性](../10_rules/01b_information-visibility.md) と [sanitize](../../../packages/rules-core/src/state-sanitize.ts)、競合・通信失敗は [同期回帰](../../../apps/playground-web/test/room-sync-errors.test.ts) を参照。
`full`という名前だけで未加工の全情報を返してよいと判断しない。scenario用直接更新と本番roomの利用条件はhandlerの認可を確認する。

## `GET /api/game/state` が返す主なフィールド

- `turnPlayerId`（= `activePlayerId`）
- `step` / `window`
- `legalActions`
- `pendingLeaveEntities` / `pendingTriggeredEffects` / `pendingBurstChecks`
- `effectQueueSummary`（UI/ログ向け）
- `activeContinuousEffects`（retrigger 効果は `modifierTag: "retrigger"` バリアントとして同リストに統合 — P3-15 問題6、2026-04-17）
- `battleResolutionGroup` / `battleImmediateEffects` / `activeAttack`
- `setBurstStates` / `revealedBurstStates` / `mirageSetStates`
- `pendingPlacementOracle` / `pendingSoulStateReplacement` / `pendingDeckReveal` / `pendingZoneSelection` / `pendingCoreShootSelection` / `pendingCoreSplitSelection`
  （神託/解封/創界石転醒は `pendingTriggeredEffects` の mechanic 付きエントリに統合 — P3-92）

補足:

- エンジン内部では `effectQueueEntries` を使って flush 可否や chain 残存を判定する。
- 外向きの API では、表示向けの互換フィールドとして `effectQueueSummary` を返す。

## AI 向けに必須の出力

- 盤面要約テキスト
- 機械可読 JSON
- 各選択肢の理由
  - `can`
  - `cannot`
  - `required`

例:

- `cannot_attack_reason=already_exhausted`
- `cannot_designated_attack_reason=target_cannot_block`
- `must_resolve_reason=pending_chain`

## UI の重要ポイント

### ステップと窓の可視化

- 現在ステップ
- 現在フラッシュ窓
- どちらのプレイヤーが先に行動できるか
  を常に見せる。

### 待機状態の見せ方

- `破壊待機`
- `消滅待機`
- `バウンス待機`
  をバッジ表示する。

### 合体表示

- 合体スピリットは 1 つの戦闘主体として見せる。
- ただし内訳カードとコア配分は展開可能にする。

### ログ

- 行動ログ
- 効果ログ
- 派生効果ログ
- 状態ベース処理ログ
  を分ける。

## AI 連携に向けた補助

- すべての盤面主体に安定 ID を振る
- ログに `chainId` を残す
- 「なぜその行動が今可能/不可能か」を説明可能にする
- リプレイから完全再構築できるイベント列を残す
