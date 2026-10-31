/**
 * BSTH01-C12 ヴワル魔法図書館 効果テスト。
 *
 * カード本文 (Ver.17.0 エターナル独自拡張):
 * - 系統: 「幻想」/「紅魔」
 * - Lv1-Lv2『自分のドローステップ』ドロー +2、ドロー後 手札3枚 か 紅魔1枚を破棄。重複しない。
 *   → effects[0] inline (phase:draw, subPhase:start, whose:self) で turn-system がプレ
 *     (draw_modify amount 集計) → システムドロー → ポスト (discard) を直接実行する。
 *     誘発キューを経由しない (after_draw triggered ではない)。
 * - Lv2『自分のメインステップ』ライフのコア1個をトラッシュに置くことで、
 *   このステップの間 このネクサスに「赤/紫として扱うシンボル」を2つ追加。ターン1回。
 *
 * 本テストでは以下を検証する:
 * - effects[0] inline draw step: registration から除外されること、
 *   draw_modify amount が turn-system 側で集計されること、ポスト discard が選択モーダルになること
 * - effects[1] activated/main: applicability.level が legal-action 段階で評価される (Lv1 では出ない)
 * - effects[1] dual-color symbol_add: ["red","purple"] が 1 シンボルの 2 色として 1 CE 登録される
 * - effects[1] dual-color reduction symbol: 赤・紫両方の cost reduction として機能
 * - effects[1] メイン効果発揮で effects[0] discard が誤発動しないこと
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateTriggeredEffectRegistrations,
  getEffectiveSymbols,
  getEffectiveSymbolBundles,
  getLegalActions,
  generateFieldCardEffectRegistrations,
} from "../src/runtime";
import type { CardDefinition, GameState } from "../src/runtime";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const ヴワル = cardNoMap.get("BSTH01-C12");

function buildStateWithVwal(
  instanceId: string,
  cores: number,
  step: GameState["step"] = "main",
  options?: { lifeCount?: number }
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    activePlayerId: "alice",
    step,
    cardInstances: [
      createCardInstance(ヴワル!, {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: cores,
      }),
    ],
    players: base.players.map((p) =>
      p.id === "alice"
        ? { ...p, lifeNormalCoreCount: options?.lifeCount ?? 4 }
        : p
    ),
  };
}

describe("BSTH01-C12 ヴワル魔法図書館", () => {
  it("カードデータに存在する", () => {
    expect(ヴワル).toBeDefined();
    expect(ヴワル?.printedCategory).toBe("nexus");
    expect(ヴワル?.tribe).toContain("紅魔");
  });

  describe("effects[0] inline draw step (キュー非経由)", () => {
    it("同ターンの別ドローステップで再び3枚引ける", () => {
      let state = buildStateWithVwal("vwal-repeat", 0, "core");
      state = {
        ...state,
        turnNumber: 4,
        stepSequence: 10,
        cardInstances: [
          ...state.cardInstances,
          ...Array.from({ length: 10 }, (_, i) =>
            createCardInstance(ヴワル!, {
              instanceId: `repeat-deck-${i}`,
              ownerPlayerId: "alice",
              zone: "deck",
            })
          ),
        ],
        players: state.players.map((p) => ({
          ...p,
          handCount: 0,
          deckCount: p.id === "alice" ? 10 : 0,
        })),
      };
      const lookup = buildTriggeredEffectLookup([ヴワル!]);
      const first = advanceStep(state, getCardDefinitionById, lookup);
      expect(first.players[0]?.handCount).toBe(3);
      // 前の解決で消費した記録を保持したまま、同ターンの次のドローステップを開始。
      const next = {
        ...state,
        stepSequence: 12,
        effectUsageRecords: first.effectUsageRecords,
      };
      const second = advanceStep(next, getCardDefinitionById, lookup);
      expect(second.players[0]?.handCount).toBe(3);
      expect(second.pendingZoneSelection?.maxCount).toBe(3);
    });
    it("inline=true は generateTriggeredEffectRegistrations から除外される", () => {
      const regs = generateTriggeredEffectRegistrations(ヴワル!);
      // ドローステップ inline 効果は登録されないこと (effects[0] は除外)。
      // effects[1] (activated/main) は元々 triggered ではないため、登録は 0 件。
      const drawStepRegs = regs.filter((r) => {
        const eff = ヴワル!.effects?.[r.effectIndex ?? -1];
        return eff?.timing.kind === "phase" && eff.timing.step === "draw";
      });
      expect(drawStepRegs).toHaveLength(0);
    });

    it("ポスト discard pending は強制 (canSkip=false) かつ alt 「紅魔1枚」を含む", () => {
      // 紅魔タグ付きカードを混ぜた手札（紅魔3枚 + 非紅魔2枚相当）。
      // 本テストではヴワル自体が紅魔タグを持つので 5 枚すべて紅魔。primary 候補=5、alt 候補=5。
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const deckCards = Array.from({ length: 10 }, (_, i) =>
        createCardInstance(ヴワル!, {
          instanceId: `dk-${i}`,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "deck",
        })
      );
      const handCards = Array.from({ length: 5 }, (_, i) =>
        createCardInstance(ヴワル!, {
          instanceId: `hd-${i}`,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "hand",
        })
      );
      const vwalField = createCardInstance(ヴワル!, {
        instanceId: "vwal-mandatory",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        turnNumber: 2,
        step: "core",
        cardInstances: [vwalField, ...deckCards, ...handCards],
        players: base.players.map((p) =>
          p.id === "alice"
            ? { ...p, deckCount: deckCards.length, handCount: handCards.length }
            : p
        ),
      };
      const lookup = buildTriggeredEffectLookup([ヴワル!]);
      const after = advanceStep(state, getCardDefinitionById, lookup);
      const pzs = after.pendingZoneSelection;
      expect(pzs).not.toBeNull();
      // 強制効果なのでスキップ不可
      expect(pzs!.canSkip).toBe(false);
      // alt として「紅魔1枚」が登録される
      expect(pzs!.alternateSelections).toBeDefined();
      expect(pzs!.alternateSelections!).toHaveLength(1);
      expect(pzs!.alternateSelections![0]!.count).toBe(1);
      // ヴワルは紅魔タグを持つので alt 候補 = 全手札（ドロー 3 枚追加で 8 枚）
      expect(
        pzs!.alternateSelections![0]!.candidateInstanceIds.length
      ).toBeGreaterThan(0);
      // primary 上限 3 枚
      expect(pzs!.maxCount).toBe(3);
    });

    it("コア→ドローステップ遷移で +2 ドロー後、discard 選択モーダル (pendingZoneSelection) が開く", () => {
      // alice ターン、step=core に置く → advanceStep でドローステップへ。
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      // ヴワル を alice フィールドに置き、デッキ 10 枚・手札 5 枚を設定。
      const deckCards = Array.from({ length: 10 }, (_, i) =>
        createCardInstance(ヴワル!, {
          instanceId: `deck-${i}`,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "deck",
        })
      );
      const handCards = Array.from({ length: 5 }, (_, i) =>
        createCardInstance(ヴワル!, {
          instanceId: `hand-${i}`,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "hand",
        })
      );
      const vwalField = createCardInstance(ヴワル!, {
        instanceId: "vwal-inline",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      });
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        turnNumber: 2, // 後攻 2ターン目相当 → 先攻スキップ無効
        step: "core",
        cardInstances: [vwalField, ...deckCards, ...handCards],
        players: base.players.map((p) =>
          p.id === "alice"
            ? { ...p, deckCount: deckCards.length, handCount: handCards.length }
            : p
        ),
      };
      const lookup = buildTriggeredEffectLookup([ヴワル!]);
      const after = advanceStep(state, getCardDefinitionById, lookup);
      // ドローステップで +2 ドロー → 手札 5+3=8 (1+2=3 枚ドロー)
      const alice = after.players.find((p) => p.id === "alice")!;
      expect(after.step).toBe("draw");
      expect(alice.handCount).toBe(handCards.length + 3);
      expect(alice.deckCount).toBe(deckCards.length - 3);
      // ポスト discard が pending zone selection を開く
      expect(after.pendingZoneSelection).not.toBeNull();
      // usageLimit が消費される
      const usageRecorded = after.effectUsageRecords.some(
        (r) => r.sourceDefinitionId === ヴワル!.cardNo
      );
      expect(usageRecorded).toBe(true);
    });

    it("同名複数枚でも draw_modify は 1 回しか加算されない (重複しない)", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const deckCards = Array.from({ length: 10 }, (_, i) =>
        createCardInstance(ヴワル!, {
          instanceId: `deck2-${i}`,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "deck",
        })
      );
      const vwalA = createCardInstance(ヴワル!, {
        instanceId: "vwal-a",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      });
      const vwalB = createCardInstance(ヴワル!, {
        instanceId: "vwal-b",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      });
      const handCards = Array.from({ length: 5 }, (_, i) =>
        createCardInstance(ヴワル!, {
          instanceId: `hand2-${i}`,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "hand",
        })
      );
      const state: GameState = {
        ...base,
        activePlayerId: "alice",
        turnNumber: 2,
        step: "core",
        cardInstances: [vwalA, vwalB, ...deckCards, ...handCards],
        players: base.players.map((p) =>
          p.id === "alice"
            ? { ...p, deckCount: deckCards.length, handCount: handCards.length }
            : p
        ),
      };
      const lookup = buildTriggeredEffectLookup([ヴワル!]);
      const after = advanceStep(state, getCardDefinitionById, lookup);
      const alice = after.players.find((p) => p.id === "alice")!;
      // 2 枚あっても draw_modify は重複しないので +2 のまま (1+2=3 枚ドロー)
      expect(alice.handCount).toBe(handCards.length + 3);
      // 救出stashの回帰を再構成。必須破棄まで終えてから別eventを発生させる。
      const discard = (before: GameState) => {
        const pending = before.pendingZoneSelection!;
        expect(pending).not.toBeNull();
        const selectedZoneCardIds = pending.candidateCardInstanceIds.slice(
          0,
          pending.maxCount
        );
        const resolve = getLegalActions({
          state: before,
          actingPlayerId: "alice",
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions: lookup,
        }).find((a) => a.kind === "resolve_pending_zone_selection");
        expect(resolve).toBeDefined();
        const final = applyLegalAction({
          state: before,
          action: resolve!,
          selectedZoneCardIds,
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions: lookup,
        }).state;
        expect(final.pendingZoneSelection).toBeNull();
        expect(final.players.find((p) => p.id === "alice")!.handCount).toBe(
          handCards.length
        );
        for (const id of selectedZoneCardIds) {
          expect(
            final.cardInstances.find((c) => c.instanceId === id)!.zone
          ).toBe("trash");
        }
        return final;
      };
      const afterFirst = discard(after);
      const second = advanceStep(
        { ...afterFirst, pendingExtraSteps: ["draw"] },
        getCardDefinitionById,
        lookup
      );
      expect(second.step).toBe("draw");
      expect(second.players.find((p) => p.id === "alice")!.handCount).toBe(
        handCards.length + 3
      );
      expect(second.players.find((p) => p.id === "alice")!.deckCount).toBe(
        deckCards.length - 6
      );
      const afterSecond = discard(second);
      const records = afterSecond.effectUsageRecords.filter(
        (r) =>
          r.sourceDefinitionId === ヴワル!.cardNo &&
          r.effectLabel === "effect:0"
      );
      expect(records).toHaveLength(2);
      expect(new Set(records.map((r) => r.triggerEventScopeKey)).size).toBe(2);
    });
  });

  describe("effects[1] Lv2 メインステップ シンボル追加", () => {
    it("Lv2 (1 コア) でライフ1個を払い、赤/紫のシンボルを2つ同時に得る", () => {
      const state = buildStateWithVwal("vwal-lv2", 1);
      // effects[1] は activated/main symbol_add (Lv2 制限)
      const effect = ヴワル!.effects![1]!;
      const result = executeEffect({
        chainId: "test:bsth01-c12-vwal-library:293",
        state,
        effect,
        sourceInstanceId: "vwal-lv2",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const symbolCEs = result.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag === "symbol_addition" &&
          ce.targetInstanceId === "vwal-lv2"
      );
      // 1 CE の count=2 で、赤/紫のシンボル2つを一つの条件結果として付与する。
      expect(symbolCEs).toHaveLength(1);
      expect(symbolCEs[0]!.modifierSymbolCount).toBe(2);
      for (const ce of symbolCEs) {
        expect(ce.modifierSymbol).toEqual(["red", "purple"]);
      }
    });

    it("dual-color シンボルは getEffectiveSymbolBundles で 1 bundle = 2 色として表現される", () => {
      const state = buildStateWithVwal("vwal-dual", 1);
      const effect = ヴワル!.effects![1]!;
      const after = executeEffect({
        chainId: "test:bsth01-c12-vwal-library:315",
        state,
        effect,
        sourceInstanceId: "vwal-dual",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const card = after.cardInstances[0]!;
      const bundles = getEffectiveSymbolBundles(
        after,
        card,
        ヴワル!,
        getCardDefinitionById
      );
      // ネクサスは元シンボル 0、追加で dual-color 2 シンボル = 1 bundle (colors: [purple,red], count: 2)
      expect(bundles).toHaveLength(1);
      expect(bundles[0]!.colors.sort()).toEqual(["purple", "red"]);
      expect(bundles[0]!.count).toBe(2);
    });

    it("dual-color シンボルは赤・紫両方の reduction として getEffectiveSymbols に含まれる", () => {
      const state = buildStateWithVwal("vwal-red-purple", 1);
      const effect = ヴワル!.effects![1]!;
      const after = executeEffect({
        chainId: "test:bsth01-c12-vwal-library:338",
        state,
        effect,
        sourceInstanceId: "vwal-red-purple",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const card = after.cardInstances[0]!;
      const symbols = getEffectiveSymbols(
        after,
        card,
        ヴワル!,
        getCardDefinitionById
      );
      // dual-color × 2 シンボル → 各色を flat → red×2 + purple×2 (元 0 個)
      const reds = symbols.filter((s) => s === "red").length;
      const purples = symbols.filter((s) => s === "purple").length;
      expect(reds).toBe(2);
      expect(purples).toBe(2);
    });

    it("Lv1 (0 コア) ではコスト未満のため legal-action として現れない (applicability)", () => {
      const state = buildStateWithVwal("vwal-lv1", 0);
      const fieldRegs = generateFieldCardEffectRegistrations(ヴワル!);
      // 登録は 1 件 (effects[1] のみ activated/main)
      expect(fieldRegs).toHaveLength(1);
      expect(fieldRegs[0]!.applicability?.level?.min).toBe(2);

      // legal action 取得
      const legals = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: (cardNo) =>
          cardNo === ヴワル!.cardNo ? fieldRegs : undefined,
      });
      const fieldEffectActions = legals.filter(
        (a) => a.kind === "use_field_card_effect"
      );
      expect(fieldEffectActions).toHaveLength(0);
    });

    it("Lv2 (1 コア) ではメイン効果発揮の legal action が現れる", () => {
      const state = buildStateWithVwal("vwal-lv2-action", 1);
      const fieldRegs = generateFieldCardEffectRegistrations(ヴワル!);
      const legals = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: (cardNo) =>
          cardNo === ヴワル!.cardNo ? fieldRegs : undefined,
      });
      const fieldEffectActions = legals.filter(
        (a) => a.kind === "use_field_card_effect"
      );
      expect(fieldEffectActions.length).toBeGreaterThan(0);
    });

    it("[board] 同名の別ネクサスは、1枚目の発揮・解決後に同一ターンでは使えない", () => {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const vwalA = createCardInstance(ヴワル!, {
        instanceId: "vwal-same-name-a",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const vwalB = createCardInstance(ヴワル!, {
        instanceId: "vwal-same-name-b",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const registrations = generateFieldCardEffectRegistrations(ヴワル!);
      const lookups = {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
          ヴワル!,
        ]),
        getRegisteredFieldCardEffectActions: (cardNo: string) =>
          cardNo === ヴワル!.cardNo ? registrations : undefined,
      };
      let state: GameState = {
        ...base,
        activePlayerId: "alice",
        step: "main",
        turnNumber: 2,
        cardInstances: [vwalA, vwalB],
        players: base.players.map((player) =>
          player.id === "alice" ? { ...player, lifeNormalCoreCount: 4 } : player
        ),
      };

      const firstAction = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).find(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "vwal-same-name-a"
      );
      expect(firstAction).toBeDefined();

      state = applyLegalAction({
        state,
        action: firstAction!,
        ...lookups,
      }).state;
      // 起動効果の宣言後はスタック窓を閉じてから実効果を解決する。
      while (state.stackWindow !== null) {
        const pass = getLegalActions({
          state,
          actingPlayerId: state.stackWindow.priorityPlayerId,
          ...lookups,
        }).find((action) => action.kind === "pass_stack");
        expect(pass).toBeDefined();
        state = applyLegalAction({ state, action: pass!, ...lookups }).state;
      }

      const alice = state.players.find((player) => player.id === "alice")!;
      // 実際にライフのコアをトラッシュへ移し、2つの追加シンボルを得る。
      expect(alice.lifeNormalCoreCount).toBe(3);
      expect(alice.trashNormalCoreCount).toBe(1);
      expect(
        state.activeContinuousEffects.filter(
          (effect) =>
            effect.modifierTag === "symbol_addition" &&
            effect.targetInstanceId === "vwal-same-name-a"
        )
      ).toHaveLength(1);
      expect(
        getEffectiveSymbolBundles(state, vwalA, ヴワル!, getCardDefinitionById)
      ).toEqual([{ colors: ["red", "purple"], count: 2 }]);

      // 「ターンに1回しか使えない」は同名全体で共有するため、2枚目は候補に残らない。
      const subsequentActions = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      });
      expect(
        subsequentActions.some(
          (action) =>
            action.kind === "use_field_card_effect" &&
            action.sourceInstanceId === "vwal-same-name-b"
        )
      ).toBe(false);
    });

    it("シンボル追加 CE はメインステップを離れると失効する (scope:step)", () => {
      // turnNumber=2 で先攻スキップを無効化し、main→attack 遷移を起こす。
      const base = buildStateWithVwal("vwal-step-expire", 1, "main");
      const state: GameState = { ...base, turnNumber: 2 };
      const effect = ヴワル!.effects![1]!;
      const afterUse = executeEffect({
        chainId: "test:bsth01-c12-vwal-library:491",
        state,
        effect,
        sourceInstanceId: "vwal-step-expire",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      // 発揮直後は dual-color 2個を持つ CE が1件存在。
      expect(
        afterUse.activeContinuousEffects.filter(
          (ce) =>
            ce.modifierTag === "symbol_addition" &&
            ce.targetInstanceId === "vwal-step-expire"
        )
      ).toHaveLength(1);

      // main → attack へ遷移するとステップ限定効果は失効する。
      const lookup = buildTriggeredEffectLookup([ヴワル!]);
      const afterStep = advanceStep(afterUse, getCardDefinitionById, lookup);
      expect(afterStep.step).toBe("attack");
      expect(
        afterStep.activeContinuousEffects.filter(
          (ce) =>
            ce.modifierTag === "symbol_addition" &&
            ce.targetInstanceId === "vwal-step-expire"
        )
      ).toHaveLength(0);
      // ネクサスの実効シンボルも元の 0 個へ戻る。
      const card = afterStep.cardInstances.find(
        (c) => c.instanceId === "vwal-step-expire"
      )!;
      const symbols = getEffectiveSymbols(
        afterStep,
        card,
        ヴワル!,
        getCardDefinitionById
      );
      expect(symbols).toHaveLength(0);
    });

    it("コスト (ライフ→トラッシュ core_move) を実行するとライフが 1 個減る", () => {
      const state = buildStateWithVwal("vwal-cost", 1, "main", {
        lifeCount: 4,
      });
      const effect = ヴワル!.effects![1]!;
      const after = executeEffect({
        chainId: "test:bsth01-c12-vwal-library:536",
        state,
        effect,
        sourceInstanceId: "vwal-cost",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const alice = after.players.find((p) => p.id === "alice")!;
      expect(alice.lifeNormalCoreCount).toBe(3);
      expect(alice.trashNormalCoreCount).toBe(1);
    });
  });

  describe("メイン効果発揮で effects[0] (inline draw step) が誤発動しないこと", () => {
    it("メイン効果発揮 (effects[1]) では inline draw step (effects[0]) の discard が走らない", () => {
      // メイン効果発揮 (= effects[1] のみを直接 executeEffect) で実行されるため、
      // effects[0] (inline draw step) が走る経路はそもそも executeEffect を別途呼ばない限り起きない。
      // 「effects[1] 実行で discard 系 zone 移動が起きないこと」を確認することで、
      // legal-actions-apply 経由の field_card_effect が effects[0] discard を誤発動しないことを保証する。
      const state = buildStateWithVwal("vwal-no-discard", 1, "main", {
        lifeCount: 4,
      });
      const baseHandSize = state.players[0]!.handCount;
      const effect = ヴワル!.effects![1]!;
      const after = executeEffect({
        chainId: "test:bsth01-c12-vwal-library:560",
        state,
        effect,
        sourceInstanceId: "vwal-no-discard",
        actingPlayerId: "alice",
        getCardDefinitionById,
      });
      const alice = after.players.find((p) => p.id === "alice")!;
      // メイン効果発揮では手札 discard は起きない
      expect(alice.handCount).toBe(baseHandSize);
    });
  });
});
