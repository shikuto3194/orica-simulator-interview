import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { Effect } from "../src/dsl-types";
import { getHandSummonPermissionSpec } from "../src/effect/structured-effect-registrations";

describe("Q54 通常召喚/配置行動許可の明示分類", () => {
  it("全カード中の Q54 集合は確定6枚と完全一致する", () => {
    const classified = ALL_CARDS.flatMap((definition) =>
      (definition.effects ?? [])
        .map((effect, effectIndex) => ({ effect, effectIndex }))
        .filter(
          ({ effect }) => getHandSummonPermissionSpec(effect) !== undefined
        )
        .map(({ effectIndex }) => `${definition.cardNo}#${effectIndex}`)
    );

    expect(classified.sort()).toEqual(
      [
        "BSFT01-X01#0",
        "BSKB01-M02#1",
        "BSLH01-X02#1",
        "BSSG01-C08#1",
        "BSSL01-M01#0",
        "BSTH01-M01#1",
      ].sort()
    );
  });

  it("activated/main + 先頭 summon だけでは Q54 に分類しない", () => {
    const immediateEffect: Effect = {
      applicability: { zone: "hand" },
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
    };

    expect(getHandSummonPermissionSpec(immediateEffect)).toBeUndefined();
  });

  it("continuous でも明示フラグのない summon step は Q54 に分類しない", () => {
    const unmarkedContinuousEffect: Effect = {
      applicability: { zone: "hand" },
      timing: { kind: "continuous" },
      steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
    };

    expect(
      getHandSummonPermissionSpec(unmarkedContinuousEffect)
    ).toBeUndefined();
  });
});
