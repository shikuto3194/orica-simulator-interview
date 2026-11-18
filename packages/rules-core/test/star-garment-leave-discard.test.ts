/**
 * P3-100 星霊衣 star_garment — S2 離脱破棄。
 *
 * host がフィールドを離れたとき、下の星霊衣 (text_role roleTag="星霊衣") アンダーカードは
 * host の行き先に関わらず常にトラッシュへ破棄され、A面へ戻る (07b §6)。煌臨元の host 追従とは別。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { flushPendingLeaves } from "../src/state-based-actions";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PendingLeaveEntity,
} from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

const HOST_DEF = {
  cardNo: "SG-HOST",
  name: "ルーシィ",
  printedCategory: "spirit",
  printedColors: ["blue"],
  symbolColors: ["guide"],
  printedCost: 2,
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  textLines: [],
  images: {},
  tribe: "星霊魔導士",
  colors: ["blue"],
} as CardDefinition;

const BRAVE_A_DEF = {
  cardNo: "SG-BRAVE-A",
  name: "宝瓶宮の鍵",
  printedCategory: "brave",
  printedColors: ["blue"],
  symbolColors: [],
  printedCost: 5,
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  textLines: [],
  images: {},
  tribe: "鍵・光導",
  colors: ["blue"],
} as CardDefinition;

const BRAVE_B_DEF = {
  cardNo: "SG-BRAVE-B",
  name: "アクエリアス",
  printedCategory: "spirit",
  printedColors: ["blue"],
  symbolColors: ["guide"],
  printedCost: 8,
  cost: 8,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 7000 }],
  textLines: [],
  images: {},
  tribe: "光導・星霊",
  colors: ["blue"],
} as CardDefinition;

const defMap = new Map<string, CardDefinition>([
  ["SG-HOST", HOST_DEF],
  ["SG-BRAVE-A", BRAVE_A_DEF],
  ["SG-BRAVE-B", BRAVE_B_DEF],
]);
const getDef = (id: string): CardDefinition | undefined => defMap.get(id);

function pendingDestroy(instanceId: string): PendingLeaveEntity {
  return {
    instanceId,
    kind: "destroy",
    cause: "effect_resolution",
    causePlayerId: BOB,
    chainId: `chain-${instanceId}`,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
  };
}

/** host(星霊衣アンダーカード sg-1 を持つ) + 星霊衣カード sg-1(B面表示) の state。 */
function makeState(): GameState {
  const host: CardInstance = createCardInstance(HOST_DEF, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
    pendingLeaveKind: "destroy",
    pendingLeaveCause: "effect_resolution",
    pendingLeaveChainId: "chain-host-1",
  });
  host.underCards = [
    { cardInstanceId: "sg-1", role: "text_role", roleTag: "星霊衣" },
  ];

  // sg-1: 配置で B面表示・A面が original。
  const sg: CardInstance = createCardInstance(BRAVE_A_DEF, {
    instanceId: "sg-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  sg.definitionId = "SG-BRAVE-B";
  sg.attachedToInstanceId = "host-1";
  sg.zoneRoleName = "star-garment";

  const state = createEmptyGameState({
    cardInstances: [host, sg],
    playerIds: [ALICE, BOB],
  });
  state.pendingLeaveEntities = [pendingDestroy("host-1")];
  return state;
}

describe("P3-100 star_garment: S2 離脱破棄", () => {
  it("host 破壊で星霊衣アンダーカードはトラッシュへ破棄され A面へ戻る", () => {
    const after = flushPendingLeaves(makeState(), getDef);

    const sg = after.cardInstances.find((c) => c.instanceId === "sg-1")!;
    // トラッシュへ破棄（フィールドに孤児として残らない）。
    expect(sg.zone).toBe("trash");
    // B面 → A面 (original) へ復帰。
    expect(sg.definitionId).toBe("SG-BRAVE-A");
    // host への紐付け解除。
    expect(sg.attachedToInstanceId).toBeNull();

    // host もトラッシュ・underCards クリア。
    const host = after.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(host.zone).toBe("trash");
    expect(host.underCards).toEqual([]);
  });
});
