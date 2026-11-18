import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

/** 一覧とそこから開く詳細のキーボード操作を、背面の盤面へ流さない。 */
export function handleEffectDialogKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onClose: () => void
) {
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
  }
  if (event.key !== "Tab") return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]'
    )
  ).filter((control) => control.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

/** 効果カードのクリック／長押し／右クリック操作は呼び出し元と共通。 */
export function EffectQueueListDialog({
  children,
  count,
  covered,
  onClose,
}: {
  children: ReactNode;
  count: number;
  covered: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="effect-queue-list-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="effect-queue-list-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="効果一覧"
        inert={covered}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => handleEffectDialogKeyDown(event, onClose)}
      >
        <header>
          <strong>効果一覧（{count}件）</strong>
          <button type="button" onClick={onClose} aria-label="効果一覧を閉じる">
            ×
          </button>
        </header>
        <div className="effect-queue-list-grid">{children}</div>
        <p>クリックで前面に表示 · 右クリック／長押しで詳細</p>
      </div>
    </div>
  );
}
