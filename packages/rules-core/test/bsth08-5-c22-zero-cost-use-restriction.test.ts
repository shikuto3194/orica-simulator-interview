import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  isCardUseRestricted,
  rebuildContinuousEffectsFromField,
} from "../src";
import { buildMagicLookup } from "../src/effect/structured-effect-registrations";
import { executeSummonOther } from "../src/effect/structured-summon";
import { useMagicCardWithoutPayingCostAsAction } from "../src/mechanics/magic-system";
import type { CardDefinition, GameState, SummonAction } from "../src";

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
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
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
  [redFieldSupply.cardNo, redFieldSupply],
]);
const getCardDefinitionById = (id: string) => lookupMap.get(id);

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

describe("BSTH08.5-C22 能面・猿（困） effects[0]: お互いコストを支払わずに手札/手元のカードを使えない", () => {
  const def = cardNoMap.get("BSTH08.5-C22")!;

  function withRestriction(
    cards: GameState["cardInstances"],
    activePlayerId = "alice"
  ) {
    return rebuildContinuousEffectsFromField(
      {
        ...makeState(),
        step: "main",
        window: "none",
        activePlayerId,
        cardInstances: [
          createCardInstance(def, {
            instanceId: "c22",
            ownerPlayerId: "alice",
            zone: "set_aside",
          }),
          ...cards,
        ],
      },
      getCardDefinitionById
    );
  }

  it("両プレイヤーの手札・手元の無償マジック使用を止め、トラッシュは対象外", () => {
    for (const ownerPlayerId of ["alice", "bob"]) {
      for (const zone of ["hand", "set_aside", "trash"] as const) {
        const magic = createCardInstance(magicReducedToZero, {
          instanceId: "magic",
          ownerPlayerId,
          zone,
        });
        const state = withRestriction([magic]);
        const result = useMagicCardWithoutPayingCostAsAction({
          state,
          actingPlayerId: ownerPlayerId,
          magicInstanceId: magic.instanceId,
          allowedSourceZones: [zone],
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions: () => [],
          getRegisteredBurstActions: () => undefined,
        }).state;
        expect(
          result.log.some((entry) =>
            entry.startsWith("magic:without-cost:restricted:")
          )
        ).toBe(zone !== "trash");
        if (zone !== "trash") {
          expect(
            result.cardInstances.find(
              (card) => card.instanceId === magic.instanceId
            )?.zone
          ).toBe(zone);
        }
      }
    }
  });

  it.each(["hand", "set_aside"] as const)("%s のカード保護が効く", (zone) => {
    const protectionDef = cardNoMap.get("BSTH02.7-C03")!;
    const magic = createCardInstance(magicReducedToZero, {
      instanceId: "protected-magic",
      ownerPlayerId: "bob",
      zone,
    });
    const state = withRestriction([
      magic,
      createCardInstance(protectionDef, {
        instanceId: "protection",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: protectionDef.levelDefs[1]!.requiredCores,
      }),
    ]);
    const result = useMagicCardWithoutPayingCostAsAction({
      state,
      actingPlayerId: "bob",
      magicInstanceId: magic.instanceId,
      allowedSourceZones: [zone],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
    }).state;
    expect(
      result.cardInstances.find((card) => card.instanceId === magic.instanceId)
        ?.zone
    ).toBe("trash");
  });

  it("プレイヤー耐性があってもカードへの制限は残る", () => {
    const magic = createCardInstance(magicReducedToZero, {
      instanceId: "magic",
      ownerPlayerId: "bob",
      zone: "hand",
    });
    const state = withRestriction([magic]);
    state.activeContinuousEffects.push({
      effectId: "player-protection",
      sourceInstanceId: "player-protection",
      sourceDefinitionId: "BSTH01-X07",
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      modifierTag: "player_effect_immunity",
      targetInstanceId: "bob",
    });
    expect(
      isCardUseRestricted(
        state,
        "bob",
        magic,
        magicReducedToZero,
        getCardDefinitionById,
        "magic",
        { withoutCost: true }
      )
    ).toBe(true);
  });

  it("軽減後に0を支払う通常マジックは合法", () => {
    const state = withRestriction(
      [
        createCardInstance(magicReducedToZero, {
          instanceId: "magic",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
        createCardInstance(redFieldSupply, {
          instanceId: "red",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      "bob"
    );
    expect(
      getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredMagicActions: buildMagicLookup([magicReducedToZero]),
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "magic",
          finalCost: 0,
        }),
      ])
    );
  });

  it.each([
    { modifier: "free" as const, allowed: false },
    { modifier: { override: 0 }, allowed: true },
  ])(
    "cost_modify $modifier による0コストの合法手 = $allowed",
    ({ modifier, allowed }) => {
      const magic = createCardInstance(magicReducedToZero, {
        instanceId: "magic",
        ownerPlayerId: "bob",
        zone: "hand",
      });
      const state = executeEffect({
        state: withRestriction([magic], "bob"),
        chainId: "test:c22:cost-modify",
        sourceInstanceId: "c22",
        actingPlayerId: "alice",
        getCardDefinitionById,
        effect: {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "cost_modify",
                player: "opponent",
                cardFilter: { category: ["magic"] },
                modifier,
                duration: { scope: "permanent" },
              },
            },
          ],
        },
      });
      const zeroCostActions = getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredMagicActions: buildMagicLookup([magicReducedToZero]),
      }).filter(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "magic" &&
          action.finalCost === 0
      );
      expect(zeroCostActions).toEqual(
        allowed ? [expect.objectContaining({ costMode: "override" })] : []
      );
    }
  );

  it.each([
    { label: "無償", cost: { withoutCost: true }, zone: "hand" },
    { label: "固定支払い0", cost: { fixedPayment: 0 }, zone: "field" },
    { label: "変更後コスト0", cost: { overrideCost: 0 }, zone: "field" },
  ] satisfies { label: string; cost: Partial<SummonAction>; zone: string }[])(
    "手札からの効果召喚 ($label) の結果は $zone",
    ({ cost, zone }) => {
      const summonCard = createCardInstance(redFieldSupply, {
        instanceId: "summon",
        ownerPlayerId: "alice",
        zone: "hand",
      });
      const state = withRestriction([summonCard]);
      const result = executeSummonOther(
        {
          ...state,
          players: state.players.map((player) =>
            player.id === "alice"
              ? { ...player, reserveNormalCoreCount: 1 }
              : player
          ),
        },
        "test:c22:summon",
        "alice",
        {
          kind: "summon",
          target: "other",
          zone: "hand",
          ...cost,
        },
        "c22",
        getCardDefinitionById,
        [],
        [{ kind: "reserve", amount: 1 }]
      );
      expect(
        result.cardInstances.find(
          (card) => card.instanceId === summonCard.instanceId
        )?.zone
      ).toBe(zone);
    }
  );

  it("印字コスト0の通常使用は制限されない", () => {
    const zero = { ...magicReducedToZero, cost: 0, reductionSymbols: [] };
    const magic = createCardInstance(zero, {
      instanceId: "zero",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    expect(
      isCardUseRestricted(
        withRestriction([magic]),
        "alice",
        magic,
        zero,
        getCardDefinitionById,
        "magic"
      )
    ).toBe(false);
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
