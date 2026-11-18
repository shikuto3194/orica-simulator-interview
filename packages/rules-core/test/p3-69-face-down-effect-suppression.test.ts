/**
 * P3-69 Task C: フィールド上の裏向きカードは印字の誘発/起動効果を発揮しない。
 *
 * 裏向きカード = 素性なし。印字 definitionId 由来の効果は、誘発ソース候補列挙
 * (`getAvailableTriggeredEffectSourceChoices`) からも除外される。
 * 非公開ゾーンで働く能力 (手札誘発=zone:"hand", バースト=zone:"burst") は別経路なので対象外。
 */
import { describe, it, expect } from "vitest";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

function makeSpiritDef(cardNo: string, effects: Effect[]): CardDefinition {
  return {
    cardNo,
    name: `テスト ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  } as CardDefinition;
}

// 「自分のスピリットが召喚されたとき」誘発をもつ source カード。
const sourceEffect: Effect = {
  timing: { kind: "game_event", player: "self", event: "summon" },
  executionMode: "optional",
  steps: [{ action: { kind: "draw", player: "self", amount: 1 } }],
};
const SOURCE_DEF = makeSpiritDef("P369-SRC", [sourceEffect]);
const TRIGGER_DEF = makeSpiritDef("P369-TRG", []);

function makePending(
  actingPlayer: string,
  relatedId: string
): PendingTriggeredEffect {
  return {
    pendingId: "pte:p369",
    actingPlayerId: actingPlayer,
    eventKind: "summon",
    source: "action_resolution",
    chainId: "test:p3-69-face-down-effect-suppression:50",
    attackId: null,
    relatedPlayerId: actingPlayer,
    relatedInstanceId: relatedId,
    amount: null,
    step: "main",
    window: "main_open",
    resolvedSourceInstanceIds: [],
  } as PendingTriggeredEffect;
}

function setup(opts: { sourceFaceDown: boolean }): {
  state: GameState;
  pending: PendingTriggeredEffect;
  lookup: ReturnType<typeof buildTriggeredEffectLookup>;
  getDef: (id: string) => CardDefinition | undefined;
} {
  const alice = "alice";
  const source = createCardInstance(SOURCE_DEF, {
    instanceId: "p369-src",
    ownerPlayerId: alice,
    controllerPlayerId: alice,
    zone: "field",
    normalCoreCount: 1,
    faceDown: opts.sourceFaceDown,
  });
  const trigger = createCardInstance(TRIGGER_DEF, {
    instanceId: "p369-trg",
    ownerPlayerId: alice,
    controllerPlayerId: alice,
    zone: "field",
    normalCoreCount: 1,
  });
  const state = createEmptyGameState({
    playerIds: [alice, "bob"],
    cardInstances: [source, trigger],
  });
  const defs = new Map<string, CardDefinition>([
    [SOURCE_DEF.cardNo, SOURCE_DEF],
    [TRIGGER_DEF.cardNo, TRIGGER_DEF],
  ]);
  return {
    state,
    pending: makePending(alice, trigger.instanceId),
    lookup: buildTriggeredEffectLookup([SOURCE_DEF, TRIGGER_DEF]),
    getDef: (id) => defs.get(id),
  };
}

describe("P3-69 Task C: 裏向きカードの印字誘発効果を抑止", () => {
  it("表向き source は召喚誘発の候補に含まれる (反例)", () => {
    const ctx = setup({ sourceFaceDown: false });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: ctx.pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(choices.some((c) => c.sourceCard.instanceId === "p369-src")).toBe(
      true
    );
  });

  it("フィールド裏向き source は候補から除外される (素性なし)", () => {
    const ctx = setup({ sourceFaceDown: true });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: ctx.pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(choices.some((c) => c.sourceCard.instanceId === "p369-src")).toBe(
      false
    );
  });
});
