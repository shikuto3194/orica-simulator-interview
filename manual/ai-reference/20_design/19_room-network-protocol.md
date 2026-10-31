# ルーム通信の確定・復旧契約

2026-10-27。設計判断C。根拠と実装前観測は [通信調査](18_room-network.md)。
対象は公開ルーム対戦。ルールエンジン・viewer別sanitizeの権威はAPIに置く。

## 原子的な確定

`commit_room_state` がrooms行をロックし、操作ID照合、期待version検査、state更新、replay追加を同一トランザクションで行う。
同じIDの再送は1回だけ進む。IDはactor、endpoint、元リクエストのfingerprintと結合する。
fingerprintはルートとキー順を正規化した入力をSHA-256化し、CAS versionと操作IDを除く。
乱数traceと自動解決はサーバーだけが履歴へ付加する。pregameのactor別mergeだけは競合後にversionを更新できる。

永続commit後にviewer別差分を配信し、HTTP ACKを返す。HTTPを失っても履歴から同じIDを照合する。
RPC不存在・DB障害で直接UPDATE＋別INSERTへ移る旧fallbackは廃止。
全versionのroom state更新をDB triggerでも原子的RPCに限定する。旧APIへrollbackしても取消のfenceを回避できない。
対戦開始（version 0からの初期化）は専用の原子的`initialize_room_state`を使う。接続状態だけの更新はこの制限の対象外。

## 結果不明の操作

ブラウザは送信前に、account＋room単位のsessionStorageへID、入力、期待version、次の再試行時刻を保持する。
JWT、取得state、相手の非公開情報は保存しない。保存不能なブラウザではメモリ保持になり、ページ再読込をまたぐ復旧は保証できない。
再送は同じIDとversionを使用する。送信は1本に制限し、未確定中の後続操作を止める。
保存された操作を復元した場合は送信済みか不明なため、必ず結果不明として扱う。

2xxでもJSON・整数version・操作IDを確認するまではACKと扱わない。
ACKが示すversion以上の権威stateを受け取るまで入力を再開しない。
ネットワーク失敗後に別の401/403/404/409が返っても、最初の要求の未適用を意味しない。

`POST /api/room/:id/mutation-settle` は元のID、path、入力を受け、参加者認証後に `settle_room_mutation` を呼ぶ。
このRPCも同じrooms行をロックする。

| DB内の結果 | 復旧動作 |
| --- | --- |
| 同じactor・fingerprintの履歴あり | appliedと適用versionを返す |
| 履歴なし | actor別の取消記録を永続化しcancelledを返す |
| 認証・DB・経路障害 | 結果不明を維持して復旧を続ける |

取消後に元のHTTP要求が遅れて到着してもcommit RPCが拒否する。
取消は状態変更を巻き戻す操作ではなく、未commitのIDを今後適用しない確定操作。
他actorの同じIDを取消せない。取消表はRLS有効、service_role以外の直接アクセスを拒否し、room削除時に連動削除する。
settle結果が示すroom version以上のfull stateを取得後、appliedなら復帰し、cancelledなら未適用と再操作の案内を表示する。

## 通信・負荷

### 確定盤面の表示（2026-10-28）

`useRoomSync` の版付きサーバー状態を唯一のパッチ基底・画面復旧元とする。
HTTP・SSE・pollのいずれで受信しても、操作待ち行列の終了を待たず確定状態を表示する。
中間操作AのHTTP成功も同じ入口から表示してからBを直列送信する。Bが失敗すれば未送信Cは破棄する。
仮表示を作る処理・送信済みの操作内容は変更しない。途中の確定状態は後続の仮表示より優先するため、
選択途中の表示がサーバー確定状態に戻る場合がある。後続操作の成功を先取りして表示する保証はしない。

409から返った取得済みstateを画面側で再利用し、同じ復旧のための2回目のGETとqueue終了時の余分なGETを除く。
表示直前にはhook内の最新確定stateを参照し、遅着HTTPがより新しいSSE/pollを上書きしない。
差分は基底版一致かつ次版だけに適用し、欠落版の回復では要求した版未満のfull stateを受理しない。
room/account/参加・観戦区分/viewerの変更は要求スコープを更新し、A→B→Aに戻った場合も旧callbackを棄却する。

`shared/room-protocol.ts` が通信メタデータ（ゲーム内容を含まない操作ID・版番号・応答検査）を共有する。
APIは提供されたID・期待版の不正な型や範囲を400で拒否する。既存互換として省略を許すAPI経路と、
ID echoを省略する旧ACKは維持する。省略した旧クライアントの再送排除を保証する変更ではない。
合法性・actor認可・保存・viewer別の秘匿情報加工は引き続きサーバーが行う。

隔離回帰は `room-deck-reveal-queue.spec.ts` のA応答後/B応答保留中の実盤面表示と409 GET回数、
`room-sync-errors.spec.ts` のGUI/ローカル実エンジンREST・再接続・ACK喪失・匿名観戦、
`room-sync-scope.test.ts` の旧スコープ棄却を含む。前者は模擬room通信であり、本番DB/Funnelの速度証明ではない。
旧版の同条件試験ではAの受信後1秒経過しても旧盤面が残り、409ではfull GETが2回発生した。
受入条件はBの応答前にAの確定盤面を表示し、409の復旧GETが1回で済むこと。
実回線のクリック→確定描画のp50/p95/p99、重い盤面・連続操作・複数room負荷は別途同条件で測定する。

### 要求と配信

- 有限JSON要求は本文読取を含めclient 8秒、DB transport 6秒のdeadline。SSEには本文deadlineを適用しない。
- 認証トークン取得/更新は7秒。更新は同じcallbackでsingle-flightし、期限後は次の復旧が新しく更新できる。
- 送信は最大4試行、再送予算の目安25秒。ACK後のstate再取得と結果不明の復旧は別予算。
- Retry-After、指数backoff、jitterを操作送信・settle・poll・SSE再接続へ適用する。
- full state、version poll、heartbeatは各1本。pollは前の完了後に予約し、5回失敗後も停止しない。
- 取得済みversionとGUIへの反映は分離する。SSE状態変更でpoll effectが再作成されても、同versionの検証済みcacheを再配送する。GUIは既に受けた同じobjectを再記録・再適用しない（`room-sync-errors.test.ts`の未描画snapshot再配送回帰）。
- online/前景復帰で再同期。room/account変更とunmountで有限要求をAbortし、古い応答を世代番号で棄却する。
- room loaderはroom＋accountで再マウントし、旧手札/パッチ基底を破棄。APIが返すviewer roleから表示を作る。観戦はログイン中も全room通信を匿名に固定する。
- heartbeat RPCは本人のJSONキーだけをmergeし、同時接続維持の相互上書きを防ぐ。
- JSONはcompact出力。Server-Timingでauth/DB/engine/配信準備を分離し、X-Request-IDをCORSで公開する。DB障害ログにはID、分類、時間だけを記録する。

ループバックFunnel運用は明示設定 `API_BEHIND_LOOPBACK_PROXY=1` と127.0.0.1 bindが条件。
事前の全体上限60req/s、burst120、同時64、SSE32、socket128を維持し、proxy接続元だけを全体枠へ合わせる。
その後に検証済みuser IDごとの15req/s、burst30、同時8、SSE3を適用する。任意の転送ヘッダーをユーザー識別に使わない。

## 配備

1. `20261026181917_room_network_atomic_readiness.sql` をローカルPostgresで検証する。009/010の未適用分も含む前進移行。
2. 本番の関数・列・索引・trigger・権限を照合して移行する。保存済みstate/replayを削除しない。旧APIがRPC不在をcacheした場合は、稼働roomを確認して旧APIと自動再起動を一時停止→移行→REST経由readiness→旧API再開でcacheを解放する。旧RPC signatureとの互換を先に確認する。
3. 新APIを本番環境変数と `ORICA_API_PREFLIGHT=1` で起動し、listen/maintenance前のreadinessを通す。失敗時は旧APIを止めない。
4. 配備時は新規受信を止め、SSEへreconnectを通知し、処理中要求を最大25秒待つ。supervisorは28秒待ってから強制停止する。
5. 公開 `/healthz` のrevisionと `/readyz`、公開フロントのreleaseを確認し、認証済みルームで両方向の操作と再接続を確認する。

`/readyz` は5秒以内で共有する非更新プローブ。commit/repair/heartbeat/settleの関数、重複排除索引、snapshot列、原子的更新triggerを確認する。
healthの成功だけでDB準備完了・対戦受入成功とはしない。API起動中の移行を永久に「RPCなし」とcacheしない。
DB read障害は503＋分類コード。存在しないroomだけが404。

## 検証入口と性能判断

### 厳密な保存契約 v2

`20261029070703_room_network_strict_commit.sql` と対応APIを組み合わせる。
開始も `initialize_room_state` で同じルーム行をロックし、未開始・両デッキ・読取時のplayers一致を確認して版1のcheckpointを一括保存する。
操作IDと期待版は必須。開始IDも送信前にアカウント＋ルーム単位で保存し、通信断から未実行を推測しない。
初期化以外の版0書込み、NULL照合情報、同じIDの異なる内容、取消と実行が共存する旧不整合を成功扱いしない。
取消は全actor共通のルーム＋IDで効く。既存取消は推測補完せず保持し、直接DML権限を閉じる。
運用者トークン専用のreplay修復は、サーバーcheckpointから再構築してroom版と履歴末尾を照合する別経路。
操作IDを持たないこの経路は通常の操作再送・settleの対象外で、応答不明時はDBの版とcheckpointを確認し、確認前に自動再実行しない。版0の初期化には使えない。

`room_network_readiness_v2` は関数定義・設定・実行権限、RLS、取消列、triggerの対象列、一意indexを照合する。
commit/init/settle/repair自身が同じDB要求内で確認し、不整合時は保存を止める。DB往復は追加しない。
重複照会を呼ぶ一部の拒否経路やrematch/resetの先行照会では、期待版が現行版と一致すれば照会を省く。action/step/pregameの通常成功は従来から先行照会がなく、この変更による通常成功のDB往復削減はない。DB保存内のID照合は常に残し、再送時は厳密な `lookup_room_mutation` と保存RPCで判定する。
非公開盤面の加工と確定通知は保存成功後。ルールエンジンと操作待ち行列の直列順序は変えない。

単一セッションのSQL回帰は `room-network-strict-postgres.test.ts`。複数接続のロック競合は独立PostgreSQLで別に測る。
`room-public-latency.spec.ts` は明示opt-inの公開検証。専用ユーザー・ルームで実GUIのじゃんけん操作を測り、操作ID・版・request ID・Server-Timingを結ぶ。
同じブラウザーの単調時計でクリックから2回目の描画フレームまで記録する。資産準備はstream fallbackで測定外とし、API・DBはmockしない。
HTTPの実交渉結果・端末・公開IP・配備版・第一手/第二手を記録し、空pregameやlocalhostの数値と混ぜない。
実測値を受入証跡に保存するまで、本番性能を改善済みとは扱わない。

- `room-network-postgres.test.ts`: 状態＋履歴のロールバック、同IDの一回適用、actor/input分離、heartbeat merge、取消/遅着要求、旧fallback拒否、権限/readiness。
- `room-sync-errors.test.ts` / `network-request.test.ts`: 応答断→4xx、壊れたACK、認証更新停止、同時取得、5回以上失敗からの復旧、再読込journal。
- `pc-api-update.test.ts`: build/readiness失敗時の旧API維持、切替失敗時のrollback。
- `e2e/room-network-live.spec.ts`: `ROOM_NETWORK_LIVE=1` の明示起動のみ。実JWT、実Postgresへの同時再送、Alice GUI/Bob REST、両GUIへのSSE、ACK/相手画面反映のp50/p95/p99。`ROOM_NETWORK_LOAD=1` は10room/20userのSSE、同時更新と再接続。`ROOM_NETWORK_RESTART_PROBE=1` は専用4316の候補APIを起動・停止し、再起動後も同IDが一度だけ適用されることを確認する。
- 出力は `artifacts/room-network/{baseline,latency,load}.json`。標本数・API経路・測定場所・Server-Timingを必ず一緒に保存する。`ROOM_NETWORK_BASELINE=1` は変更前ACKだけを測る分岐であり、GUI/障害受入とはしない。
- 公開DNSをDoHで読み、必要なら `ROOM_NETWORK_PUBLIC_IP` で測定中だけHTTPS接続先とChromium名前解決を固定する。Host/SNI/証明書検証は元のAPI名を維持。実運用DNSやIP選択は変更しない。

PGliteのPromise.allは単一DBセッションであり、複数Postgres接続の競合証明には使わない。
実HTTPの同ID並行再送で補う。Windowsの送信側とChromiumが同じPCの場合、外部利用者のRTT測定とは区別する。
空pregame更新の性能は重い盤面の性能ではない。性能目標は調査文書の条件付き目標であり、未測定のp99や10ルーム負荷を推定で埋めない。

段階4のWebSocket command/ACKとメモリownerは、REST+SSEの測定で永続DB以外の通信時間が支配的と分かった場合に採用する。
採用しても操作ID、永続ACK、取消fence、viewer別配信、再同期の契約を維持する。根拠なしにRedis、DB地域移動、VM移行を行わない。

## 測定・受入証跡

2026-10-27 02:32 JST、変更前の公開API（0d4ab5a、原子的RPC未適用）へ同PCから公開入口103.84.155.217経由で40回の空pregame更新を実行。
ACK p50=674ms / p95=1,107ms / p99=1,233ms。Server-TimingはDB読取・CAS・履歴追加が支配的で、engineは概ね1ms未満だった。
使い捨てroomとAuth userは試験のfinallyで削除し、DB残留room=0を確認した。
これは同条件比較の基準であり、外部端末・重い盤面・全入口の性能や障害復旧成功を示さない。

個別の合否は `logs/harness/` とPlaywright結果、測定値は上記JSON、公開SHA/treeは `logs/auto-merge-runs/` のreceiptで確定する。
作業tree削除前に本taskの証跡をprimaryの `artifacts/room-network/` へ保全する。全件gateと公開後の認証済み操作確認を省略しない。

本番DBへ20261026181917を適用し、SQL/REST readinessとservice_role限定のsettle権限、旧API再開を確認。
候補APIの専用loopback経路では、実DBの同ID5並行要求が1回だけ確定し、API再起動後の同ID再送もduplicateになった。
40回の空pregame更新はACK p50=340ms / p95=489ms / p99=1,155ms、相手Chromium描画は380ms / 532ms / 1,181ms。
10room/20userの同時接続・全接続の張り直しと30更新はACK 814ms / 921ms / 924ms、Node側SSE受信924ms / 1,024ms / 1,024ms。
loopback値を変更前の公開Funnel値と直接比較しない。段階4はREST+SSEを維持し、永続DB往復が残る状況でWebSocketやメモリownerを追加しない判断とする。
公開後の同経路比較と最終配備SHAは保存した受入証跡で確認する。
