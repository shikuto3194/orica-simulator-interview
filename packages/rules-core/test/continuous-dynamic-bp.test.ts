/**
 * 継続 bp_modify の動的修飾量（modifierAmountDynamic）検証。
 *
 * 「自分のカウント1につき BP+1000」型の比例 *継続* BP 強化を、bp_modify の amount に
 * DynamicCount を載せて表現する。CE には modifierAmount（固定）ではなく
 * modifierAmountDynamic（DynamicCount）を保持し、getBpModifierTotal が BP 計算時に
 * 現在の盤面（カウント値など）で live 評価する（カウント変動に追従する）。
 *
 * 着地カード: BSDB01-X01 超サイヤ人3 孫悟空 [3,4] 前段。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  getEffectiveBp,
} from "../src";
import type { CardDefinition, ContinuousEffect } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { ALL_CARDS } from "../../card-data/src/generated-index";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

function spiritDef(
  cardNo = "TEST-S01",
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: "Test Spirit",
    printedCategory: "spirit",
    colors: ["red"],
    symbolColors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 3, bp: 5000 },
    ],
    textLines: [],
    keywordTags: [],
    tribe: "武装",
    ...overrides,
  } as CardDefinition;
}

function addTribeCE(
  targetInstanceId: string,
  addTribe: string
): ContinuousEffect {
  return {
    effectId: `ce-add-tribe-${targetInstanceId}-${addTribe}`,
    sourceInstanceId: "ce-add-tribe-source",
    sourceDefinitionId: "TEST-BP-PROVENANCE-ADD-TRIBE",
    actingPlayerId: "player-1",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties",
    targetInstanceId,
    metadata: { properties: { addTribes: [addTribe] } },
  };
}

describe("継続 bp_modify modifierAmountDynamic（count_value 比例）", () => {
  it("CE の modifierAmountDynamic を getEffectiveBp が live 評価する（カウント連動）", () => {
    const def = spiritDef();
    const fieldS = createCardInstance(def, {
      instanceId: "s1",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({ cardInstances: [fieldS] });
    const get = (id: string) => (id === def.cardNo ? def : undefined);

    // base BP at Lv1 (1 core) = 3000
    expect(getEffectiveBp(state, fieldS, def, get)).toBe(3000);

    // 「カウント1につき BP+1000」CE を付与
    const ce: ContinuousEffect = {
      effectId: "ce-dyn-bp-s1",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "SRC-001",
      actingPlayerId: "player-1",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "bp_modifier",
      modifierAmountDynamic: {
        source: { kind: "count_value", player: "self" },
        multiplier: 1000,
      },
      targetInstanceId: "s1",
    };
    state.activeContinuousEffects = [ce];

    // カウント 0 → +0
    expect(getEffectiveBp(state, fieldS, def, get)).toBe(3000);

    // カウント 3 → +3000（live 評価）
    state.players.find((p) => p.id === "player-1")!.countValue = 3;
    expect(getEffectiveBp(state, fieldS, def, get)).toBe(6000);

    // カウント 7 → +7000（同じ CE が追従）
    state.players.find((p) => p.id === "player-1")!.countValue = 7;
    expect(getEffectiveBp(state, fieldS, def, get)).toBe(10000);
  });

  it("「すべて」(count:-1) 動的フィルタ CE も modifierAmountDynamic を live 評価する", () => {
    const def = spiritDef("TEST-S02");
    const fieldS = createCardInstance(def, {
      instanceId: "s2",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({ cardInstances: [fieldS] });
    const get = (id: string) => (id === def.cardNo ? def : undefined);

    // グローバル（targetInstanceId 未設定 + targetFilter）CE
    const ce: ContinuousEffect = {
      effectId: "ce-dyn-bp-all",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "SRC-001",
      actingPlayerId: "player-1",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "bp_modifier",
      modifierAmountDynamic: {
        source: { kind: "count_value", player: "self" },
        multiplier: 1000,
      },
      targetFilter: { player: "self" },
    };
    state.activeContinuousEffects = [ce];

    state.players.find((p) => p.id === "player-1")!.countValue = 4;
    expect(getEffectiveBp(state, fieldS, def, get)).toBe(3000 + 4000);
  });

  it("外部 effectSourceDefinitionId 由来の CE は provider 系統で protectedCounts を評価する", () => {
    const hostDef = spiritDef("TEST-HOST-PROVIDER-COUNT", {
      tribe: "武装",
    });
    const providerDef = spiritDef("TEST-PROVIDER-COUNT", {
      tribe: "神喰",
    });
    const host = createCardInstance(hostDef, {
      instanceId: "host-provider-count",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      cardInstances: [host],
      playerOverrides: [{ countValue: 5, protectedCounts: { 神喰: 3 } }, {}],
    });
    const get = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === providerDef.cardNo
          ? providerDef
          : undefined;

    state.activeContinuousEffects = [
      {
        effectId: "ce-provider-count-bp",
        sourceInstanceId: host.instanceId,
        sourceDefinitionId: hostDef.cardNo,
        actingPlayerId: "player-1",
        duration: { scope: "while_on_field" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "bp_modifier",
        modifierAmountDynamic: {
          source: { kind: "count_value", player: "self" },
          multiplier: 1000,
        },
        targetInstanceId: host.instanceId,
        provenance: {
          effectIndex: 0,
          stepIndex: 0,
          effectSourceDefinitionId: providerDef.cardNo,
        },
      },
    ];

    expect(getEffectiveBp(state, host, hostDef, get)).toBe(3000 + 5000);
  });

  it("TEST-BP-PROVENANCE-HOST-PROVIDER: dynamic amount は provider instance の実効系統で protectedCounts を評価する", () => {
    const hostDef = spiritDef("TEST-BP-PROVENANCE-HOST", {
      name: "Host Source",
      printedCategory: "nexus",
      tribe: "地球",
    });
    const providerDef = spiritDef("TEST-BP-PROVENANCE-PROVIDER", {
      name: "Provider Source",
      printedCategory: "magic",
      tribe: "地球",
    });
    const targetDef = spiritDef("TEST-BP-PROVENANCE-TARGET");
    const host = createCardInstance(hostDef, {
      instanceId: "bob-host-provider",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const provider = createCardInstance(providerDef, {
      instanceId: "bob-provider",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
    });
    const target = createCardInstance(targetDef, {
      instanceId: "alice-target-provider-dynamic",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [host, provider, target],
      playerOverrides: [{}, { countValue: 5, protectedCounts: { 神喰: 3 } }],
    });
    state.activeContinuousEffects = [addTribeCE(provider.instanceId, "神喰")];
    const get = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === providerDef.cardNo
          ? providerDef
          : id === targetDef.cardNo
            ? targetDef
            : undefined;

    const after = executeEffect({
      chainId: "test:continuous-dynamic-bp:247",
      state,
      effect: {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: "all",
              },
              amount: {
                source: { kind: "count_value", player: "self" },
                multiplier: 1000,
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0],
      },
      sourceInstanceId: host.instanceId,
      effectSourceInstanceId: provider.instanceId,
      effectSourceDefinitionId: providerDef.cardNo,
      actingPlayerId: "player-2",
      getCardDefinitionById: get,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const targetAfter = after.cardInstances.find(
      (card) => card.instanceId === target.instanceId
    )!;

    expect(getEffectiveBp(after, targetAfter, targetDef, get)).toBe(
      3000 + 5000
    );
  });

  it('TEST-BP-PROVENANCE-CARDNAME-SELF: global BP modifier の cardName:"self" は provider definition で解決する', () => {
    const hostDef = spiritDef("TEST-BP-PROVENANCE-SELF-HOST", {
      name: "Host Source",
      printedCategory: "nexus",
    });
    const providerDef = spiritDef("TEST-BP-PROVENANCE-SELF-PROVIDER", {
      name: "Provider Source",
      printedCategory: "magic",
    });
    const targetDef = spiritDef("TEST-BP-PROVENANCE-SELF-TARGET", {
      name: "Provider Source",
    });
    const host = createCardInstance(hostDef, {
      instanceId: "bob-self-host",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const provider = createCardInstance(providerDef, {
      instanceId: "bob-self-provider",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
    });
    const target = createCardInstance(targetDef, {
      instanceId: "alice-self-target",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [host, provider, target],
    });
    const get = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === providerDef.cardNo
          ? providerDef
          : id === targetDef.cardNo
            ? targetDef
            : undefined;

    state.activeContinuousEffects = [
      {
        effectId: "ce-cardname-self-provider-bp",
        sourceInstanceId: host.instanceId,
        sourceDefinitionId: hostDef.cardNo,
        actingPlayerId: "player-2",
        duration: { scope: "while_on_field" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "bp_modifier",
        modifierAmount: 4000,
        targetFilter: {
          player: "opponent",
          category: ["spirit"],
          cardName: "self",
        },
        provenance: {
          effectIndex: 0,
          stepIndex: 0,
          effectSourceInstanceId: provider.instanceId,
          effectSourceDefinitionId: providerDef.cardNo,
        },
      },
    ];
    expect(getEffectiveBp(state, target, targetDef, get)).toBe(3000 + 4000);
  });

  it("TEST-BP-PROVENANCE-GATE: global BP modifier の affect gate は host ではなく provider identity で免疫判定する", () => {
    const hostDef = spiritDef("TEST-BP-PROVENANCE-GATE-HOST", {
      printedCategory: "nexus",
    });
    const providerDef = spiritDef("TEST-BP-PROVENANCE-GATE-PROVIDER", {
      printedCategory: "magic",
    });
    const targetDef = spiritDef("TEST-BP-PROVENANCE-GATE-TARGET");
    const host = createCardInstance(hostDef, {
      instanceId: "bob-gate-host",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
    });
    const provider = createCardInstance(providerDef, {
      instanceId: "bob-gate-provider",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
    });
    const target = createCardInstance(targetDef, {
      instanceId: "alice-gate-target",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [host, provider, target],
    });
    state.activeContinuousEffects = [
      {
        effectId: "ce-target-immune-to-magic",
        sourceInstanceId: target.instanceId,
        sourceDefinitionId: targetDef.cardNo,
        actingPlayerId: "player-1",
        duration: { scope: "while_on_field" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "defense_immune",
        targetInstanceId: target.instanceId,
        immunitySourceScope: { categories: ["magic"] },
      },
    ];
    const get = (id: string) =>
      id === hostDef.cardNo
        ? hostDef
        : id === providerDef.cardNo
          ? providerDef
          : id === targetDef.cardNo
            ? targetDef
            : undefined;

    const after = executeEffect({
      chainId: "test:continuous-dynamic-bp:413",
      state,
      effect: {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: "all",
              },
              amount: 4000,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0],
      },
      sourceInstanceId: host.instanceId,
      effectSourceInstanceId: provider.instanceId,
      effectSourceDefinitionId: providerDef.cardNo,
      actingPlayerId: "player-2",
      getCardDefinitionById: get,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const targetAfter = after.cardInstances.find(
      (card) => card.instanceId === target.instanceId
    )!;

    expect(getEffectiveBp(after, targetAfter, targetDef, get)).toBe(3000);
  });

  it("TEST-BP-PROVENANCE-BORROWED: borrowed BP modifier は借用元マジック定義の系統で dynamic amount を評価する", () => {
    const borrowerDef = spiritDef("TEST-BP-PROVENANCE-BORROWER");
    const donorDef = spiritDef("TEST-BP-PROVENANCE-BORROWED-MAGIC", {
      printedCategory: "magic",
      tribe: "神喰",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: "all",
                },
                amount: {
                  source: { kind: "count_value", player: "self" },
                  multiplier: 1000,
                },
                duration: { scope: "turn" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    });
    const targetDef = spiritDef("TEST-BP-PROVENANCE-BORROWED-TARGET");
    const borrower = createCardInstance(borrowerDef, {
      instanceId: "bob-borrower",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const donor = createCardInstance(donorDef, {
      instanceId: "bob-borrowed-magic",
      ownerPlayerId: "player-2",
      controllerPlayerId: "player-2",
      zone: "trash",
    });
    const target = createCardInstance(targetDef, {
      instanceId: "alice-borrowed-target",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["player-1", "player-2"],
      cardInstances: [borrower, donor, target],
      playerOverrides: [{}, { countValue: 5, protectedCounts: { 神喰: 3 } }],
    });
    const get = (id: string) =>
      id === borrowerDef.cardNo
        ? borrowerDef
        : id === donorDef.cardNo
          ? donorDef
          : id === targetDef.cardNo
            ? targetDef
            : undefined;

    const executed = executeEffect({
      chainId: "test:continuous-dynamic-bp:513",
      state,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "borrow_magic_effect",
              borrowModes: ["flash"],
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                filter: {
                  category: ["magic"],
                  hasActivatedEffectMode: ["flash"],
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [0],
      },
      sourceInstanceId: borrower.instanceId,
      actingPlayerId: "player-2",
      targetInstanceIds: [donor.instanceId],
      getCardDefinitionById: get,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const after = finalizeEffectResolution({
      state: executed,
      beforeState: state,
      chainId: "TEST-BP-PROVENANCE-BORROWED",
      endLogs: [],
      actingPlayerId: "player-2",
      getCardDefinitionById: get,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: borrower.instanceId,
    });
    const targetAfter = after.cardInstances.find(
      (card) => card.instanceId === target.instanceId
    )!;

    expect(getEffectiveBp(after, targetAfter, targetDef, get)).toBe(
      3000 + 5000
    );
  });
});

describe("BSDB01-X01 超サイヤ人3 孫悟空 [3,4]（カウント比例 BP + 破壊耐性）", () => {
  const c = card("BSDB01-X01");

  it("effects から BP-per-count の stub が除去されている", () => {
    // [3,4] 前段が bp_modify(count_value × 1000) として実装され stub が消えた
    const bpEffect = c.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 3 &&
        e.steps.some((s) => s.action.kind === "bp_modify")
    );
    expect(bpEffect).toBeDefined();
    expect(bpEffect!.stub).toBeUndefined();
    const action = bpEffect!.steps[0]!.action;
    expect(action.kind).toBe("bp_modify");
    if (action.kind === "bp_modify") {
      expect(action.target.count).toBe("all");
      expect(typeof action.amount).toBe("object");
      if (typeof action.amount === "object") {
        expect(action.amount.source).toEqual({
          kind: "count_value",
          player: "self",
        });
        expect(action.amount.multiplier).toBe(1000);
      }
    }
  });

  it("executeEffect で『孫悟空』に動的 BP CE が登録される（カウント連動）", () => {
    const def = c;
    const goku = createCardInstance(def, {
      instanceId: "goku-1",
      ownerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({ cardInstances: [goku] });
    const get = (id: string) => (id === def.cardNo ? def : undefined);

    const bpEffect = def.effects!.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef[0] === 3 &&
        e.steps.some((s) => s.action.kind === "bp_modify")
    )!;

    const after = executeEffect({
      chainId: "test:continuous-dynamic-bp:610",
      state,
      effect: bpEffect,
      sourceInstanceId: "goku-1",
      actingPlayerId: "player-1",
      getCardDefinitionById: get,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const dynCe = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(dynCe).toBeDefined();
    expect(dynCe!.modifierAmountDynamic).toBeDefined();
    expect(dynCe!.modifierAmount).toBeUndefined();

    const gokuAfter = after.cardInstances.find(
      (c2) => c2.instanceId === "goku-1"
    )!;
    // base BP Lv1 (1 core) = 9000、カウント 0 → 9000
    expect(getEffectiveBp(after, gokuAfter, def, get)).toBe(9000);
    // カウント 5 → 9000 + 5000 = 14000
    after.players.find((p) => p.id === "player-1")!.countValue = 5;
    expect(getEffectiveBp(after, gokuAfter, def, get)).toBe(14000);
  });
});
