/**
 * P3-77 Phase 5: 節②「このカードが発動している間、このカードと自分は相手の効果を
 * 受けない」の発動中ウィンドウ束縛。
 *
 * 確定裁定 (2026-06-01): 発動中 = 発動成立〜バースト効果の「解決後」まで。
 * 自身のバースト効果が誘発させた後続効果は、解決時点で発動中が終了済 → 耐性対象外。
 *
 * 検証:
 * 1. メイン効果解決中は card(defense_immune) + controller(player_effect_immunity) が有効。
 *    その間、相手起因のプレイヤー対象効果 (restrict_flash) は no-op。
 * 2. 解決後はウィンドウ CE が除去され、耐性が切れる。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeRestrictFlash,
  getStrongestDefenseLevel,
  useResolvePendingBurstCheckAsAction,
} from "../src";
import { isPlayerImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import type { CardDefinition, GameState, PendingBurstCheck } from "../src";

const cardMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardMap.get(id);
const X07 = cardMap.get("BSTH01-X07")!;

function makeBurstCheck(): PendingBurstCheck {
  return {
    checkId: "c1",
    actingPlayerId: "alice",
    eventKind: "reduce_life",
    event: { family: "life", validationMode: "snapshot_only" },
    source: "action_resolution",
    chainId: "test:p3-77-burst-activation-immunity-window:32",
    attackId: null,
    relatedPlayerId: "alice",
    relatedInstanceId: null,
    amount: 1,
    step: "attack",
    window: "flash_before_block",
    resolvedBurstCardInstanceIds: [],
  };
}

function buildState(): GameState {
  const x07 = createCardInstance(X07, {
    instanceId: "x07",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "bob",
    step: "attack",
    cardInstances: [x07],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "x07" }],
    // 発動 (reveal) 済み: declare ステップで revealedBurstStates に積まれた状態を想定。
    revealedBurstStates: [
      { playerId: "alice", cardInstanceId: "x07", checkId: "c1" },
    ],
    pendingBurstChecks: [makeBurstCheck()],
  };
}

describe("P3-77 Phase 5: バースト発動中ウィンドウの効果耐性", () => {
  it("メイン効果解決中は card+controller が相手効果耐性を持ち、解決後に除去される", () => {
    const state = buildState();

    let immunityDuringResolution: {
      cardImmune: boolean;
      playerImmune: boolean;
      restrictGated: boolean;
    } | null = null;

    // resolveEffect の中 = メイン効果解決中。ここで耐性状態を観測する。
    const after = useResolvePendingBurstCheckAsAction({
      state,
      actingPlayerId: "alice",
      checkId: "c1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      resolveEffect: (s) => {
        const cardImmune = getStrongestDefenseLevel(s, "x07") === "immune";
        const playerImmune = isPlayerImmuneToOpponentEffect(s, "alice", "bob");
        // bob (相手) が「alice は、フラッシュを使用できない」を発動 → 免疫で no-op
        const afterRestrict = executeRestrictFlash(
          s,
          "bob",
          {
            kind: "restrict_flash",
            player: "opponent",
            source: "any",
            duration: { scope: "turn" },
          },
          "bob-source"
        );
        const restrictGated =
          afterRestrict.activeContinuousEffects.filter((ce) =>
            ce.modifierTag.startsWith("restrict_flash")
          ).length === 0;
        immunityDuringResolution = { cardImmune, playerImmune, restrictGated };
        return s;
      },
    }).state;

    // 解決中の観測
    expect(immunityDuringResolution).not.toBeNull();
    expect(immunityDuringResolution!.cardImmune).toBe(true);
    expect(immunityDuringResolution!.playerImmune).toBe(true);
    expect(immunityDuringResolution!.restrictGated).toBe(true);

    // 解決後: ウィンドウ CE は除去されている
    expect(
      after.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "player_effect_immunity"
      )
    ).toBe(false);
    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          typeof (ce.metadata as { burstActivationWindow?: unknown })
            ?.burstActivationWindow === "string"
      )
    ).toBe(false);
    expect(isPlayerImmuneToOpponentEffect(after, "alice", "bob")).toBe(false);
  });

  it("targeted disclosure で本体解決が中断した間は窓 CE を保持する", () => {
    const state = buildState();

    const after = useResolvePendingBurstCheckAsAction({
      state,
      actingPlayerId: "alice",
      checkId: "c1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      resolveEffect: (s) => ({
        ...s,
        pendingTargetedDisclosureContinuation: {
          chainId: "test:p3-77-burst-activation-immunity-window:146",
          pendingId: "targeted-disclosure:x07:test",
          sourceDefinitionId: "BSTH01-X07",
          effectIndex: 1,
          sourceInstanceId: "x07",
          actingPlayerId: "alice",
          resumeStepIndex: 0,
          stepContext: { results: {} },
          targetInstanceIds: ["dummy-target"],
          remainingStacks: [],
        },
      }),
    }).state;

    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.effectId === "burst-window-immune-card:c1" &&
          ce.modifierTag === "defense_immune"
      )
    ).toBe(true);
    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.effectId === "burst-window-immune-player:c1" &&
          ce.modifierTag === "player_effect_immunity"
      )
    ).toBe(true);
    expect(
      after.pendingTargetedDisclosureContinuation?.resolutionCleanups
    ).toEqual([
      {
        kind: "burst_activation_immunity",
        checkId: "c1",
        effectIds: [
          "burst-window-immune-card:c1",
          "burst-window-immune-player:c1",
        ],
      },
    ]);
  });

  it("効果耐性常在効果を持たないバーストカードでは窓 CE を登録しない", () => {
    // X07 以外のダミー (continuous effect_immunity を持たない) バーストカード。
    const plain: CardDefinition = {
      ...X07,
      cardNo: "TEST-PLAIN-BURST",
      effects: (X07.effects ?? []).filter(
        (e) => e.timing.kind !== "continuous"
      ),
    };
    const localMap = new Map(cardMap);
    localMap.set(plain.cardNo, plain);
    const lookup = (id: string) => localMap.get(id);

    const card = createCardInstance(plain, {
      instanceId: "p1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [card],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "p1" }],
      revealedBurstStates: [
        { playerId: "alice", cardInstanceId: "p1", checkId: "c1" },
      ],
      pendingBurstChecks: [makeBurstCheck()],
    };

    let sawImmunity = false;
    useResolvePendingBurstCheckAsAction({
      state,
      actingPlayerId: "alice",
      checkId: "c1",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      resolveEffect: (s) => {
        if (isPlayerImmuneToOpponentEffect(s, "alice", "bob"))
          sawImmunity = true;
        return s;
      },
    });
    expect(sawImmunity).toBe(false);
  });
});
