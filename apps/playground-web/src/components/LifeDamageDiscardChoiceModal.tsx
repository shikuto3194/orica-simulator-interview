/**
 * LifeDamageDiscardChoiceModal — discardCostGate / useCostGate / declareGimmickGate の
 * pay/decline UI。
 *
 * - discardCostGate 例: BSTH02.7-C05[1]「手札/手元にあるこのカードは、相手の効果で自分の
 *   ライフが減るとき、破棄することで自分のライフは減らない」。破棄対象はソースカード自身
 *   固定（候補選択は無い）。支払う（破棄してダメージ0）か、支払わない（ダメージ
 *   pendingAmount をそのまま受ける）かを選ぶ。
 * - useCostGate 例: BSLH01-M05[1]「手札にあるこのカードは、アタックステップ中、相手の
 *   効果で自分のライフが減るとき、コストを支払わずに使用することで自分のライフは
 *   減らない」。discardCostGate と同じ全額防止だが、対象カードは「破棄」ではなく
 *   「使用」される（最終的にトラッシュへ置かれる点は同じ）。
 * - declareGimmickGate 例: BSLH01-C12「ライフが減るとき、ターンに1回、宣言することで、
 *   減るコアの数を-1する」。支払いはカード破棄ではなく宣言（declarationCountThisTurn+1）で、
 *   ダメージは0にはならず reduceBy 分だけ軽減される。
 */
import type {
  CardDefinition,
  PendingLifeDamageDiscardChoice,
} from "@orica/rules-core";

interface LifeDamageDiscardChoiceModalProps {
  pending: PendingLifeDamageDiscardChoice;
  getDefinition: (definitionId: string) => CardDefinition | undefined;
  onPay: () => void;
  onDecline: () => void;
  /** 一時非表示中フラグ。true の間はモーダルを隠す。 */
  hidden?: boolean | undefined;
}

export function LifeDamageDiscardChoiceModal({
  pending,
  getDefinition,
  onPay,
  onDecline,
  hidden,
}: LifeDamageDiscardChoiceModalProps) {
  const entry = pending.entries[0];
  if (!entry) return null;

  const sourceDef = getDefinition(entry.sourceDefinitionId);
  const sourceName = sourceDef?.name ?? entry.sourceDefinitionId;
  const isDeclareGimmick = entry.costKind === "declare_gimmick";
  const isUse = entry.costKind === "use";
  const description = isDeclareGimmick
    ? `「エンジョ〜イ、みっしぃ！」と宣言すると、このライフダメージ (${pending.pendingAmount}) を ${entry.reduceBy} 軽減できます。宣言するか、何もせず受けるかを選んでください。`
    : isUse
      ? `${sourceName} をコストを支払わずに使用すると、このライフダメージ (${pending.pendingAmount}) を防げます。使用するか、何もせず受けるかを選んでください。`
      : `${sourceName} を破棄すると、このライフダメージ (${pending.pendingAmount}) を防げます。破棄するか、何もせず受けるかを選んでください。`;
  const payLabel = isDeclareGimmick
    ? "宣言して軽減"
    : isUse
      ? `${sourceName} を使用して防ぐ`
      : `${sourceName} を破棄して防ぐ`;

  return (
    <div
      className={`ldc-overlay${hidden ? " modal-hidden" : ""}`}
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
          ライフダメージ {pending.pendingAmount}
        </h3>
        <p style={{ color: "#aaa", fontSize: 14, margin: "0 0 16px" }}>
          {description}
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
            何もしない
          </button>
          <button
            className="ui-primary"
            onClick={onPay}
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
            {payLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
