# Engine Architecture

## エンジン構成

最小でも次の 5 層に分ける。

1. `card-data`
   - カード定義、タグ、ソースURL
2. `rule-core`
   - ステップ遷移、合法手列挙、状態ベースチェック
3. `effect-resolver`
   - 効果解決、派生効果、待機状態、遅延移動
   - battle だけでなく、マジック、field effect、召喚/配置時効果、開始時/終了時効果を含む全 timing / step の trigger を扱う
4. `application-api`
   - プレイヤー/AI が叩く入力窓
5. `presentation`
   - UI、ログ、リプレイ、AI向け状態要約

## アクション設計

単発の `useMagic()` ではなく、段階的入力に寄せる。

### 推奨アクション

- `declare_action`
- `select_mode`
- `pay_cost`
- `select_targets`
- `choose_resolution_order`
- `confirm_commit`
- `pass_priority`

## API の持ち方

### 選択肢 1: 分割エンドポイント

- `POST /actions/declare`
- `POST /actions/pay-cost`
- `POST /actions/select-targets`
- `POST /actions/choose-order`
- `POST /actions/commit`

利点:

- クライアント/AI の入力が分かりやすい。

欠点:

- 往復が増える。

### 選択肢 2: ステートマシン型

- `POST /actions`
- レスポンスで
  - `nextRequiredInput`
  - `legalOptions`
  - `partialState`
  を返す。

利点:

- AI との相性がよい。
- 入力窓追加に強い。

推奨:

- 最初はステートマシン型。

## 現状の最小 action 層

- `useMagicCardAsAction()` は、マジック 1 枚分の宣言から解決までを直接通す。
- `useFieldCardEffectAsAction()` は、`spirit / nexus / system` source の field-card effect を直接通す。
- `runActionMainResolution()` は、`queue -> resolver -> SBA -> pendingTriggeredEffects / pendingBurstChecks staging -> flush` の共通 helper として置き、battle action や支払い付き field action でも流用できるようにする。
- `getLegalActions()` / `applyLegalAction()` は、application-api へ寄せるための最小層として置く。
  - 現時点では 31 種の legal action を返す。用途別に分類:
    - **カード使用系**: `summon` / `place_nexus` / `brave_combine` / `brave_separate` / `brave_swap` / `use_magic` / `use_accel` / `use_change` / `set_burst` / `set_mirage` / `use_field_card_effect` / `use_divine_skill`（神技/導技/界放/契約技）
    - **バトル系**: `attack` / `block` / `open_battle_flash` / `pass_battle_flash` / `start_battle_resolution` / `resolve_battle_resolution` / `end_attack_step`
    - **スタック窓パス**: `pass_main_step_stack` / `pass_pre_declaration_stack`
    - **保留解決系**: `resolve_battle_immediate_effect` / `resolve_pending_triggered_effect`（神託/解封/創界石転醒の mechanic 付き誘発もここで解決 — P3-92）/ `resolve_pending_burst_check` / `resolve_pending_deck_reveal_pick` / `resolve_pending_deck_reveal_order` / `resolve_pending_zone_selection` / `resolve_pending_core_shoot` / `resolve_pending_core_split` / `resolve_placement_oracle`（配置時神託）
  - field-card effect action には `kind`、`reason`、`sourceKind`、`sourceInstanceId`、`requiredTargetCount`、`candidateTargetInstanceIds` を持たせる。
  - 可変選択（multi-select）対応の legal action は追加で `maxTargetCount?: number` を持つ。`max>required` のときに `[required, max]` 範囲で対象を選択可能（P3-14 D-2 Phase 2）。`min===max` または `max` 未設定は固定数。`min=0, max>0` は任意選択（0 体〜N 体）。
  - さらに、ライフ混在の generic 効果向けに `availableChosenLifeCoreKinds` と `requiresChosenLifeCoreKind` を返す。
  - hand card action には `reducedCost`、`availableReserveCoreAmount`、`availableOnBoardCoreSources`、`availableSoulCoreOnlySources` を持たせ、後続の召喚/配置 runner がそのまま使えるようにする。
  - hand card action でも `targetMode`、`requiredTargetCount`、`targetEffectFilterTags`、`candidateTargetInstanceIds`、`availableChosenLifeCoreKinds`、`requiresChosenLifeCoreKind` を持てるようにし、召喚/配置後の self-effect で target や life-core choice が必要なケースを表現する。
  - さらに `enterFieldCorePlacementRule` を持たせ、通常の `required_minimum / optional` に加えて、創界神グランウォーカー / 創界石グランストーン系のような `forbidden` 例外を legal action から判別できるようにする。
  - さらに `minimumEnterFieldCoreCount` / `maximumEnterFieldCoreCount` を持たせ、cardNo ごとの hand-written placement policy で `just 1 core` のような個別例外も action 列挙へ反映できるようにする。
  - 実行時は、`use_field_card_effect` を `useFieldCardEffectAsAction()` へ、`resolve_battle_immediate_effect` を `useBattleImmediateEffectAsAction()` へ、`summon` / `place_nexus` を `useSummonAsAction()` / `usePlaceNexusAsAction()` へ、`attack` / `block` を `useAttackAsAction()` / `useBlockAsAction()` へ委譲する。
  - `attack` はまず宣言段階だけを切り出し、`window=declare_attack` と `battleEntity.attackState=attacking` を更新する最小 runner から始める。
    - `attack` / `block` 宣言後に battle 中即時効果がある場合は、`battleImmediateEffects` に prompt を積み、`resolve_battle_immediate_effect` legal action で prompt を持つ側が順を選んで解決する最小入口を置く。
  - `block` もまず宣言段階だけを切り出し、`window=declare_block` と `battleEntity.attackState=blocking`、`activeAttack.blockAssignments` の更新を行う最小 runner から始める。
  - 複数体同時アタックや「アタック中のスピリットに別のスピリットが参加する」効果を見据え、`attack` 宣言後は `activeAttack` を作り、その中で `BattleEntity` を participant として束ねる。
  - 現在は `joinActiveAttackAsAction()` を direct helper として持ち、effect resolver 側から `activeAttack` へ participant を足せる土台がある。
  - `BattleEntity` 自体は合体済みスピリットなどの戦闘主体を表し、`activeAttack` 側で主攻撃側、target 指定、ブロック結果、シンボル解決順、途中参加メンバーを管理する方が既存の軽減計算と衝突しにくい。
  - 現在の `blockAssignments` は `participant -> blocker 1体` の軽量表現で実 action までつながっている。
  - official の既知ケースではこれで足りる。custom で「1体の participant に複数 blocker」が起こる場合は `blockAssignments` を list 化する。
  - hand card action 実行には `paymentSources` と `enterFieldCorePlacements` を追加入力として渡す。
  - `getHandWrittenEnterFieldCorePlacementPolicy(cardNo)` を渡し、タグだけで表せない個別配置例外も runner と legal action の両方で共有する。
  - 既定経路では shared enter-field placement registry を参照し、必要なときだけ外から lookup を差し替える。
  - さらに、summon/place 後の self-effect を通すために、`targetInstanceIds`、`chosenLifeCoreKind`、`getHandWrittenEffectResolver(cardNo)` も hand card action に渡す。
  - 直後コア配置は、`cost payment` と別入力として持つ。
  - 追加選択が必要なときは、`chosenLifeCoreKind` のような入力を `applyLegalAction()` から resolver 層へ渡す。
- この union に `system_action`、`attack`、`core_move` などを足す。
