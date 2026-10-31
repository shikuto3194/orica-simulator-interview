/**
 * 創界石ネクサス基盤テスト（grandstone-system / 解封 / コア閾値転醒）
 *
 * - 識別・対象制限（創界神とは別軸の targetsGrandstone）
 * - コア管理（汎用コア移動から独立・離脱時コア→ボイド・配置時コア禁止）
 * - 解封トリガー（召喚/アタック/転醒のカードフィルタ系、手札増加の原因フィルタ系）
 * - コア閾値転醒（遷移検出 → pending → 裏返し + 残コア処分→ボイド + postRebirth）
 */
import { describe, it, expect } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createEmptyGameState,
  createCardInstance,
  flushPendingLeaves,
} from "../src";
import {
  hasIndependentCoreManagement,
  isGrandstoneNexus,
  type CardDefinition,
  type CardInstance,
  type GameState,
  type PlayerState,
  type TriggeredMechanic,
} from "../src/model";
import { getEnterFieldCorePlacementRule } from "../src/zone/enter-field-placement-policy";
import { matchesCardFilter } from "../src/card/card-filter";
import { canMoveCoresFrom } from "../src/core/core-movability";
import {
  checkAndQueueStoneRebirthChoices,
  checkAndQueueUnsealChoicesForCardEvent,
  checkAndQueueUnsealChoicesForHandIncrease,
} from "../src/mechanics/grandstone-system";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";

// ── ヘルパー ───────────────────────────────────────────

const ALICE = "player-1";
const BOB = "player-2";

/** BSTH001 陰陽玉型: 召喚/アタック解封 + コア3転醒 + 全コアボイド + ブレイヴ合体 */
function stoneCombineDef(): CardDefinition {
  return {
    cardNo: "GS-001",
    name: "テスト創界石",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: ["double_sided", "enter_field_core_placement_forbidden"],
    isDoubleSided: true,
    backFace: {
      cardNo: "GS-001B",
      name: "テスト転醒後ブレイヴ",
      printedCategory: "brave",
      colors: ["red"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 10000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想",
    },
    grandstoneData: {
      unsealConditions: [
        {
          events: ["summon", "attack"],
          cardFilter: { nameContains: ["博麗"], categories: ["spirit"] },
        },
        {
          events: ["summon", "attack"],
          cardFilter: { tribes: ["靈異"], categories: ["spirit"] },
        },
      ],
      rebirthCoreThreshold: 3,
      rebirthMaxCount: 3,
      rebirthRetainCores: 0,
      postRebirth: "combine_with_own_spirit",
    },
    tribe: "創界石・幻想",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** BSTH07 宝塔型: 手札増加解封（起幻+青）+ コア4転醒 + 1個残しボイド + コア配置 */
function stoneChargeDef(): CardDefinition {
  return {
    cardNo: "GS-002",
    name: "テスト創界石チャージ",
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: ["double_sided", "enter_field_core_placement_forbidden"],
    isDoubleSided: true,
    backFace: {
      cardNo: "GS-002B",
      name: "テスト転醒後スピリット",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 8,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 8000 },
        { level: 2, requiredCores: 3, bp: 13000 },
      ],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "起幻・幻想",
    },
    grandstoneData: {
      unsealConditions: [
        {
          events: ["hand_increase"],
          causeFilter: { tribes: ["起幻"], colors: ["blue"] },
        },
      ],
      rebirthCoreThreshold: 4,
      rebirthMaxCount: 5,
      rebirthRetainCores: 1,
      postRebirth: "charge_cores_from_field_reserve",
    },
    tribe: "創界石・起幻",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 解封マッチ用スピリット（名前部分一致） */
function hakureiSpiritDef(): CardDefinition {
  return {
    cardNo: "HAK-001",
    name: "博麗 霊夢",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "巫女",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 解封マッチ用スピリット（系統一致） */
function reiiSpiritDef(): CardDefinition {
  return {
    cardNo: "REI-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    tribe: "靈異・幻想",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 解封にマッチしないスピリット */
function otherSpiritDef(): CardDefinition {
  return {
    cardNo: "OTH-001",
    name: "無関係スピリット",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: [],
    tribe: "想獣",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 手札増加の原因カード（起幻・青 → GS-002 の解封にマッチ） */
function causeMatchDef(): CardDefinition {
  return {
    cardNo: "CAU-001",
    name: "起幻ドローカード",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["blue"],
    textLines: [],
    keywordTags: [],
    tribe: "起幻・蒼波",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

/** 通常の創界神（対象軸の分離検証用） */
function grandwalkerDef(): CardDefinition {
  return {
    cardNo: "GW-X01",
    name: "[創界神]テスト",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["god"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["god"],
    textLines: [],
    keywordTags: ["enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon"] as const,
      oracleConditions: [],
    },
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

function normalNexusDef(): CardDefinition {
  return {
    cardNo: "NX-001",
    name: "通常ネクサス",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
}

const defMap = new Map<string, CardDefinition>();
for (const def of [
  stoneCombineDef(),
  stoneChargeDef(),
  hakureiSpiritDef(),
  reiiSpiritDef(),
  otherSpiritDef(),
  causeMatchDef(),
  grandwalkerDef(),
  normalNexusDef(),
]) {
  defMap.set(def.cardNo, def);
  if (def.backFace?.cardNo) {
    defMap.set(def.backFace.cardNo, {
      ...def.backFace,
      sourceUrls: [],
      sourceConfidence: "A",
    } as CardDefinition);
  }
}

function getCardDef(id: string): CardDefinition | undefined {
  return defMap.get(id);
}

function fieldCard(
  instanceId: string,
  definitionId: string,
  owner = ALICE,
  cores = 0,
  opts: Partial<CardInstance> = {}
): CardInstance {
  const def = defMap.get(definitionId)!;
  return createCardInstance(def, {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
    ...opts,
  });
}

function getPlayer(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

/** P3-92: 誘発キューから mechanic 種別ごとの pending を取り出す。 */
function mechanicPendings<K extends TriggeredMechanic["kind"]>(
  state: GameState,
  kind: K
): Array<{
  pendingId: string;
  mechanic: Extract<TriggeredMechanic, { kind: K }>;
}> {
  return state.pendingTriggeredEffects.flatMap((p) =>
    p.mechanic?.kind === kind
      ? [
          {
            pendingId: p.pendingId,
            mechanic: p.mechanic as Extract<TriggeredMechanic, { kind: K }>,
          },
        ]
      : []
  );
}

/**
 * mechanic pending を legal action 経由で解決する（accept=false で辞退）。
 * 受諾=発揮宣言はスタック窓を開く（02:186）ため、responder のパスで窓を閉じて
 * deferred 解決まで進める。辞退=任意効果の不使用は窓を開かず同期（02:199）。
 */
function resolveMechanicPending(
  state: GameState,
  pendingId: string,
  accept: boolean
): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
  });
  const action = actions.find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" && a.pendingId === pendingId
  );
  expect(action, `resolve action for ${pendingId}`).toBeDefined();
  const result = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getCardDef,
    ...(accept ? {} : { skipOptionalEffect: true }),
  });
  const applied = (result as { state: GameState }).state;
  if (!accept) {
    expect(applied.stackWindow).toBeNull();
    return applied;
  }
  expect(applied.stackWindow).not.toBeNull();
  return passStackUntilClosed(applied);
}

/** 開いたスタック窓を responder のパスで閉じ、deferred 解決まで進める。 */
function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById: getCardDef,
      // スタック窓中の能動選択肢列挙が field 効果 lookup を要求するため空 stub を渡す
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pass = actions.find((a) => a.kind === "pass_stack");
    expect(pass, `pass_stack for ${responderId}`).toBeDefined();
    current = (
      applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById: getCardDef,
      }) as { state: GameState }
    ).state;
  }
  expect(current.stackWindow).toBeNull();
  return current;
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...createEmptyGameState({
      playerOverrides: [
        { reserveNormalCoreCount: 10, voidNormalCoreCount: 100 },
        { reserveNormalCoreCount: 10, voidNormalCoreCount: 100 },
      ],
    }),
    step: "main",
    window: "none",
    ...overrides,
  };
}

// ── 識別・対象制限 ─────────────────────────────────────

it("陰陽玉本文監査: 名前/系統と召喚/アタックの解封、閾値/カウント境界、転醒合体の最終盤面", () => {
  const actualStone = ALL_CARDS.find(
    (def) => def.cardNo === "BSTH001-転醒R01(A)"
  )!;
  const actualBack = actualStone.backFace!;
  const nameHost = { ...hakureiSpiritDef(), tribe: "博麗" };
  const tribeHost = reiiSpiritDef();
  const localDefs = new Map<string, CardDefinition>([
    [actualStone.cardNo, actualStone],
    [actualBack.cardNo!, actualBack as CardDefinition],
    [nameHost.cardNo, nameHost],
    [tribeHost.cardNo, tribeHost],
    [otherSpiritDef().cardNo, otherSpiritDef()],
  ]);
  const lookup = (id: string) => localDefs.get(id);
  const options = {
    getCardDefinitionById: lookup,
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredTriggeredEffectActions: () => [],
  };
  const resolvePending = (
    state: GameState,
    kind: "unseal" | "stone_rebirth"
  ): GameState => {
    const pending = mechanicPendings(state, kind);
    expect(pending).toHaveLength(1);
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...options,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_triggered_effect" &&
        candidate.pendingId === pending[0]!.pendingId
    );
    expect(action).toBeDefined();
    let current = applyLegalAction({
      state,
      action: action!,
      ...options,
    }).state;
    expect(current.stackWindow).not.toBeNull();
    for (
      let passCount = 0;
      current.stackWindow && passCount < 10;
      passCount++
    ) {
      const pass = getLegalActions({
        state: current,
        actingPlayerId: current.stackWindow.priorityPlayerId,
        ...options,
      }).find((candidate) => candidate.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: pass!,
        ...options,
      }).state;
    }
    expect(current.stackWindow).toBeNull();
    return current;
  };

  for (const hostDef of [nameHost, tribeHost]) {
    for (const event of ["summon", "attack"] as const) {
      for (const boundary of [
        { cores: 0, count: 3, canRebirth: false },
        { cores: 2, count: 3, canRebirth: true },
        { cores: 2, count: 4, canRebirth: false },
      ]) {
        const stone = createCardInstance(actualStone, {
          instanceId: "actual-stone",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: boundary.cores,
        });
        const host = createCardInstance(hostDef, {
          instanceId: "actual-host",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        });
        let state = makeState({ cardInstances: [stone, host] });
        state = {
          ...state,
          players: state.players.map((player) =>
            player.id === ALICE
              ? { ...player, countValue: boundary.count }
              : player
          ),
        };
        expect(getEnterFieldCorePlacementRule(actualStone)).toBe("forbidden");
        expect(
          matchesCardFilter(stone, actualStone, { category: ["nexus"] })
        ).toBe(false);
        expect(
          matchesCardFilter(stone, actualStone, {
            category: ["nexus"],
            targetsGrandstone: true,
          })
        ).toBe(true);
        expect(canMoveCoresFrom(state, stone, actualStone)).toBe(false);
        const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;
        const reserveBefore = getPlayer(state, ALICE).reserveNormalCoreCount;

        // Neither an unrelated own Spirit nor an opponent's matching event unseals it.
        for (const [actor, definitionId] of [
          [ALICE, "OTH-001"],
          [BOB, hostDef.cardNo],
        ]) {
          const probe = createCardInstance(lookup(definitionId!)!, {
            instanceId: "probe",
            ownerPlayerId: actor!,
            zone: "field",
            normalCoreCount: 1,
          });
          const negative = checkAndQueueUnsealChoicesForCardEvent(
            { ...state, cardInstances: [...state.cardInstances, probe] },
            probe.instanceId,
            event,
            lookup,
            "actual-stone:negative"
          );
          expect(mechanicPendings(negative, "unseal")).toHaveLength(0);
        }
        state = checkAndQueueUnsealChoicesForCardEvent(
          state,
          host.instanceId,
          event,
          lookup,
          "actual-stone:positive"
        );
        state = resolvePending(state, "unseal");
        expect(getCard(state, stone.instanceId).normalCoreCount).toBe(
          boundary.cores + 1
        );
        expect(getPlayer(state, ALICE).voidNormalCoreCount).toBe(
          voidBefore - 1
        );
        expect(mechanicPendings(state, "unseal")).toHaveLength(0);
        if (!boundary.canRebirth) {
          expect(mechanicPendings(state, "stone_rebirth")).toHaveLength(0);
          expect(getCard(state, stone.instanceId).definitionId).toBe(
            actualStone.cardNo
          );
          expect(getPlayer(state, ALICE).countValue).toBe(boundary.count);
          continue;
        }
        state = resolvePending(state, "stone_rebirth");
        expect(state.pendingStoneFlipCombine).not.toBeNull();
        expect(getCard(state, stone.instanceId).definitionId).toBe(
          actualStone.cardNo
        );
        expect(getCard(state, stone.instanceId).normalCoreCount).toBe(3);
        const combine = getLegalActions({
          state,
          actingPlayerId: ALICE,
          ...options,
        }).find(
          (candidate) =>
            candidate.kind === "resolve_brave_combine_choice" &&
            candidate.chosenHostInstanceId === host.instanceId
        );
        expect(combine).toBeDefined();
        state = applyLegalAction({ state, action: combine!, ...options }).state;
        const completedStone = getCard(state, stone.instanceId);
        expect(completedStone.definitionId).toBe(actualBack.cardNo);
        expect(completedStone.attachedToInstanceId).toBe(host.instanceId);
        expect(completedStone.normalCoreCount).toBe(0);
        expect(getCard(state, host.instanceId).attachedChildrenIds).toContain(
          stone.instanceId
        );
        expect(getCard(state, host.instanceId).normalCoreCount).toBe(1);
        // Unseal takes one core, flip returns three, count consumes one from void.
        expect(getPlayer(state, ALICE).voidNormalCoreCount).toBe(
          voidBefore + 1
        );
        expect(getPlayer(state, ALICE).reserveNormalCoreCount).toBe(
          reserveBefore
        );
        expect(getPlayer(state, ALICE).countValue).toBe(boundary.count + 1);
        expect(state.pendingTriggeredEffects).toHaveLength(0);
        expect(state.pendingStoneFlipCombine).toBeNull();
        expect(state.stackWindow).toBeNull();
      }
    }
  }
});

describe("創界石: 識別と対象制限", () => {
  it("isGrandstoneNexus は grandstoneData の有無で判定する", () => {
    expect(isGrandstoneNexus(stoneCombineDef())).toBe(true);
    expect(isGrandstoneNexus(grandwalkerDef())).toBe(false);
    expect(isGrandstoneNexus(normalNexusDef())).toBe(false);
  });

  it("hasIndependentCoreManagement は創界神/創界石の双方で true", () => {
    expect(hasIndependentCoreManagement(stoneCombineDef())).toBe(true);
    expect(hasIndependentCoreManagement(grandwalkerDef())).toBe(true);
    expect(hasIndependentCoreManagement(normalNexusDef())).toBe(false);
  });

  it("配置時コア配置ルールは forbidden", () => {
    expect(getEnterFieldCorePlacementRule(stoneCombineDef())).toBe("forbidden");
  });

  it("配置時コア配置ルールは創界神/創界石なら forbidden（タグ非依存・述語駆動 P3-93）", () => {
    // forbidden タグを剥がしても hasIndependentCoreManagement で forbidden になる。
    const stoneNoTag: CardDefinition = {
      ...stoneCombineDef(),
      keywordTags: stoneCombineDef().keywordTags.filter(
        (tag) => tag !== "enter_field_core_placement_forbidden"
      ),
    };
    const walkerNoTag: CardDefinition = {
      ...grandwalkerDef(),
      keywordTags: grandwalkerDef().keywordTags.filter(
        (tag) => tag !== "enter_field_core_placement_forbidden"
      ),
    };
    expect(getEnterFieldCorePlacementRule(stoneNoTag)).toBe("forbidden");
    expect(getEnterFieldCorePlacementRule(walkerNoTag)).toBe("forbidden");
    // 通常ネクサスは optional のまま
    expect(getEnterFieldCorePlacementRule(normalNexusDef())).toBe("optional");
  });

  it("通常効果（フィルタ）の対象にならない", () => {
    const stone = fieldCard("gs1", "GS-001");
    expect(
      matchesCardFilter(stone, stoneCombineDef(), { category: ["nexus"] })
    ).toBe(false);
  });

  it("targetsGrandwalker 効果（創界神対象）の対象にもならない", () => {
    const stone = fieldCard("gs1", "GS-001");
    expect(
      matchesCardFilter(stone, stoneCombineDef(), {
        category: ["nexus"],
        targetsGrandwalker: true,
      })
    ).toBe(false);
  });

  it("targetsGrandstone 効果は創界石を対象にでき、創界神は対象にできない", () => {
    const stone = fieldCard("gs1", "GS-001");
    const gw = fieldCard("gw1", "GW-X01");
    const filter = { category: ["nexus"] as const, targetsGrandstone: true };
    expect(matchesCardFilter(stone, stoneCombineDef(), filter)).toBe(true);
    expect(matchesCardFilter(gw, grandwalkerDef(), filter)).toBe(false);
  });
});

// ── コア管理 ───────────────────────────────────────────

describe("創界石: コア管理", () => {
  it("汎用コア移動のソースにならない (canMoveCoresFrom)", () => {
    const state = makeState();
    const stone = fieldCard("gs1", "GS-001", ALICE, 3);
    expect(canMoveCoresFrom(state, stone, stoneCombineDef())).toBe(false);
  });

  it("フィールド離脱時、上のコアはボイドへ", () => {
    const stone = fieldCard("gs1", "GS-001", ALICE, 2, {
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "effect_resolution",
      pendingLeaveChainId: "chain-1",
    });
    const state = makeState({ cardInstances: [stone] });
    state.pendingLeaveEntities = [
      {
        instanceId: "gs1",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: BOB,
        chainId: "chain-1",
        deferZoneMoveUntilChainEnd: false,
      },
    ];
    const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;
    const reserveBefore = getPlayer(state, ALICE).reserveNormalCoreCount;

    const next = flushPendingLeaves(state, getCardDef);

    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(voidBefore + 2);
    expect(getPlayer(next, ALICE).reserveNormalCoreCount).toBe(reserveBefore);
  });
});

// ── 解封（カードイベント系） ─────────────────────────────

describe("解封: 召喚/アタックのカードイベント条件", () => {
  it("名前部分一致（博麗）の自分スピリット召喚で解封選択がキューされる", () => {
    const stone = fieldCard("gs1", "GS-001", ALICE, 0);
    const spirit = fieldCard("sp1", "HAK-001", ALICE, 1);
    const state = makeState({ cardInstances: [stone, spirit] });

    const next = checkAndQueueUnsealChoicesForCardEvent(
      state,
      "sp1",
      "summon",
      getCardDef,
      "test:grandstone:506"
    );
    const unseals = mechanicPendings(next, "unseal");
    expect(unseals).toHaveLength(1);
    expect(unseals[0]!.mechanic.grandstoneInstanceId).toBe("gs1");
    expect(unseals[0]!.mechanic.triggerEvent).toBe("summon");
  });

  it("系統一致（靈異）のアタックでも解封選択がキューされる", () => {
    const stone = fieldCard("gs1", "GS-001", ALICE, 0);
    const spirit = fieldCard("sp1", "REI-001", ALICE, 1);
    const state = makeState({ cardInstances: [stone, spirit] });

    const next = checkAndQueueUnsealChoicesForCardEvent(
      state,
      "sp1",
      "attack",
      getCardDef,
      "test:grandstone:523"
    );
    expect(mechanicPendings(next, "unseal")).toHaveLength(1);
  });

  it("条件にマッチしないスピリットでは発火しない", () => {
    const stone = fieldCard("gs1", "GS-001", ALICE, 0);
    const spirit = fieldCard("sp1", "OTH-001", ALICE, 1);
    const state = makeState({ cardInstances: [stone, spirit] });

    const next = checkAndQueueUnsealChoicesForCardEvent(
      state,
      "sp1",
      "summon",
      getCardDef,
      "test:grandstone:537"
    );
    expect(mechanicPendings(next, "unseal")).toHaveLength(0);
  });

  it("相手のスピリット召喚では発火しない（自分の〜のみ）", () => {
    const stone = fieldCard("gs1", "GS-001", ALICE, 0);
    const spirit = fieldCard("sp1", "HAK-001", BOB, 1);
    const state = makeState({ cardInstances: [stone, spirit] });

    const next = checkAndQueueUnsealChoicesForCardEvent(
      state,
      "sp1",
      "summon",
      getCardDef,
      "test:grandstone:551"
    );
    expect(mechanicPendings(next, "unseal")).toHaveLength(0);
  });

  it("ボイドにコアがなければキューしない", () => {
    const stone = fieldCard("gs1", "GS-001", ALICE, 0);
    const spirit = fieldCard("sp1", "HAK-001", ALICE, 1);
    const state = makeState({ cardInstances: [stone, spirit] });
    state.players = state.players.map((p) =>
      p.id === ALICE ? { ...p, voidNormalCoreCount: 0 } : p
    );

    const next = checkAndQueueUnsealChoicesForCardEvent(
      state,
      "sp1",
      "summon",
      getCardDef,
      "test:grandstone:568"
    );
    expect(mechanicPendings(next, "unseal")).toHaveLength(0);
  });
});

// ── 解封（手札増加系） ──────────────────────────────────

describe("解封: 手札増加の原因フィルタ条件", () => {
  it("起幻+青の自分の効果による手札増加で解封選択がキューされる", () => {
    const stone = fieldCard("gs2", "GS-002", ALICE, 0);
    const cause = fieldCard("cz1", "CAU-001", ALICE, 1);
    const state = makeState({ cardInstances: [stone, cause] });

    const next = checkAndQueueUnsealChoicesForHandIncrease(
      state,
      ALICE,
      "cz1",
      getCardDef,
      "test:grandstone:586"
    );
    const unseals = mechanicPendings(next, "unseal");
    expect(unseals).toHaveLength(1);
    expect(unseals[0]!.mechanic.triggerEvent).toBe("hand_increase");
  });

  it("原因カードの系統が合わなければ発火しない", () => {
    const stone = fieldCard("gs2", "GS-002", ALICE, 0);
    const cause = fieldCard("cz1", "OTH-001", ALICE, 1);
    const state = makeState({ cardInstances: [stone, cause] });

    const next = checkAndQueueUnsealChoicesForHandIncrease(
      state,
      ALICE,
      "cz1",
      getCardDef,
      "test:grandstone:602"
    );
    expect(mechanicPendings(next, "unseal")).toHaveLength(0);
  });

  it("原因カード不明（null）では発火しない (fail-closed)", () => {
    const stone = fieldCard("gs2", "GS-002", ALICE, 0);
    const state = makeState({ cardInstances: [stone] });

    const next = checkAndQueueUnsealChoicesForHandIncrease(
      state,
      ALICE,
      null,
      getCardDef,
      "test:grandstone:615"
    );
    expect(mechanicPendings(next, "unseal")).toHaveLength(0);
  });
});

// ── 解封解決（コア+1）と転醒閾値 ─────────────────────────

describe("解封解決とコア閾値転醒のキュー", () => {
  function stateWithPendingUnseal(stoneCores: number): GameState {
    const stone = fieldCard("gs1", "GS-001", ALICE, stoneCores);
    const spirit = fieldCard("sp1", "HAK-001", ALICE, 1);
    const state = makeState({ cardInstances: [stone, spirit] });
    return checkAndQueueUnsealChoicesForCardEvent(
      state,
      "sp1",
      "summon",
      getCardDef,
      "test:grandstone:632"
    );
  }

  it("受諾でボイドからコア1個が創界石に置かれる", () => {
    const state = stateWithPendingUnseal(0);
    const pendingId = mechanicPendings(state, "unseal")[0]!.pendingId;
    const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;

    const next = resolveMechanicPending(state, pendingId, true);

    expect(getCard(next, "gs1").normalCoreCount).toBe(1);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(voidBefore - 1);
    expect(mechanicPendings(next, "unseal")).toHaveLength(0);
  });

  it("辞退ではコアが動かない", () => {
    const state = stateWithPendingUnseal(0);
    const pendingId = mechanicPendings(state, "unseal")[0]!.pendingId;

    const next = resolveMechanicPending(state, pendingId, false);

    expect(getCard(next, "gs1").normalCoreCount).toBe(0);
    expect(mechanicPendings(next, "unseal")).toHaveLength(0);
    expect(mechanicPendings(next, "stone_rebirth")).toHaveLength(0);
  });

  it("受諾でコアが閾値（3個）に到達したら転醒選択がキューされる", () => {
    const state = stateWithPendingUnseal(2);
    const pendingId = mechanicPendings(state, "unseal")[0]!.pendingId;

    const next = resolveMechanicPending(state, pendingId, true);

    expect(getCard(next, "gs1").normalCoreCount).toBe(3);
    const rebirths = mechanicPendings(next, "stone_rebirth");
    expect(rebirths).toHaveLength(1);
    expect(rebirths[0]!.mechanic.grandstoneInstanceId).toBe("gs1");
  });

  it("閾値未満では転醒選択はキューされない", () => {
    const state = stateWithPendingUnseal(0);
    const pendingId = mechanicPendings(state, "unseal")[0]!.pendingId;

    const next = resolveMechanicPending(state, pendingId, true);

    expect(mechanicPendings(next, "stone_rebirth")).toHaveLength(0);
  });

  it("カウント超過（転醒条件不成立）では転醒選択はキューされない", () => {
    let state = stateWithPendingUnseal(2);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === ALICE ? { ...p, countValue: 4 } : p
      ),
    };
    const pendingId = mechanicPendings(state, "unseal")[0]!.pendingId;

    const next = resolveMechanicPending(state, pendingId, true);

    expect(mechanicPendings(next, "stone_rebirth")).toHaveLength(0);
  });

  it("既に閾値以上(3)でさらにコアが増えた(3→4)ときも再発火する（『N個以上になった』, 裁定2026-06-10）", () => {
    const before = makeState({
      cardInstances: [fieldCard("gs1", "GS-001", ALICE, 3)],
    });
    const after = {
      ...before,
      cardInstances: [fieldCard("gs1", "GS-001", ALICE, 4)],
    };
    const next = checkAndQueueStoneRebirthChoices(
      before,
      after,
      getCardDef,
      "test:grandstone:707"
    );
    expect(mechanicPendings(next, "stone_rebirth")).toHaveLength(1);
  });

  it("コアが減少したときは発火しない（4→3）", () => {
    const before = makeState({
      cardInstances: [fieldCard("gs1", "GS-001", ALICE, 4)],
    });
    const after = {
      ...before,
      cardInstances: [fieldCard("gs1", "GS-001", ALICE, 3)],
    };
    const next = checkAndQueueStoneRebirthChoices(
      before,
      after,
      getCardDef,
      "test:grandstone:719"
    );
    expect(mechanicPendings(next, "stone_rebirth")).toHaveLength(0);
  });

  it("増加でも結果が閾値未満なら発火しない（1→2, 閾値3）", () => {
    const before = makeState({
      cardInstances: [fieldCard("gs1", "GS-001", ALICE, 1)],
    });
    const after = {
      ...before,
      cardInstances: [fieldCard("gs1", "GS-001", ALICE, 2)],
    };
    const next = checkAndQueueStoneRebirthChoices(
      before,
      after,
      getCardDef,
      "test:grandstone:731"
    );
    expect(mechanicPendings(next, "stone_rebirth")).toHaveLength(0);
  });
});

// ── 転醒解決（裏返し + コア処分 + postRebirth） ───────────

describe("創界石の転醒解決", () => {
  function stateWithRebirthPending(options: {
    definitionId: string;
    cores: number;
    extraCards?: CardInstance[];
  }): GameState {
    const stone = fieldCard(
      "gs1",
      options.definitionId,
      ALICE,
      options.cores - 1
    );
    let state = makeState({
      cardInstances: [stone, ...(options.extraCards ?? [])],
    });
    const before = state;
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "gs1" ? { ...c, normalCoreCount: options.cores } : c
      ),
    };
    return checkAndQueueStoneRebirthChoices(
      before,
      state,
      getCardDef,
      "test:grandstone:760"
    );
  }

  it("受諾で、裏返す前に転醒内蔵の合体 pending が開く（合体型・候補ホストあり）", () => {
    const host = fieldCard("sp1", "HAK-001", ALICE, 1);
    let state = stateWithRebirthPending({
      definitionId: "GS-001",
      cores: 3,
      extraCards: [host],
    });
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === ALICE ? { ...p, voidNormalCoreCount: 0 } : p
      ),
    };
    expect(mechanicPendings(state, "stone_rebirth")).toHaveLength(1);

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    const rebirthAction = actions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "stone_rebirth"
    );
    expect(rebirthAction).toBeDefined();

    const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;
    const countBefore = getPlayer(state, ALICE).countValue;
    const result = applyLegalAction({
      state,
      action: rebirthAction!,
      getCardDefinitionById: getCardDef,
    });
    // 発揮宣言でスタック窓が開き、窓クローズ後に転醒が解決される (02:186)
    const next = passStackUntilClosed((result as { state: GameState }).state);

    expect(getCard(next, "gs1").definitionId).toBe("GS-001");
    expect(getCard(next, "gs1").normalCoreCount).toBe(3);
    // 転醒内蔵の合体選択が確定するまで、face swap / count / コア返却は保留する。
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(voidBefore);
    expect(getPlayer(next, ALICE).countValue).toBe(countBefore);
    expect(next.pendingStoneFlipCombine).not.toBeNull();
    expect(next.pendingStoneFlipCombine!.braveDefinitionId).toBe("GS-001B");
    expect(next.pendingStoneFlipCombine!.hostCandidateInstanceIds).toEqual([
      "sp1",
    ]);
  });

  it("合体選択でホストを選ぶと attached 状態になる", () => {
    const host = fieldCard("sp1", "HAK-001", ALICE, 1);
    let state = stateWithRebirthPending({
      definitionId: "GS-001",
      cores: 3,
      extraCards: [host],
    });
    let actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    state = passStackUntilClosed(
      (
        applyLegalAction({
          state,
          action: actions.find(
            (a) =>
              a.kind === "resolve_pending_triggered_effect" &&
              a.eventKind === "stone_rebirth"
          )!,
          getCardDefinitionById: getCardDef,
        }) as { state: GameState }
      ).state
    );

    actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    const combineToHost = actions.find(
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.chosenHostInstanceId === "sp1"
    );
    expect(combineToHost).toBeDefined();

    const next = (
      applyLegalAction({
        state,
        action: combineToHost!,
        getCardDefinitionById: getCardDef,
      }) as { state: GameState }
    ).state;

    expect(getCard(next, "gs1").attachedToInstanceId).toBe("sp1");
    expect(getCard(next, "gs1").definitionId).toBe("GS-001B");
    expect(getCard(next, "sp1").attachedChildrenIds).toContain("gs1");
    expect(next.pendingStoneFlipCombine).toBeNull();
  });

  it("辞退では裏返らず pending だけ消える", () => {
    const state = stateWithRebirthPending({
      definitionId: "GS-001",
      cores: 3,
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    const result = applyLegalAction({
      state,
      action: actions.find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.eventKind === "stone_rebirth"
      )!,
      getCardDefinitionById: getCardDef,
      skipOptionalEffect: true,
    });
    const next = (result as { state: GameState }).state;

    expect(getCard(next, "gs1").definitionId).toBe("GS-001");
    expect(getCard(next, "gs1").normalCoreCount).toBe(3);
    expect(mechanicPendings(next, "stone_rebirth")).toHaveLength(0);
  });

  it("チャージ型は裏返す前にコア配分 pending を開き、解決後に 1 個残してボイドへ送る", () => {
    const other = fieldCard("sp1", "HAK-001", ALICE, 2);
    let state = stateWithRebirthPending({
      definitionId: "GS-002",
      cores: 4,
      extraCards: [other],
    });
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === ALICE ? { ...p, voidNormalCoreCount: 0 } : p
      ),
    };
    expect(mechanicPendings(state, "stone_rebirth")).toHaveLength(1);

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    const voidBefore = getPlayer(state, ALICE).voidNormalCoreCount;
    const countBefore = getPlayer(state, ALICE).countValue;
    const result = applyLegalAction({
      state,
      action: actions.find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.eventKind === "stone_rebirth"
      )!,
      getCardDefinitionById: getCardDef,
    });
    const next = passStackUntilClosed((result as { state: GameState }).state);

    expect(getCard(next, "gs1").definitionId).toBe("GS-002");
    expect(getCard(next, "gs1").normalCoreCount).toBe(4);
    expect(getPlayer(next, ALICE).voidNormalCoreCount).toBe(voidBefore);
    expect(getPlayer(next, ALICE).countValue).toBe(countBefore);
    // フィールド/リザーブからの任意コア配置 pending（候補は投影後の B 面）。
    expect(next.pendingCoreDistribution).not.toBeNull();
    expect(next.pendingCoreDistribution!.fromKind).toBe("any_movable");
    expect(next.pendingCoreDistribution!.candidates).toEqual([
      { instanceId: "gs1", definitionId: "GS-002B" },
    ]);
    // ソースにリザーブ + 他の自分フィールドカード（転醒後スピリット自身は含まない）
    const keys = Object.keys(next.pendingCoreDistribution!.sourceAvailable!);
    expect(keys).toContain("reserve");
    expect(keys).toContain("field:sp1");
    expect(keys).not.toContain("field:gs1");

    const resolveAction = getLegalActions({
      state: next,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(resolveAction).toBeDefined();
    const resolved = applyLegalAction({
      state: next,
      action: resolveAction!,
      getCardDefinitionById: getCardDef,
      coreDistributionAllocations: { gs1: 1 },
      coreDistributionSourceAllocations: { "field:sp1": 1 },
    }).state;
    expect(getCard(resolved, "gs1").definitionId).toBe("GS-002B");
    expect(getCard(resolved, "gs1").normalCoreCount).toBe(2);
    expect(getCard(resolved, "sp1").normalCoreCount).toBe(1);
    // 3個をボイドへ戻し、転醒 count+1 で1個をカウントエリアへ置く。
    expect(getPlayer(resolved, ALICE).voidNormalCoreCount).toBe(voidBefore + 2);
    expect(getPlayer(resolved, ALICE).countValue).toBe(countBefore + 1);
    expect(resolved.pendingCoreDistribution).toBeNull();
  });
});

// ── P3-92: mechanic pending のソース消失 skipOnly drain ───

describe("P3-92: mechanic pending のソース消失 drain", () => {
  it("創界石がフィールドを離れた後の転醒 pending は skipOnly になり drain できる", () => {
    const before = makeState({
      cardInstances: [fieldCard("gs1", "GS-001", ALICE, 2)],
    });
    const after = {
      ...before,
      cardInstances: [fieldCard("gs1", "GS-001", ALICE, 3)],
    };
    let state = checkAndQueueStoneRebirthChoices(
      before,
      after,
      getCardDef,
      "test:grandstone:974"
    );
    expect(mechanicPendings(state, "stone_rebirth")).toHaveLength(1);

    // 創界石がフィールドを離れる（pending は残留）
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "gs1" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    const drain = actions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "stone_rebirth"
    );
    expect(drain).toBeDefined();
    expect((drain as { skipOnly?: boolean } | undefined)?.skipOnly).toBe(true);

    // skipOnly action は skipOptionalEffect 指定なしでも辞退として drain される
    const next = (
      applyLegalAction({
        state,
        action: drain!,
        getCardDefinitionById: getCardDef,
      }) as { state: GameState }
    ).state;
    expect(mechanicPendings(next, "stone_rebirth")).toHaveLength(0);
    expect(getCard(next, "gs1").definitionId).toBe("GS-001");
  });

  it("解封 pending は誘発キュー本体に乗る（旧 oracle guard の代替で advanceStep もブロック）", () => {
    const stone = fieldCard("gs1", "GS-001", ALICE, 0);
    const spirit = fieldCard("sp1", "HAK-001", ALICE, 1);
    const state = checkAndQueueUnsealChoicesForCardEvent(
      makeState({ cardInstances: [stone, spirit] }),
      "sp1",
      "summon",
      getCardDef,
      "test:grandstone:1013"
    );
    expect(state.pendingTriggeredEffects).toHaveLength(1);
  });
});

// ── 転醒イベント由来の解封と自己除外 ─────────────────────

describe("解封: 転醒イベントと rebirthExcludedFromUnseal", () => {
  /** 転醒トリガー解封を持つ創界石（rebirth イベント監視） */
  function stoneRebirthListenerDef(): CardDefinition {
    const base = stoneCombineDef();
    return {
      ...base,
      cardNo: "GS-003",
      name: "転醒監視創界石",
      grandstoneData: {
        unsealConditions: [
          {
            events: ["summon", "rebirth"],
            cardFilter: { tribes: ["幻想"] },
          },
        ],
        rebirthCoreThreshold: 3,
        rebirthMaxCount: 9,
        rebirthRetainCores: 0,
        rebirthExcludedFromUnseal: true,
      },
    } as CardDefinition;
  }
  defMap.set("GS-003", stoneRebirthListenerDef());

  it("他カードの転醒（B面が条件にマッチ）で解封選択がキューされる", () => {
    const listener = fieldCard("gs3", "GS-003", ALICE, 0);
    // GS-001B（テスト転醒後ブレイヴ・系統 幻想）に裏返ったカード
    // createCardInstance は originalDefinitionId を definitionId 固定にするため後から上書き
    const flipped: CardInstance = {
      ...fieldCard("gs1", "GS-001B", ALICE, 0),
      originalDefinitionId: "GS-001",
    };
    const state = makeState({ cardInstances: [listener, flipped] });

    const next = checkAndQueueUnsealChoicesForCardEvent(
      state,
      "gs1",
      "rebirth",
      getCardDef,
      "test:grandstone:1059"
    );
    // GS-001 の A 面は rebirthExcludedFromUnseal を持たないので発火する
    expect(mechanicPendings(next, "unseal")).toHaveLength(1);
  });

  it("rebirthExcludedFromUnseal 持ちの転醒では解封が発火しない", () => {
    const listener = fieldCard("gs3a", "GS-003", ALICE, 0);
    // GS-003 自身が裏返ったケース（A面が rebirthExcludedFromUnseal: true）
    const flipped: CardInstance = {
      ...fieldCard("gs3b", "GS-001B", ALICE, 0),
      originalDefinitionId: "GS-003",
    };
    const state = makeState({ cardInstances: [listener, flipped] });

    const next = checkAndQueueUnsealChoicesForCardEvent(
      state,
      "gs3b",
      "rebirth",
      getCardDef,
      "test:grandstone:1078"
    );
    expect(mechanicPendings(next, "unseal")).toHaveLength(0);
  });
});

// ── 実カードデータの創界石表現 ───────────────────────────

describe("実カード: 創界石 5 枚の grandstoneData", () => {
  const byNo = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
  const stoneNos = [
    "BSTH001-転醒R01(A)",
    "BSTH02.7-TR03(A)",
    "BSTH04-転醒R01(A)",
    "BSTH06-転醒X01(A)",
    "BSTH07-転醒X02(A)",
  ];

  it("tribe 創界石の全カードが grandstoneData と配置時コア禁止タグを持つ", () => {
    const stones = ALL_CARDS.filter((c) => c.tribe?.includes("創界石"));
    expect(stones.map((c) => c.cardNo).sort()).toEqual([...stoneNos].sort());
    for (const stone of stones) {
      expect(stone.grandstoneData, stone.cardNo).toBeDefined();
      expect(stone.keywordTags, stone.cardNo).toContain(
        "enter_field_core_placement_forbidden"
      );
      expect(stone.grandstoneData!.rebirthCoreThreshold).toBeGreaterThan(0);
    }
  });

  it("BSTH02.7-TR03(A) アリスの人形工房: 召喚/転醒解封 + 転醒で解封不可 + 合体", () => {
    const card = byNo.get("BSTH02.7-TR03(A)")!;
    const gs = card.grandstoneData!;
    expect(gs.unsealConditions).toHaveLength(2);
    expect(gs.unsealConditions[0]!.events).toEqual(["summon", "rebirth"]);
    expect(gs.unsealConditions[0]!.cardFilter?.nameContains).toEqual([
      "アリス邸",
    ]);
    expect(gs.unsealConditions[1]!.cardFilter?.tribes).toEqual([
      "導魔",
      "動玩",
    ]);
    expect(gs.rebirthCoreThreshold).toBe(3);
    expect(gs.rebirthMaxCount).toBe(9);
    expect(gs.rebirthRetainCores).toBe(0);
    expect(gs.postRebirth).toBe("combine_with_own_spirit");
    expect(gs.rebirthExcludedFromUnseal).toBe(true);
    // 転醒後ブレイヴ 操り糸 の Lv1 必要コアは 0（裁定2026-06-10: 旧データ 1 は誤記）。
    // 全コアボイド(retainCores 0)後、合体しなくても 0 コアで存続する。
    expect(card.backFace!.levelDefs[0]!.requiredCores).toBe(0);
  });
});

// ── 転醒同時不可ガードの窓スコープ ───────────────────────

describe("転醒同時不可ガードの action 窓スコープ", () => {
  it("過去の action で転醒済みでも、新しい action 窓では転醒できる", () => {
    const stone = fieldCard("gs1", "GS-001", ALICE, 3);
    const state = makeState({
      cardInstances: [stone],
      log: ["effect:rebirth:old-card:flip_to:OLD-B:retain=0:return=0:void"],
    });
    // applyLegalAction 相当: actionStartLogIndex を現在の log 長に設定
    const windowed: GameState = {
      ...state,
      actionStartLogIndex: state.log.length,
      log: [...state.log],
    };

    const next = executeRebirth(
      windowed,
      ALICE,
      {
        kind: "rebirth",
        maxCount: 9,
        triggerDescription: "test",
        retainCores: 0,
        returnedCoresDest: "void",
      },
      "gs1",
      getCardDef,
      "test:grandstone:1151"
    );
    expect(getCard(next, "gs1").definitionId).toBe("GS-001B");
  });

  it("同一 action 窓内の 2 回目の転醒はブロックされる", () => {
    const stone = fieldCard("gs1", "GS-001", ALICE, 3);
    const state = makeState({ cardInstances: [stone] });
    const windowed: GameState = {
      ...state,
      actionStartLogIndex: state.log.length,
      log: [
        ...state.log,
        "effect:rebirth:other:flip_to:X-B:retain=0:return=0:void",
      ],
    };

    const next = executeRebirth(
      windowed,
      ALICE,
      {
        kind: "rebirth",
        maxCount: 9,
        triggerDescription: "test",
      },
      "gs1",
      getCardDef,
      "test:grandstone:1179"
    );
    expect(getCard(next, "gs1").definitionId).toBe("GS-001");
    expect(next.log.some((l) => l.includes("blocked:same-timing"))).toBe(true);
  });
});
