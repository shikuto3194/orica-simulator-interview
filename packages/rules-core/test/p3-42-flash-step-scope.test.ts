/**
 * P3-42: フラッシュ効果のステップスコープ制約。
 *
 * `フラッシュ『お互いのアタックステップ』` 等のステップ限定 flash 効果が
 * メインステップでは legal action として列挙されないことを検証する。
 *
 * Effect.timingScope を registration に伝搬し、
 * legal-action availability が現在の step / activePlayerId と照合する経路を確認する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  isTimingScopeActive,
} from "../src";
import type { CardDefinition, GameState, LegalAction, Step } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const 紅魔館 = cardNoMap.get("BSTH01-R21")!;
const フランドール = cardNoMap.get("BSTH01-X04")!;
const 上海人形 = cardNoMap.get("BSTH02.7-X02")!;

const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

function buildState(opts: {
  step: Step;
  activePlayerId: "alice" | "bob";
  fieldCard?: {
    def: CardDefinition;
    instanceId: string;
    controllerPlayerId: "alice" | "bob";
  };
}): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const cards = opts.fieldCard
    ? [
        createCardInstance(opts.fieldCard.def, {
          instanceId: opts.fieldCard.instanceId,
          ownerPlayerId: opts.fieldCard.controllerPlayerId,
          controllerPlayerId: opts.fieldCard.controllerPlayerId,
          zone: "field",
          normalCoreCount: 5,
        }),
      ]
    : [];
  return {
    ...base,
    activePlayerId: opts.activePlayerId,
    step: opts.step,
    cardInstances: cards,
  };
}

describe("P3-42 isTimingScopeActive helper", () => {
  it("scope 未設定なら常に true", () => {
    expect(isTimingScopeActive(undefined, "main", "alice", "alice")).toBe(true);
    expect(isTimingScopeActive(undefined, "attack", "bob", "alice")).toBe(true);
  });

  it("player:both, period:attack — attack step のみ true", () => {
    const scope = { player: "both" as const, period: "attack" as const };
    expect(isTimingScopeActive(scope, "attack", "alice", "alice")).toBe(true);
    expect(isTimingScopeActive(scope, "attack", "bob", "alice")).toBe(true);
    expect(isTimingScopeActive(scope, "main", "alice", "alice")).toBe(false);
  });

  it("player:self, period:attack — owner がターンプレイヤーかつ attack step", () => {
    const scope = { player: "self" as const, period: "attack" as const };
    expect(isTimingScopeActive(scope, "attack", "alice", "alice")).toBe(true);
    // owner=bob, active=alice → not self turn
    expect(isTimingScopeActive(scope, "attack", "alice", "bob")).toBe(false);
    expect(isTimingScopeActive(scope, "main", "alice", "alice")).toBe(false);
  });

  it("player:opponent, period:attack — owner が非ターンプレイヤーかつ attack step", () => {
    const scope = { player: "opponent" as const, period: "attack" as const };
    expect(isTimingScopeActive(scope, "attack", "alice", "bob")).toBe(true);
    expect(isTimingScopeActive(scope, "attack", "alice", "alice")).toBe(false);
    expect(isTimingScopeActive(scope, "main", "alice", "bob")).toBe(false);
  });
});

describe("P3-42 legal-action availability with flash scope", () => {
  it("BSTH01-R21 紅魔館 (お互いのアタックステップ): main step で flash 効果が列挙されない", () => {
    const state = buildState({
      step: "main",
      activePlayerId: "alice",
      fieldCard: {
        def: 紅魔館,
        instanceId: "kohmakan-1",
        controllerPlayerId: "alice",
      },
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    });
    const flashActions = actions.filter(
      (a: LegalAction) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "kohmakan-1" &&
        (a.timing === "flash" || a.timing === "stack")
    );
    expect(flashActions.length).toBe(0);
  });

  it("BSTH01-X04 フランドール (お互いのアタックステップ): main step で flash 効果が列挙されない", () => {
    const state = buildState({
      step: "main",
      activePlayerId: "alice",
      fieldCard: {
        def: フランドール,
        instanceId: "flan-1",
        controllerPlayerId: "alice",
      },
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    });
    const flashActions = actions.filter(
      (a: LegalAction) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "flan-1" &&
        (a.timing === "flash" || a.timing === "stack")
    );
    // 第2効果【フォーオブアカインド】は default flash (scope 未指定) のため除外しない。
    // 第1効果のみ scope 化されているので flashActions.length は最大 1 (第2効果のみ)
    // 第2効果は steps: [] の stub だが registration は出る
    // このテストの目的は「第1効果が列挙されないこと」なので、列挙された flash すべてに
    // registrationIndex 0 が含まれないことを確認する
    const indices = flashActions.map((a) =>
      a.kind === "use_field_card_effect" ? a.registrationIndex : -1
    );
    expect(indices).not.toContain(0);
  });

  it("BSTH02.7-X02 上海人形 (相手のアタックステップ): 自分のターン main step で flash 効果が列挙されない", () => {
    const state = buildState({
      step: "main",
      activePlayerId: "alice",
      fieldCard: {
        def: 上海人形,
        instanceId: "shanghai-1",
        controllerPlayerId: "alice",
      },
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    });
    const flashActions = actions.filter(
      (a: LegalAction) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "shanghai-1" &&
        (a.timing === "flash" || a.timing === "stack")
    );
    const indices = flashActions.map((a) =>
      a.kind === "use_field_card_effect" ? a.registrationIndex : -1
    );
    expect(indices).not.toContain(0);
  });
});

// P3-60: BS のフラッシュタイミングは `flash_before_block` / `flash_after_block`
// の 2 つのみで、attack step に入った直後 (アタック宣言前) は flash 効果を能動的に
// 起動できない。10_rules/02_turn-flow-and-timing.md:128-131 参照。
describe("P3-60 attack step baseline (アタック宣言前) で flash 効果は legal にならない", () => {
  it("active player の Flandre flash は attack step baseline で legal に含まれない", () => {
    const state = buildState({
      step: "attack",
      activePlayerId: "alice",
      fieldCard: {
        def: フランドール,
        instanceId: "flan-1",
        controllerPlayerId: "alice",
      },
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    });
    const flandreFlashActions = actions.filter(
      (a: LegalAction) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "flan-1" &&
        (a.timing === "flash" || a.timing === "stack")
    );
    expect(flandreFlashActions).toHaveLength(0);
  });

  it("active player の 紅魔館 flash は attack step baseline で legal に含まれない", () => {
    const state = buildState({
      step: "attack",
      activePlayerId: "alice",
      fieldCard: {
        def: 紅魔館,
        instanceId: "kohmakan-1",
        controllerPlayerId: "alice",
      },
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    });
    const flashActions = actions.filter(
      (a: LegalAction) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "kohmakan-1" &&
        (a.timing === "flash" || a.timing === "stack")
    );
    expect(flashActions).toHaveLength(0);
  });

  it("opponent (non-active) の Flandre flash も attack step baseline で legal に含まれない", () => {
    const state = buildState({
      step: "attack",
      activePlayerId: "alice",
      fieldCard: {
        def: フランドール,
        instanceId: "flan-bob-1",
        controllerPlayerId: "bob",
      },
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...effectLookups,
    });
    const flandreFlashActions = actions.filter(
      (a: LegalAction) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "flan-bob-1" &&
        (a.timing === "flash" || a.timing === "stack")
    );
    expect(flandreFlashActions).toHaveLength(0);
  });
});
