import { describe, expect, it } from "vitest";
import { BSAZ02_CARDS } from "../../../packages/card-data/src/cards/BSAZ02";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  playSummonAsAction,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { buildEffectQueue } from "../src/components/EffectQueueOverlay";

const getDefinition = (id: string) => BSAZ02_CARDS.find((c) => c.cardNo === id);
const registrations = buildTriggeredEffectLookup(BSAZ02_CARDS);
const deps = {
  getCardDefinitionById: getDefinition,
  getRegisteredTriggeredEffectActions: registrations,
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};

function fixture(zone: "hand" | "field") {
  const make = (
    no: string,
    id: string,
    location: "hand" | "field" | "deck",
    cores = 0
  ) =>
    createCardInstance(getDefinition(no)!, {
      instanceId: id,
      ownerPlayerId: "alice",
      zone: location,
      normalCoreCount: cores,
    });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        make("BSAZ02-C03", "siren", "hand"),
        make("BSAZ02-X04", "domain", "field", 2),
        ...[0, 1, 2].map((n) => make("BSAZ02-C10", `drive-${n}`, zone)),
        make("BSAZ02-C01", "deck-top", "deck"),
      ],
      playerOverrides: [
        {
          reserveNormalCoreCount: 8,
          reserveSoulCoreCount: 0,
          voidNormalCoreCount: 10,
          deckCount: 1,
        },
        {},
      ],
    }),
    step: "main",
    activePlayerId: "alice",
    turnNumber: 5,
  };
  return playSummonAsAction({
    state,
    ...deps,
    actingPlayerId: "alice",
    cardInstanceId: "siren",
    paymentSources: [{ kind: "reserve", amount: zone === "hand" ? 4 : 3 }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
  }).state;
}

function actions(state: GameState) {
  return getLegalActions({
    state,
    ...deps,
    actingPlayerId: state.stackWindow?.priorityPlayerId ?? "alice",
  });
}
function queue(state: GameState) {
  return buildEffectQueue(
    state,
    getDefinition,
    registrations,
    "alice",
    actions(state)
  );
}
function apply(state: GameState, action: LegalAction, skip = false) {
  return applyLegalAction({
    state,
    action,
    ...deps,
    skipOptionalEffect: skip,
    ...(action.kind === "resolve_pending_core_distribution"
      ? { coreDistributionAllocations: { siren: 1 } }
      : {}),
  }).state;
}

describe("シレーン召喚時のキューと発揮元", () => {
  it.each(["hand", "field"] as const)(
    "%s のドライブ3枚はそれぞれの画像・本文で表示し、未達のシレーンを表示しない",
    (zone) => {
      const state = fixture(zone);
      const items = queue(state);
      const drives = items.filter((item) =>
        (item.sourceRef.type === "privateDeclaration"
          ? item.sourceRef.data.sourceInstanceId
          : item.sourceInstanceId
        )?.startsWith("drive-")
      );
      expect(drives).toHaveLength(3);
      for (const item of drives) {
        expect(item.cardName).toBe("アルドノアドライブ");
        expect(item.imagePath).toBe("/images/BSAZ02-C10.webp");
        expect(item.effectText).toContain("ただちにそのカードの下に置ける");
      }
      expect(
        items.filter((item) => item.definitionId === "BSAZ02-C03")
      ).toHaveLength(0);
      expect(
        items.find(
          (item) =>
            item.sourceRef.type === "triggered" &&
            item.sourceRef.data.mechanic?.kind === "oracle"
        )?.definitionId
      ).toBe("BSAZ02-X04");
      expect(
        actions(state).every(
          (a) => a.sourceInstanceId !== "siren" && a.eventKind !== "oracle"
        )
      ).toBe(true);
    }
  );

  it.each(["hand", "field"] as const)(
    "%s: 先行下置き完了後に神託とシレーン1件を選び、コアをそれぞれ1個だけ増やす",
    (zone) => {
      let state = fixture(zone);
      for (let guard = 0; guard < 30; guard++) {
        const legal = actions(state);
        if (legal.some((a) => a.sourceInstanceId === "siren")) break;
        const next =
          legal.find((a) => a.kind === "pass_stack") ??
          legal.find((a) => a.kind === "resolve_pending_core_distribution") ??
          legal.find(
            (a) =>
              a.kind === "declare_private_triggered_effect" &&
              a.sourceInstanceId === "drive-0"
          ) ??
          legal.find(
            (a) =>
              a.kind === "resolve_pending_triggered_effect" &&
              a.sourceInstanceId === "drive-0" &&
              !a.skipOnly
          ) ??
          legal.find(
            (a) =>
              a.kind === "select_pending_to_resolve" &&
              a.sourceInstanceId === "drive-0"
          ) ??
          legal.find((a) => a.kind === "skip_private_triggered_effect") ??
          legal.find((a) => a.kind === "resolve_pending_triggered_effect") ??
          legal.find((a) => a.kind === "select_pending_to_resolve");
        expect(next, JSON.stringify(legal)).toBeDefined();
        state = apply(state, next!, next!.sourceInstanceId !== "drive-0");
        for (const item of queue(state)) {
          if (
            item.sourceRef.type === "triggered" &&
            item.sourceRef.data.declaredFromPrivateZone
          ) {
            expect(item.cardName).toBe("アルドノアドライブ");
            expect(item.effectText).toContain("ただちにそのカードの下に置ける");
            expect(item.timingLabel).toBe("召喚されたとき");
          }
        }
      }
      expect(
        state.cardInstances.find((c) => c.instanceId === "siren")!.underCards
      ).toHaveLength(1);
      expect(
        queue(state).filter((item) => item.definitionId === "BSAZ02-C03")
      ).toHaveLength(1);
      expect(actions(state).some((a) => a.eventKind === "oracle")).toBe(true);
      for (const source of ["siren", "domain"]) {
        const before = state.cardInstances.find(
          (c) => c.instanceId === source
        )!.normalCoreCount;
        const select = actions(state).find(
          (a) =>
            a.sourceInstanceId === source &&
            (source !== "domain" || a.eventKind === "oracle")
        )!;
        expect(select).toBeDefined();
        state = apply(state, select);
        if (select.kind === "select_pending_to_resolve") {
          const resolve = actions(state).find(
            (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
          );
          if (resolve) state = apply(state, resolve);
        }
        while (state.stackWindow)
          state = apply(
            state,
            actions(state).find((a) => a.kind === "pass_stack")!
          );
        expect(
          state.cardInstances.find((c) => c.instanceId === source)!
            .normalCoreCount
        ).toBe(before + 1);
      }
      expect(queue(state)).toHaveLength(0);
    }
  );
});
