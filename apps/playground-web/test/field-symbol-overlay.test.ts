import snapshot from "../../../packages/rules-core/test/fixtures/field-symbol-extension-snapshot.json";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  calculateReduction,
  getFieldSymbolSources,
  recomputeAndRebuildContinuousEffects,
  rebuildContinuousEffectsFromField,
  type GameState,
  moveCardZone,
  sanitizeStateForViewer,
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
} from "@orica/rules-core";
import { ALL_CARDS } from "@orica/card-data";
import { FieldArea } from "../src/components/FieldArea";
import { combinedSymbolFixture } from "../../../packages/rules-core/test/helpers/combined-symbol-fixture";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getDefinition = (id: string) => definitions.get(id);
const payingCard: CardDefinition = {
  ...definitions.get("BSGE01-CX01")!,
  cost: 4,
  reductionSymbols: ["red", "red", "red"],
};

describe("field symbol overlay", () => {
  it("固定・仮想合体・左右合体も軽減と同じバンドルを表示する", () => {
    const { state, host, brave, getDef, ce } = combinedSymbolFixture();
    const render = (current: typeof state) =>
      renderToStaticMarkup(
        React.createElement(FieldArea, {
          state: current,
          cards: current.cardInstances,
          getDefinition: getDef,
          playerId: "alice",
          symbolOverlayMode: true,
        })
      );
    const right = {
      ...state,
      cardInstances: [
        { ...host, attachedChildrenIds: [] },
        {
          ...brave,
          attachedToInstanceId: null,
          imaginRightCombinedWith: host.instanceId,
        },
      ],
      activeContinuousEffects: [
        ce({
          metadata: {
            properties: { virtualAttachedBraves: [{ symbols: ["green"] }] },
          },
        }),
      ],
    };
    expect(render(right)).toMatch(/card-symbol-overlay-chunk[^>]*>青1<\/span>/);
    expect(render(right)).toMatch(/card-symbol-overlay-chunk[^>]*>緑1<\/span>/);
    const fixed = {
      ...right,
      activeContinuousEffects: [
        ...right.activeContinuousEffects,
        ce({
          effectId: "fixed",
          metadata: { properties: { symbols: [], symbolCountFixed: true } },
        }),
      ],
    };
    expect(render(fixed)).not.toContain('class="card-symbol-overlay"');
  });
  for (const category of ["spirit", "ultimate", "nexus"] as const) {
    for (const owner of ["alice", "bob"]) {
      it(`${owner} ${category}: 合体ブレイヴのシンボルをhostに表示する`, () => {
        const { state, getDef } = combinedSymbolFixture(category, owner);
        const markup = renderToStaticMarkup(
          React.createElement(FieldArea, {
            state,
            cards: state.cardInstances,
            getDefinition: getDef,
            playerId: owner,
            symbolOverlayMode: true,
          })
        );
        expect(markup).toMatch(/card-symbol-overlay-chunk[^>]*>青1<\/span>/);
        expect(markup.match(/class="card-symbol-overlay"/g)).toHaveLength(1);
      });
    }
  }
  for (const category of ["spirit", "nexus"] as const) {
    it(`${category}: soul-state symbols are absent from both the overlay and reduction sources`, () => {
      const definition: CardDefinition = {
        ...definitions.get("BSGE01-CX01")!,
        printedCategory: category,
      };
      const card = createCardInstance(definition, {
        instanceId: "soul-card",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      });
      const lookup = (id: string) =>
        id === definition.cardNo ? definition : getDefinition(id);
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [card],
        playerOverrides: [{ soulStateInstanceIds: [card.instanceId] }, {}],
      });
      const render = (currentState: typeof state) =>
        renderToStaticMarkup(
          React.createElement(FieldArea, {
            state: currentState,
            cards: currentState.cardInstances,
            getDefinition: lookup,
            playerId: "alice",
            symbolOverlayMode: true,
          })
        );
      const reduction = (currentState: typeof state) =>
        calculateReduction({
          state: currentState,
          actingPlayerId: "alice",
          card: payingCard,
          getCardDefinitionById: lookup,
        });

      expect(reduction(state).fieldSymbolSources).toEqual([]);
      expect(reduction(state).finalCost).toBe(4);
      expect(render(state)).toContain("card-soul-state");
      expect(render(state)).not.toContain('class="card-symbol-overlay"');

      const activeState = {
        ...state,
        players: state.players.map((player) => ({
          ...player,
          soulStateInstanceIds: [],
        })),
        cardInstances: [{ ...card, normalCoreCount: 1 }],
      };
      expect(reduction(activeState).finalCost).toBe(3);
      expect(render(activeState)).toContain('class="card-symbol-overlay"');
    });
  }
});

describe("extended field symbol overlay", () => {
  const snapshotState = snapshot.state as GameState;
  const render = (state: GameState, owner = "alice", enabled = true) =>
    renderToStaticMarkup(
      React.createElement(FieldArea, {
        state,
        cards: state.cardInstances,
        getDefinition,
        playerId: owner,
        isOpponent: owner === "bob",
        symbolOverlayMode: enabled,
      })
    );
  it("実スナップショットでは空のフィールドに手元C20の赤1を浮かせ、手元カードも残す", () => {
    const html = render(snapshotState);
    expect(html).toContain('data-testid="field-extended-symbols-alice"');
    expect(html).toContain('data-symbol-source-id="card-5"');
    expect(html).toMatch(/card-symbol-overlay-chunk[^>]*>赤1<\/span>/);
    expect(html).toContain('data-testid="set-aside-alice"');
    expect(
      snapshotState.cardInstances.find((card) => card.instanceId === "card-5")
        ?.zone
    ).toBe("set_aside");
    expect(snapshotState.battleEntities).toEqual([]);
    expect(
      getFieldSymbolSources({
        state: snapshotState,
        actingPlayerId: "alice",
        getCardDefinitionById: getDefinition,
      }).map((source) => source.sourceInstanceId)
    ).toEqual(["card-5"]);
  });
  it("トグルOFF・相手のフィールドには自分の拡張を表示しない", () => {
    expect(render(snapshotState, "alice", false)).not.toContain(
      "field-extended-symbols"
    );
    expect(render(snapshotState, "bob")).not.toContain(
      "field-extended-symbols"
    );
  });
  it("相手の公開手元にも表示し、効果元が離れれば消える", () => {
    const publicState = sanitizeStateForViewer(snapshotState, "bob");
    expect(render(publicState)).toContain('data-symbol-source-id="card-5"');
    const left = recomputeAndRebuildContinuousEffects(
      moveCardZone(snapshotState, "card-5", "trash"),
      getDefinition
    );
    expect(render(left)).not.toContain("field-extended-symbols");
  });
  it("X01召喚限定の手元参照は常時の浮いたシンボルにしない", () => {
    const x01 = definitions.get("BSTH08.5-X01")!;
    const c20 = definitions.get("BSTH08.5-C20")!;
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(x01, {
            instanceId: "x01",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(c20, {
            instanceId: "c20",
            ownerPlayerId: "alice",
            zone: "set_aside",
          }),
        ],
      }),
      getDefinition
    );
    // C20を離すとX01の限定CEだけが残る。他の面霊ブレイヴは引き続き手元に置く。
    const brave = definitions.get("BSTH08.5-C21")!;
    state.cardInstances.push(
      createCardInstance(brave, {
        instanceId: "brave",
        ownerPlayerId: "alice",
        zone: "set_aside",
      })
    );
    const onlyScoped = recomputeAndRebuildContinuousEffects(
      moveCardZone(state, "c20", "trash"),
      getDefinition
    );
    expect(render(onlyScoped)).not.toContain("field-extended-symbols");
    expect(
      getFieldSymbolSources({
        state: onlyScoped,
        actingPlayerId: "alice",
        sourceInstanceId: "x01",
        getCardDefinitionById: getDefinition,
      }).map((source) => source.sourceInstanceId)
    ).toEqual(["brave"]);
  });
});
