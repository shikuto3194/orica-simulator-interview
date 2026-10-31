# Full-run 起動停止・hub操作

[full-run-supervisor.md](full-run-supervisor.md) の詳細。運用判断の入口は元runbook。

## 起動と停止（人間の操作はこの 2 つ＋裁定回答のみ）

- **現在の範囲（2026-10-05 ユーザー指示）**: coverage/fidelityの残件を先に修復し、[ISMCTS program](ismcts-full-run/README.md)を実装・検証する。監査0で停止しない。VM未確保のため承認済みPC経路を負荷上限付きで使う。
- **開始と運用移行は許可済み**: I0〜I7の証跡・配備・固定評価・自律運用が揃ったら親側で既存 `orica-full-run-supervisor` を120分へ移す。2026-10-06承認によりAI強化は可能なら24時間、学習・評価・モデル更新はLLM非依存。120分は当初のLLM成果確認周期。[運用契約](ismcts-full-run/operations.md)に従い、primaryの対話branchは保全する。

- **固定先**: `scripts/full-run-checkouts.json`と[固定先規定](full-run-supervisor.md#作業先統合先の固定2026-10-02ユーザー訂正)に従う。起動・登録scriptは専用main treeから実行する。15分再開のactionも同じtreeを参照し、更新時は稼働processと有効/無効状態を保持する。

- **Codex-only 再起動復帰プロファイル（2026-08-14）**:
  `pwsh scripts/configure-codex-autostart.ps1` を正源にする。この script は
  `orica-full-run-supervisor`（15min + logon、実行中はスキップ）、`orica-telegram-relay`（1min fallback + logon）、
  `orica-telegram-inbox`（long-poll + 1min restart tick + logon）を登録/有効化する。
  legacy `orica-engine-claude-iteration` は停止/無効化を維持する。`orica-card-impl-loop` は
  task0 gate 付きの Codex worker であり、Claude task ではない。
  現在起動中の Claude デスクトップアプリも終了するが、アプリ自体は削除しない。
  同時に旧 `Claude-Code-Remote` の `telegram-polling.js` と同名 task を停止し、Bot API の `getUpdates` を Codex inbox に一本化する。
  Task Scheduler Operational log も有効化し、wrapper 起動前の OS 側失敗を追跡可能にする。
  Windows の AutoAdminLogon 自体は秘密情報を OS に保存する設定なので repo script では変更せず、
  設定有無を警告するだけ。`Register-ScheduledTask` が sandbox user 差で拒否される環境では
  `schtasks /Create /RU kensh /IT` fallback で minute schedule として登録し、ログオン後に自動復帰する。
  Claude 復帰分岐は持たない。旧 `register-claude-task.ps1` /
  `run-claude-iteration.ps1` は Codex supervisor 互換入口としてのみ残す。
- **起動**: ユーザーが「**フルラン開始**」と打つ → scheduled task
  `orica-full-run-supervisor` と Telegram relay/inbox task を enable し、初回 worker を即時実行する。
  Codex App heartbeat automation は旧通知 hub なので、明示指示がない限り再 enable しない。
  各イテレーションは手順 2 の条件に該当するレーンを sub-agent で起動する。**現状は engine レーン
  （本変換 = stub 解消）の単独運転**。**検証レーンは使用料配慮によりユーザー指示で停止中
  （2026-06-16）** — 継続並走しない。supervisor は engine-drain で coverage / fidelity 残件も
  実装する。新弾追加・B 面監査で coverage todo が再発しても、別 cards task の再開を待たない。修正に必要な通常gateを実施し、監査0後はISMCTSタスクを進める。
- **停止**: 「フルラン停止」→ `orica-full-run-supervisor` を disable。Telegram relay/inbox は
  通知・裁定回答の repo-visible 経路なので、停止は明示指示がある場合だけ行う。ISMCTS完了時は停止せず上記の120分監視へ移行する。
- **停止整合**: task が Disabled なのに旧 hub heartbeat だけ ACTIVE、または
  `logs/codex-supervisor-state.json` が stale な `running` のまま残る状態は不整合。hub は worker
  起動前提の報告をせず、まず `pnpm supervisor:reconcile` で stale state を畳む。人間の「フルラン開始」
  なしに task / heartbeat を再 enable しない。
- worker の進捗・裁定質問・完了は `scripts/supervisor-report.mjs` が
  `logs/codex-hub-outbox/` に記録し、直後に `relay-outbox-to-telegram.mjs` を best-effort 実行する。
  取りこぼしは **`orica-telegram-relay` タスク（1分毎 fallback）** が Telegram Bot API 経由でモバイルへ中継する
  （無料・アプリ使用量非消費）。旧 Codex App heartbeat automation は発火毎にアプリ週間
  クォータを消費し枯渇させたため、2026-07-04 に通知経路を Telegram へ一本化した
  （heartbeat automation は app 側で disable 推奨）。Telegram からの裁定回答・指示は
  `scripts/telegram-inbox.mjs` が Codex 用 inbox へ同期し、`/ruling <cardNo> <本文>` は
  即時受付が解釈し、原文付きの実装引継ぎをdurable follow-upへ保存する（[受付正源](telegram-reception.md)）。
  relay task は未送信が残った tick を nonzero で終了して Task Scheduler に可視化するが、task 自体は有効のまま次 tick に FIFO 再試行する。
  `LastTaskResult=0` は送達済み、nonzero は relay log と outbox を確認する合図である。
- PC で要約イベントをリアルタイム確認する場合は `pnpm supervisor:watch` を使う。これは
  `logs/codex-supervisor-state.json` の `recentEvents` / `finalText` だけを読む軽量ビューアで、
  worker を起動・停止・変更しない。単発確認は `pnpm supervisor:status`。

## Codex hub / worker 境界

- **mobile control（主経路）**: Telegram relay/inbox。outbox と
  `logs/codex-supervisor-state.json` の通知、裁定回答の反映、追加指示の repo-visible 化を行う。
  実装・レビュー・長い調査は worker 側に寄せ、長期通知文脈を作業品質へ持ち込まない。
- **legacy hub（任意補助）**: Codex App heartbeat。PAUSED を既定とし、再 enable はユーザー指示時だけ。
  使う場合も outbox/state の読取報告に限定し、worker/task を自律起動しない。
- **worker（新規文脈）**: Windows Scheduled Task → `run-supervisor-iteration.ps1` →
  `worker-codex-stream.mjs` → `codex exec`。各 run は前回会話を継承せず、repo の正源・queue・git だけで
  再開する。CLI セッション自体のモバイル同期には依存しない。実行中は `worker-codex-stream.mjs` が
  15 秒ごとに Telegram の同一 progress メッセージを edit し、経過時間・直近イベント・発言プレビューを
  live 表示し、終了時は同じメッセージを完了本文へ更新する。outboxの重複完了通知は配信receiptで除外する。
  compaction は Codex CLI の既定経路を使い、`remote_compaction_v2` を無効化しない。CLI 0.147.0 では
  disable 時だけ ChatGPT の旧 `/responses/compact` 経路が 404 になり、v2 有効時は同条件で継続できることを
  2026-08-14 の隔離 probe で確認済み。早期終了で stdin が EPIPE になっても runner は state/outbox に
  失敗として記録し、プロセス自体の未処理例外にしない。
- **lane prompt 正源**: scheduled Codex worker は active lane だけを読む
  `lane-prompt-codex-*.md` / `lane-prompt-final-verification.md` を入口にする。`lane-prompts.md` は
  分割前の索引として残す。
- **永続状態**: 判断は `10_rules/`、作業状態は 02 / issue / queue / git、実行状態は
  supervisor lock / state / outbox に保存する。さらに actionable な run 間引継ぎは
  `logs/codex-supervisor-followups/pending/` に保存する。hub の会話履歴だけを正源にしない。
  `supervisor-report.mjs` は `kind:error` / ruling / 明示 `--followup` / 標準完了報告の
  `未解決:` 節を自動登録し、同文を fingerprint で dedupe する。wrapper は pending が 1 件でも
  あっても運用報告だけで無関係な探索へ範囲を広げない。受付済みTelegram依頼は1件ずつ通常監査・ISMCTSより優先選択し、要件と原本パスを注入する（[選択・記録](telegram-reception.md)）。
  worker は修正完了、または具体的な cluster / issue / needs-ruling への引継ぎ完了後だけ
  `supervisor-followup.mjs resolve` で閉じる。単なる Telegram 送達や再報告は解決ではない。
- **hub heartbeat 手順**: `pnpm supervisor:reconcile` を実行し、stale な `running` state を先に
  `stale` へ畳む → 未処理 outbox JSON と state を読む → 新規イベントだけを簡潔に報告 →
  処理済み JSON を `logs/codex-hub-outbox/sent/` へ移す。`kind:ruling` は question 全文を提示する。
  新規イベントがなければ実装 worker を追加起動しない。
  報告本文は worker の最終文と recentEvents を重複させず、読取情報を **カード・機構・テスト・残量**
  に変換して出す。recentEvents は証拠としてだけ使い、「直近イベント要約」という見出しで
  コマンド列挙を貼らない。branch / commit 済み / ff-only / lock heartbeat などの状態情報は
  重要な変化がある場合だけ最小限に添える。
  `kind:error` だけは、簡潔すぎて「何をしていたか」が失われないよう、短い read-only 追加調査を許す:
  stateの`runLog`が指す個別ログの末尾（旧stateだけは`logs/supervisor-run.log`）、関係 worktree の `git status --short --branch` / 最新 commit、
  `.verifier-result.json` の有無と内容を確認し、最新作業・dirty file・失敗 gate・未完了 handoff を
  報告へ補う。ここでもテスト実行・実装・merge・worker/task 起動・停止/再開/方針転換はしない。
  outbox が無く state 変化だけで通知する場合も、finalText が実装 commit / gate 待ちを示すなら
  関係 branch の `git log --stat main..HEAD` と `git diff --name-only main..HEAD` を read-only で確認し、
  対象カード・実装機構・追加/実行テスト・fidelity/needs-dsl 等の残量を優先して報告する。
- **Codex Telegram inbox 手順**: long-poll常駐が受信直後に独立したread-only受付workerを起動する。
  通常文章・画像・明示裁定を同じ入口で処理し、supervisor実行中でも解釈・返答・キュー登録を進める。
  受付専用lockで受信順に処理し、追加返信をsession文脈付きで次に渡す。
  supervisorはinbox本文を重複実行せず、受付が永続保存したdurable follow-upから実装する。
  `apply-rulings` は受付起動への互換コマンド。裁定の解釈・受付完了と実装完了を区別する。
  詳細・障害回復は [受付正源](telegram-reception.md)。
  `/cmd <text>` は通常instruction、`/retry <id>` は失敗した受付の再試行。
  `/start` `/status` `/new` `/cancel` `/force <指示>` `/domains` `/domains clear` `/purge*` はinbox controlとして処理する。
  `/new` は現在 session/pending を `purged/` へ退避して新しい文脈を開始する。`/cancel` は
  pending instruction/ruling を cancel 済みとして `failed/` へ移す（Codex supervisor の物理 kill は
  stale lock リスクがあるため inbox からは行わない）。`/domains` は Telegram メッセージ中の URL
  host を動的 WebFetch domain として保持し、summary に注入する。`/purge` は Claude 側と同じく
  セキュリティ管理用 command として扱い、`/purge telegram` は直近 Telegram メッセージ削除、
  `/purge session` は `session.jsonl` と inbox JSON の秘密情報マスク化、`/purge session delete` は
  `session.jsonl` 削除、`/purge all` は Telegram 削除 + ディスクマスクを行う（文脈リセットはしない）。
  Telegram へ出る `supervisor-report` / relay / direct notify は Claude 側と同等の secret pattern で
  送信前マスクする。それ以外の delete/reset all 系の広範・破壊的 instruction は worker prompt へ渡さず
  `failed/` に隔離し、狭い明示指示の再送を促す。
- **hub self-rotation**: ローテーションの時間判定は `lastRotationAt` を優先し、無ければ `hubStartedAt`
  を使う。`heartbeatCount` は履歴メトリクスで、閾値判定は `heartbeatCountSinceLastRotation` のみを
  使う。疎通確認（`MOBILE_HUB_READY`）、移設テスト、乱発調査、閾値調査の発言だけを
  「ユーザーが移設を明示した」とみなして再ローテーションしない。新 hub の初期 prompt も
  「移設」ではなく「疎通確認」と表現し、自己ループ条件を含めない。
  `logs/codex-hub-maintenance.json` に `rotationBlockedAt` がある場合は create_thread を再実行せず、
  `rotationPendingThreadId` と `rotationBlockedReason` を報告するだけにする。`automation_update` が
  `invalid arguments` 等で失敗した場合は、`rotationBlockedAt` / `rotationBlockedReason` /
  `rotationPendingThreadId` を記録し、旧 hub は archive しない。Codex App 側で heartbeat automation の
  `targetThreadId` 更新が成功する contract を確認できた後だけ、blocked 状態を解除してローテーションを再開する。
  `targetThreadId` が新 hub に更新済みなのに maintenance の `lastRotationAt` /
  `heartbeatCountSinceLastRotation` が旧値のまま残っている場合は、再ローテーションせず maintenance を
  先に補正する。補正時は `lastRotationAt` / `hubStartedAt` を現在時刻、`heartbeatCountSinceLastRotation`
  を 0、`currentTargetThreadId` を automation の `targetThreadId` にする。宛先更新と maintenance 更新は
  一体の成功条件で、片方だけ成功した状態を次 heartbeat のローテーション理由にしない。
