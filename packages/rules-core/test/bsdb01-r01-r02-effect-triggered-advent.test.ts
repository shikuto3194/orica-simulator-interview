/** R01/R02「隣に契約煌臨」: 共有CX01の反対側。占有中でもその上、共有元なしなら不発 (08a6)。 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executeRestrictAdvent } from "../src/effect/structured-continuous-effects";
import {
  applyLegalAction,
  getLegalActions,
  buildTriggeredEffectLookup,
} from "../src";
import { adventSourceIdsOf } from "../src/model";
import type { CardDefinition, GameState } from "../src/model";
import {
  listAdventUsage,
  seedAdventUsage,
} from "./helpers/advent-usage-fixture";
import { resolveTargetCandidateIds } from "../src/effect/native-target-resolution";
import { createStepExecutionContext } from "../src/step-execution-context";
import { executeEffectAdvent } from "../src/mechanics/advent-system";
import { getEffectAdventParams } from "../src/mechanics/effect-advent";
import { getCandidateTargetInstanceIds } from "../src/legal/legal-actions-shared";

const definitions = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const card = (id: string): CardDefinition => definitions.get(id)!;
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([]),
  getRegisteredBattleImmediateEffectActions: () => [],
};
const ALICE = "alice";
const BOB = "bob";
const getCard = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)!;
function effect(no: string) {
  return card(no).effects.find((e) =>
    e.steps.some((s) => s.action.kind === "advent")
  )!;
}
function position(
  no: string,
  occupied: boolean,
  incomingNo = no === "BSDB01-R01" ? "BSDB01-X02" : "BSDB01-C01",
  permissionUsed = true
): GameState {
  const r01 = no === "BSDB01-R01";
  const shared = createCardInstance(card("BSDB01-CX01"), {
    instanceId: "shared",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "advent-source",
  });
  const source = createCardInstance(card(no), {
    instanceId: "source",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
    soulCoreCount: r01 && !occupied ? 1 : 0,
    exhaustState: "exhausted",
  });
  source.underCards = [{ role: "advent_source", cardInstanceId: "shared" }];
  const incoming = createCardInstance(card(incomingNo), {
    instanceId: "incoming",
    ownerPlayerId: ALICE,
    zone: r01 ? "hand" : "trash",
  });
  const sibling = createCardInstance(card(r01 ? "BSDB01-C02" : "BSDB01-C01"), {
    instanceId: "sibling",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
    soulCoreCount: r01 ? 1 : 0,
  });
  sibling.underCards = [{ role: "advent_source", cardInstanceId: "shared" }];
  const fillers = r01
    ? []
    : [1, 2].map((n) =>
        createCardInstance(card("BSDB01-R02"), {
          instanceId: "filler-" + n,
          ownerPlayerId: ALICE,
          zone: "hand",
        })
      );
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        ...Array.from({ length: 5 }, (_, i) =>
          createCardInstance(card("BSDB01-C05"), {
            instanceId: `deck-${i}`,
            ownerPlayerId: ALICE,
            zone: "deck",
          })
        ),
        shared,
        source,
        incoming,
        ...(occupied ? [sibling] : []),
        ...fillers,
      ],
      playerOverrides: [
        {
          handCount: r01 ? 1 : 2,
          deckCount: 5,
          countValue: 10,
          reserveNormalCoreCount: 3,
          soulCoreLocation: r01
            ? { kind: "card", instanceId: occupied ? "sibling" : "source" }
            : { kind: "reserve" },
        },
        {},
      ],
    }),
    activePlayerId: ALICE,
    step: "main",
    window: "none",
    turnNumber: 2,
  };
  // 既定は許可元(CX01)の〔ターンに1回:同名〕が使用済みの盤面(実際に擬制煌臨を成立させた後と同じ枠)。
  return permissionUsed
    ? seedAdventUsage(state, {
        kind: "alternate_cost",
        actingPlayerId: ALICE,
        instanceId: "shared",
        definition: card("BSDB01-CX01"),
      })
    : state;
}
/** CX01(許可元)の擬制枠: 使用者 alice の同名枠 1 件だけが記録されている。 */
const permissionUsedByAlice = [
  expect.objectContaining({
    kind: "alternate_cost",
    share: "card_name",
    period: "turn",
    playerId: ALICE,
    nameKey: "孫悟空＆ベジータ",
    amount: 1,
  }),
];
function finishChoices(state: GameState, effectLookups = lookups): GameState {
  let current = state;
  for (let i = 0; i < 12; i++) {
    const legal = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      ...effectLookups,
    });
    if (current.pendingZoneSelection) {
      const action = legal.find(
        (a) => a.kind === "resolve_pending_zone_selection"
      )!;
      current = applyLegalAction({
        state: current,
        action,
        selectedZoneCardIds: current.cardInstances
          .filter((c) => c.zone === "hand" && c.ownerPlayerId === ALICE)
          .slice(0, 2)
          .map((c) => c.instanceId),
        ...effectLookups,
      }).state;
    } else if (current.pendingCoreDistribution) {
      const recipient =
        current.pendingCoreDistribution.candidates[0]!.instanceId;
      const action = legal.find(
        (a) => a.kind === "resolve_pending_core_distribution"
      )!;
      expect(action).toBeDefined();
      current = applyLegalAction({
        state: current,
        action,
        coreDistributionAllocations: { [recipient]: 1 },
        coreDistributionSourceAllocations: { reserve: 1 },
        ...effectLookups,
      }).state;
    } else if (current.pendingStepOptionalChoice) {
      const action = legal.find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice ===
            (current.pendingStepOptionalChoice!.canExecute
              ? "execute"
              : "decline")
      );
      expect(action).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: action!,
        ...effectLookups,
      }).state;
    } else return current;
  }
  throw new Error("効果解決が終了しない");
}
function run(state: GameState, no: string, effectLookups = lookups) {
  return finishChoices(
    executeEffect({
      chainId: "test:bsdb01-r01-r02-effect-triggered-advent:161",
      state,
      effect: effect(no),
      sourceInstanceId: "source",
      actingPlayerId: ALICE,
      ...effectLookups,
    }),
    effectLookups
  );
}

describe("R01/R02 効果内の隣への煌臨", () => {
  it.each([
    ["BSDB01-R01", "BSDB01-TX01(A)", 10],
    ["BSDB01-R01", "BSDB01-X02", 4],
    ["BSDB01-R02", "BSDB01-X01", 7],
  ] as const)(
    "%s → %s: カウント境界・隣の空き/占有・候補と最終盤面",
    (no, incoming, threshold) => {
      for (const occupied of [false, true])
        for (const count of [threshold - 2, threshold - 1, threshold]) {
          const before = position(no, occupied, incoming);
          before.players[0]!.countValue = count;
          const action = effect(no).steps.find(
            (s) => s.action.kind === "advent"
          )!.action;
          const candidates = resolveTargetCandidateIds(
            action,
            before,
            ALICE,
            "source",
            lookups.getCardDefinitionById,
            createStepExecutionContext(before)
          );
          const succeeds = count >= threshold;
          expect(candidates).toEqual(succeeds ? ["incoming"] : []);
          if (no === "BSDB01-R01") {
            const registrations = buildTriggeredEffectLookup([card(no)])(
              no
            )!.filter((registration) => registration.effectIndex === 0);
            expect(registrations.length).toBeGreaterThan(0);
            for (const registration of registrations)
              expect(
                getCandidateTargetInstanceIds(before, ALICE, registration, {
                  sourceInstanceId: "source",
                  sourceDefinition: card(no),
                  getCardDefinitionById: lookups.getCardDefinitionById,
                })
              ).toEqual(succeeds ? ["incoming"] : []);
          }
          const after = run(before, no);
          expect(getCard(after, "incoming").zone).toBe(
            succeeds ? "field" : no === "BSDB01-R01" ? "hand" : "trash"
          );
          expect(after.players[0]!.deckCount).toBe(
            no === "BSDB01-R02" ? 2 : succeeds ? 3 : 5
          );
          expect(after.players[0]!.soulCoreLocation).toEqual(
            no === "BSDB01-R02" && succeeds
              ? { kind: "trash" }
              : no === "BSDB01-R01" && occupied && succeeds
                ? { kind: "card", instanceId: "incoming" }
                : before.players[0]!.soulCoreLocation
          );
          expect(getCard(after, "source").zoneRoleName).toBe("spirit");
          expect(after.pendingStepOptionalChoice).toBeNull();
          expect(after.pendingCoreDistribution).toBeNull();
        }
    }
  );

  it.each(["count", "target"])(
    "選択後の%s条件喪失は支払い・場入り・後続ドローより先に止める",
    (lost) => {
      const before = position("BSDB01-R01", true, "BSDB01-TX01(A)");
      const action = effect("BSDB01-R01").steps[0]!.action;
      if (action.kind !== "advent") throw new Error("advent step required");
      const params = getEffectAdventParams(
        before,
        ALICE,
        "source",
        "incoming",
        action,
        lookups.getCardDefinitionById
      )!;
      expect(params).toBeDefined();
      const changed = structuredClone(before);
      if (lost === "count") changed.players[0]!.countValue = 9;
      else getCard(changed, "sibling").definitionId = "BSDB01-C05";
      const after = executeEffectAdvent(
        changed,
        ALICE,
        params,
        lookups.getCardDefinitionById
      );
      expect(getCard(after, "incoming").zone).toBe("hand");
      expect(after.players[0]!.deckCount).toBe(5);
      expect(after.players[0]!.soulCoreLocation).toEqual(
        before.players[0]!.soulCoreLocation
      );
      expect(after.pendingStepOptionalChoice).toBeNull();
    }
  );

  it("on_step選択後にカウントを失った場合、煌臨も2ドローも行わない", () => {
    const before = position("BSDB01-R01", true, "BSDB01-TX01(A)");
    before.cardInstances.push({
      ...structuredClone(getCard(before, "incoming")),
      instanceId: "incoming-other",
    });
    before.players[0]!.handCount += 1;
    const original = effect("BSDB01-R01");
    const pending = executeEffect({
      chainId: "test:advent-condition-selection",
      state: before,
      effect: {
        ...original,
        steps: original.steps.map((step, i) =>
          i === 0
            ? { ...step, targetSelectionTiming: "on_step" as const }
            : step
        ),
      },
      sourceInstanceId: "source",
      actingPlayerId: ALICE,
      ...lookups,
    });
    expect(pending.pendingStepOptionalTargetSelection).not.toBeNull();
    pending.players[0]!.countValue = 8;
    const choice = getLegalActions({
      state: pending,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    )!;
    const after = applyLegalAction({
      state: pending,
      action: choice,
      targetInstanceIds: ["incoming"],
      ...lookups,
    }).state;
    expect(getCard(after, "incoming").zone).toBe("hand");
    expect(after.players[0]!.deckCount).toBe(5);
    expect(after.pendingStepOptionalChoice).toBeNull();
  });
  it.each(["BSDB01-R01", "BSDB01-R02"])(
    "%s: 効果内煌臨はadjacentを明示し、常時型にしない",
    (no) => {
      expect(effect(no).timing.kind).toBe("card_event");
      expect(
        effect(no).steps.find((s) => s.action.kind === "advent")!.action
      ).toMatchObject({ kind: "advent", placement: "adjacent" });
    }
  );
  it.each(
    [false, true].flatMap((occupied) =>
      ["BSDB01-C02", "BSDB01-X02"].map(
        (incoming) => [occupied, incoming] as const
      )
    )
  )(
    "R01: 隣占有=%s、%sをメイン・条件を満たしたカウントで煌臨し、発揮元を維持して2ドロー",
    (occupied, incomingNo) => {
      const before = position("BSDB01-R01", occupied, incomingNo);
      const after = run(before, "BSDB01-R01");
      expect(getCard(after, "source")).toMatchObject({
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      });
      expect(adventSourceIdsOf(getCard(after, "source"))).toEqual(["shared"]);
      expect(getCard(after, "incoming")).toMatchObject({
        zone: "field",
        normalCoreCount: occupied ? 2 : 1,
        soulCoreCount: occupied ? 1 : 0,
      });
      expect(adventSourceIdsOf(getCard(after, "incoming")).sort()).toEqual(
        occupied ? ["shared", "sibling"] : ["shared"]
      );
      expect(after.players[0]).toMatchObject({
        handCount: 2,
        deckCount: 3,
        soulCoreLocation: {
          kind: "card",
          instanceId: occupied ? "incoming" : "source",
        },
      });
      // 使用済みの許可元があるときは通常払い: 枠は増えず、同じ1件のまま。
      expect(listAdventUsage(before)).toEqual(permissionUsedByAlice);
      expect(listAdventUsage(after)).toEqual(listAdventUsage(before));
      expect(after.pendingCoreDistribution).toBeNull();
    }
  );
  it("R01: 共有煌臨元がなければ、別のCX01が場にあっても煌臨と後続ドローは不発", () => {
    const before = position("BSDB01-R01", true);
    getCard(before, "source").underCards = [];
    const after = run(before, "BSDB01-R01");
    expect(getCard(after, "incoming").zone).toBe("hand");
    expect(after.players[0]).toMatchObject({
      handCount: 1,
      deckCount: 5,
      soulCoreLocation: before.players[0]!.soulCoreLocation,
    });
  });
  it.each([false, true])(
    "R02: 隣占有=%s、先に3ドロー2破棄し、実支払いで反対側へ煌臨",
    (occupied) => {
      const after = run(position("BSDB01-R02", occupied), "BSDB01-R02");
      expect(getCard(after, "source").zoneRoleName).toBe("spirit");
      expect(adventSourceIdsOf(getCard(after, "source"))).toEqual(["shared"]);
      expect(getCard(after, "incoming")).toMatchObject({
        zone: "field",
        normalCoreCount: occupied ? 2 : 1,
      });
      expect(adventSourceIdsOf(getCard(after, "incoming")).sort()).toEqual(
        occupied ? ["shared", "sibling"] : ["shared"]
      );
      expect(after.players[0]).toMatchObject({
        handCount: 3,
        deckCount: 2,
        soulCoreLocation: { kind: "trash" },
      });
    }
  );
  it.each(["no-shared-host", "no-soul-core"])(
    "R02: %sでは煌臨は不発、先行ドローと破棄は維持",
    (reason) => {
      const before = position("BSDB01-R02", true);
      if (reason === "no-shared-host")
        getCard(before, "source").underCards = [];
      else before.players[0]!.soulCoreLocation = { kind: "void" };
      const after = run(before, "BSDB01-R02");
      expect(getCard(after, "incoming").zone).toBe("trash");
      expect(after.players[0]).toMatchObject({
        handCount: 3,
        deckCount: 2,
        soulCoreLocation: before.players[0]!.soulCoreLocation,
      });
    }
  );
  it.each(["BSDB01-R01", "BSDB01-R02"])(
    "%s: 煌臨禁止は効果内煌臨にも適用する",
    (no) => {
      const before = executeRestrictAdvent(
        position(no, true),
        BOB,
        {
          kind: "restrict_advent",
          targetScope: "player",
          player: "opponent",
          duration: { scope: "this_turn" },
        },
        "source"
      );
      const after = run(before, no);
      expect(getCard(after, "incoming").zone).toBe(
        no === "BSDB01-R01" ? "hand" : "trash"
      );
      expect(after.players[0]!.deckCount).toBe(no === "BSDB01-R01" ? 5 : 2);
    }
  );
});

describe("R02 効果内の契約煌臨: CX01 の常時の擬制許可 (08a5、信頼度C)", () => {
  it.each([6, 7])(
    "CX01が未使用・ソウルコアなしでもX01のカウント7条件は必要 (C%s)",
    (count) => {
      const before = position("BSDB01-R02", true, "BSDB01-X01", false);
      before.players[0]!.countValue = count;
      before.players[0]!.soulCoreLocation = { kind: "void" };
      const after = run(before, "BSDB01-R02");
      expect(getCard(after, "incoming").zone).toBe(
        count === 7 ? "field" : "trash"
      );
      expect(after.players[0]!.deckCount).toBe(2);
      expect(after.players[0]!.soulCoreLocation).toEqual({ kind: "void" });
      expect(listAdventUsage(after)).toEqual(
        count === 7 ? permissionUsedByAlice : []
      );
      expect(after.pendingAsIfSoulCoreChoice).toBeNull();
    }
  );

  const unused = (occupied: boolean): GameState =>
    position("BSDB01-R02", occupied, undefined, false);
  const choose = (state: GameState, choiceId: string): GameState => {
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_as_if_soul_core_choice" &&
        a.choiceId === choiceId
    );
    expect(action).toBeDefined();
    return finishChoices(
      applyLegalAction({ state, action: action!, ...lookups }).state
    );
  };

  it("許可未使用: 通常/擬制を選ばせ、擬制ならソウルコアは動かず許可が記録される", () => {
    const pending = run(unused(false), "BSDB01-R02");
    expect(pending.pendingAsIfSoulCoreChoice).toMatchObject({
      actionKind: "effect_advent",
    });
    expect(
      pending.pendingAsIfSoulCoreChoice!.options.map((o) => o.choiceId).sort()
    ).toEqual(["host:shared:alternate", "normal"]);
    const after = choose(pending, "host:shared:alternate");
    expect(after.pendingAsIfSoulCoreChoice).toBeNull();
    expect(getCard(after, "incoming").zone).toBe("field");
    expect(after.players[0]!.soulCoreLocation).toEqual({ kind: "reserve" });
    expect(listAdventUsage(after)).toEqual(permissionUsedByAlice);
  });

  it("許可未使用でも通常を選べば実ソウルコアを払い、許可は消費しない", () => {
    const after = choose(run(unused(false), "BSDB01-R02"), "normal");
    expect(getCard(after, "incoming").zone).toBe("field");
    expect(after.players[0]!.soulCoreLocation).toEqual({ kind: "trash" });
    expect(listAdventUsage(after)).toEqual([]);
  });

  it("許可使用済み: 選択を出さず実ソウルコアを払う", () => {
    const after = run(position("BSDB01-R02", false), "BSDB01-R02");
    expect(after.pendingAsIfSoulCoreChoice).toBeNull();
    expect(after.players[0]!.soulCoreLocation).toEqual({ kind: "trash" });
  });

  it("実ソウルコアが無く許可が未使用なら、選択なしで擬制により煌臨する", () => {
    const before = unused(true);
    before.players[0]!.soulCoreLocation = { kind: "void" };
    const after = run(before, "BSDB01-R02");
    expect(after.pendingAsIfSoulCoreChoice).toBeNull();
    expect(getCard(after, "incoming").zone).toBe("field");
    expect(after.players[0]!.soulCoreLocation).toEqual({ kind: "void" });
    expect(listAdventUsage(after)).toEqual(permissionUsedByAlice);
  });
});

it.each(["BSDB01-R01", "BSDB01-R02"])(
  "%s: 隣への契約煌臨をカプセルコーポレーションが一度観測する",
  (no) => {
    const state = position(no, false);
    state.cardInstances.push(
      createCardInstance(card("BSDB01-C07"), {
        instanceId: "capsule",
        ownerPlayerId: ALICE,
        zone: "field",
      })
    );
    const result = run(state, no, {
      ...lookups,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        card("BSDB01-C07"),
      ]),
    });
    expect(getCard(result, "incoming").zone).toBe("field");
    const observed = result.pendingTriggeredEffects.filter(
      (e) =>
        e.eventKind === "advent" &&
        e.effectScope === "contract_advent" &&
        Object.values(e.timingSourceRegistrations ?? {}).some(
          (r) => r.sourceInstanceId === "capsule"
        )
    );
    expect(observed).toHaveLength(1);
  }
);
