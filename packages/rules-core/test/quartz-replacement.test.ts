import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { executeEffect } from "../src/effect/effect-interpreter";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { matchesCardFilter } from "../src/card/card-filter";
import { resolveTargetSpec } from "../src/effect/target-resolution";
import {
  canSetQuartz,
  getQuartzAttributeSum,
  getQuartzPlacements,
  setQuartz,
  useQuartzSetAsEffect,
} from "../src/mechanics/quartz-system";
import type { GameState, LegalAction } from "../src";
import type { Effect } from "../src/dsl-types";

const getDef = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const lookup = buildTriggeredEffectLookup(ALL_CARDS);
function setup(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const make = (no: string, id: string, zone: "field" | "hand" | "deck") =>
    createCardInstance(getDef(no)!, {
      instanceId: id,
      ownerPlayerId: "alice",
      zone,
    });
  return {
    ...base,
    step: "main",
    activePlayerId: "alice",
    turnNumber: 3,
    cardInstances: [
      make("BSLH01-CX01", "host", "field"),
      make("BSLH01-C01", "old", "hand"),
      make("BSLH01-C01", "same", "hand"),
      make("BSLH01-C04", "new", "hand"),
      make("BSLH01-C01", "deck", "deck"),
    ],
    players: base.players.map((p) =>
      p.id === "alice"
        ? {
            ...p,
            soulStateInstanceIds: ["host"],
            handCount: 3,
            countValue: 10,
            deckCount: 1,
          }
        : p
    ),
  };
}
const list = (state: GameState, actingPlayerId = "alice") =>
  getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: lookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredMagicActions: () => undefined,
  });
function apply(
  state: GameState,
  action: LegalAction,
  targetInstanceIds?: string[]
): GameState {
  return applyLegalAction({
    state,
    action,
    ...(targetInstanceIds ? { targetInstanceIds } : {}),
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: lookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredMagicActions: () => undefined,
  }).state;
}
function pass(state: GameState): GameState {
  const action = [...list(state, "alice"), ...list(state, "bob")].find(
    (a) => a.kind === "pass_stack"
  );
  expect(action).toBeDefined();
  return apply(state, action!);
}
const withOld = () =>
  setQuartz(
    setup(),
    {
      quartzInstanceId: "old",
      hostInstanceId: "host",
      ownerPlayerId: "alice",
      slot: "center",
    },
    getDef
  )!;

describe("qa-029 BSLH01-CX01 クォーツ入れ替え", () => {
  it("双児珠の召喚/セット分岐を選んだ後も、位置HUDの選択を待つ", () => {
    const base = setup();
    const card = createCardInstance(getDef("BSLH01-M03")!, {
      instanceId: "burst",
      ownerPlayerId: "alice",
      zone: "in_use",
    });
    const pending = executeEffect({
      state: { ...base, cardInstances: [...base.cardInstances, card] },
      sourceInstanceId: "burst",
      actingPlayerId: "alice",
      effect: getDef("BSLH01-M03")!.effects![0]!,
      effectIndex: 0,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      chainId: "quartz-burst-choice",
      promptUnresolvedChoice: true,
    });
    const set = list(pending).find(
      (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === 1
    );
    expect(set).toBeDefined();
    const placement = apply(pending, set!);
    expect(placement.quartzSetStates).toHaveLength(0);
    expect(placement.pendingStepChoice).not.toBeNull();
    expect(placement.players[0]!.countValue).toBe(10);
    const right = list(placement).find(
      (a) =>
        a.kind === "resolve_pending_step_choice" && a.choiceLabel.includes("右")
    );
    expect(right).toBeDefined();
    const after = apply(placement, right!);
    expect(after.quartzSetStates).toEqual([
      {
        quartzInstanceId: "burst",
        hostInstanceId: "host",
        ownerPlayerId: "alice",
        slot: "right",
      },
    ]);
    expect(after.players[0]!.countValue).toBe(10);
  });

  it("R01で手札の対象を選んだ後も、位置選択より先にセット/支払いをしない", () => {
    const base = setup();
    const card = createCardInstance(getDef("BSLH01-R01")!, {
      instanceId: "r01",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const pending = executeEffect({
      state: { ...base, cardInstances: [...base.cardInstances, card] },
      sourceInstanceId: "r01",
      actingPlayerId: "alice",
      effect: getDef("BSLH01-R01")!.effects![1]!,
      effectIndex: 1,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      chainId: "quartz-r01-target",
      promptUnresolvedChoice: true,
    });
    const target = list(pending).find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    );
    expect(target).toBeDefined();
    const placement = apply(pending, target!, ["new"]);
    expect(placement.pendingStepChoice).not.toBeNull();
    expect(placement.quartzSetStates).toHaveLength(0);
    expect(placement.players[0]!.countValue).toBe(10);
    const right = list(placement).find(
      (a) =>
        a.kind === "resolve_pending_step_choice" && a.choiceLabel.includes("右")
    );
    expect(right).toBeDefined();
    const after = apply(placement, right!);
    expect(after.quartzSetStates[0]).toMatchObject({
      quartzInstanceId: "new",
      slot: "right",
    });
    expect(after.players[0]!.countValue).toBe(8);
  });

  it("双児珠は手札からの通常・効果セットで入れ替え不可、他の位置は選べる", () => {
    const base = setup();
    const before = setQuartz(
      {
        ...base,
        cardInstances: base.cardInstances.map((c) =>
          c.instanceId === "old" ? { ...c, definitionId: "BSLH01-M03" } : c
        ),
      },
      {
        quartzInstanceId: "old",
        hostInstanceId: "host",
        ownerPlayerId: "alice",
        slot: "center",
      },
      getDef
    )!;
    expect(
      canSetQuartz(before, "new", "host", "center", getDef, "old")
    ).toEqual({ ok: false, reason: "replacement_prohibited" });
    const actions = list(before).filter(
      (a) => a.kind === "set_quartz" && a.sourceInstanceId === "new"
    );
    expect(actions).toHaveLength(2);
    expect(
      actions.every(
        (a) =>
          a.kind === "set_quartz" && a.replacedQuartzInstanceId === undefined
      )
    ).toBe(true);
    const placement = {
      hostInstanceId: "host",
      slot: "center" as const,
      replacedQuartzInstanceId: "old",
    };
    const rejected = useQuartzSetAsEffect({
      state: before,
      actingPlayerId: "alice",
      quartzInstanceId: "new",
      getCardDefinitionById: getDef,
      placement,
    });
    expect(rejected.state.players[0]!.countValue).toBe(10);
    expect(rejected.state.quartzSetStates).toEqual(before.quartzSetStates);
    expect(
      rejected.state.cardInstances.find((c) => c.instanceId === "new")!.zone
    ).toBe("hand");
    const fromDeck = {
      ...before,
      cardInstances: before.cardInstances.map((c) =>
        c.instanceId === "new" ? { ...c, zone: "deck" as const } : c
      ),
    };
    const allowed = useQuartzSetAsEffect({
      state: fromDeck,
      actingPlayerId: "alice",
      quartzInstanceId: "new",
      getCardDefinitionById: getDef,
      placement,
    });
    expect(allowed.state.quartzSetStates[0]!.quartzInstanceId).toBe("new");
    expect(
      allowed.state.cardInstances.find((c) => c.instanceId === "old")!.zone
    ).toBe("hand");
    expect(allowed.state.players[0]!.countValue).toBe(8);
  });

  it("qa-031: 魂状態のENIGMAも実際のBP対象解決とバウンスの候補に入らない", () => {
    const state = setup();
    const target = {
      kind: "filter" as const,
      count: 1,
      player: "opponent" as const,
      zone: "field" as const,
      filter: { soulState: "include" as const, maxBp: 0 },
    };
    expect(
      resolveTargetSpec({
        state,
        targetSpec: target,
        actingPlayerId: "bob",
        sourceInstanceId: "source",
        getCardDefinitionById: getDef,
      })
    ).toEqual([]);
    const after = executeEffect({
      state,
      sourceInstanceId: "source",
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      chainId: "no-bp-target",
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "bounce", target } }],
      },
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "host")
    ).toMatchObject({ zone: "field", pendingLeaveKind: null });
    expect(after.quartzSetStates).toEqual(state.quartzSetStates);
  });

  it("効果セットは空のhostでも位置選択後にだけ支払い、選んだ右位置にセットする", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "quartz_set", target: { kind: "self" } } }],
    };
    const pending = executeEffect({
      state: setup(),
      effect,
      effectIndex: 0,
      sourceInstanceId: "new",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      chainId: "quartz-empty-placement",
      promptUnresolvedChoice: true,
    });
    expect(pending.pendingStepChoice).not.toBeNull();
    expect(pending.players[0]!.countValue).toBe(10);
    const right = list(pending).find(
      (a) =>
        a.kind === "resolve_pending_step_choice" && a.choiceLabel.includes("右")
    );
    expect(right).toBeDefined();
    const after = apply(pending, right!);
    expect(after.pendingStepChoice).toBeNull();
    expect(after.players[0]!.countValue).toBe(8);
    expect(after.quartzSetStates).toEqual([
      {
        quartzInstanceId: "new",
        hostInstanceId: "host",
        ownerPlayerId: "alice",
        slot: "right",
      },
    ]);
  });

  it("qa-031: 手札のENIGMAはBP参照の対象外で、BP0や実効BPのあるカードとは区別する", () => {
    const def = getDef("BSLH01-CX01")!;
    const card = createCardInstance(def, {
      instanceId: "enigma-hand",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    expect(matchesCardFilter(card, def, { maxBp: 0 })).toBe(false);
    expect(matchesCardFilter(card, def, { minBp: 0 })).toBe(false);
    expect(matchesCardFilter(card, def, { maxBp: 10000 })).toBe(false);
    expect(
      matchesCardFilter(
        card,
        def,
        { maxBp: 0, bpBasis: "printed" },
        { effectiveBp: 0 }
      )
    ).toBe(false);
    const zeroBpDef = {
      ...def,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
    };
    expect(matchesCardFilter(card, zeroBpDef, { maxBp: 0 })).toBe(true);
    const spiritToken = { ...card, zone: "field" as const };
    expect(
      matchesCardFilter(
        spiritToken,
        def,
        { minBp: 5000 },
        { effectiveCategory: "spirit", effectiveBp: 5000 }
      )
    ).toBe(true);
  });

  it("中央満杯でも交換でき、通常セットは窓後に確定して魂状態・手札・属性値とセット誘発を更新する", () => {
    const before = withOld();
    const action = list(before).find(
      (a) =>
        a.kind === "set_quartz" &&
        a.sourceInstanceId === "new" &&
        a.replacedQuartzInstanceId === "old"
    )!;
    expect(action).toBeDefined();
    const declared = apply(before, action);
    expect(declared.players[0]!.countValue).toBe(8);
    expect(
      declared.cardInstances.find((c) => c.instanceId === "old")!.zone
    ).toBe("field");
    const after = pass(declared);
    expect(after.quartzSetStates).toEqual([
      {
        quartzInstanceId: "new",
        hostInstanceId: "host",
        ownerPlayerId: "alice",
        slot: "center",
      },
    ]);
    expect(after.players[0]!.soulStateInstanceIds).toEqual(["host", "new"]);
    expect(after.players[0]!.handCount).toBe(before.players[0]!.handCount);
    expect(
      after.cardInstances.find((c) => c.instanceId === "old")
    ).toMatchObject({ zone: "hand", zoneRoleName: "spirit-card" });
    expect(getQuartzAttributeSum(after, "host", "時", getDef)).toBe(0);
    expect(getQuartzAttributeSum(after, "host", "風", getDef)).toBe(5);
    expect(
      after.pendingTriggeredEffects.filter((p) => p.eventKind === "quartz_set")
    ).toHaveLength(1);
    expect(before.cardInstances.find((c) => c.instanceId === "old")!.zone).toBe(
      "field"
    );
  });

  it("同名は禁止ではなく、その同名クォーツとの交換だけを許可する", () => {
    const state = withOld();
    expect(getQuartzPlacements(state, "alice", "same", getDef)).toEqual([
      {
        hostInstanceId: "host",
        slot: "center",
        replacedQuartzInstanceId: "old",
      },
    ]);
    expect(canSetQuartz(state, "same", "host", "left", getDef, "old").ok).toBe(
      false
    );
    const after = useQuartzSetAsEffect({
      state,
      actingPlayerId: "alice",
      quartzInstanceId: "same",
      getCardDefinitionById: getDef,
    }).state;
    expect(after.quartzSetStates[0]!.quartzInstanceId).toBe("same");
    expect(after.players[0]!.countValue).toBe(8);
  });

  it("7枚満杯でも任意の1枚を交換し、他の位置と順序を保つ", () => {
    let state = setup();
    const usedNames = new Set([getDef("BSLH01-C01")!.quartzData!.quartzName]);
    const defs = ALL_CARDS.filter((d) => {
      const name = d.quartzData?.quartzName;
      if (!d.cardNo.startsWith("BSLH01-") || !name || usedNames.has(name))
        return false;
      usedNames.add(name);
      return true;
    }).slice(0, 7);
    for (const [index, def] of defs.entries()) {
      const id = `full-${index}`;
      state = {
        ...state,
        cardInstances: [
          ...state.cardInstances,
          createCardInstance(def, {
            instanceId: id,
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
        players: state.players.map((p) =>
          p.id === "alice" ? { ...p, handCount: p.handCount + 1 } : p
        ),
      };
      state = setQuartz(
        state,
        {
          quartzInstanceId: id,
          hostInstanceId: "host",
          ownerPlayerId: "alice",
          slot: index < 3 ? "left" : index === 3 ? "center" : "right",
        },
        getDef
      )!;
    }
    const placements = getQuartzPlacements(state, "alice", "old", getDef);
    expect(placements).toHaveLength(7);
    expect(
      placements.every((p) => p.replacedQuartzInstanceId !== undefined)
    ).toBe(true);
    const after = useQuartzSetAsEffect({
      state,
      actingPlayerId: "alice",
      quartzInstanceId: "old",
      placement: placements.find(
        (p) => p.replacedQuartzInstanceId === "full-1"
      )!,
      getCardDefinitionById: getDef,
    }).state;
    expect(after.quartzSetStates.map((q) => q.quartzInstanceId)).toEqual([
      "full-0",
      "old",
      "full-2",
      "full-3",
      "full-4",
      "full-5",
      "full-6",
    ]);
    expect(after.players[0]!.countValue).toBe(8);
  });

  it("不足カウント・手元からの通常セットには入れ替え候補を出さない", () => {
    const state = withOld();
    const poor = {
      ...state,
      players: state.players.map((p) => ({ ...p, countValue: 0 })),
    };
    expect(list(poor).filter((a) => a.kind === "set_quartz")).toHaveLength(0);
    const aside = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "new" ? { ...c, zone: "set_aside" as const } : c
      ),
    };
    expect(
      list(aside).filter(
        (a) => a.kind === "set_quartz" && a.sourceInstanceId === "new"
      )
    ).toHaveLength(0);
  });

  it("交換先が応答中に離れたら別カードを戻さず不発（コストは支払い済み）", () => {
    const state = withOld();
    const action = list(state).find(
      (a) =>
        a.kind === "set_quartz" &&
        a.sourceInstanceId === "new" &&
        a.replacedQuartzInstanceId === "old"
    )!;
    const declared = apply(state, action);
    const changed = {
      ...declared,
      quartzSetStates: [],
      cardInstances: declared.cardInstances.map((c) =>
        c.instanceId === "old" ? { ...c, zone: "hand" as const } : c
      ),
      players: declared.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulStateInstanceIds: ["host"], handCount: p.handCount + 1 }
          : p
      ),
    };
    const after = pass(changed);
    expect(after.cardInstances.find((c) => c.instanceId === "new")!.zone).toBe(
      "hand"
    );
    expect(after.quartzSetStates).toHaveLength(0);
    expect(after.players[0]!.countValue).toBe(8);
    expect(after.log.some((s) => s.includes("replacement_unavailable"))).toBe(
      true
    );
  });

  it("効果セットは交換先の選択を待ち、選択後に無料セットと後続処理を各1回行う", () => {
    const state = withOld();
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "quartz_set",
            target: { kind: "source_card" },
            free: true,
          },
        },
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    };
    const pending = executeEffect({
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "new",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      chainId: "quartz-replace-test",
      getRegisteredTriggeredEffectActions: lookup,
      promptUnresolvedChoice: true,
    });
    expect(pending.pendingStepChoice).not.toBeNull();
    expect(pending.players[0]!.countValue).toBe(10);
    const choice = list(pending).find(
      (a) =>
        a.kind === "resolve_pending_step_choice" &&
        a.choiceLabel.includes("入れ替え")
    );
    expect(choice).toBeDefined();
    const after = apply(pending, choice!);
    expect(after.pendingStepChoice).toBeNull();
    expect(after.quartzSetStates[0]!.quartzInstanceId).toBe("new");
    expect(after.players[0]!.countValue).toBe(11);
    expect(after.cardInstances.find((c) => c.instanceId === "old")!.zone).toBe(
      "hand"
    );
    expect(
      after.pendingBurstChecks.filter((p) => p.eventKind === "increase_hand")
    ).toHaveLength(0);
  });
});
