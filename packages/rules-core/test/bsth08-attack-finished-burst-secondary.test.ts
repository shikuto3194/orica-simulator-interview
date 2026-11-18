/**
 * BSTH08-C04 / BSTH08-C05 の attack_finished バースト二次効果の end-to-end 検証。
 *
 * いずれも「相手のスピリット／アルティメットのアタック後」バーストで、召喚前に
 * 二次効果（C04: 相手創界神ネクサスのコア全ボイド / C05: アタック中の相手全手札戻し）を
 * 行う。attack_finished トリガー（attack_after / whose: opponent）に加え、二次効果が
 * 既存 DSL プリミティブ（core_move field_card→void / bounce）で表現できることを盤面で確認する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildBurstEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
const noLookup = (_: string) => undefined;

function findBurstDeclaration(state: GameState, sourceInstanceId: string) {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: noLookup,
    getRegisteredTriggeredEffectActions: noLookup,
    getRegisteredBurstActions,
  }).find(
    (a): a is Extract<LegalAction, { kind: "resolve_pending_burst_check" }> =>
      a.kind === "resolve_pending_burst_check" &&
      a.sourceInstanceId === sourceInstanceId
  );
}

function resolve(
  state: GameState,
  action: LegalAction,
  abortPlacement = false
) {
  const afterDeclaration = applyLegalAction({
    state,
    action,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: noLookup,
    getRegisteredTriggeredEffectActions: noLookup,
    getRegisteredBurstActions,
    getHandWrittenEffectResolver: noLookup,
  }).state;
  expect(afterDeclaration.stackWindow?.burstWindowKind).toBe("activation");

  const activationPass = getLegalActions({
    state: afterDeclaration,
    actingPlayerId: "bob",
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: noLookup,
    getRegisteredTriggeredEffectActions: noLookup,
    getRegisteredBurstActions,
  }).find((a) => a.kind === "pass_stack");
  expect(activationPass).toBeDefined();
  const afterActivationPass = applyLegalAction({
    state: afterDeclaration,
    action: activationPass!,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: noLookup,
    getRegisteredTriggeredEffectActions: noLookup,
    getRegisteredBurstActions,
    getHandWrittenEffectResolver: noLookup,
  }).state;
  expect(afterActivationPass.stackWindow?.burstWindowKind).toBe(
    "effect_declaration"
  );

  const effectDeclarationPass = getLegalActions({
    state: afterActivationPass,
    actingPlayerId: "bob",
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: noLookup,
    getRegisteredTriggeredEffectActions: noLookup,
    getRegisteredBurstActions,
  }).find((a) => a.kind === "pass_stack");
  expect(effectDeclarationPass).toBeDefined();
  const pending = applyLegalAction({
    state: afterActivationPass,
    action: effectDeclarationPass!,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: noLookup,
    getRegisteredTriggeredEffectActions: noLookup,
    getRegisteredBurstActions,
    getHandWrittenEffectResolver: noLookup,
  });
  expect(pending.state.pendingMultiPlacement).not.toBeNull();
  const placement = getLegalActions({
    state: pending.state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noLookup,
    getRegisteredBurstActions,
  }).find(
    (a) =>
      a.kind ===
      (abortPlacement
        ? "abort_pending_multi_placement"
        : "resolve_pending_multi_placement")
  );
  expect(placement).toBeDefined();
  return applyLegalAction({
    state: pending.state,
    action: placement!,
    multiPlacementAllocations: pending.state.pendingMultiPlacement!.targets.map(
      (target) => ({
        destinationInstanceId: target.instanceId,
        placements: [
          { kind: "reserve_normal" as const, amount: target.minimumCoreCount },
        ],
      })
    ),
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noLookup,
    getRegisteredBurstActions,
  });
}

function baseState(extra: Partial<GameState>): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      { lifeNormalCoreCount: 5, reserveNormalCoreCount: 4 },
      { lifeNormalCoreCount: 5 },
    ],
  });
  return {
    ...base,
    turnNumber: 4,
    activePlayerId: "bob",
    step: "attack",
    window: "none",
    battleEntities: [
      {
        entityId: "entity-bob-attacker",
        memberInstanceIds: ["bob-attacker"],
        resolvedBp: 3000,
        resolvedSymbols: ["green"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-1",
      primaryEntityId: "entity-bob-attacker",
      participantEntityIds: ["entity-bob-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "alice" },
      blockAssignments: [
        {
          participantEntityId: "entity-bob-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["entity-bob-attacker"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    },
    pendingBurstChecks: [
      {
        checkId: "attack-after-1",
        actingPlayerId: "alice",
        eventKind: "attack_after",
        source: "battle_resolution",
        chainId: "test:bsth08-attack-finished-burst-secondary:171",
        attackId: "attack-1",
        relatedPlayerId: "bob",
        amount: 0,
        step: "attack",
        window: "battle_resolution",
        resolvedBurstCardInstanceIds: [],
      },
    ],
    ...extra,
  };
}

describe("attack_finished burst registration（BSTH08 二次効果カード）", () => {
  it.each(["BSTH08-C04", "BSTH08-C05"])(
    "%s は attack_after (whose: opponent) の burst registration を持つ",
    (cardNo) => {
      const regs = getRegisteredBurstActions(cardNo) ?? [];
      const attackAfter = regs.filter((r) => r.eventKind === "attack_after");
      expect(attackAfter.length).toBeGreaterThanOrEqual(1);
      expect(attackAfter[0]?.whose).toBe("opponent");
    }
  );
});

describe("BSTH08-C04 バースト: 相手創界神ネクサスのコア全ボイド + 召喚", () => {
  it("解決すると相手創界神ネクサスのコアが全てボイドへ移り、本体が召喚される", () => {
    const burst = createCardInstance(getCardDefinitionById("BSTH08-C04")!, {
      instanceId: "reimu-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const attacker = createCardInstance(getCardDefinitionById("BSTH09-M02")!, {
      instanceId: "bob-attacker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const grandstone = createCardInstance(
      getCardDefinitionById("BSLH01-X02")!,
      {
        instanceId: "bob-grandstone",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 3,
      }
    );
    const initial = baseState({
      cardInstances: [burst, attacker, grandstone],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "reimu-burst" }],
    });

    const decl = findBurstDeclaration(initial, "reimu-burst");
    expect(decl).toBeDefined();

    const result = resolve(initial, decl!);

    // 創界神ネクサスのコアは全てボイドへ。
    const nexus = result.state.cardInstances.find(
      (c) => c.instanceId === "bob-grandstone"
    );
    expect(nexus?.normalCoreCount).toBe(0);
    // 本体は場へ召喚される。
    const reimu = result.state.cardInstances.find(
      (c) => c.instanceId === "reimu-burst"
    );
    expect(reimu?.zone).toBe("field");
    expect(
      result.state.setBurstStates.some(
        (b) => b.cardInstanceId === "reimu-burst"
      )
    ).toBe(false);
  });
});

describe("BSTH08-C05 バースト: アタック中の相手を全手札戻し + 召喚", () => {
  it.each([false, true])(
    "配置キャンセル=%s: 先行バウンスを完了し、バーストが解決済みになる",
    (abortPlacement) => {
      const burst = createCardInstance(getCardDefinitionById("BSTH08-C05")!, {
        instanceId: "marisa-burst",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "burst",
      });
      const attacker = createCardInstance(
        getCardDefinitionById("BSTH09-M02")!,
        {
          instanceId: "bob-attacker",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }
      );
      const initial = baseState({
        cardInstances: [burst, attacker],
        setBurstStates: [{ playerId: "alice", cardInstanceId: "marisa-burst" }],
      });

      const decl = findBurstDeclaration(initial, "marisa-burst");
      expect(decl).toBeDefined();

      const result = resolve(initial, decl!, abortPlacement);

      // アタック中だった相手スピリットは手札へ戻る。
      const attackerAfter = result.state.cardInstances.find(
        (c) => c.instanceId === "bob-attacker"
      );
      expect(attackerAfter?.zone).toBe("hand");
      // 配置中止なら召喚だけを巻き戻し、解決済みバーストをトラッシュへ送る。
      const marisa = result.state.cardInstances.find(
        (c) => c.instanceId === "marisa-burst"
      );
      expect(marisa?.zone).toBe(abortPlacement ? "trash" : "field");
      expect(result.state.pendingMultiPlacement).toBeNull();
      expect(result.state.pendingLeaveEntities).toEqual([]);
      expect(result.state.revealedBurstStates).toEqual([]);
      expect(result.state.setBurstStates).toEqual([]);
    }
  );
});
