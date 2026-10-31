import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import { adventSourceIdsOf } from "../src/model";
import {
  executeEffectAdvent,
  getAdventTargets,
} from "../src/mechanics/advent-system";
import { shouldAutoFinalizeDeckRevealRemainder } from "../src/effect/structured-effect-interpreter";
import {
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { finalizeCardUsageAndQueueTriggers } from "../src/effect/trigger-system";

const getDef = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const card = (no: string) => getDef(no)!;
const instance = (
  no: string,
  id: string,
  zone: "field" | "hand" | "trash" | "deck",
  owner = "alice"
) =>
  createCardInstance(card(no), {
    instanceId: id,
    ownerPlayerId: owner,
    zone,
    normalCoreCount: zone === "field" ? 1 : 0,
  });

describe("原文の公開残りカードの選択", () => {
  it.each([1, 2])("残り %i 枚でもデッキ下/破棄の選択を保留する", (count) => {
    expect(
      shouldAutoFinalizeDeckRevealRemainder("bottom_or_trash", count)
    ).toBe(false);
  });
  it.each(["bottom", "trash"] as const)(
    "BSES01-C02 の残りを %s に移す",
    (placement) => {
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance("BSES01-C02", "source", "field"),
          instance("BSAZ01-C01", "d1", "deck"),
          instance("BSAZ01-C01", "d2", "deck"),
          instance("BSAZ01-C01", "d3", "deck"),
        ],
        playerOverrides: [{ deckCount: 3 }, {}],
      });
      const revealed = executeEffect({
        chainId: "test:crossover-fidelity-20260913:56",
        state,
        effect: card("BSES01-C02").effects[2]!,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      const pick = getLegalActions({
        state: revealed,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
      const pending = applyLegalAction({
        state: revealed,
        action: pick,
        getCardDefinitionById: getDef,
        selectedDeckRevealCardIds: [],
      }).state;
      expect(pending.pendingDeckReveal?.phase).toBe("ordering_remainder");
      const action = getLegalActions({
        state: pending,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      }).find((a) => a.kind === "resolve_pending_deck_reveal_order")!;
      const after = applyLegalAction({
        state: pending,
        action,
        getCardDefinitionById: getDef,
        deckRevealRemainderOrder: ["d3", "d2", "d1"],
        deckRevealPlacement: placement,
      }).state;
      expect(after.pendingDeckReveal).toBeNull();
      expect(
        after.cardInstances
          .filter((c) => c.instanceId.startsWith("d"))
          .map((c) => c.zone)
      ).toEqual([
        placement === "trash" ? "trash" : "deck",
        placement === "trash" ? "trash" : "deck",
        placement === "trash" ? "trash" : "deck",
      ]);
      expect(after.players[0]!.deckCount).toBe(placement === "trash" ? 0 : 3);
      expect(() =>
        applyLegalAction({
          state: pending,
          action,
          getCardDefinitionById: getDef,
          deckRevealRemainderOrder: ["d1", "d2", "d3"],
          deckRevealPlacement: "top",
        })
      ).toThrow();
    }
  );
});

describe("BSAZ01 トラッシュのカードを煌臨元にする", () => {
  it.each(["BSAZ01-C01", "BSAZ01-C02"])(
    "%s は手札のスレイプニールの下に入る",
    (hostNo) => {
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance(hostNo, "host", "trash"),
          instance(hostNo, "host2", "trash"),
          instance("BSAZ01-X01", "incoming", "hand"),
          instance("BSAZ01-C01", "other", "trash", "bob"),
        ],
        playerOverrides: [
          { reserveNormalCoreCount: 4, soulCoreLocation: { kind: "reserve" } },
          {},
        ],
      });
      const adventData = card("BSAZ01-X01").adventData!;
      expect(card(hostNo).adventData).toBeUndefined();
      expect(
        getAdventTargets(
          state,
          "alice",
          adventData,
          getDef,
          card("BSAZ01-X01")
        ).map((c) => c.instanceId)
      ).toEqual(["host", "host2"]);
      const after = executeEffectAdvent(
        state,
        "alice",
        {
          adventCardInstanceId: "incoming",
          targetInstanceId: "host",
          adventData,
        },
        getDef
      );
      expect(
        after.cardInstances.find((c) => c.instanceId === "incoming")?.zone
      ).toBe("field");
      expect(
        adventSourceIdsOf(
          after.cardInstances.find((c) => c.instanceId === "incoming")!
        )
      ).toEqual(["host"]);
      expect(
        after.cardInstances.find((c) => c.instanceId === "host")?.zone
      ).toBe("field");
      expect(after.players[0]!.soulCoreLocation).toEqual({ kind: "trash" });
      expect(after.pendingCoreDistribution).not.toBeNull();
      expect(
        getAdventTargets(
          after,
          "alice",
          adventData,
          getDef,
          card("BSAZ01-X01")
        ).map((c) => c.instanceId)
      ).not.toContain("host2");
      expect(
        getAdventTargets(
          { ...after, usedTrashAdventKeysThisTurn: [] },
          "alice",
          adventData,
          getDef,
          card("BSAZ01-X01")
        ).map((c) => c.instanceId)
      ).toContain("host2");
    }
  );
  it("無関係な煌臨カードにはトラッシュhostの許可を広げない", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [instance("BSAZ01-C01", "host", "trash")],
    });
    const incoming = card("BSKB01-X01");
    expect(
      getAdventTargets(state, "alice", incoming.adventData!, getDef, incoming)
    ).toEqual([]);
  });
});

describe("BSKB01-R01 自分のコア除去効果の移動数+2", () => {
  it.each(["hand", "trash", "field"] as const)(
    "修飾元を破棄した後も %s のマジックが移すコアを増やす",
    (sourceZone) => {
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance("BSKB01-R01", "modifier", "hand"),
          instance("BSKB01-C01", "partner", "hand"),
          instance("BSKB01-CX01", "meta", "field"),
          instance("BSKB01-C06", "source", sourceZone),
          {
            ...instance("BSAZ01-C01", "target", "field", "bob"),
            normalCoreCount: 5,
          },
        ],
        playerOverrides: [{ countValue: 5 }, {}],
      });
      const modified = executeEffect({
        chainId: "test:crossover-fidelity-20260913:212",
        state,
        effect: card("BSKB01-R01").effects[0]!,
        sourceInstanceId: "modifier",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        targetInstanceIds: ["partner"],
      });
      expect(
        modified.cardInstances.find((c) => c.instanceId === "modifier")?.zone
      ).toBe("trash");
      expect(
        modified.cardInstances.find((c) => c.instanceId === "partner")?.zone
      ).toBe("trash");
      const beforeReserve = modified.players[1]!.reserveNormalCoreCount;
      const after = executeEffect({
        chainId: "test:crossover-fidelity-20260913:227",
        state: modified,
        effect: {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "card_instance", instanceId: "target" },
                to: { kind: "reserve", player: "opponent" },
                amount: 1,
              },
            },
          ],
        },
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      expect(
        after.cardInstances.find((c) => c.instanceId === "target")
          ?.normalCoreCount
      ).toBe(2);
      expect(after.players[1]!.reserveNormalCoreCount).toBe(beforeReserve + 3);
    }
  );
});

describe("フィールドに置く制限と聖詠のイベント範囲", () => {
  it.each(["move_card", "move_self"] as const)(
    "BSTS01-CX01 は %s による非暴嵐カードの配置も防ぐ",
    (kind) => {
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance("BSTS01-CX01", "rimuru", "field"),
          instance("BSAZ01-C12", "source", "hand"),
        ],
        playerOverrides: [{ contractCardNo: "BSTS01-CX01" }, {}],
      });
      const restricted = executeEffect({
        chainId: "test:crossover-fidelity-20260913:267",
        state,
        effect: card("BSTS01-CX01").effects[1]!,
        sourceInstanceId: "rimuru",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      expect(
        restricted.activeContinuousEffects.some(
          (ce) => ce.modifierTag === "restrict_use"
        )
      ).toBe(true);
      const action =
        kind === "move_self"
          ? { kind, destination: "field" as const }
          : {
              kind,
              from: { zone: "hand" as const, player: "self" as const },
              to: { zone: "field" as const },
              count: 1,
            };
      const after = executeEffect({
        chainId: "test:crossover-fidelity-20260913:288",
        state: restricted,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [{ action }],
        },
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });
      expect(
        after.cardInstances.find((c) => c.instanceId === "source")?.zone
      ).toBe("hand");
    }
  );
  it.each([undefined, "shouei"] as const)(
    "ギアペンダントは scope=%s の入替えを識別する",
    (effectScope) => {
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(card("BSSG01-C05"), {
            instanceId: "gear",
            ownerPlayerId: "alice",
            zone: "mirage",
          }),
          instance("BSSG01-C01", "out", "field"),
          instance("BSSG01-C03", "in", "hand"),
        ],
        mirageSetStates: [{ playerId: "alice", cardInstanceId: "gear" }],
      });
      state.pendingFieldHandSwapChoice = {
        pendingId: "swap",
        chainId: "test:swap",
        actingPlayerId: "alice",
        sourceInstanceId: "out",
        sourceDefinitionId: "BSSG01-C01",
        incomingCandidateInstanceIds: ["in"],
        enterRecovered: true,
        ...(effectScope ? { effectScope } : {}),
      };
      const options = {
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
          card("BSSG01-C05"),
        ]),
        getRegisteredBurstActions: () => [],
      };
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...options,
      }).find((a) => a.kind === "swap_field_hand")!;
      const after = applyLegalAction({ state, action, ...options }).state;
      expect(
        after.pendingTriggeredEffects.filter(
          (p) => p.eventKind === "field_hand_swap"
        )
      ).toHaveLength(effectScope ? 1 : 0);
    }
  );
});

describe("BSAZ02-R02 のカード使用後カウント", () => {
  it.each([
    "completed_use",
    "declaration",
    "field_effect",
    "self_use",
  ] as const)("%s をカード使用後の誘発と区別する", (mode) => {
    const source = {
      ...instance("BSAZ02-R02", "niro", "field"),
      normalCoreCount: 6,
      underCards: [
        {
          cardInstanceId: "drive",
          role: "text_role" as const,
          roleTag: "アルドノアドライブ",
        },
      ],
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        source,
        {
          ...instance("BSAZ01-C01", "drive", "field"),
          attachedToInstanceId: "niro",
        },
        instance("BSAZ01-C03", "used", "trash", "bob"),
      ],
    });
    state.flashCardUsageLog =
      mode === "field_effect"
        ? []
        : [
            {
              chainId: "test:crossover-fidelity-20260913:383",
              playerId: mode === "self_use" ? "alice" : "bob",
              cardInstanceId: "used",
              cardDefinitionId: "BSAZ01-C03",
              turnNumber: state.turnNumber,
              step: state.step,
              attackId: null,
              mode: "flash",
              completion: mode === "declaration" ? "declared" : "resolving",
            },
          ];
    const options = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredBurstActions: () => [],
    };
    const after = finalizeCardUsageAndQueueTriggers(state, options);
    const pending = after.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "card_used"
    );
    expect(pending).toHaveLength(mode === "completed_use" ? 1 : 0);
    if (mode === "completed_use") {
      const action = getLegalActions({
        state: after,
        actingPlayerId: "alice",
        ...options,
      }).find((a) => a.kind === "resolve_pending_triggered_effect")!;
      const declared = applyLegalAction({
        state: after,
        action,
        ...options,
      }).state;
      const pass = getLegalActions({
        state: declared,
        actingPlayerId: declared.stackWindow!.priorityPlayerId,
        ...options,
      }).find((a) => a.kind === "pass_stack")!;
      const resolved = applyLegalAction({
        state: declared,
        action: pass,
        ...options,
      }).state;
      expect(resolved.players[0]!.countValue).toBe(1);
    }
  });
});

describe("召喚時効果の借用中の任意選択", () => {
  it.each(["execute", "decline"] as const)(
    "%s を選んでから借用本文と外側本文を一度ずつ続行する",
    (choice) => {
      const donor = {
        ...card("BSSG01-C01"),
        cardNo: "TEST-EVENT-BORROW-OPTIONAL",
        textLines: [
          "Lv1『このスピリットの召喚時』",
          "自分のカウント+1できる。その後、自分のカウント+10する。",
        ],
        effects: [
          {
            timing: { kind: "card_event" as const, event: "summon" as const },
            textRef: [0, 1],
            steps: [
              {
                action: {
                  kind: "count_increase" as const,
                  player: "self" as const,
                  amount: 1,
                },
                executionMode: "optional" as const,
              },
              {
                action: {
                  kind: "count_increase" as const,
                  player: "self" as const,
                  amount: 10,
                },
              },
            ],
          },
        ],
      };
      const lookup = (id: string) => (id === donor.cardNo ? donor : getDef(id));
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance("BSSG01-C03", "borrower", "field"),
          createCardInstance(donor, {
            instanceId: "donor",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      });
      const pending = executeEffect({
        chainId: "test:crossover-fidelity-20260913:481",
        state,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "borrow_card_event_effect",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: {},
                  count: 1,
                },
                borrowEvents: ["summon"],
              },
            },
            { action: { kind: "count_increase", player: "self", amount: 100 } },
          ],
        },
        sourceInstanceId: "borrower",
        actingPlayerId: "alice",
        targetInstanceIds: ["donor"],
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(
        pending.pendingStepOptionalChoice,
        pending.log.join("\n")
      ).not.toBeNull();
      expect(pending.players[0]!.countValue).toBe(0);
      const after = applyLegalAction({
        state: pending,
        action: {
          kind: "resolve_pending_step_optional_choice",
          pendingId: pending.pendingStepOptionalChoice!.pendingId,
          actingPlayerId: "alice",
          choice,
        },
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      expect(after.players[0]!.countValue).toBe(
        choice === "execute" ? 111 : 110
      );
      expect(after.pendingStepOptionalChoice).toBeNull();
      expect(after.pendingAfterTriggersContinuations).toHaveLength(0);
    }
  );
});
