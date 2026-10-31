/**
 * BSAZ02-M03「情報分断」effects[0,1] 検証。
 *
 * 原文 (textLines[0]):
 *   ［ゲームに1回：同名］トラッシュにあるこのカードは、系統：「火星」を持つネクサスが
 *   配置されたとき、手札に戻せる。
 * 原文 (textLines[2,3]):
 *   スタック
 *   ［ゲームに2回：同名］系統：「火星」を持つ自分のネクサスがあるとき、このターンの間、
 *   相手のデッキ/トラッシュは、【神託】/【導託】以外の相手のスピリット/ネクサスの効果を受けない。
 *
 * 検証点:
 *  - BSAZ02-M04 effects[0]（自分の火星ネクサスがフィールドを離れたとき）と同型の
 *    トラッシュ常駐第三者観測だが、本カードは「自分の」限定が無いため player:"either" で
 *    自分/相手いずれの火星ネクサス配置でも誘発候補に入ることを確認する。
 *  - usageLimit は〔ターンに1回〕ではなく［ゲームに1回］= duration:"game"。
 *  - 実行系: move_card でトラッシュのこのカードが手札に戻ることを検証する。
 *
 * effects[1]:
 *  - condition: field_has(player:self, category:nexus, tribes:火星)、
 *    usageLimit: per_card_name/game/maxCount:2、timing: activated mode:"stack"。
 *  - effect_immunity(target.zone:["deck","trash"], player:"opponent", count:"all",
 *    duration:{scope:"turn"}, sourcePlayerScope:"self",
 *    sourceScope:{categories:[spirit,nexus], excludedAspects:[oracle]}) が
 *    登録する CE が、相手のデッキ/トラッシュカードに対する相手自身の spirit/nexus 効果を
 *    ブロックすることを isCardImmuneToOpponentEffect で確認する。
 *  - 発生源が創界神/導界者ネクサス (grandwalkerData 保持、BSAZ02-X04) のときは
 *    通常効果は免疫対象。神託/導託という処理だけが例外であることを確認する。
 *  - 発生源がマジックのときは categories:[spirit,nexus] に一致しないため免疫が成立しない
 *    (=「相手のスピリット/ネクサスの効果」限定であることの確認)。
 */
import { describe, expect, it } from "vitest";
import { resolvePlacementOracleMechanic } from "../src/mechanics/oracle-system";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { advanceStep, applyLegalAction, getLegalActions } from "../src";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import type { CardDefinition, GameState, LegalAction } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const M03 = card("BSAZ02-M03");

const ALICE = "player-1";
const BOB = "player-2";

function marsNexusDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テスト火星ネクサス ${cardNo}`,
    printedCategory: "nexus",
    colors: ["white"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "火星",
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

const NEXUS1 = marsNexusDef("TEST-MARS-NEXUS-M03-1");

const testDefRegistry = new Map<string, CardDefinition>([
  [M03.cardNo, M03],
  [NEXUS1.cardNo, NEXUS1],
]);
const getDef = (id: string): CardDefinition | undefined =>
  testDefRegistry.get(id) ?? cardNoMap.get(id);

describe("BSAZ02-M03 draw affect gate", () => {
  const nexus = card("BSTH09-TR01(A)");
  const hell = card("BSTH001-C04");
  const lookups = {
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
      nexus,
      hell,
    ]),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
      M03,
      nexus,
      hell,
    ]),
  };

  function setup(protectedDeck = true): GameState {
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ handCount: 0 }, { handCount: 0, deckCount: 3 }],
        cardInstances: [
          createCardInstance(M03, {
            instanceId: "m03",
            ownerPlayerId: ALICE,
            zone: "in_use",
          }),
          createCardInstance(NEXUS1, {
            instanceId: "mars",
            ownerPlayerId: ALICE,
            zone: "field",
          }),
          createCardInstance(nexus, {
            instanceId: "draw-source",
            ownerPlayerId: BOB,
            zone: "field",
          }),
          ...Array.from({ length: 3 }, (_, i) =>
            createCardInstance(card("BSAZ02-C01"), {
              instanceId: `deck-${i}`,
              ownerPlayerId: BOB,
              zone: "deck",
            })
          ),
        ],
      }),
      activePlayerId: BOB,
      step: "main",
      turnNumber: 4,
    };
    return protectedDeck
      ? executeEffect({
          state,
          effect: M03.effects![1]!,
          effectIndex: 1,
          sourceInstanceId: "m03",
          actingPlayerId: ALICE,
          chainId: "test:m03:draw-protection",
          getCardDefinitionById: getDef,
        })
      : state;
  }

  function apply(
    state: GameState,
    playerId: string,
    predicate: (a: LegalAction) => boolean
  ): GameState {
    const action = getLegalActions({
      state,
      actingPlayerId: playerId,
      ...lookups,
    }).find(predicate);
    expect(action).toBeDefined();
    return applyLegalAction({ state, action: action!, ...lookups }).state;
  }

  function drawFromNexus(state: GameState): GameState {
    expect(
      lookups.getRegisteredFieldCardEffectActions(nexus.cardNo)?.[0]
        ?.effectIndex
    ).toBe(2);
    state = apply(
      state,
      BOB,
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "draw-source"
    );
    expect(state.stackWindow).not.toBeNull();
    state = apply(
      state,
      state.stackWindow!.priorityPlayerId,
      (a) => a.kind === "pass_stack"
    );
    expect(state.stackWindow).toBeNull();
    return state;
  }

  it("M03発揮後の柱斧effect[2]はlegal-action/apply/execute完了でも移動・手札増加・drawイベントなし", () => {
    const before = setup();
    const after = drawFromNexus(before);
    expect(after.players.find((p) => p.id === BOB)).toMatchObject({
      deckCount: 3,
      handCount: 0,
    });
    expect(
      after.cardInstances
        .filter((c) => c.ownerPlayerId === BOB && c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["deck-0", "deck-1", "deck-2"]);
    expect(after.pendingDrawEvents ?? []).toEqual([]);
    expect(after.log).not.toContain(`effect:draw:${BOB}:1`);
    expect(
      after.publicDisclosures
        .flatMap((d) => d.results)
        .filter((r) => r.kind === "hand_delta" && r.actionLabel === "draw")
    ).toEqual([]);
  });

  it("対照: M03なしの柱斧effect[2]は同じ合法経路で1枚ドローする", () => {
    const after = drawFromNexus(setup(false));
    expect(after.players.find((p) => p.id === BOB)).toMatchObject({
      deckCount: 2,
      handCount: 1,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-0")?.zone
    ).toBe("hand");
    expect(after.log).toContain(`effect:draw:${BOB}:1`);
  });

  it("M03発揮中も通常draw stepは1枚ドローする", () => {
    const state = { ...setup(), step: "core" as const };
    const after = advanceStep(
      state,
      getDef,
      () => [],
      () => []
    );
    expect(after.step).toBe("draw");
    expect(after.players.find((p) => p.id === BOB)).toMatchObject({
      deckCount: 2,
      handCount: 1,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-0")?.zone
    ).toBe("hand");
  });

  function hellState(protectedDeck: boolean): GameState {
    const state = setup(protectedDeck);
    return {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "draw-source"
          ? createCardInstance(hell, {
              instanceId: "draw-source",
              ownerPlayerId: BOB,
              zone: "field",
            })
          : c
      ),
    };
  }

  const hellActions = (state: GameState) =>
    getLegalActions({ state, actingPlayerId: BOB, ...lookups }).filter(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "draw-source"
    );

  it("M03でdraw不能な地獄のことで構文は宣言前に除外し、疲労・usageを消費しない", () => {
    const state = hellState(true);
    expect(hellActions(state)).toEqual([]);
    expect(hellActions(state)).toEqual([]);
    expect(
      state.cardInstances.find((c) => c.instanceId === "draw-source")
        ?.exhaustState
    ).toBe("recovered");
    expect(state.players.find((p) => p.id === BOB)).toMatchObject({
      deckCount: 3,
      handCount: 0,
    });
    expect(state.effectUsageRecords).toEqual([]);
  });

  for (const { name, boundIndex, timing, expectedCount } of [
    {
      name: "地獄の宣言前previewはindex=1/timing=flashの束縛を保持する",
      boundIndex: 1,
      timing: "flash",
      expectedCount: 0,
    },
    {
      name: "地獄の宣言前previewはindex=2/timing=flashの束縛を保持する",
      boundIndex: 2,
      timing: "flash",
      expectedCount: 1,
    },
    {
      name: "地獄の宣言前previewはindex=1/timing=mainの束縛を保持する",
      boundIndex: 1,
      timing: "main",
      expectedCount: 1,
    },
  ] as const) {
    it(name, () => {
      const state = hellState(true);
      state.activeContinuousEffects = state.activeContinuousEffects.map((ce) =>
        ce.sourceInstanceId === "m03"
          ? {
              ...ce,
              duration: { scope: "current_effect" },
              immunitySourceScope: {
                categories: ["spirit"],
                activatedTimings: [timing],
              },
              metadata: {
                currentEffectSourceInstanceId: "draw-source",
                currentEffectSourceDefinitionId: hell.cardNo,
                currentEffectIndex: boundIndex,
                currentEffectTargetStepId: "__step_1",
              },
            }
          : ce
      );
      expect(hellActions(state)).toHaveLength(expectedCount);
      expect(
        state.cardInstances.find((c) => c.instanceId === "draw-source")
          ?.exhaustState
      ).toBe("recovered");
      expect(state.players.find((p) => p.id === BOB)).toMatchObject({
        deckCount: 3,
        handCount: 0,
      });
    });
  }

  it("対照: M03なしの地獄は合法宣言と窓後解決で疲労・draw・usageを確定し再宣言不可", () => {
    let state = hellState(false);
    expect(hellActions(state)).toHaveLength(1);
    state = apply(
      state,
      BOB,
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "draw-source"
    );
    state = apply(
      state,
      state.stackWindow!.priorityPlayerId,
      (a) => a.kind === "pass_stack"
    );
    expect(state.stackWindow).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "draw-source")
        ?.exhaustState
    ).toBe("exhausted");
    expect(state.players.find((p) => p.id === BOB)).toMatchObject({
      deckCount: 2,
      handCount: 1,
    });
    expect(
      state.effectUsageRecords.filter(
        (r) => r.sourceInstanceId === "draw-source"
      )
    ).toHaveLength(1);
    expect(hellActions(state)).toEqual([]);
  });

  it("地獄の合法宣言後にM03耐性を得た場合は正規rollbackし、耐性中の再宣言を除外する", () => {
    let state = hellState(false);
    state = apply(
      state,
      BOB,
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "draw-source"
    );
    expect(state.stackWindow).not.toBeNull();
    state = executeEffect({
      state,
      effect: M03.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "m03",
      actingPlayerId: ALICE,
      chainId: "test:m03:late-immunity",
      getCardDefinitionById: getDef,
    });
    state = apply(
      state,
      state.stackWindow!.priorityPlayerId,
      (a) => a.kind === "pass_stack"
    );
    expect(state.stackWindow).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "draw-source")
        ?.exhaustState
    ).toBe("recovered");
    expect(state.players.find((p) => p.id === BOB)).toMatchObject({
      deckCount: 3,
      handCount: 0,
    });
    expect(
      state.effectUsageRecords.filter(
        (r) => r.sourceInstanceId === "draw-source"
      )
    ).toEqual([]);
    expect(hellActions(state)).toEqual([]);
  });

  it("M03発揮中もマジック由来のdrawは実行される", () => {
    const state = setup();
    const magic = card("BSAZ01-C03");
    state.cardInstances.push(
      createCardInstance(magic, {
        instanceId: "magic-draw",
        ownerPlayerId: BOB,
        zone: "in_use",
      })
    );
    const after = executeEffect({
      state,
      sourceInstanceId: "magic-draw",
      actingPlayerId: BOB,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
      effectIndex: 0,
      chainId: "test:m03:magic-draw",
      getCardDefinitionById: getDef,
    });
    expect(after.players.find((p) => p.id === BOB)).toMatchObject({
      deckCount: 2,
      handCount: 1,
    });
    expect(after.pendingDrawEvents).toEqual([{ playerId: BOB, amount: 1 }]);
  });

  it("通常スピリットのdrawにもM03を適用する", () => {
    const state = setup();
    state.cardInstances.push(
      createCardInstance(card("BSTH01-C04"), {
        instanceId: "spirit-draw",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const after = executeEffect({
      state,
      sourceInstanceId: "spirit-draw",
      actingPlayerId: BOB,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
      effectIndex: 0,
      chainId: "test:m03:spirit-draw",
      getCardDefinitionById: getDef,
    });
    expect(after.players.find((p) => p.id === BOB)).toMatchObject({
      deckCount: 3,
      handCount: 0,
    });
    expect(after.pendingDrawEvents ?? []).toEqual([]);
  });

  for (const { name, effectActivationTiming } of [
    {
      name: "発揮timing=mainをdrawの耐性判定まで保持する",
      effectActivationTiming: "main",
    },
    {
      name: "発揮timing=stackをdrawの耐性判定まで保持する",
      effectActivationTiming: "stack",
    },
  ] as const) {
    it(name, () => {
      const state = setup();
      state.activeContinuousEffects = state.activeContinuousEffects.map((ce) =>
        ce.sourceInstanceId === "m03"
          ? {
              ...ce,
              immunitySourceScope: {
                categories: ["spirit"],
                activatedTimings: ["stack"],
              },
            }
          : ce
      );
      const after = executeEffect({
        state,
        sourceInstanceId: "draw-source",
        actingPlayerId: BOB,
        effect: nexus.effects![2]!,
        effectIndex: 2,
        effectActivationTiming,
        chainId: "test:m03:timing-draw",
        getCardDefinitionById: getDef,
      });
      expect(after.players.find((p) => p.id === BOB)?.handCount).toBe(
        effectActivationTiming === "stack" ? 0 : 1
      );
    });
  }

  for (const { name, boundIndex } of [
    {
      name: "current_effectの発生源index=1をdrawへ渡す",
      boundIndex: 1,
    },
    {
      name: "current_effectの発生源index=2をdrawへ渡す",
      boundIndex: 2,
    },
  ]) {
    it(name, () => {
      const state = setup();
      state.activeContinuousEffects = state.activeContinuousEffects.map((ce) =>
        ce.sourceInstanceId === "m03"
          ? {
              ...ce,
              duration: { scope: "current_effect" },
              metadata: {
                currentEffectSourceInstanceId: "draw-source",
                currentEffectSourceDefinitionId: nexus.cardNo,
                currentEffectIndex: boundIndex,
                currentEffectTargetStepId: "__step_0",
              },
            }
          : ce
      );
      const after = executeEffect({
        state,
        sourceInstanceId: "draw-source",
        actingPlayerId: BOB,
        effect: nexus.effects![2]!,
        effectIndex: 2,
        chainId: "test:m03:bound-draw",
        getCardDefinitionById: getDef,
      });
      expect(after.players.find((p) => p.id === BOB)?.handCount).toBe(
        boundIndex === 2 ? 0 : 1
      );
    });
  }

  it("効果テキスト提供元のinstance/definitionをdrawへ渡す", () => {
    const state = setup();
    const magic = card("BSAZ01-C03");
    state.cardInstances.push(
      createCardInstance(magic, {
        instanceId: "text-provider",
        ownerPlayerId: BOB,
        zone: "field",
        zoneRoleName: "text-role",
      })
    );
    const after = executeEffect({
      state,
      sourceInstanceId: "draw-source",
      actingPlayerId: BOB,
      effect: nexus.effects![2]!,
      effectIndex: 2,
      effectSourceInstanceId: "text-provider",
      effectSourceDefinitionId: magic.cardNo,
      chainId: "test:m03:provider-draw",
      getCardDefinitionById: getDef,
    });
    expect(after.players.find((p) => p.id === BOB)).toMatchObject({
      deckCount: 2,
      handCount: 1,
    });
  });

  for (const { name, mode } of [
    {
      name: "unpreventableをdrawのaffect gateへ伝播する",
      mode: "unpreventable",
    },
    {
      name: "bypassをdrawのaffect gateへ伝播する",
      mode: "bypass",
    },
  ] as const) {
    it(name, () => {
      const after = executeEffect({
        state: setup(),
        sourceInstanceId: "draw-source",
        actingPlayerId: BOB,
        effect: nexus.effects![2]!,
        effectIndex: 2,
        ...(mode === "unpreventable"
          ? { sourcePreventionLevel: "unpreventable" as const }
          : { sourcePreventionBypass: { kind: "all_effects" as const } }),
        chainId: "test:m03:penetrating-draw",
        getCardDefinitionById: getDef,
      });
      expect(after.players.find((p) => p.id === BOB)).toMatchObject({
        deckCount: 2,
        handCount: 1,
      });
      expect(after.pendingDrawEvents).toEqual([{ playerId: BOB, amount: 1 }]);
    });
  }

  for (const { name, position } of [
    {
      name: "top: 指定範囲内の耐性札だけを除外し、範囲外の札を代わりに引かない",
      position: "top",
    },
    {
      name: "bottom: 指定範囲内の耐性札だけを除外し、範囲外の札を代わりに引かない",
      position: "bottom",
    },
  ] as const) {
    it(name, () => {
      const state = setup();
      state.activeContinuousEffects = state.activeContinuousEffects.map((ce) =>
        ce.sourceInstanceId === "m03"
          ? {
              ...ce,
              targetFilter: undefined,
              targetInstanceId: "deck-1",
            }
          : ce
      );
      const after = executeEffect({
        state,
        sourceInstanceId: "draw-source",
        actingPlayerId: BOB,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [{ action: { kind: "draw", count: 2, position } }],
        },
        effectIndex: 2,
        chainId: "test:m03:partial-draw",
        getCardDefinitionById: getDef,
      });
      expect(
        after.cardInstances.find((c) => c.instanceId === "deck-1")?.zone
      ).toBe("deck");
      expect(
        after.cardInstances.find(
          (c) => c.instanceId === (position === "top" ? "deck-0" : "deck-2")
        )?.zone
      ).toBe("hand");
      expect(
        after.cardInstances.find(
          (c) => c.instanceId === (position === "top" ? "deck-2" : "deck-0")
        )?.zone
      ).toBe("deck");
      expect(after.players.find((p) => p.id === BOB)).toMatchObject({
        deckCount: 2,
        handCount: 1,
      });
      expect(after.pendingDrawEvents).toEqual([{ playerId: BOB, amount: 1 }]);
    });
  }
});

describe("BSAZ02-M03 effects[0]: トラッシュ常駐の自己回収 (火星ネクサスが配置されたとき、自分/相手いずれも対象)", () => {
  const effect = M03.effects![0]!;

  it("effect 定義: applicability.zone:trash + game_event(place, player:either, category:nexus, tribes:火星)、［ゲームに1回：同名］", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: ["trash"] });
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "place",
      triggerFilter: { category: ["nexus"], tribes: ["火星"] },
      sourceWhose: "either",
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
  });

  function setup(nexusOwner: string) {
    const trashCard = createCardInstance(M03, {
      instanceId: "m03-trash-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const beforeNexus = createCardInstance(NEXUS1, {
      instanceId: "mars-nexus-1",
      ownerPlayerId: nexusOwner,
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [beforeNexus, trashCard],
    });
    const after: GameState = {
      ...before,
      cardInstances: before.cardInstances.map((c) =>
        c.instanceId === beforeNexus.instanceId
          ? { ...c, zone: "field" as const, zoneRoleName: "nexus" }
          : c
      ),
    };
    const lookup = buildTriggeredEffectLookup([M03, NEXUS1]);
    return {
      before,
      after,
      trashCard,
      afterNexus: after.cardInstances[0]!,
      lookup,
    };
  }

  it("相手の火星ネクサス配置でも誘発候補に含まれる (「自分の」限定が無い＝player:either、BSAZ02-M04の自分限定との対照)", () => {
    const ctx = setup(BOB);
    const chainId = "m03-opponent-place-chain";
    const queued = collectAndQueueTriggerReactions({
      beforeState: ctx.before,
      afterState: ctx.after,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === ctx.afterNexus.instanceId
    );
    expect(pending).toBeDefined();
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.trashCard.instanceId)
    ).toBeDefined();
  });

  it("実行: move_card でトラッシュのこのカードが手札に戻る", () => {
    const ctx = setup(ALICE);
    const result = executeEffect({
      chainId: "test:bsaz02-m03-information-partition:168",
      state: ctx.before,
      effect,
      sourceInstanceId: ctx.trashCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const moved = result.cardInstances.find(
      (c) => c.instanceId === ctx.trashCard.instanceId
    )!;
    expect(moved.zone).toBe("hand");
  });
});

describe("BSAZ02-M03 effects[1]: スタック［ゲームに2回：同名］相手のデッキ/トラッシュは神託/導託以外の相手のスピリット/ネクサス効果を受けない", () => {
  const effect = M03.effects![1]!;

  it("effect 定義: field_has(火星ネクサス) condition + activated/stack + per_card_name/game/maxCount:2", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(effect.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["nexus"],
        tribes: ["火星"],
      },
    ]);
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
      maxCount: 2,
    });
  });

  function srcM03() {
    return createCardInstance(M03, {
      instanceId: "src-m03",
      ownerPlayerId: ALICE,
      zone: "field",
    });
  }

  // condition: field_has(player:self, category:nexus, tribes:火星) を満たすため、
  // ALICE のフィールドに火星ネクサスを1枚配置する (effects[0] テストの NEXUS1 を流用)。
  function marsNexusOnField() {
    return createCardInstance(NEXUS1, {
      instanceId: "alice-mars-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
  }

  function runEffect(state: GameState): GameState {
    return executeEffect({
      chainId: "test:bsaz02-m03-information-partition:223",
      state,
      effect,
      effectIndex: 1,
      sourceInstanceId: "src-m03",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
  }

  it("相手のデッキ/トラッシュカードに対し defense_immune CE (zone:deck/trash, sourcePlayerScope:self) が登録される", () => {
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [srcM03(), marsNexusOnField()],
    });
    const after = runEffect(state);
    const ce = after.activeContinuousEffects.find(
      (c) =>
        c.modifierTag === "defense_immune" && c.sourceInstanceId === "src-m03"
    );
    expect(ce).toBeDefined();
    expect(ce!.targetFilter).toEqual({
      player: "opponent",
      zone: ["deck", "trash"],
    });
    expect(ce!.immunityPlayerScope).toBe("self");
    expect(ce!.immunitySourceScope).toEqual({
      categories: ["spirit", "nexus"],
      excludedAspects: ["oracle"],
    });
    expect(ce!.duration).toEqual({ scope: "turn" });
  });

  it("相手のデッキ/トラッシュのカードは、相手自身のスピリット/ネクサス発生源の効果を受けない", () => {
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [srcM03(), marsNexusOnField()],
    });
    const after = runEffect(state);
    const bobDeckCard = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "bob-deck-card",
      ownerPlayerId: BOB,
      zone: "deck",
    });
    const bobTrashCard = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "bob-trash-card",
      ownerPlayerId: BOB,
      zone: "trash",
    });
    const withTargets: GameState = {
      ...after,
      cardInstances: [...after.cardInstances, bobDeckCard, bobTrashCard],
    };
    const opponentNexus = card("BSAZ02-C09"); // printedCategory: "nexus", 相手(=BOB)自身の発生源
    expect(opponentNexus.printedCategory).toBe("nexus");
    expect(
      isCardImmuneToOpponentEffect(
        withTargets,
        bobDeckCard,
        BOB,
        "none",
        { definition: opponentNexus },
        getDef
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        withTargets,
        bobTrashCard,
        BOB,
        "none",
        { definition: opponentNexus },
        getDef
      )
    ).toBe(true);
  });

  it("神託/導託によるデッキ破棄とコア配置は免疫を受けず解決する", () => {
    const guided = card("BSAZ02-X04");
    const state = runEffect(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          srcM03(),
          marsNexusOnField(),
          createCardInstance(guided, {
            instanceId: "oracle",
            ownerPlayerId: BOB,
            zone: "field",
          }),
          ...Array.from({ length: 3 }, (_, i) =>
            createCardInstance(card("BSAZ02-C01"), {
              instanceId: `oracle-deck-${i}`,
              ownerPlayerId: BOB,
              zone: "deck",
            })
          ),
        ],
        playerOverrides: [{}, { deckCount: 3 }],
      })
    );
    const after = resolvePlacementOracleMechanic(
      state,
      { kind: "placement_oracle", grandwalkerInstanceId: "oracle" },
      getDef
    );
    expect(
      after.cardInstances.filter(
        (c) => c.instanceId.startsWith("oracle-deck") && c.zone === "trash"
      )
    ).toHaveLength(3);
    expect(
      after.cardInstances.find((c) => c.instanceId === "oracle")
        ?.normalCoreCount
    ).toBe(3);
  });

  it("創界神/導界者ネクサスの通常効果にも免疫が成立する", () => {
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [srcM03(), marsNexusOnField()],
    });
    const after = runEffect(state);
    const bobDeckCard = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "bob-deck-card",
      ownerPlayerId: BOB,
      zone: "deck",
    });
    const withTarget: GameState = {
      ...after,
      cardInstances: [...after.cardInstances, bobDeckCard],
    };
    const guidedNexus = card("BSAZ02-X04"); // grandwalkerData 保持（導界者ネクサス）
    expect(guidedNexus.grandwalkerData).toBeDefined();
    expect(
      isCardImmuneToOpponentEffect(
        withTarget,
        bobDeckCard,
        BOB,
        "none",
        { definition: guidedNexus },
        getDef
      )
    ).toBe(true);
  });

  it("発生源がマジックのときは免疫が成立しない（categories:[spirit,nexus] に一致しない）", () => {
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [srcM03(), marsNexusOnField()],
    });
    const after = runEffect(state);
    const bobDeckCard = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "bob-deck-card",
      ownerPlayerId: BOB,
      zone: "deck",
    });
    const withTarget: GameState = {
      ...after,
      cardInstances: [...after.cardInstances, bobDeckCard],
    };
    const opponentMagic = card("BSAZ01-C03");
    expect(opponentMagic.printedCategory).toBe("magic");
    expect(
      isCardImmuneToOpponentEffect(
        withTarget,
        bobDeckCard,
        BOB,
        "none",
        { definition: opponentMagic },
        getDef
      )
    ).toBe(false);
  });

  it("自分 (ALICE) 起因の効果には免疫が成立しない（sourcePlayerScope:self= 相手自身の効果限定）", () => {
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [srcM03(), marsNexusOnField()],
    });
    const after = runEffect(state);
    const bobDeckCard = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "bob-deck-card",
      ownerPlayerId: BOB,
      zone: "deck",
    });
    const withTarget: GameState = {
      ...after,
      cardInstances: [...after.cardInstances, bobDeckCard],
    };
    const opponentNexus = card("BSAZ02-C09");
    expect(
      isCardImmuneToOpponentEffect(
        withTarget,
        bobDeckCard,
        ALICE,
        "none",
        { definition: opponentNexus },
        getDef
      )
    ).toBe(false);
  });
});
