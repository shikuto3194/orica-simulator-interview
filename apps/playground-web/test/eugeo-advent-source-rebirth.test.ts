import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  createGameSnapshot,
  restoreSnapshot,
  refreshPendingRebirthSeparationCoreSources,
  collectGameStateInvariantIssues,
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  sanitizeStateForViewer,
  maskPendingPromptsForViewer,
  type GameState,
} from "@orica/rules-core";
import { getPendingTriggeredRebirthTimingWindowId } from "../../../packages/rules-core/src/effect/structured-card-replacement";
import { projectRebirthCorePlacementPreview } from "../src/utils/rebirth-core-placement-preview";
import { buildEugeoRebirthScenario } from "../src/scenario-eugeo-rebirth";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookups = {
  getCardDefinitionById: (id: string) =>
    definitions.find((d) => d.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredFieldCardEffectActions: () => [],
};
const cores = (s: GameState) =>
  s.cardInstances.reduce((n, c) => n + c.normalCoreCount + c.soulCoreCount, 0) +
  s.players.reduce(
    (n, p) =>
      n +
      p.reserveNormalCoreCount +
      p.reserveSoulCoreCount +
      p.trashNormalCoreCount +
      p.trashSoulCoreCount +
      p.lifeNormalCoreCount +
      p.lifeSoulCoreCount +
      p.voidNormalCoreCount +
      p.countValue,
    0
  );
function selectSword(state: GameState, owner: string) {
  const action = getLegalActions({
    state,
    actingPlayerId: owner,
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_effect_target")!;
  return applyLegalAction({
    state,
    action,
    targetInstanceIds: ["eugeo-sword"],
    ...lookups,
  }).state;
}
function placeCores(
  state: GameState,
  owner: string,
  sources: Record<string, number>
) {
  const action = getLegalActions({
    state,
    actingPlayerId: owner,
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_core_distribution")!;
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action,
    ...lookups,
    coreDistributionAllocations: {
      "eugeo-sword": Object.values(sources).reduce((a, b) => a + b, 0),
    },
    coreDistributionSourceAllocations: sources,
  }).state;
}
function resolve(state: GameState, owner: string) {
  const pending = selectSword(state, owner);
  if (!pending.pendingCoreDistribution) return pending;
  const sources = pending.pendingCoreDistribution.sourceAvailable!;
  const source = Object.entries(sources).find(([, n]) => n > 0)![0];
  return placeCores(pending, owner, { [source]: 1 });
}
describe("ユージオの煌臨元転醒の解決完了", () => {
  it.each(["alice", "bob"])(
    "%s: 自身の煌臨元だけを選び、剣が残りユージオを煌臨元へ追加する",
    (owner) => {
      const before = buildEugeoRebirthScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      expect(before.pendingEffectTargetSelection?.candidateInstanceIds).toEqual(
        ["eugeo-sword"]
      );
      const after = resolve(before, owner);
      const sword = after.cardInstances.find(
        (c) => c.instanceId === "eugeo-sword"
      )!;
      const host = after.cardInstances.find(
        (c) => c.instanceId === "eugeo-host"
      )!;
      expect(sword).toMatchObject({
        zone: "field",
        definitionId: "BSSA01-転醒X02(B)",
        normalCoreCount: 1,
        attachedToInstanceId: null,
        exhaustState: "exhausted",
      });
      expect(sword.underCards).toContainEqual({
        role: "advent_source",
        cardInstanceId: host.instanceId,
      });
      expect(host).toMatchObject({
        zone: "field",
        zoneRoleName: "advent-source",
        definitionId: "BSSA01-転醒X03(A)",
        normalCoreCount: 0,
        underCards: [],
        pendingLeaveKind: null,
      });
      expect(after.pendingLeaveEntities).toEqual([]);
      expect(after.players.find((p) => p.id === owner)?.countValue).toBe(4);
      expect(cores(after)).toBe(cores(before));
      expect(collectGameStateInvariantIssues(after)).toEqual([]);
      expect(
        after.pendingTriggeredEffects.some(
          (p) =>
            p.eventKind === "rebirth" &&
            p.relatedInstanceId === sword.instanceId
        )
      ).toBe(true);
      expect(
        after.cardInstances.find((c) => c.instanceId === "eugeo-other-sword")
          ?.definitionId
      ).toBe("BSSA01-転醒X02(A)");
    }
  );
  it("剣を選んだ後は自動補填せずHUDで供給元と任意個数を選び、確定して転醒する", () => {
    const before = buildEugeoRebirthScenario(ALL_CARDS);
    const pending = selectSword(before, "alice");
    expect(pending.pendingCoreDistribution).toMatchObject({
      fromKind: "any_movable",
      minTotal: 1,
      candidates: [
        { instanceId: "eugeo-sword", definitionId: "BSSA01-転醒X02(B)" },
      ],
      rebirthCompletion: {
        deferredAction: { asIfCombinedWithInstanceId: "eugeo-host" },
      },
    });
    expect(pending.pendingCoreDistribution?.sourceAvailable).toEqual({
      reserve: 1,
      "field:eugeo-host": 2,
      "field:eugeo-other-host": 1,
      "field:eugeo-loose-sword": 1,
    });
    expect(
      pending.cardInstances.find((c) => c.instanceId === "eugeo-sword")
    ).toMatchObject({ definitionId: "BSSA01-転醒X02(A)", normalCoreCount: 0 });
    expect(pending.players.find((p) => p.id === "alice")?.countValue).toBe(3);
    expect(pending.pendingLeaveEntities).toHaveLength(1);
    const after = placeCores(pending, "alice", {
      reserve: 1,
      "field:eugeo-loose-sword": 1,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "eugeo-sword")
    ).toMatchObject({ definitionId: "BSSA01-転醒X02(B)", normalCoreCount: 2 });
    expect(after.pendingCoreDistribution).toBeNull();
    expect(cores(after)).toBe(cores(before));
  });
  it.each(["empty", "abort"])(
    "%s: コアを配置せず取り消したら転醒せず、元の離脱を完了する",
    (mode) => {
      const before = buildEugeoRebirthScenario(ALL_CARDS);
      const pending = selectSword(before, "alice");
      const abort = getLegalActions({
        state: pending,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.kind === "abort_pending_core_distribution")!;
      const after =
        mode === "empty"
          ? placeCores(pending, "alice", {})
          : applyLegalAction({ state: pending, action: abort, ...lookups })
              .state;
      expect(
        after.cardInstances.find((c) => c.instanceId === "eugeo-sword")
      ).toMatchObject({
        definitionId: "BSSA01-転醒X02(A)",
        zone: "trash",
        normalCoreCount: 0,
      });
      expect(after.pendingCoreDistribution).toBeNull();
      expect(after.effectQueueEntries).toEqual([]);
      expect(after.pendingLeaveEntities).toEqual([]);
      expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(3);
      expect(cores(after)).toBe(cores(before));
    }
  );
  it("ソウルコアだけでも分離の最低配置数を満たせる", () => {
    const before = buildEugeoRebirthScenario(ALL_CARDS);
    const owner = before.players.find((p) => p.id === "alice")!;
    owner.reserveNormalCoreCount = 0;
    owner.reserveSoulCoreCount = 1;
    owner.trashSoulCoreCount = 0;
    owner.soulCoreLocation = { kind: "reserve" };
    const pending = selectSword(before, "alice");
    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    const after = applyLegalAction({
      state: pending,
      action,
      ...lookups,
      coreDistributionAllocations: {},
      coreDistributionSourceAllocations: {},
      coreDistributionSoulCoreAllocations: { "eugeo-sword": 1 },
      coreDistributionSoulCoreSourceAllocations: { reserve: 1 },
    }).state;
    expect(
      after.cardInstances.find((c) => c.instanceId === "eugeo-sword")
    ).toMatchObject({
      definitionId: "BSSA01-転醒X02(B)",
      normalCoreCount: 0,
      soulCoreCount: 1,
    });
    expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(4);
    expect(cores(after)).toBe(cores(before));
    expect(collectGameStateInvariantIssues(after)).toEqual([]);
  });
  it("分離プレビューはサニタイズ済み盤面だけを変更し、実状態と非解決者の表示を保持する", () => {
    const pending = selectSword(buildEugeoRebirthScenario(ALL_CARDS), "alice");
    const visible = maskPendingPromptsForViewer(
      sanitizeStateForViewer(pending, "alice"),
      "alice"
    );
    const preview = projectRebirthCorePlacementPreview(
      visible,
      lookups.getCardDefinitionById
    );
    expect(
      preview.cardInstances.find((c) => c.instanceId === "eugeo-sword")
    ).toMatchObject({
      definitionId: "BSSA01-転醒X02(B)",
      zoneRoleName: "brave",
    });
    expect(
      visible.cardInstances.find((c) => c.instanceId === "eugeo-sword")
    ).toMatchObject({
      definitionId: "BSSA01-転醒X02(A)",
      zoneRoleName: "advent-source",
    });
    expect(
      preview.cardInstances.find((c) => c.instanceId === "eugeo-host")
        ?.underCards
    ).toEqual([]);
    expect(
      pending.cardInstances.find((c) => c.instanceId === "eugeo-host")
        ?.underCards
    ).toEqual([{ role: "advent_source", cardInstanceId: "eugeo-sword" }]);
    const opponentVisible = maskPendingPromptsForViewer(
      sanitizeStateForViewer(pending, "bob"),
      "bob"
    );
    expect(
      projectRebirthCorePlacementPreview(
        opponentVisible,
        lookups.getCardDefinitionById
      )
    ).toBe(opponentVisible);
  });
  it("複数の煌臨元があっても、選ばなかったカードを失わず循環参照を作らない", () => {
    const before = buildEugeoRebirthScenario(ALL_CARDS);
    const host = before.cardInstances.find(
      (c) => c.instanceId === "eugeo-host"
    )!;
    const otherHost = before.cardInstances.find(
      (c) => c.instanceId === "eugeo-other-host"
    )!;
    host.underCards.push(...otherHost.underCards);
    otherHost.underCards = [];
    const after = resolve(before, "alice");
    expect(
      after.cardInstances.find((c) => c.instanceId === "eugeo-sword")
        ?.underCards
    ).toEqual([
      { role: "advent_source", cardInstanceId: "eugeo-host" },
      { role: "advent_source", cardInstanceId: "eugeo-other-sword" },
    ]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "eugeo-host")?.underCards
    ).toEqual([]);
    expect(cores(after)).toBe(cores(before));
  });
  it.each([1, 2])(
    "破壊待機中のユージオだけから通常コア%d個を配置できる",
    (amount) => {
      const before = buildEugeoRebirthScenario(
        ALL_CARDS,
        new URLSearchParams({ cores: "waiting" })
      );
      const pending = selectSword(before, "alice");
      expect(pending.pendingCoreDistribution?.sourceAvailable).toEqual({
        reserve: 0,
        "field:eugeo-host": 2,
      });
      expect(
        pending.cardInstances.find((c) => c.instanceId === "eugeo-host")
      ).toMatchObject({ normalCoreCount: 2, pendingLeaveKind: "destroy" });
      const after = placeCores(pending, "alice", {
        "field:eugeo-host": amount,
      });
      expect(
        after.cardInstances.find((c) => c.instanceId === "eugeo-sword")
      ).toMatchObject({
        definitionId: "BSSA01-転醒X02(B)",
        normalCoreCount: amount,
      });
      expect(after.players.find((p) => p.id === "alice")).toMatchObject({
        reserveNormalCoreCount: 2 - amount,
        countValue: 4,
      });
      expect(
        after.cardInstances.find((c) => c.instanceId === "eugeo-host")
      ).toMatchObject({
        zoneRoleName: "advent-source",
        normalCoreCount: 0,
        pendingLeaveKind: null,
      });
      expect(after.pendingLeaveEntities).toEqual([]);
      expect(cores(after)).toBe(cores(before));
      expect(collectGameStateInvariantIssues(after)).toEqual([]);
    }
  );
  it("破壊待機中のユージオだけからソウルコアを配置できる", () => {
    const before = buildEugeoRebirthScenario(
      ALL_CARDS,
      new URLSearchParams({ cores: "waiting" })
    );
    const owner = before.players.find((p) => p.id === "alice")!;
    owner.trashSoulCoreCount = 0;
    owner.soulCoreLocation = { kind: "card", instanceId: "eugeo-host" };
    const host = before.cardInstances.find(
      (c) => c.instanceId === "eugeo-host"
    )!;
    host.normalCoreCount = 0;
    host.soulCoreCount = 1;
    const pending = selectSword(before, "alice");
    expect(pending.pendingCoreDistribution?.soulSourceAvailable).toEqual({
      "field:eugeo-host": 1,
    });
    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    const after = applyLegalAction({
      state: pending,
      action,
      ...lookups,
      coreDistributionAllocations: {},
      coreDistributionSourceAllocations: {},
      coreDistributionSoulCoreAllocations: { "eugeo-sword": 1 },
      coreDistributionSoulCoreSourceAllocations: { "field:eugeo-host": 1 },
    }).state;
    expect(
      after.cardInstances.find((c) => c.instanceId === "eugeo-sword")
    ).toMatchObject({
      definitionId: "BSSA01-転醒X02(B)",
      normalCoreCount: 0,
      soulCoreCount: 1,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "eugeo-host")
    ).toMatchObject({
      zoneRoleName: "advent-source",
      soulCoreCount: 0,
      pendingLeaveKind: null,
    });
    expect(after.players.find((p) => p.id === "alice")).toMatchObject({
      reserveSoulCoreCount: 0,
      countValue: 4,
      soulCoreLocation: { kind: "card", instanceId: "eugeo-sword" },
    });
    expect(after.pendingLeaveEntities).toEqual([]);
    expect(cores(after)).toBe(cores(before));
    expect(collectGameStateInvariantIssues(after)).toEqual([]);
  });
  it("旧スナップショットのリザーブ限定候補を再計算し、同じ分離待ちから再開できる", () => {
    const before = selectSword(
      buildEugeoRebirthScenario(
        ALL_CARDS,
        new URLSearchParams({ cores: "waiting" })
      ),
      "alice"
    );
    const saved = {
      ...before,
      pendingCoreDistribution: {
        ...before.pendingCoreDistribution!,
        allowedSources: [{ kind: "reserve" as const }],
        sourceAvailable: { reserve: 0 },
        totalNormalCores: 0,
      },
    };
    const restored = restoreSnapshot(
      createGameSnapshot(saved),
      lookups.getCardDefinitionById
    ).state;
    expect(restored.pendingCoreDistribution).toMatchObject({
      pendingId: saved.pendingCoreDistribution.pendingId,
      sourceAvailable: { reserve: 0, "field:eugeo-host": 2 },
      totalNormalCores: 2,
      rebirthCompletion: saved.pendingCoreDistribution.rebirthCompletion,
    });
    expect(
      restored.cardInstances.find((c) => c.instanceId === "eugeo-host")
    ).toMatchObject({ normalCoreCount: 2, pendingLeaveKind: "destroy" });
    expect(
      restored.cardInstances.find((c) => c.instanceId === "eugeo-sword")
        ?.definitionId
    ).toBe("BSSA01-転醒X02(A)");
    expect(saved.pendingCoreDistribution.sourceAvailable).toEqual({
      reserve: 0,
    });
    expect(
      refreshPendingRebirthSeparationCoreSources(
        restored,
        lookups.getCardDefinitionById
      )
    ).toBe(restored);
    const after = placeCores(restored, "alice", { "field:eugeo-host": 1 });
    expect(
      after.cardInstances.find((c) => c.instanceId === "eugeo-sword")
    ).toMatchObject({ definitionId: "BSSA01-転醒X02(B)", normalCoreCount: 1 });
    expect(after.pendingLeaveEntities).toEqual([]);
    expect(cores(after)).toBe(cores(before));
  });
  it("リザーブが空でもフィールドから補填して転醒できる", () => {
    const before = buildEugeoRebirthScenario(ALL_CARDS);
    before.players.find((p) => p.id === "alice")!.reserveNormalCoreCount = 0;
    before.cardInstances.find(
      (c) => c.instanceId === "eugeo-other-host"
    )!.normalCoreCount = 2;
    const after = resolve(before, "alice");
    expect(
      after.cardInstances.find((c) => c.instanceId === "eugeo-sword")
    ).toMatchObject({
      zone: "field",
      definitionId: "BSSA01-転醒X02(B)",
      normalCoreCount: 1,
    });
    expect(cores(after)).toBe(cores(before));
  });
  it("同じ原因ですでに転醒していれば、補填・再転醒せず元の離脱を完了する", () => {
    const before = buildEugeoRebirthScenario(ALL_CARDS);
    const pending =
      before.pendingEffectTargetSelection!.deferredStack
        .triggeredPendingSnapshot!;
    before.resolvedRebirthTimingWindowIds = [
      getPendingTriggeredRebirthTimingWindowId(pending, "alice"),
    ];
    const after = resolve(before, "alice");
    expect(
      after.cardInstances.find((c) => c.instanceId === "eugeo-sword")
    ).toMatchObject({
      zone: "trash",
      definitionId: "BSSA01-転醒X02(A)",
      normalCoreCount: 0,
    });
    expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(3);
    expect(cores(after)).toBe(cores(before));
  });
  it("補填できるコアがないときは不成立でカウントを増やさない", () => {
    const before = buildEugeoRebirthScenario(ALL_CARDS);
    before.players.find((p) => p.id === "alice")!.reserveNormalCoreCount = 0;
    before.cardInstances
      .filter((c) => c.controllerPlayerId === "alice")
      .forEach((c) => {
        c.normalCoreCount = 0;
      });
    const after = resolve(before, "alice");
    expect(
      after.cardInstances.find((c) => c.instanceId === "eugeo-sword")
    ).toMatchObject({
      zone: "trash",
      definitionId: "BSSA01-転醒X02(A)",
      normalCoreCount: 0,
    });
    expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(3);
    expect(cores(after)).toBe(cores(before));
  });
  it("カウント超過では煌臨元構造やコアを変更しない", () => {
    const before = buildEugeoRebirthScenario(ALL_CARDS);
    before.players.find((p) => p.id === "alice")!.countValue = 6;
    const after = resolve(before, "alice");
    expect(
      after.cardInstances.find((c) => c.instanceId === "eugeo-sword")
    ).toMatchObject({
      zone: "trash",
      definitionId: "BSSA01-転醒X02(A)",
      normalCoreCount: 0,
    });
    expect(after.players.find((p) => p.id === "alice")?.countValue).toBe(6);
    expect(cores(after)).toBe(cores(before));
  });
});
