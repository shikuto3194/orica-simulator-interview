/**
 * P3-76 / P3-47 F-4 回帰: 効果対象リダイレクトが「対象選択は窓クローズ後」(magic-target-after-
 * stack-window, 2026-05-31) の新モデル経路でも発火するか。
 *
 * 背景: BSTH01-X04 フランドール・スカーレット【フォーオブアカインド】は
 * 「このスピリットが相手の効果の対象になったとき、その効果の対象をそれらのスピリットに変更できる」
 * を register_redirect_effect_target CE で実装済み (P3-47 F-4)。リダイレクト検出は executeEffect
 * 内の resolveTargets 後 (effect-interpreter.ts:903) で resolved 集合に対して走る。
 *
 * 既存 redirect テスト (redirect-effect-target / redirect-target-pending / p3-47-frandolle-phase3)
 * は pending 手動注入 or 宣言時対象で、相手が「対象未指定で use_magic → 窓クローズ → 解決時に
 * 対象選択」する新モデル経路を通っていない。本テストはその経路を実駆動し、解決時に選ばれた対象
 * (= 保護対象スピリット) に対してリダイレクト pending が自動発火することを確認する。
 */
import { describe, expect, it } from "vitest";
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
} from "../src";
import type {
  ActiveAttack,
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src";

const ALICE = "alice";
const BOB = "bob";
const HOST = "flandre-host";
const TOKEN = "flandre-token";

// alice の保護対象スピリット (フランドール相当) と差し替え先 token。
const spiritDef: CardDefinition = {
  cardNo: "P3-76-SPIRIT",
  name: "P3-76 保護対象スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

// bob の対象指定フラッシュ (相手スピリット1体を破壊)。対象は窓クローズ後に選ぶ (未指定で使用)。
const bobDestroyFlash: CardDefinition = {
  cardNo: "P3-76-BOB-DESTROY",
  name: "P3-76 bob 破壊フラッシュ",
  printedCategory: "magic",
  colors: ["purple"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["フラッシュ", "相手のスピリット1体を破壊する。"],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
      ],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = [spiritDef, bobDestroyFlash];
const defMap = new Map(defs.map((d) => [d.cardNo, d]));
const lookups = {
  getCardDefinitionById: (id: string) => defMap.get(id),
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredBurstActions: buildBurstEffectLookup(defs),
};

// HOST を保護し TOKEN へ差し替える redirect_effect_target CE (alice 所有, 相手効果で発火)。
function redirectCE(): ContinuousEffect {
  return {
    effectId: "ce-redirect-flandre",
    sourceInstanceId: HOST,
    sourceDefinitionId: spiritDef.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "redirect_effect_target" as ContinuousEffectTag,
    metadata: {
      triggerCondition: {
        sourcePlayerRef: "opponent",
        protectedTargetKind: "instances",
        protectedInstanceIds: [HOST],
      },
      redirectCandidateSource: {
        kind: "explicit",
        instanceIds: [TOKEN],
      },
      optional: true,
    } as unknown as Record<string, unknown>,
  };
}

function buildState(): GameState {
  const host = createCardInstance(spiritDef, {
    instanceId: HOST,
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 1,
  });
  const token = createCardInstance(spiritDef, {
    instanceId: TOKEN,
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 1,
  });
  const flash = createCardInstance(bobDestroyFlash, {
    instanceId: "bob-flash-1",
    ownerPlayerId: BOB,
    zone: "hand",
  });

  const activeAttack: ActiveAttack = {
    attackId: "atk-1",
    primaryEntityId: "e-host",
    participantEntityIds: ["e-host"],
    groupMode: "single",
    target: { kind: "player", playerId: BOB },
    blockAssignments: [],
    symbolResolutionOrder: [],
    flashBeforeBlockCompleted: false,
    flashAfterBlockCompleted: false,
    flashWindowState: {
      kind: "before_block",
      priorityPlayerId: BOB,
      consecutivePassCount: 0,
      // 実 openBattleFlash と同じく source=優先権者。bob は非アクティブ側で先に優先権を持つ
      // フラッシュ開始者なので timings=["flash"] となり、フラッシュ効果を本体ループで使える
      // (旧 null は flash→stack 派生 reg 経由でしか使えない不正確な再現。派生は廃止)。
      stackResponseSourcePlayerId: BOB,
      pendingStackAction: null,
    },
  };

  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, token, flash],
    activeAttack,
    battleEntities: [
      {
        entityId: "e-host",
        memberInstanceIds: [HOST],
        resolvedBp: 5000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
  });

  return {
    ...base,
    step: "attack",
    activePlayerId: ALICE,
    window: "flash_before_block",
    activeContinuousEffects: [redirectCE()],
  };
}

describe("P3-76: 効果対象リダイレクトは magic-target-after-stack-window の新モデル経路でも発火する", () => {
  it("bob が対象未指定で破壊フラッシュ使用 → 窓クローズ → 解決時に保護対象 HOST を選ぶ → リダイレクト pending が自動発火する", () => {
    const state = buildState();

    // 1. bob が before_block 窓で破壊フラッシュを使用 (対象未指定 = 解決時選択)。
    const useFlash = getLegalActions({
      state,
      actingPlayerId: BOB,
      ...lookups,
    }).find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "bob-flash-1"
    );
    expect(useFlash).toBeDefined();
    let cur = applyLegalAction({ state, action: useFlash!, ...lookups }).state;

    // 2. 窓を pass で自然クローズ → 解決時に対象選択 pending が立つ。
    const trace: string[] = [];
    for (let i = 0; i < 20; i++) {
      if (cur.pendingTargetRedirects.length > 0) break;

      // 対象選択が立ったら保護対象 HOST を選ぶ (= リダイレクト発火条件)。
      if (cur.pendingEffectTargetSelection) {
        const resolveTarget = getLegalActions({
          state: cur,
          actingPlayerId: BOB,
          ...lookups,
        }).find((a) => a.kind === "resolve_pending_effect_target");
        if (resolveTarget) {
          trace.push("BOB:resolve_pending_effect_target(HOST)");
          cur = applyLegalAction({
            state: cur,
            action: resolveTarget,
            targetInstanceIds: [HOST],
            ...lookups,
          }).state;
          continue;
        }
      }

      let advanced = false;
      for (const pid of [ALICE, BOB]) {
        const acts = getLegalActions({
          state: cur,
          actingPlayerId: pid,
          ...lookups,
        });
        const next =
          acts.find((a) => a.kind === "pass_battle_flash") ??
          acts.find((a) => a.kind === "pass_stack") ??
          acts.find((a) => a.kind === "resolve_pending_triggered_effect");
        if (next) {
          trace.push(`${pid}:${next.kind}`);
          cur = applyLegalAction({
            state: cur,
            action: next,
            ...lookups,
          }).state;
          advanced = true;
          break;
        }
      }
      if (!advanced) {
        trace.push(
          `stuck window=${cur.window} pendingTarget=${!!cur.pendingEffectTargetSelection} redirects=${cur.pendingTargetRedirects.length}`
        );
        break;
      }
    }

    // 3. 解決時に選ばれた保護対象 HOST に対してリダイレクト pending が自動発火する。
    if (cur.pendingTargetRedirects.length === 0) {
      throw new Error(`redirect not fired. trace: ${trace.join(" -> ")}`);
    }
    expect(cur.pendingTargetRedirects).toHaveLength(1);
    const pending = cur.pendingTargetRedirects[0]!;
    expect(pending.redirectableInstanceId).toBe(HOST);
    expect(pending.candidateTokenInstanceIds).toContain(TOKEN);
    expect(pending.promptedPlayerId).toBe(ALICE);

    // 4. alice が confirm → 対象が TOKEN に差し替わり、HOST は破壊されない。
    const confirm = getLegalActions({
      state: cur,
      actingPlayerId: ALICE,
      ...lookups,
    }).find((a) => a.kind === "confirm_target_redirect");
    expect(confirm).toBeDefined();
    const afterConfirm = applyLegalAction({
      state: cur,
      action: confirm!,
      // 差し替え先 token を指定。
      ...({ redirectTargetReplacementInstanceId: TOKEN } as Record<
        string,
        unknown
      >),
      ...lookups,
    }).state;

    // HOST は破壊されず field に残り、TOKEN が破壊される。
    const hostAfter = afterConfirm.cardInstances.find(
      (c) => c.instanceId === HOST
    );
    const tokenAfter = afterConfirm.cardInstances.find(
      (c) => c.instanceId === TOKEN
    );
    // redirect 後、破壊は redirect 先 TOKEN に適用される (破壊は pending-leave 方式のため
    // zone 移動は安定点で確定するが、pendingLeaveKind="destroy" が直接の証跡)。
    // 保護対象 HOST は破壊予約されず field に残る。
    expect(hostAfter?.zone).toBe("field");
    expect(hostAfter?.pendingLeaveKind ?? null).toBeNull();
    expect(tokenAfter?.zone).toBe("trash");
    expect(tokenAfter?.pendingLeaveKind).toBeNull();
    // 破壊適用先が TOKEN であることをログでも確認 (HOST には destroy が走らない)。
    expect(
      afterConfirm.log.some((l) => l === `effect:destroy:${BOB}:${TOKEN}`)
    ).toBe(true);
    expect(
      afterConfirm.log.some((l) => l === `effect:destroy:${BOB}:${HOST}`)
    ).toBe(false);
  });
});
