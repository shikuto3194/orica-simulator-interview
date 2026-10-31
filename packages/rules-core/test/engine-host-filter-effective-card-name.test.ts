/**
 * engine-x03-cross-zone-aldnoah-drive-transfer Step1: move_card の
 * `from.hostFilter.cardNameEffective` primitive の単体機能テスト。
 *
 * `hostFilter.cardName` は `def.name`（印字/raw 名）で host を絞るため、
 * act_as_spirit/override_properties でカード名を上書きされたトークン
 * (BSAZ02-X03「オルテュギア」分身アルティメット等) を host 側フィルタとして
 * 見つけられない。`cardNameEffective` (`getEffectiveCardName` 経由) は
 * raw def.name が異なる token host も実効名で一致させる。
 */
import { describe, expect, it } from "vitest";
import { executeMoveCard } from "../src/effect/native-move-core-handlers";
import { flushPendingLeaves } from "../src/state-based-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { createStepExecutionContext } from "../src/step-execution-context";
import type { CardDefinition, ContinuousEffect, GameState } from "../src/model";
import type { DSL } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

// トークン生成元の deck カード定義 (raw name はトークン化後も変わらない)
const deckFillerDef: CardDefinition = {
  cardNo: "FILLER-DECK-CARD",
  name: "無名のフィラー",
  printedCategory: "spirit",
  colors: ["white"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "",
  sourceUrls: [],
  sourceConfidence: "C",
  underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
};

const underCardFiller: CardDefinition = {
  cardNo: "FILLER-UNDER",
  name: "アルドノアドライブ",
  printedCategory: "brave",
  colors: ["white"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "アルドノア",
  sourceUrls: [],
  sourceConfidence: "C",
};

const defRegistry = new Map<string, CardDefinition>([
  [deckFillerDef.cardNo, deckFillerDef],
  [underCardFiller.cardNo, underCardFiller],
]);
const getCardDefinitionById = (id: string) => defRegistry.get(id);

function actAsSpiritCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `ce-act-as-spirit-${targetInstanceId}`,
    sourceInstanceId: "source-1",
    sourceDefinitionId: "SRC-001",
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "act_as_spirit",
    targetInstanceId,
    metadata: {
      statBlueprint: {
        kind: "static_copy",
        snapshot: {
          cost: 7,
          reductionSymbols: [],
          symbolColors: ["ultimate_symbol"],
          tribes: [],
          levelDefs: [{ level: 3, requiredCores: 1, bp: 3000 }],
          colors: ["white"],
        },
      },
      overrides: { cardName: "オルテュギア" },
    } as unknown as Record<string, unknown>,
  } as ContinuousEffect;
}

function buildState() {
  const token = createCardInstance(deckFillerDef, {
    instanceId: "token-1",
    ownerPlayerId: ALICE,
    zone: "field",
    faceDown: true,
    cores: 1,
  });
  const under = createCardInstance(underCardFiller, {
    instanceId: "under-1",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: token.instanceId,
  });
  const tokenAttached = {
    ...token,
    underCards: [
      {
        cardInstanceId: under.instanceId,
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [tokenAttached, under],
  });
  const withCe: GameState = {
    ...state,
    activeContinuousEffects: [actAsSpiritCE(token.instanceId)],
  };
  return { state: withCe, token: token.instanceId, under: under.instanceId };
}

describe("engine-host-filter-effective-card-name: move_card from.hostFilter.cardNameEffective", () => {
  it("raw def.name が異なる act_as_spirit token host も実効名で一致する", () => {
    const { state, under } = buildState();
    const stepCtx = createStepExecutionContext();
    const action: DSL.MoveCardAction = {
      kind: "move_card",
      from: {
        zone: "field",
        player: "self",
        hostFilter: { cardNameEffective: { contains: "オルテュギア" } },
        hostUnderCardRoleTag: "アルドノアドライブ",
      },
      to: { zone: "trash" },
      count: -1,
    };
    const next = flushPendingLeaves(
      executeMoveCard(
        action,
        state,
        ALICE,
        "dsl-unused",
        getCardDefinitionById,
        stepCtx
      ),
      getCardDefinitionById
    );
    const moved = next.cardInstances.find((c) => c.instanceId === under)!;
    expect(moved.zone).toBe("trash");
    expect(moved.attachedToInstanceId).toBeNull();
  });

  it("raw def.name のみの hostFilter.cardName では token host に一致しない (対照)", () => {
    const { state } = buildState();
    const stepCtx = createStepExecutionContext();
    const action: DSL.MoveCardAction = {
      kind: "move_card",
      from: {
        zone: "field",
        player: "self",
        hostFilter: { cardName: { contains: "オルテュギア" } },
        hostUnderCardRoleTag: "アルドノアドライブ",
      },
      to: { zone: "trash" },
      count: -1,
    };
    const next = executeMoveCard(
      action,
      state,
      ALICE,
      "dsl-unused",
      getCardDefinitionById,
      stepCtx
    );
    expect(next).toBe(state);
  });
});
