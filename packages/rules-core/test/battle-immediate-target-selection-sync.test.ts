/**
 * battle_immediate 効果 (アタック時等) は flash 窓前でも、発揮宣言で相手のスタック窓を開き
 * (02:200「常時以外の効果発揮」)、相手 pass でクローズしてから対象選択・解決する。
 *
 * 旧挙動 (バグ): flash 窓が無い「アタック時」battle_immediate は同期解決され、相手のスタック
 * タイミングが挟まらなかった (BSTH01-X03 等)。さらに対象未指定だと resolveTargetCards の
 * fallback 自動選択 (候補先頭を機械選択) に落ちる先頭固定破壊バグもあった。
 *
 * 期待挙動 (誘発効果 P3-34 と同じ宣言→窓→クローズ→解決):
 *   1. 発揮宣言で新規 stack window が開き、優先権は相手 (bob)。
 *   2. bob の pass_stack で窓クローズ → pendingEffectTargetSelection が立つ。
 *   3. alice が candidateInstanceIds から選んだ対象のみ破壊される (先頭固定でない)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, Effect, GameState } from "../src";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getLegalActions,
} from "../src/index";
import {
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";

const fieldEffectLookup = (() => undefined) as Parameters<
  typeof getLegalActions
>[0]["getRegisteredFieldCardEffectActions"];

/** アタック時に「BP20000 以下の相手スピリット 1 体を破壊」する攻撃側。 */
function makeAttackerWithDestroyOnAttack(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `BI destroy ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 12000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { zone: "field" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], maxBp: 20000 },
                count: 1,
              },
            },
          },
        ],
      },
    ],
  };
}

function makeVanillaSpirit(cardNo: string, bp: number): CardDefinition {
  return {
    cardNo,
    name: `vanilla ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function makeLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

/** flash 窓が開く前の「アタック時」状態 (activeAttack あり / flashWindowState null)。 */
function setupAttackTimeNoFlash(
  attacker: CardDefinition,
  blockers: CardDefinition[],
  attackerCores = 1
): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(attacker, {
        instanceId: "alice-attacker",
        ownerPlayerId: "alice",
        zone: "field",
        cores: attackerCores,
      }),
      ...blockers.map((def, i) =>
        createCardInstance(def, {
          instanceId: `bob-spirit-${i + 1}`,
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        })
      ),
    ],
    playerOverrides: [{ deckCount: 5 }, { deckCount: 5 }],
    battleEntities: [
      {
        entityId: "battle-entity:alice-attacker",
        memberInstanceIds: ["alice-attacker"],
        resolvedBp: 12000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-group:2:alice:battle-entity:alice-attacker",
      primaryEntityId: "battle-entity:alice-attacker",
      participantEntityIds: ["battle-entity:alice-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:alice-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:alice-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    },
    battleImmediateEffects: [
      {
        promptId: "bi-sync-prompt-1",
        attackId: "attack-group:2:alice:battle-entity:alice-attacker",
        timing: "attack",
        sourceKind: "spirit",
        sourceInstanceId: "alice-attacker",
        sourceDefinitionId: attacker.cardNo,
        sourceCardNo: attacker.cardNo,
        actingPlayerId: "alice",
        participantEntityId: "battle-entity:alice-attacker",
        registrationIndex: 0,
      },
    ],
  });
  return {
    ...base,
    step: "attack",
    window: "declare_attack",
    activePlayerId: "alice",
    turnNumber: 2,
  };
}

/** resolve_battle_immediate_effect を発揮宣言する (対象未指定 = GUI 経路相当)。 */
function declareBattleImmediate(
  state: GameState,
  lookup: (id: string) => CardDefinition | undefined,
  battleImmediateLookup: ReturnType<typeof buildBattleImmediateEffectLookup>
) {
  const declaration = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    getRegisteredFieldCardEffectActions: fieldEffectLookup,
  }).find((a) => a.kind === "resolve_battle_immediate_effect");
  expect(declaration).toBeDefined();
  return applyLegalAction({
    state,
    action: declaration!,
    getCardDefinitionById: lookup,
    getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
  }).state;
}

/** スタック窓の優先権保持者 (相手) が pass_stack でクローズする。 */
function passStack(
  state: GameState,
  lookup: (id: string) => CardDefinition | undefined,
  battleImmediateLookup: ReturnType<typeof buildBattleImmediateEffectLookup>
) {
  expect(state.window).toBe("stack");
  expect(state.stackWindow).not.toBeNull();
  const opponentId = state.stackWindow!.priorityPlayerId;
  return applyLegalAction({
    state,
    action: {
      kind: "pass_stack",
      actionId: `pass:${opponentId}`,
      can: true,
      reason: "test_close",
      actingPlayerId: opponentId,
    },
    getCardDefinitionById: lookup,
    getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
  }).state;
}

describe("battle_immediate アタック時のスタック窓 (flash 窓前)", () => {
  it("発揮宣言で相手のスタック窓が開く (BSTH01-X03 型の同期解決バグ回帰)", () => {
    const attacker = makeAttackerWithDestroyOnAttack("BI-SYNC-ATK");
    const s1 = makeVanillaSpirit("BI-SYNC-S1", 5000);
    const s2 = makeVanillaSpirit("BI-SYNC-S2", 6000);
    const defs = [attacker, s1, s2];
    const lookup = makeLookup(defs);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(defs);

    const baseState = setupAttackTimeNoFlash(attacker, [s1, s2]);
    const declared = declareBattleImmediate(
      baseState,
      lookup,
      battleImmediateLookup
    );

    // 発揮宣言時点では新規 stack window が開き優先権は相手 (bob)。まだ対象選択も破壊もない。
    expect(declared.window).toBe("stack");
    expect(declared.stackWindow).not.toBeNull();
    expect(declared.stackWindow!.priorityPlayerId).toBe("bob");
    expect(declared.pendingEffectTargetSelection).toBeNull();
    expect(
      declared.cardInstances.find((c) => c.instanceId === "bob-spirit-1")?.zone
    ).toBe("field");
    expect(
      declared.cardInstances.find((c) => c.instanceId === "bob-spirit-2")?.zone
    ).toBe("field");

    // bob pass で窓クローズ → ここで初めて対象選択が立つ (先頭固定 auto-pick されない)。
    const passed = passStack(declared, lookup, battleImmediateLookup);
    const pending = passed.pendingEffectTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.requiredTargetCount).toBe(1);
    expect(new Set(pending!.candidateInstanceIds)).toEqual(
      new Set(["bob-spirit-1", "bob-spirit-2"])
    );
  });

  it("窓クローズ後に 2 体目を選んで解決すると、選んだ対象のみが破壊される (先頭固定でない)", () => {
    const attacker = makeAttackerWithDestroyOnAttack("BI-SYNC-ATK2");
    const s1 = makeVanillaSpirit("BI-SYNC2-S1", 5000);
    const s2 = makeVanillaSpirit("BI-SYNC2-S2", 6000);
    const defs = [attacker, s1, s2];
    const lookup = makeLookup(defs);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(defs);

    const baseState = setupAttackTimeNoFlash(attacker, [s1, s2]);
    const declared = declareBattleImmediate(
      baseState,
      lookup,
      battleImmediateLookup
    );
    const passed = passStack(declared, lookup, battleImmediateLookup);

    // 2 体目を対象に選択して解決
    const resolveTarget = getLegalActions({
      state: passed,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toBeDefined();

    const resolved = applyLegalAction({
      state: passed,
      action: resolveTarget!,
      targetInstanceIds: ["bob-spirit-2"],
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    // 選んだ 2 体目だけが破壊され、1 体目はフィールドに残る
    expect(
      resolved.state.cardInstances.find((c) => c.instanceId === "bob-spirit-2")
        ?.zone
    ).toBe("trash");
    expect(
      resolved.state.cardInstances.find((c) => c.instanceId === "bob-spirit-1")
        ?.zone
    ).toBe("field");
    expect(resolved.state.pendingEffectTargetSelection).toBeNull();
  });
});

/**
 * ENGINE-battle-immediate-stale-target-fizzle: pendingEffectTargetSelection の候補が
 * 窓クローズ後・対象選択前に同時解決の他効果でフィールドを離れうる (このテストでは直接
 * state を操作して再現)。apply 側 isTargetStillValid は正しく reject するが、legal action
 * 側が frozen candidateInstanceIds をそのまま曝露すると、無効候補しか選べず
 * 「advanceStep blocked: activeAttack is in progress」で永久 stuck した
 * (selfplay fuzz seed=142 で発見)。
 */
describe("battle_immediate 対象選択: 窓クローズ後に候補がフィールドを離れた場合の stale 化耐性", () => {
  it("候補の一方がフィールドを離れても、生存候補のみが legal action に残り解決できる", () => {
    const attacker = makeAttackerWithDestroyOnAttack("BI-STALE-ATK1");
    const s1 = makeVanillaSpirit("BI-STALE1-S1", 5000);
    const s2 = makeVanillaSpirit("BI-STALE1-S2", 6000);
    const defs = [attacker, s1, s2];
    const lookup = makeLookup(defs);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(defs);

    const baseState = setupAttackTimeNoFlash(attacker, [s1, s2]);
    const declared = declareBattleImmediate(
      baseState,
      lookup,
      battleImmediateLookup
    );
    const passed = passStack(declared, lookup, battleImmediateLookup);
    expect(passed.pendingEffectTargetSelection).not.toBeNull();

    // bob-spirit-1 が同時解決の別効果で既にフィールドを離れたと仮定 (直接 state 操作で再現)。
    const stale: GameState = {
      ...passed,
      cardInstances: passed.cardInstances.map((c) =>
        c.instanceId === "bob-spirit-1" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const resolveTarget = getLegalActions({
      state: stale,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toBeDefined();
    if (resolveTarget!.kind !== "resolve_pending_effect_target") {
      throw new Error("unreachable");
    }
    // stale 化した bob-spirit-1 は候補から除外され、生存中の bob-spirit-2 のみ残る。
    expect(resolveTarget!.candidateTargetInstanceIds).toEqual(["bob-spirit-2"]);
    expect(resolveTarget!.requiredTargetCount).toBe(1);

    const resolved = applyLegalAction({
      state: stale,
      action: resolveTarget!,
      targetInstanceIds: ["bob-spirit-2"],
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    expect(
      resolved.state.cardInstances.find((c) => c.instanceId === "bob-spirit-2")
        ?.zone
    ).toBe("trash");
    expect(resolved.state.pendingEffectTargetSelection).toBeNull();
  });

  it("唯一の候補がフィールドを離れると、legal action は0対象で成立し stuck せず不発解決できる", () => {
    const attacker = makeAttackerWithDestroyOnAttack("BI-STALE-ATK2");
    const s1 = makeVanillaSpirit("BI-STALE2-S1", 5000);
    const defs = [attacker, s1];
    const lookup = makeLookup(defs);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(defs);

    const baseState = setupAttackTimeNoFlash(attacker, [s1]);
    const declared = declareBattleImmediate(
      baseState,
      lookup,
      battleImmediateLookup
    );
    const passed = passStack(declared, lookup, battleImmediateLookup);
    expect(passed.pendingEffectTargetSelection?.candidateInstanceIds).toEqual([
      "bob-spirit-1",
    ]);

    // 唯一の候補 bob-spirit-1 が同時解決の別効果でフィールドを離れたと仮定。
    const stale: GameState = {
      ...passed,
      cardInstances: passed.cardInstances.map((c) =>
        c.instanceId === "bob-spirit-1" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const resolveTarget = getLegalActions({
      state: stale,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toBeDefined();
    if (resolveTarget!.kind !== "resolve_pending_effect_target") {
      throw new Error("unreachable");
    }
    expect(resolveTarget!.candidateTargetInstanceIds).toEqual([]);
    expect(resolveTarget!.requiredTargetCount).toBe(0);

    // 0対象での解決が例外なく成立し、pending が正しくクリアされる (stuck しない)。
    const resolved = applyLegalAction({
      state: stale,
      action: resolveTarget!,
      targetInstanceIds: [],
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    expect(resolved.state.pendingEffectTargetSelection).toBeNull();
  });
});

/**
 * EDH-0036-00-hard-failure: battle_immediate の対象が対象開示への応答で
 * current_effect immunity を得た後も、deferred stack は宣言済み TargetRef を維持して
 * 本体の affect gate へ渡す必要がある。対象はその効果から不発になり、残る対象だけを
 * 解決して activeAttack を継続しなければならない。
 */
describe("battle_immediate 対象開示後の免疫再検証", () => {
  it("BSGE01-C13 がカウント支払いを拒否すると、その対象だけ不発にして attack を継続する", () => {
    const suika = ALL_CARDS.find((card) => card.cardNo === "BSTH02.5-X01");
    const fenrir = ALL_CARDS.find((card) => card.cardNo === "BSGE01-C13");
    expect(suika).toBeDefined();
    expect(fenrir).toBeDefined();
    if (!suika || !fenrir) throw new Error("required regression cards missing");

    const s1 = makeVanillaSpirit("BI-DISCLOSURE-S1", 5000);
    const s2 = makeVanillaSpirit("BI-DISCLOSURE-S2", 6000);
    const defs = [suika, fenrir, s1, s2];
    const lookup = makeLookup(defs);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(defs);
    const triggeredLookup = buildTriggeredEffectLookup(defs);
    const noLookup = () => [];

    // 萃香は Lv2 (core 3) で3対象を選び、フェンリル極東支部を含める。
    const base = setupAttackTimeNoFlash(suika, [s1, fenrir, s2], 3);
    const declared = declareBattleImmediate(
      base,
      lookup,
      battleImmediateLookup
    );
    const targetSelection = passStack(declared, lookup, battleImmediateLookup);
    const selectTargets = getLegalActions({
      state: targetSelection,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(selectTargets).toBeDefined();

    const disclosure = applyLegalAction({
      state: targetSelection,
      action: selectTargets!,
      targetInstanceIds: ["bob-spirit-1", "bob-spirit-2", "bob-spirit-3"],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredBurstActions: noLookup,
    }).state;
    expect(disclosure.pendingTargetedDisclosureContinuation).not.toBeNull();

    const declareProtection = getLegalActions({
      state: disclosure,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "bob-spirit-2"
    );
    expect(declareProtection).toBeDefined();
    const protectionStack = applyLegalAction({
      state: disclosure,
      action: declareProtection!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredBurstActions: noLookup,
    }).state;

    const closeProtectionStack = getLegalActions({
      state: protectionStack,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find((action) => action.kind === "pass_stack");
    expect(closeProtectionStack).toBeDefined();
    const optionalPayment = applyLegalAction({
      state: protectionStack,
      action: closeProtectionStack!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredBurstActions: noLookup,
    }).state;
    expect(optionalPayment.pendingStepOptionalChoice).toMatchObject({
      choosingPlayerId: "alice",
      sourceInstanceId: "bob-spirit-2",
      canDecline: true,
    });

    // 開示応答が target lock も登録した状態を再現する。これは対象取得の制限であり、
    // 既に宣言済みの bob-spirit-1 を解決時に失わせてはいけない (03b:112-115)。
    const optionalPaymentWithTargetLock: GameState = {
      ...optionalPayment,
      activeContinuousEffects: [
        ...optionalPayment.activeContinuousEffects,
        {
          effectId: "test-target-lock-after-disclosure",
          sourceInstanceId: "bob-spirit-2",
          sourceDefinitionId: fenrir.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "current_effect" },
          createdAtTurn: optionalPayment.turnNumber,
          createdAtAttackId: optionalPayment.activeAttack?.attackId ?? null,
          modifierTag: "cannot_be_targeted",
          targetInstanceId: "bob-spirit-1",
        },
      ],
    };

    const declinePayment = getLegalActions({
      state: optionalPaymentWithTargetLock,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(declinePayment).toBeDefined();

    // c11bea52 の旧修正はここで C13 を stale target として除外していた。耐性は
    // target 消失ではないため、選択済み target として affect gate へ渡す。
    const afterDecline = applyLegalAction({
      state: optionalPaymentWithTargetLock,
      action: declinePayment!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredBurstActions: noLookup,
    }).state;

    expect(afterDecline.pendingStepOptionalChoice).toBeNull();
    expect(afterDecline.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      afterDecline.cardInstances.find(
        (card) => card.instanceId === "bob-spirit-1"
      )?.zone
    ).toBe("trash");
    expect(
      afterDecline.cardInstances.find(
        (card) => card.instanceId === "bob-spirit-2"
      )?.zone
    ).toBe("field");
    expect(
      afterDecline.cardInstances.find(
        (card) => card.instanceId === "bob-spirit-3"
      )?.zone
    ).toBe("trash");
    expect(afterDecline.activeAttack).not.toBeNull();
    expect(
      afterDecline.log.some((entry) =>
        entry.endsWith(":bob-spirit-1,bob-spirit-2,bob-spirit-3")
      )
    ).toBe(true);
    expect(
      afterDecline.log.some((entry) =>
        entry.startsWith("battle:immediate:targets-fizzled:")
      )
    ).toBe(false);
  });
});

describe("対象開示後 TargetRef の executor 共通再開", () => {
  it("send_to_deck も開示後の target lock を再取得せず、選択済み対象を affect gate へ渡す", () => {
    const sourceDef = makeVanillaSpirit("TARGET-REF-SEND-SOURCE", 5000);
    const targetDef = makeVanillaSpirit("TARGET-REF-SEND-TARGET", 5000);
    const lookup = makeLookup([sourceDef, targetDef]);
    const source = createCardInstance(sourceDef, {
      instanceId: "target-ref-send-source",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "target-ref-send-target",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target],
        playerOverrides: [{ deckCount: 5 }, { deckCount: 5 }],
      }),
      activeContinuousEffects: [
        {
          effectId: "target-ref-send-target-lock",
          sourceInstanceId: target.instanceId,
          sourceDefinitionId: targetDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "current_effect" },
          createdAtTurn: 1,
          modifierTag: "cannot_be_targeted",
          targetInstanceId: target.instanceId,
        },
      ],
    };
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "send_to_deck",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            position: "bottom",
          },
        },
      ],
    };

    const afterEffect = executeEffect({
      chainId: "test:battle-immediate-target-selection-sync:643",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [target.instanceId],
      targetSelectionResolved: true,
      preservePreSelectedTargetRefs: true,
    });

    // send_to_deck は leave を予約して解決する。開示済み TargetRef が executor
    // で再取得されていないことを予約時点で確認し、SBA flush 後の行き先を検証する。
    expect(
      afterEffect.pendingLeaveEntities.some(
        (leave) => leave.instanceId === target.instanceId
      )
    ).toBe(true);
    const after = flushPendingLeaves(afterEffect, lookup);

    expect(
      after.cardInstances.find((card) => card.instanceId === target.instanceId)
        ?.zone
    ).toBe("deck");
  });
});
