# 操作同期エラーの経路監査（2026-09-13）

対象: `BattleScreen.tsx` の「操作の同期に失敗しました」。表示元は1か所で、
`useRoomSync.ts` の `SyncError.type === "push_failed"` が条件。
ソース検索と各dispatcherのHTTP応答試験で、以下の全7経路を確認した。

## 送信経路

| HTTP経路 | 呼び出し元・操作 | エラーになる条件 |
| --- | --- | --- |
| `PUT /api/game/state` | ソロ初期盤面、通常操作、自動進行、コア移動、分離、プレゲーム、リセット、切断勝利の保存 | 非2xx。400はstate不正、404はAPIなし、413はサイズ超過、5xxはサーバー例外等 |
| `POST /api/room/:id/action` | `setStateAndSync` にLegalActionを渡す全操作。カード操作・効果選択・自動解決・各pending HUD・パス | 認証/参加者/actor拒否、actionId不一致、engine入力不正、競合からの回復失敗、サーバー障害 |
| `POST /api/room/:id/step` | 手動ステップ送り、終了時効果後の自動進行 | 認証/参加者/ターンプレイヤー拒否、進行blocker、競合回復失敗、サーバー障害 |
| `POST /api/room/:id/core-move` | メインステップのコア移動 | 認証/参加者/操作権・移動条件拒否、競合回復失敗、サーバー障害 |
| `POST /api/room/:id/brave-separation` | ブレイヴ分離・配分・ソウル移動 | 認証/参加者/操作権・分離条件拒否、競合回復失敗、サーバー障害 |
| `POST /api/room/:id/claim-victory` | 相手切断タイムアウトの勝利宣言 | 認証/参加者・切断条件拒否、競合回復失敗、サーバー障害 |
| `POST /api/room/:id/pregame-update` | じゃんけん・先後・マリガン | 認証/参加者・入力拒否、競合回復失敗、サーバー障害 |

roomのPUTは撤去済みで通常GUIからの呼び出しなし。観戦は送信関数を無操作に置換する。
`useGameSync.ts` はこのバナーに接続されていない。
pollの3連続失敗は「接続が不安定です」、通信例外の再送上限は「ネットワークエラー」。
SSE切断・heartbeat・ロビー・ローカルengine例外は、単独では対象文言の表示元ではない。

## 添付例の再現と原因

ユーザー提供の05:40:08 / 05:44:22 UTCの2視点snapshotを、ログ・開示履歴と
room識別情報を除いて `packages/rules-core/test/fixtures/sync-errors/` に保存した。

Alice視点では、T4 Bobアタックのライフ減少後に `BSTH02.7-TX01(A)` の手札効果の
宣言選択が残っていた。Bobへの配送時には相手の `pendingPrivateDeclarations` が消え、
ローカル `getLegalActions` が `open_battle_flash` を返した。GUIが自動実行・送信し、
サーバーは `Not current actor: allowed=[alice], requester=bob` と拒否する。
Bobの保存盤面はローカルでフラッシュ開始まで進んでいた。

秘匿前の操作権を既存 `pendingPromptLock` で配送し、再sanitizeでも保持するよう修正。
カード名・本文・宣言内容は相手へ渡さない。actor判定とステップ進行もこの待機を尊重し、
宣言辞退後は通常の権威stateでロックが解ける。メインステップの同型停止も回帰対象。

## 併せて修正した同期不具合

- 対戦中の401がロビーの認証復旧から漏れていた。既存 `fetchWithAuthRetry` を
  操作・state取得・poll・SSEへ接続し、認証更新後に同じ入力を1回再送する。
- roomのHTTP 408/429/500/502/503/504を即時失敗にしていた。最大3回の再送を共有化。
  同じmutation ID・expectedVersionで送り、適用済み入力を二重実行しない。
  `Retry-After` を尊重し、10秒を超える待機指定なら自動再送せずエラーを残す。
- ソロのフルstate保存を呼出順に直列化。遅れた旧盤面保存が新盤面を上書きしない。
- 「再接続」がエラー表示を消すだけだった。roomは同versionでも最新stateを取得して
  GUIへ適用し、取得失敗ならエラーを残す。ソロは最新ローカル盤面を再保存する。
- 選択モーダルの背後に再接続ボタンが隠れていた。バナーを選択画面より前面へ配置。
- 確定エラーの詳細にはHTTP経路・status・サーバー本文を残し、原因を区別できるようにした。

409は競合であり、通常操作は取得後に自動再実行しない。pregameのみactor別の冪等mergeを
既存方針どおり再送する。400/403/404/413や永続障害は隠さず表示する。

## 検証

- `room-sync-errors.test.ts`: room全6dispatcherの401復旧・一時HTTP失敗・恒久拒否、
  ソロ保存順序、再接続の同version取得・失敗継続・最新ローカル保存。
- `sync-action-authority.test.ts`: 添付両視点、再sanitize、秘匿を維持した操作権と進行停止。
- `e2e/room-sync-errors.spec.ts`: Bob GUIが宣言待ち中に誤送信しないこと、Alice GUI辞退→
  Bob実RESTのフラッシュ開始、モーダル表示中の再接続と権威盤面の適用。
- 既存 `room-deck-reveal-queue.spec.ts`: 連続入力の保持と失敗後のcheckpoint復帰。
- 既存 `room-auth-refresh.spec.ts` / `room-sse-opponent-sync-local.spec.ts`: 認証更新と
  相手視点のSSE反映。認証試験の画像manifestは固定し、起動時の画像取得待ちを除外。

HTTP障害は決定的な応答注入、盤面の進行はローカルの実REST/engineを使用する。
稼働中のユーザールームやリモートDBには変更を加えていない。
