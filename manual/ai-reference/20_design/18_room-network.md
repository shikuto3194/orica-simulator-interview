# 公開ルーム対戦の通信調査と改善案

調査日: 2026-10-27 JST。対象: 公開サイトで頻発する「操作の同期に失敗しました」と通信遅延。
状態: 調査・設計提案。アプリ実装、本番DB変更、配備、VM移行は未実施。

## 結論と確度

まず本番DBとコードの不整合を解消し、操作の成否を確実に追跡できるようにする。
続いて再接続時の要求集中と公開経路の遅延を改善する。RESTからWebSocketへの置換だけを先行させない。

- **観測済み**: 本番DBに `commit_room_state`、`replay_events.client_mutation_id`、対応する一意索引がない。
- **コードで確認**: DB読取障害を404へ変換する経路、操作fetchの期限未設定、切断時500ms間隔の並行可能なpollがある。
- **小標本で観測**: 公開Funnelの入口によってhealth応答時間に大きな差がある。
- **未確定**: 報告された各失敗のHTTP番号・request ID・時刻、実際の端末の経路、操作別のp95。上記を個別障害の原因確定と混同しない。

外部一次資料はA、設計判断・原因候補はC。ローカルコード・SQL・計測は「観測」と明記する。
改善案Cは未受入であり、他ゲームの実装や測定値から本作の性能保証は導かない。

## 調査対象と版

- フロント: `https://gentle-heliotrope-e31174.netlify.app`。
- API: `https://kenshi2.tail4e104f.ts.net` → Funnel → Windows PC `127.0.0.1:4310`。
- DB: コードと接続ツールのproject IDが一致する `nnthvbizvqpufpfkzlho`。regionは `ap-southeast-1`。
- 公開 `release-version.json` とローカル・公開 `/healthz` のrevisionは、いずれも `0d4ab5a6ef262d6c42ae64430b8900b236481d2a`。
- 作業checkoutは `922ca5acd8e9b190e0d6848bead0fd95f9cfb1b2`。`git diff` で稼働版との差を確認した。通信hook・HTTP入口は同一。API差分にはviewer向け合法手の付加などがある。
- 公開配布物の版一致は確認したが、ユーザーが開いたままのタブの版は未確認。
- VM移行は既存指示で保留中。[PC運用](../00_meta/local-pc-deployment.md)に従い、今回は移行しない。

## 1. 本番で高速・原子的な保存経路が成立していない

本番の `pg_proc`、`information_schema.columns`、`pg_indexes` を読取確認した。
`commit_room_state` は0件、`replay_events` の `client_mutation_id` 列もない。
同テーブルの索引は主キー、`room_id/created_at`、`room_id/state_version` の3件で、mutation IDの一意索引はない。
移行履歴にも009相当の名前はないが、判定根拠は履歴名だけでなく実スキーマの不在。

正源コード:
[009 SQL](../../../supabase/migrations/009_commit_room_state_rpc.sql)、
[game-api.ts](../../../apps/playground-web/server/game-api.ts) の
`commitRoomMutation` / `appendReplayEvent` / `findDuplicateMutationVersion`。

通常の成功操作は、本来「room読取 → エンジン → 状態・履歴の一括commit」で済む。
現スキーマではRPCの不在検出後、互換経路で次の処理になることがコードから導ける。

1. roomをDBから読む。
2. version条件付きUPDATEで盤面を保存する。
3. 存在しない `client_mutation_id` 列を含む履歴INSERTが失敗する。
4. 同列を除いたINSERTを再実行し、完了を待ってから応答する。

初回はさらにRPC不在の往復が加わる。定常時でも正常スキーマより2往復多い。
状態保存と履歴保存が別処理なので、その間の障害で履歴が欠け得る。
応答喪失後の再送もmutation IDを検索できず、適用済みを成功として認識しにくい。
version条件付き更新は残っているため、「必ず二重実行する」とは主張しない。

**提案C・最優先**: 依存する移行・現在の制約・権限を棚卸しし、検証DBで確認した移行を本番へ適用する。
通常操作の本番互換fallbackを廃止し、原子的commitを必須にする。
`/healthz` のプロセス生存確認とは別に、列・索引・関数signature・権限を確認するreadinessを設ける。
新しい配備はreadiness成功後に切り替え、不一致の新APIへ切り替えない。稼働版を突然停止する変更にはしない。
不在検出済みAPIは `commitRoomStateRpcAvailable=false` をプロセス内に保持する。
DB移行だけで高速経路へ戻るとは限らず、移行確認後のAPIプロセス更新または能力再確認を切替手順へ含める。

## 2. エラーの意味と復旧経路

[useRoomSync.ts](../../../apps/playground-web/src/hooks/useRoomSync.ts) と
[BattleScreen.tsx](../../../apps/playground-web/src/components/BattleScreen.tsx)を確認した。

| 表示・状態 | 現行挙動 | 改善案C |
| --- | --- | --- |
| 「操作の同期に失敗しました」 | `push_failed`。永続的HTTPエラー、再試行上限後、認証復旧不能など | errorCodeとrequest IDを付け、失敗・結果照会中・再選択必要を区別 |
| 409 | 最新state取得。通常操作を新versionで勝手に再実行しない。取得成功時はバナーを消す | この安全性を維持し、操作結果照会と状態更新を統合 |
| 400/403/404/413 | 自動再試行なし | 不正操作等は維持。依存サービス障害をここに混ぜない |
| 408/429/500/502/503/504 | 初回+最大3再送。同じmutation ID・expectedVersion | 期限・jitter・全体予算を追加し、Retry-Afterを尊重 |
| 通常のfetch例外 | 最後は「ネットワークエラー」 | 結果未確定として同じIDを照会・再送 |

`getRoom` / `getRoomMeta` はSupabaseの `{error}` を検査せずdataだけを返し、呼出側がnullを404へ変換する。
DB一時障害がこの形で返ると「部屋なし」となり、自動再送を打ち切る。今回の症状を説明し得る具体的経路だが、報告時の404は未採取。

修正は、実在しない行と依存サービス障害を型付きで分離する。DB一時障害は503などへ、サーバ内部の権限・schema不整合は運用エラーへ分類する。
正しい404や対戦ルールの400を一律再送へ変更しない。一般操作の再送を「最新versionでやり直し」に変えない。

## 3. 待ち続ける通信と復旧時の負荷

操作fetchには明示的deadlineがない。HTTPサーバの30秒requestTimeoutは、アプリ処理全体の期限を保証しない。
直列送信queueの先頭が待ち続けると後続も止まる。待機100/200/400msの再送にはjitterがない。

SSEは通常5秒ping、10秒stale判定、250msから最大3秒で再接続する。
SSE接続中のpollは60秒、未接続時は500ms。`setInterval(async ...)` にin-flight抑止がなく、遅い環境では複数のpollが重なる。
pollは5連続失敗で停止し、SSE復帰だけではそのカウンターを初期化しない。
heartbeatは前景10秒・背景30秒で別fetch。失敗は握り潰し、認証再試行の共通経路を使っていない。

**提案C**:

- 操作の1試行と全体に期限を設ける。初期案は1試行5秒、15秒で「結果確認中」へ移行し、実測で調整する。打ち切りをサーバ未実行と解釈しない。
- 未確定操作を同じIDで保持し、照会/再送で解決してから依存操作を送る。タブ再読込・アカウント変更時の保持/破棄規則も定義する。
- pollは最大1本。完了後に次を予約し、障害時1→2→4→最大10秒程度へ退避。online/前景復帰/SSE再認証時に即時再同期する。
- 認証更新・full snapshot再取得は共通の進行中Promiseへ集約する。SSE再接続にもjitterとRetry-Afterを適用する。
- heartbeatを共通transportへ統合する。接続生存とゲームstateの保存を分離し、永続化頻度を抑える。

## 4. 公開経路と配備による遅延

`curl --resolve` で公開DNSの入口を明示し、Tailscale内のプライベート経路と分離した。
調査PC発着であり、携帯回線・相手端末からの測定ではない。各回はHTTP 200。

| 対象 | 初回接続の総時間 | 同一curl内の接続再利用 |
| --- | --- | --- |
| localhost health | 0.965ms | 未測定 |
| 公開入口 `103.84.155.153` | 2,972ms、別接続で2,573ms | 535ms、576ms |
| 公開入口 `103.84.155.217` | 349ms | 100ms、65ms |

最初の入口A計測ではTLS完了まで2,297ms。別接続Aでは2,049ms、Bでは260ms。
これは小標本の観測であり、恒常的な入口障害、一般利用者のp95、特定地域の遅さを証明しない。
入口IPの固定運用を解決策にせず、実端末・別回線から再測定する。
Supabase入口への未認証REST読取は401、163ms。認証済みDB操作時間の代用にはしない。

[api-limits.ts](../../../apps/playground-web/server/api-limits.ts)は接続元をsocket IPで区別する。
Funnel利用者は同じloopbackとして、毎秒30要求・burst60・active32・SSE16のpeer枠を共有し得る。
2人だけで必ず上限超過する計算ではないが、多タブ・切断時poll・再接続集中で429を増幅する候補。
未認証の入口制限を保ちつつ、信頼済みproxy情報または認証後user/room単位の枠へ分ける。任意のX-Forwarded-Forを信用しない。

APIはorigin/mainを60秒ごとに監視し、更新時に旧プロセス終了→新版開始する。
SSEは終了時に切断される。ビルド中は旧版維持だが、常時無停止という構成ではない。
`scheduled-api.log`には2026-10-26 12:55 JST頃のGitHub DNS失敗と、時刻を持たないDB cleanup fetch失敗がある。
今回の操作失敗との時刻対応は不明。HTTP要求ごとのstatus/時間ログが足りず、過去障害は確定できない。

**提案C**: PC運用中も配備のdrain・再開検証を追加する。長期案は常時稼働APIへ移し、利用者とDBの両方に近い地域を計測して選ぶ。
DBは現在 `ap-southeast-1` なので、APIだけ近隣地域へ移せば最速とは限らない。VM移行再開は別の判断事項。

## 5. 他ゲーム・基盤から採用する仕様

全資料は2026-10-27閲覧。第三者の推測記事は根拠に採用しない。

| 一次資料A | 確認できる仕様 | 本作への設計判断C |
| --- | --- | --- |
| [Lichess公開実装](https://github.com/lichess-org/lila-ws) / [遅延説明](https://lichess.org/lag) | WebSocket専用サーバとRedis経由の接続。サーバ処理時間と通信往復を区別して表示 | 常時接続の検討、処理時間と回線時間の分離計測。Redisの無条件導入は不要 |
| [Hearthstone 2019-06-03更新](https://hearthstone.blizzard.com/en-us/news/22992997/hearthstone-update-june-3-rise-of-the-mech) | 回線断・アプリ切替・画面ロック後にバックグラウンド再接続。切断/復旧状態を通知 | 対戦画面を保った自動復帰。資料は利用者向け仕様であり内部プロトコルの証拠ではない |
| [VALORANT技術解説](https://www.riotgames.com/en/news/peeking-valorants-netcode) | サーバが正しい状態を決定し、クライアントが予測表示して応答性を確保 | 入力反応・選択表示を即時化。非公開札の結果・乱数・合法性をクライアント予測で確定しない |
| [Nakama authoritative](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/) | 対戦ごとのメモリ状態、入力検証、明示的broadcast | roomごとの処理直列化・メモリ保持の設計参考。エンジン移植や製品導入は必須ではない |
| [Socket.IO配送保証](https://socket.io/docs/v4/delivery-guarantees/) | 既定はat-most-once。ACK再送、永続ID、再接続offsetは別途必要 | WebSocketでも重複排除・結果記録・再同期を省略しない |

[Tailscale公式](https://tailscale.com/docs/features/tailscale-funnel)はFunnelに変更不能な帯域制限があると明記する。
今回帯域上限へ到達した証拠はない。
[Supabase観測資料](https://supabase.com/docs/guides/observability)に沿ってログとDB構造を調べた。
[SDK再送仕様](https://supabase.com/changelog/45071-automatic-postgrest-retries-for-transient-errors)も確認し、実装時はインストール版との対応を調べて多層再送の全体予算を管理する。
[Data API変更](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)は新規オブジェクトの明示権限が必要となる点を移行計画へ反映する。既存表の今回障害原因とは扱わない。

実装契約・配備手順は [19_room-network-protocol.md](19_room-network-protocol.md) を参照。以下は実装前調査の時点記録。

## 6. 推奨する段階と受入条件

| 段階 | 実装対象 | 完了条件 |
| --- | --- | --- |
| P0 | DB移行整合、原子的commit、正しいエラー分類、request ID、操作ごとの計測 | 本番readinessで検出。応答喪失後も同じIDから適用結果を確認できる |
| P1 | deadline/再送予算、single-flight、切断復帰、UI状態区分、proxy下の制限見直し | 回線断・認証更新・429から自動復旧。pollの同時実行は常に1本以下 |
| P2 | 現行REST+SSEの計測比較、再接続負荷抑制、配備drain、地域/ホスト比較 | 公開経路で送信ACKと相手描画のp50/p95/p99を計測 |
| P3 | 必要ならWebSocket command/ACK、room単位の処理owner、メモリ状態 | 同じ安全性試験に合格し、P2に対する改善を示す |

P3の基本経路は `入力 → roomの直列処理 → 合法性検査 → 永続commit → ACK + viewer別差分配信`。
状態cacheはcommit成功後だけ更新する。DB参照を省く場合も単一ownerを保証し、複数プロセスにはlease/fencingまたは同等の排他を入れる。
永続化前の成功ACKは採用しない。メモリ状態のみでは再起動時の消失が残る。
履歴からの復元を使うなら、engine/schema版・乱数trace・checkpointを固定し、途中イベント欠落も検出する。

提案する性能目標は、前景・安定回線RTT100ms以下・2人1ルームで、入力反応p95 50ms以内、永続ACK p95 300ms以内、相手描画p95 500ms以内。
10ルーム20参加者でも同条件を目指す。経路条件を変えた試験は別集計にし、目標達成を現時点で約束しない。
断線復帰後5秒以内の再同期を初期目標とし、回復不能時も結果不明を明示して重複操作を誘発しない。

必須試験:

1. commit後だけHTTP応答を破棄、同じ操作を再送。状態version・効果・履歴が一度だけ進む。
2. 送信中・commit直後・再接続中にAPI再起動。成功済み操作の消失と二重適用がない。
3. 400/403/404/409/429/503、期限切れJWT、DB読取障害、認証基盤障害を別々に注入する。
4. SSEの遅延・順序逆転・差分欠落・低速受信、タブ背景化・端末ロック・回線切替から復帰する。
5. Alice GUI/Bob RESTと両GUIで、選択連打・相手割込み・非公開札・再戦を検証する。
6. 10ルーム20参加者、DB遅延、同時再接続で、要求本数・queue待ち・event loop遅延・CPU/メモリを計測する。

## 検証・残る観測

- 既存unit 3ファイル111件成功: `room-sync-errors`、`room-dispatch-queue-contract`、`room-replay-restore-postgres`。最後はローカルPGliteへ移行を適用する試験で、本番適用済みの証拠ではない。
- preflight入口をNodeで直接実行して成功。Corepack経由のpnpmはsandbox内で取得に失敗したため、既設VitestをNodeで実行した。
- 文書検査は0失敗・59警告、変更2文書のPrettier確認は成功。finish-checkは一時Git indexの書込権限で開始前に失敗したため、全体ゲート成功とは扱わない。
- 独立査読は文書・コード・提供した観測結果を確認し、重大指摘なし。API内のRPC不在cacheを切替時に解消する注意を反映。独立した本番再計測ではない。
- KnowledgeDBのstartは `PROTECTED_WRITE`。読取searchはno_match、auditはpartial（2セッション・tail切れ2・未検証完了1）。入口規定に従い書込を迂回せず、learn/finish成功はない。
- DBログの固定窓2026-10-26 01:00〜10-27 01:00 JSTでは対象room APIはGET 200が1,477件。commit/replay要求は観測されず、この窓では報告された操作失敗を再現できていない。
- 読取時のroomsは0件で、実対戦stateの大きさ・重い盤面の処理時間は未計測。対戦を新規作成する本番書込試験はしていない。
- health計測、schema観測、既存unitの成功を、公開サイトの認証済み対戦受入成功へ読み替えない。
- 未採取: エラー詳細のHTTP番号、問題発生時刻、実クライアント版、Server-Timing、利用者側RTT、API event loop負荷。

再開時は本番revisionとschemaを再確認し、P0から着手する。今回の時点観測を恒久状態として扱わない。
