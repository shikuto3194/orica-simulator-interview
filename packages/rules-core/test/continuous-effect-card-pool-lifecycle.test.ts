import { expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  type Zone,
} from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";

it("全カードの到達した常時効果は、盤面を変えない後処理で消滅・再登録しない", () => {
  const definitions = new Map(
    expandCardDefinitionsWithBackFaces(ALL_CARDS).map((card) => [
      card.cardNo,
      card,
    ])
  );
  const lookup = (id: string) => definitions.get(id);
  const lost: string[] = [];
  for (const card of definitions.values()) {
    for (const zone of [
      "field",
      "hand",
      "trash",
      "set_aside",
      "revealed",
    ] as const satisfies readonly Zone[]) {
      if (
        zone !== "field" &&
        !card.effects?.some(
          (effect) =>
            effect.timing.kind === "continuous" &&
            [effect.applicability?.zone].flat().includes(zone)
        )
      )
        continue;
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(card, {
            instanceId: "source",
            ownerPlayerId: "alice",
            zone,
            normalCoreCount: Math.max(
              1,
              ...card.levelDefs.map((level) => level.requiredCores)
            ),
          }),
        ],
      });
      const registered = rebuildContinuousEffectsFromField(state, lookup);
      const cleaned = recomputeContinuousEffects(registered, lookup);
      for (const ce of registered.activeContinuousEffects) {
        if (
          !cleaned.activeContinuousEffects.some(
            (effect) => effect.effectId === ce.effectId
          )
        )
          lost.push(
            `${card.cardNo}/${zone}/${ce.modifierTag}/${ce.provenance?.effectIndex}`
          );
      }
    }
  }
  expect(lost).toEqual([]);
});
