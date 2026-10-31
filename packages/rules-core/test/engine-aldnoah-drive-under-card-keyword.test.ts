/**
 * engine-aldnoah-drive-under-card-keyword: 【アルドノアドライブ：N】host 下カード配置
 * primitive の単体機能テスト。
 *
 * 検証範囲:
 * - CardFilter.declaresUnderCardSlot (印字属性、cardDeclaresUnderCardSlot SSOT)。
 * - ConditionClause.self_under_card_count (「あるとき」ゲート、evaluateConditionClause)。
 * - place_text_role_under_card (BSAZ02-C10「アルドノアドライブ」下カード配置。手札/フィールド
 *   いずれの発動元でも host の下へ text_role アンダーカードとして置く。host 側枠数は
 *   CardDefinition.underCardSlots 経由で解決し、満杯/host不在は no-op)。
 * - BSAZ02-C10 の game_event 誘発効果 (配置→ドロー→ボイドからコア1個、ref_succeeded ゲート)。
 */
import { describe, expect, it } from "vitest";
import { BSAZ02_CARDS } from "../../card-data/src/cards/BSAZ02";
import {
  createCardInstance,
  createEmptyGameState,
  initializeGame,
} from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executePlaceTextRoleUnderCard } from "../src/effect/native-under-card-placement-handlers";
import { createStepExecutionContext } from "../src/step-execution-context";
import {
  matchesCardFilterByDef,
  cardDeclaresUnderCardSlot,
} from "../src/card/card-filter";
import { evaluateConditionClause } from "../src/effect/structured-condition-eval";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { getAvailableBraveCombineLegalActions } from "../src/legal/legal-actions-availability";
import { hasCannotCombineRestriction } from "../src/mechanics/act-as-spirit";
import { flushPendingLeaves } from "../src/state-based-actions";
import { playSummonAsAction } from "../src/play/play-card-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type {
  CardDefinition,
  GameState,
  PendingLeaveEntity,
} from "../src/model";
import type { DSL } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

const C07_CARD = BSAZ02_CARDS.find((c) => c.cardNo === "BSAZ02-C07")!;
const C10_CARD = BSAZ02_CARDS.find((c) => c.cardNo === "BSAZ02-C10")!;

const noSlotFiller: CardDefinition = {
  cardNo: "FILLER-NO-SLOT",
  name: "フィラー",
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

const defRegistry = new Map<string, CardDefinition>([
  [C07_CARD.cardNo, C07_CARD],
  [C10_CARD.cardNo, C10_CARD],
  [noSlotFiller.cardNo, noSlotFiller],
]);
const getCardDefinitionById = (id: string) => defRegistry.get(id);

describe("engine-aldnoah-drive-under-card-keyword: CardFilter.declaresUnderCardSlot", () => {
  it("underCardSlots に roleTag が宣言されているカードのみマッチする", () => {
    expect(cardDeclaresUnderCardSlot(C07_CARD, "アルドノアドライブ")).toBe(
      true
    );
    expect(cardDeclaresUnderCardSlot(noSlotFiller, "アルドノアドライブ")).toBe(
      false
    );
    expect(
      matchesCardFilterByDef(C07_CARD, {
        declaresUnderCardSlot: "アルドノアドライブ",
      })
    ).toBe(true);
    expect(
      matchesCardFilterByDef(noSlotFiller, {
        declaresUnderCardSlot: "アルドノアドライブ",
      })
    ).toBe(false);
  });
});

describe("engine-aldnoah-drive-under-card-keyword: ConditionClause.self_under_card_count", () => {
  function buildHostState(underCount: number): {
    state: GameState;
    hostId: string;
  } {
    const host = createCardInstance(C07_CARD, {
      instanceId: "host",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const unders = Array.from({ length: underCount }, (_, i) =>
      createCardInstance(noSlotFiller, {
        instanceId: `under-${i}`,
        ownerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: host.instanceId,
      })
    );
    const hostWithUnders = {
      ...host,
      underCards: unders.map((u) => ({
        cardInstanceId: u.instanceId,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      })),
    };
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [hostWithUnders, ...unders],
    });
    return { state, hostId: host.instanceId };
  }

  it("下に1枚以上あれば true (minCount 省略時1)", () => {
    const { state, hostId } = buildHostState(1);
    expect(
      evaluateConditionClause(
        state,
        { kind: "self_under_card_count", roleTag: "アルドノアドライブ" },
        hostId,
        ALICE,
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("下に無ければ false", () => {
    const { state, hostId } = buildHostState(0);
    expect(
      evaluateConditionClause(
        state,
        { kind: "self_under_card_count", roleTag: "アルドノアドライブ" },
        hostId,
        ALICE,
        getCardDefinitionById
      )
    ).toBe(false);
  });
});

describe("engine-aldnoah-drive-under-card-keyword: place_text_role_under_card", () => {
  function buildScene(opts: {
    placedZone: "hand" | "field";
    hostUnderCount?: number;
  }): { state: GameState; hostId: string; placedId: string } {
    const host = createCardInstance(C07_CARD, {
      instanceId: "host",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const placed = createCardInstance(C10_CARD, {
      instanceId: "placed",
      ownerPlayerId: ALICE,
      zone: opts.placedZone,
      cores: opts.placedZone === "field" ? 1 : 0,
    });
    const existingUnderCount = opts.hostUnderCount ?? 0;
    const existingUnders = Array.from({ length: existingUnderCount }, (_, i) =>
      createCardInstance(noSlotFiller, {
        instanceId: `existing-under-${i}`,
        ownerPlayerId: ALICE,
        zone: "field",
        attachedToInstanceId: host.instanceId,
      })
    );
    const hostWithUnders = {
      ...host,
      underCards: existingUnders.map((u) => ({
        cardInstanceId: u.instanceId,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      })),
    };
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [hostWithUnders, placed, ...existingUnders],
    });
    const state: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? { ...p, handCount: opts.placedZone === "hand" ? 1 : 0 }
          : p
      ),
    };
    return { state, hostId: host.instanceId, placedId: placed.instanceId };
  }

  const action: DSL.PlaceTextRoleUnderCardAction = {
    kind: "place_text_role_under_card",
    hostTarget: { kind: "trigger_related_instance" },
    roleTag: "アルドノアドライブ",
    fallbackMaxCount: 1,
  };

  it("手札のこのカードを host の下へ表向きで置き、手札枚数を減らす", () => {
    const { state, hostId, placedId } = buildScene({ placedZone: "hand" });
    const stepCtx = createStepExecutionContext(state);
    stepCtx.triggerRelatedInstanceId = hostId;
    const next = executePlaceTextRoleUnderCard(
      action,
      state,
      ALICE,
      placedId,
      getCardDefinitionById,
      stepCtx
    );
    const placedCard = next.cardInstances.find(
      (c) => c.instanceId === placedId
    )!;
    expect(placedCard.zone).toBe("field");
    expect(placedCard.attachedToInstanceId).toBe(hostId);
    expect(placedCard.faceDown).toBe(false);
    const hostCard = next.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(
      hostCard.underCards.some(
        (u) =>
          u.cardInstanceId === placedId && u.roleTag === "アルドノアドライブ"
      )
    ).toBe(true);
    expect(next.players.find((p) => p.id === ALICE)!.handCount).toBe(0);
  });

  it("フィールド (スピリット状態) のこのカードを host の下へ移し、手札枚数は変わらない", () => {
    const { state, hostId, placedId } = buildScene({ placedZone: "field" });
    const stepCtx = createStepExecutionContext(state);
    stepCtx.triggerRelatedInstanceId = hostId;
    const next = executePlaceTextRoleUnderCard(
      action,
      state,
      ALICE,
      placedId,
      getCardDefinitionById,
      stepCtx
    );
    const placedCard = next.cardInstances.find(
      (c) => c.instanceId === placedId
    )!;
    expect(placedCard.zone).toBe("field");
    expect(placedCard.attachedToInstanceId).toBe(hostId);
    expect(next.players.find((p) => p.id === ALICE)!.handCount).toBe(0);
  });

  it("host の枠 (underCardSlots maxCount) が満杯なら no-op", () => {
    const { state, hostId, placedId } = buildScene({
      placedZone: "hand",
      hostUnderCount: 1,
    });
    const stepCtx = createStepExecutionContext(state);
    stepCtx.triggerRelatedInstanceId = hostId;
    const next = executePlaceTextRoleUnderCard(
      action,
      state,
      ALICE,
      placedId,
      getCardDefinitionById,
      stepCtx
    );
    const placedCard = next.cardInstances.find(
      (c) => c.instanceId === placedId
    )!;
    expect(placedCard.zone).toBe("hand");
    expect(placedCard.attachedToInstanceId).toBeNull();
  });

  it("host が未解決 (trigger_related_instance 不一致) なら no-op", () => {
    const { state, placedId } = buildScene({ placedZone: "hand" });
    const stepCtx = createStepExecutionContext(state);
    // triggerRelatedInstanceId 未設定
    const next = executePlaceTextRoleUnderCard(
      action,
      state,
      ALICE,
      placedId,
      getCardDefinitionById,
      stepCtx
    );
    const placedCard = next.cardInstances.find(
      (c) => c.instanceId === placedId
    )!;
    expect(placedCard.zone).toBe("hand");
  });
});

describe("engine-aldnoah-drive-under-card-keyword: BSAZ02-C10 game_event 誘発効果", () => {
  it("host の下へ配置成功時、デッキ上から1枚ドロー＋ボイドからコア1個を自分のフィールドに置く", () => {
    const host = createCardInstance(C07_CARD, {
      instanceId: "host",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const c10Instance = createCardInstance(C10_CARD, {
      instanceId: "c10",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const deckCard = createCardInstance(noSlotFiller, {
      instanceId: "deck-top",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, c10Instance, deckCard],
    });
    const state: GameState = {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? { ...p, handCount: 1, deckCount: 1, voidNormalCoreCount: 5 }
          : p
      ),
    };

    const placementEffect = C10_CARD.effects!.find(
      (e) => e.timing.kind === "game_event"
    )!;
    const effectIndex = C10_CARD.effects!.indexOf(placementEffect);

    const result = executeEffect({
      chainId: "test:engine-aldnoah-drive-under-card-keyword:334",
      state,
      effect: placementEffect,
      effectIndex,
      sourceInstanceId: c10Instance.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      triggerRelatedInstanceId: host.instanceId,
    });

    const placedCard = result.cardInstances.find(
      (c) => c.instanceId === c10Instance.instanceId
    )!;
    expect(placedCard.zone).toBe("field");
    expect(placedCard.attachedToInstanceId).toBe(host.instanceId);

    const afterHand = result.players.find((p) => p.id === ALICE)!.handCount;
    expect(afterHand).toBe(1); // c10 が手札から離れた分 -1、ドロー1枚で +1 = 相殺

    // 下カードは配置先ではない。候補はhostだけなので自動配置される。
    expect(result.pendingCoreDistribution).toBeNull();
    const resolved = result;
    const afterVoid = resolved.players.find(
      (p) => p.id === ALICE
    )!.voidNormalCoreCount;
    expect(afterVoid).toBe(4); // ボイドから1個フィールドへ
    const hostCores = resolved.cardInstances.find(
      (c) => c.instanceId === host.instanceId
    )!.normalCoreCount;
    expect(hostCores).toBe(2); // 元々1個 + ボイドから1個
  });
});

function pendingLeave(
  instanceId: string,
  kind: PendingLeaveEntity["kind"]
): PendingLeaveEntity {
  return {
    instanceId,
    kind,
    cause: "effect_resolution",
    causePlayerId: BOB,
    chainId: `chain-${instanceId}`,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
  };
}

function buildHostWithUnderCard(kind: PendingLeaveEntity["kind"]): {
  state: GameState;
  hostId: string;
  underId: string;
} {
  const host = createCardInstance(C07_CARD, {
    instanceId: "host",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 1,
    pendingLeaveKind: kind,
    pendingLeaveCause: "effect_resolution",
    pendingLeaveChainId: "chain-host",
  });
  const under = createCardInstance(C10_CARD, {
    instanceId: "under",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 0,
    attachedToInstanceId: host.instanceId,
  });
  const hostWithUnder = {
    ...host,
    underCards: [
      {
        cardInstanceId: under.instanceId,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [hostWithUnder, under],
  });
  return { state, hostId: host.instanceId, underId: under.instanceId };
}

describe("engine-aldnoah-drive-under-card-keyword: host 離脱時の下カード追従 (07b §6)", () => {
  it("host 破壊で下の「アルドノアドライブ」はトラッシュへ追従し、孤児として場に残らない", () => {
    const { state, hostId, underId } = buildHostWithUnderCard("destroy");
    state.pendingLeaveEntities = [pendingLeave(hostId, "destroy")];
    const after = flushPendingLeaves(state, getCardDefinitionById);

    const under = after.cardInstances.find((c) => c.instanceId === underId)!;
    expect(under.zone).toBe("trash");
    expect(under.attachedToInstanceId).toBeNull();

    const host = after.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(host.zone).toBe("trash");
    expect(host.underCards).toEqual([]);
  });

  it("host が除外 (remove_from_game) されたとき下の「アルドノアドライブ」もトラッシュ固定ではなく同じ場所へ追従する", () => {
    const { state, hostId, underId } =
      buildHostWithUnderCard("remove_from_game");
    state.pendingLeaveEntities = [pendingLeave(hostId, "remove_from_game")];
    const after = flushPendingLeaves(state, getCardDefinitionById);

    const under = after.cardInstances.find((c) => c.instanceId === underId)!;
    expect(under.zone).toBe("removed_from_game");
    expect(under.attachedToInstanceId).toBeNull();

    const host = after.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(host.zone).toBe("removed_from_game");
  });

  it("host が置換効果 (replace_field_exit, move_to hand) でトラッシュ以外へ着地するとき、下の「アルドノアドライブ」も trash 固定にならず host と同じ手札へ追従する", () => {
    const { state, hostId, underId } = buildHostWithUnderCard("destroy");
    state.pendingLeaveEntities = [pendingLeave(hostId, "destroy")];
    state.activeContinuousEffects = [
      {
        effectId: `ce-replacement-${hostId}`,
        sourceInstanceId: hostId,
        sourceDefinitionId: C07_CARD.cardNo,
        actingPlayerId: ALICE,
        duration: { scope: "turn" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "replace_field_exit",
        targetInstanceId: hostId,
        metadata: {
          trigger: "destroy",
          source: "opponent_effect",
          replacement: { kind: "move_to", zone: "hand" },
        } as unknown as Record<string, unknown>,
      },
    ];
    const after = flushPendingLeaves(state, getCardDefinitionById);

    const host = after.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(host.zone).toBe("hand");

    // host 追従: 常にトラッシュへ破棄する星霊衣/バレットエディットとは異なり、host の実着地先 (置換後の
    // 手札) へ追従する。trash に固定されて孤児化しないことを確認する (07b §6)。
    const under = after.cardInstances.find((c) => c.instanceId === underId)!;
    expect(under.zone).toBe("hand");
    expect(under.attachedToInstanceId).toBeNull();
  });
});

describe("engine-aldnoah-drive-under-card-keyword: BSAZ02-C10「【合体条件：合体不可】」(textLines[8])", () => {
  it("BSAZ02-C10 は印字どおり20枚を超えてメインデッキに入れられない", () => {
    expect(C10_CARD.maxDeckCount).toBe(20);
    expect(() =>
      initializeGame({
        decks: [Array.from({ length: 21 }, () => C10_CARD), [noSlotFiller]],
        skipPreGame: true,
      })
    ).toThrow(/maxDeckCount=20/);
  });

  it("hasCannotCombineRestriction: 印字 keywordTags=cannot_combine が定義経由で true になる", () => {
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    expect(
      hasCannotCombineRestriction(baseState, "any-instance", C10_CARD)
    ).toBe(true);
    // act_as_spirit token 経路 (definition 省略) は従来通り false のまま。
    expect(hasCannotCombineRestriction(baseState, "any-instance")).toBe(false);
  });

  it("brave_combine: C10 自身をブレイヴとして場に出しても cannot_combine で合体先候補に出せない", () => {
    const brave = createCardInstance(C10_CARD, {
      instanceId: "brave-c10",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const host = createCardInstance(noSlotFiller, {
      instanceId: "host-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [brave, host],
    });
    const activeState: GameState = {
      ...state,
      step: "main",
      activePlayerId: ALICE,
    };
    const actions = getAvailableBraveCombineLegalActions({
      state: activeState,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    expect(actions).toHaveLength(0);
  });
});

describe("engine-aldnoah-drive-under-card-keyword: 実召喚パイプライン E2E (ENGINE-aldnoah-under-card-trigger-e2e-test-gap)", () => {
  it("applyLegalAction 経由の実召喚 (BSAZ02-C07) → collectTriggerEventsFromStateDelta → BSAZ02-C10 game_event trigger が実際にキューされ解決できる", () => {
    const host = createCardInstance(C07_CARD, {
      instanceId: "host-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const c10Instance = createCardInstance(C10_CARD, {
      instanceId: "c10-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const deckCard = createCardInstance(noSlotFiller, {
      instanceId: "deck-top",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, c10Instance, deckCard],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: ALICE,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              handCount: 2,
              deckCount: 1,
              reserveNormalCoreCount: 5,
              voidNormalCoreCount: 5,
            }
          : p
      ),
    };
    const triggeredLookup = buildTriggeredEffectLookup([C07_CARD, C10_CARD]);

    // 実召喚が legal に提示されていることを確認 (登録の入口確認)。
    const preActions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      preActions.some(
        (a) => a.kind === "summon" && a.sourceInstanceId === "host-hand"
      )
    ).toBe(true);

    // applyLegalAction 相当の実コスト支払い + 場入り配置パイプライン
    // (playSummonAsAction = getHandCardAndDefinition + playHandCardWithPlacement、
    // 内部で collectTriggerEventsFromStateDelta による第三者観測トリガー収集を行う)。
    const afterSummon = playSummonAsAction({
      state,
      actingPlayerId: ALICE,
      cardInstanceId: "host-hand",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
      paymentSources: [{ kind: "reserve", amount: 3 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;

    const summonedHost = afterSummon.cardInstances.find(
      (c) => c.instanceId === "host-hand"
    )!;
    expect(summonedHost.zone).toBe("field");

    // BSAZ02-C10 は手札 (private zone) にあるため、game_event trigger は即座には
    // pendingTriggeredEffects に載らず、まず所有者の私的宣言 (declare/skip) を経由する
    // (declaredFromPrivateZone、手札からの直接発動 10_rules/04b)。実パイプラインでのみ
    // 発生するこの中間ステップの実在は直接 executeEffect 注入テストでは検証できない。
    // C07の通常召喚時は条件の後判定用に保持するが、C10より先には発揮できない。
    expect(afterSummon.pendingTriggeredEffects).toHaveLength(1);
    expect(afterSummon.pendingTriggeredEffects[0]?.triggerPriority).toBe(
      "normal"
    );
    const declareActions = getLegalActions({
      state: afterSummon,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    });
    const declareAction = declareActions.find(
      (a) =>
        a.kind === "declare_private_triggered_effect" &&
        a.sourceCardNo === "BSAZ02-C10"
    );
    expect(declareAction).toBeDefined();
    expect(
      declareActions.some(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceCardNo === "BSAZ02-C07"
      )
    ).toBe(false);

    const afterDeclare = applyLegalAction({
      state: afterSummon,
      action: declareAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    // 私的宣言成立後、BSAZ02-C10 の game_event trigger が実際にキューされていることを確認
    // (直接 executeEffect 注入ではなく実召喚起点)。
    expect(afterDeclare.pendingTriggeredEffects).toHaveLength(2);
    const pending = afterDeclare.pendingTriggeredEffects.find(
      (effect) => effect.declaredFromPrivateZone === true
    )!;
    expect(pending.eventKind).toBe("summon");
    expect(pending.relatedInstanceId).toBe("host-hand");
    expect(pending.declaredFromPrivateZone).toBe(true);

    const postActions = getLegalActions({
      state: afterDeclare,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    });
    const resolveAction = postActions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceCardNo === "BSAZ02-C10"
    );
    expect(resolveAction).toBeDefined();

    const afterOpenStack = applyLegalAction({
      state: afterDeclare,
      action: resolveAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    // 誘発効果の発揮宣言はスタック窓を開く (10_rules/04b、相手の応答機会)。
    // 相手が応答を持たないためパスのみで即クローズ→解決。
    expect(afterOpenStack.window).toBe("stack");
    const bobActions = getLegalActions({
      state: afterOpenStack,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    });
    const passStack = bobActions.find((a) => a.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterResolve = applyLegalAction({
      state: afterOpenStack,
      action: passStack!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    // 配置成功: c10 が host の下へアンダーカードとして移動。
    const placedC10 = afterResolve.cardInstances.find(
      (c) => c.instanceId === "c10-hand"
    )!;
    expect(placedC10.zone).toBe("field");
    expect(placedC10.attachedToInstanceId).toBe("host-hand");
    const hostAfterPlacement = afterResolve.cardInstances.find(
      (c) => c.instanceId === "host-hand"
    )!;
    expect(
      hostAfterPlacement.underCards.some(
        (u) =>
          u.cardInstanceId === "c10-hand" && u.roleTag === "アルドノアドライブ"
      )
    ).toBe(true);

    // ref_succeeded ゲート後段: ドロー1枚 + 唯一の配置先hostへコア1個。
    expect(afterResolve.pendingCoreDistribution).toBeNull();
    const resolved = afterResolve;
    const afterVoid = resolved.players.find(
      (p) => p.id === ALICE
    )!.voidNormalCoreCount;
    expect(afterVoid).toBe(4); // 5 - 1 (ボイドからフィールドへ)
    const hostCores = resolved.cardInstances.find(
      (c) => c.instanceId === "host-hand"
    )!.normalCoreCount;
    expect(hostCores).toBe(2); // enterFieldCorePlacements で1 + コア配分で1
    const hostSummonActions = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    });
    const hostSummonAction = hostSummonActions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceCardNo === "BSAZ02-C07"
    );
    expect(hostSummonAction).toBeDefined();
  });
});

describe("ENGINE-x03-cross-zone-aldnoah-drive-transfer: CardInstance.detachedUnderCardOrigin", () => {
  it("host 破壊でアンダーカードがトラッシュへ追従するとき、由来 (host実効カード名+roleTag) を記録する", () => {
    const { state, hostId, underId } = buildHostWithUnderCard("destroy");
    state.pendingLeaveEntities = [pendingLeave(hostId, "destroy")];
    const after = flushPendingLeaves(state, getCardDefinitionById);

    const under = after.cardInstances.find((c) => c.instanceId === underId)!;
    expect(under.zone).toBe("trash");
    expect(under.detachedUnderCardOrigin).toEqual({
      hostCardNameEffective: C07_CARD.name,
      roleTag: "アルドノアドライブ",
    });

    const host = after.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(host.detachedUnderCardOrigin).toBeNull();
  });

  it("host 追従先が手札等トラッシュ以外でも由来マーカーは同様に記録される (07b §6 host 追従と独立)", () => {
    const { state, hostId, underId } = buildHostWithUnderCard("destroy");
    state.pendingLeaveEntities = [pendingLeave(hostId, "destroy")];
    state.activeContinuousEffects = [
      {
        effectId: `ce-replacement-${hostId}`,
        sourceInstanceId: hostId,
        sourceDefinitionId: C07_CARD.cardNo,
        actingPlayerId: ALICE,
        duration: { scope: "turn" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "replace_field_exit",
        targetInstanceId: hostId,
        metadata: {
          trigger: "destroy",
          source: "opponent_effect",
          replacement: { kind: "move_to", zone: "hand" },
        } as unknown as Record<string, unknown>,
      },
    ];
    const after = flushPendingLeaves(state, getCardDefinitionById);

    const under = after.cardInstances.find((c) => c.instanceId === underId)!;
    expect(under.zone).toBe("hand");
    expect(under.detachedUnderCardOrigin).toEqual({
      hostCardNameEffective: C07_CARD.name,
      roleTag: "アルドノアドライブ",
    });
  });
});

describe("ENGINE-x03-cross-zone-aldnoah-drive-transfer: place_text_role_under_card moveFrom:field_or_trash_host", () => {
  const destHostDef: CardDefinition = {
    cardNo: "FILLER-DEST-HOST",
    name: "宛先ホスト",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "紅魔",
    sourceUrls: [],
    sourceConfidence: "C",
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
  };
  const localRegistry = new Map<string, CardDefinition>([
    [C07_CARD.cardNo, C07_CARD],
    [C10_CARD.cardNo, C10_CARD],
    [destHostDef.cardNo, destHostDef],
  ]);
  const getLocalDefById = (id: string) => localRegistry.get(id);
  const action: DSL.PlaceTextRoleUnderCardAction = {
    kind: "place_text_role_under_card",
    hostTarget: {
      kind: "filter",
      player: "self",
      filter: { cardName: { contains: destHostDef.name } },
      count: 1,
    },
    roleTag: "アルドノアドライブ",
    moveFrom: "field_or_trash_host",
    sourceHostFilter: { cardNameEffective: [{ contains: C07_CARD.name }] },
  };

  it("自分の場に現存する host (実効名一致) の下から text_role アンダーカードを引き剥がし、新 host の下へ付け替える", () => {
    const {
      state: baseState,
      hostId,
      underId,
    } = buildHostWithUnderCard("destroy");
    // まだ離脱していない (pendingLeaveEntities 未設定) ため host はそのままフィールドに現存する。
    const destHost = createCardInstance(destHostDef, {
      instanceId: "dest-host",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const state: GameState = {
      ...baseState,
      cardInstances: [...baseState.cardInstances, destHost],
    };

    const after = executePlaceTextRoleUnderCard(
      action,
      state,
      ALICE,
      "acting-source",
      getLocalDefById,
      createStepExecutionContext(state)
    );

    const moved = after.cardInstances.find((c) => c.instanceId === underId)!;
    expect(moved.attachedToInstanceId).toBe("dest-host");
    expect(moved.zone).toBe("field");

    const oldHost = after.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(oldHost.underCards).toEqual([]);

    const newHost = after.cardInstances.find(
      (c) => c.instanceId === "dest-host"
    )!;
    expect(newHost.underCards).toEqual([
      {
        cardInstanceId: underId,
        role: "text_role",
        roleTag: "アルドノアドライブ",
      },
    ]);
  });

  it("現存 host が無いとき、detachedUnderCardOrigin マーカーを保持するトラッシュ内カードを見つけて配置し、マーカーをクリアする", () => {
    const {
      state: baseState,
      hostId,
      underId,
    } = buildHostWithUnderCard("destroy");
    baseState.pendingLeaveEntities = [pendingLeave(hostId, "destroy")];
    const flushed = flushPendingLeaves(baseState, getCardDefinitionById);
    // host も under も trash 行き (buildHostWithUnderCard の既定 kind)。現存 field host は無い。
    const destHost = createCardInstance(destHostDef, {
      instanceId: "dest-host",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const state: GameState = {
      ...flushed,
      cardInstances: [...flushed.cardInstances, destHost],
    };
    expect(
      state.cardInstances.find((c) => c.instanceId === underId)!.zone
    ).toBe("trash");

    const after = executePlaceTextRoleUnderCard(
      action,
      state,
      ALICE,
      "acting-source",
      getLocalDefById,
      createStepExecutionContext(state)
    );

    const moved = after.cardInstances.find((c) => c.instanceId === underId)!;
    expect(moved.zone).toBe("field");
    expect(moved.attachedToInstanceId).toBe("dest-host");
    expect(moved.detachedUnderCardOrigin).toBeNull();

    const newHost = after.cardInstances.find(
      (c) => c.instanceId === "dest-host"
    )!;
    expect(newHost.underCards).toEqual([
      {
        cardInstanceId: underId,
        role: "text_role",
        roleTag: "アルドノアドライブ",
      },
    ]);
  });

  it("現存 host も由来マーカー保持カードも無ければ no-op", () => {
    const destHost = createCardInstance(destHostDef, {
      instanceId: "dest-host",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [destHost],
    });

    const after = executePlaceTextRoleUnderCard(
      action,
      state,
      ALICE,
      "acting-source",
      getLocalDefById,
      createStepExecutionContext(state)
    );

    const newHost = after.cardInstances.find(
      (c) => c.instanceId === "dest-host"
    )!;
    expect(newHost.underCards).toEqual([]);
  });

  it("相手 (対戦相手) 所有の host からも取得できる (印字テキストに『自分の』/『相手の』限定句が無いため owner 制約は課さない設計)", () => {
    // buildHostWithUnderCard は host/under を常に ALICE 所有で組み立てるため、この
    // テストだけ手動で BOB 所有の host+under を構築する。
    const opponentHost = createCardInstance(C07_CARD, {
      instanceId: "opponent-host",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const opponentUnder = createCardInstance(C10_CARD, {
      instanceId: "opponent-under",
      ownerPlayerId: BOB,
      zone: "field",
      attachedToInstanceId: opponentHost.instanceId,
    });
    const opponentHostWithUnder = {
      ...opponentHost,
      underCards: [
        {
          cardInstanceId: opponentUnder.instanceId,
          role: "text_role" as const,
          roleTag: "アルドノアドライブ",
        },
      ],
    };
    const destHost = createCardInstance(destHostDef, {
      instanceId: "dest-host",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [opponentHostWithUnder, opponentUnder, destHost],
    });

    const after = executePlaceTextRoleUnderCard(
      action,
      state,
      ALICE,
      "acting-source",
      getLocalDefById,
      createStepExecutionContext(state)
    );

    const moved = after.cardInstances.find(
      (c) => c.instanceId === "opponent-under"
    )!;
    expect(moved.attachedToInstanceId).toBe("dest-host");
    expect(moved.ownerPlayerId).toBe(BOB); // 所有権自体は移転しない (アタッチ先のみ変更)

    const opponentHostAfter = after.cardInstances.find(
      (c) => c.instanceId === "opponent-host"
    )!;
    expect(opponentHostAfter.underCards).toEqual([]);
  });
});
