import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  flushPendingLeaves,
  advanceStep,
  type CardDefinition,
  type GameState,
  type Effect,
} from "../src";
import { matchesCardFilter } from "../src/card/card-filter";
import { canActivateNexusMechanicEffect } from "../src/mechanics/nexus-mechanic-suppression";
import { canActivateDivineSkillEffect } from "../src/legal/divine-skill-usage";
import {
  checkAndQueueUnsealChoicesForHandIncrease,
  checkAndQueueUnsealChoicesForCardEvent,
  checkAndQueueStoneRebirthChoices,
  resolveUnsealMechanic,
} from "../src/mechanics/grandstone-system";
import {
  checkAndQueueMagicStackDomain,
  resolveMagicStackDomainMechanic,
} from "../src/mechanics/oracle-system";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { resolveDeferredStackAction } from "../src/legal/stack-resolution-core";
import { resolveStoneRebirthMechanic } from "../src/legal/mechanic-trigger-handlers";
import { getAvailableMagicPaymentSources } from "../src/mechanics/magic-system";
import { executeReevaluationCheck } from "../src/legal/legal-actions-shared";
import { deriveSuppressionEffectDescriptor } from "../src/effect/structured-effect-registrations";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const defs = new Map(definitions.map((c) => [c.cardNo, c]));
const getDef = (id: string) => defs.get(id);
const lookup = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
const inst = (
  no: string,
  id: string,
  owner = "bob",
  cores = 4,
  zone: "field" | "deck" | "hand" = "field"
) =>
  createCardInstance(getDef(no)!, {
    instanceId: id,
    ownerPlayerId: owner,
    normalCoreCount: cores,
    zone,
  });
const find = (s: GameState, id: string) =>
  s.cardInstances.find((c) => c.instanceId === id)!;
const fixture = (no: string): GameState => ({
  ...createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ deckCount: 5 }, { deckCount: 5 }],
    cardInstances: [
      inst(no, "target"),
      inst("BSTH02.7-C01", "suppressor", "alice", 0, "hand"),
      inst("BSTH04-C01", "trigger"),
      inst("BSTH10.5-R21", "magic", "bob", 0, "hand"),
    ],
  }),
  activePlayerId: "bob",
  step: "main",
  turnNumber: 5,
});
// 実カードの抑止 action を実行。効果自体の条件・前段はこの境界テストの対象外。
function suppress(
  state: GameState,
  no = "BSTH02.7-C01",
  effectIndex = 2,
  stepIndex = 0
): GameState {
  const effect = getDef(no)!.effects![effectIndex]!;
  return executeEffect({
    chainId: "test:special-nexus-affect-audit:82",
    state,
    sourceInstanceId: "suppressor",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    effect: {
      timing: { kind: "activated", mode: "main" },
      steps: [effect.steps[stepIndex]!],
    },
  });
}
const queueHandUnseal = (s: GameState) =>
  checkAndQueueUnsealChoicesForHandIncrease(
    s,
    "bob",
    "trigger",
    getDef,
    "test:special-nexus-affect-audit:94"
  );
const unseal = {
  kind: "unseal",
  grandstoneInstanceId: "target",
  triggerEvent: "hand_increase",
  triggerCardInstanceId: "trigger",
} as const;
const rebirth = {
  kind: "stone_rebirth",
  grandstoneInstanceId: "target",
} as const;
const domain = {
  kind: "magic_stack_domain",
  grandwalkerInstanceId: "target",
  triggerCardInstanceId: "magic",
} as const;

describe("特殊ネクサス全定義 × 実カードの効果抑止", () => {
  it("創界石を明記しない抑止は創界石に作用せず、耐性のある創界石は明記された抑止も防ぐ", () => {
    const base = fixture("BSTH04-転醒R01(A)");
    expect(
      canActivateNexusMechanicEffect(
        suppress(base, "BSSG01-R02", 2, 1),
        "target",
        "unseal",
        getDef
      )
    ).toBe(true);
    const blocked = suppress(base);
    const immune: GameState = {
      ...blocked,
      activeContinuousEffects: [
        ...blocked.activeContinuousEffects,
        {
          effectId: "stone-immunity",
          sourceInstanceId: "target",
          sourceDefinitionId: find(base, "target").definitionId,
          targetInstanceId: "target",
          actingPlayerId: "bob",
          modifierTag: "defense_immune",
          duration: { scope: "turn" },
          createdAtTurn: 5,
          createdAtAttackId: null,
          immunityPlayerScope: "opponent",
        },
      ],
    };
    expect(queueHandUnseal(immune).pendingTriggeredEffects).toHaveLength(1);
    expect(
      find(
        resolveUnsealMechanic(
          immune,
          unseal,
          "bob",
          true,
          getDef,
          "test:special-nexus-affect-audit:143"
        ),
        "target"
      ).normalCoreCount
    ).toBe(5);
  });

  it("創界神を指定しないデッキオープン抑止は場の特殊ネクサスに作用しない", () => {
    const effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "deck_reveal", count: 1 } }],
    } as Effect;
    for (const no of [
      "BSAZ02-X04",
      "BSSA01-XX01",
      "BSTH04-転醒R01(A)",
      "BSTH04-C01",
    ]) {
      const state = suppress(fixture(no), "BSAZ02-C03", 1, 1);
      expect(
        executeReevaluationCheck({
          state,
          sourceInstanceId: "target",
          checkKind: "effect_suppression",
          targetInstanceIds: [],
          getCardDefinitionById: getDef,
          suppressionEffectDescriptor:
            deriveSuppressionEffectDescriptor(effect),
        })
      ).toBe(no !== "BSTH04-C01");
    }
  });

  it("神技の内容を指定した抑止もコア支払い前に判定する", () => {
    const def = definitions.find((c) =>
      c.grandwalkerData?.divineSkills?.some((s) =>
        s.effects?.some((e) =>
          deriveSuppressionEffectDescriptor(e).containsActionKinds?.includes(
            "deck_reveal"
          )
        )
      )
    )!;
    expect(def).toBeDefined();
    const index = def.grandwalkerData!.divineSkills!.findIndex((s) =>
      s.effects?.some((e) =>
        deriveSuppressionEffectDescriptor(e).containsActionKinds?.includes(
          "deck_reveal"
        )
      )
    );
    const base = fixture(def.cardNo);
    const blocked = suppress(base);
    const filtered = {
      ...blocked,
      activeContinuousEffects: blocked.activeContinuousEffects.map((ce) => ({
        ...ce,
        metadata: {
          ...ce.metadata,
          effectFilter: { containsActionKinds: ["deck_reveal"] },
        },
      })),
    };
    expect(canActivateDivineSkillEffect(base, "target", index, getDef)).toBe(
      true
    );
    expect(
      canActivateDivineSkillEffect(filtered, "target", index, getDef)
    ).toBe(false);
  });
  it.each(
    definitions
      .filter((c) => c.grandwalkerData || c.grandstoneData)
      .map((c) => [c.cardNo, c] as const)
  )("%s の固有効果を止め、期限切れで復帰する", (no, def) => {
    const base = fixture(no);
    const blocked = suppress(base);
    const kind = def.grandstoneData ? "unseal" : "oracle";
    expect(canActivateNexusMechanicEffect(base, "target", kind, getDef)).toBe(
      true
    );
    expect(
      canActivateNexusMechanicEffect(blocked, "target", kind, getDef)
    ).toBe(false);
    for (let i = 0; i < (def.grandwalkerData?.divineSkills?.length ?? 0); i++) {
      expect(canActivateDivineSkillEffect(base, "target", i, getDef)).toBe(
        true
      );
      expect(canActivateDivineSkillEffect(blocked, "target", i, getDef)).toBe(
        false
      );
    }
    const expired = advanceStep(
      { ...blocked, window: "step_end" },
      getDef,
      () => []
    );
    expect(
      canActivateNexusMechanicEffect(expired, "target", kind, getDef)
    ).toBe(true);
  });

  it("創界石の手札増加解封・閾値転醒は抑止中キューせず、解決直前も止める", () => {
    const base = fixture("BSTH04-転醒R01(A)");
    expect(queueHandUnseal(base).pendingTriggeredEffects).toHaveLength(1);
    const blocked = suppress(base);
    expect(queueHandUnseal(blocked).pendingTriggeredEffects).toEqual([]);
    expect(
      resolveUnsealMechanic(
        blocked,
        unseal,
        "bob",
        true,
        getDef,
        "test:special-nexus-affect-audit:248"
      )
    ).toEqual(blocked);
    expect(
      resolveStoneRebirthMechanic(
        lookup,
        blocked,
        rebirth,
        "bob",
        true,
        "test:special-nexus-affect-audit:252"
      )
    ).toEqual(blocked);
    const before = {
      ...base,
      cardInstances: base.cardInstances.map((c) =>
        c.instanceId === "target" ? { ...c, normalCoreCount: 3 } : c
      ),
    };
    expect(
      checkAndQueueStoneRebirthChoices(
        before,
        base,
        getDef,
        "test:special-nexus-affect-audit:261"
      ).pendingTriggeredEffects
    ).toHaveLength(1);
    expect(
      checkAndQueueStoneRebirthChoices(
        before,
        blocked,
        getDef,
        "test:special-nexus-affect-audit:265"
      ).pendingTriggeredEffects
    ).toEqual([]);
    expect(
      find(
        resolveUnsealMechanic(
          base,
          unseal,
          "bob",
          true,
          getDef,
          "test:special-nexus-affect-audit:269"
        ),
        "target"
      ).normalCoreCount
    ).toBe(5);
    expect(
      find(
        resolveStoneRebirthMechanic(
          lookup,
          base,
          rebirth,
          "bob",
          true,
          "test:special-nexus-affect-audit:274"
        ),
        "target"
      ).definitionId
    ).toBe("BSTH04-転醒R01(B)");
  });

  it("カードイベント解封も、各創界石の実際の条件に合うイベントで抑止する", () => {
    for (const stone of definitions.filter((c) =>
      c.grandstoneData?.unsealConditions.some((x) => x.cardFilter)
    )) {
      const condition = stone.grandstoneData!.unsealConditions.find(
        (x) => x.cardFilter
      )!;
      const triggerDef = definitions.find(
        (c) =>
          (!condition.cardFilter?.categories ||
            condition.cardFilter.categories.includes(c.printedCategory)) &&
          (!condition.cardFilter?.nameContains ||
            condition.cardFilter.nameContains.some((n) =>
              c.name.includes(n)
            )) &&
          (!condition.cardFilter?.tribes ||
            condition.cardFilter.tribes.some((t) => c.tribe?.includes(t)))
      );
      expect(triggerDef, stone.cardNo).toBeDefined();
      const base = fixture(stone.cardNo);
      const state = {
        ...base,
        cardInstances: base.cardInstances.map((c) =>
          c.instanceId === "trigger" ? inst(triggerDef!.cardNo, "trigger") : c
        ),
      };
      const event = condition.events.find((e) => e !== "hand_increase")!;
      expect(
        checkAndQueueUnsealChoicesForCardEvent(
          state,
          "trigger",
          event,
          getDef,
          "test:special-nexus-affect-audit:308"
        ).pendingTriggeredEffects.length,
        stone.cardNo
      ).toBeGreaterThan(0);
      expect(
        checkAndQueueUnsealChoicesForCardEvent(
          suppress(state),
          "trigger",
          event,
          getDef,
          "test:special-nexus-affect-audit:313"
        ).pendingTriggeredEffects
      ).toEqual([]);
    }
  });

  it("紫苑のスタック反応導域を止め、無条件のコスト支払い導域は維持する", () => {
    const base = fixture("BSTH10.5-X01");
    const blocked = suppress(base);
    expect(
      checkAndQueueMagicStackDomain(
        base,
        "magic",
        "stack",
        getDef,
        "test:special-nexus-affect-audit:327"
      ).pendingTriggeredEffects
    ).toHaveLength(1);
    expect(
      checkAndQueueMagicStackDomain(
        blocked,
        "magic",
        "stack",
        getDef,
        "test:special-nexus-affect-audit:331"
      ).pendingTriggeredEffects
    ).toEqual([]);
    expect(
      resolveMagicStackDomainMechanic(blocked, domain, "bob", true, getDef)
    ).toEqual(blocked);
    const after = resolveMagicStackDomainMechanic(
      base,
      domain,
      "bob",
      true,
      getDef
    );
    expect(after.players[0]!.deckCount).toBe(1);
    expect(find(after, "target").normalCoreCount).toBe(5);
    expect(
      getAvailableMagicPaymentSources({
        state: blocked,
        actingPlayerId: "bob",
        magicInstanceId: "magic",
        getCardDefinitionById: getDef,
      }).onBoardCoreSources.some((s) => s.instanceId === "target")
    ).toBe(true);
  });

  it.each(["unseal", "stone_rebirth", "magic_stack_domain"] as const)(
    "キュー済み%sはskipOnlyで排出し、宣言後に抑止されても盤面を変えない",
    (kind) => {
      const base = fixture(
        kind === "magic_stack_domain" ? "BSTH10.5-X01" : "BSTH04-転醒R01(A)"
      );
      const queued =
        kind === "unseal"
          ? queueHandUnseal(base)
          : kind === "magic_stack_domain"
            ? checkAndQueueMagicStackDomain(
                base,
                "magic",
                "stack",
                getDef,
                "test:special-nexus-affect-audit:366"
              )
            : checkAndQueueStoneRebirthChoices(
                {
                  ...base,
                  cardInstances: base.cardInstances.map((c) =>
                    c.instanceId === "target" ? { ...c, normalCoreCount: 3 } : c
                  ),
                },
                base,
                getDef,
                "test:special-nexus-affect-audit:367"
              );
      const action = getLegalActions({
        state: queued,
        actingPlayerId: "bob",
        ...lookup,
      }).find((a) => a.kind === "resolve_pending_triggered_effect")!;
      expect(action).toBeDefined();
      const blocked = suppress(queued);
      const skip = getLegalActions({
        state: blocked,
        actingPlayerId: "bob",
        ...lookup,
      }).find((a) => a.kind === "resolve_pending_triggered_effect")!;
      expect(skip).toMatchObject({ skipOnly: true });
      const drained = applyLegalAction({
        state: blocked,
        action: skip,
        ...lookup,
      }).state;
      expect(drained.pendingTriggeredEffects).toEqual([]);
      expect(drained.stackWindow).toBeNull();
      const declared = applyLegalAction({
        state: queued,
        action,
        ...lookup,
      }).state;
      const stack = declared.stackWindow!.pendingStackAction!;
      const after = resolveDeferredStackAction(
        suppress({ ...declared, stackWindow: null }),
        stack,
        lookup
      );
      expect(find(after, "target").definitionId).toBe(
        find(base, "target").definitionId
      );
      expect(find(after, "target").normalCoreCount).toBe(4);
      expect(after.players.map((p) => p.deckCount)).toEqual(
        base.players.map((p) => p.deckCount)
      );
    }
  );

  it("神奈子の転神で付与したアタック時効果も抑止する", () => {
    const base = fixture("BSTH05-X01");
    const transformed = executeEffect({
      chainId: "test:special-nexus-affect-audit:420",
      state: base,
      sourceInstanceId: "target",
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      effect:
        getDef("BSTH05-X01")!.grandwalkerData!.divineSkills![0]!.effects![0]!,
    });
    const events = [
      {
        chainId: "test:special-nexus-affect-audit:429",
        eventKind: "attack",
        relatedInstanceId: "target",
        relatedPlayerId: "bob",
      },
    ];
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      transformed,
      events,
      getDef
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    expect(
      queueGrantedEffectTriggersFromTriggerEvents(
        suppress(transformed),
        events,
        getDef
      ).pendingTriggeredEffects
    ).toEqual([]);
    const blocked = suppress(queued);
    const skip = getLegalActions({
      state: blocked,
      actingPlayerId: "bob",
      ...lookup,
    }).find((a) => a.kind === "resolve_pending_triggered_effect")!;
    expect(skip).toMatchObject({ skipOnly: true });
    expect(
      applyLegalAction({ state: blocked, action: skip, ...lookup }).state
        .stackWindow
    ).toBeNull();
  });

  it("付与された起動効果は列挙・古い宣言・スタック後の解決で抑止を再検査する", () => {
    const base = fixture("BSTH05-X01");
    const transformed = executeEffect({
      chainId: "test:special-nexus-affect-audit:463",
      state: base,
      sourceInstanceId: "target",
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      effect:
        getDef("BSTH05-X01")!.grandwalkerData!.divineSkills![0]!.effects![0]!,
    });
    const state: GameState = {
      ...transformed,
      activeContinuousEffects: transformed.activeContinuousEffects.map((ce) =>
        ce.modifierTag === "granted_effect"
          ? {
              ...ce,
              metadata: {
                ...ce.metadata,
                grantedEffect: {
                  timing: { kind: "activated", mode: "main" },
                  steps: [{ action: { kind: "draw", count: 1 } }],
                },
              },
            }
          : ce
      ),
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...lookup,
    }).find((a) => a.kind === "use_field_card_effect" && a.grantedEffectCeId)!;
    expect(action).toMatchObject({ sourceKind: "nexus" });
    const blocked = suppress(state);
    expect(
      getLegalActions({
        state: blocked,
        actingPlayerId: "bob",
        ...lookup,
      }).filter(
        (a) => a.kind === "use_field_card_effect" && a.grantedEffectCeId
      )
    ).toEqual([]);
    expect(
      applyLegalAction({ state: blocked, action, ...lookup }).state
    ).toMatchObject(blocked);
    const declared = applyLegalAction({ state, action, ...lookup }).state;
    const blockedAfterDeclaration = suppress({
      ...declared,
      stackWindow: null,
    });
    const after = resolveDeferredStackAction(
      blockedAfterDeclaration,
      declared.stackWindow!.pendingStackAction!,
      lookup
    );
    expect(after).toEqual(blockedAfterDeclaration);
    expect(after.players[1]!.handCount).toBe(state.players[1]!.handCount);
  });
});

describe("qa-002: 作用対象とコア配置先を区別する", () => {
  it.each(["BSGE01-M01", "BSGE01-M03", "BSGE01-M04"])(
    "%s の破壊・コア除去は導界者にも作用する",
    (no) => {
      const card = getDef(no)!;
      const action = card
        .effects!.flatMap((e) => e.steps)
        .map((s) => s.action)
        .find(
          (a) =>
            (a.kind === "destroy" || a.kind === "core_move") &&
            JSON.stringify(a).includes("targetsGrandwalker")
        )!;
      const base = fixture("BSAZ02-X04");
      const result = executeEffect({
        chainId: "test:special-nexus-affect-audit:536",
        state: base,
        sourceInstanceId: "suppressor",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [{ action }],
        },
        targetInstanceIds: ["target"],
      });
      if (action.kind === "destroy")
        expect(find(flushPendingLeaves(result, getDef), "target").zone).toBe(
          "trash"
        );
      else expect(find(result, "target").normalCoreCount).toBe(0);
    }
  );

  it("BSLH01-X08の自分ターンの抑止・デッキ戻しは導界者にも作用する", () => {
    const base = fixture("BSAZ02-X04");
    const blocked = suppress(base, "BSLH01-X08", 1, 0);
    expect(canActivateDivineSkillEffect(blocked, "target", 0, getDef)).toBe(
      false
    );
    const after = executeEffect({
      chainId: "test:special-nexus-affect-audit:561",
      state: base,
      sourceInstanceId: "suppressor",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [getDef("BSLH01-X08")!.effects![1]!.steps[1]!],
      },
      targetInstanceIds: ["target"],
    });
    expect(find(flushPendingLeaves(after, getDef), "target").zone).toBe("deck");
  });

  it.each(["BSTH05-M03", "BSTH11-R03"])(
    "%s の創界神へのコア追加は導界者を含めない",
    (no) => {
      const actions = getDef(no)!
        .effects!.flatMap((e) => e.steps)
        .map((s) => s.action)
        .filter(
          (a) =>
            (a.kind === "core_move" || a.kind === "core_distribute") &&
            a.from.kind === "void"
        );
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        if (
          !(
            (action.kind === "core_move" && action.to?.kind === "field_card") ||
            (action.kind === "core_distribute" && action.to.kind === "filter")
          )
        )
          throw new Error("core destination");
        const tribe =
          action.to.filter?.tribes?.[0] ??
          action.to.filter?.filterOr?.[1]?.tribes?.[0];
        const guided: CardDefinition = { ...getDef("BSAZ02-X04")!, tribe };
        const god: CardDefinition = { ...getDef("BSTH05-X01")!, tribe };
        const dual: CardDefinition = { ...getDef("BSTH05.5-XX01")!, tribe };
        expect(
          matchesCardFilter(
            inst(guided.cardNo, "guided"),
            guided,
            action.to.filter
          )
        ).toBe(false);
        expect(
          matchesCardFilter(inst(god.cardNo, "god"), god, action.to.filter)
        ).toBe(true);
        expect(
          matchesCardFilter(inst(dual.cardNo, "dual"), dual, action.to.filter)
        ).toBe(true);
        const base = fixture(guided.cardNo);
        const getVariant = (id: string) =>
          id === guided.cardNo ? guided : getDef(id);
        const after = executeEffect({
          chainId: "test:special-nexus-affect-audit:607",
          state: base,
          sourceInstanceId: "suppressor",
          actingPlayerId: "bob",
          getCardDefinitionById: getVariant,
          effect: {
            timing: { kind: "activated", mode: "main" },
            steps: [{ action }],
          },
        });
        expect(find(after, "target").normalCoreCount).toBe(4);
      }
    }
  );
});
