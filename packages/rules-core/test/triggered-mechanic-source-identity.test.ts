import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { moveCardZone, updateCard } from "../src/core/core-system";
import { buildResolutionItems } from "../src/effect/resolution-items";
import { getTriggeredMechanicActivationState } from "../src/effect/triggered-mechanic-eligibility";
import { pruneIllegalPendingTriggeredEffects } from "../src/effect/trigger-system";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyMechanicTriggeredEffect } from "../src/legal/mechanic-trigger-handlers";
import { resolveUnsealMechanic } from "../src/mechanics/grandstone-system";
import {
  createMechanicPendingTriggeredEffect,
  type CardDefinition,
  type GameState,
  type TriggeredMechanic,
} from "../src/model";

const mechanics: TriggeredMechanic[] = [
  {
    kind: "oracle",
    grandwalkerInstanceId: "source",
    triggerCardInstanceId: "subject",
    triggerKind: "summon",
  },
  { kind: "placement_oracle", grandwalkerInstanceId: "source" },
  {
    kind: "magic_stack_domain",
    grandwalkerInstanceId: "source",
    triggerCardInstanceId: "subject",
  },
  {
    kind: "unseal",
    grandstoneInstanceId: "source",
    triggerCardInstanceId: "subject",
    triggerEvent: "attack",
  },
  { kind: "stone_rebirth", grandstoneInstanceId: "source" },
  {
    kind: "granted_effect",
    granteeInstanceId: "source",
    grantCeEffectId: "grant",
  },
];

function fixture(mechanic: TriggeredMechanic, turnReservation = false) {
  const template = ALL_CARDS.find(
    (card) =>
      card.cardNo ===
      (mechanic.kind === "unseal" || mechanic.kind === "stone_rebirth"
        ? "BSTH06-転醒X01(A)"
        : mechanic.kind === "magic_stack_domain"
          ? "BSTH10.5-X01"
          : "BSTH06-X01")
  )!;
  // 同じ機構を持つ別面で比較し、単なる grandwalkerData 消失を根拠にしない。
  const definitions: CardDefinition[] = [
    template,
    { ...template, cardNo: "ANOTHER-FACE", name: "別の面" },
  ];
  const deps = {
    getCardDefinitionById: (id: string) =>
      definitions.find((card) => card.cardNo === id),
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ voidNormalCoreCount: 10 }, {}],
      cardInstances: [
        createCardInstance(template, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount:
            mechanic.kind === "magic_stack_domain"
              ? 3
              : mechanic.kind === "stone_rebirth"
                ? template.grandstoneData!.rebirthCoreThreshold!
                : 1,
        }),
        createCardInstance(template, {
          instanceId: "deck-card",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
    }),
    activePlayerId: "alice",
    step: "main",
    window: "none",
  };
  if (mechanic.kind === "granted_effect") {
    state = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "grant",
          sourceInstanceId: "source",
          sourceDefinitionId: template.cardNo,
          actingPlayerId: "alice",
          targetInstanceId: "source",
          modifierTag: "granted_effect",
          duration: { scope: "turn" },
          createdAtTurn: state.turnNumber,
          createdAtAttackId: null,
          metadata: {
            turnReservation,
            grantedEffect: {
              timing: { kind: "card_event", event: "attack" },
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
          },
        },
      ],
    };
  }
  const pending = createMechanicPendingTriggeredEffect({
    state,
    mechanic,
    pendingId: "pending",
    relatedInstanceId: "source",
    actingPlayerId: "alice",
    chainId: "original-event",
  });
  // 待機中の正式保存/復元で場の個体の記録が保持されることも検査する。
  state = JSON.parse(
    JSON.stringify({ ...state, pendingTriggeredEffects: [pending] })
  ) as GameState;
  return { state, pending: state.pendingTriggeredEffects[0]!, deps };
}

function replaceSource(state: GameState, mode: "reenter" | "change-face") {
  return mode === "reenter"
    ? moveCardZone(moveCardZone(state, "source", "trash"), "source", "field")
    : updateCard(state, "source", (card) => ({
        ...card,
        definitionId: "ANOTHER-FACE",
      }));
}

describe.each(mechanics)("$kind の未宣言候補は元の効果元に限る", (mechanic) => {
  it.each(["soul", "advent_source", "attached"] as const)(
    "%s へ役割が変わった同じ field カードへ過去の待機を渡さない",
    (role) => {
      const { state, pending, deps } = fixture(mechanic);
      const host = { ...state.cardInstances[0]!, instanceId: "host" };
      const changed: GameState = {
        ...state,
        players: state.players.map((player) =>
          role === "soul" && player.id === "alice"
            ? { ...player, soulStateInstanceIds: ["source"] }
            : player
        ),
        cardInstances: [
          ...state.cardInstances.map((card) =>
            role === "attached"
              ? { ...card, attachedToInstanceId: "host" }
              : card
          ),
          {
            ...host,
            ...(role === "advent_source"
              ? {
                  underCards: [
                    {
                      cardInstanceId: "source",
                      role: "advent_source" as const,
                    },
                  ],
                }
              : {}),
            ...(role === "attached" ? { attachedChildrenIds: ["source"] } : {}),
          },
        ],
      };
      expect(
        getTriggeredMechanicActivationState(
          changed,
          pending.mechanic!,
          deps.getCardDefinitionById
        ).canActivate
      ).toBe(false);
      expect(buildResolutionItems({ state: changed, ...deps })).toEqual([]);
      expect(
        pruneIllegalPendingTriggeredEffects({ state: changed, ...deps })
          .pendingTriggeredEffects
      ).toEqual([]);
    }
  );

  it.each(["reenter", "change-face"] as const)(
    "%s 後の同じ instanceId へ過去の待機を渡さない",
    (mode) => {
      const { state, pending, deps } = fixture(mechanic);
      expect(
        getTriggeredMechanicActivationState(
          state,
          pending.mechanic!,
          deps.getCardDefinitionById
        ).canActivate
      ).toBe(true);
      expect(buildResolutionItems({ state, ...deps })).toHaveLength(1);
      const replaced = replaceSource(state, mode);
      expect(
        getTriggeredMechanicActivationState(
          replaced,
          pending.mechanic!,
          deps.getCardDefinitionById
        ).canActivate
      ).toBe(false);
      expect(buildResolutionItems({ state: replaced, ...deps })).toEqual([]);
      expect(
        pruneIllegalPendingTriggeredEffects({ state: replaced, ...deps })
          .pendingTriggeredEffects
      ).toEqual([]);
    }
  );
});

it("取得済みの未宣言神託actionも再入場個体では効果を実行しない", () => {
  const { state, pending, deps } = fixture(mechanics[0]!);
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...deps,
  }).find((candidate) => candidate.kind === "resolve_pending_triggered_effect");
  expect(action?.kind).toBe("resolve_pending_triggered_effect");
  if (action?.kind !== "resolve_pending_triggered_effect") return;
  const replaced = replaceSource(state, "reenter");
  const result = applyMechanicTriggeredEffect(
    { state: replaced, action, ...deps },
    pending,
    action
  ).state;
  expect(result.pendingTriggeredEffects).toEqual([]);
  expect(result.stackWindow).toBeNull();
  expect(result.cardInstances[0]!.normalCoreCount).toBe(1);
  expect(result.players[0]!.voidNormalCoreCount).toBe(10);
});

it("宣言した解封のコアは、応答中に再入場した別の場の個体へ置かない", () => {
  const { state, pending, deps } = fixture(mechanics[3]!);
  if (pending.mechanic?.kind !== "unseal") throw new Error("Expected unseal");
  expect(
    resolveUnsealMechanic(
      state,
      pending.mechanic,
      "alice",
      true,
      deps.getCardDefinitionById,
      "unseal-resolution"
    ).cardInstances[0]!.normalCoreCount
  ).toBe(2);
  const replaced = replaceSource(state, "reenter");
  expect(
    resolveUnsealMechanic(
      replaced,
      pending.mechanic,
      "alice",
      true,
      deps.getCardDefinitionById,
      "unseal-resolution"
    ).cardInstances[0]!.normalCoreCount
  ).toBe(1);
});

it("turnReservation は場の個体に依存せず、付与元移動後も宣言窓を開く", () => {
  const { state, pending, deps } = fixture(mechanics[5]!, true);
  const moved = moveCardZone(state, "source", "trash");
  expect(
    getTriggeredMechanicActivationState(
      moved,
      pending.mechanic!,
      deps.getCardDefinitionById
    ).canActivate
  ).toBe(true);
  const action = getLegalActions({
    state: moved,
    actingPlayerId: "alice",
    ...deps,
  }).find((candidate) => candidate.kind === "resolve_pending_triggered_effect");
  if (action?.kind !== "resolve_pending_triggered_effect")
    throw new Error("Expected reservation declaration");
  const declared = applyMechanicTriggeredEffect(
    { state: moved, action, ...deps },
    pending,
    action
  ).state;
  expect(
    declared.stackWindow?.pendingStackAction?.triggeredPendingSnapshot
  ).toMatchObject({ pendingId: pending.pendingId });
});
