/**
 * P3-137: `tribes:["創界神"]` 単独限定 (18箇所) の全数監査・修正の行動検証。
 *
 * 10_rules/07:62-67 の一般化裁定（作用系＝対象に何かを行う効果は導界者ネクサスも
 * 「受ける」側に含める）に基づき、destroy/core_move/override_properties 等の
 * 作用系効果は `tribes:["創界神"]` を外し `targetsGrandwalker:"only"` へ置換した。
 * 対象: BSFT01-TR04(A) / BSLH01-R03 / BSTH01-X03(x2) / BSTH04.5-X01 / BSTH08.5-R13 /
 *       BSTH08-C04(x2)。
 * (BSSG01-M03/M04 は bssg01-cards.test.ts + bsth-guided-grandwalker-nexus-filter-batch3.test.ts、
 *  BSTH001-C01/C02 は bsth001-cards.test.ts、BSTH02-M03/BSTH03-M03 burst は
 *  grandwalker-core-strip-extension.test.ts、BSTH03-M03 destroy は
 *  bsth03-m03-tribe-exclude-destroy-recover.test.ts で各々検証済み。)
 *
 * 現状維持 (コア「置く」= qa-002 明示除外例) の 3 箇所 (BSTH05.ts:259/396/533) は
 * card-data 側にコメントで理由を明記済み、本テストの対象外。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id);

// BSLH01-X01 = [導界者]キーア (tribe: "導界者・CB・S.S.S", grandwalkerData.kind:"guided",
// 全色シンボル)。opponent/self どちらの色制約でも fixture として使える。
const GUIDED_NEXUS = card("BSLH01-X01");

const ALICE = "alice";
const BOB = "bob";

describe("BSFT01-TR04(A) フラッシュ: 導界者ネクサスも創界神対象コア全ボイド (P3-137)", () => {
  it("[board] 相手の導界者ネクサスの全コアがボイドへ", () => {
    const source = card("BSFT01-TR04(A)");
    const flash = source.effects![1]!;
    const flashBody = flash.steps.find((s) => s.id === "flash_body")!;
    const self = createCardInstance(source, {
      instanceId: "sagittarius-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const guided = createCardInstance(GUIDED_NEXUS, {
      instanceId: "bob-guided",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [self, guided],
    };
    const result = executeEffect({
      chainId: "test:p3-137-tribes-filter-guided-nexus-fix:65",
      state,
      effect: { ...flash, steps: [flashBody] },
      sourceInstanceId: "sagittarius-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-guided")!
        .normalCoreCount
    ).toBe(0);
  });
});

describe("BSLH01-R03 choice[1]=core_move: 導界者ネクサスも創界神対象コア全ボイド (P3-137)", () => {
  it("[board] choiceIndex=2 で相手の導界者ネクサスの全コアがボイドへ", () => {
    const source = card("BSLH01-R03");
    const effect = source.effects![0]!;
    const self = createCardInstance(source, {
      instanceId: "randy-r03",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const guided = createCardInstance(GUIDED_NEXUS, {
      instanceId: "bob-guided",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [self, guided],
    };
    const result = executeEffect({
      chainId: "test:p3-137-tribes-filter-guided-nexus-fix:102",
      state,
      effect,
      sourceInstanceId: "randy-r03",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      choiceIndex: 2,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-guided")!
        .normalCoreCount
    ).toBe(0);
  });
});

describe("BSTH01-X03 レミリア 召喚時/アタック時 destroy: 導界者ネクサスも対象 (P3-137)", () => {
  const source = card("BSTH01-X03");
  it.each([
    ["召喚時", 0],
    ["アタック時", 1],
  ] as const)(
    "[board] %s 効果で相手の導界者ネクサスが破壊される",
    (_label, idx) => {
      const effect = source.effects![idx]!;
      const self = createCardInstance(source, {
        instanceId: `remilia-${idx}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const guided = createCardInstance(GUIDED_NEXUS, {
        instanceId: "bob-guided",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      });
      const state: GameState = {
        ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
        activePlayerId: ALICE,
        step: "main",
        cardInstances: [self, guided],
      };
      const result = executeEffect({
        chainId: "test:p3-137-tribes-filter-guided-nexus-fix:145",
        state,
        effect,
        sourceInstanceId: `remilia-${idx}`,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        targetInstanceIds: ["bob-guided"],
      });
      expect(
        result.cardInstances.find((c) => c.instanceId === "bob-guided")!
          .pendingLeaveKind
      ).toBe("destroy");
    }
  );
});

describe("BSTH04.5-X01 射命丸文 Lv3: 自分の緑導界者ネクサスのコアもコストとして使える (P3-137)", () => {
  it("[board] 自分の緑導界者ネクサスのコア2個がボイドへ、回復が成立", () => {
    const source = card("BSTH04.5-X01");
    const effect = source.effects![2]!;
    const self = createCardInstance(source, {
      instanceId: "aya-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 5,
      exhaustState: "exhausted",
    });
    const guided = createCardInstance(GUIDED_NEXUS, {
      instanceId: "alice-guided",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [self, guided],
    };
    const result = executeEffect({
      chainId: "test:p3-137-tribes-filter-guided-nexus-fix:186",
      state,
      effect,
      effectIndex: 2,
      sourceInstanceId: "aya-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      // deferredTo:"battle_end" のバトル終了時 再起動パスを直接呼ぶ想定で予約インターセプトを
      // バイパスする（bskb01-x01-bp-compare-battle-end.test.ts と同じ convention）。
      firingBattleEndDeferral: true,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "alice-guided")!
        .normalCoreCount
    ).toBe(1);
    expect(
      result.cardInstances.find((c) => c.instanceId === "aya-1")!.exhaustState
    ).toBe("recovered");
  });
});

describe("BSTH08.5-R13 能面・鬼 手元常駐フラッシュ: 導界者ネクサスもコア3個ボイド (P3-137)", () => {
  it("[board] 2コスト支払い、相手の導界者ネクサスのコア3個がボイドへ", () => {
    const source = card("BSTH08.5-R13");
    const effect = source.effects!.find(
      (e) =>
        e.timing.kind === "activated" && e.applicability?.zone === "set_aside"
    )!;
    const self = createCardInstance(source, {
      instanceId: "oni-p137",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const guided = createCardInstance(GUIDED_NEXUS, {
      instanceId: "bob-guided",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [self, guided],
    };
    const result = executeEffect({
      chainId: "test:p3-137-tribes-filter-guided-nexus-fix:236",
      state,
      effect,
      sourceInstanceId: "oni-p137",
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-guided")!
        .normalCoreCount
    ).toBe(2);
  });
});

describe("BSTH08-C04 [五欲]霊夢 burst/Lv2: 導界者ネクサスもコア全/4個ボイド (P3-137)", () => {
  const source = card("BSTH08-C04");
  it("[board] burst 効果 (effects[1]) で相手の導界者ネクサスの全コアがボイドへ", () => {
    const self = createCardInstance(source, {
      instanceId: "reimu-burst",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "burst",
    });
    const guided = createCardInstance(GUIDED_NEXUS, {
      instanceId: "bob-guided",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: BOB,
      step: "attack",
      cardInstances: [self, guided],
      setBurstStates: [{ playerId: ALICE, cardInstanceId: "reimu-burst" }],
    };
    const result = executeEffect({
      chainId: "test:p3-137-tribes-filter-guided-nexus-fix:273",
      state,
      effect: source.effects![1]!,
      sourceInstanceId: "reimu-burst",
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-guided")!
        .normalCoreCount
    ).toBe(0);
  });

  it("[board] Lv2 効果 (effects[2]) で相手の導界者ネクサスのコア4個がボイドへ", () => {
    const self = createCardInstance(source, {
      instanceId: "reimu-lv2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const guided = createCardInstance(GUIDED_NEXUS, {
      instanceId: "bob-guided",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 6,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "attack",
      cardInstances: [self, guided],
    };
    const result = executeEffect({
      chainId: "test:p3-137-tribes-filter-guided-nexus-fix:307",
      state,
      effect: source.effects![2]!,
      sourceInstanceId: "reimu-lv2",
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-guided")!
        .normalCoreCount
    ).toBe(2);
  });
});
