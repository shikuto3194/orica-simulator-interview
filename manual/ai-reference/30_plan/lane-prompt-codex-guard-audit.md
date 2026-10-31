# Codex Guard-audit Lane Prompt

停止条件 1〜4 達成済み、かつ `pnpm scan:ssot-candidates --gate` が未達のときだけ使う。
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

- `pnpm check`
- `pnpm test`
- `pnpm check:ssot`
- `pnpm check:wiring`
- `pnpm cards:test-coverage --gate`
- adversarial verifier + `pnpm verified-commit -- -m "<message>"`
- `scripts/auto-merge.ps1` は foreground 同期実行
