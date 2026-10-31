import { applyActionAndChooseEntryCores } from "./helpers/choose-effect-entry-cores";
/**
 * BSTH001 (東方靈異伝) カードの effects 検証テスト。
 * 転召/創界石/解封 等の重ギミックは stub。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  executeDestroy,
  executeEffect,
  executeEffectResistance,
  getAvailableMagicPaymentSources,
  getEffectiveSymbols,
  getLegalActions,
  queueRegisteredBattleImmediateEffects,
  rebuildContinuousEffectsFromField,
} from "../src";
import { matchesCardFilter } from "../src/card/card-filter";
import type {
  CardCostPaymentSource,
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  ActiveAttack,
  GameState,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);

function getDeckRevealPickAction(state: GameState) {
  const pending = state.pendingDeckReveal;
  expect(pending).not.toBeNull();
  const action = getLegalActions({
    state,
    actingPlayerId: pending!.actingPlayerId,
    getCardDefinitionById,
  }).find((candidate) => candidate.kind === "resolve_pending_deck_reveal_pick");
  expect(action).toBeDefined();
  if (!action || action.kind !== "resolve_pending_deck_reveal_pick") {
    throw new Error("expected deck reveal pick action");
  }
  return action;
}

function resolveDeckRevealPick(
  state: GameState,
  selectedDeckRevealCardIds: string[]
): GameState {
  const action = getDeckRevealPickAction(state);
  return applyActionAndChooseEntryCores({
    state,
    action,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    selectedDeckRevealCardIds,
  }).state;
}

function resolveDeckRevealOrder(state: GameState): GameState {
  const pending = state.pendingDeckReveal;
  expect(pending).not.toBeNull();
  const action = getLegalActions({
    state,
    actingPlayerId: pending!.actingPlayerId,
    getCardDefinitionById,
  }).find(
    (candidate) => candidate.kind === "resolve_pending_deck_reveal_order"
  );
  expect(action).toBeDefined();
  if (!action || action.kind !== "resolve_pending_deck_reveal_order") {
    throw new Error("expected deck reveal order action");
  }
  return applyLegalAction({
    state,
    action,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
    deckRevealRemainderOrder: action.remainingCardInstanceIds,
  }).state;
}

describe.each([
  ["BSTH001-C01", "purple"],
  ["BSTH001-C02", "red"],
])("%s シンギョク (シンボル/軽減 %s 化)", (cardNo, color) => {
  const card = cardNoMap.get(cardNo)!;
  it("treat_as(symbol+reduction_symbol) + 召喚/アタック deck_reveal + お互いの創界神ネクサスのシンボルを0にする override_properties", () => {
    const t = card.effects![0]!.steps[0]!.action;
    if (t.kind === "treat_as") {
      expect(t.asColor).toBe(color);
      expect(t.aspects).toEqual(["symbol", "reduction_symbol"]);
    }
    expect(card.effects![1]!.steps[0]!.action.kind).toBe("deck_reveal");
    expect(card.effects![2]!.stub).toBeUndefined();
    const override = card.effects![2]!.steps[0]!.action;
    if (
      override.kind === "override_properties" &&
      typeof override.target === "object" &&
      "filter" in override.target
    ) {
      expect(override.target.player).toBe("either");
      // P3-137: tribes:["創界神"]+grandwalkerKind:"grandwalker" narrowing を除去し、
      // targetsGrandwalker:"only" のみで導界者ネクサスも対象に含める。
      expect(override.target.filter).toEqual({
        category: ["nexus"],
        targetsGrandwalker: "only",
      });
      expect(override.properties).toEqual({
        symbols: [],
        symbolCountFixed: true,
      });
      expect(override.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("盤面検証: お互いの創界神ネクサスのシンボルが0になり、非創界神ネクサス/スピリットは維持される", () => {
    const grandwalkerNexus = cardNoMap.get("BSTH05-X01")!; // tribe "創界神・アシハラ"
    const guidedNexus = cardNoMap.get("BSTH003-X01")!; // 導界者ネクサス
    const normalNexus = cardNoMap.get("BSTH001-C03")!; // 非創界神ネクサス
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(card, {
          instanceId: "shingyoku-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(grandwalkerNexus, {
          instanceId: "alice-grandwalker-nexus",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 0,
        }),
        createCardInstance(grandwalkerNexus, {
          instanceId: "bob-grandwalker-nexus",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 0,
        }),
        createCardInstance(normalNexus, {
          instanceId: "bob-normal-nexus",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 0,
        }),
        createCardInstance(guidedNexus, {
          instanceId: "bob-guided-nexus",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
    };

    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const symbolsOf = (instanceId: string, def: CardDefinition) =>
      getEffectiveSymbols(
        rebuilt,
        rebuilt.cardInstances.find((c) => c.instanceId === instanceId)!,
        def,
        getCardDefinitionById
      );

    expect(symbolsOf("alice-grandwalker-nexus", grandwalkerNexus)).toEqual([]);
    expect(symbolsOf("bob-grandwalker-nexus", grandwalkerNexus)).toEqual([]);
    // P3-137: 導界者ネクサスもシンボル変更(作用系)を受ける(10_rules/07:62-67)。
    expect(symbolsOf("bob-guided-nexus", guidedNexus)).toEqual([]);
    expect(symbolsOf("bob-normal-nexus", normalNexus).length).toBeGreaterThan(
      0
    );
  });
});

describe.each([
  [
    "BSTH001-C01",
    "shingyoku-c01-tribe",
    "BSTH001-C03",
    "revealed-nexus-tribe-c03",
  ],
  [
    "BSTH001-C02",
    "shingyoku-c02-tribe",
    "BSTH001-C03",
    "revealed-nexus-tribe-c03",
  ],
  [
    "BSTH001-C01",
    "shingyoku-c01-name",
    "BSTH09.2-転醒R03(A)",
    "revealed-nexus-name-fantasy",
  ],
  [
    "BSTH001-C02",
    "shingyoku-c02-name",
    "BSTH09.2-転醒R03(A)",
    "revealed-nexus-name-fantasy",
  ],
])(
  "%s シンギョク deck_reveal (%s)",
  (cardNo, sourceInstanceId, nexusCardNo, nexusInstanceId) => {
    const card = cardNoMap.get(cardNo)!;

    it("[board] 名前/系統の各OR枝からネクサスをコスト不要配置し、コスト4以上の靈異スピリットを手札に加える", () => {
      const nexus = cardNoMap.get(nexusCardNo)!;
      const spirit = cardNoMap.get("BSTH001-R01")!;
      const filler = cardNoMap.get(
        cardNo === "BSTH001-C01" ? "BSTH001-C02" : "BSTH001-C01"
      )!;
      const other = cardNoMap.get("BSTH001-C04")!;
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
        }),
        activePlayerId: "alice",
        cardInstances: [
          createCardInstance(card, {
            instanceId: sourceInstanceId,
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(nexus, {
            instanceId: nexusInstanceId,
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "deck",
          }),
          createCardInstance(spirit, {
            instanceId: "revealed-spirit-r01",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "deck",
          }),
          createCardInstance(filler, {
            instanceId: "revealed-filler-c01",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "deck",
          }),
          createCardInstance(other, {
            instanceId: "revealed-other-c04",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "deck",
          }),
        ],
      };

      const pending = executeEffect({
        chainId: "test:bsth001-cards:276",
        state,
        effect: card.effects![1]!,
        sourceInstanceId,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
      });

      expect(pending.pendingDeckReveal?.revealedCardInstanceIds).toEqual([
        nexusInstanceId,
        "revealed-spirit-r01",
        "revealed-filler-c01",
        "revealed-other-c04",
      ]);
      const nexusPickAction = getDeckRevealPickAction(pending);
      expect(nexusPickAction.canSkip).toBe(false);
      expect(nexusPickAction.candidateCardInstanceIds).toContain(
        nexusInstanceId
      );
      const afterNexusPick = resolveDeckRevealPick(pending, [nexusInstanceId]);
      const spiritPickAction = getDeckRevealPickAction(afterNexusPick);
      expect(spiritPickAction.canSkip).toBe(false);
      expect(spiritPickAction.candidateCardInstanceIds).toContain(
        "revealed-spirit-r01"
      );
      const afterSpiritPick = resolveDeckRevealPick(afterNexusPick, [
        "revealed-spirit-r01",
      ]);
      const resolved = resolveDeckRevealOrder(afterSpiritPick);

      expect(resolved.pendingDeckReveal).toBeNull();
      expect(
        resolved.cardInstances.find((c) => c.instanceId === nexusInstanceId)
          ?.zone
      ).toBe("field");
      expect(
        resolved.cardInstances.find((c) => c.instanceId === nexusInstanceId)
          ?.zoneRoleName
      ).toBe("nexus");
      expect(
        resolved.cardInstances.find(
          (c) => c.instanceId === "revealed-spirit-r01"
        )?.zone
      ).toBe("hand");
      expect(
        resolved.cardInstances.find(
          (c) => c.instanceId === "revealed-filler-c01"
        )?.zone
      ).toBe("deck");
      expect(
        resolved.cardInstances.find(
          (c) => c.instanceId === "revealed-other-c04"
        )?.zone
      ).toBe("deck");
      // 03a_cost-payment の「cost payment と enter-field core placement は別入力」どおり、
      // deck_reveal の field entry は通常の3コスト配置を通らない。リザーブ0・場の
      // source コア1個でも両者を消費せず着地することを最終盤面で確認する。
      expect(
        resolved.players.find((player) => player.id === "alice")
          ?.reserveNormalCoreCount
      ).toBe(0);
      expect(
        resolved.cardInstances.find((c) => c.instanceId === sourceInstanceId)
          ?.normalCoreCount
      ).toBe(1);
      expect(
        resolved.cardInstances.find((c) => c.instanceId === nexusInstanceId)
          ?.normalCoreCount
      ).toBe(0);
    });
  }
);

describe.each([
  ["BSTH001-C03", "魔界"],
  ["BSTH001-C04", "地獄"],
])("%s %s (nexus)", (cardNo) => {
  const card = cardNoMap.get(cardNo)!;
  it("系統付与(幻想/靈異)", () => {
    const t = card.effects![0]!.steps[0]!.action;
    if (t.kind === "override_properties") {
      expect(t.properties.addTribes).toEqual(["幻想", "靈異"]);
    }
  });
});

describe("BSTH001-C03 魔界 ドローステップ", () => {
  const card = cardNoMap.get("BSTH001-C03")!;

  it("effects[1]: inline draw_modify(+1) 後に手札2枚/靈異1枚/起幻ネクサス1枚の破棄を要求する", () => {
    const effect = card.effects![1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.inline).toBe(true);
    expect(effect.executionMode).toBe("mandatory");
    expect(effect.timing).toEqual({
      kind: "phase",
      step: "draw",
      subPhase: "start",
      whose: "self",
    });
    const draw = effect.steps[0]!.action;
    expect(draw).toEqual({
      kind: "draw_modify",
      amount: 1,
      duration: { scope: "step", step: "draw" },
    });
    const discard = effect.steps[1]!.action;
    expect(discard).toEqual({ kind: "discard", count: 2 });
    expect(effect.steps[1]!.choice?.map((choice) => choice.action)).toEqual([
      { kind: "discard", count: 1, filter: { tribes: ["靈異"] } },
      {
        kind: "discard",
        count: 1,
        filter: { category: ["nexus"], tribes: ["起幻"] },
      },
    ]);
  });

  it("コア→ドロー遷移で2枚ドローし、強制 discard の pendingZoneSelection を開く", () => {
    const makai = createCardInstance(card, {
      instanceId: "makai-draw",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const deckCards = Array.from({ length: 6 }, (_, i) =>
      createCardInstance(card, {
        instanceId: `makai-deck-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const handCards = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(card, {
        instanceId: `makai-hand-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      })
    );
    const kigenNexusDef = ALL_CARDS.find(
      (def) => def.printedCategory === "nexus" && def.tribe?.includes("起幻")
    )!;
    const kigenNexus = createCardInstance(kigenNexusDef, {
      instanceId: "makai-hand-kigen-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "core",
      turnNumber: 2,
      cardInstances: [makai, ...deckCards, ...handCards, kigenNexus],
      players: base.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              deckCount: deckCards.length,
              handCount: handCards.length + 1,
            }
          : player
      ),
    };

    const after = advanceStep(
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions
    );
    const alice = after.players.find((player) => player.id === "alice")!;
    expect(after.step).toBe("draw");
    expect(alice.handCount).toBe(handCards.length + 3);
    expect(alice.deckCount).toBe(deckCards.length - 2);
    expect(after.pendingZoneSelection).toMatchObject({
      actionKind: "discard_hand",
      canSkip: false,
      maxCount: 2,
    });
    expect(after.pendingZoneSelection?.alternateSelections).toHaveLength(2);
  });
});

describe("BSTH001-C03 魔界 フラッシュ追加コスト", () => {
  const card = cardNoMap.get("BSTH001-C03")!;
  const attacker = cardNoMap.get("BSTH001-X01")!;
  const magic = cardNoMap.get("BSTH001-C05")!;

  function buildMakaiState(options?: {
    makaiCores?: number;
    step?: GameState["step"];
    activePlayerId?: string;
    attackerState?: "idle" | "attacking" | "blocking";
  }): GameState {
    const makai = createCardInstance(card, {
      instanceId: "makai-c03",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: options?.makaiCores ?? 1,
    });
    const attackingSpirit = createCardInstance(attacker, {
      instanceId: "alice-purple-rei-attacker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const opponentMagic = createCardInstance(magic, {
      instanceId: "bob-magic-c05",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });

    return {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: options?.activePlayerId ?? "alice",
      step: options?.step ?? "attack",
      cardInstances: [makai, attackingSpirit, opponentMagic],
      battleEntities: [
        {
          entityId: "attack-entity",
          memberInstanceIds: ["alice-purple-rei-attacker"],
          resolvedBp: 7000,
          resolvedSymbols: ["purple", "purple"],
          attackState: options?.attackerState ?? "attacking",
        },
      ],
    };
  }

  function finalMagicCost(
    state: GameState,
    effectMode: "main" | "flash" | "stack"
  ): number {
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    return getAvailableMagicPaymentSources({
      state: rebuilt,
      actingPlayerId: "bob",
      magicInstanceId: "bob-magic-c05",
      getCardDefinitionById,
      effectMode,
    }).reduction.finalCost;
  }

  it("Lv2自分アタックステップ+紫靈異アタック中、相手マジックのフラッシュ使用だけ+3する", () => {
    expect(card.effects![2]!.stub).toBeUndefined();
    expect(card.effects![2]!.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "step_phase", step: "attack", whose: "self" },
      {
        kind: "field_has",
        player: "self",
        category: ["spirit"],
        colors: ["purple"],
        tribes: ["靈異"],
        battleState: "attacking",
        minCount: 1,
      },
    ]);
    const action = card.effects![2]!.steps[0]!.action;
    expect(action).toMatchObject({
      kind: "cost_modify",
      player: "opponent",
      cardFilter: { category: ["magic"], usingEffectMode: ["flash"] },
      modifier: { additionalCostValue: 3 },
      duration: { scope: "while_on_field" },
    });

    expect(finalMagicCost(buildMakaiState(), "flash")).toBe(magic.cost + 3);
    expect(finalMagicCost(buildMakaiState(), "main")).toBe(magic.cost);
  });

  it("Lv不足、自分アタックステップ外、またはアタック中でない場合は追加コストを課さない", () => {
    expect(finalMagicCost(buildMakaiState({ makaiCores: 0 }), "flash")).toBe(
      magic.cost
    );
    expect(finalMagicCost(buildMakaiState({ step: "main" }), "flash")).toBe(
      magic.cost
    );
    expect(
      finalMagicCost(buildMakaiState({ attackerState: "blocking" }), "flash")
    ).toBe(magic.cost);
  });

  it("相手のアタックステップでは、紫靈異スピリットがアタック中でも追加コストを課さない", () => {
    expect(
      finalMagicCost(buildMakaiState({ activePlayerId: "bob" }), "flash")
    ).toBe(magic.cost);
  });
});

describe("BSTH001-C04 地獄 フラッシュ実行", () => {
  const card = cardNoMap.get("BSTH001-C04")!;
  it("フラッシュ: 疲労コスト→draw (ターン1回)", () => {
    const flash = card.effects![1]!;
    expect(flash.condition).toEqual([
      { kind: "self_state", state: "recovered" },
      { kind: "field_has", player: "self", zone: "deck", minCount: 1 },
    ]);
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(flash.steps[0]!.action.kind).toBe("set_exhaust_state");
    expect(flash.steps[1]!.connector).toBe("conditional_cost");
  });

  it("公式Q22385適用: 疲労済みまたはデッキ0枚ではフラッシュ action に列挙せず、no-op 宣言を反復しない", () => {
    const fieldLookup = buildFieldCardEffectLookup([card]);
    const actionsFor = (
      exhaustState: "recovered" | "exhausted",
      deckCount: number
    ) =>
      getLegalActions({
        state: {
          ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
          activePlayerId: "alice",
          step: "main",
          cardInstances: [
            createCardInstance(card, {
              instanceId: "hell-1",
              ownerPlayerId: "alice",
              controllerPlayerId: "alice",
              zone: "field",
              exhaustState,
            }),
            ...Array.from({ length: deckCount }, (_, index) =>
              createCardInstance(card, {
                instanceId: `deck-${index}`,
                ownerPlayerId: "alice",
                controllerPlayerId: "alice",
                zone: "deck",
              })
            ),
          ],
        },
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: fieldLookup,
      }).filter(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "hell-1"
      );

    expect(actionsFor("recovered", 1)).toHaveLength(1);
    expect(actionsFor("exhausted", 1)).toHaveLength(0);
    expect(actionsFor("recovered", 0)).toHaveLength(0);
  });
});

describe.each([
  ["BSTH001-C05", "death"],
  ["BSTH001-C06", "swordsman"],
])("%s マジック", (cardNo) => {
  const card = cardNoMap.get(cardNo)!;
  it("系統付与 + 靈異発生源限定自己回収 + フラッシュ/スタック", () => {
    const t = card.effects![0]!.steps[0]!.action;
    if (t.kind === "override_properties") {
      expect(t.properties.addTribes).toEqual(["幻想", "靈異"]);
    }
    expect(card.effects!.some((e) => e.timing.kind === "activated")).toBe(true);
  });
});

describe("BSTH001-C05 死なばもろとも", () => {
  const card = cardNoMap.get("BSTH001-C05")!;
  const flash = card.effects!.find(
    (effect) =>
      effect.timing.kind === "activated" && effect.timing.mode === "flash"
  )!;

  it("フラッシュ破壊は疲労状態の相手スピリット限定で、count2以上は残置抑制を付ける", () => {
    expect(flash.stub).toBeUndefined();
    const normal = flash.steps[0]!.action;
    const suppressed = flash.steps[1]!.action;
    if (
      normal.kind === "destroy" &&
      typeof normal.target === "object" &&
      "filter" in normal.target
    ) {
      expect(normal.target.filter).toMatchObject({
        category: ["spirit"],
        exhaustState: "exhausted",
      });
      expect(normal.suppressDestroyedEffects).toBeUndefined();
    }
    if (
      suppressed.kind === "destroy" &&
      typeof suppressed.target === "object" &&
      "filter" in suppressed.target
    ) {
      expect(suppressed.target.filter).toMatchObject({
        category: ["spirit"],
        exhaustState: "exhausted",
      });
      expect(suppressed.suppressDestroyedEffects).toBe("destroyed_only");
    }
    expect(flash.steps[0]!.condition).toEqual([
      { kind: "count_value", player: "self", max: 1 },
    ]);
    expect(flash.steps[1]!.condition).toEqual([
      { kind: "count_value", player: "self", min: 2 },
    ]);
  });

  it("[board] count2以上では回復状態を候補外にし、疲労対象に残置抑制付き破壊を積む", () => {
    const exhausted = createCardInstance(cardNoMap.get("BSTH001-R01")!, {
      instanceId: "enemy-exhausted",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const recovered = createCardInstance(cardNoMap.get("BSTH001-R02")!, {
      instanceId: "enemy-recovered",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [exhausted, recovered],
      playerOverrides: [{ countValue: 2 }, {}],
    });

    const result = executeEffect({
      chainId: "test:bsth001-cards:716",
      state,
      effect: flash,
      sourceInstanceId: "death-c05",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(result.pendingLeaveEntities).toHaveLength(1);
    expect(result.pendingLeaveEntities[0]).toMatchObject({
      instanceId: "enemy-exhausted",
      suppressDestroyedEffects: "destroyed_only",
    });
    expect(
      result.pendingLeaveEntities.some(
        (entry) => entry.instanceId === "enemy-recovered"
      )
    ).toBe(false);
  });

  it("[board] スタック: 最低Lvコスト1の相手2体を、コアが1個ずつになるようリザーブへ", () => {
    const stack = card.effects!.find(
      (effect) =>
        effect.timing.kind === "activated" && effect.timing.mode === "stack"
    )!;
    expect(stack.stub).toBeUndefined();
    expect(stack.timingScope).toEqual({ player: "both", period: "attack" });
    const targetA = createCardInstance(cardNoMap.get("BSGE01-CX03")!, {
      instanceId: "c05-lv1cost1-a",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4,
    });
    const targetB = createCardInstance(cardNoMap.get("BSGE01-CX03")!, {
      instanceId: "c05-lv1cost1-b",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const source = createCardInstance(card, {
      instanceId: "death-c05-stack",
      ownerPlayerId: "alice",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const before = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [targetA, targetB, source],
        playerOverrides: [{}, { reserveNormalCoreCount: 0 }],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
    };
    const after = executeEffect({
      chainId: "test:bsth001-cards:771",
      state: before,
      effect: stack,
      sourceInstanceId: "death-c05-stack",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["c05-lv1cost1-a", "c05-lv1cost1-b"],
    });
    const afterA = after.cardInstances.find(
      (x) => x.instanceId === "c05-lv1cost1-a"
    )!;
    const afterB = after.cardInstances.find(
      (x) => x.instanceId === "c05-lv1cost1-b"
    )!;
    expect(afterA.normalCoreCount).toBe(1);
    expect(afterB.normalCoreCount).toBe(1);
    const bob = after.players.find((p) => p.id === "bob")!;
    expect(bob.reserveNormalCoreCount).toBe(3);
  });
});

describe("BSTH001-M01 博麗 靈夢", () => {
  const card = cardNoMap.get("BSTH001-M01")!;
  it("召喚時 導界者Lv2(game) / Lv2 召喚アタック destroy(unpreventable)", () => {
    expect(card.effects![0]!.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
    expect(card.effects![0]!.executionMode).toBe("optional");
    expect(card.effects![0]!.stub).toBeUndefined();
    const levelSet = card.effects![0]!.steps[0]!.action;
    expect(levelSet).toEqual({
      kind: "core_set_to_level",
      from: { kind: "void", player: "self" },
      target: {
        kind: "filter",
        player: "self",
        filter: {
          category: ["nexus"],
          colors: ["red"],
          targetsGrandwalker: "only",
          grandwalkerKind: "guided",
        },
        count: "all",
      },
      level: 2,
    });
    const d = card.effects![1]!;
    expect(d.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(d.preventionLevel).toBe("unpreventable");
    expect(d.stub).toBeUndefined();
    expect(d.steps[0]!.action.kind).toBe("destroy");
  });

  function cannotBeDestroyedCE(
    targetInstanceId: string,
    ownerPlayerId: string
  ): ContinuousEffect {
    const tag: ContinuousEffectTag = "cannot_be_destroyed";
    return {
      effectId: `test-${tag}-${targetInstanceId}`,
      sourceInstanceId: "test-source",
      sourceDefinitionId: "test",
      actingPlayerId: ownerPlayerId,
      duration: { scope: "permanent" },
      createdAtTurn: 0,
      createdAtAttackId: null,
      modifierTag: tag,
      targetInstanceId,
      metadata: { source: "opponent_effect" },
    };
  }

  it("召喚時: 自分の赤導界者ネクサスすべてにLv2不足分だけボイドから置く", () => {
    const redGuidedDef: CardDefinition = {
      cardNo: "TEST-RED-GUIDED",
      name: "red guided",
      colors: ["red"],
      cost: 3,
      reduction: [],
      symbols: ["red"],
      symbolColors: ["red"],
      cardType: "nexus",
      printedCategory: "nexus",
      levelDefs: [
        { level: 1, requiredCores: 0, bp: 0 },
        { level: 2, requiredCores: 2, bp: 0 },
      ],
      textLines: [],
      grandwalkerData: { kind: "guided" },
    };
    const redGrandwalkerDef: CardDefinition = {
      ...redGuidedDef,
      cardNo: "TEST-RED-GRANDWALKER",
      name: "red grandwalker",
      grandwalkerData: { kind: "grandwalker" },
    };
    const blueGuidedDef: CardDefinition = {
      ...redGuidedDef,
      cardNo: "TEST-BLUE-GUIDED",
      name: "blue guided",
      colors: ["blue"],
      symbols: ["blue"],
      symbolColors: ["blue"],
    };
    const redNormalNexusDef: CardDefinition = {
      ...redGuidedDef,
      cardNo: "TEST-RED-NORMAL-NEXUS",
      name: "red normal nexus",
      grandwalkerData: undefined,
    };
    const source = createCardInstance(card, {
      instanceId: "reimu-m01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const guidedEmpty = createCardInstance(redGuidedDef, {
      instanceId: "guided-empty",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const guidedOne = createCardInstance(redGuidedDef, {
      instanceId: "guided-one",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const grandwalker = createCardInstance(redGrandwalkerDef, {
      instanceId: "red-grandwalker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const blueGuided = createCardInstance(blueGuidedDef, {
      instanceId: "blue-guided",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const normalNexus = createCardInstance(redNormalNexusDef, {
      instanceId: "normal-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const bobGuided = createCardInstance(redGuidedDef, {
      instanceId: "bob-guided",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 0,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        source,
        guidedEmpty,
        guidedOne,
        grandwalker,
        blueGuided,
        normalNexus,
        bobGuided,
      ],
      players: base.players.map((player) =>
        player.id === "alice" ? { ...player, voidNormalCoreCount: 3 } : player
      ),
    };
    const defs = new Map(cardNoMap);
    for (const def of [
      redGuidedDef,
      redGrandwalkerDef,
      blueGuidedDef,
      redNormalNexusDef,
    ]) {
      defs.set(def.cardNo, def);
    }
    const after = executeEffect({
      chainId: "test:bsth001-cards:962",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
    const core = (id: string) =>
      after.cardInstances.find((ci) => ci.instanceId === id)!.normalCoreCount;
    expect(core("guided-empty")).toBe(2);
    expect(core("guided-one")).toBe(2);
    expect(core("red-grandwalker")).toBe(0);
    expect(core("blue-guided")).toBe(0);
    expect(core("normal-nexus")).toBe(0);
    expect(core("bob-guided")).toBe(0);
    expect(
      after.players.find((player) => player.id === "alice")!.voidNormalCoreCount
    ).toBe(0);
  });

  it("Lv2 destroy 実行: 相手の cannot_be_destroyed 耐性でも防げない (preventionLevel:unpreventable)", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 0,
    });
    const self = createCardInstance(card, {
      instanceId: "reimu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const enemy = createCardInstance(cardNoMap.get("BSTH001-R01")!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, enemy],
      activeContinuousEffects: [cannotBeDestroyedCE("enemy-1", "bob")],
    };
    const result = executeEffect({
      chainId: "test:bsth001-cards:1009",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "reimu-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "enemy-1")
    ).toBeDefined();
  });

  it("Lv2 destroy 実行: 相手が leave enqueue", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 0,
    });
    const self = createCardInstance(card, {
      instanceId: "reimu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const enemy = createCardInstance(cardNoMap.get("BSTH001-R01")!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, enemy],
    };
    const result = executeEffect({
      chainId: "test:bsth001-cards:1046",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "reimu-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.pendingLeaveEntities.find((e) => e.instanceId === "enemy-1")
    ).toBeDefined();
  });

  // P3-143: 「一切の効果で防げない」= targetLockBypass:{kind:"all_effects"} が
  // BSTH06-X02 型の target lock（cannot_be_targeted/cannot_include）を貫通する。
  // 「お互いの効果で防げない」(blanket_affect_immunity) と通常の「相手の効果では
  // 防げない」(preventionLevel のみ) は貫通しないことも同時に検証する（4段構造の裁定）。
  it("『一切の効果で防げない』は BSTH06-X02 の target lock を貫通する／『お互い』・通常『防げない』は貫通しない", () => {
    const koishiCard = cardNoMap.get("BSTH06-X02")!;
    const koishi = createCardInstance(koishiCard, {
      instanceId: "m01-vs-koishi",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const reimu = createCardInstance(card, {
      instanceId: "m01-vs-koishi-reimu",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const base = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [koishi, reimu],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
    };
    const locked = executeEffect({
      chainId: "test:bsth001-cards:1086",
      state: base,
      effect: koishiCard.effects![1]!,
      sourceInstanceId: koishi.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      locked.activeContinuousEffects
        .filter((ce) => ce.targetInstanceId === koishi.instanceId)
        .map((ce) => ce.modifierTag)
    ).toEqual(["cannot_be_targeted", "cannot_include"]);

    // 「一切」= M01 実カードの rider そのまま (preventionLevel:"unpreventable",
    // targetLockBypass:{kind:"all_effects"})。
    const afterAllEffectsDestroy = executeEffect({
      chainId: "test:bsth001-cards:1102",
      state: locked,
      effect: card.effects![1]!,
      sourceInstanceId: reimu.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [koishi.instanceId],
    });
    expect(
      afterAllEffectsDestroy.cardInstances.find(
        (c) => c.instanceId === koishi.instanceId
      )?.pendingLeaveKind
    ).toBe("destroy");

    // 「お互い」= BSAZ02-C14 の rider (blanket_affect_immunity)。affect immunity 軸限定で
    // target lock は貫通しない。
    const mutualDestroyEffect = {
      ...card.effects![1]!,
      targetLockBypass: { kind: "blanket_affect_immunity" as const },
    };
    const afterMutualDestroy = executeEffect({
      chainId: "test:bsth001-cards:1123",
      state: locked,
      effect: mutualDestroyEffect,
      sourceInstanceId: reimu.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [koishi.instanceId],
    });
    expect(
      afterMutualDestroy.cardInstances.find(
        (c) => c.instanceId === koishi.instanceId
      )?.pendingLeaveKind
    ).toBeNull();

    // 通常の「相手の効果では防げない」(20 枚) = preventionLevel:"unpreventable" のみ、
    // targetLockBypass 無し。
    const normalDestroyEffect = {
      ...card.effects![1]!,
      targetLockBypass: undefined,
    };
    const afterNormalDestroy = executeEffect({
      chainId: "test:bsth001-cards:1144",
      state: locked,
      effect: normalDestroyEffect,
      sourceInstanceId: reimu.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [koishi.instanceId],
    });
    expect(
      afterNormalDestroy.cardInstances.find(
        (c) => c.instanceId === koishi.instanceId
      )?.pendingLeaveKind
    ).toBeNull();
  });
});

describe("BSTH001-R01 魅魔", () => {
  const card = cardNoMap.get("BSTH001-R01")!;
  function resolveFieldActionWithPayment(
    initial: GameState,
    sourceInstanceId: string,
    payCostPaymentSources: CardCostPaymentSource[]
  ): GameState {
    const fieldLookup = buildFieldCardEffectLookup([card]);
    const fieldAction = getLegalActions({
      state: initial,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === sourceInstanceId
    );
    expect(fieldAction).toMatchObject({ requiredPayCostAmount: 1 });
    if (!fieldAction || fieldAction.kind !== "use_field_card_effect") {
      throw new Error("expected BSTH001-R01 field action");
    }

    let current = applyLegalAction({
      state: initial,
      action: fieldAction,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions,
      payCostPaymentSources,
    }).state;
    for (let i = 0; i < 8 && current.stackWindow !== null; i++) {
      const pass = getLegalActions({
        state: current,
        actingPlayerId: current.stackWindow.priorityPlayerId,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: fieldLookup,
        getRegisteredTriggeredEffectActions,
      }).find((action) => action.kind === "pass_stack");
      if (!pass) break;
      current = applyLegalAction({
        state: current,
        action: pass,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: fieldLookup,
        getRegisteredTriggeredEffectActions,
      }).state;
    }
    expect(current.stackWindow).toBeNull();
    return current;
  }

  it("召喚/アタック destroy(nexus) / フラッシュ draw(turn)", () => {
    const d = card.effects![0]!.steps[0]!.action;
    if (
      d.kind === "destroy" &&
      typeof d.target === "object" &&
      "filter" in d.target
    ) {
      expect(d.target.filter.category).toEqual(["nexus"]);
    }
    expect(card.effects![1]!.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
  });

  it("フラッシュ「1コスト支払うことで」: pay_cost(1) + conditional_cost draw", () => {
    const flash = card.effects![1]!;
    expect(flash.stub).toBeUndefined();
    expect(flash.condition).toEqual([
      { kind: "field_has", player: "self", zone: "deck", minCount: 1 },
    ]);
    expect(flash.steps[0]!.action.kind).toBe("pay_cost");
    expect(flash.steps[0]!.action).toMatchObject({
      allowFieldCorePayment: true,
    });
    expect(flash.steps[1]!.connector).toBe("conditional_cost");
    expect(flash.steps[1]!.action.kind).toBe("draw");
  });

  it("公式Q22385適用: デッキ0枚ではフラッシュ action に列挙せず、no-op 宣言を反復しない", () => {
    const fieldLookup = buildFieldCardEffectLookup([card]);
    const actionsFor = (deckCount: number) =>
      getLegalActions({
        state: {
          ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
          activePlayerId: "alice",
          step: "main",
          cardInstances: [
            createCardInstance(card, {
              instanceId: "mima-r01-availability",
              ownerPlayerId: "alice",
              controllerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            }),
            ...Array.from({ length: deckCount }, (_, index) =>
              createCardInstance(cardNoMap.get("BSTH001-R02")!, {
                instanceId: `mima-r01-deck-${index}`,
                ownerPlayerId: "alice",
                controllerPlayerId: "alice",
                zone: "deck",
              })
            ),
          ],
        },
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: fieldLookup,
      }).filter(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "mima-r01-availability"
      );

    expect(actionsFor(1)).toHaveLength(1);
    expect(actionsFor(0)).toHaveLength(0);
  });

  it("[board] 支払い可: リザーブ1→0 / トラッシュ+1 / ドロー1", () => {
    // 源スピリットのコアは 0（リザーブを唯一の支払い源にして配分 pending を避ける）。
    const src = createCardInstance(card, {
      instanceId: "mima-r01",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    // デッキに実カードを置く（draw が実カード移動を伴わないと
    // conditional_cost の効果側成功判定が立たず双方向ロールバックする）。
    const deck = Array.from({ length: 2 }, (_, i) =>
      createCardInstance(cardNoMap.get("BSTH001-R02")!, {
        instanceId: `deck-r01-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [src, ...deck],
      playerOverrides: [
        { handCount: 0, deckCount: 2, reserveNormalCoreCount: 1 },
        {},
      ],
    });
    const after = executeEffect({
      chainId: "test:bsth001-cards:1309",
      state: before,
      effect: card.effects![1]!,
      sourceInstanceId: "mima-r01",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const a = after.players.find((p) => p.id === "alice")!;
    expect(a.reserveNormalCoreCount).toBe(0);
    expect(a.trashNormalCoreCount).toBe(1);
    expect(a.handCount).toBe(1);
    expect(a.deckCount).toBe(1);
  });

  it("[noninteractive] リザーブ不足時は field core fallback で支払ってドローする", () => {
    const src = createCardInstance(card, {
      instanceId: "mima-r01-field-payment",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const deck = createCardInstance(cardNoMap.get("BSTH001-R02")!, {
      instanceId: "mima-r01-field-payment-deck",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [src, deck],
      playerOverrides: [
        { handCount: 0, deckCount: 1, reserveNormalCoreCount: 0 },
        {},
      ],
    });
    const after = executeEffect({
      chainId: "test:bsth001-cards:1346",
      state: before,
      effect: card.effects![1]!,
      sourceInstanceId: src.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const a = after.players.find((p) => p.id === "alice")!;
    expect(
      after.cardInstances.find((c) => c.instanceId === src.instanceId)
        ?.normalCoreCount
    ).toBe(1);
    expect(a.trashNormalCoreCount).toBe(1);
    expect(a.handCount).toBe(1);
    expect(a.deckCount).toBe(0);
  });

  it("[board] field action は既存 paymentSources で選んだ field core を支払い、ドローする", () => {
    const source = createCardInstance(card, {
      instanceId: "mima-r01-choice-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const chosenPaymentSource = createCardInstance(card, {
      instanceId: "mima-r01-choice-payment-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const deck = createCardInstance(cardNoMap.get("BSTH001-R02")!, {
      instanceId: "mima-r01-choice-deck",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const initial: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, chosenPaymentSource, deck],
        playerOverrides: [
          { handCount: 0, deckCount: 1, reserveNormalCoreCount: 0 },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const resolved = resolveFieldActionWithPayment(initial, source.instanceId, [
      { kind: "card", instanceId: chosenPaymentSource.instanceId, amount: 1 },
    ]);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === source.instanceId)
        ?.normalCoreCount
    ).toBe(2);
    expect(
      resolved.cardInstances.find(
        (c) => c.instanceId === chosenPaymentSource.instanceId
      )?.normalCoreCount
    ).toBe(1);
    const alice = resolved.players.find((player) => player.id === "alice")!;
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.handCount).toBe(1);
    expect(alice.deckCount).toBe(0);
  });

  it("[board] field action は field 通常コアがあっても reserve のソウルコアを支払いに選べる", () => {
    const source = createCardInstance(card, {
      instanceId: "mima-r01-soul-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const alternateFieldSource = createCardInstance(card, {
      instanceId: "mima-r01-soul-alternate",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
    });
    const deck = createCardInstance(cardNoMap.get("BSTH001-R02")!, {
      instanceId: "mima-r01-soul-deck",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const initial: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, alternateFieldSource, deck],
        playerOverrides: [
          {
            handCount: 0,
            deckCount: 1,
            reserveNormalCoreCount: 0,
            soulCoreLocation: { kind: "reserve" },
          },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const resolved = resolveFieldActionWithPayment(initial, source.instanceId, [
      { kind: "reserve", amount: 1, includeSoulCore: true },
    ]);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === source.instanceId)
        ?.normalCoreCount
    ).toBe(2);
    expect(
      resolved.cardInstances.find(
        (c) => c.instanceId === alternateFieldSource.instanceId
      )?.normalCoreCount
    ).toBe(2);
    const alice = resolved.players.find((player) => player.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({ kind: "trash" });
    expect(alice.handCount).toBe(1);
    expect(alice.deckCount).toBe(0);
  });

  it("[board] 支払い不能: リザーブ0 → 双方向ロールバックでドローしない", () => {
    const src = createCardInstance(card, {
      instanceId: "mima-r01b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [src],
      playerOverrides: [
        { handCount: 0, deckCount: 10, reserveNormalCoreCount: 0 },
        {},
      ],
    });
    const after = executeEffect({
      chainId: "test:bsth001-cards:1489",
      state: before,
      effect: card.effects![1]!,
      sourceInstanceId: "mima-r01b",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const a = after.players.find((p) => p.id === "alice")!;
    expect(a.reserveNormalCoreCount).toBe(0);
    expect(a.handCount).toBe(0);
    expect(a.deckCount).toBe(10);
  });
});

describe("BSTH001-C06 星幽剣士 スタック「1コスト支払うことで」破壊", () => {
  const card = cardNoMap.get("BSTH001-C06")!;
  it("stub解消: pay_cost(1) + conditional_cost destroy(blocking)", () => {
    const stack = card.effects![3]!;
    expect(stack.stub).toBeUndefined();
    expect(stack.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stack.steps[0]!.action.kind).toBe("pay_cost");
    const d = stack.steps[1]!;
    expect(d.connector).toBe("conditional_cost");
    if (
      d.action.kind === "destroy" &&
      typeof d.action.target === "object" &&
      "filter" in d.action.target
    ) {
      expect(d.action.target.filter.battleState).toBe("blocking");
    }
  });
});

describe("BSTH001-R02 キクリ", () => {
  const card = cardNoMap.get("BSTH001-R02")!;
  it("アタック destroy(BP10000以下,残らない) / 回復 / スタックnegate", () => {
    const eff = card.effects![0]!;
    expect(eff.stub).toBeUndefined();
    const d = eff.steps[0]!.action;
    if (
      d.kind === "destroy" &&
      typeof d.target === "object" &&
      "filter" in d.target
    ) {
      expect(d.target.filter.maxBp).toBe(10000);
      expect(d.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(d.suppressDestroyedEffects).toBe("destroyed_only");
      // 『破壊したスピリットは、フィールドに残らない』= 残置抑制は spirit のみ
      // (ultimate を破壊した case では通常残置効果が発揮される)。
      expect(d.suppressDestroyedEffectsByCategory).toEqual(["spirit"]);
    }
    expect(card.effects![1]!.steps[0]!.action.kind).toBe("recover");
  });

  it("挙動: spirit 破壊は suppressDestroyedEffects 適用 / ultimate 破壊は適用しない (BSTH001-R02)", () => {
    // executeDestroy を直接呼び、片方 spirit / もう片方 ultimate の opponent カードを
    // 順に対象にし、pendingLeaveEntities に積まれた suppressDestroyedEffects の有無を比較。
    // 『破壊したスピリットは、フィールドに残らない』= ultimate には抑制が掛からない。
    const spiritDef = cardNoMap.get("BSTH001-R02")!; // 任意の spirit 定義を流用
    const ultimateDef: CardDefinition = {
      ...spiritDef,
      cardNo: "TEST-ULTI-1",
      printedCategory: "ultimate",
    };
    const getCardDef = (id: string): CardDefinition | undefined => {
      if (id === "BSTH001-R02") return spiritDef;
      if (id === "TEST-ULTI-1") return ultimateDef;
      return cardNoMap.get(id);
    };

    const baseState: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
    });

    // Spirit を破壊
    const spiritTarget = createCardInstance(spiritDef, {
      instanceId: "spirit-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const stateWithSpirit: GameState = {
      ...baseState,
      cardInstances: [spiritTarget],
    };
    const afterSpirit = executeDestroy(
      stateWithSpirit,
      "alice",
      { selfCard: false, player: "opponent", count: 1 },
      getCardDef,
      "src",
      ["spirit-target"],
      "destroyed_only",
      "none",
      undefined,
      ["spirit"]
    );
    const spiritPending = afterSpirit.pendingLeaveEntities.find(
      (p) => p.instanceId === "spirit-target"
    );
    expect(spiritPending?.suppressDestroyedEffects).toBe("destroyed_only");

    // Ultimate を破壊 (同じ抑制設定) → printedCategory が "ultimate" のため抑制 OFF
    const ultimateTarget = createCardInstance(ultimateDef, {
      instanceId: "ultimate-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const stateWithUltimate: GameState = {
      ...baseState,
      cardInstances: [ultimateTarget],
    };
    const afterUltimate = executeDestroy(
      stateWithUltimate,
      "alice",
      { selfCard: false, player: "opponent", count: 1 },
      getCardDef,
      "src",
      ["ultimate-target"],
      "destroyed_only",
      "none",
      undefined,
      ["spirit"]
    );
    const ultimatePending = afterUltimate.pendingLeaveEntities.find(
      (p) => p.instanceId === "ultimate-target"
    );
    expect(ultimatePending?.suppressDestroyedEffects).toBeUndefined();
  });

  it("cannot_leave_field 耐性: spirit (category 一致) は pierce / ultimate (category 外) は pierce しない", () => {
    // 残置抑制の category-conditional 適用は pierce 判定にも揃える必要がある:
    // 「破壊したスピリットは…残らない」の文言は spirit にのみ作用する → ultimate は
    // 通常の destroy として扱われ、cannot_leave_field を貫通してはいけない (Q19 スコープ外)。
    const spiritDef = cardNoMap.get("BSTH001-R02")!;
    const ultimateDef: CardDefinition = {
      ...spiritDef,
      cardNo: "TEST-ULTI-2",
      printedCategory: "ultimate",
    };
    const getCardDef = (id: string): CardDefinition | undefined => {
      if (id === "BSTH001-R02") return spiritDef;
      if (id === "TEST-ULTI-2") return ultimateDef;
      return cardNoMap.get(id);
    };

    const buildStateWithImmunity = (
      target: ReturnType<typeof createCardInstance>
    ) => {
      let state: GameState = {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        cardInstances: [target],
      };
      state = executeEffectResistance(
        state,
        "bob",
        {
          kind: "effect_resistance",
          target: { selfCard: true, count: 1 },
          resistType: "cannot_leave_field",
          source: "opponent_effect",
          duration: { scope: "permanent" },
        },
        target.instanceId,
        getCardDef
      );
      return state;
    };

    // Spirit: pierce が掛かり破壊待機 (pendingLeaveKind="destroy")
    const spiritTarget = createCardInstance(spiritDef, {
      instanceId: "spirit-imm",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const spiritState = buildStateWithImmunity(spiritTarget);
    const afterSpirit = executeDestroy(
      spiritState,
      "alice",
      { selfCard: false, player: "opponent", count: 1 },
      getCardDef,
      "src",
      ["spirit-imm"],
      "destroyed_only",
      "none",
      undefined,
      ["spirit"]
    );
    const spiritResult = afterSpirit.cardInstances.find(
      (c) => c.instanceId === "spirit-imm"
    );
    expect(spiritResult?.pendingLeaveKind).toBe("destroy");

    // Ultimate: pierce 掛からず blockedByResistance で残置 (pendingLeaveKind は null のまま)
    const ultimateTarget = createCardInstance(ultimateDef, {
      instanceId: "ultimate-imm",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const ultimateState = buildStateWithImmunity(ultimateTarget);
    const afterUltimate = executeDestroy(
      ultimateState,
      "alice",
      { selfCard: false, player: "opponent", count: 1 },
      getCardDef,
      "src",
      ["ultimate-imm"],
      "destroyed_only",
      "none",
      undefined,
      ["spirit"]
    );
    const ultimateResult = afterUltimate.cardInstances.find(
      (c) => c.instanceId === "ultimate-imm"
    );
    expect(ultimateResult?.pendingLeaveKind).toBeNull();
    const blockedEntry = afterUltimate.pendingLeaveEntities.find(
      (p) => p.instanceId === "ultimate-imm"
    );
    expect(blockedEntry?.blockedByResistance).toBe(true);
  });
});

describe("BSTH001-X01 サリエル", () => {
  const card = cardNoMap.get("BSTH001-X01")!;
  it("転召: 召喚手順内ステップ tenshoSummon（幻想＆コスト3以上・最低1コア・ボイド送り）", () => {
    // 召喚時効果（card_event:summon）ではなく召喚手順内ステップ（裁定 2026-06-14, 10_rules/07b）。
    // 適法性ゲート + 強制コア消費の盤面挙動は tensho-summon-gate.test.ts が汎用に検証する。
    expect(card.tenshoSummon).toBeDefined();
    expect(card.tenshoSummon!.minCores).toBe(1);
    expect(card.tenshoSummon!.destination).toBe("void");
    expect(card.tenshoSummon!.targetFilter.tribesRequired).toEqual(["幻想"]);
    expect(card.tenshoSummon!.targetFilter.minCost).toBe(3);
    // 旧 card_event:summon 強制誘発は廃止。
    expect(
      card.effects!.some(
        (e) => e.timing.kind === "card_event" && e.timing.event === "summon"
      )
    ).toBe(false);
  });

  it("Lv2 効果耐性(field_lacks grandwalker)", () => {
    const immune = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_immunity"
    )!;
    expect(immune.condition).toContainEqual({
      kind: "field_lacks",
      player: "self",
      grandwalkerKind: "any",
    });
  });
});

describe("BSTH001-X02 コンガラ", () => {
  const card = cardNoMap.get("BSTH001-X02")!;
  it("転召(召喚手順内ステップ tenshoSummon) + アタック時 創界神1つ全コア除去 + 相手効果耐性 + バトル終了回復", () => {
    expect(card.tenshoSummon).toBeDefined();
    expect(card.tenshoSummon!.minCores).toBe(1);
    expect(card.tenshoSummon!.destination).toBe("void");
    expect(card.tenshoSummon!.targetFilter.tribesRequired).toEqual(["幻想"]);
    // アタック時 創界神コア除去 effect (stub 解消)
    const strip = card.effects!.find(
      (e) =>
        e.steps[0]?.action.kind === "core_move" &&
        e.steps[0]?.action.target?.kind === "filter" &&
        e.steps[0]?.action.target.filter.targetsGrandwalker === true
    )!;
    expect(strip).toBeDefined();
    expect(strip.stub).toBeUndefined();
    const step = strip.steps[0]!.action;
    if (step.kind === "core_move") {
      expect(step.amount).toBe("all");
      expect(step.from).toEqual({ kind: "target_card" });
      expect(step.to).toEqual({ kind: "void", player: "opponent" });
      if (step.target?.kind === "filter") {
        expect(step.target.count).toBe(1);
        expect(step.target.player).toBe("opponent");
        expect(step.target.filter.category).toEqual(["nexus"]);
        expect(step.target.filter.tribes).toEqual(["導界者", "創界神"]);
      }
    }
    // effect_immunity 分離: ENGINE-battle-end-pending-triggered-vs-scope-battle-ce
    // (finalizeBattleEndScopeExpirations を battle_end 由来 pendingTriggeredEffects の
    // drain まで遅延) の着地後に再分離。
    const imm = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_immunity"
    )!;
    expect(imm).toBeDefined();
    expect(imm.stub).toBeUndefined();
    expect(imm.timing).toEqual({ kind: "card_event", event: "attack" });
    if (imm.steps[0]!.action.kind === "effect_immunity") {
      expect(imm.steps[0]!.action.target).toEqual({ kind: "self" });
      expect(imm.steps[0]!.action.duration).toEqual({ scope: "battle" });
    }
    const rec = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "recover"
    )!;
    expect(rec).toBeDefined();
    expect(rec.stub).toBeUndefined();
    expect(rec.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(rec.timing.kind).toBe("card_event");
    if (rec.timing.kind === "card_event") {
      expect(rec.timing.event).toBe("attack");
      expect(rec.timing.deferredTo).toBe("battle_end");
    }
  });

  it("アタック時 創界神コア除去 対象取得 + 実行: 候補は創界神/導界者のみ・実行で全コアがボイドへ", () => {
    const stripEffect = card.effects!.find(
      (e) =>
        e.steps[0]?.action.kind === "core_move" &&
        e.steps[0]?.action.target?.kind === "filter" &&
        e.steps[0]?.action.target.filter.targetsGrandwalker === true
    )!;
    const grandwalkerCard: CardDefinition = {
      cardNo: "TEST-GW-1",
      orikaId: 999000,
      orikaIndex: 999000,
      name: "テスト創界神",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      tribe: "創界神",
      image: "",
      rarity: "C",
      pack: "",
      maxDeckCount: 0,
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "grandwalker" },
      effects: [],
    };
    const guidedCard: CardDefinition = {
      cardNo: "TEST-GD-1",
      orikaId: 999001,
      orikaIndex: 999001,
      name: "テスト導界者",
      printedCategory: "nexus",
      colors: ["blue"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      tribe: "導界者・起幻",
      image: "",
      rarity: "C",
      pack: "",
      maxDeckCount: 0,
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "guided" },
      effects: [],
    };
    const plainNexusCard: CardDefinition = {
      cardNo: "TEST-NEX-1",
      orikaId: 999002,
      orikaIndex: 999002,
      name: "テスト通常ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      tribe: "幻想",
      image: "",
      rarity: "C",
      pack: "",
      maxDeckCount: 0,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    cardNoMap.set(grandwalkerCard.cardNo, grandwalkerCard);
    cardNoMap.set(guidedCard.cardNo, guidedCard);
    cardNoMap.set(plainNexusCard.cardNo, plainNexusCard);
    const stripStep = stripEffect.steps[0]!.action;
    if (stripStep.kind !== "core_move" || stripStep.target?.kind !== "filter") {
      throw new Error("expected core_move with filter target");
    }
    const filter = stripStep.target.filter;
    // Lens 5: 取得経路の検証。matchesCardFilter で候補列挙し、創界神/導界者は候補化、
    // 通常ネクサスは弾かれることを直接 assert する。
    const grandwalkerInst = createCardInstance(grandwalkerCard, {
      instanceId: "gw-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const guidedInst = createCardInstance(guidedCard, {
      instanceId: "gd-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
    });
    const plainNexusInst = createCardInstance(plainNexusCard, {
      instanceId: "nex-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 0,
    });
    const attacker = createCardInstance(card, {
      instanceId: "kongara-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [attacker, grandwalkerInst, guidedInst, plainNexusInst],
    };
    expect(
      matchesCardFilter(grandwalkerInst, grandwalkerCard, filter, { state })
    ).toBe(true);
    expect(matchesCardFilter(guidedInst, guidedCard, filter, { state })).toBe(
      true
    );
    // 通常ネクサス (grandwalkerData なし、tribe 不一致) は候補外。
    expect(
      matchesCardFilter(plainNexusInst, plainNexusCard, filter, { state })
    ).toBe(false);

    // 実行検証: 創界神を対象に取って全コアがボイドへ。
    const resultGw = executeEffect({
      chainId: "test:bsth001-cards:1939",
      state,
      effect: stripEffect,
      sourceInstanceId: "kongara-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["gw-1"],
    });
    expect(
      resultGw.cardInstances.find((c) => c.instanceId === "gw-1")!
        .normalCoreCount
    ).toBe(0);
    expect(
      resultGw.players.find((p) => p.id === "bob")!.voidNormalCoreCount
    ).toBe(3);

    // 実行検証: 導界者を対象に取っても同じ動作 (rule 07:55)。
    const resultGd = executeEffect({
      chainId: "test:bsth001-cards:1957",
      state,
      effect: stripEffect,
      sourceInstanceId: "kongara-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["gd-1"],
    });
    expect(
      resultGd.cardInstances.find((c) => c.instanceId === "gd-1")!
        .normalCoreCount
    ).toBe(0);
    expect(
      resultGd.players.find((p) => p.id === "bob")!.voidNormalCoreCount
    ).toBe(2);
  });

  it("[board] バトル終了回復の分離 carrier は実際のバトル終了で疲労した自身を回復する", () => {
    const recoverIndex = card.effects!.findIndex(
      (effect) =>
        effect.timing.kind === "card_event" &&
        effect.timing.event === "attack" &&
        effect.timing.deferredTo === "battle_end" &&
        effect.steps[0]?.action.kind === "recover"
    );
    expect(recoverIndex).toBeGreaterThanOrEqual(0);
    const attackId = "kongara-battle-end";
    const entityId = "battle-entity:kongara";
    const instanceId = "kongara-battle-end-recover";
    const recoverRegistrations = buildBattleImmediateEffectLookup([card])(
      card.cardNo
    )!.filter((registration) => registration.effectIndex === recoverIndex);
    const recoverLookup = (cardNo: string) =>
      cardNo === card.cardNo ? recoverRegistrations : undefined;
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      cardInstances: [
        createCardInstance(card, {
          instanceId,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
        }),
      ],
      activeAttack: {
        attackId,
        primaryEntityId: entityId,
        participantEntityIds: [entityId],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          { participantEntityId: entityId, blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: [entityId],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      } satisfies ActiveAttack,
      battleEntities: [
        {
          entityId,
          memberInstanceIds: [instanceId],
          resolvedBp: 7000,
          resolvedSymbols: [],
          attackState: "attacking",
        },
      ],
    };
    const battleOptions = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      getRegisteredBattleImmediateEffectActions: recoverLookup,
      getRegisteredFieldCardEffectActions: () => [],
    };
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId,
      participantEntityId: entityId,
      actingPlayerId: "alice",
      sourceCard: state.cardInstances[0]!,
      sourceDefinition: card,
      timing: "attack",
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: recoverLookup,
    });
    const resolve = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...battleOptions,
    }).find(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceInstanceId === instanceId &&
        action.skipOnly !== true &&
        action.promptId.endsWith(":0")
    );
    expect(resolve).toBeDefined();
    const declared = applyLegalAction({
      state: queued,
      action: resolve!,
      ...battleOptions,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      ...battleOptions,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const deferred = applyLegalAction({
      state: declared,
      action: pass!,
      ...battleOptions,
    }).state;
    expect(deferred.pendingBattleEndDeferrals).toEqual([
      expect.objectContaining({
        attackId,
        sourceInstanceId: instanceId,
        effectIndex: recoverIndex,
      }),
    ]);
    const after = executeBattleResolution({
      state: deferred,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    }).state;
    expect(
      after.cardInstances.find(
        (instance) => instance.instanceId === instanceId
      )!.exhaustState
    ).toBe("recovered");
  });
});

describe("BSTH001-転醒R01(A) 陰陽玉 (創界石)", () => {
  const card = cardNoMap.get("BSTH001-転醒R01(A)")!;
  it("grandstoneData(解封: 博麗/靈異の召喚/アタック, 転醒: コア3・カウント3・全コアボイド・合体) + treat_as紫 + 神秘軽減シンボル補助 / 両面", () => {
    expect(card.isDoubleSided).toBe(true);
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
    const gs = card.grandstoneData!;
    expect(gs).toBeDefined();
    expect(gs.unsealConditions).toHaveLength(2);
    expect(gs.unsealConditions[0]!.events).toEqual(["summon", "attack"]);
    expect(gs.unsealConditions[0]!.cardFilter?.nameContains).toEqual(["博麗"]);
    expect(gs.unsealConditions[1]!.cardFilter?.tribes).toEqual(["靈異"]);
    expect(gs.rebirthCoreThreshold).toBe(3);
    expect(gs.rebirthMaxCount).toBe(3);
    expect(gs.rebirthRetainCores).toBe(0);
    expect(gs.postRebirth).toBe("combine_with_own_spirit");
    const treat = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as" && e.textRef?.[0] === 5
    )!;
    const t = treat.steps[0]!.action;
    if (t.kind === "treat_as") {
      expect(t.asColor).toBe("purple");
      expect(t.aspects).toEqual(["reduction_symbol"]);
    }
    // 【神秘】博麗/靈異/賢者カードの召喚/配置/使用時に軽減シンボル2つを満たす
    // (BSTH09.2-転醒R03(A) 先例と同型、count:2 で「2つ」を表現)。
    const mystery = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as" && e.textRef?.[0] === 10
    )!;
    expect(mystery.stub).toBeUndefined();
    // 「この効果は重複しない」= usageLimit no_duplicate (BSTH07-X01 symbol_add 先例と同型)。
    expect(mystery.usageLimit).toEqual({ kind: "no_duplicate" });
    const mysteryAction = mystery.steps[0]!.action;
    expect(mysteryAction.kind).toBe("treat_as");
    if (mysteryAction.kind === "treat_as") {
      expect(mysteryAction.aspects).toEqual(["reduction_symbol"]);
      expect(mysteryAction.whenPayingForFilter).toEqual({
        tribes: ["博麗", "靈異", "賢者"],
      });
      expect(mysteryAction.waivesReductionRequirement).toBe(true);
      expect(mysteryAction.count).toBe(2);
    }
    expect(card.effects!.filter((e) => e.stub).length).toBe(0);
  });

  it("[board] 博麗/靈異/賢者カードの召喚コストが軽減シンボル2つ分自動で満たされる", () => {
    const nexus = card;
    const hakureiSpirit: CardDefinition = {
      cardNo: "TEST-HAKUREI-SPIRIT",
      name: "博麗テストスピリット",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red", "purple"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "博麗",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const unrelatedSpirit: CardDefinition = {
      ...hakureiSpirit,
      cardNo: "TEST-UNRELATED-SPIRIT",
      tribe: "無関係",
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(nexus, {
          instanceId: "onmyoudama-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
    };
    const withHakurei = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: hakureiSpirit,
      getCardDefinitionById: (id) => getCardDefinitionById(id) ?? hakureiSpirit,
    });
    expect(withHakurei.totalReduction).toBe(2);
    expect(withHakurei.reducedCost).toBe(1);

    const withUnrelated = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: unrelatedSpirit,
      getCardDefinitionById: (id) =>
        getCardDefinitionById(id) ?? unrelatedSpirit,
    });
    expect(withUnrelated.totalReduction).toBe(0);
    expect(withUnrelated.reducedCost).toBe(3);
  });

  it("[board] この効果は重複しない: 同名カードが2枚フィールドにいても軽減シンボル2つ分のまま (加算されない)", () => {
    const nexus = card;
    const hakureiSpirit: CardDefinition = {
      cardNo: "TEST-HAKUREI-SPIRIT-2",
      name: "博麗テストスピリット2",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 4,
      reductionSymbols: ["red", "purple", "purple"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "博麗",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(nexus, {
          instanceId: "onmyoudama-2a",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 0,
        }),
        createCardInstance(nexus, {
          instanceId: "onmyoudama-2b",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
    };
    const result = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: hakureiSpirit,
      getCardDefinitionById: (id) => getCardDefinitionById(id) ?? hakureiSpirit,
    });
    // 2枚いても waiver は 1 枚分 (2) のまま。dedup が無ければ 4 になってしまう。
    expect(result.totalReduction).toBe(2);
    expect(result.reducedCost).toBe(2);
  });
});

describe("BSTH001-転醒R02(A) ユウゲンマガン", () => {
  const card = cardNoMap.get("BSTH001-転醒R02(A)")!;
  it("召喚時stub + コア除去+1stub + rebirth(3)", () => {
    expect(card.isDoubleSided).toBe(true);
    const rebirth = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "rebirth"
    )!;
    if (rebirth.steps[0]?.action.kind === "rebirth") {
      expect(rebirth.steps[0].action.maxCount).toBe(3);
    }
  });
});

describe("BSTH001-転醒R03(A) エリス（蝙蝠形態）", () => {
  const card = cardNoMap.get("BSTH001-転醒R03(A)")!;

  it("[board] 召喚時、デッキの上から2枚ドローできる", () => {
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(card, {
            instanceId: "elis-r03a",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(cardNoMap.get("BSTH001-C01")!, {
            instanceId: "deck-top-1",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "deck",
          }),
          createCardInstance(cardNoMap.get("BSTH001-C01")!, {
            instanceId: "deck-top-2",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "deck",
          }),
        ],
      }),
      activePlayerId: "alice",
    };
    const summonEffect = card.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "summon"
    )!;
    expect(summonEffect.executionMode).toBe("optional");
    const after = executeEffect({
      chainId: "test:bsth001-cards:2296",
      state,
      effect: summonEffect,
      sourceInstanceId: "elis-r03a",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const hand = after.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
    );
    expect(hand).toHaveLength(2);
    expect(hand.map((c) => c.instanceId).sort()).toEqual([
      "deck-top-1",
      "deck-top-2",
    ]);
  });

  it("Lv2-Lv3『アタック時』相手1体のコア2個までをリザーブに置く（単一対象+amount範囲）", () => {
    const attackCoreMove = card.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        e.timing.event === "attack" &&
        e.steps[0]?.action.kind === "core_move"
    )!;
    expect(attackCoreMove.condition).toEqual([{ kind: "min_level", value: 2 }]);
    const action = attackCoreMove.steps[0]!.action;
    if (action.kind !== "core_move") throw new Error("expected core_move");
    expect(action.target).toMatchObject({
      kind: "filter",
      player: "opponent",
      filter: { category: ["spirit", "ultimate"] },
      count: 1,
    });
    expect(action.from).toEqual({ kind: "target_card" });
    expect(action.to).toEqual({ kind: "reserve", player: "opponent" });
    expect(action.amount).toEqual({ min: 0, max: 2 });
  });

  it("Lv2-Lv3 転醒: カウント3以下・自分のアタック/相手起因の離脱どちらでも裏返せる", () => {
    const rebirthEffects = card.effects!.filter(
      (e) => e.steps[0]?.action.kind === "rebirth"
    );
    expect(rebirthEffects).toHaveLength(2);
    for (const e of rebirthEffects) {
      expect(e.executionMode).toBe("optional");
      expect(e.condition).toEqual([{ kind: "min_level", value: 2 }]);
      const action = e.steps[0]!.action;
      if (action.kind !== "rebirth") throw new Error("expected rebirth");
      expect(action.maxCount).toBe(3);
    }
    const attackTrigger = rebirthEffects.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "attack"
    );
    const leaveFieldTrigger = rebirthEffects.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "leave_field"
    );
    expect(attackTrigger).toBeDefined();
    expect(leaveFieldTrigger).toBeDefined();
    if (leaveFieldTrigger?.timing.kind === "card_event") {
      expect(leaveFieldTrigger.timing.cause).toEqual([
        "opponent_effect",
        "battle",
      ]);
    }
  });
});
