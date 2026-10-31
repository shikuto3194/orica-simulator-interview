/** R01/R02「隣に契約煌臨」: 共有CX01の反対側。占有中でもその上、共有元なしなら不発 (08a6)。 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executeRestrictAdvent } from "../src/effect/structured-continuous-effects";
import { applyLegalAction, getLegalActions } from "../src";
import { adventSourceIdsOf } from "../src/model";
import type { CardDefinition, GameState } from "../src/model";

const definitions = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const card = (id: string): CardDefinition => definitions.get(id)!;
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
};
const ALICE = "alice";
const BOB = "bob";
const getCard = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)!;
function effect(no: string) {
  return card(no).effects.find((e) =>
    e.steps.some((s) => s.action.kind === "advent")
  )!;
}
function position(
  no: string,
  occupied: boolean,
  incomingNo = no === "BSDB01-R01" ? "BSDB01-X02" : "BSDB01-C01"
): GameState {
  const r01 = no === "BSDB01-R01";
  const shared = createCardInstance(card("BSDB01-CX01"), {
    instanceId: "shared",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "advent-source",
  });
  const source = createCardInstance(card(no), {
    instanceId: "source",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
    soulCoreCount: r01 && !occupied ? 1 : 0,
    exhaustState: "exhausted",
  });
  source.underCards = [{ role: "advent_source", cardInstanceId: "shared" }];
  const incoming = createCardInstance(card(incomingNo), {
    instanceId: "incoming",
    ownerPlayerId: ALICE,
    zone: r01 ? "hand" : "trash",
  });
  const sibling = createCardInstance(card(r01 ? "BSDB01-C02" : "BSDB01-C01"), {
    instanceId: "sibling",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
    soulCoreCount: r01 ? 1 : 0,
  });
  sibling.underCards = [{ role: "advent_source", cardInstanceId: "shared" }];
  const fillers = r01
    ? []
    : [1, 2].map((n) =>
        createCardInstance(card("BSDB01-R02"), {
          instanceId: "filler-" + n,
          ownerPlayerId: ALICE,
          zone: "hand",
        })
      );
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        ...Array.from({ length: 5 }, (_, i) =>
          createCardInstance(card("BSDB01-C05"), {
            instanceId: `deck-${i}`,
            ownerPlayerId: ALICE,
            zone: "deck",
          })
        ),
        shared,
        source,
        incoming,
        ...(occupied ? [sibling] : []),
        ...fillers,
      ],
      playerOverrides: [
        {
          handCount: r01 ? 1 : 2,
          deckCount: 5,
          countValue: 1,
          reserveNormalCoreCount: 3,
          soulCoreLocation: r01
            ? { kind: "card", instanceId: occupied ? "sibling" : "source" }
            : { kind: "reserve" },
        },
        {},
      ],
    }),
    activePlayerId: ALICE,
    step: "main",
    window: "none",
    turnNumber: 2,
    usedAlternateCostAdventKeysThisTurn: ["name:孫悟空＆ベジータ"],
  };
}
function finishChoices(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 12; i++) {
    const legal = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      ...lookups,
    });
    if (current.pendingZoneSelection) {
      const action = legal.find(
        (a) => a.kind === "resolve_pending_zone_selection"
      )!;
      current = applyLegalAction({
        state: current,
        action,
        selectedZoneCardIds: current.cardInstances
          .filter((c) => c.zone === "hand" && c.ownerPlayerId === ALICE)
          .slice(0, 2)
          .map((c) => c.instanceId),
        ...lookups,
      }).state;
    } else if (current.pendingCoreDistribution) {
      const recipient =
        current.pendingCoreDistribution.candidates[0]!.instanceId;
      const action = legal.find(
        (a) => a.kind === "resolve_pending_core_distribution"
      )!;
      expect(action).toBeDefined();
      current = applyLegalAction({
        state: current,
        action,
        coreDistributionAllocations: { [recipient]: 1 },
        coreDistributionSourceAllocations: { reserve: 1 },
        ...lookups,
      }).state;
    } else if (current.pendingStepOptionalChoice) {
      const action = legal.find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute"
      );
      expect(action).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: action!,
        ...lookups,
      }).state;
    } else return current;
  }
  throw new Error("効果解決が終了しない");
}
function run(state: GameState, no: string) {
  return finishChoices(
    executeEffect({
      chainId: "test:bsdb01-r01-r02-effect-triggered-advent:161",
      state,
      effect: effect(no),
      sourceInstanceId: "source",
      actingPlayerId: ALICE,
      ...lookups,
    })
  );
}

describe("R01/R02 効果内の隣への煌臨", () => {
  it.each(["BSDB01-R01", "BSDB01-R02"])(
    "%s: 効果内煌臨はadjacentを明示し、常時型にしない",
    (no) => {
      expect(effect(no).timing.kind).toBe("card_event");
      expect(
        effect(no).steps.find((s) => s.action.kind === "advent")!.action
      ).toMatchObject({ kind: "advent", placement: "adjacent" });
    }
  );
  it.each(
    [false, true].flatMap((occupied) =>
      ["BSDB01-C02", "BSDB01-X02"].map(
        (incoming) => [occupied, incoming] as const
      )
    )
  )(
    "R01: 隣占有=%s、%sをメイン・カウント1で煌臨し、発揮元を維持して2ドロー",
    (occupied, incomingNo) => {
      const before = position("BSDB01-R01", occupied, incomingNo);
      const after = run(before, "BSDB01-R01");
      expect(getCard(after, "source")).toMatchObject({
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      });
      expect(adventSourceIdsOf(getCard(after, "source"))).toEqual(["shared"]);
      expect(getCard(after, "incoming")).toMatchObject({
        zone: "field",
        normalCoreCount: occupied ? 2 : 1,
        soulCoreCount: occupied ? 1 : 0,
      });
      expect(adventSourceIdsOf(getCard(after, "incoming")).sort()).toEqual(
        occupied ? ["shared", "sibling"] : ["shared"]
      );
      expect(after.players[0]).toMatchObject({
        handCount: 2,
        deckCount: 3,
        soulCoreLocation: {
          kind: "card",
          instanceId: occupied ? "incoming" : "source",
        },
      });
      expect(after.usedAlternateCostAdventKeysThisTurn).toEqual(
        before.usedAlternateCostAdventKeysThisTurn
      );
      expect(after.pendingCoreDistribution).toBeNull();
    }
  );
  it("R01: 共有煌臨元がなければ、別のCX01が場にあっても煌臨と後続ドローは不発", () => {
    const before = position("BSDB01-R01", true);
    getCard(before, "source").underCards = [];
    const after = run(before, "BSDB01-R01");
    expect(getCard(after, "incoming").zone).toBe("hand");
    expect(after.players[0]).toMatchObject({
      handCount: 1,
      deckCount: 5,
      soulCoreLocation: before.players[0]!.soulCoreLocation,
    });
  });
  it.each([false, true])(
    "R02: 隣占有=%s、先に3ドロー2破棄し、実支払いで反対側へ煌臨",
    (occupied) => {
      const after = run(position("BSDB01-R02", occupied), "BSDB01-R02");
      expect(getCard(after, "source").zoneRoleName).toBe("spirit");
      expect(adventSourceIdsOf(getCard(after, "source"))).toEqual(["shared"]);
      expect(getCard(after, "incoming")).toMatchObject({
        zone: "field",
        normalCoreCount: occupied ? 2 : 1,
      });
      expect(adventSourceIdsOf(getCard(after, "incoming")).sort()).toEqual(
        occupied ? ["shared", "sibling"] : ["shared"]
      );
      expect(after.players[0]).toMatchObject({
        handCount: 3,
        deckCount: 2,
        soulCoreLocation: { kind: "trash" },
      });
    }
  );
  it.each(["no-shared-host", "no-soul-core"])(
    "R02: %sでは煌臨は不発、先行ドローと破棄は維持",
    (reason) => {
      const before = position("BSDB01-R02", true);
      if (reason === "no-shared-host")
        getCard(before, "source").underCards = [];
      else before.players[0]!.soulCoreLocation = { kind: "void" };
      const after = run(before, "BSDB01-R02");
      expect(getCard(after, "incoming").zone).toBe("trash");
      expect(after.players[0]).toMatchObject({
        handCount: 3,
        deckCount: 2,
        soulCoreLocation: before.players[0]!.soulCoreLocation,
      });
    }
  );
  it.each(["BSDB01-R01", "BSDB01-R02"])(
    "%s: 煌臨禁止は効果内煌臨にも適用する",
    (no) => {
      const before = executeRestrictAdvent(
        position(no, true),
        BOB,
        {
          kind: "restrict_advent",
          player: "opponent",
          duration: { scope: "this_turn" },
        },
        "source"
      );
      const after = run(before, no);
      expect(getCard(after, "incoming").zone).toBe(
        no === "BSDB01-R01" ? "hand" : "trash"
      );
      expect(after.players[0]!.deckCount).toBe(no === "BSDB01-R01" ? 5 : 2);
    }
  );
});
