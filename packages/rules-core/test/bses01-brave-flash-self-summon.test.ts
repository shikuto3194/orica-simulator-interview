import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * BSES01 ジャガーノート系ブレイヴの自己フラッシュ召喚解禁:
 *   「フラッシュ『お互いのアタックステップ』手札/手元にあるこのカードは召喚できる。」
 *
 * 検証:
 *  - 手札 (通常コスト=軽減適用) と手元 (set_aside, コスト2固定) の双方が源になる。
 *  - timingScope=both/attack のため、窓を開いた直後は非アクティブ側 (bob) も自分の
 *    ブレイヴを召喚でき、優先権が移った後はアクティブ側 (alice) も召喚できる。
 *  - 「コストなし召喚」(M02 〔ターンに1回:同名〕) は別の手札起動効果として提示。
 *  - 召喚宣言で対象カードが in_use へ移り、コスト支払いはスタック窓後の解決で行われる。
 *  - timingScope 外 (メインステップ) では手札起動効果は提示されない。
 *
 * ルール根拠: カード本文 (独自カード source precedence)。フラッシュ優先権ループは
 *   20_design/08_stack-window-and-priority-loop.md / 10_rules/02_turn-flow-and-timing.md。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildHandActivatedEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
// C02: 通常コスト召喚 (cost3 / 軽減 guide), X01: コスト2固定, M02: 通常 + ターン1回コスト0。
const C02 = cardNoMap.get("BSES01-C02")!;
const X01 = cardNoMap.get("BSES01-X01")!;
const M02 = cardNoMap.get("BSES01-M02")!;

function makeSimpleSpirit(cardNo: string, bp: number): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}
const ATTACKER = makeSimpleSpirit("TEST-ATTACKER", 2000);

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? (id === ATTACKER.cardNo ? ATTACKER : undefined);

const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
};
const noTriggeredEffectLookups: typeof effectLookups = {
  ...effectLookups,
  getRegisteredTriggeredEffectActions: () => [],
};

function actionsFor(
  state: GameState,
  playerId: string,
  lookups: typeof effectLookups = effectLookups
) {
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById,
    ...lookups,
  });
}

/** flash_before_block を開いた直後 (最初の優先権 = 非アクティブ bob)。 */
function setupFlashBeforeBlock(includeSecondM02 = false): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(ATTACKER, {
        instanceId: "alice-attacker",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
        exhaustState: "exhausted",
      }),
      // alice: 手札に C02 (通常コスト) / 手元に X01 (コスト2固定)。
      createCardInstance(C02, {
        instanceId: "alice-c02",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(X01, {
        instanceId: "alice-x01",
        ownerPlayerId: "alice",
        zone: "set_aside",
      }),
      // bob: 手札に M02 (通常 + ターン1回コスト0)。
      createCardInstance(M02, {
        instanceId: "bob-m02",
        ownerPlayerId: "bob",
        zone: "hand",
      }),
      ...(includeSecondM02
        ? [
            createCardInstance(M02, {
              instanceId: "bob-m02-second",
              ownerPlayerId: "bob",
              zone: "hand",
            }),
          ]
        : []),
    ],
    playerOverrides: [
      { deckCount: 5, reserveNormalCoreCount: 5 },
      { deckCount: 5, reserveNormalCoreCount: 5 },
    ],
    battleEntities: [
      {
        entityId: "battle-entity:alice-attacker",
        memberInstanceIds: ["alice-attacker"],
        resolvedBp: 2000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-group:2:alice:battle-entity:alice-attacker",
      primaryEntityId: "battle-entity:alice-attacker",
      participantEntityIds: ["battle-entity:alice-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:alice-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:alice-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "bob",
        pendingStackAction: null,
      },
    },
  });
  return {
    ...base,
    step: "attack",
    window: "flash_before_block",
    activePlayerId: "alice",
    turnNumber: 2,
  };
}

function passBattleFlash(
  state: GameState,
  playerId: string,
  lookups: typeof effectLookups = effectLookups
): GameState {
  const pass = actionsFor(state, playerId, lookups).find(
    (a) => a.kind === "pass_battle_flash"
  );
  expect(pass).toBeDefined();
  return applyLegalAction({
    state,
    action: pass!,
    getCardDefinitionById,
    ...lookups,
  }).state;
}

describe("BSES01 ブレイヴ: フラッシュ『お互いのアタックステップ』自己召喚", () => {
  it("窓を開いた直後、非アクティブの bob が自分のブレイヴを通常コスト/コスト0 で召喚できる", () => {
    const state = setupFlashBeforeBlock();
    const bobActions = actionsFor(state, "bob");

    const handEffects = bobActions.filter(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "bob-m02"
    ) as Array<
      Extract<(typeof bobActions)[number], { kind: "use_hand_card_effect" }>
    >;

    // 通常コスト召喚 (effectIndex 1) とターン1回コスト0 (effectIndex 2) の2モード。
    expect(handEffects.length).toBe(2);
    expect(handEffects.map((a) => a.effectIndex).sort()).toEqual([1, 2]);
    expect(handEffects.every((a) => a.sourceActivationZone === "hand")).toBe(
      true
    );
  });

  it("[board] BSES01-M02 のターン1回モードはコストを支払わずに召喚し、維持コア以外のリザーブを消費しない", () => {
    const state = setupFlashBeforeBlock();
    const freeSummon = actionsFor(state, "bob").find(
      (action) =>
        action.kind === "use_hand_card_effect" &&
        action.sourceInstanceId === "bob-m02" &&
        action.effectIndex === 2
    );
    expect(freeSummon).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: freeSummon!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    const resolved = finishCoreChoices(
      passBattleFlash(declared, "alice"),
      getCardDefinitionById,
      effectLookups
    );

    expect(
      resolved.cardInstances.find((card) => card.instanceId === "bob-m02")
    ).toMatchObject({ zone: "field" });
    // BSES01-T01 のLv1維持コア1個のみをリザーブから配置する。
    expect(
      resolved.players.find((player) => player.id === "bob")
        ?.reserveNormalCoreCount
    ).toBe(4);
  });

  it("[board] BSES01-M02 の無料召喚枠は同名の別個体で共有し、通常コスト経路は残る", () => {
    const initial = setupFlashBeforeBlock(true);
    const initialActions = actionsFor(initial, "bob", noTriggeredEffectLookups);
    const freeSummon = initialActions.find(
      (action) =>
        action.kind === "use_hand_card_effect" &&
        action.sourceInstanceId === "bob-m02" &&
        action.effectIndex === 2
    ) as
      | Extract<
          (typeof initialActions)[number],
          { kind: "use_hand_card_effect" }
        >
      | undefined;
    expect(freeSummon).toBeDefined();

    // 宣言からスタック解決まで実行する。usageLimit の記録を直接注入せず、
    // 無料経路が実際に同名共有の台帳を消費することを確認する。
    const afterFree = passBattleFlash(
      applyLegalAction({
        state: initial,
        action: freeSummon!,
        getCardDefinitionById,
        ...noTriggeredEffectLookups,
      }).state,
      "alice",
      noTriggeredEffectLookups
    );
    const freePlacement = actionsFor(
      afterFree,
      "bob",
      noTriggeredEffectLookups
    ).find((action) => action.kind === "resolve_pending_multi_placement");
    expect(freePlacement).toBeDefined();
    const afterFreePlacement = finishCoreChoices(
      afterFree,
      getCardDefinitionById,
      noTriggeredEffectLookups
    );
    expect(
      afterFreePlacement.cardInstances.find(
        (card) => card.instanceId === "bob-m02"
      )
    ).toMatchObject({ zone: "field" });
    expect(afterFreePlacement.effectUsageRecords).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: M02.cardNo,
        effectLabel: `hand_activated:${freeSummon!.registrationIndex}`,
        count: 1,
      })
    );

    // 無料効果の解決後に優先権が alice なら、通常のフラッシュ pass で bob に戻す。
    const state =
      afterFreePlacement.activeAttack?.flashWindowState?.priorityPlayerId ===
      "alice"
        ? passBattleFlash(afterFreePlacement, "alice", noTriggeredEffectLookups)
        : afterFreePlacement;
    expect(state.activeAttack?.flashWindowState?.priorityPlayerId).toBe("bob");

    const secondActions = actionsFor(state, "bob", noTriggeredEffectLookups);
    const secondModes = secondActions.filter(
      (action) =>
        action.kind === "use_hand_card_effect" &&
        action.sourceInstanceId === "bob-m02-second"
    ) as Array<
      Extract<(typeof secondActions)[number], { kind: "use_hand_card_effect" }>
    >;
    expect(secondModes.map((action) => action.effectIndex)).toEqual([1]);

    const afterPaid = finishCoreChoices(
      passBattleFlash(
        applyLegalAction({
          state,
          action: secondModes[0]!,
          getCardDefinitionById,
          ...noTriggeredEffectLookups,
          summonPaymentSources: [{ kind: "reserve", amount: 3 }],
        }).state,
        "alice",
        noTriggeredEffectLookups
      ),
      getCardDefinitionById,
      noTriggeredEffectLookups
    );
    expect(
      afterPaid.cardInstances.find(
        (card) => card.instanceId === "bob-m02-second"
      )
    ).toMatchObject({ zone: "field" });
    expect(
      afterPaid.players.find((player) => player.id === "bob")
        ?.reserveNormalCoreCount
    ).toBe(0);
  });

  it("優先権が移った後、alice は手札(通常コスト)と手元(コスト2固定)の双方を召喚できる", () => {
    const afterBobPass = passBattleFlash(setupFlashBeforeBlock(), "bob");
    expect(afterBobPass.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );

    const aliceActions = actionsFor(afterBobPass, "alice");

    const c02 = aliceActions.find(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "alice-c02"
    ) as
      | Extract<(typeof aliceActions)[number], { kind: "use_hand_card_effect" }>
      | undefined;
    const x01 = aliceActions.find(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "alice-x01"
    ) as
      | Extract<(typeof aliceActions)[number], { kind: "use_hand_card_effect" }>
      | undefined;

    expect(c02).toMatchObject({
      effectIndex: 1,
      sourceActivationZone: "hand",
    });
    expect(x01).toMatchObject({
      effectIndex: 1,
      sourceActivationZone: "set_aside",
    });
  });

  it("召喚宣言で対象カードが in_use へ移り、コスト支払いは窓後に行われる (手元からのコスト2召喚)", () => {
    const afterBobPass = passBattleFlash(setupFlashBeforeBlock(), "bob");
    const x01 = actionsFor(afterBobPass, "alice").find(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "alice-x01"
    )!;

    const applied = applyLegalAction({
      state: afterBobPass,
      action: x01,
      getCardDefinitionById,
      ...effectLookups,
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
    }).state;

    expect(
      applied.cardInstances.find((c) => c.instanceId === "alice-x01")?.zone
    ).toBe("in_use");
    expect(
      applied.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(5);
    expect(
      applied.activeAttack?.flashWindowState.pendingStackAction
    ).toMatchObject({
      actionKind: "hand_card_effect",
      handActivatedEffectIndex: 1,
      sourceActivationZone: "set_aside",
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
    });

    const resolved = finishCoreChoices(
      passBattleFlash(applied, "bob"),
      getCardDefinitionById,
      effectLookups
    );
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "alice-x01")?.zone
    ).toBe("field");
    // P3-138: X01 は relatedTokenCardNos:["BSES01-T01"] を持つ系統「８６」ブレイヴなので、
    // この解決で M1A4 トークンが自動的に場へ出て、その維持コア(Lv1
    // requiredCores:1) がリザーブから自動配置される。5(初期) - 2(X01コスト) - 1(トークン
    // 維持コア) = 2。
    expect(
      resolved.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(2);
    expect(
      resolved.cardInstances.some((c) => c.definitionId === "BSES01-T01")
    ).toBe(true);
  });

  it("timingScope 外 (メインステップ) では手札起動効果は提示されない", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(C02, {
          instanceId: "alice-c02",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });
    const mainState: GameState = {
      ...base,
      step: "main",
      activePlayerId: "alice",
    };
    const actions = actionsFor(mainState, "alice");
    expect(
      actions.some(
        (a) =>
          a.kind === "use_hand_card_effect" &&
          a.sourceInstanceId === "alice-c02"
      )
    ).toBe(false);
  });
});
