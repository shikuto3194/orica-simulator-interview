import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  createCardInstance,
  expandCardDefinitionsWithBackFaces,
} from "@orica/rules-core";
import {
  getEffectSourceDisplay,
  getResolutionSourceDisplay,
} from "../src/utils/effect-source-display";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const getDefinition = (id: string) =>
  definitions.find((card) => card.cardNo === id);
const hostDef = getDefinition("BSGE01-CX01")!;
const braveDef = getDefinition("BSGE01-TR01(A)")!;
const host = createCardInstance(hostDef, {
  instanceId: "host",
  ownerPlayerId: "alice",
  zone: "field",
  attachedChildrenIds: ["brave"],
});
const brave = createCardInstance(braveDef, {
  instanceId: "brave",
  ownerPlayerId: "alice",
  zone: "field",
  attachedToInstanceId: "host",
});
const state = { cardInstances: [host, brave] };
const source = { sourceInstanceId: "host", sourceDefinitionId: hostDef.cardNo };
const provider = {
  effectSourceInstanceId: "brave",
  effectSourceDefinitionId: braveDef.cardNo,
};

describe("effect source display", () => {
  it.each([
    { ...source, ...provider },
    { ...source, continuation: provider },
    { ...source, continuation: {}, deferredStack: provider },
    {
      ...source,
      sourceEffectInstanceId: "brave",
      sourceEffectDefinitionId: braveDef.cardNo,
    },
  ])("keeps queue and effect choices on the same brave for %j", (pending) => {
    const queue = getResolutionSourceDisplay(
      state,
      {
        instanceId: "host",
        definitionId: hostDef.cardNo,
        effectInstanceId: "brave",
        effectDefinitionId: braveDef.cardNo,
      },
      getDefinition
    );
    expect(getEffectSourceDisplay(state, pending, getDefinition)).toEqual(
      queue
    );
    expect(queue).toMatchObject({
      definitionId: braveDef.cardNo,
      imagePath: "/images/BSGE01-TR01(A).webp",
      cardName: braveDef.name,
    });
    expect(host.definitionId).toBe(hostDef.cardNo);
  });

  it("preserves the declared face after the provider flips or is removed", () => {
    for (const cardInstances of [
      [host, { ...brave, definitionId: "BSGE01-TR01(B)" }],
      [host],
    ]) {
      expect(
        getEffectSourceDisplay(
          { cardInstances },
          { ...source, continuation: provider },
          getDefinition
        ).definition
      ).toBe(braveDef);
    }
  });

  it("resolves an instance-only provider before falling back to the host", () => {
    expect(
      getEffectSourceDisplay(
        state,
        { ...source, continuation: { effectSourceInstanceId: "brave" } },
        getDefinition
      ).definition
    ).toBe(braveDef);
    expect(
      getEffectSourceDisplay(
        state,
        { ...source, effectSourceInstanceId: "missing" },
        getDefinition
      ).definition
    ).toBe(hostDef);
  });

  it("keeps ordinary effects on their own card and unknown cards without an image", () => {
    expect(
      getEffectSourceDisplay(state, source, getDefinition).definition
    ).toBe(hostDef);
    expect(
      getEffectSourceDisplay(
        { cardInstances: [] },
        { sourceDefinitionId: "_hidden_card_" },
        getDefinition
      )
    ).toMatchObject({
      imagePath: null,
      cardName: "?",
      definitionId: "_hidden_card_",
    });
  });
});
