/**
 * BSTH02-R02/R03 continuous effect_immunity stub 解消。
 *
 * R02 (Lv2-Lv3): 「自分の手札は相手の効果を受けない。」
 *   BSTH02.7-C03 (ENGINE-effect-immunity-hand-zone-scope) と同型の zone:["hand"] 免疫。
 *   set_aside(手元) は含まないため zone は hand のみ。
 *
 * R03 (Lv2-Lv3): 「系統：「冥主」を持つ自分のスピリットすべては、相手のバースト効果を持つ
 *   スピリット/アルティメットの効果を受けない。」発生源スコープに categories だけでなく
 *   印字バースト系ヘッダを要求する複合条件。
 *   `ContinuousEffect.immunitySourceScope.hasBurstEffect` / dsl-types.ts
 *   `EffectImmunityAction.sourceScope.hasBurstEffect` を使う。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
) {
  return executeEffect({
    chainId: "test:bsth02-r02-r03-continuous-immunity:35",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

describe("BSTH02-R02 メルラン・プリズムリバー effects[2] shape", () => {
  const card = cardNoMap.get("BSTH02-R02")!;
  const effect = card.effects![2]!;

  it("Lv2以上 condition、stub 解消済み", () => {
    expect(effect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(effect.stub).toBeUndefined();
  });

  it("steps[0] = effect_immunity(target.zone:[hand], count:all, while_on_field)", () => {
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({
        kind: "filter",
        player: "self",
        filter: {},
        count: "all",
        zone: ["hand"],
      });
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });
});

describe("BSTH02-R02 効果実行後の盤面変化 (手札ゾーン免疫、手元は対象外)", () => {
  const card = cardNoMap.get("BSTH02-R02")!;
  const effect = card.effects![2]!;

  function setUp(requiredCores: number) {
    const self = createCardInstance(card, {
      instanceId: "merlin-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: requiredCores,
    });
    const handCard = createCardInstance(card, {
      instanceId: "alice-hand-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const setAsideCard = createCardInstance(card, {
      instanceId: "alice-setaside-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "set_aside",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [self, handCard, setAsideCard],
    };
    const next = runEffect(state, effect, "merlin-1", "alice");
    return {
      state: next,
      handCard: next.cardInstances.find(
        (c) => c.instanceId === "alice-hand-1"
      )!,
      setAsideCard: next.cardInstances.find(
        (c) => c.instanceId === "alice-setaside-1"
      )!,
    };
  }

  it("Lv2: 手札カードは相手起因効果に免疫成立", () => {
    const { state, handCard } = setUp(2);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        handCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("Lv2: 手元(set_aside)カードはゾーン対象外のため免疫不成立(R02は手札のみ)", () => {
    const { state, setAsideCard } = setUp(2);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        setAsideCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("Lv1 (min_level条件不成立): 免疫は登録されない", () => {
    const { state, handCard } = setUp(1);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        handCard,
        "bob",
        "none",
        undefined,
        getCardDefinitionById
      )
    ).toBe(false);
  });
});

describe("BSTH02-R03 ルナサ・プリズムリバー effects[2] shape", () => {
  const card = cardNoMap.get("BSTH02-R03")!;
  const effect = card.effects![2]!;

  it("Lv2以上 condition、stub 解消済み", () => {
    expect(effect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(effect.stub).toBeUndefined();
  });

  it("steps[0] = effect_immunity(target:冥主スピリット, sourceScope:categories+hasBurstEffect)", () => {
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.target).toEqual({
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"], tribes: ["冥主"] },
        count: "all",
      });
      expect(action.duration).toEqual({ scope: "while_on_field" });
      expect(action.sourceScope).toEqual({
        categories: ["spirit", "ultimate"],
        hasBurstEffect: true,
      });
    }
  });
});

describe("BSTH02-R03 効果実行後の盤面変化 (バースト持ちスピリット/アルティメット限定免疫)", () => {
  const card = cardNoMap.get("BSTH02-R03")!;
  const effect = card.effects![2]!;
  // BSLH01-M03: printedCategory spirit, 印字【バースト】あり (category+hasBurstEffect 両方一致)
  const burstSpirit = cardNoMap.get("BSLH01-M03")!;
  // BSLH01-T06: printedCategory ultimate, keywordTags:["burst","token"] だが印字バーストヘッダなし
  const burstTaggedUltimateWithoutBurstEffect = cardNoMap.get("BSLH01-T06")!;
  // BSDB01-C07: printedCategory nexus, keywordTags:["burst"] (keyword一致、category不一致)
  const burstNexus = cardNoMap.get("BSDB01-C07")!;
  // BSTH01-C01: printedCategory spirit, 印字バーストヘッダなし (category一致、hasBurstEffect不一致)
  const nonBurstSpirit = cardNoMap.get("BSTH01-C01")!;

  function setUp(requiredCores: number) {
    const self = createCardInstance(card, {
      instanceId: "lunasa-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: requiredCores,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [self],
    };
    return runEffect(state, effect, "lunasa-1", "alice");
  }

  it("Lv2 + 発生源が印字バースト持ちスピリット: 免疫成立", () => {
    const state = setUp(2);
    const target = state.cardInstances.find(
      (c) => c.instanceId === "lunasa-1"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        state,
        target,
        "bob",
        "none",
        { definition: burstSpirit },
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("発生源が category:ultimate + keywordTags:burst でも印字バーストヘッダ無しは対象外", () => {
    const state = setUp(2);
    const target = state.cardInstances.find(
      (c) => c.instanceId === "lunasa-1"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        state,
        target,
        "bob",
        "none",
        { definition: burstTaggedUltimateWithoutBurstEffect },
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("発生源がバースト持ちでも category:nexus は対象外 (categories 不一致)", () => {
    const state = setUp(2);
    const target = state.cardInstances.find(
      (c) => c.instanceId === "lunasa-1"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        state,
        target,
        "bob",
        "none",
        { definition: burstNexus },
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("発生源が spirit でも burst キーワード無しは対象外 (keywords 不一致)", () => {
    const state = setUp(2);
    const target = state.cardInstances.find(
      (c) => c.instanceId === "lunasa-1"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        state,
        target,
        "bob",
        "none",
        { definition: nonBurstSpirit },
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("Lv1 (min_level条件不成立): 免疫は登録されない", () => {
    const state = setUp(1);
    const target = state.cardInstances.find(
      (c) => c.instanceId === "lunasa-1"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        state,
        target,
        "bob",
        "none",
        { definition: burstSpirit },
        getCardDefinitionById
      )
    ).toBe(false);
  });
});
