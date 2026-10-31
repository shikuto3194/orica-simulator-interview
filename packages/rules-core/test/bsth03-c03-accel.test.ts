/**
 * BSTH03-C03「ミスティア・ローレライ」メイン【アクセル：コスト3<黄>】。
 * accelData（P3-108 で実装済みの汎用アクセル primitive）への配線検証。
 * 「カード名：「ミスティア・ローレライ」以外」の除外は CardFilter.excludeCardName（新設、
 * excludeColors/excludeTribeSubstring と同型の否定フィルタ primitive）で表す。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { useAccelCardAsAction } from "../src/mechanics/accel-change-system";
import { applyLegalAction } from "../src/legal/legal-actions-apply";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id);
const actionLookupOptions = {
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
} as const;

const ALICE = "alice";
const BOB = "bob";

const C03 = cardNoMap.get("BSTH03-C03")!; // 幻想・想獣・歌鳥、accelData.effects[0]: trash search
const MAGIC_TRIBE = cardNoMap.get("BSTH03-C01")!; // 月人・魔影 → tribes フィルタに合致
const HOWRAI_TRIBE = cardNoMap.get("BSTH03-C21")!; // 幻想・蓬莱 → tribes フィルタに合致

function buildState(): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(C03, {
        instanceId: "c03-hand",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      }),
      createCardInstance(MAGIC_TRIBE, {
        instanceId: "trash-magic",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      }),
      createCardInstance(HOWRAI_TRIBE, {
        instanceId: "trash-howrai",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      }),
      // カード名：「ミスティア・ローレライ」自身 (同名別インスタンス) はトライブが一致しても除外対象
      createCardInstance(C03, {
        instanceId: "trash-self-named",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      }),
    ],
  });
}

describe("BSTH03-C03 accelData: メイン【アクセル：コスト3<黄>】", () => {
  it("card-data: effects[0] ではなく accelData として配線され、stub が外れている", () => {
    expect(C03.accelData).toBeDefined();
    expect(C03.accelData!.timing).toBe("main");
    expect(C03.accelData!.cost).toBe(3);
    expect(C03.accelData!.reduction).toEqual(["yellow"]);
    const accelEffect = C03.accelData!.effects![0]!;
    expect(accelEffect.stub).toBeUndefined();
    expect(accelEffect.steps[0]!.action).toMatchObject({
      kind: "search_zone",
      zone: "trash",
      filter: {
        tribes: ["想獣", "魔影", "歌鳥", "蓬莱"],
        excludeCardName: "self",
      },
      count: { min: 0, max: 2 },
      destination: "hand",
    });
  });

  it("アクセル使用は候補確定待ち(pendingZoneSelection)で一時停止し、トラッシュ探索候補から同名カードが除外される", () => {
    const state = buildState();

    const result = useAccelCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "c03-hand",
      accelData: C03.accelData!,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById,
      ...actionLookupOptions,
    });

    // pendingZoneSelection 解決待ちの間はカードは in_use のまま
    // (finalizePendingAccelCleanups が全 pending 解消後に set_aside へ移す)。
    const accelCard = result.state.cardInstances.find(
      (c) => c.instanceId === "c03-hand"
    )!;
    expect(accelCard.zone).toBe("in_use");

    expect(result.state.pendingZoneSelection).toMatchObject({
      actionKind: "return_from_trash",
      sourceZone: "trash",
      maxCount: 2,
      destination: "hand",
      canSkip: true,
    });
    const candidateIds =
      result.state.pendingZoneSelection!.candidateCardInstanceIds;
    expect(candidateIds).toContain("trash-magic");
    expect(candidateIds).toContain("trash-howrai");
    expect(candidateIds).not.toContain("trash-self-named");
  });

  it("2枚選択で手札に戻り、同名カードはトラッシュに残ったまま", () => {
    const state = buildState();
    const afterAccel = useAccelCardAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "c03-hand",
      accelData: C03.accelData!,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById,
      ...actionLookupOptions,
    }).state;

    const resolved = applyLegalAction({
      state: afterAccel,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["trash-magic", "trash-howrai"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        actionLookupOptions.getRegisteredTriggeredEffectActions,
    }).state;

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "trash-magic")?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "trash-howrai")?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "trash-self-named")
        ?.zone
    ).toBe("trash");
    expect(resolved.pendingZoneSelection).toBeNull();
    // pending 解消により accel cleanup が確定し、アクセルカードは手元(set_aside)へ。
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "c03-hand")?.zone
    ).toBe("set_aside");
  });
});
