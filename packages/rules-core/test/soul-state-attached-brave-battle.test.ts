import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createActiveAttack,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  resolveSoulStateReplacement,
  type ApplyLegalActionOptions,
  type GameState,
  type LegalAction,
} from "../src";
import {
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import {
  executeBattleResolution,
  getUnblockedLifeDamage,
} from "../src/battle/battle-actions";
import {
  createBattleResolutionGroup,
  recomputeBattleEntityBp,
} from "../src/battle/battle-shared";

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

// 02c:8 / Q17092: attacker absence suppresses damage, not the battle-end tail.
describe("魂状態ホストにattachedのブレイヴは独立した攻撃者ではない", () => {
  it("添付629905112の実カード状態と残存entityを再投入してもライフ1を奪わない", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/telegram-629905112-soul-battle.json",
          import.meta.url
        ),
        "utf8"
      )
    );
    expect(fixture.sourceSha256).toBe(
      "59d59ae0f1e5d24543d0a1e5495a00ff7d72ddf79dece2d356ec3e33e0a961f2"
    );
    expect(fixture.publicDisclosures.at(-1).results).toContainEqual(
      expect.objectContaining({ kind: "life_delta", amount: -1 })
    );
    const entity = { ...fixture.battleEntities[0], attackState: "attacking" };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: fixture.cardInstances,
      playerOverrides: fixture.players,
    });
    const state: GameState = {
      ...base,
      turnNumber: 6,
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      battleEntities: [entity],
      publicDisclosures: fixture.publicDisclosures,
      // The attachment is an ended post-state, not a replay. Re-enter its stale
      // entity at resolution with one life to test the boundary, keeping history.
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, lifeNormalCoreCount: 1 } : p
      ),
      activeAttack: {
        ...createActiveAttack(base, entity.entityId, "bob"),
        attackId: fixture.publicDisclosures[0].attackId,
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
      },
    };
    const ready = {
      ...state,
      battleResolutionGroup: createBattleResolutionGroup(state),
    };
    expect(
      getUnblockedLifeDamage(ready, getCardDefinitionById)?.totalLifeDamage
    ).toBe(0);
    expect(
      recomputeBattleEntityBp(state, getCardDefinitionById).battleEntities[0]
    ).toMatchObject({
      memberInstanceIds: [],
      resolvedBp: 0,
      resolvedSymbols: [],
      resolvedSymbolCount: 0,
    });
    const result = executeBattleResolution({ state, ...lookups });
    expect(result.totalLifeDamage).toBe(0);
    expect(result.state.players[0]!.lifeNormalCoreCount).toBe(1);
    expect(
      result.state.cardInstances.find((c) => c.instanceId === "card-51")
        ?.attachedToInstanceId
    ).toBe("card-59");
    expect(
      result.state.publicDisclosures
        .slice(fixture.publicDisclosures.length)
        .flatMap((p) => p.results)
        .filter((r) => r.kind === "life_delta")
    ).toEqual([]);
  });

  for (const { attackState, braveNo, title } of [
    {
      attackState: "attacking",
      braveNo: "BSGE01-TX01(A)",
      title:
        "attacking: 魂状態へattachedのBSGE01-TX01(A)は通常の攻防可能性と独立して参加を失う",
    },
    {
      attackState: "attacking",
      braveNo: "BSTH01-X09",
      title:
        "attacking: 魂状態へattachedのBSTH01-X09は通常の攻防可能性と独立して参加を失う",
    },
    {
      attackState: "blocking",
      braveNo: "BSGE01-TX01(A)",
      title:
        "blocking: 魂状態へattachedのBSGE01-TX01(A)は通常の攻防可能性と独立して参加を失う",
    },
    {
      attackState: "blocking",
      braveNo: "BSTH01-X09",
      title:
        "blocking: 魂状態へattachedのBSTH01-X09は通常の攻防可能性と独立して参加を失う",
    },
  ] as const) {
    it(title, () => {
      const host = createCardInstance(getCardDefinitionById("BSGE01-CX01")!, {
        instanceId: "host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        attachedChildrenIds: ["brave"],
      });
      const brave = createCardInstance(getCardDefinitionById(braveNo)!, {
        instanceId: "brave",
        ownerPlayerId: "alice",
        zone: "field",
        attachedToInstanceId: "host",
      });
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      });
      const before: GameState = {
        ...base,
        battleEntities: [
          {
            entityId: "unit",
            attackState,
            memberInstanceIds: ["host", "brave"],
            resolvedBp: 10000,
            resolvedSymbols: ["red", "red"],
          },
        ],
        activeAttack: createActiveAttack(base, "unit", "alice"),
        pendingSoulStateReplacement: {
          choosingPlayerId: "alice",
          cardInstanceId: "host",
          originalLeaveKind: "destroy",
          originalLeaveCause: "effect_resolution",
        },
      };
      const after = resolveSoulStateReplacement(
        before,
        true,
        getCardDefinitionById
      );
      expect(after.battleEntities[0]).toMatchObject({
        memberInstanceIds: [],
        resolvedBp: 0,
        resolvedSymbols: [],
        resolvedSymbolCount: 0,
        leftFieldMemberInstanceIds: ["host", "brave"],
      });
      expect(after.activeAttack?.attackId).toBe(before.activeAttack?.attackId);
      expect(
        after.cardInstances.find((c) => c.instanceId === "brave")
          ?.attachedToInstanceId
      ).toBe("host");
    });
  }

  for (const { route, title } of [
    {
      route: "legal",
      title: "BSGE01-CX01 + TX01(A)を実R13アクセルで破壊し魂状態化: legal",
    },
    {
      route: "attached-replacement",
      title:
        "BSGE01-CX01 + TX01(A)を実R13アクセルで破壊し魂状態化: attached-replacement",
    },
  ] as const) {
    it(title, () => {
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
      const host = makeCard("BSGE01-CX01", "host", "alice", "field", 1);
      const brave = makeCard("BSGE01-TX01(A)", "brave", "alice", "field");
      host.attachedChildrenIds = [brave.instanceId];
      brave.attachedToInstanceId = host.instanceId;
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            host,
            brave,
            makeCard("BSTH08.5-R13", "accel", "bob", "hand"),
          ],
          playerOverrides: [
            { contractCardNo: host.definitionId },
            { reserveNormalCoreCount: 8 },
          ],
        }),
        turnNumber: 6,
        step: "attack",
        window: "none",
        activePlayerId: "alice",
      };
      const actions = () =>
        ["alice", "bob"].flatMap((actingPlayerId) =>
          getLegalActions({ state, actingPlayerId, ...lookups })
        );
      const apply = (
        predicate: (a: LegalAction) => boolean,
        extra: Partial<ApplyLegalActionOptions> = {}
      ) => {
        const available = actions();
        const action = available.find((a) => a.can && predicate(a));
        expect(action, JSON.stringify(available)).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...lookups,
          ...extra,
        }).state;
      };
      const drainResponses = () => {
        for (let n = 0; n < 30; n++) {
          const action = actions().find(
            (a) =>
              a.can &&
              ([
                "pass_stack",
                "pass_pre_declaration_stack",
                "resolve_pending_burst_check",
              ].includes(a.kind) ||
                (a.kind === "pass_battle_flash" &&
                  state.activeAttack?.flashWindowState?.pendingStackAction !=
                    null))
          );
          if (!action) return;
          state = applyLegalAction({ state, action, ...lookups }).state;
        }
        throw new Error("Responses did not settle");
      };
      apply((a) => a.kind === "attack" && a.sourceInstanceId === "host");
      drainResponses();
      const attackId = state.activeAttack!.attackId;
      for (let n = 0; n < 10; n++) {
        const action = actions().find(
          (a) => a.can && a.kind === "resolve_battle_immediate_effect"
        );
        if (!action) break;
        state = applyLegalAction({ state, action, ...lookups }).state;
        drainResponses();
      }
      apply((a) => a.kind === "open_battle_flash");
      apply((a) => a.kind === "use_accel" && a.sourceInstanceId === "accel", {
        paymentSources: [{ kind: "reserve", amount: 5 }],
      });
      drainResponses();
      if (state.pendingEffectTargetSelection) {
        apply((a) => a.kind === "resolve_pending_effect_target", {
          targetInstanceIds: ["host"],
        });
      }
      drainResponses();
      expect(state.pendingSoulStateReplacement?.cardInstanceId).toBe("host");
      if (route === "legal") {
        apply(
          (a) => a.kind === "resolve_brave_leave_choice" && a.choice === "keep"
        );
        apply(
          (a) =>
            a.kind === "resolve_soul_state_replacement" && a.choice === "keep"
        );
      } else {
        // The saved report has the brave still attached. Exercise the real soul
        // replacement boundary produced by R13 without first separating it.
        // Current legal-action ordering offers the brave choice first (above).
        state = resolveSoulStateReplacement(state, true, getCardDefinitionById);
      }
      drainResponses();
      expect(state.players[0]!.soulStateInstanceIds).toContain("host");
      expect(
        state.cardInstances.find((c) => c.instanceId === "brave")
      ).toMatchObject({
        zone: "field",
        attachedToInstanceId: route === "legal" ? null : "host",
      });
      expect(
        state.battleEntities.find(
          (e) => e.entityId === state.activeAttack?.primaryEntityId
        )?.memberInstanceIds
      ).toEqual([]);
      if (state.pendingBraveLeaveChoice) {
        apply(
          (a) => a.kind === "resolve_brave_leave_choice" && a.choice === "keep"
        );
      }
      const lifeBefore = state.players.map((p) => p.lifeNormalCoreCount);
      for (let n = 0; state.activeAttack && n < 30; n++) {
        const action = actions().find(
          (a) =>
            a.can &&
            [
              "pass_battle_flash",
              "open_battle_flash",
              "resolve_battle",
              "resolve_pending_burst_check",
              "pass_stack",
            ].includes(a.kind)
        );
        expect(action, JSON.stringify(actions())).toBeDefined();
        state = applyLegalAction({ state, action: action!, ...lookups }).state;
      }
      expect(state.activeAttack).toBeNull();
      expect(state.battlesEndedThisTurn).toBe(1);
      expect(state.battleResolutionGroup).toBeNull();
      expect(state.pendingBattleEndFinalizeAttackIds).toEqual([]);
      expect(state.players.map((p) => p.lifeNormalCoreCount)).toEqual(
        lifeBefore
      );
      const resolved = state.publicDisclosures.filter(
        (p) => p.kind === "battle_resolved" && p.attackId === attackId
      );
      expect(resolved).toHaveLength(1);
      expect(
        resolved[0]!.results.filter((r) => r.kind === "life_delta")
      ).toEqual([]);
      expect(state.gameResult).toBeNull();
    });
  }
});
