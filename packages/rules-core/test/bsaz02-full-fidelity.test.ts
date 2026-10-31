import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { BSAZ02_CARDS } from "../../card-data/src/cards/BSAZ02";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  executeBattleResolution,
  flushPendingLeaves,
  type CardDefinition,
  type GameState,
} from "../src";
import {
  expandCardDefinitionsWithBackFaces,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { recomputeAndRebuildContinuousEffects } from "../src/effect/continuous-effect-rebuild";
import { isCardUseRestricted } from "../src/legal/legal-actions-shared";
import { queuePendingLeave } from "../src/state-based-actions";

const definitions = new Map(
  expandCardDefinitionsWithBackFaces(BSAZ02_CARDS).map((c) => [c.cardNo, c])
);
const getDef = (id: string) => definitions.get(id);
const card = (id: string) => getDef(id)!;
function scene(no: string, cores = 1): GameState {
  const host = createCardInstance(card(no), {
    instanceId: "host",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: cores,
  });
  host.underCards = [
    {
      cardInstanceId: "drive",
      role: "text_role",
      roleTag: "アルドノアドライブ",
    },
  ];
  const drive = createCardInstance(card("BSAZ02-C10"), {
    instanceId: "drive",
    ownerPlayerId: "alice",
    zone: "field",
    attachedToInstanceId: "host",
  });
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, drive],
    }),
    activePlayerId: "alice",
    step: "attack",
    turnNumber: 3,
  };
}
const rebuild = (state: GameState) =>
  recomputeAndRebuildContinuousEffects(state, getDef);
const find = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)!;

interface RawFace {
  cardNumber: string;
  name: string;
  cost: number;
  tribe?: string;
  effect: string;
  levels?: { level: string; cost: number; bp?: number }[];
  front?: RawFace;
  back?: RawFace;
}
const rawEntries: RawFace[] = runInNewContext(
  readFileSync(
    new URL("../../card-data/raw/by-pack/BSAZ02.js", import.meta.url),
    "utf8"
  ).replace("export default cardData;", "cardData;")
);
const rawFaces = rawEntries.flatMap((c) =>
  c.front && c.back ? [c.front, c.back] : [c]
);
describe("BSAZ02 raw原文34面の照合", () => {
  it("32登録・34面に欠番と重複がない", () => {
    expect(rawEntries).toHaveLength(32);
    expect(rawFaces).toHaveLength(34);
    expect([...definitions.keys()].sort()).toEqual(
      rawFaces.map((c) => c.cardNumber).sort()
    );
  });
  it.each(rawFaces)("$cardNumber: 名称・コスト・系統・Lv/BP・全文", (raw) => {
    const def = card(raw.cardNumber);
    expect(def.name).toBe(raw.name);
    expect(def.cost).toBe(raw.cost);
    expect(def.tribe ?? "").toBe(raw.tribe ?? "");
    expect(def.levelDefs).toEqual(
      (raw.levels ?? []).map((lv) => ({
        level: Number(lv.level.replace("Lv", "")),
        requiredCores: lv.cost,
        bp: lv.bp ?? 0,
      }))
    );
    // 保存rawは旧版を保持する。needs-ruling.jsonlの確定済みユーザー訂正だけを適用する。
    const expectedText =
      raw.cardNumber === "BSAZ02-C11"
        ? raw.effect.replace("〔ターンに1回：同名〕", "〔ゲームに1回：同名〕")
        : raw.cardNumber === "BSAZ02-R01"
          ? raw.effect.replace("本来のコスト以下", "本来のコスト7以下")
          : raw.effect;
    expect(def.textLines.join("\n").trim()).toBe(expectedText.trim());
  });
});

describe("BSAZ02 全文再監査の境界回帰", () => {
  it("C09: 「ヴァース」の配置参照を通常ネクサスからも誘発させる", () => {
    const vers: CardDefinition = {
      ...card("BSAZ02-C08"),
      cardNo: "AUDIT-PLAIN-VERS",
      name: "ヴァースの施設",
      effects: [],
    };
    const lookup = (id: string) => (id === vers.cardNo ? vers : getDef(id));
    const source = createCardInstance(card("BSAZ02-C09"), {
      instanceId: "edel",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const nexus = createCardInstance(vers, {
      instanceId: "vers",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, nexus],
    });
    const after = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: {
        ...before,
        cardInstances: [
          source,
          {
            ...nexus,
            zone: "field",
            zoneRoleName: "nexus",
            normalCoreCount: 1,
          },
        ],
      },
      source: "action_resolution",
      chainId: "place-vers",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        ...definitions.values(),
        vers,
      ]),
    });
    expect(
      after.pendingPrivateDeclarations.some(
        (p) => p.sourceInstanceId === "edel"
      )
    ).toBe(true);
  });
  it.each([true, false])(
    "C18: 所有者と異なるコントローラーの対象（自分=%s）",
    (controlledBySelf) => {
      const source = createCardInstance(card("BSAZ02-C18"), {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "in_use",
      });
      const target = createCardInstance(card("BSAZ02-C01"), {
        instanceId: "target",
        ownerPlayerId: controlledBySelf ? "bob" : "alice",
        controllerPlayerId: controlledBySelf ? "alice" : "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target],
      });
      const after = executeEffect({
        state,
        chainId: "c18-controller",
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        effect: card("BSAZ02-C18").effects![1]!,
        targetInstanceIds: ["target"],
      });
      expect(
        after.players[0]!.reserveNormalCoreCount -
          state.players[0]!.reserveNormalCoreCount
      ).toBe(controlledBySelf ? 4 : 0);
    }
  );
  it("C18: 効果で得たアルドノア系統も結果条件とコスト計数に用いる", () => {
    const variant: CardDefinition = {
      ...card("BSAZ02-C01"),
      cardNo: "AUDIT-NO-TRIBE",
      tribe: "火星・ＣＦ",
      effects: [],
    };
    const lookup = (id: string) =>
      id === variant.cardNo ? variant : getDef(id);
    const source = createCardInstance(card("BSAZ02-C18"), {
      instanceId: "source",
      ownerPlayerId: "alice",
      zone: "in_use",
    });
    const target = createCardInstance(variant, {
      instanceId: "target",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target],
    });
    state = executeEffect({
      state,
      chainId: "grant-tribe",
      sourceInstanceId: "target",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["アルドノア"] },
              duration: { scope: "turn" },
            },
          },
        ],
      },
    });
    const after = executeEffect({
      state,
      chainId: "c18-tribe",
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      effect: card("BSAZ02-C18").effects![1]!,
      targetInstanceIds: ["target"],
    });
    expect(
      after.players[0]!.reserveNormalCoreCount -
        state.players[0]!.reserveNormalCoreCount
    ).toBe(4);
  });
  it.each(["hand", "deck", "trash", "removed_from_game"] as const)(
    "move_self: %sへの離場で下カードとコアを処理し、別チェーンをflushしない",
    (destination) => {
      let state = scene("BSAZ02-C06", 2);
      state = {
        ...state,
        cardInstances: [
          ...state.cardInstances,
          createCardInstance(card("BSAZ02-C05"), {
            instanceId: "other",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      };
      state = queuePendingLeave({
        state,
        instanceId: "other",
        kind: "destroy",
        cause: "effect_resolution",
        chainId: "other-chain",
      });
      const reserve = state.players[0]!.reserveNormalCoreCount;
      const pending = executeEffect({
        state,
        chainId: "move-host",
        sourceInstanceId: "host",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [{ action: { kind: "move_self", destination } }],
        },
      });
      expect(find(pending, "host").zone).toBe("field");
      expect(find(pending, "host").normalCoreCount).toBe(2);
      expect(find(pending, "drive").attachedToInstanceId).toBe("host");
      expect(find(pending, "other").zone).toBe("field");
      const after = flushPendingLeaves(pending, getDef, undefined, undefined, {
        ownerChainId: `effect:move_self:host:${destination}`,
      });
      expect(find(after, "host").zone).toBe(destination);
      expect(find(after, "host").normalCoreCount).toBe(0);
      expect(find(after, "host").underCards).toEqual([]);
      expect(find(after, "drive").zone).toBe(destination);
      expect(find(after, "drive").attachedToInstanceId).toBeNull();
      expect(after.players[0]!.reserveNormalCoreCount).toBe(reserve + 2);
      expect(find(after, "other").zone).toBe("field");
      expect(after.pendingLeaveEntities.map((p) => p.instanceId)).toEqual([
        "other",
      ]);
    }
  );
  it.each(["alice", "bob"])(
    "C04: %sの非合体アルティメットの破壊効果も受けない",
    (player) => {
      let state = scene("BSAZ02-C04");
      const source = createCardInstance(card("BSAZ02-C01"), {
        instanceId: "source",
        ownerPlayerId: player,
        zone: "field",
        normalCoreCount: 1,
      });
      state = rebuild({
        ...state,
        cardInstances: [...state.cardInstances, source],
      });
      state = executeEffect({
        state,
        chainId: "skandia-immunity",
        sourceInstanceId: source.instanceId,
        actingPlayerId: player,
        getCardDefinitionById: getDef,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: player === "alice" ? "self" : "opponent",
                  filter: { category: ["ultimate"] },
                  count: 1,
                },
              },
            },
          ],
        },
        targetInstanceIds: ["host"],
      });
      state = flushPendingLeaves(state, getDef);
      expect(find(state, "host").zone).toBe("field");
    }
  );

  it("TR01(A): 自分のアタックステップの通常バトル破壊も防ぐ", () => {
    let state = scene("BSAZ02-TR01(A)");
    const blocker = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "blocker",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4,
    });
    state = rebuild({
      ...state,
      cardInstances: [...state.cardInstances, blocker],
      activeAttack: {
        attackId: "heras-battle",
        primaryEntityId: "attacker",
        participantEntityIds: ["attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          { participantEntityId: "attacker", blockedByEntityIds: ["blocker"] },
        ],
        symbolResolutionOrder: ["attacker"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "attacker",
          memberInstanceIds: ["host"],
          attackState: "attacking",
          resolvedBp: 10000,
          resolvedSymbols: ["ultimate_symbol"],
        },
        {
          entityId: "blocker",
          memberInstanceIds: ["blocker"],
          attackState: "blocking",
          resolvedBp: 18000,
          resolvedSymbols: ["ultimate_symbol"],
        },
      ],
    });
    state = executeBattleResolution({
      state,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    }).state;
    expect(find(state, "host").zone).toBe("field");
    expect(find(state, "host").pendingLeaveKind).toBeNull();
  });

  it("M02: ヴァース以外の導界者では破壊コストも召喚も実行しない", () => {
    const other: CardDefinition = {
      ...card("BSAZ02-X04"),
      cardNo: "AUDIT-GUIDED",
      name: "別の導界者",
      effects: [],
    };
    const lookup = (id: string) => (id === other.cardNo ? other : getDef(id));
    const source = createCardInstance(card("BSAZ02-M02"), {
      instanceId: "magic",
      ownerPlayerId: "alice",
      zone: "in_use",
    });
    const nexus = createCardInstance(other, {
      instanceId: "nexus",
      ownerPlayerId: "alice",
      zone: "field",
    });
    const ultimate = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "ultimate",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, nexus, ultimate],
    });
    const after = executeEffect({
      state,
      chainId: "m02-name",
      effect: card("BSAZ02-M02").effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "magic",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
    });
    expect(find(after, "nexus").zone).toBe("field");
    expect(find(after, "nexus").pendingLeaveKind).toBeNull();
    expect(find(after, "ultimate").zone).toBe("hand");
    expect(after.pendingMultiPlacement).toBeNull();
  });

  it("R01: 非攻撃中には使用制限を登録せず、本人の攻撃中だけ手札を制限する", () => {
    let state = scene("BSAZ02-R01");
    const hand = createCardInstance(card("BSAZ02-C05"), {
      instanceId: "hand",
      ownerPlayerId: "bob",
      zone: "hand",
    });
    const trash = createCardInstance(card("BSAZ02-C05"), {
      instanceId: "trash",
      ownerPlayerId: "bob",
      zone: "trash",
    });
    state = rebuild({
      ...state,
      cardInstances: [...state.cardInstances, hand, trash],
    });
    const restricted = (s: GameState, id: string) =>
      isCardUseRestricted(s, "bob", find(s, id), card("BSAZ02-C05"), getDef);
    expect(restricted(state, "hand")).toBe(false);
    const attacking: GameState = {
      ...state,
      battleEntities: [
        {
          entityId: "attack",
          memberInstanceIds: ["host"],
          attackState: "attacking",
          resolvedBp: 15000,
          resolvedSymbols: ["ultimate_symbol"],
        },
      ],
    };
    state = rebuild(attacking);
    expect(restricted(state, "hand")).toBe(true);
    expect(restricted(state, "trash")).toBe(false);
    state = rebuild({ ...state, battleEntities: [] });
    expect(restricted(state, "hand")).toBe(false);
  });

  it("X02: 最初のバトル前・終了処理中だけ継続し、Lv不足と離場で失効する", () => {
    const active = (s: GameState) =>
      s.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_stack"
      );
    let state = rebuild(scene("BSAZ02-X02", 4));
    expect(active(state)).toBe(true);
    state = rebuild({
      ...state,
      battlesEndedThisTurn: 1,
      pendingBattleEndFinalizeAttackIds: ["first"],
    });
    expect(active(state)).toBe(true);
    expect(
      active(rebuild({ ...state, pendingBattleEndFinalizeAttackIds: [] }))
    ).toBe(false);
    expect(active(rebuild({ ...scene("BSAZ02-X02", 3) }))).toBe(false);
    expect(
      active(rebuild({ ...scene("BSAZ02-X02", 4), cardInstances: [] }))
    ).toBe(false);
  });
});
