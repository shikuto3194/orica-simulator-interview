# API Extensions & Presentation

エンジン基礎構成は [02a_engine-architecture.md](02a_engine-architecture.md) を参照。

## 複雑な複数効果環境に備える補足

現状の `legalActions` / `applyLegalAction()` は、

- 単発 action
- 追加 target 選択
- 追加 life-core choice

には対応しやすい。

複数効果が重なる局面へ広げるには、API でも次を扱う。

- 同時発揮グループごとの解決順選択（`choose_resolution_order` という名前の action は無く、`select_pending_to_resolve` legal action が相当）
- 継続効果再計算後の `partialState`（未導入。現行 API の状態取得と合法手は後述）
- `この効果は今は解決不能` の理由
- source / target / suppression 変化による再判定

つまり、今の action API は方向としては悪くないが、
実戦級の複雑さに耐えるには

- 保留プロンプト（`pendingPrompts` という汎用フィールドは無く、`pendingDeckReveal` / `pendingZoneSelection` / `pendingCoreShootSelection` など `pending*` 群で実装済み）
- `simultaneousGroupId`
- 解決済みイベントの履歴（`lastResolvedEvents` は未導入。現行は `log` と `semanticTriggerEvents`）
- `recomputeContinuousEffects` の節目

を前提にする。

battle 系ではさらに、

- `activeAttack` 単位の `battleResolutionGroup`
- group 中に保留されたライフ減少 / BP 比較 / 破壊判定（ここではバトル解決の処理名として記す）
- group 終端でまとめて積む `pendingBurstChecks` / `pendingTriggeredEffects`
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

の状態モデルと、`runActionMainResolution()` / `executeBattleResolution()`（バトル解決。`resolve_battle_resolution` という legal action は無い）からの staging が入っている。

`resolve_pending_triggered_effect` / `resolve_pending_burst_check` は、

- `pendingTriggeredEffects` の source-backed registered / hand-written trigger
- `pendingBurstChecks` の source-backed registered / hand-written burst
- burst set 状態（`setBurstStates`）と reveal（`revealedBurstStates`）
- `advanceStep()` からの `step_transition` source collector

まで入っている。バーストの set / reveal / 解決 / 解決後移動の全ライフサイクルは [07](07_battle-and-effect-model.md) の通り実装済み。

少なくとも、

- `pendingTriggeredEffects` に matching source card があれば、`resolve_pending_triggered_effect` を source ごとの legal action として列挙できる
- `pendingBurstChecks` に matching burst card があれば、`resolve_pending_burst_check` を source ごとの legal action として列挙できる
- 1 source 解決後に同じ trigger event の残り source があれば、pending を先頭へ戻して続行できる
- `set_burst` により、main step の hand card から burst area へ移し、`burstSetPlayerIdsThisTurn` / `setBurstStates` を更新できる
- 既存の set burst があるときは、それを trash へ送ってから別の burst を置く置き換え set ができる
- source-backed burst 解決では、`revealedBurstStates` を使って reveal を明示し、解決後に burst area に残っていれば trash へ、別 zone へ動いていればその移動を優先する
- burst cleanup には hand-written post-resolution policy hook を差し込めるので、個別例外で `stay_in_burst` のような挙動を上書きできる
- さらに、burst area の source card 自身を `spirit / nexus` として `コストを支払わずに召喚/配置する` shared helper `playBurstSourceCardWithoutPayingCost()` を追加した
  - 実カードでは `この効果発揮後、このカードをコストを支払わずに召喚/配置する` 型が多いので、post-resolution 例外よりこちらを先に共通化する
  - バースト自身・選択した対象の無償召喚・配置・使用と、対象ごとの追加入力は [バトルと効果](07_battle-and-effect-model.md) を参照。複数対象はエンジンとルーム API の入力経路があり、通常画面からの操作到達性は未確認。

現状はこのうち、

- `battleImmediateEffects`
  - `attack` / `block` 宣言後と、`joinActiveAttackAsAction()` による途中参加直後の prompt queue
  - `resolve_battle_immediate_effect` legal action
  - pending 中は `block` を出さない最小ガード
- `open_battle_flash` / `pass_battle_flash`
  - `flash_before_block` / `flash_after_block` の最小 open/pass 窓
  - ブロックが0件なら `decline_block` から直接バトル解決へ進む。一部をブロック済みなら後半フラッシュを開ける
  - 同時アタック中に 1 participant を block 済みでも、未 block participant への `block` legal action は残せる
- `use_magic`
  - battle flash 窓の priority player が、`pass_battle_flash` と並行して使える最小の `フラッシュ` action
  - 使用後は flash 窓を閉じず、priority を相手へ渡して loop を継続する
- `use_field_card_effect`
  - `timing=flash` の registration を持つ field effect は、battle flash 窓の priority player に legal action として出せる
  - 使用後は `use_magic` と同様に priority を相手へ渡す

までは実装済みで、さらに `executeBattleResolution()`（`battle/battle-actions.ts`。ブロックなしの `decline_block`、後半フラッシュ終了、前半フラッシュで攻撃者が全員不在になった場合に自動で呼ばれる）が `battleResolutionGroup` snapshot を作って group 解決する

- unblocked 側ライフ減少
- blocked pair の BP 比較
- battle 起因破壊待機と flush

まで通る。custom `stack` は `stack` / `stack_before_block` / `stack_after_block` / `pre_declaration_stack` 窓で実装済み。同時誘発順は前面化と ActionBar で選べる。コアステップ置換効果は [ToDo](../30_plan/02_detailed-todo.md) を参照。

## REST API エンドポイント（実装）

ベース: `apps/playground-web/server/game-api.ts`

### ルーム API（対人対戦）

- `POST /api/room` — ルーム作成
- `GET /api/room` — JWT本人が参加した未決着ルーム一覧。`rooms` にID・元の席・作成時刻・開始有無・参加人数・空席判定だけを返す。接続更新なし、`private, no-store`。DB上の所属と `state->>gameResult IS NULL` で絞り込み、100件ずつID順に取得して作成日時降順に返す。
- `GET /api/room/:id` — ルーム状態
- `POST /api/room/:id/join` — ルーム参加
- `POST /api/room/:id/deck` — デッキ登録
- `POST /api/room/:id/start` — ゲーム開始
- `POST /api/room/:id/leave` — 退出
- `POST /api/room/:id/heartbeat` — 接続維持
- `GET /api/room/:id/state/full` — 非公開情報を秘匿化した閲覧者別の完全スナップショット
- `GET /api/room/:id/state/version` — 状態バージョン（楽観ロック）
- `GET /api/room/:id/state/patch?since=N` — バージョン差分パッチ（旧経路のフォールバック）
- `GET /api/room/:id/events` — SSE で state 更新通知
- `DELETE /api/room/:id` — 作成者による未決着ルーム削除 / `DELETE /api/room/:id/deck` — 準備解除
- `POST /api/room/:id/action` / `step` / `claim-victory` / `core-move` / `brave-separation` / `pregame-update` — サーバ側の操作 endpoint（旧 `PUT /state` を置換）
- `POST /api/room/:id/mutation-settle` — 応答不明の操作を `applied` / `cancelled` に決着させる
- `GET /api/room/:id/replay` / `replay/verify`、`POST /api/room/:id/replay/restore` — リプレイ取得・整合性検査・復旧

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

`summarizeState()`（[game-api.ts](../../../apps/playground-web/server/game-api.ts)）の要約で、`GameState` 全体ではない。

- `turn` / `step` / `activePlayerId` / `gameResult` / `version`
- `players`（`id` / `life` / `reserveCores` / `trashCores` / `soulCoreLocation`）
- `cards`（`instanceId` / `cardNo` / `name` / `zone` / `cores` / `attachedToInstanceId` / `underCards` など）
- `activeAttack`（`attackerEntityId` / `target` / `blockAssignments` のみ）
- `pendingLeaveEntities`（`instanceId` / `kind` / `cause` のみ）
- `battleImmediateEffects`（prompt の要約）
- `effectQueueSummary`（UI/ログ向け）/ `logLength`

`window` / `legalActions` / `pendingTriggeredEffects` / `pendingBurstChecks` / `activeContinuousEffects` などはこの要約に含まれない。合法手は `GET /api/game/actions/:playerId`、完全な state は `GET /api/game/state/full`（ルームでは `GET /api/room/:id/state/full` から閲覧者別の秘匿化済み状態を取得）で取る。

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

例（命名の設計例。現行実装に同名フィールドは無く、各 `LegalAction` は `can: true` と `reason` 文字列を持つ。実行できない行動は列挙されない）:

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
  を区別して見せたい（設計意図）。現行 GUI はテキストバッジを廃止し、`pendingLeaveKind` があるカード画像を微透明（`.card-pending-leave`）にして表す（[CardView.tsx](../../../apps/playground-web/src/components/CardView.tsx)）。破壊/消滅/バウンスの種別を区別する文字表示は無く、効果キューの発揮元に汎用の「待機状態」ラベルが付くのみ（`apps/playground-web/src/components` に `破壊待機` 等の文言なし）。

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
