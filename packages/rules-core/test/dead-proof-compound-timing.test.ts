import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "../src";
import { matchesEffectTargetFilter } from "../src/legal/legal-actions-shared";

const tewi = ALL_CARDS.find((c) => c.cardNo === "BSTH03-C02")!;
const deadProof = ALL_CARDS.find((c) => c.cardNo === "BSGE01-C17")!;
const deckCard = ALL_CARDS.find((c) => c.cardNo === "BSGE01-C01")!;
const definitions = [tewi, deadProof, deckCard];
const lookups = {
  getCardDefinitionById: (id: string) =>
    definitions.find((c) => c.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(definitions),
  getRegisteredMagicActions: buildMagicLookup(definitions),
  getRegisteredBurstActions: buildBurstEffectLookup(definitions),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(definitions),
};

function setup(owner: string, attack = false) {
  const opponent = owner === "alice" ? "bob" : "alice";
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(tewi, {
          instanceId: "tewi",
          ownerPlayerId: owner,
          zone: attack ? "field" : "hand",
          cores: attack ? 1 : 0,
        }),
        createCardInstance(deadProof, {
          instanceId: "dead-proof",
          ownerPlayerId: opponent,
          zone: "hand",
        }),
        ...[1, 2, 3, 4].map((i) =>
          createCardInstance(deckCard, {
            instanceId: `deck-${i}`,
            ownerPlayerId: owner,
            zone: "deck",
          })
        ),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === owner && attack ? 0 : 1,
        deckCount: id === owner ? 4 : 0,
        reserveNormalCoreCount: 8,
        reserveSoulCoreCount: 0,
      })),
    }),
    activePlayerId: owner,
    turnNumber: 8,
    step: attack ? "attack" : "main",
    window: "none",
  };
  function act(
    actor: string,
    kind: LegalAction["kind"],
    input: Pick<
      Partial<Parameters<typeof applyLegalAction>[0]>,
      "paymentSources" | "enterFieldCorePlacements"
    > = {}
  ) {
    const actions = getLegalActions({
      state,
      actingPlayerId: actor,
      ...lookups,
    });
    const action = actions.find((a) => a.kind === kind);
    expect(action, actions.map((a) => a.kind).join(",")).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      ...lookups,
      ...input,
    }).state;
    return state;
  }
  return { opponent, act, current: () => state };
}

describe("BSGE01-C17 → BSTH03-C02 複合見出しの実スタック", () => {
  it.each(["alice", "bob"])(
    "%sの実召喚・発揮宣言に応答し、召喚時を無効化して発生源を破壊する",
    (owner) => {
      const { opponent, act, current } = setup(owner);
      act(owner, "summon", {
        paymentSources: [{ kind: "reserve", amount: 3 }],
      });
      act(opponent, "pass_stack");
      act(owner, "resolve_pending_enter_field_placement", {
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      });
      act(owner, "resolve_pending_triggered_effect");
      const targetStack = current().stackWindow!.pendingStackAction!;
      expect(targetStack.actionKind).toBe("triggered_effect");
      expect(targetStack.cardDefinitionId).toBe("BSTH03-C02");
      act(opponent, "use_magic", {
        paymentSources: [{ kind: "reserve", amount: 3 }],
      });
      const after = act(owner, "pass_stack");

      expect(after.log).toContain(
        `effect:negate:pending-stack:effect:${targetStack.stackId}`
      );
      expect(after.log.some((l) => l.startsWith("effect:deck_reveal:"))).toBe(
        false
      );
      expect(after.pendingDeckReveal).toBeNull();
      expect(
        after.cardInstances
          .filter((c) => c.zone === "deck")
          .map((c) => c.instanceId)
      ).toEqual(["deck-1", "deck-2", "deck-3", "deck-4"]);
      expect(after.players.find((p) => p.id === owner)!.deckCount).toBe(4);
      expect(
        after.log.filter((l) => l === `effect:destroy:${opponent}:tewi`)
      ).toHaveLength(1);
      expect(
        after.cardInstances.find((c) => c.instanceId === "tewi")?.zone
      ).toBe("trash");
      expect(
        after.cardInstances.find((c) => c.instanceId === "dead-proof")?.zone
      ).toBe("trash");
      expect(after.stackWindow).toBeNull();
      expect(after.pendingTriggeredEffects).toEqual([]);
      expect(
        after.activeContinuousEffects.some(
          (c) => c.modifierTag === "effect_suppression"
        )
      ).toBe(false);
    }
  );

  it("同じ本文のアタック時は識別を保ち、召喚時限定の無効化には一致しない", () => {
    const { act, current } = setup("bob", true);
    act("bob", "attack");
    act("alice", "pass_pre_declaration_stack");
    act("bob", "resolve_battle_immediate_effect");
    const descriptor =
      current().stackWindow!.pendingStackAction!.suppressionEffectDescriptor!;
    expect(descriptor.eventAction).toBe("attack");
    expect(descriptor.triggerPhrases).toEqual(
      expect.arrayContaining(["召喚時", "アタック時"])
    );
    expect(descriptor.effectLabels).toContain("spirit_attack_time");
    expect(descriptor.effectLabels).not.toContain("spirit_summon_time");
    const action = deadProof.effects![2]!.steps[0]!.action;
    if (action.kind !== "negate") throw new Error("missing negate");
    expect(
      matchesEffectTargetFilter(action.targetEffectFilter!, descriptor)
    ).toBe(false);
    const after = act("alice", "pass_stack");
    expect(after.log.some((l) => l.startsWith("effect:deck_reveal:bob:"))).toBe(
      true
    );
    expect(after.cardInstances.find((c) => c.instanceId === "tewi")?.zone).toBe(
      "field"
    );
  });
});
