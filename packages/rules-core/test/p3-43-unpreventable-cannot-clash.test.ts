/**
 * P3-43: `unpreventable` 攻撃側 vs `cannot_*` 効果耐性の衝突判定。
 *
 * 公式裁定 (バトルスピリッツ wiki):
 *   「『防げない』破壊効果は、相手の『装甲』を含む効果・『効果を受けない』・
 *    『破壊されない』・『手札/デッキに戻らない』・コア除去対策などを無視する」
 *
 * → `unpreventable` 攻撃側は `cannot_*` 効果耐性を貫通する (案 1 採用)。
 * `executeDestroy` / `executeBounce` / `executeVanish` / `executeSendToDeck` /
 * `executeRemoveFromGame` の `sourcePreventionLevel` 引数経由で
 * `filterOutResistantCards` の bypass を駆動する。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  executeDestroy,
  executeBounce,
  executeVanish,
  executeSendToDeck,
  executeRemoveFromGame,
  executeEffectResistance,
  flushPendingLeaves,
} from "../src";
import { filterOutResistantCards } from "../src/effect/effect-resistance-check";
import type { CardDefinition, CardInstance, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function nexusDef(cardNo: string, tribes: string[]): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "nexus",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: tribes.join("・"),
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

const 紅魔ネクサス = nexusDef("KOH-1", ["幻想", "紅魔"]);

function getCardDef(id: string): CardDefinition | undefined {
  if (id === "KOH-1") return 紅魔ネクサス;
  return undefined;
}

function makeState(cards: CardInstance[]): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: cards,
  };
}

function fieldNexus(
  instanceId: string,
  defId: string,
  controllerPlayerId: string
): CardInstance {
  return createCardInstance(getCardDef(defId)!, {
    instanceId,
    ownerPlayerId: controllerPlayerId,
    controllerPlayerId,
    zone: "field",
    normalCoreCount: 1,
  });
}

function setupProtectedNexus(): GameState {
  const protectedCard = fieldNexus("k1", "KOH-1", ALICE);
  let state = makeState([protectedCard]);
  // alice 視点で「自分の紅魔ネクサスは相手の効果で破壊されない / 離れない」
  state = executeEffectResistance(
    state,
    ALICE,
    {
      kind: "effect_resistance",
      target: { selfCard: false, player: "self", count: 1, tribes: ["紅魔"] },
      resistType: "cannot_leave_field",
      source: "opponent_effect",
      duration: { scope: "permanent" },
    },
    "k1",
    getCardDef
  );
  return state;
}

describe("P3-43: unpreventable 攻撃側 vs cannot_* 効果耐性 (公式裁定: 貫通)", () => {
  it("filterOutResistantCards: sourcePreventionLevel='unpreventable' で全カードが allowed", () => {
    const state = setupProtectedNexus();
    const target = state.cardInstances.find((c) => c.instanceId === "k1")!;
    const baseline = filterOutResistantCards(
      state,
      [target],
      "destroy",
      BOB,
      getCardDef
    );
    expect(baseline.allowed.length).toBe(0);
    expect(baseline.blocked.length).toBe(1);

    const bypassed = filterOutResistantCards(
      state,
      [target],
      "destroy",
      BOB,
      getCardDef,
      "unpreventable"
    );
    expect(bypassed.allowed.length).toBe(1);
    expect(bypassed.blocked.length).toBe(0);
  });

  it("filterOutResistantCards: 'immune' / 'suppress' は cannot_* を貫通しない", () => {
    const state = setupProtectedNexus();
    const target = state.cardInstances.find((c) => c.instanceId === "k1")!;

    for (const level of ["none", "suppress", "immune"] as const) {
      const result = filterOutResistantCards(
        state,
        [target],
        "destroy",
        BOB,
        getCardDef,
        level
      );
      expect(result.blocked.length).toBe(1);
      expect(result.allowed.length).toBe(0);
    }
  });

  it("executeDestroy + sourcePreventionLevel='unpreventable': cannot_be_destroyed を貫通して破壊", () => {
    const state = setupProtectedNexus();

    const blocked = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      undefined,
      "none"
    );
    expect(
      blocked.cardInstances.find((c) => c.instanceId === "k1")?.pendingLeaveKind
    ).toBeNull();

    const penetrated = executeDestroy(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getCardDef,
      "bob-src",
      undefined,
      undefined,
      "unpreventable"
    );
    expect(
      penetrated.cardInstances.find((c) => c.instanceId === "k1")
        ?.pendingLeaveKind
    ).toBe("destroy");
  });

  it("executeBounce + sourcePreventionLevel='unpreventable': cannot_be_bounced を貫通", () => {
    const state = setupProtectedNexus();
    const targetSpec = {
      selfCard: false,
      player: "opponent" as const,
      count: -1,
    };

    const blocked = executeBounce(
      state,
      BOB,
      { kind: "bounce", target: targetSpec },
      getCardDef,
      "bob-src"
    );
    expect(blocked.cardInstances.find((c) => c.instanceId === "k1")?.zone).toBe(
      "field"
    );

    const penetrated = executeBounce(
      state,
      BOB,
      { kind: "bounce", target: targetSpec },
      getCardDef,
      "bob-src",
      undefined,
      "unpreventable"
    );
    expect(
      penetrated.cardInstances.find((c) => c.instanceId === "k1")
        ?.pendingLeaveKind
    ).toBe("bounce");
    const flushed = flushPendingLeaves(penetrated, getCardDef);
    expect(flushed.cardInstances.find((c) => c.instanceId === "k1")?.zone).toBe(
      "hand"
    );
  });

  it("executeVanish + sourcePreventionLevel='unpreventable': cannot_be_vanished を貫通", () => {
    const state = setupProtectedNexus();
    const targetSpec = {
      selfCard: false,
      player: "opponent" as const,
      count: -1,
    };

    const blocked = executeVanish(
      state,
      BOB,
      targetSpec,
      getCardDef,
      "bob-src"
    );
    expect(
      blocked.cardInstances.find((c) => c.instanceId === "k1")?.pendingLeaveKind
    ).toBeNull();

    const penetrated = executeVanish(
      state,
      BOB,
      targetSpec,
      getCardDef,
      "bob-src",
      undefined,
      "unpreventable"
    );
    // executeVanish は内部で pendingLeave を kind:"vanish" + chainId="effect:vanish:..."
    // で積む (コアは reserve に戻る)。ここでは「貫通して離脱処理が走った」ことを確認する。
    const penetratedCard = penetrated.cardInstances.find(
      (c) => c.instanceId === "k1"
    );
    expect(penetratedCard?.pendingLeaveKind).toBe("vanish");
    expect(
      penetrated.log.some((l) => l.startsWith(`effect:vanish:${BOB}:k1`))
    ).toBe(true);
  });

  it("executeSendToDeck + sourcePreventionLevel='unpreventable': cannot_be_sent_to_deck を貫通", () => {
    const state = setupProtectedNexus();
    const targetSpec = {
      selfCard: false,
      player: "opponent" as const,
      count: -1,
    };

    const blocked = executeSendToDeck(
      state,
      BOB,
      { kind: "send_to_deck", target: targetSpec, position: "top" },
      getCardDef,
      "bob-src"
    );
    expect(blocked.cardInstances.find((c) => c.instanceId === "k1")?.zone).toBe(
      "field"
    );

    const penetrated = executeSendToDeck(
      state,
      BOB,
      { kind: "send_to_deck", target: targetSpec, position: "top" },
      getCardDef,
      "bob-src",
      undefined,
      "unpreventable"
    );
    const pending = penetrated.pendingLeaveEntities.find(
      (entry) => entry.instanceId === "k1"
    );
    expect(pending).toMatchObject({
      kind: "bounce",
      leaveDestination: { zone: "deck", position: "top" },
    });
    const flushed = flushPendingLeaves(penetrated, getCardDef);
    expect(flushed.cardInstances.find((c) => c.instanceId === "k1")?.zone).toBe(
      "deck"
    );
  });

  it("executeRemoveFromGame + sourcePreventionLevel='unpreventable': cannot_be_removed_from_game を貫通", () => {
    const state = setupProtectedNexus();
    const targetSpec = {
      selfCard: false,
      player: "opponent" as const,
      count: -1,
    };

    const blocked = executeRemoveFromGame(
      state,
      BOB,
      { kind: "remove_from_game", target: targetSpec },
      getCardDef,
      "bob-src"
    );
    expect(blocked.cardInstances.find((c) => c.instanceId === "k1")?.zone).toBe(
      "field"
    );

    const penetrated = executeRemoveFromGame(
      state,
      BOB,
      { kind: "remove_from_game", target: targetSpec },
      getCardDef,
      "bob-src",
      undefined,
      "unpreventable"
    );
    // Step 4 (ENGINE-remove-from-game-attached-brave-orphan): queuePendingLeave 経由化済。
    // 実 zone 移動は flushPendingLeaves で行う。
    expect(
      penetrated.cardInstances.find((c) => c.instanceId === "k1")
        ?.pendingLeaveKind
    ).toBe("remove_from_game");
  });
});
