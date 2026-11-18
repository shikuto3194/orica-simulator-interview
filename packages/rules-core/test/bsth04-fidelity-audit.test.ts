import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import rawCards from "../../card-data/raw/by-pack/BSTH04.js";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getPlayerLifeCoreCount,
  getLegalActions,
  isCardUseRestricted,
  rebuildContinuousEffectsFromField,
  resolveLifeDamage,
  buildTriggeredEffectLookup,
  queuePendingReactionsFromTriggerEvents,
  queuePendingLeave,
} from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";
import { getAttackDeclarationBlockReason } from "../src/battle/battle-availability";
import { matchesCardFilter } from "../src/card/card-filter";
import { recomputeAndRebuildContinuousEffects } from "../src/effect/continuous-effect-rebuild";
import type { Effect, GameState } from "../src";

const definitions = new Map(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const getDef = (id: string) => definitions.get(id);
const def = (id: string) => getDef(id)!;
function instance(
  no: string,
  id: string,
  zone: "field" | "deck" | "trash" | "hand" = "field",
  player = "alice",
  cores = 1
) {
  return createCardInstance(def(no), {
    instanceId: id,
    ownerPlayerId: player,
    controllerPlayerId: player,
    zone,
    normalCoreCount: cores,
  });
}
function state(cards: GameState["cardInstances"]): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
    }),
    activePlayerId: "alice",
    step: "main",
    turnNumber: 3,
  };
}
function run(s: GameState, effect: Effect, source: string, targets?: string[]) {
  return executeEffect({
    chainId: "test:bsth04-fidelity-audit:57",
    state: s,
    effect,
    sourceInstanceId: source,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    targetInstanceIds: targets,
  });
}
function optional(s: GameState, choice: "execute" | "decline") {
  const action = getLegalActions({
    state: s,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  }).find(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" && a.choice === choice
  )!;
  expect(action).toBeDefined();
  return applyLegalAction({ state: s, action, getCardDefinitionById: getDef })
    .state;
}

describe("BSTH04 原文忠実度の境界回帰", () => {
  it("全14枚16面の本文・基本情報がユーザー訂正を反映した原文データと一致し、重複定義がない", () => {
    const faces = rawCards.flatMap((card) =>
      card.isDoubleSided ? [card.front, card.back] : [card]
    );
    expect(rawCards).toHaveLength(14);
    expect(faces).toHaveLength(16);
    for (const face of faces) {
      const card = def(face.cardNumber);
      expect(card, face.cardNumber).toBeDefined();
      expect(card.name).toBe(face.name);
      expect(card.cost).toBe(face.cost);
      expect(card.tribe).toBe(face.tribe);
      // 2026-09-22 ユーザー訂正: X03の2つ目のアタック時効果はLv2-Lv3。
      // 取得当時のrawは保持し、この訂正箇所以外は全文一致を維持する。
      const expectedText =
        face.cardNumber === "BSTH04-X03"
          ? face.effect.replace(
              "Lv3『このスピリットのアタック時』",
              "Lv2-Lv3『このスピリットのアタック時』"
            )
          : face.effect;
      expect(card.textLines.join("\n").trim()).toBe(expectedText.trim());
      expect(card.effects?.length).toBeGreaterThan(0);
      expect(card.effects?.every((effect) => !effect.stub)).toBe(true);
    }
    expect(
      ALL_CARDS.filter((c) => c.pack === "BSTH04 東方花映塚")
    ).toHaveLength(14);
  });
  it("C03: 破棄を辞退しても既存トラッシュを回収し、同名でターン1回を共有する", () => {
    const effect = def("BSTH04-C03").effects![1]!;
    expect(effect.executionMode ?? "mandatory").toBe("mandatory");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    const s = state([
      instance("BSTH04-C03", "source"),
      instance("BSTH04-C02", "old", "trash"),
      instance("BSTH04-C01", "deck", "deck"),
    ]);
    const pending = run(s, effect, "source");
    expect(pending.pendingStepOptionalChoice).toBeTruthy();
    const skipped = optional(pending, "decline");
    expect(
      skipped.cardInstances.find((c) => c.instanceId === "deck")?.zone
    ).toBe("deck");
    expect(
      skipped.cardInstances.find((c) => c.instanceId === "old")?.zone
    ).toBe("hand");
  });

  it("C11: 相手による減少だけを次のバトル終了まで防ぐ", () => {
    const s = run(
      state([instance("BSTH04-C11", "source", "trash")]),
      def("BSTH04-C11").effects![3]!,
      "source"
    );
    const life = getPlayerLifeCoreCount(s.players[0]!);
    const own = resolveLifeDamage(s, "alice", 1, [], {
      cause: "effect",
      actingPlayerId: "alice",
    });
    expect(getPlayerLifeCoreCount(own.players[0]!)).toBe(life - 1);
    const opponent = resolveLifeDamage(s, "alice", 1, [], {
      cause: "effect",
      actingPlayerId: "bob",
    });
    expect(getPlayerLifeCoreCount(opponent.players[0]!)).toBe(life);
    expect(
      removeExpiredContinuousEffects(s, { kind: "turn_end" })
    ).toHaveLength(1);
    expect(
      removeExpiredContinuousEffects(s, {
        kind: "battle_end",
        attackId: "next",
      })
    ).toHaveLength(0);
  });

  it("C11: カウント2以上のフラッシュは条件付きで防止不可", () => {
    const flash = def("BSTH04-C11").effects![2]!;
    expect(flash.preventionLevel).toBe("unpreventable");
    expect(flash.preventionLevelCondition).toEqual([
      { kind: "count_value", player: "self", min: 2 },
    ]);
  });
  it.each([1, 2])(
    "C11: カウント%iで相手効果を受けないスピリットのアタック可否を判定する",
    (count) => {
      const base = state([
        instance("BSTH04-C11", "source", "trash"),
        instance("BSTH04-R01", "immune", "field", "bob"),
      ]);
      // 独立した全効果耐性を与え、本文自身の攻撃不可を持つM01との混同を避ける。
      const immune = run(
        base,
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "effect_immunity",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: "all",
                },
                duration: { scope: "turn" },
                sourcePlayerScope: "any",
              },
            },
          ],
        },
        "source"
      );
      immune.players[0]!.countValue = count;
      const applied = run(immune, def("BSTH04-C11").effects![2]!, "source");
      const reason = getAttackDeclarationBlockReason({
        state: {
          ...applied,
          step: "attack",
          window: "none",
          activePlayerId: "bob",
        },
        actingPlayerId: "bob",
        sourceInstanceId: "immune",
        getCardDefinitionById: getDef,
      });
      expect(reason).toBe(count >= 2 ? "source_not_ready" : null);
    }
  );

  it("X01: 自分のアタックステップ中にLv2なら幽々子自身の効果で残留させる", () => {
    const base = state([
      instance("BSTH04-X01", "source", "field", "alice", 4),
      instance("BSTH04-X03", "ally"),
    ]);
    const granted = rebuildContinuousEffectsFromField(
      { ...base, step: "attack" },
      getDef
    );
    expect(
      granted.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "granted_effect"
      )
    ).toBe(false);
    const domain = def("BSTH04-X01").effects![1]!;
    expect(domain.timingScope).toEqual({ player: "self", period: "attack" });
    expect(domain.timing).toMatchObject({
      kind: "game_event",
      event: "leave_field",
    });
    expect(domain.steps[0]!.action).toMatchObject({
      kind: "stay_on_field",
      newExhaustState: "exhausted",
    });
  });

  it("X01: 途中で登場した対象にも付与し、相手ターンとLv1では残留を発揮しない", () => {
    const initial = rebuildContinuousEffectsFromField(
      {
        ...state([instance("BSTH04-X01", "source", "field", "alice", 4)]),
        step: "attack",
      },
      getDef
    );
    const entered = recomputeAndRebuildContinuousEffects(
      {
        ...initial,
        cardInstances: [
          ...initial.cardInstances,
          instance("BSTH04-X03", "late"),
        ],
      },
      getDef
    );
    const events = [
      {
        chainId: "test:bsth04-fidelity-audit:260",
        eventKind: "destroy",
        relatedInstanceId: "late",
        relatedPlayerId: "alice",
        cause: "opponent_effect" as const,
      },
    ];
    const grants = (s: GameState) =>
      queuePendingReactionsFromTriggerEvents(
        queuePendingLeave({
          state: s,
          instanceId: "late",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "fidelity-yuyuko",
        }),
        events.map((event) => ({
          ...event,
          actingPlayerId: "alice",
          source: "action_resolution" as const,
          chainId: "fidelity-yuyuko",
          attackId: null,
          amount: 1,
          preFlushLeaveEvent: true,
          suppressBurstCheck: true,
        })),
        undefined,
        {
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions:
            buildTriggeredEffectLookup(ALL_CARDS),
          getRegisteredBurstActions: undefined,
        }
      ).pendingTriggeredEffects.filter(
        (p) => (p.registeredLeaveFieldStayOnFieldSourceKeys?.length ?? 0) > 0
      );
    expect(grants(entered)).toHaveLength(1);
    expect(grants({ ...entered, activePlayerId: "bob" })).toHaveLength(0);
    const lowered = recomputeAndRebuildContinuousEffects(
      {
        ...entered,
        cardInstances: entered.cardInstances.map((c) =>
          c.instanceId === "source" ? { ...c, normalCoreCount: 0 } : c
        ),
      },
      getDef
    );
    expect(grants(lowered)).toHaveLength(0);
  });

  it("X02: C連鎖は攻撃効果と同じ発揮に含み、手札以外の使用を禁止しない", () => {
    const card = def("BSTH04-X02");
    expect(card.effects).toHaveLength(1);
    const base = state([
      instance(card.cardNo, "source"),
      instance("BSTH04-C03", "hand", "hand"),
      instance("BSTH04-C03", "trash", "trash"),
    ]);
    base.players[0]!.countValue = 3;
    const result = run(base, card.effects![0]!, "source");
    expect(
      isCardUseRestricted(
        result,
        "alice",
        result.cardInstances.find((c) => c.instanceId === "hand")!,
        def("BSTH04-C03"),
        getDef,
        "summon"
      )
    ).toBe(true);
    expect(
      isCardUseRestricted(
        result,
        "alice",
        result.cardInstances.find((c) => c.instanceId === "trash")!,
        def("BSTH04-C03"),
        getDef,
        "summon"
      )
    ).toBe(false);
  });

  it("転醒R01(A): オープンせず2枚をトラッシュに置き、その中から任意回収する", () => {
    const card = def("BSTH04-転醒R01(A)");
    const result = run(
      state([
        instance(card.cardNo, "source", "field", "alice", 0),
        instance("BSTH04-C01", "top1", "deck"),
        instance("BSTH04-C02", "top2", "deck"),
        instance("BSTH04-C03", "old", "trash"),
      ]),
      card.effects![0]!,
      "source"
    );
    expect(result.pendingDeckReveal).toBeFalsy();
    expect(
      result.cardInstances
        .filter((c) => c.instanceId.startsWith("top"))
        .map((c) => c.zone)
    ).toEqual(["trash", "trash"]);
    expect(result.pendingStepOptionalChoice).toBeTruthy();
    const accepted = optional(result, "execute");
    expect(
      accepted.pendingStepOptionalTargetSelection?.candidateInstanceIds.sort()
    ).toEqual(["top1", "top2"]);
    const action = getLegalActions({
      state: accepted,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    )!;
    const resolved = applyLegalAction({
      state: accepted,
      action,
      targetInstanceIds: ["top2"],
      getCardDefinitionById: getDef,
    }).state;
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "top2")?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "old")?.zone
    ).toBe("trash");
  });

  it("転醒R02(B): 未成立のアタック宣言を対象にし、成立後の別スタックでは取らない", () => {
    const attacker = instance("BSTH04-X03", "attacker", "field", "bob", 2);
    const base = state([instance("BSTH04-転醒R02(B)", "source"), attacker]);
    const action = def("BSTH04-転醒R02(B)").effects![1]!.steps[0]!.action;
    if (action.kind !== "core_move" || action.from.kind !== "field")
      throw new Error("missing core move");
    const declaring = {
      ...base,
      preDeclarationStackWindow: {
        kind: "attack",
        sourceInstanceId: "attacker",
        actingPlayerId: "bob",
      },
    } as GameState;
    expect(
      matchesCardFilter(attacker, def("BSTH04-X03"), action.from.filter!, {
        state: declaring,
      })
    ).toBe(true);
    expect(
      matchesCardFilter(attacker, def("BSTH04-X03"), action.from.filter!, {
        state: base,
        battleEntities: [
          {
            entityId: "attack",
            memberInstanceIds: ["attacker"],
            resolvedBp: 5000,
            resolvedSymbols: ["purple"],
            attackState: "attacking",
          },
        ],
      })
    ).toBe(false);
    const result = run(
      { ...declaring, activePlayerId: "bob", step: "attack" },
      def("BSTH04-転醒R02(B)").effects![1]!,
      "source"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "attacker")
        ?.normalCoreCount
    ).toBe(1);
    expect(
      result.players.find((p) => p.id === "bob")?.trashNormalCoreCount
    ).toBe(base.players.find((p) => p.id === "bob")!.trashNormalCoreCount + 1);
  });

  it("転醒R01(B): 六色と七色を区別し、防止不可を保持する", () => {
    const effect = def("BSTH04-転醒R01(B)").effects![1]!;
    expect(effect.preventionLevel).toBe("unpreventable");
    const action = effect.steps[0]!.action;
    if (action.kind !== "suppress_effect" || action.target.kind !== "filter")
      throw new Error("missing suppression");
    expect(action.target.filter.colorCount).toEqual({ min: 6, max: 6 });
  });
});
