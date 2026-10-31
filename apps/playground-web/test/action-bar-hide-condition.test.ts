/**
 * P3-39: ActionBar / pending UI ルートのリグレッションガード
 *
 * 下部 ActionBar は pass 系 + 効果全体の「発揮する/発揮しない」を扱う。
 * ブロック辞退は専用ボタン、EffectQueue は前面カードの選択を担う。
 * 効果内チョイス / コスト支払 / 対象選択 / コア配置等のインタラクティブ
 * pending 中に下部 pass 操作だけが残ると、進行可能に見えて pending 解決と競合する。
 *
 * 方針: 対人戦の ActionBar の visibility 条件を `hasUiPending` に揃え、
 * EffectQueueOverlay.autoHide と同セットの pending 中はまとめて隠す。
 * 再生中だけ記録された操作を表示し、実行/辞退の送信は無効にする。
 *
 * このテストは BattleScreen.tsx ソースを読み、両者の判定式が
 * 同じシンボル (`hasUiPending`) を参照していることを保証する。
 * 将来、片方だけ条件追加して非対称になった時に早期検出する。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ACTION_UI_ROUTES } from "../src/components/action-ui";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BATTLE_SCREEN_PATH = resolve(
  __dirname,
  "../src/components/BattleScreen.tsx"
);
const TARGET_SELECTION_CONTROLLER_PATH = resolve(
  __dirname,
  "../src/components/TargetSelectionController.tsx"
);

describe("ActionBar / pending UI ルートのリグレッションガード (P3-39)", () => {
  it("下部 ActionBar route は pass 系と効果全体の決定だけに限定する", () => {
    const routedKinds = Object.entries(ACTION_UI_ROUTES)
      .filter(([, route]) => route === "action-bar")
      .map(([kind]) => kind)
      .sort();
    expect(routedKinds).toEqual([
      "declare_private_triggered_effect",
      "decline_pending_burst_check",
      "pass_battle_flash",
      "pass_pre_declaration_stack",
      "pass_stack",
      "resolve_pending_burst_check",
      "resolve_pending_triggered_effect",
      "select_pending_to_resolve",
      "skip_private_triggered_effect",
    ]);
  });

  it("効果内チョイス系 action は ActionBar route に戻さない", () => {
    const forbiddenActionBarKinds = [
      "resolve_pending_step_optional_choice",
      "resolve_pending_step_choice",
      "resolve_pending_deck_reveal_count_boost_choice",
      "resolve_pending_step_optional_target_selection",
      "resolve_pending_draw_step_cost_choice",
      "resolve_pending_summon_cost_exclude_choice",
      "resolve_pending_summon_cost_core_move_choice",
      "resolve_pending_grouped_summon_cost_override_choice",
      "resolve_pending_life_damage_discard_choice",
      "resolve_pending_life_gain_replacement_choice",
      "resolve_borrowed_effect_choice",
      "resolve_borrowed_effect_target",
      "resolve_pay_to_act_core_gate",
      "resolve_field_magic_pre_cost_trigger",
      "resolve_brave_leave_choice",
      "resolve_advent_source_replacement",
      "resolve_soul_state_replacement",
      "resolve_brave_attack_continuation",
      "resolve_set_aside_exit_replacement_choice",
      "resolve_connect_battle_decision",
    ] as const;
    for (const kind of forbiddenActionBarKinds) {
      expect(ACTION_UI_ROUTES[kind]).not.toBe("action-bar");
    }
  });

  it("ActionBar wrapper は対人戦の pending 中は隠し、再生操作だけ表示できる", () => {
    const src = readFileSync(BATTLE_SCREEN_PATH, "utf8");
    const re =
      /\(!hasUiPending\s*\|\|\s*replayPresentation\?\.action\)\s*&&\s*\(\s*<ActionBar/;
    expect(src).toMatch(re);
    expect(src).toContain(
      "if (replayPresentation?.action) return [replayPresentation.action];"
    );
    expect(src).toContain("onActionClick={readOnly ? () => {} : handleAction}");
  });

  it("EffectQueueOverlay.autoHide と ActionBar wrapper が同じ pending セットを参照する", () => {
    const src = readFileSync(BATTLE_SCREEN_PATH, "utf8");
    // hasUiPending 定義に含まれるべき pending state 群。
    // engine-state 系 pending は displayState (解決者でない pending を null 化済み) 経由で
    // 参照する (相手の対象選択中に自分の UI が反応しないようにする統合 gate)。
    const requiredPendings = [
      "pendingCostPayment",
      "pendingPlacement",
      "pendingCoreShoot",
      "pendingSeparation",
      "pendingAction",
      "pendingEffectChoice",
      "pendingMagicZoneCostSelection",
      "changeCleanupChoice",
      "magicCostModeChoice",
      "accelCostModeChoice",
      "asIfSoulCoreChoice",
      "fieldEffectChoice",
      "attackCostSourceChoice",
      "displayState.pendingBraveLeaveChoice",
      "displayState.pendingBraveAttackContinuation",
      "displayState.pendingSoulStateReplacement",
      "displayState.pendingAdventSourceReplacement",
      "displayState.pendingSetAsideExitReplacementChoice",
      "displayState.pendingChangeCleanupChoice",
      "displayState.pendingDeckReveal",
      "displayState.pendingZoneSelection",
      "displayState.pendingStepOptionalChoice",
      "displayState.pendingStepChoice",
      "displayState.pendingDeckRevealCountBoostChoice",
      "displayState.pendingStepOptionalTargetSelection",
      "displayState.pendingDrawStepCostChoice",
      "displayState.pendingSummonCostExcludeChoice",
      "displayState.pendingSummonCostCoreMoveChoice",
      "displayState.pendingGroupedSummonCostOverrideChoice",
      "displayState.pendingLifeDamageDiscardChoice",
      "displayState.pendingLifeGainReplacementChoice",
      "displayState.pendingCoreShootSelection",
      "displayState.pendingBorrowedEffectChoice",
      "displayState.pendingBorrowedEffectTargetSelection",
      "displayState.pendingPayToActCoreGate",
      "hasFieldMagicPreCostChoice",
      "displayState.pendingCoreSplitSelection",
      "displayState.pendingBraveCombineChoice",
      "displayState.pendingHandTrashSwapChoice",
      "displayState.pendingFieldHandSwapChoice",
      "displayState.pendingTenshoSummon",
      "displayState.pendingReverseRebirthSummon",
      "displayState.pendingStoneFlipCombine",
      "displayState.pendingSplitSummonChoice",
      "displayState.pendingCoreCountSelection",
      "displayState.pendingCountSelection",
      "displayState.pendingDiscardSetBurstCountSelection",
      "displayState.pendingLifeCoreSelection",
      "displayState.pendingCoreSourceAllocation",
      "displayState.pendingLinkAidCostSourceChoice",
      "displayState.pendingEffectSummonCostPayment",
      "displayState.pendingCoreDistribution",
      "displayState.pendingEffectTargetSelection",
      "displayState.pendingEffectOptionalRepeatChoice",
      "displayState.pendingEffectOptionalRepeatCountSelection",
      "displayState.pendingPayToActHandDiscardGate",
      "displayState.pendingEnterFieldPlacement",
      "displayState.pendingMultiPlacement",
      "displayState.pendingTargetRedirects",
      "displayState.pendingConnectBattleDecision",
    ];
    // hasUiPending 定義行を抽出
    const hasUiPendingMatch = src.match(
      /const hasUiPending\s*=\s*([\s\S]*?);\n/
    );
    expect(hasUiPendingMatch).not.toBeNull();
    const hasUiPendingDef = hasUiPendingMatch![1] ?? "";
    expect(src).toMatch(/const queueAutoHide\s*=\s*hasUiPending\s*;/);
    for (const p of requiredPendings) {
      expect(hasUiPendingDef).toContain(p);
    }
  });

  it("転醒後ブレイヴの合体/スピリット状態選択は直接合体モーダルから既存 HUD へ送る", () => {
    const src = readFileSync(BATTLE_SCREEN_PATH, "utf8");
    const modalStart = src.indexOf(
      "ブレイヴ召喚/転醒後ブレイヴ: スタック窓クローズ後"
    );
    expect(modalStart).toBeGreaterThanOrEqual(0);
    const modalEnd = src.indexOf("\n        })()}", modalStart);
    expect(modalEnd).toBeGreaterThan(modalStart);
    const modalBlock = src.slice(modalStart, modalEnd);
    expect(modalBlock).toContain("braveCombineChoicePending &&");
    expect(modalBlock).toContain(
      'className={`card-action-overlay${modalsHidden ? " modal-hidden" : ""}`}'
    );
    expect(modalBlock).toContain(
      'aria-hidden={modalsHidden ? "true" : undefined}'
    );
    expect(src).toContain("displayState.pendingBraveCombineChoice ??");
    expect(src).toContain("displayState.pendingStoneFlipCombine");
    expect(modalBlock).toContain('a.kind === "resolve_brave_combine_choice"');
    expect(modalBlock).toContain("a.pendingId === pending.pendingId");
    expect(modalBlock).toContain("pending.corePlacementChoice");
    expect(modalBlock).toContain("enterHostSelection");
    expect(modalBlock).toContain("candidateTargetInstanceIds: hostTargetIds");
    expect(modalBlock).toMatch(/>\s*合体\s*<\/button>/);
    expect(modalBlock).not.toContain("合体:");
    expect(src).toContain('title="合体先選択"');
    expect(src).toContain('subText="合体先をタップ"');
  });

  // 転召は共通対象HUDへ移行済み。盤面操作は scenario-choice-contract.spec.ts で検証する。

  it("バースト発動可否は専用 pending overlay ではなく EffectQueue 前面 ActionBar で処理する", () => {
    const src = readFileSync(BATTLE_SCREEN_PATH, "utf8");
    expect(ACTION_UI_ROUTES.resolve_pending_burst_check).toBe("action-bar");
    expect(ACTION_UI_ROUTES.decline_pending_burst_check).toBe("action-bar");
    expect(src).not.toContain("hasPendingBurstCheckDecision");
    expect(src).not.toContain('key: "burst-check"');
  });

  it("step-level optional choice は ActionBar ではなく専用 overlay で処理する", () => {
    expect(ACTION_UI_ROUTES.resolve_pending_step_optional_choice).toBe("other");
    const src = readFileSync(BATTLE_SCREEN_PATH, "utf8");
    expect(src).toContain("displayState.pendingStepOptionalChoice !== null");
    expect(src).toContain('a.kind === "resolve_pending_step_optional_choice"');
    expect(src).toContain("getActionLabel(a)");
  });

  it("効果全体の任意選択は EffectQueue 前面カードに対応する ActionBar で処理する", () => {
    expect(ACTION_UI_ROUTES.resolve_pending_triggered_effect).toBe(
      "action-bar"
    );
    expect(ACTION_UI_ROUTES.declare_private_triggered_effect).toBe(
      "action-bar"
    );
    expect(ACTION_UI_ROUTES.skip_private_triggered_effect).toBe("action-bar");
    expect(ACTION_UI_ROUTES.resolve_pending_burst_check).toBe("action-bar");
    expect(ACTION_UI_ROUTES.decline_pending_burst_check).toBe("action-bar");
    const src = readFileSync(BATTLE_SCREEN_PATH, "utf8");
    expect(src).toContain("activeQueueItemId");
    expect(src).toContain("buildEffectQueue(");
    expect(src).toContain(
      "onSkipOptional={readOnly ? () => {} : handleSkipOptionalAction}"
    );
  });

  it("効果文内の自己召喚コストは発揮宣言クリック時の summon_in_trigger HUD に送らない", () => {
    const src = readFileSync(BATTLE_SCREEN_PATH, "utf8");
    expect(src).toContain(
      "効果文内の支払いは解決時の共通pendingへ委ねる。応答窓前には選ばない。"
    );
    expect(src).toContain("pendingEffectSummonCostPayment");
    expect(src).toContain("resolve_pending_effect_summon_cost_payment");
    expect(src).not.toContain("openFreeEffectSummonPlacement");
    const declarationClickBlock = src.slice(
      src.indexOf("// 効果文内の支払いは解決時の共通pendingへ委ねる。"),
      src.indexOf("// その他のアクションは applyLegalAction")
    );
    expect(declarationClickBlock.length).toBeGreaterThan(0);
    expect(declarationClickBlock).not.toContain('mode: "summon_in_trigger"');
  });

  it("pendingMultiPlacement の field source は通常0+ソウルのみでもタップ候補に残す", () => {
    const src = readFileSync(BATTLE_SCREEN_PATH, "utf8");
    expect(src).toContain("const hasSoulHere =");
    expect(src).toContain("const hasSoulHere = source.hasSoul;");
    expect(src).toContain("const heldSoulFromHere =");
  });

  it("追加発揮 count_decrease の確定に click event object を混ぜない", () => {
    const battleScreen = readFileSync(BATTLE_SCREEN_PATH, "utf8");
    const targetSelectionController = readFileSync(
      TARGET_SELECTION_CONTROLLER_PATH,
      "utf8"
    );

    expect(targetSelectionController).toContain("onClick={() => a.onClick()}");
    expect(targetSelectionController).not.toContain("onClick={a.onClick}");
    expect(battleScreen).toContain(
      'typeof value === "number" ? value : optionalRepeatCountDraftTotal'
    );
    expect(battleScreen).toContain(
      "onClick: () => confirmOptionalRepeatCountSelection()"
    );
  });
});
