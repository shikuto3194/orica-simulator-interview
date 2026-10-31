import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  useAttackAsAction,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type Effect,
  type LegalAction,
  type GameState,
} from "../src";
import type { TargetSpec } from "../src/dsl-types";

// 02 スタック窓 / 04 待機解除: 応答の実移動を完了してから応答元を解決する。
const spirit: CardDefinition = {
  cardNo: "STACK-LEAVER",
  name: "離脱対象",
  printedCategory: "spirit",
  cost: 0,
  colors: ["red"],
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  keywordTags: [],
  textLines: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const target: TargetSpec = {
  kind: "filter",
  player: "opponent",
  filter: { category: ["spirit"] },
  count: 1,
};
const leaveActions: Effect["steps"][number]["action"][] = [
  { kind: "destroy", target },
  { kind: "vanish", target },
  { kind: "bounce", target },
  { kind: "send_to_deck", target, position: "bottom" },
  { kind: "remove_from_game", target },
];

function setup(
  action: Effect["steps"][number]["action"],
  options: { attack?: boolean; reaction?: boolean } = {}
) {
  const source: CardDefinition = {
    ...spirit,
    cardNo: "STACK-SOURCE",
    name: "応答元",
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  };
  if (options.reaction)
    source.effects!.push({
      timing: { kind: "card_event", event: "leave_field" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 2 } },
      ],
    });
  const response: CardDefinition = {
    ...spirit,
    cardNo: "STACK-RESPONSE",
    name: "応答",
    printedCategory: "magic",
    effects: [
      {
        timing: { kind: "activated", mode: "stack" },
        steps: [{ action }],
      },
    ],
  };
  const cards = [spirit, source, response];
  const lookups = {
    getCardDefinitionById: (id: string) => cards.find((c) => c.cardNo === id),
    getRegisteredMagicActions: buildMagicLookup(cards),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(cards),
    getRegisteredBurstActions: buildBurstEffectLookup(cards),
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 5 },
        { reserveNormalCoreCount: 5 },
      ],
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
        createCardInstance(response, {
          instanceId: "response",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
    }),
    step: options.attack ? "attack" : "main",
    turnNumber: 2,
  };
  const act = (
    kind: LegalAction["kind"],
    payload: Partial<Parameters<typeof applyLegalAction>[0]> = {},
    choice?: string
  ) => {
    const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    );
    const selected = actions.find(
      (a) =>
        a.kind === kind &&
        a.can &&
        (choice === undefined || ("choice" in a && a.choice === choice))
    );
    expect(
      selected,
      JSON.stringify({
        kind,
        actions,
        leaves: state.pendingLeaveEntities,
        log: state.log.slice(-8),
      })
    ).toBeDefined();
    state = applyLegalAction({
      state,
      action: selected!,
      ...lookups,
      ...payload,
    }).state;
  };
  return { act, state: () => state };
}

describe("スタック応答の離脱完了境界", () => {
  for (const action of leaveActions) {
    it.each([false, true])(
      `${action.kind}: 対象選択を延期=%sでも応答元を解決する前に実移動`,
      (deferred) => {
        const s = setup(action);
        s.act("use_field_card_effect");
        s.act("use_magic", deferred ? {} : { targetInstanceIds: ["source"] });
        s.act("pass_stack");
        if (deferred)
          s.act("resolve_pending_effect_target", {
            targetInstanceIds: ["source"],
          });
        expect(
          s.state().cardInstances.find((c) => c.instanceId === "source")?.zone
        ).not.toBe("field");
        expect(s.state().pendingLeaveEntities).toHaveLength(0);
        expect(s.state().pendingStackCascade).toBeNull();
        expect(s.state().players[0]?.countValue).toBe(0);
      }
    );
  }
  for (const attack of [false, true]) {
    it.each([false, true])(
      `移動先選択を伴う応答: 宣言前窓=${attack}、離脱誘発=%s`,
      (reaction) => {
        const s = setup(
          { kind: "bounce", target, destination: "hand_or_set_aside_choice" },
          { attack, reaction }
        );
        s.act(attack ? "attack" : "use_field_card_effect");
        s.act("use_magic");
        s.act(attack ? "pass_pre_declaration_stack" : "pass_stack");
        s.act("resolve_pending_effect_target", {
          targetInstanceIds: ["source"],
        });
        expect(s.state().pendingZoneSelection).not.toBeNull();
        expect(s.state().players[0]?.countValue).toBe(0);
        expect(s.state().activeAttack).toBeNull();
        s.act("resolve_pending_zone_selection", {
          selectedZoneCardIds: ["source"],
          zoneSelectionDestinationByCardId: { source: "hand" },
        });
        if (reaction) {
          expect(
            s.state().cardInstances.find((c) => c.instanceId === "source")?.zone
          ).toBe("field");
          expect(s.state().players[0]?.countValue).toBe(0);
          s.act("resolve_pending_triggered_effect");
          s.act("pass_stack");
        }
        expect(
          s.state().cardInstances.find((c) => c.instanceId === "source")?.zone
        ).toBe("hand");
        expect(s.state().players[0]?.countValue).toBe(reaction ? 2 : 0);
        expect(s.state().pendingLeaveEntities).toHaveLength(0);
        expect(s.state().pendingStackCascade).toBeNull();
        expect(s.state().activeAttack).toBeNull();
      }
    );
  }
});

it.each(["hand", "set_aside"] as const)(
  "幽々子の導技に隠岐奈の神技で%sへ戻したカードは導技の対象に残らない",
  (destination) => {
    const cards = [...ALL_CARDS, spirit];
    const getDef = (id: string) => cards.find((c) => c.cardNo === id);
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: buildMagicLookup(cards),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(cards),
      getRegisteredBurstActions: buildBurstEffectLookup(cards),
    };
    const card = (
      no: string,
      instanceId: string,
      ownerPlayerId: string,
      cores: number
    ) =>
      createCardInstance(getDef(no)!, {
        instanceId,
        ownerPlayerId,
        zone: "field",
        normalCoreCount: cores,
      });
    let state = useAttackAsAction({
      ...lookups,
      sourceInstanceId: "attacker",
      actingPlayerId: "alice",
      state: rebuildContinuousEffectsFromField(
        {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            playerOverrides: [
              { reserveNormalCoreCount: 10 },
              { reserveNormalCoreCount: 10 },
            ],
            cardInstances: [
              card(spirit.cardNo, "attacker", "alice", 1),
              card("BSTH04-X01", "yuyuko", "alice", 4),
              card("BSTH11-X01", "okina", "bob", 6),
              {
                ...card("BSTH11-R02", "leaver", "bob", 1),
                exhaustState: "exhausted",
              },
              {
                ...card("BSTH11-R02", "survivor", "bob", 1),
                exhaustState: "exhausted",
              },
            ],
          }),
          step: "attack",
          turnNumber: 2,
        },
        getDef
      ),
    });
    const act = (
      kind: LegalAction["kind"],
      payload: Partial<Parameters<typeof applyLegalAction>[0]> = {},
      source?: string
    ) => {
      const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...lookups })
      );
      const selected = actions.find(
        (a) =>
          a.kind === kind &&
          a.can &&
          (source === undefined ||
            ("sourceInstanceId" in a && a.sourceInstanceId === source))
      );
      expect(
        selected,
        JSON.stringify({
          kind,
          actions,
          leaves: state.pendingLeaveEntities,
          log: state.log.slice(-8),
        })
      ).toBeDefined();
      state = applyLegalAction({
        state,
        action: selected!,
        ...lookups,
        ...payload,
      }).state;
    };
    act("pass_pre_declaration_stack");
    act("open_battle_flash");
    act("pass_battle_flash");
    act("use_divine_skill", {}, "yuyuko");
    act("use_divine_skill", {}, "okina");
    act("pass_battle_flash");
    act("resolve_core_source_allocation", {
      coreSourceAllocations: { okina: 2 },
    });
    act("resolve_pending_step_optional_target_selection", {
      targetInstanceIds: ["leaver"],
    });
    expect(state.pendingEffectTargetSelection).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "yuyuko")
        ?.normalCoreCount
    ).toBe(4);
    act("resolve_pending_zone_selection", {
      selectedZoneCardIds: ["leaver"],
      zoneSelectionDestinationByCardId: { leaver: destination },
    });
    expect(
      state.cardInstances.find((c) => c.instanceId === "leaver")?.zone,
      JSON.stringify({
        leaves: state.pendingLeaveEntities,
        target: state.pendingEffectTargetSelection,
        log: state.log.slice(-15),
      })
    ).toBe(destination);
    expect(state.pendingEffectTargetSelection?.candidateInstanceIds).toEqual([
      "survivor",
    ]);
    expect(state.pendingLeaveEntities).toHaveLength(0);
    act("resolve_pending_effect_target", { targetInstanceIds: ["survivor"] });
    expect(
      state.cardInstances.find((c) => c.instanceId === "survivor")?.zone
    ).toBe("trash");
    expect(
      state.cardInstances.find((c) => c.instanceId === "leaver")?.zone
    ).toBe(destination);
    expect(state.pendingStackCascade).toBeNull();
    expect(state.pendingLeaveEntities).toHaveLength(0);
  }
);
