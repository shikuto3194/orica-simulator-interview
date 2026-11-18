import { expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "@orica/rules-core";
import {
  applyChosenAction,
  buildEngine,
  legalActionsFor,
} from "./selfplay-driver";

it("ステイギスの分身枚数選択へ入力を渡して、0枚の選択でも完走する", () => {
  const engine = buildEngine();
  const lookup = engine.getCardDefinitionById;
  const card = (no: string, id: string, zone: "field" | "deck") =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: "alice",
      zone,
      normalCoreCount: zone === "field" ? 1 : 0,
    });
  const host = card("BSAZ02-C07", "host", "field");
  const drive = card("BSAZ02-C10", "drive", "field");
  host.underCards = [
    {
      cardInstanceId: drive.instanceId,
      role: "text_role",
      roleTag: "アルドノアドライブ",
    },
  ];
  drive.attachedToInstanceId = host.instanceId;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      host,
      drive,
      card("BSAZ02-C01", "deck-1", "deck"),
      card("BSAZ02-C01", "deck-2", "deck"),
    ],
  });
  const pending = executeEffect({
    state,
    chainId: "test:selfplay-count-selection",
    sourceInstanceId: host.instanceId,
    actingPlayerId: "alice",
    effect: lookup(host.definitionId)!.effects![0]!,
    getCardDefinitionById: lookup,
    ...engine.lookups,
  });
  expect(pending.pendingCountSelection).toMatchObject({ min: 0, max: 2 });
  const action = legalActionsFor(pending, engine).actions.find(
    (a) => a.kind === "resolve_pending_count_decrease"
  );
  expect(action).toBeDefined();
  const result = applyChosenAction(pending, action!, engine);
  expect(result.pendingCountSelection).toBeNull();
  expect(result.pendingCoreDistribution).toBeNull();
  expect(result.cardInstances.filter((c) => c.zone === "deck")).toHaveLength(2);
  expect(result.cardInstances.filter((c) => c.faceDown)).toEqual([]);
});
