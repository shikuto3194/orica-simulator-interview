import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  createCardInstance,
  createEmptyGameState,
  sanitizeStateForViewer,
  type PublicDisclosure,
} from "@orica/rules-core";
import {
  isPublicDisclosureCardPresentationEligible,
  publicDisclosurePresentationCards,
} from "../src/components/PublicDisclosurePanel";

const definition = ALL_CARDS.find((card) => card.cardNo === "BSSA01-C02")!;
const getDefinition = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id);

function disclosureState(
  actor: string,
  audience: PublicDisclosure["audience"],
  kind: "zone_moved" | "deck_revealed" | "target_declared"
) {
  const card = createCardInstance(definition, {
    instanceId: "viewer-card",
    ownerPlayerId: actor,
    zone: kind === "target_declared" ? "field" : "hand",
    cores: 1,
  });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [card],
  });
  const disclosure: PublicDisclosure = {
    id: "viewer-disclosure",
    sequence: 1,
    turnNumber: 1,
    step: "main",
    actorPlayerId: actor,
    audience,
    kind,
    targets:
      kind === "zone_moved"
        ? []
        : [
            {
              kind: "card",
              instanceId: card.instanceId,
              definitionIdSnapshot: definition.cardNo,
              actionLabel: kind === "target_declared" ? "destroy" : "reveal",
            },
          ],
    results:
      kind === "zone_moved"
        ? [
            {
              kind: "card_move",
              instanceId: card.instanceId,
              definitionIdSnapshot: definition.cardNo,
              from: "revealed",
              to: "hand",
              actionLabel: "add_to_hand",
            },
          ]
        : [],
  };
  return { ...state, publicDisclosures: [disclosure] };
}

describe.each(["alice", "bob"])("%s の通知と盤面演出の公開範囲", (actor) => {
  it.each(["both", "actor_only", "opponent_only"] as const)(
    "%s の移動は両者へ通知し、閲覧権のない側は裏面にする",
    (audience) => {
      const raw = disclosureState(actor, audience, "zone_moved");
      for (const viewer of ["alice", "bob"]) {
        const state = sanitizeStateForViewer(raw, viewer);
        const [entry] = state.publicDisclosures;
        expect(state.publicDisclosures).toHaveLength(1);
        expect(isPublicDisclosureCardPresentationEligible(entry!)).toBe(true);
        const canSee =
          audience === "both" ||
          (audience === "actor_only" ? viewer === actor : viewer !== actor);
        const lookup = (id: string) => {
          expect(canSee, "匿名通知はカード定義を参照しない").toBe(true);
          return getDefinition(id);
        };
        expect(
          publicDisclosurePresentationCards(entry!, state, lookup)
        ).toMatchObject([
          {
            definitionIdSnapshot: canSee ? definition.cardNo : "_hidden_card_",
            actionLabel: "手札へ",
          },
        ]);
        if (!canSee) {
          expect(JSON.stringify(entry)).not.toContain(definition.cardNo);
          expect(JSON.stringify(entry)).not.toContain("viewer-card");
        }
        if (viewer !== actor) {
          expect(state.cardInstances[0]!.definitionId).toBe("_hidden_card_");
          expect(entry!.results[0]).not.toHaveProperty("instanceId");
        }
      }
    }
  );

  it.each(["actor_only", "opponent_only"] as const)(
    "%s の閲覧だけの通知は許可された側だけに表示する",
    (audience) => {
      const raw = disclosureState(actor, audience, "deck_revealed");
      for (const viewer of ["alice", "bob"]) {
        const state = sanitizeStateForViewer(raw, viewer);
        const canSee =
          audience === "actor_only" ? viewer === actor : viewer !== actor;
        expect(state.publicDisclosures).toHaveLength(canSee ? 1 : 0);
        if (!canSee) continue;
        expect(
          isPublicDisclosureCardPresentationEligible(
            state.publicDisclosures[0]!
          )
        ).toBe(true);
        expect(
          publicDisclosurePresentationCards(
            state.publicDisclosures[0]!,
            state,
            getDefinition
          )
        ).toMatchObject([{ definitionIdSnapshot: definition.cardNo }]);
      }
    }
  );

  it.each(["both", "actor_only", "opponent_only"] as const)(
    "%s のフィールド対象はマスク済みの対象だけを演出に渡す",
    (audience) => {
      const raw = disclosureState(actor, audience, "target_declared");
      for (const viewer of ["alice", "bob"]) {
        const state = sanitizeStateForViewer(raw, viewer);
        const canSee =
          audience === "both" ||
          (audience === "actor_only" ? viewer === actor : viewer !== actor);
        expect(state.publicDisclosures).toHaveLength(canSee ? 1 : 0);
        if (!canSee) continue;
        expect(state.publicDisclosures[0]!.targets).toMatchObject([
          { instanceId: "viewer-card", actionLabel: "destroy" },
        ]);
        // 場の対象は盤面演出を使い、カード画像通知を重ねない。
        expect(
          publicDisclosurePresentationCards(
            state.publicDisclosures[0]!,
            state,
            getDefinition
          )
        ).toEqual([]);
      }
    }
  );
});
