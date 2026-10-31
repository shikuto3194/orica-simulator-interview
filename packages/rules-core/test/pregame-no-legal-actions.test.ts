import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  setFirstPlayer,
} from "../src/index";
import {
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildHandActivatedEffectLookup,
} from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState, PreGameState } from "../src/index";
import { BSTH01_CARDS } from "../../card-data/src/cards/BSTH01";

/**
 * プレゲーム (じゃんけん / マリガン) 中はゲーム内アクションを列挙しない。
 *
 * バグ: T1 スタートステップ中のマリガン (preGame 非 null) で、start-step スコープの
 * 手札起動効果 (BSTH01-M01 パチュリー・ノーレッジ effect[1]) が「効果発揮」可能として
 * 候補列挙されていた。
 */
describe("preGame 中は getLegalActions が空", () => {
  const cardDefs: CardDefinition[] = BSTH01_CARDS;
  const getCardDefinitionById = (id: string) =>
    cardDefs.find((d) => d.cardNo === id);
  const lookups = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cardDefs),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(cardDefs),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cardDefs),
    getRegisteredMagicActions: buildMagicLookup(cardDefs),
    getRegisteredHandCardEffectActions:
      buildHandActivatedEffectLookup(cardDefs),
  };

  const mulliganPreGame: PreGameState = {
    phase: "waiting_mulligan_first",
    firstPlayerId: "alice",
    jankenHands: {},
    jankenWinner: "alice",
    mulliganDone: {},
  };

  /** T1 スタートステップ、alice 手札に BSTH01-M01。 */
  function buildState(preGame: PreGameState | null): GameState {
    const pachuli = cardDefs.find((d) => d.cardNo === "BSTH01-M01")!;
    const hand = createCardInstance(pachuli, {
      instanceId: "alice-hand-0",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const base = setFirstPlayer(
      createEmptyGameState({ playerIds: ["alice", "bob"] }),
      "alice"
    );
    return {
      ...base,
      turnNumber: 1,
      activePlayerId: "alice",
      step: "start",
      window: "none",
      cardInstances: [hand],
      // M01 の起動効果は 1 コスト支払いを伴うため、リザーブにコアを置く。
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 3 } : p
      ),
      preGame,
    };
  }

  it("マリガン中 (preGame 非 null) は legal actions が空", () => {
    const actions = getLegalActions({
      state: buildState(mulliganPreGame),
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(actions).toEqual([]);
  });

  // 非 over-block (preGame=null での通常列挙) は、全既存テストが preGame=null で走り
  // 本ゲートを素通りして合格していることで担保される (ゲートは純粋な短絡 return)。
});
