import { describe, expect, it } from "vitest";
import {
  hasImplicitEffectCoreChoice,
  hasDedicatedCoreSelector,
  hasForcedMultiPlacementPhase,
  hasRawMultiPlacementFieldSources,
} from "../../../scripts/core-hud-ssot.mjs";

describe("コアHUD SSOT検知", () => {
  it.each([
    "const payload = { coreSourceAllocations };",
    "recomposeCoreSourceAllocationLegalAction(drafts);",
    "dispatch({ coreSourceSoulCoreInstanceId: id });",
  ])("画面内に残った専用コスト配分経路を検知: %s", (source) => {
    expect(
      hasDedicatedCoreSelector(
        "const hud = buildPendingCoreHud(displayState, myActions); " + source
      )
    ).toBe(true);
  });
  it("配分pendingの表示判定と共通アダプターへの委譲を許可する", () => {
    expect(
      hasDedicatedCoreSelector(
        "// coreSourceAllocationsはアダプターに委譲\nconst hud = buildPendingCoreHud(displayState, myActions); const busy = displayState.pendingCoreSourceAllocation !== null;"
      )
    ).toBe(false);
  });
  it("共通HUDと同居していてもリンクエイドの専用支払いボタンを拒否する", () => {
    expect(
      hasDedicatedCoreSelector(
        "<CoreSelectionHud /><button onClick={() => handleAction(a)}>{cardName(a.costSourceInstanceId)}（コア{a.availableNormalCoreCount}個）</button>"
      )
    ).toBe(true);
  });
  it.each([
    "CoreCountModal",
    "PendingLifeCoreSelectionModal",
    "SummonCostCoreMoveChoiceModal",
  ])("%sによる迂回を検知", (name) => {
    expect(
      hasDedicatedCoreSelector(
        "<" + name + " pending={pending} onConfirm={confirm} />"
      )
    ).toBe(true);
  });
  it("発揮前提コアをカード候補ボタンで直接払う迂回を検知", () => {
    expect(
      hasDedicatedCoreSelector(
        "candidates.map(c => ({payload:{payToActCoreSourceContainerId:c.containerId}}))"
      )
    ).toBe(true);
  });
  it("単体かどうかを見ずに複数配置HUDを固定する回帰を検知", () => {
    expect(
      hasForcedMultiPlacementPhase(
        '<CoreSelectionHud mode="placement_multi" phase={phase} />'
      )
    ).toBe(true);
    expect(
      hasForcedMultiPlacementPhase(
        '<CoreSelectionHud mode={fixedDestination ? "placement_single" : "placement_multi"} />'
      )
    ).toBe(false);
  });
  it("共通アダプターと非コアのカード選択を許可する", () => {
    expect(
      hasDedicatedCoreSelector(
        "<CoreSelectionHud {...props} /><button onClick={selectCard}>選択</button>"
      )
    ).toBe(false);
  });

  it.each([
    'if (displayState.pendingMultiPlacement) { const card = state.cardInstances.find(c => c.instanceId === locationId); if (card.zone === "field" && card.normalCoreCount > 0) grab(card); }',
    "if (state.pendingMultiPlacement) { for (const card of state.cardInstances) { if (card.controllerPlayerId === viewer) ids.add(card.instanceId); } }",
    'if (view["pendingMultiPlacement"]) { const cards = game["cardInstances"]; }',
  ])("複数配置の生カード走査を検知: %s", (source) => {
    // 他の配置経路に正源の呼び出しがあっても、違反ブロックを免除しない。
    expect(
      hasRawMultiPlacementFieldSources(
        "buildPlacementFieldSources(options); " + source
      )
    ).toBe(true);
  });
  it("正源が返した配置元からの候補表示とgrabを許可する", () => {
    expect(
      hasRawMultiPlacementFieldSources(`
      const sources = buildPlacementFieldSources(options);
      if (displayState.pendingMultiPlacement) {
        const source = sources.find(c => c.instanceId === locationId);
        if (source) grab(source);
      } else { const target = state.cardInstances.find(c => c.instanceId === id); }
      if (displayState.pendingMultiPlacement) {
        for (const source of sources) ids.add(source.instanceId);
      }
    `)
    ).toBe(false);
  });
});

it.each(["chooseAutoCardCostPaymentSources", "applyAutoEnterFieldCores"])(
  "効果解決の暗黙コア選択を検知: %s",
  (helper) => {
    expect(
      hasImplicitEffectCoreChoice(
        `function executeSummon() { return ${helper}(state); }`
      )
    ).toBe(true);
    expect(
      hasImplicitEffectCoreChoice(
        `function canExecuteSummonSelfNow() { return ${helper}(state) !== null; }`
      )
    ).toBe(false);
    expect(
      hasImplicitEffectCoreChoice(
        "function executeSummon() { return resolveEffectSummonPaymentChoice(options); }"
      )
    ).toBe(false);
  }
);
