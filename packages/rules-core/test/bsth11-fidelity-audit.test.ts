import { describe, expect, it } from "vitest";
import { BSTH11_CARDS } from "../../card-data/src/cards/BSTH11";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import rawCards from "../../card-data/raw/by-pack/BSTH11.js";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  refreshExhaustStates,
  type CardInstance,
  type GameState,
} from "../src";
import {
  executeRecover,
  flushPendingTurnEndExhaustDowngrades,
} from "../src/effect/structured-state-grants";
import { getSummonCostExcludeChoiceOption } from "../src/mechanics/summon-cost-exclude-choice";
import { matchesCardFilter } from "../src/card/card-filter";

const getDef = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const noTriggers = () => [];
function card(no: string, id: string, options: Partial<CardInstance> = {}) {
  return createCardInstance(getDef(no)!, {
    instanceId: id,
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 4,
    ...options,
  });
}
function board(cards: CardInstance[]): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
    }),
    activePlayerId: "alice",
    turnNumber: 3,
    step: "attack",
    window: "none",
  };
}
function run(state: GameState, index: number) {
  const source = state.cardInstances.find((c) => c.instanceId === "source")!;
  return executeEffect({
    chainId: "test:bsth11-fidelity-audit:49",
    state,
    effect: getDef(source.definitionId)!.effects![index]!,
    effectIndex: index,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggers,
  });
}
function optional(state: GameState, choice: "execute" | "decline") {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  }).find(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" && a.choice === choice
  );
  expect(
    action,
    `optional ${choice}: ${state.log.slice(-5).join(";")}`
  ).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggers,
  }).state;
}

describe("BSTH11 原文忠実度監査", () => {
  for (const original of rawCards) {
    it(`${original.cardNumber}: 訂正済み配布原文と本文・全印刷値が一致する`, () => {
      const def = getDef(original.cardNumber)!;
      const colors: Record<string, string> = {
        赤: "red",
        紫: "purple",
        緑: "green",
        白: "white",
        黄: "yellow",
        青: "blue",
        神: "god",
        導: "guide",
        七: "seven",
      };
      const expand = (values: string[]) =>
        values.flatMap((s) => [...s].map((c) => colors[c]));
      expect(def.textLines.join("\n")).toBe(original.effect);
      expect(def).toMatchObject({
        name: original.name,
        colors: expand(original.color),
        cost: original.cost,
        reductionSymbols: expand(original.reduction),
        tribe: original.tribe,
        symbolColors: expand(original.symbol),
        rarity: original.rarity,
        pack: original.pack,
        // Archived source uses PNG; deployment uses the lossless WebP of that image.
        image: original.image.replace(/\.png$/, ".webp"),
        maxDeckCount: original.maxDeckCount,
        printedCategory: (
          {
            スピリット: "spirit",
            ネクサス: "nexus",
            マジック: "magic",
          } as Record<string, string>
        )[original.type],
      });
      expect(def.levelDefs ?? []).toEqual(
        (original.levels ?? []).map((lv) => ({
          level: Number(lv.level.slice(2)),
          requiredCores: lv.cost,
          ...("bp" in lv ? { bp: lv.bp } : {}),
        }))
      );
    });
  }
  it("X01: 相手の効果を受けない対象には回復禁止を適用しない", () => {
    let state = rebuildContinuousEffectsFromField(
      board([
        card("BSTH11-X01", "source"),
        card("BSTH11-R03", "target", {
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          exhaustState: "heavily_exhausted",
        }),
      ]),
      getDef
    );
    state = executeEffect({
      chainId: "test:bsth11-fidelity-audit:139",
      state,
      sourceInstanceId: "target",
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "turn" },
            },
          },
        ],
      },
    });
    expect(
      executeRecover(
        state,
        "bob",
        { player: "self", count: 1 },
        getDef,
        "target",
        ["target"]
      ).cardInstances.find((c) => c.instanceId === "target")!.exhaustState
    ).toBe("exhausted");
    expect(
      refreshExhaustStates(state, "bob", getDef).cardInstances.find(
        (c) => c.instanceId === "target"
      )!.exhaustState
    ).toBe("exhausted");
  });
  it("13枚すべてが重複なく実効カード定義に登録されている", () => {
    expect(BSTH11_CARDS).toHaveLength(13);
    for (const def of BSTH11_CARDS) {
      expect(ALL_CARDS.filter((c) => c.cardNo === def.cardNo)).toEqual([def]);
      expect(def.effects!.every((e) => e.steps.length > 0)).toBe(true);
    }
  });

  for (const no of ["BSTH11-C01", "BSTH11-C02"]) {
    it(`${no}: コアを置いてデッキをオープンしない選択ができる`, () => {
      const state = board([
        card(no, "source"),
        card("BSTH11-C04", "deck", { zone: "deck" }),
      ]);
      const placed = optional(run(state, 1), "execute");
      expect(
        placed.cardInstances.find((c) => c.instanceId === "source")!
          .normalCoreCount
      ).toBe(5);
      const declined = optional(placed, "decline");
      expect(declined.pendingDeckReveal).toBeNull();
      expect(
        declined.cardInstances.find((c) => c.instanceId === "deck")!.zone
      ).toBe("deck");
    });
  }
  for (const no of ["BSTH11-C01", "BSTH11-C02", "BSTH11-C03"]) {
    it(`${no}: オープン後の「手札に加える」は候補がある限り辞退できない`, () => {
      let state = run(
        board([
          card(no, "source"),
          card("BSTH11-X01", "nexus", { zone: "deck" }),
          card("BSTH11-C01", "spirit", { zone: "deck" }),
          card("BSTH11-C04", "filler", { zone: "deck" }),
        ]),
        1
      );
      state = optional(state, "decline");
      if (state.pendingStepOptionalChoice) state = optional(state, "execute");
      expect(state.pendingDeckReveal).not.toBeNull();
      expect(state.pendingDeckReveal!.picks.every((p) => p.mandatory)).toBe(
        true
      );
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
      expect(() =>
        applyLegalAction({
          state,
          action,
          selectedDeckRevealCardIds: [],
          getCardDefinitionById: getDef,
        })
      ).toThrow();
    });
  }

  it("R01: 2枚除外のうち1枚しか処理できなければ回復しない（除外は戻さない）", () => {
    const after = run(
      board([
        card("BSTH11-R01", "source", { exhaustState: "exhausted" }),
        card("BSTH11-C01", "trash", {
          zone: "trash",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
        }),
      ]),
      3
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "trash")!.zone
    ).toBe("removed_from_game");
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "source")!.exhaustState
    ).toBe("exhausted");
  });

  it("M01: 通常召喚にはフラッシュ本文の除外軽減を適用しない", () => {
    const source = card("BSTH11-M01", "source", { zone: "hand" });
    const state = {
      ...board([source, card("BSTH11-C01", "cost", { zone: "hand" })]),
      step: "main" as const,
    };
    expect(
      getSummonCostExcludeChoiceOption(
        state,
        "alice",
        source,
        getDef(source.definitionId)!,
        getDef
      )
    ).toBeUndefined();
  });

  it("X01: 神技は発揮元自身も手札に戻せる", () => {
    const state = board([card("BSTH11-X01", "source")]);
    const after = executeEffect({
      chainId: "test:bsth11-fidelity-audit:272",
      state,
      effect:
        getDef("BSTH11-X01")!.grandwalkerData!.divineSkills![0]!.effects[0]!,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      costPaidThisEffect: 2,
      targetInstanceIds: ["source"],
      choiceIndex: 0,
    });
    const choose = getLegalActions({
      state: after,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    const resolved = applyLegalAction({
      state: after,
      action: choose,
      selectedZoneCardIds: ["source"],
      zoneSelectionDestinationByCardId: { source: "hand" },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
    }).state;
    expect(
      flushPendingLeaves(resolved, getDef).cardInstances.find(
        (c) => c.instanceId === "source"
      )!.zone
    ).toBe("hand");
  });

  for (const exhaustion of ["heavily_exhausted", "exhausted"] as const) {
    it(`X01: ${exhaustion}の対象の効果回復とリフレッシュを原文通りに制限する`, () => {
      const state = rebuildContinuousEffectsFromField(
        board([
          card("BSTH11-X01", "source"),
          card("BSTH11-R03", "target", {
            ownerPlayerId: "bob",
            controllerPlayerId: "bob",
            exhaustState: exhaustion,
          }),
        ]),
        getDef
      );
      const after = executeRecover(
        state,
        "bob",
        { player: "self", count: 1 },
        getDef,
        "target",
        ["target"]
      );
      expect(
        after.cardInstances.find((c) => c.instanceId === "target")!.exhaustState
      ).toBe(exhaustion === "heavily_exhausted" ? exhaustion : "recovered");
      expect(
        refreshExhaustStates(state, "bob", getDef).cardInstances.find(
          (c) => c.instanceId === "target"
        )!.exhaustState
      ).toBe(exhaustion === "heavily_exhausted" ? exhaustion : "recovered");
    });
  }

  it("X04: 回復対象の創界神ネクサスに通常ネクサスを混ぜない", () => {
    const def = getDef("BSTH11-X04")!;
    const action = def.effects![2]!.steps[1]!.action;
    if (action.kind !== "recover" || action.target.kind !== "filter")
      throw new Error("recover target");
    const nexus = card("BSTH11-C05", "backdoor", { exhaustState: "exhausted" });
    expect(
      matchesCardFilter(
        nexus,
        getDef(nexus.definitionId)!,
        action.target.filter
      )
    ).toBe(false);
  });

  it("X03: 隠岐奈のコアが3個なら4個の対価を払ったことにはしない", () => {
    const state = board([
      card("BSTH11-X03", "source"),
      card("BSTH11-X01", "cost", { normalCoreCount: 3 }),
      card("BSTH11-R03", "target", {
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      }),
    ]);
    const after = executeEffect({
      chainId: "test:bsth11-fidelity-audit:359",
      state,
      effect: getDef("BSTH11-X03")!.effects![1]!,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      effectIndex: 1,
      choiceIndex: 1,
      optionalExecuteResumeStepIndex: 1,
      targetInstanceIds: ["target"],
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "cost")!.normalCoreCount
    ).toBe(3);
    expect(
      after.cardInstances.find((c) => c.instanceId === "target")!.exhaustState
    ).toBe("recovered");
    expect(
      after.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_source_prevention_immunity"
      )
    ).toBe(true);
  });

  it("X02: 好きな枚数の除外後、除外枚数分の自分のトラッシュを必ずデッキへ戻す", () => {
    let state = run(
      board([
        card("BSTH11-X02", "source"),
        card("BSTH11-C01", "enemy-trash", {
          zone: "trash",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
        }),
        card("BSTH11-C01", "own-trash1", { zone: "trash" }),
        card("BSTH11-C02", "own-trash2", { zone: "trash" }),
      ]),
      2
    );
    if (state.pendingStepOptionalChoice) state = optional(state, "decline");
    expect(state.pendingZoneSelection?.candidateCardInstanceIds).toContain(
      "enemy-trash"
    );
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_zone_selection");
    expect(action).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      selectedZoneCardIds: ["enemy-trash"],
      getCardDefinitionById: getDef,
    }).state;
    expect(
      state.cardInstances.find((c) => c.instanceId === "enemy-trash")!.zone
    ).toBe("removed_from_game");
    expect(state.pendingZoneSelection?.maxCount).toBe(1);
    expect(state.pendingZoneSelection?.canSkip).toBe(false);
  });

  it("C04: 離場して再登場した別個体には以前の終了時処理を適用しない", () => {
    const after = run(
      board([
        card("BSTH11-C04", "source", { zone: "in_use" }),
        card("BSTH11-C05", "target", {
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
        }),
      ]),
      2
    );
    const reentered = {
      ...after,
      cardInstances: after.cardInstances.map((c) =>
        c.instanceId === "target"
          ? {
              ...c,
              fieldInstanceGeneration: (c.fieldInstanceGeneration ?? 0) + 1,
            }
          : c
      ),
    };
    expect(
      flushPendingTurnEndExhaustDowngrades(reentered).cardInstances.find(
        (c) => c.instanceId === "target"
      )!.exhaustState
    ).toBe("heavily_exhausted");
  });

  for (const location of ["field", "life"] as const) {
    it(`X02: ${location}のソウルコアでも現界できる`, () => {
      let state = board([
        card("BSTH11-X02", "source", { zone: "hand" }),
        card("BSTH11-X01", "gate"),
        card("BSTH11-C05", "soul", {
          soulCoreCount: location === "field" ? 1 : 0,
        }),
      ]);
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === "alice"
            ? {
                ...p,
                reserveSoulCoreCount: 0,
                trashSoulCoreCount: 0,
                lifeSoulCoreCount: location === "life" ? 1 : 0,
                soulCoreLocation:
                  location === "field"
                    ? { kind: "card" as const, instanceId: "soul" }
                    : { kind: "life" as const, playerId: "alice" },
              }
            : p
        ),
      };
      const after = executeEffect({
        chainId: "test:bsth11-fidelity-audit:475",
        state,
        effect: getDef("BSTH11-X02")!.effects![0]!,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        effectIndex: 0,
        choiceIndex: location === "life" ? 1 : 0,
      });
      expect(after.players[0]!.trashSoulCoreCount).toBe(1);
      expect(
        after.cardInstances.find((c) => c.instanceId === "source")!.zone
      ).toBe("field");
    });
  }

  for (const exhaustion of ["recovered", "heavily_exhausted"] as const) {
    it(`C04: 対象が途中で${exhaustion}になってもターン終了時は疲労状態になる`, () => {
      const after = run(
        board([
          card("BSTH11-C04", "source", { zone: "in_use" }),
          card("BSTH11-C05", "target", {
            ownerPlayerId: "bob",
            controllerPlayerId: "bob",
            exhaustState: "recovered",
          }),
        ]),
        2
      );
      const changed = {
        ...after,
        cardInstances: after.cardInstances.map((c) =>
          c.instanceId === "target" ? { ...c, exhaustState: exhaustion } : c
        ),
      };
      expect(
        flushPendingTurnEndExhaustDowngrades(changed).cardInstances.find(
          (c) => c.instanceId === "target"
        )!.exhaustState
      ).toBe("exhausted");
    });
  }
});
