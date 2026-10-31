/**
 * P3-54 Phase A: action label executionMode 統一の単体テスト。
 *
 * `resolve_pending_triggered_effect` / `resolve_battle_immediate_effect` /
 * self-owned `select_pending_to_resolve` は kind ベースではなく executionMode
 * ベースで以下のラベルを返す:
 *   - mandatory → "解決"
 *   - optional  → "発揮する"
 *
 * その他 kind は静的 ACTION_LABELS と同じ値を返す。
 */
import { describe, expect, it } from "vitest";
import { getActionLabel } from "../src/components/action-ui";
import type { LegalAction } from "@orica/rules-core";

const baseTriggered = {
  chainId: "test:action-label-by-mode:16",
  kind: "resolve_pending_triggered_effect" as const,
  actionId: "act-1",
  can: true as const,
  reason: "",
  actingPlayerId: "alice",
  pendingId: "pending-1",
  eventKind: "summon" as const,
  targetMode: "none" as const,
  requiredTargetCount: 0,
  targetEffectFilterTags: [],
  candidateTargetInstanceIds: [],
  availableChosenLifeCoreKinds: [],
  requiresChosenLifeCoreKind: false,
};

const baseBattleImmediate = {
  kind: "resolve_battle_immediate_effect" as const,
  actionId: "act-2",
  can: true as const,
  reason: "",
  actingPlayerId: "alice",
  promptId: "prompt-1",
  attackId: "atk-1",
  timing: "after_block" as const,
  sourceKind: "spirit" as const,
  sourceInstanceId: "src-1",
  sourceDefinitionId: "def-1",
  sourceCardNo: "BSTH01-X03",
  participantEntityId: "atk-1",
  targetMode: "none" as const,
  requiredTargetCount: 0,
  targetEffectFilterTags: [],
  candidateTargetInstanceIds: [],
  availableChosenLifeCoreKinds: [],
  requiresChosenLifeCoreKind: false,
};

describe("getActionLabel (P3-54 Phase A)", () => {
  it("resolve_pending_triggered_effect: mandatory → 解決", () => {
    const action = {
      ...baseTriggered,
      executionMode: "mandatory" as const,
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("解決");
  });

  it("resolve_pending_triggered_effect: optional → 発揮する", () => {
    const action = {
      ...baseTriggered,
      executionMode: "optional" as const,
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("発揮する");
  });

  it("resolve_battle_immediate_effect: mandatory → 解決", () => {
    const action = {
      ...baseBattleImmediate,
      executionMode: "mandatory" as const,
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("解決");
  });

  it("resolve_battle_immediate_effect: optional → 発揮する", () => {
    const action = {
      ...baseBattleImmediate,
      executionMode: "optional" as const,
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("発揮する");
  });

  it("select_pending_to_resolve: self-owned optional → 発揮する", () => {
    const action = {
      chainId: "test:action-label-by-mode:88",
      kind: "select_pending_to_resolve",
      actionId: "act-3",
      can: true,
      reason: "",
      actingPlayerId: "alice",
      pendingId: "pending-1",
      ownerPlayerId: "alice",
      eventKind: "summon",
      executionMode: "optional",
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("発揮する");
  });

  it("select_pending_to_resolve: opponent-owned optional → 解決", () => {
    const action = {
      chainId: "test:action-label-by-mode:103",
      kind: "select_pending_to_resolve",
      actionId: "act-3b",
      can: true,
      reason: "",
      actingPlayerId: "alice",
      pendingId: "pending-1",
      ownerPlayerId: "bob",
      eventKind: "summon",
      executionMode: "optional",
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("解決");
  });

  it("select_pending_to_resolve: mandatory/unknown → 解決", () => {
    const action = {
      chainId: "test:action-label-by-mode:118",
      kind: "select_pending_to_resolve",
      actionId: "act-3c",
      can: true,
      reason: "",
      actingPlayerId: "alice",
      pendingId: "pending-1",
      ownerPlayerId: "alice",
      eventKind: "summon",
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("解決");
  });

  it("declare_private_triggered_effect: 発揮する (静的)", () => {
    const action = {
      chainId: "test:action-label-by-mode:132",
      kind: "declare_private_triggered_effect",
      actionId: "act-4",
      can: true,
      reason: "",
      actingPlayerId: "alice",
      declarationId: "dec-1",
      eventKind: "summon",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "def-1",
      sourceCardNo: "BSTH01-X03",
      registrationIndex: 0,
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("発揮する");
  });

  it("pass_battle_flash: responseTiming=flash → フラッシュパス", () => {
    const action = {
      kind: "pass_battle_flash",
      actionId: "pass-1",
      can: true,
      reason: "",
      actingPlayerId: "alice",
      attackId: "atk-1",
      flashKind: "before_block",
      responseTiming: "flash",
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("フラッシュパス");
  });

  it("pass_battle_flash: responseTiming=stack → スタックパス", () => {
    const action = {
      kind: "pass_battle_flash",
      actionId: "pass-2",
      can: true,
      reason: "",
      actingPlayerId: "alice",
      attackId: "atk-1",
      flashKind: "before_block",
      responseTiming: "stack",
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("スタックパス");
  });

  it("skip_private_triggered_effect: 発揮しない (静的)", () => {
    const action = {
      chainId: "test:action-label-by-mode:177",
      kind: "skip_private_triggered_effect",
      actionId: "act-5",
      can: true,
      reason: "",
      actingPlayerId: "alice",
      declarationId: "dec-1",
      eventKind: "summon",
      sourceInstanceId: "src-1",
      sourceDefinitionId: "def-1",
      sourceCardNo: "BSTH01-X03",
      registrationIndex: 0,
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("発揮しない");
  });

  it("contract_combine: カードタップ→候補選択で解決するため静的ラベルを返す (P3-111 followup: brave_combine 型フローへ移行)", () => {
    const action = {
      kind: "contract_combine",
      actionId: "act-6",
      can: true,
      reason: "",
      actingPlayerId: "alice",
      braveInstanceId: "brave-1",
      braveCardNo: "BSGE01-C05",
      targetInstanceId: "host-1",
      targetCardNo: "BSGE01-R05",
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("契約合体");
  });

  it("link_aid: 魂状態カードタップで宣言するため静的ラベルを返す (P3-111 S6 followup)", () => {
    const action = {
      kind: "link_aid",
      actionId: "act-7",
      can: true,
      reason: "",
      actingPlayerId: "alice",
      soulStateCardInstanceId: "soul-1",
      soulStateCardNo: "BSGE01-CX01",
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("リンクエイド");
  });

  it("resolve_pending_link_aid_cost_source_choice: 窓後支払い元選択の静的ラベルを返す", () => {
    const action = {
      kind: "resolve_pending_link_aid_cost_source_choice",
      actionId: "act-8",
      can: true,
      reason: "",
      actingPlayerId: "alice",
      pendingId: "link-aid-cost-source:1",
      soulStateCardInstanceId: "soul-1",
      soulStateCardNo: "BSGE01-CX01",
      costSourceInstanceId: "src-1",
      costSourceCardNo: "BSGE01-C05",
      availableNormalCoreCount: 1,
    } as unknown as LegalAction;
    expect(getActionLabel(action)).toBe("リンクエイド支払い元");
  });
});
