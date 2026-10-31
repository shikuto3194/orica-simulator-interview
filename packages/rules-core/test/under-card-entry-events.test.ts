import { recordSemanticTriggerEvent } from "../src/effect/semantic-trigger-events";
import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  collectTriggerEventsFromStateDelta,
  collectAndQueueTriggerReactions,
} from "../src/effect/trigger-system";
import { createGameSnapshot, restoreSnapshot } from "../src/snapshot";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  dioscuriaLookup as lookup,
  dioscuriaTriggers,
  dioscuriaUnderCardState,
} from "./helpers/dioscuria-under-cards";

describe("下カード追加は召喚・配置・合体ではない", () => {
  for (const no of ["BSAZ02-C10", "BSAZ02-C03", "BSAZ02-X05", "BSTH01-C04"]) {
    for (const zone of ["hand", "trash", "deck", "field"] as const) {
      for (const role of ["text_role", "advent_source"] as const) {
        it(`${no} ${zone} → ${role}`, () => {
          const host = createCardInstance(lookup("BSAZ02-TX01(B)")!, {
            instanceId: "host",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 5,
          });
          const child = createCardInstance(lookup(no)!, {
            instanceId: "child",
            ownerPlayerId: "alice",
            zone,
          });
          const beforeState = createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [host, child],
          });
          const afterState = {
            ...beforeState,
            cardInstances: [
              {
                ...host,
                underCards: [
                  {
                    cardInstanceId: child.instanceId,
                    role,
                    roleTag: "テスト役",
                  },
                ],
              },
              {
                ...child,
                zone: "field" as const,
                zoneRoleName: lookup(no)!.printedCategory,
                attachedToInstanceId: host.instanceId,
              },
            ],
          };
          const events = collectTriggerEventsFromStateDelta({
            beforeState,
            afterState,
            source: "action_resolution",
            getCardDefinitionById: lookup,
          });
          expect(
            events.filter((e) =>
              ["summon", "place", "advent", "brave_combined"].includes(
                e.eventKind
              )
            )
          ).toEqual([]);
          expect(
            events.filter((e) => e.eventKind === "text_role_under_card_placed")
          ).toHaveLength(role === "text_role" ? 1 : 0);
        });
      }
    }
  }

  it("実際の直接合体召喚は召喚と合体を各1回通知する", () => {
    const host = createCardInstance(lookup("BSTH01-C04")!, {
      instanceId: "host",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const brave = createCardInstance(lookup("BSAZ02-C10")!, {
      instanceId: "brave",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const beforeState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
    });
    const afterState = {
      ...beforeState,
      cardInstances: [
        { ...host, attachedChildrenIds: [brave.instanceId] },
        {
          ...brave,
          zone: "field" as const,
          zoneRoleName: "brave",
          attachedToInstanceId: host.instanceId,
        },
      ],
    };
    const events = collectTriggerEventsFromStateDelta({
      beforeState,
      afterState: recordSemanticTriggerEvent(
        recordSemanticTriggerEvent(afterState, {
          eventKind: "brave_combined",
          relatedInstanceId: "brave",
          triggerRelatedCombinedHostInstanceId: "host",
        }),
        { eventKind: "summon", relatedInstanceId: "brave", fromZone: "hand" }
      ),
      source: "action_resolution",
      getCardDefinitionById: lookup,
    });
    expect(events.map((e) => e.eventKind).sort()).toEqual([
      "brave_combined",
      "summon",
    ]);
  });

  it("ディオスクリアの実効果で3枚を加えても手札・導域・導託を誘発しない", () => {
    const beforeState = {
      ...dioscuriaUnderCardState(),
      pendingTriggeredEffects: [],
      pendingPrivateDeclarations: [],
    };
    const state = executeEffect({
      state: beforeState,
      chainId: "test:dioscuria-under",
      sourceInstanceId: "dioscuria",
      actingPlayerId: "alice",
      effect: lookup("BSAZ02-TX01(B)")!.effects![0]!,
      targetInstanceIds: ["heras", "electris", "siren"],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: dioscuriaTriggers,
    });
    const result = finalizeEffectResolution({
      state,
      beforeState,
      chainId: "test:dioscuria-under",
      endLogs: [],
      actingPlayerId: "alice",
      causedBySourceInstanceId: "dioscuria",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: dioscuriaTriggers,
      getRegisteredBurstActions: undefined,
    });
    expect(
      result.cardInstances
        .find((c) => c.instanceId === "dioscuria")!
        .underCards.map((u) => u.cardInstanceId)
    ).toEqual(expect.arrayContaining(["heras", "electris", "siren"]));
    expect(result.pendingTriggeredEffects).toEqual([]);
    expect(result.pendingPrivateDeclarations).toEqual([]);
    expect(
      result.cardInstances.find((c) => c.instanceId === "remrina")!
        .normalCoreCount
    ).toBe(1);
  });

  it("正式なsnapshot復元で下カードに紐付く召喚キューを公開・非公開とも除去する", () => {
    const beforeState = {
      ...dioscuriaUnderCardState(),
      pendingTriggeredEffects: [],
      pendingPrivateDeclarations: [],
    };
    // 通常召喚を仮定した旧版のキューを作り、保存状態と同じ下カード所属を復元する。
    const summoned = {
      ...beforeState,
      cardInstances: beforeState.cardInstances.map((c) =>
        c.instanceId === "heras"
          ? {
              ...c,
              zone: "field" as const,
              zoneRoleName: "ultimate",
              normalCoreCount: 1,
            }
          : c
      ),
    };
    const queued = collectAndQueueTriggerReactions({
      beforeState,
      afterState: summoned,
      source: "action_resolution",
      chainId: "legacy-under-summon",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: dioscuriaTriggers,
      getRegisteredBurstActions: undefined,
    });
    expect(queued.pendingTriggeredEffects.length).toBeGreaterThan(0);
    expect(queued.pendingPrivateDeclarations).toHaveLength(3);
    const restored = {
      ...queued,
      cardInstances: queued.cardInstances.map((c) =>
        c.instanceId === "dioscuria"
          ? {
              ...c,
              underCards: [
                ...c.underCards,
                {
                  cardInstanceId: "heras",
                  role: "text_role" as const,
                  roleTag: "ＣＦアルティメット",
                },
              ],
            }
          : c.instanceId === "heras"
            ? { ...c, attachedToInstanceId: "dioscuria", normalCoreCount: 0 }
            : c
      ),
    };
    const { state: pruned, warnings } = restoreSnapshot(
      createGameSnapshot(restored),
      lookup,
      {
        getRegisteredTriggeredEffectActions: dioscuriaTriggers,
      }
    );
    expect(pruned.pendingTriggeredEffects).toEqual([]);
    expect(pruned.pendingPrivateDeclarations).toEqual([]);
    expect(
      warnings.some((warning) =>
        warning.includes("3 orphan pendingPrivateDeclarations")
      )
    ).toBe(true);
    expect(restored.pendingPrivateDeclarations).toHaveLength(3);
  });
});
