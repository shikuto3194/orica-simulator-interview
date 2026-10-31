/**
 * P3-61: `effect.condition` を legal-action 列挙時に評価する。
 *
 * 背景:
 * - BSTH01-X04 フランドール【フォーオブアカインド】は
 *   `condition: [field_lacks grandwalker self, field_has zone="deck" minCount=3]`
 *   で「ことで」コスト用の事前ガードを表現している (P3-47 裁定 #4)。
 * - しかし `effect.condition` が `RegisteredFieldCardEffectAction` /
 *   `RegisteredMagicAction` に伝搬していなかったため、デッキ 0 枚でも
 *   legal action として列挙され、auto-controller が拾って stack を開いてしまう
 *   バグがあった。
 * - 本テストは effect.condition の伝搬と availability 段階での gating を担保する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const フランドール = cardNoMap.get("BSTH01-X04")!;

const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

function buildState(opts: { deckInstances: number }): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const host = createCardInstance(フランドール, {
    instanceId: "host",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 3, // Lv2 (requiredCores: 3)
  });
  const deckCards = Array.from({ length: opts.deckInstances }, (_, i) =>
    createCardInstance(フランドール, {
      instanceId: `d${i}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    })
  );
  return {
    ...base,
    turnNumber: 3,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [host, ...deckCards],
  };
}

describe("P3-61 effect.condition gating at legal-action enumeration", () => {
  it("デッキ 0 枚 → フランドール flash 効果は1件も列挙されない", () => {
    // 第1効果は timingScope (attack step) で弾かれ済み (P3-42)。
    // 第2効果【フォーオブアカインド】は condition (field_has deck >= 3) で弾かれる (P3-61)。
    const state = buildState({ deckInstances: 0 });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    });
    const flashActions = actions.filter(
      (a: LegalAction) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "host" &&
        (a.timing === "flash" || a.timing === "stack")
    );
    expect(flashActions).toHaveLength(0);
  });

  it("デッキ 2 枚 → フランドール【フォーオブアカインド】はまだ legal にならない (minCount=3 未満)", () => {
    const state = buildState({ deckInstances: 2 });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    });
    const flashActions = actions.filter(
      (a: LegalAction) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "host" &&
        (a.timing === "flash" || a.timing === "stack")
    );
    expect(flashActions).toHaveLength(0);
  });

  it("デッキ 3 枚 → 第2効果【フォーオブアカインド】が legal (regIdx=1) になる", () => {
    const state = buildState({ deckInstances: 3 });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    });
    const flashActions = actions.filter(
      (a: LegalAction) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "host" &&
        (a.timing === "flash" || a.timing === "stack")
    );
    expect(flashActions).toHaveLength(1);
    expect(
      flashActions[0]!.kind === "use_field_card_effect" &&
        flashActions[0]!.registrationIndex
    ).toBe(1);
  });

  it("デッキ 3 枚 + alice に創界神 → field_lacks grandwalker self が false で再び弾かれる", () => {
    const grandwalker = ALL_CARDS.find((c) => !!c.grandwalkerData);
    if (!grandwalker) {
      // 創界神カードがデータセットに含まれない場合はスキップ
      return;
    }
    const base = buildState({ deckInstances: 3 });
    const state: GameState = {
      ...base,
      cardInstances: [
        ...base.cardInstances,
        createCardInstance(grandwalker, {
          instanceId: "gw",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
      ],
    };
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    });
    const flashActions = actions.filter(
      (a: LegalAction) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "host" &&
        (a.timing === "flash" || a.timing === "stack")
    );
    expect(flashActions).toHaveLength(0);
  });

  it("condition が registration に伝搬されている", () => {
    const regs =
      effectLookups.getRegisteredFieldCardEffectActions("BSTH01-X04") ?? [];
    // 第2効果【フォーオブアカインド】の registration を取得
    const fourOfAKind = regs[1];
    expect(fourOfAKind).toBeDefined();
    expect(fourOfAKind!.condition).toBeDefined();
    expect(fourOfAKind!.condition!.length).toBeGreaterThan(0);
  });
});
