/**
 * BSSL01-X01[5,6] cluster (bssl01-x01-token-distribution) 分: summon.target.from_zone に
 * `includeAdventSource` を追加し、煌臨元 (advent_source) アンダーカードも通常ゾーン
 * (手札/トラッシュ等) 探索候補に合流できるようにする primitive の単体検証。
 *
 * 「手札/トラッシュ/煌臨元にある系統：影を持つスピリットカードをコストを支払わずに召喚できる」
 * (BSSL01-X01) のような複合ゾーン召喚の煌臨元分を表現する。煌臨元は runtime Zone 上
 * "field" のままホストの underCards に重なっているため、通常の zone 列挙
 * (hand/set_aside/trash) では拾えず、`ApplicabilityZone.advent_source` と同じ理由で
 * orthogonal なフラグとして分離した (SSOT: model.ts SummonAction.includeAdventSource)。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { generateTriggeredEffectRegistrations } from "../src/effect/structured-effect-registrations";
import { getCandidateTargetInstanceIds } from "../src/legal/legal-actions-shared";

const PLAYER = "player-1";
const OPPONENT = "player-2";

const noTriggerLookup = () => [];

function vanillaSpirit(cardNo: string, tribe?: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    tribe,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

const SOURCE = vanillaSpirit("TEST-SOURCE");
const SHADOW_HAND = vanillaSpirit("TEST-SHADOW-HAND", "影");
const SHADOW_TRASH = vanillaSpirit("TEST-SHADOW-TRASH", "影");
const SHADOW_ADVENT_SOURCE = vanillaSpirit("TEST-SHADOW-ADVENT", "影");
const NON_SHADOW_HAND = vanillaSpirit("TEST-OTHER-HAND");

// BSSL01-X01[5,6] 実際の gap と同じ timing (card_event:advent) を持つ、
// legal-actions 候補列挙 (generateTriggeredEffectRegistrations 経路) 検証専用カード。
const TRIGGERED_SOURCE: CardDefinition = {
  ...vanillaSpirit("TEST-TRIGGERED-SOURCE"),
  effects: [
    {
      timing: { kind: "card_event", event: "advent" },
      executionMode: "optional",
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: ["hand", "trash"],
              filter: { tribes: ["影"] },
              count: 1,
              includeAdventSource: true,
            },
            costModifier: "free",
          },
        },
      ],
    },
  ],
};

const defs = [
  SOURCE,
  SHADOW_HAND,
  SHADOW_TRASH,
  SHADOW_ADVENT_SOURCE,
  NON_SHADOW_HAND,
  TRIGGERED_SOURCE,
];
const getDef = (id: string): CardDefinition | undefined =>
  defs.find((d) => d.cardNo === id);

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string
): GameState {
  return executeEffect({
    chainId: "test:summon-from-zone-advent-source:92",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: PLAYER,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

const summonAdventSourceEffect: NonNullable<CardDefinition["effects"]>[number] =
  {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "summon",
          target: {
            kind: "from_zone",
            zone: ["hand", "trash"],
            filter: { tribes: ["影"] },
            count: 1,
            includeAdventSource: true,
          },
          costModifier: "free",
        },
      },
    ],
  };

function buildState(options: {
  hostUnderCardOwnerId?: string;
  adventSourceOwnerId?: string;
}): {
  state: GameState;
  hostId: string;
  adventSourceId: string;
} {
  const hostId = "host";
  const adventSourceId = "advent-src";
  const sourceInstance = createCardInstance(SOURCE, {
    instanceId: "src",
    ownerPlayerId: PLAYER,
    zone: "hand",
  });
  const hostInstance = createCardInstance(SOURCE, {
    instanceId: hostId,
    ownerPlayerId: options.hostUnderCardOwnerId ?? PLAYER,
    controllerPlayerId: options.hostUnderCardOwnerId ?? PLAYER,
    zone: "field",
    normalCoreCount: 1,
  });
  const adventSourceInstance = createCardInstance(SHADOW_ADVENT_SOURCE, {
    instanceId: adventSourceId,
    ownerPlayerId:
      options.adventSourceOwnerId ?? options.hostUnderCardOwnerId ?? PLAYER,
    zone: "field",
    zoneRoleName: "advent-source",
    normalCoreCount: 0,
  });
  hostInstance.underCards = [
    { cardInstanceId: adventSourceId, role: "advent_source" as const },
  ];
  const state = createEmptyGameState({
    playerIds: [PLAYER, OPPONENT],
    cardInstances: [sourceInstance, hostInstance, adventSourceInstance],
    playerOverrides: [{}, {}],
  });
  return { state: { ...state, step: "main" }, hostId, adventSourceId };
}

describe("summon.target.from_zone includeAdventSource (BSSL01-X01[5,6] 前段primitive)", () => {
  it("煌臨元アンダーカードのみが候補のとき、召喚してホストの underCards 参照を剥がす", () => {
    const { state, hostId, adventSourceId } = buildState({});
    const after = runEffect(state, summonAdventSourceEffect, "src");

    const summoned = after.cardInstances.find(
      (c) => c.instanceId === adventSourceId
    )!;
    expect(summoned.zone).toBe("field");
    expect(summoned.zoneRoleName).toBe("spirit");

    const host = after.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(
      host.underCards.some((entry) => entry.cardInstanceId === adventSourceId)
    ).toBe(false);
  });

  it("通常ゾーン(手札/トラッシュ)と煌臨元が両方候補: フィルタ非該当の手札/他プレイヤー煌臨元は選ばれない", () => {
    const { state, adventSourceId } = buildState({
      adventSourceOwnerId: OPPONENT,
    });
    // 系統「影」以外の手札カードを追加（フィルタで弾かれる）。
    const withNonShadowHand: GameState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(NON_SHADOW_HAND, {
          instanceId: "non-shadow-hand",
          ownerPlayerId: PLAYER,
          zone: "hand",
        }),
      ],
    };
    const after = runEffect(withNonShadowHand, summonAdventSourceEffect, "src");

    // 煌臨元は相手所有 → 自分の召喚候補に含めない。系統不一致の手札も除外。
    // 結果、条件を満たす候補が0件のため何も召喚されない。
    const summonedAdvent = after.cardInstances.find(
      (c) => c.instanceId === adventSourceId
    )!;
    expect(summonedAdvent.zone).toBe("field");
    expect(summonedAdvent.zoneRoleName).toBe("advent-source");
    const nonShadow = after.cardInstances.find(
      (c) => c.instanceId === "non-shadow-hand"
    )!;
    expect(nonShadow.zone).toBe("hand");
  });

  it("手札の系統一致カードが優先候補にあれば手札から召喚し、煌臨元アンダーカードは動かさない", () => {
    const { state, hostId, adventSourceId } = buildState({});
    const withShadowHand: GameState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(SHADOW_HAND, {
          instanceId: "shadow-hand",
          ownerPlayerId: PLAYER,
          zone: "hand",
        }),
      ],
    };
    const after = runEffect(withShadowHand, summonAdventSourceEffect, "src");

    const shadowHand = after.cardInstances.find(
      (c) => c.instanceId === "shadow-hand"
    )!;
    expect(shadowHand.zone).toBe("field");

    // 煌臨元は count:1 の枠を使い切られたため未召喚のまま、ホスト参照も維持。
    const adventSource = after.cardInstances.find(
      (c) => c.instanceId === adventSourceId
    )!;
    expect(adventSource.zone).toBe("field");
    expect(adventSource.zoneRoleName).toBe("advent-source");
    const host = after.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(
      host.underCards.some((entry) => entry.cardInstanceId === adventSourceId)
    ).toBe(true);
  });
});

describe("summon.target.from_zone includeAdventSource: legal-actions 候補列挙 (GUI/選択経路)", () => {
  // executeEffect 直呼びの auto-pick (count 以下の候補を確定実行) とは別に、GUI が実際に
  // 提示する候補集合 (getCandidateTargetInstanceIds、production の対象ピック経路) にも
  // 煌臨元アンダーカードが合流することを検証する。extractFieldTargetingFromAction が
  // candidateIncludeAdventSource を生成し忘れると、count 未満の候補しかないケースでも
  // 煌臨元が選択肢から欠落する half-wired primitive になる (adversarial verifier 指摘)。
  function registrationFor(card: CardDefinition) {
    const regs = generateTriggeredEffectRegistrations(card);
    return regs.find((r) => r.candidateIncludeAdventSource === true)!;
  }

  it("registration に candidateIncludeAdventSource:true が伝播している", () => {
    const reg = registrationFor(TRIGGERED_SOURCE);
    expect(reg.candidateIncludeAdventSource).toBe(true);
    expect(reg.candidateTargetZones).toEqual(["hand", "trash"]);
  });

  it("候補列挙: 手札の系統一致カード + 煌臨元アンダーカードの両方が候補に入る", () => {
    const { state, adventSourceId } = buildState({});
    const withShadowHand: GameState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(TRIGGERED_SOURCE, {
          instanceId: "triggered-src",
          ownerPlayerId: PLAYER,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(SHADOW_HAND, {
          instanceId: "shadow-hand",
          ownerPlayerId: PLAYER,
          zone: "hand",
        }),
        createCardInstance(SHADOW_TRASH, {
          instanceId: "shadow-trash",
          ownerPlayerId: PLAYER,
          zone: "trash",
        }),
      ],
    };
    const reg = registrationFor(TRIGGERED_SOURCE);
    const candidates = getCandidateTargetInstanceIds(
      withShadowHand,
      PLAYER,
      reg,
      { getCardDefinitionById: getDef, sourceInstanceId: "triggered-src" }
    );
    expect(new Set(candidates)).toEqual(
      new Set(["shadow-hand", "shadow-trash", adventSourceId])
    );
  });

  it("候補列挙: 相手所有の煌臨元アンダーカードは候補に入らない", () => {
    const { state, adventSourceId } = buildState({
      adventSourceOwnerId: OPPONENT,
    });
    const withSource: GameState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(TRIGGERED_SOURCE, {
          instanceId: "triggered-src",
          ownerPlayerId: PLAYER,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const reg = registrationFor(TRIGGERED_SOURCE);
    const candidates = getCandidateTargetInstanceIds(withSource, PLAYER, reg, {
      getCardDefinitionById: getDef,
      sourceInstanceId: "triggered-src",
    });
    expect(candidates).not.toContain(adventSourceId);
  });
});
