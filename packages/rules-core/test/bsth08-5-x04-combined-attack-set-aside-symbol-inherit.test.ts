/**
 * BSTH08.5-X04 希望の面 effects[2]
 * 「【合体中】『このスピリットのアタック時』このスピリットに自分の手元にある
 *  系統：「面霊」を持つブレイヴカードすべてのシンボルを追加する。」
 *
 * = symbol_add(target:self, symbolSource:{kind:"zone_symbols", zone:"set_aside",
 *   player:"self", filter:{category:["brave"], tribes:["面霊"]}}, duration:{scope:"battle"})。
 * SymbolDynamicSource "zone_symbols" (under_card_symbols のホスト非依存/任意ゾーン+CardFilter
 * 一般化版) の新規実装カバレッジを兼ねる。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import { getEffectiveSymbols } from "../src/battle/battle-shared";
import type { CardDefinition, GameState } from "../src";

const ALICE = "player-1";
const BOB = "player-2";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

describe("BSTH08.5-X04 effects[2] 合体中アタック時: 手元の面霊ブレイヴのシンボルを追加", () => {
  function makeState(setAsideCards: ReturnType<typeof createCardInstance>[]): {
    state: GameState;
    hostId: string;
  } {
    const hostId = "host-x01";
    const braveId = "brave-x04";
    const host = createCardInstance(card("BSTH08.5-X01"), {
      instanceId: hostId,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    host.attachedChildrenIds = [braveId];
    const brave = createCardInstance(card("BSTH08.5-X04"), {
      instanceId: braveId,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    brave.attachedToInstanceId = hostId;
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [host, brave, ...setAsideCards],
    };
    return { state, hostId };
  }

  it("手元の面霊ブレイヴ2枚(各赤シンボル1)のシンボルをホストへ個別加算する", () => {
    const filler1 = createCardInstance(card("BSTH08.5-C20"), {
      instanceId: "set-aside-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const filler2 = createCardInstance(card("BSTH08.5-C22"), {
      instanceId: "set-aside-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const { state, hostId } = makeState([filler1, filler2]);
    const braveDef = card("BSTH08.5-X04");
    const combinedEffect = braveDef.effects!.find(
      (e) => e.applicability?.combined === true
    )!;
    expect(combinedEffect.stub).toBeUndefined();

    const result = executeEffect({
      chainId: "test:bsth08-5-x04-combined-attack-set-aside-symbol-inherit:84",
      state,
      effect: combinedEffect,
      sourceInstanceId: "brave-x04",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const ce = result.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "symbol_addition" && c.targetInstanceId === hostId
    );
    expect(ce).toBeDefined();
    expect(ce?.modifierSymbolSource).toEqual({
      kind: "zone_symbols",
      playerId: ALICE,
      zone: "set_aside",
      filter: { category: ["brave"], tribes: ["面霊"] },
    });

    const hostAfter = result.cardInstances.find(
      (c) => c.instanceId === hostId
    )!;
    const symbols = getEffectiveSymbols(
      result,
      hostAfter,
      card("BSTH08.5-X01"),
      getDef
    );
    // base (印字 red 1) + 手元面霊ブレイヴ2枚分 (各 red 1) = red 3。
    expect(symbols.filter((s) => s === "red")).toHaveLength(3);
  });

  it("手元にあっても系統:面霊でないカードは加算対象外", () => {
    const nonMatchingTribe = createCardInstance(card("BSTH08.5-X01"), {
      instanceId: "set-aside-non-matching",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const { state, hostId } = makeState([nonMatchingTribe]);
    const braveDef = card("BSTH08.5-X04");
    const combinedEffect = braveDef.effects!.find(
      (e) => e.applicability?.combined === true
    )!;

    const result = executeEffect({
      chainId: "test:bsth08-5-x04-combined-attack-set-aside-symbol-inherit:130",
      state,
      effect: combinedEffect,
      sourceInstanceId: "brave-x04",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const hostAfter = result.cardInstances.find(
      (c) => c.instanceId === hostId
    )!;
    const symbols = getEffectiveSymbols(
      result,
      hostAfter,
      card("BSTH08.5-X01"),
      getDef
    );
    // spirit (printedCategory) はブレイヴでないため filter (category:["brave"]) 不一致で
    // 加算されない。base (印字 red 1) のみ。
    expect(symbols.filter((s) => s === "red")).toHaveLength(1);
  });

  it("手元でなく手札にある面霊ブレイヴは加算対象外（zone 限定）", () => {
    const inHand = createCardInstance(card("BSTH08.5-C20"), {
      instanceId: "hand-not-set-aside",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const { state, hostId } = makeState([inHand]);
    const braveDef = card("BSTH08.5-X04");
    const combinedEffect = braveDef.effects!.find(
      (e) => e.applicability?.combined === true
    )!;

    const result = executeEffect({
      chainId: "test:bsth08-5-x04-combined-attack-set-aside-symbol-inherit:165",
      state,
      effect: combinedEffect,
      sourceInstanceId: "brave-x04",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const hostAfter = result.cardInstances.find(
      (c) => c.instanceId === hostId
    )!;
    const symbols = getEffectiveSymbols(
      result,
      hostAfter,
      card("BSTH08.5-X01"),
      getDef
    );
    expect(symbols.filter((s) => s === "red")).toHaveLength(1);
  });
});
