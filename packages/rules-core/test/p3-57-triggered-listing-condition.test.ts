import { describe, expect, it } from "vitest";
import type { CardDefinition, CollectedTriggerEvent } from "../src";
import {
  createCardInstance,
  createEmptyGameState,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

/**
 * P3-57: triggered effect listing 段階で `condition` が評価されない回帰テスト。
 *
 * BSTH01-M01 パチュリー・ノーレッジを模した最小 fixture:
 * - hand 領域から `start_step` で発火する optional triggered effect
 * - `condition: [{ kind: "field_lacks", player: "self", cardName: "self", excludeSelf: true }]`
 *
 * 修正前: 自場に同名スピリットがあっても private declaration が積まれる (バグ)。
 * 修正後: 同名スピリットがある時は listing 段階で 0 件になり、private declaration が積まれない。
 */

function makeFieldLacksSelfHandSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `P3-57 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "phase", step: "start", subPhase: "start" },
        applicability: { zone: "hand" },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            cardName: "self",
            excludeSelf: true,
          },
        ],
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

function makeMinLevelFieldSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `P3-57 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 1000 },
      { level: 2, requiredCores: 2, bp: 2000 },
    ],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "phase", step: "start", subPhase: "start" },
        applicability: { zone: "field" },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

function makeNoConditionFieldSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `P3-57 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "phase", step: "start", subPhase: "start" },
        applicability: { zone: "field" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

function makeLookup(definitions: readonly CardDefinition[]) {
  const map = new Map(
    definitions.map((definition) => [definition.cardNo, definition])
  );
  return (definitionId: string) => map.get(definitionId);
}

function makeStartStepEvent(): CollectedTriggerEvent {
  return {
    actingPlayerId: "alice",
    eventKind: "start_step",
    source: "step_transition",
    chainId: "test:p3-57-triggered-listing-condition:116",
    attackId: null,
    relatedPlayerId: "alice",
    relatedInstanceId: null,
    amount: null,
    step: "start",
    subPhase: "start",
  };
}

describe("P3-57 triggered listing condition evaluation", () => {
  it("blocks listing when same-name spirit on field (field_lacks cardName=self) — BSTH01-M01 bug repro", () => {
    const def = makeFieldLacksSelfHandSpirit("P3-57-FIELD-LACKS");
    const lookup = makeLookup([def]);
    const triggerLookup = buildTriggeredEffectLookup([def]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "alice-field-existing",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(def, {
          instanceId: "alice-hand-target",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    // 同名スピリットが自場にいるので condition (field_lacks cardName="self") は false。
    // listing 段階で 0 件になり、private declaration が積まれてはならない。
    expect(next.pendingTriggeredEffects).toHaveLength(0);
    expect(next.pendingPrivateDeclarations).toHaveLength(0);
  });

  it("allows listing when no same-name spirit on field (regression: condition true case)", () => {
    const def = makeFieldLacksSelfHandSpirit("P3-57-FIELD-LACKS");
    const lookup = makeLookup([def]);
    const triggerLookup = buildTriggeredEffectLookup([def]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "alice-hand-target",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    // 自場に同名スピリット無し → condition 成立 → 1 件 private declaration
    expect(next.pendingTriggeredEffects).toHaveLength(0);
    expect(next.pendingPrivateDeclarations).toHaveLength(1);
    expect(next.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: "alice",
      sourceInstanceId: "alice-hand-target",
      sourceDefinitionId: "P3-57-FIELD-LACKS",
      sourceZone: "hand",
    });
  });

  it("aggregates per_card_name with multiple hand copies — only 1 declaration even before condition", () => {
    // P3-28 / P3-57 互換: 同名複数手札でも per_card_name 集約により 1 件のみ
    const def: CardDefinition = {
      ...makeFieldLacksSelfHandSpirit("P3-57-PER-CARD-NAME"),
    };
    def.effects = [
      {
        ...def.effects![0]!,
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
      },
    ];
    const lookup = makeLookup([def]);
    const triggerLookup = buildTriggeredEffectLookup([def]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "alice-hand-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(def, {
          instanceId: "alice-hand-2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    // condition 成立 + per_card_name 集約 → 1 件のみ
    expect(next.pendingPrivateDeclarations).toHaveLength(1);
  });

  it("blocks listing when min_level condition fails (Lv1 spirit + min_level=2 condition)", () => {
    const def = makeMinLevelFieldSpirit("P3-57-MIN-LEVEL");
    const lookup = makeLookup([def]);
    const triggerLookup = buildTriggeredEffectLookup([def]);
    // Lv1 = 1 core only (min_level=2 fails)
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "alice-field-lv1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    // Note: applicability の level 検査もあるが、ここでは applicability に level 制約を
    // 入れずに condition.min_level だけで弾けるかを検証する。
    expect(next.pendingTriggeredEffects).toHaveLength(0);
  });

  it("preserves listing when triggered effect has no condition (regression)", () => {
    const def = makeNoConditionFieldSpirit("P3-57-NO-COND");
    const lookup = makeLookup([def]);
    const triggerLookup = buildTriggeredEffectLookup([def]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "alice-field-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const next = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent()],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );

    // condition 無しは現状維持: 1 件 pendingTriggeredEffects
    expect(next.pendingTriggeredEffects).toHaveLength(1);
  });
});
