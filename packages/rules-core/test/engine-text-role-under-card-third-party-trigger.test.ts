/**
 * ENGINE-c09-text-role-under-card-third-party-trigger: text_role アンダーカード
 * (【アルドノアドライブ】等) が host に実配置されたときの第三者観測 game_event primitive。
 *
 * 検証範囲:
 * - collectTriggerEventsFromStateDelta の diff 検出: host.underCards に role="text_role"
 *   の新規エントリが増分したら "text_role_under_card_placed" イベントを1件発火する
 *   (brave_combined と同型の diff idiom)。host 自身の召喚/配置/転醒 (declaresUnderCardSlot
 *   game_event) とは別イベントで、配置が実際に成立したときのみ発火する。
 * - CardFilter.hasUnderCardRoleTag: 対象カードが現に指定 roleTag の text_role アンダー
 *   カードを持つかどうかの実行時状態フィルタ (matchesCardFilter)。
 * - role が "text_role" 以外 (advent_source 等) の増分では発火しない。
 * - 既存 underCards の再配置ではなく「増分」のみを見る (元から持っていた分は再発火しない)。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
} from "../src/effect/trigger-system";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { matchesCardFilter } from "../src/card/card-filter";

function makeCard(
  cardNo: string,
  category: string,
  effects: CardDefinition["effects"] = undefined,
  extra: Partial<CardDefinition> = {}
): CardDefinition {
  const base = {
    cardNo,
    name: cardNo,
    printedCategory: category,
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs:
      category === "magic" ? [] : [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...extra,
  } as CardDefinition;
  return effects !== undefined ? { ...base, effects } : base;
}

function createLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

describe("ENGINE-c09-text-role-under-card-third-party-trigger: diff 検出", () => {
  it("host.underCards に role=text_role の新規エントリが増分すると text_role_under_card_placed が host 自身の relatedInstanceId で1件発火する", () => {
    const hostDef = makeCard("UC-HOST-01", "nexus");
    const underDef = makeCard("UC-UNDER-01", "brave");
    const observerDef = makeCard("UC-OBS-01", "nexus", [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["text_role_under_card_placed"],
          triggerFilter: { hasUnderCardRoleTag: "テスト役" },
        },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ]);
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const under = createCardInstance(underDef, {
      instanceId: "under-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const observer = createCardInstance(observerDef, {
      instanceId: "obs-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const beforeState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, under, observer],
      }),
      activePlayerId: "alice",
    };
    const afterState: GameState = {
      ...beforeState,
      cardInstances: beforeState.cardInstances.map((c) => {
        if (c.instanceId === "under-1") {
          return {
            ...c,
            zone: "field" as const,
            attachedToInstanceId: "host-1",
          };
        }
        if (c.instanceId === "host-1") {
          return {
            ...c,
            underCards: [
              {
                cardInstanceId: "under-1",
                role: "text_role" as const,
                roleTag: "テスト役",
              },
            ],
          };
        }
        return c;
      }),
    };
    const defs = [hostDef, underDef, observerDef];
    const triggerLookup = buildTriggeredEffectLookup(defs);

    const queued = collectAndQueueTriggerReactions({
      chainId: "test:engine-text-role-under-card-third-party-trigger:122",
      beforeState,
      afterState,
      source: "action_resolution",
      getCardDefinitionById: createLookup(defs),
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
    });

    const pendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "text_role_under_card_placed"
    );
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.relatedInstanceId).toBe("host-1");
    expect(pendings[0]!.event).toMatchObject({ family: "under_card_change" });
  });

  it("role が text_role 以外 (advent_source 等) の増分では発火しない", () => {
    const hostDef = makeCard("UC-HOST-02", "spirit");
    const before = createCardInstance(hostDef, {
      instanceId: "host-2",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const beforeState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [before],
      }),
      activePlayerId: "alice",
    };
    const afterState: GameState = {
      ...beforeState,
      cardInstances: beforeState.cardInstances.map((c) =>
        c.instanceId === "host-2"
          ? {
              ...c,
              underCards: [
                {
                  cardInstanceId: "adv-1",
                  role: "advent_source" as const,
                },
              ],
            }
          : c
      ),
    };
    const events = collectTriggerEventsFromStateDelta({
      beforeState,
      afterState,
      source: "action_resolution",
    });
    expect(
      events.filter((e) => e.eventKind === "text_role_under_card_placed")
    ).toHaveLength(0);
  });

  it("既存 underCards の再配置 (同一 cardInstanceId が既に host 下) では再発火しない", () => {
    const hostDef = makeCard("UC-HOST-03", "nexus");
    const hostWithExisting = createCardInstance(hostDef, {
      instanceId: "host-3",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const beforeState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          {
            ...hostWithExisting,
            underCards: [
              {
                cardInstanceId: "under-3",
                role: "text_role" as const,
                roleTag: "テスト役",
              },
            ],
          },
        ],
      }),
      activePlayerId: "alice",
    };
    // after は before と同一 (増分なし)。
    const afterState: GameState = { ...beforeState };
    const events = collectTriggerEventsFromStateDelta({
      beforeState,
      afterState,
      source: "action_resolution",
    });
    expect(
      events.filter((e) => e.eventKind === "text_role_under_card_placed")
    ).toHaveLength(0);
  });
});

describe("ENGINE-c09-text-role-under-card-third-party-trigger: CardFilter.hasUnderCardRoleTag", () => {
  it("指定 roleTag の text_role アンダーカードを持つカードにのみマッチする", () => {
    const def = makeCard("UC-FILTER-01", "nexus");
    const withRoleTag = createCardInstance(def, {
      instanceId: "with-role",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const withOtherRoleTag = createCardInstance(def, {
      instanceId: "with-other-role",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const withoutAny = createCardInstance(def, {
      instanceId: "without-any",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const cardWithRoleTag = {
      ...withRoleTag,
      underCards: [
        {
          cardInstanceId: "under-x",
          role: "text_role" as const,
          roleTag: "アルドノアドライブ",
        },
      ],
    };
    const cardWithOtherRoleTag = {
      ...withOtherRoleTag,
      underCards: [
        {
          cardInstanceId: "under-y",
          role: "text_role" as const,
          roleTag: "星霊衣",
        },
      ],
    };

    expect(
      matchesCardFilter(cardWithRoleTag, def, {
        hasUnderCardRoleTag: "アルドノアドライブ",
      })
    ).toBe(true);
    expect(
      matchesCardFilter(cardWithOtherRoleTag, def, {
        hasUnderCardRoleTag: "アルドノアドライブ",
      })
    ).toBe(false);
    expect(
      matchesCardFilter(withoutAny, def, {
        hasUnderCardRoleTag: "アルドノアドライブ",
      })
    ).toBe(false);
  });
});
