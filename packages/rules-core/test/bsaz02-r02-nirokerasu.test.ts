/**
 * BSAZ02-R02「ニロケラス」effects[0..3] 検証。
 *
 * 原文 (textLines[0,2,4,5,7,8]):
 *   《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》
 *   【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで
 *   置ける。あるとき、以下の効果を得る）
 *   Lv3『このアルティメットの召喚/アタック時』
 *   ターンに1回、自分のターンなら、創界神ネクサス2つまでを破壊する。この効果で「ヴァース」を
 *   破壊したとき、［ゲームに1回同名］自分はデッキの上から3枚ドローする。
 *   Lv3
 *   自分のカウント5以下のとき、このアルティメットは、相手の効果を受けない。相手がカードを
 *   召喚/配置/使用したとき、自分のカウント+1する。さらにこのアルティメットとバトルした
 *   スピリット/アルティメットは、ただちに除外される。この除外効果は相手の効果で防げない。
 *
 * 検証点:
 *  - effects[0]: destroy(targetsGrandwalker:true, count{min:0,max:2}) + 破壊した中に
 *    「ヴァース」(BSAZ02-X04 相当) が含まれたときのみ ref_has_match ゲートで draw(3) が
 *    発火する (BSAZ02-C18 precedent 同型)。
 *  - effects[1]: count_value(max:5) が成立するときのみ effect_immunity CE が登録される
 *    (BSRK01-X02 precedent 同型)。
 *  - effects[2]: 相手の召喚/配置/マジック使用完了を card_used で観測し、カウントが+1。
 *  - effects[3]: queueBattleEndTriggers (trigger-system.ts) が battle_end イベントの
 *    relatedInstanceIds に対戦相手側参加体を積む新規配線を検証し、
 *    TargetSpec.trigger_related_instances 経由の remove_from_game が対戦相手のみを
 *    対象にすることを確認する。
 *  - summonCondition: exact-zero field_has。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { evaluateCondition } from "../src";
import { canSummonUltimate } from "../src/legal/legal-actions-shared";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { queueBattleEndTriggers } from "../src/effect/trigger-system";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";
const R02 = card("BSAZ02-R02");

function srcR02(instanceId = "src-r02") {
  const src = createCardInstance(R02, {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1, // Lv3
  });
  return {
    ...src,
    underCards: [
      {
        cardInstanceId: "under-drive",
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

function underFiller(hostId = "src-r02", instanceId = "under-drive") {
  return createCardInstance(card("BSAZ02-M01"), {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: hostId,
  });
}

function runEffect(
  state: GameState,
  effectIndex: number,
  opts: {
    triggerRelatedInstanceIds?: readonly string[];
    rangeAutoResolveStrategy?: "min" | "max";
    sourceInstanceId?: string;
  } = {}
): GameState {
  const { sourceInstanceId = "src-r02", ...effectOptions } = opts;
  return executeEffect({
    chainId: "test:bsaz02-r02-nirokerasu:93",
    state,
    effect: R02.effects[effectIndex]!,
    effectIndex,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
    ...effectOptions,
  });
}

describe("BSAZ02-R02 effects[0]（Lv3召喚/アタック時: 創界神ネクサス2つまで破壊 + 「ヴァース」破壊時デッキ3枚ドロー）", () => {
  it("お互いの創界神ネクサスを2つまで破壊する（通常ネクサスは対象外）", () => {
    const src = srcR02();
    const oppGrandwalker1 = createCardInstance(card("BSAZ02-X04"), {
      instanceId: "opp-gw-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const oppGrandwalker2 = createCardInstance(card("BSAZ02-X05"), {
      instanceId: "opp-gw-2",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const oppNormalNexus = createCardInstance(card("BSAZ01-C13"), {
      instanceId: "opp-normal-nexus",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        // 通常ネクサスを候補配列の先頭に置く: count{max:2}の枠を通常ネクサスが先取り
        // していないことを確認する (targetsGrandwalker:"only" の絞り込みが挿入順に
        // 依存しないことの証明。verifier round2 で "true"(非"only") 誤用による
        // 挿入順依存の偽陽性を指摘された)。
        src,
        underFiller(),
        oppNormalNexus,
        oppGrandwalker1,
        oppGrandwalker2,
      ],
    });
    const after = runEffect(state, 0, { rangeAutoResolveStrategy: "max" });

    const gw1 = after.cardInstances.find((c) => c.instanceId === "opp-gw-1")!;
    const gw2 = after.cardInstances.find((c) => c.instanceId === "opp-gw-2")!;
    const normal = after.cardInstances.find(
      (c) => c.instanceId === "opp-normal-nexus"
    )!;
    expect(gw1.zone !== "field" || gw1.pendingLeaveKind === "destroy").toBe(
      true
    );
    expect(gw2.zone !== "field" || gw2.pendingLeaveKind === "destroy").toBe(
      true
    );
    expect(normal.zone).toBe("field");
    expect(normal.pendingLeaveKind).toBeNull();
  });

  it("破壊した中に「ヴァース」を含むとき、デッキの上から3枚ドローする", () => {
    const src = srcR02();
    const versGrandwalker = createCardInstance(card("BSAZ02-X04"), {
      // BSAZ02-X04「[導界者]アセイラム・ヴァース・アリューシア」= 「ヴァース」を含む
      // 名前の実在 grandwalker ネクサス。
      instanceId: "opp-vers",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), versGrandwalker],
    });
    const before = state.players.find((p) => p.id === ALICE)!.deckCount;
    const after = runEffect(state, 0, { rangeAutoResolveStrategy: "max" });

    const vers = after.cardInstances.find((c) => c.instanceId === "opp-vers")!;
    expect(vers.zone !== "field" || vers.pendingLeaveKind === "destroy").toBe(
      true
    );
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.deckCount).toBe(before - 3);
  });

  it("破壊した中に「ヴァース」を含まないときはドローしない", () => {
    const src = srcR02();
    // BSTH02-X01「西行妖」= grandwalkerData を持つ実在ネクサスで、名前に「ヴァース」を
    // 含まない対照フィクスチャ (BSAZ02-X04/X05 はいずれも名前に「ヴァース」を含むため不適)。
    const oppGrandwalker = createCardInstance(card("BSTH02-X01"), {
      instanceId: "opp-gw",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), oppGrandwalker],
    });
    const before = state.players.find((p) => p.id === ALICE)!.deckCount;
    const after = runEffect(state, 0, { rangeAutoResolveStrategy: "max" });

    // 破壊自体は成立していることを確認する（そうでなければ ref_has_match 不一致ではなく
    // 単に destroy が0件選択の no-op だっただけ、という偽陽性になる）。
    const gw = after.cardInstances.find((c) => c.instanceId === "opp-gw")!;
    expect(gw.zone !== "field" || gw.pendingLeaveKind === "destroy").toBe(true);

    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.deckCount).toBe(before);
  });

  it("同名の別個体でも2回目は破壊するが、「ヴァース」破壊時のドローはゲーム中で共有する", () => {
    const first = srcR02();
    const firstVers = createCardInstance(card("BSAZ02-X04"), {
      instanceId: "first-vers",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const initial = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [first, underFiller(), firstVers],
    });
    const before = initial.players.find((p) => p.id === ALICE)!.deckCount;
    const afterFirst = runEffect(initial, 0, {
      rangeAutoResolveStrategy: "max",
    });
    expect(afterFirst.players.find((p) => p.id === ALICE)!.deckCount).toBe(
      before - 3
    );

    // 1体目が離れた後なら、同名の別個体は再びこのアルティメットを場に出せる。
    // 親の「ターンに1回」は個体ごとなので2体目の破壊は通る。一方、後段の
    // ［ゲームに1回同名］は1体目の使用を共有し、ドローだけを止める。
    const second = srcR02("src-r02-second");
    const secondVers = createCardInstance(card("BSAZ02-X05"), {
      instanceId: "second-vers",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    });
    const beforeSecond: GameState = {
      ...afterFirst,
      cardInstances: [
        ...afterFirst.cardInstances.map((instance) =>
          instance.instanceId === "src-r02"
            ? {
                ...instance,
                zone: "trash" as const,
                attachedToInstanceId: null,
              }
            : instance
        ),
        second,
        underFiller("src-r02-second", "under-drive-second"),
        secondVers,
      ],
    };
    const afterSecond = runEffect(beforeSecond, 0, {
      sourceInstanceId: "src-r02-second",
      rangeAutoResolveStrategy: "max",
    });
    const destroyedSecondVers = afterSecond.cardInstances.find(
      (instance) => instance.instanceId === "second-vers"
    )!;
    expect(
      destroyedSecondVers.zone !== "field" ||
        destroyedSecondVers.pendingLeaveKind === "destroy"
    ).toBe(true);
    expect(afterSecond.players.find((p) => p.id === ALICE)!.deckCount).toBe(
      before - 3
    );
  });
});

describe("BSAZ02-R02 effects[1]（Lv3継続: カウント5以下は相手の効果を受けない）", () => {
  it("カウント5以下なら effect_immunity が成立する（相手カードの効果を受けない）", () => {
    const src = srcR02();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
      playerOverrides: [{ countValue: 5 }, {}],
    });
    const after = runEffect(state, 1);
    const target = after.cardInstances.find((c) => c.instanceId === "src-r02")!;
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: card("BSDB01-C05"),
      })
    ).toBe(true);
  });

  it("カウント6以上なら effect_immunity が成立しない（条件不成立でCE未登録）", () => {
    const src = srcR02();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
      playerOverrides: [{ countValue: 6 }, {}],
    });
    const after = runEffect(state, 1);
    const target = after.cardInstances.find((c) => c.instanceId === "src-r02")!;
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: card("BSDB01-C05"),
      })
    ).toBe(false);
  });
});

describe("BSAZ02-R02 effects[2]（相手のカード使用完了で自分のカウント+1）", () => {
  it("召喚/配置/マジック使用を単一の card_used イベントで観測する", () => {
    expect(R02.effects[2]!.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "card_used",
    });
    const src = srcR02();
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = runEffect(state, 2);
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(1);
  });
});

describe("BSAZ02-R02 effects[3]（このアルティメットとバトルした相手はただちに除外・防げない）", () => {
  it("queueBattleEndTriggers が battle_end イベントの relatedInstanceIds に対戦相手側参加体を積む", () => {
    const src = srcR02();
    const oppParticipant = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-participant",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, underFiller(), oppParticipant],
      }),
      step: "attack",
      activePlayerId: ALICE,
    };
    const lookup = buildTriggeredEffectLookup([R02, card("BSDB01-C05")]);

    const after = queueBattleEndTriggers({
      state,
      participantInstanceIds: ["src-r02", "opp-participant"],
      attackId: "attack:r02-battle-partner:1",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
      blockSideInstanceIds: ["opp-participant"],
    });

    const r02Pending = after.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === "src-r02"
    );
    expect(r02Pending).toBeDefined();
    expect(r02Pending!.relatedInstanceIds).toEqual(["opp-participant"]);
  });

  it("trigger_related_instances 経由の remove_from_game が対戦相手のみを除外する（自分自身は対象外）", () => {
    const src = srcR02();
    const oppParticipant = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-participant",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const bystander = createCardInstance(card("BSDB01-C05"), {
      instanceId: "bystander",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller(), oppParticipant, bystander],
    });

    const after = runEffect(state, 3, {
      triggerRelatedInstanceIds: ["opp-participant"],
    });

    const opp = after.cardInstances.find(
      (c) => c.instanceId === "opp-participant"
    )!;
    const other = after.cardInstances.find(
      (c) => c.instanceId === "bystander"
    )!;
    const selfCard = after.cardInstances.find(
      (c) => c.instanceId === "src-r02"
    )!;
    expect(
      opp.zone !== "field" || opp.pendingLeaveKind === "remove_from_game"
    ).toBe(true);
    expect(other.zone).toBe("field");
    expect(other.pendingLeaveKind).toBeNull();
    expect(selfCard.zone).toBe("field");
    expect(selfCard.pendingLeaveKind).toBeNull();
  });

  it("end-to-end: queueBattleEndTriggers が積んだ relatedInstanceIds をそのまま executeEffect に渡すと対戦相手のみ除外される（verifier round2 指摘: 生成と消費の配線を実データで結線）", () => {
    const src = srcR02();
    const oppParticipant = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-participant",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const bystander = createCardInstance(card("BSDB01-C05"), {
      instanceId: "bystander",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, underFiller(), oppParticipant, bystander],
      }),
      step: "attack",
      activePlayerId: ALICE,
    };
    const lookup = buildTriggeredEffectLookup([R02, card("BSDB01-C05")]);

    const queued = queueBattleEndTriggers({
      state,
      participantInstanceIds: ["src-r02", "opp-participant"],
      attackId: "attack:r02-e2e:1",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
      blockSideInstanceIds: ["opp-participant"],
    });
    const r02Pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === "src-r02"
    )!;
    expect(r02Pending.relatedInstanceIds).toBeDefined();
    // bystander (別バトルの第三者) が queueBattleEndTriggers の出力に紛れ込んでいないことも
    // 同時に確認する (この時点で bystander は participantInstanceIds に含めていない)。
    expect(r02Pending.relatedInstanceIds).not.toContain("bystander");

    // 生成側 (queueBattleEndTriggers) が実際に積んだ relatedInstanceIds を、加工せずそのまま
    // 消費側 (executeEffect) へ渡す。手打ちの id ではなく実データで生成→消費を結線する。
    const after = runEffect(state, 3, {
      triggerRelatedInstanceIds: r02Pending.relatedInstanceIds,
    });

    const opp = after.cardInstances.find(
      (c) => c.instanceId === "opp-participant"
    )!;
    const other = after.cardInstances.find(
      (c) => c.instanceId === "bystander"
    )!;
    expect(
      opp.zone !== "field" || opp.pendingLeaveKind === "remove_from_game"
    ).toBe(true);
    expect(other.zone).toBe("field");
    expect(other.pendingLeaveKind).toBeNull();
  });
});

describe("BSAZ02-R02 summonCondition（自分の系統：「ＣＦ」のアルティメット0体、exact-zero）", () => {
  it("自分の場に「ＣＦ」アルティメットが0体なら召喚可", () => {
    const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
    expect(
      canSummonUltimate(state, ALICE, R02, getDef, {
        sourceInstanceId: "ult-hand",
        evaluateCondition,
      })
    ).toBe(true);
  });

  it("自分の場に「ＣＦ」アルティメットが1体でもいれば召喚不可", () => {
    const otherCf = createCardInstance(card("BSAZ02-C02"), {
      instanceId: "field-cf",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [otherCf],
    });
    expect(
      canSummonUltimate(state, ALICE, R02, getDef, {
        sourceInstanceId: "ult-hand",
        evaluateCondition,
      })
    ).toBe(false);
  });
});
