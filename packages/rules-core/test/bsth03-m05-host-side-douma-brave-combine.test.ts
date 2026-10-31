/**
 * BSTH03-M05 effects[1] Lv3-Lv4-Lv5:
 * 「系統:導魔を持つブレイヴ3つまでと合体条件を無視して合体できる」。
 *
 * ルール正源:
 * - 10_rules/03c:10/14 合体の「できる」は任意、2026-10-19訂正の「変更する」は必須。
 * - 10_rules/05:25 合体中ブレイヴの効果はホストへ合算される。
 * - 10_rules/05:30 合体条件を満たさなくなった場合はただちに分離する。
 * - 10_rules/05:31 通常は1体1ブレイヴ、maxCombinedBraves 付きホストは例外。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  getCombinedUnitBp,
  getAvailableTriggeredEffectSourceChoices,
  queueRegisteredBattleImmediateEffects,
  useBattleImmediateEffectAsAction,
} from "../src/runtime";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import { collectStateBasedActions } from "../src/state-based-actions";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
} from "../src/runtime";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);

const getDef = (definitionId: string): CardDefinition | undefined =>
  cardNoMap.get(definitionId) ??
  [
    mismatchingDoumaBraveA,
    mismatchingDoumaBraveB,
    mismatchingDoumaBraveC,
    mismatchingDoumaBraveD,
    triggeredDoumaBrave,
    optionalImmediateDoumaBrave,
    optionalTriggeredDoumaBrave,
    spiritCombinedHeadingDoumaBrave,
    genericHostDef,
    matchingSourceHostDef,
  ].find((card) => card.cardNo === definitionId);

const M05 = cardNoMap.get("BSTH03-M05")!;
const BSAZ01_C18 = cardNoMap.get("BSAZ01-C18")!;

const mismatchingDoumaBrave = (cardNo: string): CardDefinition => ({
  cardNo,
  name: `合体条件不一致の導魔ブレイヴ ${cardNo}`,
  printedCategory: "brave",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  combinedBoost: 1000,
  symbolColors: ["yellow"],
  textLines: [
    "【合体条件：妖精＆コスト99以上】",
    "【合体中】『このスピリットのアタック時』このスピリットは回復する。",
  ],
  tribe: "導魔",
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  braveCondition: { categories: ["spirit"], tribes: ["妖精"], minCost: 99 },
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      applicability: { combined: true },
      steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
      textRef: [1],
    },
  ],
});

const mismatchingDoumaBraveA = mismatchingDoumaBrave("TEST-M05-DOUMA-A");
const mismatchingDoumaBraveB = mismatchingDoumaBrave("TEST-M05-DOUMA-B");
const mismatchingDoumaBraveC = mismatchingDoumaBrave("TEST-M05-DOUMA-C");
const mismatchingDoumaBraveD = mismatchingDoumaBrave("TEST-M05-DOUMA-D");

const triggeredDoumaBrave: CardDefinition = {
  ...mismatchingDoumaBrave("TEST-M05-DOUMA-TRIGGERED"),
  textLines: [
    "【合体条件：妖精＆コスト99以上】",
    "【合体中】『このスピリットのバトル終了時』このスピリットは回復する。",
  ],
  effects: [
    {
      timing: { kind: "card_event", event: "battle_end" },
      applicability: { combined: true },
      usageLimit: { kind: "per_instance", duration: "turn" },
      steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
      textRef: [1],
    },
  ],
};

const optionalImmediateDoumaBrave: CardDefinition = {
  ...mismatchingDoumaBraveA,
  cardNo: "TEST-M05-DOUMA-OPTIONAL",
  textLines: mismatchingDoumaBraveA.textLines.map((line) =>
    line.replace("回復する。", "回復できる。")
  ),
  effects: [
    { ...mismatchingDoumaBraveA.effects![0]!, executionMode: "optional" },
  ],
};
const optionalTriggeredDoumaBrave: CardDefinition = {
  ...triggeredDoumaBrave,
  cardNo: "TEST-M05-DOUMA-OPTIONAL-TRIGGERED",
  textLines: triggeredDoumaBrave.textLines.map((line) =>
    line.replace("回復する。", "回復できる。")
  ),
  effects: [{ ...triggeredDoumaBrave.effects![0]!, executionMode: "optional" }],
};

const spiritCombinedHeadingDoumaBrave: CardDefinition = {
  ...mismatchingDoumaBrave("TEST-M05-DOUMA-SPIRIT-HEADING"),
  textLines: [
    "【合体条件：妖精＆コスト99以上】",
    "【スピリット合体中】『このスピリットのアタック時』このスピリットは回復する。",
  ],
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      applicability: { combined: true },
      steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
      textRef: [1],
    },
  ],
};

const genericHostDef: CardDefinition = {
  cardNo: "TEST-M05-GENERIC-HOST",
  name: "通常ホスト",
  printedCategory: "ultimate",
  colors: ["yellow"],
  cost: 6,
  reductionSymbols: [],
  levelDefs: [{ level: 3, requiredCores: 1, bp: 10000 }],
  symbolColors: ["ultimate_symbol"],
  textLines: [],
  tribe: "導魔",
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const matchingSourceHostDef: CardDefinition = {
  cardNo: "TEST-M05-MATCHING-SOURCE-HOST",
  name: "交換元の妖精コスト99スピリット",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 99,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["yellow"],
  textLines: [],
  tribe: "妖精",
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const battleImmediateLookup = buildBattleImmediateEffectLookup([
  M05,
  mismatchingDoumaBraveA,
  mismatchingDoumaBraveB,
  mismatchingDoumaBraveC,
  mismatchingDoumaBraveD,
  triggeredDoumaBrave,
  optionalImmediateDoumaBrave,
  optionalTriggeredDoumaBrave,
  spiritCombinedHeadingDoumaBrave,
  BSAZ01_C18,
  genericHostDef,
  matchingSourceHostDef,
]);
const triggeredLookup = buildTriggeredEffectLookup([
  M05,
  mismatchingDoumaBraveA,
  mismatchingDoumaBraveB,
  mismatchingDoumaBraveC,
  mismatchingDoumaBraveD,
  triggeredDoumaBrave,
  optionalImmediateDoumaBrave,
  optionalTriggeredDoumaBrave,
  spiritCombinedHeadingDoumaBrave,
  BSAZ01_C18,
  genericHostDef,
  matchingSourceHostDef,
]);

function baseState(cards: GameState["cardInstances"]): GameState {
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step: "main",
    cardInstances: cards,
  };
}

function makeM05Host(children: string[] = [], normalCoreCount = 1) {
  return createCardInstance(M05, {
    instanceId: "m05-host",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount,
    attachedChildrenIds: children,
  });
}

function makeGenericUltimateHost(children: string[] = []) {
  return createCardInstance(genericHostDef, {
    instanceId: "generic-host",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
    attachedChildrenIds: children,
  });
}

function makeBrave(
  def: CardDefinition,
  instanceId: string,
  attachedToInstanceId: string | null = null
) {
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: attachedToInstanceId === null ? 1 : 0,
    attachedToInstanceId,
  });
}

function braveCombineActions(state: GameState) {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredFieldCardEffectActions: () => undefined,
  }).filter((action) => action.kind === "brave_combine");
}

function braveSwapActions(state: GameState) {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: () => undefined,
  }).filter((action) => action.kind === "brave_swap");
}

function battleState(cards: GameState["cardInstances"]): GameState {
  return {
    ...baseState(cards),
    step: "attack",
    turnNumber: 2,
  };
}

function queueAttackImmediateForHost(
  state: GameState,
  hostInstanceId: string
): GameState {
  const host = state.cardInstances.find(
    (card) => card.instanceId === hostInstanceId
  )!;
  const hostDef = getDef(host.definitionId)!;
  return queueRegisteredBattleImmediateEffects({
    state,
    attackId: `attack-${hostInstanceId}`,
    participantEntityId: `battle-entity:${hostInstanceId}`,
    actingPlayerId: "alice",
    sourceCard: host,
    sourceDefinition: hostDef,
    timing: "attack",
    getCardDefinitionById: getDef,
    getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
  });
}

const battleImmediateLegalOptions = {
  getCardDefinitionById: getDef,
  getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
  getRegisteredTriggeredEffectActions: triggeredLookup,
  getRegisteredBurstActions: undefined,
  getRegisteredFieldCardEffectActions: () => undefined,
};

function battleEndPending(relatedInstanceId: string): PendingTriggeredEffect {
  return {
    pendingId: `pending:${relatedInstanceId}:battle-end`,
    actingPlayerId: "alice",
    eventKind: "battle_end",
    event: { family: "battle_end", validationMode: "snapshot_only" },
    source: "battle",
    chainId: "test:bsth03-m05-host-side-douma-brave-combine:271",
    attackId: `attack-${relatedInstanceId}`,
    relatedPlayerId: "alice",
    relatedInstanceId,
    amount: null,
    step: "attack",
    window: "main",
    resolvedSourceInstanceIds: [],
  };
}

function summonPending(relatedInstanceId: string): PendingTriggeredEffect {
  return {
    pendingId: `pending:${relatedInstanceId}:summon`,
    actingPlayerId: "alice",
    eventKind: "summon",
    source: "action_resolution",
    chainId: "test:bsth03-m05-host-side-douma-brave-combine:289",
    attackId: null,
    relatedPlayerId: "alice",
    relatedInstanceId,
    amount: null,
    step: "main",
    window: "main",
    resolvedSourceInstanceIds: [],
  };
}

function stateWithBattleEndPending(
  state: GameState,
  relatedInstanceId: string
): GameState {
  return {
    ...state,
    pendingTriggeredEffects: [battleEndPending(relatedInstanceId)],
  };
}

function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 8 && current.stackWindow !== null; i++) {
    const pass = getLegalActions({
      state: current,
      actingPlayerId: current.stackWindow.priorityPlayerId,
      ...battleImmediateLegalOptions,
    }).find((action) => action.kind === "pass_stack");
    if (!pass) break;
    current = applyLegalAction({
      state: current,
      action: pass,
      ...battleImmediateLegalOptions,
    }).state;
  }
  return current;
}

describe("BSTH03-M05 host-side 導魔ブレイヴ多重合体", () => {
  it("構造: maxCombinedBraves が合体条件無視付きで effects[1] に連動し、stub は解消される", () => {
    expect(M05.cardNo).toBe("BSTH03-M05");
    expect(M05.effects![1]!.stub).toBeUndefined();
    expect(M05.effects![1]!.applicability).toEqual({
      level: { min: 3, max: 5 },
    });
    expect(M05.maxCombinedBraves).toEqual({
      count: 3,
      condition: { tribes: ["導魔"] },
      ignoreIncomingBraveCondition: true,
      selfReferenceRewrite: {
        fromText: "this_spirit",
        toHostCategory: "ultimate",
        executionMode: "mandatory",
      },
      effectIndex: 1,
    });
  });

  it("incoming braveDef.braveCondition 不一致でも、M05 host 側許可に限り候補化する", () => {
    const state = baseState([
      makeM05Host(),
      createCardInstance(genericHostDef, {
        instanceId: "generic-host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      makeBrave(mismatchingDoumaBraveA, "brave-a"),
    ]);

    const actions = braveCombineActions(state);
    expect(
      actions.some(
        (action) =>
          action.braveInstanceId === "brave-a" &&
          action.targetInstanceId === "m05-host"
      )
    ).toBe(true);
    expect(
      actions.some(
        (action) =>
          action.braveInstanceId === "brave-a" &&
          action.targetInstanceId === "generic-host"
      )
    ).toBe(false);
  });

  it("導魔ブレイヴ3つまでは受け入れ、4つ目は maxCombinedBraves 上限で候補化しない", () => {
    const state = baseState([
      makeM05Host(["brave-a", "brave-b"]),
      makeBrave(mismatchingDoumaBraveA, "brave-a", "m05-host"),
      makeBrave(mismatchingDoumaBraveB, "brave-b", "m05-host"),
      makeBrave(mismatchingDoumaBraveC, "brave-c"),
    ]);

    expect(
      braveCombineActions(state).some(
        (action) =>
          action.braveInstanceId === "brave-c" &&
          action.targetInstanceId === "m05-host"
      )
    ).toBe(true);

    const fullState = baseState([
      makeM05Host(["brave-a", "brave-b", "brave-c"]),
      makeBrave(mismatchingDoumaBraveA, "brave-a", "m05-host"),
      makeBrave(mismatchingDoumaBraveB, "brave-b", "m05-host"),
      makeBrave(mismatchingDoumaBraveC, "brave-c", "m05-host"),
      makeBrave(mismatchingDoumaBraveD, "brave-d"),
    ]);

    expect(
      braveCombineActions(fullState).some(
        (action) =>
          action.braveInstanceId === "brave-d" &&
          action.targetInstanceId === "m05-host"
      )
    ).toBe(false);
  });

  it("BSTH03-M05 は条件不一致の導魔3体を順に合体し、接続・コア・BPを確定して4体目を残す", () => {
    let state = baseState([
      makeM05Host(),
      makeBrave(mismatchingDoumaBraveA, "brave-a"),
      makeBrave(mismatchingDoumaBraveB, "brave-b"),
      makeBrave(mismatchingDoumaBraveC, "brave-c"),
      makeBrave(mismatchingDoumaBraveD, "brave-d"),
    ]);
    for (const braveInstanceId of ["brave-a", "brave-b", "brave-c"]) {
      const action = braveCombineActions(state).find(
        (entry) =>
          entry.braveInstanceId === braveInstanceId &&
          entry.targetInstanceId === "m05-host"
      );
      expect(action).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
      }).state;
    }
    const host = state.cardInstances.find(
      (entry) => entry.instanceId === "m05-host"
    )!;
    expect(host.attachedChildrenIds).toEqual(["brave-a", "brave-b", "brave-c"]);
    expect(host.normalCoreCount).toBe(4);
    expect(getCombinedUnitBp(state, host, M05, getDef)).toBe(18000);
    for (const id of ["brave-a", "brave-b", "brave-c"]) {
      expect(
        state.cardInstances.find((entry) => entry.instanceId === id)
      ).toMatchObject({
        zone: "field",
        attachedToInstanceId: "m05-host",
        normalCoreCount: 0,
      });
    }
    expect(
      braveCombineActions(state).some(
        (entry) => entry.targetInstanceId === "m05-host"
      )
    ).toBe(false);
    expect(
      state.cardInstances.find((entry) => entry.instanceId === "brave-d")
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: null,
      normalCoreCount: 1,
    });
    expect(
      collectStateBasedActions(state, getDef).some(
        (entry) => entry.kind === "brave_forced_separation"
      )
    ).toBe(false);
  });

  it("実 attach 後も、incoming braveCondition 不一致を理由に state-based 分離しない", () => {
    const state = baseState([
      makeM05Host(),
      makeBrave(mismatchingDoumaBraveA, "brave-a"),
    ]);

    const combined = executeBraveCombine(
      state,
      "alice",
      "brave-a",
      "m05-host",
      getDef
    );

    expect(
      combined.cardInstances.find((card) => card.instanceId === "brave-a")
        ?.attachedToInstanceId
    ).toBe("m05-host");
    expect(
      collectStateBasedActions(combined, getDef).some(
        (check) => check.kind === "brave_forced_separation"
      )
    ).toBe(false);
  });

  it("通常の brave_swap は host 側許可があっても incoming braveCondition を無視しない", () => {
    const state = baseState([
      makeM05Host(),
      createCardInstance(matchingSourceHostDef, {
        instanceId: "matching-source-host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        attachedChildrenIds: ["brave-a"],
      }),
      makeBrave(mismatchingDoumaBraveA, "brave-a", "matching-source-host"),
    ]);

    expect(
      braveCombineActions(state).some(
        (action) =>
          action.braveInstanceId === "brave-a" &&
          action.targetInstanceId === "m05-host"
      )
    ).toBe(false);
    expect(
      braveSwapActions(state).some(
        (action) =>
          action.braveInstanceId === "brave-a" &&
          action.toHostInstanceId === "m05-host"
      )
    ).toBe(false);
  });

  it("通常の brave_swap は交換後の source host 残存ブレイヴも合体条件を満たす必要がある", () => {
    const state = baseState([
      makeM05Host(["brave-a", "brave-b"]),
      makeBrave(mismatchingDoumaBraveA, "brave-a", "m05-host"),
      makeBrave(mismatchingDoumaBraveB, "brave-b", "m05-host"),
      createCardInstance(matchingSourceHostDef, {
        instanceId: "matching-target-host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
    ]);

    expect(
      braveSwapActions(state).some(
        (action) =>
          action.braveInstanceId === "brave-a" &&
          action.fromHostInstanceId === "m05-host" &&
          action.toHostInstanceId === "matching-target-host"
      )
    ).toBe(false);
  });

  it("BSTH03-M05 なしでは導魔ブレイヴの「このスピリット」アタック時効果を ultimate host に dispatch しない", () => {
    expect(M05.cardNo).toBe("BSTH03-M05");
    const host = {
      ...makeGenericUltimateHost(["brave-a"]),
      exhaustState: "exhausted" as const,
    };
    const brave = makeBrave(mismatchingDoumaBraveA, "brave-a", "generic-host");

    const queued = queueAttackImmediateForHost(
      battleState([host, brave]),
      "generic-host"
    );

    expect(queued.battleImmediateEffects).toHaveLength(0);
    expect(
      queued.cardInstances.find((card) => card.instanceId === "generic-host")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("BSTH03-M05 Lv 不足では導魔ブレイヴの self-reference rewrite を dispatch しない", () => {
    expect(M05.cardNo).toBe("BSTH03-M05");
    const host = {
      ...makeM05Host(["brave-a"], 0),
      exhaustState: "exhausted" as const,
    };
    const brave = makeBrave(mismatchingDoumaBraveA, "brave-a", "m05-host");

    const queued = queueAttackImmediateForHost(
      battleState([host, brave]),
      "m05-host"
    );

    expect(queued.battleImmediateEffects).toHaveLength(0);
    expect(
      queued.cardInstances.find((card) => card.instanceId === "m05-host")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("必須読み替えでもブレイヴ自身の任意アタック時効果は辞退できる", () => {
    expect(M05.cardNo).toBe("BSTH03-M05");
    const host = {
      ...makeM05Host(["brave-a"]),
      exhaustState: "exhausted" as const,
    };
    const brave = makeBrave(optionalImmediateDoumaBrave, "brave-a", "m05-host");
    const queued = queueAttackImmediateForHost(
      battleState([host, brave]),
      "m05-host"
    );
    const prompt = queued.battleImmediateEffects[0]!;
    expect(prompt).toMatchObject({
      sourceCardNo: "TEST-M05-DOUMA-OPTIONAL",
      sourceInstanceId: "m05-host",
      sourceEffectInstanceId: "brave-a",
    });
    const skipAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...battleImmediateLegalOptions,
    }).find(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.promptId === prompt.promptId &&
        action.skipOnly === true
    );
    expect(skipAction).toBeDefined();

    const afterSkip = applyLegalAction({
      state: queued,
      action: skipAction!,
      ...battleImmediateLegalOptions,
    }).state;

    expect(afterSkip.battleImmediateEffects).toHaveLength(0);
    expect(
      afterSkip.cardInstances.find((card) => card.instanceId === "m05-host")
        ?.exhaustState
    ).toBe("exhausted");
    expect(afterSkip.log).toContain(
      `skip_optional_battle_immediate_effect:${prompt.promptId}`
    );
  });

  it("BSTH03-M05 は読み替えの辞退なく必須アタック時効果をホストへ発揮する", () => {
    expect(M05.cardNo).toBe("BSTH03-M05");
    const host = {
      ...makeM05Host(["brave-a"]),
      exhaustState: "exhausted" as const,
    };
    const brave = makeBrave(mismatchingDoumaBraveA, "brave-a", "m05-host");
    const queued = queueAttackImmediateForHost(
      battleState([host, brave]),
      "m05-host"
    );
    const prompt = queued.battleImmediateEffects[0]!;
    expect(
      getLegalActions({
        state: queued,
        actingPlayerId: "alice",
        ...battleImmediateLegalOptions,
      }).some(
        (a) =>
          a.kind === "resolve_battle_immediate_effect" &&
          a.promptId === prompt.promptId &&
          a.skipOnly === true
      )
    ).toBe(false);

    const after = useBattleImmediateEffectAsAction({
      state: queued,
      actingPlayerId: "alice",
      promptId: prompt.promptId,
      sourceInstanceId: "brave-a",
      sourceKind: prompt.sourceKind,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    }).state;

    expect(
      after.cardInstances.find((card) => card.instanceId === "m05-host")
        ?.exhaustState
    ).toBe("recovered");
    expect(
      after.cardInstances.find((card) => card.instanceId === "brave-a")
        ?.attachedToInstanceId
    ).toBe("m05-host");
    expect(after.battleImmediateEffects).toHaveLength(0);
  });

  it("battle dispatch resolve-time rewrite recheck fizzles when the M05 host loses Lv after queue", () => {
    expect(M05.cardNo).toBe("BSTH03-M05");
    const host = {
      ...makeM05Host(["brave-a"]),
      exhaustState: "exhausted" as const,
    };
    const brave = makeBrave(mismatchingDoumaBraveA, "brave-a", "m05-host");
    const queued = queueAttackImmediateForHost(
      battleState([host, brave]),
      "m05-host"
    );
    const prompt = queued.battleImmediateEffects[0]!;
    expect(prompt).toMatchObject({
      sourceInstanceId: "m05-host",
      sourceEffectInstanceId: "brave-a",
    });

    const stale = {
      ...queued,
      cardInstances: queued.cardInstances.map((card) =>
        card.instanceId === "m05-host" ? { ...card, normalCoreCount: 0 } : card
      ),
    };

    const after = useBattleImmediateEffectAsAction({
      state: stale,
      actingPlayerId: "alice",
      promptId: prompt.promptId,
      sourceInstanceId: prompt.sourceInstanceId,
      sourceKind: prompt.sourceKind,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    }).state;

    expect(
      after.cardInstances.find((card) => card.instanceId === "m05-host")
        ?.exhaustState
    ).toBe("exhausted");
    expect(after.battleImmediateEffects).toHaveLength(0);
    expect(after.log).toContain(
      `effect:effect-fizzled:${prompt.promptId}:brave-self-reference-rewrite-inactive`
    );
  });

  it("attached brave の『このブレイヴの召喚時』は host summon の card_event として dispatch しない", () => {
    expect(M05.cardNo).toBe("BSTH03-M05");
    expect(BSAZ01_C18.cardNo).toBe("BSAZ01-C18");
    const host = makeM05Host(["brave-c18"]);
    const brave = makeBrave(BSAZ01_C18, "brave-c18", "m05-host");
    const state = {
      ...baseState([host, brave]),
      pendingTriggeredEffects: [summonPending("m05-host")],
    };

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: state.pendingTriggeredEffects[0]!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(
      choices.filter(
        (choice) => choice.sourceEffectDefinition.cardNo === "BSAZ01-C18"
      )
    ).toHaveLength(0);
  });

  it("BSTH03-M05 なしでは triggered dispatch でも導魔ブレイヴ効果を ultimate host に提示しない", () => {
    expect(M05.cardNo).toBe("BSTH03-M05");
    const host = {
      ...makeGenericUltimateHost(["brave-a"]),
      exhaustState: "exhausted" as const,
    };
    const brave = makeBrave(triggeredDoumaBrave, "brave-a", "generic-host");
    const state = stateWithBattleEndPending(
      battleState([host, brave]),
      "generic-host"
    );

    expect(
      getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect: state.pendingTriggeredEffects[0]!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      })
    ).toHaveLength(0);
    expect(
      getLegalActions({
        state,
        actingPlayerId: "alice",
        ...battleImmediateLegalOptions,
      }).filter(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === "brave-a"
      )
    ).toHaveLength(0);
  });

  it("BSTH03-M05 は必須誘発効果を読み替えてホストへ発揮する", () => {
    expect(M05.cardNo).toBe("BSTH03-M05");
    const host = {
      ...makeM05Host(["brave-a"]),
      exhaustState: "exhausted" as const,
    };
    const brave = makeBrave(triggeredDoumaBrave, "brave-a", "m05-host");
    const state = stateWithBattleEndPending(
      battleState([host, brave]),
      "m05-host"
    );
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...battleImmediateLegalOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.sourceInstanceId === "m05-host" &&
        candidate.sourceEffectInstanceId === "brave-a" &&
        candidate.skipOnly !== true
    );

    expect(action).toMatchObject({
      sourceCardNo: "TEST-M05-DOUMA-TRIGGERED",
      sourceInstanceId: "m05-host",
      sourceEffectInstanceId: "brave-a",
      executionMode: "mandatory",
    });

    const declared = applyLegalAction({
      state,
      action: action!,
      ...battleImmediateLegalOptions,
    }).state;
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "triggered_effect"
    );

    const after = passStackUntilClosed(declared);

    expect(
      after.cardInstances.find((card) => card.instanceId === "m05-host")
        ?.exhaustState
    ).toBe("recovered");
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });

  it("必須読み替えでもブレイヴ自身の任意誘発効果は辞退できる", () => {
    expect(M05.cardNo).toBe("BSTH03-M05");
    const host = {
      ...makeM05Host(["brave-a"]),
      exhaustState: "exhausted" as const,
    };
    const brave = makeBrave(optionalTriggeredDoumaBrave, "brave-a", "m05-host");
    const state = stateWithBattleEndPending(
      battleState([host, brave]),
      "m05-host"
    );
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...battleImmediateLegalOptions,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.sourceInstanceId === "m05-host" &&
        candidate.sourceEffectInstanceId === "brave-a" &&
        candidate.skipOnly !== true
    );

    expect(action).toMatchObject({
      sourceCardNo: "TEST-M05-DOUMA-OPTIONAL-TRIGGERED",
      sourceInstanceId: "m05-host",
      sourceEffectInstanceId: "brave-a",
      executionMode: "optional",
    });

    const skipped = applyLegalAction({
      state,
      action: action!,
      skipOptionalEffect: true,
      ...battleImmediateLegalOptions,
    }).state;

    expect(skipped.stackWindow).toBeNull();
    expect(skipped.pendingTriggeredEffects).toHaveLength(0);
    expect(skipped.effectUsageRecords).toHaveLength(0);
    expect(skipped.log).toContain(
      "skip_optional_triggered_effect:pending:m05-host:battle-end"
    );
    expect(
      skipped.cardInstances.find((card) => card.instanceId === "m05-host")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("BSTH03-M05 の rewrite は【スピリット合体中】見出しの効果を ultimate host に dispatch しない", () => {
    expect(M05.cardNo).toBe("BSTH03-M05");
    const host = {
      ...makeM05Host(["brave-a"]),
      exhaustState: "exhausted" as const,
    };
    const brave = makeBrave(
      spiritCombinedHeadingDoumaBrave,
      "brave-a",
      "m05-host"
    );

    const queued = queueAttackImmediateForHost(
      battleState([host, brave]),
      "m05-host"
    );

    expect(queued.battleImmediateEffects).toHaveLength(0);
    expect(
      queued.cardInstances.find((card) => card.instanceId === "m05-host")
        ?.exhaustState
    ).toBe("exhausted");
  });
});
