import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  appendPublicDisclosuresForStateTransition,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState, ActiveAttack } from "../src/index";

/**
 * `card_event: "battle_end"` 一次トリガー（「バトル終了時」）。
 *
 * ルール正源: 10_rules/02_turn-flow-and-timing.md「バトル終了時 に誘発する効果を先に解決し」。
 * バトル解決完了時にバトル参加カード自身の battle_end 効果を pending 誘発として積む。
 * `アタックステップ終了時` (step_timing) とは区別する。
 */
describe("battle_end トリガー — バトル終了時に参加カードの効果を誘発する", () => {
  function makeSpirit(cardNo: string, withBattleEnd: boolean): CardDefinition {
    return {
      cardNo,
      name: cardNo,
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: ["red", "red"],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 2000 },
        { level: 2, requiredCores: 3, bp: 4000 },
      ],
      symbolColors: ["red"],
      textLines: withBattleEnd ? ["バトル終了時、カードを1枚引く。"] : [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      ...(withBattleEnd
        ? {
            effects: [
              {
                timing: { kind: "card_event", event: "battle_end" },
                steps: [{ action: { kind: "draw", count: 1 } }],
                textRef: [0],
              },
            ],
          }
        : {}),
    } as CardDefinition;
  }

  /** alice の attacker-1 が bob にアンブロックでアタック中、解決直前の状態。 */
  function buildMidBattleState(attackerDef: CardDefinition): GameState {
    const attacker = createCardInstance(attackerDef, {
      instanceId: "attacker-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 3,
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:be-1:1",
      primaryEntityId: "be-1",
      participantEntityIds: ["be-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "be-1", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [attacker],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-1",
          resolvedBp: 4000,
          attackState: "attacking",
          resolvedSymbols: ["red"],
          memberInstanceIds: ["attacker-1"],
        },
      ],
    };
  }

  it("battle_end 効果を持つ参加カードに pending 誘発が積まれる", () => {
    const def = makeSpirit("BE-SPIRIT-001", true);
    const lookup = buildTriggeredEffectLookup([def]);
    const getCardDefinitionById = (id: string) =>
      id === def.cardNo ? def : undefined;

    const resolved = executeBattleResolution({
      state: buildMidBattleState(def),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const battleEndPendings = resolved.state.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "battle_end"
    );
    expect(battleEndPendings).toHaveLength(1);
    expect(battleEndPendings[0]).toEqual(
      expect.objectContaining({
        eventKind: "battle_end",
        source: "battle_resolution",
        relatedInstanceId: "attacker-1",
        attackId: "attack:be-1:1",
      })
    );
  });

  it("battle_end 効果を持たない参加カードには pending を積まない (OPT_IN フィルタ)", () => {
    const def = makeSpirit("BE-SPIRIT-002", false);
    const lookup = buildTriggeredEffectLookup([def]);
    const getCardDefinitionById = (id: string) =>
      id === def.cardNo ? def : undefined;

    const resolved = executeBattleResolution({
      state: buildMidBattleState(def),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    expect(
      resolved.state.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "battle_end"
      )
    ).toHaveLength(0);
  });

  it("実際のバトル破壊はバトル情報を片付けた後も破壊として一度だけ記録する", () => {
    const def = makeSpirit("BE-LOG", false);
    const base = buildMidBattleState(def);
    const blocker = createCardInstance(def, {
      instanceId: "blocker-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const before: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, blocker],
      battleEntities: [
        ...base.battleEntities,
        {
          entityId: "be-blocker",
          resolvedBp: 2000,
          attackState: "blocking",
          resolvedSymbols: ["red"],
          memberInstanceIds: [blocker.instanceId],
        },
      ],
      activeAttack: {
        ...base.activeAttack!,
        blockAssignments: [
          { participantEntityId: "be-1", blockedByEntityIds: ["be-blocker"] },
        ],
      },
    };
    const resolved = executeBattleResolution({
      state: before,
      getCardDefinitionById: (id) => (id === def.cardNo ? def : undefined),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([def]),
      getRegisteredBurstActions: undefined,
    }).state;
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === blocker.instanceId
      )?.zone
    ).toBe("trash");
    expect(resolved.activeAttack).toBeNull();
    const observed = appendPublicDisclosuresForStateTransition({
      before,
      after: resolved,
      actorPlayerId: "alice",
    });
    expect(
      observed.publicDisclosures?.filter(
        (entry) => entry.kind === "battle_resolved"
      )
    ).toHaveLength(1);
    expect(
      observed.publicDisclosures
        ?.flatMap((entry) => entry.results)
        .filter((result) => result.instanceId === blocker.instanceId)
    ).toEqual([
      expect.objectContaining({ kind: "destroyed", actionLabel: "destroy" }),
    ]);
  });
});
