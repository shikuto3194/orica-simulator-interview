/**
 * フィールドカード効果の「宣言された 1 効果のみ解決」回帰テスト。
 *
 * バグ (2026-06-06): BSTH01-X04【フォーオブアカインド】は activated/flash 効果を 2 つ持つ。
 *   - effect[0]: 1コスト払い BP10000以下破壊 (conditional_cost)
 *   - effect[1]: フォーオブアカインド本体 (per_card_name turn + per_instance game)
 * deferred 解決が `targetEffectIndex` を field 効果に設定していなかったため、effect[1] を
 * 発揮しても effectTimingFilter("flash") に一致する **両効果が束ねて実行**され、effect[0] の
 * conditional_cost 不発が共有 recordedUsage ラベル "spirit:1" を払い戻し、使用回数が消えて
 * 同ターン中に再発揮できてしまった。
 *
 * 修正: 宣言された registration の DSL effectIndex を `targetEffectIndex` として解決へ渡し、
 * 当該 1 効果のみ実行する。本テストは targetEffectIndex の有無で挙動が変わることを
 * ネガティブコントロール付きで固定する。
 */
import { describe, it, expect } from "vitest";
import { BSTH01_CARDS } from "../../card-data/src/cards/BSTH01";
import { resolveDeferredFieldEffectStack } from "../src/card/card-effect-system";
import { generateFieldCardEffectRegistrations } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { recordEffectUsageIfLimited } from "../src/legal/legal-actions-shared";
import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  EffectUsageLimit,
  GameState,
} from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

const FRANDOLLE_CARD = BSTH01_CARDS.find((c) => c.cardNo === "BSTH01-X04")!;

const fillerDef: CardDefinition = {
  cardNo: "FILLER",
  name: "Filler",
  printedCategory: "magic",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "紅魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

const defRegistry = new Map<string, CardDefinition>([
  [FRANDOLLE_CARD.cardNo, FRANDOLLE_CARD],
  [fillerDef.cardNo, fillerDef],
]);
const getCardDefinitionById = (id: string) => defRegistry.get(id);

const DUAL_LIMIT: EffectUsageLimit[] = [
  { kind: "per_card_name", duration: "turn" },
  { kind: "per_instance", duration: "game" },
];

/** フォーオブアカインドを host として field に置き、effect[1] 発動条件を満たす盤面を作る。 */
function makeBoard(): { state: GameState; hostId: string } {
  const host = createCardInstance(FRANDOLLE_CARD, {
    instanceId: "host-flandre",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 3, // Lv2
  });
  const deckCards: CardInstance[] = [];
  for (let i = 0; i < 5; i++) {
    deckCards.push(
      createCardInstance(fillerDef, {
        instanceId: `filler-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
        cores: 0,
      })
    );
  }

  const baseState = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, ...deckCards],
    startingLife: 5,
  });
  const state: GameState = {
    ...baseState,
    activePlayerId: ALICE,
    turnNumber: 6,
    step: "attack",
    players: baseState.players.map((p) =>
      p.id === ALICE ? { ...p, reserveNormalCoreCount: 3, deckCount: 5 } : p
    ),
  };
  return { state, hostId: host.instanceId };
}

/** field_card_effect の deferred 解決を表す ActiveStack を作る (宣言済み = recordedUsage 記録済み)。 */
function makeActiveStack(hostId: string): ActiveStack {
  return {
    stackId: "stack:test",
    actionKind: "field_card_effect",
    chainId: "effect:6:player-1:attack:spirit:host-flandre",
    actingPlayerId: ALICE,
    cardInstanceId: hostId,
    cardDefinitionId: FRANDOLLE_CARD.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    fieldEffectSourceKind: "spirit",
    chosenTiming: "flash",
    fieldEffectRegistrationIndex: 1,
    recordedUsage: { effectLabel: "spirit:1", usageLimit: DUAL_LIMIT },
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  } as ActiveStack;
}

/** 宣言時に記録される usageLimit ("spirit:1") を state に焼き込む。 */
function withRecordedUsage(state: GameState, hostId: string): GameState {
  return recordEffectUsageIfLimited({
    state,
    sourceInstanceId: hostId,
    sourceDefinitionId: FRANDOLLE_CARD.cardNo,
    effectLabel: "spirit:1",
    usageLimit: DUAL_LIMIT,
  });
}

const RESOLVE_DEPS = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
} as const;

describe("フィールドカード効果: 登録は DSL effectIndex を保持する", () => {
  it("BSTH01-X04 の 2 つの activated/flash 効果は effectIndex 0/1 を持つ", () => {
    const regs = generateFieldCardEffectRegistrations(FRANDOLLE_CARD);
    expect(regs).toHaveLength(2);
    expect(regs[0]!.effectIndex).toBe(0); // 破壊効果
    expect(regs[1]!.effectIndex).toBe(1); // フォーオブアカインド本体 (usageLimit 持ち)
    expect(regs[1]!.usageLimit).toBeDefined();
  });
});

describe("フィールドカード効果: targetEffectIndex で宣言された 1 効果のみ解決", () => {
  it("修正後: effect[1] のみ発火し、束ねられた effect[0] は走らず usageLimit も払い戻されない", () => {
    const { state: board, hostId } = makeBoard();
    const state = withRecordedUsage(board, hostId);
    expect(state.effectUsageRecords).toHaveLength(2); // 宣言時 turn + game

    const resolved = resolveDeferredFieldEffectStack({
      state,
      activeStack: makeActiveStack(hostId),
      ...RESOLVE_DEPS,
      targetEffectIndex: 1, // ← 修正の核心: 宣言された effect のみ実行
    });

    // effect[1] のみが発火 (effect[0] 破壊は束ねられない)
    const activated = resolved.flashEffectActivationLog
      .filter((e) => e.sourceInstanceId === hostId)
      .map((e) => e.effectIndex);
    expect(activated).toContain(1);
    expect(activated).not.toContain(0);

    // usageLimit が払い戻されず残っている (再発揮不可)
    const spirit1Records = resolved.effectUsageRecords.filter(
      (r) => r.effectLabel === "spirit:1" && r.sourceInstanceId === hostId
    );
    expect(spirit1Records).toHaveLength(2);
  });

  it("ネガティブコントロール (修正前挙動): targetEffectIndex 無しだと effect[0] も束ねて発火する", () => {
    const { state: board, hostId } = makeBoard();
    const state = withRecordedUsage(board, hostId);

    const resolved = resolveDeferredFieldEffectStack({
      state,
      activeStack: {
        ...makeActiveStack(hostId),
        payCostPaymentSources: [
          { kind: "reserve", amount: 1, includeSoulCore: false },
        ],
      },
      ...RESOLVE_DEPS,
      // targetEffectIndex を渡さない = 旧挙動 (effectTimingFilter のみ → 全 flash 効果)
    });

    const activated = resolved.flashEffectActivationLog
      .filter((e) => e.sourceInstanceId === hostId)
      .map((e) => e.effectIndex);
    // 束ね実行: effect[0] (破壊) も effect[1] も発火してしまう
    expect(activated).toContain(0);
    expect(activated).toContain(1);
  });
});
