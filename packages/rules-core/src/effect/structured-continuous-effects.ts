// Continuous-effects クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
// 効果耐性/戦闘・ダメージ防止/各種 restrict/suppress の継続効果生成。

import { getCardById } from "../card/card-lookup";
import { isCardInSetState } from "../model";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  CoreMoveDestinationReplacementAction,
  Duration,
  EffectResistanceAction,
  EffectTarget,
  ForceFirstAttackerAction,
  ForcedTargetInclusionAction,
  GameState,
  GateFlashStackCoreAction,
  GateFlashStackHandDiscardAction,
  GrantEffectSourcePreventionImmunityAction,
  HandGainPreventionAction,
  LifeGainReplacementAction,
  LifeGainPreventionAction,
  PreventBattleAction,
  PreventBraveSeparationAction,
  PreventNormalCoreMoveAction,
  PreventDeckDiscardAction,
  PreventHandDiscardAction,
  PreventLifeDamageAction,
  RedirectDeckDiscardToExcludeAction,
  RequireAttackExhaustCostAction,
  RequireBattleCostAction,
  RequireBattleDestroyCostAction,
  RequireHandGainCostAction,
  RestrictAdventAction,
  RestrictBurstActivationAction,
  RestrictCorePlacementAction,
  RestrictSymbolAdditionAction,
  RestrictEndAttackStepAction,
  RestrictEndBattleAction,
  RestrictEndStepAction,
  RestrictEndTurnAction,
  RestrictFieldCostPaymentAction,
  RestrictFlashAction,
  RestrictRecoveryAction,
  RestrictReserveCostPaymentAction,
  RestrictStackAction,
  SuppressStackSourceAction,
  TimingScope,
  Zone,
} from "../model";
import { resolvePlayerAffect } from "./effect-affect-adapter";
import { evaluateCondition } from "./structured-condition-eval";
import {
  durationStr,
  dynamicTargetFilterFromEffectTarget,
  resolvePlayerRef,
  resolveTargetCards,
} from "./structured-effect-interpreter";
import { nextCeId } from "./structured-effect-sequences";
import { allocateGroupedTargetsByStep } from "./native-target-resolution";
import type { TargetLockBypassProfile } from "./target-affect-gate";

function currentEffectBinding(
  continuation: NonNullable<GameState["pendingTargetedDisclosureContinuation"]>,
  targetInstanceId: string
): Record<string, unknown> {
  const allocation = continuation.targetGroups?.length
    ? allocateGroupedTargetsByStep({
        targetInstanceIds: continuation.targetInstanceIds,
        targetGroups: continuation.targetGroups,
      })
    : null;
  return {
    currentEffectSourceInstanceId: continuation.sourceInstanceId,
    currentEffectSourceDefinitionId: continuation.sourceDefinitionId,
    currentEffectIndex: continuation.effectIndex,
    currentEffectTargetStepId: continuation.targetStepId,
    ...(allocation
      ? {
          currentEffectTargetStepIds: [...allocation.idsByStepId]
            .filter(([, ids]) => ids.includes(targetInstanceId))
            .map(([stepId]) => stepId),
        }
      : {}),
  };
}

export function executeEffectImmunity(
  state: GameState,
  actingPlayerId: string,
  action: {
    target: EffectTarget;
    duration: Duration;
    sourceScope?: ContinuousEffect["immunitySourceScope"];
    sourcePlayerScope?: "opponent" | "self" | "any";
    sourceApplicabilityZone?: string | readonly string[];
    /** P3-141 qa-020 marker。`DSL.EffectImmunityAction.satisfiesPreventionRestriction` SSOT。 */
    satisfiesPreventionRestriction?: true;
  },
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  // P3-77 Phase 1: ゾーン束縛 duration の登録ガード。
  // while_set はソースがバースト/ミラージュのセット状態にある間だけ、while_on_field はフィールド滞在中のみ
  // 耐性を登録する。recomputeContinuousEffects (legal-actions-shared) の除去条件と対称。
  // これにより rebuild がフィールド遷移後のカードへ誤って耐性を再登録するのを防ぐ
  // (例: BSTH01-X07 が発動して field スピリットになった後の不正な永続耐性)。
  const durationScope = action.duration.scope;
  const srcCardForZone = getCardById(state, sourceInstanceId);
  const srcInSetState =
    srcCardForZone !== undefined && isCardInSetState(state, srcCardForZone);
  if (
    durationScope === "while_set" ||
    durationScope === "while_on_field" ||
    durationScope === "while_in_trash"
  ) {
    const zoneOk =
      durationScope === "while_set"
        ? srcInSetState
        : durationScope === "while_in_trash"
          ? srcCardForZone?.zone === "trash"
          : srcCardForZone?.zone === "field";
    if (!zoneOk) {
      state.log.push(
        `effect:effect_immunity:${durationScope}:source-zone-mismatch:skip`
      );
      return state;
    }
  }
  const currentEffectContinuation =
    action.duration.scope === "current_effect"
      ? state.pendingTargetedDisclosureContinuation
      : null;
  if (
    action.duration.scope === "current_effect" &&
    !currentEffectContinuation
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        "effect:effect_immunity:current_effect:no-targeted-disclosure-continuation",
      ],
    };
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  // ゾーン全体への動的耐性 (defense_immune targetFilter) は、従来
  // duration.scope==="while_on_field" (フィールド常駐) の場合のみ生成していた。
  // while_set (ミラージュ/バースト【セット中】、legal-actions-shared.ts の除去判定と対称)
  // も同じ「ソースがそのゾーンに居る間、対象ゾーンの全カードを動的に守る」形なので
  // 同じ経路へ合流させる (BSGE01-C04「自分の手札は5枚以下の間、相手の効果を受けない」
  // ＝ BSDB01-C06/BSTS01-C05 と同型のゾーン免疫だが、ソースがミラージュ滞在中限定)。
  // duration.scope==="turn" も同型の「ゾーン全体を一定期間動的に守る」形であり、
  // ソースのゾーン滞在ではなく経過ターン数 (removeExpiredContinuousEffects) で
  // 寿命管理する点だけが異なる (BSAZ02-M03「このターンの間、相手のデッキ/トラッシュは
  // …効果を受けない」ENGINE-effect-immunity-turn-scope-zone-filter)。
  // duration.scope==="step" も同型 (「次の自分のスタートステップまで、系統：「CB」を
  // 持つ自分のスピリットすべては相手の効果を受けない」BSLH01-X06)。寿命管理は
  // removeExpiredContinuousEffects の step_end トリガー (duration.step/whose 一致判定)
  // に委譲され、ここでは対象を静的スナップショットでなく動的 targetFilter として
  // 登録する点だけが while_on_field/turn と共通。
  const dynamicTargetFilter =
    action.duration.scope === "while_on_field" ||
    action.duration.scope === "while_set" ||
    action.duration.scope === "turn" ||
    action.duration.scope === "step"
      ? dynamicTargetFilterFromEffectTarget(action.target)
      : null;
  if (dynamicTargetFilter) {
    const newEffect: ContinuousEffect = {
      effectId: nextCeId("defense_immune"),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration,
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: "defense_immune",
      targetFilter: dynamicTargetFilter,
      ...(action.sourceScope
        ? { immunitySourceScope: action.sourceScope }
        : {}),
      ...(action.sourcePlayerScope
        ? { immunityPlayerScope: action.sourcePlayerScope }
        : {}),
      ...(timingScope ? { timingScope } : {}),
      ...(provenance ? { provenance } : {}),
      ...(action.satisfiesPreventionRestriction
        ? { metadata: { satisfiesPreventionRestriction: true } }
        : {}),
    };
    return {
      ...state,
      log: [
        ...state.log,
        `effect:effect_immunity:registered:dynamic:${durationStr(action.duration)}`,
      ],
      activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
    };
  }

  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  // セット中(burst/mirage)・トラッシュ/手札/手元のソースを self 対象で保護する場合、collectTargetCardCandidates は
  // field 限定 (selfCard は zone==="field" 必須) のため解決できない。
  // 「セットしているこのカードは相手の効果を受けず」(BSTH01-X07 節①)・
  // 「トラッシュにあるこのカードは効果を受けない」(BSTH002-M01 等)・
  // 「手札にあるこのカードは相手の効果を受けない」(BSES01-C04 等) を成立させるため、
  // self 対象 + extra zone 滞在時はソースカードを直接保護対象にする。
  const srcInTrash = srcCardForZone?.zone === "trash";
  const srcInHandLike =
    srcCardForZone?.zone === "hand" || srcCardForZone?.zone === "set_aside";
  const toProtect =
    action.target.selfCard &&
    (srcInSetState || srcInTrash || srcInHandLike) &&
    srcCardForZone
      ? [srcCardForZone]
      : resolveTargetCards(
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
      `effect:effect_immunity:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const metadata: Record<string, unknown> = {};
  if (action.sourceApplicabilityZone !== undefined) {
    metadata.sourceApplicabilityZone = action.sourceApplicabilityZone;
  }
  if (action.satisfiesPreventionRestriction) {
    metadata.satisfiesPreventionRestriction = true;
  }
  const newEffects: ContinuousEffect[] = toProtect.map((card) => ({
    effectId: nextCeId("defense_immune"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "defense_immune",
    targetInstanceId: card.instanceId,
    ...(action.sourceScope ? { immunitySourceScope: action.sourceScope } : {}),
    ...(action.sourcePlayerScope
      ? { immunityPlayerScope: action.sourcePlayerScope }
      : {}),
    ...(timingScope ? { timingScope } : {}),
    ...(currentEffectContinuation || Object.keys(metadata).length > 0
      ? {
          metadata: {
            ...metadata,
            ...(currentEffectContinuation
              ? currentEffectBinding(currentEffectContinuation, card.instanceId)
              : {}),
          },
        }
      : {}),
    ...(provenance ? { provenance } : {}),
  }));

  state.log.push(
    ...toProtect.map(
      (c) =>
        `effect:effect_immunity:registered:${c.instanceId}:${durationStr(action.duration)}`
    )
  );
  const nextState = {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
  if (action.duration.scope === "current_effect") {
    const continuation = currentEffectContinuation!;
    return {
      ...nextState,
      pendingTargetedDisclosureContinuation: {
        ...continuation,
        resolutionCleanups: [
          ...(continuation.resolutionCleanups ?? []),
          {
            kind: "continuous_effects",
            effectIds: newEffects.map((effect) => effect.effectId),
          },
        ],
      },
    };
  }
  return {
    ...nextState,
  };
}

export function executePreventLifeDamage(
  state: GameState,
  actingPlayerId: string,
  action: PreventLifeDamageAction,
  sourceInstanceId: string,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("prevent_life_damage"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "prevent_life_damage",
    targetInstanceId: targetPlayerId,
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:prevent_life_damage:registered:${targetPlayerId}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「(player)は、Nコスト支払わなければ、(player)の効果でデッキ/トラッシュ/オープンした
 * カードから手札を増やせない」(hand_gain_cost_gate, engine-opponent-hand-gain-paid-tax-gate,
 * BSRK01-C02[3,4]) の CE 登録。player-scoped CE (targetInstanceId = 制約対象プレイヤーID) だが
 * 「相手のターン」限定のため require_battle_cost と同じく `timingScope` を CE に保持し、
 * `getCEsForTarget` (timingScope 尊重) で読ませる。実際の affordability 判定・自動支払いは
 * `resolveDeckRevealCostGateToApply` (deck-reveal-pick-candidates.ts) +
 * `payDeckRevealCostGate` (pending-action-handlers.ts) が deck_reveal pick 解決時に行う。
 */
export function executeRequireHandGainCost(
  state: GameState,
  actingPlayerId: string,
  action: RequireHandGainCostAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("require_hand_gain_cost"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "hand_gain_cost_gate",
    targetInstanceId: targetPlayerId,
    metadata: {
      costAmount: action.costAmount,
    },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  state.log.push(
    `effect:require_hand_gain_cost:registered:${targetPlayerId}:${action.costAmount}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「(player)は、(player)の効果で手札を増やせない」完全禁止 (hand_gain_prevention,
 * engine-restrict-hand-gain-bsrk01-x01, BSRK01-X01 合体結誓) の CE 登録。
 * player-scoped CE (targetInstanceId = 制約対象プレイヤーID)。実際の消費は
 * `isHandGainPreventedByOwnEffect` (effect-resistance-check.ts) を経由し、効果の
 * 発揮者と手札を得るプレイヤーが同一の純増（draw / 非交換 bounce / search_zone /
 * search_deck / deck_reveal / move_card）だけを止める。
 */
export function executeHandGainPrevention(
  state: GameState,
  actingPlayerId: string,
  action: HandGainPreventionAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("hand_gain_prevention"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "hand_gain_prevention",
    targetInstanceId: targetPlayerId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  state.log.push(
    `effect:hand_gain_prevention:registered:${targetPlayerId}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

export function executeEffectResistance(
  state: GameState,
  actingPlayerId: string,
  action: EffectResistanceAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const currentEffectContinuation =
    action.duration.scope === "current_effect"
      ? state.pendingTargetedDisclosureContinuation
      : null;
  if (
    action.duration.scope === "current_effect" &&
    !currentEffectContinuation
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        "effect:effect_resistance:current_effect:no-targeted-disclosure-continuation",
      ],
    };
  }
  // 置換効果の場合: trigger / source / replacement を metadata に格納
  // （move_to 系 = 手札 / デッキ下、または advent_source = 煌臨元への追加。
  //   疲労残置は stay_on_field に移行済み）
  const replacementMetadata =
    action.resistType === "replace_field_exit"
      ? {
          trigger: action.replacementTrigger ?? "leave_field",
          source: action.source,
          replacement: action.replacementAction ?? {
            kind: "move_to" as const,
            zone: "hand" as const,
          },
        }
      : undefined;
  // P3-41 Phase A: cannot_* タグの consumer (executeDestroy 等) が source を
  // 参照できるよう metadata に保存する。
  // ruleStrength (10_rules/07b §71 スピリット状態ブレイヴ class) は同じ metadata 経路で plumb する。
  const cannotMetadata =
    action.resistType !== "replace_field_exit"
      ? {
          source: action.source,
          ...(action.targetLockSourceFilter
            ? { targetLockSourceFilter: action.targetLockSourceFilter }
            : {}),
          ...(action.coreMinimum !== undefined
            ? { coreMinimum: action.coreMinimum }
            : {}),
          ...(action.coreMinimumSource !== undefined
            ? { coreMinimumSource: action.coreMinimumSource }
            : {}),
          ...(action.entryZone !== undefined
            ? { entryZone: action.entryZone }
            : {}),
          ...(action.excludedCauses
            ? { excludedCauses: action.excludedCauses }
            : {}),
          ...(action.ruleStrength ? { ruleStrength: true } : {}),
        }
      : undefined;
  const ceMetadata = replacementMetadata ?? cannotMetadata;
  const effectivePreSelectedIds =
    action.duration.scope === "current_effect"
      ? (preSelectedIds ?? currentEffectContinuation?.targetInstanceIds)
      : preSelectedIds;

  // P3-41 Phase B: 動的 filter 化判定。
  //   target.count === -1 (= "all") かつ
  //   targetFilter で表現できるフィールド (player + category + colors + tribes +
  //   tribesRequired/tribesLogic + minCost/maxCost + cardName + zone) のみ使用なら、
  //   per-target snapshot ではなく単一 CE + targetFilter を登録する。
  //   これにより、後から場に出たカードも自動的に保護対象に含められる。
  //   replace_field_exit は advent_source/pay_cost 等 per-target で分岐しうる置換を
  //   保持するため snapshot が既定。move_to (単純な「手札/デッキ下へ戻る」) のみ
  //   class-wide 追従が必要なケースがあるため解禁する
  //   (adversarial verifier 2026-07-30 round1 指摘, BSTH07.8-M01「系統Xの自分の
  //   スピリットは相手効果で破壊/消滅時、手札に戻る」= 登録後に召喚された個体も
  //   対象に含む必要がある。checkFieldExitReplacement が getGlobalCEs 側も
  //   matchesEffectResistanceFilter で照合する)。
  //   tribesRequired/minCost/maxCost は matchesEffectResistanceFilter が
  //   matchesTribes (SSOT) + def.cost 比較で正しく評価できることを確認した上で解禁
  //   (2026-07-15 の maxCost snapshot-fallback 解禁 (prevent_battle 系) と同型の措置。
  //   「幻想」と「導魔」/「動玩」を持つコスト4以上、のような AND+OR+コスト下限の
  //   class-wide 効果耐性 (BSTH02.7-C04/BSTH02.7-R01) で、登録後に場へ出た対象も
  //   追従保護できるようにする)。
  //   convertTargetSpecToEffectTarget は tribesRequired を EffectTarget 上に
  //   フラット化しないため、t.filter (raw CardFilter) から直接読む。
  const t = action.target;
  const filterKeys = t.filter ? Object.keys(t.filter) : [];
  const isDynamicFilterSupported = filterKeys.every((key) =>
    [
      "category",
      "colors",
      "tribes",
      "tribesRequired",
      "tribesLogic",
      "minCost",
      "maxCost",
      "cardName",
    ].includes(key)
  );
  const isDynamicEligible =
    (action.resistType !== "replace_field_exit" ||
      action.replacementAction?.kind === "move_to") &&
    t.count === -1 &&
    isDynamicFilterSupported &&
    !t.selfCard &&
    t.maxBp === undefined &&
    t.minColorCount === undefined &&
    t.maxColorCount === undefined &&
    !t.cardNames &&
    !t.includeSoulState &&
    !t.includeGrandwalker &&
    !t.grandwalkerOnly &&
    !t.includeGrandstone;

  if (isDynamicEligible) {
    const newEffect: ContinuousEffect = {
      effectId: nextCeId("effect_resistance"),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration,
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: action.resistType,
      targetFilter: {
        player: t.player,
        ...(t.category ? { category: t.category } : {}),
        ...(t.colors ? { colors: t.colors } : {}),
        ...(t.tribes ? { tribes: t.tribes } : {}),
        ...(t.filter?.tribesRequired
          ? { tribesRequired: t.filter.tribesRequired }
          : {}),
        ...(t.tribesLogic ? { tribesLogic: t.tribesLogic } : {}),
        ...(t.minCost !== undefined ? { minCost: t.minCost } : {}),
        ...(t.maxCost !== undefined ? { maxCost: t.maxCost } : {}),
        ...(t.cardName ? { cardName: t.cardName } : {}),
        ...(t.zone ? { zone: Array.isArray(t.zone) ? t.zone : [t.zone] } : {}),
      },
      ...(timingScope ? { timingScope } : {}),
      ...(provenance ? { provenance } : {}),
      ...(ceMetadata ? { metadata: ceMetadata } : {}),
    };
    state.log.push(
      `effect:effect_resistance:${action.resistType}:registered:dynamic:${durationStr(action.duration)}`
    );
    const nextState = {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
    };
    if (action.duration.scope === "current_effect") {
      const continuation = currentEffectContinuation!;
      return {
        ...nextState,
        pendingTargetedDisclosureContinuation: {
          ...continuation,
          resolutionCleanups: [
            ...(continuation.resolutionCleanups ?? []),
            { kind: "continuous_effects", effectIds: [newEffect.effectId] },
          ],
        },
      };
    }
    return nextState;
  }

  // per-target snapshot 経路 (count != -1, replace_field_exit, または filter 不可)
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  // セット中(burst/mirage)・トラッシュのソースを self 対象で保護する場合、resolveTargetCards
  // (→ collectTargetCardCandidates) は field 限定 (selfCard は zone==="field" 必須) のため
  // 解決できない。executeEffectImmunity の同名バイパス (本ファイル上部) と対称の措置。
  // 「トラッシュにあるこのカードは手札/デッキに戻らない」(BSTH02.7-C05 effects[0] 等) を
  // 成立させるため、self 対象 + セット/トラッシュゾーン滞在時はソースカードを直接保護対象にする。
  // needs-dsl: ENGINE-effect-resistance-return-from-trash-gate。
  const srcInSetZoneForResistance =
    sourceCard?.zone === "burst" || sourceCard?.zone === "mirage";
  const srcInTrashForResistance = sourceCard?.zone === "trash";
  const toProtect =
    action.target.selfCard &&
    (srcInSetZoneForResistance || srcInTrashForResistance) &&
    sourceCard
      ? [sourceCard]
      : resolveTargetCards(
          state,
          targetPlayerId,
          action.target,
          getCardDefinitionById,
          sourceInstanceId,
          effectivePreSelectedIds,
          actingPlayerId,
          sourcePreventionLevel,
          sourceTargetLockBypass,
          true
        );
  if (toProtect.length === 0) {
    state.log.push(
      `effect:effect_resistance:${action.resistType}:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const newEffects: ContinuousEffect[] = toProtect.map((card) => ({
    effectId: nextCeId("effect_resistance"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: action.resistType,
    targetInstanceId: card.instanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(currentEffectContinuation
      ? {
          metadata: {
            ...(ceMetadata ?? {}),
            ...currentEffectBinding(currentEffectContinuation, card.instanceId),
          },
        }
      : ceMetadata
        ? { metadata: ceMetadata }
        : {}),
    ...(provenance ? { provenance } : {}),
  }));

  state.log.push(
    ...toProtect.map(
      (c) =>
        `effect:effect_resistance:${action.resistType}:registered:${c.instanceId}:${durationStr(action.duration)}`
    )
  );
  const nextState = {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
  if (action.duration.scope === "current_effect") {
    const continuation = currentEffectContinuation!;
    return {
      ...nextState,
      pendingTargetedDisclosureContinuation: {
        ...continuation,
        resolutionCleanups: [
          ...(continuation.resolutionCleanups ?? []),
          {
            kind: "continuous_effects",
            effectIds: newEffects.map((effect) => effect.effectId),
          },
        ],
      },
    };
  }
  return nextState;
}

export function executePreventBraveSeparation(
  state: GameState,
  actingPlayerId: string,
  action: PreventBraveSeparationAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const targets = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId,
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    undefined
  );
  if (targets.length === 0) {
    state.log.push(
      `effect:prevent_brave_separation:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const newEffects: ContinuousEffect[] = targets.map((card) => ({
    effectId: nextCeId("prevent_brave_separation"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "prevent_brave_separation",
    targetInstanceId: card.instanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  }));

  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
    log: [
      ...state.log,
      ...targets.map(
        (card) =>
          `effect:prevent_brave_separation:registered:${card.instanceId}:${durationStr(action.duration)}`
      ),
    ],
  };
}

/**
 * 「(対象)は《ソウルコア》以外のコアを取り除けない」。
 *
 * target-scoped CE を登録するだけであり、通常コアを実際に移動する各経路は
 * core-system.ts の source-side choke point を通る。ソウルコア移動には CE を参照しない。
 */
export function executePreventNormalCoreMove(
  state: GameState,
  actingPlayerId: string,
  action: PreventNormalCoreMoveAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const targets = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId,
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    undefined
  );
  if (targets.length === 0) {
    state.log.push(
      `effect:prevent_normal_core_move:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const newEffects: ContinuousEffect[] = targets.map((card) => ({
    effectId: nextCeId("prevent_normal_core_move"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "prevent_normal_core_move",
    targetInstanceId: card.instanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  }));

  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
    log: [
      ...state.log,
      ...targets.map(
        (card) =>
          `effect:prevent_normal_core_move:registered:${card.instanceId}:${durationStr(action.duration)}`
      ),
    ],
  };
}

export function executePreventBattle(
  state: GameState,
  actingPlayerId: string,
  action: PreventBattleAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const sourceCardForCe = getCardById(state, sourceInstanceId);
  const tag = `prevent_battle_${action.restriction}` as ContinuousEffectTag;

  // 動的 filter 化判定（effect_resistance と同型）。
  //   target.count === -1 (= "all") かつ player + category + maxCores/minCores/maxCost/minCost
  //   のみで表現できるなら、per-target snapshot ではなく単一 CE + targetFilter を登録する。
  //   これにより「コアN個以下の相手スピリットはアタックできない」「コストN以下の相手は
  //   アタック/ブロックできない」(BSAZ02-C03) のように、評価時点のコア数/コストで動的に
  //   マッチする継続的戦闘制限を表現できる（後から場に出たカードやコア増減も自動反映。
  //   battle-availability が getGlobalCEs で消費）。maxCost/minCost は実消費側
  //   (isPreventedByGlobalFilterCE → matchesGlobalCETargetFilter) が実 CardInstance を
  //   渡すため常に actualCard 経由の matchesCardFilter (SSOT、cost 判定込み) で評価され、
  //   effect_resistance 版のような allowlist 制約を持たない (adversarial verifier
  //   2026-07-15 round1 指摘: maxCost 指定時は snapshot に fallback し、登録後に場へ出た
  //   対象コスト帯の相手カードへ追従しない silent gap だった。matchesGlobalCETargetFilter の
  //   actualCard 分岐が既に maxCost を正しく判定できることを確認した上で解禁)。
  //   colors/tribes 等 matchesGlobalCETargetFilter の !actualCard フォールバック分岐限定の
  //   フィールドを含む場合は snapshot にフォールバック（過剰マッチ防止）。
  const t = action.target;
  const isDynamicEligible =
    t.count === -1 &&
    !t.selfCard &&
    t.maxBp === undefined &&
    t.minColorCount === undefined &&
    t.maxColorCount === undefined &&
    !t.tribesRequired &&
    !t.tribes &&
    !t.colors &&
    !t.cardNames &&
    !t.includeSoulState &&
    !t.includeGrandwalker &&
    !t.grandwalkerOnly &&
    !t.includeGrandstone;

  if (isDynamicEligible) {
    const newEffect: ContinuousEffect = {
      effectId: nextCeId("prevent_battle"),
      sourceInstanceId,
      sourceDefinitionId: sourceCardForCe?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration,
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: tag,
      metadata: {
        ...(action.ruleStrength ? { ruleStrength: true } : {}),
        preventionLevel: sourcePreventionLevel ?? "none",
        ...(sourceTargetLockBypass ? { sourceTargetLockBypass } : {}),
      },
      targetFilter: {
        player: t.player,
        ...(t.category ? { category: t.category } : {}),
        ...(t.maxCores !== undefined ? { maxCores: t.maxCores } : {}),
        ...(t.minCores !== undefined ? { minCores: t.minCores } : {}),
        ...(t.maxCost !== undefined ? { maxCost: t.maxCost } : {}),
        ...(t.minCost !== undefined ? { minCost: t.minCost } : {}),
        ...(t.declaredThisTurn !== undefined
          ? { declaredThisTurn: t.declaredThisTurn }
          : {}),
      },
      ...(timingScope ? { timingScope } : {}),
      ...(provenance ? { provenance } : {}),
    };
    state.log.push(
      `effect:prevent_battle:${action.restriction}:registered:dynamic:${durationStr(action.duration)}`
    );
    return {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
    };
  }

  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const toPrevent = resolveTargetCards(
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
  if (toPrevent.length === 0) {
    state.log.push(
      `effect:prevent_battle:${action.restriction}:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  // restriction を modifierTag に変換: "attack" → "prevent_battle_attack" 等。
  // ここに届く action.restriction は effect-interpreter で配列 ["attack","block"] から
  // v1 文字列 "attack"|"block"|"both" に正規化済み (effect-interpreter.ts:2068)。
  // tag は関数冒頭で算出済み（dynamic / snapshot 共通）。
  const newEffects: ContinuousEffect[] = toPrevent.map((card) => ({
    effectId: nextCeId("prevent_battle"),
    sourceInstanceId,
    sourceDefinitionId: sourceCardForCe?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    targetInstanceId: card.instanceId,
    ...(action.ruleStrength ? { metadata: { ruleStrength: true } } : {}),
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  }));

  state.log.push(
    ...toPrevent.map(
      (c) =>
        `effect:prevent_battle:${action.restriction}:registered:${c.instanceId}:${durationStr(action.duration)}`
    )
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

/**
 * 「アタック/ブロックする(対象)から Nコスト支払わなければアタック/ブロックできない」
 * (battle_cost_gate, BSAZ01-C09) の CE 登録。prevent_battle と異なり全面禁止ではなく、
 * 対象カード自身の通常コアからの支払い可否を battle-availability.ts が動的に判定する
 * ゲート CE を登録するのみ（実際の支払いは battle-actions.ts の宣言確定処理が行う）。
 * executePreventBattle の動的 filter 判定 (isDynamicEligible) と同じ eligibility を使う
 * (player + category + maxCores/minCores のみで表現できる対象、count は「すべて」限定)。
 * 対象がそれ以外の指定 (tribes/colors/cardNames 等) を含む構成は本カード群では発生しない
 * 前提のため未対応 (呼び出し側の DSL 誤用を早期検出するため例外)。
 */
export function executeRequireBattleCost(
  state: GameState,
  actingPlayerId: string,
  action: RequireBattleCostAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCardForCe = getCardById(state, sourceInstanceId);
  const t = action.target;
  const hasFixedTargets = (action.targetInstanceIds?.length ?? 0) > 0;
  const isDynamicEligible =
    (hasFixedTargets || t.count === -1) &&
    !t.selfCard &&
    t.maxBp === undefined &&
    t.minCost === undefined &&
    t.maxCost === undefined &&
    t.minColorCount === undefined &&
    t.maxColorCount === undefined &&
    !t.tribesRequired &&
    !t.tribes &&
    !t.colors &&
    !t.cardNames &&
    !t.includeSoulState &&
    !t.includeGrandwalker &&
    !t.grandwalkerOnly &&
    !t.includeGrandstone;
  if (!isDynamicEligible) {
    throw new Error(
      "require_battle_cost: target must be a dynamic filter (player + category + maxCores/minCores only, count: all)"
    );
  }
  const tag = `battle_cost_gate_${action.restriction}` as ContinuousEffectTag;
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("require_battle_cost"),
    sourceInstanceId,
    sourceDefinitionId: sourceCardForCe?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    targetFilter: {
      // A ref-targeted battle gate has already been resolved at the action
      // boundary.  Do not re-apply the declarative `self` / `opponent`
      // relation here: the fixed instance-id set below is the authority and
      // can legitimately name the opponent of the effect controller.
      player: hasFixedTargets ? "either" : t.player,
      ...(t.category ? { category: t.category } : {}),
      ...(t.maxCores !== undefined ? { maxCores: t.maxCores } : {}),
      ...(t.minCores !== undefined ? { minCores: t.minCores } : {}),
    },
    metadata: {
      costAmount: action.costAmount,
      ...(action.firstAttackOnly ? { firstAttackOnly: true } : {}),
      ...(hasFixedTargets
        ? { targetInstanceIds: [...action.targetInstanceIds!] }
        : {}),
    },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  state.log.push(
    `effect:require_battle_cost:${action.restriction}:registered:dynamic:${action.costAmount}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

export function executeRequireAttackExhaustCost(
  state: GameState,
  actingPlayerId: string,
  action: RequireAttackExhaustCostAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCardForCe = getCardById(state, sourceInstanceId);
  const t = action.target;
  const isDynamicEligible =
    t.count === -1 &&
    !t.selfCard &&
    t.maxBp === undefined &&
    t.minCost === undefined &&
    t.maxCost === undefined &&
    t.minColorCount === undefined &&
    t.maxColorCount === undefined &&
    !t.tribesRequired &&
    !t.tribes &&
    !t.colors &&
    !t.cardNames &&
    !t.includeSoulState &&
    !t.includeGrandwalker &&
    !t.grandwalkerOnly &&
    !t.includeGrandstone;
  if (!isDynamicEligible) {
    throw new Error(
      "require_attack_exhaust_cost: target must be a dynamic filter (player + category, count: all)"
    );
  }
  const categories = action.costTargetFilter.category;
  if (!categories || categories.length === 0) {
    throw new Error(
      "require_attack_exhaust_cost: costTargetFilter.category is required"
    );
  }
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("require_attack_exhaust_cost"),
    sourceInstanceId,
    sourceDefinitionId: sourceCardForCe?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "attack_exhaust_cost_gate",
    targetFilter: {
      player: t.player,
      ...(t.category ? { category: t.category } : {}),
    },
    metadata: { costTargetCategory: categories },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  state.log.push(
    `effect:require_attack_exhaust_cost:registered:dynamic:${categories.join(",")}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * require_attack_exhaust_cost の破壊版 (battle_destroy_cost_gate, BSDB01-C09)。
 * require_battle_cost と同じく restriction ("attack"|"block"|"both") で
 * modifierTag を分ける。対象自身と同じ controller の costTargetFilter.category
 * 合致カード1体を破壊できなければアタック/ブロック不可 (battle-availability.ts が判定)。
 */
export function executeRequireBattleDestroyCost(
  state: GameState,
  actingPlayerId: string,
  action: RequireBattleDestroyCostAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCardForCe = getCardById(state, sourceInstanceId);
  const t = action.target;
  const isDynamicEligible =
    t.count === -1 &&
    !t.selfCard &&
    t.maxBp === undefined &&
    t.minCost === undefined &&
    t.maxCost === undefined &&
    t.minColorCount === undefined &&
    t.maxColorCount === undefined &&
    !t.tribesRequired &&
    !t.tribes &&
    !t.colors &&
    !t.cardNames &&
    !t.includeSoulState &&
    !t.includeGrandwalker &&
    !t.grandwalkerOnly &&
    !t.includeGrandstone;
  if (!isDynamicEligible) {
    throw new Error(
      "require_battle_destroy_cost: target must be a dynamic filter (player + category, count: all)"
    );
  }
  const categories = action.costTargetFilter.category;
  if (!categories || categories.length === 0) {
    throw new Error(
      "require_battle_destroy_cost: costTargetFilter.category is required"
    );
  }
  const tag =
    `battle_destroy_cost_gate_${action.restriction}` as ContinuousEffectTag;
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("require_battle_destroy_cost"),
    sourceInstanceId,
    sourceDefinitionId: sourceCardForCe?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    targetFilter: {
      player: t.player,
      ...(t.category ? { category: t.category } : {}),
    },
    metadata: {
      costTargetCategory: categories,
      ...(action.destination ? { costDestination: action.destination } : {}),
    },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  state.log.push(
    `effect:require_battle_destroy_cost:${action.restriction}:registered:dynamic:${categories.join(",")}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

export function executeRestrictFlash(
  state: GameState,
  actingPlayerId: string,
  action: RestrictFlashAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  // P3-77 節②: 対象プレイヤーが「相手の効果を受けない」状態なら、相手起因の
  // プレイヤー対象制限 (「相手は、フラッシュを使用できない」型) は no-op。
  const restrictTargetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player,
    state
  );
  if (
    resolvePlayerAffect(state, restrictTargetPlayerId, actingPlayerId).kind !==
    "allowed"
  ) {
    state.log.push(
      `effect:restrict_flash:player-immune:skip:${restrictTargetPlayerId}`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  // source を正規化:
  // - "any" → 全ゾーン制限（zones は undefined）
  // - 単一 Zone / Zone[] → 重複除去した Zone[]
  const zones: Zone[] | "any" =
    action.source === "any"
      ? "any"
      : Array.isArray(action.source)
        ? Array.from(new Set(action.source))
        : [action.source];

  // 表示カテゴリ（GUI ラベル用の 3 値）。配列や hand/field 以外の単一ゾーンは "any" カテゴリに含めて
  // 詳細フィルタは metadata.restrictedZones に委ねる。
  let category: "hand" | "field" | "any";
  if (zones === "any") {
    category = "any";
  } else if (zones.length === 1 && zones[0] === "hand") {
    category = "hand";
  } else if (zones.length === 1 && zones[0] === "field") {
    category = "field";
  } else {
    category = "any";
  }
  const tag = `restrict_flash_${category}` as ContinuousEffectTag;

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("restrict_flash"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    // restrict_flash の対象プレイヤーを targetInstanceId に格納（プレイヤーID）
    targetInstanceId: resolvePlayerRef(actingPlayerId, action.player, state),
    ...(zones === "any" ? {} : { metadata: { restrictedZones: zones } }),
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  const sourceLabel = zones === "any" ? "any" : zones.join("+");
  state.log.push(
    `effect:restrict_flash:registered:${sourceLabel}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

export function executeRestrictStack(
  state: GameState,
  actingPlayerId: string,
  action: RestrictStackAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  // P3-77 節②: player target の場合、対象プレイヤーが「相手の効果を受けない」状態なら no-op。
  const restrictTargetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player,
    state
  );
  if (
    action.targetScope !== "effect_source" &&
    resolvePlayerAffect(state, restrictTargetPlayerId, actingPlayerId).kind !==
      "allowed"
  ) {
    state.log.push(
      `effect:restrict_stack:player-immune:skip:${restrictTargetPlayerId}`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const tag: ContinuousEffectTag = "restrict_stack";

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("restrict_stack"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    // restrict_flash と同様: 対象プレイヤーを targetInstanceId に格納
    targetInstanceId: restrictTargetPlayerId,
    metadata: {
      ...(action.targetScope ? { targetScope: action.targetScope } : {}),
      ...(action.effectFilter ? { effectFilter: action.effectFilter } : {}),
      ...(action.sourceCardFilter
        ? { sourceCardFilter: action.sourceCardFilter }
        : {}),
    },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:restrict_stack:registered:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「相手はバーストを発動できない」。negate_opponent_burst は発動後の効果抑制なので、
 * こちらは player-scoped CE を登録し、pending burst check の resolve action 生成側で消費する。
 */
export function executeRestrictBurstActivation(
  state: GameState,
  actingPlayerId: string,
  action: RestrictBurstActivationAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const restrictTargetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player,
    state
  );
  if (
    resolvePlayerAffect(state, restrictTargetPlayerId, actingPlayerId).kind !==
    "allowed"
  ) {
    state.log.push(
      `effect:restrict_burst_activation:player-immune:skip:${restrictTargetPlayerId}`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("restrict_burst_activation"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "cannot_activate_opponent_burst",
    targetInstanceId: restrictTargetPlayerId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    ...(action.cost ? { metadata: { cost: action.cost } } : {}),
  };

  state.log.push(
    `effect:restrict_burst_activation:registered:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「相手は【煌臨】できない」(ENGINE-restrict-advent、BSFT01-X01)。restrict_stack と同型の
 * player-scoped CE。消費側は legal-actions-shared.ts の isAdventRestricted。
 */
export function executeRestrictAdvent(
  state: GameState,
  actingPlayerId: string,
  action: RestrictAdventAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  // P3-77 節②: 対象プレイヤーが「相手の効果を受けない」状態なら no-op。
  const restrictTargetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player,
    state
  );
  if (
    resolvePlayerAffect(state, restrictTargetPlayerId, actingPlayerId).kind !==
    "allowed"
  ) {
    state.log.push(
      `effect:restrict_advent:player-immune:skip:${restrictTargetPlayerId}`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const tag: ContinuousEffectTag = "restrict_advent";

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("restrict_advent"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    targetInstanceId: restrictTargetPlayerId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:restrict_advent:registered:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「相手の[filter]カードは回復できない」(ENGINE-persistent-recovery-block-with-advent-host-exclusion、
 * BSTH11-X01【神域】)。restrict_advent と同型の player-scoped CE。消費側は
 * recovery-restriction.ts を通じ、リフレッシュと効果による回復の両方に適用する。
 */
export function executeRestrictRecovery(
  state: GameState,
  actingPlayerId: string,
  action: RestrictRecoveryAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  targetInstanceIds?: readonly string[]
): GameState {
  const restrictTargetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player,
    state
  );
  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("restrict_recovery"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "prevent_recovery",
    targetInstanceId: restrictTargetPlayerId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      ...(action.filter ? { filter: action.filter } : {}),
      ...(action.restriction ? { restriction: action.restriction } : {}),
    },
  };

  state.log.push(
    `effect:restrict_recovery:registered:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [
      ...state.activeContinuousEffects,
      ...(targetInstanceIds === undefined
        ? [newEffect]
        : targetInstanceIds.map((targetInstanceId, index) => ({
            ...newEffect,
            effectId: `${newEffect.effectId}:${index}`,
            targetInstanceId,
          }))),
    ],
  };
}

/**
 * 「相手はリザーブからコストが支払えない」(ENGINE-restrict-reserve-cost-payment、
 * BSSL01-R03)。restrict_advent と同型の player-scoped CE。消費側は
 * payment-system.ts の isReserveCostPaymentRestricted。
 */
export function executeRestrictReserveCostPayment(
  state: GameState,
  actingPlayerId: string,
  action: RestrictReserveCostPaymentAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const restrictTargetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player,
    state
  );
  if (
    resolvePlayerAffect(state, restrictTargetPlayerId, actingPlayerId).kind !==
    "allowed"
  ) {
    state.log.push(
      `effect:restrict_reserve_cost_payment:player-immune:skip:${restrictTargetPlayerId}`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const tag: ContinuousEffectTag = "restrict_reserve_cost_payment";

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("restrict_reserve_cost_payment"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    targetInstanceId: restrictTargetPlayerId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:restrict_reserve_cost_payment:registered:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「相手のマジックのスタック効果コストは、フィールドから支払えない」
 * (ENGINE-restrict-field-cost-payment、BSTH08-C06)。restrict_reserve_cost_payment と
 * 対称の player-scoped CE。消費側は payment-system.ts の isFieldCostPaymentRestricted。
 */
export function executeRestrictFieldCostPayment(
  state: GameState,
  actingPlayerId: string,
  action: RestrictFieldCostPaymentAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const restrictTargetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player,
    state
  );
  if (
    resolvePlayerAffect(state, restrictTargetPlayerId, actingPlayerId).kind !==
    "allowed"
  ) {
    state.log.push(
      `effect:restrict_field_cost_payment:player-immune:skip:${restrictTargetPlayerId}`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const tag: ContinuousEffectTag = "restrict_field_cost_payment";

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("restrict_field_cost_payment"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    targetInstanceId: restrictTargetPlayerId,
    ...(action.effectModes
      ? { metadata: { effectModes: action.effectModes } }
      : {}),
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:restrict_field_cost_payment:registered:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「自分の系統：「○○」を持つ効果は、相手の効果では防げない」
 * (engine-effect-prevention-immunity-tribes、BSSL01-X02[9,10])。restrict_field_cost_payment
 * と同型の player-scoped CE。消費側は legal-actions-shared.ts の
 * isEffectSourceTribePreventionImmune。
 */
export function executeGrantEffectSourcePreventionImmunity(
  state: GameState,
  actingPlayerId: string,
  action: GrantEffectSourcePreventionImmunityAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const beneficiaryPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player,
    state
  );

  const sourceCard = getCardById(state, sourceInstanceId);
  const tag: ContinuousEffectTag = "effect_source_prevention_immunity";
  const sourceScopeMetadata = (() => {
    if ("effectFilter" in action.sourceScope) return { ...action.sourceScope };
    if ("soulDriveDeparture" in action.sourceScope) {
      return { soulDriveDeparture: true as const };
    }
    if ("effectClass" in action.sourceScope) {
      return {
        effectClass: action.sourceScope.effectClass,
        source: action.sourceScope.source,
        ...(action.sourceScope.sourceMinLevel !== undefined
          ? { sourceMinLevel: action.sourceScope.sourceMinLevel }
          : {}),
      };
    }
    return { tribes: action.sourceScope.tribes };
  })();
  const sourceScopeLog = (() => {
    if ("effectFilter" in action.sourceScope)
      return `effectFilter:source=${action.sourceScope.source}`;
    if ("soulDriveDeparture" in action.sourceScope) return "soulDriveDeparture";
    if ("effectClass" in action.sourceScope) {
      return `effectClass=${action.sourceScope.effectClass}:source=${action.sourceScope.source}`;
    }
    return `tribes=${action.sourceScope.tribes.join("/")}`;
  })();

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("effect_source_prevention_immunity"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    targetInstanceId: beneficiaryPlayerId,
    metadata: {
      ...sourceScopeMetadata,
      ...(action.preventionBypass !== undefined
        ? { preventionBypass: action.preventionBypass }
        : {}),
      ...(action.appliesTo !== undefined
        ? { appliesTo: [...action.appliesTo] }
        : {}),
      ...(action.usageLimit !== undefined
        ? { usageLimit: action.usageLimit }
        : {}),
    },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:grant_effect_source_prevention_immunity:registered:${sourceScopeLog}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

export function executeSuppressStackSource(
  state: GameState,
  actingPlayerId: string,
  action: SuppressStackSourceAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourceApplicabilityZone?: string | readonly string[]
): GameState {
  const suppressedPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player,
    state
  );
  const sourceCard = getCardById(state, sourceInstanceId);
  if (!sourceCard) return state;

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("suppress_stack_source"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard.definitionId,
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "suppress_stack_source",
    targetInstanceId: sourceInstanceId,
    metadata: {
      suppressedPlayerId,
      ...(action.effectFilter ? { effectFilter: action.effectFilter } : {}),
      ...(sourceApplicabilityZone !== undefined
        ? { sourceApplicabilityZone }
        : {}),
    },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:suppress_stack_source:registered:${sourceInstanceId}:${suppressedPlayerId}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「このスピリットは可能ならこのターンの最初にアタックする」CE を登録する
 * (ENGINE-force-first-attack-this-turn)。duration は常に `{ scope: "turn" }` 固定
 * (今ターン終了で自然消滅。専用クリア処理は無く、getAttackDeclarationBlockReason 側で
 * 対象自身の legality を都度再評価することで「可能なら」の解除を表現する)。
 */
export function executeForceFirstAttacker(
  state: GameState,
  actingPlayerId: string,
  _action: ForceFirstAttackerAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  if (!sourceCard) return state;

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("force_first_attacker"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard.definitionId,
    actingPlayerId,
    duration: { scope: "turn" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "force_first_attacker",
    targetInstanceId: sourceInstanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(`effect:force_first_attacker:registered:${sourceInstanceId}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「相手が対象を選ぶ効果を発揮するとき、可能ならこのカードを対象に含めなければ
 * ならない」タウント CE を登録する (forced-target-inclusion-taunt cluster,
 * BSFT01-TR02(B))。duration は常に `{ scope: "while_on_field" }` 固定 (場を離れれば
 * 自然消滅。専用クリア処理は無く、消費側
 * `getMandatoryForcedTargetInclusionIds` が対象選択 pending の候補プールを都度
 * 再評価することで「可能なら」の解除を表現する)。
 */
export function executeForcedTargetInclusion(
  state: GameState,
  actingPlayerId: string,
  _action: ForcedTargetInclusionAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  if (!sourceCard) return state;

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("forced_target_inclusion"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard.definitionId,
    actingPlayerId,
    duration: { scope: "while_on_field" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "forced_target_inclusion",
    targetInstanceId: sourceInstanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:forced_target_inclusion:registered:${sourceInstanceId}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「(対象プレイヤー)の手札は、相手によって破棄されない」(手札破棄耐性)。
 *
 * player-scoped CE を登録する。restrict_stack と同様に targetInstanceId へ保護対象
 * プレイヤーの id を格納し、動的ゲート (handCountMax / minSourceCores) は metadata に
 * 退避して消費側 (executeDiscardHand) が解決直前に再評価する。
 */
export function executePreventHandDiscard(
  state: GameState,
  actingPlayerId: string,
  action: PreventHandDiscardAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const protectedPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player,
    state
  );
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("prevent_hand_discard"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "prevent_hand_discard",
    // restrict_stack と同様: 保護対象プレイヤーを targetInstanceId に格納
    targetInstanceId: protectedPlayerId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      ...(action.handCountMax !== undefined
        ? { handCountMax: action.handCountMax }
        : {}),
      ...(action.minSourceCores !== undefined
        ? { minSourceCores: action.minSourceCores }
        : {}),
    },
  };

  state.log.push(
    `effect:prevent_hand_discard:registered:${protectedPlayerId}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「(対象プレイヤー)のデッキは破棄されない」(デッキ破棄耐性)。
 *
 * player-scoped CE を登録する。prevent_hand_discard と同様に targetInstanceId へ保護対象
 * プレイヤーの id を格納し、消費側が真のデッキ破棄 (`move_card.deckDiscard: true` または
 * discard primitive) を解決するときに再評価する。
 * 手札破棄耐性と異なり「相手によって」限定ではなく原因不問で破棄を止める（カード本文
 * 「破棄されない」）。`player: "either"` のとき両プレイヤーの保護 CE を 1 個ずつ登録する。
 */
export function executePreventDeckDiscard(
  state: GameState,
  actingPlayerId: string,
  action: PreventDeckDiscardAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);

  // "either" = お互い → 両プレイヤーを保護対象とする。それ以外は self/opponent を解決。
  const protectedPlayerIds: string[] =
    action.player === "either"
      ? state.players.map((p) => p.id)
      : [resolvePlayerRef(actingPlayerId, action.player, state)];

  let nextState = state;
  for (const protectedPlayerId of protectedPlayerIds) {
    const newEffect: ContinuousEffect = {
      effectId: nextCeId("prevent_deck_discard"),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration,
      createdAtTurn: nextState.turnNumber,
      createdAtAttackId: nextState.activeAttack?.attackId ?? null,
      modifierTag: "prevent_deck_discard",
      targetInstanceId: protectedPlayerId,
      ...(timingScope ? { timingScope } : {}),
      ...(provenance ? { provenance } : {}),
    };
    nextState = {
      ...nextState,
      activeContinuousEffects: [
        ...nextState.activeContinuousEffects,
        newEffect,
      ],
      log: [
        ...nextState.log,
        `effect:prevent_deck_discard:registered:${protectedPlayerId}:${durationStr(action.duration)}`,
      ],
    };
  }
  return nextState;
}

/**
 * 「相手への「デッキ破棄効果」すべてを「デッキ除外効果」にする」(BSTH05.5-X02 Lv2
 * 【導域】『自分のアタックステップ』)。
 *
 * player-scoped CE を登録する。prevent_deck_discard と同型の消費経路 (executeMoveCard の
 * デッキ→トラッシュ判定) を使うが、当該デッキ所有者への破棄移動を止める代わりに移動先を
 * trash から removed_from_game へ差し替える (block ではなく redirect)。`player: "either"`
 * のとき両プレイヤーの CE を1個ずつ登録する (prevent_deck_discard と同型)。
 */
export function executeRedirectDeckDiscardToExclude(
  state: GameState,
  actingPlayerId: string,
  action: RedirectDeckDiscardToExcludeAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);

  const protectedPlayerIds: string[] =
    action.player === "either"
      ? state.players.map((p) => p.id)
      : [resolvePlayerRef(actingPlayerId, action.player, state)];

  let nextState = state;
  for (const protectedPlayerId of protectedPlayerIds) {
    const newEffect: ContinuousEffect = {
      effectId: nextCeId("redirect_deck_discard_to_exclude"),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration,
      createdAtTurn: nextState.turnNumber,
      createdAtAttackId: nextState.activeAttack?.attackId ?? null,
      modifierTag: "redirect_deck_discard_to_exclude",
      targetInstanceId: protectedPlayerId,
      ...(timingScope ? { timingScope } : {}),
      ...(provenance ? { provenance } : {}),
    };
    nextState = {
      ...nextState,
      activeContinuousEffects: [
        ...nextState.activeContinuousEffects,
        newEffect,
      ],
      log: [
        ...nextState.log,
        `effect:redirect_deck_discard_to_exclude:registered:${protectedPlayerId}:${durationStr(action.duration)}`,
      ],
    };
  }
  return nextState;
}

/**
 * 「(対象プレイヤーは)ライフにコアを置けない」/「(対象プレイヤーは)相手の効果でボイドから
 * コアを増やせない」。
 *
 * player-scoped CE を登録する。prevent_deck_discard と同型。`action.scope` (省略時
 * `"to_life"`) でタグを切り替える: `"to_life"` は消費側 (`executeCoreMove`) が
 * `to.kind==="life"` の移動先プレイヤーに対して原因(発動者)不問で全面ブロックする。
 * `"from_void_self"` は `from.kind==="void"` かつ移動元プレイヤー自身の効果のときのみ
 * ブロックする (ENGINE-void-core-decrease-trigger)。`player: "either"` のとき
 * 両プレイヤーの保護 CE を 1 個ずつ登録する。
 */
export function executeRestrictCorePlacement(
  state: GameState,
  actingPlayerId: string,
  action: RestrictCorePlacementAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const modifierTag: ContinuousEffectTag =
    action.scope === "from_void_self"
      ? "restrict_core_placement_void"
      : "restrict_core_placement_life";
  const metadata = {
    ...(action.scope !== "from_void_self" && action.fromZone
      ? { fromZone: action.fromZone }
      : {}),
    ...(action.scope === "from_void_self" && action.sourceTimingScope
      ? { sourceTimingScope: action.sourceTimingScope }
      : {}),
    ...(action.sourceFilter ? { sourceFilter: action.sourceFilter } : {}),
  };

  // "either" = お互い → 両プレイヤーを制限対象とする。それ以外は self/opponent を解決。
  const restrictedPlayerIds: string[] =
    action.player === "either"
      ? state.players.map((p) => p.id)
      : [resolvePlayerRef(actingPlayerId, action.player, state)];

  let nextState = state;
  for (const restrictedPlayerId of restrictedPlayerIds) {
    const newEffect: ContinuousEffect = {
      effectId: nextCeId(modifierTag),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration,
      createdAtTurn: nextState.turnNumber,
      createdAtAttackId: nextState.activeAttack?.attackId ?? null,
      modifierTag,
      targetInstanceId: restrictedPlayerId,
      ...(timingScope ? { timingScope } : {}),
      ...(provenance ? { provenance } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
    nextState = {
      ...nextState,
      activeContinuousEffects: [
        ...nextState.activeContinuousEffects,
        newEffect,
      ],
      log: [
        ...nextState.log,
        `effect:${modifierTag}:registered:${restrictedPlayerId}:${durationStr(action.duration)}`,
      ],
    };
  }
  return nextState;
}

/**
 * 「(対象プレイヤーは)スピリット/アルティメットの効果で合計でN個以上シンボルを
 * 追加できない」(BSTH03-C04 effects[2])。
 *
 * player-scoped CE (`restrict_symbol_addition`) を登録する。prevent_deck_discard /
 * restrict_core_placement と同型 (`player: "either"` で両プレイヤーへ 1 個ずつ登録)。
 * 消費側 (`executeSymbolAdd`) が `symbolAdditionRestrictedCountThisTurn` を参照し、
 * 累積が `maxTotal` に達したら以降の symbol_add を全面ブロックする。
 */
export function executeRestrictSymbolAddition(
  state: GameState,
  actingPlayerId: string,
  action: RestrictSymbolAdditionAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const restrictedPlayerIds: string[] =
    action.player === "either"
      ? state.players.map((p) => p.id)
      : [resolvePlayerRef(actingPlayerId, action.player, state)];

  let nextState = state;
  for (const restrictedPlayerId of restrictedPlayerIds) {
    const newEffect: ContinuousEffect = {
      effectId: nextCeId("restrict_symbol_addition"),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration,
      createdAtTurn: nextState.turnNumber,
      createdAtAttackId: nextState.activeAttack?.attackId ?? null,
      modifierTag: "restrict_symbol_addition",
      targetInstanceId: restrictedPlayerId,
      ...(timingScope ? { timingScope } : {}),
      ...(provenance ? { provenance } : {}),
      metadata: {
        maxTotal: action.maxTotal,
        ...(action.sourceFilter ? { sourceFilter: action.sourceFilter } : {}),
      },
    };
    nextState = {
      ...nextState,
      activeContinuousEffects: [
        ...nextState.activeContinuousEffects,
        newEffect,
      ],
      log: [
        ...nextState.log,
        `effect:restrict_symbol_addition:registered:${restrictedPlayerId}:${durationStr(action.duration)}`,
      ],
    };
  }
  return nextState;
}

/**
 * 「自分の効果で自分のライフが増えるとき、増やす代わりに[代替アクション]できる」
 * (BSTH02.7-X03 effects[3])。
 *
 * player-scoped CE を登録する。消費側 (`executeCoreMove`) が `to.kind==="life"` かつ
 * 移動先プレイヤー===actingPlayerId (自分の効果で自分のライフが増える) のときにこの CE を
 * 照合し、任意 (`pendingLifeGainReplacementChoice`) で増加そのものを代替アクションに置換できる。
 */
export function executeLifeGainReplacement(
  state: GameState,
  actingPlayerId: string,
  action: LifeGainReplacementAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("life_gain_replacement"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "life_gain_replacement",
    targetInstanceId: targetPlayerId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
    log: [
      ...state.log,
      `effect:life_gain_replacement:registered:${targetPlayerId}:${durationStr(action.duration)}`,
    ],
  };
}

/**
 * 「[プレイヤー]のライフは増やせない」型の完全禁止 (BSTH002-R02【セット中】
 * 「お互い、ライフは増やせず」)。
 *
 * player-scoped CE を登録する。消費側 (`executeCoreMove` の `to.kind==="life"` 経路、
 * `executeLifeFill`) が移動先プレイヤーに対してこの CE があれば、発揮者を問わず
 * core_move / life_fill を無条件で no-op 化する。
 */
export function executeLifeGainPrevention(
  state: GameState,
  actingPlayerId: string,
  action: LifeGainPreventionAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("life_gain_prevention"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "life_gain_prevention",
    targetInstanceId: targetPlayerId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
    log: [
      ...state.log,
      `effect:life_gain_prevention:registered:${targetPlayerId}:${durationStr(action.duration)}`,
    ],
  };
}

/**
 * 「このスピリットの効果で移動する相手のコアすべてはトラッシュに置かれる」
 * (BSKB01-R03【合体中】)。「相手のライフから移動するコアすべてをボイドに置く」
 * (BSTH03-M05 Lv5)。
 *
 * global CE を登録する。消費側 (`executeCoreMove`) が `fromOwner`/`fromZone`/
 * `matchCausingSourceOnly` に一致する移動を検知すると、`life_gain_replacement` と異なり
 * pending を挟まず強制的に `to` を `toZone` へ上書きして再実行する
 * (`getCoreMoveDestinationReplacementCE` 参照)。
 */
export function executeCoreMoveDestinationReplacement(
  state: GameState,
  actingPlayerId: string,
  action: CoreMoveDestinationReplacementAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("core_move_destination_replacement"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "core_move_destination_replacement",
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      fromOwner: action.fromOwner,
      ...(action.fromZone !== undefined ? { fromZone: action.fromZone } : {}),
      ...(action.matchCausingSourceOnly
        ? { matchCausingSourceOnly: true }
        : {}),
      toZone: action.toZone,
      ...(action.matchToZone !== undefined
        ? { matchToZone: action.matchToZone }
        : {}),
      ...(action.optional !== undefined ? { optional: action.optional } : {}),
    },
  };
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
    log: [
      ...state.log,
      `effect:core_move_destination_replacement:registered:${actingPlayerId}:${durationStr(action.duration)}`,
    ],
  };
}

/**
 * 「相手は[ゾーン]のコア1個をトラッシュに置かなければフラッシュ/スタック効果を発揮できない」。
 *
 * restrict_stack のプレイヤー耐性 skip は適用しない。10_rules/03c §「○○しなければ△△を
 * 発揮できない」のとおりこれは**カード/ゾーン対象の発揮前提除去効果**であり、耐性判定は
 * 発揮解決直前 (前置フック) に効果保持カード/コア源カードへ card immunity gate で
 * 個別適用する (プレイヤー耐性ではない)。
 */
export function executeGateFlashStackCore(
  state: GameState,
  actingPlayerId: string,
  action: GateFlashStackCoreAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);
  // 既定の除去元ゾーン: フィールド + リザーブ。明示時はそれを使う。
  const zones: Zone[] =
    action.source === undefined
      ? ["field", "reserve"]
      : Array.isArray(action.source)
        ? [...new Set(action.source)]
        : [action.source];

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("gate_flash_stack_core"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "gate_flash_stack_core",
    // ゲートされる側(=相手)のプレイヤーを targetInstanceId に格納 (restrict_stack と同様)。
    targetInstanceId: targetPlayerId,
    metadata: { coreSourceZones: zones },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:gate_flash_stack_core:registered:${zones.join("+")}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「相手は手札N枚を破棄しなければフラッシュ/スタック効果を発揮できない」。
 *
 * 追加コストではなく、対象プレイヤーの手札カードを破棄する発揮前提 gate として
 * player-scoped CE を登録する。破棄枚数・対象ラベル・宣言時ゾーン制限は metadata に保持し、
 * 解決直前の `computePayToActHandDiscardGate` で再評価する。
 */
export function executeGateFlashStackHandDiscard(
  state: GameState,
  actingPlayerId: string,
  action: GateFlashStackHandDiscardAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);
  const targetEffectLabels = action.targetEffectLabels ?? ["flash", "stack"];

  const newEffect: ContinuousEffect = {
    effectId: nextCeId("gate_flash_stack_hand_discard"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "gate_flash_stack_hand_discard",
    targetInstanceId: targetPlayerId,
    metadata: {
      handDiscardCount: action.count ?? 1,
      targetEffectLabels: [...targetEffectLabels],
      ...(action.sourceActivationZones !== undefined
        ? { sourceActivationZones: [...action.sourceActivationZones] }
        : {}),
      ...(action.noDuplicate === true ? { noDuplicate: true } : {}),
    },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
    log: [
      ...state.log,
      `effect:gate_flash_stack_hand_discard:registered:${targetEffectLabels.join("+")}:${durationStr(action.duration)}`,
    ],
  };
}

type RestrictEndAction =
  | RestrictEndAttackStepAction
  | RestrictEndBattleAction
  | RestrictEndStepAction
  | RestrictEndTurnAction;

function resolveRestrictEndSourcePreventionLevel(
  state: GameState,
  actingPlayerId: string,
  action: RestrictEndAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel?: import("../model").EffectPreventionLevel
): import("../model").EffectPreventionLevel {
  if (
    action.unpreventableIf &&
    action.unpreventableIf.length > 0 &&
    evaluateCondition(
      state,
      action.unpreventableIf,
      sourceInstanceId,
      actingPlayerId,
      getCardDefinitionById
    )
  ) {
    return "unpreventable";
  }
  return sourcePreventionLevel ?? "none";
}

function executeRestrictEndEffect(
  state: GameState,
  actingPlayerId: string,
  action: RestrictEndAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel
): GameState {
  const tag = action.kind;
  const restrictTargetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player,
    state
  );
  const effectivePreventionLevel = resolveRestrictEndSourcePreventionLevel(
    state,
    actingPlayerId,
    action,
    sourceInstanceId,
    getCardDefinitionById,
    sourcePreventionLevel
  );
  // P3-77 節②: 対象プレイヤーが「相手の効果を受けない」状態なら相手起因制限は no-op。
  // ただし「この『終了できない』効果は相手の効果では防げない」はその player immunity を貫通する。
  if (
    resolvePlayerAffect(
      state,
      restrictTargetPlayerId,
      actingPlayerId,
      effectivePreventionLevel
    ).kind !== "allowed"
  ) {
    state.log.push(
      `effect:${tag}:player-immune:skip:${restrictTargetPlayerId}`
    );
    return state;
  }

  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffect: ContinuousEffect = {
    effectId: nextCeId(tag),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: tag,
    targetInstanceId: restrictTargetPlayerId,
    metadata: { preventionLevel: effectivePreventionLevel },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  state.log.push(`effect:${tag}:registered:${durationStr(action.duration)}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

export function executeRestrictEndAttackStep(
  state: GameState,
  actingPlayerId: string,
  action: RestrictEndAttackStepAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel
): GameState {
  return executeRestrictEndEffect(
    state,
    actingPlayerId,
    action,
    sourceInstanceId,
    getCardDefinitionById,
    timingScope,
    provenance,
    sourcePreventionLevel
  );
}

export function executeRestrictEndBattle(
  state: GameState,
  actingPlayerId: string,
  action: RestrictEndBattleAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel
): GameState {
  return executeRestrictEndEffect(
    state,
    actingPlayerId,
    action,
    sourceInstanceId,
    getCardDefinitionById,
    timingScope,
    provenance,
    sourcePreventionLevel
  );
}

export function executeRestrictEndStep(
  state: GameState,
  actingPlayerId: string,
  action: RestrictEndStepAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel
): GameState {
  return executeRestrictEndEffect(
    state,
    actingPlayerId,
    action,
    sourceInstanceId,
    getCardDefinitionById,
    timingScope,
    provenance,
    sourcePreventionLevel
  );
}

export function executeRestrictEndTurn(
  state: GameState,
  actingPlayerId: string,
  action: RestrictEndTurnAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel
): GameState {
  return executeRestrictEndEffect(
    state,
    actingPlayerId,
    action,
    sourceInstanceId,
    getCardDefinitionById,
    timingScope,
    provenance,
    sourcePreventionLevel
  );
}
