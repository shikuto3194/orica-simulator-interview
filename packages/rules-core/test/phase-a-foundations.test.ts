import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  createPlayerState,
  initializeGame,
  applyContractPresentationChoices,
} from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  flushPendingLeaves,
  resolveSoulStateReplacement,
} from "../src/state-based-actions";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PlayerState,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

// ── ヘルパー ───────────────────────────────────────────

const ALICE = "player-1";
const BOB = "player-2";

function dummyDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "Test Card",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    keywordTags: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

function fieldCard(
  instanceId: string,
  owner = ALICE,
  cores = 1,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(dummyDef(), {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
    ...opts,
  });
}

function getPlayer(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

const defMap = new Map<string, CardDefinition>();
defMap.set("TEST-001", dummyDef());

function getCardDef(id: string): CardDefinition | undefined {
  return defMap.get(id) ?? dummyDef();
}

function runEffect(
  state: GameState,
  effect: Effect,
  sourceId = "s1"
): GameState {
  return executeEffect({
    chainId: "test:phase-a-foundations:81",
    state,
    effect,
    sourceInstanceId: sourceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
  });
}

// ── A-1: カウントエリア ──────────────────────────────────

describe("A-1: カウントエリア (countValue)", () => {
  describe("count_increase", () => {
    it("should increase countValue for target player", () => {
      const state = createEmptyGameState({
        startingVoidNormalCoreCount: 10,
        playerOverrides: [{ countValue: 2 }, {}],
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 3 } },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).countValue).toBe(5);
      expect(getPlayer(result, ALICE).voidNormalCoreCount).toBe(7);
    });

    it("should increase opponent countValue", () => {
      const state = createEmptyGameState({
        startingVoidNormalCoreCount: 10,
        playerOverrides: [{}, { countValue: 1 }],
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_increase", player: "opponent", amount: 2 } },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, BOB).countValue).toBe(3);
      expect(getPlayer(result, BOB).voidNormalCoreCount).toBe(8);
    });

    it("should not create count cores when void has no normal cores", () => {
      const state = createEmptyGameState({
        startingVoidNormalCoreCount: 0,
        playerOverrides: [{ countValue: 2 }, {}],
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 3 } },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).countValue).toBe(2);
      expect(getPlayer(result, ALICE).voidNormalCoreCount).toBe(0);
    });

    it("should log count increase", () => {
      const state = createEmptyGameState({ startingVoidNormalCoreCount: 1 });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      };
      const result = runEffect(state, effect);
      expect(result.log.some((l) => l.includes("count_increase"))).toBe(true);
    });
  });

  describe("count_decrease", () => {
    it("should decrease countValue for target player", () => {
      const state = createEmptyGameState({
        playerOverrides: [{ countValue: 5 }, {}],
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 2 } },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).countValue).toBe(3);
    });

    it("should not go below zero", () => {
      const state = createEmptyGameState({
        playerOverrides: [{ countValue: 1 }, {}],
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 5 } },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).countValue).toBe(0);
    });

    it("should noop when already zero", () => {
      const state = createEmptyGameState({
        playerOverrides: [{ countValue: 0 }, {}],
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 3 } },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).countValue).toBe(0);
      expect(result.log.some((l) => l.includes("already-zero"))).toBe(true);
    });
  });

  describe("count_set", () => {
    it("should set countValue to specified value", () => {
      const state = createEmptyGameState({
        playerOverrides: [{ countValue: 2 }, {}],
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "count_set", player: "self", value: 10 } }],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).countValue).toBe(10);
    });

    it("should clamp to zero for negative values", () => {
      const state = createEmptyGameState({
        playerOverrides: [{ countValue: 5 }, {}],
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "count_set", player: "self", value: -1 } }],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).countValue).toBe(0);
    });
  });

  describe("rebirth uses countValue", () => {
    it("should allow rebirth when countValue <= maxCount", () => {
      const backDef = dummyDef({ cardNo: "TEST-002_back", name: "Back Face" });
      const frontDef = dummyDef({
        cardNo: "TEST-002",
        isDoubleSided: true,
        backFace: { cardNo: "TEST-002_back" },
      });
      defMap.set("TEST-002", frontDef);
      defMap.set("TEST-002_back", backDef);

      const card = createCardInstance(frontDef, {
        instanceId: "rebirth-card",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 3,
      });

      const state = createEmptyGameState({
        cardInstances: [card],
        playerOverrides: [{ countValue: 2 }, {}],
      });

      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "rebirth",
              maxCount: 3,
              triggerDescription: "test rebirth",
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:phase-a-foundations:262",
        state,
        effect,
        sourceInstanceId: "rebirth-card",
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => defMap.get(id),
      });

      // カードが裏面に転醒
      expect(getCard(result, "rebirth-card").definitionId).toBe(
        "TEST-002_back"
      );
      // カウントが+1
      expect(getPlayer(result, ALICE).countValue).toBe(3);
    });

    it("should reject rebirth when countValue > maxCount", () => {
      const backDef = dummyDef({ cardNo: "TEST-003_back", name: "Back Face" });
      const frontDef = dummyDef({
        cardNo: "TEST-003",
        isDoubleSided: true,
        backFace: { cardNo: "TEST-003_back" },
      });
      defMap.set("TEST-003", frontDef);
      defMap.set("TEST-003_back", backDef);

      const card = createCardInstance(frontDef, {
        instanceId: "rebirth-fail",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });

      const state = createEmptyGameState({
        cardInstances: [card],
        playerOverrides: [{ countValue: 5 }, {}],
      });

      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "rebirth",
              maxCount: 3,
              triggerDescription: "test rebirth",
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:phase-a-foundations:313",
        state,
        effect,
        sourceInstanceId: "rebirth-fail",
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => defMap.get(id),
      });

      // 転醒しない
      expect(getCard(result, "rebirth-fail").definitionId).toBe("TEST-003");
      // カウント変わらず
      expect(getPlayer(result, ALICE).countValue).toBe(5);
    });
  });
});

// ── A-2: 魂状態 ──────────────────────────────────────────

describe("A-2: 魂状態 (Soul State)", () => {
  describe("enter_soul_state", () => {
    it("should move card to soul state and return cores to reserve", () => {
      const card = fieldCard("soul-target", ALICE, 3);
      const state = createEmptyGameState({
        cardInstances: [card],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      });

      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "enter_soul_state",
              target: { kind: "self" },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:phase-a-foundations:352",
        state,
        effect,
        sourceInstanceId: "soul-target",
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });

      // コアがリザーブに戻る
      expect(getCard(result, "soul-target").normalCoreCount).toBe(0);
      expect(getPlayer(result, ALICE).reserveNormalCoreCount).toBe(5); // 2 + 3
      // 魂状態リストに追加
      expect(getPlayer(result, ALICE).soulStateInstanceIds).toContain(
        "soul-target"
      );
    });

    it("should remove soul core when entering soul state", () => {
      const card = fieldCard("soul-core-card", ALICE, 2, {});
      const state = createEmptyGameState({
        cardInstances: [card],
      });

      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "enter_soul_state",
              target: { kind: "self" },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:phase-a-foundations:387",
        state,
        effect,
        sourceInstanceId: "soul-core-card",
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
      });

      expect(getCard(result, "soul-core-card").normalCoreCount).toBe(0);
    });
  });

  describe("place", () => {
    it("should place a soul-state self nexus and remove it from the soul state list", () => {
      const nexusDef = dummyDef({
        cardNo: "TEST-PLACE-NEXUS",
        printedCategory: "nexus",
        levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      });
      defMap.set(nexusDef.cardNo, nexusDef);
      const card = createCardInstance(nexusDef, {
        instanceId: "soul-place",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      const state = createEmptyGameState({
        cardInstances: [card],
        playerOverrides: [{ soulStateInstanceIds: ["soul-place"] }, {}],
      });

      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "place",
              target: { kind: "self" },
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:phase-a-foundations:430",
        state,
        effect,
        sourceInstanceId: "soul-place",
        actingPlayerId: ALICE,
        getCardDefinitionById: getCardDef,
        summonEnterFieldCorePlacements: [],
      });

      expect(getPlayer(result, ALICE).soulStateInstanceIds).not.toContain(
        "soul-place"
      );
      expect(getCard(result, "soul-place").zoneRoleName).toBe("nexus");
      expect(result.log).toContain(
        "effect:field_place:self:player-1:soul-place:from=field:cost=0:cores=0:interactive=true"
      );
    });
  });

  describe("soul state targeting exclusion", () => {
    it("should exclude soul state cards from normal targeting", () => {
      const normalCard = fieldCard("normal", ALICE, 2);
      const soulCard = fieldCard("soul", ALICE, 0);
      const state = createEmptyGameState({
        cardInstances: [normalCard, soulCard],
        playerOverrides: [{ soulStateInstanceIds: ["soul"] }, {}],
      });

      // destroy targeting "all" self spirits — soul state should be excluded
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "self",
                count: -1,
                filter: { category: ["spirit"] },
              },
            },
          },
        ],
      };

      const result = runEffect(state, effect);
      // Normal card gets destroyed (pending leave), soul card stays
      const normal = getCard(result, "normal");
      const soul = getCard(result, "soul");
      expect(normal.pendingLeaveKind).toBe("destroy");
      expect(soul.pendingLeaveKind).toBeNull();
    });

    it("should include soul state cards when includeSoulState is true", () => {
      const soulCard = fieldCard("soul-inc", ALICE, 0);
      const state = createEmptyGameState({
        cardInstances: [soulCard],
        playerOverrides: [{ soulStateInstanceIds: ["soul-inc"] }, {}],
      });

      // Target with includeSoulState: true
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "self",
                count: -1,
                filter: { category: ["spirit"], soulState: "include" },
              },
            },
          },
        ],
      };

      const result = runEffect(state, effect);
      const card = getCard(result, "soul-inc");
      expect(card.pendingLeaveKind).toBe("destroy");
    });
  });

  describe("soulStateInstanceIds default", () => {
    it("createPlayerState should have empty soulStateInstanceIds", () => {
      const p = createPlayerState("test");
      expect(p.soulStateInstanceIds).toEqual([]);
    });
  });
});

// ── A-3: 手元ゾーン (set_aside) ─────────────────────────

describe("A-3: 手元ゾーン (set_aside)", () => {
  it("cards in set_aside zone exist and are separate from hand", () => {
    const handCard = createCardInstance(dummyDef(), {
      instanceId: "hand-card",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const openedCard = createCardInstance(dummyDef(), {
      instanceId: "opened-card",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const state = createEmptyGameState({
      cardInstances: [handCard, openedCard],
    });

    const handCards = state.cardInstances.filter((c) => c.zone === "hand");
    const openedHandCards = state.cardInstances.filter(
      (c) => c.zone === "set_aside"
    );

    expect(handCards).toHaveLength(1);
    expect(handCards[0].instanceId).toBe("hand-card");
    expect(openedHandCards).toHaveLength(1);
    expect(openedHandCards[0].instanceId).toBe("opened-card");
  });

  it("set_aside cards are not affected by hand discard effects", () => {
    const handCard = createCardInstance(dummyDef(), {
      instanceId: "discard-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const openedCard = createCardInstance(dummyDef(), {
      instanceId: "safe-opened",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const state = createEmptyGameState({
      cardInstances: [handCard, openedCard],
      playerOverrides: [{ handCount: 1 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "discard",
            count: -1,
          },
        },
      ],
    };

    const result = runEffect(state, effect);
    // Hand card goes to trash
    expect(getCard(result, "discard-hand").zone).toBe("trash");
    // Opened hand card is unaffected
    expect(getCard(result, "safe-opened").zone).toBe("set_aside");
  });
});

// ── B-1: 転醒完全化 ──────────────────────────────────────────

describe("B-1: 転醒完全化", () => {
  // テスト用の B 面定義（Lv1 コア2必要）
  const backDefHighLv = dummyDef({
    cardNo: "REBIRTH-B-HIGH",
    name: "Rebirth B Face (High Lv)",
    levelDefs: [
      { level: 1, requiredCores: 2, bp: 5000 },
      { level: 2, requiredCores: 4, bp: 8000 },
    ],
  });
  const backDefLowLv = dummyDef({
    cardNo: "REBIRTH-B-LOW",
    name: "Rebirth B Face (Low Lv)",
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  });
  const frontDefHigh = dummyDef({
    cardNo: "REBIRTH-A-HIGH",
    isDoubleSided: true,
    backFace: { cardNo: "REBIRTH-B-HIGH" } as CardDefinition["backFace"],
  });
  const frontDefLow = dummyDef({
    cardNo: "REBIRTH-A-LOW",
    isDoubleSided: true,
    backFace: { cardNo: "REBIRTH-B-LOW" } as CardDefinition["backFace"],
  });

  // 定義マップに登録
  defMap.set("REBIRTH-A-HIGH", frontDefHigh);
  defMap.set("REBIRTH-B-HIGH", backDefHighLv);
  defMap.set("REBIRTH-A-LOW", frontDefLow);
  defMap.set("REBIRTH-B-LOW", backDefLowLv);

  describe("A面自動復帰 (auto A-face return)", () => {
    it("should revert B-face card to A-face when flushing pending leave", () => {
      // B 面に転醒済みのカードがフィールドにある状態
      const card = createCardInstance(frontDefLow, {
        instanceId: "rebirth-flush",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });
      // definitionId を B 面に変更（転醒済み状態をシミュレート）
      const bFaceCard = { ...card, definitionId: "REBIRTH-B-LOW" };

      const state: GameState = {
        ...createEmptyGameState({ cardInstances: [bFaceCard] }),
        pendingLeaveEntities: [
          {
            instanceId: "rebirth-flush",
            kind: "destroy",
            cause: "effect_resolution",
            causePlayerId: BOB,
            chainId: "test-chain",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
        cardInstances: [
          {
            ...bFaceCard,
            pendingLeaveKind: "destroy",
            pendingLeaveCause: "effect_resolution",
            pendingLeaveChainId: "test-chain",
          },
        ],
      };

      const result = flushPendingLeaves(state);
      const flushedCard = getCard(result, "rebirth-flush");

      // トラッシュに移動し、A 面に復帰
      expect(flushedCard.zone).toBe("trash");
      expect(flushedCard.definitionId).toBe("REBIRTH-A-LOW");
      expect(flushedCard.originalDefinitionId).toBe("REBIRTH-A-LOW");
    });

    it("should revert B-face card to A-face on bounce", () => {
      const card = createCardInstance(frontDefLow, {
        instanceId: "rebirth-bounce",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });
      const bFaceCard = { ...card, definitionId: "REBIRTH-B-LOW" };

      const state = createEmptyGameState({ cardInstances: [bFaceCard] });

      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "self",
                count: 1,
                filter: { category: ["spirit"] },
              },
            },
          },
        ],
      };

      const result = flushPendingLeaves(
        executeEffect({
          chainId: "test:phase-a-foundations:694",
          state,
          effect,
          sourceInstanceId: "rebirth-bounce",
          actingPlayerId: ALICE,
          getCardDefinitionById: (id) => defMap.get(id),
        }),
        (id) => defMap.get(id)
      );

      const bouncedCard = getCard(result, "rebirth-bounce");
      expect(bouncedCard.zone).toBe("hand");
      expect(bouncedCard.definitionId).toBe("REBIRTH-A-LOW");
    });
  });

  describe("Lv検証 (Lv validation after rebirth)", () => {
    it("should block rebirth when B-face min cores > current cores", () => {
      // frontDefHigh の B 面は Lv1 = 2コア必要、カードに1コアしかない
      const card = createCardInstance(frontDefHigh, {
        instanceId: "lv-fail",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });

      const state = createEmptyGameState({
        cardInstances: [card],
        playerOverrides: [{ countValue: 0 }, {}],
      });

      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "rebirth",
              maxCount: 5,
              triggerDescription: "test",
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:phase-a-foundations:738",
        state,
        effect,
        sourceInstanceId: "lv-fail",
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => defMap.get(id),
      });

      // 転醒しない（Lv 不足）
      expect(getCard(result, "lv-fail").definitionId).toBe("REBIRTH-A-HIGH");
      expect(getPlayer(result, ALICE).countValue).toBe(0);
      expect(result.log.some((l: string) => l.includes("lv-deficit"))).toBe(
        true
      );
    });

    it("should allow rebirth when B-face min cores <= current cores", () => {
      const card = createCardInstance(frontDefHigh, {
        instanceId: "lv-pass",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 3,
      });

      const state = createEmptyGameState({
        cardInstances: [card],
        playerOverrides: [{ countValue: 0 }, {}],
      });

      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "rebirth",
              maxCount: 5,
              triggerDescription: "test",
            },
          },
        ],
      };

      const result = executeEffect({
        chainId: "test:phase-a-foundations:780",
        state,
        effect,
        sourceInstanceId: "lv-pass",
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => defMap.get(id),
      });

      expect(getCard(result, "lv-pass").definitionId).toBe("REBIRTH-B-HIGH");
      expect(getPlayer(result, ALICE).countValue).toBe(1);
    });
  });

  describe("同一タイミング複数転醒不可", () => {
    it("should block second rebirth in same window", () => {
      const card1 = createCardInstance(frontDefLow, {
        instanceId: "rebirth-1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });
      const card2Def = dummyDef({
        cardNo: "REBIRTH-A-2",
        isDoubleSided: true,
        backFace: { cardNo: "REBIRTH-B-LOW" } as CardDefinition["backFace"],
      });
      defMap.set("REBIRTH-A-2", card2Def);
      const card2 = createCardInstance(card2Def, {
        instanceId: "rebirth-2",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });

      const state = createEmptyGameState({
        cardInstances: [card1, card2],
        playerOverrides: [{ countValue: 0 }, {}],
      });

      // 1体目転醒
      const after1 = executeEffect({
        chainId: "test:phase-a-foundations:820",
        state,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "rebirth",
                maxCount: 5,
                triggerDescription: "test",
              },
            },
          ],
        },
        sourceInstanceId: "rebirth-1",
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => defMap.get(id),
      });
      expect(getCard(after1, "rebirth-1").definitionId).toBe("REBIRTH-B-LOW");

      // 2体目転醒 → ブロック
      const after2 = executeEffect({
        chainId: "test:phase-a-foundations:841",
        state: after1,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "rebirth",
                maxCount: 5,
                triggerDescription: "test",
              },
            },
          ],
        },
        sourceInstanceId: "rebirth-2",
        actingPlayerId: ALICE,
        getCardDefinitionById: (id) => defMap.get(id),
      });
      expect(getCard(after2, "rebirth-2").definitionId).toBe("REBIRTH-A-2");
      expect(
        after2.log.some((l: string) => l.includes("blocked:same-timing"))
      ).toBe(true);
    });
  });

  describe("originalDefinitionId tracking", () => {
    it("createCardInstance should set originalDefinitionId = definitionId", () => {
      const card = createCardInstance(dummyDef(), {
        instanceId: "orig-test",
        ownerPlayerId: ALICE,
      });
      expect(card.originalDefinitionId).toBe(card.definitionId);
    });
  });
});

// ── B-2: 契約完全化 ──────────────────────────────────────────

describe("B-2: 契約完全化", () => {
  describe("contractCardNo initialization", () => {
    it("createPlayerState should have contractCardNo = null by default", () => {
      const p = createPlayerState("test");
      expect(p.contractCardNo).toBeNull();
    });

    it("initializeGame should detect contract card and set contractCardNo when preGame is skipped", () => {
      const normalCard = dummyDef({ cardNo: "NORMAL-001" });
      const contractCard = dummyDef({
        cardNo: "CONTRACT-001",
        keywordTags: ["contract"],
      });

      // デッキ: 契約1枚 + 通常39枚
      const deck = [
        contractCard,
        ...Array(39).fill(normalCard),
      ] as CardDefinition[];
      const game = initializeGame({
        decks: [deck, Array(40).fill(normalCard) as CardDefinition[]],
        skipPreGame: true,
        allowUnavailableDeckCards: true,
      });

      const alice = game.players[0]!;
      const bob = game.players[1]!;

      // alice は契約カードあり
      expect(alice.contractCardNo).toBe("CONTRACT-001");
      // alice の手札は4枚（3枚ド��ー + 契約1枚）
      expect(alice.handCount).toBe(4);

      // bob は契約カードなし
      expect(bob.contractCardNo).toBeNull();
      expect(bob.handCount).toBe(4);

      // 契約カードが手札にある
      const contractInHand = game.cardInstances.find(
        (c) => c.definitionId === "CONTRACT-001" && c.zone === "hand"
      );
      expect(contractInHand).toBeDefined();
      expect(contractInHand!.ownerPlayerId).toBe("alice");
    });

    it("initializeGame should wait for contract presentation before dealing opening hands", () => {
      const normalCard = dummyDef({ cardNo: "NORMAL-002" });
      const contractCard = dummyDef({
        cardNo: "CONTRACT-002",
        keywordTags: ["contract"],
      });
      const deck = [
        contractCard,
        ...Array(39).fill(normalCard),
      ] as CardDefinition[];

      const game = initializeGame({
        decks: [deck, Array(40).fill(normalCard) as CardDefinition[]],
        allowUnavailableDeckCards: true,
      });

      expect(game.preGame?.phase).toBe("waiting_contract");
      expect(game.preGame?.contractCandidateCardNos?.alice).toBe(
        "CONTRACT-002"
      );
      expect(game.players[0]!.handCount).toBe(0);
      expect(game.players[0]!.deckCount).toBe(40);
      expect(game.players[0]!.contractCardNo).toBeNull();
      expect(
        game.cardInstances.some(
          (c) => c.definitionId === "CONTRACT-002" && c.zone === "hand"
        )
      ).toBe(false);

      const presented = applyContractPresentationChoices(game, {
        alice: true,
      });
      expect(presented.players[0]!.handCount).toBe(4);
      expect(presented.players[0]!.deckCount).toBe(36);
      expect(presented.players[0]!.contractCardNo).toBe("CONTRACT-002");
      const contractInHand = presented.cardInstances.find(
        (c) => c.definitionId === "CONTRACT-002" && c.zone === "hand"
      );
      expect(contractInHand).toBeDefined();

      const skipped = applyContractPresentationChoices(game, {
        alice: false,
      });
      expect(skipped.players[0]!.handCount).toBe(4);
      expect(skipped.players[0]!.deckCount).toBe(36);
      expect(skipped.players[0]!.contractCardNo).toBeNull();
    });
  });

  describe("魂状態置換 (soul state replacement)", () => {
    it("should set pendingSoulStateReplacement when contract card is destroyed by opponent", () => {
      const contractDef = dummyDef({ cardNo: "CONTRACT-S1" });
      defMap.set("CONTRACT-S1", contractDef);
      const card = createCardInstance(contractDef, {
        instanceId: "contract-1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });

      const state: GameState = {
        ...createEmptyGameState({
          cardInstances: [card],
          playerOverrides: [{ contractCardNo: "CONTRACT-S1" }, {}],
        }),
        pendingLeaveEntities: [
          {
            instanceId: "contract-1",
            kind: "destroy",
            cause: "effect_resolution",
            causePlayerId: BOB,
            chainId: "test-destroy",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
        cardInstances: [
          {
            ...card,
            pendingLeaveKind: "destroy",
            pendingLeaveCause: "effect_resolution",
            pendingLeaveChainId: "test-destroy",
          },
        ],
      };

      const result = flushPendingLeaves(state);

      // 魂状態置換の選択待ちが設定される
      expect(result.pendingSoulStateReplacement).not.toBeNull();
      expect(result.pendingSoulStateReplacement!.choosingPlayerId).toBe(ALICE);
      expect(result.pendingSoulStateReplacement!.cardInstanceId).toBe(
        "contract-1"
      );
      // カードはまだフィールドにいる（フラッシュされていない）
      expect(getCard(result, "contract-1").zone).toBe("field");
    });

    it("should enter soul state when replacement is accepted", () => {
      const contractDef = dummyDef({ cardNo: "CONTRACT-S2" });
      const card = createCardInstance(contractDef, {
        instanceId: "contract-2",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 3,
      });

      const state: GameState = {
        ...createEmptyGameState({
          cardInstances: [card],
          playerOverrides: [{ contractCardNo: "CONTRACT-S2" }, {}],
        }),
        pendingSoulStateReplacement: {
          choosingPlayerId: ALICE,
          cardInstanceId: "contract-2",
          originalLeaveKind: "destroy",
          originalLeaveCause: "effect_resolution",
        },
        pendingLeaveEntities: [
          {
            instanceId: "contract-2",
            kind: "destroy",
            cause: "effect_resolution",
            causePlayerId: BOB,
            chainId: "test-destroy-2",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
        cardInstances: [
          {
            ...card,
            pendingLeaveKind: "destroy",
            pendingLeaveCause: "effect_resolution",
            pendingLeaveChainId: "test-destroy-2",
          },
        ],
      };

      const result = resolveSoulStateReplacement(state, true);

      // 魂状態に入り、コアはリザーブに
      expect(result.pendingSoulStateReplacement).toBeNull();
      const resolvedCard = getCard(result, "contract-2");
      expect(resolvedCard.zone).toBe("field"); // フィールドに残る
      expect(resolvedCard.normalCoreCount).toBe(0); // コアなし
      expect(resolvedCard.pendingLeaveKind).toBeNull(); // 待機解除
      expect(getPlayer(result, ALICE).soulStateInstanceIds).toContain(
        "contract-2"
      );
      expect(
        getPlayer(result, ALICE).reserveNormalCoreCount
      ).toBeGreaterThanOrEqual(3);
      // ペンディングリーブも除去
      expect(
        result.pendingLeaveEntities.find((pl) => pl.instanceId === "contract-2")
      ).toBeUndefined();
    });

    it("should return soul core to reserve when soul-stated card had one", () => {
      const contractDef = dummyDef({ cardNo: "CONTRACT-S2B" });
      const card = createCardInstance(contractDef, {
        instanceId: "contract-2b",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });

      const state: GameState = {
        ...createEmptyGameState({
          cardInstances: [card],
          playerOverrides: [
            {
              contractCardNo: "CONTRACT-S2B",
              soulCoreLocation: { kind: "card", instanceId: "contract-2b" },
            },
            {},
          ],
        }),
        pendingSoulStateReplacement: {
          choosingPlayerId: ALICE,
          cardInstanceId: "contract-2b",
          originalLeaveKind: "destroy",
          originalLeaveCause: "effect_resolution",
        },
        pendingLeaveEntities: [
          {
            instanceId: "contract-2b",
            kind: "destroy",
            cause: "effect_resolution",
            causePlayerId: BOB,
            chainId: "test-destroy-2b",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
        cardInstances: [
          {
            ...card,
            pendingLeaveKind: "destroy",
            pendingLeaveCause: "effect_resolution",
            pendingLeaveChainId: "test-destroy-2b",
          },
        ],
      };

      const result = resolveSoulStateReplacement(state, true);

      const aliceAfter = getPlayer(result, ALICE);
      expect(aliceAfter.soulCoreLocation).toEqual({ kind: "reserve" });
    });

    it("should proceed with destruction when replacement is declined", () => {
      const baseState = createEmptyGameState({
        playerOverrides: [{ contractCardNo: "CONTRACT-S3" }, {}],
      });
      const state: GameState = {
        ...baseState,
        pendingSoulStateReplacement: {
          choosingPlayerId: ALICE,
          cardInstanceId: "contract-3",
          originalLeaveKind: "destroy",
          originalLeaveCause: "effect_resolution",
        },
      };

      const result = resolveSoulStateReplacement(state, false);

      expect(result.pendingSoulStateReplacement).toBeNull();
      // declined のログが追加されている
      const newLogs = result.log.slice(state.log.length);
      expect(newLogs.some((l: string) => l.includes("declined"))).toBe(true);
    });

    it("should NOT trigger soul state replacement for self-caused destruction", () => {
      const contractDef = dummyDef({ cardNo: "CONTRACT-S4" });
      const card = createCardInstance(contractDef, {
        instanceId: "contract-self",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });

      const state: GameState = {
        ...createEmptyGameState({
          cardInstances: [card],
          playerOverrides: [{ contractCardNo: "CONTRACT-S4" }, {}],
        }),
        pendingLeaveEntities: [
          {
            instanceId: "contract-self",
            kind: "destroy",
            cause: "effect_resolution",
            causePlayerId: ALICE, // 自分が原因
            chainId: "self-destroy",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
        cardInstances: [
          {
            ...card,
            pendingLeaveKind: "destroy",
            pendingLeaveCause: "effect_resolution",
            pendingLeaveChainId: "self-destroy",
          },
        ],
      };

      const result = flushPendingLeaves(state);

      // 自分のエフェクトによる破壊 → 魂状態置換なし → ��のまま破壊
      expect(result.pendingSoulStateReplacement).toBeNull();
      expect(getCard(result, "contract-self").zone).toBe("trash");
    });
  });

  describe("soul state cleanup on field leave", () => {
    it("should remove from soulStateInstanceIds when card is flushed", () => {
      const card = createCardInstance(dummyDef(), {
        instanceId: "soul-leave",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });

      const state: GameState = {
        ...createEmptyGameState({
          cardInstances: [card],
          playerOverrides: [{ soulStateInstanceIds: ["soul-leave"] }, {}],
        }),
        pendingLeaveEntities: [
          {
            instanceId: "soul-leave",
            kind: "destroy",
            cause: "effect_resolution",
            causePlayerId: ALICE,
            chainId: "test-soul-leave",
            deferZoneMoveUntilChainEnd: false,
            leaveFieldCoreDestinationOverride: null,
          },
        ],
        cardInstances: [
          {
            ...card,
            pendingLeaveKind: "destroy",
            pendingLeaveCause: "effect_resolution",
            pendingLeaveChainId: "test-soul-leave",
          },
        ],
      };

      const result = flushPendingLeaves(state);
      expect(getPlayer(result, ALICE).soulStateInstanceIds).toEqual([]);
    });
  });

  describe("pendingSoulStateReplacement default", () => {
    it("createEmptyGameState should have pendingSoulStateReplacement = null", () => {
      const state = createEmptyGameState();
      expect(state.pendingSoulStateReplacement).toBeNull();
    });
  });
});

// ── P3-14 A-1: conditional_cost アクティベーションコスト ───

describe("P3-14 A-1: conditional_cost activation cost (ことで構文 DSL)", () => {
  // count_decrease as cost step: 「カウント-1することで」
  describe("count_decrease as cost step", () => {
    it("should execute result step when count decrease cost succeeds", () => {
      const state = createEmptyGameState({
        startingVoidNormalCoreCount: 2,
        playerOverrides: [{ countValue: 3 }, {}],
      });
      // 「カウント-1することで、カウント+2する」
      const effect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "cost",
            action: { kind: "count_decrease", player: "self", amount: 1 },
          },
          {
            id: "result",
            action: { kind: "count_increase", player: "self", amount: 2 },
            connector: "conditional_cost" as const,
          },
        ],
      };
      const result = runEffect(state, effect);
      // count: 3 - 1 + 2 = 4
      expect(getPlayer(result, ALICE).countValue).toBe(4);
    });

    it("should rollback when count is already zero (cost fails)", () => {
      const state = createEmptyGameState({
        playerOverrides: [{ countValue: 0 }, {}],
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "cost",
            action: { kind: "count_decrease", player: "self", amount: 1 },
          },
          {
            id: "result",
            action: { kind: "count_increase", player: "self", amount: 5 },
            connector: "conditional_cost" as const,
          },
        ],
      };
      const result = runEffect(state, effect);
      // Count should remain 0 (cost failed → rollback, result not executed)
      expect(getPlayer(result, ALICE).countValue).toBe(0);
    });

    it("should support count_decrease with amount > 1 as cost", () => {
      const state = createEmptyGameState({
        playerOverrides: [{ countValue: 5 }, {}],
      });
      // 「カウント-2することで、相手のライフのコア1個をトラッシュに置く」
      const effect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "cost",
            action: { kind: "count_decrease", player: "self", amount: 2 },
          },
          {
            id: "result",
            action: { kind: "life_damage", player: "opponent", amount: 1 },
            connector: "conditional_cost" as const,
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).countValue).toBe(3);
      // Opponent's life should have decreased by 1 (default 5 → 4)
      expect(getPlayer(result, BOB).lifeNormalCoreCount).toBe(4);
    });
  });

  // core_move as cost step: 「コアをボイドに置くことで」
  describe("core_move as cost step", () => {
    it("should execute result step when this_card core move cost succeeds", () => {
      const card = fieldCard("s1", ALICE, 3);
      const state = {
        ...createEmptyGameState(),
        cardInstances: [card],
      };
      // 「このスピリットのコア1個をボイドに置くことで、カウント+1する」
      const effect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "cost",
            action: {
              kind: "core_move",
              from: { kind: "this_card" as const },
              to: { kind: "void" as const, player: "self" as const },
              amount: 1,
            },
          },
          {
            id: "result",
            action: { kind: "count_increase", player: "self", amount: 1 },
            connector: "conditional_cost" as const,
          },
        ],
      };
      const result = runEffect(state, effect);
      const resultCard = getCard(result, "s1");
      expect(resultCard.normalCoreCount).toBe(2);
      expect(getPlayer(result, ALICE).countValue).toBe(1);
    });

    it("should execute with reserve-to-void core move cost", () => {
      const card = fieldCard("s1", ALICE, 1);
      const state = {
        ...createEmptyGameState({
          playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
        }),
        cardInstances: [card],
      };
      // 「リザーブのコア2個をボイドに置くことで、カウント+1する」
      const effect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "cost",
            action: {
              kind: "core_move",
              from: { kind: "reserve" as const, player: "self" as const },
              to: { kind: "void" as const, player: "self" as const },
              amount: 2,
            },
          },
          {
            id: "result",
            action: { kind: "count_increase", player: "self", amount: 1 },
            connector: "conditional_cost" as const,
          },
        ],
      };
      const result = runEffect(state, effect);
      expect(getPlayer(result, ALICE).reserveNormalCoreCount).toBe(3);
      expect(getPlayer(result, ALICE).countValue).toBe(1);
    });

    it("should rollback when this_card has zero cores (cost fails)", () => {
      const card = fieldCard("s1", ALICE, 0);
      const state = {
        ...createEmptyGameState(),
        cardInstances: [card],
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "cost",
            action: {
              kind: "core_move",
              from: { kind: "this_card" as const },
              to: { kind: "void" as const, player: "self" as const },
              amount: 1,
            },
          },
          {
            id: "result",
            action: { kind: "count_increase", player: "self", amount: 5 },
            connector: "conditional_cost" as const,
          },
        ],
      };
      const result = runEffect(state, effect);
      // Cost failed → rollback, result not executed
      expect(getCard(result, "s1").normalCoreCount).toBe(0);
      expect(getPlayer(result, ALICE).countValue).toBe(0);
    });
  });

  // discard as cost step: 「手札1枚を破棄することで」
  describe("discard as cost step", () => {
    it("should execute result step when hand discard cost succeeds", () => {
      const handCard = createCardInstance(dummyDef({ cardNo: "HAND-001" }), {
        instanceId: "h1",
        ownerPlayerId: ALICE,
        zone: "hand",
      });
      const sourceCard = fieldCard("s1", ALICE, 1);
      const state = {
        ...createEmptyGameState({ startingVoidNormalCoreCount: 1 }),
        cardInstances: [sourceCard, handCard],
      };
      // 「手札1枚を破棄することで、カウント+1する」
      const effect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { id: "cost", action: { kind: "discard", count: 1, player: "self" } },
          {
            id: "result",
            action: { kind: "count_increase", player: "self", amount: 1 },
            connector: "conditional_cost" as const,
          },
        ],
      };
      const result = runEffect(state, effect);
      // Hand card should be in trash
      expect(getCard(result, "h1").zone).toBe("trash");
      // Count should have increased
      expect(getPlayer(result, ALICE).countValue).toBe(1);
    });
  });

  // conditional_cost with sequential follow-up: cost → result → sequential
  describe("conditional_cost with sequential follow-up", () => {
    it("should execute all steps after cost succeeds", () => {
      const state = createEmptyGameState({
        startingVoidNormalCoreCount: 3,
        playerOverrides: [{ countValue: 3 }, {}],
      });
      // 「カウント-1することで、カウント+2する。その後、カウント+1する」
      const effect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "cost",
            action: { kind: "count_decrease", player: "self", amount: 1 },
          },
          {
            id: "result",
            action: { kind: "count_increase", player: "self", amount: 2 },
            connector: "conditional_cost" as const,
          },
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            connector: "sequential" as const,
          },
        ],
      };
      const result = runEffect(state, effect);
      // count: 3 - 1 + 2 + 1 = 5
      expect(getPlayer(result, ALICE).countValue).toBe(5);
    });
  });
});
