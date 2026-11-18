/**
 * P3-145: `{kind:"self"}` / `{kind:"source_card"}` TargetSpec を解決する2実装
 * (target-resolution.ts の resolveTargetSpec と、structured-effect-interpreter.ts の
 * collectTargetCardCandidates 経由の resolveTargetCards) の zone 許容リストが一致することを
 * 盤面テストで確認する。
 *
 * どちらの resolver 経由でも field / in_use / set_aside の自己参照は同じ判定になる必要がある
 * (issues/P3-145_self-target-resolution-zone-ssot-gap.md done-definition)。
 */
import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { resolveTargetSpec } from "../src/effect/target-resolution";
import { resolveTargetCards } from "../src/effect/structured-effect-interpreter";
import { createStepExecutionContext } from "../src/step-execution-context";
import type { CardDefinition, CardInstance, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

const SELF_DEF: CardDefinition = {
  cardNo: "P3-145-SELF",
  name: "P3-145-SELF",
  printedCategory: "magic",
  printedColors: ["red"],
  colors: ["red"],
  cost: 1,
  printedCost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "A",
} as CardDefinition;

const getDef = (id: string): CardDefinition | undefined =>
  id === SELF_DEF.cardNo ? SELF_DEF : undefined;

function stateWithSourceInZone(zone: CardInstance["zone"]): GameState {
  const source = createCardInstance(SELF_DEF, {
    instanceId: "source",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone,
  });
  return {
    ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
    cardInstances: [source],
  };
}

function resolveViaTargetResolution(
  state: GameState,
  kind: "self" | "source_card"
): string[] {
  return resolveTargetSpec({
    state,
    targetSpec: { kind, player: "self" } as never,
    actingPlayerId: ALICE,
    sourceInstanceId: "source",
    getCardDefinitionById: getDef,
    stepContext: createStepExecutionContext(),
  }).map((c) => c.instanceId);
}

function resolveViaStructuredInterpreter(state: GameState): string[] {
  return resolveTargetCards(
    state,
    ALICE,
    { selfCard: true, player: "self", count: 1 },
    getDef,
    "source"
  ).map((c) => c.instanceId);
}

describe("P3-145: self-target zone 解決の二経路一致", () => {
  const zones: CardInstance["zone"][] = ["field", "in_use", "set_aside"];

  for (const zone of zones) {
    it(`ソースが zone:"${zone}" のとき、{kind:"self"} は両経路で同じ結果になる`, () => {
      const state = stateWithSourceInZone(zone);
      const viaTargetResolution = resolveViaTargetResolution(state, "self");
      const viaStructuredInterpreter = resolveViaStructuredInterpreter(state);

      expect(viaTargetResolution).toEqual(["source"]);
      expect(viaStructuredInterpreter).toEqual(["source"]);
      expect(viaTargetResolution).toEqual(viaStructuredInterpreter);
    });

    it(`ソースが zone:"${zone}" のとき、{kind:"source_card"} も同じ結果になる`, () => {
      const state = stateWithSourceInZone(zone);
      const viaTargetResolution = resolveViaTargetResolution(
        state,
        "source_card"
      );
      const viaStructuredInterpreter = resolveViaStructuredInterpreter(state);

      expect(viaTargetResolution).toEqual(["source"]);
      expect(viaStructuredInterpreter).toEqual(["source"]);
      expect(viaTargetResolution).toEqual(viaStructuredInterpreter);
    });
  }

  it('ソースが zone:"trash" (許容外) のとき、両経路とも空になる', () => {
    const state = stateWithSourceInZone("trash");

    expect(resolveViaTargetResolution(state, "self")).toEqual([]);
    expect(resolveViaTargetResolution(state, "source_card")).toEqual([]);
    expect(resolveViaStructuredInterpreter(state)).toEqual([]);
  });

  it("ソースが pendingLeaveKind 設定中のとき、両経路とも既定で空になる (allowPendingLeaveSelfCard 未指定)", () => {
    const source = createCardInstance(SELF_DEF, {
      instanceId: "source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      pendingLeaveKind: "destroy",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [source],
    };

    expect(resolveViaTargetResolution(state, "self")).toEqual([]);
    expect(resolveViaTargetResolution(state, "source_card")).toEqual([]);
    expect(resolveViaStructuredInterpreter(state)).toEqual([]);
  });
});
