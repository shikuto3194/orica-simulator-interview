/**
 * BSTH001-転醒R01(B) 玄爺（異魔神ブレイヴ）の【左右合体中】判定検証。
 * engine-imagin-brave-dual-combine cluster: 10_rules/08c_imagin-mirage-grandwalker.md §7
 * の最小着地スコープ = 左右合体中 (`isImaginBraveDualCombined`) の判定のみ。
 * シンボル個別加算・片方離脱時の残存合体は対象外。「疲労しない」は共有描画の
 * 前提となるため、本ファイルで effect / battle の両経路を検証する。
 *
 * データモデル: 左スロット=既存の汎用単一合体 (`attachedToInstanceId` / host 側
 * `attachedChildrenIds`) をそのまま流用。右スロット=新設 `imaginRightCombinedWith`
 * (右ホスト側 `attachedChildrenIds` へは反映しない非対称設計、P3-16 多重合体の
 * 相互整合性 invariant と衝突させないため)。legal action は既存の `brave_combine`
 * kind を再利用し、対象ブレイヴが既に左合体済みなら第2合体（右スロット）と判別する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBattleImmediateEffectLookup,
  confirmAttackDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  useAttackAsAction,
  usePassPreDeclarationStackAsAction,
} from "../src";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { executeEffect } from "../src/effect/effect-interpreter";
import { queueRegisteredBattleImmediateEffects } from "../src/battle/battle-immediate-effect-system";
import { executeExhaust } from "../src/effect/structured-state-grants";
import {
  getAttackDeclarationBlockReason,
  getBlockDeclarationBlockReason,
} from "../src/battle/battle-availability";
import type { ActiveAttack, CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.flatMap((c) =>
    c.backFace
      ? [[c.cardNo, c] as const, [c.backFace.cardNo, c.backFace] as const]
      : [[c.cardNo, c] as const]
  )
);

const ALICE = "alice";
const BOB = "bob";
const noTriggerLookup = () => [];
const noFieldEffects = () => [] as const;

const braveDef = cardNoMap.get("BSTH001-転醒R01(B)")! as CardDefinition;

function spiritDef(cardNo: string, tribe: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe,
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

const hostADef = spiritDef("TEST-IMAGIN-HOST-A", "博麗");
const hostBDef = spiritDef("TEST-IMAGIN-HOST-B", "靈異");

const getDef = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ??
  [hostADef, hostBDef].find((d) => d.cardNo === id) ??
  undefined;

function baseFieldState(): GameState {
  const brave = createCardInstance(braveDef, {
    instanceId: "brave-1",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const hostA = createCardInstance(hostADef, {
    instanceId: "hostA-1",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const hostB = createCardInstance(hostBDef, {
    instanceId: "hostB-1",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [brave, hostA, hostB],
    }),
    activePlayerId: ALICE,
    step: "main",
  };
}

describe("BSTH001-転醒R01(B) 玄爺 異魔神左右合体", () => {
  it("構造: imaginBraveData を持ち、effects[1] に stub が残っていない", () => {
    expect(braveDef.imaginBraveData).toEqual({
      sharedCondition: { tribes: ["博麗", "靈異"] },
    });
    expect(braveDef.effects![1]!.stub).toBeUndefined();
    expect(braveDef.effects![1]!.applicability).toEqual({
      imaginDualCombined: true,
    });
  });

  it("異魔神ブレイヴは防止不可の疲労効果でも疲労しない", () => {
    const state = baseFieldState();
    const after = executeExhaust(
      state,
      BOB,
      { selfCard: false, player: "opponent", count: -1 },
      getDef,
      "heavily_exhausted",
      "bob-effect-source",
      undefined,
      "unpreventable"
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === "brave-1")
        ?.exhaustState
    ).toBe("recovered");
    expect(after.log).not.toContain("effect:heavy_exhaust:brave-1");
  });

  it("スピリット状態の異魔神ブレイヴはアタックもブロックも宣言できない", () => {
    const attackState: GameState = {
      ...baseFieldState(),
      step: "attack",
    };
    expect(
      getAttackDeclarationBlockReason({
        state: attackState,
        actingPlayerId: ALICE,
        sourceInstanceId: "brave-1",
        getCardDefinitionById: getDef,
      })
    ).toBe("source_not_ready");

    const activeAttack: ActiveAttack = {
      attackId: "attack:hostA-1:1",
      primaryEntityId: "hostA-entity",
      participantEntityIds: ["hostA-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      blockAssignments: [
        { participantEntityId: "hostA-entity", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["hostA-entity"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const blockState: GameState = {
      ...attackState,
      activePlayerId: BOB,
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "hostA-entity",
          resolvedBp: 3000,
          attackState: "attacking",
          resolvedSymbols: ["red"],
          memberInstanceIds: ["hostA-1"],
        },
      ],
    };
    expect(
      getBlockDeclarationBlockReason({
        state: blockState,
        actingPlayerId: ALICE,
        sourceInstanceId: "brave-1",
        participantEntityId: "hostA-entity",
        getCardDefinitionById: getDef,
      })
    ).toBe("source_not_ready");
  });

  it("左右どちらのホストがアタックしても共有異魔神ブレイヴは回復状態を保つ", () => {
    const base = baseFieldState();
    const dualState: GameState = {
      ...base,
      step: "attack",
      cardInstances: base.cardInstances.map((card) => {
        if (card.instanceId === "brave-1") {
          return {
            ...card,
            attachedToInstanceId: "hostA-1",
            imaginRightCombinedWith: "hostB-1",
          };
        }
        return card.instanceId === "hostA-1"
          ? { ...card, attachedChildrenIds: ["brave-1"] }
          : card;
      }),
    };

    for (const hostId of ["hostA-1", "hostB-1"] as const) {
      const tentative = useAttackAsAction({
        state: dualState,
        actingPlayerId: ALICE,
        sourceInstanceId: hostId,
        getCardDefinitionById: getDef,
      });
      const afterPass = usePassPreDeclarationStackAsAction({
        state: tentative,
        actingPlayerId: BOB,
      });
      const confirmed = confirmAttackDeclarationAsAction(
        afterPass.closedWindow!,
        afterPass.state,
        { getCardDefinitionById: getDef }
      ).state;

      expect(
        confirmed.cardInstances.find((card) => card.instanceId === "brave-1")
          ?.exhaustState
      ).toBe("recovered");
      expect(
        confirmed.cardInstances.find((card) => card.instanceId === hostId)
          ?.exhaustState
      ).toBe("exhausted");
    }
  });

  it("第1合体(既存汎用)→第2合体(右スロット)で attachedToInstanceId と imaginRightCombinedWith が両方セットされる", () => {
    const state = baseFieldState();

    const firstActions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noFieldEffects,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const combineToA = firstActions.find(
      (a) =>
        a.kind === "brave_combine" &&
        a.braveInstanceId === "brave-1" &&
        a.targetInstanceId === "hostA-1"
    );
    expect(combineToA).toBeDefined();

    const afterFirst = applyLegalAction({
      state,
      action: combineToA!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    const braveAfterFirst = afterFirst.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    )!;
    expect(braveAfterFirst.attachedToInstanceId).toBe("hostA-1");
    expect(braveAfterFirst.imaginRightCombinedWith).toBeNull();

    const secondActions = getLegalActions({
      state: afterFirst,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: noFieldEffects,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    // 既存の左ホストへは再合体候補として現れない。
    expect(
      secondActions.some(
        (a) =>
          a.kind === "brave_combine" &&
          a.braveInstanceId === "brave-1" &&
          a.targetInstanceId === "hostA-1"
      )
    ).toBe(false);
    const combineToB = secondActions.find(
      (a) =>
        a.kind === "brave_combine" &&
        a.braveInstanceId === "brave-1" &&
        a.targetInstanceId === "hostB-1"
    );
    expect(combineToB).toBeDefined();

    const afterSecond = applyLegalAction({
      state: afterFirst,
      action: combineToB!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    const braveAfterSecond = afterSecond.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    )!;
    expect(braveAfterSecond.attachedToInstanceId).toBe("hostA-1");
    expect(braveAfterSecond.imaginRightCombinedWith).toBe("hostB-1");

    const hostAAfter = afterSecond.cardInstances.find(
      (c) => c.instanceId === "hostA-1"
    )!;
    expect(hostAAfter.attachedChildrenIds).toContain("brave-1");
    const hostBAfter = afterSecond.cardInstances.find(
      (c) => c.instanceId === "hostB-1"
    )!;
    expect(hostBAfter.attachedChildrenIds).not.toContain("brave-1");
  });

  it("右合体ホストは無関係な別ブレイヴと合体できない（『異魔神と合体中は他のブレイヴと合体不可』10_rules/08c §7）", () => {
    const dualBrave1 = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "hostA-1",
    });
    const hostAWithChild = {
      ...createCardInstance(hostADef, {
        instanceId: "hostA-1",
        ownerPlayerId: ALICE,
        zone: "field",
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const hostB = createCardInstance(hostBDef, {
      instanceId: "hostB-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const otherBrave = createCardInstance(
      { ...braveDef, cardNo: "TEST-OTHER-BRAVE", imaginBraveData: undefined },
      {
        instanceId: "brave-2",
        ownerPlayerId: ALICE,
        zone: "field",
      }
    );
    const stateBeforeRightCombine: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          { ...dualBrave1, imaginRightCombinedWith: "hostB-1" },
          hostAWithChild,
          hostB,
          otherBrave,
        ],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const getDefWithOther = (id: string): CardDefinition | undefined =>
      id === "TEST-OTHER-BRAVE"
        ? {
            ...braveDef,
            cardNo: "TEST-OTHER-BRAVE",
            imaginBraveData: undefined,
          }
        : getDef(id);

    const actions = getLegalActions({
      state: stateBeforeRightCombine,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithOther,
      getRegisteredFieldCardEffectActions: noFieldEffects,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    // hostA-1 は maxCombinedBraves 既定1 で brave-1 (左スロット) 経由で既に埋まっている。
    expect(
      actions.some(
        (a) =>
          a.kind === "brave_combine" &&
          a.braveInstanceId === "brave-2" &&
          a.targetInstanceId === "hostA-1"
      )
    ).toBe(false);
    // hostB-1 は attachedChildrenIds が空だが、imaginRightCombinedWith で右スロット占有中。
    // 通常合体の候補にも現れてはならない。
    expect(
      actions.some(
        (a) =>
          a.kind === "brave_combine" &&
          a.braveInstanceId === "brave-2" &&
          a.targetInstanceId === "hostB-1"
      )
    ).toBe(false);
  });

  it("右合体ホストのアタック宣言時も imaginRightCombinedWith 経由で【左右合体中】attack registration が queue される", () => {
    const state = baseFieldState();
    const dualState: GameState = {
      ...state,
      step: "attack",
      cardInstances: state.cardInstances.map((c) => {
        if (c.instanceId === "brave-1") {
          return {
            ...c,
            attachedToInstanceId: "hostA-1",
            imaginRightCombinedWith: "hostB-1",
          };
        }
        if (c.instanceId === "hostA-1") {
          return { ...c, attachedChildrenIds: ["brave-1"] };
        }
        return c;
      }),
    };
    const hostBCard = dualState.cardInstances.find(
      (c) => c.instanceId === "hostB-1"
    )!;
    const registrationLookup = buildBattleImmediateEffectLookup([
      braveDef,
      hostBDef,
    ]);

    const queued = queueRegisteredBattleImmediateEffects({
      state: dualState,
      attackId: "attack-imagin-dual-1",
      participantEntityId: "battle-entity:hostB-1",
      actingPlayerId: ALICE,
      sourceCard: hostBCard,
      sourceDefinition: hostBDef,
      timing: "attack",
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: registrationLookup,
    });

    const bravePrompts = queued.battleImmediateEffects.filter(
      (p) =>
        p.sourceInstanceId === "hostB-1" &&
        p.sourceEffectInstanceId === "brave-1"
    );
    expect(bravePrompts).toHaveLength(1);
    expect(bravePrompts[0]).toMatchObject({
      sourceDefinitionId: hostBDef.cardNo,
      sourceEffectDefinitionId: braveDef.cardNo,
      sourceCardNo: braveDef.cardNo,
    });

    const action = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: registrationLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredFieldCardEffectActions: noFieldEffects,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_battle_immediate_effect" &&
        candidate.promptId === bravePrompts[0]!.promptId &&
        candidate.sourceInstanceId === "hostB-1" &&
        candidate.sourceEffectInstanceId === "brave-1" &&
        candidate.skipOnly !== true
    );
    expect(action).toBeDefined();

    const opened = applyLegalAction({
      state: queued,
      action: action!,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: registrationLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredFieldCardEffectActions: noFieldEffects,
    }).state;
    const pass = getLegalActions({
      state: opened,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: registrationLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredFieldCardEffectActions: noFieldEffects,
    }).find((candidate) => candidate.kind === "pass_stack");
    expect(pass).toBeDefined();

    const resolved = applyLegalAction({
      state: opened,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredBattleImmediateEffectActions: registrationLookup,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredFieldCardEffectActions: noFieldEffects,
    }).state;
    expect(resolved.battleImmediateEffects).toEqual([]);
    expect(
      resolved.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "unblockable" && ce.targetInstanceId === "hostB-1"
      )
    ).toBe(true);
  });

  it("左右合体中のみ effects[1] (このスピリットは、ブロックされない) が発動する。片側だけの合体では発動しない", () => {
    const state = baseFieldState();
    const attackEffect = braveDef.effects![1]!;

    const dualState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((c) => {
        if (c.instanceId === "brave-1") {
          return {
            ...c,
            attachedToInstanceId: "hostA-1",
            imaginRightCombinedWith: "hostB-1",
          };
        }
        if (c.instanceId === "hostA-1") {
          return { ...c, attachedChildrenIds: ["brave-1"] };
        }
        return c;
      }),
    };
    const afterDual = executeEffect({
      chainId: "test:bsth001-imagin-brave-dual-combine:515",
      state: dualState,
      effect: attackEffect,
      sourceInstanceId: "brave-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    // これは effect source を brave 自身として直接実行する互換経路なので、
    // 「このスピリット」は左スロット host を参照する。右ホストのアタック宣言から
    // 入る production 経路は直上で検証し、prompt の sourceInstanceId (hostB-1) を
    // self target に渡すため右 host に適用される。
    expect(
      afterDual.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "unblockable" && ce.targetInstanceId === "hostA-1"
      )
    ).toBe(true);

    const singleState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((c) => {
        if (c.instanceId === "brave-1") {
          return { ...c, attachedToInstanceId: "hostA-1" };
        }
        if (c.instanceId === "hostA-1") {
          return { ...c, attachedChildrenIds: ["brave-1"] };
        }
        return c;
      }),
    };
    const afterSingle = executeEffect({
      chainId: "test:bsth001-imagin-brave-dual-combine:546",
      state: singleState,
      effect: attackEffect,
      sourceInstanceId: "brave-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      afterSingle.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "unblockable"
      )
    ).toBe(false);
    expect(
      afterSingle.log.some((line) =>
        line.includes("effect:applicability-unmet:brave-1")
      )
    ).toBe(true);
  });
});
