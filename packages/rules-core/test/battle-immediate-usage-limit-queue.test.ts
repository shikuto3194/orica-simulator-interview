/**
 * 再現テスト: 同ターンに複数回アタックするスピリットの『アタック時』効果のうち、
 * 「ターンに1回」で使用済みの optional 効果が battle-immediate queue に滞留して
 * アタックが進行不能になるバグ。
 *
 * 元事象: BSTH01-X03 レミリア・スカーレット（回復効果で同ターン複数回アタック）。
 *   effects[1] (registrationIndex 0): 『アタック時』optional + usageLimit(ターン1回,
 *     limitGroupId="nexus_destroy") → 相手の創界神ネクサス破壊
 *   effects[2] (registrationIndex 1): 『アタック時』mandatory → BP破壊 + 自身回復
 *
 * 1 回目のアタックで registrationIndex 0 を発揮（または空撃ち）すると usageLimit を
 * 消費する。2 回目以降のアタックでは registrationIndex 0 は usageLimit 超過で
 * `getAvailableBattleImmediateEffectLegalActions` が legal action を生成しない（continue）
 * 一方、`queueRegisteredBattleImmediateEffects` は timing 一致だけで queue していたため、
 * 発揮も skip もできない prompt が battleImmediateEffects に残り、アタックが進行不能になる。
 *
 * 修正方針（誘発側 getAvailableTriggeredEffectSourceChoices と同じ「発揮不能な空 prompt を
 * 積まない」方針）: queue 時点で usageLimit 超過の registration は queue しない。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  recordEffectUsage,
} from "../src/index";
import {
  queueRegisteredBattleImmediateEffects,
  useBattleImmediateEffectAsAction,
} from "../src/battle/battle-immediate-effect-system";
import { buildBattleImmediateEffectLookup } from "../src/effect/structured-effect-registrations";

/** BSTH01-X03 レミリアを模した、『アタック時』効果を 2 つ持つ合成スピリット。 */
function makeMultiAttackSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `multi-attack ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // registrationIndex 0: ターン1回・optional（レミリアの創界神破壊相当）
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        limitGroupId: "test_nexus_destroy",
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
      {
        // registrationIndex 1: 無制限・mandatory（レミリアの BP破壊+回復相当）
        timing: { kind: "card_event", event: "attack" },
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
      },
    ],
  };
}

function setupAttacker(def: CardDefinition): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def, {
        instanceId: "attacker",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
        exhaustState: "exhausted",
      }),
    ],
    playerOverrides: [{ deckCount: 5 }],
  });
  return { ...base, step: "attack", activePlayerId: "alice", turnNumber: 2 };
}

const ATTACK_ID = "attack-group:2:alice:battle-entity:attacker";

function queueAttackPrompts(
  state: GameState,
  def: CardDefinition
): readonly number[] {
  const lookup = buildBattleImmediateEffectLookup([def]);
  const result = queueRegisteredBattleImmediateEffects({
    state,
    attackId: ATTACK_ID,
    participantEntityId: "battle-entity:attacker",
    actingPlayerId: "alice",
    sourceCard: state.cardInstances.find((c) => c.instanceId === "attacker")!,
    sourceDefinition: def,
    timing: "attack",
    getCardDefinitionById: (id) => (id === def.cardNo ? def : undefined),
    getRegisteredBattleImmediateEffectActions: lookup,
  });
  return result.battleImmediateEffects.map((p) => p.registrationIndex);
}

describe("battle-immediate queue: usageLimit 超過の『アタック時』効果は queue しない", () => {
  it("usage 未消費（初回アタック）なら両方の registration が queue される", () => {
    const def = makeMultiAttackSpirit("TEST-MULTI-ATK");
    const indices = [...queueAttackPrompts(setupAttacker(def), def)].sort();
    expect(indices).toEqual([0, 1]);
  });

  it("registrationIndex 0 が同ターン使用済みなら queue されず、registrationIndex 1 のみ残る", () => {
    const def = makeMultiAttackSpirit("TEST-MULTI-ATK");
    let state = setupAttacker(def);
    // 1 回目のアタックで registrationIndex 0（effect:0 / limitGroupId test_nexus_destroy）を
    // 発揮済みにする。
    state = {
      ...state,
      effectUsageRecords: recordEffectUsage({
        state,
        sourceInstanceId: "attacker",
        sourceDefinitionId: def.cardNo,
        effectLabel: "effect:0",
        duration: "turn",
        groupId: "test_nexus_destroy",
      }),
    };

    const indices = queueAttackPrompts(state, def);
    // registrationIndex 0 は usageLimit 超過のため queue されない（orphan を作らない）。
    expect(indices).toEqual([1]);
  });
});

type InheritedEffectSourceRole = "combined_brave" | "text_role_under";

function makeInheritedUsageProvider(
  role: InheritedEffectSourceRole
): CardDefinition {
  const combined = role === "combined_brave";
  return {
    cardNo: `TEST-DECLARATION-STEP-${role}`,
    name: `${role} declaration step provider`,
    printedCategory: combined ? "brave" : "spirit",
    colors: ["blue"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["blue"],
    textLines: combined
      ? ["【合体中】『このスピリットのアタック時』自分のカウント+1する。"]
      : [
          "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
          "『このスピリットのアタック時』自分のカウント+1する。",
        ],
    keywordTags: combined ? [] : ["star_garment"],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        ...(combined ? { condition: [{ kind: "combined" as const }] } : {}),
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            usageLimit: {
              kind: "per_instance",
              duration: "step",
              maxCount: 1,
            },
          },
        ],
        textRef: combined ? [0] : [0, 1],
      },
    ],
  } as CardDefinition;
}

function setupInheritedStepUsageState(
  role: InheritedEffectSourceRole,
  multiStep = false
): {
  state: GameState;
  hostDef: CardDefinition;
  providerDef: CardDefinition;
  getDef: (id: string) => CardDefinition | undefined;
} {
  const hostDef = {
    ...makeMultiAttackSpirit(`TEST-DECLARATION-HOST-${role}`),
    effects: [],
    ...(role === "text_role_under"
      ? { underCardSlots: [{ roleTag: "星霊衣", maxCount: 1 }] }
      : {}),
  } as CardDefinition;
  const providerDef = makeInheritedUsageProvider(role);
  if (multiStep) {
    providerDef.effects![0]!.steps = [
      { action: { kind: "count_increase", player: "self", amount: 1 } },
      {
        action: { kind: "count_increase", player: "self", amount: 2 },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "step", maxCount: 1 },
      },
      { action: { kind: "count_increase", player: "self", amount: 3 } },
    ];
  }
  const host = createCardInstance(hostDef, {
    instanceId: `host-${role}`,
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const provider = createCardInstance(providerDef, {
    instanceId: `provider-${role}`,
    ownerPlayerId: "alice",
    zone: "field",
  });
  provider.attachedToInstanceId = host.instanceId;
  if (role === "combined_brave") {
    host.attachedChildrenIds = [provider.instanceId];
  } else {
    host.underCards = [
      {
        cardInstanceId: provider.instanceId,
        role: "text_role",
        roleTag: "星霊衣",
      },
    ];
    provider.zoneRoleName = "star-garment";
  }
  const definitions = new Map([
    [hostDef.cardNo, hostDef],
    [providerDef.cardNo, providerDef],
  ]);
  return {
    state: {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, provider],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 2,
    },
    hostDef,
    providerDef,
    getDef: (id) => definitions.get(id),
  };
}

describe("battle-immediate queue: inherited optional step usage identity", () => {
  it.each(["combined_brave", "text_role_under"] as const)(
    "%s skips the exhausted optional step while resolving the surrounding mandatory steps",
    (role) => {
      const { state, hostDef, providerDef, getDef } =
        setupInheritedStepUsageState(role, true);
      const registrations = buildBattleImmediateEffectLookup([
        hostDef,
        providerDef,
      ]);
      const lookups = {
        getCardDefinitionById: getDef,
        getRegisteredBattleImmediateEffectActions: registrations,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      };
      const attack = (currentState: GameState) => {
        const queued = queueRegisteredBattleImmediateEffects({
          state: currentState,
          attackId: `optional-step-usage-${role}`,
          participantEntityId: `battle-entity-host-${role}`,
          actingPlayerId: "alice",
          sourceCard: currentState.cardInstances.find(
            (card) => card.instanceId === `host-${role}`
          )!,
          sourceDefinition: hostDef,
          timing: "attack",
          ...lookups,
        });
        expect(queued.battleImmediateEffects).toHaveLength(1);
        const prompt = queued.battleImmediateEffects[0]!;
        return useBattleImmediateEffectAsAction({
          state: queued,
          actingPlayerId: "alice",
          promptId: prompt.promptId,
          sourceInstanceId: prompt.sourceInstanceId,
          sourceKind: prompt.sourceKind,
          ...lookups,
        }).state;
      };

      const first = attack(state);
      expect(
        first.players.find((player) => player.id === "alice")?.countValue
      ).toBe(1);
      expect(first.pendingStepOptionalChoice).toMatchObject({ stepIndex: 1 });
      const execute = getLegalActions({
        state: first,
        actingPlayerId: "alice",
        ...lookups,
      }).find(
        (action) =>
          action.kind === "resolve_pending_step_optional_choice" &&
          action.choice === "execute"
      );
      expect(execute).toBeDefined();
      const resolved = applyLegalAction({
        state: first,
        action: execute!,
        ...lookups,
      }).state;
      expect(resolved.pendingStepOptionalChoice).toBeNull();
      expect(
        resolved.players.find((player) => player.id === "alice")?.countValue
      ).toBe(6);
      expect(resolved.effectUsageRecords).toContainEqual(
        expect.objectContaining({
          sourceInstanceId: `provider-${role}`,
          sourceDefinitionId: providerDef.cardNo,
          effectLabel: `__step:${providerDef.cardNo}:0:1`,
          duration: "step",
        })
      );

      const second = attack(resolved);
      expect(second.pendingStepOptionalChoice).toBeNull();
      expect(
        second.players.find((player) => player.id === "alice")?.countValue
      ).toBe(10);
      expect(second.effectUsageRecords).toEqual(resolved.effectUsageRecords);
    }
  );
});

describe("battle-immediate queue: inherited single-step usage identity", () => {
  it.each(["combined_brave", "text_role_under"] as const)(
    "%s provider records the declared step on the provider and queues no second prompt",
    (role) => {
      const { state, hostDef, providerDef, getDef } =
        setupInheritedStepUsageState(role);
      const host = state.cardInstances.find(
        (card) => card.instanceId === `host-${role}`
      )!;
      const registrations = buildBattleImmediateEffectLookup([
        hostDef,
        providerDef,
      ]);
      const queue = (currentState: GameState) =>
        queueRegisteredBattleImmediateEffects({
          state: currentState,
          attackId: `attack-step-usage-${role}`,
          participantEntityId: `battle-entity-host-${role}`,
          actingPlayerId: "alice",
          sourceCard: currentState.cardInstances.find(
            (card) => card.instanceId === host.instanceId
          )!,
          sourceDefinition: hostDef,
          timing: "attack",
          getCardDefinitionById: getDef,
          getRegisteredBattleImmediateEffectActions: registrations,
        });

      const queued = queue(state);
      expect(queued.battleImmediateEffects).toHaveLength(1);
      const prompt = queued.battleImmediateEffects[0]!;
      expect(prompt).toMatchObject({
        sourceInstanceId: host.instanceId,
        sourceEffectInstanceId: `provider-${role}`,
        sourceEffectDefinitionId: providerDef.cardNo,
      });

      const resolved = useBattleImmediateEffectAsAction({
        state: queued,
        actingPlayerId: "alice",
        promptId: prompt.promptId,
        sourceInstanceId: prompt.sourceInstanceId,
        sourceKind: prompt.sourceKind,
        getCardDefinitionById: getDef,
        getRegisteredBattleImmediateEffectActions: registrations,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => [],
      }).state;

      expect(
        resolved.players.find((player) => player.id === "alice")?.countValue
      ).toBe(1);
      expect(resolved.effectUsageRecords).toContainEqual(
        expect.objectContaining({
          sourceInstanceId: `provider-${role}`,
          sourceDefinitionId: providerDef.cardNo,
          effectLabel: `__step:${providerDef.cardNo}:0:0`,
          duration: "step",
        })
      );

      const secondDeclaration = queue(resolved);
      expect(secondDeclaration.battleImmediateEffects).toHaveLength(0);
      expect(
        secondDeclaration.players.find((player) => player.id === "alice")
          ?.countValue
      ).toBe(1);
    }
  );
});
