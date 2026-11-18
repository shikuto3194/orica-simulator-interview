import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type Effect,
  type GameState,
} from "../src";
import {
  buildMagicLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
const t14 = ALL_CARDS.find((c) => c.cardNo === "BSLH01-T14")!;
const spirit: CardDefinition = {
  cardNo: "T14-CB",
  name: "CB対象",
  printedCategory: "spirit",
  tribe: "CB",
  cost: 1,
  colors: ["red"],
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const ordinary = {
  ...spirit,
  cardNo: "T14-OTHER",
  name: "別系統",
  tribe: "他",
};
const source: CardDefinition = { ...spirit, cardNo: "T14-SOURCE", effects: [] };
const definitions = [t14, spirit, ordinary, source];
const get = (id: string) => definitions.find((c) => c.cardNo === id);
const lookup = {
  getCardDefinitionById: get,
  getRegisteredTriggeredEffectActions: () => [],
};
function initial() {
  const state = createEmptyGameState({
    playerIds: ["a", "b"],
    cardInstances: [
      createCardInstance(t14, {
        instanceId: "t14",
        ownerPlayerId: "a",
        zone: "field",
      }),
      createCardInstance(source, {
        instanceId: "source",
        ownerPlayerId: "b",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(spirit, {
        instanceId: "cb",
        ownerPlayerId: "a",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(ordinary, {
        instanceId: "other",
        ownerPlayerId: "a",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  });
  return { ...state, step: "attack" as const, activePlayerId: "a" };
}
function debuff(
  state: GameState,
  scope: "turn" | "battle" | "step" | "permanent" | "while_on_field",
  target = "cb",
  player = "b",
  constant = false
) {
  const effect: Effect = {
    timing: constant
      ? { kind: "continuous" }
      : { kind: "activated", mode: "flash" },
    steps: [
      {
        action: {
          kind: "prevent_battle",
          target: {
            kind: "filter",
            player: player === "a" ? "self" : "opponent",
            filter: {
              cardName: { exact: target === "cb" ? "CB対象" : "別系統" },
            },
            count: 1,
          },
          restriction: ["attack"],
          duration: { scope },
        },
      },
    ],
  };
  source.effects = [effect];
  return executeEffect({
    chainId: "test:bslh01-t14-real-card-negate:105",
    ...lookup,
    state,
    effect,
    effectIndex: 0,
    sourceInstanceId: "source",
    sourceCardReferenceInstanceId: target,
    actingPlayerId: player,
  });
}
function use(state: GameState) {
  return executeEffect({
    chainId: "test:bslh01-t14-real-card-negate:116",
    ...lookup,
    state,
    effect: t14.effects![1]!,
    effectIndex: 1,
    sourceInstanceId: "t14",
    actingPlayerId: "a",
  });
}
describe("レキュリアは発揮済みの即時型継続効果を無効にする", () => {
  it.each(["turn", "battle", "step", "permanent"] as const)(
    "%s の相手効果を取り除く（発揮元が場にいてもよい）",
    (scope) => {
      const state = debuff(initial(), scope);
      expect(
        state.activeContinuousEffects.some((c) => c.targetInstanceId === "cb")
      ).toBe(true);
      expect(
        use(state).activeContinuousEffects.some(
          (c) => c.targetInstanceId === "cb"
        )
      ).toBe(false);
    }
  );
  it("発揮元が場を離れて残っている効果も取り除く", () => {
    const state = debuff(initial(), "turn");
    state.cardInstances.find((c) => c.instanceId === "source")!.zone = "trash";
    expect(use(state).activeContinuousEffects).toHaveLength(0);
  });
  it("常時効果・自分効果・別系統の対象は取り除かない", () => {
    for (const [target, player, constant] of [
      ["cb", "b", true],
      ["cb", "a", false],
      ["other", "b", false],
    ] as const) {
      const state = debuff(
        initial(),
        constant ? "while_on_field" : "turn",
        target,
        player,
        constant
      );
      expect(use(state).activeContinuousEffects).toHaveLength(1);
    }
  });
  it("先にレキュリアを発揮しても、その後に解決する効果は無効にならない", () => {
    const state = debuff(use(initial()), "turn");
    expect(state.activeContinuousEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetInstanceId: "cb",
          duration: { scope: "turn" },
        }),
      ])
    );
  });
  it("他の効果を受けない効果は保護され、防げない無効化だけが貫通する", () => {
    const state = debuff(initial(), "turn");
    source.effects![0]!.preventionLevel = "immune";
    expect(use(state).activeContinuousEffects).toHaveLength(1);
    const effect = {
      ...t14.effects![1]!,
      preventionLevel: "unpreventable" as const,
    };
    expect(
      executeEffect({
        chainId: "test:bslh01-t14-real-card-negate:181",
        ...lookup,
        state,
        effect,
        effectIndex: 1,
        sourceInstanceId: "t14",
        actingPlayerId: "a",
      }).activeContinuousEffects
    ).toHaveLength(0);
  });
  it("通常フラッシュとして登録され、targeted 誘発として登録されない", () => {
    expect(buildMagicLookup([t14])(t14.cardNo)).toBeDefined();
    expect(buildTriggeredEffectLookup([t14])(t14.cardNo)).toBeUndefined();
    expect(t14.effects![1]!.timing).toEqual({
      kind: "activated",
      mode: "flash",
    });
  });
});
