import type { LegalAction } from "@orica/rules-core";

/**
 * 「ブロックしない」「ブロック完了」(decline_block) を ActionBar に出すか。
 * ブロック可能な間 (block 候補がある間) だけ、かつ別の pending 操作中でないときに出す。
 * 効果キューの前面・折りたたみには依らない。
 */
export function selectBlockDeclineActions(input: {
  actions: readonly LegalAction[];
  hasPendingAction: boolean;
}): LegalAction[] {
  if (input.hasPendingAction) return [];
  if (!input.actions.some((action) => action.kind === "block")) return [];
  return input.actions.filter((action) => action.kind === "decline_block");
}

/**
 * 複数ブロック中 (1体以上ブロック宣言済み) の decline_block は
 * 「残りはブロックしない」完了宣言なのでラベルを変える。既定のままなら undefined。
 */
export function blockDeclineLabelOverride(
  action: LegalAction,
  blockAssignments: readonly { blockedByEntityIds: readonly unknown[] }[]
): string | undefined {
  if (action.kind !== "decline_block") return undefined;
  return blockAssignments.some(
    (assignment) => assignment.blockedByEntityIds.length > 0
  )
    ? "ブロック完了"
    : undefined;
}
