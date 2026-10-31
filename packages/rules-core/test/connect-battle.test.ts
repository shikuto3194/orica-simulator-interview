/**
 * connect_battle primitive (ENGINE-battle-connect-repeat, 10_rules/05c_connect-battle.md)。
 *
 * BSTH06-X03【三歩必殺】「ターンに1回、このスピリットは、3回まで連続でバトルできる
 * （バトル終了前に2回までブロック前のフラッシュタイミングから、続けてバトルを行える）」型。
 *
 * 裁定 (BS57-X01【皇帝連激】の公式Q&Aからの類推、信頼度C・ユーザー確認済み):
 * - Q9094: バトルは通常通り解決 (BP比較・ライフダメージ) されるが、battle_end トリガー発火の
 *   前にブロック前フラッシュタイミングへ戻り次のバトルを開始する。
 * - Q9095: 1回のバトルが終わるたびに続行/終了を選ぶ (強制連結ではない)。
 * - Q9096: 2回目以降はアタック宣言を行わない (card_event:"attack" 再発火なし)。
 * - Q9103: 疲労しない。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  getLegalActions,
} from "../src/index";
import { applyConnectBattleDecisionAction } from "../src/legal/pending-action-handlers";
import type {
  ActiveAttack,
  CardDefinition,
  ContinuousEffect,
  GameState,
  ResolveConnectBattleDecisionLegalAction,
} from "../src/index";

function makeSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

const ATTACKER_DEF = makeSpirit("TEST-CB-ATTACKER");
const TARGET_DEF: CardDefinition = {
  ...makeSpirit("TEST-CB-TARGET"),
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
};
const getCardDefinitionById = (id: string) =>
  id === ATTACKER_DEF.cardNo
    ? ATTACKER_DEF
    : id === TARGET_DEF.cardNo
      ? TARGET_DEF
      : undefined;

function forceAttackStepEndAfterFirstBattleCe(): ContinuousEffect {
  return {
    effectId: "ce:force-attack-step-end-after-first-battle",
    sourceInstanceId: "attacker-1",
    sourceDefinitionId: ATTACKER_DEF.cardNo,
    actingPlayerId: "alice",
    duration: { scope: "turn" },
    createdAtTurn: 2,
    createdAtAttackId: null,
    modifierTag: "force_attack_step_end_after_first_battle",
    targetInstanceId: "alice",
  };
}

/** alice の attacker-1 が bob にアンブロックでアタック中、解決直前の状態。connectBattleGrant 付き。 */
function buildMidBattleState(remainingUses: number): GameState {
  const attacker = createCardInstance(ATTACKER_DEF, {
    instanceId: "attacker-1",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  const activeAttack: ActiveAttack = {
    attackId: "attack:cb-1:1",
    primaryEntityId: "be-1",
    participantEntityIds: ["be-1"],
    groupMode: "single",
    target: { kind: "player", playerId: "bob" },
    blockAssignments: [{ participantEntityId: "be-1", blockedByEntityIds: [] }],
    // このテストは連続バトル再開状態だけを検証する。ライフ減少バーストの別経路は
    // 含めず、リプレイと同じく pending burst が無い状態に絞る。
    symbolResolutionOrder: [],
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: true,
    flashWindowState: null,
    // 通常の attack→stack→attack immediate 後に連続バトルの選択へ到達するため、
    // 前段のバースト検査も完了済みとして実リプレイと揃える。
    attackAfterBurstChecked: true,
    ownAttackBurstChecked: true,
    connectBattleGrant: { sourceInstanceId: "attacker-1", remainingUses },
  };
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [attacker],
    }),
    turnNumber: 2,
    activePlayerId: "alice",
    step: "attack",
    window: "declare_attack",
    preGame: null,
    activeAttack,
    battleEntities: [
      {
        entityId: "be-1",
        resolvedBp: 2000,
        attackState: "attacking",
        resolvedSymbols: ["red"],
        memberInstanceIds: ["attacker-1"],
      },
    ],
  };
}

function resolve(state: GameState) {
  return executeBattleResolution({
    state,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: undefined,
  });
}

describe("connect_battle: バトル解決終盤で battle_end の前に続行/終了選択を開く", () => {
  it("remainingUses>0 かつアタッカーが場に残っていれば battle_end を発火せず pendingConnectBattleDecision を開く", () => {
    const resolved = resolve(buildMidBattleState(3));

    expect(resolved.state.pendingConnectBattleDecision).not.toBeNull();
    const pending = resolved.state.pendingConnectBattleDecision!;
    expect(pending.remainingUses).toBe(3);
    expect(pending.sourceInstanceId).toBe("attacker-1");
    expect(pending.actingPlayerId).toBe("alice");
    expect(pending.attackId).toBe("attack:cb-1:1");

    // battle_end 発火前 = activeAttack はまだ生きており、アタッカーは "attacking" のまま。
    expect(resolved.state.activeAttack).not.toBeNull();
    expect(resolved.state.activeAttack!.connectBattleGrant).toEqual({
      sourceInstanceId: "attacker-1",
      remainingUses: 3,
    });
    expect(
      resolved.state.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "battle_end"
      )
    ).toHaveLength(0);
    expect(
      resolved.state.battleEntities.find((e) => e.entityId === "be-1")
        ?.attackState
    ).toBe("attacking");
  });

  it("remainingUses===0 なら通常通り battle_end 経路へ進む (pending を開かない)", () => {
    const resolved = resolve(buildMidBattleState(0));

    expect(resolved.state.pendingConnectBattleDecision).toBeNull();
    // 通常の battle_end 経路 = resetBattleEntitiesAfterResolution により activeAttack は null 化。
    expect(resolved.state.activeAttack).toBeNull();
    expect(resolved.state.window).toBe("none");
  });

  it("アタッカーが場を離れていれば (Q9094) remainingUses>0 でも pending を開かない", () => {
    const state = buildMidBattleState(3);
    const leftFieldState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "attacker-1" ? { ...c, zone: "trash" as const } : c
      ),
    };
    const resolved = resolve(leftFieldState);

    expect(resolved.state.pendingConnectBattleDecision).toBeNull();
    expect(resolved.state.activeAttack).toBeNull();
  });
});

function buildDecisionAction(
  pending: NonNullable<GameState["pendingConnectBattleDecision"]>,
  choice: "continue" | "end"
): ResolveConnectBattleDecisionLegalAction {
  return {
    kind: "resolve_connect_battle_decision",
    actionId: `cbd-${pending.pendingId}:${choice}`,
    can: true,
    reason: `connect_battle_decision_${choice}`,
    actingPlayerId: pending.actingPlayerId,
    pendingId: pending.pendingId,
    sourceInstanceId: pending.sourceInstanceId,
    remainingUses: pending.remainingUses,
    choice,
  };
}

describe('connect_battle: 続行選択 (choice:"continue")', () => {
  it("連結中は『最初のバトル終了時』の強制アタックステップ終了を発揮せず、continue を維持する (Q9098)", () => {
    const state: GameState = {
      ...buildMidBattleState(1),
      activeContinuousEffects: [forceAttackStepEndAfterFirstBattleCe()],
    };

    const resolved = resolve(state);

    // Q9098: 連結を選べる間は battle_end ではない。従って force CE も未発揮で、
    // activeAttack と continue 選択が両方維持される。
    expect(resolved.state.pendingConnectBattleDecision).not.toBeNull();
    expect(resolved.state.activeAttack).not.toBeNull();
    expect(resolved.state.battlesEndedThisTurn ?? 0).toBe(0);
    expect(resolved.state.step).toBe("attack");
    expect(() =>
      applyConnectBattleDecisionAction({
        state: resolved.state,
        action: buildDecisionAction(
          resolved.state.pendingConnectBattleDecision!,
          "continue"
        ),
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
      })
    ).not.toThrow();
  });

  it("アタック宣言を経ずにブロック前フラッシュを開ける状態へ戻り、remainingUses を1消費する (Q9096/Q9103)", () => {
    const resolved = resolve(buildMidBattleState(3));
    const pending = resolved.state.pendingConnectBattleDecision!;

    const result = applyConnectBattleDecisionAction({
      state: resolved.state,
      action: buildDecisionAction(pending, "continue"),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    expect(result.state.pendingConnectBattleDecision).toBeNull();
    // `flash_before_block` は優先権状態を伴う window であるため、未オープンの再開地点は
    // `declare_attack` に置き、既存の open_battle_flash で正しい優先権を初期化する。
    expect(result.state.window).toBe("declare_attack");
    expect(result.state.battleResolutionGroup).toBeNull();
    expect(result.state.activeAttack).not.toBeNull();
    expect(result.state.activeAttack!.connectBattleGrant).toEqual({
      sourceInstanceId: "attacker-1",
      remainingUses: 2,
    });
    expect(result.state.activeAttack!.flashBeforeBlockCompleted).toBe(false);
    expect(result.state.activeAttack!.flashAfterBlockCompleted).toBe(false);
    expect(result.state.activeAttack!.blockAssignments).toEqual([
      { participantEntityId: "be-1", blockedByEntityIds: [] },
    ]);
    // Q9096: アタック宣言を行わない → attackDeclarationLog に新規宣言が追加されない。
    expect(result.state.attackDeclarationLog).toEqual(
      resolved.state.attackDeclarationLog
    );
    // Q9103: 疲労しない。
    expect(
      result.state.cardInstances.find((c) => c.instanceId === "attacker-1")
        ?.exhaustState
    ).not.toBe("exhausted");

    expect(
      getLegalActions({
        state: result.state,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => [],
      })
    ).toContainEqual(
      expect.objectContaining({
        kind: "open_battle_flash",
        flashKind: "before_block",
      })
    );

    // 続けて2回目のバトル解決を回せる (executeBattleResolution は window を検査しないため
    // 直接呼べる。GUI/legal-actions 経路では declare_block → flash_after_block pass を経由する)。
    const secondResolution = resolve(result.state);
    expect(secondResolution.state.pendingConnectBattleDecision).not.toBeNull();
    expect(
      secondResolution.state.pendingConnectBattleDecision!.remainingUses
    ).toBe(2);
  });

  it("指定アタックの対象が前戦で離脱しても、continue 後は相手プレイヤー対象へ戻ってブロック前フラッシュを開ける", () => {
    const target = createCardInstance(TARGET_DEF, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const base = buildMidBattleState(1);
    const state: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, target],
      activeAttack: {
        ...base.activeAttack!,
        target: { kind: "battle_entity", entityId: "be-target" },
        designatedTargetInstanceId: "target-1",
        blockAssignments: [
          {
            participantEntityId: "be-1",
            blockedByEntityIds: ["be-target"],
          },
        ],
      },
      battleEntities: [
        ...base.battleEntities,
        {
          entityId: "be-target",
          resolvedBp: 1000,
          attackState: "blocking",
          resolvedSymbols: ["red"],
          memberInstanceIds: ["target-1"],
        },
      ],
    };
    const resolved = resolve(state);
    const targetLeftField: GameState = {
      ...resolved.state,
      battleImmediateEffects: [],
      pendingTriggeredEffects: [],
      pendingBurstChecks: [],
      preDeclarationStackWindow: null,
      cardInstances: resolved.state.cardInstances.map((card) =>
        card.instanceId === "target-1"
          ? { ...card, zone: "trash" as const, pendingLeaveKind: null }
          : card
      ),
    };
    const result = applyConnectBattleDecisionAction({
      state: targetLeftField,
      action: buildDecisionAction(
        targetLeftField.pendingConnectBattleDecision!,
        "continue"
      ),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    expect(result.state.pendingConnectBattleDecision).toBeNull();
    expect(result.state.activeAttack?.target).toEqual({
      kind: "player",
      playerId: "bob",
    });
    expect(
      result.state.activeAttack?.designatedTargetInstanceId
    ).toBeUndefined();
    expect(
      result.state.battleEntities.find(
        (entity) => entity.entityId === "be-target"
      )?.attackState
    ).toBe("idle");
    expect(
      getLegalActions({
        state: result.state,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => [],
      })
    ).toContainEqual(
      expect.objectContaining({
        kind: "open_battle_flash",
        flashKind: "before_block",
      })
    );
  });
});

describe('connect_battle: 終了選択 (choice:"end")', () => {
  it("保持していたコンテキストで通常の battle_end 経路 (queueBattleEndTriggers→reset→scope失効) を実行する", () => {
    const resolved = resolve(buildMidBattleState(1));
    const pending = resolved.state.pendingConnectBattleDecision!;

    const result = applyConnectBattleDecisionAction({
      state: resolved.state,
      action: buildDecisionAction(pending, "end"),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    expect(result.state.pendingConnectBattleDecision).toBeNull();
    expect(result.state.activeAttack).toBeNull();
    expect(result.state.window).toBe("none");
    expect(
      result.state.battleEntities.find((e) => e.entityId === "be-1")
        ?.attackState
    ).toBe("idle");
  });

  it("連結を終了した時点でのみ『最初のバトル終了時』の強制アタックステップ終了を発揮する (Q9098)", () => {
    const resolved = resolve({
      ...buildMidBattleState(1),
      activeContinuousEffects: [forceAttackStepEndAfterFirstBattleCe()],
    });
    const pending = resolved.state.pendingConnectBattleDecision!;

    const result = applyConnectBattleDecisionAction({
      state: resolved.state,
      action: buildDecisionAction(pending, "end"),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    expect(result.state.battlesEndedThisTurn).toBe(1);
    expect(result.state.step).toBe("end");
    expect(result.state.activeAttack).toBeNull();
  });
});

describe("connect_battle: maxUses は継続回数 (off-by-one 回帰、adversarial verifier 2026-08-02 round1 lens1)", () => {
  it("maxUses:2 (三歩必殺の実値) なら 続行→続行→(3戦目終了後は remainingUses:0 のため pending を開かない) で合計ちょうど3回のバトルになる", () => {
    // 1戦目解決 (remainingUses:2 で開始 = BSTH06-X03 の connect_battle maxUses:2 相当)。
    const firstResolution = resolve(buildMidBattleState(2));
    const firstPending = firstResolution.state.pendingConnectBattleDecision!;
    expect(firstPending.remainingUses).toBe(2);

    // 続行1回目 → 2戦目。remainingUses は 2→1。
    const afterFirstContinue = applyConnectBattleDecisionAction({
      state: firstResolution.state,
      action: buildDecisionAction(firstPending, "continue"),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    expect(
      afterFirstContinue.state.activeAttack!.connectBattleGrant!.remainingUses
    ).toBe(1);

    const secondResolution = resolve(afterFirstContinue.state);
    const secondPending = secondResolution.state.pendingConnectBattleDecision!;
    expect(secondPending.remainingUses).toBe(1);

    // 続行2回目 → 3戦目。remainingUses は 1→0。
    const afterSecondContinue = applyConnectBattleDecisionAction({
      state: secondResolution.state,
      action: buildDecisionAction(secondPending, "continue"),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    expect(
      afterSecondContinue.state.activeAttack!.connectBattleGrant!.remainingUses
    ).toBe(0);

    // 3戦目解決: remainingUses:0 のため pendingConnectBattleDecision は開かず、
    // 通常の battle_end 経路へ進む (= 合計3回で打ち止め、4回目には入らない)。
    const thirdResolution = resolve(afterSecondContinue.state);
    expect(thirdResolution.state.pendingConnectBattleDecision).toBeNull();
    expect(thirdResolution.state.activeAttack).toBeNull();
  });
});
