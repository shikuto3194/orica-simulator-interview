import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type ApplyLegalActionOptions,
  type CardDefinition,
  type Effect,
  type GameState,
  type LegalAction,
} from "../src";
import { queueBattleEndTriggers } from "../src/effect/trigger-system";
import { pendingResolutionContexts } from "../src/chain-id";

function spirit(cardNo: string, effects: Effect[] = []): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    keywordTags: [],
    textLines: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  };
}

const routes = [
  "distribution",
  "disclosure",
  "redirect",
  "life-discard",
  "life-gain",
  "life-use",
  "core-shoot",
] as const;
type Route = (typeof routes)[number];

// 02d: 前段→派生→前段の実離脱→後段。同時発揮群の外側へはその後に戻る。
// 合成本文で各中断入口を比較し、最後の盤面と途中の選択権の両方を検査する。
describe("中断後も原因と本文を保持する", () => {
  for (const owner of ["alice", "bob"]) {
    for (const battle of [false, true]) {
      it(`${owner} battle=${battle} コア除去の反復3回を終えてから本文を再開する`, () => {
        run({
          owner,
          battle,
          route: "core-shoot",
          after: true,
          outer: battle,
          repeat: true,
        });
      });
      for (const route of routes) {
        for (const after of [false, true]) {
          it(`${owner} battle=${battle} ${route} after=${after}`, () => {
            run({ owner, battle, route, after, outer: false });
          });
          if (battle)
            it(`${owner} 外側待機 ${route} after=${after}`, () => {
              run({ owner, battle, route, after, outer: true });
            });
          if (route === "core-shoot")
            for (const cores of [1, "soul"] as const)
              it(`${owner} battle=${battle} core-shoot=${cores} after=${after}`, () => {
                run({ owner, battle, route, after, outer: battle, cores });
              });
        }
      }
    }
  }
});

function run({
  owner,
  battle,
  route,
  after,
  outer,
  cores = 0,
  repeat = false,
}: {
  owner: string;
  battle: boolean;
  route: Route;
  after: boolean;
  outer: boolean;
  cores?: 0 | 1 | "soul";
  repeat?: boolean;
}) {
  const opponent = owner === "alice" ? "bob" : "alice";
  const prefix: Effect["steps"][number] = {
    ...(repeat ? { repeat: { additional: 2 } } : {}),
    action:
      route === "distribution"
        ? {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: { kind: "self" },
            amount: 1,
            mode: "player_choice",
            minTotal: 1,
          }
        : route === "core-shoot"
          ? {
              kind: "core_move",
              from: { kind: "field", player: "opponent" },
              to: { kind: "trash", player: "opponent" },
              amount: { min: 0, max: 1 },
            }
          : route.startsWith("life-")
            ? {
                kind: "core_move",
                from:
                  route === "life-gain"
                    ? { kind: "reserve", player: "self" }
                    : { kind: "life", player: "opponent" },
                to:
                  route === "life-gain"
                    ? { kind: "life", player: "self" }
                    : { kind: "reserve", player: "opponent" },
                amount: 1,
              }
            : {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
  };
  const effect: Effect = {
    timing: { kind: "card_event", event: "battle_end" },
    steps: [
      prefix,
      { action: { kind: "count_decrease", player: "self", amount: 1 } },
      {
        ...(after ? { connector: "after_triggers" as const } : {}),
        action: { kind: "draw", count: 1 },
      },
    ],
  };
  const source = spirit("SOURCE", [effect]);
  const watcher = spirit("WATCHER", [
    {
      timing: { kind: "game_event", event: "count_decrease", player: "self" },
      executionMode: "optional",
      steps: [
        { action: { kind: "draw", count: 1 } },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 3 },
        },
      ],
    },
  ]);
  const victim = spirit(
    "VICTIM",
    route === "disclosure"
      ? [
          {
            timing: { kind: "game_event", event: "targeted", player: "self" },
            executionMode: "optional",
            steps: [
              { action: { kind: "count_increase", player: "self", amount: 1 } },
            ],
          },
        ]
      : []
  );
  const filler = spirit("FILLER");
  const sibling = spirit("SIBLING", [
    {
      timing: { kind: "card_event", event: "battle_end" },
      steps: [{ action: { kind: "draw", count: 4 } }],
    },
  ]);
  const interceptor: CardDefinition = structuredClone(
    ALL_CARDS.find(
      (d) =>
        d.cardNo ===
        (route === "life-gain"
          ? "BSTH02.7-X03"
          : route === "life-use"
            ? "BSLH01-M05"
            : "BSTH02.7-C05")
    )!
  );
  // 防止マジックそのもののカウント操作と、元本文の再開を分離する。
  if (route === "life-use")
    interceptor.effects![2] = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 0 } },
      ],
    };
  const definitions = [source, watcher, victim, filler, sibling, interceptor];
  const lookups = {
    getCardDefinitionById: (id: string) =>
      definitions.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
  };
  const attackId = "continuation:attack:1";
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        countValue: id === owner ? 3 : 0,
        reserveNormalCoreCount: 3,
      })),
      cardInstances: [
        ...(outer
          ? [
              createCardInstance(sibling, {
                instanceId: "sibling",
                ownerPlayerId: owner,
                zone: "field",
                cores: 1,
              }),
            ]
          : []),
        ...(route.startsWith("life-")
          ? [
              createCardInstance(interceptor, {
                instanceId: "interceptor",
                ownerPlayerId: route === "life-gain" ? owner : opponent,
                zone: route === "life-gain" ? "field" : "hand",
                cores: 3,
              }),
            ]
          : []),
        createCardInstance(source, {
          instanceId: "source",
          ownerPlayerId: owner,
          zone: "field",
          cores: 1,
        }),
        createCardInstance(watcher, {
          instanceId: "watcher",
          ownerPlayerId: owner,
          zone: "field",
          cores: 1,
        }),
        createCardInstance(victim, {
          instanceId: "victim",
          ownerPlayerId: opponent,
          zone: "field",
          cores: 1,
        }),
        createCardInstance(filler, {
          instanceId: "other",
          ownerPlayerId: opponent,
          zone: "field",
          cores: 1,
        }),
        ...Array.from({ length: 8 }, (_, i) =>
          createCardInstance(filler, {
            instanceId: `deck-${i}`,
            ownerPlayerId: owner,
            zone: "deck",
          })
        ),
      ],
    }),
    activePlayerId: owner,
    step: "attack",
    window: battle ? "battle_resolution" : "flash_before_block",
    ...(battle ? { pendingBattleEndFinalizeAttackIds: [attackId] } : {}),
  };
  if (route === "life-gain") {
    const index = interceptor.effects!.findIndex((e) =>
      e.steps.some((s) => s.action.kind === "life_gain_replacement")
    );
    state = executeEffect({
      state,
      effect: interceptor.effects![index]!,
      effectIndex: index,
      sourceInstanceId: "interceptor",
      actingPlayerId: owner,
      chainId: "registration:root",
      ...lookups,
    });
  }
  if (route === "redirect")
    state.activeContinuousEffects = [
      {
        effectId: "redirect",
        sourceInstanceId: "victim",
        sourceDefinitionId: victim.cardNo,
        actingPlayerId: opponent,
        duration: { scope: "permanent" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        modifierTag: "redirect_effect_target",
        metadata: {
          triggerCondition: {
            sourcePlayerRef: "opponent",
            protectedTargetKind: "instances",
            protectedInstanceIds: ["victim"],
          },
          redirectCandidateSource: { kind: "explicit", instanceIds: ["other"] },
          optional: true,
        },
      },
    ];
  if (cores === "soul")
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === opponent
          ? {
              ...p,
              reserveSoulCoreCount: 0,
              soulCoreLocation: { kind: "card", instanceId: "victim" },
            }
          : p
      ),
    };
  if (battle)
    state = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        {
          effectId: "continuation-battle-lifetime",
          sourceInstanceId: "source",
          sourceDefinitionId: source.cardNo,
          actingPlayerId: owner,
          duration: { scope: "battle" },
          createdAtTurn: state.turnNumber,
          createdAtAttackId: attackId,
          modifierTag: "effect_immunity",
          targetInstanceId: "source",
        },
      ],
    };
  const actions = () =>
    [owner, opponent]
      .flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...lookups })
      )
      .filter((a) => a.can);
  const act = (
    action: LegalAction,
    extra: Partial<ApplyLegalActionOptions> = {}
  ) => {
    state = applyLegalAction({ state, action, ...lookups, ...extra }).state;
  };
  if (battle) {
    state = queueBattleEndTriggers({
      state,
      participantInstanceIds: outer ? ["source", "sibling"] : ["source"],
      attackId,
      ...lookups,
    });
    if (outer)
      act(
        actions().find(
          (a) =>
            a.kind === "select_pending_to_resolve" &&
            a.sourceInstanceId === "source"
        )!
      );
    act(
      actions().find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "source"
      )!
    );
    act(actions().find((a) => a.kind === "pass_stack")!);
  } else
    state = executeEffect({
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "source",
      actingPlayerId: owner,
      chainId: "normal:outer:child",
      ...lookups,
    });
  const pendingSelection = () =>
    state.pendingCoreDistribution ??
    state.pendingTargetedDisclosureContinuation ??
    state.pendingTargetRedirects[0] ??
    state.pendingLifeDamageDiscardChoice ??
    state.pendingLifeGainReplacementChoice ??
    state.pendingCoreShootSelection ??
    state.pendingEffectTargetSelection;
  let seen = false;
  let maximum = 0;
  let outerResolved = false;
  let shootSelections = 0;
  for (let guard = 0; guard < 50; guard++) {
    if (pendingSelection() && !seen) {
      seen = true;
      state = JSON.parse(JSON.stringify(state)) as GameState;
    }
    const decreases = state.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "count_decrease"
    );
    maximum = Math.max(maximum, decreases.length);
    const current = actions();
    const count = state.players.find((p) => p.id === owner)!.countValue;
    const hand = state.cardInstances.filter(
      (c) => c.ownerPlayerId === owner && c.zone === "hand"
    ).length;
    if (battle && !outerResolved && (count !== 5 || hand !== 2))
      expect(
        state.activeContinuousEffects.some(
          (e) => e.effectId === "continuation-battle-lifetime"
        ),
        `派生が終わるまでバトルの持続効果は残る: ${JSON.stringify({ pending: state.pendingTriggeredEffects.map((p) => ({ kind: p.eventKind, chainId: p.chainId, attackId: p.attackId })), log: state.log.slice(-12) })}`
      ).toBe(true);
    if (outer && !outerResolved && (count !== 5 || hand !== 2))
      expect(
        current.filter((a) => a.sourceInstanceId === "sibling"),
        "内側が終わるまで外側は選べない"
      ).toHaveLength(0);
    const kinds: LegalAction["kind"][] = [
      "resolve_pending_core_shoot",
      "resolve_pending_life_damage_discard_choice",
      "resolve_pending_life_gain_replacement_choice",
      "resolve_pending_core_distribution",
      "resolve_pending_effect_target",
      "decline_target_redirect",
      "select_pending_to_resolve",
      "resolve_pending_triggered_effect",
      "pass_stack",
    ];
    const action = kinds.flatMap((kind) =>
      current.filter((a) => a.kind === kind)
    )[0];
    if (!action) break;
    if (action.kind === "resolve_pending_core_shoot") shootSelections++;
    if (action.sourceInstanceId === "sibling") outerResolved = true;
    act(action, {
      coreShootDistribution: cores === 1 ? { victim: 1 } : {},
      ...(cores === "soul" ? { coreShootSoulCoreInstanceId: "victim" } : {}),
      lifeDamageDiscardChoice: route === "life-use" ? "pay" : "decline",
      lifeGainReplacementChoice: "decline",
      ...(action.kind === "resolve_pending_core_distribution"
        ? { coreDistributionAllocations: { source: 1 } }
        : {}),
      ...(action.kind === "resolve_pending_effect_target"
        ? { targetInstanceIds: ["victim"] }
        : {}),
      ...(action.kind === "resolve_pending_triggered_effect" &&
      action.sourceInstanceId === "victim"
        ? { skipOptionalEffect: true }
        : {}),
    });
  }
  expect(seen).toBe(true);
  if (repeat) expect(shootSelections).toBe(3);
  expect(maximum).toBe(1);
  expect(state.players.find((p) => p.id === owner)!.countValue).toBe(5);
  expect(
    state.cardInstances.filter(
      (c) => c.ownerPlayerId === owner && c.zone === "hand"
    )
  ).toHaveLength(outer ? 6 : 2);
  expect(state.pendingTriggeredEffects).toHaveLength(0);
  expect(state.pendingAfterTriggersContinuations).toHaveLength(0);
  expect(state.pendingTargetedDisclosureContinuation).toBeNull();
  expect(state.pendingCoreShootSelection).toBeNull();
  if (battle)
    expect(
      state.activeContinuousEffects.some(
        (e) => e.effectId === "continuation-battle-lifetime"
      ),
      JSON.stringify(
        pendingResolutionContexts(state).map(({ path, context }) => ({
          path,
          chainId: context.chainId,
          battleEndDeferralAttackId: context.battleEndDeferralAttackId,
        }))
      )
    ).toBe(false);
  if (route === "core-shoot") {
    expect(
      state.cardInstances.find((c) => c.instanceId === "victim")?.zone
    ).toBe(cores === 1 ? "trash" : "field");
    if (cores === "soul")
      expect(
        state.players.find((p) => p.id === opponent)?.soulCoreLocation
      ).toEqual({ kind: "trash" });
  }
}
