/**
 * P3-63 step 1: burst path に recordedUsage を伝搬する plumbing の e2e 検証。
 *
 * P3-62 の対応経路 (magic / field / triggered / battle_immediate) と同様に、
 * burst でも宣言 → resolver → executeEffect の経路で recordedUsage を伝搬し、
 * 「発揮できない」(condition unmet / conditional_cost rollback) と判定された場合に
 * usageLimit を払い戻せることを確認する。
 *
 * burst path の特殊性:
 *   - 同期 resolve (非 main step): declaration で recordEffectUsageIfLimited し、
 *     直後に useResolvePendingBurstCheckAsAction で resolver が走る。
 *   - deferred resolve (main step): declaration で usageLimit を記録し
 *     burst_activation ActiveStack を開く → 相手 pass → resolver。
 *
 * 本テストでは同期経路 (attack step 中の burst) で synthetic burst card
 * (count_decrease cost ▶ destroy filter, conditional_cost, usageLimit) を組み立て、
 * target 消失で双方向 atomic + refund を踏ませる。
 *
 * BSTH02-M01 を直接使った e2e は P3-63 完成 (追加ターン DSL + effects 実装) 時点で
 * 別途追加する。本テストは burst plumbing 単体の通電確認に絞る。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type {
  CardDefinition,
  GameState,
  LegalAction,
  RegisteredBurstAction,
} from "../src";

const burstCard: CardDefinition = {
  cardNo: "P3-63-BURST-TEST",
  name: "P3-63 burst conditional_cost テスト",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: ["【バースト：相手のスピリットがアタックした後】"],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "burst" },
      usageLimit: { kind: "per_card_name", duration: "game" },
      steps: [
        {
          id: "cost",
          action: { kind: "count_decrease", player: "self", amount: 1 },
        },
        {
          id: "effect",
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
          connector: "conditional_cost",
        },
      ],
    },
  ],
};

const targetSpirit: CardDefinition = {
  cardNo: "P3-63-BURST-TARGET",
  name: "P3-63 ターゲット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const cardNoMap = new Map<string, CardDefinition>([
  [burstCard.cardNo, burstCard],
  [targetSpirit.cardNo, targetSpirit],
]);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const burstRegistration: RegisteredBurstAction = {
  sourceKind: "spirit",
  eventKind: "attack_after",
  usageLimit: { kind: "per_card_name", duration: "game" },
};
const getRegisteredBurstActions = (cardNo: string) =>
  cardNo === burstCard.cardNo ? [burstRegistration] : undefined;

// Hand-written resolver を渡さなければ tryExecuteStructuredEffects fallback で
// def.effects (DSL) が走る。tryExecuteStructuredEffects は ctx.recordedUsage を
// executeEffect に伝搬するので、burst plumbing が機能していれば refund される。
const getHandWrittenEffectResolver = (_cardNo: string) => undefined;

const triggeredLookup = (_cardNo: string) => undefined;

function buildScenario(): GameState {
  const burstSource = createCardInstance(burstCard, {
    instanceId: "burst-src-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  const oppSpirit = createCardInstance(targetSpirit, {
    instanceId: "opp-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ countValue: 5 }],
  });
  return {
    ...base,
    // bob のアタックステップ中: 相手のスピリットがアタック後 → burst 発動可能
    activePlayerId: "bob",
    step: "attack",
    cardInstances: [burstSource, oppSpirit],
    setBurstStates: [
      {
        playerId: "alice",
        cardInstanceId: "burst-src-1",
      },
    ],
    pendingBurstChecks: [
      {
        checkId: "p3-63-burst-check-1",
        actingPlayerId: "alice",
        eventKind: "attack_after",
        source: "battle_resolution",
        chainId: "test:p3-63-burst-recorded-usage-plumbing:144",
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
): Extract<LegalAction, { kind: "resolve_pending_burst_check" }> {
  const actions = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions,
  });
  const action = actions.find(
    (a): a is Extract<LegalAction, { kind: "resolve_pending_burst_check" }> =>
      a.kind === "resolve_pending_burst_check" &&
      a.sourceInstanceId === "burst-src-1"
  );
  if (!action) {
    throw new Error("expected resolve_pending_burst_check for burst-src-1");
  }
  return action;
}

function resolveAttackAfterBurst(
  state: GameState,
  action: Extract<LegalAction, { kind: "resolve_pending_burst_check" }>
) {
  const afterDeclaration = applyLegalAction({
    state,
    action,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions,
    getHandWrittenEffectResolver,
  }).state;
  expect(afterDeclaration.stackWindow?.burstWindowKind).toBe("activation");

  const activationPass = getLegalActions({
    state: afterDeclaration,
    actingPlayerId: afterDeclaration.stackWindow!.priorityPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions,
  }).find((a) => a.kind === "pass_stack");
  expect(activationPass).toBeDefined();
  const afterActivationPass = applyLegalAction({
    state: afterDeclaration,
    action: activationPass!,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions,
    getHandWrittenEffectResolver,
  }).state;
  expect(afterActivationPass.stackWindow?.burstWindowKind).toBe(
    "effect_declaration"
  );

  const effectDeclarationPass = getLegalActions({
    state: afterActivationPass,
    actingPlayerId: afterActivationPass.stackWindow!.priorityPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions,
  }).find((a) => a.kind === "pass_stack");
  expect(effectDeclarationPass).toBeDefined();
  return applyLegalAction({
    state: afterActivationPass,
    action: effectDeclarationPass!,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions,
    getHandWrittenEffectResolver,
  });
}

describe("P3-63 step 1: burst path recordedUsage 通電 (P3-62 ケース 4 atomic + refund)", () => {
  it("通常解決: cost (count) 支払い + destroy 成立 + usageLimit 1件消費", () => {
    const initial = buildScenario();
    const decl = findBurstDeclaration(initial);

    // burst registration は requiredTargetCount を持たないので legal action は
    // targetMode = "none"。destroy の filter で動的に opp-1 が選ばれる。
    const resolved = resolveAttackAfterBurst(initial, decl);

    // cost paid: count が 5 → 4
    expect(
      resolved.state.players.find((p) => p.id === "alice")!.countValue
    ).toBe(4);

    // destroy 成立: target は trash
    const target = resolved.state.cardInstances.find(
      (c) => c.instanceId === "opp-1"
    )!;
    expect(target.zone).toBe("trash");

    // usageLimit 1 件消費 (refund されていない)
    const usageRecords = resolved.state.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === "burst-src-1" && r.effectLabel === "burst:0"
    );
    expect(usageRecords).toHaveLength(1);
  });

  it("target が場に居ない状態で resolve → destroy 不発: cost rollback (count 不変) + usageLimit refund (P3-62 ケース 4)", () => {
    const initial = buildScenario();
    // 宣言前に target spirit を消す (相手フラッシュで退去等を simulate)
    const stateWithoutTarget: GameState = {
      ...initial,
      cardInstances: initial.cardInstances.map((c) =>
        c.instanceId === "opp-1" ? { ...c, zone: "trash" as const } : c
      ),
    };
    // legal action 列挙時に target がいなくても declaration 自体は通る前提
    // (resolve_pending_burst_check は target なしでも宣言可能)
    const actions = getLegalActions({
      state: stateWithoutTarget,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions,
    });
    const decl = actions.find(
      (a): a is Extract<LegalAction, { kind: "resolve_pending_burst_check" }> =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "burst-src-1"
    );
    expect(decl).toBeDefined();

    const resolved = resolveAttackAfterBurst(stateWithoutTarget, decl!);

    // P3-62 ケース 4 双方向 atomic: cost (count_decrease) rollback → count 不変
    expect(
      resolved.state.players.find((p) => p.id === "alice")!.countValue
    ).toBe(5);

    // usageLimit refund: 宣言時に積んだレコードが除去される
    const usageRecords = resolved.state.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === "burst-src-1" && r.effectLabel === "burst:0"
    );
    expect(usageRecords).toHaveLength(0);

    // ログ: conditional-cost-effect-failed
    expect(
      resolved.state.log.some((l) =>
        l.startsWith("effect:conditional-cost-effect-failed:")
      )
    ).toBe(true);
  });

  it("deferred 経路 (main step burst): 宣言→burst_activation stack 開→相手 pass→resolve、target 消滅で refund (P3-63 残留懸念 #4)", () => {
    // P3-63 archive で「BSTH02-M01 は sync path のみ使うため、main step burst の e2e は
    // synthetic test のみで担保」と記録。本テストは deferred 経路特有の挙動 (stack 開閉 +
    // recordedUsage が activeStack 経由で deferred resolver context まで届くこと) を担保。
    const deferredBurstRegistration: RegisteredBurstAction = {
      sourceKind: "spirit",
      eventKind: "summon",
      usageLimit: { kind: "per_card_name", duration: "game" },
    };
    const deferredGetBurstActions = (cardNo: string) =>
      cardNo === burstCard.cardNo ? [deferredBurstRegistration] : undefined;

    const burstSource = createCardInstance(burstCard, {
      instanceId: "burst-src-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    // target は存在しない (相手フィールドにスピリットなし) — destroy filter で 0 件 → 不発
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 5 }],
    });
    // bob のメインステップ中: bob が直前にスピリット召喚 → alice の summon-burst が立つ
    const initial: GameState = {
      ...base,
      activePlayerId: "bob",
      step: "main",
      cardInstances: [burstSource],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "burst-src-2" }],
      pendingBurstChecks: [
        {
          checkId: "p3-63-deferred-burst-check-1",
          actingPlayerId: "alice",
          eventKind: "summon",
          source: "action_resolution",
          chainId: "test:p3-63-burst-recorded-usage-plumbing:345",
          attackId: null,
          relatedPlayerId: "bob",
          relatedInstanceId: null,
          amount: 0,
          step: "main",
          window: "none",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };

    const declActions = getLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: deferredGetBurstActions,
    });
    const decl = declActions.find(
      (a): a is Extract<LegalAction, { kind: "resolve_pending_burst_check" }> =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "burst-src-2"
    );
    expect(decl).toBeDefined();

    // 宣言適用: deferred 経路で burst_activation ActiveStack が開く (即 resolve せず)
    const afterDecl = applyLegalAction({
      state: initial,
      action: decl!,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: deferredGetBurstActions,
      getHandWrittenEffectResolver,
    });

    // burst_activation stack が開いている (deferred 経路の本質)
    expect(afterDecl.state.stackWindow).not.toBeNull();
    expect(afterDecl.state.stackWindow?.burstWindowKind).toBe("activation");
    const burstStack = afterDecl.state.stackWindow?.pendingStackAction;
    expect(burstStack?.actionKind).toBe("burst_activation");
    expect(burstStack?.cardInstanceId).toBe("burst-src-2");
    // activeStack に recordedUsage が保持されている (P3-62 / P3-63 plumbing)
    expect(burstStack?.recordedUsage?.effectLabel).toBe("burst:0");

    // 宣言時点で usageLimit は記録済み (deferred 経路でも declaration で record する)
    const recordsAtDecl = afterDecl.state.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === "burst-src-2" && r.effectLabel === "burst:0"
    );
    expect(recordsAtDecl).toHaveLength(1);

    // 相手 (bob) が stack window を pass → burst が deferred resolve する
    const passActions = getLegalActions({
      state: afterDecl.state,
      actingPlayerId: afterDecl.state.stackWindow!.priorityPlayerId,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: deferredGetBurstActions,
    });
    const passAction = passActions.find((a) => a.kind === "pass_stack");
    expect(passAction).toBeDefined();

    // 1段目 (activation stack) を bob pass
    const afterActivationPass = applyLegalAction({
      state: afterDecl.state,
      action: passAction!,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: deferredGetBurstActions,
      getHandWrittenEffectResolver,
    });

    // activation 閉鎖後に burst_effect_decl stack が新規 open する仕様。
    expect(afterActivationPass.state.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );

    // 2段目 (effect_declaration stack) を再度 bob pass → 実際の DSL が走る
    const passActions2 = getLegalActions({
      state: afterActivationPass.state,
      actingPlayerId: afterActivationPass.state.stackWindow!.priorityPlayerId,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: deferredGetBurstActions,
    });
    const passAction2 = passActions2.find((a) => a.kind === "pass_stack");
    expect(passAction2).toBeDefined();

    const afterPass = applyLegalAction({
      state: afterActivationPass.state,
      action: passAction2!,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: deferredGetBurstActions,
      getHandWrittenEffectResolver,
    });

    // 全 burst stack はクローズ済
    expect(
      afterPass.state.stackWindow === null ||
        afterPass.state.stackWindow.burstWindowKind === null
    ).toBe(true);

    // target 不在で destroy 不発 → conditional_cost で全体不発 → cost rollback
    expect(
      afterPass.state.players.find((p) => p.id === "alice")!.countValue
    ).toBe(5);

    // usageLimit refund: deferred resolver の context.recordedUsage 経由で除去される
    const recordsAfterResolve = afterPass.state.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === "burst-src-2" && r.effectLabel === "burst:0"
    );
    expect(recordsAfterResolve).toHaveLength(0);
  });
});
