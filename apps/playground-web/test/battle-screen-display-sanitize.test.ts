/**
 * リグレッションガード: シナリオ / スナップショット経路 (サーバ sanitize を通らない
 * クライアント単独) で、BattleScreen が表示層に sanitize 済み state を渡すこと。
 *
 * これを外すと viewer=bob で相手の裏向きフィールドカード (分身 token 等) の正体が
 * CardView の色クラスや詳細モーダルから漏れる (2026-05-30 リーク)。engine /
 * legal-action / 相手 auto-play は full `state` を使い続ける必要があるため、
 * sanitize は「表示専用」であることをソースレベルで固定する。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BATTLE_SCREEN = readFileSync(
  resolve(__dirname, "../src/components/BattleScreen.tsx"),
  "utf8"
);
const ZONE_SELECTION_MODAL = readFileSync(
  resolve(__dirname, "../src/components/ZoneSelectionModal.tsx"),
  "utf8"
);

describe("BattleScreen 表示用サニタイズ", () => {
  it("displayState を sanitizeStateForViewer(state, viewingPlayer) で算出する", () => {
    expect(BATTLE_SCREEN).toMatch(
      /sanitizeStateForViewer\(\s*state\s*,\s*viewingPlayer\s*\)/
    );
  });

  it("FieldArea には sanitize 済み cardInstances を渡す (full state.cardInstances を直接渡さない)", () => {
    expect(BATTLE_SCREEN).toMatch(/cards=\{fieldDisplayState\.cardInstances\}/);
    expect(BATTLE_SCREEN).toMatch(
      /projectRebirthCorePlacementPreview\(displayState,\s*getDefinition\)/
    );
    expect(BATTLE_SCREEN).not.toMatch(/cards=\{state\.cardInstances\}/);
  });

  it("詳細モーダルは sanitize 済みインスタンスで定義を解決する", () => {
    expect(BATTLE_SCREEN).toMatch(
      /sanitizedCardById\.get\(detailCard\.instanceId\)/
    );
  });

  /**
   * P3-79: 効果由来の pending UI モーダル (CoreDistribution / MultiPlacement /
   * DeckReveal / ZoneSelection / CoreSplitSelection) は displayState 経由で
   * gate する。raw `state.pending*` で gate すると非解決者の viewer にも
   * モーダルが描画される連動バグになる (BSTH01-M01 でユーザー報告)。
   *
   * `state-sanitize.ts:maskPendingPromptsForViewer` が actingPlayerId !==
   * viewerPlayerId の pending を null 化する SSOT を提供しているので、表示
   * 判定はそれを通った `displayState` を読むのが正。
   */
  it("コア配分モーダル (pendingCoreDistribution) は displayState で gate する", () => {
    expect(BATTLE_SCREEN).toMatch(
      /\) : displayState\.pendingCoreDistribution \? \(/
    );
    // 旧 raw state パターンは消えていること
    expect(BATTLE_SCREEN).not.toMatch(
      /\) : state\.pendingCoreDistribution \? \(/
    );
  });

  it("複数体配置モーダル (pendingMultiPlacement) は displayState で gate する", () => {
    expect(BATTLE_SCREEN).toMatch(
      /(?:\{|:\s*)displayState\.pendingMultiPlacement \? \(/
    );
    expect(BATTLE_SCREEN).not.toMatch(/\{state\.pendingMultiPlacement \? \(/);
  });

  it("共通コアHUDも解決者のdisplayStateとmyActionsだけを入力にする", () => {
    expect(BATTLE_SCREEN).toMatch(
      /buildPendingCoreHud\(displayState, myActions\)/
    );
    expect(BATTLE_SCREEN).not.toMatch(/buildPendingCoreHud\(state,/);
  });

  it("デッキオープン / ゾーン選択 / コア分配 (split) UI は displayState で gate する", () => {
    expect(BATTLE_SCREEN).toMatch(/\{displayState\.pendingDeckReveal &&/);
    expect(BATTLE_SCREEN).toMatch(/\{displayState\.pendingZoneSelection &&/);
    expect(BATTLE_SCREEN).toMatch(
      /\) : displayState\.pendingCoreSplitSelection \? \(/
    );
    // 旧 raw state パターンは消えていること
    expect(BATTLE_SCREEN).not.toMatch(/\{state\.pendingDeckReveal &&/);
    expect(BATTLE_SCREEN).not.toMatch(/\{state\.pendingZoneSelection &&/);
    expect(BATTLE_SCREEN).not.toMatch(
      /\) : state\.pendingCoreSplitSelection \? \(/
    );
  });

  it("コア配分の tap handler / coreTapTargetIds / coreTapZones は displayState を読む", () => {
    // tap handler 入り口
    expect(BATTLE_SCREEN).toMatch(
      /if \(displayState\.pendingCoreDistribution\) \{\s*const dist = displayState\.pendingCoreDistribution;/
    );
    // coreTapTargetIds: candidates / allowedSources 経路
    expect(BATTLE_SCREEN).toMatch(
      /\} else if \(displayState\.pendingCoreDistribution\) \{/
    );
    // coreTapZones useMemo
    expect(BATTLE_SCREEN).toMatch(
      /displayState\.pendingCoreDistribution\?\.fromKind === "any_movable"/
    );
  });

  it("コア配分 GUI は複数ソウルコアを宛先別 map で送信する", () => {
    expect(BATTLE_SCREEN).toMatch(
      /const trashDistSoulAllocations = useMemo<Record<string, number>>/
    );
    expect(BATTLE_SCREEN).toMatch(
      /coreDistributionSoulCoreAllocations:\s*recomposed\.coreDistributionSoulCoreAllocations/
    );
    expect(BATTLE_SCREEN).toMatch(
      /coreDistributionSoulCoreSourceAllocations:\s*recomposed\.coreDistributionSoulCoreSourceAllocations/
    );
    expect(BATTLE_SCREEN).toMatch(/const anyMovableSoulSourceIds = useMemo/);
    expect(BATTLE_SCREEN).toMatch(/trashDistSoulTotal < totalSoulCores/);
    expect(BATTLE_SCREEN).not.toMatch(/const trashDistSoulTarget/);
  });

  it("any_movable コア配分 GUI の minTotal 既定値は engine と同じ 0", () => {
    expect(BATTLE_SCREEN).toMatch(/const minTotal = dist\.minTotal \?\? 0;/);
    expect(BATTLE_SCREEN).not.toMatch(
      /const minTotal = dist\.minTotal \?\? 1;/
    );
  });

  /**
   * P3-79 follow-up: 次のステップ / コア移動ボタンの `hasPending` は、
   * UI 反応 (`hasUiPending`) と違って **両者で待たせたい** ので、表示用
   * sanitize ではなく engine の進行 blocker (`getGameProgressBlockerReason(state)`)
   * を読む。
   *
   * 旧実装は `pendingCoreDistribution` / `pendingMultiPlacement` /
   * `pendingEffectTargetSelection` を抜けで、M01 起動中の actor が「次のステップ」を
   * 直押しできてしまっていた (handleAdvanceStep は engine.advanceStep を直呼びする
   * 経路があるため legal-action filter では止まらない)。
   */
  it("hasPending は engine 進行 blocker を使う (両者で disable)", () => {
    expect(BATTLE_SCREEN).toMatch(
      /getGameProgressBlockerReason\(state\) !== null/
    );
  });

  it("pendingZoneSelection の canSkip=true は 1..maxCount 枚の中間選択を確定できる", () => {
    expect(ZONE_SELECTION_MODAL).toMatch(
      /action\.canSkip\s*\?\s*selectedIds\.length > 0 &&\s*selectedIds\.length <= action\.maxCount\s*:\s*selectedIds\.length === action\.maxCount/
    );
    expect(BATTLE_SCREEN).toMatch(
      /action\.canSkip\s*\?\s*handPendingSelectedIds\.length > 0 &&\s*handPendingSelectedIds\.length <= action\.maxCount\s*:\s*handPendingSelectedIds\.length === action\.maxCount/
    );
  });

  it("手札 zone selection のインライン化は選択者自身の手札候補だけに限定する", () => {
    expect(BATTLE_SCREEN).toContain(
      "!isInHandForOwnEffect(state, card, viewingPlayer, getDefinition)"
    );
    expect(BATTLE_SCREEN).toMatch(/card\.controllerPlayerId !== viewingPlayer/);
    expect(BATTLE_SCREEN).toMatch(
      /displayState\.pendingZoneSelection &&\s*!inlineHandSelection/
    );
    expect(BATTLE_SCREEN).toMatch(
      /displayState\.pendingZoneSelection !== null &&\s*inlineHandSelection === null/
    );
  });

  it("pendingAction の自分手札 target 候補は HandArea とゾーン候補の両方に載せる", () => {
    expect(BATTLE_SCREEN).toMatch(
      /const pendingActionHandTargetCandidateIds = useMemo/
    );
    expect(BATTLE_SCREEN).toMatch(
      /isInHandForOwnEffect\(state, card, viewingPlayer, getDefinition\) &&\s*card\.controllerPlayerId === viewingPlayer/
    );
    expect(BATTLE_SCREEN).toMatch(
      /pendingAction !== null && !hasInlineHandTargetSelection/
    );
    expect(BATTLE_SCREEN).toMatch(
      /return new Set\(pendingActionHandTargetCandidateIds\)/
    );
    expect(BATTLE_SCREEN).not.toMatch(
      /!pendingActionHandTargetCandidateIds\.has\(c\.instanceId\)/
    );
    expect(BATTLE_SCREEN).toMatch(
      /pendingActionHandTargetCandidateIds\.has\(id\)\) \{\s*handleTargetClick\(id\);/
    );
  });

  /**
   * P3-79: ブレイヴ選択モーダル (P2-09 残す/同行・P2-10 継続/終了・合体可否) も
   * displayState で gate する。これらは `choosingPlayerId / actingPlayerId ===
   * viewingPlayer` の明示 gate も持つが、`sanitizeStateForViewer` が非解決者で
   * null 化する SSOT に揃え、設計コメント (UI 表示は displayState 経由) を全モーダルで成立させる。
   */
  it("ブレイヴ選択モーダル (leave / attack-continuation / combine) は displayState で gate する", () => {
    expect(BATTLE_SCREEN).toMatch(
      /const braveLeaveChoicePending = pendingSeparation\s*\? null\s*:\s*displayState\.pendingBraveLeaveChoice/
    );
    expect(BATTLE_SCREEN).toMatch(/\{braveLeaveChoicePending !== null &&/);
    expect(BATTLE_SCREEN).toMatch(
      /\{displayState\.pendingBraveAttackContinuation !== null &&/
    );
    expect(BATTLE_SCREEN).toContain("const braveCombineChoicePending =");
    expect(BATTLE_SCREEN).toContain(
      "displayState.pendingBraveCombineChoice ??"
    );
    expect(BATTLE_SCREEN).toContain("displayState.pendingStoneFlipCombine");
    expect(BATTLE_SCREEN).toMatch(/\{braveCombineChoicePending &&/);
    // 旧 raw state パターンは消えていること
    expect(BATTLE_SCREEN).not.toMatch(
      /\{state\.pendingBraveLeaveChoice !== null &&/
    );
    expect(BATTLE_SCREEN).not.toMatch(
      /\{state\.pendingBraveAttackContinuation !== null &&/
    );
    expect(BATTLE_SCREEN).not.toMatch(/\{state\.pendingBraveCombineChoice &&/);
    expect(BATTLE_SCREEN).not.toMatch(/\{state\.pendingStoneFlipCombine &&/);
  });
});
