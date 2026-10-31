/**
 * preventionRestriction（限定的防止不可「○○の効果では防げない」）の producer 配線テスト。
 *
 * 原文には向きが真逆の 2 型がある（公式裁定 Q8745/Q9751、10_rules/04b2、P3-140）。
 * 「X以外の効果では防げない」型は `onlyPreventableBy*` — 指定スコープに一致する防止元
 * だけを残し、不一致の `cannot_*` 効果耐性を `sourcePreventionBypass` で貫通する。
 * 「Xの効果では防げない」型は `notPreventableBy*` — 指定スコープに一致する防止元を
 * 貫通し、不一致の防止元はそのまま防ぐ（[03c:27-28]）。
 *
 * 検証カード: BSTH06-転醒X01(B) 霊烏路 空（B 面）の『転醒時』全体破壊効果
 * 「この効果はスピリット/アルティメットの効果では防げない」= notPreventableByCategories
 * （P3-140 で onlyPreventableByCategories からの誤分類を修正）。
 * needs-dsl.w1 BSTH06-転醒X01(B) の最後の stub（防げない rider）解消。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import {
  expandCardDefinitionsWithBackFaces,
  generateTriggeredEffectRegistrations,
  generateBattleImmediateEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import { getEffectPreventionLevel } from "../src/legal/legal-actions-shared";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";

const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const cardNoMap = new Map<string, CardDefinition>(
  expanded.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

/** 対象が「実際に離脱する」かを判定する（pendingLeave 経由を含む）。 */
function isLeaving(result: GameState, id: string): boolean {
  const c = result.cardInstances.find((x) => x.instanceId === id);
  const leftField = !c || c.zone !== "field";
  const realLeave = result.pendingLeaveEntities.some(
    (e) => e.instanceId === id && !e.blockedByResistance
  );
  return leftField || realLeave;
}

/** 相手起因の cannot_* 効果耐性 CE を対象 instance に直接付与する。 */
function cannotLeaveCE(
  targetInstanceId: string,
  tag: ContinuousEffectTag,
  ownerPlayerId: string,
  sourceDefinitionId: string
): ContinuousEffect {
  return {
    effectId: `test-${tag}-${targetInstanceId}`,
    sourceInstanceId: "test-source",
    sourceDefinitionId,
    actingPlayerId: ownerPlayerId,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: tag,
    targetInstanceId,
    metadata: { source: "opponent_effect" },
  };
}

describe("preventionRestriction: BSTH06-転醒X01(B) 霊烏路 空『転醒時』全体破壊（カテゴリ限定防げない）", () => {
  const def = card("BSTH06-転醒X01(B)");
  // [2,3] = 『転醒時』(card_event:"rebirth") 全体破壊。スピリット/アルティメットの効果では防げない。
  const rebirthEffectIndex = 0;

  it("card-data: preventionRestriction.notPreventableByCategories が立ち stub 解消", () => {
    const effect = def.effects![rebirthEffectIndex]!;
    expect(effect.timing).toEqual({ kind: "card_event", event: "rebirth" });
    expect(effect.stub).toBeUndefined();
    expect(effect.preventionRestriction?.notPreventableByCategories).toEqual([
      "spirit",
      "ultimate",
    ]);
  });

  it("triggered registration が preventionRestriction → scoped targetLockBypass を導出", () => {
    const regs = generateTriggeredEffectRegistrations(def).filter(
      (r) => r.effectIndex === rebirthEffectIndex
    );
    expect(regs.length).toBeGreaterThan(0);
    for (const reg of regs) {
      expect(getEffectPreventionLevel(reg)).toBe("none");
      expect(reg.targetLockBypass).toEqual({
        kind: "preventing_effect_filter",
        filter: {
          categories: ["spirit", "ultimate"],
        },
      });
    }
  });

  function makeState(sourceDefinitionId: string): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(def, {
      instanceId: "utsuho-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    // 相手スピリットに「相手の効果で破壊されない」を付与。
    const enemy = createCardInstance(card("BSTH06-C01"), {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemy],
      activeContinuousEffects: [
        cannotLeaveCE(
          "enemy-1",
          "cannot_be_destroyed",
          "bob",
          sourceDefinitionId
        ),
      ],
    };
  }

  it("control: preventionRestriction を外した破壊は cannot_be_destroyed に阻まれ残存", () => {
    const effect = def.effects![rebirthEffectIndex]!;
    const { preventionRestriction: _omit, ...plain } = effect;
    const result = executeEffect({
      chainId: "test:prevention-restriction-scope:144",
      state: makeState("BSTH06-X01"),
      effect: plain,
      sourceInstanceId: "utsuho-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(result, "enemy-1")).toBe(false);
  });

  it("preventionRestriction 付きの破壊は防げないスコープ(spirit)の cannot_be_destroyed を貫通する", () => {
    const result = executeEffect({
      chainId: "test:prevention-restriction-scope:155",
      state: makeState("BSTH06-C01"),
      effect: def.effects![rebirthEffectIndex]!,
      sourceInstanceId: "utsuho-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(result, "enemy-1")).toBe(true);
  });

  it("preventionRestriction 付きの破壊は防げるスコープ外(nexus)の cannot_be_destroyed には阻まれる", () => {
    const result = executeEffect({
      chainId: "test:prevention-restriction-scope:166",
      state: makeState("BSTH06-X01"),
      effect: def.effects![rebirthEffectIndex]!,
      sourceInstanceId: "utsuho-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(result, "enemy-1")).toBe(false);
  });
});

describe("preventionRestriction: BSTH08-X03 二ツ岩 マミゾウ『アタック時』デッキ下（キーワード限定防げない）", () => {
  const def = card("BSTH08-X03");
  // [3,4] = 『アタック時』(card_event:"attack") send_to_deck。【超重装甲】以外では防げない。
  const attackEffectIndex = 1;

  it("card-data: preventionRestriction.onlyPreventableByKeywords が立ち stub 解消", () => {
    const effect = def.effects![attackEffectIndex]!;
    expect(effect.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(effect.stub).toBeUndefined();
    expect(effect.preventionRestriction?.onlyPreventableByKeywords).toEqual([
      "超重装甲",
    ]);
  });

  it("battle-immediate registration が preventionRestriction → scoped targetLockBypass を導出", () => {
    const regs = generateBattleImmediateEffectRegistrations(def).filter(
      (r) => r.effectIndex === attackEffectIndex
    );
    expect(regs.length).toBeGreaterThan(0);
    for (const reg of regs) {
      expect(getEffectPreventionLevel(reg)).toBe("none");
      expect(reg.targetLockBypass).toEqual({
        kind: "preventing_effect_filter",
        filter: {
          keywords: ["超重装甲"],
          bypassUnlessMatches: true,
        },
      });
    }
  });

  function makeState(sourceDefinitionId: string): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(def, {
      instanceId: "mamizou-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    // 相手スピリット（BSTH06-C01 は printedCategory: spirit）に
    // 「相手の効果でデッキに戻されない」を付与。
    const enemy = createCardInstance(card("BSTH06-C01"), {
      instanceId: "enemy-deck-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...base,
      activePlayerId: "alice",
      // alice のカウント1 → send_to_deck の count_value source が 1 体を対象化。
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 1 } : p
      ),
      step: "main",
      cardInstances: [self, enemy],
      activeContinuousEffects: [
        cannotLeaveCE(
          "enemy-deck-1",
          "cannot_be_sent_to_deck",
          "bob",
          sourceDefinitionId
        ),
      ],
    };
  }

  it("control: preventionRestriction を外した send_to_deck は cannot_be_sent_to_deck に阻まれ残存", () => {
    const effect = def.effects![attackEffectIndex]!;
    const { preventionRestriction: _omit, ...plain } = effect;
    const result = executeEffect({
      chainId: "test:prevention-restriction-scope:249",
      state: makeState("BSTH08-C01"),
      effect: plain,
      sourceInstanceId: "mamizou-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(result, "enemy-deck-1")).toBe(false);
  });

  it("preventionRestriction 付きの send_to_deck は許可スコープ外の cannot_be_sent_to_deck を貫通する", () => {
    const result = executeEffect({
      chainId: "test:prevention-restriction-scope:260",
      state: makeState("BSTH08-C01"),
      effect: def.effects![attackEffectIndex]!,
      sourceInstanceId: "mamizou-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(result, "enemy-deck-1")).toBe(true);
  });
});

describe("preventionLevel(blanket): BSFT01-C01 ウラノ・メトリア フラッシュ（相手の効果で防げない）", () => {
  const def = card("BSFT01-C01");
  // [2,3] = フラッシュ(activated/flash) 強制破壊。相手の効果で防げない（blanket）。
  const flashEffectIndex = 1;

  it("card-data: preventionLevel: unpreventable が立ち stub 解消", () => {
    const effect = def.effects![flashEffectIndex]!;
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.stub).toBeUndefined();
    expect(effect.preventionLevel).toBe("unpreventable");
  });
});
