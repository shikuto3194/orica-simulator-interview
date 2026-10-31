/**
 * P3-47 F-4 Step 1: redirect_effect_target ContinuousEffect の型と helper を検証する。
 *
 * Step 1 の責務 (本テスト範囲):
 * - getRedirectEffectTargetMetadata が CE.metadata を取り出す
 * - getRedirectEffectTargetsProtecting が targetInstanceId / sourceInstanceId-based で保護対象を拾う
 * - resolveRedirectCandidateInstanceIds が explicit / associated_act_as_spirit を解決する
 *
 * Step 2 以降の target-resolution 介入・pending 解決は別ファイルで検証する。
 */
import { describe, it, expect } from "vitest";
import {
  getRedirectEffectTargetMetadata,
  getRedirectEffectTargetsProtecting,
  resolveRedirectCandidateInstanceIds,
  findApplicableTargetRedirects,
  applyRedirectToResolvedTargets,
} from "../src/effect/redirect-effect-target";
import type { RedirectEffectTargetMetadata } from "../src/effect/redirect-effect-target";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { Effect } from "../src/dsl-types";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";

const ALICE = "player-1";

function makeRedirectCE(args: {
  effectId: string;
  sourceInstanceId: string;
  targetInstanceId?: string;
  actingPlayerId?: string;
  metadata: RedirectEffectTargetMetadata;
}): ContinuousEffect {
  return {
    effectId: args.effectId,
    sourceInstanceId: args.sourceInstanceId,
    sourceDefinitionId: "SRC-001",
    actingPlayerId: args.actingPlayerId ?? ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "redirect_effect_target" as ContinuousEffectTag,
    ...(args.targetInstanceId !== undefined
      ? { targetInstanceId: args.targetInstanceId }
      : {}),
    metadata: args.metadata as unknown as Record<string, unknown>,
  };
}

function makeActAsSpiritCE(args: {
  effectId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
}): ContinuousEffect {
  return {
    effectId: args.effectId,
    sourceInstanceId: args.sourceInstanceId,
    sourceDefinitionId: "SRC-001",
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "act_as_spirit" as ContinuousEffectTag,
    targetInstanceId: args.targetInstanceId,
    metadata: {
      statBlueprint: {
        kind: "live_copy_from",
        sourceInstanceId: args.sourceInstanceId,
        aspects: ["currentLv"],
      },
    } as Record<string, unknown>,
  };
}

function emptyState(ces: ContinuousEffect[]): GameState {
  const def: CardDefinition = {
    cardNo: "TEST-FIELD-SPIRIT",
    name: "Test Field Spirit",
    printedCategory: "spirit",
    printedColors: ["red"],
    colors: ["red"],
    symbolColors: ["red"],
    cost: 3,
    printedCost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
  } as CardDefinition;
  const instanceIds = new Set<string>();
  for (const ce of ces) {
    instanceIds.add(ce.sourceInstanceId);
    if (ce.targetInstanceId !== undefined) instanceIds.add(ce.targetInstanceId);
    const meta = getRedirectEffectTargetMetadata(ce);
    if (meta?.triggerCondition.protectedTargetKind === "instances") {
      for (const id of meta.triggerCondition.protectedInstanceIds) {
        instanceIds.add(id);
      }
    }
    if (meta?.redirectCandidateSource.kind === "explicit") {
      for (const id of meta.redirectCandidateSource.instanceIds) {
        instanceIds.add(id);
      }
    }
  }
  return {
    activeContinuousEffects: ces,
    cardInstances: [...instanceIds].map((instanceId) =>
      createCardInstance(def, {
        instanceId,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      })
    ),
  } as unknown as GameState;
}

const HOST = "host-flandre";
const TOKEN_A = "token-a";
const TOKEN_B = "token-b";
const TOKEN_C = "token-c";

const SELF_TRIGGER_META: RedirectEffectTargetMetadata = {
  triggerCondition: {
    sourcePlayerRef: "opponent",
    protectedTargetKind: "self",
  },
  redirectCandidateSource: {
    kind: "associated_act_as_spirit",
  },
  optional: true,
};

const EXPLICIT_META: RedirectEffectTargetMetadata = {
  triggerCondition: {
    sourcePlayerRef: "opponent",
    protectedTargetKind: "instances",
    protectedInstanceIds: [HOST],
  },
  redirectCandidateSource: {
    kind: "explicit",
    instanceIds: [TOKEN_A, TOKEN_B],
  },
  optional: true,
};

describe("P3-47 F-4 Step 1: redirect-effect-target helpers", () => {
  it("getRedirectEffectTargetMetadata は modifierTag が一致する CE の metadata を返す", () => {
    const ce = makeRedirectCE({
      effectId: "ce-1",
      sourceInstanceId: HOST,
      targetInstanceId: HOST,
      metadata: SELF_TRIGGER_META,
    });
    const meta = getRedirectEffectTargetMetadata(ce);
    expect(meta).toBeDefined();
    expect(meta?.triggerCondition.sourcePlayerRef).toBe("opponent");
    expect(meta?.optional).toBe(true);
  });

  it("getRedirectEffectTargetMetadata は他種別の CE には undefined を返す", () => {
    const ce = makeActAsSpiritCE({
      effectId: "ce-as-spirit",
      sourceInstanceId: HOST,
      targetInstanceId: TOKEN_A,
    });
    expect(getRedirectEffectTargetMetadata(ce)).toBeUndefined();
  });

  it("getRedirectEffectTargetMetadata は metadata 不正 (statBlueprint 抜け等) で undefined", () => {
    const ce: ContinuousEffect = {
      effectId: "ce-broken",
      sourceInstanceId: HOST,
      sourceDefinitionId: "SRC-001",
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "redirect_effect_target" as ContinuousEffectTag,
      metadata: { foo: "bar" } as unknown as Record<string, unknown>,
    };
    expect(getRedirectEffectTargetMetadata(ce)).toBeUndefined();
  });

  it("getRedirectEffectTargetsProtecting は targetInstanceId 一致で保護 CE を拾う", () => {
    const ce = makeRedirectCE({
      effectId: "ce-direct",
      sourceInstanceId: HOST,
      targetInstanceId: HOST,
      metadata: EXPLICIT_META,
    });
    const state = emptyState([ce]);
    const found = getRedirectEffectTargetsProtecting(state, HOST);
    expect(found).toHaveLength(1);
    expect(found[0]?.effectId).toBe("ce-direct");
  });

  it("getRedirectEffectTargetsProtecting は self kind + sourceInstanceId 一致で保護 CE を拾う", () => {
    // targetInstanceId 未設定 + protectedTargetKind="self" + sourceInstanceId=HOST
    const ce = makeRedirectCE({
      effectId: "ce-self",
      sourceInstanceId: HOST,
      metadata: SELF_TRIGGER_META,
    });
    const state = emptyState([ce]);
    const found = getRedirectEffectTargetsProtecting(state, HOST);
    expect(found).toHaveLength(1);
    expect(found[0]?.effectId).toBe("ce-self");
  });

  it("getRedirectEffectTargetsProtecting は protectedInstanceId が一致しなければ空配列", () => {
    const ce = makeRedirectCE({
      effectId: "ce-self",
      sourceInstanceId: HOST,
      metadata: SELF_TRIGGER_META,
    });
    const state = emptyState([ce]);
    expect(getRedirectEffectTargetsProtecting(state, TOKEN_A)).toHaveLength(0);
  });

  it("resolveRedirectCandidateInstanceIds は explicit 候補をそのまま返す", () => {
    const ce = makeRedirectCE({
      effectId: "ce-explicit",
      sourceInstanceId: HOST,
      targetInstanceId: HOST,
      metadata: EXPLICIT_META,
    });
    const state = emptyState([ce]);
    const ids = resolveRedirectCandidateInstanceIds(state, ce);
    expect(ids).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("resolveRedirectCandidateInstanceIds は associated_act_as_spirit を host 基準で解決する", () => {
    const redirectCE = makeRedirectCE({
      effectId: "ce-redirect",
      sourceInstanceId: HOST,
      targetInstanceId: HOST,
      metadata: SELF_TRIGGER_META,
    });
    const tokenCEs = [TOKEN_A, TOKEN_B, TOKEN_C].map((t) =>
      makeActAsSpiritCE({
        effectId: `ce-as-spirit-${t}`,
        sourceInstanceId: HOST,
        targetInstanceId: t,
      })
    );
    // 別 host の token (混入してはいけない)
    const otherToken = makeActAsSpiritCE({
      effectId: "ce-as-spirit-other",
      sourceInstanceId: "other-host",
      targetInstanceId: "other-token",
    });
    const state = emptyState([redirectCE, ...tokenCEs, otherToken]);
    const ids = resolveRedirectCandidateInstanceIds(state, redirectCE);
    expect(ids.sort()).toEqual([TOKEN_A, TOKEN_B, TOKEN_C].sort());
    expect(ids).not.toContain("other-token");
  });
});

describe("P3-47 F-4 Step 2: findApplicableTargetRedirects", () => {
  const BOB = "player-2";

  function setupFlandreLikeState(): { state: ReturnType<typeof emptyState> } {
    // ALICE 所有のフランドール本体 + 3 token + redirect CE (self / opponent / associated_act_as_spirit)
    const redirectCE = makeRedirectCE({
      effectId: "ce-redirect",
      sourceInstanceId: HOST,
      targetInstanceId: HOST,
      actingPlayerId: ALICE,
      metadata: SELF_TRIGGER_META,
    });
    const tokenCEs = [TOKEN_A, TOKEN_B, TOKEN_C].map((t) =>
      makeActAsSpiritCE({
        effectId: `ce-as-spirit-${t}`,
        sourceInstanceId: HOST,
        targetInstanceId: t,
      })
    );
    return { state: emptyState([redirectCE, ...tokenCEs]) };
  }

  it("相手効果が host を対象にした場合に 1 件 match を返す (self / associated_act_as_spirit)", () => {
    const { state } = setupFlandreLikeState();
    const matches = findApplicableTargetRedirects(state, [HOST], BOB);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      redirectEffectId: "ce-redirect",
      promptedPlayerId: ALICE,
      hostInstanceId: HOST,
      protectedInstanceId: HOST,
    });
    expect(matches[0]?.candidateTokenInstanceIds.sort()).toEqual(
      [TOKEN_A, TOKEN_B, TOKEN_C].sort()
    );
  });

  it("BS69 Q26982 / CB13 Q14170: field 外だけの target slice は redirect prompt を出さない", () => {
    const handDef = minimalDef("HAND-SPIRIT", "spirit");
    const tokenDef = minimalDef("TOKEN-SPIRIT", "spirit");
    const hostInHand = createCardInstance(handDef, {
      instanceId: HOST,
      ownerPlayerId: ALICE,
      zone: "hand",
      normalCoreCount: 0,
    });
    const tokenA = createCardInstance(tokenDef, {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const redirectCE = makeRedirectCE({
      effectId: "ce-redirect-hand-only",
      sourceInstanceId: HOST,
      actingPlayerId: ALICE,
      metadata: SELF_TRIGGER_META,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: BOB,
      cardInstances: [hostInHand, tokenA],
      activeContinuousEffects: [
        redirectCE,
        makeActAsSpiritCE({
          effectId: "ce-as-spirit-a",
          sourceInstanceId: HOST,
          targetInstanceId: TOKEN_A,
        }),
      ],
    };
    const defs: Record<string, CardDefinition> = {
      "HAND-SPIRIT": handDef,
      "TOKEN-SPIRIT": tokenDef,
      "SRC-001": handDef,
    };

    const matches = findApplicableTargetRedirects(
      state,
      [HOST],
      BOB,
      "none",
      undefined,
      (id) => defs[id]
    );

    expect(matches).toHaveLength(0);
  });

  it("自分自身の効果 (CE owner と同一) は sourcePlayerRef='opponent' で skip", () => {
    const { state } = setupFlandreLikeState();
    const matches = findApplicableTargetRedirects(state, [HOST], ALICE);
    expect(matches).toHaveLength(0);
  });

  it("保護対象が resolved 集合に含まれない場合は match なし", () => {
    const { state } = setupFlandreLikeState();
    const matches = findApplicableTargetRedirects(
      state,
      ["unrelated-card"],
      BOB
    );
    expect(matches).toHaveLength(0);
  });

  it("裁定 #7: 全 candidate が resolved 集合に既に含まれているなら match なし", () => {
    const { state } = setupFlandreLikeState();
    // 「相手スピリットすべて破壊」相当 — host + token 全てが対象集合に含まれる
    const resolved = [HOST, TOKEN_A, TOKEN_B, TOKEN_C];
    const matches = findApplicableTargetRedirects(state, resolved, BOB);
    expect(matches).toHaveLength(0);
  });

  it("一部 candidate が resolved に既出 → 残り candidate のみ返す", () => {
    const { state } = setupFlandreLikeState();
    // 相手効果が host + TOKEN_A を対象にした (一部 token も既に被害)
    const matches = findApplicableTargetRedirects(state, [HOST, TOKEN_A], BOB);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.candidateTokenInstanceIds.sort()).toEqual(
      [TOKEN_B, TOKEN_C].sort()
    );
  });

  it("複数の redirect CE がマッチする場合は全件返る (フランドール 2 体)", () => {
    const HOST2 = "host-2";
    const T2A = "t2a";
    const T2B = "t2b";
    const ce1 = makeRedirectCE({
      effectId: "ce-redirect-1",
      sourceInstanceId: HOST,
      actingPlayerId: ALICE,
      metadata: SELF_TRIGGER_META,
    });
    const ce2 = makeRedirectCE({
      effectId: "ce-redirect-2",
      sourceInstanceId: HOST2,
      actingPlayerId: ALICE,
      metadata: SELF_TRIGGER_META,
    });
    const tokens1 = [TOKEN_A, TOKEN_B].map((t) =>
      makeActAsSpiritCE({
        effectId: `as-${t}`,
        sourceInstanceId: HOST,
        targetInstanceId: t,
      })
    );
    const tokens2 = [T2A, T2B].map((t) =>
      makeActAsSpiritCE({
        effectId: `as-${t}`,
        sourceInstanceId: HOST2,
        targetInstanceId: t,
      })
    );
    const state = emptyState([ce1, ce2, ...tokens1, ...tokens2]);
    // 相手効果が両 host を対象 (相手スピリット 2 体破壊等)
    const matches = findApplicableTargetRedirects(state, [HOST, HOST2], BOB);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.protectedInstanceId).sort()).toEqual(
      [HOST, HOST2].sort()
    );
  });

  it("explicit candidate source + protectedTargetKind='instances' でマッチする", () => {
    const ce = makeRedirectCE({
      effectId: "ce-explicit",
      sourceInstanceId: HOST,
      actingPlayerId: ALICE,
      metadata: EXPLICIT_META,
    });
    const state = emptyState([ce]);
    const matches = findApplicableTargetRedirects(state, [HOST], BOB);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.candidateTokenInstanceIds).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("applyRedirectToResolvedTargets は 1 要素を置換する", () => {
    const original = [HOST, TOKEN_A, "some-other"];
    const result = applyRedirectToResolvedTargets(original, HOST, TOKEN_B);
    expect(result).toEqual([TOKEN_B, TOKEN_A, "some-other"]);
    // 元配列は不変
    expect(original).toEqual([HOST, TOKEN_A, "some-other"]);
  });

  it("applyRedirectToResolvedTargets は複数対象を同じ replacement 1体へ collapse する", () => {
    const original = [HOST, TOKEN_A, "some-other"];
    const result = applyRedirectToResolvedTargets(
      original,
      [HOST, TOKEN_A],
      TOKEN_B
    );
    expect(result).toEqual([TOKEN_B, "some-other"]);
  });

  // P3-47 F-4 案 (a): defense_immune を持つ token は candidate から除外。
  // 「効果を受けない」状態の対象に効果を受けさせることはできない (「防げない」効果を除く)。
  function makeDefenseImmuneCE(targetInstanceId: string): ContinuousEffect {
    return {
      effectId: `ce-immune-${targetInstanceId}`,
      sourceInstanceId: "some-other-card",
      sourceDefinitionId: "OTHER-001",
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "defense_immune" as ContinuousEffectTag,
      targetInstanceId,
    };
  }

  function makeScopedDefenseImmuneCE(
    targetInstanceId: string,
    immunitySourceScope: ContinuousEffect["immunitySourceScope"]
  ): ContinuousEffect {
    return {
      ...makeDefenseImmuneCE(targetInstanceId),
      immunitySourceScope,
    };
  }

  function minimalDef(
    cardNo: string,
    printedCategory: CardDefinition["printedCategory"]
  ): CardDefinition {
    return {
      cardNo,
      name: cardNo,
      printedCategory,
      printedColors: ["red"],
      colors: ["red"],
      symbolColors: ["red"],
      cost: 3,
      printedCost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      textLines: [],
      images: {},
    } as CardDefinition;
  }

  it("案 (a): defense_immune を持つ token は candidate から除外される (sourcePreventionLevel='none')", () => {
    const { state: baseState } = setupFlandreLikeState();
    const state = emptyState([
      ...baseState.activeContinuousEffects,
      makeDefenseImmuneCE(TOKEN_A),
    ]);
    const matches = findApplicableTargetRedirects(state, [HOST], BOB, "none");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.candidateTokenInstanceIds.sort()).toEqual(
      [TOKEN_B, TOKEN_C].sort()
    );
    expect(matches[0]?.candidateTokenInstanceIds).not.toContain(TOKEN_A);
  });

  it("案 (a): sourcePreventionLevel 省略時も defense_immune token は除外 (デフォルト 'none')", () => {
    const { state: baseState } = setupFlandreLikeState();
    const state = emptyState([
      ...baseState.activeContinuousEffects,
      makeDefenseImmuneCE(TOKEN_B),
    ]);
    const matches = findApplicableTargetRedirects(state, [HOST], BOB);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.candidateTokenInstanceIds).not.toContain(TOKEN_B);
  });

  it("案 (a): 全 candidate が defense_immune の場合は match なし", () => {
    const { state: baseState } = setupFlandreLikeState();
    const state = emptyState([
      ...baseState.activeContinuousEffects,
      makeDefenseImmuneCE(TOKEN_A),
      makeDefenseImmuneCE(TOKEN_B),
      makeDefenseImmuneCE(TOKEN_C),
    ]);
    const matches = findApplicableTargetRedirects(state, [HOST], BOB);
    expect(matches).toHaveLength(0);
  });

  it("案 (a): 「防げない」(unpreventable) は defense_immune を貫通し candidate に残る", () => {
    const { state: baseState } = setupFlandreLikeState();
    const state = emptyState([
      ...baseState.activeContinuousEffects,
      makeDefenseImmuneCE(TOKEN_A),
    ]);
    const matches = findApplicableTargetRedirects(
      state,
      [HOST],
      BOB,
      "unpreventable"
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.candidateTokenInstanceIds.sort()).toEqual(
      [TOKEN_A, TOKEN_B, TOKEN_C].sort()
    );
  });

  it("sourceScope 付き defense_immune は redirect candidate でも元効果 source に一致する候補だけ除外する", () => {
    const { state: baseState } = setupFlandreLikeState();
    const tokenDef = minimalDef("TOKEN", "spirit");
    const sourceSpiritDef = minimalDef("SRC-SPIRIT", "spirit");
    const sourceMagicDef = minimalDef("SRC-MAGIC", "magic");
    const sourceSpirit = createCardInstance(sourceSpiritDef, {
      instanceId: "source-spirit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const tokenA = createCardInstance(tokenDef, {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const tokenB = createCardInstance(tokenDef, {
      instanceId: TOKEN_B,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const tokenC = createCardInstance(tokenDef, {
      instanceId: TOKEN_C,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...emptyState([
        ...baseState.activeContinuousEffects,
        makeScopedDefenseImmuneCE(TOKEN_A, {
          categories: ["spirit", "nexus"],
        }),
      ]),
      cardInstances: [
        createCardInstance(tokenDef, {
          instanceId: HOST,
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
        sourceSpirit,
        tokenA,
        tokenB,
        tokenC,
      ],
    };

    const bySpirit = findApplicableTargetRedirects(state, [HOST], BOB, "none", {
      instance: sourceSpirit,
      definition: sourceSpiritDef,
    });
    expect(bySpirit).toHaveLength(1);
    expect(bySpirit[0]?.candidateTokenInstanceIds.sort()).toEqual(
      [TOKEN_B, TOKEN_C].sort()
    );

    const byMagic = findApplicableTargetRedirects(state, [HOST], BOB, "none", {
      definition: sourceMagicDef,
    });
    expect(byMagic).toHaveLength(1);
    expect(byMagic[0]?.candidateTokenInstanceIds.sort()).toEqual(
      [TOKEN_A, TOKEN_B, TOKEN_C].sort()
    );
  });

  it("targetFilter 付き defense_immune は redirect candidate gate でも lookup 経由で候補から除外する", () => {
    const { state: baseState } = setupFlandreLikeState();
    const tokenDef = minimalDef("TOKEN-NOTRIBE", "spirit");
    const hostDef = minimalDef("HOST-DEF", "spirit");
    const sourceDef = minimalDef("SRC-MAGIC", "magic");
    const defs = new Map<string, CardDefinition>([
      [tokenDef.cardNo, tokenDef],
      [hostDef.cardNo, hostDef],
      [sourceDef.cardNo, sourceDef],
    ]);
    const getDef = (id: string): CardDefinition | undefined => defs.get(id);
    const host = createCardInstance(hostDef, {
      instanceId: HOST,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const tokens = [TOKEN_A, TOKEN_B, TOKEN_C].map((instanceId) =>
      createCardInstance(tokenDef, {
        instanceId,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const dynamicImmuneCe: ContinuousEffect = {
      effectId: "ce-dynamic-immune-no-tribes",
      sourceInstanceId: HOST,
      sourceDefinitionId: "HOST-DEF",
      actingPlayerId: ALICE,
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "defense_immune" as ContinuousEffectTag,
      targetFilter: {
        player: "self",
        category: ["spirit"],
        noTribes: true,
      },
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activeContinuousEffects: [
        ...baseState.activeContinuousEffects,
        dynamicImmuneCe,
      ],
      cardInstances: [host, ...tokens],
    };

    const matches = findApplicableTargetRedirects(
      state,
      [HOST],
      BOB,
      "none",
      { definition: sourceDef },
      getDef
    );
    expect(matches).toHaveLength(0);
  });
});

describe("P3-47 F-4 Step 4: register_redirect_effect_target DSL action", () => {
  function frandolleHostDef(): CardDefinition {
    return {
      cardNo: "FRANDOLLE-HOST",
      name: "フランドール・スカーレット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 7,
      cost: 7,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
  }

  function tokenDef(): CardDefinition {
    return {
      cardNo: "TEST-NEXUS",
      name: "Test Nexus",
      printedCategory: "nexus",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 0,
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
  }

  function makeFrandolleAndTokens(): {
    state: GameState;
    getDef: (id: string) => CardDefinition | undefined;
  } {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokens = [TOKEN_A, TOKEN_B, TOKEN_C].map((id) =>
      createCardInstance(tokenDef(), {
        instanceId: id,
        ownerPlayerId: ALICE,
        zone: "field",
        faceDown: true,
        cores: 1,
      })
    );
    const baseState = createEmptyGameState({
      playerIds: [ALICE, "player-2"],
    });
    const state: GameState = {
      ...baseState,
      activePlayerId: ALICE,
      cardInstances: [host, ...tokens],
      activeContinuousEffects: [],
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": tokenDef(),
    };
    return { state, getDef: (id) => defs[id] };
  }

  it("protectedTarget=self + associated_act_as_spirit: self 形式の CE を 1 件登録", () => {
    const { state, getDef } = makeFrandolleAndTokens();
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "register_redirect_effect_target",
            protectedTarget: { kind: "self" },
            redirectCandidate: { kind: "associated_act_as_spirit" },
          },
        },
      ],
    };
    const next = executeEffect({
      chainId: "test:redirect-effect-target:776",
      state,
      effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const ces = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "redirect_effect_target"
    );
    expect(ces).toHaveLength(1);
    const ce = ces[0]!;
    expect(ce.sourceInstanceId).toBe("host-1");
    expect(ce.targetInstanceId).toBeUndefined(); // self kind は targetInstanceId 省略
    expect(ce.duration).toEqual({ scope: "while_on_field" });

    const meta = getRedirectEffectTargetMetadata(ce);
    expect(meta).toBeDefined();
    expect(meta?.triggerCondition).toEqual({
      sourcePlayerRef: "opponent",
      protectedTargetKind: "self",
    });
    expect(meta?.redirectCandidateSource).toEqual({
      kind: "associated_act_as_spirit",
    });
    expect(meta?.optional).toBe(true);
  });

  it("protectedTarget=target + explicit candidate: 解決済み instanceId を凍結", () => {
    const { state: hiddenState, getDef } = makeFrandolleAndTokens();
    const state: GameState = {
      ...hiddenState,
      cardInstances: hiddenState.cardInstances.map((card) =>
        card.instanceId === TOKEN_A ||
        card.instanceId === TOKEN_B ||
        card.instanceId === TOKEN_C
          ? { ...card, faceDown: false }
          : card
      ),
    };
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "register_redirect_effect_target",
            protectedTarget: {
              kind: "target",
              target: { kind: "self" },
            },
            redirectCandidate: {
              kind: "explicit",
              target: {
                kind: "filter",
                player: "self",
                count: "all",
                filter: { category: ["nexus"] },
              },
            },
            sourcePlayerRef: "any",
            optional: false,
          },
        },
      ],
    };
    const next = executeEffect({
      chainId: "test:redirect-effect-target:842",
      state,
      effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const ces = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "redirect_effect_target"
    );
    expect(ces).toHaveLength(1);
    const meta = getRedirectEffectTargetMetadata(ces[0]!);
    expect(meta?.triggerCondition).toEqual({
      sourcePlayerRef: "any",
      protectedTargetKind: "instances",
      protectedInstanceIds: ["host-1"],
    });
    expect(meta?.redirectCandidateSource).toEqual({
      kind: "explicit",
      instanceIds: [TOKEN_A, TOKEN_B, TOKEN_C],
    });
    expect(meta?.optional).toBe(false);
  });

  it("duration を明示すれば CE.duration に伝搬", () => {
    const { state, getDef } = makeFrandolleAndTokens();
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "register_redirect_effect_target",
            protectedTarget: { kind: "self" },
            redirectCandidate: { kind: "associated_act_as_spirit" },
            duration: { scope: "turn" },
          },
        },
      ],
    };
    const next = executeEffect({
      chainId: "test:redirect-effect-target:882",
      state,
      effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const ce = next.activeContinuousEffects.find(
      (c) => c.modifierTag === "redirect_effect_target"
    );
    expect(ce?.duration).toEqual({ scope: "turn" });
  });

  it("protectedTarget=target で対象 0 件なら CE 未登録", () => {
    const { state, getDef } = makeFrandolleAndTokens();
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "register_redirect_effect_target",
            protectedTarget: {
              kind: "target",
              target: {
                kind: "filter",
                player: "self",
                count: "all",
                filter: { category: ["magic"] }, // フィールドに magic は無い
              },
            },
            redirectCandidate: { kind: "associated_act_as_spirit" },
          },
        },
      ],
    };
    const next = executeEffect({
      chainId: "test:redirect-effect-target:917",
      state,
      effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const ces = next.activeContinuousEffects.filter(
      (c) => c.modifierTag === "redirect_effect_target"
    );
    expect(ces).toHaveLength(0);
  });

  it("end-to-end: 登録した CE が findApplicableTargetRedirects で検出される", () => {
    const { state, getDef } = makeFrandolleAndTokens();
    // まず act_as_spirit CE を 3 token に手動登録 (Step 6 register_act_as_spirit を経由しても良い)
    const stateWithTokens: GameState = {
      ...state,
      activeContinuousEffects: [TOKEN_A, TOKEN_B, TOKEN_C].map((t) => ({
        effectId: `ce-as-spirit-${t}`,
        sourceInstanceId: "host-1",
        sourceDefinitionId: "FRANDOLLE-HOST",
        actingPlayerId: ALICE,
        duration: { scope: "while_on_field" as const },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "act_as_spirit" as ContinuousEffectTag,
        targetInstanceId: t,
        metadata: {
          statBlueprint: {
            kind: "live_copy_from",
            sourceInstanceId: "host-1",
            aspects: ["currentLv"],
          },
        } as Record<string, unknown>,
      })),
    };
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "register_redirect_effect_target",
            protectedTarget: { kind: "self" },
            redirectCandidate: { kind: "associated_act_as_spirit" },
          },
        },
      ],
    };
    const next = executeEffect({
      chainId: "test:redirect-effect-target:966",
      state: stateWithTokens,
      effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    // 相手効果が host-1 を対象 → match 1 件、candidate = 3 token
    const matches = findApplicableTargetRedirects(next, ["host-1"], "player-2");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.protectedInstanceId).toBe("host-1");
    expect(matches[0]?.candidateTokenInstanceIds.sort()).toEqual(
      [TOKEN_A, TOKEN_B, TOKEN_C].sort()
    );
  });
});

// ====================================================================
// Step 3b: effect-interpreter 配線 + applyTargetRedirectAction continuation
// ====================================================================
//
// 検証の中核: 相手効果が ALICE の host-1 を対象に取った瞬間に effect-interpreter が
// resolveTargets 直後で findApplicableTargetRedirects を呼び、pendingTargetRedirects に
// push して return することを確認する。さらに confirm/decline → applyTargetRedirectAction が
// executeEffect を startFromStepIndex で再起動し、redirected/原集合の対象 ID で実際に
// アクションが走ることを bp_modify CE の targetInstanceId で確認する。
//
// bp_modify を選んだ理由:
// - destroy は pendingLeave 経路 + after_triggers で処理が分岐するため検証パスが太い
// - bp_modify は targetInstanceId=対象 を持つ CE を 1 件積むだけなので、redirect 結果が
//   そのまま activeContinuousEffects に現れる
import { applyLegalAction } from "../src/legal/legal-actions";
import {
  getEffectiveBp,
  recomputeContinuousEffects,
} from "../src/legal/legal-actions-shared";

const BOB = "player-2";

describe("P3-47 F-4 Step 3b: effect-interpreter 配線 + continuation 再実行", () => {
  function frandolleHostDef(): CardDefinition {
    return {
      cardNo: "FRANDOLLE-HOST",
      name: "フランドール・スカーレット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 7,
      cost: 7,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
  }

  function tokenDef(): CardDefinition {
    return {
      cardNo: "TEST-NEXUS",
      name: "Test Nexus",
      printedCategory: "nexus",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 0,
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
  }

  // 相手側の bp_modify を撃つ攻撃カード。effects[0] が「相手スピリット 1 体の BP-3000」。
  function attackerDef(): CardDefinition {
    return {
      cardNo: "OPP-ATTACKER",
      name: "相手攻撃カード",
      printedCategory: "spirit",
      printedColors: ["blue"],
      symbolColors: ["blue"],
      printedCost: 3,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["blue"],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 1,
                  filter: { category: ["spirit"] },
                },
                amount: -3000,
                duration: { scope: "turn" },
              },
            },
          ],
        },
      ],
    } as CardDefinition;
  }

  function setupScene(): {
    state: GameState;
    getDef: (id: string) => CardDefinition | undefined;
  } {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokens = [TOKEN_A, TOKEN_B, TOKEN_C].map((id) =>
      createCardInstance(tokenDef(), {
        instanceId: id,
        ownerPlayerId: ALICE,
        zone: "field",
        faceDown: true,
        cores: 1,
      })
    );
    const attacker = createCardInstance(attackerDef(), {
      instanceId: "attacker-1",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    // act_as_spirit CE を 3 token に予め登録 (F-2 で実装される token 化を模擬)
    const actAsSpiritCEs: ContinuousEffect[] = [TOKEN_A, TOKEN_B, TOKEN_C].map(
      (t) => ({
        effectId: `ce-as-spirit-${t}`,
        sourceInstanceId: "host-1",
        sourceDefinitionId: "FRANDOLLE-HOST",
        actingPlayerId: ALICE,
        duration: { scope: "while_on_field" as const },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "act_as_spirit" as ContinuousEffectTag,
        targetInstanceId: t,
        metadata: {
          statBlueprint: {
            kind: "live_copy_from",
            sourceInstanceId: "host-1",
            aspects: ["currentLv"],
          },
        } as Record<string, unknown>,
      })
    );
    // redirect_effect_target CE を host-1 に登録 (Step 4 register action と等価な状態)
    const redirectCE: ContinuousEffect = {
      effectId: "ce-redirect-1",
      sourceInstanceId: "host-1",
      sourceDefinitionId: "FRANDOLLE-HOST",
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" as const },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "redirect_effect_target" as ContinuousEffectTag,
      metadata: {
        triggerCondition: {
          sourcePlayerRef: "opponent",
          protectedTargetKind: "self",
        },
        redirectCandidateSource: { kind: "associated_act_as_spirit" },
        optional: true,
      } as Record<string, unknown>,
    };

    const state: GameState = {
      ...baseState,
      activePlayerId: BOB,
      cardInstances: [host, ...tokens, attacker],
      activeContinuousEffects: [...actAsSpiritCEs, redirectCE],
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": tokenDef(),
      "OPP-ATTACKER": attackerDef(),
    };
    return { state, getDef: (id) => defs[id] };
  }

  it("相手 bp_modify が host-1 対象 → pendingTargetRedirect 発行 + アクション未実行", () => {
    const { state, getDef } = setupScene();
    const effect = attackerDef().effects![0]!;
    const result = executeEffect({
      chainId: "test:redirect-effect-target:1166",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    });
    expect(result.pendingTargetRedirects).toHaveLength(1);
    const pending = result.pendingTargetRedirects[0]!;
    expect(pending.redirectableInstanceId).toBe("host-1");
    expect(pending.promptedPlayerId).toBe(ALICE);
    expect(pending.candidateTokenInstanceIds.sort()).toEqual(
      [TOKEN_A, TOKEN_B, TOKEN_C].sort()
    );
    expect(pending.continuation).toBeDefined();
    expect(pending.continuation?.resumeStepIndex).toBe(0);
    expect(pending.continuation?.sourceInstanceId).toBe("attacker-1");
    expect(pending.continuation?.actingPlayerId).toBe(BOB);
    expect(pending.continuation?.sourceDefinitionId).toBe("OPP-ATTACKER");
    // アクションは未実行 → bp_modify CE が登録されていないことを確認
    const bpModifyCEs = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpModifyCEs).toHaveLength(0);
  });

  it("confirm: TOKEN_A に bp_modify が走り、host-1 は影響を受けない", () => {
    const { state, getDef } = setupScene();
    const effect = attackerDef().effects![0]!;
    const stateAfterPending = executeEffect({
      chainId: "test:redirect-effect-target:1196",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    });
    const pending = stateAfterPending.pendingTargetRedirects[0]!;

    const confirmResult = applyLegalAction({
      state: stateAfterPending,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: TOKEN_A,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in confirmResult)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(confirmResult.redirected).toBe(true);
    expect(confirmResult.resolvedAfterRedirect).toEqual([TOKEN_A]);
    // pending は消化され、再起動した executeEffect で bp_modify CE が targetInstanceId=TOKEN_A
    // で 1 件登録されている (host-1 ではない)
    expect(confirmResult.state.pendingTargetRedirects).toHaveLength(0);
    const bpCEs = confirmResult.state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCEs).toHaveLength(1);
    expect(bpCEs[0]?.targetInstanceId).toBe(TOKEN_A);
    expect(bpCEs[0]?.targetInstanceId).not.toBe("host-1");
  });

  it("targetGroups redirect continuation は collapse 後の selected_targets count へ group 割当を更新する", () => {
    const fixedSpiritDef = {
      ...frandolleHostDef(),
      cardNo: "FIXED-SPIRIT",
      name: "Fixed Spirit",
    } as CardDefinition;
    const otherSpiritDef = {
      ...frandolleHostDef(),
      cardNo: "OTHER-SPIRIT",
      name: "Other Spirit",
    } as CardDefinition;
    const groupedAttackerDef = {
      ...attackerDef(),
      cardNo: "OPP-GROUPED-ATTACKER",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              id: "bp-costed",
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 2,
                  filter: { category: ["spirit"] },
                },
                amount: {
                  source: { kind: "selected_targets", stepId: "bp-costed" },
                  groupMultiplier: 1000,
                },
                duration: { scope: "turn" },
              },
            },
          ],
        },
      ],
    } as CardDefinition;
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokenA = createCardInstance(tokenDef(), {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const fixedSpirit = createCardInstance(fixedSpiritDef, {
      instanceId: "fixed-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const otherSpirit = createCardInstance(otherSpiritDef, {
      instanceId: "other-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const attacker = createCardInstance(groupedAttackerDef, {
      instanceId: "attacker-1",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const targetGroups = [
      {
        targetStepId: "fixed",
        requiredTargetCount: 1,
        candidateTargetInstanceIds: [fixedSpirit.instanceId],
      },
      {
        targetStepId: "bp-costed",
        requiredTargetCount: 2,
        candidateTargetInstanceIds: [host.instanceId, otherSpirit.instanceId],
      },
    ];
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: BOB,
      cardInstances: [host, tokenA, fixedSpirit, otherSpirit, attacker],
      activeContinuousEffects: [
        {
          effectId: "ce-redirect-1",
          sourceInstanceId: host.instanceId,
          sourceDefinitionId: "FRANDOLLE-HOST",
          actingPlayerId: ALICE,
          duration: { scope: "while_on_field" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "redirect_effect_target" as ContinuousEffectTag,
          metadata: {
            triggerCondition: {
              sourcePlayerRef: "opponent",
              protectedTargetKind: "self",
            },
            redirectCandidateSource: { kind: "associated_act_as_spirit" },
            optional: true,
          } as Record<string, unknown>,
        },
        makeActAsSpiritCE({
          effectId: "ce-as-spirit-a",
          sourceInstanceId: host.instanceId,
          targetInstanceId: TOKEN_A,
        }),
      ],
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": tokenDef(),
      "FIXED-SPIRIT": fixedSpiritDef,
      "OTHER-SPIRIT": otherSpiritDef,
      "OPP-GROUPED-ATTACKER": groupedAttackerDef,
    };
    const getDef = (id: string) => defs[id];

    const stateAfterPending = executeEffect({
      chainId: "test:redirect-effect-target:1362",
      state,
      effect: groupedAttackerDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: attacker.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      targetInstanceIds: [
        fixedSpirit.instanceId,
        host.instanceId,
        otherSpirit.instanceId,
      ],
      targetGroups,
    });
    expect(stateAfterPending.pendingTargetRedirects).toHaveLength(1);
    const pending = stateAfterPending.pendingTargetRedirects[0]!;
    expect(pending.originalResolvedInstanceIds).toEqual([
      host.instanceId,
      otherSpirit.instanceId,
    ]);
    expect(pending.redirectableInstanceIds).toEqual([
      host.instanceId,
      otherSpirit.instanceId,
    ]);
    expect(pending.continuation?.targetInstanceIds).toEqual([
      fixedSpirit.instanceId,
      host.instanceId,
      otherSpirit.instanceId,
    ]);
    expect(pending.continuation?.targetGroups).toEqual(targetGroups);
    expect(pending.continuation?.redirectTargetIndexes).toEqual([1, 2]);

    const result = applyLegalAction({
      state: stateAfterPending,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: TOKEN_A,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in result)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    const bpTargets = result.state.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "bp_modifier")
      .map((ce) => ce.targetInstanceId)
      .sort();
    expect(bpTargets).toEqual([TOKEN_A]);
    expect(bpTargets).not.toContain(fixedSpirit.instanceId);
    expect(bpTargets).not.toContain(host.instanceId);
    expect(bpTargets).not.toContain(otherSpirit.instanceId);
    expect(result.state.log).toContain(
      `effect:bp_modify:registered:${TOKEN_A}:1000:turn`
    );
    expect(result.state.log).not.toContain(
      `effect:bp_modify:registered:${otherSpirit.instanceId}:1000:turn`
    );
  });

  it("under-card provider の sourceFilter と pending source identity を redirect に渡す", () => {
    const hostDef = {
      ...attackerDef(),
      cardNo: "BOB-HOST-SPIRIT",
      name: "Bob Host Spirit",
    } as CardDefinition;
    const providerMagicDef = {
      ...attackerDef(),
      cardNo: "UNDER-PROVIDER-MAGIC",
      name: "Under Provider Magic",
      printedCategory: "magic",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 1,
                  filter: { category: ["spirit"] },
                },
                amount: -1000,
                duration: { scope: "turn" },
              },
            },
          ],
        },
      ],
    } as CardDefinition;
    const protectedDef = {
      ...frandolleHostDef(),
      cardNo: "ALICE-PROTECTED-SPIRIT",
      name: "Alice Protected Spirit",
    } as CardDefinition;
    const host = createCardInstance(hostDef, {
      instanceId: "bob-host",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const provider = createCardInstance(providerMagicDef, {
      instanceId: "under-provider",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 0,
    });
    host.underCards = [
      {
        cardInstanceId: provider.instanceId,
        role: "text_role",
        roleTag: "provider-source",
      },
    ];
    provider.attachedToInstanceId = host.instanceId;
    provider.zoneRoleName = "provider-source";
    const protectedSpirit = createCardInstance(protectedDef, {
      instanceId: "protected-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const tokenA = createCardInstance(tokenDef(), {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: BOB,
      cardInstances: [host, provider, protectedSpirit, tokenA],
      activeContinuousEffects: [
        {
          effectId: "ce-redirect-provider-source",
          sourceInstanceId: protectedSpirit.instanceId,
          sourceDefinitionId: protectedDef.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "while_on_field" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "redirect_effect_target" as ContinuousEffectTag,
          metadata: {
            triggerCondition: {
              sourcePlayerRef: "opponent",
              sourceFilter: { category: ["magic"] },
              protectedTargetKind: "self",
            },
            redirectCandidateSource: { kind: "associated_act_as_spirit" },
            optional: true,
          } as Record<string, unknown>,
        },
        makeActAsSpiritCE({
          effectId: "ce-as-spirit-provider-source",
          sourceInstanceId: protectedSpirit.instanceId,
          targetInstanceId: TOKEN_A,
        }),
      ],
    };
    const defs: Record<string, CardDefinition> = {
      [hostDef.cardNo]: hostDef,
      [providerMagicDef.cardNo]: providerMagicDef,
      [protectedDef.cardNo]: protectedDef,
      "TEST-NEXUS": tokenDef(),
    };
    const getDef = (id: string) => defs[id];

    const result = executeEffect({
      chainId: "test:redirect-effect-target:1542",
      state,
      effect: providerMagicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: host.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      targetInstanceIds: [protectedSpirit.instanceId],
      effectSourceInstanceId: provider.instanceId,
      effectSourceDefinitionId: providerMagicDef.cardNo,
    });

    expect(result.pendingTargetRedirects).toHaveLength(1);
    expect(result.pendingTargetRedirects[0]).toMatchObject({
      sourceEffectInstanceId: provider.instanceId,
      sourceEffectDefinitionId: providerMagicDef.cardNo,
      redirectableInstanceId: protectedSpirit.instanceId,
    });
  });

  it("combined brave provider の sourceFilter は host identity で redirect 判定する", () => {
    const hostDef = {
      ...attackerDef(),
      cardNo: "BOB-COMBINED-HOST",
      name: "Bob Combined Host",
      printedCategory: "spirit",
    } as CardDefinition;
    const braveDef = {
      ...attackerDef(),
      cardNo: "BOB-COMBINED-BRAVE",
      name: "Bob Combined Brave",
      printedCategory: "brave",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 1,
                  filter: { category: ["spirit"] },
                },
                amount: -1000,
                duration: { scope: "turn" },
              },
            },
          ],
        },
      ],
    } as CardDefinition;
    const protectedDef = {
      ...frandolleHostDef(),
      cardNo: "ALICE-COMBINED-BRAVE-PROTECTED",
      name: "Alice Combined Brave Protected",
    } as CardDefinition;
    const replacementDef = {
      ...frandolleHostDef(),
      cardNo: "ALICE-COMBINED-BRAVE-REPLACEMENT",
      name: "Alice Combined Brave Replacement",
    } as CardDefinition;
    const host = createCardInstance(hostDef, {
      instanceId: "bob-combined-host",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
      attachedChildrenIds: ["bob-combined-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "bob-combined-brave",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 0,
      attachedToInstanceId: host.instanceId,
    });
    const protectedSpirit = createCardInstance(protectedDef, {
      instanceId: "alice-combined-brave-protected",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const replacementSpirit = createCardInstance(replacementDef, {
      instanceId: "alice-combined-brave-replacement",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: BOB,
      cardInstances: [host, brave, protectedSpirit, replacementSpirit],
      activeContinuousEffects: [
        {
          effectId: "ce-redirect-combined-brave-source-filter",
          sourceInstanceId: protectedSpirit.instanceId,
          sourceDefinitionId: protectedDef.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "while_on_field" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "redirect_effect_target" as ContinuousEffectTag,
          metadata: {
            triggerCondition: {
              sourcePlayerRef: "opponent",
              sourceFilter: { category: ["spirit"] },
              protectedTargetKind: "self",
            },
            redirectCandidateSource: {
              kind: "explicit",
              instanceIds: [replacementSpirit.instanceId],
            },
            optional: true,
          } as Record<string, unknown>,
        },
      ],
    };
    const defs: Record<string, CardDefinition> = {
      [hostDef.cardNo]: hostDef,
      [braveDef.cardNo]: braveDef,
      [protectedDef.cardNo]: protectedDef,
      [replacementDef.cardNo]: replacementDef,
    };
    const getDef = (id: string) => defs[id];

    const result = executeEffect({
      chainId: "test:redirect-effect-target:1668",
      state,
      effect: braveDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: host.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      targetInstanceIds: [protectedSpirit.instanceId],
      effectSourceInstanceId: brave.instanceId,
      effectSourceDefinitionId: braveDef.cardNo,
    });

    expect(result.pendingTargetRedirects).toHaveLength(1);
    expect(result.pendingTargetRedirects[0]).toMatchObject({
      sourceEffectInstanceId: brave.instanceId,
      sourceEffectDefinitionId: braveDef.cardNo,
      redirectableInstanceId: protectedSpirit.instanceId,
      candidateTokenInstanceIds: [replacementSpirit.instanceId],
    });
    expect(
      result.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "bp_modifier"
      )
    ).toHaveLength(0);
  });

  it("decline: host-1 に bp_modify が走る (元集合のまま再起動)", () => {
    const { state, getDef } = setupScene();
    const effect = attackerDef().effects![0]!;
    const stateAfterPending = executeEffect({
      chainId: "test:redirect-effect-target:1697",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    });
    const pending = stateAfterPending.pendingTargetRedirects[0]!;

    const declineResult = applyLegalAction({
      state: stateAfterPending,
      action: {
        kind: "decline_target_redirect",
        actionId: `redirect-decline-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: pending.pendingId,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in declineResult)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(declineResult.redirected).toBe(false);
    expect(declineResult.resolvedAfterRedirect).toEqual(["host-1"]);
    expect(declineResult.state.pendingTargetRedirects).toHaveLength(0);
    const bpCEs = declineResult.state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCEs).toHaveLength(1);
    expect(bpCEs[0]?.targetInstanceId).toBe("host-1");
  });

  it("再起動時の二重 redirect 抑止: 同じ redirect CE は redirected 集合に対して再発火しない", () => {
    // confirm → 再起動した executeEffect が targetInstanceIds=[TOKEN_A] で進入し、
    // resolveTargets が [TOKEN_A] を返したあと findApplicableTargetRedirects も再走するが、
    // 保護対象 host-1 が resolved 集合に居ないので match=0 → そのまま action 実行に進む。
    const { state, getDef } = setupScene();
    const effect = attackerDef().effects![0]!;
    const stateAfterPending = executeEffect({
      chainId: "test:redirect-effect-target:1739",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    });
    const pending = stateAfterPending.pendingTargetRedirects[0]!;
    const result = applyLegalAction({
      state: stateAfterPending,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: TOKEN_B,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in result)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    // 再起動後に新しい pending は発行されていない
    expect(result.state.pendingTargetRedirects).toHaveLength(0);
    // bp_modify が TOKEN_B に対して 1 件のみ
    const bpCEs = result.state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCEs).toHaveLength(1);
    expect(bpCEs[0]?.targetInstanceId).toBe(TOKEN_B);
  });

  it("自分側効果は redirect されない (sourcePlayerRef='opponent' ガード)", () => {
    const { state, getDef } = setupScene();
    const effect = attackerDef().effects![0]!;
    // attacker は本来 BOB のカードだが ALICE が actingPlayer として駆動した場合
    // → 同じプレイヤー側 → redirect skip
    const result = executeEffect({
      chainId: "test:redirect-effect-target:1785",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(result.pendingTargetRedirects).toHaveLength(0);
    // bp_modify CE が直接登録される (target は filter で player=opponent → ALICE 視点で
    // BOB だが、BOB のフィールドにはスピリットが居ない → CE 登録は 0 件 or 別カード対象)
    // 重要なのは pending が出ない事のみ
  });
});

// ====================================================================
// Step 5: 単体テスト網羅 (token 削除追従 / 本体離脱 / 多重 redirect collapse /
//                       既存 attack redirect 非干渉 / multi-target sibling)
// ====================================================================
//
// Step 3b までで pending 発行 → confirm/decline → continuation 経路は確認済み。
// Step 5 では追加で次の 5 観点をカバーする:
//
// 1. token 集合変動: 一部 token が field 不在になり act_as_spirit CE が除去された後、
//    redirect 候補集合は残る token だけになる (動的解決の確認)
// 2. 本体離脱: host が field を離れると while_on_field の redirect_effect_target CE が
//    recomputeContinuousEffects で自動除去される (= 以降 findApplicableTargetRedirects
//    が match を返さない)
// 3. 多重 redirect: 同時に複数 host を保護対象に取った効果について、先に
//    confirm された redirect が同じ target slice 全体を collapse する
// 4. 既存 attack redirect_target との非干渉: state.activeAttack に対する redirect は
//    pendingTargetRedirects とは別経路で処理され、両 CE が共存しても衝突しない
// 5. multi-target sibling collapse: 同 step で resolved=[host, 他対象] の場合、
//    同じ target slice の field S/U/B/N を replacement 1 体へ collapse する
describe("P3-47 F-4 Step 5: 単体テスト網羅", () => {
  function frandolleHostDef(): CardDefinition {
    return {
      cardNo: "FRANDOLLE-HOST",
      name: "フランドール・スカーレット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 7,
      cost: 7,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
  }

  function tokenDef(): CardDefinition {
    return {
      cardNo: "TEST-NEXUS",
      name: "Test Nexus",
      printedCategory: "nexus",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 0,
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
  }

  function attackerBpModifyMultiDef(count: number): CardDefinition {
    // 相手スピリット count 体に BP-3000。multi-target / 多重 redirect テストで使用。
    // count=-1 ("all") も resolveTargetCards で preSelectedIds を honor するため
    // (P3-47 F-4 Step 6 後の修正)、count に -1 を渡しても redirect は反映される。
    return {
      cardNo: `OPP-ATTACK-${count}`,
      name: `相手${count}体BPダウン`,
      printedCategory: "spirit",
      printedColors: ["blue"],
      symbolColors: ["blue"],
      printedCost: 3,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["blue"],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count,
                  filter: { category: ["spirit"] },
                },
                amount: -3000,
                duration: { scope: "turn" },
              },
            },
          ],
        },
      ],
    } as CardDefinition;
  }

  function attackerBpModifyOptionalRepeatDef(): CardDefinition {
    return {
      cardNo: "OPP-ATTACK-REPEAT",
      name: "相手任意追加BPダウン",
      printedCategory: "spirit",
      printedColors: ["blue"],
      symbolColors: ["blue"],
      printedCost: 3,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["blue"],
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 1,
                  filter: { category: ["spirit"] },
                },
                amount: -3000,
                duration: { scope: "turn" },
              },
              repeat: { additional: 1, optional: true },
            },
          ],
        },
      ],
    } as CardDefinition;
  }

  function makeRedirectCEForHost(args: {
    effectId: string;
    hostInstanceId: string;
    actingPlayerId: string;
  }): ContinuousEffect {
    return {
      effectId: args.effectId,
      sourceInstanceId: args.hostInstanceId,
      sourceDefinitionId: "FRANDOLLE-HOST",
      actingPlayerId: args.actingPlayerId,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "redirect_effect_target" as ContinuousEffectTag,
      metadata: {
        triggerCondition: {
          sourcePlayerRef: "opponent",
          protectedTargetKind: "self",
        },
        redirectCandidateSource: { kind: "associated_act_as_spirit" },
        optional: true,
      } as Record<string, unknown>,
    };
  }

  function makeRedirectCEForHostToExplicitCandidates(args: {
    effectId: string;
    hostInstanceId: string;
    actingPlayerId: string;
    candidateInstanceIds: string[];
  }): ContinuousEffect {
    return {
      effectId: args.effectId,
      sourceInstanceId: args.hostInstanceId,
      sourceDefinitionId: "FRANDOLLE-HOST",
      actingPlayerId: args.actingPlayerId,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "redirect_effect_target" as ContinuousEffectTag,
      metadata: {
        triggerCondition: {
          sourcePlayerRef: "opponent",
          protectedTargetKind: "self",
        },
        redirectCandidateSource: {
          kind: "explicit",
          instanceIds: args.candidateInstanceIds,
        },
        optional: true,
      } as Record<string, unknown>,
    };
  }

  function makeActAsSpiritCEForToken(args: {
    effectId: string;
    hostInstanceId: string;
    tokenInstanceId: string;
  }): ContinuousEffect {
    return {
      effectId: args.effectId,
      sourceInstanceId: args.hostInstanceId,
      sourceDefinitionId: "FRANDOLLE-HOST",
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "act_as_spirit" as ContinuousEffectTag,
      targetInstanceId: args.tokenInstanceId,
      metadata: {
        statBlueprint: {
          kind: "live_copy_from",
          sourceInstanceId: args.hostInstanceId,
          aspects: ["currentLv"],
        },
      } as Record<string, unknown>,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Test 1: token 削除追従 — 一部 token が field 不在 → act_as_spirit CE 除去 →
  //         findApplicableTargetRedirects の candidate 集合が縮む
  // ─────────────────────────────────────────────────────────────────
  it("token 削除追従: token 1 体が field 不在になると candidate から除外される", () => {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    // TOKEN_A は trash (= field 不在), TOKEN_B/C は field
    const tokenAGone = createCardInstance(tokenDef(), {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "trash",
      cores: 0,
    });
    const tokenB = createCardInstance(tokenDef(), {
      instanceId: TOKEN_B,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const tokenC = createCardInstance(tokenDef(), {
      instanceId: TOKEN_C,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const ceList: ContinuousEffect[] = [
      makeRedirectCEForHost({
        effectId: "ce-redirect",
        hostInstanceId: "host-1",
        actingPlayerId: ALICE,
      }),
      // TOKEN_A の act_as_spirit CE は登録されているが、target が field 外
      // (recomputeContinuousEffects で除去対象)
      makeActAsSpiritCEForToken({
        effectId: "ce-as-spirit-a",
        hostInstanceId: "host-1",
        tokenInstanceId: TOKEN_A,
      }),
      makeActAsSpiritCEForToken({
        effectId: "ce-as-spirit-b",
        hostInstanceId: "host-1",
        tokenInstanceId: TOKEN_B,
      }),
      makeActAsSpiritCEForToken({
        effectId: "ce-as-spirit-c",
        hostInstanceId: "host-1",
        tokenInstanceId: TOKEN_C,
      }),
    ];
    const stateBefore: GameState = {
      ...baseState,
      activePlayerId: BOB,
      cardInstances: [host, tokenAGone, tokenB, tokenC],
      activeContinuousEffects: ceList,
    };
    // recompute は targetInstanceId 持ちの CE について target が field 不在なら除去するので、
    // TOKEN_A の act_as_spirit CE が消える (target=TOKEN_A が trash)
    const stateAfter = recomputeContinuousEffects(stateBefore);

    const matches = findApplicableTargetRedirects(stateAfter, ["host-1"], BOB);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.candidateTokenInstanceIds.sort()).toEqual(
      [TOKEN_B, TOKEN_C].sort()
    );
    expect(matches[0]?.candidateTokenInstanceIds).not.toContain(TOKEN_A);
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 2: 本体離脱 — host が field を離れると while_on_field の
  //         redirect_effect_target CE が recompute で除去 → match 不在
  // ─────────────────────────────────────────────────────────────────
  it("本体離脱: while_on_field の redirect CE は host が field 不在で自動除去", () => {
    const hostGone = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "trash",
      cores: 0,
    });
    const tokenB = createCardInstance(tokenDef(), {
      instanceId: TOKEN_B,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const ceList: ContinuousEffect[] = [
      makeRedirectCEForHost({
        effectId: "ce-redirect",
        hostInstanceId: "host-1",
        actingPlayerId: ALICE,
      }),
      makeActAsSpiritCEForToken({
        effectId: "ce-as-spirit-b",
        hostInstanceId: "host-1",
        tokenInstanceId: TOKEN_B,
      }),
    ];
    const stateBefore: GameState = {
      ...baseState,
      activePlayerId: BOB,
      cardInstances: [hostGone, tokenB],
      activeContinuousEffects: ceList,
    };
    const stateAfter = recomputeContinuousEffects(stateBefore);

    // redirect_effect_target / act_as_spirit ともに sourceInstanceId=host-1 の
    // while_on_field なので host 不在で除去される。
    expect(
      stateAfter.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "redirect_effect_target"
      )
    ).toHaveLength(0);
    // host-1 を対象にしても match なし
    const matches = findApplicableTargetRedirects(stateAfter, ["host-1"], BOB);
    expect(matches).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 3: 多重 redirect — 2 host が共に対象集合に含まれる場合、executeEffect は
  //         先頭 match を pending 化する。confirm 後は同じ target slice 全体を
  //         replacement 1 体へ collapse する。
  // ─────────────────────────────────────────────────────────────────
  it("多重 redirect: 2 host を同時に対象 → 1 件目 confirm で target slice 全体を collapse", () => {
    const host1 = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const host2 = createCardInstance(frandolleHostDef(), {
      instanceId: "host-2",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokenA = createCardInstance(tokenDef(), {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const tokenB = createCardInstance(tokenDef(), {
      instanceId: TOKEN_B,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const attacker = createCardInstance(attackerBpModifyMultiDef(2), {
      instanceId: "attacker-1",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const ceList: ContinuousEffect[] = [
      makeRedirectCEForHost({
        effectId: "ce-redirect-1",
        hostInstanceId: "host-1",
        actingPlayerId: ALICE,
      }),
      makeRedirectCEForHost({
        effectId: "ce-redirect-2",
        hostInstanceId: "host-2",
        actingPlayerId: ALICE,
      }),
      makeActAsSpiritCEForToken({
        effectId: "ce-as-spirit-a",
        hostInstanceId: "host-1",
        tokenInstanceId: TOKEN_A,
      }),
      makeActAsSpiritCEForToken({
        effectId: "ce-as-spirit-b",
        hostInstanceId: "host-2",
        tokenInstanceId: TOKEN_B,
      }),
    ];
    const state: GameState = {
      ...baseState,
      activePlayerId: BOB,
      cardInstances: [host1, host2, tokenA, tokenB, attacker],
      activeContinuousEffects: ceList,
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": tokenDef(),
      "OPP-ATTACK-2": attackerBpModifyMultiDef(2),
    };
    const getDef = (id: string) => defs[id];

    const effect = attackerBpModifyMultiDef(2).effects![0]!;
    // 1 件目 pending: host-1 を redirect 契機として発行 (先頭は detect 順 = ce-redirect-1)
    const stateAfterFirst = executeEffect({
      chainId: "test:redirect-effect-target:2217",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    });
    expect(stateAfterFirst.pendingTargetRedirects).toHaveLength(1);
    const firstPending = stateAfterFirst.pendingTargetRedirects[0]!;
    expect(firstPending.redirectableInstanceId).toBe("host-1");

    // confirm host-1 → TOKEN_A に redirect。同じ target slice 内の host-2 も
    // TOKEN_A へ collapse されるため、ce-redirect-2 の pending は新規発火しない。
    const afterConfirm = applyLegalAction({
      state: stateAfterFirst,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${firstPending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: firstPending.pendingId,
        originalResolvedInstanceIds: firstPending.originalResolvedInstanceIds,
        redirectableInstanceId: firstPending.redirectableInstanceId,
        candidateTokenInstanceIds: firstPending.candidateTokenInstanceIds,
        sourceEffectInstanceId: firstPending.sourceEffectInstanceId,
        sourceEffectDefinitionId: firstPending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: TOKEN_A,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in afterConfirm)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(afterConfirm.state.pendingTargetRedirects).toHaveLength(0);
    const bpTargets = afterConfirm.state.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "bp_modifier")
      .map((ce) => ce.targetInstanceId);
    expect(bpTargets).toEqual([TOKEN_A]);
    expect(bpTargets).not.toContain("host-1");
    expect(bpTargets).not.toContain("host-2");
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 4: 既存 attack redirect_target (state.activeAttack) との非干渉
  //         — pendingTargetRedirects と activeAttack 経路は完全に独立。
  //         本テストでは redirect_effect_target CE が活きている状態でも
  //         findApplicableTargetRedirects の判定は activeAttack の有無に
  //         依存せず、effect 対象集合のみで決まることを確認する。
  // ─────────────────────────────────────────────────────────────────
  it("既存 attack redirect_target との非干渉: pendingTargetRedirects は activeAttack に影響されない", () => {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokenA = createCardInstance(tokenDef(), {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const ceList: ContinuousEffect[] = [
      makeRedirectCEForHostToExplicitCandidates({
        effectId: "ce-redirect",
        hostInstanceId: "host-1",
        actingPlayerId: ALICE,
        candidateInstanceIds: [TOKEN_A],
      }),
    ];
    // activeAttack を立てた状態で findApplicableTargetRedirects を呼ぶ。
    // attack target は state.activeAttack に紐づくが、findApplicableTargetRedirects は
    // 効果対象集合 (resolvedInstanceIds 引数) しか参照しないので両者は混線しない。
    const stateWithAttack: GameState = {
      ...baseState,
      activePlayerId: BOB,
      cardInstances: [host, tokenA],
      activeContinuousEffects: ceList,
      activeAttack: {
        attackId: "atk-1",
        attackerInstanceId: "host-1",
        attackerOwnerId: BOB,
        target: { kind: "battle_entity", entityId: "host-1" },
      } as GameState["activeAttack"],
    };
    // 効果対象としても host-1 が含まれる場合 → match 1 件 (effect redirect)
    const effectMatches = findApplicableTargetRedirects(
      stateWithAttack,
      ["host-1"],
      BOB
    );
    expect(effectMatches).toHaveLength(1);
    // 効果対象に host-1 が含まれなければ activeAttack.target が host-1 でも match 0 件
    // (effect target redirect は activeAttack を読まない = 非干渉)
    const noEffectMatches = findApplicableTargetRedirects(
      stateWithAttack,
      ["unrelated-card"],
      BOB
    );
    expect(noEffectMatches).toHaveLength(0);
    // pendingTargetRedirects は activeAttack を変更しない (純粋に effect 対象差し替え)
    // = state.activeAttack は不変
    expect(stateWithAttack.activeAttack?.target).toEqual({
      kind: "battle_entity",
      entityId: "host-1",
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 5: multi-target sibling collapse — 同 step で resolved=[host, 他対象] のとき、
  //         同じ target slice の field S/U/B/N を replacement 1 体へ collapse
  //
  // NOTE: count="all" + while_on_field 動的フィルタ CE / count=-1 の resolveTargetCards
  // bypass パスでは preSelectedIds が無視されるため、count=N (N>=1) の通常パスで検証する。
  // 本テストでは count=2 を使い「相手スピリット 2 体に BP-3000」を表現する。
  // ─────────────────────────────────────────────────────────────────
  it("multi-target sibling collapse: BP-3000 (host + 他相手スピリット 1 体, count=2) → replacement 1 体へ collapse", () => {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokenA = createCardInstance(tokenDef(), {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    // ALICE 側にもう 1 体スピリットを field に配置 (同じ target slice なので collapse 対象)
    const otherSpiritDef: CardDefinition = {
      cardNo: "OTHER-SPIRIT",
      name: "無関係スピリット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 2,
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
    const otherSpirit = createCardInstance(otherSpiritDef, {
      instanceId: "other-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const attacker = createCardInstance(attackerBpModifyMultiDef(2), {
      instanceId: "attacker-1",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const ceList: ContinuousEffect[] = [
      makeRedirectCEForHostToExplicitCandidates({
        effectId: "ce-redirect",
        hostInstanceId: "host-1",
        actingPlayerId: ALICE,
        candidateInstanceIds: [TOKEN_A],
      }),
    ];
    const state: GameState = {
      ...baseState,
      activePlayerId: BOB,
      cardInstances: [host, tokenA, otherSpirit, attacker],
      activeContinuousEffects: ceList,
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": tokenDef(),
      "OTHER-SPIRIT": otherSpiritDef,
      "OPP-ATTACK-2": attackerBpModifyMultiDef(2),
    };
    const getDef = (id: string) => defs[id];

    const effect = attackerBpModifyMultiDef(2).effects![0]!;
    const stateAfterPending = executeEffect({
      chainId: "test:redirect-effect-target:2404",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    });
    expect(stateAfterPending.pendingTargetRedirects).toHaveLength(1);
    const pending = stateAfterPending.pendingTargetRedirects[0]!;
    expect(pending.redirectableInstanceId).toBe("host-1");
    // 元集合は host-1 と other-spirit の両方を含む。TOKEN_A は裏向き・付与なしのため
    // category="spirit" filter には含まれず、explicit redirect candidate としてだけ扱う。
    expect(pending.originalResolvedInstanceIds.sort()).toEqual(
      ["host-1", "other-spirit"].sort()
    );
    expect(pending.redirectableInstanceIds?.sort()).toEqual(
      ["host-1", "other-spirit"].sort()
    );

    // confirm: 同時指定された field target を TOKEN_A 1体へ collapse
    const result = applyLegalAction({
      state: stateAfterPending,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: TOKEN_A,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in result)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(result.redirected).toBe(true);
    expect(result.resolvedAfterRedirect).toEqual([TOKEN_A]);
    // bp_modify CE は replacement 1体だけに着く (host-1/other-spirit ではない)
    const bpCEs = result.state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier"
    );
    expect(bpCEs).toHaveLength(1);
    const bpTargets = bpCEs.map((ce) => ce.targetInstanceId).sort();
    expect(bpTargets).toEqual([TOKEN_A]);
    expect(bpTargets).not.toContain("host-1");
    expect(bpTargets).not.toContain("other-spirit");
  });

  it("optional repeat の事前選択対象は base redirect 後も continuation に保持される", () => {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokenA = createCardInstance(tokenDef(), {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const otherSpiritDef: CardDefinition = {
      cardNo: "OTHER-SPIRIT",
      name: "無関係スピリット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 2,
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
    const otherSpirit = createCardInstance(otherSpiritDef, {
      instanceId: "other-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const repeatAttackerDef = attackerBpModifyOptionalRepeatDef();
    const attacker = createCardInstance(repeatAttackerDef, {
      instanceId: "attacker-1",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...baseState,
      activePlayerId: BOB,
      cardInstances: [host, tokenA, otherSpirit, attacker],
      activeContinuousEffects: [
        makeRedirectCEForHostToExplicitCandidates({
          effectId: "ce-redirect",
          hostInstanceId: "host-1",
          actingPlayerId: ALICE,
          candidateInstanceIds: [TOKEN_A],
        }),
      ],
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": tokenDef(),
      "OTHER-SPIRIT": otherSpiritDef,
      "OPP-ATTACK-REPEAT": repeatAttackerDef,
    };
    const getDef = (id: string) => defs[id];

    const stateAfterPending = executeEffect({
      chainId: "test:redirect-effect-target:2524",
      state,
      effect: repeatAttackerDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      choiceIndex: 1,
      targetStepId: "__step_0",
      targetInstanceIds: ["host-1", "other-spirit"],
    });
    expect(stateAfterPending.pendingTargetRedirects).toHaveLength(1);
    const pending = stateAfterPending.pendingTargetRedirects[0]!;
    expect(pending.originalResolvedInstanceIds).toEqual(["host-1"]);
    expect(pending.continuation?.targetInstanceIds).toEqual([
      "host-1",
      "other-spirit",
    ]);
    expect(pending.continuation?.targetStepId).toBe("__step_0");
    expect(pending.continuation?.choiceIndex).toBe(1);
    expect(pending.continuation?.redirectTargetCount).toBe(1);

    const result = applyLegalAction({
      state: stateAfterPending,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: TOKEN_A,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in result)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(result.redirected).toBe(true);
    expect(result.state.pendingTargetRedirects).toHaveLength(0);
    const bpTargets = result.state.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "bp_modifier")
      .map((ce) => ce.targetInstanceId)
      .sort();
    expect(bpTargets).toEqual([TOKEN_A, "other-spirit"].sort());
    expect(bpTargets).not.toContain("host-1");
  });

  it("optional repeat の追加発揮対象も redirect gate を通る", () => {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokenA = createCardInstance(tokenDef(), {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const otherSpiritDef: CardDefinition = {
      cardNo: "OTHER-SPIRIT",
      name: "無関係スピリット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 2,
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
    const otherSpirit = createCardInstance(otherSpiritDef, {
      instanceId: "other-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const repeatAttackerDef = attackerBpModifyOptionalRepeatDef();
    const attacker = createCardInstance(repeatAttackerDef, {
      instanceId: "attacker-1",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...baseState,
      activePlayerId: BOB,
      cardInstances: [host, tokenA, otherSpirit, attacker],
      activeContinuousEffects: [
        makeRedirectCEForHost({
          effectId: "ce-redirect",
          hostInstanceId: "host-1",
          actingPlayerId: ALICE,
        }),
        makeActAsSpiritCEForToken({
          effectId: "ce-as-spirit-a",
          hostInstanceId: "host-1",
          tokenInstanceId: TOKEN_A,
        }),
      ],
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": tokenDef(),
      "OTHER-SPIRIT": otherSpiritDef,
      "OPP-ATTACK-REPEAT": repeatAttackerDef,
    };
    const getDef = (id: string) => defs[id];

    const stateAfterPending = executeEffect({
      chainId: "test:redirect-effect-target:2646",
      state,
      effect: repeatAttackerDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      choiceIndex: 1,
      targetStepId: "__step_0",
      targetInstanceIds: ["other-spirit", "host-1"],
    });
    expect(stateAfterPending.pendingTargetRedirects).toHaveLength(1);
    const pending = stateAfterPending.pendingTargetRedirects[0]!;
    expect(pending.originalResolvedInstanceIds).toEqual(["host-1"]);
    expect(pending.continuation?.targetInstanceIds).toEqual([
      "other-spirit",
      "host-1",
    ]);
    expect(pending.continuation?.redirectTargetStart).toBe(1);
    expect(pending.continuation?.redirectTargetCount).toBe(1);
    const beforeConfirmBpTargets = stateAfterPending.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "bp_modifier")
      .map((ce) => ce.targetInstanceId);
    expect(beforeConfirmBpTargets).toHaveLength(0);

    const result = applyLegalAction({
      state: stateAfterPending,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: TOKEN_A,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in result)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(result.redirected).toBe(true);
    const bpTargets = result.state.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "bp_modifier")
      .map((ce) => ce.targetInstanceId)
      .sort();
    expect(bpTargets).toEqual([TOKEN_A, "other-spirit"].sort());
    expect(bpTargets).not.toContain("host-1");
  });

  it("optional repeat で同じ protected target を2回選んだ場合、confirm 後の追加 slice でも redirect pending を出す", () => {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokenA = createCardInstance(tokenDef(), {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const repeatAttackerDef = attackerBpModifyOptionalRepeatDef();
    const attacker = createCardInstance(repeatAttackerDef, {
      instanceId: "attacker-1",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...baseState,
      activePlayerId: BOB,
      cardInstances: [host, tokenA, attacker],
      activeContinuousEffects: [
        makeRedirectCEForHost({
          effectId: "ce-redirect",
          hostInstanceId: "host-1",
          actingPlayerId: ALICE,
        }),
        makeActAsSpiritCEForToken({
          effectId: "ce-as-spirit-a",
          hostInstanceId: "host-1",
          tokenInstanceId: TOKEN_A,
        }),
      ],
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": tokenDef(),
      "OPP-ATTACK-REPEAT": repeatAttackerDef,
    };
    const getDef = (id: string) => defs[id];

    const firstPendingState = executeEffect({
      chainId: "test:redirect-effect-target:2748",
      state,
      effect: repeatAttackerDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      choiceIndex: 1,
      targetStepId: "__step_0",
      targetInstanceIds: ["host-1", "host-1"],
    });
    expect(firstPendingState.pendingTargetRedirects).toHaveLength(1);
    const firstPending = firstPendingState.pendingTargetRedirects[0]!;
    expect(firstPending.continuation?.redirectTargetStart).toBe(0);
    expect(firstPending.continuation?.targetInstanceIds).toEqual([
      "host-1",
      "host-1",
    ]);

    const afterFirstConfirm = applyLegalAction({
      state: firstPendingState,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${firstPending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: firstPending.pendingId,
        originalResolvedInstanceIds: firstPending.originalResolvedInstanceIds,
        redirectableInstanceId: firstPending.redirectableInstanceId,
        candidateTokenInstanceIds: firstPending.candidateTokenInstanceIds,
        sourceEffectInstanceId: firstPending.sourceEffectInstanceId,
        sourceEffectDefinitionId: firstPending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: TOKEN_A,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in afterFirstConfirm)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(afterFirstConfirm.state.pendingTargetRedirects).toHaveLength(1);
    const secondPending = afterFirstConfirm.state.pendingTargetRedirects[0]!;
    expect(secondPending.redirectEffectId).toBe("ce-redirect");
    expect(secondPending.continuation?.redirectTargetStart).toBe(1);

    const afterSecondConfirm = applyLegalAction({
      state: afterFirstConfirm.state,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${secondPending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: secondPending.pendingId,
        originalResolvedInstanceIds: secondPending.originalResolvedInstanceIds,
        redirectableInstanceId: secondPending.redirectableInstanceId,
        candidateTokenInstanceIds: secondPending.candidateTokenInstanceIds,
        sourceEffectInstanceId: secondPending.sourceEffectInstanceId,
        sourceEffectDefinitionId: secondPending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: TOKEN_A,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in afterSecondConfirm)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(afterSecondConfirm.state.pendingTargetRedirects).toHaveLength(0);
    const bpTargets = afterSecondConfirm.state.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "bp_modifier")
      .map((ce) => ce.targetInstanceId)
      .sort();
    expect(bpTargets).toEqual([TOKEN_A, TOKEN_A].sort());
    expect(bpTargets).not.toContain("host-1");
  });

  it("count=-1 (all) でも redirect 後の対象集合で snapshot BP- を登録する", () => {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokenA = createCardInstance(tokenDef(), {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const otherSpiritDef: CardDefinition = {
      cardNo: "OTHER-SPIRIT",
      name: "無関係スピリット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 2,
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
    const otherSpirit = createCardInstance(otherSpiritDef, {
      instanceId: "other-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const attacker = createCardInstance(attackerBpModifyMultiDef(-1), {
      instanceId: "attacker-1",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const lateDef: CardDefinition = {
      ...otherSpiritDef,
      cardNo: "LATE-SPIRIT",
      name: "後続スピリット",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
    };
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const ceList: ContinuousEffect[] = [
      makeRedirectCEForHostToExplicitCandidates({
        effectId: "ce-redirect",
        hostInstanceId: "host-1",
        actingPlayerId: ALICE,
        candidateInstanceIds: [TOKEN_A],
      }),
    ];
    const state: GameState = {
      ...baseState,
      activePlayerId: BOB,
      cardInstances: [host, tokenA, otherSpirit, attacker],
      activeContinuousEffects: ceList,
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": tokenDef(),
      "OTHER-SPIRIT": otherSpiritDef,
      "LATE-SPIRIT": lateDef,
      "OPP-ATTACK--1": attackerBpModifyMultiDef(-1),
    };
    const getDef = (id: string) => defs[id];

    const effect = attackerBpModifyMultiDef(-1).effects![0]!;
    const stateAfterPending = executeEffect({
      chainId: "test:redirect-effect-target:2897",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    });
    expect(stateAfterPending.pendingTargetRedirects).toHaveLength(1);
    const pending = stateAfterPending.pendingTargetRedirects[0]!;
    expect(pending.originalResolvedInstanceIds.sort()).toEqual(
      ["host-1", "other-spirit"].sort()
    );
    expect(pending.redirectableInstanceIds?.sort()).toEqual(
      ["host-1", "other-spirit"].sort()
    );
    expect(pending.candidateTokenInstanceIds).toEqual([TOKEN_A]);

    const afterConfirm = applyLegalAction({
      state: stateAfterPending,
      action: {
        kind: "confirm_target_redirect",
        actionId: `redirect-confirm-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: pending.pendingId,
        originalResolvedInstanceIds: pending.originalResolvedInstanceIds,
        redirectableInstanceId: pending.redirectableInstanceId,
        candidateTokenInstanceIds: pending.candidateTokenInstanceIds,
        sourceEffectInstanceId: pending.sourceEffectInstanceId,
        sourceEffectDefinitionId: pending.sourceEffectDefinitionId,
      },
      redirectTargetReplacementInstanceId: TOKEN_A,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in afterConfirm)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(afterConfirm.state.pendingTargetRedirects).toHaveLength(0);
    const bpTargets = afterConfirm.state.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "bp_modifier")
      .map((ce) => ce.targetInstanceId)
      .sort();
    expect(bpTargets).toEqual([TOKEN_A]);
    expect(bpTargets).not.toContain("host-1");
    expect(bpTargets).not.toContain("other-spirit");
    expect(
      afterConfirm.state.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag === "bp_modifier" && ce.targetFilter !== undefined
      )
    ).toHaveLength(0);
  });

  it("count=-1 (all) の redirect decline は元の動的BP-を登録し、後続召喚にも適用される", () => {
    const host = createCardInstance(frandolleHostDef(), {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 3,
    });
    const tokenA = createCardInstance(tokenDef(), {
      instanceId: TOKEN_A,
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
      cores: 1,
    });
    const otherSpiritDef: CardDefinition = {
      cardNo: "OTHER-SPIRIT",
      name: "無関係スピリット",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 2,
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["red"],
    } as CardDefinition;
    const otherSpirit = createCardInstance(otherSpiritDef, {
      instanceId: "other-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const attacker = createCardInstance(attackerBpModifyMultiDef(-1), {
      instanceId: "attacker-1",
      ownerPlayerId: BOB,
      zone: "field",
      cores: 1,
    });
    const lateDef: CardDefinition = {
      ...otherSpiritDef,
      cardNo: "LATE-SPIRIT",
      name: "後続スピリット",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
    };
    const baseState = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const state: GameState = {
      ...baseState,
      activePlayerId: BOB,
      cardInstances: [host, tokenA, otherSpirit, attacker],
      activeContinuousEffects: [
        makeRedirectCEForHostToExplicitCandidates({
          effectId: "ce-redirect",
          hostInstanceId: "host-1",
          actingPlayerId: ALICE,
          candidateInstanceIds: [TOKEN_A],
        }),
      ],
    };
    const defs: Record<string, CardDefinition> = {
      "FRANDOLLE-HOST": frandolleHostDef(),
      "TEST-NEXUS": tokenDef(),
      "OTHER-SPIRIT": otherSpiritDef,
      "LATE-SPIRIT": lateDef,
      "OPP-ATTACK--1": attackerBpModifyMultiDef(-1),
    };
    const getDef = (id: string) => defs[id];

    const stateAfterPending = executeEffect({
      chainId: "test:redirect-effect-target:3023",
      state,
      effect: attackerBpModifyMultiDef(-1).effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "attacker-1",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    });
    expect(stateAfterPending.pendingTargetRedirects).toHaveLength(1);
    const pending = stateAfterPending.pendingTargetRedirects[0]!;

    const declineResult = applyLegalAction({
      state: stateAfterPending,
      action: {
        kind: "decline_target_redirect",
        actionId: `redirect-decline-${pending.pendingId}`,
        can: true,
        reason: "pending_target_redirect",
        actingPlayerId: ALICE,
        pendingId: pending.pendingId,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });
    if (!("redirected" in declineResult)) {
      throw new Error("expected ResolveTargetRedirectResult");
    }
    expect(declineResult.redirected).toBe(false);
    expect(declineResult.state.pendingTargetRedirects).toHaveLength(0);

    const globalBpCEs = declineResult.state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "bp_modifier" && ce.targetFilter !== undefined
    );
    expect(globalBpCEs).toHaveLength(1);
    expect(globalBpCEs[0]?.targetInstanceId).toBeUndefined();

    const late = createCardInstance(lateDef, {
      instanceId: "late-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const withLate: GameState = {
      ...declineResult.state,
      cardInstances: [...declineResult.state.cardInstances, late],
    };
    expect(getEffectiveBp(withLate, late, lateDef, getDef)).toBe(3000);
  });
});

// ====================================================================
// 拡張: owned_filter protectedTarget/redirectCandidate + usageLimit
// (BSLH01-R02 美臭「ターンに1回、自分のスピリットが相手のスピリットの効果の対象になるとき、
//  その対象を自分が選ぶ自分のスピリット1体のみに変更できる」)
//
// フランドールの "self"/"associated_act_as_spirit" と異なり、保護対象・候補ともに
// 「自分の現在のスピリット全体」という召喚/離脱で増減する集合のため、登録時点の
// 固定リストではなく matchtime (findApplicableTargetRedirects /
// resolveRedirectCandidateInstanceIds) に CardFilter を都度再評価する owned_filter kind。
// 加えて「ターンに1回」の usageLimit を redirect 自体に初めて導入する。
// ====================================================================
describe("P3-47 F-4 拡張: owned_filter kind + usageLimit", () => {
  function spiritDef(cardNo: string): CardDefinition {
    return {
      cardNo,
      name: cardNo,
      printedCategory: "spirit",
      printedColors: ["green"],
      symbolColors: ["green"],
      printedCost: 3,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      textLines: [],
      images: {},
      tribe: "",
      colors: ["green"],
    } as CardDefinition;
  }

  const OWNED_FILTER_META: RedirectEffectTargetMetadata = {
    triggerCondition: {
      sourcePlayerRef: "opponent",
      protectedTargetKind: "owned_filter",
      filter: { category: ["spirit"] },
    },
    redirectCandidateSource: {
      kind: "owned_filter",
      filter: { category: ["spirit"] },
    },
    optional: true,
  };

  function ownedFilterCE(args: {
    effectId: string;
    sourceInstanceId: string;
    actingPlayerId?: string;
    usageLimit?: import("../src/model").EffectUsageLimit;
    sourceFilter?: import("../src/dsl-types").CardFilter;
  }): ContinuousEffect {
    return {
      effectId: args.effectId,
      sourceInstanceId: args.sourceInstanceId,
      sourceDefinitionId: "QUARTZ-R02",
      actingPlayerId: args.actingPlayerId ?? ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "redirect_effect_target" as ContinuousEffectTag,
      metadata: {
        ...OWNED_FILTER_META,
        triggerCondition: {
          ...OWNED_FILTER_META.triggerCondition,
          ...(args.sourceFilter ? { sourceFilter: args.sourceFilter } : {}),
        },
        ...(args.usageLimit ? { usageLimit: args.usageLimit } : {}),
      } as unknown as Record<string, unknown>,
    };
  }

  function makeScene(
    usageLimit?: import("../src/model").EffectUsageLimit,
    sourceFilter?: import("../src/dsl-types").CardFilter
  ): {
    state: GameState;
    getDef: (id: string) => CardDefinition | undefined;
  } {
    const host = createCardInstance(spiritDef("HOST-R02"), {
      instanceId: "host",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    // R02 自身はクォーツスロット (zoneRoleName:"quartz") にセットされている魂状態カード。
    // 「自分のスピリット」候補プールには含まれない。
    const quartzCard = createCardInstance(spiritDef("R02"), {
      instanceId: "r02",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "quartz",
    });
    const allyA = createCardInstance(spiritDef("ALLY-A"), {
      instanceId: "ally-a",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const allyB = createCardInstance(spiritDef("ALLY-B"), {
      instanceId: "ally-b",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const ce = ownedFilterCE({
      effectId: "ce-r02",
      sourceInstanceId: "r02",
      ...(usageLimit ? { usageLimit } : {}),
      ...(sourceFilter ? { sourceFilter } : {}),
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [host, quartzCard, allyA, allyB],
      activeContinuousEffects: [ce],
    };
    const defs: Record<string, CardDefinition> = {
      "HOST-R02": spiritDef("HOST-R02"),
      R02: spiritDef("R02"),
      "ALLY-A": spiritDef("ALLY-A"),
      "ALLY-B": spiritDef("ALLY-B"),
    };
    return { state, getDef: (id) => defs[id] };
  }

  it("resolveRedirectCandidateInstanceIds: owned_filter は controller 一致 + filter 一致の field カードを動的に返す (quartz スロット自身は除外)", () => {
    const { state, getDef } = makeScene();
    const ce = state.activeContinuousEffects[0]!;
    const ids = resolveRedirectCandidateInstanceIds(state, ce, getDef);
    expect(ids.sort()).toEqual(["ally-a", "ally-b", "host"].sort());
    expect(ids).not.toContain("r02");
  });

  it("resolveRedirectCandidateInstanceIds: owned_filter は裏向きカードの印字スピリット情報を候補に漏らさない", () => {
    const { state, getDef } = makeScene();
    const faceDownAlly = createCardInstance(spiritDef("ALLY-FACE-DOWN"), {
      instanceId: "ally-face-down",
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
    });
    const withFaceDown: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, faceDownAlly],
    };
    const getDefWithFaceDown = (id: string): CardDefinition | undefined =>
      id === "ALLY-FACE-DOWN" ? spiritDef("ALLY-FACE-DOWN") : getDef(id);

    const ce = withFaceDown.activeContinuousEffects[0]!;
    const ids = resolveRedirectCandidateInstanceIds(
      withFaceDown,
      ce,
      getDefWithFaceDown
    );

    expect(ids).not.toContain("ally-face-down");
  });

  it("resolveRedirectCandidateInstanceIds: getCardDefinitionById 省略時は空配列 (フェイルクローズ)", () => {
    const { state } = makeScene();
    const ce = state.activeContinuousEffects[0]!;
    expect(resolveRedirectCandidateInstanceIds(state, ce)).toEqual([]);
  });

  // adversarial verifier round3 指摘: owned_filter kind 新設に伴い getRedirectEffectTargetsProtecting
  // (findApplicableTargetRedirects とは別の判定ロジックを持つ姉妹関数) が owned_filter を
  // 判定できていなかった SSOT 漏れを解消したことを固定する。
  it("getRedirectEffectTargetsProtecting: owned_filter は controller 一致 + filter 一致のカードを保護対象として拾う", () => {
    const { state, getDef } = makeScene();
    const found = getRedirectEffectTargetsProtecting(state, "ally-a", getDef);
    expect(found).toHaveLength(1);
    expect(found[0]?.effectId).toBe("ce-r02");
  });

  it("getRedirectEffectTargetsProtecting: owned_filter は quartz と裏向きカードを保護対象にしない", () => {
    const { state, getDef } = makeScene();
    const faceDownAlly = createCardInstance(spiritDef("ALLY-FACE-DOWN"), {
      instanceId: "ally-face-down",
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
    });
    const withFaceDown: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, faceDownAlly],
    };
    const getDefWithFaceDown = (id: string): CardDefinition | undefined =>
      id === "ALLY-FACE-DOWN" ? spiritDef("ALLY-FACE-DOWN") : getDef(id);

    expect(getRedirectEffectTargetsProtecting(state, "r02", getDef)).toEqual(
      []
    );
    expect(
      getRedirectEffectTargetsProtecting(
        withFaceDown,
        "ally-face-down",
        getDefWithFaceDown
      )
    ).toEqual([]);
  });

  it("getRedirectEffectTargetsProtecting: owned_filter は controller 不一致のカードは拾わない", () => {
    const { state, getDef } = makeScene();
    const oppSpirit = createCardInstance(spiritDef("OPP-SPIRIT-PROTECT"), {
      instanceId: "opp-spirit-protect",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const withOpp: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, oppSpirit],
    };
    const getDefWithOpp = (id: string): CardDefinition | undefined =>
      id === "OPP-SPIRIT-PROTECT"
        ? spiritDef("OPP-SPIRIT-PROTECT")
        : getDef(id);
    expect(
      getRedirectEffectTargetsProtecting(
        withOpp,
        "opp-spirit-protect",
        getDefWithOpp
      )
    ).toHaveLength(0);
  });

  it("getRedirectEffectTargetsProtecting: getCardDefinitionById 省略時は owned_filter CE を拾わない (フェイルクローズ)", () => {
    const { state } = makeScene();
    expect(getRedirectEffectTargetsProtecting(state, "ally-a")).toHaveLength(0);
  });

  it("findApplicableTargetRedirects: owned_filter で保護対象を動的に判定し、候補から保護対象自身と quartz スロットを除く", () => {
    const { state, getDef } = makeScene();
    const matches = findApplicableTargetRedirects(
      state,
      ["ally-a"],
      BOB,
      "none",
      undefined,
      getDef
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.protectedInstanceId).toBe("ally-a");
    expect(matches[0]?.candidateTokenInstanceIds.sort()).toEqual(
      ["ally-b", "host"].sort()
    );
  });

  it("findApplicableTargetRedirects: owned_filter は quartz と裏向きカードを保護対象にしない", () => {
    const { state, getDef } = makeScene();
    const faceDownAlly = createCardInstance(spiritDef("ALLY-FACE-DOWN"), {
      instanceId: "ally-face-down",
      ownerPlayerId: ALICE,
      zone: "field",
      faceDown: true,
    });
    const withFaceDown: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, faceDownAlly],
    };
    const getDefWithFaceDown = (id: string): CardDefinition | undefined =>
      id === "ALLY-FACE-DOWN" ? spiritDef("ALLY-FACE-DOWN") : getDef(id);

    expect(
      findApplicableTargetRedirects(
        state,
        ["r02"],
        BOB,
        "none",
        undefined,
        getDef
      )
    ).toEqual([]);
    expect(
      findApplicableTargetRedirects(
        withFaceDown,
        ["ally-face-down"],
        BOB,
        "none",
        undefined,
        getDefWithFaceDown
      )
    ).toEqual([]);
  });

  it("findApplicableTargetRedirects: 保護対象候補が召喚で増えても matchtime に追従する (固定リストでない)", () => {
    const { state, getDef } = makeScene();
    const allyC = createCardInstance(spiritDef("ALLY-C"), {
      instanceId: "ally-c",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const withNewAlly: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, allyC],
    };
    const getDefWithC = (id: string): CardDefinition | undefined =>
      id === "ALLY-C" ? spiritDef("ALLY-C") : getDef(id);
    const matches = findApplicableTargetRedirects(
      withNewAlly,
      ["ally-c"],
      BOB,
      "none",
      undefined,
      getDefWithC
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.protectedInstanceId).toBe("ally-c");
    expect(matches[0]?.candidateTokenInstanceIds.sort()).toEqual(
      ["ally-a", "ally-b", "host"].sort()
    );
  });

  it("findApplicableTargetRedirects: 相手所有のスピリットは owned_filter の保護対象にならない (controller 一致必須)", () => {
    const { state, getDef } = makeScene();
    const oppSpirit = createCardInstance(spiritDef("OPP-SPIRIT"), {
      instanceId: "opp-spirit",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const withOpp: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, oppSpirit],
    };
    const getDefWithOpp = (id: string): CardDefinition | undefined =>
      id === "OPP-SPIRIT" ? spiritDef("OPP-SPIRIT") : getDef(id);
    const matches = findApplicableTargetRedirects(
      withOpp,
      ["opp-spirit"],
      BOB,
      "none",
      undefined,
      getDefWithOpp
    );
    expect(matches).toHaveLength(0);
  });

  it("usageLimit: 未消費なら match するが、per_instance/turn/1 を消費済みなら match しない", () => {
    const usageLimit: import("../src/model").EffectUsageLimit = {
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    };
    const { state, getDef } = makeScene(usageLimit);
    const before = findApplicableTargetRedirects(
      state,
      ["ally-a"],
      BOB,
      "none",
      undefined,
      getDef
    );
    expect(before).toHaveLength(1);

    const stateAfterUsage: GameState = {
      ...state,
      effectUsageRecords: [
        {
          sourceInstanceId: "r02",
          sourceDefinitionId: "QUARTZ-R02",
          effectLabel: "redirect_effect_target",
          turnNumber: state.turnNumber,
          step: state.step,
          duration: "turn",
          count: 1,
        },
      ],
    };
    const after = findApplicableTargetRedirects(
      stateAfterUsage,
      ["ally-a"],
      BOB,
      "none",
      undefined,
      getDef
    );
    expect(after).toHaveLength(0);
  });

  // adversarial verifier round2 指摘 (BSLH01-R02): sourcePlayerRef のみでは相手のマジック/
  // アルティメット/ネクサス由来の効果でも誤って発動してしまう。sourceFilter:{category:spirit}
  // で「相手の**スピリット**の効果」に限定できることを固定する。
  function magicDef(cardNo: string): CardDefinition {
    return {
      ...spiritDef(cardNo),
      cardNo,
      printedCategory: "magic",
    } as CardDefinition;
  }

  it("sourceFilter: 効果発揮元がスピリットのときは match する", () => {
    const { state, getDef } = makeScene(undefined, { category: ["spirit"] });
    const oppSpiritSourceDef = spiritDef("OPP-SPIRIT-SRC");
    const matches = findApplicableTargetRedirects(
      state,
      ["ally-a"],
      BOB,
      "none",
      {
        instance: createCardInstance(oppSpiritSourceDef, {
          instanceId: "opp-source",
          ownerPlayerId: BOB,
          zone: "field",
        }),
        definition: oppSpiritSourceDef,
      },
      getDef
    );
    expect(matches).toHaveLength(1);
  });

  it("sourceFilter: 効果発揮元がマジック (スピリットでない) のときは match しない", () => {
    const { state, getDef } = makeScene(undefined, { category: ["spirit"] });
    const oppMagicSourceDef = magicDef("OPP-MAGIC-SRC");
    const matches = findApplicableTargetRedirects(
      state,
      ["ally-a"],
      BOB,
      "none",
      {
        instance: createCardInstance(oppMagicSourceDef, {
          instanceId: "opp-source",
          ownerPlayerId: BOB,
          zone: "field",
        }),
        definition: oppMagicSourceDef,
      },
      getDef
    );
    expect(matches).toHaveLength(0);
  });

  it("sourceFilter: 裏向きの効果発揮元は印字スピリット情報を漏らさず match しない", () => {
    const { state, getDef } = makeScene(undefined, { category: ["spirit"] });
    const oppSpiritSourceDef = spiritDef("OPP-FACE-DOWN-SRC");
    const matches = findApplicableTargetRedirects(
      state,
      ["ally-a"],
      BOB,
      "none",
      {
        instance: createCardInstance(oppSpiritSourceDef, {
          instanceId: "opp-face-down-source",
          ownerPlayerId: BOB,
          zone: "field",
          faceDown: true,
        }),
        definition: oppSpiritSourceDef,
      },
      getDef
    );
    expect(matches).toHaveLength(0);
  });

  it("sourceFilter: 効果発揮元情報が渡されないときはフェイルクローズで match しない", () => {
    const { state, getDef } = makeScene(undefined, { category: ["spirit"] });
    const matches = findApplicableTargetRedirects(
      state,
      ["ally-a"],
      BOB,
      "none",
      undefined,
      getDef
    );
    expect(matches).toHaveLength(0);
  });

  it("sourceFilter 未指定 (フランドール既定) なら効果発揮元の種別を問わず match する", () => {
    const { state, getDef } = makeScene();
    const oppMagicSourceDef = magicDef("OPP-MAGIC-SRC-2");
    const matches = findApplicableTargetRedirects(
      state,
      ["ally-a"],
      BOB,
      "none",
      {
        instance: createCardInstance(oppMagicSourceDef, {
          instanceId: "opp-source",
          ownerPlayerId: BOB,
          zone: "field",
        }),
        definition: oppMagicSourceDef,
      },
      getDef
    );
    expect(matches).toHaveLength(1);
  });
});
