import { finishCoreChoices } from "./helpers/core-choice-driver";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  applyLegalAction,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { resolveSummonFromZoneCandidates } from "../src/effect/structured-summon";

import { matchesCardFilter } from "../src/card/card-filter";
import { expandCardDefinitionsWithBackFaces } from "../src";
import type { CardFilter } from "../src/dsl-types";

const definitions = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const getDef = (id: string) => definitions.get(id);
const source = getDef("BSSA01-X02")!;
const effect = source.effects![1]!;
const summon = effect.steps[0]!.action;
if (summon.kind !== "summon" || summon.target.kind !== "from_zone")
  throw new Error("missing free summon");
const target = summon.target;
const noTriggers = () => [];

function setup(): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(source, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      ...(
        [
          ["BSSA01-C01", "spirit", "hand"],
          ["BSSA01-転醒X02(A)", "brave", "set_aside"],
          ["BSSA01-転醒X04(A)", "nexus", "hand"],
        ] as const
      ).map(([no, id, zone]) =>
        createCardInstance(getDef(no)!, {
          instanceId: id,
          ownerPlayerId: "alice",
          zone,
        })
      ),
    ],
    playerOverrides: [{ reserveNormalCoreCount: 20, handCount: 2 }, {}],
  });
}

describe("召喚のみの対象種別", () => {
  it("BSSA01-X02: 夜錆のネクサスを候補にせず、手札スピリットと手元ブレイヴを候補にする", () => {
    const state = setup();
    expect(
      resolveSummonFromZoneCandidates(
        state,
        "alice",
        { zone: "hand_or_set_aside", filter: target.filter },
        getDef
      )
        .map((c) => c.instanceId)
        .sort()
    ).toEqual(["brave", "spirit"]);
  });

  it("BSSA01-X02: 正当な2枚の召喚をコア配置まで解決できる", () => {
    let state = executeEffect({
      chainId: "test:summon-place-category-audit:73",
      state: setup(),
      effect,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
      targetInstanceIds: ["spirit", "brave"],
      targetSelectionResolved: true,
    });
    expect(
      state.pendingMultiPlacement?.targets.map((t) => t.instanceId)
    ).toEqual(["spirit", "brave"]);
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
    }).find((a) => a.kind === "resolve_pending_multi_placement");
    expect(action).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
      multiPlacementAllocations: ["spirit", "brave"].map(
        (destinationInstanceId) => ({
          destinationInstanceId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        })
      ),
    }).state;
    for (const id of ["spirit", "brave"])
      expect(
        state.cardInstances.find((c) => c.instanceId === id)
      ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(
      state.cardInstances.find((c) => c.instanceId === "nexus")?.zone
    ).toBe("hand");
  });

  it("BSSA01-X02: 不正なネクサスIDを直接指定しても配置しない", () => {
    const state = executeEffect({
      chainId: "test:summon-place-category-audit:115",
      state: setup(),
      effect,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
      targetInstanceIds: ["nexus"],
      targetSelectionResolved: true,
    });
    expect(
      state.cardInstances.find((c) => c.instanceId === "nexus")?.zone
    ).toBe("hand");
    expect(state.pendingMultiPlacement).toBeNull();
  });
});

// 2026-09-08 本文監査: 種別指定なしの召喚/配置、および両対応の対照ケース。
const auditedFilters = [
  ["BSAZ01-C06", "effects[3].steps.0.action.target.filter", "summon"],
  ["BSAZ01-C07", "effects[2].steps.0.action.target.filter", "summon"],
  ["BSAZ01-C08", "effects[2].steps.0.action.target.filter", "summon"],
  [
    "BSAZ01-C15",
    "effects[0].steps.0.action.prepaidCost.discardDisposition.ifCardFilter",
    "place",
  ],
  ["BSAZ01-CX01", "effects[1].steps.0.action.picks.1.filter", "summon"],
  ["BSAZ02-C11", "effects[2].steps.1.action.target.filter", "place"],
  [
    "BSAZ02-X05",
    "grandwalkerData.divineSkills[0].effects[0].steps.0.action.target.filter",
    "both",
  ],
  ["BSAZ03-C01", "effects[2].steps.0.choice.0.action.target.filter", "summon"],
  ["BSFT01-C03", "effects[3].steps.1.action.target.filter", "summon"],
  ["BSKB01-C03", "effects[0].steps.1.action.filter", "place"],
  ["BSKB01-M01", "effects[0].steps.0.action.picks.0.filter", "both"],
  ["BSLH01-X07", "effects[1].steps.0.action.target.filter", "summon"],
  ["BSLH01-X07", "effects[2].steps.1.action.picks.0.filter", "summon"],
  ["BSSA01-X02", "effects[1].steps.0.action.target.filter", "summon"],
  ["BSSA01-転醒X03(A)", "effects[1].steps.1.action.target.filter", "summon"],
  ["BSSG01-C08", "effects[4].steps.0.action.target.filter", "summon"],
  ["BSSL01-C05", "effects[0].steps.1.choice.0.action.target.filter", "summon"],
  ["BSTH01-X02", "effects[0].steps.1.action.target.filter", "summon"],
  ["BSTH01-X02", "effects[0].steps.2.action.target.filter", "summon"],
  ["BSTH02.7-X01", "effects[2].steps.0.action.target.filter", "summon"],
  ["BSTH02.7-X01", "effects[3].steps.0.action.target.filter", "summon"],
  ["BSTH02-C01", "effects[2].steps.0.action.target.filter", "summon"],
  ["BSTH05-R01", "effects[0].steps.1.action.target.filter", "summon"],
  ["BSTH05-R03", "effects[0].steps.1.action.target.filter", "summon"],
  ["BSTH06-C03", "effects[0].steps.1.choice.0.action.target.filter", "summon"],
  ["BSTH06-C03", "effects[0].steps.1.choice.1.action.target.filter", "summon"],
  ["BSTH07.8-C05", "effects[3].steps.1.action.target.filter", "summon"],
  ["BSTH09-TR01(B)", "effects[1].steps.0.action.picks.0.filter", "both"],
  ["BSTH11-M01", "effects[1].steps.1.action.target.filter", "summon"],
  ["BSTH11-X02", "effects[1].steps.3.action.picks.0.filter", "both"],
  ["BSTH11-X02", "effects[2].steps.3.action.picks.0.filter", "both"],
  ["BSTS01-C05", "effects[1].steps.0.action.target.filter", "summon"],
] as const;

function readPath(root: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce<unknown>(
      (value, key) => (value as Record<string, unknown>)[key],
      root
    );
}

it.each(auditedFilters)(
  "%s %s: 本文の%sに対応する種別だけ選べる",
  (no, path, mode) => {
    const filter = readPath(getDef(no), path) as CardFilter;
    const nameFilter = Array.isArray(filter.cardName)
      ? filter.cardName[0]
      : filter.cardName;
    const name =
      typeof nameFilter === "string"
        ? nameFilter
        : (nameFilter?.exact ?? nameFilter?.contains ?? "監査候補");
    const categories = [
      "spirit",
      "ultimate",
      "brave",
      "nexus",
      "magic",
    ] as const;
    const accepted = categories.filter((printedCategory) => {
      const definition: CardDefinition = {
        ...source,
        cardNo: "audit-" + printedCategory,
        name,
        printedCategory,
        tribe: filter.tribes?.join("・") ?? "監査",
        colors: filter.colors ?? ["red"],
        cost: filter.minCost ?? filter.maxCost ?? 1,
        keywordTags: filter.isContract ? ["contract"] : [],
        effects: [],
      };
      const instance = createCardInstance(definition, {
        instanceId: "audit-candidate",
        ownerPlayerId: "alice",
        zone: "hand",
      });
      return matchesCardFilter(instance, definition, filter, {
        soulStateIds: new Set(
          filter.soulState === "only" ? [instance.instanceId] : []
        ),
      });
    });
    expect(accepted).toEqual(
      mode === "place"
        ? ["nexus"]
        : mode === "both"
          ? ["spirit", "ultimate", "brave", "nexus"]
          : ["spirit", "ultimate", "brave"]
    );
  }
);

it("全カードの表裏・入れ子・導技のゾーン召喚には明示的な種別制限がある", () => {
  const violations: string[] = [];
  function visit(value: unknown, path: string) {
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    const target = object.target as
      | { kind?: string; filter?: CardFilter }
      | undefined;
    if (
      object.kind === "summon" &&
      target?.kind === "from_zone" &&
      !target.filter?.category?.length
    )
      violations.push(path);
    for (const [key, child] of Object.entries(object))
      visit(child, path + "." + key);
  }
  for (const definition of ALL_CARDS) visit(definition, definition.cardNo);
  expect(violations).toEqual([]);
});

it("BSLH01-X07: デッキ公開でもネクサス/マジックを除外し、選んだ3種だけ召喚する", () => {
  const noel = getDef("BSLH01-X07")!;
  const categories = ["spirit", "ultimate", "brave", "nexus", "magic"] as const;
  const candidates = categories.map(
    (printedCategory) =>
      ({
        ...source,
        cardNo: `reveal-${printedCategory}`,
        name: `CB ${printedCategory}`,
        printedCategory,
        tribe: "CB",
        cost: 1,
        effects: [],
        levelDefs: [
          {
            level: 1,
            requiredCores: printedCategory === "nexus" ? 0 : 1,
            bp: 1000,
          },
        ],
      }) satisfies CardDefinition
  );
  const candidateMap = new Map(candidates.map((c) => [c.cardNo, c]));
  const lookup = (id: string): CardDefinition | undefined =>
    candidateMap.get(id) ?? getDef(id);
  const cardInstances = [
    createCardInstance(noel, {
      instanceId: "noel",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    }),
    ...candidates.map((definition) =>
      createCardInstance(definition, {
        instanceId: definition.cardNo,
        ownerPlayerId: "alice",
        zone: "deck",
      })
    ),
  ];
  const revealStep = noel.effects![2]!.steps[1]!;
  let state = executeEffect({
    chainId: "test:summon-place-category-audit:299",
    state: createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances,
      playerOverrides: [{ deckCount: 5, reserveNormalCoreCount: 20 }, {}],
    }),
    effect: {
      timing: { kind: "activated", mode: "flash" },
      steps: [{ action: revealStep.action }],
    },
    sourceInstanceId: "noel",
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: noTriggers,
  });
  const pick = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: noTriggers,
  }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
  if (pick?.kind !== "resolve_pending_deck_reveal_pick")
    throw new Error("missing reveal pick");
  const eligible = ["reveal-spirit", "reveal-ultimate", "reveal-brave"];
  expect(pick.candidateCardInstanceIds).toEqual(eligible);
  state = applyLegalAction({
    state,
    action: pick,
    selectedDeckRevealCardIds: eligible,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: noTriggers,
  }).state;
  state = finishCoreChoices(state, lookup);
  const order = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: noTriggers,
  }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
  if (order?.kind === "resolve_pending_deck_reveal_order")
    state = applyLegalAction({
      state,
      action: order,
      deckRevealRemainderOrder: order.remainingCardInstanceIds,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: noTriggers,
    }).state;
  state = finishCoreChoices(state, lookup);
  for (const id of eligible)
    expect(state.cardInstances.find((c) => c.instanceId === id)).toMatchObject({
      zone: "field",
      normalCoreCount: 1,
    });
  for (const id of ["reveal-nexus", "reveal-magic"])
    expect(state.cardInstances.find((c) => c.instanceId === id)?.zone).toBe(
      "deck"
    );
});
