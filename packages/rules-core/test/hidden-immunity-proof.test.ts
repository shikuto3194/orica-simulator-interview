import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, ContinuousEffect, GameState } from "../src/model";
import { executeDiscardSetBurst } from "../src/mechanics/burst-system";
import {
  executeDiscardHand,
  executeRevealHand,
} from "../src/effect/structured-zone-ops";
import { sanitizeStateForViewer } from "../src/state-sanitize";
import { filterTargetsByPreventionLevel } from "../src/legal/legal-actions-shared";

const definition: CardDefinition = {
  cardNo: "TEST-PROOF",
  name: "耐性証明",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  tribe: "勇傑",
  textLines: [],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "A",
};
const lookup = () => definition;
type Protection = "self" | "tribe" | "blanket";
function setup(zone: "burst" | "hand", protection: Protection): GameState {
  const cards = [
    createCardInstance(definition, {
      instanceId: "source",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    }),
    createCardInstance(definition, {
      instanceId: "protector",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    }),
    createCardInstance(definition, {
      instanceId: "hidden",
      ownerPlayerId: "bob",
      zone,
    }),
  ];
  const ce: ContinuousEffect = {
    effectId: "protection",
    sourceInstanceId: protection === "self" ? "hidden" : "protector",
    sourceDefinitionId: definition.cardNo,
    actingPlayerId: "bob",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    ...(protection === "self"
      ? { targetInstanceId: "hidden" }
      : {
          targetFilter: {
            player: "self" as const,
            zone: [zone],
            ...(protection === "tribe" ? { tribes: ["勇傑"] } : {}),
          },
        }),
  };
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
    }),
    setBurstStates:
      zone === "burst" ? [{ playerId: "bob", cardInstanceId: "hidden" }] : [],
    activeContinuousEffects: [ce],
  };
}
function disclosed(state: GameState): string[] {
  return state.publicDisclosures.flatMap((event) =>
    event.targets.flatMap((target) =>
      target.kind === "card" && target.definitionIdSnapshot
        ? [target.definitionIdSnapshot]
        : []
    )
  );
}
function discardBurst(state: GameState, unpreventable = false) {
  return executeDiscardSetBurst(
    state,
    "alice",
    "source",
    "bob",
    1,
    lookup,
    "trash",
    unpreventable
  );
}
function discardHand(state: GameState, count = 1) {
  return executeDiscardHand(
    state,
    "alice",
    { kind: "discard_hand", targetPlayer: "opponent", count },
    lookup,
    "source"
  );
}

describe("非公開カードの耐性証明 (Q7064 / Q16303)", () => {
  it.each(["self", "tribe"] as const)(
    "バーストの%s耐性を公開し、セット状態を保つ",
    (protection) => {
      const before = setup("burst", protection);
      expect(
        filterTargetsByPreventionLevel(before, ["hidden"], "none", {
          actingPlayerId: "alice",
          getCardDefinitionById: lookup,
        })
      ).toEqual(["hidden"]);
      expect(before.publicDisclosures).toEqual([]);
      const after = discardBurst(before);
      expect(after.setBurstStates).toEqual(before.setBurstStates);
      expect(after.revealedBurstStates).toEqual([]);
      expect(disclosed(after)).toEqual([definition.cardNo]);
      const viewed = sanitizeStateForViewer(after, "alice");
      expect(
        viewed.cardInstances.find((card) => card.instanceId === "hidden")!
          .definitionId
      ).toBe("_hidden_card_");
      expect(disclosed(viewed)).toEqual([definition.cardNo]);
      expect(after.publicDisclosures[0]!.targets[0]).toMatchObject({
        actionLabel: "show_cards",
      });
    }
  );
  it("公開済みの外部効果による無条件保護は内容を公開しない", () => {
    const after = discardBurst(setup("burst", "blanket"));
    expect(after.setBurstStates).toHaveLength(1);
    expect(disclosed(after)).toEqual([]);
  });
  it("無条件保護も成立する場合は自身の耐性を余分に公開しない", () => {
    const before = setup("burst", "self");
    before.activeContinuousEffects.push({
      ...setup("burst", "blanket").activeContinuousEffects[0]!,
      effectId: "blanket",
    });
    expect(disclosed(discardBurst(before))).toEqual([]);
  });
  it("対象0枚や防げない破棄では耐性証明を発行しない", () => {
    const before = setup("burst", "self");
    expect(
      disclosed(
        executeDiscardSetBurst(before, "alice", "source", "bob", 0, lookup)
      )
    ).toEqual([]);
    const after = discardBurst(before, true);
    expect(
      after.cardInstances.find((card) => card.instanceId === "hidden")!.zone
    ).toBe("trash");
    expect(disclosed(after)).toEqual([]);
  });
  it.each(["self", "tribe", "blanket"] as const)(
    "手札戻し耐性も%sの証明に必要な場合だけ公開する",
    (protection) => {
      const before = setup("burst", protection);
      before.activeContinuousEffects[0]!.modifierTag = "cannot_be_bounced";
      const after = executeDiscardSetBurst(
        before,
        "alice",
        "source",
        "bob",
        1,
        lookup,
        "hand"
      );
      expect(after.setBurstStates).toEqual(before.setBurstStates);
      expect(disclosed(after)).toEqual(
        protection === "blanket" ? [] : [definition.cardNo]
      );
    }
  );
  it("公開情報だけで手札戻しを防げるなら、自身の効果耐性は公開しない", () => {
    const before = setup("burst", "self");
    before.activeContinuousEffects.push({
      ...setup("burst", "blanket").activeContinuousEffects[0]!,
      effectId: "blanket-bounce",
      modifierTag: "cannot_be_bounced",
    });
    const after = executeDiscardSetBurst(
      before,
      "alice",
      "source",
      "bob",
      1,
      lookup,
      "hand"
    );
    expect(after.setBurstStates).toEqual(before.setBurstStates);
    expect(disclosed(after)).toEqual([]);
  });
  it.each(["self", "tribe"] as const)(
    "手札が%s耐性で捨てられないことを証明する",
    (protection) => {
      const after = discardHand(setup("hand", protection));
      expect(
        after.cardInstances.find((card) => card.instanceId === "hidden")!.zone
      ).toBe("hand");
      expect(disclosed(after)).toEqual([definition.cardNo]);
    }
  );
  it("手札全体を無条件に保護する場合は公開しない", () => {
    expect(disclosed(discardHand(setup("hand", "blanket")))).toEqual([]);
  });
  it("破棄可能な手札が足りる場合は残す耐性カードを公開しない", () => {
    const before = setup("hand", "self");
    before.cardInstances.push(
      createCardInstance(definition, {
        instanceId: "other",
        ownerPlayerId: "bob",
        zone: "hand",
      })
    );
    const after = discardHand(before);
    expect(
      after.cardInstances.find((card) => card.instanceId === "other")!.zone
    ).toBe("trash");
    expect(disclosed(after)).toEqual([]);
  });
  it("手札閲覧を防いだ証明は閲覧の成功として扱わない", () => {
    const after = executeRevealHand(
      setup("hand", "self"),
      "alice",
      {
        kind: "reveal_hand",
        targetPlayer: "opponent",
        revealTo: "self",
      },
      lookup,
      "source"
    );
    expect(disclosed(after)).toEqual([definition.cardNo]);
    expect(
      after.log.some((line) => line.startsWith("effect:reveal_hand:"))
    ).toBe(false);
    expect(after.pendingDeckReveal).toBeNull();
  });
});
