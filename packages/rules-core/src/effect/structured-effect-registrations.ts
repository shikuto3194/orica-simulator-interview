import { getChoiceLabelForAction, localizeEffectLabel } from "./action-display";
import { deriveEffectAspectForImmunity } from "./effect-aspect";
/**
 * CardDefinition.effects (DSL) から各種効果登録を自動生成する。
 * これにより、effects フィールドを追加するだけで GUI 上で効果が自動発火する。
 */
import type {
  CardDefinition,
  CardBackFace,
  Timing,
  Condition,
  EffectReevaluationPoint,
  SuppressionEffectDescriptor,
} from "../model";
import type {
  Effect,
  EffectStep,
  EffectStepRepeat,
  Action,
  TargetSpec,
  CountBound,
  DynamicCount,
  ApplicabilityZone,
} from "../dsl-types";
import type {
  RegisteredTriggeredEffectAction,
  RegisteredBurstAction,
} from "./trigger-system";
import { triggerEventKindToStructuredEvent } from "./trigger-system";
import type { RegisteredBattleImmediateEffectAction } from "../battle/battle-immediate-effect-system";
import type { EffectFilterTag } from "../state-based-actions";
import type {
  LegalActionTargetPlayerScope,
  RegisteredFieldCardEffectAction,
  RegisteredHandActivatedEffectAction,
  RegisteredMagicAction,
  RegisteredTargetedEffectActionBase,
} from "../legal/legal-actions-types";
import {
  getEffectDescriptorSourceKindForPrintedCategory,
  getEffectRegistrationSourceKindForPrintedCategory,
} from "../source-kinds";
import { buildPendingStepPrompt } from "./effect-step-prompt";
import type {
  Zone,
  TriggerEventKind,
  TriggerEventCause,
  BattleImmediateEffectTiming,
  EffectActivationTiming,
  EffectUsageLimit,
  StructuredTriggerEventFamily,
} from "../model";
import type { UsageLimit } from "../dsl-types";
import { derivePreventionProfile } from "../legal/legal-actions-shared";
import {
  BULLET_EDIT_ROLE_TAG,
  isTextRoleUnderHeaderLine,
  type TextRoleUnderSourceRole,
} from "../mechanics/star-garment-utils";
import { isQuartzSetHeaderLine } from "../mechanics/quartz-system";
import { isMagicCompatibleDefinition } from "../card/card-filter";
import {
  deriveEffectLabelsFromTextRefs,
  deriveTriggerPhrasesFromTextRefs,
} from "./effect-label-utils";

/**
 * TriggerEventKind ごとのメタ情報。
 * `CARD_EVENT_TO_TRIGGER` / `EVENT_KIND_TO_FAMILY` の **単一正源** (P3-70 D)。
 * 以前は両マップを別々に手で同期していたが、ここから導出することで
 * 「1 種別追加 → 複数マップ手動同期」を解消した。
 */
interface TriggerEventMeta {
  /**
   * card_event / game_event の DSL `event` 文字列としても使えるか。
   * 現状 DSL の event 文字列は TriggerEventKind 名と一致するため、
   * true の kind はその名前自身が card_event トリガーになる。
   */
  cardEvent?: boolean;
  /** eventMatcher 生成用 family。family を持たない kind は省略。 */
  family?: StructuredTriggerEventFamily;
}

/**
 * Record（Partial ではない）なので、TriggerEventKind に値を追加すると
 * ここへの追記がコンパイル時に強制される（網羅性ガード）。
 */
const TRIGGER_EVENT_META: Record<TriggerEventKind, TriggerEventMeta> = {
  game_start: { cardEvent: true, family: "game_start" },
  // 「(自分/相手によって)ライフが減ったとき」。player 値イベント (count_increase/
  // count_decrease 同様) → game_event(player) で使う。cause で self/opponent を絞る
  // (BSTH02.7-TX01(A) 等「相手によって自分のライフが減ったとき」)。
  reduce_life: { cardEvent: true, family: "life" },
  destroy: { cardEvent: true, family: "leave_field" },
  // 「消滅したとき」を card_event トリガーとして使えるようにする（DSL event:"vanish"）。
  // family=leave_field で causeKind="vanish" の eventMatcher を生成し、destroy とは別系統で
  // 発火する。cause 絞り込み（「自分による消滅では発揮されない」）と併用可。
  vanish: { cardEvent: true, family: "leave_field" },
  bounce: { cardEvent: true, family: "leave_field" },
  remove_from_game: { cardEvent: true, family: "leave_field" },
  leave_field: { cardEvent: true, family: "leave_field" },
  summon: { cardEvent: true, family: "enter_field" },
  place: { cardEvent: true, family: "enter_field" },
  put: { cardEvent: true, family: "enter_field" },
  // 「手札が増えたとき」。player 値イベント → game_event(player) で使う。
  increase_hand: { cardEvent: true, family: "hand_increase" },
  start_step: {},
  end_step: {},
  exhaust: { cardEvent: true, family: "state_change" },
  recover: { cardEvent: true, family: "state_change" },
  advent: { cardEvent: true, family: "enter_field" },
  rebirth: { cardEvent: true, family: "state_change" },
  after_draw: { cardEvent: true, family: "after_draw" },
  pre_declaration_attack: { cardEvent: true, family: "declaration_timing" },
  pre_declaration_block: { cardEvent: true, family: "declaration_timing" },
  after_cost_paid: { cardEvent: true, family: "payment_timing" },
  flash: { cardEvent: true, family: "flash_use" },
  // ENGINE-stack-activation-reactivation-trigger: 相手のスタック効果 (mode:"stack") が
  // 完全解決した後 (BSTH02.7-X01 effects[2])。flash と異なり発揮後に反応する。
  stack: { cardEvent: true, family: "stack_use" },
  effect_declaration: { cardEvent: true, family: "effect_declaration" },
  targeted: { cardEvent: true, family: "targeting" },
  battle_end: { cardEvent: true, family: "battle_end" },
  battle_destroy_opponent_only: {
    cardEvent: true,
    family: "battle_destroy_opponent_only",
  },
  // カウント増加。game_event(player) で「(自分の)カウントが増えたとき」を表現するため
  // cardEvent:true で CARD_EVENT_TO_TRIGGER に載せる（card_event 自己一致では拾えない点は
  // model.ts CardEventType のコメント参照）。
  count_increase: { cardEvent: true, family: "count_increase" },
  // カウント減少。count_increase と同様 game_event(player) で「カウントが減ったとき」を表現する。
  count_decrease: { cardEvent: true, family: "count_decrease" },
  // P3-14 C-2: アタック/ブロック宣言成立後。**cardEvent は付けない** —
  // card_event:"attack"/"block" (自カードの『アタック時/ブロック時』) は battle immediate
  // 系 (CARD_EVENT_TO_BATTLE_IMMEDIATE) で処理され、ここに載せると同一効果が
  // triggered と battle immediate の二重発火になる。game_event 観測専用の対応付けは
  // GAME_EVENT_ONLY_TRIGGER (resolveTriggerEvents) 側で行う。
  attack: { family: "battle_declaration" },
  block: { family: "battle_declaration" },
  // P3-14 C-2: 合体成立 (「合体したとき」)。card_event = ブレイヴ自身 / game_event = 観測。
  brave_combined: { cardEvent: true, family: "brave_link" },
  // P3-14 C-2: ライフへのコア配置。player 値イベント → game_event で使う (count_increase 同様)。
  trash_increase: { cardEvent: true, family: "trash_change" },
  core_placed_on_life: { cardEvent: true, family: "core_change" },
  // ENGINE-c09-text-role-under-card-third-party-trigger: text_role アンダーカード実配置
  // (【アルドノアドライブ】等)。第三者観測 game_event 用 (BSAZ02-C09)。
  text_role_under_card_placed: {
    cardEvent: true,
    family: "under_card_change",
  },
  // ENGINE-void-core-decrease-trigger: ボイドのコア減少。player 値イベント →
  // game_event(player) で使う (count_increase 同様)。
  void_core_decrease: { cardEvent: true, family: "void_core_change" },
  // ENGINE-soul-drive-activation-observable-event (P3-125): 【ソウルドライブ・S】発動。
  // player 値イベント → game_event(player) で使う (quartz_set 同様)。
  soul_drive_activated: { cardEvent: true, family: "soul_drive_activation" },
  // F2: 魂状態化 / 魂状態からスピリット状態化 (card_event 自己誘発)。
  enter_soul_state: { cardEvent: true, family: "soul_state_change" },
  soul_state_to_spirit_state: {
    cardEvent: true,
    family: "soul_state_change",
  },
  quartz_set: { cardEvent: true, family: "quartz_set" },
  // ENGINE-mirage-set-card-event-trigger: ミラージュセット (card_event 自己誘発、
  // enter_soul_state 同様)。BSTH002-C04「このカードのセット時」。
  mirage_set: { cardEvent: true, family: "mirage_set" },
  // ENGINE-field-hand-swap-trigger: 【聖詠】フィールド⇄手札入れ替え成立。card_event =
  // 入れ替えで場に入ったカード自身 (BSSG01-C03/C04) / game_event(player) = 聖詠を発揮した
  // 本人を観測 (BSSG01-C05)。brave_combined と同型 (単一 eventKind を両用)。
  field_hand_swap: { cardEvent: true, family: "field_hand_swap" },
  // P3-92: エンジン機構由来の誘発任意効果 (mechanic 付き pending 専用)。
  // カード効果の card_event / eventMatcher としては使わないため両フラグなし。
  oracle: {},
  placement_oracle: {},
  unseal: {},
  stone_rebirth: {},
  magic_stack_domain: {},
  granted_effect: {},
  attack_declared: { family: "action_declared" },
  // ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A)): 「(自分の)カードが
  // 任意の効果を発揮したとき」。BurstEventKind の effect_activated と同じ family を共有
  // (wildcard matcher、actionKind 不問)。
  effect_activated: { cardEvent: true, family: "effect_activation" },
  effect_steps_resolved: { cardEvent: true, family: "effect_steps_resolved" },
  effect_completed: { cardEvent: true, family: "effect_completed" },
  card_used: { cardEvent: true, family: "card_used" },
};

/**
 * P3-14 C-2: game_event 限定で TriggerEventKind に解決する DSL event 文字列。
 * attack / block は card_event では battle immediate 系で処理されるため
 * CARD_EVENT_TO_TRIGGER に載せず、game_event 観測（「〜がアタック/ブロックしたとき」）
 * のみ triggered registration を生成する。
 */
const GAME_EVENT_ONLY_TRIGGER: Partial<Record<string, TriggerEventKind>> = {
  attack: "attack",
  block: "block",
};

/** TriggerEventKind → StructuredTriggerEventFamily（eventMatcher 生成用）。META から導出。 */
const EVENT_KIND_TO_FAMILY: Partial<
  Record<TriggerEventKind, StructuredTriggerEventFamily>
> = {};
/**
 * card_event / game_event の DSL event 文字列 → TriggerEventKind。META から導出。
 * card_event / game_event 系のみ。activated/burst/continuous は別系統。
 */
const CARD_EVENT_TO_TRIGGER: Partial<Record<string, TriggerEventKind>> = {};
for (const [kind, meta] of Object.entries(TRIGGER_EVENT_META) as [
  TriggerEventKind,
  TriggerEventMeta,
][]) {
  if (meta.family) EVENT_KIND_TO_FAMILY[kind] = meta.family;
  if (meta.cardEvent) CARD_EVENT_TO_TRIGGER[kind] = kind;
}

/** UsageLimit | UsageLimit[] を EffectUsageLimit spread 用オブジェクトに変換。 */
function spreadUsageLimit(
  limit: UsageLimit | UsageLimit[] | undefined
):
  | { usageLimit: EffectUsageLimit | EffectUsageLimit[] }
  | Record<string, never> {
  if (!limit) return {};
  if (Array.isArray(limit)) {
    if (limit.length === 0) return {};
    if (limit.length === 1) return { usageLimit: limit[0] as EffectUsageLimit };
    return { usageLimit: limit as EffectUsageLimit[] };
  }
  return { usageLimit: limit as EffectUsageLimit };
}

/**
 * battle-immediate は宣言前に action を提示するため、分岐・反復を持たない単一 step の
 * usageLimit を registration に伝播する。実行時の Effect interpreter と同一の
 * `__step:` ラベルで事前判定されるため、使用済み step の空 prompt を積まない。
 * choice/repeat は宣言時に一意の step action にならないため、既存の variant / runtime
 * 経路に委ねる。
 */
function spreadDeclarationStepUsage(effect: Effect):
  | {
      declarationStepUsage: {
        stepIndex: number;
        usageLimit: EffectUsageLimit | EffectUsageLimit[];
        usageGroupId?: string;
      };
    }
  | Record<string, never> {
  if (effect.steps.length !== 1) return {};
  const step = effect.steps[0];
  if (
    !step?.usageLimit ||
    (step.choice?.length ?? 0) > 0 ||
    step.repeat !== undefined
  ) {
    return {};
  }
  return {
    declarationStepUsage: {
      stepIndex: 0,
      usageLimit: step.usageLimit as EffectUsageLimit | EffectUsageLimit[],
      ...(step.usageGroupId ? { usageGroupId: step.usageGroupId } : {}),
    },
  };
}

/**
 * Effect.limitGroupId を registration spread 用オブジェクトに変換。
 * 異なる timing に分離された effect (例: 召喚時 + アタック時) が
 * 「ターンに1回」等の使用制限を共有するためのキー。
 */
function spreadLimitGroupId(
  limitGroupId: string | undefined
): { limitGroupId: string } | Record<string, never> {
  return limitGroupId ? { limitGroupId } : {};
}

function spreadOccurrenceGate(
  occurrenceGate: import("../model").EffectOccurrenceGate | undefined
):
  | { occurrenceGate: import("../model").EffectOccurrenceGate }
  | Record<string, never> {
  return occurrenceGate ? { occurrenceGate } : {};
}

/**
 * `Effect.occurrenceGate` (ENGINE-nth-occurrence-trigger-gate) の tally/gate 判定は
 * `generateTriggeredEffectRegistrations` (game_event/card_event 経路、trigger-system.ts
 * queueReactionsInternal) にのみ配線されている。他の登録経路
 * (hand_activated/burst/battle_immediate/field_card/magic) は occurrenceGate を一切
 * 見ないため、そちらの timing で occurrenceGate を指定すると「Nth 回目のみ発火」の
 * 意図が黙って無視され毎回発火するサイレントバグになる (adversarial verifier 指摘)。
 * 対応する登録経路への配線が無い間は、誤用を build 時に即座に検出して fail-loud する。
 */
function assertOccurrenceGateSupportedHere(
  definition: CardDefinition,
  effect: Effect,
  contextLabel: string
): void {
  if (effect.occurrenceGate === undefined) return;
  throw new Error(
    `Effect.occurrenceGate is not wired for ${contextLabel} registrations ` +
      `(card=${definition.cardNo}). occurrenceGate tally/gate is only supported via ` +
      `generateTriggeredEffectRegistrations (game_event/card_event timing, ` +
      `ENGINE-nth-occurrence-trigger-gate). Use game_event/card_event timing, or extend ` +
      `the occurrenceGate wiring for this registration path before using it here.`
  );
}

/**
 * Effect から `suppress_effect` の `effectFilter` 突き合わせ用記述子を導出する。
 * 「いま発揮されようとしている効果」を identify するため、効果登録 (registration)
 * 生成時にこの記述子を付与し、解決時に `ReevaluationConfig` 経由で
 * `runReevaluationAtTiming` → `matchesEffectTargetFilter` へ流す。
 *
 * - timingKind: `effect.timing.kind`
 * - heading:    `effect.heading`
 * - triggerPhrases: `effect.triggerPhrases`
 * - eventAction: `effect.timing.event`（`timing.kind === "card_event"` のときのみ）
 *   ただし複数 timing に分割した registration では実 registration の単一 event を渡す。
 * - keywords:   `effect.keywords`
 * - activatedMode: `effect.timing.mode`（`timing.kind === "activated"` のときのみ）
 */
/**
 * effect.steps (choice 分岐を含め再帰的に) に含まれる action.kind の集合を集める。
 * `SuppressionEffectDescriptor.containsActionKinds` の算出元 (SSOT)。
 */
function collectActionKinds(
  steps: readonly EffectStep[],
  out: Set<string>
): void {
  for (const step of steps) {
    out.add(step.action.kind);
    if (step.choice !== undefined) {
      collectActionKinds(step.choice, out);
    }
  }
}

export function deriveSuppressionEffectDescriptor(
  effect: Effect,
  overrides: {
    sourceDefinitionId?: string;
    sourceKind?: SuppressionEffectDescriptor["sourceKind"];
    eventAction?: SuppressionEffectDescriptor["eventAction"];
    effectIndex?: number;
    sourceTextLines?: readonly string[];
  } = {}
): SuppressionEffectDescriptor {
  const timing = effect.timing;
  const effectLabels = deriveEffectLabelsFromTextRefs(
    effect,
    overrides.sourceTextLines,
    overrides.eventAction
  );
  const triggerPhrases =
    effect.triggerPhrases ??
    deriveTriggerPhrasesFromTextRefs(effect, overrides.sourceTextLines);
  const hasActivationCondition =
    (effect.condition !== undefined && effect.condition.length > 0) ||
    effect.applicability?.level !== undefined;
  const actionKinds = new Set<string>();
  collectActionKinds(effect.steps, actionKinds);
  return {
    ...(overrides.sourceDefinitionId !== undefined
      ? { sourceDefinitionId: overrides.sourceDefinitionId }
      : {}),
    ...(overrides.sourceKind !== undefined
      ? { sourceKind: overrides.sourceKind }
      : {}),
    ...(overrides.effectIndex !== undefined
      ? { effectIndex: overrides.effectIndex }
      : {}),
    ...(effectLabels.length > 0 ? { effectLabels } : {}),
    timingKind: timing.kind,
    ...(effect.heading !== undefined ? { heading: effect.heading } : {}),
    ...(triggerPhrases !== undefined && triggerPhrases.length > 0
      ? { triggerPhrases }
      : {}),
    ...(overrides.eventAction !== undefined
      ? { eventAction: overrides.eventAction }
      : timing.kind === "card_event"
        ? { eventAction: timing.event }
        : {}),
    ...(effect.keywords !== undefined ? { keywords: effect.keywords } : {}),
    ...(actionKinds.size > 0
      ? { containsActionKinds: Array.from(actionKinds) }
      : {}),
    ...(timing.kind === "activated" ? { activatedMode: timing.mode } : {}),
    ...(effect.activationLabel !== undefined
      ? { activationLabel: effect.activationLabel }
      : {}),
    ...(timing.kind === "continuous" && hasActivationCondition
      ? { activationCondition: "present" as const }
      : {}),
    ...(timing.kind === "continuous" &&
    (effect.applicability !== undefined || effect.timingScope !== undefined)
      ? { activationLocation: "present" as const }
      : {}),
  };
}

const EFFECT_SUPPRESSION_REEVALUATION_POINTS: readonly EffectReevaluationPoint[] =
  [
    {
      timing: "before_each_step",
      checks: ["effect_suppression"],
      failurePolicy: "abort_remaining",
    },
  ];

/** registration push 用に suppressionEffectDescriptor を spread オブジェクト化。 */
function spreadSuppressionEffectDescriptor(
  effect: Effect,
  overrides?: {
    sourceDefinitionId?: string;
    sourceKind?: SuppressionEffectDescriptor["sourceKind"];
    eventAction?: SuppressionEffectDescriptor["eventAction"];
    effectIndex?: number;
    sourceTextLines?: readonly string[];
  }
): {
  suppressionEffectDescriptor: SuppressionEffectDescriptor;
  reevaluationPoints: readonly EffectReevaluationPoint[];
} {
  return {
    suppressionEffectDescriptor: deriveSuppressionEffectDescriptor(
      effect,
      overrides
    ),
    reevaluationPoints: EFFECT_SUPPRESSION_REEVALUATION_POINTS,
  };
}

/**
 * registration push 用に `Effect.preventionLevel`（「相手の効果では防げない」）を
 * spread オブジェクト化する（未指定は空）。getEffectPreventionLevel が候補列挙・
 * deferred stack の sourcePreventionLevel を駆動する producer。P3-43。
 *
 * 限定的防止不可 `preventionRestriction`（「○○の効果では防げない」）は
 * `targetLockBypass`/`sourcePreventionBypass` として scoped に伝播する。明示
 * `preventionLevel` が優先。
 */
function spreadPreventionLevel(effect: Effect):
  | {
      preventionLevel?: import("../model").EffectPreventionLevel;
      targetLockBypass?: import("./target-affect-gate").TargetLockBypassProfile;
    }
  | Record<string, never> {
  const profile = derivePreventionProfile(effect);
  if (profile === undefined) return {};
  return {
    ...(profile.resistance !== "none"
      ? { preventionLevel: profile.resistance }
      : {}),
    targetLockBypass: profile.targetLockBypass,
  };
}

const HAND_SUMMON_PERMISSION_ZONES: ReadonlySet<ApplicabilityZone> = new Set([
  "hand",
  "set_aside",
  "trash",
  "advent_source",
  "soul_state",
]);

// 手札起動効果 (use_hand_card_effect) のソースが存在してよいゾーン。summon 特化ではない
// 汎用 activated 効果向け（「トラッシュにあるこのカードは、フラッシュタイミングで
// 自分のカウント-1することで手札に戻る」BSGE01-M01〜M04 等、engine-trash-zone-flash-
// activated-recovery）。summon permission 側の HAND_SUMMON_PERMISSION_ZONES とは別物。
// legal-actions-availability.ts の getAvailableHandActivatedEffectLegalActions が
// getCardsByZone(native Zone) でソースカードを列挙する際もこの配列を SSOT として
// 参照する（"hand"/"set_aside"/"trash" は Zone と ApplicabilityZone 両方の有効な値）。
export const HAND_ACTIVATED_EFFECT_ZONES: readonly (Zone &
  ApplicabilityZone)[] = ["hand", "set_aside", "trash"];
const HAND_ACTIVATED_APPLICABILITY_ZONE_SET: ReadonlySet<ApplicabilityZone> =
  new Set([...HAND_ACTIVATED_EFFECT_ZONES, "advent_source", "soul_state"]);

/**
 * 手札起動効果 (generateHandActivatedEffectRegistrations) のソースとして意味を持つ
 * zone 宣言か。isMagicUsableApplicabilityZone と
 * 同型の SSOT ヘルパー（テスト側の期待値計算が本体の zone gate と乖離しないよう export）。
 */
export function isHandActivatedApplicabilityZone(
  zone: ApplicabilityZone | readonly ApplicabilityZone[]
): boolean {
  const zones = Array.isArray(zone) ? zone : [zone];
  return zones.some((z) => HAND_ACTIVATED_APPLICABILITY_ZONE_SET.has(z));
}

export function isHandActivatedOnlyApplicabilityZone(
  zone: ApplicabilityZone | readonly ApplicabilityZone[]
): boolean {
  const zones = Array.isArray(zone) ? zone : [zone];
  return (
    zones.length > 0 &&
    zones.every((z) => HAND_ACTIVATED_APPLICABILITY_ZONE_SET.has(z))
  );
}

/**
 * 通常の召喚/配置行動を許可する常時効果のスペックを返す。
 * `SummonAction.normalActionPermission:true` の明示宣言だけを判定根拠とし、
 * activated/main、先頭 step が summon、カード文言などからは推測しない。
 * 即時型の「召喚/配置できる」は hand-activated 効果として発揮宣言されるため、
 * ここでは返さない。
 * 許可効果でなければ undefined。`fixedPayment` が数値なら固定支払い、
 * `baseCostOverride` が数値なら総コスト上書き後に軽減適用、両方 null なら
 * 通常コスト(軽減適用)召喚を表す。
 * `applicability.zone` は "hand" / "set_aside" / "trash" / "advent_source" / "soul_state" の単一値
 * または配列を許容する（「手札/手元にあるこのカードは召喚できる」= BSES01 ブレイヴ等。
 * "trash" は engine-alt-cost-summon-multizone で追加 = 「手札/トラッシュにあるこのカードは
 * …召喚できる」BSFT01-X01 effects[2] 型。"advent_source" は
 * engine-advent-source-summon-permission で追加 = 「…煌臨元にあるこのカードは、召喚できる」
 * BSSL01-X03 effects[2,3] 型）。
 */
export function getHandSummonPermissionSpec(effect: Effect):
  | {
      fixedPayment: number | null;
      baseCostOverride: number | null;
      onBoardCoreSourceFilter?: import("../dsl-types").CardFilter;
      /**
       * `costModifier:"full_reduction"`（「軽減シンボルすべてを満たして召喚できる」型、
       * BSTH11-X03/X04[0,1]）。呼び出し側 (legal-actions-availability.ts) が
       * `calculateFullReductionSummonCost`（SSOT、BSAZ02-C08 declaredAltCostGrant.
       * fullReduction 分岐と同一関数）で実額を算出し、`fixedPayment` 相当（symbol 軽減を
       * 経由せずその額をそのまま最終コストとする）として扱う。この関数自体は state を
       * 受け取らないため実額計算は呼び出し側に委譲する。
       */
      requiresFullReductionCost?: true;
      /** 通常行動の宣言時、stack window より前に実行する step 群。 */
      declarationSteps?: readonly EffectStep[];
    }
  | undefined {
  if (effect.timing.kind !== "continuous") return undefined;
  const zone = effect.applicability?.zone;
  const zones = zone === undefined ? [] : Array.isArray(zone) ? zone : [zone];
  if (!zones.some((z) => HAND_SUMMON_PERMISSION_ZONES.has(z))) return undefined;
  const permissionActions = effect.steps
    .map((step) => step.action)
    .filter(
      (action): action is Extract<Action, { kind: "summon" }> =>
        action.kind === "summon" && action.normalActionPermission === true
    );
  if (permissionActions.length !== 1) return undefined;

  const action = permissionActions[0]!;
  if (action.target.kind !== "self") return undefined;

  const costModifier = action.costModifier;
  const declarationSteps =
    action.normalActionDeclarationSteps !== undefined
      ? { declarationSteps: action.normalActionDeclarationSteps }
      : {};
  const sourceFilter =
    action.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
      : {};
  if (costModifier === undefined) {
    // costModifier 無し = 通常コスト(軽減適用)で召喚（「召喚できる」）。
    return {
      fixedPayment: null,
      baseCostOverride: null,
      ...sourceFilter,
      ...declarationSteps,
    };
  }
  if (costModifier === "free") {
    return {
      fixedPayment: 0,
      baseCostOverride: null,
      ...sourceFilter,
      ...declarationSteps,
    };
  }
  if (costModifier === "full_reduction") {
    return {
      fixedPayment: null,
      baseCostOverride: null,
      requiresFullReductionCost: true,
      ...sourceFilter,
      ...declarationSteps,
    };
  }
  if (typeof costModifier !== "object") {
    return undefined;
  }
  if ("fixedPayment" in costModifier) {
    return Number.isInteger(costModifier.fixedPayment) &&
      costModifier.fixedPayment >= 0
      ? {
          fixedPayment: costModifier.fixedPayment,
          baseCostOverride: null,
          ...sourceFilter,
          ...declarationSteps,
        }
      : undefined;
  }
  if ("override" in costModifier) {
    return Number.isInteger(costModifier.override) && costModifier.override >= 0
      ? {
          fixedPayment: null,
          baseCostOverride: costModifier.override,
          ...sourceFilter,
          ...declarationSteps,
        }
      : undefined;
  }
  return undefined;
}

/**
 * Q54 通常行動の宣言時 step が要求する対象選択を、既存の効果対象 SSOT から導出する。
 * カード固有の対象列挙を持たず、通常の legal action と同じ filter / affect gate を使う。
 */
export function getNormalActionDeclarationTargetingMetadata(
  effect: Effect,
  declarationSteps: readonly EffectStep[]
): RegisteredTargetedEffectActionBase {
  return extractFieldTargetingMetadata({
    ...effect,
    steps: [...declarationSteps],
  });
}

export function isHandSummonPermissionEffect(effect: Effect): boolean {
  return getHandSummonPermissionSpec(effect) !== undefined;
}

const PHASE_STEP_TO_TRIGGER: Partial<Record<string, TriggerEventKind>> = {
  start: "start_step",
  core: "start_step",
  draw: "start_step",
  refresh: "start_step",
  main: "start_step",
  attack: "start_step",
  end: "end_step",
};

/**
 * Timing → BattleImmediateEffectTiming マッピング。
 */
const CARD_EVENT_TO_BATTLE_IMMEDIATE: Partial<
  Record<string, BattleImmediateEffectTiming>
> = {
  attack: "attack",
  block: "block",
};

/** Timing から TriggerEventKind をすべて解決（配列イベント対応）。 */
export function resolveTriggerEvents(timing: Timing): TriggerEventKind[] {
  if (timing.kind === "game_event" && timing.beforeCost) return [];
  if (timing.kind === "card_event") {
    const events = Array.isArray(timing.event) ? timing.event : [timing.event];
    return events
      .map((ev) => CARD_EVENT_TO_TRIGGER[ev])
      .filter((x): x is TriggerEventKind => !!x);
  }
  if (timing.kind === "game_event") {
    const events = Array.isArray(timing.event) ? timing.event : [timing.event];
    return events
      .map((ev) => CARD_EVENT_TO_TRIGGER[ev] ?? GAME_EVENT_ONLY_TRIGGER[ev])
      .filter((x): x is TriggerEventKind => !!x);
  }
  if (timing.kind === "phase") {
    if (timing.step === undefined) {
      return timing.subPhase === "end"
        ? ["start_step", "end_step"]
        : ["start_step"];
    }
    const result = PHASE_STEP_TO_TRIGGER[timing.step];
    return result ? [result] : [];
  }
  return [];
}

/** Timing から BattleImmediateEffectTiming をすべて解決（配列イベント対応）。 */
function resolveBattleTimings(timing: Timing): BattleImmediateEffectTiming[] {
  if (timing.kind === "card_event") {
    const events = Array.isArray(timing.event) ? timing.event : [timing.event];
    return events
      .map((ev) => CARD_EVENT_TO_BATTLE_IMMEDIATE[ev])
      .filter((x): x is BattleImmediateEffectTiming => !!x);
  }
  return [];
}

/**
 * text_role アンダーカード（星霊衣/バレットエディット等、roleTag 不問）が host に
 * 与える効果かどうかを判定し、対応する registration の requiredSourceRole を推論する。
 * マーカー判定は `isTextRoleUnderHeaderLine` (SSOT) を経由し、
 * continuous-effect-rebuild.ts の同種判定と一致させる。
 */
function inferRequiredTextRoleUnderSourceRole(
  definition: CardDefinition,
  effect: Effect
): { requiredSourceRole?: TextRoleUnderSourceRole } {
  const textLines = effect.textRef
    ?.map((lineIndex) => definition.textLines[lineIndex])
    .filter((line): line is string => line !== undefined);
  if (textLines?.some(isTextRoleUnderHeaderLine)) {
    return { requiredSourceRole: "text_role_under" };
  }
  return {};
}

/**
 * 効果の textRef が【クォーツ：...】ヘッダー行を含むかどうかを判定し、対応する
 * registration の requiredSourceRole を推論する（ENGINE-quartz-host-identity-propagation）。
 * マーカー判定は `isQuartzSetHeaderLine` (SSOT) を経由する。text_role_under と同型のパターン
 * だが、クォーツの host 継承発揮は host 固有の印字能力 (`quartzHostData.inheritsSetQuartzEffects`)
 * が要る点が star garment (全 host 共通則) と異なる (qa-030)。
 */
function inferRequiredQuartzInheritedSourceRole(
  definition: CardDefinition,
  effect: Effect
): { requiredSourceRole?: TextRoleUnderSourceRole } {
  const textLines = effect.textRef
    ?.map((lineIndex) => definition.textLines[lineIndex])
    .filter((line): line is string => line !== undefined);
  if (textLines?.some(isQuartzSetHeaderLine)) {
    return { requiredSourceRole: "quartz_inherited" };
  }
  return {};
}

/**
 * ブレイヴの【合体中】テキストは合体先 host が発揮主体になる。
 * 一方、【合体中】を持たない「召喚時」等はブレイヴ自身の効果として扱うため、
 * marker のあるブレイヴ effect だけを combined_brave source role に寄せる。
 */
function inferRequiredCombinedBraveSourceRole(
  definition: CardDefinition,
  effect: Effect
): { requiredSourceRole?: TextRoleUnderSourceRole } {
  // 同じ本文行に未合体時の効果と合体中の別効果がある場合、DSLの適用条件を優先する。
  if (
    definition.printedCategory !== "brave" ||
    effect.applicability?.combined === false
  )
    return {};
  const textLines = effect.textRef
    ?.map((lineIndex) => definition.textLines[lineIndex])
    .filter((line): line is string => line !== undefined);
  if (
    textLines?.some(
      (line) =>
        line.includes("【合体中】") ||
        line.includes("【左右合体中】") ||
        line.includes("合体しているこのブレイヴ")
    )
  ) {
    return { requiredSourceRole: "combined_brave" };
  }
  return {};
}

/**
 * ダブルフェイスカードの裏面 (backFace) を「裏面 cardNo をキーに持つ独立 CardDefinition」へ
 * 合成する。
 *
 * 転醒 (executeRebirth) は instance の definitionId を backFace.cardNo へ swap する
 * (structured-effect-interpreter.ts)。しかし ALL_CARDS / 各カードファイルは表面 (top-level)
 * のみを公開しており、定義ルックアップ・効果レジストリは表面 cardNo でしかキーを張らない。
 * そのため転醒後の instance について getCardDefinitionById(backFaceCardNo) が undefined を返し、
 * 裏面の card_event:"rebirth"（『転醒時』）効果が **解決もレジストリ登録もされない**。
 *
 * この関数で表面定義を再帰展開し、backFace を持つ各カードについて裏面の合成 CardDefinition を
 * 1 件追加する。これを定義ルックアップ・全レジストリビルダー双方へ同じ配列として渡すことで、
 * 「裏面 cardNo → 裏面定義」と「裏面 cardNo → 裏面効果レジストリ」を **単一正源 (SSOT)** から
 * 一貫させる（展開ロジックをルックアップ側とレジストリ側に二重実装しない）。
 *
 * 注意（デッキ構築プールとの分離）:
 * - 裏面は**個別にデッキへ入れられるカードではない**（表面とセットで 1 枚）。本関数の出力は
 *   定義解決 + 効果登録のための内部プール専用で、ALL_CARDS（= デッキ構築・cards:coverage が
 *   列挙する公開プール）には決して混ぜない。呼び出し側は ALL_CARDS をそのまま据え置き、
 *   この展開版はサーバの effect lookup / definition lookup 構築にのみ使う。
 */
export function synthesizeBackFaceDefinition(
  front: CardDefinition,
  back: CardBackFace
): CardDefinition {
  return {
    // 裏面 cardNo は必須。欠落時は executeRebirth と同じフォールバック規約に合わせる。
    cardNo: back.cardNo ?? `${front.cardNo}_back`,
    name: back.name,
    printedCategory: back.printedCategory,
    colors: back.colors,
    cost: back.cost,
    reductionSymbols: back.reductionSymbols,
    levelDefs: back.levelDefs,
    ...(back.overCount ? { overCount: back.overCount } : {}),
    ...(back.printedOverCount
      ? { printedOverCount: back.printedOverCount }
      : {}),
    symbolColors: back.symbolColors,
    ...(back.symbolColorEntries
      ? { symbolColorEntries: back.symbolColorEntries }
      : {}),
    textLines: back.textLines,
    keywordTags: back.keywordTags,
    ...(back.tribe !== undefined ? { tribe: back.tribe } : {}),
    ...(back.image !== undefined ? { image: back.image } : {}),
    ...(back.rarity !== undefined ? { rarity: back.rarity } : {}),
    ...(back.pack !== undefined ? { pack: back.pack } : {}),
    // B 面ブレイヴの合体条件（創界石の転醒後合体で getValidBraveCombineHosts が参照）
    ...(back.braveCondition !== undefined
      ? { braveCondition: back.braveCondition }
      : {}),
    ...(back.allowMainStepBraveCombine !== undefined
      ? { allowMainStepBraveCombine: back.allowMainStepBraveCombine }
      : {}),
    ...(back.additionalBraveSlot !== undefined
      ? { additionalBraveSlot: back.additionalBraveSlot }
      : {}),
    // 異魔神の左右合体・疲労/攻防禁止をGUI/APIの展開定義でも維持する。
    ...(back.imaginBraveData !== undefined
      ? { imaginBraveData: back.imaginBraveData }
      : {}),
    // B 面ブレイヴの『BP＋』値（合体時 getCombinedUnitBp が参照）
    ...(back.combinedBoost !== undefined
      ? { combinedBoost: back.combinedBoost }
      : {}),
    // B 面の text_role アンダーカード枠宣言（getEffectiveUnderCardSlots 等 host 定義側 SSOT が参照）
    ...(back.underCardSlots !== undefined
      ? { underCardSlots: back.underCardSlots }
      : {}),
    ...(back.quartzData !== undefined ? { quartzData: back.quartzData } : {}),
    ...(back.effects ? { effects: back.effects } : {}),
    // 表面のソース帰属を引き継ぐ（裏面は独立ソースを持たない）。
    sourceUrls: front.sourceUrls,
    sourceConfidence: front.sourceConfidence,
  };
}

/**
 * 表面定義の配列を、各 backFace の合成定義を末尾に加えた配列へ展開する（SSOT）。
 *
 * 定義ルックアップ・全効果レジストリビルダーへ **同一の展開済み配列** を渡すための入口。
 * 入力は表面のみ（= ALL_CARDS）。出力 = 入力 + backFace 合成定義。入力配列は変更しない。
 * 既存 cardNo と衝突する裏面 cardNo は追加しない（表面定義を優先し silent shadowing を防ぐ）。
 */
export function expandCardDefinitionsWithBackFaces(
  definitions: readonly CardDefinition[]
): CardDefinition[] {
  const expanded: CardDefinition[] = [...definitions];
  const seen = new Set(definitions.map((d) => d.cardNo));
  for (const def of definitions) {
    if (!def.backFace) continue;
    const synthesized = synthesizeBackFaceDefinition(def, def.backFace);
    if (seen.has(synthesized.cardNo)) continue;
    seen.add(synthesized.cardNo);
    expanded.push(synthesized);
  }
  return expanded;
}

/**
 * 全カード定義から一括で TriggeredEffectActionRegistrationLookup を構築。
 */
export function buildTriggeredEffectLookup(
  definitions: readonly CardDefinition[]
): (cardNo: string) => readonly RegisteredTriggeredEffectAction[] | undefined {
  const map = new Map<string, readonly RegisteredTriggeredEffectAction[]>();
  for (const def of definitions) {
    const regs = generateTriggeredEffectRegistrations(def);
    if (regs.length > 0) {
      map.set(def.cardNo, regs);
    }
  }
  return (cardNo) => map.get(cardNo);
}

/**
 * 全カード定義から一括で BattleImmediateEffectActionRegistrationLookup を構築。
 */
export function buildBattleImmediateEffectLookup(
  definitions: readonly CardDefinition[]
): (
  cardNo: string
) => readonly RegisteredBattleImmediateEffectAction[] | undefined {
  const map = new Map<
    string,
    readonly RegisteredBattleImmediateEffectAction[]
  >();
  for (const def of definitions) {
    const regs = generateBattleImmediateEffectRegistrations(def);
    if (regs.length > 0) {
      map.set(def.cardNo, regs);
    }
  }
  return (cardNo) => map.get(cardNo);
}

/**
 * 全カード定義から一括で FieldCardEffectActionRegistrationLookup を構築。
 */
export function buildFieldCardEffectLookup(
  definitions: readonly CardDefinition[]
): (cardNo: string) => readonly RegisteredFieldCardEffectAction[] | undefined {
  const map = new Map<string, readonly RegisteredFieldCardEffectAction[]>();
  for (const def of definitions) {
    const regs = generateFieldCardEffectRegistrations(def);
    if (regs.length > 0) {
      map.set(def.cardNo, regs);
    }
  }
  return (cardNo) => map.get(cardNo);
}

/**
 * 全カード定義から一括で MagicActionRegistrationLookup を構築。
 */
export function buildMagicLookup(
  definitions: readonly CardDefinition[]
): (cardNo: string) => readonly RegisteredMagicAction[] | undefined {
  const map = new Map<string, readonly RegisteredMagicAction[]>();
  for (const def of definitions) {
    const regs = generateMagicRegistrations(def);
    if (regs.length > 0) {
      map.set(def.cardNo, regs);
    }
  }
  return (cardNo) => map.get(cardNo);
}

/**
 * effects から RegisteredHandActivatedEffectAction[] を自動生成する。
 * `timing.kind === "activated"` かつ `applicability.zone === "hand" | "set_aside"` の効果を
 * 「プレイヤーが非フィールド公開前ゾーンから能動的に起動する効果」として登録する。
 * （「手札にあるこのカードは…『自分のスタートステップ』に…召喚できる」= BSTH01-M01 等）
 */
export function generateHandActivatedEffectRegistrations(
  definition: CardDefinition
): readonly RegisteredHandActivatedEffectAction[] {
  if (!definition.effects || definition.effects.length === 0) return [];
  // magic / magic_compatible の activated 効果は generateMagicRegistrations が
  // hand/set_aside/trash を含めて一元的に登録する (isMagicUsableApplicabilityZone、
  // engine-magic-trash-use-permission)。trash zone を hand-activated 側にも許可すると
  // BSDB01-R03 のような magic の trash 使用許可効果が use_magic と use_hand_card_effect の
  // 2 経路へ二重登録され、usageLimit の per_card_name/turn カウンタが別キー
  // (`magic` / `hand_activated:${index}`) で独立して回るため同一ターンに2回発火しうる
  // (adversarial verifier 2026-07-13 refute)。SSOT として generateMagicRegistrations に
  // 一元化し、ここでは magic 系定義そのものを対象外にする。
  if (
    definition.printedCategory === "magic" ||
    isMagicCompatibleDefinition(definition)
  )
    return [];

  const registrations: RegisteredHandActivatedEffectAction[] = [];

  for (const [effectIndex, effect] of definition.effects.entries()) {
    if (effect.timing.kind !== "activated") continue;
    if (
      effect.applicability?.zone === undefined ||
      !isHandActivatedApplicabilityZone(effect.applicability.zone)
    )
      continue;
    // 純 stub (steps 空 かつ stub 注記あり) は registration を生成しない
    // (generateMagicRegistrations の skip と整合。BSDB01-C09 effects[0] 等、
    // trash zone gate 拡張で新たに zone 条件は満たすが未実装のスタック起動 stub)。
    if (effect.steps.length === 0 && effect.stub) continue;
    if (isHandSummonPermissionEffect(effect)) continue;
    // 魂状態化（enter_soul_state）の起動効果は activate_soul_state legal action 専用で
    // 処理する。汎用 hand-activated（summon 特化解決）に載せると二重表示＋誤動作する。
    if (effect.steps.some((s) => s.action?.kind === "enter_soul_state"))
      continue;

    const choiceStepIndex = getDeclarationChoiceStepIndex(effect);
    const choiceStep =
      choiceStepIndex >= 0 ? effect.steps[choiceStepIndex] : undefined;
    const optionalRepeatStepIndex = findOptionalRepeatStepIndex(effect);
    const optionalRepeatStep =
      optionalRepeatStepIndex >= 0
        ? effect.steps[optionalRepeatStepIndex]
        : undefined;
    const mode = effect.timing.mode;
    if (mode !== "main" && mode !== "flash" && mode !== "stack") continue;
    const effectUsageLimit = effect.usageLimit ?? choiceStep?.usageLimit;
    const fieldTargetingMetadata = extractFieldTargetingMetadata(effect);
    const optionalRepeatBaseTargetingMetadata =
      optionalRepeatStep !== undefined
        ? buildOptionalRepeatBaseTargetingMetadata(
            effect,
            optionalRepeatStepIndex,
            fieldTargetingMetadata
          )
        : undefined;
    const targetingOrChoices = choiceStep
      ? {
          choices: buildChoiceVariantsWithSharedTargeting(
            effect,
            choiceStepIndex
          ),
        }
      : optionalRepeatStep
        ? {
            ...optionalRepeatBaseTargetingMetadata,
            choices: buildOptionalRepeatVariants(
              effect,
              optionalRepeatStepIndex
            ),
          }
        : Object.keys(fieldTargetingMetadata).length > 0
          ? fieldTargetingMetadata
          : // move_self / count_increase 等、対象を持たない「ことで」コスト効果側 step は
            // extractFieldTargetingMetadata が対象 step 自体を skip するため {} を返す
            // (「トラッシュにあるこのカードは、フラッシュタイミングで自分のカウント-1
            // することで手札に戻る」BSGE01-M01〜M04 等)。このケースだけ standalone の
            // conditional_cost gate を拾い、getAvailableHandActivatedEffectLegalActions
            // 側の canPayRequiredEffectCosts に requiredCountCostAmount 等を伝搬させる
            // (engine-trash-zone-flash-activated-recovery adversarial verifier round1
            // lens2 refute: countValue 不足でも use_hand_card_effect が can:true で
            // 出てしまうバグ)。field targeting が存在する効果は従来通り
            // extractFieldTargetingMetadata の結果をそのまま使うため、battle_immediate/
            // field_card/magic 等の他 registration 経路の既存挙動には影響しない。
            extractStandaloneConditionalCostGate(effect);
    const sourceKind = getSourceKindForCategory(definition.printedCategory);
    if (!sourceKind) continue;
    assertOccurrenceGateSupportedHere(definition, effect, "hand_activated");

    registrations.push({
      effectIndex,
      timing: mode,
      ...spreadSuppressionEffectDescriptor(effect, {
        sourceDefinitionId: definition.cardNo,
        sourceKind: getDescriptorSourceKindForCategory(
          definition.printedCategory
        ),
        effectIndex,
        sourceTextLines: definition.textLines,
      }),
      ...spreadPreventionLevel(effect),
      ...(effect.activationLabel
        ? { activationLabel: effect.activationLabel }
        : {}),
      ...(effect.executionMode ? { executionMode: effect.executionMode } : {}),
      ...(effect.applicability ? { applicability: effect.applicability } : {}),
      ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
      ...(effect.condition && effect.condition.length > 0
        ? { condition: effect.condition }
        : {}),
      ...targetingOrChoices,
      ...spreadUsageLimit(effectUsageLimit),
      ...spreadLimitGroupId(effect.limitGroupId),
    });
  }

  return registrations;
}

/**
 * 全カード定義から一括で HandActivatedEffectActionRegistrationLookup を構築。
 */
export function buildHandActivatedEffectLookup(
  definitions: readonly CardDefinition[]
): (
  cardNo: string
) => readonly RegisteredHandActivatedEffectAction[] | undefined {
  const map = new Map<string, readonly RegisteredHandActivatedEffectAction[]>();
  for (const def of definitions) {
    const regs = generateHandActivatedEffectRegistrations(def);
    if (regs.length > 0) {
      map.set(def.cardNo, regs);
    }
  }
  return (cardNo) => map.get(cardNo);
}

/**
 * BurstTrigger を BurstEventKind に変換する。
 * 構造化 trigger は kind で直接マップ。文字列 trigger は公式のバースト発動条件
 * family (source-findings-official-battle-brave-burst.md §8) に基づくパターンマッチ。
 *
 * 現 BurstEventKind (reduce_life/attack_after/summon/place/leave_field/exhaust) に
 * 対応しない型 —「相手の『召喚時』発揮後」等の効果発揮型 — は null を返し
 * registration を生成しない (P3-67 残フェーズ)。
 */
function mapBurstTriggerToEventKind(
  trigger: import("../model").BurstTrigger | undefined
): import("../model").BurstEventKind | null {
  if (trigger === undefined) return null;
  if (typeof trigger !== "string") {
    switch (trigger.kind) {
      case "life_decrease":
        return "reduce_life";
      case "spirit_destroyed":
        return "leave_field";
      case "opponent_summon":
        return "summon";
      case "attack_finished":
        return "attack_after";
      case "spirit_exhausted":
        return "exhaust";
      case "effect_activated":
      case "any_effect_activated":
        return "effect_activated";
      case "hand_increase":
        return "hand_increase";
      case "step_timing":
        return "step_timing";
      case "own_attack":
        return "own_attack";
      case "enter_soul_state":
        return "enter_soul_state";
      default:
        return null;
    }
  }
  // 文字列 trigger。「発揮後」= 効果発揮を見る型 (P3-67 Phase 3)。
  if (trigger.includes("発揮")) return "effect_activated";
  if (trigger.includes("手札") && trigger.includes("増え")) {
    return "hand_increase";
  }
  // 「○○ステップ開始/終了後」は step_timing だが step を文字列から確実に取れないため、
  // 構造化 trigger 必須とし、文字列では skip (「アタックステップ」を attack_after に誤マップしないガードも兼ねる)。
  if (trigger.includes("ステップ")) return null;
  if (trigger.includes("ライフ") && trigger.includes("減")) {
    return "reduce_life";
  }
  if (
    trigger.includes("離れ") ||
    trigger.includes("破壊") ||
    trigger.includes("消滅")
  ) {
    return "leave_field";
  }
  if (trigger.includes("配置")) return "place";
  if (trigger.includes("召喚")) return "summon";
  if (trigger.includes("アタック")) return "attack_after";
  if (trigger.includes("疲労")) return "exhaust";
  return null;
}

/**
 * BurstTrigger からプレイヤー絞り (whose) を導出する。
 * 構造化 trigger は player フィールド (opponent_summon は "opponent" 固定)。
 * 文字列 trigger は「誰の○○か」を主語で判定する:
 * - 「自分」を含む (例: 「相手によって自分のスピリットが離れた後」) → self
 * - それ以外で「相手」を含む (例: 「相手のスピリットのアタック後」) → opponent
 * 注: 「相手によって」(原因) と「相手の○○が」(主語) を区別するため、自分が優先。
 */
function mapBurstTriggerToWhose(
  trigger: import("../model").BurstTrigger | undefined
): import("../model").EffectPlayerRef | undefined {
  if (trigger === undefined) return undefined;
  if (typeof trigger !== "string") {
    switch (trigger.kind) {
      case "life_decrease":
      case "spirit_destroyed":
      case "spirit_exhausted":
      case "effect_activated":
      case "any_effect_activated":
      case "hand_increase":
      case "step_timing":
      case "attack_finished":
      case "own_attack":
      case "enter_soul_state":
        return trigger.player;
      case "opponent_summon":
        return "opponent";
      default:
        return undefined;
    }
  }
  const subjectText = stripBurstCausePrefix(trigger);
  if (subjectText.includes("自分")) return "self";
  if (subjectText.includes("相手")) return "opponent";
  if (trigger.includes("自分")) return "self";
  if (trigger.includes("相手")) return "opponent";
  return undefined;
}

function stripBurstCausePrefix(trigger: string): string {
  for (const prefix of [
    "相手の効果によって",
    "自分の効果によって",
    "相手によって",
    "自分によって",
  ]) {
    const index = trigger.indexOf(prefix);
    if (index >= 0) {
      return trigger.slice(index + prefix.length);
    }
  }
  return trigger;
}

function causeActorMatchesAffectedController(
  actor: import("../model").EffectPlayerRef,
  whose: import("../model").EffectPlayerRef | undefined
): boolean | undefined {
  if (whose !== "self" && whose !== "opponent") return undefined;
  return actor === whose;
}

function mapActorCauseToTriggerCauses(
  actor: import("../model").EffectPlayerRef,
  whose: import("../model").EffectPlayerRef | undefined
): readonly import("../model").TriggerEventCause[] {
  const sameSide = causeActorMatchesAffectedController(actor, whose);
  if (sameSide === true) {
    return ["self_effect", "self_bp_compare"];
  }
  if (sameSide === false) {
    return ["opponent_effect", "battle", "opponent_bp_compare"];
  }
  return actor === "opponent"
    ? ["opponent_effect", "battle", "opponent_bp_compare"]
    : ["self_effect", "self_bp_compare"];
}

/**
 * BurstTrigger から離脱原因 (cause) フィルタを導出する。
 * 「相手によって…離れた後」「相手の効果によって…」のように原因を絞る文字列 trigger 用。
 * - 「相手/自分の効果によって」: 効果のみ。cause は増加/離脱した側から見た相対値。
 *   相手自身の手札増加なら self_effect、自分への相手効果なら opponent_effect。
 * - 「相手によって」(効果以外): 相手起因 (効果 + 実バトル + BP比べ勝者) →
 *   [opponent_effect, battle, opponent_bp_compare]
 *   ※ バトル破壊は相手スピリットによる破壊なので「相手によって」に含める。
 *   ※ state-based 消滅は causePlayerId を失い帰属できないため含めない (保守的)。
 * - 「自分によって」(効果以外): 自分起因 (効果 + BP比べ)。ただし cause は離脱カード視点
 *   なので、主語 (whose) と actor の相対関係から self/opponent 側を決める。
 * 構造化 trigger は cause 情報を持たないため undefined (必要なら timing.cause で明示指定)。
 */
function mapBurstTriggerToCause(
  trigger: import("../model").BurstTrigger | undefined,
  whose?: import("../model").EffectPlayerRef
): readonly import("../model").TriggerEventCause[] | undefined {
  if (typeof trigger !== "string") return undefined;
  if (trigger.includes("相手の効果によって")) {
    return [
      causeActorMatchesAffectedController("opponent", whose) === true
        ? "self_effect"
        : "opponent_effect",
    ];
  }
  if (trigger.includes("自分の効果によって")) {
    return [
      causeActorMatchesAffectedController("self", whose) === false
        ? "opponent_effect"
        : "self_effect",
    ];
  }
  if (trigger.includes("相手によって")) {
    return mapActorCauseToTriggerCauses("opponent", whose);
  }
  if (trigger.includes("自分によって")) {
    return mapActorCauseToTriggerCauses("self", whose);
  }
  return undefined;
}

/** "summon"|"place"|"advent" (DSL) → effect_activation event の actionKind */
const ACTIVATED_TIMING_TO_ACTION_KIND: Record<
  "summon" | "place" | "advent",
  import("../model").StructuredTriggerEventActionKind
> = {
  summon: "summon",
  place: "placement",
  advent: "advent",
};

/**
 * effect_activated eventKind の trigger をどう registration 化するかの単一判別結果。
 * "wildcard": actionKind 不問で 1 registration のみ生成 (any_effect_activated)。
 * "action_kinds": 監視 timing (actionKind) ごとに 1 registration を生成する (従来の effect_activated)。
 * generateBurstRegistrations / (将来の) 他 consumer は必ずこの関数経由で trigger.kind を判別し、
 * BurstTrigger.kind の判別ロジックを複数箇所に持たない (CLAUDE.md SSOT)。
 */
type BurstActivatedRegistrationPlan =
  | { kind: "wildcard" }
  | {
      kind: "action_kinds";
      actionKinds: readonly import("../model").StructuredTriggerEventActionKind[];
    };

function getBurstActivatedRegistrationPlan(
  trigger: import("../model").BurstTrigger | undefined
): BurstActivatedRegistrationPlan {
  if (trigger !== undefined && typeof trigger !== "string") {
    if (trigger.kind === "any_effect_activated") {
      return { kind: "wildcard" };
    }
    if (trigger.kind === "effect_activated") {
      return {
        kind: "action_kinds",
        actionKinds: trigger.activatedTimings.map(
          (t) => ACTIVATED_TIMING_TO_ACTION_KIND[t]
        ),
      };
    }
    return { kind: "action_kinds", actionKinds: [] };
  }
  // 文字列 trigger は「召喚/配置/煌臨」の3種のみ導出可能 (any_effect_activated 相当の
  // 文字列表現は現状無い)。
  if (trigger === undefined || !trigger.includes("発揮")) {
    return { kind: "action_kinds", actionKinds: [] };
  }
  const kinds: import("../model").StructuredTriggerEventActionKind[] = [];
  if (trigger.includes("召喚")) kinds.push("summon");
  if (trigger.includes("配置")) kinds.push("placement");
  if (trigger.includes("煌臨")) kinds.push("advent");
  return { kind: "action_kinds", actionKinds: kinds };
}

/**
 * CardDefinition.effects の burst timing から RegisteredBurstAction を生成する。
 * trigger を BurstEventKind に変換できない effect (trigger なし / 効果発揮型) は skip する。
 * P3-67 Phase 1/2: player フィルタ (whose) と triggerFilter を registration に伝搬する。
 */
export function generateBurstRegistrations(
  definition: CardDefinition
): readonly RegisteredBurstAction[] {
  if (!definition.effects || definition.effects.length === 0) return [];

  const registrations: RegisteredBurstAction[] = [];
  for (const [effectIndex, effect] of definition.effects.entries()) {
    if (effect.timing.kind !== "burst") continue;
    const eventKind = mapBurstTriggerToEventKind(effect.timing.trigger);
    if (!eventKind) continue;
    const sourceKind = getTriggeredSourceKindForCategory(
      definition.printedCategory
    );
    if (!sourceKind) continue;
    assertOccurrenceGateSupportedHere(definition, effect, "burst");
    const whose = mapBurstTriggerToWhose(effect.timing.trigger);
    const whoseField = whose !== undefined ? { whose } : {};
    const triggerFilterField =
      effect.timing.triggerFilter !== undefined
        ? { triggerFilter: effect.timing.triggerFilter }
        : {};
    // cause: timing.cause を明示指定があれば優先、無ければ文字列 trigger から導出。
    const cause =
      effect.timing.cause ??
      mapBurstTriggerToCause(effect.timing.trigger, whose);
    const causeField = cause !== undefined && cause.length > 0 ? { cause } : {};
    // 手札からの直接バースト発動（裁定 2026-06-16, 10_rules/04b）。
    const handSourceField =
      effect.timing.handSource === true ? { handSource: true } : {};
    const handSourceConditionField =
      effect.timing.handSourceCondition !== undefined
        ? { handSourceCondition: effect.timing.handSourceCondition }
        : {};
    const choiceStepIndex = getDeclarationChoiceStepIndex(effect);
    const choiceStep =
      choiceStepIndex >= 0 ? effect.steps[choiceStepIndex] : undefined;
    const optionalRepeatStepIndex = findOptionalRepeatStepIndex(effect);
    const optionalRepeatStep =
      optionalRepeatStepIndex >= 0
        ? effect.steps[optionalRepeatStepIndex]
        : undefined;
    const targetingOrChoices = choiceStep
      ? {
          choices: buildChoiceVariantsWithSharedTargeting(
            effect,
            choiceStepIndex
          ),
        }
      : optionalRepeatStep
        ? {
            ...buildOptionalRepeatBaseTargetingMetadata(
              effect,
              optionalRepeatStepIndex,
              extractBurstTargetingMetadata(effect)
            ),
            choices: buildOptionalRepeatVariants(
              effect,
              optionalRepeatStepIndex
            ),
          }
        : extractBurstTargetingMetadata(effect);

    if (eventKind === "effect_activated") {
      // 効果発揮型は getBurstActivatedRegistrationPlan (単一 SSOT) の判別結果に従い、
      // wildcard なら actionKind 不問の 1 registration、action_kinds なら監視 timing
      // (actionKind) ごとに 1 registration を生成する。
      const plan = getBurstActivatedRegistrationPlan(effect.timing.trigger);
      const eventMatchers =
        plan.kind === "wildcard"
          ? [{ family: "effect_activation" as const }]
          : plan.actionKinds.map((actionKind) => ({
              family: "effect_activation" as const,
              actionKind,
            }));
      for (const eventMatcher of eventMatchers) {
        registrations.push({
          sourceKind,
          eventKind,
          eventMatcher,
          ...spreadSuppressionEffectDescriptor(effect, {
            sourceDefinitionId: definition.cardNo,
            sourceKind: getDescriptorSourceKindForCategory(
              definition.printedCategory
            ),
            effectIndex,
            sourceTextLines: definition.textLines,
          }),
          ...spreadPreventionLevel(effect),
          ...whoseField,
          ...triggerFilterField,
          ...causeField,
          ...targetingOrChoices,
          ...spreadUsageLimit(effect.usageLimit),
          effectIndex,
        });
      }
      continue;
    }

    if (eventKind === "step_timing") {
      // step_timing は step + subPhase を eventMatcher で絞る (構造化 trigger 必須)。
      const trig = effect.timing.trigger;
      if (typeof trig === "object" && trig.kind === "step_timing") {
        registrations.push({
          sourceKind,
          eventKind,
          eventMatcher: {
            family: "step_timing",
            step: trig.step,
            subPhase: trig.subPhase ?? "start",
          },
          ...spreadSuppressionEffectDescriptor(effect, {
            sourceDefinitionId: definition.cardNo,
            sourceKind: getDescriptorSourceKindForCategory(
              definition.printedCategory
            ),
            effectIndex,
            sourceTextLines: definition.textLines,
          }),
          ...spreadPreventionLevel(effect),
          ...whoseField,
          ...triggerFilterField,
          ...causeField,
          ...targetingOrChoices,
          ...spreadUsageLimit(effect.usageLimit),
          effectIndex,
        });
      }
      continue;
    }

    registrations.push({
      sourceKind,
      eventKind,
      ...spreadSuppressionEffectDescriptor(effect, {
        sourceDefinitionId: definition.cardNo,
        sourceKind: getDescriptorSourceKindForCategory(
          definition.printedCategory
        ),
        effectIndex,
        sourceTextLines: definition.textLines,
      }),
      ...spreadPreventionLevel(effect),
      ...whoseField,
      ...triggerFilterField,
      ...causeField,
      ...handSourceField,
      ...handSourceConditionField,
      ...targetingOrChoices,
      ...spreadUsageLimit(effect.usageLimit),
      effectIndex,
    });
  }
  return registrations;
}

/**
 * 全カード定義から一括で BurstActionRegistrationLookup を構築。
 */
export function buildBurstEffectLookup(
  definitions: readonly CardDefinition[]
): (cardNo: string) => readonly RegisteredBurstAction[] | undefined {
  const map = new Map<string, readonly RegisteredBurstAction[]>();
  for (const def of definitions) {
    const regs = generateBurstRegistrations(def);
    if (regs.length > 0) {
      map.set(def.cardNo, regs);
    }
  }
  return (cardNo) => map.get(cardNo);
}

// --- ヘルパー ---

function getSourceKindForCategory(
  category: CardDefinition["printedCategory"]
): "spirit" | "nexus" | "magic" | null {
  return getEffectRegistrationSourceKindForPrintedCategory(category);
}

/**
 * triggered effect 用の sourceKind 解決。
 * `getSourceKindForCategory` と異なり magic も対象とし、
 * after_cost_paid 等で magic 自身が source となるケースに対応する。
 */
function getTriggeredSourceKindForCategory(
  category: CardDefinition["printedCategory"]
): "spirit" | "nexus" | "magic" | null {
  return getEffectRegistrationSourceKindForPrintedCategory(category);
}

function getDescriptorSourceKindForCategory(
  category: CardDefinition["printedCategory"]
): SuppressionEffectDescriptor["sourceKind"] {
  return getEffectDescriptorSourceKindForPrintedCategory(category);
}

function getBattleSourceKindForCategory(
  category: CardDefinition["printedCategory"]
): "spirit" | "ultimate" | null {
  switch (category) {
    case "spirit":
    case "brave":
      return "spirit";
    case "ultimate":
      return "ultimate";
    default:
      return null;
  }
}

// ============================================================
// レジストレーション生成
// ============================================================

function getChoiceVariantLabel(
  effect: Effect,
  choiceStepIndex: number,
  choiceIndex: number,
  action: Action,
  explicitLabel?: string,
  prompt?: import("../model").EffectStepPrompt
): string {
  if (explicitLabel) return localizeEffectLabel(explicitLabel);
  if (prompt) return buildPendingStepPrompt({ action, prompt }).label;
  if (
    action.kind === "noop" &&
    effect.steps
      .slice(choiceStepIndex + 1)
      .some(
        (step) =>
          step.connector === "conditional_cost" &&
          step.stepCondition?.kind === "ref_choice" &&
          step.stepCondition.stepId === effect.steps[choiceStepIndex]?.id &&
          step.stepCondition.choiceIndex !== choiceIndex
      )
  ) {
    return "支払わない";
  }
  return getChoiceLabelForAction(action);
}

function hasRefChoiceStepCondition(
  condition: EffectStep["stepCondition"] | undefined,
  stepId: string,
  choiceIndex: number
): boolean {
  if (!condition) return false;
  if (condition.kind === "ref_choice") {
    return condition.stepId === stepId && condition.choiceIndex === choiceIndex;
  }
  if (condition.kind === "all") {
    return condition.conditions.some((child) =>
      hasRefChoiceStepCondition(child, stepId, choiceIndex)
    );
  }
  return false;
}

/** フィールド対象アクション種別 */
const FIELD_TARGETING_ACTION_KINDS = new Set([
  "turn_face_down",
  "destroy",
  "bounce",
  "send_to_deck",
  "vanish",
  "remove_from_game",
  "exhaust",
  "recover",
  "bp_modify",
  "symbol_add",
  "under_card_slot_capacity_grant",
  "under_card_role_grant",
  "effect_immunity",
  "unblockable",
  "allow_block_while_exhausted",
  "allow_attack_while_exhausted",
  "allow_tapless_battle_declare",
  "block_unblockable",
  "effect_resistance",
  "prevent_battle",
  "require_battle_cost",
  "require_attack_exhaust_cost",
  "require_battle_destroy_cost",
  "set_exhaust_state",
  "override_properties",
  "suppress_effect",
  // 単一対象コアシュート（core_move.target 指定時のみ。未指定 core_move は
  // getActionTarget が undefined を返し対象メタを生成しない）。
  "core_move",
  // 公開ゾーンから任意のカードを戻す/移動する効果。target 指定時のみ対象メタを生成する。
  "move_card",
  // 外部転醒（rebirth.target 指定時のみ。未指定 rebirth は getActionTarget が
  // undefined を返し対象メタを生成しない＝従来通り sourceInstanceId 自身を flip）。
  // BSSA01-XX01 神技4 で使用、divine_skill 解決後の対象選択 pending を生成。
  "rebirth",
  // コア配置（mode="one_each" / "even" の to:TargetSpec 指定時のみ）。
  // {min, max} 型可変選択 (「N体まで」) の pending target selection を立てる。
  // mode="player_choice" は executeCoreDistribute 内で pendingCoreDistribution を
  // 別 pending として生成するため、registration 層では同一 to メタを expose する。
  "core_distribute",
  // 対象カードを指定 Lv まで上げるため、対象メタを expose する。
  "core_set_to_level",
  "discard_set_burst",
  "discard",
  "place_star_garment",
  "swap_star_garment",
  // 【バレットエディット】(P3-116 SSOT是正: 専用 LegalAction kind 廃止 + DSL Action 化)。
  "bullet_edit",
  "swap_bullet_edit",
  // 効果借用（借用元カード1枚を zone+filter で選ぶ）。BSAZ03-M01 effects[2,3] が初出。
  "borrow_magic_effect",
  // card_event 効果借用（借用元カード1枚を zone+filter で選ぶ）。BSFT01-TR03(B) が初出。
  "borrow_card_event_effect",
  // 選択専用 step。target を持たない noop は getActionTarget で除外される。
  "noop",
]);

/** 単一アクションからフィールド対象メタデータを抽出 */
function extractFieldTargetingFromAction(
  action: Action
): Partial<RegisteredTargetedEffectActionBase> {
  if (
    (action.kind === "summon" || action.kind === "put") &&
    action.target.kind === "from_zone"
  ) {
    const count = action.target.count;
    let requiredTargetCount: number;
    let maxTargetCount: number | undefined;
    let maxTargetCountDynamic: CountBound | undefined;
    if (typeof count === "number") {
      requiredTargetCount = count;
    } else if (count === "all") {
      return {};
    } else if (typeof count === "object" && count !== null && "min" in count) {
      requiredTargetCount = typeof count.min === "number" ? count.min : 0;
      if (typeof count.max === "number") {
        maxTargetCount = count.max;
      } else if (count.max !== undefined) {
        maxTargetCountDynamic = count.max;
      }
    } else {
      requiredTargetCount = 1;
    }

    return {
      requiredTargetCount,
      ...(maxTargetCount !== undefined ? { maxTargetCount } : {}),
      ...(maxTargetCountDynamic !== undefined ? { maxTargetCountDynamic } : {}),
      candidateTargetPlayerScope: "acting_player",
      candidateTargetZones: (Array.isArray(action.target.zone)
        ? action.target.zone
        : [action.target.zone]) as readonly Zone[],
      // includeAdventSource:true のとき、matchesCardFilter の無印スコープ既定
      // (煌臨元/text_role アンダーカードを除外、card-filter.ts:215-221、
      // project_name_reference_inclusion_scope_regression) を明示的に opt-in する。
      // 未設定のままだと union した煌臨元候補が候補列挙の filter 段で再び弾かれる
      // (union と opt-in が別レイヤーのため、片方だけでは half-wired になる)。
      ...(action.target.filter && Object.keys(action.target.filter).length > 0
        ? {
            targetCardFilter:
              action.target.includeAdventSource ||
              action.target.includeSoulState
                ? {
                    ...action.target.filter,
                    ...(action.target.includeAdventSource
                      ? { adventSourceScope: "include" as const }
                      : {}),
                    ...(action.target.includeSoulState
                      ? { soulState: "include" as const }
                      : {}),
                  }
                : action.target.filter,
          }
        : action.target.includeAdventSource || action.target.includeSoulState
          ? {
              targetCardFilter: {
                ...(action.target.includeAdventSource
                  ? { adventSourceScope: "include" as const }
                  : {}),
                ...(action.target.includeSoulState
                  ? { soulState: "include" as const }
                  : {}),
              },
            }
          : {}),
      ...(action.target.includeAdventSource
        ? { candidateIncludeAdventSource: true }
        : {}),
      ...(action.target.includeSoulState
        ? { candidateIncludeSoulState: true }
        : {}),
    };
  }

  if (action.kind === "search_zone") {
    if (action.target?.kind === "ref") return {};
    const count = action.count;
    let requiredTargetCount: number;
    let maxTargetCount: number | undefined;
    let maxTargetCountDynamic: CountBound | undefined;
    if (typeof count === "number") {
      requiredTargetCount = count;
    } else if (count === "all") {
      return {};
    } else if (typeof count === "object" && count !== null && "min" in count) {
      requiredTargetCount = typeof count.min === "number" ? count.min : 0;
      if (typeof count.max === "number") {
        maxTargetCount = count.max;
      } else if (count.max !== undefined) {
        maxTargetCountDynamic = count.max;
      }
    } else {
      requiredTargetCount = 1;
    }

    const playerScope: LegalActionTargetPlayerScope =
      action.player === "opponent"
        ? "opponent"
        : action.player === "either"
          ? "any"
          : "acting_player";

    return {
      requiredTargetCount,
      ...(maxTargetCount !== undefined ? { maxTargetCount } : {}),
      ...(maxTargetCountDynamic !== undefined ? { maxTargetCountDynamic } : {}),
      candidateTargetPlayerScope: playerScope,
      candidateTargetZones: Array.isArray(action.zone)
        ? action.zone
        : [action.zone],
      ...(action.filter && Object.keys(action.filter).length > 0
        ? { targetCardFilter: action.filter }
        : {}),
    };
  }

  if (!FIELD_TARGETING_ACTION_KINDS.has(action.kind)) return {};

  const target = getActionTarget(action);
  if (!target) return {};

  if (target.kind === "self") return {};
  if (target.kind === "ref") return {};
  if (target.kind === "filter") {
    if (
      action.kind === "noop" &&
      (target.stepId !== undefined || target.excludeStepId !== undefined)
    ) {
      // 前段 step の結果に依存する選択は宣言時候補へ落とせない。
      // `targetSelectionTiming:"on_step"` の pending 解決に委ねる。
      return {};
    }
    if (target.count === "all") return {};

    let requiredTargetCount: number;
    let requiredTargetCountDynamic:
      | import("../dsl-types").CountBound
      | undefined;
    let maxTargetCount: number | undefined;
    let maxTargetCountDynamic: import("../dsl-types").CountBound | undefined;
    if (typeof target.count === "number") {
      requiredTargetCount = target.count;
    } else if (
      typeof target.count === "object" &&
      target.count !== null &&
      "min" in target.count
    ) {
      // { min, max?: } 形式: 可変選択 (D-2 Phase 2)。
      // 境界が DynamicCount のときは登録時には盤面が無く解決できないため、
      // 数値境界のみ静的採用し、動的境界は実行時解決に委ねる（min は 0 仮設定）。
      const min = target.count.min;
      const max = target.count.max;
      requiredTargetCount = typeof min === "number" ? min : 0;
      if (typeof max === "number" && (typeof min !== "number" || max > min)) {
        maxTargetCount = max;
      } else if (max !== undefined && typeof max !== "number") {
        // 上限が DynamicCount（「自分のカウント2につき1体まで」等）。盤面依存の実効上限は
        // 対象選択の deferred 解決時に resolveCountBound で数値化する（raw bound を保持）。
        maxTargetCountDynamic = max;
      }
    } else {
      // DynamicCount exact（「カウント2につき1体」等）は、deferred 解決時に
      // required/max の両方を同じ bound で数値化する。
      requiredTargetCount = 0;
      requiredTargetCountDynamic = target.count;
      maxTargetCountDynamic = target.count;
    }

    const targetEffectAspect = deriveEffectAspectForImmunity(action);
    // P3-52: target.player を candidate scope にマッピング。
    // - self → acting_player
    // - opponent → opponent
    // - either / その他 → any
    const playerScope: LegalActionTargetPlayerScope =
      target.player === "self"
        ? "acting_player"
        : target.player === "opponent"
          ? "opponent"
          : "any";

    // P3-14 A-7: effect_param_override CE で listing 段階でも filter 拡張を
    // 反映するため、destroy / vanish / bounce / prevent_battle の action.kind を
    // registration に伝搬。exhaust/recover は override 対象ではないが、候補列挙を
    // 解決時の疲労/回復状態 gate と揃える。
    const overrideKind:
      | "destroy"
      | "vanish"
      | "bounce"
      | "prevent_battle"
      | "exhaust"
      | "recover"
      | undefined =
      action.kind === "destroy" ||
      action.kind === "vanish" ||
      action.kind === "bounce" ||
      action.kind === "prevent_battle" ||
      action.kind === "exhaust" ||
      action.kind === "recover"
        ? action.kind
        : undefined;
    const targetExhaustState =
      action.kind === "exhaust"
        ? action.degree === "heavy_exhaust"
          ? ("heavily_exhausted" as const)
          : ("exhausted" as const)
        : undefined;
    const sourceUnderCardRole =
      action.kind === "move_card"
        ? action.from.sourceUnderCardRole
        : target.sourceUnderCardRole;
    const sourceAttachedChildrenOnly =
      action.kind === "place_star_garment" ||
      action.kind === "swap_star_garment";
    const starGarmentTargetEligibleOnly = sourceAttachedChildrenOnly;
    const targetRequiresFullCount =
      (action.kind === "move_card" && action.requireFullCount === true) ||
      sourceAttachedChildrenOnly ||
      action.kind === "bullet_edit" ||
      action.kind === "swap_bullet_edit";
    const sourceRequiredUnderCard =
      action.kind === "swap_star_garment"
        ? {
            role: "text_role" as const,
            roleTag: action.roleTag ?? "星霊衣",
          }
        : action.kind === "swap_bullet_edit"
          ? {
              role: "text_role" as const,
              roleTag: action.roleTag ?? BULLET_EDIT_ROLE_TAG,
            }
          : undefined;
    const sourceRequiredOpenUnderCardSlot =
      action.kind === "place_star_garment"
        ? {
            role: "text_role" as const,
            roleTag: action.roleTag ?? "星霊衣",
            maxCount: 1,
          }
        : action.kind === "bullet_edit"
          ? {
              role: "text_role" as const,
              roleTag: action.roleTag ?? BULLET_EDIT_ROLE_TAG,
              maxCount: 1,
            }
          : undefined;

    return {
      requiredTargetCount,
      ...(requiredTargetCountDynamic !== undefined
        ? { requiredTargetCountDynamic }
        : {}),
      ...(maxTargetCount !== undefined ? { maxTargetCount } : {}),
      ...(maxTargetCountDynamic !== undefined ? { maxTargetCountDynamic } : {}),
      candidateTargetPlayerScope: playerScope,
      ...(targetEffectAspect !== undefined ? { targetEffectAspect } : {}),
      candidateTargetZones:
        target.zone !== undefined
          ? ((Array.isArray(target.zone)
              ? target.zone
              : [target.zone]) as readonly Zone[])
          : (["field"] as readonly Zone[]),
      // P3-52: target.filter / excludeSelf を registration に伝搬し、
      // legal action 候補絞り込みで反映できるようにする。
      ...(target.filter && Object.keys(target.filter).length > 0
        ? { targetCardFilter: target.filter }
        : {}),
      ...(target.excludeSelf ? { targetExcludeSelf: true } : {}),
      ...(sourceUnderCardRole !== undefined ? { sourceUnderCardRole } : {}),
      ...(sourceAttachedChildrenOnly
        ? { sourceAttachedChildrenOnly: true }
        : {}),
      ...(starGarmentTargetEligibleOnly
        ? { starGarmentTargetEligibleOnly: true }
        : {}),
      ...(sourceRequiredUnderCard !== undefined
        ? { sourceRequiredUnderCard }
        : {}),
      ...(sourceRequiredOpenUnderCardSlot !== undefined
        ? { sourceRequiredOpenUnderCardSlot }
        : {}),
      ...(targetRequiresFullCount ? { targetRequiresFullCount: true } : {}),
      ...(overrideKind ? { targetCardFilterActionKind: overrideKind } : {}),
      ...(targetExhaustState !== undefined ? { targetExhaustState } : {}),
      ...(action.kind === "discard_set_burst"
        ? {
            targetSelectionBypassesAffectGate: true,
            targetCandidatesRequireSetBurstState: true,
          }
        : {}),
    };
  }
  return {};
}

/**
 * P3-24 Phase 2: choice ステップから choice 変種メタデータを生成する。
 * choices[0] = デフォルト action, choices[1+] = choice[N-1] 各エントリ。
 * label / target / chooser / 変種別 usageLimit を choice ごとに収集。
 *
 * per-choice usageLimit (「ターンに1回ずつ」): choices[0] は choiceStep.usageLimit、
 * choices[k+1] は choice[k].usageLimit を保持する。effect 単位の共有制限
 * (Effect.usageLimit) とは別軸で、変種別ラベル (`getChoiceVariantUsageLabel`) で
 * 独立に検査・記録される。
 */
function buildChoiceVariants(
  effect: Effect,
  choiceStepIndex: number
): Array<{
  label: string;
  triggerEffectTiming?: EffectActivationTiming;
  requiredTargetCount?: number;
  requiredTargetCountDynamic?: CountBound;
  maxTargetCount?: number;
  maxTargetCountDynamic?: CountBound;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  /** Operation aspect used by the shared immunity gate. */
  targetEffectAspect?: string;
  candidateTargetZones?: readonly Zone[];
  candidateTargetPlayerScope?: LegalActionTargetPlayerScope;
  targetCardFilter?: import("../dsl-types").CardFilter;
  targetExcludeSelf?: boolean;
  sourceAttachedChildrenOnly?: boolean;
  starGarmentTargetEligibleOnly?: boolean;
  sourceRequiredOpenUnderCardSlot?: import("../legal/legal-actions-types").RegisteredSourceUnderCardSlotRequirement;
  sourceRequiredUnderCard?: import("../legal/legal-actions-types").RegisteredSourceUnderCardRequirement;
  targetCardFilterActionKind?:
    | "destroy"
    | "vanish"
    | "bounce"
    | "prevent_battle"
    | "exhaust"
    | "recover";
  targetExhaustState?: "exhausted" | "heavily_exhausted";
  targetSelectionBypassesAffectGate?: boolean;
  targetCandidatesRequireSetBurstState?: boolean;
  targetGroups?: readonly import("../legal/legal-actions-types").RegisteredTargetGroup[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  targetGatedByConditionalCost?: boolean;
  requiredPayCostAmount?: number;
  allowFieldCorePayment?: true;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  requiredSelectedTargetsCountCost?: import("../legal/legal-actions-types").RequiredSelectedTargetsCountCost;
  requiredCoreMoveCost?: import("../legal/legal-actions-types").RequiredCoreMoveCost;
  requiredDiscardCost?: import("../legal/legal-actions-types").RequiredDiscardCost;
  chooser?: "self" | "opponent" | "either";
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
}> {
  const choiceStep = effect.steps[choiceStepIndex]!;
  const variants: Array<{
    label: string;
    triggerEffectTiming?: EffectActivationTiming;
    requiredTargetCount?: number;
    maxTargetCount?: number;
    targetEffectFilterTags?: readonly EffectFilterTag[];
    /** Operation aspect used by the shared immunity gate. */
    targetEffectAspect?: string;
    candidateTargetZones?: readonly Zone[];
    candidateTargetPlayerScope?: LegalActionTargetPlayerScope;
    targetCardFilter?: import("../dsl-types").CardFilter;
    targetExcludeSelf?: boolean;
    sourceAttachedChildrenOnly?: boolean;
    starGarmentTargetEligibleOnly?: boolean;
    sourceRequiredOpenUnderCardSlot?: import("../legal/legal-actions-types").RegisteredSourceUnderCardSlotRequirement;
    sourceRequiredUnderCard?: import("../legal/legal-actions-types").RegisteredSourceUnderCardRequirement;
    targetCardFilterActionKind?:
      | "destroy"
      | "vanish"
      | "bounce"
      | "prevent_battle"
      | "exhaust"
      | "recover";
    targetExhaustState?: "exhausted" | "heavily_exhausted";
    targetSelectionBypassesAffectGate?: boolean;
    targetCandidatesRequireSetBurstState?: boolean;
    targetGroups?: readonly import("../legal/legal-actions-types").RegisteredTargetGroup[];
    targetStepId?: string;
    targetGatedByConditionalCost?: boolean;
    requiredPayCostAmount?: number;
    allowFieldCorePayment?: true;
    requiredCountCostAmount?: number;
    requiredCountCostPlayer?: import("../model").EffectPlayerRef;
    requiredSelectedTargetsCountCost?: import("../legal/legal-actions-types").RequiredSelectedTargetsCountCost;
    requiredCoreMoveCost?: import("../legal/legal-actions-types").RequiredCoreMoveCost;
    requiredDiscardCost?: import("../legal/legal-actions-types").RequiredDiscardCost;
    chooser?: "self" | "opponent" | "either";
    usageLimit?: EffectUsageLimit | EffectUsageLimit[];
  }> = [];

  // choices[0]: デフォルト action
  variants.push({
    label: getChoiceVariantLabel(
      effect,
      choiceStepIndex,
      0,
      choiceStep.action,
      choiceStep.label,
      choiceStep.prompt
    ),
    ...(choiceStep.triggerEffectTiming
      ? { triggerEffectTiming: choiceStep.triggerEffectTiming }
      : {}),
    ...extractChoiceVariantPayCost(choiceStep.action),
    ...extractChoiceVariantTargeting(effect, choiceStepIndex, 0),
    ...(choiceStep.chooser ? { chooser: choiceStep.chooser } : {}),
    ...spreadUsageLimit(choiceStep.usageLimit),
  });

  // choices[1+]: 各 choice entry
  for (const [entryIndex, choiceEntry] of (choiceStep.choice ?? []).entries()) {
    const choiceIndex = entryIndex + 1;
    variants.push({
      label: getChoiceVariantLabel(
        effect,
        choiceStepIndex,
        choiceIndex,
        choiceEntry.action,
        choiceEntry.label,
        choiceEntry.prompt
      ),
      ...(choiceEntry.triggerEffectTiming
        ? { triggerEffectTiming: choiceEntry.triggerEffectTiming }
        : {}),
      ...extractChoiceVariantPayCost(choiceEntry.action),
      ...extractChoiceVariantTargeting(effect, choiceStepIndex, choiceIndex),
      ...(choiceEntry.chooser ? { chooser: choiceEntry.chooser } : {}),
      ...spreadUsageLimit(choiceEntry.usageLimit),
    });
  }

  return variants;
}

function variantHasTargeting(
  variant: Partial<RegisteredTargetedEffectActionBase>
): boolean {
  return (
    variant.requiredTargetCount !== undefined ||
    variant.maxTargetCount !== undefined ||
    variant.maxTargetCountDynamic !== undefined
  );
}

function buildChoiceVariantsWithSharedTargeting(
  effect: Effect,
  choiceStepIndex: number
): ReturnType<typeof buildChoiceVariants> {
  const variants = buildChoiceVariants(effect, choiceStepIndex);
  const sharedTargeting = extractFieldTargetingMetadata(effect, {
    beforeStepIndex: choiceStepIndex,
  });
  if (Object.keys(sharedTargeting).length === 0) {
    return variants;
  }

  return variants.map((variant) =>
    variantHasTargeting(variant)
      ? mergeSharedAndChoiceTargeting(sharedTargeting, variant)
      : { ...sharedTargeting, ...variant }
  );
}

export function getEffectStepChoiceOptions(
  effect: Effect,
  choiceStepIndex: number
): Array<{
  choiceIndex: number;
  label: string;
  requiredPayCostAmount?: number;
  prompt?: import("../model").PendingStepPrompt;
  chooser?: "self" | "opponent" | "either";
}> {
  const choiceStep = effect.steps[choiceStepIndex]!;
  return buildChoiceVariantsWithSharedTargeting(effect, choiceStepIndex).map(
    (variant, choiceIndex) => {
      const step =
        choiceIndex === 0
          ? choiceStep
          : (choiceStep.choice ?? [])[choiceIndex - 1];
      return {
        choiceIndex,
        label: variant.label,
        ...(variant.requiredPayCostAmount !== undefined
          ? { requiredPayCostAmount: variant.requiredPayCostAmount }
          : {}),
        ...(step?.prompt
          ? { prompt: buildPendingStepPrompt(step, step.prompt) }
          : {}),
        ...(variant.chooser !== undefined ? { chooser: variant.chooser } : {}),
      };
    }
  );
}

function mergeSharedAndChoiceTargeting<
  T extends ReturnType<typeof buildChoiceVariants>[number],
>(shared: Partial<RegisteredTargetedEffectActionBase>, variant: T): T {
  const {
    targetStepId: _targetStepId,
    targetGroups: _targetGroups,
    ...variantRest
  } = variant;
  const sharedRequiredCount = shared.requiredTargetCount ?? 0;
  const variantRequiredCount = variant.requiredTargetCount ?? 0;
  const sharedMaxCount = shared.maxTargetCount ?? sharedRequiredCount;
  const variantMaxCount = variant.maxTargetCount ?? variantRequiredCount;
  const zones = [
    ...(shared.candidateTargetZones ?? []),
    ...(variant.candidateTargetZones ?? []),
  ];
  const filters = [shared.targetCardFilter, variant.targetCardFilter].filter(
    (filter): filter is import("../dsl-types").CardFilter =>
      filter !== undefined
  );

  const mergedScope =
    shared.candidateTargetPlayerScope === variant.candidateTargetPlayerScope
      ? variant.candidateTargetPlayerScope
      : "any";
  const targetGroups = [
    ...targetGroupsFromMeta(shared),
    ...targetGroupsFromMeta(variant),
  ];
  const variantTargetRequiresFullCount = (
    variant as Partial<RegisteredTargetedEffectActionBase>
  ).targetRequiresFullCount;

  return {
    ...variantRest,
    requiredTargetCount: sharedRequiredCount + variantRequiredCount,
    maxTargetCount: sharedMaxCount + variantMaxCount,
    ...(zones.length > 0
      ? { candidateTargetZones: Array.from(new Set(zones)) }
      : {}),
    ...(mergedScope !== undefined
      ? { candidateTargetPlayerScope: mergedScope }
      : {}),
    ...(filters.length === 1
      ? { targetCardFilter: filters[0] }
      : filters.length > 1
        ? { targetCardFilter: { filterOr: filters } }
        : {}),
    ...(targetGroups.length > 1 ? { targetGroups } : {}),
    ...(shared.allowDuplicateTargets === true ||
    variant.allowDuplicateTargets === true
      ? { allowDuplicateTargets: true }
      : {}),
    ...(shared.targetGatedByConditionalCost === true ||
    variant.targetGatedByConditionalCost === true
      ? { targetGatedByConditionalCost: true }
      : {}),
    ...(shared.targetRequiresFullCount === true ||
    variantTargetRequiresFullCount === true
      ? { targetRequiresFullCount: true }
      : {}),
    ...(shared.sourceAttachedChildrenOnly === true ||
    variant.sourceAttachedChildrenOnly === true
      ? { sourceAttachedChildrenOnly: true }
      : {}),
    ...(shared.starGarmentTargetEligibleOnly === true ||
    variant.starGarmentTargetEligibleOnly === true
      ? { starGarmentTargetEligibleOnly: true }
      : {}),
    ...(variant.sourceRequiredUnderCard !== undefined
      ? { sourceRequiredUnderCard: variant.sourceRequiredUnderCard }
      : shared.sourceRequiredUnderCard !== undefined
        ? { sourceRequiredUnderCard: shared.sourceRequiredUnderCard }
        : {}),
    ...(variant.sourceRequiredOpenUnderCardSlot !== undefined
      ? {
          sourceRequiredOpenUnderCardSlot:
            variant.sourceRequiredOpenUnderCardSlot,
        }
      : shared.sourceRequiredOpenUnderCardSlot !== undefined
        ? {
            sourceRequiredOpenUnderCardSlot:
              shared.sourceRequiredOpenUnderCardSlot,
          }
        : {}),
    ...(variant.requiredPayCostAmount !== undefined
      ? { requiredPayCostAmount: variant.requiredPayCostAmount }
      : shared.requiredPayCostAmount !== undefined
        ? { requiredPayCostAmount: shared.requiredPayCostAmount }
        : {}),
    ...(variant.allowFieldCorePayment === true ||
    shared.allowFieldCorePayment === true
      ? { allowFieldCorePayment: true }
      : {}),
    ...(variant.requiredCountCostAmount !== undefined
      ? { requiredCountCostAmount: variant.requiredCountCostAmount }
      : shared.requiredCountCostAmount !== undefined
        ? { requiredCountCostAmount: shared.requiredCountCostAmount }
        : {}),
    ...(variant.requiredCountCostPlayer !== undefined
      ? { requiredCountCostPlayer: variant.requiredCountCostPlayer }
      : shared.requiredCountCostPlayer !== undefined
        ? { requiredCountCostPlayer: shared.requiredCountCostPlayer }
        : {}),
    ...(variant.requiredSelectedTargetsCountCost !== undefined
      ? {
          requiredSelectedTargetsCountCost:
            variant.requiredSelectedTargetsCountCost,
        }
      : shared.requiredSelectedTargetsCountCost !== undefined
        ? {
            requiredSelectedTargetsCountCost:
              shared.requiredSelectedTargetsCountCost,
          }
        : {}),
    ...(variant.requiredCoreMoveCost !== undefined
      ? { requiredCoreMoveCost: variant.requiredCoreMoveCost }
      : shared.requiredCoreMoveCost !== undefined
        ? { requiredCoreMoveCost: shared.requiredCoreMoveCost }
        : {}),
    ...(variant.requiredDiscardCost !== undefined
      ? { requiredDiscardCost: variant.requiredDiscardCost }
      : shared.requiredDiscardCost !== undefined
        ? { requiredDiscardCost: shared.requiredDiscardCost }
        : {}),
  } as unknown as T;
}

function targetGroupsFromMeta(
  meta: Partial<RegisteredTargetedEffectActionBase>
): import("../legal/legal-actions-types").RegisteredTargetGroup[] {
  const requiredCount = meta.requiredTargetCount ?? 0;
  const maxCount = meta.maxTargetCount ?? requiredCount;
  if (
    requiredCount <= 0 &&
    maxCount <= 0 &&
    meta.requiredTargetCountDynamic === undefined &&
    meta.maxTargetCountDynamic === undefined
  ) {
    return [];
  }
  return [
    {
      requiredTargetCount: requiredCount,
      ...(meta.requiredTargetCountDynamic !== undefined
        ? { requiredTargetCountDynamic: meta.requiredTargetCountDynamic }
        : {}),
      ...(meta.maxTargetCount !== undefined
        ? { maxTargetCount: meta.maxTargetCount }
        : {}),
      ...(meta.maxTargetCountDynamic !== undefined
        ? { maxTargetCountDynamic: meta.maxTargetCountDynamic }
        : {}),
      ...(meta.targetStepId !== undefined
        ? { targetStepId: meta.targetStepId }
        : {}),
      ...(meta.targetEffectFilterTags !== undefined
        ? { targetEffectFilterTags: meta.targetEffectFilterTags }
        : {}),
      ...(meta.targetEffectAspect !== undefined
        ? { targetEffectAspect: meta.targetEffectAspect }
        : {}),
      ...(meta.candidateTargetZones !== undefined
        ? { candidateTargetZones: meta.candidateTargetZones }
        : {}),
      ...(meta.candidateTargetPlayerScope !== undefined
        ? { candidateTargetPlayerScope: meta.candidateTargetPlayerScope }
        : {}),
      ...(meta.targetCardFilter !== undefined
        ? { targetCardFilter: meta.targetCardFilter }
        : {}),
      ...(meta.targetExcludeSelf !== undefined
        ? { targetExcludeSelf: meta.targetExcludeSelf }
        : {}),
      ...(meta.sourceUnderCardRole !== undefined
        ? { sourceUnderCardRole: meta.sourceUnderCardRole }
        : {}),
      ...(meta.sourceAttachedChildrenOnly !== undefined
        ? { sourceAttachedChildrenOnly: meta.sourceAttachedChildrenOnly }
        : {}),
      ...(meta.starGarmentTargetEligibleOnly !== undefined
        ? { starGarmentTargetEligibleOnly: meta.starGarmentTargetEligibleOnly }
        : {}),
      ...(meta.sourceRequiredOpenUnderCardSlot !== undefined
        ? {
            sourceRequiredOpenUnderCardSlot:
              meta.sourceRequiredOpenUnderCardSlot,
          }
        : {}),
      ...(meta.targetRequiresFullCount !== undefined
        ? { targetRequiresFullCount: meta.targetRequiresFullCount }
        : {}),
      ...(meta.targetCardFilterActionKind !== undefined
        ? { targetCardFilterActionKind: meta.targetCardFilterActionKind }
        : {}),
      ...(meta.targetExhaustState !== undefined
        ? { targetExhaustState: meta.targetExhaustState }
        : {}),
    },
  ];
}

function findOptionalRepeatStepIndex(effect: Effect): number {
  return effect.steps.findIndex((step) => step.repeat?.optional === true);
}

function buildOptionalRepeatBaseTargetingMetadata(
  effect: Effect,
  repeatStepIndex: number,
  targetMeta: Partial<RegisteredTargetedEffectActionBase>
): Partial<RegisteredTargetedEffectActionBase> {
  return {
    ...targetMeta,
    ...buildOptionalRepeatConditionalCostGate(
      effect,
      repeatStepIndex,
      targetMeta
    ),
  };
}

function buildOptionalRepeatVariants(
  effect: Effect,
  repeatStepIndex: number
): Array<{
  label: string;
  requiredTargetCount?: number;
  maxTargetCount?: number;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  /** Operation aspect used by the shared immunity gate. */
  targetEffectAspect?: string;
  candidateTargetZones?: readonly Zone[];
  candidateTargetPlayerScope?: LegalActionTargetPlayerScope;
  targetCardFilter?: import("../dsl-types").CardFilter;
  targetExcludeSelf?: boolean;
  sourceUnderCardRole?: "advent_source" | "text_role";
  sourceAttachedChildrenOnly?: boolean;
  starGarmentTargetEligibleOnly?: boolean;
  sourceRequiredOpenUnderCardSlot?: import("../legal/legal-actions-types").RegisteredSourceUnderCardSlotRequirement;
  sourceRequiredUnderCard?: import("../legal/legal-actions-types").RegisteredSourceUnderCardRequirement;
  targetRequiresFullCount?: boolean;
  targetCardFilterActionKind?:
    | "destroy"
    | "vanish"
    | "bounce"
    | "prevent_battle"
    | "exhaust"
    | "recover";
  targetExhaustState?: "exhausted" | "heavily_exhausted";
  targetGroups?: readonly import("../legal/legal-actions-types").RegisteredTargetGroup[];
  targetStepId?: string;
  allowDuplicateTargets?: boolean;
  targetGatedByConditionalCost?: boolean;
  requiredPayCostAmount?: number;
  allowFieldCorePayment?: true;
  requiredCountCostAmount?: number;
  requiredCountCostPlayer?: import("../model").EffectPlayerRef;
  requiredCoreMoveCost?: import("../legal/legal-actions-types").RequiredCoreMoveCost;
  requiredDiscardCost?: import("../legal/legal-actions-types").RequiredDiscardCost;
  chooser?: "self" | "opponent" | "either";
  usageLimit?: EffectUsageLimit | EffectUsageLimit[];
}> {
  const repeatStep = effect.steps[repeatStepIndex]!;
  const targeting = extractFieldTargetingFromAction(repeatStep.action);
  const targetStepId = repeatStep.id ?? `__step_${repeatStepIndex}`;
  const targetMeta =
    Object.keys(targeting).length > 0
      ? { ...targeting, targetStepId }
      : targeting;
  // `targetSelectionTiming:"on_step"` の任意反復は、追加回数だけを先に確定し、
  // 対象は各反復の実行時点で改めて選ぶ。一括選択用の target 数へ展開しない。
  const repeatTargetMeta =
    repeatStep.targetSelectionTiming === "on_step"
      ? targetMeta
      : buildOptionalRepeatTargetMeta(targetMeta, repeatStep.repeat);
  const defaultConditionalCostTargetGate =
    buildOptionalRepeatConditionalCostGate(effect, repeatStepIndex, targetMeta);
  const repeatConditionalCostTargetGate =
    buildOptionalRepeatConditionalCostGate(
      effect,
      repeatStepIndex,
      repeatTargetMeta
    );
  return [
    {
      label: "追加発揮しない",
      ...targetMeta,
      ...defaultConditionalCostTargetGate,
      ...(repeatStep.chooser ? { chooser: repeatStep.chooser } : {}),
      ...spreadUsageLimit(repeatStep.usageLimit),
    },
    {
      label: "追加発揮する",
      ...repeatTargetMeta,
      ...repeatConditionalCostTargetGate,
      ...(repeatStep.chooser ? { chooser: repeatStep.chooser } : {}),
      ...spreadUsageLimit(repeatStep.usageLimit),
    },
  ];
}

function getMinimumTargetCountForCostGate(
  targetMeta: Partial<RegisteredTargetedEffectActionBase>
): number {
  return Math.max(
    0,
    targetMeta.requiredTargetCount ?? targetMeta.maxTargetCount ?? 0
  );
}

function resolveSelectedTargetsCountCostAmount(
  amount: DynamicCount,
  selectedTargetCount: number
): number {
  const multiplier = amount.multiplier ?? 1;
  const divisor = amount.divisor ?? 1;
  const groupMultiplier = amount.groupMultiplier ?? 1;
  const offset = amount.offset ?? 0;
  const raw =
    Math.floor((selectedTargetCount * multiplier) / divisor) * groupMultiplier +
    offset;
  const capped = amount.cap !== undefined ? Math.min(raw, amount.cap) : raw;
  return Math.max(0, capped);
}

function getSelectedTargetsCountCostAmount(
  amount: Extract<Action, { kind: "count_decrease" }>["amount"],
  targetStepId: string
): DynamicCount | null {
  if (typeof amount === "number") return null;
  // ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2: {min,max} 範囲
  // (「好きなだけ減らせる」型) は selected_targets DynamicCount ではない。
  if ("min" in amount) return null;
  const source = amount.source;
  if (
    source.kind !== "selected_targets" ||
    (source.stepId !== undefined && source.stepId !== targetStepId) ||
    amount.subtract !== undefined
  ) {
    return null;
  }
  return amount;
}

function buildOptionalRepeatConditionalCostGate(
  effect: Effect,
  repeatStepIndex: number,
  targetMeta: Partial<RegisteredTargetedEffectActionBase>
): Pick<
  RegisteredTargetedEffectActionBase,
  | "targetGatedByConditionalCost"
  | "requiredPayCostAmount"
  | "allowFieldCorePayment"
  | "requiredCountCostAmount"
  | "requiredCountCostPlayer"
  | "requiredSelectedTargetsCountCost"
  | "requiredCoreMoveCost"
  | "requiredDiscardCost"
> {
  const repeatStep = effect.steps[repeatStepIndex];
  if (repeatStep?.connector !== "conditional_cost") return {};

  const baseGate = {
    targetGatedByConditionalCost: true as const,
    ...extractConditionalCostGate(effect, repeatStepIndex),
  };
  if (baseGate.requiredCountCostAmount !== undefined) {
    return baseGate;
  }

  const costStep = effect.steps[repeatStepIndex - 1];
  const targetStepId = repeatStep.id ?? `__step_${repeatStepIndex}`;
  if (costStep?.action.kind !== "count_decrease") {
    return baseGate;
  }

  const minimumSelectedTargets = getMinimumTargetCountForCostGate(targetMeta);
  const selectedTargetsCountCostAmount = getSelectedTargetsCountCostAmount(
    costStep.action.amount,
    targetStepId
  );
  if (selectedTargetsCountCostAmount === null) return baseGate;
  const countCostAmount = resolveSelectedTargetsCountCostAmount(
    selectedTargetsCountCostAmount,
    minimumSelectedTargets
  );
  return {
    ...baseGate,
    ...(countCostAmount > 0
      ? {
          requiredCountCostAmount: countCostAmount,
          requiredCountCostPlayer: costStep.action.player,
        }
      : {}),
    requiredSelectedTargetsCountCost: {
      amount: selectedTargetsCountCostAmount,
      targetStepId,
      player: costStep.action.player,
    },
  };
}

function scaleCountBound(
  bound: CountBound,
  multiplier: number,
  offset: number
): CountBound {
  if (typeof bound === "number") {
    return Math.max(0, Math.floor(bound)) * multiplier + offset;
  }
  if (bound.subtract !== undefined) {
    throw new Error(
      "repeat.optional dynamic additional does not support subtract CountBound"
    );
  }
  const scaledOuterMultiplier =
    bound.groupMultiplier !== undefined || bound.divisor !== undefined;
  return {
    ...bound,
    ...(scaledOuterMultiplier
      ? { groupMultiplier: (bound.groupMultiplier ?? 1) * multiplier }
      : { multiplier: (bound.multiplier ?? 1) * multiplier }),
    offset: (bound.offset ?? 0) * multiplier + offset,
    ...(bound.cap !== undefined
      ? { cap: Math.max(0, Math.floor(bound.cap)) * multiplier + offset }
      : {}),
  };
}

function buildOptionalRepeatTargetMeta(
  targetMeta: Partial<RegisteredTargetedEffectActionBase>,
  repeat: EffectStepRepeat | undefined
): Partial<RegisteredTargetedEffectActionBase> {
  if (Object.keys(targetMeta).length === 0) return targetMeta;
  const additionalRaw = repeat?.additional;
  if (additionalRaw === undefined) return targetMeta;

  const perActivationTargetCount =
    targetMeta.requiredTargetCount ?? targetMeta.maxTargetCount ?? 0;
  if (perActivationTargetCount <= 0) return targetMeta;
  const duplicateMeta =
    repeat?.allowDuplicateTargets === false
      ? {}
      : { allowDuplicateTargets: true };

  if (typeof additionalRaw === "number") {
    const activationCount = 1 + Math.max(0, Math.floor(additionalRaw));
    if (activationCount <= 1) return targetMeta;
    return {
      ...targetMeta,
      requiredTargetCount: perActivationTargetCount * activationCount,
      maxTargetCount: perActivationTargetCount * activationCount,
      ...duplicateMeta,
    };
  }

  const {
    requiredTargetCountDynamic: _requiredDyn,
    maxTargetCount: _max,
    maxTargetCountDynamic: _dyn,
    ...rest
  } = targetMeta;
  return {
    ...rest,
    requiredTargetCount: perActivationTargetCount * 2,
    maxTargetCountDynamic: scaleCountBound(
      additionalRaw,
      perActivationTargetCount,
      perActivationTargetCount
    ),
    ...duplicateMeta,
  };
}

function buildMandatoryRepeatTargetMeta(
  targetMeta: Partial<RegisteredTargetedEffectActionBase>,
  repeat: EffectStepRepeat | undefined
): Partial<RegisteredTargetedEffectActionBase> {
  if (Object.keys(targetMeta).length === 0) return targetMeta;
  const additionalRaw = repeat?.additional;
  if (additionalRaw === undefined) return targetMeta;

  const perActivationTargetCount =
    targetMeta.requiredTargetCount ?? targetMeta.maxTargetCount ?? 0;
  if (perActivationTargetCount <= 0) return targetMeta;
  const duplicateMeta =
    repeat?.allowDuplicateTargets === false
      ? {}
      : { allowDuplicateTargets: true };

  if (typeof additionalRaw === "number") {
    const activationCount = 1 + Math.max(0, Math.floor(additionalRaw));
    if (activationCount <= 1) return targetMeta;
    return {
      ...targetMeta,
      requiredTargetCount: perActivationTargetCount * activationCount,
      maxTargetCount: perActivationTargetCount * activationCount,
      ...duplicateMeta,
    };
  }

  const resolvedTargetCount = scaleCountBound(
    additionalRaw,
    perActivationTargetCount,
    perActivationTargetCount
  );
  const {
    requiredTargetCountDynamic: _requiredDyn,
    maxTargetCount: _max,
    maxTargetCountDynamic: _dyn,
    ...rest
  } = targetMeta;
  return {
    ...rest,
    requiredTargetCount: perActivationTargetCount,
    requiredTargetCountDynamic: resolvedTargetCount,
    maxTargetCountDynamic: resolvedTargetCount,
    ...duplicateMeta,
  };
}

function extractChoiceVariantPayCost(
  action: Action
): Pick<
  RegisteredTargetedEffectActionBase,
  | "requiredPayCostAmount"
  | "allowFieldCorePayment"
  | "requiredCountCostAmount"
  | "requiredCountCostPlayer"
  | "requiredCoreMoveCost"
  | "requiredDiscardCost"
> {
  return extractActionCostGate(action);
}

function extractActionCostGate(
  action: Action
): Pick<
  RegisteredTargetedEffectActionBase,
  | "requiredPayCostAmount"
  | "allowFieldCorePayment"
  | "requiredCountCostAmount"
  | "requiredCountCostPlayer"
  | "requiredCoreMoveCost"
  | "requiredDiscardCost"
> {
  if (action.kind === "pay_cost" && action.amount > 0) {
    return {
      requiredPayCostAmount: action.amount,
      ...(action.allowFieldCorePayment === true
        ? { allowFieldCorePayment: true }
        : {}),
    };
  }
  if (
    action.kind === "count_decrease" &&
    typeof action.amount === "number" &&
    action.amount > 0
  ) {
    return {
      requiredCountCostAmount: action.amount,
      requiredCountCostPlayer: action.player,
    };
  }
  // 「自分の <filter> カードのコア N 個を <destination> に置く(ことで)」型を
  // choice/triggered variant 単位で gate する。core_move from:field_card filter で
  // 固定数 N (Count が数値リテラル) のときだけ抽出する。
  // - 分配 (pendingCoreSourceAllocation) や soul/normal 配分は実行時側 (executeCoreMove) が解決する。
  //   ここで持つのは「払えるか」(候補カード群の合計可動コア合計が amount 以上) の事前判定材料のみ。
  // - 動的 Count (subtract/cap/dynamic) は変動量のため non-prematching を避けて gate しない。
  if (
    action.kind === "core_move" &&
    action.from.kind === "field_card" &&
    action.to !== undefined &&
    typeof action.amount === "number" &&
    action.amount > 0
  ) {
    return {
      requiredCoreMoveCost: {
        sourcePlayer: action.from.player,
        sourceFilter: action.from.filter,
        destination: action.to,
        amount: action.amount,
      },
    };
  }
  // BSSL01-T01 型: 「自分の手札にある <filter> カード N 枚を破棄する(ことで)」を choice
  // variant 単位で gate する。discard の fromZone が省略(=hand デフォルト, structured-zone-ops.ts
  // の `action.fromZone ?? "hand"`) or hand 単独指定で、固定数 N (Count が数値リテラル) のとき
  // だけ抽出する（動的 Count は non-prematching を避けて gate しない）。
  // 破棄候補の選択自体は既存 discard pending が解決する。
  if (
    action.kind === "discard" &&
    (action.fromZone === undefined || action.fromZone === "hand") &&
    typeof action.count === "number" &&
    action.count > 0
  ) {
    return {
      requiredDiscardCost: {
        sourcePlayer: action.player ?? "self",
        ...(action.filter !== undefined ? { sourceFilter: action.filter } : {}),
        amount: action.count,
      },
    };
  }
  return {};
}

function extractConditionalCostGate(
  effect: Effect,
  effectStepIndex: number
): Pick<
  RegisteredTargetedEffectActionBase,
  | "requiredPayCostAmount"
  | "allowFieldCorePayment"
  | "requiredCountCostAmount"
  | "requiredCountCostPlayer"
  | "requiredCoreMoveCost"
  | "requiredDiscardCost"
> {
  const step = effect.steps[effectStepIndex];
  if (step?.connector !== "conditional_cost") return {};
  const costStep = effect.steps[effectStepIndex - 1];
  return costStep ? extractActionCostGate(costStep.action) : {};
}

/**
 * extractFieldTargetingMetadata が対象を一切拾えない効果（全 step の action が対象を
 * 持たない）向けの fallback。`connector: "conditional_cost"` の直前 step から
 * コストゲート (requiredCountCostAmount 等) だけを拾う。「トラッシュにあるこのカードは
 * フラッシュタイミングでカウント-1することで手札に戻る」(move_self、対象なし) 型の
 * 対象を持たない activated 効果向けの fallback。既存の hand / triggered registration
 * 経路では、後段 conditional_cost にも使う。
 */
function extractStandaloneConditionalCostGate(
  effect: Effect
): Pick<
  RegisteredTargetedEffectActionBase,
  | "requiredPayCostAmount"
  | "allowFieldCorePayment"
  | "requiredCountCostAmount"
  | "requiredCountCostPlayer"
  | "requiredCoreMoveCost"
  | "requiredDiscardCost"
> {
  for (const [stepIndex, step] of effect.steps.entries()) {
    if (step.connector !== "conditional_cost") continue;
    const costStep = effect.steps[stepIndex - 1];
    if (
      costStep?.targetSelectionTiming === "on_step" ||
      costStep?.executionMode === "optional" ||
      shouldDeferConditionalStepChoice(effect, stepIndex - 1)
    )
      continue;
    const gate = extractConditionalCostGate(effect, stepIndex);
    if (Object.keys(gate).length > 0) return gate;
  }
  return {};
}

/**
 * field-card の対象なし activated 効果で、効果全体が必須「ことで」コストから始まる
 * 場合だけ宣言前 gate を作る。先行する無条件効果の後に任意の「そうしたとき」枝を
 * 持つ効果までコスト扱いすると、先行効果自体を宣言不能にしてしまうためである。
 */
function extractLeadingMandatoryConditionalCostGate(
  effect: Effect
): Pick<
  RegisteredTargetedEffectActionBase,
  | "requiredPayCostAmount"
  | "allowFieldCorePayment"
  | "requiredCountCostAmount"
  | "requiredCountCostPlayer"
  | "requiredCoreMoveCost"
  | "requiredDiscardCost"
> {
  const costStep = effect.steps[0];
  const effectStep = effect.steps[1];
  if (
    costStep === undefined ||
    effectStep?.connector !== "conditional_cost" ||
    costStep.executionMode === "optional" ||
    (costStep.condition?.length ?? 0) > 0
  ) {
    return {};
  }
  return extractActionCostGate(costStep.action);
}

function extractChoiceVariantTargeting(
  effect: Effect,
  choiceStepIndex: number,
  choiceIndex: number
): Partial<RegisteredTargetedEffectActionBase> {
  const choiceStep = effect.steps[choiceStepIndex]!;
  const choiceEntry =
    choiceIndex === 0 ? undefined : choiceStep.choice?.[choiceIndex - 1];
  const direct = extractFieldTargetingFromAction(
    choiceEntry?.action ?? choiceStep.action
  );
  const directWithStepId =
    Object.keys(direct).length > 0
      ? {
          ...direct,
          targetStepId: choiceStep.id ?? `__step_${choiceStepIndex}`,
          ...(choiceStep.connector === "conditional_cost"
            ? { targetGatedByConditionalCost: true }
            : {}),
          ...extractConditionalCostGate(effect, choiceStepIndex),
        }
      : direct;
  const choiceStepId = choiceStep.id;
  if (!choiceStepId) return directWithStepId;

  let followup:
    | { step: Effect["steps"][number]; stepIndex: number }
    | undefined;
  for (
    let stepIndex = choiceStepIndex + 1;
    stepIndex < effect.steps.length;
    stepIndex++
  ) {
    const step = effect.steps[stepIndex]!;
    if (step.executionMode === "optional") {
      continue;
    }
    if (
      hasRefChoiceStepCondition(
        step.stepCondition,
        choiceStepId,
        choiceIndex
      ) &&
      Object.keys(extractFieldTargetingFromAction(step.action)).length > 0
    ) {
      followup = { step, stepIndex };
      break;
    }
  }
  if (!followup) return directWithStepId;

  const followupTargeting = extractFieldTargetingFromAction(
    followup.step.action
  );
  // choice 本体と ref_choice 後続 step がそれぞれ対象を取る場合、両方を一つの
  // 宣言時対象グループとして保持する。後続 step の scalar targeting で前者を上書きすると、
  // 分岐の先頭 action が対象なしで解決されてしまう (BSAZ02-C13)。
  const followupWithStepId = {
    ...followupTargeting,
    targetStepId: followup.step.id ?? `__step_${followup.stepIndex}`,
    ...(followup.step.connector === "conditional_cost"
      ? { targetGatedByConditionalCost: true }
      : {}),
    ...(followup.step.chooser ? { chooser: followup.step.chooser } : {}),
  };
  // 片方だけが対象を取る場合は既存の単一 targetStepId 表現を保持する。両方が対象を
  // 取る場合だけ targetGroups 化し、選択済みIDを各 step へ配分する。
  const targetMetadatas = [directWithStepId, followupWithStepId].filter(
    (targeting) => Object.keys(targeting).length > 0
  );
  return mergeFieldTargetingMetadatas(effect, targetMetadatas);
}

/** Effect.steps からフィールド対象メタデータを抽出 */
function extractFieldTargetingMetadata(
  effect: Effect,
  options: { beforeStepIndex?: number } = {}
): Partial<RegisteredTargetedEffectActionBase> {
  const targets: Partial<RegisteredTargetedEffectActionBase>[] = [];
  for (const [stepIndex, step] of effect.steps.entries()) {
    if (
      options.beforeStepIndex !== undefined &&
      stepIndex >= options.beforeStepIndex
    ) {
      break;
    }
    if (
      step.targetSelectionTiming === "on_step" &&
      step.repeat?.optional !== true
    ) {
      continue;
    }
    if (step.executionMode === "optional") {
      continue;
    }
    const result = extractFieldTargetingFromAction(step.action);
    if (Object.keys(result).length > 0) {
      const repeatAdjustedResult =
        step.repeat?.optional !== true && step.repeat?.additional !== undefined
          ? buildMandatoryRepeatTargetMeta(result, step.repeat)
          : result;
      // D-2 Phase 2 chooser: 対象を持つ step の chooser を伝搬
      // 空撃ち制御: 対象 step が「ことで」コストの効果側 (connector:conditional_cost)
      // なら targetGatedByConditionalCost を立て、対象 0 体での空撃ちを禁止する。
      targets.push({
        ...repeatAdjustedResult,
        targetStepId: step.id ?? `__step_${stepIndex}`,
        ...(step.chooser ? { chooser: step.chooser } : {}),
        ...(step.connector === "conditional_cost"
          ? {
              targetGatedByConditionalCost: true,
              ...extractConditionalCostGate(effect, stepIndex),
            }
          : {}),
      });
    }
  }
  return mergeFieldTargetingMetadatas(effect, targets);
}

function extractBurstTargetingMetadata(
  effect: Effect
): Partial<RegisteredTargetedEffectActionBase> {
  const targets: Partial<RegisteredTargetedEffectActionBase>[] = [];
  for (const [stepIndex, step] of effect.steps.entries()) {
    if (
      step.targetSelectionTiming === "on_step" &&
      step.repeat?.optional !== true
    ) {
      continue;
    }
    if (step.executionMode === "optional") {
      continue;
    }
    const result = extractFieldTargetingFromAction(step.action);
    if (Object.keys(result).length === 0) continue;
    const repeatAdjustedResult =
      step.repeat?.optional !== true && step.repeat?.additional !== undefined
        ? buildMandatoryRepeatTargetMeta(result, step.repeat)
        : result;
    targets.push({
      ...repeatAdjustedResult,
      targetStepId: step.id ?? `__step_${stepIndex}`,
      ...(step.chooser ? { chooser: step.chooser } : {}),
      ...(step.connector === "conditional_cost"
        ? {
            targetGatedByConditionalCost: true,
            ...extractConditionalCostGate(effect, stepIndex),
          }
        : {}),
    });
  }
  return mergeFieldTargetingMetadatas(effect, targets);
}

function mergeFieldTargetingMetadatas(
  effect: Effect,
  targets: Partial<RegisteredTargetedEffectActionBase>[]
): Partial<RegisteredTargetedEffectActionBase> {
  if (targets.length <= 1) return targets[0] ?? {};

  const requiredTargetCount = targets.reduce(
    (sum, target) => sum + (target.requiredTargetCount ?? 0),
    0
  );
  const maxTargetCount = targets.reduce(
    (sum, target) =>
      sum + (target.maxTargetCount ?? target.requiredTargetCount ?? 0),
    0
  );
  const zones = targets.flatMap((target) => target.candidateTargetZones ?? []);
  const filters = targets
    .map((target) => target.targetCardFilter)
    .filter(
      (filter): filter is import("../dsl-types").CardFilter =>
        filter !== undefined
    );
  const scopes = targets
    .map((target) => target.candidateTargetPlayerScope)
    .filter(
      (scope): scope is LegalActionTargetPlayerScope => scope !== undefined
    );
  const firstScope = scopes[0];
  const mergedScope =
    firstScope !== undefined && scopes.every((scope) => scope === firstScope)
      ? firstScope
      : "any";

  return {
    requiredTargetCount,
    ...(maxTargetCount !== requiredTargetCount ? { maxTargetCount } : {}),
    ...(zones.length > 0
      ? { candidateTargetZones: Array.from(new Set(zones)) }
      : {}),
    ...(mergedScope !== undefined
      ? { candidateTargetPlayerScope: mergedScope }
      : {}),
    ...(filters.length === 1
      ? { targetCardFilter: filters[0] }
      : filters.length > 1
        ? { targetCardFilter: { filterOr: filters } }
        : {}),
    targetGroups: targets.flatMap(targetGroupsFromMeta),
    ...(effect.allowDuplicateTargets === true ||
    targets.some((target) => target.allowDuplicateTargets === true)
      ? { allowDuplicateTargets: true }
      : {}),
    ...(targets.some((target) => target.targetGatedByConditionalCost === true)
      ? { targetGatedByConditionalCost: true }
      : {}),
    ...(targets.some((target) => target.targetRequiresFullCount === true)
      ? { targetRequiresFullCount: true }
      : {}),
    ...(targets.some((target) => target.sourceAttachedChildrenOnly === true)
      ? { sourceAttachedChildrenOnly: true }
      : {}),
    ...(targets.some((target) => target.starGarmentTargetEligibleOnly === true)
      ? { starGarmentTargetEligibleOnly: true }
      : {}),
    ...(targets.find(
      (target) => target.sourceRequiredOpenUnderCardSlot !== undefined
    )?.sourceRequiredOpenUnderCardSlot !== undefined
      ? {
          sourceRequiredOpenUnderCardSlot: targets.find(
            (target) => target.sourceRequiredOpenUnderCardSlot !== undefined
          )!.sourceRequiredOpenUnderCardSlot,
        }
      : {}),
    ...(targets.find((target) => target.sourceRequiredUnderCard !== undefined)
      ?.sourceRequiredUnderCard !== undefined
      ? {
          sourceRequiredUnderCard: targets.find(
            (target) => target.sourceRequiredUnderCard !== undefined
          )!.sourceRequiredUnderCard,
        }
      : {}),
  };
}

/**
 * 神技/導技/界放/契約技 (divine_skill) 本体 effect から、窓後対象選択
 * (`getStackTargetSelection`) 用の対象 registration を生成する。
 *
 * divineSkills の解決経路 (`resolveDeferredDivineSkillStack`) は executeEffect を
 * 直接呼ぶため、対象を要する本体 (vanish/destroy/bounce/send_to_deck 等) でも候補が
 * 機械選択されてしまっていた。本関数で対象メタを抽出し、deferred 解決の汎用対象選択
 * パイプライン (pendingEffectTargetSelection) に載せることで、プレイヤー選択を可能にする。
 *
 * - 単一 effect / 複数 effect いずれも、最初に対象を要する effect のメタを採用する
 *   (現行カードはすべて単一 effect)。
 * - コア消費はエンジンが発揮コストとして支払うため、本体 step に conditional_cost は無く
 *   `targetGatedByConditionalCost` は立たない (対象不在なら空撃ち＝不発)。
 * - 対象を要する step が無ければ null (対象選択不要)。
 */
export function generateDivineSkillTargetRegistration(
  skillEffects: readonly Effect[] | undefined
):
  | (RegisteredTargetedEffectActionBase & {
      choices?: ReturnType<typeof buildChoiceVariants>;
    })
  | null {
  if (!skillEffects) return null;
  for (const effect of skillEffects) {
    // choice ステップ持ちの effect は各分岐 (destroy 対象 A / destroy 対象 B 等) が
    // 別々の対象メタを持ちうるため、buildChoiceVariants (magic/field 等と共通 SSOT) で
    // 変種展開する。窓後対象選択は lookupRegistrationForStack の choiceIndex マージが
    // 変種を選び直す (divineSkillChoiceIndex)。
    const choiceStepIndex = getDeclarationChoiceStepIndex(effect);
    if (choiceStepIndex >= 0) {
      const variants = buildChoiceVariantsWithSharedTargeting(
        effect,
        choiceStepIndex
      );
      const hasTargeting = variants.some(
        (variant) =>
          variant.requiredTargetCount !== undefined ||
          variant.maxTargetCount !== undefined ||
          variant.maxTargetCountDynamic !== undefined
      );
      if (hasTargeting) {
        return { ...variants[0]!, choices: variants };
      }
    }
    const meta = extractFieldTargetingMetadata(effect);
    if (
      meta.requiredTargetCount !== undefined ||
      meta.maxTargetCount !== undefined ||
      meta.maxTargetCountDynamic !== undefined
    ) {
      return meta;
    }
  }
  return null;
}

function getActionTarget(action: Action): TargetSpec | undefined {
  switch (action.kind) {
    case "reveal_hand":
    case "turn_face_down":
      return action.target;
    case "destroy":
    case "vanish":
    case "bp_compare_destroy":
    case "designate_attack":
    case "bounce":
    case "send_to_deck":
    case "remove_from_game":
    case "recover":
    case "exhaust":
    case "prevent_next_recovery":
    case "set_exhaust_state":
    case "bp_modify":
    case "symbol_add":
    case "under_card_slot_capacity_grant":
    case "under_card_role_grant":
    case "override_properties":
    case "prevent_battle":
    case "require_battle_cost":
    case "require_attack_exhaust_cost":
    case "require_battle_destroy_cost":
    case "unblockable":
    case "allow_block_while_exhausted":
    case "allow_attack_while_exhausted":
    case "allow_tapless_battle_declare":
    case "block_unblockable":
    case "effect_immunity":
    case "effect_resistance":
    case "suppress_effect":
      return action.target;
    case "core_move":
    case "restrict_recovery":
      return action.target;
    case "move_card":
      return action.target;
    case "search_zone":
      return action.target;
    case "borrow_magic_effect":
      // 借用元カード1枚の選択。effect-interpreter.getActionTargetSpec と SSOT を揃える。
      return action.target;
    case "borrow_card_event_effect":
      // card_event 効果借用の借用元カード1枚の選択。
      return action.target;
    case "rebirth":
      // 外部転醒（action.target 指定時のみ対象メタを生成）。BSSA01-XX01 神技4
      // 「夜錆の転醒前1つの【転醒】を発揮する」型で、divine_skill 解決後の
      // 対象選択 pending を生成するために必要。effect-interpreter case "rebirth"
      // の getActionTargetSpec と同じ理由で SSOT を 2 箇所に揃える。
      return action.target;
    case "core_distribute":
      // コア配置の配置先 TargetSpec。{min, max} 型可変選択 (「N体まで」) や
      // 候補>N の player 選択を pending target selection 化するために expose。
      // mode="player_choice" は executeCoreDistribute 側で pendingCoreDistribution を
      // 別 pending として生成する経路だが、配置先候補の絞り込みは共通 TargetSpec で行う。
      return action.to;
    case "core_set_to_level":
      return action.target;
    case "discard_set_burst":
    case "discard":
      return action.target;
    case "place_star_garment":
    case "swap_star_garment":
    case "bullet_edit":
    case "swap_bullet_edit":
      return action.target;
    case "quartz_set":
      // クォーツとしてセットするカード1枚の選択。effect-interpreter.getActionTargetSpec と SSOT を揃える。
      return action.target;
    case "advent":
      // ENGINE-effect-triggered-advent-declare: 煌臨させるカード1枚の選択。
      // effect-interpreter.getActionTargetSpec と SSOT を揃える。
      return action.target;
    case "noop":
      // 選択専用 step。target を持つ noop は後続 ref step の入力として
      // production legal-action の対象グループに expose する。
      return action.target;
    default:
      return undefined;
  }
}

interface TriggerRegistrationTarget {
  eventKind: TriggerEventKind;
  causeOverride?: TriggerEventCause | readonly TriggerEventCause[];
}

function expandCardEventRegistrationTargets(
  effect: Effect,
  sourceTextLines: readonly string[] | undefined,
  eventKinds: readonly TriggerEventKind[]
): TriggerRegistrationTarget[] {
  const targets: TriggerRegistrationTarget[] = eventKinds.map((eventKind) => ({
    eventKind,
  }));
  if (
    effect.timing.kind !== "card_event" ||
    !eventKinds.includes("summon") ||
    eventKinds.includes("brave_combined")
  ) {
    return targets;
  }
  const triggerPhrases = deriveTriggerPhrasesFromTextRefs(
    effect,
    sourceTextLines
  );
  if (!triggerPhrases?.includes("契約合体時")) {
    return targets;
  }
  targets.push({
    eventKind: "brave_combined",
    causeOverride: "contract_combine",
  });
  return targets;
}

/** effects から RegisteredTriggeredEffectAction[] を自動生成 */
export function generateTriggeredEffectRegistrations(
  definition: CardDefinition
): readonly RegisteredTriggeredEffectAction[] {
  if (!definition.effects || definition.effects.length === 0) return [];

  const registrations: RegisteredTriggeredEffectAction[] = [];

  for (let effectIdx = 0; effectIdx < definition.effects.length; effectIdx++) {
    const effect = definition.effects[effectIdx]!;
    // inline 効果はキューを経由せず turn-system 等のシステム処理側で直接実行する。
    // triggered registration からは除外する。
    if (effect.inline) continue;
    const eventKinds = resolveTriggerEvents(effect.timing);
    const registrationTargets = expandCardEventRegistrationTargets(
      effect,
      definition.textLines,
      eventKinds
    );
    if (registrationTargets.length === 0) continue;

    const sourceKind = getTriggeredSourceKindForCategory(
      definition.printedCategory
    );
    if (!sourceKind) continue;

    const explicitSourceZoneField =
      effect.applicability?.zone !== undefined
        ? { sourceZone: effect.applicability.zone }
        : {};
    // eventKind 別の sourceZone デフォルト:
    // - after_cost_paid はコスト支払い直後 (in_use ゾーン) に発火するため、
    //   applicability.zone 未指定時は ["field", "in_use"] を許可する
    const sourceZoneFieldFor = (
      eventKind: TriggerEventKind
    ): {
      sourceZone?:
        | import("../dsl-types").ApplicabilityZone
        | readonly import("../dsl-types").ApplicabilityZone[];
    } => {
      if (effect.applicability?.zone !== undefined) {
        return explicitSourceZoneField;
      }
      if (eventKind === "game_start") {
        return { sourceZone: "anywhere" };
      }
      if (eventKind === "after_cost_paid") {
        return { sourceZone: ["field", "in_use"] };
      }
      return {};
    };

    let whoseField: { whose?: import("../model").EffectPlayerRef } = {};
    // ENGINE-leave-field-third-party-opponent-source-whose: game_event の sourceWhose opt-in。
    // actingPlayerId が「離脱カードのコントローラ」等リスナー自身と別意味論を持つ family
    // (leave_field/destroy 等) の第三者 opponent 観測効果向け。既定 whose=self の誤ブロックを
    // 明示的に外す (model.ts Timing.game_event.sourceWhose 参照)。
    if (
      effect.timing.kind === "game_event" &&
      effect.timing.sourceWhose !== undefined
    ) {
      whoseField = { whose: effect.timing.sourceWhose };
    }
    const exactGameEventKindField =
      effect.timing.kind === "game_event" &&
      effect.timing.exactEventKind === true
        ? { exactGameEventKind: true }
        : {};
    // card_event / game_event の cause（離脱原因絞り込み）
    const timingCause =
      effect.timing.kind === "card_event" || effect.timing.kind === "game_event"
        ? effect.timing.cause
        : undefined;
    // P3-14 C-5: card_event / game_event の action 絞り込み
    // (battle_end のアタック側 "attack" / ブロック側 "block")。
    const timingAction =
      effect.timing.kind === "card_event" || effect.timing.kind === "game_event"
        ? effect.timing.action
        : undefined;
    const timingEffectScope =
      effect.timing.kind === "card_event" || effect.timing.kind === "game_event"
        ? effect.timing.effectScope
        : undefined;
    const timingEffectActivation =
      effect.timing.kind === "game_event"
        ? effect.timing.triggerEffectTiming
        : undefined;
    const timingEffectActivationLabel =
      effect.timing.kind === "game_event"
        ? effect.timing.triggerEffectLabel
        : undefined;
    const timingEffectActionKind =
      effect.timing.kind === "game_event"
        ? effect.timing.triggerEffectActionKind
        : undefined;
    const timingTriggerActivationZone =
      effect.timing.kind === "game_event"
        ? effect.timing.triggerActivationZone
        : undefined;
    const buildStepMatcherForEventKind = (
      eventKind: TriggerEventKind,
      causeOverride?: TriggerEventCause | readonly TriggerEventCause[]
    ): {
      eventMatcher?: import("./trigger-system").TriggerEventMatcher;
    } => {
      let stepMatcher: {
        eventMatcher?: import("./trigger-system").TriggerEventMatcher;
      } = {};
      const effectiveTimingCause = causeOverride ?? timingCause;
      if (effect.timing.kind === "phase") {
        stepMatcher = {
          eventMatcher: {
            family: "step_timing" as const,
            ...(effect.timing.step !== undefined
              ? { step: effect.timing.step as import("../model").Step }
              : {}),
            subPhase: effect.timing.subPhase ?? "start",
          },
        };
      } else if (
        effect.timingScope?.period &&
        effect.timingScope.period !== "turn"
      ) {
        // game_event/card_event + timingScope.period → step フィルタ付き eventMatcher。
        // family/actionKind/causeKind は trigger-system の既存変換を使い、同一 family 内の
        // summon/place/advent などを timingScope 付与で混線させない。
        const structuredEvent = triggerEventKindToStructuredEvent(eventKind);
        const family = structuredEvent.family;
        if (family) {
          stepMatcher = {
            eventMatcher: {
              family,
              ...("actionKind" in structuredEvent &&
              structuredEvent.actionKind !== undefined
                ? { actionKind: structuredEvent.actionKind }
                : {}),
              ...("causeKind" in structuredEvent &&
              structuredEvent.causeKind !== undefined
                ? { causeKind: structuredEvent.causeKind }
                : {}),
              step: effect.timingScope.period as import("../model").Step,
              ...(effectiveTimingCause !== undefined
                ? { cause: effectiveTimingCause }
                : {}),
            },
          };
        }
      } else if (effectiveTimingCause !== undefined) {
        // card_event / game_event + cause 指定 → cause フィルタ付き eventMatcher
        const family = EVENT_KIND_TO_FAMILY[eventKind];
        if (family) {
          // causeKind は eventKind から導出（destroy/vanish/bounce のみ）
          const causeKind =
            eventKind === "destroy"
              ? ("destroy" as const)
              : eventKind === "vanish"
                ? ("vanish" as const)
                : eventKind === "bounce"
                  ? ("bounce" as const)
                  : undefined;
          stepMatcher = {
            eventMatcher: {
              family,
              ...(causeKind !== undefined ? { causeKind } : {}),
              cause: effectiveTimingCause,
            },
          };
        }
      }
      // P3-14 C-5: timing.action 指定時は eventMatcher に actionKind を合成する。
      // 既存 branch で eventMatcher 未生成 (cause / period 無し) の場合も family から新規生成。
      if (timingAction !== undefined) {
        const family = EVENT_KIND_TO_FAMILY[eventKind];
        if (family) {
          stepMatcher = {
            eventMatcher: {
              family,
              ...(stepMatcher.eventMatcher ?? {}),
              actionKind: timingAction,
            },
          };
        }
      }
      if (timingEffectActivation !== undefined) {
        const family = EVENT_KIND_TO_FAMILY[eventKind];
        if (family) {
          stepMatcher = {
            eventMatcher: {
              family,
              ...(stepMatcher.eventMatcher ?? {}),
              effectActivationTiming: timingEffectActivation,
            },
          };
        }
      }
      if (timingEffectActivationLabel !== undefined) {
        const family = EVENT_KIND_TO_FAMILY[eventKind];
        if (family) {
          stepMatcher = {
            eventMatcher: {
              family,
              ...(stepMatcher.eventMatcher ?? {}),
              effectActivationLabel: timingEffectActivationLabel,
            },
          };
        }
      }
      if (timingEffectActionKind !== undefined) {
        const family = EVENT_KIND_TO_FAMILY[eventKind];
        if (family) {
          stepMatcher = {
            eventMatcher: {
              family,
              ...(stepMatcher.eventMatcher ?? {}),
              effectActionKind: timingEffectActionKind,
            },
          };
        }
      }
      if (timingTriggerActivationZone !== undefined) {
        const family = EVENT_KIND_TO_FAMILY[eventKind];
        if (family) {
          stepMatcher = {
            eventMatcher: {
              family,
              ...(stepMatcher.eventMatcher ?? {}),
              triggerActivationZone: timingTriggerActivationZone,
            },
          };
        }
      }
      if (timingEffectScope !== undefined) {
        const family = EVENT_KIND_TO_FAMILY[eventKind];
        if (family) {
          stepMatcher = {
            eventMatcher: {
              family,
              ...(stepMatcher.eventMatcher ?? {}),
              effectScope: timingEffectScope,
            },
          };
        }
      }
      return stepMatcher;
    };
    if (effect.timing.kind === "phase") {
      // 省略時もイベントのターン所有者で判定する。controller別pendingへの分割後に
      // actingPlayerIdを参照すると「相手開始時」のキューへ自分開始時効果が混入する。
      whoseField = { whose: effect.timing.whose ?? "self" };
    }

    // P3-24 Phase 2: choice ステップを持つ場合は 1 registration に集約 (choices[] で変種を保持)
    const choiceStepIndex = getDeclarationChoiceStepIndex(effect);
    const choiceStep =
      choiceStepIndex >= 0 ? effect.steps[choiceStepIndex] : undefined;
    const optionalRepeatStepIndex = findOptionalRepeatStepIndex(effect);
    const optionalRepeatStep =
      optionalRepeatStepIndex >= 0
        ? effect.steps[optionalRepeatStepIndex]
        : undefined;

    // P3-73: timingScope（『自分の/相手の』＋ステップ）を triggered registration にも伝搬。
    // source 候補列挙時に isTimingScopeActive で current step / activePlayer と照合し、
    // 「自分のアタックステップ中」型 (咲夜) を相手ターンや別ステップで誤発火させない。
    const timingScopeField = effect.timingScope
      ? { timingScope: effect.timingScope }
      : {};

    // effect レベル usageLimit = choice 変種間で共有される制限 (P3-24)。
    // M01「パチュリー・ノーレッジ」の private 誘発のように、複数同名カードが
    // 同タイミングで誘発したとき maxCount を超えた declare を弾くため、
    // effect レベルで宣言された usageLimit を triggered registration に伝搬する。
    // choiceStep.usageLimit / choice[k].usageLimit は「ターンに1回ずつ」(変種ごとに独立)
    // であり、共有制限へ潰さず choices[] の variant.usageLimit として保持する (C05)。
    const effectUsageLimit = effect.usageLimit;
    const fieldTargetingMetadata = extractFieldTargetingMetadata(effect);
    const targetingMetadata =
      Object.keys(fieldTargetingMetadata).length > 0
        ? fieldTargetingMetadata
        : extractStandaloneConditionalCostGate(effect);

    for (const { eventKind, causeOverride } of registrationTargets) {
      const perEventStepMatcher = buildStepMatcherForEventKind(
        eventKind,
        causeOverride
      );
      if (choiceStep || optionalRepeatStep) {
        const choices = choiceStep
          ? buildChoiceVariantsWithSharedTargeting(effect, choiceStepIndex)
          : buildOptionalRepeatVariants(effect, optionalRepeatStepIndex);
        const optionalRepeatBaseTargetingMetadata =
          choiceStep === undefined && optionalRepeatStep !== undefined
            ? buildOptionalRepeatBaseTargetingMetadata(
                effect,
                optionalRepeatStepIndex,
                targetingMetadata
              )
            : {};
        registrations.push({
          sourceKind,
          eventKind,
          effectCategory: "triggered",
          ...(effect.executionMode
            ? { executionMode: effect.executionMode }
            : {}),
          ...(effect.triggerPriority
            ? { triggerPriority: effect.triggerPriority }
            : {}),
          ...(effect.applicability
            ? { applicability: effect.applicability }
            : {}),
          ...spreadUsageLimit(effectUsageLimit),
          ...spreadLimitGroupId(effect.limitGroupId),
          ...spreadOccurrenceGate(effect.occurrenceGate),
          ...inferRequiredTextRoleUnderSourceRole(definition, effect),
          ...inferRequiredQuartzInheritedSourceRole(definition, effect),
          ...inferRequiredCombinedBraveSourceRole(definition, effect),
          ...perEventStepMatcher,
          ...exactGameEventKindField,
          ...whoseField,
          ...timingScopeField,
          ...sourceZoneFieldFor(eventKind),
          ...spreadSuppressionEffectDescriptor(effect, {
            sourceDefinitionId: definition.cardNo,
            sourceKind: getDescriptorSourceKindForCategory(
              definition.printedCategory
            ),
            eventAction: eventKind,
            effectIndex: effectIdx,
            sourceTextLines: definition.textLines,
          }),
          ...spreadPreventionLevel(effect),
          ...optionalRepeatBaseTargetingMetadata,
          effectIndex: effectIdx,
          choices,
        });
      } else {
        registrations.push({
          sourceKind,
          eventKind,
          effectCategory: "triggered",
          ...(effect.executionMode
            ? { executionMode: effect.executionMode }
            : {}),
          ...(effect.triggerPriority
            ? { triggerPriority: effect.triggerPriority }
            : {}),
          ...(effect.applicability
            ? { applicability: effect.applicability }
            : {}),
          ...targetingMetadata,
          ...spreadUsageLimit(effectUsageLimit),
          ...spreadLimitGroupId(effect.limitGroupId),
          ...spreadOccurrenceGate(effect.occurrenceGate),
          ...inferRequiredTextRoleUnderSourceRole(definition, effect),
          ...inferRequiredQuartzInheritedSourceRole(definition, effect),
          ...inferRequiredCombinedBraveSourceRole(definition, effect),
          ...perEventStepMatcher,
          ...exactGameEventKindField,
          ...whoseField,
          ...timingScopeField,
          ...sourceZoneFieldFor(eventKind),
          ...spreadSuppressionEffectDescriptor(effect, {
            sourceDefinitionId: definition.cardNo,
            sourceKind: getDescriptorSourceKindForCategory(
              definition.printedCategory
            ),
            eventAction: eventKind,
            effectIndex: effectIdx,
            sourceTextLines: definition.textLines,
          }),
          ...spreadPreventionLevel(effect),
          effectIndex: effectIdx,
        });
      }
    }
  }

  return registrations;
}

/** effects から RegisteredBattleImmediateEffectAction[] を自動生成 */
export function generateBattleImmediateEffectRegistrations(
  definition: CardDefinition
): readonly RegisteredBattleImmediateEffectAction[] {
  if (!definition.effects || definition.effects.length === 0) return [];

  const registrations: RegisteredBattleImmediateEffectAction[] = [];

  for (let effectIdx = 0; effectIdx < definition.effects.length; effectIdx++) {
    const effect = definition.effects[effectIdx]!;
    const timings = resolveBattleTimings(effect.timing);
    if (timings.length === 0) continue;

    const sourceKind = getBattleSourceKindForCategory(
      definition.printedCategory
    );
    if (!sourceKind) continue;
    assertOccurrenceGateSupportedHere(definition, effect, "battle_immediate");

    // P3-24 Phase 2: choice ステップを持つ場合は 1 registration に集約 (choices[] で変種を保持)
    const choiceStepIndex = getDeclarationChoiceStepIndex(effect);
    const choiceStep =
      choiceStepIndex >= 0 ? effect.steps[choiceStepIndex] : undefined;
    const optionalRepeatStepIndex = findOptionalRepeatStepIndex(effect);
    const optionalRepeatStep =
      optionalRepeatStepIndex >= 0
        ? effect.steps[optionalRepeatStepIndex]
        : undefined;

    // effect レベル usageLimit = choice 変種間で共有される制限 (P3-24)。
    // 同名カード 2 体が同じ攻撃/ブロックタイミングで誘発する場合の使用制限ガードに必要。
    // 変種別制限 (step/choice の usageLimit =「1回ずつ」) は choices[] 側に保持する。
    const effectUsageLimit = effect.usageLimit;
    const declarationStepUsage = spreadDeclarationStepUsage(effect);

    for (const timing of timings) {
      if (choiceStep || optionalRepeatStep) {
        const choices = choiceStep
          ? buildChoiceVariantsWithSharedTargeting(effect, choiceStepIndex)
          : buildOptionalRepeatVariants(effect, optionalRepeatStepIndex);
        const optionalRepeatBaseTargetingMetadata =
          choiceStep === undefined && optionalRepeatStep !== undefined
            ? buildOptionalRepeatBaseTargetingMetadata(
                effect,
                optionalRepeatStepIndex,
                extractFieldTargetingMetadata(effect)
              )
            : {};
        registrations.push({
          timing,
          sourceKind,
          effectCategory: "triggered",
          ...(effect.executionMode
            ? { executionMode: effect.executionMode }
            : {}),
          ...inferRequiredTextRoleUnderSourceRole(definition, effect),
          ...inferRequiredCombinedBraveSourceRole(definition, effect),
          ...spreadUsageLimit(effectUsageLimit),
          ...declarationStepUsage,
          ...spreadLimitGroupId(effect.limitGroupId),
          ...spreadSuppressionEffectDescriptor(effect, {
            sourceDefinitionId: definition.cardNo,
            sourceKind: getDescriptorSourceKindForCategory(
              definition.printedCategory
            ),
            eventAction: timing,
            effectIndex: effectIdx,
            sourceTextLines: definition.textLines,
          }),
          ...spreadPreventionLevel(effect),
          ...optionalRepeatBaseTargetingMetadata,
          effectIndex: effectIdx,
          choices,
        });
      } else {
        registrations.push({
          timing,
          sourceKind,
          effectCategory: "triggered",
          ...(effect.executionMode
            ? { executionMode: effect.executionMode }
            : {}),
          ...inferRequiredTextRoleUnderSourceRole(definition, effect),
          ...inferRequiredCombinedBraveSourceRole(definition, effect),
          ...extractFieldTargetingMetadata(effect),
          ...spreadUsageLimit(effectUsageLimit),
          ...declarationStepUsage,
          ...spreadLimitGroupId(effect.limitGroupId),
          ...spreadSuppressionEffectDescriptor(effect, {
            sourceDefinitionId: definition.cardNo,
            sourceKind: getDescriptorSourceKindForCategory(
              definition.printedCategory
            ),
            eventAction: timing,
            effectIndex: effectIdx,
            sourceTextLines: definition.textLines,
          }),
          ...spreadPreventionLevel(effect),
          effectIndex: effectIdx,
        });
      }
    }
  }

  return registrations;
}

/** effects から RegisteredFieldCardEffectAction[] を自動生成 */
export function generateFieldCardEffectRegistrations(
  definition: CardDefinition
): readonly RegisteredFieldCardEffectAction[] {
  if (!definition.effects || definition.effects.length === 0) return [];

  const registrations: RegisteredFieldCardEffectAction[] = [];

  for (const [effectIndex, effect] of definition.effects.entries()) {
    if (effect.timing.kind !== "activated") continue;
    // DSL audit bookkeeping may retain an activated timing with no executable step
    // (for example a grandwalker divine skill implemented through grandwalkerData).
    // Such an entry has no resolution body, so registering it as a field action only
    // creates a repeatable no-op declaration.
    if (effect.steps.length === 0) continue;
    // 手札起動効果 (applicability.zone が hand/set_aside/trash のみ) は手札版生成器
    // (generateHandActivatedEffectRegistrations) が扱う。フィールド効果としては登録しない。
    if (
      effect.applicability?.zone !== undefined &&
      isHandActivatedOnlyApplicabilityZone(effect.applicability.zone)
    )
      continue;
    // 手札/手元/トラッシュ/煌臨元/魂状態からの自己召喚許可は
    // getAvailableHandSummonPermissionLegalActions が summon action として扱う。
    // field-card registry にも載せると、同じ効果が use_field_card_effect として
    // 二重候補化し、解決側で no-op になる。
    if (getHandSummonPermissionSpec(effect) !== undefined) continue;
    // 魂状態化（enter_soul_state）の起動効果は activate_soul_state legal action
    // 専用で処理する (getAvailableActivateSoulStateLegalActions)。汎用 field-card
    // registry に載せると BSLH01-CX01[3] の applicability:["hand","set_aside"] 型
    // で sibling code path に漏れる (verifier 反証 2026-06-25)。
    if (effect.steps.some((s) => s.action?.kind === "enter_soul_state"))
      continue;
    // 通常のマジック使用は generateMagicRegistrations が扱う。
    // ミラージュ/バーストセット中など、明示ゾーンを持つ magic 効果だけ field source 化する。
    if (
      (definition.printedCategory === "magic" ||
        isMagicCompatibleDefinition(definition)) &&
      effect.applicability?.zone === undefined
    )
      continue;
    const mode = effect.timing.mode;
    if (mode !== "main" && mode !== "flash" && mode !== "stack") continue;
    if (mode === "stack" && effect.stub) continue;

    const sourceKind = getSourceKindForCategory(definition.printedCategory);
    if (!sourceKind) continue;
    assertOccurrenceGateSupportedHere(definition, effect, "field_card");

    // ターン1回などの使用制限を effect → registration に伝搬。
    // 非 choice ステップでは extractFieldTargetingMetadata で usageLimit を
    // 落としていたが、紅魔館 / ヴワル魔法図書館 / [導界者]系の per_instance turn 等が
    // GUI から無制限に発動できる状態になっていた。
    const choiceStepIndex = getDeclarationChoiceStepIndex(effect);
    const choiceStep =
      choiceStepIndex >= 0 ? effect.steps[choiceStepIndex] : undefined;
    const optionalRepeatStepIndex = findOptionalRepeatStepIndex(effect);
    const optionalRepeatStep =
      optionalRepeatStepIndex >= 0
        ? effect.steps[optionalRepeatStepIndex]
        : undefined;
    const effectUsageLimit = effect.usageLimit ?? choiceStep?.usageLimit;
    const fieldTargetingMetadata = extractFieldTargetingMetadata(effect);
    const targetingOrChoices = choiceStep
      ? {
          choices: buildChoiceVariantsWithSharedTargeting(
            effect,
            choiceStepIndex
          ),
        }
      : optionalRepeatStep
        ? {
            ...buildOptionalRepeatBaseTargetingMetadata(
              effect,
              optionalRepeatStepIndex,
              fieldTargetingMetadata
            ),
            choices: buildOptionalRepeatVariants(
              effect,
              optionalRepeatStepIndex
            ),
          }
        : Object.keys(fieldTargetingMetadata).length > 0
          ? fieldTargetingMetadata
          : extractLeadingMandatoryConditionalCostGate(effect);

    registrations.push({
      effectIndex,
      ...spreadSuppressionEffectDescriptor(effect, {
        sourceDefinitionId: definition.cardNo,
        sourceKind: getDescriptorSourceKindForCategory(
          definition.printedCategory
        ),
        effectIndex,
        sourceTextLines: definition.textLines,
      }),
      ...spreadPreventionLevel(effect),
      sourceKind,
      timing: mode === "main" ? "normal" : mode,
      ...inferRequiredTextRoleUnderSourceRole(definition, effect),
      ...inferRequiredQuartzInheritedSourceRole(definition, effect),
      ...inferRequiredCombinedBraveSourceRole(definition, effect),
      effectCategory: "activated",
      ...(effect.activationLabel
        ? { activationLabel: effect.activationLabel }
        : {}),
      ...(effect.executionMode ? { executionMode: effect.executionMode } : {}),
      ...(effect.applicability ? { applicability: effect.applicability } : {}),
      ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
      ...(effect.condition && effect.condition.length > 0
        ? { condition: effect.condition }
        : {}),
      ...targetingOrChoices,
      ...spreadUsageLimit(effectUsageLimit),
      ...spreadLimitGroupId(effect.limitGroupId),
    });
  }

  return registrations;
}

const MAGIC_USABLE_ZONES: ReadonlySet<ApplicabilityZone> = new Set([
  "hand",
  "set_aside",
  "trash",
]);

/**
 * マジック使用元として意味を持つ zone 宣言か（"hand"/"set_aside"/"trash" のみで構成）。
 * field 由来の特殊使用は registration 側には載せず、別 CE で実効カテゴリが magic に
 * なった source だけ availability 側で既定 registration に field を追加する。
 */
export function isMagicUsableApplicabilityZone(
  zone: ApplicabilityZone | readonly ApplicabilityZone[]
): boolean {
  const zones = Array.isArray(zone) ? zone : [zone];
  return zones.every((z) => MAGIC_USABLE_ZONES.has(z));
}

/** effects から RegisteredMagicAction[] を自動生成 */
export function generateMagicRegistrations(
  definition: CardDefinition
): readonly RegisteredMagicAction[] {
  if (
    (definition.printedCategory !== "magic" &&
      !isMagicCompatibleDefinition(definition)) ||
    !definition.effects ||
    definition.effects.length === 0
  )
    return [];

  const registrations: RegisteredMagicAction[] = [];

  for (const [effectIndex, effect] of definition.effects.entries()) {
    if (effect.timing.kind !== "activated") continue;
    // applicability.zone は既定 (未指定 = 手札/手元のみ) の他、
    // マジック使用元として意味を持つ "hand"/"set_aside"/"trash" の組合せのみ許容する
    // (engine-magic-trash-use-permission、BSDB01-R03「トラッシュからも使用できる」)。
    // "field"/"advent_source" 等それ以外の zone を含む場合は別用途の宣言的効果
    // (フィールド起動効果等) のため、従来どおり use_magic 登録から除外する。
    if (
      effect.applicability?.zone !== undefined &&
      !isMagicUsableApplicabilityZone(effect.applicability.zone)
    )
      continue;
    const mode = effect.timing.mode;
    // mode:"main" → メインステップ使用 / "flash" → フラッシュ使用。
    // mode:"stack" (「スタック」キーワード = スタック効果) は能動使用タイミングを持たず、
    // 開いているスタック窓での割り込み応答時のみ使用可能 → timing:"stack" の reg を出す
    // (下の push が timing:mode で "stack" を出す)。
    // 【重要】フラッシュ効果はスタック効果ではない (公式Q&A Q5「スタック効果とは、フラッシュ
    //  効果に次ぐ、新しい発揮タイミングを持つ効果」/「自分から能動的に発揮/使用するタイミングは
    //  ありません」)。したがって mode:"flash" から timing:"stack" の reg を派生してはならない。
    //  フラッシュ効果はフラッシュ本体ループ (getResponseWindowActionTimings が
    //  pendingStackAction===null の優先権者へ返す timings=["flash"]) でのみ使用し、
    //  スタックタイミング (timings=["stack"]) には現れない。スタック応答に出せるのは
    //  mode:"stack" のスタック効果のみ (= フラッシュへの割り込みは『スタック』キーワードカード専用)。
    // registration が無いと当該効果は一切使用不能だった (engine gap)。
    if (mode !== "main" && mode !== "flash" && mode !== "stack") continue;
    // 純 stub (steps 空 かつ stub 注記あり) の効果は no-op アクションとして提示されて
    // しまうため登録しない。従来 mode:"stack" 限定のガードだったが、
    // engine-hand-self-card-main-end-activation-timing の adversarial verifier 指摘
    // (BSTH02.7-C01 effects[0]: timingScope.subPhase:"end" + steps:[] + stub な
    // mode:"main" 効果が use_magic として選べてしまいコスト支払後に何も起きないフェイク
    // アクションになる) を受け、mode 不問で同じ穴を塞ぐ。
    // 2条件は AND で判定する (どちらか単独では除外しない):
    //  - steps 非空だが stub 付き (BSES01-C04 effects[1] フラッシュ召喚 + grant_effect
    //    後段 stub) は前段だけ実質使用可能なので除外しない。
    //  - steps 空だが stub 無し (「使用する」こと自体がコスト側効果の発火条件になる
    //    bare vehicle。zone_discount_variable の cost_modify 経由 use_magic を単離検証する
    //    bsaz03-m01-use-cost-discard-discount.test.ts の合成テストカードで使用する形。
    //    2026-07-07 時点の実カードにこの形の例は無いが、テストが依拠する意図的な設計)
    //    は意図的な設計のため除外しない。
    if (effect.steps.length === 0 && effect.stub) continue;
    assertOccurrenceGateSupportedHere(definition, effect, "magic");

    // 同名マジック (per_card_name turn) の重複使用を抑止するため、
    // effect.usageLimit (= choice 変種間で共有される制限) を registration に伝搬する。
    // choice ステップを持つ場合は変種メタ (対象系 + 変種別 usageLimit =「1回ずつ」) を
    // choices[] に集約し、top-level の対象系メタは付けない (triggered と同型)。
    const choiceStepIndex = getDeclarationChoiceStepIndex(effect);
    const choiceStep =
      choiceStepIndex >= 0 ? effect.steps[choiceStepIndex] : undefined;
    const optionalRepeatStepIndex = findOptionalRepeatStepIndex(effect);
    const optionalRepeatStep =
      optionalRepeatStepIndex >= 0
        ? effect.steps[optionalRepeatStepIndex]
        : undefined;
    const effectUsageLimit = effect.usageLimit;
    const fieldTargetingMetadata = extractFieldTargetingMetadata(effect);
    const targetingOrChoices = choiceStep
      ? {
          choices: buildChoiceVariantsWithSharedTargeting(
            effect,
            choiceStepIndex
          ),
        }
      : optionalRepeatStep
        ? {
            ...buildOptionalRepeatBaseTargetingMetadata(
              effect,
              optionalRepeatStepIndex,
              fieldTargetingMetadata
            ),
            choices: buildOptionalRepeatVariants(
              effect,
              optionalRepeatStepIndex
            ),
          }
        : fieldTargetingMetadata;

    registrations.push({
      timing: mode,
      effectIndex,
      ...spreadSuppressionEffectDescriptor(effect, {
        sourceDefinitionId: definition.cardNo,
        sourceKind: "magic",
        effectIndex,
        sourceTextLines: definition.textLines,
      }),
      ...spreadPreventionLevel(effect),
      effectCategory: "activated",
      ...(effect.activationLabel
        ? { activationLabel: effect.activationLabel }
        : {}),
      ...(effect.executionMode ? { executionMode: effect.executionMode } : {}),
      ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
      ...(effect.applicability ? { applicability: effect.applicability } : {}),
      ...(effect.condition && effect.condition.length > 0
        ? { condition: effect.condition }
        : {}),
      ...targetingOrChoices,
      ...spreadUsageLimit(effectUsageLimit),
      ...spreadLimitGroupId(effect.limitGroupId),
    });
  }

  return registrations;
}

/**
 * effectIndex と choiceIndex から、その choice / optional repeat のステップ条件を取得する。
 * choiceIndex === 0: デフォルト action の condition。
 * choiceIndex >= 1: choice[choiceIndex - 1] の condition。
 * 見つからなければ undefined（条件なし = 常に満たす）。
 */
export function getChoiceStepCondition(
  definition: CardDefinition,
  effectIndex: number,
  choiceIndex: number
): Condition | undefined {
  const effect = definition.effects?.[effectIndex];
  if (!effect) return undefined;

  const choiceStep = effect.steps.find((s) => s.choice && s.choice.length > 0);
  if (!choiceStep) {
    const optionalRepeatStep = effect.steps.find(
      (step) => step.repeat?.optional === true
    );
    if (!optionalRepeatStep) return undefined;
    return choiceIndex > 0 ? optionalRepeatStep.repeat?.condition : undefined;
  }

  if (choiceIndex === 0) {
    return choiceStep.condition ?? undefined;
  }

  const choiceEntry = choiceStep.choice?.[choiceIndex - 1];
  const parent = choiceStep.condition ?? [];
  const child = choiceEntry?.condition ?? [];
  return parent.length > 0 || child.length > 0
    ? [...parent, ...child]
    : undefined;
}

/** A later step's condition and on_step choice use the updated state.
 * Mandatory conditional-cost branches still validate the payment and its result together.
 * 「その後」の二択を宣言へ持ち上げると、ドロー前に破棄・支払いが要求される。
 */
export function shouldDeferConditionalStepChoice(
  effect: Effect,
  index: number
): boolean {
  const step = effect.steps[index];
  return (
    index > 0 &&
    ((step?.condition?.length ?? 0) > 0 ||
      step?.targetSelectionTiming === "on_step") &&
    step?.connector !== "conditional_cost"
  );
}

function getDeclarationChoiceStepIndex(effect: Effect): number {
  const index = effect.steps.findIndex(
    (step) => (step.choice?.length ?? 0) > 0
  );
  return shouldDeferConditionalStepChoice(effect, index) ? -1 : index;
}
