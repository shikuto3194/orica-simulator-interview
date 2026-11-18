/**
 * engine-under-card-multi-host-discard: move_card の from.hostFilter +
 * from.hostUnderCardRoleTag primitive の単体機能テスト (BSAZ02-M01「揚陸城」effects[4]
 * 「自分の『揚陸城』すべての下にある『アルドノアドライブ』すべてを破棄する」向け)。
 *
 * 検証範囲:
 * - hostFilter に一致する自分の場のカード「すべて」を host 候補として横断的に解決し、
 *   その host すべての text_role アンダーカード (roleTag 一致) を移動候補にする
 *   (sourceUnderCardRole が sourceInstanceId 単一固定なのに対し、複数 host 対応)。
 * - hostFilter に一致しない他カード名の host (同じ roleTag を持っていても) は対象外。
 * - 既存の汎用 detach ロジック (move_card 内 movedUnderCardIds 経由) がそのまま働き、
 *   移動先 (トラッシュ) 到着時に attachedToInstanceId クリア + host.underCards から除去される。
 */
import { describe, expect, it } from "vitest";
import { executeMoveCard } from "../src/effect/native-move-core-handlers";
import { flushPendingLeaves } from "../src/state-based-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { createStepExecutionContext } from "../src/step-execution-context";
import type { CardDefinition, GameState } from "../src/model";
import type { DSL } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

const hostA: CardDefinition = {
  cardNo: "FILLER-HOST-A",
  name: "揚陸城",
  printedCategory: "nexus",
  colors: ["white"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "火星・アルドノア",
  sourceUrls: [],
  sourceConfidence: "C",
  underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
};

const hostB: CardDefinition = {
  ...hostA,
  cardNo: "FILLER-HOST-B",
  name: "別のネクサス",
};

const underCardFiller: CardDefinition = {
  cardNo: "FILLER-UNDER",
  name: "アルドノアドライブ",
  printedCategory: "brave",
  colors: ["white"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "アルドノア",
  sourceUrls: [],
  sourceConfidence: "C",
};

const defRegistry = new Map<string, CardDefinition>([
  [hostA.cardNo, hostA],
  [hostB.cardNo, hostB],
  [underCardFiller.cardNo, underCardFiller],
]);
const getCardDefinitionById = (id: string) => defRegistry.get(id);

function buildState(): {
  state: GameState;
  hostA1: string;
  hostA2: string;
  hostB1: string;
  underA1: string;
  underA2: string;
  underB1: string;
} {
  const hostA1 = createCardInstance(hostA, {
    instanceId: "host-a-1",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 1,
  });
  const hostA2 = createCardInstance(hostA, {
    instanceId: "host-a-2",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 1,
  });
  const hostB1 = createCardInstance(hostB, {
    instanceId: "host-b-1",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 1,
  });
  const underA1 = createCardInstance(underCardFiller, {
    instanceId: "under-a-1",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: hostA1.instanceId,
  });
  const underA2 = createCardInstance(underCardFiller, {
    instanceId: "under-a-2",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: hostA2.instanceId,
  });
  const underB1 = createCardInstance(underCardFiller, {
    instanceId: "under-b-1",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: hostB1.instanceId,
  });
  const hostA1Attached = {
    ...hostA1,
    underCards: [
      {
        cardInstanceId: underA1.instanceId,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
  const hostA2Attached = {
    ...hostA2,
    underCards: [
      {
        cardInstanceId: underA2.instanceId,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
  const hostB1Attached = {
    ...hostB1,
    underCards: [
      {
        cardInstanceId: underB1.instanceId,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      hostA1Attached,
      hostA2Attached,
      hostB1Attached,
      underA1,
      underA2,
      underB1,
    ],
  });
  return {
    state,
    hostA1: hostA1.instanceId,
    hostA2: hostA2.instanceId,
    hostB1: hostB1.instanceId,
    underA1: underA1.instanceId,
    underA2: underA2.instanceId,
    underB1: underB1.instanceId,
  };
}

describe("engine-under-card-multi-host-discard: move_card from.hostFilter", () => {
  it("hostFilter に一致する複数 host すべての roleTag 一致アンダーカードをトラッシュへ移す", () => {
    const { state, hostA1, hostA2, underA1, underA2, underB1 } = buildState();
    const stepCtx = createStepExecutionContext();
    const action: DSL.MoveCardAction = {
      kind: "move_card",
      from: {
        zone: "field",
        player: "self",
        hostFilter: { cardName: { exact: "揚陸城" } },
        hostUnderCardRoleTag: "アルドノアドライブ",
      },
      to: { zone: "trash" },
      count: -1,
    };
    const next = flushPendingLeaves(
      executeMoveCard(
        action,
        state,
        ALICE,
        "dsl-unused",
        getCardDefinitionById,
        stepCtx
      ),
      getCardDefinitionById
    );

    // hostFilter 一致 (揚陸城) の下のアンダーカード2枚がトラッシュへ移動
    const movedA1 = next.cardInstances.find((c) => c.instanceId === underA1)!;
    const movedA2 = next.cardInstances.find((c) => c.instanceId === underA2)!;
    expect(movedA1.zone).toBe("trash");
    expect(movedA1.attachedToInstanceId).toBeNull();
    expect(movedA2.zone).toBe("trash");
    expect(movedA2.attachedToInstanceId).toBeNull();

    // hostFilter 不一致 (別のネクサス) の下のアンダーカードは対象外のままフィールドに残る
    const untouchedB1 = next.cardInstances.find(
      (c) => c.instanceId === underB1
    )!;
    expect(untouchedB1.zone).toBe("field");
    expect(untouchedB1.attachedToInstanceId).toBe("host-b-1");

    // host 側 underCards からも正しく除去されている
    const hostA1After = next.cardInstances.find(
      (c) => c.instanceId === hostA1
    )!;
    const hostA2After = next.cardInstances.find(
      (c) => c.instanceId === hostA2
    )!;
    expect(hostA1After.underCards).toHaveLength(0);
    expect(hostA2After.underCards).toHaveLength(0);
  });

  it("hostFilter に一致する host が無ければ何も移動しない (no-op)", () => {
    const { state } = buildState();
    const stepCtx = createStepExecutionContext();
    const action: DSL.MoveCardAction = {
      kind: "move_card",
      from: {
        zone: "field",
        player: "self",
        hostFilter: { cardName: { exact: "存在しないホスト" } },
        hostUnderCardRoleTag: "アルドノアドライブ",
      },
      to: { zone: "trash" },
      count: -1,
    };
    const next = executeMoveCard(
      action,
      state,
      ALICE,
      "dsl-unused",
      getCardDefinitionById,
      stepCtx
    );
    expect(next).toBe(state);
  });
});
