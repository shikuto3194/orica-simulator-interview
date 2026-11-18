import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  recomputeAndRebuildContinuousEffects,
  sanitizeStateForViewer,
  type ApplyLegalActionOptions,
  type GameState,
  type LegalAction,
} from "../src";

const definitions = new Map(ALL_CARDS.map((d) => [d.cardNo, d]));
const getDef = (id: string) => definitions.get(id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: () => [],
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

function fixture(
  owner: string,
  sourceCount: number,
  reserveCores = 3,
  braveNo = "BSGE01-TR01(A)"
): GameState {
  const opponent = owner === "alice" ? "bob" : "alice";
  const card = (no: string, id: string, cores = 0, player = owner) =>
    createCardInstance(getDef(no)!, {
      instanceId: id,
      ownerPlayerId: player,
      zone: "field",
      normalCoreCount: cores,
    });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      { ...card("BSGE01-R01", "revived"), everHadCorePlaced: true },
      card(braveNo, "avenger"),
      ...Array.from({ length: sourceCount }, (_, i) =>
        card("BSGE01-R02", "source-" + i, 2)
      ),
      card("BSGE01-R03", "attacker", 2, opponent),
    ],
    playerOverrides: ["alice", "bob"].map((id) => ({
      id,
      reserveNormalCoreCount: reserveCores,
      reserveSoulCoreCount: 0,
      soulCoreLocation: null,
      soulStateInstanceIds: id === owner ? ["revived"] : [],
    })),
  });
  return recomputeAndRebuildContinuousEffects(
    {
      ...state,
      activePlayerId: opponent,
      step: "attack",
      window: "flash_before_block",
      battleEntities: [
        {
          entityId: "attacker-entity",
          memberInstanceIds: ["attacker"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "link-aid-reaction",
        primaryEntityId: "attacker-entity",
        participantEntityIds: ["attacker-entity"],
        groupMode: "single",
        target: { kind: "player", playerId: owner },
        blockAssignments: [
          { participantEntityId: "attacker-entity", blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: ["attacker-entity"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: owner,
          consecutivePassCount: 0,
          consecutiveActiveUseCount: 0,
          stackResponseSourcePlayerId: owner,
          pendingStackAction: null,
        },
      },
    },
    getDef
  );
}
const actions = (state: GameState, owner: string) =>
  getLegalActions({ state, actingPlayerId: owner, ...lookups });
const apply = (
  state: GameState,
  action: LegalAction,
  extra: Partial<ApplyLegalActionOptions> = {}
) => applyLegalAction({ state, action, ...lookups, ...extra }).state;
function passStack(state: GameState): GameState {
  for (
    let i = 0;
    i < 8 &&
    (state.stackWindow ||
      state.activeAttack?.flashWindowState?.pendingStackAction);
    i++
  ) {
    const pass = state.players
      .flatMap((p) => actions(state, p.id))
      .find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash");
    expect(pass).toBeDefined();
    state = apply(state, pass!);
  }
  return state;
}

function resolveLink(state: GameState, owner: string): GameState {
  const link = actions(state, owner).find((a) => a.kind === "link_aid")!;
  expect(link).toBeDefined();
  state = passStack(apply(state, link));
  if (state.pendingLinkAidCostSourceChoice) {
    const choice = actions(state, owner).find(
      (a) => a.kind === "resolve_pending_link_aid_cost_source_choice"
    )!;
    expect(choice).toBeDefined();
    state = apply(state, choice);
  }

  return state;
}

describe("リンクエイドの状態化から神機の合体まで", () => {
  for (const owner of ["alice", "bob"])
    it.each([1, 2])(
      owner + ": コスト源%dか所でもTR01(A)がR01の復帰に反応する",
      (sourceCount) => {
        let state = fixture(owner, sourceCount);
        state = resolveLink(state, owner);
        expect(state.pendingCoreDistribution).not.toBeNull();
        expect(state.pendingTriggeredEffects).toHaveLength(0);
        expect(
          sanitizeStateForViewer(state, owner).pendingCoreDistribution
            ?.supplementalTriggerEvents
        ).toBeUndefined();
        // サーバー保存・復元を挟んでも配置前のイベントを保持する。
        state = JSON.parse(JSON.stringify(state)) as GameState;
        const distribute = actions(state, owner).find(
          (a) => a.kind === "resolve_pending_core_distribution"
        )!;
        expect(distribute).toBeDefined();
        state = apply(state, distribute, {
          coreDistributionAllocations: { revived: 1 },
          coreDistributionSourceAllocations: { reserve: 1 },
        });
        const reaction = actions(state, owner).find(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "avenger" &&
            !a.skipOnly
        );
        expect(reaction).toBeDefined();
        expect(
          state.pendingTriggeredEffects.filter(
            (e) => e.eventKind === "soul_state_to_spirit_state"
          )
        ).toHaveLength(1);
        expect(
          state.pendingTriggeredEffects.some((e) => e.eventKind === "summon")
        ).toBe(false);
        state = passStack(apply(state, reaction!));
        expect(
          state.cardInstances.find((c) => c.instanceId === "avenger")
            ?.attachedToInstanceId
        ).toBe("revived");
        expect(
          state.cardInstances.find((c) => c.instanceId === "revived")
            ?.attachedChildrenIds
        ).toContain("avenger");
        expect(state.players.find((p) => p.id === owner)?.countValue).toBe(0);
        expect(
          state.turnSummonedCardRefs.some((ref) => ref.instanceId === "revived")
        ).toBe(false);
      }
    );
  it.each([
    "BSGE01-C05",
    "BSGE01-C06",
    "BSGE01-C07",
    "BSGE01-C08",
    "BSGE01-TX01(A)",
    "BSGE01-TX02(A)",
    "BSGE01-TX03(A)",
    "BSGE01-TX04(A)",
  ])("%sの同型合体効果も実際の復帰で発揮する", (braveNo) => {
    let state = resolveLink(fixture("alice", 2, 3, braveNo), "alice");
    const distribute = actions(state, "alice").find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;
    state = apply(state, distribute, {
      coreDistributionAllocations: { revived: 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
    });
    const reaction = actions(state, "alice").find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "avenger" &&
        !a.skipOnly
    );
    expect(reaction).toBeDefined();
    state = passStack(apply(state, reaction!));
    expect(
      state.cardInstances.find((c) => c.instanceId === "avenger")
        ?.attachedToInstanceId
    ).toBe("revived");
  });
  it.each(["alice", "bob"])(
    "%s: 支払いで消滅待機に入った合体中C05は復帰に反応しない",
    (owner) => {
      let state = fixture(owner, 2);
      state = recomputeAndRebuildContinuousEffects(
        {
          ...state,
          cardInstances: [
            ...state.cardInstances.map((c) =>
              c.instanceId === "source-0"
                ? {
                    ...c,
                    normalCoreCount: 1,
                    attachedChildrenIds: ["waiting-brave"],
                  }
                : c
            ),
            createCardInstance(getDef("BSGE01-C05")!, {
              instanceId: "waiting-brave",
              ownerPlayerId: owner,
              zone: "field",
              attachedToInstanceId: "source-0",
            }),
          ],
        },
        getDef
      );
      state = resolveLink(state, owner);
      expect(
        state.cardInstances.find((c) => c.instanceId === "source-0")
          ?.normalCoreCount
      ).toBe(0);
      const distribute = actions(state, owner).find(
        (a) => a.kind === "resolve_pending_core_distribution"
      )!;
      state = apply(state, distribute, {
        coreDistributionAllocations: { revived: 1 },
        coreDistributionSourceAllocations: { reserve: 1 },
      });
      expect(
        state.cardInstances.find((c) => c.instanceId === "source-0")
          ?.pendingLeaveKind
      ).toBe("vanish");
      expect(
        state.cardInstances.find((c) => c.instanceId === "waiting-brave")
          ?.attachedToInstanceId
      ).toBe("source-0");
      const revivedEvent = state.pendingTriggeredEffects.find(
        (e) => e.eventKind === "soul_state_to_spirit_state"
      );
      expect(revivedEvent).toBeDefined();
      const capturedSources = Object.keys(
        revivedEvent?.relatedInstanceIdsBySourceRegistrationKey ?? {}
      );
      expect(capturedSources.some((key) => key.startsWith("avenger#"))).toBe(
        true
      );
      expect(
        capturedSources.some((key) => key.startsWith("waiting-brave#"))
      ).toBe(false);
      // 同じ効果から派生した復帰誘発を解決してからブレイヴ離脱を選ぶ (04d)。
      expect(state.pendingBraveLeaveChoice).toBeNull();
      const reaction = actions(state, owner).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "avenger" &&
          !a.skipOnly
      );
      expect(reaction).toBeDefined();
      state = passStack(apply(state, reaction!));
      expect(
        state.cardInstances.find((c) => c.instanceId === "avenger")
          ?.attachedToInstanceId
      ).toBe("revived");
      // 復帰イベント確定後の離脱処理でC05を分離しても、過去の誘発候補へ追加しない。
      const keep = actions(state, owner).find(
        (a) => a.kind === "resolve_brave_leave_choice" && a.choice === "keep"
      );
      expect(keep).toBeDefined();
      state = apply(state, keep!);
      expect(
        state.cardInstances.find((c) => c.instanceId === "waiting-brave")
          ?.attachedToInstanceId
      ).toBeNull();
      expect(
        state.cardInstances.find((c) => c.instanceId === "waiting-brave")?.zone
      ).toBe("field");
      expect(
        actions(state, owner).some(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "waiting-brave"
        )
      ).toBe(false);
      expect(
        state.pendingTriggeredEffects.some(
          (e) => e.eventKind === "soul_state_to_spirit_state"
        )
      ).toBe(false);
      expect(
        actions(state, owner).some(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "waiting-brave"
        )
      ).toBe(false);
    }
  );
  it.each([0, 3])(
    "配置可能コア%d個でも、0個配置で消滅するカードには合体反応を残さない",
    (reserveCores) => {
      let state = resolveLink(fixture("alice", 2, reserveCores), "alice");
      const distribute = actions(state, "alice").find(
        (a) => a.kind === "resolve_pending_core_distribution"
      );
      if (distribute)
        state = apply(state, distribute, {
          coreDistributionAllocations: {},
          coreDistributionSourceAllocations: {},
        });
      expect(
        state.cardInstances.find((c) => c.instanceId === "revived")?.zone
      ).toBe("trash");
      expect(
        state.pendingTriggeredEffects.some(
          (e) => e.eventKind === "soul_state_to_spirit_state"
        )
      ).toBe(false);
      expect(
        state.cardInstances.find((c) => c.instanceId === "avenger")
          ?.attachedToInstanceId
      ).toBeNull();
    }
  );
});
