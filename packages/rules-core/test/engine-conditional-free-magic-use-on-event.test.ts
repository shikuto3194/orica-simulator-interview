/**
 * ENGINE-conditional-free-magic-use-on-event: 「手札にあるこのカードは、
 * 〔game_event トリガー〕とき、コストを支払わずに使用できる」の汎用プリミティブ。
 *
 * 設計: applicability.zone:"hand" + timing.kind:"game_event" の誘発効果
 * (先例 BSTH02.7-TX01(A)、bsth02-7-tx01-reduce-life-hand-trigger.test.ts) は
 * pendingPrivateDeclarations 経由で通常どおり誘発する。誘発効果の解決自体が
 * P3-34 により必ずスタック窓を先に開くため、その steps は新設アクション
 * `use_magic_without_cost` 1つだけを持ち、同期的にカード自身をコスト無しで
 * 発揮する (useMagicCardWithoutPayingCostAsAction の magicTiming 汎用化、
 * native-action-registry.ts `use_magic_without_cost` ハンドラ)。
 *
 * 対象 (このクラスタで解決済み): BSTS01-R03「暴食之王」(固定1体対象の vanish)、
 * BSLH01-C13「零の軌跡」(対象なし end_attack_step)。いずれもフラッシュ本体が
 * 対象選択を要さない (count:1 固定 or 無対象) ケース。
 *
 * ENGINE-conditional-free-magic-use-target-selection (別クラスタ、本ファイル末尾の
 * describe で検証): BSAZ02-C15「隕石爆撃」の「N体まで」可変個数対象選択は、
 * legal-actions-apply.ts の resolve_pending_triggered_effect ハンドラが
 * resolveDeferredStackAction (種別非依存のスタック解決、通常の flash 使用と同じ経路)
 * を options 束縛した窓口 resolveDeferredStackForFreeMagicUse を
 * ExecuteEffectOptions → executeNativeAction → NativeActionContext →
 * useMagicCardWithoutPayingCostAsAction まで貫通させ、synthetic ActiveStack
 * (actionKind:"magic", targetInstanceIds:[]) を渡すことで解決した。対象選択が
 * 必要なら本物の pendingEffectTargetSelection を生成し (SSOT: 対象選択延期ロジックの
 * 重複実装なし)、不要 (固定1体/無対象) な既存 2 カードは resolveDeferredMagicStack まで
 * 素通りして従来と同じ同期解決結果になる。新たなスタック窓は開かない
 * (resolve_pending_triggered_effect 自体が既に窓クローズ後の解決呼び出しのため)。
 * 未配線の呼び出し元 (burst-system.ts の useMagicCardWithoutPayingCostAsAction) は
 * オプション未指定のフォールバックにより従来の同期解決のまま。
 *
 * 既知の残課題 (別クラスタ、無関係な他ギャップ): BSAZ01-C03/C05・BSAZ02-C16 は
 * 条件付き無償使用と無関係な他ギャップ (段階効果/バトル参加者限定ターゲット/
 * 複合ネクサス効果) と併存するため対象外。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildMagicLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction, getLegalActions } from "../src";
import { resolveLifeDamage } from "../src/core/core-system";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const ALICE = "alice";
const BOB = "bob";

function makeOpponentSpiritDef(cost: number): CardDefinition {
  return {
    cardNo: `TEST-CONDITIONAL-FREE-MAGIC-OPP-${cost}`,
    name: "テスト相手スピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

describe("BSTS01-R03 暴食之王: 条件付き無償使用 → フラッシュ本体発揮", () => {
  it("相手によって自分のライフが減ったとき、手札のこのカードが private declaration 候補に含まれる (自分起因では含まれない)", () => {
    const R03 = card("BSTS01-R03");
    const handCard = createCardInstance(R03, {
      instanceId: "r03-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [handCard],
      playerOverrides: [{ lifeNormalCoreCount: 3 }, {}],
    });
    const lookup = buildTriggeredEffectLookup([R03]);
    const getDef = (id: string) => (id === R03.cardNo ? R03 : undefined);

    const afterOpponentDamage = resolveLifeDamage(before, ALICE, 1, [], {
      cause: "opponent_effect",
      actingPlayerId: BOB,
    });
    const queuedOpponent = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: afterOpponentDamage,
      source: "action_resolution",
      chainId: "r03-reduce-life-chain-opp",
      attackId: null,
      causedByPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    const declaration = queuedOpponent.pendingPrivateDeclarations.find(
      (d) => d.sourceInstanceId === handCard.instanceId
    );
    expect(declaration).toBeDefined();
    expect(declaration!.eventKind).toBe("reduce_life");
    expect(declaration!.ownerPlayerId).toBe(ALICE);

    const afterSelfDamage = resolveLifeDamage(before, ALICE, 1, [], {
      cause: "self_effect",
      actingPlayerId: ALICE,
    });
    const queuedSelf = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: afterSelfDamage,
      source: "action_resolution",
      chainId: "r03-reduce-life-chain-self",
      attackId: null,
      causedByPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      queuedSelf.pendingPrivateDeclarations.find(
        (d) => d.sourceInstanceId === handCard.instanceId
      )
    ).toBeUndefined();
  });

  it("実行: コストを支払わずにカードが手札→トラッシュへ移動し、フラッシュ本体(vanish)が発揮される", () => {
    const R03 = card("BSTS01-R03");
    const grant = R03.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 0
    )!;
    const enemy = createCardInstance(makeOpponentSpiritDef(3), {
      instanceId: "enemy-r03",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 2,
    });
    const handCard = createCardInstance(R03, {
      instanceId: "r03-hand-2",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enemy, handCard],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    const getDef = (id: string) =>
      id === R03.cardNo
        ? R03
        : id === enemy.definitionId
          ? makeOpponentSpiritDef(3)
          : undefined;
    const lookup = buildTriggeredEffectLookup([R03]);

    const result = executeEffect({
      chainId: "test:engine-conditional-free-magic-use-on-event:167",
      state: before,
      effect: grant,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });

    const movedCard = result.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(movedCard.zone).toBe("trash");
    // 無償使用: reserve 等のコア支払いは発生していない (初期値0のまま)。
    const alice = result.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    // vanish はコア→リザーブの上でフィールドを離れる (magic-use 経路は post-processing で
    // pending-leave を同一解決内に flush するため pendingLeaveKind は残らない)。
    expect(result.log.some((l) => l.includes("effect:vanish"))).toBe(true);
    expect(
      result.log.some((l) => l.includes("pending-leave-flushed:vanish"))
    ).toBe(true);
    const bob = result.players.find((p) => p.id === BOB)!;
    expect(bob.reserveNormalCoreCount).toBeGreaterThan(0);
  });
});

describe("BSLH01-C13 零の軌跡: 条件付き無償使用 → フラッシュ本体(end_attack_step)発揮", () => {
  it("実行: コストを支払わずにカードが手札→トラッシュへ移動し、フラッシュ本体が発揮を試みる", () => {
    const C13 = card("BSLH01-C13");
    const grant = C13.effects!.find(
      (e) => e.applicability?.zone === "hand" && e.timing.kind === "game_event"
    )!;
    const handCard = createCardInstance(C13, {
      instanceId: "c13-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [handCard],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    const getDef = (id: string) => (id === C13.cardNo ? C13 : undefined);
    const lookup = buildTriggeredEffectLookup([C13]);

    const result = executeEffect({
      chainId: "test:engine-conditional-free-magic-use-on-event:213",
      state: before,
      effect: grant,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });

    const movedCard = result.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(movedCard.zone).toBe("trash");
    const alice = result.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    // バトル外のためフラッシュ本体の deferTo:battle_end step は不発ログを残す
    // (盤面上のバトル中断は別カード BSLH01-C13 の flash 単体テストで検証済み)。
    expect(
      result.log.some((l) =>
        l.includes("effect:step-deferred-battle-end-no-battle")
      )
    ).toBe(true);
  });

  it("native use_magic_without_cost は追加コストCEが残るなら自動支払いしてから使用する", () => {
    const C13 = card("BSLH01-C13");
    const grant = C13.effects!.find(
      (e) => e.applicability?.zone === "hand" && e.timing.kind === "game_event"
    )!;
    const handCard = createCardInstance(C13, {
      instanceId: "c13-hand-taxed",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [handCard],
        playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-native-free-magic-tax",
          sourceInstanceId: "tax-source",
          sourceDefinitionId: "tax-source-def",
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "additional_cost",
          modifierAmount: 2,
          targetFilter: {
            player: "opponent",
            category: ["magic"],
            usingEffectMode: ["flash"],
          },
        },
      ],
    };
    const getDef = (id: string) => (id === C13.cardNo ? C13 : undefined);
    const lookup = buildTriggeredEffectLookup([C13]);

    const result = executeEffect({
      chainId: "test:engine-conditional-free-magic-use-on-event:275",
      state: before,
      effect: grant,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });

    expect(
      result.cardInstances.find((c) => c.instanceId === handCard.instanceId)
        ?.zone
    ).toBe("trash");
    const alice = result.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.trashNormalCoreCount).toBe(2);
    expect(result.log.some((l) => l.includes("magic:cost-paid:"))).toBe(true);
  });

  it("native use_magic_without_cost は追加コストを支払えないなら使用しない", () => {
    const C13 = card("BSLH01-C13");
    const grant = C13.effects!.find(
      (e) => e.applicability?.zone === "hand" && e.timing.kind === "game_event"
    )!;
    const handCard = createCardInstance(C13, {
      instanceId: "c13-hand-tax-unpaid",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [handCard],
        playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-native-free-magic-tax-unpaid",
          sourceInstanceId: "tax-source",
          sourceDefinitionId: "tax-source-def",
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "additional_cost",
          modifierAmount: 2,
          targetFilter: {
            player: "opponent",
            category: ["magic"],
            usingEffectMode: ["flash"],
          },
        },
      ],
    };
    const getDef = (id: string) => (id === C13.cardNo ? C13 : undefined);
    const lookup = buildTriggeredEffectLookup([C13]);

    const result = executeEffect({
      chainId: "test:engine-conditional-free-magic-use-on-event:332",
      state: before,
      effect: grant,
      sourceInstanceId: handCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });

    expect(
      result.cardInstances.find((c) => c.instanceId === handCard.instanceId)
        ?.zone
    ).toBe("hand");
    const alice = result.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(
      result.log.some((l) =>
        l.includes("magic:without-cost:additional-cost-unpaid")
      )
    ).toBe(true);
  });
});

describe("BSAZ02-C15 隕石爆撃: 条件付き無償使用 → フラッシュ本体(3体まで送還)の対象選択 (ENGINE-conditional-free-magic-use-target-selection)", () => {
  function makeOpponentTargetDef(): CardDefinition {
    return {
      cardNo: "TEST-C15-OPP-TARGET",
      name: "テスト相手対象",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    } as CardDefinition;
  }

  it("複数候補から2体選んで送還できる（従来は count.min=0 に縮退し常に0体不発だった）", () => {
    const C15 = card("BSAZ02-C15");
    const oppDef = makeOpponentTargetDef();
    const handCard = createCardInstance(C15, {
      instanceId: "c15-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const enemy1 = createCardInstance(oppDef, {
      instanceId: "c15-enemy-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy2 = createCardInstance(oppDef, {
      instanceId: "c15-enemy-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [handCard, enemy1, enemy2],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    const getDef = (id: string) =>
      id === C15.cardNo ? C15 : id === oppDef.cardNo ? oppDef : undefined;
    const triggerLookup = buildTriggeredEffectLookup([C15]);
    const magicLookup = buildMagicLookup([C15]);
    const effectLookups = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredHandActivatedEffectActions: () => [],
      getRegisteredBattleImmediateEffectActions: () => [],
      getRegisteredBurstActions: () => undefined,
    };

    const afterDamage = resolveLifeDamage(before, ALICE, 1, [], {
      cause: "self_effect",
      actingPlayerId: ALICE,
    });
    const queued = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: afterDamage,
      source: "action_resolution",
      chainId: "c15-reduce-life-chain",
      attackId: null,
      causedByPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
    });
    let ready = queued;
    while (ready.pendingBurstChecks.length > 0) {
      const actingPlayerId = ready.pendingBurstChecks[0]!.actingPlayerId;
      const resolveBurstCheck = getLegalActions({
        state: ready,
        actingPlayerId,
        ...effectLookups,
      }).find(
        (a) =>
          a.kind === "resolve_pending_burst_check" ||
          a.kind === "decline_pending_burst_check"
      );
      expect(resolveBurstCheck).toBeDefined();
      ready = applyLegalAction({
        state: ready,
        action: resolveBurstCheck!,
        ...effectLookups,
      }).state;
    }

    const declareAction = getLegalActions({
      state: ready,
      actingPlayerId: ALICE,
      ...effectLookups,
    }).find(
      (a) =>
        a.kind === "declare_private_triggered_effect" &&
        a.sourceInstanceId === handCard.instanceId
    );
    expect(declareAction).toBeDefined();
    const declared = applyLegalAction({
      state: ready,
      action: declareAction!,
      ...effectLookups,
    }).state;

    const resolveAction = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      ...effectLookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === handCard.instanceId
    );
    expect(resolveAction).toBeDefined();
    const declaredOnStack = applyLegalAction({
      state: declared,
      action: resolveAction!,
      ...effectLookups,
    }).state;

    // P3-34: 誘発効果の declare は必ずスタック窓を開く。両者パスで窓が閉じてから
    // 実際の steps (use_magic_without_cost) が実行される。
    let resolved = declaredOnStack;
    for (let i = 0; i < 8 && resolved.stackWindow !== null; i++) {
      const priority = resolved.stackWindow.priorityPlayerId;
      const pass = getLegalActions({
        state: resolved,
        actingPlayerId: priority,
        ...effectLookups,
      }).find((a) => a.kind === "pass_stack");
      if (!pass) break;
      resolved = applyLegalAction({
        state: resolved,
        action: pass,
        ...effectLookups,
      }).state;
    }

    // 対話的対象選択 (pendingEffectTargetSelection) が生成される。従来はここで即座に
    // resolveMagicMainAndMoveToTrash が count.min=0 で解決し 0 体不発になっていた。
    expect(resolved.pendingEffectTargetSelection).not.toBeNull();
    const pending = resolved.pendingEffectTargetSelection!;
    expect(pending.requiredTargetCount).toBe(0);
    expect(pending.maxTargetCount).toBe(3);
    expect(new Set(pending.candidateInstanceIds)).toEqual(
      new Set([enemy1.instanceId, enemy2.instanceId])
    );

    const targetAction = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      ...effectLookups,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();

    const final = applyLegalAction({
      state: resolved,
      action: targetAction!,
      targetInstanceIds: [enemy1.instanceId, enemy2.instanceId],
      ...effectLookups,
    }).state;

    const movedHand = final.cardInstances.find(
      (c) => c.instanceId === handCard.instanceId
    )!;
    expect(movedHand.zone).toBe("trash");
    // 無償使用: マジックのコスト支払いは発生していない (alice のリザーブ増加は
    // resolveLifeDamage 自身のライフコア→リザーブ移動によるもので、マジック使用とは無関係)。
    expect(final.log.some((l) => l.includes("magic:without-cost:"))).toBe(true);
    expect(final.log.some((l) => l.includes("magic:reduction:"))).toBe(false);

    const e1After = final.cardInstances.find(
      (c) => c.instanceId === enemy1.instanceId
    )!;
    const e2After = final.cardInstances.find(
      (c) => c.instanceId === enemy2.instanceId
    )!;
    expect(e1After.zone).toBe("deck");
    expect(e2After.zone).toBe("deck");
    // 送還された相手カードのコアはリザーブへ (bob の own reserve)。
    const bobBefore = before.players.find((p) => p.id === BOB)!;
    const bob = final.players.find((p) => p.id === BOB)!;
    expect(bob.reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount + 2
    );
  });
});
