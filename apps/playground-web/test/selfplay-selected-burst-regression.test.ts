import { expect, it } from "vitest";
import { buildEngine, mulberry32, playGameAsync } from "./selfplay-driver";

it("finishes seed 1558798883 after a selected burst and reverse-rebirth reactions", async () => {
  const result = await playGameAsync({
    engine: buildEngine(),
    rng: mulberry32(1_558_798_883),
    maxSteps: 4000,
  });
  expect(result.outcome, result.lastError).toBe("natural");
  expect(result.winner).not.toBeNull();
}, 60_000);

it("finishes seed 3391842970 with a queued sibling burst and a negate response", async () => {
  const result = await playGameAsync({
    engine: buildEngine(),
    rng: mulberry32(3_391_842_970),
    maxSteps: 4000,
  });
  expect(result.outcome, result.lastError).toBe("natural");
  expect(result.winner).not.toBeNull();
}, 60_000);

// 召喚時効果の唯一の対象(2 group とも同一候補)を、対象開示への応答で破壊された局面。
// 再開が離れた対象だけ取り除いて必須数を下げず、割当失敗の例外で pending が残り続けた。
it("finishes seed 2416629681 when the only target leaves during a targeted disclosure response", async () => {
  const result = await playGameAsync({
    engine: buildEngine(),
    rng: mulberry32(2_416_629_681),
    maxSteps: 4000,
  });
  expect(result.outcome, result.lastError).toBe("natural");
  expect(result.winner).not.toBeNull();
}, 60_000);
