/**
 * BSTH01-X02 [紅魔郷]霧雨 魔理沙 の
 * 「このスピリットは「ミニ八卦炉」2つまでと「魔理沙の箒」1つと合体できる。」検証。
 *
 * P3-16 多重合体クラスタの `maxCombinedBraves` (count + condition) だけでは
 * カード名ごとの個別上限 (2つまで / 1つまで) を表現できないため、`nameLimits` を追加した
 * (model.ts CardDefinition.maxCombinedBraves.nameLimits、
 * legal-actions-shared.ts canReceiveBraveWithinCombineLimit)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const hostDef = cardNoMap.get("BSTH01-X02")!;
const miniHakkero = cardNoMap.get("BSTH01-R03")!; // 「ミニ八卦炉」2つまで
const marisaBroom = cardNoMap.get("BSTH01-R02")!; // 「魔理沙の箒」1つまで

// 系統「導魔」/コスト6以上を満たす (=X02とは元々合体条件を満たす) が、
// カード名が「ミニ八卦炉」「魔理沙の箒」いずれでもない第三のブレイヴ。
const otherDoumaBrave: CardDefinition = {
  cardNo: "TEST-OTHER-DOUMA-BRAVE",
  name: "別の導魔ブレイヴ",
  printedCategory: "brave",
  colors: ["yellow"],
  cost: 6,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["yellow"],
  textLines: [],
  tribe: "導魔",
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  braveCondition: { tribes: ["導魔"], minCost: 6 },
};

const lookup = (id: string) =>
  getCardDefinitionById(id) ?? [otherDoumaBrave].find((d) => d.cardNo === id);

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

describe("BSTH01-X02「ミニ八卦炉」2つまでと「魔理沙の箒」1つの名前別合体上限", () => {
  it("構造: effects[1] stub なし、maxCombinedBraves に nameLimits を持つ", () => {
    expect(hostDef.effects![1]!.stub).toBeUndefined();
    expect(hostDef.maxCombinedBraves).toEqual({
      count: 3,
      effectIndex: 1,
      condition: { cardNameContains: ["ミニ八卦炉", "魔理沙の箒"] },
      nameLimits: [
        { cardNameContains: "ミニ八卦炉", maxCount: 2 },
        { cardNameContains: "魔理沙の箒", maxCount: 1 },
      ],
    });
  });

  it("未合体の状態で「ミニ八卦炉」「魔理沙の箒」どちらとも合体できる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const hakkero = createCardInstance(miniHakkero, {
      instanceId: "hakkero-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const broom = createCardInstance(marisaBroom, {
      instanceId: "broom-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [host, hakkero, broom],
    };

    const combines = combineActionsFor(state, "host-1");
    expect(combines.some((a) => a.braveInstanceId === "hakkero-1")).toBe(true);
    expect(combines.some((a) => a.braveInstanceId === "broom-1")).toBe(true);
  });

  it("通常条件を満たす別名のブレイヴ1つとは合体できる (Q15380)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const other = createCardInstance(otherDoumaBrave, {
      instanceId: "other-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [host, other],
    };

    const combines = combineActionsFor(state, "host-1");
    expect(combines.some((a) => a.braveInstanceId === "other-1")).toBe(true);
  });

  it("「ミニ八卦炉」1体合体済みでも2体目とは合体できる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      }),
      attachedChildrenIds: ["hakkero-existing"],
    };
    const existing = {
      ...createCardInstance(miniHakkero, {
        instanceId: "hakkero-existing",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 0,
      }),
      attachedToInstanceId: "host-1",
    };
    const candidate = createCardInstance(miniHakkero, {
      instanceId: "hakkero-2",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [host, existing, candidate],
    };

    const combines = combineActionsFor(state, "host-1");
    expect(combines.some((a) => a.braveInstanceId === "hakkero-2")).toBe(true);
  });

  it("「ミニ八卦炉」2体合体済み (名前別上限到達) のとき、3体目とは合体できない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      }),
      attachedChildrenIds: ["hakkero-existing-1", "hakkero-existing-2"],
    };
    const existing1 = {
      ...createCardInstance(miniHakkero, {
        instanceId: "hakkero-existing-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 0,
      }),
      attachedToInstanceId: "host-1",
    };
    const existing2 = {
      ...createCardInstance(miniHakkero, {
        instanceId: "hakkero-existing-2",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 0,
      }),
      attachedToInstanceId: "host-1",
    };
    const candidate = createCardInstance(miniHakkero, {
      instanceId: "hakkero-3",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const broomCandidate = createCardInstance(marisaBroom, {
      instanceId: "broom-1",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [host, existing1, existing2, candidate, broomCandidate],
    };

    const combines = combineActionsFor(state, "host-1");
    expect(combines.some((a) => a.braveInstanceId === "hakkero-3")).toBe(false);
    // 「魔理沙の箒」枠 (別名) はまだ空いているので合体できる（合計上限3にも収まる）。
    expect(combines.some((a) => a.braveInstanceId === "broom-1")).toBe(true);
  });

  it("「魔理沙の箒」1体合体済み (名前別上限1到達) のとき、2体目とは合体できない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      }),
      attachedChildrenIds: ["broom-existing"],
    };
    const existing = {
      ...createCardInstance(marisaBroom, {
        instanceId: "broom-existing",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 0,
      }),
      attachedToInstanceId: "host-1",
    };
    const candidate = createCardInstance(marisaBroom, {
      instanceId: "broom-2",
      ownerPlayerId: "alice",
      zone: "field" as const,
      cores: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [host, existing, candidate],
    };

    const combines = combineActionsFor(state, "host-1");
    expect(combines.some((a) => a.braveInstanceId === "broom-2")).toBe(false);
  });
});
