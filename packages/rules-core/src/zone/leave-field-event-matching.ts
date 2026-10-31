/**
 * leave-field-event-matching.ts — `card_event` 宣言イベント文字列と pre-flush 発火イベント種別の
 * 一致判定 SSOT。
 *
 * `event:"leave_field"` 宣言は「フィールドを離れるとき」の umbrella term として、pendingLeave
 * 生成時（pre-flush）に emit される具体イベント種別
 * (destroy / vanish / bounce / remove_from_game) にも一致する
 * (ENGINE-leave-field-trigger-during-pending, 2026-06-25)。CardEventType に "bounce" が
 * 未収録のため直接宣言はできないが、leave_field 展開で自動的にカバーされる。
 *
 * trigger-system.ts（登録済みカード効果の card_event 照合）と grant-effect-system.ts
 * （grant_effect 付与効果の card_event 照合）の双方がこのヘルパを使う
 * （[[project_mechanic_triggered_unification]] と同じ思想: 同じ判別を2箇所に持たない）。
 */
export function matchesDeclaredCardEventKind(
  declaredEvents: readonly string[],
  eventKind: string
): boolean {
  if (declaredEvents.includes(eventKind)) return true;
  return (
    declaredEvents.includes("leave_field") &&
    (eventKind === "destroy" ||
      eventKind === "vanish" ||
      eventKind === "bounce" ||
      eventKind === "remove_from_game")
  );
}
