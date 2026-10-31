// ============================================================
// DSL 型定義
// ============================================================
//
// 構造解説: manual/ai-reference/20_design/12_dsl-specification.md
//
// 既存型（CardCategory, CardColor, SymbolColor, Zone, Step, Duration,
// Timing, Condition, ConditionClause 等）は model.ts から再利用する。
// このファイルは DSL で新規に導入される型のみを定義する。

import type {
  CardCategory,
  CardZone,
  CardColor,
  CardEventType,
  SymbolColor,
  SymbolDynamicSource,
  Zone,
  Duration,
  EffectActivationSourceZone,
  EffectActivationTiming,
  EffectPlayerRef,
  MechanicName,
  PendingLeaveKind,
  TriggerPriority,
  TimingScope,
} from "./model";
import type { EffectSourceKind } from "./source-kinds";

// ============================================================
// PlayerRef — EffectPlayerRef のエイリアス
// ============================================================

/** EffectPlayerRef のエイリアス。 */
export type PlayerRef = EffectPlayerRef;

// ============================================================
// DynamicCount / Count / Amount
// ============================================================

/**
 * ゲーム状態に基づく動的な数値参照。
 * 「その中の紅魔カード1枚につき」「自分のスピリットの数×1000」等。
 */
/**
 * `DynamicCount` の集計ソース。盤面の枚数・コア数・カウント値・イベント量等を
 * 数値へ落とす単位。`DynamicCount.source` と `DynamicCount.subtract` で共用する（SSOT）。
 */
export type DynamicCountSource =
  | {
      kind: "cards_in_zone";
      zone: Zone;
      player: PlayerRef;
      filter?: CardFilter;
    }
  | {
      kind: "cards_from_ref";
      stepId: string;
      filter?: CardFilter;
      /**
       * after_triggers で記録された離脱種別に一致する参照カードだけを数える。
       * 「この効果で消滅した対象1体につき」型では `leaveKind:"vanish"` の
       * ref_left_field と同じ根拠を、数量側でも使う。
       */
      leftFieldKind?: PendingLeaveKind;
      /** 実移動・残留処理より前に成立した離脱結果で数える。 */
      establishedLeaveKind?: PendingLeaveKind;
      /**
       * 参照する StepResult フィールドの選択。省略時は既定の `affectedCardInstanceIds`
       * (deck_reveal では hand-added 側、`ref` TargetSpec 等と同じ既存挙動)。
       * `"revealed"` 指定時は `revealedCardInstanceIds`（deck_reveal でオープンされた
       * カード全体。pick 結果に関係なく「その中の X 1枚につき」を数える、BSLH01-C14 型）
       * を参照する。`StepCondition.ref_count.result` と同型の選択子 (SSOT)。
       */
      result?: "revealed";
    }
  /**
   * 前ステップの affected カード（filter 絞り込み可、複数マッチ時は合算）のコスト値を
   * 集計する。`cards_from_ref` が「枚数」を数えるのに対し、こちらは「カード自身の
   * コスト数値」を合算する。「戻したアルティメットの本来のコスト1につき、コアを置く」
   * (BSAZ02-C18) のような、参照カードのコストをそのままスケール源にする型に使う。
   */
  | {
      kind: "cost_from_ref";
      stepId: string;
      filter?: CardFilter;
      /**
       * 本来コスト(printed) か実効/追加コスト込みか。既定 = "printed"
       * （「本来のコスト」原文の慣例的な既定、CardFilter.costBasis と同じ語彙）。
       */
      costBasis?: "effective_or_additional" | "printed";
    }
  /**
   * 前ステップ群（複数 stepId の合算、破壊を category 別に別 step で実行するケース向け）で
   * 参照されたカードの実効シンボル数（合体ブレイヴ等の追加分を含む）を合計する。
   * `cost_from_ref` の姉妹ソース（コストではなくシンボル数を集計）。「破壊した
   * スピリット/アルティメット/ネクサスのシンボル2つにつき」(BSSG01-X03) のような、
   * 複数カテゴリを別 step (spirit/ultimate 破壊 + nexus 破壊) に分けて実行した結果を
   * 合算してスケール源にする型に使う。
   */
  | {
      kind: "symbol_count_from_ref";
      stepIds: string[];
      filter?: CardFilter;
    }
  | { kind: "selected_targets"; stepId?: string }
  | { kind: "trigger_related_instances" }
  /**
   * トリガーが観測した related instance の「件数」をそのまま数える。
   * `trigger_related_instances` (TargetSpec 解決と同じ zone==="field" &&
   * pendingLeaveKind===null フィルタ付き) と異なり、フィールド離脱後の対象も含めて
   * 数える。「対象1体につき」(leave_field 等、対象が既にフィールドを離れている型) の
   * スケール源に使う。同時発生バッチは trigger-system.ts の
   * relatedInstanceIdsBySourceRegistrationKey で単一 pending に集約済みのため、
   * ここでは stepContext.triggerRelatedInstanceIds の長さを返すだけでよい。
   * context 依存種別のため継続修飾 (stateless) では 0 を返す。
   */
  | { kind: "trigger_related_instances_count" }
  | { kind: "cores_on"; location: CoreLocation }
  | { kind: "count_value"; player: PlayerRef }
  /**
   * `GameState.declarationCountThisTurn[player]`（declare_gimmick primitive の
   * SSOT、ターン遷移時にリセット）をそのまま数える。「このターン中に効果で
   * 「エンジョ〜イ、みっしぃ！」と宣言した回数1につき」(BSLH01-R04) 型のスケール源。
   * stateless（cards_in_zone 等と同じ evaluateStatelessSourceCount 委譲、継続修飾でも解決可能）。
   */
  | { kind: "declaration_count_this_turn"; player: PlayerRef }
  | { kind: "event_amount" }
  | { kind: "cost_paid_this_effect" }
  /**
   * 同一 effect 内の前段 step (`count_decrease`/`count_increase`) で実際に解決された
   * 数量を参照する（「減らしたカウント1につき」型のスケール、BSGE01-M02 等）。
   * `StepResult.numericAmount` を stepId で引く。対象 step が未実行/対象外の action kind
   * なら 0。
   */
  | { kind: "step_numeric_amount"; stepId: string }
  /**
   * 効果発動元カードに合体しているブレイヴの数。
   * 「この効果をこのスピリットのブレイヴの数まで追加で発揮できる」(BSAZ01-X02) 等の
   * 反復回数源。フィールド上で発動元 (`StepExecutionContext.sourceInstanceId`) に
   * 合体している (`attachedToInstanceId === source`) printedCategory:"brave" のカード数を数える。
   * context 依存種別のため継続修飾 (stateless) では 0 を返す。
   */
  | { kind: "braves_on_source" }
  /**
   * 効果発動元カードの実効コスト。発動元が合体スピリットなら合体中ブレイヴの
   * 実効コストも合算し、「このスピリットのコスト合計まで」型の予算量に使う。
   */
  | { kind: "source_effective_cost" }
  /**
   * 効果発動元カードの実効 BP。合体スピリットなら合体中ブレイヴの BP+ も合算し、
   * 「BP合計(このスピリットのBP)まで」型の予算量に使う。
   */
  | { kind: "source_effective_bp" }
  /** 効果発動元の実効Lv。Lv変更・最高Lvとして扱う効果を反映する。 */
  | { kind: "source_effective_level" }
  /**
   * 自分（または指定プレイヤー）のフィールドカード（`filter` で絞り込み）の実効 BP 合計。
   * `getCombinedUnitBp` (SSOT) の総和で、bp_modifier CE・合体ブレイヴ由来の加算等を反映済み。
   * 「自分のスピリットすべての合計BPまで、相手を好きなだけ破壊する」(BSAZ01-C11) の
   * 予算量として `TargetSpec` (filter variant) の `budget.amount` から参照する用途が主。
   * stateless (継続修飾でも解決可能。cards_in_zone と同じ evaluateStatelessSourceCount 委譲)。
   */
  | { kind: "field_bp_total"; player: PlayerRef; filter?: CardFilter }
  /**
   * 効果発動元カード自身 (`StepExecutionContext.sourceInstanceId`) が現在持つ
   * text_role アンダーカード（`roleTag` 一致）の枚数。「アンダーカード数を動的上限として…
   * 複数選択で下に加える」(BSAZ02-TX01(B) backFace effects[1]) のような、host 自身の
   * 現有アンダーカード数を選択枚数の動的上限に使う型に使う。`ConditionClause`
   * の同名 `self_under_card_count` (model.ts) と同じ `countTextRoleUnderCards` を
   * 集計 SSOT として共有する。context 依存種別のため継続修飾 (stateless) では 0 を返す。
   */
  | { kind: "self_under_card_count"; roleTag: string };

export interface DynamicCount {
  source: DynamicCountSource;
  /**
   * 除算前の加算オフセット。省略時=0。乗算・除算より前に `baseCount` へ加算する
   * （後段の `offset` は除算・floor 後に加算する点と対照。「切り上げ」相当の除算を
   * 表現するために使う: `ceil(baseCount/2)` = `floor((baseCount+1)/2)` =
   * `{ divisor:2, preOffset:1 }`。「本来のコストが6以下…追加で自分のカウントを
   * 減らすことで、減らしたカウント1につき破壊上限コストを+2する」型 (BSGE01-TX04(B)) で、
   * 対象カードの本来コストから必要な減少数(切り上げ)を逆算する用途に使う。
   * 適用順: value = floor(((baseCount + preOffset) * multiplier) / divisor) * groupMultiplier + offset。
   */
  preOffset?: number;
  /** 乗数。省略時=1 */
  multiplier?: number;
  /**
   * 除数。省略時=1（除算なし）。乗算後に除算し、端数切捨て (Math.floor)。
   * 「N個につき1体」「破壊数÷2(端数切捨)」等を表現する。
   */
  divisor?: number;
  /**
   * 除算・floor 後のグループ単位乗数。省略時=1。
   * 適用順: value = floor((baseCount * multiplier) / divisor) * groupMultiplier + offset。
   * 例「自分のカウント7につき3コスト」= { divisor:7, groupMultiplier:3 }。
   */
  groupMultiplier?: number;
  /**
   * 加算オフセット。省略時=0。
   * 適用順: value = floor((baseCount * multiplier) / divisor) * groupMultiplier + offset。
   * 例「破壊されたスピリット2体につき1体」= { multiplier:1, divisor:2 }（floor 後に offset 加算）。
   */
  offset?: number;
  /**
   * 上限クランプ。省略時=なし（無制限）。最終値 (offset 加算後) を `min(value, cap)` で抑える。
   * 「自分のカウント1につき5枚（最大15枚）」= { multiplier:5, cap:15 } 等の印字上限を表す。
   */
  cap?: number;
  /**
   * 下限クランプ（`cap` の下限版）。省略時=なし（無制限、負値も許容）。最終値
   * (`subtract`/`cap` 適用前) を `max(value, minValue)` で底上げする。除算・`preOffset` の
   * 組み合わせで理論上 0 未満になり得るとき、「最低でもN」という mandatory な下限を
   * 保証するために使う（例: 「本来のコストが6以下…減らしたカウント1につき破壊上限コストを
   * +2する」型 (BSGE01-TX04(B)) で、対象コストから逆算した必要減少数が安価な対象では
   * 0 以下になり得るため `minValue:1`＝常に最低1は減らす、という mandatory base cost を保証する）。
   */
  minValue?: number;
  /**
   * 差分減算ソース。省略時=なし。設定時、`subtract` ソースの数を最終値から引き、
   * 結果が負なら 0 にクランプする（`cap` クランプはその後に適用）。
   * 「自分の手札が相手と同じ枚数になるようデッキの上からドロー」= source:相手手札 /
   * subtract:自分手札（相手手札 − 自分手札、負なら 0）等の差分量を表す（BSTH08-R01）。
   */
  subtract?: DynamicCountSource;
}

/**
 * 数量指定。数値 = 具体的な数、"all" = すべて、{ min, max } = 範囲、DynamicCount = 動的値。
 *
 * 範囲 `{ min, max }` の境界は `DynamicCount` も取れる（「自分のカウント2につき1体まで」=
 * `{ min: 0, max: { source: count_value, divisor: 2 } }` 等の動的*上限*レンジ）。
 * 解決時に `resolveCountBound()` で数値へ落とす。
 */
export type Count =
  | number
  | "all"
  | { min: number | DynamicCount; max?: number | DynamicCount }
  | DynamicCount;

/** `Count` 範囲境界。固定値または動的値。 */
export type CountBound = number | DynamicCount;

/** 数値指定（BP・ダメージ・コア数等）。固定値または動的値 */
export type Amount = number | DynamicCount;

// ============================================================
// CardNameMatch
// ============================================================

/**
 * カード名の一致条件。
 *   - "self"       → 効果発動元カードと同じカード名
 *   - { contains } → カード名に指定文字列を含む（部分一致）
 *   - { exact }    → カード名が完全一致
 *
 * カードテキスト記法 → 一致条件の対応（裁定 2026-06-05・全効果のカード名参照に共通）:
 *   - 「X」          → { contains: "X" } … カード名に X を含めば成立。変種カード
 *                       （例「[覚醒]フランドール・スカーレット」）も対象。
 *   - カード名：「X」 → { exact: "X" }    … カード名が X と全文完全一致のみ。
 * 対象指定・サーチ・参照など名前を参照する全効果でこの規約。実装: card-filter.ts matchesCardName()。
 * ブレイヴ合体条件は別型 BraveCondition.cardNameContains / cardNames で同じ規約を表現。
 */
export type CardNameMatch = "self" | { contains: string } | { exact: string };

/**
 * 先行 step の結果カードと同じカード名を参照する動的名前フィルタ。
 * 主用途: 「この効果で召喚したカードと同じカード名のブレイヴと合体している〜」型。
 * step が未実行/未成功、または参照カード定義が引けない場合は fail-closed で非一致。
 */
export interface CardNameMatchFromStepRef {
  kind: "from_step_ref";
  stepId: string;
  /** 参照する step result。省略時 = affected。 */
  result?: "affected" | "hand_added" | "revealed";
}

export type CardNameMatchSource = CardNameMatch | CardNameMatchFromStepRef;

// ============================================================
// CardFilter — 統一カードフィルタ
// ============================================================

export interface CardFilter {
  category?: CardCategory[];
  colors?: CardColor[];
  /**
   * `colors` の結合方法。省略時 = "or"（列挙色のいずれかを持てば成立、従来挙動）。
   * "and" は「列挙色を *すべて* 持つ」を要求する（多色カードの色保持判定）。
   * カードはそれが持つ各色を「持っている」(10_rules/01_glossary-and-card-types.md「色」、
   * model.ts countUniqueColors)。「6色のカード」(BSTH04-転醒R01(B) [5,6])のように
   * 特定の複数色をすべて保持するカードを指す効果はこの "and" で表す。
   * tribesLogic と同じ logic-flag パターン。
   */
  colorsLogic?: "and" | "or";
  /**
   * 指定色を一切持たないカードにのみ一致する（否定版、`colors` の保持判定とは別軸）。
   * 「黄以外の色を持つカード」(BSTH04-X02【C連鎖】3以上) のように、多色カードが
   * 除外色を1つでも持てば非該当とする判定は `colors` の OR 列挙では表現できない
   * （列挙外の色を1つでも持てば成立してしまい、除外色も併せ持つ多色カードを
   * 誤って対象化する）。excludeTribeSubstring と同じ「否定フィルタ」パターン。
   */
  excludeColors?: CardColor[];
  tribes?: string[];
  /** 系統の結合方法。省略時 = "or" */
  tribesLogic?: "and" | "or";
  /** AND条件の必須系統（tribesLogic とは独立） */
  tribesRequired?: string[];
  /**
   * 系統名部分一致の除外フィルタ（否定版）。`tribes`（トークン完全一致 OR/AND）とは別軸で、
   * 系統トークン文字列（`tribe.split("・")` の各要素）に指定した部分文字列を**含む**
   * トークンが1つでもあれば除外する（契約合体【合体条件：GE＆系統名に「O」を含まない】型、
   * GE 配下のサブ系統トークン "GEO"/"GE1" 等をアルファベット/数字の部分一致で弾く）。
   * 複数指定時はいずれかを含めば除外（OR）。`tribes`/`tribesRequired` の AND 条件と併用可能。
   */
  excludeTribeSubstring?: string[];
  /**
   * 動的 `tribes` の源。指定時は静的 `tribes` の代わりに、解決時に算出した参照カードの
   * 実効系統（いずれか1つ一致=OR）を用いる（`maxBpSource` 等と同型の scalar 注入、SSOT）。
   *   - "declared_blocker" → このバトルで現在ブロック宣言しているカード（相手側 1 体、
   *     複数体合体時は host 側 memberInstanceIds[0]）の実効系統。
   *     「ブロック宣言する相手のスピリット/アルティメットと同じ系統を持つ他の…」型
   *     (BSFT01-C01 stack 効果) を表す。
   * 解決は `resolveTribesMatchRefFilter`（card-filter.ts）一本に委譲し（SSOT）、呼び出し側が
   * 参照カードの実効系統を `getEffectiveTribes` で算出して渡す。参照カードが存在しない
   * （バトル外・ブロック未宣言等）ときはマッチ不可能な番兵値に解決し、誤って全対象に
   * マッチしないようにする。
   */
  tribesMatchRef?: "declared_blocker";
  /** 系統を持たないカードだけに一致する。 */
  noTribes?: boolean;
  /**
   * トークンカード判定。true=トークンカードだけに一致 / false=非トークンだけに一致。
   * トークンカードは `CardDefinition.maxTokenDeckCount` が設定されている（デッキ外運用、
   * `getAvailableTokenSummonCount` と同じ判定基準）。「〜トークンマジックカードの使用
   * コストを-Nする」(BSLH01-X06 ほか) のように、同系統の非トークンカードと区別する
   * 場合に使う（系統だけでは絞れない）。
   */
  isToken?: boolean;
  maxCost?: number;
  minCost?: number;
  /**
   * minCost / maxCost の判定基準。
   * - "effective_or_additional" (既定): 印字コストに加え、「コストはXとしても扱う」
   *   additional_cost CE の値でも一致すればマッチする。
   * - "printed": 原文が「本来のコスト」を参照する場合。additional_cost を無視し、
   *   印字/元コスト (`CardDefinition.cost`) だけを見る。
   */
  costBasis?: "effective_or_additional" | "printed";
  /**
   * 指定コストのいずれかを持つカードを除外する（否定版、`excludeColors` と同じ
   * 「否定フィルタ」パターン）。「コスト3/4以外の自分のスピリット」(BSTH11-C01/C02)
   * のように特定コスト値を除外する条件に使う。判定基準は `costBasis` を共有する。
   */
  excludeCosts?: number[];
  /**
   * 合体状態フィルタ。true=合体している / false=合体していない。
   * 判定は `card.attachedToInstanceId !== null || attachedChildrenIds.length > 0`
   * （Applicability.combined と同じ正準。例「合体していない本来コスト6以上の CB スピリット」）。
   */
  combined?: boolean;
  /** この効果の発揮元に合体しているブレイヴだけを対象にする。 */
  attachedToSource?: boolean;
  /**
   * ホストカードが合体中のブレイヴ条件。
   * `cardName.kind:"from_step_ref"` を使うと、同一効果内の先行 step で影響を受けたカード名と
   * 合体中ブレイヴのカード名を照合できる。
   */
  attachedBrave?: {
    cardName?: CardNameMatchSource | CardNameMatchSource[];
  };
  maxBp?: number;
  minBp?: number;
  /**
   * minBp / maxBp の判定基準。
   * - 既定（省略時）: 実効 BP（呼び出し側が `opts.effectiveBp` に注入。未注入時は
   *   印字 Lv1 BP にフォールバック）。
   * - "printed": 原文が「本来のBP」を参照する場合。`opts.effectiveBp` を無視し、
   *   印字 Lv1 BP (`def.levelDefs[0].bp`) だけを見る（`costBasis:"printed"` と同型、SSOT）。
   */
  bpBasis?: "printed";
  /**
   * 動的 `maxBp` 閾値の源。指定時は静的 `maxBp` の代わり（または併用時は厳しい方）に
   * 解決時に算出した実効 BP を上限として用いる。
   *   - "self_effective_bp" → 効果発動元（このスピリット）の実効 BP。
   *     「このスピリットのBP以下の相手のスピリット/アルティメットを破壊」型
   *     (BSDB01-C01 / BSTH08.5-R11 ほか) の動的比較破壊を表す。
   * 解決は `resolveSelfBpThreshold`（card-filter.ts）一本に委譲し（SSOT）、呼び出し側が
   * 源の合体ユニット込み実効 BP を getCombinedUnitBp で算出して渡す（effectiveBp/coreCount と同型の scalar 注入）。
   */
  maxBpSource?: "self_effective_bp";
  /**
   * 動的 `maxCost` 閾値の源。指定時は静的 `maxCost` の代わり（または併用時は厳しい方）に
   * 解決時に算出した源のコストを上限として用いる。
   *   - "self_effective_cost" → 効果発動元（このスピリット）の実効コスト。具体的には
   *     印字 `def.cost` と源に作用中の `additional_cost` CE（「コストはXとしても扱う」）の
   *     最大値。「このスピリットのコスト以下の相手のスピリット/アルティメットを破壊」型
   *     (BSDB01-R02 / BSDB01-TX01(A) ほか) の動的比較破壊を表す。対象側 filter の cost 判定
   *     既定挙動 (`[def.cost, ...additionalCosts]`) と SSOT 整合させる。
   *   - "self_count" → 効果発動元の所有プレイヤーのカウント値（PlayerState.countValue、
   *     保護カウントは源の系統で `immuneProtectedCount` 控除済み）。
   *     「自分のカウント以下のコストの相手のスピリットを破壊」型 (BSDB01-C02) を表す。
   * 解決は `resolveSelfCostThreshold`（card-filter.ts）一本に委譲し（SSOT）、呼び出し側が
   * 源の印字コスト（`def.cost`）と additional_cost CE 一覧、またはカウント値を渡す
   * （maxBpSource と同型）。軽減 CE はコスト属性を変えないため反映しない。
   */
  maxCostSource?: "self_effective_cost" | "self_count";
  /**
   * `maxCostSource` 解決値のスケーリング。省略時は multiplier=1/offset=0（従来どおり生値）。
   * 値 = source値 * multiplier + offset。「自分のカウント2につき破壊上限コスト+1」のような
   * 倍率適用型 (BSGE01-TX04(B): maxCostSource:"self_count" + {multiplier:2,offset:4} で
   * 「自分のカウント×2+4」＝現在カウント値でペイ可能な最大破壊上限コストを表す) に使う。
   * 解決は `resolveSelfCostThreshold`/`resolveSelfCountThreshold`（card-filter.ts）に統合済み
   * （maxCostSource 自体の解決と同じ関数内で適用、SSOT）。
   */
  maxCostSourceScale?: { multiplier?: number; offset?: number };
  /**
   * 動的 `maxCores` 閾値の源。指定時は静的 `maxCores` の代わり（または併用時は厳しい方）に
   * 解決時に算出した源の値を上限として用いる。
   *   - "self_count" → 効果発動元の所有プレイヤーのカウント値（PlayerState.countValue、
   *     保護カウントは源の系統で `immuneProtectedCount` 控除済み）。
   *     「自分のカウント以下のコアの相手のスピリット/アルティメットを破壊」型
   *     (BSKB01-T01 ヘビーロブスター) を表す。
   * 解決は `resolveSelfCountThreshold`（card-filter.ts）一本に委譲し（SSOT）、呼び出し側が
   * 源のカウント値を渡す（maxCostSource と同型）。
   */
  maxCoresSource?: "self_count";
  /**
   * 極値セレクタ。フィルタにマッチした候補集合のうち、指定メトリックが
   * 最小 / 最大のカードだけを対象に取れるよう絞る（「最もBPの低い相手1体を破壊」型）。
   * これは個々のカードを評価する述語ではなく候補集合に対する*相対*選択なので、
   * `matchesCardFilter` 内では判定できず、候補列挙（legal-actions-shared）と解決
   * （target-resolution）の両経路で `selectExtremalInstanceIds`（legal-actions-shared、
   * SSOT）を適用する。極値が複数並ぶ（タイ）ときは全タイ候補を残し、後段の `count`
   * 選択で選択者が選ぶ（標準ルール: 「最も〜」が複数なら対象を選ぶのは効果の持ち主）。
   *   - metric "bp" → 合体ユニット込み実効 BP（getCombinedUnitBp、場のカードのみ）。
   *   - metric "cost" → 印字コスト（`def.cost`）。
   *   - metric "core" → カード上の合計コア数（getTotalCoresOnCardById = 通常 + ソウル、
   *     場のカードのみ。コアは場のカードにしか乗らないため場外候補は除外）。
   * 例: BSTH09-TR01(A)「最もBPの低い相手のスピリット/アルティメット1体を破壊」(bp/lowest)、
   *     BSDB01-C04「最もコストの低い相手のスピリット1体を破壊」(cost/lowest)、
   *     BSSL01-C01「最もコアの少ない相手のスピリット/アルティメット1体」(core/lowest)。
   */
  extremal?: {
    metric: "bp" | "cost" | "core";
    mode: "lowest" | "highest";
  };
  /**
   * カード上の合計コア数の上限 (「コアN個以下の〜」)。
   * 「コア」は generic なので **ソウルコアを含む** (10_rules/06_core-system.md L41:
   * 「generic な『コア』はソウルコアを含む」)。判定値は呼び出し側が
   * `getTotalCoresOnCardById(state, instanceId)` (= normalCoreCount + soul) で算出し
   * `MatchCardFilterOptions.coreCount` に注入する (effectiveBp と同型の scalar 注入)。
   * 場のカードのみ意味を持つ (場外は coreCount=undefined → フィルタ無効)。
   */
  maxCores?: number;
  /** カード上の合計コア数の下限 (「コアN個以上の〜」)。`maxCores` と同型・同 SSOT。 */
  minCores?: number;
  /**
   * 対象カードのコントローラーがこのターン中に `declare_gimmick` を実行済みか
   * (「〇〇と宣言しなければアタック/ブロックできない」型、BSLH01-C12)。
   *   - true  → そのターン中に1回以上宣言済みのプレイヤーのカードのみ一致
   *   - false → そのターン中まだ宣言していないプレイヤーのカードのみ一致
   * 判定値は `GameState.declarationCountThisTurn[card.controllerPlayerId] > 0` で、
   * `matchesCardFilter`（card-filter.ts）が `opts.state` から直接参照する
   * （coreCount 等と異なり呼び出し側の scalar 注入は不要、SSOT は declarationCountThisTurn 一本）。
   */
  declaredThisTurn?: boolean;
  /**
   * 現在Lvの下限/上限 (「Lv1の〜」「Lv2以上の〜」型)。
   * 判定値は呼び出し側が現在の実効Lv (`getEffectiveLevel` 相当) を
   * `MatchCardFilterOptions.effectiveLevel` に注入する。場のカードのみ意味を持つ。
   */
  minLevel?: number;
  maxLevel?: number;
  /**
   * 対象自身の実効Lv（`effectiveLevel`）が、対象自身の `levelDefs` の最低Lvを
   * 下回っているか（「この効果で最低Lvより低くなったスピリット/アルティメットは
   * 消滅し」BSTH08.5-X02）。`minLevel`/`maxLevel` は効果側が指定する静的な閾値だが、
   * こちらは対象ごとに異なる `levelDefs` 最低値を都度算出する相対比較（`maxBpSource:
   * "self_effective_bp"` と同型の対象ローカル動的閾値）。判定は `matchesSingleFilter`
   * （card-filter.ts）で `def.levelDefs` の最低 level と `opts.effectiveLevel` を比較する。
   * 通常のコア不足消滅（10_rules/04:96）とは別軸で、「扱いのLv」上書き
   * （`override_properties.level: {delta}`）適用後の一時的な効果消費専用。
   */
  belowOwnMinimumLevel?: boolean;
  /** 実効Lvが対象自身の levelDefs の最高Lvであるか。 */
  atOwnMaximumLevel?: boolean;
  /**
   * カードがゲーム中に一度でもコアを置かれたことがあるか (「ゲーム中にコア1個以上を
   * 置かれた〜」型、BSTH02-C21 Lv2)。現在の `minCores`/`maxCores`（現在のコア数）とは異なり
   * 累積の履歴フラグ (`CardInstance.everHadCorePlaced`、一方向ラッチ) を参照する。
   * `matchesCardFilter`/`matchesSingleFilter` (card-filter.ts) が
   * `opts.currentCard.everHadCorePlaced` と照合する (instance 未提供時は不一致)。
   */
  everHadCorePlaced?: boolean;
  /** カード名フィルタ。配列で複数指定時はOR */
  cardName?: CardNameMatch | CardNameMatch[];
  /**
   * カード名フィルタの除外版（否定版、`excludeColors`/`excludeTribeSubstring` と同じ
   * 「否定フィルタ」パターン）。配列で複数指定時はいずれかに一致すれば除外(OR)。
   * 「カード名：「X」以外の〜」（自分自身の印字名を名指しで除く探索、BSTH03-C03 等）を表す。
   * `matchesCardName` を再利用し、"self" 指定時は `opts.sourceDefinition` 基準で判定する。
   */
  excludeCardName?: CardNameMatch | CardNameMatch[];
  /**
   * カード名フィルタの実効名版 (`cardName` の姉妹フィールド、`field_has.cardNamesEffective`
   * と同型パターン)。`cardName` は `def.name`（印字/raw 名）で判定するため、
   * act_as_spirit/override_properties でカード名を上書きされたトークン
   * （例: BSAZ02-X03 の「オルテュギア」分身アルティメット）を拾えない。
   * `matchesCardFilter`（card-filter.ts）は `legal-actions-shared.ts` から import される側
   * のため `getEffectiveCardName` を呼べず（循環 import）、本フィールドは matchesCardFilter
   * 内では評価されない。呼び出し側 (`move_card` の `from.hostFilter` 評価、
   * native-move-core-handlers.ts) が `getEffectiveCardName` で解決した実効名を
   * `matchesCardName`（純関数、card-filter.ts）へ個別に渡して判定する。
   */
  cardNameEffective?: CardNameMatch | CardNameMatch[];
  /**
   * act_as_spirit トークン限定 (`ConditionClause.field_has.actAsSpiritOnly` と同型、model.ts)。
   * true のとき act_as_spirit 登録済みトークンのみに一致する（印字上の実カードと同名になる
   * トークンを `cardNameEffective` 等の実効名フィルタと区別する用途）。
   * `matchesCardFilter` 内では評価されない（`cardNameEffective` と同じ理由: 判定に `GameState` +
   * 発動元 `sourceInstanceId` を要するため）。呼び出し側 (`TargetSpec` の `filter` kind 解決、
   * target-resolution.ts) が `matchesActAsSpiritSourceScope`（act-as-spirit.ts、SSOT）へ委譲する。
   */
  actAsSpiritOnly?: boolean;
  /**
   * `actAsSpiritOnly` と併用し、さらに「効果発動元カード自身が register_act_as_spirit した
   * トークンか」に絞る (`ConditionClause.field_has.actAsSpiritSourceSelf` と同型)。場に同名の
   * 複数インスタンス（実カード/トークン）がいるとき、発動元自身が生成したトークンだけを
   * 対象にする用途（BSAZ02-X03 effects[0] step5 hostTarget、【アルドノアドライブ】再取得の宛先を
   * 発動元自身のトークンに固定する）。
   */
  actAsSpiritSourceSelf?: boolean;
  /**
   * シンボル数フィルタ (完全一致)。**実効シンボル数**で判定する
   * (合体ユニット host+attached brave 合算 + symbol_addition CE 反映、
   * 2026-06-27 ENGINE-card-filter-effective-symbol-count 着地以降)。
   * 注入元 callsite が `MatchCardFilterOptions.effectiveSymbolCount` を渡すと
   * その値で、未注入時は印字シンボルエントリ数 にフォールバック。
   * 「本来のシンボル」(printed only) を要求するテキストは `printedSymbolCount` を使う。
   */
  symbolCount?: number;
  /**
   * シンボル数下限フィルタ (「シンボルN つ以上」用)。**実効シンボル数**で判定する
   * (`symbolCount` と同基準、effectiveSymbolCount 注入経路)。
   * 「本来のシンボルN つ以上」を要求するテキストは `printedMinSymbolCount` を使う。
   * `symbolCount` (完全一致) と独立に組み合わせ可能。
   */
  minSymbolCount?: number;
  /**
   * シンボル数上限フィルタ (「シンボルN つ以下」用)。**実効シンボル数**で判定する
   * (`symbolCount`/`minSymbolCount` と同基準、effectiveSymbolCount 注入経路)。
   * 例: BSTH003-X03「シンボル2つ以下の相手のスピリット/アルティメット1体を破壊する」。
   */
  maxSymbolCount?: number;
  /**
   * 印字シンボル数フィルタ (完全一致)。**印字シンボルエントリ数 のみ**で判定する
   * (合体ユニット合算・symbol_addition CE を **反映しない**)。
   * 「本来のシンボルが N つの」型テキスト用 (例: BSTH06-転醒R01(B) 「本来のシンボルが
   * 1つの相手のスピリット1体」)。effectiveSymbolCount 注入の影響を受けない。
   */
  printedSymbolCount?: number;
  /**
   * 印字シンボル数下限フィルタ (「本来のシンボルN つ以上」用)。`printedSymbolCount` と
   * 同基準・印字のみで判定。
   */
  printedMinSymbolCount?: number;
  /** カードが持つメカニクス */
  hasMechanic?: MechanicName[];

  /**
   * OR結合フィルタ。設定時は他の直接フィールドは無視され、
   * filterOr 内のいずれかのフィルタに合致すればマッチ。
   */
  filterOr?: CardFilter[];

  /** 除外条件。このフィルタに合致するカードを結果から除外する */
  exclude?: CardFilter;

  /**
   * 色数条件。
   * - "mono" = 単色
   * - "multi" = 多色
   * - { min, max } = 色数範囲。min===max で「ちょうどN色」。
   */
  colorCount?: "mono" | "multi" | { min?: number; max?: number };

  /** 契約カードか */
  isContract?: boolean;

  /**
   * 契約カード（`isContract:true`）の煌臨先（host）か。`underCards`(role='advent_source')
   * に契約カードを持つかどうかの逆引き判定（ENGINE-persistent-recovery-block-with-advent-host-exclusion、
   * BSTH11-X01「煌臨元を含む契約カードとその煌臨先以外」）。既存 `adventSourceScope`/`isContract`
   * は煌臨元→契約カードの片方向判定のみで、host 側からの逆引きを提供しないため新設。
   * 判定 SSOT は `isContractAdventHost`（card-filter.ts）一本。
   */
  isContractAdventDestination?: boolean;

  /**
   * CardDefinition.keywordTags に指定タグをすべて持つカードだけに一致する。
   * `isContract:true` は adventData 由来の契約煌臨カードも含む「契約カード」汎用判定
   * なので、「契約スピリットカード」本体など keywordTags 側の印字分類を直接要求したい
   * 場合に使う。
   */
  requiredKeywordTags?: string[];

  /**
   * 「効果の記述を持つ／持たない」対象限定。
   *   - true  → 印字テキストに効果の記述を持つカードのみ（効果なしのバニラを除外）。
   *   - false → 効果の記述を持たない（バニラ）カードのみ。
   * 判定は印字テキスト（`def.textLines` に非空の効果記述行があるか）に基づく **印字属性** で、
   * シミュレーター側の effects 実装有無（未実装で `effects:[]` でも印字テキストは持つ）には
   * 依存しない。判定 SSOT は `cardHasPrintedEffectText`（card-filter.ts）一本。
   * 例: BSTH07-転醒X02(B)「効果の記述を持つ相手のスピリット/アルティメット2体を破壊」、
   *     BSTH07-M02 バースト同型。
   */
  hasEffectText?: boolean;

  /**
   * 発揮元カードの使用時に軽減シンボルをどこまで満たしたか。
   * game_event:"effect_activated" の triggerFilter で、マジック等の発揮元カードに対して
   * 「その軽減シンボルすべてを満たし」条件を fail-closed で評価する。
   */
  reductionSymbolsSatisfied?: "all";

  /**
   * 対象カードが指定 `timing.mode` の起動効果 (`timing.kind:"activated"`) を
   * `effects[]` に持つか（効果借用 `borrow_magic_effect` の借用元絞り込み用、
   * BSAZ03-M01 effects[2,3] が初出）。
   *
   * `hasEffectText` と同じ「印字属性・実装状態非依存」原則に従う: `effect.stub` /
   * `effect.steps.length` は見ない（シミュレーターの実装完了度でこのカードの
   * 借用元としての適格性が変わってはならない）。判定 SSOT は
   * `cardHasActivatedEffectMode`（card-filter.ts）一本。
   */
  hasActivatedEffectMode?: ReadonlyArray<"main" | "flash" | "stack">;

  /**
   * 対象カードが指定 `card_event` 効果を `effects[]` に持つか。
   * `borrow_card_event_effect` の借用元絞り込み用。借用実行できる効果だけを候補にするため、
   * `effect.stub` や空 `effect.steps` は除外する。
   */
  hasCardEventEffect?: ReadonlyArray<CardEventType>;

  /**
   * 対象カードが印字バースト系ヘッダ（【バースト】/Sバースト/バースト転召）を持つか。
   * `keywordTags:["burst"]` はセット中バースト破棄など burst 関連カードにも使われ、
   * `effects[]` は未実装 stub で `timing.kind:"burst"` になっていないことがあるため、
   * 「バースト効果を持つカード」本文の判定ではこの専用フィルタを使う。
   */
  hasBurstEffect?: boolean;

  /**
   * 対象カードが `quartzData`（【クォーツ】印字）を持つか。`quartz_set` の
   * 対象絞り込み用（手札/トラッシュから魂状態 host へセットできるカード）。
   * ENGINE-quartz-set-effect-driven-primitive 初出（BSLH01-R01[3,4]）。
   */
  hasQuartzData?: boolean;

  /**
   * 対象カードが `mirageData`（【ミラージュ】印字）を持つか。「ミラージュ効果を持つ」
   * カードの対象絞り込み用（手札から選んでコスト無しセットする等）。
   * ENGINE-mirage-set-target-primitive 初出（BSTH002-X01[3,4]）。
   */
  hasMirageData?: boolean;

  /**
   * 対象カードが指定 roleTag の text_role アンダーカード枠を宣言しているか
   * （`CardDefinition.underCardSlots` 印字属性、engine-aldnoah-drive-under-card-keyword が初出）。
   * 例: 【アルドノアドライブ：1】host（BSAZ02-C07 等）を「自分のカードが召喚/配置/転醒した
   * とき」型の第三者観測トリガーの誘発元フィルタとして絞り込む。
   * `hasEffectText` と同じ「印字属性・実装状態非依存」原則。判定 SSOT は
   * `cardDeclaresUnderCardSlot`（card-filter.ts）一本。
   */
  declaresUnderCardSlot?: string;

  /**
   * 対象カード (実インスタンス) が指定 roleTag の text_role アンダーカードを現に持っているか
   * (`CardInstance.underCards` 実行時状態、`declaresUnderCardSlot` の印字宣言とは別軸)。
   * ENGINE-c09-text-role-under-card-third-party-trigger 初出。「〜の下に「アルドノアドライブ」が
   * 置かれたとき」型 game_event の triggerFilter で、配置が実際に成立した host を絞り込む用途
   * (BSAZ02-C09)。判定 SSOT は `matchesCardFilter`（card-filter.ts）内のインライン判定。
   */
  hasUnderCardRoleTag?: string;

  /**
   * 魂状態フィルタ。
   *   - "only"    → 魂状態のカードのみ
   *   - "include" → 魂状態・通常状態の両方
   *   - 省略      → 魂状態を除外（デフォルト）
   */
  soulState?: "only" | "include";

  /**
   * 煌臨元（スピリットの下の `underCards` role='advent_source'）の包含スコープ
   * （10_rules/08a「名前参照の包含スコープ」, 裁定 2026-06-13）。
   *   - "include" → 「煌臨元を含む「X」」= 煌臨元アンダーカードも対象候補に含める。
   *   - 省略      → 無印スコープ = 煌臨元を対象から除外（デフォルト）。
   * text_role アンダーカード（星霊衣/アルドノア/バレットエディット系）は本フラグに関わらず**常に除外**。
   * 対応する集合の算出は `collectUnderCardScopeIds`（model）を SSOT とし、呼び出し側が
   * `MatchCardFilterOptions.underCardIds` で注入する（field_has カウント経路と同一規約）。
   */
  adventSourceScope?: "include";

  /**
   * 創界神/導界者ネクサスを対象に含めるか。
   *   - true   → 創界神/導界者ネクサスを対象に含める（「創界神ネクサス対象の効果」用）
   *   - "only" → 創界神/導界者ネクサス**のみ**を対象とする（通常スピリット・通常ネクサスを除外）。
   *              `filterOr` の枝ごとに『スピリット』『創界神ネクサスのみ』を書き分けたいケース
   *              （BSTH05-X02【神域】「風神/アシハラのスピリット/創界神ネクサス」型）で使用。
   *   - 省略   → 創界神/導界者ネクサスを対象から除外（デフォルト: 通常効果では対象外）
   *
   * "only" 配線: `matchesCardFilter` の outer 段（top-level filter）と `matchesSingleFilter`
   * の両方で `!isGrandwalkerOrGuidedNexus(def)` のとき false 返却。truthy として L148 の
   * 既定除外は素通りする（"only" でも grandwalker は admitted）。`includeGrandwalker`
   * 経路（target count）への射影は truthy → true（既存セマンティクス保持）。
   */
  targetsGrandwalker?: boolean | "only";

  /**
   * `targetsGrandwalker` が対象に含める創界神/導界者ネクサスの種別を絞り込む
   * (`grandwalkerKindMatches` と同じ SSOT。`ConditionClause.grandwalkerKind` と対称)。
   * 「創界神ネクサス」限定 (導界者を含まない) 型の効果 (BSTH02-C21 Lv2 等) で使う。
   *   - "grandwalker" → 創界神ネクサスのみ (導界者ネクサスを除外)
   *   - "guided"      → 導界者ネクサスのみ (創界神ネクサスを除外)
   *   - "any" / 省略  → 両方含める (従来どおり `isGrandwalkerOrGuidedNexus` 判定のみ)
   */
  grandwalkerKind?: "grandwalker" | "guided" | "any";

  /**
   * 創界石ネクサスを対象に含めるか（創界神とは別軸）。
   *   - true  → 創界石ネクサスを対象に含める（「創界石ネクサス対象の効果」用）
   *   - 省略  → 創界石ネクサスを対象から除外（デフォルト: 通常効果・創界神対象効果では対象外）
   */
  targetsGrandstone?: boolean;

  /**
   * `targetsGrandwalker:"only"` の対象に、実際は grandwalkerData を持たないが
   * 「自分の効果で導界者ネクサスとして扱われる」opt-in (override_properties の
   * `actsAsGuidedNexusForOwnExhaustEffects`) を持つカードも含める
   * (BSTH05.5-C20「自分の効果で、導界者ネクサスとして疲労させることができる」型)。
   * opt-in は「効果を発揮したプレイヤー = opt-in を付与したプレイヤー」のときのみ有効
   * （「自分の効果で」の忠実化、SSOT: `hasGrandwalkerExhaustOptIn`）。
   * このフィールドを立てない既存の `targetsGrandwalker` 消費側は従来どおり
   * `isGrandwalkerOrGuidedNexus` のみで判定する（挙動不変）。
   */
  includesGrandwalkerExhaustOptIn?: boolean;

  /**
   * バトル状態フィルタ。
   *   - "in_battle"     → バトル中のカード（アタック中 or ブロック中）
   *   - "not_in_battle" → バトルしていないカード
   *   - "attacking"     → アタック中のカード
   *   - "blocking"      → ブロック中のカード
   */
  battleState?: "in_battle" | "not_in_battle" | "attacking" | "blocking";
  /** 成立済みバトルではなく、現在スタック応答を待っている宣言のカードを対象にする。 */
  pendingDeclaration?: "attack" | "block" | "in_battle";

  /**
   * 疲労状態フィルタ（「疲労状態の相手スピリット」等の対象限定）。
   *   - "exhausted" → 疲労状態のカードのみ。回復状態でない（exhausted | heavily_exhausted）を指す。
   *     重疲労状態も「疲労状態」に含む: カード本文の「相手を重疲労させる→その後、疲労状態の…を
   *     デッキの下に戻す」コンボ（BSTS01-X03 / BSSG01-X01 等）は重疲労させた相手を後段の対象に
   *     できる設計であり、10_rules/02_turn-flow-and-timing.md L94 も重疲労→疲労を同一の回復軸に置く。
   *   - "recovered" → 回復状態のカードのみ。
   *   - "heavily_exhausted" → 重疲労状態のカードのみ（"exhausted" より狭い。原文が「重疲労状態の」
   *     と明記し疲労状態（軽疲労）を含まない場合に使う、ENGINE-persistent-recovery-block-with-advent-host-exclusion、
   *     BSTH11-X01【神域】precedent）。
   *   - 省略 → 状態を問わない（従来挙動）。
   * `CardInstance.exhaustState` を直接参照する（battleState と違い opts 注入は不要）。
   * 場外カードは既定 "recovered" なので "exhausted"/"heavily_exhausted" 指定時は自然に除外される。
   */
  exhaustState?: "exhausted" | "recovered" | "heavily_exhausted";

  /**
   * ゾーン限定フィルタ（「手札/手元のカード」等）。
   * 現状 `cost_modify`（player+cardFilter 版 additionalCostValue）の targetFilter のみが
   * 消費する（`matchesCostCETargetFilter`、ENGINE-cost-modify-additional-cost-value-dynamic-amount
   * Step3）。省略時はゾーンを問わない（従来挙動）。
   * 例: BSGE01-M02「相手の手札/手元のカードのコストを+1する」= `zone: ["hand", "set_aside"]`。
   * `ContinuousEffect.targetFilter.zone`（ENGINE-effect-immunity-hand-zone-scope）と同じ
   * `readonly Zone[]` 型で統一する（mutable/readonly 混在による構造的不整合を避ける）。
   */
  zone?: readonly Zone[];

  /**
   * 使用中の起動効果モード限定フィルタ（「マジックカードのスタック効果を使うとき」等）。
   * 現状 `cost_modify`（player+cardFilter 版 additionalCostValue）の targetFilter のみが
   * 消費する（`matchesCostCETargetFilter`、`zone` と同じ経路）。コスト計算が起動効果モード
   * 文脈を持つ経路（マジック使用: `CalculateReductionOptions.effectMode`）でのみ判定可能で、
   * 召喚/配置等モード文脈の無い経路では常に不一致（安全側デフォルト、`zone` と同型）。
   * 例: BSTH06-M01「相手がマジックカードのスタック効果を使うとき、そのコストを+1する」
   * = `usingEffectMode: ["stack"]`。
   * "accel" (ENGINE-accel-tribe-cost-override) はマジックの main/flash/stack とは別軸の
   * 【アクセル】使用時判定（`getAccelFreeUseSource` が `cardEffectMode:"accel"` で照合）。
   */
  usingEffectMode?: ReadonlyArray<"main" | "flash" | "stack" | "accel">;

  /**
   * 召喚原因限定フィルタ（「バースト効果以外の効果でスピリットカードを召喚するとき」等）。
   * `cost_modify`（player+cardFilter 版 additionalCostValue）の targetFilter のみが消費する
   * （`matchesCostCETargetFilter`、`usingEffectMode` と同じ経路）。`SummonAction.summonCause`
   * （native-action-registry.ts "summon" handler が `effectActionKind` から自動導出）が
   * `"burst"` = バースト効果解決中の召喚、`"effect"` = それ以外のカード効果による召喚。
   * 通常召喚（手札からの legal action）はこの action 自体を経由しないため常に不一致
   * （安全側デフォルト、`zone`/`usingEffectMode` と同型）。
   * 例: BSTH02-C02「相手がバースト効果以外の効果でスピリットカードを召喚するとき、
   * 3コスト余分に支払わなければ召喚できない」= `summonCause: ["effect"]`。
   */
  summonCause?: ReadonlyArray<"effect" | "burst">;

  /**
   * Lv1 requiredCores フィルタ（「最低Lvコスト1の〜」型、印字定義基準）。
   * `levelDefs` の level===1 requiredCores と厳密一致で判定する（実効値ではなく印字値）。
   * 例: BSGE01-C16/BSTH001-C05/BSTH002-M02「最低Lvコスト1の相手のスピリット/アルティメット2体」。
   */
  lv1RequiredCores?: number;
}

/**
 * `matchesTribes()`（card/tribe-filter.ts SSOT）が読む系統マッチ 4 軸（tribes/tribesLogic/
 * tribesRequired/noTribes/excludeTribeSubstring）だけを切り出した CardFilter のサブセット。
 *
 * OracleCondition / ChangeSwapCondition / UnsealCondition.cardFilter 等、系統だけを
 * CardFilter から借りて独自の対象条件型を定義する箇所はこれを spread/extend して使うこと
 * （新規に `tribes?: string[]` を単体で持たせない）。CardFilter に新しい系統軸が増えたとき、
 * この型を経由する定義は自動的に追従する（tribe-match-inline SSOT probe、2026-08-05
 * subset-type-unification 判断: 呼び出し側の matchesTribes 委譲だけでなく型定義側も
 * 統合しないと、次に軸が増えたとき同じ取りこぼしが再発する）。
 */
export type TribeMatchFilter = Pick<
  CardFilter,
  | "tribes"
  | "tribesLogic"
  | "tribesRequired"
  | "noTribes"
  | "excludeTribeSubstring"
>;

/**
 * cost_override / additional_cost (player+filter 版) の消費側
 * `matchesCostCEFilterClause` (card-filter.ts) が実際に解釈するフィールドだけを
 * 許可するサブセット型。CardFilter をそのまま渡すと、消費側が読まない
 * maxCost/maxBp/maxCores 等のフィールドを型チェックが通る形で書けてしまい、
 * 効果 DSL 上は指定したのに黙って無視される silent no-op trap になる
 * (guard-audit-card-filter-projection 敵対的検証 2026-08-05 Lens 2 で反証)。
 * 新フィールドをここに追加する場合は、先に `matchesCostCEFilterClause` 側の対応を
 * 実装してから追加すること。
 */
export type CostCEFilterFields = Omit<
  Pick<
    CardFilter,
    | "category"
    | "colors"
    | "tribes"
    | "tribesLogic"
    | "tribesRequired"
    | "noTribes"
    | "excludeTribeSubstring"
    | "isToken"
    | "zone"
    | "usingEffectMode"
    | "summonCause"
    | "cardName"
    | "hasMechanic"
    | "hasBurstEffect"
    | "requiredKeywordTags"
  >,
  "filterOr"
> & {
  // filterOr のサブフィルタも同じ許可フィールドに制限する (再帰境界。CardFilter[] を
  // そのまま許すと filterOr 経由で maxCost 等を書ける抜け道が残る)。
  filterOr?: CostCEFilterFields[];
};

// ============================================================
// TargetSpec — 対象指定
// ============================================================

export type TargetSpec =
  /**
   * このカード自身。ただし effect 発動元が合体中ブレイヴのとき、`resolveSelfReferenceCard`
   * (model.ts) が「このスピリット」参照として合体先 host へ redirect する（合体ブレイヴが
   * 発揮元の効果テキストは通常「このスピリット」表記のため）。host へのリダイレクトが
   * 不適切な用途（発動元カード自身の instance を指す「このカード」参照。例: BSFT01 TR系
   * 転醒「この転醒後スピリット」= 転醒した発動元カード自身、合体先ではない）には
   * `source_card` を使うこと。
   */
  | { kind: "self" }
  /**
   * 効果発動元カード自身の instance を、合体状態に関わらずリダイレクトなしで指す。
   * `self` と異なり `resolveSelfReferenceCard` の host redirect を経由しない。
   * 用例: bsft01-tr-rebirth-permission-window の rebirth 後任意コア配置
   * （転醒した鍵ブレイヴ自身が合体中でも、コアは合体先ホストではなく発動元カード自身へ置く）。
   */
  | { kind: "source_card" }
  /** フィルタで指定 */
  | {
      kind: "filter";
      player: PlayerRef;
      filter: CardFilter;
      count: Count;
      // 注 (P3-14 D-2 残骸の除去): かつてここに `chooser?: PlayerRef` が型としてだけ存在したが、
      // 消費側は EffectStep.chooser のみで TargetSpec 側は未配線（指定しても黙って無視される罠）
      // だったため削除した。対象選択者の指定は EffectStep.chooser を使うこと。
      /** 効果発動元カード自身を対象から除外する */
      excludeSelf?: boolean;
      /** 発揮源自身の下にある、指定役割のアンダーカードだけを選ぶ。 */
      sourceUnderCardRole?: "advent_source" | "text_role";
      /** 対象ゾーン。省略時="field" */
      zone?: Zone | Zone[];
      /**
       * 選択した対象集合の属性合計値による上限制約（予算制、count と独立に併用可）。
       * count は選択枚数の下限/上限、budget は選択集合の合計値の上限を課す
       * （count を `{min:0, max:"all"}` 等にして「好きなだけ、ただし合計Xまで」を表す）。
       * 「自分のスピリットすべての合計BPまで、相手のスピリット/アルティメットを好きなだけ
       * 破壊する」(BSAZ01-C11) 用。検証は選択確定時（`applyPendingEffectTargetAction`）に
       * 選択済みカードの `metric` 合計を `amount` と比較する単一 chokepoint
       * （ENGINE-cumulative-bp-budget-destroy）。
       * `"symbol"` は実効シンボル数合計（`getCombinedUnitSymbolCount` と同基準）。
       * 「シンボル合計N個まで」(BSLH01-X05、ENGINE-cumulative-symbol-budget-destroy) 用。
       */
      budget?: { metric: "bp" | "cost" | "symbol"; amount: Amount };
      /**
       * 指定時、候補プールを zone/filter 一致に加えてこの `stepId` の
       * `affectedCardInstanceIds` に含まれるカードだけへさらに絞り込む（AND 条件）。
       * 「デッキを上から2枚まで破棄できる。その中のカード1枚の…」(BSKB01-R03) のように、
       * 前段 step が生成した候補集合の中だけで player choice を行い、かつゾーンの
       * 他のカード（既存トラッシュ内容等）を候補から除外したい場合に使う。
       * `DynamicCountSource.cost_from_ref`/`cards_from_ref` の `stepId` 参照と同じ
       * SSOT パターン（前段 step の結果を後段が参照する）を対象選択にも適用する。
       */
      stepId?: string;
      /**
       * 指定時、この `stepId` の affectedCardInstanceIds を候補から除外する。
       * 「指定した対象以外」型で、指定対象を選択専用 step に記録して後段の対象候補から外す。
       */
      excludeStepId?: string;
    }
  /** 前のステップの結果を参照 */
  | {
      kind: "ref";
      stepId: string;
      /**
       * 参照する結果集合。
       * - affected (既定): step が影響を与えたカード
       * - bp_became_zero: bp_modify により実効 BP が >0 から 0 へ遷移したカード
       */
      result?: "affected" | "bp_became_zero";
    }
  /**
   * 第三者 `game_event` 観測 (battle_end / advent / rebirth / brave_combined / state_change 系)
   * の主語 Y を 1 体だけ対象にする。`pendingTriggeredEffect.relatedInstanceId` を CardInstance に
   * 解決し、`zone === "field"` かつ pendingLeave 未保留なら 1 件返す。`triggerFilter` で
   * 範囲を絞った観測効果 (BSTH001-C04 同型) でも、相手対象 (opponent.life 等) ではなく
   * 主語 Y 自身に対する recover/destroy/grant_effect 等を宣言できる。
   *
   * 解決時に主語 Y がフィールドを離れていたり pending 中なら空配列を返す。
   *
   * 既知の用例: BSTH05-X02 effects[1]『自分の風神/アシハラのスピリット/創界神ネクサスは、
   * バトル終了時、ターンに1回ずつ回復できる』。
   */
  | { kind: "trigger_related_instance"; includePendingLeave?: boolean }
  /**
   * `trigger_related_instance` が合体中ブレイヴを指している場合、その合体先 host を対象にする。
   * BSAZ01-C18「自分のスピリットに『界塚伊奈帆』が合体したとき、そのスピリットに…」型。
   */
  | {
      kind: "trigger_related_combined_host";
      includePendingLeave?: boolean;
      player?: PlayerRef;
      filter?: CardFilter;
    }
  | {
      kind: "trigger_related_instances";
      includePendingLeave?: boolean;
      /** 同時イベントの主語から選ぶ件数。省略時は全件。 */
      count?: Count;
    }
  /**
   * 現在解決中の効果 (sourceInstanceId) が引き起こした pending leave
   * (destroy/vanish 等、未フラッシュ) の対象カードすべてを対象にする。
   * `{kind:"ref", stepId}` は同一 effect 内の明示 step 参照限定だが、こちらは
   * 発揮元カードで横断的に一致させるため、同じ効果内の複数 step (複数 destroy 等) に
   * またがる離脱もまとめて拾える (ENGINE-generic-effect-activation-causal-trigger Step2、
   * causal-tracking 層。着地確認カード: BSGE01-R02 【毒牙：モルター】)。
   */
  | { kind: "pending_leave_caused_by_effect_source" };

// ============================================================
// CoreLocation
// ============================================================

/** コア場所指定。EffectCoreLocation に count_area / ref を追加。 */
export type CoreLocation =
  /** core_move の移動元専用。1個のコアを、所属・ゾーンを横断した候補から選ぶ。 */
  | { kind: "union"; sources: CoreLocation[] }
  | { kind: "void"; player: PlayerRef }
  | { kind: "reserve"; player: PlayerRef }
  | { kind: "trash"; player: PlayerRef }
  | { kind: "life"; player: PlayerRef }
  /**
   * ゲーム外 (from 専用、soul core のみ)。「ゲーム外から<ソウルコア>1個を自分の
   * リザーブに置ける」(BSLH01-R03/X05 等)。EffectCoreLocation.outside_game と同型。
   */
  | { kind: "outside_game" }
  /**
   * ゲームから除外（to 専用、soul core のみ）。「ソウルコアをゲームから除外する」
   * (BSLH01【ソウルドライブ・S】等) の行き先。ボイドとは別処理
   * (10_rules/06_core-system.md:59-72、他のコアと混ざらない)。`effectKind:
   * "explicit_soul_core"` と併用し、`model.PlayerScopedSoulCoreLocation`
   * ("removed_from_game" kind、既存) へ `moveSoulCore` 経由で移す
   * (P3-125 Step1、engine-soul-drive-s-keyword-step1)。
   */
  | { kind: "removed_from_game"; player: PlayerRef }
  /**
   * フィールド上のカードのコアを源とする（コアシュート）。
   * `filter` 指定時は、コアを取れる対象カードを CardFilter で限定する
   * （「相手のスピリット/アルティメットのコア」「バトルしている本来コスト3以下の相手」等）。
   * 省略時は controller/zone のみで全フィールドカードが対象（従来挙動）。
   * `minRemainingPerCandidate` は「コアを0個にできない」型（BSTH04-転醒R02(B)）の残数下限。
   * 各対象カードから取れるコアは `availableCores - minRemainingPerCandidate` までに制限され、
   * `availableCores <= minRemainingPerCandidate` のカードは候補から除外される。
   * `minRemainingPerCandidateByFilter` は、同じ field source 内でカード種別等により
   * 残数下限が異なる効果（例: S/U は1個残すがネクサスは0個可）を表現する。
   * 複数一致時は `minRemainingPerCandidate` と合わせた最大値を使う。
   */
  | {
      kind: "field";
      player: PlayerRef;
      filter?: CardFilter;
      minRemainingPerCandidate?: number;
      minRemainingPerCandidateByFilter?: Array<{
        filter: CardFilter;
        minRemaining: number;
      }>;
      /**
       * 「フィールド/リザーブのコア」横断コア除去（BSTH001-X01）。true のとき
       * フィールドカード上のコアに加え player のリザーブ通常コアも同一選択の候補に含める。
       * filter はフィールドカードのみに適用。詳細は EffectCoreLocation.field.includeReserve。
       */
      includeReserve?: boolean;
      /** Move amount from each included zone; one amount bonus is shared by the zones. */
      eachZone?: boolean;
    }
  | { kind: "count_area"; player: PlayerRef }
  | { kind: "this_card" }
  | { kind: "target_card" }
  | { kind: "card_instance"; instanceId: string }
  | { kind: "ref"; stepId: string }
  | { kind: "field_card"; player: PlayerRef; filter: CardFilter }
  /**
   * P3-47 F-5: 自分の通常移動可能な全ゾーン (reserve / trash / life / 自分 field カード)
   * の任意混合をソースとする `core_distribute` 用マーカー。`mode="player_choice"` 専用で、
   * `executeCoreDistribute` が `allowedSources` / `sourceAvailable` を持つ pending を生成する。
   * 例: フランドール【フォーオブアカインド】「自分のコア1個以上をそれらのカードに置く」。
   */
  | { kind: "any_movable_self" }
  /**
   * 「ライフと《ソウルコア》以外の自分のコアすべて」を `core_distribute`
   * (mode="player_choice") で扱うための source marker。
   * reserve / trash / 自分 field カード上の通常コアのみを候補にし、life と soul core は
   * 常に除外する。`amount:"all"` では、この source marker の利用可能通常コアすべてを
   * 配置する必要がある（minTotal を実利用可能数へ引き上げる）。
   */
  | { kind: "non_life_normal_self" }
  /**
   * 「自分のフィールド/リザーブのコアを好きなだけ<対象>に置ける」用マーカー（`any_movable_self`
   * の trash/life を除いた縮小版）。`mode="player_choice"` 専用、単一 target のみ対応。
   * `executeCoreDistribute` が `buildChargeCoresPendingCoreDistribution`
   * （mechanics/core-charge-distribution.ts、創界石転醒 postRebirth と契約煌臨の SSOT）
   * を再利用して pending を生成する。
   * 例: BSFT01 TR系【転醒】許可窓「このとき、自分のフィールド/リザーブのコアを
   * 好きなだけこの転醒後スピリットに置ける」。
   */
  | { kind: "field_and_reserve_self" }
  /**
   * 「トラッシュのコアN個まで + フィールド/リザーブのコアを好きなだけ<対象>に置く」
   * 用マーカー。`mode="player_choice"` 専用。
   *
   * field/reserve は generic な「コア」なのでソウルコアを含める。trash 側は
   * `trashCoreKind:"normal_only"` で「《ソウルコア》以外」、省略/`"generic"` で
   * ソウルコア込みの「コア」を表す。通常コアとソウルコアを合わせた trash 取得上限は
   * `trashCoreLimit` 個まで。
   */
  | {
      kind: "field_reserve_and_trash_self";
      trashCoreLimit: number;
      trashCoreKind?: "generic" | "normal_only";
    };

// ============================================================
// Applicability（軸1: 適用可能性）
// ============================================================

export interface Applicability {
  /**
   * カードが存在するゾーン。テキストに明示されている場合のみ指定。
   * 「このカードは効果を受けない」等の自己継続耐性で本文にゾーン限定が無い場合は、
   * `anywhere` ではなく、実際に公開/使用中で効果を受け得る zone を明示列挙する。
   * `anywhere` は `deck` にも一致するため、デッキ内の裏向き非公開カードへ広げない。
   */
  zone?: ApplicabilityZone | ApplicabilityZone[];
  /** 煌臨元にある間だけ要求する上カードの煌臨種別。通常の場・魂状態では制限しない。 */
  adventSourceHostVariants?: Array<"normal" | "contract" | "f_contract">;
  /** フィールド上でのカード形態 */
  form?: CardCategory;
  /** レベル範囲 */
  level?: { min?: number; max?: number };
  /** 合体状態 */
  combined?: boolean;
  /**
   * 異魔神ブレイヴ（10_rules/08c §7）が左右両スロットで同時合体中か
   * (`isImaginBraveDualCombined`)。`combined` (=いずれかの合体) とは別軸。
   */
  imaginDualCombined?: boolean;
  /** 魂状態 */
  soulState?: boolean;
}

export type ApplicabilityZone =
  | "token_pool"
  | "field"
  | "hand"
  | "set_aside"
  | "burst_set"
  | "mirage_set"
  | "trash"
  | "deck"
  | "in_use"
  | "revealed"
  | "anywhere"
  | "soul_state"
  /**
   * 煌臨元（役割:advent_source のアンダーカード。runtime Zone 上は "field" のまま
   * ホストの下に重なる）。通常の Zone とは独立した状態のため mapZoneToApplicabilityZone
   * では解決できず、evaluateApplicability 側で collectUnderCardScopeIds().adventSource
   * 経由の別チェックとして扱う（BSSL01-X03「手札/トラッシュ/煌臨元にあるこのカード」）。
   */
  | "advent_source";

/**
 * ランタイム Zone → ApplicabilityZone マッピング（複数箇所で共有する正源）。
 * 対応のないゾーン（life / reserve / void / removed_from_game / count_area 等）は null。
 * `revealed`（デッキオープン中の一時ゾーン）は
 * ENGINE-revealed-zone-continuous-effect-applicability で対応追加
 * （「デッキからオープンされたこのカードは系統：「X」を持つ」型、BSTH07.8-X02）。
 */
export function mapZoneToApplicabilityZone(
  zone: Zone
): ApplicabilityZone | null {
  switch (zone) {
    case "token_pool":
      return "token_pool";
    case "field":
      return "field";
    case "hand":
      return "hand";
    case "set_aside":
      return "set_aside";
    case "burst":
      return "burst_set";
    case "mirage":
      return "mirage_set";
    case "trash":
      return "trash";
    case "deck":
      return "deck";
    case "in_use":
      return "in_use";
    case "revealed":
      return "revealed";
    default:
      return null;
  }
}

/**
 * `Applicability.zone` の zone 一覧に対し、カードの現在状態が一致するか判定する SSOT。
 * 通常 Zone マッピング (`mapZoneToApplicabilityZone`) に加え、`"advent_source"`
 * （runtime Zone 上 "field" のままホストの下に重なる煌臨元。呼び出し側が
 * `collectUnderCardScopeIds(state).adventSource.has(instanceId)` 等で判定した結果を
 * `isAdventSource` として渡す）を OR 条件で判定する。
 * `Effect.applicability.zone` を読む判定ロジックが複数箇所 (evaluateApplicability /
 * isRegisteredFieldEffectSourceZoneAllowed 等) に分岐しないよう、この関数を正源として共有する。
 * runtime zone が `"burst"` のカードでは、`isBurstSet` を渡した state-aware caller だけが
 * `"burst_set"` をセット中に限定する。未指定時は既存の runtime-zone 判定との互換のため true。
 */
export function matchesApplicabilityZoneList(
  zones: readonly ApplicabilityZone[],
  cardRuntimeZone: Zone,
  isAdventSource: boolean,
  isSoulState = false,
  isBurstSet = true
): boolean {
  const matchesAdventSource = zones.includes("advent_source") && isAdventSource;
  const matchesSoulState = zones.includes("soul_state") && isSoulState;
  const mapped = mapZoneToApplicabilityZone(cardRuntimeZone);
  const matchesRegularZone =
    mapped !== null &&
    (zones.includes("anywhere") ||
      (zones.includes(mapped) && (mapped !== "burst_set" || isBurstSet)));
  return matchesAdventSource || matchesSoulState || matchesRegularZone;
}

/**
 * stub かつ転醒/逆転醒ステップを含む効果か。
 *
 * 太陽の畑 (BSTH04-転醒R02(A)) 等の【転醒】トリガーは、トリガー
 * （ライフ増減 / 相手による離脱）未表現のまま `timing: continuous` +
 * `rebirth` ステップの fidelity stub として書かれている。これを自動実行
 * すると「カウント N 以下」ゲートだけで強制発火し、配置直後に裏返って
 * しまう（任意性「裏返せる」も失われる）。
 *
 * よって continuous 効果の自動実行経路は、このような stub 転醒/逆転醒を
 * 必ずスキップする。SSOT: continuous-effect-rebuild（CE 登録）と
 * effect-resolution（play_card_action の continuous 実行）の双方が本述語を
 * 共有する。stub 解消（worker による正規トリガー化）時にこの分岐は不要化する。
 */
export function isStubRebirthEffect(effect: Effect): boolean {
  return (
    Boolean(effect.stub) &&
    effect.steps.some(
      (step) =>
        step.action.kind === "rebirth" || step.action.kind === "reverse_rebirth"
    )
  );
}

// ============================================================
// StepCondition — ステップ間参照条件
// ============================================================

export type StepCondition =
  /** Compare the costs of earlier selections; the last matching pattern wins. */
  | {
      kind: "ref_cost_pattern";
      stepIds: string[];
      patterns: ({ groups: number[] } | { consecutive: number })[];
      matchIndex: number;
      not?: boolean;
    }
  /** 複数のステップ条件を AND 評価する。 */
  | { kind: "all"; conditions: StepCondition[]; not?: boolean }
  /** 前ステップの結果に特定色のカードが含まれる */
  | {
      kind: "ref_has_color";
      stepId: string;
      colors: CardColor[];
      /** マッチカードの最小枚数（既定 1） */
      minCount?: number;
      /** マッチカードの最大枚数 */
      maxCount?: number;
      /** 条件全体の否定 */
      not?: boolean;
    }
  /** 前ステップの結果にフィルタ合致カードが含まれる */
  | {
      kind: "ref_has_match";
      stepId: string;
      filter: CardFilter;
      /**
       * 数える参照結果（既定: affected）。`DynamicCountSource.cards_from_ref` の
       * `result` と同じ選択肢。
       * - revealed: deck_reveal step でオープンされたカード全体（pick/hand 追加の
       *   有無に関係なく revealed 全体を判定したい場合、BSLH01-C01/BSLH01-R06 型
       *   「オープンしたカードがスピリットのとき」）。affected (既定) は
       *   pick 結果のうち実際に手札へ加わったカードのみ (handAddedCardInstanceIds) を
       *   見るため、手札に加えず読むだけ/デッキへ戻す場合は判定できない
       *   (needs-dsl.audit BSLH01-C01 で判明したギャップの修正)。
       */
      result?: "affected" | "revealed";
      /** マッチカードの最小枚数（既定 1） */
      minCount?: number;
      /** マッチカードの最大枚数 */
      maxCount?: number;
      /**
       * マッチカードの所有者を効果発動元カードとの相対関係で絞り込む（省略時 = 両方許容）。
       * `CardFilter` にはカード所有者を表すフィールドが無い（対象選択軸の `player` とは別に、
       * 「解決後にどちらの所有カードだったか」を見る後方参照用の軸のため）ので、この
       * StepCondition 側に持つ。「この効果で自分の…を戻したとき」型 (BSAZ02-C18) に使う。
       * 判定は `StepExecutionContext.sourceInstanceId` のカードの `ownerPlayerId` を基準にする。
       */
      ownerRelation?: "self" | "opponent";
      /** 参照カードの現在のコントローラーを、発揮元のコントローラーと比較する。 */
      controllerRelation?: "self" | "opponent";
      /** 条件全体の否定 */
      not?: boolean;
    }
  /** 前ステップが成功した（1枚以上処理された） */
  | { kind: "ref_succeeded"; stepId: string; not?: boolean }
  /**
   * 前ステップの action body が実際に走った（観測可能な状態変化または効果ログを残した）。
   * 「そうしたとき」=「○○できる事実」をゲートする用途。成功・耐性で阻止された場合の両方で true、
   * 比較・対象選択の段階で fail-closed return した場合のみ false。
   * - 例: bp_compare_destroy が「BP比べ破壊耐性」で対象を破壊しなかったとき → 比べた事実は成立 → ref_executed:true
   * - 例: bp_compare_destroy が「効果を受けない」耐性で対象を選べなかったとき → 比較自体起きず → ref_executed:false
   */
  | { kind: "ref_executed"; stepId: string; not?: boolean }
  /**
   * 前ステップが相手効果由来の終了妨害 (`restrict_end_*`) を受けて不成立になった。
   * 「相手の効果を受けたとき、この効果をもう一度だけ発揮できる」型の retry gate。
   */
  | { kind: "ref_blocked_by_opponent_effect"; stepId: string; not?: boolean }
  /** 前ステップで影響を受けた件数の比較 */
  | {
      kind: "ref_count";
      stepId: string;
      /**
       * 数える参照結果（既定: affected）。
       * - hand_added: deck_reveal step で実際に手札へ加わったカード
       *   (ENGINE-deck-reveal-hand-added-tracking、「手札に加えなかったとき」型のゲート用)
       * - numeric_amount: StepResult.numericAmount。core_distribute の実配置コア数や
       *   count 増減の実変動量を参照する。
       */
      result?: "affected" | "bp_became_zero" | "hand_added" | "numeric_amount";
      /** 最小件数（既定 1） */
      min?: number;
      /** 最大件数 */
      max?: number;
      /** 条件全体の否定 */
      not?: boolean;
    }
  /**
   * 前ステップ（choice 持ち）で選ばれたチョイスを参照する。
   * 「A か B を選ぶ。A を選んだ場合さらに C を行う」のような分岐パターン用。
   *
   * - choiceIndex 0 = デフォルト action
   * - choiceIndex 1+ = choice[N-1]
   * - 参照先ステップが choice を持たない場合 / 未実行の場合は false
   */
  | {
      kind: "ref_choice";
      stepId: string;
      choiceIndex: number;
      /** 条件全体の否定 */
      not?: boolean;
    }
  /**
   * 参照先ステップで影響を受けたカード（affectedCardInstanceIds）のうち
   * 1 枚以上が現在フィールドを離れている（zone !== "field"）かを判定する。
   * leaveKind 指定時は、参照先 step の影響でその離脱種別 (vanish 等) が記録された
   * カードだけを数える。
   *
   * 「相手のスピリット1体のコアN個をリザーブに置く。この効果で消滅したとき、…」のように、
   * コア移動の結果カードが消滅（コア不足消滅）したことを後続ステップの発火条件にする用途。
   * コア不足消滅は state-based action として `after_triggers` 連結時の flushPendingLeaves で
   * 実移動するため、この条件を持つ後続ステップは connector: "after_triggers" と併用する。
   */
  | {
      kind: "ref_left_field";
      stepId: string;
      leaveKind?: PendingLeaveKind;
      /** 条件全体の否定 */
      not?: boolean;
    }
  /** 同一効果内の「この効果で消滅/破壊したとき」。残留・魂状態への変更で取り消さない。 */
  | {
      kind: "ref_leave_established";
      stepId: string;
      leaveKind: PendingLeaveKind;
      /** BP比べで発揮元も破壊されたかを参照する場合に指定。 */
      subject?: "source";
      not?: boolean;
    }
  /**
   * この効果 (マジック/フラッシュ) が宣言時にどのゾーン (手札/手元/トラッシュ) から発動されたかを
   * 判定する。ENGINE-magic-activation-source-zone-condition: use_magic 発動時のゾーンが
   * StepExecutionContext.activationZone へ運ばれ、その値が zones に含まれるかを見る。
   * マジック発動以外の経路 (通常召喚/誘発等) では activationZone が未設定のため常に false。
   * "trash" は engine-magic-trash-use-permission (BSDB01-R03) で追加。
   * 例: BSTH02.7-C05「手元からフラッシュ効果を使用したこのカードは、効果発揮後に除外する」。
   */
  | {
      kind: "activation_zone";
      zones: readonly EffectActivationSourceZone[];
      /** 条件全体の否定 */
      not?: boolean;
    }
  /**
   * 後続の summon(self) と一体で扱う前置 step 用の precheck。
   * 例: 「対象を戻し、軽減シンボルすべてを満たして召喚できる」では、
   * 召喚コスト/維持コアを満たせない場合に前置の対象移動だけが残らないよう
   * bounce step 側を事前に閉じる。
   */
  | {
      kind: "summon_precheck";
      target?: {
        kind: "self";
        zone?: Zone | Zone[];
        carryOverExistingCores?: boolean;
      };
      costModifier?: CostModifier;
      ignoreSummonCondition?: boolean;
      /** 条件全体の否定 */
      not?: boolean;
    }
  /**
   * 同一効果内で rebirth 前に実行するコスト/配置 step 用の precheck。
   * `executeRebirth` が no-op で返る既知の前提 (カウント超過 / 同一タイミング既転醒 /
   * 発揮元が転醒可能な両面カードでない等) を事前に見て、前置 step だけが残ることを防ぐ。
   * 最低Lv不足は、前置 step でコアを置くことで解消する場合があるためここでは見ない。
   */
  | {
      kind: "rebirth_precheck";
      /** 転醒条件: 自分のカウントがこの値以下。省略時は上限なし。 */
      maxCount?: number;
      /** true のとき count 条件を満たしたものとして扱う。 */
      forceTriggerCondition?: boolean;
      /** 条件全体の否定 */
      not?: boolean;
    };

// ============================================================
// Connector — ステップ接続
// ============================================================

/**
 * EffectStep 間の接続関係。v1 EffectCompositionKind と同値。
 *
 *   - "simultaneous"      — 「さらに」同タイミング、誘発なし
 *   - "sequential"        — 「し、」「その後」順序実行
 *   - "after_triggers"    — 「この効果発揮後」誘発解決を挟む
 *   - "conditional_cost"  — 「○○することで」双方向依存
 *   - "conditional_result" — 「そうしたとき」前の成功が後の前提
 *   - "unless_previous_succeeded" — 前ステップが成功しなかった場合だけ後続を実行
 */
export type Connector =
  | "simultaneous"
  | "sequential"
  | "after_triggers"
  | "after_state_check"
  | "conditional_cost"
  | "conditional_result"
  | "unless_previous_succeeded";

// ============================================================
// アクション型（DSL namespace）
// ============================================================
//
// v1 の EffectAction 各型と名前が衝突するため namespace で隔離。

export type CostModifier =
  | "free"
  | { override: number }
  | { fixedPayment: number }
  | "full_reduction"
  // コスト軽減下限（「このカードの配置コストは0にならない」= floor:1 /
  // 「2コスト以上支払わなければ召喚できない」= floor:2）。軽減後コストを
  // max(floor, printed - reduction) にクランプする継続自己修飾。floor は
  // 印字コストを超えない（min(floor, printed)）。calculateReduction が
  // 自カードの継続 cost_modify 自己ステップから収集する（SSOT、03a §コスト軽減下限）。
  | { floor: number };

export type ResistableOutcome =
  | "leave_field"
  | "destroy"
  | "bounce"
  | "send_to_deck"
  | "vanish"
  | "remove_from_game"
  | "exhaust"
  | "core_below_min"
  // target acquisition lock: 「効果の対象にできず」「含めない」。
  | "targeted"
  | "included"
  // 「BP比べでは破壊されない」: バトルの BP比べ / 効果の bp_compare_destroy 限定の
  // 破壊耐性。通常の効果破壊 ("destroy") とは別軸 (04_state-based-rules.md §BP比べ破壊)。
  | "bp_compare_destroy"
  // destination-zone-scoped resistance: 「このカードの効果以外で(指定ゾーン)に置けない」
  // (BSTH08.5-X04)。上記の outcome群はすべて「離脱」軸 (元のゾーンから離れるか) のみを
  // 区別し、移動先ゾーンを区別できない。第三者ゾーン移動効果 (bounce/return_from_trash/
  // deck_reveal 等) が対象カードを特定ゾーンへ移動させることそのものを阻止する新次元。
  // `entryZone` で対象ゾーンを指定する (ENGINE-set-aside-entry-restriction)。
  | "enter_zone";

export interface EffectTargetFilter {
  /** filterOr 内のいずれかの効果フィルタに合致すればマッチ。 */
  filterOr?: EffectTargetFilter[];
  sourceDefinitionId?: string;
  sourceKinds?: EffectSourceKind[];
  effectIndex?: number | number[];
  effectLabels?: string[];
  heading?: string;
  triggerPhrase?: string;
  keywords?: string[];
  timingKind?: string | string[];
  eventAction?: string | string[];
  activatedMode?: ("main" | "flash" | "stack")[];
  /**
   * 対象効果の steps (choice 分岐含む) にこの action.kind が1つでも含まれるか
   * (いずれか一致)。「デッキオープン効果」(deck_reveal action を含む効果) のような、
   * 見出し/イベント種別では区別できない action 種別ベースの効果分類抑止用
   * (BSAZ02-C03 precedent)。descriptor 側は `SuppressionEffectDescriptor.containsActionKinds`
   * (deriveSuppressionEffectDescriptor が effect.steps を再帰走査して算出、SSOT)。
   */
  containsActionKinds?: string[];
}

export type EffectModifierTarget = "prevention_restriction" | "unblockable";

interface DslDeckRevealPick {
  count: number;
  filter?: CardFilter;
  /** OR 条件フィルタ（いずれか1つに合致すればよい）。 */
  filterOr?: CardFilter[];
  /**
   * 候補があるとき、pick group の空選択を許さない。
   * 「1枚を手札に加える」等の強制 pick 用。省略時 = false（従来通り0..count）。
   */
  mandatory?: boolean;
  /**
   * 選択カードの行き先。
   * - `"hand"` (省略時): 通常の手札追加。
   * - `"field"`: 直接フィールド配置 (配置時誘発が発火)。
   * - `"hand_swap"`: 「手札1枚と入れ替え」。
   *   選択カードを手札に入れ、手札1枚を deck_reveal.remainder の top/bottom/trash へ送る。
   *   手札が空なら pick 諦め（単純 add フォールバックなし）。
   * - `"hand_or_set_aside_swap"`: 「手札/手元と入れ替え」(BSTH09-C04/C05)。
   *   選択カードを手札 or 手元に入れ、入れたゾーンの 1 枚を「このカード」の
   *   行き先 (deck_reveal.remainder = top/bottom/trash) へ送る 1 対 1 物理交換。
   *   per-pick 独立選択 (各 pick について入れ替えるか/どちらと入れ替えるかを別個に決める)。
   *   両ゾーンとも空なら pick 諦め (単純 add フォールバックなし)。
   *   ルール正源: 10_rules/07b §BSTH09-C04/C05「手札/手元と入れ替えられる」(裁定 2026-06-17)。
   * - `"mirage_set"`: コストを支払わずにミラージュとしてセットする (BSGE01-M04)。
   *   model.ts DeckRevealPick.destination 参照。
   * - `"set_aside"`: 常に手元に置く（固定、選択不要）。
   * - `"hand_or_set_aside_choice"`: 「手札に加えるまたは手元に置く」(BSTH08.5-C23)。
   *   swap 型と異なり交換相手を必要としない単純な行き先の自由選択のため、
   *   解決時に別 pending を起こさず、同一の `resolve_pending_deck_reveal_pick`
   *   アクションの追加入力 (`ApplyLegalActionOptions.deckRevealPickFreeDestination`,
   *   `"hand"|"set_aside"`) として渡す。0 枚選択（skip）時は省略可。
   * - `"trash"`: 選択カードを直接トラッシュへ置く (BSKB01-M01「カード1枚をトラッシュに
   *   置ける」)。remainder の一律 trash 化と異なり、他 pick (`"field"` 等) と独立に
   *   1 枚だけを選んでトラッシュへ送れる。moved_to_trash 自動効果の対象になる。
   */
  destination?:
    | "hand"
    | "field"
    | "hand_swap"
    | "hand_or_set_aside_swap"
    | "mirage_set"
    | "set_aside"
    | "hand_or_set_aside_choice"
    | "trash";
  /**
   * 排他選択グループ ID。同じ id を持つ pick group 同士は XOR 関係になる:
   * いずれか 1 グループを満たす選択をすると、同グループの他メンバーは
   * 自動的にスキップされる (「AすべてかB1枚を手札に加える」BSTH08.5-X03 型)。
   * mandatory:true のメンバーが1つでもあれば、いずれかの候補が存在する限り
   * グループ全体で 0 選択は許されない（メンバーいずれかを満たす必要がある）。
   * 全メンバーが候補 0 枚のときのみ 0 選択で通過する。
   * 正源: `getDeckRevealExclusiveGroupBranches`
   * (`legal/deck-reveal-pick-candidates.ts`)。
   */
  exclusiveGroup?: string;
  /**
   * このブランチ（exclusiveGroup のメンバー、または単独 pick）の選択に要求される
   * 追加コスト。「1コスト支払うことで、〜を手札に加える」(BSTH08.5-C23) 型。
   * リザーブ（通常コア優先、不足分はソウルコア）から自動支払いする。
   * `getDeckRevealExclusiveGroupBranches` が支払い不能なブランチを候補0枚として
   * 除外する（未実装 branch と同じ「選択不可」扱い）。実際の選択確定時に
   * `pending-action-handlers.ts` がコストを差し引く。
   */
  costGate?: number;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace DSL {
  export interface GrantDeckHandAccessAction {
    kind: "grant_deck_hand_access";
    player: PlayerRef;
    count: number;
    filter: CardFilter;
    duration: Duration;
  }
  /** このカード自身を指定窓で通常使用できる常時許可。使用コストは免除しない。 */
  export interface GrantMagicUseAction {
    kind: "grant_magic_use";
    timing: "main" | "flash" | "stack";
    duration: Duration;
  }
  export interface RequireEffectCostAction {
    kind: "require_effect_cost";
    player: PlayerRef;
    amount: number;
    events: ("summon" | "attack" | "advent" | "place")[];
    categories: CardCategory[];
    sourceFilter?: CardFilter;
    duration: Duration;
  }
  /** Turn a field card and its attached cards face down without leaving the field. */
  export interface TurnFaceDownAction {
    kind: "turn_face_down";
    target: TargetSpec;
    /** Internal continuation: one already selected member of the original unit. */
    resolution?: "face_down" | "soul_state" | "separate";
  }
  // ════ 制御 ════

  export interface NoopAction {
    kind: "noop";
    /**
     * 指定時、対象を解決するだけで盤面には一切作用しない（副作用なし）。
     * 後続 step が `{kind:"ref", stepId}` でこの step の解決結果（affectedCardInstanceIds）を
     * 参照するための「選択専用」step として使う（ENGINE-brave-combine-third-party-target）。
     * 用例: `brave_combine_effect.source` が参照する「スピリット状態の自分のブレイヴ」の
     * 事前選択（合体元を発動元カード自身以外にする2段階選択の1段目）。
     */
    target?: TargetSpec;
  }

  // ════ カード移動 (11種) ════

  export interface DrawAction {
    kind: "draw";
    count: Count;
    /**
     * ドローするプレイヤー。省略時 = self（従来挙動）。
     * "opponent" で相手にドローさせる（「相手はデッキの上から3枚ドローする」
     * BSTH07-転醒X01(B)[2,3] 等）。
     */
    player?: PlayerRef;
    /**
     * ドロー位置。省略時は "top"（デッキの上から）。
     * "bottom" は「デッキの下から引く」（BSES01-C05 等）。
     * デッキは配列先頭 = top / 末尾 = bottom（move_card と同一規約）。
     */
    position?: "top" | "bottom";
    /**
     * 「手札が N 枚になるまでドローする」(BSLH01-C05 等)。指定時は `count` を無視し、
     * 引く枚数を `max(0, targetHandSize - 現在の手札枚数)` に上書きする。
     * 既に手札が N 枚以上なら 0 枚 (= ドローしない)。DiscardAction.targetHandSize の
     * ドロー版で、`count: 5 - 手札枚数` 型の近似が手札 > N で破綻するのを解消する。
     */
    targetHandSize?: number;
  }

  export interface DestroyAction {
    kind: "destroy";
    target: TargetSpec;
    /** 破壊されたカードの効果抑制。
     * - "destroyed_only": 破壊されたカード自身の効果のみ抑制（離場時効果等）。バーストは抑制しない。
     * - "all_opponent": 破壊に起因する相手の一切の効果を抑制（離場時効果・バースト含む）。
     */
    suppressDestroyedEffects?: "destroyed_only" | "all_opponent";
    /**
     * 残置抑制を「破壊された対象の印字カテゴリがこのリストに含まれる場合のみ」適用する。
     * 未指定なら従来通り対象全体に一律適用。BSTH001-R02『破壊したスピリットはフィールドに残らない』
     * のような『spirit/ultimate 双方を破壊できるが残置抑制は spirit のみ』表現に使う。
     */
    suppressDestroyedEffectsByCategory?: CardCategory[];
  }

  export interface SuppressPendingLeaveEffectsAction {
    kind: "suppress_pending_leave_effects";
    target: TargetSpec;
    /** 既に破壊予約された pending leave に付与する効果抑制スコープ。 */
    suppressDestroyedEffects: "destroyed_only" | "all_opponent";
  }

  export interface VanishAction {
    kind: "vanish";
    target: TargetSpec;
    /** 消滅させた対象の効果抑制（「その効果を発揮させない」）。destroy と同義。
     * - "destroyed_only": 消滅した対象自身の効果のみ抑制（離場時効果等）。
     * - "all_opponent": 消滅に起因する相手の一切の効果を抑制。
     * 指定時は cannot_leave_field 耐性を貫通する（Q19 / P3-74）。
     */
    suppressDestroyedEffects?: "destroyed_only" | "all_opponent";
    /**
     * 「この効果でブレイヴはフィールドに残せない」。消滅対象が合体スピリットのとき、
     * ブレイヴ残存（10_rules/05 選択肢1）を禁じ、ブレイヴもホストと同じ場所へ移動させる
     * （選択肢2を強制。BSTS01-R03）。
     */
    braveCannotRemain?: boolean;
    /**
     * 消滅させた対象の通常コアの行き先を、対象のコントローラー（カードテキスト上の
     * 「相手」＝この vanish の actingPlayerId から見た相手）に選ばせる
     * （「この効果で消滅する…のコアは、相手がリザーブ/トラッシュに置く」BSTH02-X02 界放）。
     * 既存の `core_move` splitDestinations 選択 (`pendingCoreSplitSelection`) を
     * fromLocation:{kind:"card_instance"} + actingPlayerId=対象コントローラーで再利用する
     * （新規 pending 型を作らない SSOT）。省略時は従来どおり reserve 固定。
     * 複数対象が同時に消滅し、いずれも normalCoreCount > 0 の場合は最初の 1 体のみ選択対象とし、
     * 残りは reserve 固定にフォールバックする（`pendingCoreSplitSelection` は単一スロットのため。
     * 現状このフィールドを使うカードは count:1 の vanish のみ）。
     */
    coreDestinationChoice?: {
      /** 選択可能な行き先の集合（順序が UI 表示順）。 */
      options: ("reserve" | "trash")[];
    };
  }

  /**
   * 動的 BP 比較破壊（「AとBのBPを比べ、同じか低い方が破壊される」型）。
   * 比較の片側 (源) と `target` で選んだ 1 体の実効 BP を比べ、「同じか低い」側を破壊する
   * （同値は両方破壊）。両側の破壊は通常破壊（queuePendingLeave 経由）で、相手対象には
   * 相手効果耐性が、源には自分の効果としてそれぞれ既存の executeDestroy 経路で適用される。
   *
   * - `comparer` 省略時 (Pattern 1): 源は効果の発生源カード自身 (このスピリット/アルティメット)。
   *   源が場にいない / 対象未確定のときは何もしない（fail-closed）。
   * - `comparer` 指定時 (Pattern 2): 源を場の別カードから選ぶ版（「自分の『X』1体と相手1体」=
   *   BSFT01-C02 / BSDB01-C09 等のフラッシュマジック型）。`comparer` を resolveTargetSpec で
   *   1 体に解決し、その実効 BP を `target` と比べる。前段の bp_modify ステップで強化した
   *   カードを `{ kind: "ref", stepId }` で参照すれば「BP+N してから比べる」も表現できる。
   */
  export interface BpCompareDestroyAction {
    kind: "bp_compare_destroy";
    /** 比較相手（通常は相手スピリット/アルティメット 1 体）。源とこの対象の BP を比べる。 */
    target: TargetSpec;
    /**
     * 比較の源側 (省略時は効果の発生源カード自身)。場の別カード (例: 自分の「ルーシィ」1体) を
     * 源にする Pattern 2 用。resolveTargetSpec で 1 体に解決し、その実効 BP を比較に使う。
     */
    comparer?: TargetSpec;
  }

  export interface BounceAction {
    kind: "bounce";
    target: TargetSpec;
    maxPreventable?: number;
    /**
     * 移動先ゾーン。省略時は "hand"。"set_aside" で「手元に置く」
     * （SBR バウンスの移動先差。10_rules/04_state-based-rules.md）。
     * "hand_or_set_aside_choice" は対象決定後に各カードの戻し先を選ぶ。
     */
    destination?: "hand" | "set_aside" | "hand_or_set_aside_choice";
  }

  export interface SendToDeckAction {
    kind: "send_to_deck";
    target: TargetSpec;
    position: "top" | "bottom";
    maxPreventable?: number;
    /**
     * 「フィールドに残させない」。`cannot_leave_field` だけを貫通し、
     * outcome 固有の `cannot_be_sent_to_deck` は貫通しない。
     */
    pierceCannotLeaveField?: boolean;
  }

  export interface DiscardAction {
    /** 既に選んだ対象や複数ゾーンの共通選択を参照して破棄する。 */
    target?: TargetSpec;
    /** Exclude cards only treated as hand by an access rule. */
    physicalHandOnly?: boolean;
    kind: "discard";
    count: Count;
    targetHandSize?: number;
    /**
     * targetHandSize で算出した破棄枚数に適用する任意の上限。
     * 二者択一の破棄指定は EffectStep.choice を使う。
     */
    capCount?: CountBound;
    player?: PlayerRef;
    fromZone?: Zone | Zone[];
    filter?: CardFilter;
    /**
     * 「内容を見ないで破棄」(blind/random discard)。true のとき破棄対象を所有者に
     * 選ばせる pendingZoneSelection を生成せず、エンジンが盲目的に枚数分を確定する
     * (= 相手に戦略的選択権を与えない)。強制破棄が候補==枚数で行う自動 slice と同じ
     * 確定経路を、候補 > 枚数の場合にも使う。「相手は1枚選んで捨てる」(選択あり) とは
     * 区別する。例: BSTH03-M07「相手の手札1枚を内容を見ないで破棄」。
     */
    unseen?: boolean;
    /**
     * 複数の破棄候補から選ぶプレイヤー。省略時は破棄対象プレイヤー自身。
     * `"effect_controller"` は「相手の手札の内容を見て、その中の1枚を破棄する」の
     * ように、効果を発揮した側が公開済みの相手手札から選ぶ場合に使う。
     */
    selectionPlayer?: "target_player" | "effect_controller";
    /**
     * 行き先ゾーン。省略時は `"trash"`（通常の手札破棄）。
     * `"deck_bottom"` で「手札からカードをデッキの下に戻す」を表す
     * （例 BSRK01-C03「手札が5枚以下になるように内容を見せずにデッキの下に戻す」）。
     * 選択経路・auto-resolve 経路ともにこの行き先を尊重し、`deck_bottom` のときは
     * トラッシュ移動の代わりにデッキ末尾へ移し deckCount を増やす。`targetHandSize` /
     * `unseen` などの選択ロジックは共通（SSOT）で、変わるのは最終的な行き先だけ。
     */
    destination?: "trash" | "deck_bottom";
    /**
     * true のとき、破棄カードの moved_to_trash 自動効果をこの discard 内では発火しない。
     * 同じ効果内の「その後」後続 step を割り込ませないため、後続の
     * `process_moved_to_trash` step で明示的に処理する。
     */
    deferMovedToTrashEffects?: boolean;
    /**
     * true のとき、この discard でトラッシュに置かれたカード自身の
     * moved_to_trash 自動効果を発揮させない。
     * 「〜を破棄し、その効果を発揮させない」型に使う。defer と異なり、
     * 後続の process_moved_to_trash で再開する意図はない。
     */
    suppressMovedToTrashEffects?: boolean;
  }

  export interface ProcessMovedToTrashAction {
    kind: "process_moved_to_trash";
    /** moved_to_trash 処理対象カードを記録した先行 step。 */
    source: { stepId: string };
    /** トリガー文脈の移動前ゾーン。省略時は `"deck"`。 */
    fromZone?: Zone;
  }

  /**
   * 「相手のバーストN個を破棄する/手札に戻す」(BSRK01-C06 / BSES01-M01 等)。
   * 対象は対象プレイヤーの `setBurstStates`（裏向きでセット中のバーストカード）。
   * 内容は acting プレイヤーに公開されないため、効果の対象としては「ゾーン内枚数指定」
   * 相当でカード単体は識別不能（公式裁定 Q4185 と同型: 内容を見ないで枚数分を選ぶ）。
   * 実装は決定的に先頭から N 枚を pick して指定 destination へ移動し setBurstStates から除く。
   *
   * ENGINE-composite-heterogeneous-removal-budget (BSTH09-X01 effects[1]) 向けに `count` を
   * `Count` へ拡張した（従来は固定 `number` のみ）。`DynamicCount`（単一の動的値、例:
   * 前段 step の残り予算参照）は `resolveCountToNumber` 経由で解決する。
   * `{min,max}` 範囲指定（「バーストN個まで」＝プレイヤーが 0..N を選ぶ型）は
   * `pendingDiscardSetBurstCountSelection`（P3-88 pendingCoreCountSelection と同型の
   * 「枚数のみ選択」pending、native-action-registry.ts discard_set_burst ハンドラが生成、
   * native-target-resolution.ts の discard_set_burst 分岐は範囲を検出すると min 丸めをせず
   * `undefined` を返して未解決を伝える）で対応済み。
   *
   * 防げない指定が必要な場合（BSLH01-R03「この破棄効果は相手の効果で防げない」）は
   * `unpreventable: true` を立てる。burst ゾーンのカード対象耐性は実行時に
   * card immunity gate で判定され、unpreventable はその gate を貫通する。
   */
  export interface DiscardSetBurstAction {
    kind: "discard_set_burst";
    /** バーストの所有プレイヤー。省略時 = "opponent"。 */
    player?: PlayerRef;
    /**
     * プレイヤー選択対象。省略時は従来互換で対象プレイヤーの setBurstStates 先頭から
     * `count` 枚を決定的に採用する。指定時は registration / pending target selection の
     * `preSelectedIds` 経路で選んだ裏向き burst カードだけを移動対象にする。
     */
    target?: TargetSpec;
    /**
     * 破棄する枚数（実在枚数を上限にクリップ）。固定値のほか `DynamicCount`（単一の動的値）、
     * `{min,max}` 範囲（`pendingDiscardSetBurstCountSelection` 経由の枚数選択、上記コメント
     * 参照）を指定できる。
     */
    count: Count;
    /**
     * 行き先。省略時は従来どおり trash。`"deck_bottom"` で「デッキの下に戻す」
     * （BSAZ02-C05「相手のバースト1つをデッキの下に戻す」）。`DiscardAction.destination`
     * の deck_bottom 分岐と同じ reset パターン（zone:deck + コア/合体/アンダーカードの
     * リセット + deckCount 加算、SSOT）。
     */
    destination?: "trash" | "hand" | "deck_bottom";
    /** true = 「相手の効果で防げない」破棄。defense ゲートを bypass する予約フラグ。 */
    unpreventable?: boolean;
  }

  export interface SearchZoneAction {
    kind: "search_zone";
    /**
     * `"set_aside"` は単独指定のみ対応（手元1枚を対象化する「除外することで残る」型、
     * BSTH08.5-X01。hand/trash との混在は現状未使用のため未対応）。
     */
    zone:
      | "deck"
      | "trash"
      | "hand"
      | "set_aside"
      | Array<"hand" | "trash" | "set_aside">;
    /**
     * Search scope narrowed by an earlier step result. Used for effects that
     * first move deck cards to trash, then choose "from among them".
     */
    target?: TargetSpec;
    /**
     * 操作対象ゾーンの所有プレイヤー。省略時 = self（従来挙動）。
     * `opponent` 指定で相手のトラッシュ/デッキを対象にできる
     * （例: BSFT01-TR11(B)/BSTH07-転醒X01(B)「相手のトラッシュのカードをデッキの下に戻す」）。
     */
    player?: PlayerRef;
    filter?: CardFilter;
    count: Count;
    /**
     * `"hand_or_set_aside_choice"` は「手札/手元に戻す」のカード別行き先選択。
     * `PendingZoneSelection` の同名 destination として解決し、
     * `ApplyLegalActionOptions.zoneSelectionDestinationByCardId` で各カードの行き先を渡す。
     */
    destination: CardZone | "hand_or_set_aside_choice";
    destinationPosition?: "top" | "bottom";
    /**
     * 候補超過 pendingZoneSelection の枚数選択を exact にするか。
     * 「戻せる」等の発揮有無は step.executionMode:"optional" で表し、実行を選んだ後に
     * 「1枚」「N枚」の exact 枚数を要求する場合は `mandatory:true` で canSkip:false を伝搬する。
     * 省略時 = false: 候補超過時の pendingZoneSelection は 0..maxCount を許可する。
     */
    mandatory?: boolean;
  }

  export interface DeckRevealAction {
    kind: "deck_reveal";
    /** 公開カード固有の処理後、取得カードを選ぶ前に行う手順。元stepのrevealed結果を参照できる。 */
    beforePickSteps?: EffectStep[];
    /** 取得カード選択後、公開ゾーンから移動する前の手順。元stepのrefは選択済みカード。 */
    beforeMoveSteps?: EffectStep[];
    /** 対象デッキのプレイヤー。省略時 = self */
    player?: PlayerRef;
    /**
     * オープンする枚数。固定値のほか `DynamicCount` で「自分のリザーブのカード数につき」
     * 等の動的枚数も表現できる (ENGINE-deck-reveal-count-amount、既存 resolveAmountToNumber
     * 経由で解決。BSLH01-M04/X09 の「対象1体につき」「+1できる」系ギャップの前提primitive)。
     */
    revealCount: Amount;
    /**
     * オープン/閲覧したカードの可視範囲。省略時は従来どおり "both"。
     * 「内容を見る」型は "self" を指定し、revealed 効果も発火させない。
     */
    revealTo?: "self" | "opponent" | "both";
    picks: DslDeckRevealPick[];
    /**
     * 残りカードの戻し先。
     * `"top_bottom_split"` は残り各カードをデッキ上/下へ個別に分配し、各側の順序も選ぶ。
     */
    remainder:
      | "top"
      | "bottom"
      | "top_or_bottom"
      | "top_bottom_split"
      | "bottom_or_trash"
      | "player_choice"
      | "trash";
    /**
     * true のとき、オープンしたカード自身の `card_event(event:"revealed")` 効果
     * (revealed disposition の自動発火/手札追加) を一切評価しない
     * (「オープンしたカードの効果は発揮されない」BSAZ01-CX01[4])。
     * 省略時 = false（従来どおり revealed 効果を評価する）。
     */
    suppressRevealedEffects?: boolean;
    /**
     * この deck_reveal で field へ召喚/配置したカード自身の「召喚/配置時」効果を
     * 発揮させない。第三者の同イベント観測は抑止しない。
     */
    suppressFieldEntryEffects?: boolean;
  }

  /**
   * 手札公開アクション。対象プレイヤーの手札内容を指定相手に公開する。
   * - カードのゾーン移動は伴わない（手札のまま）。
   * - `filter` 指定時は該当カードのみが対象。公開対象を「スピリットカードのみ」等に絞るときに使う。
   * - GUI 側では `revealTo` に応じて公開表示する。`self` = 効果オーナーに見せる、`opponent` = 相手に見せる、`both` = 両者に見せる。
   * - 「見る」（観察者のみ）と「公開」（相手にも見せる）の差は `revealTo` で表現する。
   * - 現状は純粋な閲覧アクション。公開後にカードを選ばせて破棄/破壊する等の複合処理は、
   *   続くステップで `discard` / `destroy` 等を `player=opponent` で呼び出して表現する。
   *
   * 例: 「相手の手札の内容を見て、その中のスピリットカード1枚を破棄する」 (BSKB01-TX01(B))
   *   → reveal_hand(player=opponent, revealTo=self, filter={category:["spirit"]})
   *   → discard(player=opponent, count=1, filter={category:["spirit"]})
   */
  export interface RevealHandAction {
    kind: "reveal_hand";
    /** Explicit selection, shared with other target-selecting actions. */
    target?: TargetSpec;
    /** 「オープンする」。Merely looking at contents leaves this false. */
    open?: boolean;
    /** 公開される手札の所有プレイヤー。省略時 = self */
    player?: PlayerRef;
    /** 手札を見ることができるプレイヤー */
    revealTo: "self" | "opponent" | "both";
    /** 公開する枚数。省略時は対象手札すべて。 */
    count?: number;
    /** 公開対象の絞り込み。省略時は手札全枚を公開。 */
    filter?: CardFilter;
  }

  /**
   * デッキ閲覧アクション。デッキ上 N 枚の内容を `revealTo` で指定した相手に開示する。
   * カードのゾーン移動は伴わない。並び替えが必要な場合は後続ステップで `move_card` 等を組み合わせる。
   *
   * 例: 「ターンプレイヤーのデッキの上から5枚内容を見る」(BSAZ02-X01)
   *   → peek_deck(player=turn_player, count=5, revealTo=self)
   */
  export interface PeekDeckAction {
    kind: "peek_deck";
    /** 閲覧対象デッキの所有プレイヤー。省略時 = self */
    player?: PlayerRef;
    /** デッキ上から閲覧する枚数 */
    count: number;
    /** 内容を見ることができるプレイヤー */
    revealTo: "self" | "opponent" | "both";
  }

  /**
   * 指定ゾーンをシャッフルする。
   * 通常はデッキを対象にするが、トラッシュ等にも適用可能。
   *
   * 例: 「自分のデッキをシャッフルし、その後、デッキの上から1枚までドローする」(BSLH01)
   *   → shuffle_zone(zone="deck") → draw(count=1)
   */
  export interface ShuffleZoneAction {
    kind: "shuffle_zone";
    /** シャッフル対象ゾーン */
    zone: Zone;
    /** 対象ゾーンの所有プレイヤー。省略時 = self */
    player?: PlayerRef;
  }

  export interface MoveCardAction {
    kind: "move_card";
    /** 効果解決中に確定した、ミラージュ各個体の追加/交換先（内部継続用）。 */
    mirageReplacementsByInstanceId?: Readonly<
      Record<string, readonly string[]>
    >;
    /** 上記選択の前に確定した移動元。unseenの再抽選と二重適用を防ぐ内部継続値。 */
    mirageSourceInstanceIds?: readonly string[];
    /**
     * 明示的に移動カードを選ぶ場合の対象指定。
     * 省略時は従来どおり from の候補先頭から count 枚を移動する。
     */
    target?: TargetSpec;
    from: {
      /**
       * 移動元ゾーン。配列指定時は複数ゾーンを合算した候補プールにする
       * (`DiscardAction.fromZone` と同じ `Zone | Zone[]` 正規化パターン、engine-tx01b-under-card-multi-select)。
       * 「手札/トラッシュのCFコスト6以下アルティメットを複数選択で下に加える」
       * (BSAZ02-TX01(B) backFace effects[1]) のような、単一ゾーンに閉じない選択候補プールに使う。
       */
      zone: Zone | Zone[];
      player: PlayerRef;
      position?: "top" | "bottom";
      filter?: CardFilter;
      /**
       * sourceInstanceId の underCards だけを移動候補にする。
       * 「このスピリットの煌臨元カードを破棄する」など、host 固有の下カード移動で使う。
       */
      sourceUnderCardRole?: "advent_source" | "text_role";
      /**
       * engine-under-card-multi-host-discard (BSAZ02-M01): `hostFilter` に一致する自分の場の
       * カードすべてを host 候補として横断的に解決し、そのうち `hostUnderCardRoleTag` 一致の
       * text_role アンダーカードすべてを移動候補にする。`sourceUnderCardRole` が
       * sourceInstanceId (発動元カード自身) 固定なのに対し、本フィールドは host 側を
       * CardFilter で動的に複数解決する（「自分の『揚陸城』すべての下にある
       * 『アルドノアドライブ』すべてを破棄する」型）。両フィールドは併用不可。
       */
      hostFilter?: CardFilter;
      /** hostFilter 使用時の対象 roleTag (text_role 限定)。hostFilter 指定時は必須。 */
      hostUnderCardRoleTag?: string;
    };
    to: {
      zone: CardZone;
      player?: PlayerRef;
      position?: "top" | "bottom";
      /**
       * sourceInstanceId の underCards として移動先にする。
       * 手札/フィールドのカードを「このスピリットの下に煌臨元カードとして追加する」
       * など、host 固有の下カード追加で使う。
       */
      sourceUnderCardRole?: "advent_source" | "text_role";
      /**
       * `sourceUnderCardRole:"text_role"` 時の役割タグ (`place_text_role_under_card` の
       * `roleTag` と同じ語彙)。host 定義の `underCardSlots`（該当 roleTag の maxCount）が
       * 宣言されていれば空き枠数まで自動クランプする（`hasOpenTextRoleUnderCardSlot` と同じ
       * SSOT、engine-tx01b-under-card-multi-select）。省略時はタグ無し (advent_source と同様の
       * 無条件アタッチ、既存挙動を保つ)。
       */
      textRoleTag?: string;
    };
    count: Count;
    /**
     * `true` のときだけ、この deck → trash 移動を「デッキを破棄する」効果として
     * 扱う。単に「デッキの上からN枚をトラッシュに置く」効果とは別の行為であり、
     * `prevent_deck_discard` / `redirect_deck_discard_to_exclude` はこちらだけに作用する
     * (公式 Q3895/Q3900)。省略時は通常のゾーン移動。
     */
    deckDiscard?: boolean;
    /**
     * true のとき、移動候補が `count` に満たなければ何も移動しない。
     * 「N枚を破棄することで」型の conditional_cost で部分支払いを防ぐ。
     */
    requireFullCount?: boolean;
    /**
     * 「内容を見ずに/見ないで」移動する blind move。true のとき、target 未指定の
     * 自動移動候補を内部順の先頭固定にせず、候補をシャッフルしてから count 枚を
     * 確定する。移動先は `faceDown` とは独立し、公開ゾーンへの移動は通常どおり表向き。
     * 例: BSLH01-C07「相手の手札1枚を内容を見ずに手元に置く」。
     */
    unseen?: boolean;
    /**
     * 移動先での裏向き指定 (P3-47 F-1)。
     * - true: 移動カードを `faceDown=true` で配置 (相手 viewer から定義情報が秘匿される)。
     *   主に「裏向きでフィールドに置く」効果に使う。
     * - false: 明示的に `faceDown=false` で配置。
     * - 省略時: 既存 face-down 状態はゾーン移動で常に解除される
     *   (`applyFaceDownPolicyOnZoneChange`、2026-05-29 裁定)。裏向き維持には true を明示する。
     */
    faceDown?: boolean;
  }

  /**
   * 効果借用（マジック効果コピー）。`target` で選んだ他マジックカードの
   * `effects[]` から、`borrowModes` に一致する `timing.kind:"activated"` の
   * 効果を1つ見つけて、この効果自身のものとして発揮する（初のカード横断効果借用
   * primitive。BSAZ03-M01 effects[2,3]「トラッシュの他マジックの
   * メイン/フラッシュ/スタック効果1つを発揮する」が初出）。
   *
   * - 借用元候補の絞り込みは既存 `TargetSpec` + `CardFilter` をそのまま使う
   *   （`CardFilter.hasActivatedEffectMode` で「対象が borrowModes のいずれかの
   *   printed activated 効果を持つか」を絞り込む。stub 実装状態には依存しない
   *   — `cardHasPrintedEffectText` と同じ「印字データベース、実装状態非依存」原則）。
   * - 一致効果が複数存在する場合は `effects[]` 内の最初の一致を用いる
   *   （2026-07-04 時点のカードプールには同一カードに同一 timing.mode の
   *   非stub活性効果が2つ以上存在する例は無い。将来そのようなカードが追加された
   *   場合は改めて選択 UI を設計する）。
   * - 借用効果の steps がまだ stub (steps:[]) の場合、実行しても何も起きない
   *   (安全な no-op)。それでも「効果は発揮された」ものとして扱い、
   *   `thenMove` は実行する（RAW上は効果が解決したこと自体は事実であり、
   *   借用先カードの実装未了は本カードの解決を妨げない）。
   */
  export interface BorrowMagicEffectAction {
    /** 借用対象の選択後、本文の発揮前に移動する。派生誘発は本文へ割り込まない。 */
    beforeMove?: { zone: CardZone; fromZone?: Zone | Zone[] };
    kind: "borrow_magic_effect";
    /** 借用元カードの選択（通常は zone+filter で1枚）。 */
    target: TargetSpec;
    /**
     * 借用可能な被借用効果の `timing.mode` 集合。このアクション自身の発動窓
     * (flash/stack) に応じて呼び出し側 (card-data) が指定する
     * （例: flash発動時は `["main","flash"]`、stack発動時は `["stack"]`）。
     */
    borrowModes: ReadonlyArray<"main" | "flash" | "stack">;
    /**
     * 原文が借用元カードを「使用できる」と明示する場合、そのカードを通常のマジック
     * 使用として宣言する。`in_use` 遷移、フラッシュ使用記録、使用前反応窓、解決後 cleanup と
     * `activation_zone` 条件（例: 手元から使用後は除外）をすべて通常のマジック経路で扱う。
     *
     * 省略時は従来どおり「この効果自身のものとして発揮する」だけであり、借用元を
     * 使用したとは扱わない。「オープンして効果を発揮する」型にゾーン固有の使用後処理を
     * 誤適用しないための明示 opt-in。
     */
    treatAsMagicUse?: boolean;
    /**
     * 借用効果発揮後、借用元カードをどこに移すか（例: フィールドに残置）。省略時は移動なし。
     * `treatAsMagicUse:true` の場合は通常のマジック cleanup が移動を担うため、この指定は使わない。
     * `fromZone` 省略時は `["trash"]`（BSAZ03-M01 の後方互換）。借用効果解決後も対象が
     * `fromZone` のいずれかに留まっている場合だけ `zone` へ移す。
     * 本文の発揮前に置く指定は `beforeMove` を使う。
     */
    thenMove?: {
      zone: CardZone;
      player?: PlayerRef;
      fromZone?: Zone | Zone[];
      /** 「効果発揮後」は派生・内側の発揮後まで待つ。 */ afterTriggers?: boolean;
    };
    /**
     * 借用先効果の実行にのみ適用する防止レベル委譲（「この効果で発揮する…効果は、
     * 相手の効果を受けない」BSRK01-X02[5] 型）。この borrow_magic_effect 自体の
     * 発動・解決の防止可否には影響しない（`effect.preventionLevel` とは独立。
     * effect 直下に付けると借用宣言自体まで unpreventable 化してしまい、原文の
     * 主語（借用先の被借用効果）を超えて広すぎる — adversarial verifier 2026-07-26 refute）。
     * 指定時は `ctx.effectMeta.sourcePreventionLevel` より優先する。
     */
    borrowedEffectPreventionLevel?: import("./model").EffectPreventionLevel;
  }

  /**
   * 効果借用（card_event 効果コピー）。`target` で選んだカードの `effects[]` から、
   * `borrowEvents` に一致する原文ラベル（例: `attack` → 『このスピリットのアタック時』）の
   * 効果を1つ見つけ、この効果の発動元カードを source として発揮する。
   * `timing.kind:"card_event"` / `timing.event` だけでは照合せず、「このスピリットが
   * アタックしたとき」など別ラベルの実装は借用候補にしない。
   *
   * 初出: BSFT01-TR03(B) 【星霊衣】「相手の『アタック時』効果1つをこのスピリットの
   * 効果として発揮できる」。借用元の効果が「このスピリット」を参照する場合、
   * source は借用元ではなくこの効果の sourceInstanceId になる。
   */
  export interface BorrowCardEventEffectAction {
    kind: "borrow_card_event_effect";
    /** 借用元カードの選択（通常は相手フィールドのスピリット/アルティメット1体）。 */
    target: TargetSpec;
    /** 借用可能な被借用効果の `card_event` 集合。 */
    borrowEvents: ReadonlyArray<CardEventType>;
    /**
     * true のとき、応答中の効果だけを発揮させず、かわりに自分の効果として発揮する。
     * 借用対象を現在の応答スタックへ限定し、そのスタックの抑止要求を登録する。
     * 借用元カードの将来の発揮を止める継続効果は作らない。
     * 通常の借用「発揮できる」(BSFT01-TR03(B)[10,11]) は付けない。
     * 初出: BSFT01-TR03(A)[4,5]。
     */
    suppressBorrowedEffect?: boolean;
    /**
     * true のとき、借用先効果の `condition` から `min_level` 節を除いて評価する
     * （「Lvを無視して発揮する」型、BSLH01-R01[3,4]）。借用先カードは魂状態セット直後で
     * 通常のフィールド上レベル解決を経ないため、Lv 条件だけを明示的にバイパスする。
     * `min_level` 以外の condition 節（他 CardFilter 系）は通常どおり評価する。
     * resume（対象選択継続後の再実行）では condition を再評価しないためこのフラグは
     * 初回評価にのみ影響する。
     */
    ignoreLevelCondition?: boolean;
    /**
     * 指定時、借用元カードの `tribe`（"・" 区切り）がこの配列のいずれかを含まない場合は
     * 借用元候補ゼロ扱いで no-op する（「系統：「CB」を持つカードの…効果を…発揮する」型、
     * BSLH01-R01[3,4]）。判定は SSOT の `matchesTribes`（card/tribe-filter.ts）へ
     * `{ tribes }` だけを渡して再利用する（tribes 既定 = OR）。
     * pending choice へ持ち越す必要はない（choice 生成前に判定するため）。
     */
    requiredTribes?: readonly string[];
    /**
     * true のとき、借用先効果内の `target:{kind:"self"}` / `{kind:"source_card"}` は
     * この step の発動元カード (host) ではなく、借用元カード (`target` で選んだカード)
     * 自身に解決される。「セットした/選んだ○○カードの『このスピリットの…』効果を
     * 発揮する」型（BSLH01-R01[3,4] 「セットした系統：「CB」を持つカードの…効果を
     * …発揮する」）で使う。省略時（デフォルト false）は host に解決される
     * （BSFT01-TR03(A)/(B) 「このスピリットの効果として発揮する」型の既存挙動）。
     * usage-limit の記録・ログ上の実行主体は host のまま変えない（この flag は
     * 借用先効果本体の実行コンテキストのみに作用する）。
     */
    attributeToBorrowedCard?: boolean;
    /**
     * true のとき、現在の応答対象スタックを borrow_card_event_effect の解決完了まで
     * pendingStackCascade 側で待機させる。不発/nullify ではない。借用元効果そのものを以後
     * 抑止する `suppressBorrowedEffect` とは別軸で、「自分の別効果を先に発揮し、その解決後まで
     * 相手の pending stack 効果を発揮させない」型に使う。
     */
    suppressResponseStack?: boolean;
  }

  /**
   * ENGINE-conditional-free-magic-use-on-event: 「手札にあるこのカードは、
   * 〔game_eventトリガー〕とき、コストを支払わずに使用できる」型の条件付き無償
   * マジック使用。`applicability.zone:"hand"` + `timing.kind:"game_event"` の
   * 効果（例: BSAZ02-C15「自分のライフが減ったとき」）が誘発・解決されたときの
   * 唯一の step として使う。解決元カード自身 (source instance) を、コストを支払わず
   * `magicTiming` の効果本体で発揮する（P3-34 により誘発効果解決自体が先にスタック窓を
   * 開くため、この step 実行時点では反応機会は既に確保済み — 二重スタック化しない）。
   */
  export interface UseMagicWithoutCostAction {
    kind: "use_magic_without_cost";
    /** 発揮する効果本体の timing.mode（カード自身のフラッシュ/メイン効果）。 */
    magicTiming: "main" | "flash";
  }

  export interface RemoveFromGameAction {
    kind: "remove_from_game";
    target: TargetSpec;
    /**
     * 「この効果で離れた対象はフィールドに残せない」（BSLH01-T10 等）。
     * 指定時、相手の `cannot_leave_field` 常時効果を貫通する（Q19 / P3-74 と同機構）。
     * `cannot_be_removed_from_game` 等の outcome-specific 耐性は貫通しない。
     */
    pierceCannotLeaveField?: boolean;
  }

  /**
   * このカード自身を指定ゾーンに移動する。
   * card_event "revealed" / "moved_to_trash" 等のステップ内で使用。
   * フィールドへの移動（召喚）は summon を使うこと。
   * 手元 = "set_aside"。オープン中カードは runtime の一時状態 "revealed" で表す。
   */
  export interface MoveSelfAction {
    kind: "move_self";
    destination: CardZone;
    /**
     * @deprecated 互換用。場からの移動は共通離場処理と状態差分で通知する。
     */
    emitLeaveFieldEvent?: boolean;
  }

  /** 手札/手元のカード1枚を効果でバーストとしてセットする。 */
  export interface SetBurstAction {
    kind: "set_burst";
    /** 通常セットのターン1回制限を消費せず、既存セットは破棄して置き換える。 */
    target: TargetSpec;
  }

  /**
   * 効果解決中のこのカード自身を、コストを支払わずにミラージュとしてセットする。
   * `target` 省略時は従来通り自分自身（発揮元カード）が対象。
   */
  export interface SetSelfAsMirageAction {
    kind: "set_self_as_mirage";
    /** 効果解決中に確定した追加（0件）または交換先1枚。 */
    replacedMirageInstanceIds?: readonly string[];
    /** 既に自分のミラージュがセットされている場合は no-op。 */
    onlyIfNoMirage?: boolean;
    /**
     * 発揮元カード以外を対象にする場合に指定する（`{kind:"ref", stepId}` で先行
     * target-selection step の選択結果を参照する等）。ENGINE-mirage-set-target-primitive
     * 初出（BSTH002-X01[3,4]「自分の手札にあるミラージュ効果を持つ白/紫のカード1枚を
     * コストを支払わずにセットすることで」— 発揮元カード自身ではなく手札から選んだ
     * 別カードをコストなしセットする）。解決は resolveTargets の標準経路
     * （`ctx.resolvedTargetIds`）に委ね、専用の解決ロジックを持たない (SSOT)。
     * 対象が0件に解決された場合は何もせず state を返す（log を残さない = `executed:false`。
     * `stepCondition:{kind:"ref_executed"}` で後続 step をゲートできるようにするため、
     * 発揮元カードへのフォールバックは行わない）。
     */
    target?: TargetSpec;
  }

  export interface SummonAction {
    kind: "summon";
    /**
     * この summon step が、即時効果内の召喚ではなく「通常の召喚/配置行動を許可する
     * 常時効果」を表すことを明示する。
     *
     * `activated` / `mode:"main"` / 先頭 step / 「召喚できる」という文言からの推測は
     * Q51（即時効果内召喚）と Q54（通常行動許可）を混同するため禁止する。Q54 だけが
     * `timing.kind:"continuous"` と本フラグを併記し、通常の summon/place legal action
     * パイプライン（宣言コスト → stack → 維持コア配置）へ接続される。
     */
    normalActionPermission?: true;
    /**
     * `normalActionPermission` による通常行動の宣言時、カードコスト処理と同じく
     * stack window を開く前に実行する step 群。
     *
     * BSKB01-M02「カウントを0にすることで…そうしたとき…」型の、許可された通常召喚に
     * 付随する宣言時処理を既存 Action / EffectStep で表す。対象を取る場合は通常行動の
     * legal action に候補を載せ、宣言入力として確定してからこの step 群へ渡す。
     */
    normalActionDeclarationSteps?: readonly EffectStep[];
    target:
      | {
          kind: "self";
          /**
           * 「手札にあるこのカードは...召喚コストを支払って...召喚できる」型の通常コスト
           * 支払い召喚 (engine-summon-target-self-paid-cost、BSTH07.8-X01 界放：3)。
           * 省略時 (既定) は従来どおり無料召喚 (`v1Action.zone` 未セット→
           * `executeSummonSelf` の costToPay 計算が常に0)。指定時のみ `from_zone` と同型の
           * 「ゾーン制約 + 通常コスト支払いトリガー」を native `SummonAction.zone` へスレッド
           * する (native 側は元々 target:"self" でも zone 制約/コスト計算の両方に使う設計、
           * DSL 側が露出していなかっただけ)。監査済み: 既存 landed カードの target:{kind:"self"}
           * 使用箇所はいずれも本文に「コストを支払って」等の明示的支払い文言が無く（唯一の例外が
           * BSTH07.8-X01）、この opt-in 設計により無料のまま影響しない。
           */
          zone?: Zone | Zone[];
          /**
           * 召喚前に対象カード（手札等オフフィールド）へ既に置かれているコア
           * (`CardInstance.normalCoreCount`) を、フィールド進入時の維持コア计算に持ち越す
           * (BSTH07.8-X01【界放：3】「自分の導界者ネクサスのコア3個をこのスピリットに置く」→
           * その3個はフィールド進入後もこのカード上に残る、要求される維持コア数が既に満たされて
           * いれば追加のリザーブ配置は要求しない)。省略時 (既定 false) は従来どおり `executeSummonSelf`
           * が召喚時に `normalCoreCount` を無条件で0リセットする（他の全 target:self 消費者は
           * オフフィールド中にコアが乗ることが無いため既存挙動と完全に同一）。
           */
          carryOverExistingCores?: boolean;
        }
      | {
          kind: "from_zone";
          zone: Zone | Zone[];
          filter?: CardFilter;
          count: Count;
          /**
           * 「手札/トラッシュ/煌臨元にある〜を召喚できる」の煌臨元 (advent_source) 分。
           * `zone` の通常ゾーン探索に加えて、自分の煌臨元アンダーカードも召喚候補へ含める
           * (BSSL01-X01[5,6])。`ApplicabilityZone.advent_source` と同じ理由で、煌臨元は
           * runtime Zone 上 "field" のままホストの下に重なるため `zone` 列挙では表現できず、
           * orthogonal なフラグとして分離する。SSOT: `SummonAction.includeAdventSource` (model)。
           */
          includeAdventSource?: boolean;
          /**
           * 「手札/手元/トラッシュ/魂状態/...から召喚できる」の魂状態分。
           * 魂状態カードは runtime Zone 上 "field" のまま `soulStateInstanceIds` に登録されるため、
           * `zone` の通常列挙とは独立した候補 union として扱う。
           */
          includeSoulState?: boolean;
          /**
           * 「自分のスピリット/アルティメットが相手の効果でフィールドを離れるとき、その
           * 煌臨元の...カードすべてをコストを支払わずに召喚できる」型 (BSSG01-C08 Lv2)。
           * true のとき、`zone`/`filter` で一致した候補を、pending leave pre-flush で
           * スナップショットされた煌臨元 instanceId 群 (`StepExecutionContext.
           * triggerAdventSourceInstanceIds`、離脱カードの underCards role="advent_source"
           * を host 物理離脱前に捕捉したもの) との交差にさらに絞り込む。同ゾーン
           * の無関係な一致カードを混ぜず、離脱した特定カードのチェーンだけに
           * 限定する。SSOT: engine-advent-source-leave-summon。
           */
          restrictToTriggerLeaveAdventSource?: boolean;
        }
      /**
       * トークン（別デッキ）からのスピリット出現 (engine-token-summon-primitive)。
       * `CardDefinition.relatedTokenCardNos[0]` が指すトークンカード定義から、既存
       * ゾーンを経由せず新規 CardInstance を直接フィールドへ生成する。`from_zone` の
       * hand/set_aside/trash はいずれも「既に GameState 上に実在するカード」を前提と
       * するため候補選定に流用できず、専用 target variant として分離した
       * （soulState:"only" が同じ理由で `from_zone` から独立した専用実行経路
       * `executeSoulStateSummon` に分岐するのと同型）。
       * 利用可能枚数は `CardDefinition.maxTokenDeckCount` からフィールド上の同定義
       * カード枚数 (自分所有分) を差し引いた残数で頭打ちにする (BSSL01-C06)。
       * フィールド進入時コア配置は通常の維持コア配置へ合流する。`voidCoreMaxPerCard`
       * 指定時は `pendingMultiPlacement` の対象ごとにボイド通常コアの上限を公開し、
       * プレイヤー入力で reserve/field/void の配置を決める。
       */
      | {
          kind: "from_token_pool";
          /** トークンデッキにある効果元自身を出す。省略時は関連トークン。 */
          source?: "self";
          count: Count;
          /**
           * true のとき `count` は無視され、発動元カードの `relatedTokenCardNos` の
           * 全エントリのうち、まだフィールドにいない (`maxTokenDeckCount` 残数 > 0)
           * ものを1体ずつ出す ("1体ずつ[まで]" 型、engine-multi-token-pool-summon、
           * BSLH01-C12[3]/BSLH01-X02[8])。既存の単一型 (`relatedTokenCardNos[0]`
           * 固定) 経路とは独立した専用実行経路 (`executeAllRelatedTokensSummon`)
           * に分岐する — 印字コストは課さない (「出す」= コストを支払わない配置。
           * 呼び出し元カードが別途コストを要求する場合は `pay_cost` ステップを前段に
           * 置き `connector:"conditional_cost"` で結線する。1体も出せない場合は
           * 他 target 同様 no-op ログのみで、対象カードが1枚も増えないため
           * `conditional_cost` 経由なら「△△できない」としてコスト側もロールバックされる)。
           */
          allRelatedTokens?: boolean;
        }
      /**
       * 直前 step で選択/影響を受けた特定カードインスタンス群を、zone 探索や
       * フィルタ判定を経由せずそのまま召喚対象にする (engine-exclude-owner-resummon-exhausted、
       * BSLH01-M03「除外した対象を持ち主のフィールドに疲労状態でコストを支払わずに召喚する」)。
       * `{ kind: "ref", stepId }` TargetSpec と同じ「先行 step の解決結果
       * (`affectedCardInstanceIds`) 参照」慣用句を summon 側にも持ち込んだもの。
       * `from_zone`/`from_token_pool` は毎回候補を再探索するため、「一度選んだ具体的な
       * カード集合を後段でそのまま召喚する」型には使えない。
       */
      | {
          kind: "ref";
          stepId: string;
        };
    /**
     * `target.kind:"ref"` 専用: true のとき、解決した各カードをそのカードの持ち主
     * (`CardInstance.ownerPlayerId`) のフィールドへ個別に召喚する（`actingPlayerId`
     * のフィールドではなく）。`CoreMoveAction.toTargetController` と同じ「対象ごとの
     * プレイヤー紐付け」慣用句。省略時 (既定 false) は従来どおり `actingPlayerId` の
     * フィールドへ召喚する。`target.kind` が `"ref"` 以外のときは無視される
     * （他の target kind は常に actingPlayerId 基準で対象ごとのオーナー分岐が生じないため）。
     */
    toOwnerField?: boolean;
    /**
     * true のとき、召喚直後の `CardInstance.exhaustState` を `"exhausted"` にする
     * （省略時は従来どおり `"recovered"`）。「疲労状態でコストを支払わずに召喚する」型
     * (BSLH01-M03) 用。`target.kind` を問わず汎用的に使える。
     */
    entersExhausted?: boolean;
    costModifier?: CostModifier;
    /**
     * 「リザーブまたは[条件に合うフィールドカード]からNコスト支払って召喚できる」型。
     * リザーブ支払いとフィルタ済みフィールドカード支払いは排他的な枝として扱い、
     * 1 回の支払いで混合しない。省略時は通常どおり任意のフィールド上カードから支払える。
     */
    onBoardCoreSourceFilter?: CardFilter;
    /** 「自分のスピリット/アルティメットのコアを0個にせずに召喚」等の場入りコア制約。 */
    fieldCoreSourceMinimum?: import("./model").FieldCoreSourceMinimum;
    /**
     * 「召喚するスピリットのコアは、トラッシュからも N 個まで置ける」
     * (BSTH04-転醒R02(B) 彼岸 [2,3] 後段)。
     * 通常のフィールド進入時コア配置 (維持コア) は reserve から行うが、本オプション設定時は
     * そのうち最大 N 個をコントローラーのトラッシュから補える (reserve 不足分を trash で充当)。
     * 配置総数 (minCores) は変えず、源の一部を trash に振り替えるだけ。0 / 省略時は従来挙動 (reserve のみ)。
     */
    trashCoreMax?: number;
    /**
     * `trashCoreMax` で許可するトラッシュ由来コアの種類。
     *
     * - "normal": 「《ソウルコア》以外のコア」等の明示除外。既存互換の既定値。
     * - "generic": generic「コア」。10_rules/06 に従い、持ち主が通常/ソウルを選べる。
     */
    trashCoreKind?: "normal" | "generic";
    /**
     * 「ボイドから維持コアを1個ずつまで置いて出せる」(BSSL01-X01[5,6])。
     * `trashCoreMax` は召喚全体で共有する予算だが、本フィールドは召喚するカード
     * 1体ごとに独立して適用される上限（テキストの「1個ずつ」= per-instance cap、
     * 共有予算にすると複数体召喚時に2体目以降がボイドを使えなくなり原文と食い違う）。
     * `split_field_entry_choice` 経由では通常召喚の EnterFieldCorePlacement と同じ
     * `pendingMultiPlacement` に合流し、対象ごとの `voidNormalCoreMax` として検証する。
     * 現時点ではトラッシュ由来コアを同じ対話配置 pending に公開していないため、
     * `trashCoreMax > 0` との同時指定は未対応として runtime で fail-closed にする。
     * 0/省略時はボイド不使用。
     */
    voidCoreMaxPerCard?: number;
    /**
     * `target.kind==="from_token_pool"` 専用: フィールド進入時維持コアのリザーブからの
     * 自動充当を完全に抑止する (BSKB01-C04「カウントエリアのコア1個を置いて出せる。
     * このとき、追加でコアを置けない」)。true のとき `executeTokenSummon` の
     * reserve-auto-payment 既定経路 (`trashCoreMax`/`voidCoreMaxPerCard` 未指定時) は
     * 維持コアを一切自動配置せず、新規インスタンスは `normalCoreCount:0` でフィールドへ
     * 入る。要求コア数の充足は呼び出し元の後続 step (`core_move` from:count_area
     * to:{kind:"ref", stepId} 等) に委ねる。`costModifier` によるコスト支払い自体には
     * 影響しない。省略時 (既定 false) は従来どおりリザーブから可能な範囲で自動充当する。
     */
    disableAutoReserveFieldCores?: boolean;
    /**
     * 「除外したカードN枚につき、召喚対象1体のコストを0(overrideCost)にする」型の
     * グループ化コストオーバーライド (BSTH02.7-C06 branch2)。target:"from_zone" の
     * 複数召喚専用。0〜maxCount枚を sourceZone から除外選択し（プレイヤーが選ぶ点は
     * `CostModifyAction.useCostPayment.exclude` と同型だが、線形割引ではなく
     * floor(選択枚数/groupSize) 体分、召喚対象の先頭からコストを overrideCost に固定する
     * 点が異なる。対象は同一値のため割当順は結果に影響しない）。除外候補が0件、または
     * 実際に召喚した対象が0件（count:0選択=辞退）のときは pending を開かず通常コストで
     * 進める。非対象カードは既存 effect-summon 全般の制約により印字コストのまま
     * （軽減シンボルによる軽減は非対応。BSDB01/BSAZ02-C06 等と同じ既知ギャップ）。
     */
    groupedExcludeOverride?: {
      sourceZone: "trash";
      maxCount: number;
      groupSize: number;
      filter?: CardFilter;
      overrideCost: number;
    };
    /**
     * 「配置した〜の『配置したとき』の【導託】は発揮されない」型の抑止 (BSAZ02-C17)。
     * SSOT: `model.ts SummonAction.suppressPlacementOracle` / `CardInstance.oraclePlacementSuppressed`。
     */
    suppressPlacementOracle?: boolean;
    /**
     * 「このとき、召喚条件を無視する」型の、この summon action 単発限定の召喚条件バイパス
     * (BSAZ02-X01[3]「このとき、「ヴァース」があるとき、召喚条件を無視し…」)。
     * `allow_ignore_summon_condition` CE (BSAZ02-C11 precedent) はプレイヤー単位の permanent
     * 許可であり、`canSummonUltimate` が通常召喚の legal action 列挙にも無条件消費するため、
     * 特定の flash 効果内でのみ召喚条件を無視したい場合には流用できない（許可が漏れて
     * 通常メインフェイズ召喚まで条件無視になってしまう）。本フラグは `executeSummonSelf` 内の
     * このステップ実行時にのみ `canSummonUltimate` をバイパスする単発 orthogonal フラグ
     * （`suppressPlacementOracle` と同型）。
     */
    ignoreSummonCondition?: boolean;
    /**
     * 「〜することで、手札から出す」型の「召喚ではない」場入り (BSTH11-X02【現界】、
     * 裁定2026-08-03 needs-ruling.jsonl:BSTH11-X02)。既存の「召喚ではない」ファミリー
     * (分身/煌臨/転醒/入れ替え) と同型に扱うため、この summon action 単発限定で
     * card_event:"summon"（召喚時）による第三者 (game_event) 観測を抑止する。
     * このカード自身の card_event 効果は元々 relatedInstanceId===self でのみ反応する
     * ため影響を受けない（`suppressPlacementOracle` と同型の単発 orthogonal フラグ）。
     * SSOT: `model.ts SummonAction.suppressThirdPartySummonObservation`。
     */
    suppressThirdPartySummonObservation?: boolean;
    /**
     * Internal enter-field classification for summon-action-shaped text.
     * - "put": トークン/【現界】など、本文が「出す」の場入り。
     * 省略時はカードカテゴリに従い、スピリット/アルティメット/ブレイヴは召喚、
     * ネクサスは配置として扱う。
     */
    enterFieldEventKind?: "summon" | "place" | "put";
    /**
     * Scope carried by the emitted enter-field event. Use with `put` to
     * distinguish named "put onto the field" mechanics such as 【現界】.
     */
    effectScope?: import("./model").EffectEventScope;
  }

  /**
   * 「出す」によるフィールド進入。召喚/配置ではないため、召喚時/配置時の誘発を起こさず
   * `card_event:"put"` だけを発生させる。
   *
   * 実行時は既存のフィールド進入・維持コア配置パイプラインを共有するが、カード DSL では
   * `SummonAction.enterFieldEventKind:"put"` による偽装を禁止し、印字動詞どおり独立 action として
   * 宣言する。トークンデッキからの「出す」と【現界】等の「手札から出す」が対象。
   */
  export type PutAction = Omit<
    SummonAction,
    | "kind"
    | "normalActionPermission"
    | "normalActionDeclarationSteps"
    | "groupedExcludeOverride"
    | "suppressPlacementOracle"
    | "ignoreSummonCondition"
    | "suppressThirdPartySummonObservation"
    | "enterFieldEventKind"
    | "effectScope"
  > & {
    kind: "put";
    /** 召喚支払い前の誘発対象は、出したカードへ直接合体する。 */
    requireDirectCombineWithTrigger?: boolean;
    /** 【現界】等、名前付きの「出す」を card_event 側で識別する scope。 */
    effectScope?: import("./model").EffectEventScope;
  };

  /**
   * 「合計N体まで、Aを出すかBを召喚できる（対象ごとに独立択一）」型の分配場入り選択
   * (ENGINE-sequential-slot-choice、BSSL01-X01[5,6])。
   *
   * ゲーム状態への影響は「tokenAction で出す体数」と「zoneAction で召喚する具体カード集合」の
   * 組み合わせのみで決まり実行順序に依存しないため、対象ごとの逐次選択には分解せず
   * 「トークン体数 (0..maxTokenCount) + ゾーン具体カード集合 (zoneCandidateIds の部分集合)、
   * tokenCount + zoneCardInstanceIds.length <= totalCount」という単一複合選択に還元できる
   * (両者は到達可能な最終状態の集合が一致する)。既存 `EffectStep.choice`
   * (effect 単位の単一 choiceIndex scalar) や `EffectStep.repeat` (pending 生成 action
   * 未対応、effect-interpreter.ts 参照) では表現できないため孤立 primitive として新設。
   * `PendingCoreSplitSelection` / `applyPendingCoreSplitAction` と同型の
   * 「複数サブアクションを順次実行し、ネスト pending が発生したら継続を付与して中断」パターン。
   */
  export interface SplitFieldEntryChoiceAction {
    kind: "split_field_entry_choice";
    /** 選択総数上限（DynamicCount で「カウント7以上のとき対象+1」等を表現）。 */
    totalCount: Count;
    /**
     * トークン側 action。`target.kind` は `"from_token_pool"` 固定。
     * `target.count` はプレイヤーが選ぶトークン体数で上書きされるため未使用（型上必須のため
     * 埋め値を入れる、例 `1`）。
     */
    tokenAction: PutAction & { target: { kind: "from_token_pool" } };
    /**
     * ゾーン側 action。`target.kind` は `"from_zone"` 固定。
     * `target.count` はプレイヤーが選ぶ具体カード集合の枚数で上書きされるため未使用
     * （型上必須のため埋め値を入れる、例 `1`）。
     *
     * token-only の「トークンN体まで」では省略できる。
     */
    zoneAction?: SummonAction & { target: { kind: "from_zone" } };
  }

  /**
   * 他効果の steps 内から名前指定カードを対象ホストへ契約煌臨させる
   * (ENGINE-effect-triggered-advent-declare、BSDB01-R01/R02)。プレイヤーが能動的に
   * スタック窓で宣言する `declare_advent` LegalAction / `resolveDeferredAdventStack`
   * とは独立した経路（本 action 自体が既に効果解決中のステップであり、外側の効果が
   * 自身のタイミング窓で反応機会を確保済みのため、二重スタック化しない。
   * `use_magic_without_cost` と同型の設計判断）。
   *
   * 煌臨先は placement で指定する。adjacent は共有煌臨元の反対側を参照し、既にカードが
   * あればその現在面へ重ねる。共有煌臨元がなければ不発 (08a6、2026-09-13ユーザー確認)。
   * 煌臨するカードは target のゾーン・名前条件で選ぶ。
   *
   * `target` で解決したカードの `CardDefinition.adventData` を実行時に取得し、`soulCoreDest`
   * / `adventVariant` はそのまま流用するが、`declareCondition` / `alternateCostAdvent` /
   * `declareUsageLimit` は「通常の宣言経路」専用のフィールドのため合成データには含めない
   * （このカードの通常 declare_advent とは別の条件源のため、流用すると印字に無い条件を
   * 誤って課してしまう）。`adventCondition` も `targetCategory` のみ引き継ぎ、
   * `cardNames`/`colors`/`minCost`/`adventState`/`tribes`/`tribesLogic`/`isContract` は
   * 引き継がない（これらは「この煌臨カード自身が本来どの host に契約煌臨できるか」という
   * 通常の宣言経路で host を絞る用途であり、効果本文が指定した煌臨先には流用しない）。
   * `adventSourceZone` は `target` が実際に解決したゾーンで上書きする。
   * 同一の煌臨カード定義でも、通常の宣言経路と本経路とで想定ゾーンが異なりうるため、SSOT は
   * 「このステップが実際にどのゾーンから選んだか」に置く。
   */
  export interface AdventAction {
    kind: "advent";
    /** 煌臨させるカードの選択（zone: "hand" | "trash" + cardName フィルタ、count は通常 1）。 */
    target: TargetSpec;
    /** 省略時は発揮元の上。adjacent は共有煌臨元の反対側の現在面、空いていれば共有元へ。 */
    placement?: "on_source" | "adjacent";
    /**
     * 「ソウルコアを...置いたものとして」の擬制コスト（実際のソウルコア所持確認・消費を
     * スキップする）。省略時 false = 通常通りソウルコアを実消費する。
     */
    useAlternateCost?: boolean;
  }

  // ════ コア・リソース (5種) ════

  export interface CoreMoveAction {
    kind: "core_move";
    from: CoreLocation;
    /**
     * 単一対象コアシュート/単一配置先用の対象選択（省略時=従来挙動）。
     * 「相手のスピリット/アルティメット1体のコアを…置く」型で、選んだ1体のコアのみを
     * 源とする。`from: { kind: "target_card" }` と併用し、解決された対象 (resolvedTargetIds[0])
     * の `{ kind: "card" }` コンテナを源にする。`amount` が範囲 `{ min, max }` のとき
     * pendingCoreCountSelection（プレイヤーが移動コア数を選択）を生成する。
     * `from` が reserve/trash/life/void かつ `to: { kind: "field_card" }` のときは、
     * 配置先候補を対象開示/対象変更に expose し、resolved target IDs だけを
     * `field_card` 配置候補として扱う。
     * フィールド全体のコアシュート（`from: { kind: "field", filter }`）とは別経路。
     */
    target?: TargetSpec;
    /** 単一移動先（既存挙動）。splitDestinations と排他。 */
    to?: CoreLocation;
    /**
     * `from:{kind:"target_card"}` の複数対象を、各対象カードの controller/core
     * 所属に紐づくプレイヤーゾーンへ動かす。例: 「すべてのコア1個ずつを、
     * そのカード側のリザーブへ置く」型。`to` と排他。
     */
    toTargetController?: { kind: "reserve" | "trash" | "life" | "void" };
    /**
     * 複数移動先のプレイヤー選択 split。
     * 指定時は pendingCoreSplitSelection を生成し、
     * GUI でリザーブ N 個 + トラッシュ M 個 のような分配を促す。
     * 各 destination の cap?: Count で上限を表現可能（省略時は無制限）。
     */
    splitDestinations?: {
      destinations: Array<{
        location: CoreLocation;
        cap?: Count;
      }>;
    };
    amount: Count;
    /**
     * ソウルコア選択の明示指定。省略時 ("generic") は 10_rules/06 §41-42 の
     * 「generic な『コア』はソウルコアを含む」規約どおり通常コア優先・不足分ソウル自動補完。
     * カード文中に《ソウルコア》が明記される (soul core specifically named, not generic
     * 「コア」) 場合は "explicit_soul_core" を指定し、通常コアに触れず対象ロケーションの
     * ソウルコアのみを動かす (無ければ 0 個で不発)。"normal_only" はソウルコアを無視し
     * 通常コアのみを対象にする。`moveLifeCoreByEffect` (life 系 v1 resolver) の
     * `LifeCoreMoveEffectKind` と同じ語彙を再利用する (BSDB01-M02 [5,6,7] trash→reserve)。
     */
    effectKind?: import("./model").LifeCoreMoveEffectKind;
    /**
     * true のとき、源に `amount` 個未満のコアしか無ければ何も移動しない
     * (`MoveCardAction.requireFullCount` と同型。「コアN個を〜置くことで」型の
     * conditional_cost で部分支払いを防ぐ。BSTH11-R03[3,4] 後半「自分のトラッシュの
     * コア3個をボイドに置くことで」)。省略時 (既定 false) は従来どおり available個
     * (0個含む) までクランプして移動する。this_card/field_card 源やsplit配分も、
     * conditional_cost の前段なら実行時に全額必要として扱う。
     */
    requireFullCount?: boolean;
  }

  export interface CoreDistributeAction {
    kind: "core_distribute";
    from: CoreLocation;
    to: TargetSpec;
    amount: Count;
    /**
     * source にソウルコアが混在し得るときの対象コア種別。
     * 省略時は従来通り generic な「コア」として扱う。カード本文が
     * 「《ソウルコア》以外のコア」を指定する場合は "normal_only" を使う。
     */
    effectKind?: import("./model").LifeCoreMoveEffectKind;
    /**
     * 配分モード (P3-47 Phase 2-1)。
     * - "even" (省略時): 均等分配 (端数は先頭ターゲット優先)。BSTH01-M01 系の自動分配。
     * - "player_choice": pendingCoreDistribution を生成して player に分配を委ねる。
     *   フランドール【フォーオブアカインド】「自分のコア1個以上をそれらのカードに置く」用。
     *   `from.kind` は "reserve" / "trash" 単一ソースに加え、`"any_movable_self"`
     *   (P3-47 F-5) で reserve / trash / life / 自分 field カードの任意混合をサポート。
     *   `"non_life_normal_self"` は reserve / trash / 自分 field の通常コアだけを扱い、
     *   `amount:"all"` のとき全配置を要求する。`"field_reserve_and_trash_self"` は
     *   field/reserve に trash 上限N個を足すHUD用。
     * - "one_each": 各ターゲットへ 1 個ずつ配置 (「コア1個ずつをN体に置く」)。
     *   `target.count` が固定数 N のとき resolveTargetSpec の決定論 slice で N 体が
     *   選ばれ、その各体へ 1 個ずつ配置 ('even' との差異は『候補<N のとき 1 個ずつ』が
     *   保たれる点。'even' は floor(amount/targets) 配分で残量を先頭へ寄せる)。
     *   実配置数 = min(amount, targetIds.length, available_cores)。
     *   from は "void" / "reserve" / "trash" を想定 (any_movable_self は非対応)。
     *   structured-effect-registrations は core_distribute の field targeting を公開する。
     *   fixed count は通常 target selection を経由し、count range は min/max target meta と
     *   `mode` の実配置数で「N体まで」を表現する。
     */
    mode?: "even" | "player_choice" | "one_each";
    /**
     * `mode: "player_choice"` 時の最小配分コア数。
     * - 0 / 省略: 配分 0 個も許容。
     * - 1+: 配分合計が下限を満たさないと apply はエラー。
     *   フランドールのコスト効果「コア1個以上」は minTotal=1。
     */
    minTotal?: number;
    /** player_choice: 1つの配置先に置ける通常/ソウル合計の上限。 */
    maxPerCandidate?: number;
    /**
     * player_choice: 配置した各コアをいずれか1枠に割り当てる共有予算。
     * 複数枠に該当する対象の割り当ては固定せず、配分全体で成立を判定する。
     */
    allocationGroups?: { filter: CardFilter; maxCount: number }[];
  }

  export interface CoreSetToLevelAction {
    kind: "core_set_to_level";
    /** ボイド等、追加コアの供給元。現状の実装は void を主用途にする。 */
    from: CoreLocation;
    /** Lv 到達させる対象カード群。 */
    target: TargetSpec;
    /** 到達目標 Lv。対象カードの levelDefs.requiredCores から不足分を算出する。 */
    level: number;
  }

  /**
   * 効果の発動コストとして「N コスト支払う」を表現する cost step。
   * リザーブ / 通常のフィールド上カードの通常・ソウルコアをトラッシュへ支払う。
   * 支払い元の適格性・制限は payment-system を正源とする。
   * 対話解決は窓後に pendingCoreSourceAllocation で必要な選択を行い、
   * 非対話実行は同じ候補から決定的に支払う。支払い不能なら盤面を変更しない。
   * conditional_cost コネクタで支払いと後段効果を一体に解決する。
   */
  export interface PayCostAction {
    kind: "pay_cost";
    player?: PlayerRef;
    amount: number;
    /** @deprecated 通常の pay_cost は常にフィールド支払い可。旧DSL互換用。 */
    allowFieldCorePayment?: true;
  }

  /**
   * 「〇〇と宣言することで」型の宣言ギミック primitive (BSLH01「エンジョ〜イ、みっしぃ！」正源)。
   * 宣言そのものを1ステップとして表現し、`GameState.declarationCountThisTurn` (プレイヤーID→
   * 累積回数、ターン遷移時にリセット) を+1する。宣言の任意性は既存の `executionMode:"optional"`
   * (effect/step レベル) に委ね、このアクション自体は無条件実行。累積回数は他カード
   * (「このターン中に宣言した回数」を参照する効果) から `count_value` 系の DynamicCountSource
   * 拡張等で読み取る想定。
   */
  export interface DeclareGimmickAction {
    kind: "declare_gimmick";
    player: PlayerRef;
  }

  /**
   * P3-129 (ENGINE-triggered-hand-zone-immunity-dynamic-scope): 「Xが起きたとき、以後、
   * 相手側の誘発効果が未解決の間だけYが真」型の動的スコープを発揮元カード自身
   * (sourceInstanceId) に記録する primitive。解決中の pending triggered effect 自身の
   * `pendingId` (`ctx.pendingEffectPendingId`) を `CardInstance.pendingTriggerCorrelations[key]`
   * へ append する。target 指定は無く常に発揮元自身に作用する (count_increase 同様、
   * 無条件実行)。`pendingEffectPendingId` が undefined (= 同一 event に他の登録 source が
   * 無く同時誘発でない) のときは no-op (state 不変、相関すべき相手側誘発が存在しないため)。
   *
   * 主用途: BSTH07-転醒X02(A)【神秘】「自分が系統：「星蓮」/「闘神」を持つ効果で手札を
   * 増やしたとき、自分の手札は、相手のスピリット/ネクサスの効果を受けない」。裁定
   * (needs-ruling.jsonl BSTH07-転醒X02(A)): この免疫は永続ラッチではなく、同じ手札増加
   * event に対して相手側に登録された誘発効果が未解決の間だけ有効な動的スコープ。
   * トリガー検出効果 (`timing.kind:"game_event"`, `event:"increase_hand"`) の steps で
   * このアクションが相関 pendingId を記録し、別の `timing.kind:"continuous"` 効果を
   * `condition:[{kind:"correlated_pending_trigger_active"}]` でゲートして
   * `effect_immunity` を登録する (継続効果自体は while_on_field で発揮元カードの
   * フィールド在場に紐づく。条件が false に戻れば免疫も自動的に切れる)。
   */
  export interface CorrelatePendingTriggerAction {
    kind: "correlate_pending_trigger";
    /** 相関キー。同一カードで複数の独立スコープを区別するための識別子。 */
    key: string;
  }

  export interface CountIncreaseAction {
    kind: "count_increase";
    player: PlayerRef;
    amount: Amount;
    /**
     * 「追加したカウントは系統：「X」を持たない効果で数えられず、その効果を受けない」
     * (BSGE01 神喰 等)。設定時、増加分は protectedCounts[X] に記録され、X 系統を
     * 持たない効果からは数えられず・減らされない。
     */
    protectedFromNonTribe?: string;
  }

  /**
   * カウント＋ メタ修飾 (BSTS01-C03 ［行政担当］リグルド)。
   * 「自分の『カウント＋』効果で増やすカウントを＋N する」。継続効果として登録し、
   * executeCountIncrease がそのターン最初に解決する受益プレイヤーの count_increase
   * 1 件のみへ +amount を自動加算する (10_rules/08a §カウント＋ メタ修飾。終止形=強制 /
   * 〔ターンに1回:同名〕は first-opportunity 消費 / 範囲=受益プレイヤーの count_increase 全般)。
   */
  export interface CountGainModifierAction {
    kind: "count_gain_modifier";
    /** 修飾の受益プレイヤー (「自分の」= self)。 */
    player: PlayerRef;
    /** カウント＋ に上乗せする量。 */
    amount: number;
    /** 継続期間 (通常 while_on_field)。 */
    duration: Duration;
  }

  export interface CountDecreaseAction {
    kind: "count_decrease";
    player: PlayerRef;
    /**
     * `{ min, max }` (範囲) 指定時は「好きなだけ減らせる」型として、
     * `min`〜`min(max, reducible)` の範囲でプレイヤーに減らす数を選ばせる
     * `pendingCountSelection` を生成する (ENGINE-cost-modify-additional-cost-value-dynamic-amount
     * Step2。PendingCoreCountSelection と同型パターン)。
     * 例: BSGE01-M02「自分のカウントを好きなだけ減らせる」(min:0, max 省略=reducible全体)。
     */
    amount: Amount | { min: CountBound; max?: CountBound };
  }

  export interface CountSetAction {
    kind: "count_set";
    player: PlayerRef;
    value: number;
  }

  export interface EnterSoulStateAction {
    kind: "enter_soul_state";
    target: TargetSpec;
  }

  /**
   * 効果でこのカードを配置する。魂状態の【復活】は
   * `applicability:{ soulState:true }` + `place(self)` で表す。
   */
  export interface PlaceAction {
    kind: "place";
    target: { kind: "self" };
  }

  /**
   * 効果駆動のクォーツセット（`10_rules/07` §4、qa-029〜035）。プレイヤー主導の
   * legal action (`useSetQuartzAsAction`) と異なり、host/スロットは自動解決する
   * （ENIGMA が唯一の quartzHostData 保持カードのため choice は不要。将来複数 host が
   * 出た場合は host TargetSpec を追加する拡張余地として残す）。
   * `quartzData.countCost` は qa-035（「コストを支払わずに」表記が無ければ必須）に従い
   * 自動で支払う。支払不可/host不在/スロット満杯なら no-op（`state` 不変、log のみ追加）。
   * 初出: BSLH01-R01[3,4]「手札/トラッシュにある【クォーツ】を持つカード1枚までを
   * 魂状態の対象にセットする」。
   */
  export interface QuartzSetAction {
    kind: "quartz_set";
    /** 解決中の位置選択で確定したセット先。カード定義では省略する。 */
    placement?: {
      hostInstanceId: string;
      slot: "left" | "center" | "right";
      replacedQuartzInstanceId?: string;
    };
    /** セットするクォーツカード候補（通常 zone:["hand","trash"] + filter.hasQuartzData:true）。 */
    target: TargetSpec;
    /**
     * true のとき countCost 支払いを省略する（「コストを支払わずに」表記、qa-035）。
     * 省略時 = false（従来どおり countCost を自動支払い、支払不可なら no-op）。
     * 初出: BSLH01-R05[1]「自分の魂状態の対象にコストを支払わずにセットする」。
     */
    free?: boolean;
  }

  export interface LifeDamageAction {
    kind: "life_damage";
    player: PlayerRef;
    amount: Amount;
  }

  export interface LifeFillAction {
    kind: "life_fill";
    player: PlayerRef;
    targetValue: number;
  }

  // ════ 継続修飾 (6種) ════

  export interface BpModifyAction {
    kind: "bp_modify";
    target: TargetSpec;
    amount: Amount;
    duration: Duration;
  }

  export interface SymbolAddAction {
    kind: "symbol_add";
    target: TargetSpec;
    /**
     * 追加シンボルの色。配列時はデュアルカラーシンボル（1シンボルが複数色として機能）。
     * `symbolSource` 指定時は無視される（動的解決に置き換わる）。
     */
    symbol?: SymbolColor | SymbolColor[];
    /**
     * 動的シンボルソース。指定時、`symbol` は無視され消費時に live 評価する
     * （「自分のフィールドにあるすべてのシンボルとして扱うシンボル1つを得る」型）。
     */
    symbolSource?: SymbolDynamicSource;
    /**
     * 追加するシンボルの個数。省略時=1。`DynamicCount` を指定すると「自分がこのターン中に
     * 宣言した回数1につき、青シンボル1つを追加する」(BSLH01-R04) のような盤面連動の
     * 動的個数を表せる。`symbolSource` とは併用しない（`symbol` 固定色前提）。
     * `TreatAsAction.addsReductionSymbol`+`count` と同型、`Amount`
     * (`number | DynamicCount`) は同じ SSOT (`DynamicCountSource`) を再利用する。
     */
    count?: Amount;
    /**
     * `count` が `DynamicCount` のときの評価タイミング。省略時は従来互換の live。
     * 「発揮中、枚数によって常に変動する」型は live のままにし、発揮時点で
     * 数値を固定する裁定・文面がある場合だけ snapshot を指定する。
     */
    countEvaluation?: "live" | "snapshot";
    duration: Duration;
  }

  /**
   * host 自身 (target:self 前提) の `underCardSlots` 該当 `hostRoleTag` 枠上限へ、
   * `childRoleTag` 一致 text_role アンダーカードそれぞれが自身の `CardDefinition.underCardSlots`
   * に持つ同一 `hostRoleTag` エントリの `maxCount` を合算した値を加算する継続効果。
   * 「このアルティメットの下にあるアルティメットカードすべての【アルドノアドライブ】を
   * Lvを無視で得る」(BSAZ02-TX01(B)) 型。`under_card_symbols` (symbol_add) と同型の
   * 自己参照型動的加算だが、対象はシンボルではなく underCardSlots 枠上限そのもの。
   */
  export interface UnderCardSlotCapacityGrantAction {
    kind: "under_card_slot_capacity_grant";
    target: TargetSpec;
    hostRoleTag: string;
    childRoleTag: string;
    childFilter?: CardFilter;
    duration: Duration;
  }

  /** 下のカードを別の役割として扱う／実体を置かずその役割の存在を得る。 */
  export interface UnderCardRoleGrantAction {
    kind: "under_card_role_grant";
    target: TargetSpec;
    roleTag: string;
    faceDownCards?: boolean;
    virtualCount?: number;
    duration: Duration;
  }

  /**
   * `target` (通常 self) の `childRoleTag` 一致 text_role アンダーカードそれぞれの
   * `effects[]` から、`sourceEvents` に一致する `timing.kind:"card_event"` 効果を見つけ、
   * host 自身を source として発揮する（`borrow_card_event_effect` と異なり選択式ではなく
   * 自動継承）。executionMode/usageLimit (effect/step 両レベル、choice 分岐含め再帰) を
   * 持つ donor 効果、または多イベント効果 (`sourceEvents` の厳密部分集合でない) は
   * 継承候補から除外する (native-under-card-trigger-inherit.ts
   * isInheritableCardEventEffect / hasUnsupportedStepModifiers)。
   *
   * card_event はそのカード自身のイベントにのみ反応する設計 (10_rules) のため、
   * 一致した効果は常に「借用元カードの『このカードの{event}時』」効果であり、
   * ラベル判別は不要。借用元自身の `condition`/`applicability` は
   * effect-borrowing.ts の listBorrowableCardEventEffectCandidates と同型の
   * 二段階パターンで扱う: 借用元インスタンス (host に付着した under-card 自身、
   * zone/level/自身の underCards は well-defined) を基準に評価してゲート判定し、
   * 通過後のみ実行対象からそれらを strip して host を source に発揮する
   * (adversarial verifier round3 refute対応: 無条件 strip は
   * needs-ruling.jsonl:BSAZ02-TX01(B) の裁定射程 [triggerEvent スコープ拡張のみ] を
   * 超えて借用元自身の発揮条件まで無視していた)。
   *
   * 初出: BSAZ02-TX01(B) backFace effects[4]「Lv5のとき、このアルティメットの下の
   * アルティメットカードの『このアルティメットのアタック時』効果を『アタック/ブロック時』に
   * 変更する」。host 側の effect timing を `event:["attack","block"]` +
   * `applicability:{level:{min:5,max:5}}` にすることで scope 拡張を表現する
   * (needs-ruling.jsonl:BSAZ02-TX01(B) 案B裁定)。
   */
  export interface UnderCardTriggerInheritAction {
    kind: "under_card_trigger_inherit";
    target: TargetSpec;
    childRoleTag: string;
    sourceEvents: ReadonlyArray<CardEventType>;
  }

  export interface TreatAsAction {
    kind: "treat_as";
    /**
     * 「このカード/<実体種類>」のように、場のオブジェクトだけでなくカード自身の
     * プロパティも変更する。true の自己変更は表向きである限りゾーンを問わず有効で、
     * `symbol` は実効シンボル、`reduction_symbol` は使用時の軽減要求枠へ反映される。
     */
    appliesToCard?: boolean;
    /**
     * 「このカードの軽減シンボル」のように、カード状態のプロパティだけを変更し、
     * 場の実体状態（スピリット/アルティメット/ブレイヴ/ネクサス等）には継続 CE を登録しない自己修飾。
     * `appliesToCard:true` と併用し、使用時コスト計算は `card.effects` 直接読みで反映する。
     */
    cardStateOnly?: boolean;
    aspects: ("color" | "symbol" | "reduction_symbol")[];
    /**
     * 扱う色。単色 or 多色。「シンボル/軽減を 赤/紫/… として扱う」のように
     * 1 シンボルが複数色すべてとして扱われる場合は配列で渡す（単色は従来どおり）。
     * `waivesReductionRequirement:true|"all"` のときは色を問わず満たすため省略可。
     */
    asColor?: SymbolColor | SymbolColor[];
    /**
     * `reduction_symbol` 限定: 加色対象を、印字軽減シンボルのうち指定色の枠だけに絞る。
     * 「このカードの赤の軽減シンボルは、黄としても扱う」型で、赤以外（導など）の
     * 印字軽減枠へ黄を加えないために使う。
     */
    reductionSymbolBaseColors?: SymbolColor[];
    /**
     * 支払い文脈限定スコープ。指定されると、この treat_as は**無条件には適用されず**、
     * 「自分が `whenPayingForFilter` に一致するカードを召喚/配置するためのコストを払うとき」
     * に限り、その軽減計算でのみ加色する（BP・表示・通常の色判定には影響しない）。
     *
     * 例:「自分が系統:「夜錆」を持つカードを召喚/配置するとき、このスピリットのシンボルを
     * 白/紫としても扱う」(BSSA01-C01/C02/C03)。フィールドに居るこのスピリットの実効シンボルは
     * 普段は印字どおりだが、夜錆カードの召喚/配置コスト支払い時に限り白/紫の軽減シンボルになる。
     *
     * 適用先は供給側シンボル（`aspects` に `"symbol"` を含む field カード）。継続 CE は
     * 登録されず、`calculateReduction` が支払い対象カードを `matchesCardFilterByDef` で照合して
     * 解決時のみ加色する（10_rules/03a コスト軽減）。
     */
    whenPayingForFilter?: CardFilter;
    /**
     * Applies only while paying to use this card's effect with the given mode.
     * Summon/place cost calculation does not provide an effect mode and ignores
     * this scoped modifier.
     */
    whenUsingEffectMode?: "main" | "flash" | "stack";
    /**
     * For reduction_symbol only: add a new reduction symbol entry instead of
     * treating each printed reduction symbol as the given color.
     */
    addsReductionSymbol?: boolean;
    /**
     * `addsReductionSymbol` で追加するエントリ数。省略時 = 1（従来どおり `asColor` の
     * 各色につき新規シンボル 1 つ）。`DynamicCount` を指定すると「自分のフィールドの
     * マジックカード1枚につき、軽減シンボル黄1つを満たす」(BSAZ03-M01 effects[1]) の
     * ような盤面連動の動的供給数を表せる。`Amount`(=`number | DynamicCount`) は
     * 継続修飾の動的量と同じ SSOT (`DynamicCountSource`) を再利用する。
     * `waivesReductionRequirement` の枠数指定にも同じ `count` を流用する。
     */
    count?: Amount;
    /**
     * `aspects` 含 `reduction_symbol`: 既存の未充足軽減枠を count 個（省略時1）、
     * 色供給とは無関係に満たす。`"all"` は未充足枠すべて。asColor は無視する。
     * `whenPayingForFilter` は外部カードからの付与先を絞る。
     * `appliesToCard` / `cardStateOnly` は支払い対象自身の自己修飾として、その使用個体の
     * condition / applicability / whenUsingEffectMode を評価する。場の同名カードからは重複適用しない。
     * 要求枠の追加 (`addsReductionSymbol`) とは別処理。calculateReduction が自己充足と
     * 通常供給を最大軽減になるよう割り当て、外部付与は残った枠を満たす。継続 CE は登録しない。
     */
    waivesReductionRequirement?: true | "all";
    /**
     * `waivesReductionRequirement` の枠数を、対象カードの未充足軽減シンボル枠のうち
     * 要求色がこの配列のいずれかを含む枠だけに限定する（省略時は従来どおり色を問わず満たす）。
     * 「その軽減シンボル赤/黄2つまでを満たす」(BSTH003-C31/M02) のように、対象カードの
     * 印字軽減シンボルの一部の色だけを免除する型。`count` と併用し、色一致する未充足枠数と
     * `count` の小さい方が実際の免除数になる（`"all"` は色一致する未充足枠すべて）。
     */
    waiverColors?: SymbolColor[];
    /**
     * `whenPayingForFilter` + `aspects` 含 `reduction_symbol` 限定: 供給側への加色
     * (`waivesReductionRequirement` 無し版) でも色を問わず満たす (`waivesReductionRequirement`)
     * でもなく、`whenPayingForFilter` に一致する対象カード（支払い対象そのもの）の印字済み
     * 軽減シンボル各枠の**要求色を `asColor` へ置き換える**（既存色への加算ではなく上書き）。
     * 「自分が系統：「CB」を持つカードを召喚/配置するとき、その軽減シンボルを<七>として扱う」
     * (BSLH01-CX01) 型 — 他の treat_as reduction_symbol 系が軒並み「〜としても扱う」(加色) なのに
     * 対しこの効果は「〜として扱う」(も無し、置換) のため独立フラグとする。`appliesToCard`
     * （自分自身の枠、加色）や `waivesReductionRequirement`（無条件充足）とは適用対象・上書き
     * 方式のいずれも異なるため併用しない。`calculateReduction` が
     * `getEffectiveReductionSymbolEntries` 内の `getPayingForReductionColorOverride` 経由で
     * `matchesCardFilterByDef` により対象カードを照合し、マッチ時は要求エントリ全枠の色を
     * `asColor` で置き換える（継続 CE は登録しない、`whenPayingForFilter` 全般と同じ SSOT:
     * 支払い解決時のみ DSL 直接読みで解決）。
     */
    overridesRequiredColor?: boolean;
  }

  /**
   * 別カードのプロパティをスナップショットコピーする指示。
   * CE 登録時点で `from` を解決し、その時点の実効値を一度だけ取得して保存する。
   * 解決後は通常のリテラル値と同じ扱いになる（continuous な追従は行わない）。
   */
  export interface CopyFromTargetSpec {
    /** コピー元カードを指定するターゲット仕様 */
    copy_from: TargetSpec;
  }

  export interface OverridePropertiesAction {
    kind: "override_properties";
    target: TargetSpec;
    properties: {
      treatAsCategory?: CardCategory;
      /**
       * 「〇〇として扱わない」型の否定。`treatAsCategory` (置換) とは独立に、印字
       * category との一致判定を外す（`getEffectiveCategory` が `undefined` を返す）。
       * `treatAsCategory` と同時指定時はそちら優先（置換が否定より強い）。
       * 例: BSTH03-M01 Lv5「このアルティメットはアルティメットとして扱わない」。
       */
      excludeCategory?: CardCategory;
      cardName?: string | "copy_self" | CopyFromTargetSpec;
      /**
       * true のとき、物理 attachedChildrenIds が無くても「合体している」扱いにする。
       * 仮想ブレイヴ合体など、実体カードを増やさず combined gate だけを満たす用途。
       */
      combined?: boolean;
      virtualAttachedBraves?: Array<{
        cardName?: string;
        tribes?: string[];
        cost?: number;
        symbols?: SymbolColor[];
        combinedBoost?: number;
        countsTowardLimit?: boolean;
      }>;
      cost?: number | "copy_self" | CopyFromTargetSpec;
      symbols?: SymbolColor[] | "copy_self" | CopyFromTargetSpec;
      /**
       * `symbols` を「固定値」として扱う。公式 Q15011 に従い、固定中は
       * symbol_addition や合体ブレイヴのシンボル追加でシンボル数が変わらない。
       */
      symbolCountFixed?: boolean;
      tribes?: string[] | "copy_self" | CopyFromTargetSpec;
      /**
       * 系統の追加付与（既存系統に加算）。`tribes` が overwrite なのに対し、
       * `addTribes` は加算的に系統を持たせる（例: 「このスピリットは系統:「起幻」を持つ」）。
       * 加算系統はカード本来の `tribe` および同一カードに対する他 CE の `addTribes` と
       * 結合される。重複は除去される。
       */
      addTribes?: string[];
      /**
       * BP 上書き。
       * - `{ lv1, lv2?, lv3? }`: レベル別 BP を直接指定
       * - `"copy_self"`: ソース自身の levelDefs を使用
       * - `CopyFromTargetSpec`: 別カードの**実効 BP（モディファイア込み）**を全レベル一律で使用
       */
      bp?:
        | { lv1: number; lv2?: number; lv3?: number }
        | "copy_self"
        | CopyFromTargetSpec;
      /**
       * Lv 別必要コア数の絶対値上書き。省略したレベル（例: `lv1` 未指定）は対象カード
       * 自身の印字 `levelDefs` の値を維持する（`getEffectiveLevelWithCostResolver` が
       * 対象ごとの `levelDefs` へフォールバック。1つの filter で異なる印字コストを持つ
       * 複数カードを対象にしても他レベルを破壊しない。BSTH02.7-CX01 Lv2 コスト固定）。
       */
      levelCost?: { lv1?: number; lv2?: number; lv3?: number };
      /**
       * Lv コスト（レベル維持コスト）への**加算**修飾。`levelCost`（上書き）と異なり、
       * 各レベル閾値の必要コア数に一律 `levelCostDelta` を足す。実効 Lv が下がり、
       * 消滅判定（最低 Lv コスト未満）にも作用する（10_rules/03a:71 / 04:105）。
       * 「相手のスピリット/アルティメットすべての Lv コスト+2」型（BSKB01-M01 /
       * BSLH01-M04 / BSSL01-X03 ほか）。`Amount`（`DynamicCount`）も取れる。
       * 「自分のカウント2につき+1」型（BSSL01-R01）= `{ source: { kind: "count_value",
       * player: "self" }, divisor: 2 }`。CE 登録時（発動時点）にスナップショット解決し、
       * `duration` の間はその数値で固定する（発動後のカウント変動を追わない）。
       */
      levelCostDelta?: Amount;
      /**
       * 実効 Lv の直接上書き。`levelCost`/`levelCostDelta`（必要コア数の変更）とは異なり、
       * コア数計算を経由せず `getEffectiveLevel` の結果そのものを差し替える。
       * - `"max"`: 対象カード自身の `levelDefs` の最高 Lv 扱いに固定する
       *   （「そのスピリットが持つ最高Lvとして扱う」型。BSTH05-R03 / BSTH06-C03 / BSTH09-X02）。
       * - `{ delta }`: 通常算出（コア数基準）の実効 Lv に加算する相対上書き
       *   （「Lvを2つ下のものとして扱う」= `{delta: -2}`。BSTH08.5-X02）。`"max"` と異なり
       *   コア数基準の計算結果をベースに加算するため、コアが増減すれば結果も追従する。
       *   負の結果になり得る（下回った最低 Lv 判定は `CardFilter.belowOwnMinimumLevel` 側で行う）。
       */
      level?: "copy_self" | "max" | { delta: number };
      /**
       * true のとき、対象カードは grandwalkerData を持たなくても「自分の効果に限り
       * 導界者ネクサスとして疲労させることができる」opt-in を得る
       * (BSTH05.5-C20「自分の効果で、導界者ネクサスとして疲労させることができる」)。
       * `CardFilter.targetsGrandwalker:"only"` + `includesGrandwalkerExhaustOptIn:true`
       * を明示的に立てた消費側フィルタのみが、このカードを「導界者ネクサス種別」として
       * admit する (SSOT: `hasGrandwalkerExhaustOptIn`, card-filter.ts)。
       */
      actsAsGuidedNexusForOwnExhaustEffects?: boolean;
      /**
       * true のとき、対象カード自身が printed 【契約煌臨】を持たなくても「【契約煌臨】を
       * 持っているものとして扱う」(BSKB01-R02 effects[0])。魂状態時に契約煌臨の対象へ
       * なれる資格 (通常は `player.contractCardNo` 一致のみ、advent-system.ts
       * `isPlayersContractCard`) を、この付与フラグとの OR 判定で拡張する
       * (SSOT: `hasContractAdventEligibilityGrant`, mechanics/advent-system.ts)。
       */
      grantsContractAdventEligibility?: boolean;
      /**
       * true のとき、対象カード自身が印字 category "ultimate" でなくても、神託/導託の
       * `OracleCondition.categories` 判定に限り「アルティメット」としてもマッチする
       * opt-in を得る (BSTH05.5-C20「アルティメットカード/アルティメットとして
       * 【導託】できる」)。`getEffectiveCategory`（グローバル実効 category、legal-action /
       * battle / 対象選択等 全般）は変更せず、`oracle-system.ts` の
       * `matchesOracleCondition` の categories チェックでのみ OR 判定として参照する
       * (SSOT: `hasOracleUltimateOptIn`, `mechanics/oracle-ultimate-opt-in.ts`)。
       */
      actsAsUltimateForOracleTrigger?: boolean;
      /**
       * カードが持つルール上の制約タグを継続効果として付与する。
       *
       * `CardDefinition.keywordTags` の印字宣言とは異なり、この経路は継続効果の
       * 発揮・抑止に従う。たとえば「このスピリットは合体できない」は
       * `keywords:["cannot_combine"]` として表し、効果を発揮できない間は
       * 合体制約も失う。
       */
      keywords?: string[];
    };
    restrictions?: string[];
    duration: Duration;
  }

  export interface DrawStepPrepaidDiscardDisposition {
    kind: "move_instead";
    ifCardFilter: CardFilter;
    destination: "field";
  }

  export interface DrawModifyAction {
    kind: "draw_modify";
    amount: Amount;
    duration: Duration;
    /**
     * コスト先払い型ドロー枚数修正（model A）の任意前提コスト。
     * 指定時、システムドロー**より前に**この任意コスト（手札破棄）の支払い判断を解決し、
     * **支払えた場合のみ** `amount` を確定する（コスト → ボーナス確定 → システムドロー）。
     * inline ドローステップ処理がドローステップを中断して `pendingDrawStepCostChoice` を立てる。
     * ルール正源: 10_rules/02 §コスト先払い型ドロー枚数修正（裁定 2026-06-15, model A）。
     * 例: BSSL01-C03「手札の系統:「影」/「プレイヤー」1枚を破棄することで、ドロー枚数を+1する」。
     */
    prepaidCost?: {
      /** コスト種別。現状は手札破棄のみ。 */
      kind: "discard_hand";
      /** 破棄候補を絞り込む手札カードフィルタ（系統等）。 */
      cardFilter: CardFilter;
      /**
       * 破棄カードに応じた移動先置換。
       * 例: 「破棄したカードが『X』のとき、トラッシュに置くかわりに配置する」。
       */
      discardDisposition?: DrawStepPrepaidDiscardDisposition;
    };
  }

  export interface CostModifyAction {
    kind: "cost_modify";
    /** コスト変更とは別に「余分に支払う」要求。全額支払い済みでも残る。 */
    additionalPayment?: boolean;
    /** カード自身を対象にする場合 (例: 「このカードのコストは3としても扱う」) */
    target?: TargetSpec;
    /** プレイヤーのカード群を対象にする場合 (例: 「マジックカードをコストなしで使える」) */
    player?: PlayerRef;
    cardFilter?: CardFilter;
    /**
     * `additionalCostValue` は `Amount`（number | DynamicCount）対応
     * (ENGINE-cost-modify-additional-cost-value-dynamic-amount)。DynamicCount 指定時は
     * player+cardFilter 版の継続 additional_cost CE では、盤面のみで解決できる
     * DynamicCount は `modifierAmountDynamic` として保持し、使用時のコスト計算で
     * live 再評価する。target 指定版と step context 依存の DynamicCount は
     * 従来どおり宣言時点の固定値にする。
     * `useCostPayment` 併用パス
     * (legal-actions-availability.ts / summon-cost-exclude-choice.ts) は既存どおり
     * number のみ対応（DynamicCount 指定時はそのカードの当該 useCostPayment 経路を
     * 無効化= 対象外として扱う）。
     */
    modifier: CostModifier | { additionalCostValue: Amount };
    /**
     * Applies only while paying to use this card's effect with the given mode.
     * Summon/place cost calculation does not provide an effect mode and ignores
     * this scoped modifier. Intended for self `target` cost overrides such as
     * "when using this card's stack effect, treat this card's cost as N".
     */
    whenUsingEffectMode?: "main" | "flash" | "stack";
    /**
     * 使用時の任意前提コストを伴うコスト修正。
     * 例: 「このカードを使用するとき、トラッシュの指定カードをデッキの上と下に
     * 1枚ずつ戻すことで、コストを-3する」。
     */
    useCostPayment?:
      | {
          kind: "return_to_deck_top_bottom";
          sourceZone: "trash";
          count: 2;
          filter?: CardFilter;
        }
      | {
          /**
           * 「トラッシュ○枚まで除外し、除外したカード1枚につきコストを-N」型の
           * 可変枚数召喚コスト軽減 (BSTH02.7-M01 effects[0] 等)。player が 0〜maxCount 枚を
           * 選び、選択枚数 × |modifier.additionalCostValue| が finalCost から追加減算される。
           * exact 固定枚数 (return_to_deck_top_bottom) とは異なり、プレイヤーが枚数自体も選ぶ。
           * pendingSummonCostExcludeChoice (summon-cost-exclude-choice.ts) が解決する。
           *
           * `sourceZone: "field"` (engine-alt-cost-summon-multizone) は「合体中の自分の
           * 鍵ブレイヴ1つを除外することで、召喚コストすべてを支払ったものとして召喚できる」
           * (BSFT01-X01 effects[2]) 型。`filter.combined:true` で合体状態のカードのみを候補にする。
           * `minCount` 省略時/0 は従来どおり任意（0枚選択可）。`minCount>0` は必須選択数を表し、
           * 候補が0件のときは召喚許可 effect 自体を legal action に出さない
           * （getAvailableHandSummonPermissionLegalActions 側でゲート。通常コストへのフォール
           * バックを許さない＝「除外できなければこの方法では召喚できない」を表す）。
           *
           * `sourceZone: "hand_or_set_aside"` (ENGINE-summon-self-exclude-alt-cost-full-reduction、
           * BSTH11-M01 effects[0]) は「手札/手元にあるカード1枚を除外することで」型。
           * `fullReduction: true` のとき、除外は線形割引 (`modifier.additionalCostValue`) では
           * なく `costModifier:"full_reduction"` と同一の `calculateFullReductionSummonCost`
           * (軽減シンボルすべてを満たしたものとして扱う) に合流する。この場合
           * `modifier.additionalCostValue` は無視される (0 固定でよい)。
           */
          kind: "exclude";
          sourceZone: "trash" | "field" | "hand_or_set_aside";
          maxCount: number;
          minCount?: number;
          filter?: CardFilter;
          fullReduction?: boolean;
          /** 除外により変更後の召喚コスト全額を支払ったものとする。追加支払いは残す。 */
          fullCostPaid?: boolean;
          /** このカード自身の指定 effects[] による効果内召喚でのみ提示する代替支払い。 */
          effectSummonEffectIndex?: number;
          /**
           * 指定した effects[] の Q54 通常行動許可から宣言した場合だけ、この代替支払いを
           * 提示する。通常の手札召喚と許可召喚が並立するカードで、通常召喚側へ必須支払いを
           * 誤適用しないための明示スコープ。
           */
          normalActionPermissionEffectIndex?: number;
        }
      | {
          /**
           * 「手札を○枚まで破棄し、破棄した枚数1につきこのカードのコストを-N」型の
           * 可変枚数使用時コスト軽減 (BSAZ03-M01 effects[1b])。player が選択した
           * 0〜maxCount 枚が手札からトラッシュへ破棄される（getZoneCostPaymentForMagic /
           * applyMagicZoneCostPayment の zone_discount_variable 経路。selectedZoneCardIds
           * で使用宣言と同時に確定するため exclude と異なり pending は不要）。
           * 破棄は moveCardZone 直呼びで行われ、moved_to_trash 自動効果は発火しない
           * （pendingDrawStepCostChoice の手札破棄と同じ扱い。原文「破棄したカードの
           * 効果は発揮されない」と整合する）。
           */
          kind: "discard_hand";
          sourceZone: "hand";
          maxCount: number;
          filter?: CardFilter;
        }
      | {
          /**
           * 「自分のフィールドのマジックカードをデッキの下に戻すことで、戻した枚数1枚に
           * つきコストを-1」型の可変枚数コスト軽減 (BSAZ01-C06 effects[2])。discard_hand
           * と同じ可変枚数支払いパターン（getMagicZoneCostDiscountOptions/
           * getZoneCostPaymentForMagic は sourceZone を区別せず共通処理する）だが、
           * sourceZone:"field" のためカードの実際の返却は `executeSendToDeck`
           * (structured-zone-ops.ts) 経由で行う。field 由来カードの離脱は
           * cannot_leave_field / cannot_be_sent_to_deck 耐性チェックを要する
           * (discard_hand の moveCardZone 直呼びとは異なる。既存の対象カード送り込み
           * 汎用効果 `send_to_deck` と同一の耐性ゲートを再利用する)。
           */
          kind: "return_to_deck_bottom_field";
          sourceZone: "field";
          maxCount: number;
          filter?: CardFilter;
        }
      | {
          /**
           * 「自分のトラッシュのコアN個以上をフィールド/リザーブに置くことで、コストを
           * 支払わずに召喚する」型の代替コスト支払い (BSSL01-M02 effects[0,1])。他 kind が
           * すべてカード移動を支払いの実体とするのに対し、本 kind はコアのゾーン移動
           * (トラッシュ→フィールド/リザーブ) そのものが支払いとなる。移動可能コア総数は
           * `getPlayerTrashCoreCount` で判定し、通常コア/ソウルを合計 `minCount` 以上
           * 選び、複数先へ配分できる。
           * 無償召喚は `modifier:"free"`。超過移動分で余分支払いを減らすことはない。
           * 候補（移動可能コア総数）が `minCount` 未満のときは、この支払い経路自体を
           * legal action として提示しない（`exclude`.minCount>0 と同じ「通常コストへの
           * フォールバックなし」原則。実行部は `mechanics/summon-cost-core-move-choice.ts`）。
           */
          kind: "core_move";
          sourceZone: "trash";
          minCount: number;
        };
    duration?: Duration;
  }

  /**
   * 「〜は、自分が【煌臨】するとき、コストはNとしても扱う」型 (BSTH02-C03 Lv2)。
   * `AdventCondition.minCost` の判定にのみ影響する対象限定の実効コスト付与。
   *
   * `cost_modify`（`additionalCostValue`）と異なり:
   * (a) `target` で自分以外のカード群（フィルタ一致するすべて）にも付与できる。
   * (b) 煌臨条件の `minCost` 判定にのみ作用し、他のコスト判定（対象フィルタ・
   *     破壊条件・BP比べ等）には影響しない — 原文が「煌臨するとき」に明示的に
   *     スコープしているため、全コスト判定に波及する additional_cost で近似すると
   *     過剰適用になる。
   *
   * 消費は `matchesAdventCondition`（advent-system.ts）が
   * `getAdventCostOverrides` 経由で行う（SSOT）。
   */
  export interface AdventCostOverrideAction {
    kind: "advent_cost_override";
    target: TargetSpec;
    costTreatedAs: number;
    duration: Duration;
  }

  /**
   * 他の効果のターゲットフィルタ条件を継続的に書き換えるメタ修飾。
   * P3-14 / A-7。
   *
   * 例: 「このスピリットの『BP破壊効果』の上限を+5000し、その対象を相手のアルティメットにもできる」
   *   → effectClass: "bp_destroy", addLimitAmount: 5000, addTargetCategories: ["ultimate"]
   *
   * 既存の継続修飾 (`bp_modify` 等) はカード自体の属性を書き換えるが、
   * `effect_param_modify` は **他効果の DSL パラメータ** (`target.filter.maxBp` /
   * `target.filter.maxCost` / `target.filter.category`) を書き換える。
   *
   * effectClass のテキスト分類:
   *   - "bp_destroy"   → destroy 効果のうち target.filter.maxBp が定義されたもの
   *   - "cost_destroy" → destroy 効果のうち target.filter.maxCost が定義されたもの
   *   - "bp_vanish" / "cost_vanish" → vanish 効果（同様の分類）
   *   - "bp_bounce" / "cost_bounce" → bounce 効果
   *
   * scope:
   *   - "self"           → CE のソース自身が発揮する効果のみが修飾対象
   *   - "combined_unit"  → 合体ユニット（ホスト + 全ブレイヴ）の任意メンバーが
   *                        発揮する効果が修飾対象（合体ブレイヴ → ホスト効果を修飾するケース）
   */
  export interface EffectParamModifyAction {
    kind: "effect_param_modify";
    effectClass:
      | "bp_destroy"
      | "cost_destroy"
      | "bp_vanish"
      | "cost_vanish"
      | "bp_bounce"
      | "cost_bounce"
      | "cost_prevent_battle"
      // 「破壊効果」/「疲労効果」共通で bp 版は前例なし (prevent_battle と同様
      // cost 版のみ)。ExhaustAction の target.filter.maxCost を対象にする。
      | "cost_exhaust";
    /**
     * "self": CE のソース自身が発揮する効果のみが修飾対象。
     * "combined_unit": 合体ユニット（ホスト + 全ブレイヴ）の任意メンバーが発揮する効果。
     * "player_cards": `player` (既定 "self") が支配する、`cardFilter` に一致するカード群が
     *   発揮する効果すべて。「自分のトークンマジックの『破壊効果』/『疲労効果』の…」型
     *   (BSLH01-M01) のような、単一カード/合体ユニットを超えたカード群スコープを表す。
     */
    scope: "self" | "combined_unit" | "player_cards";
    /** scope: "player_cards" のときのみ使用。省略時 "self"。cost_modify の player と同型。 */
    player?: PlayerRef;
    /** scope: "player_cards" のときのみ使用。修飾対象カードの絞り込み条件。 */
    cardFilter?: CardFilter;
    /** maxBp / maxCost の閾値に加算する値。 */
    addLimitAmount?: number | DynamicCount;
    /** ターゲット category に追加するカテゴリ。 */
    addTargetCategories?: CardCategory[];
    duration: Duration;
  }

  /**
   * 他効果の ContinuousEffect の持続期間 (duration.scope) を、生成後も事後的に
   * 書き換えるメタ修飾 (ENGINE-continuous-effect-duration-rewrite)。
   *
   * 例: 「相手のマジックの『このターンの間』を『次のバトル終了後まで』に変更する」
   *   (BSLH01-X03 Lv2-3) → fromScope: "turn", player: "opponent",
   *      cardFilter: { category: ["magic"] },
   *      toDuration: { scope: "battle", nextBattleEnd: true }
   *
   * `effect_param_modify` は他効果の DSL パラメータ (target.filter) を書き換えるが、
   * `duration_override` は **既に生成された ContinuousEffect の duration そのもの** を
   * 事後的に読み替える。登録の前後どちらに作られた対象 CE も、失効判定
   * (removeExpiredContinuousEffects) の都度この CE を参照して実効 duration を評価する
   * ため、生成順序に依存しない。
   */
  export interface DurationOverrideAction {
    kind: "duration_override";
    /** 修飾対象になる ContinuousEffect の元 duration.scope。一致する CE のみ書き換える。 */
    fromScope: Duration["scope"];
    /** 修飾対象カード群の player 方向 (「相手の」/「自分の」)。 */
    player: PlayerRef;
    /** 修飾対象カード群の絞り込み条件 (「マジックの」= category: ["magic"])。 */
    cardFilter?: CardFilter;
    /** 書き換え後の duration。 */
    toDuration: Duration;
    /** このメタ修飾 CE 自体の持続期間。 */
    duration: Duration;
  }

  /**
   * コア除去効果で移動するコア数 +N メタ修飾 (BSTH001-転醒R02(A) effect[1] 他)。
   *
   * 例: 「自分のスピリットの『コア除去効果』で移動するコアの数を+1する」(BSTH001-転醒R02(A))
   *   → kind: "core_move_amount_modifier", scope: "self_player_spirits",
   *      amount: 1, duration: { scope: "while_on_field" }
   * 例: 「このスピリットのコア除去効果で移動するコアの数を+1し、このスピリットによって
   *   減る相手のライフの数を+1する」(BSSA01-転醒X01(B)) → 前半を scope: "self_card"、
   *   後半を scope: "self_card_opponent_life_reduction" の2アクションで表現する。
   *
   * 継続効果として登録し、executeCoreMove が対象コアシュート (相手カード源, source が
   * スコープに合致するもの) の amount に +bonus を加算する。
   * 「コア除去効果」= 効果による相手カードからのコア移動 (battle や cost ではなく effect 由来)。
   * ライフ↔リザーブは「コア除去効果」と別扱い (10_rules/06 line 120) のため
   * self_player_spirits/self_card スコープ外 (別途 self_card_opponent_life_reduction で扱う)。
   *
   * scope:
   *   - "self_player": 自分のコア除去効果すべて。発揮元のカテゴリ・ゾーンを問わない。
   *   - "self_player_spirits": 自分のスピリットがソースのコア除去効果すべて
   *     (「自分のスピリットの」表現に対応, BSTH001-転醒R02(A))
   *   - "self_card": 修飾源と同じ合体スピリットのコア除去効果すべて
   *     (「このスピリットの」表現に対応, BSSA01-転醒X01(B))
   *   - "self_card_opponent_life_reduction": 修飾源と同じ合体スピリットが
   *     source となって相手のライフのコアを移動させる (=相手のライフを減らす) とき
   *     のみ +N (「このスピリットによって減る相手のライフの数を+N」表現に対応、
   *     コア除去とは別に、from:life / life_damage / アタックで照合)
   *
   * 終止形 = 強制適用 / プレイヤー選択不可 / 期間中ずっと +N (first-opportunity 消費なし)。
   */
  export interface CoreMoveAmountModifierAction {
    kind: "core_move_amount_modifier";
    scope:
      | "self_player"
      | "self_player_spirits"
      | "self_card"
      | "self_card_opponent_life_reduction";
    amount: number;
    duration: Duration;
  }

  // ════ 状態変更 (3種) ════

  export interface RecoverAction {
    kind: "recover";
    target: TargetSpec;
  }

  export interface ExhaustAction {
    kind: "exhaust";
    target: TargetSpec;
    degree?: "exhaust" | "heavy_exhaust";
    maxPreventable?: number;
    /**
     * ENGINE-delayed-turn-end-captured-target-state-transition (BSTH11-C04):
     * `degree:"heavy_exhaust"` で重疲労させた対象を、このターン終了時 (次回 end-step
     * cleanup) に疲労状態へ自動で引き下げる予約を行う。「この効果で疲労した対象は、
     * このターン終了時、疲労状態になる」型専用。`degree` が `"heavy_exhaust"` 以外の
     * ときは無視される。
     */
    downgradeAtTurnEnd?: boolean;
  }

  export interface SetExhaustStateAction {
    kind: "set_exhaust_state";
    target: TargetSpec;
    /** `matchExhaustStateOf` 指定時は無視される。 */
    state?: "recovered" | "exhausted" | "heavily_exhausted";
    /**
     * 指定時、`state` の代わりに、`resolveTargetSpec` で解決した参照カード (先頭1件) の
     * *現在の* exhaustState を `target` へコピーする（「〜と同じ状態で並べる」型、
     * BSSL01-M03[3,4]。`comparer` (BpCompareDestroyAction) と同じ動的参照パターン）。
     * 参照カードが解決できない場合は no-op（exhaustState を変更しない）。
     */
    matchExhaustStateOf?: TargetSpec;
    /** 状態を合わせた参照カードの指定側へ並べる。状態一致と配置の両方が対価。 */
    placement?: "left" | "right";
    maxPreventable?: number;
  }

  /**
   * engine-exhaust-provenance-skip-refresh (BSLH01-C04): 対象カードに「次のリフレッシュ
   * ステップでは回復できない」1回限定マーカーを付与する。CardInstance.skipNextRefreshRecovery
   * を true にし、`refreshExhaustStates` が次回の一段階回復を禁止してマーカーを消費する。
   * 重疲労→疲労も禁止する。既に回復状態でも次回リフレッシュでマーカーを消費する。
   */
  export interface PreventNextRecoveryAction {
    kind: "prevent_next_recovery";
    target: TargetSpec;
  }

  /**
   * カードを「フィールドに留まらせる」アクション（triggered effect 用）。
   *
   * 用途: 「破壊されたとき/フィールドを離れたとき、疲労状態でフィールドに残る」等の
   * *triggered* な残置効果。pendingLeave に入った *後* に triggered timing で発火し、
   * 対象を pendingLeave から取り除いて指定の疲労状態でフィールドに残置する。
   *
   * 同じ simultaneousGroupId に属する destroy/leave_field 系の pending triggered/burst で
   * `relatedInstanceId === target.instanceId` のものは同時にキャンセルする
   * （例: 「相手スピリットを破壊したとき」と同時誘発した場合に、C 側を留めると
   * 連動してその対象に対する破壊起因の B 側も不発になる）。
   *
   * 真の置換（破壊そのものを回避し、pending leave 自体を生成させない）は
   * `EffectResistanceAction` の `replacement` を使うこと。
   */
  export interface StayOnFieldAction {
    kind: "stay_on_field";
    target: TargetSpec;
    /**
     * 残置時の新しい疲労状態。省略時は現在の疲労状態を維持する
     * （「同じ状態で残す/残せる」= 疲労状態を変えずにフィールドに残る）。
     */
    newExhaustState?: "recovered" | "exhausted" | "heavily_exhausted";
  }

  // ════ 戦闘制御 (7種) ════

  export interface PreventBattleAction {
    kind: "prevent_battle";
    target: TargetSpec;
    restriction: ("attack" | "block")[];
    duration: Duration;
    /**
     * ルール強度の戦闘不可。通常の「アタック/ブロックできない」効果は成立済み
     * バトルを取り消さないが、スピリット状態ルール等で戦闘主体ではなくなる
     * class は CE metadata に ruleStrength を伝播する。
     */
    ruleStrength?: boolean;
  }

  export interface PreventBraveSeparationAction {
    kind: "prevent_brave_separation";
    target: TargetSpec;
    duration: Duration;
  }

  /**
   * 「(対象)は《ソウルコア》以外のコアを取り除けない」。
   *
   * 対象カードからの通常コア移動を禁止する継続効果。ソウルコア移動は妨げない。
   */
  export interface PreventNormalCoreMoveAction {
    kind: "prevent_normal_core_move";
    target: TargetSpec;
    duration: Duration;
  }

  /**
   * 「アタック/ブロックする(対象)から Nコスト支払わなければアタック/ブロックできない」
   * (BSAZ01-C09)。prevent_battle と異なり、対象カード自身の通常コアから costAmount 分を
   * 支払えばアタック/ブロック宣言できる（支払い不能なら不可）。動的 filter (player+category
   * のみ、count は常に「すべて」相当) のみ対応。
   */
  export interface RequireBattleCostAction {
    kind: "require_battle_cost";
    target: TargetSpec;
    restriction: ("attack" | "block")[];
    costAmount: number;
    duration: Duration;
    /**
     * true のとき、このアタックステップで最初のアタックにだけゲートを課す。
     * 指定対象が「このステップの最初にアタックするなら…」型のときに使う。
     */
    firstAttackOnly?: boolean;
  }

  /**
   * 「(player)は、Nコスト支払わなければ、(player)の効果でデッキ/トラッシュ/オープンした
   * カードから手札を増やせない」継続制約の登録 (engine-opponent-hand-gain-paid-tax-gate,
   * BSRK01-C02[3,4])。require_battle_cost と同じ「宣言 CE として登録するだけ」の設計だが、
   * 対象は特定カードではなく `player` の「デッキ/トラッシュから手札に加える」アクション
   * 全般 (`deck_reveal` の pick / revealed disposition による手札追加。origin:"deck" と
   * origin:"trash" のどちらの pendingDeckReveal も同じ経路 = 「デッキ」「オープン」「トラッシュ」
   * いずれの手札加算も対象になる)。
   *
   * 対価は自分のリザーブから costAmount 個 (pay_cost の通常コア優先/ソウルコアフォールバック
   * と同じ消費経路、`payDeckRevealCostGate` を再利用)。支払い不能な pick/branch は
   * `resolveDeckRevealCostGateToApply` 経由で候補0枚化され (`DeckRevealPick.costGate` と
   * 同じ affordability 経路、BSTH08.5-C23 由来)、その手札加算は選択できず既存の
   * remainder 処理 (デッキ下等) にフォールバックする。affordable なときは選択確定時に
   * 自動で支払われる (require_battle_cost と同じく player 側に「払わない」選択肢は無い)。
   */
  export interface RequireHandGainCostAction {
    kind: "require_hand_gain_cost";
    /** 制約を課す対象プレイヤー（通常 "opponent"）。 */
    player: PlayerRef;
    costAmount: number;
    duration: Duration;
  }

  /**
   * 「(player)は、(player)の効果で手札を増やせない」完全禁止 (engine-restrict-hand-gain-
   * bsrk01-x01, BSRK01-X01 合体結誓)。`isHandGainPreventedByOwnEffect` が発揮者と
   * 手札を得るプレイヤーを照合し、draw / 非交換 bounce / search_zone /
   * search_deck / deck_reveal の純増だけを完全に止める。別プレイヤーによる手札戻し、
   * hand_swap のような純増しない交換、開始時の基本ドローは対象外。
   */
  export interface HandGainPreventionAction {
    kind: "hand_gain_prevention";
    /** 増加を禁止されるプレイヤー（通常 "opponent"）。 */
    player: PlayerRef;
    duration: Duration;
  }

  /**
   * 「アタックする(対象)は、自分の別のカード1体を疲労させなければアタックできない」。
   * 支払い候補は宣言するカードと同じ controller の field 上・回復状態・非 attached の
   * costTargetFilter.category 合致カードに限る。宣言元自身は候補にしない。
   */
  export interface RequireAttackExhaustCostAction {
    kind: "require_attack_exhaust_cost";
    target: TargetSpec;
    costTargetFilter: Pick<CardFilter, "category">;
    duration: Duration;
  }

  /**
   * 「アタック/ブロックする(対象)は、対象自身と同じ controller の別カード1体を破壊
   * しなければアタック/ブロックできない」(BSDB01-C09)。require_attack_exhaust_cost の
   * 破壊版。restriction は require_battle_cost と同じく attack/block を選べる
   * (require_attack_exhaust_cost はアタック専用のため配列なし)。
   */
  export interface RequireBattleDestroyCostAction {
    kind: "require_battle_destroy_cost";
    /** Omitted: destroy the payment card. */
    destination?: "deck_bottom";
    target: TargetSpec;
    restriction: ("attack" | "block")[];
    costTargetFilter: Pick<CardFilter, "category">;
    duration: Duration;
  }

  export interface PreventLifeDamageAction {
    kind: "prevent_life_damage";
    player: PlayerRef;
    duration: Duration;
  }

  export interface UnblockableAction {
    kind: "unblockable";
    target: TargetSpec;
    duration: Duration;
  }

  /**
   * 「疲労状態でもブロックできる」付与（block-while-exhausted）。
   * 通常ブロックは回復状態が必要（10_rules/02 L122 / 05 L114）だが、本効果を持つ
   * カードは疲労状態でもブロック宣言できる。prevent_battle の対概念（許可側）。
   * CE: modifierTag "allow_block_while_exhausted" を target に登録する。
   */
  export interface AllowBlockWhileExhaustedAction {
    kind: "allow_block_while_exhausted";
    target: TargetSpec;
    duration: Duration;
  }

  /**
   * 「疲労状態のこのスピリットは、重疲労させることでアタックできる」付与
   * (BSTH09-C04【追撃】)。通常アタック宣言は回復状態が必要だが、本効果を持ち
   * かつ「疲労状態」(重疲労は対象外) のカードは、宣言確定時に重疲労状態へ遷移する
   * ことを対価としてアタック宣言できる。allow_block_while_exhausted のアタック版だが、
   * 消費時に通常の「疲労」ではなく「重疲労」へ遷移する点が異なる。
   * CE: modifierTag "allow_attack_while_exhausted" を target に登録する。
   */
  export interface AllowAttackWhileExhaustedAction {
    kind: "allow_attack_while_exhausted";
    target: TargetSpec;
    duration: Duration;
  }

  /**
   * 「ターンに1回、疲労せずにアタック/ブロックできる」付与 (BSTH09-C03)。
   * 宣言前提条件は変えない (通常通り回復状態が必要)。宣言確定時に本来発生する
   * 疲労遷移をターンに1回だけスキップする (タップ無しアタック/ブロック)。
   * アタック/ブロックいずれか1回で消費し、両方には使えない共有予算。
   * CE: modifierTag "allow_tapless_battle_declare" を target に登録する。
   */
  export interface AllowTaplessBattleDeclareAction {
    kind: "allow_tapless_battle_declare";
    target: TargetSpec;
    duration: Duration;
  }

  /**
   * 「ブロックされない」相手をブロックできる許可。
   * CE: modifierTag "block_unblockable" を blocker 側 target に登録する。
   */
  export interface BlockUnblockableAction {
    kind: "block_unblockable";
    target: TargetSpec;
    duration: Duration;
  }

  /**
   * 「N体まで同時にアタックでき、バトルは同時に解決する」付与（P2-05）。
   * player に、filter に合致する自分のスピリット/アルティメットを maxCount 体まで
   * 同時にアタック宣言する許可を与える。group 全体で「アタックしたとき」観測は
   * 1回（公式 Q26342）、各参加体自身の『アタック時』は個別に発揮（Q26329）。
   *
   * blockerCapacity は同時アタックに対する相手のブロック数上限。
   * 省略時 1（公式 Q26724）。"participant_count" = 同時アタック数まで
   * （BSTH07.8-XX01 qa-022）。数値 = 固定上限（BSTH02-R03 = 2）。
   * 消費は Phase 2（複数ブロック）で配線。
   *
   * CE: modifierTag "allow_simultaneous_attack" を player に登録する
   * （targetInstanceId = playerId、metadata に filter / maxCount / blockerCapacity）。
   * ルール正源: 10_rules/05 §複数体同時アタック。
   */
  export interface AllowSimultaneousAttackAction {
    kind: "allow_simultaneous_attack";
    player: PlayerRef;
    filter: CardFilter;
    maxCount: number;
    blockerCapacity?: number | "participant_count";
    duration: Duration;
  }

  /**
   * 「召喚した(filter 合致)自分のスピリット/アルティメットは、相手のブロック宣言前なら
   * ただちにアタックできる」付与（P2-05 Phase 5, BSTH07.8-XX01【導域】）。
   * player に、filter に合致するカードの召喚直後、ブロック宣言前のアタックへ参加する
   * 機会を与える。神託・召喚時効果等の完了後に参加／辞退を選び、通常フラッシュを消費しない。
   * 機会は GameState.pendingImmediateAttackJoins に記録する。参加宣言のスタック応答後に
   * `joinActiveAttackAsAction` (joinMode:"mid_battle") で確定する。
   *
   * CE: modifierTag "allow_mid_battle_join" を player に登録する
   * （targetInstanceId = playerId、metadata に filter）。
   * ルール正源: 10_rules/05 §複数体同時アタック。
   */
  export interface AllowMidBattleJoinAction {
    kind: "allow_mid_battle_join";
    player: PlayerRef;
    filter: CardFilter;
    duration: Duration;
  }

  /**
   * 「filter に合致するカードを召喚するとき、召喚条件を無視して召喚できる」付与
   * (BSAZ02-C11【アルティメット合体中】)。player に、filter に合致するアルティメット
   * カードの通常召喚（legal action 経由）で、CardDefinition.summonCondition の判定を
   * バイパスする許可を与える。
   *
   * CE: modifierTag "allow_ignore_summon_condition" を player に登録する
   * （targetInstanceId = playerId、metadata に filter）。
   * 消費側は canSummonUltimate（legal-actions-shared.ts）が
   * getIgnoreSummonConditionGrant 経由で確認する。
   */
  export interface AllowIgnoreSummonConditionAction {
    kind: "allow_ignore_summon_condition";
    player: PlayerRef;
    filter: CardFilter;
    duration: Duration;
  }

  /**
   * 「自分は、指定 duration の間ゲームに敗北しない」付与 (BSTH05.5-XX01【神域】
   * 「このネクサスのコアすべてをボイドに置ける。そうしたとき、自分は、次の
   * 『自分のエンドステップ』までゲームに敗北しない。」)。
   *
   * CE: modifierTag "immune_to_game_loss" を player に登録する
   * （targetInstanceId = playerId）。消費側は isPlayerImmuneToGameLoss
   * （legal-actions-shared.ts）が、ライフ0敗北判定 (applyLifeZeroDefeat) と
   * デッキ0敗北判定 (turn-system.ts 2箇所) から確認する。
   */
  export interface GrantGameLossImmunityAction {
    kind: "grant_game_loss_immunity";
    player: PlayerRef;
    duration: Duration;
  }

  /**
   * 「filter に合致するスピリット/アルティメットカードを召喚するとき、この効果の発揮元
   * (sourceInstanceId) を疲労させることを選べる。そうしたとき、召喚条件を無視し／軽減
   * シンボルすべてを満たしたものとして扱う」付与 (BSAZ02-C08【月面基地】)。
   * allow_ignore_summon_condition (無条件・永続) と異なり、本許可は「発揮元を疲労させる」
   * という per-summon 任意コストで初めて有効になる（プレイヤーは使わない選択もできる。
   * 使わなければ発揮元は疲労しないまま、通常の召喚可否がそのまま適用される）。
   *
   * CE: modifierTag "grant_declared_summon_alt_cost" を player に登録する
   * （targetInstanceId = playerId、sourceInstanceId = 疲労対象となる発揮元カード自身、
   * metadata に filter/benefits）。
   * 消費側は getAvailableHandSummonPermissionLegalActions (legal-actions-availability.ts)
   * が getDeclaredSummonAltCostGrant (legal-actions-shared.ts) 経由で確認する。
   */
  export interface GrantDeclaredSummonAltCostAction {
    kind: "grant_declared_summon_alt_cost";
    player: PlayerRef;
    filter: CardFilter;
    benefits: {
      ignoreSummonCondition?: boolean;
      fullReduction?: boolean;
    };
    duration: Duration;
  }

  /**
   * 「filter に合致するスピリット/アルティメットカードを召喚するとき、対象に置くコアは
   * トラッシュからも<ソウルコア>以外のコアを amount 個まで置ける」付与
   * (BSLH01-T13「メルティライズ」フラッシュ〔ターンに1回：同名〕
   * 「次の自分のスタートステップまで、自分が系統：「CB」を持つスピリットカードを
   * 召喚するとき、対象に置くコアはトラッシュからも<ソウルコア>以外のコアを1個ずつまで
   * 置ける」)。player に、通常の手札召喚 (`playSummonAsAction`/
   * `useSummonInStackContextAsAction`) が使う `EnterFieldCorePlacementPolicy` へ
   * `allowedTrashNormalCoreCount` を合流させる許可を与える。
   *
   * CE: modifierTag "grant_summon_trash_core_placement" を player に登録する
   * （targetInstanceId = playerId、metadata に filter/amount）。
   * 消費側は getSummonTrashCorePlacementGrant（legal-actions-shared.ts）が
   * `def` (召喚するカード定義) にマッチする CE を検索する。
   */
  export interface GrantSummonTrashCorePlacementAction {
    kind: "grant_summon_trash_core_placement";
    player: PlayerRef;
    filter: CardFilter;
    amount: number;
    duration: Duration;
  }

  /**
   * 「このターンの間、自分は、フラッシュタイミングを[limit]回ずつまで続けて行える」
   * (BSLH01-T15「カラミティクロウ」)。フラッシュ優先権ループ (10_rules/02
   * §フラッシュタイミングの優先権ループ) は既定で「能動フラッシュ使用1回ごとに相手へ優先権
   * 移譲」だが、本 CE が発揮者に登録されている間は、同一プレイヤーの連続能動使用が
   * `limit` 回に達するまで優先権移譲を保留する。player-scoped: targetInstanceId = playerId、
   * metadata.limit。消費側は getFlashConsecutiveUseLimitGrant
   * (legal-actions-shared.ts) で、battle-actions.ts usePassBattleFlashAsAction の
   * 能動使用カスケード解決分岐 (BattleFlashWindowState.consecutiveActiveUseCount) が参照する。
   */
  export interface GrantFlashConsecutiveUseAction {
    kind: "grant_flash_consecutive_use";
    player: PlayerRef;
    limit: number;
    duration: Duration;
  }

  /**
   * 「このターンの間、自分の魂状態のカードすべての【リンクエイド】を『フィールド/リザーブ
   * から1コスト支払って、フィールド/リザーブのコアを好きなだけ置いてスピリット状態にする』
   * に変更する」(BSGE01-C03「ディソレイト」フラッシュ、空木レンカ(魂状態含む)存在条件)。
   *
   * 通常の【リンクエイド】(`CardDefinition.linkAidData`) は起動コスト源を
   * `costSourceTribes` 一致の自分のフィールドスピリット固定1コアに限定し、解決後の
   * charge も `sourceScope:"reserve_only"` (リンクエイド起動コアを積む先はリザーブ限定、
   * mechanics/link-aid-system.ts) だが、本 CE が自分に登録されている間は両方が緩和される:
   * (1) 起動コスト源が「フィールド/リザーブから1コスト」= 系統/カテゴリ不問の自分の
   *     フィールドカード or リザーブに拡張 (`costSourceTribes` を無視)、
   * (2) 解決後 charge が `sourceScope:"field_and_reserve"` に拡張。
   * player-scoped CE (`grant_link_aid_cost_override`、targetInstanceId = playerId)。
   * 消費側は mechanics/link-aid-system.ts の isLinkAidCostOverrideActive
   * (getAvailableLinkAidLegalActions / resolveDeferredLinkAidStack 両方が参照)。
   */
  export interface GrantLinkAidCostOverrideAction {
    kind: "grant_link_aid_cost_override";
    player: PlayerRef;
    duration: Duration;
  }

  /**
   * 「自分がスピリットの効果でデッキをオープン/破棄するとき、枚数を+1できる」付与
   * (BSLH01-X09【クォーツ：練刃】)。「+1できる」= 可能形語尾＝任意
   * ([[project_kuwaerareru_optional]])、deck_reveal 実行の都度プレイヤーが+1適用可否を
   * 選べる。
   *
   * CE: modifierTag "grant_optional_deck_reveal_count_boost" を player に登録する
   * （targetInstanceId = playerId、metadata に sourceFilter/bonusAmount）。
   * ENGINE-optional-deck-reveal-count-boost は Step2/Step3 で deck_reveal と
   * discard(fromZone:deck) 両方の pending choice 消費側まで配線済み
   * (effect-interpreter.ts handleDeckRevealCountBoostChoice、engine-deep-ledger 参照)。
   */
  export interface GrantOptionalDeckRevealCountBoostAction {
    kind: "grant_optional_deck_reveal_count_boost";
    player: PlayerRef;
    /** 対象となる deck_reveal の発揮元カード条件 (「スピリットの効果」= category:["spirit"])。 */
    sourceFilter: CardFilter;
    /** 選択時に加算する量。省略時 1。 */
    bonusAmount?: number;
    duration: Duration;
  }

  /**
   * 「自分が[sourceFilter]の効果で相手の[targetFilter]を対象にするとき、ターンにN回、
   * その対象を+N する」対象数拡張の付与 (BSLH01-TR02(A)【クォーツ：範囲】)。
   * 既存 register_redirect_effect_target CE は元 target slice 内の保護対象を別対象へ
   * 置換するだけで、対象「数」自体は変更できないため、専用 CE を新設する。
   *
   * CE: modifierTag "expand_effect_target_count" を player に登録する
   * （targetInstanceId = playerId、metadata に sourceFilter/targetFilter/targetPlayer/
   * bonusAmount/usageLimit）。
   * **Step3 (ENGINE-target-count-expand-modifier) 時点で auto-resolve 経路の消費側
   * (native-target-resolution.ts の applyActionTargetCount、および target-resolution.ts
   * resolveTargetSpec の count 解決部) と usageLimit 実消費記録は配線済み。
   * GUI 候補数上限 (legal-actions-availability.ts) と手動対象選択
   * (stack-target-resolution.ts getStackTargetSelection) への配線は Step4 以降**
   * (詳細は expand-effect-target-count.ts 冒頭コメント、engine-deep-ledger 参照)。
   */
  export interface RegisterExpandEffectTargetCountAction {
    kind: "register_expand_effect_target_count";
    player: PlayerRef;
    /** 対象数拡張の対象になる効果の発揮元カード条件 (「トークンマジックの効果」= isToken:true)。 */
    sourceFilter: CardFilter;
    /** 拡張対象になる TargetSpec 自体の filter 条件 (「相手のスピリット/アルティメット/ネクサス」)。 */
    targetFilter: CardFilter;
    /**
     * 拡張対象になる TargetSpec 自体の player 方向 ("相手の"/"自分の"/無指定)。
     * targetFilter (カード種別) とは独立した軸で、bonus 適用対象の候補プールが
     * この player 方向を満たす controller のカードを含む場合のみ bonus を乗せる
     * (self 効果への scope leak 防止。adversarial verifier 2026-07-20 round1 で検出)。
     */
    targetPlayer: PlayerRef;
    /** 加算する対象数。省略時 1。 */
    bonusAmount?: number;
    /** 発動回数制限 (「ターンに1回」)。省略時は無制限。 */
    usageLimit?: import("./model").EffectUsageLimit;
    duration: Duration;
  }

  /**
   * 「相手はブロックするとき、filter に合致する自分のアタッカーを requiredBlockerCount 体で
   * なければブロックできず、ブロックされたとき、それらと同時にバトルする」複数体ブロック
   * 強制付与 (P2-05 Phase 5, BSFT01-TR06(B)型)。BP 比較は各ブロッカーと個別に 1vs1 で行う
   * (合算比較ではない。10_rules/05b §複数体ブロック強制、裁定2026-07-12・信頼度B)。
   *
   * player に、filter に合致する自分のアタッカーがアタックしたとき、相手のブロック宣言に
   * requiredBlockerCount 体を要求する許可を与える。
   * CE: modifierTag "require_multi_block" を player (自分、攻撃側) に登録する
   * （targetInstanceId = playerId、metadata に filter / requiredBlockerCount）。
   */
  export interface RequireMultiBlockAction {
    kind: "require_multi_block";
    player: PlayerRef;
    filter: CardFilter;
    requiredBlockerCount: number;
    duration: Duration;
  }

  /**
   * 「相手のスピリット/アルティメットは、可能ならブロックする」型。
   * player に、attackerFilter に合致する自分のアタッカーのバトル中、
   * blockerFilter に合致する防御側ブロッカーを合法に出せるなら
   * decline_block できない制約を与える。
   * attackerFilter 省略時は、この CE の sourceInstanceId を含む攻撃参加体だけを
   * 対象にする（「このスピリットのアタック時」型）。
   */
  export interface RequireBlockIfAbleAction {
    kind: "require_block_if_able";
    player: PlayerRef;
    attackerFilter?: CardFilter;
    blockerFilter?: CardFilter;
    duration: Duration;
  }

  /**
   * 「自分が tribeFilter を持つマジックカードを使用するとき、そのコストを支払う前に、
   * ただちに triggerEffectIndex の効果を使用できる」権利付与
   * (engine-magic-field-pre-cost-payment-trigger, BSAZ01-C12「戦力投入」)。
   * 他カードのコスト支払いに割り込む cross-card pre-cost トリガーの汎用化。
   * CE: modifierTag "offer_magic_pre_cost_trigger" を player に登録する
   * (metadata: { tribeFilter, triggerEffectIndex })。
   */
  export interface OfferMagicPreCostTriggerAction {
    kind: "offer_magic_pre_cost_trigger";
    player: PlayerRef;
    /** 対象マジックの系統フィルタ (例: ["地球"])。1つでも合致すれば対象。 */
    tribeFilter: string[];
    /** ただちに使用できるメイン効果の DSL effect index (同一カード内)。 */
    triggerEffectIndex: number;
    duration: Duration;
  }

  /**
   * 「ターンの最初のバトル終了時、(player の) アタックステップは終了する」制限
   * (P2-05 Phase 4b, BSTH07.8-XX01【導域】)。同時アタックを使わない 1 体アタックの
   * バトルでも発動する。CE 有効化がターン最初のバトル終了より後ならその瞬間は
   * 過ぎており発動しない。実行は executeEndAttackStep (restrict_end_attack_step
   * 妨害を受ける「効果による終了」)。
   * CE: modifierTag "force_attack_step_end_after_first_battle" を player に登録。
   */
  export interface ForceAttackStepEndAfterFirstBattleAction {
    kind: "force_attack_step_end_after_first_battle";
    player: PlayerRef;
    duration: Duration;
  }

  export interface RestrictFlashAction {
    kind: "restrict_flash";
    player: PlayerRef;
    source?: Zone | Zone[];
    duration: Duration;
  }

  /**
   * 「相手はスタック効果を発揮できない」(P3-75)。restrict_flash と同型。
   * スタック応答窓でのスタック効果発揮を禁止する。
   */
  export interface RestrictStackAction {
    kind: "restrict_stack";
    player: PlayerRef;
    duration: Duration;
    /**
     * 省略時は従来どおり player target（「相手は、スタック効果を発揮できない」）。
     * "effect_source" は読点なし文言など、発揮元カード/効果側を対象にする抑止。
     */
    targetScope?: "player" | "effect_source";
    /** targetScope:"effect_source" 用。指定時は一致する効果だけを抑止する。 */
    effectFilter?: EffectTargetFilter;
    /**
     * targetScope:"effect_source" 用の発揮元カード条件。効果種別ではなく、実際に
     * スタック効果を発揮しようとするカードの実効カテゴリ・系統・コストで照合する。
     */
    sourceCardFilter?: CardFilter;
  }

  /**
   * 「相手はバーストを発動できない」。`negate_opponent_burst` 系の効果抑制ではなく、
   * pending burst check の発動宣言 legal action 生成自体を抑止する。
   */
  export interface RestrictBurstActivationAction {
    kind: "restrict_burst_activation";
    player: PlayerRef;
    duration: Duration;
    /**
     * 対価。指定時は「対価を支払わなければバーストを発動できない」
     * (BSTH02-M02「ライフのコア2個をボイドに置かなければ」)。未指定時は無条件禁止 (既存挙動)。
     * resource は現状 "life_core" のみ対応 (ライフの通常コアのみが対象、ボイドへの
     * ソウルコア移動は generic effect では不可なため、資力判定・支払いとも通常コアで行う)。
     */
    cost?: { resource: "life_core"; amount: number };
  }

  /**
   * 「相手は【煌臨】できない」(ENGINE-restrict-advent、BSFT01-X01)。restrict_stack と同型。
   * declare_advent legal action の生成自体をプレイヤー単位で抑止する。
   */
  export interface RestrictAdventAction {
    kind: "restrict_advent";
    player: PlayerRef;
    duration: Duration;
  }

  /**
   * 「相手の[filter]カードは回復できない」(ENGINE-persistent-recovery-block-with-advent-host-exclusion、
   * BSTH11-X01【神域】)。restrict_advent と同型の player-scoped CE。filter 省略時は
   * 対象プレイヤーの全カード。リフレッシュ・効果による回復の共通判定を通す。
   * 「重疲労状態の」等の限定は filter に記述し、カードの耐性も判定する。
   */
  export interface RestrictRecoveryAction {
    kind: "restrict_recovery";
    /** 省略時は「回復できない」。become_recovered は「回復状態にできない」。 */
    restriction?: "recover" | "become_recovered";
    player: PlayerRef;
    /** 指定時は選択したカードだけを制限する。省略時はプレイヤー全体。 */
    target?: TargetSpec;
    /** 禁止が有効なステップ。重疲労後のリフレッシュ時限定など。 */
    timingScope?: TimingScope;
    filter?: CardFilter;
    duration: Duration;
  }

  /**
   * 「相手はリザーブからコストが支払えない」(ENGINE-restrict-reserve-cost-payment、
   * BSSL01-R03)。restrict_advent と同型の player-scoped CE。
   * コスト支払いソース (10_rules/03a 支払いソース: リザーブ / フィールドのカード上)
   * のうちリザーブを対象プレイヤーから一時的に除外する。フィールドのカード上のコアは
   * 引き続き支払いソースとして使える。
   */
  export interface RestrictReserveCostPaymentAction {
    kind: "restrict_reserve_cost_payment";
    player: PlayerRef;
    duration: Duration;
  }

  /**
   * 「相手のマジックのスタック効果コストは、フィールド（カード上のコア）から支払えない」
   * (ENGINE-restrict-field-cost-payment、BSTH08-C06)。restrict_reserve_cost_payment と
   * 対称の player-scoped CE で、支払いソースからフィールドのカード上のコア
   * (onBoardCoreSources、ソウルコア含む) を一時的に除外する。リザーブは引き続き使える。
   * effectModes を省略すると全コスト種別(main/flash/stack)を制限する
   * (restrict_reserve_cost_payment と同じ無条件挙動)。BSTH08-C06 のように
   * 特定コスト種別のみを制限するカードは effectModes:["stack"] のように指定する。
   */
  export interface RestrictFieldCostPaymentAction {
    kind: "restrict_field_cost_payment";
    player: PlayerRef;
    duration: Duration;
    effectModes?: readonly ("main" | "flash" | "stack")[];
  }

  /**
   * 「自分の系統：「○○」を持つ効果は、相手の効果では防げない」
   * (engine-effect-prevention-immunity-tribes、BSSL01-X02[9,10])。
   *
   * 既存 `preventionRestriction`/`preventionLevel` はカード定義側 (author-time) の
   * 静的スコープで、その効果自身にしか付与できない。本 primitive は player-scoped CE
   * (`effect_source_prevention_immunity`) を登録し、**登録後に発揮される** 任意の
   * 効果のうち、発生源カードの実効系統 (`getEffectiveTribes`) が `sourceScope.tribes`
   * のいずれかに一致するものを、宣言時に `sourcePreventionLevel: "unpreventable"` へ
   * 動的に昇格する（`grant_paid_prevention_immunity` の無償・自動版と同じ消費経路
   * = 宣言時に active stack へ `preventionLevel` を焼き込む。対象は誘発、マジック、
   * フィールド起動、バトル即時効果）。
   */
  export interface GrantEffectSourcePreventionImmunityAction {
    kind: "grant_effect_source_prevention_immunity";
    /** 免疫の恩恵を受けるプレイヤー（通常 "self"）。 */
    player: PlayerRef;
    /**
     * 免疫対象となる効果の発生源カードが満たすべきスコープ。
     * - `{ tribes }`: 発生源カードの実効系統（OR 結合）。
     * - `{ soulDriveDeparture: true }`: 発生源カードが【ソウルドライブ・S】型コスト
     *   （`core_move` の `effectKind:"explicit_soul_core"` + `to.kind:"removed_from_game"`）を
     *   払い、かつ相手のスピリット/アルティメットへ破壊/コアシュートによる離脱を及ぼす効果
     *   （BSLH01-C07 冥王珠）。tribes と異なり、判定基準は発生源カードでなく**宣言中の
     *   効果定義そのもの**（`resolveEffectSourcePreventionLevel` が `effect` を直接検査）。
     * - `{ effectClass, source }`: `effect_param_modify` と同じ効果分類に一致する、発生源
     *   スコープ内の効果だけを対象にする。「このアルティメットのコスト破壊効果」型。
     */
    sourceScope:
      | { tribes: string[] }
      | { soulDriveDeparture: true }
      | {
          effectFilter: EffectTargetFilter;
          source: "self" | "combined_host" | "combined_unit";
        }
      | {
          effectClass: import("./effect/effect-param-override").EffectParamOverrideClass;
          source: "self" | "combined_host" | "combined_unit";
          sourceMinLevel?: number;
        };
    /**
     * 指定時は blanket `unpreventable` へ昇格せず、防止側 CE の発生源がこの
     * profile に一致する target/leave 防止だけを貫通する。
     */
    preventionBypass?: import("./effect/target-affect-gate").TargetLockBypassProfile;
    /**
     * 省略時は既存互換の "prevention"（target/leave 防止貫通）。
     * "stack_negate" は効果発揮/使用を無効にする stack negate だけを拒否する。
     */
    appliesTo?: readonly ("prevention" | "stack_negate")[];
    /**
     * 指定時、実際に免疫が適用される（`level === undefined` から `"unpreventable"` へ
     * 昇格する）たびに `sourceInstanceId`(=本CEの発生源=クォーツ等) を鍵に消費する
     * （`recordEffectUsageIfLimited`、effectLabel固定 `"grant_effect_source_prevention_immunity"`）。
     * 「ターンの最初の1回のみ」(BSLH01-C07) のような grant 自体の発動回数制限に使う。
     * 既に静的に unpreventable な効果（level が undefined でない）には適用されないため
     * 消費もされない。
     */
    usageLimit?: import("./model").EffectUsageLimit;
    duration: Duration;
  }

  /**
   * 「このカード/スピリットは相手のスタックタイミング元にならない」(BSDB01-M02)。
   * restrict_stack が対象プレイヤーの stack 効果全体を禁止するのに対し、これは
   * 発揮元カード単位で相手の応答 stack 使用だけを禁止する。
   */
  export interface SuppressStackSourceAction {
    kind: "suppress_stack_source";
    target: "self";
    player: PlayerRef;
    duration: Duration;
    /** 指定時は、現在の stack source の効果記述子がこの条件に合う場合だけ抑止する。 */
    effectFilter?: EffectTargetFilter;
  }

  /**
   * 「このスピリットは可能ならこのターンの最初にアタックする」
   * (ENGINE-force-first-attack-this-turn, BSTH02.7-TR02(A))。
   * duration は常に「今ターンの間」固定 (パラメータ化しない、model.ts 側で hardcode)。
   */
  export interface ForceFirstAttackerAction {
    kind: "force_first_attacker";
    target: "self";
  }

  /**
   * 「相手が対象を選ぶ効果を発揮するとき、可能ならこのカードを対象に含めなければ
   * ならない」タウント (forced-target-inclusion-taunt cluster, BSFT01-TR02(B))。
   * duration は常に「場にいる間」固定 (パラメータ化しない、model.ts 側で hardcode)。
   */
  export interface ForcedTargetInclusionAction {
    kind: "forced_target_inclusion";
    target: "self";
  }

  /**
   * 「相手は[ゾーン]のコア1個をトラッシュに置かなければ、フラッシュ/スタック効果を発揮できない」
   * (発揮前提の除去/移動効果。BSTS01-M03 / 10_rules/03c §「○○しなければ△△を発揮できない」)。
   *
   * restrict_stack のハード禁止とは異なり、追加コスト(pay-to-act)でもなく、
   * **発揮の前提として相手にコア除去(移動)を課す継続効果**。コスト経路でなく
   * `core_move` 相当の除去で表現する（耐性が効くのが核心）。発揮(解決)の直前・対象選択前に、
   * 相手は指定ゾーン(既定: フィールド/リザーブ)のコア1個をトラッシュへ移さなければ、その
   * フラッシュ/スタック効果を発揮できない。粒度＝発揮1回ごとにコア1個。
   */
  export interface GateFlashStackCoreAction {
    kind: "gate_flash_stack_core";
    /** ゲートをかける対象プレイヤー (通常 "opponent")。 */
    player: PlayerRef;
    /** コアの除去元ゾーン。省略時はフィールド + リザーブ。 */
    source?: Zone | Zone[];
    duration: Duration;
  }

  /**
   * 「相手は手札N枚を破棄しなければ、フラッシュ/スタック効果を発揮できない」。
   *
   * 追加コストではなく、発揮直前・対象選択前の手札破棄 gate。`targetEffectLabels` は
   * 見出しラベル由来の効果カテゴリで、`mode:"flash"` 等の使用窓とは分離して照合する。
   */
  export interface GateFlashStackHandDiscardAction {
    kind: "gate_flash_stack_hand_discard";
    player: PlayerRef;
    count?: CountBound;
    targetEffectLabels?: readonly EffectActivationTiming[];
    sourceActivationZones?: readonly (
      | "hand"
      | "set_aside"
      | "trash"
      | "field"
      | "mirage"
    )[];
    noDuplicate?: boolean;
    duration: Duration;
  }

  /**
   * 「(対象プレイヤー)の手札は、相手によって破棄されない」(手札破棄耐性。BSFT01-C03/C04)。
   *
   * player-scoped CE (`prevent_hand_discard`) を登録。消費側 (executeDiscardHand) が
   * **acting プレイヤーが保護対象の相手のとき**だけ、対象の手札カードを破棄集合から除外する。
   * 自分自身の効果による手札破棄 (コストの自捨て等) は止めない。
   * - `handCountMax`: 保護対象の手札枚数がこの値以下の間だけ有効 (「手札は5枚以下の間」)。
   * - `minSourceCores`: 発揮元カードの通常コアがこの値以上の間だけ有効 (「コアが1個以上のとき」)。
   */
  export interface PreventHandDiscardAction {
    kind: "prevent_hand_discard";
    player: PlayerRef;
    handCountMax?: number;
    minSourceCores?: number;
    duration: Duration;
  }

  /**
   * 「(対象プレイヤー)のデッキは破棄されない」(デッキ破棄耐性。BSTH08.5-C21「お互いのデッキは
   * 破棄されない」)。
   *
   * player-scoped CE (`prevent_deck_discard`) を登録。消費側が真のデッキ破棄
   * (`move_card` の `deckDiscard: true` または discard primitive) を解決するとき、対象デッキの
   * 所有者が保護されていれば当該カードを移動集合から除外する。手札破棄耐性 (prevent_hand_discard)
   * と異なり「相手によって」限定ではなく、原因に関わらず破棄を止める（カード本文「破棄されない」）。
   * `player: "either"` のとき両プレイヤーのデッキを保護する CE を登録する。
   */
  export interface PreventDeckDiscardAction {
    kind: "prevent_deck_discard";
    player: PlayerRef;
    duration: Duration;
  }

  /**
   * 「相手への「デッキ破棄効果」すべてを「デッキ除外効果」にする」(BSTH05.5-X02 Lv2
   * 【導域】『自分のアタックステップ』)。
   *
   * player-scoped CE (`redirect_deck_discard_to_exclude`) を登録。prevent_deck_discard と
   * 同じ真の破棄経路 (`move_card.deckDiscard` または discard primitive) を使うが、対象デッキ所有者への
   * 破棄移動を止める代わりに、移動先をトラッシュから `removed_from_game` へ差し替える
   * (block ではなく redirect)。「自分のアタックステップ」限定は `timingScope` に委譲し、
   * 消費側は追加のステップ判定を持たない (`isCEActiveForScope`/`getCEsForTarget` が
   * 既存の timingScope フィルタを自動適用する)。
   */
  export interface RedirectDeckDiscardToExcludeAction {
    kind: "redirect_deck_discard_to_exclude";
    player: PlayerRef;
    duration: Duration;
  }

  /**
   * 「(対象プレイヤーは)ライフにコアを置けない」(BSTH02.7-C01 effects[2] choice[0])。
   * 「(対象プレイヤーは)相手の効果でボイドからコアを増やせない」(BSSL01-C02 effects[0])。
   *
   * player-scoped CE を登録。`scope` 省略時 (`"to_life"`) は消費側 (`executeCoreMove`) が
   * `to.kind==="life"` の移動先プレイヤーに対して原因(発動者)不問で全面ブロックする。
   * `scope:"from_void_self"` は `from.kind==="void"` かつ移動元プレイヤー===actingPlayerId
   * (対象プレイヤー自身の効果でボイドのコアが減る) のときのみブロックする。
   * `player: "either"` のとき両プレイヤーを保護対象とする CE を1個ずつ登録する
   * (prevent_deck_discard と同型)。
   *
   * `scope:"to_life"` 併用時、`fromZone` で移動元を絞り込める（省略時は移動元不問で
   * 全面ブロック）。「お互い、ボイドからコアをライフに置けない」(BSTH002-C04 effects[0])
   * のような「特定の移動元からライフへの移動だけ」禁止する原因不問の制限を表す。
   * `from_void_self` (自己原因限定・移動元不問) とは直交する軸のため既存 scope 値を
   * 再利用せず fromZone で表現する。
   *
   * `scope:"from_void_self"` 併用時、`sourceTimingScope:"summon"` で「召喚時」効果由来の
   * 増加だけに絞り込める（省略時は自己原因なら timing 不問で全面ブロック）。
   * 「お互い『このスピリットの召喚時』効果でボイドからコアを増やせない」
   * (BSTH03-C31 Lv1-Lv2) は召喚時以外 (フラッシュ等) の自己効果によるボイド減少までは
   * 禁止しないため、`from_void_self` の原因限定 (自分の効果で) と直交する
   * timing 限定軸として追加する。
   */
  export interface RestrictCorePlacementAction {
    kind: "restrict_core_placement";
    player: PlayerRef;
    duration: Duration;
    scope?: "to_life" | "from_void_self";
    fromZone?: "void";
    sourceTimingScope?: "summon";
    /** コア移動を起こす効果の発揮元を絞る。省略時は発揮元の種類を問わない。 */
    sourceFilter?: CardFilter;
  }

  /**
   * 「(対象プレイヤーは)スピリット/アルティメットの効果で合計でN個以上シンボルを
   * 追加できない」(BSTH03-C04 effects[2])。player-scoped CE (`restrict_symbol_addition`)
   * を登録。`player: "either"` で両プレイヤーを制限対象にできる。`sourceFilter` 省略時は
   * 全 symbol_add を対象、指定時はその filter に一致するカードの効果による symbol_add
   * のみをカウント対象にする。実追加数 (対象数 * count) と累積の合計が `maxTotal`
   * を超える symbol_add は全面ブロックする。
   */
  export interface RestrictSymbolAdditionAction {
    kind: "restrict_symbol_addition";
    player: PlayerRef;
    maxTotal: number;
    sourceFilter?: CardFilter;
    duration: Duration;
  }

  /**
   * 「このターンの間、自分はデッキの上からしかドロー/オープンできない」自己制約
   * (BSTH09-C05 effects[1] 後段)。player-scoped CE (`restrict_deck_access_to_top`) を
   * 登録し、`draw` action の `position:"bottom"` 指定を消費側 (native-action-registry.ts
   * の draw ハンドラ) が強制的に "top" へ上書きする。`deck_reveal`/`peek_deck` は現状
   * 常に配列先頭 (top) から解決する固定実装で bottom variant が存在しないため、
   * この CE の対象は draw のみでカード文の「オープン」部分も充足する。
   */
  export interface RestrictDrawToTopAction {
    kind: "restrict_draw_to_top";
    player: PlayerRef;
    duration: Duration;
  }

  /**
   * 「自分の効果で自分のライフが増えるとき、増やす代わりに相手のライフのコア1個を
   * トラッシュに置ける」(BSTH02.7-X03 effects[3])。
   *
   * player-scoped CE (`life_gain_replacement`) を登録。消費側 (`executeCoreMove`) が
   * `to.kind==="life"` かつ移動先プレイヤー===actingPlayerId (自分の効果で自分のライフが
   * 増える) のときにこの CE を照合し、任意で増加を代替アクションに置換できる
   * (`pendingLifeGainReplacementChoice`)。`timingScope` で「自分のアタックステップ中」等の
   * 期間限定を表現する (BSTH02.7-C02 effects[1] 先例と同型)。
   */
  export interface LifeGainReplacementAction {
    kind: "life_gain_replacement";
    player: PlayerRef;
    duration: Duration;
  }

  /**
   * 「[プレイヤー]のライフは増やせない」型の完全禁止 (BSTH002-R02【セット中】
   * 「お互い、ライフは増やせず」)。`life_gain_replacement`（任意選択の代替アクション、
   * かつ actingPlayerId===対象プレイヤーの自己増加のみ照合）と異なり、対象プレイヤーの
   * ライフへの増加を、発揮者が誰であっても（自分の効果でも相手の効果でも）無条件・
   * 強制的に完全ブロックする（コアは移動元に留まる。プレイヤーの選択を挟まない）。
   *
   * player-scoped CE (`life_gain_prevention`) を登録。消費側 (`executeCoreMove` の
   * `to.kind==="life"` 経路、`executeLifeFill`) が移動先プレイヤーに対してこの CE が
   * あれば core_move / life_fill を no-op 化する。
   */
  export interface LifeGainPreventionAction {
    kind: "life_gain_prevention";
    player: PlayerRef;
    duration: Duration;
  }

  /**
   * 「このスピリットの効果で移動する相手のコアすべてはトラッシュに置かれる」
   * (BSKB01-R03【合体中】)。「相手のライフから移動するコアすべてをボイドに置く」
   * (BSTH03-M05 Lv5)。
   *
   * global CE (`core_move_destination_replacement`) を登録する。消費側
   * (`executeCoreMove`) が、実際の移動元プレイヤーが `fromOwner` (登録者から見た
   * self/opponent) に一致し、`fromZone` 指定時はゾーンも一致し、
   * `matchCausingSourceOnly` 指定時はさらに `sourceInstanceId` (=「このスピリットの
   * 効果で」) も一致する core_move を検知すると、`life_gain_replacement` と異なり
   * 任意選択を挟まず、強制的に `to` を `toZone` へ上書きして再実行する。
   */
  export interface CoreMoveDestinationReplacementAction {
    kind: "core_move_destination_replacement";
    /** 移動元の所有者。either は両者。 */
    fromOwner: "self" | "opponent" | "either";
    /** 対象化する移動元ゾーン。省略時はゾーン不問。 */
    fromZone?: "field" | "life" | "reserve" | "trash" | "void";
    /** true のとき、この CE の発揮元と同じ合体スピリットの効果だけを対象にする。 */
    matchCausingSourceOnly?: boolean;
    /** 変更先ゾーン。optional 未指定時は強制。 */
    toZone: "trash" | "void";
    /** この移動先だけを変更する。省略時は元の移動先を問わない。 */
    matchToZone?: "reserve" | "trash" | "void" | "life";
    /** 各効果の解決時に既存の step choice で移動先を選ぶ。 */
    optional?: boolean;
    duration: Duration;
  }

  /**
   * `restrict_use` が制限し得るカード使用手段の種別 (legal-action 生成の分岐に対応)。
   * `isCardUseRestricted` の呼び出し元ごとに 1 つを渡す。
   */
  export type CardUseKind =
    | "summon"
    | "place_nexus"
    | "magic"
    | "accel"
    | "change"
    | "advent"
    | "put_on_field"
    | "set_mirage";

  export interface RestrictUseAction {
    kind: "restrict_use";
    player: PlayerRef;
    filter: CardFilter;
    duration: Duration;
    /**
     * 省略時は従来通り「相手は、〜を使えない」型の player-scoped 制限。
     * "card" は「相手のトラッシュにあるカードは、その効果を使えない」等、
     * 人称読点を持たないカード/ゾーン対象の使用制限に使う。
     */
    targetScope?: "player" | "card";
    /**
     * 制限する使用種別を限定する（省略時 = 全種別を制限、既存挙動と後方互換）。
     * 「このカードは効果以外で召喚できない」(BSTH08.5-X04 effects[0]) のように、
     * summon だけを禁止し、このカード自身のアクセル等の他の使用手段は許可したい場合に
     * `["summon"]` を指定する。
     */
    restrictedKinds?: CardUseKind[];
    /** 「効果以外で」使えない制限。効果による使用には適用しない。 */
    onlyNormalUse?: boolean;
  }

  export interface RestrictManifestAction {
    kind: "restrict_manifest";
    player: PlayerRef;
    filter: CardFilter;
    effectFilter?: EffectTargetFilter;
    duration: Duration;
  }

  /**
   * 「[player] は、[filter] を [restrictedKinds] するとき、軽減シンボルによる
   * コスト軽減ができない」型の継続禁止 (BSTH07.8-C03 Lv2「相手はネクサスを配置する
   * とき、軽減できない」)。`restrict_use`（使用そのものを禁止）とは異なり、使用は
   * 許可したままコスト軽減マッチング（calculateReduction の symbol matching /
   * waiver）だけを無効化する。additionalCost / costFloor / baseCostOverride など
   * 軽減以外のコスト計算要素には影響しない。
   */
  export interface PreventCostReductionAction {
    kind: "prevent_cost_reduction";
    player: PlayerRef;
    filter: CardFilter;
    duration: Duration;
    /** 軽減無効化の対象を限定する使用種別 (省略時 = 全種別)。*/
    restrictedKinds?: CardUseKind[];
  }

  /**
   * 「[player] の軽減シンボル供給源のうち [sourceFilter] を満たすカードは、
   * [maxSymbols] 個までしか軽減シンボルを満たせない」型の継続コスト軽減上限
   * (BSTH07-転醒R01(A) Lv2「創界神ネクサス/導界者ネクサスでは、1つしか軽減
   * シンボルを満たせない」)。`prevent_cost_reduction`（支払対象カードを filter
   * で全面ブロック）とは軸が異なる: これは軽減**供給元**（`calculateReduction`
   * の `fieldSymbolSources` の各カード）単位で使用可能マッチ数を上限する。
   * `sourceFilter` は支払対象カードではなく、フィールド上の供給源カード定義
   * (`matchesCardFilterByDef`) に対して評価する。
   */
  export interface LimitCostReductionAction {
    kind: "limit_cost_reduction";
    player: PlayerRef;
    /** 上限対象の軽減供給源カードを絞るフィルタ（供給源カード定義に対して評価）。 */
    sourceFilter: CardFilter;
    /** 供給源 1 件あたりの軽減シンボル上限使用数。 */
    maxSymbols: number;
    duration: Duration;
    /** 軽減制限の対象を限定する使用種別 (省略時 = 全種別)。 */
    restrictedKinds?: CardUseKind[];
  }

  /**
   * 「[zone] にあり [filter] を満たすカードは、[player] の軽減シンボル供給源として
   * フィールドにあるものとしても扱う」型の継続効果 (BSTH08.5-C20「能面・女（平静）」
   * 「手元にある系統：「面霊」を持つブレイヴカードすべてのシンボルは、フィールドに
   * あるものとしても扱う」)。`calculateReduction` の `fieldSymbolSources` は通常
   * zone:"field" のカードのみ列挙するが、このアクションで登録された CE が成立する間、
   * 該当 zone + filter に一致するカードも供給源へ追加する。
   */
  export interface ExtendFieldSymbolSourceAction {
    kind: "extend_field_symbol_source";
    player: PlayerRef;
    /**
     * 軽減シンボル供給源の拡張を受けるカードの範囲。省略時は `player` 全体。
     * `source_card` は「このカードの召喚コストは〜でも軽減できる」型で、
     * この effect の発生源カードだけに拡張を適用する。
     */
    targetScope?: "player" | "source_card";
    /** 追加供給源として扱うカードが存在するゾーン。 */
    zone: Zone;
    /** 追加供給源カードを絞るフィルタ（共通の実効カード参照で評価）。 */
    filter: CardFilter;
    duration: Duration;
  }

  /**
   * 「待機状態を含まない自分の同名スピリットはフィールドに1体しか存在できない」
   * フィールド唯一性制限（BSSG01 戦姫絶唱シンフォギア等）。
   *
   * 発揮元（自分）のフィールドに、`names`（カード名）または `filter`（系統 AND 等）で
   * 指定したスピリットが、離脱 pending（待機状態）でない形で `maxCount`（省略時 1）を
   * 超えて並ぶことを禁止する。召喚 legal-action 生成時に `isBlockedByFieldNameUniqueness`
   * で消費され、既に静的な該当スピリットが上限数フィールドにいる場合は新規召喚を提示しない。
   * 待機状態の既存個体はカウントから除外される（場唯一性バイパス。
   * `10_rules/04_state-based-rules.md`「待機状態中の場唯一性バイパス」）。
   */
  export interface FieldNameUniquenessAction {
    kind: "field_name_uniqueness";
    /**
     * 制限対象のカード名。`"self"` = 発揮元自身のカード名（「同名」テキスト）。
     * 配列 = 明示的に列挙された複数名（例: BSSG01-X03「暁 切歌」/「月読 調」をそれぞれ）。
     * `filter` を使う場合は省略可。
     */
    names?: "self" | string[];
    /**
     * 名前でなく系統等のフィルタで制限対象を判定する（系統 AND: `tribesRequired`）。
     * 例 BSFT01 星霊衣:「系統:『光導』と『星霊』を持つ自分のスピリット」=
     * `{ tribesRequired: ["光導", "星霊"], category: ["spirit"] }`。
     */
    filter?: CardFilter;
    /** フィールド共存上限。省略時 = 1。 */
    maxCount?: number;
    /**
     * この条件（ConditionClause 配列・AND）を満たすとき上限を `boostedMaxCount` に
     * 引き上げる。例「自分のカウント4以上のとき2体まで」=
     * `boostCondition: [{ kind: "count_value", player: "self", min: 4 }], boostedMaxCount: 2`。
     */
    boostCondition?: import("./model").ConditionClause[];
    boostedMaxCount?: number;
    duration: Duration;
  }

  /**
   * 「自分の効果で『X』を数えるとき、1体につきN体として数える」継続効果。
   *
   * player-scoped CE として登録し、`field_has.cardNames` の件数評価でのみ消費する。
   * 無印の category / tribe 件数までは倍率化しない。
   */
  export interface CountAsMultipleAction {
    kind: "count_as_multiple";
    player: PlayerRef;
    filter: CardFilter;
    multiplier: number;
    /** 「数えられる」: 通常の1体として数える選択も残す。 */
    optionalCount?: boolean;
    duration: Duration;
  }

  export interface EndAttackStepAction {
    kind: "end_attack_step";
    /**
     * 「相手の『アタックステップを終了できない』効果を受けない」(R12)。
     * true のとき `restrict_end_attack_step` 妨害を受けず終了を実行する (効果耐性/防御)。
     */
    unaffectedByRestriction?: boolean;
  }

  /** ターンを終了する。エンドステップ自体は行わない。 */
  export interface EndTurnAction {
    kind: "end_turn";
    /** true のとき `restrict_end_turn` 妨害を受けず終了を実行する。 */
    unaffectedByRestriction?: boolean;
  }

  /** 現在のバトルだけを終了する。アタックステップ全体は終了しない。 */
  export interface EndBattleAction {
    kind: "end_battle";
    /** true のとき `restrict_end_battle` 妨害を受けず終了を実行する。 */
    unaffectedByRestriction?: boolean;
  }

  export interface RestrictEndActionBase {
    player: PlayerRef;
    duration: Duration;
    /**
     * 登録時に条件を満たすなら、この終了制限 CE は「相手の効果では防げない」。
     * 同一 effect 内の前段 count 増加後に判定する必要がある効果用。
     */
    unpreventableIf?: import("./model").ConditionClause[];
  }

  /** 「相手は効果でアタックステップを終了できない」継続効果。 */
  export interface RestrictEndAttackStepAction extends RestrictEndActionBase {
    kind: "restrict_end_attack_step";
  }

  /** 「相手は効果でバトルを終了できない」継続効果。 */
  export interface RestrictEndBattleAction extends RestrictEndActionBase {
    kind: "restrict_end_battle";
  }

  /** 「相手は効果でステップを終了できない」継続効果。 */
  export interface RestrictEndStepAction extends RestrictEndActionBase {
    kind: "restrict_end_step";
  }

  /** 「相手は効果でターンを終了できない」継続効果。 */
  export interface RestrictEndTurnAction extends RestrictEndActionBase {
    kind: "restrict_end_turn";
  }

  /**
   * engine-single-battle-end: 「ただちにバトルを終了する」。
   * `end_attack_step` (アタックステップ全体を終了) とは別挙動 —
   * 進行中の 1 バトル (= 現在の activeAttack 単位。simultaneous 複数アタッカーも
   * 同じバトルとして一括終了) だけを BP 比較 / ライフダメージ無しで即終了させ、
   * battle_end 誘発 (card_event/game_event) 以降だけを実行する。
   * before_block/after_block flash ウィンドウ中 (BP 比較未着手・battleResolutionGroup
   * 未生成) のステップとして発火する想定。activeAttack が無い、または既にバトル解決が
   * 開始済み (battleResolutionGroup 存在) のときは no-op。
   */
  export interface EndSingleBattleAction {
    kind: "end_single_battle";
    /** true のとき `restrict_end_battle` 妨害を受けず終了を実行する。 */
    unaffectedByRestriction?: boolean;
  }

  /** アタック時効果の中で、進行中のアタック先を相手のスピリット等に指定する。 */
  export interface DesignateAttackAction {
    kind: "designate_attack";
    target: TargetSpec;
  }

  export interface AdditionalAttackAction {
    kind: "additional_attack";
  }

  /**
   * ENGINE-battle-connect-repeat (10_rules/05c_connect-battle.md): 「◯回まで連続でバトルできる」型
   * grant (BSTH06-X03【三歩必殺】)。`timing:{kind:"card_event",event:"attack"}` で発火し、
   * `state.activeAttack.connectBattleGrant` に `{sourceInstanceId, remainingUses: maxUses}` を設定する。
   * 実際の続行/終了選択は battle-actions.ts のバトル解決終盤 (battle_end 誘発の直前) が行う。
   */
  export interface ConnectBattleAction {
    kind: "connect_battle";
    /**
     * 「続けてバトルを行える」**継続**回数 (総バトル回数ではない)。三歩必殺の原文
     * 「3回まで連続でバトルできる（バトル終了前に**2回まで**…続けてバトルを行える）」は
     * 初回バトル+継続2回=合計3回を表すため、ここには 2 を渡す (adversarial verifier
     * 2026-08-02 round1 lens1 指摘: maxUses:3 は総バトル回数4回になるoff-by-oneだった)。
     */
    maxUses: number;
  }

  /**
   * P3-63: 追加ターン取得。BSTH02-M01「自分のターンを行う」等。
   *
   * - `player`: 追加ターンを取得するプレイヤー (省略時 "self")。
   * - `skipSteps`: 追加ターン中にスキップするステップ (BSTH02-M01 は core/attack)。
   * - `returnPoint`: 追加ターン終了後の復帰先。
   *   - 省略時: 現ターン終了後に追加ターンを行い、その後は本来の次プレイヤーへ進む。
   *   - `"previous_attack_battle"`: 中断中の相手アタックステップのバトル中に戻る
   *     (BSTH02-M01「相手のアタックステップのバトル中に戻る」)。
   */
  export interface GrantExtraTurnAction {
    kind: "grant_extra_turn";
    player?: PlayerRef;
    skipSteps?: import("./model").Step[];
    returnPoint?: "previous_attack_battle";
  }

  /**
   * ENGINE-opponent-turn-skip (BSAZ01-C03「相手は次のターンを行えない」): `grant_extra_turn`
   * の逆軸 — 対象プレイヤーの直近の「ターン開始」を1回だけ剥奪する。
   *
   * `grant_extra_turn` が追加のターンを予約するのに対し、
   * 本 action は現在のターンには一切介入せず `GameState.pendingTurnSkips` へ対象 playerId を
   * 積むだけ。end→start 遷移 (turn-system.ts advanceFromEndStep) が次に計算した
   * `nextPlayerId` がこの配列に含まれていれば、そのプレイヤーの番を1回丸ごと飛ばして
   * さらに次のプレイヤーへ進める (2人対戦なら自分の連続ターンになる)。何ターン先の
   * 境界で消費されても良い設計のため、`grant_extra_turn` を挟む/2重に呼ぶ必要が無い。
   */
  export interface SkipNextTurnAction {
    kind: "skip_next_turn";
    /** ターンを飛ばされるプレイヤー (省略時 "opponent")。 */
    player?: PlayerRef;
  }

  /**
   * ENGINE-extra-turn-step-insertion: 現在のターンを離れずに指定したステップだけを
   * STEP_ORDER の通常サイクルへ強制挿入する (BSLH01-X01【導技：7】「このステップ終了後、
   * 自分は、リフレッシュステップとアタックステップを1回ずつ行える」等)。
   * `grant_extra_turn`（別ターンの追加取得）とは別軸で、
   * 中間ステップ（メイン等）を挟まず `steps` に列挙した順序のみを辿る。
   * `GameState.pendingExtraSteps` へ追記され、`advanceStep` が1つずつ消費する。
   */
  export interface GrantExtraStepsAction {
    kind: "grant_extra_steps";
    steps: import("./model").Step[];
  }

  // ════ 特殊 (6種) ════

  export interface EffectImmunityAction {
    kind: "effect_immunity";
    target: TargetSpec;
    duration: Duration;
    /**
     * 発生源スコープ限定の「相手の効果を受けない」。指定すると、対象は
     * **発生源カードが scope に一致する相手の効果のみ**を受けなくなる
     * （「相手のスピリットの効果を受けない」= category:["spirit"] / 「相手の赤の効果を
     * 受けない」= colors:["red"] / 「コスト5以下の相手の効果を受けない」= maxCost:5）。
     * 省略時は発生源を問わない blanket 免疫（従来挙動）。複数条件は AND。
     * 03c §効果の発生源帰属（カード対象耐性は発生源カードのカテゴリ/色/コストで絞れる）。
     */
    sourceScope?: {
      categories?: CardCategory[];
      colors?: CardColor[];
      maxCost?: number;
      /**
       * 発生源効果の発動タイミング (main/flash/stack) 軸。categories/colors/maxCost とは
       * OR 結合（いずれかを満たせば免疫成立）。「相手の…の効果を受けない」+「スタックの
       * 効果を受けない」のようなカテゴリ非依存の発動タイミング限定を表現する
       * (BSTH02.7-C02、ENGINE-immunity-source-activation-timing)。
       */
      activatedTimings?: EffectActivationTiming[];
      /**
       * true のとき、発生源カードが合体状態であれば scope 対象から除外する
       * （model.ts `ContinuousEffect.immunitySourceScope.excludeCombined` と同義）。
       * 「合体スピリット/マジック以外の効果を受けない」(BSAZ02-C04) 型を表現する。
       */
      excludeCombined?: boolean;
      /** 指定時は、このカテゴリの合体ユニットだけを除外する。 */
      excludeCombinedCategories?: import("./model").CardCategory[];
      /**
       * true のとき、発生源カードが創界神/導界者ネクサスであれば scope 対象から除外する
       * （model.ts `ContinuousEffect.immunitySourceScope.excludeGrandwalkerOrGuided` と同義）。
       * 機構由来の効果だけを除外する場合は `excludedAspects` を使う。
       */
      excludeGrandwalkerOrGuided?: boolean;
      /**
       * 発生源カードの実効系統 (`getEffectiveTribes`) がこの一覧のいずれかに一致すれば
       * scope 対象から除外する（model.ts `ContinuousEffect.immunitySourceScope.excludeTribes`
       * と同義）。excludeCombined/excludeGrandwalkerOrGuided と同型の「特定種別除外」軸。
       * 「系統：「CB」/「導力器」を持たない自分の効果を受けない」(BSLH01アーツ T07-T17) の
       * ような「特定系統以外の効果を受けない」型を表現する（sourcePlayerScope:"self" と併用）。
       */
      excludeTribes?: string[];
      /**
       * true のとき、発生源カードがこの免疫を登録したカード自身なら scope 対象から除外する。
       * 「このカード以外の効果を受けない」型で、自分自身の回収/移動効果だけは通すための
       * 汎用 source-scope 軸。
       */
      excludeSelf?: boolean;
      /**
       * 発生源カードが印字バースト系ヘッダを持つか。
       * 「相手のバースト効果を持つスピリット/アルティメットの効果を受けない」
       * (BSTH02-R03) のような原文はこちらを使い、keywordTags:["burst"] では判定しない。
       */
      hasBurstEffect?: boolean;
      /**
       * 発生源カードが持つキーワード (`CardDefinition.keywordTags`) による絞り込み。
       * categories/colors/maxCost と AND 結合（model.ts
       * `ContinuousEffect.immunitySourceScope.keywords` と同義）。
       */
      keywords?: string[];
      /**
       * true のとき、colors の代わり(併用時は OR で追加)に「この免疫を持つカードの
       * 相手フィールドに現在あるカードの実効シンボル色すべて」を動的な色集合として使う
       * （model.ts `ContinuousEffect.immunitySourceScope.colorsFromOpponentFieldSymbols`
       * と同義）。「相手のフィールドにあるシンボルの色の効果を受けない」(BSTH05.5-M01) 型。
       */
      colorsFromOpponentFieldSymbols?: boolean;
      /**
       * 指定時、この免疫は「対象が受ける効果のうち、書き込み先アスペクトがこの一覧に
       * 含まれるもの」だけを対象にする（他の scope 軸が発生源カードの属性で絞るのに対し、
       * これは発揮される効果自身が何を書き換えるかで絞る直交した軸）。省略時は従来どおり
       * aspect を問わない blanket 免疫。model.ts `ContinuousEffect.immunitySourceScope.
       * restrictedAspects` と同義（executeEffectImmunity がそのまま転写する）。
       * 「対象のシンボルはこの効果以外の効果を受けない」(BSTH11-R02) 型を表現する。
       * ENGINE-symbol-lock-self-effect-immunity。
       */
      restrictedAspects?: string[];
      /**
       * 指定時、この一覧に一致する効果アスペクトは免疫の対象外にする。
       * `restrictedAspects` と対になる負の軸で、【神託】/【導託】のような
       * 機構由来効果を通常のカード効果から区別する。
       */
      excludedAspects?: string[];
    };
    /**
     * 免疫対象となる効果の発揮プレイヤー範囲。
     * - 省略時 / "opponent": 従来どおり「相手の効果を受けない」。
     * - "self": 「自分の効果を受けない」型。
     * - "any": 「一切の効果を受けない」型。自分起因のカード対象効果も止める。
     *   system/SBA 起因はカード効果ではないため対象外。
     */
    sourcePlayerScope?: "opponent" | "self" | "any";
    /**
     * qa-020 (BSTH01-XX02「このスピリットは、相手の効果を受けず、相手の効果を受ける
     * とき、相手の効果が指定する効果/条件で防いだものとする。」)。true のとき、この
     * 耐性は防止元の実 identity（色/カテゴリ/系統/キーワード、または「相手の効果では
     * 防げない」のような player-relation のみの restriction）を照合せず、防げる条件が
     * 1 つでも存在する限り無条件にそれを満たす（＝ bypass されない）wildcard として
     * 振る舞う。真の blanket（お互い/一切、条件が一切存在しない、
     * `TargetLockBypassProfile.kind:"all_effects"|"blanket_affect_immunity"`）だけが
     * bypass する（`canSourceBypassResistanceCE` 参照）。防止ラダー
     * （「防げない」＞「受けない」＞「発揮できない」）自体は変更しない、この耐性
     * 自身の bypass 判定だけを変える限定 marker。P3-141。
     */
    satisfiesPreventionRestriction?: true;
  }

  /**
   * 置換効果の置換先。`replacement` を指定すると「破壊されるとき、代わりに〇〇する」を表現する。
   * - move_to hand: 手札に戻す
   * - move_to deck_bottom: デッキの下に戻す
   * - pay_cost: 離脱の代わりに `amount` コスト支払う (ゾーン移動を伴わない残留型置換)。
   * - advent_source: 離脱するカードを `target` (CardFilter) で指定したスピリットの
   *   煌臨元に追加する。08a_advent-rebirth-contract.md L36「フィールド離脱時、煌臨元も全て
   *   同じ場所に移動」と対をなす逆操作 (= 離脱を煌臨元への移動に置換)。
   *   `orTrash:true` 時はコントローラーが「煌臨元に追加」と「トラッシュに置く」を選択する
   *   (BSSL01「自分の『水篠 旬』の煌臨元に追加するか、トラッシュに置く」)。
   *   対象スピリットが不在のときは置換不可 → 通常通りトラッシュへ。
   *
   * 「疲労状態でフィールドに残る」のような *triggered* な残置効果は本型では
   * 表現しない。`Timing.card_event` + `stay_on_field` を使うこと
   * （pending leave に入った *後* に発火する triggered effect として実装する）。
   */
  export type FieldExitReplacement =
    | {
        kind: "move_to";
        zone: "hand" | "deck_bottom";
      }
    | {
        /**
         * pay_cost: 離脱の代わりに N コスト支払うことができる (BSTH08.5-X04「自分が
         * このカードを除外するとき、かわりに1コスト支払うことができる」)。対象カードは
         * 元のゾーンに残る (move_to と異なりゾーン移動を伴わない)。支払いはリザーブから
         * 自動(通常コア優先、不足分はソウルコア) —
         * `resolveSetAsideExitReplacementChoice` (state-based-actions.ts) が
         * `PayCostAction` の fallback ソース未指定経路と同じロジックを再利用する
         * (効果ステップ実行文脈を経由しない選択解決のため、`pay_cost` action 自体は使わない)。
         */
        kind: "pay_cost";
        amount: number;
      }
    | {
        kind: "advent_source";
        /** 煌臨元の追加先スピリットを指定するフィルタ (例: cardName「水篠 旬」)。 */
        target: CardFilter;
        /** true: コントローラーが「煌臨元に追加」/「トラッシュ」を選択。false: 強制で煌臨元へ。 */
        orTrash: boolean;
      }
    | {
        /**
         * soul_state: 離脱するカードを魂状態にする。08a_advent-rebirth-contract.md L158-159
         * 「相手によってフィールドを離れるとき、魂状態で残す選択可」「魂状態化時、上のコアは全て
         * リザーブへ移動」と対をなす。契約カードはルールで自動付与されるが、本置換は
         * 「相手によってフィールドを離れたこのスピリットは魂状態にできる」と明示するカード
         * (例: BSGE01-R01..R05) に CE として付与する。コントローラーが accept/decline を選択する。
         */
        kind: "soul_state";
      };

  /**
   * 効果耐性 / 置換効果。
   *
   * - `replacement` 省略時: 純粋な耐性（`cannot_be_destroyed` 等）として動作する。
   * - `replacement` 指定時: 真の置換効果として動作し、本来の離脱イベントを `replacement` の結果に置き換える。
   *
   * **適用範囲**: 「フィールドを離れるとき、副作用 X を発揮する」のような *単なるタイミングトリガー* は
   * 本アクションでは表現しない。それらは離脱が通常通り発生するため、`timing: { kind: "card_event",
   * event: "leave_field" | "destroy" | "bounce" | "vanish" }` を使った通常の DSL 効果として記述する。
   * 本アクションは「離脱を別の結果で置き換える」場合 (= 真の置換) のみに使用すること。
   */
  export interface EffectResistanceAction {
    kind: "effect_resistance";
    target: TargetSpec;
    resistsOutcome: ResistableOutcome | ResistableOutcome[];
    /** targeted/included の対象取得制限を適用する効果発揮元の属性。 */
    targetLockSourceFilter?: import("./effect/target-affect-gate").EffectSourceFilter;
    /**
     * "self": 「自分が〇〇するとき」型。battle/bp_compare を除く、離脱原因の
     * causePlayerId が対象カードの controllerPlayerId と一致する場合のみ発動する。
     * field 離脱経路 (`checkFieldExitReplacement` 等、PendingLeaveEntity 前提) は
     * `isPendingLeaveCausedBySelfEffect` が判定する。`isPendingLeaveCausedByOpponentEffect`
     * の対称形 (ENGINE-set-aside-exit-replacement-choice Step1)。
     * 非フィールド (set_aside) 除外経路は PendingLeaveEntity を経由しないため、
     * `structured-card-replacement.ts` の `executeRemoveFromGame` が
     * `card.controllerPlayerId === actingPlayerId` を個別に判定する
     * (`findSelfSetAsideExitReplacementMatch`)。BSTH08.5-M11 (手札へ戻す, move_to) が正源。
     * X04 (「1コスト支払うことができる」= コスト支払い型置換) は `replacement.kind:"pay_cost"`
     * で表現する (ENGINE-set-aside-exit-replacement-choice Step2)。
     */
    source: "opponent_effect" | "opponent" | "all" | "self";
    duration: Duration;
    /** resistsOutcome に "core_below_min" を含む場合の最小残存コア数。 */
    coreMinimum?: number;
    /**
     * resistsOutcome に "enter_zone" を含む場合、阻止する移動先ゾーン。必須
     * (BSTH08.5-X04「このカードの効果以外で手元に置けない」= entryZone:"set_aside")。
     */
    entryZone?: Zone;
    /**
     * resistsOutcome に "core_below_min" を含む場合の動的下限。固定値 `coreMinimum` の
     * 代わりに、判定対象カード自身の `levelDefs` から指定 `level` の `requiredCores` を
     * 都度参照する（例:「コアがLv3コストより少なくならない」「コアはLv1コストより
     * 少なくならない」= 各対象カード自身の該当 level 必要コア数）。`coreMinimum` と
     * 併用時は `coreMinimum` を優先する。
     */
    coreMinimumSource?: { kind: "own_level_required_cores"; level: number };
    /**
     * 特定の離脱原因では耐性を適用しない。
     * 例: 「バトル以外でフィールドを離れない」= resistsOutcome:"leave_field" +
     * excludedCauses:["battle"]。
     */
    excludedCauses?: ("effect" | "battle" | "bp_compare")[];
    /** 置換効果: 指定時は破壊を防ぎつつ代替アクションを適用する */
    replacement?: FieldExitReplacement;
    /**
     * ルール強度耐性。指定時は本耐性 CE を「ルール由来の不可」として扱い、
     * `sourcePreventionLevel: "unpreventable"` (「防げない」) の相手効果でも貫通させない
     * (10_rules/07b §71 スピリット状態ブレイヴ class: ルールで疲労不可・攻防不可)。
     * 既定 (false / 省略時) は従来の効果強度耐性で、`unpreventable` には貫通される。
     * 現状 consumer: `isExhaustBlockedByResistance`。他 outcome の rule-strength 用途は
     * 必要になった時点で各 consumer (`isLeaveOutcomeBlockedByResistance` 等) に展開する。
     */
    ruleStrength?: boolean;
  }

  /**
   * 「host が効果を発揮するとき、対価を支払うことでその効果は相手の効果で防げなくなる」
   * 権利付与 CE の登録 (ENGINE-bsge01-r04-paid-prevention-immunity, BSGE01-R02/R04
   * 【呪縛：モルター】等バレットエディット下の text_role_under 継続効果)。
   *
   * 本アクションは「権利を CE として登録する」だけで、実際に対価を支払って
   * unpreventable 化するかどうかの選択・支払い処理は
   * `resolve_pending_triggered_effect` 系の legal-actions 層 (declare 時点、
   * steps 実行より前) が `getPaidPreventionImmunityCost` を参照して行う。
   * これにより executeEffect / resolveEffectSourcePreventionLevel の中核ロジックは
   * 変更不要 (options.sourcePreventionLevel の既存 override 経路をそのまま使う)。
   */
  export interface GrantPaidPreventionImmunityAction {
    kind: "grant_paid_prevention_immunity";
    /** 権利を持つ host。text_role_under (バレットエディット等) 下では
     * `{ kind: "self" }` が host 自身に解決される (continuous-effect-rebuild.ts の
     * textRoleUnderEffectEntries が sourceCard=hostCard で実行するため)。 */
    target: TargetSpec;
    /**
     * 発揮ごとに支払う対価。
     * - `resource: "count"`: 自分のカウントを `amount` 消費 (ENGINE-bsge01-r04 landed 分、
     *   consumer 配線済み)。
     * - `resource: "card"`: 指定 `zone` の `filter` に一致するカードを `amount` 枚、除外
     *   ({@link ../model#Zone} `removed_from_game`) する (ENGINE-paid-prevention-immunity-
     *   card-cost-variant 型のみ拡張。BSKB01-X01 系鋼騎士除外型を想定。
     *   Step1 時点では `getPaidPreventionImmunityCost` のパススルーのみで、
     *   affordability 判定 (legal-actions-availability.ts) / 支払い実行
     *   (legal-actions-apply.ts、どのカードを除外するかの player 選択含む) は未配線)。
     */
    cost:
      | { resource: "count"; amount: number }
      | { resource: "card"; amount: number; zone: Zone; filter?: CardFilter };
    duration: Duration;
    /**
     * ENGINE-paid-prevention-immunity-card-cost Step4: 権利を単一 effect にスコープする。
     * 省略時 (BSGE01-R04 型「このスピリットが効果を発揮するとき」) は host のカード全体
     * (host が発揮するどの効果でも offer する)。指定時は `sourceDefinition.effects`
     * 配列中 `effectIndex` の効果が発揮されるときのみ offer する
     * (BSKB01-X01「この効果は相手の効果では防げない」= 直前の特定アビリティ1つのみ型。
     * getPaidPreventionImmunityCost 呼び出し側が誘発効果の
     * `RegisteredTriggeredEffectAction.effectIndex` と突き合わせる)。
     */
    scope?: { effectIndex: number };
  }

  /**
   * 「host が効果を発揮するとき、対価を支払うことで、それによってフィールドを
   * 離れるカードの効果は発揮されない」権利付与 CE の登録
   * (engine-generic-effect-activation-causal-trigger cluster, BSGE01-R02
   * 【毒牙：モルター】等バレットエディット下の text_role_under 継続効果)。
   *
   * grant_paid_prevention_immunity と同じ「権利を CE として登録するだけ」の設計。
   * 実際の対価支払い判定・適用 (declare 時点の payment + 解決完了後の
   * suppress_pending_leave_effects 相当の抑制) は legal-actions 層 +
   * finalizeEffectResolution が `getPaidLeaveSuppressionImmunityCost` を
   * 参照して行う (Step5 以降で配線予定、本 Step は CE 登録 primitive のみ)。
   */
  export interface GrantPaidLeaveSuppressionImmunityAction {
    kind: "grant_paid_leave_suppression_immunity";
    /** 権利を持つ host。text_role_under 下では `{ kind: "self" }` が host 自身に
     * 解決される (grant_paid_prevention_immunity と同じ解決経路)。 */
    target: TargetSpec;
    /** 発揮ごとに支払う対価。現状 resource は "count" のみ対応。 */
    cost: { resource: "count"; amount: number };
    duration: Duration;
  }

  export interface NegateAction {
    kind: "negate";
    /** この効果の解決で直接誘発した反応だけを抑止する。後の無関係な効果へ持ち越さない。 */
    causedByThisEffect?: boolean;
    // "opponent_burst": 相手のバースト効果を無効にする (P3-77 Step C, BSTH09.2-転醒R03)。
    // 継続効果として登録し、バースト解決時に effectSuppressed 経路で発揮を止める。
    negateTarget: "summon" | "place" | "use" | "effect" | "opponent_burst";
    targetFilter?: CardFilter;
    /** 対象 pending stack のコントローラ。例: 「相手の効果」なら "opponent"。 */
    targetController?: "opponent";
    /** use 用: 無効にするマジック効果の timing。例: 「フラッシュ効果の使用」なら "flash"。 */
    targetEffectTiming?: "main" | "flash" | "stack";
    /** effect 用: 無効にする効果種別（例: 召喚時 / アタック時）を絞り込む。 */
    targetEffectFilter?: EffectTargetFilter;
    /**
     * negateTarget === "effect" で、無効化した発生源の同一効果を継続的に
     * suppress する場合に true。未指定時は直下 pending stack の単発 nullify のみ。
     */
    suppressMatchedEffect?: boolean;
    /**
     * negateTarget === "opponent_burst" 専用の抑制種別。
     * - "nullify" (既定): 「バースト効果を無効にする」。発動はするが効果が発揮されない。
     * - "cannot_activate": 「バースト効果を発揮できない」。発揮自体を阻害する。
     * 防止ラダー [03b:25] 上、両者とも「発揮できない/無効」であり「防げない」ではない。
     * Effect.ignoresOpponentCannotActivateBurst を持つバーストは "cannot_activate" のみを無視する。
     */
    burstSuppressKind?: "nullify" | "cannot_activate";
    /**
     * 登録する CE の duration（省略時「このターンの間」= `{ scope: "turn" }`）。
     * 常駐無効化（`timing: "continuous"`）は `{ scope: "while_on_field" }` を指定し、
     * 発動可否は effect.condition（recompute add/remove）+ effect.timingScope
     * （消費時 isCEActiveForScope）で動的に決まる。BSTH09.2-転醒R03(B) 参照。
     */
    duration?: Duration;
  }

  export interface SuppressEffectAction {
    kind: "suppress_effect";
    target: TargetSpec;
    /**
     * 抑止 CE が対象カードに作用するための追加ゲート。
     * - blocked_by_source_immunity: 対象カードがこの suppress 発生源効果を通常なら
     *   `effect_immunity` で受けない場合だけ抑止する。「このスピリットの効果を
     *   受けない相手のスピリットすべての効果は発揮されない」型。
     */
    targetAffectGate?: "blocked_by_source_immunity";
    /**
     * 抑止する効果を絞り込むフィルタ。
     * - 指定あり: 対象カードのうち `effectFilter` に一致する効果のみ「発揮させない」。
     * - 省略 (blanket): 対象カードの**すべての効果**を「発揮させない」
     *   (「(対象)の効果をすべて発揮させない」/「その効果を発揮させない」)。
     * これは「発揮させない」(発揮の抑止) であり、「効果を受けない」(immunity) や
     * 「無効」(negate) ではない。対象カード自身の効果が発揮されるのを止めるだけで、
     * 使用宣言・コスト支払い・後処理は止めない ([10_rules/01:22], [10_rules/03b:140])。
     * なお発揮場所・発揮条件のない常時効果は「発揮できない」では止まらない
     * ([10_rules/03b:112-114]) が、その細則は別 increment。
     */
    effectFilter?: EffectTargetFilter;
    duration?: Duration;
    scope?: "entire" | "modifier_only";
    modifierTarget?: EffectModifierTarget;
  }

  export interface RedirectTargetAction {
    kind: "redirect_target";
    from: TargetSpec;
    to: TargetSpec;
    /**
     * 対象集合の置換範囲。
     * - "matching" (既定): from に一致する現在対象だけを to へ置換する。
     * - "all_current_effect_targets": P3-76 型「その対象をこのスピリットのみにする」。
     *   targeted disclosure continuation で中断中の元効果対象集合を、to の集合だけに差し替える。
     */
    mode?: "matching" | "all_current_effect_targets";
  }

  /**
   * ENGINE-attack-declaration-replacement-primitive: 相手のアタック宣言 (宣言前スタック窓、
   * `preDeclarationStackWindow.kind==="attack"`、未確定) の最中に、こちらが指定した相手の
   * 別カードへアタッカー自体を差し替える（元の宣言は取り消され、なかったものになる）。
   * 同時に、差し替え後の新アタックを自分の指定カードへ forced_block させる。
   * BSRK01-C05『飛天御剣流「龍咬閃」』専用。
   *
   * `target` (新アタッカー) は既存の対象選択パイプライン (interactive) を経由する
   * (`getActionTargetSpec` 登録)。`forcedBlocker` は redirect_target の `to` と同様、
   * handler 内で `resolveTargetSpec` により直接解決する (非対話・先頭マッチ)。
   *
   * 「可能なら」: `target` に合法な新アタッカー候補が存在しない場合、この action は no-op
   * となり元のアタック宣言はそのまま進行する（`forcedBlocker` の予約も行わない）。
   */
  export interface ReplaceAttackDeclarationAction {
    kind: "replace_attack_declaration";
    target: TargetSpec;
    forcedBlocker: TargetSpec;
  }

  export type RebirthCountBonusMode = "increment_1" | "reset_to_zero" | "none";

  export type RebirthPostChoice =
    | {
        /**
         * 「このとき、この転醒後ブレイヴを自分のスピリットに合体できる」。
         * optional=true なら合体しない選択も合法。
         */
        kind: "brave_combine";
        optional?: boolean;
      }
    | {
        /**
         * 「合体するか、コアN個を置いてスピリット状態にする」。
         * コア配置は exact amount で、置けない場合そのルートは提示しない。
         */
        kind: "brave_combine_or_core";
        coreCount: number;
        sourceScope?: "field_and_reserve" | "reserve_only";
      }
    | {
        /**
         * 「このとき、この転醒後スピリットにコアを好きなだけ置ける」。
         * minimum:"back_face_lv" は、B 面 Lv1 以上に不足する数を pending の最低配置数にする。
         */
        kind: "core_distribute";
        sourceScope?: "field_and_reserve" | "reserve_only";
        minimum?: number | "back_face_lv";
      };

  export interface RebirthAction {
    kind: "rebirth";
    /** 転醒条件: 自分のカウントがこの値以下 */
    maxCount?: number;
    /** 転醒トリガー説明 */
    triggerDescription?: string;
    /**
     * 合体相手を転醒後カードの煌臨元として畳む（08a §2「煌臨元カードとして追加することで…裏返せる」）。
     * BSSA01-転醒X03(A)（host が合体ブレイヴを煌臨元に畳んで裏返す）型。
     * executeRebirth が attachAsAdventSource で sourceInstanceId の合体相手を煌臨元へ移す。
     */
    foldCombinedPartnerToAdventSource?: boolean;
    /**
     * 外部転醒: 指定 target の対象 instance を flip。省略時は sourceInstanceId 自身を flip。
     * BSSA01-XX01 神技4「夜錆の転醒前1つの【転醒】を発揮する」型。
     */
    target?: TargetSpec;
    /** 対象を発揮源に合体していたものとして転醒する。実際の合体イベントは起こさない。 */
    asIfCombinedWithSource?: boolean;
    /**
     * 「転醒条件を満たしたものとして発揮」= maxCount チェックを skip。
     * BSSA01-XX01 神技4 のみが現状の使用元。
     */
    forceTriggerCondition?: boolean;
    /**
     * 「ブレイヴを分離し裏返せる」型。通常の分離と同様、フィールド/リザーブから
     * Lv1以上になる任意数のコアをHUDで配置する。確定まで転醒を保留する。
     */
    separatesFromHost?: boolean;
    /**
     * Q1282/Q1296 型: 「ソウルコアを置いて裏返せる」は可能な限り置き、置けない/置いても
     * B 面最低 Lv に届かない場合でも一度裏返してから、その転醒後カードを消滅させる。
     * 一般の lv-deficit 転醒中断とは異なるため、該当カードのみ opt-in する。
     */
    vanishAfterFlipOnLvDeficit?: boolean;
    /**
     * 「このとき、この転醒後スピリットにコアを置ける」本文で、B面最低Lv不足を
     * 直後の core_distribute step で補える型。true のとき executeRebirth は
     * Lv不足だけでは中断せず、後続 core_distribute の rollbackIfBelowMinTotal に判定を委ねる。
     */
    allowPostRebirthCorePlacementForLvDeficit?: boolean;
    /**
     * 「〜裏返せる。このとき〜」のうち、転醒に内蔵された後続選択。
     * B 面の card_event:"rebirth" として分離せず、選択確定まで仮想転醒として扱う。
     */
    postRebirthChoice?: RebirthPostChoice;
    /**
     * B面の定型テキストが定義する count 処理。省略時は通常の転醒定型文
     * 「この面に裏返ったとき...カウント+1する」として扱う。
     * B面に count 文言が無い独自 flip は "none" を明示する。
     */
    countBonusMode?: RebirthCountBonusMode;
  }

  /**
   * 逆転醒（B面→A面）。`executeRebirth`（A→B flip）の逆方向。10_rules/08a §逆転醒、issues/P3-98。
   * 語尾で 2 分類（裁定 2026-06-12）。**いずれも countValue は変動しない**（裁定 2026-06-14）。
   *
   * - `mode:"flip"`（パターン1: 「表にする/裏返す/表返す」）: 面反転のみ。コスト支払い・維持コア
   *   配置・instance 変更なし。状態（コア・疲労/回復・期間指定効果・instanceId）を完全引継。
   *   表面 def は instance の `originalDefinitionId`（印字 = A 面 cardNo）から逆引きする。
   * - `mode:"summon"`（パターン2: 「裏返して配置/召喚する」）: 通常 summon/配置パイプライン経由。
   *   `withoutCost`（「コストを支払わず」明示時のみ）でコスト支払いのみ bypass。instance 変更・
   *   維持コア配置は skip しない。P3-98 §3 の summon パイプライン再利用＋pending カスケードで
   *   配線済みであり、`resolve_reverse_rebirth_summon` が支払いと配置を確定する。
   */
  export interface ReverseRebirthAction {
    kind: "reverse_rebirth";
    mode: "flip" | "summon";
    /** mode:"summon" のとき、「コストを支払わず」明示時のみ true（コスト支払いを bypass）。 */
    withoutCost?: boolean;
  }

  /**
   * 効果ステップ内からの直接合体（ENGINE-bsft01-tr-rebirth-brave-combine-branch）。
   * 「このカードを自分のスピリットに合体させることができる」型。main フェーズ限定・コスト無しの
   * player action `brave_combine` とは別経路で、フラッシュ/スタック/転醒許可窓等の効果解決途中
   * から同じ合体処理（コア移動+attach+疲労合流）を発揮する。
   * `target` は候補（通常 `{kind:"filter", player:"self", filter:{category:["spirit","ultimate"]},
   * count:1}`）を宣言する。合体条件（braveCondition/多重合体上限/cannot_combine）は発動元カード
   * 自身の定義から自動導出して絞り込むため、card-data 側で braveCondition を再宣言しない。
   */
  export interface BraveCombineEffectAction {
    kind: "brave_combine_effect";
    target: TargetSpec;
    /**
     * 「直接合体するように召喚できる」型。true のとき、合体元が field 外から
     * field に入る direct combine を summon event として扱う。
     */
    asSummon?: boolean;
    /**
     * 合体元ブレイヴを発動元カード自身 (sourceInstanceId) 以外にする場合の参照
     * (ENGINE-brave-combine-third-party-target)。前段 step (通常 `noop` + `target` の
     * 選択専用 step) が解決した対象を `stepId` で参照し、その instance をブレイヴとして扱う。
     * 省略時は従来どおり sourceInstanceId 自身をブレイヴとして扱う（既存 BSFT01 系と後方互換）。
     * 参照先が解決されていない/対象が存在しない場合、この step は何も行わない（合体しない）。
     */
    source?: { stepId: string };
  }

  /**
   * 効果ステップ内からの直接分離（engine-field-magic-self-placement、BSAZ03-C01型）。
   * 「合体中のXを分離する」型。GUI から任意タイミングで行う基本操作 `brave_separate`
   * (legal action、legal-actions-apply.ts) とは別経路で、フラッシュ等の効果解決途中から
   * 同じ分離処理（維持コア補填+detach+分離時疲労状態決定）を発揮する。`target` はブレイヴ側
   * (`category:["brave"], combined:true` 等)で候補を絞り込んで宣言する。brave_combine_effect
   * と異なり合体条件の再検査は不要（分離に braveCondition 相当の制約は無いため）。
   */
  export interface BraveSeparateEffectAction {
    kind: "brave_separate_effect";
    target: TargetSpec;
  }

  /**
   * 転神/転者アクション。対象の創界神/導界者ネクサスにスピリット二重状態を付与する。
   * ターン終了時に自動リセット（turn-system.ts で処理済み）。
   */
  export interface DivineTransformAction {
    kind: "divine_transform";
    /** 転神対象（創界神/導界者ネクサスのフィルタ）。targetsGrandwalker: true 必須 */
    target: TargetSpec;
    /** スピリットとしての BP 定義 */
    bpByLevel: { level: number; bp: number }[];
    /** スピリットとしての色（省略時はカード本来の色） */
    colors?: CardColor[];
    /** スピリットとしてのシンボル（省略時はカード本来のシンボル） */
    symbols?: SymbolColor[];
    /** 創界神/導界者ネクサス以外では破壊されない（デフォルト: true） */
    protectedFromNonGrandwalker?: boolean;
  }

  /**
   * P3-47 F-2 Step 6: 任意のカードに act_as_spirit ContinuousEffect を登録する。
   *
   * 主用途: フランドール・スカーレット【フォーオブアカインド】が裏向きで配置した
   * 3 枚のカードを「フランドール本体のステータスを持つスピリット」として扱う。
   *
   * statBlueprint:
   * - `live_copy_from_source`: 効果の発動元 (= フランドール本体) のステータスを
   *   毎回再帰取得する (動的追従)。aspects で対象側面を指定。
   * - `static_copy`: 登録時点の snapshot を凍結。
   *
   * lifecycle 規約 (act-as-spirit.ts ヘッダ参照):
   * - duration: `{ scope: "while_on_field" }` がデフォルト。host (sourceInstanceId)
   *   または target (targetInstanceId) のフィールド離脱で自動的に CE が削除される。
   */
  export interface RegisterActAsSpiritAction {
    kind: "register_act_as_spirit";
    /** act_as_spirit を載せる対象カード。複数解決される場合は各 target に CE を登録。 */
    target: TargetSpec;
    /**
     * ステータス参照源。
     * - `live_copy_from_source`: 効果の発動元 (sourceInstanceId) を参照。
     *   token のステータスは host の現在値に追従。
     * - `static_copy`: 登録時点の snapshot を固定。
     */
    statBlueprint:
      | {
          kind: "live_copy_from_source";
          aspects: ActAsSpiritStatAspect[];
        }
      | { kind: "static_copy"; snapshot: ActAsSpiritStatSnapshot };
    /** カードを上書きする値。cardName / levelDefs / keywords (例: ["cannot_combine"]) */
    overrides?: ActAsSpiritOverrides;
    /**
     * 継続効果の持続。省略時 = `{ scope: "while_on_field" }`。
     * lifecycle 規約 (Step 4) を満たすため while_on_field が原則。
     */
    duration?: Duration;
  }

  /**
   * P3-47 F-4 Step 4: 効果対象リダイレクト CE を登録する。
   *
   * 主用途: フランドール・スカーレット【フォーオブアカインド】の
   *   「このスピリットが相手の効果の対象になったとき、その効果の対象を
   *    それらのスピリットに変更できる」
   *
   * 登録された CE (modifierTag: "redirect_effect_target") は、target-resolution の
   * 直後 / 効果アクション実行直前に検査され、保護対象が対象集合に含まれていれば
   * `pendingTargetRedirects` に prompt が積まれる。confirm 時は同じ target slice 内で
   * 同時指定されたフィールド上の Spirit/Ultimate/Brave/Nexus を replacement 1 体へ
   * collapse する (BS69 Q26982 / CB13 Q14170 / Q26984 / Q14172)。
   *
   * lifecycle 規約 (act-as-spirit と同様):
   * - duration 既定 `{ scope: "while_on_field" }` (host 離脱で自動消滅)
   * - sourceInstanceId: 効果発揮元 (host = フランドール本体)
   * - targetInstanceId: 保護対象 (target spec で解決した instanceId、または "self" なら省略)
   */
  export interface RegisterRedirectEffectTargetAction {
    kind: "register_redirect_effect_target";
    /**
     * トリガー条件: どのカードが対象になったときに redirect が発動するか。
     * - `kind: "self"`: 効果発揮元 (sourceInstanceId) が対象に含まれたとき発動
     * - `kind: "target"`: target spec で解決した各カードを保護対象とする
     * - `kind: "owned_filter"`: CE の actingPlayerId が管理する場のカードのうち
     *   filter に一致するもの全て (登録時点の固定リストではなく matchtime に動的評価)。
     *   BSLH01-R02「自分のスピリットが相手のスピリット効果の対象になるとき」のように
     *   保護対象が召喚/離脱で増減する集合のときに使う。
     */
    protectedTarget:
      | { kind: "self" }
      | { kind: "target"; target: TargetSpec }
      | { kind: "owned_filter"; filter: CardFilter };
    /**
     * 発動元プレイヤー条件。
     * - "opponent": 相手の効果のみ反応 (フランドール想定の既定)
     * - "any": 自他問わず
     */
    sourcePlayerRef?: "opponent" | "any";
    /**
     * 発動元カードの種別条件 (例: BSLH01-R02「相手の**スピリット**の効果」)。
     * 省略時は発動元カードの種別を問わない (フランドール既定挙動を変えない)。
     * 効果発揮元 (effectSource) の instance/definition が解決できないときは
     * フェイルクローズで redirect 不発とする (誤って許可しない)。
     */
    sourceFilter?: CardFilter;
    /**
     * 差し替え先候補の解決方法。
     * - `kind: "associated_act_as_spirit"`: 同じ host で発行された act_as_spirit CE の
     *   targetInstanceId 群 (フランドール token 集合)
     * - `kind: "explicit"`: target spec で解決した instanceId 群を候補とする
     * - `kind: "owned_filter"`: 指定 player が管理する場のカードのうち filter に一致するもの全て
     *   (matchtime 動的評価。player 省略時は "self"=CE actingPlayerId)。
     *   `protectedTarget.kind:"owned_filter"` と同じ集合を候補にしたいときに使う。
     *   BSLH01-R02「自分が選ぶ自分のスピリット1体」/ BSLH01-T16「相手が対象を選びなおす」。
     */
    redirectCandidate:
      | { kind: "associated_act_as_spirit" }
      | { kind: "explicit"; target: TargetSpec }
      | {
          kind: "owned_filter";
          filter: CardFilter;
          player?: "self" | "opponent";
          /**
           * 元効果の target spec を保持し、player 参照だけ置換して候補を絞る。
           * BSLH01-T16「その効果の『相手』を『自分』に変更」型では、
           * 元のカテゴリ/BP/状態条件を維持したまま、相手が自分側の対象を選びなおす。
           */
          preserveOriginalTargetSpec?: { player: PlayerRef };
        };
    /** redirect prompt を受けるプレイヤー。省略時 "self" (= CE owner)。 */
    promptedPlayerRef?: "self" | "opponent";
    /**
     * redirect 先候補を実際に選ぶプレイヤー。省略時は promptedPlayerRef と同じ。
     * 任意判断者と対象選択者が異なる場合に使う。
     */
    candidateChooserPlayerRef?: "self" | "opponent";
    /** "できる" 表記 = 任意発動。省略時 true。 */
    optional?: boolean;
    /**
     * redirect 自体の発動回数制限 (例:「ターンに1回」)。CE の sourceInstanceId を
     * effectLabel:"redirect_effect_target" で記録・照合する (canUseEffectByUsageLimit /
     * recordEffectUsageIfLimited 経由の既存汎用台帳を再利用、新規ストア無し)。
     * 未設定時は無制限 (フランドール既定挙動を変えない)。
     */
    usageLimit?: import("./model").EffectUsageLimit;
    /** 継続効果の持続。省略時 = `{ scope: "while_on_field" }`。 */
    duration?: import("./model").Duration;
  }

  /**
   * P3-99 集約 variant: 付与する効果の集合を、被付与カードの煌臨元カード群から動的に列挙する。
   *
   * 主用途: BSSL01-X02「このスピリットの煌臨元にあるカード名の異なる『水篠 旬』すべての
   * 効果を得る」。`target` で解決したカード (通常 `{ kind: "self" }` = 発揮元自身) の
   * `adventSourceIdsOf()` （煌臨元、多重煌臨で旧ホストも flat に含む）を走査し、
   * `nameFilter` に一致する定義を名前で dedupe（同名は先勝ち 1 件）した上で、各定義の
   * `effects[]` を 1 件ずつ通常の `grantedEffect` 登録（既存 grant_effect foundation）に
   * 展開する。1 つの `RegisterGrantedEffectAction` から複数の `granted_effect` CE が
   * 生成されるが、各 CE は既存の単一 grantedEffect スキーマのまま (誘発検出/起動権 variant の
   * 消費側は無改修)。`timing.kind === "continuous"` の候補効果は注入点が無いため除外する
   * (継続効果の grant 伝播は P3-99 の別スコープ、grant-effect-system.ts の
   * declaredTriggerEvents 早期 return と同じ扱い)。
   */
  export type GrantedEffectSourceSpec =
    | {
        kind: "advent_source_effects";
        /** 煌臨元カードの名前フィルタ（部分一致）。 */
        nameFilter: { contains: string };
      }
    | {
        kind: "card_effects";
        from:
          | { kind: "under_cards"; filter: CardFilter }
          | {
              kind: "zones";
              zones: Zone[];
              player?: PlayerRef;
              filter: CardFilter;
              maxCards?: number;
            };
        /** 指定ヘッダー以降の本文に紐付いた効果をまとめて得る。 */
        afterTextHeader: string;
        ignoreLevel?: boolean;
        /** 原文中の特定イベントを別イベントにも発揮する。 */
        additionalEvents?: {
          source: CardEventType;
          events: CardEventType[];
          condition?: import("./model").ConditionClause[];
        };
      };

  /**
   * P3-99: 「効果そのもの」を被付与カード (target) へ一時付与する継続効果を登録する。
   *
   * 主用途: BSDB01-R03 ファイナルフラッシュ (自分のベジータ全体へアタック時/バトル終了時の
   * 入れ子誘発を一時付与) / BSTH002-転醒R01(B) 現世 (スピリット1体へターン1回の起動権付与)。
   *
   * 本体 (CE 登録) は act_as_spirit / redirect_effect_target と同じ ContinuousEffect
   * 登録パターン (modifierTag: "granted_effect")。被付与カードのイベントで grantedEffect を
   * 誘発/起動として発火させる「注入点」は別イテレーションで配線する (P3-99 §3)。
   *
   * lifecycle 規約 (act-as-spirit と同様):
   * - duration 既定 `{ scope: "while_on_field" }` — 発揮元 (sourceInstanceId) の離脱で
   *   付与は即座に停止 (04 §合体ブレイヴ単体破壊の一般化)。`{ scope: "turn" }` で当ターン付与。
   * - targetInstanceId: 被付与カード (複数解決時は各 instance に CE 1 件)。
   */
  export interface RegisterGrantedEffectAction {
    kind: "grant_effect";
    /** 効果を付与する対象カード。複数解決される場合は各 target に CE を登録。 */
    target: TargetSpec;
    /**
     * 被付与カードに注入する効果 (trigger 込みの通常 Effect)。
     * 入れ子効果は被付与カードのイベントで、被付与カードを actor として発火する。
     * `grantedEffectSource` 指定時は無視される（動的列挙に置き換わる）。
     */
    grantedEffect?: Effect;
    /**
     * P3-99 集約 variant: 付与する効果を静的に 1 件指定する代わりに、動的ソースから
     * 列挙する。指定時 `grantedEffect` は無視される。
     */
    grantedEffectSource?: GrantedEffectSourceSpec;
    /**
     * 付与された効果を発揮するプレイヤー。省略時 = "self" (被付与カードの持ち主)。
     * ENGINE-grant-effect-player-ref-wiring (2026-07-15): 現状 `grantedEffect.timing.kind`
     * が `"card_event"`/`"game_event"` の**誘発 variant のみ** grant-effect-system.ts
     * `resolveGrantPendingActingPlayerId` で消費され、"opponent" 指定時に誘発解決の
     * actingPlayerId を被付与カードの相手 (= grant_effect 発揮元コントローラ) へ切り替える
     * (BSAZ02-C09「相手は相手の創界神ネクサス1つを指定できる」二重『相手』用)。
     * `timing.kind === "activated"` の**起動権 variant** (legal-actions-availability.ts
     * ~L3319 `起動できるのは被付与カードの管理者`) は本フィールドを未消費のまま
     * `grantee.controllerPlayerId` 固定で判定するため、"opponent" を起動権 variant と
     * 組み合わせても意図通りに動作しない（verifier 2026-07-15 round2 指摘）。起動権 variant で
     * 使う場合は先に legal-actions-availability.ts 側の配線を追加すること。
     */
    grantPlayerRef?: PlayerRef;
    /** 継続効果の持続。省略時 = `{ scope: "while_on_field" }`。 */
    duration?: import("./model").Duration;
    /**
     * engine-player-scoped-turn-reservation: true のとき「プレイヤー起点の予約」variant として
     * 登録する。通常の grant_effect lifecycle（grantee の zone===field 要求、
     * grant-effect-system.ts の検出/解決チェックポイント）をバイパスし、発揮元
     * （grantee、通常 `target:{kind:"self"}`）が場を離れて（例: 使用後トラッシュへ行く
     * マジック自身）も、`duration`（通常 `{ scope: "turn" }`）のみで有効期限を管理する。
     * 宣言効果自身の `condition`（例: 「魂状態を含む自分の『X』がいるとき」）は登録時の
     * 一度きりのゲートとして扱われ、以後 continuous-effect-rebuild の provenance 再検証では
     * 再評価しない（ソースが REBUILD_ZONES 外へ移動した時点で以後 valid 固定、
     * isContinuousEffectStillValid 参照）。BSKB01-R04 初出。
     */
    turnReservation?: boolean;
  }

  /**
   * 星霊衣 S1 配置 (P3-100): host スピリット (sourceInstanceId) の合体ブレイヴ1つを分離し、
   * その B面 (backFace) を表向きで host の下 (text_role アンダーカード) へ置く。07b §6。
   *
   * - 候補源は host の合体ブレイヴ (attachedChildrenIds)。B面 (backFace) を持つカードのみ可
   *   (「B面を持たない＝転醒でないカードは置けない」)。
   * - 置かれたブレイヴは definitionId=backFace.cardNo に切替・normalCoreCount=0・
   *   attachedToInstanceId=host・zoneRoleName="star-garment"。host.underCards に
   *   `{ role:"text_role", roleTag }` を push し attachedChildrenIds から除く。
   * - 離脱破棄 / host 効果集約 / フラッシュ入替は別スライス (P3-100 S2-S4)。
   */
  export interface PlaceStarGarmentAction {
    kind: "place_star_garment";
    /** 星霊衣化する対象 (host の合体ブレイヴ)。解決結果は host の合体ブレイヴに限定される。 */
    target: TargetSpec;
    /** アンダーカード役割タグ。省略時 "星霊衣"。 */
    roleTag?: string;
  }

  /**
   * 星霊衣 S4 入替 (P3-100): host スピリット (sourceInstanceId) 下の星霊衣カード1枚と、
   * host の合体ブレイヴ1つを入れ替える。07b §6。
   *
   * - 下から出るカードは originalDefinitionId (= A面) に戻し、host の正規合体ブレイヴにする。
   * - 入るブレイヴは place_star_garment と同じく B面へ切替え、host 下の text_role アンダーカードにする。
   * - 現 slice は CX01 の単一スロット前提で、underCards 内の先頭 roleTag を入替元にする。
   */
  export interface SwapStarGarmentAction {
    kind: "swap_star_garment";
    /** 星霊衣化して下に入れる対象 (host の合体ブレイヴ)。 */
    target: TargetSpec;
    /** アンダーカード役割タグ。省略時 "星霊衣"。 */
    roleTag?: string;
  }

  /**
   * 【バレットエディット】(P3-111 S7、P3-116 SSOT是正): host (sourceInstanceId) の自分の
   * 手札1枚を host の下 (text_role アンダーカード) へ表向きで置く。`place_star_garment` と
   * 同型だが、候補源は host の合体ブレイヴではなく自分の手札 (target.zone:"hand") —
   * `place_star_garment` 用の `sourceAttachedChildrenOnly` 等の候補絞り込みは適用されない。
   * ドロー等の後続効果は本 action と独立した後続 step (`ref_succeeded` 参照) で表現する
   * （bulletEditData 専用 LegalAction kind + 専用 executor を置き換え、
   * use_field_card_effect 汎用経路 + FIELD_TARGETING_ACTION_KINDS へ統合する）。
   */
  export interface BulletEditAction {
    kind: "bullet_edit";
    /** host の下に置く手札1枚。 */
    target: TargetSpec;
    /** アンダーカード役割タグ。省略時 "バレットエディット"。 */
    roleTag?: string;
  }

  /**
   * 【バレットエディット】入替 (P3-111 S11、P3-116 SSOT是正): host (sourceInstanceId) 下の
   * 既存 text_role アンダーカード (roleTag既定"バレットエディット") を手札へ戻し、代わりに自分の手札1枚を
   * 同じ役割で下に置く。`swap_star_garment` と同型だが、入る側候補は host の合体ブレイヴでは
   * なく自分の手札 (target.zone:"hand")。出る側は host 自身の既存 under-card 1枚に固定
   * (`sourceRequiredUnderCard` で legal action 列挙段階の前提にする)。
   */
  export interface SwapBulletEditAction {
    kind: "swap_bullet_edit";
    /** host の下に入れる手札1枚。 */
    target: TargetSpec;
    /** アンダーカード役割タグ。省略時 "バレットエディット"。 */
    roleTag?: string;
  }

  /**
   * 汎用 text_role アンダーカード配置 (engine-aldnoah-drive-under-card-keyword)。
   * `place_star_garment`/`bullet_edit` と異なり、host (下に置かれる側) は発動元カード
   * 自身ではなく `hostTarget` で別途解決する（【アルドノアドライブ】等「自分の他カードが
   * 召喚/配置/転醒したとき、手札/フィールドのこのカードをそのカードの下に置ける」型の
   * 第三者観測トリガーが sourceInstanceId=置かれる側カード自身、host=誘発元カード、
   * という非対称な関係を持つため）。
   * host 側の枠数上限は host 定義の `underCardSlots`（roleTag 一致エントリの maxCount）を
   * 優先し、宣言が無ければ `fallbackMaxCount`（省略時1）にフォールバックする。
   * 置かれるカード自身は常に発動元カード (sourceInstanceId) — 「手札/フィールドのこの
   * カード」は selectable target ではなく効果の印字元カード自身を指すため、既存 `target`
   * TargetSpec（`{kind:"source_card"}` は zone:"field" 限定で手札状態を解決できない）は
   * 使わず sourceInstanceId を直接解決する。
   */
  export interface PlaceTextRoleUnderCardAction {
    kind: "place_text_role_under_card";
    /** 配置先 host。誘発元カードを指す想定 (`{kind:"trigger_related_instance"}` 等)。 */
    hostTarget: TargetSpec;
    /** アンダーカード役割タグ。 */
    roleTag: string;
    /** host が underCardSlots で該当 roleTag を宣言していない場合の上限。省略時1。 */
    fallbackMaxCount?: number;
    /**
     * 配置されるカードの由来 (engine-under-card-host-reparent、BSAZ02-C06)。
     * - "self" (省略時、既存挙動): 発動元カード自身 (sourceInstanceId) を手札/フィールドから配置。
     * - "self_under_card": 発動元カード (sourceInstanceId) の下に既に付いている text_role
     *   アンダーカード (roleTag 一致) を、旧 host から外して新 host の下へ付け替える
     *   (host-to-host reparent。「このスピリットの下の『X』を、召喚したカードの下に加え」型)。
     * - "trash_by_card_name": 発動元カード自身ではなく、自分のトラッシュにある `cardName`
     *   一致カード（先頭1枚）を配置する (engine-under-card-trash-fetch-by-name、BSAZ02-X04/X05
     *   【導域】「トラッシュにある『アルドノアドライブ』を裏向きで下に置く」型)。該当カードが
     *   トラッシュに無ければ no-op。
     * - "field_or_trash_host": 発動元カードとは無関係に、`sourceHostFilter` に一致する
     *   自分の場のカード (host) の下に付いている `roleTag` 一致 text_role アンダーカード、
     *   または過去にそのような host から detach され `CardInstance.detachedUnderCardOrigin`
     *   (roleTag+実効カード名) を保持したままトラッシュに単独で存在するカードを、いずれか1枚
     *   見つけて配置する (ENGINE-x03-cross-zone-aldnoah-drive-transfer、BSAZ02-X03「フィールド/
     *   トラッシュの『オルテュギア』の【アルドノアドライブ】1つを...得る」型)。前者を優先し、
     *   見つからなければ後者を探す。いずれも無ければ no-op。
     */
    moveFrom?:
      | "self"
      | "self_under_card"
      | "trash_by_card_name"
      | "field_or_trash_host";
    /** moveFrom:"trash_by_card_name" のときの検索対象カード名 (matchesCardName 経由で照合)。 */
    cardName?: CardNameMatch;
    /**
     * moveFrom:"field_or_trash_host" のときの検索対象 host フィルタ。act_as_spirit トークン等
     * カード名上書きを反映するには `cardNameEffective` を使う（`cardName` は raw def.name 判定）。
     */
    sourceHostFilter?: CardFilter;
    /** true のとき配置後 faceDown:true にする（省略時 false、既存挙動）。 */
    placeFaceDown?: boolean;
  }

  /**
   * 手札/手元 ⇔ トラッシュの1対1入替を提示する (engine-atomic-hand-trash-swap-legal-action、
   * BSTH02.7-TR03(A)【神秘】等)。`outgoingFilter` に一致する自分の手札/手元カードと
   * `incomingFilter` に一致する自分のトラッシュカードを、それぞれ1体以上の候補が
   * 同時に存在するときだけ `PendingHandTrashSwapChoice` として提示する
   * （片側でも候補0なら何もしない＝発火自体させない。既存 `swap_bullet_edit`/
   * `swap_star_garment` の「両側候補を同時に確認してから1アクションで交換」パターンを
   * 手札/手元⇔トラッシュへ一般化したもの）。実際の交換候補選択・実行は
   * `swap_hand_trash` legal action（解決時点で1アクション
   * atomic に交換、出る側カードの現在ゾーンをそのまま入る側の行き先にする）。
   */
  export interface QueueHandTrashSwapAction {
    kind: "queue_hand_trash_swap";
    /** 手札/手元側の候補フィルタ。 */
    outgoingFilter: CardFilter;
    /** 手札/手元側の候補ゾーン。省略時は既存互換で hand + set_aside。 */
    outgoingZones?: ReadonlyArray<Extract<Zone, "hand" | "set_aside">>;
    /** トラッシュ側の候補フィルタ。 */
    incomingFilter: CardFilter;
    /** 「このカード」を入れ替える場合は発揮元の個体に限定する。同名別個体は含めない。 */
    incomingFrom?: "source_card";
  }

  /**
   * フィールドの発動元カード ⇔ 手札カードの1対1入替を提示する。
   * 「このスピリットを自分の手札にある条件一致カードと回復状態で入れ替えられる」型。
   * 候補選択は pending + legal action で解決し、入替自体は召喚イベントを発火させない state-change。
   */
  export interface QueueFieldHandSwapAction {
    kind: "queue_field_hand_swap";
    /** 入れ替えを起こしたキーワードの観測範囲。 */
    effectScope?: import("./model").EffectEventScope;
    /** 手札からフィールドへ入るカードの候補フィルタ。 */
    incomingFilter: CardFilter;
    /** true のとき、手札から入るカードを回復状態にする。 */
    enterRecovered?: boolean;
  }

  /** F-2 Step 6: act_as_spirit metadata の DSL 表現用に再エクスポート。 */
  export type ActAsSpiritStatAspect =
    | "cost"
    | "reductionSymbols"
    | "symbolColors"
    | "tribes"
    | "levelDefs"
    | "currentLv";

  export interface ActAsSpiritStatSnapshot {
    cost: number;
    reductionSymbols: SymbolColor[];
    symbolColors: SymbolColor[];
    tribes: string[];
    levelDefs: import("./model").LevelDefinition[];
    /** engine-deck-derived-clone-spirit: カード色の完全上書き。省略時は上書きしない。 */
    colors?: CardColor[];
  }

  export interface ActAsSpiritOverrides {
    cardName?: string;
    levelDefs?: import("./model").LevelDefinition[];
    keywords?: string[];
  }

  export interface LifeDamageInterceptionAction {
    kind: "life_damage_interception";
    /** 保護対象プレイヤー */
    player: PlayerRef;
    /**
     * ダメージ原因フィルタ。
     * - opponent_effect: 保護対象から見て相手の効果によるライフ減少のみ
     * - opponent: 保護対象から見て相手によるライフ減少（効果 + バトル）
     * - any: 原因不問
     */
    cause: "opponent_effect" | "opponent" | "any";
    /**
     * - before=ダメージ前にコア追加（ダメージは通常解決）
     * - replace=ダメージを置換（スキップ）
     * - floor=ライフ下限保護（`floor` を下回るライフ減少をクランプする。
     *   「自分のライフは0にならない」= floor:1 / 「1以下にならない」= floor:2。
     *   コア移動は伴わない＝`coreAction` 不要）
     * - turn_cap=ターン累積上限（「このターン（の間）、自分のライフは N しか減らない」型。
     *   そのターンに自分のライフが減る量の**合計**を最大 `cap` に頭打ちする。アタッカー単位・
     *   バトル単位ではなく**全原因（バトル／効果／その他）合算**で N まで。カウンタは
     *   発揮側コントローラの自ターン開始でリセット（10_rules/05 §ライフ減少の上限キャップ、
     *   裁定 2026-06-15）。`attackerFilter` 併用時は一致する発生源由来だけを同じ
     *   ターン累積カウンタで頭打ちする。）
     */
    mode: "before" | "replace" | "floor" | "turn_cap";
    /**
     * ライフ減少の発生源カードフィルタ。バトルではこのフィルタに一致するアタッカーが
     * 与える分のみを対象に mode を適用し、効果起因のライフ減少では発揮元カードが
     * このフィルタに一致する場合のみ mode を適用する
     * （例「コスト4以上の相手スピリットのアタックでは自分のライフは減らない」
     * = mode:"replace" + attackerFilter:{ minCost:4, category:["spirit"] }、
     * 「指定した相手スピリットによって減らない」= attackerFilter:{ instanceIds:[...] }）。
     * 一致しないアタッカー/発揮元のライフ減少は通常解決する。
     * 10_rules/05「ブロックされなかった参加体のライフ減少」per-participant 帰属が根拠。
     */
    attackerFilter?: CardFilter;
    /**
     * true のとき、この interception はバトル由来のライフ減少だけを対象にする。
     * 「アタックでは」型で attackerFilter を使う場合、効果起因のライフ減少に同じ
     * フィルタが誤適用されないよう CE metadata へ保持する。
     */
    battleOnly?: boolean;
    /**
     * true のとき、attackerFilter に加えて「発揮元 (このスピリット) 自身が
     * アタッカーであるバトル」のみを対象にする（「このスピリットによって相手の
     * ライフは減らない」型の自己防止。player は通常 "opponent" を指定）。
     * 登録時に sourceInstanceId を解決して CE metadata の attackerInstanceIds に格納する。
     */
    attackerSelf?: boolean;
    /**
     * プレイヤーが選んだ対象を attackerFilter として固定する型
     * （「相手のスピリット/アルティメット1体を指定する。このターン、そのスピリット
     * によって自分のライフは減らない」= target で対象選択 + attackerSelectedTarget:true）。
     * `target` で対象選択を行い、解決時 (project_magic_target_after_stack_window) に
     * 選ばれた instanceId を CE metadata の attackerInstanceIds に格納する。
     * 受け口は getUnblockedLifeDamage の prevention.instanceIds 照合（attackerSelf と共通）。
     */
    attackerSelectedTarget?: boolean;
    /** attackerSelectedTarget 用の対象選択スペック */
    target?: TargetSpec;
    /** ターン内累積ダメージ閾値。省略時=1（毎回発動） */
    turnThreshold?: number;
    /**
     * mode:"floor" のとき、ライフがこの値を下回らないようダメージをクランプする。
     * 例「ライフは0にならない」= 1。省略時=1。
     * `attackerFilter` と併用すると、フィルタ一致アタッカーが与えるバトルライフ
     * 減少のみを floor でクランプする（「効果の記述を持つ相手のアタックでは
     * 自分のライフは1以下にならない」= mode:"floor" + floor:2 + attackerFilter）。
     */
    floor?: number;
    /**
     * mode:"replace" のアタッカー限定型で、一致アタッカーのライフ減少を 0 では
     * なくこの値に**上限クランプ**する（「相手のアタックでは自分のライフは N しか
     * 減らない」型）。省略時=0（=完全防止、従来の replace 挙動）。
     * `turnThreshold` を併用するとターン内累積でのクランプになる
     * （「1ターンに2以上減らない」= cap:1 + turnThreshold:2）。
     *
     * mode:"turn_cap" では「このターンの自分ライフ減少の合計上限」を表す。
     * attackerFilter 未指定時は player-wide に全原因合算（「自分のライフは N しか
     * 減らない」= cap:N）。attackerFilter / attackerInstanceIds 指定時は
     * protected player + CE/filter バケット単位で、一致する発生源由来をターン合計
     * `cap` に頭打ちする（「効果記述を持つ相手のスピリット/アルティメットによって
     * このターン、自分のライフは N しか減らない」型）。いずれも自ターン開始リセット。
     */
    cap?: number;
    /**
     * `attackerFilter` 一致アタッカー由来のバトルライフ減少を、**ターン内累積**で
     * この値に頭打ちにする per-attacker-BP gate cap（mode:"replace" のバトル経路専用）。
     * 「BP6000 以下のスピリット/アルティメットのアタックでは、自分のライフは 1 ターンに
     * 2 以上減らない」(BSTH08.5-C21) = attackerFilter:{ maxBp:6000 } + attackerBpTurnCap:1。
     * ⚠「2 以上減らない」= 減少は最大 1（cap は N=1。"2" は cap 値ではない）。
     * 基底 turn_cap（全原因合算）とは独立した別トラック（閾値超え・非バトル由来は枠外で
     * 無制限）。バトル解決の getUnblockedLifeDamage が per-participant に適用し、実減少分を
     * bpThresholdCappedLifeReductionThisTurn へ累積する。10_rules/05 §ライフ減少の上限
     * キャップ、裁定 2026-06-16。
     */
    attackerBpTurnCap?: number;
    /** インターセプション時に実行するコア移動（mode:"before"/"replace" のみ） */
    coreAction?: {
      from: CoreLocation;
      to: CoreLocation;
      amount: Amount;
    };
    /**
     * 破棄コストゲート（mode:"replace" 専用）:「手札/手元にあるこのカードは、〜のとき、
     * 破棄することで、自分のライフは減らない」型（BSTH02.7-C05[1] / BSTH08.5-C23[0]）。
     *
     * 10_rules/02 §コスト先払い型ドロー枚数修正（model A: コスト→効果確定→システム処理）
     * と同じ「プレ判断モデル」を life damage 解決に適用する。ダメージが発生しようとする
     * 都度、sourceInstanceId が `zones` のいずれかにまだあれば、ライフが減る側の
     * プレイヤーに「このカードを破棄して防ぐ / 何もせず受ける」を選ばせる
     * （`pendingLifeDamageDiscardChoice`）。破棄はこのカード自身が対象（他候補選択は無い）。
     *
     * - sourceInstanceId が既に `zones` を離れていれば、この CE は無条件でスキップする
     *   （防止不可。カード自身が対象のため「1回限り破棄したら消滅」は自然に成立する）。
     * - 支払い（破棄）確定でこのダメージは 0 に置換。辞退なら通常通り解決する。
     * - `attackerFilter` / `cap` / `attackerBpTurnCap` とは併用しない
     *   （per-participant 系と異なり、プレイヤー選択を挟む全体置換のみを表現する）。
     */
    discardCostGate?: {
      /** 破棄コストを支払える対象ゾーン（このカード自身が現在いる必要がある） */
      zones: Array<"hand" | "set_aside">;
    };
    /**
     * 使用コストゲート（mode:"replace" 専用）:「手札にあるこのカードは、〜のとき、
     * コストを支払わずに使用することで、自分のライフは減らない」型（BSLH01-M05[1]）。
     *
     * `discardCostGate` と同じ「プレ判断モデル」だが、支払いは「このカードを破棄する」
     * ではなく「このカードを（コスト無しで）使用する」。最終的にカードがトラッシュへ
     * 置かれる点は discardCostGate と同じ処理（`moveCardZone` → "trash"）を共有するが、
     * 意味論上は使用（コスト踏み倒し）であり破棄ではないため `costKind:"use"` で区別する。
     *
     * 支払い確定時、`lifeDamageInterceptionUseCostGateUsedThisTurn`
     * （プレイヤー+カード instanceId 単位、自ターン開始ではなく毎ターン開始でリセット）に記録される。
     * このカード自身の他 effect が `life_damage_interception_use_cost_gate_paid_this_turn`
     * ConditionClause でこの記録を参照し、「このカードの効果で使用していたとき」型の
     * 条件無視（BSLH01-M05 textLines[6]、effects[2] の `field_lacks` 条件を `any_of` で
     * バイパス）を表現できる。
     *
     * - sourceInstanceId が `zones` を離れていれば無条件スキップ（discardCostGate と同型）。
     * - `attackerFilter` / `cap` / `attackerBpTurnCap` / `discardCostGate` /
     *   `declareGimmickGate` とは併用しない。
     */
    useCostGate?: {
      /** 使用コストを支払える対象ゾーン（このカード自身が現在いる必要がある） */
      zones: Array<"hand">;
      /**
       * コストなしで「使用」して発揮する同一カードの activated effect index。
       * `useCostGate` はカードを単にトラッシュへ置く処理ではなく通常の magic 使用
       * パイプラインへ接続するため、どの起動効果を発揮するかを明示する。
       */
      effectIndex: number;
    };
    /**
     * 宣言コストゲート（mode:"replace" 専用）:「ライフが減るとき、ターンに1回、
     * 宣言することで、減るコアの数を-N する」型（BSLH01-C12【ミシュラムワンダーランド】）。
     *
     * `discardCostGate` と同じ「プレ判断モデル」（コスト→効果確定→システム処理）だが、
     * 支払いはカード破棄ではなく `declare_gimmick` アクション（`declarationCountThisTurn`
     * を+1。宣言済み扱いになる副次効果はカード文面通り）で、ダメージを 0 にはせず
     * `reduceBy` 分だけ軽減する（discardCostGate の全額防止とは異なる部分軽減）。
     *
     * - discardCostGate と異なりカードがゾーンを離れて自然消滅する仕組みが無いため、
     *   「ターンに1回」は CE + プレイヤー単位の明示的な使用済みフラグ
     *   (`declareGimmickGateUsedThisTurn`) で管理する。既に使用済みなら
     *   この CE は黙ってスキップし、通常のダメージ解決を継続する。
     * - `attackerFilter` / `cap` / `attackerBpTurnCap` / `discardCostGate` /
     *   `useCostGate` とは併用しない。
     */
    declareGimmickGate?: {
      /** 1回の宣言で軽減するコア数。省略時 1。 */
      reduceBy?: number;
    };
    duration: Duration;
  }

  /**
   * 「このターンの間、[sourceFilter] を持つ自分のスピリットによるライフの減少は
   * 相手の効果では防げない」(P3-125 Step3、BSLH01-X08【ソウルドライブ・S】)。
   *
   * `effect_source_prevention_immunity`（誘発/マジック/フィールド起動等の**効果宣言**
   * ドメインの producer 側昇格）の対概念で、こちらは `life_damage_interception`
   * （**ライフダメージ解決**ドメイン、バトル BP 比較のライフ減少と効果起因の
   * ライフ減少の両方が経由する）を貫通する player-scoped CE を登録する。
   * 消費側は `applyLifeDamageInterception`（core-system.ts、効果起因、
   * `sourceCardMatchesFilter` 経由で単一発生源を判定）と `getUnblockedLifeDamage`
   * （battle-actions.ts、バトル起因、参加体ごとに leader カードを判定）の双方。
   */
  export interface GrantLifeDamageSourcePreventionImmunityAction {
    kind: "grant_life_damage_source_prevention_immunity";
    /** 免疫の恩恵を受けるプレイヤー（通常 "self"）。 */
    player: PlayerRef;
    /** 対象となるライフ減少の発生源カード（アタッカー/効果発揮元）フィルタ。 */
    sourceFilter: CardFilter;
    duration: Duration;
  }
}

// ════ Action union ════

export type Action =
  /** 解決済みで残る即時型継続効果だけを無効にする。未解決スタック・常時効果は除く。 */
  | {
      kind: "negate_ongoing_effects";
      target: TargetSpec;
      sourcePlayer: PlayerRef;
    }
  | { kind: "resume_deck_reveal"; pending: import("./model").PendingDeckReveal }
  // 制御
  | DSL.NoopAction
  | DSL.TurnFaceDownAction
  | DSL.GrantDeckHandAccessAction
  | DSL.RequireEffectCostAction
  // カード移動
  | DSL.DrawAction
  | DSL.DestroyAction
  | DSL.SuppressPendingLeaveEffectsAction
  | DSL.VanishAction
  | DSL.BpCompareDestroyAction
  | DSL.BounceAction
  | DSL.SendToDeckAction
  | DSL.DiscardAction
  | DSL.ProcessMovedToTrashAction
  | DSL.DiscardSetBurstAction
  | DSL.SearchZoneAction
  | DSL.DeckRevealAction
  | DSL.RevealHandAction
  | DSL.PeekDeckAction
  | DSL.ShuffleZoneAction
  | DSL.MoveCardAction
  | DSL.BorrowMagicEffectAction
  | DSL.BorrowCardEventEffectAction
  | DSL.RemoveFromGameAction
  | DSL.MoveSelfAction
  | DSL.SetSelfAsMirageAction
  | DSL.SetBurstAction
  | DSL.SummonAction
  | DSL.PutAction
  | DSL.PlaceAction
  | DSL.SplitFieldEntryChoiceAction
  | DSL.AdventAction
  | DSL.UseMagicWithoutCostAction
  | DSL.GrantMagicUseAction
  // コア・リソース
  | DSL.CoreMoveAction
  | DSL.CoreDistributeAction
  | DSL.CoreSetToLevelAction
  | DSL.PayCostAction
  | DSL.DeclareGimmickAction
  | DSL.CorrelatePendingTriggerAction
  | DSL.CountIncreaseAction
  | DSL.CountGainModifierAction
  | DSL.CountDecreaseAction
  | DSL.CountSetAction
  | DSL.LifeDamageAction
  | DSL.LifeFillAction
  // 継続修飾
  | DSL.BpModifyAction
  | DSL.SymbolAddAction
  | DSL.UnderCardSlotCapacityGrantAction
  | DSL.UnderCardRoleGrantAction
  | DSL.UnderCardTriggerInheritAction
  | DSL.TreatAsAction
  | DSL.OverridePropertiesAction
  | DSL.DrawModifyAction
  | DSL.CostModifyAction
  | DSL.AdventCostOverrideAction
  | DSL.EffectParamModifyAction
  | DSL.DurationOverrideAction
  | DSL.CoreMoveAmountModifierAction
  // 状態変更
  | DSL.RecoverAction
  | DSL.ExhaustAction
  | DSL.SetExhaustStateAction
  | DSL.PreventNextRecoveryAction
  | DSL.StayOnFieldAction
  | DSL.EnterSoulStateAction
  | DSL.QuartzSetAction
  // 戦闘制御
  | DSL.PreventBattleAction
  | DSL.PreventBraveSeparationAction
  | DSL.PreventNormalCoreMoveAction
  | DSL.RequireBattleCostAction
  | DSL.RequireAttackExhaustCostAction
  | DSL.RequireBattleDestroyCostAction
  | DSL.RequireHandGainCostAction
  | DSL.HandGainPreventionAction
  | DSL.PreventLifeDamageAction
  | DSL.UnblockableAction
  | DSL.AllowBlockWhileExhaustedAction
  | DSL.AllowAttackWhileExhaustedAction
  | DSL.AllowTaplessBattleDeclareAction
  | DSL.BlockUnblockableAction
  | DSL.AllowSimultaneousAttackAction
  | DSL.AllowMidBattleJoinAction
  | DSL.AllowIgnoreSummonConditionAction
  | DSL.GrantGameLossImmunityAction
  | DSL.GrantDeclaredSummonAltCostAction
  | DSL.GrantSummonTrashCorePlacementAction
  | DSL.GrantFlashConsecutiveUseAction
  | DSL.GrantLinkAidCostOverrideAction
  | DSL.GrantOptionalDeckRevealCountBoostAction
  | DSL.RegisterExpandEffectTargetCountAction
  | DSL.RequireMultiBlockAction
  | DSL.RequireBlockIfAbleAction
  | DSL.OfferMagicPreCostTriggerAction
  | DSL.ForceAttackStepEndAfterFirstBattleAction
  | DSL.RestrictFlashAction
  | DSL.RestrictStackAction
  | DSL.RestrictBurstActivationAction
  | DSL.RestrictAdventAction
  | DSL.RestrictRecoveryAction
  | DSL.RestrictReserveCostPaymentAction
  | DSL.RestrictFieldCostPaymentAction
  | DSL.GrantEffectSourcePreventionImmunityAction
  | DSL.SuppressStackSourceAction
  | DSL.ForceFirstAttackerAction
  | DSL.ForcedTargetInclusionAction
  | DSL.GateFlashStackCoreAction
  | DSL.GateFlashStackHandDiscardAction
  | DSL.PreventHandDiscardAction
  | DSL.PreventDeckDiscardAction
  | DSL.RedirectDeckDiscardToExcludeAction
  | DSL.RestrictCorePlacementAction
  | DSL.RestrictSymbolAdditionAction
  | DSL.RestrictDrawToTopAction
  | DSL.LifeGainReplacementAction
  | DSL.LifeGainPreventionAction
  | DSL.CoreMoveDestinationReplacementAction
  | DSL.RestrictEndAttackStepAction
  | DSL.RestrictEndBattleAction
  | DSL.RestrictEndStepAction
  | DSL.RestrictEndTurnAction
  | DSL.RestrictUseAction
  | DSL.PreventCostReductionAction
  | DSL.LimitCostReductionAction
  | DSL.ExtendFieldSymbolSourceAction
  | DSL.RestrictManifestAction
  | DSL.FieldNameUniquenessAction
  | DSL.CountAsMultipleAction
  | DSL.EndAttackStepAction
  | DSL.EndTurnAction
  | DSL.DesignateAttackAction
  | DSL.EndSingleBattleAction
  | DSL.EndBattleAction
  | DSL.AdditionalAttackAction
  | DSL.ConnectBattleAction
  | DSL.GrantExtraTurnAction
  | DSL.SkipNextTurnAction
  | DSL.GrantExtraStepsAction
  // 特殊
  | DSL.EffectImmunityAction
  | DSL.EffectResistanceAction
  | DSL.GrantPaidPreventionImmunityAction
  | DSL.GrantPaidLeaveSuppressionImmunityAction
  | DSL.NegateAction
  | DSL.SuppressEffectAction
  | DSL.RedirectTargetAction
  | DSL.ReplaceAttackDeclarationAction
  | DSL.RebirthAction
  | DSL.ReverseRebirthAction
  | DSL.BraveCombineEffectAction
  | DSL.BraveSeparateEffectAction
  | DSL.DivineTransformAction
  | DSL.RegisterActAsSpiritAction
  | DSL.RegisterRedirectEffectTargetAction
  | DSL.RegisterGrantedEffectAction
  | DSL.PlaceStarGarmentAction
  | DSL.SwapStarGarmentAction
  | DSL.BulletEditAction
  | DSL.SwapBulletEditAction
  | DSL.PlaceTextRoleUnderCardAction
  | DSL.QueueHandTrashSwapAction
  | DSL.QueueFieldHandSwapAction
  // インターセプション
  | DSL.LifeDamageInterceptionAction
  | DSL.GrantLifeDamageSourcePreventionImmunityAction;

export type DrawStepPrepaidDiscardDisposition =
  DSL.DrawStepPrepaidDiscardDisposition;

// ============================================================
// RetriggerConfig — 条件付き再発火
// ============================================================

/**
 * 条件付き再発火設定。
 * ステップに retrigger を設定すると、即時実行の代わりに
 * 指定イベント発生時に再発火する登録を行う。
 *
 * 例: 「このターンの間、〇〇がアタックしたとき、BP-2000する（上限：6回）」
 */
export interface RetriggerConfig {
  /** 再発火のトリガーイベント */
  event: import("./model").CardEventType;
  /** トリガーカードのプレイヤー。省略時 = "self" */
  triggerPlayer?: PlayerRef;
  /** トリガーカードのフィルタ条件 */
  triggerFilter?: CardFilter;
  /** 最大発火回数。省略時 = 無制限 */
  maxCount?: number;
  /** 持続期間。省略時 = { scope: "turn" } */
  duration?: import("./model").Duration;
  /** 再発火時に実行する step の executionMode。省略時は元 step の値を使う。 */
  fireExecutionMode?: "mandatory" | "optional";
  /**
   * 再発火先 step が executionMode:"optional" のとき、既定では従来どおり
   * execute 側へ自動 resume する。false の場合は pendingStepOptionalChoice を残し、
   * 「できる」型の選択をプレイヤー応答へ渡す。
   */
  autoResolveOptional?: boolean;
}

// ============================================================
// EffectStep — ステップ
// ============================================================

export type EffectStepRepeat =
  | {
      /** 追加実行回数。DynamicCount は解決時に評価し floor して使う。 */
      additional: CountBound;
      /**
       * 登録時の対象数上限は `additional` で作り、実行時だけ別の CountBound で追加回数を
       * 解決する場合に使う（例: コスト支払い後も「選んだ回数」を上限にする）。
       */
      executionAdditional?: CountBound;
      /**
       * 対象付き repeat の登録時に同一 targetInstanceId の複数選択を許すか。
       * 省略時は従来どおり true（「追加で発揮する」は同一対象を再選択し得る）。
       * 「2体のコア1個ずつ」のように別個体指定が本文に含まれる場合だけ false を明示する。
       */
      allowDuplicateTargets?: boolean;
      optional?: false;
      condition?: import("./model").ConditionClause[];
    }
  | {
      /** 任意追加。数値固定または DynamicCount の 0..N 選択として解決する。 */
      additional: CountBound;
      /**
       * 登録時の対象数上限は `additional` で作り、実行時だけ別の CountBound で追加回数を
       * 解決する場合に使う（例: コスト支払い後も「選んだ回数」を上限にする）。
       */
      executionAdditional?: CountBound;
      /**
       * 対象付き repeat の登録時に同一 targetInstanceId の複数選択を許すか。
       * 省略時は従来どおり true。
       */
      allowDuplicateTargets?: boolean;
      optional: true;
      condition?: import("./model").ConditionClause[];
    };

export interface EffectStep {
  id?: string;
  /** choice variant として提示する場合の表示ラベル。省略時は action.kind から自動導出。 */
  label?: string;
  /** step-level pending UI 用の短い問い/原文メタ。未指定時は action DSL から自動生成する。 */
  prompt?: import("./model").EffectStepPrompt;
  action: Action;
  executionMode?: "mandatory" | "optional";
  usageLimit?: UsageLimit | UsageLimit[];
  /** 同じ効果発揮内の複数stepで1回制限を共有する。最初の実行だけ消費し、辞退は消費しない。 */
  usageGroupId?: string;
  connector?: Connector;
  /**
   * `connector: "conditional_cost"` の効果側 step が失敗しても、後続 step のいずれかが
   * 実 payload として成功できる場合だけ rollback を保留する。
   *
   * 例: 「Aすることで、Bする。その後、Cできる」で B が 0 件でも C を実行できるなら
   * A を成立させ、B も C も不成立なら A を巻き戻す。
   */
  conditionalCostAlternativeStepIds?: readonly string[];
  choice?: EffectStep[];
  /**
   * choice variant 用のトリガー効果タイミング条件。
   * `Effect.timing.triggerEffectTiming` は effect 全体を絞るため、同一 effect 内の
   * 「A、またはその効果がスタック効果のときB」型では variant 側に保持する。
   */
  triggerEffectTiming?: import("./model").EffectActivationTiming;
  /** ステップレベルのゲーム状態条件 */
  condition?: import("./model").ConditionClause[];
  /** 前ステップ結果に基づく条件 */
  stepCondition?: StepCondition;
  /**
   * 対象候補を effect 宣言時ではなく、この step に到達した時点の盤面で確定する。
   * 前段 step の BP 修正などが後続 target filter に影響する複合効果用。
   */
  targetSelectionTiming?: "on_step";
  /** 条件付き再発火。設定時はアクションを即時実行せず、イベント発生時に再発火する登録を行う。 */
  retrigger?: RetriggerConfig;
  /**
   * このステップ以降の実行を「このバトル終了時」へ遅延する step 単位マーカー。
   * 「召喚する。その後、このバトル終了時、アタックステップを終了する」(M13 大妖精) のように
   * 1 effect 内で即実行 step と遅延 step が混在するケース用。effect 単位の
   * `timing.deferredTo` (effect 全体を遅延) と相補。当該 step に到達した時点で
   * `pendingBattleEndDeferrals` に resumeFromStepIndex 付きで退避し、バトル終了時に再開する。
   * 解決中に activeAttack が無ければ「このバトル」不在で以降を不発にする。
   */
  deferTo?: "battle_end";
  /**
   * D-2 Phase 2 chooser: このステップの「対象選択を行うプレイヤー」。
   * - 省略時 = "self"（効果の発動者が選ぶ）
   * - "opponent" = 効果発動者の相手が選ぶ（効果オーナーは据え置き）
   * 「相手は〇〇を選ぶ」「相手が対象を選びなおす」表現用。
   */
  chooser?: PlayerRef;
  /**
   * 反復発揮（「この効果を○○につき追加で発揮する」）。設定時、この step の action を
   * **基本 1 回に加えて** `additional` 回（解決時に DynamicCount で評価）追加実行する
   * （合計 1 + additional 回）。各反復は対象を独立に再解決するため、毎回新しい候補を
   * 選び直す（同一対象に重ねるか別対象にするかは候補集合次第）。`deck_reveal` は
   * 選択 pending をまたいで同じ step の未実行回を再開し、反復回数を発揮開始時に固定する。
   * 例「相手1体をBP-10000する。この効果を自分のカウント1につき追加で発揮し」(BSTH04-X02) =
   * bp_modify step に `repeat: { additional: { source: { kind: "count_value", player: "self" } } }`。
   * additional が 0（または負）なら基本 1 回のみ。専用 Effect フィールドではなく汎用 step
   * 修飾子なので、bp_modify に限らず任意 action を反復できる。
   */
  repeat?: EffectStepRepeat;
}

// ============================================================
// UsageLimit
// ============================================================

export interface UsageLimit {
  /**
   * 制限の種別。
   * - per_instance: 発揮元 instance 単位
   * - per_card_name: 発揮元 definitionId 単位 (同名カード共有)
   * - per_group: プレイヤーと limitGroupId 単位 (異なるカード名の取得効果とも共有)
   * - no_duplicate: 同名カードが複数いても 1 回のみ
   * - per_trigger_related_instance: 観測トリガー主語 Y 別 (BSTH05-X02 等
   *   「ターンに1回ずつ」型。card_event/game_event triggered のみ意味を持つ。
   *   pendingEffect.relatedInstanceId をキーに記録)
   * - per_trigger_activation: 同一 effect activation 由来の triggered 群を 1 回に dedup
   *   (BSDB01-CX01 effects[1]「破壊効果を発揮したとき」型。chainId をキーに記録。
   *   ENGINE-trigger-per-effect-activation-dedup)
   */
  kind:
    | "per_instance"
    | "per_card_name"
    | "per_group"
    | "no_duplicate"
    | "per_trigger_related_instance"
    | "per_trigger_activation";
  duration?: "turn" | "game" | "step" | "battle";
  maxCount?: number;
  /**
   * base maxCount に加算する動的回数。
   * 例: 「自分のカウント4につき、この効果の発揮回数を+1回する」=
   * `{ source:{ kind:"count_value", player:"self" }, divisor:4 }`。
   */
  maxCountAdditionalDynamic?: DynamicCount;
  /**
   * 条件付き maxCount 上書き (BSAZ01-X01[1] 「合体中、この効果を[ターンに3回]に変更する」 2026-06-26)。
   * 評価時点で最初に成立した entry の maxCount を採用する。base maxCount は fallback。
   * 評価器は legal-actions-shared.getUsageLimitMaxCount inline (循環 import 回避)。
   * 現在 `combined` / `count_value` clause のみ対応。新 clause は evaluateUsageLimitClause を拡張する。
   */
  maxCountOverrides?: readonly {
    when: import("./model").Condition;
    maxCount: number;
  }[];
  /**
   * P3-14 C-2 (effect_resisted): 「これらの効果が相手の効果を受けなかったとき、
   * ゲーム中に1回ずつしか使えない」(BSTH01-C21)。
   * true のとき、効果解決が相手効果の妨害を受けた場合
   * (例: restrict_end_attack_step / restrict_end_turn による終了効果の no-op) は
   * 使用記録を払い戻し、制限を消費しない。
   */
  unlessAffectedByOpponent?: boolean;
}

// ============================================================
// CardEventDisposition — card_event 効果のカード処理方法
// ============================================================

/**
 * revealed / moved_to_trash 効果で、対象カードをどう処理するかの明示的な宣言。
 * steps からの推論を廃止し、この型で処理方法を一意に決定する。
 */
export type CardEventDisposition =
  | { kind: "move"; destination: CardZone }
  | { kind: "summon"; costModifier?: CostModifier }
  | { kind: "remove_from_game" }
  | { kind: "steps_only" }
  /**
   * このカード自身を該当イベントの受理候補から除外する。
   * 「デッキからオープンされた/トラッシュにあるこのカードは手札に加えられず、
   * 入れ替えられない」型で使う。revealed の手札追加/入れ替えに失敗したカードは
   * 裁定に従って破棄され、それ以外の blocked は元イベント側の解決に従う。
   */
  | { kind: "blocked" }
  /**
   * swap = このカードを手札に加えると同時に、手札1枚を「このカード」が向かっていた
   * 行き先へ送る入れ替え（07b §鍵/星霊デッキオープン置換 line 40 裁定）。
   * 入れ替えで手札から出る1枚は「このカード」と同一物として扱い同じ行き先へ送るため、
   * revealed 由来（デッキから開かれたカード）はデッキの下、moved_to_trash 由来はトラッシュへ送る。
   * ルールで決め打ちせず由来から導出する（同一物の行き先=効果テキストの処理先）。
   */
  | { kind: "swap" }
  /** revealed 限定: 手札を経由せず直接バーストとしてセットする（BSTH09-M01 型）。 */
  | { kind: "set_as_burst" }
  /**
   * このカードのミラージュコストを支払ってセットする（無償セットではない）。
   */
  | { kind: "set_as_mirage" };

// ============================================================
// Effect — トップレベル効果
// ============================================================

export interface Effect {
  // === 4軸 ===
  applicability?: Applicability;
  timing: import("./model").Timing;
  condition?: import("./model").Condition;
  steps: EffectStep[];

  // === スコープ ===
  /**
   * タイミングスコープ（『自分の/相手の/お互いの + ステップ/ターン』）。
   * timing と直交する軸。省略時は timing ごとのデフォルトを使用。
   * continuous 効果を特定ステップに限定する場合に使用。
   */
  timingScope?: import("./model").TimingScope;

  /**
   * 起動効果の見出しラベル由来カテゴリ。
   * 省略時は `timing.mode` と同じカテゴリとして扱う。本文中の
   * 「フラッシュタイミングで」型のように、窓だけ flash でフラッシュ効果ではない場合は
   * "none" を指定する。
   */
  activationLabel?: import("./model").ActivatedEffectLabel;

  // === 制約 ===
  executionMode?: "mandatory" | "optional";
  /**
   * 同時誘発群内の解決優先度。省略時は "normal"。
   * "immediate" は「ただちに」型で、現在解決中の効果完了後、通常誘発より先に解決する。
   */
  triggerPriority?: TriggerPriority;
  usageLimit?: UsageLimit | UsageLimit[];
  /**
   * 「ターンに/ゲーム中にN回目の観測でのみ発火する」累積 occurrence ゲート
   * (BSLH01-C05/R03 quartz set-effect 等)。`usageLimit` とは別軸で、トリガー検出の
   * たび無条件で tally を加算し、加算後の値が `targetCount` と一致したときのみ発火する。
   * 詳細は `model.ts` `EffectOccurrenceGate` を参照。
   */
  occurrenceGate?: import("./model").EffectOccurrenceGate;
  /**
   * 複数 targetGroup が同じ instance を別ロールで選び得る場合に true。
   * 例: 創界神/導界者を兼ねるネクサスを「創界神1つ」「導界者1つ」の両枠で選ぶ。
   */
  allowDuplicateTargets?: boolean;

  /**
   * 限定的な防止不可（「この効果は○○の効果では防げない」）。「相手の効果では防げない」
   * （`preventionLevel: "unpreventable"` blanket）を、防止できる効果の**スコープ**を
   * 色 / カテゴリ / 系統で絞った producer 側修飾子。
   *
   * 原文には向きが真逆の 2 型があり、公式裁定 (Q8745/Q9751、10_rules/04b2) で確定済み。
   * 「Xの効果では防げない」「Xを持つ効果で防げない」= **X 以外**が防げる → `notPreventableBy*`。
   * 「X以外の効果では防げない」「Xを持たない効果では防げない」= **X だけ**が防げる →
   * `onlyPreventableBy*`。語尾だけで機械的に決めず、カードごとに原文を読んで判定する
   * （「一切」がスコープ内の強調として使われる例がある。P3-140）。
   *
   * 例: BSTH06-転醒X01(B)「この効果はスピリット/アルティメットの効果では防げない」=
   * `{ notPreventableByCategories: ["spirit", "ultimate"] }`（スピリット/アルティメット
   * 以外＝ブレイヴ/ネクサス/マジックの効果では防げる）。
   * BSTH01-R11「この効果は白の効果では防げない」=
   * `{ notPreventableByColors: ["white"] }`（白以外の効果では防げる）。
   * BSTH07-転醒X02(B)「系統:星蓮/闘神を持たない効果では防げない」=
   * `{ onlyPreventableByTribes: ["星蓮", "闘神"] }`。
   * BSTH03-転醒X01(B)「系統:蓬莱を持つ効果で防げない」=
   * `{ notPreventableByTribes: ["蓬莱"] }`。
   * BSTH08-X??「【超重装甲】以外では防げない」=
   * `{ onlyPreventableByKeywords: ["超重装甲"] }`（防止できるのは指定キーワードを
   * 持つ効果のみ）。
   *
   * 実行時挙動: 設定時、本効果は `sourcePreventionBypass` として解決し、対象側の
   * `cannot_*` 効果耐性・defense_immune・target lock を、効果源スコープに応じて
   * scoped に貫通する（[03c:27-28]）。`onlyPreventableBy*` は一致する防止元だけを
   * 残し、不一致の防止元を貫通する。`notPreventableBy*` は一致する防止元を貫通する。
   * 少なくとも 1 スコープを指定する。`onlyPreventableByColors` は後方互換のため残置。
   */
  preventionRestriction?: {
    onlyPreventableByColors?: CardColor[];
    onlyPreventableByCategories?: CardCategory[];
    onlyPreventableByTribes?: string[];
    onlyPreventableByKeywords?: string[];
    notPreventableByColors?: CardColor[];
    notPreventableByCategories?: CardCategory[];
    notPreventableByTribes?: string[];
    notPreventableByKeywords?: string[];
    colorMatchMode?: "exact" | "includes";
  };

  /**
   * 「相手の効果では防げない」(P3-43 unpreventable の producer)。
   * 設定時、本効果の離脱系/コア移動アクションは sourcePreventionLevel として伝搬され、
   * 対象の cannot_* 効果耐性・defense_immune（受けない/破壊されない 等）を貫通する
   * （model.ts EffectPreventionLevel / effect-resistance-check.ts）。候補列挙でも
   * 防御レベルで除外されず保護対象を選べるようにする（getEffectPreventionLevel）。
   * 「カウントN以上のとき防げない」のような条件付き防止不可は `preventionLevelCondition`
   * と併用する（下記）。値は通常 "unpreventable"。
   */
  preventionLevel?: import("./model").EffectPreventionLevel;

  /**
   * P3-105: 「一切の効果で防げない」等、`対象にできない/含めない` target lock まで
   * 貫通する rider。通常の「相手の効果では防げない」は `preventionLevel` のみで表し、
   * target lock は貫通しない。
   */
  targetLockBypass?: import("./effect/target-affect-gate").TargetLockBypassProfile;

  /**
   * 条件付き防止不可ゲート（「自分のカウントN以上のとき、この効果は相手の効果では防げない」
   * BSDB01-X02 / BSTS01-X02 型）。設定時、`preventionLevel` は**解決時に本条件が成立した
   * 場合のみ**適用され、不成立なら通常効果（防止可能 = "none"）として解決する。評価は
   * `evaluateCondition()` 一本に委譲（SSOT、effect-interpreter executeEffect 内）。
   * 注: 候補列挙（getEffectPreventionLevel）は静的 `preventionLevel` で over-include しうる
   * （条件不成立時に「受けない/破壊されない」相手カードも候補化されるが、解決時ゲートで
   * no-op となり盤面は正しい）。候補列挙の state-aware ゲートは循環依存回避のため別途。
   */
  preventionLevelCondition?: import("./model").ConditionClause[];

  /**
   * 効果メタ属性としての系統タグ（「この効果は系統：「X」を持つ」）。
   * `CardDefinition.tribe`（カード印字系統）とは別軸で、この効果自身が引き起こす
   * イベント（例: core_move によるライフ増加）の発生源系統を宣言する。第三者観測効果の
   * `trigger_tribes`/`trigger_source_match` ConditionClause が参照する
   * `TriggerContext.sourceTribes` に、カードの実効系統 (`getEffectiveTribes`) と
   * union で合成される（カード全体の系統扱いにはしない = 対象選択の `tribes` filter 等
   * 一般のカード系統照合には影響しない）。`condition` を省略すると常時付与、指定時は
   * 解決時に条件を満たす場合のみ付与する。
   * BSTH03-C03『相手のカウント1以上のとき、この効果は系統：「蓬莱」を持つ』=
   * `{ tribes: ["蓬莱"], condition: [{ kind: "count_value", player: "opponent", min: 1 }] }`。
   */
  effectTribes?: {
    tribes: readonly string[];
    condition?: import("./model").ConditionClause[];
  };

  /**
   * バースト効果限定: 相手の「バースト効果を発揮できない」(negate_opponent_burst /
   * burstSuppressKind: "cannot_activate") 効果を無視して発揮できる。
   * 「無効にする」(burstSuppressKind: "nullify") は無視せず受ける。
   * 防止ラダー [03b:25]「受けない」由来ではなく、発揮できないのみを能動的にバイパスする。
   * 例: BSTH01-M13「この効果は、相手の『バースト効果を発揮できない』効果を無視して発揮できる」。
   */
  ignoresOpponentCannotActivateBurst?: boolean;

  /**
   * バースト発動中限定: 「このカードが発動している間、このカードと自分は相手の効果を受けない」
   * 型の節②を表す。通常の `effect_immunity(..., while_set)` はセット中のカードだけを保護し、
   * 発動成立後はカードが burst zone を離れるため、この窓は明示フラグで区別する。
   *
   * 設定時、バーストの効果発揮宣言窓〜バースト効果解決後まで、発動カードに
   * `defense_immune`、コントローラーに `player_effect_immunity` を一時登録する。
   */
  burstActivationWindowImmunity?: "self_and_controller";

  /**
   * 共有使用制限グループ ID。
   * 異なる timing で分離された効果（例: 召喚時/アタック時）が
   * 「ターンに1回」等の制限を共有する場合に設定する。
   * 同一 limitGroupId の効果は使用回数を合算する。
   */
  limitGroupId?: string;

  // === card_event disposition ===
  /**
   * card_event 効果のカード処理方法。revealed / moved_to_trash 効果で使用。
   * 省略時は steps の先頭アクションから推論（後方互換）。
   */
  cardEventDisposition?: CardEventDisposition;

  /**
   * インライン処理フラグ。true の場合、本効果は誘発効果キューを経由せず、
   * 該当 timing のシステム処理内（例: ドローステップ）で直接実行される。
   *
   * 現在のサポート対象:
   * - `timing.kind === "phase"` かつ `timing.step === "draw"` かつ `timing.whose === "self"`
   *   → `turn-system.ts` のドローステップ処理が、システムドローの前後で
   *     `draw_modify` ステップ（プレ）と残りのステップ（ポスト）をその場で実行する。
   *
   * 該当 Effect は `structured-effect-registrations.ts` の triggered 登録から除外される。
   * `usageLimit` はポスト実行時に 1 回だけ消費する。
   */
  inline?: boolean;

  // === メタデータ ===
  heading?: string;
  triggerPhrases?: string[];
  keywords?: string[];
  textRef?: number[];
  stub?: string;
}
