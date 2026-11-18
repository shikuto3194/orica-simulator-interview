# AGENTS.md

このファイルは Codex 系ツール向け入口です（Claude Code 系は `CLAUDE.md` を読みます）。

## まず読む

1. [`CLAUDE.md`](CLAUDE.md) — 実装運用ルールの正源（Cross-cutting Rule）
2. [`manual/ai-reference/README.md`](manual/ai-reference/README.md) — 目的別索引
3. [`manual/ai-reference/30_plan/02_detailed-todo.md`](manual/ai-reference/30_plan/02_detailed-todo.md) — 現役タスク

## 注意

- 実装運用ルールの正源は `CLAUDE.md`。本ファイルに重複転記しない。運用変更時は先に `CLAUDE.md` を直す。
- `02_detailed-todo.md` は現役タスク管理のみ。完了履歴・実装詳細・検証ログを追記しない（完了履歴は `30_plan/03_completed-milestones-*.md` または該当 issue の `history-YYYY-MM.md`）。
- `issues/00_index.md` は active issue の表のみ。詳細は各 issue ファイルへ。

## Codex harness

- 通常の実装は既存作業tree、ユーザー指定の隔離作業とscheduled Codex laneは専用worktreeで行う。`CLAUDE.md`「検証」に従い、primaryとmain統合treeを混同しない。
- 作業開始時は必要に応じて `pnpm codex:preflight` を実行し、正源ファイル・hook 共通部・worktree 状態を確認する。
- 完了前は `pnpm codex:finish-check` を実行する。検査範囲の選び方と全検証が必要な条件は `CLAUDE.md`「検証」に従う。
- 書き込みガードの共通ロジックは `scripts/harness/pre-tool-guard-core.cjs`。Claude/Codex の hook wrapper はこの共通部を呼ぶ。
