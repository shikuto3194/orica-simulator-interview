/**
 * ENGINE-mirage-set-count-exemption / BSTH002-C01「化け化け」effects[0] 検証。
 *
 * カード本文 textRef:[0]:
 * 「セットしている/手札にあるこのカードは、自分のセット可能枚数に数えない。
 *   この効果は重複せず、ターンに1回しか使えない。」
 *
 * 裁定 (needs-ruling.jsonl BSTH002-C01 / 10_rules/08c_imagin-mirage-grandwalker.md:101):
 * - 「セット可能枚数」= 既存2制限（同時セット数1=入れ替え / ターン1回=セット行動数）の合成ラベル。
 * - 「セットしている」= 同時セット数制限（強制入れ替え）への免除。
 * - 「手札にある」= ターン1回のセット行動数制限への免除。
 * - 各セット個体は常に0枠。通常枠が1枚以下となる追加または個別交換を選べる。
 * - 手札の行動数免除だけを同名ターン1回として別管理する（2026-10-24ユーザー訂正）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  useSetMirageInStackContextAsAction,
  applyLegalAction,
  collectGameStateInvariantIssues,
  advanceStep,
  backfillOptionalStateFields,
  executeEffect,
  getMirageSetBlockReason,
  getAvailableSetMirageLegalActions,
  rebuildContinuousEffectsFromField,
  useSetMirageAsAction,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

const C01 = ALL_CARDS.find((c) => c.cardNo === "BSTH002-C01")!;
const FILLER = ALL_CARDS.find((c) => c.cardNo === "BSTH002-C02")!;

const NORMAL_MIRAGE: CardDefinition = {
  cardNo: "TEST-NORMAL-MIRAGE",
  name: "通常ミラージュテスト",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  mirageData: { cost: 0, reduction: [] },
  sourceUrls: [],
  sourceConfidence: "A",
};

const FUMA_COST_TARGET: CardDefinition = {
  cardNo: "TEST-FUMA-COST-TARGET",
  name: "封魔軽減対象テスト",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 3,
  reductionSymbols: ["purple"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  tribe: "封魔",
  sourceUrls: [],
  sourceConfidence: "A",
};

const NON_FUMA_COST_TARGET: CardDefinition = {
  ...FUMA_COST_TARGET,
  cardNo: "TEST-NON-FUMA-COST-TARGET",
  name: "非封魔軽減対象テスト",
  tribe: "無関係",
};

const TEST_CARDS = [
  ...ALL_CARDS,
  NORMAL_MIRAGE,
  FUMA_COST_TARGET,
  NON_FUMA_COST_TARGET,
];
const cardNoMap = new Map<string, CardDefinition>(
  TEST_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const mirageActionLookups = {
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
} as const;

function setMirage(
  options: Omit<
    Parameters<typeof useSetMirageAsAction>[0],
    "getRegisteredTriggeredEffectActions" | "getRegisteredBurstActions"
  >
) {
  return useSetMirageAsAction({ ...options, ...mirageActionLookups });
}

function getCard(state: GameState, id: string) {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
    }),
    activePlayerId: ALICE,
    step: "main",
    ...overrides,
  };
}

describe("ENGINE-mirage-set-count-exemption (BSTH002-C01 化け化け)", () => {
  it("mirageData.exemptSetCountLimits が true でセット可能（コスト2<紫>）", () => {
    expect(C01.mirageData?.exemptSetCountLimits).toBe(true);
    expect(C01.mirageData?.cost).toBe(2);
    expect(C01.mirageData?.reduction).toEqual(["purple"]);
  });

  it("effects[0]/[1] はセット中メインの手札→手元コストドローと封魔軽減補助を表す", () => {
    const setDraw = C01.effects![0]!;
    expect(setDraw.stub).toBeUndefined();
    expect(setDraw.timing).toEqual({ kind: "activated", mode: "main" });
    expect(setDraw.applicability).toEqual({ zone: ["mirage_set"] });
    expect(setDraw.usageLimit).toEqual([
      { kind: "per_instance", duration: "turn" },
      { kind: "per_card_name", duration: "turn" },
    ]);
    expect(setDraw.steps).toEqual([
      {
        action: {
          kind: "move_card",
          target: {
            kind: "filter",
            player: "self",
            zone: "hand",
            filter: {},
            count: 1,
          },
          from: { zone: "hand", player: "self" },
          to: { zone: "set_aside", player: "self" },
          count: 1,
        },
      },
      {
        action: { kind: "draw", count: 1 },
        connector: "conditional_cost",
      },
    ]);
    expect(setDraw.textRef).toEqual([4, 5]);

    const reductionAssist = C01.effects![1]!;
    expect(reductionAssist.stub).toBeUndefined();
    expect(reductionAssist.timing).toEqual({ kind: "continuous" });
    expect(reductionAssist.applicability).toEqual({ zone: ["mirage_set"] });
    expect(reductionAssist.steps).toEqual([
      {
        action: {
          kind: "treat_as",
          aspects: ["reduction_symbol"],
          whenPayingForFilter: { tribes: ["封魔"] },
          waivesReductionRequirement: true,
        },
      },
    ]);
    expect(reductionAssist.textRef).toEqual([7, 8]);
  });

  function fixture(
    existing: CardDefinition[],
    incoming: CardDefinition = NORMAL_MIRAGE
  ) {
    const cardInstances = [
      ...existing.map((definition, i) =>
        createCardInstance(definition, {
          instanceId: `old-${i}`,
          ownerPlayerId: ALICE,
          zone: "mirage",
        })
      ),
      createCardInstance(incoming, {
        instanceId: "incoming",
        ownerPlayerId: ALICE,
        zone: "hand",
      }),
    ];
    return baseState({
      cardInstances,
      mirageSetStates: existing.map((_, i) => ({
        playerId: ALICE,
        cardInstanceId: `old-${i}`,
      })),
      mirageSetCountExemptionsUsed: [{ playerId: ALICE, cardNo: C01.cardNo }],
    });
  }

  for (const { title, existing, incoming, expected } of [
    {
      title:
        "化け化け+Aから通常B: 個別候補・支払い・交換ゾーン・記録・ログを完走する",
      existing: [C01, NORMAL_MIRAGE],
      incoming: NORMAL_MIRAGE,
      expected: [["old-1"]],
    },
    {
      title:
        "化け化け+Aから化け化けB: 個別候補・支払い・交換ゾーン・記録・ログを完走する",
      existing: [C01, NORMAL_MIRAGE],
      incoming: C01,
      expected: [[], ["old-0"], ["old-1"]],
    },
    {
      title:
        "化け化け2枚から化け化けC: 個別候補・支払い・交換ゾーン・記録・ログを完走する",
      existing: [C01, C01],
      incoming: C01,
      expected: [[], ["old-0"], ["old-1"]],
    },
    {
      title:
        "化け化け2枚から通常B: 個別候補・支払い・交換ゾーン・記録・ログを完走する",
      existing: [C01, C01],
      incoming: NORMAL_MIRAGE,
      expected: [[], ["old-0"], ["old-1"]],
    },
  ]) {
    it(title, () => {
      const state = fixture(existing, incoming);
      const actions = getAvailableSetMirageLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      });
      expect(actions.map((a) => a.replacedMirageInstanceIds)).toEqual(expected);
      expect(new Set(actions.map((a) => a.actionId)).size).toBe(actions.length);
      expect(
        actions.every((a) => a.replacedMirageInstanceIds.length <= 1)
      ).toBe(true);
      for (const action of actions) {
        const paymentSources =
          incoming === C01 ? [{ kind: "reserve" as const, amount: 2 }] : [];
        const declared = applyLegalAction({
          state,
          action,
          paymentSources,
          getCardDefinitionById,
          ...mirageActionLookups,
        });
        expect(
          declared.state.stackWindow?.pendingStackAction
            ?.mirageReplacedInstanceIds
        ).toEqual(action.replacedMirageInstanceIds);
        const result = setMirage({
          state,
          actingPlayerId: ALICE,
          sourceInstanceId: "incoming",
          paymentSources,
          getCardDefinitionById,
          replacedMirageInstanceIds: action.replacedMirageInstanceIds,
        });
        expect(getCard(result.state, "incoming").zone).toBe("mirage");
        for (let i = 0; i < existing.length; i++) {
          expect(getCard(result.state, `old-${i}`).zone).toBe(
            action.replacedMirageInstanceIds.includes(`old-${i}`)
              ? "hand"
              : "mirage"
          );
        }
        expect(
          result.state.mirageSetStates
            .map((entry) => entry.cardInstanceId)
            .sort()
        ).toEqual(
          [
            ...existing
              .map((_, i) => `old-${i}`)
              .filter((id) => !action.replacedMirageInstanceIds.includes(id)),
            "incoming",
          ].sort()
        );
        expect(
          result.state.log.filter((line) => line.startsWith("mirage:replace:"))
        ).toEqual(
          action.replacedMirageInstanceIds.map(
            (id) => `mirage:replace:${ALICE}:${id}->incoming`
          )
        );
        expect(
          result.state.log.filter((line) =>
            line.startsWith("mirage:hand-return-no-increase:")
          )
        ).toEqual(
          action.replacedMirageInstanceIds.map(
            (id) => `mirage:hand-return-no-increase:${ALICE}:${id}`
          )
        );
        expect(result.state.mirageSetCountExemptionsUsed).toEqual(
          state.mirageSetCountExemptionsUsed
        );
      }
    });
  }

  it("直接呼出しとLegal Action適用は全件・他人・未セット・重複・枠超過の交換を支払い前に拒否する", () => {
    const state = fixture([C01, NORMAL_MIRAGE]);
    state.cardInstances.push(
      createCardInstance(NORMAL_MIRAGE, {
        instanceId: "opponent",
        ownerPlayerId: BOB,
        zone: "mirage",
      })
    );
    state.mirageSetStates.push({ playerId: BOB, cardInstanceId: "opponent" });
    const before = structuredClone(state);
    const action = getAvailableSetMirageLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    })[0]!;
    for (const ids of [
      ["old-0", "old-1"],
      ["opponent"],
      ["incoming"],
      ["missing"],
      ["old-1", "old-1"],
      [],
      ["old-0"],
    ]) {
      expect(() =>
        useSetMirageInStackContextAsAction({
          state,
          actingPlayerId: ALICE,
          sourceInstanceId: "incoming",
          paymentSources: [],
          getCardDefinitionById,
          ...mirageActionLookups,
          replacedMirageInstanceIds: ids,
        })
      ).toThrow(/replacement/);
      expect(() =>
        applyLegalAction({
          state,
          action: { ...action, replacedMirageInstanceIds: ids },
          paymentSources: [],
          getCardDefinitionById,
          ...mirageActionLookups,
        })
      ).toThrow();
    }
    expect(state).toEqual(before);
  });

  it("同名ターン1回はプレイヤー+cardNoで共有し、最初の化け化けは通常セット行動数を使わない", () => {
    let state = fixture([], C01);
    state.mirageSetCountExemptionsUsed = [];
    state = setMirage({
      state,
      actingPlayerId: ALICE,
      sourceInstanceId: "incoming",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      getCardDefinitionById,
    }).state;
    expect(state.mirageSetPlayerIdsThisTurn).toEqual([]);
    expect(state.mirageSetCountExemptionsUsed).toEqual([
      { playerId: ALICE, cardNo: C01.cardNo },
    ]);
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(NORMAL_MIRAGE, {
          instanceId: "normal",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
    };
    state = setMirage({
      state,
      actingPlayerId: ALICE,
      sourceInstanceId: "normal",
      paymentSources: [],
      getCardDefinitionById,
      replacedMirageInstanceIds: [],
    }).state;
    expect(state.mirageSetPlayerIdsThisTurn).toEqual([ALICE]);
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(C01, {
          instanceId: "copy",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
    };
    expect(
      getMirageSetBlockReason({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "copy",
        getCardDefinitionById,
      })
    ).toBe("already_set_mirage_this_turn");
    const other = { ...C01, cardNo: "TEST-OTHER-EXEMPT", name: "別名の免除" };
    const lookup = (id: string) =>
      id === other.cardNo ? other : getCardDefinitionById(id);
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(other, {
          instanceId: "other",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
    };
    state = setMirage({
      state,
      actingPlayerId: ALICE,
      sourceInstanceId: "other",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      getCardDefinitionById: lookup,
      replacedMirageInstanceIds: [],
    }).state;
    expect(state.mirageSetCountExemptionsUsed).toEqual([
      { playerId: ALICE, cardNo: C01.cardNo },
      { playerId: ALICE, cardNo: other.cardNo },
    ]);
    const bob = {
      ...state,
      activePlayerId: BOB,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(C01, {
          instanceId: "bob-copy",
          ownerPlayerId: BOB,
          zone: "hand",
        }),
      ],
    };
    expect(
      setMirage({
        state: bob,
        actingPlayerId: BOB,
        sourceInstanceId: "bob-copy",
        paymentSources: [{ kind: "reserve", amount: 2 }],
        getCardDefinitionById,
      }).state.mirageSetCountExemptionsUsed
    ).toContainEqual({ playerId: BOB, cardNo: C01.cardNo });
    const next = advanceStep(
      { ...state, step: "end" },
      lookup,
      () => [],
      () => []
    );
    expect(next.mirageSetCountExemptionsUsed).toEqual([]);
    expect(next.mirageSetPlayerIdsThisTurn).toEqual([]);
  });

  it("通常セット後も手札の化け化け1枚だけが免除され、同一セット個体の再登録を拒否する", () => {
    const state = fixture([NORMAL_MIRAGE], C01);
    state.mirageSetPlayerIdsThisTurn = [ALICE];
    state.mirageSetCountExemptionsUsed = [];
    const after = setMirage({
      state,
      actingPlayerId: ALICE,
      sourceInstanceId: "incoming",
      paymentSources: [{ kind: "reserve", amount: 2 }],
      getCardDefinitionById,
      replacedMirageInstanceIds: [],
    }).state;
    expect(after.mirageSetStates).toHaveLength(2);
    expect(after.mirageSetCountExemptionsUsed).toEqual([
      { playerId: ALICE, cardNo: C01.cardNo },
    ]);
    expect(
      getMirageSetBlockReason({
        state: after,
        actingPlayerId: ALICE,
        sourceInstanceId: "incoming",
        getCardDefinitionById,
      })
    ).toBe("source_already_set");
    expect(() =>
      setMirage({
        state: after,
        actingPlayerId: ALICE,
        sourceInstanceId: "incoming",
        paymentSources: [],
        getCardDefinitionById,
        replacedMirageInstanceIds: [],
      })
    ).toThrow(/source_already_set/);
  });

  it("使用記録invariantは同名重複と参照先不在を検出する", () => {
    const state = fixture([]);
    state.mirageSetCountExemptionsUsed.push(
      { playerId: ALICE, cardNo: C01.cardNo },
      { playerId: "missing", cardNo: C01.cardNo }
    );
    const issues = collectGameStateInvariantIssues(state);
    expect(
      issues.some(
        (issue) =>
          issue.code === "duplicate_mirage_set_count_exemption_used_player"
      )
    ).toBe(true);
    expect(
      issues.some(
        (issue) =>
          issue.code === "missing_mirage_set_count_exemption_used_player"
      )
    ).toBe(true);
  });

  it("旧セーブのプレイヤー単位使用済みを復元しても免除を再使用できず、0枠とターン境界を保つ", () => {
    const { mirageSetCountExemptionsUsed: _unused, ...legacy } = fixture(
      [C01, NORMAL_MIRAGE],
      C01
    );
    const state = backfillOptionalStateFields({
      ...legacy,
      mirageSetPlayerIdsThisTurn: [ALICE],
      mirageSetCountExemptionUsedPlayerIds: [ALICE],
    } as Partial<GameState>);
    expect(state.mirageSetCountExemptionsUsed).toEqual([
      { playerId: ALICE, cardNo: "*" },
    ]);
    expect(backfillOptionalStateFields(state)).toEqual(state);
    expect(
      getMirageSetBlockReason({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "incoming",
        getCardDefinitionById,
      })
    ).toBe("already_set_mirage_this_turn");
    const normal = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "incoming"
          ? createCardInstance(NORMAL_MIRAGE, {
              instanceId: card.instanceId,
              ownerPlayerId: ALICE,
              zone: "hand",
            })
          : card
      ),
      mirageSetPlayerIdsThisTurn: [],
    };
    expect(
      getAvailableSetMirageLegalActions({
        state: normal,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      }).map((action) => action.replacedMirageInstanceIds)
    ).toEqual([["old-1"]]);
    expect(
      advanceStep(
        { ...state, step: "end" },
        getCardDefinitionById,
        () => [],
        () => []
      ).mirageSetCountExemptionsUsed
    ).toEqual([]);
  });

  it("セット中メイン効果: 手札1枚を手元に置けた場合だけ1枚ドローする", () => {
    const bakebake = createCardInstance(C01, {
      instanceId: "bakebake",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "mirage",
    });
    const hand = createCardInstance(FILLER, {
      instanceId: "hand-card",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const deck = createCardInstance(FILLER, {
      instanceId: "deck-card",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [bakebake, hand, deck],
        playerOverrides: [{ handCount: 1, deckCount: 1 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
      turnNumber: 7,
    };

    const after = executeEffect({
      chainId: "test:bsth002-c01-mirage-set-count-exemption:337",
      state: before,
      effect: C01.effects![0]!,
      sourceInstanceId: "bakebake",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(getCard(after, "hand-card").zone).toBe("set_aside");
    expect(getCard(after, "deck-card").zone).toBe("hand");
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(1);
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(0);
    expect(after.log.filter((l) => l.includes("effect:draw"))).toHaveLength(1);
    expect(after.mirageSetDrawLog).toContainEqual({
      playerId: ALICE,
      sourceInstanceId: "bakebake",
      turnNumber: 7,
    });
  });

  it("セット中メイン効果: 手札を手元に置けない場合は conditional_cost でドローしない", () => {
    const bakebake = createCardInstance(C01, {
      instanceId: "bakebake",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "mirage",
    });
    const deck = createCardInstance(FILLER, {
      instanceId: "deck-card",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [bakebake, deck],
        playerOverrides: [{ handCount: 0, deckCount: 1 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
      turnNumber: 7,
    };

    const after = executeEffect({
      chainId: "test:bsth002-c01-mirage-set-count-exemption:381",
      state: before,
      effect: C01.effects![0]!,
      sourceInstanceId: "bakebake",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(getCard(after, "deck-card").zone).toBe("deck");
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(1);
    expect(after.log.filter((l) => l.includes("effect:draw"))).toHaveLength(0);
    expect(after.mirageSetDrawLog).toEqual([]);
  });

  it("セット中継続効果: 封魔カードの軽減シンボル1つを盤面シンボルなしで満たす", () => {
    const bakebake = createCardInstance(C01, {
      instanceId: "bakebake",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "mirage",
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      baseState({ cardInstances: [bakebake] }),
      getCardDefinitionById
    );

    const withFuma = calculateReduction({
      state: rebuilt,
      actingPlayerId: ALICE,
      card: FUMA_COST_TARGET,
      getCardDefinitionById,
    });
    expect(withFuma.totalReduction).toBe(1);
    expect(withFuma.reducedCost).toBe(2);

    const withUnrelated = calculateReduction({
      state: rebuilt,
      actingPlayerId: ALICE,
      card: NON_FUMA_COST_TARGET,
      getCardDefinitionById,
    });
    expect(withUnrelated.totalReduction).toBe(0);
    expect(withUnrelated.reducedCost).toBe(3);
  });
});
