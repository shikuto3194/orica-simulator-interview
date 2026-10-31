/**
 * BSTH08.5-R12 effects[1] (accelData): 「メイン【アクセル：コスト4<赤><赤>（この効果は
 * 手札から使用できる）】手札にある系統：「面霊」を持つカードを好きなだけオープンして
 * 手元に置く。その後、手元に置いたカード1枚につき自分はデッキから1枚ドローする。」
 * (ENGINE-move-card-actual-count-amount)
 *
 * primitives:
 * - 「好きなだけオープンして手元に置く」= move_card(target:{kind:"filter", count:{min:0}},
 *   from:{zone:"hand", filter:{tribes:["面霊"]}}, to:{zone:"set_aside"}) — 既存の
 *   budget 選択 (destroy/vanish 等) と同型の一般選択パイプライン、新規プリミティブ不要。
 * - 「手元に置いた枚数につき1枚ドロー」= 前段 move_card の StepResult.numericAmount
 *   (実際に移動した枚数、effect-interpreter.ts に新規配線) を後段 draw が
 *   count:{source:{kind:"step_numeric_amount"}} で参照する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const lk = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => undefined,
};

describe("BSTH08.5-R12 effects[1]: 面霊オープン→手元→枚数分ドロー (ENGINE-move-card-actual-count-amount)", () => {
  const r12 = cardNoMap.get("BSTH08.5-R12")!;
  const c20 = cardNoMap.get("BSTH08.5-C20")!;
  // 面霊ではない filler（フィルタ対象外の確認用）
  const filler = cardNoMap.get("BSKB01-M01")!;

  function buildState(): GameState {
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(r12, {
          instanceId: "r12-1",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(c20, {
          instanceId: "mensou-a",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(c20, {
          instanceId: "mensou-b",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(c20, {
          instanceId: "mensou-c",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        createCardInstance(filler, {
          instanceId: "non-mensou",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        ...Array.from({ length: 5 }, (_, i) =>
          createCardInstance(filler, {
            instanceId: `deck-${i}`,
            ownerPlayerId: ALICE,
            zone: "deck",
          })
        ),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 20 }, {}],
    });
    return { ...base, step: "main", activePlayerId: ALICE };
  }

  function passStackBothSides(state: GameState): GameState {
    let current = state;
    for (const actingPlayerId of [ALICE, BOB]) {
      if (!current.stackWindow) break;
      const pass = getLegalActions({
        state: current,
        actingPlayerId,
        ...lk,
      }).find((a) => a.kind === "pass_stack");
      if (!pass) continue;
      current = applyLegalAction({ state: current, action: pass, ...lk }).state;
    }
    return current;
  }

  it("面霊3枚のうち2枚を選んで手元へ→選んだ2枚ぶんだけドローする（盤面変化検証）", () => {
    const state = buildState();

    const useAccel = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lk,
    }).find((a) => a.kind === "use_accel" && a.sourceInstanceId === "r12-1");
    expect(useAccel).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: useAccel!,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      ...lk,
    }).state;
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe("accel");

    const resolved = passStackBothSides(declared);

    // move_card の対象選択 pending: 候補は面霊3枚のみ (non-mensou は候補外)。
    const targetAction = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      ...lk,
    }).find((a) => a.kind === "resolve_pending_step_optional_target_selection");
    expect(targetAction).toBeDefined();
    expect(targetAction!.candidateTargetInstanceIds.sort()).toEqual(
      ["mensou-a", "mensou-b", "mensou-c"].sort()
    );

    const handSizeBeforeDraw = resolved.cardInstances.filter(
      (c) => c.ownerPlayerId === ALICE && c.zone === "hand"
    ).length;

    const afterTarget = applyLegalAction({
      state: resolved,
      action: targetAction!,
      targetInstanceIds: ["mensou-a", "mensou-b"],
      ...lk,
    }).state;

    // 選んだ2枚だけ手元へ移動、選ばなかった1枚は手札に残る。
    expect(
      afterTarget.cardInstances.find((c) => c.instanceId === "mensou-a")?.zone
    ).toBe("set_aside");
    expect(
      afterTarget.cardInstances.find((c) => c.instanceId === "mensou-b")?.zone
    ).toBe("set_aside");
    expect(
      afterTarget.cardInstances.find((c) => c.instanceId === "mensou-c")?.zone
    ).toBe("hand");

    // 選んだ枚数(2)ぶんだけデッキからドローする（3枚でも0枚でもなく、実選択数に一致）。
    const deckRemaining = afterTarget.cardInstances.filter(
      (c) => c.ownerPlayerId === ALICE && c.zone === "deck"
    ).length;
    expect(deckRemaining).toBe(3);
    const handSizeAfterDraw = afterTarget.cardInstances.filter(
      (c) => c.ownerPlayerId === ALICE && c.zone === "hand"
    ).length;
    // 手元へ2枚出た分手札は減り、ドロー2枚分手札は増える → 差し引きで手札枚数は変わらない。
    expect(handSizeAfterDraw).toBe(handSizeBeforeDraw - 2 + 2);
  });
});
