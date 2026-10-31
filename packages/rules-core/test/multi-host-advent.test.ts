/**
 * BSSG01-X03「暁 切歌＆月読 調『アマルガム』」: 多重煌臨 (1宣言で2 host に同時に重ねる)。
 *
 * 「自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリット2体に手札から
 * 重ねる。」を CardDefinition.dualHostAdventData + declare_dual_host_advent
 * (mechanics/multi-host-advent.ts) で表現する。
 *
 * 裁定確定 (2026-08-01、ユーザー確認、10_rules/08a_advent-rebirth-contract.md §多重煌臨):
 * 対象2体を1つの煌臨元スタックへ統合し X03 がその頂上に乗る。プレイヤーが選んだ「上」
 * (targetInstanceIds[0]) は通常の状態引き継ぎ、「下」(targetInstanceIds[1]) は単純に
 * 畳まれる。維持コアは両方合算して統合後インスタンスへ引き継ぐ。
 *
 * P3-133 / autorun-queue/needs-dsl.audit.jsonl: ENGINE-multi-host-advent。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
  LegalAction,
} from "../src";
import { adventSourceIdsOf } from "../src/model";
import { evaluateCondition } from "../src/effect/structured-condition-eval";
import {
  executeRestrictAdvent,
  executeRestrictFlash,
} from "../src/effect/structured-continuous-effects";
import { adventFlashPosition } from "./advent-flash-position";

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
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

const AMALGAM_NO = "BSSG01-X03"; // 暁 切歌＆月読 調「アマルガム」
const AKATSUKI_NO = "BSSG01-C03"; // 暁 切歌「イガリマ-GX-」(コスト4)
const TSUKUYOMI_NO = "BSSG01-C04"; // 月読 調「シャルシャガナ-GX-」(コスト4)

function getCard(state: GameState, id: string) {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const pass = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById,
      ...effectLookups,
    }).find((a) => a.kind === "pass_stack");
    if (!pass) throw new Error(`pass_stack for ${responderId} not found`);
    current = applyLegalAction({
      state: current,
      action: pass,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
  }
  return current;
}

function resolvePendingEffectTarget(
  state: GameState,
  targetInstanceIds: string[]
): GameState {
  const pending = state.pendingEffectTargetSelection;
  expect(pending).not.toBeNull();
  const resolveAction = getLegalActions({
    state,
    actingPlayerId: pending!.actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  }).find(
    (a): a is Extract<LegalAction, { kind: "resolve_pending_effect_target" }> =>
      a.kind === "resolve_pending_effect_target"
  );
  expect(resolveAction).toBeDefined();
  for (const id of targetInstanceIds) {
    expect(resolveAction!.candidateTargetInstanceIds).toContain(id);
  }
  return applyLegalAction({
    state,
    action: resolveAction!,
    targetInstanceIds,
    getCardDefinitionById,
    ...effectLookups,
  }).state;
}

function buildState(): GameState {
  const amalgam = createCardInstance(card(AMALGAM_NO), {
    instanceId: "amalgam-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const akatsuki = createCardInstance(card(AKATSUKI_NO), {
    instanceId: "akatsuki-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });
  const tsukuyomi = createCardInstance(card(TSUKUYOMI_NO), {
    instanceId: "tsukuyomi-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 3,
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      {
        handCount: 1,
        soulCoreLocation: { kind: "reserve" },
        reserveNormalCoreCount: 2,
      },
      {},
    ],
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    window: "none",
    cardInstances: [amalgam, akatsuki, tsukuyomi],
  };
}

describe("BSSG01-X03 多重煌臨 (declare_dual_host_advent)", () => {
  it("手札フラッシュ禁止は多重煌臨にも適用する", () => {
    const before = adventFlashPosition(buildState());
    const legal = (state: GameState) =>
      getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        ...effectLookups,
      }).some((action) => action.kind === "declare_dual_host_advent");
    expect(legal(before)).toBe(true);
    const after = executeRestrictFlash(
      before,
      BOB,
      {
        kind: "restrict_flash",
        player: "opponent",
        source: "hand",
        duration: { scope: "battle" },
      },
      "tsukuyomi-1"
    );
    expect(legal(after)).toBe(false);
  });
  it("煌臨禁止は多重煌臨の宣言にも適用する", () => {
    const state = buildState();
    state.activeContinuousEffects.push({
      effectId: "audit-restrict",
      sourceInstanceId: "tsukuyomi-1",
      targetInstanceId: ALICE,
      modifierTag: "restrict_advent",
      duration: { scope: "this_turn" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
    });
    expect(
      getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        ...effectLookups,
      }).some((action) => action.kind === "declare_dual_host_advent")
    ).toBe(false);
  });
  it("窓中に煌臨禁止が適用されたら多重煌臨は不発でソウルコアを使わない", () => {
    const before = buildState();
    const action = getLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    }).find((action) => action.kind === "declare_dual_host_advent")!;
    const state = applyLegalAction({
      state: before,
      action,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    const restricted = executeRestrictAdvent(
      state,
      BOB,
      {
        kind: "restrict_advent",
        player: "opponent",
        duration: { scope: "this_turn" },
      },
      "tsukuyomi-1"
    );
    const after = passStackUntilClosed(restricted);
    expect(after.pendingEffectTargetSelection).toBeNull();
    expect(getCard(after, "amalgam-1").zone).toBe("hand");
    expect(after.players[0]!.soulCoreLocation).toEqual({ kind: "reserve" });
  });
  it("対象2体を1つの煌臨元スタックへ統合し、選んだ「上」が状態を引き継ぎ、コアは合算される", () => {
    const state = buildState();

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    });
    const decl = actions.find(
      (a): a is Extract<LegalAction, { kind: "declare_dual_host_advent" }> =>
        a.kind === "declare_dual_host_advent" &&
        a.sourceInstanceId === "amalgam-1"
    );
    if (!decl) throw new Error("declare_dual_host_advent not found");
    expect(decl.candidateTargetInstanceIds.sort()).toEqual(
      ["akatsuki-1", "tsukuyomi-1"].sort()
    );
    expect(decl.requiredTargetCount).toBe(2);

    // 「上」= akatsuki-1 (状態引き継ぎ側)、「下」= tsukuyomi-1 (コアのみ合算)。
    const declared = applyLegalAction({
      state,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(declared.stackWindow).not.toBeNull();

    const resolved = resolvePendingEffectTarget(
      passStackUntilClosed(declared),
      ["akatsuki-1", "tsukuyomi-1"]
    );

    const amalgam = getCard(resolved, "amalgam-1");
    expect(amalgam.zone).toBe("field");
    // 対象2体を1つの煌臨元スタックへ統合 (self_advent_source_names の SSOT を共有)。
    expect(adventSourceIdsOf(amalgam).sort()).toEqual(
      ["akatsuki-1", "tsukuyomi-1"].sort()
    );
    // 維持コアは統合される (2 + 3 = 5)。
    expect(amalgam.normalCoreCount).toBe(5);

    // 「上」「下」双方とも通常の煌臨元と同じくコアは0にリセットされる。
    expect(getCard(resolved, "akatsuki-1").normalCoreCount).toBe(0);
    expect(getCard(resolved, "tsukuyomi-1").normalCoreCount).toBe(0);

    // ソウルコアは1回だけ消費される (reserve → trash)。
    const player = resolved.players.find((p) => p.id === ALICE)!;
    expect(player.soulCoreLocation).toEqual({ kind: "trash" });

    // 効果[2] (Lv3-6『アタック時』) の発動条件 self_advent_source_names が
    // 到達可能になったことを確認 (P3-133 解消前は恒常的に false = dead code だった)。
    const amalgamDef = card(AMALGAM_NO);
    const attackCondition = amalgamDef.effects.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "attack"
    )?.condition;
    expect(attackCondition).toBeDefined();
    expect(
      evaluateCondition(
        resolved,
        attackCondition!,
        "amalgam-1",
        ALICE,
        getCardDefinitionById
      )
    ).toBe(true);

    const rebuilt = recomputeAndRebuildContinuousEffects(
      resolved,
      getCardDefinitionById
    );
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "akatsuki-1" ||
          ce.sourceInstanceId === "tsukuyomi-1" ||
          ce.targetInstanceId === "akatsuki-1" ||
          ce.targetInstanceId === "tsukuyomi-1"
      )
    ).toBe(false);

    const leakedBottomCe: ContinuousEffect = {
      effectId: "test-x03-bottom-host-leaked-while-on-field",
      sourceInstanceId: "tsukuyomi-1",
      sourceDefinitionId: card(TSUKUYOMI_NO).cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: resolved.turnNumber,
      createdAtAttackId: null,
      modifierTag: "field_name_uniqueness",
      targetInstanceId: ALICE,
      metadata: { restrictedNames: [card(TSUKUYOMI_NO).name] },
    };
    const recomputedWithLeak = recomputeAndRebuildContinuousEffects(
      {
        ...resolved,
        activeContinuousEffects: [
          ...resolved.activeContinuousEffects,
          leakedBottomCe,
        ],
      },
      getCardDefinitionById
    );
    expect(
      recomputedWithLeak.activeContinuousEffects.some(
        (ce) => ce.effectId === leakedBottomCe.effectId
      )
    ).toBe(false);
  });
});
