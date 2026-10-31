/**
 * 消滅 (vanish) 版 suppressDestroyedEffects（「その効果を発揮させない」）。
 * destroy と同じ Q19 裁定 (P3-74) の機構を消滅に適用する:
 *  - 消滅した対象の離脱誘発効果を抑止する (suppressDestroyedEffects)。
 *  - 指定時は cannot_leave_field 常時効果を貫通する (cannot_be_vanished は貫通しない)。
 *
 * 解消カード: BSTH04-R02（バースト消滅）、BSTS01-R03（フラッシュ消滅）。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  executeVanish,
  executeEffectResistance,
} from "../src";
import type { CardDefinition, CardInstance, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

function spiritDef(cardNo: string, tribes: string[]): CardDefinition {
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
    tribe: tribes.join("・"),
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

const 紅魔スピリット = spiritDef("KMS-1", ["幻想", "紅魔"]);

function getCardDef(id: string): CardDefinition | undefined {
  if (id === "KMS-1") return 紅魔スピリット;
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
  defId: string,
  controllerPlayerId: string
): CardInstance {
  return createCardInstance(getCardDef(defId)!, {
    instanceId,
    ownerPlayerId: controllerPlayerId,
    controllerPlayerId,
    zone: "field",
    normalCoreCount: 2,
  });
}

/** 美鈴型: cannot_leave_field 常時効果を持つスピリット */
function setupCannotLeaveFieldSpirit(instanceId = "s1"): GameState {
  const target = fieldSpirit(instanceId, "KMS-1", ALICE);
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

/** cannot_be_vanished (outcome-specific) を持つスピリット */
function setupCannotBeVanishedSpirit(instanceId = "s2"): GameState {
  const target = fieldSpirit(instanceId, "KMS-1", ALICE);
  let state = makeState([target]);
  state = executeEffectResistance(
    state,
    ALICE,
    {
      kind: "effect_resistance",
      target: { selfCard: true, count: 1 },
      resistType: "cannot_be_vanished",
      source: "opponent_effect",
      duration: { scope: "permanent" },
    },
    instanceId,
    getCardDef
  );
  return state;
}

const OPP_TARGET = { selfCard: false, player: "opponent" as const, count: -1 };

describe("vanish suppressDestroyedEffects pierces cannot_leave_field (Q19)", () => {
  it("『発揮させない』無し: cannot_leave_field で阻止され消滅待機に入らない", () => {
    const state = setupCannotLeaveFieldSpirit();
    const blocked = executeVanish(
      state,
      BOB,
      OPP_TARGET,
      getCardDef,
      "bob-src",
      undefined,
      undefined,
      "none"
    );
    expect(
      blocked.cardInstances.find((c) => c.instanceId === "s1")?.pendingLeaveKind
    ).toBeNull();
  });

  it("『発揮させない』付き: cannot_leave_field を貫通して消滅待機に入る", () => {
    const state = setupCannotLeaveFieldSpirit();
    const pierced = executeVanish(
      state,
      BOB,
      OPP_TARGET,
      getCardDef,
      "bob-src",
      undefined,
      "destroyed_only",
      "none"
    );
    const after = pierced.cardInstances.find((c) => c.instanceId === "s1")!;
    expect(after.pendingLeaveKind).toBe("vanish");
    // 消滅: コアはリザーブへ（既定挙動）。盤上のコアは 0 に。
    expect(after.normalCoreCount).toBe(0);
    expect(
      pierced.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBeGreaterThanOrEqual(2);
  });

  it("cannot_be_vanished (outcome-specific) は貫通しない", () => {
    const state = setupCannotBeVanishedSpirit();
    const result = executeVanish(
      state,
      BOB,
      OPP_TARGET,
      getCardDef,
      "bob-src",
      undefined,
      "destroyed_only",
      "none"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "s2")?.pendingLeaveKind
    ).toBeNull();
  });

  it("Q19 貫通ログ: cannot-leave-field-pierced ログが出る", () => {
    const state = setupCannotLeaveFieldSpirit();
    const pierced = executeVanish(
      state,
      BOB,
      OPP_TARGET,
      getCardDef,
      "bob-src",
      undefined,
      "destroyed_only",
      "none"
    );
    expect(
      pierced.log.some((l) =>
        l.startsWith("effect:vanish:cannot-leave-field-pierced:bob:s1")
      )
    ).toBe(true);
  });

  it("耐性無しカードでは pierced ログが出ない（pierce フラグは立つが実貫通無し）", () => {
    const target = fieldSpirit("s3", "KMS-1", ALICE);
    const state = makeState([target]);
    const result = executeVanish(
      state,
      BOB,
      OPP_TARGET,
      getCardDef,
      "bob-src",
      undefined,
      "destroyed_only",
      "none"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "s3")?.pendingLeaveKind
    ).toBe("vanish");
    expect(
      result.log.some((l) =>
        l.startsWith("effect:vanish:cannot-leave-field-pierced:")
      )
    ).toBe(false);
  });

  it("pendingLeaveEntity に suppressDestroyedEffects が伝搬する", () => {
    const target = fieldSpirit("s4", "KMS-1", ALICE);
    const state = makeState([target]);
    const result = executeVanish(
      state,
      BOB,
      OPP_TARGET,
      getCardDef,
      "bob-src",
      undefined,
      "destroyed_only",
      "none"
    );
    const entity = result.pendingLeaveEntities.find(
      (e) => e.instanceId === "s4"
    );
    expect(entity?.suppressDestroyedEffects).toBe("destroyed_only");
  });
});
