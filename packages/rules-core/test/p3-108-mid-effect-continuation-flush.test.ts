/**
 * P3-108 Item3 ゴールデン: mid-effect 継続（TargetRedirect）の resume が finalize/flush を
 * 通らないため、同一チェーンで消滅した待機（コスト支払い消滅, defer=true）が
 *   (a) 継続が pending の間に premature flush されず（例1 不変条件）、
 *   (b) 継続解決後の sub-chain 閉鎖の正節目で 1 回だけ move する
 * ことを検証する（根治計画 §7.5）。
 *
 * シナリオ: alice がメインで対象指定マジック（相手スピリット1体を破壊）を使用。コストを
 * alice の場のスピリット（残コア1）で支払い → コア不足消滅（defer=true 待機）。マジックの対象
 * （bob のスピリット）は bob の redirect CE で保護されており、解決時に pendingTargetRedirects が
 * 立つ（= mid-effect 継続）。継続中は消滅待機が flush されず、confirm/decline 後に flush される。
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
  playMagicCardAsAction,
} from "../src";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src";

const ALICE = "alice";
const BOB = "bob";
const BOB_HOST = "bob-protected";
const BOB_TOKEN = "bob-token";
const ALICE_PAY = "alice-pay"; // 残コア1, コスト支払いで消滅する

const spiritDef: CardDefinition = {
  cardNo: "P3-108-SPIRIT",
  name: "P3-108 スピリット",
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

// alice の対象指定メインマジック（相手スピリット1体を破壊, 対象は解決時選択）。
const aliceDestroyMagic: CardDefinition = {
  cardNo: "P3-108-ALICE-DESTROY",
  name: "P3-108 alice 破壊マジック",
  printedCategory: "magic",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: ["red"],
  textLines: ["相手のスピリット1体を破壊する。"],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
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

const defs = [spiritDef, aliceDestroyMagic];
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

// bob が自分の BOB_HOST を保護し BOB_TOKEN へ差し替える redirect CE（相手=alice の効果で発火）。
function redirectCE(): ContinuousEffect {
  return {
    effectId: "ce-redirect-bob",
    sourceInstanceId: BOB_HOST,
    sourceDefinitionId: spiritDef.cardNo,
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "redirect_effect_target" as ContinuousEffectTag,
    metadata: {
      triggerCondition: {
        sourcePlayerRef: "opponent",
        protectedTargetKind: "instances",
        protectedInstanceIds: [BOB_HOST],
      },
      redirectCandidateSource: { kind: "explicit", instanceIds: [BOB_TOKEN] },
      optional: true,
    } as unknown as Record<string, unknown>,
  };
}

function buildState(): GameState {
  const alicePay = createCardInstance(spiritDef, {
    instanceId: ALICE_PAY,
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 1, // 残コア1 → コスト支払いで消滅
  });
  const bobHost = createCardInstance(spiritDef, {
    instanceId: BOB_HOST,
    ownerPlayerId: BOB,
    zone: "field",
    cores: 1,
  });
  const bobToken = createCardInstance(spiritDef, {
    instanceId: BOB_TOKEN,
    ownerPlayerId: BOB,
    zone: "field",
    cores: 1,
  });
  const magic = createCardInstance(aliceDestroyMagic, {
    instanceId: "alice-magic-1",
    ownerPlayerId: ALICE,
    zone: "hand",
  });

  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [alicePay, bobHost, bobToken, magic],
  });

  return {
    ...base,
    step: "main",
    activePlayerId: ALICE,
    activeContinuousEffects: [redirectCE()],
  };
}

function driveUntilRedirect(state: GameState): {
  state: GameState;
  sawPremature: boolean;
} {
  let cur = state;
  let sawPremature = false;
  for (let i = 0; i < 30; i++) {
    if (cur.pendingTargetRedirects.length > 0) break;

    // 継続が pending の間（redirect 未発火・target 選択 pending 等）に支払い消滅が
    // 早期 flush されていないことを監視する（例1 不変条件）。
    const payInst = cur.cardInstances.find((c) => c.instanceId === ALICE_PAY);
    if (payInst && payInst.zone === "trash") {
      sawPremature = true;
    }

    if (cur.pendingEffectTargetSelection) {
      const resolveTarget = getLegalActions({
        state: cur,
        actingPlayerId: ALICE,
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_effect_target");
      if (resolveTarget) {
        cur = applyLegalAction({
          state: cur,
          action: resolveTarget,
          targetInstanceIds: [BOB_HOST],
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
        acts.find((a) => a.kind === "pass_stack") ??
        acts.find((a) => a.kind === "resolve_pending_triggered_effect");
      if (next) {
        cur = applyLegalAction({ state: cur, action: next, ...lookups }).state;
        advanced = true;
        break;
      }
    }
    if (!advanced) break;
  }
  return { state: cur, sawPremature };
}

describe("P3-108 Item3: mid-effect 継続中の支払い消滅 flush タイミング", () => {
  it("継続中は支払い消滅が premature flush されず、redirect 解決後に move する", () => {
    const state = buildState();

    // alice がメインで破壊マジックを使用。コストを ALICE_PAY の残コア1で支払い → 消滅待機。
    const used = playMagicCardAsAction({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "alice-magic-1",
      paymentSources: [{ kind: "card", instanceId: ALICE_PAY, amount: 1 }],
      chosenTiming: "main",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    const { state: atRedirect, sawPremature } = driveUntilRedirect(used);

    // redirect が立つ（mid-effect 継続）。
    expect(atRedirect.pendingTargetRedirects.length).toBe(1);
    // (a) 継続中に支払い消滅が premature flush されていない。
    expect(sawPremature).toBe(false);
    const payDuring = atRedirect.cardInstances.find(
      (c) => c.instanceId === ALICE_PAY
    );
    expect(payDuring?.zone).not.toBe("trash");
    // 支払い消滅は待機状態で保持されている。
    expect(payDuring?.pendingLeaveKind ?? null).not.toBeNull();

    // alice/bob 双方の手番で redirect を decline（HOST のまま破壊）。
    const decline = [ALICE, BOB]
      .flatMap((pid) =>
        getLegalActions({ state: atRedirect, actingPlayerId: pid, ...lookups })
      )
      .find((a) => a.kind === "decline_target_redirect");
    expect(decline).toBeDefined();
    const after = applyLegalAction({
      state: atRedirect,
      action: decline!,
      ...lookups,
    }).state;

    // (b) sub-chain 閉鎖の正節目で支払い消滅が move（trash へ）。
    const payAfter = after.cardInstances.find(
      (c) => c.instanceId === ALICE_PAY
    );
    expect(payAfter?.zone).toBe("trash");
    expect(payAfter?.pendingLeaveKind ?? null).toBeNull();
  });

  it("Stage3: 効果の resolve-main:end は継続中に出ず、redirect 解決後に出る", () => {
    const state = buildState();
    const used = playMagicCardAsAction({
      state,
      actingPlayerId: ALICE,
      magicInstanceId: "alice-magic-1",
      paymentSources: [{ kind: "card", instanceId: ALICE_PAY, amount: 1 }],
      chosenTiming: "main",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    const { state: atRedirect } = driveUntilRedirect(used);
    expect(atRedirect.pendingTargetRedirects.length).toBe(1);

    // 継続中 (redirect 待ち) は resolve-main:end が log に出ていない（早期 endLog の抑止）。
    const endMarker = (s: typeof atRedirect) =>
      s.log.some((l) => l.includes("magic:resolve-main:end"));
    expect(endMarker(atRedirect)).toBe(false);
    // 退避キューには積まれている。
    expect((atRedirect.pendingResolutionEndLogs ?? []).length).toBeGreaterThan(
      0
    );

    const decline = [ALICE, BOB]
      .flatMap((pid) =>
        getLegalActions({ state: atRedirect, actingPlayerId: pid, ...lookups })
      )
      .find((a) => a.kind === "decline_target_redirect");
    const after = applyLegalAction({
      state: atRedirect,
      action: decline!,
      ...lookups,
    }).state;

    // 効果が真に閉じた時点で resolve-main:end が log に出る。退避キューは空。
    expect(endMarker(after)).toBe(true);
    expect((after.pendingResolutionEndLogs ?? []).length).toBe(0);
  });
});
