/**
 * P3-93 bug 2: deck_reveal の remainder（手札に取らなかったオープンカード）が
 * トラッシュ行きのとき、GUI に「戻し順選択」(ordering_remainder) を出さない。
 * トラッシュへの置き順はテキスト上意味を持たないため、順序選択 pending を生成せず
 * 直接トラッシュへ移す。
 *
 * SSOT: shouldAutoFinalizeDeckRevealRemainder（structured-effect-interpreter）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  collectContinuousEffectInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import { shouldAutoFinalizeDeckRevealRemainder } from "../src/effect/structured-effect-interpreter";
import type {
  CardDefinition,
  GameState,
  GameStateInvariantIssue,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

function deckRevealEffect(c: CardDefinition) {
  const e = (c.effects ?? []).find((eff) =>
    eff.steps?.some((s) => s.action?.kind === "deck_reveal")
  );
  if (!e) throw new Error(`no deck_reveal effect on ${c.cardNo}`);
  return e;
}

describe("shouldAutoFinalizeDeckRevealRemainder (SSOT)", () => {
  it("0枚は常に即確定", () => {
    expect(shouldAutoFinalizeDeckRevealRemainder("trash", 0)).toBe(true);
    expect(shouldAutoFinalizeDeckRevealRemainder("top", 0)).toBe(true);
    expect(shouldAutoFinalizeDeckRevealRemainder("top_or_bottom", 0)).toBe(
      true
    );
  });

  it("trash は枚数に関わらず即確定（置き順無意味）", () => {
    expect(shouldAutoFinalizeDeckRevealRemainder("trash", 1)).toBe(true);
    expect(shouldAutoFinalizeDeckRevealRemainder("trash", 3)).toBe(true);
    expect(shouldAutoFinalizeDeckRevealRemainder("trash", 10)).toBe(true);
  });

  it("top/bottom は2枚以上で順序選択（即確定しない）", () => {
    expect(shouldAutoFinalizeDeckRevealRemainder("top", 2)).toBe(false);
    expect(shouldAutoFinalizeDeckRevealRemainder("bottom", 3)).toBe(false);
  });

  it("1枚は top_or_bottom 以外なら即確定（配置先一意）", () => {
    expect(shouldAutoFinalizeDeckRevealRemainder("top", 1)).toBe(true);
    expect(shouldAutoFinalizeDeckRevealRemainder("bottom", 1)).toBe(true);
    expect(shouldAutoFinalizeDeckRevealRemainder("top_or_bottom", 1)).toBe(
      false
    );
  });
});

describe("deck_reveal remainder=trash: ピックなし（即トラッシュ）", () => {
  it("上3枚をオープンしてすべて破棄する効果は、順序pendingを立てずトラッシュへ移す", () => {
    const c = card("BSFT01-C03");
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    // デッキ上3枚（トラッシュ送り対象）
    const deckIds = ["d1", "d2", "d3"];
    const deck = deckIds.map((id, index) =>
      createCardInstance(card(index === 0 ? "BSLH01-C14" : "BSTH01-C01"), {
        instanceId: id,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...deck],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 3 } : p
      ),
    };

    const result = executeEffect({
      chainId: "test:deck-reveal-trash-remainder:104",
      state,
      // BSFT01-C03 の実本文はオープンではなく破棄。ここでは公開処理の共通契約を直接検証する。
      effect: {
        timing: { kind: "card_event", event: "place" },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [],
              remainder: "trash",
            },
          },
        ],
      },
      sourceInstanceId: "nexus-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    // 順序選択 pending は生成されない
    expect(result.pendingDeckReveal).toBeNull();
    expect(
      result.cardInstances.some((instance) => instance.zone === "revealed")
    ).toBe(false);
    // 3枚すべてトラッシュへ
    for (const id of deckIds) {
      const inst = result.cardInstances.find((x) => x.instanceId === id)!;
      expect(inst.zone).toBe("trash");
    }
    expect(
      result.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "d1" &&
          ce.modifierTag === "defense_immune" &&
          ce.provenance?.effectIndex === 0
      )
    ).toBe(true);
    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: result,
      issues,
      getCardDefinitionById,
    });
    expect(
      issues.filter(
        (issue) =>
          issue.code === "missing_continuous_effect" &&
          issue.path === "activeContinuousEffects[d1:0]"
      )
    ).toHaveLength(0);
    expect(result.players.find((p) => p.id === "alice")!.deckCount).toBe(0);
  });
});

describe("deck_reveal remainder=trash: revealed_choice 経由（任意手札追加→残りトラッシュ）", () => {
  // P3-93 横断監査で発見した残路: pick グループが無く remainder=trash のオープンで、
  // revealed 自身の任意手札追加（revealed_choice）を解決した後、picking フェーズへ遷移して
  // legal-actions が「戻し順選択」を出してしまう経路。bug2 の創出時／pick 完了時ガードは
  // この revealed_choice 経由を塞いでいなかった。
  function makeRevealedChoiceTrashState(): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const src = createCardInstance(card("BSFT01-C03"), {
      instanceId: "src-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const revealed = ["r1", "r2", "r3"].map((id) =>
      createCardInstance(card("BSTH01-C01"), {
        instanceId: id,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "revealed",
      })
    );
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [src, ...revealed],
      pendingDeckReveal: {
        pendingId: "dr-1",
        actingPlayerId: "alice",
        sourceInstanceId: "src-1",
        sourceDefinitionId: "BSFT01-C03",
        revealedCardInstanceIds: ["r1", "r2", "r3"],
        picks: [],
        remainder: "trash",
        phase: "revealed_choice",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
        revealedAutoAddCandidateIds: ["r1"],
        revealedDispositionMap: {
          r1: { kind: "move", destination: "hand" },
        },
        origin: "deck",
      },
    };
  }

  it("任意追加せず → 全3枚トラッシュ・順序選択を出さない", () => {
    const state = makeRevealedChoiceTrashState();
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(action).toBeDefined();

    const result = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById,
      selectedDeckRevealCardIds: [],
    });

    expect(result.state.pendingDeckReveal).toBeNull();
    for (const id of ["r1", "r2", "r3"]) {
      expect(
        result.state.cardInstances.find((x) => x.instanceId === id)!.zone
      ).toBe("trash");
    }
  });

  it("任意追加1枚 → そのカードは手札・残り2枚トラッシュ・順序選択を出さない", () => {
    const state = makeRevealedChoiceTrashState();
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");

    const result = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById,
      selectedDeckRevealCardIds: ["r1"],
    });

    expect(result.state.pendingDeckReveal).toBeNull();
    expect(
      result.state.cardInstances.find((x) => x.instanceId === "r1")!.zone
    ).toBe("hand");
    for (const id of ["r2", "r3"]) {
      expect(
        result.state.cardInstances.find((x) => x.instanceId === id)!.zone
      ).toBe("trash");
    }
  });
});

describe("deck_reveal remainder=trash: ピックあり（手札→残りトラッシュ）", () => {
  it("BSAZ01-C02 召喚時 4オープン→1pick→残り3はトラッシュ（戻し順選択を出さない）", () => {
    const c = card("BSAZ01-C02");
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(c, {
      instanceId: "az-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    // 1枚は filter（地球 magic）合致、3枚は非合致（毛玉スピリット）
    const match = createCardInstance(card("BSAZ01-C04"), {
      instanceId: "match-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const fillers = ["f1", "f2", "f3"].map((id, index) =>
      createCardInstance(card(index === 0 ? "BSLH01-C14" : "BSTH01-C01"), {
        instanceId: id,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      // match を先頭にして revealCount=4 に確実に含める
      cardInstances: [self, match, ...fillers],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 4 } : p
      ),
    };

    const afterReveal = executeEffect({
      chainId: "test:deck-reveal-trash-remainder:293",
      state,
      effect: deckRevealEffect(c),
      sourceInstanceId: "az-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    // picking フェーズの pending が立つ
    expect(afterReveal.pendingDeckReveal).not.toBeNull();
    expect(afterReveal.pendingDeckReveal!.phase).toBe("picking");

    // pick アクションを取得し、合致カードを手札へ選択
    const actions = getLegalActions({
      state: afterReveal,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const pick = actions.find(
      (a) => a.kind === "resolve_pending_deck_reveal_pick"
    );
    expect(pick).toBeDefined();

    const result = applyLegalAction({
      state: afterReveal,
      action: pick!,
      getCardDefinitionById,
      selectedDeckRevealCardIds: ["match-1"],
    });

    // 戻し順選択 (ordering_remainder) を出さず即完了
    expect(result.state.pendingDeckReveal).toBeNull();
    // 合致カードは手札、残り3枚はトラッシュ
    expect(
      result.state.cardInstances.find((x) => x.instanceId === "match-1")!.zone
    ).toBe("hand");
    for (const id of ["f1", "f2", "f3"]) {
      expect(
        result.state.cardInstances.find((x) => x.instanceId === id)!.zone
      ).toBe("trash");
    }
    expect(
      result.state.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "f1" &&
          ce.modifierTag === "defense_immune" &&
          ce.provenance?.effectIndex === 0
      )
    ).toBe(true);
    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: result.state,
      issues,
      getCardDefinitionById,
    });
    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });
});
