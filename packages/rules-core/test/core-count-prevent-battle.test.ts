/**
 * コア数連動の継続的戦闘制限（「コアN個以下の相手スピリットはアタック/ブロックできない」）検証。
 *
 * - card-data: BSTH002-転醒R01(A) effect[3] / BSSA01-転醒X01(A) effect[7] が
 *   continuous prevent_battle + target.count "all" + filter.maxCores:1 で表現されること。
 * - engine: 動的フィルタ CE（targetInstanceId 未設定・targetFilter.maxCores）として登録され、
 *   battle-availability が評価時点のコア数で判定すること（コアが増えると制限が外れる）。
 *
 * これは「per-target snapshot では、後からコアが増減した相手を追従できない」ギャップの
 * 解消（engine-drain）。動的 filter CE 化により実消費時にコア数でマッチする。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
} from "../src";
import { getAttackDeclarationBlockReason } from "../src/battle/battle-availability";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

// アタッカーに使う素のスピリット（効果なし）。card-data が充実するほど「元から
// effects 未実装のカード」が枯渇しうるため、任意のスピリットから effects を上書き
// した合成カードを cardNo を差し替えて cardNoMap に登録する（実在カードの effects
// 内容に依存しない）。getCardDefinitionById は definitionId(=cardNo) 経由で
// cardNoMap を引くため、この登録をしないと上書きした effects:[] が反映されない。
const attacker: CardDefinition = {
  ...ALL_CARDS.find((c) => c.printedCategory === "spirit")!,
  cardNo: "TEST-VANILLA-SPIRIT",
  effects: [],
};
cardNoMap.set(attacker.cardNo, attacker);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

// alice.countValue は転醒トリガー（カウント N 以下）の自動 flip を抑止するため高めに置く。
// （BSTH002-転醒R01 の rebirth maxCount:3 / BSSA01-転醒X01 の maxCount:5 がカウント低時に
//   rebuild 中の auto-flip を起こし、前面の継続効果が消えてしまうのを防ぐ。）
function buildFieldState(
  cardInstances: GameState["cardInstances"],
  aliceCountValue = 8
): GameState {
  const empty = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...empty,
    activePlayerId: "alice",
    step: "main",
    players: empty.players.map((p) =>
      p.id === "alice" ? { ...p, countValue: aliceCountValue } : p
    ),
    cardInstances,
  };
}

function attackReasonForBob(
  rebuilt: GameState,
  spiritCores: number
): ReturnType<typeof getAttackDeclarationBlockReason> {
  const atkState: GameState = {
    ...rebuilt,
    activePlayerId: "bob",
    step: "attack",
    window: "none",
    cardInstances: rebuilt.cardInstances.map((c) =>
      c.instanceId === "sp" ? { ...c, normalCoreCount: spiritCores } : c
    ),
  };
  return getAttackDeclarationBlockReason({
    state: atkState,
    actingPlayerId: "bob",
    sourceInstanceId: "sp",
    getCardDefinitionById,
  });
}

describe("コア数連動 prevent_battle: BSTH002-転醒R01(A)『お互いのアタックステップ』", () => {
  const nexus = cardNoMap.get("BSTH002-転醒R01(A)")!;

  it("card-data: effect[3] は continuous prevent_battle(attack+block) / maxCores:1 / count all", () => {
    const eff = nexus.effects![3]!;
    expect(eff.timing).toEqual({ kind: "continuous" });
    expect(eff.timingScope).toEqual({ player: "both", period: "attack" });
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("prevent_battle");
    if (action.kind === "prevent_battle") {
      expect(action.restriction).toEqual(["attack", "block"]);
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        count: "all",
        filter: { maxCores: 1 },
      });
    }
  });

  it("Lv2 で動的フィルタ CE（targetFilter.maxCores:1）が単一登録される", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      buildFieldState([
        createCardInstance(nexus, {
          instanceId: "nx",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1, // requiredCores Lv2 = 1
        }),
      ]),
      getCardDefinitionById
    );
    const pb = rebuilt.activeContinuousEffects.filter(
      (ce) => !ce.targetInstanceId && ce.modifierTag === "prevent_battle_both"
    );
    expect(pb).toHaveLength(1);
    expect(pb[0]!.targetFilter).toMatchObject({
      player: "opponent",
      maxCores: 1,
    });
  });

  it("コア1個の相手はアタック不可、コア2個になるとアタック可（動的評価）", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      buildFieldState([
        createCardInstance(nexus, {
          instanceId: "nx",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(attacker, {
          instanceId: "sp",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ]),
      getCardDefinitionById
    );
    expect(attackReasonForBob(rebuilt, 1)).toBe("source_not_ready");
    expect(attackReasonForBob(rebuilt, 2)).toBeNull();
  });
});

describe("コア数連動 prevent_battle: BSSA01-転醒X01(A)『相手のアタックステップ』", () => {
  const nexus = cardNoMap.get("BSSA01-転醒X01(A)")!;

  it("card-data: effect[textRef=7] は continuous prevent_battle(attack) / spirit / maxCores:1", () => {
    const eff = nexus.effects!.find(
      (e) => e.steps[0]?.action.kind === "prevent_battle"
    )!;
    expect(eff.timing).toEqual({ kind: "continuous" });
    expect(eff.timingScope).toEqual({ player: "opponent", period: "attack" });
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("prevent_battle");
    if (action.kind === "prevent_battle") {
      expect(action.restriction).toEqual(["attack"]);
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        count: "all",
        filter: { category: ["spirit"], maxCores: 1 },
      });
    }
  });

  it("コア1個の相手スピリットはアタック不可、コア2個で可（動的評価）", () => {
    const rebuilt = rebuildContinuousEffectsFromField(
      buildFieldState([
        createCardInstance(nexus, {
          instanceId: "nx",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(attacker, {
          instanceId: "sp",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ]),
      getCardDefinitionById
    );
    const pb = rebuilt.activeContinuousEffects.filter(
      (ce) => !ce.targetInstanceId && ce.modifierTag === "prevent_battle_attack"
    );
    expect(pb).toHaveLength(1);
    expect(attackReasonForBob(rebuilt, 1)).toBe("source_not_ready");
    expect(attackReasonForBob(rebuilt, 2)).toBeNull();
  });
});
