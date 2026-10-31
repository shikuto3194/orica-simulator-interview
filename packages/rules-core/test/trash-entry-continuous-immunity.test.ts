import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { Action, Effect, GameState, Zone } from "../src";
import { resolveCardImmunityAffect } from "../src/effect/effect-affect-adapter";
import { createStepExecutionContext } from "../src/step-execution-context";
import { resolveAmount } from "../src/effect/target-resolution";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getDef = (id: string) => definitions.get(id);
const def = (id: string) => getDef(id)!;
const mirror = def("BSTH04-転醒R01(A)");

function makeState(cardNo = "BSTH04-R01", zone: Zone = "deck") {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      {
        deckCount: zone === "deck" ? 2 : 0,
        handCount: zone === "hand" ? 1 : 0,
      },
      {},
    ],
    cardInstances: [
      createCardInstance(mirror, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      createCardInstance(def(cardNo), {
        instanceId: "immune",
        ownerPlayerId: "alice",
        zone,
      }),
      createCardInstance(def("BSTH04-XX01"), {
        instanceId: "normal",
        ownerPlayerId: "alice",
        zone: "deck",
      }),
    ],
  });
}

function run(state: GameState, steps: Effect["steps"]) {
  return executeEffect({
    chainId: "test:trash-entry-continuous-immunity:51",
    state,
    effect: { timing: { kind: "activated", mode: "main" }, steps },
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  });
}

function chooseRecovery(state: GameState) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_pending_step_optional_choice" &&
      candidate.choice === "execute"
  );
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  }).state;
}

describe("トラッシュ到着直後の常時耐性", () => {
  it("snapshot再現: 浄玻璃の鏡で落ちた咲夜は回収候補に入らず、通常札だけ手札へ戻る", () => {
    const afterMill = executeEffect({
      chainId: "test:trash-entry-continuous-immunity:81",
      state: makeState(),
      effect: mirror.effects![0]!,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(
      afterMill.cardInstances.filter((card) => card.zone === "trash")
    ).toHaveLength(2);
    const after = chooseRecovery(afterMill);
    expect(after.pendingStepOptionalTargetSelection).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === "immune")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((card) => card.instanceId === "normal")?.zone
    ).toBe("hand");
  });

  it("落ちた候補が耐性札だけなら回収を実行できない", () => {
    const base = makeState();
    base.cardInstances = base.cardInstances.filter(
      (card) => card.instanceId !== "normal"
    );
    base.players[0]!.deckCount = 1;
    const after = run(base, mirror.effects![0]!.steps);
    expect(after.pendingStepOptionalChoice?.canExecute).toBe(false);
    expect(after.pendingStepOptionalTargetSelection).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === "immune")?.zone
    ).toBe("trash");
  });

  it.each(["normal", "suppress", "defer"] as const)(
    "%s: 破棄の選択待ちを跨いでも後続の回収を防ぐ",
    (mode) => {
      const base = makeState("BSTH04-R01", "hand");
      const pending = run(base, [
        {
          action: {
            kind: "discard",
            count: { min: 0, max: 1 },
            player: "self",
            ...(mode === "suppress"
              ? { suppressMovedToTrashEffects: true }
              : {}),
            ...(mode === "defer" ? { deferMovedToTrashEffects: true } : {}),
          },
        },
        {
          action: {
            kind: "search_zone",
            zone: "trash",
            count: 1,
            destination: "hand",
            mandatory: true,
          },
        },
      ]);
      expect(pending.pendingZoneSelection).not.toBeNull();
      const action = getLegalActions({
        state: pending,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      }).find(
        (candidate) => candidate.kind === "resolve_pending_zone_selection"
      )!;
      const after = applyLegalAction({
        state: pending,
        action,
        selectedZoneCardIds: ["immune"],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      expect(
        after.cardInstances.find((card) => card.instanceId === "immune")?.zone
      ).toBe("trash");
      expect(after.pendingZoneSelection).toBeNull();
    }
  );

  it.each(["hand", "deck", "set_aside", "removed_from_game", "field"] as const)(
    "到着直後の耐性は %s への回収にも適用する",
    (destination) => {
      const after = run(makeState(), [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player: "self", position: "top" },
            to: { zone: "trash" },
            count: 1,
          },
        },
        {
          action: {
            kind: "search_zone",
            zone: "trash",
            count: 1,
            destination,
            mandatory: true,
          },
        },
      ]);
      expect(
        after.cardInstances.find((card) => card.instanceId === "immune")?.zone
      ).toBe("trash");
    }
  );

  const entries: Array<{ name: string; zone: Zone; action: Action }> = [
    {
      name: "デッキ配置",
      zone: "deck",
      action: {
        kind: "move_card",
        from: { zone: "deck", player: "self", position: "top" },
        to: { zone: "trash" },
        count: 1,
      },
    },
    {
      name: "真のデッキ破棄",
      zone: "deck",
      action: { kind: "discard", fromZone: "deck", count: 1, player: "self" },
    },
    {
      name: "手札破棄",
      zone: "hand",
      action: { kind: "discard", count: 1, player: "self" },
    },
    {
      name: "誘発抑止付き破棄",
      zone: "hand",
      action: {
        kind: "discard",
        count: 1,
        player: "self",
        suppressMovedToTrashEffects: true,
      },
    },
    {
      name: "誘発遅延付き破棄",
      zone: "hand",
      action: {
        kind: "discard",
        count: 1,
        player: "self",
        deferMovedToTrashEffects: true,
      },
    },
    {
      name: "オープン残り札",
      zone: "deck",
      action: {
        kind: "deck_reveal",
        revealCount: 1,
        picks: [],
        remainder: "trash",
      },
    },
  ];
  it.each(entries)(
    "$name → 同じ効果の回収でも耐性を適用する",
    ({ zone, action }) => {
      const after = run(makeState("BSTH04-R01", zone), [
        { action },
        {
          action: {
            kind: "search_zone",
            zone: "trash",
            count: 1,
            destination: "hand",
            mandatory: true,
          },
        },
      ]);
      expect(
        after.cardInstances.find((card) => card.instanceId === "immune")?.zone
      ).toBe("trash");
      expect(after.pendingZoneSelection).toBeNull();
    }
  );

  const immuneCards = [...definitions.values()].filter((card) =>
    card.effects?.some(
      (effect) =>
        effect.timing.kind === "continuous" &&
        JSON.stringify(effect.applicability ?? {}).includes("trash") &&
        effect.steps.some(
          (step) =>
            step.action.kind === "effect_immunity" &&
            step.action.target.kind === "self"
        )
    )
  );
  it("同類カードの走査が既知の8枚以上を網羅する", () => {
    expect(immuneCards.map((card) => card.cardNo)).toContain("BSTH04-R01");
    expect(immuneCards.length).toBeGreaterThanOrEqual(8);
  });
  it.each(immuneCards.map((card) => [card.cardNo, card] as const))(
    "%s: トラッシュ到着時に耐性を登録し、参照・枚数集計は許可する",
    (_cardNo, card) => {
      const after = run(makeState(card.cardNo), [
        { action: entries[0]!.action },
      ]);
      const target = after.cardInstances.find(
        (instance) => instance.instanceId === "immune"
      )!;
      expect(target.zone).toBe("trash");
      const immunity = card
        .effects!.flatMap((effect) => effect.steps)
        .map((step) => step.action)
        .find(
          (action) =>
            action.kind === "effect_immunity" && action.target.kind === "self"
        )!;
      if (immunity.kind !== "effect_immunity")
        throw new Error("missing immunity");
      for (const actor of ["alice", "bob"]) {
        const scope = immunity.sourcePlayerScope ?? "opponent";
        const blocked =
          scope === "any" ||
          (scope === "self" ? actor === "alice" : actor === "bob");
        expect(
          resolveCardImmunityAffect(
            after,
            target,
            actor,
            "none",
            undefined,
            getDef
          ).kind,
          actor
        ).toBe(blocked ? "blocked" : "allowed");
      }
      expect(
        resolveAmount(
          { source: { kind: "cards_in_zone", zone: "trash", player: "self" } },
          after,
          "alice",
          createStepExecutionContext(after),
          getDef
        )
      ).toBe(1);
    }
  );
});
