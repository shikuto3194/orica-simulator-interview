/**
 * BSTH05.5 (東方緋想天) カードの effects 検証テスト。
 *
 * カード番号順にサブバッチ単位で追加していく。effects 追加時は最小 1 ケース、
 * 効果実行後の盤面変化を検証する。
 */
import { describe, expect, it } from "vitest";
import { divineSkillFlashPosition } from "./divine-skill-timing-position";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { advanceStep } from "../src/turn-system";
import {
  applyLegalAction,
  checkAndQueueOracleChoices,
  confirmAttackDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveTribes,
  getLegalActions,
  useAttackAsAction,
  usePassPreDeclarationStackAsAction,
} from "../src";
import { evaluateConditionClause } from "../src/effect/structured-condition-eval";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";
import { recomputeAndRebuildContinuousEffects } from "../src/effect/continuous-effect-rebuild";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
  LegalAction,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const noLookup = (_: string) => undefined;

function cannotLeaveCE(
  targetInstanceId: string,
  tag: ContinuousEffectTag,
  ownerPlayerId: string
): ContinuousEffect {
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

function isLeaving(result: GameState, id: string): boolean {
  const c = result.cardInstances.find((x) => x.instanceId === id);
  return (
    !c ||
    c.zone !== "field" ||
    result.pendingLeaveEntities.some(
      (e) => e.instanceId === id && !e.blockedByResistance
    )
  );
}

// ============================================================
// BSTH05.5-C04 [緋想天]アリス・マーガトロイド
// ============================================================
//
// Lv1-Lv2『このスピリットの召喚時』
// 自分はデッキの上から2枚ドローできる。ドロー後、自分は手札1枚を破棄する。
//
// Lv1-Lv2 このスピリットは、アタックできず、相手の効果を受けない。
// このスピリットと、自分の青の導界者ネクサスは系統：「起幻」を持つ。

describe("BSTH05.5-C04 [緋想天]アリス・マーガトロイド", () => {
  const アリス = cardNoMap.get("BSTH05.5-C04");

  it("カードデータに存在する", () => {
    expect(アリス).toBeDefined();
    expect(アリス?.printedCategory).toBe("spirit");
    expect(アリス?.tribe).toContain("緋想");
  });

  it("effects[0] 召喚時: 2 ドロー + 手札 1 破棄 (executionMode: optional)", () => {
    expect(アリス?.effects).toBeDefined();
    const summonEffect = アリス!.effects![0]!;
    expect(summonEffect.timing).toEqual({
      kind: "card_event",
      event: "summon",
    });
    expect(summonEffect.executionMode).toBe("optional");
    expect(summonEffect.steps[0]?.action.kind).toBe("draw");
    expect(summonEffect.steps[1]?.action.kind).toBe("discard");
  });

  it("effects[0] 召喚時効果実行で 2 ドロー後、手札 1 破棄が pendingZoneSelection で待機する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    // alice の手札に既存カード 2 枚 + デッキに 5 枚を仕込む
    const handCard1 = createCardInstance(アリス!, {
      instanceId: "hand-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const handCard2 = createCardInstance(アリス!, {
      instanceId: "hand-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const deckCards = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(アリス!, {
        instanceId: `deck-${i + 1}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const fieldArisu = createCardInstance(アリス!, {
      instanceId: "alisu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });

    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [handCard1, handCard2, ...deckCards, fieldArisu],
    };

    const effect = アリス!.effects![0]!;
    const result = executeEffect({
      chainId: "test:bsth05_5-cards:147",
      state,
      effect,
      sourceInstanceId: "alisu-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    // 2 枚ドロー: 手札 = 元 2 + 2 = 4 (破棄前)
    const aliceHand = result.cardInstances.filter(
      (c) => c.controllerPlayerId === "alice" && c.zone === "hand"
    );
    expect(aliceHand.length).toBe(4);
    // デッキは 5 - 2 = 3 になる
    const aliceDeck = result.cardInstances.filter(
      (c) => c.controllerPlayerId === "alice" && c.zone === "deck"
    );
    expect(aliceDeck.length).toBe(3);
    // 手札 4 枚から 1 枚破棄 → pendingZoneSelection で待機 (まだ破棄されていない)
    expect(result.pendingZoneSelection).not.toBeNull();
    expect(result.pendingZoneSelection?.actingPlayerId).toBe("alice");
    expect(result.pendingZoneSelection?.actionKind).toBe("discard_hand");
    expect(result.pendingZoneSelection?.maxCount).toBe(1);
  });

  it("effects[1] continuous: prevent_battle attack (アタック禁止)", () => {
    const effect = アリス!.effects![1]!;
    expect(effect.timing.kind).toBe("continuous");
    expect(effect.steps[0]?.action.kind).toBe("prevent_battle");
    if (effect.steps[0]?.action.kind === "prevent_battle") {
      expect(effect.steps[0]!.action.restriction).toEqual(["attack"]);
    }
  });

  it("effects[2] continuous: effect_immunity", () => {
    const effect = アリス!.effects![2]!;
    expect(effect.timing.kind).toBe("continuous");
    expect(effect.steps[0]?.action.kind).toBe("effect_immunity");
  });

  // 「このスピリットと、自分の青の導界者ネクサスは系統：「起幻」を持つ」検証
  // effects[3] = self target addTribes、effects[4] = filter target addTribes (動的メンバー)。
  describe("effects[3]/[4] 「起幻」tribe 付与 (override_properties addTribes)", () => {
    const 永江衣玖 = cardNoMap.get("BSTH05.5-X02"); // [導界者]永江 衣玖（青の導界者ネクサス）

    it("effects[3] は self target の override_properties addTribes", () => {
      const effect = アリス!.effects![3]!;
      expect(effect.timing.kind).toBe("continuous");
      const action = effect.steps[0]!.action;
      expect(action.kind).toBe("override_properties");
      if (action.kind === "override_properties") {
        expect(action.target).toEqual({ kind: "self" });
        expect(action.properties.addTribes).toEqual(["起幻"]);
      }
    });

    it("effects[4] は filter target (青の導界者ネクサス) の override_properties addTribes", () => {
      const effect = アリス!.effects![4]!;
      expect(effect.timing.kind).toBe("continuous");
      const action = effect.steps[0]!.action;
      expect(action.kind).toBe("override_properties");
      if (action.kind === "override_properties") {
        expect(action.properties.addTribes).toEqual(["起幻"]);
        if (
          typeof action.target === "object" &&
          "kind" in action.target &&
          action.target.kind === "filter"
        ) {
          expect(action.target.player).toBe("self");
          expect(action.target.filter.category).toEqual(["nexus"]);
          expect(action.target.filter.colors).toEqual(["blue"]);
          expect(action.target.filter.tribes).toContain("導界者");
          expect(action.target.filter.targetsGrandwalker).toBe(true);
        } else {
          throw new Error("expected filter target");
        }
      }
    });

    it("self target: アリス自身の実効系統に 起幻 が加わる（既存系統は保持）", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const fieldArisu = createCardInstance(アリス!, {
        instanceId: "alisu-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [fieldArisu],
      };
      const stateAfter = executeEffect({
        chainId: "test:bsth05_5-cards:241",
        state,
        effect: アリス!.effects![3]!,
        sourceInstanceId: "alisu-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const tribes = getEffectiveTribes(
        stateAfter,
        stateAfter.cardInstances.find((c) => c.instanceId === "alisu-1"),
        アリス!,
        getCardDefinitionById
      );
      // 元: 幻想・緋想・導魔 + 起幻
      expect(tribes).toContain("幻想");
      expect(tribes).toContain("緋想");
      expect(tribes).toContain("導魔");
      expect(tribes).toContain("起幻");
    });

    it("filter target (動的): 既存の青導界者ネクサスに 起幻 が加わる", () => {
      expect(永江衣玖).toBeDefined();
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const fieldArisu = createCardInstance(アリス!, {
        instanceId: "alisu-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const fieldNexus = createCardInstance(永江衣玖!, {
        instanceId: "iku-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [fieldArisu, fieldNexus],
      };
      const stateAfter = executeEffect({
        chainId: "test:bsth05_5-cards:283",
        state,
        effect: アリス!.effects![4]!,
        sourceInstanceId: "alisu-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const nexusTribes = getEffectiveTribes(
        stateAfter,
        stateAfter.cardInstances.find((c) => c.instanceId === "iku-1"),
        永江衣玖!,
        getCardDefinitionById
      );
      // 元: 導界者・竜渡 + 起幻
      expect(nexusTribes).toContain("導界者");
      expect(nexusTribes).toContain("竜渡");
      expect(nexusTribes).toContain("起幻");
    });

    it("filter target (動的): 後から場に出た青導界者ネクサスにも 起幻 が及ぶ", () => {
      expect(永江衣玖).toBeDefined();
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const fieldArisu = createCardInstance(アリス!, {
        instanceId: "alisu-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [fieldArisu],
      };
      // CE 登録時点ではネクサスは場にない
      const stateAfterEffect = executeEffect({
        chainId: "test:bsth05_5-cards:319",
        state,
        effect: アリス!.effects![4]!,
        sourceInstanceId: "alisu-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      // 後から青導界者ネクサスを場に追加
      const lateNexus = createCardInstance(永江衣玖!, {
        instanceId: "iku-late",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      });
      const stateWithLateNexus: GameState = {
        ...stateAfterEffect,
        cardInstances: [...stateAfterEffect.cardInstances, lateNexus],
      };
      const tribes = getEffectiveTribes(
        stateWithLateNexus,
        lateNexus,
        永江衣玖!,
        getCardDefinitionById
      );
      expect(tribes).toContain("起幻");
    });

    it("filter target: 相手の青導界者ネクサスには 起幻 が及ばない (player=self)", () => {
      expect(永江衣玖).toBeDefined();
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const fieldArisu = createCardInstance(アリス!, {
        instanceId: "alisu-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const enemyNexus = createCardInstance(永江衣玖!, {
        instanceId: "iku-bob",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [fieldArisu, enemyNexus],
      };
      const stateAfter = executeEffect({
        chainId: "test:bsth05_5-cards:368",
        state,
        effect: アリス!.effects![4]!,
        sourceInstanceId: "alisu-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const enemyTribes = getEffectiveTribes(
        stateAfter,
        stateAfter.cardInstances.find((c) => c.instanceId === "iku-bob"),
        永江衣玖!,
        getCardDefinitionById
      );
      expect(enemyTribes).not.toContain("起幻");
    });

    it("既存 override_properties.tribes overwrite との互換: addTribes は overwrite 後に加算", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const fieldArisu = createCardInstance(アリス!, {
        instanceId: "alisu-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [fieldArisu],
      };
      // 1) overwrite で系統を ["異質"] に
      const overwriteEffect = {
        timing: { kind: "card_event" as const, event: "summon" as const },
        steps: [
          {
            action: {
              kind: "override_properties" as const,
              target: { kind: "self" as const },
              properties: { tribes: ["異質"] },
              duration: { scope: "permanent" as const },
            },
          },
        ],
      };
      const s1 = executeEffect({
        chainId: "test:bsth05_5-cards:413",
        state,
        effect: overwriteEffect,
        sourceInstanceId: "alisu-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      // 2) addTribes で 起幻 を加算
      const s2 = executeEffect({
        chainId: "test:bsth05_5-cards:421",
        state: s1,
        effect: アリス!.effects![3]!,
        sourceInstanceId: "alisu-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const tribes = getEffectiveTribes(
        s2,
        s2.cardInstances.find((c) => c.instanceId === "alisu-1"),
        アリス!,
        getCardDefinitionById
      );
      expect(tribes).toContain("異質"); // overwrite 後の系統
      expect(tribes).toContain("起幻"); // addTribes で加算
      expect(tribes).not.toContain("幻想"); // overwrite で消去
    });
  });
});

// ============================================================
// 共通ヘルパー
// ============================================================

/** 指定プレイヤーのデッキに N 枚のダミーカードを積む（先頭 = top）。 */
function buildDeck(def: CardDefinition, ownerId: string, count: number) {
  return Array.from({ length: count }, (_, i) =>
    createCardInstance(def, {
      instanceId: `${ownerId}-deck-${i + 1}`,
      ownerPlayerId: ownerId,
      controllerPlayerId: ownerId,
      zone: "deck",
    })
  );
}

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId: string
) {
  return executeEffect({
    chainId: "test:bsth05_5-cards:463",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById,
  });
}

// ============================================================
// BSTH05.5-C01 要石（アルティメット）
// ============================================================
describe("BSTH05.5-C01 要石", () => {
  const card = cardNoMap.get("BSTH05.5-C01")!;

  it("effects 構成: コスト下限 floor / 召喚時除外 / アタック時除外 / Lv4シンボル追加", () => {
    expect(card.effects?.length).toBe(4);
    const costFloor = card.effects![0]!.steps[0]!.action;
    expect(costFloor.kind).toBe("cost_modify");
    if (costFloor.kind === "cost_modify") {
      expect(costFloor.target).toEqual({ kind: "self" });
      expect(costFloor.modifier).toEqual({ floor: 1 });
    }
    expect(card.effects![1]!.timing).toEqual({
      kind: "card_event",
      event: "summon",
    });
    expect(card.effects![1]!.steps[0]!.action.kind).toBe("move_card");
    expect(card.effects![2]!.timing.kind).toBe("game_event");
    expect(card.effects![3]!.steps[0]!.action.kind).toBe("symbol_add");
  });

  it("召喚時: 相手のデッキ上2枚がremoved_from_gameへ移り、voidには入らない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "kaname-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...buildDeck(card, "bob", 5)],
    };
    const result = runEffect(state, card.effects![1]!, "kaname-1", "alice");
    const bobDeck = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "bob" && c.zone === "deck"
    );
    const removed = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "bob" && c.zone === "removed_from_game"
    );
    expect(bobDeck.length).toBe(3);
    expect(removed.map((c) => c.instanceId)).toEqual([
      "bob-deck-1",
      "bob-deck-2",
    ]);
    expect(result.cardInstances.filter((c) => c.zone === "void")).toEqual([]);
    expect(result.cardInstances.filter((c) => c.zone === "trash")).toEqual([]);
    expect(result.log).toContain(
      "effect:move_card:deck->removed_from_game:2cards"
    );
  });

  function attackState(attackerNo: string, owner = "alice"): GameState {
    const selfAttacks = attackerNo === card.cardNo && owner === "alice";
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: owner,
      turnNumber: 4,
      step: "attack",
      cardInstances: [
        createCardInstance(card, {
          instanceId: "kaname-1",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        ...(selfAttacks
          ? []
          : [
              createCardInstance(cardNoMap.get(attackerNo)!, {
                instanceId: "attacker",
                ownerPlayerId: owner,
                zone: "field",
                normalCoreCount: 1,
              }),
            ]),
        ...buildDeck(card, "bob", 5),
      ],
    };
    return recomputeAndRebuildContinuousEffects(state, getCardDefinitionById);
  }

  function declareAttack(state: GameState): GameState {
    const sourceInstanceId = state.cardInstances.some(
      (c) => c.instanceId === "attacker"
    )
      ? "attacker"
      : "kaname-1";
    const action = getLegalActions({
      state,
      actingPlayerId: state.activePlayerId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).find(
      (a) => a.kind === "attack" && a.sourceInstanceId === sourceInstanceId
    );
    expect(action).toBeDefined();
    const tentative = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
    return act(
      tentative,
      state.activePlayerId === "alice" ? "bob" : "alice",
      "pass_pre_declaration_stack"
    );
  }

  function act(
    state: GameState,
    player: string,
    kind: LegalAction["kind"]
  ): GameState {
    const action = getLegalActions({
      state,
      actingPlayerId: player,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions: () => [],
    }).find(
      (a) =>
        a.kind === kind &&
        (kind !== "resolve_pending_triggered_effect" ||
          ("sourceInstanceId" in a && a.sourceInstanceId === "kaname-1"))
    );
    expect(action).toBeDefined();
    return applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
  }

  describe.each([
    ["緋想", "spirit", "BSTH05.5-C03"],
    ["緋想", "ultimate", "BSTH05.5-C01"],
    ["竜渡", "ultimate", "BSTH05.5-M02"],
  ] as const)("%s/%s/%s", (tribe, category, attackerNo) => {
    it("自分の実アタックで相手デッキ上2枚を除外する", () => {
      const attacker = cardNoMap.get(attackerNo)!;
      expect(attacker.printedCategory).toBe(category);
      expect(attacker.tribe?.split("・")).toContain(tribe);
      const declared = declareAttack(attackState(attackerNo));
      expect(
        declared.pendingTriggeredEffects.some(
          (p) =>
            p.eventKind === "attack" &&
            Object.values(p.timingSourceRegistrations ?? {}).some(
              (r) => r.sourceInstanceId === "kaname-1"
            )
        )
      ).toBe(true);
      const result = act(
        act(declared, "alice", "resolve_pending_triggered_effect"),
        "bob",
        "pass_stack"
      );
      expect(
        result.cardInstances
          .filter((c) => c.zone === "removed_from_game")
          .map((c) => [c.instanceId, c.ownerPlayerId])
      ).toEqual([
        ["bob-deck-1", "bob"],
        ["bob-deck-2", "bob"],
      ]);
      expect(
        result.cardInstances
          .filter((c) => c.zone === "deck")
          .map((c) => c.instanceId)
      ).toEqual(["bob-deck-3", "bob-deck-4", "bob-deck-5"]);
      expect(result.cardInstances.filter((c) => c.zone === "void")).toEqual([]);
      expect(result.cardInstances.filter((c) => c.zone === "trash")).toEqual(
        []
      );
      expect(result.pendingTriggeredEffects).toEqual([]);
      expect(result.stackWindow).toBeNull();
      expect(
        result.log.filter(
          (line) => line === "effect:move_card:deck->removed_from_game:2cards"
        )
      ).toHaveLength(1);
    });
  });

  it("竜渡でもアタックできない紅美鈴は合法な攻撃候補に出ず、除外も起きない", () => {
    const state = attackState("BSTH01-R04");
    expect(
      getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
      }).filter((a) => a.kind === "attack" && a.sourceInstanceId === "attacker")
    ).toEqual([]);
    expect(state.pendingTriggeredEffects).toEqual([]);
    expect(
      state.cardInstances.filter(
        (c) => c.zone === "removed_from_game" || c.zone === "void"
      )
    ).toEqual([]);
    expect(state.cardInstances.filter((c) => c.zone === "deck")).toHaveLength(
      5
    );
  });

  it.each([
    ["系統不一致", "BSTH01-C01", "alice"],
    ["相手の緋想", "BSTH05.5-C03", "bob"],
  ])(
    "%sの実アタックでは要石の除外効果を誘発しない",
    (_label, attackerNo, owner) => {
      const declared = declareAttack(attackState(attackerNo!, owner!));
      expect(
        declared.pendingTriggeredEffects.filter((p) =>
          Object.values(p.timingSourceRegistrations ?? {}).some(
            (r) => r.sourceInstanceId === "kaname-1"
          )
        )
      ).toEqual([]);
      expect(
        declared.cardInstances.filter((c) => c.zone === "deck")
      ).toHaveLength(5);
      expect(
        declared.cardInstances.filter(
          (c) => c.zone === "removed_from_game" || c.zone === "void"
        )
      ).toEqual([]);
    }
  );
});

// ============================================================
// BSTH05.5-C02 [緋想天]魂魄 妖夢（スピリット）
// ============================================================
describe("BSTH05.5-C02 [緋想天]魂魄 妖夢", () => {
  const card = cardNoMap.get("BSTH05.5-C02")!;

  it("effects[0] 召喚時 deck_reveal (3枚, 2 picks, optional)", () => {
    const e = card.effects![0]!;
    expect(e.executionMode).toBe("optional");
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("deck_reveal");
    if (action.kind === "deck_reveal") {
      expect(action.revealCount).toBe(3);
      expect(action.picks.length).toBe(2);
      expect(action.remainder).toBe("top_or_bottom");
    }
  });

  it("effects[1] 相手によるleave_field: デッキ破棄→コア配置(conditional_cost)→stay_on_field", () => {
    const e = card.effects![1]!;
    expect(e.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(e.steps[0]!.action.kind).toBe("move_card");
    expect(e.steps[1]!.action.kind).toBe("core_move");
    expect(e.steps[2]!.action.kind).toBe("stay_on_field");
    expect(e.steps[2]!.connector).toBe("conditional_cost");
  });

  it("召喚時効果実行で pendingDeckReveal が生成される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "youmu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...buildDeck(card, "alice", 5)],
    };
    const result = runEffect(state, card.effects![0]!, "youmu-1", "alice");
    expect(result.pendingDeckReveal).not.toBeNull();
  });
});

// ============================================================
// BSTH05.5-C03 比那名居 地子（スピリット）
// ============================================================
describe("BSTH05.5-C03 比那名居 地子", () => {
  const card = cardNoMap.get("BSTH05.5-C03")!;

  it("effects[0] 召喚時 deck_reveal (4枚, 3 picks: ネクサス/アルティメット/ブレイヴ)", () => {
    const action = card.effects![0]!.steps[0]!.action;
    expect(action.kind).toBe("deck_reveal");
    if (action.kind === "deck_reveal") {
      expect(action.revealCount).toBe(4);
      expect(action.picks.length).toBe(3);
      expect(action.picks[1]!.filter?.category).toEqual(["ultimate"]);
      expect(action.picks[2]!.filter?.category).toEqual(["brave"]);
      expect(action.remainder).toBe("bottom");
    }
  });

  it("effects[1] Lv2 メイン: 青/究極のデュアルシンボル継続追加 (ルーミア型 continuous)", () => {
    const e = card.effects![1]!;
    // 『自分のメインステップ』symbol_add は activated+permanent ではなく
    // continuous + timingScope(main) + applicability(Lv2) で表現する。
    expect(e.timing).toEqual({ kind: "continuous" });
    expect(e.timingScope).toEqual({ player: "self", period: "main" });
    expect(e.applicability).toEqual({ level: { min: 2, max: 2 } });
    const action = e.steps[0]!.action;
    expect(action.kind).toBe("symbol_add");
    if (action.kind === "symbol_add") {
      expect(action.symbol).toEqual(["blue", "ultimate_symbol"]);
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });
});

// ============================================================
// BSTH05.5-C10 羽衣「羽衣は空の如く」（マジック）
// ============================================================
describe("BSTH05.5-C10 羽衣「羽衣は空の如く」", () => {
  const card = cardNoMap.get("BSTH05.5-C10")!;

  it("effects[0] 系統付与 (幻想/竜渡/緋想)", () => {
    const action = card.effects![0]!.steps[0]!.action;
    expect(action.kind).toBe("override_properties");
    if (action.kind === "override_properties") {
      expect(action.properties.addTribes).toEqual(["幻想", "竜渡", "緋想"]);
    }
  });

  it("effects[1] 構造: 原因限定negate×2を先に登録 → draw(3) → discard(choice: 全破棄/1枚filter)", () => {
    const e = card.effects![1]!;
    expect(e.stub).toBeUndefined();
    expect(e.steps).toHaveLength(4);
    expect(e.steps[2]!.action.kind).toBe("draw");

    const discardStep = e.steps[3]!;
    expect(discardStep.action.kind).toBe("discard");
    if (discardStep.action.kind === "discard") {
      expect(discardStep.action.count).toBe(-1);
    }
    expect(discardStep.choice).toHaveLength(1);
    const altDiscard = discardStep.choice![0]!.action;
    expect(altDiscard.kind).toBe("discard");
    if (altDiscard.kind === "discard") {
      expect(altDiscard.count).toBe(1);
      expect(altDiscard.filter).toEqual({
        colors: ["blue"],
        tribes: ["緋想", "竜渡", "幻想"],
      });
    }

    const negateEffectStep = e.steps[0]!;
    expect(negateEffectStep.action.kind).toBe("negate");
    if (negateEffectStep.action.kind === "negate") {
      expect(negateEffectStep.action.negateTarget).toBe("effect");
      expect(negateEffectStep.action.targetController).toBe("opponent");
      expect(negateEffectStep.action.causedByThisEffect).toBe(true);
    }

    const negateBurstStep = e.steps[1]!;
    expect(negateBurstStep.action.kind).toBe("negate");
    if (negateBurstStep.action.kind === "negate") {
      expect(negateBurstStep.action.negateTarget).toBe("opponent_burst");
      expect(negateBurstStep.action.causedByThisEffect).toBe(true);
    }
  });

  it("[board] choiceIndex=0 (既定): 3ドロー後、手札すべて破棄し、後続用の無効化予約を残さない", () => {
    const e = card.effects![1]!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: buildDeck(card, "alice", 6),
    };
    const result = executeEffect({
      chainId: "test:bsth05_5-cards:668",
      state,
      effect: e,
      sourceInstanceId: "alice-deck-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 0,
    });
    const hand = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
    );
    // 3枚ドロー後、手札すべて(=3枚)を破棄するため手札は0枚に戻る。
    expect(hand.length).toBe(0);
    const trash = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "trash"
    );
    expect(trash.length).toBe(3);

    const negateRequest = result.pendingStackNegateRequests.find(
      (r) => r.negateTarget === "effect" && r.targetController === "opponent"
    );
    expect(negateRequest).toBeUndefined();

    const negateBurstCe = result.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "negate_opponent_burst"
    );
    expect(negateBurstCe).toBeUndefined();
  });

  it("[board] choiceIndex=1: 3ドロー後、緋想/竜渡/幻想の青1枚のみ破棄（手札に残り2枚）", () => {
    const e = card.effects![1]!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    // デッキ上3枚を [フィルタ一致1枚 (BSTH05.5-C10自身: colors:blue+tribes:緋想/竜渡/幻想),
    // 不一致2枚 (BSTH001-R01: colors:red)] にし、matching.length(1) === effectiveCount(1) で
    // 自動確定させる（matching > count だと pendingZoneSelection で停止し最終盤面にならない）。
    const matchCard = createCardInstance(card, {
      instanceId: "match-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const filler = getCardDefinitionById("BSTH001-R01")!;
    const fillers = Array.from({ length: 2 }, (_, i) =>
      createCardInstance(filler, {
        instanceId: `filler-${i + 1}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [matchCard, ...fillers],
    };
    const result = executeEffect({
      chainId: "test:bsth05_5-cards:724",
      state,
      effect: e,
      sourceInstanceId: "match-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 1,
    });
    const hand = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
    );
    // 3枚ドロー後、フィルタ一致1枚のみ破棄されるため手札は2枚残る。
    expect(hand.length).toBe(2);
    const trash = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "trash"
    );
    expect(trash.length).toBe(1);
    expect(trash[0]!.instanceId).toBe("match-1");
  });
});

// ============================================================
// BSTH05.5-C20 天界（ネクサス）
// ============================================================
describe("BSTH05.5-C20 天界", () => {
  const card = cardNoMap.get("BSTH05.5-C20")!;

  it("effects 構成: 系統付与+導託opt-in / 配置時コア / 導界者疲労opt-in", () => {
    expect(card.effects?.length).toBe(3);
    expect(card.effects![0]!.stub).toBeUndefined();
    expect(card.effects![1]!.timing).toEqual({
      kind: "card_event",
      event: "place",
    });
    expect(card.effects![1]!.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(card.effects![2]!.stub).toBeUndefined();
  });

  it("effects[0]: 系統付与+アルティメット導託 opt-in を継続効果として付与する", () => {
    const effect = card.effects![0]!;
    expect(effect.timing).toEqual({ kind: "continuous" });
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("override_properties");
    if (action.kind === "override_properties") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.properties.addTribes).toEqual(["幻想", "緋想"]);
      expect(action.properties.actsAsUltimateForOracleTrigger).toBe(true);
      expect(action.duration).toEqual({ scope: "permanent" });
    }
  });

  it("配置: BSTH05.5-X02の本文は召喚/煌臨だけなので、opt-in天界の配置では導託しない", () => {
    const guidedDef = cardNoMap.get("BSTH05.5-X02")!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const guided = createCardInstance(guidedDef, {
      instanceId: "guided-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const tenkai = createCardInstance(card, {
      instanceId: "tenkai-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    let state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [guided, tenkai],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, voidNormalCoreCount: 5 } : p
      ),
    };
    // effects[0] (系統付与+導託opt-in) を先に発揮させ、opt-in CE を登録する。
    state = runEffect(state, card.effects![0]!, "tenkai-1", "alice");
    state = recomputeAndRebuildContinuousEffects(state, getCardDefinitionById);

    const withOracle = checkAndQueueOracleChoices(
      state,
      "tenkai-1",
      "place",
      getCardDefinitionById,
      "test:bsth05_5-cards:806"
    );
    const queued = withOracle.pendingTriggeredEffects.find(
      (p) =>
        p.mechanic?.kind === "oracle" &&
        p.mechanic.grandwalkerInstanceId === "guided-1" &&
        p.mechanic.triggerCardInstanceId === "tenkai-1"
    );
    expect(queued).toBeUndefined();
    for (const event of ["summon", "advent"] as const) {
      const triggered = checkAndQueueOracleChoices(
        state,
        "tenkai-1",
        event,
        getCardDefinitionById,
        `test:bsth05_5:printed:${event}`
      );
      expect(
        triggered.pendingTriggeredEffects.some(
          (p) =>
            p.mechanic?.kind === "oracle" &&
            p.mechanic.grandwalkerInstanceId === "guided-1"
        )
      ).toBe(true);
    }
  });

  it("opt-in 無し: 天界の系統付与効果を発揮していない状態では導託トリガーはキューされない", () => {
    const guidedDef = cardNoMap.get("BSTH05.5-X02")!;
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const guided = createCardInstance(guidedDef, {
      instanceId: "guided-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const tenkai = createCardInstance(card, {
      instanceId: "tenkai-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [guided, tenkai],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, voidNormalCoreCount: 5 } : p
      ),
    };
    const withOracle = checkAndQueueOracleChoices(
      state,
      "tenkai-1",
      "place",
      getCardDefinitionById,
      "test:bsth05_5-cards:845"
    );
    const queued = withOracle.pendingTriggeredEffects.find(
      (p) =>
        p.mechanic?.kind === "oracle" &&
        p.mechanic.grandwalkerInstanceId === "guided-1"
    );
    expect(queued).toBeUndefined();
  });

  it("配置時: ボイドからコア2個がリザーブへ移動", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "tenkai-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, voidNormalCoreCount: 5, reserveNormalCoreCount: 0 }
          : p
      ),
    };
    const result = runEffect(state, card.effects![1]!, "tenkai-1", "alice");
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.voidNormalCoreCount).toBe(3);
  });

  it("effects[2]: Lv2 かつ自分のアタックステップ限定で導界者ネクサス opt-in を付与する", () => {
    const effect = card.effects![2]!;
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "step_phase", step: "attack", whose: "self" },
    ]);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("override_properties");
    if (action.kind === "override_properties") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.properties.actsAsGuidedNexusForOwnExhaustEffects).toBe(
        true
      );
    }
  });

  it("自分のアタックステップ+Lv2: 導界者ネクサス opt-in の継続効果が自分の actingPlayerId で登録される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "tenkai-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // Lv2 requiredCores: 1
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self],
    };
    const result = runEffect(state, card.effects![2]!, "tenkai-1", "alice");
    const ce = result.activeContinuousEffects.find(
      (c) =>
        c.sourceInstanceId === "tenkai-1" &&
        c.modifierTag === "override_properties"
    );
    expect(ce).toBeDefined();
    expect(ce?.actingPlayerId).toBe("alice");
    expect(
      (ce?.metadata?.properties as Record<string, unknown> | undefined)
        ?.actsAsGuidedNexusForOwnExhaustEffects
    ).toBe(true);
  });

  it("main から attack への通常ステップ遷移で effects[2] の CE を登録する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "tenkai-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // Lv2 requiredCores: 1
    });
    const state: GameState = {
      ...base,
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };

    const result = advanceStep(
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );

    expect(result.step).toBe("attack");
    const ce = result.activeContinuousEffects.find(
      (candidate) =>
        candidate.sourceInstanceId === "tenkai-1" &&
        candidate.provenance?.effectIndex === 2
    );
    expect(ce?.modifierTag).toBe("override_properties");
    expect(
      (ce?.metadata?.properties as Record<string, unknown> | undefined)
        ?.actsAsGuidedNexusForOwnExhaustEffects
    ).toBe(true);
  });

  it("attack から end への遷移で effects[2] の CE を失効させる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "tenkai-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // Lv2 requiredCores: 1
    });
    const mainState: GameState = {
      ...base,
      turnNumber: 2,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };
    const attackState = advanceStep(
      mainState,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(
      attackState.activeContinuousEffects.some(
        (candidate) => candidate.provenance?.effectIndex === 2
      )
    ).toBe(true);

    const endState = advanceStep(
      attackState,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );

    expect(endState.step).toBe("end");
    expect(
      endState.activeContinuousEffects.some(
        (candidate) => candidate.provenance?.effectIndex === 2
      )
    ).toBe(false);
  });
});

// ============================================================
// BSTH05.5-M01 緋想の剣・布都御魂（ブレイヴ）
// ============================================================
describe("BSTH05.5-M01 緋想の剣・布都御魂", () => {
  const card = cardNoMap.get("BSTH05.5-M01")!;

  it("braveCondition: 天人 & コスト6以上 & アルティメット", () => {
    expect(card.braveCondition).toEqual({
      categories: ["ultimate"],
      tribes: ["天人"],
      minCost: 6,
    });
  });

  it("effects は合体中の継続（超重装甲：∞、cost_destroy 防止不可付与）", () => {
    expect(card.effects?.length).toBe(2);
    expect(card.effects![0]!.applicability).toEqual({ combined: true });
    expect(card.effects![1]!.applicability).toEqual({ combined: true });
    expect(card.effects![0]!.stub).toBeUndefined();
    expect(card.effects![1]!.stub).toBeUndefined();
    expect(card.effects![1]!.timing).toEqual({ kind: "continuous" });
    expect(card.effects![1]!.timingScope).toEqual({
      player: "self",
      period: "attack",
    });
    const action = card.effects![1]!.steps[0]!.action;
    expect(action.kind).toBe("grant_effect_source_prevention_immunity");
    if (action.kind === "grant_effect_source_prevention_immunity") {
      expect(action.sourceScope).toEqual({
        effectClass: "cost_destroy",
        source: "combined_host",
      });
    }
  });

  it("Lv5 合体ホストの cost_destroy は防止不可付与で cannot_be_destroyed を貫通し、Lv4 では貫通しない", () => {
    const hostDef = cardNoMap.get("BSTH05.5-X01")!;
    const enemyDef = cardNoMap.get("BSSG01-C01")!;
    const buildState = (hostCores: number): GameState => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const host = createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: hostCores,
      });
      const brave = createCardInstance(card, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        attachedToInstanceId: "host-1",
      });
      const enemy = createCardInstance(enemyDef, {
        instanceId: "enemy-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      return {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        battleEntities: [
          {
            entityId: "host",
            memberInstanceIds: ["host-1", "brave-1"],
            attackState: "attacking",
            resolvedBp: 20000,
            resolvedSymbols: ["blue"],
          },
        ],
        cardInstances: [
          { ...host, attachedChildrenIds: ["brave-1"] },
          brave,
          enemy,
        ],
        activeContinuousEffects: [
          cannotLeaveCE("enemy-1", "cannot_be_destroyed", "bob"),
        ],
      };
    };

    const withGrantLv5 = executeEffect({
      chainId: "test:bsth05_5-cards:1096",
      state: buildState(4),
      effect: card.effects![1]!,
      sourceInstanceId: "brave-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const resultLv5 = executeEffect({
      chainId: "test:bsth05_5-cards:1103",
      state: withGrantLv5,
      effect: hostDef.effects![0]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(resultLv5, "enemy-1")).toBe(true);

    const withGrantLv4 = executeEffect({
      chainId: "test:bsth05_5-cards:1112",
      state: buildState(3),
      effect: card.effects![1]!,
      sourceInstanceId: "brave-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const resultLv4 = executeEffect({
      chainId: "test:bsth05_5-cards:1119",
      state: withGrantLv4,
      effect: hostDef.effects![0]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(resultLv4, "enemy-1")).toBe(false);
  });

  it("P3-150: Lv5 合体ホストの cost_destroy は防止不可付与で target lock(cannot_be_targeted) も貫通し、Lv4 では貫通しない", () => {
    const hostDef = cardNoMap.get("BSTH05.5-X01")!;
    const enemyDef = cardNoMap.get("BSSG01-C01")!;
    const buildState = (hostCores: number): GameState => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const host = createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: hostCores,
      });
      const brave = createCardInstance(card, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        attachedToInstanceId: "host-1",
      });
      const enemy = createCardInstance(enemyDef, {
        instanceId: "enemy-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      return {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        battleEntities: [
          {
            entityId: "host",
            memberInstanceIds: ["host-1", "brave-1"],
            attackState: "attacking",
            resolvedBp: 20000,
            resolvedSymbols: ["blue"],
          },
        ],
        cardInstances: [
          { ...host, attachedChildrenIds: ["brave-1"] },
          brave,
          enemy,
        ],
        activeContinuousEffects: [
          cannotLeaveCE("enemy-1", "cannot_be_targeted", "bob"),
        ],
      };
    };

    const withGrantLv5 = executeEffect({
      chainId: "test:bsth05_5-cards:1179",
      state: buildState(4),
      effect: card.effects![1]!,
      sourceInstanceId: "brave-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const resultLv5 = executeEffect({
      chainId: "test:bsth05_5-cards:1186",
      state: withGrantLv5,
      effect: hostDef.effects![0]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(resultLv5, "enemy-1")).toBe(true);

    const withGrantLv4 = executeEffect({
      chainId: "test:bsth05_5-cards:1195",
      state: buildState(3),
      effect: card.effects![1]!,
      sourceInstanceId: "brave-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const resultLv4 = executeEffect({
      chainId: "test:bsth05_5-cards:1202",
      state: withGrantLv4,
      effect: hostDef.effects![0]!,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(resultLv4, "enemy-1")).toBe(false);
  });
});

// ============================================================
// BSTH05.5-M02 リュウグウノツカイ（アルティメット）
// ============================================================
describe("BSTH05.5-M02 リュウグウノツカイ", () => {
  const card = cardNoMap.get("BSTH05.5-M02")!;
  const nexus = cardNoMap.get("BSTH05.5-X02")!; // 青の導界者ネクサス

  it("effects[0] 召喚時: コスト6以下破壊 + 導界者条件付きデッキ6破棄", () => {
    const e = card.effects![0]!;
    const destroy = e.steps[0]!.action;
    expect(destroy.kind).toBe("destroy");
    if (
      destroy.kind === "destroy" &&
      typeof destroy.target === "object" &&
      "filter" in destroy.target
    ) {
      expect(destroy.target.filter.maxCost).toBe(6);
    }
    expect(e.steps[1]!.connector).toBe("simultaneous");
    expect(e.steps[1]!.condition?.[0]?.kind).toBe("field_has");
  });

  it("effects[1] 相手の効果で破壊されない (effect_resistance destroy)", () => {
    const action = card.effects![1]!.steps[0]!.action;
    expect(action.kind).toBe("effect_resistance");
    if (action.kind === "effect_resistance") {
      expect(action.resistsOutcome).toBe("destroy");
      expect(action.source).toBe("opponent_effect");
    }
  });

  it("召喚時: コスト6以下の相手スピリットを破壊（導界者なし→デッキ破棄なし）", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "ryugu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    // 相手スピリット（コスト3）
    const enemy = createCardInstance(cardNoMap.get("BSTH05.5-C02")!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemy, ...buildDeck(card, "bob", 8)],
    };
    const result = runEffect(state, card.effects![0]!, "ryugu-1", "alice");
    // 破壊は pendingLeaveEntities に enqueue される（zone 移動は離脱解決で確定）
    const leave = result.pendingLeaveEntities.find(
      (e) => e.instanceId === "enemy-1"
    );
    expect(leave?.kind).toBe("destroy");
    // 導界者ネクサスがないのでデッキ破棄は発火しない
    const bobDeck = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "bob" && c.zone === "deck"
    );
    expect(bobDeck.length).toBe(8);
    expect(nexus).toBeDefined();
  });
});

// ============================================================
// BSTH05.5-M03 [緋想天]小野塚 小町（アルティメット, バースト）
// ============================================================
describe("BSTH05.5-M03 [緋想天]小野塚 小町", () => {
  const card = cardNoMap.get("BSTH05.5-M03")!;

  it("keywordTags に burst を持つ", () => {
    expect(card.keywordTags).toContain("burst");
  });

  it("effects[0] attack_after バーストで創界神/導界者コア6個ずつ→召喚 / effects[1] Lv4 アタック/ブロック時 消滅+条件付きデッキ破棄", () => {
    const burst = card.effects![0]!;
    expect(burst.stub).toBeUndefined();
    expect(burst.timing).toEqual({
      kind: "burst",
      trigger: { kind: "attack_finished", player: "opponent" },
      triggerFilter: { category: ["spirit", "ultimate"] },
    });
    expect(card.summonCondition).toEqual([
      { kind: "life_value", player: "self", min: 2 },
    ]);
    expect(burst.steps[0]!.action.kind).toBe("core_move");
    expect(burst.steps[1]!.action.kind).toBe("core_move");
    expect(burst.steps[2]!.action.kind).toBe("summon");
    if (
      burst.steps[0]!.action.kind === "core_move" &&
      burst.steps[1]!.action.kind === "core_move"
    ) {
      expect(burst.steps[0]!.action.target.filter).toMatchObject({
        category: ["nexus"],
        hasMechanic: ["grandwalker"],
        targetsGrandwalker: "only",
      });
      expect(burst.steps[1]!.action.target.filter).toMatchObject({
        category: ["nexus"],
        hasMechanic: ["guided"],
        targetsGrandwalker: "only",
      });
      expect(burst.steps[0]!.action.amount).toBe(6);
      expect(burst.steps[1]!.action.amount).toBe(6);
      expect(burst.steps[0]!.action.target.count).toBe(1);
      expect(burst.steps[1]!.action.target.count).toBe(1);
    }
    const e1 = card.effects![1]!;
    expect(e1.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    expect(e1.condition).toEqual([{ kind: "min_level", value: 4 }]);
    expect(e1.steps[0]!.action.kind).toBe("vanish");
  });

  function buildKomachiBurstState(
    targets: readonly ReturnType<typeof createCardInstance>[],
    attackerDefinition: CardDefinition = cardNoMap.get("BSTH05.5-C02")!
  ): GameState {
    const burstSource = createCardInstance(card, {
      instanceId: "komachi-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const attacker = createCardInstance(attackerDefinition, {
      instanceId: "bob-attacker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [burstSource, attacker, ...targets],
      playerOverrides: [
        { reserveNormalCoreCount: 4 },
        { voidNormalCoreCount: 20 },
      ],
    });
    return {
      ...before,
      activePlayerId: "bob",
      step: "attack",
      window: "none",
      activeAttack: {
        attackId: "attack-1",
        attackerInstanceId: "bob-attacker",
        defenderPlayerId: "alice",
        blockerInstanceId: null,
        cardEventChainId: null,
        windowState: "battle_resolution",
      },
      setBurstStates: [{ playerId: "alice", cardInstanceId: "komachi-burst" }],
      pendingBurstChecks: [
        {
          checkId: "komachi-attack-after",
          actingPlayerId: "alice",
          eventKind: "attack_after",
          source: "battle_resolution",
          chainId: "test:bsth05_5-cards:1374",
          attackId: "attack-1",
          relatedPlayerId: "bob",
          relatedInstanceId: "bob-attacker",
          amount: 0,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };
  }

  function getKomachiLegalActions(state: GameState, actingPlayerId: string) {
    return getLegalActions({
      state,
      actingPlayerId,
      getCardDefinitionById,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredMagicActions: noLookup,
    });
  }

  function applyKomachiAction(
    state: GameState,
    action: LegalAction,
    targetInstanceIds?: readonly string[]
  ): GameState {
    return applyLegalAction({
      state,
      action,
      ...(targetInstanceIds !== undefined ? { targetInstanceIds } : {}),
      ...(action.kind === "resolve_pending_multi_placement"
        ? {
            multiPlacementAllocations: state.pendingMultiPlacement!.targets.map(
              (target) => ({
                destinationInstanceId: target.instanceId,
                placements: [
                  {
                    kind: "reserve_normal" as const,
                    amount: target.minimumCoreCount,
                  },
                ],
              })
            ),
          }
        : {}),
      getCardDefinitionById,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredMagicActions: noLookup,
      getHandWrittenEffectResolver: noLookup,
    }).state;
  }

  function resolveKomachiBurst(
    initial: GameState,
    targetInstanceIds: readonly string[],
    expectedTargetGroups?: unknown
  ): GameState {
    const finishPlacement = (state: GameState) => {
      if (!state.pendingMultiPlacement) return state;
      const placement = getKomachiLegalActions(state, "alice").find(
        (a) => a.kind === "resolve_pending_multi_placement"
      );
      expect(placement).toBeDefined();
      return applyKomachiAction(state, placement!);
    };
    const declaration = getKomachiLegalActions(initial, "alice").find(
      (a): a is Extract<LegalAction, { kind: "resolve_pending_burst_check" }> =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "komachi-burst"
    );
    expect(declaration).toBeDefined();

    const afterDeclaration = applyKomachiAction(initial, declaration!);
    expect(afterDeclaration.stackWindow?.burstWindowKind).toBe("activation");

    const activationPass = getKomachiLegalActions(afterDeclaration, "bob").find(
      (a) => a.kind === "pass_stack"
    );
    expect(activationPass).toBeDefined();
    const afterActivationPass = applyKomachiAction(
      afterDeclaration,
      activationPass!
    );
    expect(afterActivationPass.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );

    const effectDeclarationPass = getKomachiLegalActions(
      afterActivationPass,
      "bob"
    ).find((a) => a.kind === "pass_stack");
    expect(effectDeclarationPass).toBeDefined();
    const afterEffectDeclarationPass = applyKomachiAction(
      afterActivationPass,
      effectDeclarationPass!
    );

    const pending = afterEffectDeclarationPass.pendingEffectTargetSelection;
    if (pending === null) {
      expect(targetInstanceIds).toHaveLength(0);
      return finishPlacement(afterEffectDeclarationPass);
    }
    if (expectedTargetGroups !== undefined) {
      expect(pending.targetGroups).toEqual(expectedTargetGroups);
    }
    const resolveTargets = getKomachiLegalActions(
      afterEffectDeclarationPass,
      "alice"
    ).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTargets).toBeDefined();
    return finishPlacement(
      applyKomachiAction(
        afterEffectDeclarationPass,
        resolveTargets!,
        targetInstanceIds
      )
    );
  }

  it("バースト実行: 選んだ創界神/導界者から6個ずつボイドへ置き、自身を召喚する", () => {
    const grandwalker = createCardInstance(cardNoMap.get("BSLH01-X02")!, {
      instanceId: "bob-grandwalker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 8,
    });
    const iku = createCardInstance(cardNoMap.get("BSTH05.5-X02")!, {
      instanceId: "bob-iku",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 7,
    });
    const initial = buildKomachiBurstState([grandwalker, iku]);

    const afterEffectDeclarationPass = resolveKomachiBurst(
      initial,
      ["bob-grandwalker", "bob-iku"],
      [
        expect.objectContaining({
          requiredTargetCount: 1,
          targetStepId: "__step_0",
          candidateTargetInstanceIds: ["bob-grandwalker"],
        }),
        expect.objectContaining({
          requiredTargetCount: 1,
          targetStepId: "__step_1",
          candidateTargetInstanceIds: ["bob-iku"],
        }),
      ]
    );

    expect(
      afterEffectDeclarationPass.cardInstances.find(
        (x) => x.instanceId === "bob-grandwalker"
      )?.normalCoreCount
    ).toBe(2);
    expect(
      afterEffectDeclarationPass.cardInstances.find(
        (x) => x.instanceId === "bob-iku"
      )?.normalCoreCount
    ).toBe(1);
    expect(
      afterEffectDeclarationPass.players.find((player) => player.id === "bob")
        ?.voidNormalCoreCount
    ).toBe(32);
    expect(
      afterEffectDeclarationPass.cardInstances.find(
        (x) => x.instanceId === "komachi-burst"
      )?.zone
    ).toBe("field");
    expect(
      afterEffectDeclarationPass.cardInstances.find(
        (x) => x.instanceId === "komachi-burst"
      )?.normalCoreCount
    ).toBe(1);
    expect(
      afterEffectDeclarationPass.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(3);
  });

  it("バースト実行: 導界者だけでも可能なコア移動後に自身を召喚する", () => {
    const iku = createCardInstance(cardNoMap.get("BSTH05.5-X02")!, {
      instanceId: "bob-iku",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 7,
    });
    const initial = buildKomachiBurstState([iku]);
    const after = resolveKomachiBurst(initial, ["bob-iku"]);

    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-iku")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      after.players.find((player) => player.id === "bob")?.voidNormalCoreCount
    ).toBe(26);
    expect(
      after.cardInstances.find((x) => x.instanceId === "komachi-burst")?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((x) => x.instanceId === "komachi-burst")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      after.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(3);
  });

  it("バースト実行: 創界神/導界者を兼ねる1個は両枠の対象としてコアを置く", () => {
    const dual = createCardInstance(cardNoMap.get("BSTH05.5-XX01")!, {
      instanceId: "bob-dual",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 8,
    });
    const initial = buildKomachiBurstState([dual]);

    const after = resolveKomachiBurst(
      initial,
      ["bob-dual", "bob-dual"],
      [
        expect.objectContaining({
          requiredTargetCount: 1,
          targetStepId: "__step_0",
          candidateTargetInstanceIds: ["bob-dual"],
        }),
        expect.objectContaining({
          requiredTargetCount: 1,
          targetStepId: "__step_1",
          candidateTargetInstanceIds: ["bob-dual"],
        }),
      ]
    );

    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-dual")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      after.players.find((player) => player.id === "bob")?.voidNormalCoreCount
    ).toBe(28);
    expect(
      after.cardInstances.find((x) => x.instanceId === "komachi-burst")?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((x) => x.instanceId === "komachi-burst")
        ?.normalCoreCount
    ).toBe(1);
  });

  it("バースト実行: 創界神/導界者がなくても「その後」の自身召喚は続く", () => {
    const initial = buildKomachiBurstState([]);
    const after = resolveKomachiBurst(initial, []);

    expect(
      after.players.find((player) => player.id === "bob")?.voidNormalCoreCount
    ).toBe(20);
    expect(
      after.cardInstances.find((x) => x.instanceId === "komachi-burst")?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((x) => x.instanceId === "komachi-burst")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      after.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(3);
  });

  it("バースト発動条件: 相手のブレイヴのアタック後では発動候補にならない", () => {
    const initial = buildKomachiBurstState([], cardNoMap.get("BSTH05.5-M01")!);
    const declaration = getKomachiLegalActions(initial, "alice").find(
      (a): a is Extract<LegalAction, { kind: "resolve_pending_burst_check" }> =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "komachi-burst"
    );
    expect(declaration).toBeUndefined();
  });

  it("バースト実行: 自分のライフ2未満なら召喚条件で自身召喚しない", () => {
    const grandwalker = createCardInstance(cardNoMap.get("BSLH01-X02")!, {
      instanceId: "bob-grandwalker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 8,
    });
    const base = buildKomachiBurstState([grandwalker]);
    const initial = {
      ...base,
      activeContinuousEffects: [
        {
          effectId: "komachi-loss-immunity",
          sourceInstanceId: "komachi-burst",
          sourceDefinitionId: "BSTH05.5-M03",
          actingPlayerId: "alice",
          targetInstanceId: "alice",
          modifierTag: "immune_to_game_loss" as const,
          duration: { scope: "turn" as const },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
        },
      ],
      players: base.players.map((player) =>
        player.id === "alice" ? { ...player, lifeNormalCoreCount: 0 } : player
      ),
    };

    const after = resolveKomachiBurst(initial, ["bob-grandwalker"]);

    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-grandwalker")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      after.cardInstances.find((x) => x.instanceId === "komachi-burst")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((x) => x.instanceId === "komachi-burst")
        ?.normalCoreCount
    ).toBe(0);
    expect(
      after.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(4);
    expect(after.log).toContain(
      "effect:summon:komachi-burst:summon-condition-failed"
    );
  });

  it("バースト解決は対象選択待ちで2つの必須targetGroupを提示する", () => {
    const grandwalker = createCardInstance(cardNoMap.get("BSLH01-X02")!, {
      instanceId: "bob-grandwalker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 8,
    });
    const iku = createCardInstance(cardNoMap.get("BSTH05.5-X02")!, {
      instanceId: "bob-iku",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 7,
    });
    const initial = buildKomachiBurstState([grandwalker, iku]);
    const declaration = getKomachiLegalActions(initial, "alice").find(
      (a): a is Extract<LegalAction, { kind: "resolve_pending_burst_check" }> =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "komachi-burst"
    );
    expect(declaration).toBeDefined();
    const afterDeclaration = applyKomachiAction(initial, declaration!);
    const activationPass = getKomachiLegalActions(afterDeclaration, "bob").find(
      (a) => a.kind === "pass_stack"
    );
    const afterActivationPass = applyKomachiAction(
      afterDeclaration,
      activationPass!
    );
    const effectDeclarationPass = getKomachiLegalActions(
      afterActivationPass,
      "bob"
    ).find((a) => a.kind === "pass_stack");
    const afterEffectDeclarationPass = applyKomachiAction(
      afterActivationPass,
      effectDeclarationPass!
    );
    const pending = afterEffectDeclarationPass.pendingEffectTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.targetGroups).toEqual([
      expect.objectContaining({
        requiredTargetCount: 1,
        targetStepId: "__step_0",
        candidateTargetInstanceIds: ["bob-grandwalker"],
      }),
      expect.objectContaining({
        requiredTargetCount: 1,
        targetStepId: "__step_1",
        candidateTargetInstanceIds: ["bob-iku"],
      }),
    ]);

    const resolveTargets = getKomachiLegalActions(
      afterEffectDeclarationPass,
      "alice"
    ).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTargets).toBeDefined();
    expect(() =>
      applyKomachiAction(afterEffectDeclarationPass, resolveTargets!, [])
    ).toThrow();
  });

  it("Lv4 効果実行: 相手スピリットが消滅しコアがリザーブへ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "komachi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const enemy = createCardInstance(cardNoMap.get("BSTH05.5-C02")!, {
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
    const result = runEffect(state, card.effects![1]!, "komachi-1", "alice");
    // 消滅は pendingLeaveEntities に enqueue される（コアのリザーブ移動も離脱解決で確定）
    const leave = result.pendingLeaveEntities.find(
      (e) => e.instanceId === "enemy-1"
    );
    expect(leave).toBeDefined();
  });
});

// ============================================================
// BSTH05.5-M04 [緋想天]射命丸 文（アルティメット, バースト）
// ============================================================
describe("BSTH05.5-M04 [緋想天]射命丸 文", () => {
  const card = cardNoMap.get("BSTH05.5-M04")!;

  it("青の導界者がある召喚/アタック時はデッキ上4枚をremoved_from_gameへ直接除外しtrashとvoidへ置かない", () => {
    const self = createCardInstance(card, {
      instanceId: "aya-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const guided = createCardInstance(cardNoMap.get("BSTH05.5-X02")!, {
      instanceId: "iku-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const enemy = createCardInstance(cardNoMap.get("BSTH05.5-C02")!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, guided, enemy, ...buildDeck(card, "bob", 5)],
    };
    const action = card.effects![2]!.steps[1]!.action;
    expect(action).toMatchObject({
      kind: "move_card",
      from: { zone: "deck", player: "opponent", position: "top" },
      to: { zone: "removed_from_game" },
      count: 4,
    });
    expect(action).not.toHaveProperty("deckDiscard");
    const result = runEffect(state, card.effects![2]!, "aya-1", "alice");
    expect(
      result.cardInstances
        .filter((c) => c.zone === "removed_from_game")
        .map((c) => c.instanceId)
    ).toEqual(["bob-deck-1", "bob-deck-2", "bob-deck-3", "bob-deck-4"]);
    expect(
      result.cardInstances
        .filter((c) => c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["bob-deck-5"]);
    expect(
      result.cardInstances.filter(
        (c) => c.zone === "trash" || c.zone === "void"
      )
    ).toEqual([]);
    expect(
      result.cardInstances.find((c) => c.instanceId === "enemy-1")!.exhaustState
    ).toBe("heavily_exhausted");

    const withoutGuided = runEffect(
      {
        ...state,
        cardInstances: state.cardInstances.filter(
          (c) => c.instanceId !== "iku-1"
        ),
      },
      card.effects![2]!,
      "aya-1",
      "alice"
    );
    expect(
      withoutGuided.cardInstances.filter((c) => c.zone === "deck")
    ).toHaveLength(5);
    expect(
      withoutGuided.cardInstances.filter(
        (c) =>
          c.zone === "removed_from_game" ||
          c.zone === "void" ||
          c.zone === "trash"
      )
    ).toEqual([]);
  });

  it("effects[1] バースト(ライフ減少後)召喚 / effects[2] 召喚/アタック時 重疲労", () => {
    expect(card.effects![1]!.timing).toEqual({
      kind: "burst",
      trigger: { kind: "life_decrease", player: "self" },
    });
    const e2 = card.effects![2]!;
    expect(e2.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack"],
    });
    const exhaust = e2.steps[0]!.action;
    expect(exhaust.kind).toBe("exhaust");
    if (exhaust.kind === "exhaust") {
      expect(exhaust.degree).toBe("heavy_exhaust");
    }
  });

  it("召喚/アタック時: 相手スピリットが重疲労する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "aya-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(cardNoMap.get("BSTH05.5-C02")!, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "recovered",
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, enemy],
    };
    const result = runEffect(state, card.effects![2]!, "aya-1", "alice");
    const enemyAfter = result.cardInstances.find(
      (c) => c.instanceId === "enemy-1"
    )!;
    expect(enemyAfter.exhaustState).toBe("heavily_exhausted");
  });
});

// ============================================================
// BSTH05.5-R10 気符「無念無想の境地」（マジック）
// ============================================================
describe("BSTH05.5-R10 気符「無念無想の境地」", () => {
  const card = cardNoMap.get("BSTH05.5-R10")!;

  it("effects[0] 系統付与 (幻想/緋想) / [1] 青の効果 revealed+trash 自己回収 / [2] flash stub", () => {
    expect(card.effects?.length).toBe(3);
    const action = card.effects![0]!.steps[0]!.action;
    expect(action.kind).toBe("override_properties");
    if (action.kind === "override_properties") {
      expect(action.properties.addTribes).toEqual(["幻想", "緋想"]);
    }
    expect(card.effects![1]!.timing).toEqual({
      kind: "card_event",
      event: ["revealed", "moved_to_trash"],
    });
    expect(card.effects![1]!.stub).toBeUndefined();
    // ruling C (2026-06-24): findMovedToTrashAutoEffect の default が mandatory のため
    // 可能形「加えられ」効果は executionMode:"optional" を明示しないと強制 add_to_hand に。
    expect(card.effects![1]!.executionMode).toBe("optional");
    expect(card.effects![1]!.condition).toEqual([
      { kind: "trigger_colors", colors: ["blue"] },
      { kind: "trigger_from_zone", zones: ["deck"] },
    ]);
    const bonusAction = card.effects![1]!.steps[1]!.action;
    expect(bonusAction.kind).toBe("core_move");
    if (bonusAction.kind === "core_move") {
      expect(bonusAction.from).toEqual({ kind: "void", player: "self" });
      expect(bonusAction.to).toEqual({
        kind: "field_card",
        player: "self",
        filter: { category: ["nexus"], tribes: ["導界者"], colors: ["blue"] },
      });
    }
    expect(card.effects![2]!.timing).toEqual({
      kind: "activated",
      mode: "flash",
    });
    // [2] フラッシュ「効果記述を持つ相手のアタックではライフは1以下にならない」=
    // life_damage_interception(floor:2)+attackerFilter（条件付きライフ下限保護）を実装。
    expect(card.effects![2]!.stub).toBeUndefined();
    const flashAction = card.effects![2]!.steps[0]!.action;
    expect(flashAction.kind).toBe("life_damage_interception");
    if (flashAction.kind === "life_damage_interception") {
      expect(flashAction.mode).toBe("floor");
      expect(flashAction.floor).toBe(2);
      expect(flashAction.attackerFilter).toEqual({
        category: ["spirit", "ultimate"],
        hasEffectText: true,
      });
    }
  });
});

// ============================================================
// BSTH05.5-X01 比那名居 天子（アルティメット）
// ============================================================
describe("BSTH05.5-X01 比那名居 天子", () => {
  const card = cardNoMap.get("BSTH05.5-X01")!;

  it("effects[0] Lv4 アタック時 コスト以下破壊 + 条件付きデッキ10破棄", () => {
    const e = card.effects![0]!;
    expect(e.condition).toEqual([{ kind: "min_level", value: 4 }]);
    const destroy = e.steps[0]!.action;
    if (
      destroy.kind === "destroy" &&
      typeof destroy.target === "object" &&
      "filter" in destroy.target
    ) {
      expect(destroy.target.filter.maxCostSource).toBe("self_effective_cost");
    }
    const deck = e.steps[1]!.action;
    expect(deck.kind).toBe("move_card");
    if (deck.kind === "move_card") expect(deck.count).toBe(10);
  });

  it("effects[1] Lv5 合体中: 自分の青の導界者ネクサス1つを疲労コストにターン2回まで回復", () => {
    const e = card.effects![1]!;
    expect(e.condition).toContainEqual({
      kind: "combined_guest_tribes",
      tribes: ["緋想"],
    });
    expect(e.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 2,
    });
    const cost = e.steps[0]!.action;
    expect(cost.kind).toBe("set_exhaust_state");
    if (
      cost.kind === "set_exhaust_state" &&
      typeof cost.target === "object" &&
      "filter" in cost.target
    ) {
      expect(cost.target.player).toBe("self");
      expect(cost.target.filter.targetsGrandwalker).toBe("only");
      expect(cost.target.filter.grandwalkerKind).toBe("guided");
      expect(cost.target.filter.includesGrandwalkerExhaustOptIn).toBe(true);
    }
    const recover = e.steps[1]!;
    expect(recover.action.kind).toBe("recover");
    expect(recover.connector).toBe("conditional_cost");
  });

  it("combined_guest_tribes: 系統「緋想」を持つブレイヴ(「緋想の剣・布都御魂」)との合体中は条件成立する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const braveDef = cardNoMap.get("BSTH05.5-M01")!;
    expect(getEffectiveTribes(base, undefined, braveDef)).toContain("緋想");
    const selfCard = createCardInstance(card, {
      instanceId: "tenshi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const braveCard = createCardInstance(braveDef, {
      instanceId: "brave-hifuu",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      attachedToInstanceId: "tenshi-1",
    });
    const state: GameState = {
      ...base,
      cardInstances: [selfCard, braveCard],
    };
    expect(
      evaluateConditionClause(
        state,
        { kind: "combined_guest_tribes", tribes: ["緋想"] },
        "tenshi-1",
        "alice",
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("combined_guest_tribes: 系統「緋想」を持たないカードとの合体中/非合体中は条件不成立", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const otherDef = cardNoMap.get("BSTH05.5-M02")!; // tribe: "天渡・竜渡・異合"（緋想なし）
    expect(getEffectiveTribes(base, undefined, otherDef)).not.toContain("緋想");
    const selfCard = createCardInstance(card, {
      instanceId: "tenshi-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const otherCard = createCardInstance(otherDef, {
      instanceId: "guest-non-hifuu",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      attachedToInstanceId: "tenshi-2",
    });
    const stateWithWrongTribeGuest: GameState = {
      ...base,
      cardInstances: [selfCard, otherCard],
    };
    expect(
      evaluateConditionClause(
        stateWithWrongTribeGuest,
        { kind: "combined_guest_tribes", tribes: ["緋想"] },
        "tenshi-2",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
    const stateWithNoGuest: GameState = {
      ...base,
      cardInstances: [selfCard],
    };
    expect(
      evaluateConditionClause(
        stateWithNoGuest,
        { kind: "combined_guest_tribes", tribes: ["緋想"] },
        "tenshi-2",
        "alice",
        getCardDefinitionById
      )
    ).toBe(false);
  });

  it("Lv5 合体中: BSTH05.5-C20 (opt-in中の導界者ネクサス扱い) を疲労させて自身を回復できる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const tenkaiDef = cardNoMap.get("BSTH05.5-C20")!;
    const braveDef = cardNoMap.get("BSTH05.5-M01")!;
    const selfCard = createCardInstance(card, {
      instanceId: "tenshi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4, // Lv5 requiredCores: 4
      exhaustState: "exhausted",
    });
    const braveCard = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      attachedToInstanceId: "tenshi-1",
    });
    const nexusCard = createCardInstance(tenkaiDef, {
      instanceId: "tenkai-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1, // Lv2 requiredCores: 1
    });
    const selfHost = {
      ...selfCard,
      attachedChildrenIds: [braveCard.instanceId],
    };
    const baseState: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [selfHost, braveCard, nexusCard],
    };
    // BSTH05.5-C20 effects[2] (継続効果) を先に発揮させ、opt-in CE を登録する
    // (continuous-effect-rebuild の live 再評価と等価。addTribes 系 precedent と同型)。
    const withOptIn = runEffect(
      baseState,
      tenkaiDef.effects![2]!,
      "tenkai-1",
      "alice"
    );
    const result = executeEffect({
      chainId: "test:bsth05_5-cards:2097",
      state: withOptIn,
      effect: card.effects![1]!,
      sourceInstanceId: "tenshi-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions,
      targetInstanceIds: ["tenkai-1"],
    });
    const nexusAfter = result.cardInstances.find(
      (c) => c.instanceId === "tenkai-1"
    )!;
    expect(nexusAfter.exhaustState).toBe("exhausted");
    const selfAfter = result.cardInstances.find(
      (c) => c.instanceId === "tenshi-1"
    )!;
    expect(selfAfter.exhaustState).toBe("recovered");
  });

  it("Lv4 アタック時: コスト8以下の相手アルティメットを破壊", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(card, {
      instanceId: "tenshi-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const enemy = createCardInstance(cardNoMap.get("BSTH05.5-M02")!, {
      instanceId: "enemy-ult",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [self, enemy, ...buildDeck(card, "bob", 12)],
    };
    const result = runEffect(state, card.effects![0]!, "tenshi-1", "alice");
    const leave = result.pendingLeaveEntities.find(
      (e) => e.instanceId === "enemy-ult"
    );
    expect(leave?.kind).toBe("destroy");
  });
});

// ============================================================
// BSTH05.5-X02 [導界者]永江 衣玖（ネクサス）
// ============================================================
describe("BSTH05.5-X02 [導界者]永江 衣玖", () => {
  const card = cardNoMap.get("BSTH05.5-X02")!;

  it("シンボル treat_as (青/究極) を持つ", () => {
    const symEffect = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const colors = symEffect.steps
      .map((s) => (s.action.kind === "treat_as" ? s.action.asColor : null))
      .filter(Boolean);
    expect(colors).toEqual(["blue", "ultimate_symbol"]);
  });

  it("grandwalkerData: guided + 導託2条件 + 標準 placementOracle + コア配置禁止タグ", () => {
    const gw = card.grandwalkerData!;
    expect(gw.kind).toBe("guided");
    expect(gw.alsoCountsAs).toBeUndefined();
    expect(gw.oracleConditions).toEqual([
      { tribes: ["緋想", "竜渡"], minCost: 3, categories: ["spirit"] },
      { tribes: ["緋想", "竜渡"], categories: ["ultimate"] },
    ]);
    // 配置時神託は標準文（対象カード1枚につきコア+1）→ placementOracle 省略
    expect(gw.placementOracle).toBeUndefined();
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
  });

  it("stub は無い（導域は redirect_deck_discard_to_exclude で表現、導技は divineSkills 経路）", () => {
    const stubs = card.effects!.filter((e) => e.stub);
    expect(stubs.length).toBe(0);
  });

  it("Lv2【導域】: redirect_deck_discard_to_exclude(opponent) を自分のアタックステップ限定で持つ", () => {
    const eff = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "redirect_deck_discard_to_exclude"
    )!;
    expect(eff).toBeDefined();
    expect(eff.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(eff.timingScope).toEqual({ player: "self", period: "attack" });
    const action = eff.steps[0]!.action;
    expect(
      action.kind === "redirect_deck_discard_to_exclude" && action.player
    ).toBe("opponent");
  });

  it("tribe に 導界者 を持つ（field_has tribes 判定の基盤）", () => {
    expect(card.tribe).toContain("導界者");
  });

  describe("divineSkills[0] 【導技：3】フラッシュ『お互いのアタックステップ』二択破壊", () => {
    const skill = card.grandwalkerData!.divineSkills![0]!;

    it("構造: guided_skill / coreCost3 / step:attack whose:both / Lv1-2 / 二択 destroy", () => {
      expect(skill.label).toBe("guided_skill");
      expect(skill.coreCost).toBe(3);
      expect(skill.timing).toEqual({
        step: "attack",
        whose: "both",
        mode: "flash",
      });
      expect(skill.minLevel).toBe(1);
      expect(skill.maxLevel).toBe(2);
      const step = skill.effects[0]!.steps[0]!;
      expect(step.action.kind).toBe("destroy");
      if (step.action.kind !== "destroy") throw new Error("expected destroy");
      if (step.action.target.kind !== "filter")
        throw new Error("expected filter target");
      expect(step.action.target.filter).toEqual({
        category: ["spirit", "ultimate"],
        extremal: { metric: "cost", mode: "lowest" },
      });
      expect(step.choice).toHaveLength(1);
      const altAction = step.choice![0]!.action;
      expect(altAction.kind).toBe("destroy");
      if (altAction.kind !== "destroy") throw new Error("expected destroy");
      if (altAction.target.kind !== "filter")
        throw new Error("expected filter target");
      expect(altAction.target.filter).toEqual({ category: ["nexus"] });
    });

    const ALICE = "alice";
    const BOB = "bob";
    const OPP_CHEAP: CardDefinition = {
      cardNo: "TEST-BSTH05.5-X02-OPP-CHEAP",
      name: "安いテスト相手スピリット",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 2,
      reductionSymbols: ["blue"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
      symbolColors: ["blue"],
      tribe: "無関係",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const OPP_EXPENSIVE: CardDefinition = {
      ...OPP_CHEAP,
      cardNo: "TEST-BSTH05.5-X02-OPP-EXPENSIVE",
      name: "高いテスト相手スピリット",
      cost: 5,
    };
    const OPP_NEXUS: CardDefinition = {
      cardNo: "TEST-BSTH05.5-X02-OPP-NEXUS",
      name: "テスト相手ネクサス",
      printedCategory: "nexus",
      colors: ["blue"],
      cost: 1,
      reductionSymbols: ["blue"],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["blue"],
      tribe: "無関係",
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defMap = new Map<string, CardDefinition>([
      [card.cardNo, card],
      [OPP_CHEAP.cardNo, OPP_CHEAP],
      [OPP_EXPENSIVE.cardNo, OPP_EXPENSIVE],
      [OPP_NEXUS.cardNo, OPP_NEXUS],
    ]);
    const defLookup = (id: string) =>
      defMap.get(id) ?? getCardDefinitionById(id);

    function baseState(): GameState {
      return divineSkillFlashPosition(
        {
          ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
          activePlayerId: ALICE,
          step: "attack",
          cardInstances: [
            createCardInstance(card, {
              instanceId: "iku-1",
              ownerPlayerId: ALICE,
              zone: "field",
              zoneRoleName: "nexus",
              normalCoreCount: 3,
            }),
            createCardInstance(OPP_CHEAP, {
              instanceId: "opp-cheap-1",
              ownerPlayerId: BOB,
              zone: "field",
            }),
            createCardInstance(OPP_EXPENSIVE, {
              instanceId: "opp-expensive-1",
              ownerPlayerId: BOB,
              zone: "field",
            }),
            createCardInstance(OPP_NEXUS, {
              instanceId: "opp-nexus-1",
              ownerPlayerId: BOB,
              zone: "field",
              zoneRoleName: "nexus",
            }),
          ],
        } as GameState,
        ALICE
      );
    }

    function resolveDivineSkillStackWindow(state: GameState): GameState {
      let current = state;
      let guard = 0;
      while (
        (current.stackWindow ||
          current.activeAttack?.flashWindowState?.pendingStackAction) &&
        guard++ < 10
      ) {
        const responderId = (
          current.stackWindow ?? current.activeAttack!.flashWindowState!
        ).priorityPlayerId;
        const actions = getLegalActions({
          state: current,
          actingPlayerId: responderId,
          getCardDefinitionById: defLookup,
          getRegisteredFieldCardEffectActions: () => [],
          getRegisteredBurstActions,
        });
        const pass = actions.find(
          (a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash"
        );
        expect(pass).toBeDefined();
        current = (
          applyLegalAction({
            state: current,
            action: pass!,
            getCardDefinitionById: defLookup,
          }) as { state: GameState }
        ).state;
      }
      return current;
    }

    // destroy の leave_field は bob 側の pendingBurstChecks (バースト起動可否確認) を
    // 経由して初めて cardInstances から確定除去される。テスト用カードは burst 未定義
    // なので、選択肢無しの check を解決するだけで良い。
    function drainPendingBurstChecks(state: GameState): GameState {
      let current = state;
      let guard = 0;
      while (guard++ < 10) {
        const bobActions = getLegalActions({
          state: current,
          actingPlayerId: BOB,
          getCardDefinitionById: defLookup,
          getRegisteredFieldCardEffectActions: () => [],
          getRegisteredBurstActions,
        });
        const burstCheck = bobActions.find(
          (a) => a.kind === "resolve_pending_burst_check"
        );
        if (!burstCheck) break;
        current = (
          applyLegalAction({
            state: current,
            action: burstCheck,
            getCardDefinitionById: defLookup,
          }) as { state: GameState }
        ).state;
      }
      return current;
    }

    it("legal action は神技発揮1件だけで、choice はスタック後 pending へ回る", () => {
      const actions = getLegalActions({
        state: baseState(),
        actingPlayerId: ALICE,
        getCardDefinitionById: defLookup,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredBurstActions,
      });
      const divineSkillActions = actions.filter(
        (a): a is LegalAction & { kind: "use_divine_skill" } =>
          a.kind === "use_divine_skill"
      );
      expect(divineSkillActions).toHaveLength(1);
    });

    it("スタック後 choiceIndex:0 (デフォルト) → 最もコストの低い相手スピリットを破壊、ネクサスは残る", () => {
      const state = baseState();
      const actions = getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: defLookup,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredBurstActions,
      });
      const declareAction = actions.find((a) => a.kind === "use_divine_skill")!;
      expect(declareAction).toBeDefined();
      let current = (
        applyLegalAction({
          state,
          action: declareAction,
          getCardDefinitionById: defLookup,
        }) as { state: GameState }
      ).state;
      current = resolveDivineSkillStackWindow(current);

      const choiceActions = getLegalActions({
        state: current,
        actingPlayerId: ALICE,
        getCardDefinitionById: defLookup,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredBurstActions,
      });
      const defaultChoice = choiceActions.find(
        (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === 0
      )!;
      current = (
        applyLegalAction({
          state: current,
          action: defaultChoice,
          getCardDefinitionById: defLookup,
          getRegisteredBurstActions,
        }) as { state: GameState }
      ).state;
      current = drainPendingBurstChecks(current);

      const remaining = current.cardInstances
        .filter((c) => c.zone === "field")
        .map((c) => c.instanceId);
      expect(remaining).not.toContain("opp-cheap-1");
      expect(remaining).toContain("opp-expensive-1");
      expect(remaining).toContain("opp-nexus-1");
    });

    it("スタック後 choiceIndex:1 (または) → 相手ネクサスを破壊、スピリットは残る", () => {
      const state = baseState();
      const actions = getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: defLookup,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredBurstActions,
      });
      const declareAction = actions.find((a) => a.kind === "use_divine_skill")!;
      expect(declareAction).toBeDefined();
      let current = (
        applyLegalAction({
          state,
          action: declareAction,
          getCardDefinitionById: defLookup,
        }) as { state: GameState }
      ).state;
      current = resolveDivineSkillStackWindow(current);

      const choiceActions = getLegalActions({
        state: current,
        actingPlayerId: ALICE,
        getCardDefinitionById: defLookup,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredBurstActions,
      });
      const nexusChoice = choiceActions.find(
        (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === 1
      )!;
      current = (
        applyLegalAction({
          state: current,
          action: nexusChoice,
          getCardDefinitionById: defLookup,
          getRegisteredBurstActions,
        }) as { state: GameState }
      ).state;
      current = drainPendingBurstChecks(current);

      const remaining = current.cardInstances
        .filter((c) => c.zone === "field")
        .map((c) => c.instanceId);
      expect(remaining).not.toContain("opp-nexus-1");
      expect(remaining).toContain("opp-cheap-1");
      expect(remaining).toContain("opp-expensive-1");
    });
  });
});

// ============================================================
// BSTH05.5-XX01 龍神（創界神/導界者ネクサス）
// ============================================================
describe("BSTH05.5-XX01 龍神", () => {
  const card = cardNoMap.get("BSTH05.5-XX01")!;

  it("シンボル treat_as を 8 色（赤/紫/緑/白/黄/青/究極/導）持つ", () => {
    const symEffect = card.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    const colors = symEffect.steps
      .map((s) => (s.action.kind === "treat_as" ? s.action.asColor : null))
      .filter(Boolean);
    expect(colors).toEqual([
      "red",
      "purple",
      "green",
      "white",
      "yellow",
      "blue",
      "ultimate_symbol",
      "guide",
    ]);
  });

  it("grandwalkerData: 創界神+導界者の両タイプ / 神託2条件 / 標準 placementOracle 無効化", () => {
    const gw = card.grandwalkerData!;
    expect(gw.kind).toBe("grandwalker");
    expect(gw.alsoCountsAs).toBe("guided");
    expect(gw.oracleConditions).toEqual([
      { tribes: ["竜渡", "博麗", "賢者", "幻想"], categories: ["ultimate"] },
      { categories: ["nexus"], hasMechanic: ["guided"] },
    ]);
    // 配置時神託は「その中のカード1枚につき」（対象限定なし）の独自亜種
    // → 標準 placementOracle（対象カードのみ計数）を無効化し card_event:place の DSL で実装
    expect(gw.placementOracle).toBe(false);
    expect(card.keywordTags).toContain("enter_field_core_placement_forbidden");
  });

  it("配置時神託（独自亜種）: デッキ上3枚トラッシュ→対象でないカードでも1枚につきコア1個", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 10,
    });
    const ryujin = createCardInstance(card, {
      instanceId: "ryujin-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    // 神託対象外（緋想スピリット）のデッキ5枚
    const deck = buildDeck(cardNoMap.get("BSTH05.5-C02")!, "alice", 5);
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [ryujin, ...deck],
    };
    const placeEffect = card.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "place"
    )!;
    const result = executeEffect({
      chainId: "test:bsth05_5-cards:2548",
      state,
      effect: placeEffect,
      sourceInstanceId: "ryujin-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const trash = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "trash"
    );
    const deckAfter = result.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "deck"
    );
    expect(trash.length).toBe(3);
    expect(deckAfter.length).toBe(2);
    // 神託対象でないカード3枚でもコア3個（「カード1枚につき」）
    const gwAfter = result.cardInstances.find(
      (c) => c.instanceId === "ryujin-1"
    )!;
    expect(gwAfter.normalCoreCount).toBe(3);
    expect(
      result.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(7);
  });

  it("配置時神託: 同じカード名の自分の創界神ネクサスが既にいると発揮されない", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 10,
    });
    const ryujin1 = createCardInstance(card, {
      instanceId: "ryujin-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const ryujin2 = createCardInstance(card, {
      instanceId: "ryujin-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const deck = buildDeck(cardNoMap.get("BSTH05.5-C02")!, "alice", 5);
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [ryujin1, ryujin2, ...deck],
    };
    const placeEffect = card.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "place"
    )!;
    const result = executeEffect({
      chainId: "test:bsth05_5-cards:2600",
      state,
      effect: placeEffect,
      sourceInstanceId: "ryujin-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.filter(
        (c) => c.ownerPlayerId === "alice" && c.zone === "deck"
      ).length
    ).toBe(5);
    expect(
      result.cardInstances.find((c) => c.instanceId === "ryujin-1")!
        .normalCoreCount
    ).toBe(0);
  });

  it("【神技：2】は divineSkills(coreCost:2, ターン2回) + deck_reveal（2枚見て1枚まで手札）", () => {
    const skill = card.grandwalkerData!.divineSkills![0]!;
    expect(skill.coreCost).toBe(2);
    expect(skill.timing).toBe("main");
    expect(skill.turnLimit).toBe("once");
    expect(skill.maxUsesPerTurn).toBe(2); // ターンに2回
    // 本体 effect はコスト後の deck_reveal のみ（core_move コストは持たない）。
    const reveal = skill.effects![0]!.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(2);
      expect(reveal.picks).toEqual([{ count: 1 }]);
      expect(reveal.revealTo).toBe("self");
      expect(reveal.remainder).toBe("top_bottom_split");
    }
    // effects[] 側に activated の神技は残っていない。
    expect(card.effects!.some((e) => e.timing.kind === "activated")).toBe(
      false
    );
  });

  it("神技本体実行: pendingDeckReveal が生成される（コア消費はエンジン側）", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ryujin = createCardInstance(card, {
      instanceId: "ryujin-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const deck = buildDeck(cardNoMap.get("BSTH05.5-C02")!, "alice", 5);
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [ryujin, ...deck],
    };
    const skill = card.grandwalkerData!.divineSkills![0]!;
    const result = executeEffect({
      chainId: "test:bsth05_5-cards:2656",
      state,
      effect: skill.effects![0]!,
      sourceInstanceId: "ryujin-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(result.pendingDeckReveal).not.toBeNull();
    expect(result.pendingDeckReveal!.revealedCardInstanceIds.length).toBe(2);
  });

  it("神域（次の自分のエンドステップまでゲームに敗北しない）: コアすべてボイド+ゲーム敗北免除付与 (optional, stub 解消)", () => {
    // 神技は divineSkills へ移管済み → effects[] に stub は残っていない。
    expect(card.effects!.some((e) => e.stub)).toBe(false);
    const sanctuary = card.effects!.find((e) => e.timing.kind === "phase")!;
    expect(sanctuary.timing).toEqual({
      kind: "phase",
      step: "end",
      whose: "self",
    });
    expect(sanctuary.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(sanctuary.executionMode).toBe("optional");
    expect(sanctuary.steps.length).toBe(2);
    const coreMove = sanctuary.steps[0]!.action;
    expect(coreMove.kind).toBe("core_move");
    if (coreMove.kind === "core_move") {
      expect(coreMove.from).toEqual({ kind: "this_card" });
      expect(coreMove.to).toEqual({ kind: "void", player: "self" });
      expect(coreMove.amount).toBe("all");
    }
    const grant = sanctuary.steps[1]!.action;
    expect(grant.kind).toBe("grant_game_loss_immunity");
    if (grant.kind === "grant_game_loss_immunity") {
      expect(grant.player).toBe("self");
      expect(grant.duration).toEqual({
        scope: "step",
        step: "end",
        whose: "self",
        next: true,
      });
    }
  });

  it("神域実行: コアがすべてボイドへ置かれ、自分に immune_to_game_loss CE が登録される", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 0,
    });
    const ryujin = createCardInstance(card, {
      instanceId: "ryujin-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 8,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "end",
      turnNumber: 3,
      cardInstances: [ryujin],
    };
    const sanctuary = card.effects!.find((e) => e.timing.kind === "phase")!;
    const result = executeEffect({
      chainId: "test:bsth05_5-cards:2719",
      state,
      effect: sanctuary,
      sourceInstanceId: "ryujin-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "ryujin-1")!
        .normalCoreCount
    ).toBe(0);
    expect(
      result.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(8);
    const ce = result.activeContinuousEffects.find(
      (c) => c.modifierTag === "immune_to_game_loss"
    );
    expect(ce).toBeDefined();
    expect(ce?.targetInstanceId).toBe("alice");
    expect(ce?.duration).toEqual({
      scope: "step",
      step: "end",
      whose: "self",
      next: true,
    });

    // player-scoped CE の isPlayerScopedCETag allowlist 漏れ回帰チェック
    // (targetInstanceId が playerId のため、allowlist 漏れだと card instance 扱いで
    // 「対象カードが場に無い」判定により recompute 節目で即除去される。
    // BSAZ02-C11 allow_ignore_summon_condition 系の precedent と同型)。
    const recomputed = recomputeAndRebuildContinuousEffects(
      result,
      getCardDefinitionById
    );
    expect(
      recomputed.activeContinuousEffects.some(
        (c) =>
          c.modifierTag === "immune_to_game_loss" &&
          c.targetInstanceId === "alice"
      )
    ).toBe(true);
  });

  it("神域の免除持続: 作成ターンの自分エンドステップでは消滅せず、次の自分エンドステップで消滅する", () => {
    const grantedCe: ContinuousEffect = {
      effectId: "test-immune-1",
      sourceInstanceId: "ryujin-1",
      sourceDefinitionId: "BSTH05.5-XX01",
      actingPlayerId: "alice",
      duration: { scope: "step", step: "end", whose: "self", next: true },
      createdAtTurn: 3,
      createdAtAttackId: null,
      modifierTag: "immune_to_game_loss",
      targetInstanceId: "alice",
    };
    const stateWithCe: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      turnNumber: 3,
      activeContinuousEffects: [grantedCe],
    };
    const afterOwnTurnEnd = removeExpiredContinuousEffects(stateWithCe, {
      kind: "step_end",
      step: "end",
      activePlayerId: "alice",
    });
    expect(afterOwnTurnEnd).toEqual([grantedCe]); // 生存

    // 相手ターン (turn 4) の end step_end は whose:"self" 不一致で生存。
    const afterOpponentTurnEnd = removeExpiredContinuousEffects(
      { ...stateWithCe, turnNumber: 4 },
      { kind: "step_end", step: "end", activePlayerId: "bob" }
    );
    expect(afterOpponentTurnEnd).toEqual([grantedCe]); // 生存

    // 自分の次のターン (turn 5) の end step_end で消滅する。
    const afterNextOwnTurnEnd = removeExpiredContinuousEffects(
      { ...stateWithCe, turnNumber: 5 },
      { kind: "step_end", step: "end", activePlayerId: "alice" }
    );
    expect(afterNextOwnTurnEnd).toEqual([]); // 消滅
  });

  it("神域の免除持続 (実 advanceStep 経由): end ステップ離脱時に advanceFromEndStep が正しく失効させる", () => {
    // state.step==="end" のときの advanceStep は Phase1/1b/2 の早期 return を必ず通り、
    // 通常ステップ遷移の汎用 step_end 失効ブロック (advanceStep 下方) を素通りしてしまう
    // ため、advanceFromEndStep 内で明示的に removeExpiredContinuousEffects を呼ぶ配線が
    // 無いと CE が無期限残留する (adversarial verifier lens4 指摘、実測で確認)。
    // ここでは removeExpiredContinuousEffects を直接叩くのではなく、実際に
    // advanceStep(step:"end", window:"end_step_cleanup") を叩いて配線そのものを検証する。
    const grantedCe: ContinuousEffect = {
      effectId: "test-immune-1",
      sourceInstanceId: "ryujin-1",
      sourceDefinitionId: "BSTH05.5-XX01",
      actingPlayerId: "alice",
      duration: { scope: "step", step: "end", whose: "self", next: true },
      createdAtTurn: 3,
      createdAtAttackId: null,
      modifierTag: "immune_to_game_loss",
      targetInstanceId: "alice",
    };
    const buildEndStepState = (
      turnNumber: number,
      activePlayerId: string
    ): GameState => ({
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      turnNumber,
      activePlayerId,
      step: "end",
      window: "end_step_cleanup",
      activeContinuousEffects: [grantedCe],
    });

    // turn3 (alice 作成ターン) の end ステップを離れる → 生存する (next:true skip)。
    const afterOwnTurnEnd = advanceStep(
      buildEndStepState(3, "alice"),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(
      afterOwnTurnEnd.activeContinuousEffects.some(
        (c) => c.modifierTag === "immune_to_game_loss"
      )
    ).toBe(true);

    // turn4 (bob ターン) の end ステップを離れる → whose:"self" 不一致で生存する。
    const afterOpponentTurnEnd = advanceStep(
      buildEndStepState(4, "bob"),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(
      afterOpponentTurnEnd.activeContinuousEffects.some(
        (c) => c.modifierTag === "immune_to_game_loss"
      )
    ).toBe(true);

    // turn5 (alice 次のターン) の end ステップを離れる → 消滅する。
    const afterNextOwnTurnEnd = advanceStep(
      buildEndStepState(5, "alice"),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(
      afterNextOwnTurnEnd.activeContinuousEffects.some(
        (c) => c.modifierTag === "immune_to_game_loss"
      )
    ).toBe(false);
  });

  it("神域の免除効果: immune_to_game_loss 保持中はライフ0敗北判定を実際に素通りし、CE失効後は通常通り敗北確定する", () => {
    // adversarial verifier round3 lens5 指摘: CE の登録/失効ライフサイクルだけでなく、
    // 効果の核心である「ライフ0/デッキ0による敗北判定の回避」を applyLifeZeroDefeat 経由の
    // 実際の gameResult 確定処理に通して確認する e2e テスト
    // (既存 index.test.ts "ends the game with life_zero loss..." と同型のバトル駆動)。
    const spiritDefinition = {
      cardNo: "TEST-XX01-ATTACKER",
      name: "test attacker",
      printedCategory: "spirit" as const,
      colors: ["red"] as const,
      cost: 3,
      reductionSymbols: [] as const,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"] as const,
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C" as const,
    };
    const immuneCe: ContinuousEffect = {
      effectId: "test-immune-e2e",
      sourceInstanceId: "ryujin-e2e",
      sourceDefinitionId: "BSTH05.5-XX01",
      actingPlayerId: "bob",
      duration: { scope: "step", step: "end", whose: "self", next: true },
      createdAtTurn: 2,
      createdAtAttackId: null,
      modifierTag: "immune_to_game_loss",
      targetInstanceId: "bob",
    };
    const definitionLookup = (id: string) =>
      id === spiritDefinition.cardNo ? spiritDefinition : undefined;

    function declareAndCloseAttack(state: GameState): GameState {
      const declareOptions = {
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "attacker-e2e",
        getCardDefinitionById: definitionLookup,
      };
      const tentativeState = useAttackAsAction(declareOptions);
      const afterPass = usePassPreDeclarationStackAsAction({
        state: tentativeState,
        actingPlayerId: "bob",
      });
      const declared = confirmAttackDeclarationAsAction(
        afterPass.closedWindow!,
        afterPass.state,
        declareOptions
      ).state;
      // 開いたバトルフラッシュ窓（あれば）をお互い pass して閉じる
      // (index.test.ts closeAvailableBattleFlashWindow と同型)。
      let attacked = declared;
      const openAction = getLegalActions({
        state: attacked,
        actingPlayerId: attacked.activePlayerId,
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions: () => [],
      }).find((legalAction) => legalAction.kind === "open_battle_flash");
      if (openAction) {
        attacked = applyLegalAction({
          state: attacked,
          action: openAction,
          getCardDefinitionById: definitionLookup,
        }).state;
        for (let guard = 0; guard < 4; guard += 1) {
          const priorityPlayerId =
            attacked.activeAttack?.flashWindowState?.priorityPlayerId;
          if (!priorityPlayerId) break;
          const passAction = getLegalActions({
            state: attacked,
            actingPlayerId: priorityPlayerId,
            getCardDefinitionById: definitionLookup,
            getRegisteredFieldCardEffectActions: () => [],
          }).find((legalAction) => legalAction.kind === "pass_battle_flash")!;
          attacked = applyLegalAction({
            state: attacked,
            action: passAction,
            getCardDefinitionById: definitionLookup,
          }).state;
        }
      }
      const declineAction = getLegalActions({
        state: attacked,
        actingPlayerId: "bob",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions: () => [],
      }).find((legalAction) => legalAction.kind === "decline_block")!;
      const battleResolvedState = applyLegalAction({
        state: attacked,
        action: declineAction,
        getCardDefinitionById: definitionLookup,
      }).state;
      // ライフ減少の誘発/バースト窓を drain して安定状態まで進める
      // (index.test.ts drainPendingReactions と同型)。
      let settled = battleResolvedState;
      for (let guard = 0; guard < 20; guard += 1) {
        if (settled.pendingTriggeredEffects.length === 0) break;
        const triggerAction = ["alice", "bob"]
          .map((pid) =>
            getLegalActions({
              state: settled,
              actingPlayerId: pid,
              getCardDefinitionById: definitionLookup,
              getRegisteredFieldCardEffectActions: () => [],
              getRegisteredTriggeredEffectActions,
            }).find((a) => a.kind === "resolve_pending_triggered_effect")
          )
          .find((a) => a !== undefined);
        if (!triggerAction) break;
        settled = applyLegalAction({
          state: settled,
          action: triggerAction,
          getCardDefinitionById: definitionLookup,
          getRegisteredTriggeredEffectActions,
        }).state;
      }
      for (let guard = 0; guard < 20; guard += 1) {
        if (settled.pendingBurstChecks.length === 0) break;
        const burstAction = ["alice", "bob"]
          .map((pid) =>
            getLegalActions({
              state: settled,
              actingPlayerId: pid,
              getCardDefinitionById: definitionLookup,
              getRegisteredFieldCardEffectActions: () => [],
              getRegisteredBurstActions,
            }).find(
              (a) =>
                a.kind === "resolve_pending_burst_check" ||
                a.kind === "decline_pending_burst_check"
            )
          )
          .find((a) => a !== undefined);
        if (!burstAction) break;
        settled = applyLegalAction({
          state: settled,
          action: burstAction,
          getCardDefinitionById: definitionLookup,
          getRegisteredBurstActions,
        }).state;
      }
      // バースト確認の解決後に、保留していた誘発やそのスタック窓が再開されることがある。
      // 安定点に到達するまで、現在の合法手順に従って交互に閉じる。
      for (let guard = 0; guard < 40; guard += 1) {
        const actorIds = settled.stackWindow
          ? [settled.stackWindow.priorityPlayerId]
          : ["alice", "bob"];
        const nextAction = actorIds
          .map((pid) =>
            getLegalActions({
              state: settled,
              actingPlayerId: pid,
              getCardDefinitionById: definitionLookup,
              getRegisteredFieldCardEffectActions: () => [],
              getRegisteredTriggeredEffectActions,
              getRegisteredBurstActions,
            }).find(
              (a) =>
                a.kind === "pass_stack" ||
                a.kind === "resolve_pending_burst_check" ||
                a.kind === "decline_pending_burst_check" ||
                a.kind === "select_pending_to_resolve" ||
                a.kind === "resolve_pending_triggered_effect"
            )
          )
          .find((a) => a !== undefined);
        if (!nextAction) break;
        settled = applyLegalAction({
          state: settled,
          action: nextAction,
          getCardDefinitionById: definitionLookup,
          getRegisteredFieldCardEffectActions: () => [],
          getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions,
        }).state;
      }
      return settled;
    }

    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 1, reserveNormalCoreCount: 0 },
        ],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-e2e",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack",
      turnNumber: 2,
      activePlayerId: "alice",
      activeContinuousEffects: [immuneCe],
    };

    const immuneResolvedState = declareAndCloseAttack(baseState);
    // ライフは 0 になるが、immune_to_game_loss CE 保持中は applyLifeZeroDefeat が
    // bob を敗北判定から除外するため gameResult は確定しない。
    expect(
      immuneResolvedState.players.find((p) => p.id === "bob")
        ?.lifeNormalCoreCount
    ).toBe(0);
    expect(immuneResolvedState.gameResult).toBeNull();

    // CE 失効後（次の自分エンドステップ後を模した、CE を外した同条件）に再度判定すると
    // 通常通り gameResult が確定する。
    const expiredBaseState: GameState = {
      ...baseState,
      activeContinuousEffects: [],
    };
    const expiredResolvedState = declareAndCloseAttack(expiredBaseState);
    expect(expiredResolvedState.gameResult).toEqual({
      kind: "player_loss",
      losingPlayerId: "bob",
      reason: "life_zero",
    });
  });
});
