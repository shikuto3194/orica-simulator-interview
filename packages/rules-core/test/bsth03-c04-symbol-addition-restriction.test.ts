/**
 * シンボル追加数の上限制限 — restrict_symbol_addition CE の検証。
 *
 * プリミティブ:
 *  - restrict_symbol_addition: player-scoped CE。`player:"either"` で両プレイヤー登録
 *    (prevent_deck_discard / restrict_core_placement と同型)。`sourceFilter` 指定時、その
 *    filter に一致するカードの効果による symbol_add のみをカウント対象にする。
 *  - 消費側 (executeSymbolAdd) が symbolAdditionRestrictedCountThisTurn (CE単位キー) を
 *    参照し、今回の実追加数 (対象数 * count) と累積の合計が maxTotal を超える場合
 *    symbol_add 全体をブロックする。
 *
 * ルール正源: 「Lv1-Lv2『相手のメインステップ』相手は、スピリット/アルティメットの効果で
 * 合計で2つ以上シンボルを追加できない。」(BSTH03-C04 effects[2])。
 *
 * 解禁カード: BSTH03-C04 effects[2]。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import type { DynamicCount, Effect } from "../src/dsl-types";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";

function runEffect(
  state: GameState,
  effect: Effect,
  sourceInstanceId: string,
  actingPlayerId: string
): GameState {
  return executeEffect({
    chainId: "test:bsth03-c04-symbol-addition-restriction:45",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

const symbolAddSelf = (
  symbol: "red" | "purple",
  count?: number | DynamicCount
): Effect => ({
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "symbol_add",
        target: { kind: "self" },
        symbol,
        ...(count !== undefined ? { count } : {}),
        duration: { scope: "while_on_field" },
      },
    },
  ],
});

const selfFieldMagicPerFiveCount = (): DynamicCount => ({
  source: {
    kind: "cards_in_zone",
    zone: "field",
    player: "self",
    filter: { category: ["magic"] },
  },
  divisor: 5,
});

const restrictSymbolAddition = (maxTotal: number): Effect => ({
  timing: { kind: "continuous" },
  timingScope: { player: "opponent", period: "main" },
  steps: [
    {
      action: {
        kind: "restrict_symbol_addition",
        player: "opponent",
        maxTotal,
        sourceFilter: { category: ["spirit", "ultimate"] },
        duration: { scope: "while_on_field" },
      },
    },
  ],
});

function symbolAdditionCEsFor(state: GameState, instanceId: string): number {
  return state.activeContinuousEffects.filter(
    (ce) =>
      ce.modifierTag === "symbol_addition" && ce.targetInstanceId === instanceId
  ).length;
}

function setupBoard(): { state: GameState } {
  const riggle = createCardInstance(card("BSTH03-C04"), {
    instanceId: "riggle-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const bobSpirit = createCardInstance(card("BSTH03-C04"), {
    instanceId: "bob-spirit-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
  });
  const bobSpirit2 = createCardInstance(card("BSTH03-C04"), {
    instanceId: "bob-spirit-2",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
  });
  const bobMagic = createCardInstance(card("BSTH03-R02"), {
    instanceId: "bob-magic-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
  });
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const state: GameState = {
    ...base,
    activePlayerId: BOB,
    step: "main",
    cardInstances: [riggle, bobSpirit, bobSpirit2, bobMagic],
  };
  return { state };
}

describe("restrict_symbol_addition (BSTH03-C04「相手は、スピリット/アルティメットの効果で合計で2つ以上シンボルを追加できない」)", () => {
  it("[card] BSTH03-C04 effects[2] は継続タイミング+timingScope(opponent,main)で restrict_symbol_addition(maxTotal:1) を登録する", () => {
    const def = card("BSTH03-C04");
    const eff = def.effects?.[2];
    expect(eff).toBeDefined();
    expect(eff!.stub).toBeUndefined();
    expect(eff!.timing.kind).toBe("continuous");
    expect(eff!.timingScope).toEqual({ player: "opponent", period: "main" });
    const action = eff!.steps[0]!.action;
    expect(action.kind).toBe("restrict_symbol_addition");
    if (action.kind === "restrict_symbol_addition") {
      expect(action.player).toBe("opponent");
      expect(action.maxTotal).toBe(1);
      expect(action.sourceFilter).toEqual({ category: ["spirit", "ultimate"] });
    }
  });

  it("[board] 相手のメインステップ中、相手のスピリット/アルティメット効果による2つ目以降のシンボル追加はブロックされる", () => {
    const board = setupBoard();
    let state = board.state;

    // 相手 (BOB) のメインステップに永遠亭 (ALICE 所有) の制限を登録する。
    state = runEffect(
      state,
      card("BSTH03-C04").effects![2]!,
      "riggle-1",
      ALICE
    );

    // 1個目: BOB のスピリット効果によるシンボル追加は成立する。
    state = runEffect(state, symbolAddSelf("red"), "bob-spirit-1", BOB);
    expect(symbolAdditionCEsFor(state, "bob-spirit-1")).toBe(1);

    // 2個目: 別のスピリット効果によるシンボル追加は合計上限 (maxTotal:1) 超過でブロックされる。
    state = runEffect(state, symbolAddSelf("purple"), "bob-spirit-2", BOB);
    expect(symbolAdditionCEsFor(state, "bob-spirit-2")).toBe(0);
    expect(state.log.at(-1)).toContain("blocked-by-restrict_symbol_addition");
  });

  it("[regression] BSTH03-C04 effects[2] の player-scoped 制限は再計算後も残り、2つ目の追加を止める", () => {
    const board = setupBoard();
    let state = runEffect(
      board.state,
      card("BSTH03-C04").effects![2]!,
      "riggle-1",
      ALICE
    );

    state = recomputeContinuousEffects(state);
    expect(
      state.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "restrict_symbol_addition" &&
          ce.targetInstanceId === BOB
      )
    ).toBe(true);

    state = runEffect(state, symbolAddSelf("red"), "bob-spirit-1", BOB);
    state = runEffect(state, symbolAddSelf("purple"), "bob-spirit-2", BOB);
    expect(symbolAdditionCEsFor(state, "bob-spirit-2")).toBe(0);
    expect(state.log.at(-1)).toContain("blocked-by-restrict_symbol_addition");
  });

  it("[board] count=2 の同時シンボル追加は maxTotal:1 をすり抜けず登録前にブロックされる", () => {
    const board = setupBoard();
    let state = board.state;
    state = runEffect(
      state,
      card("BSTH03-C04").effects![2]!,
      "riggle-1",
      ALICE
    );
    const restriction = state.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "restrict_symbol_addition" &&
        ce.targetInstanceId === BOB
    );
    expect(restriction).toBeDefined();

    state = runEffect(state, symbolAddSelf("red", 2), "bob-spirit-1", BOB);

    expect(symbolAdditionCEsFor(state, "bob-spirit-1")).toBe(0);
    expect(state.log.at(-1)).toContain("blocked-by-restrict_symbol_addition");
    expect(
      state.symbolAdditionRestrictedCountThisTurn?.[
        `${BOB}:${restriction!.effectId}`
      ]
    ).toBeUndefined();
  });

  it("[board] 合体中ブレイヴの live count 効果は host のスピリット分類で sourceFilter に一致し、10枚でcount=2をブロックする", () => {
    const board = setupBoard();
    const bobExtraMagics = Array.from({ length: 9 }, (_, index) =>
      createCardInstance(card("BSTH03-R02"), {
        instanceId: `bob-extra-magic-${index}`,
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
      })
    );
    const host = createCardInstance(card("BSAZ01-C01"), {
      instanceId: "bob-c18-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["bob-c18-brave"],
    });
    const brave = createCardInstance(card("BSAZ01-C18"), {
      instanceId: "bob-c18-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
    });
    let state: GameState = {
      ...board.state,
      cardInstances: [
        ...board.state.cardInstances,
        ...bobExtraMagics,
        host,
        brave,
      ],
    };
    state = runEffect(
      state,
      card("BSTH03-C04").effects![2]!,
      "riggle-1",
      ALICE
    );
    const restriction = state.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "restrict_symbol_addition" &&
        ce.targetInstanceId === BOB
    );
    expect(restriction).toBeDefined();

    state = runEffect(
      state,
      symbolAddSelf("red", selfFieldMagicPerFiveCount()),
      brave.instanceId,
      BOB
    );

    expect(symbolAdditionCEsFor(state, host.instanceId)).toBe(0);
    expect(symbolAdditionCEsFor(state, brave.instanceId)).toBe(0);
    expect(state.log.at(-1)).toContain("blocked-by-restrict_symbol_addition");
    expect(
      state.symbolAdditionRestrictedCountThisTurn?.[
        `${BOB}:${restriction!.effectId}`
      ]
    ).toBeUndefined();
  });

  it("[board] count=2 が成立した場合は累積も2個として記録し、次の2個追加を止める", () => {
    const board = setupBoard();
    let state = board.state;
    state = runEffect(state, restrictSymbolAddition(3), "riggle-1", ALICE);
    const restriction = state.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "restrict_symbol_addition" &&
        ce.targetInstanceId === BOB
    );
    expect(restriction).toBeDefined();

    state = runEffect(state, symbolAddSelf("red", 2), "bob-spirit-1", BOB);
    expect(symbolAdditionCEsFor(state, "bob-spirit-1")).toBe(1);
    expect(
      state.activeContinuousEffects.find(
        (ce) =>
          ce.modifierTag === "symbol_addition" &&
          ce.targetInstanceId === "bob-spirit-1"
      )?.modifierSymbolCount
    ).toBe(2);
    expect(
      state.symbolAdditionRestrictedCountThisTurn?.[
        `${BOB}:${restriction!.effectId}`
      ]
    ).toBe(2);

    state = runEffect(state, symbolAddSelf("purple", 2), "bob-spirit-2", BOB);
    expect(symbolAdditionCEsFor(state, "bob-spirit-2")).toBe(0);
    expect(state.log.at(-1)).toContain("blocked-by-restrict_symbol_addition");
    expect(
      state.symbolAdditionRestrictedCountThisTurn?.[
        `${BOB}:${restriction!.effectId}`
      ]
    ).toBe(2);
  });

  it("[board] マジックの効果によるシンボル追加は sourceFilter (spirit/ultimate) 対象外でブロックされない", () => {
    const board = setupBoard();
    let state = board.state;
    state = runEffect(
      state,
      card("BSTH03-C04").effects![2]!,
      "riggle-1",
      ALICE
    );

    state = runEffect(state, symbolAddSelf("red"), "bob-spirit-1", BOB);
    expect(symbolAdditionCEsFor(state, "bob-spirit-1")).toBe(1);

    // マジック由来の2つ目のシンボル追加は sourceFilter 不一致のためカウント対象外 = 成立する。
    state = runEffect(state, symbolAddSelf("purple"), "bob-magic-1", BOB);
    expect(symbolAdditionCEsFor(state, "bob-magic-1")).toBe(1);
  });

  it("[board] 自分 (ALICE) のメインステップ中は timingScope(opponent) 不成立のため制限が掛からない", () => {
    const board = setupBoard();
    let state = { ...board.state, activePlayerId: ALICE };
    state = runEffect(
      state,
      card("BSTH03-C04").effects![2]!,
      "riggle-1",
      ALICE
    );

    // アクティブプレイヤーが ALICE (=登録者自身のターン) なので timingScope(opponent) が
    // 不成立となり、BOB のスピリット効果によるシンボル追加は制限を受けない。
    state = runEffect(state, symbolAddSelf("red"), "bob-spirit-1", BOB);
    expect(symbolAdditionCEsFor(state, "bob-spirit-1")).toBe(1);
    state = runEffect(state, symbolAddSelf("purple"), "bob-spirit-2", BOB);
    expect(symbolAdditionCEsFor(state, "bob-spirit-2")).toBe(1);
  });

  it("[board] 制限登録が無ければシンボル追加は通常どおり成立する（リグレッション）", () => {
    const board = setupBoard();
    let state = board.state;
    state = runEffect(state, symbolAddSelf("red"), "bob-spirit-1", BOB);
    expect(symbolAdditionCEsFor(state, "bob-spirit-1")).toBe(1);
    state = runEffect(state, symbolAddSelf("purple"), "bob-spirit-2", BOB);
    expect(symbolAdditionCEsFor(state, "bob-spirit-2")).toBe(1);
  });
});
