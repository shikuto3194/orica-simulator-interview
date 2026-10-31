# Effect-debug Loop Runbook

> 2026-09-23 ユーザー指示: 本ループ（policy学習・AI自動対戦・harvest/soak）はフルランの対象外。checkpointや未解決EDHは保持する。再開は別途ユーザー指示がある場合だけ行う。現在のフルランは[coverage/fidelityの残件と停止条件](full-run-supervisor.md)に従う。

`effect-debug-harvest` を使う自動駆動デバッグの正源。既存の full-run / cluster-registry /
engine lane / Telegram outbox を流用し、疑義の発見、修正、ユーザー確認を 1 時間 tick で回す。

## 目的

- self-play 由来の効果バグ・仕様疑義を replay 付きで発見する。
- 発見フェーズが修正 backlog を増やし続けないよう、open cluster がある間は修正を優先する。
- 「0 件」を単なる空 ticket ではなく、探索量・検出器・triage が生きていることを示す証明付き状態にする。
- ルール解釈が必要な疑義だけ Telegram でユーザー確認へ落とす。

## 1 時間 tick

tick ごとに effect-debug cluster 数を先に数える。対象は `cluster-registry.json` のうち
`source:"effect-debug-harvest"` または id prefix `edh-` で、`status:"open"` / `status:"in_progress"` のもの。
`codex-explore` / `claude-explore` は数えない。

1. **cluster 0 件**
   - active debug batch がなければ `policy-bootstrap --dryRun false` を先に実行し、直前 checkpoint を
     再開して policy/value head を 1 epoch 更新する。checkpoint は batch ごとに immutable に保存する。
     これは debug 用の shadow 学習であり、ISMCTS I6 の本番自律学習・昇格とは区別する。
     有効な終局 sample がなければ `no_data`、正の学習率で整合する証拠の更新数が0なら `no_update` とする。
     学習率0は実producerがゲーム生成前に拒否する無効入力であり、`failed` とする。
     `trained` は有効 sample・正の学習率・更新数と trainingStep 増分の一致・保存checkpointの
     SHA/step 一致を必要とする。checkpoint保存や過去の累積stepだけで進展としない。
     未更新時は診断結果 `policy-training-no-progress` を返し、追加harvestは開始しない。
     返却結果・state・reportまでが本CLIの範囲であり、現行supervisorからの自動dispatchを保証しない。
     既存stateの `lastPolicyTrainingAttempt` に今回の数値とartifact参照を保持し、
     `policyTraining` の既存checkpointは差し替えない。破損/矛盾した証拠は `failed` とする。
   - 段階 profile で `pnpm effect:debug -- --games <stageN> --maxSteps <N> --seed <seed> ...`
     を実行する。coverage cohort は学習済み `policy` 対 `random` と
     `coverage_guided` deck を使い、stage は `10,50,100,200,1000,3000`。
     各 coverage cohort の後に小さい `policy` 対 `mcts` stress cohort を別 artifact で実行する。
     elapsed-time不足だけをperformanceとしてcoverage cohortから分離し、decision-limit cap・truncation・provenance欠損はcorrectness不成立としてstageを前進させない。
     resume 中の batch は途中で重みを変えず、active batch に固定した checkpoint path/SHA、
     game guard、timeout、deck、agent、exploration、MCTS stress 設定を使う。
   - `tickets.jsonl` と `metrics.json` を `effect-debug-triage` で検証・分類する。
   - `hard_failure` / `state_invariant` / `truncated_choice_surface` / 別 seed で再現した `capped` を
     `edh-*` cluster として登録する。
   - 登録が 1 件以上なら修正 lane を起動する。0 件なら `clean` を Telegram progress で要約する。
2. **cluster 1 件以上**
   - shadow 学習と harvest は起動しない。
   - 既存 effect-debug cluster を claim して engine 修正 lane を起動する。
   - cluster が drain されるまで新規発見を増やさない。

## cluster 形式

`cluster-registry.json` へ登録する最小形:

```json
{
  "id": "edh-hard-failure-<signature>",
  "lane": "codex",
  "status": "open",
  "source": "effect-debug-harvest",
  "scope": "ticket / replay / rerunCommand で再現する hard_failure を修正する",
  "queueRefs": ["artifacts/effect-debug/.../tickets/EDH-....md"],
  "doneDefinition": "元ticketのrerunCommandを同seedで再実行して同signatureが再発せず、回帰テスト追加、pnpm check/test/check:ssot/check:wiring と verifier green",
  "guardrails": "ルール解釈が必要なら needs-ruling + Telegram。推測で仕様確定しない"
}
```

signature は `kind + sourceCardNo + actionKind + nodeKind + normalizedError/invariantCode` を基本にする。
広すぎる duplicate 判定は別バグの握りつぶしになるため、`sourceCardNo` 不明の ticket は
error / invariant 内容を必ず含める。

## triage 結果

`effect-debug-triage` は 3 値だけを返す。

- `promoted`: 修正 cluster 登録あり。
- `clean`: 有効な harvest で登録対象 0。
- `invalid`: harvest が証明不足、失敗、または detector / triage 生存確認に失敗。

`invalid` は 0 件扱いしない。Telegram `kind:error` で通知し、次 tick で再試行する。
dirty worktree は staged clean 証拠としては `invalid` だが、通常 worker は止めない
（wrapper が直前に `cluster-claim audit --apply` で registry を更新する場合があるため）。

## root 分離

無人 supervisor では main working tree を対話セッション専有にするため、effect-debug loop も
lane worktree を検査対象にする。

- 実行 / 証明 root: `ORICA_EFFECT_DEBUG_WORKTREE`。`HEAD`、dirty check、harvest 実行 script、
  `metrics.config.commitHash`、`cluster-claim.mjs` の実行 script / cwd はこの worktree 基準。
- 共有 hub root: `ORICA_EFFECT_DEBUG_HUB_ROOT` または `ORICA_SUPERVISOR_HUB_REPO`。
  `logs/effect-debug-loop-state.json`、`artifacts/effect-debug/`、Telegram outbox はこの root 基準。
  replay / ticket evidence は hub root の artifacts を読む。
- tracked な cluster registry は lane worktree 側を正源にする。cluster 登録時は worktree 側
  `cluster-claim.mjs` に `ORICA_CLUSTER_REGISTRY=$Worktree/autorun-queue/cluster-registry.json` を
  明示し、registry 更新を worker の verified commit に含める。primary root に registry を書くと
  `auto-merge.ps1` の clean/main 前提を壊す。
- `scripts/run-supervisor-iteration.ps1` は `$Worktree\scripts\effect-debug-loop.mjs` を起動し、
  hub root、worktree registry、`ORICA_EFFECT_DEBUG_HARVEST`、`ORICA_POLICY_SHADOW_SCRIPT`、
  `ORICA_EFFECT_DEBUG_STATE`、
  `ORICA_EFFECT_DEBUG_REPORT` を明示してから tick を実行する。

## staged clean / stop-ready

詳細は [Effect-debug staged clean / stop-ready](effect-debug-stop-readiness.md) を参照。

## checkpoint と adaptive timeout

shadow 学習 checkpoint は `artifacts/policy-shadow/<experimentId>/checkpoint.json` に atomic 保存する。
state の `policyTraining` は HEAD が変わっても保持し、次 run は schema-compatible な直前 checkpoint を
親として新 checkpoint を作る。各 cohort の `activeBatch` は path/SHA/trainingStep を固定し、
harvest timeout 再開中に方策を更新しない。各 harvest 起動直前に checkpoint 内容の SHA-256 を固定値と照合し、差し替わっていれば cohort を `invalid` にして混在実行を拒否する。学習 process/metrics/checkpoint が壊れた場合は cohort を開始せず
`policy-training-failed` として通常 Codex worker に診断を渡す。

harvest は `<artifact>/checkpoint.json` と game ごとの `<artifact>/games/game-*.json` を atomic に更新する。
各 attempt は `game-NNNN.attempt-AA` 名の replay / trace / frame を `.partial` から atomic rename で先に確定する。elapsed retry 前の artifact も保持し、`slow_game` ticket は実際に elapsed cap へ達した最後の attempt を指す。最終 attempt の参照だけを持つ小さい game ledger を保存してから checkpoint の completed index を更新する。途中停止の `.partial` は completed evidence に数えない。
同じ config・seed・checkpoint で再起動すれば、completed game は再実行も二重集計もせず、未完了 game だけを
続行する。

親 process の必要timeoutは固定20分ではない。coverage と MCTS stress は、それぞれ自身の checkpoint と
同profileの直近cohortが持つ observed per-game runtime の最大値 / 平均値から per-game budget を独立して
算出し、残りgame数と startup grace を掛け合わせる。coverage 完了後に stress を再開するときも、
coverage の残り0件由来の startup grace だけを継承しない。親の per-game budget は 60秒→120秒→240秒の
retry ladder 全体を最低値として確保し、実測から得た初期game上限もharvest childへ反映する。
ただし1回のsupervisor実行は既定45分で区切る。1game完了ごとにcheckpointをatomic更新するため、3000 / 5000 / 10000を1runで完走できなくても、次runが完了済みgameを再実行せず累積継続する。
予期しない親timeoutでも `parent-diagnostics.json` に exit/signal、timeout、経過時間、checkpoint進捗、
stdout/stderr tailを保存して、次tickでcheckpointから再開する。MCTS stressも親timeout時はperformance確定せず、
同じstress artifact/checkpointを再開して完了後にticketをtriageする。連続して進捗がなければworker診断へ渡す。
checkpoint が前回 timeout より進んだ場合は `progress` として再開する。一方、同じ checkpoint のまま
親 timeout が再発した場合は `checkpoint-stalled` として Codex worker を起動し、`parent-diagnostics.json`
を最優先で調査する。stall 検知の error 通知は最初の 1 回だけで、同じ状態の毎時重複通知はしない。
`ORICA_EFFECT_DEBUG_TIMEOUT_MS` は計算結果を**延長する場合だけ**の緊急上書き（短縮は無効）、
`ORICA_EFFECT_DEBUG_PER_GAME_TIMEOUT_MS` と `ORICA_EFFECT_DEBUG_STARTUP_GRACE_MS` は推定の初期値を
調整するためだけに使う。単に global timeout を引き上げて失敗を隠してはならない。

## clean gate

`clean` と認める条件:

- `effect:debug` process exit 0。
- `metrics.config` が固定 profile と一致する。
- `metrics.config.commitHash == HEAD`。
- worktree が clean（同じ `HEAD` でも未コミット差分があれば stage reset + `invalid`）。
- `config.games == requestedGames` かつ `qualifyingGames >= requestedGames`。
  `attemptedGames` はpersistent elapsed capのreplacement分だけ増えてよい。
- qualifying gameだけの `totalDecisionFrames >= minDecisionFrames`。
- qualifying gameだけの effect / `sourceCardNo` 付き decision が `minEffectDecisions` 以上。
- qualifying gameだけの unique `sourceCardNo` が `minUniqueCards` 以上。
- detector manifest hash が期待値と一致する。
- `tickets.jsonl` が存在し schema valid。
- triage canary fixture で既知 `hard_failure` が必ず `promoted` 判定になる。
- `critical` / `high` かつ `confidence:"reproducible"` の ignored count が 0。
- `metrics.aggregate.coverage` が schema valid で、実行済み semantic coverage と choice-surface coverage を
  持ち、persisted selected frames と per-game checkpoint ledger から triage が独立再計算した値と一致する。
- elapsed-time `capped` gameはraw coverageとticketへ残すが、clean coverageから除外してreplacementする。
  同signatureが別seedで再現したらrepair clusterへ昇格する。decision-limit cap / `truncated` decisionは
  clean coverageに残してgateを落とし、`truncated` はその時点でrepair clusterへ昇格する。

どれか 1 つでも満たせなければ `invalid`。

## ticket 昇格基準

- `hard_failure`: 原則自動 cluster 化。done済みclusterと同じ証拠で再発した場合もopenへ戻す。
- `state_invariant`: 原則自動 cluster 化。
- `capped`: 同 signature が複数 seed / rerun で再現したら cluster 化。単発elapsed capはperformance集計。
  replacement済みticket、coverage不適格cohort、MCTS stressのticketもstateに保持して比較から落とさない。
  `coverage_guided` の後続gameは先行gameのcoverageに依存するため、`rerunCommand` はcohortのbase seedから
  対象gameまで再生する。coverageとMCTS stressを横断して昇格したclusterは、両ticket/replayを`queueRefs`と
  scopeに保持し、worker evidenceでも両方を表示する。
- `slow_game`: elapsed cap retryが一度でも必要だったgame。low severityのperformance trendとして記録する。
- `truncated_choice_surface`: 選択肢を欠落させた実行は許容せず、自動 cluster 化。
- `wide_choice_surface`: バグ扱いしない。閾値超過の trend だけ通知。

ルール解釈が必要なら、既存の裁定規約どおり公式 Q&A / `10_rules/` を先に確認する。
閉じなければ `needs-ruling.jsonl` と `supervisor-report.mjs --kind ruling` でユーザー確認へ落とす。

## 保険

- 親 timeout (`ETIMEDOUT`) は checkpoint の進捗があれば同じ deterministic batch を resume する。
  進捗なしの timeout は `checkpoint-stalled` として worker が診断し、signal / exit failure は checkpoint artifact と診断を保存したうえで `invalid` + Telegram error。cluster は作らない。
- cluster 登録後の worker 起動失敗: cluster は open のまま残し、次 tick で再拾い。
- worker stuck / no-op: 既存 lock TTL で回収。cluster に `attemptCount` / `lastError` を追記し、
  3 回失敗で `needs_user_confirmation` 相当の報告か別 lane へ再登録する。
- verifier refute: 既存 engine lane と同じく最大 3 round。残る場合は replay 付きで park。
- Telegram 不達: outbox relay が再送する。loop は止めない。
- suspicious ticket 洪水: 自動 cluster 化しない。summary のみ通知し、再現複数回または上位閾値超過で昇格する。

## fuzz seed rotation

`pnpm fuzz` は既知回帰seed `1,2,3,4,5` を毎回含め、残りを
`logs/fuzz-seed-ledger.json` でatomic予約した未使用範囲から採る。出力された
`rotatingSeedBase` で再現でき、`FUZZ_SEED_BASE` を明示すれば任意の範囲を固定できる。
seed列は `scripts/fuzz-seed-ledger.mjs` の `buildFuzzSeedPlan` を実行側とテストで共有する。
ledgerがJSON破損またはschema/次seed不正の場合は未作成扱いにせずfail closedとし、使用済み範囲を再発行しない。
これにより毎回同じ300局だけを通す状態を避けつつ、既知seedの回帰性を維持する。

## 実装入口

実装済み入口:

- `scripts/effect-debug-triage.mjs`: clean/promoted/invalid 判定、canary、cluster 登録。
- `scripts/policy-bootstrap.mjs`: 自己対戦 replay → head-only actor-critic 更新 → versioned checkpoint。
- `scripts/effect-debug-loop.mjs`: 1 時間 tick の cluster count → shadow 学習 → harvest → triage 制御。
- `scripts/run-supervisor-iteration.ps1`: `lib/supervisor-work-plan.ps1` で fresh coverage / fidelity を先に実行する。coverage todo または fidelity violations が残れば harvest を実行せず、カード・行を渡して engine worker に実装させる。計測失敗は監査修復 worker へ送る。
  両監査が解消した場合だけ loop を実行する。返却された `skipWorker` は収集側の推奨であり、durable follow-up 等による起動を妨げない。起動済み worker の終了指示には使わず、prompt には wrapper の最終判断を別に注入する。dirty worktree invalid は通常 worker 継続、harvest / triage invalid は他の作業需要が無い場合のみ skip。
- `cluster-claim.mjs` evidence key `effect-debug-ticket`: ticket/replay 要約を修正 prompt に注入。
- `scripts/telegram-inbox.mjs`: Telegram の `/ruling <cardNo> <本文>` と通常指示を Codex 用 inbox へ同期する。
- `supervisor-report.mjs` / `relay-outbox-to-telegram.mjs`: progress / error / ruling 通知。

修正そのものは既存 engine lane に任せ、gate / adversarial verifier / auto-merge は流用する。
