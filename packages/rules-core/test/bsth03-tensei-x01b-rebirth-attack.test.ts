/**
 * BSTH03-転醒X01(B) 上白沢 慧音-白澤- の裏面[2,3] 『このスピリットの転醒/アタック時』
 * 相手1体除外効果が、転醒 (rebirth) とアタック (attack) の両方で発火することを検証する
 * 回帰テスト。
 *
 * 旧 stub: 「転醒時timingはon_attackで近似。」=
 *   event: "attack" 単独で、転醒直後 (flip→back face 切り替え時) には発火しなかった。
 * 修正後: event: ["rebirth", "attack"] = rebirth/attack いずれでも誘発候補に乗る。
 *
 * ルール正源: 10_rules/08a §転醒、card_event:"rebirth" は executeRebirth が flip 後に
 * dispatch する SSOT (trigger-system L2298-2333)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  executeEffectResistance,
  expandCardDefinitionsWithBackFaces,
  flushPendingLeaves,
  collectGameStateInvariantIssues,
  getLegalActions,
  queueRegisteredBattleImmediateEffects,
} from "../src";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
} from "../src/effect/trigger-system";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  getCandidateTargetInstanceIds,
  isCardUseRestricted,
} from "../src/legal/legal-actions-shared";
import type {
  ActiveAttack,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
  RebirthAction,
} from "../src";

const byCardNo = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const noLookup = () => [];

function soulCoreSelfEffectImmunityCE(
  targetPlayerId = "alice"
): ContinuousEffect {
  return {
    effectId: `test-soul-core-effect-immunity-${targetPlayerId}`,
    sourceInstanceId: "bs57-source",
    sourceDefinitionId: "BS57-011",
    actingPlayerId: "bob",
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "soul_core_effect_immunity",
    targetInstanceId: targetPlayerId,
    metadata: { sourcePlayerScope: "self" },
  };
}

function lifeDiscardGateCE(
  sourceInstanceId: string,
  sourceDefinitionId: string
): ContinuousEffect {
  return {
    effectId: `test-life-discard-gate-${sourceInstanceId}`,
    sourceInstanceId,
    sourceDefinitionId,
    actingPlayerId: "alice",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "life_damage_interception",
    targetInstanceId: "alice",
    metadata: {
      cause: "any",
      mode: "replace",
      discardCostGate: { zones: ["hand"] },
    },
  };
}

describe("BSTH03-転醒X01(B) 上白沢 慧音-白澤-（裏面 転醒/アタック時）", () => {
  const front = byCardNo.get("BSTH03-転醒X01(A)")!;
  const back = front.backFace!;

  it("A面[2] 転醒(アタック時・ソウルコアを置いて裏返す): attack optional + possible soul placement + rebirth", () => {
    const rebirthEffect = front.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
    )!;
    expect(rebirthEffect.stub).toBeUndefined();
    expect(rebirthEffect.timing).toEqual({
      kind: "card_event",
      event: "attack",
    });
    expect(rebirthEffect.executionMode).toBe("optional");
    expect(rebirthEffect.applicability).toEqual({ level: { min: 2 } });
    expect(rebirthEffect.condition).toEqual([
      { kind: "count_value", player: "self", max: 5 },
    ]);
    const soulSteps = rebirthEffect.steps.filter(
      (step) => step.action.kind === "core_move"
    );
    expect(soulSteps.map((step) => step.action)).toEqual([
      {
        kind: "core_move",
        from: { kind: "field", player: "self" },
        to: { kind: "this_card" },
        amount: "all",
        effectKind: "explicit_soul_core",
      },
      {
        kind: "core_move",
        from: { kind: "reserve", player: "self" },
        to: { kind: "this_card" },
        amount: "all",
        effectKind: "explicit_soul_core",
      },
      {
        kind: "core_move",
        from: { kind: "trash", player: "self" },
        to: { kind: "this_card" },
        amount: "all",
        effectKind: "explicit_soul_core",
      },
      {
        kind: "core_move",
        from: { kind: "life", player: "self" },
        to: { kind: "this_card" },
        amount: "all",
        effectKind: "explicit_soul_core",
      },
    ]);
    expect(soulSteps.map((step) => step.stepCondition)).toEqual([
      { kind: "rebirth_precheck", maxCount: 5 },
      { kind: "rebirth_precheck", maxCount: 5 },
      { kind: "rebirth_precheck", maxCount: 5 },
      { kind: "rebirth_precheck", maxCount: 5 },
    ]);
    const rebirthSteps = rebirthEffect.steps.filter(
      (step) => step.action.kind === "rebirth"
    );
    expect(rebirthSteps).toHaveLength(1);
    expect(rebirthSteps[0]).toMatchObject({
      action: {
        kind: "rebirth",
        maxCount: 5,
        vanishAfterFlipOnLvDeficit: true,
      },
    });
    expect(rebirthSteps[0]!.stepCondition).toBeUndefined();
  });

  it("A面[2] を解決すると、リザーブのソウルコアを置いて A→B へ転醒する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = frontDef.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
    )!;
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-soul-cost",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
      playerOverrides: [
        { countValue: 0, soulCoreLocation: { kind: "reserve" } },
        {},
      ],
    });

    const result = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:186",
      state,
      effect,
      sourceInstanceId: "keine-front-soul-cost",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => map.get(id),
    });

    const flipped = result.cardInstances.find(
      (c) => c.instanceId === "keine-front-soul-cost"
    )!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(flipped.normalCoreCount).toBe(3);
    expect(flipped.soulCoreCount).toBe(1);
    expect(
      result.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "keine-front-soul-cost" });
    expect(result.players.find((p) => p.id === "alice")!.countValue).toBe(1);
  });

  it("A面[2] は複数ソウルを可能な限り置いて A→B へ転醒する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = frontDef.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
    )!;
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-multiple-soul-cost",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const primaryHost = createCardInstance(frontDef, {
      instanceId: "alice-primary-soul-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const extraFieldHost = createCardInstance(frontDef, {
      instanceId: "alice-extra-field-soul-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      soulCoreCount: 1,
    });
    const mixedOwnerFieldHost = createCardInstance(frontDef, {
      instanceId: "alice-controlled-bob-primary-soul-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      soulCoreCount: 2,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst, primaryHost, extraFieldHost, mixedOwnerFieldHost],
      playerOverrides: [
        {
          countValue: 0,
          soulCoreLocation: {
            kind: "card",
            instanceId: "alice-primary-soul-host",
          },
          reserveSoulCoreCount: 2,
          trashSoulCoreCount: 2,
          lifeSoulCoreCount: 2,
        },
        {
          soulCoreLocation: {
            kind: "card",
            instanceId: "alice-controlled-bob-primary-soul-host",
          },
        },
      ],
    });

    const result = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:266",
      state,
      effect,
      sourceInstanceId: "keine-front-multiple-soul-cost",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => map.get(id),
    });

    const flipped = result.cardInstances.find(
      (c) => c.instanceId === "keine-front-multiple-soul-cost"
    )!;
    const primaryHostAfter = result.cardInstances.find(
      (c) => c.instanceId === "alice-primary-soul-host"
    )!;
    const extraFieldHostAfter = result.cardInstances.find(
      (c) => c.instanceId === "alice-extra-field-soul-host"
    )!;
    const mixedOwnerFieldHostAfter = result.cardInstances.find(
      (c) => c.instanceId === "alice-controlled-bob-primary-soul-host"
    )!;
    const alice = result.players.find((p) => p.id === "alice")!;
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(flipped.soulCoreCount).toBe(9);
    expect(primaryHostAfter.soulCoreCount).toBe(0);
    expect(extraFieldHostAfter.soulCoreCount).toBe(0);
    expect(mixedOwnerFieldHostAfter.soulCoreCount).toBe(1);
    expect(alice.reserveSoulCoreCount).toBe(0);
    expect(alice.trashSoulCoreCount).toBe(0);
    expect(alice.lifeSoulCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "keine-front-multiple-soul-cost",
    });
    expect(bob.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "alice-controlled-bob-primary-soul-host",
    });
    expect(collectGameStateInvariantIssues(result)).toEqual([]);
  });

  it("A面[2] は同一タイミングで既に転醒済みならソウルコア配置だけを残さない", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = frontDef.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
    )!;
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-same-timing",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [inst],
        playerOverrides: [
          {
            countValue: 0,
            soulCoreLocation: { kind: "reserve" },
            reserveSoulCoreCount: 1,
          },
          {},
        ],
      }),
      actionStartLogIndex: 0,
      log: [
        "effect:rebirth:other-front:flip_to:OTHER(B):retain=1:return=0:reserve",
      ],
    };

    const result = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:340",
      state,
      effect,
      sourceInstanceId: "keine-front-same-timing",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => map.get(id),
    });

    const sourceAfter = result.cardInstances.find(
      (c) => c.instanceId === "keine-front-same-timing"
    )!;
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(sourceAfter.definitionId).toBe("BSTH03-転醒X01(A)");
    expect(sourceAfter.soulCoreCount).toBe(0);
    expect(alice.reserveSoulCoreCount).toBe(1);
    expect(alice.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(
      result.log.some((l) => l.includes("core_move:explicit_soul_core"))
    ).toBe(false);
    expect(result.log).toContain(
      "effect:rebirth:keine-front-same-timing:blocked:same-timing"
    );
  });

  it("A面[2] は battle immediate legal action 経由で宣言→スタック後に A→B へ転醒する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const getDefinition = (id: string): CardDefinition | undefined =>
      map.get(id);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(expanded);
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-legal-success",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
      playerOverrides: [
        { countValue: 0, soulCoreLocation: { kind: "reserve" } },
        {},
      ],
    });
    const lookupOptions = {
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(expanded),
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    };

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-keine-legal-success",
      participantEntityId: "battle-entity:keine-front-legal-success",
      actingPlayerId: "alice",
      sourceCard: inst,
      sourceDefinition: frontDef,
      timing: "attack",
      getCardDefinitionById: getDefinition,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    const declaration = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === "keine-front-legal-success" &&
        a.skipOnly !== true
    );
    expect(declaration).toMatchObject({ executionMode: "optional" });

    const declared = applyLegalAction({
      state: queued,
      action: declaration!,
      ...lookupOptions,
    }).state;
    expect(declared.battleImmediateEffects).toEqual([]);
    expect(declared.window).toBe("stack");
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "battle_immediate_effect"
    );

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      ...lookupOptions,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();

    const resolved = applyLegalAction({
      state: declared,
      action: pass!,
      ...lookupOptions,
    }).state;
    const flipped = resolved.cardInstances.find(
      (c) => c.instanceId === "keine-front-legal-success"
    )!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(flipped.normalCoreCount).toBe(3);
    expect(flipped.soulCoreCount).toBe(1);
    expect(
      resolved.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "keine-front-legal-success" });
    expect(resolved.players.find((p) => p.id === "alice")!.countValue).toBe(1);
    expect(resolved.battleImmediateEffects).toEqual([]);
  });

  it("A面[2] はLv1では attack immediate prompt/legal action を生成しない", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const getDefinition = (id: string): CardDefinition | undefined =>
      map.get(id);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(expanded);
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-lv1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [inst],
        playerOverrides: [
          { countValue: 0, soulCoreLocation: { kind: "reserve" } },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
    };

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-keine-lv1",
      participantEntityId: "battle-entity:keine-front-lv1",
      actingPlayerId: "alice",
      sourceCard: inst,
      sourceDefinition: frontDef,
      timing: "attack",
      getCardDefinitionById: getDefinition,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    expect(
      queued.battleImmediateEffects.some(
        (prompt) => prompt.sourceInstanceId === "keine-front-lv1"
      )
    ).toBe(false);
    const legalActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    });
    expect(
      legalActions.some(
        (a) =>
          a.kind === "resolve_battle_immediate_effect" &&
          a.sourceInstanceId === "keine-front-lv1"
      )
    ).toBe(false);
  });

  it("A面[2] は同一タイミングで既に転醒済みなら prompt を積まず、既存 prompt は skipOnly のみになる", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const getDefinition = (id: string): CardDefinition | undefined =>
      map.get(id);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(expanded);
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-same-timing-legal",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [inst],
        playerOverrides: [
          { countValue: 0, soulCoreLocation: { kind: "reserve" } },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      actionStartLogIndex: 0,
    };
    const alreadyRebirthedLog =
      "effect:rebirth:other-front:flip_to:OTHER(B):retain=1:return=0:reserve";

    const blockedQueued = queueRegisteredBattleImmediateEffects({
      state: { ...baseState, log: [alreadyRebirthedLog] },
      attackId: "attack-keine-same-timing-blocked",
      participantEntityId: "battle-entity:keine-front-same-timing-legal",
      actingPlayerId: "alice",
      sourceCard: inst,
      sourceDefinition: frontDef,
      timing: "attack",
      getCardDefinitionById: getDefinition,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    expect(
      blockedQueued.battleImmediateEffects.some(
        (prompt) => prompt.sourceInstanceId === inst.instanceId
      )
    ).toBe(false);

    const queuedBeforeRebirth = queueRegisteredBattleImmediateEffects({
      state: baseState,
      attackId: "attack-keine-same-timing-stale",
      participantEntityId: "battle-entity:keine-front-same-timing-legal",
      actingPlayerId: "alice",
      sourceCard: inst,
      sourceDefinition: frontDef,
      timing: "attack",
      getCardDefinitionById: getDefinition,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    expect(
      queuedBeforeRebirth.battleImmediateEffects.some(
        (prompt) => prompt.sourceInstanceId === inst.instanceId
      )
    ).toBe(true);

    const staleQueued: GameState = {
      ...queuedBeforeRebirth,
      actionStartLogIndex: 0,
      log: [alreadyRebirthedLog],
    };
    const actions = getLegalActions({
      state: staleQueued,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).filter(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === inst.instanceId
    );

    expect(actions.some((a) => a.skipOnly !== true)).toBe(false);
    expect(actions).toEqual([
      expect.objectContaining({
        executionMode: "optional",
        skipOnly: true,
      }),
    ]);
  });

  it("A面[2] は同じ attack immediate 窓の1体目が解決済みなら、action boundary 後の2体目をキューから除く", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const getDefinition = (id: string): CardDefinition | undefined =>
      map.get(id);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(expanded);
    const first = createCardInstance(frontDef, {
      instanceId: "keine-front-window-first",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const second = createCardInstance(frontDef, {
      instanceId: "keine-front-window-second",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [first, second],
        playerOverrides: [
          { countValue: 0, soulCoreLocation: { kind: "reserve" } },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
    };
    const attackId = "attack-keine-same-timing-real";
    const lookupOptions = {
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions: noLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    };

    const queuedFirst = queueRegisteredBattleImmediateEffects({
      state: baseState,
      attackId,
      participantEntityId: "battle-entity:keine-front-window-first",
      actingPlayerId: "alice",
      sourceCard: first,
      sourceDefinition: frontDef,
      timing: "attack",
      getCardDefinitionById: getDefinition,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    const queuedBoth = queueRegisteredBattleImmediateEffects({
      state: queuedFirst,
      attackId,
      participantEntityId: "battle-entity:keine-front-window-second",
      actingPlayerId: "alice",
      sourceCard: second,
      sourceDefinition: frontDef,
      timing: "attack",
      getCardDefinitionById: getDefinition,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    expect(
      queuedBoth.battleImmediateEffects.filter((prompt) =>
        prompt.sourceInstanceId.startsWith("keine-front-window-")
      )
    ).toHaveLength(2);

    const firstAction = getLegalActions({
      state: queuedBoth,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === "keine-front-window-first" &&
        a.skipOnly !== true
    );
    expect(firstAction).toBeDefined();

    const declaredFirst = applyLegalAction({
      state: queuedBoth,
      action: firstAction!,
      ...lookupOptions,
    }).state;
    const passFirst = getLegalActions({
      state: declaredFirst,
      actingPlayerId: "bob",
      ...lookupOptions,
    }).find((a) => a.kind === "pass_stack");
    expect(passFirst).toBeDefined();
    const afterFirst = applyLegalAction({
      state: declaredFirst,
      action: passFirst!,
      ...lookupOptions,
    }).state;
    expect(
      afterFirst.cardInstances.find(
        (c) => c.instanceId === "keine-front-window-first"
      )!.definitionId
    ).toBe("BSTH03-転醒X01(B)");
    expect(
      afterFirst.log.some((line) =>
        line.includes(
          `effect:rebirth:timing-window-resolved:battle_immediate:${attackId}:attack:ungrouped`
        )
      )
    ).toBe(true);

    const secondActions = getLegalActions({
      state: afterFirst,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).filter(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === "keine-front-window-second"
    );
    expect(secondActions).toEqual([]);
    expect(afterFirst.battleImmediateEffects).toEqual([]);
    expect(afterFirst.players.find((p) => p.id === "alice")!.countValue).toBe(
      1
    );
    expect(
      afterFirst.cardInstances.find(
        (c) => c.instanceId === "keine-front-window-second"
      )!.definitionId
    ).toBe("BSTH03-転醒X01(A)");
  });

  it("A面[2] はソウルコアがトラッシュにあっても通常の attack immediate action を生成する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const getDefinition = (id: string): CardDefinition | undefined =>
      map.get(id);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(expanded);
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-trash-soul-legal",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [inst],
        playerOverrides: [
          { countValue: 0, soulCoreLocation: { kind: "trash" } },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
    };

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-keine-trash-soul-legal",
      participantEntityId: "battle-entity:keine-front-trash-soul-legal",
      actingPlayerId: "alice",
      sourceCard: inst,
      sourceDefinition: frontDef,
      timing: "attack",
      getCardDefinitionById: getDefinition,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    expect(
      queued.battleImmediateEffects.some(
        (prompt) => prompt.sourceInstanceId === "keine-front-trash-soul-legal"
      )
    ).toBe(true);
    const actions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    }).filter(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === "keine-front-trash-soul-legal"
    );

    expect(actions.some((a) => a.skipOnly !== true)).toBe(true);
    expect(actions).toContainEqual(
      expect.objectContaining({
        executionMode: "optional",
      })
    );
  });

  it("A面[2] は通常スピリット上のソウルコアを置いて A→B へ転醒できる", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = frontDef.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
    )!;
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-field-soul-cost",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const allyDef = map.get("BSTH03-C02")!;
    const ally = createCardInstance(allyDef, {
      instanceId: "ally-field-soul-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst, ally],
      playerOverrides: [
        {
          countValue: 0,
          soulCoreLocation: {
            kind: "card",
            instanceId: "ally-field-soul-source",
          },
        },
        {},
      ],
    });

    const result = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:836",
      state,
      effect,
      sourceInstanceId: "keine-front-field-soul-cost",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => map.get(id),
    });

    const flipped = result.cardInstances.find(
      (c) => c.instanceId === "keine-front-field-soul-cost"
    )!;
    const allyAfter = result.cardInstances.find(
      (c) => c.instanceId === "ally-field-soul-source"
    )!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(flipped.soulCoreCount).toBe(1);
    expect(allyAfter.soulCoreCount).toBe(0);
    expect(
      result.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "keine-front-field-soul-cost" });
  });

  it("A面[2] はトラッシュのソウルコアを置いて A→B へ転醒できる", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = frontDef.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
    )!;
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-trash-soul-cost",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
      playerOverrides: [
        { countValue: 0, soulCoreLocation: { kind: "trash" } },
        {},
      ],
    });

    const result = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:881",
      state,
      effect,
      sourceInstanceId: "keine-front-trash-soul-cost",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => map.get(id),
    });

    const flipped = result.cardInstances.find(
      (c) => c.instanceId === "keine-front-trash-soul-cost"
    )!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(flipped.soulCoreCount).toBe(1);
    expect(
      result.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "keine-front-trash-soul-cost" });
    expect(result.players.find((p) => p.id === "alice")!.countValue).toBe(1);
  });

  it("A面[2] はライフのソウルコアを置いて A→B へ転醒できる", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = frontDef.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
    )!;
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-life-soul-cost",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
      playerOverrides: [
        { countValue: 0, soulCoreLocation: { kind: "life" } },
        {},
      ],
    });

    const result = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:923",
      state,
      effect,
      sourceInstanceId: "keine-front-life-soul-cost",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => map.get(id),
    });

    const flipped = result.cardInstances.find(
      (c) => c.instanceId === "keine-front-life-soul-cost"
    )!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(flipped.normalCoreCount).toBe(3);
    expect(flipped.soulCoreCount).toBe(1);
    expect(
      result.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "keine-front-life-soul-cost" });
    expect(result.players.find((p) => p.id === "alice")!.countValue).toBe(1);
    expect(result.pendingLifeCoreSelection).toBeNull();
  });

  it("A面[2] は life_damage_interception pending の辞退後も life ソウルを置いて A→B へ転醒する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = frontDef.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
    )!;
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-life-discard-pending",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const discardGateCard = createCardInstance(frontDef, {
      instanceId: "life-discard-gate-card",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [inst, discardGateCard],
        playerOverrides: [
          {
            countValue: 0,
            soulCoreLocation: { kind: "reserve" },
            reserveSoulCoreCount: 1,
            lifeSoulCoreCount: 1,
          },
          {},
        ],
      }),
      activeContinuousEffects: [
        lifeDiscardGateCE(
          discardGateCard.instanceId,
          discardGateCard.definitionId
        ),
      ],
    };
    const lookupOptions = {
      getCardDefinitionById: (id: string): CardDefinition | undefined =>
        map.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(expanded),
      getRegisteredBurstActions: () => [],
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(expanded),
      getRegisteredFieldCardEffectActions: noLookup,
    };

    const pending = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:995",
      state,
      effect,
      sourceInstanceId: "keine-front-life-discard-pending",
      actingPlayerId: "alice",
      getCardDefinitionById: lookupOptions.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookupOptions.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lookupOptions.getRegisteredBurstActions,
    });

    expect(pending.pendingLifeDamageDiscardChoice).not.toBeNull();
    expect(
      pending.cardInstances.find(
        (c) => c.instanceId === "keine-front-life-discard-pending"
      )!.definitionId
    ).toBe("BSTH03-転醒X01(A)");

    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...lookupOptions,
    }).find((a) => a.kind === "resolve_pending_life_damage_discard_choice")!;
    const resolved = applyLegalAction({
      state: pending,
      action,
      ...lookupOptions,
      lifeDamageDiscardChoice: "decline",
    }).state;

    const flipped = resolved.cardInstances.find(
      (c) => c.instanceId === "keine-front-life-discard-pending"
    )!;
    const alice = resolved.players.find((p) => p.id === "alice")!;
    expect(resolved.pendingLifeDamageDiscardChoice).toBeNull();
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(flipped.soulCoreCount).toBe(2);
    expect(alice.lifeSoulCoreCount).toBe(0);
    expect(alice.countValue).toBe(1);
    expect(collectGameStateInvariantIssues(resolved)).toEqual([]);
  });

  it("A面[2] は導界者ネクサス上のソウルコアを置けなくても A→B へ転醒できる", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const guidedDef = map.get("BSTH03-X02")!;
    const effect = frontDef.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
    )!;
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-guided-soul-cost",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const guidedNexus = createCardInstance(guidedDef, {
      instanceId: "guided-soul-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst, guidedNexus],
      playerOverrides: [
        {
          countValue: 0,
          soulCoreLocation: {
            kind: "card",
            instanceId: "guided-soul-source",
          },
        },
        {},
      ],
    });

    const result = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:1074",
      state,
      effect,
      sourceInstanceId: "keine-front-guided-soul-cost",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => map.get(id),
    });

    const flipped = result.cardInstances.find(
      (c) => c.instanceId === "keine-front-guided-soul-cost"
    )!;
    const guidedAfter = result.cardInstances.find(
      (c) => c.instanceId === "guided-soul-source"
    )!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(flipped.soulCoreCount).toBe(0);
    expect(guidedAfter.soulCoreCount).toBe(1);
    expect(
      result.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "guided-soul-source" });
    expect(result.players.find((p) => p.id === "alice")!.countValue).toBe(1);
  });

  it.each(["reserve", "trash", "life"] as const)(
    "A面[2] はQ8962型耐性中なら%sのソウルコアを動かさず A→B へ転醒する",
    (locationKind) => {
      const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
      const map = new Map(expanded.map((d) => [d.cardNo, d]));
      const frontDef = map.get("BSTH03-転醒X01(A)")!;
      const effect = frontDef.effects!.find(
        (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
      )!;
      const inst = createCardInstance(frontDef, {
        instanceId: `keine-front-${locationKind}-soul-immune`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [inst],
          playerOverrides: [
            { countValue: 0, soulCoreLocation: { kind: locationKind } },
            {},
          ],
        }),
        activeContinuousEffects: [soulCoreSelfEffectImmunityCE("alice")],
      };

      const result = executeEffect({
        chainId: "test:bsth03-tensei-x01b-rebirth-attack:1125",
        state,
        effect,
        sourceInstanceId: `keine-front-${locationKind}-soul-immune`,
        actingPlayerId: "alice",
        getCardDefinitionById: (id) => map.get(id),
      });

      const flipped = result.cardInstances.find(
        (c) => c.instanceId === `keine-front-${locationKind}-soul-immune`
      )!;
      expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
      expect(flipped.soulCoreCount).toBe(0);
      expect(
        result.players.find((p) => p.id === "alice")!.soulCoreLocation
      ).toEqual({ kind: locationKind });
      expect(result.players.find((p) => p.id === "alice")!.countValue).toBe(1);
      expect(
        result.log.some((l) => l.includes("blocked-by-soul-core-immunity"))
      ).toBe(true);
    }
  );

  it("A面[2] はQ8962型耐性中ならフィールド上のソウルコアを動かさず A→B へ転醒する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = frontDef.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
    )!;
    const inst = createCardInstance(frontDef, {
      instanceId: "keine-front-field-soul-immune",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const allyDef = map.get("BSTH03-C02")!;
    const ally = createCardInstance(allyDef, {
      instanceId: "ally-field-soul-immune-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [inst, ally],
        playerOverrides: [
          {
            countValue: 0,
            soulCoreLocation: {
              kind: "card",
              instanceId: "ally-field-soul-immune-source",
            },
          },
          {},
        ],
      }),
      activeContinuousEffects: [soulCoreSelfEffectImmunityCE("alice")],
    };

    const result = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:1188",
      state,
      effect,
      sourceInstanceId: "keine-front-field-soul-immune",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => map.get(id),
    });

    const flipped = result.cardInstances.find(
      (c) => c.instanceId === "keine-front-field-soul-immune"
    )!;
    const allyAfter = result.cardInstances.find(
      (c) => c.instanceId === "ally-field-soul-immune-source"
    )!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(flipped.soulCoreCount).toBe(0);
    expect(allyAfter.soulCoreCount).toBe(1);
    expect(
      result.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({
      kind: "card",
      instanceId: "ally-field-soul-immune-source",
    });
    expect(result.players.find((p) => p.id === "alice")!.countValue).toBe(1);
    expect(
      result.log.some((l) => l.includes("blocked-by-soul-core-immunity"))
    ).toBe(true);
  });

  it("A面[2] の rebirth.maxCount は印字条件(5)と一致する", () => {
    const rebirthEffect = front.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 6
    )!;
    const rebirthStep = rebirthEffect.steps.find(
      (s) => s.action.kind === "rebirth"
    )!;
    expect(rebirthStep.action).toEqual({
      kind: "rebirth",
      maxCount: 5,
      vanishAfterFlipOnLvDeficit: true,
    });
  });

  it("裏面[0] 除外効果の timing は ['rebirth','attack'] / stub 解消", () => {
    const eff = back.effects![0]!;
    expect(eff.timing).toEqual({
      kind: "card_event",
      event: ["rebirth", "attack"],
    });
    expect(eff.stub).toBeUndefined();
    expect(eff.preventionRestriction).toEqual({
      notPreventableByTribes: ["蓬莱"],
    });
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("remove_from_game");
    if (action.kind === "remove_from_game" && action.target.kind === "filter") {
      expect(action.pierceCannotLeaveField).toBe(true);
      expect(action.target.player).toBe("opponent");
      expect(action.target.filter?.category).toEqual([
        "spirit",
        "ultimate",
        "nexus",
      ]);
      expect(action.target.count).toBe(1);
    }
  });

  it("裏面[0] の『フィールドに残らない』は cannot_leave_field を貫通して除外する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const backDef = map.get("BSTH03-転醒X01(B)")!;
    const targetDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = backDef.effects![0]!;
    const source = createCardInstance(backDef, {
      instanceId: "keine-back-pierce-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "bob-cannot-leave-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    let state: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target],
    });
    state = executeEffectResistance(
      state,
      "bob",
      {
        kind: "effect_resistance",
        target: { selfCard: true, count: 1 },
        resistType: "cannot_leave_field",
        source: "opponent_effect",
        duration: { scope: "permanent" },
      },
      "bob-cannot-leave-target",
      (id) => map.get(id)
    );

    const queued = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:1293",
      state,
      effect: { timing: effect.timing, steps: effect.steps },
      sourceInstanceId: "keine-back-pierce-source",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => map.get(id),
    });

    expect(
      queued.log.some((l) =>
        l.includes(
          "effect:remove_from_game:cannot-leave-field-pierced:alice:bob-cannot-leave-target"
        )
      )
    ).toBe(true);
    const pending = queued.pendingLeaveEntities.find(
      (p) => p.instanceId === "bob-cannot-leave-target"
    );
    expect(pending?.preventStayOnField).toBe(true);
    const flushed = flushPendingLeaves(queued, (id) => map.get(id));
    const after = flushed.cardInstances.find(
      (c) => c.instanceId === "bob-cannot-leave-target"
    )!;
    expect(after.zone).toBe("removed_from_game");
    expect(after.normalCoreCount).toBe(0);
  });

  it("裏面[0] の『蓬莱を持つ効果で防げず』は蓬莱sourceの除外耐性だけを貫通する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const backDef = map.get("BSTH03-転醒X01(B)")!;
    const targetDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = backDef.effects![0]!;
    const source = createCardInstance(backDef, {
      instanceId: "keine-back-unpreventable-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "bob-remove-resistant-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const shieldDef: CardDefinition = {
      cardNo: "TEST-HOURAI-SHIELD",
      name: "Test Hourai Shield",
      printedCategory: "magic",
      colors: ["green"],
      cost: 1,
      reductionSymbols: ["green"],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "蓬莱",
      sourceUrls: [],
      sourceConfidence: "A",
    };
    const nonHouraiShieldDef: CardDefinition = {
      ...shieldDef,
      cardNo: "TEST-NON-HOURAI-SHIELD",
      name: "Test Non-Hourai Shield",
      tribe: "幻想",
    };
    const getDef = (id: string) =>
      id === shieldDef.cardNo
        ? shieldDef
        : id === nonHouraiShieldDef.cardNo
          ? nonHouraiShieldDef
          : map.get(id);
    const runWithShield = (
      shieldDefinition: CardDefinition,
      sourcePreventionBypass?: Parameters<
        typeof executeEffect
      >[0]["sourcePreventionBypass"]
    ): GameState => {
      const shield = createCardInstance(shieldDefinition, {
        instanceId: "bob-shield-source",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 0,
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, target, shield],
        }),
        activeContinuousEffects: [
          {
            effectId: "ce-cannot-remove",
            sourceInstanceId: "bob-shield-source",
            sourceDefinitionId: shieldDefinition.cardNo,
            actingPlayerId: "bob",
            duration: { scope: "permanent" },
            createdAtTurn: 1,
            createdAtAttackId: null,
            modifierTag: "cannot_be_removed_from_game",
            targetInstanceId: "bob-remove-resistant-target",
            metadata: { source: "opponent_effect" },
          },
        ],
      };
      return executeEffect({
        chainId: "test:bsth03-tensei-x01b-rebirth-attack:1400",
        state,
        effect,
        sourceInstanceId: "keine-back-unpreventable-source",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
      });
    };

    const houraiQueued = runWithShield(shieldDef);
    expect(
      houraiQueued.cardInstances.find(
        (c) => c.instanceId === "bob-remove-resistant-target"
      )?.pendingLeaveKind
    ).toBe("remove_from_game");

    const callerBypassQueued = runWithShield(shieldDef, {
      kind: "preventing_effect_filter",
      filter: { tribes: ["幻想"] },
    });
    expect(
      callerBypassQueued.cardInstances.find(
        (c) => c.instanceId === "bob-remove-resistant-target"
      )?.pendingLeaveKind
    ).toBe("remove_from_game");

    const nonHouraiResult = runWithShield(nonHouraiShieldDef);
    const nonHouraiTarget = nonHouraiResult.cardInstances.find(
      (c) => c.instanceId === "bob-remove-resistant-target"
    )!;
    expect(nonHouraiTarget.zone).toBe("field");
    expect(nonHouraiTarget.pendingLeaveKind).toBeNull();
  });

  it("裏面[0] の蓬莱耐性は候補でも判定し、限定的防止不可で貫通する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const backDef = map.get("BSTH03-転醒X01(B)")!;
    const targetDef = map.get("BSTH03-転醒X01(A)")!;
    const source = createCardInstance(backDef, {
      instanceId: "keine-back-legal-candidate-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "bob-hourai-immune-candidate",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const shieldDef: CardDefinition = {
      cardNo: "TEST-HOURAI-DEFENSE-IMMUNE",
      name: "Test Hourai Defense Immune",
      printedCategory: "magic",
      colors: ["green"],
      cost: 1,
      reductionSymbols: ["green"],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "蓬莱",
      sourceUrls: [],
      sourceConfidence: "A",
    };
    const shield = createCardInstance(shieldDef, {
      instanceId: "bob-hourai-defense-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target, shield],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-hourai-defense-immune",
          sourceInstanceId: shield.instanceId,
          sourceDefinitionId: shieldDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: target.instanceId,
        },
      ],
    };
    const getDef = (id: string) =>
      id === shieldDef.cardNo ? shieldDef : map.get(id);
    const registration = {
      candidateTargetZones: ["field" as const],
      candidateTargetPlayerScope: "opponent" as const,
      targetCardFilter: {
        category: ["spirit" as const, "ultimate" as const, "nexus" as const],
      },
      requiredTargetCount: 1,
    };

    expect(
      getCandidateTargetInstanceIds(state, "alice", registration, {
        getCardDefinitionById: getDef,
        sourceInstanceId: source.instanceId,
        sourceDefinition: backDef,
      })
    ).not.toContain(target.instanceId);

    expect(
      getCandidateTargetInstanceIds(
        state,
        "alice",
        {
          ...registration,
          preventionRestriction: { notPreventableByTribes: ["蓬莱"] },
        },
        {
          getCardDefinitionById: getDef,
          sourceInstanceId: source.instanceId,
          sourceDefinition: backDef,
        }
      )
    ).toContain(target.instanceId);
  });

  it("裏面[0] の蓬莱 target-lock bypass は caller sourceTargetLockBypass と OR merge される", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const backDef = map.get("BSTH03-転醒X01(B)")!;
    const targetDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = backDef.effects![0]!;
    const source = createCardInstance(backDef, {
      instanceId: "keine-back-target-lock-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "bob-target-locked-remove-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const shieldDef: CardDefinition = {
      cardNo: "TEST-HOURAI-TARGET-LOCK",
      name: "Test Hourai Target Lock",
      printedCategory: "magic",
      colors: ["green"],
      cost: 1,
      reductionSymbols: ["green"],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "蓬莱",
      sourceUrls: [],
      sourceConfidence: "A",
    };
    const shield = createCardInstance(shieldDef, {
      instanceId: "bob-target-lock-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const getDef = (id: string) =>
      id === shieldDef.cardNo ? shieldDef : map.get(id);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target, shield],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-cannot-target-hourai-source",
          sourceInstanceId: shield.instanceId,
          sourceDefinitionId: shieldDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "cannot_be_targeted",
          targetInstanceId: target.instanceId,
        },
      ],
    };

    const queued = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:1597",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      sourceTargetLockBypass: {
        kind: "preventing_effect_filter",
        filter: { tribes: ["幻想"] },
      },
    });

    expect(
      queued.cardInstances.find((c) => c.instanceId === target.instanceId)
        ?.pendingLeaveKind
    ).toBe("remove_from_game");
  });

  // P3-143 残タスク4: 「系統：「蓬莱」を持つ一切の効果で防げず」型 (scope 付き target lock
  // bypass) が実在カードに配線されているかの確認。preventionRestriction.notPreventableByTribes
  // は derivePreventionProfile 経由で targetLockBypass にも自動的に反映されるため、
  // card-data 側の追加変更は不要（上の OR-merge テストで既に間接確認済み）。
  // ここでは caller 側の bypass を渡さず、target lock の発揮元カードの tribe だけで
  // 貫通可否が分岐することを確認し、scope が過剰に広くない（蓬莱以外は貫通しない）ことも示す。
  it("裏面[0] の蓬莱 target-lock bypass は発揮元カードの tribe が蓬莱のときだけ貫通する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const backDef = map.get("BSTH03-転醒X01(B)")!;
    const targetDef = map.get("BSTH03-転醒X01(A)")!;
    const effect = backDef.effects![0]!;
    const houraiShieldDef: CardDefinition = {
      cardNo: "TEST-HOURAI-TARGET-LOCK-SOLO",
      name: "Test Hourai Target Lock Solo",
      printedCategory: "magic",
      colors: ["green"],
      cost: 1,
      reductionSymbols: ["green"],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "蓬莱",
      sourceUrls: [],
      sourceConfidence: "A",
    };
    const nonHouraiShieldDef: CardDefinition = {
      ...houraiShieldDef,
      cardNo: "TEST-NON-HOURAI-TARGET-LOCK-SOLO",
      name: "Test Non-Hourai Target Lock Solo",
      tribe: "幻想",
    };
    const getDef = (id: string) =>
      id === houraiShieldDef.cardNo
        ? houraiShieldDef
        : id === nonHouraiShieldDef.cardNo
          ? nonHouraiShieldDef
          : map.get(id);
    const run = (shieldDefinition: CardDefinition) => {
      const source = createCardInstance(backDef, {
        instanceId: "keine-back-target-lock-tribe-source",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      });
      const target = createCardInstance(targetDef, {
        instanceId: "bob-target-lock-tribe-target",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 3,
      });
      const shield = createCardInstance(shieldDefinition, {
        instanceId: "bob-target-lock-tribe-shield",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 0,
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, target, shield],
        }),
        activeContinuousEffects: [
          {
            effectId: "ce-target-lock-tribe",
            sourceInstanceId: shield.instanceId,
            sourceDefinitionId: shieldDefinition.cardNo,
            actingPlayerId: "bob",
            duration: { scope: "permanent" },
            createdAtTurn: 1,
            createdAtAttackId: null,
            modifierTag: "cannot_be_targeted",
            targetInstanceId: target.instanceId,
          },
        ],
      };
      return executeEffect({
        chainId: "test:bsth03-tensei-x01b-rebirth-attack:1695",
        state,
        effect,
        sourceInstanceId: source.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
    };

    const withHouraiSource = run(houraiShieldDef);
    expect(
      withHouraiSource.cardInstances.find(
        (c) => c.instanceId === "bob-target-lock-tribe-target"
      )?.pendingLeaveKind
    ).toBe("remove_from_game");

    const withNonHouraiSource = run(nonHouraiShieldDef);
    expect(
      withNonHouraiSource.cardInstances.find(
        (c) => c.instanceId === "bob-target-lock-tribe-target"
      )?.pendingLeaveKind
    ).toBeNull();
  });

  it("executeRebirth はB面最低Lv判定でカード上のソウルコアも数える", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const inst = createCardInstance(frontDef, {
      instanceId: "spr-soul-only",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
      soulCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
      playerOverrides: [
        {
          soulCoreLocation: { kind: "card", instanceId: "spr-soul-only" },
        },
        {},
      ],
    });

    const after = executeRebirth(
      before,
      "alice",
      { kind: "rebirth", maxCount: 5, triggerDescription: "" },
      "spr-soul-only",
      (id) => map.get(id),
      "test:bsth03-tensei-x01b-rebirth-attack:1742"
    );

    const flipped = after.cardInstances.find(
      (c) => c.instanceId === "spr-soul-only"
    )!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(flipped.normalCoreCount).toBe(0);
    expect(flipped.soulCoreCount).toBe(1);
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);
    expect(after.log.some((l) => l.includes("lv-deficit"))).toBe(false);
  });

  it("Q1296型ではソウルコアを置けなくても転醒してから最低Lv不足で消滅待機に入る", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const frontDef = map.get("BSTH03-転醒X01(A)")!;
    const inst = createCardInstance(frontDef, {
      instanceId: "spr-no-core-q1296",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
      soulCoreCount: 0,
    });
    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
      playerOverrides: [{ countValue: 0 }, {}],
    });

    const after = executeRebirth(
      before,
      "alice",
      {
        kind: "rebirth",
        maxCount: 5,
        triggerDescription: "",
        vanishAfterFlipOnLvDeficit: true,
      },
      "spr-no-core-q1296",
      (id) => map.get(id),
      "test:bsth03-tensei-x01b-rebirth-attack:1778"
    );

    const flipped = after.cardInstances.find(
      (c) => c.instanceId === "spr-no-core-q1296"
    )!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);
    expect(after.pendingLeaveEntities).toContainEqual(
      expect.objectContaining({
        instanceId: "spr-no-core-q1296",
        kind: "vanish",
        chainId: "effect:rebirth:spr-no-core-q1296:lv-deficit",
        causedByEffectSourceInstanceId: "spr-no-core-q1296",
      })
    );
    const flipIndex = after.log.findIndex((l) => l.includes(":flip_to:"));
    const deficitIndex = after.log.findIndex((l) => l.includes(":lv-deficit:"));
    expect(flipIndex).toBeGreaterThanOrEqual(0);
    expect(deficitIndex).toBeGreaterThan(flipIndex);
  });

  it("flip(A→B) で rebirth イベント発火 → 裏面[0] 除外効果が誘発キューに乗る", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const lookups = {
      getCardDefinitionById: (id: string) => map.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(expanded),
    };

    const frontDef = lookups.getCardDefinitionById("BSTH03-転醒X01(A)")!;
    const inst = createCardInstance(frontDef, {
      instanceId: "spr-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // ソウルコアを置いた状態で表→裏 (転醒条件「カウント5以下」は countValue=0 で成立)
    inst.soulCoreCount = 1;
    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inst],
    });

    const action: RebirthAction = {
      kind: "rebirth",
      maxCount: 5,
      triggerDescription: "",
    };
    const after = executeRebirth(
      before,
      "alice",
      action,
      "spr-1",
      lookups.getCardDefinitionById,
      "test:bsth03-tensei-x01b-rebirth-attack:1837"
    );

    const flipped = after.cardInstances.find((c) => c.instanceId === "spr-1")!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById: lookups.getCardDefinitionById,
    });
    expect(events.filter((e) => e.eventKind === "rebirth").length).toBe(1);

    const queued = collectAndQueueTriggerReactions({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:1858",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const rebirthPendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "rebirth" && p.relatedInstanceId === "spr-1"
    );
    // 旧 event:"attack" 単独だったときは 0 件 (転醒では誘発せず)。
    expect(rebirthPendings.length).toBe(1);
  });
});

describe("BSTH03-転醒X01(B) 上白沢 慧音-白澤-（裏面[1] Lv2-Lv3 カウント3以上『手札のカードを使用できない』）", () => {
  const front = byCardNo.get("BSTH03-転醒X01(A)")!;
  const back = front.backFace!;
  const eff = back.effects![1]!;

  const MAGIC_DEF: CardDefinition = {
    cardNo: "TEST-BSTH03-X01B-MAGIC",
    name: "テストマジック",
    printedCategory: "magic",
    colors: ["green"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };

  it("stub が外れている / restrict_use(opponent, duration:attack)", () => {
    expect(eff.stub).toBeUndefined();
    expect(eff.steps).toHaveLength(1);
    expect(eff.steps[0]!.action).toEqual({
      kind: "restrict_use",
      player: "opponent",
      filter: { zone: ["hand"] },
      duration: { scope: "attack" },
    });
  });

  it("Lv2以上・カウント3以上で発揮 → 相手 (alice) の手札カード使用が restrict_use CE で禁止される", () => {
    const spirit: CardInstance = createCardInstance(back, {
      instanceId: "keine-back",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3, // back.levelDefs level2 requiredCores:3
    });
    const magicInHand: CardInstance = createCardInstance(MAGIC_DEF, {
      instanceId: "alice-magic-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const magicInTrash: CardInstance = createCardInstance(MAGIC_DEF, {
      instanceId: "alice-magic-trash",
      ownerPlayerId: "alice",
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: ["bob", "alice"],
      cardInstances: [spirit, magicInHand, magicInTrash],
      playerOverrides: [{ countValue: 3 }, {}],
    });

    const lookup = (id: string): CardDefinition | undefined => {
      if (id === "BSTH03-転醒X01(B)") return back;
      if (id === MAGIC_DEF.cardNo) return MAGIC_DEF;
      return undefined;
    };

    const result = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:1938",
      state,
      effect: eff,
      sourceInstanceId: "keine-back",
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
    });

    const restrictCe = result.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_use"
    );
    expect(restrictCe).toBeDefined();
    expect(restrictCe?.duration).toEqual({ scope: "attack" });
    expect(
      isCardUseRestricted(result, "alice", magicInHand, MAGIC_DEF, lookup)
    ).toBe(true);
    expect(
      isCardUseRestricted(result, "alice", magicInTrash, MAGIC_DEF, lookup)
    ).toBe(false);
    // 発揮元 (bob) 自身の手札使用は制限されない。
    expect(
      isCardUseRestricted(
        { ...result, activePlayerId: "bob" },
        "bob",
        magicInHand,
        MAGIC_DEF,
        lookup
      )
    ).toBe(false);
  });

  it("カウント2以下 (条件不成立) → restrict_use CE 未登録、手札使用は制限されない", () => {
    const spirit: CardInstance = createCardInstance(back, {
      instanceId: "keine-back",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const magicInHand: CardInstance = createCardInstance(MAGIC_DEF, {
      instanceId: "alice-magic-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: ["bob", "alice"],
      cardInstances: [spirit, magicInHand],
      playerOverrides: [{ countValue: 2 }, {}],
    });
    const lookup = (id: string): CardDefinition | undefined => {
      if (id === "BSTH03-転醒X01(B)") return back;
      if (id === MAGIC_DEF.cardNo) return MAGIC_DEF;
      return undefined;
    };

    const result = executeEffect({
      chainId: "test:bsth03-tensei-x01b-rebirth-attack:1993",
      state,
      effect: eff,
      sourceInstanceId: "keine-back",
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
    });

    expect(
      result.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_use"
      )
    ).toBe(false);
    expect(
      isCardUseRestricted(result, "alice", magicInHand, MAGIC_DEF, lookup)
    ).toBe(false);
  });
});

describe("BSTH03-転醒X01(B) 上白沢 慧音-白澤-（裏面[2] Lv3『このスピリットのアタック時』バトル終了時カウント-1で回復）", () => {
  const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
  const expandedMap = new Map(expanded.map((d) => [d.cardNo, d]));
  const back = expandedMap.get("BSTH03-転醒X01(B)")!;
  const eff = back.effects![2]!;
  const battleImmediateLookup = buildBattleImmediateEffectLookup(expanded);
  const getRegisteredTriggeredEffectActions = () => [];

  const lookup = (id: string): CardDefinition | undefined =>
    expandedMap.get(id);

  it("timing は card_event:attack + deferredTo:battle_end、executionMode:optional、count_decrease(1)→recover(self) が conditional_cost 連結 / stub 解消", () => {
    expect(eff.stub).toBeUndefined();
    expect(eff.timing).toEqual({
      kind: "card_event",
      event: "attack",
      deferredTo: "battle_end",
    });
    expect(eff.executionMode).toBe("optional");
    expect(eff.condition).toEqual([{ kind: "min_level", value: 3 }]);
    expect(eff.steps[0]!.action).toEqual({
      kind: "count_decrease",
      player: "self",
      amount: 1,
    });
    expect(eff.steps[1]).toMatchObject({
      connector: "conditional_cost",
      action: { kind: "recover", target: { kind: "self" } },
    });
  });

  function makeMidBattleState(instanceId: string, countValue: number) {
    const attackId = `attack-${instanceId}`;
    const entityId = `battle-entity:${instanceId}`;
    const spirit: CardInstance = createCardInstance(back, {
      instanceId,
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4, // back.levelDefs level3 requiredCores:4
      exhaustState: "exhausted",
    });
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: entityId,
      participantEntityIds: [entityId],
      groupMode: "single",
      target: { kind: "player", playerId: "alice" },
      blockAssignments: [
        { participantEntityId: entityId, blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: [entityId],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["bob", "alice"],
        cardInstances: [spirit],
        playerOverrides: [{ countValue }, {}],
      }),
      activePlayerId: "bob",
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId,
          memberInstanceIds: [instanceId],
          resolvedBp: 4000,
          resolvedSymbols: [],
          attackState: "attacking",
        },
      ],
    };
    return { state, attackId, entityId, spirit };
  }

  function queueAttackImmediateEffect(
    state: GameState,
    spirit: CardInstance,
    attackId: string,
    entityId: string
  ) {
    return queueRegisteredBattleImmediateEffects({
      state,
      attackId,
      participantEntityId: entityId,
      actingPlayerId: "bob",
      sourceCard: spirit,
      sourceDefinition: back,
      timing: "attack",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
  }

  const legalOptions = {
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: undefined,
    getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    getRegisteredFieldCardEffectActions: noLookup,
  };

  function finishBattle(state: GameState): GameState {
    return executeBattleResolution({
      state,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    }).state;
  }

  it("Lv3・カウント1以上 → attack immediate で任意宣言すると battle_end deferral が予約され、バトル終了時にカウント-1で回復する", () => {
    const instanceId = "keine-back-lv3-accept";
    const { state, attackId, entityId, spirit } = makeMidBattleState(
      instanceId,
      1
    );
    const queued = queueAttackImmediateEffect(
      state,
      spirit,
      attackId,
      entityId
    );
    const action = getLegalActions({
      state: queued,
      actingPlayerId: "bob",
      ...legalOptions,
    }).find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === instanceId &&
        a.executionMode === "optional" &&
        a.skipOnly !== true
    );
    expect(action).toBeDefined();
    expect(action).toMatchObject({ executionMode: "optional" });

    const declared = applyLegalAction({
      state: queued,
      action: action!,
      ...legalOptions,
    }).state;

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    const reserved = applyLegalAction({
      state: declared,
      action: pass!,
      ...legalOptions,
    }).state;
    expect(reserved.pendingBattleEndDeferrals).toEqual([
      expect.objectContaining({
        attackId,
        sourceInstanceId: instanceId,
        effectIndex: 2,
      }),
    ]);
    expect(reserved.players.find((p) => p.id === "bob")!.countValue).toBe(1);
    expect(
      reserved.cardInstances.find((c) => c.instanceId === instanceId)!
        .exhaustState
    ).toBe("exhausted");

    const resolved = finishBattle(reserved);

    expect(resolved.players.find((p) => p.id === "bob")!.countValue).toBe(0);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === instanceId)!
        .exhaustState
    ).toBe("recovered");
  });

  it("Lv3・カウント1以上でも attack immediate の skipOnly で辞退できる → battle_end deferral は予約されず、カウント・疲労状態とも不変", () => {
    const instanceId = "keine-back-lv3-decline";
    const { state, attackId, entityId, spirit } = makeMidBattleState(
      instanceId,
      1
    );
    const queued = queueAttackImmediateEffect(
      state,
      spirit,
      attackId,
      entityId
    );
    const skip = getLegalActions({
      state: queued,
      actingPlayerId: "bob",
      ...legalOptions,
    }).find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === instanceId &&
        a.skipOnly === true
    );
    expect(skip).toBeDefined();

    const declined = applyLegalAction({
      state: queued,
      action: skip!,
      ...legalOptions,
    }).state;

    expect(declined.pendingBattleEndDeferrals).toEqual([]);
    const resolved = finishBattle(declined);
    expect(resolved.players.find((p) => p.id === "bob")!.countValue).toBe(1);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === instanceId)!
        .exhaustState
    ).toBe("exhausted");
  });

  it("A面アタック後に転醒して現れたB面は、B面[2]を attack immediate で予約していなければ battle_end で発火しない", () => {
    const instanceId = "keine-back-after-front-attack";
    const { state } = makeMidBattleState(instanceId, 1);
    const resolved = finishBattle(state);

    expect(resolved.players.find((p) => p.id === "bob")!.countValue).toBe(1);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === instanceId)!
        .exhaustState
    ).toBe("exhausted");
    expect(
      resolved.log.some((line) =>
        line.includes(
          `battle:end-deferral:fire:${state.activeAttack!.attackId}:${instanceId}:2`
        )
      )
    ).toBe(false);
  });

  it("カウント0 (支払い不能) → battle_end deferral 発火後も conditional_cost ロールバックで回復せず、カウント・疲労状態とも不変", () => {
    const instanceId = "keine-back-lv3-no-count";
    const { state, attackId, entityId, spirit } = makeMidBattleState(
      instanceId,
      0
    );
    const queued = queueAttackImmediateEffect(
      state,
      spirit,
      attackId,
      entityId
    );
    const action = getLegalActions({
      state: queued,
      actingPlayerId: "bob",
      ...legalOptions,
    }).find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === instanceId &&
        a.executionMode === "optional" &&
        a.skipOnly !== true
    );
    expect(action).toBeDefined();

    const declared = applyLegalAction({
      state: queued,
      action: action!,
      ...legalOptions,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    const reserved = applyLegalAction({
      state: declared,
      action: pass!,
      ...legalOptions,
    }).state;

    const resolved = finishBattle(reserved);

    expect(resolved.players.find((p) => p.id === "bob")!.countValue).toBe(0);
    expect(
      resolved.cardInstances.find(
        (c) => c.instanceId === "keine-back-lv3-no-count"
      )!.exhaustState
    ).toBe("exhausted");
  });
});
