/**
 * P3-100 星霊衣 star_garment — S3 host 効果集約の continuous slice。
 *
 * 07b §6: 下の星霊衣 B面効果は under-card 自身ではなく host に働く。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  collectContinuousEffectInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  getEffectiveBp,
  recomputeAndRebuildContinuousEffects,
  rebuildContinuousEffectsFromField,
} from "../src";
import { evaluateCondition } from "../src/effect/structured-condition-eval";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
  GameStateInvariantIssue,
} from "../src";

const ALICE = "player-1";
const BOB = "player-2";

const hostDef: CardDefinition = {
  underCardSlots: [
    { roleTag: "星霊衣", maxCount: 1 },
    { roleTag: "バレットエディット", maxCount: 1 },
  ],
  cardNo: "SG-HOST",
  name: "Star Garment Test Host",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 4000 },
    { level: 2, requiredCores: 2, bp: 6000 },
  ],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const underDef: CardDefinition = {
  cardNo: "SG-UNDER-B",
  name: "Star Garment Test Under B",
  printedCategory: "brave",
  colors: ["yellow"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["yellow"],
  textLines: [
    "【星霊衣】でスピリットの下にあるこのカード",
    "このスピリットをBP+3000する。",
  ],
  keywordTags: ["star_garment"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "continuous" },
      condition: [{ kind: "self_state", state: "on_field" }],
      steps: [
        {
          action: {
            kind: "bp_modify",
            target: { kind: "self" },
            amount: 3000,
            duration: { scope: "while_on_field" },
          },
        },
      ],
      textRef: [0, 1],
    },
  ],
};

const suppressorDef: CardDefinition = {
  ...hostDef,
  cardNo: "SG-SUPPRESSOR",
  name: "Star Garment Test Suppressor",
};

const hostDefB: CardDefinition = {
  ...hostDef,
  cardNo: "SG-HOST-B",
  name: "Star Garment Test Host B",
};

const nonSpiritHostDef: CardDefinition = {
  ...hostDef,
  cardNo: "SG-HOST-NEXUS",
  name: "Star Garment Test Non-Spirit Host",
  printedCategory: "nexus",
};

const nativeFlashDef: CardDefinition = {
  ...hostDef,
  cardNo: "SG-NATIVE-FLASH",
  name: "Native Flash Self Provenance",
  textLines: [
    "フラッシュ",
    "このターンの間、このスピリットは疲労状態でブロックできる。",
  ],
  effects: [
    {
      timing: { kind: "flash" },
      steps: [
        {
          action: {
            kind: "allow_block_while_exhausted",
            target: { kind: "self" },
            duration: { scope: "turn" },
          },
        },
      ],
      textRef: [0, 1],
    },
  ],
};

const noDupUnderDef: CardDefinition = {
  ...underDef,
  cardNo: "SG-UNDER-NODUP-B",
  name: "Star Garment No Duplicate Under B",
  effects: [
    {
      timing: { kind: "continuous" },
      usageLimit: { kind: "no_duplicate" },
      steps: [
        {
          action: {
            kind: "bp_modify",
            target: { kind: "self" },
            amount: 1000,
            duration: { scope: "while_on_field" },
          },
        },
      ],
      textRef: [0, 1],
    },
  ],
};

const defs = new Map<string, CardDefinition>([
  [hostDef.cardNo, hostDef],
  [hostDefB.cardNo, hostDefB],
  [suppressorDef.cardNo, suppressorDef],
  [nonSpiritHostDef.cardNo, nonSpiritHostDef],
  [nativeFlashDef.cardNo, nativeFlashDef],
  [underDef.cardNo, underDef],
  [noDupUnderDef.cardNo, noDupUnderDef],
]);
const getDef = (id: string): CardDefinition | undefined => defs.get(id);

const realDefs = new Map(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((def) => [def.cardNo, def])
);
const getRealDef = (id: string): CardDefinition | undefined => realDefs.get(id);

function realCard(cardNo: string): CardDefinition {
  const def = getRealDef(cardNo);
  if (!def) throw new Error(`missing test card: ${cardNo}`);
  return def;
}

function makeState(): GameState {
  const host = createCardInstance(hostDef, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });
  host.underCards = [
    { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
  ];

  const under = createCardInstance(underDef, {
    instanceId: "under-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  under.attachedToInstanceId = "host-1";
  under.zoneRoleName = "star-garment";

  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, under],
  });
}

function withSoulStateHost(state: GameState, hostId = "host-1"): GameState {
  return {
    ...state,
    cardInstances: state.cardInstances.map((card) =>
      card.instanceId === hostId ? { ...card, normalCoreCount: 0 } : card
    ),
    players: state.players.map((player) =>
      player.id === ALICE
        ? {
            ...player,
            soulStateInstanceIds: [
              ...new Set([...player.soulStateInstanceIds, hostId]),
            ],
          }
        : player
    ),
  };
}

function makeRealTr08State(): GameState {
  const realHostDef = realCard("BSFT01-CX01");
  const realUnderDef = realCard("BSFT01-TR08(B)");

  const host = createCardInstance(realHostDef, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });
  host.underCards = [
    { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
  ];

  const under = createCardInstance(realUnderDef, {
    instanceId: "under-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  under.attachedToInstanceId = "host-1";
  under.zoneRoleName = "star-garment";

  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, under],
  });
}

function makeRealTr03State(): GameState {
  const realHostDef = realCard("BSFT01-CX01");
  const realUnderDef = realCard("BSFT01-TR03(B)");

  const host = createCardInstance(realHostDef, {
    instanceId: "lucy-host",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });
  host.underCards = [
    { cardInstanceId: "under-tr03", role: "text_role", roleTag: "星霊衣" },
  ];

  const under = createCardInstance(realUnderDef, {
    instanceId: "under-tr03",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  under.attachedToInstanceId = "lucy-host";
  under.zoneRoleName = "star-garment";

  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, under],
  });
}

function makeRealTr08NativeState(): GameState {
  const realUnderDef = realCard("BSFT01-TR08(B)");
  const under = createCardInstance(realUnderDef, {
    instanceId: "tr08b-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });

  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [under],
  });
}

function makeNativeFlashSelfCeState(): GameState {
  const source = createCardInstance(nativeFlashDef, {
    instanceId: "native-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });
  const nativeCe: ContinuousEffect = {
    effectId: "ce-native-self",
    sourceInstanceId: "native-1",
    sourceDefinitionId: nativeFlashDef.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "allow_block_while_exhausted",
    targetInstanceId: "native-1",
    provenance: {
      effectIndex: 0,
      stepIndex: 0,
      effectSourceInstanceId: "native-1",
      effectSourceDefinitionId: nativeFlashDef.cardNo,
    },
  };

  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
    }),
    turnNumber: 1,
    activeContinuousEffects: [nativeCe],
  };
}

describe("P3-100 star_garment: continuous host aggregation", () => {
  it("under-card continuous BP effect is registered on the host", () => {
    const state = makeState();
    const host = state.cardInstances.find((c) => c.instanceId === "host-1")!;
    const baseBp = getEffectiveBp(state, host, hostDef, getDef);

    const rebuilt = rebuildContinuousEffectsFromField(state, getDef);
    const hostAfter = rebuilt.cardInstances.find(
      (c) => c.instanceId === "host-1"
    )!;

    expect(getEffectiveBp(rebuilt, hostAfter, hostDef, getDef)).toBe(
      baseBp + 3000
    );
    expect(rebuilt.activeContinuousEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: "host-1",
          sourceDefinitionId: "SG-HOST",
          targetInstanceId: "host-1",
          modifierTag: "bp_modifier",
          modifierAmount: 3000,
          provenance: expect.objectContaining({
            effectIndex: 0,
            effectSourceInstanceId: "under-1",
            effectSourceDefinitionId: "SG-UNDER-B",
          }),
        }),
      ])
    );

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: rebuilt,
      issues,
      getCardDefinitionById: getDef,
    });
    expect(
      issues.filter((issue) => issue.code === "stale_continuous_effect")
    ).toHaveLength(0);
  });

  it("does not register a text_role under-card continuous effect when the host is soul state", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      withSoulStateHost(makeState()),
      getDef
    );

    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "bp_modifier" &&
          ce.provenance?.effectSourceInstanceId === "under-1"
      )
    ).toBe(false);
  });

  it("does not register a star_garment header continuous effect from a non-star_garment text_role", () => {
    const state = makeState();
    const mismatched: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "under-1"
          ? { ...card, zoneRoleName: "bullet-edit" }
          : card
      ),
    };
    const host = mismatched.cardInstances.find(
      (card) => card.instanceId === "host-1"
    )!;
    host.underCards = [
      {
        cardInstanceId: "under-1",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];

    const rebuilt = rebuildContinuousEffectsFromField(mismatched, getDef);

    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "bp_modifier" &&
          ce.provenance?.effectSourceDefinitionId === underDef.cardNo
      )
    ).toBe(false);
  });

  it("does not treat a legacy host CE as a duplicate of provider-sourced star_garment CE", () => {
    const state = makeState();
    const legacyHostCe: ContinuousEffect = {
      effectId: "ce-legacy-host-bp",
      sourceInstanceId: "host-1",
      sourceDefinitionId: hostDef.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      modifierTag: "bp_modifier",
      targetInstanceId: "host-1",
      modifierAmount: 1000,
    };
    const withLegacy: GameState = {
      ...state,
      activeContinuousEffects: [legacyHostCe],
    };

    const rebuilt = rebuildContinuousEffectsFromField(withLegacy, getDef);

    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.effectId === "ce-legacy-host-bp" &&
          ce.modifierTag === "bp_modifier"
      )
    ).toBe(true);
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "bp_modifier" &&
          ce.provenance?.effectSourceInstanceId === "under-1" &&
          ce.provenance.effectSourceDefinitionId === underDef.cardNo
      )
    ).toBe(true);
  });

  it("removes the host CE when the B-face leaves the star_garment slot", () => {
    const rebuilt = rebuildContinuousEffectsFromField(makeState(), getDef);
    const detached: GameState = {
      ...rebuilt,
      cardInstances: rebuilt.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "host-1"
          ? { ...cardInstance, underCards: [] }
          : cardInstance.instanceId === "under-1"
            ? {
                ...cardInstance,
                zone: "trash",
                attachedToInstanceId: null,
              }
            : cardInstance
      ),
    };

    const recomputed = recomputeAndRebuildContinuousEffects(detached, getDef);

    expect(
      recomputed.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "bp_modifier" &&
          ce.provenance?.effectSourceDefinitionId === "SG-UNDER-B"
      )
    ).toBe(false);
  });

  it("reports stale CE when the provider is no longer an active star_garment under-card", () => {
    const rebuilt = rebuildContinuousEffectsFromField(makeState(), getDef);
    const detached: GameState = {
      ...rebuilt,
      cardInstances: rebuilt.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "host-1"
          ? { ...cardInstance, underCards: [] }
          : cardInstance.instanceId === "under-1"
            ? {
                ...cardInstance,
                attachedToInstanceId: null,
              }
            : cardInstance
      ),
    };

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: detached,
      issues,
      getCardDefinitionById: getDef,
    });

    expect(
      issues.filter((issue) => issue.code === "stale_continuous_effect")
    ).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          "not an active external continuous effect source"
        ),
      }),
    ]);
  });

  it("reports stale CE when the host is face-down", () => {
    const rebuilt = rebuildContinuousEffectsFromField(makeState(), getDef);
    const faceDownHost: GameState = {
      ...rebuilt,
      cardInstances: rebuilt.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "host-1"
          ? { ...cardInstance, faceDown: true }
          : cardInstance
      ),
    };

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: faceDownHost,
      issues,
      getCardDefinitionById: getDef,
    });

    expect(
      issues.filter((issue) => issue.code === "stale_continuous_effect")
    ).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          "not an active external continuous effect source"
        ),
      }),
    ]);
  });

  it("removes the host CE when the host is no longer a spirit", () => {
    const rebuilt = rebuildContinuousEffectsFromField(makeState(), getDef);
    const changedHostCategory: GameState = {
      ...rebuilt,
      cardInstances: rebuilt.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === "host-1"
          ? { ...cardInstance, definitionId: nonSpiritHostDef.cardNo }
          : cardInstance
      ),
    };

    const recomputed = recomputeAndRebuildContinuousEffects(
      changedHostCategory,
      getDef
    );

    expect(
      recomputed.activeContinuousEffects.some(
        (ce) => ce.provenance?.effectSourceDefinitionId === "SG-UNDER-B"
      )
    ).toBe(false);
  });

  it("uses the under-card definition identity for filtered continuous suppression", () => {
    const state = makeState();
    const suppressor = createCardInstance(suppressorDef, {
      instanceId: "suppressor-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const suppression: ContinuousEffect = {
      effectId: "ce-suppress-under-def",
      sourceInstanceId: "suppressor-1",
      sourceDefinitionId: suppressorDef.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "while_on_field" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      modifierTag: "effect_suppression",
      targetInstanceId: "host-1",
      metadata: {
        effectFilter: {
          sourceDefinitionId: underDef.cardNo,
          effectIndex: 0,
        },
      },
    };
    const suppressedState: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, suppressor],
      activeContinuousEffects: [suppression],
    };

    const rebuilt = rebuildContinuousEffectsFromField(suppressedState, getDef);

    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "bp_modifier" &&
          ce.provenance?.effectSourceDefinitionId === underDef.cardNo
      )
    ).toBe(false);
  });

  it("uses the under-card definition identity for no_duplicate continuous dedupe", () => {
    const hostA = createCardInstance(hostDef, {
      instanceId: "host-a",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    hostA.underCards = [
      { cardInstanceId: "under-a", role: "text_role", roleTag: "星霊衣" },
    ];
    const hostB = createCardInstance(hostDefB, {
      instanceId: "host-b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    hostB.underCards = [
      { cardInstanceId: "under-b", role: "text_role", roleTag: "星霊衣" },
    ];
    const underA = createCardInstance(noDupUnderDef, {
      instanceId: "under-a",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    underA.attachedToInstanceId = "host-a";
    const underB = createCardInstance(noDupUnderDef, {
      instanceId: "under-b",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    underB.attachedToInstanceId = "host-b";

    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [hostA, hostB, underA, underB],
    });
    const rebuilt = rebuildContinuousEffectsFromField(state, getDef);
    const noDupCes = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "bp_modifier" &&
        ce.provenance?.effectSourceDefinitionId === noDupUnderDef.cardNo
    );

    expect(noDupCes).toHaveLength(1);
    expect(rebuilt.log).toContain("effect:no-duplicate-skipped:host-b:0");
  });

  it("does not aggregate BSFT01-TR08(B) ordinary B-face Lv effects through the host", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      makeRealTr08State(),
      getRealDef
    );

    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.provenance?.effectSourceDefinitionId === "BSFT01-TR08(B)" &&
          ce.provenance.effectIndex === 2
      )
    ).toBe(false);
  });

  it("registers BSFT01-TR03(B) count_as_multiple through star_garment and doubles only Lucy name counts", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      makeRealTr03State(),
      getRealDef
    );

    expect(
      rebuilt.activeContinuousEffects.find(
        (ce) =>
          ce.modifierTag === "count_as_multiple" &&
          ce.sourceInstanceId === "lucy-host" &&
          ce.targetInstanceId === ALICE &&
          ce.provenance?.effectSourceDefinitionId === "BSFT01-TR03(B)"
      )
    ).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ multiplier: 2 }),
      })
    );

    expect(
      evaluateCondition(
        rebuilt,
        [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "ルーシィ" }],
            minCount: 2,
          },
        ],
        "lucy-host",
        ALICE,
        getRealDef
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        rebuilt,
        [
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            minCount: 2,
          },
        ],
        "lucy-host",
        ALICE,
        getRealDef
      )
    ).toBe(false);
  });

  it("registers BSFT01-TR08(B) native Lv2-Lv3 block permissions when it is on field", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      makeRealTr08NativeState(),
      getRealDef
    );

    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) => ce.sourceDefinitionId === "BSFT01-TR08(B)"
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: "tr08b-1",
          targetInstanceId: "tr08b-1",
          modifierTag: "bp_modifier",
          modifierAmount: 3000,
          timingScope: { player: "opponent", period: "attack" },
        }),
        expect.objectContaining({
          sourceInstanceId: "tr08b-1",
          targetInstanceId: "tr08b-1",
          modifierTag: "allow_block_while_exhausted",
          timingScope: { player: "opponent", period: "attack" },
        }),
        expect.objectContaining({
          sourceInstanceId: "tr08b-1",
          targetInstanceId: "tr08b-1",
          modifierTag: "block_unblockable",
          timingScope: { player: "opponent", period: "attack" },
        }),
      ])
    );
  });

  it("keeps ordinary self-sourced temporary CEs during recompute", () => {
    const recomputed = recomputeAndRebuildContinuousEffects(
      makeNativeFlashSelfCeState(),
      getDef
    );

    expect(
      recomputed.activeContinuousEffects.some(
        (ce) =>
          ce.effectId === "ce-native-self" &&
          ce.provenance?.effectSourceInstanceId === ce.sourceInstanceId
      )
    ).toBe(true);
  });
});
