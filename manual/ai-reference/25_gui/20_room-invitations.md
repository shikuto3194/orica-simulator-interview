# ルーム招待とメッセージ

## 操作

1. 「対戦ルーム」でルームを作成する。
2. 「ユーザーを招待」を開き、表示名で検索する。候補には表示名・アバターアイコン・キャラクターの二つ名を表示する。30件ずつページ移動できる。
3. ユーザーを選択し「招待を送る」を押す。送信中は二重操作を止め、失敗時は選択を保持して再試行できる。
4. 受信者のホームの「メッセージ」に未読件数を表示する。ホーム／メッセージ表示中は10秒ごととウィンドウ再フォーカス時に再取得する。
5. メッセージを開くと既読になる。ルームにはまだ参加せず、招待元のプロフィール・ルームID・有効期限を確認する。
6. 「参加する」でプレイヤー2として参加し、既存のデッキ選択へ進む。参加済みの招待は「ルームに戻る」になる。

メッセージ一覧は未読を優先して最大100件を表示する。未読件数は全件を数える。
運営通知は[日次更新のお知らせ](23_operation-notices.md)として別一覧へ進む。

## 端末通知

メッセージ画面の「端末への通知」で、その環境の通知を許可する。許可ダイアログはオン操作時だけ表示し、アプリを閉じていてもWeb Pushで通知する。ログアウト時はその環境の購読を解除する。

- **ユーザー単位で PWA ＞ 追加したアプリ／ショートカット ＞ ブラウザー**。通知経路を保存し、同順位では最後に登録した経路から試す。プッシュサービスへの送信が成功した時点で止め、失敗したときだけ次へ送る。OSが通知を表示した／ユーザーが読んだという確認ではない。
- standalone/fullscreen/overlayをPWA、iOSのホーム画面モードやminimal-uiを追加アプリとして識別する。通常ブラウザーと同じ表示モード・保存領域で開く単なるショートカットは区別できないためブラウザー扱い。インストール起動済みの購読は上位経路へ更新する。
- 通知を開く先も起動済みのPWA／追加アプリを優先する。対戦中・編集作業中の画面を置換せず、利用可能な画面がなければOSのアプリ起動経路を使う。別ブラウザー／別保存領域のPWAをWebから強制起動することはできない。
- iPhone／iPadはホーム画面に追加したアプリから通知を許可する。通知本文は共通文言のみで、通知を開くとログインを経て招待を表示する。閲覧だけで参加しない。
- 購読先URLは既知のブラウザープッシュサービスだけ許可する。404/410は購読を削除。それ以外は下位経路へ切り替え、全経路失敗時はDBの送信状態を使い最大5回再試行する。招待の重複送信では通知を再作成しない。

サーバー環境変数 `WEB_PUSH_PUBLIC_KEY` / `WEB_PUSH_PRIVATE_KEY` / `WEB_PUSH_SUBJECT` が必要。
`node scripts/configure-room-push.mjs` は未設定の場合のみ鍵を生成してGit対象外のAPI用 `.env` へ保存する。秘密鍵は公開しない・既存鍵を回転しない。常駐APIの環境変数変更後はsupervisorも再起動する。
`room_push_subscriptions` はservice_role専用。送信キューは5秒ごとに処理し、DB上の比較更新で複数workerによる同時取得を防ぐ。

## 保存・権限

- `room_invitations`: 招待元・受信者・ルーム・作成日時・期限・既読・参加日時を保存する。期限は24時間。ルーム削除時は招待も削除する。
- 招待できるのは、対戦開始前で空席があるルームの作成者。自分への招待は不可。同じルーム・相手への再送は1件にまとめ、期限内の既読状態を維持する。期限切れで未参加なら期限を更新して未読に戻す。
- JWTの検証はGame APIで行う。送信者／受信者はJWTから決定し、リクエスト本文のユーザー指定を信用しない。プロフィールAPIはユーザーID・表示名・アバターだけを返す。
- テーブルはRLS有効・クライアント権限なし。RPCは `SECURITY INVOKER`、空の `search_path`、`service_role` 専用。既存のrooms APIと同じサーバー経由の設計。
- `send_room_invitation` はルームの行をロックして検査・作成する。`join_room` は通常参加と招待参加で共用し、参加者の追加・既読・参加済み更新を同じトランザクションで確定する。
- デッキ決定も `set_room_deck` で同じ行をロックする。招待参加や両者のデッキ決定が重なっても、古い参加者配列で他方を上書きしない。
- 読み込み・既読処理では入室や接続期限の延長をしない。削除済み・満員・開始済み・期限切れは参加時にも検査し、理由を表示する。参加の再試行は同じ席へ再接続する。

## 実装と検証

- サーバー: `server/room-invitations.ts`、`server/game-api.ts`
- 画面: `RoomInvitePicker.tsx`、`MessageInbox.tsx`、`InvitationProfile.tsx`、`HomeLobby.tsx`、`RoomLobby.tsx`
- SQL: `20260923084249_room_invitations.sql`、`20260923085345_room_push_priority.sql`。2026-09-23に適用済み。通常参加・デッキ決定も新RPCを使う。適用状況は [migration一覧](../../../supabase/migrations/README.md) を参照。
- PostgreSQLの権限・期限・重複・席の維持: `apps/playground-web/test/room-invitations-postgres.test.ts`
- HTTPの本人限定・送信者偽装・公開フィールド: `apps/playground-web/test/room-invitations-api.test.ts`
- 縦横のGUI・明示参加・通信失敗の再試行: `e2e/room-invitations.spec.ts`
- 通知の許可／解除・起動モード・招待リンク: `e2e/room-push.spec.ts`。通知サービスへの送信・優先経路・切り替えは `room-push.test.ts`、起動先優先順位は `invitation-launch.test.ts`。実機のOS表示は別途確認対象。
- 実JWTのAlice GUI招待→Bob GUI参加とREST状態の一致・同時デッキ登録: `e2e/room-invitations-live.spec.ts`。一時匿名ユーザー2名と専用ルームだけを作成する。対象DBにマイグレーションを適用してから実行する。
- 後片付けは独立した90秒のfixture teardownで実行する。作成したIDだけを対象に、セッション失効・プロフィール削除・Authユーザー削除を行い、ルームも削除する。`profiles` は `auth.users` への外部キーがないため明示削除が必要。途中失敗時も残りを処理し、失敗は対象IDとともにテストエラーにする。削除後はDBを再取得して不存在を確認する。
- 後片付けの回帰: `room-invitations-cleanup.test.ts`（正常・途中失敗・部分作成・他ユーザー保持）。finish/pushではこの回帰と招待のmock GUIを実行する。実JWTテストはservice-role環境で別途実行する。プロセスの強制終了はteardownを保証できないため、残留があれば作成IDとAuthの有無を照合して回収する。

DB側の権限は [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) と
[Database Functions](https://supabase.com/docs/guides/database/functions) を参照して確認。
Web Pushは [web-push](https://github.com/web-push-libs/web-push)、[iOS／iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)、[通知からの起動](https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow) の一次資料で確認。
