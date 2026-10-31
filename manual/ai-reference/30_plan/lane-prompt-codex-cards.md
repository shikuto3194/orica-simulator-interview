# Codex Cards Lane Prompt

coverage todo が再発したときだけ使う Codex cards lane の軽量 prompt。

## 必ず読む

- `CLAUDE.md`
- [`full-run-worker-brief.md`](./full-run-worker-brief.md)
- このファイル
- [`autorun-runbook.md`](./autorun-runbook.md) の 1 iteration / park / 隔離実行 section
- `28_policy/04_card-addition-decision-table.md`
- 実装カードに関係する `10_rules/` / `20_design/`

## 作業場所

- worktree: `C:\dev\orica-wt\autorun-cards`
- branch: `feat/autorun-cards`
- 編集範囲: `packages/card-data/src/cards/<SET>.ts`、対応 tests、autorun queue
- rules-core は触らない。DSL / interpreter 拡張が必要なら needs-dsl に park する。

## 進め方

- `pnpm cards:coverage --json` で todo を確認し、弾順・カード番号順で 10 枚程度。
- `todoCards` は表裏別のカード番号。`(B)` は対応するA面の `backFace` を実装する。A面に effects があるだけで完了扱いにしない。
- coverage の総数は面数。デッキ用 `ALL_CARDS` にB面を追加しない。
- stub 前に構造化効果モデル、該当 rule doc、既存 precedent を読む。
- 「実装が重い」は park 理由にしない。ルールで閉じないものだけ needs-ruling。
- queue / snapshot / format は verifier 前に済ませる。

## 必須 gate / commit

- `npx tsc -b packages/card-data`
- `pnpm test`
- `pnpm cards:test-coverage --gate`
- 必要なら `pnpm snapshot --measure --landing "<着地>"`
- `spawn-verifier.mjs` → Codex verifier sub-agent → `verifier-evidence.mjs record`
- `node scripts/verifier-evidence.mjs check-worktree --base main --evidence .verifier-result.json`
- `pnpm verified-commit -- -m "feat: <SET> effects <範囲>"`
- このcard-impl wrapperは親統合ticketを提供しない。[remote統合](../00_meta/remote-main-integration.md)に従い `pwsh scripts/auto-merge.ps1 -Branch feat/autorun-cards -Worktree C:\dev\orica-wt\autorun-cards` をforegroundで実行し、remote反映まで確認する。
