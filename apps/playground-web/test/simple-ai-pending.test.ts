import { expect, it } from "vitest";
import {
  processMovedToTrashEffects,
  applyLegalAction,
  generateBattleImmediateEffectRegistrations,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
import { buildEngine } from "./selfplay-driver";
import {
  advanceSimpleAi,
  createSimpleAiProgress,
} from "../src/utils/simple-ai";

it("メインの反復抑止上限に達しても効果中の合体選択は解決する", () => {
  const engine = buildEngine();
  const context = {
    getCardDefinitionById: engine.getCardDefinitionById,
    ...engine.lookups,
  };
  const base: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(engine.getCardDefinitionById("BSTH01-X04")!, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 3,
        }),
        createCardInstance(engine.getCardDefinitionById("BSTH01-X09")!, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    }),
    step: "main",
  };
  const combine = getLegalActions({
    ...context,
    state: base,
    actingPlayerId: "alice",
  }).find((a) => a.kind === "brave_combine")!;
  expect(combine).toBeDefined();
  const state: GameState = {
    ...base,
    pendingBraveCombineChoice: {
      pendingId: "ai-combine",
      actingPlayerId: "alice",
      braveInstanceId: combine.braveInstanceId,
      braveDefinitionId: combine.braveCardNo,
      hostCandidateInstanceIds: [combine.targetInstanceId],
      spiritStateAffordable: false,
      effectSummon: {
        sourceInstanceId: combine.targetInstanceId,
        sourceDefinitionId: combine.targetCardNo,
        triggerBeforeState: base,
      },
    },
  };
  const progress = createSimpleAiProgress();
  progress.phase = `${state.turnNumber}:${state.activePlayerId}:${state.step}`;
  progress.declarations = new Set(
    Array.from({ length: 32 }, (_, i) => `used-${i}`)
  );
  const next = advanceSimpleAi({
    state,
    actions: getLegalActions({ ...context, state, actingPlayerId: "alice" }),
    playerId: "alice",
    canAdvance: false,
    engine: context,
    progress,
  })!;
  expect(next.state.pendingBraveCombineChoice).toBeNull();
  expect(
    next.state.cardInstances.find(
      (c) => c.instanceId === combine.braveInstanceId
    )?.attachedToInstanceId
  ).toBe(combine.targetInstanceId);
});

it("遅延したトラッシュからの任意手札追加を表示し辞退できる", () => {
  const engine = buildEngine();
  const context = {
    ...engine.lookups,
    getCardDefinitionById: engine.getCardDefinitionById,
  };
  const card = createCardInstance(engine.getCardDefinitionById("BSTH01-R12")!, {
    instanceId: "luna",
    ownerPlayerId: "alice",
    zone: "trash",
  });
  let state = processMovedToTrashEffects(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [card],
      }),
      step: "main",
    },
    [card.instanceId],
    engine.getCardDefinitionById,
    { sourceColors: ["red"], fromZone: "deck" }
  );
  expect(state.pendingTrashOptionalAdds).toHaveLength(1);
  const progress = createSimpleAiProgress();
  const step = () =>
    advanceSimpleAi({
      state,
      actions: getLegalActions({ ...context, state, actingPlayerId: "alice" }),
      playerId: "alice",
      canAdvance: true,
      engine: context,
      progress,
    });
  state = step()!.state;
  expect(state.step).toBe("main");
  expect(state.pendingDeckReveal?.actingPlayerId).toBe("alice");
  state = step()!.state;
  expect(state.pendingDeckReveal).toBeNull();
  expect(state.pendingTrashOptionalAdds).toEqual([]);
  expect(state.cardInstances.find((c) => c.instanceId === "luna")?.zone).toBe(
    "trash"
  );
});

it("借用効果の後続処理を完了してメインを抜ける", () => {
  const engine = buildEngine();
  const context = {
    getCardDefinitionById: engine.getCardDefinitionById,
    ...engine.lookups,
  };
  const card = (no: string, id: string, zone: "field" | "deck") =>
    createCardInstance(engine.getCardDefinitionById(no)!, {
      instanceId: id,
      ownerPlayerId: "alice",
      zone,
      normalCoreCount: zone === "field" ? 1 : 0,
    });
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        card("BSLH01-C01", "source", "field"),
        card("BSKB01-C02", "donor", "field"),
        ...Array.from({ length: 5 }, (_, i) =>
          card("BSDB01-C04", `deck-${i}`, "deck")
        ),
      ],
    }),
    step: "main",
  };
  const progress = {
    alice: createSimpleAiProgress(),
    bob: createSimpleAiProgress(),
  };
  const seen: string[] = [];
  for (let i = 0; i < 30 && state.step === "main"; i++) {
    const all = state.playerOrder.map((id) => ({
      id,
      actions: getLegalActions({ ...context, state, actingPlayerId: id }),
    }));
    let next: ReturnType<typeof advanceSimpleAi> = null;
    for (const { id, actions } of all) {
      next = advanceSimpleAi({
        state,
        actions,
        playerId: id,
        canAdvance: all.every((e) => e.id === id || e.actions.length === 0),
        engine: context,
        progress: progress[id as "alice" | "bob"],
      });
      if (next) break;
    }
    expect(next).not.toBeNull();
    seen.push(
      typeof next!.action === "string"
        ? next!.action
        : (next!.action?.kind ?? "stabilize")
    );
    state = next!.state;
  }
  expect(
    state.log.some((s) => s.startsWith("borrow_card_event_effect:executed")),
    seen.join(",")
  ).toBe(true);
  expect(
    state.pendingAfterTriggersContinuations.map((p) => ({
      chain: p.chainId,
      wait: p.waitChainId,
      source: p.sourceInstanceId,
    }))
  ).toEqual([]);
  expect(state.pendingEffectCompletions).toEqual([]);
});

it("追加発揮の回数を入力してカウント支払いと対象選択を完了する", () => {
  const engine = buildEngine();
  const base = engine.getCardDefinitionById("BSDB01-C04")!;
  const def: CardDefinition = {
    ...base,
    cardNo: "TEST-SIMPLE-AI-REPEAT",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "count_decrease",
              player: "self",
              amount: {
                source: { kind: "selected_targets", stepId: "bp-costed" },
                groupMultiplier: 2,
              },
            },
          },
          {
            id: "bp-costed",
            connector: "conditional_cost",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"] },
              },
              amount: -3000,
              duration: { scope: "turn" },
            },
            repeat: {
              additional: {
                source: { kind: "count_value", player: "self" },
                offset: -1,
              },
              optional: true,
            },
          },
        ],
      },
    ],
  };
  const regs = generateBattleImmediateEffectRegistrations(def);
  const context = {
    ...engine.lookups,
    getCardDefinitionById: (id: string) =>
      id === def.cardNo ? def : engine.getCardDefinitionById(id),
    getRegisteredBattleImmediateEffectActions: (id: string) =>
      id === def.cardNo
        ? regs
        : engine.lookups.getRegisteredBattleImmediateEffectActions(id),
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 5 }, { countValue: 0 }],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        ...["enemy-a", "enemy-b"].map((instanceId) =>
          createCardInstance(base, {
            instanceId,
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          })
        ),
      ],
    }),
    step: "attack",
    battleImmediateEffects: [
      {
        promptId: "repeat",
        attackId: "attack",
        timing: "attack",
        sourceKind: "spirit",
        sourceInstanceId: "source",
        sourceDefinitionId: def.cardNo,
        sourceCardNo: def.cardNo,
        actingPlayerId: "alice",
        participantEntityId: "battle-entity:alice:source",
        registrationIndex: 0,
      },
    ],
  };
  const fire = getLegalActions({
    ...context,
    state,
    actingPlayerId: "alice",
  }).find((a) => a.kind === "resolve_battle_immediate_effect" && !a.skipOnly)!;
  state = applyLegalAction({ ...context, state, action: fire }).state;
  const progress = {
    alice: createSimpleAiProgress(),
    bob: createSimpleAiProgress(),
  };
  let choseCount = false;
  for (let i = 0; i < 15; i++) {
    const all = state.playerOrder.map((id) => ({
      id,
      actions: getLegalActions({ ...context, state, actingPlayerId: id }),
    }));
    let next: ReturnType<typeof advanceSimpleAi> = null;
    for (const { id, actions } of all) {
      const repeat = actions.find(
        (a) =>
          a.kind === "resolve_pending_effect_optional_repeat_choice" &&
          a.choiceIndex === 1
      );
      next = advanceSimpleAi({
        state,
        actions: repeat ? [repeat] : actions,
        playerId: id,
        canAdvance: false,
        engine: context,
        progress: progress[id as "alice" | "bob"],
      });
      if (next) break;
    }
    expect(
      next,
      JSON.stringify({
        i,
        all,
        count: state.pendingEffectOptionalRepeatCountSelection,
        choice: state.pendingEffectOptionalRepeatChoice,
        log: state.log.slice(-10),
      })
    ).not.toBeNull();
    if (next!.inputs?.countDecreaseSelection !== undefined) {
      choseCount = true;
      expect(next!.inputs.countDecreaseSelection).toBe(1);
    }
    state = next!.state;
    if (choseCount && !state.pendingEffectTargetSelection) break;
  }
  expect(choseCount).toBe(true);
  expect(state.players[0]!.countValue).toBe(1);
  expect(state.pendingEffectOptionalRepeatCountSelection).toBeNull();
  expect(state.pendingEffectTargetSelection).toBeNull();
});
