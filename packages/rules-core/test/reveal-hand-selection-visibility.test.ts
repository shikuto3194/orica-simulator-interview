import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  sanitizeStateForViewer,
} from "../src";
import type { Effect, GameState } from "../src";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookup = (id: string) => definitions.find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: () => [],
};

function revealSelection(cardNo = "BSTH10-C02"): GameState {
  const targetNo =
    cardNo === "BSTH10-C01"
      ? "BSTH10-C02"
      : cardNo === "BSKB01-TX01(B)"
        ? "BSTH10-C03"
        : "BSTH10-R01";
  const state = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(lookup(cardNo)!, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
        }),
        ...["first", "second"].map((id) =>
          createCardInstance(lookup(targetNo)!, {
            instanceId: id,
            ownerPlayerId: "bob",
            zone: "hand",
          })
        ),
      ],
      playerOverrides: [{ countValue: 2 }, { handCount: 2 }],
    }),
    step: "main" as const,
  };
  let result = executeEffect({
    ...options,
    state,
    chainId: "test:reveal-selection",
    actingPlayerId: "alice",
    sourceInstanceId: "source",
    effect: lookup(cardNo)!.effects![0]!,
    effectIndex: 0,
    promptUnresolvedChoice: true,
    // B面はカウント支払い後の継続から、閲覧→破棄の実本文を検証する。
    ...(cardNo === "BSKB01-TX01(B)"
      ? {
          startFromStepIndex: 2,
          initialStepResults: [
            {
              stepId: "pay-count-cores",
              affectedCardInstanceIds: [],
              succeeded: true,
              numericAmount: 2,
            },
          ],
        }
      : {}),
  });
  for (let i = 0; i < 6 && !result.pendingZoneSelection; i++) {
    if (!result.pendingCoreCountSelection && !result.pendingStepOptionalChoice)
      break;
    const action = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      ...options,
    }).find(
      (a) =>
        a.kind === "resolve_pending_core_count" ||
        (a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute")
    );
    if (!action) break;
    result = applyLegalAction({
      state: result,
      action,
      coreCountSelection: 2,
      ...options,
    }).state;
  }
  return result;
}

describe("閲覧済みの手札からの選択", () => {
  it("全カードのreveal_handを監査対象に固定する", () => {
    const cards = definitions
      .filter((card) => JSON.stringify(card.effects).includes('"reveal_hand"'))
      .map((card) => card.cardNo);
    expect(cards.sort()).toEqual(
      [
        "BSKB01-TX01(B)",
        "BSLH01-TR01(B)",
        "BSLH01-TR03(A)",
        "BSTH10-C01",
        "BSTH10-C02",
        "BSTH10-C03",
        "BSTS01-C06",
      ].sort()
    );
  });
  it.each(["BSTH10-C01", "BSTH10-C02", "BSKB01-TX01(B)"])(
    "%s: 配送後も候補画像の定義を持ち、選択後は秘匿する",
    (cardNo) => {
      const state = revealSelection(cardNo);
      expect(
        state.pendingZoneSelection?.candidateCardInstanceIds,
        JSON.stringify(state.log)
      ).toEqual(["first", "second"]);
      const visible = sanitizeStateForViewer(state, "alice");
      expect(visible.pendingZoneSelection).toMatchObject({
        revealedCardDefinitionIds: {
          first:
            cardNo === "BSTH10-C01"
              ? "BSTH10-C02"
              : cardNo === "BSKB01-TX01(B)"
                ? "BSTH10-C03"
                : "BSTH10-R01",
          second:
            cardNo === "BSTH10-C01"
              ? "BSTH10-C02"
              : cardNo === "BSKB01-TX01(B)"
                ? "BSTH10-C03"
                : "BSTH10-R01",
        },
      });
      expect(
        sanitizeStateForViewer(visible, "alice").pendingZoneSelection
      ).toEqual(visible.pendingZoneSelection);
      expect(
        sanitizeStateForViewer(state, "bob").pendingZoneSelection
      ).toBeNull();
      expect(
        sanitizeStateForViewer(state, null).pendingZoneSelection
      ).toBeNull();
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...options,
      }).find((a) => a.kind === "resolve_pending_zone_selection")!;
      const after = applyLegalAction({
        state,
        action,
        ...options,
        selectedZoneCardIds: ["second"],
      }).state;
      expect(after.pendingZoneSelection).toBeNull();
      expect(
        after.cardInstances.find((c) => c.instanceId === "second")?.zone
      ).toBe("trash");
      expect(
        sanitizeStateForViewer(after, "alice").cardInstances.find(
          (c) => c.instanceId === "first"
        )?.definitionId
      ).toBe("_hidden_card_");
    }
  );

  it.each(["self", "opponent", "both"] as const)(
    "revealTo=%s: 閲覧枚数と選択者の権限を守り、任意選択をまたいで引き継ぐ",
    (revealTo) => {
      const base = revealSelection();
      const state = {
        ...base,
        pendingZoneSelection: null,
        publicDisclosures: [],
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "reveal_hand",
              player: "opponent",
              count: 1,
              revealTo,
            },
          },
          { executionMode: "optional", action: { kind: "draw", count: 0 } },
          {
            action: {
              kind: "discard",
              player: "opponent",
              count: 1,
              selectionPlayer: "effect_controller",
            },
          },
        ],
      };
      let after = executeEffect({
        state,
        effect,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        chainId: "test:limited-reveal",
        promptUnresolvedChoice: true,
        ...options,
      });
      expect(after.pendingStepOptionalChoice).not.toBeNull();
      const resume = getLegalActions({
        state: after,
        actingPlayerId: "alice",
        ...options,
      }).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "decline"
      )!;
      after = applyLegalAction({
        state: after,
        action: resume,
        ...options,
      }).state;
      const visible = sanitizeStateForViewer(after, "alice");
      expect(visible.pendingZoneSelection?.revealedCardDefinitionIds).toEqual(
        revealTo === "opponent" ? undefined : { first: "BSTH10-R01" }
      );
      expect(
        visible.cardInstances.find((c) => c.instanceId === "second")
          ?.definitionId
      ).toBe("_hidden_card_");
    }
  );

  it("過去の閲覧履歴だけでは別の効果の選択候補を公開しない", () => {
    const previous = revealSelection();
    const after = executeEffect({
      state: { ...previous, pendingZoneSelection: null },
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "discard",
              player: "opponent",
              count: 1,
              selectionPlayer: "effect_controller",
            },
          },
        ],
      },
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      chainId: "test:no-reveal",
      ...options,
    });
    expect(after.pendingZoneSelection?.candidateCardInstanceIds).toHaveLength(
      2
    );
    expect(
      after.pendingZoneSelection?.revealedCardDefinitionIds
    ).toBeUndefined();
  });
});
