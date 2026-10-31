import { ALL_CARDS } from "@orica/card-data";
import { buildCoreHudAuditScenario } from "../src/scenario-core-hud-audit";
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
} from "@orica/rules-core";
import { buildPlacementFieldSources } from "../src/placementFieldSources";

const ALICE = "alice";
const BOB = "bob";

function spiritDef(
  cardNo: string,
  tokenIndependentCoreManagement?: CardDefinition["tokenIndependentCoreManagement"]
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    ...(tokenIndependentCoreManagement !== undefined
      ? { tokenIndependentCoreManagement }
      : {}),
  } as CardDefinition;
}

describe("buildPlacementFieldSources", () => {
  it("BSLH の召喚中は最後の1個を候補にせず、通常/ソウルの合計上限も公開する", () => {
    const definition = spiritDef("FLOOR");
    const source = createCardInstance(definition, {
      instanceId: "floor-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
    });
    state.pendingMultiPlacement = {
      pendingId: "floor",
      actingPlayerId: ALICE,
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: definition.cardNo,
      targets: [],
      effectTiming: { kind: "activated", mode: "main" },
      fieldCoreSourceMinimum: {
        categories: ["spirit", "ultimate"],
        minimum: 1,
      },
    };
    const options = {
      state,
      actingPlayerId: ALICE,
      getDefinition: () => definition,
    };
    expect(buildPlacementFieldSources(options)).toEqual([]);
    state.cardInstances[0]!.soulCoreCount = 1;
    expect(buildPlacementFieldSources(options)).toEqual([
      {
        instanceId: source.instanceId,
        definitionId: definition.cardNo,
        maxAmount: 1,
        maxTotalAmount: 1,
        hasSoul: true,
      },
    ]);
  });
  it("excludes forced-void token cards from enter-field placement sources", () => {
    const plain = spiritDef("PLAIN");
    const forcedVoidToken = spiritDef("FORCED-VOID", {
      redirectCoresToVoid: true,
      placementRestrictedToEnterField: true,
    });
    const fieldPlain = createCardInstance(plain, {
      instanceId: "plain-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const fieldForcedVoid = createCardInstance(forcedVoidToken, {
      instanceId: "forced-void-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const opponentPlain = createCardInstance(plain, {
      instanceId: "opponent-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [fieldPlain, fieldForcedVoid, opponentPlain],
    });
    const defs = new Map([
      [plain.cardNo, plain],
      [forcedVoidToken.cardNo, forcedVoidToken],
    ]);

    const sources = buildPlacementFieldSources({
      state,
      actingPlayerId: ALICE,
      getDefinition: (definitionId) => defs.get(definitionId),
    });

    expect(sources.map((source) => source.instanceId)).toEqual([
      "plain-source",
    ]);
  });

  it("excludes a forced-void token placement source even when it has the soul core", () => {
    const forcedVoidToken = spiritDef("FORCED-VOID", {
      redirectCoresToVoid: true,
      placementRestrictedToEnterField: true,
    });
    const source = createCardInstance(forcedVoidToken, {
      instanceId: "forced-void-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
    });

    const sources = buildPlacementFieldSources({
      state,
      actingPlayerId: ALICE,
      getDefinition: () => forcedVoidToken,
    });

    expect(sources).toEqual([]);
  });

  it("keeps a normal soulCoreCount-only field source when the shared placement predicate allows it", () => {
    const plain = spiritDef("PLAIN");
    const soulOnly = createCardInstance(plain, {
      instanceId: "soul-only-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
      soulCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [soulOnly],
    });

    const sources = buildPlacementFieldSources({
      state,
      actingPlayerId: ALICE,
      getDefinition: () => plain,
    });

    expect(sources).toEqual([
      {
        instanceId: "soul-only-source",
        definitionId: plain.cardNo,
        maxAmount: 0,
        maxTotalAmount: 1,
        hasSoul: true,
      },
    ]);
  });

  it.each(["grandwalker", "guided", "grandstone"])(
    "%sの通常/ソウルコアを配置元に含めない",
    (kind) => {
      const definition = ALL_CARDS.find((d) =>
        kind === "grandstone"
          ? !!d.grandstoneData
          : d.grandwalkerData?.kind === kind
      )!;
      expect(definition).toBeDefined();
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(definition, {
            instanceId: "independent",
            ownerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 6,
            soulCoreCount: 1,
          }),
        ],
      });
      expect(
        buildPlacementFieldSources({
          state,
          actingPlayerId: ALICE,
          getDefinition: () => definition,
        })
      ).toEqual([]);
    }
  );

  it("BSSA01-X02の2体配置ではカーディナルを除外し、召喚元の3コアを提示する", () => {
    const state = buildCoreHudAuditScenario(
      [...ALL_CARDS],
      new URLSearchParams({ kind: "night-rust" })
    );
    expect(
      buildPlacementFieldSources({
        state,
        actingPlayerId: ALICE,
        getDefinition: (id) => ALL_CARDS.find((d) => d.cardNo === id),
        excludeInstanceIds: new Set(
          state.pendingMultiPlacement!.targets.map((t) => t.instanceId)
        ),
      })
    ).toEqual([
      {
        instanceId: "hud-summoner",
        definitionId: "BSSA01-X02",
        maxAmount: 3,
        maxTotalAmount: 3,
        hasSoul: false,
      },
    ]);
  });

  it("通常コア移動禁止時は通常コアを提示せず、移動できるソウルだけを残す", () => {
    const definition = spiritDef("PLAIN");
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "restricted",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 2,
          soulCoreCount: 1,
        }),
      ],
    });
    state.activeContinuousEffects = [
      {
        effectId: "normal-locked",
        sourceInstanceId: "restricted",
        sourceDefinitionId: definition.cardNo,
        actingPlayerId: ALICE,
        targetInstanceId: "restricted",
        modifierTag: "prevent_normal_core_move",
        duration: { scope: "permanent" },
        createdAtTurn: 1,
        createdAtAttackId: null,
      },
    ];
    expect(
      buildPlacementFieldSources({
        state,
        actingPlayerId: ALICE,
        getDefinition: () => definition,
      })
    ).toEqual([
      {
        instanceId: "restricted",
        definitionId: definition.cardNo,
        maxAmount: 0,
        maxTotalAmount: 1,
        hasSoul: true,
      },
    ]);
  });
});
