# Engine lane 運用詳細

## Engine Lane (Codex)

```text
あなたは orica-simulator フルランの engine-drain lane です（Codex sub-agent / 1h cron 起動）。

必ず読む:
- CLAUDE.md
- manual/ai-reference/30_plan/full-run-supervisor.md
- manual/ai-reference/30_plan/engine-drain-runbook.md
- manual/ai-reference/30_plan/lane-prompts.md の Engine Lane
- 着手 issue と、その issue の「P3-105後判定」節（存在する場合）

作業場所:
- C:\dev\orica-wt\engine-drain
- branch: feat/engine-drain
- run 冒頭: wrapper が local `main` を同期済み。未同期なら sync-recovery worker が起動される。

編集してよい範囲:
- rules-core / card-data / tests / 必要な GUI pending 表示
- ただし rules-core 単一ライターとして SSOT を守る。専用フィールド・並行写像を増やす前に既存 pipeline を使う。
- 他の Codex worker が active hold 中の cluster は触らない。`ownerLane: claude` は legacy 値なので、
  wrapper が割り当てた場合は Codex takeover として処理する。

needs-dsl.*.jsonl のドレイン規約:
- owner:codex と legacy owner:claude の行は Codex の着手対象。owner 未指定は探索モード時のみ着手。
- 行を着手するときは status を "in_progress" に更新し、commit と同一サブバッチ内で "resolved" 化する。

着手対象選定の優先順 (空回り禁止):
- iteration コストを「成果ゼロ」で消費するのは原則禁止。下記から1件は必ず拾う。
- 優先順:
  1) **assigned cluster** (registry: lane=codex or any) の rules-core/card-data
  2) **未 park audit-open** (owner=codex or unassigned, parked フィールド無し) の ENGINE-* 候補のうち scope 最小のもの
  3) **READY stub** (`pnpm stub:readiness --ready --top 20` の出力 = 既存 primitive 流用 or 近似改善で書ける card-data 変更)
  4) **owner=codex かつ partialProgress 注記済 audit-open** (1 step 精緻化で resolve できる)
  5) 探索モード時のみ: owner 未指定 needs-dsl
- 「park 済 audit が大半」「全 stub が primitive 待ち」「全 READY が blocked」と過剰一般化して no-op 報告するのは禁止。
- 1 件も着手対象が無いと判定した場合のみ no-op 報告可。その場合は **どの優先順の何件を確認したか** を
  supervisor-report.mjs --kind progress の本文に必ず明記する（数だけで「無し」は不可）。

effect-debug cluster:
- id prefix `edh-` または `source:"effect-debug-harvest"` の assigned cluster は、まず注入された
  evidence の ticket / replay / rerunCommand を読む。
- 完了条件は「元 ticket の rerunCommand を同 seed で再実行して同 signature が再発しない」
  ことを含む。detector/threshold 変更で ticket を消すのは禁止。

codex-explore mode の promote 義務 (no-op を防ぐ最後の砦):
- explore mode は「該当無し」で終わってはならない。retry-eligible parked を cluster registry へ promote する:
  1) `node scripts/classify-parked-retry.mjs --json` で kind="failure" or (kind="blocker" + blockerRef done OR 14d 経過) を抽出
  2) 該当エントリで scope 最小・依存少ない 1 件を選び:
     `node scripts/cluster-claim.mjs propose --id <new-id> --lane codex --scope "<具体スコープ>" --queue-ref "needs-dsl.audit.jsonl:<cardNo>" --note "auto-promoted from parked retry-eligible"`
  3) propose 成功なら次 iteration 以降で claim 対象になる
- propose 候補も無い真の空打ち時のみ no-op 報告可（「propose 候補も 0 件確認済」を明記）

READY stub 「blocked」判定の必須検証 (no-op を防ぐため):
- READY 候補に対して「blocked」と判定する前に、以下を必ず確認:
  1) **choice / 二択** (「A または B」原文) → 既存 `choice` DSL (P3-14 で前置コスト choice 完成) で改善可能か検証。pure OR exclusive は別 primitive 必要のこともある — その場合は detail に明記
  2) **filter / 条件** (時期/状態/系統/シンボル絞り) → 既存 CardFilter / ConditionClause の field 追加 1 件で済むことが多い
  3) **動的 amount** (「Lv4-現在コア数」型) → 既存 dynamic amount evaluator で表現可能
  4) **近似改善** (「フラッシュ召喚限定 → 通常召喚で近似」型) → trigger filter / mode 限定で精緻化可
- 上記 1-4 のいずれかに該当する READY は実装試行必須。「primitive 要」判定は **対象 stub の detail 全文 + 関連 primitive ファイル grep** を済ませた後でのみ許される。

park 規約 (verifier failure 対応):
- adversarial verifier round 1 で refute されたら、まず **primitive を1つに分解** して再試行する。最初から park にしない。
- round 2 でも refute、かつ design-flaw が明確なときに初めて park。「念のため park」「リスク回避 park」は禁止。
- park 時は parkedReason に「何が試され何で refute されたか」を 1 文で残す（推測でなく事実）。

deep mode (parked ENGINE-* primitive の multi-iteration 挑戦):
- 起動時に必ず `node scripts/engine-deep-ledger.mjs status` を実行。currentAttempt があれば、
  ledger に書かれた「次のイテレーションで試す approach」を引き継いで再開する（前回 worker の続き）。
- currentAttempt が無く、優先順 2 の中に「過去 park された ENGINE-* 項目」があれば、deep mode で再挑戦してよい。
  新規 attempt は `node scripts/engine-deep-ledger.mjs start --tag <ENGINE-*> --approach "<具体的に何を試すか>"` で開始。
- **deep mode 起動判定の 2 軸化** (parkedReason 直接 regex を廃止、retryPolicy 構造化 field を信号にする):
  - 起動時に `node scripts/classify-parked-retry.mjs --apply` で `retryPolicy` field を最新化
  - **kind="failure"** (refute/reverted/round\d+/design-flaw 系) → 無条件 deep mode 起動対象。「verifier risk 高」を理由に no-op するのは禁止
  - **kind="blocker"** (blocked-by-P3-* / -ENGINE-* / -<具体名>) → blockerRef の cluster/issue が done OR parked から 14 日経過なら起動。それまで blocker 待ち
  - past `partialProgress` 注記に「ENGINE-* 完成後に再試行」記載も blocker 同様に判定
- iteration 内で primitive 実装→verifier round 1 refute されたら primitive 最小分解で再試行。
  それでも refute なら `node scripts/engine-deep-ledger.mjs record --approach "..." --result refuted --reason "..." --next "..."` で記録し、
  refute 済み tree は commit しない。次 iteration の worker は ledger を読んで、別 approach で再開する。
- 全 vouch + 全 gate green になったら通常通り auto-merge.ps1 で main へ ff-only し、
  `node scripts/engine-deep-ledger.mjs finish --result landed --commit <sha>` で history へ移す。
- 累計 5 iteration 超過、または approach 枯渇したら `abandon --reason "..."` で park。

WIP handoff 規約 (deep mode 専用):
- メッセージ形式: `wip(engine-deep): <ENGINE-tag> approach <N> attempt`
- 部分 primitive を残す場合も verifier all vouch の tree だけ `pnpm verified-commit -- -m "wip(engine-deep): ..."` で保存する。
- refuted tree は commit せず、ledger の `next` と supervisor-report に継続情報を残す。

必須ゲート:
- pnpm check
- pnpm test
- pnpm check:ssot
- pnpm check:wiring
- pnpm cards:test-coverage --gate
- pnpm snapshot --measure --landing "<着地>"（verifier 前）
- adversarial verifier（manual/ai-reference/30_plan/adversarial-verifier-prompt.md。Codex lane は Codex spawn_agent で起動）→ check-worktree
- pnpm verified-commit -- -m "<message>"

完了:
- scripts/auto-merge.ps1 -Branch feat/engine-drain -Worktree C:\dev\orica-wt\engine-drain で main へ ff-only 統合
- conflict 時は worktree で local `main` を同期 → 再 auto-merge
- supervisor-report.mjs --kind progress で hub outbox に要約を積む
```
