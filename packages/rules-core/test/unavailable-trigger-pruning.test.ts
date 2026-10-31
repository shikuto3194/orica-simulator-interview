import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { pruneIllegalPendingTriggeredEffects } from "../src/effect/trigger-system";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import type {
  CardDefinition,
  PendingTriggeredEffect,
  PendingPrivateDeclaration,
} from "../src/model";

function fixture(conditional: boolean, privateZone = false) {
  const definition: CardDefinition = {
    cardNo: "TEST-EMPTY-DESTROY",
    name: "テスト破壊効果",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    symbolColors: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "game_event", event: "increase_hand", player: "self" },
        executionMode: "optional",
        ...(privateZone ? { applicability: { zone: ["hand" as const] } } : {}),
        ...(conditional
          ? {
              condition: [
                {
                  kind: "field_has" as const,
                  player: "self" as const,
                  cardNames: [{ exact: "条件用カード" }],
                },
              ],
            }
          : {}),
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
      },
    ],
  };
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(definition, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: privateZone ? "hand" : "field",
        normalCoreCount: privateZone ? 0 : 1,
      }),
    ],
  });
  const pending: PendingTriggeredEffect = {
    pendingId: "test-pending",
    actingPlayerId: "alice",
    eventKind: "increase_hand",
    source: "action_resolution",
    chainId: "test-chain",
    attackId: null,
    relatedPlayerId: "alice",
    relatedInstanceId: null,
    amount: 1,
    step: state.step,
    window: state.window,
    resolvedSourceInstanceIds: [],
  };
  const declaration: PendingPrivateDeclaration = {
    ...pending,
    declarationId: "test-private",
    ownerPlayerId: "alice",
    sourceInstanceId: "source",
    sourceDefinitionId: definition.cardNo,
    sourceKind: "spirit",
    sourceZone: "hand",
    registrationIndex: 0,
  };
  const deps = {
    getCardDefinitionById: (id: string) =>
      id === definition.cardNo ? definition : undefined,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
      definition,
    ]),
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
  };
  return { state, pending, declaration, deps };
}

describe("発揮条件未達・対象不在・宣言後の不発を区別する", () => {
  it.each([false, true])(
    "宣言前: 対象0体の破壊は残すが、存在条件未達なら除去（private=%s）",
    (privateZone) => {
      for (const conditional of [false, true]) {
        const { state, pending, declaration, deps } = fixture(
          conditional,
          privateZone
        );
        state.pendingTriggeredEffects = privateZone ? [] : [pending];
        state.pendingPrivateDeclarations = privateZone ? [declaration] : [];
        const after = pruneIllegalPendingTriggeredEffects({ state, ...deps });
        expect(
          privateZone
            ? after.pendingPrivateDeclarations.length
            : after.pendingTriggeredEffects.length
        ).toBe(conditional ? 0 : 1);
      }
    }
  );
  it("対象0体の破壊は宣言・解決できる", () => {
    const { state: initial, pending, deps } = fixture(false);
    let state = { ...initial, pendingTriggeredEffects: [pending] };
    for (
      let i = 0;
      i < 6 && (state.pendingTriggeredEffects.length || state.stackWindow);
      i++
    ) {
      const legal = getLegalActions({
        state,
        actingPlayerId: state.stackWindow?.priorityPlayerId ?? "alice",
        ...deps,
      });
      const action =
        legal.find((a) => a.kind === "pass_stack") ??
        legal.find(
          (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
        );
      expect(action, JSON.stringify(legal)).toBeDefined();
      state = applyLegalAction({ state, action: action!, ...deps }).state;
    }
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(
      state.log.some((line) => line.includes("trigger:pruned-illegal"))
    ).toBe(false);
    expect(state.cardInstances).toHaveLength(1);
  });
  it("宣言済みは条件未達でも除去せず、最後の未宣言候補除去で保留を解く", () => {
    const { state, pending, declaration, deps } = fixture(true, true);
    state.pendingPrivateDeclarations = [declaration];
    state.pendingDeferredTriggeredEffects = [
      { ...pending, pendingId: "declared", declaredFromPrivateZone: true },
    ];
    const after = pruneIllegalPendingTriggeredEffects({ state, ...deps });
    expect(after.pendingPrivateDeclarations).toHaveLength(0);
    expect(after.pendingDeferredTriggeredEffects).toHaveLength(0);
    expect(after.pendingTriggeredEffects[0]?.pendingId).toBe("declared");
    expect(
      pruneIllegalPendingTriggeredEffects({ state: after, ...deps })
        .pendingTriggeredEffects
    ).toHaveLength(1);
  });
});
