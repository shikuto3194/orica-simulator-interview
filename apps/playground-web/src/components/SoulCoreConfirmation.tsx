import { TargetFooterActions, TargetToast } from "./TargetSelectionController";

export interface SoulCoreConfirmationProps {
  message: string;
  onYes: () => void;
  onNo: () => void;
  onReset?: (() => void) | undefined;
}

/** コアを選ぶ場面の通常/ソウル確認。支払い・効果の選択で同じ操作を使う。 */
export function SoulCoreConfirmation({
  message,
  onYes,
  onNo,
  onReset,
}: SoulCoreConfirmationProps) {
  return (
    <>
      <TargetToast title="ソウルコア確認" subText={message} />
      <TargetFooterActions
        actions={[
          { label: "はい", variant: "ok", onClick: onYes },
          { label: "いいえ(通常コア)", variant: "warn", onClick: onNo },
          ...(onReset
            ? [
                {
                  label: "リセット",
                  variant: "warn" as const,
                  onClick: onReset,
                },
              ]
            : []),
        ]}
      />
    </>
  );
}
