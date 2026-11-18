import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import { getLegalActions } from "@orica/rules-core";
import { buildCoreHudAuditScenario } from "../src/scenario-core-hud-audit";
import { applyBraveSeparationWithCores } from "../src/utils/brave-separation";
import {
  __initializeGameApiLookupsForTest,
  replayBraveSeparationEvent,
} from "../server/game-api";

const lookups = {
  getCardDefinitionById: (id: string) => ALL_CARDS.find((c) => c.cardNo === id),
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
describe("分離の通常/ソウル選択", () => {
  for (const owner of ["alice", "bob"])
    for (const source of ["reserve", "field"])
      for (const normal of [0, 1]) {
        it(`${owner}/${source}/${normal}: GUIとサーバー再生で選択した内訳だけを移動`, async () => {
          const state = buildCoreHudAuditScenario(
            [...ALL_CARDS],
            new URLSearchParams({
              kind: "mixed-separate",
              owner,
              source,
              normal: String(normal),
            })
          );
          const action = getLegalActions({
            state,
            actingPlayerId: owner,
            ...lookups,
          }).find((a) => a.kind === "brave_separate")!;
          expect(action).toBeDefined();
          const key = source === "reserve" ? "reserve" : "hud-source";
          const separateCoreDistribution = normal ? { [key]: normal } : {};
          const gui = applyBraveSeparationWithCores(
            { state, action, ...lookups, separateCoreDistribution },
            key,
            "hud-brave"
          ).state;
          await __initializeGameApiLookupsForTest();
          const server = replayBraveSeparationEvent(state, owner, {
            actionId: action.actionId,
            separateCoreDistribution,
            separationSoulCoreSource: key,
            braveInstanceId: "hud-brave",
          });
          for (const after of [gui, server]) {
            expect(
              after.cardInstances.find((c) => c.instanceId === "hud-brave")
            ).toMatchObject({
              normalCoreCount: normal,
              soulCoreCount: 1,
              attachedToInstanceId: null,
              zone: "field",
            });
            expect(
              after.cardInstances.find((c) => c.instanceId === "hud-target")
                ?.normalCoreCount
            ).toBe(4);
          }
        });
      }
  it("選択対象外のカードへソウルを移動しない", () => {
    const state = buildCoreHudAuditScenario(
      [...ALL_CARDS],
      new URLSearchParams({ kind: "mixed-separate" })
    );
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "brave_separate")!;
    expect(() =>
      applyBraveSeparationWithCores(
        { state, action, ...lookups },
        "reserve",
        "hud-target"
      )
    ).toThrow("Invalid brave separation destination");
    expect(
      state.players.find((p) => p.id === "alice")?.reserveSoulCoreCount
    ).toBe(1);
  });
});
