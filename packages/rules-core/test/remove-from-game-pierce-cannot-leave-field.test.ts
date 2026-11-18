/**
 * BSLH01-T10 effects[1] 「この効果で離れた対象はフィールドに残せない」=
 *   RemoveFromGameAction.pierceCannotLeaveField による cannot_leave_field 貫通。
 *
 * vanish + suppressDestroyedEffects（Q19 / P3-74）と同機構を remove_from_game に適用する。
 * outcome-specific な cannot_be_removed_from_game は引き続き貫通対象外。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  executeEffectResistance,
  executeRemoveFromGame,
  flushPendingLeaves,
} from "../src";
import type { CardDefinition, CardInstance, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function spiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "幻想",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

const TARGET_DEF = spiritDef("TARGET-1");

function getCardDef(id: string): CardDefinition | undefined {
  if (id === "TARGET-1") return TARGET_DEF;
  return undefined;
}

function makeState(cards: CardInstance[]): GameState {
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: cards,
  };
}

function fieldSpirit(
  instanceId: string,
  controllerPlayerId: string
): CardInstance {
  return createCardInstance(TARGET_DEF, {
    instanceId,
    ownerPlayerId: controllerPlayerId,
    controllerPlayerId,
    zone: "field",
    normalCoreCount: 2,
  });
}

function setupCannotLeaveFieldSpirit(instanceId = "s1"): GameState {
  const target = fieldSpirit(instanceId, ALICE);
  let state = makeState([target]);
  state = executeEffectResistance(
    state,
    ALICE,
    {
      kind: "effect_resistance",
      target: { selfCard: true, count: 1 },
      resistType: "cannot_leave_field",
      source: "opponent_effect",
      duration: { scope: "permanent" },
    },
    instanceId,
    getCardDef
  );
  return state;
}

function setupCannotBeRemovedFromGameSpirit(instanceId = "s2"): GameState {
  const target = fieldSpirit(instanceId, ALICE);
  let state = makeState([target]);
  state = executeEffectResistance(
    state,
    ALICE,
    {
      kind: "effect_resistance",
      target: { selfCard: true, count: 1 },
      resistType: "cannot_be_removed_from_game",
      source: "opponent_effect",
      duration: { scope: "permanent" },
    },
    instanceId,
    getCardDef
  );
  return state;
}

const OPP_TARGET = {
  selfCard: false,
  player: "opponent" as const,
  count: -1,
};

describe("remove_from_game pierceCannotLeaveField (BSLH01-T10)", () => {
  it("pierce 無し: cannot_leave_field で阻止され除外されない", () => {
    const state = setupCannotLeaveFieldSpirit("s1");
    const result = executeRemoveFromGame(
      state,
      BOB,
      { kind: "remove_from_game", target: OPP_TARGET },
      getCardDef,
      "bob-src"
    );
    const after = result.cardInstances.find((c) => c.instanceId === "s1")!;
    expect(after.zone).toBe("field");
  });

  it("pierce 有り: cannot_leave_field を貫通して除外ゾーンへ", () => {
    const state = setupCannotLeaveFieldSpirit("s1");
    const queued = executeRemoveFromGame(
      state,
      BOB,
      {
        kind: "remove_from_game",
        target: OPP_TARGET,
        pierceCannotLeaveField: true,
      },
      getCardDef,
      "bob-src"
    );
    // Step 4 (ENGINE-remove-from-game-attached-brave-orphan): executeRemoveFromGame は
    // queuePendingLeave 経由化されており、実 zone 移動は flushPendingLeaves で行う。
    const pending = queued.pendingLeaveEntities.find(
      (p) => p.instanceId === "s1"
    );
    expect(pending?.preventStayOnField).toBe(true);
    const result = flushPendingLeaves(queued, getCardDef);
    const after = result.cardInstances.find((c) => c.instanceId === "s1")!;
    expect(after.zone).toBe("removed_from_game");
    expect(after.normalCoreCount).toBe(0);
  });

  it("pierce 有りでも cannot_be_removed_from_game は貫通しない", () => {
    const state = setupCannotBeRemovedFromGameSpirit("s2");
    const result = executeRemoveFromGame(
      state,
      BOB,
      {
        kind: "remove_from_game",
        target: OPP_TARGET,
        pierceCannotLeaveField: true,
      },
      getCardDef,
      "bob-src"
    );
    const after = result.cardInstances.find((c) => c.instanceId === "s2")!;
    expect(after.zone).toBe("field");
  });

  it("Q19 貫通ログ: cannot-leave-field-pierced ログが出る", () => {
    const state = setupCannotLeaveFieldSpirit("s1");
    const result = executeRemoveFromGame(
      state,
      BOB,
      {
        kind: "remove_from_game",
        target: OPP_TARGET,
        pierceCannotLeaveField: true,
      },
      getCardDef,
      "bob-src"
    );
    expect(
      result.log.some((l) =>
        l.startsWith(
          "effect:remove_from_game:cannot-leave-field-pierced:bob:s1"
        )
      )
    ).toBe(true);
  });

  it("耐性無しカードでは pierced ログが出ない（pierce フラグは立つが実貫通無し）", () => {
    const target = fieldSpirit("s3", ALICE);
    const state = makeState([target]);
    const queued = executeRemoveFromGame(
      state,
      BOB,
      {
        kind: "remove_from_game",
        target: OPP_TARGET,
        pierceCannotLeaveField: true,
      },
      getCardDef,
      "bob-src"
    );
    const result = flushPendingLeaves(queued, getCardDef);
    const after = result.cardInstances.find((c) => c.instanceId === "s3")!;
    expect(after.zone).toBe("removed_from_game");
    expect(
      result.log.some((l) =>
        l.startsWith("effect:remove_from_game:cannot-leave-field-pierced:")
      )
    ).toBe(false);
  });

  it("BSLH01-T10 effects[1] が pierceCannotLeaveField:true を持つ", async () => {
    const { ALL_CARDS } = await import("../../card-data/src/generated-index");
    const t10 = ALL_CARDS.find((c) => c.cardNo === "BSLH01-T10");
    expect(t10).toBeDefined();
    // 【アーツ】配置ゲートは CardDefinition.summonCondition へ移動したため
    // effects[0]=系統免疫、effects[1]=フラッシュ payload (旧 effects[2] から繰り上がり)。
    const flash = t10!.effects?.[1];
    expect(flash?.stub).toBeUndefined();
    const action = flash?.steps[0]?.action;
    expect(action?.kind).toBe("remove_from_game");
    if (action?.kind === "remove_from_game") {
      expect(action.pierceCannotLeaveField).toBe(true);
    }
  });
});
