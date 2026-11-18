import { generateTopLevelActionInputChoices } from "../src/action-input-choices";
import {
  getCandidateTargetInstanceIds,
  resolveDeclaredBlockerTribes,
} from "../src/legal/legal-actions-shared";
/**
 * P2-05 Phase 1: 複数体同時アタック宣言 (allow_simultaneous_attack CE) の検証。
 *
 * 正源: 10_rules/05 §複数体同時アタック
 * - 同時アタックは効果がある場合のみ (BSTH07.8-XX01【導域】妖精5体まで)
 * - group 全体で「アタックしたとき」観測は 1 回 (公式 Q26342)
 * - 各参加体自身の『アタック時』は個別発揮 (公式 Q26329)
 * - バトルは group 単位で同時解決 (公式 Q26333)
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type {
  AttackLegalAction,
  CardDefinition,
  GameState,
  LegalAction,
} from "../src";

const emptyFieldEffectActionLookup = () => undefined;

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

// 非妖精スピリット (フィルタ除外検証用)
const nonFairyDefinition: CardDefinition = {
  cardNo: "TEST-NONFAIRY-001",
  name: "Test Non Fairy",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red"],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 2000 },
    { level: 2, requiredCores: 3, bp: 4000 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const bpBraveDefinition: CardDefinition = {
  cardNo: "TEST-BP-BRAVE-001",
  name: "Test BP Brave",
  printedCategory: "brave",
  colors: ["red"],
  cost: 2,
  reductionSymbols: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  braveCondition: { categories: ["spirit"] },
  combinedBoost: 3000,
  sourceUrls: [],
  sourceConfidence: "C",
};

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  id === nonFairyDefinition.cardNo
    ? nonFairyDefinition
    : id === bpBraveDefinition.cardNo
      ? bpBraveDefinition
      : cardNoMap.get(id);

const xx01 = cardNoMap.get("BSTH07.8-XX01")!;
const fairy = cardNoMap.get("BSTH07.8-C01")!; // 系統: 幻想・妖精, 緑シンボル1

/**
 * alice: XX01 導界者ネクサス + 妖精3体 + 非妖精1体 / bob: 防御側。
 * step=attack, alice ターン。registerGrant=true で【導域】CE を登録する。
 */
function createSimulAttackState(options?: {
  registerGrant?: boolean;
}): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(xx01, {
        instanceId: "xx01-1",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(fairy, {
        instanceId: "fairy-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(fairy, {
        instanceId: "fairy-2",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(fairy, {
        instanceId: "fairy-3",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(nonFairyDefinition, {
        instanceId: "nonfairy-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(nonFairyDefinition, {
        instanceId: "blocker-1",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(nonFairyDefinition, {
        instanceId: "blocker-2",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
  });
  const state: GameState = {
    ...base,
    step: "attack",
    turnNumber: 2,
    activePlayerId: "alice",
  };
  if (options?.registerGrant === false) return state;
  // XX01 effects[1] = 【導域】Lv1-Lv2『自分のアタックステップ』(同時アタック許可)
  return executeEffect({
    chainId: "test:p2-05-simultaneous-attack:139",
    state,
    effect: xx01.effects![1]!,
    sourceInstanceId: "xx01-1",
    actingPlayerId: "alice",
    getCardDefinitionById,
  });
}

function getActions(state: GameState, actingPlayerId: string): LegalAction[] {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: emptyFieldEffectActionLookup,
  });
}

/**
 * applyLegalAction ラッパ。空の triggered-effect / burst lookup を渡し、
 * 「listener 不明の raw push fallback」(P3-39 / P3-67) で vacuous pending が
 * 残るのを防ぐ。
 */
function apply(state: GameState, action: LegalAction): GameState {
  return applyLegalAction({
    state,
    action,
    ...(action.kind === "block" ? { replayLegacyBlockDeclaration: true } : {}),
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => undefined,
  }).state;
}

function findAttackAction(
  state: GameState,
  sourceInstanceId: string
): AttackLegalAction {
  const action = getActions(state, "alice").find(
    (a): a is AttackLegalAction =>
      a.kind === "attack" &&
      a.sourceInstanceId === sourceInstanceId &&
      a.targetInstanceId === undefined
  );
  expect(action).toBeDefined();
  return action!;
}

/** 宣言前スタック窓を優先権者のパスで閉じ、confirm 済み state を返す。 */
function passPreDeclarationStack(state: GameState): GameState {
  const priorityPlayerId = state.preDeclarationStackWindow?.priorityPlayerId;
  expect(priorityPlayerId).toBeDefined();
  const passAction = getActions(state, priorityPlayerId!).find(
    (a) => a.kind === "pass_pre_declaration_stack"
  );
  expect(passAction).toBeDefined();
  return apply(state, passAction!);
}

/** bob のブロック宣言 (blocker × participant) を confirm まで進める。 */
function declareBlock(
  state: GameState,
  blockerInstanceId: string,
  participantEntityId: string
): GameState {
  const blockAction = getActions(state, "bob").find(
    (a) =>
      a.kind === "block" &&
      a.sourceInstanceId === blockerInstanceId &&
      a.participantEntityId === participantEntityId
  );
  expect(blockAction).toBeDefined();
  const declared = apply(state, blockAction!);
  return passPreDeclarationStack(declared);
}

/** 同時アタックを宣言し confirm まで進める。 */
function declareSimultaneousAttack(
  state: GameState,
  primaryInstanceId: string,
  additionalSourceInstanceIds: string[]
): GameState {
  const attackAction = findAttackAction(state, primaryInstanceId);
  const declared = apply(state, {
    ...attackAction,
    additionalSourceInstanceIds,
  });
  return passPreDeclarationStack(declared);
}

/** 前半フラッシュ窓を open→双方パスで閉じる (開けない場合はそのまま)。 */
function closeBattleFlashWindow(state: GameState): GameState {
  const openAction = getActions(state, state.activePlayerId).find(
    (a) => a.kind === "open_battle_flash"
  );
  if (!openAction) return state;
  let current = apply(state, openAction);
  for (let i = 0; i < 2; i++) {
    const priorityPlayerId =
      current.activeAttack?.flashWindowState?.priorityPlayerId;
    if (!priorityPlayerId) return current;
    const passAction = getActions(current, priorityPlayerId).find(
      (a) => a.kind === "pass_battle_flash"
    );
    if (!passAction) return current;
    current = apply(current, passAction);
  }
  return current;
}

describe("P2-05 Phase 1: 同時アタック legal action", () => {
  it("導域 CE 有効時、妖精アタッカーに simultaneousAttackOption が付く (候補は妖精のみ)", () => {
    const state = createSimulAttackState();
    const fairyAttack = findAttackAction(state, "fairy-1");
    expect(fairyAttack.simultaneousAttackOption).toBeDefined();
    expect(
      [...fairyAttack.simultaneousAttackOption!.candidateInstanceIds].sort()
    ).toEqual(["fairy-2", "fairy-3"]);
    expect(fairyAttack.simultaneousAttackOption!.maxCount).toBe(5);
    expect(fairyAttack.simultaneousAttackOption!.grantSourceInstanceId).toBe(
      "xx01-1"
    );
  });

  it("filter に合致しないアタッカー (非妖精) には option が付かない", () => {
    const state = createSimulAttackState();
    const nonFairyAttack = findAttackAction(state, "nonfairy-1");
    expect(nonFairyAttack.simultaneousAttackOption).toBeUndefined();
  });

  it("CE 未登録なら option が付かない", () => {
    const state = createSimulAttackState({ registerGrant: false });
    const fairyAttack = findAttackAction(state, "fairy-1");
    expect(fairyAttack.simultaneousAttackOption).toBeUndefined();
  });

  it("filter の BP 条件は合体ブレイヴ込み BP で候補を判定する", () => {
    const lowBp = createCardInstance(nonFairyDefinition, {
      instanceId: "bp-low-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const combinedHost = {
      ...createCardInstance(nonFairyDefinition, {
        instanceId: "bp-host-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      attachedChildrenIds: ["bp-brave-1"],
    };
    const brave = {
      ...createCardInstance(bpBraveDefinition, {
        instanceId: "bp-brave-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0,
      }),
      attachedToInstanceId: "bp-host-1",
      zoneRoleName: "brave",
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(xx01, {
          instanceId: "xx01-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        lowBp,
        combinedHost,
        brave,
      ],
    });
    const state = executeEffect({
      chainId: "test:p2-05-simultaneous-attack:313",
      state: {
        ...base,
        step: "attack",
        turnNumber: 2,
        activePlayerId: "alice",
      },
      effect: {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "allow_simultaneous_attack",
              player: "self",
              filter: { category: ["spirit"], maxBp: 4000 },
              maxCount: 2,
              duration: { scope: "while_on_field" },
            },
          },
        ],
      } as NonNullable<CardDefinition["effects"]>[number],
      sourceInstanceId: "xx01-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const lowAttack = findAttackAction(state, "bp-low-1");
    expect(lowAttack.simultaneousAttackOption).toBeUndefined();
    expect(() =>
      applyLegalAction({
        state,
        action: {
          ...lowAttack,
          additionalSourceInstanceIds: ["bp-host-1"],
        },
        getCardDefinitionById,
      })
    ).toThrow(/participant_does_not_match_filter/);
  });
});

describe("P2-05 Phase 1: 同時アタック宣言 → confirm", () => {
  it("3体同時宣言で participants 3 / groupMode simultaneous / 全疲労 / blockAssignments 3", () => {
    const state = createSimulAttackState();
    const confirmed = declareSimultaneousAttack(state, "fairy-1", [
      "fairy-2",
      "fairy-3",
    ]);

    const activeAttack = confirmed.activeAttack;
    expect(activeAttack).not.toBeNull();
    expect(activeAttack!.participantEntityIds).toHaveLength(3);
    expect(activeAttack!.groupMode).toBe("simultaneous");
    expect(activeAttack!.blockAssignments).toHaveLength(3);
    expect(
      activeAttack!.blockAssignments.every(
        (a) => a.blockedByEntityIds.length === 0
      )
    ).toBe(true);
    expect(activeAttack!.symbolResolutionOrder).toHaveLength(3);

    for (const id of ["fairy-1", "fairy-2", "fairy-3"]) {
      const card = confirmed.cardInstances.find((c) => c.instanceId === id)!;
      expect(card.exhaustState).toBe("exhausted");
    }

    // Q26342: 「アタックしたとき」観測は group で 1 回 = attack:declare は primary のみ。
    // 追加参加体は attack:join (観測トリガー抑制側の経路)。
    const declareLogs = confirmed.log.filter((l) =>
      l.startsWith("attack:declare:")
    );
    const joinLogs = confirmed.log.filter((l) => l.startsWith("attack:join:"));
    expect(declareLogs).toHaveLength(1);
    expect(joinLogs).toHaveLength(2);
  });

  it("attackDeclarationLog (attack_occurred ConditionClause の SSOT) には primary + 全追加参加体が記録される (Q26342 の観測トリガー1回化とは別軸)", () => {
    const state = createSimulAttackState();
    const confirmed = declareSimultaneousAttack(state, "fairy-1", [
      "fairy-2",
      "fairy-3",
    ]);
    const loggedIds = confirmed.attackDeclarationLog
      .filter((e) => e.playerId === "alice")
      .map((e) => e.cardInstanceId)
      .sort();
    expect(loggedIds).toEqual(["fairy-1", "fairy-2", "fairy-3"]);
  });

  it("filter 非合致の追加参加体は宣言時に reject", () => {
    const state = createSimulAttackState();
    const attackAction = findAttackAction(state, "fairy-1");
    expect(() =>
      applyLegalAction({
        state,
        action: {
          ...attackAction,
          additionalSourceInstanceIds: ["nonfairy-1"],
        },
        getCardDefinitionById,
      })
    ).toThrow(/participant_does_not_match_filter/);
  });

  it("primary 重複は宣言時に reject", () => {
    const state = createSimulAttackState();
    const attackAction = findAttackAction(state, "fairy-1");
    expect(() =>
      applyLegalAction({
        state,
        action: { ...attackAction, additionalSourceInstanceIds: ["fairy-1"] },
        getCardDefinitionById,
      })
    ).toThrow(/duplicate_participant/);
  });

  it("CE 未登録での同時宣言は reject", () => {
    const state = createSimulAttackState({ registerGrant: false });
    const attackAction = findAttackAction(state, "fairy-1");
    expect(() =>
      applyLegalAction({
        state,
        action: { ...attackAction, additionalSourceInstanceIds: ["fairy-2"] },
        getCardDefinitionById,
      })
    ).toThrow(/no_simultaneous_attack_grant/);
  });
});

describe("P2-05 Phase 2: 複数ブロック (blockerCapacity)", () => {
  it("XX01 (participant_count) で 2体同時アタックに 2 体ブロックでき、両ペア BP 比較で解決する", () => {
    const state = createSimulAttackState();
    const confirmed = declareSimultaneousAttack(state, "fairy-1", ["fairy-2"]);
    expect(confirmed.activeAttack!.blockerCapacity).toBe("participant_count");

    const readyToBlock = closeBattleFlashWindow(confirmed);
    const [participantA, participantB] =
      readyToBlock.activeAttack!.participantEntityIds;

    // 1体目のブロック後も追加ブロックが可能 = after_block flash はまだ開けない
    const afterFirstBlock = declareBlock(
      readyToBlock,
      "blocker-1",
      participantA!
    );
    expect(
      getActions(afterFirstBlock, "alice").some(
        (a) => a.kind === "open_battle_flash"
      )
    ).toBe(false);
    expect(
      getActions(afterFirstBlock, "bob").some((a) => a.kind === "block")
    ).toBe(true);

    // 2体目のブロックで容量到達 → after_block flash 解禁
    const afterSecondBlock = declareBlock(
      afterFirstBlock,
      "blocker-2",
      participantB!
    );
    expect(
      afterSecondBlock.activeAttack!.blockAssignments.every(
        (a) => a.blockedByEntityIds.length > 0
      )
    ).toBe(true);
    expect(
      getActions(afterSecondBlock, "bob").some((a) => a.kind === "block")
    ).toBe(false);

    // after_block flash を閉じると自動でバトル解決: BP1000 妖精 × BP2000 ブロッカー
    // 2ペアともアタッカー破壊、ライフ減少なし。
    const resolved = closeBattleFlashWindow(afterSecondBlock);
    const bob = resolved.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(5);
    const compares = resolved.log.filter((l) =>
      l.includes("battle:resolution:bp-compare:")
    );
    expect(compares).toHaveLength(2);
    expect(compares.every((l) => l.endsWith("attacker_destroyed"))).toBe(true);
  });

  it("1体ブロック後の decline_block は完了宣言となり、未ブロック分のライフ減少で解決する", () => {
    const state = createSimulAttackState();
    const confirmed = declareSimultaneousAttack(state, "fairy-1", ["fairy-2"]);
    const readyToBlock = closeBattleFlashWindow(confirmed);
    const [participantA] = readyToBlock.activeAttack!.participantEntityIds;

    const afterBlock = declareBlock(readyToBlock, "blocker-1", participantA!);

    // 完了宣言 (decline_block) → 解決はまだ走らない
    const declineAction = getActions(afterBlock, "bob").find(
      (a) => a.kind === "decline_block"
    );
    expect(declineAction).toBeDefined();
    const completed = apply(afterBlock, declineAction!);
    expect(completed.activeAttack!.blockDeclarationCompleted).toBe(true);
    expect(completed.battleResolutionGroup).toBeNull();
    expect(
      completed.players.find((p) => p.id === "bob")!.lifeNormalCoreCount
    ).toBe(5);

    // after_block flash を閉じると解決: ブロックされなかった1体分ライフ -1
    const resolved = closeBattleFlashWindow(completed);
    const bob = resolved.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(4);
  });

  it("blockerCapacity 未指定の grant は上限 1 (Q26724 デフォルト)", () => {
    const base = createSimulAttackState({ registerGrant: false });
    // blockerCapacity 省略の同時アタック許可 (R03 以前のデフォルト形)
    const state = executeEffect({
      chainId: "test:p2-05-simultaneous-attack:524",
      state: base,
      effect: {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "allow_simultaneous_attack",
              player: "self",
              filter: { tribes: ["妖精"], category: ["spirit"] },
              maxCount: 3,
              duration: { scope: "while_on_field" },
            },
          },
        ],
      } as NonNullable<CardDefinition["effects"]>[number],
      sourceInstanceId: "xx01-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const confirmed = declareSimultaneousAttack(state, "fairy-1", ["fairy-2"]);
    expect(confirmed.activeAttack!.blockerCapacity).toBe(1);

    const readyToBlock = closeBattleFlashWindow(confirmed);
    const [participantA] = readyToBlock.activeAttack!.participantEntityIds;
    const afterBlock = declareBlock(readyToBlock, "blocker-1", participantA!);

    // 容量 1 到達 → 追加 block なし、after_block flash 即解禁
    expect(getActions(afterBlock, "bob").some((a) => a.kind === "block")).toBe(
      false
    );
    expect(
      getActions(afterBlock, "alice").some(
        (a) => a.kind === "open_battle_flash"
      )
    ).toBe(true);
  });
});

describe("P2-05 Phase 1: 同時解決 (group 単位バトル解決)", () => {
  it("2体同時アタックを decline_block すると両シンボル分ライフが減る (5→3)", () => {
    const state = createSimulAttackState();
    const confirmed = declareSimultaneousAttack(state, "fairy-1", ["fairy-2"]);
    const readyState = closeBattleFlashWindow(confirmed);

    const declineAction = getActions(readyState, "bob").find(
      (a) => a.kind === "decline_block"
    );
    expect(declineAction).toBeDefined();
    const resolved = apply(readyState, declineAction!);

    const bob = resolved.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(3);
  });
});

describe("P2-05: BSTH02-R03 プリズムリバー3体同時アタック (カード名部分一致 filter)", () => {
  it("R01+R02+R03 の3姉妹で同時アタックでき、blockerCapacity は 2", () => {
    const r01 = cardNoMap.get("BSTH02-R01")!; // リリカ・プリズムリバー
    const r02 = cardNoMap.get("BSTH02-R02")!; // メルラン・プリズムリバー
    const r03 = cardNoMap.get("BSTH02-R03")!; // ルナサ・プリズムリバー
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        // R03 は Lv3 (requiredCores 4) で【導域』効果の min_level 3 を満たす
        createCardInstance(r03, {
          instanceId: "lunasa-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 4,
        }),
        createCardInstance(r01, {
          instanceId: "lyrica-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(r02, {
          instanceId: "merlin-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(nonFairyDefinition, {
          instanceId: "other-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    let state: GameState = {
      ...base,
      step: "attack",
      turnNumber: 2,
      activePlayerId: "alice",
    };
    // effects[3] = Lv3『自分のアタックステップ』同時アタック許可
    state = executeEffect({
      chainId: "test:p2-05-simultaneous-attack:623",
      state,
      effect: r03.effects![3]!,
      sourceInstanceId: "lunasa-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const attackAction = findAttackAction(state, "lunasa-1");
    expect(attackAction.simultaneousAttackOption).toBeDefined();
    expect(
      [...attackAction.simultaneousAttackOption!.candidateInstanceIds].sort()
    ).toEqual(["lyrica-1", "merlin-1"]);
    expect(attackAction.simultaneousAttackOption!.maxCount).toBe(3);

    const confirmed = declareSimultaneousAttack(state, "lunasa-1", [
      "lyrica-1",
      "merlin-1",
    ]);
    expect(confirmed.activeAttack!.participantEntityIds).toHaveLength(3);
    expect(confirmed.activeAttack!.blockerCapacity).toBe(2);
  });
});

describe("P2-05 Phase 4b: ターン最初のバトル終了時アタックステップ強制終了", () => {
  function declareSingleAttack(
    state: GameState,
    sourceInstanceId: string
  ): GameState {
    const attackAction = findAttackAction(state, sourceInstanceId);
    const declared = apply(state, attackAction);
    return passPreDeclarationStack(declared);
  }

  function resolveByDecline(state: GameState): GameState {
    const ready = closeBattleFlashWindow(state);
    const declineAction = getActions(ready, "bob").find(
      (a) => a.kind === "decline_block"
    );
    expect(declineAction).toBeDefined();
    return apply(ready, declineAction!);
  }

  it("導域 CE 有効時、1体アタックでも最初のバトル終了でアタックステップが終了する", () => {
    const state = createSimulAttackState();
    const confirmed = declareSingleAttack(state, "fairy-1");
    const resolved = resolveByDecline(confirmed);

    expect(resolved.battlesEndedThisTurn).toBe(1);
    expect(resolved.step).toBe("end");
    expect(
      resolved.log.some((l) => l.startsWith("battle:forced-attack-step-end:"))
    ).toBe(true);
  });

  it("CE 未登録なら最初のバトル終了後もアタックステップに留まる", () => {
    const state = createSimulAttackState({ registerGrant: false });
    const confirmed = declareSingleAttack(state, "fairy-1");
    const resolved = resolveByDecline(confirmed);

    expect(resolved.battlesEndedThisTurn).toBe(1);
    expect(resolved.step).toBe("attack");
    // 2体目のアタックが引き続き可能
    expect(
      getActions(resolved, "alice").some(
        (a) => a.kind === "attack" && a.sourceInstanceId === "fairy-2"
      )
    ).toBe(true);
  });

  it("CE がターン最初のバトル終了より後に有効化された場合は発動しない (2戦目は最初ではない)", () => {
    const state = createSimulAttackState({ registerGrant: false });
    const firstResolved = resolveByDecline(
      declareSingleAttack(state, "fairy-1")
    );
    expect(firstResolved.step).toBe("attack");

    // 1戦目終了後に【導域】CE を登録 → 2戦目の終了では「最初のバトル」ではない
    const withCE = executeEffect({
      chainId: "test:p2-05-simultaneous-attack:701",
      state: firstResolved,
      effect: xx01.effects![1]!,
      sourceInstanceId: "xx01-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const secondResolved = resolveByDecline(
      declareSingleAttack(withCE, "fairy-2")
    );

    expect(secondResolved.battlesEndedThisTurn).toBe(2);
    expect(secondResolved.step).toBe("attack");
  });
});

describe("同時ブロック宣言", () => {
  function blockTogether(state: GameState, sameTarget = false): GameState {
    const [first, second] = state.activeAttack!.participantEntityIds;
    const candidates = getActions(state, "bob");
    const blockA = candidates.find(
      (a) =>
        a.kind === "block" &&
        a.participantEntityId === first &&
        a.sourceInstanceId === "blocker-1"
    )!;
    const blockB = candidates.find(
      (a) =>
        a.kind === "block" &&
        a.participantEntityId === (sameTarget ? first : second) &&
        a.sourceInstanceId === "blocker-2"
    )!;
    return applyLegalAction({
      state,
      action: blockA,
      blockActionIds: [blockA.actionId, blockB.actionId],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
    }).state;
  }

  function readyToBlock() {
    return closeBattleFlashWindow(
      declareSimultaneousAttack(createSimulAttackState(), "fairy-1", [
        "fairy-2",
      ])
    );
  }

  it("宣言中の破壊効果は先頭以外のブロッカーも対象にできる", () => {
    const announced = blockTogether(readyToBlock());
    const effect = cardNoMap.get("BSTH003-C33")!.effects![2]!;
    const destroy = effect.steps[1]!.action;
    if (
      destroy.kind !== "destroy" ||
      typeof destroy.target !== "object" ||
      !("filter" in destroy.target)
    ) {
      throw new Error("Expected block declaration filter");
    }
    expect(
      getCandidateTargetInstanceIds(
        announced,
        "alice",
        {
          candidateTargetPlayerScope: "opponent",
          targetCardFilter: destroy.target.filter,
        },
        { getCardDefinitionById }
      ).sort()
    ).toEqual(["blocker-1", "blocker-2"]);
  });

  it("指定アタックの強制ブロックも成立前の対象にできる", () => {
    const ready = readyToBlock();
    const { preDeclarationStackWindow: declared } = blockTogether(ready);
    const announced: GameState = {
      ...ready,
      preDeclarationStackWindow: {
        ...declared!,
        kind: "forced_block",
      },
    };
    delete announced.preDeclarationStackWindow!.blockDeclarationAssignments;
    expect(
      getCandidateTargetInstanceIds(
        announced,
        "alice",
        {
          candidateTargetPlayerScope: "opponent",
          targetCardFilter: {
            category: ["spirit"],
            battleState: "declaring_block",
          },
        },
        { getCardDefinitionById }
      )
    ).toEqual(["blocker-1"]);
  });

  it("旧棋譜の単独ブロック宣言に応答する破壊効果は、先に成立した方を対象にする", () => {
    const ready = readyToBlock();
    const [first, second] = ready.activeAttack!.participantEntityIds;
    const afterFirst = declareBlock(ready, "blocker-1", first!);
    const laterBlock = getActions(afterFirst, "bob").find(
      (action) =>
        action.kind === "block" &&
        action.sourceInstanceId === "blocker-2" &&
        action.participantEntityId === second!
    )!;
    const announced = apply(afterFirst, laterBlock);
    expect(announced.preDeclarationStackWindow?.sourceInstanceId).toBe(
      "blocker-2"
    );
    expect(
      announced.preDeclarationStackWindow?.blockDeclarationAssignments
    ).toBeUndefined();
    expect(
      getCandidateTargetInstanceIds(
        announced,
        "alice",
        {
          candidateTargetPlayerScope: "opponent",
          targetCardFilter: {
            category: ["spirit"],
            battleState: "declaring_block",
          },
        },
        { getCardDefinitionById }
      )
    ).toEqual(["blocker-1"]);
    expect(
      getCandidateTargetInstanceIds(
        { ...afterFirst, window: "stack_after_block" },
        "alice",
        {
          candidateTargetPlayerScope: "opponent",
          targetCardFilter: {
            category: ["spirit"],
            battleState: "declaring_block",
          },
        },
        { getCardDefinitionById }
      )
    ).toEqual(["blocker-1"]);
    const withDifferentTribes = (definitionId: string) => {
      const definition = getCardDefinitionById(definitionId);
      return definition?.cardNo === nonFairyDefinition.cardNo
        ? { ...definition, tribe: ["先行ブロッカー"] }
        : definition;
    };
    const withDifferentSources = {
      ...announced,
      cardInstances: announced.cardInstances.map((card) =>
        card.instanceId === "blocker-2"
          ? { ...card, definitionId: fairy.cardNo }
          : card
      ),
    };
    expect(
      resolveDeclaredBlockerTribes(withDifferentSources, withDifferentTribes)
    ).toEqual(["先行ブロッカー"]);
  });

  it("配列省略で1組だけ送信しても追加の通常ブロックは開かない", () => {
    const ready = readyToBlock();
    const block = getActions(ready, "bob").find((a) => a.kind === "block")!;
    const announced = applyLegalAction({
      state: ready,
      action: block,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
    }).state;
    const completed = passPreDeclarationStack(announced);
    expect(completed.activeAttack?.blockDeclarationCompleted).toBe(true);
    expect(getActions(completed, "bob").some((a) => a.kind === "block")).toBe(
      false
    );
  });

  it("応答で追加された未払いの破壊コストは、支払い候補があっても成立させない", () => {
    const ready = readyToBlock();
    const action = getActions(ready, "bob").find((a) => a.kind === "block")!;
    const announced = applyLegalAction({
      state: ready,
      action,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
    }).state;
    const kamehameha = cardNoMap.get("BSDB01-C09")!;
    const responded = executeEffect({
      chainId: "test:block-response-destroy-cost",
      state: announced,
      effect: kamehameha.effects![2]!,
      sourceInstanceId: "kamehameha",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      responded.activeContinuousEffects.some(
        (effect) => effect.modifierTag === "battle_destroy_cost_gate_both"
      )
    ).toBe(true);
    const resolved = passPreDeclarationStack(responded);
    expect(resolved.activeAttack).toBeNull();
    for (const id of ["blocker-1", "blocker-2"]) {
      const card = resolved.cardInstances.find(
        (entry) => entry.instanceId === id
      );
      expect(card).toMatchObject({ zone: "field", exhaustState: "recovered" });
    }
  });

  it("支払いが済んだ義務が同数の別の義務に入れ替わっても成立しない", () => {
    const ready = readyToBlock();
    const target = ready.activeAttack!.participantEntityIds[0]!;
    ready.cardInstances.push(
      createCardInstance(nonFairyDefinition, {
        instanceId: "payment-card",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      })
    );
    const oldCost = {
      effectId: "old-deck-cost",
      sourceInstanceId: "source-of-deck-cost",
      sourceDefinitionId: "BSTH10-X05",
      actingPlayerId: "alice",
      duration: { scope: "turn" as const },
      createdAtTurn: ready.turnNumber,
      createdAtAttackId: ready.activeAttack!.attackId,
      modifierTag: "battle_destroy_cost_gate_both" as const,
      targetFilter: {
        player: "opponent" as const,
        category: ["spirit" as const],
      },
      metadata: {
        costTargetCategory: ["spirit"],
        costDestination: "deck_bottom",
      },
    };
    ready.activeContinuousEffects = [...ready.activeContinuousEffects, oldCost];
    const action = getActions(ready, "bob").find(
      (a) =>
        a.kind === "block" &&
        a.sourceInstanceId === "blocker-1" &&
        a.participantEntityId === target &&
        (a.battleDestroyCostSourceInstanceId === "payment-card" ||
          a.battleDestroyCostSourceInstanceIds?.includes("payment-card"))
    )!;
    expect(action, JSON.stringify(getActions(ready, "bob"))).toBeDefined();
    const announced = applyLegalAction({
      state: ready,
      action,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
    }).state;
    expect(
      announced.preDeclarationStackWindow?.blockDeclarationAssignments?.[0]
        ?.paidBattleCardCosts
    ).toEqual([{ effectId: oldCost.effectId, destination: "deck_bottom" }]);
    expect(
      announced.cardInstances.find((card) => card.instanceId === "payment-card")
        ?.zone
    ).toBe("deck");
    const response = {
      ...announced,
      activeContinuousEffects: announced.activeContinuousEffects.map(
        (effect) =>
          effect.effectId === oldCost.effectId
            ? {
                ...effect,
                effectId: "new-destroy-cost",
                metadata: { costTargetCategory: ["spirit"] },
              }
            : effect
      ),
    };
    const resolved = passPreDeclarationStack(response);
    expect(resolved.activeAttack).toBeNull();
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "blocker-2")
        ?.zone
    ).toBe("field");
  });

  it("AI の入力候補から義務先と任意先を一括宣言し、同じ成立処理を通る", () => {
    const ready = readyToBlock();
    ready.activeContinuousEffects.push({
      effectId: "test-block-obligation",
      sourceInstanceId: "fairy-1",
      sourceDefinitionId: fairy.cardNo,
      actingPlayerId: "alice",
      targetInstanceId: "alice",
      duration: { scope: "battle" },
      createdAtTurn: ready.turnNumber,
      createdAtAttackId: ready.activeAttack!.attackId,
      modifierTag: "require_block_if_able",
    });
    const action = getActions(ready, "bob").find(
      (candidate) => candidate.kind === "block"
    )!;
    const { values } = generateTopLevelActionInputChoices(
      ready,
      action,
      { getCardDefinitionById },
      32
    );
    const input = values.find((entry) => entry.blockActionIds?.length === 2);
    expect(input).toBeDefined();
    const announced = applyLegalAction({
      state: ready,
      action,
      ...input,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
    }).state;
    expect(
      announced.preDeclarationStackWindow?.blockDeclarationAssignments
    ).toHaveLength(2);
    const confirmed = passPreDeclarationStack(announced);
    expect(
      confirmed.activeAttack?.blockAssignments.map(
        (assignment) => assignment.blockedByEntityIds.length
      )
    ).toEqual([1, 1]);
  });

  it("一つの応答窓を経て両ペアが成立し、次の通常ブロックを受け付けない", () => {
    const announced = blockTogether(readyToBlock());
    expect(
      announced.preDeclarationStackWindow?.blockDeclarationAssignments?.map(
        (assignment) => assignment.sourceInstanceId
      )
    ).toEqual(["blocker-1", "blocker-2"]);
    expect(
      announced.activeAttack?.blockAssignments.map(
        (a) => a.blockedByEntityIds.length
      )
    ).toEqual([0, 0]);
    const confirmed = passPreDeclarationStack(announced);
    expect(
      confirmed.activeAttack?.blockAssignments.map(
        (a) => a.blockedByEntityIds.length
      )
    ).toEqual([1, 1]);
    expect(confirmed.activeAttack?.blockDeclarationCompleted).toBe(true);
    expect(getActions(confirmed, "bob").some((a) => a.kind === "block")).toBe(
      false
    );
  });

  it("2体必須条件が消えたら防御側が元の宣言者から選び、スタックを開き直さない", () => {
    const ready = readyToBlock();
    ready.activeAttack!.blockAssignments[0]!.requiredBlockerCount = 2;
    const announced = blockTogether(ready, true);
    const pending = passPreDeclarationStack(announced);

    expect(pending.preDeclarationStackWindow).toBeNull();
    expect(
      pending.activeAttack?.blockAssignments[0]?.blockedByEntityIds
    ).toEqual([]);
    expect(getActions(pending, "alice")).toEqual([]);
    const choices = getActions(pending, "bob");
    expect(
      choices.map((action) =>
        action.kind === "resolve_block_confirmation_choice"
          ? action.sourceInstanceId
          : action.kind
      )
    ).toEqual(["blocker-1", "blocker-2"]);

    const confirmed = apply(pending, choices[1]!);
    expect(confirmed.preDeclarationStackWindow).toBeNull();
    expect(confirmed.pendingPreDeclarationConfirmation).toBeNull();
    expect(
      confirmed.activeAttack?.blockAssignments[0]?.blockedByEntityIds
    ).toEqual(["battle-entity:blocker-2"]);
    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "blocker-1")
        ?.exhaustState
    ).toBe("recovered");
    expect(
      confirmed.cardInstances.find((card) => card.instanceId === "blocker-2")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it.each([false, true])(
    "応答で B が失効した場合の再検証 (2体必須=%s)",
    (sameTarget) => {
      const ready = readyToBlock();
      if (sameTarget) {
        ready.activeAttack!.blockAssignments[0]!.requiredBlockerCount = 2;
        ready.activeContinuousEffects = [
          ...ready.activeContinuousEffects,
          {
            effectId: "test-required-blocker-count",
            sourceInstanceId: "fairy-1",
            sourceDefinitionId: ready.cardInstances.find(
              (card) => card.instanceId === "fairy-1"
            )!.definitionId,
            actingPlayerId: "alice",
            duration: { scope: "turn" },
            createdAtTurn: ready.turnNumber,
            createdAtAttackId: null,
            modifierTag: "require_multi_block",
            targetInstanceId: "alice",
            metadata: {
              filter: { category: ["spirit"] },
              requiredBlockerCount: 2,
            },
          },
        ];
      }
      const announced = blockTogether(ready, sameTarget);
      const afterResponse: GameState = {
        ...announced,
        cardInstances: announced.cardInstances.map((card) =>
          card.instanceId === "blocker-2"
            ? { ...card, exhaustState: "exhausted" }
            : card
        ),
      };
      const confirmed = passPreDeclarationStack(afterResponse);
      if (sameTarget) {
        expect(confirmed.activeAttack).toBeNull();
        expect(
          getActions(confirmed, "bob").some((a) => a.kind === "block")
        ).toBe(false);
        expect(
          confirmed.log.some((line) =>
            line.startsWith("battle:resolution:start:")
          )
        ).toBe(true);
        expect(
          confirmed.log.some((line) =>
            line.startsWith("battle:flash:open:after_block:")
          )
        ).toBe(false);
      } else {
        expect(
          confirmed.activeAttack?.blockAssignments.map(
            (a) => a.blockedByEntityIds.length
          )
        ).toEqual([1, 0]);
      }
      expect(
        confirmed.cardInstances.find((card) => card.instanceId === "blocker-1")
          ?.exhaustState
      ).toBe(sameTarget ? "recovered" : "exhausted");
    }
  );
});
