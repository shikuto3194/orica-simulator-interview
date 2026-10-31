# dotの相手席接続

プロジェクトルートで、既存の相手用アカウントを指定して起動します。APIは通常の4310番ポートを使用します。APIや他の開発サーバーを再起動する必要はありません。

```powershell
$env:DOT_ACCOUNT_EMAIL = '相手用アカウントのメールアドレス'
node scripts/dot/start.mjs
```

表示された127.0.0.1のURLを別のプライベートウィンドウで開き、通常のログイン画面に直接入力します。「このアカウントでdotに接続」を押すと、このPC内の補助だけに現在のアクセスセッションを渡します。パスワードやセッション値をチャットへ送る必要はありません。

補助はアクセスセッションを一時メモリに保持します。更新トークンは受け取らず、失効後は再接続が必要です。「dotを切断」、補助の終了、またはセッションの失効で操作できなくなります。通常のブラウザー側のログイン保存は既存アプリの動作に従います。

ローカル操作にはURLの接続キーを`X-Dot-Connection`ヘッダーに指定します。キーも公開・保存しないでください。別OriginやHostのリクエストは拒否します。通常の招待参加でbob席を確認し、自分の保存デッキを明示選択してから通常の対戦操作を行います。

- GET `/dot/status`、`/dot/invitations`、`/dot/decks`、`/dot/lobby`、`/dot/state`、`/dot/actions`
- POST `/dot/accept`に`{invitationId}`、`/dot/deck`に`{deckId}`
- POST `/dot/decision`に`{kind,payload}`。`payload.expectedVersion`は最新の状態から取得します。
- POST `/dot/disconnect`で接続を破棄します。

管理者API・既存ルームのホスト操作・ゲーム状態の直接書き換え・ランダムデッキ選択は提供しません。状態はAPIが本人向けに秘匿した通常の画面と同じ情報です。終局後は本人のbob席を通常APIで再確認した上で結果を取得できます。APIのルールリビジョンが変わったら、補助を起動し直します。

切断・失効後は、待機中の処理から新しい操作を送信しません。切断前にAPIへ送信済みの操作は、API側で完了する場合があります。

境界・終局取得の回帰は`node scripts/dot/test.mjs`、実カードの合法手とデッキ検証は`apps/playground-web/test/dot-rules-adapter.test.ts`で確認します。
