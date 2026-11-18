/**
 * P2-05 Phase 5: 途中合流アタック (allow_mid_battle_join CE + join_active_attack legal action) の検証。
 *
 * 正源: BSTH07.8-XX01【導域】残り1文
 * 「召喚した系統：「妖精」を持つ自分のスピリットは、相手のブロック宣言前なら、ただちにアタックできる」
 * - 「召喚した」= 自分のアタックステップ中に召喚された個体 (summonedDuringAttackStepInstanceIds)
 * - 召喚・神託等の完了後に参加／辞退を選ぶ。通常フラッシュの優先権を待たない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildCirnoDivineReleasePaymentScenario } from "../../../apps/playground-web/src/scenario-cirno-divine-release-payment";
import {
  applyLegalAction,
  buildHandActivatedEffectLookup,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  getCurrentActorPlayerIds,
} from "../src";
import { playSummonAsAction } from "../src/play/play-card-system";
import { queueEffectActivationTriggers } from "../src/effect/trigger-system";
import type {
  AttackLegalAction,
  CardDefinition,
  GameState,
  JoinActiveAttackLegalAction,
  LegalAction,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

// 系統: 幻想・妖精, コスト0 (召喚テスト簡略化用)
const fairyZeroCost: CardDefinition = {
  cardNo: "TEST-FAIRY-ZERO-001",
  name: "Test Fairy Zero Cost",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 0,
  reductionSymbols: ["green"],
  levelDefs: [
    { level: 1, requiredCores: 0, bp: 1000 },
    { level: 2, requiredCores: 2, bp: 2000 },
  ],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  tribe: "幻想・妖精",
  sourceUrls: [],
  sourceConfidence: "C",
};

// 非妖精 (フィルタ除外検証用)、コスト0
const nonFairyZeroCost: CardDefinition = {
  cardNo: "TEST-NONFAIRY-ZERO-001",
  name: "Test Non Fairy Zero Cost",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: ["red"],
  levelDefs: [
    { level: 1, requiredCores: 0, bp: 1000 },
    { level: 2, requiredCores: 2, bp: 2000 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const bpBraveDefinition: CardDefinition = {
  cardNo: "TEST-JOIN-BP-BRAVE-001",
  name: "Test Join BP Brave",
  printedCategory: "brave",
  colors: ["green"],
  cost: 2,
  reductionSymbols: ["green"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  braveCondition: { categories: ["spirit"] },
  combinedBoost: 3000,
  sourceUrls: [],
  sourceConfidence: "C",
};

const preDeclarationStackMagic: CardDefinition = {
  cardNo: "TEST-JOIN-PRE-DECLARATION-STACK-MAGIC-001",
  name: "Test Join Pre-declaration Stack Magic",
  printedCategory: "magic",
  colors: ["green"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  id === fairyZeroCost.cardNo
    ? fairyZeroCost
    : id === nonFairyZeroCost.cardNo
      ? nonFairyZeroCost
      : id === bpBraveDefinition.cardNo
        ? bpBraveDefinition
        : id === preDeclarationStackMagic.cardNo
          ? preDeclarationStackMagic
          : id === nonFairyBlocker.cardNo
            ? nonFairyBlocker
            : cardNoMap.get(id);

const xx01 = cardNoMap.get("BSTH07.8-XX01")!;
const fairy = cardNoMap.get("BSTH07.8-C01")!; // 系統: 幻想・妖精, 緑シンボル1
const nonFairyBlocker: CardDefinition = {
  cardNo: "TEST-BLOCKER-001",
  name: "Test Blocker",
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

/**
 * alice: XX01 導界者ネクサス + 妖精1体 (アタッカー) + 手札に召喚テスト用カード。
 * bob: ブロッカー1体。step=attack, alice ターン。【導域】CE を登録する。
 */
function createJoinTestState(options?: {
  registerGrant?: boolean;
  includePreDeclarationStackMagic?: boolean;
}): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    startingVoidNormalCoreCount: 0,
    playerOverrides: [{ handCount: 2 }, {}],
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
      createCardInstance(fairyZeroCost, {
        instanceId: "hand-fairy-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(nonFairyZeroCost, {
        instanceId: "hand-nonfairy-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(nonFairyBlocker, {
        instanceId: "blocker-1",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      ...(options?.includePreDeclarationStackMagic
        ? [
            createCardInstance(preDeclarationStackMagic, {
              instanceId: "join-stack-magic-1",
              ownerPlayerId: "bob",
              zone: "hand",
            }),
          ]
        : []),
    ],
  });
  const state: GameState = {
    ...base,
    step: "attack",
    turnNumber: 2,
    activePlayerId: "alice",
  };
  if (options?.registerGrant === false) return state;
  // XX01 effects[1] = 【導域】Lv1-Lv2『自分のアタックステップ』
  // (同時アタック許可 + 途中合流許可 + マジック軽減 + アタックステップ強制終了)
  return executeEffect({
    chainId: "test:p2-05-mid-battle-join:195",
    state,
    effect: xx01.effects![1]!,
    sourceInstanceId: "xx01-1",
    actingPlayerId: "alice",
    getCardDefinitionById,
  });
}

function getActions(
  state: GameState,
  actingPlayerId: string,
  options?: { includePreDeclarationStackMagic?: boolean }
): LegalAction[] {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    ...(options?.includePreDeclarationStackMagic
      ? {
          getRegisteredMagicActions: (cardNo: string) =>
            cardNo === preDeclarationStackMagic.cardNo
              ? [
                  {
                    timing: "stack" as const,
                    reason: "join_active_attack_pre_declaration_response",
                  },
                ]
              : undefined,
        }
      : {}),
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

/** fairy-1 の単独アタックを宣言し、宣言前スタック窓の confirm まで進める (flash 窓は未消化)。 */
function declareSingleAttackWithoutClosingFlash(state: GameState): GameState {
  const attackAction = getActions(state, "alice").find(
    (a): a is AttackLegalAction =>
      a.kind === "attack" &&
      a.sourceInstanceId === "fairy-1" &&
      a.targetInstanceId === undefined
  );
  expect(attackAction).toBeDefined();
  const declared = apply(state, attackAction!);
  return passPreDeclarationStack(declared);
}

/** fairy-1 の単独アタックを宣言し、window:"declare_attack" (flash 窓済み) まで進める。 */
function declareSingleAttack(state: GameState): GameState {
  return closeBattleFlashWindow(declareSingleAttackWithoutClosingFlash(state));
}

/** 手札のカードをアタックステップ中に (コスト0/フリー) 召喚する。 */
function summonDuringAttackStep(
  state: GameState,
  cardInstanceId: string
): GameState {
  return playSummonAsAction({
    state,
    actingPlayerId: "alice",
    cardInstanceId,
    paymentSources: [],
    allowNonMainStep: true,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => undefined,
  }).state;
}

describe("BSTH07.8-XX01【導域】途中合流アタック (allow_mid_battle_join)", () => {
  it.each(
    [
      ["designated", "join_active_attack"],
      ["designated", "decline_immediate_attack_join"],
      ["forced", "join_active_attack"],
      ["forced", "decline_immediate_attack_join"],
      ["designated", "unavailable"],
      ["forced", "unavailable"],
    ].flatMap(([mode, choice]) =>
      [false, true].map(
        (pendingCompletion) => [mode, choice, pendingCompletion] as const
      )
    )
  )(
    "%s の攻撃時召喚は即時参加=%s・発揮完了待ち=%s を処理してから強制ブロックへ再開する",
    (mode, choice, pendingCompletion) => {
      const summonedId =
        choice === "unavailable" ? "hand-nonfairy-1" : "hand-fairy-1";
      let state = declareSingleAttackWithoutClosingFlash(createJoinTestState());
      // 攻撃時効果解決中の指定対象/強制ブロック予約を再現する。
      state = {
        ...state,
        activeAttack: {
          ...state.activeAttack!,
          ...(mode === "designated"
            ? {
                target: {
                  kind: "battle_entity" as const,
                  entityId: "battle-entity:blocker-1",
                },
                designatedTargetInstanceId: "blocker-1",
              }
            : { forcedBlockerInstanceId: "blocker-1" }),
        },
      };
      state = executeEffect({
        chainId: `test:mid-battle-designated-entry:${mode}:${choice}`,
        state,
        effect: {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        },
        sourceInstanceId: summonedId,
        actingPlayerId: "alice",
        getCardDefinitionById,
        summonPaymentSources: [],
      });
      if (pendingCompletion) {
        state = queueEffectActivationTriggers({
          chainId: `test:mid-battle-designated-entry:${mode}:${choice}`,
          state,
          activatorPlayerId: "alice",
          relatedInstanceId: summonedId,
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions: () => [],
          getRegisteredBurstActions: () => undefined,
        });
        expect(state.pendingEffectCompletions).toHaveLength(1);
      }
      expect(state.pendingMultiPlacement).not.toBeNull();
      const placement = getActions(state, "alice").find(
        (action) => action.kind === "resolve_pending_multi_placement"
      );
      expect(placement).toBeDefined();
      state = applyLegalAction({
        state,
        action: placement!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => undefined,
        multiPlacementAllocations: [
          { destinationInstanceId: summonedId, placements: [] },
        ],
      }).state;
      if (choice === "unavailable") {
        expect(state.preDeclarationStackWindow?.kind).toBe("forced_block");
        state = passPreDeclarationStack(state);
        expect(state.window).toBe("declare_block");
        expect(state.pendingImmediateAttackJoins).toEqual([]);
        expect(state.activeAttack?.participantEntityIds).toHaveLength(1);
        return;
      }
      expect(state.preDeclarationStackWindow).toBeNull();
      expect(
        getActions(state, "alice")
          .map((action) => action.kind)
          .sort()
      ).toEqual(["decline_immediate_attack_join", "join_active_attack"]);
      expect(getActions(state, "bob")).toEqual([]);
      const decision = getActions(state, "alice").find(
        (action) => action.kind === choice
      );
      state = apply(state, decision!);
      if (choice === "join_active_attack") {
        expect(state.preDeclarationStackWindow?.kind).toBe(
          "join_active_attack"
        );
        state = passPreDeclarationStack(state);
      }
      expect(state.pendingImmediateAttackJoins).toEqual([]);
      expect(state.activeAttack?.participantEntityIds).toHaveLength(
        choice === "join_active_attack" ? 2 : 1
      );
      expect(state.preDeclarationStackWindow?.kind).toBe("forced_block");
      state = passPreDeclarationStack(state);
      expect(state.window).toBe("declare_block");
      expect(
        state.activeAttack?.blockAssignments[0]?.blockedByEntityIds
      ).toContain("battle-entity:blocker-1");
    }
  );

  it.each([false, true])(
    "ブレイヴ召喚の直接合体=%sでは独立した場入りだけを記録する",
    (combined) => {
      const base = createJoinTestState();
      const state = playSummonAsAction({
        state: {
          ...base,
          players: base.players.map((p) =>
            p.id === "alice" ? { ...p, reserveNormalCoreCount: 5 } : p
          ),
          cardInstances: [
            ...base.cardInstances,
            createCardInstance(bpBraveDefinition, {
              instanceId: "summoned-brave",
              ownerPlayerId: "alice",
              zone: "hand",
            }),
          ],
        },
        actingPlayerId: "alice",
        cardInstanceId: "summoned-brave",
        paymentSources: [],
        fixedPaymentCost: 0,
        allowNonMainStep: true,
        ...(combined ? { combineHostInstanceId: "fairy-1" } : {}),
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      expect(
        state.cardInstances.find((c) => c.instanceId === "summoned-brave")
      ).toMatchObject({
        zone: "field",
        attachedToInstanceId: combined ? "fairy-1" : null,
      });
      expect(state.summonedDuringAttackStepInstanceIds ?? []).toEqual(
        combined ? [] : ["summoned-brave"]
      );
    }
  );

  it.each(["resolve", "abort"])(
    "効果召喚の場入りコア選択は確定まで記録せず、%s後も未成立の個体を残さない",
    (mode) => {
      let state = declareSingleAttackWithoutClosingFlash(createJoinTestState());
      state = executeEffect({
        chainId: "test:mid-battle-entry-cores",
        state,
        effect: {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        },
        sourceInstanceId: "hand-fairy-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
        summonPaymentSources: [],
      });
      expect(state.pendingMultiPlacement).not.toBeNull();
      expect(state.summonedDuringAttackStepInstanceIds ?? []).not.toContain(
        "hand-fairy-1"
      );
      expect(
        getActions(state, "alice").some((a) => a.kind === "join_active_attack")
      ).toBe(false);
      const action = getActions(state, "alice").find(
        (a) =>
          a.kind ===
          (mode === "resolve"
            ? "resolve_pending_multi_placement"
            : "abort_pending_multi_placement")
      );
      expect(action).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        multiPlacementAllocations: [
          { destinationInstanceId: "hand-fairy-1", placements: [] },
        ],
      }).state;
      expect(state.summonedDuringAttackStepInstanceIds ?? []).toEqual(
        mode === "resolve" ? ["hand-fairy-1"] : []
      );
      if (mode === "abort")
        expect(
          getActions(state, "alice").some(
            (a) => a.kind === "join_active_attack"
          )
        ).toBe(false);
    }
  );

  it("召喚イベントでも場外・合体部品は記録せず、同じイベントの再収集でも重複しない", () => {
    const base = createJoinTestState();
    const before = {
      ...base,
      cardInstances: base.cardInstances.map((c) =>
        c.instanceId === "hand-fairy-1"
          ? createCardInstance(bpBraveDefinition, {
              instanceId: c.instanceId,
              ownerPlayerId: "alice",
              zone: "hand",
            })
          : c
      ),
    };
    const after: GameState = {
      ...before,
      cardInstances: before.cardInstances.map((c) =>
        c.instanceId === "hand-fairy-1"
          ? { ...c, zone: "field", attachedToInstanceId: "fairy-1" }
          : c.instanceId === "hand-nonfairy-1"
            ? { ...c, zone: "trash" }
            : c
      ),
    };
    const collect = (state: GameState) =>
      collectAndQueueTriggerReactions({
        beforeState: before,
        afterState: state,
        source: "action_resolution",
        chainId: "test:mid-battle-summon-facts",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
        supplementalEvents: ["hand-fairy-1", "hand-nonfairy-1"].map(
          (relatedInstanceId) => ({
            eventKind: "summon",
            actingPlayerId: "alice",
            relatedPlayerId: "alice",
            relatedInstanceId,
            source: "action_resolution",
            chainId: "test:mid-battle-summon-facts",
            attackId: null,
            amount: null,
          })
        ),
      });
    expect(collect(after).summonedDuringAttackStepInstanceIds ?? []).toEqual(
      []
    );
    const standalone = {
      ...after,
      cardInstances: after.cardInstances.map((c) =>
        c.instanceId === "hand-fairy-1"
          ? { ...c, attachedToInstanceId: null }
          : c
      ),
    };
    const recorded = collect(standalone);
    expect(recorded.summonedDuringAttackStepInstanceIds).toEqual([
      "hand-fairy-1",
    ]);
    expect(collect(recorded).summonedDuringAttackStepInstanceIds).toEqual([
      "hand-fairy-1",
    ]);
  });

  it.each(["alice", "bob"])(
    "%sの前半フラッシュで実カードX01を界放召喚し、同じgroupへ合流できる",
    (owner) => {
      const opponent = owner === "alice" ? "bob" : "alice";
      let state = buildCirnoDivineReleasePaymentScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      const attackId = state.activeAttack!.attackId;
      const lookups = {
        getCardDefinitionById,
        getRegisteredHandActivatedEffectActions:
          buildHandActivatedEffectLookup(ALL_CARDS),
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredFieldCardEffectActions: () => [],
      };
      const actions = (player: string) =>
        getLegalActions({ state, actingPlayerId: player, ...lookups });
      const act = (player: string, kind: LegalAction["kind"], extra = {}) => {
        const action = actions(player).find(
          (a) =>
            a.kind === kind &&
            (a.kind !== "use_hand_card_effect" ||
              (a.sourceInstanceId === "cirno" && a.effectIndex === 2))
        );
        expect(action, kind).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...lookups,
          ...extra,
        }).state;
      };
      act(owner, "use_hand_card_effect");
      act(opponent, "pass_battle_flash");
      expect(state.summonedDuringAttackStepInstanceIds ?? []).not.toContain(
        "cirno"
      );
      act(owner, "resolve_pending_effect_summon_cost_payment", {
        summonPaymentSources: [
          { kind: "card", instanceId: "payer", amount: 1 },
        ],
      });
      if (state.pendingMultiPlacement) {
        expect(state.summonedDuringAttackStepInstanceIds ?? []).not.toContain(
          "cirno"
        );
        act(owner, "resolve_pending_multi_placement", {
          multiPlacementAllocations: [
            { destinationInstanceId: "cirno", placements: [] },
          ],
        });
      }
      for (let i = 0; i < 12; i++) {
        const reaction = [owner, opponent]
          .flatMap(actions)
          .find(
            (a) =>
              (a.kind === "resolve_pending_burst_check" &&
                !a.sourceInstanceId) ||
              (a.kind === "resolve_pending_triggered_effect" &&
                a.eventKind === "oracle")
          );
        if (!reaction) break;
        expect(
          actions(owner).some((a) => a.kind === "join_active_attack")
        ).toBe(false);
        state = applyLegalAction({
          state,
          action: reaction,
          ...lookups,
          skipOptionalEffect: true,
        }).state;
      }
      expect([...getCurrentActorPlayerIds(state, lookups)]).toEqual([owner]);
      expect([...getCurrentActorPlayerIds(state)]).toEqual([owner]);
      expect(state.window).toBe("flash_before_block");
      expect(state.summonedDuringAttackStepInstanceIds).toEqual(["cirno"]);
      expect(
        actions(opponent).some((a) => a.kind === "join_active_attack")
      ).toBe(false);
      // 召喚と誘発の完了直後に選択する。相手のフラッシュはまだ進めない。
      expect(actions(opponent)).toEqual([]);
      expect(actions(owner).some((a) => a.kind === "pass_battle_flash")).toBe(
        false
      );
      const join = actions(owner).find(
        (a) => a.kind === "join_active_attack" && a.sourceInstanceId === "cirno"
      );
      expect(join).toBeDefined();
      const participants = [...state.activeAttack!.participantEntityIds];
      act(owner, "join_active_attack");
      expect(state.preDeclarationStackWindow?.kind).toBe("join_active_attack");
      expect(state.activeAttack!.participantEntityIds).toEqual(participants);
      expect(
        state.cardInstances.find((c) => c.instanceId === "cirno")?.exhaustState
      ).toBe("recovered");
      act(opponent, "pass_pre_declaration_stack");
      expect(state.activeAttack!.attackId).toBe(attackId);
      expect(state.activeAttack!.participantEntityIds).toEqual([
        ...participants,
        "battle-entity:cirno",
      ]);
      expect(
        state.cardInstances.find((c) => c.instanceId === "cirno")?.exhaustState
      ).toBe("exhausted");
      expect(state.summonedDuringAttackStepInstanceIds).toEqual(["cirno"]);
    }
  );

  it("アタックステップ中に召喚した妖精は summonedDuringAttackStepInstanceIds に記録される", () => {
    let state = createJoinTestState();
    state = declareSingleAttackWithoutClosingFlash(state);
    expect(state.window).toBe("declare_attack");

    state = summonDuringAttackStep(state, "hand-fairy-1");
    expect(state.summonedDuringAttackStepInstanceIds).toContain("hand-fairy-1");
  });

  it("window:declare_attack 中は召喚した妖精に join_active_attack が legal になり、適用すると合流する", () => {
    let state = createJoinTestState();
    state = declareSingleAttackWithoutClosingFlash(state);
    state = summonDuringAttackStep(state, "hand-fairy-1");

    const joinAction = getActions(state, "alice").find(
      (a): a is JoinActiveAttackLegalAction =>
        a.kind === "join_active_attack" && a.sourceInstanceId === "hand-fairy-1"
    );
    expect(joinAction).toBeDefined();

    const beforeParticipants = state.activeAttack!.participantEntityIds.length;
    state = apply(state, joinAction!);

    // P3-115: join_active_attack 自身が preDeclarationStackWindow を開く
    // (02:190「アタック宣言」の一種)。合流はまだ確定していない。
    expect(state.window).toBe("pre_declaration_stack");
    expect(state.preDeclarationStackWindow?.kind).toBe("join_active_attack");
    expect(state.preDeclarationStackWindow?.sourceInstanceId).toBe(
      "hand-fairy-1"
    );
    expect(state.activeAttack!.participantEntityIds.length).toBe(
      beforeParticipants
    );

    state = passPreDeclarationStack(state);

    expect(state.activeAttack!.participantEntityIds.length).toBe(
      beforeParticipants + 1
    );
    expect(state.activeAttack!.groupMode).toBe("simultaneous");
    const joinedCard = state.cardInstances.find(
      (c) => c.instanceId === "hand-fairy-1"
    )!;
    expect(joinedCard.exhaustState).toBe("exhausted");
    // ブロック宣言前のまま (合流は「相手のブロック宣言前」の内側で完結する)。
    expect(state.window).toBe("declare_attack");
  });

  it("join_active_attack の応答スタックは 1 回だけ確定し、宣言前窓を再度閉じない", () => {
    let state = createJoinTestState({
      includePreDeclarationStackMagic: true,
    });
    state = declareSingleAttackWithoutClosingFlash(state);
    state = summonDuringAttackStep(state, "hand-fairy-1");

    const joinAction = getActions(state, "alice").find(
      (a): a is JoinActiveAttackLegalAction =>
        a.kind === "join_active_attack" && a.sourceInstanceId === "hand-fairy-1"
    );
    expect(joinAction).toBeDefined();
    const beforeParticipants = state.activeAttack!.participantEntityIds.length;
    state = apply(state, joinAction!);
    expect(state.preDeclarationStackWindow?.kind).toBe("join_active_attack");

    const stackMagicAction = getActions(state, "bob", {
      includePreDeclarationStackMagic: true,
    }).find(
      (a) =>
        a.kind === "use_magic" && a.sourceInstanceId === "join-stack-magic-1"
    );
    expect(stackMagicAction).toBeDefined();
    state = apply(state, stackMagicAction!);
    expect(state.preDeclarationStackWindow?.pendingStackAction).not.toBeNull();

    state = passPreDeclarationStack(state);

    expect(state.preDeclarationStackWindow).toBeNull();
    expect(state.pendingPreDeclarationConfirmation).toBeNull();
    expect(state.window).toBe("declare_attack");
    expect(state.activeAttack!.participantEntityIds).toHaveLength(
      beforeParticipants + 1
    );
    expect(
      state.cardInstances.find((card) => card.instanceId === "hand-fairy-1")
        ?.exhaustState
    ).toBe("exhausted");
    expect(
      state.log.some((entry) =>
        entry.startsWith("attack:join-cancelled:hand-fairy-1:")
      )
    ).toBe(false);
    expect(
      state.cardInstances.find(
        (card) => card.instanceId === "join-stack-magic-1"
      )?.zone
    ).toBe("trash");
  });

  it("join_active_attack の窓中に参加体がフィールドを離脱すると合流は不発になる", () => {
    let state = createJoinTestState();
    state = declareSingleAttackWithoutClosingFlash(state);
    state = summonDuringAttackStep(state, "hand-fairy-1");

    const joinAction = getActions(state, "alice").find(
      (a): a is JoinActiveAttackLegalAction =>
        a.kind === "join_active_attack" && a.sourceInstanceId === "hand-fairy-1"
    );
    expect(joinAction).toBeDefined();

    const beforeParticipants = state.activeAttack!.participantEntityIds.length;
    state = apply(state, joinAction!);
    expect(state.window).toBe("pre_declaration_stack");

    // 窓中に相手の応答 (負傷/バウンス等) で参加予定カードがフィールドを離れたことを模す。
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "hand-fairy-1" ? { ...c, zone: "hand" as const } : c
      ),
    };

    state = passPreDeclarationStack(state);

    expect(state.activeAttack!.participantEntityIds.length).toBe(
      beforeParticipants
    );
    expect(state.window).toBe("declare_attack");
    expect(state.log).toEqual(
      expect.arrayContaining([
        expect.stringContaining("attack:join-cancelled:hand-fairy-1:"),
      ])
    );
  });

  it("非妖精を召喚しても filter 不一致で join_active_attack は legal にならない", () => {
    let state = createJoinTestState();
    state = declareSingleAttack(state);
    state = summonDuringAttackStep(state, "hand-nonfairy-1");
    expect(state.summonedDuringAttackStepInstanceIds).toContain(
      "hand-nonfairy-1"
    );

    const joinAction = getActions(state, "alice").find(
      (a) =>
        a.kind === "join_active_attack" &&
        a.sourceInstanceId === "hand-nonfairy-1"
    );
    expect(joinAction).toBeUndefined();
  });

  it("filter の BP 条件は合体ブレイヴ込み BP で途中合流候補を判定する", () => {
    let state = createJoinTestState({ registerGrant: false });
    state = declareSingleAttack(state);
    state = executeEffect({
      chainId: "test:p2-05-mid-battle-join:460",
      state,
      effect: {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "allow_mid_battle_join",
              player: "self",
              filter: { category: ["spirit"], maxBp: 3000 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
      } as NonNullable<CardDefinition["effects"]>[number],
      sourceInstanceId: "xx01-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const joinedHost = {
      ...createCardInstance(fairyZeroCost, {
        instanceId: "joined-host-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      attachedChildrenIds: ["joined-brave-1"],
    };
    const joinedBrave = {
      ...createCardInstance(bpBraveDefinition, {
        instanceId: "joined-brave-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0,
      }),
      attachedToInstanceId: "joined-host-1",
      zoneRoleName: "brave",
    };
    state = {
      ...state,
      cardInstances: [...state.cardInstances, joinedHost, joinedBrave],
      summonedDuringAttackStepInstanceIds: [
        ...(state.summonedDuringAttackStepInstanceIds ?? []),
        "joined-host-1",
      ],
    };

    const joinAction = getActions(state, "alice").find(
      (a) =>
        a.kind === "join_active_attack" &&
        a.sourceInstanceId === "joined-host-1"
    );
    expect(joinAction).toBeUndefined();
  });

  it("アタックステップ以前から場にいた妖精 (未召喚扱い) は join_active_attack の対象外", () => {
    let state = createJoinTestState();
    // fairy-1 (アタッカー本体) は summonedDuringAttackStepInstanceIds に無いため対象外。
    state = declareSingleAttack(state);

    const joinAction = getActions(state, "alice").find(
      (a) => a.kind === "join_active_attack" && a.sourceInstanceId === "fairy-1"
    );
    expect(joinAction).toBeUndefined();
  });

  it("相手のブロック宣言後 (window:declare_block) は join_active_attack が legal でなくなる", () => {
    let state = createJoinTestState();
    state = declareSingleAttack(state);
    state = summonDuringAttackStep(state, "hand-fairy-1");

    const blockAction = getActions(state, "bob").find(
      (a) => a.kind === "block" && a.sourceInstanceId === "blocker-1"
    );
    expect(blockAction).toBeDefined();
    state = apply(state, blockAction!);
    state = passPreDeclarationStack(state);
    expect(state.window).toBe("declare_block");

    const joinAction = getActions(state, "alice").find(
      (a) =>
        a.kind === "join_active_attack" && a.sourceInstanceId === "hand-fairy-1"
    );
    expect(joinAction).toBeUndefined();
  });

  it("before_block flash 窓を開く前に即時アタックの選択を済ませる", () => {
    let state = createJoinTestState();
    state = declareSingleAttackWithoutClosingFlash(state);
    expect(state.window).toBe("declare_attack");
    expect(state.activeAttack!.flashBeforeBlockCompleted).toBe(false);

    state = summonDuringAttackStep(state, "hand-fairy-1");

    const actions = getActions(state, "alice");
    expect(actions.some((a) => a.kind === "open_battle_flash")).toBe(false);
    const joinAction = actions.find(
      (a): a is JoinActiveAttackLegalAction =>
        a.kind === "join_active_attack" && a.sourceInstanceId === "hand-fairy-1"
    );
    expect(joinAction).toBeDefined();

    const beforeParticipants = state.activeAttack!.participantEntityIds.length;
    state = apply(state, joinAction!);
    expect(state.window).toBe("pre_declaration_stack");
    state = passPreDeclarationStack(state);
    expect(state.activeAttack!.participantEntityIds.length).toBe(
      beforeParticipants + 1
    );
  });

  it("召喚直後のアタック選択は相手のフラッシュ優先権を待たない", () => {
    let state = createJoinTestState();
    state = declareSingleAttackWithoutClosingFlash(state);
    const openAction = getActions(state, "alice").find(
      (a) => a.kind === "open_battle_flash"
    );
    expect(openAction).toBeDefined();
    state = apply(state, openAction!);
    // 開通直後は非アクティブプレイヤー (bob) が先に優先権を持つ。
    expect(state.activeAttack!.flashWindowState?.priorityPlayerId).toBe("bob");

    state = summonDuringAttackStep(state, "hand-fairy-1");

    const joinAction = getActions(state, "alice").find(
      (a) =>
        a.kind === "join_active_attack" && a.sourceInstanceId === "hand-fairy-1"
    );
    expect(joinAction).toBeDefined();
    expect(getActions(state, "bob")).toEqual([]);
  });

  it("before_block flash 窓が開いていても、優先権が alice に戻れば join_active_attack は legal", () => {
    let state = createJoinTestState();
    state = declareSingleAttackWithoutClosingFlash(state);
    const openAction = getActions(state, "alice").find(
      (a) => a.kind === "open_battle_flash"
    );
    state = apply(state, openAction!);
    const bobPass = getActions(state, "bob").find(
      (a) => a.kind === "pass_battle_flash"
    );
    expect(bobPass).toBeDefined();
    state = apply(state, bobPass!);
    expect(state.activeAttack!.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );

    state = summonDuringAttackStep(state, "hand-fairy-1");

    const joinAction = getActions(state, "alice").find(
      (a) =>
        a.kind === "join_active_attack" && a.sourceInstanceId === "hand-fairy-1"
    );
    expect(joinAction).toBeDefined();
  });
  it("辞退はフラッシュ優先権・パス数を消費せず、次のフラッシュで再提示しない", () => {
    let state = declareSingleAttackWithoutClosingFlash(createJoinTestState());
    state = apply(
      state,
      getActions(state, "alice").find((a) => a.kind === "open_battle_flash")!
    );
    state = summonDuringAttackStep(state, "hand-fairy-1");
    const flash = { ...state.activeAttack!.flashWindowState! };
    const staleJoin = getActions(state, "alice").find(
      (a) => a.kind === "join_active_attack"
    )!;
    const decline = getActions(state, "alice").find(
      (a) => a.kind === "decline_immediate_attack_join"
    );
    expect(decline).toBeDefined();
    state = apply(state, decline!);
    expect(state.pendingImmediateAttackJoins).toEqual([]);
    expect(state.activeAttack!.flashWindowState).toEqual(flash);
    expect(
      state.cardInstances.find((c) => c.instanceId === "hand-fairy-1")!
        .exhaustState
    ).toBe("recovered");
    expect(() => apply(state, staleJoin)).toThrow("no longer available");
    state = apply(
      state,
      getActions(state, "bob").find((a) => a.kind === "pass_battle_flash")!
    );
    expect(
      getActions(state, "alice").some((a) => a.kind === "join_active_attack")
    ).toBe(false);
  });

  it("参加宣言と応答後も元のフラッシュ優先権・パス数を保持する", () => {
    let state = declareSingleAttackWithoutClosingFlash(createJoinTestState());
    state = apply(
      state,
      getActions(state, "alice").find((a) => a.kind === "open_battle_flash")!
    );
    state = summonDuringAttackStep(state, "hand-fairy-1");
    const flash = { ...state.activeAttack!.flashWindowState! };
    state = apply(
      state,
      getActions(state, "alice").find((a) => a.kind === "join_active_attack")!
    );
    state = passPreDeclarationStack(state);
    expect(state.pendingImmediateAttackJoins).toEqual([]);
    expect(state.activeAttack!.flashWindowState).toEqual(flash);
  });

  it("アタック開始前の召喚履歴だけでは後のバトルに即時参加できない", () => {
    let state = summonDuringAttackStep(createJoinTestState(), "hand-fairy-1");
    expect(state.summonedDuringAttackStepInstanceIds).toContain("hand-fairy-1");
    state = declareSingleAttackWithoutClosingFlash(state);
    expect(
      getActions(state, "alice").some((a) => a.kind === "join_active_attack")
    ).toBe(false);
  });

  it("同じタイミングで複数召喚しても、辞退した個体だけを消費する", () => {
    let state = declareSingleAttackWithoutClosingFlash(createJoinTestState());
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(fairyZeroCost, {
          instanceId: "hand-fairy-2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };
    state = summonDuringAttackStep(state, "hand-fairy-1");
    state = summonDuringAttackStep(state, "hand-fairy-2");
    state = apply(
      state,
      getActions(state, "alice").find(
        (a) =>
          a.kind === "decline_immediate_attack_join" &&
          a.sourceInstanceId === "hand-fairy-1"
      )!
    );
    expect(
      getActions(state, "alice")
        .filter((a) => a.kind === "join_active_attack")
        .map((a) => a.sourceInstanceId)
    ).toEqual(["hand-fairy-2"]);
    state = apply(
      state,
      getActions(state, "alice").find((a) => a.kind === "join_active_attack")!
    );
    state = passPreDeclarationStack(state);
    expect(state.activeAttack!.participantEntityIds).toContain(
      "battle-entity:hand-fairy-2"
    );
    expect(state.activeAttack!.participantEntityIds).not.toContain(
      "battle-entity:hand-fairy-1"
    );
  });
});
