import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildBurstEffectTreeScenario } from "../../../apps/playground-web/src/scenario-burst-effect-tree";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
  getLegalActions,
  type LegalAction,
} from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const options = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredMagicActions: () => [],
};

describe("バースト効果発揮は派生効果ツリーの解決後 (公式 Q411)", () => {
  for (const owner of ["alice", "bob"]) {
    it(`${owner}: 同時召喚後のコア配置と残り誘発を終えてから発揮する`, () => {
      const opponent = owner === "alice" ? "bob" : "alice";
      let state = buildBurstEffectTreeScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      const act = (
        player: string,
        predicate: (action: LegalAction) => boolean,
        extra = {}
      ) => {
        const actions = getLegalActions({
          state,
          actingPlayerId: player,
          ...options,
        });
        const action = actions.find(predicate);
        expect(action, JSON.stringify(actions)).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...options,
          ...extra,
        }).state;
      };
      const pass = (player: string) =>
        act(player, (a) => a.kind === "pass_stack");
      act(
        owner,
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "summoner" &&
          a.registrationIndex === 0
      );
      pass(opponent);
      act(owner, (a) => a.kind === "resolve_pending_effect_target", {
        targetInstanceIds: ["child-alice", "child-ronie"],
      });
      act(owner, (a) => a.kind === "resolve_pending_multi_placement", {
        multiPlacementAllocations: ["child-alice", "child-ronie"].map(
          (destinationInstanceId) => ({
            destinationInstanceId,
            placements: [
              {
                kind: "reserve_normal",
                amount: destinationInstanceId === "child-alice" ? 2 : 1,
              },
            ],
          })
        ),
      });
      expect(state.pendingTriggeredEffects.length).toBeGreaterThan(0);
      act(
        opponent,
        (a) =>
          a.kind === "resolve_pending_burst_check" &&
          a.sourceInstanceId === "burst"
      );
      expect(state.stackWindow?.burstWindowKind).toBe("activation");
      pass(owner);
      expect(state.stackWindow).toBeNull();
      expect(state.revealedBurstStates).toHaveLength(1);

      // 元効果を保持したまま、新たに召喚されたカードの派生効果を先に解決する。
      expect(
        state.pendingTriggeredEffects.some(
          (pending) => pending.relatedInstanceId === "summoner"
        )
      ).toBe(true);
      // 派生効果が入力待ちで中断すると、cascade の待機フラグがない状態を経由する。
      act(
        owner,
        (a) =>
          a.kind === "select_pending_to_resolve" &&
          a.sourceInstanceId === "child-alice" &&
          a.registrationIndex === 1
      );
      pass(opponent);
      expect(state.pendingCoreDistribution).not.toBeNull();
      act(owner, (a) => a.kind === "resolve_pending_core_distribution", {
        coreDistributionAllocations: { summoner: 1 },
      });
      expect(
        state.players.find((p) => p.id === owner)?.lifeNormalCoreCount
      ).toBe(6);
      expect(
        state.cardInstances.find((c) => c.instanceId === "summoner")
          ?.normalCoreCount
      ).toBe(3);
      expect(state.pendingTriggeredEffects.length).toBeGreaterThan(0);
      expect(state.stackWindow).toBeNull();
      expect(
        state.pendingStackCascade?.remainingStacks[0]
          ?.burstEffectDeclarationPending
      ).toBe(true);
      expect(
        state.log.some((line) =>
          line.startsWith("stack:burst-effect-decl:open:")
        )
      ).toBe(false);

      // 残りを正規の辞退アクションで消化。最後の1件が消えるまでは発揮窓を開かない。
      for (let i = 0; i < 8 && state.pendingTriggeredEffects.length > 0; i++) {
        act(
          owner,
          (a) =>
            a.kind === "select_pending_to_resolve" ||
            a.kind === "resolve_pending_triggered_effect",
          { skipOptionalEffect: true }
        );
        if (state.pendingTriggeredEffects.length > 0)
          expect(state.stackWindow).toBeNull();
      }
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(state.stackWindow?.burstWindowKind).toBe("effect_declaration");
      expect(
        state.log.filter((line) =>
          line.startsWith("stack:burst-effect-decl:open:")
        )
      ).toHaveLength(1);
      // 発揮宣言への応答後に初めて対象を選び、破壊とドローを解決する。
      pass(owner);
      expect(state.pendingEffectTargetSelection?.sourceInstanceId).toBe(
        "burst"
      );
      act(opponent, (a) => a.kind === "resolve_pending_effect_target", {
        targetInstanceIds: ["summoner"],
      });
      expect(
        state.cardInstances.find((c) => c.instanceId === "summoner")?.zone
      ).toBe("trash");
      expect(state.players.find((p) => p.id === opponent)?.handCount).toBe(2);
      expect(state.pendingBurstChecks).toHaveLength(0);
      expect(state.revealedBurstStates).toHaveLength(0);
      expect(state.pendingStackCascade).toBeNull();
    });
  }
});
