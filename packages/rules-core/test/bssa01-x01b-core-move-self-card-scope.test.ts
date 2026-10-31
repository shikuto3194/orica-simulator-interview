/**
 * BSSA01-転醒X01(B) 夜空の剣 effect textRef[3,4] Lv問わず(合体中)
 * 「このスピリットのコア除去効果で移動するコアの数を+1し、このスピリットによって
 * 減る相手のライフの数を+1する。」の挙動検証。
 *
 * 設計:
 * - core_move_amount_modifier を2ステップ登録: scope:"self_card" (コア除去効果、
 *   BSTH001-転醒R02(A) の self_player_spirits と異なり「このスピリット自身」限定)
 *   + scope:"self_card_opponent_life_reduction" (ライフ↔リザーブは「コア除去効果」と
 *   別扱い、10_rules/06 line120、のため独立スコープで加算)。
 * - このカードは合体ブレイヴ (printedCategory:"brave") であり、自身の効果実行は
 *   sourceInstanceId=ブレイヴ自身の instanceId で解決される (先例:
 *   bssa01-bssg02-cards.test.ts の記憶開放術テストで sourceInstanceId==="night-sword"
 *   と確認済み)。self_card スコープは printedCategory==="spirit" を要求しない。
 */
import { describe, expect, it } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeLifeDamage } from "../src/effect/structured-state-grants";
import { executeCoreMove } from "../src/effect/structured-effect-interpreter";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState, CardInstance } from "../src/model";

// BSSA01-転醒X01(B) はネストされた backFace のため、ALL_CARDS の raw Map では
// 引けない (先例: bssa01-cards.test.ts / bssa01-bssg02-cards.test.ts と同型)。
const expandedCardDefinitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const cardNoMap = new Map<string, CardDefinition>(
  expandedCardDefinitions.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const NIGHT_SWORD = "BSSA01-転醒X01(B)";
const PLAYER = "alice";
const OPP = "bob";

function placeHost(instanceId: string, normalCoreCount = 1): CardInstance {
  // BSSA01-X01 前面「黒の剣士キリト」相当のホストスピリット代役。
  return createCardInstance(getDef("BSSA01-X01")!, {
    ownerPlayerId: PLAYER,
    zone: "field",
    instanceId,
    normalCoreCount,
  });
}

function placeNightSword(
  instanceId: string,
  attachedToInstanceId: string | null
): CardInstance {
  return {
    ...createCardInstance(getDef(NIGHT_SWORD)!, {
      ownerPlayerId: PLAYER,
      zone: "field",
      instanceId,
    }),
    attachedToInstanceId,
  };
}

function opponentTarget(
  instanceId: string,
  normalCoreCount: number
): CardInstance {
  return createCardInstance(getDef("BSTH001-C03")!, {
    ownerPlayerId: OPP,
    zone: "field",
    instanceId,
    normalCoreCount,
  });
}

function setupCombinedState(targetCores: number): GameState {
  const host = {
    ...placeHost("kirito-host"),
    attachedChildrenIds: ["night-sword"],
  };
  const nightSword = placeNightSword("night-sword", "kirito-host");
  const state = createEmptyGameState({
    playerIds: [PLAYER, OPP],
    cardInstances: [
      host,
      nightSword,
      opponentTarget("opp-target", targetCores),
    ],
  });
  return rebuildContinuousEffectsFromField(state, getDef);
}

describe("BSSA01-転醒X01(B) コア除去効果+相手ライフ減少 +1 (core_move_amount_modifier self_card scope)", () => {
  it("card data: stub が消え、self_card / self_card_opponent_life_reduction の2ステップを持つ", () => {
    const def = getDef(NIGHT_SWORD)!;
    const targetEffect = def.effects?.find((e) =>
      e.steps.some((s) => s.action.kind === "core_move_amount_modifier")
    );
    expect(targetEffect).toBeDefined();
    expect(targetEffect?.stub).toBeUndefined();
    const scopes = targetEffect!.steps.map((s) =>
      s.action.kind === "core_move_amount_modifier" ? s.action.scope : null
    );
    expect(scopes.sort()).toEqual(
      ["self_card", "self_card_opponent_life_reduction"].sort()
    );
  });

  it("合体中に2件の core_move_amount_modifier CE が登録される (未合体では登録されない)", () => {
    const combined = setupCombinedState(3);
    const ces = combined.activeContinuousEffects.filter(
      (e) => e.modifierTag === "core_move_amount_modifier"
    );
    expect(ces).toHaveLength(2);
    expect(ces.map((ce) => ce.metadata?.coreMoveAmountScope).sort()).toEqual(
      ["self_card", "self_card_opponent_life_reduction"].sort()
    );
    for (const ce of ces) {
      expect(ce.modifierAmount).toBe(1);
      expect(ce.sourceInstanceId).toBe("night-sword");
      expect(ce.actingPlayerId).toBe(PLAYER);
    }

    // 未合体 (attachedToInstanceId: null) では combined 条件が不成立のため CE が無い。
    const detachedState = createEmptyGameState({
      playerIds: [PLAYER, OPP],
      cardInstances: [
        placeHost("kirito-host"),
        placeNightSword("night-sword", null),
        opponentTarget("opp-target", 3),
      ],
    });
    const detached = rebuildContinuousEffectsFromField(detachedState, getDef);
    expect(
      detached.activeContinuousEffects.some(
        (e) => e.modifierTag === "core_move_amount_modifier"
      )
    ).toBe(false);
  });

  it("この夜空の剣自身が実行するコア除去効果 (相手カード source) に+1加算 (base1→2)", () => {
    const state = setupCombinedState(3);
    const after = executeCoreMove(
      state,
      PLAYER,
      { kind: "card_instance", instanceId: "opp-target" },
      { kind: "reserve", player: "opponent" },
      1,
      "night-sword",
      undefined,
      undefined,
      getDef
    );
    const target = after.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    )!;
    // 元3個 → 2個移動 → 残1個
    expect(target.normalCoreCount).toBe(1);
    expect(
      after.log.some((l) =>
        l.startsWith("effect:core_move_amount_modifier:applied:")
      )
    ).toBe(true);
  });

  it("同じ自分側の別スピリット (夜空の剣ではない) が実行するコア除去効果には加算しない — self_card は self_player_spirits と異なりカード限定", () => {
    const state = setupCombinedState(3);
    const otherOwnSpirit: CardInstance = createCardInstance(
      getDef("BSSA01-C01")!,
      {
        ownerPlayerId: PLAYER,
        zone: "field",
        instanceId: "other-own-spirit",
        normalCoreCount: 1,
      }
    );
    const stateWithOther: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, otherOwnSpirit],
    };
    const after = executeCoreMove(
      stateWithOther,
      PLAYER,
      { kind: "card_instance", instanceId: "opp-target" },
      { kind: "reserve", player: "opponent" },
      1,
      "other-own-spirit",
      undefined,
      undefined,
      getDef
    );
    const target = after.cardInstances.find(
      (c) => c.instanceId === "opp-target"
    )!;
    // bonus なしなので 1個のみ移動 → 残2個
    expect(target.normalCoreCount).toBe(2);
    expect(
      after.log.some((l) =>
        l.startsWith("effect:core_move_amount_modifier:applied:")
      )
    ).toBe(false);
  });

  it("この夜空の剣自身が相手ライフのコアを減らすとき+1加算 (base1→2, 相手ライフ3→1)", () => {
    const state = setupCombinedState(0);
    const withLife: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === OPP
          ? { ...p, lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }
          : p
      ),
    };
    const after = executeCoreMove(
      withLife,
      PLAYER,
      { kind: "life", player: "opponent" },
      { kind: "reserve", player: "opponent" },
      1,
      "night-sword",
      undefined,
      undefined,
      getDef
    );
    const opp = after.players.find((p) => p.id === OPP)!;
    // 3 - 2(base1+bonus1) = 1
    expect(opp.lifeNormalCoreCount).toBe(1);
    expect(opp.reserveNormalCoreCount).toBe(2);
    expect(
      after.log.some(
        (l) =>
          l.startsWith("effect:core_move_amount_modifier:applied:") &&
          l.endsWith(":life_reduction")
      )
    ).toBe(true);
  });

  it("別の自分側スピリットが相手ライフを減らすときは加算しない (self_card_opponent_life_reduction もカード限定)", () => {
    const state = setupCombinedState(0);
    const otherOwnSpirit: CardInstance = createCardInstance(
      getDef("BSSA01-C01")!,
      {
        ownerPlayerId: PLAYER,
        zone: "field",
        instanceId: "other-own-spirit",
        normalCoreCount: 0,
      }
    );
    const withLife: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, otherOwnSpirit],
      players: state.players.map((p) =>
        p.id === OPP
          ? { ...p, lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }
          : p
      ),
    };
    const after = executeCoreMove(
      withLife,
      PLAYER,
      { kind: "life", player: "opponent" },
      { kind: "reserve", player: "opponent" },
      1,
      "other-own-spirit",
      undefined,
      undefined,
      getDef
    );
    const opp = after.players.find((p) => p.id === OPP)!;
    // bonus なしなので base 1 のみ移動
    expect(opp.lifeNormalCoreCount).toBe(2);
    expect(opp.reserveNormalCoreCount).toBe(1);
    expect(
      after.log.some(
        (l) =>
          l.startsWith("effect:core_move_amount_modifier:applied:") &&
          l.endsWith(":life_reduction")
      )
    ).toBe(false);
  });

  it("自分のライフが減るとき(from:life, player:self)には加算しない — 相手ライフ限定", () => {
    const state = setupCombinedState(0);
    const withOwnLife: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === PLAYER
          ? { ...p, lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }
          : p
      ),
    };
    const after = executeCoreMove(
      withOwnLife,
      PLAYER,
      { kind: "life", player: "self" },
      { kind: "reserve", player: "self" },
      1,
      "night-sword",
      undefined,
      undefined,
      getDef
    );
    const alice = after.players.find((p) => p.id === PLAYER)!;
    expect(alice.lifeNormalCoreCount).toBe(2);
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(
      after.log.some(
        (l) =>
          l.startsWith("effect:core_move_amount_modifier:applied:") &&
          l.endsWith(":life_reduction")
      )
    ).toBe(false);
  });
});

describe("combined host regression", () => {
  it("host core removal gets +1", () => {
    const state = setupCombinedState(5);
    const after = executeCoreMove(
      state,
      PLAYER,
      { kind: "card_instance", instanceId: "opp-target" },
      { kind: "reserve", player: "opponent" },
      3,
      "kirito-host",
      undefined,
      undefined,
      getDef
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "opp-target")
        ?.normalCoreCount
    ).toBe(1);
  });
  it("host life_damage gets +1", () => {
    const state = setupCombinedState(5);
    state.players[1]!.lifeNormalCoreCount = 5;
    const after = executeLifeDamage(
      state,
      PLAYER,
      { kind: "life_damage", player: "opponent", amount: 1 },
      getDef,
      "kirito-host"
    );
    expect(after.players[1]!.lifeNormalCoreCount).toBe(3);
  });
});
