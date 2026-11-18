/**
 * force_first_attacker primitive（ENGINE-force-first-attack-this-turn）。
 * 「このスピリットは可能ならこのターンの最初にアタックする」(BSTH02.7-TR02(A) effects[2] step2)。
 *
 * getAttackDeclarationBlockReason に「可能なら」の強制ゲートを追加する:
 * - 今ターンまだバトルが終了しておらず、強制対象カードが自分自身以外で、かつ強制対象カード
 *   自身が現に合法アタック宣言可能なら、他カードのアタック宣言を "forced_first_attacker_pending"
 *   で抑止する。
 * - 強制対象カードが疲労等で宣言不能になれば（「可能なら」の解除）、他カードのアタック宣言は
 *   通常どおり legal になる。
 * - 今ターン中に既にバトルが1つ終了していれば（battlesEndedThisTurn > 0）、「最初」の機会は
 *   過ぎているため制約は適用しない。
 *
 * 同じゲート (getPendingForcedFirstAttackerId) を getAvailableEndAttackStepLegalActions にも
 * 配線する: 強制対象カードが合法アタック宣言可能な間は、誰にもアタックさせずにアタックステップを
 * 終了する選択 (end_attack_step) を抜け道として使えない（さもないと「強制」が
 * 「他カードを足止めするだけで対象自身は攻めなくてもよい」という骨抜きの実装になる）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src";
import {
  getAttackDeclarationBlockReason,
  getPendingForcedFirstAttackerId,
} from "../src/battle/battle-availability";
import { getAvailableEndAttackStepLegalActions } from "../src/legal/legal-actions-availability";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

// アタッカーに使う素のスピリット（効果なし）。card-data が充実するほど「元から
// effects 未実装のカード」が枯渇しうるため、任意のスピリットから effects を上書き
// した合成カードを cardNo を差し替えて cardNoMap に登録する（実在カードの effects
// 内容に依存しない）。getCardDefinitionById は definitionId(=cardNo) 経由で
// cardNoMap を引くため、この登録をしないと上書きした effects:[] が反映されない。
const attacker: CardDefinition = {
  ...ALL_CARDS.find((c) => c.printedCategory === "spirit")!,
  cardNo: "TEST-VANILLA-SPIRIT",
  effects: [],
};
cardNoMap.set(attacker.cardNo, attacker);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function forceFirstAttackerCE(
  targetInstanceId: string,
  actingPlayerId: string
): ContinuousEffect {
  return {
    effectId: "ce-force-first-attacker-test",
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: attacker.cardNo,
    actingPlayerId,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "force_first_attacker",
    targetInstanceId,
  };
}

function buildAttackState(options: {
  forcedInstanceId: string;
  otherInstanceId: string;
  forcedExhaustState?: "recovered" | "exhausted" | "heavily_exhausted";
  battlesEndedThisTurn?: number;
}): GameState {
  const empty = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const forced = createCardInstance(attacker, {
    instanceId: options.forcedInstanceId,
    ownerPlayerId: "alice",
    zone: "field",
    exhaustState: options.forcedExhaustState ?? "recovered",
  });
  const other = createCardInstance(attacker, {
    instanceId: options.otherInstanceId,
    ownerPlayerId: "alice",
    zone: "field",
  });
  return {
    ...empty,
    activePlayerId: "alice",
    step: "attack",
    window: "none",
    activeAttack: null,
    battlesEndedThisTurn: options.battlesEndedThisTurn ?? 0,
    cardInstances: [forced, other],
    activeContinuousEffects: [
      forceFirstAttackerCE(options.forcedInstanceId, "alice"),
    ],
  };
}

describe("force_first_attacker primitive (ENGINE-force-first-attack-this-turn)", () => {
  it("強制対象カードが合法アタック宣言可能な間、他カードのアタック宣言は forced_first_attacker_pending で抑止される", () => {
    const state = buildAttackState({
      forcedInstanceId: "forced",
      otherInstanceId: "other",
    });

    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "other",
        getCardDefinitionById,
      })
    ).toBe("forced_first_attacker_pending");
  });

  it("強制対象カード自身はアタック宣言可能なまま（自己ブロックしない）", () => {
    const state = buildAttackState({
      forcedInstanceId: "forced",
      otherInstanceId: "other",
    });

    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "forced",
        getCardDefinitionById,
      })
    ).toBeNull();
  });

  it("「可能なら」: 強制対象カードが疲労等でアタック宣言不能になれば、他カードの制約は自然に解除される", () => {
    const state = buildAttackState({
      forcedInstanceId: "forced",
      otherInstanceId: "other",
      forcedExhaustState: "exhausted",
    });

    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "other",
        getCardDefinitionById,
      })
    ).toBeNull();
  });

  it("今ターン中に既にバトルが1つ終了していれば（最初の機会が過ぎている）、他カードの制約は適用されない", () => {
    const state = buildAttackState({
      forcedInstanceId: "forced",
      otherInstanceId: "other",
      battlesEndedThisTurn: 1,
    });

    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "other",
        getCardDefinitionById,
      })
    ).toBeNull();
  });

  it("相手プレイヤーのアタック宣言には影響しない（「自分の」スピリット限定）", () => {
    const empty = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const forced = createCardInstance(attacker, {
      instanceId: "forced",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const bobSpirit = createCardInstance(attacker, {
      instanceId: "bob-sp",
      ownerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...empty,
      activePlayerId: "bob",
      step: "attack",
      window: "none",
      activeAttack: null,
      battlesEndedThisTurn: 0,
      cardInstances: [forced, bobSpirit],
      activeContinuousEffects: [forceFirstAttackerCE("forced", "alice")],
    };

    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "bob",
        sourceInstanceId: "bob-sp",
        getCardDefinitionById,
      })
    ).toBeNull();
  });

  it("強制対象カードが合法アタック宣言可能な間、誰にもアタックさせずアタックステップを終了する抜け道 (end_attack_step) は使えない", () => {
    const state = buildAttackState({
      forcedInstanceId: "forced",
      otherInstanceId: "other",
    });

    expect(
      getPendingForcedFirstAttackerId(state, "alice", getCardDefinitionById)
    ).toBe("forced");

    const endActions = getAvailableEndAttackStepLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    expect(endActions).toHaveLength(0);
  });

  it("強制対象カードが疲労等でアタック宣言不能になれば、end_attack_step は通常どおり legal になる", () => {
    const state = buildAttackState({
      forcedInstanceId: "forced",
      otherInstanceId: "other",
      forcedExhaustState: "exhausted",
    });

    expect(
      getPendingForcedFirstAttackerId(state, "alice", getCardDefinitionById)
    ).toBeNull();

    const endActions = getAvailableEndAttackStepLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    expect(endActions).toHaveLength(1);
    expect(endActions[0]!.kind).toBe("end_attack_step");
  });

  it("今ターン中に既にバトルが1つ終了していれば、end_attack_step は抑止されない", () => {
    const state = buildAttackState({
      forcedInstanceId: "forced",
      otherInstanceId: "other",
      battlesEndedThisTurn: 1,
    });

    const endActions = getAvailableEndAttackStepLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    expect(endActions).toHaveLength(1);
  });
});
