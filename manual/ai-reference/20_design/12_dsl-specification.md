# DSL 仕様（4軸構造）

## 目的

カード効果定義の構造解説。型の正源は [dsl-types.ts](../../../packages/rules-core/src/dsl-types.ts) と [model.ts](../../../packages/rules-core/src/model.ts)、ルール上の意味は関連する `10_rules`・原文・Q&A。実装が根拠と食い違う場合は、不一致を調べて修正する。

## 設計原則

### 4軸構造

カードテキスト分析から発見された4軸構造を型で表現する。

| 軸 | 名前 | 役割 | 例 |
|---|---|---|---|
| 軸1 | **Applicability** | カードの存在ゾーン・状態 | 手札にあるこのカードは / Lv2-Lv3 / 合体中 / 魂状態 |
| 軸2 | **Timing** | いつ発動するか | 召喚時 / アタック時 / フラッシュ / 常時 / バースト |
| 軸3 | **Condition** | 追加のゲーム状態条件 | カウント3以上 / 手札5枚以下 / 回復状態 |
| 軸4 | **Effect** | 何をするか（アクション列） | 破壊 / ドロー / コア移動 / BP増減 |

### 汎用性

- 特定カードの専用表現を避け、直交する軸の組み合わせであらゆるカードテキストを表現する
- 列挙値の直積（player × event 等）で組み合わせ爆発を防ぐ
- フィルタの合成（`filterOr`, `exclude`）で複合条件を構築する
- 新カードの追加が既存型の変更を要しないことを目指す

### 原文忠実性

- **effects はカードテキスト（textLines）の正確な構造化表現でなければならない。** 近似・簡略化・スキップは禁止。
- テキストの各文が DSL のどの軸・アクション・条件に対応するかを 1:1 で追跡可能にする（`textRef` でインデックス参照）。
- DSL で表現できない効果パターンに遭遇した場合、stub で妥協するのではなく **DSL 型・インタプリタを拡張して対応する**。stub はあくまで拡張完了までの一時的なマーカーであり、残留させない。
- 定期的に effects vs textLines の監査を行い、不一致（textRef ズレ、値の誤り、解釈の乖離）を検出・修正する。全 nonblank `textLines` の structural / semantic accountability は [12a_text-accountability-ledger.md](./12a_text-accountability-ledger.md) を参照。

### 直交拡張性

型拡張は以下の原則に従う:

1. **既存フィールドの意味を変えない** — 既存データの意味を保ち、必要な表現力は共有できる型・アクションへ追加する。`Effect` へカード専用フィールドを足さない。
2. **直交する軸は独立に拡張する** — Timing の拡張が Condition や Effect の変更を要求しないようにする（例: `timingScope` は Timing と直交するスコープ軸として独立追加）。
3. **共有メカニズムは ID ベースで接続する** — 異なる Effect 間の制約共有は、構造の入れ子ではなく `limitGroupId` のような ID 参照で実現する。
4. **後方互換を確認する** — 型の互換性だけでなく、既存カードの登録・合法手・解決・再開の回帰を確認する。

## ソースファイル

型定義の正源は [dsl-types.ts](../../../packages/rules-core/src/dsl-types.ts)（CardFilter / TargetSpec / Action / EffectStep / Effect等）と、そこから参照する [model.ts](../../../packages/rules-core/src/model.ts)（Timing / ConditionClause等）。以下の表は読み方の例であり、全フィールド・全変種の複製ではない。

旧 DSL v2 設計スナップショット（`manual/_legacy/dsl-v2-design/` 配下）は P3-12 以前の初期設計で参考のみ。詳細は [archive/2026-04-25-extracted-from-12_dsl-specification.md](./archive/2026-04-25-extracted-from-12_dsl-specification.md) 参照。

## 型の概要

### 基盤型（foundation）

| 型 | 用途 |
|---|---|
| `CardCategory` | カードのカテゴリ |
| `CardColor` | カード色 |
| `PlayerRef` | 効果の文脈におけるプレイヤー参照 |
| `Zone` | ゲーム内ゾーン（deck, hand, field, trash, burst, mirage 等） |
| `Count` | 数量指定（固定値 / `"all"` / 範囲 `{ min, max? }` / `DynamicCount`）。`max>min` は multi-select として legal action へ展開 |
| `Amount` | 数値指定（固定値 / `DynamicCount`） |
| `DynamicCount` | 動的数値参照。集計元は `DynamicCountSource`、変換・比較は現行型と数量解決処理を参照 |
| `Duration` | 効果の持続期間（scope × whose × turns × next） |
| `CardFilter` | 統一カードフィルタ。名前・対象範囲の解釈は関連ルールと共通フィルタで確認 |
| `TargetSpec` | 対象指定（`self` / `filter` / `ref`） |
| `CoreLocation` | コアの場所（void, reserve, trash, life, field, this_card 等） |

### 軸1: Applicability

カードがどこにいて、どのような状態か。テキストに明示された前提条件がある場合のみ指定。ゲームルールから推定できるデフォルトゾーン（スピリットの "field"、マジックの "hand" 等）は省略する。

具体的なフィールドは `dsl-types.ts` の `Applicability` を参照する。ここに部分的なinterfaceを複製しない。

### 軸2: Timing

いつ発動するか。`Timing.kind` の判別タグで表現する。以下は主な使い分け。

| kind | 用途 | 例 |
|------|------|-----|
| `continuous` | 常時適用 | 「シンボルは赤としても扱う」 |
| `card_event` | 自身のイベント | `effectSourceEvents` 指定時は継承元自身が主語（発揮元・回数制限は不変）。`deferredTo` で遅延可 |
| `game_event` | 他カード/プレイヤーのイベント | `triggerFilter` でトリガーカードの条件を指定可 |
| `phase` | フェーズ誘発 | 「自分のアタックステップ開始時」 |
| `activated` | 起動効果（main/flash/stack） | `deferredTo` でバトル終了時等に遅延可 |
| `burst` | バースト | `BurstTrigger` で構造化された発動条件（life_decrease / spirit_destroyed 等） |

`timingScope`（TimingScope 型）は timing と直交する「誰のいつ」スコープ。continuous 効果をメインステップ限定にする等の用途。

### 軸3: Condition

軸1・軸2が満たされた上で必要な追加ゲーム状態条件。`ConditionClause[]` の AND 結合。

主なclauseの用途（全定義は `model.ts` の `ConditionClause`、評価は [structured-condition-eval.ts](../../../packages/rules-core/src/effect/structured-condition-eval.ts) の `evaluateCondition()`）:

| kind | 用途 |
|------|------|
| `self_state` | 自カードの状態（recovered/exhausted） |
| `self_soul_state` | 自カードが魂状態 |
| `self_color_count` | 自カードの色数（min/max） |
| `min_level` | 自カードの最低 Lv |
| `combined` | 自カードが合体中 |
| `field_has` / `field_lacks` | 指定プレイヤーの zone に条件合致カードの存在/不在（`grandwalkerKind` で導界者分離、`minCount` / `maxCount`、`minCores`、`excludeSelf` 対応） |
| `hand_count` / `count_value` / `life_value` | 手札枚数 / カウント / ライフの範囲比較 |
| `no_contract_card` | 契約カード不在 |
| `no_same_name_on_field` | 同名カード不在 |
| `trigger_colors` / `trigger_from_zone` | トリガーカードの色 / 元ゾーン |
| `colors` / `tribes` | 自カードの色 / 系統 |
| `in_battle` | バトル中（`state` で attacking / blocking 指定可） |
| `grandwalker_core_count` | 創界神コア数（神域） |
| `flash_used` | フラッシュ効果の使用/発揮履歴参照。`target` / `scope` / `player` / `negate` / `cardFilter` で絞る |

### 軸4: Effect（アクション）

`Action` は操作の `kind` ごとに必要な引数を持つ判別union。現在の種類と引数は `dsl-types.ts` の `Action` と各アクション型から辿る。
カード移動、コア移動、継続修飾、状態変更、戦闘制御などを `EffectStep` で組み合わせる。件数・全変種一覧はここに複製しない。
[戻し先選択・回復制限・召喚対価の補足](12a_dsl-zone-recovery-cost.md)も参照する。

`treat_as` 補足: `appliesToCard:true` は「このカード/<実体種類>」等の自己カード側にも効く修飾。
「このカードの軽減シンボル」だけの型は `cardStateOnly:true` を併用する。
非フィールド、魂状態、煌臨元/その他 under card はカード状態として直接読みで反映し、
場の実体状態（スピリット/アルティメット/ブレイヴ/ネクサス等）には継続 CE を登録しない。
`reductionSymbolBaseColors` で「赤の軽減シンボルだけ」等の印字軽減色フィルタを表す。

### 効果構造

`Effect` は applicability・timing・conditionと `steps` を結び、使用回数・発動コスト・本文参照などを持つ。
利用できるフィールドと省略時の意味は型定義を確認する。実行可能な定義例は [effect-interpreter.test.ts](../../../packages/rules-core/test/effect-interpreter.test.ts) などの回帰テストから選び、対象カードの原文へ合わせる。

`executionMode`: 「する」= `"mandatory"`（既定）、任意文= `"optional"`。`triggerPriority:"immediate"` は「ただちに」型。正源: [03c](../10_rules/03c_effect-text-interpretation.md)、[02](../10_rules/02_turn-flow-and-timing.md)。

`EffectStep.prompt` は step pending 表示メタ。未指定なら自動生成。任意文/`choice` が複数ある効果は `sourceText` を補う。

`CardEventDisposition`: `move` / `summon` / `remove_from_game` / `steps_only`（steps 内完結）。

### EffectStep と接続

1つの Effect 内の複数アクションは `EffectStep[]` で表現し、`connector` で接続関係を示す。

接続語の意味は [効果テキストの解釈](../10_rules/03c_effect-text-interpretation.md)、離脱と後続処理の境界は [離脱成立](../10_rules/04e_leave-outcomes-and-trigger-eligibility.md)・[効果発揮後とバースト](../10_rules/04b5_after-effects-and-burst.md) に従う。
`simultaneous` / `sequential` / `after_triggers` / `conditional_cost` / `conditional_result` / `unless_previous_succeeded` の処理は [インタプリタ](../../../packages/rules-core/src/effect/effect-interpreter.ts) と関連回帰で確認する。

`after_triggers` は単なる `sequential` の別名ではない。誘発・離脱処理と後続stepの継続を扱う。
境界の回帰は [after-triggers-connector.test.ts](../../../packages/rules-core/test/after-triggers-connector.test.ts) と [after-triggers-stay-flush-gap.test.ts](../../../packages/rules-core/test/after-triggers-stay-flush-gap.test.ts)。テストの存在だけで、変更後の全経路が検証済みとはしない。

ステップ間の参照は `id` / `stepId` で行う（例: `{ kind: "ref", stepId: "recover_targets" }`）。

`EffectStep` は `condition` / `stepCondition` / `retrigger` / `choice` / `chooser` / `usageLimit` を個別設定可能。

### StepCondition（前ステップ結果条件）

`stepCondition` は効果内の後続ステップの実行可否を、前ステップの結果で判定する。

| kind | 用途 |
|------|------|
| `ref_has_color` | 前ステップ結果のカードに指定色が含まれる（`minCount`/`maxCount` で枚数比較） |
| `ref_has_match` | 前ステップ結果のカードがフィルタに合致する（`minCount`/`maxCount` で枚数比較） |
| `ref_succeeded` | 前ステップが成功した（1枚以上処理された） |
| `ref_count` | 前ステップで影響を受けた件数比較（`min`/`max`） |
| `ref_choice` | 前ステップで選ばれた choiceIndex 参照（D-2 Phase 1） |

表は代表例。変種と否定の指定は `dsl-types.ts` の `StepCondition` を確認する。

### 破壊時効果抑制（suppressDestroyedEffects）

`DestroyAction.suppressDestroyedEffects` で破壊されたカードの効果の**発揮**を抑制する。これは破壊イベントから派生する一回限りの抑制で、カードの使用/バースト発動そのものは止めない（バーストはカード公開・消費まで進むが効果は空）。

| 値 | 抑制範囲 | カードテキスト例 |
|---|---------|----------------|
| `"destroyed_only"` | 破壊されたカード自身の効果のみ（バースト・他カードの誘発は抑制しない） | 「この効果で破壊したスピリット/アルティメットの効果は発揮されない」 |
| `"all_opponent"` | 破壊に起因する相手の一切の効果（離場時 + バースト + 他カードの誘発） | 「この効果の破壊によって相手の一切の効果は発揮されない」 |

実装: `PendingLeaveEntity` → `CollectedTriggerEvent` → `PendingTriggeredEffect` / `PendingBurstCheck` に抑制フラグ伝播、破壊起因抑制として `legal-actions-apply.ts` 解決時に resolver スキップ。

継続的な「発揮させない」は別系統の `suppress_effect`（`effect_suppression` CE）。`effectFilter` 省略でカードの**全効果**を抑止（blanket）、指定で一致効果のみ抑止。フィールドに実体を持つカード効果（誘発/battle-immediate/field activated）は使用/バースト発動ではないため、`executeReevaluationCheck` を SSOT として queue / 発揮宣言入口で gate し、既存 pending/prompt は drain する。解決中に抑制状態が変化する場合は `runReevaluationAtTiming` の `effect_suppression` チェックでも honor する（破壊起因の一回限り抑制とは独立）。

### 条件付き再発火（retrigger）

`EffectStep.retrigger` を設定すると、アクションを即時実行せず、指定イベント発生時に再発火する登録を行う。`RetriggerConfig`: `event` (CardEventType, "attack"/"block" 等) / `triggerPlayer?` (PlayerRef, "self" 省略時) / `triggerFilter?` (CardFilter) / `maxCount?` (省略時無制限) / `duration?` (省略時 `{ scope: "turn" }`)。

実行フロー: インタプリタ → `ContinuousEffect`（`modifierTag: "retrigger"`）として `activeContinuousEffects` に登録 → アタック宣言時に `executeMatchingRetriggers()` → `retriggerMaxCount` 到達で自動除去 → ターン/バトル終了時に `removeExpiredContinuousEffects` で期限切れ除去（P3-15 問題6、2026-04-17 で CE 基盤に統合）。`RetriggerEffect` 型は `ContinuousEffect` の型エイリアスとして後方互換のため保持。

### カード副構造（キーワードメカニクス）

メカニクス別カード副構造型は `model.ts` に定義（`AccelData` / `ChangeData` / `MirageData` / `AdventData` / `RebirthData` / `GrandwalkerData` / `ContractData` 等）。DSL 側では `CardFilter.hasMechanic` で参照する。

ルールの短縮版をここへ複製せず、各章から参照する。

| メカニクス | ルール・実装設計の入口 |
|---|---|
| アクセル・チェンジ | [08b](../10_rules/08b_accel-change-zero-counter.md) |
| ミラージュ | [08c](../10_rules/08c_imagin-mirage-grandwalker.md)（表向きセットと【セット中】効果） |
| 煌臨・転醒 | [08a](../10_rules/08a_advent-rebirth-contract.md) |
| 契約 | [08a2](../10_rules/08a2_contract.md)（ゲーム開始時の提示・手札への追加、魂状態） |
| 創界神・導界者 | [08d](../10_rules/08d_grandwalker-nexus.md) |

## 実装ファイル

型から登録・合法手・解決までの入口は [構造化効果の実装ナビゲーション](11_structured-effect-model.md)。対応率・未実装状態は本書に複製しない。型への移行と全カードの意味的な実装完了は別に確認する。

### 過去の型拡張

DSL 表現力不足を解消するため実施した主な拡張ログは [archive/2026-04-25-extracted-from-12_dsl-specification.md](./archive/2026-04-25-extracted-from-12_dsl-specification.md) に退避。現行型は `dsl-types.ts` を参照。

既存の設計判断は [P3-14の履歴](../../../issues/archive/P3-14/index.md) とgit履歴から辿る。新しいギャップは現在の作業で解消を試み、残作業の記録はCLAUDEの課題管理に従う。

## 関連文書

- [11_structured-effect-model.md](11_structured-effect-model.md) — 実装と回帰への入口
- [04_card-addition-decision-table.md](/manual/ai-reference/28_policy/04_card-addition-decision-table.md) — カード追加時の判定表
- [08a_advent-rebirth-contract.md](/manual/ai-reference/10_rules/08a_advent-rebirth-contract.md) — 煌臨/転醒/契約のルール＋実装設計
