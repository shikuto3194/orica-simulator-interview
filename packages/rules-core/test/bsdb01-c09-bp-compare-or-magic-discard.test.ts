/**
 * BSDB01-C09「かめはめ波」[2,3] 検証。
 *
 * フラッシュ:「自分の『孫悟空』1体と相手のスピリット/アルティメット1体のBPを比べる。
 *  （BPが同じか低い対象が破壊される）または、相手のフィールドにあるマジックカード1枚を破棄する。」
 *
 * Pattern 2（源を場の別カードから選ぶ）= bp_compare_destroy.comparer に「孫悟空」filter を載せる。
 * BSFT01-C02「ルーシィキック」と同型の precedent（[[project_bp_compare_destroy_cause]]）。
 * 択一の「マジック破棄」は choice[0] の destroy action（choiceIndex:1 で選択）。
 *
 * 既知 BP: 孫悟空 BSDB01-C01 Lv1 = 4000。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";

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

function flashEffect() {
  const def = card("BSDB01-C09");
  const eff = def.effects?.find(
    (e) => e.timing?.kind === "activated" && e.timing.mode === "flash"
  );
  if (!eff) throw new Error("flash effect not found on BSDB01-C09");
  return eff;
}

function goku() {
  // 孫悟空 BSDB01-C01 Lv1 = BP 4000。
  return createCardInstance(card("BSDB01-C01"), {
    instanceId: "goku",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
}

function magicSource() {
  return createCardInstance(card("BSDB01-C09"), {
    instanceId: "magic-src",
    ownerPlayerId: ALICE,
    zone: "field",
  });
}

function oppLucy() {
  // ルーシィ・ハートフィリア BSFT01-CX01 Lv1 = BP 2000（孫悟空 4000 より低い）。
  return createCardInstance(card("BSFT01-CX01"), {
    instanceId: "opp-lucy",
    ownerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
}

function oppFieldMagic() {
  return createCardInstance(card("BSDB01-C10"), {
    instanceId: "opp-magic",
    ownerPlayerId: BOB,
    zone: "field",
  });
}

function run(state: GameState, choiceIndex?: number): GameState {
  return executeEffect({
    chainId: "test:bsdb01-c09-bp-compare-or-magic-discard:79",
    state,
    effect: flashEffect(),
    sourceInstanceId: "magic-src",
    actingPlayerId: ALICE,
    choiceIndex,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

describe("BSDB01-C09 かめはめ波 [2,3]（comparer Pattern 2 + 択一マジック破棄）", () => {
  it("BP比較破壊（デフォルト分岐）: 孫悟空4000 > 相手ルーシィ2000 → 相手のみ破壊", () => {
    const after = run(
      createEmptyGameState({
        cardInstances: [magicSource(), goku(), oppLucy()],
      })
    );
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-lucy")!
        .pendingLeaveKind
    ).toBe("destroy");
    expect(
      after.cardInstances.find((x) => x.instanceId === "goku")!.pendingLeaveKind
    ).toBeNull();
  });

  it("マジック破棄（choiceIndex:1 分岐）: 非破壊の離脱を予約し、孫悟空/相手スピリットは無傷", () => {
    const after = run(
      createEmptyGameState({
        cardInstances: [magicSource(), goku(), oppLucy(), oppFieldMagic()],
      }),
      1
    );
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-magic")!
        .pendingLeaveKind
    ).toBe("bounce");
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-lucy")!
        .pendingLeaveKind
    ).toBeNull();
    expect(
      after.cardInstances.find((x) => x.instanceId === "goku")!.pendingLeaveKind
    ).toBeNull();
  });
});
