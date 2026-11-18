/**
 * トラッシュゾーン束縛 effect_immunity (`while_in_trash`) の回帰テスト。
 *
 * 「トラッシュにあるこのカードは一切の効果を受けない」型のゾーン束縛常時耐性
 * (10_rules/03b §常在効果)。while_set / while_on_field と対称に、
 * - トラッシュ滞在中のみ rebuild が defense_immune を登録する
 * - トラッシュを離れると recompute が CE を除去する
 * - フィールド/手札では登録されない
 *
 * 対象カード: BSTH002-M01 / BSTH08-C01 / BSSG01-R01 / BSKB01-R04 /
 * BSKB01-C06 / BSTH04-R01 / BSTH03-C11 / BSTH04-C11 effects[0]。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  applyLegalAction,
  collectContinuousEffectInvariantIssues,
  getStrongestDefenseLevel,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
  executeBattleResolution,
  useSummonInStackContextAsAction,
  useResolvePendingTriggeredEffectAsAction,
} from "../src";
import { moveCompletedInUseMagicCardToTrashIfReady } from "../src/effect/effect-resolution";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { resolveDeferredStackAction } from "../src/legal/stack-resolution-core";
import { flushPendingLeavesAndRecomputeContinuousEffects } from "../src/zone/pending-leave-continuous-upkeep";
import type {
  BattleEntity,
  CardDefinition,
  GameState,
  GameStateInvariantIssue,
  PendingTriggeredEffect,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const TRASH_IMMUNITY_CARDS = [
  "BSTH002-M01",
  "BSTH08-C01",
  "BSSG01-R01",
  "BSKB01-R04",
  "BSKB01-C06",
  "BSTH04-R01",
  "BSTH03-C11",
  "BSTH04-C11",
] as const;
const ALL_SOURCE_TRASH_IMMUNITY_CARDS = new Set<string>([
  "BSTH04-R01",
  "BSTH03-C11",
  // P3-144: 「一切の効果を受けない」型 (Q7010/Q7065/Q25555 裁定、自分の効果も止める)
  "BSTH002-M01",
  "BSTH08-C01",
  "BSSG01-R01",
  "BSKB01-R04",
  "BSTH04-C11",
]);
const SELF_SOURCE_TRASH_IMMUNITY_CARDS = new Set<string>(["BSKB01-C06"]);
const EXCLUDE_SELF_SOURCE_TRASH_IMMUNITY_CARDS = new Set<string>([
  "BSTH03-C11",
]);

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

function makeSelfContinuousImmunityDef(
  cardNo: string,
  printedCategory: CardDefinition["printedCategory"] = "spirit"
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory,
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: ["yellow"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
            },
          },
        ],
      },
    ],
  };
}

function makeFieldSelfPlacementContinuousDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: ["yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュに置かれたこのカードはフィールドに置く。",
      "フィールドにある間、このカードは効果を受けない。",
    ],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: ["moved_to_trash"] },
        executionMode: "mandatory",
        cardEventDisposition: { kind: "move", destination: "field" },
        steps: [{ action: { kind: "move_self", destination: "field" } }],
        textRef: [0],
      },
      {
        timing: { kind: "continuous" },
        applicability: { zone: "field" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [1],
      },
    ],
  };
}

function trashImmunityEffect(def: CardDefinition) {
  return def.effects!.find(
    (e) =>
      e.timing.kind === "continuous" &&
      e.steps.some((s) => s.action.kind === "effect_immunity") &&
      (Array.isArray(e.applicability?.zone)
        ? e.applicability!.zone.includes("trash")
        : e.applicability?.zone === "trash")
  );
}

describe("トラッシュゾーン束縛 effect_immunity (while_in_trash)", () => {
  it("中断後に in_use から trash へ片付けるマジックのトラッシュ常時耐性を再登録する", () => {
    const def = cardNoMap.get("BSLH01-C14")!;
    const source = createCardInstance(def, {
      instanceId: "in-use-trash-immunity",
      ownerPlayerId: "alice",
      zone: "in_use",
    });
    const result = moveCompletedInUseMagicCardToTrashIfReady({
      state: { ...makeState(), cardInstances: [source] },
      sourceInstanceId: source.instanceId,
      getCardDefinitionById,
      logLabel: "test-deck-reveal-resume",
    });

    expect(
      result.cardInstances.find((card) => card.instanceId === source.instanceId)
        ?.zone
    ).toBe("trash");
    expect(
      result.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === source.instanceId &&
          ce.modifierTag === "defense_immune" &&
          ce.provenance?.effectIndex === 0
      )
    ).toBe(true);
    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: result,
      issues,
      getCardDefinitionById,
    });
    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("離脱待機中の field カードは recompute で新規 continuous effect を登録しない", () => {
    const def = makeSelfContinuousImmunityDef("TEST-PENDING-CE");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "pending-ce",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          pendingLeaveKind: "destroy",
        }),
      ],
    };

    const rebuilt = recomputeAndRebuildContinuousEffects(state, (id) =>
      id === def.cardNo ? def : undefined
    );

    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "pending-ce" &&
          ce.modifierTag === "defense_immune"
      )
    ).toHaveLength(0);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: rebuilt,
      issues,
      getCardDefinitionById: (id) => (id === def.cardNo ? def : undefined),
    });
    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("pending leave flush が選択待ちを開いただけならホストから新規 continuous effect を登録しない", () => {
    const hostDef = makeSelfContinuousImmunityDef("TEST-PENDING-HOST");
    const braveDef = {
      ...makeSelfContinuousImmunityDef("TEST-PENDING-BRAVE", "brave"),
      effects: [],
    };
    const defs = new Map([
      [hostDef.cardNo, hostDef],
      [braveDef.cardNo, braveDef],
    ]);
    const getDef = (id: string) => defs.get(id);
    const host = createCardInstance(hostDef, {
      instanceId: "pending-host",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveKind: "destroy",
      attachedChildrenIds: ["pending-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "pending-brave",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
      attachedToInstanceId: "pending-host",
    });
    const state: GameState = {
      ...makeState(),
      cardInstances: [host, brave],
      pendingLeaveEntities: [
        {
          instanceId: "pending-host",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "test-pending-brave-choice",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const after = flushPendingLeavesAndRecomputeContinuousEffects(
      state,
      getDef
    );
    const hostAfter = after.cardInstances.find(
      (card) => card.instanceId === "pending-host"
    )!;

    expect(after.pendingBraveLeaveChoice?.hostInstanceId).toBe("pending-host");
    expect(hostAfter.zone).toBe("field");
    expect(hostAfter.pendingLeaveKind).toBe("destroy");
    expect(
      after.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === "pending-host" &&
          ce.modifierTag === "defense_immune"
      )
    ).toHaveLength(0);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: after,
      issues,
      getCardDefinitionById: getDef,
    });
    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("field から trash を経由して field に戻ったカードの continuous effect を再登録する", () => {
    const def = makeFieldSelfPlacementContinuousDef("TEST-FIELD-RETURN-CE");
    const getDef = (id: string) => (id === def.cardNo ? def : undefined);
    const card = createCardInstance(def, {
      instanceId: "field-return-ce",
      ownerPlayerId: "alice",
      zone: "field",
      pendingLeaveKind: "destroy",
    });
    const state: GameState = {
      ...makeState(),
      turnNumber: 3,
      cardInstances: [card],
      pendingLeaveEntities: [
        {
          instanceId: card.instanceId,
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "test-field-magic-self-placement",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const after = flushPendingLeavesAndRecomputeContinuousEffects(
      state,
      getDef
    );
    const afterCard = after.cardInstances.find(
      (c) => c.instanceId === card.instanceId
    )!;

    expect(afterCard.zone).toBe("field");
    expect(afterCard.pendingLeaveKind).toBeNull();
    expect(
      after.log.some((entry) =>
        entry.startsWith("moved_to_trash:move_to_field:alice:")
      )
    ).toBe(true);
    expect(
      after.activeContinuousEffects.filter(
        (ce) =>
          ce.sourceInstanceId === card.instanceId &&
          ce.modifierTag === "defense_immune"
      )
    ).toHaveLength(1);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: after,
      issues,
      getCardDefinitionById: getDef,
    });
    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it.each(TRASH_IMMUNITY_CARDS)(
    "%s: effects[0] が while_in_trash の effect_immunity (stub 解消)",
    (cardNo) => {
      const def = cardNoMap.get(cardNo)!;
      const effect = trashImmunityEffect(def);
      expect(effect).toBeDefined();
      // stub フィールドが残っていないこと (忠実度違反の解消)
      expect(
        (effect as { stub?: string }).stub,
        `${cardNo} effect should not be a stub`
      ).toBeUndefined();
      const action = effect!.steps.find(
        (s) => s.action.kind === "effect_immunity"
      )!.action as {
        kind: string;
        duration: { scope: string };
        sourcePlayerScope?: "opponent" | "self" | "any";
        sourceScope?: { excludeSelf?: boolean };
      };
      expect(action.kind).toBe("effect_immunity");
      expect(action.duration.scope).toBe("while_in_trash");
      expect(action.sourcePlayerScope).toBe(
        ALL_SOURCE_TRASH_IMMUNITY_CARDS.has(cardNo)
          ? "any"
          : SELF_SOURCE_TRASH_IMMUNITY_CARDS.has(cardNo)
            ? "self"
            : undefined
      );
      expect(action.sourceScope?.excludeSelf ?? false).toBe(
        EXCLUDE_SELF_SOURCE_TRASH_IMMUNITY_CARDS.has(cardNo)
      );
    }
  );

  it.each(TRASH_IMMUNITY_CARDS)(
    "%s: トラッシュ滞在中は rebuild で defense_immune が登録され immune になる",
    (cardNo) => {
      const def = cardNoMap.get(cardNo)!;
      const state: GameState = {
        ...makeState(),
        cardInstances: [
          createCardInstance(def, {
            instanceId: `${cardNo}-trash`,
            ownerPlayerId: "alice",
            zone: "trash",
            cores: 0,
          }),
        ],
      };

      const rebuilt = rebuildContinuousEffectsFromField(
        state,
        getCardDefinitionById
      );

      const immune = rebuilt.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "defense_immune"
      );
      expect(immune).toHaveLength(1);
      expect(immune[0]!.targetInstanceId).toBe(`${cardNo}-trash`);
      expect(getStrongestDefenseLevel(rebuilt, `${cardNo}-trash`)).toBe(
        SELF_SOURCE_TRASH_IMMUNITY_CARDS.has(cardNo) ||
          EXCLUDE_SELF_SOURCE_TRASH_IMMUNITY_CARDS.has(cardNo)
          ? "none"
          : "immune"
      );
      // 相手起因の効果から保護される (盤面効果: カード対象耐性が機能する)
      const card = rebuilt.cardInstances[0]!;
      expect(isCardImmuneToOpponentEffect(rebuilt, card, "bob")).toBe(
        !SELF_SOURCE_TRASH_IMMUNITY_CARDS.has(cardNo)
      );
      expect(isCardImmuneToOpponentEffect(rebuilt, card, "alice")).toBe(
        ALL_SOURCE_TRASH_IMMUNITY_CARDS.has(cardNo) ||
          SELF_SOURCE_TRASH_IMMUNITY_CARDS.has(cardNo)
      );
    }
  );

  it("BSTH03-C11: このカード自身の効果だけは trash 耐性を通過する", () => {
    const def = cardNoMap.get("BSTH03-C11")!;
    const otherDef = cardNoMap.get("BSTH08-C01")!;
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "c11-trash",
          ownerPlayerId: "alice",
          zone: "trash",
          cores: 0,
        }),
        createCardInstance(otherDef, {
          instanceId: "alice-other-source",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(otherDef, {
          instanceId: "bob-other-source",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const target = rebuilt.cardInstances.find(
      (card) => card.instanceId === "c11-trash"
    )!;
    const selfSource = target;
    const aliceOtherSource = rebuilt.cardInstances.find(
      (card) => card.instanceId === "alice-other-source"
    )!;
    const bobOtherSource = rebuilt.cardInstances.find(
      (card) => card.instanceId === "bob-other-source"
    )!;

    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        target,
        "alice",
        "none",
        { instance: selfSource, definition: def },
        getCardDefinitionById
      )
    ).toBe(false);
    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        target,
        "alice",
        "none",
        { instance: aliceOtherSource, definition: otherDef },
        getCardDefinitionById
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        rebuilt,
        target,
        "bob",
        "none",
        { instance: bobOtherSource, definition: otherDef },
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("手札/フィールドのカードは defense_immune が登録されない (ゾーン束縛)", () => {
    const def = cardNoMap.get("BSTH002-M01")!;
    for (const zone of ["hand", "field"] as const) {
      const state: GameState = {
        ...makeState(),
        cardInstances: [
          createCardInstance(def, {
            instanceId: `m01-${zone}`,
            ownerPlayerId: "alice",
            zone,
            cores: 0,
          }),
        ],
      };
      const rebuilt = rebuildContinuousEffectsFromField(
        state,
        getCardDefinitionById
      );
      expect(
        rebuilt.activeContinuousEffects.filter(
          (ce) => ce.modifierTag === "defense_immune"
        )
      ).toHaveLength(0);
      expect(getStrongestDefenseLevel(rebuilt, `m01-${zone}`)).toBe("none");
    }
  });

  it("トラッシュ→手札遷移後は recompute で defense_immune が除去される", () => {
    const def = cardNoMap.get("BSTH08-C01")!;
    const trashState: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "c01",
          ownerPlayerId: "alice",
          zone: "trash",
          cores: 0,
        }),
      ],
    };

    // トラッシュ中: 登録される
    const registered = rebuildContinuousEffectsFromField(
      trashState,
      getCardDefinitionById
    );
    expect(getStrongestDefenseLevel(registered, "c01")).toBe("immune");

    // 手札へ移動 → recompute で while_in_trash CE が除去される
    const moved: GameState = {
      ...registered,
      cardInstances: registered.cardInstances.map((c) =>
        c.instanceId === "c01" ? { ...c, zone: "hand" as const } : c
      ),
    };
    const recomputed = recomputeAndRebuildContinuousEffects(
      moved,
      getCardDefinitionById
    );

    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "defense_immune"
      )
    ).toHaveLength(0);
    expect(getStrongestDefenseLevel(recomputed, "c01")).toBe("none");
  });

  it("トラッシュカードの他 continuous 効果 (override_properties) は登録されない", () => {
    // BSTH002-M01 effects[1] は系統付与 (override_properties)。トラッシュでは
    // applicability.zone:trash を持たないため REBUILD_ZONES 拡張で誤登録されないこと。
    const def = cardNoMap.get("BSTH002-M01")!;
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "m01",
          ownerPlayerId: "alice",
          zone: "trash",
          cores: 0,
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    expect(
      rebuilt.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "override_properties"
      )
    ).toHaveLength(0);
    // 期待されるのは defense_immune 1 件のみ
    expect(rebuilt.activeContinuousEffects).toHaveLength(1);
    expect(rebuilt.activeContinuousEffects[0]!.modifierTag).toBe(
      "defense_immune"
    );
  });

  it("効果解決後の pending leave flush で field から trash に移った hand/trash 耐性を再登録する", () => {
    const def = cardNoMap.get("BSLH01-C03")!;
    const before: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "pom",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const afterCoreRemoved: GameState = {
      ...before,
      cardInstances: before.cardInstances.map((card) =>
        card.instanceId === "pom" ? { ...card, normalCoreCount: 0 } : card
      ),
    };

    const finalized = finalizeEffectResolution({
      state: afterCoreRemoved,
      beforeState: before,
      chainId: "test-field-to-trash-immunity",
      endLogs: [],
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: null,
    });

    const pom = finalized.cardInstances.find((c) => c.instanceId === "pom")!;
    expect(pom.zone).toBe("trash");
    expect(
      finalized.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "pom" && ce.modifierTag === "defense_immune"
      )
    ).toBe(true);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: finalized,
      issues,
      getCardDefinitionById,
    });
    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("誘発効果解決の pending leave flush でも field から trash に移った hand/trash 耐性を再登録する", () => {
    const def = cardNoMap.get("BSLH01-C03")!;
    const before: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "pom",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const pending: PendingTriggeredEffect = {
      pendingId: "pending-triggered-core-removal",
      actingPlayerId: "alice",
      eventKind: "summon",
      source: "action_resolution",
      chainId: "test:trash-zone-effect-immunity:684",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "pom",
      amount: null,
      step: before.step,
      window: before.window,
      resolvedSourceInstanceIds: [],
    };

    const result = useResolvePendingTriggeredEffectAsAction({
      state: {
        ...before,
        pendingTriggeredEffects: [pending],
      },
      actingPlayerId: "alice",
      pendingId: pending.pendingId,
      resolveEffect: (currentState) => ({
        ...currentState,
        cardInstances: currentState.cardInstances.map((card) =>
          card.instanceId === "pom" ? { ...card, normalCoreCount: 0 } : card
        ),
      }),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    const pom = result.state.cardInstances.find((c) => c.instanceId === "pom")!;
    expect(pom.zone).toBe("trash");
    expect(
      result.state.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "pom" && ce.modifierTag === "defense_immune"
      )
    ).toBe(true);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: result.state,
      issues,
      getCardDefinitionById,
    });
    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("バトル解決の pending leave flush でも field から trash に移った hand/trash 耐性を再登録する", () => {
    const def = cardNoMap.get("BSLH01-C03")!;
    const attacker = createCardInstance(def, {
      instanceId: "pom-attacker",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const blocker = createCardInstance(def, {
      instanceId: "pom-blocker",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const attackerEntityId = "battle-entity:pom-attacker";
    const blockerEntityId = "battle-entity:pom-blocker";
    const battleEntities: BattleEntity[] = [
      {
        entityId: attackerEntityId,
        memberInstanceIds: ["pom-attacker"],
        resolvedBp: 1000,
        resolvedSymbols: ["yellow"],
        attackState: "attacking",
      },
      {
        entityId: blockerEntityId,
        memberInstanceIds: ["pom-blocker"],
        resolvedBp: 9000,
        resolvedSymbols: ["yellow"],
        attackState: "blocking",
      },
    ];
    const state: GameState = {
      ...makeState(),
      step: "attack",
      window: "declare_block",
      cardInstances: [attacker, blocker],
      activeAttack: {
        attackId: "battle-flush-hand-trash-ce",
        primaryEntityId: attackerEntityId,
        participantEntityIds: [attackerEntityId],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: attackerEntityId,
            blockedByEntityIds: [blockerEntityId],
          },
        ],
        symbolResolutionOrder: [attackerEntityId],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities,
    };

    const result = executeBattleResolution({
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    const attackerAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "pom-attacker"
    )!;
    expect(attackerAfter.zone).toBe("trash");
    expect(
      result.state.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "pom-attacker" &&
          ce.modifierTag === "defense_immune"
      )
    ).toBe(true);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: result.state,
      issues,
      getCardDefinitionById,
    });
    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("召喚時の維持コア配置で field から trash に移った hand/trash 耐性を再登録する", () => {
    const pomDef = cardNoMap.get("BSLH01-C03")!;
    const summonDef = cardNoMap.get("BSAZ02-TR01(A)")!;
    const pom = createCardInstance(pomDef, {
      instanceId: "pom-enter-field-source",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const incoming = createCardInstance(summonDef, {
      instanceId: "incoming-ultimate",
      ownerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...makeState(),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [pom, incoming],
    };

    const declared = useSummonInStackContextAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: incoming.instanceId,
      paymentSources: [],
      fixedPaymentCost: 0,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const pending = resolveDeferredStackAction(
      declared.state,
      declared.activeStack,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
      }
    );
    const resolvePlacement = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(resolvePlacement).toBeDefined();

    const after = applyLegalAction({
      state: pending,
      action: resolvePlacement!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      enterFieldCorePlacements: [
        {
          kind: "card_normal",
          instanceId: pom.instanceId,
          amount: 1,
        },
      ],
    }).state;

    const pomAfter = after.cardInstances.find(
      (card) => card.instanceId === pom.instanceId
    )!;
    expect(pomAfter.zone).toBe("trash");
    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === pom.instanceId &&
          ce.targetInstanceId === pom.instanceId &&
          ce.modifierTag === "defense_immune"
      )
    ).toBe(true);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: after,
      issues,
      getCardDefinitionById,
    });
    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });
});
