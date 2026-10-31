import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../src";
import { createCardInstance, createEmptyGameState } from "../src";
import { executeSoulStateSummon } from "../src/effect/structured-summon";

const ALICE = "alice";

function def(
  cardNo: string,
  printedCategory: CardDefinition["printedCategory"],
  keywordTags: string[] = [],
  cost = 0,
  reductionSymbols: CardDefinition["reductionSymbols"] = [],
  symbolColors: CardDefinition["symbolColors"] = []
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory,
    colors: ["red"],
    cost,
    reductionSymbols,
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors,
    textLines: [],
    keywordTags,
  };
}

const HOST = def("TEST-SOUL-HOST", "spirit");
const MAGIC_COMPATIBLE_BRAVE = def("TEST-MAGIC-BRAVE", "brave", [
  "magic_compatible",
]);
const PAID_HOST = def("TEST-PAID-SOUL-HOST", "spirit", [], 2, ["red"]);
const PAID_MAGIC_COMPATIBLE_BRAVE = def(
  "TEST-PAID-MAGIC-BRAVE",
  "brave",
  ["magic_compatible"],
  5,
  ["red", "red", "red"]
);
const MIN_CORE_PAID_HOST: CardDefinition = {
  ...def("TEST-MIN-CORE-PAID-SOUL-HOST", "spirit", [], 2, ["red"]),
  levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
};
const FIELD_SYMBOL = def("TEST-FIELD-SYMBOL", "spirit", [], 0, [], ["red"]);
const INDEPENDENT_CORE_NEXUS: CardDefinition = {
  ...def("TEST-INDEPENDENT-CORE-NEXUS", "nexus", [], 0, [], ["red"]),
  grandwalkerData: { kind: "grandwalker" },
};
const defs = new Map([
  [HOST.cardNo, HOST],
  [MAGIC_COMPATIBLE_BRAVE.cardNo, MAGIC_COMPATIBLE_BRAVE],
  [PAID_HOST.cardNo, PAID_HOST],
  [MIN_CORE_PAID_HOST.cardNo, MIN_CORE_PAID_HOST],
  [PAID_MAGIC_COMPATIBLE_BRAVE.cardNo, PAID_MAGIC_COMPATIBLE_BRAVE],
  [FIELD_SYMBOL.cardNo, FIELD_SYMBOL],
  [INDEPENDENT_CORE_NEXUS.cardNo, INDEPENDENT_CORE_NEXUS],
]);
const getDef = (id: string): CardDefinition | undefined => defs.get(id);

describe("magic-compatible brave soul-state summon cleanup", () => {
  it("summoning a soul-state host also removes its attached magic-compatible brave from soul state", () => {
    const host = createCardInstance(HOST, {
      instanceId: "soul-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const brave = createCardInstance(MAGIC_COMPATIBLE_BRAVE, {
      instanceId: "attached-magic-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.attachedChildrenIds = [brave.instanceId];
    brave.attachedToInstanceId = host.instanceId;
    const state = createEmptyGameState({
      playerIds: [ALICE, "bob"],
      cardInstances: [host, brave],
      playerOverrides: [
        {
          reserveNormalCoreCount: 4,
          soulStateInstanceIds: [host.instanceId],
        },
        {},
      ],
    });

    const summoned = executeSoulStateSummon(
      state,
      "test:magic-compatible-soul-state-summon.test.ts:summon",
      ALICE,
      undefined,
      "free",
      host.instanceId,
      getDef,
      [host.instanceId],
      []
    );
    const alice = summoned.players.find((p) => p.id === ALICE)!;

    expect(summoned.pendingMultiPlacement).toBeNull();
    expect(alice.soulStateInstanceIds).not.toContain(host.instanceId);
    expect(alice.soulStateInstanceIds).not.toContain(brave.instanceId);
    expect(
      summoned.cardInstances.find((c) => c.instanceId === brave.instanceId)!
        .attachedToInstanceId
    ).toBe(host.instanceId);
  });

  it("charges the combined host and attached magic-compatible brave cost for normal soul-state summon", () => {
    const host = createCardInstance(PAID_HOST, {
      instanceId: "paid-soul-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const brave = createCardInstance(PAID_MAGIC_COMPATIBLE_BRAVE, {
      instanceId: "paid-attached-magic-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.attachedChildrenIds = [brave.instanceId];
    brave.attachedToInstanceId = host.instanceId;
    const symbolSources = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(FIELD_SYMBOL, {
        instanceId: `field-symbol-${index + 1}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, "bob"],
      cardInstances: [host, brave, ...symbolSources],
      playerOverrides: [
        {
          reserveNormalCoreCount: 3,
          trashNormalCoreCount: 0,
          soulStateInstanceIds: [host.instanceId],
        },
        {},
      ],
    });

    const summoned = executeSoulStateSummon(
      state,
      "test:magic-compatible-soul-state-summon.test.ts:summon",
      ALICE,
      undefined,
      undefined,
      host.instanceId,
      getDef,
      [host.instanceId],
      []
    );
    const alice = summoned.players.find((p) => p.id === ALICE)!;

    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(3);
    expect(alice.soulStateInstanceIds).not.toContain(host.instanceId);
    expect(alice.soulStateInstanceIds).not.toContain(brave.instanceId);
  });

  it("BSFT01-TR01(A) 型: normal soul-state summon can pay combined cost from reserve and field cores", () => {
    const host = createCardInstance(PAID_HOST, {
      instanceId: "paid-soul-host-field-pay",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const brave = createCardInstance(PAID_MAGIC_COMPATIBLE_BRAVE, {
      instanceId: "paid-attached-magic-brave-field-pay",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.attachedChildrenIds = [brave.instanceId];
    brave.attachedToInstanceId = host.instanceId;
    const symbolSources = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(FIELD_SYMBOL, {
        instanceId: `field-pay-symbol-${index + 1}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: index === 0 ? 1 : 0,
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, "bob"],
      cardInstances: [host, brave, ...symbolSources],
      playerOverrides: [
        {
          reserveNormalCoreCount: 2,
          trashNormalCoreCount: 0,
          soulStateInstanceIds: [host.instanceId],
        },
        {},
      ],
    });

    const summoned = executeSoulStateSummon(
      state,
      "test:magic-compatible-soul-state-summon.test.ts:summon",
      ALICE,
      undefined,
      undefined,
      host.instanceId,
      getDef,
      [host.instanceId],
      [],
      undefined,
      [
        { kind: "reserve", amount: 2 },
        { kind: "card", instanceId: "field-pay-symbol-1", amount: 1 },
      ]
    );
    const alice = summoned.players.find((p) => p.id === ALICE)!;

    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(3);
    expect(
      summoned.cardInstances.find((c) => c.instanceId === "field-pay-symbol-1")
        ?.normalCoreCount
    ).toBe(0);
    expect(alice.soulStateInstanceIds).not.toContain(host.instanceId);
    expect(alice.soulStateInstanceIds).not.toContain(brave.instanceId);
  });

  it("BSFT01-TR01(A) 型: normal soul-state summon rejects independent-core cards as payment sources", () => {
    const host = createCardInstance(PAID_HOST, {
      instanceId: "paid-soul-host-independent-pay",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const brave = createCardInstance(PAID_MAGIC_COMPATIBLE_BRAVE, {
      instanceId: "paid-attached-magic-brave-independent-pay",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const independentCoreNexus = createCardInstance(INDEPENDENT_CORE_NEXUS, {
      instanceId: "independent-core-nexus-pay-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    host.attachedChildrenIds = [brave.instanceId];
    brave.attachedToInstanceId = host.instanceId;
    const symbolSources = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(FIELD_SYMBOL, {
        instanceId: `independent-pay-symbol-${index + 1}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, "bob"],
      cardInstances: [host, brave, independentCoreNexus, ...symbolSources],
      playerOverrides: [
        {
          reserveNormalCoreCount: 2,
          trashNormalCoreCount: 0,
          soulStateInstanceIds: [host.instanceId],
        },
        {},
      ],
    });

    expect(() =>
      executeSoulStateSummon(
        state,
        "test:magic-compatible-soul-state-summon.test.ts:summon",
        ALICE,
        undefined,
        undefined,
        host.instanceId,
        getDef,
        [host.instanceId],
        [],
        undefined,
        [
          { kind: "reserve", amount: 2 },
          {
            kind: "card",
            instanceId: independentCoreNexus.instanceId,
            amount: 1,
          },
        ]
      )
    ).toThrow(/Card payment source is not legal/);
  });

  it("BSFT01-TR01(A) 型: explicit empty payment sources do not fall back to reserve auto-payment", () => {
    const host = createCardInstance(PAID_HOST, {
      instanceId: "paid-soul-host-empty-pay",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const brave = createCardInstance(PAID_MAGIC_COMPATIBLE_BRAVE, {
      instanceId: "paid-attached-magic-brave-empty-pay",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.attachedChildrenIds = [brave.instanceId];
    brave.attachedToInstanceId = host.instanceId;
    const symbolSources = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(FIELD_SYMBOL, {
        instanceId: `empty-pay-symbol-${index + 1}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, "bob"],
      cardInstances: [host, brave, ...symbolSources],
      playerOverrides: [
        {
          reserveNormalCoreCount: 3,
          trashNormalCoreCount: 0,
          soulStateInstanceIds: [host.instanceId],
        },
        {},
      ],
    });

    expect(() =>
      executeSoulStateSummon(
        state,
        "test:magic-compatible-soul-state-summon.test.ts:summon",
        ALICE,
        undefined,
        undefined,
        host.instanceId,
        getDef,
        [host.instanceId],
        [],
        undefined,
        []
      )
    ).toThrow(/Payment does not match final cost: payment=0 finalCost=3/);
  });

  it("BSFT01-TR01(A) 型: soul core paid as cost is not reused for enter-field placement", () => {
    const host = createCardInstance(MIN_CORE_PAID_HOST, {
      instanceId: "paid-soul-host-soul-pay",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      minimumRequiredCores: 1,
    });
    const brave = createCardInstance(PAID_MAGIC_COMPATIBLE_BRAVE, {
      instanceId: "paid-attached-magic-brave-soul-pay",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const independentCoreNexus = createCardInstance(INDEPENDENT_CORE_NEXUS, {
      instanceId: "soul-pay-independent-core-only",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    host.attachedChildrenIds = [brave.instanceId];
    brave.attachedToInstanceId = host.instanceId;
    const symbolSources = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(FIELD_SYMBOL, {
        instanceId: `soul-pay-symbol-${index + 1}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "spirit",
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, "bob"],
      cardInstances: [host, brave, independentCoreNexus, ...symbolSources],
      playerOverrides: [
        {
          reserveNormalCoreCount: 2,
          trashNormalCoreCount: 0,
          soulCoreLocation: { kind: "reserve" },
          soulStateInstanceIds: [host.instanceId],
        },
        {},
      ],
    });

    const result = executeSoulStateSummon(
      state,
      "test:magic-compatible-soul-state-summon.test.ts:summon",
      ALICE,
      undefined,
      undefined,
      host.instanceId,
      getDef,
      [host.instanceId],
      undefined,
      undefined,
      [{ kind: "reserve", amount: 3, includeSoulCore: true }]
    );
    const alice = result.players.find((p) => p.id === ALICE)!;

    expect(result.log).toContain(
      "effect:summon:soul_state:alice:insufficient-enter-cores:required=1"
    );
    expect(result.pendingMultiPlacement).toBeNull();
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(alice.soulStateInstanceIds).toContain(host.instanceId);
  });
});
