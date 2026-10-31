import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type ResolvePendingEffectTargetLegalAction,
} from "@orica/rules-core";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import { BattleReplayRecorder } from "../src/battleReplay";
import { parseReplayFile } from "../src/replayViewer";
import { buildReplayPresentation } from "../src/replayPresentation";

const definition = ALL_CARDS.find((card) => card.cardNo === "BSTH04-X03")!;
const lookup = (id: string): CardDefinition | undefined =>
  ALL_CARDS.find((card) => card.cardNo === id);
function states() {
  const card = createCardInstance(definition, {
    instanceId: "moving-card",
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const before = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [card],
  });
  const after = {
    ...before,
    cardInstances: [{ ...card, zone: "field" as const, normalCoreCount: 3 }],
  };
  return { before, after };
}
describe("battle replay", () => {
  it("round-trips each accepted state including the result using the existing delta format", async () => {
    const { before, after } = states();
    const finished = {
      ...after,
      gameResult: {
        kind: "player_loss" as const,
        losingPlayerId: "bob",
        reason: "life_zero",
      },
    };
    const recorder = new BattleReplayRecorder();
    recorder.append(before);
    recorder.append(structuredClone(before));
    recorder.append(after);
    recorder.append(finished);
    const replay = await parseReplayFile(await recorder.file("保存テスト"), {
      getCardDefinitionById: lookup,
    });
    expect(replay.frames.map((frame) => frame.state)).toEqual([
      before,
      after,
      finished,
    ]);
    expect(recorder.frameCount).toBe(3);
    recorder.append(before);
    const rematch = await parseReplayFile(await recorder.file("再戦"), {
      getCardDefinitionById: lookup,
    });
    expect(rematch.frames.map((frame) => frame.state)).toEqual([before]);
  });
  it("derives source, selected card, movement and core placement without adding saved gesture fields", () => {
    const { before, after } = states();
    const original = JSON.stringify({ before, after });
    const presentation = buildReplayPresentation(
      before,
      after,
      {
        actionKind: "summon",
        actingPlayerId: "alice",
        actionId: "summon:moving-card",
      },
      lookup
    );
    expect(presentation.action).toBe("召喚");
    expect(presentation.source?.cardId).toBe("moving-card");
    expect(presentation.selections[0]?.label).toContain("小野塚 小町");
    expect(presentation.result).toContain("手札 → フィールド");
    expect(presentation.result).toContain("コア 0 → 3");
    expect(JSON.stringify({ before, after })).toBe(original);
  });
  it("uses the defender's operation priority for a block in a state-only saved replay", () => {
    const { before } = states();
    before.step = "attack";
    before.activePlayerId = "alice";
    before.cardInstances = [
      createCardInstance(definition, {
        instanceId: "blocker",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 3,
      }),
    ];
    before.activeAttack = {
      attackId: "attack",
      primaryEntityId: "attacker",
      participantEntityIds: ["attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "attacker", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["attacker"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const after = structuredClone(before);
    after.cardInstances[0]!.exhaustState = "exhausted";
    after.battleEntities.push({
      entityId: "blocker-entity",
      memberInstanceIds: ["blocker"],
      resolvedBp: 8000,
      resolvedSymbols: ["purple"],
      attackState: "blocking",
    });
    after.activeAttack!.blockAssignments[0]!.blockedByEntityIds = [
      "blocker-entity",
    ];
    const presentation = buildReplayPresentation(before, after, {}, lookup);
    expect(presentation.actor).toBe("bob");
    expect(presentation.action).toBe("ブロック");
    expect(presentation.source?.cardId).toBe("blocker");
    expect(presentation.result).toContain("疲労");
  });
  it.each(["select", "skip"])(
    "restores an existing training-target %s decision even before the board changes",
    (choice) => {
      const { before } = states();
      before.cardInstances.push(
        createCardInstance(definition, {
          instanceId: "target-card",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 3,
        })
      );
      const legal: ResolvePendingEffectTargetLegalAction = {
        kind: "resolve_pending_effect_target",
        actionId: "resolve:pending-target",
        can: true,
        reason: "target selection",
        actingPlayerId: "alice",
        pendingId: "pending-target",
        sourceInstanceId: "moving-card",
        sourceDefinitionId: definition.cardNo,
        targetMode: "manual",
        requiredTargetCount: 1,
        targetEffectFilterTags: [],
        candidateTargetInstanceIds: ["moving-card", "target-card"],
      };
      const original = JSON.stringify(before);
      const presentation = buildReplayPresentation(
        before,
        before,
        {
          actionId: legal.actionId,
          choiceId: `${legal.actionId}:training-target:1:${choice}`,
          actingPlayerId: "alice",
        },
        lookup,
        [legal]
      );
      expect(presentation.selections[0]?.cardId).toBe("target-card");
      expect(presentation.selections[0]?.label).toContain(
        choice === "select" ? "：選択" : "：選ばない"
      );
      expect(presentation.result).toContain(
        `小野塚 小町を${choice === "select" ? "選ぶ" : "選ばない"}`
      );
      expect(JSON.stringify(before)).toBe(original);
    }
  );
});
