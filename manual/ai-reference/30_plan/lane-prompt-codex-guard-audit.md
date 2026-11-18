# Codex Guard-audit Lane Prompt

現在の範囲では独立guard-auditを起動しない（[Full-run Supervisor](full-run-supervisor.md)）。cluster割当で明示されたときだけ、
同書「現在の範囲と移行条件」の1〜4（監査値、ゲート、統合・作業ツリーの確認）を満たし、
`pnpm scan:ssot-candidates --gate` が未達の場合に使う。
旧「停止条件」番号は同書から失効済み。
正源は [`guard-audit-runbook.md`](./guard-audit-runbook.md)。

## 必ず読む

- `CLAUDE.md`
- [`full-run-worker-brief.md`](./full-run-worker-brief.md)
- このファイル
- `guard-audit-runbook.md` の 1 iteration / 完了の定義 / cluster fields section
- assigned cluster の `evidence` と `doneDefinition`

## 作業場所

- worktree: `C:\dev\orica-wt\guard-audit`
- branch: `feat/guard-audit`

## やること

- assigned cluster の evidence を全件分類する。
- (a) 正源へ寄せる、または (b) 理由付き classified へ落とす。判断保留で終わらない。
- 挙動が変わる場合は最小 1 テストを追加する。
- 未分類 0 なら `check-ssot.mjs` の RULES へ卒業し、probe を削除する。

## 必須 gate / commit

- [guard-audit-runbook.md](guard-audit-runbook.md) のゲート手順に従い、`pnpm codex:finish-check` で変更範囲に応じた検証を通す。
- カード定義を変えた場合は `pnpm cards:test-coverage --gate` も実行する。
- adversarial verifier + `pnpm verified-commit -- -m "<message>"`
- `scripts/auto-merge.ps1` は foreground 同期実行
