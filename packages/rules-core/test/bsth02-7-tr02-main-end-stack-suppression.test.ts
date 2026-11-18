/**
 * BSTH02.7-TR02(A) アリスのマトリョーシカ [6,7] Lv3『自分のメインステップ終了時』
 *   「自分の手札/手元/トラッシュにある黄1色のカード1枚を除外することで、このターン中の
 *    次のバトル終了後まで、相手はスタック効果を発揮できず、このスピリットは可能なら
 *    このターンの最初にアタックする。」
 *
 * step0 = remove_from_game(target: zone:[hand,set_aside,trash] + colors:[yellow]+colorCount:"mono")、
 * step1 = restrict_stack(player:"opponent", duration:{scope:"battle", untilTurnEnd:true})、
 * step2 = force_first_attacker(target:"self")。
 * duration の untilTurnEnd は model.ts:663-667 の定義通り「このターン中の次のバトル終了後まで」を表す
 * (BSDB01-M02 と同型の restrict_stack 用法)。
 * 「このスピリットは可能ならこのターンの最初にアタックする」=
 * force_first_attacker CE (ENGINE-force-first-attack-this-turn)。他カードのアタック宣言legality
 * は getAttackDeclarationBlockReason で検証する
 * (packages/rules-core/test/force-first-attacker.test.ts)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

describe("BSTH02.7-TR02(A) アリスのマトリョーシカ — メインステップ終了時 除外+スタック抑止", () => {
  const c = card("BSTH02.7-TR02(A)");
  const endEffect = c.effects![2]!;

  it("構造: timing=phase(main,end) + min_level:3、step0=remove_from_game(黄1色/hand+set_aside+trash)、step1=restrict_stack(untilTurnEnd)、step2=force_first_attacker", () => {
    expect(endEffect.timing).toEqual({
      kind: "phase",
      step: "main",
      subPhase: "end",
      whose: "self",
    });
    expect(endEffect.condition).toEqual([{ kind: "min_level", value: 3 }]);
    expect(endEffect.stub).toBeUndefined();

    const removeStep = endEffect.steps[0]!.action;
    expect(removeStep.kind).toBe("remove_from_game");
    if (removeStep.kind === "remove_from_game") {
      const target = removeStep.target;
      expect(target.kind).toBe("filter");
      if (target.kind === "filter") {
        expect(target.zone).toEqual(["hand", "set_aside", "trash"]);
        expect(target.count).toBe(1);
        expect(target.filter.colors).toEqual(["yellow"]);
        expect(target.filter.colorCount).toBe("mono");
      }
    }

    const restrictStep = endEffect.steps[1]!.action;
    expect(restrictStep.kind).toBe("restrict_stack");
    if (restrictStep.kind === "restrict_stack") {
      expect(restrictStep.player).toBe("opponent");
      expect(restrictStep.duration).toEqual({
        scope: "battle",
        untilTurnEnd: true,
      });
    }

    const forceFirstAttackerStep = endEffect.steps[2]!.action;
    expect(forceFirstAttackerStep.kind).toBe("force_first_attacker");
    if (forceFirstAttackerStep.kind === "force_first_attacker") {
      expect(forceFirstAttackerStep.target).toBe("self");
    }
  });

  it("[board] 手札の黄1色カード1枚を除外し、相手のスタック効果を次バトル終了後まで抑止する", () => {
    const src = createCardInstance(c, {
      instanceId: "matryoshka",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv3 (min_level:3 を満たす)
    });
    const yellowMonoHandCard = createCardInstance(card("BSTH02.7-C01"), {
      instanceId: "alice-hand-yellow",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      cardInstances: [src, yellowMonoHandCard],
      playerOverrides: [{}, {}],
    });

    const after = executeEffect({
      chainId: "test:bsth02-7-tr02-main-end-stack-suppression:97",
      state: before,
      effect: endEffect,
      sourceInstanceId: "matryoshka",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    // 除外: 手札の黄1色カードが removed_from_game ゾーンへ。
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-hand-yellow")!
        .zone
    ).toBe("removed_from_game");

    // 相手はスタック効果を発揮できない CE が登録される (untilTurnEnd の battle scope)。
    const restrictCE = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_stack"
    );
    expect(restrictCE).toBeDefined();
    expect(restrictCE!.duration).toEqual({
      scope: "battle",
      untilTurnEnd: true,
    });

    // このスピリット自身を今ターンの最初のアタッカーとして強制する CE も登録される。
    const forceFirstAttackerCE = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "force_first_attacker"
    );
    expect(forceFirstAttackerCE).toBeDefined();
    expect(forceFirstAttackerCE!.targetInstanceId).toBe("matryoshka");
    expect(forceFirstAttackerCE!.duration).toEqual({ scope: "turn" });
    void alice;
  });
});
