import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createActiveAttack,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  isCardTextCardState,
  getJoinActiveAttackBlockReason,
  type CardInstance,
  type ContinuousEffect,
  type GameState,
} from "../src";
import {
  isBattleCapableCategory,
  removeStateInvalidBattleEntityMembersAndRecompute,
} from "../src/battle/battle-shared";
import {
  getAttackDeclarationBlockReason,
  getBlockDeclarationBlockReason,
} from "../src/battle/battle-availability";
import {
  useAttackAsAction,
  useBlockAsAction,
} from "../src/battle/battle-actions";
import { isSpirit } from "../src/mechanics/act-as-spirit";

const def = ALL_CARDS.find((c) => c.cardNo === "BSRK01-C04")!;
const lookup = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const make = (
  id: string,
  owner = "alice",
  extra: Partial<CardInstance> = {}
) => ({
  ...createCardInstance(def, {
    instanceId: id,
    ownerPlayerId: owner,
    zone: "field",
    cores: 1,
  }),
  ...extra,
});
const ce = (
  tag: ContinuousEffect["modifierTag"],
  metadata?: Record<string, unknown>
): ContinuousEffect => ({
  effectId: tag,
  modifierTag: tag,
  sourceInstanceId: "host",
  sourceDefinitionId: def.cardNo,
  targetInstanceId: "card",
  actingPlayerId: "bob",
  duration: { scope: "turn" },
  createdAtTurn: 1,
  createdAtAttackId: null,
  ...(metadata ? { metadata } : {}),
});
function setup(
  extra: Partial<CardInstance> = {},
  ces: ContinuousEffect[] = []
) {
  const card = make("card", "bob", extra);
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [make("attacker"), card],
    }),
    step: "attack",
    activePlayerId: "alice",
    activeContinuousEffects: ces,
  };
  const entity = {
    entityId: "battle-entity:attacker",
    memberInstanceIds: ["attacker"],
    resolvedBp: 3000,
    resolvedSymbols: ["red" as const],
    attackState: "attacking" as const,
  };
  const block: GameState = {
    ...state,
    window: "declare_block",
    battleEntities: [entity],
    activeAttack: {
      ...createActiveAttack(state, entity.entityId, "alice"),
      flashBeforeBlockCompleted: true,
      flashWindowState: null,
    },
  };
  const attack: GameState = { ...state, activePlayerId: "bob" };
  const join: GameState = {
    ...block,
    activePlayerId: "bob",
    window: "declare_attack",
  };
  const common = {
    actingPlayerId: "bob",
    sourceInstanceId: "card",
    getCardDefinitionById: lookup,
  };
  return {
    card,
    state,
    attack,
    block,
    join,
    common,
    blockOptions: {
      ...common,
      state: block,
      participantEntityId: entity.entityId,
    },
  };
}

describe("カード状態と戦闘実体の共通判定", () => {
  it.each([
    { zoneRoleName: "card", faceDown: false },
    { zoneRoleName: "spirit-card", faceDown: false },
    { zoneRoleName: "card", faceDown: true },
    // 提供 snapshot の旧配置区分も印字種類へフォールバックしない。
    { zoneRoleName: "spirit", faceDown: true },
  ])(
    "$zoneRoleName / faceDown=$faceDown はアタック・ブロック・途中参加不可",
    (extra) => {
      const { card, state, attack, block, join, common, blockOptions } =
        setup(extra);
      expect(isCardTextCardState(card, state)).toBe(true);
      expect(isSpirit(card, state, lookup)).toBe(false);
      expect(isBattleCapableCategory(def, card, state)).toBe(false);
      expect(isBattleCapableCategory(def, card)).toBe(false);
      expect(
        getAttackDeclarationBlockReason({ ...common, state: attack })
      ).toBe("source_category_cannot_attack");
      expect(getBlockDeclarationBlockReason(blockOptions)).toBe(
        "source_category_cannot_block"
      );
      expect(getJoinActiveAttackBlockReason({ ...common, state: join })).toBe(
        "source_category_cannot_attack"
      );
      for (const current of [attack, block]) {
        expect(
          getLegalActions({ ...common, state: current }).filter(
            (a) =>
              (a.kind === "attack" || a.kind === "block") &&
              a.sourceInstanceId === "card"
          )
        ).toEqual([]);
      }
      expect(() => useAttackAsAction({ ...common, state: attack })).toThrow(
        "source_category_cannot_attack"
      );
      expect(() => useBlockAsAction(blockOptions)).toThrow(
        "source_category_cannot_block"
      );
    }
  );

  it("snapshot: 純化前に付与された疲労ブロック許可ではカード状態をブロックできる実体に戻さない", () => {
    const { blockOptions } = setup(
      {
        faceDown: true,
        zoneRoleName: "spirit",
        normalCoreCount: 0,
        exhaustState: "exhausted",
        faceDownContentsPublic: true,
      },
      [ce("allow_block_while_exhausted")]
    );
    expect(getBlockDeclarationBlockReason(blockOptions)).toBe(
      "source_category_cannot_block"
    );
    expect(() => useBlockAsAction(blockOptions)).toThrow(
      "source_category_cannot_block"
    );
  });

  it("分身の状態付与がある間だけ実体を持ち、付与終了後は再びカード状態になる", () => {
    const grant = ce("act_as_spirit", {
      statBlueprint: {
        kind: "static_copy",
        snapshot: {
          cost: 3,
          tribes: [],
          reductionSymbols: [],
          symbolColors: ["red"],
          levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
        },
      },
      overrides: { keywords: [] },
    });
    const { card, state, attack, common, blockOptions } = setup(
      { faceDown: true, zoneRoleName: "card" },
      [grant]
    );
    expect(isCardTextCardState(card, state)).toBe(false);
    expect(isBattleCapableCategory(def, card, state)).toBe(true);
    expect(
      getAttackDeclarationBlockReason({ ...common, state: attack })
    ).toBeNull();
    expect(getBlockDeclarationBlockReason(blockOptions)).toBeNull();
    const ended = { ...state, activeContinuousEffects: [] };
    expect(isCardTextCardState(card, ended)).toBe(true);
    expect(isBattleCapableCategory(def, card, ended)).toBe(false);
  });

  it("種類の否定は実体喪失と区別し、種類の置換は戦闘資格にも反映する", () => {
    const excluded = setup({}, [
      ce("override_properties", { properties: { excludeCategory: "spirit" } }),
    ]);
    expect(isCardTextCardState(excluded.card, excluded.state)).toBe(false);
    expect(isBattleCapableCategory(def, excluded.card, excluded.state)).toBe(
      true
    );
    const replaced = setup({}, [
      ce("override_properties", { properties: { treatAsCategory: "nexus" } }),
    ]);
    expect(isBattleCapableCategory(def, replaced.card, replaced.state)).toBe(
      false
    );
  });

  it("魂状態・下のカード・手札は印字や付与があっても戦闘実体ではない", () => {
    const { card, state } = setup({}, [ce("act_as_spirit")]);
    const soul = {
      ...state,
      players: state.players.map((p) => ({
        ...p,
        soulStateInstanceIds: ["card"],
      })),
    };
    const under = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "attacker"
          ? {
              ...c,
              underCards: [
                { cardInstanceId: "card", role: "advent_source" as const },
              ],
            }
          : c
      ),
    };
    for (const current of [soul, under]) {
      expect(isCardTextCardState(card, current)).toBe(true);
      expect(isBattleCapableCategory(def, card, current)).toBe(false);
    }
    expect(isBattleCapableCategory(def, { ...card, zone: "hand" }, state)).toBe(
      false
    );
  });

  it("戦闘中にカード状態になった実体を外しても、成立済みの宣言を取り消さない", () => {
    const { block } = setup();
    const changed = {
      ...block,
      cardInstances: block.cardInstances.map((c) =>
        c.instanceId === "attacker" ? { ...c, zoneRoleName: "card" } : c
      ),
    };
    const after = removeStateInvalidBattleEntityMembersAndRecompute(
      changed,
      lookup
    );
    expect(after.battleEntities[0]!.memberInstanceIds).toEqual([]);
    expect(after.activeAttack).toEqual(changed.activeAttack);
  });
});
