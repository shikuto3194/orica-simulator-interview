/**
 * life_damage_interception の useCostGate 使用コストゲート拡張 — 検証。
 *
 * BSLH01-M05「創の軌跡」effects[1]:「手札にあるこのカードは、アタックステップ中、相手の
 * 効果で自分のライフが減るとき、コストを支払わずに使用することで自分のライフは減らない。」
 *
 * discardCostGate（破棄コストゲート、BSTH02.7-C05[1] 等）の使用版兄弟パターン:
 *  - 支払いは破棄ではなく「このカードの使用」（最終的にトラッシュへ置かれる点は discard と
 *    同じだが、`costKind:"use"` で区別し `lifeDamageInterceptionUseCostGateUsedThisTurn` に
 *    記録される）。
 *  - `timingScope: { player: "both", period: "attack" }` で「アタックステップ中」に限定する
 *    （手札ゾーンの continuous 効果は `evaluateCondition` を呼べない直接スキャン層のため、
 *    `condition` ではなく構造的フィールドの `timingScope` で表現する）。
 *  - pay 確定でこのカードの definitionId が今ターン使用済みとして記録され、同名カードの
 *    effects[2]（フラッシュ召喚）の `field_lacks` 条件を `any_of` で無視できるようになる
 *    (textLines[6])。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeCoreMove,
  executeEffect,
  getLegalActions,
  recordEffectUsageIfLimited,
  resolveLifeDamage,
  resolvePendingLifeDamageDiscardChoice,
  getPlayerLifeCoreCount,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { evaluateCondition } from "../src/effect/structured-condition-eval";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const lookup = buildTriggeredEffectLookup(ALL_CARDS);

const ALICE = "player-1";
const BOB = "player-2";

const lifeOf = (s: GameState, playerId: string): number =>
  getPlayerLifeCoreCount(s.players.find((p) => p.id === playerId)!);

function stateWithM05InHand(step: GameState["step"] = "attack"): GameState {
  const c = card("BSLH01-M05");
  const src = createCardInstance(c, {
    instanceId: "lh01-m05",
    ownerPlayerId: ALICE,
    zone: "hand",
  });
  const state = createEmptyGameState({
    cardInstances: [src],
    startingVoidNormalCoreCount: 0,
    playerOverrides: [
      { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
    ],
  });
  return { ...state, step };
}

describe("useCostGate: 使用コストゲート (BSLH01-M05[1])", () => {
  it("BSLH01-M05[1]: applicability zone hand + life_damage_interception(useCostGate) + timingScope attack を登録", () => {
    const c = card("BSLH01-M05");
    const effect = c.effects![1]!;
    expect(effect.applicability).toEqual({ zone: "hand" });
    expect(effect.stub).toBeUndefined();
    expect(effect.timingScope).toEqual({ player: "both", period: "attack" });
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("replace");
      expect(action.cause).toBe("opponent_effect");
      expect(action.useCostGate).toEqual({ zones: ["hand"], effectIndex: 2 });
    }
  });

  it("[board] アタックステップ中、相手効果のライフ減少でダメージ解決が中断される (pending, costKind:use)", () => {
    const state = stateWithM05InHand("attack");
    expect(state.activeContinuousEffects).toEqual([]);

    const afterAttempt = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );
    expect(afterAttempt.pendingLifeDamageDiscardChoice).not.toBeNull();
    const pending = afterAttempt.pendingLifeDamageDiscardChoice!;
    expect(pending.decidingPlayerId).toBe(ALICE);
    expect(pending.pendingAmount).toBe(1);
    expect(pending.entries[0]!.sourceInstanceId).toBe("lh01-m05");
    expect(pending.entries[0]!.costKind).toBe("use");
    expect(lifeOf(afterAttempt, ALICE)).toBe(5);
  });

  it("[board] アタックステップ外では発火しない (timingScope period:attack 限定)", () => {
    const state = stateWithM05InHand("main");
    const afterAttempt = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );
    expect(afterAttempt.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(afterAttempt, ALICE)).toBe(4);
  });

  it("[board] 同名のフラッシュ使用回数を使い切っている場合、useCostGate を提示せず通常どおりライフが減る", () => {
    const m05 = card("BSLH01-M05");
    const source = createCardInstance(m05, {
      instanceId: "lh01-m05-source",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const sameNameUsed = createCardInstance(m05, {
      instanceId: "lh01-m05-same-name-used",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = recordEffectUsageIfLimited({
      state: {
        ...stateWithM05InHand("attack"),
        cardInstances: [source, sameNameUsed],
      },
      sourceInstanceId: sameNameUsed.instanceId,
      sourceDefinitionId: sameNameUsed.definitionId,
      effectLabel: "magic",
      usageLimit: m05.effects![2]!.usageLimit,
    });

    const afterAttempt = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );

    expect(afterAttempt.pendingLifeDamageDiscardChoice).toBeNull();
    expect(lifeOf(afterAttempt, ALICE)).toBe(4);
    expect(
      getLegalActions({
        state: afterAttempt,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
      }).some(
        (action) => action.kind === "resolve_pending_life_damage_discard_choice"
      )
    ).toBe(false);
  });

  it("[board] 支払う (pay): カードを使用しライフは減らず、カードはトラッシュへ移動する", () => {
    const state = stateWithM05InHand("attack");
    const pendingState = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );

    const legals = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });
    const action = legals.find(
      (a) => a.kind === "resolve_pending_life_damage_discard_choice"
    );
    expect(action).toBeDefined();
    expect((action as { costKind?: string }).costKind).toBe("use");

    const afterUse = applyLegalAction({
      state: pendingState,
      action: action!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      lifeDamageDiscardChoice: "pay",
    }).state;
    const targetAction = getLegalActions({
      state: afterUse,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();
    const resolved = applyLegalAction({
      state: afterUse,
      action: targetAction!,
      targetInstanceIds: [],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;

    expect(resolved.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(resolved, ALICE)).toBe(5);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "lh01-m05")!.zone
    ).toBe("trash");
    // 使用済みフラグが source instance で記録される (effects[2] の条件無視に必要)。
    expect(
      (resolved.lifeDamageInterceptionUseCostGateUsedThisTurn ?? {})[
        `${ALICE}:lh01-m05`
      ]
    ).toBe(true);
  });

  it("[board] pay は無償 magic 使用として effects[2] を解決し、場にスピリットがいても CB 2 体をトラッシュから召喚する", () => {
    const m05 = card("BSLH01-M05");
    // 対象選択と M05 自身の使用完結を検証するため、召喚時の別効果を持たない CB
    // スピリットを fixture とする。M05 の filter（category/tribe）と盤面遷移だけを
    // 独立して確認し、対象カード固有の追加 pending に依存させない。
    const cbSpirit: CardDefinition = {
      ...card("BSLH01-C01"),
      cardNo: "TEST-M05-CB-SPIRIT",
      effects: [],
    };
    const definitions = new Map(cardNoMap);
    definitions.set(cbSpirit.cardNo, cbSpirit);
    const testGetDef = (id: string): CardDefinition | undefined =>
      definitions.get(id);
    const testLookup = buildTriggeredEffectLookup([...ALL_CARDS, cbSpirit]);
    const state = {
      ...createEmptyGameState({
        cardInstances: [
          createCardInstance(m05, {
            instanceId: "m05-use-source",
            ownerPlayerId: ALICE,
            zone: "hand",
          }),
          createCardInstance(cbSpirit, {
            instanceId: "existing-spirit",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(cbSpirit, {
            instanceId: "cb-from-trash-a",
            ownerPlayerId: ALICE,
            zone: "trash",
          }),
          createCardInstance(cbSpirit, {
            instanceId: "cb-from-trash-b",
            ownerPlayerId: ALICE,
            zone: "trash",
          }),
        ],
        startingVoidNormalCoreCount: 0,
        playerOverrides: [
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 6 },
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        ],
      }),
      step: "attack" as const,
    };
    const pendingState = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      testGetDef
    );
    const payAction = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: testLookup,
    }).find((a) => a.kind === "resolve_pending_life_damage_discard_choice");
    expect(payAction).toBeDefined();

    const afterUse = applyLegalAction({
      state: pendingState,
      action: payAction!,
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: testLookup,
      lifeDamageDiscardChoice: "pay",
    }).state;
    expect(lifeOf(afterUse, ALICE)).toBe(5);
    expect(afterUse.pendingEffectTargetSelection).not.toBeNull();
    expect(
      afterUse.cardInstances.find((c) => c.instanceId === "m05-use-source")
        ?.zone
    ).toBe("in_use");

    const targetAction = getLegalActions({
      state: afterUse,
      actingPlayerId: ALICE,
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: testLookup,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();
    const afterTargets = applyLegalAction({
      state: afterUse,
      action: targetAction!,
      targetInstanceIds: ["cb-from-trash-a", "cb-from-trash-b"],
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: testLookup,
    }).state;

    // 召喚時の最低コア配置は別の pending で解決される。ここまで完結して初めて
    // magic の使用済みカードがトラッシュへ移り、ライフ減少置換からの一連の処理となる。
    expect(afterTargets.pendingMultiPlacement).not.toBeNull();
    const multiPlacementAction = getLegalActions({
      state: afterTargets,
      actingPlayerId: ALICE,
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: testLookup,
    }).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(multiPlacementAction).toBeDefined();
    const resolved = applyLegalAction({
      state: afterTargets,
      action: multiPlacementAction!,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "cb-from-trash-a",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: "cb-from-trash-b",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: testLookup,
    }).state;

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "m05-use-source")
        ?.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "cb-from-trash-a")
        ?.zone
    ).toBe("field");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "cb-from-trash-b")
        ?.zone
    ).toBe("field");
    expect(
      resolved.log.some((entry) => entry.startsWith("magic:without-cost:"))
    ).toBe(true);
  });

  it("[board] effect 内の life→void core_move でも、pay は使用を完結して元のコア移動を防ぐ", () => {
    const state = stateWithM05InHand("attack");
    const pendingState = executeCoreMove(
      state,
      BOB,
      { kind: "life", player: "opponent" },
      { kind: "void", player: "opponent" },
      1,
      "opponent-effect-source",
      undefined,
      undefined,
      getDef
    );
    expect(pendingState.pendingLifeDamageDiscardChoice).not.toBeNull();
    expect(lifeOf(pendingState, ALICE)).toBe(5);

    const payAction = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    }).find(
      (action) => action.kind === "resolve_pending_life_damage_discard_choice"
    );
    expect(payAction).toBeDefined();
    const afterUse = applyLegalAction({
      state: pendingState,
      action: payAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      lifeDamageDiscardChoice: "pay",
    }).state;
    expect(afterUse.pendingEffectTargetSelection).not.toBeNull();
    const targetAction = getLegalActions({
      state: afterUse,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();
    const resolved = applyLegalAction({
      state: afterUse,
      action: targetAction!,
      targetInstanceIds: [],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;

    expect(resolved.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(resolved, ALICE)).toBe(5);
    expect(
      resolved.players.find((player) => player.id === ALICE)!
        .voidNormalCoreCount
    ).toBe(0);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "lh01-m05")
        ?.zone
    ).toBe("trash");
  });

  it("[board] core_move を置換した後、M05 の対象選択完了を待って相手効果の後続 step を再開する", () => {
    const opponentEffect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "life-to-void",
          action: {
            kind: "core_move",
            from: { kind: "life", player: "opponent" },
            to: { kind: "void", player: "opponent" },
            amount: 1,
          },
        },
        {
          id: "after-replaced-life-move",
          action: {
            kind: "core_move",
            from: { kind: "reserve", player: "self" },
            to: { kind: "void", player: "self" },
            amount: 1,
          },
        },
      ],
    } satisfies NonNullable<CardDefinition["effects"]>[number];
    const opponentSourceDef: CardDefinition = {
      ...card("BSLH01-C01"),
      cardNo: "TEST-M05-OPPONENT-CORE-MOVE",
      effects: [opponentEffect],
    };
    const definitions = new Map(cardNoMap);
    definitions.set(opponentSourceDef.cardNo, opponentSourceDef);
    const testGetDef = (id: string): CardDefinition | undefined =>
      definitions.get(id);
    const testLookup = buildTriggeredEffectLookup([
      ...ALL_CARDS,
      opponentSourceDef,
    ]);
    const state = {
      ...createEmptyGameState({
        cardInstances: [
          createCardInstance(card("BSLH01-M05"), {
            instanceId: "m05-core-move-use",
            ownerPlayerId: ALICE,
            zone: "hand",
          }),
          createCardInstance(opponentSourceDef, {
            instanceId: "opponent-core-move-source",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
        startingVoidNormalCoreCount: 0,
        playerOverrides: [
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 1 },
        ],
      }),
      step: "attack" as const,
    };
    const pendingState = executeEffect({
      chainId: "test:bslh01-m05-life-damage-use-cost-gate:486",
      state,
      effect: opponentEffect,
      effectIndex: 0,
      sourceInstanceId: "opponent-core-move-source",
      actingPlayerId: BOB,
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: testLookup,
    });
    expect(
      pendingState.pendingLifeDamageDiscardChoice?.coreMoveResume
    ).toBeDefined();
    expect(
      pendingState.pendingLifeDamageDiscardChoice?.continuation
    ).toBeDefined();

    const payAction = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: testLookup,
    }).find(
      (action) => action.kind === "resolve_pending_life_damage_discard_choice"
    );
    expect(payAction).toBeDefined();
    const afterUse = applyLegalAction({
      state: pendingState,
      action: payAction!,
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: testLookup,
      lifeDamageDiscardChoice: "pay",
    }).state;
    const targetAction = getLegalActions({
      state: afterUse,
      actingPlayerId: ALICE,
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: testLookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();
    const resolved = applyLegalAction({
      state: afterUse,
      action: targetAction!,
      targetInstanceIds: [],
      getCardDefinitionById: testGetDef,
      getRegisteredTriggeredEffectActions: testLookup,
    }).state;

    expect(lifeOf(resolved, ALICE)).toBe(5);
    expect(
      resolved.players.find((player) => player.id === ALICE)!
        .voidNormalCoreCount
    ).toBe(0);
    expect(
      resolved.players.find((player) => player.id === BOB)!
        .reserveNormalCoreCount
    ).toBe(0);
    expect(
      resolved.players.find((player) => player.id === BOB)!.voidNormalCoreCount
    ).toBe(1);
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "m05-core-move-use"
      )?.zone
    ).toBe("trash");
  });

  it("[board] 辞退する (decline): 通常通りライフが減り、カードは手札に残り、使用済みフラグは立たない", () => {
    const state = stateWithM05InHand("attack");
    const pendingState = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );

    const declined = resolvePendingLifeDamageDiscardChoice(
      pendingState,
      "decline"
    );
    expect(declined.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(declined, ALICE)).toBe(4);
    expect(
      declined.cardInstances.find((c) => c.instanceId === "lh01-m05")!.zone
    ).toBe("hand");
    expect(
      declined.lifeDamageInterceptionUseCostGateUsedThisTurn ?? {}
    ).toEqual({});
  });

  it("[board] 自分の効果 (self_effect) によるライフ減少では発火しない (cause:opponent_effect 限定)", () => {
    const state = stateWithM05InHand("attack");
    const afterAttempt = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "self_effect", actingPlayerId: ALICE },
      getDef
    );
    expect(afterAttempt.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(afterAttempt, ALICE)).toBe(4);
  });

  describe("effects[2] クロス効果条件無視: life_damage_interception_use_cost_gate_paid_this_turn", () => {
    it("useCostGate 未使用時は自分の場にスピリット/アルティメットがいるとフラッシュ召喚条件を満たさない", () => {
      const m05 = card("BSLH01-M05");
      const effect = m05.effects![2]!;
      expect(effect.condition).toEqual([
        {
          kind: "any_of",
          groups: [
            [
              {
                kind: "field_lacks",
                player: "self",
                category: ["spirit", "ultimate"],
              },
            ],
            [
              {
                kind: "life_damage_interception_use_cost_gate_paid_this_turn",
                player: "self",
              },
            ],
          ],
        },
      ]);
    });

    it("evaluateCondition: 自分の場にスピリットがいても useCostGate 支払い後は any_of で true になる", () => {
      const m05 = card("BSLH01-M05");
      const spirit = card("BSLH01-C01");
      const spiritInstance = createCardInstance(spirit, {
        instanceId: "spirit-on-field",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const m05Instance = createCardInstance(m05, {
        instanceId: "lh01-m05-paid",
        ownerPlayerId: ALICE,
        zone: "trash",
      });
      const sameNameOtherInstance = createCardInstance(m05, {
        instanceId: "lh01-m05-other",
        ownerPlayerId: ALICE,
        zone: "trash",
      });
      const baseState = createEmptyGameState({
        cardInstances: [spiritInstance, m05Instance, sameNameOtherInstance],
        startingVoidNormalCoreCount: 0,
        playerOverrides: [
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        ],
      });
      const effect = m05.effects![2]!;

      // 未使用状態: 自分の場にスピリットがいる (field_lacks 不成立) かつ
      // useCostGate 未支払い (フラグ無し) → any_of 全体が false。
      expect(
        evaluateCondition(
          baseState,
          effect.condition!,
          "lh01-m05-paid",
          ALICE,
          getDef
        )
      ).toBe(false);

      // useCostGate 支払い済み: フラグが立っていれば field_lacks の成否に関わらず true。
      const paidState: GameState = {
        ...baseState,
        lifeDamageInterceptionUseCostGateUsedThisTurn: {
          [`${ALICE}:${m05Instance.instanceId}`]: true,
        },
      };
      expect(
        evaluateCondition(
          paidState,
          effect.condition!,
          "lh01-m05-paid",
          ALICE,
          getDef
        )
      ).toBe(true);

      // 「このカードの効果で使用していたとき」は同名の別 copy には波及しない。
      expect(
        evaluateCondition(
          paidState,
          effect.condition!,
          "lh01-m05-other",
          ALICE,
          getDef
        )
      ).toBe(false);
    });

    it("useCostGate 支払い後は lifeDamageInterceptionUseCostGateUsedThisTurn が該当 source instance で記録される", () => {
      const state = stateWithM05InHand("attack");
      const pendingState = resolveLifeDamage(
        state,
        ALICE,
        1,
        [],
        { cause: "opponent_effect", actingPlayerId: BOB },
        getDef
      );
      const action = getLegalActions({
        state: pendingState,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
      }).find((a) => a.kind === "resolve_pending_life_damage_discard_choice");
      const resolved = applyLegalAction({
        state: pendingState,
        action: action!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
        lifeDamageDiscardChoice: "pay",
      }).state;
      const key = `${ALICE}:lh01-m05`;
      expect(
        (resolved.lifeDamageInterceptionUseCostGateUsedThisTurn ?? {})[key]
      ).toBe(true);
    });
  });
});
