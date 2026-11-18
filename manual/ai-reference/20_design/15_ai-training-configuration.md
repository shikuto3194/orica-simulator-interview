# AI 学習構成リファレンス

目的: 学習自体を開始する前に、実験構成・出力・評価・停止条件を固定する。ここは
`20_design/14_dl-ai-architecture.md` の実行運用編であり、モデル学習コードの実装前にも更新してよい。

現役正源は[ISMCTS継続学習](../30_plan/ismcts-full-run/continuous-learning.md)。2026-10-06承認: 可能なら24時間生成・学習・評価・更新を自律反復、LLM成果確認は当初120分。
学習中/評価候補/本番を分離し、一人バトルは[旧モデルも使えなければ簡易AI](../30_plan/ismcts-full-run/solo-fallback.md)へ復帰する。

## 対象範囲

- 対象: 非通信対戦 AI、将来のマッチング対戦 AI、構築 AI の評価用 self-play。
- 対象外: ルーム対戦。相手に個別連絡して遊ぶ経路なので AI は介入しない。
- 観測入力の正源: `20_design/16_ai-observation-contract.md`。手札内容、カードデータ、
  実効シンボル/BP/Lv、公開済みデッキ情報は `AiObservation` として渡し、
  `LegalAction` には詰めない。
- 学習入力の正源: `packages/rules-core/src/player-decision-contract.ts`。
  `LegalAction` だけではなく system action、preGame、`ApplyLegalActionOptions` の
  `ai_decision` field を含めた `PlayerDecision` surface を使う。
- 漏れ検知: `pnpm check:ssot` の `player-decision-contract-ssot` と関連 vitest。

## 実験 ID と出力

学習実装時は、1 run を一意な `experimentId` で管理する。推奨形式:
`YYYYMMDD-HHMM-<short-name>`。例: `20260811-2100-policy-smoke`。

出力は repo 汚染と再開事故を避けるため、学習成果物と軽量メタデータを分ける。

| 種別 | 推奨内容 |
|---|---|
| `config` | experimentId、seed、profile、commit hash、deck/gauntlet、budgets |
| `trace` | `TrainingDecisionTraceEntry`、winner、seat、truncated node count |
| `replay` | GUI デバッグ用の短い state 列。長期学習には使わない |
| `replay-buffer` | `AiObservation + TrainingDecisionNode + policy/value target` の JSONL |
| `metrics` | winrate、seat別勝率、自然終局率、stuck/error、steps/sec |
| `checkpoint` | NN weights。初期 smoke では生成しない |

初回は「trace と metrics だけ」を作る dry-run から始める。checkpoint を出すのは
replay schema と評価 harness が安定してから。

### GUI 棋譜ビューア

GUI は `apps/playground-web/src/replayViewer.ts` を入口に、開発者向けの「棋譜読み込み」から
状態列を再生できる。初期対応形式:

- `{ "frames": [{ "state": GameState, ...metadata }] }`
- `{ "states": [GameState, ...] }`
- `{ "snapshots": [GameSnapshot, ...] }`
- 単体 `GameState` / 単体 `GameSnapshot`

`trace-smoke` CLI の replay 出力は、当面この形式に寄せる。巨大な全 state を恒久保存する設計にはせず、
短い smoke / regression / stuck 調査用の「GUI で流せる確認資料」として使う。長期学習用の replay buffer は
別 schema として扱う。

### 学習 replay buffer

`trace-smoke` は学習自体を始めないが、同じ run から `replay-buffer.jsonl` を出す。各行は
`TrainingReplaySample`（schemaVersion 1）:

- `observation`: 手番者視点の `AiObservation`。raw `GameState` は入れない。
- `node`: `TrainingDecisionNode`。top-level / preGame / action_input の候補集合。
- `selected`: 実際に選ばれた `TrainingDecisionTraceEntry`。
- `policyTarget`: `selectedChoiceIndex` と one-hot `distribution`。
- `valueTarget`: 自然終局時だけ win/loss/draw を value にする。`capped` / `stuck` / `error` は
  `terminalOutcomeKnown:false`。
- `weights`: `truncated` node は `policy:0`。未終局/異常終了 sample は `value:0`。

replay buffer の label/weight 契約は学習開始後も不変である。自然終局 sample だけを actor-critic 更新へ
使い、異常・cap 終了を擬似的な負けとして学習させない。

`packages/rules-core/src/training-replay-buffer.ts` は `TrainingReplaySample[]` から
`buildEncodedTrainingReplayBatch()` で `EncodedAiObservation`、choice mask、choice feature、
policy/value target、weight を固定形状 batch にする。`packages/rules-core/src/training-action-encoder.ts` は
`encodeTrainingDecisionChoice()` で `TrainingDecisionChoice` の pointer feature を作る。
`packages/rules-core/src/training-policy-value.ts` は `PolicyValuePredictor` と
`makePolicyValueTrainingPolicy()` の同期推論 adapter を固定する。
`packages/rules-core/src/training-policy-value-network.ts` は最小 DeepSets 風 policy/value NN、
head-only actor-critic batch 更新、gradient clipping、versioned checkpoint export を提供する。
`packages/rules-core/src/training-mcts-policy.ts` は `TrainingDecisionNode` 単位の完全情報 MCTS baseline を提供する。
`legal_action → action_input` は探索内の仮想ノードとして扱い、追加入力 chooser を探索対象から落とさない。
選択肢が1件だけの node は forced choice として探索・heuristic 評価を省略し、空撃ち回避などの方策補正だけを適用する。

実行入口は `pnpm trace:smoke -- --games 10 --maxSteps 120 --seed 1`。既定出力先は
`artifacts/trace-smoke/<experimentId>/`（gitignore）。出力:

- `metrics.json`: outcome / stuck / truncated / choice count / node kind counts。
- `trace.jsonl`: `TrainingDecisionTraceEntry` の軽量列。
- `frames.jsonl`: `AiObservation + TrainingDecisionNode + selected`。`state` は含めず hash だけ持つ。
- `replay.json` または `replays/game-*.json`: GUI 棋譜ビューア用の `{ frames: [{ state, traceEntry }] }`。
- `replay-buffer.jsonl`: 学習 loader 用の `TrainingReplaySample`。raw `state` は含めない。

`trace-smoke` は出力直後に schema validator を通す。既存 artifact を後から検査する場合は
`pnpm trace:validate -- --dir artifacts/trace-smoke/<experimentId>` を使う。validator は
`metrics.json` / `frames.jsonl` / `replay*.json` / `replay-buffer.jsonl` の schemaVersion と
必須 field を検査し、`frames.jsonl` や replay sample に full state が混入した場合も落とす。

`trace-smoke` / `rollout-baseline` は JSON config からも実行できる。CLI 引数は config より優先。
`outDir` が相対パスなら config file からの相対として解決する。

```json
{
  "schemaVersion": 1,
  "profile": "trace-smoke",
  "experimentId": "20260812-trace-smoke",
  "games": 10,
  "maxSteps": 120,
  "seed": 1,
  "maxGeneratedChoices": 128,
  "deckSize": 40,
  "skipPreGame": false,
  "outDir": "../../artifacts/trace-smoke/20260812-trace-smoke"
}
```

baseline config では `profile:"rollout-baseline"` と `agents`（`agentA` / `agentB`、値は `random` /
`heuristic` / `mcts`）を追加する。`position-bias-diagnose` は `agents.agentA` を単一 agent として使う。
効果デバッグ harvest config では `profile:"effect-debug-harvest"` と `agents`、任意で
`wideChoiceThreshold`、elapsed cap retry/replacement、`deckStrategy` / `focusCardCount` を
追加する。これは学習ではなく、短い replay と draft ticket を生成する疑義発券 profile。
出力 summary の `config` には `profile` / `configPath` / 現在 commit hash / runtime metrics
(`durationMs`, `stepsPerSecond`) が入る。

棋譜ビューアは通常のルーム観戦とは違い、検証用の全情報公開ビューとする。両プレイヤーの手札は実カードで
表示し、裏向きカードも詳細表示では実カードを開示する。対戦相手へ共有するルーム観戦は引き続き
`sanitizeStateForViewer` の可視性境界を守る。

## Run profile

最小構成は以下の profile に分ける。profile 名は将来 CLI/config にそのまま使う前提。

| profile | 目的 | 学習 | 目安 |
|---|---|---|---|
| `trace-smoke` | decision surface と replay schema の疎通 | しない | 10〜100 games |
| `rollout-baseline` | random/heuristic/MCTS の比較基準 | しない | 席交互 100〜1000 games |
| `effect-debug-harvest` | 効果バグ/仕様疑義の replay 付き draft ticket 収集 | しない | 10〜1000 games |
| `policy-bootstrap` | 自己対戦 replay による policy/value head 更新と checkpoint | する（body 固定） | 小ガントレット、resume 前提 |
| `position-bias-diagnose` | 先攻/後攻バイアスの切り分け | しない | random/mirror/paired swap |
| `gauntlet-train` | 固定ガントレットで本学習 | する | tier 重み付き、resume 前提 |

2026-09-01 の明示指示により `policy-bootstrap` の head-only 学習と checkpoint 更新を開始した。
`gauntlet-train` の body 更新・optimizer state・対旧 checkpoint 評価 gate は未実装であり、shadow run の
自然終局率と安定性を確認してから段階的に移す。

`rollout-baseline` の実行入口:

`pnpm rollout:baseline -- --games 100 --maxSteps 200 --seed 1 --agentA random --agentB mcts`

既定出力先は `artifacts/baseline/<experimentId>/`（gitignore）。出力は `baseline.json`。
席は game index ごとに交互入れ替えし、`agentWins` / `seatWins` / `outcomeCounts` /
`nodeKindCounts` / `truncatedNodeCount` を保存する。これは学習ではなく、方策改善前後の比較基準。

`effect-debug-harvest` の実行入口:

`pnpm effect:debug -- --games 100 --maxSteps 4000 --seed 1 --agentA policy --agentB random --deckStrategy coverage_guided --maxGameDurationRetries 2 --maxGameDurationCeilingMs 240000 --maxReplacementGames 10`

既定出力先は `artifacts/effect-debug/<experimentId>/`（gitignore）。出力は `metrics.json`、
`tickets.jsonl`、`tickets/*.md`、`trace.jsonl`、`frames.jsonl`、`replays/game-*.json`。
検出器は `hard_failure`（stuck/error）、`capped`、`slow_game`、`state_invariant`、
`truncated_choice_surface`、`wide_choice_surface` を持つ。elapsed capは同一seedを
adaptiveに再試行し、persistent capだけ別seedで置換する。raw `coverage` は全game seed試行、
`cleanCoverage` と最低decision/effect/card数はelapsed capを除くqualifying試行を表す。ticket はreplayとrerun commandを持つ draftとして保存し、`truncated_choice_surface` の suspect/step はゲーム最終判断ではなく最初に実際の打ち切りが起きたdecision frameを指すため、同一seed再現から直接修正箇所を追える。通常の対象 subset と支払いなどの直積が上限へ達する場合は、対象固定後の残り input が単独で完全列挙できることを確認して対象採否を逐次化する。可変 zone discount はカード採否と支払いを逐次化し、支払い不能な採否枝を除いて直積と行き止まりを避ける。

この draft を 1 時間 tick の発見→修正 loop に載せる運用は [`30_plan/effect-debug-loop-runbook.md`](../30_plan/effect-debug-loop-runbook.md) を正源にする。
`clean` は空 ticket ではなく、探索量・detector 生存・triage canary を満たした証明付き状態として扱う。

`policy-bootstrap` の実行入口:
`pnpm policy:bootstrap -- --games 2 --maxSteps 80 --seed 1 --dryRun true`
`pnpm policy:bootstrap -- --games 4 --maxSteps 4000 --seed 1 --dryRun false --checkpointOut artifacts/policy-bootstrap/manual/checkpoint.json`

既定出力先は `artifacts/policy-bootstrap/<experimentId>/`（gitignore）。tiny policy/value NN を
`TrainingPolicy` として自己対戦に差し込み、固定形状 batch で policy/value loss を評価・更新する。
初期実装は表現 body を固定し、自然終局 value で head だけを actor-critic 更新する。bounded batch は
自然終局 label を決定的に優先する。`deckSelection` 指定時は選択集合から重み付きでデッキを選ぶ。
`--dryRun false` は versioned checkpoint を atomic write し、`--checkpointIn` で再開する。
`capped` / `stuck` は value label にせず、自然終局がない batch は `appliedUpdates=0` となる。

`position-bias-diagnose` の実行入口:
`pnpm position:bias -- --games 80 --maxSteps 1500 --seed 1 --skipPreGame true`

`pnpm position:bias -- --deckSelection artifacts/ai-deck-selection/kenshi1645-tier24/selected-decks.json --deckSet gauntletCore --agent heuristic --games 20 --maxSteps 800 --skipPreGame true`

既定出力先は `artifacts/position-bias/<experimentId>/`（gitignore）。`random_decks` /
`mirror_deck` / `paired_deck_swap` の3 cohort を走らせ、先攻席（alice）勝率、非決着率、
敗因、turn/step を保存する。`paired_deck_swap` は同じ2デッキを偶奇 game で席入れ替えし、
デッキ差と席差を分けて見るための診断 cohort。1 game の例外は run 全体を落とさず
`outcome:"error"` と `errorMessage` に保存する。`--writeTrace true` で trace/replay も保存し、`--agent mcts` は `--mctsIterations` / `--mctsRolloutDepth` で軽量化できる。

複数 artifact の比較は `pnpm metrics:training -- <artifact-dir-or-json>...` を使う。
`metrics.json` / `baseline.json` / `position-bias.json` またはそれらを含む directory を渡すと、profile 別に
outcome / truncated / seat win / agent win / steps/sec を集計する。`--json` は機械可読出力、
`--out <file>` は report JSON 保存。

## 固定すべき設定

| 項目 | 初期方針 |
|---|---|
| seed | run 全体 seed + game index 派生 seed。再現可能にする |
| seats | 評価は必ず席交互。先攻/後攻バイアスを別 metric に出す |
| maxSteps | smoke は短め、本評価は終局率を見て調整。cap 終了は負け扱いにしない |
| maxGeneratedChoices | `training-decision-surface` の `truncated` を監視。多発する node は分解候補 |
| checkpoint | versioned artifact を immutable に保存し、評価・ticket に絶対 path と SHA-256 を残す |
| hidden info | `AiObservation` / `ai-observation-encoder` の可視性境界と ISMCTS determinization 境界を一致させる |
| deck source | まず固定デッキ。構築最適化は play AI 評価が安定してから |
| gauntlet weights | tier1 厚め、tier外は「自動負けしない」重み。変更時は config に記録 |

## AI 評価と tier 表

将来的な tier 表は、AI の固定ガントレット評価を **草案** として使い、人間が最終確定する。
AI 出力は `humanTier` / `aiEstimatedTier` / `aiScore` / `confidence` を分けて保存し、
席交互の matchup matrix、stuck/capped 率、試行数を併記する。実戦ログや人間側の対面理解と
矛盾する場合は、根拠を notes に残して人間判断で override する。

## 評価ゲート

学習前でも、評価 harness は先に作れる。最低限の gate:

- `PlayerDecision` trace に `action_input` / `systemActionKind` / `preGamePhase` が出る。
- `truncated` の割合を metric 化し、候補爆発が見える。
- 席交互で random / heuristic / MCTS baseline を保存する。
- 固定先攻の `position-bias-diagnose` を保存し、先攻/後攻バイアスを baseline と分けて見る。
- `stuck` / `error` は勝敗と別 metric。強さ評価に混ぜない。
- 同一 commit + seed + config で主要 metric が再現する。
- `check:ssot` / `check:wiring` / 関連 vitest が green の commit だけを実験対象にする。
- smoke / stuck 調査の replay は GUI 棋譜ビューアで開ける。

## ローカルマシン方針

この PC 内に収めるのを基本にする。外部サーバーは以下のどれかが明確な場合だけ検討する。

- replay 生成ではなく NN 学習が GPU memory / wall time で詰まる。
- 複数ガントレットを長時間並列に回す必要がある。
- checkpoint 比較のためにローカル作業を止めたくない。

外部を使う場合でも、`PlayerDecision` trace schema、config、commit hash、評価 gate は同じにする。
サーバーだけで成立する別実装を作らない。

## 学習 run チェックリスト

1. `pnpm check:ssot` が green。
2. `PlayerDecision` contract 変更がない、または変更分が docs に反映済み。
3. `AiObservation` leakage / encoder finite tensor / GUI parity / card feature field coverage test が green。
4. dry-run が checkpoint を出さず、実学習 run が versioned checkpoint と `trainingStep` を出す。
5. 席交互 baseline が保存済み。
6. `truncated` node の多発箇所を把握済み。
7. 実験 config と artifact summary に commit hash / seed / deck / profile / budget が入る。
8. 途中停止しても partial output を読める。

## 次の実装
head-only shadow学習から[現役タスクI6](../30_plan/ismcts-full-run/tasks.md)へ進む。
body/optimizer・旧checkpoint比較・自律更新を実装し、自然終局率・更新0・stack overflowを診断する。
