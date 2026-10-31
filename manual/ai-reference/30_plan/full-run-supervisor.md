# Full-run Supervisor（無人監査・実装ランの正源）

現在は coverage/fidelity の残件とISMCTS実装・検証・継続運用を担うフルランの正源。実装 worker は各 scheduled run で**新規 Codex 文脈**を
開始し、repo 側の Telegram relay/inbox がモバイル向けの進捗・裁定・追加指示を扱う。
2026-10-06承認の[継続学習](ismcts-full-run/continuous-learning.md)は可能なら24時間、LLM確認は当初120分。
学習・評価・モデル自動更新をLLM非依存にし、一人バトルは[旧版失敗時も簡易AIで継続](ismcts-full-run/solo-fallback.md)する。
Codex App heartbeat は旧 hub / 任意補助で、通常の通知主経路としては使わない。
run 冒頭の軽量入口は [`full-run-worker-brief.md`](./full-run-worker-brief.md)。このファイル全文は
起動停止・hub・フェーズ遷移を変更するときに読む。

監査入力の共有・確認記録の失効範囲・20件バッチ・実行実績は [監査効率運用](../00_meta/full-run-efficiency.md)。未着手候補を再確認より優先し、確認済み記録だけの更新で全件検証を繰り返さない。

統合状態・実プロセス・長時間検証の軽量確認は [自動統合の監視](../00_meta/supervisor-health.md) を参照。workerのrunningだけでは統合正常と判断しない。

## 作業先・統合先の固定（2026-10-02ユーザー訂正）

`scripts/full-run-checkouts.json`を正源とし、workerは既存の`C:\dev\orica-wt\engine-drain` / `refs/heads/feat/engine-drain`、統合は再利用した`C:\dev\orica-wt\fullrun-sync-33f-20261001` / `refs/heads/main`に固定する。旧修復branchのrefは保持する。primaryのcheckoutを同期先・統合先として推測しない。
起動・15分再開・同期復旧・親runnerはmain統合treeのscriptを使い、workerはlane内だけを編集する。登録済みworktree・共有Git・refの一致を、退避/同期前と統合lock取得後・push前後に確認する。mainが別treeに占有された場合や対象treeのbranch変更・dirty・Git操作中は停止せず次runで待機し、勝手なswitch/reset/stashや新tree作成で回避しない。生存worker・検証・leaseは保持する。
primaryの対話branchは保持し、作業branch削除の指示がある場合だけ、その作業者が公開済みmainからcleanな`codex/interactive`へ移す。main専用treeの占有を解除しない。

## 起動と停止（人間の操作はこの 2 つ＋裁定回答のみ）

詳細は [Full-run 起動停止・hub操作](full-run-control.md) を参照。
既定15分ごとに起動を試行し、実行中は`IgnoreNew`と共有lockでスキップする。
既存workerを15分で終了・再起動しない。実装・検証・配備後は同じtaskを120分へ移し監視・修正を続ける。手動停止・利用上限保護は維持する。

## Codex hub / worker 境界

詳細は [Full-run 起動停止・hub操作](full-run-control.md) を参照。

## 現在の範囲と移行条件（2026-10-05 ユーザー指示）

旧AI除外・監査0停止は失効。[ISMCTS program](ismcts-full-run/README.md)のI0〜I7を依存順で実装・検証し、配備と固定評価後に120分監視へ移行する。PC代替は承認済みで、[資源上限](ismcts-full-run/resources.md)を守る。

カード監査の残件は先に修復する。次はISMCTS実装の前提であり、taskをdisableする条件ではない。

1. fresh coverage の todo・audit violation・audit review がすべて0。
2. fresh fidelity の violation・semantic review がすべて0。
3. 対応修正の内容に応じた必須gate・敵対的verifier・verified commit・main統合が完了。laneの未確認auto-rescue stashも残っていないことをGitで直接照合する。照会失敗は停止不可。
4. laneがcleanでHEADがmainの祖先、専用統合treeがcleanなmainであり、両treeを再監査して1・2が0。

計測エラー・欠落配列/件数・不正JSONは0として扱わない。gateの緑だけでreviewを省略しない。
監査の検出範囲と原文照合の基準は[検出契約](../00_meta/fidelity-detection.md)に従う。

wrapperは監査0でcontrollerのplanへ進む。不在はI0 bootstrap、計測失敗は修復、予算/負荷待ちはtaskを有効のまま待機する。統合tree使用中も待機し、primaryの別branch作業を保全する。未確認救出stash・未統合変更は最終化する。

program外のEDH探索・独立guard-audit・無制限soakは起動しない。通常回帰・統合gateは維持する。
完了の機械判定は [証跡契約](ismcts-full-run/evidence.md)、親側の120分移行と継続対応は [運用契約](ismcts-full-run/operations.md)。実装済み・配備済み・監視移行済み・強さの実証を区別する。

## 各 run のイテレーション手順

0. **単一インスタンスロック（wrapper が Codex 起動前に実行）**:
   `run-supervisor-iteration.ps1` が run ごとの owner token を生成し、
   `node scripts/supervisor-lock.mjs acquire --token <token> --label "run-<日時>" --lane supervisor --ttl 240`
   を原子的に実行する（Claude lane と同じ run TTL）。
   - **exit 1（保持中）なら Codex を起動せず正常終了する**（outbox にも積まない — 15 分毎起動試行の
     正常な間引き。前 run が生きている証拠）。
   - wrapperは独立cards taskと共有の`card-impl` lane lockも取得する。保持中ならtaskを有効のまま次runへ待機し、同時書き込みを避ける。
   - runner (`worker-codex-stream.mjs`) がsupervisorとcard-implの両lockを **5 分ごとに同じ token で自動 refresh** する。
     Codex / sub-agent は supervisor lock を操作しない。
   - refresh が owner 不一致・I/O エラーになったら runner は Codex process tree を停止し、
     lock 喪失状態で実装を続けない（fail-closed）。
   - 通常 acquire は heartbeat 停止から 240 分未満の lock を既存 run とみなし、新規 run を起動しない。
     orphan lock の早期回収は `watchdog-stale-processes.mjs --include-locks` が 20 分 heartbeat stale
     （5 分 heartbeat の4回分）を `supervisor-lock.mjs reap` へ委譲して行う。
   - wrapper の `finally` は同じ token でのみ release する。他 run のロックは解放できない。
1. **状態把握**（順に実行・数値で判定）:
   `pnpm cards:coverage --json` / `pnpm cards:fidelity --json` /
   needs-dsl・needs-ruling open 数 / `git worktree list`
   - wrapper は `lib/supervisor-work-plan.ps1` で fresh coverage / fidelity を計測し、残件があれば
     harvest を実行せず engine worker に cardNo・パス・根拠を渡す。violationは修正、reviewのみなら原文確認へ、計測失敗は監査修復へ回す。
     両監査が解消した場合はISMCTSの次タスクへ進む。I0の資源/証跡基盤完成前に大量探索・学習を行わない。
   - `logs/codex-supervisor-state.json` は runner が自動更新する。worker はこの state を手編集しない。
2. **監査残件の実装**: engine-drainの単一workerで、fresh coverage/fidelityが示すカードと必要な共通DSLを対応する。
   violationは修正、reviewは原文・裁定・既存回帰と照合してから判断する。一般clusterを自動claimして
   無関係な探索へ進まない。他laneの機械ロックが保持中のscopeはoff-limitsとして尊重する。
   coverage todoがあっても独立cards taskの再開待ちにせず、同じworkerで対応する。
   計測失敗は修復し、再測定する。監査0でも未統合の差分が残れば、必須検証と統合を完了する。
3. **統合**: workerは `node scripts/supervisor-integration.mjs request` でcommit済みHEADを親runnerへ渡す。
   要求後はtreeを変更せず終了する。runnerがworker正常終了後に `scripts/auto-merge.ps1` を実行し、
   heartbeatを維持したままログ・終了コード・remote mainを回収する。要求受理だけでは統合完了にしない。
   mainへ取り込む（専用main統合treeへの
   ff-only マージは **merge レーンロックで自動直列化**されるので 2 レーン同時呼び出しで安全）。
   ゲート赤ならマージせず worktree 内で解消、解消不能なら issue 化して hub outbox へ報告。
   - **前提**: 各レーンの commit は `adversarial-verifier-prompt.md` に従う**敵対的検証ゲート**を
     必ず通す（engine-drain 手順 5.5 / autorun 手順 6.5）。全vouch時に生成される
     `.verifier-result.json` の `headTree` とbranchのcommit treeが一致し、`refuted === 0` でなければ
     `verified-commit.mjs` / `auto-merge.ps1` が拒否する。spawn失敗・timeout・JSON parse失敗・
     証跡生成失敗・検証後変更はすべてfail-closed。fidelity・vitest・check:ssotが緑でも
     検証を省略したcommitは取込み禁止。
4. **記録**: 02 の Current Snapshot を残量数値で更新（12 行 / 2KB 維持）。
5. **報告**: `node C:\dev\orica-simulator\scripts\supervisor-report.mjs --kind progress "<要約>"` で hub outbox へ
   フェーズ / 処理内容 / 残量（todo・stub・needs-dsl・ruling）を 1 件積む。runner は worker の
   最終回答も completed/error として自動で積むため、同文の重複報告はしない。
   unresolved な自由文 progress は `--followup` を付ける。error / ruling と `未解決:` 付き
   completed は flag 無しでも durable follow-up へ自動登録される。

現在の監査範囲では一般clusterのaudit/backfillを起動理由にしない。既存registryの未完了状態は保持する。
受付済みTelegram依頼はwrapperが1件ずつ選び、通常監査・ISMCTSより優先する。容量・監査計測の修復は前提として維持し、稼働中runは中断しない。選択・記録は[受付契約](telegram-reception.md)。運用報告だけで無関係な探索へ範囲を拡大しない。

## 裁定（needs-ruling）の扱い

- **park する前に必ず公式 Q&A ミラーを引く**（裁定は Q&A 最上位＝信頼度 A、ユーザーに訊くより先）。`rg --no-ignore <語> C:\dev\orica-simulator\external-qa C:\dev\orica-simulator\external-qa-official`（gitignore・worktree 不在なので repo root 絶対パス＋`--no-ignore` 必須）。出なければ `node scripts/harvest-official-faq.mjs --freeword "<語>"`（汎用ルール Q&A はこれでしか拾えない）を回して再 grep。Q&A で閉じるなら park せず qa-id 引用で自己解決＋`10_rules/` 反映。手順は `00_meta/ai-operation-rules.md` 原則#1。
- park 発生時は **question 全文を即 primary root の `scripts/supervisor-report.mjs --kind ruling --stdin` で積む**。
  回答待ちでループは止めない（別クラスタへ）。
- 弾全体ブロッカー級（例: 過去の星霊衣）はタイトルに【弾ブロック】を付けて送る。
- 回答が来たら: 同ターンで `10_rules/` へ裁定を反映 → 実装 → 行を resolved に
  （CLAUDE.md リサーチ・ソース運用）。

remote mainの取得・独立候補rebase・競合停止・再検証・公開SHAの証跡は
[remote統合](../00_meta/remote-main-integration.md)に従う。

## 安全則

- **停止・再開・方針転換はユーザー専権**: フルランの一時停止/再開/ドレイン順や方針の変更を
  ユーザーの明示指示なしに自律判断しない。02 Snapshot 等の正源に「一時停止中」等の運用状態を
  勝手に書き込まない。task / 通知経路の enable/disable も指示を待つ。停止は「フルラン停止」、再開は
  「フルラン開始」を基本とする。今回は準備後の開始とISMCTS実装・検証後の120分監視移行を明示許可済み。変更は専用コミットで可視化し、無関係コミットに混ぜない
  （2026-06-13 に F1 refactor コミット `441ea82` へ「一時停止」判断が無記録で混入した事例）。
- **多重 run 禁止**: 手順 0 のロックなしに作業を始めない（2026-06-11 に毎時 cron の
  オーバーラップで三重 run が発生）。手順 0 のグローバルロックは**オーケストレータ run**の
  重複を防ぐ。各レーン（engine / 検証 / cards）は 1 つのオーケストレータ run 内の sub-agent なので
  追加ロック不要（別プロセスとして走らせる場合のみ `supervisor-lock.mjs --lane <name>` を使う）。
  ロックファイルは全 worktree の外（`C:\dev\orica-wt\orica-supervisor*.lock.json`）—
  リポジトリ内に置くと auto-merge の dirty 検査を汚す。
- **クラッシュ回収**: Codex / runner の通常異常終了は wrapper の `finally` が owner token 付きで
  即時 release する。PowerShell process / OS ごと落ちた場合だけロックが残り、heartbeat 停止から
  通常 acquire は 240 分まで新規 run を抑止する。早期回収は watchdog が 20 分 heartbeat stale を
  `supervisor-lock.mjs reap` で畳む。他 owner の refresh / release は拒否される。
  終了workerのdirtyは[確定treeの保全・復旧](../00_meta/full-run-efficiency.md)で帰属を照合し、
  同一checkpointだけ元の受入単位を再開する。不明なdirtyは同期・破棄せず保全する。
- **並行マージの直列化**: primary tree への ff-only マージは `auto-merge.ps1` が owner token 付き
  `--lane merge`（短命 TTL 20 分）で自動直列化する。merge 前 / push 前に owner を再検証し、
  2 レーンが同時に呼んでも後発はロック取得後に ff-only 祖先と clean/main を再検査して取り込む。
- 緑でないものは commit / merge / push しない。`--no-verify` 禁止。
- 無人 run はlane worktreeでのみ作業。main統合treeはauto-mergeが使用し、primaryの対話branchは保持する。
  auto-merge.ps1 が clean/main 検査で衝突を防ぐ。effect-debug loop も lane worktree 側の
  `scripts/effect-debug-loop.mjs` を起動し、main repo は hub state / artifacts / outbox の
  共有 root としてだけ使う。tracked な cluster registry は lane worktree 側で更新し、verified
  commit に含める。
- **rules-core を書くのは engine レーンのみ（単一ライター厳守）。** cards レーンは card-data と
  test だけ、検証レーンはテスト spec（e2e/scenario/unit）だけを編集し、両レーンとも rules-core に
  一切触れない（並列でも SSOT 破綻が起きない前提）。検証レーンが見つけた rules-core 起因バグは
  自分で直さず needs-dsl/issue に積んで engine レーンに渡す。
- Windows 再起動後は scheduled task と Telegram relay/inbox が自動復帰する。旧 Codex App heartbeat は
  app automation として同じ ACTIVE/PAUSED 状態を維持するが、通常通知の必須条件ではない
  （[[project_unattended_reboot_recovery]]）。
  Update のアクティブ時間外 (1:00〜14:00) の再起動があり得る前提で、イテレーションは
  小さく・再開可能に保つ。
- スコープ外（Phase 7 周辺機能: BGM/SE、デッキ SVG/PNG エクスポート、E-5 UI、複数ブロッカー
  GUI 等）はフルランに含めない。カード実装に必要になった場合のみ drain 対象に昇格。

## 関連

- 残量計測: `pnpm cards:coverage --json` / `pnpm cards:fidelity --json`（gateの緑に加えreview全件0が必要）
- ループ: `engine-drain-runbook.md` / `autorun-runbook.md`
- worker 軽量入口: `full-run-worker-brief.md`
- レーンプロンプト: `lane-prompt-codex-engine.md` / `lane-prompt-codex-cards.md` /
  `lane-prompt-codex-guard-audit.md` / `lane-prompt-final-verification.md`（全体索引: `lane-prompts.md`）
- 検証: `pnpm fuzz` / `25_gui/12_bidirectional-e2e-pattern.md` / P3-91
- worker 起動: `scripts/run-supervisor-iteration.ps1` / JSONL state: `scripts/worker-codex-stream.mjs`
- Codex-only 自動復帰: `scripts/configure-codex-autostart.ps1`
- Telegram: 送信 relay `scripts/run-telegram-relay.ps1` / 受信 inbox
  `scripts/run-telegram-inbox.ps1` / inbox 本体 `scripts/telegram-inbox.mjs`
- hub outbox: `scripts/supervisor-report.mjs` / 統合: `scripts/auto-merge.ps1`
- 完了後の人間レビュー: `final-gui-review-checklist.md`
