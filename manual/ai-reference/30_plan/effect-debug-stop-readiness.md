# Effect-debug staged clean / stop-ready

[effect-debug-loop-runbook.md](effect-debug-loop-runbook.md) の詳細。運用判断の入口は元runbook。

## staged clean / stop-ready

停止判定は「単に検出 0 件の game 数」ではなく、`logs/effect-debug-loop-state.json` の staged
clean 証拠で判断する。

既定の coverage cohort:

1. `10 games clean`
2. `50 games clean`
3. `100 games clean`
4. `200 games clean`
5. `1000 games clean`
6. `3000 games baseline`
7. `5000 games post-saturation soak`
8. `10000 games final soak`

各 cohort は別 seed で実行する。通常 seed は既存 cohort と重複しないよう loop が自動でずらす。
`ORICA_EFFECT_DEBUG_SEED` で明示固定して既存 seed と重複した場合、その tick は `invalid` 扱いで
段階を先頭へ戻す。

既定の game 内 guard は、policy decision budget `maxSteps=4000`、強制遷移 budget
`maxForcedTransitions=1000`、同一進行状態の再訪許容数 `maxRepeatedStateTransitions=4`、
choice 生成上限 `maxGeneratedChoices=1024`。`maxSteps` は decision 数だけを制限し、到達時だけ
`capped / decision_limit` とする。強制遷移上限は `stuck / forced_transition_limit`、ログ等の診断情報を
除いた状態 fingerprint が同一 game 内で繰り返された場合は `stuck / repeated_state` とし、どちらも
`hard_failure` ticket にする。

`3000` は停止を判断する **baseline** であって、game 数だけでは完了しない。harvest artifact の
実行済み action から、カード / effect index / DSL step index / action kind の semantic coverage と、
choice count bucket・wide surface・truncation を集計する。3000 cohort は先行 cohort 群との差分が
設定した key 数・novelty rate 以下で、最低 cohort 数を満たすときだけ saturated になる。
`coverage_guided` は実行回数が少ないカードを各deck先頭へ決定的に注入し、qualifying gameだけで観測数を更新する。elapsed capの途中coverageはperformance証拠に残すが、探索重みには使わない。
各deckには最少coverageの契約カードを最大1枚含め、契約提示を自動受諾してから通常カードを上から引く。
これによりpre-gameの拒否/mulliganで注入順を崩さず、契約カード効果もsemantic coverageへ含める。
elapsed-time cap は同一seedを 60秒→120秒→240秒の既定ladderで再試行し、なおcapならそのgameだけを隔離して
別seedを追加する。cohortは要求したqualifying game数を集め終えるまで継続し、既に得たclean gameを捨てない。
`truncated`、decision limit、stuck、provenance欠損は置換せず従来どおり不適格または修正対象にする。
組合せ配置は65件目の候補を検知した時点で配置元ごとの逐次decisionへ分解し、合法な最終配分を
欠落させない。対象 subset と他 input の直積が上限へ達する場合も、対象固定後の残り input が単独で完全列挙できるときだけ対象採否を逐次化する。可変 zone discount も65件目でカード採否を逐次化し、選択集合に依存する支払いを
次nodeで列挙して直積を避け、支払い可能な完了集合へ到達できない採否枝は提示しない。`truncated_choice_surface` ticketのsuspect/stepは最初の実打ち切りframeを保存する。

effect index / DSL step index に source card の provenance がない cohort も semantic evidence には
ならない。これは `unknown` の疑似カードへ寄せず `unattributed*` として残し、修正すべき計測欠損として
明示する。action kind が取れない `unattributedActionFrames` も同様に saturation evidence から除外する。

5000 / 10000 は baseline saturation を置き換えず、既定で **saturated になった 3000 の後**に
post-saturation soak として走らせる。`ORICA_EFFECT_DEBUG_POST_SATURATION_SOAK_GAMES` はこの既定列を
上書きするときだけ使う。これにより、coverage がまだ増え続けている状態を単純な game 数の増量で
clean と誤認しない。

`stop-ready` と認める条件:

- EDH open / in_progress cluster が 0。
- worktree が clean（repo root 直下の `.verifier-*` 検証一時ファイルだけ対象外）。
- rules/card-data/harvest/self-play の behavior fingerprint が stage 中に変わっていない。文書だけの
  commit など fingerprint が同じ `HEAD` 更新では完了済みcohortを維持し、active batchだけ破棄する。
  artifactのexperiment namespaceにはfingerprint短縮値とHEAD短縮値を含め、behavior変更後や同一behaviorの別HEADで旧checkpointを再利用しない。
- stage 開始後に `invalid` が 0。
- stage 開始後に `promoted` が 0。
- 全 stage cohort が clean gate を通過している。
- 全 cohort に seed が記録されている。
- cohort の seed がすべて異なる。
- cohort 内の per-game seed 集合が全体で重複しない。
- clean / 非 clean を含む試行済み cohort 間で `capped` ticket の同 signature 複数 seed 再現がない。
- 最終 stage が baseline saturation と、その後の 5000 / 10000 soak まで通っている。

どれか 1 つでも崩れたら stage は先頭へ戻る。`final-clean` / `stop-ready` は
「フルラン停止可能」の報告であり、task disable はユーザー指示を待つ（停止/再開はユーザー専権）。

設定:

- `ORICA_EFFECT_DEBUG_STAGE_GAMES`: comma 区切り stage。例 `10,50,100,200,1000,3000`。
  空文字/空白のみ、空 token、非数値・0以下の token、厳密昇順でない値、重複は
  `invalid` として扱い、silent drop しない。
- `ORICA_EFFECT_DEBUG_FINAL_STAGE_GAMES`: 最終 stage games。既定 `3000`。
  stage list にこれより大きい値が含まれる場合は切り詰め、末尾を最終 stage に揃える。
- `ORICA_EFFECT_DEBUG_FINAL_CLEAN_GAMES`: 旧名互換。`FINAL_STAGE_GAMES` 未指定時だけ読む。
- `ORICA_EFFECT_DEBUG_GAMES`: staged loop では段階数を変更しない。単発調整は
  `ORICA_EFFECT_DEBUG_STAGE_GAMES` を使う。
- `ORICA_EFFECT_DEBUG_STOP_ON_FINAL_CLEAN`: 既定 `true`。最終 clean 到達後は `stopReady=true` を保持するが、
  task disable は行わずユーザー指示を待つ。`false` は state を先頭へ戻して継続探索する明示設定。
- `ORICA_POLICY_SHADOW_TRAINING`: 既定 `true`。`false` なら shadow 学習を行わず、agent A 既定も
  `random` に戻す。
- `ORICA_POLICY_SHADOW_GAMES`（既定 4）、`ORICA_POLICY_SHADOW_MAX_STEPS`（既定 4000）、
  `ORICA_POLICY_SHADOW_BATCH_SIZE`（既定 512）、`ORICA_POLICY_SHADOW_EPOCHS`（既定 1）、
  `ORICA_POLICY_SHADOW_LEARNING_RATE`（既定 0.001）、`ORICA_POLICY_SHADOW_GRADIENT_CLIP_NORM`
  （既定 5）、`ORICA_POLICY_SHADOW_EXPLORATION_RATE`（既定 0.15）: head-only 自己対戦学習設定。
- `ORICA_EFFECT_DEBUG_POLICY_EXPLORATION_RATE`: effect-debug policy の deterministic epsilon。
  既定 0.15。metrics/checkpoint/ticket rerun command に checkpoint path/SHA、共に残す。
- `ORICA_EFFECT_DEBUG_MAX_STEPS`（既定 4000）、`ORICA_EFFECT_DEBUG_MAX_FORCED_TRANSITIONS`
  （既定 1000）、`ORICA_EFFECT_DEBUG_MAX_REPEATED_STATE_TRANSITIONS`（既定 4）、
  `ORICA_EFFECT_DEBUG_MAX_CHOICES`（既定 1024）: game 内の decision / stuck / choice guard。
- `ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_MS`（既定 60000）、
  `ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_RETRIES`（既定 2）、
  `ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_MULTIPLIER`（既定 2）、
  `ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_CEILING_MS`（既定 240000）: elapsed cap retry ladder。
  checkpointまたは過去のclean/ineligible/stress実測が大きければ初期値自体もadaptiveに延長する。
- `ORICA_EFFECT_DEBUG_MAX_REPLACEMENT_GAMES`（既定はstageの10%、最低5）: persistent elapsed capを
  cohort全体の失敗にせず別seedで補う初期窓。qualifying gameが不足したまま窓を使い切った場合は、
  completed checkpointを維持したまま同じ幅ずつ自動拡張する。
- `ORICA_EFFECT_DEBUG_DECK_STRATEGY`（既定 `coverage_guided`）と
  `ORICA_EFFECT_DEBUG_FOCUS_CARD_COUNT`（既定8）: semantic coverageを増やすdeck探索。
- `ORICA_EFFECT_DEBUG_STRESS_MAX_GAMES`（既定10）と
  `ORICA_EFFECT_DEBUG_STRESS_AGENT_B`（既定 `mcts`）: coverage gateから分離した負荷試験。
- `ORICA_EFFECT_DEBUG_MAX_OLD_SPACE_MB`（既定 8192）: loop が起動する harvest child の V8 old-space 上限。0 以下・整数以外は起動前に拒否する。
- `frames` / replay は game 中に 4 MiB 上限の buffer で per-game artifact へ流す。canonical `GameState` や使用回数台帳を外部化する設定ではない。
- `ORICA_EFFECT_DEBUG_POST_SATURATION_SOAK_GAMES`: 既定 `5000,10000`。別の soak 列へ上書きする場合も
  各値は baseline より大きく、厳密昇順でなければならない。baseline が saturated になる前には実行しない。
- `ORICA_EFFECT_DEBUG_RUN_BUDGET_MS`: 1回の supervisor run が harvest に使う上限。既定45分。
  大きい cohort はgame単位のatomic checkpointへ累積し、進捗があれば正常な
  `checkpointed-progress` として終了して次の毎時runが同じexperiment/seed/設定を引き継ぐ。
- `ORICA_EFFECT_DEBUG_MIN_COVERAGE_COHORTS`（既定 2）,
  `ORICA_EFFECT_DEBUG_MAX_NOVEL_SEMANTIC_KEYS`（既定 8）,
  `ORICA_EFFECT_DEBUG_MAX_NOVEL_SEMANTIC_RATE`（既定 0.01）: baseline saturation の決定的な閾値。
