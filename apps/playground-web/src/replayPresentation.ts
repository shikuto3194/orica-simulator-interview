import {
  getCurrentActorPlayerIds,
  stepDisplayLabel,
  zoneDisplayLabel,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { ACTION_LABELS, getActionLabel } from "./components/action-ui";
import type { ReplayFrame } from "./replayViewer";
import {
  recordedPreGameInputs,
  type RecordedPreGameInput,
} from "./preGamePresentation";

export interface ReplayFocus {
  cardId?: string;
  playerId: string;
  zone: string;
  label: string;
}
export interface ReplayPresentation {
  actor: string;
  legalAction?: LegalAction;
  controlTestId?: string;
  preGameInputs: RecordedPreGameInput[];
  action: string;
  source?: ReplayFocus;
  selections: ReplayFocus[];
  result: string;
}

export function replayActor(
  before: GameState,
  after: GameState,
  frame: ReplayFrame
): string {
  return (
    frame.actingPlayerId ??
    recordedPreGameInputs(before, after)[0]?.actor ??
    [...getCurrentActorPlayerIds(before)][0] ??
    before.activePlayerId
  );
}

/** Presentation only: infer gestures from existing trace identifiers and state deltas. */
export function buildReplayPresentation(
  before: GameState,
  after: GameState,
  frame: ReplayFrame,
  getDefinition: (id: string) => CardDefinition | undefined,
  legalActions: readonly LegalAction[] = []
): ReplayPresentation {
  const actor = replayActor(before, after, frame);
  const preGameInputs = recordedPreGameInputs(before, after);
  const matchingActions = legalActions.filter((action) =>
    frame.actionId
      ? action.actionId === frame.actionId
      : action.kind === frame.actionKind
  );
  const legal = matchingActions.length === 1 ? matchingActions[0] : undefined;
  const kind = legal?.kind ?? frame.actionKind ?? frame.systemActionKind;
  const label =
    kind && Object.hasOwn(ACTION_LABELS, kind)
      ? ACTION_LABELS[kind as keyof typeof ACTION_LABELS]
      : undefined;
  let action = legal
    ? getActionLabel(legal)
    : (label ?? (kind === "advance_step" ? "次のステップへ" : "操作を確認"));
  const name = (id: string) => {
    const card =
      before.cardInstances.find((c) => c.instanceId === id) ??
      after.cardInstances.find((c) => c.instanceId === id);
    return card
      ? (getDefinition(card.definitionId)?.name ?? "非公開カード")
      : "カード";
  };
  const focus = (id: string): ReplayFocus | undefined => {
    const card =
      before.cardInstances.find((c) => c.instanceId === id) ??
      after.cardInstances.find((c) => c.instanceId === id);
    return card
      ? {
          cardId: id,
          playerId: card.controllerPlayerId,
          zone: card.zone,
          label: name(id),
        }
      : undefined;
  };
  const battleMove = after.battleEntities.find(
    (entity) =>
      entity.attackState !== "idle" &&
      before.battleEntities.find((old) => old.entityId === entity.entityId)
        ?.attackState !== entity.attackState
  );
  const sourceId =
    legal && "sourceInstanceId" in legal
      ? legal.sourceInstanceId
      : (before.cardInstances
          .filter((c) => frame.actionId?.includes(c.instanceId))
          .sort((a, b) => b.instanceId.length - a.instanceId.length)[0]
          ?.instanceId ?? battleMove?.memberInstanceIds[0]);
  const selections: ReplayFocus[] = [];
  const outcomes: string[] = [];
  const prior = new Map(before.cardInstances.map((c) => [c.instanceId, c]));
  for (const card of after.cardInstances) {
    const old = prior.get(card.instanceId);
    if (!old) continue;
    const changes: string[] = [];
    if (old.zone !== card.zone)
      changes.push(
        `${zoneDisplayLabel(old.zone)} → ${zoneDisplayLabel(card.zone)}`
      );
    if (old.exhaustState !== card.exhaustState)
      changes.push(card.exhaustState === "recovered" ? "回復" : "疲労");
    if (old.normalCoreCount !== card.normalCoreCount)
      changes.push(`コア ${old.normalCoreCount} → ${card.normalCoreCount}`);
    if (old.definitionId !== card.definitionId) changes.push("裏返す");
    if (changes.length) {
      selections.push({
        ...focus(card.instanceId)!,
        label: `${name(card.instanceId)}：${changes.join("・")}`,
      });
      outcomes.push(`${name(card.instanceId)}：${changes.join("・")}`);
    }
  }
  for (const player of before.players) {
    const next = after.players.find((p) => p.id === player.id);
    if (!next) continue;
    // Field names provide the existing model's pool names; labels use the shared UI formatter.
    for (const key of Object.keys(player)) {
      if (!key.endsWith("NormalCoreCount")) continue;
      const from = player[key as keyof typeof player];
      const to = next[key as keyof typeof next];
      if (typeof from !== "number" || typeof to !== "number" || from === to)
        continue;
      const zone = key.slice(0, -"NormalCoreCount".length);
      const description = `${zoneDisplayLabel(zone)}のコア ${from} → ${to}`;
      selections.push({ playerId: player.id, zone, label: description });
      outcomes.push(`${player.id}：${description}`);
    }
  }
  const explicitTarget =
    legal &&
    "targetInstanceId" in legal &&
    typeof legal.targetInstanceId === "string"
      ? focus(legal.targetInstanceId)
      : undefined;
  if (
    explicitTarget &&
    !selections.some((s) => s.cardId === explicitTarget.cardId)
  )
    selections.unshift(explicitTarget);
  // Training traces already encode individual target decisions in choiceId.
  // Resolve those indices against the runtime action candidates without importing training code.
  const targetChoice = frame.choiceId?.match(
    /:training-target:(\d+):(select|skip)$/
  );
  if (targetChoice && legal && "candidateTargetInstanceIds" in legal) {
    const candidates = legal.candidateTargetInstanceIds;
    const id = Array.isArray(candidates)
      ? candidates[Number(targetChoice[1])]
      : undefined;
    const selected = typeof id === "string" ? focus(id) : undefined;
    if (selected) {
      selections.unshift({
        ...selected,
        label: `${selected.label}：${targetChoice[2] === "select" ? "選択" : "選ばない"}`,
      });
      outcomes.unshift(
        `${selected.label}を${targetChoice[2] === "select" ? "選ぶ" : "選ばない"}`
      );
    }
  }
  if (before.step !== after.step)
    outcomes.push(`${stepDisplayLabel(after.step)}へ`);
  if (after.gameResult) outcomes.push("対戦終了");
  const source = sourceId
    ? focus(sourceId)
    : selections.find((s) => s.playerId === actor && s.cardId);
  if (!kind && !legal) {
    const moved = after.cardInstances.find((card) => {
      const old = prior.get(card.instanceId);
      return old?.zone === "hand" && old.zone !== card.zone;
    });
    action = battleMove
      ? battleMove.attackState === "blocking"
        ? ACTION_LABELS.block
        : ACTION_LABELS.attack
      : moved?.zone === "field"
        ? getDefinition(moved.definitionId)?.printedCategory === "nexus"
          ? ACTION_LABELS.place_nexus
          : ACTION_LABELS.summon
        : moved?.zone === "in_use"
          ? ACTION_LABELS.use_magic
          : before.step !== after.step
            ? "次のステップへ"
            : selections.some((selection) => selection.label.includes("コア"))
              ? "コアを移動・配置"
              : "進行を確定";
  }
  return {
    actor,
    preGameInputs,
    ...(legal
      ? {
          legalAction: legal,
          controlTestId: `${frame.choiceId?.endsWith(":skip") ? "action-skip" : "action"}-${legal.actionId}`,
        }
      : {}),
    action,
    ...(source ? { source } : {}),
    selections,
    result:
      outcomes.join(" / ") ||
      (frame.choiceId?.endsWith(":skip") ? "選択を見送る" : "選択を確定"),
  };
}
