/**
 * BSTH03-M01「[永夜抄]博麗 霊夢」のバースト end-to-end 検証。
 *
 * 【バースト：相手によって自分のアルティメットがフィールドを離れた後】
 * BP15000以下の相手のスピリットすべてを破壊する。その後、このカードを
 * コストを支払わずに召喚する。
 *
 * 文字列 trigger「相手によって自分のアルティメットがフィールドを離れた後」+
 * triggerFilter {category:["ultimate"]} が:
 *   - leave_field の BurstEventKind
 *   - whose: self（主語=自分のアルティメット）
 *   - cause: [opponent_effect, battle, opponent_bp_compare]（「相手によって」=相手起因のみ）
 *   - triggerFilter: category ultimate（アルティメット離脱のみ）
 * に展開され、相手起因のアルティメット離脱で発動候補になり、自分起因では
 * 発動しないことを実カードの registration で確認する。
 * 召喚ステップは self（burst→field）で、相手スピリットを破壊しつつ自己召喚する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBurstEffectLookup,
  generateBurstRegistrations,
} from "../src/effect/structured-effect-registrations";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getAvailableBurstSourceChoices,
  getLegalActions,
} from "../src";
import type {
  CardDefinition,
  GameState,
  LegalAction,
  PendingBurstCheck,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
const noLookup = (_: string) => undefined;

describe("BSTH03-M01 バースト registration（実カード）", () => {
  it("leave_field + whose:self + 相手起因 cause + triggerFilter ultimate に展開される", () => {
    const def = getCardDefinitionById("BSTH03-M01")!;
    const regs = generateBurstRegistrations(def);
    const leave = regs.filter((r) => r.eventKind === "leave_field");
    expect(leave).toHaveLength(1);
    expect(leave[0]!.whose).toBe("self");
    expect(leave[0]!.cause).toEqual([
      "opponent_effect",
      "battle",
      "opponent_bp_compare",
    ]);
    expect(leave[0]!.triggerFilter).toEqual({ category: ["ultimate"] });
  });
});

describe("BSTH03-M01 発動可否（leave cause + triggerFilter）", () => {
  function buildState(
    extraInstances: GameState["cardInstances"] = []
  ): GameState {
    const burstSource = createCardInstance(
      getCardDefinitionById("BSTH03-M01")!,
      {
        instanceId: "reimu-burst",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "burst",
      }
    );
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    return {
      ...base,
      cardInstances: [burstSource, ...extraInstances],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "reimu-burst" }],
    };
  }

  function leaveCheck(
    relatedInstanceId: string | null,
    cause: "opponent_effect" | "self_effect" | "battle" | "state_based"
  ): PendingBurstCheck {
    return {
      checkId: "leave-1",
      actingPlayerId: "alice",
      eventKind: "leave_field",
      source: "action_resolution",
      chainId: "test:bsth03-m01-ultimate-leave-burst:86",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: relatedInstanceId ?? undefined,
      amount: 1,
      step: "main",
      window: "none",
      resolvedBurstCardInstanceIds: [],
      event: { family: "leave_field", validationMode: "snapshot_only", cause },
    } as PendingBurstCheck;
  }

  function choices(state: GameState, check: PendingBurstCheck) {
    return getAvailableBurstSourceChoices({
      state,
      pendingBurstCheck: check,
      getCardDefinitionById,
      getRegisteredBurstActions,
    });
  }

  // 離脱した自分のアルティメット（trash 上のカードが triggerFilter 対象）。
  function ultimateInstance(): GameState["cardInstances"][number] {
    // 同セットの任意アルティメットを離脱主体に流用。
    const ultDef = ALL_CARDS.find(
      (c) => c.printedCategory === "ultimate" && c.cardNo.startsWith("BSTH03-")
    )!;
    return createCardInstance(ultDef, {
      instanceId: "my-ult",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
  }

  function spiritInstance(): GameState["cardInstances"][number] {
    const spDef = ALL_CARDS.find(
      (c) => c.printedCategory === "spirit" && c.cardNo.startsWith("BSTH03-")
    )!;
    return createCardInstance(spDef, {
      instanceId: "my-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
  }

  it("相手効果で自分のアルティメットが離れた → 発動候補に含まれる", () => {
    const state = buildState([ultimateInstance()]);
    expect(
      choices(state, leaveCheck("my-ult", "opponent_effect"))
    ).toHaveLength(1);
  });

  it("バトル破壊で自分のアルティメットが離れた → 発動候補に含まれる", () => {
    const state = buildState([ultimateInstance()]);
    expect(choices(state, leaveCheck("my-ult", "battle"))).toHaveLength(1);
  });

  it("自分効果で離れた（self_effect）→ cause で除外", () => {
    const state = buildState([ultimateInstance()]);
    expect(choices(state, leaveCheck("my-ult", "self_effect"))).toHaveLength(0);
  });

  it("離れたのがスピリット（アルティメットでない）→ triggerFilter で除外", () => {
    const state = buildState([spiritInstance()]);
    expect(
      choices(state, leaveCheck("my-spirit", "opponent_effect"))
    ).toHaveLength(0);
  });
});

describe("BSTH03-M01 end-to-end: 相手スピリット破壊＋自己召喚", () => {
  function buildScenario(): GameState {
    const 霊夢 = createCardInstance(getCardDefinitionById("BSTH03-M01")!, {
      instanceId: "reimu-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    // 離脱主体の自分アルティメット（trash 上 = triggerFilter 対象）。
    const ultDef = ALL_CARDS.find(
      (c) => c.printedCategory === "ultimate" && c.cardNo.startsWith("BSTH03-")
    )!;
    const myUlt = createCardInstance(ultDef, {
      instanceId: "my-ult",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    // BP15000以下の相手スピリット（破壊対象）。
    const weakSpiritDef = ALL_CARDS.find(
      (c) =>
        c.printedCategory === "spirit" &&
        (c.levelDefs?.[0]?.bp ?? 99999) <= 15000
    )!;
    const bobSpirit = createCardInstance(weakSpiritDef, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 6 },
        { lifeNormalCoreCount: 5 },
      ],
    });
    return {
      ...base,
      turnNumber: 4,
      activePlayerId: "bob",
      step: "main",
      window: "none",
      cardInstances: [
        霊夢,
        myUlt,
        bobSpirit,
        createCardInstance(getCardDefinitionById("BSTH05-C01")!, {
          instanceId: "summon-condition-symbol",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "reimu-burst" }],
      pendingBurstChecks: [
        {
          checkId: "leave-1",
          actingPlayerId: "alice",
          eventKind: "leave_field",
          source: "action_resolution",
          chainId: "test:bsth03-m01-ultimate-leave-burst:220",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "my-ult",
          amount: 1,
          step: "main",
          window: "none",
          resolvedBurstCardInstanceIds: [],
          event: {
            family: "leave_field",
            validationMode: "snapshot_only",
            cause: "opponent_effect",
          },
        } as PendingBurstCheck,
      ],
    };
  }

  function findBurstDeclaration(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
    }).find(
      (a): a is Extract<LegalAction, { kind: "resolve_pending_burst_check" }> =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "reimu-burst"
    );
  }

  it("バースト宣言が提示され、解決で相手スピリット破壊＋自己召喚（burst→field）", () => {
    const initial = buildScenario();
    const decl = findBurstDeclaration(initial);
    expect(decl).toBeDefined();

    // バースト宣言 → スタック窓が開く。相手がパスして効果解決へ進める。
    let state: GameState = applyLegalAction({
      state: initial,
      action: decl!,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: noLookup,
    }).state;

    // スタック窓を双方パスで閉じ、burst 効果を解決させる（上限ループで安定点へ）。
    for (let i = 0; i < 12; i++) {
      let progressed = false;
      for (const pid of ["bob", "alice"]) {
        const actions = getLegalActions({
          state,
          actingPlayerId: pid,
          getCardDefinitionById,
          getRegisteredFieldCardEffectActions: noLookup,
          getRegisteredTriggeredEffectActions: noLookup,
          getRegisteredBurstActions,
        });
        const pass = actions.find(
          (a) =>
            a.kind === "pass_stack" ||
            a.kind === "resolve_pending_multi_placement"
        );
        if (pass) {
          state = applyLegalAction({
            state,
            action: pass,
            ...(state.pendingMultiPlacement
              ? {
                  multiPlacementAllocations:
                    state.pendingMultiPlacement.targets.map((target) => ({
                      destinationInstanceId: target.instanceId,
                      placements: [
                        {
                          kind: "reserve_normal" as const,
                          amount: target.minimumCoreCount,
                        },
                      ],
                    })),
                }
              : {}),
            getCardDefinitionById,
            getRegisteredFieldCardEffectActions: noLookup,
            getRegisteredTriggeredEffectActions: noLookup,
            getRegisteredBurstActions,
            getHandWrittenEffectResolver: noLookup,
          }).state;
          progressed = true;
        }
      }
      if (!progressed) break;
    }

    // バースト本体は場へ召喚される（burst→field、setBurst 解除）。
    expect(
      state.setBurstStates.some((b) => b.cardInstanceId === "reimu-burst")
    ).toBe(false);
    const reimu = state.cardInstances.find(
      (c) => c.instanceId === "reimu-burst"
    );
    expect(reimu?.zone).toBe("field");

    // BP15000以下の相手スピリットは破壊されフィールドを離れる。
    const bobSpirit = state.cardInstances.find(
      (c) => c.instanceId === "bob-spirit"
    );
    expect(bobSpirit?.zone).not.toBe("field");
  });
});
