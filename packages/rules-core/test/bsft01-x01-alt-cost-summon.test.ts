/**
 * BSFT01-X01 星霊王 effects[2] — 「手札/トラッシュにあるこのカードは、自分のメイン
 * ステップに、同名の自分のアルティメットがいなければ、合体中の自分の鍵ブレイヴ1つを
 * 除外することで、召喚コストすべてを支払ったものとして召喚できる。」
 *
 * Q54 の通常召喚行動許可。鍵ブレイヴ除外→召喚コスト確定→スタック→
 * 維持コア配置の順と、手札では通常コスト召喚も並立することを検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

const 星霊王 = cardNoMap.get("BSFT01-X01")!;
const 宝瓶宮の鍵 = cardNoMap.get("BSFT01-TR01(A)")!; // tribe:鍵・光導 (brave)
const ホスト = cardNoMap.get("BSFT01-C01")!; // 適当な自分のスピリット (host)
// 星霊王の《召喚条件：C5以上＆魂状態を含む自分の「ルーシィ」1体以上》を満たすためのダミー。
const ルーシィ = cardNoMap.get("BSFT01-CX01")!; // name: ルーシィ・ハートフィリア

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";

function actionsFor(state: GameState, actingPlayerId: string) {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  });
}

function findPermissionSummon(state: GameState, actingPlayerId: string) {
  return actionsFor(state, actingPlayerId).find(
    (a): a is Extract<typeof a, { kind: "summon" }> =>
      a.kind === "summon" &&
      a.sourceInstanceId === "seireiou-x01" &&
      a.reason === "legal_summon_by_hand_permission"
  );
}

function buildState(options: {
  x01Zone: "hand" | "trash";
  withCombinedKeyBrave: boolean;
  withSameNameUltimateOnField?: boolean;
  reserveNormalCoreCount?: number;
}): GameState {
  const cardInstances = [
    createCardInstance(星霊王, {
      instanceId: "seireiou-x01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: options.x01Zone,
    }),
    // 《召喚条件：C5以上＆魂状態を含む自分の「ルーシィ」1体以上》を満たす。
    createCardInstance(ルーシィ, {
      instanceId: "lucy-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    }),
  ];
  if (options.withCombinedKeyBrave) {
    cardInstances.push(
      createCardInstance(ホスト, {
        instanceId: "host-spirit",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        cores: 1,
        attachedChildrenIds: ["key-brave-1"],
      }),
      createCardInstance(宝瓶宮の鍵, {
        instanceId: "key-brave-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        cores: 2,
        attachedToInstanceId: "host-spirit",
      })
    );
  }
  if (options.withSameNameUltimateOnField) {
    cardInstances.push(
      createCardInstance(星霊王, {
        instanceId: "seireiou-x01-existing",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        cores: 2,
      })
    );
  }

  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances,
    playerOverrides: [
      {
        reserveNormalCoreCount: options.reserveNormalCoreCount ?? 10,
        countValue: 5,
      },
      {},
    ],
  });
  return { ...base, step: "main", activePlayerId: ALICE };
}

describe("BSFT01-X01 代替コスト召喚 (合体中の鍵ブレイヴ除外)", () => {
  it("手札 + 合体中の鍵ブレイヴあり: Q54 通常召喚許可を必須除外コスト付きで提示する", () => {
    const state = buildState({ x01Zone: "hand", withCombinedKeyBrave: true });
    expect(findPermissionSummon(state, ALICE)).toMatchObject({
      summonPermissionEffectIndex: 0,
      opensCostExcludeChoice: true,
      costExcludeMinCount: 1,
      costExcludeCandidateInstanceIds: ["key-brave-1"],
    });
    expect(
      actionsFor(state, ALICE).some(
        (action) =>
          action.kind === "use_hand_card_effect" &&
          action.sourceInstanceId === "seireiou-x01"
      )
    ).toBe(false);
  });

  it("合体中の鍵ブレイヴありでも、除外しない通常コスト(12)の手札召喚は引き続き選べる", () => {
    // 「除外することで召喚コストを支払ったものとして召喚できる」は追加の代替手段であり、
    // 通常の手札召喚 (getAvailableHandCardLegalActions の素の summon action) を封じない。
    // mandatory exclude (minCount>0) は許可 effect 専用の legal action にのみ出し、
    // 汎用の通常召喚経路には出さない (adversarial verifier round2 で是正)。
    const state = buildState({ x01Zone: "hand", withCombinedKeyBrave: true });
    const actions = actionsFor(state, ALICE);
    const normalSummon = actions.find(
      (a) =>
        a.kind === "summon" &&
        a.sourceInstanceId === "seireiou-x01" &&
        a.reason === "legal_summon"
    );
    expect(normalSummon).toBeDefined();
    if (normalSummon?.kind === "summon") {
      expect(normalSummon.opensCostExcludeChoice ?? false).toBe(false);
      expect(normalSummon.finalCost).toBe(12);
    }
    // Q54 の代替召喚も並立して存在する。
    expect(findPermissionSummon(state, ALICE)).toBeDefined();
  });

  it("トラッシュ + 合体中の鍵ブレイヴあり: 同じ Q54 通常召喚を宣言できる", () => {
    const state = buildState({
      x01Zone: "trash",
      withCombinedKeyBrave: true,
    });
    expect(findPermissionSummon(state, ALICE)).toMatchObject({
      summonPermissionEffectIndex: 0,
      opensCostExcludeChoice: true,
    });
  });

  it("合体中の鍵ブレイヴが無い: 必須代替コストを払えないため Q54 action を出さない", () => {
    const state = buildState({ x01Zone: "hand", withCombinedKeyBrave: false });
    expect(findPermissionSummon(state, ALICE)).toBeUndefined();
  });

  it("同名の自分のアルティメットが既に場にいる: Q54 action を出さない", () => {
    const state = buildState({
      x01Zone: "hand",
      withCombinedKeyBrave: true,
      withSameNameUltimateOnField: true,
    });
    expect(findPermissionSummon(state, ALICE)).toBeUndefined();
  });

  it("宣言時に鍵ブレイヴを除外してからスタックを開き、窓後に維持コアを置く", () => {
    const state = buildState({
      x01Zone: "hand",
      withCombinedKeyBrave: true,
      reserveNormalCoreCount: 10,
    });
    const summonAction = findPermissionSummon(state, ALICE)!;

    const costPending = applyLegalAction({
      state,
      action: summonAction,
      getCardDefinitionById,
      ...effectLookups,
    }).state;

    expect(costPending.window).toBe("none");
    const pending = costPending.pendingSummonCostExcludeChoice;
    expect(pending).not.toBeNull();
    expect(pending.candidateCardInstanceIds).toEqual(["key-brave-1"]);
    expect(pending.minCount).toBe(1);
    expect(pending.effectSummonActivationZone).toBeUndefined();
    expect(pending.summonPermissionEffectIndex).toBe(0);

    const resolveAction = actionsFor(costPending, ALICE).find(
      (a) => a.kind === "resolve_pending_summon_cost_exclude_choice"
    )!;
    expect(resolveAction).toMatchObject({ minCount: 1 });
    const opened = applyLegalAction({
      state: costPending,
      action: resolveAction,
      getCardDefinitionById,
      ...effectLookups,
      summonCostExcludeSelectedCardInstanceIds: ["key-brave-1"],
      paymentSources: [],
    }).state;

    expect(opened.pendingSummonCostExcludeChoice ?? null).toBeNull();
    const excludedBrave = opened.cardInstances.find(
      (c) => c.instanceId === "key-brave-1"
    )!;
    expect(excludedBrave.zone).toBe("removed_from_game");
    expect(excludedBrave.attachedToInstanceId).toBeNull();
    const host = opened.cardInstances.find(
      (c) => c.instanceId === "host-spirit"
    )!;
    expect(host.attachedChildrenIds).toEqual([]);
    // 除外されたブレイヴのコア(2)はリザーブへ返る: 10(初期) + 2(除外分) = 12。
    const aliceAfterExclude = opened.players.find((p) => p.id === ALICE)!;
    expect(aliceAfterExclude.reserveNormalCoreCount).toBe(12);

    expect(opened.window).toBe("stack");
    expect(opened.pendingMultiPlacement).toBeNull();
    const passBob = actionsFor(opened, BOB).find(
      (action) => action.kind === "pass_stack"
    );
    expect(passBob).toBeDefined();
    const afterPass = applyLegalAction({
      state: opened,
      action: passBob!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;

    expect(afterPass.window).toBe("none");
    expect(afterPass.stackWindow).toBeNull();
    expect(afterPass.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      "seireiou-x01"
    );
    const resolvePlacement = actionsFor(afterPass, ALICE).find(
      (a) => a.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();
    const resolved = applyLegalAction({
      state: afterPass,
      action: resolvePlacement!,
      getCardDefinitionById,
      ...effectLookups,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;

    const summoned = resolved.cardInstances.find(
      (c) => c.instanceId === "seireiou-x01"
    )!;
    expect(summoned.zone).toBe("field");
    // コインコストは0(12除外で全額支払い済み)。場入りコア1個のみリザーブから消費: 12 - 1 = 11。
    const aliceFinal = resolved.players.find((p) => p.id === ALICE)!;
    expect(aliceFinal.reserveNormalCoreCount).toBe(11);
  });
});

describe("星霊王の全額支払い済みと追加支払いの区別", () => {
  it.each([
    {
      label: "コスト+9",
      modifier: { additionalCostValue: 9 },
      extra: false,
      payment: 0,
    },
    {
      label: "コスト30に変更",
      modifier: { override: 30 },
      extra: false,
      payment: 0,
    },
    {
      label: "3コスト余分に支払う",
      modifier: { additionalCostValue: 3 },
      extra: true,
      payment: 3,
    },
  ])(
    "$label: 代替支払い後の必要額だけを払って召喚する",
    ({ modifier, extra, payment }) => {
      const definition: CardDefinition = {
        ...ホスト,
        cardNo: "audit-star-cost-modifier",
        effects: [
          {
            timing: { kind: "continuous" },
            steps: [
              {
                action: {
                  kind: "cost_modify",
                  player: "self",
                  cardFilter: { category: ["ultimate"] },
                  modifier,
                  additionalPayment: extra,
                  duration: { scope: "while_on_field" },
                },
              },
            ],
          },
        ],
      };
      cardNoMap.set(definition.cardNo, definition);
      let state = buildState({
        x01Zone: "trash",
        withCombinedKeyBrave: true,
        reserveNormalCoreCount: 3,
      });
      state.cardInstances.push(
        createCardInstance(definition, {
          instanceId: "cost-source",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        })
      );
      state = executeEffect({
        chainId: "test:bsft01-x01-alt-cost-summon:344",
        state,
        effect: definition.effects[0]!,
        sourceInstanceId: "cost-source",
        actingPlayerId: ALICE,
        getCardDefinitionById,
      });
      const summon = findPermissionSummon(state, ALICE);
      expect(summon).toMatchObject({
        finalCost: payment,
        costExcludeFullCostPaid: true,
      });
      const pending = applyLegalAction({
        state,
        action: summon!,
        getCardDefinitionById,
        ...effectLookups,
      }).state;
      const choice = actionsFor(pending, ALICE).find(
        (a) => a.kind === "resolve_pending_summon_cost_exclude_choice"
      )!;
      expect(choice).toMatchObject({
        fullCostPaid: true,
        remainingPaymentCost: payment,
      });
      const opened = applyLegalAction({
        state: pending,
        action: choice,
        getCardDefinitionById,
        ...effectLookups,
        summonCostExcludeSelectedCardInstanceIds: ["key-brave-1"],
        paymentSources: payment ? [{ kind: "reserve", amount: payment }] : [],
      }).state;
      expect(
        opened.cardInstances.find((c) => c.instanceId === "key-brave-1")?.zone
      ).toBe("removed_from_game");
      expect(opened.players[0]!.reserveNormalCoreCount).toBe(5 - payment);
      const pass = actionsFor(opened, BOB).find(
        (a) => a.kind === "pass_stack"
      )!;
      const resolved = applyLegalAction({
        state: opened,
        action: pass,
        getCardDefinitionById,
        ...effectLookups,
      }).state;
      const placement = actionsFor(resolved, ALICE).find(
        (a) => a.kind === "resolve_pending_enter_field_placement"
      )!;
      const final = applyLegalAction({
        state: resolved,
        action: placement,
        getCardDefinitionById,
        ...effectLookups,
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      }).state;
      expect(
        final.cardInstances.find((c) => c.instanceId === "seireiou-x01")?.zone
      ).toBe("field");
      expect(final.players[0]!.reserveNormalCoreCount).toBe(4 - payment);
    }
  );
});
