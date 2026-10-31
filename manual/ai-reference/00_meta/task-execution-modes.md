# タスク実行モード

[CLAUDE.md](../../../CLAUDE.md) のタスク実行モード規定。通常・連続・フルラン・Engine Lane の運用をここへ分離する。

すべてのモードで、ルール変更は [能動的な反例調査](ai-operation-rules.md#2-既存コメント--未解決記述は仮説扱い) を実装前に行う。最後の説明は依頼を条項ごとに照合し、変更・根拠・実際の検証・未検証を対応させる。成功した一部分で依頼全体を完了扱いせず、公開反映を求められた場合は通常pushと採用確認の結果まで記載する。

## 通常モード（デフォルト）

- 対話エージェントは明示された1タスクだけ進め、Cross-cutting Ruleに従って報告・停止する。自律で次へ進まない。

## 連続実行モード

- ユーザーの **`/autorun`** で開始。ToDoの直近順（番号付きは上から）に進み、選択に迷うタスクは分解する。
- 各タスクでCross-cutting Ruleを実行し、変更ファイル・検証・ToDo更新を報告して次へ進む。中規模以上は各タスクでPlaywrightシナリオレビューも実施。
- **`/stop`** または次タスクなしで停止する。

## フルランモード

- Telegram は独立Codexで即時受付し、変更をフルランへ渡す。進捗・完了は同一通知を更新。
- **「フルラン開始」**= supervisor + Telegram enable + 初回実行、**「フルラン停止」**= supervisor disable。
  **停止/再開/方針転換はユーザー専権**（自律で 02 記載・enable/disable 禁止）。正源・前例:
  [full-run-supervisor.md](../30_plan/full-run-supervisor.md)。
- 2026-10-05本人指示で [ISMCTS program](../30_plan/ismcts-full-run/README.md)の開始と実装・検証後の120分監視移行を承認済み。旧AI除外・監査0停止はこのprogramには適用しない。
- 2026-10-06追加承認: AI強化は可能なら24時間、学習・評価・更新はLLM非依存。120分はLLMの成果確認周期。[継続学習](../30_plan/ismcts-full-run/continuous-learning.md)と[一人バトルの簡易AI復帰](../30_plan/ismcts-full-run/solo-fallback.md)を完了条件へ含める。

## Engine Lane (Codex-only)

engine / cards / verifier は Codex worker のみ。legacy task
`orica-engine-claude-iteration` は Disabled を維持し、旧 runner / register も Codex supervisor へ
転送する。`lane:"claude"` / `owner:"claude"` は Codex takeover 対象。詳細は
[`lane-prompts.md`](../30_plan/lane-prompts.md) /
[`engine-drain-runbook.md`](../30_plan/engine-drain-runbook.md)。
