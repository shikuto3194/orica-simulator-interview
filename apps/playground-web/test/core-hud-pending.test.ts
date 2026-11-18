import { describe, it, expect } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  executeEffect,
  createCardInstance,
  createEmptyGameState,
  type Effect,
  buildTriggeredEffectLookup,
  applyDraftCoreMoves,
  getLegalActions,
  type GameState,
} from "@orica/rules-core";
import { buildTx01RebirthScenario } from "../src/scenario-tx01-rebirth";
import { buildCoreHudAuditScenario } from "../src/scenario-core-hud-audit";
import {
  buildPendingCoreHud,
  getPendingCoreSourceRemaining,
} from "../src/utils/core-hud-pending";
import {
  createGrabbedCoreMove,
  getFixedCoreDestination,
} from "../src/coreSelectionFacade";

const getCardDefinitionById = (id: string) =>
  ALL_CARDS.find((d) => d.cardNo === id);
const getRegisteredTriggeredEffectActions = buildTriggeredEffectLookup([
  ...ALL_CARDS,
]);
const actions = (state: GameState, actingPlayerId = "alice") =>
  getLegalActions({ state, actingPlayerId, getCardDefinitionById });
describe("コアHUD共通入力", () => {
  it("ベルのHUDは複数先への通常/ソウル配分を入力に残す", () => {
    const state = buildCoreHudAuditScenario(
      [...ALL_CARDS],
      new URLSearchParams({ kind: "bell" })
    );
    const hud = buildPendingCoreHud(state, actions(state))!;
    expect(hud.distribute).toBe(true);
    const from = { kind: "trash" as const, playerId: "alice" };
    const normal = { kind: "normal" as const, from };
    const soul = { kind: "soul" as const, from, playerId: "alice" };
    const placements = [
      createGrabbedCoreMove(
        normal,
        { kind: "reserve", playerId: "alice" },
        "card_cost"
      ),
      ...Array.from({ length: 4 }, () =>
        createGrabbedCoreMove(
          normal,
          { kind: "card", instanceId: "hud-source-a" },
          "card_cost"
        )
      ),
      createGrabbedCoreMove(
        soul,
        { kind: "card", instanceId: "hud-source-b" },
        "card_cost"
      ),
    ];
    const choice = hud.confirm(
      [...Array.from({ length: 5 }, () => normal), soul],
      { kind: "reserve", playerId: "alice" },
      placements
    );
    expect(choice.payload.summonCostCoreMoveAllocations).toHaveLength(6);
    const after = applyLegalAction({
      state,
      action: choice.action,
      ...choice.payload,
      getCardDefinitionById,
    }).state;
    expect(
      after.cardInstances.find((c) => c.instanceId === "hud-source-a")
        ?.normalCoreCount
    ).toBe(5);
    expect(
      after.cardInstances.find((c) => c.instanceId === "hud-source-b")
        ?.soulCoreCount
    ).toBe(1);
    expect(after.pendingMultiPlacement).not.toBeNull();
  });
  for (const chosenKind of ["normal", "soul"] as const)
    it(
      "最低残存1のカードから通常/ソウルを合計1個まで選ぶ: " + chosenKind,
      () => {
        const effect: Effect = {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: {
                  kind: "field_card",
                  player: "self",
                  filter: { category: ["spirit"] },
                },
                to: { kind: "this_card" },
                amount: 2,
              },
            },
          ],
        };
        const baseDefinition = getCardDefinitionById("BSTH01-C04")!;
        const definition = {
          ...baseDefinition,
          cardNo: "HUD-CAP",
          effects: [effect],
        };
        const lookup = (id: string) =>
          id === definition.cardNo ? definition : getCardDefinitionById(id);
        const state = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            createCardInstance(definition, {
              instanceId: "destination",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            }),
            createCardInstance(baseDefinition, {
              instanceId: "protected",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
              soulCoreCount: 1,
            }),
            createCardInstance(baseDefinition, {
              instanceId: "other",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 2,
            }),
          ],
          playerOverrides: [
            {
              reserveSoulCoreCount: 0,
              soulCoreLocation: { kind: "card", instanceId: "protected" },
            },
            {},
          ],
        });
        state.activeContinuousEffects = [
          {
            effectId: "minimum",
            sourceInstanceId: "destination",
            sourceDefinitionId: definition.cardNo,
            actingPlayerId: "alice",
            duration: { scope: "permanent" },
            createdAtTurn: 0,
            createdAtAttackId: null,
            modifierTag: "cannot_reduce_cores_below",
            targetInstanceId: "protected",
            metadata: { source: "all", coreMinimum: 1 },
          },
        ];
        const pending = executeEffect({
          chainId: "test:core-hud-pending:158",
          state,
          effect,
          effectIndex: 0,
          sourceInstanceId: "destination",
          actingPlayerId: "alice",
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: () => [],
          allowPendingCoreSourceAllocation: true,
        });
        expect(
          pending.pendingCoreSourceAllocation?.candidates.find(
            (c) => c.instanceId === "protected"
          )
        ).toMatchObject({
          available: 1,
          normalAvailable: 1,
          hasSoulCore: true,
        });
        const hud = buildPendingCoreHud(
          pending,
          getLegalActions({
            state: pending,
            actingPlayerId: "alice",
            getCardDefinitionById: lookup,
          })
        )!;
        const selected = [
          {
            kind: chosenKind,
            from: hud.sources.find((c) => c.id === "protected")!.from,
            playerId: "alice",
          },
        ];
        expect(
          getPendingCoreSourceRemaining(hud, selected, "protected", "normal")
        ).toBe(0);
        expect(
          getPendingCoreSourceRemaining(hud, selected, "protected", "soul")
        ).toBe(0);
        expect(
          getPendingCoreSourceRemaining(hud, selected, "other", "normal")
        ).toBeGreaterThan(0);
        const choice = hud.confirm(
          [
            ...selected,
            {
              kind: "normal",
              from: hud.sources.find((c) => c.id === "other")!.from,
            },
          ],
          hud.destination
        );
        const moved = applyLegalAction({
          state: pending,
          action: choice.action,
          ...choice.payload,
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: () => [],
        }).state;
        expect(moved.pendingCoreSourceAllocation).toBeNull();
        expect(
          moved.cardInstances.find((c) => c.instanceId === "protected")
        ).toMatchObject({
          normalCoreCount: chosenKind === "soul" ? 1 : 0,
          soulCoreCount: chosenKind === "soul" ? 0 : 1,
        });
        expect(
          moved.cardInstances.find((c) => c.instanceId === "destination")
        ).toMatchObject({
          normalCoreCount: chosenKind === "soul" ? 2 : 3,
          soulCoreCount: chosenKind === "soul" ? 1 : 0,
        });
      }
    );
  for (const owner of ["alice", "bob"])
    for (const useSoul of [false, true])
      it(
        owner +
          "の効果コストをリザーブから選び、プレビューと実支払いを一致させる: " +
          useSoul,
        () => {
          let state = buildTx01RebirthScenario(
            [...ALL_CARDS],
            new URLSearchParams({ owner, payment: "mixed" })
          );
          state.players = state.players.map((p) =>
            p.id === owner
              ? {
                  ...p,
                  reserveNormalCoreCount: 16,
                  reserveSoulCoreCount: 1,
                  trashSoulCoreCount: 0,
                  soulCoreLocation: { kind: "reserve" },
                }
              : p
          );
          const action = actions(state, owner).find(
            (a) =>
              a.kind === "resolve_pending_step_optional_choice" &&
              a.choice === "execute"
          )!;
          state = applyLegalAction({
            state,
            action,
            getCardDefinitionById,
            getRegisteredTriggeredEffectActions,
          }).state;
          const hud = buildPendingCoreHud(state, actions(state, owner));
          expect(hud).not.toBeNull();
          const reserve = hud!.sources.find(
            (s) => s.id === "reserve:" + owner
          )!;
          expect(reserve.from).toEqual({ kind: "reserve", playerId: owner });
          const cores = Array.from({ length: 3 }, (_, i) => ({
            kind: useSoul && i === 0 ? ("soul" as const) : ("normal" as const),
            from: reserve.from,
            playerId: owner,
          }));
          const preview = applyDraftCoreMoves(
            state,
            cores.map((c) =>
              createGrabbedCoreMove(c, hud!.destination!, "card_cost")
            ),
            getCardDefinitionById
          );
          const choice = hud!.confirm(cores, hud!.destination);
          expect(choice.payload).toEqual({
            coreSourceAllocations: { reserve: useSoul ? 2 : 3 },
            ...(useSoul ? { coreSourceSoulCoreInstanceId: "reserve" } : {}),
          });
          const paid = applyLegalAction({
            state,
            action: choice.action,
            ...choice.payload,
            getCardDefinitionById,
            getRegisteredTriggeredEffectActions,
          }).state;
          expect(paid.pendingCoreSourceAllocation).toBeNull();
          expect(paid.pendingCoreDistribution).not.toBeNull();
          for (const current of [preview, paid])
            expect(current.players.find((p) => p.id === owner)).toMatchObject({
              reserveNormalCoreCount: useSoul ? 14 : 13,
              reserveSoulCoreCount: useSoul ? 0 : 1,
            });
        }
      );
  for (const owner of ["alice", "bob"])
    it(owner + "のリンクエイドをHUDの選択から支払い、魂状態を離れる", () => {
      const state = buildCoreHudAuditScenario(
        [...ALL_CARDS],
        new URLSearchParams({ owner })
      );
      const pending = buildPendingCoreHud(state, actions(state, owner))!;
      expect(pending.sources.map((s) => s.id)).toEqual([
        "hud-source-a",
        "hud-source-b",
      ]);
      const selected = pending.confirm(
        [{ kind: "normal", from: pending.sources[1]!.from }],
        pending.destination
      );
      const after = applyLegalAction({
        state,
        ...selected.payload,
        action: selected.action,
        getCardDefinitionById,
      }).state;
      expect(
        after.cardInstances.find((c) => c.instanceId === "hud-source-b")!
          .normalCoreCount
      ).toBe(1);
      expect(
        after.players.find((p) => p.id === owner)!.soulStateInstanceIds
      ).not.toContain("hud-target");
      expect(after.pendingCoreDistribution).not.toBeNull();
    });
  it("R01フラッシュ召喚は配置先1枚で、通常/ソウルともgrabで同じdraftを作る", () => {
    const state = buildCoreHudAuditScenario(
      [...ALL_CARDS],
      new URLSearchParams({ kind: "flash" })
    );
    const pending = state.pendingMultiPlacement!;
    expect(pending.targets).toHaveLength(1);
    const to = getFixedCoreDestination(
      pending.targets.map((t) => ({ kind: "card", instanceId: t.instanceId }))
    )!;
    expect(to).toEqual({ kind: "card", instanceId: "hud-target" });
    expect(
      createGrabbedCoreMove(
        { kind: "normal", from: { kind: "reserve", playerId: "alice" } },
        to,
        "placement"
      )
    ).toMatchObject({ purpose: "placement", to, amount: 1 });
    expect(
      createGrabbedCoreMove(
        {
          kind: "soul",
          from: { kind: "reserve", playerId: "alice" },
          playerId: "alice",
        },
        to,
        "placement"
      )
    ).toMatchObject({ purpose: "placement", to, kind: "soul" });
    expect(
      getFixedCoreDestination([to, { kind: "card", instanceId: "second" }])
    ).toBeNull();
  });
});
