/**
 * ENGINE-core-move-trash-to-this-card-soul: core_move from:trash → to:this_card は
 * generic「トラッシュのコア」でソウルコアを含む。通常/ソウルの真の選択肢があるときは
 * pendingLifeCoreSelection で持ち主に選ばせ、explicit_soul_core / normal_only は明示指定を尊重する。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const shooter: CardDefinition = {
  cardNo: "TEST-TRASH-THISCARD-SHOOTER",
  name: "トラッシュコア源 (このカード)",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = new Map<string, CardDefinition>([[shooter.cardNo, shooter]]);

function effectTrashToThisCard(
  effectKind?: "explicit_soul_core" | "normal_only" | "generic"
): Effect {
  return {
    timing: { kind: "card_event", event: "attack" },
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "trash", player: "self" },
          to: { kind: "this_card" },
          amount: 1,
          ...(effectKind ? { effectKind } : {}),
        },
      },
    ],
  };
}

function makeState(
  cards: CardInstance[],
  opts: { aliceTrashNormal?: number; aliceSoulInTrash?: boolean } = {}
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    players: base.players.map((p) =>
      p.id === "alice"
        ? {
            ...p,
            trashNormalCoreCount: opts.aliceTrashNormal ?? 0,
            ...(opts.aliceSoulInTrash
              ? { soulCoreLocation: { kind: "trash" as const } }
              : {}),
          }
        : p
    ),
    cardInstances: cards,
  };
}

describe("core_move from:trash to:this_card (ENGINE-core-move-trash-to-this-card-soul)", () => {
  it("explicit_soul_core: トラッシュのソウルコアをこのカードへ置く", () => {
    const shooterCard = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const state = makeState([shooterCard], { aliceSoulInTrash: true });

    const result = executeEffect({
      chainId: "test:core-move-from-trash-to-this-card-soul:82",
      state,
      effect: effectTrashToThisCard("explicit_soul_core"),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "shooter-1",
    });
    expect(alice.trashSoulCoreCount).toBe(0);
    const shooterAfter = result.cardInstances.find(
      (c) => c.instanceId === "shooter-1"
    )!;
    expect(shooterAfter.soulCoreCount).toBe(1);
    expect(shooterAfter.normalCoreCount).toBe(0);
  });

  it("explicit_soul_core: トラッシュにソウルコアが無ければ no-op (通常コアには触れない)", () => {
    const shooterCard = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const state = makeState([shooterCard], { aliceTrashNormal: 3 });

    const result = executeEffect({
      chainId: "test:core-move-from-trash-to-this-card-soul:112",
      state,
      effect: effectTrashToThisCard("explicit_soul_core"),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.trashNormalCoreCount).toBe(3);
    const shooterAfter = result.cardInstances.find(
      (c) => c.instanceId === "shooter-1"
    )!;
    expect(shooterAfter.normalCoreCount).toBe(0);
  });

  it("generic (省略): トラッシュが soul のみなら auto-pick でこのカードへ置く", () => {
    const shooterCard = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const state = makeState([shooterCard], {
      aliceSoulInTrash: true,
    });

    const result = executeEffect({
      chainId: "test:core-move-from-trash-to-this-card-soul:139",
      state,
      effect: effectTrashToThisCard(),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(result.pendingLifeCoreSelection).toBeNull();
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "shooter-1",
    });
    const shooterAfter = result.cardInstances.find(
      (c) => c.instanceId === "shooter-1"
    )!;
    expect(shooterAfter.normalCoreCount).toBe(0);
    expect(shooterAfter.soulCoreCount).toBe(1);
  });

  it("generic (省略): 通常/ソウル混在で pending を開き、持ち主が soul を選べる", () => {
    const shooterCard = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const state = makeState([shooterCard], {
      aliceTrashNormal: 2,
      aliceSoulInTrash: true,
    });

    const generated = executeEffect({
      chainId: "test:core-move-from-trash-to-this-card-soul:173",
      state,
      effect: effectTrashToThisCard(),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(generated.pendingLifeCoreSelection).toMatchObject({
      actingPlayerId: "alice",
      normalAvailable: 2,
      soulAvailable: 1,
      totalAmount: 1,
      fromLocation: { kind: "trash", player: "self" },
      toLocation: { kind: "this_card" },
    });

    const action = getLegalActions({
      state: generated,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    }).find((a) => a.kind === "resolve_pending_life_core_selection")!;
    expect(action).toBeDefined();

    const resolved = applyLegalAction({
      state: generated,
      action,
      getCardDefinitionById: (id) => defs.get(id),
      lifeCorePartitionChoice: { normalChosen: 0, soulChosen: 1 },
    }).state;

    expect(resolved.pendingLifeCoreSelection).toBeNull();
    const alice = resolved.players.find((p) => p.id === "alice")!;
    expect(alice.trashNormalCoreCount).toBe(2);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "shooter-1",
    });
  });

  it("normal_only: 通常コアだけを移動し soul には触れない", () => {
    const shooterCard = createCardInstance(shooter, {
      instanceId: "shooter-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const state = makeState([shooterCard], {
      aliceTrashNormal: 2,
      aliceSoulInTrash: true,
    });

    const result = executeEffect({
      chainId: "test:core-move-from-trash-to-this-card-soul:225",
      state,
      effect: effectTrashToThisCard("normal_only"),
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(result.pendingLifeCoreSelection).toBeNull();
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.soulCoreLocation).toEqual({ kind: "trash" });
    const shooterAfter = result.cardInstances.find(
      (c) => c.instanceId === "shooter-1"
    )!;
    expect(shooterAfter.normalCoreCount).toBe(1);
    expect(shooterAfter.soulCoreCount).toBe(0);
  });
});
