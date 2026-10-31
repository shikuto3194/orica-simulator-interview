# Oracle Always Free への API 配備

**2026-09-23: 対戦APIのVM移行はユーザー指示で保留。** Oracle登録は完了し、
先に[対戦AI専用VM](oracle-ai-deployment.md)を用意する。本書のAPI配備手順は移行再開時に使う。

Netlify は `apps/playground-web/dist`、Oracle VM は `dist/api` を使う。
認証・ルーム状態・スナップショット DB は既存 Supabase に残す。
API は単一 Node プロセスで常駐し、Caddy が HTTPS と SSE の転送を担当する。
SSE の接続一覧はメモリにあるため、複数プロセスや複数 VM に分散しない。

## 現在の準備状況

2026-09-23: 本人から登録完了の報告と大阪リージョンのコンソール画面を受領。
AI専用VMは大阪A1の空き容量不足で未作成。HTTPS・外部疎通は未実施。
Netlify は `https://gentle-heliotrope-e31174.netlify.app`。
対戦APIは引き続き [Windows PC + Tailscale](local-pc-deployment.md) で運用する。
VM 用の API ホスト名は別途確定後に設定する。
VM 未作成の段階では、ローカル検証を通っても配備完了とは扱わない。

## 無料 VM の選択

- ホームリージョン内の Always Free 対象 Ubuntu ARM イメージと `VM.Standard.A1.Flex`。
- **1台、2 OCPU / 12 GB RAM**。既存 A1 使用量も合算し、割当と料金表示を確認する。
- ブートボリュームは標準最小容量（約50 GB）。無料ストレージ合計200 GB以内。
- 公開サブネット、インターネットゲートウェイ、公開 IPv4 を持たせる。
- SSH は公開鍵認証。TCP 22 は管理元 IP、80/443 は公開用として許可する。
  OCI のセキュリティリスト/NSG と Ubuntu 側 firewall の両方を確認する。
  Node の3000番ポートは `127.0.0.1` のみに bind し、外部へ開けない。
- 有料プランへアップグレードしない。30日トライアルのクレジットを無料枠の根拠にしない。
  空き容量不足・アイドル VM 回収があり、永続稼働や負荷上限は保証されない。

## ローカルビルドと初回準備

```powershell
pnpm build:api
scp -r deploy/oracle ubuntu@VM_IP:~/orica-setup
scp -r dist/api ubuntu@VM_IP:~/api
ssh ubuntu@VM_IP
```

以降は VM 上で実行する。初回 SSH は OCI コンソール等でホスト鍵を確認し、
ホスト鍵検証を無効にしない。秘密鍵を Git や公開 dist に入れない。

```bash
sudo bash ~/orica-setup/install-ubuntu.sh
sudoedit /etc/orica/api.env
```

`api.env` は root 所有、権限600。`SUPABASE_SERVICE_ROLE_KEY` は既存 Supabase
プロジェクトのサーバー専用キーを設定する。チャット・ログ・Git に貼らない。
`ALLOWED_ORIGINS=https://実際のサイト.netlify.app` とし、末尾スラッシュなし。
複数の正規サイトはカンマ区切り。`*` や preview 全件許可は使わない。
`HOST=127.0.0.1`、`PORT=3000` は同梱 Caddy / 配備スクリプトと揃える。

```bash
sudo bash ~/orica-setup/deploy-api.sh ~/api
```

Node 22 LTS は公式配布のハッシュを照合して導入する。API 依存はビルド済み JS に
同梱するため、VM へソース・node_modules・pnpm・カード画像を置く必要はない。
API 成果物は静的ファイルとして配信しない。`/api/game` の開発用操作は未登録。

## HTTPS と Netlify

API 用 DNS の A レコードを VM の公開 IP に向ける。独自ドメインがない場合は、
無料 DNS 等で利用できるホスト名を確定してから進める（有料ドメインは購入しない）。
`deploy/oracle/Caddyfile` の `api.example.com` を実際のホスト名に置き換え、
`/etc/caddy/Caddyfile` に設置する。80/443 の到達と DNS を確認してから実行する。

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -fsS https://実際のAPIホスト/healthz
```

Caddy の通常の reverse_proxy は `text/event-stream` を即時 flush する。
TLS 証明書は Caddy が取得・更新する。証明書用データディレクトリを消さない。

Netlify はリポジトリルートを base として次を指定し、再ビルドする。

| 設定 | 値 |
| --- | --- |
| Build command | `pnpm build` |
| Publish directory | `apps/playground-web/dist` |
| 環境変数 | `VITE_API_BASE_URL=https://実際のAPIホスト` |

`VITE_API_BASE_URL` は URL のみで秘密情報ではない。REST・SSE・退出通知は共通の
`src/apiUrl.ts` 経由。空欄は開発と同じ origin を使うため、分離配備では必ず設定する。
Supabase の service role / secret key は Netlify や `VITE_` 変数に設定しない。
Supabase Auth の Site URL / Redirect URLs に実際の公開フロント URL を設定する。

## 更新・復旧・検証

- コード更新は `pnpm build:api` → `dist/api` を別の空ディレクトリへ転送 →
  `deploy-api.sh`。リリースを切り替え、自動再起動と `/healthz` の確認を行う。
  起動失敗時は直前のリリースへ戻す。旧リリースは手動で容量を管理する。
- `/healthz` は HTTP プロセスの生存確認。DB 接続と対戦の成功は別途確認する。
- `sudo systemctl status orica-api caddy`、`sudo journalctl -u orica-api -n 100`。
  アプリは非 root、読み取り専用のコード、サービスの自動再起動を使う。
- OS のセキュリティ更新・Node/Caddy 更新・容量とログの確認は VM 管理者が継続する。
  Node 更新は同梱 installer 再実行後に API を再起動して確認する。
- 公開先でログイン、ルーム作成/参加、デッキ/開始、両者の操作反映、SSE 再接続、
  観戦権限、退出/heartbeat、スナップショット入出力を確認する。
- ローカル: `pnpm build:api` → `pnpm test:api-build`、`http-server.test.ts`、`api-url.test.ts`、GUI/REST
  シナリオ、公開 dist の検証。実 VM の ARM/Linux、systemd、証明書発行は実配備時に確認する。

## 出典（2026-09-19確認、信頼度A、実装に採用）

- [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm): 月1500 OCPU時間/9000 GB時間、ホームリージョン、容量と回収制約。
- [Oracle Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm): 登録・無料利用と有料への移行。
- [Caddy 導入](https://caddyserver.com/docs/install): Ubuntu の公式 apt 配布。
- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy): SSE の flush。
- [Node HTTP](https://nodejs.org/api/http.html): タイムアウトと接続終了 API。
