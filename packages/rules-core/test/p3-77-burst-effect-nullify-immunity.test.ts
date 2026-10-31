/**
 * P3-77 Step B/C: 相手の「バースト効果を無効/発揮できない」(negate_opponent_burst) と
 * 対象バーストの defense_immune(受けない) の優先解決。
 *
 * 裁定 [03b:25]: 防げない > 受けない > 発揮できない。「無効」「発揮できない」は
 * 「防げない」ではないため、受けない を持つバーストには勝てない。
 * → BSTH01-X07 の節①/節②(defense_immune) を持つ自身のバースト効果は無効化/発揮禁止されない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  isBurstEffectNullifiedByOpponent,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const cardMap = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getCardDefinitionById = (id: string) => cardMap.get(id);
const X07 = getCardDefinitionById("BSTH01-X07")!;

const lookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};

/** bob が「相手(alice)のバースト効果を無効にする」CE。 */
function bobNullifyBurstCE(): ContinuousEffect {
  return {
    effectId: "nob-bob",
    sourceInstanceId: "bob-src",
    sourceDefinitionId: "BSTH09.2-転醒R03",
    actingPlayerId: "bob",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "negate_opponent_burst",
  };
}

/**
 * x07 を守る発動中(節②)窓免疫 CE。発動成立〜解決後を覆う defense_immune は
 * metadata.burstActivationWindow を持ち、無効/発揮できない 両方を回避する。
 * セット束縛(節①)の defense_immune とは異なり、発揮(解決)時点でも有効。
 */
function x07WindowImmunityCE(): ContinuousEffect {
  return {
    effectId: "di-x07",
    sourceInstanceId: "x07",
    sourceDefinitionId: "BSTH01-X07",
    actingPlayerId: "alice",
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId: "x07",
    metadata: { burstActivationWindow: "c1" },
  };
}

/** セット束縛(節①)の defense_immune。発揮時点では回避源にならない (BSTH01-M13 型)。 */
function setBoundImmunityCE(): ContinuousEffect {
  return {
    effectId: "di-setbound",
    sourceInstanceId: "x07",
    sourceDefinitionId: "BSTH01-M13",
    actingPlayerId: "alice",
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId: "x07",
  };
}

/** bob が「相手のバースト効果を発揮できない」CE (cannot_activate)。 */
function bobCannotActivateBurstCE(): ContinuousEffect {
  return {
    ...bobNullifyBurstCE(),
    effectId: "cab-bob",
    metadata: { burstSuppressKind: "cannot_activate" },
  };
}

function baseScenario(def: CardDefinition, ces: ContinuousEffect[]): GameState {
  const burst = createCardInstance(def, {
    instanceId: "x07",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "bob",
    step: "attack",
    cardInstances: [burst],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "x07" }],
    activeContinuousEffects: ces,
    pendingBurstChecks: [
      {
        checkId: "c1",
        actingPlayerId: "alice",
        eventKind: "reduce_life",
        event: { family: "life", validationMode: "snapshot_only" },
        source: "action_resolution",
        chainId: "test:p3-77-burst-effect-nullify-immunity:112",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: null,
        amount: 1,
        step: "attack",
        window: "flash_before_block",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
}

function resolveBurst(state: GameState): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById,
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_burst_check");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById,
    ...lookups,
  }).state;
}

function passBurstStackWindow(
  state: GameState,
  localGetCardDefinitionById = getCardDefinitionById,
  localLookups = lookups
): GameState {
  expect(state.window).toBe("stack");
  expect(state.stackWindow?.burstWindowKind).toBeDefined();
  const action = getLegalActions({
    state,
    actingPlayerId: state.stackWindow!.priorityPlayerId,
    getCardDefinitionById: localGetCardDefinitionById,
    ...localLookups,
  }).find((a) => a.kind === "pass_stack");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: localGetCardDefinitionById,
    ...localLookups,
  }).state;
}

function resolveBurstThroughWindows(
  state: GameState,
  localGetCardDefinitionById = getCardDefinitionById,
  localLookups = lookups
): GameState {
  const afterDeclaration = resolveBurst(state);
  expect(afterDeclaration.stackWindow?.burstWindowKind).toBe("activation");
  const afterActivationPass = passBurstStackWindow(
    afterDeclaration,
    localGetCardDefinitionById,
    localLookups
  );
  expect(afterActivationPass.stackWindow?.burstWindowKind).toBe(
    "effect_declaration"
  );
  return passBurstStackWindow(
    afterActivationPass,
    localGetCardDefinitionById,
    localLookups
  );
}

describe("P3-77 Step B/C: バースト効果の無効/発揮できない と 受けない優先", () => {
  it("helper: 発動中(節②)窓免疫は無効を回避 / 無耐性は無効化される", () => {
    const immune = baseScenario(X07, [
      bobNullifyBurstCE(),
      x07WindowImmunityCE(),
    ]);
    expect(isBurstEffectNullifiedByOpponent(immune, "x07", "alice")).toBe(
      false
    );

    const notImmune = baseScenario(X07, [bobNullifyBurstCE()]);
    expect(isBurstEffectNullifiedByOpponent(notImmune, "x07", "alice")).toBe(
      true
    );

    const noNullify = baseScenario(X07, [x07WindowImmunityCE()]);
    expect(isBurstEffectNullifiedByOpponent(noNullify, "x07", "alice")).toBe(
      false
    );
  });

  it("セット束縛(節①)の受けないは無効を回避しない (発揮時点では失効扱い)", () => {
    // M13 型: セット/トラッシュ中受けない (burstActivationWindow なし) は発揮への無効を防がない。
    const state = baseScenario(X07, [
      bobNullifyBurstCE(),
      setBoundImmunityCE(),
    ]);
    expect(isBurstEffectNullifiedByOpponent(state, "x07", "alice")).toBe(true);
  });

  it("発揮できない無視フラグは cannot_activate のみバイパスし nullify は受ける", () => {
    // M13: 「発揮できない」を無視して発揮できるが「無効」は受ける。
    const cannotActivate = baseScenario(X07, [bobCannotActivateBurstCE()]);
    expect(
      isBurstEffectNullifiedByOpponent(cannotActivate, "x07", "alice", {
        ignoresOpponentCannotActivateBurst: true,
      })
    ).toBe(false);
    // フラグなしなら cannot_activate に抑制される。
    expect(
      isBurstEffectNullifiedByOpponent(cannotActivate, "x07", "alice")
    ).toBe(true);

    // 無効(nullify) はフラグがあっても受ける。
    const nullify = baseScenario(X07, [bobNullifyBurstCE()]);
    expect(
      isBurstEffectNullifiedByOpponent(nullify, "x07", "alice", {
        ignoresOpponentCannotActivateBurst: true,
      })
    ).toBe(true);
  });

  it("発動中窓免疫は発揮できないも回避する (受けない > 発揮できない)", () => {
    const state = baseScenario(X07, [
      bobCannotActivateBurstCE(),
      x07WindowImmunityCE(),
    ]);
    expect(isBurstEffectNullifiedByOpponent(state, "x07", "alice")).toBe(false);
  });

  it("X07(発動中受けない) は相手の無効を受けず、バースト効果が発揮され field 召喚される", () => {
    const state = baseScenario(X07, [
      bobNullifyBurstCE(),
      x07WindowImmunityCE(),
    ]);
    const after = resolveBurstThroughWindows(state);
    const x07 = after.cardInstances.find((c) => c.instanceId === "x07")!;
    expect(x07.zone).toBe("field");
  });

  it("DSL: continuous negate(opponent_burst) は rebuild で negate_opponent_burst CE を登録", () => {
    const negatorDef: CardDefinition = {
      cardNo: "TEST-BURST-NEGATOR",
      name: "TEST-BURST-NEGATOR",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
      textLines: ["相手のバースト効果を無効にする。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      tribe: "起幻",
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            { action: { kind: "negate", negateTarget: "opponent_burst" } },
          ],
        },
      ],
    };
    const localMap = new Map(cardMap);
    localMap.set(negatorDef.cardNo, negatorDef);
    const lookup = (id: string) => localMap.get(id);

    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [
        createCardInstance(negatorDef, {
          instanceId: "negator",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(state, lookup);
    const ce = rebuilt.activeContinuousEffects.find(
      (c) => c.modifierTag === "negate_opponent_burst"
    );
    expect(ce).toBeDefined();
    expect(ce!.actingPlayerId).toBe("bob");
    // alice のバーストは bob の negate により無効化される (受けない無し)
    expect(
      isBurstEffectNullifiedByOpponent(rebuilt, "any-burst", "alice")
    ).toBe(true);
  });

  it("受けないを持たないバーストは無効化され、効果不発で field 召喚されない", () => {
    // X07 の継続効果(節①)を外したダミー = defense_immune なし。
    const plain: CardDefinition = {
      ...X07,
      cardNo: "TEST-PLAIN-BURST",
      effects: (X07.effects ?? []).filter(
        (e) => e.timing.kind !== "continuous"
      ),
    };
    const localMap = new Map(cardMap);
    localMap.set(plain.cardNo, plain);
    const localLookup = (id: string) => localMap.get(id);
    const localLookups = {
      ...lookups,
      getRegisteredBurstActions: buildBurstEffectLookup([...ALL_CARDS, plain]),
    };

    const state = baseScenario(plain, [bobNullifyBurstCE()]);
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: localLookup,
      ...localLookups,
    }).find((a) => a.kind === "resolve_pending_burst_check");
    expect(action).toBeDefined();
    const afterDeclaration = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: localLookup,
      ...localLookups,
    }).state;
    expect(afterDeclaration.stackWindow?.burstWindowKind).toBe("activation");
    const afterActivationPass = passBurstStackWindow(
      afterDeclaration,
      localLookup,
      localLookups
    );
    expect(afterActivationPass.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );
    const after = passBurstStackWindow(
      afterActivationPass,
      localLookup,
      localLookups
    );

    const card = after.cardInstances.find((c) => c.instanceId === "x07")!;
    // 効果抑制 → 自己召喚は発揮されず field に出ない。
    expect(card.zone).not.toBe("field");
    expect(after.log.some((l) => l.includes("burst:effect-suppressed"))).toBe(
      true
    );
  });
});
