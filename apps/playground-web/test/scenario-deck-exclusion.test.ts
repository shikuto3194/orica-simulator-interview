import { describe, expect, it } from "vitest";
import {
  executeEffect,
  recomputeAndRebuildContinuousEffects,
  type GameState,
} from "@orica/rules-core";
import { ALL_CARDS } from "@orica/card-data";
import { buildDeckExclusionScenario } from "../src/scenario-deck-exclusion";

const getDefinition = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id);
const redirects = (state: GameState) =>
  state.activeContinuousEffects.filter(
    (effect) => effect.modifierTag === "redirect_deck_discard_to_exclude"
  );

describe.each(["alice", "bob"])("除外シナリオ %s", (owner) => {
  const opponent = owner === "alice" ? "bob" : "alice";
  const build = (mode: "redirect" | "direct") =>
    buildDeckExclusionScenario(ALL_CARDS, new URLSearchParams({ owner, mode }));

  it("REST初期盤面はGUI共通再構築と同じLv2継続効果を持ち再構築で重複しない", () => {
    const initial = build("redirect");
    const rebuilt = recomputeAndRebuildContinuousEffects(
      initial,
      getDefinition
    );
    expect(redirects(rebuilt)).toHaveLength(1);
    expect(redirects(rebuilt)[0]).toMatchObject({
      sourceInstanceId: "iku",
      sourceDefinitionId: "BSTH05.5-X02",
      actingPlayerId: owner,
      targetInstanceId: opponent,
      timingScope: { player: "self", period: "attack" },
      provenance: { effectIndex: 1, stepIndex: 0 },
    });
    expect(redirects(initial)).toEqual(redirects(rebuilt));
  });

  it("継続効果を手動登録せず実M02のアタック時破棄7枚を相手の除外へ移す", () => {
    const initial = build("redirect");
    const definition = getDefinition("BSTH05.5-M02")!;
    const effect = definition.effects!.find((entry) =>
      entry.steps.some(
        (step) =>
          step.action.kind === "move_card" &&
          step.action.deckDiscard === true &&
          step.action.count === 7
      )
    )!;
    expect(effect).toBeDefined();
    const result = executeEffect({
      state: initial,
      effect,
      chainId: "scenario-deck-exclusion-regression",
      sourceInstanceId: "attacker",
      actingPlayerId: owner,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      result.cardInstances
        .filter((card) => card.zone === "removed_from_game")
        .map((card) => [card.instanceId, card.ownerPlayerId])
    ).toEqual(
      Array.from({ length: 7 }, (_, index) => [`deck-${index + 1}`, opponent])
    );
    expect(
      result.players.find((player) => player.id === opponent)!.deckCount
    ).toBe(1);
    expect(
      result.cardInstances.filter(
        (card) => card.zone === "trash" || card.zone === "void"
      )
    ).toEqual([]);
  });

  it("Lv1の直接除外盤面は破棄書換えを登録しない", () => {
    const initial = build("direct");
    expect(redirects(initial)).toEqual([]);
    expect(
      redirects(recomputeAndRebuildContinuousEffects(initial, getDefinition))
    ).toEqual([]);
  });

  it("C03の実本文から両M11を保持した置換待ちを作り、GUI再構築でも保持する", () => {
    const initial = buildDeckExclusionScenario(
      ALL_CARDS,
      new URLSearchParams({ owner, mode: "replacement" })
    );
    const rebuilt = recomputeAndRebuildContinuousEffects(
      initial,
      getDefinition
    );
    expect(rebuilt.pendingSetAsideExitReplacementChoice).toEqual(
      initial.pendingSetAsideExitReplacementChoice
    );
    expect(rebuilt.pendingSetAsideExitReplacementChoice).toMatchObject({
      choosingPlayerId: owner,
      cardInstanceId: "mask-1",
      remainingCardInstanceIds: ["mask-2"],
    });
    expect(
      rebuilt.cardInstances
        .filter((c) => c.instanceId.startsWith("mask-"))
        .map((c) => c.zone)
    ).toEqual(["set_aside", "set_aside"]);
    expect(rebuilt.pendingBattleEndDeferrals).toHaveLength(0);
  });

  it("X04支払い盤面はリザーブ0と通常の場コアを持ちC03の継続を保持する", () => {
    const initial = buildDeckExclusionScenario(
      ALL_CARDS,
      new URLSearchParams({ owner, mode: "replacement-payment" })
    );
    const rebuilt = recomputeAndRebuildContinuousEffects(
      initial,
      getDefinition
    );
    expect(rebuilt.pendingSetAsideExitReplacementChoice).toEqual(
      initial.pendingSetAsideExitReplacementChoice
    );
    expect(rebuilt.pendingSetAsideExitReplacementChoice).toMatchObject({
      cardInstanceId: "mask-1",
      replacement: { kind: "pay_cost", amount: 1 },
    });
    expect(
      rebuilt.players.find((p) => p.id === owner)!.reserveNormalCoreCount
    ).toBe(0);
    expect(
      rebuilt.players.find((p) => p.id === owner)!.reserveSoulCoreCount
    ).toBe(0);
    expect(
      rebuilt.cardInstances.find((c) => c.instanceId === "attacker")!
        .normalCoreCount
    ).toBe(3);
    expect(rebuilt.pendingBattleEndDeferrals).toHaveLength(0);
  });
});
