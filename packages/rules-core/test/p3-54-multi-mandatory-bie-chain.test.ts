/**
 * P3-54 Phase C: 強制発揮 + target 不要の battle-immediate effect が
 * 2 件以上積まれたとき、エンジン層から auto-exec 対象として正しく返ることの
 * regression guard。
 *
 * GUI 側 (BattleScreen.tsx) の auto-exec useEffect は
 * `myActions.every(isAutoExec)` で発火するため、エンジンから返る各 BIE legal
 * action が `executionMode === "mandatory"` + `requiredTargetCount === 0` +
 * `maxTargetCount === 0` を満たさないと auto-exec ループが詰まる。
 *
 * 本テストは「2 件の mandatory + target 不要 BIE が初期状態で同時に auto-exec
 * 適格として現れる」ことを確認する。1 件目を実行してからの連鎖は engine 内で
 * 中間 pending triggered (draw の後続誘発等) を経由するため engine 単体では
 * 検証せず、GUI 側の useEffect が state 変化に追随する責務に委ねる。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState, RegisteredMagicAction } from "../src";
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

const noMagicLookup = (() => undefined) as (
  cardNo: string
) => readonly RegisteredMagicAction[] | undefined;

function makeAttackerWithDualAttackEffects(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `P3-54 dual ${cardNo}`,
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
        promptId: "p3-54-prompt-0",
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
        promptId: "p3-54-prompt-1",
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

describe("P3-54 Phase C: 多重 mandatory BIE auto-exec chain", () => {
  it("2 件の mandatory + target 不要 BIE が同時に auto-exec 適格として返る", () => {
    const def = makeAttackerWithDualAttackEffects("P3-54-DUAL");
    const lookup = (id: string) => (id === def.cardNo ? def : undefined);
    const battleImmediateLookup = buildBattleImmediateEffectLookup([def]);

    const state = setupAttackWithDualPrompts(def);
    expect(state.battleImmediateEffects.length).toBe(2);

    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredMagicActions: noMagicLookup,
    });
    const bieActions = aliceActions.filter(
      (a) => a.kind === "resolve_battle_immediate_effect"
    );
    expect(bieActions.length).toBe(2);

    // 両方の BIE prompt は GUI auto-exec の判定条件を満たす:
    //   executionMode === "mandatory"
    //   requiredTargetCount === 0
    //   maxTargetCount === 0 (or undefined)
    //   choiceIndex === undefined
    // → BattleScreen.isAutoExec() が両方とも true を返す
    for (const a of bieActions) {
      const aa = a as {
        executionMode?: string;
        requiredTargetCount?: number;
        maxTargetCount?: number;
        choiceIndex?: number;
      };
      expect(aa.executionMode).toBe("mandatory");
      expect(aa.requiredTargetCount ?? 0).toBe(0);
      expect(aa.maxTargetCount ?? 0).toBe(0);
      expect(aa.choiceIndex).toBeUndefined();
    }

    // alice の手番に「auto-exec 不能な非 BIE/非 pass」アクションが
    // 混じっていないこと (混じっていると `every(isAutoExec)` が false になり詰まる)。
    // pass_battle_flash / open_battle_flash は priority player の選択肢として
    // 正常。それ以外の干渉アクションが無いか確認する。
    const allowed = new Set([
      "resolve_battle_immediate_effect",
      "pass_battle_flash",
      "open_battle_flash",
    ]);
    const unexpected = aliceActions.filter((a) => !allowed.has(a.kind));
    expect(unexpected).toEqual([]);

    // 1 件目を apply しても残り 1 件の BIE prompt は engine state に残っている
    const declare0 = bieActions.find(
      (a) => (a as { promptId?: string }).promptId === "p3-54-prompt-0"
    )!;
    const after1 = applyLegalAction({
      state,
      action: declare0,
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    expect(
      after1.state.battleImmediateEffects.some(
        (e) => e.promptId === "p3-54-prompt-1"
      )
    ).toBe(true);
  });
});
