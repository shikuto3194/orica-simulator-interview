/**
 * P3-170 V06c (実経路): 【魂状態】を含む起動効果の個体枠は、列挙・宣言・解決で同じ枠になる。
 *
 * 場の起動効果のラベルは経路名 (`spirit:N` 等) で、ラベルから効果を逆引きできない。列挙が
 * 効果を渡して照会し、宣言の記録が効果を渡さないと、soul 世代を寿命に含めるかがずれて、
 * 〔ターンに1回〕が効かず同ターンに再度合法手に出る(エラーではなく無制限化として現れる)。
 * 記録と照会を同じ fixture から作るテストでは検出できないため、本番の合法手と適用を通す。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type ContinuousEffect,
  type ContinuousEffectTag,
  type GameState,
  type LegalAction,
} from "../src";
import { USAGE_CONSUME_FAILED_LOG_PREFIX } from "../src/legal/legal-actions-shared";
import { listEffectUsage } from "./helpers/effect-usage-fixture";

const ALICE = "alice";

const soulDef: CardDefinition = {
  cardNo: "T-SOUL-FIELD",
  name: "魂状態の起動効果",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      applicability: { zone: ["field", "soul_state"] },
      timing: { kind: "activated", mode: "main" },
      usageLimit: { kind: "per_instance", duration: "turn" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
} as unknown as CardDefinition;

const getDef = (id: string): CardDefinition | undefined =>
  id === soulDef.cardNo ? soulDef : undefined;
const lookup = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([soulDef]),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([soulDef]),
  getRegisteredBattleImmediateEffectActions: buildBattleImmediateEffectLookup([
    soulDef,
  ]),
};

function build(soulStateGeneration: number): GameState {
  const card = {
    ...createCardInstance(soulDef, {
      instanceId: "soul-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    }),
    soulStateGeneration,
  };
  return {
    ...createEmptyGameState({ cardInstances: [card] }),
    turnNumber: 5,
    activePlayerId: ALICE,
    step: "main",
  };
}

const actionsFor = (state: GameState, player: string): LegalAction[] =>
  getLegalActions({
    state,
    actingPlayerId: player,
    getCardDefinitionById: getDef,
    ...lookup,
  });

const fieldEffectAction = (state: GameState): LegalAction | undefined =>
  actionsFor(state, ALICE).find(
    (action) =>
      action.kind === "use_field_card_effect" &&
      action.sourceInstanceId === "soul-1"
  );

function declareAndResolve(state: GameState): GameState {
  const action = fieldEffectAction(state);
  expect(action).toBeDefined();
  let current = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDef,
    ...lookup,
  }).state;
  // 相手がパスしてスタックが閉じ、効果が解決する。
  for (let i = 0; i < 4 && current.stackWindow; i++) {
    const pass = actionsFor(current, current.stackWindow.priorityPlayerId).find(
      (a) => a.kind === "pass_stack"
    );
    if (!pass) break;
    current = applyLegalAction({
      state: current,
      action: pass,
      getCardDefinitionById: getDef,
      ...lookup,
    }).state;
  }
  return current;
}

describe("V06c 【魂状態】を含む場の起動効果の個体枠 (実経路)", () => {
  for (const generation of [0, 1, 2]) {
    it(`soul 世代 ${generation} でも、1回宣言した後は同ターンに再列挙されず、消費失敗も記録されない`, () => {
      const initial = build(generation);
      expect(fieldEffectAction(initial)).toBeDefined();
      const after = declareAndResolve(initial);
      // 宣言の記録は 1 回分の枠を作る
      const entries = listEffectUsage(after).filter(
        (entry) => entry.sourceInstanceId === "soul-1"
      );
      expect(entries.map((entry) => entry.amount)).toEqual([1]);
      // 列挙は同じ枠を見て、使用済みとして出さない
      expect(fieldEffectAction(after)).toBeUndefined();
      // 列挙を通った宣言の記録が失敗していない (キーずれ=無制限化の兆候がない)
      expect(
        after.log.filter((line) =>
          line.startsWith(USAGE_CONSUME_FAILED_LOG_PREFIX)
        )
      ).toEqual([]);
    });
  }

  it("次のターンには再び使える (ターンごとの枠)", () => {
    const after = declareAndResolve(build(1));
    const next: GameState = {
      ...after,
      turnNumber: after.turnNumber + 1,
      step: "main",
      activePlayerId: ALICE,
      window: "none",
    };
    expect(fieldEffectAction(next)).toBeDefined();
  });
});

/**
 * 継続効果(CE)の使用枠は、ラベルが経路名(`redirect_effect_target` 等)でラベルから効果を逆引きできない。
 * 【魂状態】を含む効果の個体枠は soul 世代を寿命に含めないので、列挙と記録が同じ効果を渡さないと、
 * 記録しても列挙側の枠が埋まらず〔ターンに1回〕が無制限になる(BSLH01-R02 型)。
 * 実際の redirect 確定を通して、1回確定した後は再び prompt が積まれないことを検査する。
 */
describe("V06c 【魂状態】CE(redirect_effect_target)の個体枠 (実経路)", () => {
  const BOB = "bob";
  const redirectDef: CardDefinition = {
    cardNo: "T-SOUL-REDIRECT",
    name: "魂状態の対象変更",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "continuous" },
        applicability: { soulState: true },
        steps: [],
      },
    ],
  } as unknown as CardDefinition;
  // 対象になるのは赤だけ。緑の味方は対象にならず、対象変更の候補として残る。
  const plainDef = (cardNo: string, color: "red" | "green"): CardDefinition =>
    ({
      ...redirectDef,
      cardNo,
      name: cardNo,
      colors: [color],
      symbolColors: [color],
      effects: [],
    }) as unknown as CardDefinition;
  const attackerDef = {
    ...redirectDef,
    cardNo: "T-ATTACKER",
    name: "T-ATTACKER",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"], colors: ["red"] },
              },
              amount: -3000,
              duration: { scope: "turn" },
            },
          },
        ],
      },
    ],
  } as unknown as CardDefinition;
  const defs: Record<string, CardDefinition> = {
    [redirectDef.cardNo]: redirectDef,
    "T-ALLY-A": plainDef("T-ALLY-A", "red"),
    "T-ALLY-B": plainDef("T-ALLY-B", "green"),
    "T-ATTACKER": attackerDef,
  };
  const getDef = (id: string): CardDefinition | undefined => defs[id];

  function scene(soulStateGeneration: number): GameState {
    const quartz = {
      ...createCardInstance(redirectDef, {
        instanceId: "r02",
        ownerPlayerId: ALICE,
        zone: "field",
        zoneRoleName: "quartz",
      }),
      soulStateGeneration,
    };
    const field = (cardNo: string, instanceId: string, owner: string) =>
      createCardInstance(defs[cardNo]!, {
        instanceId,
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: 1,
      });
    const ce: ContinuousEffect = {
      effectId: "ce-r02",
      sourceInstanceId: "r02",
      sourceDefinitionId: redirectDef.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "redirect_effect_target" as ContinuousEffectTag,
      provenance: { effectIndex: 0, stepIndex: 0 },
      metadata: {
        triggerCondition: {
          sourcePlayerRef: "opponent",
          protectedTargetKind: "owned_filter",
          filter: { category: ["spirit"] },
        },
        redirectCandidateSource: {
          kind: "owned_filter",
          filter: { category: ["spirit"] },
        },
        optional: true,
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
      } as unknown as Record<string, unknown>,
    };
    return {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          quartz,
          field("T-ALLY-A", "ally-a", ALICE),
          field("T-ALLY-B", "ally-b", ALICE),
          field("T-ATTACKER", "attacker", BOB),
        ],
      }),
      turnNumber: 5,
      activePlayerId: BOB,
      activeContinuousEffects: [ce],
      // 魂状態にいるので、applicability.soulState の効果が有効(CE が再構築で外れない)。
      players: createEmptyGameState({ playerIds: [ALICE, BOB] }).players.map(
        (player) =>
          player.id === ALICE
            ? { ...player, soulStateInstanceIds: ["r02"] }
            : player
      ),
    };
  }

  const fire = (state: GameState): GameState =>
    executeEffect({
      chainId: `test:soul-redirect:${state.log.length}`,
      state,
      effect: attackerDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "attacker",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    });

  for (const generation of [0, 1, 2]) {
    it(`soul 世代 ${generation}: 1回確定した後は同ターンに対象変更の prompt が再び積まれず、消費失敗も記録されない`, () => {
      const first = fire(scene(generation));
      // 陽性対照: 未使用なら prompt が積まれる
      expect(first.pendingTargetRedirects).toHaveLength(1);
      const pending = first.pendingTargetRedirects[0]!;
      const confirmed = applyLegalAction({
        state: first,
        action: {
          kind: "confirm_target_redirect",
          actionId: `redirect-confirm-${pending.pendingId}`,
          can: true,
          reason: "pending_target_redirect",
          actingPlayerId: ALICE,
          pendingId: pending.pendingId,
          originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
          redirectableInstanceId: pending.redirectableInstanceId,
          candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
          sourceEffectInstanceId: pending.sourceEffectInstanceId,
          sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
        },
        redirectTargetReplacementInstanceId:
          pending.candidateTokenInstanceIds[0]!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => undefined,
      });
      if (!("redirected" in confirmed)) throw new Error("expected redirect");
      expect(confirmed.redirected).toBe(true);
      expect(
        listEffectUsage(confirmed.state).filter(
          (entry) => entry.sourceInstanceId === "r02"
        )
      ).toHaveLength(1);
      // 枠が埋まっているので、同ターンの2回目は対象変更を提案しない
      const second = fire({ ...confirmed.state, pendingTargetRedirects: [] });
      // 陽性対照: 同じ盤面でも枠が空なら prompt が積まれる(積まれない理由が使用済みであることの確認)
      const unspent = fire({
        ...confirmed.state,
        pendingTargetRedirects: [],
        effectAccounting: first.effectAccounting,
      });
      expect(unspent.pendingTargetRedirects).toHaveLength(1);
      expect(second.pendingTargetRedirects).toHaveLength(0);
      expect(
        confirmed.state.log.filter((line) =>
          line.startsWith(USAGE_CONSUME_FAILED_LOG_PREFIX)
        )
      ).toEqual([]);
    });
  }
});
