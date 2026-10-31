/**
 * P3-37 教訓 2 の保険テスト:
 *
 * 混在オーナー pending 局面では、rules-core が出した全ての
 * `select_pending_to_resolve` legal action が、前面化したカードに対応する ActionBar
 * から確定操作として到達可能でなければならない。
 *
 * カードタップ自体は前面化だけであり、確定 action を送ってはならない。
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardDefinition, GameState } from "@orica/rules-core";
import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getAvailablePendingTriggeredEffectLegalActions,
} from "@orica/rules-core";
import { buildEffectQueue } from "../src/components/EffectQueueOverlay";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EFFECT_QUEUE_OVERLAY = readFileSync(
  resolve(__dirname, "../src/components/EffectQueueOverlay.tsx"),
  "utf8"
);
const BATTLE_SCREEN = readFileSync(
  resolve(__dirname, "../src/components/BattleScreen.tsx"),
  "utf8"
);

function makeSourceDef(): CardDefinition {
  return {
    cardNo: "P3-37-MIX",
    name: "P3-37 mixed-owner source",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: ["『このスピリットの召喚時』自分はデッキから1枚ドローする。"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
        textRef: [0],
      },
    ],
  };
}

function buildMixedOwnerState(definition: CardDefinition): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(definition, {
        instanceId: "alice-source",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(definition, {
        instanceId: "bob-source",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
  });
  return {
    ...base,
    activePlayerId: "alice",
    pendingTriggeredEffects: [
      {
        pendingId: "pending-alice",
        eventKind: "summon",
        actingPlayerId: "alice",
        source: "action_resolution",
        chainId: "test:select-pending-accessibility:73",
        attackId: null,
        relatedPlayerId: null,
        relatedInstanceId: "alice-source",
        amount: null,
        step: "main",
        window: "none",
        resolvedSourceInstanceIds: [],
      },
      {
        pendingId: "pending-bob",
        eventKind: "summon",
        actingPlayerId: "bob",
        source: "action_resolution",
        chainId: "test:select-pending-accessibility:87",
        attackId: null,
        relatedPlayerId: null,
        relatedInstanceId: "bob-source",
        amount: null,
        step: "main",
        window: "none",
        resolvedSourceInstanceIds: [],
      },
    ],
  };
}

describe("混在オーナー pending での select アクセス可能性", () => {
  it("カードタップは前面化だけで、select 確定はActionBarが担当する", () => {
    expect(EFFECT_QUEUE_OVERLAY).not.toContain("dispatchSelectPending");
    expect(EFFECT_QUEUE_OVERLAY).not.toContain("onActionClick");
    expect(EFFECT_QUEUE_OVERLAY).toContain(
      "ActionBar の操作（「解決」または任意効果の「発揮する」）からのみ"
    );
    expect(BATTLE_SCREEN).toContain(
      "return isActionForEffectQueueFront(a, frontItem);"
    );
  });

  it("全 select_pending_to_resolve が前面化後のActionBar経路に紐付く", () => {
    const definition = makeSourceDef();
    const state = buildMixedOwnerState(definition);
    const getDefinition = (id: string) =>
      id === definition.cardNo ? definition : undefined;
    const getRegisteredTriggeredEffectActions = buildTriggeredEffectLookup([
      definition,
    ]);

    // rules-core が出した全 select_pending_to_resolve
    const legal = getAvailablePendingTriggeredEffectLegalActions({
      state,
      actingPlayerId: state.activePlayerId,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
    });
    const selectActions = legal.filter(
      (a) => a.kind === "select_pending_to_resolve"
    );
    expect(selectActions.length).toBeGreaterThanOrEqual(2); // mixed-owner シナリオの前提

    const allPendingIds = new Set(
      selectActions.map((a) =>
        "pendingId" in a ? (a as { pendingId: string }).pendingId : ""
      )
    );

    const queueItems = buildEffectQueue(
      state,
      getDefinition,
      getRegisteredTriggeredEffectActions,
      state.activePlayerId,
      legal
    );

    const reachableViaOverlayTap = new Set<string>();
    for (const item of queueItems) {
      if (
        item.sourceRef.type === "triggered" &&
        (item.actions ?? []).some((a) => a.kind === "select_pending_to_resolve")
      ) {
        reachableViaOverlayTap.add(item.sourceRef.data.pendingId);
      }
    }

    expect(reachableViaOverlayTap).toEqual(allPendingIds);
  });

  it("前面カードにも select_pending_to_resolve action を保持する", () => {
    const definition = makeSourceDef();
    const state = buildMixedOwnerState(definition);
    const getDefinition = (id: string) =>
      id === definition.cardNo ? definition : undefined;
    const getRegisteredTriggeredEffectActions = buildTriggeredEffectLookup([
      definition,
    ]);

    const legal = getAvailablePendingTriggeredEffectLegalActions({
      state,
      actingPlayerId: state.activePlayerId,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
    });
    const queueItems = buildEffectQueue(
      state,
      getDefinition,
      getRegisteredTriggeredEffectActions,
      state.activePlayerId,
      legal
    );
    const frontItem = queueItems[queueItems.length - 1];
    expect(
      (frontItem?.actions ?? []).filter(
        (a) => a.kind === "select_pending_to_resolve"
      )
    ).toHaveLength(1);
  });
});
