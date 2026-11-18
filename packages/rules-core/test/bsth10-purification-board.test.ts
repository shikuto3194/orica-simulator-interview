import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  sanitizeStateForViewer,
  isCardTextCardState,
  expandCardDefinitionsWithBackFaces,
} from "../src";
import {
  getEffectiveCategories,
  getEffectiveCategory,
  isSpirit,
} from "../src/mechanics/act-as-spirit";
import { matchesCardFilter } from "../src/card/card-filter";
import { resolveTurnFaceDown } from "../src/effect/turn-face-down";
import type { CardDefinition, GameState } from "../src";
const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookup = (id: string) => definitions.find((c) => c.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: () => [],
};
const make = (id: string, def: CardDefinition, cores = 1) =>
  createCardInstance(def, {
    instanceId: id,
    ownerPlayerId: "player-2",
    zone: "field",
    normalCoreCount: cores,
  });
function purify(state: GameState, ids: string[]) {
  return executeEffect({
    chainId: "test:bsth10-purification-board:35",
    state,
    sourceInstanceId: "source",
    actingPlayerId: "player-1",
    targetInstanceIds: ids,
    effect: {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "turn_face_down",
            target: {
              kind: "filter",
              player: "opponent",
              filter: {},
              count: "all",
            },
          },
        },
      ],
    },
    ...options,
  });
}
const source = () =>
  createCardInstance(lookup("BSTH10-M01")!, {
    instanceId: "source",
    ownerPlayerId: "player-1",
    zone: "field",
    normalCoreCount: 1,
  });
describe("qa-056 純化の付帯状態", () => {
  it.each([false, true])(
    "アルドノア下カード(faceDown=%s)には分離を提示せず、重なりを解除して裏向きにする",
    (faceDown) => {
      const host = {
        ...make("host", lookup("BSAZ02-C03")!),
        underCards: [
          {
            cardInstanceId: "drive",
            role: "text_role" as const,
            roleTag: "アルドノアドライブ",
          },
        ],
      };
      const drive = {
        ...make("drive", lookup("BSAZ02-C10")!, 0),
        zoneRoleName: "aldnoah-drive",
        attachedToInstanceId: "host",
        faceDown,
      };
      const before = createEmptyGameState({
        cardInstances: [source(), host, drive],
      });
      const after = purify(before, ["host"]);
      expect(after.pendingStepOptionalChoice).toBeNull();
      expect(after.pendingBraveLeaveChoice).toBeNull();
      for (const id of ["host", "drive"]) {
        expect(
          after.cardInstances.find((c) => c.instanceId === id)
        ).toMatchObject({
          zone: "field",
          zoneRoleName: "card",
          faceDown: true,
          faceDownContentsPublic: true,
          attachedToInstanceId: null,
          underCards: [],
          attachedChildrenIds: [],
          normalCoreCount: 0,
        });
      }
      expect(after.pendingLeaveEntities).toHaveLength(0);
    }
  );

  it.each(["BSTH09-TR01(A)", "BSTH09-TR01(B)"])(
    "転醒カード %s も面を切り替えず裏向きになる",
    (cardNo) => {
      const target = {
        ...make("target", lookup(cardNo)!, 2),
        originalDefinitionId: "BSTH09-TR01(A)",
      };
      const state = createEmptyGameState({ cardInstances: [source(), target] });
      const result = purify(state, ["target"]);
      const after = result.cardInstances.find(
        (c) => c.instanceId === "target"
      )!;
      expect(after).toMatchObject({
        definitionId: cardNo,
        originalDefinitionId: target.originalDefinitionId,
        faceDown: true,
        zoneRoleName: "card",
        normalCoreCount: 0,
      });
      expect(
        getEffectiveCategories(result, after, lookup(cardNo)!, lookup)
      ).toEqual([]);
      expect(result.players.map((p) => p.countValue)).toEqual(
        state.players.map((p) => p.countValue)
      );
      expect(result.pendingTriggeredEffects).toEqual(
        state.pendingTriggeredEffects
      );
      expect(result.pendingLeaveEntities).toEqual([]);
    }
  );

  it.each([
    "spirit",
    "ultimate",
    "nexus",
    "brave",
    "magic",
    "quartz",
    "arts",
  ] as const)(
    "%s の実体を失い、種類を指定する対象には含まれないカード状態になる",
    (category) => {
      const def = { ...lookup("BSTH10-C04")!, printedCategory: category };
      const getDef = () => def;
      const before = createEmptyGameState({
        cardInstances: [make("target", def)],
      });
      const state = resolveTurnFaceDown(
        before,
        ["target"],
        "face_down",
        getDef
      );
      const target = state.cardInstances[0]!;
      expect(target).toMatchObject({
        zone: "field",
        zoneRoleName: "card",
        faceDown: true,
      });
      expect(isCardTextCardState(target, state)).toBe(true);
      expect(getEffectiveCategory(state, target, def)).toBeUndefined();
      expect(getEffectiveCategories(state, target, def, getDef)).toEqual([]);
      expect(isSpirit(target, state, getDef)).toBe(false);
      expect(
        matchesCardFilter(
          target,
          def,
          {
            category: [
              "spirit",
              "ultimate",
              "nexus",
              "brave",
              "magic",
              "quartz",
              "arts",
            ],
          },
          { state, fieldCategoryContext: true, getCardDefinitionById: getDef }
        )
      ).toBe(false);
      expect(
        matchesCardFilter(
          target,
          def,
          {},
          { state, getCardDefinitionById: getDef }
        )
      ).toBe(true);
      expect(state.pendingLeaveEntities).toEqual([]);
    }
  );

  it("分身の付与・コア・疲労と持ち主だけの公開範囲は純化しても変わらない", () => {
    const clone = {
      ...make("clone", lookup("BSTH10-C04")!, 2),
      faceDown: true,
      exhaustState: "exhausted" as const,
    };
    const state = createEmptyGameState({ cardInstances: [source(), clone] });
    state.activeContinuousEffects.push({
      effectId: "clone-status",
      sourceInstanceId: "source",
      sourceDefinitionId: "BSTH10-M01",
      actingPlayerId: "player-2",
      modifierTag: "act_as_spirit",
      targetInstanceId: "clone",
      duration: { scope: "permanent" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
      metadata: {
        statBlueprint: {
          kind: "static_copy",
          snapshot: {
            cost: 0,
            tribes: [],
            symbolColors: [],
            reductionSymbols: [],
            levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
          },
        },
      },
    });
    expect(
      matchesCardFilter(
        clone,
        lookup(clone.definitionId)!,
        { category: ["spirit"] },
        { state, fieldCategoryContext: true, getCardDefinitionById: lookup }
      )
    ).toBe(true);
    const result = purify(state, ["clone"]);
    const after = result.cardInstances.find((c) => c.instanceId === "clone")!;
    expect(after).toEqual(clone);
    expect(result.activeContinuousEffects).toEqual(
      state.activeContinuousEffects
    );
    expect(
      getEffectiveCategory(result, after, lookup(after.definitionId)!)
    ).toBe("spirit");
    expect(result.players[1]!.reserveNormalCoreCount).toBe(
      state.players[1]!.reserveNormalCoreCount
    );
    for (const viewer of ["player-1", "player-2"]) {
      const visible = sanitizeStateForViewer(result, viewer).cardInstances.find(
        (c) => c.instanceId === "clone"
      )!;
      expect(visible.definitionId === clone.definitionId).toBe(
        viewer === "player-2"
      );
    }
  });

  it("煌臨元と通常・ソウルコアを解除し、離脱待機を作らない", () => {
    const host = {
      ...make("host", lookup("BSTH10-C04")!, 3),
      soulCoreCount: 1,
      underCards: [{ cardInstanceId: "under", role: "advent_source" as const }],
    };
    const under = {
      ...make("under", lookup("BSTH10-C03")!, 0),
      attachedToInstanceId: "host",
    };
    const state = createEmptyGameState({
      cardInstances: [source(), host, under],
      playerOverrides: [
        {},
        {
          reserveSoulCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "host" },
        },
      ],
    });
    const result = purify(state, ["host"]);
    for (const id of ["host", "under"])
      expect(
        result.cardInstances.find((c) => c.instanceId === id)
      ).toMatchObject({
        zone: "field",
        faceDown: true,
        faceDownContentsPublic: true,
        normalCoreCount: 0,
        soulCoreCount: 0,
        underCards: [],
        attachedToInstanceId: null,
      });
    expect(result.players[1]!.reserveNormalCoreCount).toBe(
      state.players[1]!.reserveNormalCoreCount + 3
    );
    expect(result.players[1]!.reserveSoulCoreCount).toBe(1);
    expect(result.pendingLeaveEntities).toEqual([]);
  });
  it.each(["execute", "decline"] as const)(
    "合体ブレイヴの持ち主による分離選択 %s",
    (choice) => {
      const brave = ALL_CARDS.find(
        (c) =>
          c.printedCategory === "brave" && c.levelDefs[0]?.requiredCores === 1
      )!;
      const host = {
        ...make("host", lookup("BSTH10-C04")!, 3),
        attachedChildrenIds: ["brave"],
      };
      const child = {
        ...make("brave", brave, 1),
        attachedToInstanceId: "host",
      };
      const state = createEmptyGameState({
        cardInstances: [source(), host, child],
      });
      const pending = purify(state, ["host"]);
      expect(pending.pendingStepOptionalChoice?.choosingPlayerId).toBe(
        "player-2"
      );
      const action = getLegalActions({
        state: pending,
        actingPlayerId: "player-2",
        ...options,
      }).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === choice
      )!;
      const result = applyLegalAction({
        state: pending,
        action,
        ...options,
      }).state;
      expect(
        result.cardInstances.find((c) => c.instanceId === "host")
      ).toMatchObject({ faceDown: true, attachedChildrenIds: [] });
      expect(
        result.cardInstances.find((c) => c.instanceId === "brave")
      ).toMatchObject({
        faceDown: choice === "decline",
        attachedToInstanceId: null,
        normalCoreCount: choice === "decline" ? 0 : 1,
      });
    }
  );
  it("既に裏向きのカードを公開せず、トークンをフィールドから戻す", () => {
    const token = ALL_CARDS.find(
      (c) => c.keywordTags.includes("token") && c.printedCategory === "spirit"
    )!;
    const hidden = {
      ...make("hidden", lookup("BSTH10-C04")!, 1),
      faceDown: true,
    };
    const state = createEmptyGameState({
      cardInstances: [source(), hidden, make("token", token)],
    });
    const result = purify(state, ["hidden", "token"]);
    expect(
      result.cardInstances.find((c) => c.instanceId === "hidden")
    ).toMatchObject({ faceDown: true, normalCoreCount: 1 });
    expect(
      sanitizeStateForViewer(result, "player-1").cardInstances.find(
        (c) => c.instanceId === "hidden"
      )?.definitionId
    ).not.toBe(hidden.definitionId);
    expect(
      result.cardInstances.find((c) => c.instanceId === "token")?.zone
    ).toBe("removed_from_game");
  });
});
