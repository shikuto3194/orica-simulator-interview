/**
 * P3-33: `getEffectiveColors` と `treat_as { aspects 含 "color" }` の色フィルタ反映テスト。
 *
 * パチュリー (BSTH01-M01) は紫だが「このカード/スピリットの色とシンボルは赤としても扱う」
 * 継続効果を持つ。修正前は `def.colors` 直接読みのため、
 *
 * - 場の Patchouli は「赤スピリット対象」フィルタにマッチしない
 * - 手札の Patchouli は「赤カード」検索でヒットしない
 *
 * 修正後 (P3-33 Phase 1): `getEffectiveColors` が CE (場) と DSL 直接読み (手札) を集約し、
 * 主要フィルタ経路 (target-resolution / structured-effect-interpreter / effect-interpreter
 * cardFilter / accel-change / trigger-system) で effectiveColors として渡される。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  getEffectiveColors,
  rebuildContinuousEffectsFromField,
} from "../src";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src";

const ALICE = "alice";
const BOB = "bob";

function purpleSpiritWithRedTreatAs(): CardDefinition {
  return {
    cardNo: "TEST-PATCHOULI-LIKE",
    name: "紫 to 赤 テスト",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "test",
    effects: [
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["color", "symbol"],
              asColor: "red",
              appliesToCard: true,
            },
          },
        ],
      },
    ],
  };
}

describe("P3-33: getEffectiveColors", () => {
  it("場のカードは continuous CE 経由で red が加算される", () => {
    const def = purpleSpiritWithRedTreatAs();
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(def, {
      instanceId: "p1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    let state: GameState = { ...baseState, cardInstances: [card] };
    state = rebuildContinuousEffectsFromField(state, () => def);

    const result = getEffectiveColors(state, card, def);
    expect(result.sort()).toEqual(["purple", "red"].sort());
  });

  it("手札のカードは DSL 直接読みで red が加算される (CE 未登録でも作用)", () => {
    const def = purpleSpiritWithRedTreatAs();
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(def, {
      instanceId: "p1",
      ownerPlayerId: ALICE,
      zone: "hand",
      cores: 0,
    });
    const state: GameState = { ...baseState, cardInstances: [card] };

    // CE は登録しない (rebuildContinuousEffectsFromField の対象外ゾーン)
    expect(state.activeContinuousEffects.length).toBe(0);

    const result = getEffectiveColors(state, card, def);
    expect(result.sort()).toEqual(["purple", "red"].sort());
  });

  it("デッキ/トラッシュなど他ゾーンでは appliesToCard:true でも作用しない (P3-33 Phase 1 スコープ外)", () => {
    const def = purpleSpiritWithRedTreatAs();
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(def, {
      instanceId: "p1",
      ownerPlayerId: ALICE,
      zone: "deck",
      cores: 0,
    });
    const state: GameState = { ...baseState, cardInstances: [card] };

    const result = getEffectiveColors(state, card, def);
    expect(result).toEqual(["purple"]);
  });

  it("treat_as 効果を持たないカードでは def.colors と同じ", () => {
    const plainDef: CardDefinition = {
      cardNo: "TEST-PLAIN",
      name: "プレーン",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      tribe: "test",
      effects: [],
    };
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(plainDef, {
      instanceId: "p1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const state: GameState = { ...baseState, cardInstances: [card] };

    expect(getEffectiveColors(state, card, plainDef)).toEqual(["red"]);
  });

  it("裏向き付与無しカードは印字色を漏らさない (P3-69 null identity)", () => {
    const def = purpleSpiritWithRedTreatAs();
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(def, {
      instanceId: "p1",
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const state: GameState = { ...baseState, cardInstances: [card] };

    expect(getEffectiveColors(state, card, def)).toEqual([]);
  });

  it("裏向き手札カードは印字 continuous treat_as 色を漏らさない", () => {
    const def = purpleSpiritWithRedTreatAs();
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(def, {
      instanceId: "p1",
      ownerPlayerId: ALICE,
      zone: "hand",
      faceDown: true,
      cores: 0,
    });
    const state: GameState = { ...baseState, cardInstances: [card] };

    expect(getEffectiveColors(state, card, def)).toEqual([]);
  });

  it("裏向き act_as_spirit の snapshot 色は付与素性として返す", () => {
    const def = purpleSpiritWithRedTreatAs();
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(def, {
      instanceId: "p1",
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const ce: ContinuousEffect = {
      effectId: "ce-act-as-color",
      sourceInstanceId: "host",
      sourceDefinitionId: "HOST",
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "act_as_spirit" as ContinuousEffectTag,
      targetInstanceId: "p1",
      metadata: {
        statBlueprint: {
          kind: "static_copy",
          snapshot: {
            cost: 0,
            reductionSymbols: [],
            symbolColors: ["yellow"],
            tribes: [],
            levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
            colors: ["yellow"],
          },
        },
      },
    };
    const state: GameState = {
      ...baseState,
      cardInstances: [card],
      activeContinuousEffects: [ce],
    };

    expect(getEffectiveColors(state, card, def)).toEqual(["yellow"]);
  });
});

describe("P3-33: matchesCardFilter が effectiveColors を反映する", () => {
  it("色フィルタ {colors: [red]} に対して、紫+treat_as red のカードは effectiveColors 経由でマッチする", async () => {
    const { matchesCardFilter } = await import("../src/card/card-filter");
    const def = purpleSpiritWithRedTreatAs();
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(def, {
      instanceId: "p1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    let state: GameState = { ...baseState, cardInstances: [card] };
    state = rebuildContinuousEffectsFromField(state, () => def);

    const filter = { colors: ["red" as const] };

    // effectiveColors 未指定 → def.colors (purple) のみで判定 → 不一致
    expect(matchesCardFilter(card, def, filter)).toBe(false);

    // effectiveColors 指定 → red を含むのでマッチ
    expect(
      matchesCardFilter(card, def, filter, {
        effectiveColors: getEffectiveColors(state, card, def),
      })
    ).toBe(true);
  });

  it("実カード BSTH01-M01 パチュリー: 場で「赤カード」フィルタにマッチ", async () => {
    const { ALL_CARDS } = await import("../../card-data/src/generated-index");
    const { matchesCardFilter } = await import("../src/card/card-filter");
    const m01 = ALL_CARDS.find((c) => c.cardNo === "BSTH01-M01");
    expect(m01).toBeDefined();

    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(m01!, {
      instanceId: "m01",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 2,
    });
    let state: GameState = { ...baseState, cardInstances: [card] };
    state = rebuildContinuousEffectsFromField(state, (id) =>
      ALL_CARDS.find((c) => c.cardNo === id)
    );

    expect(
      matchesCardFilter(
        card,
        m01!,
        { colors: ["red"] },
        {
          effectiveColors: getEffectiveColors(state, card, m01!),
        }
      )
    ).toBe(true);
  });

  it("実カード BSTH01-M01 パチュリー: 手札で「赤カード」フィルタにマッチ", async () => {
    const { ALL_CARDS } = await import("../../card-data/src/generated-index");
    const { matchesCardFilter } = await import("../src/card/card-filter");
    const m01 = ALL_CARDS.find((c) => c.cardNo === "BSTH01-M01");
    expect(m01).toBeDefined();

    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const card = createCardInstance(m01!, {
      instanceId: "m01",
      ownerPlayerId: ALICE,
      zone: "hand",
      cores: 0,
    });
    const state: GameState = { ...baseState, cardInstances: [card] };

    // CE 未登録でも DSL 直接読みで red 扱いになる
    expect(
      matchesCardFilter(
        card,
        m01!,
        { colors: ["red"] },
        {
          effectiveColors: getEffectiveColors(state, card, m01!),
        }
      )
    ).toBe(true);
  });
});
