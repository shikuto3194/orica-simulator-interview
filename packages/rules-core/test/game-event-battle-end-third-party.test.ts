/**
 * 第三者 game_event:battle_end 観測トリガー。
 *
 * ルール正源: 10_rules/02_turn-flow-and-timing.md「バトル終了時 に誘発する効果を先に解決し」。
 *
 * 従来 `battle_end` は OPT_IN_TRIGGER_EVENT_KINDS に入っており、filterOptInTriggerEvents が
 * バトル参加カード自身 (relatedInstanceId) の card_event:battle_end しか通さなかったため、
 * 「自分の〔系統/コスト〕スピリットのバトル終了時」(BSTH001-C04 地獄) のような第三者カード上の
 * game_event 観測リスナーが一切発火しなかった。recover と同じく OPT_IN から外し、source
 * スキャン (getAvailableTriggeredEffectSourceChoices) で第三者リスナーを拾えるようにする。
 *
 * 併せて、game_event 経路でも `require_related_instance_on_field` 検証を効かせ、バトル中に
 * 破壊され trash に落ちた参加カードを観測する誤発火を防ぐ (burst 経路と同じ validationMode 規約)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
  StructuredTriggerEvent,
} from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

/** BSTH001-C04 地獄: 系統「靈異」コスト5以上の自分の赤スピリットのバトル終了時に発火する観測ネクサス。 */
const JIGOKU = cardNoMap.get("BSTH001-C04")!;

/** フィルタ (靈異 / 赤 / コスト5以上 / スピリット) にマッチするバトル参加スピリット。 */
function makeParticipantDef(cost: number): CardDefinition {
  return {
    cardNo: `TEST-BE-PARTICIPANT-${cost}`,
    name: `テスト参加スピリット ${cost}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["red"],
    tribe: "幻想・靈異",
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

const ALICE = "alice";
const BOB = "bob";

function setup(opts: {
  participantDef: CardDefinition;
  participantZone: "field" | "trash";
}): {
  state: GameState;
  nexusId: string;
  participantId: string;
  getDef: (id: string) => CardDefinition | undefined;
  lookup: ReturnType<typeof buildTriggeredEffectLookup>;
} {
  const nexus = createCardInstance(JIGOKU, {
    instanceId: "jigoku-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1, // Lv2
  });
  const participant = createCardInstance(opts.participantDef, {
    instanceId: "participant-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: opts.participantZone,
    normalCoreCount: 1,
  });

  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [nexus, participant],
  });

  const defs = new Map<string, CardDefinition>([
    [JIGOKU.cardNo, JIGOKU],
    [opts.participantDef.cardNo, opts.participantDef],
  ]);

  return {
    state,
    nexusId: nexus.instanceId,
    participantId: participant.instanceId,
    getDef: (id) => defs.get(id),
    lookup: buildTriggeredEffectLookup([JIGOKU, opts.participantDef]),
  };
}

function battleEndPending(
  relatedInstanceId: string,
  actionKind: "attack" | "block"
): PendingTriggeredEffect {
  const event: StructuredTriggerEvent = {
    family: "battle_end",
    validationMode: "require_related_instance_on_field",
    actionKind,
  };
  return {
    pendingId: "pte:battle-end-1",
    actingPlayerId: ALICE,
    eventKind: "battle_end",
    event,
    source: "battle_resolution",
    chainId: "test:game-event-battle-end-third-party:109",
    attackId: "attack:be-1:1",
    relatedPlayerId: ALICE,
    relatedInstanceId,
    amount: 0,
    step: "attack",
    window: "declare_attack",
    resolvedSourceInstanceIds: [],
  } as PendingTriggeredEffect;
}

describe("第三者 game_event:battle_end — BSTH001-C04 地獄", () => {
  it("自分の靈異赤コスト5スピリットが攻撃側で参加したバトル終了時、観測ネクサスが候補に含まれる", () => {
    const ctx = setup({
      participantDef: makeParticipantDef(5),
      participantZone: "field",
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.nexusId)
    ).toBeDefined();
  });

  it("コスト4のスピリット (minCost 5 を満たさない) のバトル終了では候補に含まれない", () => {
    const ctx = setup({
      participantDef: makeParticipantDef(4),
      participantZone: "field",
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.nexusId)
    ).toBeUndefined();
  });

  it("ブロック側参加 (actionKind=block) は『自分のアタックステップ』(action:attack) に該当せず候補に含まれない", () => {
    const ctx = setup({
      participantDef: makeParticipantDef(5),
      participantZone: "field",
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "block"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.nexusId)
    ).toBeUndefined();
  });

  it("バトル中に破壊され trash に落ちた参加カードの観測は発火しない (require_related_instance_on_field)", () => {
    const ctx = setup({
      participantDef: makeParticipantDef(5),
      participantZone: "trash",
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.nexusId)
    ).toBeUndefined();
  });

  it("pendingLeave 中の参加カードの観測は発火しない (10_rules/02 形式3 require_related_instance_on_field 補正)", () => {
    // verifier 2026-06-22 round 8 lens 6: zone === 'field' だけ見て pendingLeaveKind を
    // 見ない欠落を補正。同期 flush 前に離脱予定 (pendingLeaveKind != null) の参加カードでも
    // game_event:battle_end を観測してしまう silent gap を塞ぐ。
    const ctx = setup({
      participantDef: makeParticipantDef(5),
      participantZone: "field",
    });
    const stateWithPendingLeave: GameState = {
      ...ctx.state,
      cardInstances: ctx.state.cardInstances.map((c) =>
        c.instanceId === ctx.participantId
          ? { ...c, pendingLeaveKind: "destroy" as const }
          : c
      ),
    };
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: stateWithPendingLeave,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.nexusId)
    ).toBeUndefined();
  });

  it("『コストはXとしても扱う』(additional_cost CE) が triggerFilter.minCost に反映される (verifier 2026-06-22 補正)", () => {
    // 印字コスト 4 (minCost 5 不一致) のスピリットに additional_cost: 5 CE を登録すると
    // matchesCardFilter は additionalCosts=[5] を踏まえて minCost:5 を満たすと判定する。
    const ctx = setup({
      participantDef: makeParticipantDef(4),
      participantZone: "field",
    });
    const stateWithAdditionalCost: GameState = {
      ...ctx.state,
      activeContinuousEffects: [
        ...ctx.state.activeContinuousEffects,
        {
          effectId: "additional-cost-5-on-participant",
          modifierTag: "additional_cost",
          modifierAmount: 5,
          targetInstanceId: ctx.participantId,
          sourceInstanceId: ctx.participantId,
          sourceDefinitionId: ctx.state.cardInstances[1]!.definitionId,
          provenance: {
            kind: "card_effect",
            effectIndex: 0,
          },
          duration: { scope: "permanent" },
        } as unknown as GameState["activeContinuousEffects"][number],
      ],
    };
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: stateWithAdditionalCost,
      pendingEffect: battleEndPending(ctx.participantId, "attack"),
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.nexusId)
    ).toBeDefined();
  });
});
