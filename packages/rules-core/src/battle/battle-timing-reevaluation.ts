import { isChainAtOrUnder } from "../chain-id";
import type {
  BattleImmediateEffect,
  CardDefinition,
  GameState,
} from "../model";
import { collectRegisteredBattleImmediateEffects } from "./battle-immediate-effect-system";
import { generateBattleImmediateEffectRegistrations } from "../effect/structured-effect-registrations";

/** 02c: 同じアタック/ブロック時の解決中に初めて条件を満たした本文だけを誘発させる。 */
export function queueNewlyEnabledBattleImmediateEffects(options: {
  beforeState: GameState;
  afterState: GameState;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  chainId: string | null;
  getSimultaneousGroupId: () => string;
}): GameState {
  const { beforeState, afterState, getCardDefinitionById } = options;
  const attack = afterState.activeAttack;
  const timing =
    afterState.window === "declare_attack"
      ? "attack"
      : afterState.window === "declare_block"
        ? "block"
        : null;
  if (
    !attack ||
    !timing ||
    options.chainId === null ||
    beforeState.activeAttack?.attackId !== attack.attackId ||
    attack.flashWindowState !== null ||
    (timing === "block" && attack.flashAfterBlockCompleted)
  )
    return afterState;

  const added: BattleImmediateEffect[] = [];
  const sources = (attack.immediateTimingSources ?? []).map((entry) => {
    if (entry.timing !== timing) return entry;
    const beforeCard = beforeState.cardInstances.find(
      (card) => card.instanceId === entry.sourceInstanceId
    );
    const afterCard = afterState.cardInstances.find(
      (card) => card.instanceId === entry.sourceInstanceId
    );
    if (
      !beforeCard ||
      !afterCard ||
      beforeCard.definitionId !== entry.sourceDefinitionId ||
      afterCard.definitionId !== entry.sourceDefinitionId ||
      (afterCard.fieldInstanceGeneration ?? 0) !== entry.fieldInstanceGeneration
    )
      return entry;
    const definition = getCardDefinitionById(entry.sourceDefinitionId);
    if (!definition) return entry;
    const registrations = new Map<
      string,
      ReturnType<typeof generateBattleImmediateEffectRegistrations>
    >();
    const lookup = (id: string) => {
      if (!registrations.has(id)) {
        const def = getCardDefinitionById(id);
        registrations.set(
          id,
          def ? generateBattleImmediateEffectRegistrations(def) : []
        );
      }
      return registrations.get(id);
    };
    const collect = (state: GameState, sourceCard: typeof afterCard) =>
      collectRegisteredBattleImmediateEffects({
        state,
        sourceCard,
        sourceDefinition: definition,
        attackId: attack.attackId,
        timing,
        participantEntityId: entry.participantEntityId,
        actingPlayerId: sourceCard.controllerPlayerId,
        getCardDefinitionById,
        getRegisteredBattleImmediateEffectActions: lookup,
      });
    const alreadyAvailable = new Set([
      ...entry.queuedPromptIds,
      ...afterState.battleImmediateEffects.map((prompt) => prompt.promptId),
      ...collect(beforeState, beforeCard).map((prompt) => prompt.promptId),
    ]);
    // 公式エターナル page12: 裏返ったB面は元のアタック時を発揮しない。
    // hostが同一でも、合体ブレイヴ等の効果提供元の面・個体は別に照合する。
    // 旧snapshotで宣言時の提供元が不明な場合は記録済みのhostだけ再評価する。
    const effectSourceRefs = entry.effectSourceRefs ?? [
      {
        instanceId: entry.sourceInstanceId,
        definitionId: entry.sourceDefinitionId,
        fieldInstanceGeneration: entry.fieldInstanceGeneration,
      },
    ];
    const newlyAvailable = collect(afterState, afterCard).filter((prompt) => {
      if (alreadyAvailable.has(prompt.promptId)) return false;
      const instanceId =
        prompt.sourceEffectInstanceId ?? prompt.sourceInstanceId;
      const definitionId =
        prompt.sourceEffectDefinitionId ?? prompt.sourceDefinitionId;
      const effectSource = afterState.cardInstances.find(
        (card) => card.instanceId === instanceId
      );
      return effectSourceRefs.some(
        (ref) =>
          ref.instanceId === instanceId &&
          ref.definitionId === definitionId &&
          ref.fieldInstanceGeneration ===
            (effectSource?.fieldInstanceGeneration ?? 0)
      );
    });
    added.push(
      ...newlyAvailable.map((prompt) => ({
        ...prompt,
        simultaneousGroupId: options.getSimultaneousGroupId(),
        causedByChainId: options.chainId!,
      }))
    );
    return newlyAvailable.length === 0
      ? entry
      : {
          ...entry,
          queuedPromptIds: [
            ...entry.queuedPromptIds,
            ...newlyAvailable.map((prompt) => prompt.promptId),
          ],
        };
  });
  if (added.length === 0) return afterState;
  const reactionGroups = [...(attack.immediateTimingReactionGroups ?? [])];
  for (const prompt of added) {
    if (
      !reactionGroups.some(
        (group) => group.simultaneousGroupId === prompt.simultaneousGroupId
      )
    ) {
      reactionGroups.push({
        simultaneousGroupId: prompt.simultaneousGroupId!,
        causedByChainId: prompt.causedByChainId!,
      });
    }
  }
  return {
    ...afterState,
    activeAttack: {
      ...attack,
      immediateTimingSources: sources,
      immediateTimingReactionGroups: reactionGroups,
    },
    battleImmediateEffects: [...afterState.battleImmediateEffects, ...added],
    log: [
      ...afterState.log,
      ...added.map(
        (prompt) =>
          `battle:immediate:enabled:${prompt.promptId}:cause=${options.chainId}`
      ),
    ],
  };
}

/** 後続誘発を原因効果と同時誘発だった未解決の本文より先に解決する。 */
export function scopeBattleImmediateDerivedReactions(
  state: GameState
): GameState {
  const belongsToGroup = (
    group: {
      simultaneousGroupId?: string;
      causedByChainId?: string;
    },
    entry: {
      simultaneousGroupId?: string;
      chainId: string | null;
    }
  ) =>
    entry.simultaneousGroupId === group.simultaneousGroupId ||
    (group.causedByChainId !== undefined &&
      entry.chainId !== null &&
      isChainAtOrUnder(entry.chainId, group.causedByChainId));
  const latest =
    state.activeAttack?.immediateTimingReactionGroups?.findLast(
      (group) =>
        state.battleImmediateEffects.some(
          (prompt) => prompt.simultaneousGroupId === group.simultaneousGroupId
        ) ||
        state.pendingTriggeredEffects.some((entry) =>
          belongsToGroup(group, entry)
        )
    ) ??
    state.battleImmediateEffects.findLast(
      (prompt) => prompt.causedByChainId !== undefined
    );
  if (!latest) return state;
  return {
    ...state,
    battleImmediateEffects: state.battleImmediateEffects.filter(
      (prompt) => prompt.simultaneousGroupId === latest.simultaneousGroupId
    ),
    pendingTriggeredEffects: state.pendingTriggeredEffects.filter((entry) =>
      belongsToGroup(latest, entry)
    ),
  };
}
