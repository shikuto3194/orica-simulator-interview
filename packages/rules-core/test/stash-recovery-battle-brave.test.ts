import { describe, expect, it } from "vitest";
import { canFireBattleEndDeferral } from "../src/battle/battle-end-deferral-gate";
import { removeBattleEntityMembersAndRecompute } from "../src/battle/battle-shared";
import {
  createActiveAttack,
  createCardInstance,
  createEmptyGameState,
} from "../src";
import type {
  CardDefinition,
  GameState,
  PendingBattleEndDeferral,
} from "../src/model";

const ALICE = "alice";

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

describe("paused stash battle/brave recovery", () => {
  it("uses a captured source_card reference for a direct battle-end self target", () => {
    const hostDef = spiritDef("RECOVERY-BED-HOST");
    const braveDef = spiritDef("RECOVERY-BED-BRAVE");
    const host = {
      instanceId: "recovery-host",
      definitionId: hostDef.cardNo,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
      pendingLeaveKind: null,
    };
    const brave = {
      instanceId: "recovery-brave",
      definitionId: braveDef.cardNo,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      pendingLeaveKind: null,
    };
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, "bob"],
        cardInstances: [host, brave],
      }),
    } as GameState;
    const deferral: PendingBattleEndDeferral = {
      deferralId: "recovery:deferral",
      attackId: "attack-recovery",
      actingPlayerId: ALICE,
      sourceInstanceId: host.instanceId,
      sourceDefinitionId: hostDef.cardNo,
      sourceCardReferenceInstanceId: brave.instanceId,
      activationZone: "field",
      sourceOnFieldRequired: true,
      effectIndex: 0,
      resumeEffectOverride: {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        steps: [
          {
            action: {
              kind: "destroy",
              target: { kind: "source_card" },
            },
          },
        ],
        textRef: [0],
      },
    };
    const lookup = (id: string): CardDefinition | undefined =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;

    expect(
      canFireBattleEndDeferral({
        state,
        deferral,
        getCardDefinitionById: lookup,
      })
    ).toBe(true);
  });

  it("automatically keeps a surviving brave blocking when its primary host leaves", () => {
    const hostDef = spiritDef("RECOVERY-BLOCK-HOST");
    const braveDef = {
      ...spiritDef("RECOVERY-BLOCK-BRAVE"),
      printedCategory: "brave" as const,
    };
    const lookup = (id: string): CardDefinition | undefined =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, "bob"],
        cardInstances: [
          createCardInstance(hostDef, {
            instanceId: "recovery-blocker-host",
            ownerPlayerId: ALICE,
            zone: "trash",
          }),
          createCardInstance(braveDef, {
            instanceId: "recovery-blocker-brave",
            ownerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 1,
            exhaustState: "exhausted",
          }),
        ],
      }),
      battleEntities: [
        {
          entityId: "battle-entity:recovery-blocker",
          memberInstanceIds: [
            "recovery-blocker-host",
            "recovery-blocker-brave",
          ],
          resolvedBp: 6000,
          resolvedSymbols: ["red"],
          attackState: "blocking" as const,
        },
      ],
    } as GameState;

    state.activeAttack = {
      ...createActiveAttack(state, "battle-entity:attacker", ALICE),
      blockAssignments: [
        {
          participantEntityId: "battle-entity:attacker",
          blockedByEntityIds: ["battle-entity:recovery-blocker"],
        },
      ],
    };
    const next = removeBattleEntityMembersAndRecompute(
      state,
      ["recovery-blocker-host"],
      lookup
    );

    expect(next.battleEntities).toEqual([
      expect.objectContaining({
        entityId: "battle-entity:recovery-blocker",
        memberInstanceIds: ["recovery-blocker-brave"],
        resolvedBp: 3000,
        resolvedSymbols: ["red"],
        attackState: "blocking",
      }),
    ]);
  });
});
