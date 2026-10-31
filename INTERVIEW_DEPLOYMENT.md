# 幻想符 面接用デプロイ

## 公開状態

- 面接ラベル: `interview-001`（ログインIDではなく、DB上のデータ領域の管理名）
- 公開URL: https://orica-simulator-interview-001.netlify.app/
- Netlify deploy: `6ae54e8dee04beb99ae7af5c`、state `ready`
- 面接API: https://kenshi2.tail4e104f.ts.net:8443
- Netlifyビルド変数: 面接SupabaseのURLと公開用publishable key、API URLをproduction/buildsに設定済み。service-role keyは設定しない。
- Authの新規登録: OFF（Supabase Auth settings APIで `disable_signup=true` を確認）
- 面接ログイン: `interview-001@example.invalid`。Supabase Adminで作成・メール確認済み、新規登録フォーム経由ではない。`interview-001` の通常memberとして有効化し、3サイトで共通利用する。`.invalid` は受信不能な予約ドメインのため、メールによるパスワード再設定はできない。

実ブラウザーの未ログイン画面は `幻想符` のログインフォームで、登録リンクはない。Netlifyのサイトパスワード/SSO保護は設定していないため、静的HTML・JavaScript・カード画像は公開取得できる。アプリ内ログインは静的配布物を隠す機能ではない。

## API稼働・境界

面接APIはこのworktreeのビルド成果物に固定した `interview-001-working-tree` revisionで稼働する。Tailscale Funnelは8443番だけを追加し、既存本番443番（localhost:4310）の設定は維持した。Windows PC、Nodeプロセス、ネットワーク、Tailscaleが稼働中であることが必要。

確認結果:

- API `/healthz`: HTTPS経由で200
- 面接サイトOriginのCORS preflight: 204、許可Originは面接サイト1件のみ
- 未認証API: 401
- 本番サイトOrigin: 403、Access-Control-Allow-Originなし
- API smoke: startup/revision/CORS/authenticated leave/rate limit/private route isolation/Supervisor停止を通過

## Supabaseとデータ

共有Supabaseは面接専用プロジェクト `ouqvnabeiwjysuvehmrq`。本番Supabase `nnthvbizvqpufpfkzlho` は変更しない。DBにはactive tenant `interview-001` とread-only seedがあり、各tenantに仮名化プロフィール18件、デッキ6件、イベント7件、参加者32件、ラウンド19件、マッチ41件を用意した。全public app tableでRLSとFORCE RLSが有効。readiness RPCはtrue、security advisor lintは0件。Storage bucketは0件。

面接ユーザーJWTによる直接REST確認で、自分のtenantのプロフィール1件とイベント7件を取得でき、seed tenantのイベント更新は0行だった。さらに一時的な別tenant/userを用いたA/B検査で、双方が自分のプロフィール1件だけを読み、相手の読み取り・更新は双方0行になることを確認した。一時tenantとprobe userは削除済み。seedと履歴数の一致、RPCのservice_role限定、API認証・CORSも確認済み。

## ビルドと運用

`apps/playground-web/.env.local` はローカル専用の公開Vite設定、`apps/playground-web/.env` は面接Supabaseのserver-only設定。どちらもGit管理しない。Netlifyビルド値も面接用siteに設定済み。再デプロイ時はこの専用siteだけを使う。

初回一括asset download / Service Worker / Cache Storage / OPFS / snapshotやreplay downloadは無効。ローカルdistに `sw.js` がなく、配布ファイル1,093件を確認済み。登録済みの画像/音声は必要時に取得され、ブラウザー標準HTTP cacheは利用され得る。

面接終了時はサイトとAuthアカウントを停止し、このtenantの行だけを削除する。seedと他tenantは残す。自動期限は設定しない。
