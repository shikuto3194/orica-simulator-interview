import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const effect = (textRef: number[]) => ({
  timing: { kind: "card_event", event: "attack" },
  steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
  textRef,
});
const front = () => ({
  cardNo: "TEST01-TX01(A)",
  textLines: ["Lv1『このスピリットのアタック時』", "自分は1枚ドローする。"],
  effects: [effect([0, 1])],
});
const back = () => ({
  cardNo: "TEST01-TX01(B)",
  textLines: ["Lv1『このスピリットのアタック時』", "自分は1枚ドローする。"],
});
function audit(
  kind: "coverage" | "fidelity",
  cards: unknown[],
  args = ["--json", "--gate"]
) {
  const prefix =
    kind === "coverage" ? "ORICA_CARDS_COVERAGE" : "ORICA_CARDS_FIDELITY_AUDIT";
  const run = spawnSync(
    process.execPath,
    [
      kind === "coverage"
        ? "scripts/cards-coverage.mjs"
        : "scripts/cards-fidelity-audit.mjs",
      ...args,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        [prefix + "_FIXTURE_JSON"]: JSON.stringify(cards),
        [prefix + "_NO_WRITE"]: "1",
      },
    }
  );
  expect(run.error).toBeUndefined();
  expect(run.status, run.stderr).not.toBe(2);
  return {
    code: run.status,
    output: run.stdout,
    report: args.includes("--json") ? JSON.parse(run.stdout) : undefined,
  };
}

describe("表裏カードのcoverage/fidelity CLI", () => {
  it("A面が実装済みでもB面の効果ゼロをtodoにしてフルラン用JSONへ出す", () => {
    const { code, report } = audit("coverage", [
      { ...front(), backFace: back() },
    ]);
    expect(code).toBe(1);
    expect(report.totals).toMatchObject({ total: 2, done: 1, todo: 1 });
    expect(report.todoCards).toEqual(["TEST01-TX01(B)"]);
    expect(report.complete).toBe(false);
  });

  it("弾別表示でもB面のtodoがあればgateを失敗させる", () => {
    const { code, output } = audit(
      "coverage",
      [{ ...front(), backFace: back() }],
      ["--set", "TEST01", "--gate"]
    );
    expect(code).toBe(1);
    expect(output).toContain("TEST01-TX01(B)");
  });

  it("転醒の共通説明だけのB面を未実装として数えない", () => {
    const { code, report } = audit("coverage", [
      {
        ...front(),
        backFace: {
          cardNo: "TEST01-TX01(B)",
          textLines: [
            "この面に裏返ったとき、フィールドに残り、カウント+1する。",
          ],
        },
      },
    ]);
    expect(code).toBe(0);
    expect(report.totals).toMatchObject({
      total: 2,
      done: 1,
      vanilla: 1,
      todo: 0,
    });
  });

  it("B面のnested effectsもcoverageと本文対応に含める", () => {
    const cards = [
      {
        ...front(),
        backFace: { ...back(), quartzData: { effects: [effect([0, 1])] } },
      },
    ];
    const coverage = audit("coverage", cards);
    expect(coverage.code).toBe(0);
    expect(coverage.report.totals.done).toBe(2);
    expect(audit("fidelity", cards).report.violations).toEqual([]);
  });

  it("B面の部分欠落をuncovered_lineとして検出する", () => {
    const { code, report } = audit("fidelity", [
      {
        ...front(),
        backFace: {
          ...back(),
          textLines: [
            ...back().textLines,
            "",
            "Lv2『相手のアタックステップ開始時』",
            "自分は1枚ドローする。",
          ],
          effects: [effect([0, 1])],
        },
      },
    ]);
    expect(code).toBe(1);
    expect(report.violations).toEqual([
      expect.objectContaining({
        cardNo: "TEST01-TX01(B)",
        kind: "uncovered_line",
        detail: expect.stringContaining("textLines[3]"),
      }),
    ]);
  });

  it("A面のtextRefでは同じindexのB面本文をカバーしない", () => {
    const { report } = audit("fidelity", [
      {
        ...front(),
        backFace: {
          ...back(),
          effects: [effect([])],
        },
      },
    ]);
    expect(report.violations).toEqual([
      expect.objectContaining({
        cardNo: "TEST01-TX01(B)",
        kind: "no_textref",
      }),
    ]);
  });

  it("B面のtextRef欠落を検出する", () => {
    const { textRef: _textRef, ...unmapped } = effect([0, 1]);
    const { code, report } = audit("fidelity", [
      { ...front(), backFace: { ...back(), effects: [unmapped] } },
    ]);
    expect(code).toBe(1);
    expect(report.violations).toEqual([
      expect.objectContaining({ cardNo: "TEST01-TX01(B)", kind: "no_textref" }),
    ]);
  });

  it("B面のstubを二重計上せず、マーカーのない本文でも拾う", () => {
    const { report } = audit("fidelity", [
      {
        ...front(),
        backFace: {
          ...back(),
          textLines: ["自分は1枚ドローする。"],
          effects: [{ ...effect([0]), steps: [], stub: "test missing effect" }],
        },
      },
    ]);
    expect(report.totals.stub).toBe(1);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].cardNo).toBe("TEST01-TX01(B)");
  });

  it("本文まで対応済みのB面に違反を出さない", () => {
    const { code, report } = audit("fidelity", [
      { ...front(), backFace: { ...back(), effects: [effect([0, 1])] } },
    ]);
    expect(code).toBe(0);
    expect(report.clean).toBe(true);
  });
  it("専用carrierの神技をtextRef不在だけで未実装にしない", () => {
    const { textRef: _textRef, ...skillEffect } = effect([0]);
    const { code, report } = audit("fidelity", [
      {
        cardNo: "TEST01-X01",
        textLines: ["【神技】自分は1枚ドローする。"],
        grandwalkerData: { divineSkills: [{ effects: [skillEffect] }] },
      },
    ]);
    expect(code).toBe(0);
    expect(report.violations).toEqual([]);
  });

  it("A面がバニラでもB面のLv付きタイミング見出しを検査する", () => {
    const { report } = audit("fidelity", [
      {
        cardNo: "TEST01-TX01(A)",
        textLines: [],
        backFace: {
          ...back(),
          textLines: [
            ...back().textLines,
            "",
            "【合体中】『このスピリットのアタック時』",
            "相手のライフを1減らす。",
          ],
          effects: [effect([0, 1])],
        },
      },
    ]);
    expect(report.violations).toEqual([
      expect.objectContaining({
        cardNo: "TEST01-TX01(B)",
        kind: "uncovered_line",
      }),
    ]);
  });
});
