/**
 * BSLH01-C11 セルゲイ・ロウ Lv2『お互いのアタックステップ』:
 * 「自分のスピリット/アルティメットがアタックしたとき、自分のフィールド/リザーブに
 * <ソウルコア>が無ければ、自分のライフのコア1個をボイドに置く。相手のスピリット/
 * アルティメットがアタックしたとき、相手のフィールド/リザーブに<ソウルコア>がなければ、
 * 相手のライフのコア1個をトラッシュに置く。」
 *
 * 「アタックしたとき」第三者観測 (`game_event`+`event:"attack"`+`triggerFilter`、BSES01-C03
 * 同型) + 新設 ConditionClause `soul_core_zone`（フィールド/リザーブのソウルコア有無を
 * `negate` で反転、CardInstance.soulCoreCount / PlayerState.reserveSoulCoreCount の
 * SSOT を参照）+ 既存 core_move (life→void / life→trash) primitive の組み合わせで表現する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C11 = cardNoMap.get("BSLH01-C11")!;

const ATTACKER: CardDefinition = {
  cardNo: "TEST-C11-ATTACKER",
  name: "テストアタッカー",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? (id === ATTACKER.cardNo ? ATTACKER : undefined);

const lookup = buildTriggeredEffectLookup([C11, ATTACKER]);

function actionsFor(state: GameState, playerId: string) {
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: lookup,
    getRegisteredFieldCardEffectActions: () => undefined,
  });
}

function buildState(options: {
  soulCoreOwner: "alice" | "bob" | null;
  attacker: "alice" | "bob";
}): GameState {
  const aliceOverride =
    options.soulCoreOwner === "alice"
      ? {
          reserveSoulCoreCount: 1,
          soulCoreLocation: { kind: "reserve" as const },
        }
      : {};
  const bobOverride =
    options.soulCoreOwner === "bob"
      ? {
          reserveSoulCoreCount: 1,
          soulCoreLocation: { kind: "reserve" as const },
        }
      : {};
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(C11, {
          instanceId: "alice-c11",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1, // Lv2 (requiredCores:1)
        }),
        createCardInstance(ATTACKER, {
          instanceId: "alice-attacker",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(ATTACKER, {
          instanceId: "bob-attacker",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [aliceOverride, bobOverride],
    }),
    step: "attack",
    turnNumber: 2,
    activePlayerId: options.attacker,
  };
}

function declareAttack(
  state: GameState,
  playerId: string,
  sourceInstanceId: string
): GameState {
  const action = actionsFor(state, playerId).find(
    (a) => a.kind === "attack" && a.sourceInstanceId === sourceInstanceId
  );
  expect(action).toBeDefined();
  let current = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: lookup,
  }).state;
  // 宣言前スタック窓 (pre_declaration_stack) をお互い pass して確定させる
  // (confirmAttackDeclarationAsAction が queueBattleDeclarationTriggers を呼ぶのはここ)。
  let guard = 0;
  while (current.preDeclarationStackWindow && guard++ < 10) {
    const responderId = current.preDeclarationStackWindow.priorityPlayerId;
    const pass = actionsFor(current, responderId).find(
      (a) => a.kind === "pass_pre_declaration_stack"
    );
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;
  }
  return current;
}

function resolveAllPending(state: GameState, playerId: string): GameState {
  let current = state;
  let guard = 0;
  while (guard++ < 10) {
    const resolveAction = actionsFor(current, playerId).find(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    if (!resolveAction) break;
    current = applyLegalAction({
      state: current,
      action: resolveAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;
  }
  guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const pass = actionsFor(current, responderId).find(
      (a) => a.kind === "pass_stack"
    );
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
    }).state;
  }
  return current;
}

describe("BSLH01-C11 セルゲイ・ロウ: アタック時ソウルコア有無でライフのコアをボイド/トラッシュへ", () => {
  it("一次ミラーの黒/七の印字値を保持し、本文の6色扱いと混同しない", () => {
    // 独自カード一次ソース external-qa/cardData.js の印字値。本文の
    // 「赤/紫/緑/白/黄/青としても扱う」は effects[0] の追加扱いであり、
    // 印字色・軽減シンボル・印字シンボルを別の値へ置換しない。
    expect(C11.colors).toEqual(["black"]);
    expect(C11.reductionSymbols).toEqual(["seven", "seven"]);
    expect(C11.symbolColors).toEqual(["black"]);
    expect(C11.effects![0]!.steps[0]!.action).toMatchObject({
      kind: "treat_as",
      aspects: ["symbol"],
      asColor: ["red", "purple", "green", "white", "yellow", "blue"],
    });
  });

  it("自分のスピリットがアタックし、フィールド/リザーブにソウルコアが無ければ自分のライフのコア1個がボイドへ", () => {
    const state = buildState({ soulCoreOwner: null, attacker: "alice" });
    const aliceBefore = state.players.find((p) => p.id === "alice")!;
    const declared = declareAttack(state, "alice", "alice-attacker");
    const resolved = resolveAllPending(declared, "alice");
    const alice = resolved.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(aliceBefore.lifeNormalCoreCount - 1);
    expect(alice.voidNormalCoreCount).toBe(aliceBefore.voidNormalCoreCount + 1);
  });

  it("自分のリザーブにソウルコアがあれば、アタックしてもライフのコアは減らない", () => {
    const state = buildState({ soulCoreOwner: "alice", attacker: "alice" });
    const aliceBefore = state.players.find((p) => p.id === "alice")!;
    const declared = declareAttack(state, "alice", "alice-attacker");
    const resolved = resolveAllPending(declared, "alice");
    const alice = resolved.players.find((p) => p.id === "alice")!;
    expect(alice.lifeNormalCoreCount).toBe(aliceBefore.lifeNormalCoreCount);
    expect(
      resolved.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "attack" && p.relatedInstanceId === "alice-attacker"
      )
    ).toBe(false);
  });

  it("相手のスピリットがアタックし、フィールド/リザーブにソウルコアが無ければ相手のライフのコア1個がトラッシュへ", () => {
    const state = buildState({ soulCoreOwner: null, attacker: "bob" });
    const bobBefore = state.players.find((p) => p.id === "bob")!;
    const declared = declareAttack(state, "bob", "bob-attacker");
    const resolved = resolveAllPending(declared, "alice");
    const bob = resolved.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(bobBefore.lifeNormalCoreCount - 1);
    expect(bob.trashNormalCoreCount).toBe(bobBefore.trashNormalCoreCount + 1);
  });
});
