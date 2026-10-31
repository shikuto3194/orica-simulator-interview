/**
 * BSAZ03-C01「また来る」effects[0]:
 * 〔ターンに1回:同名〕トラッシュにあるこのカードは、相手のエンドステップに自分の手札1枚を
 * 破棄することで手札に戻す。
 *
 * 2026-07-10 初回試行は adversarial verifier round1 で refute された (needs-dsl.w1.jsonl 参照)。
 * 当時の診断は「phase timing の PendingTriggeredEffect.actingPlayerId がターンプレイヤー
 * (=相手) に固定され、候補カード (このカード自身) の持ち主 ALICE と乖離するため resolve
 * chooser 既定値が相手側に倒れる」というものだったが、engine-triggered-effect-chooser-default-
 * default cluster での再調査の結果、この乖離は 2026-06-25 の
 * ENGINE-phase-whose-either-source-controller-actingplayerid 修正で既に解消済みと判明した
 * (queueReactionsInternal / private declaration 双方が PendingTriggeredEffect.actingPlayerId を
 * event.actingPlayerId ではなく sourceCard.controllerPlayerId で構築時に上書き済み)。
 * つまり legal-actions-availability.ts の chooser 既定値は最初から正しい基準
 * (pending.actingPlayerId = 実効的に sourceCard の持ち主) を見ていた。当時 refute された真因は
 * chooser:"opponent" を discard step に明示追加したこと自体 — 既に ALICE に補正済みの
 * actingPlayerId に対して「opponent」を適用すると BOB 側へ反転してしまう desync だった。
 * 本カードは chooser を一切指定しない (既定 "self" のまま) ことで正しく解決する。
 * 本テストは、BOB のエンドステップ中に ALICE (トラッシュのこのカードの持ち主) にだけ
 * resolve_pending_triggered_effect が提示され、BOB には提示されないことを実証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { advanceStep } from "../src/turn-system";
import {
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
const getRegisteredFieldCardEffectActions =
  buildFieldCardEffectLookup(ALL_CARDS);

const ALICE = "alice";
const BOB = "bob";

describe("BSAZ03-C01 effects[0]: トラッシュのこのカードは相手のエンドステップに手札1枚破棄で手札へ戻す", () => {
  it("effect 定義: applicability.zone:trash + phase(step:end, whose:opponent) + optional + usageLimit per_card_name + discard→conditional_cost move_card", () => {
    const def = card("BSAZ03-C01");
    const effect = def.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 0
    )!;
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: ["trash"] });
    expect(effect.timing).toEqual({
      kind: "phase",
      step: "end",
      whose: "opponent",
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.steps[0]!.action).toEqual({
      kind: "discard",
      count: 1,
      player: "self",
    });
    expect(effect.steps[1]!.connector).toBe("conditional_cost");
    expect(effect.steps[1]!.action).toEqual({
      kind: "move_card",
      target: { kind: "self" },
      from: { zone: "trash", player: "self" },
      to: { zone: "hand" },
      count: 1,
      requireFullCount: true,
    });
  });

  it("BOBのエンドステップ中、ALICEだけがトラッシュのこのカードを resolve_pending_triggered_effect で解決できる (BOBには提示されない)", () => {
    const c01 = card("BSAZ03-C01");
    const filler = card("BSAZ03-M01");

    const trashCard = createCardInstance(c01, {
      instanceId: "c01-trash-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const aliceHandCard = createCardInstance(filler, {
      instanceId: "alice-hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });

    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [trashCard, aliceHandCard],
    });

    const before: GameState = {
      ...base,
      activePlayerId: BOB,
      turnNumber: 2,
      step: "attack",
      window: "none",
    };

    const queued = advanceStep(
      before,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(queued.step).toBe("end");
    expect(queued.window).toBe("end_step_effects");

    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.eventKind === "end_step"
    );
    expect(pending).toBeDefined();
    // ENGINE-phase-whose-either-source-controller-actingplayerid (2026-06-25) により、
    // event 発生時のターンプレイヤー (BOB) ではなく候補カードの持ち主 (ALICE) に
    // 構築時点で既に補正されている。
    expect(pending!.actingPlayerId).toBe(ALICE);

    const aliceResolve = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === trashCard.instanceId
    );
    expect(aliceResolve).toBeDefined();

    const bobResolve = getLegalActions({
      state: queued,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === trashCard.instanceId
    );
    expect(bobResolve).toBeUndefined();

    const declared = applyLegalAction({
      state: queued,
      action: aliceResolve!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    // 全効果発揮はスタック窓を開く (project_stack_timing_all_steps)。
    // responder (BOB) が pass するまで実行は保留される。
    const passAction = getLegalActions({
      state: declared,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((a) => a.kind === "pass_stack");
    expect(passAction).toBeDefined();

    const applied = applyLegalAction({
      state: declared,
      action: passAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    expect(
      applied.cardInstances.find((c) => c.instanceId === trashCard.instanceId)
        ?.zone
    ).toBe("hand");
    expect(
      applied.cardInstances.find(
        (c) => c.instanceId === aliceHandCard.instanceId
      )?.zone
    ).toBe("trash");
  });
});
