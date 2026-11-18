// Extracted from legal-actions-apply.ts (P2-11 god-file decomposition).
import { getImmediateAttackJoinDecisions } from "./immediate-attack-join";
import {
  getPrimaryAttackSourceInstanceId,
  getCurrentAttackDefendingPlayerId,
  getResponseWindowOpponentId,
} from "./stack-window-openers";

import { recomputeAndRebuildBattleStateContinuousEffects } from "../effect/continuous-effect-rebuild";
import {
  getDesignatedAttackAttackerCard,
  isDesignatedAttackTargetLegal,
} from "../battle/battle-availability";

import type {
  CardInstance,
  GameState,
  PendingTriggeredEffect,
  StructuredTriggerEventActionKind,
} from "../model";

import {
  burstEventKindToStructuredEvent,
  getAvailableBurstSourceChoices,
  queueEffectActivationTriggers,
} from "../effect/trigger-system";
import type { ApplyLegalActionOptions } from "./legal-actions-types";

import { getCardById } from "../card/card-lookup";
import { hasOutstandingEffectResolutionContinuation } from "../state-based-actions";

export function fallbackDesignatedAttackToPlayerTarget(options: {
  state: GameState;
  activeAttack: NonNullable<GameState["activeAttack"]>;
  targetEntityId: string;
  targetInstanceId: string;
  targetCard: CardInstance | undefined;
  logSuffix: string;
}): GameState {
  const fallbackPlayerId =
    options.targetCard?.controllerPlayerId ??
    getCurrentAttackDefendingPlayerId(options.state);

  if (!fallbackPlayerId) {
    return options.state;
  }

  const nextActiveAttack = {
    ...options.activeAttack,
    target: { kind: "player" as const, playerId: fallbackPlayerId },
    blockAssignments: options.activeAttack.participantEntityIds.map(
      (participantEntityId) => ({
        participantEntityId,
        blockedByEntityIds: [],
      })
    ),
    flashBeforeBlockCompleted: false,
  };
  delete nextActiveAttack.designatedTargetInstanceId;

  options.state.log.push(
    `attack:spirit-target-cancelled:${options.targetInstanceId}:${options.logSuffix}`
  );
  return {
    ...options.state,
    window: "declare_attack",
    preDeclarationStackWindow: null,
    battleEntities: options.state.battleEntities.map((battleEntity) =>
      battleEntity.entityId === options.targetEntityId
        ? { ...battleEntity, attackState: "idle" as const }
        : battleEntity
    ),
    activeAttack: nextActiveAttack,
  };
}

export function maybeQueueAttackAfterBurstCheck(
  state: GameState,
  options: Pick<
    ApplyLegalActionOptions,
    "getCardDefinitionById" | "getRegisteredBurstActions"
  >
): GameState {
  const activeAttack = state.activeAttack;

  if (
    !activeAttack ||
    state.step !== "attack" ||
    state.window !== "declare_attack" ||
    state.preDeclarationStackWindow !== null ||
    state.battleImmediateEffects.length > 0 ||
    activeAttack.attackAfterBurstChecked === true ||
    activeAttack.flashBeforeBlockCompleted
  ) {
    return state;
  }

  if (
    state.pendingBurstChecks.some(
      (pendingBurstCheck) =>
        pendingBurstCheck.eventKind === "attack_after" &&
        pendingBurstCheck.attackId === activeAttack.attackId
    )
  ) {
    return state;
  }

  if (!options.getRegisteredBurstActions) {
    return state;
  }

  const attackerInstanceId = getPrimaryAttackSourceInstanceId(state);

  if (!attackerInstanceId) {
    return state;
  }

  const attackerCard = getCardById(state, attackerInstanceId);

  if (!attackerCard || attackerCard.zone !== "field") {
    return state;
  }

  const defendingPlayerId = getCurrentAttackDefendingPlayerId(state);

  if (!defendingPlayerId) {
    return state;
  }

  const pendingBurstCheck = {
    checkId: `burst:attack-after:${state.turnNumber}:${activeAttack.attackId}:${attackerInstanceId}:${defendingPlayerId}`,
    actingPlayerId: defendingPlayerId,
    eventKind: "attack_after" as const,
    event: burstEventKindToStructuredEvent("attack_after"),
    source: "action_resolution" as const,
    chainId: activeAttack.attackId,
    attackId: activeAttack.attackId,
    relatedPlayerId: attackerCard.controllerPlayerId,
    relatedInstanceId: attackerInstanceId,
    amount: 1,
    step: state.step,
    window: state.window,
    resolvedBurstCardInstanceIds: [],
  };

  const sourceChoices = getAvailableBurstSourceChoices({
    state,
    pendingBurstCheck,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  if (sourceChoices.length === 0) {
    return {
      ...state,
      activeAttack: {
        ...activeAttack,
        attackAfterBurstChecked: true,
      },
    };
  }

  state.log.push(
    `burst:queued:${pendingBurstCheck.checkId}:${pendingBurstCheck.eventKind}:${pendingBurstCheck.relatedPlayerId}`
  );
  return {
    ...state,
    activeAttack: {
      ...activeAttack,
      attackAfterBurstChecked: true,
    },
    pendingBurstChecks: [...state.pendingBurstChecks, pendingBurstCheck],
  };
}

/**
 * バースト追加発動条件（裁定 2026-07-23, 10_rules/04b_burst-rules.md
 * §セット中バーストの追加発動条件）: 「セットしているこのカードは、自分の
 * スピリットがアタックしたときに発動できる」型 (BSGE01-M03/M04)。
 *
 * maybeQueueAttackAfterBurstCheck (defender 向け「相手のアタック後」) と同じ
 * declare_attack 窓のガード条件を使うが、こちらは attacker 自身の burst-set を
 * 走査する pendingBurstCheck を積む (actingPlayerId = attacker のコントローラー)。
 * 「アタック誘発効果 (『アタック時』等) より先に解決できない」「アタック誘発効果
 * 解決中にアタックしているスピリットがいなくなれば発動できない」は、この関数が
 * advanceAttackDeclarationStateIfReady 経由で battleImmediateEffects /
 * preDeclarationStackWindow が捌け切った後にのみ呼ばれ、かつ attackerCard が
 * まだ field 上にあることを都度確認することで自然に満たされる。
 */
export function maybeQueueOwnAttackBurstCheck(
  state: GameState,
  options: Pick<
    ApplyLegalActionOptions,
    "getCardDefinitionById" | "getRegisteredBurstActions"
  >
): GameState {
  const activeAttack = state.activeAttack;

  if (
    !activeAttack ||
    state.step !== "attack" ||
    state.window !== "declare_attack" ||
    state.preDeclarationStackWindow !== null ||
    state.battleImmediateEffects.length > 0 ||
    activeAttack.ownAttackBurstChecked === true ||
    activeAttack.flashBeforeBlockCompleted
  ) {
    return state;
  }

  if (
    state.pendingBurstChecks.some(
      (pendingBurstCheck) =>
        pendingBurstCheck.eventKind === "own_attack" &&
        pendingBurstCheck.attackId === activeAttack.attackId
    )
  ) {
    return state;
  }

  if (!options.getRegisteredBurstActions) {
    return state;
  }

  const attackerInstanceId = getPrimaryAttackSourceInstanceId(state);

  if (!attackerInstanceId) {
    return state;
  }

  const attackerCard = getCardById(state, attackerInstanceId);

  if (!attackerCard || attackerCard.zone !== "field") {
    return state;
  }

  const defendingPlayerId = getCurrentAttackDefendingPlayerId(state);

  if (!defendingPlayerId) {
    return state;
  }

  const pendingBurstCheck = {
    checkId: `burst:own-attack:${state.turnNumber}:${activeAttack.attackId}:${attackerInstanceId}`,
    actingPlayerId: attackerCard.controllerPlayerId,
    eventKind: "own_attack" as const,
    event: burstEventKindToStructuredEvent("own_attack"),
    source: "action_resolution" as const,
    chainId: activeAttack.attackId,
    attackId: activeAttack.attackId,
    relatedPlayerId: attackerCard.controllerPlayerId,
    relatedInstanceId: attackerInstanceId,
    amount: 1,
    step: state.step,
    window: state.window,
    resolvedBurstCardInstanceIds: [],
  };

  const sourceChoices = getAvailableBurstSourceChoices({
    state,
    pendingBurstCheck,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  if (sourceChoices.length === 0) {
    return {
      ...state,
      activeAttack: {
        ...activeAttack,
        ownAttackBurstChecked: true,
      },
    };
  }

  state.log.push(
    `burst:queued:${pendingBurstCheck.checkId}:${pendingBurstCheck.eventKind}:${pendingBurstCheck.relatedPlayerId}`
  );
  return {
    ...state,
    activeAttack: {
      ...activeAttack,
      ownAttackBurstChecked: true,
    },
    pendingBurstChecks: [...state.pendingBurstChecks, pendingBurstCheck],
  };
}

/**
 * maybeQueueEffectActivationBurstCheck / maybeQueueAnyEffectActivationBurstCheck 共通の
 * watcher 走査ロジック (adversarial verifier round1 Lens3: 重複ループの統合)。
 * activatedActionKind が null の場合は eventMatcher.actionKind を持たない
 * wildcard イベントを組み立てる (any_effect_activated 用)。
 */
function queueEffectActivationBurstChecksForWatchers(args: {
  state: GameState;
  chainId: string;
  checkIdTag: string;
  activatorPlayerId: string;
  relatedInstanceId: string | null;
  activatedActionKind: StructuredTriggerEventActionKind | null;
  options: Pick<
    ApplyLegalActionOptions,
    "getCardDefinitionById" | "getRegisteredBurstActions"
  >;
}): GameState {
  const {
    state,
    checkIdTag,
    activatorPlayerId,
    relatedInstanceId,
    activatedActionKind,
    options,
  } = args;

  if (!options.getRegisteredBurstActions) return state;

  const event = {
    family: "effect_activation" as const,
    ...(activatedActionKind !== null
      ? { actionKind: activatedActionKind }
      : {}),
    validationMode: "snapshot_only" as const,
  };

  let nextState = state;
  for (const watcherPlayerId of state.playerOrder) {
    const pendingBurstCheck = {
      checkId: [
        checkIdTag,
        nextState.turnNumber,
        activatorPlayerId,
        relatedInstanceId ?? "none",
        activatedActionKind ?? "any",
        watcherPlayerId,
        nextState.pendingBurstChecks.length,
      ].join(":"),
      actingPlayerId: watcherPlayerId,
      eventKind: "effect_activated" as const,
      event,
      source: "action_resolution" as const,
      chainId: args.chainId,
      attackId: null,
      relatedPlayerId: activatorPlayerId,
      relatedInstanceId,
      amount: 1,
      step: nextState.step,
      window: nextState.window,
      resolvedBurstCardInstanceIds: [],
    };

    const sourceChoices = getAvailableBurstSourceChoices({
      state: nextState,
      pendingBurstCheck,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
    if (sourceChoices.length === 0) continue;

    nextState = {
      ...nextState,
      log: [
        ...nextState.log,
        `burst:queued:${pendingBurstCheck.checkId}:${pendingBurstCheck.eventKind}:${pendingBurstCheck.relatedPlayerId}`,
      ],
      pendingBurstChecks: [...nextState.pendingBurstChecks, pendingBurstCheck],
    };
  }

  return nextState;
}

/**
 * P3-67 Phase 3: 誘発効果 (card_event:summon/place/advent = 「召喚時/配置時/煌臨時」) の
 * 発揮完了直後に「効果発揮型」バースト (effect_activated) のチェックを積む。
 *
 * 「相手の『このスピリット／アルティメットの召喚時』発揮後」等が対象。発揮した
 * カード自身の timing 効果 (card_event) のみ対象とし、他カードの召喚に反応する
 * game_event 効果は対象外 (resolvedSourceInstanceId === relatedInstanceId で判定)。
 *
 * バースト所有者は発揮プレイヤーの相手 (および自身) を候補とし、
 * getAvailableBurstSourceChoices で whose / triggerFilter / eventMatcher.actionKind を
 * 評価して responder が居なければ積まない (attack_after 経路と同じ prune 方針)。
 *
 * engine-generic-effect-activation-causal-trigger cluster (b): 同時に host非依存の
 * 『任意の効果が発揮したとき』観測 (maybeQueueAnyEffectActivationBurstCheck) も
 * 同じ「発揮完了直後」の完了点に相乗りして積む (誘発効果の発揮完了は既にこの関数の
 * 呼び出し元で確定済みのため、新規 hook point を追加せず流用する)。
 */
export function maybeQueueEffectActivationBurstCheck(args: {
  state: GameState;
  pendingEffect: PendingTriggeredEffect;
  resolvedSourceInstanceId: string | undefined;
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredBurstActions"
    | "getRegisteredTriggeredEffectActions"
  >;
}): GameState {
  const { state, pendingEffect, resolvedSourceInstanceId, options } = args;

  // ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A)): 非バースト
  // card_event/game_event:"effect_activated" 観測も同じ「発揮完了直後」の hook point に
  // 相乗りする (burst wildcard 版と同じ relatedInstanceId フォールバック規約)。
  const stateWithGameEventActivation = queueEffectActivationTriggers({
    chainId: `trigger:${pendingEffect.pendingId}`,
    state,
    activatorPlayerId: pendingEffect.actingPlayerId,
    relatedInstanceId: resolvedSourceInstanceId ?? null,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  const stateWithAnyEffectActivation = maybeQueueAnyEffectActivationBurstCheck({
    state: stateWithGameEventActivation,
    chainId: `trigger:${pendingEffect.pendingId}`,
    activatorPlayerId: pendingEffect.actingPlayerId,
    // resolvedSourceInstanceId (=発揮元カード) が未確定なら null にする。
    // pendingEffect.relatedInstanceId は「三者観測イベントの対象/主語カード」であり
    // 発揮元カードとは意味が異なるため、フォールバック元として使わない
    // (triggerFilter を持つ any_effect_activated card と組み合わせたときの誤照合を防ぐ
    // fail-closed。adversarial verifier round2 Lens2 で指摘)。
    relatedInstanceId: resolvedSourceInstanceId ?? null,
    options,
  });

  if (!options.getRegisteredBurstActions) return stateWithAnyEffectActivation;

  // 発揮した効果の timing → effect_activation の actionKind
  const activatedActionKind: StructuredTriggerEventActionKind | null =
    pendingEffect.eventKind === "summon"
      ? "summon"
      : pendingEffect.eventKind === "place"
        ? "placement"
        : pendingEffect.eventKind === "advent"
          ? "advent"
          : null;
  if (activatedActionKind === null) return stateWithAnyEffectActivation;

  // 発揮元カード自身の timing 効果 (card_event) のみ対象。
  // game_event:summon (他カードの召喚に反応) は「召喚時発揮」ではないため除外。
  if (
    resolvedSourceInstanceId === undefined ||
    pendingEffect.relatedInstanceId !== resolvedSourceInstanceId
  ) {
    return stateWithAnyEffectActivation;
  }

  return queueEffectActivationBurstChecksForWatchers({
    state: stateWithAnyEffectActivation,
    chainId: `trigger:${pendingEffect.pendingId}`,
    checkIdTag: "burst:effect-activation",
    activatorPlayerId: pendingEffect.actingPlayerId,
    relatedInstanceId: resolvedSourceInstanceId,
    activatedActionKind,
    options,
  });
}

/**
 * engine-generic-effect-activation-causal-trigger cluster (b): 発動元非依存の
 * 『任意の効果が発揮したとき』観測。maybeQueueEffectActivationBurstCheck と異なり
 * (1) actionKind を summon/place/advent の card_event 3種に限定しない
 * (2) 発揮元カード自身の timing 効果である必要がない (host非依存)。
 * BurstTrigger.kind:"any_effect_activated" の registration は eventMatcher に
 * actionKind を持たないため、matchesTriggerEvent が actionKind 不問でマッチする。
 *
 * 現状 maybeQueueEffectActivationBurstCheck (誘発効果の発揮完了点) からのみ呼ばれる。
 * magic/accel/change 等スタック解決 (resolveDeferredStackAction) 完了点への追加配線は
 * 後続イテレーション予定 (engine-deep-ledger ENGINE-generic-effect-activation-causal-trigger)。
 */
export function maybeQueueAnyEffectActivationBurstCheck(args: {
  state: GameState;
  chainId: string;
  activatorPlayerId: string;
  relatedInstanceId: string | null;
  options: Pick<
    ApplyLegalActionOptions,
    "getCardDefinitionById" | "getRegisteredBurstActions"
  >;
}): GameState {
  const { state, activatorPlayerId, relatedInstanceId, options } = args;

  return queueEffectActivationBurstChecksForWatchers({
    state,
    chainId: args.chainId,
    checkIdTag: "burst:any-effect-activation",
    activatorPlayerId,
    relatedInstanceId,
    activatedActionKind: null,
    options,
  });
}

export function maybeFinalizeDesignatedAttackAfterPendingReactions(
  state: GameState,
  options: Pick<ApplyLegalActionOptions, "getCardDefinitionById"> &
    Partial<
      Pick<ApplyLegalActionOptions, "getRegisteredTriggeredEffectActions">
    >
): GameState {
  const activeAttack = state.activeAttack;

  if (
    !activeAttack ||
    state.step !== "attack" ||
    state.window !== "declare_attack" ||
    state.preDeclarationStackWindow !== null ||
    state.battleImmediateEffects.length > 0 ||
    state.pendingTriggeredEffects.length > 0 ||
    state.pendingBurstChecks.length > 0 ||
    hasOutstandingEffectResolutionContinuation(state) ||
    activeAttack.flashBeforeBlockCompleted
  ) {
    return state;
  }

  // 召喚後の即時アタック選択は、指定アタック/強制ブロックの自動宣言より先。
  // 無効な参加機会で進行を止めず、合法手と同じ判定で参加・辞退を待つ。
  if (
    getImmediateAttackJoinDecisions({
      state,
      actingPlayerId: state.activePlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions ?? (() => []),
    }).length > 0
  )
    return state;

  if (
    activeAttack.target.kind === "battle_entity" &&
    activeAttack.designatedTargetInstanceId !== undefined
  ) {
    const targetInstanceId = activeAttack.designatedTargetInstanceId;
    const targetCard = getCardById(state, targetInstanceId);
    const targetEntityId = activeAttack.target.entityId;
    const attackerCard = getDesignatedAttackAttackerCard(state, activeAttack);

    if (
      !targetCard ||
      !isDesignatedAttackTargetLegal(
        state,
        targetCard,
        options.getCardDefinitionById,
        attackerCard
      )
    ) {
      return fallbackDesignatedAttackToPlayerTarget({
        state,
        activeAttack,
        targetEntityId,
        targetInstanceId,
        targetCard,
        logSuffix: "target-no-longer-valid-after-burst",
      });
    }

    const opponentPlayerId = getResponseWindowOpponentId(
      state,
      targetCard.controllerPlayerId
    );

    state.log.push(
      `block:forced-tentative:${targetEntityId}:${targetInstanceId}`
    );
    // 強制ブロックの window 入り時点ではブロッカー候補が確定していないため、
    // pre_declaration_block トリガーは card_event 経由では発火させない（minimal impl.）。
    // ブロッカー確定を要する game_event 発火は relatedInstanceId=null の opt-in filter で弾かれるため、ここでは queue 自体を呼び出さない。
    return {
      ...state,
      window: "pre_declaration_stack",
      preDeclarationStackWindow: {
        kind: "forced_block",
        actingPlayerId: targetCard.controllerPlayerId,
        sourceInstanceId: targetInstanceId,
        participantEntityId: activeAttack.primaryEntityId,
        priorityPlayerId: opponentPlayerId,
        consecutivePassCount: 0,
        previousWindow: state.window,
        stackResponseSourcePlayerId: targetCard.controllerPlayerId,
        pendingStackAction: null,
      },
    };
  }

  // ENGINE-attack-declaration-replacement-primitive: 指定アタックではない通常アタック
  // (target.kind==="player") でも、replace_attack_declaration が予約した汎用 forced
  // blocker があれば同じ forced_block 窓を開く。BSRK01-C05『龍咬閃』専用経路。
  if (activeAttack.forcedBlockerInstanceId !== undefined) {
    const blockerInstanceId = activeAttack.forcedBlockerInstanceId;
    const blockerCard = getCardById(state, blockerInstanceId);
    const forcedBlockerAttackerCard = getDesignatedAttackAttackerCard(
      state,
      activeAttack
    );

    if (
      !blockerCard ||
      !isDesignatedAttackTargetLegal(
        state,
        blockerCard,
        options.getCardDefinitionById,
        forcedBlockerAttackerCard
      )
    ) {
      const nextActiveAttack = { ...activeAttack };
      delete nextActiveAttack.forcedBlockerInstanceId;
      state.log.push(
        `attack:forced-blocker-cancelled:${blockerInstanceId}:no-longer-valid-after-burst`
      );
      return { ...state, activeAttack: nextActiveAttack };
    }

    const opponentPlayerId = getResponseWindowOpponentId(
      state,
      blockerCard.controllerPlayerId
    );

    state.log.push(
      `block:forced-tentative:${activeAttack.primaryEntityId}:${blockerInstanceId}`
    );
    return {
      ...state,
      window: "pre_declaration_stack",
      preDeclarationStackWindow: {
        kind: "forced_block",
        actingPlayerId: blockerCard.controllerPlayerId,
        sourceInstanceId: blockerInstanceId,
        participantEntityId: activeAttack.primaryEntityId,
        priorityPlayerId: opponentPlayerId,
        consecutivePassCount: 0,
        previousWindow: state.window,
        stackResponseSourcePlayerId: blockerCard.controllerPlayerId,
        pendingStackAction: null,
      },
    };
  }

  return state;
}

export function advanceAttackDeclarationStateIfReady(
  state: GameState,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredBurstActions"
    | "getRegisteredBattleImmediateEffectActions"
  > &
    Partial<
      Pick<ApplyLegalActionOptions, "getRegisteredTriggeredEffectActions">
    >
): GameState {
  const stateWithRebuiltContinuousEffects =
    recomputeAndRebuildBattleStateContinuousEffects(
      state,
      options.getCardDefinitionById
    );
  const stateWithQueuedAttackAfterBurst = maybeQueueAttackAfterBurstCheck(
    stateWithRebuiltContinuousEffects,
    options
  );
  const stateWithQueuedOwnAttackBurst = maybeQueueOwnAttackBurstCheck(
    stateWithQueuedAttackAfterBurst,
    options
  );

  return maybeFinalizeDesignatedAttackAfterPendingReactions(
    stateWithQueuedOwnAttackBurst,
    options
  );
}
