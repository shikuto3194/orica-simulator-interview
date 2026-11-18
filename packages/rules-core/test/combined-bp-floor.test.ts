import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  getEffectiveBp,
  getCombinedUnitBp,
  type CardDefinition,
  type ContinuousEffect,
} from "../src";
import { getOrCreateCombatBattleEntity } from "../src/battle/battle-shared";

const hostDef: CardDefinition = {
  cardNo: "BP-HOST",
  name: "BP host",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 8,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 18000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const braveDef: CardDefinition = {
  ...hostDef,
  cardNo: "BP-BRAVE",
  printedCategory: "brave",
  combinedBoost: 3000,
};
const lookup = (id: string) =>
  id === hostDef.cardNo
    ? hostDef
    : id === braveDef.cardNo
      ? braveDef
      : undefined;
function modifier(id: string, amount: number): ContinuousEffect {
  return {
    effectId: `bp:${id}:${amount}`,
    sourceInstanceId: "host",
    sourceDefinitionId: hostDef.cardNo,
    actingPlayerId: "alice",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "bp_modifier",
    targetInstanceId: id,
    modifierAmount: amount,
  };
}
function virtualBrave(): ContinuousEffect {
  return {
    ...modifier("host", 0),
    effectId: "virtual-brave",
    modifierTag: "override_properties",
    metadata: {
      properties: { virtualAttachedBraves: [{ combinedBoost: 5000 }] },
    },
  };
}
function combined(amount: number) {
  const host = createCardInstance(hostDef, {
    instanceId: "host",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
    attachedChildrenIds: ["brave"],
  });
  const brave = createCardInstance(braveDef, {
    instanceId: "brave",
    ownerPlayerId: "alice",
    zone: "field",
    attachedToInstanceId: host.instanceId,
  });
  const state = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
    }),
    activeContinuousEffects: [modifier(host.instanceId, amount)],
  };
  return { state, host, brave };
}

// 公式エターナル Q164/Q165: BP0でもマイナス分は消えない。
// 合体ユニットの全BPを加減算してから0へ丸める。
describe("合体BPの下限", () => {
  it.each([
    [-19000, 2000],
    [-21000, 0],
    [-30000, 0],
  ])("18000+3000に%i → BP%i", (amount, expected) => {
    const { state, host } = combined(amount);
    expect(getEffectiveBp(state, host, hostDef, lookup)).toBe(0);
    expect(getCombinedUnitBp(state, host, hostDef, lookup)).toBe(expected);
    expect(
      getOrCreateCombatBattleEntity({
        state,
        sourceCard: host,
        sourceDefinition: hostDef,
        getCardDefinitionById: lookup,
      }).resolvedBp
    ).toBe(expected);
  });
  it("BP0後の加算でも過剰なマイナス分を保持する", () => {
    const { state, host } = combined(-30000);
    expect(getCombinedUnitBp(state, host, hostDef, lookup)).toBe(0);
    const boosted = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        modifier(host.instanceId, 10000),
      ],
    };
    expect(getCombinedUnitBp(boosted, host, hostDef, lookup)).toBe(1000);
  });
  it("ブレイヴ側のBP修正も合体全体へ加算する", () => {
    const { state, host } = combined(0);
    const reduced = {
      ...state,
      activeContinuousEffects: [modifier("brave", -5000)],
    };
    expect(getCombinedUnitBp(reduced, host, hostDef, lookup)).toBe(16000);
  });
  it("複数の実ブレイヴと仮想ブレイヴを合算する", () => {
    const { state, host, brave } = combined(-26000);
    const reduced = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        { ...brave, instanceId: "brave-2" },
      ],
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        virtualBrave(),
      ],
    };
    expect(getCombinedUnitBp(reduced, host, hostDef, lookup)).toBe(3000);
  });
  it.each([
    [-20000, 3000],
    [-30000, 0],
  ])("実ブレイヴなしの仮想合体に%i → BP%i", (amount, expected) => {
    const { state, host } = combined(amount);
    const solo = { ...host, attachedChildrenIds: [] };
    const reduced = {
      ...state,
      cardInstances: [solo],
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        virtualBrave(),
      ],
    };
    expect(getCombinedUnitBp(reduced, solo, hostDef, lookup)).toBe(expected);
  });
  it("異魔神の左右の合体BPを独立に算出する", () => {
    const { state, host, brave } = combined(0);
    const right = { ...host, instanceId: "right", attachedChildrenIds: [] };
    const reduced = {
      ...state,
      cardInstances: [
        host,
        { ...brave, imaginRightCombinedWith: right.instanceId },
        right,
      ],
      activeContinuousEffects: [modifier(right.instanceId, -19000)],
    };
    expect(getCombinedUnitBp(reduced, right, hostDef, lookup)).toBe(2000);
    expect(getCombinedUnitBp(reduced, host, hostDef, lookup)).toBe(21000);
  });
  it.each([
    [-19000, 4000],
    [-30000, 2000],
  ])(
    "分身はコピー元の合体BPの下限を確定してから自身の修正を加える（%i）",
    (amount, expected) => {
      const { state, host } = combined(amount);
      const tokenDef: CardDefinition = {
        ...hostDef,
        cardNo: "BP-TOKEN",
        printedCategory: "magic",
        levelDefs: [],
      };
      const token = createCardInstance(tokenDef, {
        instanceId: "token",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        faceDown: true,
      });
      const tokenLookup = (id: string) =>
        id === tokenDef.cardNo ? tokenDef : lookup(id);
      const reduced = {
        ...state,
        cardInstances: [...state.cardInstances, token],
        activeContinuousEffects: [
          ...state.activeContinuousEffects,
          {
            ...modifier(token.instanceId, 0),
            effectId: "token-copy",
            modifierTag: "act_as_spirit" as const,
            metadata: {
              statBlueprint: {
                kind: "live_copy_from",
                sourceInstanceId: host.instanceId,
                aspects: [
                  "cost",
                  "symbolColors",
                  "tribes",
                  "levelDefs",
                  "currentLv",
                ],
              },
              overrides: {
                levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
                keywords: ["cannot_combine"],
              },
            },
          },
          modifier(token.instanceId, 2000),
        ],
      };
      expect(getEffectiveBp(reduced, token, tokenDef, tokenLookup)).toBe(
        expected
      );
    }
  );
});
