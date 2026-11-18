/**
 * P3-14 C-3 拡張: recover の game_event 観測（他カードの回復を監視するリスナー）。
 *
 * - BSTH08-転醒R02(A)「系統:「起幻」を持つ自分の白/青のスピリットが疲労/効果で
 *   回復したとき、このネクサスを裏返せる」型。recover は OPT_IN から外し、
 *   リスナー不在は source スキャンで吸収する。
 * - state_change family の actionKind 判別: exhaust リスナーは recover イベントに
 *   誤マッチしない。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

function makeCard(
  cardNo: string,
  category: string,
  effects: CardDefinition["effects"] = undefined,
  extra: Partial<CardDefinition> = {}
): CardDefinition {
  const base = {
    cardNo,
    name: cardNo,
    printedCategory: category,
    colors: ["white"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...extra,
  } as CardDefinition;
  return effects !== undefined ? { ...base, effects } : base;
}

function createLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

function buildRecoverScenario(options: {
  listenerDef: CardDefinition;
  spiritDef: CardDefinition;
}) {
  const spirit = createCardInstance(options.spiritDef, {
    instanceId: "spirit-1",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  const beforeState: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        { ...spirit, exhaustState: "exhausted" },
        createCardInstance(options.listenerDef, {
          instanceId: "listener-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
      ],
    }),
    activePlayerId: "alice",
  };
  const afterState: GameState = {
    ...beforeState,
    cardInstances: beforeState.cardInstances.map((c) =>
      c.instanceId === "spirit-1"
        ? { ...c, exhaustState: "recovered" as const }
        : c
    ),
  };
  const defs = [options.listenerDef, options.spiritDef];
  return collectAndQueueTriggerReactions({
    chainId: "test:recover-game-event:79",
    beforeState,
    afterState,
    source: "action_resolution",
    getCardDefinitionById: createLookup(defs),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBurstActions: undefined,
  });
}

describe("P3-14 C-3 拡張: recover game_event 観測", () => {
  it("起幻白スピリットの回復で、転醒ネクサス型 game_event リスナーに pending が積まれる", () => {
    const spiritDef = makeCard("RGE-SPIRIT-01", "spirit", undefined, {
      tribe: "起幻・幻想",
    });
    const listenerDef = makeCard("RGE-NEXUS-01", "nexus", [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "recover",
          triggerFilter: {
            category: ["spirit"],
            colors: ["white", "blue"],
            tribes: ["起幻"],
          },
        },
        executionMode: "optional",
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
      },
    ]);

    const queued = buildRecoverScenario({ listenerDef, spiritDef });
    const pendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "recover"
    );
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.relatedInstanceId).toBe("spirit-1");
    expect(pendings[0]!.event).toMatchObject({
      family: "state_change",
      actionKind: "recover",
    });
  });

  it("triggerFilter 不一致 (系統違い) のスピリット回復では pending を積まない", () => {
    const spiritDef = makeCard("RGE-SPIRIT-02", "spirit", undefined, {
      tribe: "妖精",
    });
    const listenerDef = makeCard("RGE-NEXUS-02", "nexus", [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "recover",
          triggerFilter: { category: ["spirit"], tribes: ["起幻"] },
        },
        executionMode: "optional",
        steps: [{ action: { kind: "rebirth" } }],
      },
    ]);

    const queued = buildRecoverScenario({ listenerDef, spiritDef });
    expect(
      queued.pendingTriggeredEffects.filter((p) => p.eventKind === "recover")
    ).toHaveLength(0);
  });

  it("exhaust リスナーは recover イベントに誤マッチしない (actionKind 判別)", () => {
    // 回復するスピリット自身が card_event:exhaust 効果を持つ。
    // recover イベントは OPT_IN 非対象でスキャンに到達するが、exhaust registration
    // (actionKind: exhaust) は recover イベント (actionKind: recover) に一致しない。
    const spiritDef = makeCard("RGE-SPIRIT-03", "spirit", [
      {
        timing: { kind: "card_event", event: "exhaust" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ]);
    const listenerDef = makeCard("RGE-NEXUS-03", "nexus");

    const queued = buildRecoverScenario({ listenerDef, spiritDef });
    expect(
      queued.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "recover" || p.eventKind === "exhaust"
      )
    ).toHaveLength(0);
  });
});
