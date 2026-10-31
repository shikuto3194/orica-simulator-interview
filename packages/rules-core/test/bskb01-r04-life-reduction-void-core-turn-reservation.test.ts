/**
 * BSKB01-R04「メタナイトが夜な夜なこっそり食べてるパフェ」effects[3]:
 * フラッシュ〔ターンに1回：同名〕魂状態を含む自分の「メタナイト」がいるとき、このターンの間、
 * 相手によって自分のライフが減ったとき、減った数1につき、ボイドからコア1個を自分のライフに置ける。
 *
 * engine-player-scoped-turn-reservation cluster: マジック使用後もカード自身のゾーン
 * (トラッシュ行き等) に依存せず「このターンの間」反復発火するプレイヤー起点の継続反応を、
 * grant_effect の turnReservation variant (grant-effect-system.ts) で表現する。
 * 通常の grant_effect lifecycle は grantee (被付与カード) の zone===field を要求する
 * (grant-effect-system.ts / mechanic-trigger-handlers.ts) が、turnReservation:true 指定時は
 * これをバイパスし、duration:{scope:"turn"} のみで有効期限を管理する
 * (continuous-effect-rebuild.ts isContinuousEffectStillValid の turnReservation 分岐)。
 *
 * 併せて解消した既存 gap:
 * - grant_effect の game_event variant は timing.cause を検出時に評価していなかった
 *   (card_event 分岐のみ実装済み)。「相手によって」を正しく絞り込むために追加。
 * - granted_effect mechanic は誘発イベントの amount を pending へ転写しておらず
 *   DynamicCount.event_amount が常に 0 になっていた。「減った数1につき」のスケールに必要。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { buildMagicLookup } from "../src/effect/structured-effect-registrations";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type { CardDefinition, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const noTriggerLookup = () => [];

const R04_NO = "BSKB01-R04";
const METAKNIGHT_NO = "BSKB01-C01"; // 名前「メタナイト」を含む (field_has cardNames マッチ用)

describe("BSKB01-R04 effects[3]: フラッシュ ライフ減少反応予約", () => {
  const c = card(R04_NO);
  const grantStep = (c.effects ?? []).find((e) => e.textRef?.includes(8));

  it("stub が解消され、turnReservation grant_effect ステップを持つ", () => {
    expect(grantStep?.stub).toBeUndefined();
    expect(grantStep?.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(grantStep?.steps).toHaveLength(1);
    const step = grantStep!.steps[0]!;
    expect(step.prompt?.sourceText).toBe(
      "このターンの間、相手によって自分のライフが減ったとき、減った数1につき、ボイドからコア1個を自分のライフに置ける。"
    );
    const action = step.action;
    expect(action.kind).toBe("grant_effect");
    if (action.kind === "grant_effect") {
      expect(action.turnReservation).toBe(true);
      expect(action.duration).toEqual({ scope: "turn" });
      // 〔ターンに1回:同名〕は予約の発行回数であって、その後のライフ減少反応を
      // 1回へ縮めるものではない。
      expect(action.grantedEffect?.usageLimit).toBeUndefined();
    }
  });

  it("[board] 使用後トラッシュへ移動しても、相手起因のライフ減少に反応してボイド→ライフへコアを置ける", () => {
    const metaKnight = createCardInstance(card(METAKNIGHT_NO), {
      instanceId: "mk-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0, // 魂状態
    });
    const magic = createCardInstance(c, {
      instanceId: "r04-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
      normalCoreCount: 0,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [metaKnight, magic],
      playerOverrides: [{ soulStateInstanceIds: ["mk-1"] }, {}],
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      window: "default",
      players: base.players.map((p) =>
        p.id === ALICE
          ? { ...p, voidNormalCoreCount: 10, lifeNormalCoreCount: 5 }
          : p
      ),
    };

    // フラッシュ使用を模して grant ステップを直接実行 → 自己 (r04-1) へ turnReservation CE 登録。
    const granted = executeEffect({
      chainId: "test:bskb01-r04-life-reduction-void-core-turn-reservation:108",
      state,
      effect: grantStep!,
      sourceInstanceId: "r04-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const grantCe = granted.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "granted_effect" && ce.targetInstanceId === "r04-1"
    );
    expect(grantCe).toBeDefined();
    expect(grantCe!.metadata?.turnReservation).toBe(true);

    // 使用後、通常のマジック解決と同じくトラッシュへ移動する。
    const afterUse: GameState = {
      ...granted,
      cardInstances: granted.cardInstances.map((card) =>
        card.instanceId === "r04-1" ? { ...card, zone: "trash" as const } : card
      ),
    };

    // 実際の効果解決パイプライン (finalizeEffectResolution →
    // recomputeAndRebuildContinuousEffects) はこの節目で recomputeContinuousEffects
    // (legal-actions-shared.ts) を必ず通す。turnReservation CE の targetInstanceId は
    // grantee カード自身 (r04-1、今はトラッシュ) を指すため、この関数のバイパスに
    // 加わっていないと「対象カードが field 不在なら除去」判定で即座に消える
    // (adversarial verifier 発見の実運用 gap)。
    const recomputed = recomputeContinuousEffects(afterUse);
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "granted_effect" &&
          ce.targetInstanceId === "r04-1" &&
          ce.metadata?.turnReservation === true
      )
    ).toBe(true);

    // 自己アタック由来のライフ減少では反応しない。BS48 Q22983 は、自分のスピリットの
    // アタックで自分のライフを減らした場合は「相手によって」ではないと明示している。
    const selfBattle = queueGrantedEffectTriggersFromTriggerEvents(
      recomputed,
      [
        {
          chainId:
            "test:bskb01-r04-life-reduction-void-core-turn-reservation:152",
          eventKind: "reduce_life",
          relatedInstanceId: null,
          relatedPlayerId: ALICE,
          cause: "battle",
          causedByPlayerId: ALICE,
          amount: 1,
        },
      ],
      getCardDefinitionById
    );
    expect(
      selfBattle.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "granted_effect"
      )
    ).toHaveLength(0);

    const resolveGrantedReaction = (queued: GameState): GameState => {
      const pending = queued.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "granted_effect"
      );
      expect(pending).toHaveLength(1);

      const actions = getLegalActions({
        state: queued,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => [],
      } as unknown as Parameters<typeof getLegalActions>[0]);
      const resolve = actions.find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.pendingId === pending[0]!.pendingId
      );
      expect(resolve).toBeDefined();

      let current = (
        applyLegalAction({
          state: queued,
          action: resolve!,
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions: noTriggerLookup,
        }) as { state: GameState }
      ).state;
      // スタック窓が開けば双方 pass で閉じる。
      let guard = 0;
      while (current.stackWindow && guard++ < 10) {
        const responderId = current.stackWindow.priorityPlayerId;
        const passActions = getLegalActions({
          state: current,
          actingPlayerId: responderId,
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions: noTriggerLookup,
          getRegisteredFieldCardEffectActions: () => [],
        } as unknown as Parameters<typeof getLegalActions>[0]);
        const pass = passActions.find((a) => a.kind === "pass_stack");
        expect(pass).toBeDefined();
        current = (
          applyLegalAction({
            state: current,
            action: pass!,
            getCardDefinitionById,
            getRegisteredTriggeredEffectActions: noTriggerLookup,
          }) as { state: GameState }
        ).state;
      }
      return current;
    };

    // 予約は同名制限の対象ではない。異なる2回の相手アタック由来イベントに、それぞれ
    // event_amount 分だけ反応する。
    const firstQueued = queueGrantedEffectTriggersFromTriggerEvents(
      recomputed,
      [
        {
          chainId:
            "test:bskb01-r04-life-reduction-void-core-turn-reservation:226",
          eventKind: "reduce_life",
          relatedInstanceId: null,
          relatedPlayerId: ALICE,
          cause: "battle",
          causedByPlayerId: BOB,
          amount: 1,
        },
      ],
      getCardDefinitionById
    );
    const afterFirst = resolveGrantedReaction(firstQueued);
    const secondQueued = queueGrantedEffectTriggersFromTriggerEvents(
      afterFirst,
      [
        {
          chainId:
            "test:bskb01-r04-life-reduction-void-core-turn-reservation:241",
          eventKind: "reduce_life",
          relatedInstanceId: null,
          relatedPlayerId: ALICE,
          cause: "battle",
          causedByPlayerId: BOB,
          amount: 2,
        },
      ],
      getCardDefinitionById
    );
    const current = resolveGrantedReaction(secondQueued);

    const alice = current.players.find((p) => p.id === ALICE)!;
    expect(alice.lifeNormalCoreCount).toBe(8); // 5 + 3
    expect(alice.voidNormalCoreCount).toBe(7); // 10 - 3
  });

  it("[dispatch] use_magic は同名ターン制限を記録し、同名2枚目を同ターンに列挙しない", () => {
    const metaKnight = createCardInstance(card(METAKNIGHT_NO), {
      instanceId: "mk-dispatch",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const first = createCardInstance(c, {
      instanceId: "r04-first",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const second = createCardInstance(c, {
      instanceId: "r04-second",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [metaKnight, first, second],
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "default",
    };
    const magicLookup = buildMagicLookup(ALL_CARDS);
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const useFirst = actions.find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "r04-first" &&
        action.timing === "flash"
    );
    expect(useFirst).toBeDefined();
    if (!useFirst || useFirst.kind !== "use_magic") return;

    const declared = applyLegalAction({
      state,
      action: useFirst,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      getCardDefinitionById,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(declared.effectUsageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDefinitionId: R04_NO,
          effectLabel: "magic",
          duration: "turn",
          count: 1,
        }),
      ])
    );

    // 宣言後に同一ターンの通常窓へ戻った状態でも、2枚目は同名制限で列挙されない。
    const postDeclarationMain: GameState = {
      ...declared,
      window: "default",
      stackWindow: null,
    };
    expect(
      getLegalActions({
        state: postDeclarationMain,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }).some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "r04-second"
      )
    ).toBe(false);
  });

  it("[event] バトルライフ減少は cause:battle を保ち、直接の加害者を別軸で配送する", () => {
    const before = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const after: GameState = {
      ...before,
      players: before.players.map((player) =>
        player.id === ALICE
          ? { ...player, lifeNormalCoreCount: player.lifeNormalCoreCount - 1 }
          : player
      ),
    };
    const [event] = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "battle_resolution",
      causedByPlayerId: BOB,
    }).filter((candidate) => candidate.eventKind === "reduce_life");
    expect(event).toMatchObject({
      cause: "battle",
      causedByPlayerId: BOB,
      relatedPlayerId: ALICE,
    });
  });
});
