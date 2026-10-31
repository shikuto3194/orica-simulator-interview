# 公開DNS・Funnelの監視と復旧

現行の[PC公開構成](local-pc-deployment.md)に追加する。ゲームAPIの更新・再起動処理から独立し、
公開URL、転送先、API認証は変更しない。対象は `kenshi2.tail4e104f.ts.net:443` →
`http://127.0.0.1:4310` に固定する。

## 障害の記録と根拠

2026-09-27 21:52 JST頃、ローカルAPIは200、Tailscaleはonline、Funnelはonだった一方、
Google・Cloudflareと直接問い合わせた権威DNSがNXDOMAINを返した。
同じ設定の再適用・off/on後、21:56頃に権威DNS、22:00頃に公開リゾルバーと公開経路のAPI応答が正常化した。
削除履歴や登録失敗ログは未確認であり、根本原因や再設定との因果関係は確定していない。

2026-09-28 16:57 JSTの導入前検査では、公開DNSは正常だが公開IP経由TLSが切断された。
ローカルAPIと通常のURLアクセスは200だった。同じ設定の再適用・off/on後、
17:03に公開IPv4・IPv6の4経路すべてで200を確認した。これも復旧との因果は未確定。
TLS接続失敗だけでは回線・中継障害を区別できないため、自動切り替え条件には含めず通知対象とする。

信頼度A（2026-09-28確認、運用仕様に採用）:

- [Tailscale Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel):
  `status --json`、対象ポートの`off`、`--bg`による継続公開。
- [Funnel DNS反映](https://tailscale.com/docs/features/tailscale-funnel#dns-propagation):
  公開DNS反映に最大10分かかる場合がある。
- [GitHub Actions通知](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs):
  scheduleを作成・変更したユーザーの通知設定に従う。
- [scheduled workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule):
  default branch上で実行し、混雑時の遅延・取りこぼしがあり得る。

3回連続判定、15分待機、毎時2回上限は実装上の運用判断（C）。
他環境の類似報告をこの障害の原因確定や修正済み根拠として扱わない。

## 構成

| 部分 | 実装 | 役割 |
|---|---|---|
| DNS・HTTP | `deploy/local-pc/funnel-probe.mjs` | 公開DNSと公開IP経由HTTPS、ローカルAPI、権威DNS |
| 復旧判定 | `deploy/local-pc/funnel-policy.mjs` | 連続異常・待機・上限・再有効化のjournal |
| PC監視 | `deploy/local-pc/funnel-watchdog.mjs` | 1回の観測・記録・条件付き復旧 |
| Windows登録 | `deploy/local-pc/register-funnel-watchdog.ps1` | 毎分・ログオン時、現在のユーザーで非表示実行 |
| PC外監視 | `.github/workflows/public-api-monitor.yml` | 30分間隔指定・手動実行、公開経路だけを検査 |

依存追加・service-roleキー・Tailscale認証情報の外部保存は不要。
Windowsタスクはcommit済みの3つの監視モジュールを
`artifacts/pc-api/funnel-watchdog/<commit>/` に保存して実行する。
ブランチの切り替えで稼働コードを変更しない。更新は新commitから再登録する。

## 判定と自動復旧

1. 毎分、ローカル`/healthz`、Tailscale状態・設定、Google/CloudflareのDoH（A/AAAA）を確認する。
2. DNSの公開IPへHTTPS接続し、元ホスト名でTLS証明書と`{ok:true}`を確認する。
   MagicDNS・ループバック・プライベートIPは外部経路として認めない。
3. 両リゾルバーのA/AAAAがNXDOMAINの場合、`ts.net`のNSを発見し、全NSへA/AAAAを直接照会する。
   1つでも登録あり・タイムアウト・不明なら再設定しない。
4. API正常、Tailscale online、設定が対象1経路と完全一致、全DNSでNXDOMAINの観測が
   3回・2分以上続いたときだけ復旧候補にする。観測の間隔が150秒を超えたら連続判定をやり直す。
5. 復旧直前に状態・設定と停止スイッチを再確認し、journalを永続化して443だけをoff/onする。
   再有効化はfinallyで試みる。途中で運用者が設定を変更した場合は上書きしない。
6. 15分待機し、1時間に最大2回まで。公開DNSとHTTPSが正常になるまで復旧完了とはしない。

API異常・一般回線断・認証切れ・手動停止・別転送先・DNSキャッシュ待ちは復旧対象外。
Funnel切り替えで既存接続が切れる可能性がある。APIプロセス自体は再起動しない。
生きているが応答しないAPIの復旧は本機能の対象外で、外部監視の失敗として扱う。

## 永続状態と多重起動

保存先は `logs/pc-api/funnel-watchdog/`。

- `state.json`: 連続回数・復旧時刻・途中journal。壊れていれば自動操作を止める。
- `events.jsonl` / `.previous`: 観測と操作前の根拠。5MiB超で1世代ローテーション。
- `latest.json`: 最新結果。peer一覧・アカウント情報・鍵は保存しない。
- `disabled`: 運用者の停止スイッチ。途中journalより優先する。

監視中は`127.0.0.1:4311`を排他的にbindする。外部公開はしない。
重複プロセスや別用途の使用中は復旧しない。終了・クラッシュ時はOSがleaseを解放する。
Task Schedulerも`IgnoreNew`にする。
途中で終了した再有効化は、15分以内・空の設定・同じホスト・API正常の場合だけ再開し、
再有効化は合計3回まで。通常の手動offにはjournalがないため勝手に再開しない。

## 導入と停止

最初に読取確認する（状態ファイルも書かない）:

```powershell
node deploy/local-pc/funnel-watchdog.mjs --check
node deploy/local-pc/funnel-watchdog.mjs --external
```

commit・検証・merge後、対象PCで実行する。管理者昇格やWindowsパスワードは不要。

```powershell
pwsh deploy/local-pc/register-funnel-watchdog.ps1 -Mode Observe
pwsh deploy/local-pc/register-funnel-watchdog.ps1 -Mode Recover
Get-ScheduledTaskInfo -TaskName orica-funnel-watchdog
```

公開停止や手動メンテナンスの前には、監視の停止スイッチを先に設定する。
稼働中の復旧処理にも停止意思を伝えるため、タスク停止だけで済ませない。

```powershell
pwsh deploy/local-pc/register-funnel-watchdog.ps1 -Mode Disabled
```

この操作はFunnel/APIを停止しない。公開停止は[既存手順](local-pc-deployment.md#停止と再開)に続く。
再開時はFunnel/APIを戻し、`-Mode Recover`で監視を再登録する。
PCの電源OFF・スリープ・ログイン前にはローカル復旧は動かない。

## 外部確認と通知

GitHub Actionsの`Public API Monitor`が公開APIを検査する。監視のためにPCへログインしない。
障害時はworkflowを失敗にし、DNS・IP別の結果をログとjob summaryへ残す。
復旧は次の成功runとsummaryで確認できる。通知配信はユーザーのGitHub Actions設定に従う。
失敗のみ通知する設定では復旧メールは送られない。連続障害時の通知もGitHub設定に従い、
本workflowは通知の重複抑止やTelegram送信を行わない。
30分はcron指定の間隔であり、実行・検知時間の保証ではない。公開repositoryの長期無活動による
schedule停止などもGitHubの実行条件に従う。手動のworkflow_dispatchで随時確認できる。
非公開repositoryなので、通常1分未満でも各jobの使用時間は分単位で切り上げられる
（[GitHub公式A](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-job-execution-time)）。
30日で約1,440回。CI等と利用枠を共有し、枠不足・課金上限で監視が止まる場合がある。
実行間隔の変更はworkflowのcronと回帰テストを併せて更新する。

## 検証

`node scripts/test-funnel-watchdog.mjs`は正常・片DNS障害・回線断・権威DNSの不一致・
手動停止・設定競合・復旧上限・途中終了・壊れた状態・多重起動を検証する。
実環境で障害を故意に発生させず、`--check`と`--external`で正常時を確認する。
関連差分の完了検査は`pnpm codex:finish-check`。API本体変更が混ざればfullへ昇格する。
