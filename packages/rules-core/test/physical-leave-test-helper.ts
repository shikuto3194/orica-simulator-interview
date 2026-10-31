import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { flushPendingLeaves } from "../src/state-based-actions";

/** 「離れたとき」の盤面テストは、待機入りと実移動を別の境界として収集する。 */
export function collectAfterPhysicalLeave(
  options: Parameters<typeof collectAndQueueTriggerReactions>[0]
) {
  const waiting = collectAndQueueTriggerReactions(options);
  return collectAndQueueTriggerReactions({
    chainId: "test:physical-leave-test-helper.ts:9",
    ...options,
    beforeState: waiting,
    afterState: flushPendingLeaves(waiting, options.getCardDefinitionById),
  });
}
