import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
  getLegalActions,
  sanitizeStateForViewer,
} from "../src";
import type {
  ApplyLegalActionOptions,
  ConditionClause,
  GameState,
  LegalAction,
} from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const deps = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
};

const flandre = definitions.get("BSTH01-X04")!;
const filler = definitions.get("BSTH01-C01")!;
function makeState(deckCount = 5): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(flandre, {
        instanceId: "host",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 3,
      }),
      ...Array.from({ length: deckCount }, (_, i) =>
        createCardInstance(filler, {
          instanceId: `deck-${i}`,
          ownerPlayerId: "alice",
          zone: "deck",
        })
      ),
    ],
  });
  return {
    ...base,
    step: "main",
    turnNumber: 3,
    activePlayerId: "alice",
    players: base.players.map((p) =>
      p.id === "alice" ? { ...p, deckCount, reserveNormalCoreCount: 3 } : p
    ),
  };
}
const isFourOfAKind = (a: LegalAction) =>
  a.kind === "use_field_card_effect" &&
  a.sourceInstanceId === "host" &&
  a.registrationIndex === 1;
const isAvailable = (state: GameState) =>
  getLegalActions({ state, actingPlayerId: "alice", ...deps }).some(
    isFourOfAKind
  );

describe("フォーオブアカインドの宣言から解決", () => {
  // 2026-08-07以降、PvPでは自分の山札も伏せられる。従来の完全情報テストだけでは検出できなかった。
  it.each([0, 2, 3, 5])(
    "山札%d枚: 完全情報と対人戦の発揮候補が一致する",
    (count) => {
      const full = makeState(count);
      const state = sanitizeStateForViewer(full, "alice");
      expect(
        state.cardInstances
          .filter((c) => c.zone === "deck")
          .every((c) => c.definitionId === "_hidden_card_")
      ).toBe(true);
      expect(isAvailable(full)).toBe(count >= 3);
      expect(isAvailable(state)).toBe(count >= 3);
    }
  );
  it("山札が足りてもLv1では発揮しない", () => {
    const state = makeState();
    state.cardInstances[0]!.normalCoreCount = 1;
    expect(isAvailable(sanitizeStateForViewer(state, "alice"))).toBe(false);
  });
  it.each(["grandwalker", "guided"] as const)(
    "自分の%sがあれば発揮しない",
    (kind) => {
      const grandwalker = ALL_CARDS.find(
        (c) => c.grandwalkerData?.kind === kind
      )!;
      expect(grandwalker).toBeDefined();
      const state = makeState();
      state.cardInstances.push(
        createCardInstance(grandwalker, {
          instanceId: "nexus",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
        })
      );
      expect(isAvailable(sanitizeStateForViewer(state, "alice"))).toBe(false);
    }
  );
  it("対人戦の宣言→相手のパス→コア配分で分身3体を生成し再発揮を禁止する", () => {
    let state = makeState();
    const act = (
      player: string,
      predicate: (action: LegalAction) => boolean,
      input: Partial<ApplyLegalActionOptions> = {}
    ) => {
      const actions = getLegalActions({
        state,
        actingPlayerId: player,
        ...deps,
      });
      const action = actions.find(predicate);
      expect(action, JSON.stringify(actions)).toBeDefined();
      state = applyLegalAction({
        ...input,
        state,
        action: action!,
        ...deps,
      }).state;
    };
    // GUIの伏せた状態で作ったactionを、実カードを持つサーバーが解決する。
    const declared = getLegalActions({
      state: sanitizeStateForViewer(state, "alice"),
      actingPlayerId: "alice",
      ...deps,
    }).find(isFourOfAKind);
    expect(declared).toBeDefined();
    state = applyLegalAction({ state, action: declared!, ...deps }).state;
    act("bob", (a) => a.kind === "pass_stack");
    expect(state.pendingCoreDistribution, state.log.join("\n")).not.toBeNull();
    expect(
      state.cardInstances.filter((c) => c.zone === "field" && c.faceDown)
    ).toHaveLength(3);
    act("alice", (a) => a.kind === "resolve_pending_core_distribution", {
      coreDistributionAllocations: { "deck-0": 1, "deck-1": 1, "deck-2": 1 },
      coreDistributionSourceAllocations: { reserve: 3 },
    });
    expect(state.pendingCoreDistribution).toBeNull();
    const tokens = state.cardInstances.filter(
      (c) => c.zone === "field" && c.faceDown
    );
    expect(tokens).toHaveLength(3);
    expect(tokens.every((c) => c.normalCoreCount === 1)).toBe(true);
    expect(state.players.find((p) => p.id === "alice")?.deckCount).toBe(2);
    expect(
      state.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "act_as_spirit"
      )
    ).toHaveLength(3);
    expect(
      state.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "redirect_effect_target"
      )
    ).toHaveLength(1);
    expect(
      state.effectUsageRecords.filter((r) => r.sourceInstanceId === "host")
    ).toHaveLength(2);
    // 山札を補充しても、ターン中/ゲーム中の使用回数制限は残る。
    state.cardInstances.push(
      createCardInstance(filler, {
        instanceId: "refill",
        ownerPlayerId: "alice",
        zone: "deck",
      })
    );
    state.players.find((p) => p.id === "alice")!.deckCount = 3;
    // 使用記録以外の未解決状態が原因で候補から消えているのではないことも確認する。
    expect(
      isAvailable(
        sanitizeStateForViewer({ ...state, effectUsageRecords: [] }, "alice")
      )
    ).toBe(true);
    expect(isAvailable(sanitizeStateForViewer(state, "alice"))).toBe(false);
    expect(
      isAvailable(sanitizeStateForViewer({ ...state, turnNumber: 5 }, "alice"))
    ).toBe(false);
  });
});

describe("field_hasの公開枚数と非公開カード内容", () => {
  const base: Extract<ConditionClause, { kind: "field_has" }> = {
    kind: "field_has",
    player: "self",
    zone: "deck",
    minCount: 3,
  };
  const evaluate = (clause: ConditionClause) =>
    evaluateCondition(
      sanitizeStateForViewer(makeState(), "alice"),
      [clause],
      "host",
      "alice",
      deps.getCardDefinitionById
    );
  it("枚数上限とプレイヤー指定も伏せたまま評価する", () => {
    expect(evaluate({ ...base, maxCount: 5 })).toBe(true);
    expect(evaluate({ ...base, maxCount: 4 })).toBe(false);
    expect(evaluate({ ...base, player: "opponent" })).toBe(false);
  });
  it.each<Partial<typeof base>>([
    { minCost: 0 },
    { maxCost: 99 },
    { category: ["spirit"] },
    { colors: ["red"] },
    { symbolColors: ["red"] },
    { colorCount: "mono" },
    { tribes: ["幻想"] },
    { tribesRequired: ["幻想"] },
    { cardNames: [{ contains: "" }] },
    { excludeCardNames: [{ exact: "別名" }] },
    { cardNamesEffective: [{ contains: "" }] },
    { isContract: true },
    { requiredKeywordTags: ["契約"] },
    { minLevel: 0 },
    { maxLevel: 99 },
    { grandwalkerKind: "any" },
  ])("内容条件%jを未知カードが満たすとはみなさない", (filter) => {
    expect(evaluate({ ...base, ...filter })).toBe(false);
  });
});
