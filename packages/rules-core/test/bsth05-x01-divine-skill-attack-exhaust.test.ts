/**
 * BSTH05-X01 [創界神]八坂 神奈子 grandwalkerData.divineSkills[0]
 *   【転神：5】Lv1-Lv2 フラッシュ『自分のアタックステップ』
 *   〔コア5個をボイドに置く〕このターンの間、系統：「アシハラ」を持つ自分の創界神ネクサスすべては、
 *   Lv1/Lv2/BP3000、"『このスピリットのアタック時』相手のスピリット/アルティメット1体を疲労させる。"
 *   を持つスピリットとしても扱い、創界神ネクサス以外では破壊されない。
 *
 * divine_transform (BP/Lv 付与) 自体は既存実装済み。本テストが検証するのは追加した
 * grant_effect ステップ（BSDB01-R03 と同型、card_event:attack + duration:turn）が
 * 実際に「このスピリットのアタック時」相手1体を疲労させるところまで盤面変化として成立するか。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getAvailableDivineSkillLegalActions,
  type CardDefinition,
  type GameState,
} from "../src/runtime";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";

const kanako = ALL_CARDS.find((c) => c.cardNo === "BSTH05-X01");
if (!kanako) throw new Error("BSTH05-X01 not found in ALL_CARDS");
const KANAKO = kanako;

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
    [KANAKO.cardNo, KANAKO],
    [OPPONENT_SPIRIT.cardNo, OPPONENT_SPIRIT],
  ]);
}

function baseState(): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    activePlayerId: ALICE,
    step: "attack",
    cardInstances: [
      createCardInstance(KANAKO, {
        instanceId: "kanako-1",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "nexus",
        normalCoreCount: 5,
      }),
      createCardInstance(OPPONENT_SPIRIT, {
        instanceId: "opp-spirit-1",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  } as GameState;
}

describe("BSTH05-X01 divineSkills[0] 【転神：5】", () => {
  it("転神宣言では支払わず、窓後に5コアをボイドへ移し自己アシハラ全体に転神と攻撃効果を付与する", () => {
    const getDef = (id: string) => defs().get(id);
    const base = baseState();
    let state: GameState = {
      ...base,
      window: "flash_before_block",
      battleEntities: [
        {
          entityId: "kanako-test-attacker",
          memberInstanceIds: ["attacker"],
          resolvedBp: 3000,
          resolvedSymbols: ["blue"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "kanako-test-attack",
        primaryEntityId: "kanako-test-attacker",
        participantEntityIds: ["kanako-test-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "kanako-test-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["kanako-test-attacker"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: ALICE,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: null,
        },
      },
      cardInstances: [
        ...base.cardInstances,
        createCardInstance(OPPONENT_SPIRIT, {
          instanceId: "attacker",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
        }),
        createCardInstance(KANAKO, {
          instanceId: "kanako-2",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 0,
        }),
        createCardInstance(KANAKO, {
          instanceId: "kanako-bob",
          ownerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
    };
    const action = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((candidate) => candidate.sourceInstanceId === "kanako-1");
    expect(action).toBeDefined();
    const voidBefore = state.players.find(
      (player) => player.id === ALICE
    )!.voidNormalCoreCount;
    state = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: getDef,
    }).state;
    expect(
      state.activeAttack?.flashWindowState?.pendingStackAction?.actionKind
    ).toBe("divine_skill");
    expect(
      state.cardInstances.find((card) => card.instanceId === "kanako-1")!
        .normalCoreCount
    ).toBe(5);
    expect(
      state.cardInstances.find((card) => card.instanceId === "kanako-1")!
        .divineTransformState
    ).toBeNull();
    for (
      let guard = 0;
      state.activeAttack?.flashWindowState?.pendingStackAction && guard < 10;
      guard++
    ) {
      const pass = getLegalActions({
        state,
        actingPlayerId: state.activeAttack.flashWindowState.priorityPlayerId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
      }).find((candidate) => candidate.kind === "pass_battle_flash");
      expect(pass).toBeDefined();
      state = applyLegalAction({
        state,
        action: pass!,
        getCardDefinitionById: getDef,
      }).state;
    }
    expect(state.stackWindow).toBeNull();
    expect(state.activeAttack?.flashWindowState?.pendingStackAction).toBeNull();
    expect(state.activeAttack?.flashWindowState?.kind).toBe("before_block");
    expect(
      state.players.find((player) => player.id === ALICE)!.voidNormalCoreCount
    ).toBe(voidBefore + 5);
    expect(
      state.cardInstances.find((card) => card.instanceId === "kanako-1")!
        .normalCoreCount
    ).toBe(0);
    for (const id of ["kanako-1", "kanako-2"]) {
      expect(
        state.cardInstances.find((card) => card.instanceId === id)!
          .divineTransformState
      ).toEqual({
        bpByLevel: [
          { level: 1, bp: 3000 },
          { level: 2, bp: 3000 },
        ],
        protectedFromNonGrandwalker: true,
      });
      expect(
        state.activeContinuousEffects.some(
          (effect) =>
            effect.modifierTag === "granted_effect" &&
            effect.targetInstanceId === id
        )
      ).toBe(true);
    }
    expect(
      state.cardInstances.find((card) => card.instanceId === "kanako-bob")!
        .divineTransformState
    ).toBeNull();
    expect(
      state.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "granted_effect" &&
          effect.targetInstanceId === "kanako-bob"
      )
    ).toBe(false);
  });

  it("structural: divine_transform に続けて grant_effect (card_event:attack, duration:turn, exhaust 1体) を配線", () => {
    const skill = KANAKO.grandwalkerData?.divineSkills?.[0];
    if (!skill) throw new Error("BSTH05-X01 divineSkills[0] missing");
    const steps = skill.effects[0]!.steps;
    expect(steps).toHaveLength(2);

    expect(steps[0]!.action.kind).toBe("divine_transform");

    const grant = steps[1]!.action;
    expect(grant.kind).toBe("grant_effect");
    if (grant.kind !== "grant_effect") throw new Error("expected grant_effect");
    expect(grant.duration).toEqual({ scope: "turn" });
    expect(grant.grantedEffect.timing).toEqual({
      kind: "card_event",
      event: "attack",
    });
    expect(grant.grantedEffect.executionMode).toBe("mandatory");
    const grantedStep = grant.grantedEffect.steps[0]!.action;
    expect(grantedStep.kind).toBe("exhaust");
    if (grantedStep.kind !== "exhaust") throw new Error("expected exhaust");
    if (grantedStep.target.kind !== "filter")
      throw new Error("expected filter target");
    expect(grantedStep.target.player).toBe("opponent");
    expect(grantedStep.target.count).toBe(1);
    expect(grantedStep.target.filter).toEqual({
      category: ["spirit", "ultimate"],
    });

    // card 側 stub bookkeeping エントリは stub フィールドを持たない（実装済み）。
    const bookkeeping = KANAKO.effects?.find(
      (e) =>
        e.timing.kind === "activated" &&
        e.timing.mode === "flash" &&
        JSON.stringify(e.textRef) === JSON.stringify([8, 9])
    );
    expect(bookkeeping?.stub).toBeUndefined();
  });

  it("execution: 転神発動 → 疲労付与 CE 登録 → 自分のアタック時に相手スピリットを疲労させる", () => {
    const skill = KANAKO.grandwalkerData?.divineSkills?.[0];
    if (!skill) throw new Error("BSTH05-X01 divineSkills[0] missing");
    const state = executeEffect({
      chainId: "test:bsth05-x01-divine-skill-attack-exhaust:120",
      state: baseState(),
      effect: skill.effects[0]!,
      sourceInstanceId: "kanako-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => defs().get(id),
    });

    // divine_transform: kanako がスピリットとして扱われる状態になる。
    const kanakoAfterTransform = state.cardInstances.find(
      (c) => c.instanceId === "kanako-1"
    )!;
    expect(kanakoAfterTransform.divineTransformState).toBeDefined();

    // grant_effect: 疲労付与 CE が kanako-1 に turn duration で登録される。
    const grantCe = state.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "granted_effect" &&
        ce.targetInstanceId === "kanako-1"
    );
    expect(grantCe).toBeDefined();
    expect(grantCe!.duration).toEqual({ scope: "turn" });

    // kanako のアタック時イベントで mechanic pending が積まれる。
    const withPending = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:bsth05-x01-divine-skill-attack-exhaust:147",
          eventKind: "attack",
          relatedInstanceId: "kanako-1",
          relatedPlayerId: ALICE,
        },
      ],
      (id) => defs().get(id)
    );
    const pending = withPending.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "granted_effect"
    );
    expect(pending).toBeDefined();
    expect(pending!.relatedInstanceId).toBe("kanako-1");

    // 受諾 → スタック窓を相手パスで閉じて解決まで進める。
    const getDef = (id: string) => defs().get(id);
    const actions = getLegalActions({
      state: withPending,
      actingPlayerId: ALICE,
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

    const oppSpirit = current.cardInstances.find(
      (c) => c.instanceId === "opp-spirit-1"
    )!;
    expect(oppSpirit.exhaustState).toBe("exhausted");
  });
});
