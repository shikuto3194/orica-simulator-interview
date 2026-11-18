/**
 * 『お互いのアタックステップ』にしか使えないマジック/スタック効果の使用タイミング制限。
 *
 * 「この効果は、お互いのアタックステップしか使えない」(BSTH002-M01 / BSTH08-C01 /
 * BSTH003-R03 のスタック効果) および「このカードは『お互いのアタックステップ』にしか
 * 使えない」(BSTH03-R03 / BSTH06-R01 のフラッシュ＋スタック効果) を
 * Effect.timingScope = { player: "both", period: "attack" } で表現する。
 *
 * 既存の汎用 timingScope 基盤 (P3-42, isTimingScopeActive + magic registration への
 * 伝搬) に card-data を載せるだけのケース。専用フィールド・専用検査は追加しない。
 *
 * ルール正源: アタックステップ構造は 10_rules/02_turn-flow-and-timing.md (Attack Step)。
 * 先例: BSTS01.ts (回復効果 both/attack), BSTH01-R21 紅魔館 (P3-42)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  isTimingScopeActive,
} from "../src/runtime";
import type { CardDefinition, GameState, LegalAction } from "../src/runtime";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredMagicActions = buildMagicLookup(ALL_CARDS);

const BOTH_ATTACK = { player: "both", period: "attack" } as const;

/**
 * 当該カードの (timing, effectIndex) に対応する magic registration を返す。
 * フラッシュ効果は派生スタック reg も生むため、timing だけでは曖昧。
 * 対象効果の effectIndex で一意化する。
 */
function magicReg(
  cardNo: string,
  timing: "flash" | "stack",
  effectIndex: number
) {
  const regs = getRegisteredMagicActions(cardNo) ?? [];
  return regs.find((r) => r.timing === timing && r.effectIndex === effectIndex);
}

/** alice の手札に対象マジックを1枚置いた main step 盤面。 */
function mainStateWithMagicInHand(def: CardDefinition): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [
      createCardInstance(def, {
        instanceId: "magic-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      }),
    ],
  };
}

// 各カードのゲート対象 effect (timing + effectIndex) と、main step 排除を検証する timing。
const CASES: Array<{
  cardNo: string;
  gated: Array<{ timing: "flash" | "stack"; effectIndex: number }>;
}> = [
  { cardNo: "BSTH002-M01", gated: [{ timing: "stack", effectIndex: 3 }] },
  { cardNo: "BSTH08-C01", gated: [{ timing: "stack", effectIndex: 3 }] },
  { cardNo: "BSTH003-R03", gated: [{ timing: "stack", effectIndex: 3 }] },
  {
    cardNo: "BSTH03-R03",
    gated: [
      { timing: "flash", effectIndex: 2 },
      { timing: "stack", effectIndex: 3 },
    ],
  },
  {
    cardNo: "BSTH06-R01",
    gated: [
      { timing: "flash", effectIndex: 1 },
      { timing: "stack", effectIndex: 2 },
    ],
  },
  // engine-quartz-arts-field-gate: BSLH01-T07〜T12 攻撃アーツ「アタックステップに
  // 使用できる」(プレイヤー限定なし=both) を effects[1] の flash 効果に付与。
  // 【アーツ】配置ゲートは CardDefinition.summonCondition へ移動したため
  // effects[0]=系統免疫、effects[1]=フラッシュ payload (旧 effects[2] から繰り上がり)。
  { cardNo: "BSLH01-T07", gated: [{ timing: "flash", effectIndex: 1 }] },
  { cardNo: "BSLH01-T08", gated: [{ timing: "flash", effectIndex: 1 }] },
  { cardNo: "BSLH01-T09", gated: [{ timing: "flash", effectIndex: 1 }] },
  { cardNo: "BSLH01-T10", gated: [{ timing: "flash", effectIndex: 1 }] },
  { cardNo: "BSLH01-T11", gated: [{ timing: "flash", effectIndex: 1 }] },
  { cardNo: "BSLH01-T12", gated: [{ timing: "flash", effectIndex: 1 }] },
];

describe("『お互いのアタックステップ』限定マジックの timingScope 伝搬", () => {
  for (const { cardNo, gated } of CASES) {
    for (const { timing, effectIndex } of gated) {
      it(`${cardNo} effects[${effectIndex}] (${timing}): registration が timingScope=both/attack を持つ`, () => {
        const reg = magicReg(cardNo, timing, effectIndex);
        expect(
          reg,
          `${cardNo} effects[${effectIndex}] ${timing} registration`
        ).toBeDefined();
        expect(reg!.timingScope).toEqual(BOTH_ATTACK);
      });
    }
  }
});

describe("実カードの timingScope によるステップ判定 (isTimingScopeActive)", () => {
  it("main step では発動不可・attack step では発動可 (お互いなので相手ターンも可)", () => {
    const reg = magicReg("BSTH06-R01", "flash", 1)!;
    const scope = reg.timingScope;
    // 自分ターンの main → false
    expect(isTimingScopeActive(scope, "main", "alice", "alice")).toBe(false);
    // 自分ターンの attack → true
    expect(isTimingScopeActive(scope, "attack", "alice", "alice")).toBe(true);
    // 相手ターンの attack でも player:both なので true
    expect(isTimingScopeActive(scope, "attack", "bob", "alice")).toBe(true);
  });
});

describe("legal-action: main step では当該マジックのゲート効果が use_magic に列挙されない", () => {
  for (const { cardNo, gated } of CASES) {
    const gatedTimings = new Set(gated.map((g) => g.timing));
    it(`${cardNo}: main step で gated timing の use_magic が出ない`, () => {
      const def = cardNoMap.get(cardNo)!;
      const state = mainStateWithMagicInHand(def);
      const actions = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredMagicActions,
      });
      const gatedActions = actions.filter(
        (a: LegalAction) =>
          a.kind === "use_magic" &&
          a.sourceInstanceId === "magic-1" &&
          gatedTimings.has(a.timing as "flash" | "stack")
      );
      expect(gatedActions).toHaveLength(0);
    });
  }
});
