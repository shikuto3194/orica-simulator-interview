/**
 * P3-170 W0: カタログ全件の制限定義の正規化manifest。
 *
 * 型で決まったコンテナ (effects / accel / change / mirage / quartz / zeroCounter / 神技 /
 * step / choice / 付与効果 / action内steps) を辿って制限を列挙し、すべて正規化できることを検査する。
 * 並行の手書きカード一覧は持たない。カード番号と構造pathが出力され、正規化されずに落ちた制限、
 * または walker が辿れなかった制限 (汎用キー再帰との件数不一致) があれば失敗する。
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  effectAbilityRef,
  normalizeUsageLimits,
  stepAbilityRef,
  choiceAbilityRef,
  type EffectUsageLimit,
} from "../src/effect-usage";

type Json = Record<string, unknown>;

export interface ManifestEntry {
  cardNo: string;
  /** 構造path (effects[2].steps[1].choice[0] 等)。 */
  path: string;
  kind:
    | "usageLimit"
    | "limitGroupId"
    | "usageGroupId"
    | "occurrenceGate"
    | "divineSkillTurnLimit"
    | "divineSkillMaxUsesPerTurn"
    | "oracleTriggerUsageLimit"
    | "declareUsageLimit"
    | "turnLimitDisabled"
    | "exemptSetCountLimits";
  value: unknown;
}

const isObj = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function walkSteps(
  cardNo: string,
  base: string,
  steps: unknown,
  out: ManifestEntry[]
): void {
  if (!Array.isArray(steps)) return;
  steps.forEach((step, i) => {
    if (!isObj(step)) return;
    const path = `${base}.steps[${i}]`;
    walkStep(cardNo, path, step, out);
  });
}

function walkStep(
  cardNo: string,
  path: string,
  step: Json,
  out: ManifestEntry[]
): void {
  if (step.usageLimit !== undefined)
    out.push({ cardNo, path, kind: "usageLimit", value: step.usageLimit });
  if (step.usageGroupId !== undefined)
    out.push({ cardNo, path, kind: "usageGroupId", value: step.usageGroupId });
  if (Array.isArray(step.choice)) {
    step.choice.forEach((c, k) => {
      if (isObj(c)) walkStep(cardNo, `${path}.choice[${k}]`, c, out);
    });
  }
  const action = step.action;
  if (isObj(action)) {
    if (action.usageLimit !== undefined)
      out.push({
        cardNo,
        path: `${path}.action`,
        kind: "usageLimit",
        value: action.usageLimit,
      });
    for (const key of [
      "beforePickSteps",
      "beforeMoveSteps",
      "normalActionDeclarationSteps",
    ]) {
      const nested = action[key];
      if (Array.isArray(nested)) {
        nested.forEach((s, k) => {
          if (isObj(s)) walkStep(cardNo, `${path}.action.${key}[${k}]`, s, out);
        });
      }
    }
    if (isObj(action.grantedEffect))
      walkEffect(
        cardNo,
        `${path}.action.grantedEffect`,
        action.grantedEffect,
        out
      );
  }
}

function walkEffect(
  cardNo: string,
  path: string,
  effect: Json,
  out: ManifestEntry[]
): void {
  if (effect.usageLimit !== undefined)
    out.push({ cardNo, path, kind: "usageLimit", value: effect.usageLimit });
  if (effect.limitGroupId !== undefined)
    out.push({
      cardNo,
      path,
      kind: "limitGroupId",
      value: effect.limitGroupId,
    });
  if (effect.occurrenceGate !== undefined)
    out.push({
      cardNo,
      path,
      kind: "occurrenceGate",
      value: effect.occurrenceGate,
    });
  walkSteps(cardNo, path, effect.steps, out);
}

function walkEffects(
  cardNo: string,
  base: string,
  effects: unknown,
  out: ManifestEntry[]
): void {
  if (!Array.isArray(effects)) return;
  effects.forEach((effect, i) => {
    if (isObj(effect)) walkEffect(cardNo, `${base}[${i}]`, effect, out);
  });
}

function walkCard(cardNo: string, card: Json, out: ManifestEntry[]): void {
  walkEffects(cardNo, "effects", card.effects, out);
  for (const key of [
    "accelData",
    "changeData",
    "mirageData",
    "quartzData",
    "zeroCounterData",
  ]) {
    const data = card[key];
    if (isObj(data)) walkEffects(cardNo, `${key}.effects`, data.effects, out);
  }
  const mirage = card.mirageData;
  if (isObj(mirage) && mirage.exemptSetCountLimits !== undefined)
    out.push({
      cardNo,
      path: "mirageData",
      kind: "exemptSetCountLimits",
      value: mirage.exemptSetCountLimits,
    });
  const advent = card.adventData;
  if (isObj(advent) && advent.declareUsageLimit !== undefined)
    out.push({
      cardNo,
      path: "adventData",
      kind: "declareUsageLimit",
      value: advent.declareUsageLimit,
    });
  const dual = card.hostDualAdventGrant;
  if (
    isObj(dual) &&
    isObj(dual.alternateCost) &&
    dual.alternateCost.turnLimitDisabled !== undefined
  )
    out.push({
      cardNo,
      path: "hostDualAdventGrant.alternateCost",
      kind: "turnLimitDisabled",
      value: dual.alternateCost.turnLimitDisabled,
    });
  const gw = card.grandwalkerData;
  if (isObj(gw)) {
    if (gw.oracleTriggerUsageLimit !== undefined)
      out.push({
        cardNo,
        path: "grandwalkerData.oracleTriggerUsageLimit",
        kind: "oracleTriggerUsageLimit",
        value: gw.oracleTriggerUsageLimit,
      });
    if (
      isObj(gw.placementOracle) &&
      gw.placementOracle.usageLimit !== undefined
    )
      out.push({
        cardNo,
        path: "grandwalkerData.placementOracle.usageLimit",
        kind: "usageLimit",
        value: gw.placementOracle.usageLimit,
      });
    if (Array.isArray(gw.divineSkills)) {
      gw.divineSkills.forEach((skill, i) => {
        if (!isObj(skill)) return;
        const base = `grandwalkerData.divineSkills[${i}]`;
        if (skill.turnLimit !== undefined)
          out.push({
            cardNo,
            path: base,
            kind: "divineSkillTurnLimit",
            value: skill.turnLimit,
          });
        if (skill.maxUsesPerTurn !== undefined)
          out.push({
            cardNo,
            path: base,
            kind: "divineSkillMaxUsesPerTurn",
            value: skill.maxUsesPerTurn,
          });
        if (skill.usageLimit !== undefined)
          out.push({
            cardNo,
            path: base,
            kind: "usageLimit",
            value: skill.usageLimit,
          });
        walkEffects(cardNo, `${base}.effects`, skill.effects, out);
      });
    }
  }
}

/** カタログ全件(表面+裏面)の制限manifest。 */
export function buildCatalogManifest(): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  for (const card of ALL_CARDS as unknown as Json[]) {
    walkCard(String(card.cardNo), card, out);
    if (isObj(card.backFace))
      walkCard(String(card.backFace.cardNo), card.backFace, out);
  }
  return out;
}

/** 独立検査用: 汎用のキー再帰で `key` の出現数を数える (walkerの取りこぼし検出)。 */
function countKeyRecursively(value: unknown, key: string): number {
  if (Array.isArray(value))
    return value.reduce<number>((n, v) => n + countKeyRecursively(v, key), 0);
  if (!isObj(value)) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(value)) {
    if (k === key && v !== undefined) n += 1;
    n += countKeyRecursively(v, key);
  }
  return n;
}

const manifest = buildCatalogManifest();

describe("P3-170 W0: カタログ制限manifest", () => {
  it("manifest が生成され、カード番号と構造pathを持つ", () => {
    expect(manifest.length).toBeGreaterThan(300);
    for (const entry of manifest) {
      expect(entry.cardNo).toMatch(/\S/);
      expect(entry.path).toMatch(/\S/);
    }
  });

  it.each([
    ["usageLimit", "usageLimit"],
    ["limitGroupId", "limitGroupId"],
    ["usageGroupId", "usageGroupId"],
    ["occurrenceGate", "occurrenceGate"],
    ["divineSkillMaxUsesPerTurn", "maxUsesPerTurn"],
    ["oracleTriggerUsageLimit", "oracleTriggerUsageLimit"],
    ["declareUsageLimit", "declareUsageLimit"],
    ["turnLimitDisabled", "turnLimitDisabled"],
    ["exemptSetCountLimits", "exemptSetCountLimits"],
  ] as const)(
    "walker が辿った %s の件数は、汎用キー再帰の件数と一致する (取りこぼし0)",
    (kind, key) => {
      const walked = manifest.filter((e) => e.kind === kind).length;
      const generic = (ALL_CARDS as unknown[]).reduce<number>(
        (n, card) => n + countKeyRecursively(card, key),
        0
      );
      // backFace は表面カードの内部に含まれるため、汎用再帰も同じ構造を数える。
      expect(walked).toBe(generic);
    }
  );

  it("神託の回数制限は共通の制限型で、専用の旧形式 (oracleTriggerLimit / placementOracle.turnLimit) はカタログに残らない (I09)", () => {
    const count = (key: string) =>
      (ALL_CARDS as unknown[]).reduce<number>(
        (n, card) => n + countKeyRecursively(card, key),
        0
      );
    // 汎用キー再帰でも旧キーは0件 (神技の turnLimit もI01で消えているため、turnLimit 自体が残らない)。
    expect(count("oracleTriggerLimit")).toBe(0);
    expect(count("turnLimit")).toBe(0);
    expect(
      manifest
        .filter((e) => e.path === "grandwalkerData.oracleTriggerUsageLimit")
        .map((e) => e.cardNo)
    ).toEqual(["BSLH01-X01"]);
    expect(
      manifest
        .filter((e) => e.path === "grandwalkerData.placementOracle.usageLimit")
        .map((e) => e.cardNo)
        .sort()
    ).toEqual(["BSES01-CX01", "BSTH02.7-CX01"]);
  });

  it("すべての usageLimit (神託の制限を含む) が正規化でき、制約は欠落なく有効な軸を持つ", () => {
    const entries = manifest.filter(
      (e) =>
        e.kind === "usageLimit" ||
        e.kind === "oracleTriggerUsageLimit" ||
        e.kind === "declareUsageLimit"
    );
    expect(entries.length).toBeGreaterThan(400);
    for (const entry of entries) {
      const limits = (
        Array.isArray(entry.value) ? entry.value : [entry.value]
      ) as EffectUsageLimit[];
      // 共有グループは、同じ効果/step の limitGroupId / usageGroupId が識別になる。
      const groupId = manifest.find(
        (e) =>
          e.cardNo === entry.cardNo &&
          e.path === entry.path &&
          (e.kind === "limitGroupId" || e.kind === "usageGroupId")
      )?.value;
      if (limits.some((limit) => limit.kind === "per_group")) {
        // groupId が解決されないと識別キーが作れず、列挙で常に使用不可になる。
        expect(
          typeof groupId,
          `${entry.cardNo} ${entry.path} の per_group に groupId が無い`
        ).toBe("string");
      }
      const constraints = normalizeUsageLimits({
        abilityRef: effectAbilityRef(entry.cardNo, 0),
        limits: entry.value as EffectUsageLimit | EffectUsageLimit[],
        ...(typeof groupId === "string" ? { groupId } : {}),
      });
      expect(constraints, `${entry.cardNo} ${entry.path}`).toHaveLength(
        limits.length
      );
      for (const c of constraints) {
        expect(
          Number.isSafeInteger(c.maximum.base) && c.maximum.base >= 1,
          `${entry.cardNo} ${entry.path}`
        ).toBe(true);
        expect([
          "instance",
          "card_name",
          "group",
          "subject_instance",
        ]).toContain(c.share);
        expect([
          "game",
          "turn",
          "step",
          "battle",
          "event",
          "activation",
        ]).toContain(c.period);
      }
    }
  });

  it("per_group は groupId を、step/choice の ability 参照は構造pathで区別される", () => {
    expect(stepAbilityRef("D", 1, 2).path).not.toBe(
      stepAbilityRef("D", 1, 3).path
    );
    expect(choiceAbilityRef("D", 1, 0).path).not.toBe(
      choiceAbilityRef("D", 1, 1).path
    );
    const withGroup = normalizeUsageLimits({
      abilityRef: effectAbilityRef("D", 0),
      limits: { kind: "per_group", duration: "turn" },
      groupId: "g",
    });
    expect(withGroup[0]!.groupId).toBe("g");
  });

  it("識別 pin: 既存カードの使用枠の位置・種類・値は固定 (本文の指紋は対象外)。変えると保存済み state の識別が変わるので、移行を伴うか意図して pin を更新する", () => {
    // 識別 (abilityRef の path) は card-data の step / effect 位置から作る。位置の挿入・並べ替え・制限の種類の変更は
    // 件数を変えずに識別だけを変えるので、カードごとの (path, kind, value) の hash で検出する。
    // 新しいカードは pin に無くてもよい (既存カードだけ固定)。更新: EFFECT_USAGE_PINS_UPDATE=1 で実行。
    const byCard = new Map<string, ManifestEntry[]>();
    for (const entry of manifest) {
      byCard.set(entry.cardNo, [...(byCard.get(entry.cardNo) ?? []), entry]);
    }
    const current: Record<string, string> = {};
    for (const cardNo of [...byCard.keys()].sort()) {
      const rows = byCard
        .get(cardNo)!
        .map((e) => JSON.stringify([e.path, e.kind, e.value]))
        .sort();
      current[cardNo] = createHash("sha256")
        .update(rows.join("\n"))
        .digest("hex")
        .slice(0, 16);
    }
    const pinFile = new URL(
      "./fixtures/effect-usage-identity-pins.json",
      import.meta.url
    );
    if (process.env.EFFECT_USAGE_PINS_UPDATE === "1") {
      writeFileSync(pinFile, JSON.stringify(current, null, 1) + "\n");
    }
    const pins = JSON.parse(readFileSync(pinFile, "utf8")) as Record<
      string,
      string
    >;
    expect(Object.keys(pins).length).toBeGreaterThan(100);
    for (const [cardNo, pin] of Object.entries(pins)) {
      expect(
        current[cardNo],
        `${cardNo}: 使用枠の位置・種類・値が変わった`
      ).toBe(pin);
    }
    // usageGroupId は位置 (数字) と取り違えられる形にしない (旧ラベル `__step:...:<tail>` の数字は位置)。
    for (const e of manifest.filter((m) => m.kind === "usageGroupId")) {
      expect(String(e.value), `${e.cardNo} ${e.path}`).not.toMatch(/^\d+$/);
    }
  });

  it("regression: 実カタログの規模 (usageLimit 448 - BSDB01-C07 の重複分岐1 = 447、召喚/煌臨の神託制限1)", () => {
    expect(manifest.filter((e) => e.kind === "usageLimit")).toHaveLength(447);
    expect(
      manifest.filter((e) => e.kind === "oracleTriggerUsageLimit")
    ).toHaveLength(1);
  });

  it("神技の旧形式 turnLimit / maxUsesPerTurn はカタログに残らない (I01)", () => {
    expect(
      manifest.filter((e) => e.kind === "divineSkillTurnLimit")
    ).toHaveLength(0);
    expect(
      manifest.filter((e) => e.kind === "divineSkillMaxUsesPerTurn")
    ).toHaveLength(0);
    const divineUsage = manifest.filter(
      (e) =>
        e.kind === "usageLimit" &&
        e.path.startsWith("grandwalkerData.divineSkills[")
    );
    // 旧 turnLimit 22 + 旧 usageLimit 単独(BSTH10-X03) 1
    expect(divineUsage).toHaveLength(23);
  });
});
