import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type ApplyLegalActionOptions,
  type GameState,
  type LegalAction,
} from "../src";
import {
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const definitionMap = new Map(definitions.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => definitionMap.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(definitions),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(definitions),
  getRegisteredBurstActions: () => [],
};

// Q17092: 攻撃スピリットがいなくてもフラッシュなど一連のバトルを解決する。
// 10_rules/02: バトル終了時効果をすべて解決してからステップを移す。
describe("ユウの雷鎚ショット → グランギニョル転醒後のバトル継続", () => {
  it.each(["keep", "decline"] as const)(
    "ユウの魂状態置換を%sしても、相手フラッシュ後にアタックステップを終了する",
    (soulChoice) => {
      const makeCard = (
        cardNo: string,
        instanceId: string,
        ownerPlayerId: string,
        zone: "field" | "hand",
        normalCoreCount = 0
      ) =>
        createCardInstance(getCardDefinitionById(cardNo)!, {
          instanceId,
          ownerPlayerId,
          zone,
          normalCoreCount,
        });
      const yu = makeCard("BSGE01-CX01", "yu", "bob", "field", 1);
      const gun = makeCard("BSGE01-TX01(A)", "gun", "bob", "field");
      const shot = makeCard("BSGE01-R03", "shot", "bob", "field");
      const tx01 = makeCard("BSTH02.7-TX01(A)", "tx01", "alice", "hand");
      yu.attachedChildrenIds = [gun.instanceId];
      gun.attachedToInstanceId = yu.instanceId;
      yu.underCards = [
        {
          role: "text_role",
          roleTag: "バレットエディット",
          cardInstanceId: shot.instanceId,
        },
      ];
      shot.attachedToInstanceId = yu.instanceId;
      shot.zoneRoleName = "bullet-edit";
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["bob", "alice"],
          cardInstances: [yu, gun, shot, tx01],
          playerOverrides: [
            { countValue: 4, contractCardNo: "BSGE01-CX01" },
            { reserveNormalCoreCount: 6, trashNormalCoreCount: 1 },
          ],
        }),
        turnNumber: 3,
        step: "attack",
        window: "none",
        activePlayerId: "bob",
      };
      const actions = () =>
        ["bob", "alice"].flatMap((actingPlayerId) =>
          getLegalActions({ state, actingPlayerId, ...lookups })
        );
      const apply = (
        predicate: (action: LegalAction) => boolean,
        extra: Partial<ApplyLegalActionOptions> = {}
      ) => {
        const available = actions();
        const action = available.find(
          (action) => action.can && predicate(action)
        );
        expect(action, JSON.stringify(available)).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...lookups,
          ...extra,
        }).state;
      };
      const drainResponses = () => {
        for (let i = 0; i < 20; i++) {
          const response = actions().find(
            (action) =>
              action.can &&
              (action.kind === "pass_stack" ||
                action.kind === "pass_pre_declaration_stack" ||
                action.kind === "resolve_pending_burst_check")
          );
          if (!response) return;
          state = applyLegalAction({
            state,
            action: response,
            ...lookups,
          }).state;
        }
        throw new Error("Response queue did not settle");
      };
      apply(
        (action) => action.kind === "attack" && action.sourceInstanceId === "yu"
      );
      drainResponses();
      const attackId = state.activeAttack!.attackId;
      // 神機のアタック時効果などを先に片付け、雷鎚ショットを最後に発揮する。
      for (let i = 0; i < 10; i++) {
        const other = actions().find(
          (action) =>
            action.can &&
            action.kind === "resolve_battle_immediate_effect" &&
            action.sourceEffectInstanceId !== "shot"
        );
        if (!other) break;
        state = applyLegalAction({ state, action: other, ...lookups }).state;
        drainResponses();
      }
      const countBeforeShot = state.players[0]!.countValue;
      apply(
        (action) =>
          action.kind === "resolve_battle_immediate_effect" &&
          action.sourceEffectInstanceId === "shot" &&
          !action.skipOnly
      );
      drainResponses();
      expect(state.players[0]!.countValue).toBe(countBeforeShot - 2);
      expect(state.players[1]!.lifeNormalCoreCount).toBe(4);
      apply((action) => action.kind === "declare_private_triggered_effect");
      drainResponses();
      apply((action) => action.kind === "resolve_pending_triggered_effect");
      drainResponses();
      apply((action) => action.kind === "resolve_pending_effect_target", {
        targetInstanceIds: ["yu"],
      });
      apply(
        (action) =>
          action.kind === "resolve_brave_leave_choice" &&
          action.choice === "send_with_host"
      );
      apply(
        (action) =>
          action.kind === "resolve_soul_state_replacement" &&
          action.choice === soulChoice
      );
      expect(state.activeAttack?.attackId).toBe(attackId);
      expect(state.battlesEndedThisTurn ?? 0).toBe(0);
      apply(
        (action) =>
          action.kind === "resolve_pending_step_optional_choice" &&
          action.choice === "execute"
      );
      apply((action) => action.kind === "resolve_pending_core_distribution", {
        coreDistributionAllocations: { tx01: 1 },
        coreDistributionSourceAllocations: { trash: 1 },
      });
      drainResponses();
      expect(
        state.cardInstances.find((card) => card.instanceId === "tx01")
      ).toMatchObject({
        definitionId: "BSTH02.7-TX01(B)",
        zone: "field",
        normalCoreCount: 1,
      });
      expect(state.pendingBattleEndDeferrals).toEqual([
        expect.objectContaining({ attackId }),
      ]);
      expect(state.step).toBe("attack");
      apply((action) => action.kind === "open_battle_flash");
      expect(state.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
        "alice"
      );
      apply(
        (action) =>
          action.kind === "pass_battle_flash" &&
          action.actingPlayerId === "alice"
      );
      expect(state.step).toBe("attack");
      expect(state.battlesEndedThisTurn ?? 0).toBe(0);
      apply(
        (action) =>
          action.kind === "pass_battle_flash" && action.actingPlayerId === "bob"
      );
      drainResponses();
      expect(state.step).toBe("end");
      expect(state.activeAttack).toBeNull();
      expect(state.battlesEndedThisTurn).toBe(1);
      expect(state.players[1]!.lifeNormalCoreCount).toBe(4);
      expect(state.pendingBattleEndDeferrals).toEqual([]);
      expect(state.pendingAttackStepEndFinalizations).toEqual([]);
      expect(
        state.log.some((entry) => entry.startsWith("block:declare:"))
      ).toBe(false);
      expect(state.log).toContain("effect:end_attack_step:finalized:alice");
      expect(
        state.activeContinuousEffects.some(
          (effect) => effect.modifierTag === "prevent_attack"
        )
      ).toBe(false);
    }
  );
});
