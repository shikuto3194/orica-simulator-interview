import type { LegalAction } from "@orica/rules-core";
import { attackCostGroupKey } from "./action-ui";

export function ImmediateAttackJoinPrompt({
  actions,
  cardName,
  onAction,
  hidden,
}: {
  actions: LegalAction[];
  cardName: (instanceId: string) => string;
  onAction: (action: LegalAction) => void;
  hidden: boolean;
}) {
  const seen = new Set<string>();
  const choices = actions
    .filter((action) => action.kind === "join_active_attack")
    .flatMap((join) => {
      const key = attackCostGroupKey(join);
      if (seen.has(key)) return [];
      const decline = actions.find(
        (action) =>
          action.kind === "decline_immediate_attack_join" &&
          action.sourceInstanceId === join.sourceInstanceId &&
          action.attackId === join.attackId
      );
      if (!decline) return [];
      seen.add(key);
      // 同じ個体のコスト分岐は既存handleActionの選択UIに委ねる。
      return [{ key, join, decline }];
    });
  if (choices.length === 0) return null;
  return (
    <div
      className={`effect-choice-overlay${hidden ? " modal-hidden" : ""}`}
      aria-hidden={hidden || undefined}
    >
      <div
        className="effect-choice-modal"
        role="dialog"
        aria-label="召喚後のアタック選択"
        data-testid="immediate-attack-join-prompt"
        style={{ maxHeight: "90dvh", overflowY: "auto", padding: 16 }}
      >
        {choices.map(({ key, join, decline }) => (
          <section
            key={key}
            role="group"
            aria-label={cardName(join.sourceInstanceId)}
            data-testid={`immediate-attack-join-${join.sourceInstanceId}`}
            style={{ display: "grid", gap: 12 }}
          >
            <div
              className="effect-queue-card active"
              style={{ position: "relative", width: 280 }}
            >
              <div className="effect-queue-text">
                <div className="effect-queue-timing">召喚後のアタック</div>
                <div className="effect-queue-description">
                  {cardName(join.sourceInstanceId)}でアタックしますか？
                </div>
              </div>
            </div>
            <div className="effect-choice-buttons">
              <button
                className="effect-choice-btn"
                onClick={() => onAction(join)}
              >
                アタックする
              </button>
              <button
                className="effect-choice-btn effect-choice-skip"
                onClick={() => onAction(decline)}
              >
                アタックしない
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
