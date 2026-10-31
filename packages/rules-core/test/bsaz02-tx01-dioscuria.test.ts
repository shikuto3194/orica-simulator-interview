/**
 * BSAZ02-TX01(A)「ディオスクリア-コアロボット-」/ TX01(B)「ディオスクリア」effects[] 検証。
 *
 * 原文 (前面 textLines[0,2,3,5,7,8,10,11] / 裏面 textLines[0]):
 *   《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》
 *   フラッシュ『お互いのアタックステップ』手札にあるこのカードは、召喚できる。
 *   【アルドノアドライブ：1】（このアルティメットの下にアルドノアドライブを1枚まで
 *   置ける。あるとき、以下の効果を得る）
 *   Lv3-Lv4『このアルティメットの召喚時』自分は、デッキの上から5枚オープンでき、
 *   その中のマジックカード以外の系統：「アルドノア」を持つカードすべてを手札に加える。
 *   残ったカードは破棄する。
 *   Lv4【転醒：自分のライフ1以上（転醒は同時に使えない）】このアルティメットは、
 *   自分のメインステップとお互いのアタックステップのフラッシュ/スタックタイミングに
 *   裏返せる。
 *   （裏面）この面に裏返ったとき、フィールドに残り、カウントを0にする。
 *
 * 検証点:
 *  - summonCondition: 自分のＣＦアルティメット0体 exact-zero。
 *  - effects[0]: フラッシュ『お互いのアタックステップ』の無条件 summon（ヴァース分岐無し）。
 *  - effects[1]: Lv3-4 召喚時 deck_reveal(picks:[{count:-1,filter:アルドノア&非マジック}],
 *    remainder:"trash")。オープン5枚中の該当カードすべてを手札へ、残りはトラッシュ。
 *  - effects[2]/[3]: Lv4 転醒（自分のメインステップ／お互いのアタックステップの2窓）。
 *    ライフ1以上で rebirth 許可窓が開き、裏面 BSAZ02-TX01(B) へ裏返る。
 *  - backFace textLines[0]: A面 rebirth action の countBonusMode:"reset_to_zero" で処理し、
 *    効果化しない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";
import type { Effect } from "../src/dsl-types";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { resolveAmount } from "../src/effect/target-resolution";
import { createStepExecutionContext } from "../src/step-execution-context";
import {
  applyLegalAction,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { getAvailableHandCardLegalActions } from "../src/legal/legal-actions-availability";
import { getEffectiveSymbols } from "../src/battle/battle-shared";
import { getEffectiveUnderCardSlotCap } from "../src/mechanics/star-garment-utils";
import { canActivateGrantedEffect } from "../src/mechanics/grant-effect-system";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const TX01A = card("BSAZ02-TX01(A)");

function underFiller(hostId: string) {
  return createCardInstance(card("BSAZ02-M01"), {
    instanceId: `under-drive-${hostId}`,
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: hostId,
  });
}

function srcTX01A(hostId: string, cores: number) {
  const src = createCardInstance(TX01A, {
    instanceId: hostId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
  return {
    ...src,
    underCards: [
      {
        cardInstanceId: `under-drive-${hostId}`,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

describe("BSAZ02-TX01(A) summonCondition（自分のＣＦアルティメット0体）", () => {
  it("既存のＣＦアルティメットがあると通常召喚できない", () => {
    const otherCf = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "field-cf",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const hand = createCardInstance(TX01A, {
      instanceId: "tx01-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
        activePlayerId: ALICE,
        step: "main",
        cardInstances: [otherCf, hand],
      },
      getDef
    );
    const actions = getAvailableHandCardLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      actions.find(
        (a) => a.kind === "summon" && a.sourceInstanceId === "tx01-hand"
      )
    ).toBeUndefined();
  });
});

describe("BSAZ02-TX01(A) effects[0]（フラッシュ『お互いのアタックステップ』手札にあるこのカードは、召喚できる）", () => {
  it("お互いのアタックステップに無条件の flash summon action が定義されている", () => {
    const effect = TX01A.effects[0]!;
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.timingScope).toEqual({ player: "both", period: "attack" });
    expect(effect.steps).toEqual([
      { action: { kind: "summon", target: { kind: "self" } } },
    ]);
  });
});

describe("BSAZ02-TX01(A) effects[1]（Lv3-4『召喚時』デッキ5枚オープン→非マジックのアルドノアすべて手札、残り破棄）", () => {
  it("オープンした5枚のうち該当カードすべてを手札へ加え、残りはトラッシュへ送る", () => {
    const src = srcTX01A("src-tx01a", 1); // Lv3
    const aldnoahMatch = createCardInstance(card("BSAZ02-M01"), {
      instanceId: "deck-match",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const nonMatch = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(card("BSAZ01-C03"), {
        instanceId: `deck-nomatch-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller("src-tx01a"), aldnoahMatch, ...nonMatch],
      playerOverrides: [{ deckCount: 5 }, {}],
    });
    const effect = TX01A.effects[1]!;
    expect(effect.timing).toEqual({ kind: "card_event", event: "summon" });
    const after = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:158",
      state,
      effect,
      effectIndex: 1,
      sourceInstanceId: "src-tx01a",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const pending = after.pendingDeckReveal;
    expect(pending).not.toBeNull();
    expect(pending!.revealedCardInstanceIds).toHaveLength(5);

    const pickAction = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();

    const resolved = applyLegalAction({
      state: after,
      action: pickAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      selectedDeckRevealCardIds: ["deck-match"],
    }).state;
    expect(resolved.pendingDeckReveal).toBeNull();

    const matchCard = resolved.cardInstances.find(
      (c) => c.instanceId === "deck-match"
    )!;
    expect(matchCard.zone).toBe("hand");
    for (const nm of nonMatch) {
      const c = resolved.cardInstances.find(
        (x) => x.instanceId === nm.instanceId
      )!;
      expect(c.zone).toBe("trash");
    }
  });
});

describe("BSAZ02-TX01(A) effects[2,3]（Lv4【転醒：自分のライフ1以上】自分のメインステップ/お互いのアタックステップで裏返せる）", () => {
  it("自分のメインステップ: ライフ1以上で rebirth 許可窓が開き、実行すると裏面へ裏返る", () => {
    const src = srcTX01A("src-tx01a", 3); // Lv4
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, underFiller("src-tx01a")],
        playerOverrides: [
          {
            lifeNormalCoreCount: 1,
            countValue: 5,
            voidNormalCoreCount: 10,
            protectedCounts: { 火星: 2 },
          },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
    };
    const effect = TX01A.effects[2]!;
    expect(effect.timingScope).toEqual({ player: "self", period: "main" });

    const afterBody = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:223",
      state,
      effect,
      effectIndex: 2,
      sourceInstanceId: "src-tx01a",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(afterBody.pendingStepOptionalChoice).toBeNull();
    const afterExecute = afterBody;

    const flipped = afterExecute.cardInstances.find(
      (c) => c.instanceId === "src-tx01a"
    )!;
    expect(flipped.definitionId).toBe("BSAZ02-TX01(B)");
    expect(flipped.zone).toBe("field");
    const alice = afterExecute.players.find((p) => p.id === ALICE)!;
    expect(alice.countValue).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(15);
    expect(alice.protectedCounts).toBeUndefined();
  });

  it("ライフ0のときは転醒条件を満たさず、rebirth 許可窓が開かない（メイン/アタック両窓とも）", () => {
    const src = srcTX01A("src-tx01a", 3); // Lv4
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, underFiller("src-tx01a")],
        playerOverrides: [{ lifeNormalCoreCount: 0 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
    };
    const afterMain = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:257",
      state,
      effect: TX01A.effects[2]!,
      effectIndex: 2,
      sourceInstanceId: "src-tx01a",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(afterMain.pendingStepOptionalChoice).toBeNull();

    const attackState = { ...state, step: "attack" as const };
    const afterAttack = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:269",
      state: attackState,
      effect: TX01A.effects[4]!,
      effectIndex: 4,
      sourceInstanceId: "src-tx01a",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(afterAttack.pendingStepOptionalChoice).toBeNull();
  });

  it("原文『フラッシュ/スタックタイミングに裏返せる』どおり、メイン/アタック各窓に mode:flash と mode:stack の両方が宣言されている", () => {
    const rebirthEffects = TX01A.effects.filter((e) =>
      e.steps.some((s) => s.action.kind === "rebirth")
    );
    expect(rebirthEffects).toHaveLength(4);
    const byScope = (period: "main" | "attack", player: "self" | "both") =>
      rebirthEffects.filter(
        (e) =>
          e.timingScope?.period === period && e.timingScope?.player === player
      );
    for (const [period, player] of [
      ["main", "self"],
      ["attack", "both"],
    ] as const) {
      const scoped = byScope(period, player);
      expect(scoped.map((e) => e.timing.mode).sort()).toEqual([
        "flash",
        "stack",
      ]);
      for (const effect of scoped) {
        const rebirth = effect.steps.find(
          (s) => s.action.kind === "rebirth"
        )!.action;
        expect(rebirth.kind).toBe("rebirth");
        if (rebirth.kind === "rebirth") {
          expect(rebirth.countBonusMode).toBe("reset_to_zero");
        }
      }
    }
  });
});

describe("BSAZ02-TX01(B) underCardSlots（【アルドノアドライブ：3】枠拡張、backFace→合成定義伝播）", () => {
  it("synthesizeBackFaceDefinition が backFace.underCardSlots を合成定義へ伝播する（前面 maxCount:1 から転醒後は3）", () => {
    const TX01B = card("BSAZ02-TX01(B)");
    expect(TX01B.underCardSlots).toEqual([
      { roleTag: "アルドノアドライブ", maxCount: 3 },
    ]);
    expect(TX01A.underCardSlots).toEqual([
      { roleTag: "アルドノアドライブ", maxCount: 1 },
    ]);
  });
});

describe("BSAZ02-TX01(B) textLines[0]（この面に裏返ったとき、カウントを0にする）", () => {
  const TX01B = card("BSAZ02-TX01(B)");

  it("カウント0化は効果化せず、純正『転醒時』効果が effects[0] になる", () => {
    expect(
      TX01B.effects!.some((effect) =>
        effect.steps.some((step) => step.action.kind === "count_set")
      )
    ).toBe(false);
    expect(TX01B.effects![0]!.timing).toEqual({
      kind: "card_event",
      event: "rebirth",
    });
    expect(TX01B.effects![0]!.textRef).toEqual([4, 5]);
  });
});

// ════════════════════════════════════════════════════════════════
// BSAZ02-TX01(B) effects[0]（Lv3-5『転醒時』アンダーカード数を動的上限として
// 手札/トラッシュのCFコスト6以下アルティメットを複数選択で下に加える）
// engine-tx01b-under-card-multi-select (2026-07-17):
//   DynamicCountSource.self_under_card_count + move_card.from.zone 配列化 +
//   move_card.to.textRoleTag/枠クランプ、を新設。
//
// adversarial verifier round1 refute (2026-07-17) 対応: 原文の「アルドノアドライブ」
// (=underCardSlots roleTag、実カード BSAZ02-C10「アルドノアドライブ」名義。category:"brave"、
// symbolColors:["ultimate_symbol"]。C10 自身の place_text_role_under_card で host非依存に
// 自己付着する別機構) と、effects[0] が追加する「アルティメットカード」を別 roleTag
// ("ＣＦアルティメット") に分離した。underDriveFillers は実 C10 相当 (roleTag:アルドノアドライブ、
// self_under_card_count の母数) を表す。
// ════════════════════════════════════════════════════════════════

function underDriveFillers(hostId: string, n: number) {
  return Array.from({ length: n }, (_, i) =>
    createCardInstance(card("BSAZ02-M01"), {
      instanceId: `under-drive-${hostId}-${i}`,
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: hostId,
    })
  );
}

function srcTX01B(hostId: string, cores: number, underCount: number) {
  const src = createCardInstance(card("BSAZ02-TX01(B)"), {
    instanceId: hostId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
  return {
    ...src,
    underCards: Array.from({ length: underCount }, (_, i) => ({
      cardInstanceId: `under-drive-${hostId}-${i}`,
      role: "text_role" as const,
      roleTag: "アルドノアドライブ",
    })),
  };
}

describe("BSAZ02-TX01(B) effects[0] DSL構造（move_card target:filter zone=[hand,trash] count.max=self_under_card_count）", () => {
  const TX01B = card("BSAZ02-TX01(B)");
  const effect = TX01B.effects![0]!;

  it("card_event:rebirth トリガー、min_level:3 条件、move_card 1step が宣言されている", () => {
    expect(effect.timing).toEqual({ kind: "card_event", event: "rebirth" });
    expect(effect.condition).toEqual([
      { kind: "min_level", value: 3 },
      {
        kind: "self_under_card_count",
        roleTag: "アルドノアドライブ",
        minCount: 1,
      },
    ]);
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("move_card");
    if (action.kind !== "move_card") throw new Error("unreachable");
    expect(action.target).toEqual({
      kind: "filter",
      player: "self",
      zone: ["hand", "trash"],
      filter: { category: ["ultimate"], tribes: ["ＣＦ"], maxCost: 6 },
      count: {
        min: 0,
        max: {
          source: {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
          },
        },
      },
    });
    expect(action.from).toEqual({ zone: ["hand", "trash"], player: "self" });
    expect(action.to).toEqual({
      zone: "field",
      sourceUnderCardRole: "text_role",
      textRoleTag: "ＣＦアルティメット",
    });
    expect(action.count).toBe("all");
  });
});

describe("DynamicCountSource.self_under_card_count（新設プリミティブ単体）", () => {
  it("発動元カード自身の text_role アンダーカード枚数 (roleTag一致) を返す", () => {
    const host = srcTX01B("host-count", 3, 2);
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, ...underDriveFillers("host-count", 2)],
    });
    const ctx = {
      ...createStepExecutionContext(state),
      sourceInstanceId: "host-count",
    };
    const resolved = resolveAmount(
      {
        source: {
          kind: "self_under_card_count",
          roleTag: "アルドノアドライブ",
        },
      },
      state,
      ALICE,
      ctx,
      getDef
    );
    expect(resolved).toBe(2);
  });

  it("roleTag 不一致のアンダーカードは数えない", () => {
    const host = {
      ...srcTX01B("host-count-mismatch", 3, 0),
      underCards: [
        { cardInstanceId: "other-role", role: "advent_source" as const },
      ],
    };
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host],
    });
    const ctx = {
      ...createStepExecutionContext(state),
      sourceInstanceId: "host-count-mismatch",
    };
    const resolved = resolveAmount(
      {
        source: {
          kind: "self_under_card_count",
          roleTag: "アルドノアドライブ",
        },
      },
      state,
      ALICE,
      ctx,
      getDef
    );
    expect(resolved).toBe(0);
  });
});

describe("BSAZ02-TX01(B) effects[0] 盤面実行", () => {
  const TX01B = card("BSAZ02-TX01(B)");
  const effect = TX01B.effects![0]!;

  it("実アルドノアドライブ(BSAZ02-C10相当)2枚のとき、手札/トラッシュのCFコスト6以下アルティメット2枚を選択し、text_role/ＣＦアルティメットとして下に加える（実アルドノアドライブ枚数は変わらない）", () => {
    const hostId = "host-move";
    // Lv4、実アルドノアドライブ2枚 → self_under_card_count(アルドノアドライブ)=2 が動的上限。
    const src = srcTX01B(hostId, 3, 2);
    const handCandidate = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "hand-cand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const trashCandidate = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "trash-cand",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        src,
        ...underDriveFillers(hostId, 2),
        handCandidate,
        trashCandidate,
      ],
      playerOverrides: [{ handCount: 1 }, {}],
    });
    const after = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:514",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["hand-cand", "trash-cand"],
      targetSelectionResolved: true,
    });

    const hostAfter = after.cardInstances.find((c) => c.instanceId === hostId)!;
    // 実アルドノアドライブ (roleTag:アルドノアドライブ) の枚数は不変。
    expect(
      hostAfter.underCards.filter(
        (u) => u.role === "text_role" && u.roleTag === "アルドノアドライブ"
      )
    ).toHaveLength(2);
    // 追加されたCFアルティメットは別roleTagで2枚。
    expect(
      hostAfter.underCards.filter(
        (u) => u.role === "text_role" && u.roleTag === "ＣＦアルティメット"
      )
    ).toHaveLength(2);

    const handAfter = after.cardInstances.find(
      (c) => c.instanceId === "hand-cand"
    )!;
    expect(handAfter.zone).toBe("field");
    expect(handAfter.attachedToInstanceId).toBe(hostId);

    const trashAfter = after.cardInstances.find(
      (c) => c.instanceId === "trash-cand"
    )!;
    expect(trashAfter.zone).toBe("field");
    expect(trashAfter.attachedToInstanceId).toBe(hostId);

    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.handCount).toBe(0);
  });
});

describe("move_card textRoleTag 枠クランプ（汎用primitive、underCardSlots宣言のあるroleTag向け）", () => {
  it("host定義のunderCardSlots(該当roleTagのmaxCount)を超える分は空き枠数までクランプされる（roleTag:アルドノアドライブ、maxCount:3充足済み→0枠）", () => {
    const hostId = "host-clamp";
    const src = srcTX01B(hostId, 5, 3); // Lv5、実アルドノアドライブ3枚で underCardSlots maxCount:3 を既に充足
    const handCandidate = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "hand-cand-clamp",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, ...underDriveFillers(hostId, 3), handCandidate],
      playerOverrides: [{ handCount: 1 }, {}],
    });
    // 汎用clampの単体検証: textRoleTag:アルドノアドライブ (underCardSlots宣言あり) へ直接
    // move_card する合成 effect (このカード固有の効果ではなく native-move-core-handlers.ts の
    // 枠クランプ分岐そのものを検証する)。
    const syntheticEffect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "move_card",
            target: {
              kind: "filter",
              player: "self",
              zone: ["hand"],
              filter: { category: ["ultimate"] },
              count: { min: 0, max: 5 },
            },
            from: { zone: ["hand"], player: "self" },
            to: {
              zone: "field",
              sourceUnderCardRole: "text_role",
              textRoleTag: "アルドノアドライブ",
            },
            count: "all",
          },
        },
      ],
      textRef: [],
    };
    const after = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:599",
      state,
      effect: syntheticEffect,
      effectIndex: 0,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["hand-cand-clamp"],
      targetSelectionResolved: true,
    });

    const handAfter = after.cardInstances.find(
      (c) => c.instanceId === "hand-cand-clamp"
    )!;
    expect(handAfter.zone).toBe("hand");

    const hostAfter = after.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(
      hostAfter.underCards.filter(
        (u) => u.role === "text_role" && u.roleTag === "アルドノアドライブ"
      )
    ).toHaveLength(3);
  });
});

// ════════════════════════════════════════════════════════════════
// BSAZ02-TX01(B) effects[1]（Lv4-5『このアルティメットの下のアルティメットカード
// すべてのシンボルをLvを無視で得る』）
// ENGINE-tx01b-under-card-symbol-inherit (2026-07-17):
//   SymbolDynamicSource.under_card_symbols(roleTag) を新設し、host の roleTag一致
//   アンダーカードすべての base symbolColors を getSymbolAdditions 経由で個別加算する。
//
// adversarial verifier round1 refute (2026-07-17) 対応: シンボル源は roleTag:"ＣＦアルティメット"
// (effects[0] が追加した「アルティメットカード」) のみを対象とし、roleTag:"アルドノアドライブ"
// (実カード BSAZ02-C10、category:"brave") は対象外。BSAZ02-C01 (symbolColors:["ultimate_symbol"])
// を CFアルティメット役、BSAZ02-M01 (symbolColors:["white"]) を実アルドノアドライブ役に使い分けて
// 混在シナリオで区別を検証する。
// ════════════════════════════════════════════════════════════════

function cfUltimateFillers(hostId: string, n: number) {
  return Array.from({ length: n }, (_, i) =>
    createCardInstance(card("BSAZ02-C01"), {
      instanceId: `cf-ultimate-${hostId}-${i}`,
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: hostId,
    })
  );
}

function srcTX01BWithMixedUnderCards(
  hostId: string,
  cores: number,
  driveCount: number,
  cfCount: number
) {
  const src = createCardInstance(card("BSAZ02-TX01(B)"), {
    instanceId: hostId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
  return {
    ...src,
    underCards: [
      ...Array.from({ length: driveCount }, (_, i) => ({
        cardInstanceId: `under-drive-${hostId}-${i}`,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      })),
      ...Array.from({ length: cfCount }, (_, i) => ({
        cardInstanceId: `cf-ultimate-${hostId}-${i}`,
        role: "text_role" as const,
        roleTag: "ＣＦアルティメット",
      })),
    ],
  };
}

describe("BSAZ02-TX01(B) effects[1] DSL構造（symbol_add symbolSource:under_card_symbols）", () => {
  const TX01B = card("BSAZ02-TX01(B)");
  const effect = TX01B.effects![1]!;

  it("timing:continuous、applicability Lv4-5、symbol_add symbolSource:under_card_symbols(roleTag:ＣＦアルティメット) が宣言されている", () => {
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.applicability).toEqual({ level: { min: 4, max: 5 } });
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("symbol_add");
    if (action.kind !== "symbol_add") throw new Error("unreachable");
    expect(action.target).toEqual({ kind: "self" });
    expect(action.symbolSource).toMatchObject({
      kind: "under_card_symbols",
      roleTag: "ＣＦアルティメット",
    });
  });
});

describe("BSAZ02-TX01(B) effects[1] 盤面実行（アンダーカードのシンボルを継承）", () => {
  it("Lv4: 下のCFアルティメット2枚(各シンボル:ultimate_symbol)のシンボルを個別に得るが、実アルドノアドライブ(白)は対象外", () => {
    const hostId = "host-symbol-lv4";
    // Lv4、実アルドノアドライブ1枚(BSAZ02-M01: symbolColors:["white"]) + CFアルティメット2枚
    // (BSAZ02-C01: symbolColors:["ultimate_symbol"])。
    const src = srcTX01BWithMixedUnderCards(hostId, 3, 1, 2);
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          src,
          ...underDriveFillers(hostId, 1),
          ...cfUltimateFillers(hostId, 2),
        ],
      }),
      getDef
    );
    const hostAfter = state.cardInstances.find((c) => c.instanceId === hostId)!;
    const symbols = getEffectiveSymbols(
      state,
      hostAfter,
      card("BSAZ02-TX01(B)"),
      getDef
    );
    const whiteCount = symbols.filter((s) => s === "white").length;
    const ultimateSymbolCount = symbols.filter(
      (s) => s === "ultimate_symbol"
    ).length;
    // 実アルドノアドライブ (M01, white) は継承対象外。
    expect(whiteCount).toBe(0);
    // base symbolColors(印字2つ) + CFアルティメット2枚分。
    expect(ultimateSymbolCount).toBe(4);
  });

  it("Lv3: applicability外のため、CFアルティメットのシンボルは加算されない", () => {
    const hostId = "host-symbol-lv3";
    const src = srcTX01BWithMixedUnderCards(hostId, 1, 0, 2); // Lv3、CFアルティメット2枚
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, ...cfUltimateFillers(hostId, 2)],
      }),
      getDef
    );
    const hostAfter = state.cardInstances.find((c) => c.instanceId === hostId)!;
    const symbols = getEffectiveSymbols(
      state,
      hostAfter,
      card("BSAZ02-TX01(B)"),
      getDef
    );
    expect(symbols.filter((s) => s === "ultimate_symbol")).toHaveLength(2); // base のみ
  });

  it("アンダーカードが0枚のときは加算するシンボルが無い（base symbolColors のみ）", () => {
    const hostId = "host-symbol-empty";
    const src = srcTX01B(hostId, 3, 0); // Lv4、アンダーカード0枚
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src],
      }),
      getDef
    );
    const hostAfter = state.cardInstances.find((c) => c.instanceId === hostId)!;
    const symbols = getEffectiveSymbols(
      state,
      hostAfter,
      card("BSAZ02-TX01(B)"),
      getDef
    );
    expect(symbols).toEqual(["ultimate_symbol", "ultimate_symbol"]);
  });
});

// ════════════════════════════════════════════════════════════════
// BSAZ02-TX01(B) effects[2]（Lv4-5『このアルティメットの下のアルティメットカード
// すべての【アルドノアドライブ】をLvを無視で得る』前半）
// engine-tx01b-under-card-slot-capacity-inherit (2026-07-17):
//   under_card_slot_capacity_grant (dsl-types.ts Action新設) + modifierTag
//   "under_card_slot_capacity" CE + getEffectiveUnderCardSlotCap
//   (star-garment-utils.ts、native-move-core-handlers.ts / native-under-card-placement-handlers.ts
//   両call siteのSSOT)。host自身のunderCardSlots該当roleTag(アルドノアドライブ)枠上限へ、
//   roleTag:"ＣＦアルティメット"一致text_roleアンダーカードそれぞれが自身のunderCardSlots
//   (同一roleTag)に持つmaxCountを合算加算する。BSAZ02-C01は自身もunderCardSlots:
//   [{roleTag:"アルドノアドライブ",maxCount:1}]を宣言しているため、cfUltimateFillers
//   (BSAZ02-C01) を使うと1枚につき+1される。
// ════════════════════════════════════════════════════════════════

describe("BSAZ02-TX01(B) effects[2] DSL構造（under_card_slot_capacity_grant）", () => {
  const TX01B = card("BSAZ02-TX01(B)");
  const effect = TX01B.effects![2]!;

  it("timing:continuous、applicability Lv4-5、under_card_slot_capacity_grant(hostRoleTag:アルドノアドライブ, childRoleTag:ＣＦアルティメット) が宣言されている", () => {
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.applicability).toEqual({ level: { min: 4, max: 5 } });
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("under_card_slot_capacity_grant");
    if (action.kind !== "under_card_slot_capacity_grant")
      throw new Error("unreachable");
    expect(action.target).toEqual({ kind: "self" });
    expect(action.hostRoleTag).toBe("アルドノアドライブ");
    expect(action.childRoleTag).toBe("ＣＦアルティメット");
    expect(action.duration).toEqual({ scope: "permanent" });
  });
});

describe("BSAZ02-TX01(B) effects[2] 盤面実行（アンダーカード由来のunderCardSlots枠上限を継承）", () => {
  it("Lv4-5: 実アルドノアドライブ3枚(base上限充足済み)+CFアルティメット2枚(各自身underCardSlots maxCount:1)のとき、実効枠上限が3+2=5になる", () => {
    const hostId = "host-slot-cap";
    const src = srcTX01BWithMixedUnderCards(hostId, 3, 3, 2); // Lv4、実アルドノアドライブ3枚+CFアルティメット2枚
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          src,
          ...underDriveFillers(hostId, 3),
          ...cfUltimateFillers(hostId, 2),
        ],
      }),
      getDef
    );
    const hostAfter = state.cardInstances.find((c) => c.instanceId === hostId)!;
    const hostDef = card("BSAZ02-TX01(B)");
    expect(
      getEffectiveUnderCardSlotCap(
        state,
        hostAfter,
        hostDef,
        "アルドノアドライブ",
        getDef
      )
    ).toBe(5);
  });

  it("Lv3: applicability外のため、CFアルティメット由来の枠上限加算は適用されず base の3のまま", () => {
    const hostId = "host-slot-cap-lv3";
    const src = srcTX01BWithMixedUnderCards(hostId, 1, 0, 2); // Lv3、CFアルティメット2枚
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, ...cfUltimateFillers(hostId, 2)],
      }),
      getDef
    );
    const hostAfter = state.cardInstances.find((c) => c.instanceId === hostId)!;
    const hostDef = card("BSAZ02-TX01(B)");
    expect(
      getEffectiveUnderCardSlotCap(
        state,
        hostAfter,
        hostDef,
        "アルドノアドライブ",
        getDef
      )
    ).toBe(3);
  });

  it("拡張された枠上限は move_card の text_role クランプにも反映され、base(3枚)を超えて4枚目の実アルドノアドライブを配置できる", () => {
    const hostId = "host-slot-cap-move";
    // Lv4、実アルドノアドライブ3枚(base上限充足済み)+CFアルティメット1枚(+1) → 実効上限4。
    const src = srcTX01BWithMixedUnderCards(hostId, 3, 3, 1);
    const handCandidate = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "hand-cand-cap",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          src,
          ...underDriveFillers(hostId, 3),
          ...cfUltimateFillers(hostId, 1),
          handCandidate,
        ],
        playerOverrides: [{ handCount: 1 }, {}],
      }),
      getDef
    );
    const syntheticEffect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "move_card",
            target: {
              kind: "filter",
              player: "self",
              zone: ["hand"],
              filter: { category: ["ultimate"] },
              count: { min: 0, max: 5 },
            },
            from: { zone: ["hand"], player: "self" },
            to: {
              zone: "field",
              sourceUnderCardRole: "text_role",
              textRoleTag: "アルドノアドライブ",
            },
            count: "all",
          },
        },
      ],
      textRef: [],
    };
    const after = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:905",
      state,
      effect: syntheticEffect,
      effectIndex: 0,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["hand-cand-cap"],
      targetSelectionResolved: true,
    });
    const handAfter = after.cardInstances.find(
      (c) => c.instanceId === "hand-cand-cap"
    )!;
    expect(handAfter.zone).toBe("field");
    const hostAfter = after.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(
      hostAfter.underCards.filter(
        (u) => u.role === "text_role" && u.roleTag === "アルドノアドライブ"
      )
    ).toHaveLength(4);
  });
});

// ════════════════════════════════════════════════════════════════
// BSAZ02-TX01(B) effects[3]（Lv5のとき、このアルティメットの下のアルティメットカードが持つ
// 『このアルティメットのアタック時』効果を『このアルティメットのアタック/ブロック時』に変更する）
// ENGINE-tx01b-attack-trigger-inherit (2026-07-17, needs-ruling.jsonl:BSAZ02-TX01(B) 案B裁定):
//   under_card_trigger_inherit (dsl-types.ts Action新設) を新設。実在するＣＦアルティメット
//   BSAZ02-R01「エレクトリス」effects[2] (Lv3-4『このアルティメットのアタック時』
//   restrict_use、条件:自身のアルドノアドライブ数>=1) を借用元 precedent に使う。
// ════════════════════════════════════════════════════════════════

// R01自身の『このアルティメットのアタック時』効果は R01自身に
// applicability:{level:{min:3,max:4}} + condition:[self_under_card_count(アルドノアドライブ,1)]
// を持つ (BSAZ02.ts:3128-3149)。under_card_trigger_inherit は condition を host 基準ではなく
// R01自身のインスタンス基準で評価する (adversarial verifier round3 refute対応)。
// applicability.level は評価対象外 (adversarial verifier 2026-07-18 round1 refute対応:
// text_role アンダーカードは attach 時に normalCoreCount が強制的に0になる
// (native-move-core-handlers.ts) ため、R01自身のレベルは常に levelDefs 最低値(Lv3)未満に
// 固定され、level ゲートは実運用経路 (TX01(B) effects[0] move_card) を通した場合に
// 永久に不成立になる。r01UnderFillerGateSatisfied は実運用時と同じ normalCoreCount:0 の
// まま、自身の下に「アルドノアドライブ」役の入れ子アンダーカードを1枚付けて condition
// のみを満たす (= r01NestedDriveFiller、host under-card 自体がさらに under-card を
// 持てる汎用データ形状であることを利用。ただし move_card は attach 時に underCards も
// 空にリセットするため、この入れ子構成自体は現行カードプールの実運用経路では再現不能。
// condition 側の実運用到達性は別途調査要、本テストは level バイパスの正しさのみを検証する)。
function r01UnderFiller(hostId: string) {
  return createCardInstance(card("BSAZ02-R01"), {
    instanceId: `cf-r01-${hostId}`,
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: hostId,
  });
}

function r01UnderFillerGateSatisfied(hostId: string) {
  const r01 = createCardInstance(card("BSAZ02-R01"), {
    instanceId: `cf-r01-${hostId}`,
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: hostId,
  });
  return {
    ...r01,
    underCards: [
      {
        cardInstanceId: `cf-r01-drive-${hostId}`,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

function r01NestedDriveFiller(hostId: string) {
  return createCardInstance(card("BSAZ02-M01"), {
    instanceId: `cf-r01-drive-${hostId}`,
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: `cf-r01-${hostId}`,
  });
}

function srcTX01BWithR01Under(hostId: string, cores: number) {
  const src = createCardInstance(card("BSAZ02-TX01(B)"), {
    instanceId: hostId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
  return {
    ...src,
    underCards: [
      {
        cardInstanceId: `cf-r01-${hostId}`,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

describe("BSAZ02-TX01(B) effects[3] DSL構造（全ドライブ能力を取得）", () => {
  const TX01B = card("BSAZ02-TX01(B)");
  const effect = TX01B.effects![3]!;

  it("Lv4から全能力を取得し、Lv5でアタック時をブロック時にも変更する", () => {
    expect(effect.timing).toEqual({
      kind: "continuous",
    });
    expect(effect.applicability).toEqual({ level: { min: 4, max: 5 } });
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("grant_effect");
    if (action.kind !== "grant_effect") throw new Error("unreachable");
    expect(action.target).toEqual({ kind: "self" });
    expect(action.grantedEffectSource).toMatchObject({
      kind: "card_effects",
      from: { kind: "under_cards", filter: { category: ["ultimate"] } },
      ignoreLevel: true,
      additionalEvents: { source: "attack", events: ["block"] },
    });
  });
});

function inheritedEffects(
  state: Parameters<typeof executeEffect>[0]["state"],
  hostId: string
): Effect[] {
  return state.activeContinuousEffects
    .filter(
      (ce) =>
        ce.modifierTag === "granted_effect" &&
        ce.targetInstanceId === hostId &&
        ce.metadata?.grantedEffect
    )
    .map((ce) => ce.metadata!.grantedEffect as Effect);
}

describe("BSAZ02-TX01(B) effects[3] 盤面実行（能力の取得後、本文をhost基準で発揮）", () => {
  it("B面がヘラスから取得した転醒は発揮不可だが、回復効果は取得する", () => {
    const hostId = "dioscuria-with-hellas";
    const host = {
      ...srcTX01A(hostId, 5),
      definitionId: "BSAZ02-TX01(B)",
      originalDefinitionId: TX01A.cardNo,
      underCards: [
        ...srcTX01A(hostId, 5).underCards,
        {
          cardInstanceId: "hellas-under",
          role: "text_role" as const,
          roleTag: "ＣＦアルティメット",
        },
      ],
    };
    const state = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [
            host,
            underFiller(hostId),
            createCardInstance(card("BSAZ02-TR01(A)"), {
              instanceId: "hellas-under",
              ownerPlayerId: ALICE,
              zone: "field",
              attachedToInstanceId: hostId,
            }),
          ],
        }),
        step: "attack",
      },
      getDef
    );
    const granted = state.activeContinuousEffects.filter(
      (ce) => ce.targetInstanceId === hostId && ce.metadata?.grantedEffect
    );
    const rebirth = granted.find((ce) =>
      (ce.metadata!.grantedEffect as Effect).steps.some(
        (step) => step.action.kind === "rebirth"
      )
    )!;
    expect(rebirth).toBeDefined();
    expect(canActivateGrantedEffect(state, rebirth, host, getDef)).toBe(false);
    expect(
      granted.some((ce) =>
        (ce.metadata!.grantedEffect as Effect).steps.some(
          (step) => step.action.kind === "recover"
        )
      )
    ).toBe(true);
  });

  it("Lv5: 下のＣＦアルティメット(BSAZ02-R01)が実運用と同じnormalCoreCount:0(Lv3-4のapplicability自体は不成立)でも、condition(自身のアルドノアドライブ数>=1)さえ満たせば『このアルティメットのアタック時』効果(restrict_use)をhost(TX01B)自身をsourceとして発揮する", () => {
    const hostId = "host-trigger-inherit-lv5";
    const src = srcTX01BWithR01Under(hostId, 5); // Lv5 (requiredCores:5)
    const r01Under = r01UnderFillerGateSatisfied(hostId);
    expect(r01Under.normalCoreCount).toBe(0);
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, r01Under, r01NestedDriveFiller(hostId)],
      }),
      getDef
    );
    const effect = card("BSAZ02-TX01(B)").effects![3]!;
    const after = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:1060",
      state,
      effect,
      effectIndex: 3,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const inherited = inheritedEffects(after, hostId).find((e) =>
      e.steps.some((s) => s.action.kind === "restrict_use")
    )!;
    expect(inherited).toBeDefined();
    const resolved = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:1073",
      state: {
        ...after,
        battleEntities: [
          {
            entityId: "attacking-host",
            memberInstanceIds: [hostId],
            attackState: "attacking",
            resolvedBp: 25000,
            resolvedSymbols: ["ultimate_symbol"],
          },
        ],
      },
      effect: inherited,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const restrictCe = resolved.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_use"
    );
    expect(restrictCe).toBeDefined();
    expect(restrictCe!.sourceInstanceId).toBe(hostId);
    expect(restrictCe!.metadata?.targetScope).toBe("card");
    expect(
      inheritedEffects(after, hostId).some(
        (e) => e.executionMode === "optional" && e.usageLimit
      )
    ).toBe(true);
  });

  it("多イベントと回数制限を持つR02の効果も制限を保持して取得する", () => {
    const hostId = "host-trigger-inherit-r02";
    const src = createCardInstance(card("BSAZ02-TX01(B)"), {
      instanceId: hostId,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 5, // Lv5
    });
    const r02Under = createCardInstance(card("BSAZ02-R02"), {
      instanceId: `cf-r02-${hostId}`,
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: hostId,
    });
    const srcWithR02 = {
      ...src,
      underCards: [
        {
          cardInstanceId: `cf-r02-${hostId}`,
          role: "text_role" as const,
          roleTag: "アルドノアドライブ",
        },
      ],
    };
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [srcWithR02, r02Under],
      }),
      getDef
    );
    const effect = card("BSAZ02-TX01(B)").effects![3]!;
    const after = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:1127",
      state,
      effect,
      effectIndex: 3,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      inheritedEffects(after, hostId).some(
        (e) =>
          e.usageLimit &&
          e.timing.kind === "card_event" &&
          Array.isArray(e.timing.event)
      )
    ).toBe(true);
  });

  it("X02のステップ内任意効果も選択構造を保ったまま取得する", () => {
    const hostId = "host-trigger-inherit-x02";
    const src = createCardInstance(card("BSAZ02-TX01(B)"), {
      instanceId: hostId,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 5, // Lv5
    });
    const x02Under = createCardInstance(card("BSAZ02-X02"), {
      instanceId: `cf-x02-${hostId}`,
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: hostId,
    });
    const srcWithX02 = {
      ...src,
      underCards: [
        {
          cardInstanceId: `cf-x02-${hostId}`,
          role: "text_role" as const,
          roleTag: "アルドノアドライブ",
        },
      ],
    };
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [srcWithX02, x02Under],
      }),
      getDef
    );
    const effect = card("BSAZ02-TX01(B)").effects![3]!;
    const after = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:1179",
      state,
      effect,
      effectIndex: 3,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      inheritedEffects(after, hostId).some((e) =>
        e.steps.some((s) => s.executionMode === "optional")
      )
    ).toBe(true);
    expect(after.log.some((l) => l.startsWith("effect:discard_hand:"))).toBe(
      false
    );
  });

  it("Lv4でアタック時能力を取得するが、ブロック時には変更しない", () => {
    const hostId = "host-trigger-inherit-lv4";
    const src = srcTX01BWithR01Under(hostId, 3); // Lv4 (requiredCores:3)
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, r01UnderFiller(hostId)],
      }),
      getDef
    );
    const effect = card("BSAZ02-TX01(B)").effects![3]!;
    const after = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:1209",
      state,
      effect,
      effectIndex: 3,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const restrictCe = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_use"
    );
    expect(restrictCe).toBeUndefined();
    const inherited = inheritedEffects(after, hostId).find((e) =>
      e.steps.some((s) => s.action.kind === "restrict_use")
    )!;
    expect(inherited.timing).toEqual({ kind: "continuous" });
    expect(inherited.condition).toContainEqual({
      kind: "self_state",
      reference: "self",
      state: "on_field",
      battleState: "attacking",
    });
  });

  it("R01自身の下にドライブが無くても、取得した条件はhost自身で評価する", () => {
    const hostId = "host-trigger-inherit-r01-gate-unmet";
    const src = srcTX01BWithR01Under(hostId, 5); // host Lv5
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, r01UnderFiller(hostId)],
      }),
      getDef
    );
    const effect = card("BSAZ02-TX01(B)").effects![3]!;
    const after = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:1239",
      state,
      effect,
      effectIndex: 3,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const restrictCe = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_use"
    );
    expect(restrictCe).toBeUndefined();
    expect(
      inheritedEffects(after, hostId).some((e) =>
        e.steps.some((s) => s.action.kind === "restrict_use")
      )
    ).toBe(true);
    expect(
      after.log.filter((l) =>
        l.startsWith("under_card_trigger_inherit:executed:")
      )
    ).toHaveLength(0);
  });

  it("下にＣＦアルティメットが無いとき: 継承元が無いためrestrict_useは登録されない", () => {
    const hostId = "host-trigger-inherit-empty";
    const src = srcTX01BWithR01Under(hostId, 5);
    const emptySrc = { ...src, underCards: [] };
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [emptySrc],
      }),
      getDef
    );
    const effect = card("BSAZ02-TX01(B)").effects![3]!;
    const after = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:1276",
      state,
      effect,
      effectIndex: 3,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const restrictCe = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_use"
    );
    expect(restrictCe).toBeUndefined();
  });
});

describe("BSAZ02-TX01(B) effects[0]→effects[3] 実アタッチ経路", () => {
  it("実際にR01を下に加えた後、hostのドライブ条件で取得した攻撃効果を発揮する", () => {
    const hostId = "host-real-attach-r01-noop";
    const src = srcTX01B(hostId, 5, 1); // Lv5、実アルドノアドライブ1枚
    const handR01 = createCardInstance(card("BSAZ02-R01"), {
      instanceId: "hand-r01",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, ...underDriveFillers(hostId, 1), handR01],
      playerOverrides: [{ handCount: 1 }, {}],
    });
    const attachEffect = card("BSAZ02-TX01(B)").effects![0]!;
    const afterAttach = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:1307",
      state,
      effect: attachEffect,
      effectIndex: 0,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["hand-r01"],
      targetSelectionResolved: true,
    });
    const r01After = afterAttach.cardInstances.find(
      (c) => c.instanceId === "hand-r01"
    )!;
    expect(r01After.zone).toBe("field");
    expect(r01After.attachedToInstanceId).toBe(hostId);
    expect(r01After.underCards).toEqual([]);

    const rebuilt = rebuildContinuousEffectsFromField(afterAttach, getDef);
    const inheritEffect = card("BSAZ02-TX01(B)").effects![3]!;
    const afterInherit = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:1327",
      state: rebuilt,
      effect: inheritEffect,
      effectIndex: 3,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const inherited = inheritedEffects(afterInherit, hostId).find((e) =>
      e.steps.some((s) => s.action.kind === "restrict_use")
    )!;
    expect(inherited).toBeDefined();
    const resolved = executeEffect({
      chainId: "test:bsaz02-tx01-dioscuria:1340",
      state: {
        ...afterInherit,
        battleEntities: [
          {
            entityId: "attacking-host",
            memberInstanceIds: [hostId],
            attackState: "attacking",
            resolvedBp: 25000,
            resolvedSymbols: ["ultimate_symbol"],
          },
        ],
      },
      effect: inherited,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const restrictCe = resolved.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "restrict_use"
    );
    expect(restrictCe).toBeDefined();
    expect(
      afterInherit.log.filter((l) =>
        l.startsWith("under_card_trigger_inherit:executed:")
      )
    ).toHaveLength(0);
  });
});
