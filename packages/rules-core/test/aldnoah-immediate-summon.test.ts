import { describe, expect, it } from "vitest";
import { BSAZ02_CARDS } from "../../card-data/src/cards/BSAZ02";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  moveCardZone,
  playSummonAsAction,
  type CardDefinition,
  type GameState,
} from "../src";
import {
  pruneIllegalPendingTriggeredEffects,
  queuePendingReactionsFromTriggerEvents,
} from "../src/effect/trigger-system";

const definitions = new Map(BSAZ02_CARDS.map((card) => [card.cardNo, card]));
const deps = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(BSAZ02_CARDS),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};

function fixture(mode: "hand" | "field" | "domain" | "none") {
  const instance = (
    cardNo: string,
    instanceId: string,
    zone: "hand" | "field" | "trash" | "deck",
    normalCoreCount = 0
  ) =>
    createCardInstance(definitions.get(cardNo)!, {
      instanceId,
      ownerPlayerId: "alice",
      zone,
      normalCoreCount,
    });
  let state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      instance("BSAZ02-C03", "siren", "hand"),
      instance("BSAZ02-M01", "deck-top", "deck"),
      ...(mode === "none"
        ? []
        : [
            instance(
              "BSAZ02-C10",
              "drive",
              mode === "domain" ? "trash" : mode,
              mode === "field" ? 1 : 0
            ),
          ]),
      ...(mode === "domain"
        ? [instance("BSAZ02-X04", "domain", "field", 1)]
        : []),
    ],
    playerOverrides: [
      { reserveNormalCoreCount: 8, voidNormalCoreCount: 10, deckCount: 1 },
      {},
    ],
  });
  state = { ...state, step: "main", activePlayerId: "alice" };
  return playSummonAsAction({
    state,
    actingPlayerId: "alice",
    cardInstanceId: "siren",
    ...deps,
    paymentSources: [{ kind: "reserve", amount: mode === "field" ? 3 : 4 }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
  }).state;
}

function actions(state: GameState) {
  return getLegalActions({
    state,
    actingPlayerId: state.stackWindow?.priorityPlayerId ?? "alice",
    ...deps,
  });
}

function advance(state: GameState, skip = false) {
  const legal = actions(state);
  const action =
    legal.find((a) => a.kind === "pass_stack") ??
    legal.find((a) => a.kind === "declare_private_triggered_effect") ??
    legal.find((a) => a.kind === "select_pending_to_resolve") ??
    legal.find(
      (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
    );
  expect(
    action,
    JSON.stringify({ legal, log: state.log.slice(-10) })
  ).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    ...deps,
    ...(skip ? { skipOptionalEffect: true } : {}),
  }).state;
}

describe("ただちに下置き後の召喚時条件", () => {
  it.each(["hand", "field", "domain"] as const)(
    "%s: 下置きを先に解決し、C03召喚時でさらにコア1個を置ける",
    (mode) => {
      let state = fixture(mode);
      expect(actions(state).some((a) => a.sourceCardNo === "BSAZ02-C03")).toBe(
        false
      );
      for (let guard = 0; guard < 15; guard++) {
        if (actions(state).some((a) => a.sourceInstanceId === "siren")) break;
        state = advance(state);
      }
      const siren = state.cardInstances.find((c) => c.instanceId === "siren")!;
      expect(siren.underCards).toHaveLength(1);
      expect(actions(state).some((a) => a.sourceInstanceId === "siren")).toBe(
        true
      );
      const before = siren.normalCoreCount;
      state = advance(state);
      while (state.stackWindow) state = advance(state);
      expect(
        state.cardInstances.find((c) => c.instanceId === "siren")!
          .normalCoreCount
      ).toBe(before + 1);
    }
  );

  it.each(["hand", "field", "domain"] as const)(
    "%s: ただちに下置きを辞退したら未達の召喚時を除去する",
    (mode) => {
      let state = fixture(mode);
      const legal = actions(state);
      if (mode === "hand") {
        const skip = legal.find(
          (a) => a.kind === "skip_private_triggered_effect"
        );
        expect(skip).toBeDefined();
        state = applyLegalAction({ state, action: skip!, ...deps }).state;
      } else {
        state = advance(state, true);
      }
      expect(actions(state).some((a) => a.sourceInstanceId === "siren")).toBe(
        false
      );
      expect(state.pendingTriggeredEffects.some((p) => !p.mechanic)).toBe(
        false
      );
      expect(
        state.cardInstances.find((c) => c.instanceId === "siren")!.underCards
      ).toHaveLength(0);
    }
  );

  it("先行するただちに効果がなければ、下カードのない召喚時を残さない", () => {
    const state = fixture("none");
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(state.pendingPrivateDeclarations).toHaveLength(0);
    expect(
      state.cardInstances.find((c) => c.instanceId === "siren")!.normalCoreCount
    ).toBe(1);
  });

  it.each(["hand", "field", "domain"] as const)(
    "%s: ただちにの発揮元が離れたら、未達の召喚時も同じ除去処理で消す",
    (mode) => {
      const before = moveCardZone(
        fixture(mode),
        mode === "domain" ? "domain" : "drive",
        "trash"
      );
      const after = pruneIllegalPendingTriggeredEffects({
        state: before,
        ...deps,
      });
      expect(after.pendingPrivateDeclarations).toHaveLength(0);
      expect(after.pendingTriggeredEffects).toHaveLength(0);
      expect(
        actions(after).some(
          (action) => action.kind === "resolve_pending_triggered_effect"
        )
      ).toBe(false);
      expect(
        after.cardInstances.find((card) => card.instanceId === "siren")
          ?.normalCoreCount
      ).toBe(1);
    }
  );

  it("内側の通常誘発が条件を失ったら、外側の未達召喚時も同じ除去処理で消す", () => {
    const anchor: CardDefinition = {
      cardNo: "TEST-ANCHOR",
      name: "anchor",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      symbolColors: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const inner: CardDefinition = {
      ...anchor,
      cardNo: "TEST-INNER",
      name: "inner",
      effects: [
        {
          timing: {
            kind: "game_event",
            event: "increase_hand",
            player: "self",
          },
          executionMode: "optional",
          condition: [
            {
              kind: "field_has",
              player: "self",
              cardNames: [{ exact: "anchor" }],
            },
          ],
          steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
        },
      ],
    };
    const nestedDefinitions = [...BSAZ02_CARDS, anchor, inner];
    const nestedDeps = {
      ...deps,
      getCardDefinitionById: (id: string) =>
        nestedDefinitions.find((card) => card.cardNo === id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(nestedDefinitions),
    };
    let state = fixture("hand");
    const outer = state.pendingTriggeredEffects.find(
      (pending) => pending.triggerPriority === "normal"
    )!;
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        ...[anchor, inner].map((definition) =>
          createCardInstance(definition, {
            instanceId: definition.name,
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          })
        ),
      ],
    };
    state = queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          eventKind: "increase_hand",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: `${outer.chainId}:nested`,
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
        },
      ],
      "inner-group",
      nestedDeps
    );
    expect(state.pendingTriggeredEffects).toHaveLength(2);
    // 即時処理後に内側の通常誘発だけが残る境界を作る。
    state = {
      ...moveCardZone(state, "anchor", "trash"),
      pendingPrivateDeclarations: [],
    };
    const after = pruneIllegalPendingTriggeredEffects({ state, ...nestedDeps });
    expect(after.pendingTriggeredEffects).toHaveLength(0);
    expect(
      getLegalActions({
        state: after,
        actingPlayerId: "alice",
        ...nestedDeps,
      }).some((action) => action.kind === "resolve_pending_triggered_effect")
    ).toBe(false);
    expect(
      pruneIllegalPendingTriggeredEffects({ state: after, ...nestedDeps })
    ).toBe(after);
  });
});
