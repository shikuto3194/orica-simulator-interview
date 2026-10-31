/** 作戦の常時使用許可と、通常マジック使用で発揮する本文の検証。 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildHandActivatedEffectLookup,
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  executeEffect,
  generateFieldCardEffectRegistrations,
  getCurrentActorPlayerIds,
  getLegalActions,
} from "../src";
import type {
  ApplyLegalActionOptions,
  CardDefinition,
  GameState,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C06 = cardNoMap.get("BSAZ01-C06")!;
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const effectLookups = {
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
};

function actionsFor(state: GameState, playerId: string) {
  state = recomputeAndRebuildContinuousEffects(state, getCardDefinitionById);
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById,
    ...effectLookups,
  });
}

describe("BSAZ01-C06 フィールド常駐フラッシュ (自分の手札の「スレイプニール」1枚をコスト不要召喚)", () => {
  it("通常フラッシュ本文は手札のスレイプニール1枚をコスト不要召喚する", () => {
    const effect = C06.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
    )!;
    expect(effect).toBeDefined();
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });

    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind !== "summon") throw new Error("unreachable");
    expect(action.target).toEqual({
      kind: "from_zone",
      zone: ["hand"],
      filter: {
        category: ["spirit", "ultimate", "brave"],
        cardName: [{ contains: "スレイプニール" }],
      },
      count: 1,
    });
    expect(action.costModifier).toBe("free");
  });

  it("使用許可を無償のフィールド起動効果として登録しない", () => {
    expect(generateFieldCardEffectRegistrations(C06)).toHaveLength(0);
  });

  it("[board] 実行すると自分の手札の「スレイプニール」1枚がコスト不要でフィールドへ召喚される", () => {
    const target = Array.from(cardNoMap.values()).find((c) =>
      c.name.includes("スレイプニール")
    );
    expect(target).toBeDefined();
    const c06Field = createCardInstance(C06, {
      instanceId: "c06-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const handSleipnir = createCardInstance(target!, {
      instanceId: "hand-sleipnir-c06",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [c06Field, handSleipnir],
    });
    const effect = C06.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
    )!;
    const after = executeEffect({
      chainId: "test:bsaz01-c06-field-magic-flash-summon-sleipnir:110",
      state,
      effect,
      sourceInstanceId: "c06-field",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const summoned = after.cardInstances.find(
      (c) => c.instanceId === "hand-sleipnir-c06"
    )!;
    expect(summoned.zone).toBe("field");
  });
});

describe("BSAZ01-C06 場残置フラッシュの legal action 提示 (お互いのアタックステップ限定)", () => {
  function baseState(step: GameState["step"]): GameState {
    const c06Field = createCardInstance(C06, {
      instanceId: "c06-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [c06Field],
        playerOverrides: [
          { reserveNormalCoreCount: 20 },
          { reserveNormalCoreCount: 20 },
        ],
      }),
      step,
      activePlayerId: "alice",
      window: step === "attack" ? "flash_before_block" : null,
      activeAttack:
        step === "attack"
          ? {
              attackId: "attack-group:1:alice:battle-entity:none",
              primaryEntityId: "battle-entity:none",
              participantEntityIds: [],
              groupMode: "single",
              target: { kind: "player", playerId: "bob" },
              blockAssignments: [],
              symbolResolutionOrder: [],
              flashBeforeBlockCompleted: false,
              flashAfterBlockCompleted: false,
              flashWindowState: {
                kind: "before_block",
                priorityPlayerId: "alice",
                consecutivePassCount: 0,
                stackResponseSourcePlayerId: "alice",
                pendingStackAction: null,
              },
            }
          : null,
    };
  }

  it("アタックステップのフラッシュ窓では use_magic が提示される", () => {
    const state = baseState("attack");
    const actions = actionsFor(state, "alice");
    const action = actions.find(
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C06"
    );
    expect(action).toBeDefined();
  });

  it("場の使用許可を可変割引へ渡し、返却と残りコストを一度だけ支払う", () => {
    const other = createCardInstance(cardNoMap.get("BSAZ01-C04")!, {
      instanceId: "return-magic",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const base = baseState("attack");
    const sleipnir = createCardInstance(cardNoMap.get("BSAZ01-C01")!, {
      instanceId: "sleipnir",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state = recomputeAndRebuildContinuousEffects(
      {
        ...base,
        cardInstances: [...base.cardInstances, other, sleipnir],
        players: base.players.map((player) =>
          player.id === "alice"
            ? { ...player, handCount: 1, deckCount: 0 }
            : player
        ),
      },
      getCardDefinitionById
    );
    const action = actionsFor(state, "alice").find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "c06-field" &&
        a.zoneCostPaymentCandidateIds?.includes("return-magic")
    );
    if (action?.kind !== "use_magic")
      throw new Error("expected discounted field magic");
    expect(action.allowedSourceZones).toContain("field");
    let after = applyLegalAction({
      state,
      action,
      selectedZoneCardIds: ["return-magic"],
      paymentSources: [{ kind: "reserve", amount: 2 }],
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(state.players[0]?.reserveNormalCoreCount).toBe(20);
    expect(after.players[0]?.reserveNormalCoreCount).toBe(18);
    expect(after.players[0]?.trashNormalCoreCount).toBe(2);
    expect(
      after.cardInstances.find((c) => c.instanceId === "return-magic")?.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find((c) => c.instanceId === "c06-field")?.zone
    ).toBe("in_use");
    expect(
      after.activeAttack?.flashWindowState?.pendingStackAction?.cardInstanceId
    ).toBe("c06-field");

    const resolvedKinds: string[] = [];
    for (let round = 0; round < 24; round++) {
      const pending = Object.entries(after).filter(
        ([key, value]) =>
          key.startsWith("pending") &&
          value &&
          (!Array.isArray(value) || value.length > 0)
      );
      if (
        after.cardInstances.find((card) => card.instanceId === "c06-field")
          ?.zone !== "in_use" &&
        !after.stackWindow &&
        !after.activeAttack?.flashWindowState?.pendingStackAction &&
        pending.length === 0
      )
        break;
      const actions = [...getCurrentActorPlayerIds(after)].flatMap((actor) =>
        actionsFor(after, actor).filter((candidate) => candidate.can)
      );
      const next = actions.find((candidate) =>
        [
          "resolve_pending_multi_placement",
          "resolve_pending_effect_target",
          "resolve_pending_triggered_effect",
          "resolve_pending_burst_check",
          "pass_stack",
          "pass_battle_flash",
        ].includes(candidate.kind)
      );
      expect(
        next,
        JSON.stringify({ actions, pending, log: after.log })
      ).toBeDefined();
      let inputs: Partial<ApplyLegalActionOptions> = {};
      if (next!.kind === "resolve_pending_multi_placement") {
        expect(next!.targets).toEqual([
          expect.objectContaining({
            instanceId: "sleipnir",
            minimumCoreCount: 1,
          }),
        ]);
        inputs = {
          multiPlacementAllocations: [
            {
              destinationInstanceId: "sleipnir",
              placements: [{ kind: "reserve_normal", amount: 1 }],
            },
          ],
        };
      } else if (next!.kind === "resolve_pending_effect_target") {
        expect(next!.candidateTargetInstanceIds).toEqual(["sleipnir"]);
        inputs = { targetInstanceIds: ["sleipnir"] };
      } else if (next!.kind === "resolve_pending_triggered_effect") {
        expect(next!.sourceCardNo).toBe("BSAZ01-C01");
        // The summon trigger is optional; decline its draw to isolate this use.
        inputs = { skipOptionalEffect: true };
      }
      resolvedKinds.push(next!.kind);
      after = applyLegalAction({
        state: after,
        action: next!,
        ...inputs,
        getCardDefinitionById,
        ...effectLookups,
      }).state;
    }
    expect(resolvedKinds).toContain("resolve_pending_multi_placement");
    expect(
      after.cardInstances.find((card) => card.instanceId === "sleipnir")
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(
      after.cardInstances.find((card) => card.instanceId === "c06-field")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((card) => card.instanceId === "return-magic")
        ?.zone
    ).toBe("deck");
    expect(after.players[0]?.reserveNormalCoreCount).toBe(17);
    expect(after.players[0]?.trashNormalCoreCount).toBe(2);
    expect(after.players[0]?.handCount).toBe(0);
    expect(after.players[0]?.deckCount).toBe(1);
    expect(after.stackWindow).toBeNull();
    expect(after.effectQueueEntries).toEqual([]);
    expect(after.preDeclarationStackWindow).toBeNull();
    expect(after.activeAttack?.flashWindowState?.pendingStackAction).toBeNull();
    expect(
      Object.entries(after).filter(
        ([key, value]) =>
          key.startsWith("pending") &&
          value &&
          (!Array.isArray(value) || value.length > 0)
      )
    ).toEqual([]);
    expect(
      after.flashCardUsageLog.filter(
        (entry) => entry.cardInstanceId === "c06-field"
      )
    ).toHaveLength(1);
  });

  it("メインステップでは (timingScope 外のため) use_magic が提示されない", () => {
    const state = baseState("main");
    const actions = actionsFor(state, "alice");
    const action = actions.find(
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C06"
    );
    expect(action).toBeUndefined();
  });

  it("宣言すると flashCardUsageLog に mode:flash で記録される (engine-field-magic-self-placement 用 SSOT)", () => {
    const state = baseState("attack");
    const action = actionsFor(state, "alice").find(
      (a) => a.kind === "use_magic" && a.sourceCardNo === "BSAZ01-C06"
    )!;
    expect(action).toBeDefined();
    const applied = applyLegalAction({
      state,
      action,
      ...(action?.kind === "use_magic"
        ? {
            paymentSources: [
              { kind: "reserve" as const, amount: action.finalCost },
            ],
          }
        : {}),
      getCardDefinitionById,
      ...effectLookups,
    });
    expect(applied.state.flashCardUsageLog).toContainEqual(
      expect.objectContaining({
        playerId: "alice",
        cardInstanceId: "c06-field",
        cardDefinitionId: "BSAZ01-C06",
        mode: "flash",
      })
    );
  });
});
