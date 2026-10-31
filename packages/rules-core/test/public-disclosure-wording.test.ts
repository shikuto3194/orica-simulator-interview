import { describe, expect, it } from "vitest";
import {
  appendPublicDisclosuresForEffectStepTransition,
  appendPublicDisclosuresForStateTransition,
  createCardInstance,
  createEmptyGameState,
  publicDisclosureActionLabelForAction,
  sanitizeStateForViewer,
} from "../src";
import {
  executePeekDeck,
  executeRevealHand,
} from "../src/effect/structured-zone-ops";
import type { Action, CardDefinition } from "../src";

const definition: CardDefinition = {
  cardNo: "DISCLOSURE-WORDING",
  name: "ログ検証カード",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

function fieldEntry() {
  const card = createCardInstance(definition, {
    instanceId: "entry",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "hand",
  });
  const before = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [card],
  });
  const after = {
    ...before,
    cardInstances: [{ ...card, zone: "field" as const, normalCoreCount: 1 }],
  };
  return { before, after, actorPlayerId: "alice" };
}

describe("公開情報のアクション文言", () => {
  it("破壊から手札戻しに置換された離脱待機を破壊と断定しない", () => {
    const before = fieldEntry().after;
    const after = {
      ...before,
      pendingLeaveEntities: [
        {
          instanceId: "entry",
          kind: "destroy" as const,
          cause: "effect_resolution" as const,
          causePlayerId: "alice",
          chainId: "log-replacement",
          deferZoneMoveUntilChainEnd: true,
          leaveDestination: { zone: "hand" as const },
        },
      ],
    };
    const result = appendPublicDisclosuresForEffectStepTransition({
      before,
      after,
      actorPlayerId: "alice",
      action: { kind: "destroy", target: { kind: "self" } },
    });
    expect(result.publicDisclosures?.flatMap((entry) => entry.results)).toEqual(
      [expect.objectContaining({ to: "hand", actionLabel: "add_to_hand" })]
    );
  });

  it.each([
    [null, "host-a", "combine"],
    ["host-a", null, "separate"],
    ["host-a", "host-b", "brave_swap"],
  ] as const)(
    "ブレイヴの接続変更 %s → %s を %s として一度だけ記録する",
    (fromHost, toHost, actionLabel) => {
      const state = fieldEntry().after;
      const before = {
        ...state,
        cardInstances: state.cardInstances.map((card) => ({
          ...card,
          zoneRoleName: "brave" as const,
          attachedToInstanceId: fromHost,
        })),
      };
      const after = {
        ...before,
        cardInstances: before.cardInstances.map((card) => ({
          ...card,
          attachedToInstanceId: toHost,
        })),
      };
      const result = appendPublicDisclosuresForStateTransition({
        before,
        after,
        actorPlayerId: "alice",
      });
      expect(
        result.publicDisclosures?.flatMap((entry) => entry.results)
      ).toEqual([expect.objectContaining({ kind: "card_state", actionLabel })]);
      const observedAgain = appendPublicDisclosuresForStateTransition({
        before,
        after: result,
        actorPlayerId: "alice",
      });
      expect(observedAgain.publicDisclosures).toEqual(result.publicDisclosures);
    }
  );

  it("ブレイヴ以外の下カードの接続変更を合体と呼ばない", () => {
    const before = fieldEntry().after;
    const after = {
      ...before,
      cardInstances: before.cardInstances.map((card) => ({
        ...card,
        attachedToInstanceId: "host-a",
      })),
    };
    expect(
      appendPublicDisclosuresForStateTransition({
        before,
        after,
        actorPlayerId: "alice",
      }).publicDisclosures
    ).toEqual(before.publicDisclosures);
  });

  it("カウント固定値を差分と区別して記録する", () => {
    const { before } = fieldEntry();
    const state = appendPublicDisclosuresForEffectStepTransition({
      before,
      after: {
        ...before,
        players: before.players.map((player) =>
          player.id === "alice" ? { ...player, countValue: 5 } : player
        ),
      },
      actorPlayerId: "alice",
      action: { kind: "count_set", player: "self", value: 5 },
    });
    expect(state.publicDisclosures?.[0]?.results).toEqual([
      expect.objectContaining({
        kind: "count_delta",
        actionLabel: "count_set",
        value: 5,
      }),
    ]);
  });
  it.each([
    ["summon", "summon"],
    ["place_nexus", "place"],
    ["contract_combine", "contract_combine"],
    ["declare_manifest", "manifest"],
    ["declare_advent", "advent"],
    ["declare_host_dual_advent", "advent"],
    ["declare_dual_host_advent", "advent"],
  ] as const)(
    "%s の解決情報をカードの種別より優先する",
    (kind, actionLabel) => {
      const result = appendPublicDisclosuresForStateTransition({
        ...fieldEntry(),
        action: { kind, cardInstanceId: "entry" },
      });
      expect(
        result.publicDisclosures?.flatMap((entry) => entry.results)
      ).toEqual([
        expect.objectContaining({ actionLabel, instanceId: "entry" }),
      ]);
    }
  );

  it("純粋な手札公開はオープンにせず公開された相手だけが参照できる", () => {
    const { before } = fieldEntry();
    const result = executeRevealHand(
      before,
      "alice",
      { kind: "reveal_hand", revealTo: "opponent" },
      () => definition
    );
    expect(sanitizeStateForViewer(result, "alice").publicDisclosures).toEqual(
      []
    );
    const shown = sanitizeStateForViewer(result, "bob").publicDisclosures;
    expect(shown).toMatchObject([
      {
        targets: [
          {
            actionLabel: "show_cards",
            definitionIdSnapshot: definition.cardNo,
          },
        ],
      },
    ]);
    expect(shown?.[0]?.targets[0]).not.toHaveProperty("instanceId");
    expect(result.cardInstances[0]?.zone).toBe("hand");
  });

  it("デッキの閲覧はゾーンを動かさず自分だけに公開ログを残す", () => {
    const { before } = fieldEntry();
    const state = {
      ...before,
      cardInstances: before.cardInstances.map((card) => ({
        ...card,
        zone: "deck" as const,
      })),
    };
    const result = executePeekDeck(state, "alice", {
      kind: "peek_deck",
      count: 1,
      revealTo: "self",
    });
    expect(sanitizeStateForViewer(result, "bob").publicDisclosures).toEqual([]);
    expect(
      sanitizeStateForViewer(result, "alice").publicDisclosures
    ).toMatchObject([{ targets: [{ actionLabel: "show_cards" }] }]);
    expect(result.cardInstances[0]?.zone).toBe("deck");
  });
  it.each([
    [{ kind: "summon", target: { kind: "self" } }, "summon"],
    [{ kind: "put", target: { kind: "self" } }, "put"],
    [
      { kind: "put", target: { kind: "self" }, effectScope: "genkai" },
      "genkai",
    ],
    [{ kind: "place", target: { kind: "self" } }, "place"],
    [{ kind: "advent" }, "advent"],
  ] as const)("DSL %j の場入りの意味を保持する", (action, label) => {
    const state = appendPublicDisclosuresForEffectStepTransition({
      ...fieldEntry(),
      action: action as Action,
    });
    expect(state.publicDisclosures?.flatMap((entry) => entry.results)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: "entry", actionLabel: label }),
      ])
    );
  });

  it("発揮抑止を無効化と混同しない", () => {
    expect(
      publicDisclosureActionLabelForAction({
        kind: "suppress_effect",
      } as Action)
    ).not.toBe("negate");
    expect(
      publicDisclosureActionLabelForAction({
        kind: "suppress_stack_source",
      } as Action)
    ).not.toBe("negate");
  });

  it("位置が確定しないデッキ移動をデッキ下と断定しない", () => {
    const transition = fieldEntry();
    const before = transition.after;
    const after = {
      ...before,
      cardInstances: before.cardInstances.map((card) => ({
        ...card,
        zone: "deck" as const,
      })),
    };
    const state = appendPublicDisclosuresForStateTransition({
      before,
      after,
      actorPlayerId: "alice",
    });
    expect(
      state.publicDisclosures?.flatMap((entry) => entry.results)[0]?.actionLabel
    ).toBe("move_to_deck");
  });

  it("対象の予定処理で実際の移動結果を上書きしない", () => {
    const transition = fieldEntry();
    const before = transition.after;
    const after = {
      ...before,
      publicDisclosures: [
        {
          id: "target",
          sequence: 1,
          turnNumber: 1,
          step: "main" as const,
          actorPlayerId: "alice",
          audience: "both" as const,
          kind: "target_declared" as const,
          targets: [
            {
              kind: "card" as const,
              instanceId: "entry",
              actionLabel: "destroy" as const,
            },
          ],
          results: [],
        },
      ],
      cardInstances: before.cardInstances.map((card) => ({
        ...card,
        zone: "removed_from_game" as const,
      })),
    };
    const state = appendPublicDisclosuresForStateTransition({
      before,
      after,
      actorPlayerId: "alice",
    });
    expect(state.publicDisclosures?.[0]?.results[0]?.actionLabel).toBe(
      "move_to_removed"
    );
  });
});
