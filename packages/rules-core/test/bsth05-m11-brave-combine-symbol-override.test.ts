/**
 * BSTH05-M11「諏訪の装」左右合体条件 + シンボル上書き stub 解消検証。
 *
 * 原文:
 * 【左右合体条件：風神＆コスト5以上】【スピリット左/右合体中】『このスピリットのアタック時』
 * このスピリットのシンボルを緑のシンボル2つにする。
 *
 * 実装: BraveCondition (tribes:["風神"], minCost:5, alternatives:[系統「アシハラ」＆「創界神」
 * を両方持つネクサス]) + effects[1] condition combined_host_category:["spirit","ultimate"] +
 * action override_properties(symbols:["green","green"], symbolCountFixed:true)。
 * BSTH003-M02 (ENGINE-brave-combine-nexus-host alternatives) と同型パターン。
 *
 * 意味差分:
 * - 風神系統・コスト5以上のホストにのみ合体可能（コスト不足/系統不一致は合体先候補から除外）
 * - 合体中: アタック時にホストのシンボルが緑2つに固定される（既存シンボルへの加算ではなく上書き）
 * - 合体先がネクサス（対象カテゴリ外）のときはこの効果が発揮せずシンボル不変
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getEffectiveSymbols,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  getAvailableBraveCombineLegalActions,
  getValidBraveCombineHosts,
} from "../src/legal/legal-actions-availability";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";
import type { CardDefinition, GameState } from "../src";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const M11 = cardNoMap.get("BSTH05-M11")!;

// 風神系統・コスト5・既存シンボル赤2つ（上書き検証用: 加算なら赤+緑が残るはず）。
const eligibleSpiritHost: CardDefinition = {
  cardNo: "TEST-FUUJIN-HOST-OK",
  name: "テスト風神スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red", "red"],
  textLines: [],
  keywordTags: [],
  tribe: "風神",
  sourceUrls: [],
  sourceConfidence: "C",
};

const lowCostSpiritHost: CardDefinition = {
  ...eligibleSpiritHost,
  cardNo: "TEST-FUUJIN-HOST-LOWCOST",
  cost: 4,
};

const wrongTribeSpiritHost: CardDefinition = {
  ...eligibleSpiritHost,
  cardNo: "TEST-FUUJIN-HOST-WRONGTRIBE",
  tribe: "幻想",
};

const eligibleNexusHost: CardDefinition = {
  cardNo: "TEST-ASHIHARA-NEXUS-OK",
  name: "テストアシハラ創界神ネクサス",
  printedCategory: "nexus",
  colors: ["green"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "創界神・アシハラ",
  sourceUrls: [],
  sourceConfidence: "C",
};

const ashiharaOnlyNexusHost: CardDefinition = {
  ...eligibleNexusHost,
  cardNo: "TEST-ASHIHARA-ONLY-NEXUS",
  tribe: "アシハラ",
};

const testDefs = [
  eligibleSpiritHost,
  lowCostSpiritHost,
  wrongTribeSpiritHost,
  eligibleNexusHost,
  ashiharaOnlyNexusHost,
];
const mergedDefMap = new Map<string, CardDefinition>([
  ...cardNoMap,
  ...testDefs.map((d): [string, CardDefinition] => [d.cardNo, d]),
]);
const getCardDefinitionById = (id: string) => mergedDefMap.get(id);

function buildStateWithBraveAttachedTo(hostDef: CardDefinition): {
  state: GameState;
  brave: string;
  host: string;
} {
  const host = createCardInstance(hostDef, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: hostDef.printedCategory === "nexus" ? "nexus" : "spirit",
  });
  const brave = createCardInstance(M11, {
    instanceId: "brave-1",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "brave",
    attachedToInstanceId: host.instanceId,
  });
  const hostWithChild = { ...host, attachedChildrenIds: [brave.instanceId] };
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [hostWithChild, brave],
    }),
    activePlayerId: ALICE,
    step: "main",
  };
  return { state, brave: brave.instanceId, host: host.instanceId };
}

function effectByTextRef(def: CardDefinition, ref: number[]): Effect {
  const match = (def.effects ?? []).find(
    (e) =>
      e.textRef &&
      e.textRef.length === ref.length &&
      e.textRef.every((v, i) => v === ref[i])
  );
  if (!match)
    throw new Error(`no effect with textRef [${ref}] in ${def.cardNo}`);
  return match;
}

describe("BSTH05-M11 braveCondition: 風神&コスト5以上 or アシハラ&創界神ネクサス", () => {
  it("風神系統・コスト5以上のスピリットは合体候補に含まれる", () => {
    const brave = createCardInstance(M11, {
      instanceId: "m11-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const host = createCardInstance(eligibleSpiritHost, {
      instanceId: "host-elig",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, host],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions.some((a) => a.targetInstanceId === host.instanceId)).toBe(
      true
    );
  });

  it("コスト4(コスト不足)の風神スピリットは合体候補から除外される", () => {
    const brave = createCardInstance(M11, {
      instanceId: "m11-2",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const host = createCardInstance(lowCostSpiritHost, {
      instanceId: "host-lowcost",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, host],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const hosts = getValidBraveCombineHosts(
      state,
      M11,
      ALICE,
      getCardDefinitionById,
      brave.instanceId
    );
    expect(hosts.some((h) => h.instanceId === host.instanceId)).toBe(false);
  });

  it("系統不一致(幻想)のスピリットは合体候補から除外される", () => {
    const brave = createCardInstance(M11, {
      instanceId: "m11-3",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const host = createCardInstance(wrongTribeSpiritHost, {
      instanceId: "host-wrongtribe",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, host],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const hosts = getValidBraveCombineHosts(
      state,
      M11,
      ALICE,
      getCardDefinitionById,
      brave.instanceId
    );
    expect(hosts.some((h) => h.instanceId === host.instanceId)).toBe(false);
  });

  it("系統「アシハラ」と「創界神」を両方持つネクサスは合体候補に含まれる (alternatives AND)", () => {
    const brave = createCardInstance(M11, {
      instanceId: "m11-4",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const nexus = createCardInstance(eligibleNexusHost, {
      instanceId: "nexus-elig",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const hosts = getValidBraveCombineHosts(
      state,
      M11,
      ALICE,
      getCardDefinitionById,
      brave.instanceId
    );
    expect(hosts.some((h) => h.instanceId === nexus.instanceId)).toBe(true);
  });

  it("「アシハラ」のみ(「創界神」を持たない)ネクサスは合体候補から除外される (AND判定)", () => {
    const brave = createCardInstance(M11, {
      instanceId: "m11-5",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const nexus = createCardInstance(ashiharaOnlyNexusHost, {
      instanceId: "nexus-partial",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, nexus],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const hosts = getValidBraveCombineHosts(
      state,
      M11,
      ALICE,
      getCardDefinitionById,
      brave.instanceId
    );
    expect(hosts.some((h) => h.instanceId === nexus.instanceId)).toBe(false);
  });
});

describe("BSTH05-M11 effects[1] (textRef[2,3,4]): アタック時シンボル緑2つに固定", () => {
  const effect = effectByTextRef(M11, [2, 3, 4]);

  it("stub が消えている", () => {
    expect(effect.stub).toBeUndefined();
  });

  it("風神スピリットと合体中: アタック時にホストのシンボルが緑2つに上書きされる(既存赤2つは消える)", () => {
    const { state, brave, host } =
      buildStateWithBraveAttachedTo(eligibleSpiritHost);
    const before = getEffectiveSymbols(
      state,
      state.cardInstances.find((c) => c.instanceId === host)!,
      eligibleSpiritHost,
      getCardDefinitionById
    );
    expect(before).toEqual(["red", "red"]);

    const after = executeEffect({
      chainId: "test:bsth05-m11-brave-combine-symbol-override:328",
      state,
      effect,
      sourceInstanceId: brave,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const hostAfter = after.cardInstances.find((c) => c.instanceId === host)!;
    const symbolsAfter = getEffectiveSymbols(
      after,
      hostAfter,
      eligibleSpiritHost,
      getCardDefinitionById
    );
    expect(symbolsAfter).toEqual(["green", "green"]);
  });

  it("アシハラ&創界神ネクサスと合体中(スピリット/アルティメット以外): この効果は発揮せずシンボル不変", () => {
    const { state, brave, host } =
      buildStateWithBraveAttachedTo(eligibleNexusHost);
    const after = executeEffect({
      chainId: "test:bsth05-m11-brave-combine-symbol-override:348",
      state,
      effect,
      sourceInstanceId: brave,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const hostAfter = after.cardInstances.find((c) => c.instanceId === host)!;
    const symbolsAfter = getEffectiveSymbols(
      after,
      hostAfter,
      eligibleNexusHost,
      getCardDefinitionById
    );
    expect(symbolsAfter).toEqual([]);
  });

  // adversarial verifier round1 refute: 見出し「アタック時」のみ・本文に明示的な期間指定が無い
  // override_properties 系性質付与は duration.scope を "turn" ではなく "battle"/"attack" にする
  // (10_rules/03e_effect-duration-and-repeat-scope.md §『このスピリットのアタック時』見出し)。
  // scope:"turn" のままだと同一ターン内の2戦目以降にも上書きが不当残存するバグになる。
  it("シンボル上書きは scope:'battle' で登録され、バトル終了時に失効する(次バトルへ不当残存しない)", () => {
    const {
      state: baseState,
      brave,
      host,
    } = buildStateWithBraveAttachedTo(eligibleSpiritHost);
    const attackId = "test-attack-1";
    const state: GameState = {
      ...baseState,
      activeAttack: {
        attackId,
        primaryEntityId: "e1",
        participantEntityIds: ["e1"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
    };
    const after = executeEffect({
      chainId: "test:bsth05-m11-brave-combine-symbol-override:391",
      state,
      effect,
      sourceInstanceId: brave,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const registered = after.activeContinuousEffects.find(
      (ce) => ce.targetInstanceId === host
    )!;
    expect(registered).toBeDefined();
    expect(registered.duration.scope).toBe("battle");
    expect(registered.createdAtAttackId).toBe(attackId);

    const remaining = removeExpiredContinuousEffects(after, {
      kind: "battle_end",
      attackId,
    });
    expect(remaining.some((ce) => ce.targetInstanceId === host)).toBe(false);

    const stateAfterBattleEnd: GameState = {
      ...after,
      activeContinuousEffects: remaining,
    };
    const hostAfter = stateAfterBattleEnd.cardInstances.find(
      (c) => c.instanceId === host
    )!;
    expect(
      getEffectiveSymbols(
        stateAfterBattleEnd,
        hostAfter,
        eligibleSpiritHost,
        getCardDefinitionById
      )
    ).toEqual(["red", "red"]);
  });
});
