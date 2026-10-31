import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

function def(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

const defMap = new Map<string, CardDefinition>();
for (const id of [
  "D-A",
  "D-B",
  "D-C",
  "D-D",
  "D-E",
  "D-F",
  "D-G",
  "D-H",
  "D-I",
  "D-J",
]) {
  defMap.set(id, def(id));
}

function getCardDef(id: string): CardDefinition | undefined {
  return defMap.get(id);
}

function makeCard(
  instanceId: string,
  owner: string,
  zone: CardInstance["zone"],
  definitionId = "D-A"
): CardInstance {
  return createCardInstance(defMap.get(definitionId)!, {
    instanceId,
    ownerPlayerId: owner,
    zone,
  });
}

function runEffect(state: GameState, effect: Effect): GameState {
  return executeEffect({
    chainId: "test:shuffle-zone-action:66",
    state,
    effect,
    sourceInstanceId: "src",
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
  });
}

describe("P3-14 A-3: shuffle_zone action", () => {
  it("デッキの並びを Fisher-Yates で並び替える（log に件数を記録）", () => {
    // 10 枚並び替え。Math.random は固定 seed が無いので、
    // log とゾーンが保たれることを確認。
    const cards: CardInstance[] = [];
    for (let i = 0; i < 10; i++) {
      cards.push(makeCard(`d-${i}`, ALICE, "deck", `D-${"ABCDEFGHIJ"[i]}`));
    }
    const state = createEmptyGameState({
      cardInstances: cards,
      playerOverrides: [{ deckCount: 10 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "shuffle_zone", zone: "deck" } }],
    };

    const result = runEffect(state, effect);
    const log = result.log.find((l) => l.includes("effect:shuffle_zone"));
    expect(log).toBeDefined();
    expect(log).toContain(`:${ALICE}:`);
    expect(log).toContain("zone=deck");
    expect(log).toContain("count=10");

    // 全カード zone="deck" 維持・ID 集合不変
    const deckIds = result.cardInstances
      .filter((c) => c.zone === "deck" && c.ownerPlayerId === ALICE)
      .map((c) => c.instanceId)
      .sort();
    expect(deckIds).toEqual(cards.map((c) => c.instanceId).sort());
  });

  it("対象ゾーンは zone パラメータで指定できる（trash 等）", () => {
    const t1 = makeCard("t-1", ALICE, "trash", "D-A");
    const t2 = makeCard("t-2", ALICE, "trash", "D-B");
    const t3 = makeCard("t-3", ALICE, "trash", "D-C");
    const d1 = makeCard("dx-1", ALICE, "deck", "D-D");
    const state = createEmptyGameState({
      cardInstances: [t1, t2, t3, d1],
      playerOverrides: [{ deckCount: 1 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "shuffle_zone", zone: "trash" } }],
    };

    const result = runEffect(state, effect);
    const log = result.log.find((l) => l.includes("effect:shuffle_zone"));
    expect(log).toContain("zone=trash");
    expect(log).toContain("count=3");

    // deck 側カードは触らない
    expect(
      result.cardInstances.find((c) => c.instanceId === "dx-1")?.zone
    ).toBe("deck");
  });

  it("0/1 枚しかない場合は no-op (succeeded=false)", () => {
    const a = makeCard("a-only", ALICE, "deck", "D-A");
    const state = createEmptyGameState({
      cardInstances: [a],
      playerOverrides: [{ deckCount: 1 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "shuffle_zone", zone: "deck" } }],
    };

    const result = runEffect(state, effect);
    expect(result.log.some((l) => l.includes("effect:shuffle_zone"))).toBe(
      false
    );
  });

  it("player=opponent で相手のゾーンを対象にする", () => {
    const b1 = makeCard("b-1", BOB, "deck", "D-A");
    const b2 = makeCard("b-2", BOB, "deck", "D-B");
    const b3 = makeCard("b-3", BOB, "deck", "D-C");
    const state = createEmptyGameState({
      cardInstances: [b1, b2, b3],
      playerOverrides: [{}, { deckCount: 3 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        { action: { kind: "shuffle_zone", zone: "deck", player: "opponent" } },
      ],
    };

    const result = runEffect(state, effect);
    const log = result.log.find((l) => l.includes("effect:shuffle_zone"));
    expect(log).toContain(`:${BOB}:`);
    expect(log).toContain("count=3");
  });
});
