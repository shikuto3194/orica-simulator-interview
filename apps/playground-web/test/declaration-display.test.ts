import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  createCardInstance,
  createEmptyGameState,
  type GameState,
  type PreDeclarationStackWindow,
} from "@orica/rules-core";
import { getDeclaringCardIds } from "../src/utils/declaration-display";

const declaration: PreDeclarationStackWindow = {
  kind: "attack",
  actingPlayerId: "alice",
  sourceInstanceId: "first",
  additionalSourceInstanceIds: ["second", "third"],
  previousWindow: "none",
  priorityPlayerId: "bob",
  consecutivePassCount: 0,
  stackResponseSourcePlayerId: "alice",
  pendingStackAction: null,
};
function state(): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: ["first", "second", "third", "other"].map((id) =>
      createCardInstance(ALL_CARDS.find((c) => c.cardNo === "BSTH07.8-C01")!, {
        instanceId: id,
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    ),
  });
}
describe("宣言中の盤面表示", () => {
  it.each(["attack", "block", "forced_block", "join_active_attack"] as const)(
    "%s: 全参加体を窓名に依存せず表示する",
    (kind) => {
      const current = {
        ...state(),
        window: "stack" as const,
        preDeclarationStackWindow: { ...declaration, kind },
      };
      expect([...getDeclaringCardIds(current)]).toEqual([
        "first",
        "second",
        "third",
      ]);
    }
  );
  it("窓が閉じても対象選択・派生効果が残る間は維持し、確定・取消後は消す", () => {
    const current = {
      ...state(),
      pendingPreDeclarationConfirmation: declaration,
    };
    expect([...getDeclaringCardIds(current)]).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(
      getDeclaringCardIds({
        ...current,
        pendingPreDeclarationConfirmation: null,
      }).size
    ).toBe(0);
  });
  it("疲労・重疲労を優先し、場を離れた参加体は除外する", () => {
    const current = {
      ...state(),
      pendingPreDeclarationConfirmation: declaration,
    };
    current.cardInstances[0]!.exhaustState = "exhausted";
    current.cardInstances[1]!.exhaustState = "heavily_exhausted";
    current.cardInstances[2]!.zone = "trash";
    expect(getDeclaringCardIds(current).size).toBe(0);
  });
  it("成立後に回復しても宣言中へ戻さない", () => {
    const current = { ...state(), window: "declare_attack" as const };
    expect(getDeclaringCardIds(current).size).toBe(0);
  });
});
