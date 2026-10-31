// Combat クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
// シンボル付与/ブロック不可・ブロック許可などの戦闘属性付与実行。

import { getCardById } from "../card/card-lookup";
import type {
  CardDefinition,
  ContinuousEffect,
  Duration,
  EffectTarget,
  GameState,
  SymbolAddAction,
  SymbolColor,
  TimingScope,
} from "../model";
import type { DynamicCount, TargetSpec } from "../dsl-types";
import {
  evaluateContinuousDynamicAmount,
  getEffectiveTribes,
} from "../legal/legal-actions-shared";
import { getActiveSymbolAdditionRestriction } from "./effect-affect-adapter";
import { resolveAffectSourceIdentity } from "./effect-source-identity";
import {
  durationStr,
  resolvePlayerRef,
  resolveTargetCards,
} from "./structured-effect-interpreter";
import { nextCeId } from "./structured-effect-sequences";
import type { TargetLockBypassProfile } from "./target-affect-gate";

export function executeSymbolAdd(
  state: GameState,
  actingPlayerId: string,
  action: SymbolAddAction & {
    /**
     * 追加するシンボルの個数。省略時=1。`DynamicCount` は既定では
     * `modifierSymbolCountDynamic` として保持し、`countEvaluation:"snapshot"` の
     * ときだけ登録時に数値化する。
     */
    count?: number | DynamicCount;
    countEvaluation?: "live" | "snapshot";
    continuousTarget?: Extract<TargetSpec, { kind: "filter" }>;
  },
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  battleEndDeferralAttackId?: string,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinitionId?: string
): GameState {
  const affectSource = resolveAffectSourceIdentity({
    state,
    sourceInstanceId,
    ...(effectSourceInstanceId !== undefined ? { effectSourceInstanceId } : {}),
    ...(effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  });
  const preventionBypass = sourcePreventionBypass ?? sourceTargetLockBypass;
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const toModify = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId,
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true,
    undefined,
    preventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId,
    { effectAspect: "symbols" }
  );
  const symbolLogLabel = action.symbolSource
    ? `dynamic:${action.symbolSource.kind}`
    : `${action.symbol}`;
  if (toModify.length === 0 && !action.continuousTarget) {
    state.log.push(
      `effect:symbol_add:${symbolLogLabel}:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const dynamicCountContext =
    sourceCard !== undefined
      ? {
          sourceTribes: getEffectiveTribes(
            state,
            sourceCard,
            getCardDefinitionById(sourceCard.definitionId),
            getCardDefinitionById
          ),
        }
      : undefined;
  const resolvedSymbolCount =
    action.count === undefined
      ? 1
      : typeof action.count === "number"
        ? Math.max(0, action.count)
        : Math.max(
            0,
            evaluateContinuousDynamicAmount(
              state,
              actingPlayerId,
              action.count,
              getCardDefinitionById,
              dynamicCountContext
            )
          );
  const hasSymbolBundle =
    action.symbolSource !== undefined ||
    (Array.isArray(action.symbol)
      ? action.symbol.length > 0
      : action.symbol !== undefined);
  const attemptedSymbolAdditionCount = hasSymbolBundle
    ? toModify.length * resolvedSymbolCount
    : 0;

  // 「(対象プレイヤーは)スピリット/アルティメットの効果で合計でN個以上シンボルを
  // 追加できない」(restrict_symbol_addition CE、BSTH03-C04 effects[2])。今回登録分も
  // 含めて上限超過なら symbol_add 全体をブロックする（対象を絞らず一律禁止）。
  const symbolAdditionRestriction = getActiveSymbolAdditionRestriction(
    state,
    actingPlayerId,
    affectSource.instance,
    affectSource.definition,
    getCardDefinitionById,
    sourcePreventionLevel,
    preventionBypass
  );
  let symbolAdditionRestrictionCountKey: string | undefined;
  if (symbolAdditionRestriction) {
    symbolAdditionRestrictionCountKey = `${actingPlayerId}:${symbolAdditionRestriction.effectId}`;
    const currentCount =
      state.symbolAdditionRestrictedCountThisTurn?.[
        symbolAdditionRestrictionCountKey
      ] ?? 0;
    if (
      attemptedSymbolAdditionCount > 0 &&
      currentCount + attemptedSymbolAdditionCount >
        symbolAdditionRestriction.maxTotal
    ) {
      state.log.push(
        `effect:symbol_add:${symbolLogLabel}:${durationStr(action.duration)}:blocked-by-restrict_symbol_addition:${actingPlayerId}`
      );
      return state;
    }
  }

  // 配列なら dual-color symbol として 1 CE 登録、単色なら長さ1の配列に正規化。
  // symbolSource 指定時は静的色を持たず、消費時（getSymbolAdditions）に live 評価する。
  const symbolColors: SymbolColor[] | undefined = action.symbolSource
    ? undefined
    : Array.isArray(action.symbol)
      ? [...action.symbol]
      : action.symbol !== undefined
        ? [action.symbol]
        : [];
  const modifierSymbolSource = action.symbolSource
    ? action.symbolSource.kind === "under_card_symbols"
      ? {
          kind: action.symbolSource.kind,
          roleTag: action.symbolSource.roleTag,
          ...(action.symbolSource.filter
            ? { filter: action.symbolSource.filter }
            : {}),
        }
      : action.symbolSource.kind === "zone_symbols"
        ? {
            kind: action.symbolSource.kind,
            playerId: resolvePlayerRef(
              actingPlayerId,
              action.symbolSource.player,
              state
            ),
            zone: action.symbolSource.zone,
            ...(action.symbolSource.filter
              ? { filter: action.symbolSource.filter }
              : {}),
          }
        : {
            kind: action.symbolSource.kind,
            playerId: resolvePlayerRef(
              actingPlayerId,
              action.symbolSource.player,
              state
            ),
          }
    : undefined;
  // count: 固定値は modifierSymbolCount。DynamicCount は既定では消費時 live 評価の
  // modifierSymbolCountDynamic に振り分け、snapshot 指定時だけ登録時の値へ固定する。
  const symbolCountFields =
    action.count === undefined
      ? {}
      : typeof action.count === "number"
        ? { modifierSymbolCount: action.count }
        : action.countEvaluation === "snapshot"
          ? { modifierSymbolCount: resolvedSymbolCount }
          : { modifierSymbolCountDynamic: action.count };

  const ceTargets: Partial<
    Pick<
      ContinuousEffect,
      "targetInstanceId" | "targetFilter" | "targetExcludeSelf"
    >
  >[] = action.continuousTarget
    ? [
        {
          targetFilter: {
            ...action.continuousTarget.filter,
            player: action.continuousTarget.player,
            zone: action.continuousTarget.zone
              ? Array.isArray(action.continuousTarget.zone)
                ? action.continuousTarget.zone
                : [action.continuousTarget.zone]
              : ["field"],
          },
          ...(action.continuousTarget.excludeSelf
            ? { targetExcludeSelf: true }
            : {}),
        },
      ]
    : toModify.map((card) => ({ targetInstanceId: card.instanceId }));
  const newEffects: ContinuousEffect[] = ceTargets.map((ceTarget) => ({
    effectId: nextCeId("symbol_addition"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration as Duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId:
      state.activeAttack?.attackId ?? battleEndDeferralAttackId ?? null,
    modifierTag: "symbol_addition",
    ...(symbolColors ? { modifierSymbol: symbolColors } : {}),
    ...(modifierSymbolSource ? { modifierSymbolSource } : {}),
    ...symbolCountFields,
    ...ceTarget,
    ...(action.continuousTarget
      ? {
          metadata: {
            preventionLevel: sourcePreventionLevel ?? "none",
            ...(sourceTargetLockBypass
              ? { symbolAddSourceTargetLockBypass: sourceTargetLockBypass }
              : {}),
            ...(preventionBypass
              ? { symbolAddSourcePreventionBypass: preventionBypass }
              : {}),
          },
        }
      : {}),
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  }));

  state.log.push(
    ...toModify.map(
      (c) =>
        `effect:symbol_add:registered:${c.instanceId}:${symbolLogLabel}:${durationStr(action.duration)}`
    )
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
    ...(symbolAdditionRestrictionCountKey
      ? {
          symbolAdditionRestrictedCountThisTurn: {
            ...state.symbolAdditionRestrictedCountThisTurn,
            [symbolAdditionRestrictionCountKey]:
              (state.symbolAdditionRestrictedCountThisTurn?.[
                symbolAdditionRestrictionCountKey
              ] ?? 0) + attemptedSymbolAdditionCount,
          },
        }
      : {}),
  };
}

export function executeUnblockable(
  state: GameState,
  actingPlayerId: string,
  action: {
    target: EffectTarget;
    duration: Duration;
    continuousTarget?: Extract<TargetSpec, { kind: "filter" }>;
  },
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  // 常時の「すべて」は発揮開始時の対象一覧に固定しない。後から場に出たカードや
  // 色・系統・本来コストの変化も、ブロック宣言時の共通フィルタ評価へ追従させる。
  if (action.continuousTarget) {
    const target = action.continuousTarget;
    const ce: ContinuousEffect = {
      effectId: nextCeId("unblockable"),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration,
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: "unblockable",
      targetFilter: {
        ...target.filter,
        player: target.player,
        zone: target.zone
          ? Array.isArray(target.zone)
            ? target.zone
            : [target.zone]
          : ["field"],
      },
      ...(target.excludeSelf ? { targetExcludeSelf: true } : {}),
      ...(timingScope ? { timingScope } : {}),
      ...(provenance ? { provenance } : {}),
      metadata: {
        preventionLevel: sourcePreventionLevel ?? "none",
        ...(sourceTargetLockBypass ? { sourceTargetLockBypass } : {}),
      },
    };
    return {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, ce],
    };
  }
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const toProtect = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId,
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true
  );
  if (toProtect.length === 0) {
    state.log.push(
      `effect:unblockable:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const newEffects: ContinuousEffect[] = toProtect.map((card) => ({
    effectId: nextCeId("unblockable"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "unblockable",
    targetInstanceId: card.instanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  }));

  state.log.push(
    ...toProtect.map(
      (c) =>
        `effect:unblockable:registered:${c.instanceId}:${durationStr(action.duration)}`
    )
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

export function executeAllowBlockWhileExhausted(
  state: GameState,
  actingPlayerId: string,
  action: { target: EffectTarget; duration: Duration },
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const toGrant = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId,
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true
  );
  if (toGrant.length === 0) {
    state.log.push(
      `effect:allow_block_while_exhausted:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffects: ContinuousEffect[] = toGrant.map((card) => ({
    effectId: nextCeId("allow_block_while_exhausted"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "allow_block_while_exhausted",
    targetInstanceId: card.instanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  }));

  state.log.push(
    ...toGrant.map(
      (c) =>
        `effect:allow_block_while_exhausted:registered:${c.instanceId}:${durationStr(action.duration)}`
    )
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

/** allow_attack_while_exhausted (BSTH09-C04【追撃】) の CE 登録。executeAllowBlockWhileExhausted と同型。 */
export function executeAllowAttackWhileExhausted(
  state: GameState,
  actingPlayerId: string,
  action: { target: EffectTarget; duration: Duration },
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const toGrant = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId,
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true
  );
  if (toGrant.length === 0) {
    state.log.push(
      `effect:allow_attack_while_exhausted:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffects: ContinuousEffect[] = toGrant.map((card) => ({
    effectId: nextCeId("allow_attack_while_exhausted"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "allow_attack_while_exhausted",
    targetInstanceId: card.instanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  }));

  state.log.push(
    ...toGrant.map(
      (c) =>
        `effect:allow_attack_while_exhausted:registered:${c.instanceId}:${durationStr(action.duration)}`
    )
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

/** allow_tapless_battle_declare (BSTH09-C03) の CE 登録。executeAllowBlockWhileExhausted と同型。 */
export function executeAllowTaplessBattleDeclare(
  state: GameState,
  actingPlayerId: string,
  action: { target: EffectTarget; duration: Duration },
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const toGrant = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId,
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true
  );
  if (toGrant.length === 0) {
    state.log.push(
      `effect:allow_tapless_battle_declare:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffects: ContinuousEffect[] = toGrant.map((card) => ({
    effectId: nextCeId("allow_tapless_battle_declare"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "allow_tapless_battle_declare",
    targetInstanceId: card.instanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  }));

  state.log.push(
    ...toGrant.map(
      (c) =>
        `effect:allow_tapless_battle_declare:registered:${c.instanceId}:${durationStr(action.duration)}`
    )
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

export function executeBlockUnblockable(
  state: GameState,
  actingPlayerId: string,
  action: { target: EffectTarget; duration: Duration },
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const toGrant = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId,
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true
  );
  if (toGrant.length === 0) {
    state.log.push(
      `effect:block_unblockable:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffects: ContinuousEffect[] = toGrant.map((card) => ({
    effectId: nextCeId("block_unblockable"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "block_unblockable",
    targetInstanceId: card.instanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  }));

  state.log.push(
    ...toGrant.map(
      (c) =>
        `effect:block_unblockable:registered:${c.instanceId}:${durationStr(action.duration)}`
    )
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}
