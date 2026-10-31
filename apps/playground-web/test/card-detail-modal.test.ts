import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ALL_CARDS } from "@orica/card-data";
import {
  createCardInstance,
  createEmptyGameState,
  synthesizeBackFaceDefinition,
  type CardDefinition,
  type CardInstance,
  type GameState,
} from "@orica/rules-core";
import {
  CardDetailModal,
  resolveCardDetailFaceState,
  resolveCombinedBraveCurrentState,
  resolvePrintedCombinedBoostDisplay,
} from "../src/components/CardDetailModal";
import { combinedSymbolFixture } from "../../../packages/rules-core/test/helpers/combined-symbol-fixture";

describe("CardDetailModal copied combined symbols", () => {
  it.each([false, true])(
    "分身の合体・多色シンボルを表示する（相手公開表示=%s）",
    (hidden) => {
      const { state, host, brave, hostDef, getDef, ce } =
        combinedSymbolFixture();
      const token = createCardInstance(hostDef, {
        instanceId: "detail-token",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        faceDown: true,
      });
      if (hidden) token.definitionId = "_hidden_card_";
      state.cardInstances.push(token);
      state.activeContinuousEffects = [
        ce({
          effectId: "detail-copy",
          targetInstanceId: token.instanceId,
          modifierTag: "act_as_spirit",
          metadata: {
            statBlueprint: {
              kind: "live_copy_from",
              sourceInstanceId: host.instanceId,
              aspects: ["symbolColors"],
            },
            overrides: {},
          },
        }),
        ce({
          effectId: "detail-dual",
          targetInstanceId: brave.instanceId,
          modifierTag: "treat_as_symbol",
          modifierSymbol: ["white"],
        }),
        ce({
          effectId: "detail-add",
          targetInstanceId: token.instanceId,
          modifierTag: "symbol_addition",
          modifierSymbol: ["green"],
        }),
      ];
      const html = renderToStaticMarkup(
        createElement(CardDetailModal, {
          card: hidden ? null : hostDef,
          cardInstance: token,
          gameState: state,
          getCardDefinitionById: getDef,
          onClose: () => {},
        })
      );
      expect(html).toContain("赤1 緑1 白青1");
      expect(html).not.toContain("白1 青1");
    }
  );
});

function renderTable(
  card: CardDefinition,
  instance?: CardInstance,
  state?: GameState
) {
  const html = renderToStaticMarkup(
    createElement(CardDetailModal, {
      card,
      onClose: () => {},
      ...(instance ? { cardInstance: instance } : {}),
      ...(state ? { gameState: state } : {}),
      getCardDefinitionById: (id) =>
        id === card.cardNo ? card : ALL_CARDS.find((c) => c.cardNo === id),
    })
  );
  return (
    html.match(/<table class="cdm-level-table">([\s\S]*?)<\/table>/)?.[1] ?? ""
  );
}

function activeCells(table: string) {
  return [
    ...table.matchAll(
      /<(?:th|td)\b[^>]*class="[^"]*level-active[^"]*"[^>]*>([\s\S]*?)<\/(?:th|td)>/g
    ),
  ].map((match) => match[1]!.replace(/<[^>]*>/g, ""));
}

describe("CardDetailModal printed level columns and live highlights", () => {
  const card = ALL_CARDS.find((c) => c.cardNo === "BSSL01-C01")!;
  const makeState = (count: number, zone: CardInstance["zone"] = "field") => {
    const instance = createCardInstance(card, {
      instanceId: "oc-card",
      ownerPlayerId: "bob",
      zone,
      cores: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [instance],
      playerOverrides: [{ countValue: 10 }, { countValue: count }],
    });
    return { instance, state };
  };

  it("renders OC in search/deck details without a game state", () => {
    const table = renderTable(card);
    expect(table).toContain("OC(4+)");
    expect(table).toContain("＋7000");
    expect(activeCells(table)).toEqual([]);
  });

  it.each([3, 4, 5])(
    "highlights current Lv and OC only at the controller's threshold: %i",
    (count) => {
      const { instance, state } = makeState(count);
      expect(activeCells(renderTable(card, instance, state))).toEqual(
        count >= 4
          ? ["Lv1 (1)", "OC(4+)", "5000", "＋7000"]
          : ["Lv1 (1)", "5000"]
      );
    }
  );

  it("keeps printed OC visible without live highlights in hand and soul state", () => {
    const hand = makeState(4, "hand");
    const soul = makeState(4);
    soul.state.players[1]!.soulStateInstanceIds = [soul.instance.instanceId];
    for (const { instance, state } of [hand, soul]) {
      const table = renderTable(card, instance, state);
      expect(table).toContain("OC(4+)");
      expect(activeCells(table)).toEqual([]);
    }
  });

  it("moves the brave highlight from Lv1 to 合体中 and keeps the host Lv", () => {
    const braveDef = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X09")!;
    const { instance: host, state } = makeState(3);
    const brave = createCardInstance(braveDef, {
      instanceId: "brave",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    state.cardInstances.push(brave);
    expect(activeCells(renderTable(braveDef, brave, state))).toEqual([
      "Lv1 (1)",
      "3000",
    ]);
    brave.attachedToInstanceId = host.instanceId;
    host.attachedChildrenIds = [brave.instanceId];
    expect(activeCells(renderTable(braveDef, brave, state))).toEqual([
      "合体中",
      "＋5000",
    ]);
    expect(activeCells(renderTable(card, host, state))).toEqual([
      "Lv1 (1)",
      "5000",
    ]);
    const printed = renderTable(braveDef);
    expect(printed).toContain("合体中");
    expect(printed).toContain("＋5000");
    expect(activeCells(printed)).toEqual([]);
  });

  it("retains back-face OC metadata when synthesizing a definition", () => {
    const { front } = makeDoubleSidedCard();
    front.backFace!.printedOverCount = { minCount: 5, bpBonus: 6000 };
    const back = synthesizeBackFaceDefinition(front, front.backFace!);
    expect(back.printedOverCount).toEqual({ minCount: 5, bpBonus: 6000 });
    expect(renderTable(back)).toContain("OC(5+)");
  });

  it("renders every imported OC and combined BP column without a current state", () => {
    let ocCount = 0;
    for (const front of ALL_CARDS) {
      const cards = [
        front,
        ...(front.backFace
          ? [synthesizeBackFaceDefinition(front, front.backFace)]
          : []),
      ];
      for (const definition of cards) {
        if (
          !definition.printedOverCount &&
          definition.combinedBoost === undefined
        )
          continue;
        const table = renderTable(definition);
        if (definition.printedOverCount) {
          ocCount++;
          expect(table, definition.cardNo).toContain(
            `OC(${definition.printedOverCount.minCount}+)`
          );
          expect(table, definition.cardNo).toContain(
            `＋${definition.printedOverCount.bpBonus}`
          );
        }
        if (
          definition.printedCategory === "brave" &&
          definition.combinedBoost !== undefined
        ) {
          expect(table, definition.cardNo).toContain("合体中");
          expect(table, definition.cardNo).toContain(
            `＋${definition.combinedBoost}`
          );
        }
        expect(activeCells(table), definition.cardNo).toEqual([]);
      }
    }
    // 全件の表示は上のループで検証する。対象枚数はカードデータの追加・訂正で変わる。
    expect(ocCount).toBeGreaterThan(0);
  });
});

function makeDoubleSidedCard(): {
  front: CardDefinition;
  back: CardDefinition;
} {
  const front: CardDefinition = {
    cardNo: "DETAIL-DF-A",
    name: "Detail Front",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: ["A面テキスト"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    isDoubleSided: true,
    backFace: {
      cardNo: "DETAIL-DF-B",
      name: "Detail Back",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 5,
      reductionSymbols: ["purple"],
      levelDefs: [{ level: 1, requiredCores: 2, bp: 6000 }],
      symbolColors: ["purple"],
      textLines: ["B面テキスト"],
      keywordTags: [],
    },
  };
  return {
    front,
    back: synthesizeBackFaceDefinition(front, front.backFace!),
  };
}

describe("CardDetailModal face resolution", () => {
  it("resolves a synthesized B-face detail card back to its A-face root", () => {
    const { front, back } = makeDoubleSidedCard();
    const rebirthed = {
      ...createCardInstance(front, {
        instanceId: "detail-df-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 2,
      }),
      definitionId: back.cardNo,
    };
    const getDefinition = (id: string) =>
      id === front.cardNo ? front : id === back.cardNo ? back : undefined;

    const result = resolveCardDetailFaceState(back, rebirthed, getDefinition);

    expect(result.card).toBe(front);
    expect(result.initialShowFront).toBe(false);
  });

  it("keeps an A-face detail card on the front side by default", () => {
    const { front, back } = makeDoubleSidedCard();
    const instance = createCardInstance(front, {
      instanceId: "detail-df-2",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const getDefinition = (id: string) =>
      id === front.cardNo ? front : id === back.cardNo ? back : undefined;

    const result = resolveCardDetailFaceState(front, instance, getDefinition);

    expect(result.card).toBe(front);
    expect(result.initialShowFront).toBe(true);
  });

  it("does not infer a hidden or standalone B-face card without an instance", () => {
    const { back } = makeDoubleSidedCard();

    const result = resolveCardDetailFaceState(back, undefined, () => undefined);

    expect(result.card).toBe(back);
    expect(result.initialShowFront).toBe(true);
  });
});

describe("CardDetailModal combined brave state", () => {
  const hostDef: CardDefinition = {
    cardNo: "DETAIL-HOST",
    name: "Detail Host",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const braveDef: CardDefinition = {
    ...hostDef,
    cardNo: "DETAIL-BRAVE",
    name: "Detail Brave",
    printedCategory: "brave",
    levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
    combinedBoost: 5000,
  };

  it("shows 合体中/＋N instead of Lv1 for an attached brave", () => {
    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "detail-host-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      attachedChildrenIds: ["detail-brave-1"],
    };
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "detail-brave-1",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      attachedToInstanceId: host.instanceId,
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
    });

    expect(resolveCombinedBraveCurrentState(state, brave, braveDef)).toBe(
      "合体中/＋5000"
    );
  });

  it("does not replace the current level while the brave is in spirit state", () => {
    const brave = createCardInstance(braveDef, {
      instanceId: "detail-brave-solo",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [brave],
    });

    expect(resolveCombinedBraveCurrentState(state, brave, braveDef)).toBeNull();
  });
});

describe("CardDetailModal printed combined BP", () => {
  const baseDef: CardDefinition = {
    cardNo: "DETAIL-PRINTED-BRAVE",
    name: "Detail Printed Brave",
    printedCategory: "brave",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };

  it("returns a 合体中 BP column value for printed brave data", () => {
    expect(
      resolvePrintedCombinedBoostDisplay({
        ...baseDef,
        combinedBoost: 5000,
      })
    ).toBe("＋5000");
  });

  it("keeps 合体中 BP+0 visible for key braves", () => {
    expect(
      resolvePrintedCombinedBoostDisplay({
        ...baseDef,
        combinedBoost: 0,
      })
    ).toBe("＋0");
  });

  it("does not add a combined BP value to non-brave cards", () => {
    expect(
      resolvePrintedCombinedBoostDisplay({
        ...baseDef,
        printedCategory: "spirit",
        combinedBoost: 5000,
      })
    ).toBeNull();
  });
});
