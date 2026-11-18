/**
 * 回帰: フラッシュ本体 (flash_before_block) で非アクティブプレイヤーがパスして
 * 優先権がアクティブプレイヤーに移った後、アクティブプレイヤーが自分の
 * 『お互いのアタックステップ』flash 効果 (BSTH01-X04 / BSTH01-R21) を起動できること。
 *
 * バグ: usePassBattleFlashAsAction の 2-pass 優先権移譲が
 * transferResponseWindowPriority で priorityPlayerId のみ更新し
 * stackResponseSourcePlayerId を据え置いていたため、
 * getResponseWindowActionTimings がアクティブプレイヤーに "stack" timing を返し、
 * timing:"flash" の自フィールド flash 効果が legal-action から除外されていた。
 *
 * ルール根拠: 20_design/08_stack-window-and-priority-loop.md §4
 *   「nonActive passes → passCount=1, active priority → active uses flash」
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  backfillOptionalStateFields,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const フランドール = cardNoMap.get("BSTH01-X04")!;
const 紅魔館 = cardNoMap.get("BSTH01-R21")!;

// bob の破壊対象 (BP3000 — X04 ≤10000 / R21 ≤5000 の両方に合致) と
// alice のアタッカーは挙動に依存しない最小スピリットで用意する。
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
const BOB_TARGET = makeSimpleSpirit("TEST-BOB-TARGET", 3000);

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ??
  (id === ATTACKER.cardNo
    ? ATTACKER
    : id === BOB_TARGET.cardNo
      ? BOB_TARGET
      : undefined);

const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

/**
 * flash_before_block を開いた直後の状態 (最初の優先権 = 非アクティブ bob)。
 * alice (アクティブ) のフィールドに X04 / R21 flash 源、bob のフィールドに破壊対象を置く。
 */
function setupFlashBeforeBlock(): GameState {
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
      createCardInstance(フランドール, {
        instanceId: "alice-flan",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 3, // Lv2 (>=1 でも可); pay_cost 用に余裕を持たせる
      }),
      createCardInstance(紅魔館, {
        instanceId: "alice-kohmakan",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0, // R21 Lv1 は requiredCores:0 → Lv1 で flash 有効
      }),
      createCardInstance(BOB_TARGET, {
        instanceId: "bob-target",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
    playerOverrides: [{ deckCount: 5 }, { deckCount: 5 }],
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
      // 窓を開いた直後: 最初の優先権は非アクティブ bob。
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

describe("battle flash: 非アクティブのパス後にアクティブプレイヤーが flash を使える", () => {
  it("bob がパスすると優先権と stackResponseSourcePlayerId が alice に移る", () => {
    const state = setupFlashBeforeBlock();

    const bobActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...effectLookups,
    });
    const bobPass = bobActions.find((a) => a.kind === "pass_battle_flash");
    expect(bobPass).toBeDefined();

    const afterPass = applyLegalAction({
      state,
      action: bobPass!,
      getCardDefinitionById,
      ...effectLookups,
    });

    const flash = afterPass.state.activeAttack?.flashWindowState;
    expect(flash?.priorityPlayerId).toBe("alice");
    // 修正の核心: 優先権を得たプレイヤーが新 flash 宣言者として追従する。
    expect(flash?.stackResponseSourcePlayerId).toBe("alice");
    expect(flash?.consecutivePassCount).toBe(1);
    expect(flash?.pendingStackAction).toBeNull();
  });

  it("パス後、alice の X04 / R21 flash 効果が legal action に現れる", () => {
    const state = setupFlashBeforeBlock();
    const bobActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      ...effectLookups,
    });
    const afterPass = applyLegalAction({
      state,
      action: bobActions.find((a) => a.kind === "pass_battle_flash")!,
      getCardDefinitionById,
      ...effectLookups,
    });

    const aliceActions = getLegalActions({
      state: afterPass.state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    });

    const isFlashFieldEffect = (a: LegalAction, sourceInstanceId: string) =>
      a.kind === "use_field_card_effect" &&
      a.sourceInstanceId === sourceInstanceId &&
      a.registrationIndex === 0 &&
      a.timing === "flash";

    expect(aliceActions.some((a) => isFlashFieldEffect(a, "alice-flan"))).toBe(
      true
    );
    expect(
      aliceActions.some((a) => isFlashFieldEffect(a, "alice-kohmakan"))
    ).toBe(true);
  });

  it("alice も続けてパスすると 2 連続パスで flash 窓が閉じる", () => {
    const state = setupFlashBeforeBlock();
    const afterBobPass = applyLegalAction({
      state,
      action: getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById,
        ...effectLookups,
      }).find((a) => a.kind === "pass_battle_flash")!,
      getCardDefinitionById,
      ...effectLookups,
    });

    const alicePass = getLegalActions({
      state: afterBobPass.state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    }).find((a) => a.kind === "pass_battle_flash");
    expect(alicePass).toBeDefined();

    const afterAlicePass = applyLegalAction({
      state: afterBobPass.state,
      action: alicePass!,
      getCardDefinitionById,
      ...effectLookups,
    });

    // 2 連続パスで before_block の flash 窓は完了する。
    expect(afterAlicePass.state.window).not.toBe("flash_before_block");
  });

  it("backfillOptionalStateFields が旧セーブの stale flash source を修復し、ロード後すぐ alice の flash 効果が出る", () => {
    // 旧バグ期に保存された state: 優先権は alice に移っているが source が bob のまま。
    // backfillOptionalStateFields はスナップショット import と PvP ルーム DB 復元
    // (game-api getRoom) の双方が通る共通チョークポイント。
    const base = setupFlashBeforeBlock();
    const staleState: GameState = {
      ...base,
      activeAttack: {
        ...base.activeAttack!,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 1,
          stackResponseSourcePlayerId: "bob", // ← stale
          pendingStackAction: null,
        },
      },
    };

    const healed = backfillOptionalStateFields(staleState);

    // source が優先権者 (alice) へ修復される。
    expect(
      healed.activeAttack?.flashWindowState?.stackResponseSourcePlayerId
    ).toBe("alice");

    // ロード直後に alice の X04 flash 効果が legal action に出る。
    const aliceActions = getLegalActions({
      state: healed,
      actingPlayerId: "alice",
      getCardDefinitionById,
      ...effectLookups,
    });
    expect(
      aliceActions.some(
        (a) =>
          a.kind === "use_field_card_effect" &&
          a.sourceInstanceId === "alice-flan" &&
          a.timing === "flash"
      )
    ).toBe(true);

    // 冪等: 修正後に保存された state (source=priority) は素通り。
    const alreadyHealed = backfillOptionalStateFields(healed);
    expect(
      alreadyHealed.activeAttack?.flashWindowState?.stackResponseSourcePlayerId
    ).toBe("alice");
  });
});
