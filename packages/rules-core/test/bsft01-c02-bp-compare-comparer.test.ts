/**
 * BSFT01-C02「ルーシィキック」[2,3] 検証。
 *
 * フラッシュ:「自分の『ルーシィ』1体と相手のスピリット/アルティメット1体のBPを比べ、
 *  BPが同じか低いスピリット/アルティメットが破壊される。このとき、合体中の自分のブレイヴ1つにつき、
 *  自分の『ルーシィ』1体をBP+2000する。」
 *
 * Pattern 2（源を場の別カードから選ぶ）= bp_compare_destroy.comparer に ref を載せ、
 * 前段の bp_modify（合体中ブレイヴ数 × 2000）で強化した「ルーシィ」を源として相手と比べる。
 *
 * ルール正源: カード本文「BPが同じか低い…が破壊される」（同値は両側破壊）。
 * 既知 BP: ルーシィ・ハートフィリア BSFT01-CX01 Lv1 = 2000 / ルフィ相当 opponent は孫悟空 Lv1 = 4000。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getEffectiveBp } from "../src/battle/battle-shared";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";

// BSFT01-C02 [2,3] フラッシュ効果（card-data から取得）。
function flashEffect() {
  const def = card("BSFT01-C02");
  const eff = def.effects?.find(
    (e) => e.timing?.kind === "activated" && e.timing.mode === "flash"
  );
  if (!eff) throw new Error("flash effect not found on BSFT01-C02");
  return eff;
}

function luchy(coreCount = 1) {
  // ルーシィ・ハートフィリア BSFT01-CX01 Lv1 = BP 2000。
  return createCardInstance(card("BSFT01-CX01"), {
    instanceId: "luchy",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: coreCount,
  });
}

function magicSource() {
  // 効果発生源（ルーシィキック本体）。場に置く必要はないが sourceInstanceId 解決用に置く。
  return createCardInstance(card("BSFT01-C02"), {
    instanceId: "magic-src",
    ownerPlayerId: ALICE,
    zone: "field",
  });
}

function oppGoku() {
  // 孫悟空 BSDB01-C01 Lv1 = BP 4000。
  return createCardInstance(card("BSDB01-C01"), {
    instanceId: "opp-goku",
    ownerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
}

function combinedBrave() {
  // 合体中のブレイヴ（BSFT01-TR01(A) を luchy へ合体させた体）。
  return createCardInstance(card("BSFT01-TR01(A)"), {
    instanceId: "brave-1",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: "luchy",
  });
}

function run(state: GameState): GameState {
  return executeEffect({
    chainId: "test:bsft01-c02-bp-compare-comparer:85",
    state,
    effect: flashEffect(),
    sourceInstanceId: "magic-src",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

describe("BSFT01-C02 ルーシィキック [2,3]（comparer Pattern 2 + 合体ブレイヴ動的 BP+2000）", () => {
  it("『このとき』のBP加算は比較に使用し、解決後の別のバトルへ残さない", () => {
    const weakOpponent = {
      ...card("BSDB01-C01"),
      cardNo: "audit-weak-opponent",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    } satisfies CardDefinition;
    const lookup = (id: string) =>
      id === weakOpponent.cardNo ? weakOpponent : getDef(id);
    const before = createEmptyGameState({
      cardInstances: [
        magicSource(),
        luchy(),
        combinedBrave(),
        createCardInstance(weakOpponent, {
          instanceId: "weak-opponent",
          ownerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    });
    const after = executeEffect({
      chainId: "test:bsft01-c02-bp-compare-comparer:117",
      state: before,
      effect: flashEffect(),
      sourceInstanceId: "magic-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const survivor = after.cardInstances.find((c) => c.instanceId === "luchy")!;
    expect(survivor.pendingLeaveKind).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "weak-opponent")!
        .pendingLeaveKind
    ).toBe("destroy");
    expect(getEffectiveBp(after, survivor, card("BSFT01-CX01"), lookup)).toBe(
      2000
    );
  });

  it("合体ブレイヴ無し: ルーシィ 2000 ≤ 相手 4000 → ルーシィのみ破壊", () => {
    const after = run(
      createEmptyGameState({
        cardInstances: [magicSource(), luchy(), oppGoku()],
      })
    );
    expect(
      after.cardInstances.find((x) => x.instanceId === "luchy")!
        .pendingLeaveKind
    ).toBe("destroy");
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-goku")!
        .pendingLeaveKind
    ).toBeNull();
  });

  it("合体ブレイヴ1つ: ルーシィ 2000+2000=4000 で相手 4000 と同値 → 両方破壊", () => {
    const after = run(
      createEmptyGameState({
        cardInstances: [magicSource(), luchy(), combinedBrave(), oppGoku()],
      })
    );
    // ルーシィは合体ブレイヴ1つ × 2000 で 4000 に強化され、相手 4000 と同値。
    // 「同じか低い」を両側が満たすため両方破壊（既存 bp_compare_destroy の同値挙動）。
    expect(
      after.cardInstances.find((x) => x.instanceId === "luchy")!
        .pendingLeaveKind
    ).toBe("destroy");
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-goku")!
        .pendingLeaveKind
    ).toBe("destroy");
  });
});
