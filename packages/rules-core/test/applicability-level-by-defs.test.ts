/**
 * applicability.level の判定が各カード固有の levelDefs.requiredCores
 * ベースで行われることを担保する regression test。
 *
 * 旧実装はコア数のハードコード閾値 (3 で Lv2 / 5 で Lv3) を使っていたため、
 * Lv2: 2 コア / Lv3: 4 コア のような非標準レベル要件のカード
 * (例: BSTH01-C04 ルーミア) で applicability が誤って unmet 判定されていた。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  getEffectiveSymbols,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const ルーミア = cardNoMap.get("BSTH01-C04");

function buildStateWithRumia(
  instanceId: string,
  cores: number,
  step: GameState["step"] = "main"
): GameState {
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step,
    cardInstances: [
      createCardInstance(ルーミア!, {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: cores,
      }),
    ],
  };
}

describe("applicability.level uses card-specific levelDefs.requiredCores", () => {
  it("ルーミア BSTH01-C04 が card-data に存在する", () => {
    expect(ルーミア).toBeDefined();
  });

  it("Lv2 ルーミア (2 コア) で symbol_addition CE が 2 件登録される", () => {
    const state = buildStateWithRumia("rumia-lv2", 2);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const ces = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" &&
        ce.targetInstanceId === "rumia-lv2"
    );
    expect(ces).toHaveLength(2);
  });

  it("Lv2 ルーミア + 自分のメインステップで実効シンボルが赤×3 になる", () => {
    const state = buildStateWithRumia("rumia-lv2-sym", 2);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const symbols = getEffectiveSymbols(
      rebuilt,
      rebuilt.cardInstances[0]!,
      ルーミア!,
      getCardDefinitionById
    );
    expect(symbols).toEqual(["red", "red", "red"]);
  });

  it("Lv3 ルーミア (4 コア) でも symbol_addition CE が 2 件登録される", () => {
    const state = buildStateWithRumia("rumia-lv3", 4);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const ces = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" &&
        ce.targetInstanceId === "rumia-lv3"
    );
    expect(ces).toHaveLength(2);
  });

  it("Lv1 ルーミア (1 コア) では applicability unmet で CE が登録されない", () => {
    const state = buildStateWithRumia("rumia-lv1", 1);
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const ces = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" &&
        ce.targetInstanceId === "rumia-lv1"
    );
    expect(ces).toHaveLength(0);

    const symbols = getEffectiveSymbols(
      rebuilt,
      rebuilt.cardInstances[0]!,
      ルーミア!,
      getCardDefinitionById
    );
    expect(symbols).toEqual(["red"]);
  });

  it("Lv2 ルーミア + 相手ターン (timingScope=self を満たさない) では symbol が赤×1", () => {
    const state: GameState = {
      ...buildStateWithRumia("rumia-opp", 2),
      activePlayerId: "bob",
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const symbols = getEffectiveSymbols(
      rebuilt,
      rebuilt.cardInstances[0]!,
      ルーミア!,
      getCardDefinitionById
    );
    expect(symbols).toEqual(["red"]);
  });

  it("Lv2 ルーミア + 自ターン start ステップ (period=main を満たさない) では symbol が赤×1", () => {
    const state = buildStateWithRumia("rumia-start", 2, "start");
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const symbols = getEffectiveSymbols(
      rebuilt,
      rebuilt.cardInstances[0]!,
      ルーミア!,
      getCardDefinitionById
    );
    expect(symbols).toEqual(["red"]);
  });
});
