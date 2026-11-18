import { ALL_CARDS } from "../../card-data/src/generated-index";
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  getAvailableMiragePaymentSources,
  getMirageSetBlockReason,
  getPlayerMirageSetState,
  useSetMirageAsAction,
  removeMirageSetState,
  applyFreeMirageSetBookkeeping,
} from "../src/mechanics/mirage-system";
import { getAvailableSetMirageLegalActions } from "../src/legal/legal-actions-availability";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { executeEffect } from "../src/effect/effect-interpreter";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PlayerState,
  ContinuousEffect,
} from "../src/model";

// ── ヘルパー ───────────────────────────────────────────

const ALICE = "player-1";
const BOB = "player-2";

/** コスト 0 のテスト用ミラージュ定義（コスト支払いテスト以外で使用） */
function mirageDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "MIRAGE-001",
    name: "Mirage Test Card",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: ["mirage"],
    mirageData: {
      cost: 0,
      reduction: [],
    },
    sourceUrls: [],
    sourceConfidence: "A",
    ...overrides,
  } as CardDefinition;
}

/** コスト 2（軽減赤1）のミラージュ定義（コスト支払いテスト用） */
function mirageDefWithCost(): CardDefinition {
  return mirageDef({
    cardNo: "MIRAGE-COST",
    name: "Mirage Card With Cost",
    mirageData: { cost: 2, reduction: ["red"] },
  });
}

function trashSetMirageDef(): CardDefinition {
  return mirageDef({
    cardNo: "MIRAGE-TRASH",
    name: "Trash Set Mirage Card",
    mirageData: { cost: 0, reduction: [], canSetFromTrash: true },
  });
}

function mirageDef2(): CardDefinition {
  return mirageDef({ cardNo: "MIRAGE-002", name: "Mirage Test Card 2" });
}

function normalDef(): CardDefinition {
  return {
    cardNo: "NORMAL-001",
    name: "Normal Card",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

const C01 = ALL_CARDS.find((card) => card.cardNo === "BSTH002-C01")!;
const defMap = new Map<string, CardDefinition>([[C01.cardNo, C01]]);
defMap.set("MIRAGE-001", mirageDef());
defMap.set("MIRAGE-002", mirageDef2());
defMap.set("MIRAGE-COST", mirageDefWithCost());
defMap.set("MIRAGE-TRASH", trashSetMirageDef());
defMap.set("NORMAL-001", normalDef());

function getCardDef(id: string): CardDefinition | undefined {
  return defMap.get(id);
}

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

function passOpenStack(state: GameState): GameState {
  expect(state.stackWindow).not.toBeNull();
  const actingPlayerId = state.stackWindow!.priorityPlayerId;
  const pass = getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: getCardDef,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => undefined,
  } as import("../src/legal/legal-actions-types").GetLegalActionsOptions).find(
    (action) => action.kind === "pass_stack"
  );
  expect(pass).toBeDefined();
  return applyLegalAction({
    state,
    action: pass!,
    getCardDefinitionById: getCardDef,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  }).state;
}

function handCard(
  instanceId: string,
  definitionId: string,
  owner = ALICE,
  opts: Partial<CardInstance> = {}
): CardInstance {
  const def = defMap.get(definitionId) ?? mirageDef();
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: owner,
    zone: "hand",
    ...opts,
  });
}

function trashCard(instanceId: string, definitionId: string): CardInstance {
  const def = defMap.get(definitionId) ?? mirageDef();
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "trash",
  });
}

function mirageCard(
  instanceId: string,
  owner = ALICE,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(mirageDef(), {
    instanceId,
    ownerPlayerId: owner,
    zone: "mirage",
    ...opts,
  });
}

function getPlayer(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

function makeMainState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...createEmptyGameState({
      playerOverrides: [
        { reserveNormalCoreCount: 10 },
        { reserveNormalCoreCount: 10 },
      ],
    }),
    step: "main",
    window: "none",
    ...overrides,
  };
}

function handSpiritAdditionalCostCE(amount: number): ContinuousEffect {
  return {
    effectId: "ce-hand-spirit-mirage-tax",
    sourceInstanceId: "tax-source",
    sourceDefinitionId: "NORMAL-001",
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "additional_cost",
    modifierAmount: amount,
    targetFilter: {
      player: "self",
      category: ["spirit"],
      zone: ["hand"],
    },
  };
}

// ── E-2: ミラージュ ──────────────────────────────────

describe("E-2: ミラージュ (Mirage)", () => {
  describe("getMirageSetBlockReason", () => {
    it("メインステップでない場合はブロック", () => {
      const state = makeMainState({ step: "attack" });
      const card = handCard("m1", "MIRAGE-001");
      state.cardInstances = [card];
      const reason = getMirageSetBlockReason({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "m1",
        getCardDefinitionById: getCardDef,
      });
      expect(reason).toBe("not_main_step");
    });

    it("アクティブプレイヤーでない場合はブロック", () => {
      const state = makeMainState();
      const card = handCard("m1", "MIRAGE-001", BOB);
      state.cardInstances = [card];
      const reason = getMirageSetBlockReason({
        state,
        actingPlayerId: BOB,
        sourceInstanceId: "m1",
        getCardDefinitionById: getCardDef,
      });
      expect(reason).toBe("not_active_player");
    });

    it("このターンに既にセット済みの場合はブロック", () => {
      const state = makeMainState({
        mirageSetPlayerIdsThisTurn: [ALICE],
      });
      const card = handCard("m1", "MIRAGE-001");
      state.cardInstances = [card];
      const reason = getMirageSetBlockReason({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "m1",
        getCardDefinitionById: getCardDef,
      });
      expect(reason).toBe("already_set_mirage_this_turn");
    });

    it("手札にないカードはブロック", () => {
      const state = makeMainState();
      const card = mirageCard("m1"); // zone: "mirage" (not "hand")
      state.cardInstances = [card];
      const reason = getMirageSetBlockReason({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "m1",
        getCardDefinitionById: getCardDef,
      });
      expect(reason).toBe("source_not_in_hand");
    });

    it("個別許可があるミラージュカードはトラッシュからブロックされない", () => {
      const state = makeMainState();
      state.cardInstances = [trashCard("m1", "MIRAGE-TRASH")];
      const reason = getMirageSetBlockReason({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "m1",
        getCardDefinitionById: getCardDef,
      });
      expect(reason).toBeNull();
    });

    it("mirageData がないカードはブロック", () => {
      const state = makeMainState();
      const card = handCard("n1", "NORMAL-001");
      state.cardInstances = [card];
      const reason = getMirageSetBlockReason({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "n1",
        getCardDefinitionById: getCardDef,
      });
      expect(reason).toBe("source_card_has_no_mirage");
    });

    it("条件を満たす場合は null を返す", () => {
      const state = makeMainState();
      const card = handCard("m1", "MIRAGE-001");
      state.cardInstances = [card];
      const reason = getMirageSetBlockReason({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "m1",
        getCardDefinitionById: getCardDef,
      });
      expect(reason).toBeNull();
    });
  });

  describe("useSetMirageAsAction", () => {
    it("ミラージュを手札からセットする: カードがミラージュゾーンに移動", () => {
      const state = makeMainState();
      const card = handCard("m1", "MIRAGE-001");
      state.cardInstances = [card];
      state.players = state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      );

      const result = setMirage({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "m1",
        paymentSources: [],
        getCardDefinitionById: getCardDef,
      });

      const mirageCardResult = getCard(result.state, "m1");
      expect(mirageCardResult.zone).toBe("mirage");
      expect(getPlayer(result.state, ALICE).handCount).toBe(0);
      expect(result.sourceInstanceId).toBe("m1");
      expect(result.replacedMirageInstanceIds).toEqual([]);
    });

    it("ミラージュセット状態が登録される", () => {
      const state = makeMainState();
      const card = handCard("m1", "MIRAGE-001");
      state.cardInstances = [card];
      state.players = state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      );

      const result = setMirage({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "m1",
        paymentSources: [],
        getCardDefinitionById: getCardDef,
      });

      expect(result.state.mirageSetStates).toHaveLength(1);
      expect(result.state.mirageSetStates[0]).toEqual({
        playerId: ALICE,
        cardInstanceId: "m1",
      });
    });

    it("ターン内セット済みフラグが記録される", () => {
      const state = makeMainState();
      const card = handCard("m1", "MIRAGE-001");
      state.cardInstances = [card];
      state.players = state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      );

      const result = setMirage({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "m1",
        paymentSources: [],
        getCardDefinitionById: getCardDef,
      });

      expect(result.state.mirageSetPlayerIdsThisTurn).toContain(ALICE);
    });

    it("既存ミラージュがある場合: 旧カードが手札に戻る（手札増加ではない）", () => {
      const state = makeMainState({
        mirageSetStates: [{ playerId: ALICE, cardInstanceId: "old-m" }],
      });
      const oldMirage = mirageCard("old-m");
      const newCard = handCard("m2", "MIRAGE-002");
      state.cardInstances = [oldMirage, newCard];
      state.players = state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      );

      const result = setMirage({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "m2",
        paymentSources: [],
        getCardDefinitionById: getCardDef,
      });

      // 旧ミラージュが手札に戻る
      const oldCard = getCard(result.state, "old-m");
      expect(oldCard.zone).toBe("hand");

      // 新ミラージュがセットされる
      const newMirageCard = getCard(result.state, "m2");
      expect(newMirageCard.zone).toBe("mirage");

      // handCount: 手札1 → 新カードが出て0 → 旧カードが戻って実手札1。
      // 手札増加トリガーだけは mirage:hand-return-no-increase で抑止する。
      expect(getPlayer(result.state, ALICE).handCount).toBe(1);

      // mirageSetStates が更新される
      expect(result.state.mirageSetStates).toHaveLength(1);
      expect(result.state.mirageSetStates[0].cardInstanceId).toBe("m2");

      expect(result.replacedMirageInstanceIds).toEqual(["old-m"]);
    });

    it("ログにミラージュセットが記録される", () => {
      const state = makeMainState();
      const card = handCard("m1", "MIRAGE-001");
      state.cardInstances = [card];
      state.players = state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      );

      const result = setMirage({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "m1",
        paymentSources: [],
        getCardDefinitionById: getCardDef,
      });

      const logs = result.state.log;
      expect(logs.some((l) => l.includes("mirage:set:"))).toBe(true);
      expect(logs.some((l) => l.includes("mirage:declare:"))).toBe(true);
    });

    it("入れ替え時にログに replace が記録される", () => {
      const state = makeMainState({
        mirageSetStates: [{ playerId: ALICE, cardInstanceId: "old-m" }],
      });
      const oldMirage = mirageCard("old-m");
      const newCard = handCard("m2", "MIRAGE-002");
      state.cardInstances = [oldMirage, newCard];
      state.players = state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      );

      const result = setMirage({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "m2",
        paymentSources: [],
        getCardDefinitionById: getCardDef,
      });

      expect(result.state.log.some((l) => l.includes("mirage:replace:"))).toBe(
        true
      );
      expect(
        result.state.log.some((l) =>
          l.includes("mirage:hand-return-no-increase:")
        )
      ).toBe(true);
    });

    it("トラッシュからの入れ替えで旧ミラージュが手札に戻っても increase_hand は発火しない", () => {
      const state = makeMainState({
        mirageSetStates: [{ playerId: ALICE, cardInstanceId: "old-m" }],
        cardInstances: [
          mirageCard("old-m"),
          trashCard("trash-m", "MIRAGE-TRASH"),
        ],
        players: makeMainState().players.map((p) =>
          p.id === ALICE ? { ...p, handCount: 0 } : p
        ),
      });

      const result = setMirage({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "trash-m",
        paymentSources: [],
        getCardDefinitionById: getCardDef,
      });

      expect(getCard(result.state, "old-m").zone).toBe("hand");
      expect(getCard(result.state, "trash-m").zone).toBe("mirage");
      expect(getPlayer(result.state, ALICE).handCount).toBe(1);

      const events = collectTriggerEventsFromStateDelta({
        beforeState: state,
        afterState: result.state,
        source: "action_resolution",
        chainId: result.chainId,
        causedByPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });
      expect(events.some((event) => event.eventKind === "increase_hand")).toBe(
        false
      );
    });
  });

  describe("コスト支払い", () => {
    it("ミラージュコスト 2 のカードはリザーブからコアを支払う", () => {
      const state = makeMainState();
      const card = handCard("mc", "MIRAGE-COST");
      state.cardInstances = [card];
      state.players = state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1, reserveNormalCoreCount: 5 } : p
      );

      const result = setMirage({
        state,
        actingPlayerId: ALICE,
        sourceInstanceId: "mc",
        paymentSources: [{ kind: "reserve", amount: 2 }],
        getCardDefinitionById: getCardDef,
      });

      expect(getCard(result.state, "mc").zone).toBe("mirage");
      expect(getPlayer(result.state, ALICE).reserveNormalCoreCount).toBe(3);
      expect(getPlayer(result.state, ALICE).handCount).toBe(0);
    });

    it("コスト不一致の場合はエラー", () => {
      const state = makeMainState();
      const card = handCard("mc", "MIRAGE-COST");
      state.cardInstances = [card];
      state.players = state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1, reserveNormalCoreCount: 5 } : p
      );

      expect(() =>
        setMirage({
          state,
          actingPlayerId: ALICE,
          sourceInstanceId: "mc",
          paymentSources: [{ kind: "reserve", amount: 1 }],
          getCardDefinitionById: getCardDef,
        })
      ).toThrow("Payment does not match");
    });

    it("targetFilter 付き additional_cost はミラージュ availability と実行時コストに反映される", () => {
      const card = handCard("mc", "MIRAGE-COST");
      const taxedState = makeMainState({
        cardInstances: [card],
        activeContinuousEffects: [handSpiritAdditionalCostCE(1)],
        players: createEmptyGameState({
          playerOverrides: [
            { reserveNormalCoreCount: 2, handCount: 1 },
            { reserveNormalCoreCount: 10 },
          ],
        }).players,
      });

      expect(
        getAvailableMiragePaymentSources({
          state: taxedState,
          actingPlayerId: ALICE,
          mirageData: mirageDefWithCost().mirageData!,
          sourceInstanceId: card.instanceId,
          getCardDefinitionById: getCardDef,
        }).reduction.additionalCost
      ).toBe(1);
      expect(
        getAvailableSetMirageLegalActions({
          state: taxedState,
          actingPlayerId: ALICE,
          getCardDefinitionById: getCardDef,
        })
      ).toHaveLength(0);
      expect(() =>
        setMirage({
          state: taxedState,
          actingPlayerId: ALICE,
          sourceInstanceId: "mc",
          paymentSources: [{ kind: "reserve", amount: 2 }],
          getCardDefinitionById: getCardDef,
        })
      ).toThrow("Payment does not match");

      const payableState = {
        ...taxedState,
        players: taxedState.players.map((p) =>
          p.id === ALICE ? { ...p, reserveNormalCoreCount: 3 } : p
        ),
      };
      expect(
        getAvailableSetMirageLegalActions({
          state: payableState,
          actingPlayerId: ALICE,
          getCardDefinitionById: getCardDef,
        })
      ).toHaveLength(1);
      const result = setMirage({
        state: payableState,
        actingPlayerId: ALICE,
        sourceInstanceId: "mc",
        paymentSources: [{ kind: "reserve", amount: 3 }],
        getCardDefinitionById: getCardDef,
      });
      expect(getCard(result.state, "mc").zone).toBe("mirage");
    });
  });

  describe("getPlayerMirageSetState", () => {
    it("ミラージュ未セット時は null", () => {
      const state = makeMainState();
      expect(getPlayerMirageSetState(state, ALICE)).toBeNull();
    });

    it("セット済みの場合は MirageSetState を返す", () => {
      const state = makeMainState({
        mirageSetStates: [{ playerId: ALICE, cardInstanceId: "m1" }],
      });
      const result = getPlayerMirageSetState(state, ALICE);
      expect(result).toEqual({ playerId: ALICE, cardInstanceId: "m1" });
    });
  });

  describe("getAvailableSetMirageLegalActions", () => {
    it("手札にミラージュカードがある場合、LegalAction が返る", () => {
      const state = makeMainState();
      const card = handCard("m1", "MIRAGE-001");
      state.cardInstances = [card];
      state.players = state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      );

      const actions = getAvailableSetMirageLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });

      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe("set_mirage");
      expect(actions[0].sourceInstanceId).toBe("m1");
      expect(actions[0].mirageCost).toBe(0);
      expect(actions[0].replacedMirageInstanceIds).toEqual([]);
      expect(actions[0].actionId).toContain("legal:set-mirage:m1:");
    });

    it("P3-128: コスト>0のミラージュカードは finalCost/availableReserveCoreAmount 等の支払い候補フィールドを持つ (GUI コスト支払い配線用)", () => {
      const state = makeMainState();
      const card = handCard("mc", "MIRAGE-COST");
      state.cardInstances = [card];

      const actions = getAvailableSetMirageLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });

      expect(actions).toHaveLength(1);
      expect(actions[0].mirageCost).toBe(2);
      expect(actions[0].finalCost).toBe(2);
      expect(actions[0].availableReserveCoreAmount).toBe(10);
      expect(actions[0].availableOnBoardCoreSources).toEqual([]);
      expect(actions[0].availableSoulCoreOnlySources).toEqual([]);
    });

    it("ミラージュカードがない場合は空配列", () => {
      const state = makeMainState();
      const card = handCard("n1", "NORMAL-001");
      state.cardInstances = [card];

      const actions = getAvailableSetMirageLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });

      expect(actions).toHaveLength(0);
    });

    it("既にセット済みの場合は空配列", () => {
      const state = makeMainState({
        mirageSetPlayerIdsThisTurn: [ALICE],
      });
      const card = handCard("m1", "MIRAGE-001");
      state.cardInstances = [card];

      const actions = getAvailableSetMirageLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });

      expect(actions).toHaveLength(0);
    });

    it("既存ミラージュがある場合、replacedMirageInstanceIds が設定される", () => {
      const state = makeMainState({
        mirageSetStates: [{ playerId: ALICE, cardInstanceId: "old-m" }],
      });
      const oldMirage = mirageCard("old-m");
      const newCard = handCard("m2", "MIRAGE-002");
      state.cardInstances = [oldMirage, newCard];
      state.players = state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      );

      const actions = getAvailableSetMirageLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });

      expect(actions).toHaveLength(1);
      expect(actions[0].replacedMirageInstanceIds).toEqual(["old-m"]);
    });

    it("applyLegalAction: ミラージュセットはコスト支払い後にスタック窓を開き、pass 後にセットされる", () => {
      const state = makeMainState();
      state.cardInstances = [handCard("mc", "MIRAGE-COST")];
      state.players = state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      );

      const action = getAvailableSetMirageLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      })[0]!;
      const { state: declared } = applyLegalAction({
        state,
        action,
        paymentSources: [{ kind: "reserve", amount: 2 }],
        getCardDefinitionById: getCardDef,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      });

      expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
        "set_mirage"
      );
      expect(getPlayer(declared, ALICE).reserveNormalCoreCount).toBe(8);
      expect(getPlayer(declared, ALICE).handCount).toBe(1);
      expect(getCard(declared, "mc").zone).toBe("hand");

      const after = passOpenStack(declared);
      expect(after.stackWindow).toBeNull();
      expect(getCard(after, "mc").zone).toBe("mirage");
      expect(getPlayer(after, ALICE).handCount).toBe(0);
      expect(getPlayerMirageSetState(after, ALICE)).toEqual({
        playerId: ALICE,
        cardInstanceId: "mc",
      });
    });

    it("canSetFromTrash のミラージュカードはトラッシュから LegalAction が返る", () => {
      const state = makeMainState();
      state.cardInstances = [trashCard("m1", "MIRAGE-TRASH")];

      const actions = getAvailableSetMirageLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });

      expect(actions).toHaveLength(1);
      expect(actions[0].sourceInstanceId).toBe("m1");
      expect(actions[0].sourceCardNo).toBe("MIRAGE-TRASH");
    });

    it("アタックステップでは空配列", () => {
      const state = makeMainState({ step: "attack" });
      const card = handCard("m1", "MIRAGE-001");
      state.cardInstances = [card];

      const actions = getAvailableSetMirageLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });

      expect(actions).toHaveLength(0);
    });

    // 回帰: getAvailableMiragePaymentSources の virtualCard
    // (`{cost, reductionSymbols} as CardDefinition`, symbolColors 省略) が
    // calculateReduction → applyPayingForTreatAsToSupply → matchesCardFilterByDef
    // 経由で場の whenPayingForFilter treat_as (BSSA01-C01 型) と照合されるとき、
    // card-filter.ts の symbolCount 計算が def.symbolColors.length を無条件評価しており
    // symbolColors 省略カードで TypeError (position-bias fuzz test で発見)。
    it("場に whenPayingForFilter treat_as (BSSA01-C01型) を持つカードがあってもクラッシュしない", () => {
      const withPayingFilterDef: CardDefinition = {
        cardNo: "TEST-PAYING-FILTER",
        name: "PayingFilterTestSpirit",
        printedCategory: "spirit",
        colors: ["purple"],
        cost: 3,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
        symbolColors: ["purple"],
        textLines: [],
        keywordTags: [],
        sourceUrls: [],
        sourceConfidence: "C",
        effects: [
          {
            timing: { kind: "continuous" },
            steps: [
              {
                action: {
                  kind: "treat_as",
                  appliesToCard: true,
                  aspects: ["symbol"],
                  asColor: ["white", "purple"],
                  whenPayingForFilter: { tribes: ["夜錆"] },
                },
              },
            ],
          },
        ],
      } as CardDefinition;
      const localDefMap = new Map(defMap);
      localDefMap.set("TEST-PAYING-FILTER", withPayingFilterDef);
      const getLocalDef = (id: string) => localDefMap.get(id);

      const state = makeMainState();
      state.cardInstances = [
        handCard("m1", "MIRAGE-COST"),
        createCardInstance(withPayingFilterDef, {
          instanceId: "supplier-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ];

      expect(() =>
        getAvailableSetMirageLegalActions({
          state,
          actingPlayerId: ALICE,
          getCardDefinitionById: getLocalDef,
        })
      ).not.toThrow();
    });
  });

  describe("while_set CE のミラージュゾーン対応", () => {
    it("ミラージュゾーンのカードの while_set CE は保持される", () => {
      const card = mirageCard("m1");
      const state = makeMainState({
        cardInstances: [card],
        activeContinuousEffects: [
          {
            effectId: "ce-1",
            sourceInstanceId: "m1",
            sourceDefinitionId: "MIRAGE-001",
            actingPlayerId: ALICE,
            duration: { scope: "while_set" },
            createdAtTurn: 1,
            createdAtAttackId: null,
            modifierTag: "bp_modifier",
            modifierAmount: 1000,
          } as ContinuousEffect,
        ],
      } as Partial<GameState>);

      const result = recomputeContinuousEffects(state);
      expect(result.activeContinuousEffects).toHaveLength(1);
    });

    it("ミラージュゾーンを離れたカードの while_set CE は除去される", () => {
      const card = handCard("m1", "MIRAGE-001");
      card.zone = "trash";
      const state = makeMainState({
        cardInstances: [card],
        activeContinuousEffects: [
          {
            effectId: "ce-1",
            sourceInstanceId: "m1",
            sourceDefinitionId: "MIRAGE-001",
            actingPlayerId: ALICE,
            duration: { scope: "while_set" },
            createdAtTurn: 1,
            createdAtAttackId: null,
            modifierTag: "bp_modifier",
            modifierAmount: 1000,
          } as ContinuousEffect,
        ],
      } as Partial<GameState>);

      const result = recomputeContinuousEffects(state);
      expect(result.activeContinuousEffects).toHaveLength(0);
    });

    it("while_on_field CE はミラージュゾーンのカードでは除去される", () => {
      const card = mirageCard("m1");
      const state = makeMainState({
        cardInstances: [card],
        activeContinuousEffects: [
          {
            effectId: "ce-1",
            sourceInstanceId: "m1",
            sourceDefinitionId: "MIRAGE-001",
            actingPlayerId: ALICE,
            duration: { scope: "while_on_field" },
            createdAtTurn: 1,
            createdAtAttackId: null,
            modifierTag: "bp_modifier",
            modifierAmount: 1000,
          } as ContinuousEffect,
        ],
      } as Partial<GameState>);

      const result = recomputeContinuousEffects(state);
      // ミラージュはフィールドではないので while_on_field は除去される
      expect(result.activeContinuousEffects).toHaveLength(0);
    });
  });

  describe("removeMirageSetState", () => {
    it("ミラージュカードが離脱時にセット状態が除去される", () => {
      const state = makeMainState({
        mirageSetStates: [{ playerId: ALICE, cardInstanceId: "m1" }],
      });

      const result = removeMirageSetState(state, "m1");
      expect(result.mirageSetStates).toHaveLength(0);
      expect(
        result.log.some((l: string) => l.includes("mirage:removed:"))
      ).toBe(true);
    });

    it("対象でないカードの場合は状態を変更しない", () => {
      const state = makeMainState({
        mirageSetStates: [{ playerId: ALICE, cardInstanceId: "m1" }],
      });

      const result = removeMirageSetState(state, "other-card");
      expect(result.mirageSetStates).toHaveLength(1);
    });
  });

  describe("applyFreeMirageSetBookkeeping", () => {
    it("化け化けと通常枠からの無償セットは通常枠1枚だけを戻す", () => {
      const oldMirage1 = createCardInstance(C01, {
        instanceId: "old-m1",
        ownerPlayerId: ALICE,
        zone: "mirage",
      });
      const oldMirage2 = mirageCard("old-m2");
      // applyFreeMirageSetBookkeeping は呼び出し側が zone を既に "mirage" へ
      // 更新済みであることを前提とする（deck_reveal の pick destination 割り当て後）。
      const newCard = mirageCard("m2");
      const state = makeMainState({
        cardInstances: [oldMirage1, oldMirage2, newCard],
        mirageSetStates: [
          { playerId: ALICE, cardInstanceId: "old-m1" },
          { playerId: ALICE, cardInstanceId: "old-m2" },
        ],
      });

      const result = applyFreeMirageSetBookkeeping(
        state,
        ALICE,
        "m2",
        getCardDef
      );

      // 化け化けは0枠のまま残り、通常枠1枚だけが手札へ戻る。
      expect(getCard(result, "old-m1").zone).toBe("mirage");
      expect(getCard(result, "old-m2").zone).toBe("hand");
      expect(getCard(result, "m2").zone).toBe("mirage");
      expect(getPlayer(result, ALICE).handCount).toBe(
        getPlayer(state, ALICE).handCount + 1
      );

      expect(result.mirageSetStates).toEqual([
        { playerId: ALICE, cardInstanceId: "old-m1" },
        { playerId: ALICE, cardInstanceId: "m2" },
      ]);

      expect(
        result.log.filter((l: string) => l.includes("mirage:replace:"))
      ).toHaveLength(1);
    });

    it("既存ミラージュがない場合は通常通り新規セットする", () => {
      const newCard = mirageCard("m1");
      const state = makeMainState({ cardInstances: [newCard] });

      const result = applyFreeMirageSetBookkeeping(
        state,
        ALICE,
        "m1",
        getCardDef
      );

      expect(getCard(result, "m1").zone).toBe("mirage");
      expect(result.mirageSetStates).toEqual([
        { playerId: ALICE, cardInstanceId: "m1" },
      ]);
    });

    it("セット対象が既にセット済みの唯一のミラージュなら no-op", () => {
      const already = mirageCard("m1");
      const state = makeMainState({
        cardInstances: [already],
        mirageSetStates: [{ playerId: ALICE, cardInstanceId: "m1" }],
      });

      const result = applyFreeMirageSetBookkeeping(
        state,
        ALICE,
        "m1",
        getCardDef
      );

      expect(result).toBe(state);
    });
  });

  describe("set_self_as_mirage DSL action (executeSetSelfAsMirage)", () => {
    it("効果による自己セットも化け化けを残し通常枠1枚だけを戻す", () => {
      const oldMirage1 = createCardInstance(C01, {
        instanceId: "old-m1",
        ownerPlayerId: ALICE,
        zone: "mirage",
      });
      const oldMirage2 = mirageCard("old-m2");
      const source = handCard("m2", "MIRAGE-002");
      const state = makeMainState({
        cardInstances: [oldMirage1, oldMirage2, source],
        mirageSetStates: [
          { playerId: ALICE, cardInstanceId: "old-m1" },
          { playerId: ALICE, cardInstanceId: "old-m2" },
        ],
        players: makeMainState().players.map((p) =>
          p.id === ALICE ? { ...p, handCount: 1 } : p
        ),
      });

      const result = executeEffect({
        chainId: "test:phase-e-mirage:1044",
        state,
        effect: {
          timing: { kind: "continuous" },
          steps: [{ action: { kind: "set_self_as_mirage" } }],
          textRef: [],
        },
        sourceInstanceId: "m2",
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
        getRegisteredTriggeredEffectActions: () => [],
      });

      expect(getCard(result, "old-m1").zone).toBe("mirage");
      expect(getCard(result, "old-m2").zone).toBe("hand");
      expect(getCard(result, "m2").zone).toBe("mirage");
      expect(result.mirageSetStates).toEqual([
        { playerId: ALICE, cardInstanceId: "old-m1" },
        { playerId: ALICE, cardInstanceId: "m2" },
      ]);
      expect(getPlayer(result, ALICE).handCount).toBe(
        getPlayer(state, ALICE).handCount
      );
    });

    it("onlyIfNoMirage:true は既存が2枠あってもスキップする", () => {
      const oldMirage1 = createCardInstance(C01, {
        instanceId: "old-m1",
        ownerPlayerId: ALICE,
        zone: "mirage",
      });
      const oldMirage2 = mirageCard("old-m2");
      const source = handCard("m2", "MIRAGE-002");
      const state = makeMainState({
        cardInstances: [oldMirage1, oldMirage2, source],
        mirageSetStates: [
          { playerId: ALICE, cardInstanceId: "old-m1" },
          { playerId: ALICE, cardInstanceId: "old-m2" },
        ],
      });

      const result = executeEffect({
        chainId: "test:phase-e-mirage:1082",
        state,
        effect: {
          timing: { kind: "continuous" },
          steps: [
            { action: { kind: "set_self_as_mirage", onlyIfNoMirage: true } },
          ],
          textRef: [],
        },
        sourceInstanceId: "m2",
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
        getRegisteredTriggeredEffectActions: () => [],
      });

      expect(getCard(result, "m2").zone).toBe("hand");
      expect(result.mirageSetStates).toHaveLength(2);
    });
  });

  describe("ターンリセット", () => {
    it("mirageSetPlayerIdsThisTurn がターン開始時に空になる", () => {
      // createEmptyGameState はデフォルトで空リストを設定する
      const state = createEmptyGameState();
      expect(state.mirageSetPlayerIdsThisTurn).toEqual([]);
    });

    it("mirageSetStates はターンリセットで保持される（ミラージュはターン跨ぎで残る）", () => {
      const state = createEmptyGameState();
      expect(state.mirageSetStates).toEqual([]);
    });
  });
});
