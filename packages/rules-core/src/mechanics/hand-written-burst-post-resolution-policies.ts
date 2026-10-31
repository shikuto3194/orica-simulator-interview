import type { HandWrittenBurstPostResolutionPolicy } from "./burst-system";

const HAND_WRITTEN_BURST_POST_RESOLUTION_POLICIES = {
  "DEMO-BURST-STAY-001": {
    kind: "stay_in_burst",
  },
} as const satisfies Record<string, HandWrittenBurstPostResolutionPolicy>;

export function getHandWrittenBurstPostResolutionPolicy(cardNo: string) {
  return HAND_WRITTEN_BURST_POST_RESOLUTION_POLICIES[
    cardNo as keyof typeof HAND_WRITTEN_BURST_POST_RESOLUTION_POLICIES
  ];
}
