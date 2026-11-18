import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveBp,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { Action, CardDefinition, Effect, GameState } from "../src";
import { getCandidateTargetInstanceIds } from "../src/legal/legal-actions-shared";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getDef = (id: string) => definitions.get(id);
const nexus = getDef("BSSA01-転醒X04(A)")!;
const patchouli = getDef("BSTH01-M01")!;
const placeEffect = nexus.effects!.find(
  (effect) =>
    effect.timing.kind === "card_event" && effect.timing.event === "place"
)!;

function board(source: CardDefinition = nexus): GameState {
  return rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      step: "main",
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        ...["immune", "vulnerable"].map((instanceId) =>
          createCardInstance(patchouli, {
            instanceId,
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
            exhaustState: instanceId === "immune" ? "recovered" : "exhausted",
          })
        ),
      ],
    },
    getDef
  );
}

describe("効果耐性の対象候補と実行の共通判定", () => {
  it("最古の金木犀の配置時: 回復パチュリーを候補から除外し、疲労パチュリーだけをBP0破壊する", () => {
    const state = board();
    const registration = buildTriggeredEffectLookup([nexus])(
      nexus.cardNo
    )!.find(
      (entry) => entry.effectIndex === nexus.effects!.indexOf(placeEffect)
    )!;
    expect(registration).toBeDefined();
    expect(
      getCandidateTargetInstanceIds(state, "alice", registration, {
        sourceInstanceId: "source",
        getCardDefinitionById: getDef,
      })
    ).toEqual(["vulnerable"]);
    const after = executeEffect({
      chainId: "test:effect-immunity-target-candidates:67",
      state,
      effect: placeEffect,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      targetInstanceIds: ["vulnerable"],
    });
    const immune = after.cardInstances.find(
      (card) => card.instanceId === "immune"
    )!;
    expect(immune).toMatchObject({ zone: "field", pendingLeaveKind: null });
    expect(getEffectiveBp(after, immune, patchouli)).toBe(6000);
    const vulnerable = after.cardInstances.find(
      (card) => card.instanceId === "vulnerable"
    )!;
    expect(
      vulnerable.zone !== "field" || vulnerable.pendingLeaveKind === "destroy"
    ).toBe(true);
  });

  const target = {
    kind: "filter",
    player: "opponent",
    filter: { category: ["spirit"] },
    count: 1,
  } as const;
  it.each([
    ["相手の通常効果", "alice", "none", "opponent", ["vulnerable"]],
    [
      "相手の防げない効果",
      "alice",
      "unpreventable",
      "opponent",
      ["immune", "vulnerable"],
    ],
    ["自分の通常効果", "bob", "none", "opponent", ["immune", "vulnerable"]],
    [
      "一切の効果を受けない対象への自分の効果",
      "bob",
      "none",
      "any",
      ["vulnerable"],
    ],
  ] as const)(
    "%s: 候補と作用が一致する",
    (_label, actor, preventionLevel, scope, expected) => {
      const base = board();
      const state = {
        ...base,
        cardInstances: base.cardInstances.map((card) =>
          card.instanceId === "source"
            ? { ...card, ownerPlayerId: actor, controllerPlayerId: actor }
            : card
        ),
        activeContinuousEffects: base.activeContinuousEffects.map((ce) =>
          ce.modifierTag === "defense_immune"
            ? { ...ce, immunityPlayerScope: scope }
            : ce
        ),
      };
      expect(
        getCandidateTargetInstanceIds(
          state,
          actor,
          {
            candidateTargetZones: ["field"],
            candidateTargetPlayerScope: "any",
            targetCardFilter: { category: ["spirit"] },
            preventionLevel,
          },
          { sourceInstanceId: "source", getCardDefinitionById: getDef }
        )
      ).toEqual(expected);
      const after = executeEffect({
        chainId: "test:effect-immunity-target-candidates:141",
        state,
        effect: {
          ...placeEffect,
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: { ...target, player: "either", count: "all" },
                amount: -1000,
                duration: { scope: "turn" },
              },
            },
          ],
        },
        sourceInstanceId: "source",
        actingPlayerId: actor,
        getCardDefinitionById: getDef,
        sourcePreventionLevel: preventionLevel,
      });
      for (const id of ["immune", "vulnerable"]) {
        const card = after.cardInstances.find(
          (entry) => entry.instanceId === id
        )!;
        expect(getEffectiveBp(after, card, patchouli)).toBe(
          expected.some((candidate) => candidate === id) ? 5000 : 6000
        );
      }
    }
  );

  it("選択後に一方が耐性を得ても、選択済みの他方へのBP変更を解決する", () => {
    const base = board();
    const beforeSelection = rebuildContinuousEffectsFromField(
      {
        ...base,
        activeContinuousEffects: [],
        cardInstances: base.cardInstances.map((card) =>
          card.instanceId === "immune"
            ? { ...card, exhaustState: "exhausted" }
            : card
        ),
      },
      getDef
    );
    const selectedTargetInstanceIds = getCandidateTargetInstanceIds(
      beforeSelection,
      "alice",
      {
        candidateTargetZones: ["field"],
        candidateTargetPlayerScope: "opponent",
        targetCardFilter: { category: ["spirit"] },
      },
      { sourceInstanceId: "source", getCardDefinitionById: getDef }
    );
    expect(selectedTargetInstanceIds).toEqual(["immune", "vulnerable"]);
    const state = rebuildContinuousEffectsFromField(
      {
        ...beforeSelection,
        cardInstances: beforeSelection.cardInstances.map((card) =>
          card.instanceId === "immune"
            ? { ...card, exhaustState: "recovered" }
            : card
        ),
      },
      getDef
    );
    const after = executeEffect({
      chainId: "test:effect-immunity-target-candidates:208",
      state,
      effect: {
        ...placeEffect,
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: { ...target, count: 2 },
              amount: -1000,
              duration: { scope: "turn" },
            },
          },
        ],
      },
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      targetInstanceIds: selectedTargetInstanceIds,
    });
    expect(
      getEffectiveBp(
        after,
        after.cardInstances.find((card) => card.instanceId === "immune")!,
        patchouli
      )
    ).toBe(6000);
    expect(
      getEffectiveBp(
        after,
        after.cardInstances.find((card) => card.instanceId === "vulnerable")!,
        patchouli
      )
    ).toBe(5000);
  });
  const actions: Action[] = [
    { kind: "bp_modify", target, amount: -6000, duration: { scope: "turn" } },
    { kind: "destroy", target },
    { kind: "bounce", target },
    { kind: "send_to_deck", target, position: "bottom" },
    { kind: "exhaust", target },
    {
      kind: "prevent_battle",
      target,
      restriction: ["attack"],
      duration: { scope: "turn" },
    },
  ];
  it.each([false, true])(
    "提供元のカテゴリ耐性を途中選択へ伝える (optional=%s)",
    (optional) => {
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            ...(optional
              ? { executionMode: "optional" as const }
              : { targetSelectionTiming: "on_step" as const }),
            action: {
              kind: "bp_modify",
              target,
              amount: -1000,
              duration: { scope: "turn" },
            },
          },
        ],
      };
      const host: CardDefinition = {
        ...nexus,
        cardNo: "TEST-IMMUNITY-HOST",
        effects: [effect],
      };
      const provider: CardDefinition = {
        ...nexus,
        cardNo: "TEST-IMMUNITY-PROVIDER",
        printedCategory: "magic",
        effects: [],
      };
      const lookups = {
        getCardDefinitionById: (id: string) =>
          id === host.cardNo
            ? host
            : id === provider.cardNo
              ? provider
              : getDef(id),
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: () => undefined,
      };
      const base = board(host);
      const state: GameState = {
        ...base,
        cardInstances: [
          ...base.cardInstances.map((card) =>
            card.instanceId === "source"
              ? {
                  ...card,
                  underCards: [
                    {
                      cardInstanceId: "provider",
                      role: "text_role" as const,
                      roleTag: "test",
                    },
                  ],
                }
              : card
          ),
          {
            ...createCardInstance(provider, {
              instanceId: "provider",
              ownerPlayerId: "alice",
              zone: "field",
            }),
            attachedToInstanceId: "source",
          },
          {
            ...base.cardInstances.find(
              (card) => card.instanceId === "vulnerable"
            )!,
            instanceId: "vulnerable-2",
          },
        ],
        activeContinuousEffects: base.activeContinuousEffects.map((ce) =>
          ce.modifierTag === "defense_immune"
            ? { ...ce, immunitySourceScope: { categories: ["magic"] } }
            : ce
        ),
      };
      let after = executeEffect({
        chainId: "test:effect-immunity-target-candidates:335",
        state,
        effect,
        effectIndex: 0,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        effectSourceInstanceId: "provider",
        effectSourceDefinitionId: provider.cardNo,
        ...lookups,
      });
      if (optional) {
        const action = getLegalActions({
          state: after,
          actingPlayerId: "alice",
          ...lookups,
        }).find(
          (entry) =>
            entry.kind === "resolve_pending_step_optional_choice" &&
            entry.choice === "execute"
        );
        expect(action).toBeDefined();
        after = applyLegalAction({
          state: after,
          action: action!,
          ...lookups,
        }).state;
      }
      expect(
        after.pendingStepOptionalTargetSelection?.candidateInstanceIds
      ).toEqual(["vulnerable", "vulnerable-2"]);
    }
  );
  it.each(actions)(
    "$kind のon_step対象選択でも回復パチュリーを除外する",
    (action) => {
      const state = board();
      // exhaust は正常な回復状態の候補も用意する。
      const normalDef = { ...patchouli, cardNo: "TEST-NORMAL", effects: [] };
      const getDefinition = (id: string) =>
        id === normalDef.cardNo ? normalDef : getDef(id);
      const normal = createCardInstance(normalDef, {
        instanceId: "normal",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [{ targetSelectionTiming: "on_step", action }],
      };
      const after = executeEffect({
        chainId: "test:effect-immunity-target-candidates:385",
        state: {
          ...state,
          cardInstances: [
            ...state.cardInstances,
            normal,
            { ...normal, instanceId: "normal-2" },
          ],
        },
        effect,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: getDefinition,
      });
      expect(
        after.pendingStepOptionalTargetSelection?.candidateInstanceIds
      ).not.toContain("immune");
      expect(
        after.pendingStepOptionalTargetSelection?.candidateInstanceIds
      ).toContain("normal");
    }
  );
});
