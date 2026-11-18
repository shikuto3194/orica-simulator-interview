/**
 * BSAZ01 反復発揮テスト。
 * - BSAZ01-C02: 「追加で1回発揮できる」を optional repeat で任意分岐。
 * - BSAZ01-X02: `braves_on_source` DynamicCount 源（ブレイヴ数まで任意反復）。
 * BP0 になった対象だけを後段 destroy が参照することも固定する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateBattleImmediateEffectRegistrations,
  generateFieldCardEffectRegistrations,
  generateHandActivatedEffectRegistrations,
  generateMagicRegistrations,
  getEffectiveBp,
  getLegalActions,
  mergeBattleImmediateChoiceVariant,
} from "../src/runtime";
import { getStackTargetSelection } from "../src/legal/stack-target-resolution";
import type { ActiveStack, CardDefinition, GameState } from "../src/runtime";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
const GENERIC_BRAVE_DEF: CardDefinition = {
  cardNo: "TEST-BSAZ01-REPEAT-BRAVE",
  name: "テスト用ブレイヴ",
  printedCategory: "brave",
  colors: ["yellow"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
cardNoMap.set(GENERIC_BRAVE_DEF.cardNo, GENERIC_BRAVE_DEF);

/**
 * battle_immediate 効果の発揮宣言で開いたスタック窓 (02:200) を相手 pass でクローズし、
 * deferred 解決 (対象選択含む) まで進める。窓が開いていなければ素通し。
 */
function closeBattleImmediateStack(
  state: GameState,
  getRegisteredBattleImmediateEffectActions: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredBattleImmediateEffectActions"],
  getDefinition: typeof getCardDefinitionById = getCardDefinitionById
): GameState {
  if (state.window !== "stack" || state.stackWindow === null) {
    return state;
  }
  const actingPlayerId = state.stackWindow.priorityPlayerId;
  return applyLegalAction({
    state,
    action: {
      kind: "pass_stack",
      actionId: `pass:${actingPlayerId}`,
      can: true,
      reason: "test_close",
      actingPlayerId,
    },
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
    getRegisteredBattleImmediateEffectActions,
  }).state;
}

function getBattleImmediateActionsFor(
  state: GameState,
  cardNo: string,
  getRegisteredBattleImmediateEffectActions: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredBattleImmediateEffectActions"],
  sourceInstanceId?: string
) {
  return getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
    getRegisteredBattleImmediateEffectActions,
  }).filter(
    (a) =>
      a.kind === "resolve_battle_immediate_effect" &&
      a.sourceCardNo === cardNo &&
      (sourceInstanceId === undefined ||
        a.sourceInstanceId === sourceInstanceId)
  );
}

function declareAndCloseBattleImmediate(
  state: GameState,
  cardNo: string,
  getRegisteredBattleImmediateEffectActions: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredBattleImmediateEffectActions"],
  sourceInstanceId?: string
): GameState {
  const action = getBattleImmediateActionsFor(
    state,
    cardNo,
    getRegisteredBattleImmediateEffectActions,
    sourceInstanceId
  ).find((a) => a.skipOnly !== true);
  expect(action).toBeDefined();
  const declared = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
    getRegisteredBattleImmediateEffectActions,
  }).state;
  return closeBattleImmediateStack(
    declared,
    getRegisteredBattleImmediateEffectActions
  );
}

function resolveOptionalRepeatChoice(
  state: GameState,
  choiceIndex: number,
  getRegisteredBattleImmediateEffectActions: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredBattleImmediateEffectActions"]
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
    getRegisteredBattleImmediateEffectActions,
  }).find(
    (a) =>
      a.kind === "resolve_pending_effect_optional_repeat_choice" &&
      a.choiceIndex === choiceIndex
  );
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
    getRegisteredBattleImmediateEffectActions,
  }).state;
}

function resolveOptionalRepeatCount(
  state: GameState,
  countDecreaseSelection: number,
  getRegisteredBattleImmediateEffectActions: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredBattleImmediateEffectActions"]
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
    getRegisteredBattleImmediateEffectActions,
  }).find((a) => a.kind === "resolve_pending_effect_optional_repeat_count");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    countDecreaseSelection,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
    getRegisteredBattleImmediateEffectActions,
  }).state;
}

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string,
  targetInstanceIds?: string[],
  choiceIndex?: number
) {
  return executeEffect({
    chainId: "test:bsaz01-repeat-activation:199",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
    ...(targetInstanceIds ? { targetInstanceIds } : {}),
    ...(choiceIndex !== undefined ? { choiceIndex } : {}),
  });
}

const ALICE = "alice";
const BOB = "bob";
const BRAVE_CARD = "TEST-BSAZ01-REPEAT-BRAVE"; // printedCategory: "brave"

describe("BSAZ01-C02 — repeat.condition (合体中ゲート)", () => {
  const card = cardNoMap.get("BSAZ01-C02")!;
  // 累積 -3000×2 = -6000 で BP0 になる相手。Lv1 BP6000 (要 1 コア)。
  const enemyDef = cardNoMap.get("BSDB01-C04")!;

  it("カード data: アタック時 repeat は optional 追加1回で stub が消えている", () => {
    const attackEffect = card.effects![1]!;
    expect(attackEffect.timing).toEqual({
      kind: "card_event",
      event: "attack",
    });
    expect(attackEffect.stub).toBeUndefined();
    const bpStep = attackEffect.steps[0]!;
    expect(bpStep.action.kind).toBe("bp_modify");
    expect(bpStep.repeat).toEqual({
      additional: 1,
      optional: true,
      condition: [{ kind: "combined" }],
    });
  });

  it("合体中で追加を選ぶ: bp_modify を 1+1=2 回適用し BP6000 を 0 にして破壊予約", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(cardNoMap.get(BRAVE_CARD)!, {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "slep-1",
    });
    self.attachedChildrenIds = ["brave-1"];
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-0",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [self, brave, enemy],
    };
    expect(getEffectiveBp(state, enemy, enemyDef, getCardDefinitionById)).toBe(
      6000
    );

    const result = runEffect(
      state,
      card.effects![1]!,
      "slep-1",
      ALICE,
      ["enemy-0", "enemy-0"],
      1
    );
    const repeatLogs = result.log.filter((l) =>
      l.startsWith("effect:repeat-activation:")
    );
    expect(repeatLogs.length).toBe(1); // optional repeat の追加1回
    const bpLogs = result.log.filter((l) =>
      l.startsWith("effect:bp_modify:registered:enemy-0:-3000")
    );
    expect(bpLogs.length).toBe(2); // 1 + 1 回
    const after = result.cardInstances.find((c) => c.instanceId === "enemy-0")!;
    expect(
      getEffectiveBp(result, after, enemyDef, getCardDefinitionById)
    ).toBeLessThanOrEqual(0);
    expect(
      result.log.some((l) => l.startsWith("effect:destroy:alice:enemy-0"))
    ).toBe(true);
  });

  it("合体中で追加を選ぶ: 追加発揮は初回の事前選択対象を固定再利用せず再解決する", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(cardNoMap.get(BRAVE_CARD)!, {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "slep-1",
    });
    self.attachedChildrenIds = ["brave-1"];
    const firstCandidate = createCardInstance(enemyDef, {
      instanceId: "enemy-a",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const initiallySelected = createCardInstance(enemyDef, {
      instanceId: "enemy-b",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [self, brave, firstCandidate, initiallySelected],
    };

    const result = runEffect(
      state,
      card.effects![1]!,
      "slep-1",
      ALICE,
      ["enemy-b", "enemy-a"],
      1
    );

    expect(
      result.log.filter((l) =>
        l.startsWith("effect:bp_modify:registered:enemy-b:-3000")
      ).length
    ).toBe(1);
    expect(
      result.log.filter((l) =>
        l.startsWith("effect:bp_modify:registered:enemy-a:-3000")
      ).length
    ).toBe(1);
  });

  it("合体中で追加しない: bp_modify は 1 回のみ。BP6000 は破壊されず残る", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(cardNoMap.get(BRAVE_CARD)!, {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "slep-1",
    });
    self.attachedChildrenIds = ["brave-1"];
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-0",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [self, brave, enemy],
    };

    const result = runEffect(
      state,
      card.effects![1]!,
      "slep-1",
      ALICE,
      undefined,
      0
    );
    const repeatLogs = result.log.filter((l) =>
      l.startsWith("effect:repeat-activation:")
    );
    expect(repeatLogs.length).toBe(0);
    const bpLogs = result.log.filter((l) =>
      l.startsWith("effect:bp_modify:registered:enemy-0:-3000")
    );
    expect(bpLogs.length).toBe(1); // 基本 1 回のみ
    const after = result.cardInstances.find((c) => c.instanceId === "enemy-0")!;
    // -3000 のみ → BP3000 で残存 (破壊されない)。
    expect(getEffectiveBp(result, after, enemyDef, getCardDefinitionById)).toBe(
      3000
    );
    expect(after.zone).toBe("field");
  });

  it("非合体: 追加を選んでもゲート不成立で bp_modify は 1 回のみ", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-0",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [self, enemy],
    };

    const result = runEffect(
      state,
      card.effects![1]!,
      "slep-1",
      ALICE,
      ["enemy-0", "enemy-0"],
      1
    );
    const bpLogs = result.log.filter((l) =>
      l.startsWith("effect:bp_modify:registered:enemy-0:-3000")
    );
    expect(bpLogs.length).toBe(1);
    const after = result.cardInstances.find((c) => c.instanceId === "enemy-0")!;
    expect(getEffectiveBp(result, after, enemyDef, getCardDefinitionById)).toBe(
      3000
    );
    expect(after.zone).toBe("field");
  });

  it("legal action: 合体中だけ追加発揮 variant が出て、対象 step は初回 bp0 を指す", () => {
    const regs = generateBattleImmediateEffectRegistrations(card);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(cardNoMap.get(BRAVE_CARD)!, {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "slep-1",
    });
    self.attachedChildrenIds = ["brave-1"];
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-0",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [self, brave, enemy],
      battleImmediateEffects: [
        {
          promptId: "c02-attack",
          attackId: "attack-c02",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "slep-1",
          sourceDefinitionId: card.cardNo,
          sourceCardNo: card.cardNo,
          actingPlayerId: ALICE,
          participantEntityId: "battle-entity:alice:slep-1",
          registrationIndex,
        },
      ],
    };

    const battleLookup = (cardNo: string) =>
      cardNo === card.cardNo ? regs : undefined;
    const actions = getBattleImmediateActionsFor(
      state,
      card.cardNo,
      battleLookup
    );
    const fire = actions.find((a) => a.skipOnly !== true);
    expect(fire?.choiceIndex).toBeUndefined();
    expect(fire).toMatchObject({
      targetStepId: "bp0",
      requiredTargetCount: 1,
    });

    const afterStack = declareAndCloseBattleImmediate(
      state,
      card.cardNo,
      battleLookup
    );
    expect(afterStack.pendingEffectOptionalRepeatChoice).toMatchObject({
      targetStepId: "bp0",
      baseTargetCount: 1,
      maxAdditionalCount: 1,
      additionalCountSelectionMode: "repeat_count",
    });
    const afterChoice = resolveOptionalRepeatChoice(
      afterStack,
      1,
      battleLookup
    );
    expect(afterChoice.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 2,
      maxTargetCount: 2,
      allowDuplicateTargets: true,
      candidateInstanceIds: ["enemy-0"],
    });
  });

  it("pending 対象選択: 追加発揮 variant は同じ1体を2回選んで解決できる", () => {
    const regs = generateBattleImmediateEffectRegistrations(card);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(cardNoMap.get(BRAVE_CARD)!, {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "slep-1",
    });
    self.attachedChildrenIds = ["brave-1"];
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-0",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [self, brave, enemy],
      battleImmediateEffects: [
        {
          promptId: "c02-attack",
          attackId: "attack-c02",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "slep-1",
          sourceDefinitionId: card.cardNo,
          sourceCardNo: card.cardNo,
          actingPlayerId: ALICE,
          participantEntityId: "battle-entity:alice:slep-1",
          registrationIndex,
        },
      ],
    };

    const battleLookup = (cardNo: string) =>
      cardNo === card.cardNo ? regs : undefined;
    const afterStack = declareAndCloseBattleImmediate(
      state,
      card.cardNo,
      battleLookup
    );
    const declared = resolveOptionalRepeatChoice(afterStack, 1, battleLookup);
    const pending = declared.pendingEffectTargetSelection;
    expect(pending).toMatchObject({
      requiredTargetCount: 2,
      maxTargetCount: 2,
      allowDuplicateTargets: true,
    });

    const resolveTarget = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toMatchObject({
      allowDuplicateTargets: true,
      requiredTargetCount: 2,
    });

    const resolved = applyLegalAction({
      state: declared,
      action: resolveTarget!,
      targetInstanceIds: ["enemy-0", "enemy-0"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    });
    const after = resolved.state.cardInstances.find(
      (c) => c.instanceId === "enemy-0"
    )!;
    expect(
      getEffectiveBp(resolved.state, after, enemyDef, getCardDefinitionById)
    ).toBeLessThanOrEqual(0);
    expect(after.zone).toBe("trash");
    expect(resolved.state.pendingEffectTargetSelection).toBeNull();
  });

  it("pending 対象選択: スタック窓中に合体が外れたら追加発揮 choice を出さず1回分の対象だけ要求する", () => {
    const regs = generateBattleImmediateEffectRegistrations(card);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(cardNoMap.get(BRAVE_CARD)!, {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "slep-1",
    });
    self.attachedChildrenIds = ["brave-1"];
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-0",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [self, brave, enemy],
      battleImmediateEffects: [
        {
          promptId: "c02-attack",
          attackId: "attack-c02",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "slep-1",
          sourceDefinitionId: card.cardNo,
          sourceCardNo: card.cardNo,
          actingPlayerId: ALICE,
          participantEntityId: "battle-entity:alice:slep-1",
          registrationIndex,
        },
      ],
    };

    const battleLookup = (cardNo: string) =>
      cardNo === card.cardNo ? regs : undefined;
    const action = getBattleImmediateActionsFor(
      state,
      card.cardNo,
      battleLookup
    ).find((a) => a.skipOnly !== true);
    expect(action).toBeDefined();
    const declaredState = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;
    const detachedState: GameState = {
      ...declaredState,
      cardInstances: declaredState.cardInstances.map((c) => {
        if (c.instanceId === "slep-1") return { ...c, attachedChildrenIds: [] };
        if (c.instanceId === "brave-1") {
          return { ...c, attachedToInstanceId: undefined };
        }
        return c;
      }),
    };
    const declared = closeBattleImmediateStack(detachedState, battleLookup);
    expect(declared.pendingEffectOptionalRepeatChoice).toBeNull();
    expect(declared.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });

    const resolveTarget = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toMatchObject({
      requiredTargetCount: 1,
    });

    const resolved = applyLegalAction({
      state: declared,
      action: resolveTarget!,
      targetInstanceIds: ["enemy-0"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    });
    expect(resolved.state.pendingEffectTargetSelection).toBeNull();
    const repeatLogs = resolved.state.log.filter((l) =>
      l.startsWith("effect:repeat-activation:")
    );
    expect(repeatLogs.length).toBe(0);
    const bpLogs = resolved.state.log.filter((l) =>
      l.startsWith("effect:bp_modify:registered:enemy-0:-3000")
    );
    expect(bpLogs.length).toBe(1);
    const after = resolved.state.cardInstances.find(
      (c) => c.instanceId === "enemy-0"
    )!;
    expect(
      getEffectiveBp(resolved.state, after, enemyDef, getCardDefinitionById)
    ).toBe(3000);
    expect(after.zone).toBe("field");
  });

  it("legal action: 非合体では追加発揮 variant を出さない", () => {
    const regs = generateBattleImmediateEffectRegistrations(card);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-0",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [self, enemy],
      battleImmediateEffects: [
        {
          promptId: "c02-attack",
          attackId: "attack-c02",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "slep-1",
          sourceDefinitionId: card.cardNo,
          sourceCardNo: card.cardNo,
          actingPlayerId: ALICE,
          participantEntityId: "battle-entity:alice:slep-1",
          registrationIndex,
        },
      ],
    };

    const battleLookup = (cardNo: string) =>
      cardNo === card.cardNo ? regs : undefined;
    const actions = getBattleImmediateActionsFor(
      state,
      card.cardNo,
      battleLookup
    );

    expect(actions.some((a) => a.choiceIndex !== undefined)).toBe(false);
    expect(actions.find((a) => a.skipOnly !== true)).toMatchObject({
      requiredTargetCount: 1,
    });
    const afterStack = declareAndCloseBattleImmediate(
      state,
      card.cardNo,
      battleLookup
    );
    expect(afterStack.pendingEffectOptionalRepeatChoice).toBeNull();
    expect(afterStack.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
  });

  it("registration: optional repeat choices は field/hand/magic 経路でも対象2回分を公開する", () => {
    const optionalRepeatEffect = card.effects![1]!;
    const activatedEffect = {
      ...optionalRepeatEffect,
      timing: { kind: "activated", mode: "flash" },
    } as const;
    const fieldDef: CardDefinition = {
      ...card,
      cardNo: "TEST-OPTIONAL-REPEAT-FIELD",
      effects: [activatedEffect],
    };
    const handDef: CardDefinition = {
      ...card,
      cardNo: "TEST-OPTIONAL-REPEAT-HAND",
      effects: [
        {
          ...activatedEffect,
          applicability: { zone: "hand" },
        },
      ],
    };
    const magicDef: CardDefinition = {
      ...card,
      cardNo: "TEST-OPTIONAL-REPEAT-MAGIC",
      printedCategory: "magic",
      effects: [activatedEffect],
    };

    const fieldChoices =
      generateFieldCardEffectRegistrations(fieldDef)[0]!.choices;
    const handChoices =
      generateHandActivatedEffectRegistrations(handDef)[0]!.choices;
    const magicChoices = generateMagicRegistrations(magicDef)[0]!.choices;
    const battleChoices = generateBattleImmediateEffectRegistrations(card).find(
      (r) => r.effectIndex === 1
    )!.choices;
    const battleRegistration = generateBattleImmediateEffectRegistrations(
      card
    ).find((r) => r.effectIndex === 1)!;
    expect(
      mergeBattleImmediateChoiceVariant(
        battleRegistration,
        battleChoices![1]!,
        1
      ).choiceIndex
    ).toBe(1);

    for (const choices of [
      battleChoices,
      fieldChoices,
      handChoices,
      magicChoices,
    ]) {
      expect(choices).toHaveLength(2);
      expect(choices![0]).toMatchObject({
        label: "追加発揮しない",
        requiredTargetCount: 1,
        targetStepId: "bp0",
      });
      expect(choices![1]).toMatchObject({
        label: "追加発揮する",
        requiredTargetCount: 2,
        maxTargetCount: 2,
        targetStepId: "bp0",
        allowDuplicateTargets: true,
      });
    }
  });

  it("optional repeat は動的 additional も登録/実行でき、未選択なら追加しない", () => {
    const dynamicEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: { source: { kind: "braves_on_source" } },
            optional: true,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const dynamicCard = {
      ...card,
      effects: [dynamicEffect],
    } as CardDefinition;

    expect(() =>
      generateBattleImmediateEffectRegistrations(dynamicCard)
    ).not.toThrow();
    const result = runEffect(
      createEmptyGameState({ playerIds: [ALICE, BOB] }),
      dynamicEffect,
      "missing-source",
      ALICE
    );
    expect(
      result.log.filter((l) => l.startsWith("effect:repeat-activation:"))
    ).toHaveLength(0);
  });

  it("optional repeat の dynamic cap は合計対象数へ変換される", () => {
    const dynamicEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: { source: { kind: "braves_on_source" }, cap: 2 },
            optional: true,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const dynamicCard = {
      ...card,
      effects: [dynamicEffect],
    } as CardDefinition;

    const extra =
      generateBattleImmediateEffectRegistrations(dynamicCard)[0]!.choices![1]!;
    expect(extra.requiredTargetCount).toBe(2);
    expect(extra.maxTargetCountDynamic).toMatchObject({
      source: { kind: "braves_on_source" },
      multiplier: 1,
      offset: 1,
      cap: 3,
    });
  });

  it("optional repeat の divisor dynamic は floor 後の groupMultiplier で対象数へ変換される", () => {
    const dynamicEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 3,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: { source: { kind: "event_amount" }, divisor: 7 },
            optional: true,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const dynamicCard = {
      ...card,
      effects: [dynamicEffect],
    } as CardDefinition;

    const extra =
      generateBattleImmediateEffectRegistrations(dynamicCard)[0]!.choices![1]!;
    expect(extra.requiredTargetCount).toBe(6);
    expect(extra.maxTargetCountDynamic).toMatchObject({
      source: { kind: "event_amount" },
      divisor: 7,
      groupMultiplier: 3,
      offset: 3,
    });
    expect(extra.maxTargetCountDynamic).not.toHaveProperty("multiplier");
  });

  it("optional repeat の dynamic subtract は登録時に拒否する", () => {
    const dynamicEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: {
              source: { kind: "braves_on_source" },
              subtract: {
                kind: "cards_in_zone",
                zone: "hand",
                player: "self",
              },
            },
            optional: true,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const dynamicCard = {
      ...card,
      effects: [dynamicEffect],
    } as CardDefinition;

    expect(() =>
      generateBattleImmediateEffectRegistrations(dynamicCard)
    ).toThrow(/does not support subtract CountBound/);
  });

  it("optional repeat は対象個数から選択された追加回数を復元する", () => {
    const dynamicEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: 2,
            optional: true,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const enemyDef = cardNoMap.get("BSDB01-C04")!;
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-dynamic",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [enemy],
    };
    const result = executeEffect({
      chainId: "test:bsaz01-repeat-activation:1078",
      state,
      effect: dynamicEffect,
      sourceInstanceId: "missing-source",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      targetInstanceIds: ["enemy-dynamic", "enemy-dynamic"],
      choiceIndex: 1,
    });
    expect(
      result.log.filter((l) => l.startsWith("effect:repeat-activation:"))
    ).toHaveLength(1);
  });

  it("optional repeat は selected_targets 連動の count_decrease cost を対象数と同期する", () => {
    const dynamicEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount: {
              source: { kind: "selected_targets", stepId: "bp-costed" },
            },
          },
        },
        {
          id: "bp-costed",
          connector: "conditional_cost",
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: {
              source: { kind: "count_value", player: "self" },
              offset: -1,
            },
            executionAdditional: {
              source: { kind: "selected_targets", stepId: "bp-costed" },
              offset: -1,
            },
            optional: true,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const dynamicCard = {
      ...card,
      effects: [dynamicEffect],
    } as CardDefinition;

    const choices =
      generateBattleImmediateEffectRegistrations(dynamicCard)[0]!.choices!;
    expect(choices[0]).toMatchObject({
      label: "追加発揮しない",
      requiredTargetCount: 1,
      requiredCountCostAmount: 1,
      requiredCountCostPlayer: "self",
    });
    expect(choices[1]).toMatchObject({
      label: "追加発揮する",
      requiredTargetCount: 2,
      maxTargetCountDynamic: {
        source: { kind: "count_value", player: "self" },
        multiplier: 1,
        offset: 0,
      },
      requiredCountCostAmount: 2,
      requiredCountCostPlayer: "self",
      allowDuplicateTargets: true,
    });

    const enemyDef = cardNoMap.get("BSDB01-C04")!;
    const enemies = ["enemy-costed-a", "enemy-costed-b", "enemy-costed-c"].map(
      (instanceId) =>
        createCardInstance(enemyDef, {
          instanceId,
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        })
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: enemies,
        playerOverrides: [{ countValue: 3 }, { countValue: 0 }],
      }),
    };

    const result = executeEffect({
      chainId: "test:bsaz01-repeat-activation:1180",
      state,
      effect: dynamicEffect,
      sourceInstanceId: "missing-source",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      targetStepId: "bp-costed",
      targetInstanceIds: enemies.map((enemy) => enemy.instanceId),
      choiceIndex: 1,
    });

    expect(result.players.find((p) => p.id === ALICE)?.countValue).toBe(0);
    expect(
      result.log.filter((l) => l.startsWith("effect:repeat-activation:"))
    ).toHaveLength(2);
  });

  it("optional repeat は selected_targets count cost の groupMultiplier をゲートに反映する", () => {
    const dynamicEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount: {
              source: { kind: "selected_targets", stepId: "bp-costed" },
              groupMultiplier: 2,
            },
          },
        },
        {
          id: "bp-costed",
          connector: "conditional_cost",
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: {
              source: { kind: "count_value", player: "self" },
              offset: -1,
            },
            executionAdditional: {
              source: { kind: "selected_targets", stepId: "bp-costed" },
              offset: -1,
            },
            optional: true,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const dynamicCard = {
      ...card,
      effects: [dynamicEffect],
    } as CardDefinition;

    const choices =
      generateBattleImmediateEffectRegistrations(dynamicCard)[0]!.choices!;
    expect(choices[0]).toMatchObject({
      label: "追加発揮しない",
      requiredTargetCount: 1,
      requiredCountCostAmount: 2,
      requiredCountCostPlayer: "self",
    });
    expect(choices[1]).toMatchObject({
      label: "追加発揮する",
      requiredTargetCount: 2,
      requiredCountCostAmount: 4,
      requiredCountCostPlayer: "self",
      allowDuplicateTargets: true,
    });
  });

  it("selected_targets count cost gate は支払い可能数まで maxTargetCount を絞る", () => {
    const dynamicEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount: {
              source: { kind: "selected_targets", stepId: "bp-costed" },
              groupMultiplier: 2,
            },
          },
        },
        {
          id: "bp-costed",
          connector: "conditional_cost",
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: {
              source: { kind: "count_value", player: "self" },
              offset: -1,
            },
            optional: true,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const dynamicCard = {
      ...card,
      cardNo: "TEST-COUNT-COST-MAX-CAP",
      effects: [dynamicEffect],
    } as CardDefinition;
    const enemyDef = cardNoMap.get("BSDB01-C04")!;
    const source = createCardInstance(dynamicCard, {
      instanceId: "count-cost-cap-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemies = [
      "count-cost-cap-enemy-a",
      "count-cost-cap-enemy-b",
      "count-cost-cap-enemy-c",
    ].map((instanceId) =>
      createCardInstance(enemyDef, {
        instanceId,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const definitions = new Map<string, CardDefinition>([
      [dynamicCard.cardNo, dynamicCard],
      [enemyDef.cardNo, enemyDef],
    ]);
    const lookup = (id: string) =>
      definitions.get(id) ?? getCardDefinitionById(id);
    const regs = generateBattleImmediateEffectRegistrations(dynamicCard);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 0);
    const battleImmediateLookup = (cardNo: string) =>
      cardNo === dynamicCard.cardNo ? regs : undefined;

    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, ...enemies],
        playerOverrides: [{ countValue: 5 }, { countValue: 0 }],
      }),
      activePlayerId: ALICE,
      step: "attack",
      battleImmediateEffects: [
        {
          promptId: "count-cost-cap",
          attackId: "count-cost-cap-attack",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: source.instanceId,
          sourceDefinitionId: dynamicCard.cardNo,
          sourceCardNo: dynamicCard.cardNo,
          actingPlayerId: ALICE,
          participantEntityId: "battle-entity:alice:count-cost-cap-source",
          registrationIndex,
        },
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).filter(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === source.instanceId &&
        a.skipOnly !== true
    );

    const fire = actions.find((a) => a.skipOnly !== true);
    expect(fire?.choiceIndex).toBeUndefined();
    expect(fire).toMatchObject({
      requiredTargetCount: 1,
      requiredCountCostAmount: 2,
    });
    const declared = applyLegalAction({
      state,
      action: fire!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;
    const afterStack = closeBattleImmediateStack(
      declared,
      battleImmediateLookup,
      lookup
    );
    expect(afterStack.pendingEffectOptionalRepeatChoice).toMatchObject({
      maxAdditionalCount: 1,
      additionalCountSelectionMode: "count_decrease",
    });
    const afterChoice = applyLegalAction({
      state: afterStack,
      action: getLegalActions({
        state: afterStack,
        actingPlayerId: ALICE,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      }).find(
        (a) =>
          a.kind === "resolve_pending_effect_optional_repeat_choice" &&
          a.choiceIndex === 1
      )!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;
    expect(afterChoice.pendingEffectOptionalRepeatCountSelection).toMatchObject(
      {
        selectionMode: "count_decrease",
        min: 1,
        max: 1,
      }
    );
    const afterCount = applyLegalAction({
      state: afterChoice,
      action: getLegalActions({
        state: afterChoice,
        actingPlayerId: ALICE,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      }).find(
        (a) => a.kind === "resolve_pending_effect_optional_repeat_count"
      )!,
      countDecreaseSelection: 1,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;
    expect(afterCount.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 2,
      maxTargetCount: 2,
      allowDuplicateTargets: true,
    });
  });

  it("selected_targets count cost gate は targetGroups の該当 group だけを絞る", () => {
    const dynamicMagic = {
      ...card,
      cardNo: "TEST-GROUP-COUNT-COST-MAGIC",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
      effects: [],
    } as CardDefinition;
    const enemyDef = cardNoMap.get("BSDB01-C04")!;
    const source = createCardInstance(dynamicMagic, {
      instanceId: "group-count-cost-magic",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const enemies = [
      "group-count-cost-enemy-a",
      "group-count-cost-enemy-b",
      "group-count-cost-enemy-c",
    ].map((instanceId) =>
      createCardInstance(enemyDef, {
        instanceId,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const definitions = new Map<string, CardDefinition>([
      [dynamicMagic.cardNo, dynamicMagic],
      [enemyDef.cardNo, enemyDef],
    ]);
    const lookup = (id: string) =>
      definitions.get(id) ?? getCardDefinitionById(id);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, ...enemies],
        playerOverrides: [{ countValue: 5 }, { countValue: 0 }],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "main_step",
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredMagicActions: (cardNo) =>
        cardNo === dynamicMagic.cardNo
          ? [
              {
                timing: "main",
                reason: "test_group_count_cost",
                targetGroups: [
                  {
                    targetStepId: "fixed",
                    requiredTargetCount: 1,
                    maxTargetCount: 1,
                    candidateTargetZones: ["field"],
                    candidateTargetPlayerScope: "opponent",
                    targetCardFilter: { category: ["spirit"] },
                  },
                  {
                    targetStepId: "bp-costed",
                    requiredTargetCount: 2,
                    maxTargetCount: 4,
                    candidateTargetZones: ["field"],
                    candidateTargetPlayerScope: "opponent",
                    targetCardFilter: { category: ["spirit"] },
                  },
                ],
                requiredSelectedTargetsCountCost: {
                  targetStepId: "bp-costed",
                  amount: {
                    source: {
                      kind: "selected_targets",
                      stepId: "bp-costed",
                    },
                    groupMultiplier: 2,
                  },
                  player: "self",
                },
              },
            ]
          : undefined,
    }).filter(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === source.instanceId &&
        a.costMode === "paid"
    );

    expect(actions).toHaveLength(1);
    const action = actions[0]!;
    expect(action).toMatchObject({
      requiredTargetCount: 3,
      targetGroups: [
        { targetStepId: "fixed", requiredTargetCount: 1 },
        { targetStepId: "bp-costed", requiredTargetCount: 2 },
      ],
    });
    expect(action.maxTargetCount).toBeUndefined();
    expect(action.targetGroups?.[1]?.maxTargetCount).toBeUndefined();
  });

  it("selected_targets count cost gate は stack 後対象選択でも maxTargetCount を絞る", () => {
    const dynamicEffect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount: {
              source: { kind: "selected_targets", stepId: "bp-costed" },
              groupMultiplier: 2,
            },
          },
        },
        {
          id: "bp-costed",
          connector: "conditional_cost",
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: {
              source: { kind: "count_value", player: "self" },
              offset: -1,
            },
            optional: true,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const dynamicMagic = {
      ...card,
      cardNo: "TEST-STACK-COUNT-COST-MAGIC",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      effects: [dynamicEffect],
    } as CardDefinition;
    const enemyDef = cardNoMap.get("BSDB01-C04")!;
    const source = createCardInstance(dynamicMagic, {
      instanceId: "stack-count-cost-magic",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const enemies = [
      "stack-count-cost-enemy-a",
      "stack-count-cost-enemy-b",
      "stack-count-cost-enemy-c",
    ].map((instanceId) =>
      createCardInstance(enemyDef, {
        instanceId,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const definitions = new Map<string, CardDefinition>([
      [dynamicMagic.cardNo, dynamicMagic],
      [enemyDef.cardNo, enemyDef],
    ]);
    const lookup = (id: string) =>
      definitions.get(id) ?? getCardDefinitionById(id);
    const regs = generateMagicRegistrations(dynamicMagic);
    const stack: ActiveStack = {
      stackId: "stack:count-cost-magic",
      actionKind: "magic",
      chainId: "count-cost-magic",
      actingPlayerId: ALICE,
      cardInstanceId: source.instanceId,
      cardDefinitionId: dynamicMagic.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      chosenTiming: "main",
      magicChoiceIndex: 1,
      magicEffectIndex: 0,
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const selection = getStackTargetSelection(
      {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [source, ...enemies],
          playerOverrides: [{ countValue: 5 }, { countValue: 0 }],
        }),
        activePlayerId: ALICE,
        step: "main",
      },
      stack,
      {
        getCardDefinitionById: lookup,
        getRegisteredMagicActions: (cardNo) =>
          cardNo === dynamicMagic.cardNo ? regs : undefined,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }
    );

    expect(selection).toMatchObject({
      requiredTargetCount: 2,
      maxTargetCount: 2,
      allowDuplicateTargets: true,
    });
  });

  it("selected_targets count cost gate は stack 後対象選択の targetGroups-only 登録も落とさない", () => {
    const dynamicMagic = {
      ...card,
      cardNo: "TEST-STACK-GROUP-COUNT-COST-MAGIC",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
      effects: [],
    } as CardDefinition;
    const enemyDef = cardNoMap.get("BSDB01-C04")!;
    const source = createCardInstance(dynamicMagic, {
      instanceId: "stack-group-count-cost-magic",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const enemies = [
      "stack-group-count-cost-enemy-a",
      "stack-group-count-cost-enemy-b",
      "stack-group-count-cost-enemy-c",
    ].map((instanceId) =>
      createCardInstance(enemyDef, {
        instanceId,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const definitions = new Map<string, CardDefinition>([
      [dynamicMagic.cardNo, dynamicMagic],
      [enemyDef.cardNo, enemyDef],
    ]);
    const lookup = (id: string) =>
      definitions.get(id) ?? getCardDefinitionById(id);
    const stack: ActiveStack = {
      stackId: "stack:group-count-cost-magic",
      actionKind: "magic",
      chainId: "group-count-cost-magic",
      actingPlayerId: ALICE,
      cardInstanceId: source.instanceId,
      cardDefinitionId: dynamicMagic.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      chosenTiming: "main",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const selection = getStackTargetSelection(
      {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [source, ...enemies],
          playerOverrides: [{ countValue: 5 }, { countValue: 0 }],
        }),
        activePlayerId: ALICE,
        step: "main",
      },
      stack,
      {
        getCardDefinitionById: lookup,
        getRegisteredMagicActions: (cardNo) =>
          cardNo === dynamicMagic.cardNo
            ? [
                {
                  timing: "main",
                  reason: "test_stack_group_count_cost",
                  targetGroups: [
                    {
                      targetStepId: "fixed",
                      requiredTargetCount: 1,
                      maxTargetCount: 1,
                      candidateTargetZones: ["field"],
                      candidateTargetPlayerScope: "opponent",
                      targetCardFilter: { category: ["spirit"] },
                    },
                    {
                      targetStepId: "bp-costed",
                      requiredTargetCount: 2,
                      maxTargetCount: 4,
                      candidateTargetZones: ["field"],
                      candidateTargetPlayerScope: "opponent",
                      targetCardFilter: { category: ["spirit"] },
                    },
                  ],
                  requiredSelectedTargetsCountCost: {
                    targetStepId: "bp-costed",
                    amount: {
                      source: {
                        kind: "selected_targets",
                        stepId: "bp-costed",
                      },
                      groupMultiplier: 2,
                    },
                    player: "self",
                  },
                },
              ]
            : undefined,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }
    );

    expect(selection).toMatchObject({
      requiredTargetCount: 3,
      maxTargetCount: 3,
      targetGroups: [
        { targetStepId: "fixed", requiredTargetCount: 1 },
        { targetStepId: "bp-costed", requiredTargetCount: 2 },
      ],
    });
    expect(selection?.targetGroups?.[1]?.maxTargetCount).toBeUndefined();
  });

  it("selected_targets count cost execution は targetGroups の該当 group だけを数える", () => {
    const dynamicEffect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount: {
              source: { kind: "selected_targets", stepId: "bp-costed" },
              groupMultiplier: 2,
            },
          },
        },
        {
          id: "bp-costed",
          connector: "conditional_cost",
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 2,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const enemyDef = cardNoMap.get("BSDB01-C04")!;
    const enemies = [
      "exec-group-count-enemy-a",
      "exec-group-count-enemy-b",
      "exec-group-count-enemy-c",
    ].map((instanceId) =>
      createCardInstance(enemyDef, {
        instanceId,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: enemies,
        playerOverrides: [{ countValue: 6 }, { countValue: 0 }],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const result = executeEffect({
      chainId: "test:bsaz01-repeat-activation:1849",
      state,
      effect: dynamicEffect,
      sourceInstanceId: "missing-source",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      targetInstanceIds: enemies.map((enemy) => enemy.instanceId),
      targetGroups: [
        {
          targetStepId: "fixed",
          requiredTargetCount: 1,
          candidateTargetInstanceIds: [enemies[0]!.instanceId],
        },
        {
          targetStepId: "bp-costed",
          requiredTargetCount: 2,
          candidateTargetInstanceIds: [
            enemies[1]!.instanceId,
            enemies[2]!.instanceId,
          ],
        },
      ],
    });

    expect(result.players.find((p) => p.id === ALICE)?.countValue).toBe(2);
  });

  it("selected_targets count cost gate は protected count を支払い可能数から除外する", () => {
    const dynamicEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount: {
              source: { kind: "selected_targets", stepId: "bp-costed" },
              groupMultiplier: 2,
            },
          },
        },
        {
          id: "bp-costed",
          connector: "conditional_cost",
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: 1,
            optional: true,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const dynamicCard = {
      ...card,
      cardNo: "TEST-PROTECTED-COUNT-GATE",
      tribe: "サイヤ人",
      effects: [dynamicEffect],
    } as CardDefinition;
    const enemyDef = cardNoMap.get("BSDB01-C04")!;
    const source = createCardInstance(dynamicCard, {
      instanceId: "protected-count-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemies = ["protected-count-enemy-a", "protected-count-enemy-b"].map(
      (instanceId) =>
        createCardInstance(enemyDef, {
          instanceId,
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        })
    );
    const definitions = new Map<string, CardDefinition>([
      [dynamicCard.cardNo, dynamicCard],
      [enemyDef.cardNo, enemyDef],
    ]);
    const lookup = (id: string) =>
      definitions.get(id) ?? getCardDefinitionById(id);
    const regs = generateBattleImmediateEffectRegistrations(dynamicCard);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 0);
    const battleImmediateLookup = (cardNo: string) =>
      cardNo === dynamicCard.cardNo ? regs : undefined;
    const addTribeCe: GameState["activeContinuousEffects"][number] = {
      effectId: "protected-count-effective-tribe",
      sourceInstanceId: "protected-count-tribe-granter",
      sourceDefinitionId: "TEST-TRIBE-GRANTER",
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: source.instanceId,
      metadata: { properties: { addTribes: ["神喰"] } },
    };
    const actionsFor = (protectedCounts: Record<string, number>) =>
      getLegalActions({
        state: {
          ...createEmptyGameState({
            playerIds: [ALICE, BOB],
            cardInstances: [source, ...enemies],
            playerOverrides: [
              { countValue: 4, protectedCounts },
              { countValue: 0 },
            ],
          }),
          activeContinuousEffects: [addTribeCe],
          activePlayerId: ALICE,
          step: "attack",
          battleImmediateEffects: [
            {
              promptId: "protected-count-gate",
              attackId: "protected-count-attack",
              timing: "attack",
              sourceKind: "spirit",
              sourceInstanceId: source.instanceId,
              sourceDefinitionId: dynamicCard.cardNo,
              sourceCardNo: dynamicCard.cardNo,
              actingPlayerId: ALICE,
              participantEntityId: "battle-entity:alice:protected-count-source",
              registrationIndex,
            },
          ],
        },
        actingPlayerId: ALICE,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      }).filter(
        (a) =>
          a.kind === "resolve_battle_immediate_effect" &&
          a.sourceInstanceId === source.instanceId
      );

    const godEaterActions = actionsFor({ 神喰: 4 }).filter(
      (a) => a.skipOnly !== true
    );
    const saiyanActions = actionsFor({ サイヤ人: 4 }).filter(
      (a) => a.skipOnly !== true
    );
    expect(godEaterActions).toHaveLength(1);
    expect(godEaterActions[0]?.choiceIndex).toBeUndefined();
    expect(saiyanActions).toHaveLength(1);
    expect(saiyanActions[0]?.choiceIndex).toBeUndefined();
    expect(
      actionsFor({ 武竜: 4 }).filter((a) => a.skipOnly !== true)
    ).toHaveLength(0);
  });

  it("under-card effectSource の count cost gate は実行 source の printed tribe で protected count を判定する", () => {
    const underEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount: {
              source: { kind: "selected_targets", stepId: "bp-costed" },
              groupMultiplier: 2,
            },
          },
        },
        {
          id: "bp-costed",
          connector: "conditional_cost",
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            amount: -3000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: 1,
            optional: true,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const hostDef = {
      ...card,
      cardNo: "TEST-COUNT-COST-HOST",
      tribe: "サイヤ人",
      effects: [],
    } as CardDefinition;
    const underDef = {
      ...card,
      cardNo: "TEST-COUNT-COST-UNDER",
      tribe: "神喰",
      effects: [underEffect],
    } as CardDefinition;
    const enemyDef = cardNoMap.get("BSDB01-C04")!;
    const host = createCardInstance(hostDef, {
      instanceId: "count-cost-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["count-cost-under"],
    });
    const under = createCardInstance(underDef, {
      instanceId: "count-cost-under",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: host.instanceId,
    });
    const enemies = [
      "count-cost-under-enemy-a",
      "count-cost-under-enemy-b",
    ].map((instanceId) =>
      createCardInstance(enemyDef, {
        instanceId,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const definitions = new Map<string, CardDefinition>([
      [hostDef.cardNo, hostDef],
      [underDef.cardNo, underDef],
      [enemyDef.cardNo, enemyDef],
    ]);
    const lookup = (id: string) =>
      definitions.get(id) ?? getCardDefinitionById(id);
    const regs = generateBattleImmediateEffectRegistrations(underDef);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 0);
    const battleImmediateLookup = (cardNo: string) =>
      cardNo === underDef.cardNo ? regs : undefined;
    const actionsFor = (protectedCounts: Record<string, number>) =>
      getLegalActions({
        state: {
          ...createEmptyGameState({
            playerIds: [ALICE, BOB],
            cardInstances: [host, under, ...enemies],
            playerOverrides: [
              { countValue: 4, protectedCounts },
              { countValue: 0 },
            ],
          }),
          activePlayerId: ALICE,
          step: "attack",
          battleImmediateEffects: [
            {
              promptId: "count-cost-under",
              attackId: "count-cost-under-attack",
              timing: "attack",
              sourceKind: "spirit",
              sourceInstanceId: host.instanceId,
              sourceDefinitionId: hostDef.cardNo,
              sourceEffectInstanceId: under.instanceId,
              sourceEffectDefinitionId: underDef.cardNo,
              sourceCardNo: underDef.cardNo,
              actingPlayerId: ALICE,
              participantEntityId: "battle-entity:alice:count-cost-host",
              registrationIndex,
            },
          ],
        },
        actingPlayerId: ALICE,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      }).filter(
        (a) =>
          a.kind === "resolve_battle_immediate_effect" &&
          a.sourceInstanceId === host.instanceId
      );

    const godEaterActions = actionsFor({ 神喰: 4 }).filter(
      (a) => a.skipOnly !== true
    );
    expect(godEaterActions).toHaveLength(1);
    expect(godEaterActions[0]?.choiceIndex).toBeUndefined();
    expect(
      actionsFor({ サイヤ人: 4 }).filter((a) => a.skipOnly !== true)
    ).toHaveLength(0);
  });

  it("under-card effectSource の optional count cost gate は provider の実効系統で canExecute を判定する", () => {
    const underEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          executionMode: "optional",
          action: {
            kind: "count_decrease",
            player: "self",
            amount: 4,
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const hostDef = {
      ...card,
      cardNo: "TEST-OPTIONAL-COUNT-HOST",
      tribe: "サイヤ人",
      effects: [],
    } as CardDefinition;
    const underDef = {
      ...card,
      cardNo: "TEST-OPTIONAL-COUNT-UNDER",
      tribe: "神喰",
      effects: [underEffect],
    } as CardDefinition;
    const host = createCardInstance(hostDef, {
      instanceId: "optional-count-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["optional-count-under"],
    });
    const under = createCardInstance(underDef, {
      instanceId: "optional-count-under",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: host.instanceId,
    });
    const definitions = new Map<string, CardDefinition>([
      [hostDef.cardNo, hostDef],
      [underDef.cardNo, underDef],
    ]);
    const lookup = (id: string) =>
      definitions.get(id) ?? getCardDefinitionById(id);
    const canExecuteFor = (protectedCounts: Record<string, number>) =>
      executeEffect({
        chainId: "test:bsaz01-repeat-activation:2199",
        state: createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [host, under],
          playerOverrides: [
            { countValue: 4, protectedCounts },
            { countValue: 0 },
          ],
        }),
        effect: underEffect,
        sourceInstanceId: host.instanceId,
        actingPlayerId: ALICE,
        effectSourceInstanceId: under.instanceId,
        effectSourceDefinitionId: underDef.cardNo,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      }).pendingStepOptionalChoice?.canExecute;

    expect(canExecuteFor({ 神喰: 4 })).toBe(true);
    expect(canExecuteFor({ サイヤ人: 4 })).toBe(false);
  });

  it("optional repeat の追加発揮対象も後続 ref に渡る", () => {
    const dynamicEffect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          id: "bp",
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
            amount: -1000,
            duration: { scope: "turn" },
          },
          repeat: {
            additional: 1,
            optional: true,
          },
        },
        {
          action: {
            kind: "destroy",
            target: { kind: "ref", stepId: "bp" },
          },
        },
      ],
    } as NonNullable<CardDefinition["effects"]>[number];
    const enemyDef = cardNoMap.get("BSDB01-C04")!;
    const enemyA = createCardInstance(enemyDef, {
      instanceId: "enemy-ref-a",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemyB = createCardInstance(enemyDef, {
      instanceId: "enemy-ref-b",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [enemyA, enemyB],
    };

    const result = executeEffect({
      chainId: "test:bsaz01-repeat-activation:2272",
      state,
      effect: dynamicEffect,
      sourceInstanceId: "missing-source",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      targetInstanceIds: ["enemy-ref-a", "enemy-ref-b"],
      choiceIndex: 1,
    });

    const afterA = result.cardInstances.find(
      (c) => c.instanceId === "enemy-ref-a"
    )!;
    const afterB = result.cardInstances.find(
      (c) => c.instanceId === "enemy-ref-b"
    )!;
    expect(afterA.pendingLeaveKind).toBe("destroy");
    expect(afterB.pendingLeaveKind).toBe("destroy");
  });
});

describe("BSAZ01-X02 — braves_on_source (ブレイヴの数まで追加発揮)", () => {
  const card = cardNoMap.get("BSAZ01-X02")!;
  // 累積 -10000×3 = -30000 で BP0 になる相手。BSTH02-XX01 Lv3 BP30000 (要 5 コア)。
  const enemyDef = cardNoMap.get("BSTH02-XX01")!;

  // 本文対応: 「BP-10000でき」=任意発揮、「数まで追加」=基本1+任意0..N回。
  // repeat.additional は braves_on_source、後続destroyはbp0の遷移結果だけを参照。
  // N=2で同じ対象を3回選び、更新済みBP30000→20000→10000→0を通って完走する。
  it.each([0, 1, 2])(
    "BSAZ01-X02: ブレイヴN=%iの発揮宣言・窓・選択・BP0破壊を完走する",
    (braveCount) => {
      const regs = generateBattleImmediateEffectRegistrations(card);
      const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
      const source = createCardInstance(card, {
        instanceId: "audit-x02",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      // 伊奈帆 + C18の追加合体枠で、N=2もSBAに分離されない合法な合体構成。
      const braves = ["BSAZ01-CX01", "BSAZ01-C18"]
        .slice(0, braveCount)
        .map((cardNo, i) =>
          createCardInstance(cardNoMap.get(cardNo)!, {
            instanceId: `audit-brave-${i}`,
            ownerPlayerId: ALICE,
            zone: "field",
            attachedToInstanceId: source.instanceId,
          })
        );
      source.attachedChildrenIds = braves.map((b) => b.instanceId);
      const enemy = createCardInstance(enemyDef, {
        instanceId: "audit-enemy",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 5,
      });
      let state: GameState = {
        ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
        step: "attack",
        activePlayerId: ALICE,
        cardInstances: [source, ...braves, enemy],
        battleImmediateEffects: [
          {
            promptId: "audit-x02-attack",
            attackId: "audit-attack",
            timing: "attack",
            sourceKind: "spirit",
            sourceInstanceId: source.instanceId,
            sourceDefinitionId: card.cardNo,
            sourceCardNo: card.cardNo,
            actingPlayerId: ALICE,
            participantEntityId: "battle-entity:alice:audit-x02",
            registrationIndex,
          },
        ],
      };
      const lookup = (cardNo: string) =>
        cardNo === card.cardNo ? regs : undefined;
      state = declareAndCloseBattleImmediate(state, card.cardNo, lookup);
      // 対象選択とBP修正は発揮宣言に対するスタック窓の後。
      expect(
        getEffectiveBp(state, enemy, enemyDef, getCardDefinitionById)
      ).toBe(30000);
      if (braveCount > 0) {
        state = resolveOptionalRepeatChoice(state, 1, lookup);
        if (braveCount > 1)
          state = resolveOptionalRepeatCount(state, braveCount, lookup);
      } else {
        expect(state.pendingEffectOptionalRepeatChoice).toBeNull();
      }
      const resolve = getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredBattleImmediateEffectActions: lookup,
      }).find((a) => a.kind === "resolve_pending_effect_target");
      expect(resolve).toBeDefined();
      state = applyLegalAction({
        state,
        action: resolve!,
        targetInstanceIds: Array.from(
          { length: 1 + braveCount },
          () => enemy.instanceId
        ),
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredBattleImmediateEffectActions: lookup,
      }).state;
      const after = state.cardInstances.find(
        (c) => c.instanceId === enemy.instanceId
      )!;
      expect(after.zone).toBe(braveCount === 2 ? "trash" : "field");
      if (braveCount < 2) {
        expect(
          getEffectiveBp(state, after, enemyDef, getCardDefinitionById)
        ).toBe(30000 - 10000 * (1 + braveCount));
      }
      expect(
        state.log.filter((l) =>
          l.startsWith("effect:bp_modify:registered:audit-enemy:-10000")
        )
      ).toHaveLength(1 + braveCount);
      expect(state.pendingEffectTargetSelection).toBeNull();
      expect(state.pendingEffectOptionalRepeatChoice).toBeNull();
      expect(state.pendingEffectOptionalRepeatCountSelection).toBeNull();
      expect(state.pendingLeaveEntities).toHaveLength(0);
      expect(
        state.battleImmediateEffects.some(
          (p) => p.promptId === "audit-x02-attack"
        )
      ).toBe(false);
    }
  );

  it("カード data: アタック時 bp_modify に optional repeat(braves_on_source) があり stub が消えている", () => {
    const attackEffect = card.effects![1]!;
    expect(attackEffect.timing).toEqual({
      kind: "card_event",
      event: "attack",
    });
    expect(attackEffect.stub).toBeUndefined();
    const bpStep = attackEffect.steps[0]!;
    expect(bpStep.action.kind).toBe("bp_modify");
    expect(bpStep.repeat).toEqual({
      additional: { source: { kind: "braves_on_source" } },
      optional: true,
    });
  });

  it("legal action: ブレイヴ2つなら追加発揮 variant は対象1..3回分を公開する", () => {
    const regs = generateBattleImmediateEffectRegistrations(card);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-x-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const braves = [0, 1].map((i) =>
      createCardInstance(cardNoMap.get(BRAVE_CARD)!, {
        instanceId: `bravex-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "slep-x-1",
      })
    );
    self.attachedChildrenIds = braves.map((b) => b.instanceId);
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-x",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [self, ...braves, enemy],
      battleImmediateEffects: [
        {
          promptId: "x02-attack",
          attackId: "attack-x02",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "slep-x-1",
          sourceDefinitionId: card.cardNo,
          sourceCardNo: card.cardNo,
          actingPlayerId: ALICE,
          participantEntityId: "battle-entity:alice:slep-x-1",
          registrationIndex,
        },
      ],
    };

    const battleLookup = (cardNo: string) =>
      cardNo === card.cardNo ? regs : undefined;
    const actions = getBattleImmediateActionsFor(
      state,
      card.cardNo,
      battleLookup
    );
    const fire = actions.find((a) => a.skipOnly !== true);
    expect(fire?.choiceIndex).toBeUndefined();
    expect(fire).toMatchObject({
      requiredTargetCount: 1,
    });
    const afterStack = declareAndCloseBattleImmediate(
      state,
      card.cardNo,
      battleLookup
    );
    expect(afterStack.pendingEffectOptionalRepeatChoice).toMatchObject({
      baseTargetCount: 1,
      maxAdditionalCount: 2,
      additionalCountSelectionMode: "repeat_count",
    });
    const afterChoice = resolveOptionalRepeatChoice(
      afterStack,
      1,
      battleLookup
    );
    expect(afterChoice.pendingEffectOptionalRepeatCountSelection).toMatchObject(
      {
        selectionMode: "repeat_count",
        min: 1,
        max: 2,
      }
    );
    const afterOne = resolveOptionalRepeatCount(afterChoice, 1, battleLookup);
    expect(afterOne.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 2,
      maxTargetCount: 2,
      allowDuplicateTargets: true,
    });
    const afterMax = resolveOptionalRepeatCount(afterChoice, 2, battleLookup);
    expect(afterMax.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 3,
      maxTargetCount: 3,
      allowDuplicateTargets: true,
    });
  });

  it("legal action: ブレイヴ0なら追加発揮 variant を出さない", () => {
    const regs = generateBattleImmediateEffectRegistrations(card);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-x-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-x",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [self, enemy],
      battleImmediateEffects: [
        {
          promptId: "x02-attack",
          attackId: "attack-x02",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "slep-x-1",
          sourceDefinitionId: card.cardNo,
          sourceCardNo: card.cardNo,
          actingPlayerId: ALICE,
          participantEntityId: "battle-entity:alice:slep-x-1",
          registrationIndex,
        },
      ],
    };

    const battleLookup = (cardNo: string) =>
      cardNo === card.cardNo ? regs : undefined;
    const actions = getBattleImmediateActionsFor(
      state,
      card.cardNo,
      battleLookup
    );
    expect(actions.some((a) => a.choiceIndex !== undefined)).toBe(false);
    expect(actions.find((a) => a.skipOnly !== true)).toMatchObject({
      requiredTargetCount: 1,
    });
    const afterStack = declareAndCloseBattleImmediate(
      state,
      card.cardNo,
      battleLookup
    );
    expect(afterStack.pendingEffectOptionalRepeatChoice).toBeNull();
    expect(afterStack.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });
  });

  it("pending 対象選択: スタック窓中にブレイヴ数が0になったら追加発揮 choice を出さず default variant へ戻る", () => {
    const regs = generateBattleImmediateEffectRegistrations(card);
    const registrationIndex = regs.findIndex((r) => r.effectIndex === 1);
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-x-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(cardNoMap.get(BRAVE_CARD)!, {
      instanceId: "bravex-0",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "slep-x-1",
    });
    self.attachedChildrenIds = [brave.instanceId];
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-x",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [self, brave, enemy],
      battleImmediateEffects: [
        {
          promptId: "x02-attack",
          attackId: "attack-x02",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "slep-x-1",
          sourceDefinitionId: card.cardNo,
          sourceCardNo: card.cardNo,
          actingPlayerId: ALICE,
          participantEntityId: "battle-entity:alice:slep-x-1",
          registrationIndex,
        },
      ],
    };

    const battleLookup = (cardNo: string) =>
      cardNo === card.cardNo ? regs : undefined;
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).find(
      (a) => a.kind === "resolve_battle_immediate_effect" && a.skipOnly !== true
    );
    expect(action).toBeDefined();
    const declaredState = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).state;

    const detachedState: GameState = {
      ...declaredState,
      cardInstances: declaredState.cardInstances.map((c) => {
        if (c.instanceId === "slep-x-1") {
          return { ...c, attachedChildrenIds: [] };
        }
        if (c.instanceId === "bravex-0") {
          return { ...c, attachedToInstanceId: undefined };
        }
        return c;
      }),
    };
    const declared = closeBattleImmediateStack(detachedState, battleLookup);
    expect(declared.pendingEffectOptionalRepeatChoice).toBeNull();
    expect(declared.pendingEffectTargetSelection).toMatchObject({
      requiredTargetCount: 1,
      maxTargetCount: 1,
    });

    const resolveTarget = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toMatchObject({
      requiredTargetCount: 1,
    });

    const resolved = applyLegalAction({
      state: declared,
      action: resolveTarget!,
      targetInstanceIds: ["enemy-x"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredBattleImmediateEffectActions: battleLookup,
    });
    const repeatLogs = resolved.state.log.filter((l) =>
      l.startsWith("effect:repeat-activation:")
    );
    expect(repeatLogs.length).toBe(0);
    const after = resolved.state.cardInstances.find(
      (c) => c.instanceId === "enemy-x"
    )!;
    expect(
      getEffectiveBp(resolved.state, after, enemyDef, getCardDefinitionById)
    ).toBe(20000);
    expect(after.zone).toBe("field");
  });

  it("ブレイヴ2つから追加1回だけ選ぶ: bp_modify は2回で BP30000 は残る", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-x-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const braves = [0, 1].map((i) =>
      createCardInstance(cardNoMap.get(BRAVE_CARD)!, {
        instanceId: `bravex-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "slep-x-1",
      })
    );
    self.attachedChildrenIds = braves.map((b) => b.instanceId);
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-x",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [self, ...braves, enemy],
    };
    expect(getEffectiveBp(state, enemy, enemyDef, getCardDefinitionById)).toBe(
      30000
    );

    const result = runEffect(
      state,
      card.effects![1]!,
      "slep-x-1",
      ALICE,
      ["enemy-x", "enemy-x"],
      1
    );
    const repeatLogs = result.log.filter((l) =>
      l.startsWith("effect:repeat-activation:")
    );
    expect(repeatLogs.length).toBe(1);
    const bpLogs = result.log.filter((l) =>
      l.startsWith("effect:bp_modify:registered:enemy-x:-10000")
    );
    expect(bpLogs.length).toBe(2); // 1 + 選んだ追加1回
    const after = result.cardInstances.find((c) => c.instanceId === "enemy-x")!;
    expect(getEffectiveBp(result, after, enemyDef, getCardDefinitionById)).toBe(
      10000
    );
    expect(after.zone).toBe("field");
  });

  it("ブレイヴ2つから最大まで選ぶ: bp_modify を 1+2=3 回適用し BP30000 を 0 にして破壊予約", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-x-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const braves = [0, 1].map((i) =>
      createCardInstance(cardNoMap.get(BRAVE_CARD)!, {
        instanceId: `bravex-${i}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "slep-x-1",
      })
    );
    self.attachedChildrenIds = braves.map((b) => b.instanceId);
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-x",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [self, ...braves, enemy],
    };

    const result = runEffect(
      state,
      card.effects![1]!,
      "slep-x-1",
      ALICE,
      ["enemy-x", "enemy-x", "enemy-x"],
      1
    );
    const repeatLogs = result.log.filter((l) =>
      l.startsWith("effect:repeat-activation:")
    );
    expect(repeatLogs.length).toBe(2);
    const bpLogs = result.log.filter((l) =>
      l.startsWith("effect:bp_modify:registered:enemy-x:-10000")
    );
    expect(bpLogs.length).toBe(3);
    const after = result.cardInstances.find((c) => c.instanceId === "enemy-x")!;
    expect(
      getEffectiveBp(result, after, enemyDef, getCardDefinitionById)
    ).toBeLessThanOrEqual(0);
    expect(
      result.log.some((l) => l.startsWith("effect:destroy:alice:enemy-x"))
    ).toBe(true);
  });

  it("ブレイヴ0: 追加発揮なし — bp_modify は 1 回のみ。BP30000 は破壊されず残る", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(card, {
      instanceId: "slep-x-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(enemyDef, {
      instanceId: "enemy-x",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [self, enemy],
    };

    const result = runEffect(state, card.effects![1]!, "slep-x-1", ALICE);
    const repeatLogs = result.log.filter((l) =>
      l.startsWith("effect:repeat-activation:")
    );
    expect(repeatLogs.length).toBe(0);
    const bpLogs = result.log.filter((l) =>
      l.startsWith("effect:bp_modify:registered:enemy-x:-10000")
    );
    expect(bpLogs.length).toBe(1);
    const after = result.cardInstances.find((c) => c.instanceId === "enemy-x")!;
    expect(getEffectiveBp(result, after, enemyDef, getCardDefinitionById)).toBe(
      20000
    );
    expect(after.zone).toBe("field");
  });
});
