/**
 * BSTH02.7-X03 effects[0]: フラッシュ【顕現：「アリス」&導界者ネクサス&C2以上『自分の
 * メインステップ』】。顕現(Manifest)メカニズムの production 経路
 * (getLegalActions → declare_manifest → applyLegalAction → スタック窓 →
 * resolveDeferredManifestStack) を検証する。
 *
 * 公式エターナル版キーワード効果「顕現」(battlespirits.com ルールマニュアル §特殊な効果):
 * 自分のソウルコアをトラッシュに置き、対象(創界神グランウォーカーネクサス相当=導界者ネクサス)
 * のコア1個をトラッシュへ払い、C2以上（自分のカウント）で手札から召喚する。
 *
 * 実カードで検証する: X03=蓬莱人形、対象=BSTH02.7-CX01「アリス・マーガトロイド」
 * (category:nexus, grandwalkerData.kind:"guided", 名前に「アリス」を含む)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";
import { getEffectiveCategory } from "../src/mechanics/act-as-spirit";
import { getManifestTargets } from "../src/mechanics/manifest-system";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};

const X03_NO = "BSTH02.7-X03"; // 蓬莱人形
const ALICE_NEXUS_NO = "BSTH02.7-CX01"; // ［魔導と叡智の契約者］アリス・マーガトロイド

function buildState(
  opts: {
    nexusCores?: number;
    countValue?: number;
    soulCoreLocation?:
      | GameState["players"][number]["soulCoreLocation"]
      | "none";
  } = {}
): GameState {
  const nexus = createCardInstance(card(ALICE_NEXUS_NO), {
    instanceId: "alice-nexus",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: opts.nexusCores ?? 2,
  });
  const x03 = createCardInstance(card(X03_NO), {
    instanceId: "x03-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const soulCoreLocation =
    opts.soulCoreLocation === "none"
      ? null
      : (opts.soulCoreLocation ?? ({ kind: "reserve" } as const));
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    startingVoidNormalCoreCount: 0,
    playerOverrides: [
      {
        handCount: 1,
        soulCoreLocation,
        countValue: opts.countValue ?? 2,
        reserveNormalCoreCount: 1,
      },
      {},
    ],
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    window: "none",
    cardInstances: [nexus, x03],
  };
}

function findManifestDeclaration(
  state: GameState,
  actingPlayerId = ALICE
): Extract<LegalAction, { kind: "declare_manifest" }> | undefined {
  const actions = getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  });
  return actions.find(
    (a): a is Extract<LegalAction, { kind: "declare_manifest" }> =>
      a.kind === "declare_manifest" && a.sourceInstanceId === "x03-1"
  );
}

function getCard(state: GameState, id: string) {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}
function getPlayer(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

function withSummonRestriction(
  state: GameState,
  onlyNormalUse = false
): GameState {
  return {
    ...state,
    activeContinuousEffects: [
      {
        effectId: "manifest-summon-restriction",
        sourceInstanceId: "restriction-source",
        sourceDefinitionId: "TEST-RESTRICTION",
        actingPlayerId: BOB,
        duration: { scope: "turn" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        modifierTag: "restrict_use",
        targetInstanceId: ALICE,
        metadata: {
          filter: { category: ["spirit"] },
          restrictedKinds: ["summon"],
          onlyNormalUse,
        },
      },
    ],
  };
}

/** フォーオブアカインドで印字Aliceの札が分身になった後の正規状態。 */
function withFlandreClone(state: GameState): GameState {
  const flandreDef = card("BSTH01-X04");
  const registration = flandreDef
    .effects!.flatMap((effect) => effect.steps)
    .find((step) => step.action.kind === "register_act_as_spirit")!.action;
  if (
    registration.kind !== "register_act_as_spirit" ||
    registration.statBlueprint.kind !== "live_copy_from_source"
  ) {
    throw new Error("Flandre clone registration not found");
  }
  return {
    ...state,
    cardInstances: [
      ...state.cardInstances.map((instance) =>
        instance.instanceId === "alice-nexus"
          ? { ...instance, faceDown: true }
          : instance
      ),
      createCardInstance(flandreDef, {
        instanceId: "flandre-source",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }),
    ],
    activeContinuousEffects: [
      ...state.activeContinuousEffects,
      {
        effectId: "flandre-clone-identity",
        sourceInstanceId: "flandre-source",
        sourceDefinitionId: "BSTH01-X04",
        actingPlayerId: ALICE,
        duration: { scope: "while_on_field" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        modifierTag: "act_as_spirit",
        targetInstanceId: "alice-nexus",
        metadata: {
          statBlueprint: {
            kind: "live_copy_from",
            sourceInstanceId: "flandre-source",
            aspects: registration.statBlueprint.aspects,
          },
          overrides: registration.overrides,
        },
      },
    ],
  };
}

/** declare_manifest はスタック窓を開く。相手のパスで窓を閉じ deferred 解決まで進める。 */
function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById,
      ...effectLookups,
    });
    const pass = actions.find((a) => a.kind === "pass_stack");
    if (!pass) {
      throw new Error(`pass_stack for ${responderId} not found`);
    }
    current = applyLegalAction({
      state: current,
      action: pass,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
  }
  return current;
}

describe("BSTH02.7-X03 effects[0]: 顕現(declare_manifest)", () => {
  it("manifestData が対象条件どおりに配線されている", () => {
    const def = card(X03_NO);
    expect(def.manifestData).toEqual({
      targetFilter: {
        category: ["nexus"],
        targetsGrandwalker: true,
        hasMechanic: ["guided"],
        cardName: { contains: "アリス" },
      },
      condition: [{ kind: "count_value", player: "self", min: 2 }],
      manifestTiming: "own_main_step",
      soulCoreDest: "trash",
    });
    // effects[] には advent と同型で [0,1] の stub エントリを残さない (SSOT)。
    expect(
      def.effects?.some((e) => e.textRef?.[0] === 0 && e.textRef?.[1] === 1)
    ).toBe(false);
  });

  it("カウント2以上・自分のメインステップなら対象の1コアだけで declare_manifest が legal になる", () => {
    const state = buildState({ nexusCores: 1 });
    const decl = findManifestDeclaration(state);
    expect(decl).toBeDefined();
    expect(decl!.requiredTargetCount).toBe(1);
    expect(decl!.targetMode).toBe("manual");
    expect(decl!.soulCoreDest).toBe("trash");
    expect(decl!.candidateTargetInstanceIds).toContain("alice-nexus");
  });

  it("対象に十分なコアがあってもカウント0/1では顕現できず、2/3で可能になる", () => {
    for (const countValue of [0, 1, 2, 3]) {
      expect(
        Boolean(
          findManifestDeclaration(buildState({ countValue, nexusCores: 4 }))
        )
      ).toBe(countValue >= 2);
    }
  });

  it("対象ネクサスのコアが0個なら declare_manifest は出ない", () => {
    const state = buildState({ nexusCores: 0 });
    expect(findManifestDeclaration(state)).toBeUndefined();
  });

  it("印字Aliceの裏向きフランドール分身は実効スピリットなので顕現対象にならない", () => {
    const state = withFlandreClone(buildState({ nexusCores: 1 }));
    expect(
      getEffectiveCategory(
        state,
        getCard(state, "alice-nexus"),
        card(ALICE_NEXUS_NO)
      )
    ).toBe("spirit");
    expect(findManifestDeclaration(state)).toBeUndefined();
    expect(getCard(state, "x03-1").zone).toBe("hand");
    expect(getCard(state, "alice-nexus").normalCoreCount).toBe(1);
    expect(getPlayer(state, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
    expect(getPlayer(state, ALICE).trashNormalCoreCount).toBe(0);
  });

  it("窓中に印字Aliceが裏向き分身になると実効素性を再判定し無支払いで不発になる", () => {
    const state = buildState({ nexusCores: 1 });
    const declared = applyLegalAction({
      state,
      action: findManifestDeclaration(state)!,
      targetInstanceIds: ["alice-nexus"],
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    const final = passStackUntilClosed(withFlandreClone(declared));
    expect(getCard(final, "x03-1").zone).toBe("hand");
    expect(getCard(final, "alice-nexus").normalCoreCount).toBe(1);
    expect(getPlayer(final, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
    expect(getPlayer(final, ALICE).trashNormalCoreCount).toBe(0);
    expect(final.pendingCoreDistribution).toBeNull();
    expect(final.stackWindow).toBeNull();
  });

  it("魂状態・煌臨元・text_role下カードは無印の顕現対象から共通スコープで除外する", () => {
    for (const scope of ["soul_state", "advent_source", "text_role"] as const) {
      const state = buildState({ nexusCores: 1 });
      const scoped: GameState =
        scope === "soul_state"
          ? {
              ...state,
              players: state.players.map((player) =>
                player.id === ALICE
                  ? { ...player, soulStateInstanceIds: ["alice-nexus"] }
                  : player
              ),
            }
          : {
              ...state,
              cardInstances: [
                ...state.cardInstances,
                {
                  ...createCardInstance(card("BSTH01-X04"), {
                    instanceId: "under-card-host",
                    ownerPlayerId: ALICE,
                    zone: "field",
                    normalCoreCount: 2,
                  }),
                  underCards: [{ cardInstanceId: "alice-nexus", role: scope }],
                },
              ],
            };
      expect(
        getManifestTargets(
          scoped,
          ALICE,
          card(X03_NO).manifestData!,
          getCardDefinitionById
        ),
        scope
      ).toEqual([]);
      expect(findManifestDeclaration(scoped), scope).toBeUndefined();
    }
  });

  it("ソウルコアが使用不可なら declare_manifest は出ない", () => {
    const state = buildState({ soulCoreLocation: "none" });
    expect(findManifestDeclaration(state)).toBeUndefined();
  });

  it("召喚禁止は顕現にも適用し、効果以外の通常召喚だけの禁止は適用しない", () => {
    expect(
      findManifestDeclaration(withSummonRestriction(buildState()))
    ).toBeUndefined();
    expect(
      findManifestDeclaration(withSummonRestriction(buildState(), true))
    ).toBeDefined();
  });

  it("窓中に召喚禁止かソウルコア使用不可になるとコストを支払わず不発になる", () => {
    for (const invalidation of [
      "summon-prohibited",
      "soul-core-in-trash",
    ] as const) {
      const state = buildState();
      const declared = applyLegalAction({
        state,
        action: findManifestDeclaration(state)!,
        targetInstanceIds: ["alice-nexus"],
        getCardDefinitionById,
        ...effectLookups,
      }).state;
      const changed: GameState =
        invalidation === "summon-prohibited"
          ? withSummonRestriction(declared)
          : {
              ...declared,
              players: declared.players.map((p) =>
                p.id === ALICE
                  ? {
                      ...p,
                      soulCoreLocation: { kind: "trash" as const },
                      reserveSoulCoreCount: 0,
                      trashSoulCoreCount: 1,
                    }
                  : p
              ),
            };
      const final = passStackUntilClosed(changed);
      expect(getCard(final, "x03-1").zone, invalidation).toBe("hand");
      expect(getCard(final, "alice-nexus").normalCoreCount, invalidation).toBe(
        2
      );
      expect(getPlayer(final, ALICE).trashNormalCoreCount, invalidation).toBe(
        0
      );
      expect(final.pendingCoreDistribution, invalidation).toBeNull();
    }
  });

  it("メインステップ以外 (アタックステップのフラッシュ窓) では declare_manifest は出ない", () => {
    // manifestTiming:"own_main_step" は main 窓のみ許可し、flash 窓 (アタック中) では
    // 許可しない。実際の battle flash context (activeAttack + flashWindowState) で検証する。
    const base = buildState();
    const state: GameState = {
      ...base,
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "atk-1",
        primaryEntityId: "e-atk",
        participantEntityIds: ["e-atk"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: ALICE,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: null,
        },
      },
    };
    expect(findManifestDeclaration(state)).toBeUndefined();
  });

  it("自分のターンでなければ declare_manifest は出ない", () => {
    const state = { ...buildState(), activePlayerId: BOB };
    expect(findManifestDeclaration(state)).toBeUndefined();
  });

  it("BSTH02.7-X03本文監査: 窓後に対象の1コアとソウルコアをトラッシュへ払い、維持コア配置まで完走する", () => {
    const state = buildState();
    const decl = findManifestDeclaration(state)!;

    const declared = applyLegalAction({
      state,
      action: decl,
      targetInstanceIds: ["alice-nexus"],
      getCardDefinitionById,
      ...effectLookups,
    });
    expect(declared.state.stackWindow).not.toBeNull();
    expect(getCard(declared.state, "x03-1").zone).toBe("hand");
    expect(getCard(declared.state, "alice-nexus").normalCoreCount).toBe(2);
    expect(getPlayer(declared.state, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
    const resolved = passStackUntilClosed(declared.state);

    const x03 = getCard(resolved, "x03-1");
    expect(x03.zone).toBe("field");
    expect(
      resolved.publicDisclosures
        ?.flatMap((entry) => entry.results)
        .filter(
          (result) =>
            result.instanceId === "x03-1" && result.kind === "card_move"
        )
    ).toEqual([
      expect.objectContaining({ actionLabel: "manifest", to: "field" }),
    ]);
    expect(x03.zoneRoleName).toBe("spirit");
    expect(x03.normalCoreCount).toBe(0);

    const nexus = getCard(resolved, "alice-nexus");
    expect(nexus.normalCoreCount).toBe(1); // 2 - 1 (顕現支払い)

    const alice = getPlayer(resolved, ALICE);
    expect(alice.soulCoreLocation).toEqual({ kind: "trash" });
    expect(alice.voidNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.handCount).toBe(0);

    const distribution = getLegalActions({
      state: resolved,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    expect(distribution).toBeDefined();
    const final = applyLegalAction({
      state: resolved,
      action: distribution!,
      coreDistributionAllocations: { "x03-1": 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(final.pendingCoreDistribution).toBeNull();
    expect(getCard(final, "x03-1").zone).toBe("field");
    expect(getCard(final, "x03-1").normalCoreCount).toBe(1);
    expect(getPlayer(final, ALICE).reserveNormalCoreCount).toBe(0);
    expect(getPlayer(final, ALICE).countValue).toBe(2);
    expect(getCard(final, "alice-nexus").normalCoreCount).toBe(1);
    expect(getPlayer(final, ALICE).trashNormalCoreCount).toBe(1);
  });

  it("窓中にカウントが2未満になると顕現は不発で、どちらのコアも支払わない", () => {
    const state = buildState();
    const declared = applyLegalAction({
      state,
      action: findManifestDeclaration(state)!,
      targetInstanceIds: ["alice-nexus"],
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    const changed = {
      ...declared,
      players: declared.players.map((p) =>
        p.id === ALICE ? { ...p, countValue: 1 } : p
      ),
    };
    const final = passStackUntilClosed(changed);
    expect(getCard(final, "x03-1").zone).toBe("hand");
    expect(getCard(final, "alice-nexus").normalCoreCount).toBe(2);
    expect(getPlayer(final, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
    expect(getPlayer(final, ALICE).trashNormalCoreCount).toBe(0);
    expect(final.pendingCoreDistribution).toBeNull();
  });

  it("適用後: 『召喚時』(界放BP-10000) が誘発する", () => {
    const state = buildState();
    const decl = findManifestDeclaration(state)!;

    const declared = applyLegalAction({
      state,
      action: decl,
      targetInstanceIds: ["alice-nexus"],
      getCardDefinitionById,
      ...effectLookups,
    });
    const resolved = passStackUntilClosed(declared.state);

    const pendings = resolved.pendingTriggeredEffects.filter(
      (p) => p.relatedInstanceId === "x03-1"
    );
    expect(pendings.some((p) => p.eventKind === "summon")).toBe(true);
  });

  it("適用後: リザーブ/フィールドのコアを好きなだけ顕現カードに置ける (pendingCoreDistribution)", () => {
    const state = buildState();
    const decl = findManifestDeclaration(state)!;

    const declared = applyLegalAction({
      state,
      action: decl,
      targetInstanceIds: ["alice-nexus"],
      getCardDefinitionById,
      ...effectLookups,
    });
    const resolved = passStackUntilClosed(declared.state);

    expect(resolved.pendingCoreDistribution).not.toBeNull();
    expect(resolved.pendingCoreDistribution?.candidates).toEqual([
      { instanceId: "x03-1", definitionId: X03_NO },
    ]);
  });

  it("不発: 窓中に対象ネクサスが場を離れたら、パス後も手札のまま", () => {
    const state = buildState();
    const decl = findManifestDeclaration(state)!;

    const declared = applyLegalAction({
      state,
      action: decl,
      targetInstanceIds: ["alice-nexus"],
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(declared.stackWindow).not.toBeNull();

    const nexusLeftField: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((c) =>
        c.instanceId === "alice-nexus" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const passAction = getLegalActions({
      state: nexusLeftField,
      actingPlayerId: nexusLeftField.stackWindow!.priorityPlayerId,
      getCardDefinitionById,
      ...effectLookups,
    }).find((a) => a.kind === "pass_stack");
    expect(passAction).toBeDefined();
    const resolved = applyLegalAction({
      state: nexusLeftField,
      action: passAction!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;

    const x03 = getCard(resolved, "x03-1");
    expect(x03.zone).toBe("hand");
    expect(getPlayer(resolved, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
  });
});
