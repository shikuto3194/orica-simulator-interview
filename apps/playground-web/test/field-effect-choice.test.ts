import { describe, expect, it } from "vitest";
import type {
  CardDefinition,
  FieldCardEffectLegalAction,
} from "@orica/rules-core";
import { buildFieldCardEffectLookup } from "@orica/rules-core";
import { ALL_CARDS } from "@orica/card-data";
import {
  compactEffectChoiceText,
  dedupeFieldEffectChoiceActions,
  extractEffectChoiceTextByEffectIndex,
  fieldEffectChoiceActionKey,
  getFieldEffectActionDefinitionId,
} from "../src/utils/field-effect-choice";

function makeAction(
  overrides: Partial<FieldCardEffectLegalAction> = {}
): FieldCardEffectLegalAction {
  return {
    kind: "use_field_card_effect",
    actionId: "effect",
    can: true,
    reason: "test",
    actingPlayerId: "alice",
    sourceKind: "spirit",
    timing: "normal",
    sourceInstanceId: "host-1",
    sourceDefinitionId: "HOST",
    sourceCardNo: "HOST",
    registrationIndex: 0,
    targetMode: "none",
    requiredTargetCount: 0,
    targetEffectFilterTags: ["general"],
    candidateTargetInstanceIds: [],
    availableChosenLifeCoreKinds: [],
    requiresChosenLifeCoreKind: false,
    ...overrides,
  };
}

describe("field effect choice helpers", () => {
  it("uses the actual effect source definition for under-card effects", () => {
    const action = makeAction({
      sourceCardNo: "UNDER",
      sourceEffectDefinitionId: "UNDER",
      sourceEffectInstanceId: "under-1",
    });

    expect(getFieldEffectActionDefinitionId(action)).toBe("UNDER");
    expect(fieldEffectChoiceActionKey(action)).toContain("under-1:UNDER");
  });

  it("dedupes identical low-level actions without merging distinct effect sources", () => {
    const host = makeAction();
    const duplicateHost = makeAction({ actionId: "effect-duplicate" });
    const under = makeAction({
      actionId: "effect-under",
      sourceCardNo: "UNDER",
      sourceEffectDefinitionId: "UNDER",
      sourceEffectInstanceId: "under-1",
    });
    const choiceVariant = makeAction({
      actionId: "effect-choice",
      choiceIndex: 1,
    });

    expect(
      dedupeFieldEffectChoiceActions([
        host,
        duplicateHost,
        under,
        choiceVariant,
      ])
    ).toEqual([host, under, choiceVariant]);
  });

  it("compacts effect text so buttons do not preserve blank lines", () => {
    expect(compactEffectChoiceText(" 見出し \n\n 本文 \r\n  \n 続き ")).toBe(
      "見出し\n本文\n続き"
    );
  });

  it("uses registration effectIndex so BSGE01-M03 under-card action shows 奇霊：ショット", () => {
    const cards = ALL_CARDS as CardDefinition[];
    const def = cards.find((card) => card.cardNo === "BSGE01-M03");
    const lookup = buildFieldCardEffectLookup(cards);
    const registration = lookup("BSGE01-M03")?.[0];

    expect(registration?.effectIndex).toBe(3);
    expect(
      extractEffectChoiceTextByEffectIndex(def, registration?.effectIndex)
    ).toBe(
      "【奇霊：ショット】（自分の【バレットエディット】でスピリットの下にあるカードは以下の効果を発揮する。）\n〔ターンに1回：同名〕自分のターン中、フラッシュタイミングで、自分のカウント-2することで、相手の創界神ネクサスすべてのコアすべてをボイドに置く。"
    );
  });
});
