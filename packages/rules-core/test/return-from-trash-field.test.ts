import {
  executeEffectAndChooseEntryCores,
  applyActionAndChooseEntryCores,
} from "./helpers/choose-effect-entry-cores";
/**
 * engine-drain 3: トラッシュ→フィールド配置 (return_from_trash の destination:"field")。
 *
 * 旧実装は executeReturnFromTrash / pending zone selection の双方で destination を無視し
 * 常に手札へ戻していた。本テストは:
 *  - destination:"field" で対象カードがフィールドへ配置され、zoneRoleName / 場入りフィールドが
 *    正しく設定される (共通配置プリミティブ placeCardFromZoneToField 経由)。
 *  - 配置時 (place) 誘発が before/after 差分パイプラインで発火し、card_event:"place" 効果を
 *    持つカードが pendingTriggeredEffects に積まれる。
 *  - destination:"hand" (既定) の挙動が不変 (回帰なし)。
 *  - 候補 > count の pending zone selection 経路が field destination を保持し、解決後に
 *    フィールドへ配置される。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src/index";
import {
  collectTriggerEventsFromStateDelta,
  collectAndQueueTriggerReactions,
} from "../src/effect/trigger-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src/index";

/** 効果登録不要なテスト用の空ルックアップ。 */
const emptyLookup = () => undefined;

/** トラッシュへ置く配置先ネクサス。配置時 (place) に何もしない素の効果を持たせられる。 */
function makeNexusDef(
  cardNo: string,
  withPlaceEffect: boolean
): CardDefinition {
  return {
    cardNo,
    name: `配置ネクサス-${cardNo}`,
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    ...(withPlaceEffect
      ? {
          effects: [
            {
              timing: { kind: "card_event" as const, event: "place" as const },
              steps: [{ action: { kind: "draw" as const, count: 1 } }],
            },
          ],
        }
      : {}),
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function makeSpiritDef(
  cardNo: string,
  withSummonEffect: boolean
): CardDefinition {
  return {
    cardNo,
    name: `召喚スピリット-${cardNo}`,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    ...(withSummonEffect
      ? {
          effects: [
            {
              timing: {
                kind: "card_event" as const,
                event: "summon" as const,
                cause: ["self_effect" as const],
              },
              steps: [{ action: { kind: "draw" as const, count: 1 } }],
            },
          ],
        }
      : {}),
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

/** トラッシュ→ゾーン移動を発火する効果源 (search_zone zone:"trash")。 */
function makeSourceDef(
  destination: "hand" | "field",
  count: number
): CardDefinition {
  return {
    cardNo: `SRC-${destination}-${count}`,
    name: "効果源",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "card_event" as const, event: "place" as const },
        steps: [
          {
            action: {
              kind: "search_zone" as const,
              zone: "trash" as const,
              count,
              destination,
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function makeDeckSourceDef(
  destination: "hand" | "field",
  count: number
): CardDefinition {
  return {
    cardNo: `SRC-DECK-${destination}-${count}`,
    name: "デッキ探索効果源",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "card_event" as const, event: "place" as const },
        steps: [
          {
            action: {
              kind: "search_zone" as const,
              zone: "deck" as const,
              count,
              destination,
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function makeBaseState(cardInstances: GameState["cardInstances"]): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return { ...base, activePlayerId: "alice", cardInstances };
}

describe("return_from_trash destination:field (engine-drain 3)", () => {
  it("places the trash card onto the field with nexus zoneRoleName + field-entry fields", () => {
    const source = makeSourceDef("field", 1);
    const nexus = makeNexusDef("PLACE-1", false);
    const defs = new Map([
      [source.cardNo, source],
      [nexus.cardNo, nexus],
    ]);
    const state = makeBaseState([
      createCardInstance(source, {
        instanceId: "src-1",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(nexus, {
        instanceId: "trash-nexus",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
    ]);

    const result = executeEffect({
      chainId: "test:return-from-trash-field:194",
      state,
      effect: source.effects![0]!,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const placed = result.cardInstances.find(
      (c) => c.instanceId === "trash-nexus"
    )!;
    expect(placed.zone).toBe("field");
    expect(placed.zoneRoleName).toBe("nexus");
    expect(placed.normalCoreCount).toBe(0);
    expect(placed.minimumRequiredCores).toBe(0); // nexus Lv1 requiredCores
    expect(placed.exhaustState).toBe("recovered");
  });

  it("search_zone trash→field preserves guided grandwalker filter instead of widening to any same-tribe nexus", () => {
    const source = makeSourceDef("field", 1);
    source.effects![0] = {
      timing: { kind: "card_event", event: "place" },
      steps: [
        {
          action: {
            kind: "search_zone",
            zone: "trash",
            count: 1,
            destination: "field",
            filter: {
              category: ["nexus"],
              tribes: ["導魔"],
              targetsGrandwalker: true,
              hasMechanic: ["guided"],
            },
          },
        },
      ],
    };
    const guided = {
      ...makeNexusDef("GUIDED-NEXUS", false),
      tribe: "導魔",
      grandwalkerData: {
        kind: "guided" as const,
        oracleTriggerKinds: ["summon"] as const,
        oracleConditions: [],
      },
    };
    const normal = {
      ...makeNexusDef("NORMAL-NEXUS", false),
      tribe: "導魔",
    };
    const defs = new Map([
      [source.cardNo, source],
      [guided.cardNo, guided],
      [normal.cardNo, normal],
    ]);
    const state = makeBaseState([
      createCardInstance(source, {
        instanceId: "src-guided-filter",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(guided, {
        instanceId: "guided-trash",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
      createCardInstance(normal, {
        instanceId: "normal-trash",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
    ]);

    const result = executeEffect({
      chainId: "test:return-from-trash-field:269",
      state,
      effect: source.effects![0]!,
      sourceInstanceId: "src-guided-filter",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    expect(result.pendingZoneSelection).toBeNull();
    expect(
      result.cardInstances.find((card) => card.instanceId === "guided-trash")
        ?.zone
    ).toBe("field");
    expect(
      result.cardInstances.find((card) => card.instanceId === "normal-trash")
        ?.zone
    ).toBe("trash");
  });

  it("fires 配置時 (place) trigger for the trash→field placed card", () => {
    const source = makeSourceDef("field", 1);
    // 配置されるカード自身が card_event:"place" 効果を持つ。
    const nexus = makeNexusDef("PLACE-FIRE", true);
    const defs = new Map([
      [source.cardNo, source],
      [nexus.cardNo, nexus],
    ]);
    const before = makeBaseState([
      createCardInstance(source, {
        instanceId: "src-1",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(nexus, {
        instanceId: "trash-nexus",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
    ]);

    const after = executeEffectAndChooseEntryCores({
      chainId: "test:return-from-trash-field:310",
      state: before,
      effect: source.effects![0]!,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    // 1. 差分検出が place イベントを出す。
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById: (id) => defs.get(id),
    });
    const placeEvents = events.filter(
      (e) => e.eventKind === "place" && e.relatedInstanceId === "trash-nexus"
    );
    expect(placeEvents.length).toBe(1);

    // 2. 登録済み place 効果が pendingTriggeredEffects に積まれる (end-to-end)。
    const triggerLookup = buildTriggeredEffectLookup([nexus]);
    const queued = collectAndQueueTriggerReactions({
      chainId: "test:return-from-trash-field:335",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
    });
    const placePending = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "place" && p.relatedInstanceId === "trash-nexus"
    );
    expect(placePending.length).toBe(1);
  });

  it("destination:hand still returns the trash card to hand (no regression)", () => {
    const source = makeSourceDef("hand", 1);
    const nexus = makeNexusDef("HAND-1", false);
    const defs = new Map([
      [source.cardNo, source],
      [nexus.cardNo, nexus],
    ]);
    const state = makeBaseState([
      createCardInstance(source, {
        instanceId: "src-1",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(nexus, {
        instanceId: "trash-nexus",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
    ]);
    const baseHand = state.players.find((p) => p.id === "alice")!.handCount;

    const result = executeEffect({
      chainId: "test:return-from-trash-field:370",
      state,
      effect: source.effects![0]!,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const moved = result.cardInstances.find(
      (c) => c.instanceId === "trash-nexus"
    )!;
    expect(moved.zone).toBe("hand");
    expect(result.players.find((p) => p.id === "alice")!.handCount).toBe(
      baseHand + 1
    );
  });

  it("pending zone selection (candidates > count) resolves onto field and queues effect-caused place trigger", () => {
    const source = makeSourceDef("field", 1); // count=1, 候補 2 → pending
    const nexus = makeNexusDef("PEND-1", true);
    nexus.effects![0] = {
      ...nexus.effects![0]!,
      timing: {
        kind: "card_event",
        event: "place",
        cause: ["self_effect"],
      },
    };
    const defs = new Map([
      [source.cardNo, source],
      [nexus.cardNo, nexus],
    ]);
    const triggerLookup = buildTriggeredEffectLookup([nexus]);
    const state = makeBaseState([
      createCardInstance(source, {
        instanceId: "src-1",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(nexus, {
        instanceId: "trash-a",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
      createCardInstance(nexus, {
        instanceId: "trash-b",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
    ]);

    const afterEffect = executeEffectAndChooseEntryCores({
      chainId: "test:return-from-trash-field:422",
      state,
      effect: source.effects![0]!,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: triggerLookup,
    });

    // pending が field destination を保持する。
    expect(afterEffect.pendingZoneSelection).not.toBeNull();
    expect(afterEffect.pendingZoneSelection!.actionKind).toBe(
      "return_from_trash"
    );
    expect(afterEffect.pendingZoneSelection!.destination).toBe("field");

    // 解決すると選択カードがフィールドへ配置される。
    const zoneAction = getLegalActions({
      state: afterEffect,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredFieldCardEffectActions: emptyLookup,
    }).find((a) => a.kind === "resolve_pending_zone_selection");
    expect(zoneAction).toBeDefined();

    const resolved = applyActionAndChooseEntryCores({
      state: afterEffect,
      action: zoneAction!,
      selectedZoneCardIds: ["trash-a"],
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const placed = resolved.state.cardInstances.find(
      (c) => c.instanceId === "trash-a"
    )!;
    expect(placed.zone).toBe("field");
    expect(placed.zoneRoleName).toBe("nexus");
    expect(
      resolved.state.cardInstances.find((c) => c.instanceId === "trash-b")!.zone
    ).toBe("trash");
    const placePendings = resolved.state.pendingTriggeredEffects.filter(
      (pending) =>
        pending.eventKind === "place" && pending.relatedInstanceId === "trash-a"
    );
    expect(placePendings).toHaveLength(1);
    expect(placePendings[0]).toMatchObject({
      cause: "self_effect",
      relatedInstanceId: "trash-a",
    });
  });

  it("search_deck destination:field auto-select places deck card onto field", () => {
    const source = makeDeckSourceDef("field", 1);
    const nexus = makeNexusDef("DECK-AUTO", false);
    const defs = new Map([
      [source.cardNo, source],
      [nexus.cardNo, nexus],
    ]);
    const state0 = makeBaseState([
      createCardInstance(source, {
        instanceId: "src-deck",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(nexus, {
        instanceId: "deck-nexus",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
    ]);
    const state: GameState = {
      ...state0,
      players: state0.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 1 } : p
      ),
    };

    const result = executeEffect({
      chainId: "test:return-from-trash-field:500",
      state,
      effect: source.effects![0]!,
      sourceInstanceId: "src-deck",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const placed = result.cardInstances.find(
      (card) => card.instanceId === "deck-nexus"
    )!;
    expect(placed.zone).toBe("field");
    expect(placed.zoneRoleName).toBe("nexus");
    expect(result.players.find((p) => p.id === "alice")!.deckCount).toBe(0);
  });

  it("search_deck honors preselected target IDs when multiple deck candidates exist", () => {
    const source = makeDeckSourceDef("hand", 1);
    const first = makeNexusDef("DECK-FIRST", false);
    const chosen = makeNexusDef("DECK-CHOSEN", false);
    const defs = new Map([
      [source.cardNo, source],
      [first.cardNo, first],
      [chosen.cardNo, chosen],
    ]);
    const state0 = makeBaseState([
      createCardInstance(source, {
        instanceId: "src-deck-selected",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(first, {
        instanceId: "deck-first",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
      createCardInstance(chosen, {
        instanceId: "deck-chosen",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
    ]);
    const state: GameState = {
      ...state0,
      players: state0.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 2 } : p
      ),
    };

    const result = executeEffect({
      chainId: "test:return-from-trash-field:550",
      state,
      effect: source.effects![0]!,
      sourceInstanceId: "src-deck-selected",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
      targetInstanceIds: ["deck-chosen"],
    });

    expect(
      result.cardInstances.find((card) => card.instanceId === "deck-first")!
        .zone
    ).toBe("deck");
    expect(
      result.cardInstances.find((card) => card.instanceId === "deck-chosen")!
        .zone
    ).toBe("hand");
    expect(result.players.find((p) => p.id === "alice")!.deckCount).toBe(1);
  });

  it("search_deck pending destination:field resolves onto field and queues effect-caused place trigger", () => {
    const source = makeDeckSourceDef("field", 1);
    const nexus = makeNexusDef("DECK-PEND", true);
    nexus.effects![0] = {
      ...nexus.effects![0]!,
      timing: {
        kind: "card_event",
        event: "place",
        cause: ["self_effect"],
      },
    };
    const defs = new Map([
      [source.cardNo, source],
      [nexus.cardNo, nexus],
    ]);
    const triggerLookup = buildTriggeredEffectLookup([nexus]);
    const state0 = makeBaseState([
      createCardInstance(source, {
        instanceId: "src-deck",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(nexus, {
        instanceId: "deck-a",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
      createCardInstance(nexus, {
        instanceId: "deck-b",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
    ]);
    const state: GameState = {
      ...state0,
      log: [
        ...state0.log,
        "effect:field_place:search_deck:alice:deck-spirit-a",
      ],
      players: state0.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 2 } : p
      ),
    };

    const afterEffect = executeEffectAndChooseEntryCores({
      chainId: "test:return-from-trash-field:615",
      state,
      effect: source.effects![0]!,
      sourceInstanceId: "src-deck",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(afterEffect.pendingZoneSelection?.actionKind).toBe("search_deck");
    expect(afterEffect.pendingZoneSelection?.destination).toBe("field");

    const zoneAction = getLegalActions({
      state: afterEffect,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredFieldCardEffectActions: emptyLookup,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(zoneAction).toBeDefined();

    const resolved = applyActionAndChooseEntryCores({
      state: afterEffect,
      action: zoneAction!,
      selectedZoneCardIds: ["deck-a"],
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    expect(
      resolved.cardInstances.find((card) => card.instanceId === "deck-a")?.zone
    ).toBe("field");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "deck-b")?.zone
    ).toBe("deck");
    const placePendings = resolved.pendingTriggeredEffects.filter(
      (pending) =>
        pending.eventKind === "place" && pending.relatedInstanceId === "deck-a"
    );
    expect(placePendings).toHaveLength(1);
    expect(placePendings[0]?.cause).toBe("self_effect");
    expect(resolved.players.find((p) => p.id === "alice")!.deckCount).toBe(1);
  });

  it("search_deck pending destination:field queues effect-caused summon trigger for spirit", () => {
    const source = makeDeckSourceDef("field", 1);
    const spirit = makeSpiritDef("DECK-SPIRIT-PEND", true);
    const defs = new Map([
      [source.cardNo, source],
      [spirit.cardNo, spirit],
    ]);
    const triggerLookup = buildTriggeredEffectLookup([spirit]);
    const state0 = makeBaseState([
      createCardInstance(source, {
        instanceId: "src-deck-spirit",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(spirit, {
        instanceId: "deck-spirit-a",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
      createCardInstance(spirit, {
        instanceId: "deck-spirit-b",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
    ]);
    const state: GameState = {
      ...state0,
      players: state0.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 2 } : p
      ),
    };

    const afterEffect = executeEffectAndChooseEntryCores({
      chainId: "test:return-from-trash-field:690",
      state,
      effect: source.effects![0]!,
      sourceInstanceId: "src-deck-spirit",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const zoneAction = getLegalActions({
      state: afterEffect,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredFieldCardEffectActions: emptyLookup,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(zoneAction).toBeDefined();

    const resolved = applyActionAndChooseEntryCores({
      state: afterEffect,
      action: zoneAction!,
      selectedZoneCardIds: ["deck-spirit-a"],
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    const summoned = resolved.cardInstances.find(
      (card) => card.instanceId === "deck-spirit-a"
    )!;
    expect(summoned.zone).toBe("field");
    expect(summoned.zoneRoleName).toBe("spirit");
    expect(resolved.log).toContain(
      "effect:summon:deck-spirit-a:self:search_deck"
    );
    const summonPendings = resolved.pendingTriggeredEffects.filter(
      (pending) =>
        pending.eventKind === "summon" &&
        pending.relatedInstanceId === "deck-spirit-a"
    );
    expect(summonPendings).toHaveLength(1);
    expect(summonPendings[0]?.cause).toBe("self_effect");
    expect(resolved.players.find((p) => p.id === "alice")!.deckCount).toBe(1);
  });

  it("zone-selection continuation preserves pre-state for after_triggers connector", () => {
    const source = makeDeckSourceDef("field", 1);
    source.effects![0] = {
      timing: { kind: "card_event", event: "place" },
      steps: [
        {
          action: {
            kind: "search_zone",
            zone: "deck",
            count: 1,
            destination: "field",
          },
        },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };
    const nexus = makeNexusDef("DECK-AFTER", false);
    const defs = new Map([
      [source.cardNo, source],
      [nexus.cardNo, nexus],
    ]);
    const state0 = makeBaseState([
      createCardInstance(source, {
        instanceId: "src-deck-after",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(nexus, {
        instanceId: "deck-after-a",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
      createCardInstance(nexus, {
        instanceId: "deck-after-b",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
    ]);
    const state: GameState = {
      ...state0,
      players: state0.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 2 } : p
      ),
    };

    const afterEffect = executeEffectAndChooseEntryCores({
      chainId: "test:return-from-trash-field:781",
      state,
      effect: source.effects![0]!,
      sourceInstanceId: "src-deck-after",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });
    const pendingId = afterEffect.pendingZoneSelection?.pendingId;
    expect(pendingId).toBeDefined();
    const zoneAction = getLegalActions({
      state: afterEffect,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
      getRegisteredFieldCardEffectActions: emptyLookup,
    }).find((action) => action.kind === "resolve_pending_zone_selection");
    expect(zoneAction).toBeDefined();

    const resolved = applyActionAndChooseEntryCores({
      state: afterEffect,
      action: zoneAction!,
      selectedZoneCardIds: ["deck-after-a"],
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    }).state;

    expect(resolved.log).toContain(
      `effect:after_triggers:flushed:${afterEffect.pendingZoneSelection!.continuation!.chainId}:after_triggers:1`
    );
  });
});
