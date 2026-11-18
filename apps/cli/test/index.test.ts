import { describe, expect, it } from "vitest";

import { createCliReport } from "../src/index";

describe("cli integration", () => {
  it("can consume rules-core and render a startup report", () => {
    const report = createCliReport();

    expect(report).toContain("orica-simulator CLI");
    expect(report).toContain("Turn 1 | active=player-1 | step=start");
    // 先攻1ターン目はコアステップをスキップするため、start の次は draw
    expect(report).toContain("next => Turn 1 | active=player-1 | step=draw");
    expect(report).toContain("DEMO-SPIRIT-001");
    expect(report).toContain("DEMO-MAGIC-001");
    expect(report).toContain("DEMO-BRAVE-001");
  });
});
