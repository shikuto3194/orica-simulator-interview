/**
 * BSRK01 「マジック効果コピー」借用発揮クラスタ: BSRK01-M01 effects[1] (textRef[5,6]) /
 * BSRK01-R03 effects[0] (textRef[3,4]) / BSRK01-X02 effects[0] (textRef[3,4,5])。
 *
 * いずれも既存 borrow_magic_effect primitive (effect-borrowing.ts、BSAZ03-M01 初出) の
 * card-data 変換で、新規プリミティブは不要 (stub 注記「マジック効果コピーサブシステムが
 * DSL未対応」は stale、[[project_fidelity_audit_stale_stub_notes]])。
 *
 * X02 のみ「この効果で発揮する…効果は、相手の効果を受けない」の実現のため
 * executeBorrowMagicEffect に sourcePreventionLevel/sourcePreventionBypass の委譲経路を新設
 * (borrow_card_event_effect に既にある同型委譲の欠落分パリティ追加)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  applyLegalAction,
  getLegalActions,
  flushPendingLeaves,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const M01 = cardNoMap.get("BSRK01-M01")!;
const R03 = cardNoMap.get("BSRK01-R03")!;
const X02 = cardNoMap.get("BSRK01-X02")!;
const noTriggeredLookup = () => [];

const ALICE = "alice";
const BOB = "bob";

function magicDonorDef(
  cardNo: string,
  mode: "flash" | "stack" | "main",
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: `飛天御剣流『${cardNo}』`,
    printedCategory: "magic",
    colors: ["white"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "明治・剣士",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [0],
      },
    ],
    ...overrides,
  } as CardDefinition;
}

function opponentSpiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テスト対象 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "テスト",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  } as CardDefinition;
}

const FLASH_DONOR = magicDonorDef("TEST-RK01-DONOR-FLASH", "flash");
const STACK_DONOR = magicDonorDef("TEST-RK01-DONOR-STACK", "stack");
const MAIN_DONOR = magicDonorDef("TEST-RK01-DONOR-MAIN", "main");
const OPEN_ONLY_DONOR = magicDonorDef("TEST-RK01-OPEN-ONLY", "flash", {
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
        {
          connector: "sequential",
          stepCondition: { kind: "activation_zone", zones: ["hand"] },
          action: { kind: "remove_from_game", target: { kind: "self" } },
        },
      ],
      textRef: [0],
    },
  ],
});
const NON_MATCHING_DONOR = magicDonorDef("TEST-RK01-NOT-A-MATCH", "main", {
  name: "無関係なマジック",
});
const OPPONENT_A = opponentSpiritDef("TEST-RK01-OPP-A");
const OPPONENT_B = opponentSpiritDef("TEST-RK01-OPP-B");
const testDefs = new Map<string, CardDefinition>(
  [
    FLASH_DONOR,
    STACK_DONOR,
    MAIN_DONOR,
    OPEN_ONLY_DONOR,
    NON_MATCHING_DONOR,
    OPPONENT_A,
    OPPONENT_B,
  ].map((d) => [d.cardNo, d])
);
const getCardDefinitionById = (id: string) =>
  cardNoMap.get(id) ?? testDefs.get(id);

function m01BorrowEffect() {
  return M01.effects!.find((e) =>
    e.steps.some((s) => s.action.kind === "borrow_magic_effect")
  )!;
}

function r03BorrowEffect() {
  return R03.effects!.find((e) =>
    e.steps.some((s) => s.action.kind === "deck_reveal")
  )!;
}

function x02BorrowEffect() {
  return X02.effects!.find((e) =>
    e.steps.some((s) => s.action.kind === "borrow_magic_effect")
  )!;
}

describe("BSRK01-M01 effects[1] textRef[5,6]: 手札/トラッシュの「飛天御剣流」借用発揮 → 破棄", () => {
  const effect = m01BorrowEffect();

  it("card-data: 非stub・任意(「オープンでき」)・Lv1-2限定・borrowModes[flash,stack]・thenMove(trash, from hand/trash)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.executionMode).toBe("optional");
    expect(effect.applicability).toEqual({ level: { min: 1, max: 2 } });
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("borrow_magic_effect");
    if (action.kind !== "borrow_magic_effect") throw new Error("unreachable");
    expect(action.borrowModes).toEqual(["flash", "stack"]);
    expect(action.treatAsMagicUse).toBeUndefined();
    expect(action.thenMove).toEqual({
      zone: "trash",
      fromZone: ["hand", "trash"],
    });
    expect(action.target).toEqual({
      kind: "filter",
      player: "self",
      zone: ["hand", "trash"],
      filter: {
        category: ["magic"],
        cardName: { contains: "飛天御剣流" },
        hasActivatedEffectMode: ["flash", "stack"],
      },
      count: 1,
    });
  });

  it("実行: トラッシュの飛天御剣流(flash)を借用すると、相手スピリットが破壊されドナーはトラッシュに残る", () => {
    const m01Instance = createCardInstance(M01, {
      instanceId: "m01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(FLASH_DONOR, {
      instanceId: "donor-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const opponent = createCardInstance(OPPONENT_A, {
      instanceId: "opp-a",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [m01Instance, donor, opponent],
    });

    const afterResolved = executeEffect({
      chainId: "test:bsrk01-magic-effect-borrow:207",
      state,
      effect,
      sourceInstanceId: "m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      targetInstanceIds: ["donor-trash"],
    });

    expect(
      afterResolved.log.some(
        (l) => l === "borrow_magic_effect:executed:TEST-RK01-DONOR-FLASH"
      )
    ).toBe(true);
    const after = flushPendingLeaves(afterResolved, getCardDefinitionById);
    expect(
      after.cardInstances.find((c) => c.instanceId === "opp-a")!.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "donor-trash")!.zone
    ).toBe("trash");
  });

  it("実行: 手札の飛天御剣流(stack)を借用すると、相手スピリットが破壊されドナーは手札からトラッシュへ移る", () => {
    const m01Instance = createCardInstance(M01, {
      instanceId: "m01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(STACK_DONOR, {
      instanceId: "donor-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const opponent = createCardInstance(OPPONENT_A, {
      instanceId: "opp-a",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [m01Instance, donor, opponent],
    });
    const before = state.players.find((p) => p.id === ALICE)!.handCount;

    const afterResolved = executeEffect({
      chainId: "test:bsrk01-magic-effect-borrow:257",
      state,
      effect,
      sourceInstanceId: "m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      targetInstanceIds: ["donor-hand"],
    });

    const after = flushPendingLeaves(afterResolved, getCardDefinitionById);
    expect(
      after.cardInstances.find((c) => c.instanceId === "opp-a")!.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "donor-hand")!.zone
    ).toBe("trash");
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(
      before - 1
    );
  });

  it("実行: 「オープンして効果を発揮」するだけの借用は hand の activation_zone を伝播せず、使用後固有処理を誤発火しない", () => {
    const m01Instance = createCardInstance(M01, {
      instanceId: "m01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(OPEN_ONLY_DONOR, {
      instanceId: "open-only-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [m01Instance, donor],
    });

    const after = executeEffect({
      chainId: "test:bsrk01-magic-effect-borrow:298",
      state,
      effect,
      sourceInstanceId: m01Instance.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      targetInstanceIds: [donor.instanceId],
    });

    expect(
      after.players.find((player) => player.id === ALICE)!.countValue
    ).toBe(1);
    // BSRK01-M01 は「使用」ではないため activation_zone:hand の除外 step は走らず、
    // 原文どおり「その後、オープンしたカードは破棄する」thenMove だけが適用される。
    expect(
      after.cardInstances.find((card) => card.instanceId === donor.instanceId)
        ?.zone
    ).toBe("trash");
  });
});

describe("BSRK01-R03 effects[0] textRef[3,4]: デッキ3枚オープン→飛天御剣流(main/flash)借用、残り破棄・発揮カードは手札", () => {
  const effect = r03BorrowEffect();

  it("card-data: 非stub・任意・ターンに1回:同名・Lv1-2限定・deck_reveal(3,remainder=trash)+borrow_magic_effect(ref)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.applicability).toEqual({ level: { min: 1, max: 2 } });
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.id).toBe("reveal");
    const reveal = effect.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind !== "deck_reveal") throw new Error("unreachable");
    expect(reveal.revealCount).toBe(3);
    expect(reveal.remainder).toBe("trash");
    expect(reveal.picks).toEqual([
      {
        count: 1,
        filter: {
          category: ["magic"],
          cardName: { contains: "飛天御剣流" },
          hasActivatedEffectMode: ["main", "flash"],
        },
      },
    ]);
    const borrow = reveal.beforeMoveSteps![0]!.action;
    expect(borrow.kind).toBe("borrow_magic_effect");
    if (borrow.kind !== "borrow_magic_effect") throw new Error("unreachable");
    expect(borrow.target).toEqual({ kind: "ref", stepId: "reveal" });
    expect(borrow.borrowModes).toEqual(["main", "flash"]);
  });

  it.each(["direct", "execute", "decline"] as const)(
    "実行(%s): 借用の選択解決まで公開を維持し、発揮後に手札とトラッシュへ移す",
    (choice) => {
      const donorDefinition = {
        ...MAIN_DONOR,
        effects: [
          {
            ...MAIN_DONOR.effects![0]!,
            steps: [
              ...MAIN_DONOR.effects![0]!.steps,
              ...(choice === "direct"
                ? []
                : [
                    {
                      action: {
                        kind: "count_increase" as const,
                        player: "self" as const,
                        amount: 1,
                      },
                      executionMode: "optional" as const,
                    },
                  ]),
            ],
          },
        ],
      };
      testDefs.set(donorDefinition.cardNo, donorDefinition);
      const r03Instance = createCardInstance(R03, {
        instanceId: "r03",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const donor = createCardInstance(MAIN_DONOR, {
        instanceId: "donor-deck",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      });
      const filler1 = createCardInstance(NON_MATCHING_DONOR, {
        instanceId: "filler-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      });
      const filler2 = createCardInstance(NON_MATCHING_DONOR, {
        instanceId: "filler-2",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      });
      const opponent = createCardInstance(OPPONENT_A, {
        instanceId: "opp-a",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
      });
      const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
      const state: GameState = {
        ...base,
        activePlayerId: ALICE,
        step: "main",
        cardInstances: [r03Instance, donor, filler1, filler2, opponent],
        players: base.players.map((p) =>
          p.id === ALICE ? { ...p, deckCount: 3 } : p
        ),
      };
      const before = state.players.find((p) => p.id === ALICE)!.handCount;

      const afterReveal = executeEffect({
        chainId: "test:bsrk01-magic-effect-borrow:425",
        state,
        effect,
        sourceInstanceId: "r03",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggeredLookup,
      });
      expect(afterReveal.pendingDeckReveal).not.toBeNull();
      expect(afterReveal.pendingDeckReveal!.continuation!.recordStepId).toBe(
        "reveal"
      );

      const pickAction = getLegalActions({
        state: afterReveal,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
      expect(pickAction).toBeDefined();

      let afterPick = applyLegalAction({
        state: afterReveal,
        action: pickAction,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggeredLookup,
        selectedDeckRevealCardIds: ["donor-deck"],
      }).state;

      if (choice !== "direct") {
        expect(afterPick.pendingStepOptionalChoice).not.toBeNull();
        for (const id of ["donor-deck", "filler-1", "filler-2"]) {
          expect(
            afterPick.cardInstances.find((c) => c.instanceId === id)?.zone
          ).toBe("revealed");
        }
        const select = getLegalActions({
          state: afterPick,
          actingPlayerId: ALICE,
          getCardDefinitionById,
        }).find(
          (a) =>
            a.kind === "resolve_pending_step_optional_choice" &&
            a.choice === choice
        )!;
        afterPick = applyLegalAction({
          state: afterPick,
          action: select,
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions: noTriggeredLookup,
        }).state;
        expect(afterPick.players.find((p) => p.id === ALICE)!.countValue).toBe(
          choice === "execute" ? 1 : 0
        );
      }

      expect(afterPick.pendingDeckReveal).toBeNull();
      expect(
        afterPick.log.some(
          (l) => l === "borrow_magic_effect:executed:TEST-RK01-DONOR-MAIN"
        )
      ).toBe(true);
      expect(
        afterPick.cardInstances.find((c) => c.instanceId === "opp-a")!.zone
      ).toBe("trash");
      expect(
        afterPick.cardInstances.find((c) => c.instanceId === "donor-deck")!.zone
      ).toBe("hand");
      expect(afterPick.players.find((p) => p.id === ALICE)!.handCount).toBe(
        before + 1
      );
      for (const id of ["filler-1", "filler-2"]) {
        expect(
          afterPick.cardInstances.find((c) => c.instanceId === id)!.zone
        ).toBe("trash");
      }
    }
  );
});

describe("BSRK01-X02 effects[0] textRef[3,4,5]: 手札/トラッシュの飛天御剣流(main/flash/stack)を相手の効果を受けずに借用発揮 → 破棄", () => {
  const effect = x02BorrowEffect();

  it("card-data: 非stub・OC(count>=8)+煌臨中条件・Lv1-2限定・borrowedEffectPreventionLevel:unpreventable(effect本体は防止可能なまま)・borrowModes[main,flash,stack]", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.executionMode).toBe("optional");
    expect(effect.applicability).toEqual({ level: { min: 1, max: 2 } });
    // 「相手の効果を受けない」の主語は借用先の被借用効果のみ。この borrow_magic_effect
    // 自体の発動可否 (=effect.preventionLevel) は通常どおり防止可能なまま
    // (adversarial verifier 2026-07-26 refute 対応: effect直下に置くと主語が広がりすぎる)。
    expect(effect.preventionLevel).toBeUndefined();
    expect(effect.condition).toEqual([
      { kind: "count_value", player: "self", min: 8 },
      { kind: "self_state", state: "advented" },
    ]);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("borrow_magic_effect");
    if (action.kind !== "borrow_magic_effect") throw new Error("unreachable");
    expect(action.borrowModes).toEqual(["main", "flash", "stack"]);
    expect(action.thenMove).toEqual({
      zone: "trash",
      fromZone: ["hand", "trash"],
    });
    expect(action.borrowedEffectPreventionLevel).toBe("unpreventable");
  });

  function stateWithImmuneOpponent(): {
    state: GameState;
    x02Id: string;
    donorId: string;
    oppId: string;
  } {
    // OC条件(カウント8以上)+煌臨中(表向き煌臨元≧1)を満たす。createCardInstance は
    // underCards を options として受け付けないため、生成後に spread で付与する
    // (bsrk01-x02-oc-advent-immunity.test.ts の placeKenshin と同型セットアップ)。
    const x02Instance = {
      ...createCardInstance(X02, {
        instanceId: "x02",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [{ cardInstanceId: "kenshin-src", role: "advent_source" }],
    };
    const donor = createCardInstance(FLASH_DONOR, {
      instanceId: "donor-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const opponent = createCardInstance(OPPONENT_A, {
      instanceId: "opp-a",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [x02Instance, donor, opponent],
      playerOverrides: [{ countValue: 8 }, {}],
    });
    // 相手 (Bob) 視点で「相手 (Alice) の効果を受けない」を opp-a へ付与する
    // (effect_immunity target:self、grantor=Bob)。X02 の借用実行がこの免疫を
    // 貫通するかどうかで unpreventable 委譲の有無を比較する。
    const stateWithImmunity = executeEffect({
      chainId: "test:bsrk01-magic-effect-borrow:569",
      state: baseState,
      effect: {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
      },
      sourceInstanceId: "opp-a",
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });
    return {
      state: stateWithImmunity,
      x02Id: "x02",
      donorId: "donor-trash",
      oppId: "opp-a",
    };
  }

  it("実行: 相手が免疫でも borrowedEffectPreventionLevel:unpreventable の委譲により借用先の破壊が通る", () => {
    const { state, x02Id, donorId, oppId } = stateWithImmuneOpponent();

    const afterResolved = executeEffect({
      chainId: "test:bsrk01-magic-effect-borrow:599",
      state,
      effect,
      sourceInstanceId: x02Id,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      targetInstanceIds: [donorId],
    });

    const after = flushPendingLeaves(afterResolved, getCardDefinitionById);
    expect(after.cardInstances.find((c) => c.instanceId === oppId)!.zone).toBe(
      "trash"
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === donorId)!.zone
    ).toBe("trash");
  });

  it("対照: borrowedEffectPreventionLevel を外す (unpreventable 委譲なし) と同じ免疫で借用先の破壊は防がれる", () => {
    const { state, x02Id, donorId, oppId } = stateWithImmuneOpponent();
    const plainAction = { ...effect.steps[0]!.action };
    if (plainAction.kind !== "borrow_magic_effect") {
      throw new Error("unreachable");
    }
    delete plainAction.borrowedEffectPreventionLevel;
    const plainEffect = {
      ...effect,
      steps: [{ ...effect.steps[0]!, action: plainAction }],
    };

    const after = executeEffect({
      chainId: "test:bsrk01-magic-effect-borrow:630",
      state,
      effect: plainEffect,
      sourceInstanceId: x02Id,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      targetInstanceIds: [donorId],
    });

    expect(after.cardInstances.find((c) => c.instanceId === oppId)!.zone).toBe(
      "field"
    );
  });
});
