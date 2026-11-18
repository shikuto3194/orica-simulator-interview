import type {
  CardDefinition,
  GameState,
  previewBurstEffectSuppression,
} from "@orica/rules-core";
import { getEffectSourceDisplay } from "../utils/effect-source-display";
import { extractEffectChoiceTextByEffectIndex } from "../utils/field-effect-choice";

/** StepChoiceと同じカード本文・選択ボタン・盤面確認のUX。ゲーム状態は保持しない。 */
export function BurstActivationConfirmation({
  state,
  warning,
  burstName,
  getDefinition,
  hidden,
  onPeek,
  onConfirm,
  onBack,
}: {
  state: GameState;
  warning: NonNullable<ReturnType<typeof previewBurstEffectSuppression>>;
  burstName: string;
  getDefinition: (id: string) => CardDefinition | undefined;
  hidden: boolean;
  onPeek: () => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const sources = warning.sources.filter(
    (source, index, all) =>
      all.findIndex(
        (other) =>
          other.sourceInstanceId === source.sourceInstanceId &&
          other.sourceDefinitionId === source.sourceDefinitionId &&
          other.provenance?.effectSourceDefinitionId ===
            source.provenance?.effectSourceDefinitionId &&
          other.provenance?.effectIndex === source.provenance?.effectIndex
      ) === index
  );
  return (
    <div
      className={`effect-choice-overlay${hidden ? " modal-hidden" : ""}`}
      aria-hidden={hidden ? "true" : undefined}
      onClick={onPeek}
    >
      <div
        className="effect-choice-modal burst-activation-confirmation"
        role="dialog"
        aria-modal="true"
        aria-label="バースト発動の最終確認"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onBack();
        }}
      >
        <div className="burst-activation-confirmation-question">
          <strong>現在、バースト効果を抑止する効果が発揮中です。</strong>
          <div>それでも「{burstName}」のバーストを発動しますか？</div>
          <small>効果を発揮できるかは、解決時の状態で判定されます。</small>
        </div>
        <div className="burst-activation-confirmation-sources">
          {sources.map((source) => {
            const display = getEffectSourceDisplay(
              state,
              {
                ...source,
                effectSourceInstanceId:
                  source.provenance?.effectSourceInstanceId,
                effectSourceDefinitionId:
                  source.provenance?.effectSourceDefinitionId,
              },
              getDefinition
            );
            const effectText =
              extractEffectChoiceTextByEffectIndex(
                display.definition,
                source.provenance?.effectIndex
              ) ??
              (source.metadata?.burstSuppressKind === "cannot_activate"
                ? "相手のバースト効果を発揮できない。"
                : "相手のバースト効果を無効にする。");
            return (
              <div
                className="effect-queue-card active"
                key={source.effectId}
                style={{ position: "relative" }}
              >
                <div className="effect-queue-card-image">
                  <img
                    src={display.imagePath ?? "/images/ForGUI/card-back.jpg"}
                    alt={display.cardName}
                  />
                  <span
                    className="effect-queue-badge"
                    style={{ backgroundColor: "#b7791f" }}
                  >
                    発揮中
                  </span>
                </div>
                <div className="effect-queue-text">
                  <div className="effect-queue-timing">
                    {display.cardName}の効果
                  </div>
                  <div className="effect-queue-description">{effectText}</div>
                </div>
              </div>
            );
          })}
          {warning.eventSuppressed && (
            <div className="burst-activation-confirmation-question">
              この発動条件を発生させた効果により、バースト効果が抑止されています。
            </div>
          )}
        </div>
        <div className="effect-choice-buttons">
          <button
            type="button"
            className="effect-choice-btn"
            onClick={onConfirm}
          >
            発動する
          </button>
          <button
            type="button"
            className="effect-choice-btn effect-choice-skip"
            onClick={onBack}
            autoFocus
          >
            戻る
          </button>
        </div>
      </div>
    </div>
  );
}
