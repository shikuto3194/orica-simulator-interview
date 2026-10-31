# Full-run Worker Brief

scheduled Codex worker が **run 冒頭に読む軽量入口**。全体設計・起動停止・hub 運用の正源は
[`full-run-supervisor.md`](./full-run-supervisor.md) のまま。この brief は、単一 run で必要な
判断だけを抜き出して context を薄く保つための runtime 版。

## 現在の範囲（2026-10-05開始・10-06継続学習承認）

coverage todo・audit violation・audit review、fidelity violation・semantic review が**すべて0**になるまで継続する。計測失敗・項目欠落は0ではない。
全0なら [ISMCTS実装・検証・運用](ismcts-full-run/README.md) のI0〜I7へ進む。旧AI除外はこのprogramに対して失効。独立guard-auditや無関係なEDH探索へ拡張しない。
残件の修正に必要な通常テスト・敵対的verifier・verified commit・main統合は完遂する。全0でも未検証・未統合なら終了しない。
実装・検証・配備完了後はI7に従い親側で同じtaskを120分間隔へ移し、監視・修正を継続する。監査0でdisableしない。固定先は`scripts/full-run-checkouts.json`。primaryの対話branchは保全する。
AI強化は可能なら24時間。学習・評価・モデル更新はLLM非依存とし、120分は当初のLLM成果確認周期。
I0の時間予算移行、I6a/b/c、I7の自律運用証跡は[継続学習](ismcts-full-run/continuous-learning.md)、
現行→旧正常モデル→簡易AIの復帰は[一人バトル](ismcts-full-run/solo-fallback.md)を必ず読む。

## 冒頭で読むもの

- `CLAUDE.md`
- `manual/ai-reference/README.md`
- このファイル
- 起動条件に該当した **1 つの active lane prompt**
  - ISMCTS: [program入口](ismcts-full-run/README.md) → 指定タスク → 対応する仕様・資源上限・証跡
  - engine: [`lane-prompt-codex-engine.md`](./lane-prompt-codex-engine.md)
  - cards: [`lane-prompt-codex-cards.md`](./lane-prompt-codex-cards.md)
  - guard-audit: [`lane-prompt-codex-guard-audit.md`](./lane-prompt-codex-guard-audit.md)
  - final verification: [`lane-prompt-final-verification.md`](./lane-prompt-final-verification.md)

## 冒頭では読まないもの

- `full-run-supervisor.md` 全文: task enable/disable、hub rotation、Telegram control、運用変更を
  触るときだけ読む。
- `lane-prompts.md` 全文: lane 分割の索引。通常は active lane prompt だけ読む。
- `adversarial-verifier-prompt.md`: commit 直前の verifier phase で
  `scripts/spawn-verifier.mjs` が読む。run 冒頭では読まない。
- `02_detailed-todo.md` 全文: 通常は `Current Snapshot` / `Active Board` と機械メトリクスだけで足りる。
  backlog 詳細は該当 issue/カード需要が出たときだけ読む。
- 完了履歴 / milestone 全文: 直近実装の根拠確認が必要なときだけ読む。

## wrapper が済ませること

- supervisorとcard-impl共有lockのacquire / refresh / release（カード実装レーンとは同時に書き込まない）
- 他laneの機械ロックから off-limits 注入（一般clusterの自動claimはしない）
- Telegram inbox poll / ruling apply / risky quarantine / summary 注入
- `kind:error` / ruling / `--followup` / 完了報告の「未解決」節を durable follow-up queue から注入
- worktree の main 追従 (`scripts/sync-worktree-to-main.mjs`)。実コード競合時は通常作業ではなく
  sync-recovery worker が起動される
- 最初に全 worktree の容量を実測。警告・上限超過なら harvest を省略し、容量整理 worker を起動する（[容量運用](./artifact-storage.md)）。
- fresh coverage / fidelity 監査。todo・violation・review候補を対象カード・パス・根拠付きで注入（[検出契約](../00_meta/fidelity-detection.md)）。計測失敗は監査修復workerへ渡す。
- 全項目0ならISMCTS controllerのplanを実行する。不在ならI0、不正/失敗ならI0修復。予算/負荷待ちは次runへ待機。監視当初は120分ごとにLLM確認し、自律運用証跡が揃った正常tickだけLLMを省略できるようI7で実装する。学習runnerは独立して継続。未統合変更と未確認救出stashを先に最終化する。
- Codex 起動設定: `gpt-6.1-sol` / `model_reasoning_effort=xhigh` /
  `model_verbosity=medium`。通常worker・同期復旧・再開後も同じ設定を使う。
  同梱Codex CLIを優先し、フルラン内の子runnerにはCLIと設定をプロセス環境で継承する。`spawn_agent` は親モデルと
  reasoning effortを継承し、別モデル・別effortを指定しない。全件検証は通常どおり維持する。
- Codex compaction: CLI の既定 `remote_compaction_v2` 経路を使う。v2 disable は旧
  `/responses/compact` 404 を再発させるため、wrapper / runner から disable flag を渡さない。

worker / sub-agent は supervisor lock、task、通知経路、`logs/codex-supervisor-state.json` を
手編集しない。

## 1 run の流れ

選択は[受入単位](../00_meta/full-run-efficiency.md)に従い、親目標・全条件・最大阻害・今回通す経路を冒頭に明示する。
難題から移る根拠は試行/反証/外部待ちとともに残す。成果は対戦経路・親受入・監査純減で判定し、部品commitやreceipt再採取を親完了にしない。
`worker-recovery` checkpointが渡された場合は元の未完成果を先に照合・最終化し、無関係な作業で置換しない。

1. 状態把握: `pnpm cards:coverage --json`、`pnpm cards:fidelity --json`、needs-dsl/ruling open 数、
   `git worktree list`、wrapper 注入 cluster / durable follow-up / inbox / crash stash を確認する。
   wrapperが選択したTelegram依頼は通常監査・ISMCTSより優先する。受付原本を全文読み、修正・回帰・gate・verifier・commit・親統合要求まで進める。依頼IDと結果を報告し、解消したものだけ `supervisor-followup.mjs resolve` で根拠付きで閉じる。未完了は保持する（[受付・選択契約](telegram-reception.md)）。
2. レーン判定:
   - `storage-cleanup-required` / `storage-repair-required` は容量整理・計測修復を最優先する。`storage:maintain` 後に `storage:check` が緑になるまで大量収集しない。保護データだけで超過する場合は保存方式を改善し、guard無効化や上限引上げで回避しない。
   - `telegram-work-required` は選択依頼をengine laneで対応する。通常監査・ISMCTSへ置き換えない。
   - `implementation-required` / `audit-review-required` は注入された監査対象を優先する。reviewは原文照合後に修正し、誤検出なら根拠付きの汎用検知改善と正例/反例を加える。
     本文に「この効果を…につき…回発揮」「追加で発揮」等があれば、本文句→意味→DSL/継続解決担当→反証テストの対応表を作る。N=0/1/2 は可否だけでなく最終盤面まで解決し、N=2では1巡目の選択・残札処理後の更新済み状態から2巡目が生成されることを確認する。〔ターンに1回：同名〕は効果全体の共有宣言制限であり、内部反復を1巡へ縮約しない。
   - coverage todo・audit violation または fidelity violation があれば、現在の engine-drain で engine lane。
     assigned cluster が無くても注入されたカードを実装する。coverage の B 面も親の backFace が対象。
     独立した cards task の再開待ちや stub 登録だけで終了しない。
   - `finalization-required` は既存修正の必須gate・verifier・commit・統合だけを完了する。新規探索は始めない。
   - `ismcts-implementation-required` は [tasks.md](ismcts-full-run/tasks.md) のnextTaskを実装する。I0のguard完成前に大量探索/学習を始めない。`ismcts-monitor` は [operations.md](ismcts-full-run/operations.md) に従う。
3. active lane prompt を読み、必要な issue / rule / runbook section だけ追加で読む。
4. 変更がある lane は必須gate → verifier → `pnpm verified-commit -- -m "<message>"` →
   `node scripts/supervisor-integration.mjs request` の順で進め、要求後は編集せず終了する。親runnerがauto-mergeを実行しremote mainを確認する。
5. `scripts/supervisor-report.mjs --kind progress` で hub outbox へ進捗・残量・未解決を積む。
   未解決を自由文で報告する場合は `--followup` を付ける。`kind:error` / ruling と、標準
   完了報告の `未解決:` 節は自動で durable follow-up 化され、解決まで次 run に再注入される。

## verifier / commit の硬い順序

tree を変える処理（queue resolved、snapshot、format、テスト修正）は **verifier 前**に終わらせる。
反証は同roundの全指摘を関連回帰でまとめて解消してから最終gateへ進む。Vitestの単体確認は `pnpm test:unit <repo相対の.test.tsファイル...>` を使い、単体成功を最終gateの完了証跡にしない。
基点SHA・gate runと査読contextのheadTree・完全diffを固定し、査読中は編集しない。
変更後は必要なgateと新treeの独立査読へ戻る（[検証運用](../00_meta/full-run-efficiency.md)）。

1. 実装、queue 更新、必要なら `pnpm snapshot --measure --landing "<着地>"`。
2. lane の必須 gate を全緑にする。
3. `node scripts/spawn-verifier.mjs --base main --out .verifier-prompt.txt --context-out .verifier-context.json`
4. Codex verifier sub-agent に `.verifier-prompt.txt` 全文を渡し、JSON only の最終回答を
   `.verifier-report.json` に保存する。量化反復を含む変更カードでは、本文句ごとの対応表と
   N=0/1/2 の完走反証（N=2の二巡目継続を含む）を `quantifiedEffectReview` に構造化して
   入れる。対象外でも理由付き `not_applicable` を必須とする。
5. `node scripts/verifier-evidence.mjs record --context .verifier-context.json --report .verifier-report.json --out .verifier-result.json`
6. `node scripts/verifier-evidence.mjs check-worktree --base main --evidence .verifier-result.json`
7. `pnpm verified-commit -- -m "<feat/fix/docs: ...>"`

`git commit` 直打ちは Codex hook で拒否される。検証後に tree が変わった場合は
`verified-commit` / `auto-merge.ps1` が止まるので、gate と verifier からやり直す。

## 運用移行条件

ISMCTSの受入条件・証跡検証・120分移行は [program](ismcts-full-run/README.md) が正源。

- fidelity/coverageのgate緑は静的な検出範囲の結果。意味の完全性は保証しない。`semanticReviews` / `auditIssues` のreviewも解消する。
- 未検証・未commit・未統合の修正が残れば継続する。通常の変更内容に応じた必須検証は維持する。
- 実装済み・配備済み・監視移行済み・強さの実証を区別する。欠けたreceipt、古い配備確認、partial対戦は成功ではない。

停止・再開・方針転換はユーザー専権。今回は準備完了後の開始と、実装・検証後の120分監視への移行を許可済み。workerはtaskを手編集しない。
