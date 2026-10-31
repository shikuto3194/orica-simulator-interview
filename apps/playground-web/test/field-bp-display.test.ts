import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  type GameState,
} from "@orica/rules-core";
import { FieldArea } from "../src/components/FieldArea";
import { CardView } from "../src/components/CardView";

const definitions = new Map(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((d) => [d.cardNo, d])
);
const getDefinition = (id: string) => definitions.get(id);
function setup(cardNo: string, amount = 0) {
  const definition = getDefinition(cardNo)!;
  const card = createCardInstance(definition, {
    instanceId: "bp-target",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 3,
  });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [card],
  });
  state.activeContinuousEffects.push({
    effectId: "bp-reduction",
    sourceInstanceId: "source",
    sourceDefinitionId: "BSGE01-C08",
    actingPlayerId: "bob",
    targetInstanceId: card.instanceId,
    modifierTag: "bp_modifier",
    modifierAmount: amount,
    duration: { scope: "turn" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: null,
  });
  return { state, card, definition };
}
function renderField(state: GameState) {
  return renderToStaticMarkup(
    React.createElement(FieldArea, {
      state,
      cards: state.cardInstances,
      getDefinition,
      playerId: "alice",
    })
  );
}

describe("フィールドのBP0表示", () => {
  it.each(["BSSA01-転醒X03(A)", "BSSA01-転醒X03(B)", "BSGE01-C08"])(
    "%s: BPが0でもバッジを表示する",
    (cardNo) => {
      expect(renderField(setup(cardNo, -50000).state)).toContain(
        '<span class="bp-value">0</span>'
      );
    }
  );
  it("B面Lv2の通常BP16000も表示する", () => {
    expect(renderField(setup("BSSA01-転醒X03(B)").state)).toContain(
      '<span class="bp-value">16000</span>'
    );
  });
  it("BPを持たないネクサスと場外カードにはBP0を表示しない", () => {
    const { state, card, definition } = setup("BSGE01-C09");
    expect(renderField(state)).not.toContain('class="bp-value"');
    expect(
      renderToStaticMarkup(React.createElement(CardView, { card, definition }))
    ).not.toContain('class="bp-value"');
    const spirit = setup("BSSA01-転醒X03(B)");
    expect(
      renderToStaticMarkup(
        React.createElement(CardView, {
          card: { ...spirit.card, zone: "hand" },
          definition: spirit.definition,
        })
      )
    ).not.toContain('class="bp-value"');
  });
});

describe("魂状態と特殊配置のBP/Lvバッジ", () => {
  it("計算済みBP/Lvが渡っても魂状態では両バッジを表示しない", () => {
    const { state, card, definition } = setup("BSGE01-CX01");
    state.players[0]!.soulStateInstanceIds = [card.instanceId];
    for (const html of [
      renderField(state),
      renderToStaticMarkup(
        React.createElement(CardView, {
          card,
          definition,
          isSoulState: true,
          resolvedBp: 0,
          resolvedLevel: 2,
        })
      ),
    ]) {
      expect(html).not.toContain('class="bp-value"');
      expect(html).not.toContain('class="card-level-badge"');
    }
  });
  it("正体が非公開のスピリット扱いtokenでも計算済みBP0を表示する", () => {
    const { card } = setup("BSSA01-X01");
    const html = renderToStaticMarkup(
      React.createElement(CardView, {
        card: { ...card, faceDown: true, definitionId: "_hidden_card_" },
        definition: undefined,
        resolvedBp: 0,
        resolvedLevel: 2,
      })
    );
    expect(html).toContain('<span class="bp-value">0</span>');
  });
  it("異魔神の左右の共有バッジもBP0を表示し、魂状態ではBP/Lvを隠す", () => {
    const { state, card } = setup("BSSA01-転醒X03(A)", -50000);
    const right = { ...card, instanceId: "bp-right" };
    const brave = createCardInstance(getDefinition("BSTH001-転醒R01(B)")!, {
      instanceId: "shared-brave",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
      attachedToInstanceId: card.instanceId,
      imaginRightCombinedWith: right.instanceId,
    });
    card.attachedChildrenIds = [brave.instanceId];
    state.cardInstances.push(right, brave);
    state.activeContinuousEffects.push({
      ...state.activeContinuousEffects[0]!,
      effectId: "right-bp",
      targetInstanceId: right.instanceId,
    });
    const overlays = (html: string) =>
      [
        ...html.matchAll(
          /shared-field-anchor-badges-slot-(?:left|right)[\s\S]*?<span class="bp-value">(\d+)<\/span>/g
        ),
      ].map((m) => m[1]);
    expect(overlays(renderField(state))).toEqual(["0", "0"]);
    state.players[0]!.soulStateInstanceIds = [
      card.instanceId,
      right.instanceId,
    ];
    expect(overlays(renderField(state))).toEqual([]);
    expect(renderField(state)).not.toContain('class="card-level-badge"');
  });
});
