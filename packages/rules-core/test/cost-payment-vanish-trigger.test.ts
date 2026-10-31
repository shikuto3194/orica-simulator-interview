/**
 * P3-108: コスト支払いによるコア不足消滅でも「消滅したとき」(card_vanished) 誘発が発火する。
 *
 * 背景: コスト支払い (markCostPaymentVanishes) は runActionMainResolution の差分窓より前に
 * 発生し、当該消滅がどの diff 境界にも現れず離脱誘発が発火しなかった。
 * 修正: 各カード使用ハンドラが支払い直後（消滅待機中・flush 前）に
 * collectCostPaymentVanishTriggers で離脱誘発を収集する。
 */
import { describe, it, expect } from "vitest";
import type {
  CardDefinition,
  GameState,
  PendingBurstCheck,
  PendingLeaveEntity,
  PendingPrivateDeclaration,
  PendingTriggeredEffect,
} from "../src/model";
import {
  playSummonAsAction,
  playMagicCardAsAction,
  useAccelCardAsAction,
  useChangeCardAsAction,
  getLegalActions,
  applyLegalAction,
  finalizePendingAccelCleanups,
} from "../src/index";
import {
  buildMagicLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  flushPendingLeaves,
  queuePendingLeave,
} from "../src/state-based-actions";
import { collectCostPaymentVanishTriggers } from "../src/effect/trigger-system";

function makeSpirit(
  cardNo: string,
  effects: CardDefinition["effects"] = undefined
): CardDefinition {
  const base: CardDefinition = {
    cardNo,
    name: `S ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  return effects !== undefined ? { ...base, effects } : base;
}

function lookups(defs: CardDefinition[]) {
  return {
    getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredMagicActions: buildMagicLookup(defs),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
  } as const;
}

function drive(state: GameState, defs: CardDefinition[]): GameState {
  const lk = lookups(defs);
  let cur = state;
  for (let i = 0; i < 40; i++) {
    let progressed = false;
    for (const pid of ["alice", "bob"]) {
      const actions = getLegalActions({
        state: cur,
        actingPlayerId: pid,
        ...lk,
      });
      const act =
        actions.find((a) => a.kind === "resolve_pending_triggered_effect") ??
        actions.find((a) => a.kind === "select_pending_to_resolve") ??
        actions.find((a) => a.kind === "decline_pending_burst_check") ??
        actions.find((a) => a.kind === "resolve_pending_burst_check") ??
        actions.find((a) => a.kind === "pass_stack");
      if (!act) continue;
      cur = applyLegalAction({ state: cur, action: act, ...lk }).state;
      progressed = true;
      break;
    }
    if (!progressed) break;
  }
  return cur;
}

describe("コスト支払い消滅の離脱誘発 (P3-108)", () => {
  it("コスト支払い直後の収集では game_event leave_field を早期発火しない", () => {
    const defB = makeSpirit("B");
    const defObserver = makeSpirit("OBSERVER-LEAVE-FIELD", [
      {
        timing: { kind: "game_event", event: "leave_field", player: "self" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defB, defObserver];
    const lk = lookups(defs);
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(defObserver, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const after: GameState = {
      ...before,
      cardInstances: before.cardInstances.map((card) =>
        card.instanceId === "field-B"
          ? {
              ...card,
              cores: 0,
              pendingLeaveKind: "vanish",
              pendingLeaveCause: "cost_payment",
              pendingLeaveChainId: "cost:vanish",
              deferZoneMoveUntilChainEnd: true,
            }
          : card
      ),
      pendingLeaveEntities: [
        {
          instanceId: "field-B",
          kind: "vanish",
          cause: "cost_payment",
          causePlayerId: null,
          chainId: "cost:vanish",
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const collected = collectCostPaymentVanishTriggers({
      beforeState: before,
      afterState: after,
      chainId: "cost:vanish",
      actingPlayerId: "alice",
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lk.getRegisteredBurstActions,
    });

    expect(collected.pendingTriggeredEffects).toHaveLength(0);
    expect(collected.pendingBurstChecks).toHaveLength(0);
  });

  it("召喚コストを既存スピリットの最後のコアで支払い消滅させると、その「消滅したとき」誘発が発火する", () => {
    const defA = makeSpirit("A");
    const defB = makeSpirit("B", [
      {
        timing: { kind: "card_event", event: "vanish" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defA, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defA, {
          instanceId: "hand-A",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 3 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const summoned = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-A",
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
    }).state;
    const final = drive(summoned, defs);

    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    // B の「消滅したとき」誘発が発火し count+1 されている。
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });

  it("マジック使用コストを既存スピリットの最後のコアで支払い消滅させると「消滅したとき」誘発が発火する", () => {
    const defMagic: CardDefinition = {
      cardNo: "MAG",
      name: "Mag",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "magic_use" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
    const defB = makeSpirit("B", [
      {
        timing: { kind: "card_event", event: "vanish" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defMagic, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defMagic, {
          instanceId: "hand-mag",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const used = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "hand-mag",
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      chosenTiming: "main",
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
    }).state;
    const final = drive(used, defs);

    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });

  it("通常マジックの finalize flush 後に物理 leave_field 誘発を収集する", () => {
    const defMagic: CardDefinition = {
      cardNo: "P3-108-MAGIC-LEAVE-FIELD",
      name: "Magic Leave Field Regression",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
    const defB = makeSpirit("P3-108-MAGIC-LEAVE-FIELD-SOURCE");
    const defObserver = makeSpirit("P3-108-MAGIC-LEAVE-FIELD-OBSERVER", [
      {
        timing: { kind: "game_event", event: "leave_field", player: "self" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defMagic, defB, defObserver];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defMagic, {
          instanceId: "hand-magic-leave",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(defObserver, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5, reserveNormalCoreCount: 0 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const useMagicAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "hand-magic-leave"
    );
    expect(useMagicAction).toBeDefined();
    const afterUse = applyLegalAction({
      state,
      action: useMagicAction!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;
    expect(afterUse.stackWindow).not.toBeNull();
    const magicChainPendingLeave = afterUse.pendingLeaveEntities.find(
      (pending) => pending.instanceId === "field-B"
    );
    expect(magicChainPendingLeave?.kind).toBe("vanish");
    expect(magicChainPendingLeave?.chainId).toContain("hand-magic-leave");
    expect(
      afterUse.cardInstances.find((c) => c.instanceId === "field-B")
        ?.pendingLeaveKind
    ).toBe("vanish");

    const passAction = getLegalActions({
      state: afterUse,
      actingPlayerId: "bob",
      ...lk,
    }).find((action) => action.kind === "pass_stack");
    expect(passAction).toBeDefined();
    const afterPass = applyLegalAction({
      state: afterUse,
      action: passAction!,
      ...lk,
    }).state;

    expect(
      afterPass.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      afterPass.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "leave_field"
      )
    ).toHaveLength(1);
    expect(
      afterPass.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "destroy"
      )
    ).toHaveLength(0);
    expect(afterPass.players.find((p) => p.id === "alice")?.deckCount).toBe(4);

    const final = drive(afterPass, defs);
    expect(final.pendingTriggeredEffects).toHaveLength(0);
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });

  it("P3-108-MIRAGE-COST: ミラージュセットコストで最後のコアを支払うと「消滅したとき」誘発が発火する", () => {
    const defMirage: CardDefinition = {
      cardNo: "P3-108-MIRAGE-COST",
      name: "Mirage Cost Regression",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: ["mirage"],
      mirageData: { cost: 1, reduction: [] },
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defB = makeSpirit("P3-108-MIRAGE-VANISH-SOURCE", [
      {
        timing: { kind: "card_event", event: "vanish" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defMirage, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defMirage, {
          instanceId: "hand-mirage",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ handCount: 1, reserveNormalCoreCount: 0 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const setMirageAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "set_mirage");

    expect(setMirageAction?.sourceCardNo).toBe("P3-108-MIRAGE-COST");

    const set = applyLegalAction({
      state,
      action: setMirageAction!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;
    const final = drive(set, defs);

    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-mirage")?.zone
    ).toBe("mirage");
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });

  it("P3-108-MIRAGE-NO-TRIGGER: ミラージュセットコストの消滅は誘発なしでもチェーン終端でflushされる", () => {
    const defMirage: CardDefinition = {
      cardNo: "P3-108-MIRAGE-NO-TRIGGER",
      name: "Mirage No Trigger Regression",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: ["mirage"],
      mirageData: { cost: 1, reduction: [] },
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defB = makeSpirit("P3-108-MIRAGE-NO-TRIGGER-SOURCE");
    const defs = [defMirage, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defMirage, {
          instanceId: "hand-mirage",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ handCount: 1, reserveNormalCoreCount: 0 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const setMirageAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "set_mirage");

    expect(setMirageAction?.sourceCardNo).toBe("P3-108-MIRAGE-NO-TRIGGER");

    const set = applyLegalAction({
      state,
      action: setMirageAction!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;
    const resolved = drive(set, defs);

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(resolved.pendingLeaveEntities).toHaveLength(0);
    expect(resolved.pendingTriggeredEffects).toHaveLength(0);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "hand-mirage")?.zone
    ).toBe("mirage");
  });

  it("P3-108-MIRAGE-LEAVE-FIELD: ミラージュセットコストの実離脱後にleave_field誘発が発火する", () => {
    const defMirage: CardDefinition = {
      cardNo: "P3-108-MIRAGE-LEAVE-FIELD",
      name: "Mirage Leave Field Regression",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: ["mirage"],
      mirageData: { cost: 1, reduction: [] },
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defB = makeSpirit("P3-108-MIRAGE-LEAVE-FIELD-SOURCE");
    const defObserver = makeSpirit("P3-108-MIRAGE-LEAVE-FIELD-OBSERVER", [
      {
        timing: { kind: "game_event", event: "leave_field", player: "self" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defMirage, defB, defObserver];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defMirage, {
          instanceId: "hand-mirage",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(defObserver, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ handCount: 1, reserveNormalCoreCount: 0 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const setMirageAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "set_mirage");

    expect(setMirageAction?.sourceCardNo).toBe("P3-108-MIRAGE-LEAVE-FIELD");

    const set = applyLegalAction({
      state,
      action: setMirageAction!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;
    const final = drive(set, defs);

    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });

  it("P3-108-MIRAGE-CHAIN-SCOPE: ミラージュセット終端flushは別chainのpendingLeaveを残す", () => {
    const defMirage: CardDefinition = {
      cardNo: "P3-108-MIRAGE-CHAIN-SCOPE",
      name: "Mirage Chain Scope Regression",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: ["mirage"],
      mirageData: { cost: 1, reduction: [] },
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defB = makeSpirit("P3-108-MIRAGE-CHAIN-SCOPE-PAID");
    const defC = makeSpirit("P3-108-MIRAGE-CHAIN-SCOPE-OTHER");
    const defs = [defMirage, defB, defC];
    const lk = lookups(defs);
    const otherChainId = "external:other-chain";
    const otherPendingLeave: PendingLeaveEntity = {
      instanceId: "field-C",
      kind: "vanish",
      cause: "effect",
      causePlayerId: "alice",
      chainId: otherChainId,
      deferZoneMoveUntilChainEnd: true,
      leaveFieldCoreDestinationOverride: null,
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defMirage, {
          instanceId: "hand-mirage",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        {
          ...createCardInstance(defC, {
            instanceId: "field-C",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 0,
          }),
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "effect",
          pendingLeaveChainId: otherChainId,
          deferZoneMoveUntilChainEnd: true,
        },
      ],
      playerOverrides: [{ handCount: 1, reserveNormalCoreCount: 0 }],
    });
    const state: GameState = {
      ...base,
      step: "main",
      activePlayerId: "alice",
      pendingLeaveEntities: [otherPendingLeave],
    };
    const setMirageAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "set_mirage");

    expect(setMirageAction?.sourceCardNo).toBe("P3-108-MIRAGE-CHAIN-SCOPE");

    const set = applyLegalAction({
      state,
      action: setMirageAction!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;
    const resolved = drive(set, defs);

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "field-C")?.zone
    ).toBe("field");
    expect(resolved.pendingLeaveEntities).toEqual([otherPendingLeave]);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "field-C")
        ?.pendingLeaveChainId
    ).toBe(otherChainId);
  });

  it("P3-108-MIRAGE-BRAVE-KEEP: 合体ホストをミラージュコストで消滅させても残す選択後にflushされる", () => {
    const defMirage: CardDefinition = {
      cardNo: "P3-108-MIRAGE-BRAVE-KEEP",
      name: "Mirage Brave Keep Regression",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: ["mirage"],
      mirageData: { cost: 1, reduction: [] },
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defHost = makeSpirit("P3-108-MIRAGE-BRAVE-KEEP-HOST");
    const defBrave = makeSpirit("P3-108-MIRAGE-BRAVE-KEEP-BRAVE");
    const defs = [defMirage, defHost, defBrave];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defMirage, {
          instanceId: "hand-mirage",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defHost, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          attachedChildrenIds: ["brave"],
        }),
        createCardInstance(defBrave, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          attachedToInstanceId: "host",
        }),
      ],
      playerOverrides: [{ handCount: 1, reserveNormalCoreCount: 0 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const setMirageAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "set_mirage");
    const declared = applyLegalAction({
      state,
      action: setMirageAction!,
      paymentSources: [{ kind: "card", instanceId: "host", amount: 1 }],
      ...lk,
    }).state;
    const awaitingChoice = drive(declared, defs);
    const keepAction = getLegalActions({
      state: awaitingChoice,
      actingPlayerId: "alice",
      ...lk,
    }).find(
      (a) => a.kind === "resolve_brave_leave_choice" && a.choice === "keep"
    );

    expect(awaitingChoice.pendingBraveLeaveChoice?.hostInstanceId).toBe("host");
    expect(keepAction).toBeDefined();

    const kept = applyLegalAction({
      state: awaitingChoice,
      action: keepAction!,
      ...lk,
    }).state;

    expect(kept.pendingBraveLeaveChoice).toBeNull();
    expect(kept.pendingLeaveEntities).toHaveLength(0);
    expect(kept.cardInstances.find((c) => c.instanceId === "host")?.zone).toBe(
      "trash"
    );
    expect(kept.cardInstances.find((c) => c.instanceId === "brave")?.zone).toBe(
      "field"
    );
    expect(
      kept.cardInstances.find((c) => c.instanceId === "brave")
        ?.attachedToInstanceId
    ).toBeNull();
  });

  it("P3-108-MIRAGE-BRAVE-SEND: 合体ホストをミラージュコストで消滅させても一緒に送る選択後にflushされる", () => {
    const defMirage: CardDefinition = {
      cardNo: "P3-108-MIRAGE-BRAVE-SEND",
      name: "Mirage Brave Send Regression",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: ["mirage"],
      mirageData: { cost: 1, reduction: [] },
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defHost = makeSpirit("P3-108-MIRAGE-BRAVE-SEND-HOST");
    const defBrave = makeSpirit("P3-108-MIRAGE-BRAVE-SEND-BRAVE");
    const defOther = makeSpirit("P3-108-MIRAGE-BRAVE-SEND-OTHER");
    const defs = [defMirage, defHost, defBrave, defOther];
    const lk = lookups(defs);
    const otherChainId = "external:brave-choice-other";
    const otherPendingLeave: PendingLeaveEntity = {
      instanceId: "field-C",
      kind: "vanish",
      cause: "effect",
      causePlayerId: "alice",
      chainId: otherChainId,
      deferZoneMoveUntilChainEnd: true,
      leaveFieldCoreDestinationOverride: null,
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defMirage, {
          instanceId: "hand-mirage",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defHost, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          attachedChildrenIds: ["brave"],
        }),
        createCardInstance(defBrave, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          attachedToInstanceId: "host",
        }),
        {
          ...createCardInstance(defOther, {
            instanceId: "field-C",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 0,
          }),
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "effect",
          pendingLeaveChainId: otherChainId,
          deferZoneMoveUntilChainEnd: true,
        },
      ],
      playerOverrides: [{ handCount: 1, reserveNormalCoreCount: 0 }],
    });
    const state: GameState = {
      ...base,
      step: "main",
      activePlayerId: "alice",
      pendingLeaveEntities: [otherPendingLeave],
    };
    const setMirageAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "set_mirage");
    const declared = applyLegalAction({
      state,
      action: setMirageAction!,
      paymentSources: [{ kind: "card", instanceId: "host", amount: 1 }],
      ...lk,
    }).state;
    const awaitingChoice = drive(declared, defs);
    const sendAction = getLegalActions({
      state: awaitingChoice,
      actingPlayerId: "alice",
      ...lk,
    }).find(
      (a) =>
        a.kind === "resolve_brave_leave_choice" && a.choice === "send_with_host"
    );

    expect(awaitingChoice.pendingBraveLeaveChoice?.hostInstanceId).toBe("host");
    expect(awaitingChoice.pendingLeaveEntities).toEqual(
      expect.arrayContaining([otherPendingLeave])
    );
    expect(sendAction).toBeDefined();

    const sent = applyLegalAction({
      state: awaitingChoice,
      action: sendAction!,
      ...lk,
    }).state;

    expect(sent.pendingBraveLeaveChoice).toBeNull();
    expect(sent.pendingLeaveEntities).toEqual([otherPendingLeave]);
    expect(sent.cardInstances.find((c) => c.instanceId === "host")?.zone).toBe(
      "trash"
    );
    expect(sent.cardInstances.find((c) => c.instanceId === "brave")?.zone).toBe(
      "trash"
    );
    expect(
      sent.cardInstances.find((c) => c.instanceId === "field-C")?.zone
    ).toBe("field");
  });

  it("P3-108-BRAVE-CHOICE-ATTACK: アタック中のブレイヴ残存選択後は自動で継続する", () => {
    const defHost = makeSpirit("P3-108-BRAVE-CHOICE-ATTACK-HOST");
    const defBrave = makeSpirit("P3-108-BRAVE-CHOICE-ATTACK-BRAVE");
    const defObserver = makeSpirit("P3-108-BRAVE-CHOICE-ATTACK-OBSERVER", [
      {
        timing: { kind: "game_event", event: "leave_field", player: "self" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defHost, defBrave, defObserver];
    const lk = lookups(defs);
    const entityId = "entity-combined";
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      step: "attack",
      activePlayerId: "alice",
      cardInstances: [
        {
          ...createCardInstance(defHost, {
            instanceId: "host",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 0,
            attachedChildrenIds: ["brave"],
          }),
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "cost_payment",
          pendingLeaveChainId: "mirage:attack-choice",
          deferZoneMoveUntilChainEnd: true,
        },
        createCardInstance(defBrave, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          zoneRoleName: "brave",
          attachedToInstanceId: "host",
        }),
        createCardInstance(defObserver, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      battleEntities: [
        {
          entityId,
          memberInstanceIds: ["host", "brave"],
          resolvedBp: 3000,
          resolvedSymbols: ["red", "white"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack-1",
        primaryEntityId: entityId,
        participantEntityIds: [entityId],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        designatedTargetInstanceId: undefined,
        blockAssignments: [],
        symbolResolutionOrder: [entityId],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      pendingLeaveEntities: [
        {
          instanceId: "host",
          kind: "vanish",
          cause: "cost_payment",
          causePlayerId: null,
          chainId: "mirage:attack-choice",
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
      pendingBraveLeaveChoice: {
        choosingPlayerId: "alice",
        hostInstanceId: "host",
        braveInstanceIds: ["brave"],
        leaveKind: "vanish",
        leaveCause: "cost_payment",
      },
    };
    const keepAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find(
      (a) => a.kind === "resolve_brave_leave_choice" && a.choice === "keep"
    );

    expect(keepAction).toBeDefined();

    const kept = applyLegalAction({
      state,
      action: keepAction!,
      ...lk,
    }).state;

    expect(kept.pendingBraveLeaveChoice).toBeNull();
    expect(kept.pendingLeaveEntities).toHaveLength(0);
    expect(kept.cardInstances.find((c) => c.instanceId === "host")?.zone).toBe(
      "trash"
    );
    expect(kept.cardInstances.find((c) => c.instanceId === "brave")?.zone).toBe(
      "field"
    );
    expect(kept.pendingBraveAttackContinuation).toBeNull();
    expect(
      kept.pendingTriggeredEffects.map((effect) => effect.chainId)
    ).toEqual(expect.arrayContaining(["mirage:attack-choice"]));
  });

  it("アクセル使用コストを既存スピリットの最後のコアで支払い消滅させると「消滅したとき」誘発が発火する", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL",
      name: "Accel",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "flash",
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    };
    const defB = makeSpirit("B", [
      {
        timing: { kind: "card_event", event: "vanish" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defAccel, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const used = useAccelCardAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-accel",
      accelData: defAccel.accelData!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lk.getRegisteredBurstActions,
    }).state;
    expect(
      used.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("in_use");
    expect(used.pendingAccelCleanups).toHaveLength(1);
    const final = drive(used, defs);

    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("set_aside");
    expect(final.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
    const vanishFlushIndex = final.log.findIndex((entry) =>
      entry.startsWith("pending-leave-flushed:vanish:field-B:")
    );
    const accelSetAsideIndex = final.log.findIndex((entry) =>
      entry.startsWith("accel:set-aside:")
    );
    expect(vanishFlushIndex).toBeGreaterThanOrEqual(0);
    expect(accelSetAsideIndex).toBeGreaterThanOrEqual(0);
    expect(vanishFlushIndex).toBeLessThan(accelSetAsideIndex);
  });

  it("破壊待機中のコアをアクセルコストに使っても消滅待機へ変更しない", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-PENDING-TRANSITION",
      name: "Accel Pending Transition",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "main" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    };
    const defB = makeSpirit("B", [
      {
        timing: { kind: "card_event", event: "vanish" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defAccel, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const destroyPending = queuePendingLeave({
      state: { ...base, step: "main", activePlayerId: "alice" },
      instanceId: "field-B",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: "bob",
      chainId: "destroy:field-B",
      deferZoneMoveUntilChainEnd: true,
    });

    const used = useAccelCardAsAction({
      state: destroyPending,
      actingPlayerId: "alice",
      cardInstanceId: "hand-accel",
      accelData: defAccel.accelData!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lk.getRegisteredBurstActions,
    }).state;

    expect(
      used.cardInstances.find((c) => c.instanceId === "field-B")
        ?.pendingLeaveKind
    ).toBeNull(); // direct アクセルは解決まで進むため、元の破壊待機は実移動済み。
    expect(
      used.pendingLeaveEntities.find((p) => p.instanceId === "field-B")?.kind
    ).toBeUndefined();
    expect(
      used.pendingTriggeredEffects.some(
        (effect) =>
          effect.eventKind === "vanish" &&
          effect.relatedInstanceId === "field-B"
      )
    ).toBe(false);

    const final = drive(used, defs);

    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(0);
    expect(
      final.log.some((entry) =>
        entry.startsWith("pending-leave-transition:destroy->vanish:field-B")
      )
    ).toBe(false);
  });

  it("待機状態間遷移では旧待機状態の private/deferred/burst pending も無効化する", () => {
    const defB = makeSpirit("B");
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const destroyChainId = "destroy:field-B";
    const destroyPending = queuePendingLeave({
      state: { ...base, step: "main", activePlayerId: "alice" },
      instanceId: "field-B",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: "bob",
      chainId: destroyChainId,
      deferZoneMoveUntilChainEnd: true,
    });
    const oldTriggered: PendingTriggeredEffect = {
      pendingId: "old-destroy-trigger",
      actingPlayerId: "alice",
      eventKind: "destroy",
      source: "action_resolution",
      chainId: destroyChainId,
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "field-B",
      amount: null,
      step: "main",
      window: "main",
      resolvedSourceInstanceIds: [],
    };
    const oldDeferred: PendingTriggeredEffect = {
      ...oldTriggered,
      pendingId: "old-destroy-deferred",
    };
    const oldPrivate: PendingPrivateDeclaration = {
      declarationId: "old-destroy-private",
      ownerPlayerId: "alice",
      actingPlayerId: "alice",
      sourceInstanceId: "hand-listener",
      sourceDefinitionId: "LISTENER",
      sourceKind: "spirit",
      sourceZone: "hand",
      registrationIndex: 0,
      pendingId: "old-destroy-private-pending",
      eventKind: "destroy",
      source: "action_resolution",
      chainId: destroyChainId,
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "field-B",
      amount: null,
      step: "main",
      window: "main",
    };
    const oldBurst: PendingBurstCheck = {
      checkId: "old-destroy-burst",
      actingPlayerId: "bob",
      eventKind: "leave_field",
      source: "action_resolution",
      chainId: destroyChainId,
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "field-B",
      amount: 1,
      step: "main",
      window: "main",
      resolvedBurstCardInstanceIds: [],
    };

    const transitioned = queuePendingLeave({
      state: {
        ...destroyPending,
        pendingTriggeredEffects: [oldTriggered],
        pendingDeferredTriggeredEffects: [oldDeferred],
        pendingPrivateDeclarations: [oldPrivate],
        pendingBurstChecks: [oldBurst],
      },
      instanceId: "field-B",
      kind: "vanish",
      cause: "cost_payment",
      causePlayerId: null,
      chainId: "cost:field-B",
      deferZoneMoveUntilChainEnd: true,
    });

    expect(transitioned.pendingTriggeredEffects).toHaveLength(0);
    expect(transitioned.pendingDeferredTriggeredEffects).toHaveLength(0);
    expect(transitioned.pendingPrivateDeclarations).toHaveLength(0);
    expect(transitioned.pendingBurstChecks).toHaveLength(0);
    expect(
      transitioned.pendingLeaveEntities.find((p) => p.instanceId === "field-B")
        ?.kind
    ).toBe("vanish");
  });

  it("direct アクセル使用でコスト支払い消滅リスナーが無くても cleanup が stranded しない", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-NO-LISTENER",
      name: "Accel No Listener",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "main" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    };
    const defB = makeSpirit("B");
    const defBurst = makeSpirit("BURST");
    const defs = [defAccel, defB, defBurst];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });

    const used = useAccelCardAsAction({
      state: { ...base, step: "main", activePlayerId: "alice" },
      actingPlayerId: "alice",
      cardInstanceId: "hand-accel",
      accelData: defAccel.accelData!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lk.getRegisteredBurstActions,
    }).state;

    expect(
      used.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      used.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("set_aside");
    expect(used.pendingLeaveEntities).toHaveLength(0);
    expect(used.pendingAccelCleanups ?? []).toHaveLength(0);
  });

  it("pending accel cleanup finalize は flush 後の leave_field 誘発を収集してから手元へ移す", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-LEAVE",
      name: "Accel Leave",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "main" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    };
    const defB = makeSpirit("B");
    const defObserver = makeSpirit("OBSERVER", [
      {
        timing: { kind: "game_event", event: "leave_field" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defAccel, defB, defObserver];
    const lk = lookups(defs);
    const chainId = "accel:alice:hand-accel:0";
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(defObserver, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const leaveEntity: PendingLeaveEntity = {
      instanceId: "field-B",
      kind: "vanish",
      cause: "cost_payment",
      causePlayerId: null,
      chainId,
      deferZoneMoveUntilChainEnd: true,
      leaveFieldCoreDestinationOverride: null,
    };
    const used = finalizePendingAccelCleanups(
      {
        ...base,
        step: "main",
        activePlayerId: "alice",
        cardInstances: base.cardInstances.map((card) =>
          card.instanceId === "field-B"
            ? {
                ...card,
                pendingLeaveKind: "vanish",
                pendingLeaveCause: "cost_payment",
                pendingLeaveChainId: chainId,
                deferZoneMoveUntilChainEnd: true,
              }
            : card
        ),
        pendingLeaveEntities: [leaveEntity],
        pendingAccelCleanups: [
          { chainId, cardInstanceId: "hand-accel", outcome: "set_aside" },
        ],
      },
      lk.getCardDefinitionById,
      lk.getRegisteredTriggeredEffectActions,
      lk.getRegisteredBurstActions
    );

    expect(
      used.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      used.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("in_use");
    expect(used.pendingTriggeredEffects[0]?.eventKind).toBe("leave_field");
    expect(used.pendingAccelCleanups).toHaveLength(1);

    const final = drive(used, defs);
    expect(final.pendingTriggeredEffects).toHaveLength(0);
    expect(final.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("set_aside");
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });

  it("複数 pending accel cleanup は各 chain の leave_field 誘発を待ってから手元へ移す", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-MULTI-LEAVE",
      name: "Accel Multi Leave",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 1,
        reduction: [],
        effects: [],
      },
    };
    const defB = makeSpirit("B");
    const defObserver = makeSpirit("OBSERVER-MULTI", [
      {
        timing: { kind: "game_event", event: "leave_field" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defAccel, defB, defObserver];
    const lk = lookups(defs);
    const chainA = "accel:alice:hand-accel-a:0";
    const chainB = "accel:alice:hand-accel-b:0";
    const leaveA: PendingLeaveEntity = {
      instanceId: "field-A",
      kind: "vanish",
      cause: "cost_payment",
      causePlayerId: null,
      chainId: chainA,
      deferZoneMoveUntilChainEnd: true,
      leaveFieldCoreDestinationOverride: null,
    };
    const leaveB: PendingLeaveEntity = {
      instanceId: "field-B",
      kind: "vanish",
      cause: "cost_payment",
      causePlayerId: null,
      chainId: chainB,
      deferZoneMoveUntilChainEnd: true,
      leaveFieldCoreDestinationOverride: null,
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel-a",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
        createCardInstance(defAccel, {
          instanceId: "hand-accel-b",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
        createCardInstance(defB, {
          instanceId: "field-A",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(defObserver, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const used = finalizePendingAccelCleanups(
      {
        ...base,
        cardInstances: base.cardInstances.map((card) => {
          if (card.instanceId === "field-A") {
            return {
              ...card,
              pendingLeaveKind: "vanish",
              pendingLeaveCause: "cost_payment",
              pendingLeaveChainId: chainA,
              deferZoneMoveUntilChainEnd: true,
            };
          }
          if (card.instanceId === "field-B") {
            return {
              ...card,
              pendingLeaveKind: "vanish",
              pendingLeaveCause: "cost_payment",
              pendingLeaveChainId: chainB,
              deferZoneMoveUntilChainEnd: true,
            };
          }
          return card;
        }),
        pendingLeaveEntities: [leaveA, leaveB],
        pendingAccelCleanups: [
          {
            chainId: chainA,
            cardInstanceId: "hand-accel-a",
            outcome: "set_aside",
          },
          {
            chainId: chainB,
            cardInstanceId: "hand-accel-b",
            outcome: "set_aside",
          },
        ],
      },
      lk.getCardDefinitionById,
      lk.getRegisteredTriggeredEffectActions,
      lk.getRegisteredBurstActions
    );

    expect(used.pendingLeaveEntities).toHaveLength(0);
    expect(
      used.cardInstances.find((c) => c.instanceId === "field-A")?.zone
    ).toBe("trash");
    expect(
      used.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      used.cardInstances.find((c) => c.instanceId === "hand-accel-a")?.zone
    ).toBe("in_use");
    expect(
      used.cardInstances.find((c) => c.instanceId === "hand-accel-b")?.zone
    ).toBe("in_use");
    expect(used.pendingAccelCleanups).toHaveLength(2);
    expect(
      used.pendingTriggeredEffects.map((effect) => effect.chainId)
    ).toEqual(expect.arrayContaining([chainA, chainB]));

    const final = drive(used, defs);
    expect(final.pendingTriggeredEffects).toHaveLength(0);
    expect(final.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-accel-a")?.zone
    ).toBe("set_aside");
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-accel-b")?.zone
    ).toBe("set_aside");
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(2);
  });

  it("複数 pending accel cleanup は blocker のある chain だけ remaining に残す", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-PARTIAL-CLEANUP",
      name: "Accel Partial Cleanup",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 1,
        reduction: [],
        effects: [],
      },
    };
    const lk = lookups([defAccel]);
    const chainA = "accel:alice:hand-accel-a:blocking";
    const chainB = "accel:alice:hand-accel-b:clear";
    const blockingTrigger: PendingTriggeredEffect = {
      pendingId: "pending:blocking-a",
      actingPlayerId: "alice",
      eventKind: "leave_field",
      source: "action_resolution",
      chainId: chainA,
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "field-A",
      amount: 0,
      step: "main",
      window: "main",
      resolvedSourceInstanceIds: [],
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel-a",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
        createCardInstance(defAccel, {
          instanceId: "hand-accel-b",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
      ],
    });

    const finalized = finalizePendingAccelCleanups(
      {
        ...base,
        pendingTriggeredEffects: [blockingTrigger],
        pendingAccelCleanups: [
          {
            chainId: chainA,
            cardInstanceId: "hand-accel-a",
            outcome: "set_aside",
          },
          {
            chainId: chainB,
            cardInstanceId: "hand-accel-b",
            outcome: "set_aside",
          },
        ],
      },
      lk.getCardDefinitionById,
      lk.getRegisteredTriggeredEffectActions,
      lk.getRegisteredBurstActions
    );

    expect(finalized.pendingAccelCleanups).toEqual([
      {
        chainId: chainA,
        cardInstanceId: "hand-accel-a",
        outcome: "set_aside",
      },
    ]);
    expect(
      finalized.cardInstances.find((c) => c.instanceId === "hand-accel-a")?.zone
    ).toBe("in_use");
    expect(
      finalized.cardInstances.find((c) => c.instanceId === "hand-accel-b")?.zone
    ).toBe("set_aside");
  });

  it("pending accel cleanup の chain 判定は card-1 と card-10 を prefix 衝突させない", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-PREFIX-CLEANUP",
      name: "Accel Prefix Cleanup",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 1,
        reduction: [],
        effects: [],
      },
    };
    const lk = lookups([defAccel]);
    const chainCard1 = "accel:1:alice:main:card-1";
    const chainCard10 = "accel:1:alice:main:card-10";
    const unrelatedTrigger: PendingTriggeredEffect = {
      pendingId: "pending:card-10",
      actingPlayerId: "alice",
      eventKind: "leave_field",
      source: "action_resolution",
      chainId: chainCard10,
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "field-10",
      amount: 0,
      step: "main",
      window: "main",
      resolvedSourceInstanceIds: [],
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "card-1",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
      ],
    });

    const finalized = finalizePendingAccelCleanups(
      {
        ...base,
        pendingTriggeredEffects: [unrelatedTrigger],
        pendingAccelCleanups: [
          {
            chainId: chainCard1,
            cardInstanceId: "card-1",
            outcome: "set_aside",
          },
        ],
      },
      lk.getCardDefinitionById,
      lk.getRegisteredTriggeredEffectActions,
      lk.getRegisteredBurstActions
    );

    expect(finalized.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(
      finalized.cardInstances.find((c) => c.instanceId === "card-1")?.zone
    ).toBe("set_aside");
  });

  it("pending accel cleanup は wrapper chain に包まれた子孫 pending を blocker として扱う", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-WRAPPED-CHAIN",
      name: "Accel Wrapped Chain",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 1,
        reduction: [],
        effects: [],
      },
    };
    const lk = lookups([defAccel]);
    const parentChain = "accel:alice:parent";
    const wrappedChildChain = `core-split:effect-target:${parentChain}`;
    const blockingTrigger: PendingTriggeredEffect = {
      pendingId: "pending:wrapped-child",
      actingPlayerId: "alice",
      eventKind: "leave_field",
      source: "action_resolution",
      chainId: wrappedChildChain,
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "field-B",
      amount: 0,
      step: "main",
      window: "main",
      resolvedSourceInstanceIds: [],
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
      ],
    });

    const finalized = finalizePendingAccelCleanups(
      {
        ...base,
        pendingTriggeredEffects: [blockingTrigger],
        pendingAccelCleanups: [
          {
            chainId: parentChain,
            cardInstanceId: "hand-accel",
            outcome: "set_aside",
          },
        ],
      },
      lk.getCardDefinitionById,
      lk.getRegisteredTriggeredEffectActions,
      lk.getRegisteredBurstActions
    );

    expect(finalized.pendingAccelCleanups).toHaveLength(1);
    expect(
      finalized.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("in_use");
  });

  it("親子 chain の pending accel cleanup は子孫 pending leave を先に flush する", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-NESTED-CLEANUP",
      name: "Accel Nested Cleanup",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 1,
        reduction: [],
        effects: [],
      },
    };
    const defB = makeSpirit("B");
    const defs = [defAccel, defB];
    const lk = lookups(defs);
    const parentChain = "accel:alice:parent";
    const childChain = `${parentChain}:after_triggers:0`;
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel-parent",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
        createCardInstance(defAccel, {
          instanceId: "hand-accel-child",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
        createCardInstance(defB, {
          instanceId: "field-parent",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(defB, {
          instanceId: "field-child",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
      ],
    });
    const withPendingLeaves: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((card) => {
        if (card.instanceId === "field-parent") {
          return {
            ...card,
            pendingLeaveKind: "vanish",
            pendingLeaveCause: "cost_payment",
            pendingLeaveChainId: parentChain,
            deferZoneMoveUntilChainEnd: true,
          };
        }
        if (card.instanceId === "field-child") {
          return {
            ...card,
            pendingLeaveKind: "vanish",
            pendingLeaveCause: "cost_payment",
            pendingLeaveChainId: childChain,
            deferZoneMoveUntilChainEnd: true,
          };
        }
        return card;
      }),
      pendingLeaveEntities: [
        {
          instanceId: "field-parent",
          kind: "vanish",
          cause: "cost_payment",
          causePlayerId: null,
          chainId: parentChain,
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
        {
          instanceId: "field-child",
          kind: "vanish",
          cause: "cost_payment",
          causePlayerId: null,
          chainId: childChain,
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
      pendingAccelCleanups: [
        {
          chainId: parentChain,
          cardInstanceId: "hand-accel-parent",
          outcome: "set_aside",
        },
        {
          chainId: childChain,
          cardInstanceId: "hand-accel-child",
          outcome: "set_aside",
        },
      ],
    };

    const finalized = finalizePendingAccelCleanups(
      withPendingLeaves,
      lk.getCardDefinitionById,
      lk.getRegisteredTriggeredEffectActions,
      lk.getRegisteredBurstActions
    );

    expect(finalized.pendingLeaveEntities).toHaveLength(0);
    expect(finalized.pendingAccelCleanups ?? []).toHaveLength(0);
    const childFlushIndex = finalized.log.findIndex((entry) =>
      entry.startsWith("pending-leave-flushed:vanish:field-child:")
    );
    const parentFlushIndex = finalized.log.findIndex((entry) =>
      entry.startsWith("pending-leave-flushed:vanish:field-parent:")
    );
    expect(childFlushIndex).toBeGreaterThanOrEqual(0);
    expect(parentFlushIndex).toBeGreaterThanOrEqual(0);
    expect(childFlushIndex).toBeLessThan(parentFlushIndex);
  });

  it("子孫 pending leave に cleanup が無くても親 cleanup finalize は deepest-first で flush する", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-NESTED-LEAVE-ONLY",
      name: "Accel Nested Leave Only",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 1,
        reduction: [],
        effects: [],
      },
    };
    const defB = makeSpirit("B");
    const defs = [defAccel, defB];
    const lk = lookups(defs);
    const parentChain = "accel:alice:parent-no-child-cleanup";
    const childChain = `${parentChain}:after_triggers:0`;
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel-parent",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
        createCardInstance(defB, {
          instanceId: "field-parent",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(defB, {
          instanceId: "field-child",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
      ],
    });
    const withPendingLeaves: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((card) => {
        if (card.instanceId === "field-parent") {
          return {
            ...card,
            pendingLeaveKind: "vanish",
            pendingLeaveCause: "cost_payment",
            pendingLeaveChainId: parentChain,
            deferZoneMoveUntilChainEnd: true,
          };
        }
        if (card.instanceId === "field-child") {
          return {
            ...card,
            pendingLeaveKind: "vanish",
            pendingLeaveCause: "cost_payment",
            pendingLeaveChainId: childChain,
            deferZoneMoveUntilChainEnd: true,
          };
        }
        return card;
      }),
      pendingLeaveEntities: [
        {
          instanceId: "field-parent",
          kind: "vanish",
          cause: "cost_payment",
          causePlayerId: null,
          chainId: parentChain,
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
        {
          instanceId: "field-child",
          kind: "vanish",
          cause: "cost_payment",
          causePlayerId: null,
          chainId: childChain,
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
      pendingAccelCleanups: [
        {
          chainId: parentChain,
          cardInstanceId: "hand-accel-parent",
          outcome: "set_aside",
        },
      ],
    };

    const finalized = finalizePendingAccelCleanups(
      withPendingLeaves,
      lk.getCardDefinitionById,
      lk.getRegisteredTriggeredEffectActions,
      lk.getRegisteredBurstActions
    );

    expect(finalized.pendingLeaveEntities).toHaveLength(0);
    expect(finalized.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(
      finalized.cardInstances.find((c) => c.instanceId === "hand-accel-parent")
        ?.zone
    ).toBe("set_aside");
    const childFlushIndex = finalized.log.findIndex((entry) =>
      entry.startsWith("pending-leave-flushed:vanish:field-child:")
    );
    const parentFlushIndex = finalized.log.findIndex((entry) =>
      entry.startsWith("pending-leave-flushed:vanish:field-parent:")
    );
    expect(childFlushIndex).toBeGreaterThanOrEqual(0);
    expect(parentFlushIndex).toBeGreaterThanOrEqual(0);
    expect(childFlushIndex).toBeLessThan(parentFlushIndex);
  });

  it("pending burst check が残っていても accel cleanup finalize はコスト支払い消滅を flush する", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-BURST-BLOCK",
      name: "Accel Burst Block",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 0,
        reduction: [],
        effects: [],
      },
    };
    const defB = makeSpirit("B");
    const defBurst = makeSpirit("BURST");
    const defs = [defAccel, defB, defBurst];
    const lk = lookups(defs);
    const chainId = "accel:alice:hand-accel:burst";
    const leaveEntity: PendingLeaveEntity = {
      instanceId: "field-B",
      kind: "vanish",
      cause: "cost_payment",
      causePlayerId: null,
      chainId,
      deferZoneMoveUntilChainEnd: true,
      leaveFieldCoreDestinationOverride: null,
    };
    const burstCheck: PendingBurstCheck = {
      checkId: "burst:cost-vanish:bob",
      actingPlayerId: "bob",
      eventKind: "leave_field",
      event: { kind: "game_event", event: "leave_field" },
      source: "action_resolution",
      chainId,
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "field-B",
      amount: 0,
      step: "main",
      window: "main",
      resolvedBurstCardInstanceIds: [],
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "in_use",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(defBurst, {
          instanceId: "burst-card",
          ownerPlayerId: "bob",
          zone: "burst",
        }),
      ],
    });
    const finalized = finalizePendingAccelCleanups(
      {
        ...base,
        cardInstances: base.cardInstances.map((card) =>
          card.instanceId === "field-B"
            ? {
                ...card,
                pendingLeaveKind: "vanish",
                pendingLeaveCause: "cost_payment",
                pendingLeaveChainId: chainId,
                deferZoneMoveUntilChainEnd: true,
              }
            : card
        ),
        pendingLeaveEntities: [leaveEntity],
        pendingBurstChecks: [burstCheck],
        setBurstStates: [{ playerId: "bob", cardInstanceId: "burst-card" }],
        pendingAccelCleanups: [
          { chainId, cardInstanceId: "hand-accel", outcome: "set_aside" },
        ],
      },
      lk.getCardDefinitionById,
      lk.getRegisteredTriggeredEffectActions,
      lk.getRegisteredBurstActions
    );

    expect(finalized.pendingLeaveEntities).toHaveLength(0);
    expect(finalized.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(finalized.pendingBurstChecks).toHaveLength(1);
    expect(
      finalized.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      finalized.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("set_aside");
  });

  it("flushPendingLeaves は同一 chain の pending burst check が残っていてもコスト支払い消滅を実移動する", () => {
    const defB = makeSpirit("B");
    const defBurst = makeSpirit("BURST");
    const defs = [defB, defBurst];
    const lk = lookups(defs);
    const chainId = "accel:alice:burst-only";
    const leaveEntity: PendingLeaveEntity = {
      instanceId: "field-B",
      kind: "vanish",
      cause: "cost_payment",
      causePlayerId: null,
      chainId,
      deferZoneMoveUntilChainEnd: true,
      leaveFieldCoreDestinationOverride: null,
    };
    const burstCheck: PendingBurstCheck = {
      checkId: "burst:cost-vanish:bob",
      actingPlayerId: "bob",
      eventKind: "leave_field",
      event: { kind: "game_event", event: "leave_field" },
      source: "action_resolution",
      chainId,
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "field-B",
      amount: 0,
      step: "main",
      window: "main",
      resolvedBurstCardInstanceIds: [],
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(defBurst, {
          instanceId: "burst-card",
          ownerPlayerId: "bob",
          zone: "burst",
        }),
      ],
    });
    const blockedState: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((card) =>
        card.instanceId === "field-B"
          ? {
              ...card,
              pendingLeaveKind: "vanish",
              pendingLeaveCause: "cost_payment",
              pendingLeaveChainId: chainId,
              deferZoneMoveUntilChainEnd: true,
            }
          : card
      ),
      pendingLeaveEntities: [leaveEntity],
      pendingBurstChecks: [burstCheck],
      setBurstStates: [{ playerId: "bob", cardInstanceId: "burst-card" }],
    };

    const flushed = flushPendingLeaves(blockedState, lk.getCardDefinitionById);
    expect(flushed.pendingLeaveEntities).toHaveLength(0);
    expect(flushed.pendingBurstChecks).toHaveLength(1);
    expect(
      flushed.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
  });

  it("applyLegalAction 経由のアクセル stack 経路でもコスト支払い消滅誘発が発火する", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL",
      name: "Accel",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "flash",
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    };
    const defB = makeSpirit("B", [
      {
        timing: { kind: "card_event", event: "vanish" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defAccel, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "use_accel");
    expect(action).toBeDefined();

    const applied = applyLegalAction({
      state,
      action: action!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;
    expect(applied.stackWindow?.pendingStackAction?.actionKind).toBe("accel");
    expect(
      applied.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("in_use");
    expect(applied.pendingAccelCleanups ?? []).toHaveLength(0);

    const passStack = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({
          state: applied,
          actingPlayerId,
          ...lk,
        })
      )
      .find((a) => a.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStack = applyLegalAction({
      state: applied,
      action: passStack!,
      ...lk,
    }).state;
    expect(
      afterStack.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("in_use");
    expect(afterStack.pendingAccelCleanups).toHaveLength(1);

    const final = drive(afterStack, defs);
    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("set_aside");
    expect(final.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
    const vanishFlushIndex = final.log.findIndex((entry) =>
      entry.startsWith("pending-leave-flushed:vanish:field-B:")
    );
    const accelSetAsideIndex = final.log.findIndex((entry) =>
      entry.startsWith("accel:set-aside:")
    );
    expect(vanishFlushIndex).toBeGreaterThanOrEqual(0);
    expect(accelSetAsideIndex).toBeGreaterThanOrEqual(0);
    expect(vanishFlushIndex).toBeLessThan(accelSetAsideIndex);
  });

  it("ライフ0の敗北はアクセル cleanup や leave_field 誘発を待たない", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-LIFE-ZERO-GATE",
      name: "Accel Life Zero Gate",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "flash",
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    };
    const defB = makeSpirit("B");
    const defObserver = makeSpirit("OBSERVER-LEAVE-LIFE-ZERO", [
      {
        timing: { kind: "game_event", event: "leave_field", player: "self" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defAccel, defB, defObserver];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(defObserver, {
          instanceId: "field-observer",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [
        { deckCount: 5 },
        { lifeNormalCoreCount: 0, reserveNormalCoreCount: 0 },
      ],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "use_accel");
    expect(action).toBeDefined();

    const applied = applyLegalAction({
      state,
      action: action!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;
    expect(applied.gameResult).toEqual({
      kind: "player_loss",
      losingPlayerId: "bob",
      reason: "life_zero",
    });
    expect(applied.players.find((p) => p.id === "alice")?.countValue).toBe(0);
    expect(
      getLegalActions({ state: applied, actingPlayerId: "bob", ...lk })
    ).toEqual([]);
  });

  it("アクセル stack の cost_payment vanish private 宣言は応答窓終了まで surface しない", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-PRIVATE-VANISH",
      name: "Accel Private Vanish",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "flash",
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    };
    const defB = makeSpirit("B");
    const defPrivateListener = makeSpirit("PRIVATE-VANISH", [
      {
        timing: { kind: "game_event", event: "vanish", player: "self" },
        applicability: { zone: "hand" },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defAccel, defB, defPrivateListener];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(defPrivateListener, {
          instanceId: "hand-private-listener",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "use_accel");
    expect(action).toBeDefined();

    const applied = applyLegalAction({
      state,
      action: action!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;

    expect(applied.stackWindow?.pendingStackAction?.actionKind).toBe("accel");
    expect(applied.pendingPrivateDeclarations).toHaveLength(1);
    expect(applied.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: "alice",
      sourceDefinitionId: "PRIVATE-VANISH",
      sourceInstanceId: "hand-private-listener",
      eventKind: "vanish",
    });

    const duringWindowActions = ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({
        state: applied,
        actingPlayerId,
        ...lk,
      })
    );
    expect(duringWindowActions.map((a) => a.kind)).not.toContain(
      "declare_private_triggered_effect"
    );
    expect(duringWindowActions.map((a) => a.kind)).not.toContain(
      "skip_private_triggered_effect"
    );

    const bobPass = getLegalActions({
      state: applied,
      actingPlayerId: "bob",
      ...lk,
    }).find((a) => a.kind === "pass_stack");
    expect(bobPass).toBeDefined();

    const afterStack = applyLegalAction({
      state: applied,
      action: bobPass!,
      ...lk,
    }).state;
    expect(afterStack.stackWindow).toBeNull();

    const afterWindowActions = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      ...lk,
    }).map((a) => a.kind);
    expect(afterWindowActions).toContain("declare_private_triggered_effect");
    expect(afterWindowActions).toContain("skip_private_triggered_effect");
  });

  it("無効化されたアクセル stack でもコスト支払い消滅を flush して誘発を解決する", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-NULL",
      name: "Accel Nullified",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "flash",
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    };
    const defB = makeSpirit("B", [
      {
        timing: { kind: "card_event", event: "vanish" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defAccel, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "use_accel");
    expect(action).toBeDefined();

    const applied = applyLegalAction({
      state,
      action: action!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;
    const pendingStack = applied.stackWindow?.pendingStackAction;
    expect(pendingStack?.actionKind).toBe("accel");
    const nullified: GameState = {
      ...applied,
      stackWindow: {
        ...applied.stackWindow!,
        pendingStackAction: { ...pendingStack!, isNullified: true },
      },
    };

    const passStack = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({
          state: nullified,
          actingPlayerId,
          ...lk,
        })
      )
      .find((a) => a.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStack = applyLegalAction({
      state: nullified,
      action: passStack!,
      ...lk,
    }).state;
    const final = drive(afterStack, defs);

    expect(final.pendingLeaveEntities).toHaveLength(0);
    expect(final.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("trash");
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });

  it("無効化されたアクセル stack でも use_accel 神託をキューし cleanup を遅延する", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-NULL-ORACLE",
      name: "Accel Nullified Oracle",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      tribe: "夜錆",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "flash",
        cost: 0,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    };
    const defGrandwalker: CardDefinition = {
      cardNo: "GW-NULL-ORACLE",
      name: "[創界神] Null Oracle",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 2,
      reductionSymbols: ["god"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["god"],
      textLines: [],
      keywordTags: ["grandwalker", "enter_field_core_placement_forbidden"],
      grandwalkerData: {
        kind: "grandwalker",
        oracleTriggerKinds: [
          "summon",
          "advent",
          "place",
          "use_magic",
          "use_accel",
        ] as const,
        oracleConditions: [{ tribes: ["夜錆"] }],
      },
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defs = [defAccel, defGrandwalker];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 3,
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defGrandwalker, {
          instanceId: "gw-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "use_accel");
    expect(action).toBeDefined();

    const applied = applyLegalAction({
      state,
      action: action!,
      ...lk,
    }).state;
    const pendingStack = applied.stackWindow?.pendingStackAction;
    expect(pendingStack?.actionKind).toBe("accel");
    const nullified: GameState = {
      ...applied,
      stackWindow: {
        ...applied.stackWindow!,
        pendingStackAction: { ...pendingStack!, isNullified: true },
      },
    };
    const passStack = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({
          state: nullified,
          actingPlayerId,
          ...lk,
        })
      )
      .find((a) => a.kind === "pass_stack");
    expect(passStack).toBeDefined();

    const afterStack = applyLegalAction({
      state: nullified,
      action: passStack!,
      ...lk,
    }).state;
    expect(afterStack.pendingTriggeredEffects[0]?.mechanic).toMatchObject({
      kind: "oracle",
      triggerKind: "use_accel",
      triggerCardInstanceId: "hand-accel",
    });
    expect(afterStack.pendingAccelCleanups).toHaveLength(1);
    expect(
      afterStack.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("in_use");

    const final = drive(afterStack, defs);
    expect(final.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("trash");
  });

  it("アクセル効果の core split continuation が閉じるまで手元移動を遅延する", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-SPLIT",
      name: "Accel Split",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 0,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "main" },
            steps: [
              {
                action: {
                  kind: "core_move",
                  from: { kind: "void", player: "self" },
                  amount: 1,
                  splitDestinations: {
                    destinations: [
                      { location: { kind: "reserve", player: "self" } },
                      { location: { kind: "trash", player: "self" } },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
    };
    const defs = [defAccel];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 3,
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const used = useAccelCardAsAction({
      state: { ...base, step: "main", activePlayerId: "alice" },
      actingPlayerId: "alice",
      cardInstanceId: "hand-accel",
      accelData: defAccel.accelData!,
      paymentSources: [],
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lk.getRegisteredBurstActions,
    }).state;

    expect(used.pendingCoreSplitSelection).not.toBeNull();
    expect(
      used.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("in_use");
    expect(used.pendingAccelCleanups).toHaveLength(1);

    const splitAction = getLegalActions({
      state: used,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "resolve_pending_core_split");
    expect(splitAction).toBeDefined();

    const resolved = applyLegalAction({
      state: used,
      action: splitAction!,
      coreSplitDistribution: [1, 0],
      ...lk,
    }).state;
    expect(resolved.pendingCoreSplitSelection).toBeNull();
    expect(resolved.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("set_aside");
  });

  it("アクセル使用時の神託 pending が閉じるまで手元移動を遅延する", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-ORACLE",
      name: "Accel Oracle",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "夜錆",
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 0,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "main" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    };
    const defGrandwalker: CardDefinition = {
      cardNo: "GW-ORACLE",
      name: "[創界神] Oracle",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 2,
      reductionSymbols: ["god"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["god"],
      textLines: [],
      keywordTags: ["grandwalker", "enter_field_core_placement_forbidden"],
      grandwalkerData: {
        kind: "grandwalker",
        oracleTriggerKinds: [
          "summon",
          "advent",
          "place",
          "use_magic",
          "use_accel",
        ] as const,
        oracleConditions: [{ tribes: ["夜錆"] }],
      },
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defs = [defAccel, defGrandwalker];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 3,
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defGrandwalker, {
          instanceId: "gw-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const used = useAccelCardAsAction({
      state: { ...base, step: "main", activePlayerId: "alice" },
      actingPlayerId: "alice",
      cardInstanceId: "hand-accel",
      accelData: defAccel.accelData!,
      paymentSources: [],
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lk.getRegisteredBurstActions,
    }).state;

    expect(used.pendingTriggeredEffects).toHaveLength(1);
    expect(used.pendingTriggeredEffects[0]?.mechanic).toMatchObject({
      kind: "oracle",
      triggerKind: "use_accel",
      triggerCardInstanceId: "hand-accel",
    });
    expect(used.pendingAccelCleanups).toHaveLength(1);
    expect(
      used.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("in_use");

    const oracleAction = getLegalActions({
      state: used,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "resolve_pending_triggered_effect");
    expect(oracleAction).toBeDefined();
    const final = applyLegalAction({
      state: used,
      action: oracleAction!,
      skipOptionalEffect: true,
      ...lk,
    }).state;
    expect(final.pendingTriggeredEffects).toHaveLength(0);
    expect(final.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("set_aside");
  });

  it("アクセル使用時の神託 pending 中はコスト支払い消滅の実移動も遅延する", () => {
    const defAccel: CardDefinition = {
      cardNo: "ACCEL-ORACLE-COST",
      name: "Accel Oracle Cost",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      tribe: "夜錆",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      accelData: {
        timing: "main",
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "main" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
      },
    };
    const defGrandwalker: CardDefinition = {
      cardNo: "GW-ORACLE-COST",
      name: "[創界神] Oracle Cost",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 2,
      reductionSymbols: ["god"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["god"],
      textLines: [],
      keywordTags: ["grandwalker", "enter_field_core_placement_forbidden"],
      grandwalkerData: {
        kind: "grandwalker",
        oracleTriggerKinds: [
          "summon",
          "advent",
          "place",
          "use_magic",
          "use_accel",
        ] as const,
        oracleConditions: [{ tribes: ["夜錆"] }],
      },
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defB = makeSpirit("B", [
      {
        timing: { kind: "card_event", event: "vanish" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defAccel, defGrandwalker, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 3,
      cardInstances: [
        createCardInstance(defAccel, {
          instanceId: "hand-accel",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defGrandwalker, {
          instanceId: "gw-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const used = useAccelCardAsAction({
      state: { ...base, step: "main", activePlayerId: "alice" },
      actingPlayerId: "alice",
      cardInstanceId: "hand-accel",
      accelData: defAccel.accelData!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lk.getRegisteredBurstActions,
    }).state;

    expect(used.pendingTriggeredEffects).toHaveLength(2);
    expect(
      used.pendingTriggeredEffects.some(
        (pending) => pending.mechanic?.kind === "oracle"
      )
    ).toBe(true);
    expect(used.pendingLeaveEntities).toHaveLength(1);
    expect(
      used.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("field");
    expect(used.pendingAccelCleanups).toHaveLength(1);

    const oraclePendingId = used.pendingTriggeredEffects.find(
      (pending) => pending.mechanic?.kind === "oracle"
    )?.pendingId;
    expect(oraclePendingId).toBeDefined();
    const selectOracleAction = getLegalActions({
      state: used,
      actingPlayerId: "alice",
      ...lk,
    })
      .filter((a) => a.kind === "select_pending_to_resolve")
      .find((a) => a.pendingId === oraclePendingId);
    expect(selectOracleAction).toBeDefined();
    const selectedOracle = applyLegalAction({
      state: used,
      action: selectOracleAction!,
      ...lk,
    }).state;
    const oracleAction = getLegalActions({
      state: selectedOracle,
      actingPlayerId: "alice",
      ...lk,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === oraclePendingId
    );
    const afterOracle =
      oracleAction !== undefined
        ? applyLegalAction({
            state: selectedOracle,
            action: oracleAction,
            skipOptionalEffect: true,
            ...lk,
          }).state
        : (() => {
            const passActor = selectedOracle.stackWindow?.priorityPlayerId;
            expect(passActor).toBeDefined();
            const passAction = getLegalActions({
              state: selectedOracle,
              actingPlayerId: passActor!,
              ...lk,
            }).find((a) => a.kind === "pass_stack");
            expect(passAction).toBeDefined();
            return applyLegalAction({
              state: selectedOracle,
              action: passAction!,
              ...lk,
            }).state;
          })();
    expect(afterOracle.pendingLeaveEntities).toHaveLength(1);
    expect(
      afterOracle.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("field");
    expect(
      afterOracle.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("in_use");

    const final = drive(afterOracle, defs);
    expect(final.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-accel")?.zone
    ).toBe("set_aside");
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });

  it("チェンジ使用コストを既存スピリットの最後のコアで支払い消滅させると「消滅したとき」誘発が発火する", () => {
    const defChange: CardDefinition = {
      cardNo: "CHANGE",
      name: "Change",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      changeData: {
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
        swapCondition: { tribes: ["none"] },
      },
    };
    const defB = makeSpirit("B", [
      {
        timing: { kind: "card_event", event: "vanish" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defChange, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defChange, {
          instanceId: "hand-change",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const used = useChangeCardAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-change",
      changeData: defChange.changeData!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lk.getRegisteredBurstActions,
    }).state;
    const final = drive(used, defs);

    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });

  it("direct チェンジ使用は誘発なしでもコスト支払い消滅を flush する", () => {
    const defChange: CardDefinition = {
      cardNo: "CHANGE-DIRECT-NO-LISTENER",
      name: "Change Direct No Listener",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      changeData: {
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
        swapCondition: { tribes: ["none"] },
      },
    };
    const defB = makeSpirit("B");
    const defs = [defChange, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defChange, {
          instanceId: "hand-change",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });

    const used = useChangeCardAsAction({
      state: { ...base, step: "main", activePlayerId: "alice" },
      actingPlayerId: "alice",
      cardInstanceId: "hand-change",
      changeData: defChange.changeData!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lk.getRegisteredBurstActions,
    }).state;

    expect(used.pendingLeaveEntities).toHaveLength(0);
    expect(
      used.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      used.cardInstances.find((c) => c.instanceId === "hand-change")?.zone
    ).toBe("trash");
  });

  it("direct チェンジ効果の core split continuation が閉じるまで cleanup を遅延する", () => {
    const defChange: CardDefinition = {
      cardNo: "CHANGE-SPLIT",
      name: "Change Split",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      changeData: {
        cost: 0,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                action: {
                  kind: "core_move",
                  from: { kind: "void", player: "self" },
                  amount: 1,
                  splitDestinations: {
                    destinations: [
                      { location: { kind: "reserve", player: "self" } },
                      { location: { kind: "trash", player: "self" } },
                    ],
                  },
                },
              },
            ],
          },
        ],
        swapCondition: { tribes: ["none"] },
      },
    };
    const defs = [defChange];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 3,
      cardInstances: [
        createCardInstance(defChange, {
          instanceId: "hand-change",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const used = useChangeCardAsAction({
      state: { ...base, step: "main", activePlayerId: "alice" },
      actingPlayerId: "alice",
      cardInstanceId: "hand-change",
      changeData: defChange.changeData!,
      paymentSources: [],
      getCardDefinitionById: lk.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lk.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: lk.getRegisteredBurstActions,
    }).state;

    expect(used.pendingCoreSplitSelection).not.toBeNull();
    expect(used.pendingAccelCleanups).toEqual([
      expect.objectContaining({
        kind: "change",
        cardInstanceId: "hand-change",
        outcome: "choice",
      }),
    ]);
    expect(
      used.cardInstances.find((c) => c.instanceId === "hand-change")?.zone
    ).toBe("in_use");

    const splitAction = getLegalActions({
      state: used,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "resolve_pending_core_split");
    expect(splitAction).toBeDefined();

    const resolved = applyLegalAction({
      state: used,
      action: splitAction!,
      coreSplitDistribution: [1, 0],
      ...lk,
    }).state;

    expect(resolved.pendingCoreSplitSelection).toBeNull();
    expect(resolved.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "hand-change")?.zone
    ).toBe("trash");
  });

  it("applyLegalAction 経由のチェンジ stack 経路でもコスト支払い消滅誘発が発火する", () => {
    const defChange: CardDefinition = {
      cardNo: "CHANGE",
      name: "Change",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      changeData: {
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
        swapCondition: { tribes: ["none"] },
      },
    };
    const defB = makeSpirit("B", [
      {
        timing: { kind: "card_event", event: "vanish" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defChange, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defChange, {
          instanceId: "hand-change",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "use_change");
    expect(action).toBeDefined();

    const applied = applyLegalAction({
      state,
      action: action!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;
    expect(applied.stackWindow?.pendingStackAction?.actionKind).toBe("change");

    const final = drive(applied, defs);
    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });

  it("applyLegalAction 経由のチェンジ stack 通常解決は誘発なしでもコスト支払い消滅を flush する", () => {
    const defChange: CardDefinition = {
      cardNo: "CHANGE-NO-LISTENER",
      name: "Change No Listener",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      changeData: {
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
        swapCondition: { tribes: ["none"] },
      },
    };
    const defB = makeSpirit("B");
    const defs = [defChange, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defChange, {
          instanceId: "hand-change",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "use_change");
    expect(action).toBeDefined();

    const applied = applyLegalAction({
      state,
      action: action!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;
    expect(applied.stackWindow?.pendingStackAction?.actionKind).toBe("change");

    const final = drive(applied, defs);
    expect(final.pendingLeaveEntities).toHaveLength(0);
    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-change")?.zone
    ).toBe("trash");
  });

  it("無効化されたチェンジ stack でもコスト支払い消滅を flush して誘発を解決する", () => {
    const defChange: CardDefinition = {
      cardNo: "CHANGE-NULL",
      name: "Change Nullified",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      changeData: {
        cost: 1,
        reduction: [],
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
        swapCondition: { tribes: ["none"] },
      },
    };
    const defB = makeSpirit("B", [
      {
        timing: { kind: "card_event", event: "vanish" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ]);
    const defs = [defChange, defB];
    const lk = lookups(defs);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(defChange, {
          instanceId: "hand-change",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(defB, {
          instanceId: "field-B",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ deckCount: 5 }],
    });
    const state: GameState = { ...base, step: "main", activePlayerId: "alice" };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lk,
    }).find((a) => a.kind === "use_change");
    expect(action).toBeDefined();

    const applied = applyLegalAction({
      state,
      action: action!,
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      ...lk,
    }).state;
    const pendingStack = applied.stackWindow?.pendingStackAction;
    expect(pendingStack?.actionKind).toBe("change");
    const nullified: GameState = {
      ...applied,
      stackWindow: {
        ...applied.stackWindow!,
        pendingStackAction: { ...pendingStack!, isNullified: true },
      },
    };

    const passStack = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({
          state: nullified,
          actingPlayerId,
          ...lk,
        })
      )
      .find((a) => a.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterStack = applyLegalAction({
      state: nullified,
      action: passStack!,
      ...lk,
    }).state;
    expect(afterStack.pendingAccelCleanups).toEqual([
      expect.objectContaining({
        kind: "change",
        cardInstanceId: "hand-change",
        outcome: "trash",
      }),
    ]);
    expect(
      afterStack.cardInstances.find((c) => c.instanceId === "hand-change")?.zone
    ).toBe("in_use");
    const final = drive(afterStack, defs);

    expect(final.pendingLeaveEntities).toHaveLength(0);
    expect(final.pendingAccelCleanups ?? []).toHaveLength(0);
    expect(
      final.cardInstances.find((c) => c.instanceId === "field-B")?.zone
    ).toBe("trash");
    expect(
      final.cardInstances.find((c) => c.instanceId === "hand-change")?.zone
    ).toBe("trash");
    expect(final.players.find((p) => p.id === "alice")?.countValue).toBe(1);
  });
});
