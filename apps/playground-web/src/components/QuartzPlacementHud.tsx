import type { CardDefinition, GameState } from "@orica/rules-core";
import type { ReactNode } from "react";
import "./quartz-placement-hud.css";

/** 宣言前にセット位置を選ぶ。候補はエンジンのlegal actionをそのまま使う。 */
export function QuartzPlacementHud<
  T extends {
    actionId: string;
    hostInstanceId: string;
    slot: "left" | "center" | "right";
    replacedQuartzInstanceId?: string;
  },
>({
  state,
  actions,
  getDefinition,
  onSelect,
  onCancel,
  children,
  hidden,
  onPeek,
}: {
  state: GameState;
  actions: T[];
  getDefinition: (id: string) => CardDefinition | undefined;
  onSelect: (action: T) => void;
  onCancel?: () => void;
  children?: ReactNode;
  hidden?: boolean;
  onPeek?: () => void;
}) {
  const hosts = [...new Set(actions.map((a) => a.hostInstanceId))];
  return (
    <div
      className={`quartz-placement-overlay${hidden ? " modal-hidden" : ""}`}
      aria-hidden={hidden ? "true" : undefined}
    >
      <section
        className="quartz-placement-hud"
        role="dialog"
        aria-modal="true"
        aria-label="クォーツのセット位置"
        data-testid="quartz-placement-hud"
      >
        <strong>セットするスロットを選択</strong>
        {children}
        <span>セット中のクォーツを選ぶと入れ替えます。</span>
        {hosts.map((hostId) => {
          const host = state.cardInstances.find((c) => c.instanceId === hostId);
          const def = host && getDefinition(host.definitionId);
          return (
            <div key={hostId}>
              {hosts.length > 1 && <div>{def?.name}</div>}
              <div className="quartz-slot-columns">
                {(["left", "center", "right"] as const).map((slot) => {
                  const label = { left: "左", center: "中央", right: "右" }[
                    slot
                  ];
                  const set = state.quartzSetStates.filter(
                    (q) => q.hostInstanceId === hostId && q.slot === slot
                  );
                  return (
                    <div key={slot} className="quartz-slot-column">
                      <strong>{label}</strong>
                      {Array.from(
                        { length: def?.quartzHostData?.slots[slot] ?? 0 },
                        (_, index) => {
                          const old = set[index];
                          const action = actions.find(
                            (a) =>
                              a.hostInstanceId === hostId &&
                              a.slot === slot &&
                              a.replacedQuartzInstanceId ===
                                old?.quartzInstanceId
                          );
                          const oldCard =
                            old &&
                            state.cardInstances.find(
                              (c) => c.instanceId === old.quartzInstanceId
                            );
                          const name =
                            oldCard &&
                            getDefinition(oldCard.definitionId)?.quartzData
                              ?.quartzName;
                          // 空き位置の並びは同値なので、次の空き1枠だけを操作可能にする。
                          const enabled =
                            !!action && (!!old || index === set.length);
                          return (
                            <button
                              key={index}
                              type="button"
                              disabled={!enabled}
                              aria-label={`${label}${index + 1}：${name ? `${name}と入れ替え` : "空き"}`}
                              onClick={() => action && onSelect(action)}
                            >
                              <span>
                                {label}
                                {index + 1}
                              </span>
                              <span>{name ?? "空き"}</span>
                            </button>
                          );
                        }
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {onCancel && (
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
        )}
        {onPeek && (
          <button type="button" onClick={onPeek}>
            盤面確認
          </button>
        )}
      </section>
    </div>
  );
}
