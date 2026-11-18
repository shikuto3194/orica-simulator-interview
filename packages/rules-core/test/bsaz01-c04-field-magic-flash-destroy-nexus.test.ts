/** 作戦の常時使用許可と、通常マジック使用で発揮する本文の検証。 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateFieldCardEffectRegistrations,
  generateMagicRegistrations,
  calculateReduction,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C04 = cardNoMap.get("BSAZ01-C04")!;
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const NEXUS_DEF: CardDefinition = {
  cardNo: "TEST-OPPONENT-NEXUS",
  name: "test opponent nexus",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "地球",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const GRANDWALKER_NEXUS_DEF: CardDefinition = {
  ...NEXUS_DEF,
  cardNo: "TEST-OPPONENT-GRANDWALKER-NEXUS",
  name: "test opponent grandwalker nexus",
  grandwalkerData: { kind: "guided" },
};

const IZANAHO_DEF: CardDefinition = {
  cardNo: "TEST-IZANAHO",
  name: "界塚伊奈帆",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  tribe: "地球",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const getCardDefinitionByIdWithTestCards = (id: string) =>
  cardNoMap.get(id) ??
  (id === NEXUS_DEF.cardNo
    ? NEXUS_DEF
    : id === GRANDWALKER_NEXUS_DEF.cardNo
      ? GRANDWALKER_NEXUS_DEF
      : id === IZANAHO_DEF.cardNo
        ? IZANAHO_DEF
        : undefined);

describe("BSAZ01-C04 effects[1]: 使用時の印字済み軽減枠充足", () => {
  it("自分のフィールドにマジックが1枚あれば軽減1枠が満たされ支払いが1減る", () => {
    const other = { ...C04, cardNo: "TEST-OTHER-MAGIC-C04" } as CardDefinition;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(other, {
          instanceId: "field-magic-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
      ],
    });
    state.cardInstances.push(
      createCardInstance(C04, {
        instanceId: "paying",
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    const result = calculateReduction({
      card: C04,
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) =>
        id === other.cardNo ? other : getCardDefinitionById(id),
      sourceInstanceId: "paying",
    });
    expect(result.reducedCost).toBe(
      Math.max(0, C04.cost - Math.min(1, C04.reductionSymbols.length))
    );
    expect(result.totalReduction).toBe(
      Math.min(1, C04.reductionSymbols.length)
    );
  });
});

describe("BSAZ01-C04 effects[2]: メイン (自分のデッキを上から3枚破棄する)", () => {
  it("effect 定義: mode:main + applicability 省略 (通常の手札使用) + deck_reveal(3, picks:[], remainder:trash)", () => {
    const effect = C04.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef.includes(7) &&
        e.textRef.includes(8)
    )!;
    expect(effect).toBeDefined();
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "main" });
    expect(effect.applicability).toBeUndefined();
    const action = effect.steps[0]!.action;
    expect(action).toEqual({
      kind: "discard",
      player: "self",
      fromZone: "deck",
      count: 3,
    });
  });

  it("generateMagicRegistrations は timing:main で1件登録する", () => {
    const regs = generateMagicRegistrations(C04);
    const mainRegs = regs.filter((r) => r.timing === "main");
    expect(mainRegs).toHaveLength(1);
  });
});

describe("BSAZ01-C04 effects[3]/[4]: フラッシュ (界塚伊奈帆がいる自分のターンなら相手のネクサス/創界神ネクサス1つを破壊する)", () => {
  it("effect[3] 定義: mode:flash + applicability 省略 (通常の手札使用) + field_has(includeSoulState) + turn_player + destroy(targetsGrandwalker:true)", () => {
    const effect = C04.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef.length === 2 &&
        e.textRef.includes(10) &&
        e.textRef.includes(11)
    )!;
    expect(effect).toBeDefined();
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.applicability).toBeUndefined();
    expect(effect.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "界塚伊奈帆" }],
        includeSoulState: true,
      },
      { kind: "turn_player", player: "self" },
    ]);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("destroy");
    if (action.kind !== "destroy") throw new Error("unreachable");
    expect(action.target).toEqual({
      kind: "filter",
      player: "opponent",
      filter: { category: ["nexus"], targetsGrandwalker: true },
      count: 1,
    });
  });

  it("場の作戦は通常使用を許可する常時効果を持つ", () => {
    expect(
      C04.effects!.find((e) =>
        e.steps.some((s) => s.action.kind === "grant_magic_use")
      )
    ).toMatchObject({
      timing: { kind: "continuous" },
      applicability: { zone: "field" },
      timingScope: { player: "both", period: "attack" },
    });
  });

  it("使用許可を無償のフィールド起動効果として登録しない", () => {
    expect(generateFieldCardEffectRegistrations(C04)).toHaveLength(0);
  });

  function baseState(opts: {
    includeIzanaho: boolean;
    activePlayerId: "alice" | "bob";
    opponentNexus: CardDefinition;
  }): GameState {
    const c04Field = createCardInstance(C04, {
      instanceId: "c04-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const opponentNexus = createCardInstance(opts.opponentNexus, {
      instanceId: "bob-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const cardInstances = [c04Field, opponentNexus];
    if (opts.includeIzanaho) {
      cardInstances.push(
        createCardInstance(IZANAHO_DEF, {
          instanceId: "alice-izanaho",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        })
      );
    }
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances,
      }),
      activePlayerId: opts.activePlayerId,
    };
  }

  it("[board] 界塚伊奈帆がいる自分のターンで実行すると、相手の創界神ネクサスが破壊 (pending-leave) される", () => {
    const state = baseState({
      includeIzanaho: true,
      activePlayerId: "alice",
      opponentNexus: GRANDWALKER_NEXUS_DEF,
    });
    const effect = C04.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
    )!;
    const after = executeEffect({
      chainId: "test:bsaz01-c04-field-magic-flash-destroy-nexus:240",
      state,
      effect,
      sourceInstanceId: "c04-field",
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithTestCards,
    });
    const pendingInstanceIds = after.pendingLeaveEntities.map(
      (p) => p.instanceId
    );
    expect(pendingInstanceIds).toContain("bob-nexus");
  });

  it("[board] 界塚伊奈帆がいる自分のターンで実行すると、相手の通常ネクサスも破壊対象になる (targetsGrandwalker:true は grandwalker を除外しない)", () => {
    const state = baseState({
      includeIzanaho: true,
      activePlayerId: "alice",
      opponentNexus: NEXUS_DEF,
    });
    const effect = C04.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
    )!;
    const after = executeEffect({
      chainId: "test:bsaz01-c04-field-magic-flash-destroy-nexus:260",
      state,
      effect,
      sourceInstanceId: "c04-field",
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithTestCards,
    });
    const pendingInstanceIds = after.pendingLeaveEntities.map(
      (p) => p.instanceId
    );
    expect(pendingInstanceIds).toContain("bob-nexus");
  });

  it("[board] 界塚伊奈帆がいなければ条件不成立で破壊されない", () => {
    const state = baseState({
      includeIzanaho: false,
      activePlayerId: "alice",
      opponentNexus: GRANDWALKER_NEXUS_DEF,
    });
    const effect = C04.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
    )!;
    const after = executeEffect({
      chainId: "test:bsaz01-c04-field-magic-flash-destroy-nexus:280",
      state,
      effect,
      sourceInstanceId: "c04-field",
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithTestCards,
    });
    expect(after.pendingLeaveEntities).toHaveLength(0);
  });

  it("[board] 界塚伊奈帆がいても相手のターンなら条件不成立で破壊されない", () => {
    const state = baseState({
      includeIzanaho: true,
      activePlayerId: "bob",
      opponentNexus: GRANDWALKER_NEXUS_DEF,
    });
    const effect = C04.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
    )!;
    const after = executeEffect({
      chainId: "test:bsaz01-c04-field-magic-flash-destroy-nexus:297",
      state,
      effect,
      sourceInstanceId: "c04-field",
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithTestCards,
    });
    expect(after.pendingLeaveEntities).toHaveLength(0);
  });
});
