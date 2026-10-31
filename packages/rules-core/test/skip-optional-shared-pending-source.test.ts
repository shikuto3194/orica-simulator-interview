import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../src";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import type { CollectedTriggerEvent } from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

/**
 * 同一イベントに複数カードが反応する誘発（pending を source 複数で共有）で、
 * 片方の「発揮しない」が別カードの誘発を巻き添えにしないことの回帰テスト。
 *
 * 実バグ: BSTH01-X03（レミリア）召喚で 1 個の summon pending に
 *   - X03 自身『召喚時』（相手創界神破壊）
 *   - BSTH01-R21（紅魔館）responder『夜族コスト8以上召喚時』（ボイドからコア）
 * の 2 source が乗る。前面（X03）で「発揮しない」を選ぶと pendingId 単位で削除され
 * R21 の誘発まで消えていた。
 *
 * ここでは同じ「1 pending・2 source」構造を、同一 start_step イベントに反応する
 * 2 体のフィールドスピリットで最小再現する（skip 経路は eventKind 非依存）。
 */

function makeOptionalStartStepSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `shared-pending ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "phase", step: "start", subPhase: "start" },
        applicability: { zone: "field" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

function makeLookup(definitions: readonly CardDefinition[]) {
  const map = new Map(definitions.map((d) => [d.cardNo, d]));
  return (definitionId: string) => map.get(definitionId);
}

function makeStartStepEvent(actingPlayerId: string): CollectedTriggerEvent {
  return {
    actingPlayerId,
    eventKind: "start_step",
    source: "step_transition",
    chainId: "test:skip-optional-shared-pending-source:58",
    attackId: null,
    relatedPlayerId: actingPlayerId,
    relatedInstanceId: null,
    amount: null,
    step: "start",
    subPhase: "start",
  };
}

describe("skip optional triggered effect on a pending shared by multiple sources", () => {
  it("片方の source を発揮辞退しても、同一 pending の別 source の誘発は残る", () => {
    const x03Like = makeOptionalStartStepSpirit("SHARED-X03");
    const r21Like = makeOptionalStartStepSpirit("SHARED-R21");
    const lookup = makeLookup([x03Like, r21Like]);
    const triggerLookup = buildTriggeredEffectLookup([x03Like, r21Like]);

    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(x03Like, {
          instanceId: "alice-x03",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(r21Like, {
          instanceId: "alice-r21",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
    });

    // 1 イベント → 1 pending、ただし 2 source（alice-x03 / alice-r21）が乗る
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [makeStartStepEvent("alice")],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);
    const pendingId = queued.pendingTriggeredEffects[0]!.pendingId;

    // 2 source ぶんの resolve action が同一 pendingId で出る
    const actions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const resolveActions = actions.filter(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(resolveActions).toHaveLength(2);

    const declineX03 = resolveActions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "alice-x03"
    );
    expect(declineX03).toBeDefined();

    // X03 を「発揮しない」: pending は消えず、R21 が残ること
    const afterDeclineX03 = applyLegalAction({
      state: queued,
      action: declineX03!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(afterDeclineX03.state.pendingTriggeredEffects).toHaveLength(1);
    // 辞退は effect 単位キー (instanceId#registrationIndex) で記録される
    expect(
      afterDeclineX03.state.pendingTriggeredEffects[0]
        ?.resolvedSourceRegistrationKeys
    ).toContain("alice-x03#0");

    // 残った source は R21 のみ
    const afterActions = getLegalActions({
      state: afterDeclineX03.state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    const remainingResolves = afterActions.filter(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(remainingResolves).toHaveLength(1);
    expect(
      remainingResolves[0]?.kind === "resolve_pending_triggered_effect" &&
        remainingResolves[0].sourceInstanceId
    ).toBe("alice-r21");

    // R21 も「発揮しない」: 最後の source なので pending が削除される
    const afterDeclineR21 = applyLegalAction({
      state: afterDeclineX03.state,
      action: remainingResolves[0]!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(afterDeclineR21.state.pendingTriggeredEffects).toHaveLength(0);
    expect(afterDeclineR21.state.log).toContain(
      `skip_optional_triggered_effect:${pendingId}`
    );
  });

  it("同一カードが同タイミングの誘発効果を2つ持つ場合、片方を辞退しても他方は残る (BSTH06-C01 型)", () => {
    // BSTH06-C01「キスメ」は Lv2 で 2 つの『召喚時』効果を持つ (デッキオープン / BP1000破壊)。
    // 同一 summon イベントに対し 1 pending を 2 registration で共有するため、片方を
    // 「発揮しない」しても他方が残ること (instance 単位除外による巻き添えの回帰防止)。
    const def: CardDefinition = {
      cardNo: "TWO-SUMMON",
      name: "two summon effects",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
    const lookup = (id: string) => (id === def.cardNo ? def : undefined);
    const triggerLookup = buildTriggeredEffectLookup([def]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "kisume",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
    });
    const summonEvent: CollectedTriggerEvent = {
      actingPlayerId: "alice",
      eventKind: "summon",
      source: "action_resolution",
      chainId: "test:skip-optional-shared-pending-source:215",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: "kisume",
      amount: 1,
    };
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [summonEvent],
      undefined,
      {
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggerLookup,
        getRegisteredBurstActions: () => undefined,
      }
    );
    expect(queued.pendingTriggeredEffects).toHaveLength(1);

    // 同一カードの 2 effect 分の resolve action が同一 pendingId で出る
    const resolves0 = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).filter((a) => a.kind === "resolve_pending_triggered_effect");
    expect(resolves0).toHaveLength(2);
    const declineReg0 = resolves0.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.registrationIndex === 0
    );
    expect(declineReg0).toBeDefined();

    // registrationIndex 0 を「発揮しない」: pending は残り、registrationIndex 1 が残ること
    const after = applyLegalAction({
      state: queued,
      action: declineReg0!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    expect(after.state.pendingTriggeredEffects).toHaveLength(1);
    expect(
      after.state.pendingTriggeredEffects[0]?.resolvedSourceRegistrationKeys
    ).toContain("kisume#0");

    const resolves1 = getLegalActions({
      state: after.state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggerLookup,
    }).filter((a) => a.kind === "resolve_pending_triggered_effect");
    expect(resolves1).toHaveLength(1);
    expect(
      resolves1[0]?.kind === "resolve_pending_triggered_effect" &&
        resolves1[0].registrationIndex
    ).toBe(1);
  });
});

describe("相手ターンの共有イベントは効果単位で順序選択する", () => {
  for (const sameCard of [false, true])
    for (const skip of [false, true]) {
      it("同一カード=" + sameCard + " 辞退=" + skip, () => {
        const a = makeOptionalStartStepSpirit("ORDER-A");
        const b = makeOptionalStartStepSpirit("ORDER-B");
        if (sameCard) a.effects = [...a.effects!, ...a.effects!];
        const getCardDefinitionById = makeLookup([a, b]);
        const getRegisteredTriggeredEffectActions = buildTriggeredEffectLookup([
          a,
          b,
        ]);
        const lookups = {
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions,
          getRegisteredFieldCardEffectActions: () => [],
          getRegisteredBurstActions: () => [],
        };
        let state = queuePendingReactionsFromTriggerEvents(
          createEmptyGameState({
            playerIds: ["alice", "bob"],
            playerOverrides: [
              { deckCount: 4, handCount: 0 },
              { deckCount: 4, handCount: 0 },
            ],
            cardInstances: [
              createCardInstance(a, {
                instanceId: "a",
                ownerPlayerId: "bob",
                zone: "field",
                cores: 1,
              }),
              ...(!sameCard
                ? [
                    createCardInstance(b, {
                      instanceId: "b",
                      ownerPlayerId: "bob",
                      zone: "field",
                      cores: 1,
                    }),
                  ]
                : []),
            ],
          }),
          [makeStartStepEvent("bob")],
          undefined,
          lookups
        );
        expect(state.pendingTriggeredEffects).toHaveLength(1);
        const actions = (player: string) =>
          getLegalActions({ state, actingPlayerId: player, ...lookups });
        expect(actions("bob")).toEqual([]);
        const select = actions("alice").filter(
          (a) => a.kind === "select_pending_to_resolve"
        );
        expect(select).toHaveLength(2);
        expect(
          select.every(
            (a) =>
              a.sourceInstanceId !== undefined &&
              a.registrationIndex !== undefined
          )
        ).toBe(true);
        const chosen = select[1]!;
        state = applyLegalAction({ state, action: chosen, ...lookups }).state;
        const declaredCandidates = actions("bob").filter(
          (a) => a.kind === "resolve_pending_triggered_effect"
        );
        expect(declaredCandidates).toHaveLength(1);
        expect(declaredCandidates[0]).toMatchObject({
          sourceInstanceId: chosen.sourceInstanceId,
          registrationIndex: chosen.registrationIndex,
        });
        state = applyLegalAction({
          state,
          action: declaredCandidates[0]!,
          skipOptionalEffect: skip,
          ...lookups,
        }).state;
        if (!skip) {
          const pass = actions("alice").find((a) => a.kind === "pass_stack");
          expect(pass).toBeDefined();
          expect(actions("bob")).toEqual([]);
          state = applyLegalAction({ state, action: pass!, ...lookups }).state;
          expect(state.players.find((p) => p.id === "bob")?.handCount).toBe(1);
        }
        const remaining = actions("bob").filter(
          (a) => a.kind === "resolve_pending_triggered_effect"
        );
        expect(remaining).toHaveLength(1);
        expect(remaining[0]).toMatchObject({
          sourceInstanceId: select[0]!.sourceInstanceId,
          registrationIndex: select[0]!.registrationIndex,
        });
      });
    }
});
