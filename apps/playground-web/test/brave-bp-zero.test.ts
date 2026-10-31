import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import {
  applyLegalAction,
  getLegalActions,
  expandCardDefinitionsWithBackFaces,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  getCombinedUnitBp,
} from "@orica/rules-core";
import { buildBattleImmediateEffectLookup } from "../../../packages/rules-core/src/effect/structured-effect-registrations";
import { buildBraveBpZeroScenario } from "../src/scenario-brave-bp-zero";

const defs = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const getDef = (id: string) => defs.find((d) => d.cardNo === id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
};
const targetIds = ["bp-alice-gold", "bp-alice-night", "bp-eugeo", "bp-kirito"];

describe("モルター＋BP-80000と合体BP0破壊", () => {
  describe.each(["attack", "contract"])("%s", (event) => {
    it("金木犀の剣の耐性対象は候補から除外する", () => {
      let state = buildBraveBpZeroScenario(
        ALL_CARDS,
        new URLSearchParams({ event })
      );
      const act = (playerId: string, kind: string, choiceIndex?: number) => {
        const action = getLegalActions({
          state,
          actingPlayerId: playerId,
          ...lookups,
        }).find(
          (a) =>
            a.kind === kind &&
            !("skipOnly" in a && a.skipOnly === true) &&
            (choiceIndex === undefined ||
              ("choiceIndex" in a && a.choiceIndex === choiceIndex))
        );
        expect(action).toBeDefined();
        state = applyLegalAction({ state, action: action!, ...lookups }).state;
      };
      act(
        "alice",
        event === "contract"
          ? "resolve_pending_triggered_effect"
          : "resolve_battle_immediate_effect"
      );
      act("bob", "pass_stack");
      act("alice", "resolve_pending_step_choice", 0);
      expect(state.players[0]?.countValue).toBe(9);
      act("alice", "resolve_pending_effect_optional_repeat_choice", 0);
      expect(
        state.pendingEffectTargetSelection?.candidateInstanceIds
      ).not.toContain("bp-alice-gold");
      expect(
        state.pendingEffectTargetSelection?.candidateInstanceIds
      ).toContain("bp-alice-night");
    });
    it.each(["alice", "bob"])(
      "%sの通常操作でモルター支払いから4体破壊・ブレイヴ離脱まで解決する",
      (owner) => {
        const opponent = owner === "alice" ? "bob" : "alice";
        let state = buildBraveBpZeroScenario(
          ALL_CARDS,
          new URLSearchParams({ owner, event })
        );
        expect(
          targetIds.map((id) => {
            const c = state.cardInstances.find((c) => c.instanceId === id)!;
            return getCombinedUnitBp(state, c, getDef(c.definitionId), getDef);
          })
        ).toEqual([14000, 17000, 16000, 11000]);
        const act = (
          playerId: string,
          kind: string,
          predicate: (
            a: ReturnType<typeof getLegalActions>[number]
          ) => boolean = () => true,
          extra = {}
        ) => {
          const actions = getLegalActions({
            state,
            actingPlayerId: playerId,
            ...lookups,
          });
          const action = actions.find((a) => a.kind === kind && predicate(a));
          expect(
            action,
            JSON.stringify({
              kind,
              playerId,
              actions,
              pendingAll: Object.fromEntries(
                Object.entries(state).filter(
                  ([k, v]) =>
                    (k.startsWith("pending") ||
                      k.includes("StackWindow") ||
                      k === "battleImmediateEffects") &&
                    v
                )
              ),
              stack: state.stackWindow,
              flash: state.activeAttack?.flashWindowState,
              pending: state.pendingStepChoice,
              log: state.log.slice(-12),
            })
          ).toBeDefined();
          if (action?.kind === "resolve_pending_effect_target") {
            expect(action.candidateTargetInstanceIds).toEqual(
              expect.arrayContaining(targetIds)
            );
          }
          state = applyLegalAction({
            state,
            action: action!,
            ...lookups,
            ...extra,
          }).state;
        };
        act(
          owner,
          event === "contract"
            ? "resolve_pending_triggered_effect"
            : "resolve_battle_immediate_effect",
          (a) => !("skipOnly" in a && a.skipOnly === true)
        );
        act(opponent, "pass_stack");
        expect(state.pendingStepChoice?.paidEffectModifierChoice?.kind).toBe(
          "paid_prevention_immunity"
        );
        act(
          owner,
          "resolve_pending_step_choice",
          (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === 1
        );
        expect(state.players.find((p) => p.id === owner)?.countValue).toBe(8);
        act(
          owner,
          "resolve_pending_effect_optional_repeat_choice",
          (a) =>
            a.kind === "resolve_pending_effect_optional_repeat_choice" &&
            a.choiceIndex === 1
        );
        act(owner, "resolve_pending_effect_optional_repeat_count", undefined, {
          countDecreaseSelection: 7,
        });
        expect(
          state.pendingEffectTargetSelection?.candidateInstanceIds,
          JSON.stringify({
            pending: state.pendingEffectTargetSelection,
            log: state.log.slice(-20),
          })
        ).toContain("bp-alice-gold");
        if (event === "attack") {
          // 保存済みの旧形式（battle専用の防止不可のみ）でも、耐性持ち1体を
          // 生存候補0体と誤認して「対象なし」で8回分を不発にしない。
          const pending = state.pendingEffectTargetSelection!;
          const deferredStack = { ...pending.deferredStack };
          delete deferredStack.preventionLevel;
          const onlyProtectedTarget = {
            ...state,
            pendingEffectTargetSelection: {
              ...pending,
              deferredStack,
              candidateInstanceIds: ["bp-alice-gold"],
            },
          };
          const action = getLegalActions({
            state: onlyProtectedTarget,
            actingPlayerId: owner,
            ...lookups,
          }).find((a) => a.kind === "resolve_pending_effect_target")!;
          expect(action.candidateTargetInstanceIds).toEqual(["bp-alice-gold"]);
          // 追加回数は各解決後に改めて対象を選ぶ。最初の選択は 1 体だけで、
          // 残り 7 回も同じ候補から 1 体ずつ選ぶ pending に遷移する。
          expect(action.requiredTargetCount).toBe(1);
          expect(() =>
            applyLegalAction({
              state: onlyProtectedTarget,
              action,
              ...lookups,
              targetInstanceIds: [],
            })
          ).toThrow(/target count/);
        }
        // 基本 1 回 + カウント減少 7 回は、本文どおり毎回その時点の候補から
        // 1 体ずつ取り直す。旧実装のように 8 体分を一度に選択しない。
        const [baseTarget, ...repeatTargets] = targetIds.flatMap((id) => [
          id,
          id,
        ]);
        act(owner, "resolve_pending_effect_target", undefined, {
          targetInstanceIds: [baseTarget],
        });
        for (const targetId of repeatTargets) {
          act(
            owner,
            "resolve_pending_step_optional_target_selection",
            undefined,
            {
              targetInstanceIds: [targetId],
            }
          );
        }
        // ユージオの任意離脱時効果は発揮せず、合体ブレイヴも一緒にトラッシュへ送る。
        for (let i = 0; i < 12; i++) {
          const actions = getLegalActions({
            state,
            actingPlayerId: opponent,
            ...lookups,
          });
          const action =
            actions.find(
              (a) =>
                a.kind === "resolve_brave_leave_choice" &&
                a.choice === "send_with_host"
            ) ??
            actions.find(
              (a) => a.kind === "resolve_pending_triggered_effect"
            ) ??
            actions.find((a) => a.kind === "resolve_pending_burst_check");
          if (!action) break;
          state = applyLegalAction({
            state,
            action,
            ...lookups,
            skipOptionalEffect:
              action.kind === "resolve_pending_triggered_effect",
          }).state;
        }
        expect(state.players.find((p) => p.id === owner)?.countValue).toBe(0);
        expect(
          targetIds.map(
            (id) => state.cardInstances.find((c) => c.instanceId === id)?.zone
          ),
          JSON.stringify({
            log: state.log.slice(-20),
            pending: state.pendingTriggeredEffects,
            leave: state.pendingLeaveEntities,
            brave: state.pendingBraveLeaveChoice,
          })
        ).toEqual(["trash", "trash", "trash", "trash"]);
        expect(state.pendingBraveLeaveChoice).toBeNull();
        expect(
          state.cardInstances
            .filter(
              (c) =>
                c.instanceId.endsWith("-brave") &&
                c.instanceId !== "bp-source-brave"
            )
            .every((c) => c.zone === "trash")
        ).toBe(true);
        const destroyed = state.publicDisclosures
          .flatMap((d) => d.results)
          .filter((r) => r.kind === "card_move" && r.actionLabel === "destroy");
        expect(
          destroyed.map((r) => ("instanceId" in r ? r.instanceId : null))
        ).toEqual(expect.arrayContaining(targetIds));
      }
    );
  });
});
