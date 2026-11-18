# Engine Architecture

## エンジン構成

最小でも次の 5 層に分ける。

1. `card-data`
   - カード定義、タグ、ソースURL
2. `rules-core`（パッケージ名は `packages/rules-core`）
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

> 以下の「推奨アクション」「API の持ち方」は初期の設計案。現行実装は後者の選択肢 2 に近い形で、`getLegalActions()` が合法手を列挙し `applyLegalAction()` が 1 手ずつ適用する。`declare_action` / `select_mode` / `choose_resolution_order` / `confirm_commit` / `pass_priority` や応答の `nextRequiredInput` / `partialState` という名前は実装に存在しない。追加入力は各 `LegalAction` の `kind` ごとの専用 action（例 `resolve_pending_*`、同時誘発の順選択は `select_pending_to_resolve`、パスは `pass_stack` / `pass_battle_flash`）で表す。

### 推奨アクション（設計案）

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

- `playMagicCardAsAction()`（`mechanics/magic-system.ts`）は、マジック 1 枚分の宣言から解決までを直接通す。
- `useFieldCardEffectAsAction()` は、`spirit / nexus / system` source の field-card effect を直接通す。
- `runActionMainResolution()` は、`queue -> resolver -> SBA -> pendingTriggeredEffects / pendingBurstChecks staging -> flush` の共通 helper として置き、battle action や支払い付き field action でも流用できるようにする。
- `getLegalActions()` / `applyLegalAction()` は、application-api へ寄せるための最小層として置く。
  - 返す legal action の種別は `legal/legal-actions-types.ts` の `LegalAction` union が正源（件数はここに複製しない。90 種超）。用途別の代表:
    - **カード使用系**: `summon` / `place_nexus` / `brave_combine` / `brave_separate` / `brave_swap` / `use_magic` / `use_accel` / `use_change` / `set_burst` / `set_mirage` / `set_quartz` / `use_field_card_effect` / `use_hand_card_effect` / `use_divine_skill`（神技/導技/界放/契約技）/ `declare_advent` 等の煌臨・顕現宣言
    - **バトル系**: `attack` / `block` / `decline_block` / `join_active_attack` / `open_battle_flash` / `pass_battle_flash` / `end_attack_step`。バトル解決は `executeBattleResolution()` に自動で進む。ブロックが0件で `decline_block` した場合と、ブロック成立後の後半フラッシュ終了が主な入口
    - **スタック窓パス**: `pass_stack` / `pass_pre_declaration_stack`
    - **保留解決系**: `resolve_battle_immediate_effect` / `resolve_pending_triggered_effect`（神託/解封/創界石転醒/配置時神託の mechanic 付き誘発もここで解決 — P3-92）/ `select_pending_to_resolve` / `resolve_pending_burst_check` / `resolve_pending_deck_reveal_pick` / `resolve_pending_deck_reveal_order` / `resolve_pending_zone_selection` / `resolve_pending_core_shoot` / `resolve_pending_core_split` / `resolve_pending_enter_field_placement` ほか多数
  - field-card effect action には `kind`、`reason`、`sourceKind`、`sourceInstanceId`、`requiredTargetCount`、`candidateTargetInstanceIds` を持たせる。
  - 可変選択（multi-select）対応の legal action は追加で `maxTargetCount?: number` を持つ。`max>required` のときに `[required, max]` 範囲で対象を選択可能（P3-14 D-2 Phase 2）。`min===max` または `max` 未設定は固定数。`min=0, max>0` は任意選択（0 体〜N 体）。
  - さらに、ライフ混在の generic 効果向けに `availableChosenLifeCoreKinds` と `requiresChosenLifeCoreKind` を返す。
  - hand card action には `reducedCost`、`availableReserveCoreAmount`、`availableOnBoardCoreSources`、`availableSoulCoreOnlySources` を持たせ、後続の召喚/配置 runner がそのまま使えるようにする。
  - hand card action でも `targetMode`、`requiredTargetCount`、`targetEffectFilterTags`、`candidateTargetInstanceIds`、`availableChosenLifeCoreKinds`、`requiresChosenLifeCoreKind` を持てるようにし、召喚/配置後の self-effect で target や life-core choice が必要なケースを表現する。
  - さらに `enterFieldCorePlacementRule` を持たせ、通常の `required_minimum / optional` に加えて、創界神グランウォーカー / 創界石グランストーン系のような `forbidden` 例外を legal action から判別できるようにする。
  - さらに `minimumEnterFieldCoreCount` / `maximumEnterFieldCoreCount` を持たせ、`just 1 core` のような個別例外も action 列挙へ反映できるようにする。規則・個数は `getEnterFieldCorePlacementPolicy()`（`zone/enter-field-placement-policy.ts`）がカード定義と `keywordTags` の `enter_field_core_placement_*` タグから導く（手書きの cardNo 別 policy 関数は無い）。
  - 実行時は、`use_field_card_effect` を `useFieldCardEffectAsAction()` へ、`resolve_battle_immediate_effect` を `useBattleImmediateEffectAsAction()` へ、`summon` / `place_nexus` を `playSummonAsAction()` / `placeNexusAsAction()`（`play/play-card-system.ts`）へ、`attack` / `block` を `useAttackAsAction()` / `useBlockAsAction()` へ委譲する。
  - `attack` はまず宣言段階だけを切り出し、`window=declare_attack` と `battleEntity.attackState=attacking` を更新する最小 runner から始める。
    - `attack` / `block` 宣言後に battle 中即時効果がある場合は、`battleImmediateEffects` に prompt を積み、`resolve_battle_immediate_effect` legal action で prompt を持つ側が順を選んで解決する最小入口を置く。
  - `block` もまず宣言段階だけを切り出し、`window=declare_block` と `battleEntity.attackState=blocking`、`activeAttack.blockAssignments` の更新を行う最小 runner から始める。
  - 複数体同時アタックや「アタック中のスピリットに別のスピリットが参加する」効果を見据え、`attack` 宣言後は `activeAttack` を作り、その中で `BattleEntity` を participant として束ねる。
  - 現在は `joinActiveAttackAsAction()` を direct helper として持ち、effect resolver 側から `activeAttack` へ participant を足せる土台がある。
  - `BattleEntity` 自体は合体済みスピリットなどの戦闘主体を表し、`activeAttack` 側で主攻撃側、target 指定、ブロック結果、シンボル解決順、途中参加メンバーを管理する方が既存の軽減計算と衝突しにくい。
  - `blockAssignments` は participant ごとに `blockedByEntityIds: string[]` を持ち、通常は 0〜1 件、`require_multi_block` CE（BSFT01-TR06(B) 型）が有効なときは複数 blocker を扱う（P2-05 Phase 5 完了、[05b](../10_rules/05b_multi-attack-designated-attack-lifecap.md)）。
  - hand card action 実行には `paymentSources` と `enterFieldCorePlacements` を追加入力として渡す。
  - 配置 policy は上記 `getEnterFieldCorePlacementPolicy()` を runner と legal action の両方で共有する。
  - さらに、summon/place 後の self-effect を通すために、`targetInstanceIds`、`chosenLifeCoreKind`、`getHandWrittenEffectResolver`（cardNo→手書き resolver の互換 lookup。未登録なら DSL の steps へ fallback）も hand card action に渡す。
  - 直後コア配置は、`cost payment` と別入力として持つ。
  - 追加選択が必要なときは、`chosenLifeCoreKind` のような入力を `applyLegalAction()` から resolver 層へ渡す。
- `system_action` や `core_move` は `LegalAction` ではなく別経路（例: ルームの `POST /api/room/:id/core-move`、詳細は [02b](02b_api-and-presentation.md)）で扱う。
