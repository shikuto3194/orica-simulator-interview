/**
 * ENGINE-battle-immediate-off-field-target-revalidation:
 *
 * battle_immediate_effect (`queueRegisteredBattleImmediateEffects` 経由のアタック時
 * 効果、declare→stack window→pass_stack で deferred 解決) の対象再検証
 * (`isTargetStillValid`/`assertTargetIsAllowed`、battle-immediate-effect-system.ts) は
 * `targetCard.zone !== "field"` を無条件 stale 扱いにしていたため、手札/トラッシュを
 * 対象ゾーンとする効果 (例: BSRK01-X02 effects[0] `borrow_magic_effect`「手札/トラッシュの
 * 「飛天御剣流」を...借用」) を、declare (対象選択) → pass_stack (解決) の完全な
 * interactive フローで発揮すると、対象が最初から存在していても resolve 時に必ず
 * "Target card cannot receive this battle immediate effect" で例外になっていた
 * (2026-07-28 発見: 既存テスト bsrk01-magic-effect-borrow.test.ts は executeEffect を
 * 直接呼ぶため、宣言→スタック窓→解決の実 GUI フローを経由せずこのバグを検知できていなかった)。
 *
 * 修正: registration の `candidateTargetZones` (すでに zone-aware な宣言時候補列挙
 * `getCandidateTargetInstanceIds` が使っていた既存フィールド) を
 * LegalAction → ActiveStack → deferred 解決 (`resolveDeferredBattleImmediateEffectStack`
 * / `useBattleImmediateEffectAsAction`) まで一貫して伝播させ、`isTargetStillValid` の
 * zone 判定を `candidateTargetZones` 基準 (省略時は従来通り `["field"]` のみ) にした。
 */
import { describe, expect, it } from "vitest";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  flushPendingLeaves,
  getLegalActions,
  queueRegisteredBattleImmediateEffects,
} from "../src";
import type {
  ActiveAttack,
  CardDefinition,
  CardInstance,
  GameState,
} from "../src";

const byCardNo = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const noLookup = () => [];
const X02 = byCardNo.get("BSRK01-X02")!;
const R06 = byCardNo.get("BSLH01-R06")!;
const R06_TARGET = byCardNo.get("BSLH01-M01")!;
const battleImmediateLookup = buildBattleImmediateEffectLookup(ALL_CARDS);

const magicDonorDef: CardDefinition = {
  cardNo: "TEST-OFF-FIELD-MAGIC-DONOR",
  name: "テスト用「飛天御剣流」",
  printedCategory: "magic",
  colors: ["white"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
      textRef: [0],
    },
  ],
};
const trashRecoverStackMagic: CardDefinition = {
  cardNo: "TEST-GROUPED-TARGET-TRASH-RECOVER",
  name: "テスト用トラッシュ回収スタック",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["スタック", "自分のトラッシュのスピリット1枚を手札に戻す。"],
  keywordTags: [],
  tribe: "テスト",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "trash", player: "self" },
            to: { zone: "hand", player: "self" },
            count: 1,
          },
        },
      ],
      textRef: [0, 1],
    },
  ],
};
const getCardDefinitionById = (id: string) =>
  byCardNo.get(id) ??
  (id === magicDonorDef.cardNo
    ? magicDonorDef
    : id === trashRecoverStackMagic.cardNo
      ? trashRecoverStackMagic
      : undefined);
const magicLookup = buildMagicLookup([...ALL_CARDS, trashRecoverStackMagic]);

function resolveOptionalSteps(state: GameState): GameState {
  const options = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: noLookup,
    getRegisteredFieldCardEffectActions: noLookup,
    getRegisteredMagicActions: magicLookup,
    getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
  };
  for (let guard = 0; guard < 12; guard++) {
    const target = state.pendingStepOptionalTargetSelection;
    const pending = state.pendingStepOptionalChoice;
    if (target || pending) {
      const actions = getLegalActions({
        state,
        actingPlayerId: target?.choosingPlayerId ?? pending!.actingPlayerId,
        ...options,
      });
      const action = target
        ? actions.find(
            (a) => a.kind === "resolve_pending_step_optional_target_selection"
          )
        : actions.find(
            (a) =>
              a.kind === "resolve_pending_step_optional_choice" &&
              a.choice ===
                (pending!.canExecute === false ? "decline" : "execute")
          );
      expect(action).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        ...options,
        ...(target
          ? {
              targetInstanceIds: target.candidateInstanceIds.slice(
                0,
                target.requiredTargetCount
              ),
            }
          : {}),
      }).state;
    } else if (state.pendingAfterTriggersContinuations.length) {
      state = finalizeEffectResolution({
        state,
        beforeState: state,
        chainId: "off-field-optional",
        endLogs: [],
        ...options,
        getRegisteredBurstActions: noLookup,
        causedBySourceInstanceId: null,
      });
    } else return state;
  }
  throw new Error("Optional steps did not settle");
}

describe("battle immediate effect declare→pass_stack: 手札/トラッシュ対象は stale 誤判定されない", () => {
  it("BSRK01-X02 effects[0] borrow_magic_effect (トラッシュの飛天御剣流) を宣言→pass_stack で解決できる", () => {
    const instanceId = "kenshin-off-field-regression";
    const attackId = `attack-${instanceId}`;
    const entityId = `battle-entity:${instanceId}`;
    const spirit: CardInstance = {
      ...createCardInstance(X02, {
        instanceId,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 3,
        exhaustState: "exhausted",
      }),
      underCards: [{ cardInstanceId: "kenshin-src", role: "advent_source" }],
    };
    const donor = createCardInstance(magicDonorDef, {
      instanceId: "off-field-donor-trash",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
    });
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: entityId,
      participantEntityIds: [entityId],
      groupMode: "single",
      target: { kind: "player", playerId: "alice" },
      blockAssignments: [
        { participantEntityId: entityId, blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: [entityId],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["bob", "alice"],
        cardInstances: [spirit, donor],
        playerOverrides: [{ countValue: 8 }, {}],
      }),
      activePlayerId: "bob",
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId,
          memberInstanceIds: [instanceId],
          resolvedBp: 20000,
          resolvedSymbols: [],
          attackState: "attacking",
        },
      ],
    };

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId,
      participantEntityId: entityId,
      actingPlayerId: "bob",
      sourceCard: spirit,
      sourceDefinition: X02,
      timing: "attack",
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    const legalOptions = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: noLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    };
    const declareAction = getLegalActions({
      state: queued,
      actingPlayerId: "bob",
      ...legalOptions,
    }).find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        a.sourceInstanceId === instanceId &&
        a.promptId.endsWith(":0") &&
        a.skipOnly !== true
    );
    expect(declareAction).toBeDefined();
    expect(declareAction).toMatchObject({
      candidateTargetZones: ["hand", "trash"],
    });

    const declared = applyLegalAction({
      state: queued,
      action: declareAction!,
      ...legalOptions,
      targetInstanceIds: ["off-field-donor-trash"],
    }).state;

    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();

    // このステップが修正前は "Target card cannot receive this battle immediate
    // effect: target=off-field-donor-trash" を投げていた (zone==="field" 固定判定)。
    const afterPass = applyLegalAction({
      state: declared,
      action: pass!,
      ...legalOptions,
    }).state;
    const flushed = flushPendingLeaves(afterPass, getCardDefinitionById);

    expect(
      flushed.cardInstances.find(
        (c) => c.instanceId === "off-field-donor-trash"
      )!.zone
    ).toBe("trash");
    expect(
      flushed.log.some(
        (l) => l === "borrow_magic_effect:executed:TEST-OFF-FIELD-MAGIC-DONOR"
      )
    ).toBe(true);
  });

  it("BSLH01-R06 は field 候補ゼロでも pass_stack 後に trash の任意対象を選んで解決する", () => {
    const instanceId = "r06-grouped-source";
    const attackId = `attack-${instanceId}`;
    const entityId = `battle-entity:${instanceId}`;
    const source = createCardInstance(R06, {
      instanceId,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const trashTarget = createCardInstance(R06_TARGET, {
      instanceId: "r06-grouped-trash-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
    });
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: entityId,
      participantEntityIds: [entityId],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: entityId, blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: [entityId],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, trashTarget],
        playerOverrides: [{ countValue: 5 }, { countValue: 5 }],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId,
          memberInstanceIds: [instanceId],
          resolvedBp: 5000,
          resolvedSymbols: ["green"],
          attackState: "attacking",
        },
      ],
    };
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId,
      participantEntityId: entityId,
      actingPlayerId: "alice",
      sourceCard: source,
      sourceDefinition: R06,
      timing: "attack",
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    const legalOptions = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: noLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredMagicActions: magicLookup,
    };
    const declareAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceInstanceId === instanceId &&
        action.skipOnly !== true
    );
    expect(declareAction).toBeDefined();
    expect(declareAction!.targetGroups).toBeUndefined();

    const declared = applyLegalAction({
      state: queued,
      action: declareAction!,
      ...legalOptions,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      ...legalOptions,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const resolved = resolveOptionalSteps(
      applyLegalAction({
        state: declared,
        action: pass!,
        ...legalOptions,
      }).state
    );
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "r06-grouped-trash-target"
      )?.zone
    ).toBe("removed_from_game");
  });

  it("BSLH01-R06 の対象候補が応答でトラッシュを離れても、残る field 対象を任意選択して解決する", () => {
    const instanceId = "r06-grouped-response-source";
    const attackId = `attack-${instanceId}`;
    const entityId = `battle-entity:${instanceId}`;
    const source = createCardInstance(R06, {
      instanceId,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const fieldTarget = createCardInstance(R06_TARGET, {
      instanceId: "r06-grouped-field-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const trashTarget = createCardInstance(R06_TARGET, {
      instanceId: "r06-grouped-response-trash-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "trash",
    });
    const responseMagic = createCardInstance(trashRecoverStackMagic, {
      instanceId: "r06-grouped-trash-recover",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
    });
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: entityId,
      participantEntityIds: [entityId],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: entityId, blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: [entityId],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, fieldTarget, trashTarget, responseMagic],
        playerOverrides: [{ countValue: 5 }, { countValue: 5 }],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId,
          memberInstanceIds: [instanceId],
          resolvedBp: 5000,
          resolvedSymbols: ["green"],
          attackState: "attacking",
        },
      ],
    };
    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId,
      participantEntityId: entityId,
      actingPlayerId: "alice",
      sourceCard: source,
      sourceDefinition: R06,
      timing: "attack",
      getCardDefinitionById,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    const legalOptions = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: noLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredMagicActions: magicLookup,
    };
    const declareAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find(
      (action) =>
        action.kind === "resolve_battle_immediate_effect" &&
        action.sourceInstanceId === instanceId &&
        action.skipOnly !== true
    );
    expect(declareAction).toBeDefined();
    expect(declareAction!.targetGroups).toBeUndefined();
    const declared = applyLegalAction({
      state: queued,
      action: declareAction!,
      ...legalOptions,
    }).state;

    const recover = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      ...legalOptions,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "r06-grouped-trash-recover"
    );
    expect(recover).toBeDefined();
    const afterRecover = applyLegalAction({
      state: declared,
      action: recover!,
      ...legalOptions,
    }).state;

    const alicePass = getLegalActions({
      state: afterRecover,
      actingPlayerId: "alice",
      ...legalOptions,
    }).find((action) => action.kind === "pass_stack");
    expect(alicePass).toBeDefined();
    const afterAlicePass = applyLegalAction({
      state: afterRecover,
      action: alicePass!,
      ...legalOptions,
    }).state;
    const bobPass = getLegalActions({
      state: afterAlicePass,
      actingPlayerId: "bob",
      ...legalOptions,
    }).find((action) => action.kind === "pass_stack");
    const resolved = resolveOptionalSteps(
      bobPass
        ? applyLegalAction({
            state: afterAlicePass,
            action: bobPass,
            ...legalOptions,
          }).state
        : afterAlicePass
    );

    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "r06-grouped-field-target"
      )?.exhaustState
    ).toBe("heavily_exhausted");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "r06-grouped-response-trash-target"
      )?.zone
    ).toBe("hand");
    expect(resolved.stackWindow).toBeNull();
    expect(resolved.battleImmediateEffects).toEqual([]);
  });
});
