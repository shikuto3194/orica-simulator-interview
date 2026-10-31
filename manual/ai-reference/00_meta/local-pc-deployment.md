# PC 起動中の API 公開

対戦APIのVM移行を保留している間の構成。フロントは Netlify、API はこの Windows PC、
認証と対戦データは既存 Supabase を使う。

2026-09-23: Oracle登録完了。先に[対戦AIだけをVMへ配備](oracle-ai-deployment.md)する。
対戦APIのホスト変更はユーザーが移行を再開するまで行わない。

2026-09-19: タスク登録と Funnel 有効化、公開 DNS 経由の health、指定サイトの
CORS、未認証操作の401、秘密ファイル・開発APIの404を確認済み。
接続先入りのフロント dist は生成済み。Netlify 再アップロードと認証済み対戦は別途確認する。

## 接続先と起動

- フロント: `https://gentle-heliotrope-e31174.netlify.app`
- API: `https://kenshi2.tail4e104f.ts.net`
- ローカル API: `127.0.0.1:4310`。開発サーバーやファイル共有は公開しない。
- `orica-pc-api` タスクは現在のユーザーで Windows ログイン時に起動する。
  管理者昇格・SYSTEM 実行・Windows パスワードの保存は使わない。
- 毎分の起動トリガーも持ち、API が終了した場合は最長1分で再起動する。
  実行中は重複起動しない。通常のスリープ解除後は同じプロセスを使う。
- Funnel は `--bg` で保存し、Tailscale の再接続・PC再起動後も同じ URL を使う。
  公開機能の初回有効化が必要。API はログイン前・電源OFF・スリープ中には応答しない。

`deploy/local-pc/run-api.mjs` は API 子プロセスを監督し、60秒ごとに `origin/main` を確認する。
新しい commit は作業ツリーを変更せず Git から別ディレクトリへ書き出し、API build と
起動・認証境界・CORS・rate limit の smoke test 後、候補版のDB readinessを別processで確認して自動再起動する。
配備先は `artifacts/pc-api/releases/<commit>`、稼働版の記録は `current.json`。
依存junctionを含む作業buildは `.codex-temp/pc-api-build/<commit>` に置き、成功・失敗時とも後始末する。
容量監査対象の `artifacts/` に一時的な依存リンクを作らず、完成したreleaseだけを移す。
この変更を既存の監督processへ反映するには、下記の監督script更新とtask再起動が必要。
ビルド中は旧 API を維持し、起動後の `/readyz` とrevisionの一致を総15秒以内に確認できなければ互換な旧版へ戻す。
同じ候補の失敗は1分→5分→15分→30分上限で待機し、別SHAは直ちに評価する。
`artifacts/pc-api/update-failure.json` に試行前の記録を原子的に保存し、中断した試行も次回起動で待機対象にする。
記録の読書き異常では現APIを維持して自動更新だけを停止する。原因を修復して監督processを再起動する。
rate limit検査は実buildのHTTP factoryに試験内だけの時計を渡し、通常60/PC120の枠、次の1要求の429、Retry-Afterと1秒の補充数を検査する。本番の制限値や環境変数を試験用に緩めない。
起動判定後の異常終了は現行版を再起動する。readinessは瞬間の確認であり、その後の全期間の正常動作や自動切戻しを保証しない。
切替時は新規受付を止め、SSEにreconnectを送って閉じ、進行中要求を最大25秒待つ。
実行中の遅延ロード用 chunk は上書きしない。監督プロセスが終了した場合は
IPC切断で子APIも終了し、既存Windowsタスクが再起動する。
秘密キーは既存 `apps/playground-web/.env` から実行時に読み、
Netlify やフロント用環境変数には渡さない。
CORS は上記フロントだけを許可し、API の JWT 認証・参加者権限も維持する。
CORS 自体は API 認証の代わりにはならない。
監督scriptの更新は公開済みSHAの原本を `artifacts/pc-api-supervisor-<SHA>/` へ抽出し、
WindowsタスクのActionだけをそのrun-apiへ変更できる。この深さなら既存rootを維持する。
既存タスクXMLを保存し、trigger/settings/principalとhidden起動は保持する。共有checkoutのtracked fileは変更しない。
厳密保存v2への初回移行は通常の自動更新と分ける。公開済み候補を隔離build・検証してからタスクの再起動トリガーを一時停止する。
さらに稼働中のタスク・監督processを終了し、旧APIの進行中要求の排出・子process終了・4310 listener不在を確認する。trigger停止だけでは稼働中の更新loopは止まらない。
更新writerがいない間にDB移行を一括適用し、厳密保存v2のreadinessを確認する。初回は旧版へ戻す`replaceRelease`を使わない。
事前buildした対応版だけを専用portで起動してrevisionとreadinessを確認し、停止後に`current.json`をその版へ原子的に更新・読み戻す。
新しい監督scriptと対応版pointerを確認してからタスクを復帰し、公開revision・readiness・専用ルームの操作を確認する。対応版起動失敗時は保守状態を維持する。
`initialize_room_state`を持たない旧APIには戻さず、DB保護を削除しない。標準の監督scriptは起動時にpointerの版を先に起動するため、旧pointerのまま復帰しない。
移行失敗時はDBトランザクションの結果を確認してから復旧する。旧版の開始処理を通すためのtrigger無効化は禁止。
このPCなど Tailscale 接続端末では API 名がプライベート IP に解決されるため、
Chrome が要求した場合は、この Netlify サイトのローカルネットワークアクセスを許可する。
外部経路の検証では公開 DNS のアドレスを使い、Tailscale 内だけの成功と区別する。

## フロントの再配備

退出通知も JWT 認証を必須にしたため、API 更新時は新しいフロントも再配備する。
旧フロントの未認証退出は401で拒否され、切断検知は既存 heartbeat timeout に委ねる。

手動アップロード時は `apps/playground-web/.env.production.local` に
`VITE_API_BASE_URL=https://kenshi2.tail4e104f.ts.net` を設定して `pnpm build`。
公開するのは `apps/playground-web/dist` だけ。`dist/api` やプロジェクトルートは不可。
Git 連携の Netlify build はルートの `netlify.toml` で build command・publish directory と
`VITE_API_BASE_URL` を設定する。`.env.production.local` は Git 管理外なので、
手元だけに設定しても Netlify の自動ビルドには渡らない。API の移転時は
`netlify.toml` も更新する（ファイル内の設定は Netlify UI の同名変数より優先）。
設定変更を push して再ビルドするまで、公開済み JavaScript の接続先は変わらない。

2026-09-19の公開版ルーム作成404は、公開JSの API 接続先が未指定で
Netlify 自身の `/api/room` にPOSTしていたことが原因。API の health 200 と
指定フロントの CORS preflight 204を確認し、上記のGit管理設定を追加した。
再配備後はブラウザでルーム作成先がAPIホストになっていることも確認する。
出典（2026-09-19確認、信頼度A、運用に採用）:
[Netlify環境変数](https://docs.netlify.com/build/environment-variables/overview/)、
[Vite環境変数](https://vite.dev/guide/env-and-mode)。

タイトル背景・BGMはGit管理のWebP/M4Aを含むdist全体を配備する。
圧縮・ビルド検査は [公開用 dist](public-build.md#タイトル背景bgm-の配備前提) を参照。
2026-09-19に公開先で背景0枚・音源0曲を確認し、Git管理外だった素材を
背景45枚・音源260曲の圧縮ファイルとして管理する方式へ変更した。
ローカルの生成・検証と公開先への反映完了は区別する。

右下の Netlify バッジは Project configuration → General → Powered by Netlify badge
で無効化する。2026-09-19にユーザーが設定変更し、公開ページから消えたことを確認済み。
2026-08-19以降の新規無料サイトでは初期状態が有効で、古いサイトとの差はこの設定に由来する。
出典（2026-09-19確認、信頼度A、運用に採用）:
[Netlify公式](https://docs.netlify.com/manage/projects/powered-by-netlify-badge/)。

## 停止と再開

公開DNSの監視・条件付き復旧は[Funnel監視](funnel-watchdog.md)を参照。
監視導入後は、手動で公開停止する前に同文書の`-Mode Disabled`を実行する。

PowerShell で実行する。公開を完全停止するときは再開設定も無効にする。

```powershell
Disable-ScheduledTask -TaskName orica-pc-api
Stop-ScheduledTask -TaskName orica-pc-api
tailscale funnel --bg --https=443 off
```

再開:

```powershell
Enable-ScheduledTask -TaskName orica-pc-api
Start-ScheduledTask -TaskName orica-pc-api
tailscale funnel --bg --https=443 http://127.0.0.1:4310
```

通常の更新は検証済み変更を `main` に push する。60秒以内の検知後、ビルド・検証が成功すると
APIが自動再起動する。`/healthz` の `revision` が配備commitと一致することまで確認する。
Git通信・build失敗時は旧版を維持して次の巡回で再試行する。
依存lockがローカル環境と異なる場合は旧版を維持するため、ローカルcheckoutと依存を更新し
`pnpm install --frozen-lockfile` を行う。未commitの編集は配備対象に含めない。
`.env` や監督スクリプト自体を変更した場合はWindowsタスクを再起動する。
`releases/` の旧版は稼働版・直前版を残して手動管理する。

## ブラウザの更新

ページ再読み込みでは最新HTMLをネットワークから取得する。他のタブを開いたままでも
旧キャッシュのHTMLに固定しない。PWAの復帰・オンライン復帰と表示中の60秒間隔で
SWを更新確認する。新版の有効化後、タイトルまたは編集中デッキのないホームで
自動再読み込みする。対戦・デッキ編集中・アバター選択中は保留し、安全な画面へ戻った
時点で反映する。オフライン時は事前保存したHTMLへ戻る。
画像・BGMの差分保存は認証中のアプリが独立して継続し、進捗を表示する。
旧「全タブを閉じるまで待機」版からの初回移行では、ハード再読み込みまたは全タブを
閉じて開き直すことで新しい更新処理を取得できる。

2026-09-21のBSTH04-X01再報告は、公開フロントには修正が含まれる一方、
稼働APIが09-20のコピーのままだった。添付T2盤面は旧版で不正な導技候補1件、
現行版では0件となることを全効果登録で比較した。ローカルの修正・pushだけで
公開サービスまで反映済みと判断しない。

出典（2026-09-21確認、信頼度A、実装に採用）:
[Vite PWA更新](https://vite-pwa-org.netlify.app/guide/prompt-for-update.html)、
[Service Worker skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting)。

## API の保護と残る範囲

退出は JWT の本人と body.userId の一致・ルーム所属を確認する。
フロントは認証ヘッダー付き `fetch` の `keepalive` を使い、ページ終了時は
有効なキャッシュ済みトークンを同期取得する。未達の場合も未認証送信には戻さない。

本番 HTTP 入口は認証・DB 処理より前に次を制限する。正源は
`apps/playground-web/server/api-limits.ts`。dev Vite の単一ゲーム API は公開対象外。

| 項目                        | 全体 | 接続元ごと |
| --------------------------- | ---- | ---------- |
| 継続リクエスト/秒           | 60   | 30         |
| 一時バースト                | 120  | 60         |
| 処理中リクエスト（SSE含む） | 64   | 32         |
| SSE接続                     | 32   | 16         |

超過は429と `Retry-After` を返す。応答完了・切断で枠を戻す。
TCP接続は全体128、無通信35秒で閉じる（SSEは5秒pingで維持）。
接続元の記録も1024件に制限し、未使用の記録は回収する。
`X-Forwarded-For` 等の自己申告ヘッダーは信用しないため、Funnel経由の利用者は
`HOST=127.0.0.1` と `API_BEHIND_LOOPBACK_PROXY=1` の両条件で、接続元枠だけ全体枠と同じ値にする。
認証後は検証済みuser IDごとに15件/秒・burst30・処理中8・SSE3を別途制限する。
全体60件/秒・SSE32等の上限は維持する。20人が同一proxyに見えることによる16接続制限を避ける。

これはアプリの処理量を制限する対策で、回線飽和を防ぐDDoS対策ではない。
APIは引き続き普段のWindowsユーザーで実行する。専用ユーザー/VMへの隔離は未実施。

## 確認

ルームの保持期間・定期清掃・保存済みスナップショットの扱いは
[ルーム保持期間](room-retention.md) を参照。

- `Get-ScheduledTask -TaskName orica-pc-api` と `Get-ScheduledTaskInfo -TaskName orica-pc-api`。
- `tailscale funnel status`、`https://kenshi2.tail4e104f.ts.net/healthz`。
- `/readyz` は原子的commit・settle・heartbeat・index・保護triggerを確認する。`/healthz` と両方確認する。
- ログ: `logs/pc-api/scheduled-api.log`。書き込み時に5MB超なら前回分へローテーション。
- 外部から health、CORS preflight、未認証操作の拒否、SSE、対戦の操作反映を確認する。
  health の成功だけでは認証済み対戦やフロント再配備の成功とは扱わない。

## 出典

2026-09-19確認、信頼度A、運用に採用:
[Tailscale Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel)
（HTTPS、`--bg` の再起動後継続、`off` による停止）。

2026-09-19確認、信頼度A、実装に採用:
[MDN Request.keepalive](https://developer.mozilla.org/en-US/docs/Web/API/Request/keepalive)
（ページ終了時のfetch継続と認証ヘッダー指定。送達保証にはしない）。
