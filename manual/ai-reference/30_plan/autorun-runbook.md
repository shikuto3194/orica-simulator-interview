# Autorun Runbook（無人カード実装ループ）

`/autorun` および scheduled 無人エージェントが従う、カード effects 完全実装ループの正源。
運用ルールは `CLAUDE.md` の Cross-cutting Rule を上位とする。各 scheduled run は**新規文脈**で
始まるので、毎回このファイルと `02_detailed-todo.md` を読んでから再開する。
**フルラン（無人完全実装ラン）全体のフェーズ遷移・完了定義は `full-run-supervisor.md` が正源。**
このループはその「フェーズ B: card 変換」を担う（エンジン側は `engine-drain-runbook.md`）。
通知経路 / supervisor state / task enable 状態の整合は `full-run-supervisor.md` と
`pnpm supervisor:reconcile` が担当し、card worker は通知経路や task を直接操作しない。
sub-agent 起動時の具体プロンプトは `lane-prompts.md` の Cards Lane を正源にする。

## ゴールと停止条件（measurable）

「全カード完全実装 ＆ バグ無し」は無人では終端不能なので、次の*測れる*条件に置換する:

- **停止条件**: `pnpm cards:coverage` の `todo===0` かつ `needs-ruling.jsonl`（A方式では
  `autorun-queue/needs-ruling.*.jsonl` と `needs-dsl.*.jsonl`）の `open` 行が 0。
- これを満たしたら無人ループを止め、ユーザーに「全 convertible カード変換済み・裁定待ち空」を報告する。

進捗の正源は `card-coverage.json`（`pnpm cards:coverage` が生成、gitignore 済み）。
散文メモで残量を測らない。現状の残量はこのコマンドで確認する。

## 1 イテレーションの手順

1. **残量把握**: `pnpm cards:coverage` を実行。`todo` が残る弾のうち、`02_detailed-todo.md`
   の弾順（BSTH 系を先に、その後 他弾）と「直近の着手順」に従い 1 弾を選ぶ。
   - 弾内の todo cardNo 列挙: `pnpm cards:coverage -- --set <SET>`。
2. **サブバッチ**: その弾の todo を**先頭から 10 枚程度**取る（1 イテレーション = 1 サブバッチ）。
3. **変換**: 各カードの `textLines` を読み解き DSL の `effects` に変換する。
   - **スキップ・簡略化・近似は禁止**。DSL 表現力が不足したら先に DSL/インタプリタを拡張する
     （E 層タスク。`20_design/12_dsl-specification.md` 参照）。
   - 条件評価は `evaluateCondition()`、ゾーン/コア移動は共通プリミティブ層を経由（SSOT）。
4. **park は最終手段**: まず下記「確定可能性の判定」を行い、ルール正源（`10_rules/`）で挙動が
   確定するカードは実装する（機構が重くても）。**ルールからも確定不能なものだけ**「裁定パーク基準」に
   従い `needs-ruling.jsonl` に 1 行追記して飛ばす。training data からの推測実装はしない（作話防止）。
5. **テスト**: 変換した各カードに最小 1 テスト。**効果固有の意味差分を踏むこと**
   （「召喚できる」「型が通る」止まりはダメ。原文効果の成立側と非成立側のいずれかを assert する）。
   pending を解決し切った最終盤面で assert する。テスト本体に cardNo を直接引用する
   （`pnpm cards:test-coverage --gate` が機械検出する。詳細は `engine-drain-runbook.md` 手順 4
   と同じ要件）。
   `02_detailed-todo.md` の残量行は手編集せず、必要な `pnpm snapshot --measure --landing "<着地>"`
   を verifier 前に実行して検証対象 tree に含める。
6. **検証ゲート**（このサブバッチに対して）:
   - `npx tsc -b packages/card-data`（型）
   - `node_modules/.bin/vitest run`（テスト全件 — 緑必須）
   - `pnpm cards:test-coverage --gate`（このサブバッチで変換したカードに cardNo 参照
     test が無ければ fail。意味差分テスト忘れ防止の存在ゲート）
   - 弾を**1 つ完了**したら、その弾の GUI+REST 双方向検証は**スクリプト化 e2e**（set-review、
     `25_gui/12_bidirectional-e2e-pattern.md`）で行う。フルラン中は supervisor のフェーズ C が
     担当するため、worker はユニットテストまで緑にして先へ進んでよい。
6.5. **敵対的検証（必須）**: ゲート全緑直後、`adversarial-verifier-prompt.md` の手順に従う。
   `node scripts/spawn-verifier.mjs --base main --out .verifier-prompt.txt --context-out
   .verifier-context.json` で commit 済み + staged + unstaged + untracked を一時treeへ正規化する
   （実indexは変更しない）。main worker は prompt 全文を Codex `spawn_agent` の `message` に渡し、
   verifierを read-only で起動する。verifierの最終回答は JSON のみとし、`.verifier-report.json`
   へ保存後、`node scripts/verifier-evidence.mjs record --context .verifier-context.json --report
   .verifier-report.json --out .verifier-result.json` でmain workerがparse・証跡生成する。
   `node scripts/verifier-evidence.mjs check-worktree --base main --evidence .verifier-result.json` で、
   commit 前の worktree tree と証跡 tree が一致することも確認する。
   - 全 vouch → 手順 7 へ。
   - 1 件でも `refuted:true` → `expected` に従い修正 → 手順 6 ゲート再実行 → 再検証（最大 3 巡）。
     3 巡で残った refute は該当カードの effect を stub に戻し、needs-dsl/needs-ruling に park →
     primary root の `scripts/supervisor-report.mjs --kind ruling` に
     「verifier reject N 件で park」と積む → 次サブバッチへ。
   - **refute 残のまま commit/push は禁止**（型/test 緑でも silent な意味的不一致を main に
     押し込まない正源ゲート）。spawn失敗・timeout・JSON parse失敗・証跡生成失敗も同じく禁止。
   - 全vouch時だけ `.verifier-result.json` ができる。commit 前後の tree が証跡の `headTree` と
     一致することを `verified-commit` / `auto-merge.ps1` が強制検査するため、検証後に変更した
     場合はゲートから再実行する。
7. **コミット**: 緑なら `pnpm verified-commit -- -m "feat: <弾・枚数が分かる粒度>"` で
   サブバッチ単位の小 commit。`git commit` 直打ちは禁止。壊れた途中状態ではコミットしない。
8. **記録更新**:
   - `02_detailed-todo.md` の残量行は**手編集せず `pnpm snapshot --measure`** で生成し、
     **verifier 前にサブバッチ commit へ含める**（**02 更新だけの docs 単独コミットを作らない** — 簿記
     オーバーヘッド削減）。`Current Snapshot` のプローズは最大 12 行 / 2KB を維持。
   - 弾完了・節目は `30_plan/03_completed-milestones-phase-*.md` に追記。
   - 残留懸念は該当 issue の `## 残留懸念` か新規 issue へ。
9. **次イテレーションへ**。停止条件を満たしたら停止して報告。

## 確定可能性の判定（park の前に必ず行う）

詳細は [Autorun 確定可能性と裁定パーク](autorun-ruling-policy.md) を参照。

## stub 前の基盤確認（verify-before-stub・必須）

詳細は [Autorun 確定可能性と裁定パーク](autorun-ruling-policy.md) を参照。

## ルールであって効果ではない（effects 化禁止）

詳細は [Autorun 確定可能性と裁定パーク](autorun-ruling-policy.md) を参照。

## 裁定パーク基準（needs-ruling 行き — 真に確定不能なものだけ）

詳細は [Autorun 確定可能性と裁定パーク](autorun-ruling-policy.md) を参照。

## 無人実行の安全則

- **緑でないものはコミットしない・push しない。** pre-push が `pnpm check && test && docs:lint && check:ssot`
  を走らせる。失敗したらローカルで解消（`--no-verify` は使わない）。
- **3〜5 サブバッチごとに `pnpm docs:lint`**、節目前は `pnpm verify`。
- 1 イテレーションは小さく・再開可能に。長い分析を溜め込まず、各サブバッチで commit して痕跡を残す。
- 判断に迷い・裁定が要るものは**止まらず park して前進**する。人間の判断待ちでループ全体を止めない。
- **GUI レビューを通ったと偽らない。** GUI/REST 双方向検証はスクリプト化 e2e（set-review）に
  移行済みで、ローカル scheduled run でも Chromium headless で実行できる。e2e を実行しなかった
  場合は `02_detailed-todo.md` の Snapshot に「<SET> set-review pending」と記録して
  supervisor フェーズ C に残す。
- **誘発テストは pending を解決し切った最終盤面で assert する。** queue 直後の途中状態 assert は
  ルール適用との二重計上を見逃す（実例: 転醒 flip カウント+1 の rule/effect 二重計上、2026-06-10）。
- **baseline スキップ**: worktree HEAD が直前に検証済み緑の commit と同一なら、変更前の事前
  tsc/vitest は省略してよい（変更後の検証ゲートは常に必須）。

## 隔離実行（worktree・無人ループ必須）

**無人ループは専用 worktree でのみ走らせる。** scheduled run と対話セッションが同じ
working tree を編集すると衝突する（実例: 2026-06-09 に scheduled run と対話編集が
同一 `BSTH04.ts` を編集し、`git checkout` で互いの変更を踏んだ）。

- worktree: `C:\dev\orica-wt\autorun-cards`（branch `feat/autorun-cards`、`scripts/new-worktree.ps1 -Task autorun-cards` で作成済み・OneDrive 外）。**複数 worker を並行させる場合は下記「並行ループ（A方式）」と `autorun-assignments.json` に従う。**
- scheduled run / `/autorun` は**最初に worktree へ cd** してから作業・commit する。main の working tree は触らない。
- commit は `feat/autorun-cards` に積む。main への取り込みは `scripts/auto-merge.ps1`
  （全ゲート green 条件の ff-only。フルラン中は supervisor が実行）。人間の事前レビューは
  廃止し、完了後の一括 GUI レビュー（`final-gui-review-checklist.md`）に移行。
- worktree が古ければ run 冒頭で `git merge --ff-only main` して追従する。
- 片付け: `scripts/new-worktree.ps1 -Task autorun-cards -Remove`。

## 並行ループ（A方式: 弾シャード + DSL単一ライター）

複数 worker を衝突なく並行させる構成。割当の正源は repo root `autorun-assignments.json`。

- **シャード**: 1弾1ファイル（`cards/<SET>.ts`）なので弾で静的シャードする。worker は
  `autorun-assignments.json` の自分の `sets` の card ファイルとテストのみ編集 → card ファイルは
  worker 間で物理的に disjoint＝競合しない。
- **worktree 隔離**: worker = worktree 1本 = ブランチ1本（`scripts/new-worktree.ps1 -Task <id> -From main`）。
  build/dist/`card-coverage.json` が worktree 内に閉じ、型/テストのレースも消える。
- **唯一の共有面 = rules-core**: `model.ts`/interpreter/registrations/generated-index は全弾共有。
  **worker はここを絶対に編集しない。** 新DSL/新timingが要るカードは実装せず
  `autorun-queue/needs-dsl.<worker>.jsonl` に1行 append してスキップ（park）する。
- **DSL は単一ライター**: 拡張は main（対話/人間）だけが行う。main が `needs-dsl.*.jsonl` を
  ドレイン → rules-core を1プリミティブずつ拡張 → main に commit。worker は run 冒頭で main を
  rebase/`merge --ff-only` して昇格カードを取り込み、実装後に該当 needs-dsl 行を `resolved` に。
  → 書き手が常に1人なので rules-core のマージ競合・SSOT 破綻が構造的に起きない。
- **キューは per-worker ファイル**: root の単一 `needs-ruling.jsonl` は 3 worker append で merge 競合する。
  A方式では `autorun-queue/needs-{dsl,ruling}.<worker>.jsonl`（各 worker が自分のだけ書く）を使う。
  スキーマは `autorun-queue/README.md`。
- **統合**: 各 worker は `feat/<branch>` に積み、人間が main で取り込む。card 弾 disjoint＋rules-core
  単一ライター＋queue per-worker なので競合しない。
- **再シャード**: worker 数/割当変更は `autorun-assignments.json` を編集。`pnpm cards:coverage` の
  todo を todo 数で balance し直す（LPT 法）。

## 既知の DSL ギャップ（park ではなく拡張対象）

ループが遭遇したら型/インタプリタを拡張する（runbook「確定可能性の判定」参照）。回避で
フィールドを握りつぶさない（tsc を通すための削除は意味を失う）:

- ~~転醒のコア残置 `RebirthAction.retainCores`~~ → **解消済み**（`executeRebirth` が
  `action.retainCores` を読む。2026-06-10 確認）。
- 解封 / 創界石ネクサスのコア配置制限 / 神秘（トラッシュ条件付き効果抑止）はタスク B 系の未実装基盤。
- worker park 分の living queue は `autorun-queue/needs-dsl.*.jsonl`。エンジンバッチは
  ここから「unblock されるカード枚数」順にドレインする。

## 関連

- フルラン全体: `full-run-supervisor.md` / エンジン側: `engine-drain-runbook.md`
- 残量/停止条件: `pnpm cards:coverage` / 忠実度: `pnpm cards:fidelity`（`scripts/cards-fidelity-audit.mjs`）
- カード変換の運用詳細: `02_detailed-todo.md` 末尾「カード追加（Task A）の運用詳細」
- DSL: `20_design/12_dsl-specification.md` / `20_design/11_structured-effect-model.md`
- 裁定キュー: リポジトリ root `needs-ruling.jsonl` / 統合: `scripts/auto-merge.ps1`
