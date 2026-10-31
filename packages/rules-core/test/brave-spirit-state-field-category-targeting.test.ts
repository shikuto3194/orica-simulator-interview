import { recordSemanticTriggerEvent } from "../src/effect/semantic-trigger-events";
/**
 * P3-155: フィールド上で単独のブレイヴ (スピリット状態) は、場の対象/条件では
 * スピリットとしても参照される。一方、召喚・契約合体など event 文脈では
 * ブレイヴカテゴリを保持する。
 */
import { describe, expect, it } from "vitest";
import { matchesCardFilter } from "../src/card/card-filter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { resolveTargetSpec } from "../src/effect/target-resolution";
import { resolveTargetCards } from "../src/effect/structured-effect-interpreter";
import { executeStayOnField } from "../src/effect/structured-state-grants";
import { evaluateCondition } from "../src/effect/structured-condition-eval";
import { getEffectiveColors } from "../src/legal/legal-actions-shared";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import { buildResolutionItems } from "../src/effect/resolution-items";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { getAvailablePendingTriggeredEffectLegalActions } from "../src/legal/legal-actions-availability";
import { getCandidateTargetInstanceIds } from "../src/legal/legal-actions-shared";
import { getEffectiveCategories } from "../src/mechanics/act-as-spirit";
import type {
  CardDefinition,
  GameState,
  PendingLeaveEntity,
} from "../src/model";
import type { RegisteredTargetedEffectActionBase } from "../src/legal/legal-actions-types";

const ALICE = "alice";
const BOB = "bob";

function makeCard(
  cardNo: string,
  printedCategory: CardDefinition["printedCategory"],
  effects: CardDefinition["effects"] = undefined,
  textLines: readonly string[] = []
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory,
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs:
      printedCategory === "magic"
        ? []
        : [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: printedCategory === "magic" ? [] : ["red"],
    tribe: "テスト",
    textLines: [...textLines],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...(effects ? { effects } : {}),
  } as CardDefinition;
}

function createLookup(defs: readonly CardDefinition[]) {
  const map = new Map(defs.map((def) => [def.cardNo, def]));
  return (id: string) => map.get(id);
}

function fieldCategoryFixture() {
  const sourceDef = makeCard("P3-155-SOURCE", "spirit");
  const braveDef = makeCard("P3-155-BRAVE", "brave");
  const spiritDef = makeCard("P3-155-SPIRIT", "spirit");
  const source = createCardInstance(sourceDef, {
    instanceId: "source-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    cores: 1,
  });
  const brave = createCardInstance(braveDef, {
    instanceId: "brave-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    cores: 1,
  });
  const spirit = createCardInstance(spiritDef, {
    instanceId: "spirit-1",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    cores: 1,
  });
  const defs = [sourceDef, braveDef, spiritDef];
  const state: GameState = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [source, brave, spirit],
  });
  return { state, source, brave, braveDef, getDef: createLookup(defs) };
}

function combinedBraveFixture(options: {
  combinedHeader: boolean;
  blockedByUsageLimit?: boolean;
  hostLevelGate?: boolean;
}) {
  const hostDef = {
    ...makeCard("P3-155-HOST", "spirit"),
    ...(options.hostLevelGate
      ? {
          levelDefs: [
            { level: 1, requiredCores: 1, bp: 3000 },
            { level: 2, requiredCores: 2, bp: 5000 },
          ],
        }
      : {}),
  } as CardDefinition;
  const header = options.combinedHeader
    ? "【合体中】『このスピリットの契約合体時』"
    : "『このブレイヴの契約合体時』";
  const braveDef = makeCard(
    options.combinedHeader ? "P3-155-BRAVE-COMBINED" : "P3-155-BRAVE-OWN",
    "brave",
    [
      {
        timing: {
          kind: "card_event",
          event: "brave_combined",
          cause: ["contract_combine"],
        },
        ...(options.hostLevelGate
          ? {
              applicability: { level: { min: 2 }, combined: true },
              condition: [
                { kind: "combined" },
                { kind: "min_level", value: 2 },
              ],
            }
          : { condition: [{ kind: "combined" }] }),
        ...(options.blockedByUsageLimit
          ? { usageLimit: { kind: "per_instance", duration: "turn" } as const }
          : {}),
        textRef: [0],
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
    [header]
  );
  const host = createCardInstance(hostDef, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    cores: options.hostLevelGate ? 2 : 1,
  });
  const braveBefore = createCardInstance(braveDef, {
    instanceId: "brave-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    cores: 1,
  });
  const beforeState: GameState = {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, braveBefore],
    }),
    activePlayerId: ALICE,
  };
  const afterState: GameState = {
    ...beforeState,
    cardInstances: beforeState.cardInstances.map((card) =>
      card.instanceId === "host-1"
        ? { ...card, attachedChildrenIds: ["brave-1"] }
        : card.instanceId === "brave-1"
          ? { ...card, attachedToInstanceId: "host-1" }
          : card
    ),
  };
  const defs = [hostDef, braveDef];
  return {
    beforeState,
    afterState,
    getDef: createLookup(defs),
    triggeredLookup: buildTriggeredEffectLookup(defs),
  };
}

describe("P3-155: スピリット状態ブレイヴの場カテゴリ照合", () => {
  it("通常の filter 自動解決は brave のまま、場カテゴリ文脈では spirit にも一致する", () => {
    const { state, brave, braveDef, getDef } = fieldCategoryFixture();

    expect(getEffectiveCategories(state, brave, braveDef, getDef)).toEqual([
      "brave",
      "spirit",
    ]);
    expect(
      matchesCardFilter(
        brave,
        braveDef,
        { category: ["spirit"] },
        { state, getCardDefinitionById: getDef }
      )
    ).toBe(false);
    expect(
      matchesCardFilter(
        brave,
        braveDef,
        { category: ["spirit"] },
        {
          state,
          fieldCategoryContext: true,
          getCardDefinitionById: getDef,
        }
      )
    ).toBe(true);
  });

  it("resolveTargetSpec の「相手のスピリット」対象に、スピリット状態のブレイヴを含める", () => {
    const { state, source, getDef } = fieldCategoryFixture();

    const resolved = resolveTargetSpec({
      state,
      targetSpec: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit"] },
        count: "all",
      },
      actingPlayerId: ALICE,
      sourceInstanceId: source.instanceId,
      getCardDefinitionById: getDef,
    });

    expect(resolved.map((card) => card.instanceId)).toEqual([
      "brave-1",
      "spirit-1",
    ]);
  });

  it("合体済み child brave は別個のスピリット対象としては扱わない", () => {
    const { afterState, getDef } = combinedBraveFixture({
      combinedHeader: true,
    });
    const resolved = resolveTargetSpec({
      state: afterState,
      targetSpec: {
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"] },
        count: "all",
      },
      actingPlayerId: ALICE,
      sourceInstanceId: "host-1",
      getCardDefinitionById: getDef,
    });

    expect(resolved.map((card) => card.instanceId)).toEqual(["host-1"]);
  });

  it("v1 EffectTarget の category 直接指定でも合体済み child brave を別個のスピリット対象にしない", () => {
    const { afterState, getDef } = combinedBraveFixture({
      combinedHeader: true,
    });

    const resolved = resolveTargetCards(
      afterState,
      ALICE,
      {
        player: "self",
        category: ["spirit"],
        count: -1,
      },
      getDef,
      "host-1",
      undefined,
      undefined,
      ALICE
    );

    expect(resolved.map((card) => card.instanceId)).toEqual(["host-1"]);
  });

  it("stay_on_field の fieldCategoryContext でも合体済み child brave を別個のスピリット対象にしない", () => {
    const { afterState, getDef } = combinedBraveFixture({
      combinedHeader: true,
    });
    const pendingLeaves: PendingLeaveEntity[] = ["host-1", "brave-1"].map(
      (instanceId) => ({
        instanceId,
        kind: "destroy",
        cause: "effect",
        causePlayerId: BOB,
        chainId: `chain-${instanceId}`,
        deferZoneMoveUntilChainEnd: false,
        leaveFieldCoreDestinationOverride: null,
      })
    );
    const pendingState: GameState = {
      ...afterState,
      cardInstances: afterState.cardInstances.map((card) =>
        card.instanceId === "host-1" || card.instanceId === "brave-1"
          ? {
              ...card,
              pendingLeaveKind: "destroy",
              pendingLeaveCause: "effect",
              pendingLeaveChainId: `chain-${card.instanceId}`,
            }
          : card
      ),
      pendingLeaveEntities: pendingLeaves,
    };

    const next = executeStayOnField(
      pendingState,
      ALICE,
      {
        kind: "stay_on_field",
        target: {
          player: "self",
          category: ["spirit"],
          count: -1,
        },
      },
      getDef,
      "host-1"
    );

    expect(next.log).toContain("effect:stay_on_field:host-1:keep");
    expect(next.log).not.toContain("effect:stay_on_field:brave-1:keep");
    expect(next.pendingLeaveEntities.map((entry) => entry.instanceId)).toEqual([
      "brave-1",
    ]);
  });

  it("filterOr の spirit 枝だけで合体済み child brave を別個の対象にしない", () => {
    const { afterState, getDef } = combinedBraveFixture({
      combinedHeader: true,
    });
    const resolved = resolveTargetSpec({
      state: afterState,
      targetSpec: {
        kind: "filter",
        player: "self",
        filter: {
          filterOr: [{ category: ["spirit"] }, { category: ["ultimate"] }],
        },
        count: "all",
      },
      actingPlayerId: ALICE,
      sourceInstanceId: "host-1",
      getCardDefinitionById: getDef,
    });

    expect(resolved.map((card) => card.instanceId)).toEqual(["host-1"]);
  });

  it("filterOr の brave 枝が追加条件を満たさない場合は child brave を spirit 枝で復活させない", () => {
    const { afterState, getDef } = combinedBraveFixture({
      combinedHeader: true,
    });
    const resolved = resolveTargetSpec({
      state: afterState,
      targetSpec: {
        kind: "filter",
        player: "self",
        filter: {
          filterOr: [
            { category: ["spirit"], colors: ["red"] },
            { category: ["brave"], colors: ["blue"] },
          ],
        },
        count: "all",
      },
      actingPlayerId: ALICE,
      sourceInstanceId: "host-1",
      getCardDefinitionById: getDef,
    });

    expect(resolved.map((card) => card.instanceId)).toEqual(["host-1"]);
  });

  it("matchesCardFilter の fieldCategoryContext 直呼びでも合体済み child brave を spirit 対象にしない", () => {
    const { afterState, getDef } = combinedBraveFixture({
      combinedHeader: true,
    });
    const brave = afterState.cardInstances.find(
      (card) => card.instanceId === "brave-1"
    )!;
    const braveDef = getDef(brave.definitionId)!;

    expect(
      matchesCardFilter(
        brave,
        braveDef,
        { category: ["spirit"] },
        {
          state: afterState,
          fieldCategoryContext: true,
          getCardDefinitionById: getDef,
        }
      )
    ).toBe(false);
    expect(
      matchesCardFilter(
        brave,
        braveDef,
        {
          filterOr: [{ category: ["spirit"] }, { category: ["ultimate"] }],
        },
        {
          state: afterState,
          fieldCategoryContext: true,
          getCardDefinitionById: getDef,
        }
      )
    ).toBe(false);
    expect(
      matchesCardFilter(
        brave,
        braveDef,
        {
          filterOr: [{ category: ["spirit"] }, { category: ["brave"] }],
        },
        {
          state: afterState,
          fieldCategoryContext: true,
          getCardDefinitionById: getDef,
        }
      )
    ).toBe(true);
  });

  it("合体済み child brave の own identity 判定は CardFilter の実効色を使う", () => {
    const { afterState, getDef } = combinedBraveFixture({
      combinedHeader: true,
    });
    const state: GameState = {
      ...afterState,
      activeContinuousEffects: [
        ...afterState.activeContinuousEffects,
        {
          effectId: "ce-brave-as-blue",
          sourceInstanceId: "brave-1",
          sourceDefinitionId: "P3-155-BRAVE-COMBINED",
          actingPlayerId: ALICE,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "treat_as_color",
          targetInstanceId: "brave-1",
          modifierSymbol: ["blue"],
        },
      ],
    };
    const brave = state.cardInstances.find(
      (card) => card.instanceId === "brave-1"
    )!;
    const braveDef = getDef(brave.definitionId)!;
    const effectiveColors = getEffectiveColors(state, brave, braveDef);

    expect(effectiveColors).toContain("blue");
    expect(
      matchesCardFilter(
        brave,
        braveDef,
        { category: ["spirit"], colors: ["blue"] },
        {
          state,
          fieldCategoryContext: true,
          getCardDefinitionById: getDef,
          effectiveColors,
        }
      )
    ).toBe(false);
    expect(
      matchesCardFilter(
        brave,
        braveDef,
        {
          filterOr: [
            { category: ["spirit"], colors: ["blue"] },
            { category: ["brave"], colors: ["blue"] },
          ],
        },
        {
          state,
          fieldCategoryContext: true,
          getCardDefinitionById: getDef,
          effectiveColors,
        }
      )
    ).toBe(true);
  });

  it("legal action 候補列挙でも filterOr の spirit 枝だけで合体済み child brave を別個の対象にしない", () => {
    const { afterState, getDef } = combinedBraveFixture({
      combinedHeader: true,
    });
    const registration: RegisteredTargetedEffectActionBase = {
      requiredTargetCount: 1,
      candidateTargetZones: ["field"],
      candidateTargetPlayerScope: "acting_player",
      targetCardFilter: {
        filterOr: [{ category: ["spirit"] }, { category: ["ultimate"] }],
      },
      targetCardFilterActionKind: "destroy",
    };

    expect(
      getCandidateTargetInstanceIds(afterState, ALICE, registration, {
        sourceInstanceId: "host-1",
        getCardDefinitionById: getDef,
      })
    ).toEqual(["host-1"]);
  });

  it("魂状態の field brave はスピリット状態としては扱わない", () => {
    const { state, brave, braveDef, getDef } = fieldCategoryFixture();
    const soulState = {
      ...state,
      players: state.players.map((player) =>
        player.id === BOB
          ? { ...player, soulStateInstanceIds: [brave.instanceId] }
          : player
      ),
    };

    expect(
      matchesCardFilter(
        brave,
        braveDef,
        { category: ["spirit"] },
        {
          state: soulState,
          fieldCategoryContext: true,
          getCardDefinitionById: getDef,
        }
      )
    ).toBe(false);
  });

  it("field_has / field_lacks のカテゴリ条件でもスピリット状態のブレイヴを数える", () => {
    const { state, source, getDef } = fieldCategoryFixture();

    expect(
      evaluateCondition(
        state,
        [
          {
            kind: "field_has",
            player: "opponent",
            category: ["spirit"],
            minCount: 2,
          },
        ],
        source.instanceId,
        ALICE,
        getDef
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        state,
        [
          {
            kind: "field_lacks",
            player: "opponent",
            category: ["spirit"],
          },
        ],
        source.instanceId,
        ALICE,
        getDef
      )
    ).toBe(false);
  });

  it("field_has は合体済み child brave を別個のスピリットとして数えない", () => {
    const { afterState, getDef } = combinedBraveFixture({
      combinedHeader: true,
    });

    expect(
      evaluateCondition(
        afterState,
        [
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            minCount: 2,
          },
        ],
        "host-1",
        ALICE,
        getDef
      )
    ).toBe(false);
    expect(
      evaluateCondition(
        afterState,
        [
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            minCount: 1,
          },
        ],
        "host-1",
        ALICE,
        getDef
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        afterState,
        [
          {
            kind: "field_lacks",
            player: "self",
            category: ["spirit"],
            excludeSelf: true,
          },
        ],
        "host-1",
        ALICE,
        getDef
      )
    ).toBe(true);
  });
});

describe("P3-155: 【合体中】契約合体時の host 帰属", () => {
  function queueContractCombine(options: {
    combinedHeader: boolean;
    blockedByUsageLimit?: boolean;
  }) {
    const ctx = combinedBraveFixture(options);
    const queuedRaw = collectAndQueueTriggerReactions({
      chainId: "test:brave-spirit-state-field-category-targeting:637",
      beforeState: ctx.beforeState,
      afterState: recordSemanticTriggerEvent(ctx.afterState, {
        eventKind: "brave_combined",
        relatedInstanceId: "brave-1",
        triggerRelatedCombinedHostInstanceId: "host-1",
        cause: "contract_combine",
      }),
      source: "action_resolution",
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.triggeredLookup,
      getRegisteredBurstActions: undefined,
    });
    const queued = options.blockedByUsageLimit
      ? {
          ...queuedRaw,
          effectUsageRecords: [
            ...queuedRaw.effectUsageRecords,
            {
              sourceInstanceId: "brave-1",
              sourceDefinitionId: "P3-155-BRAVE-COMBINED",
              effectLabel: "effect:0",
              turnNumber: queuedRaw.turnNumber,
              step: queuedRaw.step,
              duration: "turn" as const,
              count: 1,
            },
          ],
        }
      : queuedRaw;
    const pending = queued.pendingTriggeredEffects.find(
      (effect) => effect.eventKind === "brave_combined"
    );
    expect(pending).toBeDefined();
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.triggeredLookup,
    });
    return { ...ctx, queued, pending: pending!, choices };
  }

  it("【合体中】表記のある契約合体時は host が sourceCard、ブレイヴが sourceEffect になる", () => {
    const { choices } = queueContractCombine({ combinedHeader: true });

    expect(
      choices.find(
        (choice) =>
          choice.sourceCard.instanceId === "host-1" &&
          choice.sourceEffectInstanceId === "brave-1" &&
          choice.actionRegistration.requiredSourceRole === "combined_brave"
      )
    ).toBeDefined();
    expect(
      choices.some(
        (choice) =>
          choice.sourceCard.instanceId === "brave-1" &&
          choice.sourceEffectInstanceId === undefined
      )
    ).toBe(false);
  });

  it("【合体中】契約合体時の Lv 条件は効果提供元ブレイヴではなく host で listing 判定する", () => {
    const { choices } = queueContractCombine({
      combinedHeader: true,
      hostLevelGate: true,
    });

    expect(
      choices.find(
        (choice) =>
          choice.sourceCard.instanceId === "host-1" &&
          choice.sourceEffectInstanceId === "brave-1" &&
          choice.actionRegistration.requiredSourceRole === "combined_brave"
      )
    ).toBeDefined();
  });

  it("【合体中】表記のない契約合体時はブレイヴ自身の効果のまま扱う", () => {
    const { choices } = queueContractCombine({ combinedHeader: false });

    expect(
      choices.find(
        (choice) =>
          choice.sourceCard.instanceId === "brave-1" &&
          choice.sourceEffectInstanceId === undefined &&
          choice.actionRegistration.requiredSourceRole === undefined
      )
    ).toBeDefined();
    expect(
      choices.some(
        (choice) =>
          choice.sourceCard.instanceId === "host-1" &&
          choice.sourceEffectInstanceId === "brave-1"
      )
    ).toBe(false);
  });

  it("【合体中】契約合体時のキュー/アクションは効果提供元ブレイヴを表示識別に残す", () => {
    const { queued, pending, getDef, triggeredLookup } = queueContractCombine({
      combinedHeader: true,
    });

    const items = buildResolutionItems({
      state: queued,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const source = items
      .find((item) => item.ref.kind === "triggered")
      ?.sources.find((candidate) => candidate.effectInstanceId === "brave-1");

    expect(source).toMatchObject({
      instanceId: "host-1",
      definitionId: "P3-155-HOST",
      effectInstanceId: "brave-1",
      effectDefinitionId: "P3-155-BRAVE-COMBINED",
      registrationIndex: 0,
    });

    const actions = getAvailablePendingTriggeredEffectLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const action = actions.find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.pendingId === pending.pendingId
    );

    expect(action).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "P3-155-HOST",
      sourceEffectInstanceId: "brave-1",
      sourceEffectDefinitionId: "P3-155-BRAVE-COMBINED",
      sourceCardNo: "P3-155-BRAVE-COMBINED",
      registrationIndex: 0,
    });
  });

  it("【合体中】契約合体時の skipOnly fallback も効果提供元ブレイヴを表示識別に残す", () => {
    const { queued, pending, getDef, triggeredLookup } = queueContractCombine({
      combinedHeader: true,
      blockedByUsageLimit: true,
    });

    const actions = getAvailablePendingTriggeredEffectLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const action = actions.find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.pendingId === pending.pendingId &&
        candidate.skipOnly === true
    );

    expect(action).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: "P3-155-HOST",
      sourceEffectInstanceId: "brave-1",
      sourceEffectDefinitionId: "P3-155-BRAVE-COMBINED",
      sourceCardNo: "P3-155-BRAVE-COMBINED",
      registrationIndex: 0,
      skipOnly: true,
    });
  });
});
