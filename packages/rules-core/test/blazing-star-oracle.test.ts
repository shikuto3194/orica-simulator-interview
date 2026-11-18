import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildBlazingStarOracleScenario } from "../../../apps/playground-web/src/scenario-blazing-star-oracle";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  getLegalActions,
  createCardInstance,
  createEmptyGameState,
  type GameState,
  type LegalAction,
} from "../src";

import { executeDiscardHand } from "../src/effect/structured-zone-ops";
import {
  findRevealedEffect,
  materializeDeferredTrashOptionalAdds,
} from "../src/effect/structured-trash-ops";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
};
function act(
  state: GameState,
  player: string,
  kind: LegalAction["kind"],
  input = {}
): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: player,
    ...lookups,
  });
  const action = actions.find((candidate) => candidate.kind === kind);
  expect(action, JSON.stringify(actions)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...input })
    .state;
}
const coreCount = (state: GameState) =>
  state.cardInstances.find((card) => card.instanceId === "yamazanadu")!
    .normalCoreCount;

function resolveOracle(owner: string): GameState {
  const initial = buildBlazingStarOracleScenario(
    ALL_CARDS,
    new URLSearchParams({ owner })
  );
  const declared = act(initial, owner, "resolve_pending_triggered_effect");
  return act(declared, owner === "alice" ? "bob" : "alice", "pass_stack");
}

describe("BSTH01-C21 トラッシュ回収後の導界者コア", () => {
  for (const owner of ["alice", "bob"]) {
    it.each([true, false])(
      owner +
        ": 原因が自分の黄の効果=%sのときだけ破棄後の回収とコア追加を選べる",
      (ownEffect) => {
        const sourcePlayer = ownEffect
          ? owner
          : owner === "alice"
            ? "bob"
            : "alice";
        const initial = createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: ["alice", "bob"].map((id) => ({
            deckCount: id === owner ? 1 : 0,
            handCount: 0,
            voidNormalCoreCount: 100,
          })),
          cardInstances: [
            createCardInstance(definitions.get("BSTH01-C21")!, {
              instanceId: "blazing",
              ownerPlayerId: owner,
              zone: "deck",
            }),
            createCardInstance(definitions.get("BSTH04-XX01")!, {
              instanceId: "yamazanadu",
              ownerPlayerId: owner,
              zone: "field",
            }),
            createCardInstance(definitions.get("BSTH07.8-R02")!, {
              instanceId: "yellow-source",
              ownerPlayerId: sourcePlayer,
              zone: "field",
              normalCoreCount: 1,
            }),
          ],
        });
        // 原因プレイヤーだけを反転する共通破棄primitiveの境界テスト。
        // この破棄を行う実カード同士の対戦再現を仮定しない。
        const discarded = executeDiscardHand(
          initial,
          sourcePlayer,
          {
            kind: "discard_hand",
            targetPlayer: ownEffect ? "self" : "opponent",
            fromZone: "deck",
            count: 1,
          },
          lookups.getCardDefinitionById,
          "yellow-source"
        );
        const choice = materializeDeferredTrashOptionalAdds(discarded);
        let result = choice;
        if (ownEffect) {
          expect(choice.pendingDeckReveal?.origin).toBe("trash");
          result = act(choice, owner, "resolve_pending_deck_reveal_pick", {
            selectedDeckRevealCardIds: ["blazing"],
          });
        } else {
          expect(choice.pendingDeckReveal).toBeNull();
          expect(choice.pendingTrashOptionalAdds).toEqual([]);
        }
        expect(
          result.cardInstances.find((card) => card.instanceId === "blazing")
            ?.zone
        ).toBe(ownEffect ? "hand" : "trash");
        expect(coreCount(result)).toBe(ownEffect ? 1 : 0);
        expect(
          result.players.find((player) => player.id === owner)
        ).toMatchObject({
          deckCount: 0,
          handCount: ownEffect ? 1 : 0,
          voidNormalCoreCount: ownEffect ? 99 : 100,
        });
        expect(result.pendingTrashOptionalAdds).toEqual([]);
        expect(result.pendingDeckReveal).toBeNull();
        expect(result.pendingAfterTriggersContinuations).toEqual([]);
      }
    );
    it.each([true, false])(
      owner + ": オープン時も自分の黄の効果=%sで回収資格を判定する",
      (ownEffect) => {
        const card = definitions.get("BSTH01-C21")!;
        const state = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(card, {
              instanceId: "blazing",
              ownerPlayerId: owner,
              zone: "deck",
            }),
          ],
        });
        const match = findRevealedEffect(
          state,
          "blazing",
          card,
          lookups.getCardDefinitionById,
          {
            sourceColors: ["yellow"],
            sourcePlayerId: ownEffect
              ? owner
              : owner === "alice"
                ? "bob"
                : "alice",
            fromZone: "deck",
          }
        );
        if (ownEffect)
          expect(match?.disposition).toEqual({
            kind: "move",
            destination: "hand",
          });
        else expect(match).toBeUndefined();
      }
    );
  }

  it.each(["alice", "bob"])(
    "%s: 小町の導託1個と回収1個でヤマザナドゥに2個置く",
    (owner) => {
      const oracle = resolveOracle(owner);
      expect(coreCount(oracle)).toBe(1);
      expect(oracle.pendingDeckReveal?.origin).toBe("trash");
      const result = act(oracle, owner, "resolve_pending_deck_reveal_pick", {
        selectedDeckRevealCardIds: ["oracle-deck-1"],
      });
      expect(
        result.cardInstances.find((card) => card.instanceId === "oracle-deck-1")
          ?.zone
      ).toBe("hand");
      expect(coreCount(result)).toBe(2);
      expect(
        result.players.find((player) => player.id === owner)
          ?.voidNormalCoreCount
      ).toBe(98);
      expect(
        result.cardInstances.filter((card) => card.zone === "trash")
      ).toHaveLength(2);
      expect(result.pendingAfterTriggersContinuations).toHaveLength(0);
      expect(result.pendingDeckReveal).toBeNull();
    }
  );

  it.each([
    ["相手の黄の導界者", "BSTH04-XX01", "bob"],
    [
      "黄でない導界者",
      ALL_CARDS.find(
        (card) =>
          card.grandwalkerData?.kind === "guided" &&
          !card.colors.includes("yellow")
      )!.cardNo,
      "alice",
    ],
    [
      "黄の創界神",
      ALL_CARDS.find(
        (card) =>
          card.grandwalkerData?.kind === "grandwalker" &&
          card.colors.includes("yellow")
      )!.cardNo,
      "alice",
    ],
    ["黄の通常ネクサス", "BSTH01-C12", "alice"],
  ])("%sには回収後のコアを置かない", (_label, cardNo, owner) => {
    const oracle = resolveOracle("alice");
    // 導託の解決後、配置先が不適格な1枚だけの盤面で回収の追加処理を検証する。
    const state = {
      ...oracle,
      cardInstances: oracle.cardInstances
        .filter((card) => card.instanceId !== "yamazanadu")
        .concat(
          createCardInstance(definitions.get(cardNo!)!, {
            instanceId: "ineligible",
            ownerPlayerId: owner!,
            zone: "field",
          })
        ),
      activeContinuousEffects: [],
    };
    const result = act(state, "alice", "resolve_pending_deck_reveal_pick", {
      selectedDeckRevealCardIds: ["oracle-deck-1"],
    });
    expect(
      result.cardInstances.find((card) => card.instanceId === "oracle-deck-1")
        ?.zone
    ).toBe("hand");
    expect(
      result.cardInstances.find((card) => card.instanceId === "ineligible")
        ?.normalCoreCount
    ).toBe(0);
    expect(result.players[0]!.voidNormalCoreCount).toBe(99);
    expect(result.pendingAfterTriggersContinuations).toHaveLength(0);
  });

  it("回収を辞退すると導託1個だけで終わる", () => {
    const result = act(
      resolveOracle("alice"),
      "alice",
      "resolve_pending_deck_reveal_pick",
      {
        selectedDeckRevealCardIds: [],
      }
    );
    expect(coreCount(result)).toBe(1);
    expect(
      result.cardInstances.filter((card) => card.zone === "trash")
    ).toHaveLength(3);
    expect(result.players[0]!.voidNormalCoreCount).toBe(99);
    expect(result.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(result.pendingDeckReveal).toBeNull();
  });
});
