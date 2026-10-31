# CLAUDE.md

## プロジェクト前提

公式エターナル版ルール (Ver.17.0) ベースの独自拡張シミュレーター。**スタンダード版ルールは参照・考慮しない。**

## セッション開始時

`manual/ai-reference/30_plan/02_detailed-todo.md` で次タスクを確認し、詳細は `manual/ai-reference/README.md` の目的別索引から辿る。

## Cross-cutting Rule（実装運用ルールの正源）

本節優先。検証はファイル数ではなく変更内容・影響範囲で選ぶ。

### ルール正源とツール入口

- `AGENTS.md` は Codex 入口。詳細は本書参照。
- `pnpm codex:preflight` / `pnpm codex:finish-check`。検証正源: [harness-validation.md](manual/ai-reference/00_meta/harness-validation.md)。
- AI の playground dev 起動は `00_meta/local-tooling.md` の正準コマンド限定（hook 強制）。
- AI 推論プロトコル (作話防止4原則) は [`ai-operation-rules.md`](manual/ai-reference/00_meta/ai-operation-rules.md)。ルールの問いはコードtraceより先に `10_rules/` を参照。

- `/artifacts/` は生成物専用で全体 ignore。fixture は外、clean は Git。
- `pnpm storage:check` の警告時は整理を優先。保護対象削除・上限引上げ禁止。正源: [artifact-storage.md](manual/ai-reference/30_plan/artifact-storage.md)。

### タスク選択

- 親目標の最大阻害を優先。逸脱・試行・外部待ち・次実験を[受入単位](manual/ai-reference/00_meta/full-run-efficiency.md)に記録。

### 実装の汎用性・拡張性

- **Effect 型への専用フィールド追加は原則禁止。** `steps` 内の既存/汎用アクション型で表現する。
- **条件評価は `evaluateCondition()` を使う。** 特定 ConditionClause の専用検査ロジックを書かない。
- **発揮資格を失った未宣言キューは共通判定で除去する。** 宣言済み効果の不発・空撃ち・順序待ちとは区別する。正源: [03b 発揮不能キュー](manual/ai-reference/10_rules/03b_resolution-and-interrupts.md)。
- **ゾーン移動・コア移動は共通プリミティブ層を経由する。** 直接状態操作しない。
- **専用ハンドラ・並行写像を作る前に既存の汎用パイプライン / 正源関数で表現できないか検討する (SSOT)。** 同じ列挙 (ゾーン / コンテナ / 効果種別) の判別・写像を 2 箇所に持たない (例 `coreContainerDisplayKey()`、`pre-tool-guard.js` ＋ `pnpm check:ssot` が機械検知)。
- **新規 `LegalActionKind` は GUI 到達可否 (`ACTION_UI_ROUTES`) も確認する。** SSOTのGUI検査・型の網羅性だけでは操作到達性を証明できない。
- **同一画面・同一効果元で同文言の行動ボタンを複数生成しない。** 共通部品で入口を1つにまとめ、効果本文による選択へ進める。候補の削除は禁止。正源: [行動ボタンの一意性](manual/ai-reference/25_gui/21_action-button-uniqueness.md)。

### リサーチ・ソース運用

- リサーチ結果は `source-map` / `open-questions` / 関連ルール章へ痕跡を残す。新規調査には信頼度ラベルを振り、`A/B/C` のどれで実装に使うか明記する。
- 独自カードサイトだけがソースのギミックで定義が閉じないときは、ユーザーに確認し、回答を同ターンで反映する。
- 独自カードサイトの source precedence: `Q&A / 裁定 > カード本文 > errata > ユーザー確認`。

### 検証

影響範囲で検査を選ぶ:

- 小変更は変更ファイルのformat/lintと関連検査。単体Vitestは `pnpm test:unit`（完了証跡外）。表示はPlaywright、運用scriptは回帰、文書はdocs/導線。無関係な全件・build・GUI+RESTは不要。
- 監査確認記録・残量・Snapshotだけの変更は、確認対象の回帰をまとめる専用gateでfinish/push/mergeを行う。コード混在は通常範囲へ昇格し、verifierは維持する。詳細は [監査効率運用](manual/ai-reference/00_meta/full-run-efficiency.md)。
- 複数機能: 関連する型・テスト・文書・GUI。影響を限定できなければ全検証。
- ゲーム状態・API連携の変更はGUI/API経路を確認。[scenarioとroomの検証範囲](manual/ai-reference/25_gui/12_bidirectional-e2e-pattern.md)を区別し、server→GUIはローカルsession、認証・DB・公開通信は実roomで確認する。
- 状態モデル・公開API/型・ビルド設定・ルール骨格: 型 + 全件テスト + 影響箇所の手動・GUI確認。
- rules-core型: `pnpm check`（下流込み）。局所は `pnpm exec tsc -p packages/rules-core/tsconfig.json --noEmit`。
- カード/効果の追加時は最小 1 テストケース。効果実行後の盤面変化を検証する。
- 通常は既存作業treeを使い、他作業を保持する。ユーザー指定の一時worktreeは実装・commitにも使える。検証コピーは確認不要。[tree照合](manual/ai-reference/00_meta/harness-validation.md)。
- 反証は関連回帰で修正し、最終treeをgate・独立査読。変更後は再実行。fuzzも共通leaseを取得。

### コミット

- 中規模以上の節目ではコミットする。壊れた途中状態では無理にコミットしない。
- プレフィックス: `feat:` / `fix:` / `BREAKING:` / `docs:` / `refactor:` / `chore:` / `style:`。日本語で簡潔に、影響範囲が分かる粒度で書く。
- **pre-commit フック (husky + lint-staged) が staged に prettier + eslint --fix を自動適用する。** 失敗時は中止。原因を解消して再コミット。
- pre-pushは `pnpm verify:push`。失敗時中止。 [証跡再利用](manual/ai-reference/00_meta/harness-validation.md)と[remote統合](manual/ai-reference/00_meta/remote-main-integration.md)に従う。CIは独立に全検証・build・GUI+REST。
- `--no-verify` は緊急時のみ。次回コミットで原因解消必須。
- primary作業後は両mainの未送信commitを保全し、clean mainへ戻す。detached HEADで完了せず、分岐はresetせず統合・検証する（[復旧](manual/ai-reference/00_meta/primary-main-recovery.md)）。専用main tree占有時は対話branchを保持し、削除指示時だけcleanな`codex/interactive`へ着地する（[固定先](manual/ai-reference/30_plan/full-run-supervisor.md)）。

### タスク完了時

- 変更・検証・ToDo更新・未解決を報告する。
- **`02_detailed-todo.md` は現役タスク管理のみ。** 完了履歴・実装詳細・検証ログ・変更ファイル列挙・テスト件数を追記しない。
- 完了内容の格納先:
  - カード追加・機能節目: `30_plan/03_completed-milestones-phase-*.md`
  - issue 継続進捗: `issues/<ID>/history-YYYY-MM.md`（無ければ新規）
  - issue クローズ: `issues/archive/<ID>/index.md` へ移動 + `archive/completed-issues.md` 年別表
  - 運用ルール・docs整備: 関連 README / `00_meta/`（完了履歴には載せない）
- `02` の `Current Snapshot` は最大 12 行 / 2KB、`Active Board` は最大 20 行。削除基準は FIFO ではなく「現在の意思決定に必要か」。
- 完了報告は次のテンプレで行う:

  ```md
  変更ファイル:

  - <path>

  検証:

  - <command or 手動シナリオ>

  ドキュメント:

  - 02: Active Board 更新 / なし
  - milestone/history: <path> / なし
  - issues: <path> / なし

  未解決:

  - <or なし>
  ```

### 課題管理 (issues/)

- `issues/` は技術的負債・改善バックログ。P1-P6 カテゴリは ToDo の Phase 1-8 とは別体系。
- `issues/00_index.md` は active issue 表のみ。実装詳細・検証ログ・長い「最終更新」段落を書かない（詳細は各 issue ファイルへ）。
- 個別 issue 親が分類別上限を超えたらサブディレクトリ化し、親 `index.md` は概要・現状・残タスクだけに保つ。詳細は `<id>/<sub-topic>.md`、履歴は `<id>/history-YYYY-MM.md`。
- タスク完了時に残留懸念がある場合:
  - 該当 issue に `## 残留懸念` セクションを追記する（最大 5 件）。
  - 独立した作業を要する場合は新規 issue を作成し `issues/00_index.md` に追加する。
- issue の状態が変わったらファイルのメタデータ (`状態:`) と `00_index.md` の両方を更新する。
- **全 active issue は `cluster:` 宣言を持つ**（`<cluster-id>` / `none — <理由>`）。
  **issue を書いただけでは worker は拾わない。** 漏れは `docs:lint` が fail、
  登録は `issue-cluster-sync.mjs`（wrapper が claim 直前に実行）。
- 完了 issue は `issues/archive/<ID>/index.md` へ移し、`issues/archive/completed-issues.md` 年別表へ追記する。`00_index.md` の「最近完了」は直近 5 件まで。**redirect stub は作らない。** 旧パス参照は同ターンで archive 先へ書き換える。
- **脱線（DSL 拡張・ギミック・基盤バグ等）はまずその場で消化を試みる。** Task 中断してでも完遂できる規模なら ToDo を一時止めて取り組み、issue 化はセッション内で完遂不能かつ独立完了単位として切り出した方が綺麗な場合の最終手段。
- active issue は 4 週間以上更新がないと `pnpm docs:lint` が warn する。「需要待ち」状態を放置せず、依存タスクや発火条件を明示するか archive 化する。
- セッション開始時に issues/ を読む必要はない。タスク中に関連 issue があれば参照する。

### ドキュメント管理

- 3〜5 タスク完了ごと、または弾追加完了時に `pnpm docs:lint`（entry / issue / reference / history を fail、archive のみ warn、90% で near-limit warn）と関連 README の導線確認を行う。タスク完了commit前は `pnpm codex:finish-check` で差分に必要な検査を実行。全検証が必要な変更では `pnpm verify` を使う。
- 分類別上限は [check-docs.mjs](scripts/check-docs.mjs) のTHRESHOLDS。正源の分担・重複を増やさない更新・検査の限界は [文書保守](manual/ai-reference/00_meta/documentation-maintenance.md) に従う。
- 上限を超えたら同ターンで分割し、入口 README と他文書からの導線も更新する。
- `manual/deep-research-report.md` は歴史的成果物として日常参照対象外、サイズ制限から除外。

## タスク実行モード

通常は依頼された1タスクのみを実行する。連続実行・フルラン・Engine Lane の規定は [task-execution-modes.md](manual/ai-reference/00_meta/task-execution-modes.md) を参照。

- 対話の仮確認は `pnpm verify:dialogue <file.test.ts...>` を使う。[詳細](manual/ai-reference/00_meta/harness-validation.md)
