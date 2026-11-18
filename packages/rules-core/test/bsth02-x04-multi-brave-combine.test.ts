/**
 * BSTH02-X04 [妖々夢]霧雨 魔理沙 / BSTH08-C05 [強欲の魔法使い]霧雨 魔理沙 /
 * BSTH09-M02 [普通の魔法使い]霧雨 魔理沙 の「系統：「導魔」を持つブレイヴ3つまで合体できる」
 * (多重合体キーワード) 検証。P3-16 多重合体クラスタ。
 *
 * 従来は 1 ホストにつきブレイヴ1体までしか合体できない前提だったため、
 * `maxCombinedBraves` (model.ts CardDefinition) で「系統条件を満たすブレイヴに限り
 * count 体まで合体可能」を表現する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  getCombinedUnitBp,
  applyLegalAction,
  buildTriggeredEffectLookup,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const marisaX04 = cardNoMap.get("BSTH02-X04")!;
const marisaC05 = cardNoMap.get("BSTH08-C05")!;
const marisaM02 = cardNoMap.get("BSTH09-M02")!;

const doumaBrave = (cardNo: string, combinedBoost: number): CardDefinition => ({
  cardNo,
  name: `導魔ブレイヴ ${cardNo}`,
  printedCategory: "brave",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  combinedBoost,
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["yellow"],
  textLines: [],
  tribe: "導魔",
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
});

const nonDoumaBrave: CardDefinition = {
  cardNo: "TEST-NON-DOUMA-BRAVE",
  name: "非導魔ブレイヴ",
  printedCategory: "brave",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["yellow"],
  textLines: [],
  tribe: "妖精",
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const braveA = doumaBrave("TEST-DOUMA-A", 1000);
const braveB = doumaBrave("TEST-DOUMA-B", 1500);
const braveC = doumaBrave("TEST-DOUMA-C", 2000);
const braveCandidate = doumaBrave("TEST-DOUMA-CANDIDATE", 500);

const lookup = (id: string) =>
  getCardDefinitionById(id) ??
  [braveA, braveB, braveC, braveCandidate, nonDoumaBrave].find(
    (d) => d.cardNo === id
  );
const triggeredLookup = buildTriggeredEffectLookup([
  ...ALL_CARDS,
  braveA,
  braveB,
  braveC,
  braveCandidate,
  nonDoumaBrave,
]);

function combineActionsFor(state: GameState, hostInstanceId: string) {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredFieldCardEffectActions: () => undefined,
  }).filter(
    (a) => a.kind === "brave_combine" && a.targetInstanceId === hostInstanceId
  );
}

describe.each([marisaX04, marisaC05, marisaM02])(
  "$cardNo 多重合体 (系統「導魔」ブレイヴ3つまで)",
  (hostDef) => {
    it("導魔3枚を順に合体した最終盤面にコアとBPを合算し、4枚目は残す", () => {
      let state: GameState = {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        activePlayerId: "alice",
        step: "main",
        cardInstances: [
          createCardInstance(hostDef, {
            instanceId: "host-1",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          ...[braveA, braveB, braveC, braveCandidate].map((definition, index) =>
            createCardInstance(definition, {
              instanceId: `brave-${index}`,
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            })
          ),
        ],
      };
      for (let index = 0; index < 3; index++) {
        const action = combineActionsFor(state, "host-1").find(
          (candidate) => candidate.braveInstanceId === `brave-${index}`
        );
        expect(action).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: triggeredLookup,
        }).state;
        expect(state.stackWindow).toBeNull();
      }
      const host = state.cardInstances.find(
        (card) => card.instanceId === "host-1"
      )!;
      expect(host.attachedChildrenIds).toEqual([
        "brave-0",
        "brave-1",
        "brave-2",
      ]);
      expect(host.normalCoreCount).toBe(4);
      for (let index = 0; index < 3; index++) {
        expect(
          state.cardInstances.find(
            (card) => card.instanceId === `brave-${index}`
          )
        ).toMatchObject({
          attachedToInstanceId: "host-1",
          normalCoreCount: 0,
        });
      }
      expect(getCombinedUnitBp(state, host, hostDef, lookup)).toBe(
        10000 + 4500
      );
      expect(combineActionsFor(state, "host-1")).toEqual([]);
      expect(
        state.cardInstances.find((card) => card.instanceId === "brave-3")
      ).toMatchObject({
        zone: "field",
        attachedToInstanceId: null,
        normalCoreCount: 1,
      });
    });

    it(`構造: effects[1] stub なし、maxCombinedBraves={count:3, tribes:["導魔"]}`, () => {
      expect(hostDef.effects![1]!.stub).toBeUndefined();
      expect(hostDef.maxCombinedBraves).toEqual({
        count: 3,
        effectIndex: 1,
        condition: { tribes: ["導魔"] },
      });
    });

    it("多重合体の上限許可は導魔ブレイヴ自身の合体条件を免除しない", () => {
      const restrictedBrave: CardDefinition = {
        ...doumaBrave("TEST-DOUMA-RESTRICTED", 2000),
        braveCondition: { minCost: 100 },
      };
      const getDef = (id: string) =>
        id === restrictedBrave.cardNo ? restrictedBrave : lookup(id);
      const state: GameState = {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        activePlayerId: "alice",
        step: "main",
        cardInstances: [
          createCardInstance(hostDef, {
            instanceId: "host-1",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          ...[braveA, restrictedBrave].map((definition, index) =>
            createCardInstance(definition, {
              instanceId: `candidate-${index}`,
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            })
          ),
        ],
      };
      const actions = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
      }).filter(
        (action) =>
          action.kind === "brave_combine" &&
          action.targetInstanceId === "host-1"
      );
      expect(
        actions.some((action) => action.braveInstanceId === "candidate-1")
      ).toBe(false);
      const allowed = actions.find(
        (action) => action.braveInstanceId === "candidate-0"
      );
      expect(allowed).toBeDefined();
      const after = applyLegalAction({
        state,
        action: allowed!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).state;
      const host = after.cardInstances.find(
        (card) => card.instanceId === "host-1"
      )!;
      expect(host.attachedChildrenIds).toEqual(["candidate-0"]);
      expect(host.normalCoreCount).toBe(2);
      expect(getCombinedUnitBp(after, host, hostDef, getDef)).toBe(
        hostDef.levelDefs[0]!.bp + 1000
      );
      expect(
        after.cardInstances.find((card) => card.instanceId === "candidate-0")
      ).toMatchObject({ attachedToInstanceId: "host-1", normalCoreCount: 0 });
      expect(
        after.cardInstances.find((card) => card.instanceId === "candidate-1")
      ).toMatchObject({
        zone: "field",
        attachedToInstanceId: null,
        normalCoreCount: 1,
      });
    });

    it("通常1枠は系統「導魔」を持たないブレイヴにも使える (Q15380)", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const host = createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      });
      const nonDouma = createCardInstance(nonDoumaBrave, {
        instanceId: "non-douma-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [host, nonDouma],
      };

      const combines = combineActionsFor(state, "host-1");
      expect(combines.some((a) => a.braveInstanceId === "non-douma-1")).toBe(
        true
      );
    });

    it("未合体 (0体目) の状態で、系統「導魔」を持つブレイヴとは合体できる (1体目)", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const host = createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      });
      const candidate = createCardInstance(braveCandidate, {
        instanceId: "candidate-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [host, candidate],
      };

      const combines = combineActionsFor(state, "host-1");
      expect(combines.some((a) => a.braveInstanceId === "candidate-1")).toBe(
        true
      );
    });

    it("既に導魔ブレイヴ1体が合体済みでも、2体目の導魔ブレイヴと合体できる", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const host = {
        ...createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 1,
        }),
        attachedChildrenIds: ["existing-1"],
      };
      const existing = {
        ...createCardInstance(braveA, {
          instanceId: "existing-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 0,
        }),
        attachedToInstanceId: "host-1",
      };
      const candidate = createCardInstance(braveCandidate, {
        instanceId: "candidate-1",
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
      expect(combines.some((a) => a.braveInstanceId === "candidate-1")).toBe(
        true
      );
    });

    it("brave_swap: 別ホストの導魔ブレイヴを、既に1体合体済みのホストへスワップできる", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const host = {
        ...createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 1,
        }),
        attachedChildrenIds: ["existing-1"],
      };
      const existing = {
        ...createCardInstance(braveA, {
          instanceId: "existing-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 0,
        }),
        attachedToInstanceId: "host-1",
      };
      const otherHostDef: CardDefinition = {
        cardNo: "TEST-OTHER-HOST",
        name: "別ホスト",
        printedCategory: "spirit",
        colors: ["yellow"],
        cost: 3,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
        symbolColors: ["yellow"],
        textLines: [],
        keywordTags: [],
        sourceUrls: [],
        sourceConfidence: "C",
      };
      const otherHostInstance = {
        ...createCardInstance(otherHostDef, {
          instanceId: "other-host-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 1,
        }),
        attachedChildrenIds: ["swap-brave-1"],
      };
      const swapBrave = {
        ...createCardInstance(braveCandidate, {
          instanceId: "swap-brave-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 0,
        }),
        attachedToInstanceId: "other-host-1",
      };
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [host, existing, otherHostInstance, swapBrave],
      };

      const swaps = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions: () => undefined,
      }).filter(
        (a) =>
          a.kind === "brave_swap" &&
          a.braveInstanceId === "swap-brave-1" &&
          a.toHostInstanceId === "host-1"
      );
      expect(swaps).toHaveLength(1);
    });

    it("brave_swap: 未合体ホストの通常枠には系統「導魔」を持たないブレイヴも移せる", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const host = createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      });
      const otherHostDef: CardDefinition = {
        cardNo: "TEST-OTHER-HOST-2",
        name: "別ホスト2",
        printedCategory: "spirit",
        colors: ["yellow"],
        cost: 3,
        reductionSymbols: [],
        levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
        symbolColors: ["yellow"],
        textLines: [],
        keywordTags: [],
        sourceUrls: [],
        sourceConfidence: "C",
      };
      const otherHostInstance = {
        ...createCardInstance(otherHostDef, {
          instanceId: "other-host-2",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 1,
        }),
        attachedChildrenIds: ["swap-brave-2"],
      };
      const swapBrave = {
        ...createCardInstance(nonDoumaBrave, {
          instanceId: "swap-brave-2",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 0,
        }),
        attachedToInstanceId: "other-host-2",
      };
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [host, otherHostInstance, swapBrave],
      };

      const swaps = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions: () => undefined,
      }).filter(
        (a) =>
          a.kind === "brave_swap" &&
          a.braveInstanceId === "swap-brave-2" &&
          a.toHostInstanceId === "host-1"
      );
      expect(swaps).toHaveLength(1);
    });

    it("既に導魔ブレイヴ1体が合体済みのとき、系統「導魔」を持たないブレイヴとは合体できない", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const host = {
        ...createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 1,
        }),
        attachedChildrenIds: ["existing-1"],
      };
      const existing = {
        ...createCardInstance(braveA, {
          instanceId: "existing-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 0,
        }),
        attachedToInstanceId: "host-1",
      };
      const nonDouma = createCardInstance(nonDoumaBrave, {
        instanceId: "non-douma-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [host, existing, nonDouma],
      };

      const combines = combineActionsFor(state, "host-1");
      expect(combines.some((a) => a.braveInstanceId === "non-douma-1")).toBe(
        false
      );
    });

    it("既に導魔ブレイヴ3体が合体済み (上限到達) のとき、4体目とは合体できない", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const host = {
        ...createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 1,
        }),
        attachedChildrenIds: ["existing-1", "existing-2", "existing-3"],
      };
      const existing1 = {
        ...createCardInstance(braveA, {
          instanceId: "existing-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 0,
        }),
        attachedToInstanceId: "host-1",
      };
      const existing2 = {
        ...createCardInstance(braveB, {
          instanceId: "existing-2",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 0,
        }),
        attachedToInstanceId: "host-1",
      };
      const existing3 = {
        ...createCardInstance(braveC, {
          instanceId: "existing-3",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 0,
        }),
        attachedToInstanceId: "host-1",
      };
      const candidate = createCardInstance(braveCandidate, {
        instanceId: "candidate-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [host, existing1, existing2, existing3, candidate],
      };

      const combines = combineActionsFor(state, "host-1");
      expect(combines).toHaveLength(0);
    });

    it("合体 BP: 導魔ブレイヴ2体分の combinedBoost がホスト BP に加算される", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const host = {
        ...createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          level: 1,
          cores: 1,
        }),
        attachedChildrenIds: ["existing-1", "existing-2"],
      };
      const existing1 = {
        ...createCardInstance(braveA, {
          instanceId: "existing-1",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 0,
        }),
        attachedToInstanceId: "host-1",
      };
      const existing2 = {
        ...createCardInstance(braveB, {
          instanceId: "existing-2",
          ownerPlayerId: "alice",
          zone: "field" as const,
          cores: 0,
        }),
        attachedToInstanceId: "host-1",
      };
      const state: GameState = {
        ...base,
        cardInstances: [host, existing1, existing2],
      };

      // ホスト Lv1 BP 6000 + braveA combinedBoost 1000 + braveB combinedBoost 1500 = 8500
      expect(getCombinedUnitBp(state, host, hostDef, lookup)).toBe(8500);
    });
  }
);
