import type { ReactNode } from "react";
import { assertUniqueActionButtonLabels } from "../utils/action-button-choices";

/**
 * P2-08 タスク 9-1: 対象選択 UI 刷新（案C）のプレゼンテーショナル基盤。
 *
 * 中央ステージ (`.battle-center`) に並んでいた 7 種の `.target-selection-bar` を
 * - 上部トースト（案内文）
 * - フッター操作（決定 / リセット / キャンセル / はい・いいえ）
 * - カード側共通ハイライト（`.ac-selectable` / `.ac-selected`）
 * の 3 分割に置き換える。移行 (9-4) は 1 モードずつインクリメンタルに行う。
 */

export type TargetActionVariant = "ok" | "warn" | "cancel";

export interface TargetActionButton {
  label: string;
  variant: TargetActionVariant;
  disabled?: boolean;
  onClick: () => void;
}

export interface TargetProgress {
  current: number;
  required: number;
  max?: number;
}

export interface TargetSelectionState {
  title: string;
  subText?: ReactNode;
  progress?: TargetProgress;
  warning?: string;
  actions: TargetActionButton[];
}

interface TargetToastProps {
  title: string;
  subText?: ReactNode | undefined;
  progress?: TargetProgress | undefined;
}

export function TargetToast({
  title,
  subText,
  progress,
}: TargetToastProps): ReactNode {
  return (
    <div className="ac-toast">
      <span>{title}</span>
      {progress ? (
        <span className="ac-toast-progress">{formatProgress(progress)}</span>
      ) : null}
      {subText ? <span className="ac-toast-sub">{subText}</span> : null}
    </div>
  );
}

interface TargetFooterActionsProps {
  actions: TargetActionButton[];
  warning?: string | undefined;
}

export function TargetFooterActions({
  actions,
  warning,
}: TargetFooterActionsProps): ReactNode {
  assertUniqueActionButtonLabels(actions);
  return (
    <div className="ac-footer-actions">
      {warning ? <span className="ac-footer-warning">{warning}</span> : null}
      {actions.map((a, i) => (
        <button
          key={i}
          className={variantClass(a.variant)}
          disabled={a.disabled ?? false}
          onClick={() => a.onClick()}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

function formatProgress(p: TargetProgress): string {
  if (p.max !== undefined && p.max !== p.required) {
    return `${p.current}/${p.required}〜${p.max}`;
  }
  return `${p.current}/${p.required}`;
}

function variantClass(v: TargetActionVariant): string {
  switch (v) {
    case "ok":
      return "ac-footer-ok";
    case "warn":
      return "ac-footer-warn";
    case "cancel":
      return "ac-footer-cancel";
  }
}
