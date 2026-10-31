/**
 * BSAZ02-C13「超古代化学の発見」effects[0,1] 検証。
 *
 * 原文 (textLines[0,2,3]):
 *   〔ターンに1回：同名〕マジックカード以外の自分の白の効果でデッキからオープンされた/
 *   トラッシュに置かれたこのカードは手札に加えられる。
 *   メイン
 *   〔ターンに1回：同名〕自分のデッキを上から6枚オープンし、その中のカード名：
 *   「アルドノアドライブ」すべてと系統：「ＣＦ」持つアルティメットカード1枚を手札に加え、
 *   残ったカードはデッキの下に戻す。または、トラッシュにあるカード名：「アルドノアドライブ」
 *   1枚と系統：「ＣＦ」を持つアルティメットカード1枚を手札に戻す。
 *
 * 検証点:
 *  - effects[0]: BSES01-C01 / BSTH01-R12 / BSFT01-C02 precedent と同型
 *    (trigger_source_player/trigger_source_category/trigger_from_zone:deck) に
 *    trigger_colors:["white"] を加えた形。「デッキからオープンされたか、トラッシュに
 *    置かれた」は鍵/星霊デッキオープン置換裁定 (10_rules/07b) の一般形で両分岐とも
 *    デッキ由来限定が正源解釈 (adversarial verifier round2 で trigger_from_zone 全削除は
 *    refute された)。実行系 (move_self→hand) を検証する。
 *  - effects[1]: P3-14 choice DSL で二択を表現 (choice[0]=デフォルトのデッキ6枚オープン、
 *    choice[1]=トラッシュのアルドノアドライブ1枚回収)。「すべて」は revealCount と同じ
 *    count の pick 上限で表現 (構造検証のみ、deck_reveal 本体の pending flow は他所で
 *    検証済み)。choiceIndex:1 分岐は後続 step の stepCondition:ref_choice で
 *    ＣＦアルティメット1枚の追加回収に接続することを実行系で検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildMagicLookup,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../src/runtime";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  findMovedToTrashAutoEffect,
  type TriggerContext,
} from "../src/effect/structured-effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";

const C13 = card("BSAZ02-C13");
// 「アルドノアドライブ」実カード (BSAZ02-C10、名前完全一致フィクスチャ)。
const ALDNOAH_DRIVE = card("BSAZ02-C10");
// 系統：「ＣＦ」アルティメットのフィクスチャ (BSAZ02-C01)。
const CF_ULTIMATE = card("BSAZ02-C01");

describe("BSAZ02-C13 effects[0]（マジック以外の自分の白の効果でオープン/トラッシュ行き時、手札に加えられる）", () => {
  const effect = C13.effects![0]!;

  it("effect 定義: card_event(revealed/moved_to_trash) + trigger_source_player/category/colors/from_zone:deck", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["revealed", "moved_to_trash"],
    });
    expect(effect.cardEventDisposition).toEqual({
      kind: "move",
      destination: "hand",
    });
    expect(effect.condition).toEqual([
      { kind: "trigger_source_player", player: "self" },
      { kind: "trigger_source_category", exclude: ["magic"] },
      { kind: "trigger_colors", colors: ["white"] },
      { kind: "trigger_from_zone", zones: ["deck"] },
    ]);
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.executionMode).toBe("optional");
  });

  function setup() {
    const trashCard = createCardInstance(C13, {
      instanceId: "c13-trash-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [trashCard],
    });
    return { state, trashCard };
  }

  it("自分の白の効果由来(マジック以外・デッキ発)なら add_to_hand disposition が返る", () => {
    const ctx = setup();
    const triggerContext: TriggerContext = {
      sourceColors: ["white"],
      sourceCategory: "spirit",
      sourcePlayerId: ALICE,
      fromZone: "deck",
    };
    const found = findMovedToTrashAutoEffect(
      ctx.state,
      ctx.trashCard.instanceId,
      C13,
      getDef,
      triggerContext
    );
    expect(found).toBeDefined();
    expect(found!.kind).toBe("add_to_hand");
    expect(found!.executionMode).toBe("optional");
  });

  it("フィールドから破壊されてトラッシュ行き(fromZone:field)では発火しない (デッキ由来限定、trigger_from_zone:deck ゲート)", () => {
    const ctx = setup();
    const triggerContext: TriggerContext = {
      sourceColors: ["white"],
      sourceCategory: "spirit",
      sourcePlayerId: ALICE,
      fromZone: "field",
    };
    const found = findMovedToTrashAutoEffect(
      ctx.state,
      ctx.trashCard.instanceId,
      C13,
      getDef,
      triggerContext
    );
    expect(found).toBeUndefined();
  });

  it("白以外の色由来では発火しない (trigger_colors ゲート)", () => {
    const ctx = setup();
    const triggerContext: TriggerContext = {
      sourceColors: ["red"],
      sourceCategory: "spirit",
      sourcePlayerId: ALICE,
      fromZone: "deck",
    };
    const found = findMovedToTrashAutoEffect(
      ctx.state,
      ctx.trashCard.instanceId,
      C13,
      getDef,
      triggerContext
    );
    expect(found).toBeUndefined();
  });

  it("マジック由来では発火しない (trigger_source_category exclude:[magic])", () => {
    const ctx = setup();
    const triggerContext: TriggerContext = {
      sourceColors: ["white"],
      sourceCategory: "magic",
      sourcePlayerId: ALICE,
      fromZone: "deck",
    };
    const found = findMovedToTrashAutoEffect(
      ctx.state,
      ctx.trashCard.instanceId,
      C13,
      getDef,
      triggerContext
    );
    expect(found).toBeUndefined();
  });

  it("相手由来では発火しない (trigger_source_player)", () => {
    const ctx = setup();
    const triggerContext: TriggerContext = {
      sourceColors: ["white"],
      sourceCategory: "spirit",
      sourcePlayerId: BOB,
      fromZone: "deck",
    };
    const found = findMovedToTrashAutoEffect(
      ctx.state,
      ctx.trashCard.instanceId,
      C13,
      getDef,
      triggerContext
    );
    expect(found).toBeUndefined();
  });
});

describe("BSAZ02-C13 effects[1]（メイン: デッキ6枚オープンで回収 or トラッシュから回収の二択）", () => {
  const effect = C13.effects![1]!;

  it("effect 定義: activated(main) + choice構成 (choice[0]=deck_reveal、choice[1]=trash move_card→CFアルティメット追加回収)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "main" });
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.steps).toHaveLength(2);

    const modeStep = effect.steps[0]!;
    expect(modeStep.id).toBe("c13-mode");
    expect(modeStep.action.kind).toBe("deck_reveal");
    if (modeStep.action.kind === "deck_reveal") {
      expect(modeStep.action.revealCount).toBe(6);
      expect(modeStep.action.remainder).toBe("bottom");
      expect(modeStep.action.picks).toEqual([
        {
          count: 6,
          mandatory: true,
          filter: { cardName: { exact: "アルドノアドライブ" } },
        },
        {
          count: 1,
          mandatory: true,
          filter: { category: ["ultimate"], tribes: ["ＣＦ"] },
        },
      ]);
    }
    expect(modeStep.choice).toHaveLength(1);
    const trashChoice = modeStep.choice![0]!;
    expect(trashChoice.action.kind).toBe("move_card");
    if (trashChoice.action.kind === "move_card") {
      expect(trashChoice.action.from).toEqual({
        zone: "trash",
        player: "self",
        filter: { cardName: { exact: "アルドノアドライブ" } },
      });
      expect(trashChoice.action.to).toEqual({ zone: "hand" });
    }

    const followUpStep = effect.steps[1]!;
    expect(followUpStep.connector).toBe("sequential");
    expect(followUpStep.stepCondition).toEqual({
      kind: "ref_choice",
      stepId: "c13-mode",
      choiceIndex: 1,
    });
    expect(followUpStep.action.kind).toBe("move_card");
    if (followUpStep.action.kind === "move_card") {
      expect(followUpStep.action.from).toEqual({
        zone: "trash",
        player: "self",
        filter: { category: ["ultimate"], tribes: ["ＣＦ"] },
      });
    }
  });

  function setupTrashMode(): {
    state: GameState;
    c13Src: ReturnType<typeof createCardInstance>;
    drive: ReturnType<typeof createCardInstance>;
    ultimate: ReturnType<typeof createCardInstance>;
  } {
    const c13Src = createCardInstance(C13, {
      instanceId: "c13-src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const drive = createCardInstance(ALDNOAH_DRIVE, {
      instanceId: "drive-trash-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const ultimate = createCardInstance(CF_ULTIMATE, {
      instanceId: "cf-ultimate-trash-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [c13Src, drive, ultimate],
    });
    return { state, c13Src, drive, ultimate };
  }

  it("choiceIndex:1（トラッシュ回収モード）: アルドノアドライブ1枚 + ＣＦアルティメット1枚が両方手札に戻る", () => {
    const ctx = setupTrashMode();
    const after = executeEffect({
      chainId: "test:bsaz02-c13-ancient-chemistry:285",
      state: ctx.state,
      effect,
      sourceInstanceId: ctx.c13Src.instanceId,
      actingPlayerId: ALICE,
      choiceIndex: 1,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: [ctx.drive.instanceId, ctx.ultimate.instanceId],
      sequentialTargetConsumption: true,
      targetSelectionResolved: true,
    });
    const drive = after.cardInstances.find(
      (c) => c.instanceId === ctx.drive.instanceId
    )!;
    const ultimate = after.cardInstances.find(
      (c) => c.instanceId === ctx.ultimate.instanceId
    )!;
    expect(drive.zone).toBe("hand");
    expect(ultimate.zone).toBe("hand");
  });

  it("同ターンに二択をまたいで2回は使えず、別個体も use_magic に出ない", () => {
    const firstCopy = createCardInstance(C13, {
      instanceId: "c13-first",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const secondCopy = createCardInstance(C13, {
      instanceId: "c13-second",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const firstDrive = createCardInstance(ALDNOAH_DRIVE, {
      instanceId: "first-drive",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const firstUltimate = createCardInstance(CF_ULTIMATE, {
      instanceId: "first-ultimate",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const secondDrive = createCardInstance(ALDNOAH_DRIVE, {
      instanceId: "second-drive",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const secondUltimate = createCardInstance(CF_ULTIMATE, {
      instanceId: "second-ultimate",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          firstCopy,
          secondCopy,
          firstDrive,
          firstUltimate,
          secondDrive,
          secondUltimate,
        ],
        playerOverrides: [{ reserveNormalCoreCount: 6 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "main_step",
    };
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: () => undefined,
    };
    const initialActions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    });
    // EffectStep.choice の分岐は宣言 action には載らず、スタック窓を閉じてから
    // resolve_pending_step_choice で選ぶ。まずは別個体も通常どおり宣言候補であることを確認する。
    expect(
      initialActions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === secondCopy.instanceId
      )
    ).toBe(true);
    const firstAction = initialActions.find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === firstCopy.instanceId
    );
    expect(firstAction).toBeDefined();
    if (!firstAction || firstAction.kind !== "use_magic") return;

    const declared = applyLegalAction({
      state,
      action: firstAction,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      ...lookups,
    }).state;
    expect(declared.stackWindow).not.toBeNull();
    expect(declared.effectUsageRecords).toEqual([
      expect.objectContaining({
        sourceDefinitionId: C13.cardNo,
        effectLabel: "magic",
        duration: "turn",
        count: 1,
      }),
    ]);
    let settled = declared;
    for (let guard = 0; settled.stackWindow && guard < 4; guard += 1) {
      const pass = getLegalActions({
        state: settled,
        actingPlayerId: settled.stackWindow.priorityPlayerId,
        ...lookups,
      }).find((action) => action.kind === "pass_stack");
      expect(pass).toBeDefined();
      if (!pass) break;
      settled = applyLegalAction({
        state: settled,
        action: pass,
        ...lookups,
      }).state;
    }
    expect(settled.stackWindow).toBeNull();
    const choices = getLegalActions({
      state: settled,
      actingPlayerId: settled.pendingStepChoice?.choosingPlayerId ?? ALICE,
      ...lookups,
    }).filter((action) => action.kind === "resolve_pending_step_choice");
    expect(choices.map((action) => action.choiceIndex).sort()).toEqual([0, 1]);
    const trashRecovery = choices.find((action) => action.choiceIndex === 1);
    expect(trashRecovery).toBeDefined();
    if (!trashRecovery) return;
    let resolved = applyLegalAction({
      state: settled,
      action: trashRecovery,
      ...lookups,
    }).state;
    expect(resolved.pendingStepChoice).toBeNull();
    expect(resolved.stackWindow).toBeNull();
    // choice[1] 本体と ref_choice 後続の双方が対象を取る。宣言後に一組として
    // 選択され、各 step へ配分されることを確認する。
    expect(resolved.pendingEffectTargetSelection).not.toBeNull();
    expect(resolved.pendingEffectTargetSelection?.candidateInstanceIds).toEqual(
      expect.arrayContaining([firstDrive.instanceId, firstUltimate.instanceId])
    );
    expect(resolved.pendingEffectTargetSelection?.targetGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetStepId: "c13-mode" }),
        expect.objectContaining({ targetStepId: "__step_1" }),
      ])
    );
    const targetAction = getLegalActions({
      state: resolved,
      actingPlayerId:
        resolved.pendingEffectTargetSelection?.actingPlayerId ?? ALICE,
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_effect_target");
    expect(targetAction).toBeDefined();
    if (!targetAction) return;
    resolved = applyLegalAction({
      state: resolved,
      action: targetAction,
      targetInstanceIds: [firstDrive.instanceId, firstUltimate.instanceId],
      ...lookups,
    }).state;
    expect(resolved.step).toBe("main");
    expect(resolved.window).toBe("main_step");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === firstDrive.instanceId
      )?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === firstUltimate.instanceId
      )?.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === secondDrive.instanceId
      )?.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === secondUltimate.instanceId
      )?.zone
    ).toBe("trash");
    expect(
      getLegalActions({
        state: resolved,
        actingPlayerId: ALICE,
        ...lookups,
      }).some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === secondCopy.instanceId
      )
    ).toBe(false);
  });

  function setupDefaultMode(): {
    state: GameState;
    c13Src: ReturnType<typeof createCardInstance>;
    trashDrive: ReturnType<typeof createCardInstance>;
    trashUltimate: ReturnType<typeof createCardInstance>;
  } {
    const c13Src = createCardInstance(C13, {
      instanceId: "c13-src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    // choiceIndex:1 専用ステップが誤って発火しないことの確認用 (choiceIndex:0/未指定では
    // 動かないはず)。トラッシュに置いたままなら gate が効いている証拠。
    const trashDrive = createCardInstance(ALDNOAH_DRIVE, {
      instanceId: "drive-trash-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const trashUltimate = createCardInstance(CF_ULTIMATE, {
      instanceId: "cf-ultimate-trash-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    // revealCount:6 のデッキオープンを成立させるためのフィラー
    // (BSAZ02-M01: 「アルドノアドライブ」名でも系統：「ＣＦ」ultimateでもない)。
    const deckFillers = [0, 1, 2, 3, 4, 5].map((i) =>
      createCardInstance(card("BSAZ02-M01"), {
        instanceId: `deck-filler-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [c13Src, trashDrive, trashUltimate, ...deckFillers],
    });
    return { state, c13Src, trashDrive, trashUltimate };
  }

  it("choiceIndex:0（デフォルト/未指定）: デッキ6枚オープンの pendingDeckReveal が生成され、choiceIndex:1限定のトラッシュ回収stepは実行されない", () => {
    const ctx = setupDefaultMode();
    const after = executeEffect({
      chainId: "test:bsaz02-c13-ancient-chemistry:533",
      state: ctx.state,
      effect,
      sourceInstanceId: ctx.c13Src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(after.pendingDeckReveal).not.toBeNull();
    const drive = after.cardInstances.find(
      (c) => c.instanceId === ctx.trashDrive.instanceId
    )!;
    const ultimate = after.cardInstances.find(
      (c) => c.instanceId === ctx.trashUltimate.instanceId
    )!;
    expect(drive.zone).toBe("trash");
    expect(ultimate.zone).toBe("trash");
  });
});
