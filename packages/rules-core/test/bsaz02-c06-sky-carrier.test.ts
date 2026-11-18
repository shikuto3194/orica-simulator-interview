/**
 * BSAZ02-C06 スカイキャリア effects[1]: 【アルドノアドライブ：1】Lv1 フラッシュ
 * 『お互いのアタックステップ』〔ターンに1回：同名〕手札の系統「ＣＦ」を持つアルティメット
 * カード1枚を軽減シンボルすべてを満たして召喚できる。そうしたとき、このスピリットの下の
 * 「アルドノアドライブ」を召喚したアルティメットの下に加え、このスピリットをトラッシュに置く。
 *
 * cluster bsaz02-aldnoah-drive-card-tail (2026-07-15): needs-dsl.audit.jsonl:BSAZ02-C06 の
 * 残ギャップ (b)(c) を解消する2つの新規汎用 primitive を検証する。
 * - (b) place_text_role_under_card の moveFrom:"self_under_card"
 *   (engine-under-card-host-reparent、native-under-card-placement-handlers.ts)。
 * - (c) move_self の共通離場待機と、実移動時のコア返却。
 *   先行core_moveではなく共通flushに委ね、残置反応中は場のコアを保つ。
 * (a) 軽減シンボル全数充足判定は ENGINE-summon-symbol-reduction-cost で別途検証済み
 * (engine-summon-full-reduction-candidate-gate.test.ts) のため、本ファイルは合成の CF アルティ
 * メット候補 (1軽減シンボルのみ) で環境を単純化し、(b)(c) の新規挙動に焦点を当てる。
 */
import { describe, expect, it } from "vitest";
import { BSAZ02_CARDS } from "../../card-data/src/cards/BSAZ02";
import { BSDB01_CARDS } from "../../card-data/src/cards/BSDB01";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executePlaceTextRoleUnderCard } from "../src/effect/native-under-card-placement-handlers";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import { createStepExecutionContext } from "../src/step-execution-context";
import type { CardDefinition, GameState } from "../src/model";
import type { DSL } from "../src/dsl-types";
import { applyLegalAction, getLegalActions, flushPendingLeaves } from "../src";

const ALICE = "player-1";
const BOB = "player-2";

const C06_CARD = BSAZ02_CARDS.find((c) => c.cardNo === "BSAZ02-C06")!;
const C10_CARD = BSAZ02_CARDS.find((c) => c.cardNo === "BSAZ02-C10")!; // 「アルドノアドライブ」実カード

// 合成 CF アルティメット候補: full_reduction ゲートを単純化するため軽減シンボル1枠のみ
// (C06 自身の symbolColors:["white"] 1枚で満数供給できる)。
const CF_ULTIMATE_FIXTURE: CardDefinition = {
  cardNo: "TEST-CF-ULT",
  name: "CFアルティメット試験体",
  printedCategory: "ultimate",
  colors: ["white"],
  cost: 1,
  reductionSymbols: ["white"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "ＣＦ",
  sourceUrls: [],
  sourceConfidence: "C",
};

const defRegistry = new Map<string, CardDefinition>([
  [C06_CARD.cardNo, C06_CARD],
  [C10_CARD.cardNo, C10_CARD],
  [CF_ULTIMATE_FIXTURE.cardNo, CF_ULTIMATE_FIXTURE],
]);
const getCardDefinitionById = (id: string) => defRegistry.get(id);
const noTriggerLookup = () => [];

function resolveSummonPlacement(
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  }).find((candidate) => candidate.kind === "resolve_pending_multi_placement");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
    multiPlacementAllocations: action!.targets.map((target) => ({
      destinationInstanceId: target.instanceId,
      placements: [{ kind: "reserve_normal", amount: target.minimumCoreCount }],
    })),
  }).state;
}

describe("engine-under-card-host-reparent: place_text_role_under_card moveFrom:self_under_card", () => {
  function buildScene(): {
    state: GameState;
    oldHostId: string;
    newHostId: string;
    driveId: string;
  } {
    const oldHost = createCardInstance(C06_CARD, {
      instanceId: "old-host",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const drive = createCardInstance(C10_CARD, {
      instanceId: "drive",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
      attachedToInstanceId: oldHost.instanceId,
    });
    const oldHostWithDrive = {
      ...oldHost,
      underCards: [
        {
          cardInstanceId: drive.instanceId,
          role: "text_role" as const,
          roleTag: "アルドノアドライブ",
        },
      ],
    };
    const newHost = createCardInstance(CF_ULTIMATE_FIXTURE, {
      instanceId: "new-host",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [oldHostWithDrive, drive, newHost],
    });
    return {
      state,
      oldHostId: oldHost.instanceId,
      newHostId: newHost.instanceId,
      driveId: drive.instanceId,
    };
  }

  const action: DSL.PlaceTextRoleUnderCardAction = {
    kind: "place_text_role_under_card",
    hostTarget: { kind: "trigger_related_instance" },
    roleTag: "アルドノアドライブ",
    fallbackMaxCount: 1,
    moveFrom: "self_under_card",
  };

  it("旧 host の下から外し、新 host の下へ付け替える", () => {
    const { state, oldHostId, newHostId, driveId } = buildScene();
    const stepCtx = createStepExecutionContext(state);
    stepCtx.triggerRelatedInstanceId = newHostId;
    const next = executePlaceTextRoleUnderCard(
      action,
      state,
      ALICE,
      oldHostId,
      getCardDefinitionById,
      stepCtx
    );

    const drive = next.cardInstances.find((c) => c.instanceId === driveId)!;
    expect(drive.attachedToInstanceId).toBe(newHostId);

    const oldHost = next.cardInstances.find((c) => c.instanceId === oldHostId)!;
    expect(oldHost.underCards.some((u) => u.cardInstanceId === driveId)).toBe(
      false
    );

    const newHost = next.cardInstances.find((c) => c.instanceId === newHostId)!;
    expect(
      newHost.underCards.some(
        (u) =>
          u.cardInstanceId === driveId && u.roleTag === "アルドノアドライブ"
      )
    ).toBe(true);
  });

  it("sourceInstanceId の下に該当 roleTag のアンダーカードが無ければ no-op", () => {
    const { state, newHostId } = buildScene();
    const stateNoUnder: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "old-host" ? { ...c, underCards: [] } : c
      ),
    };
    const stepCtx = createStepExecutionContext(stateNoUnder);
    stepCtx.triggerRelatedInstanceId = newHostId;
    const next = executePlaceTextRoleUnderCard(
      action,
      stateNoUnder,
      ALICE,
      "old-host",
      getCardDefinitionById,
      stepCtx
    );
    expect(next).toBe(stateNoUnder);
  });
});

describe("BSAZ02-C06 スカイキャリア effects[1]: 統合 (summon → reparent → コア返却 → トラッシュ)", () => {
  function buildState(): GameState {
    const skyCarrier = createCardInstance(C06_CARD, {
      instanceId: "sky-carrier",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const drive = createCardInstance(C10_CARD, {
      instanceId: "drive",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
      attachedToInstanceId: skyCarrier.instanceId,
    });
    const skyCarrierWithDrive = {
      ...skyCarrier,
      underCards: [
        {
          cardInstanceId: drive.instanceId,
          role: "text_role" as const,
          roleTag: "アルドノアドライブ",
        },
      ],
    };
    const cfUltimateInHand = createCardInstance(CF_ULTIMATE_FIXTURE, {
      instanceId: "cf-ultimate-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [skyCarrierWithDrive, drive, cfUltimateInHand],
    });
    return {
      ...baseState,
      players: baseState.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 1, reserveNormalCoreCount: 5 } : p
      ),
    };
  }

  const effect = C06_CARD.effects![1]!;
  const effectIndex = 1;

  it("召喚成立時: 召喚したアルティメットの下へドライブを付け替え、コアをリザーブへ戻してトラッシュへ", () => {
    const state = buildState();
    const before = state.players.find((p) => p.id === ALICE)!;

    const afterSummon = executeEffect({
      chainId: "test:bsaz02-c06-sky-carrier:241",
      state,
      effect,
      effectIndex,
      sourceInstanceId: "sky-carrier",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const after = resolveSummonPlacement(afterSummon, getCardDefinitionById);

    const summoned = after.cardInstances.find(
      (c) => c.instanceId === "cf-ultimate-hand"
    )!;
    expect(summoned.zone).toBe("field");

    // (b) ドライブが旧 host (スカイキャリア) から召喚されたアルティメットの下へ付け替わる。
    const drive = after.cardInstances.find((c) => c.instanceId === "drive")!;
    expect(drive.attachedToInstanceId).toBe(summoned.instanceId);
    expect(
      summoned.underCards.some(
        (u) =>
          u.cardInstanceId === "drive" && u.roleTag === "アルドノアドライブ"
      )
    ).toBe(true);

    // (c) スカイキャリア自身のコアはリザーブへ返り、トラッシュへ置かれる。
    const skyCarrier = after.cardInstances.find(
      (c) => c.instanceId === "sky-carrier"
    )!;
    expect(skyCarrier.zone).toBe("trash");
    expect(skyCarrier.normalCoreCount).toBe(0);
    expect(
      skyCarrier.underCards.some((u) => u.cardInstanceId === "drive")
    ).toBe(false);

    const afterAlice = after.players.find((p) => p.id === ALICE)!;
    // 元々スカイキャリアに乗っていた1個がリザーブへ戻る一方、召喚コストのフィールド
    // 進入時維持コア (requiredCores:1) をリザーブから支払うため差し引き 0。
    expect(afterAlice.reserveNormalCoreCount).toBe(
      before.reserveNormalCoreCount
    );

    // 共通離場処理後、第三者の「フィールドを離れたとき」が1回だけ観測できる。
    const events = collectTriggerEventsFromStateDelta({
      beforeState: state,
      afterState: after,
      source: "action_resolution",
    });
    expect(
      events.filter(
        (e) =>
          e.eventKind === "leave_field" && e.relatedInstanceId === "sky-carrier"
      )
    ).toHaveLength(1);
  });

  it("付け替えが失敗しても、召喚成立後は元の本体と残った下カードをトラッシュに置く", () => {
    const state = buildState();
    // 新 host 側の【アルドノアドライブ】枠を 0 にして reparent (slot-full) を強制的に失敗させる。
    const noSlotFixture: CardDefinition = {
      ...CF_ULTIMATE_FIXTURE,
      cardNo: "TEST-CF-ULT-NO-SLOT",
      underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 0 }],
    };
    const noSlotDefRegistry = new Map<string, CardDefinition>([
      [C06_CARD.cardNo, C06_CARD],
      [C10_CARD.cardNo, C10_CARD],
      [noSlotFixture.cardNo, noSlotFixture],
    ]);
    const stateWithNoSlotCandidate: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "cf-ultimate-hand"
          ? { ...c, definitionId: noSlotFixture.cardNo }
          : c
      ),
    };
    const before = stateWithNoSlotCandidate.players.find(
      (p) => p.id === ALICE
    )!;

    const afterSummon = executeEffect({
      chainId: "test:bsaz02-c06-sky-carrier:325",
      state: stateWithNoSlotCandidate,
      effect,
      effectIndex,
      sourceInstanceId: "sky-carrier",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => noSlotDefRegistry.get(id),
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const after = resolveSummonPlacement(afterSummon, (id) =>
      noSlotDefRegistry.get(id)
    );

    const summoned = after.cardInstances.find(
      (c) => c.instanceId === "cf-ultimate-hand"
    )!;
    expect(summoned.zone).toBe("field"); // 召喚自体は成立する

    // 付け替えと本体の離場は独立。付け替えできない下カードは本体に従って離場する。
    const drive = after.cardInstances.find((c) => c.instanceId === "drive")!;
    expect(drive.attachedToInstanceId).toBeNull();
    expect(drive.zone).toBe("trash");

    const skyCarrier = after.cardInstances.find(
      (c) => c.instanceId === "sky-carrier"
    )!;
    expect(skyCarrier.zone).toBe("trash");
    expect(skyCarrier.normalCoreCount).toBe(0);
    expect(
      skyCarrier.underCards.some((u) => u.cardInstanceId === "drive")
    ).toBe(false);

    const afterAlice = after.players.find((p) => p.id === ALICE)!;
    expect(afterAlice.reserveNormalCoreCount).toBe(
      before.reserveNormalCoreCount
    );
  });

  it("手札に候補が無ければ召喚が成立せず、スカイキャリアは場に残る", () => {
    const state = buildState();
    const stateNoCandidate: GameState = {
      ...state,
      cardInstances: state.cardInstances.filter(
        (c) => c.instanceId !== "cf-ultimate-hand"
      ),
      players: state.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 0 } : p
      ),
    };

    const after = executeEffect({
      chainId: "test:bsaz02-c06-sky-carrier:376",
      state: stateNoCandidate,
      effect,
      effectIndex,
      sourceInstanceId: "sky-carrier",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const skyCarrier = after.cardInstances.find(
      (c) => c.instanceId === "sky-carrier"
    )!;
    expect(skyCarrier.zone).toBe("field");
    expect(skyCarrier.normalCoreCount).toBe(1);
  });
});

describe("move_self: 既存の離場置換との整合", () => {
  const PICCOLO_CARD = BSDB01_CARDS.find((c) => c.cardNo === "BSDB01-M02")!;
  const piccoloDefRegistry = new Map<string, CardDefinition>([
    [PICCOLO_CARD.cardNo, PICCOLO_CARD],
  ]);
  const getPiccoloDef = (id: string) => piccoloDefRegistry.get(id);

  it("BSDB01-M02 の残置→手札移動コストが成立し、合成離場マーカーを重ねない", () => {
    const piccolo = createCardInstance(PICCOLO_CARD, {
      instanceId: "piccolo",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [piccolo],
    });
    const stateWithLevel: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === ALICE ? { ...p, voidNormalCoreCount: 1 } : p
      ),
    };

    const leaveFieldEffect = PICCOLO_CARD.effects!.find(
      (e) =>
        e.timing.kind === "card_event" &&
        e.timing.event === "leave_field" &&
        e.timing.cause === "opponent_effect"
    )!;
    const effectIndex = PICCOLO_CARD.effects!.indexOf(leaveFieldEffect);

    const pendingState = queuePendingLeave({
      state: stateWithLevel,
      instanceId: "piccolo",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId: "opponent-destroy",
    });
    const after = executeEffect({
      chainId: "test:bsaz02-c06-sky-carrier:427",
      state: pendingState,
      effect: leaveFieldEffect,
      effectIndex,
      sourceInstanceId: "piccolo",
      actingPlayerId: ALICE,
      getCardDefinitionById: getPiccoloDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    // move_self(destination:"hand") 自体は実行されている (カードは手札へ移動)。
    const settled = flushPendingLeaves(after, getPiccoloDef);
    const piccoloAfter = settled.cardInstances.find(
      (c) => c.instanceId === "piccolo"
    )!;
    expect(
      piccoloAfter.zone,
      JSON.stringify({
        pending: settled.pendingLeaveEntities,
        log: settled.log,
      })
    ).toBe("hand");

    // 物理離場は共通差分から1回だけ観測し、合成マーカーによる追加イベントを作らない。
    expect(
      collectTriggerEventsFromStateDelta({
        beforeState: pendingState,
        afterState: settled,
        source: "action_resolution",
      }).filter(
        (event) =>
          event.eventKind === "leave_field" &&
          event.relatedInstanceId === "piccolo"
      )
    ).toHaveLength(1);
    expect(
      after.log.some((entry) =>
        entry.startsWith("effect:move_self:field_departure:")
      )
    ).toBe(false);
  });
});
