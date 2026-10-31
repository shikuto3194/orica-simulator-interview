/**
 * P3-53 follow-up: 戦闘フラッシュ sub-stack 窓に pendingStackAction が積まれている間は
 * sibling pending battle-immediate prompt が残っていても responder が pass_battle_flash を
 * 取れること。多重 BIE prompt のシナリオ (BSTH01-X03 レミリア等) で responder が pass できず
 * 詰むエンジンバグの再発防止。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src/index";
import { buildBattleImmediateEffectLookup } from "../src/effect/structured-effect-registrations";

const fieldEffectLookup = (() => undefined) as Parameters<
  typeof getLegalActions
>[0]["getRegisteredFieldCardEffectActions"];

function makeAttackerWithDualAttackEffects(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `P3-53 dual ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { zone: "field" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { zone: "field" },
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
      },
    ],
  };
}

function setupAttackWithDualPrompts(def: CardDefinition): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def, {
        instanceId: "alice-attacker",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
        exhaustState: "exhausted",
      }),
    ],
    playerOverrides: [{ deckCount: 5 }],
    battleEntities: [
      {
        entityId: "battle-entity:alice-attacker",
        memberInstanceIds: ["alice-attacker"],
        resolvedBp: 2000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-group:1:alice:battle-entity:alice-attacker",
      primaryEntityId: "battle-entity:alice-attacker",
      participantEntityIds: ["battle-entity:alice-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:alice-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:alice-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
    },
    battleImmediateEffects: [
      {
        promptId: "p3-53-prompt-0",
        attackId: "attack-group:1:alice:battle-entity:alice-attacker",
        timing: "attack",
        sourceKind: "spirit",
        sourceInstanceId: "alice-attacker",
        sourceDefinitionId: def.cardNo,
        sourceCardNo: def.cardNo,
        actingPlayerId: "alice",
        participantEntityId: "battle-entity:alice-attacker",
        registrationIndex: 0,
      },
      {
        promptId: "p3-53-prompt-1",
        attackId: "attack-group:1:alice:battle-entity:alice-attacker",
        timing: "attack",
        sourceKind: "spirit",
        sourceInstanceId: "alice-attacker",
        sourceDefinitionId: def.cardNo,
        sourceCardNo: def.cardNo,
        actingPlayerId: "alice",
        participantEntityId: "battle-entity:alice-attacker",
        registrationIndex: 1,
      },
    ],
  });
  return {
    ...base,
    step: "attack",
    window: "flash_before_block",
    activePlayerId: "alice",
    turnNumber: 2,
  };
}

describe("P3-53 follow-up: 多重 BIE 中の pass_battle_flash 配信", () => {
  it("alice が prompt-0 を declare した後、prompt-1 が queue に残っていても bob は pass_battle_flash を取れる", () => {
    const def = makeAttackerWithDualAttackEffects("P3-53-DUAL-PASS");
    const lookup = (id: string) => (id === def.cardNo ? def : undefined);
    const battleImmediateLookup = buildBattleImmediateEffectLookup([def]);

    const baseState = setupAttackWithDualPrompts(def);

    // alice が prompt-0 を発揮宣言
    const aliceActions = getLegalActions({
      state: baseState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    });
    const declarePrompt0 = aliceActions.find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        "promptId" in a &&
        (a as { promptId?: string }).promptId === "p3-53-prompt-0"
    );
    expect(declarePrompt0).toBeDefined();

    const afterDeclare = applyLegalAction({
      state: baseState,
      action: declarePrompt0!,
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    // 確認: prompt-0 は queue から外れたが prompt-1 は残っている
    expect(
      afterDeclare.state.battleImmediateEffects.map((p) => p.promptId)
    ).toEqual(["p3-53-prompt-1"]);
    expect(
      afterDeclare.state.activeAttack?.flashWindowState?.pendingStackAction
    ).not.toBeNull();
    expect(
      afterDeclare.state.activeAttack?.flashWindowState?.priorityPlayerId
    ).toBe("bob");

    // 修正前のバグ: bob は pass_battle_flash を取得できず詰む
    // 修正後: pending BIE が残っていても pendingStackAction セット中は pass_battle_flash が legal
    const bobActions = getLegalActions({
      state: afterDeclare.state,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    });
    const bobPass = bobActions.find((a) => a.kind === "pass_battle_flash");
    expect(bobPass).toBeDefined();
  });
});
