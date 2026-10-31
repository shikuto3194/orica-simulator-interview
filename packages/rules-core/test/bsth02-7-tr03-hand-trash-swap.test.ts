/**
 * BSTH02.7-TR03(A) アリスの人形工房【神秘】Lv1『自分のメインステップ終了時』
 * (engine-atomic-hand-trash-swap-legal-action):
 * 手札/手元の黄1色カード1枚とトラッシュの導界者ネクサス/幻想&導魔・動玩スピリット/ネクサス
 * 1枚を入れ替えられる。汎用 `queue_hand_trash_swap` action + `swap_hand_trash` /
 * 発揮後の辞退拒否を含む atomic 交換パターンを検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const nexusDef = card("BSTH02.7-TR03(A)");

// 手札/手元側候補: 黄1色のカード（category は不問）。
const yellowHandCard: CardDefinition = {
  cardNo: "HTS-TEST-YELLOW-HAND",
  name: "黄1色テストカード",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

// 手札/手元側の非適合カード（黄以外の多色）。
const nonMatchingHandCard: CardDefinition = {
  ...yellowHandCard,
  cardNo: "HTS-TEST-NONYELLOW-HAND",
  colors: ["blue", "green"],
};

// トラッシュ側候補（分岐1）: 黄の導界者ネクサス。
const trashDoukaishaNexus: CardDefinition = {
  cardNo: "HTS-TEST-TRASH-NEXUS",
  name: "導界者ネクサステスト",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "導界者",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

// トラッシュ側候補（分岐2）: 系統「幻想」&「導魔」を持つスピリット。
const trashGensouDouma: CardDefinition = {
  cardNo: "HTS-TEST-TRASH-SPIRIT",
  name: "幻想導魔スピリットテスト",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  tribe: "幻想・導魔",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

// トラッシュ側の非適合カード（どちらの分岐にも合致しない）。
const nonMatchingTrashCard: CardDefinition = {
  ...trashGensouDouma,
  cardNo: "HTS-TEST-TRASH-NONMATCH",
  tribe: "地球",
};

const testDefs = [
  nexusDef,
  yellowHandCard,
  nonMatchingHandCard,
  trashDoukaishaNexus,
  trashGensouDouma,
  nonMatchingTrashCard,
];
const getDef = (id: string): CardDefinition | undefined =>
  testDefs.find((d) => d.cardNo === id) ?? cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

function baseState(overrides: {
  handDef?: CardDefinition;
  handZone?: "hand" | "set_aside";
  trashDef?: CardDefinition;
}): GameState {
  const nexus = createCardInstance(nexusDef, {
    instanceId: "nexus-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const cardInstances = [nexus];
  if (overrides.handDef) {
    cardInstances.push(
      createCardInstance(overrides.handDef, {
        instanceId: "hand-1",
        ownerPlayerId: ALICE,
        zone: overrides.handZone ?? "hand",
      })
    );
  }
  if (overrides.trashDef) {
    cardInstances.push(
      createCardInstance(overrides.trashDef, {
        instanceId: "trash-1",
        ownerPlayerId: ALICE,
        zone: "trash",
      })
    );
  }
  return createEmptyGameState({ cardInstances });
}

describe("BSTH02.7-TR03(A) アリスの人形工房【神秘】手札/手元⇔トラッシュ入替", () => {
  const effect = nexusDef.effects![0]!;

  it("effect DSL: phase(main,end,self) + optional + 両側 cards_in_zone 条件 + queue_hand_trash_swap", () => {
    expect(effect.timing).toEqual({
      kind: "phase",
      step: "main",
      whose: "self",
      subPhase: "end",
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.condition).toHaveLength(2);
    expect(effect.steps[0]!.action.kind).toBe("queue_hand_trash_swap");
  });

  it("両側に候補があるとき pendingHandTrashSwapChoice が立つ（黄1色手札 × 導界者ネクサス）", () => {
    const state = baseState({
      handDef: yellowHandCard,
      trashDef: trashDoukaishaNexus,
    });
    const after = executeEffect({
      chainId: "test:bsth02-7-tr03-hand-trash-swap:162",
      state,
      effect,
      sourceInstanceId: "nexus-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(after.pendingHandTrashSwapChoice).not.toBeNull();
    expect(
      after.pendingHandTrashSwapChoice!.outgoingCandidateInstanceIds
    ).toEqual(["hand-1"]);
    expect(
      after.pendingHandTrashSwapChoice!.incomingCandidateInstanceIds
    ).toEqual(["trash-1"]);
  });

  it("トラッシュ側候補が分岐2（幻想&導魔スピリット）でも候補になる", () => {
    const state = baseState({
      handDef: yellowHandCard,
      trashDef: trashGensouDouma,
    });
    const after = executeEffect({
      chainId: "test:bsth02-7-tr03-hand-trash-swap:184",
      state,
      effect,
      sourceInstanceId: "nexus-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      after.pendingHandTrashSwapChoice?.incomingCandidateInstanceIds
    ).toEqual(["trash-1"]);
  });

  it("手札側に黄1色候補が無ければ発火しない（condition gate）", () => {
    const state = baseState({
      handDef: nonMatchingHandCard,
      trashDef: trashDoukaishaNexus,
    });
    const after = executeEffect({
      chainId: "test:bsth02-7-tr03-hand-trash-swap:202",
      state,
      effect,
      sourceInstanceId: "nexus-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(after.pendingHandTrashSwapChoice).toBeNull();
  });

  it("トラッシュ側に適合候補が無ければ発火しない（condition gate）", () => {
    const state = baseState({
      handDef: yellowHandCard,
      trashDef: nonMatchingTrashCard,
    });
    const after = executeEffect({
      chainId: "test:bsth02-7-tr03-hand-trash-swap:218",
      state,
      effect,
      sourceInstanceId: "nexus-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(after.pendingHandTrashSwapChoice).toBeNull();
  });

  it("[board] swap_hand_trash 適用: 手札カードがトラッシュへ、トラッシュカードが手札へ、atomic に1回で交換", () => {
    const state = baseState({
      handDef: yellowHandCard,
      trashDef: trashDoukaishaNexus,
    });
    const queued = executeEffect({
      chainId: "test:bsth02-7-tr03-hand-trash-swap:234",
      state,
      effect,
      sourceInstanceId: "nexus-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const pendingId = queued.pendingHandTrashSwapChoice!.pendingId;

    const legalActions = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const swaps = legalActions.filter((a) => a.kind === "swap_hand_trash");
    expect(swaps).toHaveLength(1);
    const declines = legalActions.filter(
      (a) => a.kind === "decline_hand_trash_swap"
    );
    expect(declines).toHaveLength(0);

    const result = applyLegalAction({
      state: queued,
      action: {
        kind: "swap_hand_trash",
        actionId: "test:swap-hand-trash",
        can: true,
        reason: "test",
        actingPlayerId: ALICE,
        pendingId,
        sourceInstanceId: "nexus-1",
        sourceCardNo: nexusDef.cardNo,
        outgoingCardInstanceId: "hand-1",
        outgoingCardNo: yellowHandCard.cardNo,
        incomingCardInstanceId: "trash-1",
        incomingCardNo: trashDoukaishaNexus.cardNo,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });

    const after = result.state;
    expect(after.pendingHandTrashSwapChoice).toBeNull();
    const outgoing = after.cardInstances.find(
      (c) => c.instanceId === "hand-1"
    )!;
    expect(outgoing.zone).toBe("trash");
    const incoming = after.cardInstances.find(
      (c) => c.instanceId === "trash-1"
    )!;
    expect(incoming.zone).toBe("hand");
    expect(after.log).toContain("swap_hand_trash:nexus-1:hand-1<->trash-1");
  });

  it("[board] 出す側が手元(set_aside)のときは入る側も手元へ戻る（1対1物理交換）", () => {
    const state = baseState({
      handDef: yellowHandCard,
      handZone: "set_aside",
      trashDef: trashDoukaishaNexus,
    });
    const queued = executeEffect({
      chainId: "test:bsth02-7-tr03-hand-trash-swap:297",
      state,
      effect,
      sourceInstanceId: "nexus-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const pendingId = queued.pendingHandTrashSwapChoice!.pendingId;

    const result = applyLegalAction({
      state: queued,
      action: {
        kind: "swap_hand_trash",
        actionId: "test:swap-hand-trash-set-aside",
        can: true,
        reason: "test",
        actingPlayerId: ALICE,
        pendingId,
        sourceInstanceId: "nexus-1",
        sourceCardNo: nexusDef.cardNo,
        outgoingCardInstanceId: "hand-1",
        outgoingCardNo: yellowHandCard.cardNo,
        incomingCardInstanceId: "trash-1",
        incomingCardNo: trashDoukaishaNexus.cardNo,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });

    const incoming = result.state.cardInstances.find(
      (c) => c.instanceId === "trash-1"
    )!;
    expect(incoming.zone).toBe("set_aside");
  });

  it("[board] decline_hand_trash_swap 適用: 発揮後の辞退は拒否し盤面を維持する", () => {
    const state = baseState({
      handDef: yellowHandCard,
      trashDef: trashDoukaishaNexus,
    });
    const queued = executeEffect({
      chainId: "test:bsth02-7-tr03-hand-trash-swap:338",
      state,
      effect,
      sourceInstanceId: "nexus-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const pendingId = queued.pendingHandTrashSwapChoice!.pendingId;

    expect(() =>
      applyLegalAction({
        state: queued,
        action: {
          kind: "decline_hand_trash_swap",
          actionId: "test:decline-hand-trash-swap",
          can: true,
          reason: "test",
          actingPlayerId: ALICE,
          pendingId,
          sourceInstanceId: "nexus-1",
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => undefined,
      })
    ).toThrow("入れ替えの発揮後は辞退できません");

    const after = queued;
    expect(after.pendingHandTrashSwapChoice).not.toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "hand-1")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "trash-1")!.zone
    ).toBe("trash");
  });

  it("pending 中は BOB 側から見て 交換アクションが見えない（actingPlayerId 限定）", () => {
    const state = baseState({
      handDef: yellowHandCard,
      trashDef: trashDoukaishaNexus,
    });
    const queued = executeEffect({
      chainId: "test:bsth02-7-tr03-hand-trash-swap:378",
      state,
      effect,
      sourceInstanceId: "nexus-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const legalActionsForBob = getLegalActions({
      state: queued,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(
      legalActionsForBob.filter(
        (a) =>
          a.kind === "swap_hand_trash" || a.kind === "decline_hand_trash_swap"
      )
    ).toHaveLength(0);
  });
});
