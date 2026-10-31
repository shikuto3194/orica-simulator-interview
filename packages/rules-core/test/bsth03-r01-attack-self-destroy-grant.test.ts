/**
 * BSTH03-R01 鈴仙・優曇華院・イナバ effects[0] (textRef[2,3])
 *   Lv3-Lv4『相手のアタックステップ開始時』相手のスピリット3体に
 *   "『このスピリットのアタック時』このスピリットを破壊する。" を与える。
 *
 * grant_effect (P3-99、template=BSTH05-X01) で card_event:attack を
 * grantedEffect として登録する。本テストは grant 後、実際に被付与カードが
 * アタックした際に自壊するところまで盤面変化として成立するかを検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type GameState,
} from "../src";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";

const inaba = ALL_CARDS.find((c) => c.cardNo === "BSTH03-R01");
if (!inaba) throw new Error("BSTH03-R01 not found in ALL_CARDS");
const INABA = inaba;
const guidedNexus = ALL_CARDS.find((c) => c.cardNo === "BSTH03-X02");
if (!guidedNexus) throw new Error("BSTH03-X02 not found in ALL_CARDS");
const GUIDED_NEXUS = guidedNexus;

const ALICE = "alice";
const BOB = "bob";

const OPPONENT_SPIRIT: CardDefinition = {
  cardNo: "TEST-OPPONENT-SPIRIT",
  name: "対戦相手テストスピリット",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: ["blue"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  tribe: "無関係",
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

function defs() {
  return new Map<string, CardDefinition>([
    [INABA.cardNo, INABA],
    [GUIDED_NEXUS.cardNo, GUIDED_NEXUS],
    [OPPONENT_SPIRIT.cardNo, OPPONENT_SPIRIT],
  ]);
}

function baseState(): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    activePlayerId: BOB,
    step: "attack",
    cardInstances: [
      createCardInstance(INABA, {
        instanceId: "inaba-1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(OPPONENT_SPIRIT, {
        instanceId: "opp-spirit-1",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(OPPONENT_SPIRIT, {
        instanceId: "opp-spirit-2",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  } as GameState;
}

describe("BSTH03-R01 effects[0]『相手のアタックステップ開始時』アタック時自壊付与", () => {
  it("structural: grant_effect (card_event:attack, duration:turn, destroy self) を配線", () => {
    const effect = INABA.effects?.find(
      (e) => JSON.stringify(e.textRef) === JSON.stringify([2, 3])
    );
    if (!effect)
      throw new Error("BSTH03-R01 effects[0] (textRef[2,3]) missing");
    expect(effect.stub).toBeUndefined();
    expect(effect.steps).toHaveLength(1);

    const grant = effect.steps[0]!.action;
    expect(grant.kind).toBe("grant_effect");
    if (grant.kind !== "grant_effect") throw new Error("expected grant_effect");
    if (grant.target.kind !== "filter")
      throw new Error("expected filter target");
    expect(grant.target.player).toBe("opponent");
    expect(grant.target.count).toBe(3);
    expect(grant.target.filter).toEqual({ category: ["spirit"] });
    expect(grant.duration).toEqual({ scope: "turn" });
    expect(grant.grantedEffect.timing).toEqual({
      kind: "card_event",
      event: "attack",
    });
    expect(grant.grantedEffect.executionMode).toBe("mandatory");
    const grantedStep = grant.grantedEffect.steps[0]!.action;
    expect(grantedStep.kind).toBe("destroy");
    if (grantedStep.kind !== "destroy") throw new Error("expected destroy");
    expect(grantedStep.target).toEqual({ kind: "self" });
  });

  it("execution: 発揮 → 相手スピリットへ自壊効果を付与 → アタック時に自壊する", () => {
    const effect = INABA.effects?.find(
      (e) => JSON.stringify(e.textRef) === JSON.stringify([2, 3])
    );
    if (!effect)
      throw new Error("BSTH03-R01 effects[0] (textRef[2,3]) missing");

    const state = executeEffect({
      chainId: "test:bsth03-r01-attack-self-destroy-grant:122",
      state: baseState(),
      effect,
      sourceInstanceId: "inaba-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => defs().get(id),
    });

    // grant_effect: 相手のスピリット2体(全候補)へ turn duration の CE が登録される。
    const grantCes = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "granted_effect"
    );
    expect(grantCes).toHaveLength(2);
    expect(grantCes.map((ce) => ce.targetInstanceId).sort()).toEqual([
      "opp-spirit-1",
      "opp-spirit-2",
    ]);
    for (const ce of grantCes) {
      expect(ce.duration).toEqual({ scope: "turn" });
    }

    // opp-spirit-1 のアタック時イベントで mechanic pending が積まれる。
    const withPending = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:bsth03-r01-attack-self-destroy-grant:147",
          eventKind: "attack",
          relatedInstanceId: "opp-spirit-1",
          relatedPlayerId: BOB,
        },
      ],
      (id) => defs().get(id)
    );
    const pending = withPending.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "granted_effect"
    );
    expect(pending).toBeDefined();
    expect(pending!.relatedInstanceId).toBe("opp-spirit-1");

    // 受諾 → スタック窓を発揮側パスで閉じて解決まで進める。
    const getDef = (id: string) => defs().get(id);
    const actions = getLegalActions({
      state: withPending,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
    });
    const resolveAction = actions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pending!.pendingId
    );
    expect(resolveAction).toBeDefined();
    let current = (
      applyLegalAction({
        state: withPending,
        action: resolveAction!,
        getCardDefinitionById: getDef,
      }) as { state: GameState }
    ).state;

    let guard = 0;
    while (current.stackWindow && guard++ < 10) {
      const responderId = current.stackWindow.priorityPlayerId;
      const passActions = getLegalActions({
        state: current,
        actingPlayerId: responderId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
      });
      const pass = passActions.find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = (
        applyLegalAction({
          state: current,
          action: pass!,
          getCardDefinitionById: getDef,
        }) as { state: GameState }
      ).state;
    }

    const attackedSpirit = current.cardInstances.find(
      (c) => c.instanceId === "opp-spirit-1"
    );
    expect(attackedSpirit?.zone).toBe("trash");
  });
});

describe("BSTH03-R01 effects[1]『このアルティメットのアタック時』指定ブロック不可 + 効果封印 + 紫導界者 trash→life", () => {
  const effect = INABA.effects?.find(
    (e) => JSON.stringify(e.textRef) === JSON.stringify([5, 6])
  );
  if (!effect) throw new Error("BSTH03-R01 effects[1] (textRef[5,6]) missing");

  it("structural: 指定対象を block 不可 + blanket suppress_effect し、紫導界者条件で trash→life optional", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(effect.condition).toEqual([{ kind: "min_level", value: 4 }]);

    const prevent = effect.steps[0]!;
    expect(prevent.id).toBe("designate");
    expect(prevent.action.kind).toBe("prevent_battle");
    if (prevent.action.kind === "prevent_battle") {
      expect(prevent.action.restriction).toEqual(["block"]);
      expect(prevent.action.duration).toEqual({ scope: "turn" });
      expect(prevent.action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"] },
        count: 1,
      });
    }

    const suppress = effect.steps[1]!;
    expect(suppress.connector).toBe("simultaneous");
    expect(suppress.action).toEqual({
      kind: "suppress_effect",
      target: { kind: "ref", stepId: "designate" },
      duration: { scope: "turn" },
    });

    const core = effect.steps[2]!;
    expect(core.connector).toBe("simultaneous");
    expect(core.executionMode).toBe("optional");
    expect(core.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["nexus"],
        colors: ["purple"],
        tribes: ["導界者"],
        grandwalkerKind: "guided",
      },
    ]);
    expect(core.action).toEqual({
      kind: "core_move",
      from: { kind: "trash", player: "self" },
      to: { kind: "life", player: "self" },
      amount: 1,
    });
  });

  it("execution: 指定対象に block 不可 + 効果封印を登録し、紫導界者がいれば optional execute で trash→life する", () => {
    const getDef = (id: string) => defs().get(id);
    const source = createCardInstance(INABA, {
      instanceId: "inaba-r01-lock",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const guide = createCardInstance(GUIDED_NEXUS, {
      instanceId: "guided-purple",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(OPPONENT_SPIRIT, {
      instanceId: "r01-lock-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, guide, target],
      playerOverrides: [
        { trashNormalCoreCount: 1, lifeNormalCoreCount: 3 },
        {},
      ],
    });

    const pending = executeEffect({
      chainId: "test:bsth03-r01-attack-self-destroy-grant:296",
      state,
      effect,
      sourceInstanceId: "inaba-r01-lock",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      targetInstanceIds: ["r01-lock-target"],
    });

    expect(
      pending.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "prevent_battle_block" &&
          ce.targetInstanceId === "r01-lock-target"
      )
    ).toBe(true);
    const suppression = pending.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.targetInstanceId === "r01-lock-target"
    );
    expect(suppression).toBeDefined();
    expect(suppression?.metadata?.effectFilter).toBeUndefined();

    const psoc = pending.pendingStepOptionalChoice;
    expect(psoc).not.toBeNull();
    expect(psoc!.stepIndex).toBe(2);
    const resolved = applyLegalAction({
      state: pending,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc!.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc!.actingPlayerId,
        pendingId: psoc!.pendingId,
        sourceInstanceId: psoc!.sourceInstanceId,
        effectIndex: psoc!.effectIndex,
        stepIndex: psoc!.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
    }).state;

    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.lifeNormalCoreCount).toBe(4);
    expect(resolved.pendingStepOptionalChoice).toBeNull();
  });

  it("execution: trash の通常+soul 混在時は owner choice で soul をライフへ置ける", () => {
    const getDef = (id: string) => defs().get(id);
    const source = createCardInstance(INABA, {
      instanceId: "inaba-r01-lock-soul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const guide = createCardInstance(GUIDED_NEXUS, {
      instanceId: "guided-purple-soul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(OPPONENT_SPIRIT, {
      instanceId: "r01-lock-target-soul",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, guide, target],
      playerOverrides: [
        {
          trashNormalCoreCount: 1,
          lifeNormalCoreCount: 3,
          soulCoreLocation: { kind: "trash" },
        },
        {},
      ],
    });

    const pendingOptional = executeEffect({
      chainId: "test:bsth03-r01-attack-self-destroy-grant:382",
      state,
      effect,
      sourceInstanceId: "inaba-r01-lock-soul",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      targetInstanceIds: ["r01-lock-target-soul"],
    });
    const psoc = pendingOptional.pendingStepOptionalChoice;
    expect(psoc).not.toBeNull();

    const pendingCoreChoice = applyLegalAction({
      state: pendingOptional,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc!.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc!.actingPlayerId,
        pendingId: psoc!.pendingId,
        sourceInstanceId: psoc!.sourceInstanceId,
        effectIndex: psoc!.effectIndex,
        stepIndex: psoc!.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
    }).state;

    const lcs = pendingCoreChoice.pendingLifeCoreSelection;
    expect(lcs).not.toBeNull();
    expect(lcs).toMatchObject({
      actingPlayerId: ALICE,
      normalAvailable: 1,
      soulAvailable: 1,
      totalAmount: 1,
      fromLocation: { kind: "trash", player: "self" },
      toLocation: { kind: "life", player: "self" },
    });
    const action = getLegalActions({
      state: pendingCoreChoice,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_life_core_selection");
    expect(action).toBeDefined();

    const resolvedSoul = applyLegalAction({
      state: pendingCoreChoice,
      action: action!,
      getCardDefinitionById: getDef,
      lifeCorePartitionChoice: { normalChosen: 0, soulChosen: 1 },
    }).state;

    const alice = resolvedSoul.players.find((p) => p.id === ALICE)!;
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.lifeNormalCoreCount).toBe(3);
    expect(alice.soulCoreLocation).toEqual({ kind: "life" });
    expect(alice.trashSoulCoreCount).toBe(0);
    expect(alice.lifeSoulCoreCount).toBe(1);
    expect(resolvedSoul.pendingLifeCoreSelection).toBeNull();
  });

  it("execution: trash が soul のみでも generic コアとしてライフへ置ける", () => {
    const getDef = (id: string) => defs().get(id);
    const source = createCardInstance(INABA, {
      instanceId: "inaba-r01-lock-soul-only",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const guide = createCardInstance(GUIDED_NEXUS, {
      instanceId: "guided-purple-soul-only",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(OPPONENT_SPIRIT, {
      instanceId: "r01-lock-target-soul-only",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, guide, target],
      playerOverrides: [
        {
          trashNormalCoreCount: 0,
          lifeNormalCoreCount: 3,
          soulCoreLocation: { kind: "trash" },
        },
        {},
      ],
    });

    const pending = executeEffect({
      chainId: "test:bsth03-r01-attack-self-destroy-grant:479",
      state,
      effect,
      sourceInstanceId: "inaba-r01-lock-soul-only",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      targetInstanceIds: ["r01-lock-target-soul-only"],
    });
    const psoc = pending.pendingStepOptionalChoice;
    expect(psoc).not.toBeNull();

    const resolved = applyLegalAction({
      state: pending,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc!.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc!.actingPlayerId,
        pendingId: psoc!.pendingId,
        sourceInstanceId: psoc!.sourceInstanceId,
        effectIndex: psoc!.effectIndex,
        stepIndex: psoc!.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
    }).state;

    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.lifeNormalCoreCount).toBe(3);
    expect(alice.soulCoreLocation).toEqual({ kind: "life" });
    expect(alice.trashSoulCoreCount).toBe(0);
    expect(alice.lifeSoulCoreCount).toBe(1);
    expect(resolved.pendingStepOptionalChoice).toBeNull();
    expect(resolved.pendingLifeCoreSelection).toBeNull();
  });

  it("execution: count-only trash soul も generic コアとしてライフへ置き、primary pointer は温存する", () => {
    const getDef = (id: string) => defs().get(id);
    const source = createCardInstance(INABA, {
      instanceId: "inaba-r01-lock-count-only-soul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const guide = createCardInstance(GUIDED_NEXUS, {
      instanceId: "guided-purple-count-only-soul",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(OPPONENT_SPIRIT, {
      instanceId: "r01-lock-target-count-only-soul",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, guide, target],
      playerOverrides: [
        {
          trashNormalCoreCount: 0,
          reserveSoulCoreCount: 1,
          trashSoulCoreCount: 1,
          lifeNormalCoreCount: 3,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    });

    const pending = executeEffect({
      chainId: "test:bsth03-r01-attack-self-destroy-grant:555",
      state,
      effect,
      sourceInstanceId: "inaba-r01-lock-count-only-soul",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      targetInstanceIds: ["r01-lock-target-count-only-soul"],
    });
    const psoc = pending.pendingStepOptionalChoice;
    expect(psoc).not.toBeNull();

    const resolved = applyLegalAction({
      state: pending,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc!.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc!.actingPlayerId,
        pendingId: psoc!.pendingId,
        sourceInstanceId: psoc!.sourceInstanceId,
        effectIndex: psoc!.effectIndex,
        stepIndex: psoc!.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
    }).state;

    const alice = resolved.players.find((p) => p.id === ALICE)!;
    expect(alice.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(alice.reserveSoulCoreCount).toBe(1);
    expect(alice.trashSoulCoreCount).toBe(0);
    expect(alice.lifeSoulCoreCount).toBe(1);
    expect(alice.lifeNormalCoreCount).toBe(3);
    expect(resolved.pendingStepOptionalChoice).toBeNull();
    expect(resolved.pendingLifeCoreSelection).toBeNull();
  });
});
