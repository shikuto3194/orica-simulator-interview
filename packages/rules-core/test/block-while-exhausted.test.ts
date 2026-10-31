/**
 * block-while-exhausted（「疲労状態でもブロックできる」付与）検証。
 *
 * ルール正源: 通常ブロックは回復状態のスピリットのみ可
 * （10_rules/02_turn-flow-and-timing.md L122「アタック/ブロック宣言後に当該スピリットは疲労する」、
 *  05_brave-and-attack-special-cases.md L114 指定アタックのみ疲労状態の強制ブロックを例外として明記）。
 * 本効果（CE modifierTag: "allow_block_while_exhausted"）を持つカードは、疲労/重疲労状態でも
 * ブロック宣言を合法化する。prevent_battle（ブロック禁止）の対概念。
 *
 * - engine: getBlockDeclarationBlockReason が、疲労状態の blocker に対し
 *   CE 無し → "source_not_ready" / CE 有り → null（合法）を返すこと。
 * - card-data: BSDB01-M01 / BSRK01-R01 / BSFT01-TR08(A) が
 *   allow_block_while_exhausted ステップを持ち、当該効果に stub が無いこと。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  confirmBlockDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  getCurrentActorPlayerIds,
  getLegalActions,
  useBlockAsAction,
  usePassPreDeclarationStackAsAction,
} from "../src/index";
import { getBlockDeclarationBlockReason } from "../src/battle/battle-availability";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import type {
  ActiveAttack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src/index";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);

function makeBattleTestCard(
  cardNo: string,
  printedCategory: CardDefinition["printedCategory"] = "spirit"
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory,
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

const ATTACKER_DEF = makeBattleTestCard("TEST-BWX-ATTACKER");
const ULTIMATE_ATTACKER_DEF = makeBattleTestCard(
  "TEST-BWX-ULTIMATE-ATTACKER",
  "ultimate"
);
const NEXUS_ATTACKER_DEF = makeBattleTestCard(
  "TEST-BWX-NEXUS-ATTACKER",
  "nexus"
);
const BRAVE_UNBLOCKABLE_DEF = makeBattleTestCard(
  "TEST-BWX-UNBLOCKABLE-BRAVE",
  "brave"
);
const BLOCKER_DEF = makeBattleTestCard("TEST-BWX-BLOCKER");

const testCardDefinitions = [
  ATTACKER_DEF,
  ULTIMATE_ATTACKER_DEF,
  NEXUS_ATTACKER_DEF,
  BRAVE_UNBLOCKABLE_DEF,
  BLOCKER_DEF,
];
const getCardDefinitionById = (id: string) =>
  testCardDefinitions.find((def) => def.cardNo === id);

/**
 * alice の attacker-1 が bob プレイヤーへアタック中、before-block flash 完了済みで
 * bob が blocker-1 でブロック宣言可能な瞬間の状態を組む。
 */
function buildBlockScenario(opts: {
  blockerExhaust: "recovered" | "exhausted" | "heavily_exhausted";
  withCE: boolean;
  attackerUnblockable?: boolean;
  unblockableParticipantIndexes?: readonly number[];
  blockerCanBlockUnblockable?: boolean;
  participantCount?: 1 | 2;
  attackerDef?: CardDefinition;
  attackerDefs?: readonly CardDefinition[];
  attachedUnblockableBraveParticipantIndexes?: readonly number[];
}): GameState {
  const participantCount = opts.participantCount ?? 1;
  const attachedUnblockableBraveParticipantIndexes =
    opts.attachedUnblockableBraveParticipantIndexes ?? [];
  const attackerDefs = Array.from(
    { length: participantCount },
    (_, index) => opts.attackerDefs?.[index] ?? opts.attackerDef ?? ATTACKER_DEF
  );
  const unblockableParticipantIndexes =
    opts.unblockableParticipantIndexes ??
    (opts.attackerUnblockable
      ? Array.from({ length: participantCount }, (_, index) => index)
      : []);
  const attackers = attackerDefs.map((attackerDef, index) =>
    createCardInstance(attackerDef, {
      instanceId: `attacker-${index + 1}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
      attachedChildrenIds: attachedUnblockableBraveParticipantIndexes.includes(
        index
      )
        ? [`brave-${index + 1}`]
        : [],
    })
  );
  const attachedBraves = attachedUnblockableBraveParticipantIndexes.map(
    (index) =>
      createCardInstance(BRAVE_UNBLOCKABLE_DEF, {
        instanceId: `brave-${index + 1}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        attachedToInstanceId: `attacker-${index + 1}`,
      })
  );
  const blocker = createCardInstance(BLOCKER_DEF, {
    instanceId: "blocker-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    cores: 1,
    exhaustState: opts.blockerExhaust,
  });

  const activeAttack: ActiveAttack = {
    attackId: "attack:be-1:1",
    primaryEntityId: "be-1",
    participantEntityIds: Array.from(
      { length: participantCount },
      (_, index) => `be-${index + 1}`
    ),
    groupMode: participantCount === 1 ? "single" : "simultaneous",
    ...(participantCount === 1 ? {} : { blockerCapacity: 1 as const }),
    target: { kind: "player", playerId: "bob" },
    blockAssignments: Array.from({ length: participantCount }, (_, index) => ({
      participantEntityId: `be-${index + 1}`,
      blockedByEntityIds: [],
    })),
    symbolResolutionOrder: Array.from(
      { length: participantCount },
      (_, index) => `be-${index + 1}`
    ),
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: false,
    flashWindowState: null,
  };

  const ces: ContinuousEffect[] = [
    ...(opts.withCE
      ? [
          {
            effectId: "ce-bwx-1",
            sourceInstanceId: "blocker-1",
            sourceDefinitionId: BLOCKER_DEF.cardNo,
            actingPlayerId: "bob",
            duration: { scope: "turn" },
            createdAtTurn: 2,
            createdAtAttackId: null,
            modifierTag: "allow_block_while_exhausted" as const,
            targetInstanceId: "blocker-1",
          },
        ]
      : []),
    ...(unblockableParticipantIndexes.length > 0
      ? attackers
          .filter((_, index) => unblockableParticipantIndexes.includes(index))
          .map((attacker) => ({
            effectId: `ce-unblockable-${attacker.instanceId}`,
            sourceInstanceId: attacker.instanceId,
            sourceDefinitionId: attacker.definitionId,
            actingPlayerId: "alice",
            duration: { scope: "turn" },
            createdAtTurn: 2,
            createdAtAttackId: null,
            modifierTag: "unblockable" as const,
            targetInstanceId: attacker.instanceId,
          }))
      : []),
    ...attachedBraves.map(
      (brave): ContinuousEffect => ({
        effectId: `ce-unblockable-${brave.instanceId}`,
        sourceInstanceId: brave.instanceId,
        sourceDefinitionId: BRAVE_UNBLOCKABLE_DEF.cardNo,
        actingPlayerId: "alice",
        duration: { scope: "turn" },
        createdAtTurn: 2,
        createdAtAttackId: null,
        modifierTag: "unblockable",
        targetInstanceId: brave.instanceId,
      })
    ),
    ...(opts.blockerCanBlockUnblockable
      ? [
          {
            effectId: "ce-block-unblockable-1",
            sourceInstanceId: "blocker-1",
            sourceDefinitionId: BLOCKER_DEF.cardNo,
            actingPlayerId: "bob",
            duration: { scope: "turn" },
            createdAtTurn: 2,
            createdAtAttackId: null,
            modifierTag: "block_unblockable" as const,
            targetInstanceId: "blocker-1",
          },
        ]
      : []),
  ];

  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [...attackers, ...attachedBraves, blocker],
    }),
    turnNumber: 2,
    activePlayerId: "alice",
    step: "attack",
    window: "declare_attack",
    activeAttack,
    activeContinuousEffects: ces,
    battleEntities: attackers.map((attacker, index) => {
      const attachedBrave = attachedBraves.find(
        (brave) => brave.attachedToInstanceId === attacker.instanceId
      );
      return {
        entityId: `be-${index + 1}`,
        resolvedBp: 3000,
        attackState: "attacking",
        resolvedSymbols: ["red"],
        memberInstanceIds: [
          attacker.instanceId,
          ...(attachedBrave ? [attachedBrave.instanceId] : []),
        ],
      };
    }),
  };
}

function blockReason(state: GameState, participantEntityId = "be-1") {
  return getBlockDeclarationBlockReason({
    state,
    actingPlayerId: "bob",
    sourceInstanceId: "blocker-1",
    participantEntityId,
    getCardDefinitionById,
  });
}

const noTriggeredEffects = () => [];

describe("block-while-exhausted: 疲労状態でもブロックできる付与", () => {
  it("回復状態の blocker は CE 無しでもブロック合法（ベースライン）", () => {
    expect(
      blockReason(
        buildBlockScenario({ blockerExhaust: "recovered", withCE: false })
      )
    ).toBeNull();
  });

  it("疲労状態の blocker は CE 無しではブロック不可 (source_not_ready)", () => {
    expect(
      blockReason(
        buildBlockScenario({ blockerExhaust: "exhausted", withCE: false })
      )
    ).toBe("source_not_ready");
  });

  it("疲労状態の blocker は CE 有りでブロック合法になる", () => {
    expect(
      blockReason(
        buildBlockScenario({ blockerExhaust: "exhausted", withCE: true })
      )
    ).toBeNull();
  });

  it("重疲労状態の blocker も CE 有りでブロック合法（裁定: 重疲労も疲労状態に含む）", () => {
    expect(
      blockReason(
        buildBlockScenario({
          blockerExhaust: "heavily_exhausted",
          withCE: true,
        })
      )
    ).toBeNull();
  });

  it("block_unblockable CE があれば『ブロックされない』参加体もブロック合法になる", () => {
    expect(
      blockReason(
        buildBlockScenario({
          blockerExhaust: "recovered",
          withCE: false,
          attackerUnblockable: true,
        })
      )
    ).toBe("attacker_unblockable");

    expect(
      blockReason(
        buildBlockScenario({
          blockerExhaust: "recovered",
          withCE: false,
          attackerUnblockable: true,
          blockerCanBlockUnblockable: true,
        })
      )
    ).toBeNull();
  });

  it("block_unblockable CE は unblockable アルティメットもブロック合法にする", () => {
    expect(
      blockReason(
        buildBlockScenario({
          blockerExhaust: "recovered",
          withCE: false,
          attackerUnblockable: true,
          blockerCanBlockUnblockable: true,
          attackerDef: ULTIMATE_ATTACKER_DEF,
        })
      )
    ).toBeNull();
  });

  it("block_unblockable CE は合体中ブレイヴ由来で unblockable の合体スピリットもブロック合法にする", () => {
    expect(
      blockReason(
        buildBlockScenario({
          blockerExhaust: "recovered",
          withCE: false,
          blockerCanBlockUnblockable: true,
          attachedUnblockableBraveParticipantIndexes: [0],
        })
      )
    ).toBeNull();
  });

  it("block_unblockable CE は unblockable 非スピリット/非アルティメット参加体を対象外にする", () => {
    expect(
      blockReason(
        buildBlockScenario({
          blockerExhaust: "recovered",
          withCE: false,
          attackerUnblockable: true,
          blockerCanBlockUnblockable: true,
          attackerDef: NEXUS_ATTACKER_DEF,
        })
      )
    ).toBe("attacker_unblockable");
  });

  it("block_unblockable CE は同時アタックのブロック数上限を増やさない", () => {
    const beforeFirstBlock = buildBlockScenario({
      blockerExhaust: "recovered",
      withCE: true,
      attackerUnblockable: true,
      blockerCanBlockUnblockable: true,
      participantCount: 2,
    });
    const tentativeState = useBlockAsAction({
      state: beforeFirstBlock,
      actingPlayerId: "bob",
      sourceInstanceId: "blocker-1",
      participantEntityId: "be-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredEffects,
      getRegisteredBurstActions: undefined,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentativeState,
      actingPlayerId: "alice",
    });
    const confirmed = confirmBlockDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById }
    );
    const afterFirstBlock: GameState = {
      ...confirmed.state,
      window: "declare_block",
    };

    expect(
      afterFirstBlock.cardInstances.find((c) => c.instanceId === "blocker-1")
        ?.exhaustState
    ).toBe("exhausted");
    expect(afterFirstBlock.activeAttack?.blockAssignments).toContainEqual({
      participantEntityId: "be-1",
      blockedByEntityIds: ["battle-entity:blocker-1"],
    });
    expect(blockReason(afterFirstBlock, "be-2")).toBe(
      "source_already_blocking"
    );
    expect(Array.from(getCurrentActorPlayerIds(afterFirstBlock))).toEqual([
      "alice",
    ]);
    const bobActions = getLegalActions({
      state: { ...afterFirstBlock, window: "declare_block" },
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredEffects,
    });
    expect(bobActions).not.toContainEqual(
      expect.objectContaining({
        kind: "block",
        sourceInstanceId: "blocker-1",
        participantEntityId: "be-2",
      })
    );
    const aliceActions = getLegalActions({
      state: { ...afterFirstBlock, window: "declare_block" },
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredEffects,
    });
    expect(aliceActions).toContainEqual(
      expect.objectContaining({
        kind: "open_battle_flash",
        flashKind: "after_block",
      })
    );
  });

  it("block_unblockable CE は通常参加体を先にブロック済みなら容量バイパスしない", () => {
    const beforeFirstBlock = buildBlockScenario({
      blockerExhaust: "recovered",
      withCE: true,
      attackerUnblockable: false,
      unblockableParticipantIndexes: [1],
      blockerCanBlockUnblockable: true,
      participantCount: 2,
    });
    const tentativeState = useBlockAsAction({
      state: beforeFirstBlock,
      actingPlayerId: "bob",
      sourceInstanceId: "blocker-1",
      participantEntityId: "be-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredEffects,
      getRegisteredBurstActions: undefined,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentativeState,
      actingPlayerId: "alice",
    });
    const confirmed = confirmBlockDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById }
    );
    const afterFirstBlock: GameState = {
      ...confirmed.state,
      window: "declare_block",
    };

    expect(blockReason(afterFirstBlock, "be-2")).toBe(
      "source_already_blocking"
    );
    expect(Array.from(getCurrentActorPlayerIds(afterFirstBlock))).toEqual([
      "alice",
    ]);
    const bobActions = getLegalActions({
      state: afterFirstBlock,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredEffects,
    });
    expect(bobActions).not.toContainEqual(
      expect.objectContaining({
        kind: "block",
        sourceInstanceId: "blocker-1",
        participantEntityId: "be-2",
      })
    );
    const aliceActions = getLegalActions({
      state: afterFirstBlock,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredEffects,
    });
    expect(aliceActions).toContainEqual(
      expect.objectContaining({
        kind: "open_battle_flash",
        flashKind: "after_block",
      })
    );
  });

  it("block_unblockable CE は残り参加体が非スピリット/非アルティメットなら actor を防御側に残さない", () => {
    const beforeFirstBlock = buildBlockScenario({
      blockerExhaust: "recovered",
      withCE: true,
      attackerUnblockable: true,
      blockerCanBlockUnblockable: true,
      participantCount: 2,
      attackerDefs: [ATTACKER_DEF, NEXUS_ATTACKER_DEF],
    });
    const tentativeState = useBlockAsAction({
      state: beforeFirstBlock,
      actingPlayerId: "bob",
      sourceInstanceId: "blocker-1",
      participantEntityId: "be-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredEffects,
      getRegisteredBurstActions: undefined,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentativeState,
      actingPlayerId: "alice",
    });
    const confirmed = confirmBlockDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById }
    );
    const afterFirstBlock: GameState = {
      ...confirmed.state,
      window: "declare_block",
    };

    expect(blockReason(afterFirstBlock, "be-2")).toBe(
      "source_already_blocking"
    );
    expect(Array.from(getCurrentActorPlayerIds(afterFirstBlock))).toEqual([
      "alice",
    ]);

    const bobActions = getLegalActions({
      state: afterFirstBlock,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredEffects,
    });
    expect(bobActions).not.toContainEqual(
      expect.objectContaining({
        kind: "block",
        sourceInstanceId: "blocker-1",
        participantEntityId: "be-2",
      })
    );

    const aliceActions = getLegalActions({
      state: afterFirstBlock,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredEffects,
    });
    expect(aliceActions).toContainEqual(
      expect.objectContaining({
        kind: "open_battle_flash",
        flashKind: "after_block",
      })
    );
  });

  it("疲労状態 blocker の宣言前スタック後再検証でも allow_block_while_exhausted を尊重する", () => {
    const tentativeState = useBlockAsAction({
      state: buildBlockScenario({ blockerExhaust: "exhausted", withCE: true }),
      actingPlayerId: "bob",
      sourceInstanceId: "blocker-1",
      participantEntityId: "be-1",
      getCardDefinitionById,
    });
    expect(tentativeState.preDeclarationStackWindow).not.toBeNull();

    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentativeState,
      actingPlayerId: "alice",
    });
    expect(afterPass.outcome).toBe("stack_closed");

    const result = confirmBlockDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById }
    );

    expect(result.state.preDeclarationStackWindow).toBeNull();
    expect(result.state.activeAttack?.blockAssignments).toContainEqual({
      participantEntityId: "be-1",
      blockedByEntityIds: ["battle-entity:blocker-1"],
    });
    expect(result.state.log).not.toContain(
      "block:cancelled:blocker-1:blocker-no-longer-valid"
    );
  });

  it("重疲労状態 blocker のブロック宣言確定は重疲労を一段階回復させない", () => {
    const tentativeState = useBlockAsAction({
      state: buildBlockScenario({
        blockerExhaust: "heavily_exhausted",
        withCE: true,
      }),
      actingPlayerId: "bob",
      sourceInstanceId: "blocker-1",
      participantEntityId: "be-1",
      getCardDefinitionById,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentativeState,
      actingPlayerId: "alice",
    });
    const result = confirmBlockDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById }
    );

    const blocker = result.state.cardInstances.find(
      (c) => c.instanceId === "blocker-1"
    );
    expect(blocker?.exhaustState).toBe("heavily_exhausted");
  });
});

describe("block-while-exhausted: card-data 配線", () => {
  it("BSDB01-M01『煌臨時』効果に allow_block_while_exhausted(self) があり stub 無し", () => {
    const card = cardNoMap.get("BSDB01-M01")!;
    const adventEff = card.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event?: string }).event === "advent"
    )!;
    expect(adventEff.stub).toBeUndefined();
    const kinds = adventEff.steps.map((s) => s.action.kind);
    expect(kinds).toContain("allow_block_while_exhausted");
    const action = adventEff.steps.find(
      (s) => s.action.kind === "allow_block_while_exhausted"
    )!.action;
    if (action.kind === "allow_block_while_exhausted") {
      expect(action.target).toEqual({ kind: "self" });
    }
  });

  it("BSRK01-R01 フラッシュ効果に allow_block_while_exhausted(剣心 all) があり stub 無し", () => {
    const card = cardNoMap.get("BSRK01-R01")!;
    const flashEff = card.effects![0]!;
    expect(flashEff.stub).toBeUndefined();
    const action = flashEff.steps.find(
      (s) => s.action.kind === "allow_block_while_exhausted"
    )!.action;
    if (action.kind === "allow_block_while_exhausted") {
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "self",
        count: "all",
      });
    }
  });

  it("BSFT01-TR08(A) フラッシュ効果に allow_block_while_exhausted(ルーシィ all) があり本体 stub 無し", () => {
    const card = cardNoMap.get("BSFT01-TR08(A)")!;
    const flashEff = card.effects!.find(
      (e) =>
        e.timing.kind === "activated" &&
        e.steps.length > 0 &&
        e.steps.some((s) => s.action.kind === "allow_block_while_exhausted")
    )!;
    // 【転醒】許可窓 (bsft01-tr-rebirth-permission-window) の合体分岐は
    // brave_combine_effect で実装済み (stub 無し)。
    expect(flashEff.stub).toBeUndefined();
    const action = flashEff.steps.find(
      (s) => s.action.kind === "allow_block_while_exhausted"
    )!.action;
    if (action.kind === "allow_block_while_exhausted") {
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "self",
        count: "all",
      });
    }
  });

  it("BSFT01-TR08(B) 星霊衣 Lv2-Lv3 は疲労ブロックと unblockable ブロック許可を両方持つ", () => {
    const card = cardNoMap.get("BSFT01-TR08(B)")!;
    const eff = card.effects!.find(
      (e) =>
        e.timing.kind === "continuous" &&
        Array.isArray(e.textRef) &&
        e.textRef.includes(7) &&
        e.textRef.includes(8)
    )!;

    expect(eff.stub).toBeUndefined();
    expect(eff.timingScope).toEqual({ player: "opponent", period: "attack" });
    const kinds = eff.steps.map((s) => s.action.kind);
    expect(kinds).toEqual([
      "bp_modify",
      "allow_block_while_exhausted",
      "block_unblockable",
    ]);
  });

  it("BSTH02-X03『魂魄 妖夢』Lv1-2 効果に destroy 耐性と allow_block_while_exhausted(self) が同居し stub 無し", () => {
    const card = cardNoMap.get("BSTH02-X03")!;
    // textRef [5,6]「相手の効果で破壊されず、疲労状態でブロックできる」の continuous 効果。
    const eff = card.effects!.find(
      (e) =>
        e.timing.kind === "continuous" &&
        Array.isArray(e.textRef) &&
        e.textRef.includes(5) &&
        e.textRef.includes(6)
    )!;
    expect(eff.stub).toBeUndefined();
    const kinds = eff.steps.map((s) => s.action.kind);
    expect(kinds).toContain("effect_resistance");
    expect(kinds).toContain("allow_block_while_exhausted");
    const action = eff.steps.find(
      (s) => s.action.kind === "allow_block_while_exhausted"
    )!.action;
    if (action.kind === "allow_block_while_exhausted") {
      expect(action.target).toEqual({ kind: "self" });
    }
  });
});
