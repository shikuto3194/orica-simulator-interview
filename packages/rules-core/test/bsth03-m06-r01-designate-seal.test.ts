import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSTH03-M06「[永夜抄]アリス・マーガトロイド」effects[0] / BSTH03-R01「鈴仙・優曇華院・イナバ」
 * effects[1] 実行検証。
 *
 * 両カードとも「相手1体を指定する。このターンの間、指定した対象はアタック/ブロックできず、
 * その効果すべては発揮されない。」型 (P3-76 disclosure 完成後の残存ギャップ、blanket
 * suppress_effect (effectFilter 省略) を designate step の解決対象へ target:{kind:"ref"} で
 * 共有する。「指定する」対象は 1 体固定のため、suppress_effect 側で再フィルタすると
 * (複数候補があれば) 別対象を選び直してしまう罠がある — ref 共有で防止。
 *
 * BSTH03-M06 は追加で「この効果発揮後、このカードをコストを支払わずに召喚する」
 * (burst→self-summon パターン、10_rules/04b_burst-rules.md:34、先例 BSTS01-M01[4,5]) を持つ。
 * 元コードは target:{kind:"from_zone",zone:"hand",count:1} と誤配線されており、バースト解決中の
 * 発動元 zone は "burst" で "hand" ではないため本来一致せず、無関係な手札カードを召喚するか
 * 空振りする実バグだった。BSTH03-M03/M02 (同ファイル) にも同型バグがあり合わせて修正した。
 *
 * BSTH03-R01 は追加で「自分の紫の導界者ネクサスがあるとき、自分のトラッシュのコア1個を
 * 自分のライフに置ける」(field_has grandwalkerKind:"guided" ゲート + optional core_move、
 * 「置ける」=任意、project_kuwaerareru_optional) を持つ。
 *
 * 同型バグの横展開調査 (claude-explore) で BSTH02-M03 / BSTH02-X04 / BSTH04-R02 / BSTH05-M04 にも
 * 同じ from_zone:hand 誤配線を発見し、合わせて target:{kind:"self"} へ修正した。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { runReevaluationAtTiming } from "../src/legal/legal-actions-shared";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id);

// effect_suppression CE の実消費(reevaluation)経路を通す。CE の存在チェックだけでは
// consumption chokepoint 側の配線漏れを検知できないため、実際の発揮可否判定と同じ
// runReevaluationAtTiming を通す (先例 bsth02-7-c01-nexus-suppression.test.ts)。
const summonRegistration = {
  reevaluationPoints: [
    {
      timing: "after_sba" as const,
      checks: ["effect_suppression" as const],
      failurePolicy: "abort_remaining" as const,
    },
  ],
};
function isSuppressed(state: GameState, sourceInstanceId: string): boolean {
  const reeval = runReevaluationAtTiming({
    state,
    registration: summonRegistration,
    timing: "after_sba",
    sourceInstanceId,
    targetInstanceIds: [],
    getCardDefinitionById,
  });
  return !reeval.passed;
}

const m06 = card("BSTH03-M06");
const r01 = card("BSTH03-R01");
const m02 = card("BSTH03-M02");
const m03 = card("BSTH03-M03");
const bsth02m03 = card("BSTH02-M03");
const bsth02x04 = card("BSTH02-X04");
const bsth04r02 = card("BSTH04-R02");
const bsth05m04 = card("BSTH05-M04");
const opponentUltimateDef = card("BSFT01-X01"); // printedCategory "ultimate"
const opponentSpiritDef = card("BSFT01-CX01"); // printedCategory "spirit"
const guidedNexusDef = card("BSTH01-XX01"); // 紫を含む導界者ネクサス (grandwalkerData.kind:"guided")

describe("BSTH03-M06 effects[0] shape", () => {
  it("stub が消えており、designate→suppress_effect(ref共有)→self-summon の3 step", () => {
    const e0 = m06.effects![0]!;
    expect(e0.stub).toBeUndefined();
    expect(e0.steps).toHaveLength(3);
    expect(e0.steps[0]!.id).toBe("designate");
    expect(e0.steps[0]!.action.kind).toBe("prevent_battle");
    const suppress = e0.steps[1]!.action;
    expect(suppress.kind).toBe("suppress_effect");
    if (suppress.kind === "suppress_effect") {
      expect(suppress.target).toEqual({ kind: "ref", stepId: "designate" });
      expect(suppress.effectFilter).toBeUndefined();
    }
    const summon = e0.steps[2]!.action;
    expect(summon.kind).toBe("summon");
    if (summon.kind === "summon") {
      expect(summon.target).toEqual({ kind: "self" });
    }
  });
});

describe("BSTH03-M06 effects[0] 実行: 相手アタック不可+効果封印+コスト無し自己召喚", () => {
  function buildState(): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const src = createCardInstance(m06, {
      instanceId: "m06-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const bobUnit = createCardInstance(opponentUltimateDef, {
      instanceId: "bob-ult-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const bobOther = createCardInstance(opponentSpiritDef, {
      instanceId: "bob-other-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return { ...base, cardInstances: [src, bobUnit, bobOther] };
  }

  it("指定した相手はこのターンアタックできず、その効果すべてが発揮されず、このカードはコスト無しでフィールドへ出る", () => {
    const state = buildState();
    const after = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth03-m06-r01-designate-seal:130",
      state,
      effect: m06.effects![0]!,
      sourceInstanceId: "m06-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const preventBattle = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "prevent_battle_attack" &&
        ce.targetInstanceId === "bob-ult-1"
    );
    expect(preventBattle).toBeDefined();
    expect(preventBattle?.duration.scope).toBe("turn");

    const suppression = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.targetInstanceId === "bob-ult-1"
    );
    expect(suppression).toBeDefined();
    expect(suppression?.duration.scope).toBe("turn");

    // CE の存在だけでなく、実際の発揮可否判定 (reevaluation chokepoint) でも封じられている
    // ことを確認する。指定していない他の相手カードは封じられない。
    expect(isSuppressed(after, "bob-ult-1")).toBe(true);
    expect(isSuppressed(after, "bob-other-1")).toBe(false);

    // コスト8のこのカードが、召喚コストを払わずフィールドへ出る (costToPay=0)。
    // alice のリザーブは4個しかなく、コスト8が課される旧バグなら insufficient-cost で
    // 召喚が失敗し zone は "burst" のままになる。最低必要コア(levelDefs[0].requiredCores=1)
    // の入場コア配置のみが自動で行われ、リザーブは1個だけ減る。
    const aliceBefore = state.players.find((p) => p.id === "alice")!;
    const aliceAfter = after.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.reserveNormalCoreCount).toBe(
      aliceBefore.reserveNormalCoreCount - 1
    );
    const self = after.cardInstances.find((c) => c.instanceId === "m06-1")!;
    expect(self.zone).toBe("field");
  });
});

describe("BSTH03-R01 effects[1] shape", () => {
  it("stub が消えており、designate→suppress_effect(ref共有)→条件付き任意core_move の3 step", () => {
    const e1 = r01.effects![1]!;
    expect(e1.stub).toBeUndefined();
    expect(e1.steps).toHaveLength(3);
    expect(e1.steps[0]!.id).toBe("designate");
    expect(e1.steps[0]!.action.kind).toBe("prevent_battle");
    const suppress = e1.steps[1]!.action;
    expect(suppress.kind).toBe("suppress_effect");
    if (suppress.kind === "suppress_effect") {
      expect(suppress.target).toEqual({ kind: "ref", stepId: "designate" });
    }
    expect(e1.steps[2]!.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["nexus"],
        colors: ["purple"],
        tribes: ["導界者"],
        grandwalkerKind: "guided",
      },
    ]);
    expect(e1.steps[2]!.executionMode).toBe("optional");
  });
});

describe("BSTH03-R01 effects[1] 実行: 相手ブロック不可+効果封印+紫導界者ネクサスゲート付きコア移動", () => {
  function buildState(hasGuidedNexus: boolean): GameState {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ trashNormalCoreCount: 1 }],
    });
    const src = createCardInstance(r01, {
      instanceId: "r01-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      // Lv4 (requiredCores:3) を満たす。effects[1] は min_level:4 ゲート。
      cores: 3,
    });
    const bobSpirit = createCardInstance(opponentSpiritDef, {
      instanceId: "bob-spirit-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const bobOther = createCardInstance(opponentUltimateDef, {
      instanceId: "bob-other-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const cardInstances = [src, bobSpirit, bobOther];
    if (hasGuidedNexus) {
      cardInstances.push(
        createCardInstance(guidedNexusDef, {
          instanceId: "alice-guided-nexus-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        })
      );
    }
    return { ...base, cardInstances };
  }

  it("紫導界者ネクサスがあるとき: 指定した相手はブロック不可+効果封印され、トラッシュコア1個をライフへ移せる(任意)", () => {
    const state = buildState(true);
    const after = executeEffect({
      chainId: "test:bsth03-m06-r01-designate-seal:241",
      state,
      effect: r01.effects![1]!,
      sourceInstanceId: "r01-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const preventBattle = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "prevent_battle_block" &&
        ce.targetInstanceId === "bob-spirit-1"
    );
    expect(preventBattle).toBeDefined();

    const suppression = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.targetInstanceId === "bob-spirit-1"
    );
    expect(suppression).toBeDefined();

    // CE の存在だけでなく、実際の発揮可否判定 (reevaluation chokepoint) でも封じられている
    // ことを確認する。指定していない他の相手カードは封じられない。
    expect(isSuppressed(after, "bob-spirit-1")).toBe(true);
    expect(isSuppressed(after, "bob-other-1")).toBe(false);

    // 「置ける」= 任意。ゲート成立時は pendingStepOptionalChoice で選択待ちになる。
    expect(after.pendingStepOptionalChoice).not.toBeNull();
    expect(
      after.players.find((p) => p.id === "alice")!.trashNormalCoreCount
    ).toBe(1);
  });

  it("紫導界者ネクサスが無いとき: コア移動の任意選択自体が発生しない (条件ゲートで不発)", () => {
    const state = buildState(false);
    const after = executeEffect({
      chainId: "test:bsth03-m06-r01-designate-seal:277",
      state,
      effect: r01.effects![1]!,
      sourceInstanceId: "r01-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(
      after.players.find((p) => p.id === "alice")!.trashNormalCoreCount
    ).toBe(1);

    const preventBattle = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "prevent_battle_block" &&
        ce.targetInstanceId === "bob-spirit-1"
    );
    expect(preventBattle).toBeDefined();
  });
});

describe("BSTH03-M02 effects[0] / BSTH03-M03 effects[0]: burst→self-summon 回帰 (from_zone:hand 誤配線の修正)", () => {
  it("BSTH03-M02: このカードがコスト無しでバーストゾーンからフィールドへ出る (target:self)", () => {
    const summonStep = m02.effects![0]!.steps.at(-1)!.action;
    expect(summonStep.kind).toBe("summon");
    if (summonStep.kind === "summon") {
      expect(summonStep.target).toEqual({ kind: "self" });
    }

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const src = createCardInstance(m02, {
      instanceId: "m02-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const state: GameState = {
      ...base,
      cardInstances: [
        src,
        createCardInstance(card("BSTH05-C01"), {
          instanceId: "summon-condition-symbol",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const aliceBefore = state.players.find((p) => p.id === "alice")!;

    const after = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth03-m06-r01-designate-seal:328",
      state,
      effect: m02.effects![0]!,
      sourceInstanceId: "m02-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const self = after.cardInstances.find((c) => c.instanceId === "m02-1")!;
    expect(self.zone).toBe("field");
    // コスト8は課されない。effects[0] step1 でボイド→リザーブ+2、召喚の入場最低コア
    // (levelDefs[0].requiredCores=1) 配置で-1、差引+1。もしコスト8が課される旧バグなら
    // リザーブ不足(3+2=5 < 8)で召喚自体が失敗し zone は "burst" のままになる。
    const aliceAfter = after.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.reserveNormalCoreCount).toBe(
      aliceBefore.reserveNormalCoreCount + 1
    );
  });

  it("BSTH03-M03: このカードがコスト無しでバーストゾーンからフィールドへ出る (target:self)", () => {
    const summonStep = m03.effects![0]!.steps.at(-1)!.action;
    expect(summonStep.kind).toBe("summon");
    if (summonStep.kind === "summon") {
      expect(summonStep.target).toEqual({ kind: "self" });
    }

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const src = createCardInstance(m03, {
      instanceId: "m03-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const state: GameState = { ...base, cardInstances: [src] };
    const aliceBefore = state.players.find((p) => p.id === "alice")!;

    const after = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth03-m06-r01-designate-seal:364",
      state,
      effect: m03.effects![0]!,
      sourceInstanceId: "m03-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const self = after.cardInstances.find((c) => c.instanceId === "m03-1")!;
    expect(self.zone).toBe("field");
    const aliceAfter = after.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.reserveNormalCoreCount).toBe(
      aliceBefore.reserveNormalCoreCount - 1
    );
  });
});

function findSelfSummonEffect(def: CardDefinition) {
  const effect = def.effects!.find(
    (e) => e.steps.at(-1)?.action.kind === "summon"
  );
  if (!effect) throw new Error(`no self-summon effect found for ${def.cardNo}`);
  return effect;
}

describe.each([
  ["BSTH02-M03", bsth02m03],
  ["BSTH02-X04", bsth02x04],
  ["BSTH04-R02", bsth04r02],
  ["BSTH05-M04", bsth05m04],
] as const)(
  "%s burst→self-summon 回帰 (from_zone:hand 誤配線の修正)",
  (cardNo, def) => {
    it(`${cardNo}: summon step は target:{kind:"self"}`, () => {
      const effect = findSelfSummonEffect(def);
      const summonStep = effect.steps.at(-1)!.action;
      expect(summonStep.kind).toBe("summon");
      if (summonStep.kind === "summon") {
        expect(summonStep.target).toEqual({ kind: "self" });
      }
    });

    it(`${cardNo}: バーストゾーンからコスト無しでフィールドへ出る`, () => {
      const effect = findSelfSummonEffect(def);
      const instanceId = `${cardNo}-src`;
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const src = createCardInstance(def, {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "burst",
      });
      const state: GameState = { ...base, cardInstances: [src] };

      const after = executeEffect({
        chainId: "test:bsth03-m06-r01-designate-seal:418",
        state,
        effect,
        sourceInstanceId: instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById,
      });

      const self = after.cardInstances.find(
        (c) => c.instanceId === instanceId
      )!;
      expect(self.zone).toBe("field");
    });
  }
);
