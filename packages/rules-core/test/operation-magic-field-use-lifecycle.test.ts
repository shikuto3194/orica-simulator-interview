/**
 * 【タイプ：作戦】の場からの「使用」ライフサイクル。
 *
 * 10_rules/07b_card-observed-mechanics.md §タイプ：作戦の 2026-09-01 ユーザー裁定:
 * - 場の作戦マジックを「使用」したら hand/set_aside と同様に in_use → trash。
 * - 「フラッシュ/スタック効果使用後以外で…フィールドに置く」は trash 到着後だけを置換する。
 * - 直接「発揮」する field effect と、継続効果によるトークン残置は使用ではない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "../src";
import {
  resolveDeferredFieldEffectStack,
  useFieldCardEffectInFlashContextAsAction,
} from "../src/card/card-effect-system";
import { processPendingImmediateBattleEnds } from "../src/effect/effect-resolution";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { processMovedToTrashEffects } from "../src/effect/structured-effect-interpreter";

function operationMagic(options: {
  cardNo: string;
  name: string;
  mode: "main" | "flash" | "stack";
  returnsToFieldAfterNonFlashOrStackUse?: boolean;
  explicitStayOnField?: boolean;
  deferredToBattleEnd?: boolean;
  stepDeferredToBattleEnd?: boolean;
}): CardDefinition {
  return {
    cardNo: options.cardNo,
    name: options.name,
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: ["operation"],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      ...(options.returnsToFieldAfterNonFlashOrStackUse
        ? [
            {
              timing: {
                kind: "card_event" as const,
                event: ["moved_to_trash"],
              },
              executionMode: "mandatory" as const,
              condition: [
                {
                  kind: "flash_used" as const,
                  target: "card_usage" as const,
                  scope: "step" as const,
                  player: "self" as const,
                  mode:
                    options.mode === "stack"
                      ? ("stack" as const)
                      : ("flash" as const),
                  cardFilter: { cardName: { exact: options.name } },
                  sameInstanceAsSource: true,
                  negate: true,
                },
              ],
              cardEventDisposition: {
                kind: "move" as const,
                destination: "field" as const,
              },
              steps: [
                {
                  action: {
                    kind: "move_self" as const,
                    destination: "field" as const,
                  },
                },
              ],
            },
          ]
        : []),
      {
        applicability: { zone: "field" as const },
        timing: {
          kind: "activated" as const,
          mode: options.mode,
          ...(options.deferredToBattleEnd
            ? { deferredTo: "battle_end" as const }
            : {}),
        },
        steps: options.explicitStayOnField
          ? [{ action: { kind: "move_self", destination: "field" } }]
          : options.deferredToBattleEnd || options.stepDeferredToBattleEnd
            ? [
                {
                  action: { kind: "count_increase", player: "self", amount: 1 },
                  ...(options.stepDeferredToBattleEnd
                    ? { deferTo: "battle_end" as const }
                    : {}),
                },
              ]
            : [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

function resolveFieldEffect(definition: CardDefinition) {
  const source = createCardInstance(definition, {
    instanceId: `${definition.cardNo}-field`,
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
  });
  const getDef = (id: string) =>
    id === definition.cardNo ? definition : undefined;
  const declared = useFieldCardEffectInFlashContextAsAction({
    state: createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
    }),
    actingPlayerId: "alice",
    sourceInstanceId: source.instanceId,
    sourceKind: "magic",
    effectTimingFilter:
      definition.effects![definition.effects!.length - 1]!.timing.kind ===
      "activated"
        ? definition.effects![definition.effects!.length - 1]!.timing.mode
        : "flash",
    getCardDefinitionById: getDef,
  });

  expect(
    declared.state.cardInstances.find(
      (card) => card.instanceId === source.instanceId
    )?.zone
  ).toBe(definition.keywordTags.includes("operation") ? "in_use" : "field");

  return resolveDeferredFieldEffectStack({
    state: declared.state,
    activeStack: declared.activeStack,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
      definition,
    ]),
    getRegisteredBurstActions: () => [],
  });
}

describe("【タイプ：作戦】field use lifecycle", () => {
  it("フラッシュ効果として場から使用すると in_use → trash となり、自己配置の除外条件が残す", () => {
    const definition = operationMagic({
      cardNo: "TEST-OPERATION-FLASH-TRASH",
      name: "テスト作戦フラッシュ",
      mode: "flash",
      returnsToFieldAfterNonFlashOrStackUse: true,
    });

    const result = resolveFieldEffect(definition);

    expect(
      result.cardInstances.find(
        (card) => card.instanceId === `${definition.cardNo}-field`
      )?.zone
    ).toBe("trash");
    expect(
      result.log.some(
        (entry) =>
          entry.startsWith("magic:trash:") &&
          entry.endsWith(`${definition.cardNo}-field`)
      )
    ).toBe(true);
  });

  it("メイン効果として場から使用すると trash 到着後の自己配置が field へ戻す", () => {
    const definition = operationMagic({
      cardNo: "TEST-OPERATION-MAIN-SELF-PLACE",
      name: "テスト作戦メイン",
      mode: "main",
      returnsToFieldAfterNonFlashOrStackUse: true,
    });

    const result = resolveFieldEffect(definition);

    expect(
      result.cardInstances.find(
        (card) => card.instanceId === `${definition.cardNo}-field`
      )?.zone,
      result.log.join("\n")
    ).toBe("field");
  });

  it("明示的な move_self(field) は使用後 cleanup より優先して field に残る", () => {
    const definition = operationMagic({
      cardNo: "TEST-OPERATION-EXPLICIT-STAY",
      name: "テスト作戦明示残置",
      mode: "main",
      explicitStayOnField: true,
    });

    const result = resolveFieldEffect(definition);

    expect(
      result.cardInstances.find(
        (card) => card.instanceId === `${definition.cardNo}-field`
      )?.zone,
      result.log.join("\n")
    ).toBe("field");
  });

  it("operation でない field effect の直接発揮は field に残る", () => {
    const definition: CardDefinition = {
      ...operationMagic({
        cardNo: "TEST-DIRECT-FIELD-MAGIC",
        name: "テスト直接発揮マジック",
        mode: "flash",
      }),
      keywordTags: ["token"],
    };

    const result = resolveFieldEffect(definition);

    expect(
      result.cardInstances.find(
        (card) => card.instanceId === `${definition.cardNo}-field`
      )?.zone
    ).toBe("field");
  });

  it("BSAZ01-C10 の場フラッシュ使用はトラッシュへ進み、C11 も作戦として分類される", () => {
    const c10 = ALL_CARDS.find((card) => card.cardNo === "BSAZ01-C10");
    const c11 = ALL_CARDS.find((card) => card.cardNo === "BSAZ01-C11");
    expect(c10).toBeDefined();
    expect(c11?.keywordTags).toContain("operation");

    const result = resolveFieldEffect(c10!);

    expect(
      result.cardInstances.find(
        (card) => card.instanceId === `${c10!.cardNo}-field`
      )?.zone
    ).toBe("trash");
  });

  it("自己配置本文のない BSAZ01-C06 は使用後もトラッシュに留まる", () => {
    const c06 = ALL_CARDS.find((card) => card.cardNo === "BSAZ01-C06");
    expect(c06?.keywordTags).toContain("operation");

    const result = resolveFieldEffect(c06!);

    expect(
      result.cardInstances.find(
        (card) => card.instanceId === `${c06!.cardNo}-field`
      )?.zone
    ).toBe("trash");
  });

  it("同名別 instance のフラッシュ使用は、このカード自身の自己配置を妨げない", () => {
    const definition = operationMagic({
      cardNo: "TEST-OPERATION-SAME-NAME",
      name: "テスト作戦同名",
      mode: "flash",
      returnsToFieldAfterNonFlashOrStackUse: true,
    });
    const used = createCardInstance(definition, {
      instanceId: "operation-used",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const moved = createCardInstance(definition, {
      instanceId: "operation-moved",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [used, moved],
      }),
      flashCardUsageLog: [
        {
          playerId: "alice",
          cardInstanceId: used.instanceId,
          cardDefinitionId: definition.cardNo,
          turnNumber: 1,
          step: "main",
          attackId: null,
          mode: "flash",
        },
      ],
    };
    const result = processMovedToTrashEffects(
      state,
      [moved.instanceId],
      (id) => (id === definition.cardNo ? definition : undefined),
      { fromZone: "in_use" }
    );

    expect(
      result.cardInstances.find((card) => card.instanceId === moved.instanceId)
        ?.zone
    ).toBe("field");
  });

  it("battle_end へ遅延する作戦は、使用後に場を離れても予約された効果を発揮する", () => {
    const definition = operationMagic({
      cardNo: "TEST-OPERATION-BATTLE-END",
      name: "テスト作戦バトル終了時",
      mode: "flash",
      deferredToBattleEnd: true,
    });
    const source = createCardInstance(definition, {
      instanceId: "operation-battle-end-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const attackId = "attack:operation-battle-end";
    const getDef = (id: string) =>
      id === definition.cardNo ? definition : undefined;
    const declared = useFieldCardEffectInFlashContextAsAction({
      state: {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source],
        }),
        step: "attack",
        window: "battle_resolution",
        activeAttack: { attackId } as GameState["activeAttack"],
      },
      actingPlayerId: "alice",
      sourceInstanceId: source.instanceId,
      sourceKind: "magic",
      effectTimingFilter: "flash",
      getCardDefinitionById: getDef,
    });
    const reserved = resolveDeferredFieldEffectStack({
      state: declared.state,
      activeStack: declared.activeStack,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        definition,
      ]),
      getRegisteredBurstActions: () => [],
    });
    const deferral = reserved.pendingBattleEndDeferrals[0];
    expect(deferral?.sourceOnFieldRequired).toBe(false);
    expect(deferral?.applicabilityEvaluationZone).toBe("field");
    expect(
      reserved.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )?.zone
    ).toBe("trash");

    const after = processPendingImmediateBattleEnds({
      state: {
        ...reserved,
        activeAttack: null,
        pendingBattleEndFinalizeAttackIds: [attackId],
        pendingImmediateBattleEnds: [
          {
            attackId,
            participantInstanceIds: [],
            blockSideInstanceIds: [],
            participantSnapshots: [],
            appliedLifeDamage: 0,
            participantOwnSymbols: [],
            battleEndEntryStarted: true,
          },
        ],
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(
      after.players.find((player) => player.id === "alice")?.countValue
    ).toBe(1);
    expect(after.log).toContain(
      `battle:end-deferral:fire:${attackId}:${source.instanceId}:0`
    );
  });

  it("先頭 step を battle_end へ遅延する作戦も、使用後に場を離れてから予約された効果を発揮する", () => {
    const definition = operationMagic({
      cardNo: "TEST-OPERATION-STEP-BATTLE-END",
      name: "テスト作戦stepバトル終了時",
      mode: "flash",
      stepDeferredToBattleEnd: true,
    });
    const source = createCardInstance(definition, {
      instanceId: "operation-step-battle-end-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const attackId = "attack:operation-step-battle-end";
    const getDef = (id: string) =>
      id === definition.cardNo ? definition : undefined;
    const declared = useFieldCardEffectInFlashContextAsAction({
      state: {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source],
        }),
        step: "attack",
        window: "battle_resolution",
        activeAttack: { attackId } as GameState["activeAttack"],
      },
      actingPlayerId: "alice",
      sourceInstanceId: source.instanceId,
      sourceKind: "magic",
      effectTimingFilter: "flash",
      getCardDefinitionById: getDef,
    });
    const reserved = resolveDeferredFieldEffectStack({
      state: declared.state,
      activeStack: declared.activeStack,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        definition,
      ]),
      getRegisteredBurstActions: () => [],
    });
    const deferral = reserved.pendingBattleEndDeferrals[0];
    expect(deferral?.resumeFromStepIndex).toBe(0);
    expect(deferral?.sourceOnFieldRequired).toBe(false);
    expect(deferral?.applicabilityEvaluationZone).toBe("field");
    expect(
      reserved.cardInstances.find(
        (card) => card.instanceId === source.instanceId
      )?.zone
    ).toBe("trash");

    const after = processPendingImmediateBattleEnds({
      state: {
        ...reserved,
        activeAttack: null,
        pendingBattleEndFinalizeAttackIds: [attackId],
        pendingImmediateBattleEnds: [
          {
            attackId,
            participantInstanceIds: [],
            blockSideInstanceIds: [],
            participantSnapshots: [],
            appliedLifeDamage: 0,
            participantOwnSymbols: [],
            battleEndEntryStarted: true,
          },
        ],
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    });

    expect(
      after.players.find((player) => player.id === "alice")?.countValue
    ).toBe(1);
    expect(after.log).toContain(
      `battle:end-deferral:fire:${attackId}:${source.instanceId}:0`
    );
  });
});
