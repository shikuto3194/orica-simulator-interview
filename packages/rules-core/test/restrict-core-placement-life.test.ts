/**
 * ライフコア配置制限 — restrict_core_placement_life CE の検証。
 *
 * プリミティブ:
 *  - restrict_core_placement player:"either" → 両プレイヤーのライフを、コア移動先 (core_move
 *    to:{kind:"life"}) として封じる player-scoped CE を 1 個ずつ登録。prevent_deck_discard と
 *    同型。消費側 (executeCoreMove) が to.kind==="life" のとき移動先プレイヤーの保護を照会し、
 *    保護されていれば発動者不問で全面ブロックする（原因不問、破壊されない型と同種）。
 *  - duration: { scope: "step", step: "start", whose: "self" } = 「次の自分のスタートステップ
 *    まで」(汎用 Duration 機構。expiry 自体は continuous-effect-duration.test.ts で別途検証済み)。
 *  - 「BP+3000する。または、ライフにコアを置けない」の二択は、既存の choice DSL 規約
 *    (BSTH02.7-C05 effects[2] / BSSG01-R01 と同型) に従い、base action (bp_modify) +
 *    choice[0] (restrict_core_placement) を同一 EffectStep 内に持たせて表現する
 *    (BSTH02.7-C05 004e8dd4 前例)。
 *
 * ルール正源: カード本文「このターンの間、スピリット/アルティメット1体をBP+3000する。または、
 * 次の自分のスタートステップまで、お互い、ライフにコアを置けない。」(BSTH02.7-C01 effects[1])。
 *
 * 解禁カード:
 *  - BSTH02.7-C01 [1] フラッシュ二択: BP+3000 OR 次の自分のスタートステップまでお互いライフに
 *    コアを置けない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import type { Effect } from "../src/dsl-types";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

function runEffect(
  state: GameState,
  effect: Effect,
  sourceInstanceId = "src",
  actingPlayerId = ALICE,
  choiceIndex?: number
): GameState {
  return executeEffect({
    chainId: "test:restrict-core-placement-life:51",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    ...(choiceIndex !== undefined ? { choiceIndex } : {}),
  });
}

function lifeCores(state: GameState, playerId: string): number {
  return state.players.find((p) => p.id === playerId)!.lifeNormalCoreCount;
}

const coreMoveToLife = (
  player: "self" | "opponent",
  amount: number
): Effect => ({
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "reserve", player },
        to: { kind: "life", player },
        amount,
      },
    },
  ],
});

function setupBoard(): { state: GameState } {
  const state = createEmptyGameState({
    playerOverrides: [
      { reserveNormalCoreCount: 5, lifeNormalCoreCount: 3 },
      { reserveNormalCoreCount: 5, lifeNormalCoreCount: 3 },
    ],
  });
  return { state };
}

describe("restrict_core_placement_life (BSTH02.7-C01 「BP+3000する。または、次の自分のスタートステップまで、お互い、ライフにコアを置けない」)", () => {
  it("[card] BSTH02.7-C01 effects[1] は base=bp_modify + choice[0]=restrict_core_placement(either) の二択を持つ", () => {
    const def = card("BSTH02.7-C01");
    const eff = def.effects?.[1];
    expect(eff).toBeDefined();
    expect(eff!.stub).toBeUndefined();
    expect(def.effects?.length).toBe(3);
    const step = eff!.steps[0]!;
    expect(step.action.kind).toBe("bp_modify");
    expect(step.choice).toHaveLength(1);
    const choiceAction = step.choice![0]!.action;
    expect(choiceAction.kind).toBe("restrict_core_placement");
    if (choiceAction.kind === "restrict_core_placement") {
      expect(choiceAction.player).toBe("either");
      expect(choiceAction.duration).toEqual({
        scope: "step",
        step: "start",
        whose: "self",
      });
    }
  });

  it("[board] choice[0] (ライフコア配置制限) 選択後は自分・相手どちらもライフにコアを置けない", () => {
    const board = setupBoard();
    let state = board.state;

    state = runEffect(
      state,
      card("BSTH02.7-C01").effects![1]!,
      "c01-src",
      ALICE,
      1
    );

    state = runEffect(state, coreMoveToLife("self", 2), "c01-src", ALICE);
    expect(lifeCores(state, ALICE)).toBe(3);

    state = runEffect(state, coreMoveToLife("opponent", 2), "c01-src", ALICE);
    expect(lifeCores(state, BOB)).toBe(3);
  });

  it("[board] base action (BP+3000) 選択時はライフコア配置制限が掛からない", () => {
    const board = setupBoard();
    let state = board.state;
    state = runEffect(
      state,
      card("BSTH02.7-C01").effects![1]!,
      "c01-src",
      ALICE,
      0
    );
    state = runEffect(state, coreMoveToLife("self", 2), "c01-src", ALICE);
    expect(lifeCores(state, ALICE)).toBe(5);
  });

  it("[board] 保護が無ければライフへのコア配置は通常どおり成立する（リグレッション）", () => {
    const board = setupBoard();
    let state = board.state;
    state = runEffect(state, coreMoveToLife("self", 2), "c01-src", ALICE);
    expect(lifeCores(state, ALICE)).toBe(5);
  });

  it("[board] ライフ以外の行き先 (トラッシュ) へのコア移動は止めない", () => {
    const board = setupBoard();
    let state = board.state;
    state = runEffect(
      state,
      card("BSTH02.7-C01").effects![1]!,
      "c01-src",
      ALICE,
      1
    );

    const toTrash: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "reserve", player: "self" },
            to: { kind: "trash", player: "self" },
            amount: 2,
          },
        },
      ],
    };
    state = runEffect(state, toTrash, "c01-src", ALICE);
    expect(
      state.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(3);
    expect(
      state.players.find((p) => p.id === ALICE)!.trashNormalCoreCount
    ).toBe(2);
  });
});
