/**
 * ENGINE-summon-from-zone-range-count-preselected-ids-truncated-to-min:
 * summon(from_zone) の count:{min,max} レンジは resolveCountToNumber が常に min
 * (多くは0) を返す。native-action-registry.ts の summon ハンドラは resolvedTargetIds
 * (プレイヤーが実際に選んだ対象) を渡されていても、この min を count として
 * executeSummonOther へ渡していたため `toSummon = preSelectedIds.slice(0, count)` が
 * `.slice(0, 0)` となり、明示選択が無音で握り潰されていた (BSSA01-X02 / BSLH01-M05 /
 * BSTH02.7-X01 等、count:{min:0,max:2} の from_zone summon を持つ shipped card 共通の
 * cross-cutting gap)。resolvedTargetIds があればその件数を優先するよう修正した。
 *
 * ここでは BSSA01-X02 effects[1] (手札/手元の夜錆カード2枚までコストなし召喚) を使い、
 * `executeEffect` を直接呼んで targetInstanceIds に2枚を明示指定したとき、両方が
 * フィールドへ召喚されることを検証する (BSAZ03-M01 テストと同型の低レベル呼び出し)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const X02 = cardNoMap.get("BSSA01-X02")!;

const ALICE = "alice";
const BOB = "bob";

function yozabiSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テスト夜錆 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "夜錆",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

const CAND1 = yozabiSpirit("TEST-YOZABI-1");
const CAND2 = yozabiSpirit("TEST-YOZABI-2");
const testDefs = new Map<string, CardDefinition>(
  [X02, CAND1, CAND2].map((d) => [d.cardNo, d])
);
const getCardDefinitionById = (id: string) => testDefs.get(id);

function freeSummonEffect() {
  const effect = X02.effects!.find(
    (e) =>
      e.steps[0]?.action.kind === "summon" &&
      e.steps[0]!.action.kind === "summon" &&
      e.steps[0]!.action.target.kind === "from_zone"
  );
  if (!effect) throw new Error("BSSA01-X02 free-summon effect not found");
  return effect;
}

function buildState(): { state: GameState; cand1Id: string; cand2Id: string } {
  const x02Instance = createCardInstance(X02, {
    instanceId: "alice-x02",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "spirit",
  });
  const cand1 = createCardInstance(CAND1, {
    instanceId: "alice-cand-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const cand2 = createCardInstance(CAND2, {
    instanceId: "alice-cand-2",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [x02Instance, cand1, cand2],
    playerOverrides: [{ handCount: 2 }, {}],
  });
  return { state, cand1Id: cand1.instanceId, cand2Id: cand2.instanceId };
}

describe("ENGINE-summon-from-zone-range-count-preselected-ids-truncated-to-min", () => {
  it("count:{min:0,max:2} + 明示選択2枚 → 2枚ともフィールドへ召喚される (min=0 に握り潰されない)", () => {
    const { state, cand1Id, cand2Id } = buildState();
    const effect = freeSummonEffect();

    const after = executeEffect({
      chainId: "test:engine-summon-from-zone-range-count-preselected-ids:102",
      state,
      effect,
      sourceInstanceId: "alice-x02",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [cand1Id, cand2Id],
      targetSelectionResolved: true,
    });

    const c1 = after.cardInstances.find((c) => c.instanceId === cand1Id)!;
    const c2 = after.cardInstances.find((c) => c.instanceId === cand2Id)!;
    expect(c1.zone).toBe("field");
    expect(c2.zone).toBe("field");
    expect(c1.normalCoreCount).toBe(0);
    expect(c2.normalCoreCount).toBe(0);
    expect(
      after.pendingMultiPlacement?.targets.map((target) => target.instanceId)
    ).toEqual([cand1Id, cand2Id]);
  });

  it("明示選択なし (auto解決) では従来通り min=0 で no-op のまま (回帰確認)", () => {
    const { state, cand1Id, cand2Id } = buildState();
    const effect = freeSummonEffect();

    const after = executeEffect({
      chainId: "test:engine-summon-from-zone-range-count-preselected-ids:128",
      state,
      effect,
      sourceInstanceId: "alice-x02",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const c1 = after.cardInstances.find((c) => c.instanceId === cand1Id)!;
    const c2 = after.cardInstances.find((c) => c.instanceId === cand2Id)!;
    expect(c1.zone).toBe("hand");
    expect(c2.zone).toBe("hand");
  });
});
