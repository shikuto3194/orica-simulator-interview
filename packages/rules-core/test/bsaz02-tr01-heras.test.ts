/**
 * BSAZ02-TR01(A)「ヘラス」/ TR01(B)「ヘラス-本体変形-」effects[] 検証。
 *
 * 原文 (前面 textLines[2,4,5,7,8,10,11] / 裏面 textLines[2,4,5]):
 *   【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで
 *   置ける。あるとき、以下の効果を得る）
 *   Lv3-Lv4-Lv5『自分のアタックステップ』このアルティメットは相手によって破壊されない。
 *   Lv3-Lv4-Lv5『このアルティメットのアタック/ブロック時』ターンに1回、このアルティメットは
 *   回復できる。そうしたとき、相手のネクサス1つをデッキの下に戻せる。
 *   Lv4-Lv5【転醒：自分のライフ1以上（転醒は同時に使えない）】
 *   このアルティメットは、フラッシュタイミングで裏返せる。
 *   （裏面）Lv3 このアルティメットは、破壊されず、疲労状態でブロックできる。
 *
 * 検証点:
 *  - effects[0]: effect_resistance(destroy, source:opponent_effect) CE 登録
 *    （BSDB01.ts:1263-1281 precedent と同型）。
 *  - effects[1]: recover(self) 成功時のみ (conditional_result) 相手ネクサス1つを
 *    デッキ下へ送る。対象0件時は送還も発生しない。
 *  - effects[2]: rebirth (BSFT01-TR系 precedent と同型)。ライフ1以上で裏返せる。
 *    B面 textLines[0] にカウント増減文言がないため countBonusMode:"none"。
 *    ライフ0では条件不成立で pendingStepOptionalChoice が開かない。
 *  - backFace effects[0]: effect_resistance(destroy) + allow_block_while_exhausted。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { executePlaceTextRoleUnderCard } from "../src/effect/native-under-card-placement-handlers";
import { createStepExecutionContext } from "../src/step-execution-context";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const TR01A = card("BSAZ02-TR01(A)");

function srcTR01(cores: number) {
  const src = createCardInstance(TR01A, {
    instanceId: "src-tr01",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
  return {
    ...src,
    underCards: [
      {
        cardInstanceId: "under-drive",
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

function underFiller() {
  return createCardInstance(card("BSAZ02-M01"), {
    instanceId: "under-drive",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: "src-tr01",
  });
}

function runEffect(
  state: GameState,
  effectIndex: number,
  sourceInstanceId = "src-tr01"
): GameState {
  return executeEffect({
    chainId: "test:bsaz02-tr01-heras:81",
    state,
    effect: TR01A.effects[effectIndex]!,
    effectIndex,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

describe("BSAZ02-TR01(A) effects[0]（Lv3-5『自分のアタックステップ』相手によって破壊されない）", () => {
  it("effect_resistance(destroy, opponent_effect) CE が登録される", () => {
    const src = srcTR01(1); // Lv3
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(state, 0);
    const ce = after.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "cannot_be_destroyed" &&
        c.targetInstanceId === "src-tr01"
    );
    expect(ce).toBeDefined();
  });
});

describe("BSAZ02-TR01(A) effects[1]（Lv3-5アタック/ブロック時: ターンに1回回復、成功時のみ相手ネクサス1つをデッキ下へ）", () => {
  it("回復し、相手ネクサス1つをデッキの下へ送る", () => {
    const src = { ...srcTR01(1), exhaustState: "exhausted" as const };
    const oppNexus = createCardInstance(card("BSAZ02-C09"), {
      instanceId: "opp-nexus",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), oppNexus],
    });
    const bobDeckBefore = state.players.find((p) => p.id === BOB)!.deckCount;

    const afterBody = runEffect(state, 1);
    // 「そうしたとき、〜戻せる」= 送還ステップ自体も独立した optional (pendingStepOptionalChoice)。
    const pending = afterBody.pendingStepOptionalChoice!;
    expect(pending).not.toBeNull();
    const after = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    const oppCard = after.cardInstances.find(
      (c) => c.instanceId === "opp-nexus"
    )!;
    expect(oppCard.zone).toBe("deck");
    const bobAfter = after.players.find((p) => p.id === BOB)!;
    expect(bobAfter.deckCount).toBe(bobDeckBefore + 1);
  });

  it("相手にネクサスが存在しないときは送還が発生しない（回復自体は成立する）", () => {
    const src = srcTR01(1);
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(state, 1);
    // 相手ネクサスが存在しないため何も送還されない (状態に変化なし)。
    expect(after.cardInstances.filter((c) => c.zone === "deck")).toHaveLength(
      0
    );
  });
});

describe("BSAZ02-TR01(A) effects[2]（Lv4-5【転醒：自分のライフ1以上】フラッシュタイミングで裏返せる）", () => {
  it("ライフ1以上のとき、rebirth 許可窓が開き、実行するとカウントを変えずに裏面へ裏返る", () => {
    const src = srcTR01(2); // Lv4
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          countValue: 4,
          voidNormalCoreCount: 9,
          protectedCounts: { 火星: 2 },
        },
        {},
      ],
    });
    const rebirth = TR01A.effects[2]!.steps.find(
      (s) => s.action.kind === "rebirth"
    )!.action;
    expect(rebirth.kind).toBe("rebirth");
    if (rebirth.kind === "rebirth") {
      expect(rebirth.countBonusMode).toBe("none");
    }

    const afterBody = runEffect(state, 2);
    expect(afterBody.pendingStepOptionalChoice).toBeNull();
    const afterExecute = afterBody;

    const flipped = afterExecute.cardInstances.find(
      (c) => c.instanceId === "src-tr01"
    )!;
    expect(flipped.definitionId).toBe("BSAZ02-TR01(B)");
    const alice = afterExecute.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(4);
    expect(alice.voidNormalCoreCount).toBe(9);
    expect(alice.protectedCounts).toEqual({ 火星: 2 });
  });

  it("ライフ0のときは転醒条件を満たさず、rebirth 許可窓が開かない", () => {
    const src = srcTR01(2); // Lv4
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
      playerOverrides: [{ lifeNormalCoreCount: 0 }, {}],
    });

    const afterBody = runEffect(state, 2);
    expect(afterBody.pendingStepOptionalChoice).toBeNull();
    const still = afterBody.cardInstances.find(
      (c) => c.instanceId === "src-tr01"
    )!;
    expect(still.definitionId).toBe("BSAZ02-TR01(A)");
  });
});

describe("BSAZ02-TR01(B) effects[0]（Lv3: 破壊されず、疲労状態でブロックできる）", () => {
  const TR01B = card("BSAZ02-TR01(B)");
  const C10 = card("BSAZ02-C10");

  function runBackFaceEffect(state: GameState): GameState {
    return executeEffect({
      chainId: "test:bsaz02-tr01-heras:228",
      state,
      effect: TR01B.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "src-tr01b",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
  }

  it("effect_resistance(destroy) と allow_block_while_exhausted の両方が登録される", () => {
    const src = createCardInstance(TR01B, {
      instanceId: "src-tr01b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const withUnder = {
      ...src,
      underCards: [
        {
          cardInstanceId: "under-drive-b",
          role: "text_role" as const,
          roleTag: "アルドノアドライブ",
        },
      ],
    };
    const under = createCardInstance(card("BSAZ02-M01"), {
      instanceId: "under-drive-b",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "src-tr01b",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [withUnder, under],
    });

    const after = runBackFaceEffect(state);
    const resistCe = after.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "cannot_be_destroyed" &&
        c.targetInstanceId === "src-tr01b"
    );
    expect(resistCe).toBeDefined();
    const blockCe = after.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "allow_block_while_exhausted" &&
        c.targetInstanceId === "src-tr01b"
    );
    expect(blockCe).toBeDefined();
  });

  it("BSAZ02-TR01(B) aldnoah-drive-under-card-slot-capacity: 転醒後もC10を1枚まで配置し、ドライブ下の継続効果を盤面へ登録する", () => {
    // B面のキーワード宣言は、前面からの残存状態ではなく B面定義そのものが host 枠を
    // 持つことで、C10 の summon/place/rebirth 観測トリガーの対象になる。
    expect(TR01B.underCardSlots).toEqual([
      { roleTag: "アルドノアドライブ", maxCount: 1 },
    ]);
    const placeAction = C10.effects!.flatMap((effect) => effect.steps)
      .map((step) => step.action)
      .find((action) => action.kind === "place_text_role_under_card");
    expect(placeAction?.kind).toBe("place_text_role_under_card");
    if (placeAction?.kind !== "place_text_role_under_card") {
      throw new Error("BSAZ02-C10 placement action is missing");
    }

    const host = createCardInstance(TR01B, {
      instanceId: "src-tr01b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const drive = createCardInstance(C10, {
      instanceId: "drive-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const overflowDrive = createCardInstance(C10, {
      instanceId: "drive-overflow-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, drive, overflowDrive],
      playerOverrides: [{ handCount: 2 }, {}],
    });
    const stepContext = createStepExecutionContext(state);
    stepContext.triggerRelatedInstanceId = host.instanceId;
    const afterPlacement = executePlaceTextRoleUnderCard(
      placeAction,
      state,
      ALICE,
      drive.instanceId,
      getDef,
      stepContext
    );

    const placedDrive = afterPlacement.cardInstances.find(
      (c) => c.instanceId === drive.instanceId
    )!;
    expect(placedDrive.zone).toBe("field");
    expect(placedDrive.attachedToInstanceId).toBe(host.instanceId);
    expect(
      afterPlacement.cardInstances
        .find((c) => c.instanceId === host.instanceId)!
        .underCards.some(
          (under) =>
            under.cardInstanceId === drive.instanceId &&
            under.roleTag === "アルドノアドライブ"
        )
    ).toBe(true);

    // 【アルドノアドライブ：1】の上限は、1枚目を配置できるだけでなく、2枚目を
    // 同じ B 面 host の下へ置けないことまで盤面で検証する。no-op のため手札枚数も
    // 1枚目配置後の値から変わらない。
    const overflowContext = createStepExecutionContext(afterPlacement);
    overflowContext.triggerRelatedInstanceId = host.instanceId;
    const afterOverflow = executePlaceTextRoleUnderCard(
      placeAction,
      afterPlacement,
      ALICE,
      overflowDrive.instanceId,
      getDef,
      overflowContext
    );
    const rejectedDrive = afterOverflow.cardInstances.find(
      (c) => c.instanceId === overflowDrive.instanceId
    )!;
    expect(rejectedDrive.zone).toBe("hand");
    expect(rejectedDrive.attachedToInstanceId).toBeNull();
    expect(
      afterOverflow.cardInstances.find((c) => c.instanceId === host.instanceId)!
        .underCards
    ).toHaveLength(1);
    expect(afterOverflow.players.find((p) => p.id === ALICE)!.handCount).toBe(
      1
    );

    const afterEffect = runBackFaceEffect(afterOverflow);
    expect(
      afterEffect.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "cannot_be_destroyed" &&
          effect.targetInstanceId === host.instanceId
      )
    ).toBe(true);
    expect(
      afterEffect.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "allow_block_while_exhausted" &&
          effect.targetInstanceId === host.instanceId
      )
    ).toBe(true);
  });
});
