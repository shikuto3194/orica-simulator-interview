import type { LegalAction } from "@orica/rules-core";
import { ACTION_UI_ROUTES, getActionLabel } from "./action-ui";
import { ActionButtonChoices } from "./ActionButtonChoices";
import type { ActionButtonChoice } from "../utils/action-button-choices";

type LegalActionKind = LegalAction["kind"];

function optionalEffectActionKey(action: LegalAction): string | null {
  if (action.kind === "resolve_pending_triggered_effect") {
    const pendingId = (action as { pendingId?: string }).pendingId;
    if (!pendingId) return null;
    const sourceInstanceId =
      (action as { sourceEffectInstanceId?: string }).sourceEffectInstanceId ??
      (action as { sourceInstanceId?: string }).sourceInstanceId ??
      "";
    const registrationIndex =
      (action as { registrationIndex?: number }).registrationIndex ?? "";
    return `${action.kind}:${pendingId}:${sourceInstanceId}:${registrationIndex}`;
  }
  if (action.kind === "select_pending_to_resolve") {
    const pendingId = (action as { pendingId?: string }).pendingId;
    if (!pendingId) return null;
    const sourceInstanceId =
      (action as { sourceEffectInstanceId?: string }).sourceEffectInstanceId ??
      (action as { sourceInstanceId?: string }).sourceInstanceId ??
      "";
    const registrationIndex =
      (action as { registrationIndex?: number }).registrationIndex ?? "";
    return `${action.kind}:${pendingId}:${sourceInstanceId}:${registrationIndex}`;
  }
  if (action.kind === "resolve_battle_immediate_effect") {
    const promptId = (action as { promptId?: string }).promptId;
    return promptId ? `${action.kind}:${promptId}` : null;
  }
  return null;
}

function hasEngineSkipOnlyPeer(
  action: LegalAction,
  skipOnlyActionKeys: ReadonlySet<string>
): boolean {
  const key = optionalEffectActionKey(action);
  return key !== null && skipOnlyActionKeys.has(key);
}

interface ActionBarProps {
  actions: LegalAction[];
  onActionClick: (action: LegalAction) => void;
  /** optional 効果のスキップ */
  onSkipOptional?: ((action: LegalAction) => void) | undefined;
}

export function ActionBar({
  actions,
  onActionClick,
  onSkipOptional,
}: ActionBarProps) {
  // 下部バーは pass 系と、キュー前面項目の「発揮する/発揮しない」だけを描画する。
  // 効果内チョイス / コスト支払 / 対象選択は専用 overlay・HUD 側に残す。
  const grouped = new Map<LegalActionKind, LegalAction[]>();
  const seenChoiceGroups = new Set<string>();
  const skipOnlyActionKeys = new Set(
    actions
      .filter((action) => (action as { skipOnly?: boolean }).skipOnly)
      .map(optionalEffectActionKey)
      .filter((key): key is string => key !== null)
  );
  for (const action of actions) {
    // 空の誘発効果フォールバック（sourceInstanceId なし）は表示しない。
    // ただし skipOnly (drain 専用) はソース不在でも辞退ボタンとして表示する。
    if (
      action.kind === "resolve_pending_triggered_effect" &&
      !(action as { skipOnly?: boolean }).skipOnly &&
      !(
        "sourceInstanceId" in action &&
        (action as { sourceInstanceId?: string }).sourceInstanceId
      )
    ) {
      continue;
    }

    const isChoiceAction =
      "choiceIndex" in action &&
      (action as { choiceIndex?: number }).choiceIndex !== undefined;
    // EffectQueue 前面フィルタ後に渡された battle immediate は、その前面カードを
    // 進める決定 action として表示する。target 不要 + mandatory は通常 auto-exec だが、
    // 同時に optional 効果が混ざると auto-exec されないため手動の「解決」が必要。
    const isBattleImmediateDecision =
      action.kind === "resolve_battle_immediate_effect";

    if (
      ACTION_UI_ROUTES[action.kind] !== "action-bar" &&
      !(isChoiceAction && action.kind === "resolve_battle_immediate_effect") &&
      !isBattleImmediateDecision
    ) {
      continue;
    }

    // choice グループの重複を排除: 同一 source の choice は代表1つだけ表示し、
    // 実際の選択肢一覧は BattleScreen の choice モーダルで扱う。
    if (
      isChoiceAction &&
      (action.kind === "resolve_pending_triggered_effect" ||
        action.kind === "resolve_battle_immediate_effect" ||
        action.kind === "resolve_pending_burst_check")
    ) {
      const a = action as {
        pendingId?: string;
        promptId?: string;
        checkId?: string;
        sourceInstanceId?: string;
        sourceEffectInstanceId?: string;
        registrationIndex?: number;
      };
      const sourceInstanceId =
        a.sourceEffectInstanceId ?? a.sourceInstanceId ?? "";
      const groupKey = `${action.kind}:${a.pendingId ?? a.promptId ?? a.checkId ?? ""}:${sourceInstanceId}:${a.registrationIndex ?? ""}`;
      if (seenChoiceGroups.has(groupKey)) continue;
      seenChoiceGroups.add(groupKey);
    }

    const list = grouped.get(action.kind) ?? [];
    list.push(action);
    grouped.set(action.kind, list);
  }

  if (grouped.size === 0) {
    return <div className="action-bar" />;
  }

  const buttons: (ActionButtonChoice & { kind: string; skip: boolean })[] = [];
  for (const [kind, kindActions] of grouped) {
    for (const action of kindActions) {
      // skipOnly はメインボタン自体が辞退として働くため、追加の skip ボタンは出さない。
      const isOptionalSelect =
        kind === "select_pending_to_resolve" &&
        "executionMode" in action &&
        (action as { executionMode?: string }).executionMode === "optional" &&
        (action as { ownerPlayerId?: string }).ownerPlayerId ===
          (action as { actingPlayerId?: string }).actingPlayerId;
      const isOptionalTriggered =
        (isOptionalSelect ||
          kind === "resolve_pending_triggered_effect" ||
          kind === "resolve_battle_immediate_effect") &&
        "executionMode" in action &&
        (action as { executionMode?: string }).executionMode === "optional" &&
        !(action as { skipOnly?: boolean }).skipOnly &&
        !hasEngineSkipOnlyPeer(action, skipOnlyActionKeys);
      const canSkipDuplicate =
        "canSkipDuplicate" in action &&
        action.canSkipDuplicate === true &&
        (action.kind !== "select_pending_to_resolve" ||
          action.ownerPlayerId === action.actingPlayerId);
      const sourceId =
        ("sourceEffectInstanceId" in action && action.sourceEffectInstanceId) ||
        ("sourceInstanceId" in action ? action.sourceInstanceId : "") ||
        "";
      buttons.push({
        key: action.actionId,
        label: getActionLabel(action),
        sourceId,
        kind,
        skip: false,
        testId: `action-${action.actionId}`,
        onClick: () => onActionClick(action),
      });
      if ((isOptionalTriggered || canSkipDuplicate) && onSkipOptional) {
        buttons.push({
          key: `skip-${action.actionId}`,
          sourceId,
          kind,
          skip: true,
          label: canSkipDuplicate ? "スキップ" : "発揮しない",
          testId: `action-skip-${action.actionId}`,
          onClick: () => onSkipOptional(action),
        });
      }
    }
  }

  return (
    <div className="action-bar" data-testid="action-bar">
      <ActionButtonChoices
        choices={buttons}
        renderButton={(button) => (
          <button
            key={button.key}
            className={`action-btn action-${button.skip ? "skip" : button.kind}`}
            data-testid={button.testId}
            data-action-kind={button.kind}
            data-action-source={button.sourceId}
            onClick={button.onClick}
            title={button.label}
          >
            {button.skip ? (
              button.label
            ) : (
              <span className="action-label">{button.label}</span>
            )}
          </button>
        )}
      />
    </div>
  );
}
