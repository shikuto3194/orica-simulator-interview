/**
 * P3-170 W6: 再分散防止ガードの負例。
 * 「別モジュールから直接加算」「別キー生成」「旧会計フィールド参照」を検出できること、
 * 許可モジュールは誤検出しないことを、合成ソースで検査する。
 * (未正規化能力の負例は catalog manifest 検査: effect-usage-catalog-manifest.test.ts)
 */
import { describe, expect, it } from "vitest";
import {
  findEffectUsageSsotIssues,
  LEGACY_ACCOUNTING_FIELDS,
} from "../../../scripts/effect-usage-ssot.mjs";

type Issue = { file: string; line: number; kind: string; detail: string };
const find = (files: Record<string, string>): Issue[] =>
  findEffectUsageSsotIssues(new Map(Object.entries(files))) as Issue[];

const OTHER = "packages/rules-core/src/effect/some-new-mechanic.ts";

describe("check:ssot P3-170 負例", () => {
  it("別モジュールが effectAccounting を直接書込むと direct-write で落ちる", () => {
    const issues = find({
      [OTHER]: `export function f(state: any) { return { ...state, effectAccounting: state.effectAccounting }; }`,
    });
    expect(issues.map((i) => i.kind)).toEqual(["direct-write"]);
  });

  it("代入形式の直接書込も検出する", () => {
    const issues = find({
      [OTHER]: `export function f(state: any) { state.effectAccounting = null; }`,
    });
    expect(issues.map((i) => i.kind)).toEqual(["direct-write"]);
  });

  it("台帳オブジェクト (buckets+operations) の組み立てを検出する (別モジュールからの直接加算)", () => {
    const issues = find({
      [OTHER]: `export const acc = { version: 1, buckets: [], operations: [], grants: [] };`,
    });
    expect(issues.map((i) => i.kind)).toContain("direct-write");
  });

  it("識別キー生成関数の利用 (別キー生成) を検出する: import と呼び出し", () => {
    const issues = find({
      [OTHER]: `import { makeBucketKey } from "../effect-usage";\nexport const k = (c: any, x: any) => makeBucketKey(c, x);`,
    });
    expect(issues.map((i) => i.kind).sort()).toEqual(["own-key", "own-key"]);
  });

  it("旧会計フィールドの runtime 参照を検出する", () => {
    expect(LEGACY_ACCOUNTING_FIELDS.has("effectUsageRecords")).toBe(true);
    const issues = find({
      [OTHER]: `export const n = (s: any) => s.effectUsageRecords.length;`,
    });
    expect(issues.map((i) => i.kind)).toEqual(["legacy-field"]);
  });

  it("CE 経路ラベルの使用枠が sourceEffect を渡さないと ce-source-effect で落ちる (列挙・記録とも)", () => {
    const missing = find({
      [OTHER]: `export const f = (o: any) => recordEffectUsageIfLimited({ state: o.state, effectLabel: "redirect_effect_target", usageLimit: o.u });
export const g = (o: any) => canUseEffectByUsageLimit({ state: o.state, effectLabel: "expand_effect_target_count", usageLimit: o.u });
export const h = (o: any) => recordEffectUsageIfLimited({ effectLabel: "grant_effect_source_prevention_immunity" });`,
    });
    expect(missing.map((i) => i.kind)).toEqual([
      "ce-source-effect",
      "ce-source-effect",
      "ce-source-effect",
    ]);
    const passed = find({
      [OTHER]: `export const f = (o: any) => recordEffectUsageIfLimited({ state: o.state, sourceEffect: o.e, effectLabel: "redirect_effect_target", usageLimit: o.u });
export const other = (o: any) => recordEffectUsageIfLimited({ state: o.state, effectLabel: "magic", usageLimit: o.u });`,
    });
    expect(passed).toEqual([]);
  });

  it("許可モジュール (台帳・状態アダプタ・factory) は誤検出しない", () => {
    const issues = find({
      "packages/rules-core/src/effect-usage/ledger.ts": `import { makeBucketKey } from "./identity";\nexport const e = { version: 1, buckets: [], operations: [] }; export const k = makeBucketKey;`,
      "packages/rules-core/src/effect/effect-usage-accounting.ts": `export const w = (s: any, a: any) => ({ ...s, effectAccounting: a });`,
      "packages/rules-core/src/factories.ts": `export const s = { effectAccounting: { buckets: [], operations: [] } };`,
    });
    expect(issues).toEqual([]);
  });

  it("フィールド分類表(値が文字列リテラル)は書込みと見なさない", () => {
    const issues = find({
      [OTHER]: `export const POLICY = { effectAccounting: "viewer-private" } as const;`,
    });
    expect(issues).toEqual([]);
  });

  describe("素直な書き方以外の回避形も同じ違反として検出する", () => {
    const kinds = (source: string) =>
      find({ [OTHER]: source }).map((i) => i.kind);

    it("旧フィールドの分割代入・要素アクセス・文字列連結・文字列引数", () => {
      expect(kinds(`const { effectUsageRecords } = s;`)).toContain(
        "legacy-field"
      );
      expect(kinds(`const { effectUsageRecords: r } = s;`)).toContain(
        "legacy-field"
      );
      expect(kinds(`export const n = s["effectUsageRecords"];`)).toContain(
        "legacy-field"
      );
      expect(kinds(`export const n = s["effectUsage" + "Records"];`)).toContain(
        "legacy-field"
      );
      expect(
        kinds(`const k = "effectUsage"; export const n = s[k + "Records"];`)
      ).toContain("legacy-field");
      expect(
        kinds(`export const n = Reflect.get(s, "effectUsageRecords");`)
      ).toContain("legacy-field");
    });

    it("effectAccounting の書込: 計算キー・要素アクセス代入・const経由のキー", () => {
      expect(
        kinds(
          `export const f = (s: any, a: any) => ({ ...s, ["effectAccounting"]: a });`
        )
      ).toContain("direct-write");
      expect(
        kinds(
          `export function f(s: any, a: any) { s["effectAccounting"] = a; }`
        )
      ).toContain("direct-write");
      expect(
        kinds(
          `const k = "effectAccounting"; export const f = (s: any, a: any) => ({ ...s, [k]: a });`
        )
      ).toContain("direct-write");
    });

    it("台帳の配下への代入・破壊的操作・部品の上書き", () => {
      expect(
        kinds(`export function f(s: any) { s.effectAccounting.version = 2; }`)
      ).toContain("direct-write");
      expect(
        kinds(
          `export function f(s: any) { s.effectAccounting.buckets.push({}); }`
        )
      ).toContain("direct-write");
      expect(
        kinds(
          `export const f = (s: any) => ({ ...s.effectAccounting, buckets: [] });`
        )
      ).toContain("direct-write");
    });

    it("識別キー生成関数: 名前空間 import 経由・要素アクセス・再エクスポート", () => {
      expect(
        kinds(
          `import * as u from "../effect-usage";\nexport const k = (c: any, x: any) => u.makeBucketKey(c, x);`
        )
      ).toContain("own-key");
      expect(
        kinds(`export const k = (u: any) => u["makeConstraintId"]({});`)
      ).toContain("own-key");
      expect(
        kinds(`export { abilityRefKey } from "../effect-usage";`)
      ).toContain("own-key");
    });

    it("読み取り専用の投影 (署名用に buckets と grants を写す) は組み立てと見なさない", () => {
      expect(
        kinds(
          `export const h = (s: any) => ({ p: { buckets: s.effectAccounting.buckets, grants: s.effectAccounting.grants } });`
        )
      ).toEqual([]);
    });

    it("旧形式検出の境界 legacy-guard.ts は旧名の文字列を持ってよい", () => {
      expect(
        find({
          "packages/rules-core/src/effect-usage/legacy-guard.ts": `export const names = ["effectUsageRecords"];`,
        })
      ).toEqual([]);
    });
  });

  it("移行境界 migration.ts だけが旧フィールドを参照してよい", () => {
    const issues = find({
      "packages/rules-core/src/effect-usage/migration.ts": `export const read = (s: any) => s.effectUsageRecords;`,
    });
    expect(issues).toEqual([]);
  });
});
