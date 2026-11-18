/**
 * engine-deck-derived-clone-spirit: デッキ上から裏向きでフィールドに置き固定スタット
 * ブロックの分身スピリットとして扱う primitive の単体機能テスト
 * (BSAZ01-C12「戦力投入」/BSAZ02-C07「ステイギス」)。
 *
 * 検証範囲:
 * - デッキ上から N 枚まで裏向きでフィールドに置き、フィールド/リザーブのコアを
 *   1個以上配分 → act_as_spirit (static_copy) 登録でカード名/コスト/系統/Lv/BP/色の
 *   完全固定スタットブロックとして扱われる (getEffectiveCardName/Cost/Tribe/Bp/Colors)。
 * - BSAZ01-C12 はメイン効果の末尾で自身をフィールドに置く (move_self)。
 * - 分身スピリットの discard_on_leave 制約: bounce (手札へ戻る) / move_card
 *   (デッキへ戻る) の双方でトラッシュへ強制リダイレクトされる (07b §5 分身裁定)。
 */
import { describe, it, expect } from "vitest";
import { BSAZ01_CARDS } from "../../card-data/src/cards/BSAZ01";
import { BSAZ02_CARDS } from "../../card-data/src/cards/BSAZ02";
import { executeEffect as executeEffectRaw } from "../src/effect/effect-interpreter";
import { executeBounce } from "../src/effect/structured-zone-ops";
import { executeMoveCard } from "../src/effect/native-move-core-handlers";
import { flushPendingLeaves } from "../src/state-based-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { createStepExecutionContext } from "../src/step-execution-context";
import { getEffectiveBp, getEffectiveLevel } from "../src/battle/battle-shared";
import {
  getEffectiveCardName,
  getEffectiveCost,
  getEffectiveColors,
} from "../src/legal/legal-actions-shared";
import { getEffectiveTribe, isSpirit } from "../src/mechanics/act-as-spirit";
import {
  getAdventTargets,
  getContractAdventTargets,
} from "../src/mechanics/advent-system";
import type {
  AdventCondition,
  CardDefinition,
  CardInstance,
  GameState,
} from "../src/model";
import type { DSL } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

const C12_CARD = BSAZ01_CARDS.find((c) => c.cardNo === "BSAZ01-C12")!;
const C07_CARD = BSAZ02_CARDS.find((c) => c.cardNo === "BSAZ02-C07")!;

const fillerDef: CardDefinition = {
  cardNo: "FILLER-CLONE",
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

// 【煌臨】対象判定 (matchesAdventCondition) は targetDef.printedCategory を印字定義
// (裏向きカードの実体) から直読みするため、cannot_advent 除外テストには
// printedCategory:"spirit" のフィラーを使う (magic フィラーではカテゴリ不一致で
// そもそも対象外になり、cannot_advent の効果を検証できない)。
const spiritFillerDef: CardDefinition = {
  ...fillerDef,
  cardNo: "FILLER-CLONE-SPIRIT",
  printedCategory: "spirit",
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
};

// アルドノアドライブ under-card 用フィラー (deck-derived clone token の fillerDef と
// definitionId が衝突すると placed カード集合の length assertion が誤カウントするため分離)。
const aldnoahDriveFillerDef: CardDefinition = {
  ...fillerDef,
  cardNo: "FILLER-ALDNOAH-DRIVE",
};

const defRegistry = new Map<string, CardDefinition>([
  [C12_CARD.cardNo, C12_CARD],
  [C07_CARD.cardNo, C07_CARD],
  [fillerDef.cardNo, fillerDef],
  [spiritFillerDef.cardNo, spiritFillerDef],
  [aldnoahDriveFillerDef.cardNo, aldnoahDriveFillerDef],
]);
const getCardDefinitionById = (id: string) => defRegistry.get(id);

function chooseCloneCount(state: GameState, amount?: number): GameState {
  const pending = state.pendingCountSelection;
  if (!pending) return state;
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
  }).find((a) => a.kind === "resolve_pending_count_decrease")!;
  return applyLegalAction({
    state,
    action,
    getCardDefinitionById,
    countDecreaseSelection: amount ?? pending.max,
  }).state;
}

// 既存ケースは最大数を選び、枚数選択自体は下の 0/1 枚ケースで確認する。
function executeEffect(
  options: Parameters<typeof executeEffectRaw>[0]
): GameState {
  return chooseCloneCount(executeEffectRaw(options));
}

function buildDeckFillerState(opts: {
  hostDef: CardDefinition;
  hostZone: "hand" | "field";
  reserveCores?: number;
  deckCount?: number;
  hostCores?: number;
  deckCardDef?: CardDefinition;
}): { state: GameState; hostId: string } {
  const reserveCores = opts.reserveCores ?? 3;
  const deckCount = opts.deckCount ?? 5;
  const deckCardDef = opts.deckCardDef ?? fillerDef;
  const host = createCardInstance(opts.hostDef, {
    instanceId: "host",
    ownerPlayerId: ALICE,
    zone: opts.hostZone,
    cores: opts.hostCores ?? 0,
  });
  const deckCards: CardInstance[] = [];
  for (let i = 0; i < deckCount; i++) {
    deckCards.push(
      createCardInstance(deckCardDef, {
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
    players: baseState.players.map((p) =>
      p.id === ALICE
        ? { ...p, reserveNormalCoreCount: reserveCores, deckCount }
        : p
    ),
  };
  return { state, hostId: host.instanceId };
}

/**
 * engine-aldnoah-drive-under-card-keyword: BSAZ02-C07 effects[0] は【アルドノアドライブ：1】
 * の「あるとき、以下の効果を得る」ゲート (condition:self_under_card_count) 配下になった。
 * host の下に text_role アンダーカード (roleTag:"アルドノアドライブ") を1枚付与する。
 */
function attachAldnoahDriveUnderCard(
  state: GameState,
  hostId: string
): GameState {
  const underCardId = "aldnoah-drive-under";
  const underCard = createCardInstance(aldnoahDriveFillerDef, {
    instanceId: underCardId,
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: hostId,
  });
  return {
    ...state,
    cardInstances: [
      ...state.cardInstances.map((c) =>
        c.instanceId === hostId
          ? {
              ...c,
              underCards: [
                ...c.underCards,
                {
                  cardInstanceId: underCardId,
                  role: "text_role" as const,
                  roleTag: "アルドノアドライブ",
                },
              ],
            }
          : c
      ),
      underCard,
    ],
  };
}

/** pendingCoreDistribution を「候補全員へ1コアずつ」で解決する。 */
function resolvePendingCoreDistribution(
  afterEffect: GameState,
  actingPlayerId: string
): GameState {
  const pending = afterEffect.pendingCoreDistribution!;
  const allocations: Record<string, number> = {};
  for (const c of pending.candidates) allocations[c.instanceId] = 1;
  const actions = getLegalActions({
    state: afterEffect,
    actingPlayerId,
    getCardDefinitionById,
  });
  const cdAction = actions.find(
    (a) => a.kind === "resolve_pending_core_distribution"
  )!;
  const applied = applyLegalAction({
    state: afterEffect,
    action: cdAction,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    coreDistributionAllocations: allocations,
    coreDistributionSourceAllocations: { reserve: pending.candidates.length },
  });
  return applied.state;
}

describe("engine-deck-derived-clone-spirit: BSAZ01-C12「戦力投入」メイン効果", () => {
  it.each([0, 1])(
    "デッキの内容を選ばず %i 枚を選び、選んだ上のカードだけを分身にする",
    (count) => {
      const { state, hostId } = buildDeckFillerState({
        hostDef: C12_CARD,
        hostZone: "hand",
      });
      const effect = C12_CARD.effects!.find(
        (e) => e.timing.kind === "activated" && e.timing.mode === "main"
      )!;
      const pending = executeEffectRaw({
        chainId: "test:engine-deck-derived-clone-spirit:238",
        state,
        effect,
        sourceInstanceId: hostId,
        actingPlayerId: ALICE,
        getCardDefinitionById,
      });
      expect(pending.pendingCountSelection).toMatchObject({ min: 0, max: 3 });
      expect(
        pending.cardInstances.filter((c) => c.zone === "deck")
      ).toHaveLength(5);
      const chosen = chooseCloneCount(pending, count);
      const after = count
        ? resolvePendingCoreDistribution(chosen, ALICE)
        : chosen;
      expect(after.pendingCountSelection).toBeNull();
      expect(after.pendingCoreDistribution).toBeNull();
      expect(
        after.cardInstances
          .filter(
            (c) => c.definitionId === fillerDef.cardNo && c.zone === "field"
          )
          .map((c) => c.instanceId)
      ).toEqual(count ? ["filler-0"] : []);
      expect(
        after.cardInstances.find((c) => c.instanceId === hostId)?.zone
      ).toBe("field");
      if (count)
        expect(
          isSpirit(
            after.cardInstances.find((c) => c.instanceId === "filler-0")!,
            after,
            getCardDefinitionById
          )
        ).toBe(true);
      expect(after.players[0]!.deckCount).toBe(5 - count);
    }
  );
  it("デッキ上3枚を裏向きでフィールドに置き、コア配分後「アレイオン」固定スタットで分身スピリット化+自己配置", () => {
    const { state, hostId } = buildDeckFillerState({
      hostDef: C12_CARD,
      hostZone: "hand",
    });
    const mainEffect = C12_CARD.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "main"
    )!;
    const effectIndex = C12_CARD.effects!.indexOf(mainEffect);

    const afterEffect = executeEffect({
      chainId: "test:engine-deck-derived-clone-spirit:286",
      state,
      effect: mainEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    // デッキ上3枚が裏向きでフィールドへ
    const placed = afterEffect.cardInstances.filter(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    );
    expect(placed).toHaveLength(3);
    expect(placed.every((c) => c.faceDown)).toBe(true);

    const resolved = resolvePendingCoreDistribution(afterEffect, ALICE);

    for (const token of resolved.cardInstances.filter((c) =>
      placed.some((p) => p.instanceId === c.instanceId)
    )) {
      expect(token.normalCoreCount).toBeGreaterThanOrEqual(1);
      expect(isSpirit(token, resolved, getCardDefinitionById)).toBe(true);
      expect(
        getEffectiveCardName(resolved, token, fillerDef, getCardDefinitionById)
      ).toBe("アレイオン");
      expect(
        getEffectiveCost(resolved, token, fillerDef, getCardDefinitionById)
      ).toBe(3);
      expect(
        getEffectiveTribe(resolved, token, fillerDef, getCardDefinitionById)
      ).toBe("地球・ＣＦ");
      expect(
        getEffectiveBp(resolved, token, fillerDef, getCardDefinitionById)
      ).toBe(2000);
      expect(
        getEffectiveLevel(resolved, token, fillerDef, getCardDefinitionById)
      ).toBe(1);
      expect(getEffectiveColors(resolved, token, fillerDef)).toEqual([
        "yellow",
      ]);
    }

    // 「その後、このカードをフィールドに置く」: 戦力投入本体が field へ自己配置される
    const hostAfter = resolved.cardInstances.find(
      (c) => c.instanceId === hostId
    )!;
    expect(hostAfter.zone).toBe("field");
  });
});

describe("engine-deck-derived-clone-spirit: BSAZ02-C07「ステイギス」召喚時トリガー", () => {
  it("【アルドノアドライブ：1】が下にあるとき、デッキ上2枚を裏向きでフィールドに置き「スティギス」固定スタットで分身スピリット化(白)", () => {
    const built = buildDeckFillerState({
      hostDef: C07_CARD,
      hostZone: "field",
      deckCount: 4,
      hostCores: 1,
    });
    const state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const summonEffect = C07_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = C07_CARD.effects!.indexOf(summonEffect);

    const afterEffect = executeEffect({
      chainId: "test:engine-deck-derived-clone-spirit:352",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    const placed = afterEffect.cardInstances.filter(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    );
    expect(placed).toHaveLength(2);
    expect(placed.every((c) => c.faceDown)).toBe(true);

    const resolved = resolvePendingCoreDistribution(afterEffect, ALICE);
    const token = resolved.cardInstances.find(
      (c) => c.instanceId === placed[0]!.instanceId
    )!;
    expect(
      getEffectiveCardName(resolved, token, fillerDef, getCardDefinitionById)
    ).toBe("スティギス");
    expect(getEffectiveColors(resolved, token, fillerDef)).toEqual(["white"]);
    expect(
      getEffectiveTribe(resolved, token, fillerDef, getCardDefinitionById)
    ).toBe("火星・アルドノア");
  });

  it("【アルドノアドライブ：1】が下に無いとき、召喚時トリガーは発揮されない (condition:self_under_card_count ゲート)", () => {
    const { state, hostId } = buildDeckFillerState({
      hostDef: C07_CARD,
      hostZone: "field",
      deckCount: 4,
      hostCores: 1,
    });
    const summonEffect = C07_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = C07_CARD.effects!.indexOf(summonEffect);

    const afterEffect = executeEffect({
      chainId: "test:engine-deck-derived-clone-spirit:392",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    const placed = afterEffect.cardInstances.filter(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    );
    expect(placed).toHaveLength(0);
  });

  it("フラッシュ『お互いのアタックステップ』〔ターンに1回:同名〕手札のこのカードは召喚できる (effects[1] 実装済)", () => {
    const flashEffect = C07_CARD.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
    )!;
    expect(flashEffect.stub).toBeUndefined();
    expect(flashEffect.applicability?.zone).toBe("hand");
    expect(flashEffect.timingScope).toEqual({
      player: "both",
      period: "attack",
    });
    expect(flashEffect.steps).toEqual([
      { action: { kind: "summon", target: { kind: "self" } } },
    ]);
  });

  it("C07 は effects 全件が実装済 (残 stub 無し)", () => {
    expect(C07_CARD.effects!.every((e) => e.stub === undefined)).toBe(true);
  });

  it("分身スピリット2体に「このスピリットによって相手のライフは減らない」を付与する (life_damage_interception attackerSelectedTarget)", () => {
    const built = buildDeckFillerState({
      hostDef: C07_CARD,
      hostZone: "field",
      deckCount: 4,
      hostCores: 1,
    });
    const state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const summonEffect = C07_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = C07_CARD.effects!.indexOf(summonEffect);

    const afterEffect = executeEffect({
      chainId: "test:engine-deck-derived-clone-spirit:440",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const placed = afterEffect.cardInstances.filter(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    );
    expect(placed).toHaveLength(2);

    const resolved = resolvePendingCoreDistribution(afterEffect, ALICE);
    const ce = resolved.activeContinuousEffects.find(
      (e) => e.modifierTag === "life_damage_interception"
    );
    expect(ce).toBeDefined();
    const attackerInstanceIds = (
      ce!.metadata as { attackerInstanceIds?: string[] }
    ).attackerInstanceIds;
    expect(attackerInstanceIds).toEqual(
      expect.arrayContaining(placed.map((p) => p.instanceId))
    );
    expect(attackerInstanceIds).toHaveLength(2);
  });
});

describe("engine-deck-derived-clone-spirit: discard_on_leave (07b §5 分身裁定)", () => {
  function setupSingleToken(): { state: GameState; tokenId: string } {
    const { state, hostId } = buildDeckFillerState({
      hostDef: C12_CARD,
      hostZone: "hand",
      deckCount: 1,
    });
    const mainEffect = C12_CARD.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "main"
    )!;
    const effectIndex = C12_CARD.effects!.indexOf(mainEffect);
    const afterEffect = executeEffect({
      chainId: "test:engine-deck-derived-clone-spirit:479",
      state,
      effect: mainEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const resolved = resolvePendingCoreDistribution(afterEffect, ALICE);
    const token = resolved.cardInstances.find(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    )!;
    return { state: resolved, tokenId: token.instanceId };
  }

  it("bounce (手札へ戻る効果) はトラッシュへ強制リダイレクトされる (手札には戻らない)", () => {
    const { state, tokenId } = setupSingleToken();
    const beforeHandCount = state.players.find(
      (p) => p.id === ALICE
    )!.handCount;

    const action: DSL.BounceAction = {
      kind: "bounce",
      target: {
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"] },
        count: 1,
      },
    };
    const queued = executeBounce(
      state,
      ALICE,
      action,
      getCardDefinitionById,
      "dsl-unknown",
      [tokenId]
    );
    const next = flushPendingLeaves(queued, getCardDefinitionById);

    const token = next.cardInstances.find((c) => c.instanceId === tokenId)!;
    expect(token.zone).toBe("trash");
    expect(token.faceDown).toBe(false);
    const afterHandCount = next.players.find((p) => p.id === ALICE)!.handCount;
    expect(afterHandCount).toBe(beforeHandCount);
  });

  it("move_card (デッキへ戻る効果) もトラッシュへ強制リダイレクトされる (デッキへは戻らない)", () => {
    const { state, tokenId } = setupSingleToken();
    const beforeDeckCount = state.players.find(
      (p) => p.id === ALICE
    )!.deckCount;

    const action: DSL.MoveCardAction = {
      kind: "move_card",
      target: {
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"] },
        count: 1,
      },
      from: { zone: "field", player: "self" },
      to: { zone: "deck", player: "self", position: "top" },
      count: 1,
    };
    const stepCtx = createStepExecutionContext(state);
    const queued = executeMoveCard(
      action,
      state,
      ALICE,
      "dsl-unknown",
      getCardDefinitionById,
      stepCtx,
      [tokenId]
    );
    const next = flushPendingLeaves(queued, getCardDefinitionById);

    const token = next.cardInstances.find((c) => c.instanceId === tokenId)!;
    expect(token.zone).toBe("trash");
    expect(token.faceDown).toBe(false);
    const afterDeckCount = next.players.find((p) => p.id === ALICE)!.deckCount;
    expect(afterDeckCount).toBe(beforeDeckCount);
  });
});

describe("engine-deck-derived-clone-spirit: cannot_advent (BSAZ02-C07固有、07b §5「煌臨できず」)", () => {
  it("BSAZ02-C07の分身スピリットは煌臨先候補から除外される (BSAZ01-C12は対象外の制約)", () => {
    const built = buildDeckFillerState({
      hostDef: C07_CARD,
      hostZone: "field",
      deckCount: 2,
      hostCores: 1,
      deckCardDef: spiritFillerDef,
    });
    const state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const summonEffect = C07_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = C07_CARD.effects!.indexOf(summonEffect);
    const afterEffect = executeEffect({
      chainId: "test:engine-deck-derived-clone-spirit:579",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const resolved = resolvePendingCoreDistribution(afterEffect, ALICE);
    const token = resolved.cardInstances.find(
      (c) => c.zone === "field" && c.definitionId === spiritFillerDef.cardNo
    )!;
    expect(token).toBeDefined();

    const adventCondition: AdventCondition = {
      targetCategory: ["spirit"],
    };
    const targets = getAdventTargets(
      resolved,
      ALICE,
      {
        adventCondition,
        adventTiming: "both_attack_step",
        soulCoreDest: "trash",
      },
      getCardDefinitionById
    );
    expect(targets.some((c) => c.instanceId === token.instanceId)).toBe(false);
  });

  it("魂状態(契約煌臨候補)経由でも除外される (getContractAdventTargets は matchesAdventCondition を通らない別経路)", () => {
    const built = buildDeckFillerState({
      hostDef: C07_CARD,
      hostZone: "field",
      deckCount: 2,
      hostCores: 1,
      deckCardDef: spiritFillerDef,
    });
    const state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const summonEffect = C07_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = C07_CARD.effects!.indexOf(summonEffect);
    const afterEffect = executeEffect({
      chainId: "test:engine-deck-derived-clone-spirit:623",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const resolved = resolvePendingCoreDistribution(afterEffect, ALICE);
    const token = resolved.cardInstances.find(
      (c) => c.zone === "field" && c.definitionId === spiritFillerDef.cardNo
    )!;

    // トークンを魂状態の契約カード候補として扱う (isPlayersContractCard を満たす)。
    const soulState: GameState = {
      ...resolved,
      players: resolved.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              soulStateInstanceIds: [token.instanceId],
              contractCardNo: spiritFillerDef.cardNo,
            }
          : p
      ),
    };

    const targets = getContractAdventTargets(
      soulState,
      ALICE,
      {
        adventCondition: { targetCategory: ["spirit"] },
        adventTiming: "both_attack_step",
        soulCoreDest: "trash",
        adventVariant: "contract",
      },
      getCardDefinitionById
    );
    expect(targets.some((c) => c.instanceId === token.instanceId)).toBe(false);
  });
});
