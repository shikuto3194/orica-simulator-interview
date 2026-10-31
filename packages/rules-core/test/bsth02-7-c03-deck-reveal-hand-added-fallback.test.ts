import { acceptOptionalSteps } from "./crossover-fidelity-test-helpers";
/**
 * BSTH02.7-C03「輪廻の西蔵人形」effects[0] shape 検証。
 *
 * 原文: 「自分はデッキの上から3枚オープンできる。その中のマジックカード1枚を手札に
 * 加えられる。残ったカードは破棄する。その後、手札に加えなかったとき、
 * 〔ステップに1回:同名〕トラッシュにある系統：「導魔」/「動玩」/「四道」/「楽族」を持つ
 * 黄1色のスピリットカード/ネクサスカード1枚を手札に戻せる。」
 *
 * deck_reveal の pick は pendingDeckReveal 経由の非同期選択になるため、初回同期実行時点
 * では「手札に加わったか」が未確定。ENGINE-deck-reveal-hand-added-tracking primitive
 * (StepResult.handAddedCardInstanceIds + ref_count(result:"hand_added") +
 * PendingDeckReveal.continuation) が、pending 解決完了時点で該当 StepResult を
 * 事後確定させ、後続 step の発揮可否をゲートする。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const noTriggeredLookup = () => [];

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

describe("BSTH02.7-C03 輪廻の西蔵人形 effects[0]: デッキオープン→手札加算/トラッシュ帰還", () => {
  const c = card("BSTH02.7-C03");
  const effect = c.effects![0]!;

  it("stub 解消済み・steps[1] = ref_count(hand_added,max:0) ゲート付き move_card", () => {
    expect(effect.stub).toBeUndefined();
    // 「オープンできる」から effect 全体は任意。ただし発揮を選んだ後の公開は
    // 強制であり、先頭 step を辞退して後段だけを発揮することはできない。
    expect(effect.executionMode).toBe("optional");
    expect(effect.steps).toHaveLength(2);
    expect(effect.steps![0]!.id).toBe("reveal");
    expect(effect.steps![0]!.executionMode).toBeUndefined();
    const fallback = effect.steps![1]!;
    expect(fallback.stepCondition).toEqual({
      kind: "ref_count",
      stepId: "reveal",
      result: "hand_added",
      min: 0,
      max: 0,
    });
    expect(fallback.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "step",
    });
    expect(fallback.executionMode).toBe("optional");
    expect(fallback.action.kind).toBe("move_card");
  });

  function baseState(): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    // トラッシュの帰還候補: 自身と同名 (colors:yellow mono, tribe 幻想・動玩 一致)
    const trashCandidate = createCardInstance(c, {
      instanceId: "trash-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    // デッキ上3枚: 1枚 magic (pick 対象。BSAZ01-C05: 未実装 stub のみで
    // moved_to_trash 系の自己配置トリガーを持たないため、トラッシュ帰還フォールバックの
    // 検証に無関係な副作用が出ない), 2枚 filler (非magic・指定系統なし)
    const magicPick = createCardInstance(card("BSAZ01-C05"), {
      instanceId: "magic-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const fillers = ["f1", "f2"].map((id) =>
      createCardInstance(card("BSAZ01-C01"), {
        instanceId: id,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, trashCandidate, magicPick, ...fillers],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 3 } : p
      ),
    };
  }

  it("【盤面】公開は強制で、マジックを取らず回収を実行すると候補1枚は自動確定する", () => {
    let state = executeEffect({
      chainId: "test:bsth02-7-c03-deck-reveal-hand-added-fallback:111",
      state: baseState(),
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    // effect-level の「発揮する」を選んだ後なので、先頭の deck_reveal に
    // execute/decline の step-level prompt は生じない。
    expect(state.pendingStepOptionalChoice).toBeNull();
    expect(state.pendingDeckReveal?.phase).toBe("picking");
    const pickAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    expect(pickAction).toBeDefined();
    state = applyLegalAction({
      state,
      action: pickAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      selectedDeckRevealCardIds: [],
    }).state;
    expect(state.pendingStepOptionalChoice?.stepIndex).toBe(1);
    state = chooseRecovery(state, "execute");
    expect(state.pendingStepOptionalTargetSelection).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "trash-1")?.zone
    ).toBe("hand");
    // 公開を発揮したので、選ばなかった公開カードは原文どおり破棄される。
    for (const id of ["magic-1", "f1", "f2"]) {
      expect(state.cardInstances.find((c) => c.instanceId === id)?.zone).toBe(
        "trash"
      );
    }
    expect(state.pendingStepOptionalChoice).toBeNull();
    expect(state.pendingStepOptionalTargetSelection).toBeNull();
  });

  function revealTwoCandidates(): GameState {
    const initial = baseState();
    let state = executeEffect({
      chainId: "test:c03-two-trash-candidates",
      state: {
        ...initial,
        cardInstances: [
          initial.cardInstances.find(
            (instance) => instance.instanceId === "src-1"
          )!,
          ...["BSTH02.7-C03", "BSTH02.7-R01", "BSTH02.7-C06"].map((no, index) =>
            createCardInstance(card(no), {
              instanceId: `revealed-${index}`,
              ownerPlayerId: "alice",
              zone: "deck",
            })
          ),
        ],
      },
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const pick = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    if (!pick) throw new Error("missing deck reveal pick");
    state = applyLegalAction({
      state,
      action: pick,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      selectedDeckRevealCardIds: [],
    }).state;
    expect(state.pendingStepOptionalChoice?.stepIndex).toBe(1);
    return state;
  }

  function chooseRecovery(
    state: GameState,
    choice: "execute" | "decline"
  ): GameState {
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === choice
    );
    if (!action) throw new Error(`missing optional recovery ${choice}`);
    return applyLegalAction({
      state,
      action,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    }).state;
  }

  it.each(["revealed-1", "revealed-0"])(
    "【盤面】実行後は候補2枚からちょうど1枚を選び、%sだけを回収する",
    (selectedId) => {
      let state = chooseRecovery(revealTwoCandidates(), "execute");
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(state.pendingStepOptionalTargetSelection).toMatchObject({
        candidateInstanceIds: ["revealed-0", "revealed-1"],
        requiredTargetCount: 1,
        maxTargetCount: 1,
      });
      for (const id of ["revealed-0", "revealed-1", "revealed-2"]) {
        expect(
          state.cardInstances.find((instance) => instance.instanceId === id)
            ?.zone
        ).toBe("trash");
      }
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById,
      }).find(
        (action) =>
          action.kind === "resolve_pending_step_optional_target_selection"
      );
      if (!action) throw new Error("missing recovery target selection");
      for (const targetInstanceIds of [
        [],
        ["revealed-2"],
        ["revealed-0", "revealed-1"],
      ]) {
        expect(() =>
          applyLegalAction({
            state,
            action,
            getCardDefinitionById,
            getRegisteredTriggeredEffectActions: noTriggeredLookup,
            targetInstanceIds,
          })
        ).toThrow();
      }
      state = applyLegalAction({
        state,
        action,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggeredLookup,
        targetInstanceIds: [selectedId],
      }).state;
      expect(state.pendingStepOptionalTargetSelection).toBeNull();
      expect(state.pendingStepOptionalChoice).toBeNull();
      expect(state.pendingDeckReveal).toBeNull();
      for (const id of ["revealed-0", "revealed-1", "revealed-2"]) {
        expect(
          state.cardInstances.find((instance) => instance.instanceId === id)
            ?.zone
        ).toBe(id === selectedId ? "hand" : "trash");
      }
    }
  );

  it("【盤面】回収を辞退すると候補2枚とマジックはトラッシュに残る", () => {
    const state = chooseRecovery(revealTwoCandidates(), "decline");
    expect(state.pendingStepOptionalChoice).toBeNull();
    expect(state.pendingStepOptionalTargetSelection).toBeNull();
    expect(state.pendingDeckReveal).toBeNull();
    for (const id of ["revealed-0", "revealed-1", "revealed-2"]) {
      expect(
        state.cardInstances.find((instance) => instance.instanceId === id)?.zone
      ).toBe("trash");
    }
  });

  it("マジックを手札に加えたとき: hand_added>0 でトラッシュ帰還は発揮しない", () => {
    const state = baseState();
    const afterReveal = acceptOptionalSteps(
      executeEffect({
        chainId: "test:bsth02-7-c03-deck-reveal-hand-added-fallback:152",
        state,
        effect,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      }),
      getCardDefinitionById
    );
    expect(afterReveal.pendingDeckReveal).not.toBeNull();
    expect(afterReveal.pendingDeckReveal!.phase).toBe("picking");
    // continuation が resumeStepIndex=1, recordStepId="reveal" で注入されている
    expect(afterReveal.pendingDeckReveal!.continuation).toBeDefined();
    expect(afterReveal.pendingDeckReveal!.continuation!.resumeStepIndex).toBe(
      1
    );
    expect(afterReveal.pendingDeckReveal!.continuation!.recordStepId).toBe(
      "reveal"
    );

    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();

    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pickAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      selectedDeckRevealCardIds: ["magic-1"],
    }).state;

    expect(afterPick.pendingDeckReveal).toBeNull();
    expect(
      afterPick.cardInstances.find((x) => x.instanceId === "magic-1")!.zone
    ).toBe("hand");
    for (const id of ["f1", "f2"]) {
      expect(
        afterPick.cardInstances.find((x) => x.instanceId === id)!.zone
      ).toBe("trash");
    }
    // 手札に加わった (hand_added=1) ので、トラッシュ帰還 step は発揮できない
    // (optional 選択待ちも立たず、帰還候補もトラッシュのまま)
    expect(afterPick.pendingStepOptionalChoice).toBeNull();
    expect(afterPick.pendingStepOptionalTargetSelection).toBeNull();
    expect(
      afterPick.cardInstances.find((x) => x.instanceId === "trash-1")!.zone
    ).toBe("trash");
  });

  it("【盤面】同名の別個体では、同じ step 中にトラッシュ帰還を2回発揮できない", () => {
    const secondSource = createCardInstance(c, {
      instanceId: "src-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const secondTrashCandidate = createCardInstance(c, {
      instanceId: "trash-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const secondReveal = ["magic-2", "f3", "f4"].map((instanceId, index) =>
      createCardInstance(
        index === 0 ? card("BSAZ01-C05") : card("BSAZ01-C01"),
        {
          instanceId,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "deck",
        }
      )
    );
    const initial = baseState();
    let state: GameState = {
      ...initial,
      cardInstances: [
        ...initial.cardInstances,
        secondSource,
        secondTrashCandidate,
        ...secondReveal,
      ],
      players: initial.players.map((player) =>
        player.id === "alice" ? { ...player, deckCount: 6 } : player
      ),
    };

    state = executeEffect({
      chainId: "test:bsth02-7-c03-deck-reveal-hand-added-fallback:242",
      state,
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const firstPick = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    if (!firstPick) throw new Error("missing first deck reveal pick");
    state = applyLegalAction({
      state,
      action: firstPick,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      selectedDeckRevealCardIds: [],
    }).state;
    state = acceptOptionalSteps(state, getCardDefinitionById);
    expect(
      state.cardInstances.find((instance) => instance.instanceId === "trash-1")
        ?.zone
    ).toBe("hand");

    state = executeEffect({
      chainId: "test:bsth02-7-c03-deck-reveal-hand-added-fallback:268",
      state,
      effect,
      sourceInstanceId: "src-2",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const secondPick = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    if (!secondPick) throw new Error("missing second deck reveal pick");
    state = applyLegalAction({
      state,
      action: secondPick,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      selectedDeckRevealCardIds: [],
    }).state;
    state = acceptOptionalSteps(state, getCardDefinitionById);

    // 2回目も公開と破棄は完走するが、同名 step 制限により帰還は発生しない。
    expect(
      state.cardInstances.find((instance) => instance.instanceId === "trash-2")
        ?.zone
    ).toBe("trash");
    for (const id of ["magic-2", "f3", "f4"]) {
      expect(
        state.cardInstances.find((instance) => instance.instanceId === id)?.zone
      ).toBe("trash");
    }
  });

  it("【盤面】手札増加禁止中は公開だけを行い、pick とトラッシュからの手札戻しの両方を行わない", () => {
    const handGainPrevention: ContinuousEffect = {
      effectId: "test-hand-gain-prevention-c03",
      sourceInstanceId: "prevention-source",
      sourceDefinitionId: "BSRK01-X01",
      actingPlayerId: "alice",
      duration: { scope: "turn", whose: "self" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "hand_gain_prevention",
      targetInstanceId: "alice",
    };
    let state = executeEffect({
      chainId: "test:bsth02-7-c03-deck-reveal-hand-added-fallback:314",
      state: {
        ...baseState(),
        activeContinuousEffects: [handGainPrevention],
      },
      effect,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const pickAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    if (!pickAction || pickAction.kind !== "resolve_pending_deck_reveal_pick") {
      throw new Error("missing deck reveal pick action");
    }
    // Q12304: オープン自体は行うが、手札へ加える選択肢は存在しない。
    expect(pickAction.candidateCardInstanceIds).toEqual([]);
    state = applyLegalAction({
      state,
      action: pickAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      selectedDeckRevealCardIds: [],
    }).state;
    // 対象付き move_card も共通の手札増加禁止を通り、実行は提示されない。
    expect(state.pendingStepOptionalChoice).toMatchObject({
      canExecute: false,
      canDecline: true,
    });
    expect(
      getLegalActions({ state, actingPlayerId: "alice", getCardDefinitionById })
        .filter(
          (action) => action.kind === "resolve_pending_step_optional_choice"
        )
        .map((action) => action.choice)
    ).toEqual(["decline"]);
    state = chooseRecovery(state, "decline");
    expect(state.pendingStepOptionalChoice).toBeNull();
    expect(state.pendingStepOptionalTargetSelection).toBeNull();
    expect(
      state.cardInstances.find((card) => card.instanceId === "trash-1")?.zone
    ).toBe("trash");
    for (const id of ["magic-1", "f1", "f2"]) {
      expect(
        state.cardInstances.find((card) => card.instanceId === id)?.zone
      ).toBe("trash");
    }
  });
});
