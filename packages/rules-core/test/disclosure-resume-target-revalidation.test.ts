import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
  type PendingEffectTargetGroup,
} from "../src";
import { allocateGroupedTargetsByStep } from "../src/effect/native-target-resolution";
import { revalidateTargetsForDisclosureResume } from "../src/legal/stack-resolution-core";

/**
 * 対象開示への応答で選択済みの対象が対象 zone を離れたとき、再開は離れた対象だけを
 * 取り除き、対象グループの必須数も同じ分だけ下げる。下げないと、全対象が離れた効果
 * (BSLH01-X08 のように 2 group の候補が同じ 1 体)が割当失敗の例外で解決されず、
 * pending が残って対戦が進まなくなる (fuzz seed 2416629681)。
 */
const spirit: CardDefinition = {
  cardNo: "TEST-DISCLOSURE-RESUME-SPIRIT",
  name: "disclosure resume target",
  printedCategory: "spirit",
  colors: ["white"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
};

function stateWith(zones: Record<string, "field" | "trash">): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: Object.entries(zones).map(([instanceId, zone]) =>
      createCardInstance(spirit, {
        instanceId,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone,
      })
    ),
  });
}

function group(
  targetStepId: string,
  candidateTargetInstanceIds: string[]
): PendingEffectTargetGroup {
  return {
    requiredTargetCount: 1,
    targetStepId,
    candidateTargetZones: ["field"],
    candidateTargetInstanceIds,
  };
}

describe("revalidateTargetsForDisclosureResume", () => {
  it("2 group が同一候補を共有し、その唯一の対象が離れても必須数を 0 にして割当できる", () => {
    const groups = [
      group("__step_0", ["card-41"]),
      group("__step_1", ["card-41"]),
    ];
    const cont = {
      targetInstanceIds: ["card-41", "card-41"],
      targetZonesByInstanceId: { "card-41": "field" as const },
      targetGroups: groups,
    };
    const result = revalidateTargetsForDisclosureResume(
      stateWith({ "card-41": "trash" }),
      cont
    );

    expect(result.targetInstanceIds).toEqual([]);
    expect(result.targetGroups?.map((g) => g.requiredTargetCount)).toEqual([
      0, 0,
    ]);
    expect(result.targetGroups?.map((g) => g.targetStepId)).toEqual([
      "__step_0",
      "__step_1",
    ]);
    // 解決側の割当は例外にならず、各 step の対象は空になる。
    const allocation = allocateGroupedTargetsByStep({
      targetInstanceIds: result.targetInstanceIds,
      targetGroups: result.targetGroups!,
    });
    expect(allocation.idsByStepId.get("__step_0")).toEqual([]);
    expect(allocation.idsByStepId.get("__step_1")).toEqual([]);
    // 緩和しない従来の入力は、同じ割当で例外になる (この修正が防ぐ不具合の再現)。
    expect(() =>
      allocateGroupedTargetsByStep({
        targetInstanceIds: result.targetInstanceIds,
        targetGroups: groups,
      })
    ).toThrow("Grouped target allocation could not satisfy targetGroups");
  });

  it("対象が離れていなければ対象も group も変えない", () => {
    const groups = [
      group("__step_0", ["card-41"]),
      group("__step_1", ["card-41"]),
    ];
    const result = revalidateTargetsForDisclosureResume(
      stateWith({ "card-41": "field" }),
      {
        targetInstanceIds: ["card-41", "card-41"],
        targetZonesByInstanceId: { "card-41": "field" },
        targetGroups: groups,
      }
    );

    expect(result.targetInstanceIds).toEqual(["card-41", "card-41"]);
    expect(result.targetGroups).toEqual(groups);
  });

  it("一部の対象だけが離れたら、その対象の group の必須数だけを下げて残りは保つ", () => {
    const result = revalidateTargetsForDisclosureResume(
      stateWith({ a: "trash", b: "field" }),
      {
        targetInstanceIds: ["a", "b"],
        targetZonesByInstanceId: { a: "field", b: "field" },
        targetGroups: [group("__step_0", ["a"]), group("__step_1", ["b"])],
      }
    );

    expect(result.targetInstanceIds).toEqual(["b"]);
    expect(result.targetGroups?.map((g) => g.requiredTargetCount)).toEqual([
      0, 1,
    ]);
    const allocation = allocateGroupedTargetsByStep({
      targetInstanceIds: result.targetInstanceIds,
      targetGroups: result.targetGroups!,
    });
    expect(allocation.idsByStepId.get("__step_0")).toEqual([]);
    expect(allocation.idsByStepId.get("__step_1")).toEqual(["b"]);
  });

  it("group を持たない再開は対象の絞り込みだけで、group は未定義のまま", () => {
    const result = revalidateTargetsForDisclosureResume(
      stateWith({ a: "trash" }),
      {
        targetInstanceIds: ["a"],
        targetZonesByInstanceId: { a: "field" },
        targetGroups: undefined,
      }
    );

    expect(result.targetInstanceIds).toEqual([]);
    expect(result.targetGroups).toBeUndefined();
  });
});
