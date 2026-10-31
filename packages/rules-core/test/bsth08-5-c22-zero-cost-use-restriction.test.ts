/**
 * BSTH08.5-C22「能面・猿（困）」effects[0]
 * 「手元にあるこのカードは、以下の効果を発揮する。■お互いコストを支払わずに
 * 手札/手元のカードを使えない。」回帰テスト。
 *
 * restrict_use(player:self/opponent, filter:{zone:["hand","set_aside"], maxCost:0})
 * で表現する。「お互い」= 人称参照のため BSTH04-X02 と同型で self/opponent 2 step。
 *
 * isCardUseRestricted の `opts.effectiveCost` 注入 (calculateReduction 経由) が
 * 本テストの核心: 印字コストではなく軽減シンボル適用後の実効コストで maxCost:0 を
 * 判定できることを検証する (印字コスト0のカードだけなら旧実装でも偶然通ってしまう)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  isCardUseRestricted,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

const magicReducedToZero: CardDefinition = {
  cardNo: "TEST-BSTH08.5-C22-MAGIC-REDUCED",
  name: "テスト用 軽減後コスト0マジック",
  printedCategory: "magic",
  colors: ["red"],
  cost: 1,
  reductionSymbols: ["red"],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const magicNotReduced: CardDefinition = {
  cardNo: "TEST-BSTH08.5-C22-MAGIC-NOT-REDUCED",
  name: "テスト用 軽減不能コスト2マジック",
  printedCategory: "magic",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const redFieldSupply: CardDefinition = {
  cardNo: "TEST-BSTH08.5-C22-RED-FIELD",
  name: "テスト用 赤シンボル供給スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const lookupMap = new Map<string, CardDefinition>([
  ...cardNoMap,
  [magicReducedToZero.cardNo, magicReducedToZero],
  [magicNotReduced.cardNo, magicNotReduced],
  [redFieldSupply.cardNo, redFieldSupply],
]);
const getCardDefinitionById = (id: string) => lookupMap.get(id);

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

describe("BSTH08.5-C22 能面・猿（困） effects[0]: お互いコストを支払わずに手札/手元のカードを使えない", () => {
  const def = cardNoMap.get("BSTH08.5-C22")!;

  it("stub 解消: restrict_use(self/opponent, filter:{zone:[hand,set_aside], maxCost:0}) 2 step", () => {
    const effect = def.effects![0]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability?.zone).toBe("set_aside");
    expect(effect.steps).toHaveLength(2);
    expect(effect.steps[0]!.action).toEqual({
      kind: "restrict_use",
      player: "self",
      filter: { zone: ["hand", "set_aside"], maxCost: 0 },
      duration: { scope: "permanent" },
    });
    expect(effect.steps[1]!.action).toEqual({
      kind: "restrict_use",
      player: "opponent",
      filter: { zone: ["hand", "set_aside"], maxCost: 0 },
      duration: { scope: "permanent" },
    });
    expect(effect.steps[1]!.connector).toBe("simultaneous");
  });

  it("手元常駐時: 軽減後コスト0になるカードはお互い使用禁止、非0のカードは対象外", () => {
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "c22-1",
          ownerPlayerId: "alice",
          zone: "set_aside",
        }),
        createCardInstance(redFieldSupply, {
          instanceId: "bob-red-supply",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const restrictCes = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "restrict_use"
    );
    expect(restrictCes).toHaveLength(2);

    const bobReducedMagic = createCardInstance(magicReducedToZero, {
      instanceId: "bob-reduced-magic",
      ownerPlayerId: "bob",
      zone: "hand",
    });
    // 印字コスト1 だが bob の赤シンボル供給で 1-1=0 まで軽減される。
    expect(
      isCardUseRestricted(
        rebuilt,
        "bob",
        bobReducedMagic,
        magicReducedToZero,
        getCardDefinitionById,
        "magic"
      )
    ).toBe(true);
    const bobUnreducedMagic = createCardInstance(magicNotReduced, {
      instanceId: "bob-unreduced-magic",
      ownerPlayerId: "bob",
      zone: "hand",
    });
    expect(
      isCardUseRestricted(
        rebuilt,
        "bob",
        bobUnreducedMagic,
        magicNotReduced,
        getCardDefinitionById,
        "magic"
      )
    ).toBe(false);
  });

  it("自分(alice)の手元カードが軽減後コスト0の場合も同様に使用禁止される（お互い＝自分も含む）", () => {
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "c22-2",
          ownerPlayerId: "alice",
          zone: "set_aside",
        }),
        createCardInstance(redFieldSupply, {
          instanceId: "alice-red-supply",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const aliceReducedMagic = createCardInstance(magicReducedToZero, {
      instanceId: "alice-reduced-magic",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    expect(
      isCardUseRestricted(
        rebuilt,
        "alice",
        aliceReducedMagic,
        magicReducedToZero,
        getCardDefinitionById,
        "magic"
      )
    ).toBe(true);
  });

  it("フィールドでは restrict_use CE は登録されない (applicability.zone が set_aside 限定)", () => {
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "c22-field",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_use"
      )
    ).toBe(false);
  });
});
