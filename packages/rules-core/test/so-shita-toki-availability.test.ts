import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import type { ApplyLegalActionOptions, GameState, LegalAction } from "../src";

const cards = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const definitions = new Map(cards.map((card) => [card.cardNo, card]));
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
  getRegisteredBurstActions: () => undefined,
};
const EUGEO = "BSSA01-転醒X03(A)";

function board(
  cardNo = EUGEO,
  voidCores = 10,
  withBrave = false,
  owner = "alice"
) {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definitions.get(cardNo)!, {
          instanceId: "source",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 3,
        }),
        ...(withBrave
          ? [
              createCardInstance(definitions.get("BSSA01-転醒X02(A)")!, {
                instanceId: "rose",
                ownerPlayerId: owner,
                zone: "hand",
              }),
            ]
          : []),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        deckCount: 0,
        voidNormalCoreCount: voidCores,
        reserveNormalCoreCount: 5,
        handCount: id === owner && withBrave ? 1 : 0,
      })),
    }),
    activePlayerId: owner,
    step: "main" as const,
    turnNumber: 3,
  };
}

function trigger(
  state: GameState,
  eventKind: "summon" | "leave_field" | "advent" = "summon"
) {
  return queuePendingReactionsFromTriggerEvents(
    state,
    [
      {
        actingPlayerId: state.activePlayerId,
        eventKind,
        source: "action_resolution",
        chainId: "test:so-shita-toki-availability:72",
        attackId: null,
        relatedPlayerId: state.activePlayerId,
        relatedInstanceId: "source",
        amount: null,
        ...(eventKind === "leave_field"
          ? { cause: "opponent_effect" as const }
          : {}),
      },
    ],
    undefined,
    lookups
  );
}

function act(
  state: GameState,
  player: string,
  kind: LegalAction["kind"],
  input: Partial<ApplyLegalActionOptions> = {}
) {
  const action = getLegalActions({
    state,
    actingPlayerId: player,
    ...lookups,
  }).find(
    (a) =>
      a.kind === kind &&
      (a.kind !== "resolve_pending_step_optional_choice" ||
        a.choice === "decline")
  );
  expect(action, kind).toBeDefined();
  expect(action?.can, JSON.stringify(action)).toBe(true);
  return applyLegalAction({ state, action: action!, ...lookups, ...input })
    .state;
}

function run(state: GameState, cardNo = EUGEO, index = 1) {
  return executeEffect({
    chainId: "test:so-shita-toki-availability:114",
    state,
    effect: definitions.get(cardNo)!.effects![index]!,
    sourceInstanceId: "source",
    actingPlayerId: state.activePlayerId,
    ...lookups,
  });
}

describe("そうしたとき: 前段の発揮と後段の達成条件", () => {
  it.each(["alice", "bob"])(
    "%s: 手札に青薔薇の剣がなくても召喚時を宣言しコア3個を置く",
    (owner) => {
      let state = trigger(board(EUGEO, 10, false, owner));
      state = act(state, owner, "resolve_pending_triggered_effect");
      state = act(state, owner === "alice" ? "bob" : "alice", "pass_stack");
      expect(
        state.cardInstances.find((c) => c.instanceId === "source")
          ?.normalCoreCount
      ).toBe(6);
      expect(
        state.players.find((p) => p.id === owner)?.voidNormalCoreCount
      ).toBe(7);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
    }
  );

  it("青薔薇の剣がない場合も前段を巻き戻さない", () => {
    const state = run(board());
    expect(state.cardInstances[0]?.normalCoreCount).toBe(6);
  });

  it.each([0, 1, 2])(
    "ボイドが%d個なら可能な分だけ置き、召喚へ進まない",
    (amount) => {
      const state = run(board(EUGEO, amount, true));
      expect(state.cardInstances[0]?.normalCoreCount).toBe(3 + amount);
      expect(
        state.cardInstances.find((c) => c.instanceId === "rose")?.zone
      ).toBe("hand");
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(state.pendingMultiPlacement).toBeNull();
      expect(state.pendingBraveCombineChoice).toBeNull();
    }
  );

  it("3個配置後の召喚だけを辞退でき、コアは残る", () => {
    let state = act(
      trigger(board(EUGEO, 3, true)),
      "alice",
      "resolve_pending_triggered_effect"
    );
    state = act(state, "bob", "pass_stack");
    expect(state.pendingStepOptionalChoice).not.toBeNull();
    state = act(state, "alice", "resolve_pending_step_optional_choice");
    expect(state.cardInstances[0]?.normalCoreCount).toBe(6);
    expect(state.cardInstances.find((c) => c.instanceId === "rose")?.zone).toBe(
      "hand"
    );
  });

  it("BSKB01-T01: 相手対象がなくても自分のスピリットをトラッシュに置く", () => {
    const state = run(board("BSKB01-T01"), "BSKB01-T01");
    expect(state.cardInstances[0]?.pendingLeaveKind).not.toBeNull();
  });

  it.each(["main"] as const)(
    "BSSL01-CX01: %sで手札・デッキ0でもカウント増加を宣言できる",
    (step) => {
      const state = { ...board("BSSL01-CX01"), step };
      const actions = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      });
      expect(
        actions.some((a) => a.kind === "use_field_card_effect" && a.can)
      ).toBe(true);
    }
  );
});

describe("監査境界: 後続の条件を先頭へ持ち上げない", () => {
  it("BSSL01-CX01: アタックステップで手札・デッキ0でもカウント+2を残す", () => {
    const state = run(
      { ...board("BSSL01-CX01"), step: "attack" },
      "BSSL01-CX01",
      2
    );
    expect(state.players[0]?.countValue).toBe(2);
  });

  it("コア増加を禁止されていると青薔薇の剣があっても召喚しない", () => {
    const before = board(EUGEO, 10, true);
    const state = run({
      ...before,
      activeContinuousEffects: [
        {
          effectId: "void-lock",
          sourceInstanceId: "blocker",
          sourceDefinitionId: "BSSL01-C02",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 3,
          createdAtAttackId: null,
          modifierTag: "restrict_core_placement_void",
          targetInstanceId: "alice",
        },
      ],
    });
    expect(state.cardInstances[0]?.normalCoreCount).toBe(3);
    expect(state.cardInstances[1]?.zone).toBe("hand");
    expect(state.pendingStepOptionalChoice).toBeNull();
  });

  it.each([false, true])(
    "BSKB01-R01: 相方手札=%s、可能な分を破棄し両方の達成時だけ+2する",
    (withPartner) => {
      const cardNo = "BSKB01-R01";
      const base = board(cardNo);
      const state = run(
        {
          ...base,
          players: base.players.map((p) =>
            p.id === "alice"
              ? { ...p, countValue: 5, handCount: withPartner ? 2 : 1 }
              : p
          ),
          cardInstances: [
            createCardInstance(definitions.get(cardNo)!, {
              instanceId: "source",
              ownerPlayerId: "alice",
              zone: "hand",
            }),
            createCardInstance(definitions.get("BSKB01-CX01")!, {
              instanceId: "meta",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            }),
            ...(withPartner
              ? [
                  createCardInstance(definitions.get("BSKB01-CX01")!, {
                    instanceId: "partner",
                    ownerPlayerId: "alice",
                    zone: "hand",
                  }),
                ]
              : []),
          ],
        },
        cardNo,
        0
      );
      expect(state.cardInstances[0]?.zone).toBe("trash");
      expect(
        state.activeContinuousEffects.some(
          (e) => e.modifierTag === "core_move_amount_modifier"
        )
      ).toBe(withPartner);
    }
  );

  it("BSSG01-X05: 回復対象も2コストもなくても先頭のBP減少を宣言できる", () => {
    const base = board("BSSG01-X05");
    const state = trigger(
      {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          reserveNormalCoreCount: 0,
          soulCoreLocation: { kind: "trash" },
        })),
        cardInstances: [
          ...base.cardInstances,
          createCardInstance(definitions.get(EUGEO)!, {
            instanceId: "opponent",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      },
      "advent"
    );
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(
      actions.some(
        (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
      )
    ).toBe(true);
  });

  it("BSTH02.7-TX01(A): 戻した後の転醒3コストを払えなくてもバウンスを宣言できる", () => {
    const base = board();
    const state = queuePendingReactionsFromTriggerEvents(
      {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          reserveNormalCoreCount: 0,
          handCount: p.id === "alice" ? 1 : 0,
          reserveSoulCoreCount: 0,
          soulCoreLocation: { kind: "trash" },
        })),
        cardInstances: [
          createCardInstance(definitions.get("BSTH02.7-TX01(A)")!, {
            instanceId: "source",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(definitions.get("BSSA01-C02")!, {
            instanceId: "opponent",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      },
      [
        {
          actingPlayerId: "bob",
          eventKind: "reduce_life",
          source: "action_resolution",
          chainId: "test:so-shita-toki-availability:338",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          cause: "opponent_effect",
        },
      ],
      undefined,
      lookups
    );
    let declared = act(state, "alice", "declare_private_triggered_effect");
    const actions = getLegalActions({
      state: declared,
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(
      actions.some(
        (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
      )
    ).toBe(true);
    declared = act(declared, "alice", "resolve_pending_triggered_effect");
    declared = act(declared, "bob", "pass_stack");
    if (declared.pendingEffectTargetSelection)
      declared = act(declared, "alice", "resolve_pending_effect_target", {
        targetInstanceIds: ["opponent"],
      });
    expect(
      declared.cardInstances.find((c) => c.instanceId === "opponent")?.zone
    ).toBe("hand");
    expect(
      declared.cardInstances.find((c) => c.instanceId === "source")
        ?.definitionId
    ).toBe("BSTH02.7-TX01(A)");
  });
});

describe("ユージオの後続召喚と配分再開", () => {
  it("3個置いた後は青薔薇の剣を無料召喚できる", () => {
    let state = act(
      trigger(board(EUGEO, 3, true)),
      "alice",
      "resolve_pending_triggered_effect"
    );
    state = act(state, "bob", "pass_stack");
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(action).toBeDefined();
    state = applyLegalAction({ state, action: action!, ...lookups }).state;
    expect(state.cardInstances.find((c) => c.instanceId === "rose")?.zone).toBe(
      "field"
    );
    expect(state.players[0]?.reserveNormalCoreCount).toBeGreaterThanOrEqual(4);
  });
  it.each([2, 3])("%d個の配分完了後も実配置数を後続へ伝える", (amount) => {
    const base = board(EUGEO, amount, true);
    let state = trigger({
      ...base,
      cardInstances: [
        ...base.cardInstances,
        createCardInstance(definitions.get(EUGEO)!, {
          instanceId: "ally",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    });
    state = act(state, "alice", "resolve_pending_triggered_effect");
    state = act(state, "bob", "pass_stack");
    state = act(state, "alice", "resolve_pending_core_distribution", {
      coreDistributionAllocations: { source: 1, ally: amount - 1 },
    });
    expect(
      state.cardInstances.find((c) => c.instanceId === "source")
        ?.normalCoreCount
    ).toBe(4);
    expect(
      state.cardInstances.find((c) => c.instanceId === "ally")?.normalCoreCount
    ).toBe(amount);
    expect(state.pendingStepOptionalChoice !== null).toBe(amount === 3);
  });
});
