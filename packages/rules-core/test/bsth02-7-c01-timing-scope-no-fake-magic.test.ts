/**
 * BSTH02.7-C01 effects[0] (engine-hand-self-card-main-end-activation-timing /
 * claude-explore 2026-07-07 実装完了):
 *
 * effects[0] は「手札にあるこのカードは、自分のメインステップ終了時に使用できる」の
 * 使用タイミング宣言を timingScope (subPhase:"end") として持つ main-mode 効果。
 * 条件「自分のネクサスが黄1色のみで2つ以上」を満たすときのみ use_magic として現れる
 * (evaluateCondition 経由の effect.condition ガード、legal-actions-availability.ts:4578-4590)。
 *
 * かつて effects[0] は steps:[] の stub だったため、`effect.steps.length === 0 && effect.stub`
 * ガードで一切登録されなかった (verifier round 1 refute: フェイクアクション化を防ぐガード)。
 * 本体実装後は steps が非空・stub 無しになったため、このガードには掛からず正常に登録される。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getLegalActions } from "../src/legal/legal-actions";
import { buildMagicLookup } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredMagicActions = buildMagicLookup(ALL_CARDS);

const ALICE = "player-1";
const BOB = "player-2";
const card = cardNoMap.get("BSTH02.7-C01")!;

function buildState(args: { nexusCount: number }): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const nexusCard = cardNoMap.get("BSTH02.7-CX01")!; // 黄1色ネクサス
  const nexuses = Array.from({ length: args.nexusCount }, (_, i) =>
    createCardInstance(nexusCard, {
      instanceId: `alice-nexus-${i}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    })
  );
  return {
    ...base,
    step: "main",
    window: "step_end",
    activePlayerId: ALICE,
    cardInstances: [
      createCardInstance(card, {
        instanceId: "dollswar-hand",
        ownerPlayerId: ALICE,
        zone: "hand",
      }),
      ...nexuses,
    ],
  };
}

describe("BSTH02.7-C01 effects[0]: main-step-end 使用タイミング + 黄1色ネクサス2つ以上条件", () => {
  it("effects[0] (effectIndex:0) の main registration が存在する (stub 解消済み)", () => {
    const registrations = getRegisteredMagicActions("BSTH02.7-C01");
    expect(registrations?.some((r) => r.effectIndex === 0)).toBe(true);
    // effects[1] (フラッシュ) も引き続き登録される。
    expect(registrations?.some((r) => r.effectIndex === 1)).toBe(true);
  });

  it("window:step_end かつ黄1色ネクサス2つ以上: effects[0] の use_magic が main timing で出る", () => {
    const state = buildState({ nexusCount: 2 });
    const useMagicActions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredMagicActions,
    }).filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "dollswar-hand"
    );

    expect(
      useMagicActions.some((a) => a.kind === "use_magic" && a.timing === "main")
    ).toBe(true);
  });

  it("黄1色ネクサスが1つしかない: 条件未達で effects[0] の use_magic は main timing で出ない", () => {
    const state = buildState({ nexusCount: 1 });
    const useMagicActions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredMagicActions,
    }).filter(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "dollswar-hand"
    );

    expect(
      useMagicActions.some((a) => a.kind === "use_magic" && a.timing === "main")
    ).toBe(false);
  });
});
