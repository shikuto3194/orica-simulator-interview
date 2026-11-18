/**
 * P3-121: `excludeCategory`（override_properties, engine-category-negation-override）を
 * 直接 `def.printedCategory` を読んで category フィルタを判定していた10経路
 * （getEffectiveCategory 非経由）で伝播させるよう統一した回帰テスト。
 *
 * 対象（いずれも修正前は excludeCategory 付与済みカードでも printedCategory で
 * マッチしてしまい、「〇〇として扱わない」保護を静かに回避していた）:
 *  - executeDiscardHand の filter.category 判定 (structured-zone-ops.ts)
 *  - executeRevealHand の filter.category 判定 (structured-zone-ops.ts)
 *  - resolveSummonFromZoneCandidates の filter.category 判定 (structured-summon.ts)
 *  - resolveBonusCoreLocation の field_card filter.category 判定 (structured-core-move.ts)
 *  - matchesUnsealCardEvent の cardFilter.categories 判定 (grandstone-system.ts)
 *  - matchesOracleCondition / executeMatchingRetriggers / pendingDeckReveal picking
 *  - maxCombinedBraves.condition の incoming brave category 判定（候補列挙 + 最終 attach）
 *
 * instance 不在 fallback と def-only brave 条件は matchesCardFilterByDef、global
 * override_properties targetFilter は getEffectiveCategory へ寄せ、scripts/check-ssot.mjs の
 * exclude-category-effective-lookup baseline は空にしている。cost CE targetFilter.category は
 * cost-modify-additional-cost-player-path.test.ts 側で固定。
 */
import { describe, expect, it } from "vitest";
import {
  executeDiscardHand,
  executeRevealHand,
} from "../src/effect/structured-zone-ops";
import { resolveSummonFromZoneCandidates } from "../src/effect/structured-summon";
import { resolveBonusCoreLocation } from "../src/effect/structured-core-move";
import { matchesUnsealCardEvent } from "../src/mechanics/grandstone-system";
import { matchesOracleCondition } from "../src/mechanics/oracle-system";
import { executeMatchingRetriggers } from "../src/effect/retrigger-system";
import { getLegalActions } from "../src/legal/legal-actions";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import {
  canReceiveBraveWithinCombineLimit,
  getEffectiveBp,
  getEffectiveTribes,
} from "../src/legal/legal-actions-shared";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function ultimateDef(): CardDefinition {
  return {
    cardNo: "TEST-ULTIMATE",
    name: "Test Ultimate",
    printedCategory: "ultimate",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
  } as CardDefinition;
}

function hostWithUltimateOnlyMultiCombineDef(): CardDefinition {
  return {
    ...ultimateDef(),
    cardNo: "TEST-HOST",
    name: "Test Host",
    printedCategory: "spirit",
    maxCombinedBraves: {
      count: 2,
      condition: { categories: ["ultimate"] },
    },
  } as CardDefinition;
}

const getDef = (id: string): CardDefinition | undefined =>
  id === ultimateDef().cardNo
    ? ultimateDef()
    : id === hostWithUltimateOnlyMultiCombineDef().cardNo
      ? hostWithUltimateOnlyMultiCombineDef()
      : undefined;

/** BSTH03-M01 型: 対象カード自身に「アルティメットとして扱わない」を付与する CE。 */
function excludeUltimateCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `ce-exclude-ultimate-${targetInstanceId}`,
    sourceInstanceId: "source-1",
    sourceDefinitionId: "SRC-001",
    actingPlayerId: ALICE,
    duration: { scope: "battle" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties" as ContinuousEffectTag,
    targetInstanceId,
    metadata: { properties: { excludeCategory: "ultimate" } },
  };
}

function globalAddTribeForUltimateCE(): ContinuousEffect {
  return {
    effectId: "ce-global-add-tribe-for-ultimate",
    sourceInstanceId: "source-2",
    sourceDefinitionId: "SRC-002",
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties" as ContinuousEffectTag,
    targetFilter: { player: "self", category: ["ultimate"] },
    metadata: { properties: { addTribes: ["対象"] } },
  };
}

function globalBpModifierForUltimateCE(): ContinuousEffect {
  return {
    effectId: "ce-global-bp-for-ultimate",
    sourceInstanceId: "source-bp",
    sourceDefinitionId: ultimateDef().cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "bp_modifier" as ContinuousEffectTag,
    modifierAmount: 2000,
    targetFilter: { player: "self", category: ["ultimate"] },
  };
}

describe("P3-121: excludeCategory が SSOT 非経由の category フィルタ経路でも効く", () => {
  it("executeDiscardHand: excludeCategory 付き ultimate は filter.category:[ultimate] で破棄対象から外れる", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      ),
      activeContinuousEffects: [excludeUltimateCE("card-1")],
    };

    const result = executeDiscardHand(
      state,
      ALICE,
      {
        kind: "discard_hand",
        count: -1,
        unseen: true,
        filter: { category: ["ultimate"] },
      },
      getDef
    );

    expect(
      result.cardInstances.find((c) => c.instanceId === "card-1")?.zone
    ).toBe("hand");
  });

  it("executeDiscardHand: excludeCategory 無しなら従来どおり printedCategory=ultimate で破棄対象に入る", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1 } : p
      ),
    };

    const result = executeDiscardHand(
      state,
      ALICE,
      {
        kind: "discard_hand",
        count: -1,
        unseen: true,
        filter: { category: ["ultimate"] },
      },
      getDef
    );

    expect(
      result.cardInstances.find((c) => c.instanceId === "card-1")?.zone
    ).toBe("trash");
  });

  it("executeRevealHand: excludeCategory 付き ultimate は filter.category:[ultimate] で公開対象から外れる", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      activeContinuousEffects: [excludeUltimateCE("card-1")],
    };

    const result = executeRevealHand(
      state,
      ALICE,
      {
        kind: "reveal_hand",
        revealTo: "self",
        filter: { category: ["ultimate"] },
      },
      getDef
    );

    expect(
      result.log.some(
        (l) => l.includes("card-1") && l.startsWith("effect:reveal_hand")
      )
    ).toBe(false);
  });

  it("resolveSummonFromZoneCandidates: excludeCategory 付き ultimate は filter.category:[ultimate] の候補から外れる", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      activeContinuousEffects: [excludeUltimateCE("card-1")],
    };

    const candidates = resolveSummonFromZoneCandidates(
      state,
      ALICE,
      { zone: "hand", filter: { category: ["ultimate"] } },
      getDef
    );

    expect(candidates.map((c) => c.instanceId)).not.toContain("card-1");
  });

  it("resolveBonusCoreLocation (field_card): excludeCategory 付き ultimate は filter.category:[ultimate] の候補から外れる", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      activeContinuousEffects: [excludeUltimateCE("card-1")],
    };

    const loc = resolveBonusCoreLocation(
      state,
      {
        kind: "field_card",
        player: "self",
        filter: { category: ["ultimate"] },
      },
      ALICE,
      getDef
    );

    expect(loc).toBeUndefined();
  });

  it("resolveBonusCoreLocation (field_card): colors は treat_as_color 後の実効色で判定する", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      activeContinuousEffects: [
        {
          effectId: "ce-treat-as-purple",
          sourceInstanceId: "source-1",
          sourceDefinitionId: "SRC-001",
          actingPlayerId: ALICE,
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "treat_as_color" as ContinuousEffectTag,
          modifierSymbol: ["purple"],
          targetInstanceId: "card-1",
        },
      ],
    };

    const loc = resolveBonusCoreLocation(
      state,
      {
        kind: "field_card",
        player: "self",
        filter: { colors: ["purple"] },
      },
      ALICE,
      getDef
    );

    expect(loc).toEqual({ kind: "card", instanceId: "card-1" });
  });

  it("matchesUnsealCardEvent: excludeCategory 付き ultimate は cardFilter.categories:[ultimate] にマッチしない", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      activeContinuousEffects: [excludeUltimateCE("card-1")],
    };

    const matched = matchesUnsealCardEvent({
      state,
      event: "summon",
      triggerCard: card,
      triggerDef: ultimateDef(),
      condition: {
        events: ["summon"],
        cardFilter: { categories: ["ultimate"] },
      },
      getCardDefinitionById: getDef,
    });

    expect(matched).toBe(false);
  });

  it("matchesUnsealCardEvent: excludeCategory 無しなら従来どおり printedCategory=ultimate でマッチする", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = { ...base, cardInstances: [card] };

    const matched = matchesUnsealCardEvent({
      state,
      event: "summon",
      triggerCard: card,
      triggerDef: ultimateDef(),
      condition: {
        events: ["summon"],
        cardFilter: { categories: ["ultimate"] },
      },
      getCardDefinitionById: getDef,
    });

    expect(matched).toBe(true);
  });

  it("matchesOracleCondition: excludeCategory 付き ultimate は effective context 指定時に categories:[ultimate] にマッチしない", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      activeContinuousEffects: [excludeUltimateCE("card-1")],
    };

    const matched = matchesOracleCondition(
      ultimateDef(),
      { categories: ["ultimate"] },
      { state, card }
    );

    expect(matched).toBe(false);
  });

  it("matchesOracleCondition: effective context 省略時は従来どおり printedCategory でマッチする（後方互換）", () => {
    const matched = matchesOracleCondition(ultimateDef(), {
      categories: ["ultimate"],
    });

    expect(matched).toBe(true);
  });

  it("executeMatchingRetriggers: excludeCategory 付き ultimate は retriggerFilter.category:[ultimate] にマッチせず再発火しない", () => {
    const magicDef: CardDefinition = {
      ...ultimateDef(),
      cardNo: "TEST-MAGIC",
      printedCategory: "magic",
    };
    const attackerCard = createCardInstance(ultimateDef(), {
      instanceId: "atk-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const rt: ContinuousEffect = {
      effectId: "rt-test-1",
      sourceInstanceId: "magic-1",
      sourceDefinitionId: magicDef.cardNo,
      actingPlayerId: ALICE,
      modifierTag: "retrigger" as ContinuousEffectTag,
      duration: { scope: "turn" },
      createdAtTurn: base.turnNumber,
      createdAtAttackId: null,
      retriggerEvent: "attack",
      retriggerPlayer: "self",
      retriggerFilter: { category: ["ultimate"] },
      retriggerEffectIndex: 0,
      retriggerStepIndex: 0,
      retriggerFireCount: 0,
    };
    const state: GameState = {
      ...base,
      cardInstances: [attackerCard],
      activeContinuousEffects: [rt, excludeUltimateCE("atk-1")],
    };
    const getDefWithMagic = (id: string): CardDefinition | undefined =>
      id === magicDef.cardNo ? magicDef : getDef(id);

    const result = executeMatchingRetriggers({
      state,
      event: "attack",
      triggerCard: attackerCard,
      triggerCardDefinition: ultimateDef(),
      getCardDefinitionById: getDefWithMagic,
    });

    expect(result.log.some((l) => l.includes("retrigger:fire"))).toBe(false);
    const retriggerCE = result.activeContinuousEffects.find(
      (ce) => ce.effectId === "rt-test-1"
    );
    expect(retriggerCE?.retriggerFireCount).toBe(0);
  });

  it("getLegalActions (pendingDeckReveal picking): excludeCategory 付き ultimate は pick filter.category:[ultimate] の候補から外れる", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      activeContinuousEffects: [excludeUltimateCE("card-1")],
      pendingDeckReveal: {
        pendingId: "dr-1",
        actingPlayerId: ALICE,
        sourceInstanceId: "src-1",
        sourceDefinitionId: ultimateDef().cardNo,
        revealedCardInstanceIds: ["card-1"],
        picks: [{ count: 1, filter: { category: ["ultimate"] } }],
        remainder: "trash",
        phase: "picking",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
      },
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
    });

    const pickAction = actions.find(
      (a) => a.kind === "resolve_pending_deck_reveal_pick"
    ) as { candidateCardInstanceIds?: string[] } | undefined;
    expect(pickAction).toBeDefined();
    expect(pickAction?.candidateCardInstanceIds).not.toContain("card-1");
  });

  it("canReceiveBraveWithinCombineLimit: maxCombinedBraves.condition categories は incoming brave の excludeCategory を見る", () => {
    const hostDef = hostWithUltimateOnlyMultiCombineDef();
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const brave = createCardInstance(ultimateDef(), {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    host.attachedChildrenIds = ["existing-brave"];
    const existing = createCardInstance(ultimateDef(), {
      instanceId: "existing-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const withoutExclude: GameState = {
      ...base,
      cardInstances: [host, existing, brave],
    };
    expect(
      canReceiveBraveWithinCombineLimit({
        state: withoutExclude,
        host,
        incomingBrave: brave,
        incomingBraveDef: ultimateDef(),
        getCardDefinitionById: getDef,
      })
    ).toBe(true);

    const withExclude: GameState = {
      ...withoutExclude,
      activeContinuousEffects: [excludeUltimateCE("brave-1")],
    };
    expect(
      canReceiveBraveWithinCombineLimit({
        state: withExclude,
        host,
        incomingBrave: brave,
        incomingBraveDef: ultimateDef(),
        getCardDefinitionById: getDef,
      })
    ).toBe(false);
  });

  it("executeBraveCombine: 最終 attach 再検査でも incoming brave の excludeCategory を見る", () => {
    const hostDef = hostWithUltimateOnlyMultiCombineDef();
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const brave = createCardInstance(ultimateDef(), {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    host.attachedChildrenIds = ["existing-brave"];
    const existing = createCardInstance(ultimateDef(), {
      instanceId: "existing-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: host.instanceId,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [host, existing, brave],
      activeContinuousEffects: [excludeUltimateCE("brave-1")],
    };

    const result = executeBraveCombine(
      state,
      ALICE,
      "brave-1",
      "host-1",
      getDef
    );

    expect(
      result.cardInstances.find((c) => c.instanceId === "brave-1")
        ?.attachedToInstanceId
    ).toBeNull();
    expect(
      result.cardInstances.find((c) => c.instanceId === "host-1")
        ?.attachedChildrenIds
    ).not.toContain("brave-1");
  });

  it("global override_properties targetFilter.category はローカル excludeCategory を見る", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      activeContinuousEffects: [
        excludeUltimateCE("card-1"),
        globalAddTribeForUltimateCE(),
      ],
    };

    expect(getEffectiveTribes(state, card, ultimateDef(), getDef)).toEqual([]);
  });

  it("global override_properties targetFilter.category は excludeCategory が無ければ従来どおり印字カテゴリにマッチする", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      activeContinuousEffects: [globalAddTribeForUltimateCE()],
    };

    expect(getEffectiveTribes(state, card, ultimateDef(), getDef)).toEqual([
      "対象",
    ]);
  });

  it("global bp_modifier targetFilter.category はローカル excludeCategory を見る", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      activeContinuousEffects: [
        excludeUltimateCE("card-1"),
        globalBpModifierForUltimateCE(),
      ],
    };

    expect(getEffectiveBp(state, card, ultimateDef(), getDef)).toBe(3000);
  });

  it("global bp_modifier targetFilter.category は excludeCategory が無ければ従来どおり印字カテゴリにマッチする", () => {
    const card = createCardInstance(ultimateDef(), {
      instanceId: "card-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...base,
      cardInstances: [card],
      activeContinuousEffects: [globalBpModifierForUltimateCE()],
    };

    expect(getEffectiveBp(state, card, ultimateDef(), getDef)).toBe(5000);
  });
});
