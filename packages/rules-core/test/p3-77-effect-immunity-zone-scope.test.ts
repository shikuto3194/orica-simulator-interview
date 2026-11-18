/**
 * P3-77 Phase 1: effect_immunity のゾーン束縛 (節①セット中限定) 回帰テスト。
 *
 * BSTH01-X07「宵闇を司る妖怪 EXルーミア」の節①「セットしているこのカードは
 * 相手の効果を受けず」は、while_set duration で setBurstStates に居る間だけ有効。
 * 発動して field スピリットになった後は耐性を持たない (旧 permanent 実装の修正)。
 *
 * 確定裁定 (2026-06-01): 発動後の通常スピリット状態に節①の耐性は無い。
 * 節② (発動中の card+player 耐性) は別途バーストライフサイクル束縛 (P3-77 Phase 5)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  getStrongestDefenseLevel,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
  useSetBurstAsAction,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const X07 = "BSTH01-X07";

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

describe("P3-77 Phase 1: effect_immunity while_set ゾーン束縛", () => {
  it("X07 の節① effect_immunity は while_set である (永続耐性を持たない)", () => {
    const def = cardNoMap.get(X07)!;
    const continuousEffect = def.effects!.find(
      (e) => e.timing.kind === "continuous"
    )!;
    const action = continuousEffect.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    // 旧 permanent から while_set へ修正済み
    expect((action as { duration: { scope: string } }).duration.scope).toBe(
      "while_set"
    );
    expect(continuousEffect.burstActivationWindowImmunity).toBe(
      "self_and_controller"
    );
  });

  it("セット中 (burst zone) は rebuild で defense_immune が登録され immune になる", () => {
    const def = cardNoMap.get(X07)!;
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "x07-burst",
          ownerPlayerId: "alice",
          zone: "burst",
          cores: 0,
        }),
      ],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "x07-burst" }],
    };

    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );

    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "defense_immune"
    );
    expect(immune).toHaveLength(1);
    expect(immune[0]!.targetInstanceId).toBe("x07-burst");
    expect(getStrongestDefenseLevel(rebuilt, "x07-burst")).toBe("immune");
  });

  it("通常の burst セット直後に節①の CE を登録し、continuous invariant を満たす", () => {
    const def = cardNoMap.get(X07)!;
    const state: GameState = {
      ...makeState(),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(def, {
          instanceId: "x07-hand",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "hand",
          cores: 0,
        }),
      ],
    };

    const afterSet = useSetBurstAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "x07-hand",
      getCardDefinitionById,
    }).state;

    expect(afterSet.setBurstStates).toEqual([
      { playerId: "alice", cardInstanceId: "x07-hand" },
    ]);
    expect(getStrongestDefenseLevel(afterSet, "x07-hand")).toBe("immune");
    expect(
      collectGameStateInvariantIssues(afterSet, {
        getCardDefinitionById,
      }).filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("発動後 (field zone) は rebuild で defense_immune が登録されず not-immune", () => {
    const def = cardNoMap.get(X07)!;
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "x07-field",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );

    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "defense_immune"
    );
    expect(immune).toHaveLength(0);
    expect(getStrongestDefenseLevel(rebuilt, "x07-field")).toBe("none");
  });

  it("セット→フィールド遷移後は recompute で defense_immune が除去される", () => {
    const def = cardNoMap.get(X07)!;
    const setState: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "x07",
          ownerPlayerId: "alice",
          zone: "burst",
          cores: 0,
        }),
      ],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "x07" }],
    };

    // セット中: 登録される
    const registered = rebuildContinuousEffectsFromField(
      setState,
      getCardDefinitionById
    );
    expect(getStrongestDefenseLevel(registered, "x07")).toBe("immune");

    // 発動でカードが field へ移動 → recompute で while_set CE が除去される
    const moved: GameState = {
      ...registered,
      cardInstances: registered.cardInstances.map((c) =>
        c.instanceId === "x07" ? { ...c, zone: "field" as const } : c
      ),
    };
    const recomputed = recomputeAndRebuildContinuousEffects(
      moved,
      getCardDefinitionById
    );

    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "defense_immune"
      )
    ).toHaveLength(0);
    expect(getStrongestDefenseLevel(recomputed, "x07")).toBe("none");
  });

  it("発動宣言後の表向きバーストでは while_set CE を再登録・保持しない", () => {
    const def = cardNoMap.get(X07)!;
    const setState: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "x07-revealed",
          ownerPlayerId: "alice",
          zone: "burst",
          cores: 0,
        }),
      ],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "x07-revealed" }],
    };
    const registered = rebuildContinuousEffectsFromField(
      setState,
      getCardDefinitionById
    );
    expect(getStrongestDefenseLevel(registered, "x07-revealed")).toBe("immune");

    const revealed: GameState = {
      ...registered,
      setBurstStates: [],
      revealedBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "x07-revealed",
          checkId: "check-1",
        },
      ],
    };
    const recomputed = recomputeAndRebuildContinuousEffects(
      revealed,
      getCardDefinitionById
    );
    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "x07-revealed" &&
          ce.duration.scope === "while_set"
      )
    ).toHaveLength(0);
    expect(getStrongestDefenseLevel(recomputed, "x07-revealed")).toBe("none");
  });
});
