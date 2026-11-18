import { isCardInEffectZone } from "./card-access-rules";
import { getEffectiveLevel } from "../battle/battle-shared";
import { matchesCardFilter } from "../card/card-filter";
import { isEffectFieldEntryRestricted } from "../card/put-card-on-field";
import { getEffectiveTribes } from "../legal/legal-actions-shared";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";
import type {
  CardDefinition,
  CardInstance,
  EffectPreventionLevel,
  GameState,
  ReturnFromTrashAction,
  Zone,
} from "../model";
import type { Action, CardFilter } from "../dsl-types";
import type { TriggerContext } from "./structured-effect-interpreter";
import {
  isCardLeaveAffectBlockedByResistance,
  isCardZoneEntryAffectBlockedByResistance,
  resolveCardImmunityAffect,
} from "./effect-affect-adapter";
import { isHandGainPreventedByOwnEffect } from "./effect-resistance-check";
import { findMovedToTrashAutoEffect } from "./structured-trash-ops";
import type { TargetLockBypassProfile } from "./target-affect-gate";

type QueueHandTrashSwapAction = Extract<
  Action,
  { kind: "queue_hand_trash_swap" }
>;

function buildCardEventTriggerContext(args: {
  state: GameState;
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  sourceDefinition?: CardDefinition;
  effectSource?: { instance?: CardInstance; definition?: CardDefinition };
}): TriggerContext {
  const sourceCard = args.effectSource?.instance;
  const sourceDef = args.effectSource?.definition ?? args.sourceDefinition;
  const context: TriggerContext = {
    sourcePlayerId: sourceCard?.ownerPlayerId ?? args.actingPlayerId,
  };
  if (!sourceDef) return context;
  context.sourceColors = sourceDef.colors;
  if (sourceCard) {
    context.sourceTribes = getEffectiveTribes(
      args.state,
      sourceCard,
      sourceDef,
      args.getCardDefinitionById
    );
    const sourceCategory = getEffectiveCategory(
      args.state,
      sourceCard,
      sourceDef
    );
    if (sourceCategory !== undefined) {
      context.sourceCategory = sourceCategory;
    }
  } else {
    if (sourceDef.tribe) {
      context.sourceTribes = [sourceDef.tribe];
    }
    context.sourceCategory = sourceDef.printedCategory;
  }
  return context;
}

function hasMovedToTrashBlockedDisposition(args: {
  state: GameState;
  candidate: CardInstance;
  def: CardDefinition;
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  sourceDefinition?: CardDefinition;
  effectSource?: { instance?: CardInstance; definition?: CardDefinition };
}): boolean {
  return (
    findMovedToTrashAutoEffect(
      args.state,
      args.candidate.instanceId,
      args.def,
      args.getCardDefinitionById,
      buildCardEventTriggerContext(args)
    )?.kind === "blocked"
  );
}

export function resolveHandTrashSearchCandidates(args: {
  state: GameState;
  actingPlayerId: string;
  zoneOwnerId: string;
  zones: readonly ("hand" | "trash" | "set_aside")[];
  filter?: CardFilter;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  /** `CardFilter.cardName:"self"` 解決用の効果発動元カード定義。 */
  sourceDefinition?: CardDefinition;
  sourcePreventionLevel?: EffectPreventionLevel;
  effectSource?: { instance?: CardInstance; definition?: CardDefinition };
  sourcePreventionBypass?: TargetLockBypassProfile;
  returnFromTrashDestination?: ReturnFromTrashAction["destination"];
  blockMovedToTrashBlockedDisposition?: boolean;
}): CardInstance[] {
  // hand_gain_prevention (engine-restrict-hand-gain-bsrk01-x01, BSRK01-X01 合体結誓):
  // 制約対象自身の効果で destination:"hand" にする場合だけ候補を 0 件にする。
  // 相手の効果で対象プレイヤーのカードを手札へ戻す場合は本文どおり許可する。
  if (
    args.returnFromTrashDestination === "hand" &&
    isHandGainPreventedByOwnEffect(
      args.state,
      args.zoneOwnerId,
      args.actingPlayerId
    )
  ) {
    return [];
  }
  const zoneSet = new Set(args.zones);
  return args.state.cardInstances.filter((candidate) => {
    if (candidate.ownerPlayerId !== args.zoneOwnerId) return false;
    if (
      !isCardInEffectZone(
        args.state,
        candidate,
        [...zoneSet],
        args.actingPlayerId,
        args.getCardDefinitionById
      )
    )
      return false;
    const def = args.getCardDefinitionById(candidate.definitionId);
    if (!def) return false;
    if (
      candidate.zone === "trash" &&
      (args.returnFromTrashDestination === "hand" ||
        args.blockMovedToTrashBlockedDisposition === true) &&
      hasMovedToTrashBlockedDisposition({
        state: args.state,
        candidate,
        def,
        actingPlayerId: args.actingPlayerId,
        getCardDefinitionById: args.getCardDefinitionById,
        ...(args.sourceDefinition !== undefined
          ? { sourceDefinition: args.sourceDefinition }
          : {}),
        ...(args.effectSource !== undefined
          ? { effectSource: args.effectSource }
          : {}),
      })
    ) {
      return false;
    }
    if (
      args.filter &&
      !matchesCardFilter(candidate, def, args.filter, {
        state: args.state,
        effectiveTribes: getEffectiveTribes(
          args.state,
          candidate,
          def,
          args.getCardDefinitionById
        ),
        effectiveLevel:
          candidate.zone === "field"
            ? getEffectiveLevel(
                args.state,
                candidate,
                def,
                args.getCardDefinitionById
              )
            : undefined,
        ...(args.sourceDefinition !== undefined
          ? { sourceDefinition: args.sourceDefinition }
          : {}),
      })
    ) {
      return false;
    }
    if (
      resolveCardImmunityAffect(
        args.state,
        candidate,
        args.actingPlayerId,
        args.sourcePreventionLevel ?? "none",
        args.effectSource,
        args.getCardDefinitionById,
        args.sourcePreventionBypass
      ).kind !== "allowed"
    ) {
      return false;
    }

    const destination = args.returnFromTrashDestination;
    if (
      destination === "field" &&
      isEffectFieldEntryRestricted(
        args.state,
        candidate,
        def,
        args.getCardDefinitionById
      )
    )
      return false;
    const returnLeaveOutcome =
      destination === undefined || destination === "field"
        ? null
        : destination === "deck"
          ? "send_to_deck"
          : destination === "removed_from_game"
            ? "remove_from_game"
            : "bounce";
    if (
      returnLeaveOutcome !== null &&
      isCardLeaveAffectBlockedByResistance(
        args.state,
        candidate,
        returnLeaveOutcome,
        args.actingPlayerId,
        args.getCardDefinitionById,
        args.sourcePreventionLevel ?? "none",
        false,
        args.sourcePreventionBypass
      )
    ) {
      return false;
    }
    // ENGINE-set-aside-entry-restriction: 移動先が手元 (set_aside) のとき、
    // destination-zone-scoped resistance (cannot_enter_zone) で阻止される候補を除外する
    // (BSTH08.5-X04「このカードの効果以外で手元に置けない」)。
    if (
      destination === "set_aside" &&
      isCardZoneEntryAffectBlockedByResistance(
        args.state,
        candidate,
        "set_aside",
        args.actingPlayerId,
        args.getCardDefinitionById,
        args.sourcePreventionLevel ?? "none",
        args.sourcePreventionBypass
      )
    ) {
      return false;
    }
    return true;
  });
}

export function resolveHandTrashSwapCandidates(args: {
  state: GameState;
  sourceInstanceId: string;
  actingPlayerId: string;
  action: QueueHandTrashSwapAction;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  sourceDefinition?: CardDefinition;
  sourcePreventionLevel?: EffectPreventionLevel;
  effectSource?: { instance?: CardInstance; definition?: CardDefinition };
  sourcePreventionBypass?: TargetLockBypassProfile;
}): {
  outgoingZones: ReadonlyArray<Extract<Zone, "hand" | "set_aside">>;
  outgoingCandidates: CardInstance[];
  incomingCandidates: CardInstance[];
} {
  const outgoingZones: ReadonlyArray<Extract<Zone, "hand" | "set_aside">> = args
    .action.outgoingZones ?? ["hand", "set_aside"];
  const filterSourceDefinition =
    args.effectSource?.definition ?? args.sourceDefinition;
  const matchOpts = filterSourceDefinition
    ? { sourceDefinition: filterSourceDefinition }
    : undefined;
  const outgoingCandidates = args.state.cardInstances.filter((candidate) => {
    if (
      !isCardInEffectZone(
        args.state,
        candidate,
        outgoingZones,
        args.actingPlayerId,
        args.getCardDefinitionById
      )
    )
      return false;
    if (candidate.ownerPlayerId !== args.actingPlayerId) return false;
    const def = args.getCardDefinitionById(candidate.definitionId);
    if (!def) return false;
    return matchesCardFilter(
      candidate,
      def,
      args.action.outgoingFilter,
      matchOpts
    );
  });

  const incomingCandidates = resolveHandTrashSearchCandidates({
    state: args.state,
    actingPlayerId: args.actingPlayerId,
    zoneOwnerId: args.actingPlayerId,
    zones: ["trash"],
    filter: args.action.incomingFilter,
    getCardDefinitionById: args.getCardDefinitionById,
    ...(filterSourceDefinition !== undefined
      ? { sourceDefinition: filterSourceDefinition }
      : {}),
    ...(args.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: args.sourcePreventionLevel }
      : {}),
    ...(args.effectSource !== undefined
      ? { effectSource: args.effectSource }
      : {}),
    ...(args.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: args.sourcePreventionBypass }
      : {}),
    blockMovedToTrashBlockedDisposition: true,
    returnFromTrashDestination:
      outgoingZones.length === 1 && outgoingZones[0] === "set_aside"
        ? "set_aside"
        : "hand",
  });

  return {
    outgoingZones,
    outgoingCandidates,
    incomingCandidates:
      args.action.incomingFrom === "source_card"
        ? incomingCandidates.filter(
            (card) => card.instanceId === args.sourceInstanceId
          )
        : incomingCandidates,
  };
}
