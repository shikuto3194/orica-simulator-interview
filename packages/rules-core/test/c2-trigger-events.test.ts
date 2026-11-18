import { recordSemanticTriggerEvent } from "../src/effect/semantic-trigger-events";
/**
 * P3-14 C-2: 不足トリガーイベント 3 種の実装テスト。
 *
 * - attack / block: アタック/ブロック宣言成立後の game_event 観測
 *   (「自分の「X」がアタック/ブロックしたとき」BSFT01-C04 型)。
 *   自カードの『アタック時』(battle immediate) とは別系統で、二重発火しないこと。
 * - brave_combined: 合体成立 (「合体したとき」BSRK01-X01 / BSAZ01-C18 型) の delta 検出。
 * - core_placed_on_life: ライフへのコア配置 (「自分の黄/紫の効果でライフにコアを
 *   置いたとき」BSTH03-C21 型)。trigger_colors は原因カード (relatedInstanceId) の色で評価。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import {
  applyLegalAction,
  getLegalActions,
  useAttackAsAction,
} from "../src/index";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
  queueBattleDeclarationTriggers,
} from "../src/effect/trigger-system";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

function makeCard(
  cardNo: string,
  category: string,
  effects: CardDefinition["effects"] = undefined,
  extra: Partial<CardDefinition> = {}
): CardDefinition {
  const base = {
    cardNo,
    name: cardNo,
    printedCategory: category,
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs:
      category === "magic" ? [] : [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...extra,
  } as CardDefinition;
  return effects !== undefined ? { ...base, effects } : base;
}

function createLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

describe("P3-14 C-2: attack / block game_event 観測トリガー", () => {
  it("「自分のスピリットがアタックしたとき」のネクサスリスナーに pending が積まれる", () => {
    const attackerDef = makeCard("C2-ATK-01", "spirit");
    const nexusDef = makeCard("C2-NEXUS-01", "nexus", [
      {
        timing: { kind: "game_event", player: "self", event: "attack" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackerDef, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(nexusDef, {
            instanceId: "nexus-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 0,
          }),
        ],
      }),
      step: "attack",
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const lookup = createLookup([attackerDef, nexusDef]);
    const triggerLookup = buildTriggeredEffectLookup([attackerDef, nexusDef]);

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(tentative.window).toBe("pre_declaration_stack");
    // 相手 pass で宣言前スタック窓を閉じ、アタック確定 (confirmAttackDeclarationAsAction) まで進める
    const after = applyLegalAction({
      state: tentative,
      action: {
        kind: "pass_pre_declaration_stack",
        actionId: "pass-pre-decl:bob",
        can: true,
        reason: "test",
        actingPlayerId: "bob",
      } as never,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    const attackPendings = after.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "attack"
    );
    expect(attackPendings).toHaveLength(1);
    expect(attackPendings[0]!.relatedInstanceId).toBe("attacker-1");
    expect(attackPendings[0]!.event).toMatchObject({
      family: "battle_declaration",
      actionKind: "attack",
    });
  });

  it("アタック宣言成立で attackDeclarationLog にエントリが積まれる (attack_occurred ConditionClause の SSOT、BSSL01-M01 型)", () => {
    const attackerDef = makeCard("C2-ATK-03", "spirit");
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackerDef, {
            instanceId: "attacker-3",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack",
      turnNumber: 3,
      activePlayerId: "alice",
    };
    const lookup = createLookup([attackerDef]);
    const triggerLookup = buildTriggeredEffectLookup([attackerDef]);

    expect(state.attackDeclarationLog).toEqual([]);

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-3",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const after = applyLegalAction({
      state: tentative,
      action: {
        kind: "pass_pre_declaration_stack",
        actionId: "pass-pre-decl:bob",
        can: true,
        reason: "test",
        actingPlayerId: "bob",
      } as never,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;

    expect(after.attackDeclarationLog).toHaveLength(1);
    expect(after.attackDeclarationLog[0]).toMatchObject({
      playerId: "alice",
      cardInstanceId: "attacker-3",
      cardDefinitionId: "C2-ATK-03",
      turnNumber: 3,
      step: "attack",
    });
  });

  it("リスナー不在なら attack pending は積まれない (空 pending 吸収)", () => {
    const attackerDef = makeCard("C2-ATK-02", "spirit");
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackerDef, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack",
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const lookup = createLookup([attackerDef]);
    const triggerLookup = buildTriggeredEffectLookup([attackerDef]);

    const after = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });

    expect(
      after.pendingTriggeredEffects.filter((p) => p.eventKind === "attack")
    ).toHaveLength(0);
  });

  it("block: queueBattleDeclarationTriggers が block リスナーに pending を積む", () => {
    const blockerDef = makeCard("C2-BLK-01", "spirit");
    const nexusDef = makeCard("C2-NEXUS-02", "nexus", [
      {
        timing: { kind: "game_event", player: "self", event: "block" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(blockerDef, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(nexusDef, {
            instanceId: "nexus-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 0,
          }),
        ],
      }),
      step: "attack",
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const triggerLookup = buildTriggeredEffectLookup([blockerDef, nexusDef]);

    const after = queueBattleDeclarationTriggers({
      chainId: "test:c2-trigger-events:237",
      state,
      kind: "block",
      declaringInstanceId: "blocker-1",
      declaringPlayerId: "bob",
      getCardDefinitionById: createLookup([blockerDef, nexusDef]),
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
    });

    const blockPendings = after.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "block"
    );
    expect(blockPendings).toHaveLength(1);
    expect(blockPendings[0]!.event).toMatchObject({
      family: "battle_declaration",
      actionKind: "block",
    });
    // attack リスナーは block イベントに反応しない (actionKind 不一致)
    expect(
      after.pendingTriggeredEffects.filter((p) => p.eventKind === "attack")
    ).toHaveLength(0);
  });
});

describe("P3-14 C-2: brave_combined (型付き合体イベント)", () => {
  it("異魔神の通常LegalAction右合体は左を再収集せず右hostへの合体だけ誘発する", () => {
    const hostDef = makeCard("C2-IMAGIN-HOST", "spirit");
    const braveDef = makeCard(
      "C2-IMAGIN",
      "brave",
      [
        {
          timing: { kind: "card_event", event: "brave_combined" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
      { imaginBraveData: { sharedCondition: { categories: ["spirit"] } } }
    );
    const lookup = createLookup([hostDef, braveDef]);
    const triggerLookup = buildTriggeredEffectLookup([hostDef, braveDef]);
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(hostDef, {
            instanceId: "left",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
            attachedChildrenIds: ["imagin"],
          }),
          createCardInstance(hostDef, {
            instanceId: "right",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(braveDef, {
            instanceId: "imagin",
            ownerPlayerId: "alice",
            zone: "field",
            attachedToInstanceId: "left",
          }),
        ],
      }),
      step: "main",
      activePlayerId: "alice",
    };
    const beforeState = state;
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find(
      (a) => a.kind === "brave_combine" && a.targetInstanceId === "right"
    );
    expect(action).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).state;
    const pending = state.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "brave_combined"
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      relatedInstanceId: "imagin",
      triggerRelatedCombinedHostInstanceId: "right",
    });
    expect(pending[0]!.cause).toBeUndefined();
    const events = collectTriggerEventsFromStateDelta({
      beforeState,
      afterState: state,
      source: "action_resolution",
      chainId: "right-check",
      getCardDefinitionById: lookup,
    });
    expect(
      events
        .filter((e) => e.eventKind === "brave_combined")
        .map((e) => e.triggerRelatedCombinedHostInstanceId)
    ).toEqual([]);
    expect(
      collectTriggerEventsFromStateDelta({
        beforeState: state,
        afterState: state,
        source: "action_resolution",
        chainId: "no-change",
        getCardDefinitionById: lookup,
      }).filter((e) => e.eventKind === "brave_combined")
    ).toHaveLength(0);
  });

  it("型付き合体イベントで brave 自身の card_event:brave_combined が誘発する", () => {
    const hostDef = makeCard("C2-HOST-01", "spirit");
    const braveDef = makeCard("C2-BRAVE-01", "brave", [
      {
        timing: { kind: "card_event", event: "brave_combined" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ]);
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const braveBefore = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const beforeState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, braveBefore],
      }),
      activePlayerId: "alice",
    };
    const afterState: GameState = {
      ...beforeState,
      cardInstances: beforeState.cardInstances.map((c) =>
        c.instanceId === "brave-1"
          ? { ...c, attachedToInstanceId: "host-1" }
          : c.instanceId === "host-1"
            ? { ...c, attachedChildrenIds: ["brave-1"] }
            : c
      ),
    };
    const triggerLookup = buildTriggeredEffectLookup([hostDef, braveDef]);

    const queued = collectAndQueueTriggerReactions({
      chainId: "test:c2-trigger-events:302",
      beforeState,
      afterState: recordSemanticTriggerEvent(afterState, {
        eventKind: "brave_combined",
        relatedInstanceId: "brave-1",
        triggerRelatedCombinedHostInstanceId: "host-1",
      }),
      source: "action_resolution",
      getCardDefinitionById: createLookup([hostDef, braveDef]),
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
    });

    const pendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "brave_combined"
    );
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.relatedInstanceId).toBe("brave-1");
    expect(pendings[0]!.event).toMatchObject({ family: "brave_link" });
  });

  it("P3-111 S3: 型付き合体イベントのcause未指定 (召喚時合体/直接合体) では cause 未設定のまま発火する", () => {
    const hostDef = makeCard("C2-HOST-02", "spirit");
    const braveDef = makeCard("C2-BRAVE-02", "brave", [
      {
        timing: {
          kind: "card_event",
          event: "brave_combined",
          cause: ["contract_combine"],
        },
        condition: [{ kind: "combined" }],
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ]);
    const host = createCardInstance(hostDef, {
      instanceId: "host-2",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const braveBefore = createCardInstance(braveDef, {
      instanceId: "brave-2",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const beforeState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, braveBefore],
      }),
      activePlayerId: "alice",
    };
    const afterState: GameState = {
      ...beforeState,
      cardInstances: beforeState.cardInstances.map((c) =>
        c.instanceId === "brave-2"
          ? { ...c, attachedToInstanceId: "host-2" }
          : c.instanceId === "host-2"
            ? { ...c, attachedChildrenIds: ["brave-2"] }
            : c
      ),
    };
    const triggerLookup = buildTriggeredEffectLookup([hostDef, braveDef]);

    // 通常合体の型付きイベントはcauseを持たない。
    const queuedWithoutCause = collectAndQueueTriggerReactions({
      chainId: "test:c2-trigger-events:364",
      beforeState,
      afterState: recordSemanticTriggerEvent(afterState, {
        eventKind: "brave_combined",
        relatedInstanceId: "brave-2",
        triggerRelatedCombinedHostInstanceId: "host-2",
      }),
      source: "action_resolution",
      getCardDefinitionById: createLookup([hostDef, braveDef]),
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      queuedWithoutCause.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "brave_combined"
      )
    ).toHaveLength(0);

    // 契約合体の型付きイベント自身がcauseを持つ。
    const queuedWithCause = collectAndQueueTriggerReactions({
      chainId: "test:c2-trigger-events:379",
      beforeState,
      afterState: recordSemanticTriggerEvent(afterState, {
        eventKind: "brave_combined",
        relatedInstanceId: "brave-2",
        triggerRelatedCombinedHostInstanceId: "host-2",
        cause: "contract_combine",
      }),
      source: "action_resolution",
      getCardDefinitionById: createLookup([hostDef, braveDef]),
      getRegisteredTriggeredEffectActions: triggerLookup,
      getRegisteredBurstActions: undefined,
    });
    const pendings = queuedWithCause.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "brave_combined"
    );
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.cause).toBe("contract_combine");
    expect(pendings[0]!.event).toMatchObject({
      family: "brave_link",
      cause: "contract_combine",
    });
  });

  it("契約合体 (hand→field+attach 一括遷移) は summon ではなく、召喚/契約合体時だけ brave_combined として発火する", () => {
    const hostDef = makeCard("C2-CC-HOST-01", "spirit");
    const queueContractCombine = (braveDef: CardDefinition) => {
      const braveInstanceId = `${braveDef.cardNo}-instance`;
      const host = createCardInstance(hostDef, {
        instanceId: "host-cc-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      });
      const braveBefore = createCardInstance(braveDef, {
        instanceId: braveInstanceId,
        ownerPlayerId: "alice",
        zone: "hand",
        cores: 0,
      });
      const beforeState: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [host, braveBefore],
        }),
        activePlayerId: "alice",
      };
      const afterState: GameState = {
        ...beforeState,
        cardInstances: beforeState.cardInstances.map((c) =>
          c.instanceId === braveInstanceId
            ? {
                ...c,
                zone: "field" as const,
                attachedToInstanceId: "host-cc-1",
                zoneRoleName: "brave",
              }
            : c.instanceId === "host-cc-1"
              ? { ...c, attachedChildrenIds: [braveInstanceId] }
              : c
        ),
      };
      const defs = [hostDef, braveDef];
      return {
        braveInstanceId,
        queued: collectAndQueueTriggerReactions({
          chainId: "test:c2-trigger-events:440",
          beforeState,
          afterState: recordSemanticTriggerEvent(afterState, {
            eventKind: "brave_combined",
            relatedInstanceId: braveInstanceId,
            triggerRelatedCombinedHostInstanceId: "host-cc-1",
            cause: "contract_combine",
          }),
          source: "action_resolution",
          getCardDefinitionById: createLookup(defs),
          getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
          getRegisteredBurstActions: undefined,
        }),
      };
    };

    const summonOnlyBraveDef = makeCard(
      "C2-CC-SUMMON-ONLY",
      "brave",
      [
        {
          timing: { kind: "card_event", event: "summon" },
          textRef: [0, 1],
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
      {
        textLines: ["『このブレイヴの召喚時』", "1枚引く。"],
      }
    );
    const summonOnly = queueContractCombine(summonOnlyBraveDef);
    expect(
      summonOnly.queued.pendingTriggeredEffects.filter(
        (p) =>
          p.eventKind === "summon" &&
          p.relatedInstanceId === summonOnly.braveInstanceId
      )
    ).toHaveLength(0);
    expect(
      summonOnly.queued.pendingTriggeredEffects.filter(
        (p) =>
          p.eventKind === "brave_combined" &&
          p.relatedInstanceId === summonOnly.braveInstanceId
      )
    ).toHaveLength(0);

    const summonOrContractBraveDef = makeCard(
      "C2-CC-SUMMON-OR-CONTRACT",
      "brave",
      [
        {
          timing: { kind: "card_event", event: "summon" },
          textRef: [0, 1],
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
      {
        textLines: ["『このブレイヴの召喚/契約合体時』", "1枚引く。"],
      }
    );
    const summonOrContract = queueContractCombine(summonOrContractBraveDef);
    expect(
      summonOrContract.queued.pendingTriggeredEffects.filter(
        (p) =>
          p.eventKind === "summon" &&
          p.relatedInstanceId === summonOrContract.braveInstanceId
      )
    ).toHaveLength(0);
    const contractPendings =
      summonOrContract.queued.pendingTriggeredEffects.filter(
        (p) =>
          p.eventKind === "brave_combined" &&
          p.relatedInstanceId === summonOrContract.braveInstanceId
      );
    expect(contractPendings).toHaveLength(1);
    expect(contractPendings[0]!.cause).toBe("contract_combine");
  });

  it("game_event 観測 (「自分のスピリットに X が合体したとき」) も triggerFilter 付きで拾える", () => {
    const hostDef = makeCard("C2-HOST-02", "spirit");
    const braveDef = makeCard("C2-BRAVE-02", "brave", undefined, {
      tribe: "アルドノア",
    });
    const observerDef = makeCard("C2-OBSERVER-01", "nexus", [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "brave_combined",
          triggerFilter: { tribes: ["アルドノア"] },
        },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ]);
    const beforeState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(hostDef, {
            instanceId: "host-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(braveDef, {
            instanceId: "brave-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(observerDef, {
            instanceId: "observer-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 0,
          }),
        ],
      }),
      activePlayerId: "alice",
    };
    const afterState: GameState = {
      ...beforeState,
      cardInstances: beforeState.cardInstances.map((c) =>
        c.instanceId === "brave-1"
          ? { ...c, attachedToInstanceId: "host-1" }
          : c
      ),
    };
    const defs = [hostDef, braveDef, observerDef];
    const queued = collectAndQueueTriggerReactions({
      chainId: "test:c2-trigger-events:565",
      beforeState,
      afterState: recordSemanticTriggerEvent(afterState, {
        eventKind: "brave_combined",
        relatedInstanceId: "brave-1",
        triggerRelatedCombinedHostInstanceId: "host-1",
      }),
      source: "action_resolution",
      getCardDefinitionById: createLookup(defs),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: undefined,
    });

    expect(
      queued.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "brave_combined"
      )
    ).toHaveLength(1);
  });
});

describe("P3-14 C-2: core_placed_on_life (ライフへのコア配置)", () => {
  function buildLifeGainScenario(listenerColors: string[]) {
    // 原因カード: 黄のマジック (in_use 想定だが zone は任意でよい)
    const causeDef = makeCard("C2-CAUSE-01", "magic", undefined, {
      colors: ["yellow"],
    });
    const listenerDef = makeCard("C2-LIFE-LISTENER-01", "spirit", [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "core_placed_on_life",
        },
        condition: [
          { kind: "trigger_colors", colors: listenerColors as never },
        ],
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
      },
    ]);
    const beforeState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(causeDef, {
            instanceId: "cause-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(listenerDef, {
            instanceId: "listener-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      activePlayerId: "alice",
    };
    const afterState: GameState = {
      ...beforeState,
      players: beforeState.players.map((p) =>
        p.id === "alice"
          ? { ...p, lifeNormalCoreCount: p.lifeNormalCoreCount + 1 }
          : p
      ),
    };
    const defs = [causeDef, listenerDef];
    return collectAndQueueTriggerReactions({
      chainId: "test:c2-trigger-events:629",
      beforeState,
      afterState,
      source: "action_resolution",
      causedBySourceInstanceId: "cause-1",
      getCardDefinitionById: createLookup(defs),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: undefined,
    });
  }

  it("黄の効果でライフ増加 → trigger_colors:[yellow] リスナーに pending (amount=増加数)", () => {
    const queued = buildLifeGainScenario(["yellow"]);
    const pendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "core_placed_on_life"
    );
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.amount).toBe(1);
    expect(pendings[0]!.relatedInstanceId).toBe("cause-1");
    expect(pendings[0]!.event).toMatchObject({ family: "core_change" });
  });

  it("原因カードが青指定の trigger_colors に合わない場合は pending を積まない", () => {
    const queued = buildLifeGainScenario(["blue"]);
    expect(
      queued.pendingTriggeredEffects.filter(
        (p) => p.eventKind === "core_placed_on_life"
      )
    ).toHaveLength(0);
  });
});
