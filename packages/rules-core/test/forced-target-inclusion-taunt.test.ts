/**
 * forced_target_inclusion primitive (forced-target-inclusion-taunt cluster) —
 * 「相手が対象を選ぶ効果を発揮するとき、可能ならこのカードを対象に含めなければ
 * ならない」タウント継続効果。
 *
 * 解禁カード: BSFT01-TR02(B) [5]
 * 〔重複不可〕相手が自分の「ルーシィ」/系統:「星霊」を持つスピリットを対象に含む
 * 効果を発揮するとき、可能ならこのスピリットを対象に含めなければならない。
 *
 * 実装: このカード自身が当該フィルタ(ルーシィ名/星霊系統)に該当するため、相手の
 * 対象選択候補プールにこのカードが含まれる間 (=候補として対象化し得る間) だけ、
 * その選択に本カードの選択を強制する (getMandatoryForcedTargetInclusionIds)。
 * 検証点は対象選択が確定/変更されうる4経路すべて: 効果宣言時の対象選択
 * (applyPendingEffectTargetAction)、on_step 型の対象選択
 * (applyPendingStepOptionalTargetSelectionAction、destroy/vanish/bounce/
 * prevent_battle/exhaust 等の一般アクションが使う再開型対象選択)、
 * コアシュートの対象選択 (applyPendingCoreShootAction、candidates 配列 shape が
 * 異なるため grep 網羅から漏れやすい第3経路。adversarial verifier round2 lens3 refute)、
 * 対象確定後の redirect_effect_target による対象付け替え (confirm_target_redirect、
 * 一度強制済みの対象を別経路で外せてしまう第4経路。adversarial verifier round3 lens4 refute)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  applyPendingEffectTargetAction,
  applyPendingCoreShootAction,
} from "../src/legal/effect-target-handlers";
import { applyPendingStepOptionalTargetSelectionAction } from "../src/legal/pending-action-handlers";
import { applyLegalAction, getLegalActions } from "../src";
import { getMandatoryForcedTargetInclusionIds } from "../src/legal/legal-actions-shared";
import type { LegalAction } from "../src/legal/legal-actions-types";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

const noLookup = () => undefined;

// applyPendingEffectTargetAction / applyPendingStepOptionalTargetSelectionAction は
// state 上の pending から解決するため options.action の中身自体は参照しない箇所が
// 大半だが、型上必須のためダミー値を渡す。
const DUMMY_ACTION = {
  kind: "resolve_pending_effect_target",
} as unknown as LegalAction;

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

const hostDef = card("BSFT01-TR02(B)");
const forcedTargetInclusionEffect = hostDef.effects!.find(
  (e) => e.steps[0]?.action.kind === "forced_target_inclusion"
)!;

function registerForcedTargetInclusion(
  state: GameState,
  sourceInstanceId: string,
  actingPlayerId = ALICE
): GameState {
  return executeEffect({
    chainId: "test:forced-target-inclusion-taunt:74",
    state,
    effect: forcedTargetInclusionEffect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

function buildStateWithTaunt(): GameState {
  const state = createEmptyGameState({
    cardInstances: [
      createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: ALICE,
        zone: "field",
      }),
      createCardInstance(card("BSSA01-C01"), {
        instanceId: "other-1",
        ownerPlayerId: ALICE,
        zone: "field",
      }),
    ],
  });
  return registerForcedTargetInclusion(state, "host-1");
}

describe("forced_target_inclusion primitive (BSFT01-TR02(B) [5])", () => {
  it("effects: stub が解消され forced_target_inclusion action を持つ", () => {
    expect(forcedTargetInclusionEffect.stub).toBeUndefined();
    expect(forcedTargetInclusionEffect.textRef).toEqual([4, 5]);
    const action = forcedTargetInclusionEffect.steps[0]!.action;
    expect(action.kind).toBe("forced_target_inclusion");
    if (action.kind === "forced_target_inclusion") {
      expect(action.target).toBe("self");
    }
    expect(forcedTargetInclusionEffect.usageLimit).toEqual({
      kind: "no_duplicate",
    });
  });

  it("継続効果として自身を対象にした forced_target_inclusion CE を登録する", () => {
    let state = createEmptyGameState({
      cardInstances: [
        createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: ALICE,
          zone: "field",
        }),
      ],
    });
    state = registerForcedTargetInclusion(state, "host-1");
    const ce = state.activeContinuousEffects.find(
      (e) => e.modifierTag === "forced_target_inclusion"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetInstanceId).toBe("host-1");
    expect(ce!.actingPlayerId).toBe(ALICE);
  });

  describe("getMandatoryForcedTargetInclusionIds", () => {
    it("相手が対象選択する側で、このカードが候補プールに入っているとき強制対象化する", () => {
      let state = createEmptyGameState({
        cardInstances: [
          createCardInstance(hostDef, {
            instanceId: "host-1",
            ownerPlayerId: ALICE,
            zone: "field",
          }),
        ],
      });
      state = registerForcedTargetInclusion(state, "host-1");
      const forced = getMandatoryForcedTargetInclusionIds(
        state,
        BOB,
        ["host-1", "other-1"],
        1
      );
      expect(forced).toEqual(["host-1"]);
    });

    it("発揮者がタウント保持側自身 (自分の効果) なら強制しない", () => {
      let state = createEmptyGameState({
        cardInstances: [
          createCardInstance(hostDef, {
            instanceId: "host-1",
            ownerPlayerId: ALICE,
            zone: "field",
          }),
        ],
      });
      state = registerForcedTargetInclusion(state, "host-1");
      const forced = getMandatoryForcedTargetInclusionIds(
        state,
        ALICE,
        ["host-1"],
        1
      );
      expect(forced).toEqual([]);
    });

    it("このカードが候補プールに含まれていない (対象化し得ない) なら強制しない", () => {
      let state = createEmptyGameState({
        cardInstances: [
          createCardInstance(hostDef, {
            instanceId: "host-1",
            ownerPlayerId: ALICE,
            zone: "field",
          }),
        ],
      });
      state = registerForcedTargetInclusion(state, "host-1");
      const forced = getMandatoryForcedTargetInclusionIds(
        state,
        BOB,
        ["other-1"],
        1
      );
      expect(forced).toEqual([]);
    });

    it("別名の複数タウント源が競合し maxTargetCount を超えて全員は含められない (impossible) なら強制を見送る", () => {
      // 〔重複不可〕は同名カード間の dedup であり、別カード名の taunt 同士は競合し得る
      // (model.ts:1094)。ここでは2枚の異なる taunt 提供カードを直接 CE として注入する。
      const makeForcedCe = (
        instanceId: string,
        sourceDefinitionId: string
      ): ContinuousEffect => ({
        effectId: `ce:forced_target_inclusion:${instanceId}`,
        sourceInstanceId: instanceId,
        sourceDefinitionId,
        actingPlayerId: ALICE,
        duration: { scope: "while_on_field" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "forced_target_inclusion",
        targetInstanceId: instanceId,
      });
      const state: GameState = {
        ...createEmptyGameState({
          cardInstances: [
            createCardInstance(hostDef, {
              instanceId: "host-1",
              ownerPlayerId: ALICE,
              zone: "field",
            }),
            createCardInstance(card("BSSA01-C01"), {
              instanceId: "host-2",
              ownerPlayerId: ALICE,
              zone: "field",
            }),
          ],
        }),
        activeContinuousEffects: [
          makeForcedCe("host-1", hostDef.cardNo),
          makeForcedCe("host-2", "BSSA01-C01"),
        ],
      };
      const forced = getMandatoryForcedTargetInclusionIds(
        state,
        BOB,
        ["host-1", "host-2"],
        1
      );
      expect(forced).toEqual([]);
    });
  });

  describe("applyPendingEffectTargetAction 検証 (GUI/REST 共通の単一検証点)", () => {
    function withPending(
      state: GameState,
      deferredStack: ActiveStack
    ): GameState {
      return {
        ...state,
        pendingEffectTargetSelection: {
          pendingId: "effect-target:forced-inclusion-test",
          actingPlayerId: BOB,
          sourceInstanceId: deferredStack.cardInstanceId,
          sourceDefinitionId: deferredStack.cardDefinitionId,
          deferredStack,
          remainingStacks: [],
          requiredTargetCount: 1,
          maxTargetCount: 1,
          candidateInstanceIds: ["host-1", "other-1"],
          targetEffectFilterTags: [],
        },
      };
    }

    it("タウント対象を除外した選択を拒否する (含めることが可能なのに含めていない)", () => {
      const state = withPending(buildStateWithTaunt(), {
        stackId: "s1",
        actionKind: "field_card_effect",
        chainId: "c1",
        actingPlayerId: BOB,
        cardInstanceId: "host-1",
        cardDefinitionId: hostDef.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: [],
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      });
      expect(() =>
        applyPendingEffectTargetAction({
          state,
          action: DUMMY_ACTION,
          targetInstanceIds: ["other-1"],
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        })
      ).toThrow(/forced target inclusion/);
    });

    it("タウント対象を含めた選択は受理される", () => {
      const state = withPending(buildStateWithTaunt(), {
        stackId: "s2",
        actionKind: "field_card_effect",
        chainId: "c2",
        actingPlayerId: BOB,
        cardInstanceId: "host-1",
        cardDefinitionId: hostDef.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: [],
        isNullified: true,
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      });
      const result = applyPendingEffectTargetAction({
        state,
        action: DUMMY_ACTION,
        targetInstanceIds: ["host-1"],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(result.state.pendingEffectTargetSelection).toBeNull();
    });

    it("legal-actions 列挙 (getLegalActions) が resolve_pending_effect_target に mandatoryTargetInstanceIds を露出する (GUI/AI が選択前に必須候補を知れる)", () => {
      const state = withPending(buildStateWithTaunt(), {
        stackId: "s3",
        actionKind: "field_card_effect",
        chainId: "c3",
        actingPlayerId: BOB,
        cardInstanceId: "host-1",
        cardDefinitionId: hostDef.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: [],
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      });
      const actions = getLegalActions({
        state,
        actingPlayerId: BOB,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: noLookup,
        getRegisteredTriggeredEffectActions: () => [],
      });
      const action = actions.find(
        (
          a
        ): a is Extract<
          LegalAction,
          { kind: "resolve_pending_effect_target" }
        > => a.kind === "resolve_pending_effect_target"
      );
      expect(action).toBeDefined();
      expect(action!.mandatoryTargetInstanceIds).toEqual(["host-1"]);
    });
  });

  describe("applyPendingStepOptionalTargetSelectionAction 検証 (on_step 型対象選択の第2経路)", () => {
    // destroy/vanish/bounce/prevent_battle/exhaust 等の on_step アクションは
    // pendingEffectTargetSelection ではなく pendingStepOptionalTargetSelection
    // (tryBuildStepTargetSelection 経由) で対象を確定する。ここを見落とすと
    // タウントを完全にすり抜けられる (adversarial verifier round1 lens2 refute)。
    function buildStepOptionalPending(): GameState["pendingStepOptionalTargetSelection"] {
      return {
        pendingId: "step-optional-target:forced-inclusion-test",
        actingPlayerId: BOB,
        choosingPlayerId: BOB,
        sourceInstanceId: "host-1",
        sourceDefinitionId: hostDef.cardNo,
        effectIndex: 0,
        stepIndex: 0,
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateInstanceIds: ["host-1", "other-1"],
        targetStepId: "__step_0__",
        continuation: {
          chainId: "test:forced-target-inclusion-taunt:364",
          sourceDefinitionId: hostDef.cardNo,
          effectIndex: 0,
          sourceInstanceId: "host-1",
          actingPlayerId: BOB,
          stepIndex: 0,
          stepContext: { results: {} },
        },
      };
    }

    function stepOptionalAction(targetInstanceIds: string[]) {
      return {
        kind: "resolve_pending_step_optional_target_selection",
        pendingId: "step-optional-target:forced-inclusion-test",
        actingPlayerId: BOB,
        targetInstanceIds,
      } as unknown as LegalAction;
    }

    it("on_step 対象選択でもタウント対象を除外した選択を拒否する", () => {
      const base = buildStateWithTaunt();
      const state: GameState = {
        ...base,
        pendingStepOptionalTargetSelection: buildStepOptionalPending(),
      };
      expect(() =>
        applyPendingStepOptionalTargetSelectionAction({
          state,
          action: stepOptionalAction(["other-1"]),
          targetInstanceIds: ["other-1"],
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        })
      ).toThrow(/forced target inclusion/);
    });

    it("on_step 対象選択でタウント対象を含めた選択は受理される", () => {
      const base = buildStateWithTaunt();
      const state: GameState = {
        ...base,
        pendingStepOptionalTargetSelection: buildStepOptionalPending(),
      };
      const result = applyPendingStepOptionalTargetSelectionAction({
        state,
        action: stepOptionalAction(["host-1"]),
        targetInstanceIds: ["host-1"],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(result.state.pendingStepOptionalTargetSelection).toBeNull();
    });

    it("legal-actions 列挙が resolve_pending_step_optional_target_selection に mandatoryTargetInstanceIds を露出する", () => {
      const base = buildStateWithTaunt();
      const state: GameState = {
        ...base,
        pendingStepOptionalTargetSelection: buildStepOptionalPending(),
      };
      const actions = getLegalActions({
        state,
        actingPlayerId: BOB,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: noLookup,
        getRegisteredTriggeredEffectActions: () => [],
      });
      const action = actions.find(
        (
          a
        ): a is Extract<
          LegalAction,
          { kind: "resolve_pending_step_optional_target_selection" }
        > => a.kind === "resolve_pending_step_optional_target_selection"
      );
      expect(action).toBeDefined();
      expect(action!.mandatoryTargetInstanceIds).toEqual(["host-1"]);
    });
  });

  describe("applyPendingCoreShootAction 検証 (コアシュート対象選択の第3経路)", () => {
    // コアシュートの候補 shape (candidates: {instanceId,...}[]) は他2経路の
    // candidateInstanceIds: string[] と異なるため見落としやすい (adversarial verifier
    // round2 lens3 refute)。maxTargetCount 相当として pending.totalAmount を渡す。
    function buildCoreShootState(): GameState {
      return createEmptyGameState({
        cardInstances: [
          createCardInstance(hostDef, {
            instanceId: "host-1",
            ownerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 2,
          }),
          createCardInstance(card("BSSA01-C01"), {
            instanceId: "other-1",
            ownerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 2,
          }),
        ],
      });
    }

    function buildCoreShootPending(): GameState["pendingCoreShootSelection"] {
      return {
        pendingId: "core-shoot:forced-inclusion-test",
        actingPlayerId: BOB,
        sourceInstanceId: "host-1",
        sourceDefinitionId: hostDef.cardNo,
        candidates: [
          {
            instanceId: "host-1",
            definitionId: hostDef.cardNo,
            availableCores: 2,
          },
          {
            instanceId: "other-1",
            definitionId: "BSSA01-C01",
            availableCores: 2,
          },
        ],
        totalAmount: 1,
        toKind: "reserve",
        toPlayerId: BOB,
        fromPlayerId: ALICE,
        remainingActions: [],
        effectTiming: "main",
      };
    }

    it("タウント対象を除外したコア配分を拒否する", () => {
      const base = buildCoreShootState();
      const state: GameState = {
        ...registerForcedTargetInclusion(base, "host-1", ALICE),
        pendingCoreShootSelection: buildCoreShootPending(),
      };
      expect(() =>
        applyPendingCoreShootAction({
          state,
          action: DUMMY_ACTION,
          coreShootDistribution: { "other-1": 1 },
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        })
      ).toThrow(/forced target inclusion/);
    });

    it("タウント対象を含めたコア配分は受理される", () => {
      const base = buildCoreShootState();
      const state: GameState = {
        ...registerForcedTargetInclusion(base, "host-1", ALICE),
        pendingCoreShootSelection: buildCoreShootPending(),
      };
      const result = applyPendingCoreShootAction({
        state,
        action: DUMMY_ACTION,
        coreShootDistribution: { "host-1": 1 },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(result.state.pendingCoreShootSelection).toBeNull();
    });

    it("legal-actions 列挙が resolve_pending_core_shoot に mandatoryTargetInstanceIds を露出する", () => {
      const base = buildCoreShootState();
      const state: GameState = {
        ...registerForcedTargetInclusion(base, "host-1", ALICE),
        pendingCoreShootSelection: buildCoreShootPending(),
      };
      const actions = getLegalActions({
        state,
        actingPlayerId: BOB,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: noLookup,
        getRegisteredTriggeredEffectActions: () => [],
      });
      const action = actions.find(
        (
          a
        ): a is Extract<LegalAction, { kind: "resolve_pending_core_shoot" }> =>
          a.kind === "resolve_pending_core_shoot"
      );
      expect(action).toBeDefined();
      expect(action!.mandatoryTargetInstanceIds).toEqual(["host-1"]);
    });
  });

  describe("confirm_target_redirect 検証 (対象確定後の付け替えによるすり抜けの第4経路)", () => {
    // redirect_effect_target (P3-47 F-4) は対象選択確定「後」に割り込み、対象を
    // 別カード (token 集合) へ差し替えられる別経路。ここを見落とすと、taunt で
    // 強制済みの対象を redirect で外せてしまう (adversarial verifier round3 lens4 refute)。
    function buildRedirectState(): GameState {
      const state = createEmptyGameState({
        cardInstances: [
          createCardInstance(hostDef, {
            instanceId: "host-1",
            ownerPlayerId: ALICE,
            zone: "field",
          }),
          createCardInstance(card("BSSA01-C01"), {
            instanceId: "other-1",
            ownerPlayerId: ALICE,
            zone: "field",
          }),
          createCardInstance(card("BSSA01-C01"), {
            instanceId: "bob-caster",
            ownerPlayerId: BOB,
            zone: "field",
          }),
          createCardInstance(card("BSSA01-C01"), {
            instanceId: "token-1",
            ownerPlayerId: ALICE,
            zone: "field",
          }),
        ],
      });
      return registerForcedTargetInclusion(state, "host-1");
    }

    function withRedirectPending(
      state: GameState,
      redirectableInstanceId: string
    ): GameState {
      return {
        ...state,
        pendingTargetRedirects: [
          {
            pendingId: "redirect:forced-inclusion-test",
            redirectEffectId: "ce:redirect-test",
            promptedPlayerId: ALICE,
            sourceEffectInstanceId: "bob-caster",
            sourceEffectDefinitionId: "BSSA01-C01",
            originalResolvedInstanceIds: [redirectableInstanceId],
            redirectableInstanceId,
            candidateTokenInstanceIds: ["token-1"],
          },
        ],
      };
    }

    it("タウント対象を redirect で外す試みを拒否する", () => {
      const state = withRedirectPending(buildRedirectState(), "host-1");
      expect(() =>
        applyLegalAction({
          state,
          action: {
            kind: "confirm_target_redirect",
            pendingId: "redirect:forced-inclusion-test",
            actingPlayerId: ALICE,
          } as unknown as LegalAction,
          redirectTargetReplacementInstanceId: "token-1",
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        })
      ).toThrow(/forced target inclusion/);
    });

    it("タウント対象でないカードの redirect は受理される", () => {
      const state = withRedirectPending(buildRedirectState(), "other-1");
      const result = applyLegalAction({
        state,
        action: {
          kind: "confirm_target_redirect",
          pendingId: "redirect:forced-inclusion-test",
          actingPlayerId: ALICE,
        } as unknown as LegalAction,
        redirectTargetReplacementInstanceId: "token-1",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(result.state.pendingTargetRedirects).toEqual([]);
    });

    it("legal-actions 列挙はタウント対象を外す confirm_target_redirect を出さない (常に throw する action を legal と偽らない)", () => {
      const state = withRedirectPending(buildRedirectState(), "host-1");
      const actions = getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: noLookup,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(actions.some((a) => a.kind === "confirm_target_redirect")).toBe(
        false
      );
      expect(actions.some((a) => a.kind === "decline_target_redirect")).toBe(
        true
      );
    });

    it("legal-actions 列挙はタウント対象でないカードの redirect には confirm_target_redirect を出す", () => {
      const state = withRedirectPending(buildRedirectState(), "other-1");
      const actions = getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: noLookup,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(actions.some((a) => a.kind === "confirm_target_redirect")).toBe(
        true
      );
    });
  });
});
