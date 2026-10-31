import { describe, expect, it } from "vitest";
import { createEmptyGameState } from "../src/factories";
import type { GameState, PendingTriggeredEffect } from "../src/model";
import { restorePendingSchedulingAfterRollback } from "../src/effect/pending-resolution-policy";

// 保存状態の復元契約を検査する。実カードの到達・操作は trigger-rollback.test.ts。
function queues(owner: string, pendingId: string, chainId: string) {
  const p: PendingTriggeredEffect = {
    pendingId,
    chainId,
    actingPlayerId: owner,
    eventKind: "summon",
    source: "action_resolution",
    attackId: null,
    relatedPlayerId: owner,
    relatedInstanceId: "source",
    amount: 1,
    step: "main",
    window: "none",
    resolvedSourceInstanceIds: [],
    resolvedSourceRegistrationKeys: [`${pendingId}#0`],
    simultaneousGroupId: "same-occurrence",
  };
  return {
    pendingTriggeredEffects: p,
    pendingDeferredTriggeredEffects: p,
    pendingPrivateDeclarations: {
      ...p,
      declarationId: pendingId,
      ownerPlayerId: owner,
      sourceInstanceId: "source",
      sourceDefinitionId: "source",
      sourceKind: "spirit" as const,
      sourceZone: "hand" as const,
      registrationIndex: 0,
    },
    pendingBurstChecks: {
      ...p,
      checkId: pendingId,
      eventKind: "summon" as const,
      relatedPlayerId: owner,
      amount: 1,
      resolvedBurstCardInstanceIds: [pendingId],
    },
  };
}
describe("巻き戻しで外側の誘発スケジューラを復元しない", () => {
  for (const key of [
    "pendingTriggeredEffects",
    "pendingDeferredTriggeredEffects",
    "pendingPrivateDeclarations",
    "pendingBurstChecks",
  ] as const)
    for (const owner of ["alice", "bob"])
      for (const saved of [false, true]) {
        it(`${key} ${owner} JSON=${saved}: 同一本文と外側の誘発の追加・消費・登録更新を保持`, () => {
          const root = createEmptyGameState({ playerIds: ["alice", "bob"] });
          const make = (id: string, chain: string) =>
            queues(owner, id, chain)[key];
          const ownChain = "trigger:parent:cause";
          let snapshot: GameState = {
            ...root,
            [key]: [
              make("consumed-outer", "parent"),
              make("updated", "parent"),
              make("own-before", ownChain),
            ],
          };
          let current: GameState = {
            ...root,
            [key]: [
              make("updated", "parent"),
              make("added-outer", "parent"),
              make("own-after", ownChain),
              make("new-child", `trigger:${ownChain}:child`),
              make("similar-id", "trigger:parent:causes"),
            ],
          };
          // 単純unionでは、古い登録や消費済み項目が復活する。
          Object.assign(snapshot[key][1]!, { amount: 2 });
          if (saved) {
            snapshot = JSON.parse(JSON.stringify(snapshot));
            current = JSON.parse(JSON.stringify(current));
          }
          const result = restorePendingSchedulingAfterRollback(
            snapshot,
            current
          );
          expect(result[key]).toEqual([
            make("updated", "parent"),
            make("added-outer", "parent"),
            make("own-after", ownChain),
            make("new-child", `trigger:${ownChain}:child`),
            make("similar-id", "trigger:parent:causes"),
          ]);
          expect(snapshot[key]).toHaveLength(3);
          expect(current[key]).toHaveLength(5);
        });
      }
});
