import type { ExtraTurnState, GameState } from "./model";

/** 通常ターンと追加ターンの初期化・中断復帰が共有するターン内状態。 */
export function freshTurnContext() {
  return {
    burstSetPlayerIdsThisTurn: [],
    mirageSetPlayerIdsThisTurn: [],
    mirageSetCountExemptionsUsed: [],
    usedDivineSkillKeysThisTurn: [],
    usedTrashAdventKeysThisTurn: [],
    usedAlternateCostAdventKeysThisTurn: [],
    usedAdventDeclareKeysThisTurn: [],
    countGainModifierConsumedThisTurn: [],
    pendingAdditionalAttackGrants: [],
    usedTaplessBattleDeclareInstanceIdsThisTurn: [],
    effectLifeReductionThisTurn: {},
    declarationCountThisTurn: {},
    lifeReductionCappedThisTurn: {},
    filteredLifeReductionCappedThisTurn: {},
    bpThresholdCappedLifeReductionThisTurn: {},
    declareGimmickGateUsedThisTurn: {},
    lifeDamageInterceptionUseCostGateUsedThisTurn: {},
    battlesEndedThisTurn: 0,
    battlesEndedThisAttackStep: 0,
    summonedDuringAttackStepInstanceIds: [],
    pendingImmediateAttackJoins: [],
    turnSummonedCardRefs: [],
    symbolAdditionRestrictedCountThisTurn: {},
    pendingExtraSteps: [],
    stepContinuation: [],
    pendingExtraTurn: null,
    pendingTurnEndExhaustDowngrades: [],
  } satisfies Partial<GameState>;
}

export type TurnContext = Pick<
  GameState,
  keyof ReturnType<typeof freshTurnContext>
>;

export function captureTurnContext(state: GameState): TurnContext {
  return Object.fromEntries(
    Object.keys(freshTurnContext()).map((key) => [
      key,
      state[key as keyof TurnContext],
    ])
  ) as TurnContext;
}

export function captureInterruptedTurn(
  state: GameState,
  parent: ExtraTurnState | null = state.extraTurnState ?? null
): NonNullable<ExtraTurnState["returnContext"]> {
  return {
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    step: state.step,
    window: state.window,
    activeAttack: state.activeAttack,
    turnSummonedCardRefs: [...(state.turnSummonedCardRefs ?? [])],
    turnContext: captureTurnContext(state),
    extraTurnState: parent,
    effectUsageRecords: [...state.effectUsageRecords],
    effectOccurrenceRecords: [...state.effectOccurrenceRecords],
    // 中断元だけの期間は追加ターン中に消費しない。将来のステップ・複数ターン対象は通常の時計で進む。
    suspendedContinuousEffects: state.activeContinuousEffects.filter((ce) => {
      const d = ce.duration;
      if (d.scope === "turn")
        return (
          ce.createdAtTurn === state.turnNumber &&
          !d.next &&
          (d.turns ?? 1) === 1
        );
      if (d.scope === "step")
        return (
          !d.next &&
          (!d.step || d.step === state.step) &&
          (!d.whose ||
            (d.whose === "self") ===
              (ce.actingPlayerId === state.activePlayerId))
        );
      return (
        (d.scope === "battle" || d.scope === "attack") &&
        ce.createdAtAttackId === state.activeAttack?.attackId
      );
    }),
  };
}

export function nextTurnNumber(state: GameState, turns = 1): number {
  return Math.max(state.turnNumber, state.turnNumberHighWaterMark ?? 0) + turns;
}
