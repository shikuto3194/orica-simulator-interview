import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * P3-86 Phase 2 (Q3): 咲夜 BSTH01-X05 が手札に 2 枚あるとき、1 枚目が相手フラッシュを
 * 無効化すると、2 枚目は「無効にする」対象を失い不発 (fizzle) になる (ことで双方向)。
 * あわせて案X 順序 (相手フラッシュが応答窓にいる間は declare 不可 → パス →
 * 発揮前チェックポイントで declare) を検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queueFlashUsedTriggers,
} from "../src";
import type {
  ActiveStack,
  CardDefinition,
  GameState,
  StackWindow,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

const 咲夜 = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X05")!;

const フラッシュマジック: CardDefinition = {
  cardNo: "P3-86-FLASH-MAGIC",
  name: "P3-86 フラッシュマジック",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const lookup = (() => {
  const map = new Map<string, CardDefinition>([
    [咲夜.cardNo, 咲夜],
    [フラッシュマジック.cardNo, フラッシュマジック],
  ]);
  return (definitionId: string) => map.get(definitionId);
})();
const triggerLookup = buildTriggeredEffectLookup([咲夜, フラッシュマジック]);
const lookups = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: triggerLookup,
  getRegisteredMagicActions: buildMagicLookup([咲夜, フラッシュマジック]),
  getRegisteredBattleImmediateEffectActions: buildBattleImmediateEffectLookup([
    咲夜,
    フラッシュマジック,
  ]),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
    咲夜,
    フラッシュマジック,
  ]),
  getRegisteredBurstActions: buildBurstEffectLookup([咲夜, フラッシュマジック]),
};

function bobMagicStack(): ActiveStack {
  return {
    stackId: "stack:bob-magic",
    actionKind: "magic",
    chainId: "chain:bob-magic",
    actingPlayerId: "bob",
    cardInstanceId: "bob-flash-1",
    cardDefinitionId: フラッシュマジック.cardNo,
    chosenTiming: "flash",
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
}

/** alice 手札に咲夜 2 枚、bob の使用済みフラッシュが stackWindow に保留中の盤面。 */
function buildState(): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(咲夜, {
        instanceId: "sakuya-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(咲夜, {
        instanceId: "sakuya-2",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(フラッシュマジック, {
        instanceId: "bob-flash-1",
        ownerPlayerId: "bob",
        zone: "in_use",
      }),
    ],
    playerOverrides: [{ id: "alice", reserveNormalCoreCount: 4 }, {}],
  });
  const stackWindow: StackWindow = {
    priorityPlayerId: "alice",
    consecutivePassCount: 0,
    actingPlayerId: "bob",
    previousWindow: "none",
    stackResponseSourcePlayerId: "bob",
    subStackEverOpened: false,
    burstWindowKind: null,
    pendingStackAction: bobMagicStack(),
  };
  return {
    ...base,
    step: "attack",
    activePlayerId: "alice",
    window: "stack",
    stackWindow,
  };
}

describe("P3-86 Phase 2 (Q3): 咲夜 2 枚目はことで双方向で不発 (fizzle)", () => {
  it("相手フラッシュ使用 → 咲夜 2 枚誘発 → 窓中は declare 不可 → 両方宣言 → 1枚目の召喚成功後に2枚目は対価を払わず不発", () => {
    const state = buildState();

    // 相手フラッシュ使用で 2 枚とも誘発し、非公開キューに 2 件乗る。
    const queued = queueFlashUsedTriggers({
      chainId: "test:p3-86-x05-double-copy-fizzle:117",
      state,
      flashSourceInstanceId: "bob-flash-1",
      userPlayerId: "bob",
      flashSourceFromZone: "hand",
      ...lookups,
      getRegisteredBurstActions: () => undefined,
    });
    expect(queued.pendingPrivateDeclarations).toHaveLength(2);

    // 案X: 相手フラッシュが応答窓にいる間、declare は deferred (不可)。
    expect(
      getLegalActions({
        state: queued,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.kind === "declare_private_triggered_effect")
    ).toBeUndefined();

    // alice がスタックパス → 発揮前チェックポイント (pendingStackCascade 退避)。
    const passStack = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    expect(passStack).toBeDefined();
    const afterPass = applyLegalAction({
      state: queued,
      action: passStack!,
      ...lookups,
    }).state;
    expect(afterPass.pendingStackCascade).not.toBeNull();

    // チェックポイントで非 deferred 化された 2 件 (同一オーナー) は両方の declare/skip が
    // 並列 surface する: owner は ActionBar / overlay の focus で 1 件を選んで実行する
    // (engine 側に明示の select ステップは置かない)。
    const declareActions = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    }).filter((a) => a.kind === "declare_private_triggered_effect");
    expect(declareActions).toHaveLength(2);
    expect(declareActions.map((a) => a.sourceInstanceId).sort()).toEqual([
      "sakuya-1",
      "sakuya-2",
    ]);

    const sakuya1Declare = declareActions.find(
      (a) => a.sourceInstanceId === "sakuya-1"
    );
    expect(sakuya1Declare).toBeDefined();
    const afterDeclare = applyLegalAction({
      state: afterPass,
      action: sakuya1Declare!,
      ...lookups,
    }).state;

    // 宣言では召喚も無効化もしないため、2枚目も宣言できる。
    expect(afterDeclare.pendingPrivateDeclarations).toHaveLength(1);
    expect(
      afterDeclare.cardInstances.find((c) => c.instanceId === "bob-flash-1")
        ?.zone
    ).toBe("in_use");
    expect(
      afterDeclare.log.some((line) => line.startsWith("magic:nullified:"))
    ).toBe(false);
    const secondDeclare = getLegalActions({
      state: afterDeclare,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (a) =>
        a.kind === "declare_private_triggered_effect" &&
        a.sourceInstanceId === "sakuya-2"
    );
    expect(secondDeclare).toBeDefined();
    let cur = applyLegalAction({
      state: afterDeclare,
      action: secondDeclare!,
      ...lookups,
    }).state;
    expect(cur.pendingTriggeredEffects).toHaveLength(2);
    const trace: string[] = [];
    for (let guard = 0; guard < 30; guard++) {
      cur = finishCoreChoices(cur, lookup, lookups);
      if (
        cur.pendingTriggeredEffects.length === 0 &&
        cur.pendingPrivateDeclarations.length === 0 &&
        cur.pendingStackCascade === null
      )
        break;
      let advanced = false;
      for (const pid of ["alice", "bob"]) {
        const actions = getLegalActions({
          state: cur,
          actingPlayerId: pid,
          ...lookups,
        }).filter((a) => a.can);
        const next = [
          "select_pending_to_resolve",
          "resolve_pending_triggered_effect",
          "resolve_pending_burst_check",
          "decline_pending_burst_check",
          "pass_stack",
          "pass_battle_flash",
          "pass_pre_declaration_stack",
        ].flatMap((kind) => actions.filter((a) => a.kind === kind))[0];
        if (!next) continue;
        trace.push(`${pid}:${next.kind}`);
        cur = applyLegalAction({
          state: cur,
          action: next,
          ...(next.kind === "resolve_pending_triggered_effect" && next.skipOnly
            ? { skipOptionalEffect: true }
            : {}),
          ...lookups,
        }).state;
        advanced = true;
        break;
      }
      if (!advanced)
        throw new Error(
          `double-counter stalled: ${trace.join(" -> ")} actions=${JSON.stringify(["alice", "bob"].map((pid) => getLegalActions({ state: cur, actingPlayerId: pid, ...lookups }).map((a) => ({ kind: a.kind, can: a.can }))))}`
        );
    }
    // 1枚目だけが維持コア1個を払い召喚。2枚目は無効化対象が消えたので手札のまま。
    expect(
      cur.cardInstances.find((c) => c.instanceId === "sakuya-1")?.zone
    ).toBe("field");
    expect(
      cur.cardInstances.find((c) => c.instanceId === "sakuya-2")?.zone
    ).toBe("hand");
    expect(
      cur.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(3);
    expect(
      cur.cardInstances.find((c) => c.instanceId === "bob-flash-1")?.zone
    ).toBe("trash");
    expect(
      cur.log.filter((line) => line.startsWith("magic:nullified:"))
    ).toHaveLength(1);
    expect(cur.pendingTriggeredEffects).toHaveLength(0);
    expect(cur.pendingPrivateDeclarations).toHaveLength(0);
    expect(cur.pendingStackNegateRequests).toHaveLength(0);
    expect(cur.pendingStackCascade).toBeNull();
  });
});
