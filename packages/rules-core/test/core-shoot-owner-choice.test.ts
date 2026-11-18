import { maskPendingPromptsForViewer } from "../src/state-sanitize";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  generateActionInputChoices,
  getLegalActions,
  type GameState,
  type ApplyLegalActionOptions,
} from "../src";
import { buildCoreHudAuditScenario } from "../../../apps/playground-web/src/scenario-core-hud-audit";

const options = {
  getCardDefinitionById: (id: string) => ALL_CARDS.find((c) => c.cardNo === id),
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
const fixture = (source = "field", normal = "1") =>
  buildCoreHudAuditScenario(
    [...ALL_CARDS],
    new URLSearchParams({ kind: "mixed-shoot", source, normal })
  );
function resolve(
  state: GameState,
  player: string,
  input: Partial<ApplyLegalActionOptions>
) {
  const action = getLegalActions({
    state,
    actingPlayerId: player,
    ...options,
  }).find((a) => a.kind === "resolve_pending_core_shoot")!;
  expect(action).toBeDefined();
  return applyLegalAction({ state, action, ...input, ...options }).state;
}

describe("コア除去の種類は持ち主が選ぶ (Q31528)", () => {
  for (const source of ["field", "reserve"]) {
    const id = source === "field" ? "hud-source" : "reserve:bob";
    it.each([false, true])(
      `${source}: 効果側は1個を指定し、持ち主がsoul=%sを選ぶ`,
      (soul) => {
        const pending = resolve(fixture(source), "alice", {
          coreShootDistribution: { [id]: 1 },
        });
        expect(pending.pendingCoreShootSelection?.actingPlayerId).toBe("bob");
        expect(pending.players[1]!.trashNormalCoreCount).toBe(0);
        expect(pending.players[1]!.trashSoulCoreCount).toBe(0);
        const after = resolve(pending, "bob", {
          coreShootDistribution: { [id]: soul ? 0 : 1 },
          ...(soul ? { coreShootSoulCoreInstanceId: id } : {}),
        });
        expect(after.pendingCoreShootSelection).toBeNull();
        expect(after.players[1]).toMatchObject({
          trashNormalCoreCount: soul ? 0 : 1,
          trashSoulCoreCount: soul ? 1 : 0,
        });
        if (source === "field")
          expect(
            after.cardInstances.find((c) => c.instanceId === id)
          ).toMatchObject({
            normalCoreCount: soul ? 1 : 0,
            soulCoreCount: soul ? 0 : 1,
          });
      }
    );
    it.each(["0", "1"])(
      `${source}: 全個移動は内訳を再確認しない normal=%s`,
      (normal) => {
        const after = resolve(fixture(source, normal), "alice", {
          coreShootDistribution: { [id]: Number(normal) },
          coreShootSoulCoreInstanceId: id,
        });
        expect(after.pendingCoreShootSelection).toBeNull();
        expect(after.players[1]).toMatchObject({
          trashNormalCoreCount: Number(normal),
          trashSoulCoreCount: 1,
        });
      }
    );
    it(`${source}: 持ち主は除去個数を減らせない`, () => {
      const pending = resolve(fixture(source), "alice", {
        coreShootDistribution: { [id]: 1 },
      });
      expect(() =>
        resolve(pending, "bob", { coreShootDistribution: {} })
      ).toThrow(/preserve/);
    });
  }
  it("効果側のソウル指定でも、1個だけなら持ち主が通常を選び直せる", () => {
    const pending = resolve(fixture(), "alice", {
      coreShootSoulCoreInstanceId: "hud-source",
    });
    const after = resolve(pending, "bob", {
      coreShootDistribution: { "hud-source": 1 },
    });
    expect(after.players[1]!.trashSoulCoreCount).toBe(0);
    expect(after.players[1]!.trashNormalCoreCount).toBe(1);
  });
  it("最低残存コアの上限は通常とソウルの合計に適用する", () => {
    const state = fixture();
    state.pendingCoreShootSelection!.candidates[0]!.availableCores = 1;
    expect(() =>
      resolve(state, "alice", {
        coreShootDistribution: { "hud-source": 1 },
        coreShootSoulCoreInstanceId: "hud-source",
      })
    ).toThrow(/valid candidate/);
  });
  it("ボイド除去では通常のみで確定し、ソウルは候補にしない", () => {
    const state = fixture();
    state.pendingCoreShootSelection!.toKind = "void";
    state.pendingCoreShootSelection!.candidates[0]!.availableCores = 1;
    const after = resolve(state, "alice", {
      coreShootDistribution: { "hud-source": 1 },
    });
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "hud-source")!
        .soulCoreCount
    ).toBe(1);
    expect(() =>
      resolve(state, "alice", { coreShootSoulCoreInstanceId: "hud-source" })
    ).toThrow(/valid candidate/);
  });
});

it("持ち主の表示状態へ元効果の再開情報を送らない", () => {
  const pending = resolve(fixture(), "alice", {
    coreShootDistribution: { "hud-source": 1 },
  });
  const shown = maskPendingPromptsForViewer(
    pending,
    "bob"
  ).pendingCoreShootSelection!;
  expect(shown.ownerCoreChoice).toEqual({ soulSourceId: "hud-source" });
  expect(shown.continuation).toBeUndefined();
  expect(shown.remainingActions).toEqual([]);
  expect(
    maskPendingPromptsForViewer(pending, "alice").pendingCoreShootSelection
  ).toBeNull();
  expect(
    pending.pendingCoreShootSelection!.ownerCoreChoice!.originalPending
  ).toBeDefined();
});

it("通常コアが移動禁止ならソウルだけで確定し、AIとRESTに不正な通常候補を渡さない", () => {
  const state = buildCoreHudAuditScenario(
    [...ALL_CARDS],
    new URLSearchParams({
      kind: "mixed-shoot",
      source: "field",
      normalBlocked: "1",
    })
  );
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...options,
  }).find((a) => a.kind === "resolve_pending_core_shoot")!;
  const choices = generateActionInputChoices(state, action, options, 32);
  expect(
    choices.values.some(
      (c) => (c.coreShootDistribution?.["hud-source"] ?? 0) > 0
    )
  ).toBe(false);
  expect(
    choices.values.some((c) => c.coreShootSoulCoreInstanceId === "hud-source")
  ).toBe(true);
  expect(() =>
    resolve(state, "alice", { coreShootDistribution: { "hud-source": 1 } })
  ).toThrow(/normal-core/);
  const after = resolve(state, "alice", {
    coreShootSoulCoreInstanceId: "hud-source",
  });
  expect(after.pendingCoreShootSelection).toBeNull();
  expect(after.players[1]!.trashSoulCoreCount).toBe(1);
  expect(
    after.cardInstances.find((c) => c.instanceId === "hud-source")!
      .normalCoreCount
  ).toBe(1);
});
