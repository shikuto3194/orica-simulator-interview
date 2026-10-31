import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import { readFileSync } from "node:fs";
import {
  type GameState,
  getCurrentActorPlayerIds,
  getLegalActions,
  getGameProgressBlockerReason,
  sanitizeStateForViewer,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
} from "../src/index";

const state = JSON.parse(
  readFileSync(
    new URL("./fixtures/sync-errors/flash-priority.json", import.meta.url),
    "utf8"
  )
) as GameState;
const definitions = [...ALL_CARDS];
const options = {
  getCardDefinitionById: (id: string) =>
    definitions.find((card) => card.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(definitions),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(definitions),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(definitions),
  getRegisteredMagicActions: buildMagicLookup(definitions),
  getRegisteredBurstActions: buildBurstEffectLookup(definitions),
};

describe("reported T4 Bob attack / Alice flash priority", () => {
  it.each([false, true])(
    "does not offer Bob a server-rejected action (sanitized=%s)",
    (sanitized) => {
      const viewedState = sanitized
        ? sanitizeStateForViewer(state, "bob")
        : state;
      const actions = getLegalActions({
        ...options,
        state: viewedState,
        actingPlayerId: "bob",
      });
      expect([...getCurrentActorPlayerIds(viewedState)]).toEqual(["alice"]);
      expect(
        actions.map((action) => ({ kind: action.kind, id: action.actionId }))
      ).toEqual([]);
    }
  );
});

describe("opponent's private declaration still blocks Bob before flash", () => {
  const privateState = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/sync-errors/private-declaration.json",
        import.meta.url
      ),
      "utf8"
    )
  ) as GameState;
  it.each([1, 2])(
    "preserves the authority without revealing the declaration (sanitize passes=%s)",
    (passes) => {
      let viewedState = privateState;
      for (let i = 0; i < passes; i++)
        viewedState = sanitizeStateForViewer(viewedState, "bob");
      expect(viewedState.pendingPrivateDeclarations).toEqual([]);
      const actions = getLegalActions({
        ...options,
        state: viewedState,
        actingPlayerId: "bob",
      });
      expect(actions.map((action) => action.kind)).toEqual([]);
      expect([...getCurrentActorPlayerIds(viewedState)]).toEqual(["alice"]);
      expect(getGameProgressBlockerReason(viewedState)).not.toBeNull();
    }
  );
  it("also blocks step advance when a hidden choice is pending outside battle", () => {
    const main = {
      ...privateState,
      step: "main" as const,
      window: "main" as const,
      activeAttack: null,
      battleEntities: [],
    };
    const viewed = sanitizeStateForViewer(main, "bob");
    expect(getGameProgressBlockerReason(viewed)).not.toBeNull();
  });

  it("keeps Alice's declaration choices available and releases Bob after she declines", () => {
    const viewed = sanitizeStateForViewer(privateState, "alice");
    const fullActions = getLegalActions({
      ...options,
      state: privateState,
      actingPlayerId: "alice",
    });
    const viewerActions = getLegalActions({
      ...options,
      state: viewed,
      actingPlayerId: "alice",
    });
    expect(viewerActions.map((action) => action.actionId)).toEqual(
      fullActions.map((action) => action.actionId)
    );
    expect(
      viewerActions.some(
        (action) => action.kind === "skip_private_triggered_effect"
      )
    ).toBe(true);
    const after = sanitizeStateForViewer(
      { ...privateState, pendingPrivateDeclarations: [] },
      "bob"
    );
    expect(after.pendingPromptLock).toBeNull();
    expect(
      getLegalActions({ ...options, state: after, actingPlayerId: "bob" }).some(
        (action) => action.kind === "open_battle_flash"
      )
    ).toBe(true);
  });
});
