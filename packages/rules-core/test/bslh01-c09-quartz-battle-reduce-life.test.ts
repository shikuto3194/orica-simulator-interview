/**
 * BSLH01-C09「[創の軌跡]ユウナ・クロフォード」【クォーツ：金牛珠】セット中効果:
 * 「系統：「CB」を持つ自分のスピリットのアタックによって相手のライフを減らしたとき、
 * ターンに1回、ボイドからコア1個を自分のライフに置ける。」
 *
 * ブロッカー (needs-dsl.audit.jsonl BSLH01-C09、解消): battle-actions.ts の
 * executeBattleResolution → finalizeBattleResolutionAfterCombat が
 * collectAndQueueTriggerReactions へ causedByPlayerId のみ thread し、
 * causedBySourceInstanceId (=アタッカーのカード instance) を渡していなかったため、
 * reduce_life イベントの relatedInstanceId が常に null になり、triggerFilter による
 * 系統 (tribes:["CB"]) 絞り込みが機能しなかった。
 *
 * 修正 (ENGINE-battle-reduce-life-source-instance): battleResolutionGroup の
 * participantSnapshots が単一 かつ memberInstanceIds も単一 (合体/同時アタックでない
 * 一意な単独アタッカー) のときだけ、そのカードの instanceId を causedBySourceInstanceId
 * として thread する (複数アタッカーは fail-close で undefined のまま)。
 *
 * 効果本体は既存 precedent (BSFT01-TR11(A)/BSAZ02-C06 型 void→life core_move、
 * BSLH01-M04 龍眼と同型の applicability.soulState + game_event) で組む。
 * player:"opponent" は「ライフが減った側 (relatedPlayerId) が自分の相手」を表す
 * (BSLH01-M04 の leave_field player:"opponent" と同じ意味論)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { setQuartz } from "../src/mechanics/quartz-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { executeBattleResolution } from "../src/battle/battle-actions";
import type {
  ActiveAttack,
  CardDefinition,
  CardInstance,
  GameState,
} from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C09 = cardNoMap.get("BSLH01-C09")!;

const ALICE = "alice";
const BOB = "bob";

const hostDef: CardDefinition = {
  cardNo: "TEST-C09-HOST",
  name: "ENIGMA[戦術オーブメント]テスト",
  printedCategory: "brave",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  quartzHostData: {
    slots: { left: 3, center: 1, right: 3 },
    inheritsSetQuartzEffects: true,
  },
};

function makeAttackerDef(tribe: string | undefined): CardDefinition {
  return {
    cardNo: `TEST-C09-ATK-${tribe ?? "none"}`,
    name: "テストアタッカー",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe,
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function buildScenario(options: { soulSet: boolean; attackerTribe?: string }) {
  const attackerDef = makeAttackerDef(options.attackerTribe);
  const host = createCardInstance(hostDef, {
    instanceId: "c09-host",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const c09 = createCardInstance(C09, {
    instanceId: "c09-quartz",
    ownerPlayerId: ALICE,
    zone: "hand",
  });
  const attacker = createCardInstance(attackerDef, {
    instanceId: "c09-attacker",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, c09, attacker],
    playerOverrides: [{ voidNormalCoreCount: 1 }, {}],
  });
  let state: GameState = {
    ...base,
    players: base.players.map((p) =>
      p.id === ALICE ? { ...p, soulStateInstanceIds: ["c09-host"] } : p
    ),
  };
  const defs = new Map<string, CardDefinition>([
    [hostDef.cardNo, hostDef],
    [C09.cardNo, C09],
    [attackerDef.cardNo, attackerDef],
  ]);
  const getDef = (id: string) => defs.get(id);
  if (options.soulSet) {
    state = setQuartz(
      state,
      {
        quartzInstanceId: "c09-quartz",
        hostInstanceId: "c09-host",
        ownerPlayerId: ALICE,
        slot: "left",
      },
      getDef
    )!;
    expect(state).not.toBeNull();
  }
  const lookup = buildTriggeredEffectLookup([C09, attackerDef]);
  return { state, getDef, lookup, attacker };
}

function midBattleStateFor(state: GameState): GameState {
  const activeAttack: ActiveAttack = {
    attackId: "attack:c09-test:1",
    primaryEntityId: "be-c09-1",
    participantEntityIds: ["be-c09-1"],
    groupMode: "single",
    target: { kind: "player", playerId: BOB },
    blockAssignments: [
      { participantEntityId: "be-c09-1", blockedByEntityIds: [] },
    ],
    symbolResolutionOrder: ["be-c09-1"],
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: false,
    flashWindowState: null,
  };
  return {
    ...state,
    turnNumber: 2,
    activePlayerId: ALICE,
    step: "attack",
    window: "declare_attack",
    activeAttack,
    battleEntities: [
      {
        entityId: "be-c09-1",
        resolvedBp: 3000,
        attackState: "attacking",
        resolvedSymbols: ["yellow"],
        memberInstanceIds: ["c09-attacker"],
      },
    ],
  };
}

describe("BSLH01-C09 【クォーツ：金牛珠】自分の CB スピリットのアタックで相手のライフが減ったとき、ボイド→ライフ", () => {
  it("セット中 + CB系統アタッカーの unblocked attack でボイド→ライフの pending が公開誘発される", () => {
    const { state, getDef, lookup } = buildScenario({
      soulSet: true,
      attackerTribe: "CB",
    });
    const resolved = executeBattleResolution({
      state: midBattleStateFor(state),
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const bob = resolved.state.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBeLessThan(
      state.players.find((p) => p.id === BOB)!.lifeNormalCoreCount
    );

    const pending = resolved.state.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "reduce_life" &&
        Object.keys(p.relatedInstanceIdsBySourceRegistrationKey ?? {}).some(
          (key) => key.startsWith("c09-quartz")
        )
    );
    expect(pending).toBeDefined();
    expect(pending!.relatedInstanceId).toBe("c09-attacker");
  });

  it("実行: pending を解決するとボイド1→ライフ1のコア移動が成立する", () => {
    const { state, getDef, lookup } = buildScenario({
      soulSet: true,
      attackerTribe: "CB",
    });
    const aliceLifeBefore = state.players.find(
      (p) => p.id === ALICE
    )!.lifeNormalCoreCount;
    const resolved = executeBattleResolution({
      state: midBattleStateFor(state),
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    let afterBurstChecks = resolved.state;
    while (afterBurstChecks.pendingBurstChecks.length > 0) {
      const check = afterBurstChecks.pendingBurstChecks[0]!;
      afterBurstChecks = applyLegalAction({
        state: afterBurstChecks,
        action: {
          chainId: "test:bslh01-c09-quartz-battle-reduce-life:218",
          kind: "decline_pending_burst_check",
          actionId: `decline:${check.checkId}`,
          can: true,
          reason: "test",
          actingPlayerId: check.actingPlayerId,
          checkId: check.checkId,
          eventKind: check.eventKind,
          relatedPlayerId: check.relatedPlayerId,
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
      }).state;
    }
    const pending = afterBurstChecks.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "reduce_life" &&
        Object.keys(p.relatedInstanceIdsBySourceRegistrationKey ?? {}).some(
          (key) => key.startsWith("c09-quartz")
        )
    )!;
    expect(pending).toBeDefined();

    const resolveAction = getLegalActions({
      state: afterBurstChecks,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pending.pendingId
    );
    expect(resolveAction).toBeDefined();
    let current = applyLegalAction({
      state: afterBurstChecks,
      action: resolveAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;
    let guard = 0;
    while (current.stackWindow && guard++ < 10) {
      const responderId = current.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state: current,
        actingPlayerId: responderId,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredFieldCardEffectActions: () => undefined,
      }).find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
      }).state;
    }

    const alice = current.players.find((p) => p.id === ALICE)!;
    expect(alice.voidNormalCoreCount).toBe(0);
    expect(alice.lifeNormalCoreCount).toBe(aliceLifeBefore + 1);
  });

  it("未セット（手札のまま=魂状態でない）なら applicability.soulState で不発", () => {
    const { state, getDef, lookup } = buildScenario({
      soulSet: false,
      attackerTribe: "CB",
    });
    const resolved = executeBattleResolution({
      state: midBattleStateFor(state),
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      resolved.state.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "reduce_life" &&
          Object.keys(p.relatedInstanceIdsBySourceRegistrationKey ?? {}).some(
            (key) => key.startsWith("c09-quartz")
          )
      )
    ).toBe(false);
  });

  it("アタッカーが系統「CB」を持たなければ triggerFilter で除外され不発", () => {
    const { state, getDef, lookup } = buildScenario({
      soulSet: true,
      attackerTribe: "非CB",
    });
    const resolved = executeBattleResolution({
      state: midBattleStateFor(state),
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      resolved.state.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "reduce_life" &&
          Object.keys(p.relatedInstanceIdsBySourceRegistrationKey ?? {}).some(
            (key) => key.startsWith("c09-quartz")
          )
      )
    ).toBe(false);
  });

  it("複数アタッカーの同時アタック (groupMode:simultaneous) では単独アタッカーへ一意特定できないため fail-close で不発", () => {
    // ENGINE-battle-reduce-life-source-instance の fail-close 分岐 (singleAttackerInstanceId
    // 算出、battle-actions.ts finalizeBattleResolutionAfterCombat) の回帰。
    // participantSnapshots が2件 (be-c09-1/be-c09-2、共に CB 系統・共にブロックされていない)
    // になるため causedBySourceInstanceId は undefined のまま thread され、
    // relatedInstanceId 不在の reduce_life イベントは triggerFilter:{tribes:["CB"]} を
    // 満たせず C09 の pending は queue されない (安全側 fail-close、誤発火しないことを固定)。
    const { state, getDef } = buildScenario({
      soulSet: true,
      attackerTribe: "CB",
    });
    const secondAttackerDef = makeAttackerDef("CB");
    const secondAttacker: CardInstance = createCardInstance(secondAttackerDef, {
      instanceId: "c09-attacker-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const stateWithSecondAttacker: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, secondAttacker],
    };
    const defsWithSecondAttacker = new Map<string, CardDefinition>([
      [secondAttackerDef.cardNo, secondAttackerDef],
    ]);
    const combinedGetDef = (id: string): CardDefinition | undefined =>
      getDef(id) ?? defsWithSecondAttacker.get(id);
    const lookup = buildTriggeredEffectLookup([
      C09,
      makeAttackerDef("CB"),
      secondAttackerDef,
    ]);

    const activeAttack: ActiveAttack = {
      attackId: "attack:c09-multi:1",
      primaryEntityId: "be-c09-1",
      participantEntityIds: ["be-c09-1", "be-c09-2"],
      groupMode: "simultaneous",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        { participantEntityId: "be-c09-1", blockedByEntityIds: [] },
        { participantEntityId: "be-c09-2", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-c09-1", "be-c09-2"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const multiAttackState: GameState = {
      ...stateWithSecondAttacker,
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-c09-1",
          resolvedBp: 3000,
          attackState: "attacking",
          resolvedSymbols: ["yellow"],
          memberInstanceIds: ["c09-attacker"],
        },
        {
          entityId: "be-c09-2",
          resolvedBp: 3000,
          attackState: "attacking",
          resolvedSymbols: ["yellow"],
          memberInstanceIds: ["c09-attacker-2"],
        },
      ],
    };

    const resolved = executeBattleResolution({
      state: multiAttackState,
      getCardDefinitionById: combinedGetDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const bob = resolved.state.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBeLessThan(
      multiAttackState.players.find((p) => p.id === BOB)!.lifeNormalCoreCount
    );
    expect(
      resolved.state.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "reduce_life" &&
          Object.keys(p.relatedInstanceIdsBySourceRegistrationKey ?? {}).some(
            (key) => key.startsWith("c09-quartz")
          )
      )
    ).toBe(false);
  });
});
