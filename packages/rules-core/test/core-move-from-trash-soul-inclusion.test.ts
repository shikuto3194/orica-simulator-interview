/**
 * generic「トラッシュのコア」は reserve 宛でもソウルコアを含む。
 * 「《ソウルコア》以外」は effectKind:"normal_only" で明示除外する。
 */
import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import type { CardDefinition, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const source: CardDefinition = {
  cardNo: "TEST-TRASH-SOUL-RESERVE-SOURCE",
  name: "トラッシュコア源",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = new Map<string, CardDefinition>([[source.cardNo, source]]);

function trashToReserveEffect(
  effectKind?: "generic" | "normal_only" | "explicit_soul_core"
): Effect {
  return {
    timing: { kind: "card_event", event: "attack" },
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "trash", player: "self" },
          to: { kind: "reserve", player: "self" },
          amount: 1,
          ...(effectKind !== undefined ? { effectKind } : {}),
        },
      },
    ],
  };
}

function makeState(options: {
  trashNormal?: number;
  soulInTrash?: boolean;
}): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    players: base.players.map((p) =>
      p.id === "alice"
        ? {
            ...p,
            trashNormalCoreCount: options.trashNormal ?? 0,
            reserveNormalCoreCount: 0,
            ...(options.soulInTrash
              ? { soulCoreLocation: { kind: "trash" as const } }
              : {}),
          }
        : p
    ),
    cardInstances: [
      createCardInstance(source, {
        instanceId: "source-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
  };
}

describe("core_move from:trash で generic コアにソウルコアを含める", () => {
  it("trash→reserve: soul のみなら auto-pick でリザーブへ移す", () => {
    const result = executeEffect({
      chainId: "test:core-move-from-trash-soul-inclusion:82",
      state: makeState({ soulInTrash: true }),
      effect: trashToReserveEffect(),
      sourceInstanceId: "source-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(result.pendingLifeCoreSelection).toBeNull();
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({ kind: "reserve" });
  });

  it("trash→reserve: 通常/ソウル混在なら持ち主選択 pending を生成する", () => {
    const generated = executeEffect({
      chainId: "test:core-move-from-trash-soul-inclusion:98",
      state: makeState({ trashNormal: 1, soulInTrash: true }),
      effect: trashToReserveEffect(),
      sourceInstanceId: "source-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(generated.pendingLifeCoreSelection).toMatchObject({
      actingPlayerId: "alice",
      normalAvailable: 1,
      soulAvailable: 1,
      totalAmount: 1,
      fromLocation: { kind: "trash", player: "self" },
      toLocation: { kind: "reserve", player: "self" },
    });

    const action = getLegalActions({
      state: generated,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    }).find((a) => a.kind === "resolve_pending_life_core_selection")!;
    const resolved = applyLegalAction({
      state: generated,
      action,
      getCardDefinitionById: (id) => defs.get(id),
      lifeCorePartitionChoice: { normalChosen: 0, soulChosen: 1 },
    }).state;

    const alice = resolved.players.find((p) => p.id === "alice")!;
    expect(resolved.pendingLifeCoreSelection).toBeNull();
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({ kind: "reserve" });
  });

  it("normal_only: トラッシュの通常コアだけをリザーブへ移す", () => {
    const result = executeEffect({
      chainId: "test:core-move-from-trash-soul-inclusion:135",
      state: makeState({ trashNormal: 2, soulInTrash: true }),
      effect: trashToReserveEffect("normal_only"),
      sourceInstanceId: "source-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(result.pendingLifeCoreSelection).toBeNull();
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.soulCoreLocation).toEqual({ kind: "trash" });
  });
});
