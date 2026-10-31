/**
 * BSTH02.7-TX01(B)「グランギニョル座の怪人」B面:
 * Lv1-Lv2 アタック時、導界者「アリス・マーガトロイド」があれば、手札/手元の
 * コスト6以下マジックのフラッシュ効果を1コストでただちに使用できる。
 *
 * 原文上の「使用」はカード本体を in_use 経由で解決後に移す行為
 * (10_rules/01_glossary-and-card-types.md:9-11)。`treatAsMagicUse` は通常の使用経路へ
 * 接続し、使用前反応窓と解決後 cleanup まで通す。
 */
import { describe, expect, it } from "vitest";
import { finishCoreChoices } from "./helpers/core-choice-driver";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getLegalActions,
  recordEffectUsage,
  resolveDeferredMagicStack,
} from "../src";
import { queueRegisteredBattleImmediateEffects } from "../src/battle/battle-immediate-effect-system";
import { buildBattleImmediateEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  getEffectiveTribes,
  resolveDynamicStackNegatePreventionLevel,
} from "../src/legal/legal-actions-shared";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const definitions = new Map<string, CardDefinition>(
  ALL_CARDS.flatMap((card) => [
    card,
    ...(card.backFace ? [card.backFace] : []),
  ]).map((card) => [card.cardNo, card])
);
const TX01_B = definitions.get("BSTH02.7-TX01(B)")!;
const ALICE_NEXUS = definitions.get("BSTH02.7-CX01")!;
const LITTLE_LEGION = definitions.get("BSTH02.7-C05")!;
const SAKUYA = definitions.get("BSTH01-X05")!;
const AQUARIUS_KEY = definitions.get("BSFT01-TR01(A)")!;
const URANO_METRIA = definitions.get("BSFT01-C01")!;

const ALICE = "alice";
const BOB = "bob";
const noTriggeredLookup = () => [];

const FLASH_DONOR: CardDefinition = {
  cardNo: "TEST-BSTH02.7-TX01(B)-FLASH",
  name: "テスト用フラッシュマジック",
  printedCategory: "magic",
  colors: ["yellow"],
  cost: 6,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
      ],
      textRef: [0],
    },
  ],
};

const CONDITIONED_FLASH_DONOR: CardDefinition = {
  ...FLASH_DONOR,
  cardNo: "TEST-BSTH02.7-TX01(B)-CONDITIONED-FLASH",
  name: "条件付きテスト用フラッシュマジック",
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      condition: [{ kind: "count_value", player: "self", min: 1 }],
      steps: [],
      textRef: [0],
    },
  ],
};

const LIMITED_FLASH_DONOR: CardDefinition = {
  ...FLASH_DONOR,
  cardNo: "TEST-BSTH02.7-TX01(B)-LIMITED-FLASH",
  name: "回数制限テスト用フラッシュマジック",
};

const ATTACK_SCOPE_FLASH_DONOR: CardDefinition = {
  ...FLASH_DONOR,
  cardNo: "TEST-BSTH02.7-TX01(B)-ATTACK-SCOPE-FLASH",
  name: "時機制限テスト用フラッシュマジック",
  effects: [
    {
      ...FLASH_DONOR.effects![0]!,
      timingScope: { player: "self", period: "main" },
    },
  ],
};

const OPPONENT_SPIRIT: CardDefinition = {
  cardNo: "TEST-BSTH02.7-TX01(B)-OPPONENT",
  name: "テスト対象スピリット",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

definitions.set(FLASH_DONOR.cardNo, FLASH_DONOR);
definitions.set(CONDITIONED_FLASH_DONOR.cardNo, CONDITIONED_FLASH_DONOR);
definitions.set(LIMITED_FLASH_DONOR.cardNo, LIMITED_FLASH_DONOR);
definitions.set(ATTACK_SCOPE_FLASH_DONOR.cardNo, ATTACK_SCOPE_FLASH_DONOR);
definitions.set(OPPONENT_SPIRIT.cardNo, OPPONENT_SPIRIT);
const getCardDefinitionById = (id: string) => definitions.get(id);

function resolveDeclaredBorrowedMagic(state: GameState): GameState {
  const activeStack = state.stackWindow?.pendingStackAction;
  if (!activeStack) throw new Error("borrowed magic stack was not declared");
  return resolveDeferredMagicStack({
    state,
    // このheadless helperは未指定の選択をせず、既定枝を明示して解決する。
    activeStack: {
      ...activeStack,
      magicChoiceIndex: activeStack.magicChoiceIndex ?? 0,
    },
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noTriggeredLookup,
    getRegisteredBurstActions: undefined,
  });
}

function attackBorrowEffect() {
  return TX01_B.effects!.find((effect) => effect.textRef?.includes(2))!;
}

const getRegisteredBattleImmediateEffectActions =
  buildBattleImmediateEffectLookup([TX01_B]);

function queuedAttackEffectIndices(
  state: GameState,
  attackId: string
): readonly number[] {
  const queued = queueAttackEffects(state, attackId);
  const registrations = getRegisteredBattleImmediateEffectActions(
    TX01_B.cardNo
  )!;
  return queued.battleImmediateEffects.map(
    (prompt) => registrations[prompt.registrationIndex]!.effectIndex!
  );
}

function queueAttackEffects(state: GameState, attackId: string): GameState {
  const source = state.cardInstances.find(
    (card) => card.instanceId === "tx01-b"
  )!;
  return queueRegisteredBattleImmediateEffects({
    state: { ...state, step: "attack", activePlayerId: ALICE, turnNumber: 2 },
    attackId,
    participantEntityId: "battle-entity:tx01-b",
    actingPlayerId: ALICE,
    sourceCard: source,
    sourceDefinition: TX01_B,
    timing: "attack",
    getCardDefinitionById,
    getRegisteredBattleImmediateEffectActions,
  });
}

function passCurrentStack(
  state: GameState,
  lookups: Parameters<typeof getLegalActions>[0]
): GameState {
  const pass = [ALICE, BOB]
    .flatMap((playerId) =>
      getLegalActions({ state, actingPlayerId: playerId, ...lookups })
    )
    .find((action) => action.kind === "pass_stack");
  if (!pass) throw new Error("stack pass was not available");
  let after = applyLegalAction({ state, action: pass, ...lookups }).state;
  if (after.pendingCoreSourceAllocation) {
    const required = after.pendingCoreSourceAllocation.requiredTotal;
    const payment = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      ...lookups,
    }).find((action) => action.kind === "resolve_core_source_allocation");
    expect(payment).toBeDefined();
    after = applyLegalAction({
      state: after,
      action: payment!,
      coreSourceAllocations: { reserve: required },
      ...lookups,
    }).state;
    expect(after.pendingCoreSourceAllocation).toBeNull();
  }
  return after;
}

function resolveQueuedBorrowAttempt(
  state: GameState,
  donorInstanceId: string,
  donorDefinition: CardDefinition,
  attackId: string,
  getRegisteredMagicActionsOverride?: ReturnType<typeof buildMagicLookup>
): GameState {
  const allDefinitions = [TX01_B, ALICE_NEXUS, donorDefinition];
  const lookups = {
    getCardDefinitionById,
    getRegisteredMagicActions:
      getRegisteredMagicActionsOverride ?? buildMagicLookup(allDefinitions),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(allDefinitions),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(allDefinitions),
    getRegisteredBurstActions: buildBurstEffectLookup(allDefinitions),
    getRegisteredBattleImmediateEffectActions,
  };
  const queued = queueAttackEffects(state, attackId);
  const attackAction = getLegalActions({
    state: queued,
    actingPlayerId: ALICE,
    ...lookups,
  }).find((action) => action.kind === "resolve_battle_immediate_effect");
  if (!attackAction) throw new Error("queued attack effect was not available");
  const declared = applyLegalAction({
    state: queued,
    action: attackAction,
    targetInstanceIds: [donorInstanceId],
    ...lookups,
  }).state;
  return passCurrentStack(declared, lookups);
}

describe("BSTH02.7-TX01(B) Lv1-Lv2 アタック時の1コスト・フラッシュ使用", () => {
  const effect = attackBorrowEffect();

  it("card-data: optional なアタック時効果がアリス導界者を条件に、固定1コストから手札/手元のcost6以下flashを借用する", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(effect.applicability).toEqual({ level: { min: 1, max: 2 } });
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["nexus"],
        tribes: ["導界者"],
        cardNames: [{ contains: "アリス・マーガトロイド" }],
      },
    ]);
    expect(effect.steps[0]!.action).toEqual({ kind: "pay_cost", amount: 1 });
    expect(effect.steps[1]!.connector).toBe("conditional_cost");
    const borrow = effect.steps[1]!.action;
    expect(borrow.kind).toBe("borrow_magic_effect");
    if (borrow.kind !== "borrow_magic_effect") throw new Error("unreachable");
    expect(borrow.target).toEqual({
      kind: "filter",
      player: "self",
      zone: ["hand", "set_aside"],
      filter: {
        category: ["magic"],
        maxCost: 6,
        hasActivatedEffectMode: ["flash"],
      },
      count: 1,
    });
    expect(borrow.borrowModes).toEqual(["flash"]);
    expect(borrow.treatAsMagicUse).toBe(true);
    expect(borrow.thenMove).toBeUndefined();
  });

  it("盤面: 手元のフラッシュを1コストで借用して相手スピリットを破壊し、使用済みマジックをトラッシュへ移す", () => {
    const source = createCardInstance(TX01_B, {
      instanceId: "tx01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceNexus = createCardInstance(ALICE_NEXUS, {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const donor = createCardInstance(FLASH_DONOR, {
      instanceId: "flash-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const opponent = createCardInstance(OPPONENT_SPIRIT, {
      instanceId: "opponent-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, aliceNexus, donor, opponent],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });

    const afterDeclared = executeEffect({
      chainId: "test:bsth02-7-tx01-backface-magic-borrow:312",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      getRegisteredMagicActions: buildMagicLookup([
        TX01_B,
        ALICE_NEXUS,
        FLASH_DONOR,
        OPPONENT_SPIRIT,
      ]),
      targetInstanceIds: [donor.instanceId],
    });
    expect(
      afterDeclared.cardInstances.find(
        (card) => card.instanceId === donor.instanceId
      )?.zone
    ).toBe("in_use");
    const after = flushPendingLeaves(
      resolveDeclaredBorrowedMagic(afterDeclared),
      getCardDefinitionById
    );
    const alice = after.players.find((player) => player.id === ALICE)!;

    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(
      after.cardInstances.find((card) => card.instanceId === donor.instanceId)
        ?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === opponent.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("盤面: 手元の戦符「リトルレギオン」を借用使用すると、固有の発動元ゾーン条件で効果後に除外される", () => {
    const source = createCardInstance(TX01_B, {
      instanceId: "tx01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const aliceNexus = createCardInstance(ALICE_NEXUS, {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const littleLegion = createCardInstance(LITTLE_LEGION, {
      instanceId: "little-legion",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, aliceNexus, littleLegion],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });

    const afterDeclared = executeEffect({
      chainId: "test:bsth02-7-tx01-backface-magic-borrow:378",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      getRegisteredMagicActions: buildMagicLookup([
        TX01_B,
        ALICE_NEXUS,
        LITTLE_LEGION,
      ]),
      targetInstanceIds: [littleLegion.instanceId],
    });
    const after = flushPendingLeaves(
      resolveDeclaredBorrowedMagic(afterDeclared),
      getCardDefinitionById
    );
    const alice = after.players.find((player) => player.id === ALICE)!;

    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(
      after.cardInstances.find((card) => card.instanceId === source.instanceId)
        ?.exhaustState
    ).toBe("recovered");
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === littleLegion.instanceId
      )?.zone
    ).toBe("removed_from_game");
  });

  it("マジック登録 lookup が無ければ借用宣言を fail-closed にし、条件付きコストを巻き戻す", () => {
    const source = createCardInstance(TX01_B, {
      instanceId: "tx01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceNexus = createCardInstance(ALICE_NEXUS, {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const donor = createCardInstance(FLASH_DONOR, {
      instanceId: "unregistered-flash-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, aliceNexus, donor],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });

    const after = executeEffect({
      chainId: "test:bsth02-7-tx01-backface-magic-borrow:437",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      targetInstanceIds: [donor.instanceId],
    });

    expect(
      after.cardInstances.find((card) => card.instanceId === donor.instanceId)
        ?.zone
    ).toBe("set_aside");
    expect(
      after.players.find((player) => player.id === ALICE)!
        .reserveNormalCoreCount
    ).toBe(1);
    expect(after.log).toContain(
      `borrow_magic_effect:magic_declaration_unavailable:${FLASH_DONOR.cardNo}:0`
    );
    expect(after.log).toContain(
      `effect:conditional-cost-effect-failed:${source.instanceId}`
    );
  });

  it("登録済みのフラッシュ二択は、使用前反応窓の後に通常の choice として提示され、後半のライフ減少上限も選べる", () => {
    const source = createCardInstance(TX01_B, {
      instanceId: "tx01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceNexus = createCardInstance(ALICE_NEXUS, {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const littleLegion = createCardInstance(LITTLE_LEGION, {
      instanceId: "little-legion",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const initial: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, aliceNexus, littleLegion],
        playerOverrides: [{ reserveNormalCoreCount: 1, countValue: 1 }, {}],
      }),
      step: "attack",
    };
    const allDefinitions = [TX01_B, ALICE_NEXUS, LITTLE_LEGION];
    const lookups = {
      getCardDefinitionById,
      getRegisteredMagicActions: buildMagicLookup(allDefinitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(allDefinitions),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(allDefinitions),
      getRegisteredBurstActions: buildBurstEffectLookup(allDefinitions),
    };
    const queued = queueAttackEffects(initial, "attack-group:choice");
    const attackAction = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      ...lookups,
      getRegisteredBattleImmediateEffectActions,
    }).find((action) => action.kind === "resolve_battle_immediate_effect");
    expect(attackAction).toBeDefined();
    const afterDeclared = applyLegalAction({
      state: queued,
      action: attackAction!,
      targetInstanceIds: [littleLegion.instanceId],
      ...lookups,
      getRegisteredBattleImmediateEffectActions,
    }).state;
    const afterOuterPass = passCurrentStack(afterDeclared, {
      ...lookups,
      getRegisteredBattleImmediateEffectActions,
    });
    expect(afterOuterPass.stackWindow?.pendingStackAction).toMatchObject({
      cardDefinitionId: LITTLE_LEGION.cardNo,
      deferredChoiceIndexes: [0, 1],
    });
    const afterPass = passCurrentStack(afterOuterPass, {
      ...lookups,
      getRegisteredBattleImmediateEffectActions,
    });
    expect(
      afterPass.pendingStepChoice?.choices.map((choice) => choice.choiceIndex)
    ).toEqual([0, 1]);
    const alternate = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 1
    );
    expect(alternate).toBeDefined();
    const afterChoice = applyLegalAction({
      state: afterPass,
      action: alternate!,
      ...lookups,
    }).state;
    expect(
      afterChoice.cardInstances.find(
        (card) => card.instanceId === littleLegion.instanceId
      )?.zone
    ).toBe("removed_from_game");
    expect(
      afterChoice.activeContinuousEffects.some(
        (effect) => effect.modifierTag === "life_damage_interception"
      )
    ).toBe(true);
  });

  it("借用使用も通常の registration condition を満たさなければ、対象マジックを in_use にせずフラッシュ使用を記録しない", () => {
    const source = createCardInstance(TX01_B, {
      instanceId: "tx01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceNexus = createCardInstance(ALICE_NEXUS, {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const donor = createCardInstance(CONDITIONED_FLASH_DONOR, {
      instanceId: "conditioned-flash-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, aliceNexus, donor],
      playerOverrides: [{ reserveNormalCoreCount: 1, countValue: 0 }, {}],
    });
    const allDefinitions = [TX01_B, ALICE_NEXUS, CONDITIONED_FLASH_DONOR];
    const lookups = {
      getCardDefinitionById,
      getRegisteredMagicActions: buildMagicLookup(allDefinitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(allDefinitions),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(allDefinitions),
      getRegisteredBurstActions: buildBurstEffectLookup(allDefinitions),
      getRegisteredBattleImmediateEffectActions,
    };
    const queued = queueAttackEffects(state, "attack-group:condition");
    const attackAction = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      ...lookups,
    }).find((action) => action.kind === "resolve_battle_immediate_effect");
    expect(attackAction).toBeDefined();
    const afterDeclared = applyLegalAction({
      state: queued,
      action: attackAction!,
      targetInstanceIds: [donor.instanceId],
      ...lookups,
    }).state;
    const after = passCurrentStack(afterDeclared, lookups);

    expect(
      after.cardInstances.find((card) => card.instanceId === donor.instanceId)
        ?.zone
    ).toBe("set_aside");
    expect(after.flashCardUsageLog).toEqual([]);
    expect(after.log).toContain(
      `borrow_magic_effect:magic_registration_condition_unmet:${CONDITIONED_FLASH_DONOR.cardNo}:0`
    );
  });

  it("使用済みの〔ターンに1回〕フラッシュは production battle-immediate から再使用できず、外側の固定1コストも支払わない", () => {
    const source = createCardInstance(TX01_B, {
      instanceId: "tx01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceNexus = createCardInstance(ALICE_NEXUS, {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const donor = createCardInstance(LIMITED_FLASH_DONOR, {
      instanceId: "limited-flash-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const base: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, aliceNexus, donor],
        playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
      }),
      turnNumber: 2,
    };
    const state: GameState = {
      ...base,
      effectUsageRecords: recordEffectUsage({
        state: base,
        sourceInstanceId: donor.instanceId,
        sourceDefinitionId: LIMITED_FLASH_DONOR.cardNo,
        effectLabel: "magic",
        duration: "turn",
      }),
    };
    const baseMagicLookup = buildMagicLookup([
      TX01_B,
      ALICE_NEXUS,
      LIMITED_FLASH_DONOR,
    ]);
    const getRegisteredMagicActions: ReturnType<typeof buildMagicLookup> = (
      cardNo
    ) =>
      cardNo === LIMITED_FLASH_DONOR.cardNo
        ? baseMagicLookup(cardNo)?.map((registration) => ({
            ...registration,
            usageLimit: { kind: "per_card_name", duration: "turn" },
          }))
        : baseMagicLookup(cardNo);

    const after = resolveQueuedBorrowAttempt(
      state,
      donor.instanceId,
      LIMITED_FLASH_DONOR,
      "attack-group:limited-magic",
      getRegisteredMagicActions
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === donor.instanceId)
        ?.zone
    ).toBe("set_aside");
    expect(after.flashCardUsageLog).toEqual([]);
    expect(
      after.players.find((player) => player.id === ALICE)!
        .reserveNormalCoreCount
    ).toBe(1);
    expect(after.log).toContain(
      `borrow_magic_effect:magic_usage_limit_reached:${LIMITED_FLASH_DONOR.cardNo}:0`
    );
  });

  it("手札フラッシュ使用禁止中は借用経由でも通常の restrict_flash を迂回しない", () => {
    const source = createCardInstance(TX01_B, {
      instanceId: "tx01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceNexus = createCardInstance(ALICE_NEXUS, {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const donor = createCardInstance(FLASH_DONOR, {
      instanceId: "restricted-hand-flash-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, aliceNexus, donor],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });
    const restrictFlash: ContinuousEffect = {
      effectId: "ce:restrict-flash-hand:borrow",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: TX01_B.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: base.turnNumber,
      createdAtAttackId: null,
      modifierTag: "restrict_flash_hand",
      targetInstanceId: ALICE,
      metadata: { restrictedZones: ["hand"] },
    };

    const after = resolveQueuedBorrowAttempt(
      { ...base, activeContinuousEffects: [restrictFlash] },
      donor.instanceId,
      FLASH_DONOR,
      "attack-group:restrict-flash"
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === donor.instanceId)
        ?.zone
    ).toBe("hand");
    expect(after.flashCardUsageLog).toEqual([]);
    expect(
      after.players.find((player) => player.id === ALICE)!
        .reserveNormalCoreCount
    ).toBe(1);
    expect(after.log).toContain(
      `borrow_magic_effect:magic_flash_restricted:${FLASH_DONOR.cardNo}:hand`
    );
  });

  it("通常マジックの restrict_use と timingScope を、借用の宣言前にも評価する", () => {
    const source = createCardInstance(TX01_B, {
      instanceId: "tx01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceNexus = createCardInstance(ALICE_NEXUS, {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const useRestrictedDonor = createCardInstance(FLASH_DONOR, {
      instanceId: "restricted-use-flash-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const timingScopedDonor = createCardInstance(ATTACK_SCOPE_FLASH_DONOR, {
      instanceId: "timing-scope-flash-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        source,
        aliceNexus,
        useRestrictedDonor,
        timingScopedDonor,
      ],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });
    const restrictUse: ContinuousEffect = {
      effectId: "ce:restrict-use-magic:borrow",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: TX01_B.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: base.turnNumber,
      createdAtAttackId: null,
      modifierTag: "restrict_use",
      targetInstanceId: ALICE,
      metadata: {
        filter: { category: ["magic"] },
        restrictedKinds: ["magic"],
      },
    };
    const afterRestrictedUse = resolveQueuedBorrowAttempt(
      { ...base, activeContinuousEffects: [restrictUse] },
      useRestrictedDonor.instanceId,
      FLASH_DONOR,
      "attack-group:restrict-use"
    );
    const afterTimingScope = resolveQueuedBorrowAttempt(
      base,
      timingScopedDonor.instanceId,
      ATTACK_SCOPE_FLASH_DONOR,
      "attack-group:timing-scope"
    );

    for (const [after, donor, logEntry] of [
      [
        afterRestrictedUse,
        useRestrictedDonor,
        `borrow_magic_effect:magic_use_restricted:${FLASH_DONOR.cardNo}`,
      ],
      [
        afterTimingScope,
        timingScopedDonor,
        `borrow_magic_effect:magic_timing_scope_unmet:${ATTACK_SCOPE_FLASH_DONOR.cardNo}:0`,
      ],
    ] as const) {
      expect(
        after.cardInstances.find((card) => card.instanceId === donor.instanceId)
          ?.zone
      ).toBe("set_aside");
      expect(after.flashCardUsageLog).toEqual([]);
      expect(
        after.players.find((player) => player.id === ALICE)!
          .reserveNormalCoreCount
      ).toBe(1);
      expect(after.log).toContain(logEntry);
    }
  });

  it("借用するマジック自身の動的なスタック無効化耐性を、通常使用と同じ active stack に記録する", () => {
    const source = createCardInstance(TX01_B, {
      instanceId: "tx01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceNexus = createCardInstance(ALICE_NEXUS, {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const aquariusKey = createCardInstance(AQUARIUS_KEY, {
      instanceId: "aquarius-key",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const donor = createCardInstance(URANO_METRIA, {
      instanceId: "urano-metria",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const beforeGrant = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, aliceNexus, aquariusKey, donor],
      playerOverrides: [
        { reserveNormalCoreCount: 1, lifeNormalCoreCount: 0 },
        {},
      ],
    });
    const withKeyImmunity = executeEffect({
      chainId: "test:bsth02-7-tx01-backface-magic-borrow:876",
      state: beforeGrant,
      effect: AQUARIUS_KEY.effects![1]!,
      sourceInstanceId: aquariusKey.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });
    expect(
      withKeyImmunity.activeContinuousEffects.find(
        (effect) => effect.modifierTag === "effect_source_prevention_immunity"
      )
    ).toMatchObject({ targetInstanceId: ALICE });
    expect(
      getEffectiveTribes(
        withKeyImmunity,
        donor,
        URANO_METRIA,
        getCardDefinitionById
      )
    ).toContain("星霊");
    expect(
      resolveDynamicStackNegatePreventionLevel({
        state: withKeyImmunity,
        sourceInstanceId: donor.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      })
    ).toBe("unpreventable");

    const afterDeclared = executeEffect({
      chainId: "test:bsth02-7-tx01-backface-magic-borrow:906",
      state: withKeyImmunity,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      getRegisteredMagicActions: buildMagicLookup([
        TX01_B,
        ALICE_NEXUS,
        URANO_METRIA,
      ]),
      targetInstanceIds: [donor.instanceId],
    });
    expect(
      afterDeclared.activeContinuousEffects.some(
        (effect) => effect.modifierTag === "effect_source_prevention_immunity"
      )
    ).toBe(true);
    expect(afterDeclared.stackWindow?.pendingStackAction).toMatchObject({
      cardDefinitionId: URANO_METRIA.cardNo,
    });
    expect(
      afterDeclared.stackWindow?.pendingStackAction?.negatePreventionLevel
    ).toBe("unpreventable");
  });

  it("手元フラッシュを通常の使用として宣言するため、BSTH01-X05 の『効果発揮前』反応が先に無効化できる", () => {
    const source = createCardInstance(TX01_B, {
      instanceId: "tx01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceNexus = createCardInstance(ALICE_NEXUS, {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const donor = createCardInstance(FLASH_DONOR, {
      instanceId: "flash-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const opponent = createCardInstance(OPPONENT_SPIRIT, {
      instanceId: "opponent-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const sakuya = createCardInstance(SAKUYA, {
      instanceId: "sakuya-x05",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const initial: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, aliceNexus, donor, opponent, sakuya],
        playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
      }),
      step: "attack",
      // X05 は「自分のアタックステップ」中に相手のフラッシュへ反応するため、
      // X05 のコントローラ bob を active player にして使用者 alice と対向させる。
      activePlayerId: BOB,
    };
    const afterDeclared = executeEffect({
      chainId: "test:bsth02-7-tx01-backface-magic-borrow:977",
      state: initial,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        TX01_B,
        FLASH_DONOR,
        OPPONENT_SPIRIT,
        SAKUYA,
      ]),
      getRegisteredMagicActions: buildMagicLookup([
        TX01_B,
        ALICE_NEXUS,
        FLASH_DONOR,
        OPPONENT_SPIRIT,
        SAKUYA,
      ]),
      targetInstanceIds: [donor.instanceId],
    });

    expect(
      afterDeclared.cardInstances.find(
        (card) => card.instanceId === donor.instanceId
      )?.zone
    ).toBe("in_use");
    expect(afterDeclared.pendingPrivateDeclarations).toContainEqual(
      expect.objectContaining({
        ownerPlayerId: BOB,
        sourceInstanceId: sakuya.instanceId,
        eventKind: "flash",
      })
    );

    const allDefinitions = [
      TX01_B,
      ALICE_NEXUS,
      FLASH_DONOR,
      OPPONENT_SPIRIT,
      SAKUYA,
    ];
    const lookups = {
      getCardDefinitionById,
      getRegisteredMagicActions: buildMagicLookup(allDefinitions),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(allDefinitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(allDefinitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(allDefinitions),
      getRegisteredBurstActions: buildBurstEffectLookup(allDefinitions),
    };
    const actionKinds = [
      "declare_private_triggered_effect",
      "resolve_pending_triggered_effect",
      "resolve_pending_effect_target",
      "pass_stack",
      "pass_pre_declaration_stack",
    ];
    const trace: string[] = [];
    let current = afterDeclared;
    for (let i = 0; i < 20; i++) {
      current = finishCoreChoices(current, getCardDefinitionById, lookups);
      if (
        current.cardInstances.find(
          (card) => card.instanceId === donor.instanceId
        )?.zone === "trash"
      ) {
        break;
      }
      let advanced = false;
      for (const playerId of [ALICE, BOB]) {
        const action = getLegalActions({
          state: current,
          actingPlayerId: playerId,
          ...lookups,
        }).find((candidate) => actionKinds.includes(candidate.kind));
        if (!action) continue;
        trace.push(`${playerId}:${action.kind}`);
        current = applyLegalAction({
          state: current,
          action,
          ...lookups,
        }).state;
        advanced = true;
        break;
      }
      if (!advanced) break;
    }
    if (
      current.cardInstances.find((card) => card.instanceId === donor.instanceId)
        ?.zone !== "trash"
    ) {
      throw new Error(`borrowed flash resolution trace: ${trace.join(" -> ")}`);
    }
    expect(
      trace.some((entry) => entry.includes("declare_private_triggered_effect"))
    ).toBe(true);
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === opponent.instanceId
      )?.zone
    ).toBe("field");
    expect(
      current.cardInstances.find(
        (card) => card.instanceId === sakuya.instanceId
      )
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(
      current.players.find((p) => p.id === BOB)?.reserveNormalCoreCount
    ).toBe(
      initial.players.find((p) => p.id === BOB)!.reserveNormalCoreCount - 1
    );
  });

  it("〔ターンに1回:同名〕: 初回発揮後の二度目のアタックでは production queue に載らず、追加コスト・借用・移動を起こさない", () => {
    const source = createCardInstance(TX01_B, {
      instanceId: "tx01-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const aliceNexus = createCardInstance(ALICE_NEXUS, {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const firstDonor = createCardInstance(FLASH_DONOR, {
      instanceId: "first-flash-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const secondDonor = createCardInstance(FLASH_DONOR, {
      instanceId: "second-flash-donor",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const firstOpponent = createCardInstance(OPPONENT_SPIRIT, {
      instanceId: "first-opponent-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const secondOpponent = createCardInstance(OPPONENT_SPIRIT, {
      instanceId: "second-opponent-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const initial: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          source,
          aliceNexus,
          firstDonor,
          secondDonor,
          firstOpponent,
          secondOpponent,
        ],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      }),
      step: "attack",
      activePlayerId: ALICE,
      turnNumber: 2,
    };

    const effectIndex = TX01_B.effects!.indexOf(effect);
    expect(effectIndex).toBeGreaterThanOrEqual(0);
    expect(
      queuedAttackEffectIndices(initial, "attack-group:2:first")
    ).toContain(effectIndex);

    // executeEffect は宣言済み効果の解決 helper なので、attack 登録経路が宣言時に行う
    // usage 記録をここで同じ label で再現する。二回目は queue 自体が発生しない。
    const afterFirstDeclared = executeEffect({
      chainId: "test:bsth02-7-tx01-backface-magic-borrow:1148",
      state: initial,
      effect,
      effectIndex,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      getRegisteredMagicActions: buildMagicLookup([
        TX01_B,
        ALICE_NEXUS,
        FLASH_DONOR,
        OPPONENT_SPIRIT,
      ]),
      targetInstanceIds: [firstDonor.instanceId],
    });
    const afterFirstResolution = flushPendingLeaves(
      resolveDeclaredBorrowedMagic(afterFirstDeclared),
      getCardDefinitionById
    );
    const afterFirstUsage: GameState = {
      ...afterFirstResolution,
      effectUsageRecords: recordEffectUsage({
        state: afterFirstResolution,
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: TX01_B.cardNo,
        effectLabel: `effect:${effectIndex}`,
        duration: "turn",
      }),
    };

    expect(
      queuedAttackEffectIndices(afterFirstUsage, "attack-group:2:second")
    ).not.toContain(effectIndex);
    const alice = afterFirstUsage.players.find(
      (player) => player.id === ALICE
    )!;
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(
      afterFirstUsage.cardInstances.find(
        (card) => card.instanceId === secondDonor.instanceId
      )?.zone
    ).toBe("set_aside");
    expect(
      afterFirstUsage.cardInstances.find(
        (card) => card.instanceId === secondOpponent.instanceId
      )?.zone
    ).toBe("field");
  });
});
