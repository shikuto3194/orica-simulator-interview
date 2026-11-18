import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getAvailableCardCostPaymentSources } from "../src/core/payment-system";
import { isCardRecoveryRestricted } from "../src/effect/recovery-restriction";
import { matchesHostCardFilter } from "../src/effect/native-action-shared";
import { materializeGrantedEffects } from "../src/effect/granted-effect-materialization";
import {
  evaluateStatelessSourceCount,
  getTenshoTargetCandidates,
  isBlockedByFieldNameUniqueness,
  matchesGlobalCETargetFilter,
} from "../src/legal/legal-actions-shared";
import { isTextRoleUnderActiveSpiritHost } from "../src/mechanics/star-garment-utils";
import type { CardFilter } from "../src/dsl-types";
import type { CardDefinition, ContinuousEffect } from "../src/model";

// Eternal page09: a standalone field Brave is a Spirit. Q20090 explicitly
// permits it as a Tensho target. Field identity does not follow a card into hand
// or trash, and an attached Brave is not an additional independent Spirit.
const spiritFilter: CardFilter = {
  category: ["spirit"],
  tribes: ["監査ブレイヴ"],
};

function definition(
  cardNo: string,
  printedCategory: CardDefinition["printedCategory"]
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory,
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    tribe: printedCategory === "brave" ? "監査ブレイヴ" : "監査ホスト",
    textLines: ["コピー対象の能力"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        textRef: [0],
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

type BraveState =
  | "standalone"
  | "combined"
  | "under"
  | "soul"
  | "hand"
  | "trash";

function fixture(mode: BraveState = "standalone") {
  const hostDef = definition("AUDIT-HOST", "spirit");
  const braveDef = definition("AUDIT-BRAVE", "brave");
  const candidateDef = {
    ...definition("AUDIT-CANDIDATE", "spirit"),
    tribe: "監査ブレイヴ",
  };
  const host = createCardInstance(hostDef, {
    instanceId: "host",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  const brave = createCardInstance(braveDef, {
    instanceId: "brave",
    ownerPlayerId: "alice",
    zone: mode === "hand" || mode === "trash" ? mode : "field",
    cores: 2,
    exhaustState: "exhausted",
  });
  if (mode === "combined" || mode === "under") {
    brave.attachedToInstanceId = host.instanceId;
    if (mode === "combined") host.attachedChildrenIds = [brave.instanceId];
    else
      host.underCards = [
        { role: "advent_source", cardInstanceId: brave.instanceId },
      ];
  }
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [host, brave],
  });
  if (mode === "soul")
    state.players[0]!.soulStateInstanceIds = [brave.instanceId];
  const getDef = (id: string) =>
    [hostDef, braveDef, candidateDef].find((def) => def.cardNo === id);
  const ce = (
    modifierTag: ContinuousEffect["modifierTag"]
  ): ContinuousEffect => ({
    effectId: `audit-${modifierTag}`,
    sourceInstanceId: host.instanceId,
    sourceDefinitionId: host.definitionId,
    actingPlayerId: "alice",
    targetInstanceId: "alice",
    modifierTag,
    duration: { scope: "turn" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: null,
  });
  return { state, host, hostDef, brave, braveDef, candidateDef, getDef, ce };
}

describe("spirit-state Brave field reference consumers", () => {
  it.each<BraveState>([
    "standalone",
    "combined",
    "under",
    "soul",
    "hand",
    "trash",
  ])("%s: field references share the Spirit boundary", (mode) => {
    const f = fixture(mode);
    const expected = mode === "standalone";
    const recovery = {
      ...f.ce("prevent_recovery"),
      metadata: { filter: spiritFilter },
    };
    f.state.activeContinuousEffects = [recovery];

    expect(isCardRecoveryRestricted(f.state, f.brave, f.getDef)).toBe(expected);
    expect(
      matchesHostCardFilter(
        f.state,
        f.brave,
        f.braveDef,
        spiritFilter,
        f.getDef
      )
    ).toBe(expected);
    expect(
      isTextRoleUnderActiveSpiritHost({
        state: f.state,
        hostCard: f.brave,
        hostDefinition: f.braveDef,
      })
    ).toBe(expected);
    expect(
      evaluateStatelessSourceCount(
        f.state,
        "alice",
        {
          kind: "cards_in_zone",
          player: "self",
          zone: "field",
          filter: spiritFilter,
        },
        f.getDef
      )
    ).toBe(expected ? 1 : 0);
    expect(
      evaluateStatelessSourceCount(
        f.state,
        "alice",
        {
          kind: "field_bp_total",
          player: "self",
          filter: spiritFilter,
        },
        f.getDef
      )
    ).toBe(expected ? 3000 : 0);
    expect(
      getTenshoTargetCandidates(
        f.state,
        "alice",
        {
          targetFilter: spiritFilter,
          minCores: 1,
          destination: "void",
        },
        f.getDef
      )
    ).toEqual(expected ? [f.brave.instanceId] : []);

    const global = {
      ...f.ce("bp_modifier"),
      targetFilter: { ...spiritFilter, player: "self" as const },
    };
    expect(
      matchesGlobalCETargetFilter(f.state, global, f.brave, f.getDef)
    ).toBe(expected);
    const payments = getAvailableCardCostPaymentSources({
      state: f.state,
      actingPlayerId: "alice",
      card: f.candidateDef,
      getCardDefinitionById: f.getDef,
      onBoardCoreSourceFilter: spiritFilter,
    });
    expect(
      payments.onBoardCoreSources.map((source) => source.instanceId)
    ).toEqual(expected ? [f.brave.instanceId] : []);
  });

  it.each<BraveState>(["standalone", "combined", "under", "soul"])(
    "%s: a restricted field Spirit is counted for uniqueness",
    (mode) => {
      const f = fixture(mode);
      f.state.activeContinuousEffects = [
        {
          ...f.ce("field_name_uniqueness"),
          metadata: { restrictFilter: spiritFilter, maxCount: 1 },
        },
      ];
      expect(
        isBlockedByFieldNameUniqueness(
          f.state,
          "alice",
          f.candidateDef,
          f.getDef
        )
      ).toBe(mode === "standalone");
    }
  );

  it.each<BraveState>([
    "standalone",
    "combined",
    "under",
    "soul",
    "hand",
    "trash",
  ])("%s: field effect donors use the same Spirit boundary", (mode) => {
    const f = fixture(mode);
    f.state.activeContinuousEffects = [
      {
        ...f.ce("granted_effect"),
        targetInstanceId: f.host.instanceId,
        metadata: {
          grantedEffectSource: {
            kind: "card_effects",
            from: { kind: "zones", zones: ["field"], filter: spiritFilter },
            afterTextHeader: "コピー対象の能力",
          },
        },
      },
    ];
    const result = materializeGrantedEffects(
      f.state,
      f.getDef,
      ({ state }) => state
    );
    expect(
      result.activeContinuousEffects.filter(
        (effect) =>
          effect.metadata?.grantedEffectSourceInstanceId === f.brave.instanceId
      )
    ).toHaveLength(mode === "standalone" ? 1 : 0);
  });

  it("under-card effect donors retain their printed Brave category", () => {
    const f = fixture("under");
    const parent = {
      ...f.ce("granted_effect"),
      targetInstanceId: f.host.instanceId,
      metadata: {
        grantedEffectSource: {
          kind: "card_effects",
          from: { kind: "under_cards", filter: { category: ["brave"] } },
          afterTextHeader: "コピー対象の能力",
        },
      },
    };
    f.state.activeContinuousEffects = [parent];
    const result = materializeGrantedEffects(
      f.state,
      f.getDef,
      ({ state }) => state
    );
    expect(
      result.activeContinuousEffects.filter(
        (effect) =>
          effect.metadata?.grantedEffectSourceInstanceId === f.brave.instanceId
      )
    ).toHaveLength(1);
  });
});
