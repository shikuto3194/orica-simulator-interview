import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  EffectActivationTiming,
  EffectPreventionLevel,
  EffectTiming,
  GameState,
  Zone,
} from "../model";
import type { CardFilter } from "../dsl-types";
import { getCardById } from "../card/card-lookup";
import { getCEsForTarget } from "../card/ce-lookup";
import {
  appendCardRevealDisclosure,
  isCardIdentityPublicForDisclosure,
} from "../public-disclosure";
import {
  matchesCardFilterByDef,
  matchesCardReferenceFilter,
} from "../card/card-filter";
import { getTotalCoresOnCardById } from "../core/core-system";
import {
  canSourceBypassResistanceCE,
  filterOutImmuneCards,
  isExhaustBlockedByResistance,
  isImmuneToBpCompareDestroy,
  isLeaveOutcomeBlockedByResistance,
  isPlayerImmuneToOpponentEffect,
  isZoneEntryBlockedByResistance,
  type EffectResistanceEvaluationOptions,
  type LeaveOutcome,
  type ResistanceSourceCause,
} from "./effect-resistance-check";
import {
  allowAffect,
  blockAffect,
  cardTargetRef,
  type AffectDecision,
  type TargetRef,
  type TargetLockBypassProfile,
} from "./target-affect-gate";

export type CardEffectSource = {
  instance?: CardInstance | undefined;
  definition?: CardDefinition | undefined;
  effectIndex?: number | undefined;
  targetStepId?: string | undefined;
  /** 発生源効果が発動したタイミング (main/flash/stack)。immunitySourceScope.activatedTimings 照合用。 */
  effectActivationTiming?: EffectActivationTiming | undefined;
};

export type CardAffectGateResult<T extends CardInstance> = {
  card: T;
  decision: AffectDecision;
  proofCardInstanceIds?: readonly string[];
};

/** 非公開のカード自身の効果・属性に依存する耐性だけ、確認に必要なカードを示す。 */
function protectionProofCards(
  state: GameState,
  card: CardInstance,
  ce: ContinuousEffect
): string[] {
  const proof = new Set<string>();
  const source = getCardById(state, ce.sourceInstanceId);
  if (source && !isCardIdentityPublicForDisclosure(state, source.instanceId))
    proof.add(source.instanceId);
  // ゾーンと所有者は公開情報。系統/色/名前等で対象を限定する場合は内容の証明が必要。
  const conditionalTarget = Object.entries(ce.targetFilter ?? {}).some(
    ([key, value]) => key !== "player" && key !== "zone" && value !== undefined
  );
  if (
    conditionalTarget &&
    !isCardIdentityPublicForDisclosure(state, card.instanceId)
  )
    proof.add(card.instanceId);
  return [...proof];
}

/** Q7064/Q16303: 耐性の証明は効果による閲覧・オープンとは別。セット/手札状態を保つ。 */
export function appendImmunityProofDisclosures(
  state: GameState,
  results: readonly CardAffectGateResult<CardInstance>[],
  sourceInstanceId?: string
): GameState {
  const ids = new Set(
    results.flatMap((result) =>
      result.decision.kind === "blocked"
        ? [...(result.proofCardInstanceIds ?? [])]
        : []
    )
  );
  let next = state;
  for (const player of state.players) {
    next = appendCardRevealDisclosure({
      state: next,
      actorPlayerId: player.id,
      cardInstanceIds: [...ids].filter(
        (id) => getCardById(state, id)?.ownerPlayerId === player.id
      ),
      audience: "both",
      open: false,
      sourceInstanceId,
    });
  }
  return next;
}

export function resolveCardLeaveAffectDecisions<T extends CardInstance>(
  state: GameState,
  cards: readonly T[],
  outcome: LeaveOutcome,
  actingPlayerId: string | null,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  pierceCannotLeaveField = false,
  sourceCause: ResistanceSourceCause = "effect",
  sourcePreventionBypass?: TargetLockBypassProfile
): CardAffectGateResult<T>[] {
  return cards.map((card) => {
    const blockers: ContinuousEffect[] = [];
    const blocked = isLeaveOutcomeBlockedByResistance(
      state,
      card,
      outcome,
      actingPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      pierceCannotLeaveField,
      sourceCause,
      sourcePreventionBypass,
      (ce) => blockers.push(ce)
    );
    const proofs = blockers.map((ce) => protectionProofCards(state, card, ce));
    return {
      card,
      decision: blocked
        ? blockAffect(cardTargetRef(card), "effect_resistance")
        : allowAffect(cardTargetRef(card)),
      ...(blocked
        ? {
            proofCardInstanceIds:
              proofs.sort((a, b) => a.length - b.length)[0] ?? [],
          }
        : {}),
    };
  });
}

export function resolveCardImmunityAffectDecisions<T extends CardInstance>(
  state: GameState,
  cards: readonly T[],
  actingPlayerId: string | null,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  effectSource?: CardEffectSource,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectAspect?: string,
  options: EffectResistanceEvaluationOptions = {}
): CardAffectGateResult<T>[] {
  return cards.map((card) => {
    const blockers: ContinuousEffect[] = [];
    const { allowed } = filterOutImmuneCards(
      state,
      [card],
      actingPlayerId,
      sourcePreventionLevel,
      effectSource,
      getCardDefinitionById,
      sourcePreventionBypass,
      effectAspect,
      {
        ...options,
        onBlockingEffect: (ce) => {
          blockers.push(ce);
          options.onBlockingEffect?.(ce);
        },
      }
    );
    const proofs = blockers.map((ce) => protectionProofCards(state, card, ce));
    // 一つでも公開情報だけで成立する耐性があれば、他の非公開の耐性を証明する必要はない。
    const proofCardInstanceIds =
      proofs.sort((a, b) => a.length - b.length)[0] ?? [];
    return {
      card,
      decision:
        allowed.length > 0
          ? allowAffect(cardTargetRef(card))
          : blockAffect(cardTargetRef(card), "effect_immunity"),
      ...(allowed.length === 0 ? { proofCardInstanceIds } : {}),
    };
  });
}

export function resolveCardImmunityAffect(
  state: GameState,
  card: CardInstance,
  actingPlayerId: string | null,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  effectSource?: CardEffectSource,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectAspect?: string,
  options: EffectResistanceEvaluationOptions = {}
): AffectDecision {
  const [result] = resolveCardImmunityAffectDecisions(
    state,
    [card],
    actingPlayerId,
    sourcePreventionLevel,
    effectSource,
    getCardDefinitionById,
    sourcePreventionBypass,
    effectAspect,
    options
  );
  return result?.decision ?? allowAffect(cardTargetRef(card));
}

export function resolveBpCompareDestroyAffect(
  state: GameState,
  card: CardInstance,
  actingPlayerId: string | null,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourceCause: ResistanceSourceCause = "effect",
  sourcePreventionBypass?: TargetLockBypassProfile
): AffectDecision {
  if (
    isImmuneToBpCompareDestroy(
      state,
      card,
      actingPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      sourcePreventionBypass
    )
  ) {
    return blockAffect(cardTargetRef(card), "bp_compare_destroy_immunity");
  }
  if (
    isLeaveOutcomeBlockedByResistance(
      state,
      card,
      "destroy",
      actingPlayerId,
      getCardDefinitionById ?? (() => undefined),
      sourcePreventionLevel,
      false,
      sourceCause,
      sourcePreventionBypass
    )
  ) {
    return blockAffect(cardTargetRef(card), "effect_resistance");
  }
  return allowAffect(cardTargetRef(card));
}

export function resolveCardExhaustAffect(
  state: GameState,
  card: CardInstance,
  actingPlayerId: string | null,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile
): AffectDecision {
  if (
    isExhaustBlockedByResistance(
      state,
      card,
      actingPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      sourcePreventionBypass
    )
  ) {
    return blockAffect(cardTargetRef(card), "effect_resistance");
  }
  return allowAffect(cardTargetRef(card));
}

export function isCardLeaveAffectBlockedByResistance(
  state: GameState,
  card: CardInstance,
  outcome: LeaveOutcome,
  actingPlayerId: string | null,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  pierceCannotLeaveField = false,
  sourcePreventionBypass?: TargetLockBypassProfile
): boolean {
  return isLeaveOutcomeBlockedByResistance(
    state,
    card,
    outcome,
    actingPlayerId,
    getCardDefinitionById,
    sourcePreventionLevel,
    pierceCannotLeaveField,
    "effect",
    sourcePreventionBypass
  );
}

export function isCardZoneEntryAffectBlockedByResistance(
  state: GameState,
  card: CardInstance,
  zone: Zone,
  actingPlayerId: string | null,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile
): boolean {
  return isZoneEntryBlockedByResistance(
    state,
    card,
    zone,
    actingPlayerId,
    getCardDefinitionById,
    sourcePreventionLevel,
    sourcePreventionBypass
  );
}

export function resolvePlayerAffect(
  state: GameState,
  targetPlayerId: string,
  actingPlayerId: string | null,
  sourcePreventionLevel: EffectPreventionLevel = "none"
): AffectDecision {
  const target = { kind: "player" as const, playerId: targetPlayerId };
  if (
    isPlayerImmuneToOpponentEffect(
      state,
      targetPlayerId,
      actingPlayerId,
      sourcePreventionLevel
    )
  ) {
    return blockAffect(target, "player_effect_immunity");
  }
  return allowAffect(target);
}

export function resolveHandDiscardContainerAffect(
  state: GameState,
  protectedPlayerId: string,
  actingPlayerId: string,
  handCount: number,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile
): AffectDecision {
  const target = {
    kind: "zone" as const,
    playerId: protectedPlayerId,
    zone: "hand" as const,
  };
  if (
    handCount > 0 &&
    actingPlayerId !== protectedPlayerId &&
    isHandDiscardContainerProtected(
      state,
      protectedPlayerId,
      handCount,
      getCardDefinitionById,
      sourcePreventionLevel,
      sourcePreventionBypass
    )
  ) {
    return blockAffect(target, "prevent_hand_discard");
  }
  return allowAffect(target);
}

export function resolveDeckDiscardContainerAffect(
  state: GameState,
  protectedPlayerId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile
): AffectDecision {
  const target = {
    kind: "zone" as const,
    playerId: protectedPlayerId,
    zone: "deck" as const,
  };
  if (
    isDeckDiscardContainerProtected(
      state,
      protectedPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      sourcePreventionBypass
    )
  ) {
    return blockAffect(target, "prevent_deck_discard");
  }
  return allowAffect(target);
}

function isHandDiscardContainerProtected(
  state: GameState,
  protectedPlayerId: string,
  handCount: number,
  getCardDefinitionById:
    | ((id: string) => CardDefinition | undefined)
    | undefined,
  sourcePreventionLevel: EffectPreventionLevel,
  sourcePreventionBypass: TargetLockBypassProfile | undefined
): boolean {
  for (const ce of getCEsForTarget(state, protectedPlayerId)) {
    if (ce.modifierTag !== "prevent_hand_discard") continue;
    if (
      canBypassContainerProtection(
        state,
        ce,
        getCardDefinitionById,
        sourcePreventionLevel,
        sourcePreventionBypass
      )
    ) {
      continue;
    }
    const meta = ce.metadata ?? {};
    const handCountMax = meta.handCountMax as number | undefined;
    if (handCountMax !== undefined && handCount > handCountMax) continue;
    const minSourceCores = meta.minSourceCores as number | undefined;
    if (minSourceCores !== undefined) {
      const sourceCard = getCardById(state, ce.sourceInstanceId);
      if (!sourceCard) continue;
      if (
        getTotalCoresOnCardById(state, ce.sourceInstanceId) < minSourceCores
      ) {
        continue;
      }
    }
    return true;
  }
  return false;
}

function isDeckDiscardContainerProtected(
  state: GameState,
  protectedPlayerId: string,
  getCardDefinitionById:
    | ((id: string) => CardDefinition | undefined)
    | undefined,
  sourcePreventionLevel: EffectPreventionLevel,
  sourcePreventionBypass: TargetLockBypassProfile | undefined
): boolean {
  for (const ce of getCEsForTarget(state, protectedPlayerId)) {
    if (ce.modifierTag !== "prevent_deck_discard") continue;
    if (
      canBypassContainerProtection(
        state,
        ce,
        getCardDefinitionById,
        sourcePreventionLevel,
        sourcePreventionBypass
      )
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * 「相手への「デッキ破棄効果」すべてを「デッキ除外効果」にする」(BSTH05.5-X02 Lv2
 * 【導域】) の redirect_deck_discard_to_exclude CE が `protectedPlayerId`（デッキ破棄が
 * 発生する側）に対して有効かを判定する。prevent_deck_discard の block 判定
 * (isDeckDiscardContainerProtected) と異なり、こちらは移動先を止めず差し替えるだけ
 * なので bypass (canBypassContainerProtection) は評価しない。「自分のアタックステップ」
 * 限定は `getCEsForTarget` の timingScope フィルタが自動適用する。
 */
export function isDeckDiscardExcludeRedirectActive(
  state: GameState,
  protectedPlayerId: string
): boolean {
  for (const ce of getCEsForTarget(state, protectedPlayerId)) {
    if (ce.modifierTag === "redirect_deck_discard_to_exclude") return true;
  }
  return false;
}

function canBypassContainerProtection(
  state: GameState,
  ce: Parameters<typeof canSourceBypassResistanceCE>[1],
  getCardDefinitionById:
    | ((id: string) => CardDefinition | undefined)
    | undefined,
  sourcePreventionLevel: EffectPreventionLevel,
  sourcePreventionBypass: TargetLockBypassProfile | undefined
): boolean {
  if (sourcePreventionLevel === "unpreventable") return true;
  if (!getCardDefinitionById || !sourcePreventionBypass) return false;
  return canSourceBypassResistanceCE(
    state,
    ce,
    getCardDefinitionById,
    sourcePreventionLevel,
    sourcePreventionBypass
  );
}

/** 発揮元の参照条件。対象への耐性ロックとは区別し、既存CardFilterへ委譲する。 */
function matchesCorePlacementSourceFilter(
  state: GameState,
  ce: ContinuousEffect,
  source: CardEffectSource | undefined
): boolean {
  const filter = ce.metadata?.sourceFilter as CardFilter | undefined;
  if (!filter) return true;
  if (!source?.definition) return false;
  return source.instance
    ? matchesCardReferenceFilter(source.instance, source.definition, filter, {
        state,
        cardZone: source.instance.zone,
      })
    : matchesCardFilterByDef(source.definition, filter);
}

/**
 * 「(対象プレイヤーは)ライフにコアを置けない」(restrict_core_placement_life CE)。
 * 移動元/発動者を問わず、コア移動先がこのプレイヤーのライフゾーンなら全面ブロックする
 * (BSTH02.7-C01 effects[2] choice[0])。
 *
 * `fromZoneKind` (実際のコア移動元) を渡すと、CE 登録時に `metadata.fromZone` が
 * 設定されている場合だけそれと一致するかを追加チェックする（「お互い、ボイドから
 * コアをライフに置けない」= 移動元を void に絞る型、BSTH002-C04 effects[0]）。
 * `metadata.fromZone` 未設定の CE は従来通り移動元不問で全面ブロックする。
 */
export function resolveCorePlacementToLifeAffect(
  state: GameState,
  targetPlayerId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile,
  fromZoneKind?: string,
  source?: CardEffectSource
): AffectDecision {
  const target: TargetRef = {
    kind: "core_container",
    location: { kind: "life", playerId: targetPlayerId },
  };
  if (
    isCorePlacementToLifeRestricted(
      state,
      targetPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      sourcePreventionBypass,
      fromZoneKind,
      source
    )
  ) {
    return blockAffect(target, "restrict_core_placement_life");
  }
  return allowAffect(target);
}

function isCorePlacementToLifeRestricted(
  state: GameState,
  targetPlayerId: string,
  getCardDefinitionById:
    | ((id: string) => CardDefinition | undefined)
    | undefined,
  sourcePreventionLevel: EffectPreventionLevel,
  sourcePreventionBypass: TargetLockBypassProfile | undefined,
  fromZoneKind?: string,
  source?: CardEffectSource
): boolean {
  for (const ce of getCEsForTarget(state, targetPlayerId)) {
    if (ce.modifierTag !== "restrict_core_placement_life") continue;
    if (!matchesCorePlacementSourceFilter(state, ce, source)) continue;
    const requiredFromZone = ce.metadata?.fromZone;
    if (
      typeof requiredFromZone === "string" &&
      requiredFromZone !== fromZoneKind
    ) {
      continue;
    }
    if (
      canBypassContainerProtection(
        state,
        ce,
        getCardDefinitionById,
        sourcePreventionLevel,
        sourcePreventionBypass
      )
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * 「(対象プレイヤーは)相手の効果でボイドからコアを増やせない」(restrict_core_placement_void
 * CE)。移動元がこのプレイヤーのボイドで、かつ移動の発動者がこのプレイヤー自身
 * (=「自分の効果で」) のときだけブロックする (BSSL01-C02 effects[0]。
 * ENGINE-void-core-decrease-trigger)。restrict_core_placement_life と異なり原因限定。
 *
 * CE の `metadata.sourceTimingScope==="summon"` (BSTH03-C31 Lv1-Lv2「召喚時」限定) の
 * ときは、さらに `effectTiming` が `card_event:summon` に一致する場合だけブロックする
 * (未指定・不一致なら素通し = フラッシュ等の召喚時以外の自己効果は禁止しない)。
 * `metadata.sourceFilter` は移動を起こす効果の発揮元に照合する。省略時は従来どおり。
 */
export function resolveCorePlacementFromVoidAffect(
  state: GameState,
  actingPlayerId: string,
  voidOwnerPlayerId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectTiming?: EffectTiming,
  source?: CardEffectSource
): AffectDecision {
  const target: TargetRef = {
    kind: "core_container",
    location: { kind: "void", playerId: voidOwnerPlayerId },
  };
  if (
    actingPlayerId === voidOwnerPlayerId &&
    isCorePlacementFromVoidRestricted(
      state,
      voidOwnerPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      sourcePreventionBypass,
      effectTiming,
      source
    )
  ) {
    return blockAffect(target, "restrict_core_placement_void");
  }
  return allowAffect(target);
}

function matchesSourceTimingScope(
  scope: unknown,
  effectTiming: EffectTiming | undefined
): boolean {
  if (scope !== "summon") return true;
  if (!effectTiming || effectTiming.kind !== "card_event") return false;
  const events = Array.isArray(effectTiming.event)
    ? effectTiming.event
    : [effectTiming.event];
  return events.includes("summon");
}

function isCorePlacementFromVoidRestricted(
  state: GameState,
  targetPlayerId: string,
  getCardDefinitionById:
    | ((id: string) => CardDefinition | undefined)
    | undefined,
  sourcePreventionLevel: EffectPreventionLevel,
  sourcePreventionBypass: TargetLockBypassProfile | undefined,
  effectTiming?: EffectTiming,
  source?: CardEffectSource
): boolean {
  for (const ce of getCEsForTarget(state, targetPlayerId)) {
    if (ce.modifierTag !== "restrict_core_placement_void") continue;
    if (!matchesCorePlacementSourceFilter(state, ce, source)) continue;
    if (
      !matchesSourceTimingScope(ce.metadata?.sourceTimingScope, effectTiming)
    ) {
      continue;
    }
    if (
      canBypassContainerProtection(
        state,
        ce,
        getCardDefinitionById,
        sourcePreventionLevel,
        sourcePreventionBypass
      )
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * 対象プレイヤーに有効な `restrict_symbol_addition` CE を返す
 * (「(対象プレイヤーは)スピリット/アルティメットの効果で合計でN個以上シンボルを
 * 追加できない」BSTH03-C04 effects[2])。`sourceFilter` 指定時は symbol_add の発揮元
 * カードがそれに一致する場合のみ対象とする（省略時は全 symbol_add が対象）。
 * 消費側 (`executeSymbolAdd`) がこの CE の `effectId` をキーに累積カウントを判定する。
 */
export function getActiveSymbolAdditionRestriction(
  state: GameState,
  targetPlayerId: string,
  sourceCardInstance: CardInstance | undefined,
  sourceCardDefinition: CardDefinition | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  sourcePreventionBypass?: TargetLockBypassProfile
): { effectId: string; maxTotal: number } | undefined {
  for (const ce of getCEsForTarget(state, targetPlayerId)) {
    if (ce.modifierTag !== "restrict_symbol_addition") continue;
    const meta = ce.metadata as
      | { maxTotal?: number; sourceFilter?: CardFilter }
      | undefined;
    if (!meta || typeof meta.maxTotal !== "number") continue;
    if (meta.sourceFilter) {
      if (!sourceCardInstance || !sourceCardDefinition) continue;
      if (
        !matchesSymbolAdditionSourceFilter(state, {
          sourceCardInstance,
          sourceCardDefinition,
          sourceFilter: meta.sourceFilter,
          ...(getCardDefinitionById !== undefined
            ? { getCardDefinitionById }
            : {}),
        })
      ) {
        continue;
      }
    }
    if (
      canBypassContainerProtection(
        state,
        ce,
        getCardDefinitionById,
        sourcePreventionLevel,
        sourcePreventionBypass
      )
    ) {
      continue;
    }
    return { effectId: ce.effectId, maxTotal: meta.maxTotal };
  }
  return undefined;
}

function matchesSymbolAdditionSourceFilter(
  state: GameState,
  options: {
    sourceCardInstance: CardInstance;
    sourceCardDefinition: CardDefinition;
    sourceFilter: CardFilter;
    getCardDefinitionById?: (id: string) => CardDefinition | undefined;
  }
): boolean {
  if (
    matchesCardReferenceFilter(
      options.sourceCardInstance,
      options.sourceCardDefinition,
      options.sourceFilter,
      {
        state,
        cardZone: options.sourceCardInstance.zone,
      }
    )
  ) {
    return true;
  }

  // 合体中ブレイヴの【合体中】効果は合体スピリットに追加される
  // (10_rules/05)。発揮元 instanceId はブレイヴでも、効果分類
  // 「スピリット/アルティメットの効果」は host 側で照合する。
  if (
    options.sourceCardDefinition.printedCategory !== "brave" ||
    options.sourceCardInstance.zone !== "field"
  ) {
    return false;
  }
  const combinedHostId =
    options.sourceCardInstance.attachedToInstanceId ??
    options.sourceCardInstance.imaginRightCombinedWith ??
    undefined;
  if (!combinedHostId) return false;
  const hostCard = getCardById(state, combinedHostId);
  if (!hostCard || hostCard.zone !== "field" || hostCard.pendingLeaveKind) {
    return false;
  }
  const hostDefinition = options.getCardDefinitionById?.(hostCard.definitionId);
  if (!hostDefinition) return false;
  return matchesCardReferenceFilter(
    hostCard,
    hostDefinition,
    options.sourceFilter,
    {
      state,
      cardZone: hostCard.zone,
    }
  );
}
