/**
 * P3-170 V11: 権利(追加アタック権 I11 / コネクトバトル権 I12)を共通の使用会計で管理する。
 *
 * 「権利を2回付与 → 1回行使 → pending 保存/再開」で、
 *  - 付与の合算/置換は現行どおり(追加アタック=加算、コネクトバトル=置換)
 *  - 再開(同じ効果発揮の再実行・保存復元)で二重付与/二重消費しない
 *  - 残量は台帳(effectAccounting.grants + 行使bucket)だけが持つ単一正源で、
 *    activeAttack / pending / 合法手は grantId の参照と派生値しか持たない
 * を、実カード BSTH01-X05(追加アタック)と BSTH06-X03(コネクトバトル、maxUses:2)で確認する。
 *
 * 追加アタック権を「疲労していない付与元の通常アタック」でも消費する疑い
 * (battle-actions.ts consumesAdditionalAttackGrant)は裁定が無いため現行挙動のまま。
 * その現行挙動は additional-attack-grant.test.ts の「BSFT01-X01 型」が固定している。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  confirmAttackDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  executeEffect,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  useAttackAsAction,
  usePassPreDeclarationStackAsAction,
} from "../src/runtime";
import { getAttackDeclarationBlockReason } from "../src/battle/battle-availability";
import { pruneEffectAccounting } from "../src/effect/effect-usage-accounting";
import { applyConnectBattleDecisionAction } from "../src/legal/pending-action-handlers";
import { createGameSnapshot, restoreSnapshot } from "../src/snapshot";
import type {
  ActiveAttack,
  CardDefinition,
  Effect,
  GameState,
  ResolveConnectBattleDecisionLegalAction,
} from "../src/runtime";
import {
  additionalAttackGrantCount,
  connectBattleGrantId,
  connectBattleRemainingUses,
} from "./helpers/battle-grant-fixture";
import { withNextTurnClock } from "./helpers/dedicated-usage-fixture";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";

function effectOf(card: CardDefinition, actionKind: string): Effect {
  const effect = card.effects?.find(
    (e) =>
      e.timing.kind === "card_event" &&
      e.timing.event === "attack" &&
      e.steps.some((step) => step.action.kind === actionKind)
  );
  if (!effect) throw new Error(`${card.cardNo}: ${actionKind} 効果が無い`);
  return effect;
}

/** 付与元の効果を実カードの定義のまま、指定の chainId (= 効果発揮の識別) で実行する。 */
function runCardEffect(
  state: GameState,
  card: CardDefinition,
  actionKind: string,
  sourceInstanceId: string,
  chainId: string
): GameState {
  return executeEffect({
    chainId,
    state,
    effect: { ...effectOf(card, actionKind), executionMode: "mandatory" },
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById,
  });
}

/** 保存→復元(JSON往復 + スナップショット復元)。 */
function saveAndRestore(state: GameState): GameState {
  const saved = JSON.parse(JSON.stringify(state)) as GameState;
  return restoreSnapshot(createGameSnapshot(saved), getCardDefinitionById)
    .state;
}

// ================================================================
// I11 追加アタック権 (BSTH01-X05)
// ================================================================

describe("V11 / I11 追加アタック権 (BSTH01-X05)", () => {
  const sakuya = cardNoMap.get("BSTH01-X05")!;

  function midAttackState(): GameState {
    const attacker = createCardInstance(sakuya, {
      instanceId: "sakuya-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 3,
      exhaustState: "exhausted",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:rights:1",
      primaryEntityId: "be-sakuya",
      participantEntityIds: ["be-sakuya"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        { participantEntityId: "be-sakuya", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-sakuya"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    // 継続効果の構築はバトル開始前に行う(進行中のバトルでは再構築できない)。
    const field = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [attacker],
        }),
        turnNumber: 2,
        activePlayerId: ALICE,
        step: "attack",
        window: "none",
      },
      getCardDefinitionById
    );
    return {
      ...field,
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-sakuya",
          resolvedBp: 7000,
          attackState: "attacking",
          resolvedSymbols: ["white"],
          memberInstanceIds: ["sakuya-1"],
        },
      ],
    };
  }

  /** 現在のバトルが終わった後(アタックステップ、窓なし)の状態。 */
  function afterBattle(state: GameState): GameState {
    return { ...state, activeAttack: null, window: "none", battleEntities: [] };
  }

  function declareAndConfirm(state: GameState): GameState {
    const tentative = useAttackAsAction({
      state,
      actingPlayerId: ALICE,
      sourceInstanceId: "sakuya-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: BOB,
    });
    return confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById }
    ).state;
  }

  function blockReason(state: GameState) {
    return getAttackDeclarationBlockReason({
      state,
      actingPlayerId: ALICE,
      sourceInstanceId: "sakuya-1",
      getCardDefinitionById,
    });
  }

  it("別々の効果発揮で2回付与すると加算(2個)になり、同じ発揮の再実行(pending再開)では増えない", () => {
    const s0 = midAttackState();
    expect(additionalAttackGrantCount(s0, "sakuya-1")).toBe(0);

    const s1 = runCardEffect(
      s0,
      sakuya,
      "additional_attack",
      "sakuya-1",
      "chain-A"
    );
    expect(additionalAttackGrantCount(s1, "sakuya-1")).toBe(1);

    const s2 = runCardEffect(
      s1,
      sakuya,
      "additional_attack",
      "sakuya-1",
      "chain-B"
    );
    expect(additionalAttackGrantCount(s2, "sakuya-1")).toBe(2);

    // 同じ効果発揮(chain-B)の再実行 = 保留からの再開。二重に付与しない。
    const replay = runCardEffect(
      s2,
      sakuya,
      "additional_attack",
      "sakuya-1",
      "chain-B"
    );
    expect(additionalAttackGrantCount(replay, "sakuya-1")).toBe(2);
    expect(
      replay.effectAccounting.grants.filter(
        (g) => g.grantKind === "additional_attack"
      )
    ).toHaveLength(2);
  });

  it("残量は台帳の単一正源: GameState に専用の権利配列は無く、保存→復元しても個数が変わらない", () => {
    let state = midAttackState();
    state = runCardEffect(
      state,
      sakuya,
      "additional_attack",
      "sakuya-1",
      "chain-A"
    );
    state = runCardEffect(
      state,
      sakuya,
      "additional_attack",
      "sakuya-1",
      "chain-B"
    );

    expect(state).not.toHaveProperty("pendingAdditionalAttackGrants");
    const restored = saveAndRestore(state);
    expect(additionalAttackGrantCount(restored, "sakuya-1")).toBe(2);
    // 復元を重ねても個数は不変(二重付与なし)。
    expect(
      additionalAttackGrantCount(saveAndRestore(restored), "sakuya-1")
    ).toBe(2);
  });

  it("1回行使(宣言確定)で残り1、保存/復元後も残り1。使い切ると疲労バイパスは終わる", () => {
    let state = midAttackState();
    state = runCardEffect(
      state,
      sakuya,
      "additional_attack",
      "sakuya-1",
      "chain-A"
    );
    state = runCardEffect(
      state,
      sakuya,
      "additional_attack",
      "sakuya-1",
      "chain-B"
    );

    // 疲労した付与元でも、権利がある間はアタック宣言できる。
    const idle = afterBattle(state);
    expect(blockReason(idle)).toBeNull();

    const first = declareAndConfirm(idle);
    expect(first.activeAttack).not.toBeNull();
    expect(additionalAttackGrantCount(first, "sakuya-1")).toBe(1);
    // 疲労状態は維持される(疲労コストは払わない)。
    expect(
      first.cardInstances.find((c) => c.instanceId === "sakuya-1")?.exhaustState
    ).toBe("exhausted");

    // pending 保存→復元: 行使は一度だけ数えられ、復元で戻らず・二重にもならない。
    const restored = saveAndRestore(first);
    expect(additionalAttackGrantCount(restored, "sakuya-1")).toBe(1);

    const idleAgain = afterBattle(restored);
    expect(blockReason(idleAgain)).toBeNull();
    const second = declareAndConfirm(idleAgain);
    expect(additionalAttackGrantCount(second, "sakuya-1")).toBe(0);

    // 使い切った後は疲労バイパスできない。
    expect(blockReason(afterBattle(second))).toBe("source_not_ready");
  });

  it("権利はターン限り: 次のターンへ進むと失効して台帳からも整理される", () => {
    let state = midAttackState();
    state = runCardEffect(
      state,
      sakuya,
      "additional_attack",
      "sakuya-1",
      "chain-A"
    );
    expect(additionalAttackGrantCount(state, "sakuya-1")).toBe(1);

    const next = withNextTurnClock(state);
    expect(additionalAttackGrantCount(next, "sakuya-1")).toBe(0);
    const pruned = pruneEffectAccounting(next);
    expect(
      pruned.effectAccounting.grants.filter(
        (g) => g.grantKind === "additional_attack"
      )
    ).toHaveLength(0);
  });

  it("別ターン(追加ターン等)の時計では見えず、元のターンの時計へ戻ると再び行使できる", () => {
    let state = midAttackState();
    state = runCardEffect(
      state,
      sakuya,
      "additional_attack",
      "sakuya-1",
      "chain-A"
    );
    const elsewhere: GameState = {
      ...state,
      turnNumber: 3,
      stepOrdinalThisTurn: 0,
    };
    expect(additionalAttackGrantCount(elsewhere, "sakuya-1")).toBe(0);
    const back: GameState = {
      ...elsewhere,
      turnNumber: state.turnNumber,
      stepOrdinalThisTurn: state.stepOrdinalThisTurn,
    };
    expect(additionalAttackGrantCount(back, "sakuya-1")).toBe(1);
  });
});

// ================================================================
// I12 コネクトバトル権 (BSTH06-X03, maxUses:2)
// ================================================================

describe("V11 / I12 コネクトバトル権 (BSTH06-X03)", () => {
  const yuugi = cardNoMap.get("BSTH06-X03")!;

  function midBattleState(): GameState {
    const attacker = createCardInstance(yuugi, {
      instanceId: "yuugi-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:rights:cb",
      primaryEntityId: "be-yuugi",
      participantEntityIds: ["be-yuugi"],
      groupMode: "single",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        { participantEntityId: "be-yuugi", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
      attackAfterBurstChecked: true,
      ownAttackBurstChecked: true,
    };
    return {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [attacker],
      }),
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      preGame: null,
      activeAttack,
      battleEntities: [
        {
          entityId: "be-yuugi",
          resolvedBp: 4000,
          attackState: "attacking",
          resolvedSymbols: ["red"],
          memberInstanceIds: ["yuugi-1"],
        },
      ],
    };
  }

  function grant(state: GameState, chainId: string): GameState {
    return runCardEffect(state, yuugi, "connect_battle", "yuugi-1", chainId);
  }

  function resolve(state: GameState) {
    return executeBattleResolution({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
  }

  function continueAction(
    state: GameState
  ): ResolveConnectBattleDecisionLegalAction {
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (a): a is ResolveConnectBattleDecisionLegalAction =>
        a.kind === "resolve_connect_battle_decision" && a.choice === "continue"
    );
    if (!action) throw new Error("continue の合法手が無い");
    return action;
  }

  function applyContinue(state: GameState): GameState {
    return applyConnectBattleDecisionAction({
      state,
      action: continueAction(state),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    }).state;
  }

  it("付与すると activeAttack は grantId の参照だけを持ち、残量(maxUses:2)は台帳から導出される", () => {
    const granted = grant(midBattleState(), "chain-X");
    const grantId = connectBattleGrantId(granted);
    expect(grantId).toBeDefined();
    expect(connectBattleRemainingUses(granted)).toBe(2);
    // 残量を activeAttack に複写しない。
    expect(JSON.stringify(granted.activeAttack)).not.toContain("remainingUses");
    expect(granted.activeAttack).not.toHaveProperty("connectBattleGrant");
    expect(
      granted.effectAccounting.grants.filter(
        (g) => g.grantKind === "connect_battle"
      )
    ).toHaveLength(1);
  });

  it("別の効果発揮による再付与は置換(合算ではない)。旧付与は破棄され継続回数は新しい maxUses になる", () => {
    const first = grant(midBattleState(), "chain-X");
    const resolved = resolve(first);
    const afterContinue = applyContinue(resolved.state);
    expect(connectBattleRemainingUses(afterContinue)).toBe(1);

    const replaced = grant(afterContinue, "chain-Y");
    expect(connectBattleGrantId(replaced)).not.toBe(
      connectBattleGrantId(afterContinue)
    );
    // 1(残り)+2 の合算(3)でも、旧付与の継続でもなく、新しい付与の maxUses=2。
    expect(connectBattleRemainingUses(replaced)).toBe(2);
    expect(
      replaced.effectAccounting.grants.filter(
        (g) => g.grantKind === "connect_battle"
      )
    ).toHaveLength(1);
  });

  it("同じ効果発揮の再実行(pending再開)は二重に付与せず、行使済みの残量を巻き戻さない", () => {
    const first = grant(midBattleState(), "chain-X");
    const afterContinue = applyContinue(resolve(first).state);
    expect(connectBattleRemainingUses(afterContinue)).toBe(1);

    const replay = grant(afterContinue, "chain-X");
    expect(connectBattleGrantId(replay)).toBe(
      connectBattleGrantId(afterContinue)
    );
    expect(connectBattleRemainingUses(replay)).toBe(1);
    expect(
      replay.effectAccounting.grants.filter(
        (g) => g.grantKind === "connect_battle"
      )
    ).toHaveLength(1);
  });

  it("2回付与→1回行使→pending保存/復元: 残量は台帳の単一正源で、復元後の継続も1回分だけ消費する", () => {
    // 付与(2回目は同じ発揮の再実行)→バトル解決で続行/終了の決定待ちが開く。
    let state = grant(midBattleState(), "chain-X");
    state = grant(state, "chain-X");
    expect(connectBattleRemainingUses(state)).toBe(2);
    const open = resolve(state).state;
    const pending = open.pendingConnectBattleDecision!;
    expect(pending.grantId).toBe(connectBattleGrantId(open));
    expect(pending).not.toHaveProperty("remainingUses");
    expect(connectBattleRemainingUses(open)).toBe(2);

    // pending を保存→復元しても残量・合法手の識別は同じ(残量に依存しない識別)。
    const restoredOpen = saveAndRestore(open);
    expect(restoredOpen.pendingConnectBattleDecision?.pendingId).toBe(
      pending.pendingId
    );
    expect(connectBattleRemainingUses(restoredOpen)).toBe(2);
    const action = continueAction(restoredOpen);
    expect(action.actionId).toBe(`cbd-${pending.pendingId}:continue`);
    expect(action.remainingUses).toBe(2);

    // 1回行使(継続)。保存/復元をはさんでも1回分だけ減る。
    const continued = applyContinue(restoredOpen);
    expect(connectBattleRemainingUses(continued)).toBe(1);
    const restoredContinued = saveAndRestore(continued);
    expect(connectBattleRemainingUses(restoredContinued)).toBe(1);

    // 2戦目の決定待ち: 識別は残量ではなく「何回目の決定か」で変わる。
    const secondOpen = resolve(restoredContinued).state;
    const secondPending = secondOpen.pendingConnectBattleDecision!;
    expect(secondPending.grantId).toBe(pending.grantId);
    expect(secondPending.pendingId).not.toBe(pending.pendingId);
    expect(connectBattleRemainingUses(secondOpen)).toBe(1);
    expect(continueAction(secondOpen).remainingUses).toBe(1);

    // 同じ決定の再送(すでに解決済みのpendingIdを指す古い合法手)は適用できず、残量は減らない。
    expect(() =>
      applyConnectBattleDecisionAction({
        state: secondOpen,
        action,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
      })
    ).toThrow(/pendingId mismatch/);
    expect(connectBattleRemainingUses(secondOpen)).toBe(1);

    // 使い切ると(maxUses:2 = 継続2回)3戦目で決定待ちは開かない。
    const third = resolve(applyContinue(secondOpen)).state;
    expect(connectBattleRemainingUses(applyContinue(secondOpen))).toBe(0);
    expect(third.pendingConnectBattleDecision).toBeNull();
  });

  it("アタックが終わると権利は無効になる(台帳の失効期間=バトル)", () => {
    const granted = grant(midBattleState(), "chain-X");
    const ended: GameState = { ...granted, activeAttack: null };
    expect(connectBattleRemainingUses(ended)).toBeUndefined();
    // 別のアタックが始まっても、旧アタックの権利は引き継がれない。
    const nextAttack: GameState = {
      ...granted,
      activeAttack: {
        ...granted.activeAttack!,
        attackId: "attack:rights:next",
      },
    };
    expect(connectBattleRemainingUses(nextAttack)).toBeUndefined();
  });
});
