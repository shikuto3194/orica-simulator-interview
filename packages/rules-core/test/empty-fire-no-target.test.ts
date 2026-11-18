/**
 * 空撃ち (対象不在でも効果使用可能) 対応のテスト。
 * ルール正源: manual/ai-reference/10_rules/03b_resolution-and-interrupts.md「空撃ち」(131-)。
 *
 * 背景: レミリア・スカーレット (BSTH01-X03) 召喚で 紅魔館 (BSTH01-R21) Lv2 と
 * レミリア自身の召喚時効果が同時誘発。紅魔館を先に解決後、レミリアの
 * 「相手の創界神ネクサス1つを破壊できる」(任意) が対象不在のとき、旧実装は
 * legal action を一切出さず詰んでいた (requiredTargetCount=1 ガード)。
 * 空撃ち対応で「発揮する/やめる」を提示し、対象0でも resolve 可能にする。
 *
 * 一方「○○することで△△する」(ことで構文 = connector:conditional_cost) は
 * 対象0なら空撃ち禁止 (03b:34 双方向)。紅魔館フラッシュ効果がこれに該当。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildBurstEffectLookup,
  createCardInstance,
  createEmptyGameState,
  generateFieldCardEffectRegistrations,
  generateTriggeredEffectRegistrations,
  getLegalActions,
  resolveEmptyFireTargetCounts,
} from "../src";
import { executeDestroy } from "../src/effect/structured-card-replacement";
import type { CardDefinition, GameState, PendingTriggeredEffect } from "../src";

const defs = ALL_CARDS as CardDefinition[];
const map = new Map(defs.map((d) => [d.cardNo, d]));
const getCardDefinitionById = (id: string) => map.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredBurstActions: buildBurstEffectLookup(defs),
};

const REMILIA = map.get("BSTH01-X03")!;
const KOUMAKAN = map.get("BSTH01-R21")!;

function buildSummonTriggerState(opts: {
  opponentHasGrandwalkerNexus: boolean;
}): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const remilia = createCardInstance(REMILIA, {
    instanceId: "card-remilia",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    zoneRoleName: "spirit",
    normalCoreCount: 1,
  });
  const koumakan = createCardInstance(KOUMAKAN, {
    instanceId: "card-koumakan",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1, // Lv2
  });
  const cardInstances = [remilia, koumakan];
  // 相手の創界神ネクサス候補 (テスト切替用): 創界神を持つネクサスがデータ上必要。
  // ここでは対象有無の挙動差を見るため、存在しない場合 (=空撃ち) を主目的とする。
  // opponentHasGrandwalkerNexus=true の組み立ては該当カードが必要なため割愛し、
  // 対象0の空撃ち経路のみを検証する。
  void opts;

  // 紅魔館側 (life_fill) は解決済みとして resolvedSourceInstanceIds に積む。
  // 残ソースはレミリア自身 (card-remilia) の召喚時効果。
  const pending: PendingTriggeredEffect = {
    pendingId: "trigger:test:summon:card-remilia",
    actingPlayerId: "alice",
    eventKind: "summon",
    event: {
      family: "enter_field",
      actionKind: "summon",
      validationMode: "require_related_instance_on_field",
    },
    source: "action_resolution",
    chainId: "play:test:alice:main:summon:card-remilia",
    attackId: null,
    relatedPlayerId: "alice",
    relatedInstanceId: "card-remilia",
    amount: null,
    step: "main",
    window: "none",
    resolvedSourceInstanceIds: ["card-koumakan"],
  };

  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances,
    pendingTriggeredEffects: [pending],
  };
}

describe("空撃ち: レミリア召喚時効果 (plain destroy, 対象不在)", () => {
  it("対象0でも resolve アクションが提示され詰まない (targetMode none)", () => {
    const state = buildSummonTriggerState({
      opponentHasGrandwalkerNexus: false,
    });
    const actions = getLegalActions({
      ...lookups,
      state,
      actingPlayerId: "alice",
    });
    const resolve = actions.filter(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(resolve.length).toBeGreaterThan(0);
    const a = resolve[0]!;
    expect(a.requiredTargetCount).toBe(0);
    expect(a.targetMode).toBe("none");
    // 任意効果なので GUI は「発揮する/やめる」を出せる。
    expect(a.executionMode).toBe("optional");
  });

  it("スタック応答中に事前選択対象が場を離れた場合も、破壊を空撃ちとして解決する", () => {
    const staleTarget = createCardInstance(REMILIA, {
      instanceId: "stale-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
    });
    const state = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [staleTarget],
    };

    const resolved = executeDestroy(
      state,
      "alice",
      {
        player: "opponent",
        filter: { category: ["spirit"] },
        count: 1,
      },
      getCardDefinitionById,
      "source",
      [staleTarget.instanceId]
    );

    expect(resolved.pendingLeaveEntities).toHaveLength(0);
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === staleTarget.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("resolve を適用するとキューが空になり進行可能になる", () => {
    const state = buildSummonTriggerState({
      opponentHasGrandwalkerNexus: false,
    });
    const actions = getLegalActions({
      ...lookups,
      state,
      actingPlayerId: "alice",
    });
    const resolve = actions.find(
      (a) => a.kind === "resolve_pending_triggered_effect"
    )!;
    const result = applyLegalAction({
      ...lookups,
      state,
      action: resolve,
      targetInstanceIds: [],
    });
    expect(result.state.pendingTriggeredEffects).toHaveLength(0);
  });
});

describe("空撃ち禁止: 紅魔館フラッシュ (ことで構文)", () => {
  it("紅魔館の flash 効果は targetGatedByConditionalCost=true で登録される", () => {
    const regs = generateFieldCardEffectRegistrations(KOUMAKAN);
    const flash = regs.find((r) => r.timing === "flash")!;
    expect(flash).toBeDefined();
    expect(flash.requiredTargetCount).toBe(1);
    expect(flash.targetGatedByConditionalCost).toBe(true);
  });

  it("レミリア召喚時効果は単純な効果範囲 (フラグ無し=空撃ち可)", () => {
    const regs = generateTriggeredEffectRegistrations(REMILIA);
    const summon = regs.find((r) => r.effectIndex === 0)!;
    expect(summon.requiredTargetCount).toBe(1);
    expect(summon.targetGatedByConditionalCost).toBeUndefined();
  });
});

describe("resolveEmptyFireTargetCounts", () => {
  it("候補が必要数以上ならそのまま", () => {
    expect(
      resolveEmptyFireTargetCounts({
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateCount: 2,
        gatedByConditionalCost: false,
      })
    ).toEqual({ block: false, requiredTargetCount: 1, maxTargetCount: 1 });
  });

  it("対象0・非ことで → 空撃ち (required/max=0)", () => {
    expect(
      resolveEmptyFireTargetCounts({
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateCount: 0,
        gatedByConditionalCost: false,
      })
    ).toEqual({ block: false, requiredTargetCount: 0, maxTargetCount: 0 });
  });

  it("部分撃ち・非ことで → 候補数にクランプ (need2/have1 → 1)", () => {
    expect(
      resolveEmptyFireTargetCounts({
        requiredTargetCount: 2,
        maxTargetCount: 2,
        candidateCount: 1,
        gatedByConditionalCost: false,
      })
    ).toEqual({ block: false, requiredTargetCount: 1, maxTargetCount: 1 });
  });

  it("対象不足・ことで → ブロック (コストだけ払えない)", () => {
    expect(
      resolveEmptyFireTargetCounts({
        requiredTargetCount: 1,
        maxTargetCount: 1,
        candidateCount: 0,
        gatedByConditionalCost: true,
      }).block
    ).toBe(true);
  });
});
