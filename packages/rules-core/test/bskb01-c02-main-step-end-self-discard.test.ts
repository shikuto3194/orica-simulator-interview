/**
 * BSKB01-C02 水兵ワドルディ effects[0]:
 * 「手札にあるこのカードは、自分のメインステップ終了時に魂状態を含む自分の「メタナイト」が
 * いれば、破棄できる。そうしたとき、お互い、デッキの上から1枚破棄できる。」
 *
 * engine-hand-self-card-main-end-activation-timing cluster の副次カード。手札ゾーンの
 * `timing:{kind:"phase", step:"main", whose:"self", subPhase:"end"}` 誘発が
 * `getTriggeredEffectSourceUseBlockReason` の汎用 sourceZone 検査 (field 以外も許可) に
 * 元々乗ることを確認しつつ、自己手札破棄 (move_card target:self) → 成功時のお互い任意
 * デッキ破棄 (chooser:"opponent" で各プレイヤーが自分の分を選ぶ) を検証する。
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

const ALICE = "player-1";
const BOB = "player-2";

function player(state: GameState, id: string) {
  const p = state.players.find((candidate) => candidate.id === id);
  if (!p) throw new Error(`player not found: ${id}`);
  return p;
}

describe("BSKB01-C02 水兵ワドルディ effects[0]: 手札のこのカードはメインステップ終了時に破棄できる", () => {
  it("メタナイトが場にいるとき main step end で declare→resolve→stack 解決すると、自己破棄+お互い任意デッキ破棄が発動する", () => {
    const wobbuffet = card("BSKB01-C02");
    // BSKB01-C01 の name には「メタナイト」を含む (field_has cardNames contains 判定用)。
    const metaknight = card("BSKB01-C01");

    const handSource = createCardInstance(wobbuffet, {
      instanceId: "wobbuffet-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const fieldMetaknight = createCardInstance(metaknight, {
      instanceId: "metaknight-field",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // discard(fromZone:"deck") は state.cardInstances の zone:"deck" 実体を候補にするため、
    // deckCount カウンタだけでなく実カードを両陣営分用意する。
    const aliceDeck = [0, 1].map((i) =>
      createCardInstance(metaknight, {
        instanceId: `alice-deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const bobDeck = [0, 1].map((i) =>
      createCardInstance(metaknight, {
        instanceId: `bob-deck-${i}`,
        ownerPlayerId: BOB,
        zone: "deck",
      })
    );

    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      activePlayerId: ALICE,
      cardInstances: [handSource, fieldMetaknight, ...aliceDeck, ...bobDeck],
    });

    const before: GameState = {
      ...base,
      turnNumber: 2,
      step: "main",
      window: "none",
      players: base.players.map((p) =>
        p.id === ALICE
          ? { ...p, deckCount: aliceDeck.length }
          : { ...p, deckCount: bobDeck.length }
      ),
    };

    const queued = advanceStep(
      before,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(queued.step).toBe("main");
    expect(queued.window).toBe("step_end");
    expect(
      queued.pendingPrivateDeclarations.some(
        (d) => d.sourceInstanceId === handSource.instanceId
      )
    ).toBe(true);

    const declareAction = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (a) =>
        a.kind === "declare_private_triggered_effect" &&
        a.sourceInstanceId === handSource.instanceId
    );
    expect(declareAction).toBeDefined();

    const declared = applyLegalAction({
      state: queued,
      action: declareAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    const resolveAction = getLegalActions({
      state: declared,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === handSource.instanceId
    );
    expect(resolveAction).toBeDefined();

    const stacked = applyLegalAction({
      state: declared,
      action: resolveAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    const passAction = getLegalActions({
      state: stacked,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find((a) => a.kind === "pass_stack");
    expect(passAction).toBeDefined();

    let state = applyLegalAction({
      state: stacked,
      action: passAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;

    // 自己破棄 (手札 → トラッシュ) は mandatory な最初のステップとして即実行される。
    expect(
      state.cardInstances.find((c) => c.instanceId === handSource.instanceId)
        ?.zone
    ).toBe("trash");

    // 続く「お互い、デッキの上から1枚破棄できる」は各プレイヤー独立の任意選択。
    // まず自分 (ALICE) の分を execute する。
    const aliceChoice = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(aliceChoice).toBeDefined();
    state = applyLegalAction({
      state,
      action: aliceChoice!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
    expect(player(state, ALICE).deckCount).toBe(aliceDeck.length - 1);

    // 次は相手 (BOB) 自身が自分の破棄を選ぶ (chooser:"opponent")。
    expect(state.pendingStepOptionalChoice?.prompt).toMatchObject({
      label: "自分のデッキから1枚を自分のトラッシュに置く",
      question: "自分のデッキから1枚を自分のトラッシュに置きますか？",
    });
    const bobChoice = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "decline"
    );
    expect(bobChoice).toBeDefined();
    state = applyLegalAction({
      state,
      action: bobChoice!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).state;
    // decline したので BOB のデッキは減らない。
    expect(player(state, BOB).deckCount).toBe(bobDeck.length);

    expect(state.step).toBe("main");
    expect(state.window).toBe("step_end");

    const advanced = advanceStep(
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(advanced.step).not.toBe("main");
  });
});
