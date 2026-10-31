import { acceptOptionalSteps } from "./crossover-fidelity-test-helpers";
/**
 * BSAZ02-C11「スレイン・トロイヤード」effects[0,1,2,3] 検証。
 *
 * 原文 (textLines[0]):
 *   スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず、自分の系統：「火星」を
 *   持つアルティメット/ネクサスがあるとき、相手によってフィールドを離れない。
 * 原文 (textLines[2,3]):
 *   Lv1『自分のメインステップ』〔ゲームに1回：同名〕自分のデッキを上から7枚破棄できる。
 *   その中の系統：「火星」を持つ導界者ネクサスカード2枚までをコストを支払わずに配置できる。
 * 原文 (textLines[6,7]):
 *   【合体条件：火星＆スピリット/アルティメット】【アルティメット合体中】
 *   自分が系統：「火星」と「ＣＦ」を持つアルティメットカードを召喚するとき、召喚条件を
 *   無視して召喚できる。
 *
 * 検証点:
 *  - effects[0]: スピリット状態 (combined:false) の疲労耐性 + アタック/ブロック不可
 *    (BSAZ02-C10/C12 precedent 同型)。
 *  - effects[1]: 火星アルティメット/ネクサス存在時のみ leave_field 耐性 (source:opponent)。
 *    continuous 効果の condition は effect-level のみ live 再評価される
 *    (continuous-effect-rebuild.ts:1236) ため、effects[0] とは別 continuous 効果に分割。
 *  - effects[2]: デッキ7枚を破棄し、その中から導界者ネクサス2枚までコスト不要配置。
 *  - effects[3]: 新設 allow_ignore_summon_condition CE (engine-summon-condition-ignore-grant)。
 *    combined:true ゲートで登録され、canSummonUltimate が
 *    hasIgnoreSummonConditionGrant 経由でバイパスすることを確認する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { canSummonUltimate } from "../src/legal/legal-actions-shared";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";
const C11 = card("BSAZ02-C11");
// 火星系統を持つアルティメット (effects[1] の field_has 条件用フィクスチャ)。
// tribe:"火星・ＣＦ・アルドノア" のため effects[3] の allow_ignore_summon_condition
// フィルタ(火星&ＣＦ)にも一致し、summonCondition (「ＣＦ」アルティメット0体) も持つ。
const MARS_ULTIMATE = card("BSAZ02-C01");
// 系統：「火星」「導界者」を持つネクサス (effects[2] pick フィルタ一致フィクスチャ)。
const MARS_GRANDWALKER_NEXUS = card("BSAZ02-X04");
// pick フィルタに一致しない汎用フィラー (デッキの残り枚数埋め用)。
const FILLER = card("BSAZ02-M01");
// printedCategory:"spirit" のホストフィクスチャ (effects[3] の combined_host_category
// ゲート検証用。braveCondition の categories:["spirit","ultimate"] はスピリット合体も許すが、
// 見出しラベル【アルティメット合体中】はホストが category:ultimate のときのみ適用される)。
const MARS_SPIRIT = card("BSAZ02-C06");
const noTriggerLookup = () => [];

function buildState(
  cardInstances: GameState["cardInstances"],
  overrides?: Partial<GameState>
): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, "bob"] }),
    activePlayerId: ALICE,
    step: "main",
    cardInstances,
    ...overrides,
  };
}

describe("BSAZ02-C11 effects[0]（スピリット状態: 疲労せずアタック/ブロック不可）", () => {
  it("非合体で prevent_battle_both + cannot_be_exhausted CE が自身に登録される", () => {
    const state = buildState([
      createCardInstance(C11, {
        instanceId: "c11-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const pb = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c11-1" &&
        ce.modifierTag === "prevent_battle_both"
    );
    expect(pb).toHaveLength(1);
    expect((pb[0]!.metadata as { ruleStrength?: boolean }).ruleStrength).toBe(
      true
    );
    const exhaustResist = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c11-1" &&
        ce.modifierTag === "cannot_be_exhausted"
    );
    expect(exhaustResist).toHaveLength(1);
    expect(
      (exhaustResist[0]!.metadata as { ruleStrength?: boolean }).ruleStrength
    ).toBe(true);
  });

  it("合体中(host へ attach 済み)は combined:false ゲートにより CE が登録されない", () => {
    const state = buildState([
      createCardInstance(MARS_ULTIMATE, {
        instanceId: "host-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedChildrenIds: ["c11-1"],
        normalCoreCount: 1,
      }),
      createCardInstance(C11, {
        instanceId: "c11-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "host-1",
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const pb = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c11-1" &&
        ce.modifierTag === "prevent_battle_both"
    );
    expect(pb).toHaveLength(0);
    const exhaustResist = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c11-1" &&
        ce.modifierTag === "cannot_be_exhausted"
    );
    expect(exhaustResist).toHaveLength(0);
  });
});

describe("BSAZ02-C11 effects[1]（火星アルティメット/ネクサス存在時のみ相手によって離脱しない）", () => {
  it("火星アルティメット/ネクサスが存在しないとき cannot_leave_field CE は登録されない", () => {
    const state = buildState([
      createCardInstance(C11, {
        instanceId: "c11-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const leaveResist = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c11-1" &&
        ce.modifierTag === "cannot_leave_field"
    );
    expect(leaveResist).toHaveLength(0);
  });

  it("自分の火星アルティメットが存在するとき cannot_leave_field CE (source:opponent) が登録される", () => {
    const state = buildState([
      createCardInstance(C11, {
        instanceId: "c11-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
      createCardInstance(MARS_ULTIMATE, {
        instanceId: "mars-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const leaveResist = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c11-1" &&
        ce.modifierTag === "cannot_leave_field"
    );
    expect(leaveResist).toHaveLength(1);
  });

  it("フィールドを離れてトラッシュへ移動すると、cannot_leave_field CE は recomputeAndRebuildContinuousEffects で失効する (adversarial verifier 2026-07-25 round3: ENGINE-set-aside-exit-replacement-choice の self-targeting 緩和が誤って延命させないことの回帰確認)", () => {
    const state = buildState([
      createCardInstance(C11, {
        instanceId: "c11-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
      createCardInstance(MARS_ULTIMATE, {
        instanceId: "mars-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) =>
          ce.targetInstanceId === "c11-1" &&
          ce.modifierTag === "cannot_leave_field"
      )
    ).toHaveLength(1);

    // C11 がフィールドを離れてトラッシュへ移動した想定 (zone のみ直接書き換えて検証)。
    const movedToTrash: GameState = {
      ...rebuilt,
      cardInstances: rebuilt.cardInstances.map((c) =>
        c.instanceId === "c11-1" ? { ...c, zone: "trash" as const } : c
      ),
    };
    const recomputed = recomputeAndRebuildContinuousEffects(
      movedToTrash,
      getCardDefinitionById
    );
    const leaveResistAfterLeave = recomputed.activeContinuousEffects.filter(
      (ce) =>
        ce.targetInstanceId === "c11-1" &&
        ce.modifierTag === "cannot_leave_field"
    );
    expect(leaveResistAfterLeave).toHaveLength(0);
  });
});

describe("BSAZ02-C11 effects[2]（Lv1メインステップ: デッキ7枚破棄→火星導界者ネクサス2枚までコスト不要配置）", () => {
  const effect = C11.effects![2]!;

  it("effect定義: activated(main) + 同名ゲーム1回 + 7枚破棄後に対象を配置", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "main" });
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
    expect(effect.steps).toHaveLength(3);
    expect(effect.steps[0]!.action).toMatchObject({
      kind: "discard",
      fromZone: "deck",
      count: 7,
      deferMovedToTrashEffects: true,
    });
    expect(effect.steps[1]!.action).toMatchObject({
      kind: "move_card",
      target: { zone: "trash", count: { min: 0, max: 2 }, stepId: "mill" },
      to: { zone: "field", player: "self" },
    });
  });

  it("デッキ上7枚中、火星導界者ネクサス2枚が場へコスト不要配置され、残り5枚はトラッシュへ", () => {
    const src = createCardInstance(C11, {
      instanceId: "c11-src",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const nexusA = createCardInstance(MARS_GRANDWALKER_NEXUS, {
      instanceId: "deck-nexus-a",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const nexusB = createCardInstance(MARS_GRANDWALKER_NEXUS, {
      instanceId: "deck-nexus-b",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const fillers = [0, 1, 2, 3, 4].map((i) =>
      createCardInstance(FILLER, {
        instanceId: `deck-filler-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{ reserveNormalCoreCount: 9 }],
      cardInstances: [
        src,
        nexusA,
        fillers[0]!,
        nexusB,
        fillers[1]!,
        fillers[2]!,
        fillers[3]!,
        fillers[4]!,
      ],
    });
    const afterReveal = executeEffect({
      chainId: "test:bsaz02-c11-slaine-troyard:312",
      state,
      effect,
      sourceInstanceId: "c11-src",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(afterReveal.pendingDeckReveal).toBeNull();
    expect(afterReveal.pendingStepOptionalChoice).not.toBeNull();
    const after = acceptOptionalSteps(
      applyLegalAction({
        state: afterReveal,
        action: {
          kind: "resolve_pending_step_optional_choice",
          choice: "execute",
          pendingId: afterReveal.pendingStepOptionalChoice!.pendingId,
          actingPlayerId: ALICE,
        },
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        targetInstanceIds: ["deck-nexus-a", "deck-nexus-b"],
      }).state,
      getCardDefinitionById,
      { targetInstanceIds: ["deck-nexus-a", "deck-nexus-b"] }
    );

    expect(after.pendingDeckReveal).toBeNull();
    const a = after.cardInstances.find((c) => c.instanceId === "deck-nexus-a")!;
    const b = after.cardInstances.find((c) => c.instanceId === "deck-nexus-b")!;
    expect(
      a.zone,
      JSON.stringify({
        log: after.log,
        optional: after.pendingStepOptionalChoice,
        targets: after.pendingTargetSelection,
        zone: after.pendingZoneSelection,
      })
    ).toBe("field");
    expect(b.zone).toBe("field");
    expect(a.zoneRoleName).toBe("nexus");
    expect(b.zoneRoleName).toBe("nexus");
    // move_card による効果配置は通常の配置コスト支払いを通らない。十分なリザーブを
    // 明示しても、無償配置でコアが減らず、維持コア選択も発生しないことを盤面で確認する。
    expect(
      after.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(9);
    expect(after.pendingEnterFieldPlacement).toBeNull();
    for (const f of fillers) {
      const found = after.cardInstances.find(
        (c) => c.instanceId === f.instanceId
      )!;
      expect(found.zone).toBe("trash");
    }
  });
});

describe("BSAZ02-C11 effects[3]（【アルティメット合体中】召喚条件無視許可）", () => {
  const effect = C11.effects![3]!;

  it("effect定義: continuous + applicability.combined:true + condition(combined_host_category:ultimate限定) + allow_ignore_summon_condition(filter:火星&ＣＦ ultimate)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.applicability).toEqual({ combined: true });
    expect(effect.condition).toEqual([
      { kind: "combined_host_category", categories: ["ultimate"] },
    ]);
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({
      kind: "allow_ignore_summon_condition",
      player: "self",
      filter: {
        category: ["ultimate"],
        tribes: ["火星", "ＣＦ"],
        tribesLogic: "and",
      },
      duration: { scope: "permanent" },
    });
  });

  it("合体中(host へ attach 済み)は allow_ignore_summon_condition CE が player(自分) に登録される", () => {
    const state = buildState([
      createCardInstance(MARS_ULTIMATE, {
        instanceId: "host-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedChildrenIds: ["c11-1"],
        normalCoreCount: 1,
      }),
      createCardInstance(C11, {
        instanceId: "c11-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "host-1",
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const grant = rebuilt.activeContinuousEffects.find(
      (ce) =>
        ce.targetInstanceId === ALICE &&
        ce.modifierTag === "allow_ignore_summon_condition"
    );
    expect(grant).toBeDefined();
    expect(grant!.metadata?.filter).toEqual({
      category: ["ultimate"],
      tribes: ["火星", "ＣＦ"],
      tribesLogic: "and",
    });
  });

  it("recomputeAndRebuildContinuousEffects (SBA/誘発解決直後相当) を経ても allow_ignore_summon_condition CE が除去されない（player-scoped CE の isPlayerScopedCETag allowlist 漏れ回帰、adversarial verifier round3 指摘）", () => {
    const state = buildState([
      createCardInstance(MARS_ULTIMATE, {
        instanceId: "host-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedChildrenIds: ["c11-1"],
        normalCoreCount: 1,
      }),
      createCardInstance(C11, {
        instanceId: "c11-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "host-1",
      }),
    ]);
    const registered = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    expect(
      registered.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "allow_ignore_summon_condition"
      )
    ).toBe(true);

    const recomputed = recomputeAndRebuildContinuousEffects(
      registered,
      getCardDefinitionById
    );
    const grant = recomputed.activeContinuousEffects.find(
      (ce) =>
        ce.targetInstanceId === ALICE &&
        ce.modifierTag === "allow_ignore_summon_condition"
    );
    expect(grant).toBeDefined();
  });

  it("合体先がスピリット(category:spirit)のときは allow_ignore_summon_condition CE が登録されない（見出し【アルティメット合体中】はホストがアルティメット限定）", () => {
    const state = buildState([
      createCardInstance(MARS_SPIRIT, {
        instanceId: "host-spirit-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedChildrenIds: ["c11-1"],
        normalCoreCount: 1,
      }),
      createCardInstance(C11, {
        instanceId: "c11-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: "host-spirit-1",
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const grant = rebuilt.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "allow_ignore_summon_condition"
    );
    expect(grant).toBeUndefined();
  });

  it("非合体では allow_ignore_summon_condition CE が登録されない", () => {
    const state = buildState([
      createCardInstance(C11, {
        instanceId: "c11-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      }),
    ]);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const grant = rebuilt.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "allow_ignore_summon_condition"
    );
    expect(grant).toBeUndefined();
  });

  it("canSummonUltimate: 許可 CE が有効なら summonCondition (「ＣＦ」アルティメット0体) 不成立でも召喚可", () => {
    const otherCf = createCardInstance(MARS_ULTIMATE, {
      instanceId: "field-cf",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [otherCf],
    });

    // 許可 CE が無ければ既存挙動どおり summonCondition 不成立 (BSAZ02-C01 テスト同型)。
    expect(
      canSummonUltimate(state, ALICE, MARS_ULTIMATE, getCardDefinitionById, {
        sourceInstanceId: "ult-hand",
        evaluateCondition,
      })
    ).toBe(false);

    const stateWithGrant: GameState = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "test-allow-ignore-summon-condition-1",
          sourceInstanceId: "host-1",
          sourceDefinitionId: C11.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "permanent" },
          createdAtTurn: state.turnNumber,
          createdAtAttackId: null,
          modifierTag: "allow_ignore_summon_condition",
          targetInstanceId: ALICE,
          metadata: {
            filter: {
              category: ["ultimate"],
              tribes: ["火星", "ＣＦ"],
              tribesLogic: "and",
            },
          },
        },
      ],
    };
    expect(
      canSummonUltimate(
        stateWithGrant,
        ALICE,
        MARS_ULTIMATE,
        getCardDefinitionById,
        {
          sourceInstanceId: "ult-hand",
          evaluateCondition,
        }
      )
    ).toBe(true);
  });
});
