/**
 * P3-69 Increment 0: 中央 resolver `resolveEffectiveIdentity` の parity テスト。
 *
 * facade の各 dimension が、対応する legacy helper (`getEffective*`) と
 * 完全一致することを保証する (behavioral no-op であることの担保)。
 * 後続 Increment で delegation を反転 (option b → a) しても、本テストが
 * 既存の振る舞いを固定する回帰ガードになる。
 */
import { describe, it, expect } from "vitest";
import {
  getEffectiveBp,
  getEffectiveLevel,
  getEffectiveSymbols,
  getEffectiveSymbolBundles,
  resolveEffectiveIdentity,
} from "../src/battle/battle-shared";
import {
  getEffectiveColors,
  getEffectiveTribes,
} from "../src/legal/legal-actions-shared";
import {
  getEffectiveCategory,
  getEffectiveTribe,
} from "../src/mechanics/act-as-spirit";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  ActAsSpiritMetadata,
  ActAsSpiritStatSnapshot,
} from "../src/mechanics/act-as-spirit";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";

const ALICE = "player-1";

function spiritDef(): CardDefinition {
  return {
    cardNo: "TEST-SPIRIT",
    name: "Test Spirit",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 3, bp: 5000 },
    ],
    textLines: [],
    images: {},
    tribe: "紅魔・幻想",
    colors: ["red"],
  } as CardDefinition;
}

function nexusDef(): CardDefinition {
  return {
    cardNo: "TEST-NEXUS",
    name: "Test Nexus",
    printedCategory: "nexus",
    printedColors: ["purple"],
    symbolColors: ["purple", "purple"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    textLines: [],
    images: {},
    tribe: "城",
    colors: ["purple"],
  } as CardDefinition;
}

function hostDef(): CardDefinition {
  return {
    cardNo: "FRANDOLLE-HOST",
    name: "フランドール・スカーレット",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red", "red"],
    printedCost: 7,
    cost: 7,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 6000 },
      { level: 2, requiredCores: 3, bp: 9000 },
    ],
    textLines: [],
    images: {},
    tribe: "紅魔",
    colors: ["red"],
  } as CardDefinition;
}

const STATIC_SNAPSHOT: ActAsSpiritStatSnapshot = {
  cost: 7,
  reductionSymbols: [],
  symbolColors: ["red", "red"],
  tribes: ["紅魔"],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 6000 },
    { level: 2, requiredCores: 3, bp: 9000 },
  ],
};

function actAsSpiritCE(
  targetInstanceId: string,
  metadata: ActAsSpiritMetadata
): ContinuousEffect {
  return {
    effectId: `ce-act-as-spirit-${targetInstanceId}`,
    sourceInstanceId: "host-1",
    sourceDefinitionId: "FRANDOLLE-HOST",
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "act_as_spirit" as ContinuousEffectTag,
    targetInstanceId,
    metadata: metadata as unknown as Record<string, unknown>,
  };
}

/** facade の全 dimension が legacy helper と一致することを assert する。 */
function expectParity(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getDef: (id: string) => CardDefinition | undefined
): void {
  const id = resolveEffectiveIdentity(state, card, def, getDef);
  expect(id.category).toEqual(getEffectiveCategory(state, card, def));
  expect(id.tribes).toEqual(getEffectiveTribes(state, card, def, getDef));
  expect(id.tribe).toEqual(getEffectiveTribe(state, card, def, getDef));
  expect(id.colors).toEqual(getEffectiveColors(state, card, def));
  expect(id.symbols).toEqual(getEffectiveSymbols(state, card, def, getDef));
  expect(id.symbolBundles).toEqual(
    getEffectiveSymbolBundles(state, card, def, getDef)
  );
  expect(id.bp).toEqual(getEffectiveBp(state, card, def, getDef));
  expect(id.level).toEqual(getEffectiveLevel(state, card, def, getDef));
}

describe("P3-69 Increment 0: resolveEffectiveIdentity facade parity", () => {
  it("表向きスピリット: 全 dimension が legacy helper と一致", () => {
    const def = spiritDef();
    const card = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["player-1", "player-2"] }),
      cardInstances: [card],
      activeContinuousEffects: [],
    };
    expectParity(state, card, def, () => def);

    // 念のため絶対値も確認 (表向きは印字どおり)
    const id = resolveEffectiveIdentity(state, card, def, () => def);
    expect(id.category).toBe("spirit");
    expect(id.tribe).toBe("紅魔・幻想");
    expect(id.symbols).toEqual(["red"]);
    expect(id.level).toBe(2);
    expect(id.bp).toBe(5000);
  });

  it("裏向き付与無し: 素性なし (category undefined / symbols [] / tribe '')", () => {
    const def = nexusDef();
    const card = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["player-1", "player-2"] }),
      cardInstances: [card],
      activeContinuousEffects: [],
    };
    expectParity(state, card, def, () => def);

    const id = resolveEffectiveIdentity(state, card, def, () => def);
    expect(id.category).toBeUndefined();
    expect(id.symbols).toEqual([]);
    expect(id.tribe).toBe("");
  });

  it("act_as_spirit static_copy: 裏向き nexus が付与素性を持つ", () => {
    const def = nexusDef();
    const ce = actAsSpiritCE("card-1", {
      statBlueprint: { kind: "static_copy", snapshot: STATIC_SNAPSHOT },
      overrides: { keywords: ["cannot_combine"] },
    });
    const card = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["player-1", "player-2"] }),
      cardInstances: [card],
      activeContinuousEffects: [ce],
    };
    expectParity(state, card, def, () => def);

    const id = resolveEffectiveIdentity(state, card, def, () => def);
    expect(id.category).toBe("spirit");
    expect(id.symbols).toEqual(["red", "red"]);
    expect(id.bp).toBe(9000);
  });

  it("act_as_spirit live_copy_from: 本体追従 (再帰経路) も parity", () => {
    const tokenDef = nexusDef();
    const host = hostDef();
    const ce = actAsSpiritCE("token-1", {
      statBlueprint: {
        kind: "live_copy_from",
        sourceInstanceId: "host-1",
        aspects: ["cost", "symbolColors", "tribes", "levelDefs", "currentLv"],
      },
    });
    const tokenCard = createCardInstance(tokenDef, {
      instanceId: "token-1",
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 3,
    });
    const hostCard = createCardInstance(host, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["player-1", "player-2"] }),
      cardInstances: [tokenCard, hostCard],
      activeContinuousEffects: [ce],
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === "FRANDOLLE-HOST" ? host : tokenDef;
    expectParity(state, tokenCard, tokenDef, getDef);

    const id = resolveEffectiveIdentity(state, tokenCard, tokenDef, getDef);
    expect(id.category).toBe("spirit");
    expect(id.symbols).toEqual(["red", "red"]);
  });

  it("lazy: 同一 view の dimension は再アクセスしても同値 (冪等)", () => {
    const def = spiritDef();
    const card = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["player-1", "player-2"] }),
      cardInstances: [card],
      activeContinuousEffects: [],
    };
    const id = resolveEffectiveIdentity(state, card, def, () => def);
    expect(id.symbols).toEqual(id.symbols);
    expect(id.bp).toBe(id.bp);
    expect(id.symbolBundles).toEqual(id.symbolBundles);
  });
});

describe("P3-69 Increment 1: resolveEffectiveIdentity memo", () => {
  it("CE配列とカードを共有してもステップ変更後の実効シンボルを再計算する", () => {
    const def = spiritDef();
    const card = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, "player-2"],
        cardInstances: [card],
      }),
      activePlayerId: ALICE,
      step: "main",
      activeContinuousEffects: [
        {
          effectId: "attack-symbol",
          sourceInstanceId: card.instanceId,
          sourceDefinitionId: def.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "while_on_field" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "symbol_addition",
          modifierSymbol: ["black"],
          targetInstanceId: card.instanceId,
          timingScope: { player: "self", period: "attack" },
        },
      ],
    };
    const getDef = () => def;
    expect(resolveEffectiveIdentity(state, card, def, getDef).symbols).toEqual([
      "red",
    ]);
    const attacking: GameState = { ...state, step: "attack" };
    expect(attacking.activeContinuousEffects).toBe(
      state.activeContinuousEffects
    );
    expect(getEffectiveSymbols(attacking, card, def, getDef)).toEqual([
      "red",
      "black",
    ]);
    expectParity(attacking, card, def, getDef);
  });

  it("同一 (state, card) の再 resolve は同一 view を返す (cache hit)", () => {
    const def = spiritDef();
    const card = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["player-1", "player-2"] }),
      cardInstances: [card],
      activeContinuousEffects: [],
    };
    const getDef = () => def;
    const a = resolveEffectiveIdentity(state, card, def, getDef);
    const b = resolveEffectiveIdentity(state, card, def, getDef);
    // view object 自体が共有される = cache hit
    expect(a).toBe(b);
  });

  it("CE 配列参照を共有してもコア数が変われば再計算する", () => {
    const def = spiritDef();
    // core-only 変更を模擬: activeContinuousEffects は同一参照を共有する
    const sharedCEs: never[] = [];
    const card1 = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const card3 = createCardInstance(def, {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const base = createEmptyGameState({ playerIds: ["player-1", "player-2"] });
    const state1: GameState = {
      ...base,
      cardInstances: [card1],
      activeContinuousEffects: sharedCEs,
    };
    const state3: GameState = {
      ...base,
      cardInstances: [card3],
      activeContinuousEffects: sharedCEs,
    };
    const id1 = resolveEffectiveIdentity(state1, card1, def, () => def);
    const id3 = resolveEffectiveIdentity(state3, card3, def, () => def);
    // Lv1 (1 core) bp=3000 / Lv2 (3 core) bp=5000 — stale cache なら同値になってしまう
    expect(id1.bp).toBe(3000);
    expect(id3.bp).toBe(5000);
    expect(id1.level).toBe(1);
    expect(id3.level).toBe(2);
    expect(id1).not.toBe(id3);
  });

  it("非 field ゾーンの裏向き付与無しカードも null identity (zone 不問で素性なしを徹底)", () => {
    // P3-69 残留懸念 edge のガード: act_as_spirit token が hand/deck へ bounce すると
    // F-1 policy で faceDown=true のまま (07_custom-orica-mechanics:208 によりこの bounce
    // 挙動自体はユーザー確認待ち)。本テストは「faceDown → null identity」(04_state-based-rules)
    // を resolver が zone 不問で適用することを固定する。bounce が faceDown を解除すべきか
    // どうかは別問題 (applyFaceDownPolicyOnZoneChange) でここでは判定しない。
    const def = nexusDef();
    for (const zone of ["hand", "deck", "trash"] as const) {
      const card = createCardInstance(def, {
        instanceId: "card-1",
        ownerPlayerId: ALICE,
        zone,
        faceDown: true,
        cores: 3,
      });
      const state: GameState = {
        ...createEmptyGameState({ playerIds: ["player-1", "player-2"] }),
        cardInstances: [card],
        activeContinuousEffects: [],
      };
      const id = resolveEffectiveIdentity(state, card, def, () => def);
      expect(id.category, `zone=${zone}`).toBeUndefined();
      expect(id.symbols, `zone=${zone}`).toEqual([]);
      expect(id.tribe, `zone=${zone}`).toBe("");
    }
  });

  it("live_copy_from も同一stateでは再利用し、付与元が変わったstateでは再計算する", () => {
    const tokenDef = nexusDef();
    const host = hostDef();
    const ce = actAsSpiritCE("token-1", {
      statBlueprint: {
        kind: "live_copy_from",
        sourceInstanceId: "host-1",
        aspects: ["cost", "symbolColors", "tribes", "levelDefs", "currentLv"],
      },
    });
    const tokenCard = createCardInstance(tokenDef, {
      instanceId: "token-1",
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 3,
    });
    const hostCard = createCardInstance(host, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["player-1", "player-2"] }),
      cardInstances: [tokenCard, hostCard],
      activeContinuousEffects: [ce],
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === "FRANDOLLE-HOST" ? host : tokenDef;
    const a = resolveEffectiveIdentity(state, tokenCard, tokenDef, getDef);
    const b = resolveEffectiveIdentity(state, tokenCard, tokenDef, getDef);
    expect(a).toBe(b);
    expect(a.symbols).toEqual(["red", "red"]);
    expect(b.symbols).toEqual(["red", "red"]);
    const changed: GameState = {
      ...state,
      cardInstances: [tokenCard, { ...hostCard, normalCoreCount: 1 }],
    };
    const next = resolveEffectiveIdentity(changed, tokenCard, tokenDef, getDef);
    expect(next).not.toBe(a);
    expect(next.level).toBe(1);
    expect(next.bp).toBe(6000);
    expectParity(changed, tokenCard, tokenDef, getDef);
  });
});
