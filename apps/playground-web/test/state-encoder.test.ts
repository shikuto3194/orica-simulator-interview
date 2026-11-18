/**
 * 状態エンコーダの動作検証: 次元一致・可視性マスク・中盤状態のトークン化。
 * 実行: vitest run state-encoder
 */
import { describe, it, expect } from "vitest";
import {
  createCardInstance,
  initializeGame,
  getLegalActions,
  applyLegalAction,
  advanceStep,
  getCurrentActorPlayerIds,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { seedDivineSkillUsage } from "../../../packages/rules-core/test/helpers/divine-skill-usage-fixture";
import { buildEngine, randomDeck } from "./selfplay-driver";
import {
  encodeState,
  GLOBAL_DIM,
  TOKEN_FEAT_DIM,
  CARD_VOCAB_SIZE,
  TAG_COUNT,
} from "./state-encoder";

const engine = buildEngine();
const { getCardDefinitionById, lookups, cards } = engine;

/** ~maxSteps だけ進めて中盤の state を返す (検証用の軽量ロールアウト)。 */
function advanceToMidGame(maxSteps: number): GameState {
  let state = initializeGame({
    decks: [randomDeck(cards), randomDeck(cards)],
    skipPreGame: true,
  });
  for (let s = 0; s < maxSteps && state.gameResult === null; s++) {
    const actors = [...getCurrentActorPlayerIds(state)];
    let cand: LegalAction[] = [];
    for (const a of actors) {
      const acts = getLegalActions({
        state,
        actingPlayerId: a,
        getCardDefinitionById,
        ...lookups,
      }).filter((x) => x.can);
      if (acts.length > 0) {
        cand = acts;
        break;
      }
    }
    let moved = false;
    for (const action of cand) {
      try {
        const extra =
          action.kind === "resolve_pending_enter_field_placement"
            ? {
                enterFieldCorePlacements: [
                  {
                    kind: "reserve_normal" as const,
                    amount:
                      state.pendingEnterFieldPlacement?.minimumCoreCount ?? 1,
                  },
                ],
              }
            : {};
        state = applyLegalAction({
          state,
          action,
          getCardDefinitionById,
          ...lookups,
          ...extra,
        }).state;
        moved = true;
        break;
      } catch {
        /* try next */
      }
    }
    if (!moved) {
      try {
        state = advanceStep(
          state,
          getCardDefinitionById,
          lookups.getRegisteredTriggeredEffectActions,
          lookups.getRegisteredBurstActions
        );
      } catch {
        break;
      }
    }
  }
  return state;
}

describe("state encoder", () => {
  it("emits fixed-length global + token vectors on the initial state", () => {
    const state = initializeGame({
      decks: [randomDeck(cards), randomDeck(cards)],
      skipPreGame: true,
    });
    const me = state.playerOrder[0]!;
    const enc = encodeState(state, me, getCardDefinitionById);

    expect(enc.global.length).toBe(GLOBAL_DIM);
    for (const t of enc.tokens) expect(t.feats.length).toBe(TOKEN_FEAT_DIM);
    // 初期手札 (自分のみ) がトークン化される。相手手札・デッキは非トークン。
    expect(enc.tokens.length).toBeGreaterThan(0);
    // すべて有限値
    expect(enc.global.every((x) => Number.isFinite(x))).toBe(true);
    expect(
      enc.tokens.every((t) => t.feats.every((x) => Number.isFinite(x)))
    ).toBe(true);
  });

  it("masks opponent hidden cards and keeps dims stable mid-game", () => {
    const state = advanceToMidGame(150);
    const me = state.playerOrder[0]!;
    const opp = state.playerOrder[1]!;

    const encMe = encodeState(state, me, getCardDefinitionById);
    const encOpp = encodeState(state, opp, getCardDefinitionById);

    expect(encMe.global.length).toBe(GLOBAL_DIM);
    expect(encOpp.global.length).toBe(GLOBAL_DIM);
    for (const t of encMe.tokens) expect(t.feats.length).toBe(TOKEN_FEAT_DIM);

    // 視点で global が変わる (対称性: 少なくとも is-my-turn か player scalars が異なりうる)
    // マスクされたトークンは embIndex===0
    const maskedMe = encMe.tokens.filter((t) => t.embIndex === 0).length;

    console.log("\n===== ENCODER DIMS =====");
    console.log(`GLOBAL_DIM        : ${GLOBAL_DIM}`);
    console.log(`TOKEN_FEAT_DIM    : ${TOKEN_FEAT_DIM}`);
    console.log(`CARD_VOCAB_SIZE   : ${CARD_VOCAB_SIZE}`);
    console.log(`TAG_COUNT         : ${TAG_COUNT}`);
    console.log(`mid-game turn     : ${state.turnNumber}`);
    console.log(`tokens (me view)  : ${encMe.tokens.length}`);
    console.log(`  masked tokens   : ${maskedMe}`);
    console.log(`tokens (opp view) : ${encOpp.tokens.length}`);
    console.log("========================\n");

    expect(encMe.tokens.length).toBeGreaterThan(0);
  });
  it("神技の使用回数特徴は台帳(effectAccounting)から導出され、使用1回ごとに 1/5 増える", () => {
    const initial = initializeGame({
      decks: [randomDeck(cards), randomDeck(cards)],
      skipPreGame: true,
    });
    const me = initial.playerOrder[0]!;
    const opp = initial.playerOrder[1]!;
    const nexus = (cardNo: string, instanceId: string, owner: string) =>
      createCardInstance(getCardDefinitionById(cardNo)!, {
        instanceId,
        ownerPlayerId: owner,
        controllerPlayerId: owner,
        zone: "field",
        normalCoreCount: 4,
      });
    const base: GameState = {
      ...initial,
      cardInstances: [
        ...initial.cardInstances,
        // 個体枠(ターンに1回)・同名共有枠(ターンに1回:同名)を両プレイヤーで用意する。
        nexus("BSTH04-XX01", "enc-once", me),
        nexus("BSTH08-XX01", "enc-name-me", me),
        nexus("BSTH08-XX01", "enc-name-opp", opp),
      ],
    };
    const seed = (state: GameState, sourceInstanceId: string) =>
      seedDivineSkillUsage(state, {
        sourceInstanceId,
        skillIndex: 0,
        getCardDefinitionById,
      });
    const globalOf = (state: GameState) =>
      encodeState(state, me, getCardDefinitionById).global;
    const changedIndices = (state: GameState) => {
      const before = globalOf(base);
      const after = globalOf(state);
      return after
        .map((value, i) => ({ i, delta: value - before[i]! }))
        .filter(({ delta }) => Math.abs(delta) > 1e-9);
    };

    expect(changedIndices(base)).toEqual([]);
    const one = changedIndices(seed(base, "enc-once"));
    expect(one).toHaveLength(1);
    expect(one[0]!.delta).toBeCloseTo(1 / 5);
    // 個体枠 + 同名共有枠(自分) + 同名共有枠(相手)で合計3回。
    const three = changedIndices(
      seed(seed(seed(base, "enc-once"), "enc-name-me"), "enc-name-opp")
    );
    expect(three).toHaveLength(1);
    expect(three[0]!.i).toBe(one[0]!.i);
    expect(three[0]!.delta).toBeCloseTo(3 / 5);
  });

  it("回数制限の無い神技の宣言も数える (旧 usedDivineSkillKeysThisTurn.length と同じ意味)", () => {
    const initial = initializeGame({
      decks: [randomDeck(cards), randomDeck(cards)],
      skipPreGame: true,
    });
    const me = initial.playerOrder[0]!;
    // BSTH05-X01 の神技[0] は usageLimit を持たない(回数制限なし)。
    const unlimited = createCardInstance(getCardDefinitionById("BSTH05-X01")!, {
      instanceId: "enc-unlimited",
      ownerPlayerId: me,
      controllerPlayerId: me,
      zone: "field",
      normalCoreCount: 4,
    });
    const base: GameState = {
      ...initial,
      cardInstances: [...initial.cardInstances, unlimited],
    };
    const used = seedDivineSkillUsage(base, {
      sourceInstanceId: "enc-unlimited",
      skillIndex: 0,
      times: 2,
      getCardDefinitionById,
    });
    const before = encodeState(base, me, getCardDefinitionById).global;
    const after = encodeState(used, me, getCardDefinitionById).global;
    const deltas = after
      .map((value, i) => ({ i, delta: value - before[i]! }))
      .filter(({ delta }) => Math.abs(delta) > 1e-9);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.delta).toBeCloseTo(2 / 5);
  });
});
