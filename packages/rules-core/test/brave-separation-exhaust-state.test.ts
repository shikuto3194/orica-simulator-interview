import { describe, expect, it } from "vitest";
import type { CardDefinition, LegalAction } from "../src";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  flushPendingLeaves,
  resolveBraveLeaveChoice,
  resolveSoulStateReplacement,
  runStateBasedActions,
} from "../src";

const ALICE = "player-1";
const BOB = "player-2";

function def(overrides: Partial<CardDefinition>): CardDefinition {
  return {
    cardNo: overrides.cardNo ?? "TEST-CARD",
    name: overrides.name ?? "Test Card",
    printedCategory: overrides.printedCategory ?? "spirit",
    printedColors: ["red"],
    colors: ["red"],
    symbolColors: overrides.symbolColors ?? ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: overrides.levelDefs ?? [
      { level: 1, requiredCores: 1, bp: 3000 },
    ],
    textLines: overrides.textLines ?? [],
    images: {},
    tribe: "",
    ...overrides,
  } as CardDefinition;
}

const hostDef = def({
  cardNo: "TEST-SEPARATION-HOST",
  name: "Separation Host",
  printedCategory: "spirit",
});
const normalBraveDef = def({
  cardNo: "TEST-SEPARATION-NORMAL-BRAVE",
  name: "Normal Brave",
  printedCategory: "brave",
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
});
const noExhaustBraveDef = def({
  cardNo: "TEST-SEPARATION-NO-EXHAUST-BRAVE",
  name: "No Exhaust Brave",
  printedCategory: "brave",
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  textLines: [
    "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された自分のスピリットに合体できる。",
  ],
});
const noExhaustContractCombineBraveDef = def({
  cardNo: "TEST-SEPARATION-NO-EXHAUST-CONTRACT-BRAVE",
  name: "No Exhaust Contract Combine Brave",
  printedCategory: "brave",
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  textLines: [
    "フラッシュ【契約合体：GE＆赤／紫『自分のターン』】",
    "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から合体する。",
    "",
    "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された/スピリット状態になった自分のスピリットに合体できる。",
  ],
});

const defs = new Map(
  [
    hostDef,
    normalBraveDef,
    noExhaustBraveDef,
    noExhaustContractCombineBraveDef,
  ].map((definition) => [definition.cardNo, definition])
);
const getDef = (id: string): CardDefinition | undefined => defs.get(id);

function separate(
  braveDef: CardDefinition,
  braveOverrides: Partial<ReturnType<typeof createCardInstance>> = {},
  hostOverrides: Partial<ReturnType<typeof createCardInstance>> = {}
) {
  const host = {
    ...createCardInstance(hostDef, {
      instanceId: "host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    }),
    attachedChildrenIds: ["brave"],
    ...hostOverrides,
  };
  const brave = {
    ...createCardInstance(braveDef, {
      instanceId: "brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      exhaustState: "exhausted",
    }),
    attachedToInstanceId: "host",
    ...braveOverrides,
  };
  const state = createEmptyGameState({
    cardInstances: [host, brave],
  });
  const action: LegalAction = {
    kind: "brave_separate",
    actionId: "test:brave-separate",
    can: true,
    reason: "test",
    actingPlayerId: ALICE,
    hostInstanceId: "host",
    braveInstanceId: "brave",
  };

  return applyLegalAction({
    state,
    action,
    getCardDefinitionById: getDef,
  }).state.cardInstances.find((card) => card.instanceId === "brave")!;
}

describe("ブレイヴ分離時の疲労状態", () => {
  it("疲労せずが無い通常ブレイヴは分離時にホストの回復状態を引き継ぐ", () => {
    const brave = separate(normalBraveDef);

    expect(brave.attachedToInstanceId).toBeNull();
    expect(brave.exhaustState).toBe("recovered");
  });

  it("疲労せずが無い通常ブレイヴは分離時にホストの疲労状態を引き継ぐ", () => {
    const brave = separate(
      normalBraveDef,
      { exhaustState: "recovered" },
      { exhaustState: "exhausted" }
    );

    expect(brave.attachedToInstanceId).toBeNull();
    expect(brave.exhaustState).toBe("exhausted");
  });

  it("疲労せずが無い通常ブレイヴは分離時にホストの重疲労状態を引き継ぐ", () => {
    const brave = separate(
      normalBraveDef,
      { exhaustState: "recovered" },
      { exhaustState: "heavily_exhausted" }
    );

    expect(brave.attachedToInstanceId).toBeNull();
    expect(brave.exhaustState).toBe("heavily_exhausted");
  });

  it("先頭テキストに疲労しないスピリット状態制限を持つブレイヴは分離時に回復する", () => {
    const brave = separate(
      noExhaustBraveDef,
      { exhaustState: "exhausted" },
      { exhaustState: "exhausted" }
    );

    expect(brave.attachedToInstanceId).toBeNull();
    expect(brave.exhaustState).toBe("recovered");
  });

  it("契約合体ヘッダー直後の先頭効果でも分離時に回復する", () => {
    const brave = separate(
      noExhaustContractCombineBraveDef,
      { exhaustState: "exhausted" },
      { exhaustState: "exhausted" }
    );

    expect(brave.attachedToInstanceId).toBeNull();
    expect(brave.exhaustState).toBe("recovered");
  });

  it("先頭テキスト型は防げない疲労由来でも分離時に回復する", () => {
    const brave = separate(
      noExhaustBraveDef,
      {
        exhaustedByUnpreventableEffect: true,
      },
      { exhaustState: "exhausted" }
    );

    expect(brave.attachedToInstanceId).toBeNull();
    expect(brave.exhaustState).toBe("recovered");
    expect(brave.exhaustedByUnpreventableEffect).toBe(false);
  });

  it("単体スピリット状態の先頭テキスト型ブレイヴは防げない印なしの疲労をSBAで回復する", () => {
    const brave = createCardInstance(noExhaustBraveDef, {
      instanceId: "brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      exhaustState: "exhausted",
    });
    const state = createEmptyGameState({ cardInstances: [brave] });

    const after = runStateBasedActions(state, getDef).state.cardInstances.find(
      (card) => card.instanceId === "brave"
    )!;

    expect(after.exhaustState).toBe("recovered");
  });

  it("単体スピリット状態の先頭テキスト型ブレイヴは防げない印があってもSBAで回復する", () => {
    const brave = {
      ...createCardInstance(noExhaustBraveDef, {
        instanceId: "brave",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
        exhaustState: "exhausted",
      }),
      exhaustedByUnpreventableEffect: true,
    };
    const state = createEmptyGameState({ cardInstances: [brave] });

    const after = runStateBasedActions(state, getDef).state.cardInstances.find(
      (card) => card.instanceId === "brave"
    )!;

    expect(after.exhaustState).toBe("recovered");
    expect(after.exhaustedByUnpreventableEffect).toBe(false);
  });

  it("ホストが離脱で場外へ行っても通常ブレイヴは離脱前ホストの疲労状態を引き継ぐ", () => {
    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "host-leaves",
      }),
      attachedChildrenIds: ["brave"],
    };
    const brave = {
      ...createCardInstance(normalBraveDef, {
        instanceId: "brave",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
        exhaustState: "recovered",
      }),
      attachedToInstanceId: "host",
    };
    const state = {
      ...createEmptyGameState({ cardInstances: [host, brave] }),
      pendingBraveLeaveChoice: {
        choosingPlayerId: ALICE,
        hostInstanceId: "host",
        braveInstanceIds: ["brave"],
        leaveKind: "destroy" as const,
        leaveCause: "effect_resolution" as const,
      },
      pendingLeaveEntities: [
        {
          instanceId: "host",
          kind: "destroy" as const,
          cause: "effect_resolution" as const,
          causePlayerId: BOB,
          chainId: "host-leaves",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const afterKeep = resolveBraveLeaveChoice(state, "keep", undefined, getDef);
    const afterFlush = flushPendingLeaves(afterKeep, getDef);
    const afterBrave = afterFlush.cardInstances.find(
      (card) => card.instanceId === "brave"
    )!;

    expect(
      afterFlush.cardInstances.find((card) => card.instanceId === "host")!.zone
    ).toBe("trash");
    expect(afterBrave.attachedToInstanceId).toBeNull();
    expect(afterBrave.exhaustState).toBe("exhausted");
  });

  it("ホストがkeep後に魂状態化しても通常ブレイヴは離脱前ホストの疲労状態を引き継ぐ", () => {
    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
        pendingLeaveKind: "destroy",
        pendingLeaveCause: "effect_resolution",
        pendingLeaveChainId: "host-to-soul",
      }),
      attachedChildrenIds: ["brave"],
    };
    const brave = {
      ...createCardInstance(normalBraveDef, {
        instanceId: "brave",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
        exhaustState: "recovered",
      }),
      attachedToInstanceId: "host",
    };
    const state = {
      ...createEmptyGameState({ cardInstances: [host, brave] }),
      pendingBraveLeaveChoice: {
        choosingPlayerId: ALICE,
        hostInstanceId: "host",
        braveInstanceIds: ["brave"],
        leaveKind: "destroy" as const,
        leaveCause: "effect_resolution" as const,
      },
      pendingSoulStateReplacement: {
        choosingPlayerId: ALICE,
        cardInstanceId: "host",
        originalLeaveKind: "destroy" as const,
        originalLeaveCause: "effect_resolution" as const,
      },
      pendingLeaveEntities: [
        {
          instanceId: "host",
          kind: "destroy" as const,
          cause: "effect_resolution" as const,
          causePlayerId: BOB,
          chainId: "host-to-soul",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const afterKeep = resolveBraveLeaveChoice(state, "keep", undefined, getDef);
    const afterSoul = resolveSoulStateReplacement(afterKeep, true, getDef);
    const afterBrave = afterSoul.cardInstances.find(
      (card) => card.instanceId === "brave"
    )!;

    expect(afterSoul.players[0]!.soulStateInstanceIds).toContain("host");
    expect(afterBrave.attachedToInstanceId).toBeNull();
    expect(afterBrave.exhaustState).toBe("exhausted");
  });
});
