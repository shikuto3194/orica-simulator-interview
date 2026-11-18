import { expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "../src";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import {
  checkAndQueueUnsealChoicesForCardEvent,
  checkAndQueueUnsealChoicesForHandIncrease,
} from "../src/mechanics/grandstone-system";
import { canMoveCoresFrom } from "../src/core/core-movability";
import { matchesCardFilter } from "../src/card/card-filter";
import { getEnterFieldCorePlacementRule } from "../src/zone/enter-field-placement-policy";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";

const SELF = "player-1";
const OTHER = "player-2";
type Probe = {
  name?: string;
  tribe?: string;
  category?: CardDefinition["printedCategory"];
  blue?: boolean;
};
// Expectations are transcribed from source text/rulings, not grandstoneData.
const profiles: {
  no: string;
  threshold: number;
  maxCount: number;
  mode: "combine" | "retain" | "charge";
  events: ("summon" | "rebirth" | "attack" | "hand_increase")[];
  yes: Probe[];
  noTargets: Probe[];
}[] = [
  {
    no: "BSTH02.7-TR03(A)",
    threshold: 3,
    maxCount: 9,
    mode: "combine",
    events: ["summon", "rebirth"],
    yes: [
      { name: "アリス邸", category: "nexus" },
      { tribe: "導魔" },
      { tribe: "動玩" },
    ],
    noTargets: [
      { tribe: "幻想" },
      { tribe: "導魔", category: "nexus" },
      { name: "アリス", category: "nexus" },
    ],
  },
  {
    no: "BSTH04-転醒R01(A)",
    threshold: 4,
    maxCount: 5,
    mode: "retain",
    events: ["hand_increase"],
    yes: [{ tribe: "楽族" }, { tribe: "冥主", category: "nexus" }],
    noTargets: [{ tribe: "幻想" }],
  },
  {
    no: "BSTH06-転醒X01(A)",
    threshold: 4,
    maxCount: 5,
    mode: "charge",
    events: ["attack"],
    yes: [{ tribe: "地霊" }],
    noTargets: [{ tribe: "幻想" }, { tribe: "地霊", category: "nexus" }],
  },
  {
    no: "BSTH07-転醒X02(A)",
    threshold: 4,
    maxCount: 5,
    mode: "charge",
    events: ["hand_increase"],
    yes: [{ tribe: "起幻", blue: true }],
    noTargets: [{ tribe: "起幻" }, { tribe: "幻想", blue: true }],
  },
];

it("創界石4面本文監査: OR条件・辞退・閾値/カウント・残置/合体/配置・解封除外の最終盤面", () => {
  for (const profile of profiles) {
    const stoneDef = ALL_CARDS.find((card) => card.cardNo === profile.no)!;
    const backDef = stoneDef.backFace as CardDefinition;
    expect(stoneDef).toBeDefined();
    const probeDef = (probe: Probe): CardDefinition => ({
      cardNo: "PRINTED-GS-PROBE",
      name: probe.name ?? "条件確認用",
      printedCategory: probe.category ?? "spirit",
      colors: [probe.blue ? "blue" : "yellow"],
      cost: 5,
      reductionSymbols: [],
      symbolColors: [],
      tribe: probe.tribe ?? "",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      textLines: [],
      effects: [],
      keywordTags: [],
    });
    const hostDef = {
      ...probeDef({ tribe: "導魔", name: "合体用", category: "spirit" }),
      cardNo: "PRINTED-GS-HOST",
    };
    const observerDef = {
      ...stoneDef,
      cardNo: "PRINTED-GS-OBSERVER",
      grandstoneData: {
        ...stoneDef.grandstoneData!,
        unsealConditions: [
          {
            events: ["rebirth" as const],
            cardFilter: { nameContains: ["操り糸"] },
          },
        ],
      },
    };
    const nonExcludedFront = {
      ...stoneDef,
      cardNo: "PRINTED-GS-NONEXCLUDED",
      grandstoneData: {
        ...stoneDef.grandstoneData!,
        rebirthExcludedFromUnseal: false,
      },
    };
    let currentProbe = probeDef(profile.yes[0]!);
    const lookup = (id: string) =>
      id === stoneDef.cardNo
        ? stoneDef
        : id === backDef.cardNo
          ? backDef
          : id === hostDef.cardNo
            ? hostDef
            : id === observerDef.cardNo
              ? observerDef
              : id === nonExcludedFront.cardNo
                ? nonExcludedFront
                : id === currentProbe.cardNo
                  ? currentProbe
                  : undefined;
    const options = {
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    };
    const card = (state: GameState, id = "stone") =>
      state.cardInstances.find((candidate) => candidate.instanceId === id)!;
    const player = (state: GameState) =>
      state.players.find((candidate) => candidate.id === SELF)!;
    const pending = (state: GameState, kind: "unseal" | "stone_rebirth") =>
      state.pendingTriggeredEffects.filter(
        (entry) => entry.mechanic?.kind === kind
      );
    const initial = (
      cores: number,
      count = profile.maxCount,
      probeOwner = SELF
    ): GameState => {
      const state = createEmptyGameState({
        playerOverrides: [
          { reserveNormalCoreCount: 10, voidNormalCoreCount: 100 },
          { reserveNormalCoreCount: 10, voidNormalCoreCount: 100 },
        ],
      });
      return {
        ...state,
        step: "main",
        window: "none",
        players: state.players.map((p) =>
          p.id === SELF ? { ...p, countValue: count } : p
        ),
        cardInstances: [
          createCardInstance(stoneDef, {
            instanceId: "stone",
            ownerPlayerId: SELF,
            zone: "field",
            normalCoreCount: cores,
          }),
          createCardInstance(currentProbe, {
            instanceId: "probe",
            ownerPlayerId: probeOwner,
            zone: "field",
            normalCoreCount: 2,
          }),
          createCardInstance(hostDef, {
            instanceId: "host",
            ownerPlayerId: SELF,
            zone: "field",
            normalCoreCount: 2,
          }),
        ],
      };
    };
    const trigger = (
      state: GameState,
      event: (typeof profile.events)[number]
    ) =>
      event === "hand_increase"
        ? checkAndQueueUnsealChoicesForHandIncrease(
            state,
            SELF,
            "probe",
            lookup,
            "printed-gs:hand"
          )
        : checkAndQueueUnsealChoicesForCardEvent(
            state,
            "probe",
            event,
            lookup,
            "printed-gs:card"
          );
    const resolve = (
      state: GameState,
      kind: "unseal" | "stone_rebirth",
      accept = true
    ): GameState => {
      // A real hand increase exposes the normal burst checkpoint first.
      // Resolve that empty checkpoint through its legal action rather than
      // deleting it to reach the queued unseal.
      for (let checks = 0; checks < 10; checks++) {
        const burstCheck = [SELF, OTHER]
          .flatMap((actingPlayerId) =>
            getLegalActions({ state, actingPlayerId, ...options })
          )
          .find((a) => a.kind === "resolve_pending_burst_check");
        if (!burstCheck) break;
        state = applyLegalAction({
          state,
          action: burstCheck,
          ...options,
        }).state;
      }
      const queued = pending(state, kind);
      expect(queued).toHaveLength(1);
      const action = getLegalActions({
        state,
        actingPlayerId: SELF,
        ...options,
      }).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.pendingId === queued[0]!.pendingId
      );
      expect(action).toBeDefined();
      let next = applyLegalAction({
        state,
        action: action!,
        ...options,
        ...(accept ? {} : { skipOptionalEffect: true }),
      }).state;
      expect(Boolean(next.stackWindow)).toBe(accept);
      for (let passes = 0; next.stackWindow && passes < 10; passes++) {
        const pass = getLegalActions({
          state: next,
          actingPlayerId: next.stackWindow.priorityPlayerId,
          ...options,
        }).find((a) => a.kind === "pass_stack");
        expect(pass).toBeDefined();
        next = applyLegalAction({
          state: next,
          action: pass!,
          ...options,
        }).state;
      }
      expect(next.stackWindow).toBeNull();
      return next;
    };

    expect(getEnterFieldCorePlacementRule(stoneDef)).toBe("forbidden");
    const targetState = initial(0);
    expect(canMoveCoresFrom(targetState, card(targetState), stoneDef)).toBe(
      false
    );
    expect(
      matchesCardFilter(card(targetState), stoneDef, { category: ["nexus"] })
    ).toBe(false);
    expect(
      matchesCardFilter(card(targetState), stoneDef, {
        category: ["nexus"],
        targetsGrandwalker: true,
      })
    ).toBe(false);
    expect(
      matchesCardFilter(card(targetState), stoneDef, {
        category: ["nexus"],
        targetsGrandstone: true,
      })
    ).toBe(true);

    for (const probe of profile.noTargets) {
      currentProbe = probeDef(probe);
      for (const event of profile.events) {
        const state = trigger(initial(0), event);
        expect(
          pending(state, "unseal"),
          `${profile.no}: nonmatching target`
        ).toHaveLength(0);
        expect(card(state).normalCoreCount).toBe(0);
        expect(player(state).voidNormalCoreCount).toBe(100);
      }
    }
    for (const probe of profile.yes) {
      currentProbe = probeDef(probe);
      // Exercise the common state-delta collector as well as the matching helper.
      // Nexus placement is a different event from summon (resolved Alice ruling).
      const before = initial(0);
      const enteredFromHand = {
        ...before,
        cardInstances: before.cardInstances.map((c) =>
          c.instanceId === "probe" ? { ...c, zone: "hand" as const } : c
        ),
      };
      const collectedEntry = collectAndQueueTriggerReactions({
        beforeState: enteredFromHand,
        afterState: before,
        source: "action_resolution",
        chainId: "printed-gs:entry",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
      });
      expect(pending(collectedEntry, "unseal")).toHaveLength(
        profile.events.includes("summon") &&
          currentProbe.printedCategory === "spirit"
          ? 1
          : 0
      );
      if (profile.events.includes("hand_increase")) {
        const drawCard = createCardInstance(hostDef, {
          instanceId: "drawn",
          ownerPlayerId: SELF,
          zone: "deck",
        });
        const beforeDraw = {
          ...before,
          cardInstances: [...before.cardInstances, drawCard],
        };
        const afterDraw = {
          ...beforeDraw,
          cardInstances: beforeDraw.cardInstances.map((c) =>
            c.instanceId === "drawn" ? { ...c, zone: "hand" as const } : c
          ),
        };
        const collectedDraw = collectAndQueueTriggerReactions({
          beforeState: beforeDraw,
          afterState: afterDraw,
          source: "action_resolution",
          chainId: "printed-gs:draw",
          causedByPlayerId: SELF,
          causedBySourceInstanceId: "probe",
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: () => [],
          getRegisteredBurstActions: undefined,
        });
        expect(pending(collectedDraw, "unseal")).toHaveLength(1);
        const completed = resolve(collectedDraw, "unseal");
        expect(card(completed, "drawn").zone).toBe("hand");
        expect(card(completed).normalCoreCount).toBe(1);
        expect(player(completed).voidNormalCoreCount).toBe(99);
      }
      // Events not printed in the header (including Alice邸 placement) do not unseal.
      for (const event of [
        "summon",
        "rebirth",
        "attack",
        "hand_increase",
      ] as const) {
        if (!profile.events.includes(event))
          expect(pending(trigger(initial(0), event), "unseal")).toHaveLength(0);
      }
      for (const event of profile.events) {
        expect(
          pending(trigger(initial(0, profile.maxCount, OTHER), event), "unseal")
        ).toHaveLength(0);
        const declined = resolve(trigger(initial(0), event), "unseal", false);
        expect(card(declined).normalCoreCount).toBe(0);
        expect(player(declined).voidNormalCoreCount).toBe(100);
        expect(pending(declined, "unseal")).toHaveLength(0);
        for (const boundary of [
          { cores: 0, count: profile.maxCount, flip: false },
          { cores: profile.threshold - 1, count: profile.maxCount, flip: true },
          { cores: profile.threshold, count: profile.maxCount, flip: true },
          {
            cores: profile.threshold - 1,
            count: profile.maxCount + 1,
            flip: false,
          },
        ]) {
          let state = resolve(
            trigger(initial(boundary.cores, boundary.count), event),
            "unseal"
          );
          expect(card(state).normalCoreCount).toBe(boundary.cores + 1);
          expect(player(state).voidNormalCoreCount).toBe(99);
          expect(pending(state, "unseal")).toHaveLength(0);
          expect(pending(state, "stone_rebirth")).toHaveLength(
            boundary.flip ? 1 : 0
          );
          if (!boundary.flip) {
            expect(card(state).definitionId).toBe(profile.no);
            expect(player(state).countValue).toBe(boundary.count);
            continue;
          }
          const noFlip = resolve(state, "stone_rebirth", false);
          expect(card(noFlip).definitionId).toBe(profile.no);
          expect(card(noFlip).normalCoreCount).toBe(boundary.cores + 1);
          expect(player(noFlip).countValue).toBe(boundary.count);
          expect(player(noFlip).voidNormalCoreCount).toBe(99);
          // The Alice flip is excluded from *other* stones' unseal as well.
          if (profile.mode === "combine")
            state = {
              ...state,
              cardInstances: [
                ...state.cardInstances,
                createCardInstance(observerDef, {
                  instanceId: "observer",
                  ownerPlayerId: SELF,
                  zone: "field",
                  normalCoreCount: 0,
                }),
              ],
            };
          state = resolve(state, "stone_rebirth");
          if (profile.mode === "combine") {
            expect(card(state).definitionId).toBe(profile.no);
            expect(state.pendingStoneFlipCombine).not.toBeNull();
            const combine = getLegalActions({
              state,
              actingPlayerId: SELF,
              ...options,
            }).find(
              (a) =>
                a.kind === "resolve_brave_combine_choice" &&
                a.chosenHostInstanceId === "host"
            );
            expect(combine).toBeDefined();
            state = applyLegalAction({
              state,
              action: combine!,
              ...options,
            }).state;
            expect(card(state).attachedToInstanceId).toBe("host");
            expect(card(state, "host").attachedChildrenIds).toContain("stone");
            expect(card(state).normalCoreCount).toBe(0);
            state = checkAndQueueUnsealChoicesForCardEvent(
              state,
              "stone",
              "rebirth",
              lookup,
              "printed-gs:excluded"
            );
            expect(pending(state, "unseal")).toHaveLength(0);
            expect(card(state, "observer").normalCoreCount).toBe(0);
            // The observer would match this exact B face without the printed exclusion.
            const counterfactual = checkAndQueueUnsealChoicesForCardEvent(
              {
                ...state,
                cardInstances: state.cardInstances.map((c) =>
                  c.instanceId === "stone"
                    ? { ...c, originalDefinitionId: nonExcludedFront.cardNo }
                    : c
                ),
              },
              "stone",
              "rebirth",
              lookup,
              "printed-gs:control"
            );
            expect(pending(counterfactual, "unseal")).toHaveLength(1);
          } else if (profile.mode === "charge") {
            expect(card(state).definitionId).toBe(profile.no);
            expect(state.pendingCoreDistribution?.fromKind).toBe("any_movable");
            expect(
              Object.keys(state.pendingCoreDistribution!.sourceAvailable!)
            ).toContain("reserve");
            expect(
              Object.keys(state.pendingCoreDistribution!.sourceAvailable!)
            ).toContain("field:host");
            expect(
              Object.keys(state.pendingCoreDistribution!.sourceAvailable!)
            ).not.toContain("field:stone");
            const distribute = getLegalActions({
              state,
              actingPlayerId: SELF,
              ...options,
            }).find((a) => a.kind === "resolve_pending_core_distribution");
            expect(distribute).toBeDefined();
            const unchangedSources = applyLegalAction({
              state,
              action: distribute!,
              ...options,
              coreDistributionAllocations: { stone: 0 },
              coreDistributionSourceAllocations: {},
            }).state;
            expect(card(unchangedSources).definitionId).toBe(backDef.cardNo);
            expect(card(unchangedSources).normalCoreCount).toBe(1);
            expect(player(unchangedSources).reserveNormalCoreCount).toBe(10);
            state = applyLegalAction({
              state,
              action: distribute!,
              ...options,
              coreDistributionAllocations: { stone: 3 },
              coreDistributionSourceAllocations: {
                reserve: 2,
                "field:host": 1,
              },
            }).state;
            expect(card(state).normalCoreCount).toBe(4);
            expect(player(state).reserveNormalCoreCount).toBe(8);
            expect(card(state, "host").normalCoreCount).toBe(1);
            expect(state.pendingCoreDistribution).toBeNull();
          } else {
            expect(card(state).normalCoreCount).toBe(1);
            expect(state.pendingCoreDistribution).toBeNull();
          }
          expect(card(state).definitionId).toBe(backDef.cardNo);
          expect(card(state).zone).toBe("field");
          expect(player(state).countValue).toBe(boundary.count + 1);
          expect(player(state).voidNormalCoreCount).toBe(
            99 + boundary.cores + 1 - (profile.mode === "combine" ? 0 : 1) - 1
          );
          expect(state.pendingStoneFlipCombine).toBeNull();
          expect(pending(state, "stone_rebirth")).toHaveLength(0);
          expect(state.stackWindow).toBeNull();
        }
      }
    }
  }
});
