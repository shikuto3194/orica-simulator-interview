import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  getLegalActions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
} from "../src";
import type { GameState, LegalAction, ApplyLegalActionOptions } from "../src";
import {
  generateMagicRegistrations,
  generateTriggeredEffectRegistrations,
  generateBurstRegistrations,
} from "../src/effect/structured-effect-registrations";

const definitions = new Map(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((card) => [
    card.cardNo,
    card,
  ])
);
const getDef = (id: string) => definitions.get(id);
const card = (id: string) => definitions.get(id)!;

function apply(
  state: GameState,
  kind: LegalAction["kind"],
  extra: Partial<ApplyLegalActionOptions> = {},
  choiceIndex?: number
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  }).find(
    (a) =>
      a.kind === kind &&
      (choiceIndex === undefined ||
        ("choiceIndex" in a && a.choiceIndex === choiceIndex))
  );
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    ...extra,
  }).state;
}

describe("その後: 前段の解決後に後段の選択を行う", () => {
  it.each(["BSTH05.5-C10", "BSTH07-R11"])(
    "%s: ドロー前に破棄方法を宣言させず、引いた手札を見て選ぶ",
    (cardNo) => {
      const definition = card(cardNo);
      const effectIndex = definition.effects!.findIndex((effect) =>
        effect.steps.some((step) => step.action.kind === "draw")
      );
      const effect = definition.effects![effectIndex]!;
      const registration = generateMagicRegistrations(definition).find(
        (entry) => entry.effectIndex === effectIndex
      )!;
      expect(registration.choices).toBeUndefined();
      const source = createCardInstance(definition, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "in_use",
      });
      const deck = Array.from({ length: 5 }, (_, index) =>
        createCardInstance(card("BSTH01-C01"), {
          instanceId: `deck-${index}`,
          ownerPlayerId: "alice",
          zone: "deck",
        })
      );
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, ...deck],
        playerOverrides: [{ handCount: 0, deckCount: 5 }, {}],
      });
      let after = executeEffect({
        chainId: "test:sequential-effect-order:83",
        state,
        effect,
        effectIndex,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        effectActionKind: "magic",
      });
      expect(after.players[0]!.handCount).toBe(cardNo === "BSTH07-R11" ? 2 : 3);
      expect(after.pendingStepChoice?.stepIndex).toBe(
        cardNo === "BSTH05.5-C10" ? 3 : 1
      );
      expect(after.pendingZoneSelection).toBeNull();
      after = apply(after, "resolve_pending_step_choice", {}, 0);
      if (after.pendingZoneSelection)
        after = apply(after, "resolve_pending_zone_selection", {
          selectedZoneCardIds: after.cardInstances
            .filter((c) => c.zone === "hand")
            .map((c) => c.instanceId),
        });
      expect(after.players[0]!.handCount).toBe(0);
      expect(after.pendingStepChoice).toBeNull();
      expect(after.pendingZoneSelection).toBeNull();
      expect(
        after.cardInstances.filter(
          (c) => c.instanceId.startsWith("deck-") && c.zone === "trash"
        )
      ).toHaveLength(cardNo === "BSTH07-R11" ? 2 : 3);
    }
  );

  it("花映塚てゐ: デッキ破棄前のトラッシュから回収対象を決めない", () => {
    const definition = card("BSTH04-C03");
    const registration = generateTriggeredEffectRegistrations(definition).find(
      (entry) => entry.effectIndex === 1
    )!;
    expect(registration.requiredTargetCount ?? 0).toBe(0);
    const source = createCardInstance(definition, {
      instanceId: "tewi",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = [0, 1].map((i) =>
      createCardInstance(definition, {
        instanceId: `tewi-deck-${i}`,
        ownerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, ...deck],
      playerOverrides: [{ deckCount: 2, handCount: 0 }, {}],
    });
    let after = executeEffect({
      chainId: "test:sequential-effect-order:139",
      state,
      effect: definition.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "tewi",
      actingPlayerId: "alice",
      effectActionKind: "triggered_effect",
      getCardDefinitionById: getDef,
    });
    after = apply(after, "resolve_pending_step_optional_choice");
    expect(after.pendingZoneSelection?.candidateCardInstanceIds).toContain(
      "tewi-deck-1"
    );
    after = apply(after, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["tewi-deck-1"],
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "tewi-deck-1")?.zone
    ).toBe("hand");
    expect(after.pendingZoneSelection).toBeNull();
  });

  it.each(["BSSL01-C04", "BSTH11-R03"])(
    "%s: 後段の任意コストが前段の発揮条件にならない",
    (cardNo) => {
      const entries = generateTriggeredEffectRegistrations(card(cardNo));
      for (const entry of entries) {
        expect(entry.requiredDiscardCost).toBeUndefined();
        expect(entry.requiredCoreMoveCost).toBeUndefined();
      }
    }
  );

  it("Para-RAID: 公開を辞退しても、その後フィールドに置ける", () => {
    const definition = card("BSES01-C01");
    const source = createCardInstance(definition, {
      instanceId: "para",
      ownerPlayerId: "alice",
      zone: "in_use",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
    });
    let after = executeEffect({
      chainId: "test:sequential-effect-order:183",
      state,
      effect: definition.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "para",
      actingPlayerId: "alice",
      effectActionKind: "magic",
      getCardDefinitionById: getDef,
    });
    const decline = getLegalActions({
      state: after,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "decline"
    )!;
    after = applyLegalAction({
      state: after,
      action: decline,
      getCardDefinitionById: getDef,
    }).state;
    expect(after.pendingStepOptionalChoice?.stepIndex).toBe(1);
    after = apply(after, "resolve_pending_step_optional_choice");
    expect(after.cardInstances.find((c) => c.instanceId === "para")?.zone).toBe(
      "field"
    );
    expect(after.pendingStepOptionalChoice).toBeNull();
  });

  it("碧エリィ: カウント増加前に重疲労の対象を決めない", () => {
    const definition = card("BSLH01-R02");
    for (const entry of generateTriggeredEffectRegistrations(definition).filter(
      (entry) => entry.effectIndex === 0
    )) {
      expect(entry.requiredTargetCount ?? 0).toBe(0);
    }
  });

  it.each(["BSGE01-C06"])(
    "%s: 前段のカウントを払わず後段だけを解決できる",
    (cardNo) => {
      const definition = card(cardNo);
      const effectIndex = 2;
      const host = createCardInstance(card("BSGE01-CX01"), {
        instanceId: "host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const source = createCardInstance(definition, {
        instanceId: "brave",
        ownerPlayerId: "alice",
        zone: "field",
        attachedToInstanceId: "host",
      });
      const enemy = createCardInstance(card("BSTH01-C01"), {
        instanceId: "enemy",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      });
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, source, enemy],
        playerOverrides: [{ countValue: 0 }, {}],
      });
      // 前段支払いを辞退した継続から、後段の独立性を検証する。
      let after = executeEffect({
        chainId: "test:sequential-effect-order:253",
        state,
        effect: definition.effects![effectIndex]!,
        effectIndex,
        sourceInstanceId: "brave",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        startFromStepIndex: 0,
        declinedOptionalStepIndex: 0,
      });
      expect(after.pendingStepOptionalChoice?.stepIndex).toBe(2);
      after = apply(after, "resolve_pending_step_optional_choice");
      expect(after.players[0]!.countValue).toBe(0);
      expect(
        after.cardInstances.find((c) => c.instanceId === "enemy")?.zone
      ).toBe("deck");
      expect(after.pendingStepOptionalChoice).toBeNull();
    }
  );

  it("ヨシュア: 召喚・セット前に除外対象を決めない", () => {
    const entry = generateBurstRegistrations(card("BSLH01-M03"))[0]!;
    for (const choice of entry.choices ?? [])
      expect(choice.requiredTargetCount ?? 0).toBe(0);
  });
});
