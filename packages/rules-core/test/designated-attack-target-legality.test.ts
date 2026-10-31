/**
 * 指定アタック (10_rules/05b §指定アタック 重要制約):
 * 「ブロックできない」対象には指定できない。装甲/超重装甲などの
 * 「相手の[色]の効果を受けない」対象にも指定できない (ENGINE-designated-attack-armor-guard、
 * needs-ruling.jsonl 26番、2026-07-11確定 — 公式FAQ複数件 (BS52 Q20739 / BS64 Q10516 等) が
 * 示す「専用の無効化文言が無い限り指定アタックは装甲で防げる」パターンに基づく)。
 *
 * BSES01-C02 (「スピリット状態のこのブレイヴはアタック/ブロックできない」= prevent_battle_both CE)
 * を指定アタック対象に選んだ場合、宣言時ガード (isDesignatedAttackTargetLegal) が働き、
 * 通常アタック (target.kind: "player") にフォールバックすることを検証する。
 * (designated-attack-primitive cluster: engine 側は既に useAttackAsAction /
 * maybeFinalizeDesignatedAttackAfterPendingReactions / confirmBlockDeclarationAsAction /
 * legal-actions-availability の4箇所で対象を選べたが、いずれも「ブロック不可」ガードが
 * 未実装だったバグ修正)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  confirmAttackDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  useAttackAsAction,
  usePassPreDeclarationStackAsAction,
  isDesignatedAttackTargetLegal,
} from "../src";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function makeSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe: "test",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

const ATTACKER = makeSpirit("TEST-DESIGNATED-ATTACKER");
const testCardMap = new Map<string, CardDefinition>([
  [ATTACKER.cardNo, ATTACKER],
]);
const getCardDefinitionById = (id: string) =>
  cardNoMap.get(id) ?? testCardMap.get(id);

// 「スピリット状態のこのブレイヴはアタック/ブロックできない」を持つ BSES01 導界者ブレイヴ。
const BRAVE_NO = "BSES01-C02";

describe("指定アタック: ブロック不可対象への指定ガード", () => {
  const brave = cardNoMap.get(BRAVE_NO)!;

  function buildState(): GameState {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(ATTACKER, {
          instanceId: "attacker-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(brave, {
          instanceId: "brave-1",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
        }),
      ],
    };
    return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
  }

  it("isDesignatedAttackTargetLegal: prevent_battle_both CE を持つ対象は不可と判定される", () => {
    const state = buildState();
    const attackerCard = state.cardInstances.find(
      (c) => c.instanceId === "attacker-1"
    )!;
    const targetCard = state.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    )!;
    expect(
      isDesignatedAttackTargetLegal(
        state,
        targetCard,
        getCardDefinitionById,
        attackerCard
      )
    ).toBe(false);
  });

  it("isDesignatedAttackTargetLegal: 通常のスピリット(制約なし)は指定可能と判定される", () => {
    const state = buildState();
    const attackerAsTargetCandidate = state.cardInstances.find(
      (c) => c.instanceId === "attacker-1"
    )!;
    expect(
      isDesignatedAttackTargetLegal(
        state,
        attackerAsTargetCandidate,
        getCardDefinitionById,
        undefined
      )
    ).toBe(true);
  });

  it("宣言〜確定を通しても、指定先がブロック不可対象なら通常アタック(player target)にフォールバックする", () => {
    const state = buildState();
    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      targetInstanceId: "brave-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: "bob",
    });
    const result = confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById }
    );

    expect(result.state.activeAttack).not.toBeNull();
    expect(result.state.activeAttack!.target).toEqual({
      kind: "player",
      playerId: "bob",
    });
    expect(
      result.state.activeAttack!.designatedTargetInstanceId
    ).toBeUndefined();
  });
});

describe("指定アタック: 装甲(相手の[色]の効果を受けない)による指定ガード (ENGINE-designated-attack-armor-guard)", () => {
  const TARGET = makeSpirit("TEST-DESIGNATED-TARGET-ARMORED");
  const armorTestCardMap = new Map<string, CardDefinition>([
    [ATTACKER.cardNo, ATTACKER],
    [TARGET.cardNo, TARGET],
  ]);
  const getArmorTestCardDefinitionById = (id: string) =>
    cardNoMap.get(id) ?? armorTestCardMap.get(id);

  /** 「相手の[color]の効果を受けない」= immunitySourceScope.colors 付き defense_immune CE。 */
  function armorCE(
    targetInstanceId: string,
    colors: readonly string[]
  ): ContinuousEffect {
    return {
      effectId: `armor-${targetInstanceId}`,
      sourceInstanceId: targetInstanceId,
      sourceDefinitionId: TARGET.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId,
      immunitySourceScope: { colors },
    };
  }

  function buildArmoredState(armorColors: readonly string[]): GameState {
    return {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(ATTACKER, {
          instanceId: "attacker-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(TARGET, {
          instanceId: "target-1",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
      activeContinuousEffects: [armorCE("target-1", armorColors)],
    };
  }

  it("isDesignatedAttackTargetLegal: attacker と同色の装甲(受けない)を持つ対象は不可と判定される", () => {
    // ATTACKER は yellow。target-1 の装甲スコープも yellow なので、attacker 起因の
    // 「指定アタック」は装甲でブロックされる (デフォルト = 専用無効化文言が無い限り防げる)。
    const state = buildArmoredState(["yellow"]);
    const attackerCard = state.cardInstances.find(
      (c) => c.instanceId === "attacker-1"
    )!;
    const targetCard = state.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;
    expect(
      isDesignatedAttackTargetLegal(
        state,
        targetCard,
        getArmorTestCardDefinitionById,
        attackerCard
      )
    ).toBe(false);
  });

  it("isDesignatedAttackTargetLegal: attacker と異なる色の装甲は指定アタックをブロックしない", () => {
    // target-1 の装甲スコープは blue。attacker (yellow) 起因の指定アタックはスコープ外なので通る。
    const state = buildArmoredState(["blue"]);
    const attackerCard = state.cardInstances.find(
      (c) => c.instanceId === "attacker-1"
    )!;
    const targetCard = state.cardInstances.find(
      (c) => c.instanceId === "target-1"
    )!;
    expect(
      isDesignatedAttackTargetLegal(
        state,
        targetCard,
        getArmorTestCardDefinitionById,
        attackerCard
      )
    ).toBe(true);
  });

  it("宣言〜確定を通しても、指定先が同色装甲対象なら通常アタック(player target)にフォールバックする", () => {
    const state = buildArmoredState(["yellow"]);
    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      targetInstanceId: "target-1",
      getCardDefinitionById: getArmorTestCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: "bob",
    });
    const result = confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: getArmorTestCardDefinitionById }
    );

    expect(result.state.activeAttack).not.toBeNull();
    expect(result.state.activeAttack!.target).toEqual({
      kind: "player",
      playerId: "bob",
    });
    expect(
      result.state.activeAttack!.designatedTargetInstanceId
    ).toBeUndefined();
  });
});

describe("指定アタック: attackDeclarationLog へのライフ宣言時スナップショット記録 (BSAZ02-M01 型 attack_occurred.targetControllerLifeAtDeclaration の SSOT)", () => {
  const TARGET = makeSpirit("TEST-DESIGNATED-TARGET-LIFE-SNAPSHOT");
  const lifeTestCardMap = new Map<string, CardDefinition>([
    [ATTACKER.cardNo, ATTACKER],
    [TARGET.cardNo, TARGET],
  ]);
  const getLifeTestCardDefinitionById = (id: string) =>
    cardNoMap.get(id) ?? lifeTestCardMap.get(id);

  function buildState(bobLifeCores: number): GameState {
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{}, { lifeNormalCoreCount: bobLifeCores }],
      }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(ATTACKER, {
          instanceId: "attacker-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(TARGET, {
          instanceId: "target-1",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };
  }

  it("宣言成立時点の対象カードコントローラー(bob)のライフを attackDeclarationLog にスナップショットする", () => {
    const state = buildState(1);
    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      targetInstanceId: "target-1",
      getCardDefinitionById: getLifeTestCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: "bob",
    });
    const result = confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: getLifeTestCardDefinitionById }
    );

    expect(result.state.activeAttack!.designatedTargetInstanceId).toBe(
      "target-1"
    );
    const entry = result.state.attackDeclarationLog.find(
      (e) => e.designatedTargetInstanceId === "target-1"
    );
    expect(entry).toBeDefined();
    expect(entry!.designatedTargetControllerLifeAtDeclaration).toBe(1);
  });

  it("bob のライフが2枚のとき、スナップショットも2として記録される (宣言後の変化とは独立して評価できる元データ)", () => {
    const state = buildState(2);
    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      targetInstanceId: "target-1",
      getCardDefinitionById: getLifeTestCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: "bob",
    });
    const result = confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: getLifeTestCardDefinitionById }
    );

    const entry = result.state.attackDeclarationLog.find(
      (e) => e.designatedTargetInstanceId === "target-1"
    );
    expect(entry!.designatedTargetControllerLifeAtDeclaration).toBe(2);
  });
});
