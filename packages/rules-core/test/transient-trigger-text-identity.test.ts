import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  queueRegisteredBattleImmediateEffects,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";
import type { Effect } from "../src/dsl-types";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { captureTriggerObservation } from "../src/effect/trigger-observation-sources";
import {
  resolveDeferredMagicStack,
  useMagicCardInFlashContextAsAction,
} from "../src/mechanics/magic-system";
import {
  canUseEffectUsage,
  effectUsageAmount,
} from "./helpers/effect-usage-fixture";

const base: CardDefinition = {
  cardNo: "TEXT-IDENTITY-A",
  name: "本文観測境界",
  printedCategory: "nexus",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [{ level: 1, requiredCores: 0 }],
  textLines: [],
  keywordTags: [],
};
const flipSteps: Effect["steps"] = [
  {
    action: {
      kind: "rebirth",
      maxCount: 99,
      triggerDescription: "test",
      countBonusMode: "none",
    },
  },
  { action: { kind: "reverse_rebirth", mode: "flip" } },
];
const countStep: Effect["steps"][number] = {
  action: { kind: "count_increase", player: "self", amount: 1 },
};
const timing: Effect["timing"] = {
  kind: "game_event",
  event: "summon",
  player: "self",
};
const late: Effect = {
  timing,
  condition: [{ kind: "count_value", player: "self", min: 1 }],
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "void", player: "self" },
        to: { kind: "reserve", player: "self" },
        amount: 1,
      },
    },
  ],
};
function make(
  def: CardDefinition,
  id: string,
  cores = 0,
  zone: "field" | "hand" = "field"
) {
  return createCardInstance(def, {
    instanceId: id,
    ownerPlayerId: "alice",
    zone,
    normalCoreCount: cores,
  });
}
function setup(
  definitions: CardDefinition[],
  cards: ReturnType<typeof make>[]
) {
  const defs = definitions.flatMap((def) =>
    def.backFace ? [def, def.backFace] : [def]
  );
  const deps = {
    getCardDefinitionById: (id: string) =>
      defs.find((def) => def.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(defs),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredBurstActions: () => [],
  };
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
      playerOverrides: [
        { voidNormalCoreCount: 20, reserveNormalCoreCount: 0 },
        {},
      ],
    }),
    step: "main",
  };
  return { state, deps };
}
type Deps = ReturnType<typeof setup>["deps"];
function choices(state: GameState, deps: Deps) {
  return ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...deps })
  );
}
function act(state: GameState, deps: Deps, match: (a: LegalAction) => boolean) {
  const all = choices(state, deps);
  const action = all.find(match);
  expect(action, JSON.stringify(all)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...deps }).state;
}
function close(state: GameState, deps: Deps) {
  for (let i = 0; state.stackWindow && i < 12; i++)
    state = act(state, deps, (a) => a.kind === "pass_stack");
  expect(state.stackWindow).toBeNull();
  return state;
}
function isLate(a: LegalAction) {
  return (
    (a.kind === "resolve_pending_triggered_effect" ||
      a.kind === "select_pending_to_resolve") &&
    a.sourceInstanceId === "source" &&
    a.registrationIndex === 1
  );
}
function genericFixture(steps: Effect["steps"]) {
  const source: CardDefinition = {
    ...base,
    isDoubleSided: true,
    backFace: { ...base, cardNo: "TEXT-IDENTITY-B", effects: [] },
    effects: [
      { timing, usageLimit: { kind: "per_instance", duration: "turn" }, steps },
      late,
    ],
  };
  const subject: CardDefinition = {
    ...base,
    cardNo: "TEXT-IDENTITY-SUBJECT",
    printedCategory: "spirit",
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    effects: [],
  };
  const f = setup(
    [source, subject],
    [make(source, "source"), make(subject, "subject", 1)]
  );
  let state = collectAndQueueTriggerReactions({
    beforeState: f.state,
    afterState: f.state,
    source: "action_resolution",
    chainId: "text-original",
    supplementalEvents: [
      {
        eventKind: "summon",
        source: "action_resolution",
        chainId: "text-original",
        attackId: null,
        actingPlayerId: "alice",
        relatedPlayerId: "alice",
        relatedInstanceId: "subject",
        amount: null,
        observationSnapshot: captureTriggerObservation(f.state),
      },
    ],
    ...f.deps,
  });
  expect(
    state.pendingTriggeredEffects.some((p) =>
      p.dormantSourceRegistrationKeys?.includes("source#1")
    )
  ).toBe(true);
  state = act(
    state,
    f.deps,
    (a) =>
      (a.kind === "resolve_pending_triggered_effect" ||
        a.kind === "select_pending_to_resolve") &&
      a.sourceInstanceId === "source" &&
      a.registrationIndex === 0
  );
  return { state, deps: f.deps, source };
}

describe("同一本文中の面変更と誘発観測の寿命", () => {
  it("A→B→A 後に条件を満たしても古い本文を復活させず、個体/使用回数は維持する", () => {
    const f = genericFixture([...flipSteps, countStep]);
    const state = close(f.state, f.deps);
    const source = state.cardInstances.find(
      (card) => card.instanceId === "source"
    )!;
    expect(source.definitionId).toBe(f.source.cardNo);
    expect(source.effectTextGeneration).toBe(2);
    expect(source.fieldInstanceGeneration ?? 0).toBe(0);
    expect(state.players[0]!.countValue).toBe(1);
    expect(choices(state, f.deps).some(isLate)).toBe(false);
    expect(effectUsageAmount(state, "effect:0")).toBe(1);
    expect(
      canUseEffectUsage(state, {
        sourceInstanceId: "source",
        sourceDefinitionId: f.source.cardNo,
        effectLabel: "effect:0",
        usageLimit: f.source.effects![0]!.usageLimit,
        getCardDefinitionById: f.deps.getCardDefinitionById,
      })
    ).toBe(false);
  });
  it("面が変わらない条件 0→1→0→1 は本文完了後に後成立できる", () => {
    const f = genericFixture([
      countStep,
      { action: { kind: "count_decrease", player: "self", amount: 1 } },
      countStep,
    ]);
    let state = close(f.state, f.deps);
    expect(
      state.cardInstances.find((card) => card.instanceId === "source")
        ?.effectTextGeneration ?? 0
    ).toBe(0);
    expect(choices(state, f.deps).some(isLate)).toBe(true);
    state = close(act(state, f.deps, isLate), f.deps);
    expect(state.players[0]!.reserveNormalCoreCount).toBe(1);
  });
  it("B面で選択中断した正式 JSON state を再開しても古い A 面の観測は戻らない", () => {
    const f = genericFixture([
      flipSteps[0]!,
      { ...countStep, executionMode: "optional" },
      flipSteps[1]!,
    ]);
    let state = close(f.state, f.deps);
    expect(state.pendingStepOptionalChoice).not.toBeNull();
    expect(
      state.cardInstances.find((card) => card.instanceId === "source")
        ?.effectTextGeneration
    ).toBe(1);
    state = JSON.parse(JSON.stringify(state));
    state = act(
      state,
      f.deps,
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(
      state.cardInstances.find((card) => card.instanceId === "source")
    ).toMatchObject({ definitionId: f.source.cardNo, effectTextGeneration: 2 });
    expect(state.players[0]!.countValue).toBe(1);
    expect(choices(state, f.deps).some(isLate)).toBe(false);
  });
  it("同じ発揮群の導域も本文の A→B→A 後の Lv2 で古い事象を再取得しない", () => {
    const printed = ALL_CARDS.find((card) => card.cardNo === "BSTH10.5-X01")!;
    const source: CardDefinition = {
      ...printed,
      cardNo: "TEXT-DOMAIN-A",
      isDoubleSided: true,
      backFace: { ...base, cardNo: "TEXT-DOMAIN-B", effects: [] },
      grandwalkerData: { ...printed.grandwalkerData!, oracleTriggerKinds: [] },
      effects: [
        {
          timing: {
            kind: "game_event",
            event: "effect_activated",
            player: "self",
            triggerFilter: { categories: ["magic"] },
          },
          steps: [
            ...flipSteps,
            {
              action: {
                kind: "core_move",
                from: { kind: "void", player: "self" },
                to: { kind: "this_card" },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const magic: CardDefinition = {
      ...base,
      cardNo: "TEXT-DOMAIN-MAGIC",
      printedCategory: "magic",
      colors: ["blue"],
      levelDefs: [],
      keywordTags: ["stack_effect"],
      effects: [
        { timing: { kind: "activated", mode: "stack" }, steps: [countStep] },
      ],
    };
    const f = setup(
      [source, magic],
      [make(source, "source", 2), make(magic, "used", 0, "hand")]
    );
    const declared = useMagicCardInFlashContextAsAction({
      state: f.state,
      actingPlayerId: "alice",
      magicInstanceId: "used",
      chosenTiming: "stack",
      paymentSources: [],
      ...f.deps,
    });
    let state = resolveDeferredMagicStack({
      state: declared.state,
      activeStack: declared.activeStack,
      ...f.deps,
    });
    expect(
      state.pendingTriggeredEffects.some(
        (p) => p.mechanic?.kind === "magic_stack_domain" && p.dormantMechanic
      )
    ).toBe(true);
    state = close(
      act(
        state,
        f.deps,
        (a) =>
          (a.kind === "resolve_pending_triggered_effect" ||
            a.kind === "select_pending_to_resolve") &&
          a.sourceInstanceId === "source" &&
          a.registrationIndex === 0
      ),
      f.deps
    );
    expect(
      state.cardInstances.find((card) => card.instanceId === "source")
    ).toMatchObject({
      definitionId: source.cardNo,
      effectTextGeneration: 2,
      normalCoreCount: 3,
    });
    expect(
      state.pendingTriggeredEffects.some(
        (p) => p.mechanic?.kind === "magic_stack_domain"
      )
    ).toBe(false);
  });

  it.each([false, true])(
    "battle immediate: 継承=%s の元本文は A→B→A で復活しない",
    (inherited) => {
      const f = battleFixture(inherited);
      const after = executeEffect({
        state: f.state,
        actingPlayerId: "alice",
        sourceInstanceId: inherited ? "provider" : "source",
        sourceDefinitionId: inherited ? f.provider.cardNo : f.host.cardNo,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [...flipSteps, countStep],
        },
        chainId: "battle-face-body",
        ...f.deps,
      });
      const state = collectAndQueueTriggerReactions({
        beforeState: f.state,
        afterState: after,
        source: "action_resolution",
        chainId: "battle-face-body",
        ...f.deps,
      });
      expect(state.players[0]!.countValue).toBe(1);
      expect(
        state.cardInstances.find(
          (card) => card.instanceId === (inherited ? "provider" : "source")
        )?.effectTextGeneration
      ).toBe(2);
      expect(state.battleImmediateEffects).toHaveLength(0);
    }
  );
  it.each([false, true])(
    "battle immediate: 継承=%s の面不変なら条件後成立を保つ",
    (inherited) => {
      const f = battleFixture(inherited);
      const after = executeEffect({
        state: f.state,
        actingPlayerId: "alice",
        sourceInstanceId: inherited ? "provider" : "source",
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [countStep],
        },
        chainId: "battle-condition-body",
        ...f.deps,
      });
      const state = collectAndQueueTriggerReactions({
        beforeState: f.state,
        afterState: after,
        source: "action_resolution",
        chainId: "battle-condition-body",
        ...f.deps,
      });
      expect(state.battleImmediateEffects).toHaveLength(1);
      expect(
        state.battleImmediateEffects[0]?.sourceEffectInstanceId ??
          state.battleImmediateEffects[0]?.sourceInstanceId
      ).toBe(inherited ? "provider" : "source");
    }
  );
});

function battleFixture(inherited: boolean) {
  const attackEffect: Effect = {
    ...late,
    timing: { kind: "card_event", event: "attack" },
  };
  const host: CardDefinition = {
    ...base,
    cardNo: "TEXT-BATTLE-A",
    printedCategory: "spirit",
    isDoubleSided: true,
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    effects: inherited ? [] : [attackEffect],
    backFace: {
      ...base,
      cardNo: "TEXT-BATTLE-B",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      effects: [],
    },
  };
  const provider: CardDefinition = {
    ...host,
    cardNo: "TEXT-BRAVE-A",
    printedCategory: "brave",
    braveCondition: { minCost: 0 },
    textLines: [
      "【合体中】『このスピリットのアタック時』自分のカウント1以上のとき、ボイドからコア1個をリザーブに置く。",
    ],
    effects: [
      { ...attackEffect, applicability: { combined: true }, textRef: [0] },
    ],
    backFace: {
      ...base,
      cardNo: "TEXT-BRAVE-B",
      printedCategory: "brave",
      effects: [],
    },
  };
  const sourceCard = make(host, "source", 1);
  const providerCard = make(provider, "provider");
  if (inherited) {
    sourceCard.attachedChildrenIds = ["provider"];
    providerCard.attachedToInstanceId = "source";
  }
  const f = setup(
    [host, provider],
    inherited ? [sourceCard, providerCard] : [sourceCard]
  );
  const state: GameState = {
    ...f.state,
    step: "attack",
    window: "declare_attack",
    battleEntities: [
      {
        entityId: "entity",
        memberInstanceIds: inherited ? ["source", "provider"] : ["source"],
        resolvedBp: 2000,
        resolvedSymbols: [],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "text-attack",
      primaryEntityId: "entity",
      participantEntityIds: ["entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [],
      symbolResolutionOrder: ["entity"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    },
  };
  return {
    ...f,
    host,
    provider,
    state: queueRegisteredBattleImmediateEffects({
      state,
      sourceCard,
      sourceDefinition: host,
      attackId: "text-attack",
      participantEntityId: "entity",
      actingPlayerId: "alice",
      timing: "attack",
      simultaneousGroupId: "text-declaration",
      ...f.deps,
    }),
  };
}
