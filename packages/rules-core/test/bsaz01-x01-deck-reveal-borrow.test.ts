/**
 * BSAZ01-X01「KG-6 スレイプニール[コンフォーマルパワーアシスト]」effects textRef[3,4]:
 * 「Lv1-Lv2『このスピリットの煌臨/アタック/ブロック時』ターンに1回、自分はデッキの上から
 * 5枚オープンでき、その中の系統：「地球」を持つマジックカード1枚のフラッシュ効果を
 * ただちに発揮する。その後、効果を発揮したマジックカードはフィールドに置き、残ったカードは
 * 破棄する。」
 *
 * X02(BSAZ01-X02、bsaz01-x02-effect-borrowing.test.ts)の borrow_magic_effect は
 * 手札/フィールドの既存カードを filter で直接対象化するが、X01 はピック元がデッキという
 * 非同期 pending 経路のため、beforeMoveSteps から公開中の pick 結果を参照する。
 * 借用効果内の選択を完了してから、選んだカードの配置と残りの破棄を行う。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const X01 = cardNoMap.get("BSAZ01-X01")!;
const noTriggeredLookup = () => [];

const ALICE = "alice";
const BOB = "bob";

function donorDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: `テスト借用元 ${cardNo}`,
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "地球",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
        textRef: [0],
      },
    ],
    ...overrides,
  } as CardDefinition;
}

const DONOR_ELIGIBLE = donorDef("TEST-X01-DONOR-ELIGIBLE");
const FILLER = donorDef("TEST-X01-FILLER", {
  printedCategory: "spirit",
  tribe: "闘神",
  effects: [],
});
const testDefs = new Map<string, CardDefinition>(
  [DONOR_ELIGIBLE, FILLER].map((d) => [d.cardNo, d])
);
const getCardDefinitionById = (id: string) =>
  cardNoMap.get(id) ?? testDefs.get(id);

function revealEffect() {
  return X01.effects!.find((e) =>
    e.steps.some((s) => s.action.kind === "deck_reveal")
  )!;
}

function baseState(): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const x01Instance = createCardInstance(X01, {
    instanceId: "x01",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const donor = createCardInstance(DONOR_ELIGIBLE, {
    instanceId: "donor-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  // f1-f4 は reveal(5枚)の残りを構成、f5 は借用先の draw 1 が引く分の在庫
  // (reveal で 5 枚とも消費されると draw 側が空撃ちになり検証が汚れるため)
  const fillers = ["f1", "f2", "f3", "f4", "f5"].map((id) =>
    createCardInstance(FILLER, {
      instanceId: id,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    })
  );
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    cardInstances: [x01Instance, donor, ...fillers],
    players: base.players.map((p) =>
      p.id === ALICE ? { ...p, deckCount: 6 } : p
    ),
  };
}

describe("BSAZ01-X01 textRef[3,4]: デッキ5枚オープン→地球マジック1枚のフラッシュ効果借用", () => {
  const effect = revealEffect();

  it("借用効果の任意選択中は配置・残札破棄をせず、解決後に移動する", () => {
    const optionalDonor = donorDef("TEST-X01-OPTIONAL", {
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            { executionMode: "optional", action: { kind: "draw", count: 1 } },
          ],
          textRef: [0],
        },
      ],
    });
    const getDef = (id: string) =>
      id === optionalDonor.cardNo ? optionalDonor : getCardDefinitionById(id);
    const state = baseState();
    const initial = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "donor-1"
          ? { ...c, definitionId: optionalDonor.cardNo }
          : c
      ),
    };
    let after = executeEffect({
      chainId: "test:bsaz01-x01-deck-reveal-borrow:142",
      state: initial,
      effect,
      sourceInstanceId: "x01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const pick = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    after = applyLegalAction({
      state: after,
      action: pick,
      selectedDeckRevealCardIds: ["donor-1"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    }).state;
    expect(after.pendingStepOptionalChoice).not.toBeNull();
    for (const id of ["donor-1", "f1", "f2", "f3", "f4"])
      expect(after.cardInstances.find((c) => c.instanceId === id)?.zone).toBe(
        "revealed"
      );
    const execute = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    )!;
    after = applyLegalAction({
      state: after,
      action: execute,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    }).state;
    expect(
      after.cardInstances.find((c) => c.instanceId === "donor-1")?.zone
    ).toBe("field");
    for (const id of ["f1", "f2", "f3", "f4"])
      expect(after.cardInstances.find((c) => c.instanceId === id)?.zone).toBe(
        "trash"
      );
    expect(after.cardInstances.find((c) => c.instanceId === "f5")?.zone).toBe(
      "hand"
    );
    expect(after.pendingDeckReveal).toBeNull();
    expect(after.pendingStepOptionalChoice).toBeNull();
  });

  it("card-data: 非stub・任意(executionMode:optional、原文「オープンでき」)・per_instance/turn・deck_reveal+borrow_magic_effect(ref)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.id).toBe("reveal");
    const reveal = effect.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind !== "deck_reveal") throw new Error("unreachable");
    expect(reveal.revealCount).toBe(5);
    expect(reveal.remainder).toBe("trash");
    expect(reveal.picks).toEqual([
      {
        mandatory: true,
        count: 1,
        destination: "field",
        filter: {
          category: ["magic"],
          tribes: ["地球"],
          hasActivatedEffectMode: ["flash"],
        },
      },
    ]);

    const borrow = reveal.beforeMoveSteps![0]!.action;
    expect(borrow.kind).toBe("borrow_magic_effect");
    if (borrow.kind !== "borrow_magic_effect") throw new Error("unreachable");
    expect(borrow.target).toEqual({ kind: "ref", stepId: "reveal" });
    expect(borrow.borrowModes).toEqual(["flash"]);
    expect(borrow.thenMove).toBeUndefined();
  });

  it("実行: ピックした地球マジックのフラッシュ効果(draw)が発揮され、フィールドに置かれる。残りはトラッシュ", () => {
    const state = baseState();
    const afterReveal = executeEffect({
      chainId: "test:bsaz01-x01-deck-reveal-borrow:232",
      state,
      effect,
      sourceInstanceId: "x01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(afterReveal.pendingDeckReveal).not.toBeNull();
    expect(afterReveal.pendingDeckReveal!.continuation).toBeDefined();
    expect(afterReveal.pendingDeckReveal!.continuation!.recordStepId).toBe(
      "reveal"
    );

    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();

    const before = state.players.find((p) => p.id === ALICE)!.handCount;
    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pickAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      selectedDeckRevealCardIds: ["donor-1"],
    }).state;

    expect(afterPick.pendingDeckReveal).toBeNull();
    const donor = afterPick.cardInstances.find(
      (c) => c.instanceId === "donor-1"
    )!;
    expect(donor.zone).toBe("field");
    expect(
      afterPick.log.some(
        (l) => l === "borrow_magic_effect:executed:TEST-X01-DONOR-ELIGIBLE"
      )
    ).toBe(true);
    // 借用元自身のdraw 1だけ手札が増える。donorは手札を経由せず配置される。
    expect(afterPick.players.find((p) => p.id === ALICE)!.handCount).toBe(
      before + 1
    );
    for (const id of ["f1", "f2", "f3", "f4"]) {
      expect(
        afterPick.cardInstances.find((c) => c.instanceId === id)!.zone
      ).toBe("trash");
    }
  });

  it("実行: 地球マジックが1枚もないとき pick 0件を確定するとno-op、5枚すべてトラッシュ", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const x01Instance = createCardInstance(X01, {
      instanceId: "x01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const fillers = ["f1", "f2", "f3", "f4", "f5"].map((id) =>
      createCardInstance(FILLER, {
        instanceId: id,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [x01Instance, ...fillers],
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, deckCount: 5 } : p
      ),
    };

    const afterReveal = executeEffect({
      chainId: "test:bsaz01-x01-deck-reveal-borrow:309",
      state,
      effect,
      sourceInstanceId: "x01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(afterReveal.pendingDeckReveal).not.toBeNull();

    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();

    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pickAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      selectedDeckRevealCardIds: [],
    }).state;

    expect(afterPick.pendingDeckReveal).toBeNull();
    for (const id of ["f1", "f2", "f3", "f4", "f5"]) {
      expect(
        afterPick.cardInstances.find((c) => c.instanceId === id)!.zone
      ).toBe("trash");
    }
    expect(
      afterPick.log.some((l) => l.startsWith("borrow_magic_effect:"))
    ).toBe(false);
  });
});
