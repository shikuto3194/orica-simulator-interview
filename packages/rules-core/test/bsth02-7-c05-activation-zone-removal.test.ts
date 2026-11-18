/**
 * ENGINE-magic-activation-source-zone-condition の着地検証。
 *
 * BSTH02.7-C05「戦符「リトルレギオン」」effects[2] (textLines[0,3,4]):
 * "手元からフラッシュ効果を使用したこのカードは、効果発揮後に除外する。"
 *
 * StepCondition.kind:"activation_zone" が ActiveStack.magicActivationZone →
 * EffectActionContext.activationZone → StepExecutionContext.activationZone と運ばれ、
 * 手元 (set_aside) 発動時のみ trailing remove_from_game(target:self) を実行する。
 * remove_from_game は in_use のこのカードを removed_from_game へ動かし、
 * moveMagicCardToTrash(requireInUse:true) はその後 zone!=="in_use" で no-op になる
 * (bssg01-cards.test.ts の「フラッシュ解決後 cleanup は自身除外を trash で上書きしない」と同型)。
 * 手札発動時は activation_zone 条件が false のため通常通りトラッシュへ移動する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/index";
import { resolveDeferredMagicStack } from "../src/mechanics/magic-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type { ActiveStack, CardDefinition, GameState } from "../src/index";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";

function makeActiveStack(
  magicActivationZone: "hand" | "set_aside" | undefined
): ActiveStack {
  return {
    stackId: "stack:c05-1",
    actionKind: "magic",
    chainId: "chain:c05-1",
    actingPlayerId: ALICE,
    cardInstanceId: "c05-1",
    cardDefinitionId: "BSTH02.7-C05",
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    chosenTiming: "flash",
    magicEffectIndex: 2,
    // このheadless fixtureは宣言時に「回復」枝を選択済みとする。
    magicChoiceIndex: 0,
    ...(magicActivationZone !== undefined ? { magicActivationZone } : {}),
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
}

describe("BSTH02.7-C05 effects[2]: activation_zone trailing remove_from_game", () => {
  const c05 = card("BSTH02.7-C05");

  it("DSL 構造: trailing step が stepCondition:activation_zone(set_aside) + remove_from_game(self)", () => {
    const flashEffect = c05.effects![2]!;
    expect(flashEffect.steps).toHaveLength(2);
    const trailingStep = flashEffect.steps[1]!;
    expect(trailingStep.connector).toBe("after_triggers");
    expect(trailingStep.stepCondition).toEqual({
      kind: "activation_zone",
      zones: ["set_aside"],
    });
    expect(trailingStep.action).toEqual({
      kind: "remove_from_game",
      target: { kind: "self" },
    });
  });

  it("[board] 手元 (set_aside) から発動: 解決後トラッシュではなく除外される", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(c05, {
      instanceId: "c05-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      cardInstances: [self],
    };

    const result = resolveDeferredMagicStack({
      state,
      activeStack: makeActiveStack("set_aside"),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c05]),
      getRegisteredBurstActions: () => undefined,
    });

    expect(
      result.cardInstances.find((c) => c.instanceId === "c05-1")!.zone
    ).toBe("removed_from_game");
    expect(result.log).not.toContain("magic:trash:chain:c05-1:c05-1");
  });

  it("[board] 手札 (hand) から発動: 通常通りトラッシュへ移動する (除外されない)", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(c05, {
      instanceId: "c05-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      cardInstances: [self],
    };

    const result = resolveDeferredMagicStack({
      state,
      activeStack: makeActiveStack("hand"),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c05]),
      getRegisteredBurstActions: () => undefined,
    });

    expect(
      result.cardInstances.find((c) => c.instanceId === "c05-1")!.zone
    ).toBe("trash");
  });

  it("[board] magicActivationZone 未設定 (旧経路/直接テスト呼び出し想定): 除外せずトラッシュへ移動する", () => {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const self = createCardInstance(c05, {
      instanceId: "c05-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      cardInstances: [self],
    };

    const result = resolveDeferredMagicStack({
      state,
      activeStack: makeActiveStack(undefined),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([c05]),
      getRegisteredBurstActions: () => undefined,
    });

    expect(
      result.cardInstances.find((c) => c.instanceId === "c05-1")!.zone
    ).toBe("trash");
  });
});
