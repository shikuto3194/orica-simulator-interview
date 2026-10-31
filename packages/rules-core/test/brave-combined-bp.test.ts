/**
 * 合体スピリット (ホスト + ブレイヴ) の実効 BP が、ホストの BP に
 * ブレイヴの「BP＋」値を加算した値になることを検証する。
 *
 * 退行防止: 以前は `getEffectiveBp` / `recomputeBattleEntityBp` /
 * `getOrCreateCombatBattleEntity` がホスト単体の BP しか算出せず、合体中の
 * ブレイヴの BP＋ がスピリットの BP に加算されていなかった
 * (10_rules/05「BP（ブレイヴの『BP＋』値がスピリットの BP に加算）」)。
 */
import { describe, expect, it } from "vitest";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";
import { getCombinedUnitBp, getEffectiveBp, getEffectiveLevel } from "../src";
import { getOrCreateCombatBattleEntity } from "../src/battle/battle-shared";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { isEffectivelyCombined } from "../src/mechanics/virtual-combine";
import { ALL_CARDS } from "../../card-data/src/generated-index";

function makeSpirit(): CardDefinition {
  return {
    cardNo: "HOST-BP",
    name: "ホスト",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 8,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 8000 },
      { level: 2, requiredCores: 3, bp: 13000 },
      { level: 3, requiredCores: 5, bp: 18000 },
    ],
    symbolColors: ["red", "red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function makeBrave(): CardDefinition {
  return {
    cardNo: "BRAVE-BP",
    name: "ブレイヴ",
    printedCategory: "brave",
    colors: ["red"],
    cost: 6,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

const lookup = (() => {
  const hostDef = makeSpirit();
  const braveDef = makeBrave();
  return (id: string) =>
    id === hostDef.cardNo
      ? hostDef
      : id === braveDef.cardNo
        ? braveDef
        : undefined;
})();

function buildCombinedState(): {
  state: GameState;
  host: ReturnType<typeof createCardInstance>;
  hostDef: CardDefinition;
} {
  const hostDef = makeSpirit();
  const braveDef = makeBrave();
  // ホストにコア 7 個 (= Lv3, 印字 BP 18000)。合体時ブレイヴのコアは host へ移動済み。
  const host = {
    ...createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 7,
    }),
    attachedChildrenIds: ["brave-1"],
  };
  const brave = {
    ...createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    }),
    attachedToInstanceId: "host-1",
  };
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [host, brave],
  });
  return { state, host, hostDef };
}

describe("合体スピリットの実効 BP", () => {
  it("getCombinedUnitBp はホスト BP + ブレイヴの BP＋ を返す", () => {
    const { state, host, hostDef } = buildCombinedState();
    // ホスト Lv3 = 18000、ブレイヴ BP＋ = 3000 → 合計 21000
    expect(getCombinedUnitBp(state, host, hostDef, lookup)).toBe(21000);
  });

  it("ブレイヴ children が無いカードは getEffectiveBp と同値 (ホスト単体)", () => {
    const hostDef = makeSpirit();
    const solo = createCardInstance(hostDef, {
      instanceId: "solo-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 7,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [solo],
    });
    expect(getCombinedUnitBp(state, solo, hostDef, lookup)).toBe(18000);
  });

  it("getOrCreateCombatBattleEntity の resolvedBp も合体 BP で初期化される", () => {
    const { state, host, hostDef } = buildCombinedState();
    const entity = getOrCreateCombatBattleEntity({
      state,
      sourceCard: host,
      sourceDefinition: hostDef,
      getCardDefinitionById: lookup,
    });
    expect(entity.memberInstanceIds).toEqual(["host-1", "brave-1"]);
    expect(entity.resolvedBp).toBe(21000);
  });

  it("text_role under-card は attachedToInstanceId を持っても合体中扱いにしない", () => {
    const hostDef = makeSpirit();
    const underDef = makeBrave();
    const host = createCardInstance(hostDef, {
      instanceId: "under-host",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 7,
    });
    host.underCards = [
      {
        cardInstanceId: "under-star-garment",
        role: "text_role",
        roleTag: "星霊衣",
      },
    ];
    const under = {
      ...createCardInstance(underDef, {
        instanceId: "under-star-garment",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      }),
      attachedToInstanceId: "under-host",
      zoneRoleName: "star-garment",
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, under],
    });

    expect(isEffectivelyCombined(state, host)).toBe(false);
    expect(isEffectivelyCombined(state, under)).toBe(false);
  });

  it("zoneRoleName:brave の attached child は通常どおり合体中扱いにする", () => {
    const { state, host } = buildCombinedState();
    const brave = state.cardInstances.find((c) => c.instanceId === "brave-1")!;

    expect(isEffectivelyCombined(state, host)).toBe(true);
    expect(isEffectivelyCombined(state, brave)).toBe(true);
  });

  it("合体中ブレイヴ自身はLvを持たず、分離後のスピリット状態ではLv1を持つ", () => {
    const hostDef = makeSpirit();
    const braveDef = {
      ...makeBraveWithBoost(5000),
      levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
    };
    const levelLookup = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;
    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "level-host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["level-brave"],
    };
    const combinedBrave = {
      ...createCardInstance(braveDef, {
        instanceId: "level-brave",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      }),
      attachedToInstanceId: host.instanceId,
    };
    const combinedState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, combinedBrave],
    });

    expect(
      getEffectiveLevel(combinedState, combinedBrave, braveDef, levelLookup)
    ).toBe(0);

    const spiritStateBrave = {
      ...combinedBrave,
      attachedToInstanceId: null,
    };
    const spiritState = {
      ...combinedState,
      cardInstances: [{ ...host, attachedChildrenIds: [] }, spiritStateBrave],
    };
    expect(
      getEffectiveLevel(spiritState, spiritStateBrave, braveDef, levelLookup)
    ).toBe(1);
  });
});

/**
 * 裁定 2026-06-01 (シンボル) と同じ「分身は合体ユニットを追従」を BP にも適用。
 * X04 フランドール【フォーオブアカインド】の分身 (live_copy_from) は、host が合体中なら
 * ブレイヴの BP＋ も含めた合体 BP を持つ。
 */
function tokenDef(): CardDefinition {
  return {
    cardNo: "TOKEN-MAGIC",
    name: "Token",
    printedCategory: "magic",
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

const tokenLookup = (id: string) =>
  id === "TOKEN-MAGIC" ? tokenDef() : lookup(id);

function tokenActAsSpiritCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `ce-token-${targetInstanceId}`,
    sourceInstanceId: "host-1",
    sourceDefinitionId: "HOST-BP",
    actingPlayerId: "alice",
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "act_as_spirit" as ContinuousEffectTag,
    targetInstanceId,
    metadata: {
      statBlueprint: {
        kind: "live_copy_from",
        sourceInstanceId: "host-1",
        aspects: ["cost", "symbolColors", "tribes", "levelDefs", "currentLv"],
      },
      overrides: {
        cardName: "ホスト",
        levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
        keywords: ["cannot_combine"],
      },
    } as unknown as Record<string, unknown>,
  };
}

function makeTokenState(combined: boolean): GameState {
  const hostDef = makeSpirit();
  const braveDef = makeBrave();
  const host = {
    ...createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 7,
    }),
    attachedChildrenIds: combined ? ["brave-1"] : [],
  };
  const brave = {
    ...createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    }),
    attachedToInstanceId: combined ? "host-1" : null,
  };
  const token = {
    ...createCardInstance(tokenDef(), {
      instanceId: "token-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    }),
    faceDown: true,
  };
  const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...state,
    cardInstances: [host, brave, token],
    activeContinuousEffects: [tokenActAsSpiritCE("token-1")],
  };
}

/**
 * 退行防止 (2026-06-21): ブレイヴの「BP＋」は印字された `(0)合体 +N` の値 (combinedBoost) で
 * あり、スピリット状態の Lv1 BP (levelDefs) ではない。両者は別の印字値で一致しない場合がある
 * (例: BSTH01-X09 レーヴァテイン = Lv1 BP 3000 / 合体 +5000)。
 * 以前は levelDefs Lv1 BP を BP＋ に流用しており、合体 BP が過小/過大になっていた。
 */
function makeBraveWithBoost(combinedBoost: number): CardDefinition {
  return {
    ...makeBrave(),
    cardNo: "BRAVE-BOOST",
    combinedBoost,
  } as CardDefinition;
}

describe("合体 BP は combinedBoost (BP＋) を使う", () => {
  it("combinedBoost が levelDefs Lv1 BP と異なってもホスト + combinedBoost になる", () => {
    const hostDef = makeSpirit();
    const braveDef = makeBraveWithBoost(5000); // Lv1 BP は 3000 だが BP＋ は 5000
    const boostLookup = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;

    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        normalCoreCount: 7,
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        normalCoreCount: 0,
      }),
      attachedToInstanceId: "host-1",
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
    });
    // ホスト Lv3 = 18000、BP＋ = 5000 → 23000 (levelDefs 由来の 3000 ではない)
    expect(getCombinedUnitBp(state, host, hostDef, boostLookup)).toBe(23000);
  });

  it("combinedBoost 未設定のブレイヴは levelDefs Lv1 BP へフォールバックする", () => {
    // makeBrave() は combinedBoost を持たない → 後方互換で Lv1 BP 3000 を使う
    const { state, host, hostDef } = buildCombinedState();
    expect(getCombinedUnitBp(state, host, hostDef, lookup)).toBe(21000);
  });
});

describe("実カードデータの combinedBoost", () => {
  const cardByNo = (cardNo: string) =>
    ALL_CARDS.find((card) => card.cardNo === cardNo);

  it("転醒/ダブルフェイスの A 面ブレイヴにも BP＋を保持する", () => {
    expect(cardByNo("BSGE01-TX01(A)")?.combinedBoost).toBe(7000);
    expect(cardByNo("BSSA01-転醒X02(A)")?.combinedBoost).toBe(6000);
  });

  it("BP＋0 の鍵ブレイヴも combinedBoost: 0 として保持する", () => {
    expect(cardByNo("BSFT01-TR01(A)")?.combinedBoost).toBe(0);
  });
});

describe("分身 (act_as_spirit) の合体 BP 追従", () => {
  it("host 合体中なら分身も合体 BP (21000) を追従する", () => {
    const state = makeTokenState(true);
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(getEffectiveBp(state, token, tokenDef(), tokenLookup)).toBe(21000);
  });

  it("host 非合体なら分身は host 単体 BP (18000)", () => {
    const state = makeTokenState(false);
    const token = state.cardInstances.find((c) => c.instanceId === "token-1")!;
    expect(getEffectiveBp(state, token, tokenDef(), tokenLookup)).toBe(18000);
  });
});
