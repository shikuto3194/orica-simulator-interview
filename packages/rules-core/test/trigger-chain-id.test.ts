import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  collectGameStateInvariantIssues,
  getLegalActions,
  applyLegalAction,
  queuePendingReactionsRawForTesting,
  createCardInstance,
  buildTriggeredEffectLookup,
  type CardDefinition,
  type GameState,
} from "../src";
import { createMechanicPendingTriggeredEffect } from "../src/model";
import {
  restoreSnapshot,
  parseGameSnapshot,
  GAME_SNAPSHOT_SCHEMA_VERSION,
} from "../src/snapshot";
import { executeEffect } from "../src/effect/effect-interpreter";
import { pendingTriggerChainEntries } from "../src/chain-id";

describe("条件成立による派生の原因と元事象を保存する", () => {
  const makeState = () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const pending = createMechanicPendingTriggeredEffect({
      state: base,
      pendingId: "original:qualified:trigger:qualifier",
      actingPlayerId: "alice",
      relatedInstanceId: "stone",
      mechanic: { kind: "stone_rebirth", grandstoneInstanceId: "stone" },
      chainId: "original-cause",
    });
    return {
      ...base,
      pendingTriggeredEffects: [
        {
          ...pending,
          simultaneousGroupId: "original-group",
          activationPriority: {
            causedByChainId: "trigger:qualifier",
            simultaneousGroupId: "derived-group",
            originalPendingId: "original",
          },
        },
      ],
    };
  };

  it("JSON 復元で元事象と派生の優先順位を両方保持する", () => {
    const state = makeState();
    const saved = JSON.parse(
      JSON.stringify({
        schemaVersion: GAME_SNAPSHOT_SCHEMA_VERSION,
        savedAt: "2026-11-15T12:00:00.000Z",
        state,
      })
    );
    expect(parseGameSnapshot(saved).ok).toBe(true);
    const restored = restoreSnapshot(saved, () => undefined).state;
    expect(restored.pendingTriggeredEffects[0]).toMatchObject({
      pendingId: state.pendingTriggeredEffects[0]!.pendingId,
      chainId: "original-cause",
      simultaneousGroupId: "original-group",
      activationPriority: state.pendingTriggeredEffects[0]!.activationPriority,
    });
  });

  for (const key of [
    "causedByChainId",
    "simultaneousGroupId",
    "originalPendingId",
  ] as const) {
    it.each([undefined, null, "", "  "])(
      `${key}=%s を保存復元や操作時に推測で補完しない`,
      (invalid) => {
        const state = makeState();
        Object.assign(state.pendingTriggeredEffects[0]!.activationPriority, {
          [key]: invalid,
        });
        const snapshot = {
          schemaVersion: GAME_SNAPSHOT_SCHEMA_VERSION,
          savedAt: "2026-11-15T12:00:00.000Z",
          state,
        };
        const path = `pendingTriggeredEffects[0].activationPriority.${key}`;
        expect(collectGameStateInvariantIssues(state)).toContainEqual(
          expect.objectContaining({ code: "invalid_trigger_chain_id", path })
        );
        expect(parseGameSnapshot(snapshot)).toEqual({
          ok: false,
          error: `Invalid trigger chainId: ${path}`,
        });
        expect(() => restoreSnapshot(snapshot, () => undefined)).toThrow(path);
        expect(() =>
          getLegalActions({ state, actingPlayerId: "alice" } as never)
        ).toThrow(path);
        expect(() =>
          applyLegalAction({ state, action: { kind: "advance_step" } } as never)
        ).toThrow(path);
      }
    );
  }

  it("中断したスタックに保存された元待機効果も検査する", () => {
    const state = makeState();
    const pending = state.pendingTriggeredEffects[0]!;
    const nested = {
      ...state,
      pendingTriggeredEffects: [],
      pendingStackCascade: {
        remainingStacks: [
          {
            chainId: "trigger:qualifier:stack",
            triggeredPendingSnapshot: {
              ...pending,
              activationPriority: {
                ...pending.activationPriority,
                originalPendingId: "",
              },
            },
          },
        ],
      },
    } as unknown as GameState;
    expect(pendingTriggerChainEntries(nested)).toContainEqual({
      chainId: "",
      path: "pendingStackCascade.remainingStacks[0].triggeredPendingSnapshot.activationPriority.originalPendingId",
    });
  });
});

describe("待機済み誘発の chainId は空を許可しない", () => {
  it.each([null, undefined, "", "  "])(
    "%s を推測で補完せず拒否する",
    (chainId) => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const pending = createMechanicPendingTriggeredEffect({
        state: base,
        pendingId: "test",
        actingPlayerId: "alice",
        relatedInstanceId: "stone",
        mechanic: { kind: "stone_rebirth", grandstoneInstanceId: "stone" },
        chainId: "cause",
      });
      const state = {
        ...base,
        pendingTriggeredEffects: [{ ...pending, chainId }],
      } as typeof base;
      expect(collectGameStateInvariantIssues(state)).toContainEqual(
        expect.objectContaining({
          code: "invalid_trigger_chain_id",
          path: "pendingTriggeredEffects[0].chainId",
        })
      );
      expect(() =>
        getLegalActions({ state, actingPlayerId: "alice" } as never)
      ).toThrow(/chainId/);
      expect(() =>
        applyLegalAction({ state, action: { kind: "advance_step" } } as never)
      ).toThrow(/chainId/);
      expect(() =>
        createMechanicPendingTriggeredEffect({
          ...pending,
          state,
          chainId,
        } as never)
      ).toThrow(/chainId/);
      expect(() =>
        queuePendingReactionsRawForTesting(base, [
          { ...pending, chainId },
        ] as never)
      ).toThrow(/chainId/);
      expect(() => executeEffect({ state: base, chainId } as never)).toThrow(
        /chainId/
      );
      for (const queue of [
        "pendingTriggeredEffects",
        "pendingDeferredTriggeredEffects",
        "pendingPrivateDeclarations",
        "pendingBurstChecks",
      ] as const) {
        const corrupt = {
          ...base,
          [queue]: [{ ...pending, chainId }],
        } as typeof base;
        expect(() =>
          getLegalActions({ state: corrupt, actingPlayerId: "alice" } as never)
        ).toThrow(/chainId/);
        expect(() =>
          restoreSnapshot(
            {
              schemaVersion: GAME_SNAPSHOT_SCHEMA_VERSION,
              savedAt: "2026-09-25T12:31:52.843Z",
              state: corrupt,
            },
            () => undefined
          )
        ).toThrow(new RegExp(`${queue}\\[0\\]\\.chainId`));
        expect(
          parseGameSnapshot({
            schemaVersion: 2,
            savedAt: "2026-09-25T12:31:52.843Z",
            state: corrupt,
          })
        ).toEqual({
          ok: false,
          error: `Invalid trigger chainId: ${queue}[0].chainId`,
        });
      }
    }
  );
});

describe("保存された効果発揮後の継続も原因IDを必須とする", () => {
  const source: CardDefinition = {
    cardNo: "TEST-CHAIN-CONTINUATION",
    name: "継続",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    keywordTags: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 1 } },
          { connector: "after_triggers", action: { kind: "draw", count: 1 } },
        ],
      },
      {
        timing: { kind: "game_event", event: "count_decrease", player: "self" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 3 } },
        ],
      },
    ],
  };
  const lookups = {
    getCardDefinitionById: (id: string) =>
      id === source.cardNo ? source : undefined,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([source]),
  };
  const pendingState = () =>
    executeEffect({
      state: createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 3 }, {}],
        cardInstances: [
          createCardInstance(source, {
            instanceId: "source",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      effect: source.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      chainId: "cause:child",
      ...lookups,
    });
  for (const key of ["chainId", "waitChainId"] as const) {
    it.each([undefined, null, "", "  "])(
      `${key}=%s を snapshot・操作・不変条件で拒否する`,
      (invalid) => {
        const valid = pendingState();
        expect(valid.pendingAfterTriggersContinuations).toHaveLength(1);
        const state = JSON.parse(JSON.stringify(valid)) as GameState;
        Object.assign(state.pendingAfterTriggersContinuations[0]!, {
          [key]: invalid,
        });
        const snapshot = {
          schemaVersion: GAME_SNAPSHOT_SCHEMA_VERSION,
          savedAt: "2026-09-26T00:00:00.000Z",
          state,
        };
        expect(parseGameSnapshot(snapshot).ok).toBe(false);
        expect(() =>
          restoreSnapshot(snapshot, lookups.getCardDefinitionById)
        ).toThrow(/chainId/);
        expect(() =>
          getLegalActions({ state, actingPlayerId: "alice", ...lookups })
        ).toThrow(/chainId/);
        expect(collectGameStateInvariantIssues(state)).toContainEqual(
          expect.objectContaining({
            code: "invalid_trigger_chain_id",
            path: `pendingAfterTriggersContinuations[0].${key}`,
          })
        );
      }
    );
  }
  it("差分計算用の過去盤面へ再帰せず、保存済みの入れ子継続を辿る", () => {
    const state = pendingState();
    const continuation = state.pendingAfterTriggersContinuations[0]!;
    const withHistory: GameState = {
      ...state,
      pendingAfterTriggersContinuations: [
        {
          ...continuation,
          effectResolutionBeforeState: {
            ...state,
            pendingAfterTriggersContinuations: [
              { ...continuation, chainId: "" },
            ],
          },
        },
      ],
    };
    expect(pendingTriggerChainEntries(withHistory)).not.toContainEqual(
      expect.objectContaining({ chainId: "" })
    );
    const nested = {
      ...state,
      pendingCoreShootSelection: {
        continuation: { ...continuation, chainId: "" },
      },
    } as unknown as GameState;
    expect(pendingTriggerChainEntries(nested)).toContainEqual({
      chainId: "",
      path: "pendingCoreShootSelection.continuation.chainId",
    });
  });
});
