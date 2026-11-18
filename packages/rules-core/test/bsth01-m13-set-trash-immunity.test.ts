/**
 * BSTH01-M13「大妖精」effects[0]:
 * 「セットしている/トラッシュにあるこのカードは、一切の効果を受けない。」
 *
 * - 「一切の効果」= 相手起因だけでなく自分起因のカード効果も含めて gate される
 *   (sourcePlayerScope:"any")。
 * - applicability.zone = ["burst_set","trash"] により、setBurstStates に登録された
 *   バーストセット中とトラッシュ中の双方で defense_immune CE が登録される。
 * - フィールド/手札に移動した後は recompute で CE が除去される (zone 束縛)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getStrongestDefenseLevel,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const M13 = cardNoMap.get("BSTH01-M13")!;

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

describe("BSTH01-M13 大妖精 effects[0] burst_set/trash 完全耐性 (sourcePlayerScope:any)", () => {
  it("effects[0] が sourcePlayerScope:'any' の effect_immunity (stub 解消)", () => {
    const effect = M13.effects!.find(
      (e) =>
        e.timing.kind === "continuous" &&
        Array.isArray(e.applicability?.zone) &&
        (e.applicability!.zone as readonly string[]).includes("burst_set")
    );
    expect(effect).toBeDefined();
    expect((effect as { stub?: string }).stub).toBeUndefined();
    const action = effect!.steps[0]!.action as {
      kind: string;
      sourcePlayerScope?: "opponent" | "self" | "any";
    };
    expect(action.kind).toBe("effect_immunity");
    expect(action.sourcePlayerScope).toBe("any");
  });

  it("バーストセット中 (zone:burst) は defense_immune が登録され、自分・相手双方の効果から守られる", () => {
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(M13, {
          instanceId: "m13-burst",
          ownerPlayerId: "alice",
          zone: "burst",
          cores: 0,
        }),
      ],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "m13-burst" }],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "defense_immune"
    );
    expect(immune).toHaveLength(1);
    expect(immune[0]!.targetInstanceId).toBe("m13-burst");
    expect(getStrongestDefenseLevel(rebuilt, "m13-burst")).toBe("immune");

    const card = rebuilt.cardInstances[0]!;
    // 相手起因の効果から守られる
    expect(isCardImmuneToOpponentEffect(rebuilt, card, "bob")).toBe(true);
    // 自分起因の効果からも守られる (sourcePlayerScope:"any" の効き目)
    expect(isCardImmuneToOpponentEffect(rebuilt, card, "alice")).toBe(true);
  });

  it("トラッシュ滞在中 (zone:trash) も defense_immune が登録され、自分・相手双方の効果から守られる", () => {
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(M13, {
          instanceId: "m13-trash",
          ownerPlayerId: "alice",
          zone: "trash",
          cores: 0,
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
    expect(immune).toHaveLength(1);
    expect(immune[0]!.targetInstanceId).toBe("m13-trash");

    const card = rebuilt.cardInstances[0]!;
    expect(isCardImmuneToOpponentEffect(rebuilt, card, "bob")).toBe(true);
    expect(isCardImmuneToOpponentEffect(rebuilt, card, "alice")).toBe(true);
  });

  it("バーストセット中の CE は、無関係な source の限定再構築前の再計算でも保持する", () => {
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(M13, {
          instanceId: "m13-burst-recompute",
          ownerPlayerId: "alice",
          zone: "burst",
          cores: 0,
        }),
      ],
      setBurstStates: [
        { playerId: "alice", cardInstanceId: "m13-burst-recompute" },
      ],
    };
    const registered = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    expect(getStrongestDefenseLevel(registered, "m13-burst-recompute")).toBe(
      "immune"
    );

    // draw step 等が実行する source 限定リビルダは、先に全 CE を再計算する。
    // M13 自身を再登録対象に含めない経路でも set 中の耐性が失われてはならない。
    const recomputed = recomputeContinuousEffects(registered);
    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "m13-burst-recompute" &&
          ce.modifierTag === "defense_immune"
      )
    ).toHaveLength(1);
    expect(getStrongestDefenseLevel(recomputed, "m13-burst-recompute")).toBe(
      "immune"
    );
  });

  it("手札/フィールドに居る間は defense_immune が登録されない (zone 束縛)", () => {
    for (const zone of ["hand", "field"] as const) {
      const state: GameState = {
        ...makeState(),
        cardInstances: [
          createCardInstance(M13, {
            instanceId: `m13-${zone}`,
            ownerPlayerId: "alice",
            zone,
            cores: 0,
          }),
        ],
      };
      const rebuilt = rebuildContinuousEffectsFromField(
        state,
        getCardDefinitionById
      );
      expect(
        rebuilt.activeContinuousEffects.filter(
          (ce) => ce.modifierTag === "defense_immune"
        )
      ).toHaveLength(0);
      expect(getStrongestDefenseLevel(rebuilt, `m13-${zone}`)).toBe("none");
    }
  });

  it("発動成立後の表向きバーストは、zone:burst のままでも set 中耐性を失う", () => {
    const setState: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(M13, {
          instanceId: "m13-revealed",
          ownerPlayerId: "alice",
          zone: "burst",
          cores: 0,
        }),
      ],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "m13-revealed" }],
    };
    const registered = rebuildContinuousEffectsFromField(
      setState,
      getCardDefinitionById
    );
    expect(getStrongestDefenseLevel(registered, "m13-revealed")).toBe("immune");

    // 発動宣言成立後は setBurstStates から外れ、revealedBurstStates で追跡される。
    // 無関係 source の限定再構築前に走る raw recompute でも CE を残してはならない。
    const revealed: GameState = {
      ...registered,
      setBurstStates: [],
      revealedBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "m13-revealed",
          checkId: "check-1",
        },
      ],
    };
    const rawRecomputed = recomputeContinuousEffects(revealed);
    expect(
      rawRecomputed.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "m13-revealed" &&
          ce.modifierTag === "defense_immune"
      )
    ).toHaveLength(0);

    const recomputed = recomputeAndRebuildContinuousEffects(
      revealed,
      getCardDefinitionById
    );
    const card = recomputed.cardInstances[0]!;
    expect(getStrongestDefenseLevel(recomputed, "m13-revealed")).toBe("none");
    expect(isCardImmuneToOpponentEffect(recomputed, card, "bob")).toBe(false);
    expect(isCardImmuneToOpponentEffect(recomputed, card, "alice")).toBe(false);
  });

  it("バーストセット→フィールド遷移後は recompute で defense_immune が除去される", () => {
    const burstState: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(M13, {
          instanceId: "m13",
          ownerPlayerId: "alice",
          zone: "burst",
          cores: 0,
        }),
      ],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "m13" }],
    };
    const registered = rebuildContinuousEffectsFromField(
      burstState,
      getCardDefinitionById
    );
    expect(getStrongestDefenseLevel(registered, "m13")).toBe("immune");

    const moved: GameState = {
      ...registered,
      cardInstances: registered.cardInstances.map((c) =>
        c.instanceId === "m13" ? { ...c, zone: "field" as const } : c
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
    expect(getStrongestDefenseLevel(recomputed, "m13")).toBe("none");
  });
});
