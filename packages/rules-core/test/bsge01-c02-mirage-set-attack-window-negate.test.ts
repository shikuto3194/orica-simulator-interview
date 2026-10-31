/**
 * BSGE01-C02「剛属性バックラー真」/ BSGE01-C11「贖罪の街」共通ミラージュ【セット中】
 * effects[0] 検証 (engine-mirage-set-attack-window-and-discard-cost-draw cluster)。
 *
 * 「魂状態を含む自分の「霊代 アキ」がいるとき、系統：「神喰」を持つ自分のスピリットの
 * アタック宣言からバトル終了後まで、相手のバースト/スタック効果を無効にする。」
 *
 * - 「アタック宣言〜バトル終了後まで」は field_has.battleState:"attacking" が
 *   activeAttack/battleEntities 解消まで真であることを利用した動的スコープ
 *   (BSTH09.2-転醒R03(B) 同型、P3-75 継続・条件付き negate と同じ recompute 経路)。
 * - バースト/スタックは使用自体を許可し、解決する効果を無効にする。
 * - duration while_set は mirage_set 滞在中限定 (C04 同型)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  isBurstEffectNullifiedByOpponent,
  recomputeAndRebuildContinuousEffects,
  getLegalActions,
  applyLegalAction,
  buildMagicLookup,
  buildFieldCardEffectLookup,
} from "../src";
import type { CardDefinition, GameState, ActiveStack } from "../src";
import { applyPendingStackNegateRequests } from "../src/legal/stack-resolution-core";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const C02 = cardNoMap.get("BSGE01-C02")!;
const C11 = cardNoMap.get("BSGE01-C11")!;
const AKI = cardNoMap.get("BSGE01-CX02")!; // 「霊代 アキ」

const BURST: CardDefinition = {
  cardNo: "TEST-BSGE01-C02-BURST",
  name: "TEST-BURST",
  printedCategory: "magic",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["バースト"],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};
cardNoMap.set(BURST.cardNo, BURST);

describe.each([
  ["BSGE01-C02", C02],
  ["BSGE01-C11", C11],
])(
  "%s ミラージュ【セット中】effects[0] shape (アタック窓のバースト/スタック無効)",
  (_label, card) => {
    const effect = card.effects![0]!;

    it("mirageData: cost2/reduction green 宣言済み", () => {
      expect(card.mirageData).toEqual({ cost: 2, reduction: ["green"] });
    });

    it("stub 解消済み、applicability=mirage_set、timingScope=自分アタックステップ", () => {
      expect(effect.stub).toBeUndefined();
      expect(effect.timing).toEqual({ kind: "continuous" });
      expect(effect.applicability).toEqual({ zone: ["mirage_set"] });
      expect(effect.timingScope).toEqual({ player: "self", period: "attack" });
    });

    it("condition: 霊代アキ(魂状態含む) + 系統神喰スピリットのbattleState attacking", () => {
      expect(effect.condition).toEqual([
        {
          kind: "field_has",
          player: "self",
          cardNames: [{ contains: "霊代 アキ" }],
          includeSoulState: true,
        },
        {
          kind: "field_has",
          player: "self",
          category: ["spirit"],
          tribes: ["神喰"],
          battleState: "attacking",
        },
      ]);
    });

    it("バーストとスタックを継続無効化し、ミラージュがセット中の間だけ有効", () => {
      expect(effect.steps).toHaveLength(2);
      expect(effect.steps[0]!.action).toEqual({
        kind: "negate",
        negateTarget: "opponent_burst",
        duration: { scope: "while_set" },
      });
      expect(effect.steps[1]!.action).toEqual({
        kind: "negate",
        negateTarget: "effect",
        targetEffectTiming: "stack",
        duration: { scope: "while_set" },
      });
    });
  }
);

describe("BSGE01-C02 盤面変化 (ミラージュ滞在 + 霊代アキ + 神喰アタック宣言中)", () => {
  const KAMIKUI_ATTACKER: CardDefinition = {
    cardNo: "TEST-BSGE01-C02-ATTACKER",
    name: "TEST-KAMIKUI-ATTACKER",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: [],
    tribe: "神喰",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
  cardNoMap.set(KAMIKUI_ATTACKER.cardNo, KAMIKUI_ATTACKER);

  function scenario(opts: {
    includeAki: boolean;
    attacking: boolean;
    activePlayerId: string;
    step: GameState["step"];
  }): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    return {
      ...base,
      activePlayerId: opts.activePlayerId,
      step: opts.step,
      cardInstances: [
        createCardInstance(C02, {
          instanceId: "c02-mirage",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "mirage",
        }),
        createCardInstance(KAMIKUI_ATTACKER, {
          instanceId: "kamikui-attacker",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        ...(opts.includeAki
          ? [
              createCardInstance(AKI, {
                instanceId: "aki-1",
                ownerPlayerId: "alice",
                controllerPlayerId: "alice",
                zone: "field",
                normalCoreCount: 1,
              }),
            ]
          : []),
      ],
      battleEntities: opts.attacking
        ? [
            {
              entityId: "battle-kamikui-attacker",
              memberInstanceIds: ["kamikui-attacker"],
              resolvedBp: 2000,
              resolvedSymbols: ["green"],
              attackState: "attacking",
            },
          ]
        : [],
    };
  }

  function hasNegateCE(state: GameState): boolean {
    return state.activeContinuousEffects.some(
      (c) =>
        c.modifierTag === "negate_opponent_burst" &&
        c.actingPlayerId === "alice"
    );
  }

  function hasRestrictStackCE(state: GameState): boolean {
    return state.activeContinuousEffects.some(
      (c) =>
        c.modifierTag === "negate_effect" &&
        c.actingPlayerId === "alice" &&
        c.metadata?.targetEffectTiming === "stack" &&
        c.metadata?.continuousStackNegate === true
    );
  }

  it("霊代アキ在場 + 神喰スピリット attacking + 自分のアタックステップ → 両CE登録 ∧ 相手バースト無効", () => {
    const state = recomputeAndRebuildContinuousEffects(
      scenario({
        includeAki: true,
        attacking: true,
        activePlayerId: "alice",
        step: "attack",
      }),
      getCardDefinitionById
    );
    expect(hasNegateCE(state)).toBe(true);
    expect(hasRestrictStackCE(state)).toBe(true);

    const burst = createCardInstance(BURST, {
      instanceId: "bob-burst",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "burst",
    });
    const withBurst = {
      ...state,
      cardInstances: [...state.cardInstances, burst],
    };
    expect(
      isBurstEffectNullifiedByOpponent(withBurst, "bob-burst", "bob", {
        getCardDefinitionById,
      })
    ).toBe(true);
  });

  it("霊代アキ不在 → CE未登録", () => {
    const state = recomputeAndRebuildContinuousEffects(
      scenario({
        includeAki: false,
        attacking: true,
        activePlayerId: "alice",
        step: "attack",
      }),
      getCardDefinitionById
    );
    expect(hasNegateCE(state)).toBe(false);
    expect(hasRestrictStackCE(state)).toBe(false);
  });

  it("神喰スピリットが attacking でない (バトル外) → CE未登録", () => {
    const state = recomputeAndRebuildContinuousEffects(
      scenario({
        includeAki: true,
        attacking: false,
        activePlayerId: "alice",
        step: "attack",
      }),
      getCardDefinitionById
    );
    expect(hasNegateCE(state)).toBe(false);
    expect(hasRestrictStackCE(state)).toBe(false);
  });

  it("battleState は attacking でも相手ターン (自分のアタックステップでない) → timingScope不活性で無効化されない", () => {
    const state = recomputeAndRebuildContinuousEffects(
      scenario({
        includeAki: true,
        attacking: true,
        activePlayerId: "bob",
        step: "attack",
      }),
      getCardDefinitionById
    );
    // CE 自体は condition 成立で登録されるが、timingScope (自分のアタックステップ) が不活性。
    expect(hasNegateCE(state)).toBe(true);
    const burst = createCardInstance(BURST, {
      instanceId: "bob-burst",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "burst",
    });
    const withBurst = {
      ...state,
      cardInstances: [...state.cardInstances, burst],
    };
    expect(
      isBurstEffectNullifiedByOpponent(withBurst, "bob-burst", "bob", {
        getCardDefinitionById,
      })
    ).toBe(false);
  });

  it("ミラージュゾーンを離れる (フィールド/手札) と CE は登録されない (applicability zone 束縛)", () => {
    for (const zone of ["field", "hand"] as const) {
      const state = recomputeAndRebuildContinuousEffects(
        {
          ...scenario({
            includeAki: true,
            attacking: true,
            activePlayerId: "alice",
            step: "attack",
          }),
          cardInstances: [
            createCardInstance(C02, {
              instanceId: `c02-${zone}`,
              ownerPlayerId: "alice",
              controllerPlayerId: "alice",
              zone,
            }),
            createCardInstance(KAMIKUI_ATTACKER, {
              instanceId: "kamikui-attacker",
              ownerPlayerId: "alice",
              controllerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            }),
            createCardInstance(AKI, {
              instanceId: "aki-1",
              ownerPlayerId: "alice",
              controllerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            }),
          ],
        },
        getCardDefinitionById
      );
      expect(hasNegateCE(state)).toBe(false);
      expect(hasRestrictStackCE(state)).toBe(false);
    }
  });

  it.each([C02, C11])(
    "$cardNo: スタックの使用とコスト支払いを許可し、効果解決だけを無効にする",
    (mirage) => {
      const stackMagic: CardDefinition = {
        ...BURST,
        cardNo: "TEST-MIRAGE-STACK",
        cost: 2,
        keywordTags: [],
        textLines: ["スタック", "1枚ドローする。"],
        effects: [
          {
            timing: { kind: "activated", mode: "stack" },
            steps: [{ action: { kind: "draw", count: 1 } }],
            textRef: [0, 1],
          },
        ],
      };
      cardNoMap.set(stackMagic.cardNo, stackMagic);
      const lookups = {
        getCardDefinitionById,
        getRegisteredMagicActions: buildMagicLookup([stackMagic]),
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
          C02,
          C11,
        ]),
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      };
      const outer: ActiveStack = {
        stackId: "outer",
        chainId: "outer",
        actionKind: "magic",
        actingPlayerId: "alice",
        cardInstanceId: "outer-card",
        cardDefinitionId: BURST.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: [],
        reducedCost: 0,
        totalReduction: 0,
        chosenTiming: "flash",
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      };
      let s = scenario({
        includeAki: true,
        attacking: true,
        activePlayerId: "alice",
        step: "attack",
      });
      s = {
        ...s,
        cardInstances: [
          ...s.cardInstances.map((card) =>
            card.instanceId === "c02-mirage"
              ? { ...card, definitionId: mirage.cardNo }
              : card
          ),
          createCardInstance(stackMagic, {
            instanceId: "stack-magic",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
          createCardInstance(BURST, {
            instanceId: "draw-card",
            ownerPlayerId: "bob",
            zone: "deck",
          }),
          createCardInstance(BURST, {
            instanceId: "outer-card",
            ownerPlayerId: "alice",
            zone: "in_use",
          }),
        ],
        players: s.players.map((p) =>
          p.id === "bob"
            ? { ...p, reserveNormalCoreCount: 8, handCount: 1, deckCount: 1 }
            : p
        ),
        window: "stack",
        stackWindow: {
          priorityPlayerId: "bob",
          consecutivePassCount: 0,
          actingPlayerId: "alice",
          previousWindow: "none",
          stackResponseSourcePlayerId: "alice",
          subStackEverOpened: false,
          burstWindowKind: null,
          pendingStackAction: outer,
        },
      };
      s = recomputeAndRebuildContinuousEffects(s, getCardDefinitionById);
      expect(s.pendingStackNegateRequests).toEqual([]);
      const use = getLegalActions({
        state: s,
        actingPlayerId: "bob",
        ...lookups,
      }).find(
        (a) => a.kind === "use_magic" && a.sourceInstanceId === "stack-magic"
      );
      expect(use).toBeDefined();
      s = applyLegalAction({
        state: s,
        action: use!,
        paymentSources: [{ kind: "reserve", amount: 2 }],
        ...lookups,
      }).state;
      expect(
        s.players.find((p) => p.id === "bob")!.reserveNormalCoreCount
      ).toBe(6);
      for (
        let i = 0;
        i < 5 &&
        s.cardInstances.find((c) => c.instanceId === "stack-magic")!.zone !==
          "trash";
        i++
      ) {
        const pass = getLegalActions({
          state: s,
          actingPlayerId: s.stackWindow!.priorityPlayerId,
          ...lookups,
        }).find((a) => a.kind === "pass_stack");
        expect(pass).toBeDefined();
        s = applyLegalAction({ state: s, action: pass!, ...lookups }).state;
      }
      expect(
        s.cardInstances.find((c) => c.instanceId === "stack-magic")!.zone
      ).toBe("trash");
      expect(
        s.cardInstances.find((c) => c.instanceId === "draw-card")!.zone
      ).toBe("deck");
      const another = {
        ...outer,
        actingPlayerId: "bob",
        cardInstanceId: "stack-magic",
        cardDefinitionId: stackMagic.cardNo,
        chosenTiming: "stack" as const,
        activationLabel: "stack" as const,
      };
      expect(
        applyPendingStackNegateRequests({
          state: s,
          remainingStacks: [another],
          getCardDefinitionById,
        }).remainingStacks[0]!.isNullified
      ).toBe(true);
      expect(
        applyPendingStackNegateRequests({
          state: s,
          remainingStacks: [
            { ...another, chosenTiming: "flash", activationLabel: "flash" },
          ],
          getCardDefinitionById,
        }).remainingStacks[0]!.isNullified
      ).not.toBe(true);
      const ended = recomputeAndRebuildContinuousEffects(
        { ...s, battleEntities: [], activeAttack: null },
        getCardDefinitionById
      );
      expect(
        applyPendingStackNegateRequests({
          state: ended,
          remainingStacks: [another],
          getCardDefinitionById,
        }).remainingStacks[0]!.isNullified
      ).not.toBe(true);
    }
  );
});
