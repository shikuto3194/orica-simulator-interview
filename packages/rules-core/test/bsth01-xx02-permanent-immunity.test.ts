/**
 * BSTH01-XX02 [東方紅魔郷]博麗 霊夢 effects[0]
 *   Lv1-Lv2-Lv3-Lv4「このスピリットは、相手の効果を受けず、相手の効果を受けるとき、
 *   相手の効果が指定する効果/条件で防いだものとする。」
 *
 * 後半節は公式裁定 qa-020 (external-qa/qaData.js:206, 信頼度A) 準拠のイディオムで、
 * 「〜では防げない」型の限定的防止不可を受けたとき「〜では」の部分を満たして防いだ
 * 扱いにする。定式化（10_rules/04b2）: 防げる条件が1つでも存在するなら自動的にそれを
 * 満たし（＝bypassされない）、条件が存在しない真の blanket（お互い/一切）のときだけ
 * 防げない（＝bypassされる）。DSL 側は effect_immunity action の
 * `satisfiesPreventionRestriction` 修飾子として表現し（P3-141）、
 * `canSourceBypassResistanceCE` (effect-resistance-check.ts) がこの marker を持つ CE に
 * 対して実 identity 照合をスキップし、真の blanket
 * (`TargetLockBypassProfile.kind: "all_effects" | "blanket_affect_immunity"`) のみを
 * bypass 対象とする。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, Effect, GameState } from "../src";
import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const ALICE = "alice";
const BOB = "bob";
const XX02 = card("BSTH01-XX02");
// 攻撃側の source card はダミー（effect_immunity は blanket = immunitySourceScope 無しの
// ため発生源カードの実 identity は照合されない。identity 照合が行われるのは
// canSourceBypassResistanceCE 側の「防止元 = ce.sourceInstanceId(=XX02自身)」）。
const ATTACKER_SOURCE = card("BSTH06-C01");

function makeState(): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const reimu = createCardInstance(XX02, {
    instanceId: "reimu-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const attackerSrc = createCardInstance(ATTACKER_SOURCE, {
    instanceId: "attacker-src",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  const withCards: GameState = {
    ...base,
    cardInstances: [reimu, attackerSrc],
  };
  return rebuildContinuousEffectsFromField(withCards, getCardDefinitionById);
}

/** XX02 が実際にフィールドを離れた（=耐性が bypass された）かを判定する。 */
function xx02Destroyed(result: GameState): boolean {
  const c = result.cardInstances.find((x) => x.instanceId === "reimu-1");
  const leftField = !c || c.zone !== "field";
  const pendingUnblocked = result.pendingLeaveEntities.some(
    (e) => e.instanceId === "reimu-1" && !e.blockedByResistance
  );
  return leftField || pendingUnblocked;
}

function destroyXX02Effect(
  extra: Partial<
    Pick<
      Effect,
      "preventionLevel" | "preventionRestriction" | "targetLockBypass"
    >
  >
): Effect {
  return {
    timing: { kind: "continuous" },
    ...extra,
    steps: [
      {
        action: {
          kind: "destroy",
          target: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit"] },
            count: "all",
          },
        },
      },
    ],
  };
}

describe("BSTH01-XX02 effects[0]: 常時 defense_immune + qa-020 satisfier marker", () => {
  it("effects[0] が effect_immunity(self, permanent, satisfiesPreventionRestriction:true) を持つ", () => {
    const e = XX02.effects![0]!;
    expect(e.timing).toEqual({ kind: "continuous" });
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind !== "effect_immunity") throw new Error("type narrow");
    expect(action.target).toEqual({ kind: "self" });
    expect(action.duration).toEqual({ scope: "permanent" });
    expect(action.satisfiesPreventionRestriction).toBe(true);
    expect(e.stub).toBeUndefined();
  });

  it("場に出ているだけで defense_immune CE が metadata.satisfiesPreventionRestriction:true 付きで登録される", () => {
    const state = makeState();
    const immune = state.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "defense_immune" && ce.sourceInstanceId === "reimu-1"
    );
    expect(immune).toHaveLength(1);
    expect(immune[0]!.duration).toEqual({ scope: "permanent" });
    expect(immune[0]!.metadata?.["satisfiesPreventionRestriction"]).toBe(true);
  });
});

describe("qa-020 例①②: player-relation のみの restriction（相手の効果では防げない）は自動的に満たす", () => {
  it("bare preventionLevel:unpreventable（相手の効果では防げない、rider無し）は XX02 を貫通しない", () => {
    const result = executeEffect({
      chainId: "test:bsth01-xx02-permanent-immunity:133",
      state: makeState(),
      effect: destroyXX02Effect({ preventionLevel: "unpreventable" }),
      sourceInstanceId: "attacker-src",
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(xx02Destroyed(result)).toBe(false);
  });
});

describe("qa-020 例①: 色スコープ（白以外の効果では防げない）は実 identity を照合せず満たす", () => {
  it("onlyPreventableByColors:['white'] （XX02 は赤）でも bypass されない", () => {
    const result = executeEffect({
      chainId: "test:bsth01-xx02-permanent-immunity:147",
      state: makeState(),
      effect: destroyXX02Effect({
        preventionLevel: "unpreventable",
        preventionRestriction: {
          onlyPreventableByColors: ["white"],
          colorMatchMode: "exact",
        },
      }),
      sourceInstanceId: "attacker-src",
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(xx02Destroyed(result)).toBe(false);
  });
});

describe("qa-020 例③: キーワードスコープ（【超重装甲】以外では防げない）も同様に満たす", () => {
  it("onlyPreventableByKeywords:['超重装甲'] （XX02 は非該当）でも bypass されない", () => {
    const result = executeEffect({
      chainId: "test:bsth01-xx02-permanent-immunity:167",
      state: makeState(),
      effect: destroyXX02Effect({
        preventionLevel: "unpreventable",
        preventionRestriction: { onlyPreventableByKeywords: ["超重装甲"] },
      }),
      sourceInstanceId: "attacker-src",
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(xx02Destroyed(result)).toBe(false);
  });
});

describe("カテゴリスコープ（スピリット/アルティメットの効果では防げない）も実 identity 一致有無に関わらず満たす", () => {
  it("notPreventableByCategories:['spirit','ultimate'] （XX02 は spirit で一致）でも bypass されない", () => {
    const result = executeEffect({
      chainId: "test:bsth01-xx02-permanent-immunity:184",
      state: makeState(),
      effect: destroyXX02Effect({
        preventionRestriction: {
          notPreventableByCategories: ["spirit", "ultimate"],
        },
      }),
      sourceInstanceId: "attacker-src",
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(xx02Destroyed(result)).toBe(false);
  });
});

describe("系統スコープ（系統:蓬莱を持つ効果で防げない）も同じ理由で満たす（旧実装は偶然一致だった）", () => {
  it("notPreventableByTribes:['蓬莱'] （XX02 は非該当）でも bypass されない", () => {
    const result = executeEffect({
      chainId: "test:bsth01-xx02-permanent-immunity:202",
      state: makeState(),
      effect: destroyXX02Effect({
        preventionRestriction: { notPreventableByTribes: ["蓬莱"] },
      }),
      sourceInstanceId: "attacker-src",
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(xx02Destroyed(result)).toBe(false);
  });
});

describe("qa-020 例②③: 真の blanket（お互い/一切、条件が一切存在しない）だけが貫通する", () => {
  it("targetLockBypass:{kind:'blanket_affect_immunity'}（お互い/一切 affect-immunity軸）は XX02 を貫通する", () => {
    const result = executeEffect({
      chainId: "test:bsth01-xx02-permanent-immunity:218",
      state: makeState(),
      effect: destroyXX02Effect({
        preventionLevel: "unpreventable",
        targetLockBypass: { kind: "blanket_affect_immunity" },
      }),
      sourceInstanceId: "attacker-src",
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(xx02Destroyed(result)).toBe(true);
  });

  it("targetLockBypass:{kind:'all_effects'}（一切、target lock 込みの完全 blanket）も XX02 を貫通する", () => {
    const result = executeEffect({
      chainId: "test:bsth01-xx02-permanent-immunity:233",
      state: makeState(),
      effect: destroyXX02Effect({
        preventionLevel: "unpreventable",
        targetLockBypass: { kind: "all_effects" },
      }),
      sourceInstanceId: "attacker-src",
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(xx02Destroyed(result)).toBe(true);
  });
});

describe("card-data 分類: 「お互い」「一切」の 2 サイトが真の blanket (affect-immunity軸) として分離されている", () => {
  it("BSAZ02-C14「お互いの効果で防げない」= targetLockBypass:{kind:'blanket_affect_immunity'}（target lock は非貫通）", () => {
    const def = card("BSAZ02-C14");
    // [2] フラッシュ: お互いのスピリット/アルティメットすべてを破壊し、その効果を発揮させない。
    const effect = def.effects![2]!;
    expect(effect.preventionLevel).toBe("unpreventable");
    expect(effect.targetLockBypass).toEqual({
      kind: "blanket_affect_immunity",
    });
  });

  it("BSTH001-M01「一切の効果で防げない」= targetLockBypass:{kind:'all_effects'}（affect immunity・target lock 両軸貫通、P3-143 done-definition）", () => {
    const def = card("BSTH001-M01");
    // [1] Lv2-Lv3『召喚/アタック時』相手のスピリット/アルティメット1体を破壊。
    const effect = def.effects![1]!;
    expect(effect.preventionLevel).toBe("unpreventable");
    expect(effect.targetLockBypass).toEqual({ kind: "all_effects" });
  });
});
