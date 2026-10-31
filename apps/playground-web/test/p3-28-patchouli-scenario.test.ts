import { describe, expect, it } from "vitest";
import {
  advanceStep,
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
  getLegalActions,
} from "@orica/rules-core";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import { sanitizeStateForViewer } from "../server/game-api";
import { SCENARIOS } from "../src/scenarios";

const getDefinition = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const getRegisteredHandActivatedEffectActions =
  buildHandActivatedEffectLookup(ALL_CARDS);

describe("P3-28 patchouli-start-summon scenario", () => {
  // B 型「常時効果が通常召喚を許可」= プレイヤー能動の召喚 action として再モデル化。
  // 旧実装の「スタートステップ誘発 → private declaration」は撤廃。
  // プライバシー（相手に手の内を悟らせない）は per-player の legal action で担保する:
  // alice だけが summon action を見え、bob には見えない。
  it("召喚許可は auto-pend せず、召喚 action は alice のみに見え bob には見えない", () => {
    const initial = SCENARIOS["patchouli-start-summon"].build(ALL_CARDS);
    const queued = advanceStep(
      initial,
      getDefinition,
      getRegisteredTriggeredEffectActions
    );

    expect(queued.activePlayerId).toBe("alice");
    expect(queued.step).toBe("start");
    // 誘発ではないので pending は積まれない。
    expect(queued.pendingTriggeredEffects).toHaveLength(0);
    expect(queued.pendingPrivateDeclarations).toHaveLength(0);

    // alice の legal actions には summon action が現れる。
    const aliceActions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
      getRegisteredHandActivatedEffectActions,
    });
    const aliceSummon = aliceActions.find(
      (a) => a.kind === "summon" && a.sourceCardNo === "BSTH01-M01"
    );
    expect(aliceSummon).toMatchObject({
      sourceCardNo: "BSTH01-M01",
      finalCost: 1,
    });
    expect(
      aliceActions.some(
        (a) =>
          a.kind === "use_hand_card_effect" && a.sourceCardNo === "BSTH01-M01"
      )
    ).toBe(false);

    // bob には alice の手札 summon action は見えない（手の内秘匿）。
    const bobActions = getLegalActions({
      state: queued,
      actingPlayerId: "bob",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
      getRegisteredHandActivatedEffectActions,
    });
    expect(
      bobActions.some(
        (a) => a.kind === "summon" && a.sourceCardNo === "BSTH01-M01"
      )
    ).toBe(false);

    // 盤面の可視性: alice は手札の Patchouli を見え、bob には隠蔽される。
    const patchouli = queued.cardInstances.find(
      (c) => c.definitionId === "BSTH01-M01" && c.ownerPlayerId === "alice"
    )!;
    const aliceState = sanitizeStateForViewer(queued, "alice");
    const bobState = sanitizeStateForViewer(queued, "bob");
    const alicePatchouli = aliceState.cardInstances.find(
      (c) => c.instanceId === patchouli.instanceId
    );
    const bobPatchouli = bobState.cardInstances.find(
      (c) => c.instanceId === patchouli.instanceId
    );
    expect(alicePatchouli?.zone).toBe("hand");
    expect(alicePatchouli?.definitionId).toBe("BSTH01-M01");
    expect(bobPatchouli?.definitionId).toBe("_hidden_card_");
  });
});
