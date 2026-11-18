/**
 * P3-67 Phase 1/2: getAvailableBurstSourceChoices の whose (player フィルタ) と
 * triggerFilter (色・系統・カテゴリ絞り) の挙動検証。
 *
 * burst の responder は actingPlayerId で先に絞られるが、whose は
 * イベント対象プレイヤー (relatedPlayerId) との一致で「自分の/相手の」を厳密化する。
 * triggerFilter はイベント対象カード (relatedInstanceId) が満たすべきカード条件。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  getAvailableBurstSourceChoices,
} from "../src";
import type {
  CardDefinition,
  GameState,
  PendingBurstCheck,
  RegisteredBurstAction,
} from "../src";

const burstSpirit: CardDefinition = {
  cardNo: "TEST-BURST-SRC",
  name: "burst src",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const ultimateCard: CardDefinition = {
  cardNo: "TEST-ULTIMATE",
  name: "ultimate",
  printedCategory: "ultimate",
  colors: ["blue"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 8000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const spiritCard: CardDefinition = {
  cardNo: "TEST-SPIRIT",
  name: "spirit",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const defMap = new Map<string, CardDefinition>([
  [burstSpirit.cardNo, burstSpirit],
  [ultimateCard.cardNo, ultimateCard],
  [spiritCard.cardNo, spiritCard],
]);
const getCardDefinitionById = (id: string) => defMap.get(id);

function buildState(
  extraInstances: GameState["cardInstances"] = []
): GameState {
  const burstSource = createCardInstance(burstSpirit, {
    instanceId: "burst-src",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    cardInstances: [burstSource, ...extraInstances],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "burst-src" }],
  };
}

function baseCheck(
  overrides: Partial<PendingBurstCheck> & {
    eventKind: PendingBurstCheck["eventKind"];
  }
): PendingBurstCheck {
  return {
    checkId: "check-1",
    actingPlayerId: "alice",
    source: "action_resolution",
    chainId: "test:burst-player-trigger-filter:99",
    attackId: null,
    relatedPlayerId: "alice",
    amount: 1,
    step: "attack",
    window: "battle_resolution",
    resolvedBurstCardInstanceIds: [],
    ...overrides,
  };
}

function choices(
  state: GameState,
  pendingBurstCheck: PendingBurstCheck,
  registration: RegisteredBurstAction
) {
  return getAvailableBurstSourceChoices({
    state,
    pendingBurstCheck,
    getCardDefinitionById,
    getRegisteredBurstActions: (cardNo) =>
      cardNo === burstSpirit.cardNo ? [registration] : undefined,
  });
}

describe("whose: self", () => {
  const reg: RegisteredBurstAction = {
    sourceKind: "spirit",
    eventKind: "reduce_life",
    whose: "self",
  };

  it("relatedPlayerId が所有者と一致 → 発動候補に含まれる", () => {
    const state = buildState();
    const check = baseCheck({
      chainId: "test:burst-player-trigger-filter:137",
      eventKind: "reduce_life",
      relatedPlayerId: "alice",
    });
    expect(choices(state, check, reg)).toHaveLength(1);
  });

  it("relatedPlayerId が相手 → whose:self で除外", () => {
    const state = buildState();
    const check = baseCheck({
      chainId: "test:burst-player-trigger-filter:146",
      eventKind: "reduce_life",
      relatedPlayerId: "bob",
    });
    expect(choices(state, check, reg)).toHaveLength(0);
  });
});

describe("whose: opponent", () => {
  const reg: RegisteredBurstAction = {
    sourceKind: "spirit",
    eventKind: "attack_after",
    whose: "opponent",
  };

  it("relatedPlayerId が相手 → 発動候補に含まれる", () => {
    const state = buildState();
    const check = baseCheck({
      chainId: "test:burst-player-trigger-filter:163",
      eventKind: "attack_after",
      relatedPlayerId: "bob",
    });
    expect(choices(state, check, reg)).toHaveLength(1);
  });

  it("relatedPlayerId が所有者自身 → whose:opponent で除外", () => {
    const state = buildState();
    const check = baseCheck({
      chainId: "test:burst-player-trigger-filter:172",
      eventKind: "attack_after",
      relatedPlayerId: "alice",
    });
    expect(choices(state, check, reg)).toHaveLength(0);
  });
});

describe("triggerFilter: category", () => {
  const reg: RegisteredBurstAction = {
    sourceKind: "spirit",
    eventKind: "leave_field",
    triggerFilter: { category: ["ultimate"] },
  };

  it("relatedInstanceId がアルティメット → 発動候補に含まれる", () => {
    const ult = createCardInstance(ultimateCard, {
      instanceId: "ult-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state = buildState([ult]);
    const check = baseCheck({
      chainId: "test:burst-player-trigger-filter:195",
      eventKind: "leave_field",
      relatedPlayerId: "alice",
      relatedInstanceId: "ult-1",
    });
    expect(choices(state, check, reg)).toHaveLength(1);
  });

  it("relatedInstanceId がスピリット → category 不一致で除外", () => {
    const sp = createCardInstance(spiritCard, {
      instanceId: "sp-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state = buildState([sp]);
    const check = baseCheck({
      chainId: "test:burst-player-trigger-filter:211",
      eventKind: "leave_field",
      relatedPlayerId: "alice",
      relatedInstanceId: "sp-1",
    });
    expect(choices(state, check, reg)).toHaveLength(0);
  });

  it("relatedInstanceId が無い → 評価不能で fail-closed (除外)", () => {
    const state = buildState();
    const check = baseCheck({
      chainId: "test:burst-player-trigger-filter:221",
      eventKind: "leave_field",
      relatedPlayerId: "alice",
      relatedInstanceId: null,
    });
    expect(choices(state, check, reg)).toHaveLength(0);
  });
});

describe("effect_activated: 効果発揮型 (eventMatcher actionKind + whose + triggerFilter)", () => {
  // 「相手のアルティメットの召喚時発揮後」相当。
  const reg: RegisteredBurstAction = {
    sourceKind: "spirit",
    eventKind: "effect_activated",
    eventMatcher: { family: "effect_activation", actionKind: "summon" },
    whose: "opponent",
    triggerFilter: { category: ["ultimate"] },
  };

  function activationCheck(
    actionKind: "summon" | "placement",
    relatedInstanceId: string
  ): PendingBurstCheck {
    return baseCheck({
      chainId: "test:burst-player-trigger-filter:244",
      eventKind: "effect_activated",
      relatedPlayerId: "bob",
      relatedInstanceId,
      event: {
        family: "effect_activation",
        actionKind,
        validationMode: "snapshot_only",
      },
    });
  }

  it("相手アルティメットの召喚時発揮 → 発動候補に含まれる", () => {
    const ult = createCardInstance(ultimateCard, {
      instanceId: "opp-ult",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state = buildState([ult]);
    expect(
      choices(state, activationCheck("summon", "opp-ult"), reg)
    ).toHaveLength(1);
  });

  it("配置時発揮 (actionKind 不一致) → eventMatcher で除外", () => {
    const ult = createCardInstance(ultimateCard, {
      instanceId: "opp-ult",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state = buildState([ult]);
    expect(
      choices(state, activationCheck("placement", "opp-ult"), reg)
    ).toHaveLength(0);
  });

  it("発揮元がスピリット (category 不一致) → triggerFilter で除外", () => {
    const sp = createCardInstance(spiritCard, {
      instanceId: "opp-sp",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state = buildState([sp]);
    expect(
      choices(state, activationCheck("summon", "opp-sp"), reg)
    ).toHaveLength(0);
  });
});

describe("cause: 「相手によって自分のスピリットが離れた後」 (leave cause 絞り) [P3-67]", () => {
  // cause [opponent_effect, battle] を受理、self_effect / state_based は除外。
  const reg: RegisteredBurstAction = {
    sourceKind: "spirit",
    eventKind: "leave_field",
    whose: "self",
    cause: ["opponent_effect", "battle"],
  };

  function leaveCheck(
    cause:
      | "opponent_effect"
      | "self_effect"
      | "battle"
      | "state_based"
      | "opponent_bp_compare"
  ): PendingBurstCheck {
    return baseCheck({
      chainId: "test:burst-player-trigger-filter:313",
      eventKind: "leave_field",
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      event: { family: "leave_field", validationMode: "snapshot_only", cause },
    });
  }

  it("相手効果由来の離脱 (opponent_effect) → 発動候補に含まれる", () => {
    expect(
      choices(buildState(), leaveCheck("opponent_effect"), reg)
    ).toHaveLength(1);
  });

  it("バトル破壊 (battle) → 発動候補に含まれる", () => {
    expect(choices(buildState(), leaveCheck("battle"), reg)).toHaveLength(1);
  });

  it("BP比べ勝者が相手 (opponent_bp_compare) → 旧『相手によって』cause ペアでも発動候補に含まれる", () => {
    expect(
      choices(buildState(), leaveCheck("opponent_bp_compare"), reg)
    ).toHaveLength(1);
  });

  it("cause:[bp_compare] は opponent_bp_compare も発動候補に含める", () => {
    const bpCompareReg: RegisteredBurstAction = {
      sourceKind: "spirit",
      eventKind: "leave_field",
      whose: "self",
      cause: ["bp_compare"],
    };
    expect(
      choices(buildState(), leaveCheck("opponent_bp_compare"), bpCompareReg)
    ).toHaveLength(1);
  });

  it("自分効果由来の離脱 (self_effect) → cause で除外", () => {
    expect(choices(buildState(), leaveCheck("self_effect"), reg)).toHaveLength(
      0
    );
  });

  it("state-based 消滅 (state_based) → cause で除外", () => {
    expect(choices(buildState(), leaveCheck("state_based"), reg)).toHaveLength(
      0
    );
  });

  it("cause を持たないイベント → 評価不能で fail-closed (除外)", () => {
    const check = baseCheck({
      chainId: "test:burst-player-trigger-filter:362",
      eventKind: "leave_field",
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      event: { family: "leave_field", validationMode: "snapshot_only" },
    });
    expect(choices(buildState(), check, reg)).toHaveLength(0);
  });
});
