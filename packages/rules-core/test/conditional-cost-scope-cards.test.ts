import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  flushPendingLeaves,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  type CardDefinition,
  type Effect,
  type GameState,
  type ApplyLegalActionOptions,
} from "../src";
import { generateActionInputChoices } from "../src/action-input-choices";
import { finishCoreChoices } from "./helpers/core-choice-driver";
import { getOrCreateCombatBattleEntity } from "../src/battle/battle-shared";

// This tests the changed clause payloads, not their timing/level qualification.
// A place-event envelope isolates each printed clause through the real generated
// registration and public decline path. Steps, choices and connectors are kept
// intact. The natural deployment path for Makai has its own end-to-end regression.
const cases: [string, string][] = [
  ["BSAZ01-C03", "effects[1]"],
  ["BSAZ01-C07", "effects[3]"],
  ["BSAZ01-CX01", "effects[2]"],
  ["BSDB01-C10", "effects[1]"],
  ["BSFT01-C03", "effects[3]"],
  ["BSFT01-TR06(B)", "effects[0]"],
  ["BSGE01-M01", "effects[0]"],
  ["BSGE01-M02", "effects[0]"],
  ["BSGE01-M03", "effects[0]"],
  ["BSGE01-M04", "effects[0]"],
  ["BSGE01-TX01(B)", "effects[2]"],
  ["BSGE01-TX02(B)", "effects[2]"],
  ["BSGE01-TX03(A)", "effects[2]"],
  ["BSGE01-TX03(B)", "effects[2]"],
  ["BSGE01-TX04(B)", "effects[2]"],
  ["BSLH01-C01", "effects[1]"],
  ["BSLH01-C03", "effects[1]"],
  ["BSLH01-M01", "effects[1]"],
  ["BSLH01-R01", "effects[1]"],
  ["BSLH01-R03", "effects[1]"],
  ["BSLH01-X05", "effects[0]"],
  ["BSSA01-転醒X04(B)", "effects[0]"],
  ["BSSG01-C07", "effects[2]"],
  ["BSTH001-C04", "effects[1]"],
  ["BSTH001-C06", "effects[3]"],
  ["BSTH001-R01", "effects[1]"],
  ["BSTH002-C01", "effects[0]"],
  ["BSTH002-R02", "effects[5]"],
  ["BSTH002-R03", "effects[2]"],
  ["BSTH002-転醒R01(A)", "effects[2]"],
  ["BSTH003-C33", "effects[2]"],
  ["BSTH003-R01", "effects[1]"],
  ["BSTH003-R02", "effects[1]"],
  ["BSTH01-C12", "effects[1]"],
  ["BSTH01-R21", "effects[0]"],
  ["BSTH01-X04", "effects[0]"],
  ["BSTH01-XX02", "effects[1]"],
  ["BSTH02-C21", "effects[0]"],
  ["BSTH02-M01", "effects[1]"],
  ["BSTH02.7-TR01(A)", "effects[1]"],
  ["BSTH03-R02", "effects[2]"],
  ["BSTH04-C01", "effects[2]"],
  ["BSTH04-C02", "effects[2]"],
  ["BSTH05-C13", "effects[1]"],
  ["BSTH06-C04", "effects[1]"],
  ["BSTH07-C01", "effects[1]"],
  ["BSTH07-C02", "effects[1]"],
  ["BSTH07-R02", "effects[1]"],
  ["BSTH07.8-C01", "effects[1]"],
  ["BSTH07.8-C02", "effects[1]"],
  ["BSTH07.8-M01", "effects[1]"],
  ["BSTH08-C02", "effects[1]"],
  ["BSTH08-C03", "effects[1]"],
  ["BSTH08-R01", "effects[0]"],
  ["BSTH08-XX01", "grandwalkerData.divineSkills[0].effects[0]"],
  ["BSTH08.5-R13", "effects[0]"],
  ["BSTH09-C01", "effects[0]"],
  ["BSTH09-C02", "effects[0]"],
  ["BSTH09.2-C02", "effects[1]"],
];
const originals = expandCardDefinitionsWithBackFaces(ALL_CARDS);
function at<T>(object: unknown, path: string): T {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce((o, k) => (o as Record<string, unknown>)?.[k], object) as T;
}
const resourceView = (s: GameState) => ({
  effects: s.activeContinuousEffects,
  cards: s.cardInstances.map(
    ({ pendingLeaveLvSnapshot: _cache, ...card }) => card
  ),
  players: s.players,
  usage: s.effectUsageRecords,
});
function fixture(no: string, path: string) {
  const original = originals.find((c) => c.cardNo === no)!;
  const printed = at<Effect>(original, path);
  const effect: Effect = {
    ...printed,
    timing: { kind: "card_event", event: "place" },
    condition: undefined,
    applicability: undefined,
    timingScope: undefined,
    inline: undefined,
    textRef: [], // Header-derived source roles are qualification, not payload.
  };
  const source: CardDefinition = {
    ...originals.find((c) => c.cardNo === "BSTH001-C01")!,
    cardNo: no,
    name: original.name,
    cost: 6,
    textLines: original.textLines,
    effects: [effect],
  };
  // R21's unqualified result also sees its host. Preserve the printed Nexus
  // category so the synthetic registration does not invent self-destruction.
  if (no === "BSTH01-R21") {
    source.printedCategory = original.printedCategory;
    source.levelDefs = original.levelDefs;
  }
  const colors: CardDefinition["colors"] = [
    "red",
    "purple",
    "green",
    "white",
    "yellow",
    "blue",
  ];
  const support: CardDefinition = {
    ...originals.find((c) => c.cardNo === "BSTH001-C01")!,
    cardNo: "SCOPE-SUPPORT",
    name: "ルーシィ チルノ ENIGMA",
    colors,
    tribe:
      "幻想・装者・錬金術師・冥主・CB・神喰・GE・妖精・起幻・封魔・導魔・面霊",
    cost: 1,
    quartzData: originals.find((c) => c.quartzData)?.quartzData,
    quartzHostData: originals.find((c) => c.cardNo === "BSLH01-CX01")!
      .quartzHostData,
    effects: [],
  };
  const nexus: CardDefinition = {
    ...originals.find((c) => c.cardNo === "BSTH01-XX01")!,
    cardNo: "SCOPE-NEXUS",
    name: "アリス 隠岐奈 レーナ",
    colors,
    tribe: "幻想・導界者・創界神・妖精・起幻・導魔・地霊・CB",
    effects: [],
  };
  const magic: CardDefinition = {
    ...support,
    cardNo: "SCOPE-MAGIC",
    printedCategory: "magic",
    tribe: "地球",
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
      {
        timing: { kind: "activated", mode: "stack" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
  if (no === "BSLH01-R01") {
    support.textLines = ["Lv1『このスピリットの召喚時』", "1枚ドローする。"];
    support.effects = [
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        textRef: [0, 1],
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ];
  }
  const definitions = [source, support, nexus, magic];
  const getCardDefinitionById = (id: string) =>
    definitions.find((c) => c.cardNo === id) ??
    originals.find((c) => c.cardNo === id);
  const card = (
    def: CardDefinition,
    id: string,
    zone: "field" | "hand" | "deck" | "trash" | "set_aside",
    owner = "alice",
    cores = 1
  ) =>
    createCardInstance(def, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: zone === "field" ? cores : 0,
    });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 12,
          lifeNormalCoreCount: 5,
          voidNormalCoreCount: 20,
          countValue: 5,
          handCount: 2,
          deckCount: 8,
        },
        { reserveNormalCoreCount: 3, lifeNormalCoreCount: 5, handCount: 4 },
      ],
      cardInstances: [
        card(source, "source", "field", "alice", 2),
        card(support, "ally", "field"),
        card(nexus, "guide", "field", "alice", 8),
        card(magic, "field-magic", "field"),
        card(support, "enemy", "field", "bob", 3),
        card(nexus, "enemy-guide", "field", "bob", 3),
        card(support, "hand-cost-0", "hand"),
        card(support, "hand-cost-1", "hand"),
        ...Array.from({ length: 4 }, (_, i) =>
          card(support, `opponent-hand-${i}`, "hand", "bob")
        ),
        card(nexus, "trash-nexus", "trash"),
        ...Array.from({ length: 8 }, (_, i) =>
          card(i === 0 ? nexus : support, `deck-${i}`, "deck")
        ),
      ],
    }),
    activePlayerId: "alice",
    step: "main",
    turnNumber: 4,
  };
  if (no === "BSDB01-C10")
    state.cardInstances.find((c) => c.instanceId === "ally")!.exhaustState =
      "exhausted";
  if (no === "BSLH01-C01")
    state.cardInstances.find((c) => c.instanceId === "source")!.exhaustState =
      "recovered";
  if (no === "BSGE01-TX02(B)")
    state.cardInstances.find((c) => c.instanceId === "enemy")!.exhaustState =
      "exhausted";
  if (no === "BSFT01-C03" || no === "BSLH01-R01") {
    state.cardInstances.find((c) => c.instanceId === "ally")!.zoneRoleName =
      "soul_state";
    state.players[0]!.soulStateInstanceIds = ["ally"];
  }
  if (no === "BSTH002-R02") {
    state.cardInstances.find(
      (c) => c.instanceId === "source"
    )!.pendingLeaveKind = "destroy";
    state.pendingLeaveEntities = [
      {
        instanceId: "source",
        kind: "destroy",
        cause: "opponent_effect",
        causePlayerId: "bob",
        chainId: `scope:${no}`,
        deferZoneMoveUntilChainEnd: true,
        leaveFieldCoreDestinationOverride: null,
      },
    ];
  }
  if (["BSTH001-C06", "BSTH003-C33"].includes(no)) {
    const c = state.cardInstances.find((c) => c.instanceId === "enemy")!;
    state.battleEntities = [
      {
        ...getOrCreateCombatBattleEntity({
          state,
          sourceCard: c,
          sourceDefinition: support,
          getCardDefinitionById,
        }),
        attackState: "blocking",
      },
    ];
  }
  if (no === "BSAZ01-C03") {
    const c = state.cardInstances.find((c) => c.instanceId === "source")!;
    const entity = {
      ...getOrCreateCombatBattleEntity({
        state,
        sourceCard: c,
        sourceDefinition: source,
        getCardDefinitionById,
      }),
      attackState: "attacking" as const,
    };
    state.battleEntities = [entity];
    state.step = "attack";
    state.activeAttack = {
      attackId: "scope-battle",
      primaryEntityId: entity.entityId,
      participantEntityIds: [entity.entityId],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    };
  }
  const lookups = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([source]),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  const run = (
    before: GameState,
    extra: Partial<Parameters<typeof executeEffect>[0]> = {}
  ) =>
    executeEffect({
      state: before,
      effect,
      effectIndex: 0,
      chainId: `scope:${no}`,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      ...lookups,
      ...extra,
    });
  const queue = (before: GameState) =>
    queuePendingReactionsFromTriggerEvents(
      before,
      [
        {
          actingPlayerId: "alice",
          eventKind: "place",
          source: "action_resolution",
          chainId: `scope:${no}:place`,
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "source",
          amount: null,
        },
      ],
      undefined,
      lookups
    );
  const settle = (before: GameState) => {
    let current = before;
    for (let n = 0; n < 80; n++) {
      current = finishCoreChoices(current, getCardDefinitionById, lookups);
      const offered = ["alice", "bob"].flatMap((actingPlayerId) =>
        getLegalActions({ state: current, actingPlayerId, ...lookups })
      );
      const action =
        offered.find(
          (a) =>
            a.kind === "resolve_pending_step_optional_choice" &&
            a.choice === "execute"
        ) ??
        offered.find(
          (a) =>
            a.kind === "resolve_pending_step_optional_choice" &&
            a.choice === "decline"
        ) ??
        offered.find((a) =>
          [
            "pass_stack",
            "pass_pre_declaration_stack",
            "resolve_pending_zone_selection",
            "resolve_pending_count_decrease",
            "resolve_pending_effect_target",
            "resolve_pending_step_optional_target_selection",
            "resolve_pending_step_choice",
            "resolve_pending_deck_reveal_pick",
            "resolve_pending_deck_reveal_order",
            "resolve_borrowed_effect_choice",
            "resolve_borrowed_effect_target",
            "resolve_core_source_allocation",
            "resolve_pending_core_shoot",
          ].includes(a.kind)
        );
      if (!action) return flushPendingLeaves(current, getCardDefinitionById);
      const choices = generateActionInputChoices(
        current,
        action,
        { getCardDefinitionById },
        256
      ).values;
      if (
        action.kind === "resolve_pending_step_optional_choice" &&
        choices.length === 0
      )
        choices.push({});
      // Prefer an explicit nonempty selection to exercise the paid/result branch.
      const score = (v: Partial<ApplyLegalActionOptions>) =>
        Object.values(v).reduce<number>(
          (s, x) => s + (Array.isArray(x) ? x.length : 0),
          0
        );
      const input = choices.sort((a, b) => score(b) - score(a))[0]!;
      current = applyLegalAction({
        state: current,
        action,
        ...lookups,
        ...input,
      }).state;
    }
    throw new Error(`${no}: clause continuation did not settle`);
  };
  return { state, effect, printed, lookups, queue, run, settle };
}
function assertPayoff(no: string, before: GameState, after: GameState) {
  const card = (id: string) =>
    after.cardInstances.find((c) => c.instanceId === id)!;
  const alice = after.players[0]!;
  const draw: Record<string, number> = {
    "BSGE01-TX03(A)": 3,
    "BSSG01-C07": 2,
    "BSTH001-C04": 1,
    "BSTH001-R01": 1,
    "BSTH002-C01": 1,
    "BSTH002-転醒R01(A)": 1,
    "BSTH003-R02": 1,
    "BSTH05-C13": 4,
    "BSTH06-C04": 1,
    "BSTH08-R01": 2,
    "BSTH09.2-C02": 1,
  };
  if (draw[no] !== undefined) {
    expect(alice.deckCount).toBe(8 - draw[no]!);
    const discarded = ["BSGE01-TX03(A)", "BSSG01-C07", "BSTH002-転醒R01(A)"];
    if (discarded.includes(no)) {
      expect(card("hand-cost-1").zone).toBe("trash");
      expect(alice.handCount).toBe(1 + draw[no]!);
    } else if (no === "BSTH05-C13") {
      expect(card("hand-cost-0").zone).toBe("trash");
      expect(card("hand-cost-1").zone).toBe("trash");
      expect(alice.handCount).toBe(4);
    } else if (no === "BSTH002-C01") {
      expect(card("hand-cost-0").zone).toBe("set_aside");
      expect(alice.handCount).toBe(2);
    } else expect(alice.handCount).toBe(2 + draw[no]!);
    if (
      [
        "BSTH001-C04",
        "BSTH003-R02",
        "BSTH06-C04",
        "BSTH08-R01",
        "BSTH09.2-C02",
      ].includes(no)
    )
      expect(card("source").exhaustState).toBe("exhausted");
    if (no === "BSTH001-R01") expect(alice.reserveNormalCoreCount).toBe(11);
    return;
  }
  const reveal: Record<string, number> = {
    "BSTH07.8-C01": 3,
    "BSTH07.8-C02": 3,
    "BSTH07.8-M01": 7,
    "BSTH08-C02": 3,
    "BSTH08-C03": 3,
    "BSTH09-C01": 4,
    "BSTH09-C02": 4,
  };
  if (reveal[no] !== undefined) {
    expect(card("source").exhaustState).toBe("exhausted");
    expect(
      after.publicDisclosures.find((d) => d.kind === "deck_revealed")?.targets
    ).toHaveLength(reveal[no]!);
    expect(after.pendingDeckReveal).toBeNull();
    if (no === "BSTH07.8-M01") {
      expect(card("source").normalCoreCount).toBe(4);
      expect(alice.voidNormalCoreCount).toBe(18);
    }
    return;
  }
  const ce = (tag: string) =>
    after.activeContinuousEffects.filter((e) => e.modifierTag === tag);
  switch (no) {
    case "BSAZ01-C03":
      expect(card("hand-cost-0").zone).toBe("removed_from_game");
      expect(card("hand-cost-1").zone).toBe("removed_from_game");
      expect(after.pendingBattleEndDeferrals).toHaveLength(1);
      break;
    case "BSAZ01-C07":
      expect(card("ally").zone).toBe("trash");
      expect(card("enemy").zone).toBe("trash");
      break;
    case "BSAZ01-CX01":
      expect(alice.reserveNormalCoreCount).toBe(11);
      expect(alice.deckCount).toBe(7);
      expect(alice.handCount).toBe(3);
      break;
    case "BSDB01-C10":
      expect(card("ally").exhaustState).toBe("recovered");
      expect(ce("life_damage_interception")).toHaveLength(1);
      break;
    case "BSFT01-C03":
      expect(alice.reserveNormalCoreCount).toBe(10);
      expect(alice.soulStateInstanceIds).not.toContain("ally");
      expect(after.turnSummonedCardRefs).toContainEqual(
        expect.objectContaining({ instanceId: "ally" })
      );
      break;
    case "BSFT01-TR06(B)":
      expect(alice.reserveNormalCoreCount).toBe(11);
      expect(card("enemy").exhaustState).toBe("exhausted");
      break;
    case "BSGE01-M01":
    case "BSGE01-M02":
    case "BSGE01-M03":
    case "BSGE01-M04":
      expect(alice.countValue).toBe(4);
      expect(card("source").zone).toBe("hand");
      break;
    case "BSGE01-TX01(B)":
    case "BSGE01-TX04(B)":
      expect(alice.countValue).toBe(4);
      expect(card("enemy").zone).toBe("trash");
      break;
    case "BSGE01-TX02(B)":
      expect(alice.countValue).toBe(4);
      expect(card("enemy").zone).toBe("deck");
      break;
    case "BSGE01-TX03(B)":
      expect(alice.countValue).toBe(4);
      expect(card("enemy").normalCoreCount).toBe(2);
      expect(after.players[1]!.reserveNormalCoreCount).toBe(4);
      break;
    case "BSLH01-C01":
      expect(card("source").exhaustState).toBe("exhausted");
      expect(alice.countValue).toBe(6);
      break;
    case "BSLH01-C03":
      expect(card("ally").exhaustState).toBe("exhausted");
      expect(card("source").zone).toBe("trash");
      break;
    case "BSLH01-M01":
      expect(alice.reserveNormalCoreCount).toBe(11);
      expect(card("enemy").normalCoreCount).toBe(2);
      break;
    case "BSLH01-R01":
      expect(card("source").exhaustState).toBe("exhausted");
      expect(after.quartzSetStates).toContainEqual(
        expect.objectContaining({
          quartzInstanceId: "hand-cost-1",
          hostInstanceId: "ally",
        })
      );
      expect(alice.deckCount).toBe(7);
      break;
    case "BSLH01-R03":
    case "BSLH01-X05":
      expect(alice.lifeNormalCoreCount).toBe(4);
      expect(alice.reserveSoulCoreCount).toBe(1);
      break;
    case "BSSA01-転醒X04(B)":
      expect(card("source").exhaustState).toBe("heavily_exhausted");
      expect(ce("prevent_battle_attack")).toContainEqual(
        expect.objectContaining({ targetInstanceId: "enemy" })
      );
      break;
    case "BSTH001-C06":
    case "BSTH003-C33":
    case "BSTH01-X04":
      expect(alice.reserveNormalCoreCount).toBe(11);
      expect(card("enemy").zone).toBe("trash");
      break;
    case "BSTH002-R02":
      expect(card("source").pendingLeaveKind).toBeNull();
      expect(card("source").zone).toBe("field");
      expect(alice.deckCount).toBe(6);
      break;
    case "BSTH002-R03":
    case "BSTH07-C01":
    case "BSTH07-C02":
      expect(card("source").exhaustState).toBe("exhausted");
      expect(alice.reserveNormalCoreCount).toBe(13);
      break;
    case "BSTH003-R01":
      expect(card("source").exhaustState).toBe("exhausted");
      expect(card("trash-nexus").zone).toBe("field");
      break;
    case "BSTH01-C12":
      expect(alice.lifeNormalCoreCount).toBe(4);
      expect(ce("symbol_addition")).toHaveLength(1);
      expect(ce("symbol_addition")[0]).toMatchObject({
        modifierSymbol: ["red", "purple"],
        modifierSymbolCount: 2,
      });
      break;
    case "BSTH01-R21":
      expect(card("source").exhaustState).toBe("exhausted");
      expect(card("enemy").zone).toBe("trash");
      break;
    case "BSTH01-XX02":
      expect(card("guide").normalCoreCount).toBe(4);
      expect(card("source").normalCoreCount).toBe(6);
      expect(card("enemy").zone).toBe("trash");
      break;
    case "BSTH02-C21":
      expect(ce("draw_modify")).toHaveLength(1);
      expect(ce("draw_modify")[0]?.modifierAmount).toBe(2);
      break;
    case "BSTH02-M01":
      expect(card("hand-cost-1").zone).toBe("trash");
      expect(after.extraTurnState).toMatchObject({
        ownerPlayerId: "alice",
        skipSteps: ["core", "attack"],
      });
      break;
    case "BSTH02.7-TR01(A)":
      expect(card("guide").normalCoreCount).toBe(7);
      expect(alice.deckCount).toBe(7);
      expect(alice.handCount).toBe(3);
      break;
    case "BSTH03-R02":
      expect(alice.reserveNormalCoreCount).toBe(11);
      expect(ce("gate_flash_stack_hand_discard")).toHaveLength(1);
      break;
    case "BSTH04-C01":
    case "BSTH04-C02":
      expect(card("source").exhaustState).toBe("exhausted");
      expect(
        ce(no.endsWith("C01") ? "negate_summon" : "negate_place")
      ).toHaveLength(1);
      break;
    case "BSTH07-R02":
      expect(card("source").exhaustState).toBe("exhausted");
      expect(ce("prevent_battle_attack")).toHaveLength(1);
      break;
    case "BSTH08-XX01":
      expect(card("trash-nexus").zone).toBe("removed_from_game");
      expect(ce("life_damage_interception")).toHaveLength(1);
      break;
    case "BSTH08.5-R13":
      expect(alice.reserveNormalCoreCount).toBe(10);
      expect(card("enemy-guide").normalCoreCount).toBe(0);
      break;
    default:
      throw new Error(`Missing printed payoff assertion for ${no}`);
  }
  expect(resourceView(after)).not.toEqual(resourceView(before));
}
describe.each(cases)("%s %s ことで optional scope payload", (no, path) => {
  it("decline through the generated public registration changes neither cards/resources nor usage", () => {
    const f = fixture(no, path);
    expect(f.printed.executionMode).toBe("optional");
    expect(f.effect.steps).toBe(f.printed.steps);
    const ready =
      no === "BSTH002-R02"
        ? {
            ...f.state,
            pendingLeaveEntities: [],
            cardInstances: f.state.cardInstances.map((c) => ({
              ...c,
              pendingLeaveKind: null,
            })),
          }
        : f.state;
    const queued = f.queue(ready);
    const action = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...f.lookups,
    }).find((a) => a.kind === "resolve_pending_triggered_effect");
    expect(
      action,
      JSON.stringify({
        pending: queued.pendingTriggeredEffects,
        registered: f.lookups.getRegisteredTriggeredEffectActions(no),
      })
    ).toMatchObject({ executionMode: "optional" });
    const after = applyLegalAction({
      state: queued,
      action: action!,
      ...f.lookups,
      skipOptionalEffect: true,
    }).state;
    expect(resourceView(after)).toEqual(resourceView(queued));
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });
  it("execute completes the native clause and produces its printed result", () => {
    const f = fixture(no, path);
    const after = f.settle(
      f.run(
        f.state,
        no === "BSAZ01-C03"
          ? { targetInstanceIds: ["hand-cost-0", "hand-cost-1"] }
          : no === "BSSA01-転醒X04(B)" || no === "BSTH01-R21"
            ? {
                targetInstanceIds: ["enemy"],
                targetStepId: f.effect.steps[1]!.id ?? "__step_1",
              }
            : no === "BSAZ01-C07" || no === "BSDB01-C10"
              ? { targetInstanceIds: ["ally"], targetStepId: "__step_0" }
              : no === "BSLH01-M01"
                ? { choiceIndex: 1 }
                : {}
      )
    );
    assertPayoff(no, f.state, after);
  });
  it("unavailable payoff does not execute just its cost", () => {
    const f = fixture(no, path);
    // Unconditional modifier payoffs cannot have target shortage. A real
    // nullified declaration supplies the impossible-result counterexample.
    if (
      [
        "BSDB01-C10",
        "BSLH01-R03",
        "BSLH01-X05",
        "BSTH01-C12",
        "BSTH02-C21",
        "BSTH03-R02",
        "BSTH04-C01",
        "BSTH04-C02",
        "BSTH08-XX01",
      ].includes(no)
    ) {
      const queued = f.queue(f.state);
      const action = getLegalActions({
        state: queued,
        actingPlayerId: "alice",
        ...f.lookups,
      }).find(
        (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
      )!;
      expect(action).toBeDefined();
      const declared = applyLegalAction({
        state: queued,
        action,
        ...f.lookups,
      }).state;
      expect(declared.stackWindow?.pendingStackAction).toBeDefined();
      const nullified = {
        ...declared,
        stackWindow: {
          ...declared.stackWindow!,
          pendingStackAction: {
            ...declared.stackWindow!.pendingStackAction!,
            isNullified: true,
          },
        },
      };
      const after = f.settle(nullified);
      expect(resourceView(after)).toEqual(resourceView(declared));
      return;
    }
    const unavailable = structuredClone(f.state);
    // Result-specific counterexamples keep the printed cost resources present.
    const drawCards = [
      "BSGE01-TX03(A)",
      "BSSG01-C07",
      "BSTH001-C04",
      "BSTH001-R01",
      "BSTH002-C01",
      "BSTH002-転醒R01(A)",
      "BSTH003-R02",
      "BSTH05-C13",
      "BSTH06-C04",
      "BSTH07.8-C01",
      "BSTH07.8-C02",
      "BSTH07.8-M01",
      "BSTH08-C02",
      "BSTH08-C03",
      "BSTH08-R01",
      "BSTH09-C01",
      "BSTH09-C02",
      "BSTH09.2-C02",
    ];
    if (drawCards.includes(no)) {
      unavailable.cardInstances = unavailable.cardInstances.filter(
        (c) => c.zone !== "deck"
      );
      unavailable.players[0]!.deckCount = 0;
    } else if (
      ["BSGE01-M01", "BSGE01-M02", "BSGE01-M03", "BSGE01-M04"].includes(no)
    ) {
      unavailable.cardInstances.find((c) => c.instanceId === "source")!.zone =
        "hand";
    } else {
      unavailable.cardInstances = unavailable.cardInstances.filter(
        (c) => c.ownerPlayerId !== "bob" || c.zone !== "field"
      );
    }
    if (no === "BSAZ01-CX01")
      unavailable.cardInstances = unavailable.cardInstances.filter(
        (c) => c.instanceId !== "field-magic"
      );
    if (no === "BSFT01-C03") {
      unavailable.players[0]!.soulStateInstanceIds = [];
      unavailable.cardInstances = unavailable.cardInstances.filter(
        (c) => c.zone !== "trash" && c.zoneRoleName !== "soul_state"
      );
    }
    if (
      no === "BSLH01-C01" ||
      no === "BSTH07-C01" ||
      no === "BSTH07-C02" ||
      no === "BSTH002-R03"
    )
      unavailable.players[0]!.voidNormalCoreCount = 0;
    if (no === "BSLH01-C03")
      unavailable.cardInstances.find((c) => c.instanceId === "source")!.zone =
        "hand";
    if (no === "BSLH01-R01")
      unavailable.cardInstances = unavailable.cardInstances.filter(
        (c) => !c.instanceId.startsWith("hand-cost")
      );
    if (no === "BSTH003-R01")
      unavailable.cardInstances = unavailable.cardInstances.filter(
        (c) => c.zone !== "trash"
      );
    if (no === "BSTH02.7-TR01(A)") {
      unavailable.cardInstances = unavailable.cardInstances.filter(
        (c) => c.zone !== "deck"
      );
      unavailable.players[0]!.deckCount = 0;
    }
    if (no === "BSTH02-M01")
      unavailable.cardInstances = unavailable.cardInstances.filter(
        (c) => !c.instanceId.startsWith("hand-cost")
      );
    if (no === "BSTH002-R02") {
      unavailable.pendingLeaveEntities = [];
      unavailable.cardInstances.find(
        (c) => c.instanceId === "source"
      )!.pendingLeaveKind = null;
    }
    if (no === "BSTH07.8-M01") unavailable.players[0]!.voidNormalCoreCount = 0;
    if (no === "BSTH01-R21") {
      // No eligible result on either side; removing only Bob's field is not
      // an impossible payoff when the printed text also permits Alice's ally.
      unavailable.cardInstances = unavailable.cardInstances.filter(
        (card) => card.instanceId !== "ally"
      );
    }
    const after = f.settle(f.run(unavailable));
    expect(resourceView(after), after.log.join("\n")).toEqual(
      resourceView(unavailable)
    );
  });
});
