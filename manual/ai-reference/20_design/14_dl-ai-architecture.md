# DL 対戦/構築 AI アーキテクチャ

ISMCTS＋評価関数による対戦/構築AIの設計。実行・評価は`15_ai-training-configuration.md`参照。
プロ並みの認定には対人評価が必要。

## 到達目標とスコープ

- 「想定対面すべて」= **有界な代表ガントレット**（人間調査の tier 表 ~40 アーキ）。無限メタは扱わない。
- tier で重み付け（tier1 を厚く、tier外は「自動負けしない」程度）。段階的に Phase1=tier1+2 → +tier3 → tier外。
- プレイ AI は **1本の汎用方策**（入力に自デッキ＋相手アーキ推定）。構築のみアーキ別・複数。
- 構築最適化 = ガントレット総当たり勝率を評価関数にした共進化（PSRO 系）。

## (1) self-play ハーネス（実装済）

`apps/playground-web/test/selfplay-driver.ts` がエンジンをインプロセス駆動する再利用ドライバ。
MCTS では `chooseAction` を方策に差し替えるだけで再利用する設計。

ループ骨子: `getCurrentActorPlayerIds` で手番者を取得 → `PlayerDecision` contract の
top-level node（`LegalAction` + system action）を選ぶ → 必要なら `action_input` node で
支払い・対象・配分を選ぶ → `applyLegalAction` / system action 適用。ステップ遷移は隠れた自動処理ではなく
`advance_step` system choice として trace する。

- 進入コア配置 `pendingEnterFieldPlacement` は `resolve_pending_enter_field_placement` に
  `enterFieldCorePlacements`（リザーブ→自場コアで最小コア充足）を供給。stuck の 94% を解消。
- 効果登録は `build*Lookup(ALL_CARDS)` 6種を全 apply に渡す（空 stub だと効果が発火せず過小評価）。

### 速度・到達予測の扱い

旧資料の約11,000 steps/秒は当時のdriver計測値で、現在のISMCTS simulation/秒や本番速度ではない。
旧20コア外挿と「数時間〜2日でプロ並み」の到達予測は根拠不足のため採用しない。
1simulationは複数のコピー・候補生成・engine遷移・推論を含み、step数と同一視できない。
現行のCPU2thread・RAM3GiB上限と負荷待機を守り、固定workloadの実測から見積もりを更新する。
[共通telemetry](../30_plan/ismcts-full-run/i0-work-telemetry.md)で各単位を区別する。
自然終局率・強さ・速度・実学習更新は別証跡とし、I0実機校正前の新しい数値見積もりは未確認。

## (2) 状態エンコード設計

AI 観測入力の可視性境界・手札/デッキ/card-data の扱い・GUI 表示との parity check は
`16_ai-observation-contract.md` を正源にする。この節は NN へ渡す tensor 化方針の概要。

### 3原則

- **視点相対化**: 常に「手番側=me / 相手=opp」で符号化。決定者が変わればスワップ → NN 対称化。
- **隠れ情報マスク**: 視点プレイヤーがルール上見える情報のみ。ISMCTS の情報集合と境界一致（後述）。
- **identity = 埋め込み＋明示特徴 併用**（確定）: `cardNo → R^d`(d≈48) 学習埋め込み ＋ cost/色/BP/
  キーワード等の明示特徴を併結。固定ガントレットなら語彙有界、学習も速く新カードに一定の汎化。

### テンソル構成: グローバルベクトル + カードトークン集合

可変長ゾーンは **カード1枚=1トークン**。小型 Set-Transformer / DeepSets で固定長集約。

**A. グローバル scalar（~60次元）**
`turnNumber`(正規化), is-my-turn, `step` one-hot(7), `window` one-hot(14),
me/opp 各: ライフコア / リザーブ通常コア / トラッシュコア / ボイドコア / デッキ枚数 / 手札枚数 /
`soulCoreLocation` カテゴリ / countValue。フラグ: activeAttack 有無, stackWindow 有無+priority==me,
burst/mirage/quartz セット数, このターン burst/mirage セット済, usedDivineSkill 数,
**どの pending がアクティブか** one-hot（micro-state を value head へ）。

**B. カードトークン（可視カードのみ, 各 ≈ d+70次元）**

| 区分 | 特徴量 |
|---|---|
| identity | `cardNo` 埋め込み index（隠れカードは UNK） |
| 静的(印字) | cost, colors multi-hot(7), symbolColors multi-hot(12), levelDefs BP×3, category one-hot(5), keywordTags 上位K |
| 動的(instance) | zone one-hot(13), owner==me, controller==me, normalCoreCount, 実効Lv(`getEffectiveLevel`), 実効BP(`getEffectiveBp`), exhaustState one-hot(3), faceDown, attached/host, adventSource数, pendingLeaveKind, hasSoulCore |

**可視性ルール（トークン化対象）**
- 出す: 両者の**場・トラッシュ**(公開), **自分の手札**, revealed/オープン中。
- 出さない（グローバル count のみ）: **相手の手札**(枚数), 両者の**デッキ**(枚数), **ライフ**(裏向き=枚数)。
- **相手の裏向き**(facedown/burst/mirage): トークンは出すが identity を UNK マスク。

### (2b) determinization 境界（ISMCTS・最重要）

NN入力の隠れマスクと探索の determinization は**同一境界**。

| 情報 | me から | determinization |
|---|---|---|
| 自分の手札・場 | 既知 | そのまま |
| 両者トラッシュ・ライフ枚数・コア | 公開 | そのまま |
| 自分のデッキ | multiset 既知/順序不明 | 残デッキをシャッフル |
| 相手の手札(枚数のみ) | 不明 | アーキ信念から妥当な手札を配る |
| 相手のデッキ / 裏向き | 不明 | **相手アーキ推論の確率分布**からサンプル |

→ 相手アーキタイプ推論モジュールが determinization の事前分布に直結。1 sim ごとに情報集合と
矛盾しない隠れ状態を再サンプルして木を回す。

### 次元規模 / 実装

実装済み encoder は `packages/rules-core/src/ai-observation-encoder.ts`。
`AiObservation` JSON を `global` vector、card token array、known deck memory array、mask へ変換し、
`cardNo` は 0=UNK の embedding index として渡す。`Step` / `Window` / `Zone` / pending summary などの
domain は `check:ssot` で model / observation contract と照合する。

NN 側の目安は Set-Transformer / DeepSets で card token と known deck memory を集約し、
state embedding ~256〜512 → policy head / value head。現在の最小実装は
`training-policy-value-network.ts` の `TinyPolicyValueNetwork`（平均pooling + choiceメタ特徴の
scoring）。source/target pointerはNN入力に未接続。列挙indexは入力せず、
live/replayの順序入替・学習後/復元後のscore対応を回帰する。自己対戦 actor-critic の初期段階では
表現 body を固定し、policy/value head のみ更新する。body学習と具体的な支払い/対象/配分の表現はI6a/I3に残る。
カードDB由来の静的特徴は
`buildStaticCardFeatures()` で別テーブル化し、`cardNo` embedding と併用する。

## (3) 行動エンコード / decision surface（学習入力まで実装済）

`PlayerDecision` contract は `packages/rules-core/src/player-decision-contract.ts` が正源。
`LegalAction` は判別 union。**固定の巨大行動空間を持たず**、各合法手を特徴ベクトル化して
方策がスコアリングする **pointer 方式**を採る。実装:
`packages/rules-core/src/training-action-encoder.ts`（`encodeAction` / `encodeTrainingDecisionChoice`）。

- `encodeAction(action, encodedObservation, ...)` → `{ kindIndex, sourceEmbIndex, sourceTokenIndex,
  targetTokenIndex, feats }`。`feats` は kind one-hot + コスト/対象数/タイミング/skillIndex/pass
  フラグ等のメタ（次元は `ACTION_KINDS` から自動計算）。
- source/target は `EncodedState.tokenInstanceIds` 経由でトークン位置に紐付け（gather 用ポインタ）。
- `ACTION_KINDS` は `LegalAction` union を TypeScript AST で抽出するテスト
  (`action-encoder.test.ts`) と `check:ssot` で照合する。新 kind 追加時に encoder 未登録なら落ちる。
- `ApplyLegalActionOptions` の field は `ai-action-input-coverage.test.ts` で
  `engine_context` / `ai_decision` に分類する。field 追加時に分類漏れ、action API の
  passthrough 漏れ、self-play fuzz の隠れた自動補完増加があれば test / `check:ssot` が落ちる。
- `training-decision-surface.ts` が学習用の sequential decision API を提供する。
  `pregame`（契約提示 / じゃんけん / 先後 / マリガン）→ `legal_action`（`LegalAction` と
  `TrainingSystemAction` を同列に持つ top-level choice）→ `action_input`
  （支払い・対象・配置・配分・順序など）の順で node を生成し、選択結果を
  `TrainingDecisionTraceEntry` として記録できる。
- `TrainingSystemAction` / preGame phase / preGame choice は handler registry を
  `satisfies Record<...>` で縛る。新 kind を contract に足して生成・適用が漏れると型/SSOTで落ちる。

### (3a) `LegalAction` と追加入力の境界（重要）

現行エンジンは「何をするか」と「どう具体化するか」を分離している。

- `LegalAction`: 召喚する / 効果を発揮する / pending を解決する、などの top-level choice。
- `TrainingSystemAction`: `LegalAction` ではないが人間 UI では戦略的に選ぶ top-level choice。
  現在は `advance_step`（他行動が残っていてもステップを進める）と
  `manual_core_move`（メインステップの batch コア移動）を持つ。
- `ApplyLegalActionOptions`: `paymentSources` / `targetInstanceIds` /
  `enterFieldCorePlacements` / `coreShootDistribution` / `coreDistributionAllocations`
  など、GUI が複数クリックで組み立てる parameter choice。
- コア系 GUI は `core-draft.ts` の draft → recompose 層で `ApplyLegalActionOptions` を生成する
  （P3-46）。これは組合せ爆発を避けるための意図的な分離で、`LegalAction` へ全組合せを展開しない。

この分離は GUI / REST には自然だが、学習 AI では **`LegalAction` だけを方策に渡すと人間と同じ
選択肢にならない**。支払い元、ソウルコアを含むか、維持コア配置、対象、配分、順序などを
AI が選べず、呼び出し側が固定補完してしまうため。

### (3b) self-play fuzz と学習 AI の違い

`selfplay-driver.ts` の `resolveActionInputs()` は fuzz / MCTS smoke 用の自動補完である。
例: 候補先頭の対象を選ぶ、最大枚数を pick する、召喚コストをリザーブ固定で払う、など。
これは「engine が crash/stuck しない」検査には有用だが、**強さを学習する方策の意思決定ではない**。

非通信対戦 AI / 将来のマッチング対戦 AI では、次のような sequential decision API を使う:

1. top-level choice（`LegalAction` または `TrainingSystemAction`）を選ぶ。
2. `LegalAction` が parameter choice を要求する場合は追加 node を列挙する。
3. 支払い・対象・配置・配分・順序を、必要な数だけ追加ノードとして選ぶ。
4. `LegalAction` は選択済み parameter を `ApplyLegalActionOptions` に recompose して
   `applyLegalAction` へ渡す。`TrainingSystemAction` は `advanceStep` または
   `core-draft` batch commit + SBA/CE 再計算として適用する。

学習開始前ゲートとして現在満たしているもの:

- `resolveActionInputs()` が自動補完している field は `SELFPLAY_AUTO_INPUT_FIELDS` として
  棚卸し済み。`TRAINING_SELFPLAY_AUTO_INPUT_FIELDS` に同じ field が登録され、漏れたら
  `training-decision-surface.test.ts` が落ちる。
- `ApplyLegalActionOptions` のプレイヤー入力 field 追加時は、分類・REST passthrough・
  training surface / self-play 自動補完台帳のいずれかが漏れると test / `check:ssot` fail。
- preGame（契約提示 / 先後選択 / マリガン）は `skipPreGame` ではなく、非通信対戦 AI の
  decision として露出済み。room 対戦は個別連絡経路であり AI 対象外。
- `advance_step` は残り行動を放棄する top-level choice として露出済み。攻撃ステップ終了は
  既存の `end_attack_step` LegalAction を使い、強制アタック制約などの gate を迂回しない。
- `manual_core_move` は GUI の 2-phase draft を batch system choice として露出済み。最終分配を
  `DraftCoreMove[]` に変換し、`applyDraftCoreMoves` 後に SBA / continuous effect 再計算を行う。
- `TRAINING_IMPLEMENTED_ACTION_INPUT_FIELDS` と `TRAINING_ACTION_INPUT_FIELD_GAPS` は
  `check:ssot` の `player-decision-contract-ssot` で `ai_decision` field 全体と照合する。
  新しい `ApplyLegalActionOptions` field を追加したら、training surface 実装か既知ギャップ分類が
  必須になる。
- 現時点で `ai_decision` field の既知 action input gap は空。follow-up 系
  (`followUpChosenLifeCoreKind` / `followUpPerTargetInputs` / `followUpTargetInstanceIds`) も
  target/source follow-up chooser で候補生成済み。
- `skipOptionalEffect` は optional triggered / battle immediate 等の action input として
  `execute` / `decline` の両方を露出する。

`playTrainingGame()` は smoke/trace と自己対戦 replay 生成の共通 API である。実学習では自然終局した
game の value label だけを actor-critic 更新に使い、`capped` / `stuck` を勝敗ラベルへ変換しない。
巨大な順序・配分ノードは `maxGeneratedChoices` で上限を付けられ、上限到達時は `truncated=true`
として trace に残る。通常の場入りコア配置は65件目の候補を検知した時点で、配置元ごとの逐次
`select_multi_placement_source` node に切り替え、配置元間の直積を作らず全配分を保持する。
小さい配置は単一 `enterFieldCorePlacements` input とする。対象 subset と他 input の直積だけが上限へ達する場合は、対象固定後の他 input を列挙できるときだけ対象採否を逐次化する。可変 zone discount は65件目で採否を逐次化し、支払い可能な枝だけを残してから依存する支払いを列挙する。

## (4) 完全情報MCTS baseline（本番ISMCTSは未実装）

旧 `apps/playground-web/test/mcts.ts`: 真状態 UCT（negamax 視点: ROOT 視点で価値を逆伝播、相手ノードは
選択時に反転）。ランダムロールアウト + 深さ打ち切り時ヒューリスティック（ライフ差中心）。

現行 `packages/rules-core/src/training-mcts-policy.ts` はraw GameStateを受ける完全情報比較用。
本番の観測限定sampler/MO-ISMCTSやNNのprior/leaf接続の実装証明ではない。`TrainingDecisionNode`を探索し、
`legal_action → action_input` は仮想ノードとして展開するため、`advance_step` / `manual_core_move` /
追加入力 chooser も探索対象に入る。`makeMctsTrainingPolicy()` で `rollout-baseline` の agent として利用可能。

**過去の小規模cohortの所見（現行版の強さ・原因は未再検証）:**

- **巨大なポジションバイアス**: ランダム同士で **先攻(alice) の勝率 ~15%**（80戦: 9 vs 51,
  `position-bias.test.ts`）。後攻が圧倒的有利。原因未特定（turn 構造 / 先攻の初回 core+attack
  スキップ / random 方策との相互作用 / エンジン非対称の疑い）。**AI 評価は必ず席を交互**にして
  バイアスを相殺する。これは simulator 正当性に関わる独立調査事項（ハーネスが fuzzer として検出）。
  `position-bias-diagnose` CLI は random / mirror / paired deck swap の3 cohort で、席差とデッキ差を
  分けて保存するための診断入口。
- バイアスを相殺した公平評価では MCTS 勝率 ~50〜57%（小 n）。**符号バグではなく**、評価器
  （手書きヒューリスティック）と浅いロールアウトが粗いため互角どまり。当初「MCTS が弱い」と見えたのは
  MCTS=先攻固定の交絡だった（skeptic 原則で対照実験 → 判明）。
- 浅ロールアウト + ライフ重視は「攻めると自ライフを risk」を過大評価し turtling 化。終局到達ロールアウト
  or value ネットが必要。

`packages/rules-core/src/training-policy-value.ts` は、任意の `PolicyValuePredictor` を
`TrainingPolicy` に変換する同期推論 adapter を提供する。`TinyPolicyValueNetwork` と
`policy-bootstrap` は replay batch の loss 評価に加え、自然終局 value を advantage にした
policy/value head 更新、gradient clipping、versioned checkpoint の atomic 保存・再開を行う。
`effect-debug-harvest` は checkpoint SHA と deterministic epsilon exploration を記録して
学習済み `policy` agent を再現できる。通常のcoverage探索は `policy` 対 `random` と
least-covered cardを注入するdeckを使い、計算量の大きいMCTSは別stress cohortへ分離する。
elapsed-time capはdebug用のadaptive retryを行う。この経路を固定評価の成功証拠にせず、
本番評価は未完了/capped/errorも元の試行分母へ残す。

## 次タスクの正源

[ISMCTS program](../30_plan/ismcts-full-run/README.md)のI0〜I7で実装・検証する。
body更新・checkpoint再開・自律学習・三モデル分離・簡易AI復帰も同programへ集約する。
過去cohortは現行の受入証跡へ昇格させない。構築PSROは今回の完了条件外。
