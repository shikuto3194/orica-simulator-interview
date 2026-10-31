/**
 * P2-05 Phase 5: 1 participant に複数ブロッカーを強制する型 (BSFT01-TR06(B)[7]
 * 「系統：「星霊」/「星霊魔導士」を持つ自分のスピリット/アルティメットがアタックしたとき、
 * 相手はブロックするとき、スピリット2体でないとブロックできず。ブロックされたとき、
 * それらと同時にバトルする。」) の検証。
 *
 * 正源: 10_rules/05b §複数体ブロック強制（裁定2026-07-12, 信頼度B・類推適用）。
 * - `blockedByEntityId: string|null` → `blockedByEntityIds: string[]` 型拡張。
 * - BP 比較は各ブロッカーと個別に 1vs1 で行う（合算比較ではない、公式【連刃】Q5331/Q30118 類推）。
 * - 要求数を満たせる候補が無いアタッカーはブロック宣言自体が不可能 (中間状態を作らない)。
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
  ContinuousEffect,
  GameState,
  LegalAction,
} from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
// 汎用ブロッカー用スピリット (系統: 星霊/星霊魔導士ではないので TR06(B) 自身の filter には
// 引っかからない。ブロック側候補として使う)。
const genericBlockerDefinition: CardDefinition = {
  cardNo: "TEST-P205-P5-BLOCKER",
  name: "Test Blocker",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 2,
  reductionSymbols: ["blue"],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const bpBraveDefinition: CardDefinition = {
  cardNo: "TEST-P205-P5-BP-BRAVE",
  name: "Test BP Brave",
  printedCategory: "brave",
  colors: ["blue"],
  cost: 2,
  reductionSymbols: ["blue"],
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
  id === genericBlockerDefinition.cardNo
    ? genericBlockerDefinition
    : id === bpBraveDefinition.cardNo
      ? bpBraveDefinition
      : cardNoMap.get(id);

const tr06b = card("BSFT01-TR06(B)");

/**
 * alice: TR06(B) Lv2 (cores=2) 1体 / bob: 汎用ブロッカー blockerCount 体。
 * step=attack, alice ターン。require_multi_block CE を effects[2] (textRef[7]) から手動登録する
 * (通常プレイでは continuous effect recompute が同じ登録を行う。他の allow_simultaneous_attack
 * 系テストと同じ manual executeEffect パターン)。
 */
function createMultiBlockState(options: { blockerCount: number }): GameState {
  const blockerInstances = Array.from(
    { length: options.blockerCount },
    (_, i) =>
      createCardInstance(genericBlockerDefinition, {
        instanceId: `blocker-${i + 1}`,
        ownerPlayerId: "bob",
        zone: "field",
        exhaustState: "recovered",
      })
  );
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(tr06b, {
        instanceId: "tr06b-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 2, // Lv2 (requiredCores=2)
        exhaustState: "recovered",
      }),
      ...blockerInstances,
    ],
  });
  const state: GameState = {
    ...base,
    step: "attack",
    turnNumber: 2,
    activePlayerId: "alice",
  };
  return executeEffect({
    chainId: "test:p2-05-phase5-multi-blocker:117",
    state,
    effect: tr06b.effects![2]!,
    sourceInstanceId: "tr06b-1",
    actingPlayerId: "alice",
    getCardDefinitionById,
  });
}

function getActions(state: GameState, actingPlayerId: string): LegalAction[] {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
  });
}

function apply(state: GameState, action: LegalAction): GameState {
  return applyLegalAction({
    state,
    action,
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
      a.kind === "attack" && a.sourceInstanceId === sourceInstanceId
  );
  expect(action).toBeDefined();
  return action!;
}

function passPreDeclarationStack(state: GameState): GameState {
  const priorityPlayerId = state.preDeclarationStackWindow?.priorityPlayerId;
  expect(priorityPlayerId).toBeDefined();
  const passAction = getActions(state, priorityPlayerId!).find(
    (a) => a.kind === "pass_pre_declaration_stack"
  );
  expect(passAction).toBeDefined();
  return apply(state, passAction!);
}

function declareAttack(state: GameState, sourceInstanceId: string): GameState {
  const attackAction = findAttackAction(state, sourceInstanceId);
  return passPreDeclarationStack(apply(state, attackAction));
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

describe("BSFT01-TR06(B)[7] 複数体ブロック強制", () => {
  it("effects[2] (textRef[7]) は require_multi_block CE を登録する", () => {
    const state = createMultiBlockState({ blockerCount: 3 });
    const ce = state.activeContinuousEffects.find(
      (c) => c.modifierTag === "require_multi_block"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe("alice");
    expect(ce!.metadata?.requiredBlockerCount).toBe(2);
  });

  it("require_multi_block の filter BP 条件は合体ブレイヴ込み BP で判定する", () => {
    const attacker = {
      ...createCardInstance(genericBlockerDefinition, {
        instanceId: "bp-attacker-1",
        ownerPlayerId: "alice",
        zone: "field",
        exhaustState: "recovered",
      }),
      attachedChildrenIds: ["bp-attacker-brave-1"],
    };
    const brave = {
      ...createCardInstance(bpBraveDefinition, {
        instanceId: "bp-attacker-brave-1",
        ownerPlayerId: "alice",
        zone: "field",
        exhaustState: "recovered",
      }),
      attachedToInstanceId: "bp-attacker-1",
      zoneRoleName: "brave",
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        attacker,
        brave,
        createCardInstance(genericBlockerDefinition, {
          instanceId: "bp-blocker-1",
          ownerPlayerId: "bob",
          zone: "field",
          exhaustState: "recovered",
        }),
        createCardInstance(genericBlockerDefinition, {
          instanceId: "bp-blocker-2",
          ownerPlayerId: "bob",
          zone: "field",
          exhaustState: "recovered",
        }),
      ],
    });
    const requireMultiBlock: ContinuousEffect = {
      effectId: "test-require-multi-block-max-bp",
      sourceInstanceId: "bp-attacker-1",
      sourceDefinitionId: genericBlockerDefinition.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "turn" },
      createdAtTurn: 2,
      createdAtAttackId: null,
      modifierTag: "require_multi_block",
      targetInstanceId: "alice",
      metadata: {
        filter: { category: ["spirit"], maxBp: 4000 },
        requiredBlockerCount: 2,
      },
    };
    const state = declareAttack(
      {
        ...base,
        step: "attack",
        turnNumber: 2,
        activePlayerId: "alice",
        activeContinuousEffects: [requireMultiBlock],
      },
      "bp-attacker-1"
    );

    expect(
      state.activeAttack!.blockAssignments[0]!.requiredBlockerCount
    ).toBeUndefined();
  });

  it("ブロッカー候補が2体以上いれば、declare_block を2回宣言できる (2体目以降も legal)", () => {
    let state = createMultiBlockState({ blockerCount: 3 });
    state = declareAttack(state, "tr06b-1");
    state = closeBattleFlashWindow(state); // before_block flash を閉じる

    const participantEntityId = state.activeAttack!.participantEntityIds[0]!;
    // 1体目: ブロック宣言後もまだ完了していない (canDeclareMoreBlocks が true)
    state = declareBlock(state, "blocker-1", participantEntityId);
    expect(
      state.activeAttack!.blockAssignments[0]!.blockedByEntityIds
    ).toHaveLength(1);

    // 2体目の block legal action がまだ存在する (participant がまだ unblockedParticipant 扱い)
    const secondBlockActions = getActions(state, "bob").filter(
      (a) => a.kind === "block" && a.participantEntityId === participantEntityId
    );
    expect(secondBlockActions.length).toBeGreaterThan(0);

    state = declareBlock(state, "blocker-2", participantEntityId);
    expect(
      state.activeAttack!.blockAssignments[0]!.blockedByEntityIds
    ).toHaveLength(2);
    expect(
      state.activeAttack!.blockAssignments[0]!.blockedByEntityIds
    ).toContain(
      state.battleEntities.find((e) =>
        e.memberInstanceIds.includes("blocker-1")
      )!.entityId
    );

    // 2体揃った後は、この participant への追加ブロックはもう legal ではない。
    const thirdBlockActions = getActions(state, "bob").filter(
      (a) => a.kind === "block" && a.participantEntityId === participantEntityId
    );
    expect(thirdBlockActions).toHaveLength(0);
  });

  it("require_block_if_able と 2体ブロック強制が重なっても block legal action を列挙できる", () => {
    let state = createMultiBlockState({ blockerCount: 3 });
    state = declareAttack(state, "tr06b-1");
    state = closeBattleFlashWindow(state);
    const participantEntityId = state.activeAttack!.participantEntityIds[0]!;
    const requireBlockIfAble: ContinuousEffect = {
      effectId: "test-require-block-if-able-with-multi-block",
      sourceInstanceId: "tr06b-1",
      sourceDefinitionId: tr06b.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "battle" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack!.attackId,
      modifierTag: "require_block_if_able",
      targetInstanceId: "alice",
      metadata: {
        blockerFilter: { category: ["spirit"] },
      },
    };
    state = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        requireBlockIfAble,
      ],
    };

    const blockActions = getActions(state, "bob").filter(
      (a) => a.kind === "block" && a.participantEntityId === participantEntityId
    );
    expect(blockActions).toHaveLength(3);
    expect(
      blockActions.some(
        (a) => a.kind === "block" && a.sourceInstanceId === "blocker-1"
      )
    ).toBe(true);
  });

  it("require_block_if_able の blockerFilter BP 条件は合体ブレイヴ込み BP で判定する", () => {
    let state = createMultiBlockState({ blockerCount: 0 });
    const lowBlocker = createCardInstance(genericBlockerDefinition, {
      instanceId: "low-bp-blocker-1",
      ownerPlayerId: "bob",
      zone: "field",
      exhaustState: "recovered",
    });
    const combinedBlocker = {
      ...createCardInstance(genericBlockerDefinition, {
        instanceId: "combined-bp-blocker-1",
        ownerPlayerId: "bob",
        zone: "field",
        exhaustState: "recovered",
      }),
      attachedChildrenIds: ["combined-bp-brave-1"],
    };
    const brave = {
      ...createCardInstance(bpBraveDefinition, {
        instanceId: "combined-bp-brave-1",
        ownerPlayerId: "bob",
        zone: "field",
        exhaustState: "recovered",
      }),
      attachedToInstanceId: "combined-bp-blocker-1",
      zoneRoleName: "brave",
    };
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        lowBlocker,
        combinedBlocker,
        brave,
      ],
    };
    state = declareAttack(state, "tr06b-1");
    state = closeBattleFlashWindow(state);
    const participantEntityId = state.activeAttack!.participantEntityIds[0]!;
    const requireBlockIfAble: ContinuousEffect = {
      effectId: "test-require-block-if-able-max-bp",
      sourceInstanceId: "tr06b-1",
      sourceDefinitionId: tr06b.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "battle" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack!.attackId,
      modifierTag: "require_block_if_able",
      targetInstanceId: "alice",
      metadata: {
        blockerFilter: { category: ["spirit"], maxBp: 4000 },
      },
    };
    state = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        requireBlockIfAble,
      ],
    };

    const blockActions = getActions(state, "bob").filter(
      (a) => a.kind === "block" && a.participantEntityId === participantEntityId
    );
    expect(
      blockActions.some(
        (a) => a.kind === "block" && a.sourceInstanceId === "low-bp-blocker-1"
      )
    ).toBe(true);
    expect(
      blockActions.some(
        (a) =>
          a.kind === "block" && a.sourceInstanceId === "combined-bp-blocker-1"
      )
    ).toBe(false);
  });

  it("ブロッカー候補が1体しかいないとき、そのアタッカーへの block は一切 legal にならない (中間状態を作らない)", () => {
    let state = createMultiBlockState({ blockerCount: 1 });
    state = declareAttack(state, "tr06b-1");
    state = closeBattleFlashWindow(state); // before_block flash を閉じる

    const blockActions = getActions(state, "bob").filter(
      (a) => a.kind === "block"
    );
    expect(blockActions).toHaveLength(0);
  });

  it("[board] 2体ブロック成立後の BP 比較は個別 1vs1 (合算比較ではない): 両ブロッカーが個別に破壊される", () => {
    let state = createMultiBlockState({ blockerCount: 3 });
    // BP: tr06b-1 (Lv2, 6000) vs blocker-1/2 (各3000) → 個別比較なら両方とも
    // attacker の方が高いため、両ブロッカーとも破壊され、attacker は生存する
    // (「2体それぞれ破壊される」= 個別ループが両方回っていることの検証)。
    state = declareAttack(state, "tr06b-1");
    state = closeBattleFlashWindow(state); // before_block flash を閉じる
    const participantEntityId = state.activeAttack!.participantEntityIds[0]!;
    state = declareBlock(state, "blocker-1", participantEntityId);
    state = declareBlock(state, "blocker-2", participantEntityId);
    // after_block flash を閉じると自動でバトル解決する。
    state = closeBattleFlashWindow(state);

    const blocker1 = state.cardInstances.find(
      (c) => c.instanceId === "blocker-1"
    );
    const blocker2 = state.cardInstances.find(
      (c) => c.instanceId === "blocker-2"
    );
    const attacker = state.cardInstances.find(
      (c) => c.instanceId === "tr06b-1"
    );
    // 破壊された両ブロッカーはトラッシュへ (フィールドから離脱)、attacker (BP6000) は
    // 両方 (BP3000) より高いため生存してフィールドに残る。
    expect(blocker1?.zone).toBe("trash");
    expect(blocker2?.zone).toBe("trash");
    expect(attacker?.zone).toBe("field");
  });
});
