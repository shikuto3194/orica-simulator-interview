/**
 * BSGE01-C04「剛属性バックラー堅」ミラージュ【セット中】effects[0,1] 検証。
 *
 * ENGINE-mirage-set-continuous-triggered: applicability.zone:["mirage_set"] が
 * BSTH01-M13 (burst_set/trash) と同型の precedent で continuous / game_event
 * 双方の登録・除去を制御できることを実カードで確認する
 * (cluster note の懸念(b): 「game_event型トリガーが mirage_set 由来カードで
 * 正しく発火するか」を実際に検証する)。
 *
 * effects[0] (continuous): 「加賀美 リョウ」(BSGE01-CX04, 魂状態含む) 存在 +
 *   手札5枚以下の間、相手の効果を受けない。「自分の手札は」は読点を伴わず
 *   「手札」を主語化するためカード/ゾーン対象 (project_player_target_vs_card_target)。
 *   BSDB01-C06/BSTS01-C05/BSTH02.7-C03 と同型の
 *   effect_immunity target:{kind:"filter", zone:["hand"], count:"all"} ゾーン全体免疫
 *   (ENGINE-effect-immunity-hand-zone-scope) だが、duration は
 *   while_on_field (フィールド常駐) の代わりに while_set (ミラージュ/バースト
 *   【セット中】、legal-actions-shared.ts recomputeContinuousEffects と対称) を使う。
 *   structured-continuous-effects.ts の動的 targetFilter 生成条件を while_on_field
 *   限定から while_set も含むよう一般化した。
 *
 * effects[1] (game_event): 「加賀美 リョウ」存在時、系統「神喰」の効果で自分の
 *   カウントが増減したときデッキ上から1枚ドローできる。そうしたとき手札5枚以下に
 *   なるよう破棄する (BSTS01 summon/advent ドロー→targetHandSize 破棄と同型の
 *   conditional_result 連結)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
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

const C04 = cardNoMap.get("BSGE01-C04")!;
const KAGAMI = cardNoMap.get("BSGE01-CX04")!; // 「加賀美 リョウ」

/** draw/discard の実カードインスタンスを要する盤面テスト用フィラー。 */
const FILLER: CardDefinition = {
  cardNo: "TEST-BSGE01-C04-FILLER",
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

describe("BSGE01-C04 effects[0] shape (継続: 手札ゾーン免疫)", () => {
  const effect = C04.effects![0]!;

  it("condition (field_has 加賀美リョウ + hand_count<=5)、stub 解消済み", () => {
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
  });

  it("steps[0] = effect_immunity(target:{kind:'filter', zone:['hand'], count:'all'}, duration:while_set)", () => {
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({
        kind: "filter",
        player: "self",
        filter: {},
        count: "all",
        zone: ["hand"],
      });
      expect(action.duration).toEqual({ scope: "while_set" });
    }
  });
});

describe("BSGE01-C04 effects[0] 盤面変化 (mirage zone 束縛 + 手札ゾーン免疫)", () => {
  function setUp(handN: number, includeKagami: boolean) {
    const mirage = createCardInstance(C04, {
      instanceId: "c04-mirage",
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

  it("加賀美リョウ存在 + 手札5枚以下 → 手札の各カードに defense_immune が登録され、相手起因効果を受けない", () => {
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
    // 自分起因は対象外 (「相手の効果」限定)。
    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        handCard,
        "alice",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
    // フィールドの加賀美リョウ自身はゾーン対象外 (手札限定)。
    const kagami = rebuilt.cardInstances.find(
      (c) => c.instanceId === "kagami-1"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        kagami,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
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

  it("加賀美リョウ不在 → 手札5枚以下でも免疫は登録されない", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      setUp(5, false),
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

  it("ミラージュゾーンを離れる (手札/フィールド) と免疫は登録されない (zone 束縛)", () => {
    for (const zone of ["hand", "field"] as const) {
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ handCount: 5 }, {}],
        cardInstances: [
          createCardInstance(C04, {
            instanceId: `c04-${zone}`,
            ownerPlayerId: "alice",
            zone,
          }),
          ...Array.from({ length: 5 }, (_, i) =>
            createCardInstance(FILLER, {
              instanceId: `alice-hand-${zone}-${i}`,
              ownerPlayerId: "alice",
              zone: "hand",
            })
          ),
          createCardInstance(KAGAMI, {
            instanceId: `kagami-${zone}`,
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      });
      const rebuilt = rebuildContinuousEffectsFromField(
        state,
        getCardDefinitionById
      );
      const handCard = rebuilt.cardInstances.find(
        (c) => c.instanceId === `alice-hand-${zone}-0`
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
    }
  });

  it("通常ドローで手札が6枚になると既存の hand_count 条件付き免疫は失効する", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: 5, deckCount: 1 }, {}],
      cardInstances: [
        createCardInstance(C04, {
          instanceId: "c04-mirage",
          ownerPlayerId: "alice",
          zone: "mirage",
        }),
        ...Array.from({ length: 5 }, (_, i) =>
          createCardInstance(FILLER, {
            instanceId: `alice-hand-draw-${i}`,
            ownerPlayerId: "alice",
            zone: "hand",
          })
        ),
        createCardInstance(FILLER, {
          instanceId: "alice-deck-draw-0",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(KAGAMI, {
          instanceId: "kagami-draw",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const active = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const firstHandCard = active.cardInstances.find(
      (c) => c.instanceId === "alice-hand-draw-0"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        active,
        firstHandCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(true);

    const afterDraw = advanceStep(
      {
        ...active,
        activePlayerId: "alice",
        turnNumber: 2,
        step: "core" as const,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions
    );

    expect(afterDraw.step).toBe("draw");
    expect(handCount(afterDraw)).toBe(6);
    const afterHandCard = afterDraw.cardInstances.find(
      (c) => c.instanceId === "alice-hand-draw-0"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        afterDraw,
        afterHandCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
    expect(
      afterDraw.activeContinuousEffects.some(
        (effect) =>
          effect.sourceInstanceId === "c04-mirage" &&
          effect.modifierTag === "defense_immune"
      )
    ).toBe(false);
  });
});

describe("BSGE01-C04 effects[1] shape (game_event: 神喰カウント増減トリガー)", () => {
  const effect = C04.effects![1]!;

  it("timing.event に count_increase/count_decrease + triggerFilter tribes:['神喰']、mirage_set 束縛", () => {
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
        cardNames: [{ contains: "加賀美 リョウ" }],
        includeSoulState: true,
      },
    ]);
  });

  it("steps: effect-level 任意ドロー1枚 → conditional_result で targetHandSize:5 破棄", () => {
    expect(effect.steps).toHaveLength(2);
    expect(effect.executionMode).toBe("optional");
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

  it("registration: sourceZone が applicability.zone ['mirage_set'] をそのまま伝播する (誘発発火のゾーン束縛が正しく配線されている)", () => {
    const regs = generateTriggeredEffectRegistrations(C04);
    for (const eventKind of ["count_increase", "count_decrease"] as const) {
      const reg = regs.find((r) => r.eventKind === eventKind);
      expect(reg).toBeDefined();
      expect(reg!.sourceZone).toEqual(["mirage_set"]);
      expect(reg!.executionMode).toBe("optional");
    }
  });
});

describe("BSGE01-C04 effects[1] 盤面変化 (ミラージュ滞在中のドロー→破棄)", () => {
  function setUp(handN: number, deckN: number) {
    return createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: handN, deckCount: deckN }, {}],
      cardInstances: [
        createCardInstance(C04, {
          instanceId: "c04-mirage",
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
      chainId: "test:bsge01-c04-mirage-set-effects:441",
      state,
      effect: C04.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "c04-mirage",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    });
  }

  it("発揮後は1枚引いた後、手札が5枚以下になるよう破棄される (6→7→5)", () => {
    const base = setUp(6, 10);
    const pendingState = runEffect(base);
    expect(pendingState.pendingStepOptionalChoice ?? null).toBeNull();
    // 破棄 2 枚は「見ないで」指定が無いため所有者が選ぶ pendingZoneSelection を経由する。
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
    // 6 (開始) → draw で 7 → targetHandSize:5 破棄で 5。デッキは draw 1、手札は破棄でトラッシュ行き。
    expect(handCount(afterDiscard)).toBe(5);
    expect(deckCount(afterDiscard)).toBe(9);
    const remainingHand = afterDiscard.cardInstances.find(
      (card) => card.ownerPlayerId === "alice" && card.zone === "hand"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        afterDiscard,
        remainingHand,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(true);
  });
});
