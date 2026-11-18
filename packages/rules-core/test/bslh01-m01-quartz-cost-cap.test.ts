/**
 * BSLH01-M01「[碧の軌跡]リーシャ・マオ」effects[2]
 * 【クォーツ：精神3】「自分のトークンマジックの『破壊効果』/『疲労効果』のコスト上限を+3する。」検証。
 *
 * 実装: effect_param_modify (P3-14 A-7) の cost_destroy/cost_exhaust variant を
 * scope: "player_cards" (本カードで新設、ContinuousEffect.targetFilter の
 * player+CardFilter を再利用) + cardFilter:{category:magic, isToken:true} で表現
 * (engine-cost-cap-modifier-ability-category)。クォーツが soulState にセットされて
 * いる間のみ CE が立つ (applicability.soulState、BSLH01-X08 precedent と同型)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyEffectParamOverridesToFilter,
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const M01 = ALL_CARDS.find((c) => c.cardNo === "BSLH01-M01")!;
const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

// isToken 判定 (SSOT: isCardDefinitionToken = maxTokenDeckCount !== undefined) を
// 満たす合成トークンマジック定義。現行カードプールに「コスト破壊/疲労効果」を
// 持つトークンマジックは未実装のため、CardFilter/effect_param_override 側の
// 一般性 (scope:"player_cards" が任意の maxCost 付き destroy/exhaust に効くこと) を
// 検証する目的で合成する。
const tokenMagicBase: CardDefinition = {
  cardNo: "TEST-TOKEN-MAGIC",
  name: "テスト・トークンマジック",
  printedCategory: "magic",
  colors: ["purple"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  maxTokenDeckCount: 3,
};
const nonTokenMagic: CardDefinition = {
  ...tokenMagicBase,
  cardNo: "TEST-NON-TOKEN-MAGIC",
  name: "テスト・非トークンマジック",
  maxTokenDeckCount: undefined,
};
cardNoMap.set(tokenMagicBase.cardNo, tokenMagicBase);
cardNoMap.set(nonTokenMagic.cardNo, nonTokenMagic);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSLH01-M01【クォーツ：精神3】コスト破壊/疲労効果の上限+3", () => {
  it("effects[2]: applicability.soulState + cost_destroy/cost_exhaust の 2 step、scope:player_cards + cardFilter:{magic,isToken}", () => {
    const e = M01.effects![2]!;
    expect(e.stub).toBeUndefined();
    expect(e.applicability).toEqual({ soulState: true });
    expect(e.timing).toEqual({ kind: "continuous" });
    expect(e.steps).toHaveLength(2);

    const destroyStep = e.steps[0]!.action;
    expect(destroyStep.kind).toBe("effect_param_modify");
    if (destroyStep.kind === "effect_param_modify") {
      expect(destroyStep.effectClass).toBe("cost_destroy");
      expect(destroyStep.scope).toBe("player_cards");
      expect(destroyStep.cardFilter).toEqual({
        category: ["magic"],
        isToken: true,
      });
      expect(destroyStep.addLimitAmount).toBe(3);
      expect(destroyStep.duration).toEqual({ scope: "while_on_field" });
    }

    const exhaustStep = e.steps[1]!.action;
    expect(exhaustStep.kind).toBe("effect_param_modify");
    if (exhaustStep.kind === "effect_param_modify") {
      expect(exhaustStep.effectClass).toBe("cost_exhaust");
      expect(exhaustStep.scope).toBe("player_cards");
      expect(exhaustStep.cardFilter).toEqual({
        category: ["magic"],
        isToken: true,
      });
      expect(exhaustStep.addLimitAmount).toBe(3);
    }
  });

  it("[board] soulState にセットされている間だけ effect_param_override CE (cost_destroy + cost_exhaust) が2件立つ", () => {
    const source = createCardInstance(M01, {
      instanceId: "m01-quartz-1",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({ cardInstances: [source] });

    const soulSet: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "player-1"
          ? { ...p, soulStateInstanceIds: ["m01-quartz-1"] }
          : p
      ),
    };
    const afterSet = rebuildContinuousEffectsFromField(
      soulSet,
      getCardDefinitionById
    );
    const overrideCEs = afterSet.activeContinuousEffects.filter(
      (ce) =>
        ce.sourceInstanceId === "m01-quartz-1" &&
        ce.modifierTag === "effect_param_override"
    );
    expect(overrideCEs).toHaveLength(2);
    const classes = overrideCEs
      .map((ce) => (ce.metadata as Record<string, unknown>)?.effectClass)
      .sort();
    expect(classes).toEqual(["cost_destroy", "cost_exhaust"]);
    for (const ce of overrideCEs) {
      expect((ce.metadata as Record<string, unknown>)?.scope).toBe(
        "player_cards"
      );
      expect(ce.targetFilter).toEqual({
        player: "self",
        category: ["magic"],
        isToken: true,
      });
    }

    const notSet: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "player-1" ? { ...p, soulStateInstanceIds: [] } : p
      ),
    };
    const afterUnset = rebuildContinuousEffectsFromField(
      notSet,
      getCardDefinitionById
    );
    expect(
      afterUnset.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "m01-quartz-1" &&
          ce.modifierTag === "effect_param_override"
      )
    ).toHaveLength(0);
  });

  it("[board] 自分のトークンマジックの『コスト破壊効果』/『コスト疲労効果』の maxCost のみ+3される（非トークン/相手カードは対象外）", () => {
    const source = createCardInstance(M01, {
      instanceId: "m01-quartz-2",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 0,
    });
    const ownToken = createCardInstance(tokenMagicBase, {
      instanceId: "own-token-magic",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
    });
    const ownNonToken = createCardInstance(nonTokenMagic, {
      instanceId: "own-non-token-magic",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
    });
    const opponentToken = createCardInstance(tokenMagicBase, {
      instanceId: "opponent-token-magic",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
    });
    const base = createEmptyGameState({
      cardInstances: [source, ownToken, ownNonToken, opponentToken],
    });
    const soulSet: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "player-1"
          ? { ...p, soulStateInstanceIds: ["m01-quartz-2"] }
          : p
      ),
    };
    const state = rebuildContinuousEffectsFromField(
      soulSet,
      getCardDefinitionById
    );

    const destroyFilter = { category: ["magic"] as const, maxCost: 4 };
    // 自分のトークンマジック起点: 4 → 7 (+3)
    expect(
      applyEffectParamOverridesToFilter(
        destroyFilter,
        "cost_destroy",
        "own-token-magic",
        state,
        getCardDefinitionById
      ).maxCost
    ).toBe(7);
    // 自分の非トークンマジック起点: 対象外、変化なし
    expect(
      applyEffectParamOverridesToFilter(
        destroyFilter,
        "cost_destroy",
        "own-non-token-magic",
        state,
        getCardDefinitionById
      ).maxCost
    ).toBe(4);
    // 相手のトークンマジック起点: 対象外、変化なし
    expect(
      applyEffectParamOverridesToFilter(
        destroyFilter,
        "cost_destroy",
        "opponent-token-magic",
        state,
        getCardDefinitionById
      ).maxCost
    ).toBe(4);

    const exhaustFilter = { category: ["magic"] as const, maxCost: 2 };
    expect(
      applyEffectParamOverridesToFilter(
        exhaustFilter,
        "cost_exhaust",
        "own-token-magic",
        state,
        getCardDefinitionById
      ).maxCost
    ).toBe(5);
  });
});
