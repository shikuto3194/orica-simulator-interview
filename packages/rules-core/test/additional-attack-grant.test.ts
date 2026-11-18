/**
 * additional_attack primitive (ENGINE-additional-attack-mid-declare-attack-window-risk 修正)。
 *
 * `card_event:"attack"` は declare_attack 窓内 (現在のバトルが block 未確定) で解決される
 * (10_rules/02:137-140)。旧実装の `executeAdditionalAttack` はここで `activeAttack:null` に
 * 即リセットしており、進行中のバトルが block/解決へ進めず静かに破棄されるバグがあった
 * (designated-attack-primitive cluster 調査中に発見、BSKB01-C01/BSFT01-X01[7,8] の
 * 「この効果発揮後、このスピリットは〜に指定してアタックできる」stub 解消を試みて遭遇)。
 *
 * 修正後は additional_attack 実行時に現在のバトルをそのまま維持し、代わりに
 * 共通の使用会計 (`effectAccounting.grants`) へ一回限りの権利を付与する (P3-170 I11)。
 * 権利を持つカードは exhaustState チェックをバイパスしてアタック宣言でき、
 * 宣言確定時に権利を1つ行使する。権利の個数は台帳から導出した値で確認する。
 */
import { describe, expect, it } from "vitest";
import {
  confirmAttackDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  useAttackAsAction,
  usePassPreDeclarationStackAsAction,
} from "../src/index";
import { getAttackDeclarationBlockReason } from "../src/battle/battle-availability";
import { executeAdditionalAttack } from "../src/effect/structured-state-grants";
import type { CardDefinition, GameState } from "../src/index";
import {
  additionalAttackGrantCount,
  useAdditionalAttackGrant,
  withAdditionalAttackGrants,
} from "./helpers/battle-grant-fixture";

function makeSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
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

const ATTACKER_DEF = makeSpirit("TEST-AAG-ATTACKER");
const testCardMap = new Map<string, CardDefinition>([
  [ATTACKER_DEF.cardNo, ATTACKER_DEF],
]);
const getCardDefinitionById = (id: string) => testCardMap.get(id);

function buildInitialAttackState(): GameState {
  const state: GameState = {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step: "attack",
    cardInstances: [
      createCardInstance(ATTACKER_DEF, {
        instanceId: "attacker-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
  };
  return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
}

function declareAndConfirmAttack(state: GameState): GameState {
  const tentative = useAttackAsAction({
    state,
    actingPlayerId: "alice",
    sourceInstanceId: "attacker-1",
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
  return result.state;
}

describe("additional_attack: 進行中バトルの維持と grant 発行", () => {
  it("card_event:attack (declare_attack窓内、activeAttack在) で実行しても現在のバトルを破棄しない", () => {
    const declared = declareAndConfirmAttack(buildInitialAttackState());
    expect(declared.activeAttack).not.toBeNull();

    const afterAdditionalAttack = executeAdditionalAttack(
      declared,
      "alice",
      "attacker-1"
    );

    // 旧実装はここで activeAttack:null / window:"none" にリセットしていたため、
    // 進行中バトルが消滅していた。修正後は現在のバトルを維持する。
    expect(afterAdditionalAttack.activeAttack).toEqual(declared.activeAttack);
    expect(afterAdditionalAttack.step).toBe(declared.step);
    expect(afterAdditionalAttack.window).toBe(declared.window);
    expect(additionalAttackGrantCount(declared, "attacker-1")).toBe(0);
    expect(
      additionalAttackGrantCount(afterAdditionalAttack, "attacker-1")
    ).toBe(1);
  });
});

describe("additional_attack: grant による疲労状態バイパス", () => {
  function buildPostBattleState(
    grantCount: number,
    exhaustState: "recovered" | "exhausted" = "exhausted"
  ): GameState {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      window: "none",
      activeAttack: null,
      cardInstances: [
        createCardInstance(ATTACKER_DEF, {
          instanceId: "attacker-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          cores: 1,
          exhaustState,
        }),
      ],
    };
    return withAdditionalAttackGrants(
      rebuildContinuousEffectsFromField(state, getCardDefinitionById),
      "attacker-1",
      grantCount
    );
  }

  it("grant 無しの疲労スピリットは通常通りアタック宣言不可 (source_not_ready、ベースライン)", () => {
    const state = buildPostBattleState(0);
    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "attacker-1",
        getCardDefinitionById,
      })
    ).toBe("source_not_ready");
  });

  it("grant 有りの疲労スピリットはアタック宣言合法 (source_not_ready をバイパス)", () => {
    const state = buildPostBattleState(1);
    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "attacker-1",
        getCardDefinitionById,
      })
    ).toBeNull();
  });

  it("grant を使ってアタック宣言を確定すると grant を1つ消費し、疲労状態は維持される", () => {
    const state = buildPostBattleState(1);
    const declared = declareAndConfirmAttack(state);

    expect(declared.activeAttack).not.toBeNull();
    expect(additionalAttackGrantCount(state, "attacker-1")).toBe(1);
    expect(additionalAttackGrantCount(declared, "attacker-1")).toBe(0);
    expect(
      declared.cardInstances.find((c) => c.instanceId === "attacker-1")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("BSFT01-X01 型: grant を持つ回復状態のスピリットも次のアタック宣言で grant を消費する", () => {
    const state = buildPostBattleState(1, "recovered");
    const declared = declareAndConfirmAttack(state);

    expect(additionalAttackGrantCount(state, "attacker-1")).toBe(1);
    expect(additionalAttackGrantCount(declared, "attacker-1")).toBe(0);
    expect(
      declared.cardInstances.find((c) => c.instanceId === "attacker-1")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("grant を2つ持てば2回連続で疲労バイパスでき、使い切ると3回目は不可", () => {
    const state = buildPostBattleState(2);
    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "attacker-1",
        getCardDefinitionById,
      })
    ).toBeNull();

    // 実際の宣言確定で1つ行使される(残りは台帳から導出)。
    expect(
      additionalAttackGrantCount(declareAndConfirmAttack(state), "attacker-1")
    ).toBe(1);
    const afterFirstUse = useAdditionalAttackGrant(state, "attacker-1");
    expect(additionalAttackGrantCount(afterFirstUse, "attacker-1")).toBe(1);
    expect(
      getAttackDeclarationBlockReason({
        state: afterFirstUse,
        actingPlayerId: "alice",
        sourceInstanceId: "attacker-1",
        getCardDefinitionById,
      })
    ).toBeNull();

    const afterSecondUse = useAdditionalAttackGrant(
      afterFirstUse,
      "attacker-1"
    );
    expect(additionalAttackGrantCount(afterSecondUse, "attacker-1")).toBe(0);
    expect(
      getAttackDeclarationBlockReason({
        state: afterSecondUse,
        actingPlayerId: "alice",
        sourceInstanceId: "attacker-1",
        getCardDefinitionById,
      })
    ).toBe("source_not_ready");
  });
});
