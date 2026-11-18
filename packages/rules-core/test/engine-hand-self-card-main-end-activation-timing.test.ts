/**
 * engine-hand-self-card-main-end-activation-timing:
 * 「手札にあるこのカードは、自分のメインステップ終了時に使用できる」型の magic 使用タイミング。
 *
 * 従来 `isTimingScopeActive` は player/period のみを見ており、`TimingScope.subPhase`
 * (型には存在していた) を無視していたため、「メインステップ終了時」限定の magic 使用可否を
 * メインステップ全体で一律許可/一律禁止するしかなかった (BSTH02.7-C01 effects[1])。
 *
 * 本 PR で:
 *  - `isTimingScopeActive` が `currentSubPhase` 引数を受け取り、`scope.subPhase` と照合する。
 *  - `getAvailableMagicLegalActions` は `state.window === "step_end"` のときだけ subPhase:"end"
 *    を満たしたとみなす。
 *  - `advanceStep` は、triggered reaction が無くても `timingScope.subPhase === "end"` の
 *    手札/手元 magic が使用可能なら、既存の pending-reaction 窓と同じ `window: "step_end"` で
 *    ステップ遷移前に一旦停止する (`hasEligibleMainStepEndMagicActivation`)。
 *
 * 検証:
 *  1. メインステップ中 (window:"none") では use_magic legal action が出ない。
 *  2. メインステップを離れようとすると (advanceStep) window:"step_end" で停止し、
 *     ステップは "main" のまま。
 *  3. その状態では use_magic legal action が出る。
 *  4. 2 回目の advanceStep 呼び出しで実際に次ステップへ進む。
 */
import { describe, expect, it } from "vitest";
import {
  advanceStep,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

function magicDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

const MAGIC_NO = "TEST-MAIN-END-MAGIC";
const magic = magicDef(MAGIC_NO);
const defs = new Map([[magic.cardNo, magic]]);
const getCardDefinitionById = (id: string) => defs.get(id);

const magicLookup = (cardNo: string) =>
  cardNo === MAGIC_NO
    ? [
        {
          timing: "main" as const,
          reason: "test_main_step_end_magic",
          timingScope: {
            player: "self" as const,
            period: "main" as const,
            subPhase: "end" as const,
          },
        },
      ]
    : undefined;

function buildState(): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  return {
    ...base,
    step: "main",
    window: "none",
    activePlayerId: ALICE,
    cardInstances: [
      createCardInstance(magic, {
        instanceId: "magic-1",
        ownerPlayerId: ALICE,
        zone: "hand",
      }),
    ],
  };
}

function useMagicActionsFor(state: GameState) {
  return getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredMagicActions: magicLookup,
  }).filter((a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1");
}

describe("engine-hand-self-card-main-end-activation-timing", () => {
  it("メインステップ中 (window:none) では use_magic legal action が出ない", () => {
    const state = buildState();
    expect(useMagicActionsFor(state)).toHaveLength(0);
  });

  it("advanceStep はメインステップを離れる前に window:step_end で一旦停止する (step は main のまま)", () => {
    const state = buildState();
    const after = advanceStep(
      state,
      getCardDefinitionById,
      () => [],
      undefined,
      magicLookup
    );
    expect(after.step).toBe("main");
    expect(after.window).toBe("step_end");
  });

  it("window:step_end に入ると use_magic legal action が出る", () => {
    const state = buildState();
    const after = advanceStep(
      state,
      getCardDefinitionById,
      () => [],
      undefined,
      magicLookup
    );
    expect(useMagicActionsFor(after)).toHaveLength(1);
  });

  it("window:step_end で 2 回目の advanceStep を呼ぶと実際に次ステップへ進む", () => {
    const state = buildState();
    const paused = advanceStep(
      state,
      getCardDefinitionById,
      () => [],
      undefined,
      magicLookup
    );
    const advanced = advanceStep(
      paused,
      getCardDefinitionById,
      () => [],
      undefined,
      magicLookup
    );
    expect(advanced.step).not.toBe("main");
  });

  it("timingScope.subPhase の登録が無いカードは従来どおり main step 全体で使用可能 (回帰なし)", () => {
    const alwaysMainLookup = (cardNo: string) =>
      cardNo === MAGIC_NO
        ? [{ timing: "main" as const, reason: "test_plain_main_magic" }]
        : undefined;
    const state = buildState();
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredMagicActions: alwaysMainLookup,
    }).filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1"
    );
    expect(actions).toHaveLength(1);

    // 通常 main-timing magic だけの盤面では advanceStep が余計な一時停止を挟まない。
    const after = advanceStep(
      state,
      getCardDefinitionById,
      () => [],
      undefined,
      alwaysMainLookup
    );
    expect(after.window).not.toBe("step_end");
  });
});
