import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getEffectiveBp,
  getLegalActions,
  isCardUseRestricted,
  rebuildContinuousEffectsFromField,
  refreshExhaustStates,
  synthesizeBackFaceDefinition,
  type CardDefinition,
  type Effect,
  type GameState,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  getAvailableTriggeredEffectSourceChoices,
  queuePendingReactionsFromTriggerEvents,
} from "../src/effect/trigger-system";

const defs = new Map<string, CardDefinition>(
  ALL_CARDS.map((d) => [d.cardNo, d])
);
for (const d of ALL_CARDS)
  if (d.backFace) {
    const b = synthesizeBackFaceDefinition(d, d.backFace);
    defs.set(b.cardNo, b);
  }
const plain: CardDefinition = {
  ...defs.get("BSTH08.5-X01")!,
  cardNo: "AUDIT-SPIRIT",
  name: "監査用スピリット",
  cost: 7,
  reductionSymbols: [],
  effects: [],
  keywordTags: [],
};
defs.set(plain.cardNo, plain);
defs.set("AUDIT-ULTIMATE", {
  ...plain,
  cardNo: "AUDIT-ULTIMATE",
  printedCategory: "ultimate",
});
const getDef = (id: string) => defs.get(id);
function card(
  no: string,
  id: string,
  owner = "alice",
  zone: "field" | "hand" | "set_aside" = "field"
) {
  return createCardInstance(defs.get(no)!, {
    instanceId: id,
    ownerPlayerId: owner,
    controllerPlayerId: owner,
    zone,
    normalCoreCount: zone === "field" ? 4 : 0,
  });
}
function board(cards: GameState["cardInstances"]): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
      playerOverrides: [
        { reserveNormalCoreCount: 20 },
        { reserveNormalCoreCount: 20 },
      ],
    }),
    activePlayerId: "alice",
    step: "attack",
    turnNumber: 3,
  };
}
function run(
  state: GameState,
  effect: Effect,
  source = "source",
  targetInstanceIds?: string[]
) {
  return executeEffect({
    chainId: "test:touhou-late-fidelity-audit:84",
    state,
    effect,
    sourceInstanceId: source,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    firingBattleEndDeferral: true,
    ...(targetInstanceIds ? { targetInstanceIds } : {}),
  });
}
const find = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)!;

describe("東方後半 原文忠実度の盤面回帰", () => {
  it("BSTH004-X03: 同一カードの転醒だけを抑止し、離脱ドローとカウント0回復を処理する", () => {
    const baseNexus = defs.get("BSTH005-TX01(A)")!;
    const draw: Effect = {
      timing: {
        kind: "card_event",
        event: "leave_field",
        cause: "opponent_effect",
      },
      executionMode: "mandatory",
      steps: [{ action: { kind: "draw", count: 1 } }],
    };
    const nexusDef = {
      ...baseNexus,
      cardNo: "AUDIT-REBIRTH-NEXUS",
      effects: [baseNexus.effects![1]!, draw],
    };
    defs.set(nexusDef.cardNo, nexusDef);
    const source = {
      ...card("BSTH004-X03", "source"),
      exhaustState: "exhausted" as const,
    };
    const deck = {
      ...card("AUDIT-SPIRIT", "deck", "bob"),
      zone: "deck" as const,
      normalCoreCount: 0,
    };
    const before = board([source, card(nexusDef.cardNo, "nexus", "bob"), deck]);
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        nexusDef,
      ]),
      getRegisteredMagicActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    };
    const event = {
      eventKind: "destroy" as const,
      actingPlayerId: "bob",
      relatedPlayerId: "bob",
      relatedInstanceId: "nexus",
      amount: null,
      source: "action_resolution" as const,
      chainId: "audit-destroy",
      attackId: null,
      cause: "opponent_effect" as const,
    };
    const baseline = queuePendingReactionsFromTriggerEvents(
      before,
      [event],
      undefined,
      lookups
    );
    expect(
      baseline.pendingTriggeredEffects
        .flatMap((pendingEffect) =>
          getAvailableTriggeredEffectSourceChoices({
            state: baseline,
            pendingEffect,
            ...lookups,
          })
        )
        .map((c) => c.actionRegistration.effectIndex)
    ).toEqual(expect.arrayContaining([0, 1]));
    let state = executeEffect({
      chainId: "test:touhou-late-fidelity-audit:162",
      state: before,
      effect: getDef(source.definitionId)!.effects![1]!,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      targetInstanceIds: ["nexus"],
      deferCurrentEffectCleanup: true,
      firingBattleEndDeferral: true,
      ...lookups,
    });
    expect(find(state, "source").exhaustState).toBe("recovered");
    expect(
      find(state, "nexus").pendingLeaveKind === "destroy" ||
        find(state, "nexus").zone === "trash"
    ).toBe(true);
    state = queuePendingReactionsFromTriggerEvents(
      state,
      [event],
      undefined,
      lookups
    );
    const sources = state.pendingTriggeredEffects.flatMap((pendingEffect) =>
      getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect,
        ...lookups,
      })
    );
    expect(sources.map((c) => c.actionRegistration.effectIndex)).toEqual([1]);
    // 効果区間終了後も、既に抑止した転醒を残存ドローのpendingへ復活させない。
    state = { ...state, activeContinuousEffects: [] };
    expect(
      state.pendingTriggeredEffects
        .flatMap((pendingEffect) =>
          getAvailableTriggeredEffectSourceChoices({
            state,
            pendingEffect,
            ...lookups,
          })
        )
        .map((c) => c.actionRegistration.effectIndex)
    ).toEqual([1]);
    for (let i = 0; i < 8 && find(state, "deck").zone !== "hand"; i++) {
      const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...lookups })
      );
      const next =
        actions.find((a) => a.kind === "pass_stack") ??
        actions.find((a) => a.kind === "select_pending_to_resolve") ??
        actions.find((a) => a.kind === "resolve_pending_triggered_effect");
      expect(next, JSON.stringify(actions)).toBeDefined();
      state = applyLegalAction({ state, action: next!, ...lookups }).state;
    }
    expect(find(state, "deck").zone).toBe("hand");
    expect(find(state, "nexus").definitionId).toBe(nexusDef.cardNo);
  });

  it("BSTH08.5-X01: 自身のブレイヴすべてを分離コア不要で破棄し、別ホストのブレイヴは残す", () => {
    const source = {
      ...card("BSTH08.5-X01", "source"),
      attachedChildrenIds: ["old1", "old2"],
      exhaustState: "exhausted" as const,
    };
    const other = {
      ...card("AUDIT-SPIRIT", "other"),
      attachedChildrenIds: ["other-brave"],
    };
    const brave = (id: string, host: string) => ({
      ...card("BSTH08.5-C24", id),
      normalCoreCount: 0,
      attachedToInstanceId: host,
    });
    let state = board([
      source,
      other,
      brave("other-brave", "other"),
      brave("old1", "source"),
      brave("old2", "source"),
    ]);
    state.players = state.players.map((p) => ({
      ...p,
      reserveNormalCoreCount: 0,
    }));
    state = run(state, getDef(source.definitionId)!.effects![2]!);
    expect(state.pendingStepOptionalChoice).not.toBeNull();
    const decline = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "decline"
    );
    expect(decline).toBeDefined();
    state = applyLegalAction({
      state,
      action: decline!,
      getCardDefinitionById: getDef,
    }).state;
    state = flushPendingLeaves(state, getDef);
    expect([find(state, "old1").zone, find(state, "old2").zone]).toEqual([
      "trash",
      "trash",
    ]);
    expect(find(state, "other-brave").attachedToInstanceId).toBe("other");
    expect(find(state, "source").attachedChildrenIds).toEqual([]);
    expect(find(state, "source").exhaustState).toBe("exhausted");
  });

  it.each(["BSTH08.5-X01", "BSTH08.5-X02"])(
    "%s: 合体元の選択が成功しても合体条件を満たさなければ回復しない",
    (no) => {
      const source = {
        ...card(no, "source"),
        exhaustState: "exhausted" as const,
      };
      const incompatible = {
        ...defs.get("BSTH08.5-C23")!,
        cardNo: "AUDIT-BRAVE",
        braveCondition: { minCost: 99 },
      };
      defs.set(incompatible.cardNo, incompatible);
      const state = run(
        board([
          source,
          card(incompatible.cardNo, "candidate", "alice", "set_aside"),
        ]),
        getDef(no)!.effects![no.endsWith("X01") ? 2 : 1]!
      );
      expect(find(state, "candidate").zone).toBe("set_aside");
      expect(find(state, "source").exhaustState).toBe("exhausted");
    }
  );

  it("BSTH09-M02: 非合体でもBP低下と破壊を実行し、魂状態の後続は実行しない", () => {
    const source = card("BSTH09-M02", "source");
    const victim = card("AUDIT-SPIRIT", "victim", "bob");
    const effect = getDef(source.definitionId)!.effects![2]!;
    expect(getDef(source.definitionId)!.effects).toHaveLength(3);
    expect(effect.steps[2]!.connector).toBe("after_triggers");
    const state = run(board([source, victim]), effect, "source", ["victim"]);
    expect(getEffectiveBp(state, find(state, "victim"), plain, getDef)).toBe(0);
    expect(
      find(state, "victim").pendingLeaveKind === "destroy" ||
        find(state, "victim").zone === "trash"
    ).toBe(true);
    expect(
      state.log.some(
        (s) => s.includes("effect:bounce:") && s.includes("victim")
      )
    ).toBe(false);
  });

  it.each(["AUDIT-SPIRIT", "AUDIT-ULTIMATE"])(
    "BSTH09.2-R01(B): %s の重疲労、リフレッシュ限定禁止、効果回復を区別する",
    (no) => {
      const source = card("BSTH09.2-転醒R01(B)", "source");
      let state = run(
        board([source, card(no, "victim", "bob"), card(no, "other", "bob")]),
        getDef(source.definitionId)!.effects![0]!,
        "source",
        ["victim"]
      );
      expect(find(state, "victim").exhaustState).toBe("heavily_exhausted");
      state = rebuildContinuousEffectsFromField(
        { ...state, activePlayerId: "bob", step: "refresh" },
        getDef
      );
      state = refreshExhaustStates(state, "bob", getDef);
      expect(find(state, "victim").exhaustState).toBe(
        no === "AUDIT-SPIRIT" ? "heavily_exhausted" : "exhausted"
      );
      state = run(
        { ...state, step: "attack" },
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "recover",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {},
                  count: 1,
                },
              },
            },
          ],
        },
        "source",
        ["victim"]
      );
      expect(find(state, "victim").exhaustState).toBe(
        no === "AUDIT-SPIRIT" ? "exhausted" : "recovered"
      );
    }
  );

  it("BSTH08.5-X04: 通常召喚は禁止、効果による召喚は実行できる", () => {
    let state = rebuildContinuousEffectsFromField(
      board([card("BSTH08.5-X04", "source", "alice", "hand")]),
      getDef
    );
    const source = find(state, "source");
    expect(
      isCardUseRestricted(
        state,
        "alice",
        source,
        getDef(source.definitionId)!,
        getDef,
        "summon"
      )
    ).toBe(true);
    state = run(state, {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: { kind: "self" },
            costModifier: "free",
          },
        },
      ],
    });
    expect(find(state, "source").zone).toBe("field");
  });

  it.each(["free", { override: 1 }] as const)(
    "BSTH08.5-C22: 効果召喚の実支払 %j で使用制限を判定する",
    (modifier) => {
      const source = card("AUDIT-SPIRIT", "source", "alice", "hand");
      let state = rebuildContinuousEffectsFromField(
        board([source, card("BSTH08.5-C22", "mask", "alice", "set_aside")]),
        getDef
      );
      state = run(state, {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self", zone: "hand" },
              costModifier: modifier,
            },
          },
        ],
      });
      expect(find(state, "source").zone).toBe(
        modifier === "free" ? "hand" : "field"
      );
    }
  );
});
