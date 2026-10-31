/**
 * 手札からの直接バースト発動（裁定 2026-06-16, 信頼度 C / 10_rules/04b §手札からの直接バースト発動）。
 *
 * 「手札にあるこのカードは、バースト条件を満たしたとき（〜なら）発動できる」型
 * （BSTS01-M01[2]『〔ゲームに1回:同名〕… 自分のカウント5以上なら発動できる』）。
 * バーストエリアへ事前セットせず、手札のカードを直接バーストとして発動する。
 *
 * 検証:
 *   - timing.handSource:true の registration は、発動源が手札ゾーンのとき発動候補に含まれる
 *     （burst-set 不要）。
 *   - handSourceCondition（カウント5以上）が発動宣言時に評価され、未充足なら候補から除外される。
 *   - handSource でない通常 registration は手札ソースを候補にしない（後方互換）。
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
  cardNo: "TEST-HAND-BURST",
  name: "hand burst src",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 6,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 7000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const defMap = new Map<string, CardDefinition>([
  [burstSpirit.cardNo, burstSpirit],
]);
const getCardDefinitionById = (id: string) => defMap.get(id);

function buildState(options: {
  zone: "hand" | "burst";
  countValue: number;
  setBurst?: boolean;
}): GameState {
  const source = createCardInstance(burstSpirit, {
    instanceId: "hand-burst-src",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: options.zone,
  });
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const alice = base.players.find((p) => p.id === "alice")!;
  return {
    ...base,
    cardInstances: [source],
    players: base.players.map((p) =>
      p.id === "alice" ? { ...alice, countValue: options.countValue } : p
    ),
    setBurstStates: options.setBurst
      ? [{ playerId: "alice", cardInstanceId: "hand-burst-src" }]
      : [],
  };
}

function check(): PendingBurstCheck {
  return {
    checkId: "check-1",
    actingPlayerId: "alice",
    eventKind: "attack_after",
    source: "action_resolution",
    chainId: "test:hand-source-burst:74",
    attackId: null,
    relatedPlayerId: "bob",
    amount: 1,
    step: "attack",
    window: "battle_resolution",
    resolvedBurstCardInstanceIds: [],
  };
}

function choices(state: GameState, registration: RegisteredBurstAction) {
  return getAvailableBurstSourceChoices({
    state,
    pendingBurstCheck: check(),
    getCardDefinitionById,
    getRegisteredBurstActions: (cardNo) =>
      cardNo === burstSpirit.cardNo ? [registration] : undefined,
  });
}

const handReg: RegisteredBurstAction = {
  sourceKind: "spirit",
  eventKind: "attack_after",
  whose: "opponent",
  handSource: true,
  handSourceCondition: [{ kind: "count_value", player: "self", min: 5 }],
};

describe("手札からの直接バースト発動", () => {
  it("手札ソース + カウント5以上 → 発動候補に含まれる（burst-set 不要）", () => {
    const state = buildState({ zone: "hand", countValue: 5 });
    const result = choices(state, handReg);
    expect(result).toHaveLength(1);
    expect(result[0]!.sourceCard.zone).toBe("hand");
  });

  it("手札ソースでもカウント5未満 → 発動条件未充足で除外", () => {
    const state = buildState({ zone: "hand", countValue: 4 });
    expect(choices(state, handReg)).toHaveLength(0);
  });

  it("handSource registration はバーストゾーンの同カードを候補にしない", () => {
    const state = buildState({
      zone: "burst",
      countValue: 5,
      setBurst: true,
    });
    expect(choices(state, handReg)).toHaveLength(0);
  });

  it("handSource でない通常 registration は手札ソースを候補にしない（後方互換）", () => {
    const normalReg: RegisteredBurstAction = {
      sourceKind: "spirit",
      eventKind: "attack_after",
      whose: "opponent",
    };
    const state = buildState({ zone: "hand", countValue: 5 });
    expect(choices(state, normalReg)).toHaveLength(0);
  });

  it("通常 registration はバーストゾーン + set 済みなら候補に含まれる（後方互換）", () => {
    const normalReg: RegisteredBurstAction = {
      sourceKind: "spirit",
      eventKind: "attack_after",
      whose: "opponent",
    };
    const state = buildState({
      zone: "burst",
      countValue: 0,
      setBurst: true,
    });
    expect(choices(state, normalReg)).toHaveLength(1);
  });
});
