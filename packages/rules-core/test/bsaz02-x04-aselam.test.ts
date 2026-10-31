import { recordSemanticTriggerEvent } from "../src/effect/semantic-trigger-events";
/**
 * BSAZ02-X04「[導界者]アセイラム・ヴァース・アリューシア」effects 検証。
 *
 * 原文 (textLines[0,2,3,4,6,8,9,10,11]):
 *   このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない…（略）。
 *   【導託：〔火星／地球＆コスト3以上〕〔火星＆アルティメット〕〔火星／地球＆ブレイヴ〕】
 *   ◆対象の自分のスピリット/アルティメット/ブレイヴを召喚/煌臨したとき、ボイドからコア1個を置ける。
 *   ◆このネクサスを配置したとき、同名不在ならデッキ上3枚をトラッシュに置き、対象1枚につきコア+1を置く。
 *   Lv1-Lv2 このネクサスのシンボルは白/究極としても扱い、導託でトラッシュに置かれた
 *   「アルドノアドライブ」すべてを手札に加える。
 *   【導域】Lv1-Lv2 下の裏向きを「アルドノアドライブ」として扱う。自分が【アルドノアドライブ】を
 *   持つカードを召喚/配置したとき、ただちにトラッシュにある「アルドノアドライブ」を裏向きで下に置く。
 *   【導技：2】Lv2 フラッシュ『お互いのアタックステップ』〔ターンに1回：同名〕コア2個をボイドに
 *   置く→トラッシュのコア1個をライフに置く。
 *
 * 検証点:
 *  - textLines[0,2,3,4] (本体ルール・導託) は grandwalkerData のみで自動処理される (専用 effects 不要)。
 *  - effects[0]: 白/究極シンボル treat_as (getEffectiveSymbols で検証)。
 *  - effects[1]: engine-under-card-trash-fetch-by-name (place_text_role_under_card
 *    moveFrom:"trash_by_card_name") — トラッシュの「アルドノアドライブ」を裏向きで host の下に。
 *    トラッシュに該当カードが無ければ no-op。
 *  - grandwalkerData.placementOracleReturnToHand: 配置時神託でトラッシュに置かれた
 *    「アルドノアドライブ」だけが手札に戻る (他のカードはトラッシュに残る)。
 *  - grandwalkerData.divineSkills[0] (導技:2): coreCost/timing/minLevel/maxLevel/turnLimit の宣言、
 *    及び本体効果 (core_move trash→life) の実行結果。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState, LegalAction } from "../src";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createEmptyGameState,
  createCardInstance,
  getLegalActions,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { runActionMainResolution } from "../src/effect/effect-resolution";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { getEffectiveSymbolBundles } from "../src/battle/battle-shared";
import {
  checkAndQueueOracleChoices,
  checkAndQueuePlacementOracle,
  resolveOracleMechanic,
  resolvePlacementOracleMechanic,
} from "../src/mechanics/oracle-system";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string) => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const X04 = card("BSAZ02-X04");
const X05 = card("BSAZ02-X05");
const ALDNOAH_DRIVE = card("BSAZ02-C10");

const FILLER_DEF: CardDefinition = {
  cardNo: "TEST-X04-FILLER",
  name: "フィラーユニット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "紅魔",
  sourceUrls: [],
  sourceConfidence: "C",
};
cardNoMap.set(FILLER_DEF.cardNo, FILLER_DEF);

const MARS_SPIRIT_DEF: CardDefinition = {
  cardNo: "TEST-X04-MARS-SPIRIT",
  name: "火星の検証用スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "火星",
  sourceUrls: [],
  sourceConfidence: "C",
};
cardNoMap.set(MARS_SPIRIT_DEF.cardNo, MARS_SPIRIT_DEF);

const MARS_BRAVE_DEF: CardDefinition = {
  cardNo: "TEST-X04-MARS-BRAVE",
  name: "火星の検証用ブレイヴ",
  printedCategory: "brave",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "火星",
  sourceUrls: [],
  sourceConfidence: "C",
};
cardNoMap.set(MARS_BRAVE_DEF.cardNo, MARS_BRAVE_DEF);

const MARS_ADVENT_DEF: CardDefinition = {
  cardNo: "TEST-X04-MARS-ADVENT",
  name: "火星の検証用煌臨スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 6,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 5000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: ["advent"],
  adventData: {
    adventCondition: {
      colors: ["red"],
      minCost: 3,
      targetCategory: ["spirit"],
    },
    adventTiming: "main_and_flash",
    soulCoreDest: "trash",
  },
  tribe: "火星",
  sourceUrls: [],
  sourceConfidence: "C",
};
cardNoMap.set(MARS_ADVENT_DEF.cardNo, MARS_ADVENT_DEF);

const TEST_CARD_DEFINITIONS = [...cardNoMap.values()];
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
    TEST_CARD_DEFINITIONS
  ),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(
    TEST_CARD_DEFINITIONS
  ),
  getRegisteredBattleImmediateEffectActions: buildBattleImmediateEffectLookup(
    TEST_CARD_DEFINITIONS
  ),
};
const noBurstEffects = () => undefined;

function applyAction(
  state: GameState,
  action: LegalAction,
  targetInstanceIds?: string[]
): GameState {
  return applyLegalAction({
    state,
    action,
    ...(targetInstanceIds ? { targetInstanceIds } : {}),
    getCardDefinitionById: getDef,
    getRegisteredBurstActions: noBurstEffects,
    ...effectLookups,
  } as Parameters<typeof applyLegalAction>[0]).state;
}

function getActions(state: GameState, actingPlayerId: string): LegalAction[] {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredBurstActions: noBurstEffects,
    ...effectLookups,
  } as Parameters<typeof getLegalActions>[0]);
}

function runEffect(
  state: GameState,
  effectIndex: number,
  opts: { sourceInstanceId?: string; triggerRelatedInstanceId?: string } = {}
): GameState {
  return executeEffect({
    chainId: "test:bsaz02-x04-aselam:187",
    state,
    effect: X04.effects![effectIndex]!,
    effectIndex,
    sourceInstanceId: opts.sourceInstanceId ?? "src-x04",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    triggerRelatedInstanceId: opts.triggerRelatedInstanceId,
  });
}

describe("BSAZ02-X04 grandwalkerData 宣言（本体ルール・導託は専用 effects 不要）", () => {
  it("kind:guided + 本文どおりの召喚/煌臨トリガーとoracleConditions 3件が宣言される", () => {
    const gw = X04.grandwalkerData!;
    expect(gw.kind).toBe("guided");
    expect(gw.oracleTriggerKinds).toEqual(["summon", "advent"]);
    expect(gw.oracleConditions).toHaveLength(3);
    expect(gw.oracleConditions).toEqual([
      { tribes: ["火星", "地球"], categories: ["spirit"], minCost: 3 },
      { tribes: ["火星"], categories: ["ultimate"] },
      { tribes: ["火星", "地球"], categories: ["brave"] },
    ]);
    expect(X05.grandwalkerData!.oracleTriggerKinds).toEqual([
      "summon",
      "advent",
    ]);
    expect(X05.grandwalkerData!.oracleConditions).toEqual([
      { tribes: ["火星"], categories: ["spirit"], minCost: 3 },
      { tribes: ["火星"], categories: ["ultimate"] },
      { tribes: ["火星"], categories: ["brave"] },
    ]);
  });

  it("placementOracleReturnToHand が「アルドノアドライブ」名で宣言される", () => {
    expect(X04.grandwalkerData!.placementOracleReturnToHand).toEqual({
      cardName: { contains: "アルドノアドライブ" },
    });
  });

  it("divineSkills[0] (導技:2) は coreCost:2/timing:attack(both)/minLevel:2/maxLevel:2/turnLimit:once_per_name", () => {
    const skills = X04.grandwalkerData!.divineSkills!;
    expect(skills).toHaveLength(1);
    const skill = skills[0]!;
    expect(skill.label).toBe("guided_skill");
    expect(skill.coreCost).toBe(2);
    expect(skill.timing).toEqual({
      step: "attack",
      whose: "both",
      mode: "flash",
    });
    expect(skill.minLevel).toBe(2);
    expect(skill.maxLevel).toBe(2);
    expect(skill.turnLimit).toBe("once_per_name");
  });
});

describe("BSAZ02-X04 grandwalkerData.oracleConditions（導託: 対象の召喚/煌臨時にコア+1）", () => {
  it("導託対象の自分の召喚後、任意でこのネクサスにコア1個を置ける", () => {
    const src = createCardInstance(X04, {
      instanceId: "src-x04",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const summoned = createCardInstance(MARS_SPIRIT_DEF, {
      instanceId: "mars-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, summoned],
    });

    const queued = checkAndQueueOracleChoices(
      state,
      "mars-spirit",
      "summon",
      getDef,
      "test:bsaz02-x04-aselam:262"
    );
    const pending = queued.pendingTriggeredEffects.find(
      (entry) =>
        entry.mechanic?.kind === "oracle" &&
        entry.mechanic.grandwalkerInstanceId === "src-x04"
    );
    expect(pending?.mechanic?.kind).toBe("oracle");
    if (pending?.mechanic?.kind !== "oracle") throw new Error("missing oracle");

    const after = resolveOracleMechanic(
      queued,
      pending.mechanic,
      ALICE,
      true,
      getDef
    );
    expect(
      after.cardInstances.find((instance) => instance.instanceId === "src-x04")
        ?.normalCoreCount
    ).toBe(1);
  });

  it("本文にない配置/アクセル使用では導託 pending を生成しない", () => {
    const src = createCardInstance(X04, {
      instanceId: "src-x04",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const matchingCard = createCardInstance(MARS_SPIRIT_DEF, {
      instanceId: "mars-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, matchingCard],
    });

    expect(
      checkAndQueueOracleChoices(
        state,
        "mars-spirit",
        "place",
        getDef,
        "test:bsaz02-x04-aselam:308"
      ).pendingTriggeredEffects
    ).toHaveLength(0);
    expect(
      checkAndQueueOracleChoices(
        state,
        "mars-spirit",
        "use_accel",
        getDef,
        "test:bsaz02-x04-aselam:312"
      ).pendingTriggeredEffects
    ).toHaveLength(0);
  });

  it("通常召喚した対象ブレイヴも oracle dispatch を経てX04/X05の導託を解決し、各ネクサスにコア1個を置く", () => {
    const x04 = createCardInstance(X04, {
      instanceId: "src-x04",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const x05 = createCardInstance(X05, {
      instanceId: "src-x05",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const braveBeforeSummon = createCardInstance(MARS_BRAVE_DEF, {
      instanceId: "mars-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const braveAfterSummon = createCardInstance(MARS_BRAVE_DEF, {
      instanceId: "mars-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    const beforeSummon = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [x04, x05, braveBeforeSummon],
      playerOverrides: [{ handCount: 1 }, {}],
    });
    const afterSummon = {
      ...beforeSummon,
      cardInstances: [x04, x05, braveAfterSummon],
      players: beforeSummon.players.map((player) =>
        player.id === ALICE ? { ...player, handCount: 0 } : player
      ),
    };
    const resolved = runActionMainResolution({
      state: recordSemanticTriggerEvent(afterSummon, {
        eventKind: "summon",
        relatedInstanceId: "mars-brave",
        fromZone: "hand",
      }),
      triggerBeforeState: beforeSummon,
      chainId: "test:bsaz02-x04-x05:brave-summon-oracle",
      startLogs: [],
      endLogs: [],
      context: {
        chainId: "test:bsaz02-x04-x05:brave-summon-oracle",
        resolutionKind: "play_card_action",
        actingPlayerId: ALICE,
        sourceKind: "brave",
        sourceCard: braveAfterSummon,
        sourceDefinition: MARS_BRAVE_DEF,
        targetInstanceIds: [],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: () => undefined,
      } as never,
      resolveEffect: (state) => state,
    });
    const oraclePendings = resolved.pendingTriggeredEffects.filter(
      (entry) => entry.mechanic?.kind === "oracle"
    );
    expect(oraclePendings).toHaveLength(2);

    const afterOracle = oraclePendings.reduce((state, entry) => {
      if (entry.mechanic?.kind !== "oracle") return state;
      return resolveOracleMechanic(state, entry.mechanic, ALICE, true, getDef);
    }, resolved);
    expect(
      afterOracle.cardInstances.find((card) => card.instanceId === "src-x04")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      afterOracle.cardInstances.find((card) => card.instanceId === "src-x05")
        ?.normalCoreCount
    ).toBe(1);
  });

  it("実際のdeclare_advent解決後、煌臨した対象からX04/X05の導託pendingを各1件キューする", () => {
    const x04 = createCardInstance(X04, {
      instanceId: "src-x04",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const x05 = createCardInstance(X05, {
      instanceId: "src-x05",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const host = createCardInstance(MARS_SPIRIT_DEF, {
      instanceId: "mars-advent-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const advent = createCardInstance(MARS_ADVENT_DEF, {
      instanceId: "mars-advent",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    let state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [x04, x05, host, advent],
      playerOverrides: [
        { handCount: 1, soulCoreLocation: { kind: "reserve" } },
        {},
      ],
    });
    state = { ...state, activePlayerId: ALICE, step: "main" };

    const declaration = getActions(state, ALICE).find(
      (action): action is Extract<LegalAction, { kind: "declare_advent" }> =>
        action.kind === "declare_advent" &&
        action.sourceInstanceId === "mars-advent"
    );
    expect(declaration).toBeDefined();
    state = applyAction(state, declaration!);

    for (let passes = 0; state.stackWindow !== null && passes < 4; passes++) {
      const priorityPlayerId = state.stackWindow.priorityPlayerId;
      const pass = getActions(state, priorityPlayerId).find(
        (action): action is Extract<LegalAction, { kind: "pass_stack" }> =>
          action.kind === "pass_stack"
      );
      expect(pass).toBeDefined();
      state = applyAction(state, pass!);
    }
    expect(state.stackWindow).toBeNull();

    const resolveTarget = getActions(state, ALICE).find(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_pending_effect_target" }
      > => action.kind === "resolve_pending_effect_target"
    );
    expect(resolveTarget).toBeDefined();
    const afterAdvent = applyAction(state, resolveTarget!, [
      "mars-advent-host",
    ]);
    const oraclePendings = afterAdvent.pendingTriggeredEffects.filter(
      (entry) => entry.mechanic?.kind === "oracle"
    );
    expect(oraclePendings).toHaveLength(2);

    const afterOracle = oraclePendings.reduce((current, entry) => {
      if (entry.mechanic?.kind !== "oracle") return current;
      return resolveOracleMechanic(
        current,
        entry.mechanic,
        ALICE,
        true,
        getDef
      );
    }, afterAdvent);
    expect(
      afterOracle.cardInstances.find((card) => card.instanceId === "src-x04")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      afterOracle.cardInstances.find((card) => card.instanceId === "src-x05")
        ?.normalCoreCount
    ).toBe(1);
  });
});

describe("BSAZ02-X04 effects[0]（Lv1-2: シンボルは白/究極としても扱う）", () => {
  it("getEffectiveSymbolBundles の既存エントリに white/ultimate_symbol が追加される", () => {
    const src = createCardInstance(X04, {
      instanceId: "src-x04",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      createEmptyGameState({ playerIds: [ALICE, BOB], cardInstances: [src] }),
      getDef
    );
    const bundles = getEffectiveSymbolBundles(rebuilt, src, X04, getDef);
    expect(bundles).toHaveLength(1); // 素の symbolColors: ["guide"] の1エントリに加色
    expect(bundles[0]!.colors).toContain("guide");
    expect(bundles[0]!.colors).toContain("white");
    expect(bundles[0]!.colors).toContain("ultimate_symbol");
  });
});

describe("BSAZ02-X04 effects[1]（導域: トラッシュの「アルドノアドライブ」を裏向きで下に）", () => {
  it("トラッシュに「アルドノアドライブ」があれば、召喚/配置イベント対象の下に裏向きで置かれる", () => {
    const src = createCardInstance(X04, {
      instanceId: "src-x04",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const drive = createCardInstance(ALDNOAH_DRIVE, {
      instanceId: "drive-in-trash",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const host = createCardInstance(FILLER_DEF, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, drive, host],
    });

    const after = runEffect(state, 1, { triggerRelatedInstanceId: "host-1" });

    const placed = after.cardInstances.find(
      (c) => c.instanceId === "drive-in-trash"
    )!;
    expect(placed.zone).toBe("field");
    expect(placed.attachedToInstanceId).toBe("host-1");
    expect(placed.faceDown).toBe(true);
    const hostAfter = after.cardInstances.find(
      (c) => c.instanceId === "host-1"
    )!;
    expect(hostAfter.underCards).toContainEqual({
      cardInstanceId: "drive-in-trash",
      role: "text_role",
      roleTag: "アルドノアドライブ",
    });
  });

  it("トラッシュのカードの controllerPlayerId が離脱前のコントロール移転で相手のままでも ownerPlayerId で自分のカードと判定される（verifier round1 指摘の回帰）", () => {
    const src = createCardInstance(X04, {
      instanceId: "src-x04",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const drive = createCardInstance(ALDNOAH_DRIVE, {
      instanceId: "drive-in-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: BOB, // 破壊前に相手にコントロールが移っていた想定、trash到達後も保持
      zone: "trash",
    });
    const host = createCardInstance(FILLER_DEF, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, drive, host],
    });

    const after = runEffect(state, 1, { triggerRelatedInstanceId: "host-1" });

    const placed = after.cardInstances.find(
      (c) => c.instanceId === "drive-in-trash"
    )!;
    expect(placed.zone).toBe("field");
    expect(placed.attachedToInstanceId).toBe("host-1");
  });

  it("トラッシュに「アルドノアドライブ」が無ければ no-op（他カードは動かない）", () => {
    const src = createCardInstance(X04, {
      instanceId: "src-x04",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const host = createCardInstance(FILLER_DEF, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, host],
    });

    const after = runEffect(state, 1, { triggerRelatedInstanceId: "host-1" });

    const hostAfter = after.cardInstances.find(
      (c) => c.instanceId === "host-1"
    )!;
    expect(hostAfter.underCards).toHaveLength(0);
  });
});

describe("BSAZ02-X04 grandwalkerData.placementOracleReturnToHand（配置時神託）", () => {
  it("配置時導託を発揮すると同名不在でデッキ上をトラッシュに置き、対象枚数分のコアを強制で置く", () => {
    const src = createCardInstance(X04, {
      instanceId: "src-x04",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const matchingDeckCard = createCardInstance(MARS_SPIRIT_DEF, {
      instanceId: "deck-mars-spirit",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, matchingDeckCard],
    });

    const queued = checkAndQueuePlacementOracle(
      state,
      "src-x04",
      getDef,
      "test:bsaz02-x04-aselam:623"
    );
    expect(
      queued.pendingTriggeredEffects.filter(
        (entry) =>
          entry.mechanic?.kind === "placement_oracle" &&
          entry.mechanic.grandwalkerInstanceId === "src-x04"
      )
    ).toHaveLength(1);
    const after = resolvePlacementOracleMechanic(
      queued,
      { kind: "placement_oracle", grandwalkerInstanceId: "src-x04" },
      getDef
    );

    expect(
      after.cardInstances.find(
        (instance) => instance.instanceId === "deck-mars-spirit"
      )?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((instance) => instance.instanceId === "src-x04")
        ?.normalCoreCount
    ).toBe(1);
  });

  it("トラッシュに置かれた「アルドノアドライブ」だけが手札に戻り、他はトラッシュに残る", () => {
    const src = createCardInstance(X04, {
      instanceId: "src-x04",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const drive = createCardInstance(ALDNOAH_DRIVE, {
      instanceId: "deck-drive",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const filler1 = createCardInstance(FILLER_DEF, {
      instanceId: "deck-filler-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const filler2 = createCardInstance(FILLER_DEF, {
      instanceId: "deck-filler-2",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, drive, filler1, filler2],
      playerOverrides: [{ handCount: 0 }, {}],
    });

    const after = resolvePlacementOracleMechanic(
      state,
      { kind: "placement_oracle", grandwalkerInstanceId: "src-x04" },
      getDef
    );

    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-drive")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-filler-1")!.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-filler-2")!.zone
    ).toBe("trash");
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(1);
  });

  it("prevent_deck_discard 中でもX04/X05の配置時導託はトラッシュ配置・手札追加・対象分コア配置を行う", () => {
    for (const nexus of [X04, X05]) {
      const sourceId = `src-${nexus.cardNo}`;
      const src = createCardInstance(nexus, {
        instanceId: sourceId,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const drive = createCardInstance(ALDNOAH_DRIVE, {
        instanceId: `deck-drive-${nexus.cardNo}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const matching = createCardInstance(MARS_SPIRIT_DEF, {
        instanceId: `deck-mars-${nexus.cardNo}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const preventDeckDiscard = {
        effectId: `test-prevent-deck-discard-${nexus.cardNo}`,
        sourceInstanceId: "prevent-source",
        sourceDefinitionId: "TEST-PREVENT",
        actingPlayerId: BOB,
        duration: { scope: "permanent" as const },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "prevent_deck_discard" as const,
        targetInstanceId: ALICE,
      };
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, drive, matching],
        playerOverrides: [{ handCount: 0 }, {}],
      });
      const state: GameState = {
        ...base,
        activeContinuousEffects: [preventDeckDiscard],
      };

      const after = resolvePlacementOracleMechanic(
        state,
        { kind: "placement_oracle", grandwalkerInstanceId: sourceId },
        getDef
      );

      expect(
        after.cardInstances.find((c) => c.instanceId === drive.instanceId)!.zone
      ).toBe("hand");
      expect(
        after.cardInstances.find((c) => c.instanceId === matching.instanceId)!
          .zone
      ).toBe("trash");
      expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(1);
      expect(
        after.cardInstances.find((c) => c.instanceId === sourceId)
          ?.normalCoreCount
      ).toBe(1);
    }
  });

  it.each(["deck", "trash"] as const)(
    "%s 効果耐性: デッキ耐性は導託を止め、トラッシュ耐性は移動と参照を止めないが回収を止める",
    (protectedZone) => {
      const src = createCardInstance(X04, {
        instanceId: "src-x04-zone-immune",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const drive = createCardInstance(ALDNOAH_DRIVE, {
        instanceId: "deck-drive-zone-immune",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const matching = createCardInstance(MARS_SPIRIT_DEF, {
        instanceId: "deck-mars-zone-immune",
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const zoneImmunity = {
        effectId: `test-${protectedZone}-effect-immunity`,
        sourceInstanceId: src.instanceId,
        sourceDefinitionId: X04.cardNo,
        actingPlayerId: ALICE,
        duration: { scope: "permanent" as const },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "defense_immune" as const,
        targetFilter: { player: "self" as const, zone: [protectedZone] },
        immunityPlayerScope: "any" as const,
      };
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, drive, matching],
        playerOverrides: [{ handCount: 0 }, {}],
      });
      const state: GameState = {
        ...base,
        activeContinuousEffects: [zoneImmunity],
      };

      const after = resolvePlacementOracleMechanic(
        state,
        { kind: "placement_oracle", grandwalkerInstanceId: src.instanceId },
        getDef
      );

      expect(
        after.cardInstances.find((c) => c.instanceId === drive.instanceId)!.zone
      ).toBe(protectedZone === "deck" ? "deck" : "trash");
      expect(
        after.cardInstances.find((c) => c.instanceId === matching.instanceId)!
          .zone
      ).toBe(protectedZone === "deck" ? "deck" : "trash");
      expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(0);
      expect(
        after.cardInstances.find((c) => c.instanceId === src.instanceId)
          ?.normalCoreCount
      ).toBe(protectedZone === "deck" ? 0 : 1);
    }
  );

  it("[board] X04/X05 の配置時導託は上位3枚の一部だけが耐性でも、実際に動けた対象だけを後続処理する", () => {
    for (const nexus of [X04, X05]) {
      const sourceId = `src-${nexus.cardNo}-partial-immunity`;
      const src = createCardInstance(nexus, {
        instanceId: sourceId,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const protectedDrive = createCardInstance(ALDNOAH_DRIVE, {
        instanceId: `protected-drive-${nexus.cardNo}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const matching = createCardInstance(MARS_SPIRIT_DEF, {
        instanceId: `movable-mars-${nexus.cardNo}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const filler = createCardInstance(FILLER_DEF, {
        instanceId: `movable-filler-${nexus.cardNo}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      });
      const protectedCardImmunity = {
        effectId: `test-placement-oracle-card-immunity-${nexus.cardNo}`,
        sourceInstanceId: "partial-immunity-source",
        sourceDefinitionId: "TEST-IMMUNITY",
        actingPlayerId: BOB,
        duration: { scope: "permanent" as const },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "defense_immune" as const,
        targetInstanceId: protectedDrive.instanceId,
        immunityPlayerScope: "any" as const,
      };
      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, protectedDrive, matching, filler],
        playerOverrides: [{ handCount: 0, deckCount: 3 }, {}],
      });
      const after = resolvePlacementOracleMechanic(
        { ...base, activeContinuousEffects: [protectedCardImmunity] },
        { kind: "placement_oracle", grandwalkerInstanceId: sourceId },
        getDef
      );

      expect(
        after.cardInstances.find(
          (card) => card.instanceId === protectedDrive.instanceId
        )?.zone
      ).toBe("deck");
      expect(
        after.cardInstances.find(
          (card) => card.instanceId === matching.instanceId
        )?.zone
      ).toBe("trash");
      expect(
        after.cardInstances.find(
          (card) => card.instanceId === filler.instanceId
        )?.zone
      ).toBe("trash");
      expect(
        after.players.find((player) => player.id === ALICE)?.handCount
      ).toBe(0);
      expect(
        after.cardInstances.find((card) => card.instanceId === sourceId)
          ?.normalCoreCount
      ).toBe(1);
      expect(
        after.players.find((player) => player.id === ALICE)?.deckCount
      ).toBe(1);
    }
  });
});

describe("BSAZ02-X04 grandwalkerData.divineSkills[0] 本体効果（コア2支払い後: トラッシュのコア1をライフへ）", () => {
  it("トラッシュコア -1 / ライフコア +1", () => {
    const src = createCardInstance(X04, {
      instanceId: "src-x04",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
      playerOverrides: [
        { trashNormalCoreCount: 1, lifeNormalCoreCount: 0 },
        {},
      ],
    });

    const skillEffect = X04.grandwalkerData!.divineSkills![0]!.effects![0]!;
    const after = executeEffect({
      chainId: "test:bsaz02-x04-aselam:910",
      state,
      effect: skillEffect,
      effectIndex: 0,
      sourceInstanceId: "src-x04",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.lifeNormalCoreCount).toBe(1);
  });
});
