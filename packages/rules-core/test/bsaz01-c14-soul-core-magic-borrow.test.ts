/**
 * BSAZ01-C14「ダルザナ・マグバレッジ」effects[1] (Lv2『自分のメインステップ』):
 * 「自分のフィールドのマジックカード1枚のメイン効果を自分の《ソウルコア》を支払って
 * 使用できる。」
 *
 * engine-magic-use-soul-core-cost-borrow primitive: 発動コストに P3-125 Step1 と同型の
 * ソウルコア支払い (core_move, effectKind:"explicit_soul_core", from:field+includeReserve,
 * to:removed_from_game。BSLH01-X06 precedent) を使い、後段の
 * borrow_magic_effect (zone:"field", hasActivatedEffectMode:["main"], borrowModes:["main"])
 * を connector:"conditional_cost" (BSAZ01-CX01 precedent) で結線する。借用先候補が無いときは
 * ソウルコア支払いごとロールバックされる。新規 primitive ではなく既存 2 プリミティブの
 * 組み合わせで表現できる。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

// 借用先: フィールドのマジックカード1枚。メイン効果は盤面変化を単純に確認できる draw:1。
const FIELD_MAGIC_MAIN_DRAW: CardDefinition = {
  cardNo: "TEST-C14-BORROW-FIELD-MAGIC",
  name: "テスト場マジック(メインでドロー)",
  printedCategory: "magic",
  colors: ["yellow"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "draw", count: 1 } }],
      textRef: [0],
    },
  ],
};

// 借用先候補になり得ない対照: メイン効果を持たずフラッシュ効果のみ。
const FIELD_MAGIC_FLASH_ONLY: CardDefinition = {
  ...FIELD_MAGIC_MAIN_DRAW,
  cardNo: "TEST-C14-BORROW-FIELD-MAGIC-FLASH-ONLY",
  name: "テスト場マジック(フラッシュのみ)",
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [{ action: { kind: "draw", count: 1 } }],
      textRef: [0],
    },
  ],
};

const cardNoMap = new Map<string, CardDefinition>(
  [...ALL_CARDS, FIELD_MAGIC_MAIN_DRAW, FIELD_MAGIC_FLASH_ONLY].map((c) => [
    c.cardNo,
    c,
  ])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const C14 = cardNoMap.get("BSAZ01-C14")!;
const noLookup = () => [];

describe("BSAZ01-C14 effects[1]: Lv2 ソウルコア支払いメイン効果借用", () => {
  const effect = C14.effects![1]!;

  it("DSL構造: min_level2 + explicit_soul_core コスト → conditional_cost で borrow_magic_effect(main)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "main" });
    expect(effect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    const cost = effect.steps[0]!.action;
    expect(cost.kind).toBe("core_move");
    if (cost.kind === "core_move") {
      expect(cost.effectKind).toBe("explicit_soul_core");
      expect(cost.to).toEqual({ kind: "removed_from_game", player: "self" });
    }
    const borrow = effect.steps[1]!.action;
    expect(effect.steps[1]!.connector).toBe("conditional_cost");
    expect(borrow.kind).toBe("borrow_magic_effect");
    if (borrow.kind === "borrow_magic_effect") {
      expect(borrow.borrowModes).toEqual(["main"]);
      if (borrow.target.kind === "filter") {
        expect(borrow.target.filter.hasActivatedEffectMode).toEqual(["main"]);
      }
    }
  });

  function buildState(options?: { level2?: boolean }): GameState {
    const darzana = createCardInstance(C14, {
      instanceId: "darzana",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: options?.level2 === false ? 0 : 2,
      soulCoreCount: 1,
    });
    const fieldMagic = createCardInstance(FIELD_MAGIC_MAIN_DRAW, {
      instanceId: "field-magic-main",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const deckCards = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(FIELD_MAGIC_FLASH_ONLY, {
        instanceId: `deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [darzana, fieldMagic, ...deckCards],
      playerOverrides: [{ handCount: 0, deckCount: deckCards.length }, {}],
    });
    return {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      window: "main_step",
      players: base.players.map((p) =>
        p.id === ALICE
          ? { ...p, soulCoreLocation: { kind: "card", instanceId: "darzana" } }
          : p
      ),
    };
  }

  it("[board] Lv2: ソウルコアを支払い、フィールドのマジックのメイン効果(draw:1)が発揮される", () => {
    const state = buildState();
    const after = executeEffect({
      chainId: "test:bsaz01-c14-soul-core-magic-borrow:136",
      state,
      effect,
      sourceInstanceId: "darzana",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    });

    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.soulCoreLocation).toEqual({ kind: "removed_from_game" });
    expect(alice.handCount).toBe(1);
    expect(alice.deckCount).toBe(2);
    expect(
      after.log.some((l) =>
        l.startsWith("borrow_magic_effect:executed:TEST-C14-BORROW-FIELD-MAGIC")
      )
    ).toBe(true);
  });

  it("[board] Lv1: min_level条件不成立で発揮されない (ソウルコアも消費されない)", () => {
    const state = buildState({ level2: false });
    const after = executeEffect({
      chainId: "test:bsaz01-c14-soul-core-magic-borrow:158",
      state,
      effect,
      sourceInstanceId: "darzana",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    });

    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "darzana",
    });
    expect(alice.handCount).toBe(0);
  });

  it("[board] フラッシュ効果しか持たないマジックは borrowModes:['main'] 対象外のため借用されない", () => {
    const darzana = createCardInstance(C14, {
      instanceId: "darzana-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const flashOnlyMagic = createCardInstance(FIELD_MAGIC_FLASH_ONLY, {
      instanceId: "field-magic-flash-only",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [darzana, flashOnlyMagic],
      playerOverrides: [{ handCount: 0 }, {}],
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      window: "main_step",
      players: base.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulCoreLocation: { kind: "card", instanceId: "darzana-2" },
            }
          : p
      ),
    };

    const after = executeEffect({
      chainId: "test:bsaz01-c14-soul-core-magic-borrow:210",
      state,
      effect,
      sourceInstanceId: "darzana-2",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    });

    const alice = after.players.find((p) => p.id === ALICE)!;
    // borrow_magic_effect の target (count:1, hasActivatedEffectMode:["main"]) が
    // 候補0件で target shortage となり、connector:"conditional_cost" が発動して
    // 前段のソウルコア支払いごとロールバックされる。
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "darzana-2",
    });
    expect(alice.handCount).toBe(0);
  });
});
