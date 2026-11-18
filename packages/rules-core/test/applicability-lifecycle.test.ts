import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "../src";
import type {
  Applicability,
  ApplicabilityZone,
  Effect,
} from "../src/dsl-types";
import { evaluateApplicability } from "../src/effect/effect-applicability";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";

const base = ALL_CARDS.find((c) => c.cardNo === "BSRK01-CX01")!;
function fixture(
  applicability: Applicability,
  zone: "field" | "hand" | "trash" | "set_aside" | "revealed" = "field"
) {
  const effect: Effect = {
    timing: { kind: "continuous" },
    applicability,
    steps: [
      {
        action: {
          kind: "draw_modify",
          amount: 1,
          duration: { scope: "while_on_field" },
        },
      },
    ],
  };
  const def: CardDefinition = { ...base, effects: [effect] };
  const lookup = (id: string) =>
    id === def.cardNo ? def : ALL_CARDS.find((c) => c.cardNo === id);
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone,
        normalCoreCount: 2,
      }),
    ],
  });
  return { state, lookup, def, effect };
}

describe("applicability の登録・保持・失効を共通評価する", () => {
  it.each(["field", "hand", "trash", "set_aside", "revealed"] as const)(
    "%s のdraw_modify は効果名の例外を要さない",
    (zone) => {
      const f = fixture({ zone }, zone);
      const registered = rebuildContinuousEffectsFromField(f.state, f.lookup);
      expect(registered.activeContinuousEffects).toHaveLength(1);
      const original = registered.activeContinuousEffects[0];
      let current = registered;
      for (let i = 0; i < 3; i++)
        current = recomputeContinuousEffects(current, f.lookup);
      expect(current.activeContinuousEffects).toEqual([original]);
      const moved = {
        ...current,
        cardInstances: current.cardInstances.map((c) => ({
          ...c,
          zone: "deck" as const,
        })),
      };
      expect(
        recomputeContinuousEffects(moved, f.lookup).activeContinuousEffects
      ).toEqual([]);
    }
  );

  it.each([
    {
      name: "Lv",
      applicability: { level: { min: 2 } },
      change: (s: GameState) => ({
        ...s,
        cardInstances: s.cardInstances.map((c) => ({
          ...c,
          normalCoreCount: 1,
        })),
      }),
    },
    {
      name: "形態",
      applicability: { form: "spirit" },
      change: (s: GameState) => ({
        ...s,
        cardInstances: s.cardInstances.map((c) => ({
          ...c,
          definitionId: "BSRK01-C02",
        })),
      }),
    },
    {
      name: "未合体",
      applicability: { combined: false },
      change: (s: GameState) => ({
        ...s,
        cardInstances: s.cardInstances.map((c) => ({
          ...c,
          attachedChildrenIds: ["brave"],
        })),
      }),
    },
    {
      name: "魂状態",
      applicability: { soulState: false },
      change: (s: GameState) => ({
        ...s,
        players: s.players.map((p) =>
          p.id === "alice" ? { ...p, soulStateInstanceIds: ["source"] } : p
        ),
      }),
    },
  ] satisfies {
    name: string;
    applicability: Applicability;
    change: (s: GameState) => GameState;
  }[])(
    "$name の資格喪失で軽量再計算も解除する",
    ({ applicability, change }) => {
      const f = fixture(applicability);
      const registered = rebuildContinuousEffectsFromField(f.state, f.lookup);
      expect(registered.activeContinuousEffects).toHaveLength(1);
      expect(
        recomputeContinuousEffects(registered, f.lookup).activeContinuousEffects
      ).toEqual(registered.activeContinuousEffects);
      expect(
        recomputeContinuousEffects(change(registered), f.lookup)
          .activeContinuousEffects
      ).toEqual([]);
    }
  );

  it("form は実効カテゴリを評価し、無視しない", () => {
    const f = fixture({ form: "nexus" });
    expect(
      evaluateApplicability(
        f.state,
        f.effect.applicability!,
        "source",
        f.lookup
      )
    ).toBe(false);
    expect(
      rebuildContinuousEffectsFromField(f.state, f.lookup)
        .activeContinuousEffects
    ).toEqual([]);
  });

  it("左右合体の片側が外れると常時効果も失効する", () => {
    const f = fixture({ imaginDualCombined: true });
    f.state.cardInstances[0] = {
      ...f.state.cardInstances[0]!,
      attachedToInstanceId: "left",
      imaginRightCombinedWith: "right",
    };
    const registered = rebuildContinuousEffectsFromField(f.state, f.lookup);
    expect(registered.activeContinuousEffects).toHaveLength(1);
    const separated = {
      ...registered,
      cardInstances: registered.cardInstances.map((card) => ({
        ...card,
        imaginRightCombinedWith: null,
      })),
    };
    expect(
      recomputeContinuousEffects(separated, f.lookup).activeContinuousEffects
    ).toEqual([]);
  });

  it("煌臨元の汎用常時効果は契約煌臨の資格を失ったときに解除する", () => {
    const f = fixture({
      zone: "advent_source",
      adventSourceHostVariants: ["contract", "f_contract"],
    });
    const hostDef = ALL_CARDS.find((card) => card.cardNo === "BSRK01-C04")!;
    const host = createCardInstance(hostDef, {
      instanceId: "host",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    f.state.cardInstances.push({
      ...host,
      underCards: [{ role: "advent_source", cardInstanceId: "source" }],
    });
    const registered = rebuildContinuousEffectsFromField(f.state, f.lookup);
    const sourceEffects = (state: GameState) =>
      state.activeContinuousEffects.filter(
        (ce) => ce.sourceInstanceId === "source"
      );
    expect(sourceEffects(registered)).toHaveLength(1);
    expect(
      sourceEffects(recomputeContinuousEffects(registered, f.lookup))
    ).toEqual(sourceEffects(registered));
    const noContract = (id: string) =>
      id === hostDef.cardNo
        ? {
            ...hostDef,
            adventData: {
              ...hostDef.adventData!,
              adventVariant: "normal" as const,
            },
          }
        : f.lookup(id);
    expect(
      sourceEffects(recomputeContinuousEffects(registered, noContract))
    ).toEqual([]);
  });

  it("手札の自己扱い変更は追加メタデータなしで保持し、デッキへの移動で解除する", () => {
    const f = fixture({ zone: "hand" }, "hand");
    f.effect.steps = [
      {
        action: {
          kind: "treat_as",
          aspects: ["symbol"],
          asColor: "white",
          appliesToCard: true,
        },
      },
    ];
    const registered = rebuildContinuousEffectsFromField(f.state, f.lookup);
    expect(registered.activeContinuousEffects).toHaveLength(1);
    expect(
      registered.activeContinuousEffects[0]?.metadata?.sourceApplicabilityZone
    ).toBeUndefined();
    expect(
      recomputeContinuousEffects(registered, f.lookup).activeContinuousEffects
    ).toEqual(registered.activeContinuousEffects);
    const moved = {
      ...registered,
      cardInstances: registered.cardInstances.map((card) => ({
        ...card,
        zone: "deck" as const,
      })),
    };
    expect(
      recomputeContinuousEffects(moved, f.lookup).activeContinuousEffects
    ).toEqual([]);
  });

  it("解決済みの起動効果のLv資格はターン効果の維持条件にしない", () => {
    const f = fixture({ level: { min: 2 } });
    f.effect.timing = { kind: "activated", mode: "main" };
    f.effect.steps[0]!.action = {
      kind: "symbol_add",
      target: { kind: "self" },
      symbol: "white",
      count: 1,
      duration: { scope: "turn" },
    };
    const registered = executeEffect({
      chainId: "test:applicability",
      state: f.state,
      effect: f.effect,
      effectIndex: 0,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: f.lookup,
    });
    expect(registered.activeContinuousEffects).toHaveLength(1);
    const lowered = {
      ...registered,
      cardInstances: registered.cardInstances.map((c) => ({
        ...c,
        normalCoreCount: 1,
      })),
    };
    expect(
      recomputeContinuousEffects(lowered, f.lookup).activeContinuousEffects
    ).toEqual(registered.activeContinuousEffects);
  });

  it("チェンジの期間効果は通常effectsの同じindexと混同せず、保存復元後も保持する", () => {
    const f = fixture({ zone: "field", level: { min: 2 } });
    const changeEffect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "draw_modify",
            amount: 2,
            duration: { scope: "turn" },
          },
        },
      ],
    };
    const template = ALL_CARDS.find((card) => card.changeData)!;
    f.def.changeData = { ...template.changeData!, effects: [changeEffect] };
    const withChange = executeEffect({
      chainId: "test:change-provenance",
      state: f.state,
      effect: changeEffect,
      effectIndex: 0,
      isChangeData: true,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: f.lookup,
    });
    expect(withChange.activeContinuousEffects).toHaveLength(1);
    expect(
      withChange.activeContinuousEffects[0]?.provenance?.definitionPath
    ).toEqual(["changeData", "effects"]);
    const restored: GameState = JSON.parse(JSON.stringify(withChange));
    const rebuilt = rebuildContinuousEffectsFromField(restored, f.lookup);
    expect(rebuilt.activeContinuousEffects).toHaveLength(2);
    const lowered = {
      ...rebuilt,
      cardInstances: rebuilt.cardInstances.map((card) => ({
        ...card,
        normalCoreCount: 1,
      })),
    };
    expect(
      recomputeContinuousEffects(lowered, f.lookup).activeContinuousEffects
    ).toEqual(withChange.activeContinuousEffects);
  });

  it("すべての公開 applicability zone を共通評価器が受け持つ", () => {
    const expected: Record<ApplicabilityZone, boolean> = {
      field: true,
      hand: false,
      set_aside: false,
      burst_set: false,
      mirage_set: false,
      trash: false,
      deck: false,
      in_use: false,
      revealed: false,
      anywhere: true,
      soul_state: false,
      advent_source: false,
    };
    const f = fixture({});
    for (const [zone, match] of Object.entries(expected))
      expect(
        evaluateApplicability(
          f.state,
          { zone: zone as ApplicabilityZone },
          "source",
          f.lookup
        ),
        zone
      ).toBe(match);
  });
});
