/**
 * BSDB01-CX01【真バディ：「孫悟空」/「ベジータ」】host exclusive-lock の残り subsystem。
 *
 * 「重なったカードを含むこれらには対象以外を合体/煌臨/入れ替えできない」のうち、
 * 煌臨側 (isExcludedByHostExclusiveLock, advent-system.ts の対象列挙器 3 種) は
 * host-dual-advent.test.ts で検証済み。本ファイルは同じ SSOT を再利用する
 * 合体 (brave-combine / contract-combine, legal-actions-availability.ts) / 入れ替え
 * (brave-swap 同ファイル、change-swap は accel-change-system.ts の
 * getChangeSwapCandidates) を検証する。「合体/入れ替え」は brave_combine/change-swap に
 * 限定されない (adversarial verifier round1 lens1 指摘) ため、契約合体
 * (getAvailableContractCombineLegalActions) とブレイヴ入れ替え
 * (getAvailableBraveSwapLegalActions) も対象に含める。
 *
 * needs-dsl.w1.jsonl: BSDB01-CX01 [0,1]。cluster: bsdb01-cx01-shinbuddy-brave-swap-lock。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getChangeSwapCandidates,
  getLegalActions,
} from "../src/runtime";
import type { CardDefinition, GameState } from "../src/runtime";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const HOST_NO = "BSDB01-CX01"; // 孫悟空＆ベジータ (真バディ、exclusiveToSlots: 孫悟空/ベジータ)

const UNPROTECTED_HOST: CardDefinition = {
  cardNo: "TEST-CX01LOCK-HOST2",
  name: "無関係のスピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const THIRD_PARTY_BRAVE: CardDefinition = {
  cardNo: "TEST-CX01LOCK-BRAVE-THIRD",
  name: "フリーザ",
  printedCategory: "brave",
  colors: ["purple"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const GOKU_BRAVE: CardDefinition = {
  cardNo: "TEST-CX01LOCK-BRAVE-GOKU",
  name: "孫悟空(界王拳)",
  printedCategory: "brave",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const THIRD_PARTY_CHANGE: CardDefinition = {
  cardNo: "TEST-CX01LOCK-CHANGE-THIRD",
  name: "ピッコロ",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const VEGETA_CHANGE: CardDefinition = {
  cardNo: "TEST-CX01LOCK-CHANGE-VEGETA",
  name: "ベジータ(超サイヤ人)",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const THIRD_PARTY_CONTRACT_BRAVE: CardDefinition = {
  cardNo: "TEST-CX01LOCK-CONTRACT-THIRD",
  name: "セル",
  printedCategory: "brave",
  colors: ["purple"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  contractCombineData: {
    braveCondition: {},
    timingScope: { player: "self", period: "turn" },
  },
  effects: [],
};

const GOKU_CONTRACT_BRAVE: CardDefinition = {
  cardNo: "TEST-CX01LOCK-CONTRACT-GOKU",
  name: "孫悟空(契約合体)",
  printedCategory: "brave",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  contractCombineData: {
    braveCondition: {},
    timingScope: { player: "self", period: "turn" },
  },
  effects: [],
};

const testDefs = [
  UNPROTECTED_HOST,
  THIRD_PARTY_BRAVE,
  GOKU_BRAVE,
  THIRD_PARTY_CHANGE,
  VEGETA_CHANGE,
  THIRD_PARTY_CONTRACT_BRAVE,
  GOKU_CONTRACT_BRAVE,
];
const getCardDefinitionById = (id: string) =>
  cardNoMap.get(id) ?? testDefs.find((d) => d.cardNo === id);

describe("BSDB01-CX01【真バディ】host exclusive-lock: brave-combine", () => {
  function buildCombineState(): GameState {
    const host = createCardInstance(card(HOST_NO), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const host2 = createCardInstance(UNPROTECTED_HOST, {
      instanceId: "host2-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const thirdPartyBrave = createCardInstance(THIRD_PARTY_BRAVE, {
      instanceId: "brave-third-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const gokuBrave = createCardInstance(GOKU_BRAVE, {
      instanceId: "brave-goku-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    return {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [host, host2, thirdPartyBrave, gokuBrave],
    };
  }

  it("保護中の host (CX01) へは、名前が一致しない第三者ブレイヴは合体できない", () => {
    const state = buildCombineState();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).filter(
      (a) =>
        a.kind === "brave_combine" &&
        a.braveInstanceId === "brave-third-1" &&
        a.targetInstanceId === "host-1"
    );
    expect(actions.length).toBe(0);
  });

  it("保護中の host (CX01) へも、slots.cardNames に一致するブレイヴ (孫悟空) は合体できる", () => {
    const state = buildCombineState();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).filter(
      (a) =>
        a.kind === "brave_combine" &&
        a.braveInstanceId === "brave-goku-1" &&
        a.targetInstanceId === "host-1"
    );
    expect(actions.length).toBe(1);
  });

  it("保護されていない host2 へは第三者ブレイヴも通常通り合体できる（過剰除外していないことの対照）", () => {
    const state = buildCombineState();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).filter(
      (a) =>
        a.kind === "brave_combine" &&
        a.braveInstanceId === "brave-third-1" &&
        a.targetInstanceId === "host2-1"
    );
    expect(actions.length).toBe(1);
  });
});

describe("BSDB01-CX01【真バディ】host exclusive-lock: contract-combine", () => {
  function buildContractCombineState(): GameState {
    const host = createCardInstance(card(HOST_NO), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const host2 = createCardInstance(UNPROTECTED_HOST, {
      instanceId: "host2-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const thirdPartyContractBrave = createCardInstance(
      THIRD_PARTY_CONTRACT_BRAVE,
      {
        instanceId: "contract-third-1",
        ownerPlayerId: ALICE,
        zone: "hand",
      }
    );
    const gokuContractBrave = createCardInstance(GOKU_CONTRACT_BRAVE, {
      instanceId: "contract-goku-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    return {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ soulCoreLocation: { kind: "reserve" } }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [host, host2, thirdPartyContractBrave, gokuContractBrave],
    };
  }

  it("保護中の host (CX01) へは、名前が一致しない第三者ブレイヴは契約合体できない", () => {
    const state = buildContractCombineState();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).filter(
      (a) =>
        a.kind === "contract_combine" &&
        a.braveInstanceId === "contract-third-1" &&
        a.candidateTargetInstanceIds.includes("host-1")
    );
    expect(actions.length).toBe(0);
  });

  it("保護中の host (CX01) へも、slots.cardNames に一致するブレイヴ (孫悟空) は契約合体できる", () => {
    const state = buildContractCombineState();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).filter(
      (a) =>
        a.kind === "contract_combine" &&
        a.braveInstanceId === "contract-goku-1" &&
        a.candidateTargetInstanceIds.includes("host-1")
    );
    expect(actions.length).toBe(1);
  });

  it("保護されていない host2 へは第三者ブレイヴも通常通り契約合体できる（過剰除外していないことの対照）", () => {
    const state = buildContractCombineState();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).filter(
      (a) =>
        a.kind === "contract_combine" &&
        a.braveInstanceId === "contract-third-1" &&
        a.candidateTargetInstanceIds.includes("host2-1")
    );
    expect(actions.length).toBe(1);
  });
});

describe("BSDB01-CX01【真バディ】host exclusive-lock: brave-swap (ブレイヴ入れ替え)", () => {
  function buildBraveSwapState(): GameState {
    const host = createCardInstance(card(HOST_NO), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const host2 = createCardInstance(UNPROTECTED_HOST, {
      instanceId: "host2-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // fromHost: 第三者ブレイヴが既に合体中の、無関係な既存 host。
    const fromHost = createCardInstance(UNPROTECTED_HOST, {
      instanceId: "from-host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["brave-third-1"],
    });
    const thirdPartyBrave = createCardInstance(THIRD_PARTY_BRAVE, {
      instanceId: "brave-third-1",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "from-host-1",
    });
    return {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [host, host2, fromHost, thirdPartyBrave],
    };
  }

  it("保護中の host (CX01) へは、名前が一致しない第三者ブレイヴを入れ替えできない", () => {
    const state = buildBraveSwapState();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).filter(
      (a) =>
        a.kind === "brave_swap" &&
        a.braveInstanceId === "brave-third-1" &&
        a.toHostInstanceId === "host-1"
    );
    expect(actions.length).toBe(0);
  });

  it("保護されていない host2 へは第三者ブレイヴも通常通り入れ替えできる（過剰除外していないことの対照）", () => {
    const state = buildBraveSwapState();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).filter(
      (a) =>
        a.kind === "brave_swap" &&
        a.braveInstanceId === "brave-third-1" &&
        a.toHostInstanceId === "host2-1"
    );
    expect(actions.length).toBe(1);
  });
});

describe("BSDB01-CX01【真バディ】host exclusive-lock: change-swap (getChangeSwapCandidates)", () => {
  function buildChangeState(): GameState {
    const host = createCardInstance(card(HOST_NO), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const host2 = createCardInstance(UNPROTECTED_HOST, {
      instanceId: "host2-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [host, host2],
    };
  }

  it("保護中の host (CX01) は、名前が一致しない第三者チェンジカードの入れ替え候補から除外される", () => {
    const state = buildChangeState();
    const candidates = getChangeSwapCandidates({
      state,
      actingPlayerId: ALICE,
      swapCondition: {},
      getCardDefinitionById,
      changeCardDef: THIRD_PARTY_CHANGE,
    });
    expect(candidates).toContain("host2-1");
    expect(candidates).not.toContain("host-1");
  });

  it("保護中の host (CX01) も、slots.cardNames に一致するチェンジカード (ベジータ) からは入れ替え候補に含まれる", () => {
    const state = buildChangeState();
    const candidates = getChangeSwapCandidates({
      state,
      actingPlayerId: ALICE,
      swapCondition: {},
      getCardDefinitionById,
      changeCardDef: VEGETA_CHANGE,
    });
    expect(candidates).toContain("host-1");
  });

  it("changeCardDef 未指定 (呼び出し元がチェンジカードを特定できない経路) は安全側に倒し host を除外する", () => {
    const state = buildChangeState();
    const candidates = getChangeSwapCandidates({
      state,
      actingPlayerId: ALICE,
      swapCondition: {},
      getCardDefinitionById,
    });
    expect(candidates).not.toContain("host-1");
    expect(candidates).toContain("host2-1");
  });
});
