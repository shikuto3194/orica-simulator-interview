import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveBp,
} from "../src/runtime";
import type { CardDefinition, GameState } from "../src/runtime";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";

describe("BSTH01-X02 霧雨 魔理沙 - ブレイヴ数連動 repeat", () => {
  const marisa = cardNoMap.get("BSTH01-X02")!;
  const brave = ALL_CARDS.find((def) => def.name === "ミニ八卦炉")!;
  const enemyDef = cardNoMap.get("BSDB01-C04")!;

  it("BSTH01-X02 effects[2] は braves_on_source で追加発揮し stub を持たない", () => {
    const attack = marisa.effects![2]!;
    expect(marisa.cardNo).toBe("BSTH01-X02");
    expect(attack.stub).toBeUndefined();
    expect(attack.steps[0]!.action.kind).toBe("bp_modify");
    expect(attack.steps[0]!.repeat).toEqual({
      additional: { source: { kind: "braves_on_source" } },
    });
    expect(attack.steps[0]!.targetSelectionTiming).toBeUndefined();
  });

  it.each([
    { braveCount: 0, applications: 1 },
    { braveCount: 1, applications: 2 },
    { braveCount: 2, applications: 3 },
  ])(
    "実行: 合体ブレイヴ$braveCountつなら、事前に対象を確定し、BP-3000を$applications回発揮する",
    ({ braveCount, applications }) => {
      const targetDef = cardNoMap.get("BSTH02-XX01")!;
      const source = createCardInstance(marisa, {
        instanceId: `marisa-repeat-${braveCount}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 4,
      });
      const attachedBraves = Array.from({ length: braveCount }, (_, index) =>
        createCardInstance(brave, {
          instanceId: `marisa-repeat-brave-${braveCount}-${index}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 0,
          attachedToInstanceId: source.instanceId,
        })
      );
      source.attachedChildrenIds = attachedBraves.map(
        (child) => child.instanceId
      );
      const targets = Array.from({ length: applications }, (_, index) =>
        createCardInstance(targetDef, {
          instanceId: `marisa-repeat-target-${braveCount}-${index}`,
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          // BSTH02-XX01 Lv3 BP30000。各反復を別の対象へ割り当てても、
          // 1回ずつの最終BPを識別できる。
          normalCoreCount: 5,
        })
      );
      const state: GameState = {
        ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
        activePlayerId: ALICE,
        step: "main",
        cardInstances: [source, ...attachedBraves, ...targets],
      };

      const result = executeEffect({
        chainId: "test:bsth01-x02-repeat-activation:110",
        state,
        effect: marisa.effects![2]!,
        sourceInstanceId: source.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        targetInstanceIds: targets.map((target) => target.instanceId),
      });

      expect(
        result.log.filter((line) =>
          line.startsWith("effect:repeat-activation:")
        )
      ).toHaveLength(braveCount);
      expect(result.pendingStepOptionalTargetSelection).toBeNull();
      for (const target of targets) {
        expect(
          result.log.filter((line) =>
            line.startsWith(
              `effect:bp_modify:registered:${target.instanceId}:-3000`
            )
          )
        ).toHaveLength(1);
        const targetAfter = result.cardInstances.find(
          (card) => card.instanceId === target.instanceId
        )!;
        expect(
          getEffectiveBp(result, targetAfter, targetDef, getCardDefinitionById)
        ).toBe(27000);
      }
    }
  );

  it("N=2: 同じBP9000対象を基礎+追加2巡で選び、BP0破壊まで完走する", () => {
    const source = createCardInstance(marisa, {
      instanceId: "marisa-repeat-same-target-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const attachedBraves = [0, 1].map((index) =>
      createCardInstance(brave, {
        instanceId: `marisa-repeat-same-target-brave-${index}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
        attachedToInstanceId: source.instanceId,
      })
    );
    source.attachedChildrenIds = attachedBraves.map(
      (child) => child.instanceId
    );
    // BSTH01-X02 Lv2 は BP9000。効果本文どおり、同じ対象が各巡の候補に
    // 残り続けるため、基礎発揮と追加2回の合計3回を選択できる。
    // 同型の公式Q&Aどおり、各巡は対象を独立に選ぶ一方、BP- と BP0 破壊は
    // 全対象の選択後に同時適用される。
    const target = createCardInstance(marisa, {
      instanceId: "marisa-repeat-same-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const alternative = createCardInstance(cardNoMap.get("BSTH02-XX01")!, {
      instanceId: "marisa-repeat-same-target-alternative",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [source, ...attachedBraves, target, alternative],
    };

    const result = executeEffect({
      chainId: "test:bsth01-x02-repeat-same-target",
      state,
      effect: marisa.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      targetInstanceIds: [
        target.instanceId,
        target.instanceId,
        target.instanceId,
      ],
    });

    expect(
      result.log.filter((line) =>
        line.startsWith(
          `effect:bp_modify:registered:${target.instanceId}:-3000`
        )
      )
    ).toHaveLength(3);
    expect(result.pendingStepOptionalTargetSelection).toBeNull();

    const completed = finalizeEffectResolution({
      state: result,
      beforeState: state,
      chainId: "test:bsth01-x02-repeat-same-target",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
      endLogs: [],
    });
    const targetCompleted = completed.cardInstances.find(
      (card) => card.instanceId === target.instanceId
    )!;
    expect(targetCompleted.zone).toBe("trash");
    expect(targetCompleted.pendingLeaveKind).toBeNull();
    expect(
      completed.pendingLeaveEntities.some(
        (entry) => entry.instanceId === target.instanceId
      )
    ).toBe(false);
  });

  it("後段の BP0 状態破壊は自分側の BP0 スピリットも含める", () => {
    const source = createCardInstance(marisa, {
      instanceId: "marisa-x02-state",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const ownZero = createCardInstance(enemyDef, {
      instanceId: "marisa-own-zero",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(enemyDef, {
      instanceId: "marisa-state-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, ownZero, enemy],
    });
    const result = executeEffect({
      chainId: "test:bsth01-x02-repeat-activation:178",
      state: {
        ...state,
        activeContinuousEffects: [
          ...state.activeContinuousEffects,
          {
            effectId: "ce-own-zero",
            sourceInstanceId: "setup",
            sourceDefinitionId: "setup",
            actingPlayerId: ALICE,
            duration: { scope: "turn" },
            createdAtTurn: state.turnNumber,
            createdAtAttackId: null,
            modifierTag: "bp_modifier",
            modifierAmount: -99999,
            targetInstanceId: ownZero.instanceId,
          },
          {
            effectId: "ce-enemy-zero",
            sourceInstanceId: "setup",
            sourceDefinitionId: "setup",
            actingPlayerId: ALICE,
            duration: { scope: "turn" },
            createdAtTurn: state.turnNumber,
            createdAtAttackId: null,
            modifierTag: "bp_modifier",
            modifierAmount: -99999,
            targetInstanceId: enemy.instanceId,
          },
        ],
      },
      effect: marisa.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      targetInstanceIds: [enemy.instanceId],
    });

    const ownZeroAfter = result.cardInstances.find(
      (card) => card.instanceId === ownZero.instanceId
    )!;
    const enemyAfter = result.cardInstances.find(
      (card) => card.instanceId === enemy.instanceId
    )!;
    expect(
      ownZeroAfter.pendingLeaveKind === "destroy" ||
        ownZeroAfter.zone === "trash"
    ).toBe(true);
    expect(
      enemyAfter.pendingLeaveKind === "destroy" || enemyAfter.zone === "trash"
    ).toBe(true);
  });
});
