/**
 * BSFT01 TR カード（鍵ブレイヴ / 転醒後スピリット）の B 面『転醒時』(card_event:"rebirth")
 * 効果が **production の lookup 経路** で発火することの統合テスト。
 *
 * 背景: BSFT01 の TR01..TR13 はダブルフェイス（A 面 = 鍵ブレイヴ、B 面 = 転醒後スピリット）。
 * B 面の『転醒時』効果は従来 card_event:"rebirth" の dispatch + 裏面レジストリ登録が無く
 * stub 化されていたが、いずれも main に配線済み（rebirth-trigger.test.ts /
 * rebirth-backface-registration.test.ts）。本テストは実在の BSFT01 カードを
 * production と同じビルダー（expandCardDefinitionsWithBackFaces → buildTriggeredEffectLookup）
 * で展開し、executeRebirth による裏返し後に B 面『転醒時』効果が pending triggered effect として
 * queue されることを検証する（再変換の回帰防止）。
 *
 * 注意: flip ルール文『この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する』
 * は **ルール (08a §2 手順3、効果ではない)** であり executeRebirth が countValue+1 を適用する。
 * effects に count_increase として書くと二重計上になるため禁止
 * （rebirth-boilerplate-guard.test.ts が機械検知）。queue されるのは印字された純正の
 * 『転醒時』効果のみ。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState, RebirthAction } from "../src/model";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
} from "../src/effect/trigger-system";
import { applyLegalAction } from "../src";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { ALL_CARDS } from "../../card-data/src/generated-index";

/** production と同じ展開・ルックアップ構築（game-api.ts installCardLookups と同経路）。 */
function buildProductionLookups(defs: readonly CardDefinition[]) {
  const expanded = expandCardDefinitionsWithBackFaces(defs);
  const map = new Map(expanded.map((d) => [d.cardNo, d]));
  return {
    getCardDefinitionById: (id: string) => map.get(id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(expanded),
  };
}

/** card_event:"rebirth" を含む effect か。 */
function isRebirthEffect(
  e: CardDefinition["effects"] extends (infer E)[] | undefined ? E : never
): boolean {
  if (e.timing.kind !== "card_event") return false;
  const events = Array.isArray(e.timing.event)
    ? e.timing.event
    : [e.timing.event];
  return events.includes("rebirth");
}

/** A 面を場に置き executeRebirth で裏返した after state と lookups を返す。 */
function flipToBack(
  frontNo: string,
  backNo: string,
  options: {
    action?: Partial<RebirthAction>;
    alicePlayer?: Partial<GameState["players"][number]>;
  } = {}
) {
  const lookups = buildProductionLookups(ALL_CARDS);
  const front = lookups.getCardDefinitionById(frontNo);
  expect(front, `${frontNo} must resolve`).toBeDefined();
  expect(front!.isDoubleSided).toBe(true);
  expect(front!.backFace?.cardNo).toBe(backNo);

  const card = createCardInstance(front!, {
    instanceId: "tr-1",
    ownerPlayerId: "alice",
    zone: "field",
    zoneRoleName: "spirit",
    normalCoreCount: 3,
  });
  const before: GameState = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [card],
    playerOverrides: [options.alicePlayer ?? {}, {}],
  });

  // 転醒条件はライフ1以上（カウント条件ではない）。maxCount は十分大きく設定して
  // executeRebirth のカウント上限ガードを通す（カードの A 面 rebirth は maxCount を持たない）。
  const action: RebirthAction = {
    kind: "rebirth",
    maxCount: 99,
    triggerDescription: "",
    ...options.action,
  };
  const after = executeRebirth(
    before,
    "alice",
    action,
    "tr-1",
    lookups.getCardDefinitionById,
    "test:bsft01-rebirth:92"
  );
  return { before, after, lookups, front: front! };
}

describe("BSFT01 TR rebirth — B-face 転醒時 fires via production lookup", () => {
  it("TR01: flip A→B counts +1 (rule) and queues only the genuine B-face 転醒時 effect (send_to_deck)", () => {
    const { before, after, lookups } = flipToBack(
      "BSFT01-TR01(A)",
      "BSFT01-TR01(B)",
      { alicePlayer: { voidNormalCoreCount: 10 } }
    );

    // flip 成立: definitionId が B 面へ、カウント +1 (executeRebirth のルール適用。
    // 誘発効果の解決を待たずにこの時点で確定する)。
    const flipped = after.cardInstances.find((c) => c.instanceId === "tr-1")!;
    expect(flipped.definitionId).toBe("BSFT01-TR01(B)");
    expect(flipped.zone).toBe("field");
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.countValue).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(9);

    // delta から rebirth イベントが 1 件。
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById: lookups.getCardDefinitionById,
    });
    expect(events.filter((e) => e.eventKind === "rebirth").length).toBe(1);

    // B 面の純正『転醒時』効果（send_to_deck）が pending triggered effect として queue。
    // flip ルール文のカウント+1 は効果ではないため queue されない（二重計上防止）。
    const queued = collectAndQueueTriggerReactions({
      chainId: "test:bsft01-rebirth:132",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const rebirthPendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "rebirth"
    );
    // 1 instance の rebirth イベントにつき pending 1 件（B 面の複数 rebirth 効果は
    // その単一 pending の解決時に source choice として供される）。
    expect(rebirthPendings.length).toBe(1);
    expect(rebirthPendings[0]!.relatedInstanceId).toBe("tr-1");
    expect(rebirthPendings[0]!.actingPlayerId).toBe("alice");
  });

  it("countBonusMode reset_to_zero は countValue と protectedCounts を同時に 0 相当へそろえる", () => {
    const { after } = flipToBack("BSFT01-TR01(A)", "BSFT01-TR01(B)", {
      action: { countBonusMode: "reset_to_zero" },
      alicePlayer: {
        countValue: 5,
        voidNormalCoreCount: 10,
        protectedCounts: { 神喰: 3, 星霊: 1 },
      },
    });

    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.countValue).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(15);
    expect(alice.protectedCounts).toBeUndefined();
  });

  it("TR01(B) definition exposes exactly one genuine rebirth effect (send_to_deck), no boilerplate count_increase", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const backDef = lookups.getCardDefinitionById("BSFT01-TR01(B)")!;
    expect(backDef).toBeDefined();
    const rebirthEffects = (backDef.effects ?? []).filter(isRebirthEffect);
    expect(rebirthEffects.length).toBe(1);
    // 純正『転醒時』効果には stub が残っていてはならない。
    expect(rebirthEffects.every((e) => e.stub === undefined)).toBe(true);
    // 本体アクションが配線されている（空 step でない）。
    expect(rebirthEffects.every((e) => e.steps.length > 0)).toBe(true);
    const kinds = rebirthEffects.flatMap((e) =>
      e.steps.map((s) => s.action.kind)
    );
    // flip ルール文のカウント+1 は executeRebirth (ルール) が適用するため、
    // count_increase が effects に存在してはならない（存在すると二重計上）。
    expect(kinds).not.toContain("count_increase");
    expect(kinds).toContain("send_to_deck");
  });

  it("TR10: flip A→B queues B-face rebirth effects incl. the conditional trash→hand 後段", () => {
    const { before, after, lookups } = flipToBack(
      "BSFT01-TR10(A)",
      "BSFT01-TR10(B)",
      { alicePlayer: { voidNormalCoreCount: 10 } }
    );

    const flipped = after.cardInstances.find((c) => c.instanceId === "tr-1")!;
    expect(flipped.definitionId).toBe("BSFT01-TR10(B)");
    const alice = after.players.find((p) => p.id === "alice")!;
    expect(alice.countValue).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(9);

    const queued = collectAndQueueTriggerReactions({
      chainId: "test:bsft01-rebirth:199",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });
    const rebirthPendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "rebirth"
    );
    // 1 instance の rebirth イベントにつき pending 1 件。
    expect(rebirthPendings.length).toBe(1);
    expect(rebirthPendings[0]!.relatedInstanceId).toBe("tr-1");
  });

  it("TR10(B) [7,8] 転醒時 is fully wired: prevent_battle + count≥4-gated optional search_zone(trash→hand)", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const backDef = lookups.getCardDefinitionById("BSFT01-TR10(B)")!;
    const rebirthEffects = (backDef.effects ?? []).filter(isRebirthEffect);
    // [7,8] 効果（prevent_battle を含む rebirth 効果）を特定。
    const battleEffect = rebirthEffects.find((e) =>
      e.steps.some((s) => s.action.kind === "prevent_battle")
    );
    expect(
      battleEffect,
      "TR10(B) prevent_battle rebirth effect must exist"
    ).toBeDefined();
    expect(battleEffect!.stub).toBeUndefined();
    // 後段 = search_zone(trash→hand)、任意、count_value>=4 ゲート。
    const searchStep = battleEffect!.steps.find(
      (s) => s.action.kind === "search_zone"
    );
    expect(searchStep, "後段 search_zone step must exist").toBeDefined();
    expect(searchStep!.executionMode).toBe("optional");
    const action = searchStep!.action as Extract<
      typeof searchStep.action,
      { kind: "search_zone" }
    >;
    expect(action.zone).toBe("trash");
    expect(action.destination).toBe("hand");
    expect(action.filter?.category).toContain("brave");
    expect(action.filter?.tribesRequired).toEqual(
      expect.arrayContaining(["光導", "鍵"])
    );
    // count_value>=4 のステップ条件。
    const cond = (searchStep!.condition ?? []).find(
      (c) => c.kind === "count_value"
    );
    expect(cond).toMatchObject({ kind: "count_value", player: "self", min: 4 });
  });

  it("TR11(B) [7,8] 転醒時 is fully wired: opponent trash magic -> deck bottom with 1+count/3", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const backDef = lookups.getCardDefinitionById("BSFT01-TR11(B)")!;
    const rebirthEffects = (backDef.effects ?? []).filter(isRebirthEffect);
    const trashDeckEffect = rebirthEffects.find((e) =>
      e.steps.some((s) => s.action.kind === "search_zone")
    );
    expect(trashDeckEffect).toBeDefined();
    expect(trashDeckEffect!.stub).toBeUndefined();
    expect(trashDeckEffect!.executionMode).toBe("optional");

    const step = trashDeckEffect!.steps.find(
      (s) => s.action.kind === "search_zone"
    )!;
    expect(step.executionMode).toBeUndefined();
    const action = step.action as Extract<
      typeof step.action,
      { kind: "search_zone" }
    >;
    expect(action.zone).toBe("trash");
    expect(action.player).toBe("opponent");
    expect(action.destination).toBe("deck");
    expect(action.destinationPosition).toBe("bottom");
    expect(action.filter?.category).toEqual(["magic"]);
    expect(action.count).toMatchObject({
      source: { kind: "count_value", player: "self" },
      divisor: 3,
      offset: 1,
    });
    expect(action.mandatory).toBe(true);
  });

  it("BSFT01-TR11(B) rebirth effect moves 1+count/3 opponent trash magic cards to opponent deck", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const backDef = lookups.getCardDefinitionById("BSFT01-TR11(B)")!;
    const magicDef = lookups.getCardDefinitionById("BSFT01-C01")!;
    const magicCompatibleBraveDef =
      lookups.getCardDefinitionById("BSFT01-TR10(A)")!;
    const nonMagicDef = lookups.getCardDefinitionById("BSFT01-CX01")!;
    const effect = (backDef.effects ?? [])
      .filter(isRebirthEffect)
      .find((e) => e.steps.some((s) => s.action.kind === "search_zone"))!;

    const resolveWithCount = (countValue: number) => {
      const source = createCardInstance(backDef, {
        instanceId: "tr11-back",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "spirit",
        normalCoreCount: 3,
      });
      const bobMagic1 = createCardInstance(magicDef, {
        instanceId: "bob-magic-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "trash",
        normalCoreCount: 2,
        exhaustState: "exhausted",
        attachedToInstanceId: "stale-host",
        attachedChildrenIds: ["stale-child"],
      });
      bobMagic1.underCards = [
        { cardInstanceId: "stale-under", role: "text_role", roleTag: "星霊衣" },
      ];
      const bobMagic2 = createCardInstance(magicDef, {
        instanceId: "bob-magic-2",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "trash",
      });
      const bobMagic3 = createCardInstance(magicDef, {
        instanceId: "bob-magic-3",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "trash",
      });
      const bobMagicCompatibleBrave = createCardInstance(
        magicCompatibleBraveDef,
        {
          instanceId: "bob-key-brave-1",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "trash",
        }
      );
      const bobNonMagic = createCardInstance(nonMagicDef, {
        instanceId: "bob-non-magic-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "trash",
      });
      const bobDeckAnchor = createCardInstance(nonMagicDef, {
        instanceId: "bob-deck-anchor",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "deck",
      });
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue }, { deckCount: 10 }],
        cardInstances: [
          source,
          bobDeckAnchor,
          bobMagic1,
          bobMagic2,
          bobMagic3,
          bobMagicCompatibleBrave,
          bobNonMagic,
        ],
      });

      const pendingState = executeEffect({
        chainId: "test:bsft01-rebirth:364",
        state: base,
        effect,
        sourceInstanceId: "tr11-back",
        actingPlayerId: "alice",
        getCardDefinitionById: lookups.getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(pendingState.pendingStepOptionalChoice ?? null).toBeNull();

      const zoneSelection = pendingState.pendingZoneSelection;
      if (!zoneSelection) return pendingState;
      expect(zoneSelection.destination).toBe("deck");
      expect(zoneSelection.destinationPosition).toBe("bottom");
      expect(zoneSelection.canSkip).toBe(false);
      return applyLegalAction({
        state: pendingState,
        action: { kind: "resolve_pending_zone_selection" },
        selectedZoneCardIds: zoneSelection.candidateCardInstanceIds.slice(
          0,
          zoneSelection.maxCount
        ),
        getCardDefinitionById: lookups.getCardDefinitionById,
      }).state;
    };

    const movedMagicReferenceCount = (countValue: number) => {
      const after = resolveWithCount(countValue);
      const zoneOf = (id: string) =>
        after.cardInstances.find((c) => c.instanceId === id)?.zone;
      expect(zoneOf("bob-non-magic-1")).toBe("trash");
      const candidateIds = [
        "bob-magic-1",
        "bob-magic-2",
        "bob-magic-3",
        "bob-key-brave-1",
      ];
      const movedIds = candidateIds.filter((id) => zoneOf(id) === "deck");
      const moved = movedIds.length;
      expect(
        after.cardInstances
          .filter((c) => c.ownerPlayerId === "bob" && c.zone === "deck")
          .map((c) => c.instanceId)
      ).toEqual(["bob-deck-anchor", ...movedIds]);
      const bobPlayer = after.players.find((p) => p.id === "bob")!;
      expect(bobPlayer.deckCount).toBe(10 + moved);
      expect(bobPlayer.reserveNormalCoreCount).toBe(4 + 2);
      const movedPrimary = after.cardInstances.find(
        (c) => c.instanceId === "bob-magic-1"
      )!;
      expect(movedPrimary.normalCoreCount).toBe(0);
      expect(movedPrimary.exhaustState).toBe("recovered");
      expect(movedPrimary.attachedToInstanceId).toBeNull();
      expect(movedPrimary.attachedChildrenIds).toEqual([]);
      expect(movedPrimary.underCards).toEqual([]);
      expect(movedPrimary.faceDown).toBe(false);
      expect(after.log).toContain(
        `effect:return_from_trash:alice:${moved}:deck:bottom`
      );
      return moved;
    };

    expect(movedMagicReferenceCount(2)).toBe(1);
    expect(movedMagicReferenceCount(3)).toBe(2);
    expect(movedMagicReferenceCount(6)).toBe(3);
    expect(movedMagicReferenceCount(9)).toBe(4);
  });

  it("TR11(B) execute requires exact selection after effect-level optional is fired", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const backDef = lookups.getCardDefinitionById("BSFT01-TR11(B)")!;
    const magicDef = lookups.getCardDefinitionById("BSFT01-C01")!;
    const effect = (backDef.effects ?? [])
      .filter(isRebirthEffect)
      .find((e) => e.steps.some((s) => s.action.kind === "search_zone"))!;
    const source = createCardInstance(backDef, {
      instanceId: "tr11-back",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const trashCards = [1, 2, 3].map((n) =>
      createCardInstance(magicDef, {
        instanceId: `bob-magic-${n}`,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "trash",
      })
    );
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 3 }, { deckCount: 10 }],
      cardInstances: [source, ...trashCards],
    });
    const pendingState = executeEffect({
      chainId: "test:bsft01-rebirth:458",
      state: base,
      effect,
      sourceInstanceId: "tr11-back",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(pendingState.pendingStepOptionalChoice ?? null).toBeNull();
    const zoneSelection = pendingState.pendingZoneSelection!;

    expect(zoneSelection.maxCount).toBe(2);
    expect(zoneSelection.canSkip).toBe(false);
    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: { kind: "resolve_pending_zone_selection" },
        selectedZoneCardIds: zoneSelection.candidateCardInstanceIds.slice(0, 1),
        getCardDefinitionById: lookups.getCardDefinitionById,
      })
    ).toThrow(/does not satisfy/);
  });

  it("search_zone deck player=opponent searches and counts the opponent deck", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const sourceDef = lookups.getCardDefinitionById("BSFT01-TR11(B)")!;
    const magicDef = lookups.getCardDefinitionById("BSFT01-C01")!;
    const source = createCardInstance(sourceDef, {
      instanceId: "source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const bobDeck1 = createCardInstance(magicDef, {
      instanceId: "bob-deck-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const bobDeck2 = createCardInstance(magicDef, {
      instanceId: "bob-deck-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const aliceDeck = createCardInstance(magicDef, {
      instanceId: "alice-deck",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ deckCount: 20 }, { deckCount: 30 }],
      cardInstances: [source, bobDeck1, bobDeck2, aliceDeck],
    });
    const after = executeEffect({
      chainId: "test:bsft01-rebirth:514",
      state: base,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "deck",
              player: "opponent",
              filter: { category: ["magic"] },
              count: 1,
              destination: "hand",
            },
          },
        ],
      },
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const pending = after.pendingZoneSelection!;
    expect(pending.sourceZone).toBe("deck");
    expect(pending.targetPlayerId).toBe("bob");
    expect(pending.candidateCardInstanceIds).toEqual([
      "bob-deck-1",
      "bob-deck-2",
    ]);
    const resolved = applyLegalAction({
      state: after,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["bob-deck-1"],
      getCardDefinitionById: lookups.getCardDefinitionById,
    }).state;
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "bob-deck-1")!.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "alice-deck")!.zone
    ).toBe("deck");
    expect(resolved.players.find((p) => p.id === "alice")!.deckCount).toBe(20);
    expect(resolved.players.find((p) => p.id === "bob")!.deckCount).toBe(29);
    expect(resolved.players.find((p) => p.id === "bob")!.handCount).toBe(5);
  });

  it("search_zone deck -> deck bottom reorders cards without changing deck counts in the auto-select path", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const sourceDef = lookups.getCardDefinitionById("BSFT01-TR11(B)")!;
    const magicDef = lookups.getCardDefinitionById("BSFT01-C01")!;
    const nonMagicDef = lookups.getCardDefinitionById("BSFT01-CX01")!;
    const source = createCardInstance(sourceDef, {
      instanceId: "source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const bobDeckCards = [1, 2].map((n) =>
      createCardInstance(magicDef, {
        instanceId: `bob-deck-${n}`,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "deck",
      })
    );
    const bobNonMagicDeck = createCardInstance(nonMagicDef, {
      instanceId: "bob-deck-non-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ deckCount: 20 }, { deckCount: 30 }],
      cardInstances: [
        source,
        bobDeckCards[0]!,
        bobNonMagicDeck,
        bobDeckCards[1]!,
      ],
    });

    const after = executeEffect({
      chainId: "test:bsft01-rebirth:597",
      state: base,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "deck",
              player: "opponent",
              filter: { category: ["magic"] },
              count: 2,
              destination: "deck",
              destinationPosition: "bottom",
            },
          },
        ],
      },
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(after.pendingZoneSelection).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-deck-1")!.zone
    ).toBe("deck");
    expect(
      after.cardInstances
        .filter((c) => c.ownerPlayerId === "bob" && c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["bob-deck-non-magic", "bob-deck-1", "bob-deck-2"]);
    expect(after.players.find((p) => p.id === "alice")!.deckCount).toBe(20);
    expect(after.players.find((p) => p.id === "bob")!.deckCount).toBe(30);
  });

  it("search_zone deck -> deck top reorders cards without changing deck counts in the pending path", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const sourceDef = lookups.getCardDefinitionById("BSFT01-TR11(B)")!;
    const magicDef = lookups.getCardDefinitionById("BSFT01-C01")!;
    const source = createCardInstance(sourceDef, {
      instanceId: "source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const bobDeckCards = [1, 2].map((n) =>
      createCardInstance(magicDef, {
        instanceId: `bob-deck-${n}`,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "deck",
      })
    );
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ deckCount: 20 }, { deckCount: 30 }],
      cardInstances: [source, ...bobDeckCards],
    });
    const pendingState = executeEffect({
      chainId: "test:bsft01-rebirth:657",
      state: base,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "deck",
              player: "opponent",
              filter: { category: ["magic"] },
              count: 1,
              destination: "deck",
              destinationPosition: "top",
              mandatory: true,
            },
          },
        ],
      },
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const pending = pendingState.pendingZoneSelection!;
    expect(pending.destination).toBe("deck");
    expect(pending.destinationPosition).toBe("top");
    expect(pending.targetPlayerId).toBe("bob");

    const resolved = applyLegalAction({
      state: pendingState,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["bob-deck-2"],
      getCardDefinitionById: lookups.getCardDefinitionById,
    }).state;

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "bob-deck-2")!.zone
    ).toBe("deck");
    expect(
      resolved.cardInstances
        .filter((c) => c.ownerPlayerId === "bob" && c.zone === "deck")
        .map((c) => c.instanceId)
    ).toEqual(["bob-deck-2", "bob-deck-1"]);
    expect(resolved.players.find((p) => p.id === "alice")!.deckCount).toBe(20);
    expect(resolved.players.find((p) => p.id === "bob")!.deckCount).toBe(30);
  });
});
