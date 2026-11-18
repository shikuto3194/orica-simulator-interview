/**
 * BSLH01-C01 双魚珠 / BSLH01-R06 回避3 クォーツ set-effect 回帰テスト。
 *
 * 「ターンに1回、自分の系統：「CB」を持つスピリットが相手の効果の対象になるとき、
 * 自分のデッキを上から1枚オープンできる。それがスピリットカードのとき、その効果を
 * 受けない。」型は targeted 反応内で deck_reveal → 条件付き effect_immunity
 * (duration:current_effect) の2ステップになる。従来は deck_reveal が生成する
 * pendingDeckReveal の一時停止/再開を挟むと `state.pendingTargetedDisclosureContinuation`
 * が失われ、後続 effect_immunity が no-op になっていた (needs-dsl.audit BSLH01-C01/
 * BSLH01-R06)。ZoneSelectionContinuation.targetedDisclosureContinuation を新設し、
 * pending 生成時に捕捉・再開直前に復元することで解消した (effect-interpreter.ts /
 * pending-action-handlers.ts)。本テストはその末端結果 (immunity 発動で destroy が
 * 阻止される) を実プレイの stack 経路で確認する。
 */
import { expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { setQuartz } from "../src/mechanics/quartz-system";
import type { CardDefinition, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "テスト",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

const hostDef = makeDef({
  cardNo: "DISC-HOST",
  name: "ENIGMA[戦術オーブメント]",
  printedCategory: "brave",
  quartzHostData: {
    slots: { left: 3, center: 1, right: 3 },
    inheritsSetQuartzEffects: true,
  },
});
const cbSpiritDef = makeDef({
  cardNo: "DISC-CB-SPIRIT",
  name: "CB スピリットテスト",
  tribe: "CB",
});
const spiritRevealDef = makeDef({
  cardNo: "DISC-REVEAL-SPIRIT",
  name: "オープン用スピリットテスト",
});
// negative-branch 用: デッキトップが非スピリットのとき effect_immunity が登録されず
// destroy がそのまま通ることを確認する (adversarial verifier round1 refute 対応)。
const nonSpiritRevealDef = makeDef({
  cardNo: "DISC-REVEAL-NONSPIRIT",
  name: "オープン用非スピリットテスト",
  printedCategory: "magic",
  cost: 0,
  levelDefs: [],
});

function destroyEffectDef(
  cardNo: string,
  printedCategory: "magic" | "spirit"
): CardDefinition {
  return makeDef({
    cardNo,
    name: "TEST 対象化カード",
    printedCategory,
    colors: ["purple"],
    cost: 0,
    levelDefs:
      printedCategory === "spirit"
        ? [{ level: 1, requiredCores: 1, bp: 3000 }]
        : [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "destroy",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { cardName: { exact: "CB スピリットテスト" } },
                count: 1,
              },
            },
          },
        ],
      },
    ],
  });
}

// C01 の triggerSourceFilter は相手のマジック/アルティメット、R06 は相手のスピリット/
// ネクサス限定のため、反応元カードのカテゴリを各カードの原文条件に合わせて変える。
const SOURCE_CATEGORY: Record<string, "magic" | "spirit"> = {
  "BSLH01-C01": "magic",
  "BSLH01-R06": "spirit",
};

for (const [cardNo, setEffectIndexHint] of [
  ["BSLH01-C01", undefined],
  ["BSLH01-R06", undefined],
] as const) {
  const quartzDef = ALL_CARDS.find((c) => c.cardNo === cardNo);
  if (!quartzDef) throw new Error(`${cardNo} not found in ALL_CARDS`);
  const setEffect = quartzDef.effects!.find(
    (effect) =>
      effect.timing.kind === "game_event" &&
      (effect.timing as { event?: unknown }).event === "targeted"
  );
  if (!setEffect) throw new Error(`${cardNo}: targeted set-effect not found`);
  void setEffectIndexHint;

  const magicDef = destroyEffectDef(
    `${cardNo}-MAGIC`,
    SOURCE_CATEGORY[cardNo]!
  );
  const defs: Record<string, CardDefinition> = {
    "DISC-HOST": hostDef,
    "DISC-CB-SPIRIT": cbSpiritDef,
    "DISC-REVEAL-SPIRIT": spiritRevealDef,
    "DISC-REVEAL-NONSPIRIT": nonSpiritRevealDef,
    [cardNo]: quartzDef,
    [magicDef.cardNo]: magicDef,
  };
  const getD = (id: string): CardDefinition | undefined => defs[id];
  const lookup = buildTriggeredEffectLookup([quartzDef]);

  function base(deckTopDef: CardDefinition = spiritRevealDef): GameState {
    const b = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const host = createCardInstance(hostDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "disc-host",
      normalCoreCount: 1,
    });
    const quartzCard = createCardInstance(quartzDef, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "disc-quartz",
    });
    const cbSpirit = createCardInstance(cbSpiritDef, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "disc-cb-spirit",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: SOURCE_CATEGORY[cardNo] === "spirit" ? "field" : "in_use",
      instanceId: "disc-magic",
      normalCoreCount: SOURCE_CATEGORY[cardNo] === "spirit" ? 1 : 0,
    });
    const deckTop = createCardInstance(deckTopDef, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
      instanceId: "disc-deck-top",
    });
    let s: GameState = {
      ...b,
      cardInstances: [host, quartzCard, cbSpirit, magic, deckTop],
      players: b.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["disc-host"] } : p
      ),
    };
    s = setQuartz(
      s,
      {
        quartzInstanceId: "disc-quartz",
        hostInstanceId: "disc-host",
        ownerPlayerId: ALICE,
        slot: "left",
      },
      getD
    )!;
    return s;
  }

  it(`${cardNo}: 反応内 deck_reveal 一時停止を跨いでもスピリットカードなら効果を受けない (disclosure continuation 修正の回帰)`, () => {
    const state = base();

    const disclosure = executeEffect({
      chainId: "test:bslh01-c01-r06-quartz-targeted-disclosure:203",
      state,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "disc-magic",
      actingPlayerId: BOB,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
      targetInstanceIds: ["disc-cb-spirit"],
      targetStepId: "destroy",
      effectActionKind: "magic",
    });
    expect(disclosure.pendingTargetedDisclosureContinuation).toMatchObject({
      sourceDefinitionId: magicDef.cardNo,
      sourceInstanceId: "disc-magic",
      targetInstanceIds: ["disc-cb-spirit"],
    });
    expect(
      disclosure.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "targeted" && p.relatedInstanceId === "disc-cb-spirit"
      )
    ).toBe(true);

    const resolveProtection = getLegalActions({
      state: disclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        (action.sourceEffectInstanceId ?? action.sourceInstanceId) ===
          "disc-quartz"
    );
    expect(resolveProtection).toBeDefined();
    const afterDeclare = applyLegalAction({
      state: disclosure,
      action: resolveProtection!,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
    }).state;

    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: BOB,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: afterDeclare,
      action: pass!,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
    }).state;

    // deck_reveal ステップが pending を生成し、disclosure continuation を保持している
    // ことを直接確認する (捕捉側の修正、effect-interpreter.ts)。
    if (cardNo === "BSLH01-R06")
      expect(afterPass.pendingDeckReveal).not.toBeNull();
    if (afterPass.pendingDeckReveal)
      expect(
        afterPass.pendingDeckReveal.continuation?.targetedDisclosureContinuation
      ).toMatchObject({
        sourceDefinitionId: magicDef.cardNo,
        targetInstanceIds: ["disc-cb-spirit"],
      });

    const pendingKind = (afterPass.pendingDeckReveal?.picks.length ?? 0) > 0;
    let resolved: GameState;
    if (!afterPass.pendingDeckReveal) {
      resolved = afterPass;
    } else if (pendingKind) {
      const pickAction = getLegalActions({
        state: afterPass,
        actingPlayerId: ALICE,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: () => [],
        getRegisteredFieldCardEffectActions: () => [],
      }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
      expect(pickAction).toBeDefined();
      resolved = applyLegalAction({
        state: afterPass,
        action: pickAction!,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: () => [],
        selectedDeckRevealCardIds: ["disc-deck-top"],
      }).state;
    } else {
      const orderAction = getLegalActions({
        state: afterPass,
        actingPlayerId: ALICE,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: () => [],
        getRegisteredFieldCardEffectActions: () => [],
      }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
      expect(orderAction).toBeDefined();
      resolved = applyLegalAction({
        state: afterPass,
        action: orderAction!,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: () => [],
        deckRevealRemainderOrder: ["disc-deck-top"],
      }).state;
    }

    // 復元側の修正 (pending-action-handlers.ts): resume 直前に
    // pendingTargetedDisclosureContinuation を復元するため、後続 effect_immunity が
    // no-targeted-disclosure-continuation で no-op せず正しく登録される。
    expect(resolved.pendingDeckReveal).toBeNull();
    expect(
      resolved.log.some(
        (entry) =>
          entry ===
          `effect:effect_immunity:registered:disc-cb-spirit:current_effect`
      )
    ).toBe(true);
    expect(resolved.log).not.toContain("no-targeted-disclosure-continuation");

    // 元効果 (destroy) は阻止され、CB スピリットはフィールドに残る。
    const cbSpiritAfter = resolved.cardInstances.find(
      (ci) => ci.instanceId === "disc-cb-spirit"
    );
    expect(cbSpiritAfter?.zone).toBe("field");
    expect(cbSpiritAfter?.pendingLeaveKind).toBeNull();
  });

  // negative branch (adversarial verifier round1 refute 対応): デッキトップが
  // 非スピリットのとき stepCondition (ref_has_match) が false になり effect_immunity は
  // 登録されず、元効果 (destroy) がそのまま通ることを確認する。
  it(`${cardNo}: オープンしたカードが非スピリットなら effect_immunity は登録されず destroy が通る`, () => {
    const state = base(nonSpiritRevealDef);

    const disclosure = executeEffect({
      chainId: "test:bslh01-c01-r06-quartz-targeted-disclosure:348",
      state,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "disc-magic",
      actingPlayerId: BOB,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
      targetInstanceIds: ["disc-cb-spirit"],
      targetStepId: "destroy",
      effectActionKind: "magic",
    });

    const resolveProtection = getLegalActions({
      state: disclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        (action.sourceEffectInstanceId ?? action.sourceInstanceId) ===
          "disc-quartz"
    );
    expect(resolveProtection).toBeDefined();
    const afterDeclare = applyLegalAction({
      state: disclosure,
      action: resolveProtection!,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
    }).state;

    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: BOB,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: afterDeclare,
      action: pass!,
      getCardDefinitionById: getD,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
    }).state;

    if (cardNo === "BSLH01-R06")
      expect(afterPass.pendingDeckReveal).not.toBeNull();
    const pendingKind = (afterPass.pendingDeckReveal?.picks.length ?? 0) > 0;
    let resolved: GameState;
    if (!afterPass.pendingDeckReveal) {
      resolved = afterPass;
    } else if (pendingKind) {
      const pickAction = getLegalActions({
        state: afterPass,
        actingPlayerId: ALICE,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: () => [],
        getRegisteredFieldCardEffectActions: () => [],
      }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
      expect(pickAction).toBeDefined();
      resolved = applyLegalAction({
        state: afterPass,
        action: pickAction!,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: () => [],
        selectedDeckRevealCardIds: ["disc-deck-top"],
      }).state;
    } else {
      const orderAction = getLegalActions({
        state: afterPass,
        actingPlayerId: ALICE,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: () => [],
        getRegisteredFieldCardEffectActions: () => [],
      }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
      expect(orderAction).toBeDefined();
      resolved = applyLegalAction({
        state: afterPass,
        action: orderAction!,
        getCardDefinitionById: getD,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredBurstActions: () => [],
        deckRevealRemainderOrder: ["disc-deck-top"],
      }).state;
    }

    expect(resolved.pendingDeckReveal).toBeNull();
    // 非スピリットの reveal では stepCondition (ref_has_match) が false になり
    // effect_immunity ステップ自体が登録されない。
    expect(
      resolved.log.some(
        (entry) =>
          entry ===
          `effect:effect_immunity:registered:disc-cb-spirit:current_effect`
      )
    ).toBe(false);

    // 元効果 (destroy) は阻止されず、CB スピリットはフィールドから離れる。
    expect(resolved.pendingTargetedDisclosureContinuation).toBeNull();
    const cbSpiritAfter = resolved.cardInstances.find(
      (ci) => ci.instanceId === "disc-cb-spirit"
    );
    expect(cbSpiritAfter?.zone).not.toBe("field");
  });

  // qa-030 (07_custom-orica-mechanics.md §4): 【セット中】表記の無いクォーツ効果は
  // 「セット中のカードの【クォーツ】すべてを得て発揮する」を持つ host 経由でのみ発揮する。
  // これは全 host 共通則ではなく host 固有の印字能力 (quartzHostData.inheritsSetQuartzEffects)
  // であるため、その能力を持たない host にセットした場合はクォーツカード自身が魂状態として
  // 扱われて（soulStateInstanceIds に入って）いても、この効果は発揮されない
  // (ENGINE-quartz-host-identity-propagation、adversarial verifier round1 lens2 指摘の
  // 「host opt-in が無いと silent に無反応」という挙動自体が仕様通りであることを固定する)。
  it(`${cardNo}: 【クォーツ】継承発揮能力(inheritsSetQuartzEffects)を持たない host にセットした場合、原文に【セット中】表記が無いためこの効果は発揮候補にすら立たない (qa-030)`, () => {
    const nonCapableHostDef = makeDef({
      cardNo: "DISC-HOST-NO-INHERIT",
      name: "テスト非対応host",
      printedCategory: "brave",
      quartzHostData: { slots: { left: 3, center: 1, right: 3 } },
    });
    const host = createCardInstance(nonCapableHostDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      instanceId: "disc-host-no-inherit",
      normalCoreCount: 1,
    });
    const quartzCard = createCardInstance(quartzDef, {
      ownerPlayerId: ALICE,
      zone: "hand",
      instanceId: "disc-quartz",
    });
    const cbSpirit = createCardInstance(cbSpiritDef, {
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      instanceId: "disc-cb-spirit",
      normalCoreCount: 1,
    });
    const magic = createCardInstance(magicDef, {
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: SOURCE_CATEGORY[cardNo] === "spirit" ? "field" : "in_use",
      instanceId: "disc-magic",
      normalCoreCount: SOURCE_CATEGORY[cardNo] === "spirit" ? 1 : 0,
    });
    const noInheritDefs: Record<string, CardDefinition> = {
      ...defs,
      "DISC-HOST-NO-INHERIT": nonCapableHostDef,
    };
    const getDNoInherit = (id: string): CardDefinition | undefined =>
      noInheritDefs[id];
    const emptyState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    let state: GameState = {
      ...emptyState,
      cardInstances: [host, quartzCard, cbSpirit, magic],
      players: emptyState.players.map((p) =>
        p.id === ALICE
          ? { ...p, soulStateInstanceIds: ["disc-host-no-inherit"] }
          : p
      ),
    };
    state = setQuartz(
      state,
      {
        quartzInstanceId: "disc-quartz",
        hostInstanceId: "disc-host-no-inherit",
        ownerPlayerId: ALICE,
        slot: "left",
      },
      getDNoInherit
    )!;
    expect(state).not.toBeNull();
    // setQuartz は quartz card 自身を soulStateInstanceIds へ入れる（セット中＝魂状態は
    // host 共通則で成立している）。それでも quartz_inherited 経路は host の
    // inheritsSetQuartzEffects が無いため候補を立てない。
    expect(
      state.players.find((p) => p.id === ALICE)!.soulStateInstanceIds
    ).toContain("disc-quartz");

    const disclosure = executeEffect({
      chainId: "test:bslh01-c01-r06-quartz-targeted-disclosure:537",
      state,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "disc-magic",
      actingPlayerId: BOB,
      getCardDefinitionById: getDNoInherit,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
      targetInstanceIds: ["disc-cb-spirit"],
      targetStepId: "destroy",
      effectActionKind: "magic",
    });

    const resolveProtection = getLegalActions({
      state: disclosure,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDNoInherit,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        (action.sourceEffectInstanceId ?? action.sourceInstanceId) ===
          "disc-quartz"
    );
    expect(resolveProtection).toBeUndefined();
  });
}
