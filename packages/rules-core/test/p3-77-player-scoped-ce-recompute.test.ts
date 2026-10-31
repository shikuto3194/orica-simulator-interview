/**
 * P3-77 残留懸念3: player-scoped CE (targetInstanceId=playerId) が
 * recomputeContinuousEffects の「対象カードが field 不在なら除去」検査で
 * 誤除去される pre-existing バグの回帰テスト。
 *
 * restrict_flash / restrict_use / restrict_manifest / restrict_end_attack_step /
 * player_effect_immunity は targetInstanceId にカードではなく playerId を格納する。
 * getCardById(playerId)=undefined → zone!==field で即除去されると、
 * 「このターン、相手は〜できない」型の制限が次の recompute 節目で消えてしまう。
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  executeRestrictFlash,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import type { GameState } from "../src";

const noDefs = () => undefined;

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

describe("P3-77 残留懸念3: player-scoped CE は recompute で誤除去されない", () => {
  it("restrict_flash CE は recomputeAndRebuild を跨いで生存する", () => {
    // bob が「相手 (=alice) は、このターン フラッシュを使用できない」を発動。
    const reg = executeRestrictFlash(
      makeState(),
      "bob",
      {
        kind: "restrict_flash",
        player: "opponent",
        source: "any",
        duration: { scope: "turn" },
      },
      "bob-src"
    );
    const before = reg.activeContinuousEffects.filter((c) =>
      c.modifierTag.startsWith("restrict_flash")
    );
    expect(before).toHaveLength(1);
    expect(before[0]!.targetInstanceId).toBe("alice");

    const after = recomputeAndRebuildContinuousEffects(reg, noDefs);
    const survived = after.activeContinuousEffects.filter((c) =>
      c.modifierTag.startsWith("restrict_flash")
    );
    // 修正前は 0 (誤除去)。player-scoped 除外で 1 が維持される。
    expect(survived).toHaveLength(1);
    expect(survived[0]!.targetInstanceId).toBe("alice");
  });
});
