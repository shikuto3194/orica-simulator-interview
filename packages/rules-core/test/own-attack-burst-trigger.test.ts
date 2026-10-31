/**
 * バースト追加発動条件 own_attack（裁定 2026-07-23, 10_rules/04b_burst-rules.md
 * §セット中バーストの追加発動条件）の engine primitive 検証。
 *
 * 「セットしているこのカードは、自分のスピリットがアタックしたときに発動できる」型
 * (BSGE01-M03/M04) は、既存の attack_finished(eventKind:attack_after,
 * actingPlayerId=defendingPlayerId 固定) では表現できない。attacker 自身向けの
 * pendingBurstCheck を積む maybeQueueOwnAttackBurstCheck (attack-burst-flow.ts) を
 * 直接検証する。カード側の統合検証 (BSGE01-M03) は bsge01-cards.test.ts 側。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { maybeQueueOwnAttackBurstCheck } from "../src/legal/attack-burst-flow";
import {
  buildBurstEffectLookup,
  generateBurstRegistrations,
} from "../src/effect/structured-effect-registrations";
import {
  burstEventKindToStructuredEvent,
  matchesTriggerEvent,
} from "../src/effect/trigger-system";
import { createCardInstance, createEmptyGameState } from "../src";
import type { ActiveAttack, CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);

function buildDeclareAttackState(attackerZone: "field" | "hand"): GameState {
  const burstSource = createCardInstance(cardNoMap.get("BSGE01-M03")!, {
    instanceId: "tsubaki-burst",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  const attacker = createCardInstance(cardNoMap.get("BSSL01-C02")!, {
    instanceId: "alice-attacker",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: attackerZone,
    normalCoreCount: attackerZone === "field" ? 1 : 0,
  });
  const activeAttack: ActiveAttack = {
    attackId: "attack:be-1:1",
    primaryEntityId: "be-1",
    participantEntityIds: ["be-1"],
    groupMode: "single",
    target: { kind: "player", playerId: "bob" },
    blockAssignments: [{ participantEntityId: "be-1", blockedByEntityIds: [] }],
    symbolResolutionOrder: ["be-1"],
    flashBeforeBlockCompleted: false,
    flashAfterBlockCompleted: false,
    flashWindowState: null,
  };
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [burstSource, attacker],
    }),
    turnNumber: 3,
    activePlayerId: "alice",
    step: "attack",
    window: "declare_attack",
    activeAttack,
    setBurstStates: [{ playerId: "alice", cardInstanceId: "tsubaki-burst" }],
    battleEntities: [
      {
        entityId: "be-1",
        resolvedBp: 4000,
        attackState: "attacking",
        resolvedSymbols: ["purple"],
        memberInstanceIds: ["alice-attacker"],
      },
    ],
  };
}

describe("maybeQueueOwnAttackBurstCheck", () => {
  it("自分のスピリットがアタックしたとき、attacker 向けの own_attack pendingBurstCheck を積む", () => {
    const state = buildDeclareAttackState("field");
    const after = maybeQueueOwnAttackBurstCheck(state, {
      getCardDefinitionById,
      getRegisteredBurstActions,
    });

    expect(after.activeAttack?.ownAttackBurstChecked).toBe(true);
    const queued = after.pendingBurstChecks.find(
      (check) => check.eventKind === "own_attack"
    );
    expect(queued).toBeDefined();
    expect(queued?.actingPlayerId).toBe("alice");
    expect(queued?.relatedPlayerId).toBe("alice");
    expect(queued?.relatedInstanceId).toBe("alice-attacker");
  });

  it("同一 attack に対して二重にキューイングしない", () => {
    const state = buildDeclareAttackState("field");
    const once = maybeQueueOwnAttackBurstCheck(state, {
      getCardDefinitionById,
      getRegisteredBurstActions,
    });
    const twice = maybeQueueOwnAttackBurstCheck(once, {
      getCardDefinitionById,
      getRegisteredBurstActions,
    });
    expect(
      twice.pendingBurstChecks.filter(
        (check) => check.eventKind === "own_attack"
      ).length
    ).toBe(1);
  });

  it("アタッカーが場を離れていれば own_attack バーストは積まれない（不在チェック）", () => {
    const state = buildDeclareAttackState("hand");
    const after = maybeQueueOwnAttackBurstCheck(state, {
      getCardDefinitionById,
      getRegisteredBurstActions,
    });
    expect(
      after.pendingBurstChecks.some((check) => check.eventKind === "own_attack")
    ).toBe(false);
  });

  it("defender 向け attack_after の重複キューイング guard と衝突しない (別 eventKind)", () => {
    const state = buildDeclareAttackState("field");
    const withOwnAttack = maybeQueueOwnAttackBurstCheck(state, {
      getCardDefinitionById,
      getRegisteredBurstActions,
    });
    // own_attack を積んだ後でも attack_after 側の guard (eventKind==="attack_after") は
    // own_attack のエントリを誤検知しない (eventKind が異なるため)。
    expect(
      withOwnAttack.pendingBurstChecks.some(
        (check) => check.eventKind === "attack_after"
      )
    ).toBe(false);
  });

  it("own_attack と attack_finished(attack_after) は structured event の family が異なる（matcher レベルで分離、adversarial verifier 2026-07-23 指摘）", () => {
    const ownAttackEvent = burstEventKindToStructuredEvent("own_attack");
    const attackAfterEvent = burstEventKindToStructuredEvent("attack_after");
    expect(ownAttackEvent.family).not.toBe(attackAfterEvent.family);

    // 将来 attack_finished に player:"self" 型カードが追加されても own_attack と
    // 同一 eventKind に丸め込まれないこと（whose:"self" だけの区別に依存しない）を
    // registration レベルで固定する。
    const hypotheticalSelfAttackFinished: CardDefinition = {
      ...cardNoMap.get("BSGE01-M03")!,
      cardNo: "TEST-self-attack-finished",
      effects: [
        {
          timing: {
            kind: "burst",
            trigger: { kind: "attack_finished", player: "self" },
          },
          steps: [],
          textRef: [],
        },
      ],
    };
    const [registration] = generateBurstRegistrations(
      hypotheticalSelfAttackFinished
    );
    expect(registration?.whose).toBe("self");
    expect(registration?.eventKind).toBe("attack_after");
    expect(registration?.eventKind).not.toBe("own_attack");
    // attack_after 系 registration の matcher は family:"action_after" (burstEventKindToMatcher
    // 経由) であり、own_attack の event (family:"action_declared") とは family 段階で
    // 一致しない (matchesTriggerEvent の family 比較で false)。
    expect(
      matchesTriggerEvent(
        { family: "action_after", actionKind: "attack" },
        ownAttackEvent
      )
    ).toBe(false);
  });
});
