import type {
  CardCategory,
  CardColor,
  EffectPreventionLevel,
  Zone,
} from "../model";

export type TargetClass = "player" | "card_or_zone" | "effect" | "game";

export type CoreContainerRef =
  | { kind: "card"; instanceId: string }
  | { kind: "reserve"; playerId: string }
  | { kind: "life"; playerId: string }
  | { kind: "trash"; playerId: string }
  | { kind: "void"; playerId: string }
  | { kind: "count_area"; playerId: string };

export type TargetRef =
  | { kind: "card"; instanceId: string }
  | { kind: "player"; playerId: string }
  | { kind: "zone"; playerId: string; zone: Zone }
  | { kind: "core_container"; location: CoreContainerRef }
  | { kind: "effect"; stackId: string }
  | { kind: "battle_entity"; entityId: string }
  | { kind: "game" };

export interface EffectSourceFilter {
  categories?: CardCategory[];
  colors?: CardColor[];
  colorMatchMode?: "exact" | "includes";
  tribes?: string[];
  keywords?: string[];
  /**
   * TargetLockBypassProfile 用の否定一致。true のとき、防止元がこの filter に
   * 一致しない場合だけ bypass する（「○○以外では防げない」）。
   * matchesEffectSourceFilter() 自体は通常の正一致判定として扱う。
   */
  bypassUnlessMatches?: true;
}

export interface EffectSourceIdentity {
  /**
   * P3-142: 複数値。合体中のブレイヴ/スピリット状態のブレイヴ/転神中の創界神ネクサス等、
   * 「二重状態」のカードは印字カテゴリと実効カテゴリの両方を保持しうる
   * (`getEffectiveCategories()`, mechanics/act-as-spirit.ts が SSOT)。
   */
  categories?: CardCategory[];
  colors?: CardColor[];
  tribes?: string[];
  keywords?: string[];
}

export type EffectResistanceSourceScope =
  | "self"
  | "opponent_effect"
  | "opponent"
  | "all";

export type TargetLockBypassProfile =
  | { kind: "none" }
  | { kind: "all_effects" }
  /**
   * P3-141 (qa-020): 「お互いの効果で防げない」「一切の効果で防げない」のような
   * *真の blanket*（防げる条件が一切存在しない）を、affect immunity 軸
   * （`cannot_*`/`defense_immune`、`canSourceBypassResistanceCE` 参照）限定で表す。
   * `all_effects` と異なり target lock（`canBypassTargetLock`）は貫通しない
   * （「お互い」は target lock を貫通しない、ユーザー確認 2026-08-04）。
   * 「一切」は target lock も貫通するため、その 1 枚は本 kind ではなく
   * `all_effects` を使う（P3-143 が担当、二重付与しない）。
   */
  | { kind: "blanket_affect_immunity" }
  | { kind: "preventing_effect_filter"; filter: EffectSourceFilter }
  | { kind: "any_preventing_effect_filter"; filters: EffectSourceFilter[] };

function collectTargetLockBypassFilters(
  profile: TargetLockBypassProfile | undefined
): EffectSourceFilter[] | "all" | "blanket_affect_immunity" {
  if (profile === undefined || profile.kind === "none") return [];
  if (profile.kind === "all_effects") return "all";
  if (profile.kind === "blanket_affect_immunity") {
    return "blanket_affect_immunity";
  }
  if (profile.kind === "preventing_effect_filter") return [profile.filter];
  return [...profile.filters];
}

export function mergeTargetLockBypassProfiles(
  a: TargetLockBypassProfile | undefined,
  b: TargetLockBypassProfile | undefined
): TargetLockBypassProfile | undefined {
  const aFilters = collectTargetLockBypassFilters(a);
  const bFilters = collectTargetLockBypassFilters(b);
  if (aFilters === "all" || bFilters === "all") return { kind: "all_effects" };
  if (
    aFilters === "blanket_affect_immunity" ||
    bFilters === "blanket_affect_immunity"
  ) {
    return { kind: "blanket_affect_immunity" };
  }
  const filters = [...aFilters, ...bFilters];
  if (filters.length === 0) return undefined;
  if (filters.length === 1) {
    return { kind: "preventing_effect_filter", filter: filters[0]! };
  }
  return { kind: "any_preventing_effect_filter", filters };
}

export interface PreventionProfile {
  resistance: EffectPreventionLevel;
  targetLockBypass: TargetLockBypassProfile;
}

export interface PreventionProfileInput {
  resistance?: EffectPreventionLevel;
  targetLockBypass?: TargetLockBypassProfile;
}

export type TargetExcludeReason =
  | "cannot_be_targeted"
  | "cannot_include"
  | "effect_immunity"
  | "invalid_zone"
  | "invalid_timing";

export type TargetAcquireDecision =
  | { kind: "candidate"; target: TargetRef }
  | {
      kind: "excluded";
      target: TargetRef;
      reason: TargetExcludeReason;
      byEffectId?: string;
    };

export interface TargetAcquisitionGate {
  reason: TargetExcludeReason;
  byEffectId?: string;
  preventingEffect?: EffectSourceIdentity;
  source?: EffectResistanceSourceScope;
  targetControllerPlayerId?: string;
}

export interface EffectSourceContext {
  actingPlayerId: string | null;
  sourceInstanceId?: string;
  sourceDefinitionId?: string;
  prevention: PreventionProfile;
  cause: "effect" | "cost" | "rule" | "battle";
}

export interface TargetAcquireContext {
  source: EffectSourceContext;
  targetClass: TargetClass;
  selectorIntent: "explicit_target" | "include_all" | "auto";
}

export type AffectDecision =
  | { kind: "allowed"; effectiveTarget: TargetRef }
  | { kind: "blocked"; target: TargetRef; reason: string; byEffectId?: string }
  | { kind: "redirect"; target: TargetRef; to: TargetRef; byEffectId: string }
  | {
      kind: "replace";
      target: TargetRef;
      replacement: unknown;
      byEffectId: string;
    }
  | { kind: "requires_choice"; target: TargetRef; pending: unknown };

export function normalizePreventionProfile(
  input?: PreventionProfileInput
): PreventionProfile {
  return {
    resistance: input?.resistance ?? "none",
    targetLockBypass: input?.targetLockBypass ?? { kind: "none" },
  };
}

export function isTargetLockReason(reason: TargetExcludeReason): boolean {
  return reason === "cannot_be_targeted" || reason === "cannot_include";
}

function doesTargetLockReasonApplyToSelector(
  reason: TargetExcludeReason,
  selectorIntent: TargetAcquireContext["selectorIntent"]
): boolean {
  if (reason === "cannot_be_targeted") {
    return selectorIntent === "explicit_target" || selectorIntent === "auto";
  }
  if (reason === "cannot_include") {
    return selectorIntent === "include_all" || selectorIntent === "auto";
  }
  return true;
}

export function canBypassTargetLock(
  profile: PreventionProfile,
  preventingEffect?: EffectSourceIdentity
): boolean {
  switch (profile.targetLockBypass.kind) {
    case "none":
      return false;
    case "all_effects":
      return true;
    case "blanket_affect_immunity":
      // affect immunity 軸限定 (P3-141)。target lock はここでは貫通しない。
      return false;
    case "preventing_effect_filter":
      if (preventingEffect === undefined) return false;
      return doesBypassFilterApply(
        preventingEffect,
        profile.targetLockBypass.filter
      );
    case "any_preventing_effect_filter":
      if (preventingEffect === undefined) return false;
      return profile.targetLockBypass.filters.some((filter) =>
        doesBypassFilterApply(preventingEffect, filter)
      );
  }
}

export function doesBypassFilterApply(
  source: EffectSourceIdentity,
  filter: EffectSourceFilter
): boolean {
  const { bypassUnlessMatches: _bypassUnlessMatches, ...sourceFilter } = filter;
  const matches = matchesEffectSourceFilter(source, sourceFilter);
  return filter.bypassUnlessMatches === true ? !matches : matches;
}

export function matchesEffectSourceFilter(
  source: EffectSourceIdentity,
  filter: EffectSourceFilter
): boolean {
  if (
    filter.categories !== undefined &&
    !(source.categories ?? []).some((c) => filter.categories!.includes(c))
  ) {
    return false;
  }

  if (filter.colors !== undefined) {
    const sourceColors = source.colors ?? [];
    const mode = filter.colorMatchMode ?? "includes";
    const matches =
      mode === "exact"
        ? sameStringSet(sourceColors, filter.colors)
        : filter.colors.some((c) => sourceColors.includes(c));
    if (!matches) return false;
  }

  if (
    filter.tribes !== undefined &&
    !filter.tribes.some((t) => source.tribes?.includes(t))
  ) {
    return false;
  }

  if (
    filter.keywords !== undefined &&
    !filter.keywords.some((k) => source.keywords?.includes(k))
  ) {
    return false;
  }

  return true;
}

export function doesEffectResistanceSourceApplyToController(
  source: EffectResistanceSourceScope,
  actingPlayerId: string | null,
  controllerPlayerId: string,
  cause: "effect" | "battle" | "bp_compare"
): boolean {
  if (source === "all") return true;
  if (source === "self") return actingPlayerId === controllerPlayerId;
  if (actingPlayerId === null || actingPlayerId === controllerPlayerId) {
    return false;
  }
  if (source === "opponent") return true;
  return cause === "effect";
}

function doesTargetAcquisitionGateSourceApply(
  ctx: TargetAcquireContext,
  gate: TargetAcquisitionGate
): boolean {
  const source = gate.source ?? "all";
  if (source === "all") return true;
  const controllerPlayerId = gate.targetControllerPlayerId;
  if (controllerPlayerId === undefined) return false;
  if (ctx.source.cause !== "effect" && ctx.source.cause !== "battle") {
    return false;
  }
  return doesEffectResistanceSourceApplyToController(
    source,
    ctx.source.actingPlayerId,
    controllerPlayerId,
    ctx.source.cause
  );
}

export function resolveTargetAcquisition(
  _ctx: TargetAcquireContext,
  target: TargetRef,
  gates: readonly TargetAcquisitionGate[]
): TargetAcquireDecision {
  for (const gate of gates) {
    if (!doesTargetAcquisitionGateSourceApply(_ctx, gate)) continue;
    if (
      isTargetLockReason(gate.reason) &&
      !doesTargetLockReasonApplyToSelector(gate.reason, _ctx.selectorIntent)
    ) {
      continue;
    }
    if (
      isTargetLockReason(gate.reason) &&
      canBypassTargetLock(_ctx.source.prevention, gate.preventingEffect)
    ) {
      continue;
    }
    return {
      kind: "excluded",
      target,
      reason: gate.reason,
      ...(gate.byEffectId !== undefined ? { byEffectId: gate.byEffectId } : {}),
    };
  }
  return { kind: "candidate", target };
}

export function allowAffect(target: TargetRef): AffectDecision {
  return { kind: "allowed", effectiveTarget: target };
}

export function cardTargetRef(card: { instanceId: string }): TargetRef {
  return { kind: "card", instanceId: card.instanceId };
}

export function allowCardAffect(card: { instanceId: string }): AffectDecision {
  return allowAffect(cardTargetRef(card));
}

export function blockCardAffect(
  card: { instanceId: string },
  reason: string,
  byEffectId?: string
): AffectDecision {
  return blockAffect(cardTargetRef(card), reason, byEffectId);
}

export function blockAffect(
  target: TargetRef,
  reason: string,
  byEffectId?: string
): AffectDecision {
  return {
    kind: "blocked",
    target,
    reason,
    ...(byEffectId !== undefined ? { byEffectId } : {}),
  };
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((value) => bSet.has(value));
}
