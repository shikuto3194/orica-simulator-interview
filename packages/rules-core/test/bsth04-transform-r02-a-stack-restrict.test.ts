import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  useAttackAsAction,
} from "../src";
import { recomputeAndRebuildBattleStateContinuousEffects } from "../src/effect/continuous-effect-rebuild";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src/model";

const cards = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const nexus = cards.get("BSTH04-転醒R02(A)")!;
const attacker: CardDefinition = {
  ...cards.get("BSRK01-CX01")!,
  cardNo: "TEST-RAKUZOKU",
  name: "楽族テスト",
  tribe: "楽族",
  effects: [],
  keywordTags: [],
};
const unrelated: CardDefinition = {
  ...attacker,
  cardNo: "TEST-UNRELATED",
  tribe: "星竜",
};
const stackSource: CardDefinition = {
  ...attacker,
  cardNo: "TEST-STACK",
  tribe: "星竜",
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [{ action: { kind: "count_increase", amount: 1 } }],
    },
  ],
};
const defs = expandCardDefinitionsWithBackFaces([
  ...ALL_CARDS,
  attacker,
  unrelated,
  stackSource,
]);
const lookups = {
  getCardDefinitionById: (id: string) =>
    defs.find((card) => card.cardNo === id),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
};
const inst = (def: CardDefinition, id: string, player = "alice", cores = 1) =>
  createCardInstance(def, {
    instanceId: id,
    ownerPlayerId: player,
    controllerPlayerId: player,
    zone: "field",
    normalCoreCount: cores,
  });
function setup(): GameState {
  const robot = inst(cards.get("BSAZ02-TX01(A)")!, "robot", "bob", 3);
  robot.underCards = [
    {
      cardInstanceId: "drive",
      role: "text_role",
      roleTag: "アルドノアドライブ",
    },
  ];
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        inst(nexus, "sun"),
        inst(attacker, "a1"),
        inst(attacker, "a2"),
        inst(unrelated, "other"),
        inst(stackSource, "stack", "bob"),
        robot,
        { ...inst(attacker, "drive", "bob"), attachedToInstanceId: "robot" },
        { ...inst(cards.get("BSRK01-C06")!, "magic", "bob", 0), zone: "hand" },
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 20 },
        { reserveNormalCoreCount: 20, handCount: 1 },
      ],
    }),
    step: "attack",
    window: "none",
    activePlayerId: "alice",
    turnNumber: 2,
  };
}
function declare(state = setup(), id = "a1") {
  return useAttackAsAction({
    state,
    actingPlayerId: "alice",
    sourceInstanceId: id,
    ...lookups,
  });
}
function actions(state: GameState) {
  return getLegalActions({ state, actingPlayerId: "bob", ...lookups });
}
function canStack(state: GameState) {
  return actions(state).some(
    (a) => a.kind === "use_field_card_effect" && a.sourceInstanceId === "stack"
  );
}
function confirm(state: GameState, player = "bob") {
  const pass = getLegalActions({
    state,
    actingPlayerId: player,
    ...lookups,
  }).find((a) => a.kind === "pass_pre_declaration_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({ state, action: pass!, ...lookups }).state;
}

describe("太陽の畑: 宣言から有効な常時スタック制限", () => {
  it("最初の対象宣言の応答窓で既に禁止され、制限自体は誘発しない", () => {
    const state = declare();
    expect(state.preDeclarationStackWindow?.kind).toBe("attack");
    expect(canStack(state)).toBe(false);
    expect(actions(state).some((a) => a.kind === "use_magic")).toBe(false);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_stack"
      )
    ).toBe(true);
    const active = confirm(state);
    expect(active.activeAttack).not.toBeNull();
    expect(
      active.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_stack"
      )
    ).toBe(true);
    const ending = recomputeAndRebuildBattleStateContinuousEffects(
      {
        ...active,
        activeAttack: null,
        pendingBattleEndFinalizeAttackIds: [active.activeAttack!.attackId],
      },
      lookups.getCardDefinitionById
    );
    expect(
      ending.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_stack"
      )
    ).toBe(true);
  });

  it("対象系統全体で最初のバトルだけ。対象外の先行アタックは数えない", () => {
    const unrelatedWindow = declare(setup(), "other");
    expect(canStack(unrelatedWindow)).toBe(true);
    const afterOther = confirm(unrelatedWindow);
    const first = declare(
      { ...afterOther, activeAttack: null, window: "none", battleEntities: [] },
      "a1"
    );
    expect(canStack(first)).toBe(false);
    const firstBattle = confirm(first);
    const ended = recomputeAndRebuildBattleStateContinuousEffects(
      {
        ...firstBattle,
        activeAttack: null,
        window: "none",
        battleEntities: [],
      },
      lookups.getCardDefinitionById
    );
    expect(
      ended.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_stack"
      )
    ).toBe(false);
    expect(canStack(declare(ended, "a2"))).toBe(true);
  });

  it("効果で追加された楽族/冥主も対象系統として数える", () => {
    const state = setup();
    state.activeContinuousEffects = [
      {
        effectId: "granted-tribe",
        modifierTag: "override_properties",
        sourceInstanceId: "other",
        sourceDefinitionId: unrelated.cardNo,
        actingPlayerId: "alice",
        targetInstanceId: "other",
        duration: { scope: "turn" },
        createdAtTurn: 2,
        createdAtAttackId: null,
        metadata: { properties: { addTribes: ["冥主"] } },
      },
    ];
    const pending = declare(state, "other");
    expect(canStack(pending)).toBe(false);
    let active = confirm(pending);
    // 付与系統を失い、先行アタッカーが離場しても「最初の1回」は消費済み。
    active.activeContinuousEffects = active.activeContinuousEffects.filter(
      (ce) => ce.effectId !== "granted-tribe"
    );
    active.cardInstances = active.cardInstances.map((c) =>
      c.instanceId === "other" ? { ...c, zone: "trash" } : c
    );
    active = recomputeAndRebuildBattleStateContinuousEffects(
      active,
      lookups.getCardDefinitionById
    );
    expect(
      active.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_stack"
      )
    ).toBe(true);
    expect(
      canStack(
        declare(
          { ...active, activeAttack: null, window: "none", battleEntities: [] },
          "a1"
        )
      )
    ).toBe(true);
  });

  it.each(["level", "leave"] as const)(
    "常時効果なので発揮元の%s条件を失うと解除される",
    (change) => {
      const state = declare();
      const changed = {
        ...state,
        cardInstances: state.cardInstances.map((c) =>
          c.instanceId === "sun"
            ? {
                ...c,
                normalCoreCount: 0,
                ...(change === "leave" ? { zone: "trash" as const } : {}),
              }
            : c
        ),
      };
      const rebuilt = recomputeAndRebuildBattleStateContinuousEffects(
        changed,
        lookups.getCardDefinitionById
      );
      expect(canStack(rebuilt)).toBe(true);
    }
  );

  it("qa-024: ネクサス耐性のある発揮元はスタック効果を使用できる", () => {
    const state = declare();
    state.activeContinuousEffects = [
      ...state.activeContinuousEffects,
      {
        effectId: "immune",
        modifierTag: "defense_immune",
        sourceInstanceId: "stack",
        sourceDefinitionId: stackSource.cardNo,
        actingPlayerId: "bob",
        targetInstanceId: "stack",
        duration: { scope: "turn" },
        createdAtTurn: 2,
        createdAtAttackId: null,
        immunitySourceScope: { categories: ["nexus"] },
      },
    ];
    expect(canStack(state)).toBe(true);
  });

  it("スタックタイミングの転醒は使用でき、裏面へ移動する", () => {
    const state = declare();
    const rebirth = actions(state).find(
      (a) =>
        a.kind === "use_field_card_effect" && a.sourceInstanceId === "robot"
    );
    expect(rebirth).toBeDefined();
    const declared = applyLegalAction({
      state,
      action: rebirth!,
      ...lookups,
    }).state;
    const after = confirm(declared, "alice");
    expect(
      after.cardInstances.find((c) => c.instanceId === "robot")?.definitionId
    ).toBe("BSAZ02-TX01(B)");
  });

  it("Lv1では禁止せず、宣言中にLv2になると禁止が有効になる", () => {
    const initial = setup();
    initial.cardInstances.find((c) => c.instanceId === "sun")!.normalCoreCount =
      0;
    const state = declare(initial);
    expect(canStack(state)).toBe(true);
    state.cardInstances.find((c) => c.instanceId === "sun")!.normalCoreCount =
      1;
    const rebuilt = recomputeAndRebuildBattleStateContinuousEffects(
      state,
      lookups.getCardDefinitionById
    );
    expect(canStack(rebuilt)).toBe(false);
  });
});
