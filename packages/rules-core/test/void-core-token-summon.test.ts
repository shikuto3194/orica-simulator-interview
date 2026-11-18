/**
 * BSSL01-X01[5,6] cluster (bssl01-x01-token-distribution) 分: summon.target.from_token_pool
 * (executeTokenSummon) に `voidCoreMaxPerCard` を追加し、フィールド進入時コア配置の
 * 許可ソースへボイドを加える primitive の単体検証。
 *
 * 「自分のトークンの「影の兵士」をボイドからコア1個ずつまでを置いて出す」(BSSL01-X01) の
 * 「1個ずつ」= トークン1体ごとに独立した上限。既存 `trashCoreMax`（召喚全体で共有する予算、
 * BSSL01-C06「トラッシュのコアも1個まで置ける」）とは異なる semantics のため、
 * 複数体召喚時に2体目以降もボイドを使えることを検証する（shared budget と誤実装すると
 * 1体目だけがボイドを使い2体目以降が reserve 不足のまま維持コア不足になる half-wired primitive）。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src";
import { applyLegalAction, getLegalActions } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyEnterFieldCorePlacements } from "../src/zone/enter-field-placement-execution";

const PLAYER = "player-1";
const OPPONENT = "player-2";

const noTriggerLookup = () => [];

const TOKEN_DEF: CardDefinition = {
  cardNo: "TEST-TOKEN",
  name: "TEST-TOKEN",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: ["token"],
  sourceUrls: [],
  sourceConfidence: "C",
  maxTokenDeckCount: 9,
  effects: [],
};

function sourceDef(
  count: number,
  trashCoreMax: number | undefined,
  voidCoreMaxPerCard: number | undefined,
  trashCoreKind?: "normal" | "generic"
): CardDefinition {
  return {
    cardNo: "TEST-SOURCE",
    name: "TEST-SOURCE",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    relatedTokenCardNos: ["TEST-TOKEN"],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "put",
              target: { kind: "from_token_pool", count },
              trashCoreMax,
              ...(trashCoreKind !== undefined ? { trashCoreKind } : {}),
              voidCoreMaxPerCard,
            },
          },
        ],
      },
    ],
  };
}

function splitSourceDef(
  trashCoreMax: number | undefined,
  voidCoreMaxPerCard: number | undefined,
  trashCoreKind?: "normal" | "generic"
): CardDefinition {
  return {
    cardNo: "TEST-SPLIT-SOURCE",
    name: "TEST-SPLIT-SOURCE",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    relatedTokenCardNos: ["TEST-TOKEN"],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "split_field_entry_choice",
              totalCount: 1,
              tokenAction: {
                kind: "put",
                target: { kind: "from_token_pool", count: 1 },
                trashCoreMax,
                ...(trashCoreKind !== undefined ? { trashCoreKind } : {}),
                voidCoreMaxPerCard,
              },
              zoneAction: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "hand",
                  count: 1,
                },
                costModifier: "free",
              },
            },
          },
        ],
      },
    ],
  };
}

const defs = [TOKEN_DEF];
const getDef = (id: string): CardDefinition | undefined =>
  defs.find((d) => d.cardNo === id);

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  return executeEffect({
    chainId: "test:void-core-token-summon:141",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: PLAYER,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

function resolveTokenPlacementWithVoid(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const pending = state.pendingMultiPlacement;
  expect(pending).not.toBeNull();
  expect(
    pending!.targets.every((target) => target.voidNormalCoreMax === 1)
  ).toBe(true);
  const action = getLegalActions({
    state,
    actingPlayerId: PLAYER,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  }).find((candidate) => candidate.kind === "resolve_pending_multi_placement");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
    multiPlacementAllocations: pending!.targets.map((target) => ({
      destinationInstanceId: target.instanceId,
      placements: [{ kind: "void_normal", amount: 1 }],
    })),
  }).state;
}

function buildState(
  src: CardDefinition,
  playerOverrides: {
    reserveNormalCoreCount?: number;
    trashNormalCoreCount?: number;
    voidNormalCoreCount?: number;
  }
): {
  state: GameState;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
} {
  const sourceInstance = createCardInstance(src, {
    instanceId: "src",
    ownerPlayerId: PLAYER,
    zone: "field",
    normalCoreCount: 1,
  });
  const state = createEmptyGameState({
    playerIds: [PLAYER, OPPONENT],
    cardInstances: [sourceInstance],
    playerOverrides: [playerOverrides, {}],
  });
  const getCardDefinitionById = (id: string): CardDefinition | undefined =>
    id === src.cardNo ? src : getDef(id);
  return { state: { ...state, step: "main" }, getCardDefinitionById };
}

describe("summon.target.from_token_pool voidCoreMaxPerCard (BSSL01-X01[5,6] primitive)", () => {
  it("BSSL01-X01: 通常の単体維持コア配置に void_normal を直指定すると拒否する", () => {
    const src = sourceDef(1, undefined, undefined);
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 0,
      voidNormalCoreCount: 1,
    });

    expect(() =>
      applyEnterFieldCorePlacements({
        state,
        actingPlayerId: PLAYER,
        destinationInstanceId: "src",
        placements: [{ kind: "void_normal", amount: 1 }],
        getCardDefinitionById,
      })
    ).toThrow(/Void normal core placement is only allowed/);
  });

  it("BSSL01-C06: 通常の単体維持コア配置に trash_normal を直指定すると拒否する", () => {
    const src = sourceDef(1, undefined, undefined);
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 0,
      trashNormalCoreCount: 1,
    });

    expect(() =>
      applyEnterFieldCorePlacements({
        state,
        actingPlayerId: PLAYER,
        destinationInstanceId: "src",
        placements: [{ kind: "trash_normal", amount: 1 }],
        getCardDefinitionById,
      })
    ).toThrow(/Trash normal core placement is only allowed/);
  });

  it("reserve不足分をvoidCoreMaxPerCardまでボイドから補う（1体）", () => {
    const src = sourceDef(1, undefined, 1);
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 0,
      voidNormalCoreCount: 5,
    });
    const pendingState = runEffect(
      state,
      src.effects![0]!,
      "src",
      getCardDefinitionById
    );
    const after = resolveTokenPlacementWithVoid(
      pendingState,
      getCardDefinitionById
    );

    const tokens = after.cardInstances.filter(
      (c) => c.definitionId === "TEST-TOKEN"
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.normalCoreCount).toBe(1);
    expect(
      after.publicDisclosures
        ?.flatMap((entry) => entry.results)
        .filter(
          (result) =>
            result.instanceId === tokens[0]!.instanceId &&
            result.kind === "card_move"
        )
    ).toEqual([expect.objectContaining({ actionLabel: "put", to: "field" })]);
    const player = after.players.find((p) => p.id === PLAYER)!;
    expect(player.voidNormalCoreCount).toBe(4);
  });

  it("voidCoreMaxPerCardはトークン1体ごとに独立した上限（共有予算ではない: 2体とも1個ずつボイドから受け取る）", () => {
    const src = sourceDef(2, undefined, 1);
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 0,
      voidNormalCoreCount: 10,
    });
    const pendingState = runEffect(
      state,
      src.effects![0]!,
      "src",
      getCardDefinitionById
    );
    const after = resolveTokenPlacementWithVoid(
      pendingState,
      getCardDefinitionById
    );

    const tokens = after.cardInstances.filter(
      (c) => c.definitionId === "TEST-TOKEN"
    );
    expect(tokens).toHaveLength(2);
    for (const token of tokens) {
      expect(token.normalCoreCount).toBe(1);
    }
    const player = after.players.find((p) => p.id === PLAYER)!;
    // 2体 x 1個ずつ = 合計2個消費（shared budget=1 の誤実装なら 1 個しか減らない）。
    expect(player.voidNormalCoreCount).toBe(8);
  });

  it("BSSL01-X01: token維持コア供給不足なら解決不能なpendingMultiPlacementを生成しない", () => {
    const src = sourceDef(2, undefined, 1);
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 0,
      voidNormalCoreCount: 1,
    });
    const sourceHasNoFieldCore = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "src" ? { ...card, normalCoreCount: 0 } : card
      ),
    };

    const after = runEffect(
      sourceHasNoFieldCore,
      src.effects![0]!,
      "src",
      getCardDefinitionById
    );

    expect(after.pendingMultiPlacement).toBeNull();
    expect(
      after.cardInstances.filter((c) => c.definitionId === "TEST-TOKEN")
    ).toHaveLength(0);
    expect(after.log).toContain(
      "effect:summon:token:player-1:TEST-TOKEN:insufficient-enter-cores:required=2"
    );
  });

  it("BSSL01-C06: generic trashCoreMaxはpendingMultiPlacementの共有上限として問い、1個だけトラッシュから置ける", () => {
    const src = sourceDef(2, 1, undefined, "generic");
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 1,
      trashNormalCoreCount: 5,
    });
    const pendingState = runEffect(
      state,
      src.effects![0]!,
      "src",
      getCardDefinitionById
    );
    const pending = pendingState.pendingMultiPlacement;
    expect(pending).not.toBeNull();
    expect(pending!.targets).toHaveLength(2);
    expect(pending!.trashCoreMax).toBe(1);
    expect(pending!.trashNormalCoreMax).toBeUndefined();
    expect(
      pending!.targets.every((target) => target.voidNormalCoreMax === undefined)
    ).toBe(true);
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: PLAYER,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(action).toBeDefined();
    const [first, second] = pending!.targets;
    const after = applyLegalAction({
      state: pendingState,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      multiPlacementAllocations: [
        {
          destinationInstanceId: first!.instanceId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: second!.instanceId,
          placements: [{ kind: "trash_normal", amount: 1 }],
        },
      ],
    }).state;

    expect(after.pendingMultiPlacement).toBeNull();
    const tokens = after.cardInstances.filter(
      (c) => c.definitionId === "TEST-TOKEN"
    );
    expect(tokens).toHaveLength(2);
    for (const token of tokens) {
      expect(token.normalCoreCount).toBe(1);
    }
    const player = after.players.find((p) => p.id === PLAYER)!;
    expect(player.reserveNormalCoreCount).toBe(0);
    expect(player.trashNormalCoreCount).toBe(4);
  });

  it("BSSL01-C06: generic trashCoreMaxの共有上限を超えるmultiPlacement payloadを拒否する", () => {
    const src = sourceDef(2, 1, undefined, "generic");
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 0,
      trashNormalCoreCount: 5,
    });
    const pendingState = runEffect(
      state,
      src.effects![0]!,
      "src",
      getCardDefinitionById
    );
    const pending = pendingState.pendingMultiPlacement!;
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: PLAYER,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(action).toBeDefined();

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: action!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        multiPlacementAllocations: pending.targets.map((target) => ({
          destinationInstanceId: target.instanceId,
          placements: [{ kind: "trash_normal", amount: 1 }],
        })),
      })
    ).toThrow(/exceeds trash core max/);
  });

  it("BSSL01-C06: generic trashCoreMaxはトラッシュのソウルコアを1個まで選べる", () => {
    const src = sourceDef(1, 1, undefined, "generic");
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 0,
      trashNormalCoreCount: 0,
    });
    const playerWithTrashSoul = {
      ...state,
      players: state.players.map((p) =>
        p.id === PLAYER
          ? {
              ...p,
              soulCoreLocation: { kind: "trash" as const },
              reserveSoulCoreCount: 0,
              trashSoulCoreCount: 1,
            }
          : p
      ),
    };
    const pendingState = runEffect(
      playerWithTrashSoul,
      src.effects![0]!,
      "src",
      getCardDefinitionById
    );
    const pending = pendingState.pendingMultiPlacement!;
    expect(pending.trashCoreMax).toBe(1);
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: PLAYER,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(action).toBeDefined();

    const after = applyLegalAction({
      state: pendingState,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      multiPlacementAllocations: [
        {
          destinationInstanceId: pending.targets[0]!.instanceId,
          placements: [{ kind: "trash_soul" }],
        },
      ],
    }).state;

    expect(after.pendingMultiPlacement).toBeNull();
    const token = after.cardInstances.find(
      (c) => c.definitionId === "TEST-TOKEN"
    )!;
    const player = after.players.find((p) => p.id === PLAYER)!;
    expect(token.normalCoreCount).toBe(0);
    expect(player.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: token.instanceId,
    });
  });

  it("trashCoreMaxとvoidCoreMaxPerCardの同時指定はdirect token summonで明示拒否する", () => {
    const src = sourceDef(1, 1, 1);
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 1,
      trashNormalCoreCount: 1,
      voidNormalCoreCount: 1,
    });

    const after = runEffect(
      state,
      src.effects![0]!,
      "src",
      getCardDefinitionById
    );

    expect(after.pendingMultiPlacement).toBeNull();
    expect(
      after.cardInstances.filter((c) => c.definitionId === "TEST-TOKEN")
    ).toHaveLength(0);
    expect(after.log).toContain(
      "effect:summon:token:player-1:TEST-TOKEN:unsupported-core-source-combination:trash+void"
    );
  });

  it("trashCoreMaxとvoidCoreMaxPerCardの同時指定はsplit_field_entry_choiceでもpendingを開かず明示拒否する", () => {
    const src = splitSourceDef(1, 1);
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 1,
      trashNormalCoreCount: 1,
      voidNormalCoreCount: 1,
    });

    const after = runEffect(
      state,
      src.effects![0]!,
      "src",
      getCardDefinitionById
    );

    expect(after.pendingSplitSummonChoice).toBeNull();
    expect(after.pendingMultiPlacement).toBeNull();
    expect(
      after.cardInstances.filter((c) => c.definitionId === "TEST-TOKEN")
    ).toHaveLength(0);
    expect(after.log).toContain(
      "effect:split_summon_choice:src:unsupported-token-core-source-combination:trash+void"
    );
  });

  it("BSSL01-X01: 同じpendingMultiPlacementのtargetを維持コアsourceにするAPI payloadを拒否する", () => {
    const src = sourceDef(2, undefined, 1);
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 1,
      voidNormalCoreCount: 1,
    });
    const pendingState = runEffect(
      state,
      src.effects![0]!,
      "src",
      getCardDefinitionById
    );
    const pending = pendingState.pendingMultiPlacement;
    expect(pending).not.toBeNull();
    expect(pending!.targets).toHaveLength(2);
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: PLAYER,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(action).toBeDefined();
    const [first, second] = pending!.targets;

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: action!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        multiPlacementAllocations: [
          {
            destinationInstanceId: first!.instanceId,
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
          {
            destinationInstanceId: second!.instanceId,
            placements: [
              {
                kind: "card_normal",
                instanceId: first!.instanceId,
                amount: 1,
              },
            ],
          },
        ],
      })
    ).toThrow(/cannot be used as placement source/);
  });

  it("voidCoreMaxPerCard指定時も自動充当せず、pendingMultiPlacementでreserve配置を選べる", () => {
    const src = sourceDef(1, undefined, 1);
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 1,
      trashNormalCoreCount: 3,
      voidNormalCoreCount: 3,
    });
    const pendingState = runEffect(
      state,
      src.effects![0]!,
      "src",
      getCardDefinitionById
    );
    const pending = pendingState.pendingMultiPlacement;
    expect(pending).not.toBeNull();
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: PLAYER,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(action).toBeDefined();
    const after = applyLegalAction({
      state: pendingState,
      action: action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      multiPlacementAllocations: pending!.targets.map((target) => ({
        destinationInstanceId: target.instanceId,
        placements: [{ kind: "reserve_normal", amount: 1 }],
      })),
    }).state;

    const tokens = after.cardInstances.filter(
      (c) => c.definitionId === "TEST-TOKEN"
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.normalCoreCount).toBe(1);
    const player = after.players.find((p) => p.id === PLAYER)!;
    expect(player.reserveNormalCoreCount).toBe(0);
    expect(player.trashNormalCoreCount).toBe(3);
    expect(player.voidNormalCoreCount).toBe(3);
  });

  it("voidCoreMaxPerCard未指定時は従来どおりボイドを使わない", () => {
    const src = sourceDef(1, undefined, undefined);
    const { state, getCardDefinitionById } = buildState(src, {
      reserveNormalCoreCount: 0,
      voidNormalCoreCount: 5,
    });
    const after = runEffect(
      state,
      src.effects![0]!,
      "src",
      getCardDefinitionById
    );

    const tokens = after.cardInstances.filter(
      (c) => c.definitionId === "TEST-TOKEN"
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.normalCoreCount).toBe(0);
    expect(after.pendingMultiPlacement?.targets).toEqual([
      expect.objectContaining({
        instanceId: tokens[0]!.instanceId,
        enterFieldEventKind: "put",
      }),
    ]);
    expect(after.pendingMultiPlacement?.targets[0]?.voidNormalCoreMax).toBe(
      undefined
    );
    const player = after.players.find((p) => p.id === PLAYER)!;
    expect(player.voidNormalCoreCount).toBe(5);
  });
});
