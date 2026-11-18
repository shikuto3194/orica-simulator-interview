/**
 * core_distribute mode="player_choice" の from=void ソース対応テスト。
 *
 * 「ボイドからコアN個を選択した自分のスピリット/アルティメットに置く」用。
 * ボイドは player の voidNormalCoreCount をソースにするため:
 *  - availableCores = min(要求量, voidNormalCoreCount) として扱う
 *  - 配分解決後にプレイヤーの voidNormalCoreCount を減算する
 *  - reserve/trash カウンタは減算しない
 *  - soul core 非対応 (hasSoulCore=false)
 *
 * 旧挙動: from=void は player_choice で unsupported_source として no-op していた
 * （BSLH01-C 召喚時 / BSTH09.2-転醒R03(B) 転醒時が無表現）。本対応で pending を生成する。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { BSTH09_2_CARDS } from "../../card-data/src/cards/BSTH09.2";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "起幻",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 1, // 場維持に最低 1 コア（コア不足消滅を避ける）
  });
  return { ...base, ...overrides };
}

function makeState(
  cards: CardInstance[],
  opts: { reserve?: number; trash?: number; deck?: number } = {}
): GameState {
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: cards,
    startingLife: 5,
  });
  return {
    ...state,
    activePlayerId: ALICE,
    players: state.players.map((p) =>
      p.id === ALICE
        ? {
            ...p,
            reserveNormalCoreCount: opts.reserve ?? 0,
            trashNormalCoreCount: opts.trash ?? 0,
            deckCount: opts.deck ?? 40,
          }
        : p
    ),
  };
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

// ボイドからコア1個を、選択した自分のスピリット/アルティメットに置く（強制 minTotal=1）。
const voidPlaceOneEffect: Effect = {
  timing: { kind: "phase", step: "main", subPhase: "start" },
  steps: [
    {
      action: {
        kind: "core_distribute",
        from: { kind: "void", player: "self" },
        to: {
          kind: "filter",
          player: "self",
          filter: { category: ["spirit", "ultimate"] },
          count: "all",
        },
        amount: 1,
        mode: "player_choice",
        minTotal: 1,
      },
    },
  ],
};

const voidCoreMoveToFieldCardEffect: Effect = {
  timing: { kind: "phase", step: "main", subPhase: "start" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "void", player: "self" },
        to: {
          kind: "field_card",
          player: "self",
          filter: { tribes: ["target"] },
        },
        amount: 1,
      },
    },
  ],
};

describe("core_distribute player_choice: from=void", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("from=void で pendingCoreDistribution が生成される (fromKind='void')", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    registerDef(hostDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const s1 = makeInstance(hostDef, { instanceId: "sp1" });
    const s2 = makeInstance(hostDef, { instanceId: "sp2" });
    const state = makeState([host, s1, s2]);

    const result = executeEffect({
      chainId: "test:core-distribute-void-source:143",
      state,
      effect: voidPlaceOneEffect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    const pending = result.pendingCoreDistribution!;
    expect(pending.fromKind).toBe("void");
    expect(pending.minTotal).toBe(1);
    // ボイドは要求量 (amount=1) と実ボイド残数の小さい方を配分可能総数とする
    expect(pending.totalNormalCores).toBe(1);
    expect(pending.hasSoulCore).toBe(false);
    // 候補は自分の全スピリット/アルティメット（host 含む）
    expect(pending.candidates.map((c) => c.instanceId).sort()).toEqual([
      "host",
      "sp1",
      "sp2",
    ]);
  });

  it("resolve でボイドから選択カードへコアが置かれ、void は減り reserve/trash は減らない", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    registerDef(hostDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const s1 = makeInstance(hostDef, { instanceId: "sp1" });
    const state = makeState([host, s1], { reserve: 2, trash: 3 });

    const result = executeEffect({
      chainId: "test:core-distribute-void-source:173",
      state,
      effect: voidPlaceOneEffect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;
    expect(cdAction).toBeDefined();
    if (cdAction.kind === "resolve_pending_core_distribution") {
      expect(cdAction.fromKind).toBe("void");
    }

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      coreDistributionAllocations: { sp1: 1 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const sp1 = applied.state.cardInstances.find(
      (c) => c.instanceId === "sp1"
    )!;
    // sp1 は元 1 コア + ボイドから 1 = 2
    expect(sp1.normalCoreCount).toBe(2);
    expect(sp1.everHadCorePlaced).toBe(true);
    expect(
      applied.state.cardInstances.find((c) => c.instanceId === "host")!
        .everHadCorePlaced
    ).toBe(false);
    const alice = applied.state.players.find((p) => p.id === ALICE)!;
    // ボイド源は voidNormalCoreCount を減算し、reserve/trash カウンタは不変
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.trashNormalCoreCount).toBe(3);
    expect(alice.voidNormalCoreCount).toBe(
      state.players.find((p) => p.id === ALICE)!.voidNormalCoreCount - 1
    );
  });

  it("候補が 0 体（自分のスピリットなし）なら pending を生成せず state 不変", () => {
    const hostDef = makeDef({ cardNo: "HOST", printedCategory: "nexus" });
    registerDef(hostDef);
    // ネクサスのみ（category spirit/ultimate に一致しない）
    const host = makeInstance(hostDef, { instanceId: "host" });
    const state = makeState([host]);

    const result = executeEffect({
      chainId: "test:core-distribute-void-source:228",
      state,
      effect: voidPlaceOneEffect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).toBeNull();
  });

  it("core_move void→field_card の単一候補 fallback は core-system 経由で everHadCorePlaced を立てる", () => {
    const hostDef = makeDef({ cardNo: "HOST", tribe: "source" });
    const targetDef = makeDef({ cardNo: "TARGET", tribe: "target" });
    registerDef(hostDef);
    registerDef(targetDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const target = makeInstance(targetDef, {
      instanceId: "target",
      everHadCorePlaced: false,
    });
    const state = makeState([host, target]);

    const result = executeEffect({
      chainId: "test:core-distribute-void-source:251",
      state,
      effect: voidCoreMoveToFieldCardEffect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).toBeNull();
    const targetAfter = result.cardInstances.find(
      (c) => c.instanceId === "target"
    )!;
    expect(targetAfter.normalCoreCount).toBe(2);
    expect(targetAfter.everHadCorePlaced).toBe(true);
    expect(
      result.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
    ).toBe(state.players.find((p) => p.id === ALICE)!.voidNormalCoreCount - 1);
  });

  it("void + 後続 draw step: continuation で resolve 後にドローが走る", () => {
    const hostDef = makeDef({ cardNo: "HOST_MULTI" });
    registerDef(hostDef);
    const twoStep: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "distribute",
          action: {
            kind: "core_distribute",
            from: { kind: "void", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { category: ["spirit", "ultimate"] },
              count: "all",
            },
            amount: 1,
            mode: "player_choice",
            minTotal: 1,
          },
        },
        { id: "draw_step", action: { kind: "draw", count: 1 } },
      ],
    };
    hostDef.effects = [twoStep];
    const host = makeInstance(hostDef, { instanceId: "host" });
    const state = makeState([host], { deck: 5 });

    const result = executeEffect({
      chainId: "test:core-distribute-void-source:299",
      state,
      effect: twoStep,
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution!.continuation?.resumeStepIndex).toBe(
      1
    );

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    const aliceBefore = state.players.find((p) => p.id === ALICE)!;
    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: { host: 1 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const aliceAfter = applied.state.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.handCount).toBe(aliceBefore.handCount + 1);
    expect(aliceAfter.deckCount).toBe(aliceBefore.deckCount - 1);
    expect(aliceAfter.voidNormalCoreCount).toBe(
      aliceBefore.voidNormalCoreCount - 1
    );
  });
});

describe("BSTH09.2-転醒R03(B) 龍神: 転醒時ボイドコア配置 + ドロー", () => {
  const BACK = BSTH09_2_CARDS.find(
    (c) => c.cardNo === "BSTH09.2-転醒R03(A)"
  )!.backFace!;
  // backFace を独立した CardDefinition として登録（cardNo はB面）。
  const backDef: CardDefinition = {
    ...(makeDef() as CardDefinition),
    ...(BACK as Partial<CardDefinition>),
    cardNo: "BSTH09.2-転醒R03(B)",
  } as CardDefinition;

  beforeEach(() => {
    defRegistry.clear();
  });

  it("転醒時効果 [2,3] が void core_distribute(player_choice) + draw を構成する", () => {
    const rebirthEffect = backDef.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event?: string }).event === "rebirth"
    )!;
    expect(rebirthEffect).toBeDefined();
    expect(rebirthEffect.stub).toBeUndefined();
    const kinds = rebirthEffect.steps.map((s) => s.action.kind);
    expect(kinds).toEqual(["core_distribute", "draw"]);
    const cd = rebirthEffect.steps[0]!.action as {
      kind: string;
      from: { kind: string };
      mode?: string;
      minTotal?: number;
    };
    expect(cd.from.kind).toBe("void");
    expect(cd.mode).toBe("player_choice");
    expect(cd.minTotal).toBe(1);
  });

  it("龍神(B面) の転醒時効果を実行するとボイドコア配置 pending + 後続ドローが走る", () => {
    registerDef(backDef);
    const self = createCardInstance(backDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    self.instanceId = "ryujin";
    const ally = createCardInstance(backDef, {
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    ally.instanceId = "ally";
    const state = makeState([self, ally], { deck: 5 });

    const rebirthEffect = backDef.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event?: string }).event === "rebirth"
    )!;
    const rebirthIndex = backDef.effects!.indexOf(rebirthEffect);

    const result = executeEffect({
      chainId: "test:core-distribute-void-source:400",
      state,
      effect: rebirthEffect,
      effectIndex: rebirthIndex,
      sourceInstanceId: "ryujin",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution!.fromKind).toBe("void");

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    const aliceBefore = state.players.find((p) => p.id === ALICE)!;
    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: { ally: 1 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const allyAfter = applied.state.cardInstances.find(
      (c) => c.instanceId === "ally"
    )!;
    expect(allyAfter.normalCoreCount).toBe(2); // 1 + ボイドから 1
    const aliceAfter = applied.state.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.handCount).toBe(aliceBefore.handCount + 1);
    expect(aliceAfter.deckCount).toBe(aliceBefore.deckCount - 1);
  });
});
