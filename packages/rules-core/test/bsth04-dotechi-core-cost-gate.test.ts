/**
 * BSTH04 導界者ネクサスの【導技：4】コアコストゲート回帰テスト。
 *
 * 背景: BSTH04-X01 / BSTH04-XX01 の【導技：4】は当初 effects[] の activated 効果
 * (core_move from this_card amount:4 + conditional_cost) として実装されていたが、
 * legal-actions の availability は structured DSL の自己コアコストを検査しないため、
 * コア2個でも「発揮可能」になっていた（snapshot 2026-06-14T05-05-54 で観測）。
 *
 * 修正: 導技=神技扱い（textLines[0]）に従い grandwalkerData.divineSkills へ移管。
 * divineSkills 経路は getAvailableDivineSkillLegalActions が card.normalCoreCount <
 * skill.coreCost を検査するため、コア不足時に legal action を生成しない。
 */
import { describe, expect, it } from "vitest";
import { divineSkillFlashPosition } from "./divine-skill-timing-position";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getAvailableDivineSkillLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

function baseOptions(state: GameState) {
  return {
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredTriggeredEffectActions: () => [],
  } as Parameters<typeof getAvailableDivineSkillLegalActions>[0];
}

function nexusOnField(cardNo: string, cores: number): GameState {
  const nexus = createCardInstance(card(cardNo), {
    instanceId: "nexus-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: cores,
  });
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    cardInstances: [nexus],
  };
}

describe("BSTH04-XX01 [導界者]四季映姫 — 【導技：4】(main) コアコストゲート", () => {
  it("導技は divineSkills として宣言され coreCost=4 / timing=main / Lv1-2 / ターン1回", () => {
    const skills = card("BSTH04-XX01").grandwalkerData!.divineSkills!;
    expect(skills).toHaveLength(1);
    const skill = skills[0]!;
    expect(skill.coreCost).toBe(4);
    expect(skill.timing).toBe("main");
    expect(skill.minLevel).toBe(1);
    expect(skill.maxLevel).toBe(2);
    expect(skill.turnLimit).toBe("once");
    // effects はコスト後の本体（mill 上下 + 幻想 回収）。コア支払い step は持たない。
    const steps = skill.effects![0]!.steps;
    expect(steps.map((s) => s.action.kind)).toEqual([
      "move_card",
      "move_card",
      "search_zone",
    ]);
  });

  it("コア2個（snapshot 再現）ではメインステップでも発揮不可", () => {
    const state = { ...nexusOnField("BSTH04-XX01", 2), step: "main" as const };
    const actions = getAvailableDivineSkillLegalActions(baseOptions(state));
    expect(
      actions.filter((a) => a.sourceInstanceId === "nexus-1")
    ).toHaveLength(0);
  });

  it("コア4個ならメインステップで発揮可能（コスト支払い可）", () => {
    const state = { ...nexusOnField("BSTH04-XX01", 4), step: "main" as const };
    const actions = getAvailableDivineSkillLegalActions(baseOptions(state));
    const mine = actions.filter((a) => a.sourceInstanceId === "nexus-1");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.coreCost).toBe(4);
  });
});

describe("BSTH04-X01 [導界者]西行寺 幽々子 — 【導技：4】(flash/アタックステップ) コアコストゲート", () => {
  it("導技は divineSkills{coreCost:4, timing:attack/both} として宣言（BSTH05-X02 と同型）", () => {
    const skills = card("BSTH04-X01").grandwalkerData!.divineSkills!;
    expect(skills).toHaveLength(1);
    const skill = skills[0]!;
    expect(skill.coreCost).toBe(4);
    expect(skill.timing).toEqual({
      step: "attack",
      whose: "both",
      mode: "flash",
    });
    // 疲労状態の相手スピリット/アルティメットを消滅させる本体。
    const action = skill.effects![0]!.steps[0]!.action;
    expect(action.kind).toBe("vanish");
    if (action.kind === "vanish" && action.target.kind === "filter") {
      expect(action.target.filter?.exhaustState).toBe("exhausted");
    }
  });

  it("コア2個ではフラッシュ窓でも発揮不可", () => {
    const state = divineSkillFlashPosition(
      nexusOnField("BSTH04-X01", 2),
      "alice"
    );
    const actions = getAvailableDivineSkillLegalActions(baseOptions(state));
    expect(
      actions.filter((a) => a.sourceInstanceId === "nexus-1")
    ).toHaveLength(0);
  });

  it("コア4個なら自分の優先権を持つフラッシュ窓で発揮可能", () => {
    const state = divineSkillFlashPosition(
      nexusOnField("BSTH04-X01", 4),
      "alice"
    );
    const actions = getAvailableDivineSkillLegalActions(baseOptions(state));
    expect(
      actions.filter((a) => a.sourceInstanceId === "nexus-1")
    ).toHaveLength(1);
  });
});

describe("BSTH01-XX01 [導界者]八雲 紫 — 【導技:2】maxUsesPerTurn=2（ターンに2回）", () => {
  it("印字導シンボルを持つ", () => {
    expect(card("BSTH01-XX01").symbolColors).toEqual(["guide"]);
  });

  it("divineSkills に maxUsesPerTurn:2 が宣言される", () => {
    const skill = card("BSTH01-XX01").grandwalkerData!.divineSkills![0]!;
    expect(skill.coreCost).toBe(2);
    expect(skill.maxUsesPerTurn).toBe(2);
    expect(skill.turnLimit).toBe("once");
  });

  it("使用回数 0/1 では発揮可能、2 回到達で発揮不可（コアは充足）", () => {
    // Lv1（2コア=coreCost 充足、levelDefs Lv2=10 なので Lv1）でメインステップ。
    const base = { ...nexusOnField("BSTH01-XX01", 2), step: "main" as const };
    const usable = (priorUses: string[]) => {
      const state = { ...base, usedDivineSkillKeysThisTurn: priorUses };
      return getAvailableDivineSkillLegalActions(baseOptions(state)).some(
        (a) => a.sourceInstanceId === "nexus-1"
      );
    };
    expect(usable([])).toBe(true); // 0 回
    expect(usable(["nexus-1:0"])).toBe(true); // 1 回 → まだ可
    expect(usable(["nexus-1:0", "nexus-1:0"])).toBe(false); // 2 回 → 不可
  });
});
