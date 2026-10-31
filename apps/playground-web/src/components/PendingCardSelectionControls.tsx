import type { usePendingCardSelection } from "../hooks/usePendingCardSelection";
import {
  TargetToast,
  TargetFooterActions,
  type TargetActionButton,
} from "./TargetSelectionController";

export function PendingCardSelectionControls({
  selection,
  onBrowse,
  onConfirm,
  onDecline,
}: {
  selection: ReturnType<typeof usePendingCardSelection>;
  onBrowse: () => void;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const { choice } = selection;
  if (!choice) return null;
  const actions: TargetActionButton[] = [];
  if (choice.tokenMax !== undefined) {
    actions.push(
      {
        label: "トークン −",
        variant: "warn",
        disabled: selection.tokenCount === 0,
        onClick: () => selection.changeTokenCount(-1),
      },
      {
        label: "トークン +",
        variant: "warn",
        disabled:
          selection.tokenCount >= choice.tokenMax ||
          selection.total >= choice.max,
        onClick: () => selection.changeTokenCount(1),
      }
    );
  }
  if (selection.zoneIds.length > 0)
    actions.push({ label: "ゾーン候補", variant: "warn", onClick: onBrowse });
  actions.push({
    label: "リセット",
    variant: "warn",
    disabled: selection.total === 0,
    onClick: selection.reset,
  });
  if (choice.declinePayload || choice.declineAction)
    actions.push({
      label: choice.declineLabel ?? "支払わない",
      variant: "cancel",
      onClick: onDecline,
    });
  if (choice.canCancel)
    actions.push({
      label: "キャンセル",
      variant: "cancel",
      onClick: onDecline,
    });
  actions.push({
    label: choice.confirmLabel(selection.selectedIds.length),
    variant: "ok",
    disabled: !selection.canConfirm,
    onClick: onConfirm,
  });
  return (
    <>
      <TargetToast
        title={choice.title}
        progress={{
          current: selection.total,
          required: choice.min,
          max: choice.max,
        }}
        subText={
          <>
            {choice.description}
            {selection.nextLabel && ` ${selection.nextLabel}`}
            {choice.tokenMax !== undefined &&
              ` トークン: ${selection.tokenCount}体 / カード: ${selection.selectedIds.length}枚`}
          </>
        }
      />
      <TargetFooterActions actions={actions} />
    </>
  );
}
