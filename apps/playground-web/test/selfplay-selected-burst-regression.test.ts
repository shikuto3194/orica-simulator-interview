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
