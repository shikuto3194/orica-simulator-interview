# Codex Engine Lane Prompt

scheduled Codex worker が engine-drain を実行するときの active lane prompt。旧
`lane-prompts.md` の Engine Lane を、Codex-only 実行向けに薄くした入口。

## 必ず読む

- `CLAUDE.md`
- [`full-run-worker-brief.md`](./full-run-worker-brief.md)
- このファイル
- 着手 issue と「P3-105後判定」節（存在する場合）
- 実装する機構に関係する `10_rules/` / `20_design/` / runbook section

`full-run-supervisor.md`、`lane-prompts.md` 全文、`adversarial-verifier-prompt.md` は run 冒頭では読まない。
verifier prompt は `spawn-verifier.mjs` が commit 直前に読む。

## 作業場所

- worktree: `C:\dev\orica-wt\engine-drain`
- branch: `feat/engine-drain`
- main追従と対象注入はwrapperが担当する。workerが一般clusterを自動claimしたり、supervisor / cluster lockを再取得したりしない。

## 対象選定

wrapper の `telegram-work-required` は選択された受付原本を全文読み、依頼された修正を最優先する。通常監査やISMCTSへ置き換えず、依頼IDと結果を報告する（[選択契約](telegram-reception.md)）。
`implementation-required` / `audit-review-required` では注入された監査対象を優先する。
その他は assigned cluster を優先する。`ownerLane: claude` は legacy 値なので Codex takeover
として処理する。active hold 中の off-limits cluster は触らない。

割当が無いときは [現在の範囲](full-run-worker-brief.md) に戻る。fresh監査残件を解消してからISMCTSへ進み、一般clusterの自動claim・独立EDH探索へ拡張しない。
割当候補内では親目標の最大阻害を先に解く。裁定待ちは根拠と再開条件を残す。

effect-debug cluster (`id` prefix `edh-` または `source:"effect-debug-harvest"`) は、注入 evidence の
ticket / replay / rerunCommand を先に読む。`effect-debug-loop-runbook.md` は rerun/doneDefinition が
必要な section だけ参照する。

coverageの構造違反、fidelityの本文制約違反も実装需要として扱う。reviewは未確定候補なので原文・Q&A・裁定を照合し、正しいDSL/carrierの誤検出なら汎用検知と正例/反例を改善する。カード番号除外や根拠のないbaseline更新で消さない。詳細は[検出契約](../00_meta/fidelity-detection.md)。
カード本文と既存機構を確認し、実効果＋盤面回帰テストを実装する。B 面は親カードの backFace を
修正する。DSL 不足はこのレーンで共通 primitive を拡張し、stub / textRef / 監査除外だけで
残量を減らさない。harvest 再試行の follow-up は証拠と再実行条件を引き継ぎ、実装を止めない。

## 実装ルール

- rules-core 単一ライターとして SSOT を守る。
- Effect 型への専用フィールド追加前に既存 action / condition / primitive で表現できるか確認する。
- 条件評価は `evaluateCondition()`、ゾーン移動・コア移動は共通プリミティブ層を経由する。
- 1 primitive が unblock する cluster 内カードは同一 iteration でまとめて stub 解消する。
- 各カードに最小 1 テスト。cardNo を直接引用し、効果固有の意味差分を最終盤面で assert する。
- 「この効果を…につき…回発揮」「追加で発揮」型は、本文句→意味→DSL/継続解決担当→反証テストを対応表に分解する。N=0/1/2 の実解決を必須とし、N=2 は一巡目の選択・残札処理後の更新済み状態から二巡目を解決する。〔ターンに1回：同名〕は効果全体の共有発揮制限であり、反復数を1にしない。
- queue resolved、snapshot、format など tree を変える処理は verifier 前に終える。

## 必須 gate

- wrapperのreviewバッチは未着手優先・最大20件。同種の確定分をまとめ、候補ごとの全件gateを繰り返さない。
- `pnpm codex:finish-check --plan` → `pnpm codex:finish-check`。確認記録だけなら専用review gate、コード混在は必要な全検証へ昇格する。
- finishと同じ `check` / `test` / SSOT / wiringを先に重複実行しない。修正中のVitest単体回帰は `pnpm test:unit <repo相対の.test.tsファイル...>` を使う。成功しても最終finishの代用にしない。
- 同一roundの反証は関連回帰でまとめて解消してから最終finishへ進む。format・Snapshotなどのtree変更も先に完了し、基点SHAとgate runを保存する。
- カード追加・変更は `pnpm cards:test-coverage --gate`。
- 必要なら `pnpm snapshot --measure --landing "<着地>"`
- adversarial verifier + `pnpm verified-commit -- -m "<message>"`

入力・失効範囲・run実績は [監査効率運用](../00_meta/full-run-efficiency.md)。通常のverifierと統合確認は省略しない。

## verifier / commit

1. gate 全緑。
2. `node scripts/spawn-verifier.mjs --base main --out .verifier-prompt.txt --context-out .verifier-context.json`
3. Codex verifier sub-agent を read-only / JSON only で起動。
4. `.verifier-report.json` を保存。
5. `node scripts/verifier-evidence.mjs record --context .verifier-context.json --report .verifier-report.json --out .verifier-result.json`
6. `node scripts/verifier-evidence.mjs check-worktree --base main --evidence .verifier-result.json`
7. `pnpm verified-commit -- -m "feat: <機構とカードが分かる粒度>"`

contextのheadTree・完全diffを査読対象として固定し、査読からcommitまで編集しない。
内容が変わったら必要なfinishと新treeの独立査読へ戻る。hook整形で変わったtreeも同じ扱い。

refute があれば修正 → gate → verifier を最大 3 round。残る場合は該当 effect を stub / queue に戻し、
`supervisor-report.mjs --kind ruling` へ park 理由を積む。refute 残、spawn失敗、JSON parse失敗、
証跡生成失敗では commit / push しない。

## 統合と報告

- supervisor親ticketを受けたこの経路は [親runnerへの統合依頼](full-run-supervisor.md)に従い `node scripts/supervisor-integration.mjs request` を実行し、treeを変更せず終了する。
- 親がauto-merge・競合/lease処理・remote確認を担当する。要求受理だけで完了と報告しない。
