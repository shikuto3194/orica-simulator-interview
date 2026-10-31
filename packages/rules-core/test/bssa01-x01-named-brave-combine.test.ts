/**
 * BSSA01-X01 修剣士キリト の
 * 「このスピリットは「夜空の剣」1つと「赤薔薇の剣」1つと合体できる。」検証。
 *
 * BSTH01-X02（ミニ八卦炉2つまで＆魔理沙の箒1つ）と同型の名指し合体許可。
 * 夜空の剣/赤薔薇の剣（BSSA01-転醒X01(B)/BSSA01-転醒X02(B)、いずれも backFace）は
 * 自身の braveCondition（C2/C3以上かつコスト7以上）を満たしたうえで、
 * host 側の maxCombinedBraves.condition/nameLimits が対象名と名前別上限を制約する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import {
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const hostDef = cardNoMap.get("BSSA01-X01")!;
const nightSkySword = cardNoMap.get("BSSA01-転醒X01(B)")!; // 「夜空の剣」1つまで
const redRoseSword = cardNoMap.get("BSSA01-転醒X02(B)")!; // 「赤薔薇の剣」1つまで

// 名前が「夜空の剣」「赤薔薇の剣」いずれでもない、braveCondition 無しの第三のブレイヴ
// （通常1枠では許可され、多重枠では対象外になる対照群）。
const otherBrave: CardDefinition = {
  cardNo: "TEST-OTHER-BRAVE",
  name: "別のブレイヴ",
  printedCategory: "brave",
  colors: ["purple"],
  cost: 7,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["purple"],
  textLines: [],
  tribe: "夜錆",
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const lookup = (id: string) =>
  getCardDefinitionById(id) ?? [otherBrave].find((d) => d.cardNo === id);

function combineActionsFor(state: GameState, hostInstanceId: string) {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    getRegisteredFieldCardEffectActions: () => undefined,
  }).filter(
    (a) => a.kind === "brave_combine" && a.targetInstanceId === hostInstanceId
  );
}

function withAliceCount(state: GameState, countValue: number): GameState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === "alice" ? { ...player, countValue } : player
    ),
  };
}

describe("BSSA01-X01「夜空の剣」「赤薔薇の剣」の名前別合体許可", () => {
  it("構造: effects[1] stub なし、maxCombinedBraves で2名限定", () => {
    expect(hostDef.effects![1]!.stub).toBeUndefined();
    expect(hostDef.maxCombinedBraves).toEqual({
      count: 2,
      condition: { cardNameContains: ["夜空の剣", "赤薔薇の剣"] },
      effectIndex: 1,
      nameLimits: [
        { cardNameContains: "夜空の剣", maxCount: 1 },
        { cardNameContains: "赤薔薇の剣", maxCount: 1 },
      ],
    });
  });

  it("未合体の状態で「夜空の剣」「赤薔薇の剣」どちらとも合体できる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const sword1 = createCardInstance(nightSkySword, {
      instanceId: "sword1-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const sword2 = createCardInstance(redRoseSword, {
      instanceId: "sword2-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const state = withAliceCount(
      {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [host, sword1, sword2],
      },
      3
    );

    const combines = combineActionsFor(state, "host-1");
    expect(combines.some((a) => a.braveInstanceId === "sword1-1")).toBe(true);
    expect(combines.some((a) => a.braveInstanceId === "sword2-1")).toBe(true);
  });

  it("指定外1つは通常枠で合体できるが、指定内との2つ合体はできない (Q15380)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const other = createCardInstance(otherBrave, {
      instanceId: "other-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const state = withAliceCount(
      {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [host, other],
      },
      3
    );

    const combines = combineActionsFor(state, "host-1");
    expect(combines.some((a) => a.braveInstanceId === "other-1")).toBe(true);
    const sword = createCardInstance(nightSkySword, {
      instanceId: "existing-sword",
      ownerPlayerId: "alice",
      zone: "field",
      attachedToInstanceId: host.instanceId,
    });
    const withSword = {
      ...state,
      cardInstances: [
        { ...host, attachedChildrenIds: [sword.instanceId] },
        other,
        sword,
      ],
    };
    expect(
      combineActionsFor(withSword, "host-1").some(
        (a) => a.braveInstanceId === "other-1"
      )
    ).toBe(false);
  });

  it("「夜空の剣」1体合体済み (名前別上限到達) のとき、2体目とは合体できないが「赤薔薇の剣」とは合体できる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      }),
      attachedChildrenIds: ["sword1-existing"],
    };
    const existing = {
      ...createCardInstance(nightSkySword, {
        instanceId: "sword1-existing",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 0,
      }),
      attachedToInstanceId: "host-1",
    };
    const candidate = createCardInstance(nightSkySword, {
      instanceId: "sword1-2",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const redRoseCandidate = createCardInstance(redRoseSword, {
      instanceId: "sword2-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const state = withAliceCount(
      {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [host, existing, candidate, redRoseCandidate],
      },
      3
    );

    const combines = combineActionsFor(state, "host-1");
    expect(combines.some((a) => a.braveInstanceId === "sword1-2")).toBe(false);
    expect(combines.some((a) => a.braveInstanceId === "sword2-1")).toBe(true);
  });
});
