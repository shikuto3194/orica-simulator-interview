/**
 * 裁定 (2026-06-01): 合体スピリットは1体として扱う。X04 フランドール【フォーオブアカインド】の
 * 分身が live_copy する「このスピリットと同じシンボル」は、host が合体中ならブレイヴ分も含む
 * (05_brave-and-attack-special-cases.md「ブレイヴのシンボルがスピリットに追加」)。
 *
 * host フランドール = 赤2、合体ブレイヴ (X09 禁忌「レーヴァテイン」) = 赤1 → 合体ユニット = 赤3。
 * 分身も赤3を持つ。一方 per-card getEffectiveSymbols(host) は二重計上回避のため host 単体=赤2。
 */
import { describe, it, expect } from "vitest";
import {
  getEffectiveSymbols,
  getCombinedUnitSymbols,
  getCombinedUnitSymbolBundles,
} from "../src/battle/battle-shared";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";

const BOB = "bob";

function hostDef(): CardDefinition {
  return {
    cardNo: "FRANDOLLE",
    name: "フランドール・スカーレット",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red", "red"], // 赤2
    printedCost: 8,
    cost: 8,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 8000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
  } as CardDefinition;
}

function braveDef(): CardDefinition {
  return {
    cardNo: "REVATEIN",
    name: "禁忌「レーヴァテイン」",
    printedCategory: "brave",
    printedColors: ["red"],
    symbolColors: ["red"], // 赤1
    printedCost: 4,
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 2000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
  } as CardDefinition;
}

/** 分身の素体 (裏向きマジック)。 */
function tokenDef(): CardDefinition {
  return {
    cardNo: "TOKEN-MAGIC",
    name: "Token",
    printedCategory: "magic",
    printedColors: ["red"],
    symbolColors: [],
    printedCost: 2,
    cost: 2,
    reductionSymbols: [],
    levelDefs: [],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
  } as CardDefinition;
}

const DEFS: Record<string, CardDefinition> = {
  FRANDOLLE: hostDef(),
  REVATEIN: braveDef(),
  "TOKEN-MAGIC": tokenDef(),
};
const getDef = (id: string): CardDefinition | undefined => DEFS[id];

function tokenActAsSpiritCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `ce-token-${targetInstanceId}`,
    sourceInstanceId: "host",
    sourceDefinitionId: "FRANDOLLE",
    actingPlayerId: BOB,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "act_as_spirit" as ContinuousEffectTag,
    targetInstanceId,
    metadata: {
      statBlueprint: {
        kind: "live_copy_from",
        sourceInstanceId: "host",
        aspects: ["cost", "symbolColors", "tribes", "levelDefs", "currentLv"],
      },
      overrides: {
        cardName: "フランドール・スカーレット",
        levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
        keywords: ["cannot_combine"],
      },
    } as unknown as Record<string, unknown>,
  };
}

function makeState(opts: { combined: boolean }): GameState {
  const host = createCardInstance(hostDef(), {
    instanceId: "host",
    ownerPlayerId: BOB,
    zone: "field",
    cores: 1,
    attachedChildrenIds: opts.combined ? ["brave"] : [],
  });
  const brave = createCardInstance(braveDef(), {
    instanceId: "brave",
    ownerPlayerId: BOB,
    zone: "field",
    zoneRoleName: "brave",
    attachedToInstanceId: opts.combined ? "host" : null,
  });
  const token = createCardInstance(tokenDef(), {
    instanceId: "token",
    ownerPlayerId: BOB,
    zone: "field",
    faceDown: true,
    cores: 1,
  });
  const state = createEmptyGameState({ playerIds: [BOB, "alice"] });
  return {
    ...state,
    cardInstances: [host, brave, token],
    activeContinuousEffects: [tokenActAsSpiritCE("token")],
  };
}

function countRed(symbols: readonly string[]): number {
  return symbols.filter((s) => s === "red").length;
}

describe("分身の合体ブレイヴシンボル追従 (裁定 2026-06-01)", () => {
  it("host 単体 getEffectiveSymbols は二重計上回避で 赤2 のまま", () => {
    const state = makeState({ combined: true });
    const host = state.cardInstances.find((c) => c.instanceId === "host")!;
    expect(countRed(getEffectiveSymbols(state, host, hostDef(), getDef))).toBe(
      2
    );
  });

  it("合体ユニット (host+ブレイヴ) のシンボルは 赤3", () => {
    const state = makeState({ combined: true });
    const host = state.cardInstances.find((c) => c.instanceId === "host")!;
    expect(
      countRed(getCombinedUnitSymbols(state, host, hostDef(), getDef))
    ).toBe(3);
    const bundles = getCombinedUnitSymbolBundles(
      state,
      host,
      hostDef(),
      getDef
    );
    const total = bundles.reduce((n, b) => n + b.count, 0);
    expect(total).toBe(3);
  });

  it("host 合体中なら分身も 赤3 (live_copy がブレイヴ分を含む)", () => {
    const state = makeState({ combined: true });
    const token = state.cardInstances.find((c) => c.instanceId === "token")!;
    expect(
      countRed(getEffectiveSymbols(state, token, tokenDef(), getDef))
    ).toBe(3);
  });

  it("host 非合体なら分身は 赤2 (ブレイヴ分なし)", () => {
    const state = makeState({ combined: false });
    const token = state.cardInstances.find((c) => c.instanceId === "token")!;
    expect(
      countRed(getEffectiveSymbols(state, token, tokenDef(), getDef))
    ).toBe(2);
  });
});
