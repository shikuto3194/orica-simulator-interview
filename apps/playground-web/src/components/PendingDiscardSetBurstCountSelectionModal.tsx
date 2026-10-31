/**
 * PendingDiscardSetBurstCountSelectionModal — discard_set_burst の count が
 * {min,max}（「バーストN個まで」型）のときの破棄枚数選択 UI
 * (ENGINE-composite-heterogeneous-removal-budget)。例: BSTH09-X01。
 * バースト（裏向きセット中カード）は Q4185 非識別のためカード単体は選べず、
 * 枚数のみを選ぶ。PendingCountSelectionModal と同型 (min/max ステッパー)。
 */
import { useState, useCallback } from "react";
import type { PendingDiscardSetBurstCountSelection } from "@orica/rules-core";

interface PendingDiscardSetBurstCountSelectionModalProps {
  pending: PendingDiscardSetBurstCountSelection;
  onConfirm: (count: number) => void;
  /** 一時非表示中フラグ。true の間はモーダルを隠して内部 state を保持 */
  hidden?: boolean | undefined;
}

export function PendingDiscardSetBurstCountSelectionModal({
  pending,
  onConfirm,
  hidden,
}: PendingDiscardSetBurstCountSelectionModalProps) {
  // 初期値は max（そのまま破棄する既定。プレイヤーは破棄枚数を絞れる）
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
          破棄するバースト枚数を選択
        </h3>
        <p style={{ color: "#aaa", fontSize: 14, margin: "0 0 20px" }}>
          {pending.targetPlayerId === pending.actingPlayerId ? "自分" : "相手"}
          のセット中バーストを何枚破棄するか選んでください （{pending.min}〜
          {pending.max}枚）
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
