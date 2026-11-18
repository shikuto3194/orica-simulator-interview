/**
 * BSSA01-転醒X03(A) 修剣士ユージオ の転醒（合体相手を煌臨元に畳む）回帰テスト。
 *
 * engine-drain 2026-06-16: 転醒トリガー stub 解消。
 *  - トリガー: このスピリットが相手によってフィールドを離れるとき
 *    = card_event:leave_field cause:["opponent_effect","battle"]（08a L93 スピリット）。
 *  - 転醒条件: 自分のカウント5以下 = condition count_value(max:5)。
 *  - 効果: 合体している「青薔薇の剣」を煌臨元として追加して裏返す
 *    = 指定名の合体ブレイヴ1枚をmove_cardで煌臨元へ追加→conditional_cost rebirth。
 *    合体相手の選択、全量支払い、転醒、元の合体/バトル状態を実印字effectで検査する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  adventSourceIdsOf,
  applyLegalAction,
  getLegalActions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  hasCannotCombineRestriction,
} from "../src";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type {
  BattleEntity,
  CardDefinition,
  GameState,
  RebirthAction,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function resolveCoreChoice(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  amount: number,
  sourceKey = "reserve"
) {
  const pending = state.pendingCoreDistribution;
  expect(pending).not.toBeNull();
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
  }).find((a) => a.kind === "resolve_pending_core_distribution")!;
  return applyLegalAction({
    state,
    action,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(
      expandCardDefinitionsWithBackFaces(ALL_CARDS)
    ),
    coreDistributionAllocations: { [pending!.sourceInstanceId]: amount },
    coreDistributionSourceAllocations: { [sourceKey]: amount },
  }).state;
}

describe("BSSA01-転醒X03(A) 修剣士ユージオ（合体相手を煌臨元に畳む転醒）", () => {
  const front = cardNoMap.get("BSSA01-転醒X03(A)")!;

  it("[5,6]: 相手離脱トリガー + 指定名の合体相手1枚を対価に転醒", () => {
    const eff = front.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        (e.timing as { event?: string }).event === "leave_field"
    )!;
    expect(eff).toBeTruthy();
    expect(eff.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    expect(eff.executionMode).toBe("optional");
    expect(eff.condition).toEqual([
      { kind: "count_value", player: "self", max: 5 },
    ]);
    expect(eff.stub).toBeUndefined();
    expect(eff.steps[0]!.action).toMatchObject({
      kind: "move_card",
      requireFullCount: true,
      count: 1,
      target: {
        kind: "filter",
        count: 1,
        filter: {
          cardName: { contains: "青薔薇の剣" },
          attachedToSource: true,
        },
      },
      to: { sourceUnderCardRole: "advent_source" },
    });
    expect(eff.steps[1]!.connector).toBe("conditional_cost");
    const rebirth = eff.steps[1]!.action;
    expect(rebirth.kind).toBe("rebirth");
    if (rebirth.kind === "rebirth") {
      expect(rebirth.maxCount).toBe(5);
      expect(rebirth.foldCombinedPartnerToAdventSource).toBeUndefined();
    }
  });

  it("転醒: 合体ブレイヴが転醒後 host の煌臨元へ畳まれ、host が裏返りカウント+1", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const getDef = (id: string) => map.get(id);

    const hostDef = getDef("BSSA01-転醒X03(A)")!;
    const braveDef = getDef("BSSA01-転醒X02(A)")!; // 青薔薇の剣（合体ブレイヴ）

    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 2,
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    // 合体リンク: host <- brave。
    host.attachedChildrenIds = ["brave-1"];
    brave.attachedToInstanceId = "host-1";

    // host が相手 (bob) の効果でフィールドを離れる待機状態。
    host.pendingLeaveKind = "destroy";
    host.pendingLeaveCause = "effect_resolution";
    host.pendingLeaveChainId = "chain-1";

    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
      battleEntities: [
        {
          entityId: "battle-entity:host-1",
          memberInstanceIds: ["host-1", "brave-1"],
          resolvedBp: 12000,
          resolvedSymbols: ["white", "white"],
          attackState: "idle",
        } satisfies BattleEntity,
      ],
    });
    before.pendingLeaveEntities = [
      {
        instanceId: "host-1",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: "bob",
        chainId: "chain-1",
        deferZoneMoveUntilChainEnd: false,
      },
    ];

    const after = executeEffect({
      state: before,
      effect: hostDef.effects![2]!,
      effectIndex: 2,
      actingPlayerId: "alice",
      sourceInstanceId: "host-1",
      getCardDefinitionById: getDef,
      chainId: "test:transmute-fold-advent-source:153",
    });

    // flip 成立: 裏面定義へ差し替わり、フィールドに残置。
    const flipped = after.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(flipped.definitionId).toBe("BSSA01-転醒X03(B)");
    expect(flipped.zone).toBe("field");
    expect(flipped.pendingLeaveKind).toBeNull();

    // 合体ブレイヴが host の煌臨元（advent_source）へ畳まれた。
    expect(adventSourceIdsOf(flipped)).toContain("brave-1");
    // host 側の合体リンクは解除済み。
    expect(flipped.attachedChildrenIds).toEqual([]);

    // 煌臨元になったブレイヴ: A 面復帰・field 残置・コア0・合体リンク解除。
    const foldedBrave = after.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    )!;
    expect(foldedBrave.zone).toBe("field");
    expect(foldedBrave.attachedToInstanceId).toBeNull();
    expect(foldedBrave.normalCoreCount).toBe(0);
    expect(foldedBrave.zoneRoleName).toBe("advent-source");
    expect(after.players[0]!.reserveNormalCoreCount).toBe(
      before.players[0]!.reserveNormalCoreCount + 1
    );

    // battle entity から煌臨元化した brave を除外し、転醒後 host 単体で再計算する。
    expect(after.battleEntities[0]!.memberInstanceIds).toEqual(["host-1"]);
    expect(after.battleEntities[0]!.resolvedBp).toBe(13000);
    expect(after.battleEntities[0]!.resolvedSymbols).toEqual(["white"]);

    // カウント +1。
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);
    expect(
      after.log.some((l) => l.includes("effect:move_card:field->field:1cards"))
    ).toBe(true);
  });
});

describe("BSSA01-転醒X02(A) 青薔薇の剣（host「ユージオ」を煌臨元に畳む逆パターン転醒）", () => {
  const front = cardNoMap.get("BSSA01-転醒X02(A)")!;

  it("[10,11]: game_event leave_field 第三者観測 cardName「ユージオ」フィルタ + rebirth fold / stub 解消", () => {
    const eff = front.effects!.find(
      (e) =>
        e.timing.kind === "game_event" &&
        (e.timing as { event?: string }).event === "leave_field"
    )!;
    expect(eff).toBeTruthy();
    expect(eff.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
      triggerFilter: { cardName: { contains: "ユージオ" } },
    });
    expect(eff.executionMode).toBe("optional");
    expect(eff.condition).toEqual([
      { kind: "combined" },
      { kind: "count_value", player: "self", max: 5 },
    ]);
    expect(eff.stub).toBeUndefined();
    const rebirth = eff.steps[0]!.action;
    expect(rebirth.kind).toBe("rebirth");
    if (rebirth.kind === "rebirth") {
      expect(rebirth.maxCount).toBe(5);
      expect(rebirth.foldCombinedPartnerToAdventSource).toBe(true);
    }
  });

  it.each(["retained", "waiting-host"])(
    "%s: host「ユージオ」が離脱待機中にブレイヴの煌臨元へ畳まれ、ブレイヴが裏返りカウント+1",
    (coreSource) => {
      const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
      const map = new Map(expanded.map((d) => [d.cardNo, d]));
      const getDef = (id: string) => map.get(id);

      const hostDef = getDef("BSSA01-転醒X03(A)")!;
      const braveDef = getDef("BSSA01-転醒X02(A)")!; // 青薔薇の剣（合体ブレイヴ）

      const host = createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 2,
      });
      const brave = createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: coreSource === "waiting-host" ? 0 : 1,
      });
      // 合体リンク: host <- brave。
      host.attachedChildrenIds = ["brave-1"];
      brave.attachedToInstanceId = "host-1";

      // host が相手 (bob) の効果でフィールドを離れる待機状態（ブレイヴ視点では第三者観測）。
      host.pendingLeaveKind = "destroy";
      host.pendingLeaveCause = "effect_resolution";
      host.pendingLeaveChainId = "chain-1";

      const before: GameState = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
        battleEntities: [
          {
            entityId: "battle-entity:host-1",
            memberInstanceIds: ["host-1", "brave-1"],
            resolvedBp: 12000,
            resolvedSymbols: ["white", "white"],
            attackState: "idle",
          } satisfies BattleEntity,
        ],
      });
      before.pendingLeaveEntities = [
        {
          instanceId: "host-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "chain-1",
          deferZoneMoveUntilChainEnd: false,
        },
      ];

      const action: RebirthAction = {
        kind: "rebirth",
        maxCount: 5,
        triggerDescription: "",
        foldCombinedPartnerToAdventSource: true,
        separatesFromHost: true,
      };
      // sourceInstanceId = brave-1 (このブレイヴ自身が flip する側)。
      const pending = executeRebirth(
        before,
        "alice",
        action,
        "brave-1",
        getDef,
        "test:transmute-fold-advent-source:284"
      );
      const after = resolveCoreChoice(
        pending,
        getDef,
        coreSource === "waiting-host" ? 1 : 0,
        "field:host-1"
      );
      expect(
        after.cardInstances.find((c) => c.instanceId === "brave-1")
          ?.normalCoreCount
      ).toBe(1);
      expect(
        after.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
      ).toBe(
        before.players.find((p) => p.id === "alice")!.reserveNormalCoreCount +
          (coreSource === "waiting-host" ? 1 : 2)
      );

      // flip 成立: ブレイヴが裏面定義へ差し替わり、フィールドに残置（host 自身は flip しない）。
      const flippedBrave = after.cardInstances.find(
        (c) => c.instanceId === "brave-1"
      )!;
      expect(flippedBrave.definitionId).toBe("BSSA01-転醒X02(B)");
      expect(flippedBrave.zone).toBe("field");

      // host が brave の煌臨元（advent_source）へ畳まれた。
      expect(adventSourceIdsOf(flippedBrave)).toContain("host-1");
      // brave 側の合体リンクは解除済み。
      expect(flippedBrave.attachedToInstanceId).toBeNull();

      // 煌臨元になった host: A 面復帰・field 残置・コア0・pendingLeave 解除・合体リンク解除。
      const foldedHost = after.cardInstances.find(
        (c) => c.instanceId === "host-1"
      )!;
      expect(foldedHost.zone).toBe("field");
      expect(foldedHost.pendingLeaveKind).toBeNull();
      expect(foldedHost.attachedChildrenIds).toEqual([]);
      expect(foldedHost.normalCoreCount).toBe(0);
      expect(foldedHost.zoneRoleName).toBe("advent-source");

      // 離脱待機を煌臨元へ置換したため、host の pendingLeaveEntities エントリは
      // stale なまま残らず除去されている (resolveAdventSourceReplacement と同じ後処理)。
      expect(
        after.pendingLeaveEntities.some((pl) => pl.instanceId === "host-1")
      ).toBe(false);

      // battle entity から煌臨元化した host を除外し、転醒後 brave 単体で再計算する。
      expect(after.battleEntities[0]!.memberInstanceIds).toEqual(["brave-1"]);
      expect(after.battleEntities[0]!.resolvedBp).toBe(6000);
      expect(after.battleEntities[0]!.resolvedSymbols).toEqual([
        "red",
        "white",
      ]);

      // カウント +1。
      expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);
      expect(
        after.log.some((l) => l.includes(":fold-advent-source:host-1"))
      ).toBe(true);
    }
  );
});

describe("BSSA01-転醒X03(B) ユージオ-物質変換- （textLines[5,6] 合体できない継続効果）", () => {
  it("BSSA01-転醒X03(B) cannot_combine: 抑制可能な継続効果の keywords を実行時に参照する", () => {
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    const map = new Map(expanded.map((d) => [d.cardNo, d]));
    const backDef = map.get("BSSA01-転醒X03(B)")!;
    expect(backDef.keywordTags).not.toContain("cannot_combine");
    const restriction = backDef.effects!.find((effect) =>
      effect.textRef?.includes(6)
    )!;
    expect(restriction).toMatchObject({
      timing: { kind: "continuous" },
      applicability: { level: { min: 1, max: 3 } },
      steps: [
        {
          action: {
            kind: "override_properties",
            target: { kind: "self" },
            properties: { keywords: ["cannot_combine"] },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    });

    const flipped = createCardInstance(backDef, {
      instanceId: "host-flipped",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [flipped],
      }),
      (id) => map.get(id)
    );
    expect(hasCannotCombineRestriction(state, "host-flipped", backDef)).toBe(
      true
    );
  });
});

describe("BSSA01-転醒X03(B) ユージオ-物質変換- 背面[2,3] 相手1体デッキ下+効果発揮させない+相手の効果で防げない", () => {
  const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
  const map = new Map(expanded.map((d) => [d.cardNo, d]));
  const backDef = map.get("BSSA01-転醒X03(B)")!;
  const getDef = (id: string) => map.get(id);
  const eff = backDef.effects!.find(
    (e) => Array.isArray(e.textRef) && e.textRef[0] === 2
  )!;

  it("構造: 煌臨中ゲート+unpreventable+send_to_deck→after_state_check→suppress_pending_leave_effects(ref)", () => {
    expect(eff.condition).toEqual([{ kind: "self_state", state: "advented" }]);
    expect(eff.preventionLevel).toBe("unpreventable");
    expect(eff.stub).toBeUndefined();
    const sendStep = eff.steps[0]!;
    expect(sendStep.id).toBe("send_to_deck_bottom");
    expect(sendStep.action).toMatchObject({
      kind: "send_to_deck",
      position: "bottom",
      target: {
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      },
    });
    const suppressStep = eff.steps[1]!;
    expect(suppressStep.connector).toBe("after_state_check");
    expect(suppressStep.action).toEqual({
      kind: "suppress_pending_leave_effects",
      target: { kind: "ref", stepId: "send_to_deck_bottom" },
      suppressDestroyedEffects: "destroyed_only",
    });
  });

  it("盤面変化: 相手スピリット1体がデッキ下へ移動し、そのスピリット自身の離脱誘発(count_increase)は抑制され発揮されない", () => {
    // 離脱時に自分(bob)のカウント+1する own leave-trigger を持つ合成カードを対象にする。
    const observerDef: CardDefinition = {
      cardNo: "TEST-LEAVE-OBSERVER",
      name: "テスト離脱観測体",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "leave_field" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
      ],
    };
    const getDefWithObserver = (id: string) =>
      id === observerDef.cardNo ? observerDef : getDef(id);

    const host = createCardInstance(backDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
    });
    // 【煌臨中】ゲートを満たすためのダミー煌臨元。
    const adventSource = createCardInstance(backDef, {
      instanceId: "advent-src-1",
      ownerPlayerId: "alice",
      zone: "field",
    });
    host.underCards = [
      { cardInstanceId: "advent-src-1", role: "advent_source" },
    ];
    const target = createCardInstance(observerDef, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      zone: "field",
      zoneRoleName: "spirit",
    });
    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, adventSource, target],
    });
    const bobBefore = before.players.find((p) => p.id === "bob")!;

    const lookup = buildTriggeredEffectLookup([observerDef]);
    const resolved = executeEffect({
      chainId: "test:transmute-fold-advent-source:486",
      state: before,
      effect: eff,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDefWithObserver,
      getRegisteredTriggeredEffectActions: lookup,
    });
    const after = finalizeEffectResolution({
      beforeState: before,
      state: resolved,
      chainId: "audit-suppressed-departure",
      endLogs: [],
      actingPlayerId: "alice",
      causedBySourceInstanceId: "host-1",
      getCardDefinitionById: getDefWithObserver,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: () => [],
    });

    const moved = after.cardInstances.find((c) => c.instanceId === "target-1")!;
    expect(moved.zone).toBe("deck");
    const bobAfter = after.players.find((p) => p.id === "bob")!;
    expect(bobAfter.deckCount).toBe(bobBefore.deckCount + 1);
    // 抑制確認: 対象自身の「フィールドを離れるとき」誘発が発揮されていれば countValue+1 されるはず。
    expect(bobAfter.countValue).toBe(bobBefore.countValue);
    expect(after.pendingTriggeredEffects).toHaveLength(0);
  });
});

describe("BSSA01-転醒X03(B) ユージオ-物質変換- 背面[8,9] 煌臨元「青薔薇の剣」の外部転醒（合体していたものとして発揮）", () => {
  // needs-ruling.jsonl:BSSA01-転醒X03(B) 裁定(d) (2026-07-11 ユーザー確定): 「青薔薇の剣」の
  // 【転醒】印字テキストが「分離し裏返せる」と明記しているため、コア配置を選択してから転醒する。
  // 転醒条件(自分のカウント5以下)自体は免除対象ではない。
  const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
  const map = new Map(expanded.map((d) => [d.cardNo, d]));
  const getDef = (id: string) => map.get(id);
  const backDef = map.get("BSSA01-転醒X03(B)")!;
  const braveBackDef = map.get("BSSA01-転醒X02(B)")!; // 赤薔薇の剣（転醒先）
  const eff = backDef.effects!.find(
    (e) => Array.isArray(e.textRef) && e.textRef[0] === 8
  )!;

  it("構造: target が煌臨元スコープ限定(adventSourceScope:'include')+cardName「青薔薇の剣」、maxCount:5+separatesFromHost", () => {
    expect(eff.stub).toBeUndefined();
    expect(eff.executionMode).toBe("optional");
    const rebirth = eff.steps[0]!.action;
    expect(rebirth.kind).toBe("rebirth");
    if (rebirth.kind === "rebirth") {
      expect(rebirth.maxCount).toBe(5);
      expect(rebirth.separatesFromHost).toBe(true);
      expect(rebirth.forceTriggerCondition).toBeUndefined();
      expect(rebirth.target).toEqual({
        kind: "filter",
        player: "self",
        filter: {
          cardName: { contains: "青薔薇の剣" },
          adventSourceScope: "include",
        },
        sourceUnderCardRole: "advent_source",
        count: 1,
      });
    }
  });

  it("盤面変化: attachAsAdventSource 標準経路と同じくコア0の煌臨元でも、リザーブからのコア補填でLv1コア要件を満たして flip 成立", () => {
    const host = createCardInstance(backDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    // 煌臨元「青薔薇の剣」: attachAsAdventSource が実際に生成する状態と同一（コア0・field残置）。
    const brave = createCardInstance(map.get("BSSA01-転醒X02(A)")!, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    host.underCards = [{ cardInstanceId: "brave-1", role: "advent_source" }];

    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });

    const pending = executeEffect({
      chainId: "test:transmute-fold-advent-source:574",
      state: before,
      effect: eff,
      sourceInstanceId: "host-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      targetInstanceIds: ["brave-1"],
      targetSelectionResolved: true,
    });

    const after = resolveCoreChoice(pending, getDef, 1);
    const flippedBrave = after.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    )!;
    expect(flippedBrave.definitionId).toBe(braveBackDef.cardNo);
    expect(flippedBrave.zone).toBe("field");
    // Lv1 requiredCores=1 をリザーブからの補填 (1) で満たして維持。
    expect(flippedBrave.normalCoreCount).toBe(1);
    expect(
      after.log.some((l) => l.includes("effect:rebirth:brave-1:lv-deficit"))
    ).toBe(false);
    // 剣へ1個補填した後、煌臨元化したユージオの1個がリザーブへ戻る。
    expect(
      after.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(1);
    expect(adventSourceIdsOf(flippedBrave)).toEqual(["host-1"]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "host-1")
    ).toMatchObject({
      zoneRoleName: "advent-source",
      normalCoreCount: 0,
      underCards: [],
    });
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);
  });

  it("裏付け: 補填元となるコアが一切ない（リザーブ0・自軍フィールドに他カードなし）なら、コア0のまま配置不能で不発", () => {
    const host = createCardInstance(backDef, {
      instanceId: "host-0",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      // 補填元候補が本当に0であることを検証するため、host自身のコアも0にする
      // (host はフィールド上の通常カードで canMoveCoresFrom 対象になり得るため)。
      normalCoreCount: 0,
    });
    const brave = createCardInstance(map.get("BSSA01-転醒X02(A)")!, {
      instanceId: "brave-0",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    host.underCards = [{ cardInstanceId: "brave-0", role: "advent_source" }];

    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });

    const after = executeEffect({
      chainId: "test:transmute-fold-advent-source:634",
      state: before,
      effect: eff,
      sourceInstanceId: "host-0",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      targetInstanceIds: ["brave-0"],
      targetSelectionResolved: true,
    });

    const untouchedBrave = after.cardInstances.find(
      (c) => c.instanceId === "brave-0"
    )!;
    expect(untouchedBrave.definitionId).toBe("BSSA01-転醒X02(A)");
    expect(untouchedBrave.normalCoreCount).toBe(0);
    expect(
      after.log.some((l) =>
        l.includes("effect:rebirth:brave-0:post-choice-no-core")
      )
    ).toBe(true);
  });

  it("転醒条件は免除対象外: 自分のカウントが5を超えていれば flip しない（count-over）", () => {
    const host = createCardInstance(backDef, {
      instanceId: "host-2",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(map.get("BSSA01-転醒X02(A)")!, {
      instanceId: "brave-2",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    host.underCards = [{ cardInstanceId: "brave-2", role: "advent_source" }];

    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
    });
    const withCount: GameState = {
      ...before,
      players: before.players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 7 } : p
      ),
    };

    const after = executeEffect({
      chainId: "test:transmute-fold-advent-source:684",
      state: withCount,
      effect: eff,
      sourceInstanceId: "host-2",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      targetInstanceIds: ["brave-2"],
      targetSelectionResolved: true,
    });

    const untouchedBrave = after.cardInstances.find(
      (c) => c.instanceId === "brave-2"
    )!;
    expect(untouchedBrave.definitionId).toBe("BSSA01-転醒X02(A)");
    expect(
      after.log.some((l) => l.includes("effect:rebirth:brave-2:count-over"))
    ).toBe(true);
  });
});
