import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
  executeEffect,
  getLegalActions,
  synthesizeBackFaceDefinition,
  type CardDefinition,
  type Effect,
  type GameState,
} from "../src";
import { applyLifeDamageInterception } from "../src/core/core-system";

const defs = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
for (const card of ALL_CARDS)
  if (card.backFace)
    defs.set(
      card.backFace.cardNo,
      synthesizeBackFaceDefinition(card, card.backFace)
    );
const getDef = (id: string) => defs.get(id);
const def = (id: string) => getDef(id)!;
const instance = (definition: CardDefinition, id: string) =>
  createCardInstance(definition, {
    instanceId: id,
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 3,
  });

describe("残件監査の原文境界", () => {
  it.each(["contract", "normal"] as const)(
    "カプセルコーポレーションは %s 煌臨の実際の種別を観測する",
    (variant) => {
      const printed = def("BSDB01-R01");
      const advent: CardDefinition = {
        ...printed,
        effects: [],
        adventData: { ...printed.adventData!, adventVariant: variant },
      };
      const definitions = [...defs.values()].map((card) =>
        card.cardNo === printed.cardNo ? advent : card
      );
      const lookups = {
        getCardDefinitionById: (id: string) =>
          definitions.find((card) => card.cardNo === id),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(definitions),
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredBurstActions: () => undefined,
      };
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            instance(def("BSDB01-C01"), "host"),
            instance(def("BSDB01-C07"), "capsule"),
            createCardInstance(advent, {
              instanceId: "advent",
              ownerPlayerId: "alice",
              zone: "hand",
            }),
          ],
          playerOverrides: [
            { countValue: 2, soulCoreLocation: { kind: "reserve" } },
            {},
          ],
        }),
        step: "main",
        activePlayerId: "alice",
      };
      const act = (kind: string, player = "alice", targets?: string[]) => {
        const action = getLegalActions({
          state,
          actingPlayerId: player,
          ...lookups,
        }).find((action) => action.kind === kind);
        expect(action).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          actingPlayerId: player,
          targetInstanceIds: targets,
          ...lookups,
        }).state;
      };
      act("declare_advent", "alice", ["host"]);
      while (state.stackWindow)
        act("pass_stack", state.stackWindow.priorityPlayerId);
      if (state.pendingEffectTargetSelection)
        act("resolve_pending_effect_target", "alice", ["host"]);
      expect(
        state.cardInstances.find((card) => card.instanceId === "advent")?.zone
      ).toBe("field");
      const pending = state.pendingTriggeredEffects.filter(
        (effect) => effect.eventKind === "advent"
      );
      expect(
        pending.some((effect) => effect.effectScope === "contract_advent")
      ).toBe(variant === "contract");
      const capsuleActions = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).filter(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === "capsule"
      );
      expect(capsuleActions.length > 0).toBe(variant === "contract");
    }
  );
  it("ジェミニの『2体として数えられる』は通常の1体でも数えられる", () => {
    const gemini = def("BSFT01-TR03(B)");
    const lucy = def("BSFT01-CX01");
    const initial = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [instance(gemini, "source"), instance(lucy, "lucy")],
    });
    // 星霊衣の継承ソースは数えるスピリット自体には含めない。
    initial.cardInstances[0]!.zone = "trash";
    const after = executeEffect({
      chainId: "test:root-fidelity-20260913:126",
      state: initial,
      effect: gemini.effects[0]!,
      effectIndex: 0,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const count = (minCount: number, maxCount: number) =>
      evaluateCondition(
        after,
        [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "ルーシィ" }],
            minCount,
            maxCount,
          },
        ],
        "source",
        "alice",
        getDef
      );
    expect(count(1, 1)).toBe(true);
    expect(count(2, 2)).toBe(true);
    expect(count(0, 0)).toBe(false);
    expect(count(3, 3)).toBe(false);
  });
  it("任意に3体と数える効果は、存在しない『2体』の選択を作らない", () => {
    const gemini = def("BSFT01-TR03(B)");
    const effect: Effect = {
      ...gemini.effects[0]!,
      steps: [
        {
          action: {
            kind: "count_as_multiple",
            player: "self",
            filter: { cardName: { contains: "ルーシィ" } },
            multiplier: 3,
            optionalCount: true,
            duration: { scope: "turn" },
          },
        },
      ],
    };
    const initial = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [instance(def("BSFT01-CX01"), "lucy")],
    });
    const state = executeEffect({
      chainId: "test:root-fidelity-20260913:177",
      state: initial,
      effect,
      effectIndex: 0,
      sourceInstanceId: "lucy",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      evaluateCondition(
        state,
        [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "ルーシィ" }],
            minCount: 2,
            maxCount: 2,
          },
        ],
        "lucy",
        "alice",
        getDef
      )
    ).toBe(false);
  });
  it.each(["BSDB01-C10", "BSSA01-C06", "BSFT01-TR09(A)"])(
    "%s の『アタックでは』は効果によるライフ減少を防がない",
    (id) => {
      const card = def(id);
      const original = card.effects.find((effect) =>
        effect.steps.some(
          (step) => step.action.kind === "life_damage_interception"
        )
      )!;
      const step = original.steps.find(
        (step) => step.action.kind === "life_damage_interception"
      )!;
      const initial = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [instance(card, "source")],
      });
      const state = executeEffect({
        chainId: "test:root-fidelity-20260913:220",
        state: initial,
        effect: {
          ...original,
          condition: undefined,
          steps: [{ action: step.action }],
        } as Effect,
        effectIndex: 0,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(
        state.activeContinuousEffects.some(
          (effect) => effect.modifierTag === "life_damage_interception"
        )
      ).toBe(true);
      expect(
        applyLifeDamageInterception(
          state,
          "alice",
          3,
          {
            cause: "opponent_effect",
            actingPlayerId: "bob",
            sourceCardMatchesFilter: () => true,
          },
          getDef
        ).adjustedAmount
      ).toBe(3);
    }
  );
});
