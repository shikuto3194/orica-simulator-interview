/**
 * LifeGainReplacementChoiceModal — life_gain_replacement CE の replace/decline UI。
 *
 * 例: BSTH02.7-X03 effects[3]「自分のアタックステップ中、自分の効果で自分のライフが
 *   増えるとき、増やす代わりに相手のライフのコア1個をトラッシュに置ける」。
 *
 * 置換する（増加をキャンセルし相手のライフのコア1個をトラッシュに置く）か、
 * 置換しない（通常通り増やす）かを選ぶ。
 */
import type {
  CardDefinition,
  PendingLifeGainReplacementChoice,
} from "@orica/rules-core";

interface LifeGainReplacementChoiceModalProps {
  pending: PendingLifeGainReplacementChoice;
  getDefinition: (definitionId: string) => CardDefinition | undefined;
  onReplace: () => void;
  onDecline: () => void;
  /** 一時非表示中フラグ。true の間はモーダルを隠す。 */
  hidden?: boolean | undefined;
}

export function LifeGainReplacementChoiceModal({
  pending,
  getDefinition,
  onReplace,
  onDecline,
  hidden,
}: LifeGainReplacementChoiceModalProps) {
  const sourceDef = getDefinition(pending.sourceDefinitionId);
  const sourceName = sourceDef?.name ?? pending.sourceDefinitionId;

  return (
    <div
      className={`lgr-overlay${hidden ? " modal-hidden" : ""}`}
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
          maxWidth: 460,
          width: "90%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        <h3 style={{ margin: "0 0 12px", color: "#e0e0e0" }}>
          ライフ増加 {pending.amount}
        </h3>
        <p style={{ color: "#aaa", fontSize: 14, margin: "0 0 16px" }}>
          {sourceName}{" "}
          の効果により、増やす代わりに相手のライフのコア1個をトラッシュに
          置けます。置換するか、通常通り増やすかを選んでください。
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button
            onClick={onDecline}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "1px solid #555",
              background: "#333",
              color: "#ccc",
              cursor: "pointer",
              fontSize: 15,
            }}
          >
            通常通り増やす
          </button>
          <button
            className="ui-primary"
            onClick={onReplace}
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
            相手のライフのコアをトラッシュに置く
          </button>
        </div>
      </div>
    </div>
  );
}
