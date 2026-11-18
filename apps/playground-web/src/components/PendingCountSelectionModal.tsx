/**
 * PendingCountSelectionModal — 動的コスト修正等で「カウントを好きなだけ減らせる」型
 * (min〜max) の減少数選択 UI (ENGINE-cost-modify-additional-cost-value-dynamic-amount)。
 * 例: BSGE01-M02「セット中バースト追加発動条件」。コア数HUD と同型 (min/max ステッパー)。
 */
import { useState, useCallback } from "react";
import type { PendingCountSelection } from "@orica/rules-core";

interface PendingCountSelectionModalProps {
  pending: PendingCountSelection;
  onConfirm: (count: number) => void;
  /** 一時非表示中フラグ。true の間はモーダルを隠して内部 state を保持 */
  hidden?: boolean | undefined;
}

export function PendingCountSelectionModal({
  pending,
  onConfirm,
  hidden,
}: PendingCountSelectionModalProps) {
  // 初期値は max（そのまま減らす既定。プレイヤーは減らす数を絞れる）
  const [count, setCount] = useState<number>(() => pending.max);

  const clamp = useCallback(
    (n: number) => Math.max(pending.min, Math.min(pending.max, n)),
    [pending.min, pending.max]
  );

  const handleConfirm = useCallback(() => {
    onConfirm(clamp(count));
  }, [clamp, count, onConfirm]);

  const canDecrement = count > pending.min;
  const canIncrement = count < pending.max;
  const selectionLabel =
    pending.selectionAction?.kind === "draw"
      ? "ドローする枚数"
      : pending.selectionAction?.kind === "move_card"
        ? "移動する枚数"
        : "カウントを減らす数";
  const unit = pending.selectionAction ? "枚" : "個";

  return (
    <div
      className={`ccm-overlay${hidden ? " modal-hidden" : ""}`}
      aria-hidden={hidden ? "true" : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#1a1a2e",
          borderRadius: 12,
          padding: 24,
          maxWidth: 420,
          width: "90%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        <h3 style={{ margin: "0 0 12px", color: "#e0e0e0" }}>
          {selectionLabel}を選択
        </h3>
        <p style={{ color: "#aaa", fontSize: 14, margin: "0 0 20px" }}>
          {selectionLabel}を選んでください （{pending.min}〜{pending.max}
          {unit}）
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <button
            aria-label="減らす"
            onClick={() => setCount((c) => clamp(c - 1))}
            disabled={!canDecrement}
            style={{
              width: 44,
              height: 44,
              borderRadius: 6,
              border: "1px solid #555",
              background: canDecrement ? "#333" : "#1c1c1c",
              color: canDecrement ? "#ccc" : "#555",
              cursor: canDecrement ? "pointer" : "not-allowed",
              fontSize: 24,
            }}
          >
            −
          </button>
          <div
            style={{
              minWidth: 64,
              textAlign: "center",
              color: "#fff",
              fontSize: 36,
              fontWeight: "bold",
            }}
          >
            {count}
          </div>
          <button
            aria-label="増やす"
            onClick={() => setCount((c) => clamp(c + 1))}
            disabled={!canIncrement}
            style={{
              width: 44,
              height: 44,
              borderRadius: 6,
              border: "1px solid #555",
              background: canIncrement ? "#333" : "#1c1c1c",
              color: canIncrement ? "#ccc" : "#555",
              cursor: canIncrement ? "pointer" : "not-allowed",
              fontSize: 24,
            }}
          >
            +
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="ui-primary"
            onClick={handleConfirm}
            style={{
              padding: "8px 24px",
              borderRadius: 6,
              border: "none",
              background: "#4fc3f7",
              color: "#000",
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: 15,
            }}
          >
            決定
          </button>
        </div>
      </div>
    </div>
  );
}
