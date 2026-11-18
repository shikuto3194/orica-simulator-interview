import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getEffectiveSymbols,
  getLegalActions,
  playSummonAsAction,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type ContinuousEffect,
  type GameState,
} from "../src/runtime";
import { getBlockDeclarationBlockReason } from "../src/battle/battle-availability";
import { finishCoreChoices } from "./helpers/core-choice-driver";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const def = (id: string) => definitions.get(id)!;

describe("対象コストの原文監査", () => {
  it.each([
    { printed: 4, effective: 6, eligible: false },
    { printed: 5, effective: 1, eligible: true },
    { printed: 6, effective: 4, eligible: true },
  ])(
    "BSTH04-XX01: 印字$printed/実効$effectiveでシンボル固定とブロック不可を同じ対象へ適用する",
    ({ printed, effective, eligible }) => {
      const targetDef: CardDefinition = {
        ...def("BSTH04-X03"),
        cardNo: "AUDIT-PRINTED-COST-TARGET",
        cost: printed,
        colors: ["purple"],
        symbolColors: ["purple"],
        tribe: "起幻",
        effects: [],
      };
      const getDef = (id: string) =>
        id === targetDef.cardNo ? targetDef : definitions.get(id);
      const target = createCardInstance(targetDef, {
        instanceId: "target",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const costChange: ContinuousEffect = {
        effectId: "change-cost",
        sourceInstanceId: "eiki",
        sourceDefinitionId: "BSTH04-XX01",
        actingPlayerId: "alice",
        duration: { scope: "turn" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "override_properties",
        targetInstanceId: target.instanceId,
        metadata: { properties: { cost: effective } },
      };
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(def("BSTH04-XX01"), {
              instanceId: "eiki",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 4,
            }),
            target,
            createCardInstance(def("BSTH01-C01"), {
              instanceId: "blocker",
              ownerPlayerId: "bob",
              zone: "field",
              normalCoreCount: 1,
            }),
          ],
        }),
        activePlayerId: "alice",
        step: "attack",
        window: "declare_block",
        activeAttack: {
          attackId: "audit-printed-cost",
          primaryEntityId: "attacking-unit",
          participantEntityIds: ["attacking-unit"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            { participantEntityId: "attacking-unit", blockedByEntityIds: [] },
          ],
          symbolResolutionOrder: ["attacking-unit"],
          flashBeforeBlockCompleted: true,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "attacking-unit",
            memberInstanceIds: [target.instanceId],
            resolvedBp: 7000,
            resolvedSymbols: ["purple"],
            attackState: "attacking",
          },
        ],
      };
      state = recomputeAndRebuildContinuousEffects(state, getDef);
      state = {
        ...state,
        activeContinuousEffects: [...state.activeContinuousEffects, costChange],
      };
      expect(getEffectiveSymbols(state, target, targetDef, getDef)).toEqual(
        eligible ? ["yellow", "purple"] : ["purple"]
      );
      expect(
        getBlockDeclarationBlockReason({
          state,
          actingPlayerId: "bob",
          sourceInstanceId: "blocker",
          participantEntityId: "attacking-unit",
          getCardDefinitionById: getDef,
        })
      ).toBe(eligible ? "attacker_unblockable" : null);
      expect(
        getLegalActions({
          state,
          actingPlayerId: "bob",
          getCardDefinitionById: getDef,
        }).filter((action) => action.kind === "block")
      ).toHaveLength(eligible ? 0 : 1);
    }
  );

  it.each([
    { zone: "hand", cost: 4, additional: null, tier: 1, payment: 1 },
    { zone: "set_aside", cost: 5, additional: 4, tier: 1, payment: 1 },
    { zone: "trash", cost: 6, additional: null, tier: 2, payment: 2 },
    { zone: "hand", cost: 7, additional: 6, tier: 2, payment: 2 },
  ] as const)(
    "BSTH06-C03: 配布後に$zoneの印字$cost/追加$additionalを分岐$tierで召喚し固定$paymentコストを払う",
    ({ zone, cost, additional, tier, payment }) => {
      const targetDef: CardDefinition = {
        ...def("BSTH06-C01"),
        cardNo: "AUDIT-SUMMON-COST-TARGET",
        cost,
        effects:
          additional === null
            ? []
            : [
                {
                  timing: { kind: "continuous" },
                  applicability: {
                    zone: ["hand", "set_aside", "trash", "field"],
                  },
                  steps: [
                    {
                      action: {
                        kind: "cost_modify",
                        target: { kind: "self" },
                        modifier: { additionalCostValue: additional },
                      },
                    },
                  ],
                },
              ],
      };
      const excludedDef: CardDefinition = {
        ...targetDef,
        cardNo: "AUDIT-SUMMON-COST-OUTSIDE",
        cost: tier === 1 ? 5 : 7,
        effects: [],
      };
      const getDef = (id: string) =>
        id === targetDef.cardNo
          ? targetDef
          : id === excludedDef.cardNo
            ? excludedDef
            : definitions.get(id);
      const instance = (
        definition: CardDefinition,
        id: string,
        field = false
      ) =>
        createCardInstance(definition, {
          instanceId: id,
          ownerPlayerId: "alice",
          zone: field ? "field" : zone,
          normalCoreCount: field ? 1 : 0,
        });
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [
            { reserveNormalCoreCount: 8, voidNormalCoreCount: 10 },
            {},
          ],
          cardInstances: [
            createCardInstance(def("BSTH06-C03"), {
              instanceId: "parsee",
              ownerPlayerId: "alice",
              zone: "hand",
            }),
            instance(def("BSTH06-C01"), "support", true),
            instance(def("BSTH06-C01"), "unselected-support", true),
            instance(targetDef, "target"),
            instance(targetDef, "alternative"),
            instance(excludedDef, "outside"),
          ],
        }),
        step: "main",
        activePlayerId: "alice",
      };
      const allDefinitions = [...ALL_CARDS, targetDef, excludedDef];
      const options = {
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(allDefinitions),
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(allDefinitions),
      };
      state = playSummonAsAction({
        ...options,
        state,
        actingPlayerId: "alice",
        cardInstanceId: "parsee",
        paymentSources: [{ kind: "reserve", amount: 2 }],
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      }).state;
      const act = (
        predicate: (
          action: ReturnType<typeof getLegalActions>[number]
        ) => boolean,
        inputs: Partial<Parameters<typeof applyLegalAction>[0]> = {}
      ) => {
        const action = getLegalActions({
          ...options,
          state,
          actingPlayerId: state.stackWindow?.priorityPlayerId ?? "alice",
        }).find(predicate);
        expect(
          action,
          JSON.stringify(
            getLegalActions({
              ...options,
              state,
              actingPlayerId: state.stackWindow?.priorityPlayerId ?? "alice",
            }).map((a) => a.kind)
          )
        ).toBeDefined();
        state = applyLegalAction({
          ...options,
          state,
          action: action!,
          ...inputs,
        }).state;
      };
      act(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "parsee"
      );
      for (let round = 0; state.stackWindow && round < 4; round++)
        act((a) => a.kind === "pass_stack");
      expect(state.stackWindow).toBeNull();
      act(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute"
      );
      act((a) => a.kind === "resolve_pending_step_optional_target_selection", {
        targetInstanceIds: ["parsee", "support"],
      });
      expect(state.players[0]!.voidNormalCoreCount).toBe(8);
      expect(
        state.cardInstances
          .filter((c) => ["parsee", "support"].includes(c.instanceId))
          .map((c) => c.normalCoreCount)
      ).toEqual([2, 2]);
      act(
        (a) =>
          a.kind === "resolve_pending_step_choice" && a.choiceIndex === tier
      );
      const selection = getLegalActions({
        ...options,
        state,
        actingPlayerId: "alice",
      }).find(
        (a) => a.kind === "resolve_pending_step_optional_target_selection"
      );
      expect(selection?.candidateTargetInstanceIds).toEqual([
        "target",
        "alternative",
      ]);
      const beforeInvalid = JSON.stringify(state);
      expect(() => {
        act(
          (a) => a.kind === "resolve_pending_step_optional_target_selection",
          { targetInstanceIds: ["outside"] }
        );
      }).toThrow();
      expect(JSON.stringify(state)).toBe(beforeInvalid);
      act((a) => a.kind === "resolve_pending_step_optional_target_selection", {
        targetInstanceIds: ["target"],
      });
      state = finishCoreChoices(state, getDef);
      expect(
        state.cardInstances.find((c) => c.instanceId === "target")
      ).toMatchObject({ zone: "field", normalCoreCount: 1 });
      expect(
        state.cardInstances.find((c) => c.instanceId === "outside")?.zone
      ).toBe(zone);
      expect(
        state.cardInstances.find((c) => c.instanceId === "alternative")?.zone
      ).toBe(zone);
      expect(state.players[0]!.reserveNormalCoreCount).toBe(5 - payment - 1);
      expect(state.players[0]!.trashNormalCoreCount).toBe(2 + payment);
      expect(state.pendingStepChoice).toBeNull();
      expect(state.pendingEffectTargetSelection).toBeNull();
      expect(state.pendingStepOptionalTargetSelection).toBeNull();
      expect(state.pendingMultiPlacement).toBeNull();
      expect(state.pendingEffectSummonCostPayment).toBeNull();
    }
  );
});
