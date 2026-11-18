import { useState, type ReactNode } from "react";
import {
  assertUniqueActionButtonLabels,
  distinguishActionButtonChoices,
  groupActionButtonChoices,
  type ActionButtonChoice,
} from "../utils/action-button-choices";

/** 行動入口→本文による分岐選択。分岐選択だけではゲームに宣言を送らない。 */
export function ActionButtonChoices<T extends ActionButtonChoice>({
  choices,
  renderButton,
}: {
  choices: readonly T[];
  renderButton?: (choice: T) => ReactNode;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const groups = groupActionButtonChoices(choices);
  const selected = groups.find((group) => group[0]!.key === selectedKey);
  const buttons =
    selected && selected.length > 1
      ? distinguishActionButtonChoices(selected)
      : groups.map((group) => ({
          ...group[0]!,
          disabled: group.every((choice) => choice.disabled),
          onClick:
            group.length > 1
              ? () => setSelectedKey(group[0]!.key)
              : group[0]!.onClick,
        }));
  assertUniqueActionButtonLabels(buttons);
  return (
    <>
      {buttons.map((choice) =>
        renderButton ? (
          renderButton(choice)
        ) : (
          <button
            key={choice.key}
            type="button"
            className={
              choice.className ??
              (selected
                ? "card-action-btn card-action-effect-option"
                : "card-action-btn")
            }
            data-testid={choice.testId}
            data-action-key={choice.key}
            data-action-source={choice.sourceId}
            disabled={choice.disabled ?? false}
            onClick={() => {
              choice.onClick();
              if (selected) setSelectedKey(null);
            }}
          >
            {choice.label}
          </button>
        )
      )}
      {selected && (
        <button
          type="button"
          className="card-action-btn"
          onClick={() => setSelectedKey(null)}
        >
          選択を戻す
        </button>
      )}
    </>
  );
}
