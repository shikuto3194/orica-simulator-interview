import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  queuePendingLeave,
  rebuildContinuousEffectsFromField,
  runStateBasedActions,
  type PendingLeaveKind,
} from "../src";
import { getAvailableBraveSeparationCoreSources } from "../src/legal/legal-actions-shared";
import { moveNormalCoresForBraveSeparation } from "../src/legal/brave-combine-state-helpers";
import { buildChargeCoresPendingCoreDistribution } from "../src/mechanics/core-charge-distribution";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const getDef = (id: string) => definitions.find((d) => d.cardNo === id);
function setup(kind: PendingLeaveKind, restricted = false) {
  const donor = createCardInstance(
    getDef(restricted ? "BSDB01-TX01(B)" : "BSSA01-転醒X03(A)")!,
    {
      instanceId: "donor",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: restricted ? 1 : 0,
    }
  );
  const brave = createCardInstance(getDef("BSSA01-転醒X02(A)")!, {
    instanceId: "brave",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 0,
  });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [donor, brave],
    playerOverrides: [
      {
        reserveNormalCoreCount: 0,
        soulCoreLocation: restricted
          ? { kind: "card", instanceId: donor.instanceId }
          : { kind: "trash" },
      },
      {},
    ],
  });
  return queuePendingLeave({
    state: rebuildContinuousEffectsFromField(state, getDef),
    instanceId: donor.instanceId,
    kind,
    cause: "effect_resolution",
    causePlayerId: "bob",
    chainId: "original-leave",
    deferZoneMoveUntilChainEnd: true,
  });
}

describe("分離コアの待機カード供給元", () => {
  it.each(["destroy", "bounce", "vanish"] as const)(
    "%s待機のコアをすべて使っても元の離脱理由とチェーンを保持する",
    (kind) => {
      const before = setup(kind);
      expect(
        getAvailableBraveSeparationCoreSources(before, "alice", "brave", getDef)
      ).toEqual([
        {
          key: "donor",
          container: { kind: "card", instanceId: "donor" },
          available: 2,
        },
      ]);
      const moved = moveNormalCoresForBraveSeparation(
        before,
        "alice",
        "brave",
        2,
        getDef
      );
      const after = runStateBasedActions(moved, getDef).state;
      expect(
        after.cardInstances.find((c) => c.instanceId === "donor")
      ).toMatchObject({
        normalCoreCount: 0,
        pendingLeaveKind: kind,
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "original-leave",
      });
      expect(
        after.cardInstances.find((c) => c.instanceId === "brave")
          ?.normalCoreCount
      ).toBe(2);
      expect(after.players[0]?.reserveNormalCoreCount).toBe(0);
      expect(after.pendingLeaveEntities).toEqual(before.pendingLeaveEntities);
      expect(after.pendingTriggeredEffects).toEqual(
        before.pendingTriggeredEffects
      );
    }
  );
  it("待機中でも通常コア移動禁止を守り、移動可能なソウルコアだけを候補にする", () => {
    const before = setup("destroy", true);
    const pending = buildChargeCoresPendingCoreDistribution(
      before,
      "alice",
      "brave",
      "BSSA01-転醒X02(A)",
      getDef,
      "waiting-charge"
    );
    expect(pending?.sourceAvailable).toEqual({ reserve: 0 });
    expect(pending?.soulSourceAvailable).toEqual({ "field:donor": 1 });
    expect(
      getAvailableBraveSeparationCoreSources(before, "alice", "brave", getDef)
    ).toEqual([]);
    expect(() =>
      moveNormalCoresForBraveSeparation(before, "alice", "brave", 1, getDef)
    ).toThrow("Not enough cores to separate brave");
    expect(
      before.cardInstances.find((c) => c.instanceId === "donor")
    ).toMatchObject({ normalCoreCount: 2, soulCoreCount: 1 });
  });
});
