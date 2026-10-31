/**
 * BSTH05-M11「諏訪の装」effects[2] (textRef[6,7,8]) stub 解消検証。
 *
 * 原文 (textLines[6,7,8]):
 *   【左右合体条件：アシハラ＆創界神ネクサス】
 *   【ネクサス左/右合体中】【神域】『自分のメインステップ』
 *   系統：「風神」を持つスピリットが召喚されたとき、ボイドからコア2個を自分のリザーブに置く。
 *   この効果はターンに1回しか使えない。
 *
 * 実装: game_event(event:"summon", player:"either", triggerFilter:{category:["spirit"],
 * tribes:["風神"]}, sourceWhose:"either") + condition combined_host_category:["nexus"]
 * (effects[1] の combined_host_category:["spirit","ultimate"] と対の判定)。
 * 「系統：「風神」を持つスピリットが召喚されたとき」に人称(自分の/相手の)が無いため
 * player:"either" (project_player_target_vs_card_target)。BSAZ02-M03 effects[0]
 * (game_event:place player:"either"+sourceWhose:"either" の第三者観測) と同型。
 *
 * 意味差分:
 * - このブレイヴがネクサス(アシハラ＆創界神)と合体中のときのみ誘発する
 *   （スピリット/アルティメット合体中 = effects[1] 側は誘発しない）
 * - 系統「風神」を持つスピリットの召喚のみ誘発する（他系統/非スピリットは誘発しない）
 * - 自分・相手いずれの風神スピリット召喚でも誘発する（人称無し）
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const M11 = card("BSTH05-M11");

const ALICE = "alice";
const BOB = "bob";

const effect = M11.effects!.find(
  (e) =>
    e.textRef?.length === 3 && e.textRef.every((v, i) => v === [6, 7, 8][i])
)!;

function fuujinSpiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テスト風神スピリット ${cardNo}`,
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "風神",
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function otherTribeSpiritDef(cardNo: string): CardDefinition {
  return { ...fuujinSpiritDef(cardNo), tribe: "幻想" };
}

function ashiharaNexusDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テストアシハラ創界神ネクサス ${cardNo}`,
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
  } as CardDefinition;
}

function fuujinSpiritHostDef(cardNo: string): CardDefinition {
  return {
    ...fuujinSpiritDef(cardNo),
    cost: 5,
  };
}

const FUUJIN1 = fuujinSpiritDef("TEST-FUUJIN-SUMMON-1");
const OTHER1 = otherTribeSpiritDef("TEST-OTHERTRIBE-SUMMON-1");
const NEXUS1 = ashiharaNexusDef("TEST-ASHIHARA-NEXUS-DOMAIN-1");
const SPIRIT_HOST1 = fuujinSpiritHostDef("TEST-FUUJIN-HOST-DOMAIN-1");

const testDefRegistry = new Map<string, CardDefinition>(
  [FUUJIN1, OTHER1, NEXUS1, SPIRIT_HOST1].map((d): [string, CardDefinition] => [
    d.cardNo,
    d,
  ])
);
const getDef = (id: string): CardDefinition | undefined =>
  testDefRegistry.get(id) ?? cardNoMap.get(id);

describe("BSTH05-M11 effects[2] (textRef[6,7,8]): ネクサス合体中に風神スピリット召喚でボイド→リザーブへコア2個", () => {
  it("stub が消えている", () => {
    expect(effect.stub).toBeUndefined();
  });

  it("effect 定義: game_event(summon, player:either, triggerFilter:風神スピリット, sourceWhose:either) + combined_host_category:nexus + timingScope(自分のメインステップ)", () => {
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "either",
      event: "summon",
      triggerFilter: { category: ["spirit"], tribes: ["風神"] },
      sourceWhose: "either",
    });
    expect(effect.timingScope).toEqual({ player: "self", period: "main" });
    expect(effect.condition).toEqual([
      { kind: "combined_host_category", categories: ["nexus"] },
    ]);
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
  });

  // 見出し『自分のメインステップ』= timingScope:{player:"self",period:"main"}。
  // 既定は M11 コントローラ(ALICE)のメインステップ中(activePlayerId:ALICE, step:"main")。
  function buildBraveOnNexus(
    turnState: { step: GameState["step"]; activePlayerId: string } = {
      step: "main",
      activePlayerId: ALICE,
    }
  ): {
    state: GameState;
    brave: string;
    nexus: string;
  } {
    const nexus = createCardInstance(NEXUS1, {
      instanceId: "domain-nexus-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "nexus",
    });
    const brave = createCardInstance(M11, {
      instanceId: "domain-brave-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: nexus.instanceId,
    });
    const nexusWithChild = {
      ...nexus,
      attachedChildrenIds: [brave.instanceId],
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nexusWithChild, brave],
        startingVoidNormalCoreCount: 10,
      }),
      step: turnState.step,
      activePlayerId: turnState.activePlayerId,
    };
    return { state, brave: brave.instanceId, nexus: nexus.instanceId };
  }

  function summonDelta(
    state: GameState,
    spiritDef: CardDefinition,
    owner: string
  ): { before: GameState; after: GameState; summoned: string } {
    const summoned = createCardInstance(spiritDef, {
      instanceId: `summoned-${spiritDef.cardNo}-${owner}`,
      ownerPlayerId: owner,
      zone: "hand",
    });
    const before: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, summoned],
    };
    const after: GameState = {
      ...before,
      cardInstances: before.cardInstances.map((c) =>
        c.instanceId === summoned.instanceId
          ? { ...c, zone: "field" as const, zoneRoleName: "spirit" as const }
          : c
      ),
    };
    return { before, after, summoned: summoned.instanceId };
  }

  it("自分の風神スピリット召喚で誘発候補に含まれる（ネクサス合体中）", () => {
    const { state, brave } = buildBraveOnNexus();
    const { before, after, summoned } = summonDelta(state, FUUJIN1, ALICE);
    const lookup = buildTriggeredEffectLookup([M11, NEXUS1, FUUJIN1]);
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "m11-self-summon-chain",
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === summoned
    );
    expect(pending).toBeDefined();
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === brave)
    ).toBeDefined();
  });

  it("相手の風神スピリット召喚でも誘発候補に含まれる（人称無し = player:either）", () => {
    const { state, brave } = buildBraveOnNexus();
    const { before, after, summoned } = summonDelta(state, FUUJIN1, BOB);
    const lookup = buildTriggeredEffectLookup([M11, NEXUS1, FUUJIN1]);
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "m11-opponent-summon-chain",
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === summoned
    );
    expect(pending).toBeDefined();
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === brave)
    ).toBeDefined();
  });

  it("風神以外の系統のスピリット召喚では誘発しない", () => {
    const { state, brave } = buildBraveOnNexus();
    const { before, after, summoned } = summonDelta(state, OTHER1, ALICE);
    const lookup = buildTriggeredEffectLookup([M11, NEXUS1, OTHER1]);
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "m11-wrong-tribe-chain",
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === summoned
    );
    if (pending) {
      const choices = getAvailableTriggeredEffectSourceChoices({
        state: queued,
        pendingEffect: pending,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
      });
      expect(
        choices.find((c) => c.sourceCard.instanceId === brave)
      ).toBeUndefined();
    }
    // pending 自体が無い (トリガー登録が無い) 場合も許容: いずれにせよ brave は候補に出ない。
    expect(true).toBe(true);
  });

  it("自分(M11コントローラ)のメインステップ以外(例: アタックステップ)では誘発しない (timingScope)", () => {
    const { state, brave } = buildBraveOnNexus({
      step: "attack",
      activePlayerId: ALICE,
    });
    const { before, after, summoned } = summonDelta(state, FUUJIN1, ALICE);
    const lookup = buildTriggeredEffectLookup([M11, NEXUS1, FUUJIN1]);
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "m11-wrong-step-chain",
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === summoned
    );
    if (pending) {
      const choices = getAvailableTriggeredEffectSourceChoices({
        state: queued,
        pendingEffect: pending,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
      });
      expect(
        choices.find((c) => c.sourceCard.instanceId === brave)
      ).toBeUndefined();
    }
    expect(true).toBe(true);
  });

  it("相手(BOB)のメインステップ中(=自分のメインステップではない)では誘発しない (timingScope player:self)", () => {
    const { state, brave } = buildBraveOnNexus({
      step: "main",
      activePlayerId: BOB,
    });
    const { before, after, summoned } = summonDelta(state, FUUJIN1, ALICE);
    const lookup = buildTriggeredEffectLookup([M11, NEXUS1, FUUJIN1]);
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "m11-opponent-turn-chain",
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === summoned
    );
    if (pending) {
      const choices = getAvailableTriggeredEffectSourceChoices({
        state: queued,
        pendingEffect: pending,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
      });
      expect(
        choices.find((c) => c.sourceCard.instanceId === brave)
      ).toBeUndefined();
    }
    expect(true).toBe(true);
  });

  it("スピリット/アルティメット合体中(effects[1]側)は誘発しない (combined_host_category:nexus 不一致)", () => {
    const host = createCardInstance(SPIRIT_HOST1, {
      instanceId: "domain-spirit-host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
    });
    const brave = createCardInstance(M11, {
      instanceId: "domain-brave-spirithost-1",
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
        startingVoidNormalCoreCount: 10,
      }),
      step: "main",
      activePlayerId: ALICE,
    };
    const { before, after, summoned } = summonDelta(state, FUUJIN1, ALICE);
    const lookup = buildTriggeredEffectLookup([M11, SPIRIT_HOST1, FUUJIN1]);
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "m11-spirit-host-chain",
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === summoned
    );
    if (pending) {
      const choices = getAvailableTriggeredEffectSourceChoices({
        state: queued,
        pendingEffect: pending,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
      });
      expect(
        choices.find((c) => c.sourceCard.instanceId === brave.instanceId)
      ).toBeUndefined();
    }
    expect(true).toBe(true);
  });

  it("実行: ボイドからコア2個を自分のリザーブに置く（盤面変化）", () => {
    const { state, brave } = buildBraveOnNexus();
    const alice = state.players.find((p) => p.id === ALICE)!;
    expect(alice.voidNormalCoreCount).toBe(10);
    const reserveBefore = alice.reserveNormalCoreCount;

    const after = executeEffect({
      chainId: "test:bsth05-m11-domain-void-core-recovery:419",
      state,
      effect,
      sourceInstanceId: brave,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const aliceAfter = after.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.voidNormalCoreCount).toBe(8);
    expect(aliceAfter.reserveNormalCoreCount).toBe(reserveBefore + 2);
  });
});
