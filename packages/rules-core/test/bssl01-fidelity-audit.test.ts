import { describe, expect, it } from "vitest";
import { BSSL01_CARDS } from "../../card-data/src/cards/BSSL01";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { evaluateCondition } from "../src/effect/structured-condition-eval";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { resolveGrantedEffectMechanic } from "../src/legal/mechanic-trigger-handlers";
import {
  canUseEffectByUsageLimit,
  getEffectiveBp,
  recordEffectUsage,
} from "../src/legal/legal-actions-shared";

const getDef = (id: string) => BSSL01_CARDS.find((c) => c.cardNo === id);
const card = (suffix: string) => getDef(`BSSL01-${suffix}`)!;
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(BSSL01_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(BSSL01_CARDS),
};
function setup(
  suffix = "CX01",
  soul = false,
  step: GameState["step"] = "attack"
) {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(card(suffix), {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: soul ? 0 : 3,
      }),
      ...["h1", "h2", "d1", "d2", "d3"].map((id) =>
        createCardInstance(card("C01"), {
          instanceId: id,
          ownerPlayerId: "alice",
          zone: id.startsWith("h") ? "hand" : "deck",
        })
      ),
    ],
    playerOverrides: [
      {
        countValue: 0,
        handCount: 2,
        deckCount: 3,
        soulStateInstanceIds: soul ? ["source"] : [],
      },
      {},
    ],
  });
  return { ...state, step, activePlayerId: "alice" };
}
function run(state: GameState, suffix: string, index: number) {
  return executeEffect({
    chainId: "test:bssl01-fidelity-audit:64",
    state,
    effect: card(suffix).effects![index]!,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    ...lookups,
  });
}
function optional(state: GameState, choice: "execute" | "decline") {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" && a.choice === choice
  );
  expect(action).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups }).state;
}

describe("BSSL01 全面監査の境界回帰", () => {
  it.each(["main", "attack"] as const)(
    "魂状態のCX01は%sでカウントだけ増え、破棄選択にもドローにも進まない",
    (step) => {
      const after = run(setup("CX01", true, step), "CX01", 2);
      expect(after.players[0]!.countValue).toBe(step === "attack" ? 2 : 1);
      expect(after.pendingStepOptionalChoice).toBeNull();
      expect(after.pendingZoneSelection).toBeNull();
      expect(after.players[0]!.handCount).toBe(2);
      expect(after.players[0]!.deckCount).toBe(3);
    }
  );
  it("別の水篠旬がいても魂状態の『このスピリット』の代わりにならない", () => {
    const before = setup("CX01", true);
    before.cardInstances.push(
      createCardInstance(card("C01"), {
        instanceId: "other-shun",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      })
    );
    expect(run(before, "CX01", 2).pendingStepOptionalChoice).toBeNull();
  });
  it("実体のCX01では破棄を辞退でき、カウント+2だけ残る", () => {
    const pending = run(setup(), "CX01", 2);
    expect(pending.pendingStepOptionalChoice).not.toBeNull();
    const after = optional(pending, "decline");
    expect(after.players[0]!.countValue).toBe(2);
    expect(after.players[0]!.handCount).toBe(2);
    expect(after.players[0]!.deckCount).toBe(3);
  });
  it("実体のCX01では選んだ1枚を破棄してから2枚引く", () => {
    const pending = optional(run(setup(), "CX01", 2), "execute");
    expect(pending.pendingZoneSelection).not.toBeNull();
    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_zone_selection");
    expect(action).toBeDefined();
    const after = applyLegalAction({
      state: pending,
      action: action!,
      selectedZoneCardIds: ["h2"],
      ...lookups,
    }).state;
    expect(after.cardInstances.find((c) => c.instanceId === "h2")!.zone).toBe(
      "trash"
    );
    expect(after.players[0]!.handCount).toBe(3);
    expect(after.players[0]!.deckCount).toBe(1);
  });
  it("種類変更・実離脱は実体条件を満たさず、契約煌臨元は煌臨先を参照する", () => {
    const condition = card("CX01").effects![2]!.steps[2]!.condition!;
    for (const category of ["spirit", "nexus"] as const) {
      const state = setup();
      const replacement: CardDefinition = {
        ...card("CX01"),
        printedCategory: category,
      };
      expect(
        evaluateCondition(state, condition, "source", "alice", (id) =>
          id === replacement.cardNo ? replacement : getDef(id)
        )
      ).toBe(category === "spirit");
    }
    const offField = setup();
    offField.cardInstances[0]!.zone = "trash";
    expect(
      evaluateCondition(offField, condition, "source", "alice", getDef)
    ).toBe(false);
    const under = setup();
    under.cardInstances.push({
      ...createCardInstance(card("C01"), {
        instanceId: "host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
      underCards: [{ cardInstanceId: "source", role: "advent_source" }],
    });
    expect(evaluateCondition(under, condition, "source", "alice", getDef)).toBe(
      true
    );
    expect(run(under, "CX01", 2).pendingStepOptionalChoice).not.toBeNull();
    under.cardInstances.find((c) => c.instanceId === "host")!.zone = "trash";
    expect(evaluateCondition(under, condition, "source", "alice", getDef)).toBe(
      false
    );
  });
  it.each(["C03", "C04", "C05"])(
    "%sのカウント増加と後続はそれぞれ任意",
    (suffix) => {
      const pending = run(setup(suffix, false, "main"), suffix, 0);
      const second = optional(pending, "decline");
      expect(second.players[0]!.countValue).toBe(0);
      expect(second.pendingStepOptionalChoice).not.toBeNull();
    }
  );
  it.each([
    ["C01", 4, 7000],
    ["CX01", 3, 6000],
    ["X01", 7, 8000],
    ["X02", 7, 13000],
  ] as const)(
    "%sのOCはカウント閾値でBPが増え、下回ると戻る",
    (suffix, threshold, bonus) => {
      const state = setup(suffix);
      const source = state.cardInstances[0]!;
      const base = getEffectiveBp(state, source, card(suffix), getDef);
      state.players[0]!.countValue = threshold - 1;
      expect(getEffectiveBp(state, source, card(suffix), getDef)).toBe(base);
      state.players[0]!.countValue = threshold;
      expect(getEffectiveBp(state, source, card(suffix), getDef)).toBe(
        base + bonus
      );
      state.players[0]!.countValue = 0;
      expect(getEffectiveBp(state, source, card(suffix), getDef)).toBe(base);
    }
  );
  it("キバは自分の影の数まで相手の複数体からコアを選んでリザーブへ置く", () => {
    const state = setup("M01");
    state.cardInstances.push(
      createCardInstance(card("C02"), {
        instanceId: "ally",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
      ...["enemy-a", "enemy-b"].map((instanceId) =>
        createCardInstance(card("C01"), {
          instanceId,
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 3,
        })
      )
    );
    const pending = run(state, "M01", 2);
    expect(pending.pendingCoreShootSelection?.totalAmount).toBe(2);
    expect(
      pending.pendingCoreShootSelection?.candidates.map((c) => c.instanceId)
    ).toEqual(["enemy-a", "enemy-b"]);
    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_core_shoot");
    expect(action).toBeDefined();
    const after = applyLegalAction({
      state: pending,
      action: action!,
      coreShootDistribution: { "enemy-a": 1, "enemy-b": 1 },
      ...lookups,
    }).state;
    expect(
      after.cardInstances
        .filter((c) => c.instanceId.startsWith("enemy"))
        .map((c) => c.normalCoreCount)
    ).toEqual([2, 2]);
    expect(after.players[1]!.reserveNormalCoreCount).toBe(
      state.players[1]!.reserveNormalCoreCount + 2
    );
  });
  it("X02が実際に取得した影の軍団も共有枠を消費し、使用済みなら取得誘発を出さない", () => {
    const state = setup("X02");
    state.players[0]!.countValue = 7;
    state.cardInstances[0]!.underCards = [
      { cardInstanceId: "inherited", role: "advent_source" },
    ];
    state.cardInstances.push(
      createCardInstance(card("X01"), {
        instanceId: "inherited",
        ownerPlayerId: "alice",
        zone: "field",
      })
    );
    const granted = run(state, "X02", 0);
    const ce = granted.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "granted_effect" &&
        (c.metadata?.grantedEffect as { limitGroupId?: string })
          ?.limitGroupId === "影の軍団"
    )!;
    expect(ce).toBeDefined();
    const events = [
      {
        chainId: "test:bssl01-fidelity-audit:272",
        eventKind: "advent",
        relatedInstanceId: "source",
        relatedPlayerId: "alice",
      },
    ];
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      granted,
      events,
      getDef
    );
    expect(
      queued.pendingTriggeredEffects.some(
        (p) => p.mechanic?.kind === "granted_effect"
      )
    ).toBe(true);
    const after = resolveGrantedEffectMechanic(
      lookups,
      granted,
      {
        kind: "granted_effect",
        grantCeEffectId: ce.effectId,
        granteeInstanceId: "source",
      },
      "alice",
      true,
      undefined,
      "test:granted-split-summon"
    );
    expect(after.pendingSplitSummonChoice).not.toBeNull();
    expect(after.effectUsageRecords.some((r) => r.groupId === "影の軍団")).toBe(
      true
    );
    expect(
      canUseEffectByUsageLimit({
        state: after,
        sourceInstanceId: "inherited",
        sourceDefinitionId: card("X01").cardNo,
        effectLabel: "effect:0",
        groupId: "影の軍団",
        usageLimit: { kind: "per_group", duration: "turn" },
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
    const blocked = queueGrantedEffectTriggersFromTriggerEvents(
      { ...after, pendingSplitSummonChoice: null },
      events,
      getDef
    );
    expect(
      blocked.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "granted_effect"
      )
    ).toHaveLength(0);
    const alreadyQueued = {
      ...queued,
      effectUsageRecords: after.effectUsageRecords,
    };
    const actions = getLegalActions({
      state: alreadyQueued,
      actingPlayerId: "alice",
      ...lookups,
    }).filter((a) => a.kind === "resolve_pending_triggered_effect");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.skipOnly)).toBe(true);
  });
  it("影の軍団は別個体・X02取得効果と共有し、相手・別グループ・次ターンは独立", () => {
    const state = setup("X01");
    for (const [id, suffix, owner] of [
      ["second", "X01", "alice"],
      ["copier", "X02", "alice"],
      ["opponent", "X01", "bob"],
    ])
      state.cardInstances.push(
        createCardInstance(card(suffix!), {
          instanceId: id!,
          ownerPlayerId: owner!,
          zone: "field",
        })
      );
    const effect = card("X01").effects![0]!;
    const consumed = {
      ...state,
      effectUsageRecords: recordEffectUsage({
        state,
        sourceInstanceId: "source",
        sourceDefinitionId: card("X01").cardNo,
        effectLabel: "effect:0",
        groupId: effect.limitGroupId,
        duration: "turn",
      }),
    };
    const canUse = (
      id: string,
      current = consumed,
      groupId = effect.limitGroupId
    ) =>
      canUseEffectByUsageLimit({
        state: current,
        sourceInstanceId: id,
        sourceDefinitionId: current.cardInstances.find(
          (c) => c.instanceId === id
        )!.definitionId,
        effectLabel: "borrowed:0",
        groupId,
        usageLimit: effect.usageLimit,
        getCardDefinitionById: getDef,
      });
    expect(canUse("second")).toBe(false);
    expect(canUse("copier")).toBe(false);
    expect(canUse("opponent")).toBe(true);
    expect(canUse("copier", consumed, "another-group")).toBe(true);
    expect(
      canUse("copier", { ...consumed, turnNumber: consumed.turnNumber + 1 })
    ).toBe(true);
  });
});
