/**
 * P3-67: burst registration builder の単体テスト。
 *
 * generateBurstRegistrations / buildBurstEffectLookup が BurstTrigger (構造化 + 文字列) を
 * BurstEventKind に変換し registration を生成すること、対応外 trigger を skip することを検証する。
 */
import { describe, expect, it } from "vitest";
import {
  generateBurstRegistrations,
  buildBurstEffectLookup,
} from "../src/effect/structured-effect-registrations";
import type { BurstTrigger, CardDefinition } from "../src/model";

function burstCard(
  trigger: BurstTrigger | undefined,
  printedCategory: CardDefinition["printedCategory"] = "spirit",
  triggerFilter?: import("../src/dsl-types").CardFilter
): CardDefinition {
  return {
    cardNo: "TEST-BURST",
    name: "test burst",
    printedCategory,
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: ["burst"],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing:
          trigger === undefined
            ? { kind: "burst", ...(triggerFilter ? { triggerFilter } : {}) }
            : {
                kind: "burst",
                trigger,
                ...(triggerFilter ? { triggerFilter } : {}),
              },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
          },
        ],
      },
    ],
  };
}

describe("generateBurstRegistrations: 構造化 trigger", () => {
  it("life_decrease → reduce_life (whose: self)", () => {
    const regs = generateBurstRegistrations(
      burstCard({ kind: "life_decrease", player: "self" })
    );
    expect(regs).toHaveLength(1);
    expect(regs[0]!.eventKind).toBe("reduce_life");
    expect(regs[0]!.sourceKind).toBe("spirit");
    expect(regs[0]!.whose).toBe("self");
  });

  it("spirit_destroyed → leave_field (whose: opponent)", () => {
    const regs = generateBurstRegistrations(
      burstCard({ kind: "spirit_destroyed", player: "opponent" })
    );
    expect(regs[0]?.eventKind).toBe("leave_field");
    expect(regs[0]?.whose).toBe("opponent");
  });

  it("opponent_summon → summon (whose: opponent)", () => {
    const regs = generateBurstRegistrations(
      burstCard({ kind: "opponent_summon" })
    );
    expect(regs[0]?.eventKind).toBe("summon");
    expect(regs[0]?.whose).toBe("opponent");
  });

  it("spirit_exhausted → exhaust (whose: self) [P3-67 Phase 4]", () => {
    const regs = generateBurstRegistrations(
      burstCard({ kind: "spirit_exhausted", player: "self" })
    );
    expect(regs).toHaveLength(1);
    expect(regs[0]!.eventKind).toBe("exhaust");
    expect(regs[0]!.whose).toBe("self");
  });

  it("attack_finished → attack_after (whose: opponent)", () => {
    const regs = generateBurstRegistrations(
      burstCard({ kind: "attack_finished", player: "opponent" })
    );
    expect(regs).toHaveLength(1);
    expect(regs[0]!.eventKind).toBe("attack_after");
    expect(regs[0]!.whose).toBe("opponent");
  });
});

describe("generateBurstRegistrations: 文字列 trigger", () => {
  it("『自分のライフ減少後』→ reduce_life (whose: self)", () => {
    const regs = generateBurstRegistrations(burstCard("自分のライフ減少後"));
    expect(regs[0]?.eventKind).toBe("reduce_life");
    expect(regs[0]?.whose).toBe("self");
  });

  it("『相手によって自分のスピリットがフィールドを離れた後』→ leave_field (whose: self、主語=自分のスピリット)", () => {
    const regs = generateBurstRegistrations(
      burstCard("相手によって自分のスピリットがフィールドを離れた後")
    );
    expect(regs[0]?.eventKind).toBe("leave_field");
    // 「相手によって」は原因。主語は「自分のスピリット」→ whose: self。
    expect(regs[0]?.whose).toBe("self");
    expect(regs[0]?.cause).toEqual([
      "opponent_effect",
      "battle",
      "opponent_bp_compare",
    ]);
  });

  it("『相手のスピリットのアタック後』→ attack_after (whose: opponent)", () => {
    const regs = generateBurstRegistrations(
      burstCard("相手のスピリットのアタック後")
    );
    expect(regs[0]?.eventKind).toBe("attack_after");
    expect(regs[0]?.whose).toBe("opponent");
  });

  it("triggerFilter を registration に伝搬する", () => {
    const regs = generateBurstRegistrations(
      burstCard("相手のアルティメットのアタック後", "spirit", {
        category: ["ultimate"],
      })
    );
    expect(regs[0]?.triggerFilter).toEqual({ category: ["ultimate"] });
  });

  it("『相手によって自分のスピリットが離れた後』→ 相手起因 cause [P3-67]", () => {
    const regs = generateBurstRegistrations(
      burstCard("相手によって自分のスピリットがフィールドを離れた後")
    );
    expect(regs[0]?.cause).toEqual([
      "opponent_effect",
      "battle",
      "opponent_bp_compare",
    ]);
  });

  it("『相手の効果によって相手の手札が増えた後』→ 増えた側から見て self_effect", () => {
    const regs = generateBurstRegistrations(
      burstCard("相手の効果によって相手の手札が増えた後")
    );
    expect(regs[0]?.cause).toEqual(["self_effect"]);
  });

  it("『自分によって自分のスピリットが離れた後』→ 自分起因 cause (効果 + BP比べ) [Q18317]", () => {
    const regs = generateBurstRegistrations(
      burstCard("自分によって自分のスピリットがフィールドを離れた後")
    );
    expect(regs[0]?.whose).toBe("self");
    expect(regs[0]?.cause).toEqual(["self_effect", "self_bp_compare"]);
  });

  it("『自分によって相手のスピリットが離れた後』→ 主語 opponent + 自分起因 cause [Q18317]", () => {
    const regs = generateBurstRegistrations(
      burstCard("自分によって相手のスピリットがフィールドを離れた後")
    );
    expect(regs[0]?.whose).toBe("opponent");
    expect(regs[0]?.cause).toEqual([
      "opponent_effect",
      "battle",
      "opponent_bp_compare",
    ]);
  });

  it("原因絞りのない trigger は cause を持たない", () => {
    const regs = generateBurstRegistrations(burstCard("自分のライフ減少後"));
    expect(regs[0]?.cause).toBeUndefined();
  });

  it("効果発揮型『相手の「召喚時」発揮後』→ effect_activated (whose: opponent) [P3-67 Phase 3]", () => {
    const regs = generateBurstRegistrations(
      burstCard("相手の「このスピリット／アルティメットの召喚時」発揮後")
    );
    expect(regs).toHaveLength(1);
    expect(regs[0]!.eventKind).toBe("effect_activated");
    expect(regs[0]!.whose).toBe("opponent");
    expect(regs[0]!.eventMatcher).toEqual({
      family: "effect_activation",
      actionKind: "summon",
    });
  });

  it("効果発揮型『召喚／配置時発揮後』→ timing ごとに 2 registration [P3-67 Phase 3]", () => {
    const regs = generateBurstRegistrations(
      burstCard("相手の「このスピリット／ネクサスの召喚／配置時」発揮後")
    );
    expect(regs).toHaveLength(2);
    expect(regs.map((r) => r.eventMatcher?.actionKind).sort()).toEqual([
      "placement",
      "summon",
    ]);
  });
});

describe("generateBurstRegistrations: effect_activated 構造化 trigger", () => {
  it("activatedTimings から eventMatcher を生成", () => {
    const regs = generateBurstRegistrations(
      burstCard({
        kind: "effect_activated",
        player: "opponent",
        activatedTimings: ["summon", "advent"],
      })
    );
    expect(regs).toHaveLength(2);
    expect(regs.every((r) => r.eventKind === "effect_activated")).toBe(true);
    expect(regs.every((r) => r.whose === "opponent")).toBe(true);
    expect(regs.map((r) => r.eventMatcher?.actionKind).sort()).toEqual([
      "advent",
      "summon",
    ]);
  });
});

describe("generateBurstRegistrations: handSource（手札からの直接バースト発動）", () => {
  it("timing.handSource / handSourceCondition を registration に伝搬する [2026-06-16 裁定]", () => {
    const card = burstCard("相手のスピリットのアタック後");
    // burstCard ヘルパは単一 effect。handSource フィールドを直書きで付与する。
    card.effects![0]!.timing = {
      kind: "burst",
      trigger: "相手のスピリットのアタック後",
      handSource: true,
      handSourceCondition: [{ kind: "count_value", player: "self", min: 5 }],
    };
    const regs = generateBurstRegistrations(card);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.handSource).toBe(true);
    expect(regs[0]!.handSourceCondition).toEqual([
      { kind: "count_value", player: "self", min: 5 },
    ]);
  });

  it("handSource 未指定の通常バーストは handSource を持たない（後方互換）", () => {
    const regs = generateBurstRegistrations(
      burstCard("相手のスピリットのアタック後")
    );
    expect(regs[0]!.handSource).toBeUndefined();
    expect(regs[0]!.handSourceCondition).toBeUndefined();
  });
});

describe("generateBurstRegistrations: 対象外", () => {
  it("trigger なし → registration なし", () => {
    const regs = generateBurstRegistrations(burstCard(undefined));
    expect(regs).toHaveLength(0);
  });

  it("magic カテゴリでも burst registration を生成する", () => {
    const regs = generateBurstRegistrations(
      burstCard({ kind: "life_decrease", player: "self" }, "magic")
    );
    expect(regs[0]?.sourceKind).toBe("magic");
  });
});

describe("buildBurstEffectLookup", () => {
  it("cardNo でマップし、未登録は undefined", () => {
    const lookup = buildBurstEffectLookup([
      burstCard({ kind: "life_decrease", player: "self" }),
    ]);
    expect(lookup("TEST-BURST")).toHaveLength(1);
    expect(lookup("UNKNOWN")).toBeUndefined();
  });

  it("registration が 0 件のカードは map に載せない", () => {
    const lookup = buildBurstEffectLookup([burstCard(undefined)]);
    expect(lookup("TEST-BURST")).toBeUndefined();
  });
});
