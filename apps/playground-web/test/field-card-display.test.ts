import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  createCardInstance,
  createEmptyGameState,
  moveCardZone,
  executeEffect,
  applyLegalAction,
  getLegalActions,
  getEffectiveCategory,
  recomputeAndRebuildContinuousEffects,
  buildTriggeredEffectLookup,
  sanitizeStateForViewer,
} from "@orica/rules-core";
import { fieldCardDisplayKind } from "../src/utils/field-card-display";

const definitions = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getDefinition = (id: string) => definitions.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);

describe("field card display audit", () => {
  it("転神中だけスピリット列に移り、解除時と魂状態ではネクサス列へ戻る", () => {
    const card = createCardInstance(definitions.get("BSTH003-X01")!, {
      instanceId: "nexus",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 3,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
    });
    expect(fieldCardDisplayKind(state, card, getDefinition)).toBe("nexus");
    card.divineTransformState = {
      bpByLevel: [{ level: 1, bp: 10000 }],
      protectedFromNonGrandwalker: false,
    };
    expect(
      getEffectiveCategory(state, card, definitions.get(card.definitionId)!)
    ).toBe("nexus");
    expect(fieldCardDisplayKind(state, card, getDefinition)).toBe("spirit");
    const soulState = {
      ...state,
      players: state.players.map((p) => ({
        ...p,
        soulStateInstanceIds: p.id === "alice" ? [card.instanceId] : [],
      })),
    };
    expect(fieldCardDisplayKind(soulState, card, getDefinition)).toBe("nexus");
    card.divineTransformState = undefined;
    expect(fieldCardDisplayKind(state, card, getDefinition)).toBe("nexus");
  });

  it("表向きカード状態も共通判定でカード列へ置き、種類の状態付与を表示へ反映する", () => {
    const card = createCardInstance(definitions.get("BSTH01-C01")!, {
      instanceId: "card",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "card",
    });
    const state = createEmptyGameState({ cardInstances: [card] });
    expect(fieldCardDisplayKind(state, card, getDefinition)).toBe("card");
    for (const category of ["spirit", "nexus"] as const) {
      const granted = {
        ...state,
        activeContinuousEffects: [
          {
            effectId: "state-grant",
            modifierTag: "override_properties" as const,
            targetInstanceId: "card",
            sourceInstanceId: "host",
            sourceDefinitionId: "BSTH01-X04",
            actingPlayerId: "alice",
            duration: { scope: "turn" as const },
            createdAtTurn: 1,
            createdAtAttackId: null,
            metadata: { properties: { treatAsCategory: category } },
          },
        ],
      };
      expect(fieldCardDisplayKind(granted, card, getDefinition)).toBe(category);
    }
  });

  it("X04の参照元が離脱すると、残った裏向きカードを元の印字種類へ戻さずカード列へ移す", () => {
    const hostDef = definitions.get("BSTH01-X04")!;
    const filler = definitions.get("BSTH01-C01")!;
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(hostDef, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
        }),
        ...Array.from({ length: 3 }, (_, i) =>
          createCardInstance(filler, {
            instanceId: `clone-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
      playerOverrides: [{ deckCount: 3, reserveNormalCoreCount: 3 }, {}],
    });
    let state = executeEffect({
      chainId: "test:field-card-display:75",
      state: base,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      effect: hostDef.effects![1]!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
    });
    const pendingClones = state.cardInstances.filter((c) => c.faceDown);
    expect(pendingClones).toHaveLength(3);
    for (const view of [state, sanitizeStateForViewer(state, "alice")]) {
      for (const clone of pendingClones) {
        expect(fieldCardDisplayKind(view, clone, getDefinition)).toBe("spirit");
        // コア配置前に種類や戦闘能力を付与するわけではない。
        expect(getEffectiveCategory(view, clone, filler)).toBeUndefined();
        expect(
          fieldCardDisplayKind(
            { ...view, pendingCoreDistribution: null },
            clone,
            getDefinition
          )
        ).toBe("card");
      }
    }
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(action).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      coreDistributionAllocations: { "clone-0": 1, "clone-1": 1, "clone-2": 1 },
      coreDistributionSourceAllocations: { reserve: 3 },
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
    }).state;
    const clones = state.cardInstances.filter((c) => c.faceDown);
    expect(clones).toHaveLength(3);
    for (const clone of clones)
      expect(fieldCardDisplayKind(state, clone, getDefinition)).toBe("spirit");

    // 分身に載った効果記述がなくても、分身としての状態は残る。
    const withoutAbilities = {
      ...state,
      activeContinuousEffects: state.activeContinuousEffects.map((ce) =>
        ce.modifierTag === "act_as_spirit"
          ? {
              ...ce,
              metadata: {
                ...ce.metadata,
                overrides: {
                  ...(ce.metadata?.overrides as object),
                  keywords: [],
                },
              },
            }
          : ce
      ),
    };
    for (const clone of clones)
      expect(fieldCardDisplayKind(withoutAbilities, clone, getDefinition)).toBe(
        "spirit"
      );

    // 対象変更せず本体が実際に離脱した後の、既存の参照元寿命処理。
    const departed = recomputeAndRebuildContinuousEffects(
      moveCardZone(state, "host", "trash"),
      getDefinition
    );
    for (const clone of clones) {
      const remaining = departed.cardInstances.find(
        (c) => c.instanceId === clone.instanceId
      )!;
      expect(remaining).toEqual(clone);
      expect(getEffectiveCategory(departed, remaining, filler)).toBeUndefined();
      expect(fieldCardDisplayKind(departed, remaining, getDefinition)).toBe(
        "card"
      );
    }
  });

  it.each(["spirit", "ultimate", "nexus", "brave", "magic", "quartz", "arts"])(
    "face-down %s belongs to the card pile unless granted spirit status",
    (role) => {
      const card = createCardInstance(definitions.get("BSTH01-C01")!, {
        instanceId: "face-down",
        ownerPlayerId: "alice",
        zone: "field",
        zoneRoleName: role,
        faceDown: true,
      });
      const state = createEmptyGameState({ cardInstances: [card] });
      expect(fieldCardDisplayKind(state, card, getDefinition)).toBe("card");
      state.activeContinuousEffects = [
        {
          effectId: "clone",
          sourceInstanceId: "host",
          sourceDefinitionId: "BSTH01-X04",
          actingPlayerId: "alice",
          modifierTag: "act_as_spirit",
          targetInstanceId: card.instanceId,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          metadata: {
            statBlueprint: {
              kind: "static_copy",
              snapshot: {
                cost: 0,
                tribes: [],
                symbolColors: [],
                reductionSymbols: [],
                levelDefs: [],
              },
            },
          },
        },
      ];
      expect(fieldCardDisplayKind(state, card, getDefinition)).toBe("spirit");
    }
  );

  it("all printed magic cards remain visible after entry from any non-field zone", () => {
    const magics = ALL_CARDS.filter((c) => c.printedCategory === "magic");
    expect(magics.length).toBeGreaterThan(100);
    for (const def of magics) {
      for (const zone of [
        "hand",
        "trash",
        "deck",
        "revealed",
        "in_use",
        "field",
      ] as const) {
        const card = createCardInstance(def, {
          instanceId: "magic",
          ownerPlayerId: "alice",
          zone,
        });
        const base = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [card],
        });
        const state = moveCardZone(base, card.instanceId, "field");
        expect(
          fieldCardDisplayKind(state, state.cardInstances[0]!, getDefinition),
          `${def.cardNo} from ${zone}`
        ).toBe("card");
      }
    }
  });

  it("card-state spirits are distinct from summoned spirits, souls, and under-cards", () => {
    const def = definitions.get("BSTH01-C01")!;
    const card = createCardInstance(def, {
      instanceId: "card",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit-card",
    });
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
    });
    expect(fieldCardDisplayKind(state, card, getDefinition)).toBe("card");
    expect(
      fieldCardDisplayKind(
        state,
        { ...card, zoneRoleName: "spirit" },
        getDefinition
      )
    ).toBe("spirit");
    state = {
      ...state,
      players: state.players.map((p) => ({
        ...p,
        soulStateInstanceIds: ["card"],
      })),
    };
    expect(fieldCardDisplayKind(state, card, getDefinition)).toBe("spirit");
    expect(
      fieldCardDisplayKind(
        state,
        { ...card, attachedToInstanceId: "host" },
        getDefinition
      )
    ).toBeNull();
    state = {
      ...state,
      cardInstances: [
        card,
        {
          ...card,
          instanceId: "host",
          underCards: [{ cardInstanceId: "card", role: "advent_source" }],
        },
      ],
    };
    expect(fieldCardDisplayKind(state, card, getDefinition)).toBeNull();
  });
});
