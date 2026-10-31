import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  refreshExhaustStates,
  runReevaluationAtTiming,
  type GameState,
  type Zone,
} from "../src";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { countEffectiveUnderCardRole } from "../src/mechanics/under-card-role";
import { executeEndAttackStep } from "../src/effect/structured-state-grants";

const getDef = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const inst = (
  no: string,
  id: string,
  cores = 1,
  owner = "alice",
  zone: Zone = "field"
) =>
  createCardInstance(getDef(no)!, {
    instanceId: id,
    ownerPlayerId: owner,
    zone,
    normalCoreCount: cores,
  });
const board = (cards: GameState["cardInstances"]): GameState => ({
  ...createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
  }),
  activePlayerId: "alice",
  step: "attack",
  turnNumber: 3,
});
const rebuild = (s: GameState) =>
  recomputeAndRebuildContinuousEffects(s, getDef);
const find = (s: GameState, id: string) =>
  s.cardInstances.find((c) => c.instanceId === id)!;
const change = (
  s: GameState,
  id: string,
  patch: Partial<GameState["cardInstances"][number]>
) =>
  rebuild({
    ...s,
    cardInstances: s.cardInstances.map((c) =>
      c.instanceId === id ? { ...c, ...patch } : c
    ),
  });
const suppressionPasses = (
  state: GameState,
  id: string,
  eventAction: "summon" | "attack" = "summon"
) =>
  runReevaluationAtTiming({
    state,
    registration: {
      reevaluationPoints: [
        {
          timing: "before_each_step",
          checks: ["effect_suppression"],
          failurePolicy: "abort_remaining",
        },
      ],
    },
    timing: "before_each_step",
    sourceInstanceId: id,
    targetInstanceIds: [],
    suppressionEffectDescriptor: {
      sourceKind: "spirit",
      timingKind: "card_event",
      eventAction,
    },
    getCardDefinitionById: getDef,
  }).passed;

describe("領域の動的条件を消費側で確認", () => {
  it.each(["BSAZ02-X04", "BSAZ02-X05"])(
    "%s は後入りの裏向き下カードにも役割を適用し、表向き/相手/発揮元離脱を区別する",
    (no) => {
      const base = rebuild(board([inst(no, "source", 0)]));
      const host = (id: string, owner = "alice") => ({
        ...inst("BSAZ02-C03", id, 1, owner),
        underCards: [
          { cardInstanceId: `${id}-under`, role: "advent_source" as const },
        ],
      });
      const entered = rebuild({
        ...base,
        cardInstances: [
          ...base.cardInstances,
          host("first"),
          host("second"),
          host("enemy", "bob"),
          ...["first", "second", "enemy"].map((id) => ({
            ...inst(
              "BSAZ02-C01",
              `${id}-under`,
              0,
              id === "enemy" ? "bob" : "alice"
            ),
            faceDown: true,
          })),
        ],
      });
      const count = (s: GameState, id: string) =>
        countEffectiveUnderCardRole(
          s,
          find(s, id),
          "アルドノアドライブ",
          getDef
        );
      expect(count(entered, "first")).toBe(1);
      expect(count(entered, "second")).toBe(1);
      expect(count(entered, "enemy")).toBe(0);
      expect(
        count(change(entered, "second-under", { faceDown: false }), "second")
      ).toBe(0);
      expect(count(change(entered, "source", { zone: "trash" }), "first")).toBe(
        0
      );
    }
  );

  it("隠岐奈(BSTH08.5)は後入りの自分手元の面霊ブレイヴを守り、Lv低下/ゾーン移動/発揮元離脱で解除する", () => {
    const base = rebuild(
      board([
        inst("BSTH08.5-X03", "source", 1),
        inst("BSTH08.5-X04", "first", 0, "alice", "set_aside"),
      ])
    );
    const entered = rebuild({
      ...base,
      cardInstances: [
        ...base.cardInstances,
        inst("BSTH08.5-X04", "late", 0, "alice", "set_aside"),
        inst("BSTH08.5-X04", "enemy", 0, "bob", "set_aside"),
        inst("BSTH05-M11", "wrong", 0, "alice", "set_aside"),
      ],
    });
    const immune = (s: GameState, id: string, actor = "bob") =>
      isCardImmuneToOpponentEffect(
        s,
        find(s, id),
        actor,
        "none",
        undefined,
        getDef
      );
    for (const id of ["first", "late"]) expect(immune(entered, id)).toBe(true);
    for (const id of ["enemy", "wrong"])
      expect(immune(entered, id, "alice")).toBe(false);
    expect(immune(entered, "late", "alice")).toBe(false);
    expect(immune(change(entered, "late", { zone: "hand" }), "late")).toBe(
      false
    );
    expect(
      immune(change(entered, "source", { normalCoreCount: 0 }), "late")
    ).toBe(false);
    expect(immune(change(entered, "source", { zone: "trash" }), "late")).toBe(
      false
    );
  });

  it("青娥は自分のトラッシュ3枚条件を追従し、両者の後入り召喚時だけを抑止する", () => {
    const base = rebuild(
      board([
        inst("BSTH08-X01", "source", 0),
        ...[0, 1, 2].map((i) =>
          inst("BSTH08-C01", `trash-${i}`, 0, "alice", "trash")
        ),
      ])
    );
    const entered = rebuild({
      ...base,
      cardInstances: [
        ...base.cardInstances,
        inst("BSTH01-C01", "self"),
        inst("BSTH01-C01", "enemy", 1, "bob"),
      ],
    });
    for (const id of ["self", "enemy"]) {
      expect(suppressionPasses(entered, id)).toBe(false);
      expect(suppressionPasses(entered, id, "attack")).toBe(true);
      expect(
        suppressionPasses(change(entered, "trash-2", { zone: "hand" }), id)
      ).toBe(true);
      expect(
        suppressionPasses(change(entered, "source", { zone: "trash" }), id)
      ).toBe(true);
    }
  });

  it("隠岐奈(BSTH11)は後入りの相手の重疲労を回復/発揮不可にし、自分場の系統条件の変化を追従する", () => {
    const base = rebuild(board([inst("BSTH11-X01", "source", 0)]));
    const entered = rebuild({
      ...base,
      cardInstances: [
        ...base.cardInstances,
        {
          ...inst("BSTH01-C01", "late", 1, "bob"),
          exhaustState: "heavily_exhausted",
        },
      ],
    });
    expect(
      find(refreshExhaustStates(entered, "bob", getDef), "late").exhaustState
    ).toBe("heavily_exhausted");
    expect(suppressionPasses(entered, "late")).toBe(false);
    const violated = rebuild({
      ...entered,
      cardInstances: [
        ...entered.cardInstances,
        inst("BSKB01-C01", "wrong-tribe"),
      ],
    });
    expect(
      find(refreshExhaustStates(violated, "bob", getDef), "late").exhaustState
    ).toBe("exhausted");
    expect(suppressionPasses(violated, "late")).toBe(true);
    const restored = change(violated, "wrong-tribe", { zone: "trash" });
    expect(suppressionPasses(restored, "late")).toBe(false);
    expect(
      suppressionPasses(change(restored, "source", { zone: "trash" }), "late")
    ).toBe(true);
  });

  it("夢美は相手の効果による終了だけを禁止し、Lv低下/相手ターン/発揮元離脱で解除する", () => {
    const state = rebuild(board([inst("BSTH003-X03", "source", 1)]));
    expect(
      executeEndAttackStep(state, "bob").pendingAttackStepEndFinalizations
    ).toHaveLength(0);
    expect(
      executeEndAttackStep(state, "alice").pendingAttackStepEndFinalizations
    ).toHaveLength(1);
    for (const inactive of [
      change(state, "source", { normalCoreCount: 0 }),
      change(state, "source", { zone: "trash" }),
      rebuild({ ...state, activePlayerId: "bob" }),
    ]) {
      expect(
        executeEndAttackStep(inactive, "bob").pendingAttackStepEndFinalizations
      ).toHaveLength(1);
    }
  });
});
