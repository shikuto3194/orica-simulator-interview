/**
 * P3-63 step 7: BSTH02-M01「[妖々夢]十六夜 咲夜」 end-to-end 検証。
 *
 * カード本文 (textLines[2]):
 *   【バースト：相手のスピリット／アルティメットのアタック後】
 *   自分の手札にある系統：「冥主」を持つカード1枚を破棄することで、自分のターンを行う。
 *   ただし、追加したターンで『コアステップ』、『アタックステップ』は行えない。
 *   この効果は相手のライフが3以下か、自分のフィールドにカードが3枚以上あれば発揮できず、
 *   『相手のアタックステップ』でしか発揮できない。
 *   追加したターン終了時、『相手のアタックステップ』のバトル中に戻る。
 *   このバースト効果はゲーム中に1回しか使えない。
 *
 * シナリオ:
 *   1. 正常解決: 条件成立 → discard 冥主 + grant_extra_turn → alice の追加ターン
 *      → end ステップで bob のアタックステップ復帰、usageLimit 1 件消費。
 *   2. condition unmet (相手ライフ 3 以下): 宣言段階または resolve 時に発揮不能 →
 *      usageLimit refund、cost 未払い、追加ターンなし。
 *   3. condition unmet (自フィールド 3 枚以上): 同上。
 *   4. ▶コスト 不能 (手札に冥主なし): conditional_cost で全体不発 → refund。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import {
  executeGrantExtraTurn,
  startDeferredExtraTurnIfReady,
} from "../src/effect/structured-state-grants";
import {
  resolveLifeDamage,
  resolvePendingLifeDamageDiscardChoice,
} from "../src/core/core-system";
import { resolveStackCascade } from "../src/legal/stack-resolution-core";
import type {
  CardDefinition,
  GameState,
  LegalAction,
  RegisteredBurstAction,
} from "../src";

const 咲夜 = ALL_CARDS.find((c) => c.cardNo === "BSTH02-M01")!;
const リトルレギオン = ALL_CARDS.find((c) => c.cardNo === "BSTH02.7-C05")!;

// 冥主系統を持つコストカード (discard 対象)。実カードを探す。
const 冥主Card = ALL_CARDS.find(
  (c) =>
    c.printedCategory === "spirit" &&
    c.tribe?.split("・").includes("冥主") &&
    c.cardNo !== 咲夜.cardNo
);
if (!冥主Card) {
  throw new Error("テスト前提: 冥主系統スピリットが card-data に存在しない");
}

// 相手のアタック source 用に汎用 spirit
const oppAttacker = ALL_CARDS.find(
  (c) =>
    c.printedCategory === "spirit" &&
    (c.levelDefs?.[0]?.bp ?? 0) > 0 &&
    c.cardNo !== 咲夜.cardNo &&
    c.cardNo !== 冥主Card.cardNo
);
if (!oppAttacker) {
  throw new Error("テスト前提: 相手アタッカーとなる spirit カードが必要");
}

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

// BSTH02-M01 の burst registration を手書きで提供
const 咲夜BurstReg: RegisteredBurstAction = {
  sourceKind: "spirit",
  eventKind: "attack_after",
  usageLimit: { kind: "per_card_name", duration: "game" },
};
const getRegisteredBurstActions = (cardNo: string) =>
  cardNo === 咲夜.cardNo ? [咲夜BurstReg] : undefined;

const triggeredLookup = (_: string) => undefined;
const fieldEffectLookup = (_: string) => undefined;
const getHandWrittenEffectResolver = (_: string) => undefined;

interface ScenarioOptions {
  /** 相手 (bob) のライフ。BSTH02-M01 condition は `opponent.life >= 4` (alice 視点)。 */
  bobLife?: number; // default 5
  aliceLife?: number; // default 5
  aliceFieldCount?: number; // default 0
  aliceHasMeishu?: boolean; // default true
}

function buildBobAttackScenario(opts: ScenarioOptions = {}): GameState {
  const bobLife = opts.bobLife ?? 5;
  const aliceLife = opts.aliceLife ?? 5;
  const aliceFieldCount = opts.aliceFieldCount ?? 0;
  const aliceHasMeishu = opts.aliceHasMeishu ?? true;

  const 咲夜Instance = createCardInstance(咲夜, {
    instanceId: "sakuya-burst",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  const oppAttackerInstance = createCardInstance(oppAttacker!, {
    instanceId: "bob-attacker",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const aliceFieldCards = Array.from({ length: aliceFieldCount }, (_, i) =>
    createCardInstance(冥主Card!, {
      instanceId: `alice-field-${i}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    })
  );
  const aliceHandCards = aliceHasMeishu
    ? [
        createCardInstance(冥主Card!, {
          instanceId: "alice-hand-meishu",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "hand",
        }),
      ]
    : [];
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      { lifeNormalCoreCount: aliceLife, handCount: aliceHandCards.length },
      { lifeNormalCoreCount: bobLife },
    ],
  });
  return {
    ...base,
    turnNumber: 5,
    activePlayerId: "bob",
    step: "attack",
    window: "none",
    activeAttack: {
      attackId: "attack-1",
      attackerInstanceId: "bob-attacker",
      defenderPlayerId: "alice",
      blockerInstanceId: null,
      cardEventChainId: null,
      windowState: "battle_resolution",
    } as GameState["activeAttack"],
    cardInstances: [
      咲夜Instance,
      oppAttackerInstance,
      ...aliceFieldCards,
      ...aliceHandCards,
    ],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "sakuya-burst" }],
    pendingBurstChecks: [
      {
        checkId: "p3-63-burst-1",
        actingPlayerId: "alice",
        eventKind: "attack_after",
        source: "battle_resolution",
        chainId: "test:p3-63-bsth02-m01-end-to-end:165",
        attackId: "attack-1",
        relatedPlayerId: "bob",
        amount: 0,
        step: "attack",
        window: "battle_resolution",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
}

function findBurstDeclaration(
  state: GameState
): Extract<LegalAction, { kind: "resolve_pending_burst_check" }> | undefined {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: fieldEffectLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions,
  }).find(
    (a): a is Extract<LegalAction, { kind: "resolve_pending_burst_check" }> =>
      a.kind === "resolve_pending_burst_check" &&
      a.sourceInstanceId === "sakuya-burst"
  );
}

function resolveSakuyaBurst(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_burst_check" }>
) {
  let current = applyLegalAction({
    state,
    action,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: fieldEffectLookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions,
    getHandWrittenEffectResolver,
  }).state;

  for (let guard = 0; guard < 4; guard += 1) {
    if (current.window !== "stack" || current.stackWindow === null) {
      return { state: current };
    }
    const actingPlayerId = current.stackWindow.priorityPlayerId;
    const passAction = getLegalActions({
      state: current,
      actingPlayerId,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions,
    }).find((a) => a.kind === "pass_stack");
    expect(passAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: passAction!,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    }).state;
  }
  throw new Error("Sakuya burst stack did not resolve");
}

describe("P3-63 step 7: BSTH02-M01 end-to-end (burst + 追加ターン + P3-62 refund)", () => {
  it("未解決の外側 stack がある間は追加ターンを開始せず、解決後に開始する", () => {
    const initial = buildBobAttackScenario({
      aliceLife: 5,
      aliceFieldCount: 0,
      aliceHasMeishu: true,
    });
    const declaration = findBurstDeclaration(initial);
    expect(declaration).toBeDefined();
    const declared = applyLegalAction({
      state: initial,
      action: declaration!,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    }).state;
    const innerSakuyaStack = declared.stackWindow?.pendingStackAction;
    expect(innerSakuyaStack).toBeDefined();

    // pass_stack は stackWindow を閉じた後、LIFO cascade 中の「現在解決中 +
    // 外側の未解決 stack」をこの guard に載せる。咲夜の追加ターンは、この
    // 外側 stack が元の攻撃文脈で完走するまで予約のままでなければならない。
    const deferred = executeGrantExtraTurn(
      {
        ...declared,
        window: "declare_attack",
        stackWindow: null,
        pendingStackCascadeFlushGuardStacks: [innerSakuyaStack!],
      },
      "alice",
      {
        kind: "grant_extra_turn",
        player: "self",
        skipSteps: ["core", "attack"],
        returnPoint: "previous_attack_battle",
      }
    );

    expect(deferred.turnNumber).toBe(5);
    expect(deferred.activePlayerId).toBe("bob");
    expect(deferred.activeAttack?.attackId).toBe("attack-1");
    expect(deferred.extraTurnState?.deferredStart).toBe(true);

    const beforeOuterStackResolved = startDeferredExtraTurnIfReady(deferred);
    expect(beforeOuterStackResolved.turnNumber).toBe(5);
    expect(beforeOuterStackResolved.activePlayerId).toBe("bob");
    expect(beforeOuterStackResolved.activeAttack?.attackId).toBe("attack-1");

    const afterOuterStackResolved = startDeferredExtraTurnIfReady({
      ...beforeOuterStackResolved,
      pendingStackCascadeFlushGuardStacks: undefined,
      // ここは outer stack まで完走し、そこから生じた待機効果も drain 済みの
      // 安定点を表す。guard だけを外しても burst 宣言直後の pending が残る間は、
      // 追加ターンを開始してはならない。
      pendingPrivateDeclarations: [],
      pendingDeferredTriggeredEffects: [],
      pendingTriggeredEffects: [],
      pendingBurstChecks: [],
      battleImmediateEffects: [],
      pendingImmediateBattleEnds: [],
      pendingBattleEndFinalizeAttackIds: [],
      pendingAttackStepEndFinalizations: [],
      pendingTurnEndFinalizations: [],
      pendingConnectBattleDecision: null,
      pendingStackNegateRequests: [],
    });
    expect(afterOuterStackResolved.turnNumber).toBe(6);
    expect(afterOuterStackResolved.activePlayerId).toBe("alice");
    expect(afterOuterStackResolved.step).toBe("start");
    expect(afterOuterStackResolved.activeAttack).toBeNull();
  });

  it("外側 stack が生成したライフダメージ破棄選択の完了まで追加ターンを開始しない", () => {
    const initial = buildBobAttackScenario({
      aliceLife: 5,
      aliceFieldCount: 0,
      aliceHasMeishu: true,
    });
    const declaration = findBurstDeclaration(initial);
    expect(declaration).toBeDefined();
    const declared = applyLegalAction({
      state: initial,
      action: declaration!,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    }).state;
    const innerSakuyaStack = declared.stackWindow?.pendingStackAction;
    expect(innerSakuyaStack).toBeDefined();
    const discardGate = createCardInstance(リトルレギオン, {
      instanceId: "alice-little-legion",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });

    const deferred = executeGrantExtraTurn(
      {
        ...declared,
        window: "declare_attack",
        stackWindow: null,
        pendingBurstChecks: [],
        cardInstances: [...declared.cardInstances, discardGate],
        pendingStackCascadeFlushGuardStacks: [innerSakuyaStack!],
      },
      "alice",
      {
        kind: "grant_extra_turn",
        player: "self",
        skipSteps: ["core", "attack"],
        returnPoint: "previous_attack_battle",
      }
    );

    // 外側 stack の効果による opponent_effect ダメージとして解決する。手札の
    // リトルレギオンが discardCostGate を提示するため、追加ターンの前に
    // プレイヤーの支払い/辞退選択を完了しなければならない。
    const awaitingDamageChoice = resolveLifeDamage(
      {
        ...deferred,
        pendingStackCascadeFlushGuardStacks: undefined,
      },
      "alice",
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: "bob" },
      getCardDefinitionById
    );
    expect(awaitingDamageChoice.pendingLifeDamageDiscardChoice).not.toBeNull();

    const blocked = startDeferredExtraTurnIfReady(awaitingDamageChoice);
    expect(blocked.turnNumber).toBe(5);
    expect(blocked.activePlayerId).toBe("bob");
    expect(blocked.activeAttack?.attackId).toBe("attack-1");

    const choiceResolved = resolvePendingLifeDamageDiscardChoice(
      blocked,
      "pay"
    );
    expect(choiceResolved.pendingLifeDamageDiscardChoice).toBeNull();
    expect(
      choiceResolved.cardInstances.find(
        (card) => card.instanceId === "alice-little-legion"
      )?.zone
    ).toBe("trash");

    const started = startDeferredExtraTurnIfReady(choiceResolved);
    expect(started.turnNumber).toBe(6);
    expect(started.activePlayerId).toBe("alice");
    expect(started.step).toBe("start");
  });

  it("stack-cascade 出口でも別の battle-end 誘発が解決してから追加ターンを開始する", () => {
    const base = buildBobAttackScenario({
      aliceLife: 5,
      aliceFieldCount: 0,
      aliceHasMeishu: true,
    });
    const stackState: GameState = {
      ...base,
      window: "stack",
      stackWindow: {
        actingPlayerId: "bob",
        previousWindow: "declare_attack",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        pendingStackAction: {
          stackId: "other-burst-effect-declaration",
          actionKind: "burst_activation",
          chainId: "other-burst",
          actingPlayerId: "bob",
          cardInstanceId: "bob-attacker",
          targetInstanceIds: [],
          targetEffectFilterTags: [],
        },
      },
    };

    const deferred = executeGrantExtraTurn(stackState, "alice", {
      kind: "grant_extra_turn",
      player: "self",
      skipSteps: ["core", "attack"],
      returnPoint: "previous_attack_battle",
    });

    expect(deferred.turnNumber).toBe(5);
    expect(deferred.activePlayerId).toBe("bob");
    expect(deferred.window).toBe("stack");
    expect(deferred.stackWindow).not.toBeNull();
    expect(deferred.extraTurnState?.deferredStart).toBe(true);

    // M01 の応答 stack は閉じたが、その過程で生じた別の
    // battle-end 誘発が未解決なら、cascade 出口から追加ターンへ超越しては
    // ならない。`processPendingImmediateBattleEnds` は entry を drain するが、生じた
    // pending trigger は次の解決を待つ。ここは `resolveStackCascade` の実経路で
    // その trigger が追加ターン開始を block することを検証する。
    const afterCascade = resolveStackCascade(
      {
        ...deferred,
        window: "declare_attack",
        stackWindow: null,
        pendingBurstChecks: [],
        pendingTriggeredEffects: [
          {
            pendingId: "other-battle-end-trigger",
            actingPlayerId: "bob",
            eventKind: "battle_end",
            source: "battle_resolution",
            chainId: "test:p3-63-bsth02-m01-end-to-end:447",
            attackId: "attack-1",
            relatedPlayerId: "bob",
            relatedInstanceId: "bob-attacker",
            amount: null,
            step: "attack",
            window: "battle_resolution",
            resolvedSourceInstanceIds: [],
          },
        ],
        pendingImmediateBattleEnds: [
          {
            attackId: "attack-1",
            participantInstanceIds: [],
            blockSideInstanceIds: [],
            participantSnapshots: [],
          },
        ],
      },
      [],
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions,
      }
    );

    expect(afterCascade.turnNumber).toBe(5);
    expect(afterCascade.activePlayerId).toBe("bob");
    expect(afterCascade.extraTurnState?.deferredStart).toBe(true);
    expect(afterCascade.pendingTriggeredEffects).toHaveLength(1);
    expect(afterCascade.pendingImmediateBattleEnds).toHaveLength(0);
    expect(afterCascade.pendingBattleEndFinalizeAttackIds).toEqual([
      "attack-1",
    ]);

    const started = advanceStep(
      {
        ...afterCascade,
        pendingTriggeredEffects: [],
        pendingImmediateBattleEnds: [],
        pendingBattleEndFinalizeAttackIds: [],
      },
      getCardDefinitionById,
      triggeredLookup
    );

    expect(started.turnNumber).toBe(6);
    expect(started.activePlayerId).toBe("alice");
    expect(started.step).toBe("start");
    expect(started.window).toBe("none");
    expect(started.extraTurnState?.deferredStart).toBeUndefined();
    expect(started.extraTurnState?.returnContext).toMatchObject({
      turnNumber: 5,
      activePlayerId: "bob",
      step: "attack",
      window: "declare_attack",
    });
  });

  it("正常解決: condition 成立 → discard 冥主 + grant_extra_turn → alice 追加ターン", () => {
    const initial = buildBobAttackScenario({
      aliceLife: 5,
      aliceFieldCount: 0,
      aliceHasMeishu: true,
    });
    const decl = findBurstDeclaration(initial);
    expect(decl).toBeDefined();

    const result = resolveSakuyaBurst(initial, decl!);

    // alice の追加ターンへ遷移
    expect(result.state.turnNumber).toBe(6);
    expect(result.state.activePlayerId).toBe("alice");
    expect(result.state.step).toBe("start");
    expect(result.state.extraTurnState).toBeDefined();
    expect(result.state.extraTurnState?.ownerPlayerId).toBe("alice");
    expect(result.state.extraTurnState?.skipSteps).toEqual(["core", "attack"]);
    expect(result.state.extraTurnState?.returnContext).toMatchObject({
      turnNumber: 5,
      activePlayerId: "bob",
      step: "attack",
    });

    // usageLimit 記録 (ゲーム中 1 回)
    const usageRecords = result.state.effectUsageRecords.filter(
      (r) =>
        r.sourceInstanceId === "sakuya-burst" && r.effectLabel === "burst:0"
    );
    expect(usageRecords).toHaveLength(1);
    expect(usageRecords[0]?.duration).toBe("game");
  });

  it("condition unmet (相手ライフ 3): 発揮できない → refund + cost 未払い + 追加ターンなし", () => {
    // BSTH02-M01 condition: opponent.life >= 4 (alice 視点 → bob.life >= 4)
    const initial = buildBobAttackScenario({
      bobLife: 3, // ← 条件 NG (相手 bob のライフが 3)
      aliceFieldCount: 0,
      aliceHasMeishu: true,
    });
    const decl = findBurstDeclaration(initial);
    expect(decl).toBeDefined();

    const result = resolveSakuyaBurst(initial, decl!);

    // bob のターンを維持 (追加ターン取得していない)
    expect(result.state.activePlayerId).toBe("bob");
    expect(result.state.turnNumber).toBe(5);
    expect(result.state.extraTurnState).toBeFalsy();

    // P3-62 refund: usageLimit 記録は除去されている
    const usageRecords = result.state.effectUsageRecords.filter(
      (r) =>
        r.sourceInstanceId === "sakuya-burst" && r.effectLabel === "burst:0"
    );
    expect(usageRecords).toHaveLength(0);

    // alice の手札はそのまま (discard cost が rollback された)
    const aliceMeishuStillInHand = result.state.cardInstances.find(
      (c) =>
        c.instanceId === "alice-hand-meishu" &&
        c.controllerPlayerId === "alice" &&
        c.zone === "hand"
    );
    expect(aliceMeishuStillInHand).toBeDefined();
  });

  it("condition unmet (自フィールド 3 枚): 同様に refund + 追加ターンなし", () => {
    const initial = buildBobAttackScenario({
      aliceLife: 5,
      aliceFieldCount: 3, // ← 条件 NG
      aliceHasMeishu: true,
    });
    const decl = findBurstDeclaration(initial);

    const result = resolveSakuyaBurst(initial, decl!);

    expect(result.state.activePlayerId).toBe("bob");
    expect(result.state.extraTurnState).toBeFalsy();
    const usageRecords = result.state.effectUsageRecords.filter(
      (r) =>
        r.sourceInstanceId === "sakuya-burst" && r.effectLabel === "burst:0"
    );
    expect(usageRecords).toHaveLength(0);
  });

  it("正常解決後 advanceStep 連鎖で core/attack スキップ + end → bob 復帰", () => {
    const initial = buildBobAttackScenario({
      aliceLife: 5,
      aliceFieldCount: 0,
      aliceHasMeishu: true,
    });
    const decl = findBurstDeclaration(initial);
    const burstResult = resolveSakuyaBurst(initial, decl!);

    // alice's extra turn: start → (core skip) → draw → refresh → main → (attack skip) → end
    let current = burstResult.state;
    // 6 ステップ (start→draw, draw→refresh, refresh→main, main→end, end→cleanup, cleanup→restore) を踏む
    for (let i = 0; i < 8 && current.extraTurnState; i++) {
      current = advanceStep(current, getCardDefinitionById, triggeredLookup);
    }

    // bob の attack step に復帰
    expect(current.activePlayerId).toBe("bob");
    expect(current.turnNumber).toBe(5);
    expect(current.step).toBe("attack");
    expect(current.extraTurnState).toBeNull();
    // extra-turn-skip ログが core / attack 両方に対して残っている
    expect(
      current.log.some((l) => l.startsWith("step:extra-turn-skip:6:alice:core"))
    ).toBe(true);
    expect(
      current.log.some((l) =>
        l.startsWith("step:extra-turn-skip:6:alice:attack")
      )
    ).toBe(true);
  });
});

// ruling C (2026-06-24): BSTH02-M01 effects[0]「トラッシュに置かれたこのカードは除外する。」
// 終止形=強制。findMovedToTrashAutoEffect の default は mandatory だが、card_event 系の
// default 非対称 (revealed=optional / moved_to_trash=mandatory) 回避のため per-effect 明示が必須
// (cards:fidelity 監査 fail で機械検知)。
describe("BSTH02-M01 effects[0] moved_to_trash remove_from_game", () => {
  it("executionMode が mandatory 明示 (ruling C)", () => {
    const eff = 咲夜.effects![0]!;
    expect(eff.timing).toEqual({ kind: "card_event", event: "moved_to_trash" });
    expect(eff.executionMode).toBe("mandatory");
    expect(eff.steps[0]!.action.kind).toBe("remove_from_game");
  });
});
