/**
 * engine-generic-effect-activation-causal-trigger cluster (b) Step 1:
 * BurstTrigger.kind:"any_effect_activated" — 発動元非依存の
 * 『任意の効果が発揮したとき』観測トリガー primitive。
 *
 * 既存 effect_activated (P3-67 Phase 3) は summon/place/advent の
 * card_event self-timing 3種にのみ actionKind を絞れるが、こちらは
 * eventMatcher に actionKind を持たせないことで任意の効果発揮を観測できる
 * (BSTH02.7-X01 effects[1]「相手がスタック効果を発揮したとき」型の土台)。
 *
 * このステップでは (1) registration 生成、(2) maybeQueueAnyEffectActivationBurstCheck
 * 単体の pendingBurstChecks 積み込み、(3) maybeQueueEffectActivationBurstCheck
 * (誘発効果の発揮完了点、stack-resolution-core.ts / legal-actions-apply.ts の
 * 既存 production call site) からの相乗り呼び出しを検証する。
 * magic/accel/change 等スタック解決 (resolveDeferredStackAction) 完了点への追加配線・
 * BSTH02.7-X01/BSGE01-R02 card-data 側の配線は後続ステップで行う。
 */
import { describe, expect, it } from "vitest";
import { generateBurstRegistrations } from "../src/effect/structured-effect-registrations";
import { buildBurstEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  maybeQueueAnyEffectActivationBurstCheck,
  maybeQueueEffectActivationBurstCheck,
} from "../src/legal/attack-burst-flow";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, PendingTriggeredEffect } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function burstCard(player: "self" | "opponent"): CardDefinition {
  return {
    cardNo: "TEST-ANY-EFFECT-ACTIVATED-BURST",
    name: "test any_effect_activated burst",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: ["burst"],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: { kind: "any_effect_activated", player },
        },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
          },
        ],
      },
    ],
  };
}

describe("generateBurstRegistrations: any_effect_activated", () => {
  it("actionKind を持たない単一 registration を生成する", () => {
    const regs = generateBurstRegistrations(burstCard("opponent"));
    expect(regs).toHaveLength(1);
    expect(regs[0]!.eventKind).toBe("effect_activated");
    expect(regs[0]!.whose).toBe("opponent");
    expect(regs[0]!.eventMatcher).toEqual({ family: "effect_activation" });
  });
});

describe("maybeQueueAnyEffectActivationBurstCheck", () => {
  const def = burstCard("opponent");
  const getCardDefinitionById = (id: string) =>
    id === def.cardNo ? def : undefined;
  const getRegisteredBurstActions = buildBurstEffectLookup([def]);

  function buildState() {
    const burstCardInstance = createCardInstance(def, {
      instanceId: "burst-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "burst",
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    return {
      ...base,
      cardInstances: [burstCardInstance],
      setBurstStates: [{ playerId: ALICE, cardInstanceId: "burst-1" }],
    };
  }

  it("actionKind 不問で相手の効果発揮に反応し pendingBurstChecks を積む (host非依存)", () => {
    const state = buildState();
    const next = maybeQueueAnyEffectActivationBurstCheck({
      state,
      activatorPlayerId: BOB,
      // 発揮元カードとは無関係の任意の instanceId (host非依存を示す)。
      relatedInstanceId: "some-unrelated-card-instance",
      options: { getCardDefinitionById, getRegisteredBurstActions },
    });
    const queued = next.pendingBurstChecks.filter(
      (c) => c.eventKind === "effect_activated"
    );
    expect(queued).toHaveLength(1);
    expect(queued[0]!.actingPlayerId).toBe(ALICE);
    expect(queued[0]!.relatedPlayerId).toBe(BOB);
    expect(queued[0]!.event).toEqual({
      family: "effect_activation",
      validationMode: "snapshot_only",
    });
  });

  it("whose:opponent は自分自身の効果発揮には反応しない", () => {
    const state = buildState();
    const next = maybeQueueAnyEffectActivationBurstCheck({
      state,
      activatorPlayerId: ALICE,
      relatedInstanceId: "some-unrelated-card-instance",
      options: { getCardDefinitionById, getRegisteredBurstActions },
    });
    const queued = next.pendingBurstChecks.filter(
      (c) => c.eventKind === "effect_activated"
    );
    expect(queued).toHaveLength(0);
  });

  it("maybeQueueEffectActivationBurstCheck (誘発効果の発揮完了点) 経由でも wildcard watcher が積まれる (host非依存の実配線を検証)", () => {
    const state = buildState();
    // eventKind を summon/place/advent 以外にし、host非依存パス経由でしか
    // 積まれないことを示す (自身の card_event self-timing 判定は早期 return するはず)。
    const pendingEffect: PendingTriggeredEffect = {
      pendingId: "pending-1",
      actingPlayerId: BOB,
      eventKind: "attack",
      source: "action_resolution",
      chainId: "test:any-effect-activated-burst-trigger:136",
      attackId: null,
      relatedPlayerId: BOB,
      relatedInstanceId: "activator-card-not-self-timing",
      amount: null,
      step: "attack",
      window: "default",
      resolvedSourceInstanceIds: [],
    };
    const next = maybeQueueEffectActivationBurstCheck({
      state,
      pendingEffect,
      resolvedSourceInstanceId: undefined,
      options: { getCardDefinitionById, getRegisteredBurstActions },
    });
    const queued = next.pendingBurstChecks.filter(
      (c) => c.eventKind === "effect_activated"
    );
    // "effect_activated"(summon/place/advent限定) 側は eventKind:"attack" のため積まれず、
    // "any_effect_activated"(wildcard) 側のみ 1 件積まれる。
    expect(queued).toHaveLength(1);
    expect(queued[0]!.event).toEqual({
      family: "effect_activation",
      validationMode: "snapshot_only",
    });
    // adversarial verifier round2 Lens2: resolvedSourceInstanceId が未確定なら
    // pendingEffect.relatedInstanceId (=三者観測の対象/主語カード。発揮元カードとは別概念)
    // へフォールバックせず null にする (fail-closed)。
    expect(queued[0]!.relatedInstanceId).toBeNull();
  });
});
