/**
 * BSGE01-C01/C09/C12「ミラージュ【セット中】」効果 drain 検証。
 *
 * engine-mirage-set-hand-zone-immunity-remaining cluster: BSGE01-C04 で確立した
 * 2 primitive (effect_immunity target.zone:["hand"]+duration.while_set /
 * game_event count_increase・decrease + applicability.zone:["mirage_set"] の
 * 任意ドロー) をそのまま組み合わせて BSGE01-C01(神薙ユウ)・C09(神薙ユウ、nexus)・
 * C12(加賀美リョウ、C04と同型) の【セット中】stub を解消する。C01/C09 は C04 と違い
 * 「手札5枚以下なら」が draw の事前条件 (post-discard 無し)、C12 は C04 と textLines
 * が実質同一 (hand immunity + count-trigger draw→discard-to-5)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateTriggeredEffectRegistrations,
  rebuildContinuousEffectsFromField,
} from "../src";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);

const C01 = cardNoMap.get("BSGE01-C01")!;
const C09 = cardNoMap.get("BSGE01-C09")!;
const C12 = cardNoMap.get("BSGE01-C12")!;
const YUU = cardNoMap.get("BSGE01-CX01")!; // 「神薙 ユウ」
const KAGAMI = cardNoMap.get("BSGE01-CX04")!; // 「加賀美 リョウ」

const FILLER: CardDefinition = {
  cardNo: "TEST-BSGE01-MIRAGE-FILLER",
  name: "フィラー",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
cardNoMap.set(FILLER.cardNo, FILLER);

function handCount(state: GameState, player = "alice"): number {
  return state.players.find((p) => p.id === player)!.handCount;
}

function deckCount(state: GameState, player = "alice"): number {
  return state.players.find((p) => p.id === player)!.deckCount;
}

describe.each([
  { card: C01, cardNo: "BSGE01-C01" },
  { card: C09, cardNo: "BSGE01-C09" },
])(
  "$cardNo mirageData + effects[0] (神薙ユウ・カウント増減で任意ドロー)",
  ({ card }) => {
    it("mirageData: cost 2 / reduction 赤", () => {
      expect(card.mirageData).toEqual({ cost: 2, reduction: ["red"] });
    });

    const effect = card.effects![0]!;

    it("stub 解消済み、game_event + applicability.zone:['mirage_set']", () => {
      expect(effect.stub).toBeUndefined();
      expect(effect.timing).toEqual({
        kind: "game_event",
        player: "self",
        event: ["count_increase", "count_decrease"],
        triggerFilter: { tribes: ["神喰"] },
      });
      expect(effect.applicability).toEqual({ zone: ["mirage_set"] });
      expect(effect.condition).toEqual([
        {
          kind: "field_has",
          player: "self",
          cardNames: [{ contains: "神薙 ユウ" }],
          includeSoulState: true,
        },
        { kind: "hand_count", player: "self", max: 5 },
      ]);
      expect(effect.executionMode).toBe("optional");
      expect(effect.steps).toEqual([{ action: { kind: "draw", count: 1 } }]);
    });

    it("registration: sourceZone が ['mirage_set'] を伝播する", () => {
      const regs = generateTriggeredEffectRegistrations(card);
      for (const eventKind of ["count_increase", "count_decrease"] as const) {
        const reg = regs.find((r) => r.eventKind === eventKind);
        expect(reg).toBeDefined();
        expect(reg!.sourceZone).toEqual(["mirage_set"]);
        expect(reg!.executionMode).toBe("optional");
      }
    });

    function setUp(handN: number, deckN: number, includeYuu: boolean) {
      return createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ handCount: handN, deckCount: deckN }, {}],
        cardInstances: [
          createCardInstance(card, {
            instanceId: "mirage-1",
            ownerPlayerId: "alice",
            zone: "mirage",
          }),
          ...(includeYuu
            ? [
                createCardInstance(YUU, {
                  instanceId: "yuu-1",
                  ownerPlayerId: "alice",
                  zone: "field",
                  cores: 1,
                }),
              ]
            : []),
          ...Array.from({ length: handN }, (_, i) =>
            createCardInstance(FILLER, {
              instanceId: `hand-${i}`,
              ownerPlayerId: "alice",
              zone: "hand",
            })
          ),
          ...Array.from({ length: deckN }, (_, i) =>
            createCardInstance(FILLER, {
              instanceId: `deck-${i}`,
              ownerPlayerId: "alice",
              zone: "deck",
            })
          ),
        ],
      });
    }

    function runEffect(state: GameState): GameState {
      return executeEffect({
        chainId: "test:bsge01-mirage-set-drain:146",
        state,
        effect: card.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: "mirage-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
      });
    }

    it("神薙ユウ存在 + 手札5枚以下 → 発揮後は1枚引ける", () => {
      const base = setUp(4, 10, true);
      const after = runEffect(base);
      expect(after.pendingStepOptionalChoice ?? null).toBeNull();
      expect(handCount(after)).toBe(5);
      expect(deckCount(after)).toBe(9);
    });

    it("手札が6枚 (5枚超) → 効果は成立せず pending が発生しない", () => {
      const base = setUp(6, 10, true);
      const after = runEffect(base);
      expect(after.pendingStepOptionalChoice ?? null).toBeNull();
      expect(handCount(after)).toBe(6);
      expect(deckCount(after)).toBe(10);
    });

    it("神薙ユウ不在 → 手札5枚以下でも効果は成立しない", () => {
      const base = setUp(4, 10, false);
      const after = runEffect(base);
      expect(after.pendingStepOptionalChoice ?? null).toBeNull();
      expect(handCount(after)).toBe(4);
      expect(deckCount(after)).toBe(10);
    });
  }
);

describe("BSGE01-C12 effects[0] (継続: 手札ゾーン免疫, C04 同型)", () => {
  const effect = C12.effects![0]!;

  it("mirageData: cost 2 / reduction 青", () => {
    expect(C12.mirageData).toEqual({ cost: 2, reduction: ["blue"] });
  });

  it("stub 解消済み、condition (field_has 加賀美リョウ + hand_count<=5)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "加賀美 リョウ" }],
        includeSoulState: true,
      },
      { kind: "hand_count", player: "self", max: 5 },
    ]);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.duration).toEqual({ scope: "while_set" });
    }
  });

  function setUp(handN: number, includeKagami: boolean) {
    const mirage = createCardInstance(C12, {
      instanceId: "c12-mirage",
      ownerPlayerId: "alice",
      zone: "mirage",
    });
    const handCards = Array.from({ length: handN }, (_, i) =>
      createCardInstance(FILLER, {
        instanceId: `alice-hand-${i}`,
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    const cardInstances = includeKagami
      ? [
          mirage,
          ...handCards,
          createCardInstance(KAGAMI, {
            instanceId: "kagami-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ]
      : [mirage, ...handCards];
    return createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: handN }, {}],
      cardInstances,
    });
  }

  it("加賀美リョウ存在 + 手札5枚以下 → 手札の各カードが相手起因効果を受けない", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      setUp(5, true),
      getCardDefinitionById
    );
    const handCard = rebuilt.cardInstances.find(
      (c) => c.instanceId === "alice-hand-0"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        handCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("手札が6枚 (5枚超) → 免疫は登録されない", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      setUp(6, true),
      getCardDefinitionById
    );
    const handCard = rebuilt.cardInstances.find(
      (c) => c.instanceId === "alice-hand-0"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        handCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
  });
});

describe("BSGE01-C12 effects[1] (game_event: 神喰カウント増減トリガー, C04 同型)", () => {
  const effect = C12.effects![1]!;

  it("stub 解消済み、effect-level 任意ドロー→conditional_result で targetHandSize:5 破棄", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: ["mirage_set"] });
    expect(effect.executionMode).toBe("optional");
    expect(effect.steps).toHaveLength(2);
    expect(effect.steps[0]!.action).toEqual({ kind: "draw", count: 1 });
    expect(effect.steps[0]!.executionMode).toBeUndefined();
    expect(effect.steps[1]!.action).toEqual({
      kind: "discard",
      player: "self",
      count: -1,
      targetHandSize: 5,
    });
    expect(effect.steps[1]!.connector).toBe("conditional_result");
  });

  function setUp(handN: number, deckN: number) {
    return createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: handN, deckCount: deckN }, {}],
      cardInstances: [
        createCardInstance(C12, {
          instanceId: "c12-mirage",
          ownerPlayerId: "alice",
          zone: "mirage",
        }),
        createCardInstance(KAGAMI, {
          instanceId: "kagami-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        ...Array.from({ length: handN }, (_, i) =>
          createCardInstance(FILLER, {
            instanceId: `hand-${i}`,
            ownerPlayerId: "alice",
            zone: "hand",
          })
        ),
        ...Array.from({ length: deckN }, (_, i) =>
          createCardInstance(FILLER, {
            instanceId: `deck-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
    });
  }

  function runEffect(state: GameState): GameState {
    return executeEffect({
      chainId: "test:bsge01-mirage-set-drain:336",
      state,
      effect: C12.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "c12-mirage",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    });
  }

  it("発揮後は1枚引いた後、手札が5枚以下になるよう破棄される (6→7→5)", () => {
    const base = setUp(6, 10);
    const pendingState = runEffect(base);
    expect(pendingState.pendingStepOptionalChoice ?? null).toBeNull();
    const zoneSelection = pendingState.pendingZoneSelection!;
    expect(zoneSelection).not.toBeNull();
    expect(zoneSelection.actionKind).toBe("discard_hand");
    expect(zoneSelection.maxCount).toBe(2);
    const afterDiscard = applyLegalAction({
      state: pendingState,
      action: {
        kind: "resolve_pending_zone_selection",
        actionId: `zs-${zoneSelection.actionKind}`,
        can: true,
        reason: "test",
        actingPlayerId: zoneSelection.actingPlayerId,
        pendingId: zoneSelection.pendingId,
        actionKind: zoneSelection.actionKind,
        candidateCardInstanceIds: zoneSelection.candidateCardInstanceIds,
        maxCount: zoneSelection.maxCount,
        canSkip: zoneSelection.canSkip ?? true,
      },
      selectedZoneCardIds: zoneSelection.candidateCardInstanceIds.slice(0, 2),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(handCount(afterDiscard)).toBe(5);
    expect(deckCount(afterDiscard)).toBe(9);
  });

  it("registration: 発揮有無の任意性を effect-level で伝播する", () => {
    const regs = generateTriggeredEffectRegistrations(C12);
    for (const eventKind of ["count_increase", "count_decrease"] as const) {
      const reg = regs.find((r) => r.eventKind === eventKind);
      expect(reg).toBeDefined();
      expect(reg!.sourceZone).toEqual(["mirage_set"]);
      expect(reg!.executionMode).toBe("optional");
    }
  });
});
