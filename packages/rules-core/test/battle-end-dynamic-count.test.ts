/**
 * P3-14 C-5: battle_end の動的カウント（「このバトルで破壊した相手のスピリット/
 * アルティメット1体につき」BSTH01-R02）と アタック側/ブロック側絞り込み (Timing.action)。
 *
 * - BP 比べで相手スピリットを破壊 → battle_end pending の amount に破壊数が載る
 * - DynamicCount.event_amount が pending.amount → stepCtx.eventAmount 経由で解決される
 * - アンブロック (破壊 0) → amount 0 で効果は no-op
 * - ブロック側参加カードの `action: "attack"` 効果は発火しない
 */
import { describe, expect, it } from "vitest";
import type {
  ActiveAttack,
  BattleEntity,
  CardDefinition,
  GameState,
} from "../src/index";
import {
  applyLegalAction,
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  getLegalActions,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

/** BSTH01-R02 型: バトル終了時(アタック側)、破壊数ぶん相手のライフをリザーブへ。 */
function makeReaperSpirit(
  cardNo: string,
  bp: number,
  action: "attack" | "block" = "attack"
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 6,
    reductionSymbols: ["yellow"],
    levelDefs: [{ level: 1, requiredCores: 1, bp }],
    symbolColors: ["yellow"],
    textLines: [
      "バトル終了時、このバトルで破壊した相手のスピリット/アルティメット1体につき、相手のライフのコア1個を相手のリザーブに置く。",
    ],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "battle_end", action },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: { source: { kind: "event_amount" } },
            },
          },
        ],
        textRef: [0],
      },
    ],
  } as CardDefinition;
}

function makeVanillaSpirit(cardNo: string, bp: number): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function buildBattleState(options: {
  attackerDef: CardDefinition;
  blockerDef?: CardDefinition;
}): GameState {
  const attacker = createCardInstance(options.attackerDef, {
    instanceId: "attacker-1",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  const blocker = options.blockerDef
    ? createCardInstance(options.blockerDef, {
        instanceId: "blocker-1",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      })
    : null;

  const battleEntities: BattleEntity[] = [
    {
      entityId: "be-atk",
      resolvedBp: options.attackerDef.levelDefs[0]!.bp,
      attackState: "attacking",
      resolvedSymbols: ["yellow"],
      memberInstanceIds: ["attacker-1"],
    },
    ...(blocker
      ? [
          {
            entityId: "be-blk",
            resolvedBp: options.blockerDef!.levelDefs[0]!.bp,
            attackState: "blocking" as const,
            resolvedSymbols: ["red" as const],
            memberInstanceIds: ["blocker-1"],
          },
        ]
      : []),
  ];

  const activeAttack: ActiveAttack = {
    attackId: "attack:be-atk:1",
    primaryEntityId: "be-atk",
    participantEntityIds: ["be-atk"],
    groupMode: "single",
    target: { kind: "player", playerId: "bob" },
    blockAssignments: [
      {
        participantEntityId: "be-atk",
        blockedByEntityIds: blocker ? ["be-blk"] : [],
      },
    ],
    symbolResolutionOrder: ["be-atk"],
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: true,
    flashWindowState: null,
  };

  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: blocker ? [attacker, blocker] : [attacker],
    }),
    turnNumber: 2,
    activePlayerId: "alice",
    step: "attack",
    window: "declare_attack",
    activeAttack,
    battleEntities,
  };
}

function resolveSingleBattleEndPending(
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  lookup: ReturnType<typeof buildTriggeredEffectLookup>
): GameState {
  let current = state;
  while (current.pendingBurstChecks.length > 0) {
    const burstCheck = current.pendingBurstChecks[0]!;
    current = applyLegalAction({
      state: current,
      action: {
        chainId: "test:battle-end-dynamic-count:167",
        kind: "decline_pending_burst_check",
        actionId: `decline:${burstCheck.checkId}`,
        can: true,
        reason: "test",
        actingPlayerId: burstCheck.actingPlayerId,
        checkId: burstCheck.checkId,
        eventKind: burstCheck.eventKind,
        relatedPlayerId: burstCheck.relatedPlayerId,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;
  }
  const pending = current.pendingTriggeredEffects.find(
    (effect) => effect.eventKind === "battle_end"
  );
  if (!pending) throw new Error("missing battle_end pending");
  const legalActions = getLegalActions({
    state: current,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: lookup,
  });
  const resolveAction = legalActions.find(
    (a) => a.kind === "resolve_pending_triggered_effect"
  );
  expect(resolveAction).toBeDefined();
  current = applyLegalAction({
    state: current,
    action: resolveAction!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: lookup,
  }).state;
  // 発揮宣言はスタック窓を開く → 相手 pass でクローズして解決まで進める
  if (current.window === "stack" && current.stackWindow) {
    const opponentId = current.stackWindow.priorityPlayerId;
    current = applyLegalAction({
      state: current,
      action: {
        kind: "pass_stack",
        actionId: `pass:${opponentId}`,
        can: true,
        reason: "test_close",
        actingPlayerId: opponentId,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;
  }
  return current;
}

describe("P3-14 C-5: battle_end 動的カウント (event_amount)", () => {
  it("BP比べで相手スピリット破壊 → pending amount=1 / actionKind=attack、解決でライフ1個リザーブへ", () => {
    const attackerDef = makeReaperSpirit("C5-REAPER-01", 5000);
    const blockerDef = makeVanillaSpirit("C5-VANILLA-01", 2000);
    const lookup = buildTriggeredEffectLookup([attackerDef, blockerDef]);
    const defs = new Map([
      [attackerDef.cardNo, attackerDef],
      [blockerDef.cardNo, blockerDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);

    const resolved = executeBattleResolution({
      state: buildBattleState({ attackerDef, blockerDef }),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    // ブロッカーは BP 比べで破壊されている
    const blockerCard = resolved.state.cardInstances.find(
      (c) => c.instanceId === "blocker-1"
    );
    expect(blockerCard?.zone).not.toBe("field");

    const pendings = resolved.state.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "battle_end"
    );
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.amount).toBe(1);
    expect(pendings[0]!.event?.actionKind).toBe("attack");

    const lifeBefore = resolved.state.players.find(
      (p) => p.id === "bob"
    )!.lifeNormalCoreCount;
    const reserveBefore = resolved.state.players.find(
      (p) => p.id === "bob"
    )!.reserveNormalCoreCount;

    const after = resolveSingleBattleEndPending(
      resolved.state,
      "alice",
      getCardDefinitionById,
      lookup
    );
    const bobAfter = after.players.find((p) => p.id === "bob")!;
    expect(bobAfter.lifeNormalCoreCount).toBe(lifeBefore - 1);
    expect(bobAfter.reserveNormalCoreCount).toBe(reserveBefore + 1);
  });

  it("アンブロック (破壊0) → pending amount=0、解決してもライフ移動なし", () => {
    const attackerDef = makeReaperSpirit("C5-REAPER-02", 5000);
    const lookup = buildTriggeredEffectLookup([attackerDef]);
    const getCardDefinitionById = (id: string) =>
      id === attackerDef.cardNo ? attackerDef : undefined;

    const resolved = executeBattleResolution({
      state: buildBattleState({ attackerDef }),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const pendings = resolved.state.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "battle_end"
    );
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.amount).toBe(0);
    expect(
      collectGameStateInvariantIssues(resolved.state).filter(
        (issue) => issue.code === "invalid_pending_triggered_effect_amount"
      )
    ).toHaveLength(0);

    const lifeBefore = resolved.state.players.find(
      (p) => p.id === "bob"
    )!.lifeNormalCoreCount;

    const after = resolveSingleBattleEndPending(
      resolved.state,
      "alice",
      getCardDefinitionById,
      lookup
    );
    expect(after.players.find((p) => p.id === "bob")!.lifeNormalCoreCount).toBe(
      lifeBefore
    );
  });

  it("ブロック側参加カードの action:attack 効果は発火しない (actionKind=block 不一致)", () => {
    // 攻撃側 (alice) BP2000 が ブロック側 (bob) BP5000 に討ち取られる。
    // bob 側ブロッカーが action:"attack" の battle_end 効果を持つが、
    // ブロック側イベント (actionKind=block) には matcher が一致せず pending は積まれない。
    const attackerDef = makeVanillaSpirit("C5-VANILLA-02", 2000);
    const blockerDef = makeReaperSpirit("C5-REAPER-03", 5000);
    const lookup = buildTriggeredEffectLookup([attackerDef, blockerDef]);
    const defs = new Map([
      [attackerDef.cardNo, attackerDef],
      [blockerDef.cardNo, blockerDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);

    const resolved = executeBattleResolution({
      state: buildBattleState({ attackerDef, blockerDef }),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    // 破壊記録は bob 起因で残る (攻撃側 alice のスピリットが破壊された)
    expect(
      resolved.state.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "battle_end"
      )
    ).toHaveLength(0);
  });

  it("攻撃側が破壊され activeAttack が pruning されても block 側 battle_end の amount=1 を保持する", () => {
    const attackerDef = makeVanillaSpirit("C5-VANILLA-03", 2000);
    const blockerDef = makeReaperSpirit("C5-REAPER-04", 5000, "block");
    const lookup = buildTriggeredEffectLookup([attackerDef, blockerDef]);
    const defs = new Map([
      [attackerDef.cardNo, attackerDef],
      [blockerDef.cardNo, blockerDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);

    const resolved = executeBattleResolution({
      state: buildBattleState({ attackerDef, blockerDef }),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const attackerCard = resolved.state.cardInstances.find(
      (c) => c.instanceId === "attacker-1"
    );
    expect(attackerCard?.zone).not.toBe("field");
    const pendings = resolved.state.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "battle_end"
    );
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.amount).toBe(1);
    expect(pendings[0]!.event?.actionKind).toBe("block");

    const lifeBefore = resolved.state.players.find(
      (p) => p.id === "alice"
    )!.lifeNormalCoreCount;
    const reserveBefore = resolved.state.players.find(
      (p) => p.id === "alice"
    )!.reserveNormalCoreCount;

    const after = resolveSingleBattleEndPending(
      resolved.state,
      "bob",
      getCardDefinitionById,
      lookup
    );
    const aliceAfter = after.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.lifeNormalCoreCount).toBe(lifeBefore - 1);
    expect(aliceAfter.reserveNormalCoreCount).toBe(reserveBefore + 1);
  });
});
