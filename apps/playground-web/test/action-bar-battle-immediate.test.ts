import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LegalAction } from "@orica/rules-core";
import { ActionBar } from "../src/components/ActionBar";

function battleImmediate(
  extra: Partial<Record<string, unknown>> = {}
): LegalAction {
  return {
    kind: "resolve_battle_immediate_effect",
    actionId: String(extra.actionId ?? "bie-action"),
    can: true,
    reason: "",
    actingPlayerId: "alice",
    promptId: String(extra.promptId ?? "bie-prompt"),
    attackId: "attack-1",
    timing: "attack",
    sourceKind: "spirit",
    sourceInstanceId: "source-1",
    sourceDefinitionId: "SOURCE",
    sourceCardNo: "SOURCE",
    participantEntityId: "battle-entity:source-1",
    executionMode: extra.executionMode ?? "mandatory",
    targetMode: "none",
    requiredTargetCount: 0,
    targetEffectFilterTags: [],
    candidateTargetInstanceIds: [],
    availableChosenLifeCoreKinds: [],
    requiresChosenLifeCoreKind: false,
    ...extra,
  } as unknown as LegalAction;
}

function selectPending(
  extra: Partial<Record<string, unknown>> = {}
): LegalAction {
  return {
    chainId: "test:action-bar-battle-immediate:38",
    kind: "select_pending_to_resolve",
    actionId: String(extra.actionId ?? "select-pending"),
    can: true,
    reason: "",
    actingPlayerId: String(extra.actingPlayerId ?? "alice"),
    pendingId: String(extra.pendingId ?? "pending-1"),
    ownerPlayerId: String(extra.ownerPlayerId ?? "alice"),
    eventKind: "summon",
    ...extra,
  } as unknown as LegalAction;
}

function burstResolve(
  extra: Partial<Record<string, unknown>> = {}
): LegalAction {
  return {
    chainId: "test:action-bar-battle-immediate:54",
    kind: "resolve_pending_burst_check",
    actionId: String(extra.actionId ?? "burst-resolve"),
    can: true,
    reason: "",
    actingPlayerId: "alice",
    checkId: "burst-check-1",
    eventKind: "own_attack",
    relatedPlayerId: "alice",
    sourceKind: "spirit",
    sourceInstanceId: "burst-src",
    sourceDefinitionId: "BSGE01-M03",
    sourceCardNo: "BSGE01-M03",
    registrationIndex: 0,
    targetMode: "none",
    requiredTargetCount: 0,
    targetEffectFilterTags: [],
    candidateTargetInstanceIds: [],
    availableChosenLifeCoreKinds: [],
    requiresChosenLifeCoreKind: false,
    playsSourceCardWithoutCostAfterResolve: false,
    usesSourceCardWithoutCostAfterResolve: false,
    playsTargetCardWithoutCostAfterResolve: false,
    usesTargetCardWithoutCostAfterResolve: false,
    enterFieldCorePlacementRule: "optional",
    minimumEnterFieldCoreCount: 0,
    maximumEnterFieldCoreCount: null,
    requiresEnterFieldCorePlacements: false,
    targetFollowUpMagicOptions: [],
    targetEnterFieldCorePlacementOptions: [],
    ...extra,
  } as unknown as LegalAction;
}

function burstDecline(): LegalAction {
  return {
    chainId: "test:action-bar-battle-immediate:89",
    kind: "decline_pending_burst_check",
    actionId: "burst-decline",
    can: true,
    reason: "",
    actingPlayerId: "alice",
    checkId: "burst-check-1",
    eventKind: "own_attack",
    relatedPlayerId: "alice",
  } as unknown as LegalAction;
}

function markupFor(actions: LegalAction[]): string {
  return renderToStaticMarkup(
    React.createElement(ActionBar, {
      actions,
      onActionClick: () => {},
      onSkipOptional: () => {},
    })
  );
}

function labelsFor(actions: LegalAction[]): string[] {
  const html = markupFor(actions);
  return [...html.matchAll(/<span class="action-label">([^<]*)<\/span>/g)].map(
    (match) => match[1] ?? ""
  );
}

describe("ActionBar battle immediate decisions", () => {
  it("shows mandatory target-free battle immediate as 解決 when it is the front queue action", () => {
    expect(labelsFor([battleImmediate()])).toEqual(["解決"]);
  });

  it("does not duplicate 発揮しない when an optional battle immediate already has a skipOnly action", () => {
    const promptId = "optional-bie";
    expect(
      labelsFor([
        battleImmediate({
          actionId: "optional-bie-resolve",
          promptId,
          executionMode: "optional",
        }),
        battleImmediate({
          actionId: "optional-bie-skip",
          promptId,
          executionMode: "optional",
          skipOnly: true,
        }),
      ])
    ).toEqual(["発揮する", "発揮しない"]);
  });

  it("shows self-owned optional select pending as 発揮する with a 発揮しない button", () => {
    const html = markupFor([
      selectPending({
        executionMode: "optional",
      }),
    ]);
    expect(labelsFor([selectPending({ executionMode: "optional" })])).toEqual([
      "発揮する",
    ]);
    expect(html).toContain("発揮しない");
  });

  it("separates optional and mandatory select actions within the same pending", () => {
    const html = markupFor([
      selectPending({
        actionId: "select-pending:optional",
        executionMode: "optional",
        sourceInstanceId: "optional-source",
        registrationIndex: 0,
      }),
      selectPending({
        actionId: "select-pending:mandatory",
        executionMode: "mandatory",
        sourceInstanceId: "mandatory-source",
        registrationIndex: 0,
      }),
    ]);
    expect(
      labelsFor([
        selectPending({
          actionId: "select-pending:optional",
          executionMode: "optional",
          sourceInstanceId: "optional-source",
          registrationIndex: 0,
        }),
        selectPending({
          actionId: "select-pending:mandatory",
          executionMode: "mandatory",
          sourceInstanceId: "mandatory-source",
          registrationIndex: 0,
        }),
      ])
    ).toEqual(["発揮する", "解決"]);
    expect(html.match(/data-testid="action-skip-/g)?.length).toBe(1);
  });

  it("keeps opponent-owned optional select pending as 解決", () => {
    expect(
      labelsFor([
        selectPending({
          executionMode: "optional",
          ownerPlayerId: "bob",
        }),
      ])
    ).toEqual(["解決"]);
  });

  it("deduplicates burst choice variants into one activation button", () => {
    expect(
      labelsFor([
        burstResolve({ actionId: "burst-resolve:0", choiceIndex: 0 }),
        burstResolve({ actionId: "burst-resolve:1", choiceIndex: 1 }),
        burstDecline(),
      ])
    ).toEqual(["バースト発動", "発動しない"]);
  });
});
