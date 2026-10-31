import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { getAvailableFieldCardEffectLegalActions } from "../../../packages/rules-core/src/legal/legal-actions-availability";
import { buildMarsEffectsScenario } from "../src/scenario-mars-effects";
import { buildEffectQueue } from "../src/components/EffectQueueOverlay";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookups = {
  getCardDefinitionById: (id: string) =>
    definitions.find((card) => card.cardNo === id),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(definitions),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
};

describe("火星デッキのユーザー報告", () => {
  it.each(["alice", "bob"])(
    "%s: スレインの実発揮で導界者をネクサス配置し、次のターンも同名で再使用できない",
    (owner) => {
      let state = buildMarsEffectsScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      const actions = (player = owner) =>
        getLegalActions({ state, actingPlayerId: player, ...lookups });
      const act = (kind: LegalAction["kind"], player = owner, extra = {}) => {
        const action = actions(player).find(
          (action) =>
            action.kind === kind &&
            (action.kind !== "resolve_pending_step_optional_choice" ||
              action.choice === "execute")
        );
        expect(action, JSON.stringify(actions(player))).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...lookups,
          ...extra,
        }).state;
      };
      act("use_field_card_effect");
      act("pass_stack", owner === "alice" ? "bob" : "alice");
      // 7枚破棄後の配置対象は、前からトラッシュにある同じ導界者を含まない。
      if (state.pendingStepOptionalChoice)
        act("resolve_pending_step_optional_choice", owner, {
          targetInstanceIds: ["mars-nexus-a", "mars-nexus-b"],
        });
      if (state.pendingEffectTargetSelection)
        act("resolve_pending_effect_target", owner, {
          targetInstanceIds: ["mars-nexus-a", "mars-nexus-b"],
        });
      if (state.pendingStepOptionalTargetSelection) {
        expect(
          state.pendingStepOptionalTargetSelection.candidateInstanceIds
        ).toEqual(["mars-nexus-a", "mars-nexus-b"]);
        act("resolve_pending_step_optional_target_selection", owner, {
          targetInstanceIds: ["mars-nexus-a", "mars-nexus-b"],
        });
      }
      expect(
        state.cardInstances
          .filter(
            (card) => card.zone === "field" && card.zoneRoleName === "nexus"
          )
          .map((card) => card.instanceId)
          .sort(),
        JSON.stringify({ log: state.log, actions: actions() })
      ).toEqual(["mars-nexus-a", "mars-nexus-b"]);
      expect(
        state.cardInstances.find((card) => card.instanceId === "mars-old-trash")
          ?.zone
      ).toBe("trash");
      expect(
        state.players.find((player) => player.id === owner)
          ?.reserveNormalCoreCount
      ).toBe(9);
      expect(
        state.pendingTriggeredEffects.filter(
          (pending) => pending.mechanic?.kind === "placement_oracle"
        )
      ).toHaveLength(2);
      // 同名別個体と後のターンにも実際に記録したゲーム制限が引き継がれる。
      const used: GameState = {
        ...state,
        turnNumber: state.turnNumber + 2,
        pendingTriggeredEffects: [],
        pendingPrivateDeclarations: [],
        pendingBurstChecks: [],
        cardInstances: state.cardInstances.map((card) =>
          card.instanceId === "mars-slaine"
            ? { ...card, instanceId: "mars-slaine-new" }
            : card
        ),
      };
      expect(
        getAvailableFieldCardEffectLegalActions({
          state: used,
          actingPlayerId: owner,
          ...lookups,
        }).filter((action) => action.sourceInstanceId === "mars-slaine-new")
      ).toEqual([]);
    }
  );

  it("B面ディオスクリアがヘラスの転醒を取得しても発揮候補がない", () => {
    const state = buildMarsEffectsScenario(
      ALL_CARDS,
      new URLSearchParams({ mode: "dioscuria" })
    );
    const granted = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "granted_effect" && ce.metadata?.grantedEffect
    );
    expect(granted.length).toBeGreaterThan(0);
    expect(
      getAvailableFieldCardEffectLegalActions(
        { state, actingPlayerId: "alice", ...lookups },
        "flash"
      ).filter((action) => action.sourceInstanceId === "mars-dioscuria")
    ).toEqual([]);
  });

  it("18件の導託は全件に順序選択の操作が対応する", () => {
    const state = buildMarsEffectsScenario(
      ALL_CARDS,
      new URLSearchParams({ mode: "queue" })
    );
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });
    const queue = buildEffectQueue(
      state,
      lookups.getCardDefinitionById,
      lookups.getRegisteredTriggeredEffectActions,
      "alice",
      actions
    );
    expect(queue).toHaveLength(18);
    expect(queue.every((item) => (item.actions?.length ?? 0) > 0)).toBe(true);
  });
});
