/**
 * 転醒トリガー（このスピリットのアタック時）= card_event:"attack" の任意誘発で
 * A 面 → B 面へ裏返す primitive の統合テスト。
 *
 * 背景: BSTH07-転醒X01(A) / BSTH08-転醒R01(A) は『Lv2【転醒：自分のカウントN以下】
 * このスピリットがアタックしたとき、このスピリットを裏返せる』。従来 transmute トリガーが
 * `continuous` timing の stub で未配線だった。本イテレーションでカード本文を
 * card_event:attack の任意誘発（executionMode:"optional"・applicability level>=2）へ
 * 配線した。rebirth の本体（カウント条件・同時転醒不可・Lv不足消滅・アタック中BP再計算）は
 * executeRebirth が内包し、A→B flip 後の B 面『転醒時』は trigger-system が自動収集する
 * （10_rules/08a §2、rebirth-trigger.test.ts と同基盤）。
 *
 * 本テストは:
 *   - 転醒効果が card_event:attack の rebirth 効果として登録され、stub が外れている
 *   - 転醒条件（カウント N 以下）が rebirth.maxCount に保持される
 *   - Lv2 限定（applicability.level.min=2）が保持される
 *   - executeRebirth による裏返しで定義 ID が B 面・カウント +1（盤面変化）
 *   - カウント上限超過時は flip しない（maxCount ガード）
 * を検証する。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState, RebirthAction } from "../src/model";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { ALL_CARDS } from "../../card-data/src/generated-index";

function buildLookup(defs: readonly CardDefinition[]) {
  const expanded = expandCardDefinitionsWithBackFaces(defs);
  const map = new Map(expanded.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

const getCardDefinitionById = buildLookup(ALL_CARDS);

/** card_event:"attack" を含む rebirth 効果（転醒トリガー）を取り出す。 */
function attackRebirthEffect(def: CardDefinition) {
  return (def.effects ?? []).find((e) => {
    if (e.timing.kind !== "card_event") return false;
    const events = Array.isArray(e.timing.event)
      ? e.timing.event
      : [e.timing.event];
    return (
      events.includes("attack") &&
      e.steps.some((s) => s.action.kind === "rebirth")
    );
  });
}

interface Case {
  cardNo: string;
  backNo: string;
  maxCount: number;
  requiresSoulCorePlacement?: boolean;
}

const CASES: Case[] = [
  {
    cardNo: "BSTH03-転醒X01(A)",
    backNo: "BSTH03-転醒X01(B)",
    maxCount: 5,
    requiresSoulCorePlacement: true,
  },
  { cardNo: "BSTH07-転醒X01(A)", backNo: "BSTH07-転醒X01(B)", maxCount: 5 },
  { cardNo: "BSTH08-転醒R01(A)", backNo: "BSTH08-転醒R01(B)", maxCount: 3 },
];

describe("転醒トリガー（アタック時）— card_event:attack rebirth wiring", () => {
  for (const c of CASES) {
    describe(c.cardNo, () => {
      const def = getCardDefinitionById(c.cardNo)!;

      it("転醒効果が card_event:attack の rebirth 効果として配線（stub 解消）", () => {
        const effect = attackRebirthEffect(def);
        expect(
          effect,
          `${c.cardNo} must have an attack-trigger rebirth effect`
        ).toBeDefined();
        // stub が外れている。
        expect(effect!.stub).toBeUndefined();
        // 任意誘発（「裏返せる」）。
        expect(effect!.executionMode).toBe("optional");
        // Lv2 限定。
        expect(effect!.applicability).toEqual({ level: { min: 2 } });
        // 転醒条件（カウント N 以下）が rebirth.maxCount に保持される。
        const rebirthStep = effect!.steps.find(
          (step) => step.action.kind === "rebirth"
        )!;
        expect(rebirthStep.action.kind).toBe("rebirth");
        if (rebirthStep.action.kind === "rebirth") {
          expect(rebirthStep.action.maxCount).toBe(c.maxCount);
        }
        if (c.requiresSoulCorePlacement) {
          const soulSteps = effect!.steps.filter(
            (step) => step.action.kind === "core_move"
          );
          expect(soulSteps.map((step) => step.action)).toEqual([
            {
              kind: "core_move",
              from: { kind: "field", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
            {
              kind: "core_move",
              from: { kind: "reserve", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
            {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
            {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          ]);
          expect(soulSteps.map((step) => step.stepCondition)).toEqual([
            { kind: "rebirth_precheck", maxCount: c.maxCount },
            { kind: "rebirth_precheck", maxCount: c.maxCount },
            { kind: "rebirth_precheck", maxCount: c.maxCount },
            { kind: "rebirth_precheck", maxCount: c.maxCount },
          ]);
          expect(rebirthStep.connector).toBeUndefined();
          expect(rebirthStep.stepCondition).toBeUndefined();
        }
      });

      it("カウント条件達成下で executeRebirth が A→B へ裏返しカウント+1（盤面変化）", () => {
        const card = createCardInstance(def, {
          instanceId: "tx-1",
          ownerPlayerId: "alice",
          zone: "field",
          zoneRoleName: "spirit",
          normalCoreCount: 3,
        });
        const before: GameState = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [card],
        });
        // alice.countValue は既定 0（<= maxCount）。
        const action: RebirthAction = {
          kind: "rebirth",
          maxCount: c.maxCount,
          triggerDescription: "",
        };
        const after = executeRebirth(
          before,
          "alice",
          action,
          "tx-1",
          getCardDefinitionById,
          "test:transmute-attack-trigger:158"
        );

        const flipped = after.cardInstances.find(
          (x) => x.instanceId === "tx-1"
        )!;
        expect(flipped.definitionId).toBe(c.backNo);
        expect(flipped.zone).toBe("field");
        expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);

        // delta から rebirth イベントが 1 件（B 面『転醒時』を誘発する）。
        const events = collectTriggerEventsFromStateDelta({
          beforeState: before,
          afterState: after,
          source: "action_resolution",
          chainId: null,
          attackId: null,
          getCardDefinitionById,
        });
        expect(events.filter((e) => e.eventKind === "rebirth").length).toBe(1);
      });

      it("カウント上限超過時は裏返さない（maxCount ガード）", () => {
        const card = createCardInstance(def, {
          instanceId: "tx-2",
          ownerPlayerId: "alice",
          zone: "field",
          zoneRoleName: "spirit",
          normalCoreCount: 3,
        });
        const base = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [card],
        });
        // カウントを maxCount + 1 に設定 → 転醒条件を満たさない。
        const before: GameState = {
          ...base,
          players: base.players.map((p) =>
            p.id === "alice" ? { ...p, countValue: c.maxCount + 1 } : p
          ),
        };
        const action: RebirthAction = {
          kind: "rebirth",
          maxCount: c.maxCount,
          triggerDescription: "",
        };
        const after = executeRebirth(
          before,
          "alice",
          action,
          "tx-2",
          getCardDefinitionById,
          "test:transmute-attack-trigger:209"
        );
        const stillFront = after.cardInstances.find(
          (x) => x.instanceId === "tx-2"
        )!;
        expect(stillFront.definitionId).toBe(c.cardNo);
        expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(
          c.maxCount + 1
        );
      });
    });
  }

  it("BSTH03-転醒X01(A): ソウルコアを可能なら置いて attack 効果解決で A→B に転醒する", () => {
    const def = getCardDefinitionById("BSTH03-転醒X01(A)")!;
    const effect = attackRebirthEffect(def)!;
    const card = createCardInstance(def, {
      instanceId: "tx-bsth03-soul-cost",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 3,
    });
    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [card],
      playerOverrides: [
        { countValue: 0, soulCoreLocation: { kind: "reserve" } },
        {},
      ],
    });

    const after = executeEffect({
      chainId: "test:transmute-attack-trigger:247",
      state: before,
      effect,
      sourceInstanceId: "tx-bsth03-soul-cost",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const flipped = after.cardInstances.find(
      (x) => x.instanceId === "tx-bsth03-soul-cost"
    )!;
    expect(flipped.definitionId).toBe("BSTH03-転醒X01(B)");
    expect(flipped.normalCoreCount).toBe(3);
    expect(flipped.soulCoreCount).toBe(1);
    expect(
      after.players.find((p) => p.id === "alice")!.soulCoreLocation
    ).toEqual({ kind: "card", instanceId: "tx-bsth03-soul-cost" });
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);
  });
});
