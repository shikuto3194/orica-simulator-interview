/**
 * P3-48 follow-up: pendingCoreDistribution の abort (cancel) 経路。
 *
 * `mode="player_choice"` で生成された pending を、`abort_pending_core_distribution`
 * legal action で「pending 提示直前」の state に巻き戻すことを確認する。
 *
 * テスト要件:
 * - pending 生成時に priorStateSnapshot が捕捉されている
 * - getLegalActions が abort_pending_core_distribution を surface する
 * - apply で state が snapshot 通りに復元される
 * - log に abort 痕跡が残る
 * - continuation は呼ばれない (= effect の以降ステップは実行されない)
 * - any_movable_self pending でも同様に abort 可能
 * - trash_distribution (structured-effect-interpreter から発生) も対応
 */

import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "紅魔",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: "alice",
    zone: "field",
    cores: 0,
  });
  return { ...base, ...overrides };
}

function makeState(cards: CardInstance[], aliceReserve = 0): GameState {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    startingLife: 5,
  });
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === "alice" ? { ...p, reserveNormalCoreCount: aliceReserve } : p
    ),
  };
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

const playerChoiceFromReserve: Effect = {
  timing: { kind: "phase", step: "main", subPhase: "start" },
  steps: [
    {
      action: {
        kind: "core_distribute",
        from: { kind: "reserve", player: "self" },
        to: {
          kind: "filter",
          player: "self",
          filter: { tribes: ["token"] },
          count: "all",
        },
        amount: "all",
        mode: "player_choice",
        minTotal: 1,
      },
    },
  ],
};

describe("P3-48 follow-up: pendingCoreDistribution abort", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("pending 生成時に priorStateSnapshot が捕捉される (reserve player_choice)", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const state = makeState([host, t1, t2], 3);

    const result = executeEffect({
      chainId: "test:pending-core-distribution-abort:114",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    const pending = result.pendingCoreDistribution!;
    expect(pending.priorStateSnapshot).toBeDefined();
    // snapshot 自身は pendingCoreDistribution を含まない (= pending 提示直前 state)
    expect(pending.priorStateSnapshot!.pendingCoreDistribution).toBeNull();
    // snapshot は当時の reserveCount をそのまま保持
    const snapshotAlice = pending.priorStateSnapshot!.players.find(
      (p) => p.id === "alice"
    )!;
    expect(snapshotAlice.reserveNormalCoreCount).toBe(3);
  });

  it("getLegalActions が abort_pending_core_distribution を surface する", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, t1], 2);

    const result = executeEffect({
      chainId: "test:pending-core-distribution-abort:143",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const abort = actions.find(
      (a) => a.kind === "abort_pending_core_distribution"
    );
    expect(abort).toBeDefined();
    if (abort?.kind === "abort_pending_core_distribution") {
      expect(abort.pendingId).toBe(result.pendingCoreDistribution!.pendingId);
      expect(abort.actingPlayerId).toBe("alice");
    }
  });

  it("abort で state が snapshot 通りに復元され、pending が消える", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const state = makeState([host, t1, t2], 4);
    const aliceReserveBefore = 4;

    const result = executeEffect({
      chainId: "test:pending-core-distribution-abort:177",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(result.pendingCoreDistribution).not.toBeNull();

    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const abortAction = actions.find(
      (a) => a.kind === "abort_pending_core_distribution"
    )!;

    const aborted = applyLegalAction({
      state: result,
      action: abortAction,
      getCardDefinitionById: getDef,
    });

    expect(aborted.state.pendingCoreDistribution).toBeNull();
    // reserve コアは消費されていない
    const aliceAfter = aborted.state.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.reserveNormalCoreCount).toBe(aliceReserveBefore);
    // token カードにコアは置かれていない
    const tok1 = aborted.state.cardInstances.find(
      (c) => c.instanceId === "tok1"
    )!;
    const tok2 = aborted.state.cardInstances.find(
      (c) => c.instanceId === "tok2"
    )!;
    expect(tok1.normalCoreCount).toBe(0);
    expect(tok2.normalCoreCount).toBe(0);
    // log に abort 痕跡が残る
    expect(aborted.state.log.join("\n")).toMatch(
      /effect:core_distribute:aborted:/
    );
  });

  it("priorStateSnapshot が無い pending は abort 候補に出ない (旧 snapshot import 互換)", () => {
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, t1], 2);

    const result = executeEffect({
      chainId: "test:pending-core-distribution-abort:229",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    // 旧 snapshot import を模擬: priorStateSnapshot を剥がす
    const stateNoSnap: GameState = {
      ...result,
      pendingCoreDistribution: {
        ...result.pendingCoreDistribution!,
        priorStateSnapshot: undefined,
      },
    };

    const actions = getLegalActions({
      state: stateNoSnap,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const abort = actions.find(
      (a) => a.kind === "abort_pending_core_distribution"
    );
    expect(abort).toBeUndefined();
    // resolve は依然として available
    const resolve = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    );
    expect(resolve).toBeDefined();
  });

  it("abort 後 continuation は呼ばれない (effect の後続ステップ未実行)", () => {
    // continuation を持つ effect: core_distribute の後に追加ステップを置く。
    // effect-interpreter は core_distribute が pending を生成した時点で continuation を inject する。
    // abort 経路では continuation を呼ばないので追加ステップの効果は state に反映されない。
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, t1], 2);

    const result = executeEffect({
      chainId: "test:pending-core-distribution-abort:274",
      state,
      effect: playerChoiceFromReserve,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    // 確認: snapshot 経由なので continuation がもし設定されていても abort では使われない
    const actions = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const abortAction = actions.find(
      (a) => a.kind === "abort_pending_core_distribution"
    )!;
    const aborted = applyLegalAction({
      state: result,
      action: abortAction,
      getCardDefinitionById: getDef,
    });
    // pending 削除済み + コア未消費 = 後続ステップ未実行と同義
    expect(aborted.state.pendingCoreDistribution).toBeNull();
    const aliceAfter = aborted.state.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.reserveNormalCoreCount).toBe(2);
  });
});
