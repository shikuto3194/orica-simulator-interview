import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  getEffectiveReductionSymbolEntries,
} from "../src";
import type { CardDefinition, CardInstance } from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const C04 = definitions.get("BSAZ01-C04")!;
const magic: CardDefinition = {
  ...C04,
  cardNo: "TEST-FIELD-MAGIC",
  effects: [],
  symbolColors: [],
};
const yellow: CardDefinition = {
  ...magic,
  cardNo: "TEST-YELLOW-MAGIC",
  symbolColors: ["yellow"],
};
const nexus: CardDefinition = {
  ...yellow,
  cardNo: "TEST-YELLOW-NEXUS",
  printedCategory: "nexus",
};
for (const card of [magic, yellow, nexus]) definitions.set(card.cardNo, card);
const lookup = (id: string) => definitions.get(id);
const instance = (
  card: CardDefinition,
  id: string,
  zone: CardInstance["zone"] = "field",
  owner = "alice"
) => createCardInstance(card, { instanceId: id, ownerPlayerId: owner, zone });
function reduction(
  card: CardDefinition,
  others: CardInstance[],
  zone: CardInstance["zone"] = "hand"
) {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [instance(card, "paying", zone), ...others],
  });
  const options = {
    state,
    card,
    actingPlayerId: "alice",
    getCardDefinitionById: (id: string) =>
      id === card.cardNo ? card : lookup(id),
    sourceInstanceId: "paying",
    effectMode: "flash" as const,
  };
  return { state, options, result: calculateReduction(options) };
}

const matrixTitles = [
  [
    "マジック0枚・黄供給false: 印字2枠を上限に支払う",
    "マジック1枚・黄供給false: 印字2枠を上限に支払う",
    "マジック2枚・黄供給false: 印字2枠を上限に支払う",
    "マジック3枚・黄供給false: 印字2枠を上限に支払う",
  ],
  [
    "マジック0枚・黄供給true: 印字2枠を上限に支払う",
    "マジック1枚・黄供給true: 印字2枠を上限に支払う",
    "マジック2枚・黄供給true: 印字2枠を上限に支払う",
    "マジック3枚・黄供給true: 印字2枠を上限に支払う",
  ],
];

describe("BSAZ01-C04 自己軽減の支払い", () => {
  for (const suppliesYellow of [false, true]) {
    for (const count of [0, 1, 2, 3]) {
      it(matrixTitles[suppliesYellow ? 1 : 0]![count]!, () => {
        const { options, result } = reduction(
          C04,
          Array.from({ length: count }, (_, i) =>
            instance(suppliesYellow ? yellow : magic, `magic-${i}`)
          )
        );
        const expected = Math.min(2, count * (suppliesYellow ? 2 : 1));
        expect(result.totalReduction).toBe(expected);
        expect(result.finalCost).toBe(3 - expected);
        expect(
          getEffectiveReductionSymbolEntries(
            C04,
            options.state,
            "alice",
            options.getCardDefinitionById,
            "paying",
            "flash"
          )
        ).toHaveLength(2);
      });
    }
  }
  it("通常の黄1シンボルと無シンボルのマジック1枚を合算する", () => {
    expect(
      reduction(C04, [instance(nexus, "yellow"), instance(magic, "magic")])
        .result.finalCost
    ).toBe(1);
  });
  it("場使用ではC04自身を1枚に数える", () => {
    const { result } = reduction(C04, [], "field");
    expect(result.totalReduction).toBe(1);
    expect(result.finalCost).toBe(2);
  });
  it("手札使用時に場の別の同名C04から自己免除が重複しない", () => {
    const { result } = reduction(C04, [instance(C04, "other-copy")]);
    expect(result.totalReduction).toBe(1);
    expect(result.finalCost).toBe(2);
  });
  it("相手のマジックはC04の枚数に含めない", () => {
    expect(
      reduction(C04, [instance(magic, "opponent", "field", "bob")]).result
        .finalCost
    ).toBe(3);
  });
  it("使用個体欠落・不一致・他人・裏向きでは自己免除しない", () => {
    const { options, state } = reduction(C04, [instance(magic, "magic")]);
    expect(
      calculateReduction({ ...options, sourceInstanceId: undefined }).finalCost
    ).toBe(3);
    state.cardInstances[0]!.definitionId = magic.cardNo;
    expect(calculateReduction(options).finalCost).toBe(3);
    state.cardInstances[0]!.definitionId = C04.cardNo;
    state.cardInstances[0]!.controllerPlayerId = "bob";
    expect(calculateReduction(options).finalCost).toBe(3);
    state.cardInstances[0]!.controllerPlayerId = "alice";
    state.cardInstances[0]!.faceDown = true;
    expect(calculateReduction(options).finalCost).toBe(3);
  });
  it("自己効果の条件・元ゾーン・使用modeを共通評価する", () => {
    const card: CardDefinition = {
      ...C04,
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: { zone: ["hand"] },
          condition: [{ kind: "turn_player", player: "self" }],
          steps: [
            {
              action: {
                kind: "treat_as",
                appliesToCard: true,
                aspects: ["reduction_symbol"],
                waivesReductionRequirement: true,
                whenUsingEffectMode: "flash",
              },
            },
          ],
        },
      ],
    };
    const { options, state } = reduction(card, []);
    state.activePlayerId = "alice";
    expect(calculateReduction(options).finalCost).toBe(2);
    expect(
      calculateReduction({ ...options, effectMode: "main" }).finalCost
    ).toBe(3);
    state.activePlayerId = "bob";
    expect(calculateReduction(options).finalCost).toBe(3);
    state.activePlayerId = "alice";
    state.cardInstances[0]!.zone = "field";
    expect(calculateReduction(options).finalCost).toBe(3);
    state.cardInstances[0]!.zone = "in_use";
    state.cardInstances[0]!.inUseSourceZone = "hand";
    expect(calculateReduction(options).finalCost).toBe(2);
  });
});

describe("同本文7枚の印字枠充足", () => {
  it.each([
    "BSAZ01-C04",
    "BSAZ01-C07",
    "BSAZ01-C08",
    "BSAZ01-C09",
    "BSAZ01-C10",
    "BSAZ01-C11",
    "BSAZ01-C12",
  ])("%s はマジック1枚で支払いを1減らす", (cardNo) => {
    const card = definitions.get(cardNo)!;
    expect(card.textLines[0]).toMatch(
      /自分のフィールドのマジックカード1枚につき、(?:このカードの)?軽減シンボル1つを満たす/
    );
    const { result } = reduction(card, [instance(magic, "magic")]);
    expect(result.totalReduction).toBe(1);
    expect(result.finalCost).toBe(Math.max(0, card.cost - 1));
  });
});
