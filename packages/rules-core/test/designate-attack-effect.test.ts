import { describe, expect, it } from "vitest";
import {
  confirmAttackDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  useAttackAsAction,
  usePassPreDeclarationStackAsAction,
  type CardDefinition,
  type Effect,
  type GameState,
} from "../src";
import { maybeFinalizeDesignatedAttackAfterPendingReactions } from "../src/legal/attack-burst-flow";

const definition: CardDefinition = {
  cardNo: "audit-designate-spirit",
  name: "指定アタック検証用スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const getDef = (id: string) =>
  id === definition.cardNo ? definition : undefined;
const effect: Effect = {
  timing: { kind: "card_event", event: "attack" },
  steps: [
    {
      action: {
        kind: "designate_attack",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit", "ultimate"] },
          count: 1,
        },
      },
    },
  ],
};
function declared(): GameState {
  const initial: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "attacker",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(definition, {
          instanceId: "target",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
        }),
      ],
    }),
    activePlayerId: "alice",
    step: "attack",
  };
  const pending = useAttackAsAction({
    state: initial,
    actingPlayerId: "alice",
    sourceInstanceId: "attacker",
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
  const passed = usePassPreDeclarationStackAsAction({
    state: pending,
    actingPlayerId: "bob",
  });
  return confirmAttackDeclarationAsAction(passed.closedWindow!, passed.state, {
    getCardDefinitionById: getDef,
  }).state;
}
function run(state: GameState, source = "attacker") {
  return executeEffect({
    chainId: "test:designate-attack-effect:86",
    state,
    effect,
    actingPlayerId: "alice",
    sourceInstanceId: source,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}
describe("効果解決中の指定アタック", () => {
  it("宣言済みのアタック先を指定し、疲労した相手の強制ブロックへ進む", () => {
    const before = declared();
    const after = run(before);
    expect(after.activeAttack?.designatedTargetInstanceId).toBe("target");
    expect(after.activeAttack?.primaryEntityId).toBe(
      before.activeAttack?.primaryEntityId
    );
    expect(after.pendingAdditionalAttackGrants).toEqual([]);
    const finalized = maybeFinalizeDesignatedAttackAfterPendingReactions(
      after,
      { getCardDefinitionById: getDef }
    );
    expect(finalized.preDeclarationStackWindow).toMatchObject({
      kind: "forced_block",
      sourceInstanceId: "target",
    });
  });
  it("攻撃者が離れた後は指定せず、追加アタックも与えない", () => {
    const before = declared();
    before.cardInstances = before.cardInstances.map((c) =>
      c.instanceId === "attacker"
        ? { ...c, zone: "trash", normalCoreCount: 0 }
        : c
    );
    const after = run(before);
    expect(after.activeAttack?.target.kind).toBe("player");
    expect(after.pendingAdditionalAttackGrants).toEqual([]);
  });
  it("相手がブロックできない場合は通常のアタックを維持する", () => {
    let state = declared();
    state = executeEffect({
      chainId: "test:designate-attack-effect:126",
      state,
      effect: {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["block"],
              duration: { scope: "turn" },
            },
          },
        ],
      },
      sourceInstanceId: "target",
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
    });
    const after = run(state);
    expect(after.activeAttack?.target.kind).toBe("player");
    expect(after.pendingAdditionalAttackGrants).toEqual([]);
  });
});
