/**
 * life_damage_interception の discardCostGate 破棄コストゲート拡張 — 検証。
 *
 * プリミティブ:
 *  - LifeDamageInterceptionAction.discardCostGate: { zones: Array<"hand"|"set_aside"> }
 *    「手札/手元にあるこのカードは、相手の効果で自分のライフが減るとき、破棄することで
 *    自分のライフは減らない」型（BSTH02.7-C05[1] / BSTH08.5-C23[0]）。
 *  - 10_rules/02 §コスト先払い型ドロー枚数修正と同じ「プレ判断モデル」を適用する:
 *    ダメージ解決を pendingLifeDamageDiscardChoice で中断し、支払い(pay)/辞退(decline)で
 *    プレイヤーに選ばせてから確定する（コスト → 効果確定 → システム処理）。
 *  - 破棄対象は sourceInstanceId 自身固定（候補選択は無い）。支払い確定でダメージは 0、
 *    辞退なら通常通り解決する。sourceInstanceId が discardCostGate.zones を離れていれば
 *    この CE は無条件でスキップする（防止不可）。
 *
 * 重要な設計制約（adversarial verifier round 1 で確定）:
 *  - `continuous-effect-rebuild.ts` の `REBUILD_ZONES` は `{field, mirage, burst}` のみで
 *    "hand"/"set_aside" 未収録のため、この2ゾーンの continuous 効果は
 *    `activeContinuousEffects` に一切登録されない（BSTH02.7-C06[0] 等の既存コメントが同じ
 *    ギャップを指摘済み）。よって discardCostGate は CE 登録に依存せず、
 *    `applyLifeDamageInterception` 内の `collectDirectDiscardCostGateEntries` が
 *    `card.effects` を直接読んで判定する（cost-system.ts の
 *    `getEffectiveReductionSymbolEntries` と同じ SSOT パターン）。
 *  - 以下のテストは、事前に `executeEffect` で CE を明示登録**せず**、カードを
 *    hand/set_aside ゾーンに置くだけで discardCostGate が機能することを検証する
 *    （これが実ゲームプレイでの唯一の発火経路であるため）。
 *
 * 解禁カード:
 *  - BSTH02.7-C05[1]: applicability zone [hand, set_aside]。
 *  - BSTH08.5-C23[0]: applicability zone set_aside のみ（ブレイヴの手元専用効果）。
 *
 * 参考先例（prevent_life_damage は consumer 未配線 silent-disabled のため不採用）:
 *  - BSTH07-R10 / BSTH02.7-TX01(A) / BSTH04-C11 の life_damage_interception 採用。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeCoreMove,
  getLegalActions,
  resolveLifeDamage,
  resolvePendingLifeDamageDiscardChoice,
  getPlayerLifeCoreCount,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const lookup = buildTriggeredEffectLookup(ALL_CARDS);

const ALICE = "player-1";
const BOB = "player-2";

const lifeOf = (s: GameState, playerId: string): number =>
  getPlayerLifeCoreCount(s.players.find((p) => p.id === playerId)!);

function stateWithCardInZone(
  cardDef: CardDefinition,
  instanceId: string,
  zone: "hand" | "set_aside" | "trash"
): GameState {
  const src = createCardInstance(cardDef, {
    instanceId,
    ownerPlayerId: ALICE,
    zone,
  });
  return createEmptyGameState({
    cardInstances: [src],
    startingVoidNormalCoreCount: 0,
    playerOverrides: [
      { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
    ],
  });
}

describe("discardCostGate: 破棄コストゲート (BSTH02.7-C05[1] / BSTH08.5-C23[0])", () => {
  it("BSTH02.7-C05[1]: applicability zone [hand,set_aside] + life_damage_interception(discardCostGate) を登録", () => {
    const c = card("BSTH02.7-C05");
    const effect = c.effects![1]!;
    expect(effect.applicability).toEqual({ zone: ["hand", "set_aside"] });
    expect(effect.stub).toBeUndefined();
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("replace");
      expect(action.cause).toBe("opponent_effect");
      expect(action.discardCostGate).toEqual({ zones: ["hand", "set_aside"] });
    }
  });

  it("BSTH08.5-C23[0]: applicability zone set_aside のみ + discardCostGate zones:[set_aside]", () => {
    const c = card("BSTH08.5-C23");
    const effect = c.effects![0]!;
    expect(effect.applicability).toEqual({ zone: "set_aside" });
    expect(effect.stub).toBeUndefined();
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("replace");
      expect(action.cause).toBe("opponent_effect");
      expect(action.discardCostGate).toEqual({ zones: ["set_aside"] });
    }
  });

  it("[board] 手札にある BSTH02.7-C05 (CE 未登録・card.effects 直接スキャンのみ): 相手効果のライフ減少でダメージ解決が中断される (pending)", () => {
    const c = card("BSTH02.7-C05");
    const state = stateWithCardInZone(c, "th0207-c05", "hand");
    // 重要: executeEffect による CE 明示登録は行わない。activeContinuousEffects は空のまま。
    expect(state.activeContinuousEffects).toEqual([]);

    // 相手 (BOB) の効果で ALICE のライフが 1 減ろうとする。
    const afterAttempt = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );
    expect(afterAttempt.pendingLifeDamageDiscardChoice).not.toBeNull();
    const pending = afterAttempt.pendingLifeDamageDiscardChoice!;
    expect(pending.decidingPlayerId).toBe(ALICE);
    expect(pending.pendingAmount).toBe(1);
    expect(pending.entries[0]!.sourceInstanceId).toBe("th0207-c05");
    expect(pending.entries[0]!.sourceZone).toBe("hand");
    // まだライフは減っていない (中断中)。
    expect(lifeOf(afterAttempt, ALICE)).toBe(5);
  });

  it("[board] getCardDefinitionById を渡さない呼び出しでは discardCostGate を検出しない (後方互換・クラッシュしない)", () => {
    const c = card("BSTH02.7-C05");
    const state = stateWithCardInZone(c, "th0207-c05", "hand");
    const afterAttempt = resolveLifeDamage(state, ALICE, 1, [], {
      cause: "opponent_effect",
      actingPlayerId: BOB,
    });
    expect(afterAttempt.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(afterAttempt, ALICE)).toBe(4);
  });

  it("[board] 支払う (pay): カードを破棄しライフは減らない", () => {
    const c = card("BSTH02.7-C05");
    const state = stateWithCardInZone(c, "th0207-c05", "hand");
    const pendingState = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );

    const legals = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });
    const action = legals.find(
      (a) => a.kind === "resolve_pending_life_damage_discard_choice"
    );
    expect(action).toBeDefined();

    const resolved = applyLegalAction({
      state: pendingState,
      action: action!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      lifeDamageDiscardChoice: "pay",
    }).state;

    expect(resolved.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(resolved, ALICE)).toBe(5); // ライフは減らない
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "th0207-c05")!.zone
    ).toBe("trash"); // 破棄済み
  });

  it("[board] 辞退する (decline): 通常通りライフが減り、カードは手札に残る", () => {
    const c = card("BSTH02.7-C05");
    const state = stateWithCardInZone(c, "th0207-c05", "hand");
    const pendingState = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );

    const declined = resolvePendingLifeDamageDiscardChoice(
      pendingState,
      "decline"
    );
    expect(declined.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(declined, ALICE)).toBe(4); // 通常通り 1 減る
    expect(
      declined.cardInstances.find((c) => c.instanceId === "th0207-c05")!.zone
    ).toBe("hand"); // 破棄されず手札のまま
  });

  it("[board] 手元 (set_aside) にある場合も同様に発火する", () => {
    const c = card("BSTH02.7-C05");
    const state = stateWithCardInZone(c, "th0207-c05", "set_aside");
    const afterAttempt = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );
    expect(afterAttempt.pendingLifeDamageDiscardChoice).not.toBeNull();
    expect(
      afterAttempt.pendingLifeDamageDiscardChoice!.entries[0]!.sourceZone
    ).toBe("set_aside");
  });

  it("[board] 手札/手元を離れている (例: 既にトラッシュ) ならこの CE は無効化しライフは通常通り減る", () => {
    const c = card("BSTH02.7-C05");
    const state = stateWithCardInZone(c, "th0207-c05", "trash");

    const afterAttempt = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );
    expect(afterAttempt.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(afterAttempt, ALICE)).toBe(4); // 通常通り 1 減る (防止不可)
  });

  it("[board] 自分の効果 (self_effect) によるライフ減少では発火しない (cause:opponent_effect 限定)", () => {
    const c = card("BSTH02.7-C05");
    const state = stateWithCardInZone(c, "th0207-c05", "hand");
    const afterAttempt = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "self_effect", actingPlayerId: ALICE },
      getDef
    );
    expect(afterAttempt.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(afterAttempt, ALICE)).toBe(4);
  });

  it("[board] BSTH08.5-C23: 手元にあるとき支払うとライフ不変+カードはトラッシュへ", () => {
    const c = card("BSTH08.5-C23");
    const state = stateWithCardInZone(c, "th0805-c23", "set_aside");
    const pendingState = resolveLifeDamage(
      state,
      ALICE,
      2,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );
    expect(pendingState.pendingLifeDamageDiscardChoice).not.toBeNull();

    const paid = resolvePendingLifeDamageDiscardChoice(pendingState, "pay");
    expect(paid.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(paid, ALICE)).toBe(5);
    expect(
      paid.cardInstances.find((c) => c.instanceId === "th0805-c23")!.zone
    ).toBe("trash");
  });

  it("[board] BSTH08.5-C23 は hand ゾーンでは発火しない (discardCostGate zones:[set_aside] 限定)", () => {
    const c = card("BSTH08.5-C23");
    const state = stateWithCardInZone(c, "th0805-c23", "hand");
    const afterAttempt = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );
    expect(afterAttempt.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(afterAttempt, ALICE)).toBe(4);
  });

  describe("core_move (executeCoreMove の life→X) 経由のライフ減少 (adversarial verifier round 2 で確定した gap の修正確認)", () => {
    // BSTH01-X08「神槍『スピア・ザ・グングニル』」等、「相手のライフのコアをボイドに置く」型の
    // ライフ減少は core_move (life→void) 経由で resolveLifeDamage を通らない。この経路でも
    // discardCostGate が pendingLifeDamageDiscardChoice + coreMoveResume を立て、
    // decline で元の core_move (ライフ→ボイド) を再開できることを確認する。
    function buildCoreMoveState() {
      const c = card("BSTH02.7-C05");
      const src = createCardInstance(c, {
        instanceId: "th0207-c05",
        ownerPlayerId: ALICE,
        zone: "hand",
      });
      return createEmptyGameState({
        cardInstances: [src],
        startingVoidNormalCoreCount: 0,
        playerOverrides: [
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        ],
      });
    }

    it("相手 (BOB) がライフ→ボイドで1コア移動しようとすると pending が立ち、コアはまだ移動しない", () => {
      const state = buildCoreMoveState();
      const afterAttempt = executeCoreMove(
        state,
        BOB,
        { kind: "life", player: "opponent" },
        { kind: "void", player: "opponent" },
        1,
        "attacker-source",
        undefined,
        undefined,
        getDef
      );
      expect(afterAttempt.pendingLifeDamageDiscardChoice).not.toBeNull();
      const pending = afterAttempt.pendingLifeDamageDiscardChoice!;
      expect(pending.coreMoveResume).toBeDefined();
      expect(pending.coreMoveResume!.sourceInstanceId).toBe("attacker-source");
      expect(pending.coreMoveResume!.fromLocation).toEqual({
        kind: "life",
        player: "opponent",
      });
      expect(pending.entries[0]!.sourceInstanceId).toBe("th0207-c05");
      // まだコアは動いていない (中断中)。
      expect(lifeOf(afterAttempt, ALICE)).toBe(5);
      expect(
        afterAttempt.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
      ).toBe(0);
    });

    it("支払う (pay): カードを破棄し core_move 自体がキャンセルされる (コア移動なし)", () => {
      const state = buildCoreMoveState();
      const pendingState = executeCoreMove(
        state,
        BOB,
        { kind: "life", player: "opponent" },
        { kind: "void", player: "opponent" },
        1,
        "attacker-source",
        undefined,
        undefined,
        getDef
      );

      const legals = getLegalActions({
        state: pendingState,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
      });
      const action = legals.find(
        (a) => a.kind === "resolve_pending_life_damage_discard_choice"
      )!;
      const resolved = applyLegalAction({
        state: pendingState,
        action,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
        lifeDamageDiscardChoice: "pay",
      }).state;

      expect(resolved.pendingLifeDamageDiscardChoice ?? null).toBeNull();
      expect(lifeOf(resolved, ALICE)).toBe(5); // ライフ変化なし
      expect(
        resolved.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
      ).toBe(0); // コア移動も発生しない
      expect(
        resolved.cardInstances.find((c) => c.instanceId === "th0207-c05")!.zone
      ).toBe("trash");
    });

    it("辞退する (decline): 元の core_move (ライフ→ボイド) が再開され、通常通りコアが移動する", () => {
      const state = buildCoreMoveState();
      const pendingState = executeCoreMove(
        state,
        BOB,
        { kind: "life", player: "opponent" },
        { kind: "void", player: "opponent" },
        1,
        "attacker-source",
        undefined,
        undefined,
        getDef
      );

      const legals = getLegalActions({
        state: pendingState,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
      });
      const action = legals.find(
        (a) => a.kind === "resolve_pending_life_damage_discard_choice"
      )!;
      const resolved = applyLegalAction({
        state: pendingState,
        action,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: lookup,
        lifeDamageDiscardChoice: "decline",
      }).state;

      expect(resolved.pendingLifeDamageDiscardChoice ?? null).toBeNull();
      expect(lifeOf(resolved, ALICE)).toBe(4); // ライフのコアが1個減る
      expect(
        resolved.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
      ).toBe(1); // ボイドへ移動済み
      expect(
        resolved.cardInstances.find((c) => c.instanceId === "th0207-c05")!.zone
      ).toBe("hand"); // 破棄されず手札のまま
    });
  });

  it("既存 life_damage_interception (attackerFilter / cap 系) の CE 消費経路には影響しない (回帰確認)", () => {
    // BSTH07-R10: attackerFilter + cap 付き flash 効果。discardCostGate 未使用の既存経路が
    // 引き続き即時 replace/cap されることを確認する (applyLifeDamageInterception 共有ロジックの回帰防止)。
    const c = card("BSTH07-R10");
    const src = createCardInstance(c, {
      instanceId: "r10-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [src],
      startingVoidNormalCoreCount: 0,
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    // フラッシュ効果 [2,3] は「自分の青のネクサスがあるとき」が条件のため、条件を満たさない
    // 状態で resolveLifeDamage が通常通り解決されることだけを確認する (discardCostGate 無しの
    // 通常 life_damage_interception 経路が新規分岐に巻き込まれていないことの回帰確認)。
    const result = resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );
    expect(result.pendingLifeDamageDiscardChoice ?? null).toBeNull();
    expect(lifeOf(result, ALICE)).toBe(4);
  });
});
