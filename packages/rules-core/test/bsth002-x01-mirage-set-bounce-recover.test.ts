/**
 * BSTH002-X01「里香(EX)＆イビルアイΣ」effects[0] (旧 stub, textRef:[3,4]) 検証。
 *
 * カード本文:
 * Lv1-Lv2-Lv3『このスピリットのアタック時』
 * 自分の手札にあるミラージュ効果を持つ白/紫のカード1枚をコストを支払わずにセットする
 * ことで、相手のスピリット/アルティメット2体までをデッキの下に戻し、ターンに1回、
 * このスピリットは回復できる。この効果は白以外の効果では防げない。
 *
 * 実装:
 * - ENGINE-mirage-set-target-primitive: `set_self_as_mirage` に `target` (TargetSpec) を
 *   追加し、発揮元カード以外（手札から選んだ別カード）を対象にできるよう一般化。
 *   `CardFilter.hasMirageData` を新設し「ミラージュ効果を持つ」対象を絞り込む。
 * - 選択(noop, count:{min:0,max:1})→無償セット(set_self_as_mirage)→
 *   `stepCondition:{kind:"ref_executed"}` でコスト成立をゲートし、デッキ下送り(send_to_deck)/
 *   回復(recover, usageLimit:per_instance/turn)を続ける「プレ判断モデル」。
 * - 「白以外の効果では防げない」= `preventionRestriction.onlyPreventableByColors:["white"]`
 *   + `colorMatchMode:"exact"` から scoped targetLockBypass を導出する
 *   （白1色の防止効果だけは通す）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);

const X01 = cardNoMap.get("BSTH002-X01")!;
// 白色・mirageData 保有の既存カード（BSTH002-R02「ふらわ～戦車」【ミラージュ：コスト3<白><紫>】）。
const MIRAGE_ELIGIBLE = cardNoMap.get("BSTH002-R02")!;
// mirageData を持たない白スピリット（候補から除外されることの確認用）。
const NON_MIRAGE_SPIRIT = X01;
const OPPONENT_SPIRIT = cardNoMap.get("BSTH002-R03")!;

const ALICE = "alice";
const BOB = "bob";

function findCard(state: GameState, instanceId: string) {
  return state.cardInstances.find((c) => c.instanceId === instanceId)!;
}

function buildBaseState(handCardId: string | null): GameState {
  const hostCard = createCardInstance(X01, {
    instanceId: "host-x01",
    ownerPlayerId: ALICE,
    zone: "field",
    exhaustState: "exhausted",
  });
  const opponent1 = createCardInstance(OPPONENT_SPIRIT, {
    instanceId: "bob-spirit-1",
    ownerPlayerId: BOB,
    zone: "field",
  });
  const opponent2 = createCardInstance(OPPONENT_SPIRIT, {
    instanceId: "bob-spirit-2",
    ownerPlayerId: BOB,
    zone: "field",
  });
  const opponent3 = createCardInstance(OPPONENT_SPIRIT, {
    instanceId: "bob-spirit-3",
    ownerPlayerId: BOB,
    zone: "field",
  });
  const cardInstances = [hostCard, opponent1, opponent2, opponent3];
  if (handCardId === "mirage") {
    cardInstances.push(
      createCardInstance(MIRAGE_ELIGIBLE, {
        instanceId: "hand-mirage-candidate",
        ownerPlayerId: ALICE,
        zone: "hand",
      })
    );
  } else if (handCardId === "non_mirage") {
    cardInstances.push(
      createCardInstance(NON_MIRAGE_SPIRIT, {
        instanceId: "hand-non-mirage",
        ownerPlayerId: ALICE,
        zone: "hand",
      })
    );
  }
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances,
  });
}

function executeX01Attack(
  state: GameState,
  handMirageInstanceId: string,
  opponentTargetInstanceIds: string[]
): GameState {
  return executeEffect({
    chainId: "test:bsth002-x01-mirage-set-bounce-recover:105",
    state,
    effect: X01.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "host-x01",
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    targetInstanceIds: [handMirageInstanceId, ...opponentTargetInstanceIds],
    targetGroups: [
      {
        targetStepId: "selectMirage",
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateTargetInstanceIds: [handMirageInstanceId],
        candidateTargetZones: ["hand"],
      },
      {
        targetStepId: "rika-ex-bottom-deck-targets",
        requiredTargetCount: 0,
        maxTargetCount: 2,
        candidateTargetInstanceIds: opponentTargetInstanceIds,
        candidateTargetZones: ["field"],
      },
    ],
  });
}

function resolveRecoverChoice(state: GameState): GameState {
  const pending = state.pendingStepOptionalChoice;
  expect(pending).not.toBeNull();
  return applyLegalAction({
    state,
    action: {
      kind: "resolve_pending_step_optional_choice",
      actionId: `pso-${pending!.pendingId}:execute`,
      can: true,
      reason: "test",
      actingPlayerId: pending!.actingPlayerId,
      pendingId: pending!.pendingId,
      sourceInstanceId: pending!.sourceInstanceId,
      effectIndex: pending!.effectIndex,
      stepIndex: pending!.stepIndex,
      choice: "execute",
    },
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  }).state;
}

describe("BSTH002-X01 effects[0] (アタック時 mirage無償セット→相手2体までデッキ下＋ターン1回回復)", () => {
  it("stub 解消済み", () => {
    expect(X01.effects![0]!.stub).toBeUndefined();
  });

  it("手札にミラージュ効果を持つ白/紫のカードが無いとき: 選択0件で不発（デッキ下送り/回復とも起きない）", () => {
    const base = buildBaseState("non_mirage");
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth002-x01-mirage-set-bounce-recover:163",
        state: base,
        effect: X01.effects![0]!,
        effectIndex: 0,
        sourceInstanceId: "host-x01",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        rangeAutoResolveStrategy: "max",
      }),
      getCardDefinitionById
    );

    // 手札のカードはそのまま（mirage セットされていない）。
    expect(findCard(after, "hand-non-mirage")).toMatchObject({ zone: "hand" });
    expect(after.mirageSetStates.some((s) => s.playerId === ALICE)).toBe(false);
    // 相手2体はフィールドのまま（デッキ下に送られていない）。
    expect(findCard(after, "bob-spirit-1")).toMatchObject({ zone: "field" });
    expect(findCard(after, "bob-spirit-2")).toMatchObject({ zone: "field" });
    // 自身は回復していない（exhausted のまま）。
    expect(findCard(after, "host-x01")).toMatchObject({
      exhaustState: "exhausted",
    });
  });

  it("手札のミラージュ対象カードをコストなしセット→相手2体をデッキ下へ＋自身回復（ターン1回）", () => {
    const base = buildBaseState("mirage");
    const after = flushPendingLeaves(
      resolveRecoverChoice(
        executeX01Attack(base, "hand-mirage-candidate", [
          "bob-spirit-1",
          "bob-spirit-2",
        ])
      ),
      getCardDefinitionById
    );

    // 手札のミラージュ候補がコストなしでミラージュゾーンへセットされた。
    expect(findCard(after, "hand-mirage-candidate")).toMatchObject({
      zone: "mirage",
    });
    expect(after.mirageSetStates).toContainEqual({
      playerId: ALICE,
      cardInstanceId: "hand-mirage-candidate",
    });
    // 相手のスピリット2体がデッキの下に戻された。
    expect(findCard(after, "bob-spirit-1")).toMatchObject({ zone: "deck" });
    expect(findCard(after, "bob-spirit-2")).toMatchObject({ zone: "deck" });
    // 自身が回復した。
    expect(findCard(after, "host-x01")).toMatchObject({
      exhaustState: "recovered",
    });
  });
});
