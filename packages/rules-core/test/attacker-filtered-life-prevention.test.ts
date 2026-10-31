/**
 * 攻撃者限定ライフ減少防止 — life_damage_interception mode:"replace" の
 * attackerFilter / attackerSelf 拡張の検証。
 *
 * プリミティブ: バトルのアタッカー (leader = 先頭 member) がフィルタに一致する
 * 参加体のライフ減少のみを 0 にする per-participant 防止。フィルタ外アタッカーの
 * ライフ減少は通常解決する。floor / replace の player 全体防止とは別軸。
 *
 * ルール正源: 10_rules/05_brave-and-attack-special-cases.md L118
 * 「ブロックされなかった参加体のライフ減少を…まとめて処理」= per-participant 帰属。
 *
 * 解禁カード:
 *  - BSSA01-C06 [1] コスト4以上の相手スピリットのアタックでライフが減らない (attackerFilter)
 *  - BSFT01-TR02(B)/TR12(B)/TR13(B) このスピリットによって相手のライフは減らない (attackerSelf)
 *  - BSTH002-M01 [2] このバトル中、自分ライフは0にならない (floor battle scope)
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  ActiveAttack,
  BattleEntity,
  BattleResolutionGroup,
  CardDefinition,
  GameState,
} from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  executeBattleResolution,
  getUnblockedLifeDamage,
} from "../src/battle/battle-actions";
import {
  resolveLifeDamage,
  getPlayerLifeCoreCount,
} from "../src/core/core-system";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId = ALICE
): GameState {
  return executeEffect({
    chainId: "test:attacker-filtered-life-prevention:58",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

const player = (s: GameState, id: string) =>
  s.players.find((p) => p.id === id)!;

/**
 * 単一アタッカー (entityId) が ALICE 不在・BOB がアタックして player target=ALICE の
 * battleResolutionGroup を組む。各アタッカーは symbols 1 個 = ライフ 1 減少。
 */
function withBattle(
  state: GameState,
  attackers: { entityId: string; leaderId: string }[],
  targetPlayerId: string
): GameState {
  const battleEntities: BattleEntity[] = attackers.map((a) => ({
    entityId: a.entityId,
    memberInstanceIds: [a.leaderId],
    resolvedBp: 5000,
    resolvedSymbols: ["red"],
    attackState: "attacking",
  }));
  const group: BattleResolutionGroup = {
    attackId: "atk-1",
    groupMode: "single",
    target: { kind: "player", playerId: targetPlayerId },
    symbolResolutionOrder: attackers.map((a) => a.entityId),
    participantSnapshots: attackers.map((a) => ({
      entityId: a.entityId,
      memberInstanceIds: [a.leaderId],
      resolvedBp: 5000,
      resolvedSymbols: ["red"],
      blockedBy: [],
    })),
  };
  const activeAttack: ActiveAttack = {
    attackId: group.attackId,
    primaryEntityId: attackers[0]?.entityId ?? "missing-attacker",
    participantEntityIds: attackers.map((attacker) => attacker.entityId),
    groupMode: attackers.length > 1 ? "simultaneous" : "single",
    target: group.target,
    blockAssignments: attackers.map((attacker) => ({
      participantEntityId: attacker.entityId,
      blockedByEntityIds: [],
    })),
    symbolResolutionOrder: group.symbolResolutionOrder,
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: true,
    flashWindowState: null,
  };
  return {
    ...state,
    step: "attack",
    window: "battle_resolution",
    activePlayerId: state.players[0]?.id ?? ALICE,
    activeAttack,
    battleEntities,
    battleResolutionGroup: group,
  };
}

describe("攻撃者限定ライフ減少防止 (life_damage_interception attackerFilter/attackerSelf)", () => {
  it("BSSA01-C06 [1] effects: attackerFilter {minCost:4, spirit} の replace CE を登録", () => {
    const c = card("BSSA01-C06");
    const flash = c.effects![1]!;
    expect(flash.stub).toBeUndefined();
    const action = flash.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("replace");
      expect(action.player).toBe("self");
      expect(action.attackerFilter).toEqual({
        category: ["spirit"],
        minCost: 4,
      });
    }
  });

  it("[board] BSSA01-C06: コスト4以上のアタッカーはライフ減少 0、コスト3以下は通る", () => {
    const c = card("BSSA01-C06");
    const magic = createCardInstance(c, {
      instanceId: "ssa-c06",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    // 攻撃側 (BOB): コスト4スピリット と コスト3スピリット。
    const highCost = createCardInstance(card("BSSA01-C04"), {
      instanceId: "atk-high",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const lowCost = createCardInstance(card("BSSA01-C01"), {
      instanceId: "atk-low",
      ownerPlayerId: BOB,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [magic, highCost, lowCost],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    // ALICE がフラッシュ効果で attackerFilter replace CE を登録。
    state = runEffect(state, c.effects![1]!, "ssa-c06");
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "life_damage_interception"
      )
    ).toBe(true);

    // 2 体同時アタック (cost4 + cost3) → ALICE 防御。
    const battleState = withBattle(
      state,
      [
        { entityId: "e-high", leaderId: "atk-high" },
        { entityId: "e-low", leaderId: "atk-low" },
      ],
      ALICE
    );
    const dmg = getUnblockedLifeDamage(battleState, getDef);
    // cost4 は防止、cost3 のみ 1 ダメージ。
    expect(dmg).not.toBeNull();
    expect(dmg!.totalLifeDamage).toBe(1);
  });

  it("BSFT01-TR02(B)/TR12(B)/TR13(B) effects: attackerSelf の replace CE (opponent 保護) を登録", () => {
    for (const cardNo of [
      "BSFT01-TR02(B)",
      "BSFT01-TR12(B)",
      "BSFT01-TR13(B)",
    ]) {
      const c = card(cardNo);
      const eff = c.effects!.find(
        (e) => e.steps[0]?.action.kind === "life_damage_interception"
      )!;
      expect(eff.stub).toBeUndefined();
      const action = eff.steps[0]!.action;
      expect(action.kind).toBe("life_damage_interception");
      if (action.kind === "life_damage_interception") {
        expect(action.mode).toBe("replace");
        expect(action.player).toBe("opponent");
        expect(action.attackerSelf).toBe(true);
      }
    }
  });

  it("level-heading-all-defined-levels: TR12(B)/TR13(B) は全Lvでライフ減少を防止する", () => {
    for (const cardNo of ["BSFT01-TR12(B)", "BSFT01-TR13(B)"]) {
      const c = card(cardNo);
      const levelHeading = c.textLines.find((line) =>
        /^Lv\d+(?:-Lv\d+)*$/.test(line)
      );
      expect(levelHeading).toBe("Lv1-Lv2-Lv3");
      expect(c.levelDefs.map((levelDef) => levelDef.level)).toEqual([1, 2, 3]);

      const effect = c.effects!.find(
        (candidate) =>
          candidate.steps[0]?.action.kind === "life_damage_interception"
      )!;
      for (const normalCoreCount of [1, 2, 3]) {
        const self = createCardInstance(c, {
          instanceId: `${cardNo}-Lv${normalCoreCount}-self`,
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount,
        });
        const registered = runEffect(
          createEmptyGameState({
            cardInstances: [self],
            playerOverrides: [
              { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
              { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
            ],
          }),
          effect,
          self.instanceId
        );
        const declaredBattle = withBattle(
          registered,
          [
            {
              entityId: `${cardNo}-Lv${normalCoreCount}-entity`,
              leaderId: self.instanceId,
            },
          ],
          BOB
        );
        const resolved = executeBattleResolution({
          // withBattle は getUnblockedLifeDamage 用に resolution group まで組む。
          // executeBattleResolution の本番開始経路では activeAttack から group を生成する。
          state: { ...declaredBattle, battleResolutionGroup: null },
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
          getRegisteredBurstActions: () => [],
        }).state;

        // 実バトル解決まで通して、B 面自身のシンボルによる相手ライフ減少を 0 にする。
        expect(getPlayerLifeCoreCount(player(resolved, BOB))).toBe(5);
        expect(player(resolved, BOB).reserveNormalCoreCount).toBe(0);
      }
    }
  });

  it("[board] BSFT01-TR02(B): このスピリットのアタックでは相手ライフが減らない", () => {
    const c = card("BSFT01-TR02(B)");
    // ALICE のスピリット (このカード自身) が BOB へアタックする。
    const self = createCardInstance(c, {
      instanceId: "tr02b-self",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    // 別の自スピリット (フィルタ外) も同時アタック。
    const other = createCardInstance(card("BSSA01-C01"), {
      instanceId: "tr02b-other",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [self, other],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    // 継続効果として attackerSelf CE を登録 (player:"opponent" = BOB を保護)。
    const effect = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "life_damage_interception"
    )!;
    state = runEffect(state, effect, "tr02b-self");
    const ce = state.activeContinuousEffects.find(
      (e) => e.modifierTag === "life_damage_interception"
    );
    expect(ce).toBeDefined();
    expect(
      (ce!.metadata as { attackerInstanceIds?: string[] }).attackerInstanceIds
    ).toEqual(["tr02b-self"]);

    // 2 体同時アタック (self + other) → BOB 防御。
    const battleState = withBattle(
      state,
      [
        { entityId: "e-self", leaderId: "tr02b-self" },
        { entityId: "e-other", leaderId: "tr02b-other" },
      ],
      BOB
    );
    const dmg = getUnblockedLifeDamage(battleState, getDef);
    // self は防止、other のみ 1 ダメージ。
    expect(dmg!.totalLifeDamage).toBe(1);
  });

  it("BSSG01-C06 [5,6] effects: attackerSelectedTarget の replace CE (target=相手スピ/アルティ1体)", () => {
    const c = card("BSSG01-C06");
    const eff = c.effects![2]!;
    expect(eff.stub).toBeUndefined();
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("replace");
      expect(action.player).toBe("self");
      expect(action.attackerSelectedTarget).toBe(true);
      expect(action.target).toEqual({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      });
    }
  });

  it("[board] BSSG01-C06: 指定した相手1体のアタックのみライフ減少 0、未指定は通る", () => {
    const c = card("BSSG01-C06");
    const magic = createCardInstance(c, {
      instanceId: "ssg-c06",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    // 相手 (BOB) のスピリット2体。片方を指定する。
    const chosen = createCardInstance(card("BSSA01-C04"), {
      instanceId: "atk-chosen",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const other = createCardInstance(card("BSSA01-C01"), {
      instanceId: "atk-other",
      ownerPlayerId: BOB,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [magic, chosen, other],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    // スタック効果を解決時に対象 "atk-chosen" が選ばれた前提で executeEffect に注入。
    state = executeEffect({
      chainId: "test:attacker-filtered-life-prevention:364",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "ssg-c06",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["atk-chosen"],
    });
    const ce = state.activeContinuousEffects.find(
      (e) => e.modifierTag === "life_damage_interception"
    );
    expect(ce).toBeDefined();
    expect(
      (ce!.metadata as { attackerInstanceIds?: string[] }).attackerInstanceIds
    ).toEqual(["atk-chosen"]);

    // 2 体同時アタック (chosen + other) → ALICE 防御。
    const battleState = withBattle(
      state,
      [
        { entityId: "e-chosen", leaderId: "atk-chosen" },
        { entityId: "e-other", leaderId: "atk-other" },
      ],
      ALICE
    );
    const dmg = getUnblockedLifeDamage(battleState, getDef);
    // 指定した chosen は防止、未指定 other のみ 1 ダメージ。
    expect(dmg!.totalLifeDamage).toBe(1);
  });

  it("BSTH002-M01 [2] effects: floor:1 (battle) CE を登録し致死ダメージをクランプ", () => {
    const c = card("BSTH002-M01");
    const flash = c.effects![2]!;
    expect(flash.stub).toBeUndefined();
    const action0 = flash.steps[0]!.action;
    expect(action0.kind).toBe("life_damage_interception");
    if (action0.kind === "life_damage_interception") {
      expect(action0.mode).toBe("floor");
      expect(action0.floor).toBe(1);
      expect(action0.duration).toEqual({ scope: "battle" });
    }

    const src = createCardInstance(c, {
      instanceId: "th002-m01",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    state = runEffect(state, c.effects![2]!, "th002-m01");
    // ライフ3に 5 ダメージ → floor=1 で 2 だけ通る。
    const after = resolveLifeDamage(state, ALICE, 5, [], {
      cause: "battle",
      actingPlayerId: ALICE,
    });
    expect(getPlayerLifeCoreCount(player(after, ALICE))).toBe(1);
  });

  it("[board] attackerFilter CE は対象外アタッカーへのライフ減少を誤って 0 にしない", () => {
    // attackerFilter 付き replace CE が applyLifeDamageInterception で
    // 全 damage を skip しないこと (回帰防止)。
    const c = card("BSSA01-C06");
    const magic = createCardInstance(c, {
      instanceId: "ssa-c06-reg",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [magic],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    state = runEffect(state, c.effects![1]!, "ssa-c06-reg");
    // attackerFilter CE は applyLifeDamageInterception では無視されるので
    // 通常のライフダメージが通る。
    const after = resolveLifeDamage(state, ALICE, 1, [], {
      cause: "battle",
      actingPlayerId: ALICE,
    });
    expect(getPlayerLifeCoreCount(player(after, ALICE))).toBe(2);
  });

  // ── getUnblockedLifeDamage の attackerFilter は実効 category で照合する ──
  // ([[project_effective_bp_ssot]] と同型: 印字値直読みでなく state 注入で
  //  act_as_spirit token を取り逃がさない、Lens 3 SSOT 回帰)。
  // 合成 CE (cost 条件無し category:[spirit] のみ) を直接登録し、印字 nexus を
  // act_as_spirit で spirit 扱いした leader が attackerFilter に一致して
  // ライフ減少が 0 にクランプされるかだけを検証する。
  it("[board] attackerFilter:{category:[spirit]} は act_as_spirit token attacker (printed nexus) を取り逃がさない", () => {
    // 攻撃側: 印字 category=nexus (BSFT01-C03 星霊界) を attacker leader にする。
    // 通常 nexus は battle 不可だが、act_as_spirit CE を載せると isSpirit=true となり
    // battle entities に乗りうる (battle-shared.ts L86)。matchesCardFilter が
    // effectiveCategory を見られないと、printed=nexus を読んで attackerFilter から外す。
    const nexusAsSpirit = createCardInstance(card("BSFT01-C03"), {
      instanceId: "nexus-as-spirit",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [nexusAsSpirit],
      playerOverrides: [
        { lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 },
      ],
    });
    // ALICE 保護の合成 life_damage_interception CE (attackerFilter category-only)
    // + attacker に act_as_spirit を載せて effectiveCategory=spirit にする。
    const stateWithCEs: GameState = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "ce-life-cat-only",
          sourceInstanceId: "synthetic-src",
          sourceDefinitionId: "SYN-001",
          actingPlayerId: ALICE,
          duration: { scope: "battle" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "life_damage_interception",
          targetInstanceId: ALICE,
          metadata: {
            cause: "any",
            mode: "replace",
            attackerFilter: { category: ["spirit"] },
          },
        },
        {
          effectId: "ce-act-spirit-nexus",
          sourceInstanceId: "synthetic-src",
          sourceDefinitionId: "SYN-002",
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "act_as_spirit",
          targetInstanceId: "nexus-as-spirit",
          metadata: {
            statBlueprint: {
              kind: "static_copy",
              snapshot: {
                cost: 3,
                reductionSymbols: [],
                symbolColors: ["red"],
                tribes: [],
                levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
              },
            },
          },
        },
      ],
    };
    // BOB の act_as_spirit token が ALICE をアタックする。
    const battleState = withBattle(
      stateWithCEs,
      [{ entityId: "e-act", leaderId: "nexus-as-spirit" }],
      ALICE
    );
    const dmg = getUnblockedLifeDamage(battleState, getDef);
    // 旧実装 (state 未注入) は printedCategory=nexus でフィルタを外し、ライフが 1 減る。
    // 修正後は effectiveCategory=spirit を見て、attackerFilter に一致して 0 にクランプ。
    expect(dmg).not.toBeNull();
    expect(dmg!.totalLifeDamage).toBe(0);
  });

  // ── getUnblockedLifeDamage の attackerFilter は additionalCosts (「コストはX
  // としても扱う」CE) も含めて minCost を判定する ──
  // (Lens 3 SSOT: card-filter.ts:497-502 は opts.additionalCosts を見る設計だが、
  //  注入されないと印字 cost のみで minCost 判定が外れる silent gap)。
  it("[board] attackerFilter:{minCost:4} は additional_cost CE で 4 扱いになる attacker (印字 cost 3) を取り逃がさない", () => {
    // 攻撃側: 印字 cost=3 の spirit attacker (BSSA01-C01 想定)。
    const attacker = createCardInstance(card("BSSA01-C01"), {
      instanceId: "low-cost-attacker",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [attacker],
      playerOverrides: [
        { lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 },
      ],
    });
    // ALICE 保護の合成 life_damage_interception CE (minCost:4 attackerFilter)。
    // attacker に additional_cost CE (cost=4 扱い) を載せる。
    const stateWithCEs: GameState = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "ce-life-mincost",
          sourceInstanceId: "synthetic-src",
          sourceDefinitionId: "SYN-001",
          actingPlayerId: ALICE,
          duration: { scope: "battle" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "life_damage_interception",
          targetInstanceId: ALICE,
          metadata: {
            cause: "any",
            mode: "replace",
            attackerFilter: { minCost: 4, category: ["spirit", "ultimate"] },
          },
        },
        {
          effectId: "ce-add-cost",
          sourceInstanceId: "synthetic-src",
          sourceDefinitionId: "SYN-002",
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "additional_cost",
          targetInstanceId: "low-cost-attacker",
          modifierAmount: 4,
          metadata: {},
        },
      ],
    };
    const battleState = withBattle(
      stateWithCEs,
      [{ entityId: "e-add", leaderId: "low-cost-attacker" }],
      ALICE
    );
    const dmg = getUnblockedLifeDamage(battleState, getDef);
    // 旧実装 (additionalCosts 未注入) は printed cost=3 で minCost:4 を外し、
    // ライフが 1 減る。修正後は additional_cost=4 を見て一致しクランプ。
    expect(dmg).not.toBeNull();
    expect(dmg!.totalLifeDamage).toBe(0);
  });

  it("[board] combined brave の life_damage 効果は attackerFilter 判定で host identity を使う", () => {
    const host = createCardInstance(card("BSSA01-C03"), {
      instanceId: "combined-life-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedChildrenIds: ["combined-life-brave"],
    });
    const brave = createCardInstance(card("BSSA01-転醒X02(B)"), {
      instanceId: "combined-life-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "combined-life-host",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, brave],
        playerOverrides: [
          { lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 },
        ],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-life-damage-source-filter-host",
          sourceInstanceId: "synthetic-src",
          sourceDefinitionId: "SYN-001",
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "life_damage_interception",
          targetInstanceId: BOB,
          metadata: {
            cause: "opponent_effect",
            mode: "replace",
            attackerFilter: { category: ["spirit"] },
          },
        },
      ],
    };
    const lifeDamageEffect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "life_damage",
            player: "opponent",
            amount: 1,
          },
        },
      ],
    } satisfies NonNullable<CardDefinition["effects"]>[number];

    const after = executeEffect({
      chainId: "test:attacker-filtered-life-prevention:652",
      state,
      effect: lifeDamageEffect,
      sourceInstanceId: "combined-life-host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: 99,
      effectSourceInstanceId: "combined-life-brave",
      effectSourceDefinitionId: "BSSA01-転醒X02(B)",
    });

    expect(getPlayerLifeCoreCount(player(after, BOB))).toBe(3);
  });

  it("[board] combined brave の life→reserve core_move は attackerFilter 判定で host identity を使う", () => {
    const host = createCardInstance(card("BSSA01-C03"), {
      instanceId: "combined-core-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedChildrenIds: ["combined-core-brave"],
    });
    const brave = createCardInstance(card("BSSA01-転醒X02(B)"), {
      instanceId: "combined-core-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "combined-core-host",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [host, brave],
        playerOverrides: [
          { lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 },
        ],
      }),
      activeContinuousEffects: [
        {
          effectId: "ce-core-move-source-filter-host",
          sourceInstanceId: "synthetic-src",
          sourceDefinitionId: "SYN-001",
          actingPlayerId: BOB,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "life_damage_interception",
          targetInstanceId: BOB,
          metadata: {
            cause: "opponent_effect",
            mode: "replace",
            attackerFilter: { category: ["spirit"] },
          },
        },
      ],
    };
    const lifeCoreMoveEffect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "life", player: "opponent" },
            to: { kind: "reserve", player: "opponent" },
            amount: 1,
          },
        },
      ],
    } satisfies NonNullable<CardDefinition["effects"]>[number];

    const after = executeEffect({
      chainId: "test:attacker-filtered-life-prevention:724",
      state,
      effect: lifeCoreMoveEffect,
      sourceInstanceId: "combined-core-host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: 99,
      effectSourceInstanceId: "combined-core-brave",
      effectSourceDefinitionId: "BSSA01-転醒X02(B)",
    });

    expect(getPlayerLifeCoreCount(player(after, BOB))).toBe(3);
    expect(player(after, BOB).reserveNormalCoreCount).toBe(0);
  });

  // ── recomputeContinuousEffects が life_damage_interception CE を誤除去しない ──
  // CE は targetInstanceId に playerId を格納する (effect-interpreter.ts:8017) ため、
  // isPlayerScopedCETag allowlist に居ないと recompute で「対象カード field 不在」と
  // 判定され即除去される silent bug。BSSA01-C06 等の既存 CE 共通の pre-existing gap
  // (effect-resolution.ts の resolution 経路で recompute が走る本番では effect が消える)。
  it("[regression] recomputeContinuousEffects は life_damage_interception CE を保持する (player-scoped allowlist)", () => {
    const c = card("BSSA01-C06");
    const magic = createCardInstance(c, {
      instanceId: "ssa-c06-recompute",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [magic],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    state = runEffect(state, c.effects![1]!, "ssa-c06-recompute");
    const before = state.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "life_damage_interception"
    );
    expect(before).toBeDefined();
    // recompute が走ると targetInstanceId=playerId が getCardById で未解決となり
    // 旧実装では即除去される (this assertion fails before fix)。
    const recomputed = recomputeContinuousEffects(state);
    const after = recomputed.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "life_damage_interception"
    );
    expect(after).toBeDefined();
  });
});
