/**
 * card-data の `Effect.textRef` 整合性ガード。
 *
 * `textRef` は「この効果が印字テキスト (`textLines`) のどの行に対応するか」の索引で、
 * 表示専用ではなく **挙動にも効く**:
 *   - GUI の効果キュー (EffectQueueOverlay) は textRef の行をそのまま連結表示する。
 *     本文行が抜けていると見出しだけが出て「何が起きるか」がユーザーに見えない。
 *   - `inferRequiredQuartzInheritedSourceRole` / `inferRequiredTextRoleUnderSourceRole`
 *     (structured-effect-registrations.ts) と continuous-effect-rebuild.ts は
 *     **textRef が指す行**を読んで【クォーツ：…】/ 星霊衣ヘッダーを検出し、
 *     `requiredSourceRole` を推論する。見出し行を外すとセット中限定の発揮ゲートが消える。
 *   - `deriveTriggerPhrasesFromTextRefs` は textRef 行から「アタック時」「バトル終了」等を
 *     抽出し suppress_effect の `triggerPhrase` 照合に使う。
 *
 * 索引ずれは型で防げず、単体テストも「効果が動くこと」しか見ないため長期間潜伏する
 * (実例: BSSA01-転醒X01(A) 『このネクサスの配置時』が見出し行だけを指しており、
 * キューに「自分はデッキの上から1枚ドローする。」が出ていなかった)。
 * カード追加のたびに再発しうる構造的バグなので機械ガードで止める。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";
import type { Effect } from "../src/dsl-types";

/**
 * 「見出しだけの行」か。Lv 表記・【…】・『…』・〔…〕・「フラッシュ」等の
 * タイミング/機構マーカーを剥がして本文が残らなければ見出し行とみなす。
 *
 * NOTE: `isEffectTimingHeadingLine` (effect-label-utils.ts) とは目的が別。あちらは
 * 『◯◯時』を持つトリガー見出しだけを拾う狭い判定で、`Lv2` 単独や
 * 【クォーツ：…】のような見出し行は対象外。ここでは「本文を持たない行か」を
 * 判定したいので独自に持つ (同じ列挙の二重化ではない)。
 */
function isHeadingOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  const body = trimmed
    .replace(/【[^】]*】/g, "")
    .replace(/『[^』]*』/g, "")
    .replace(/〔[^〕]*〕/g, "")
    .replace(/Lv\s*\d+(?:\s*[-〜~]\s*Lv?\s*\d+)*/gi, "")
    .replace(/フラッシュ/g, "")
    .replace(/[■・\s:：/、,]/g, "");
  return body === "";
}

/** 効果を持ちうる入れ子コンテナを ownerLabel 付きで平坦化する。 */
function collectEffectContainers(
  def: CardDefinition
): { label: string; effects: readonly Effect[] }[] {
  const out: { label: string; effects: readonly Effect[] }[] = [];
  const push = (label: string, effects: readonly Effect[] | undefined) => {
    if (effects && effects.length > 0) out.push({ label, effects });
  };
  push("effects", def.effects);
  push("accelData.effects", def.accelData?.effects);
  push("changeData.effects", def.changeData?.effects);
  push("mirageData.effects", def.mirageData?.effects);
  push("zeroCounterData.effects", def.zeroCounterData?.effects);
  push("quartzData.effects", def.quartzData?.effects);
  def.grandwalkerData?.divineSkills?.forEach((skill, i) =>
    push(`grandwalkerData.divineSkills[${i}].effects`, skill.effects)
  );
  return out;
}

/** 表面 + 裏面をそれぞれ「自前の textLines を持つ独立した監査単位」として展開する。 */
function auditUnits(): { cardNo: string; def: CardDefinition }[] {
  const units: { cardNo: string; def: CardDefinition }[] = [];
  for (const card of ALL_CARDS) {
    units.push({ cardNo: card.cardNo, def: card });
    if (card.backFace) {
      units.push({
        cardNo: card.backFace.cardNo ?? `${card.cardNo}(backFace)`,
        // backFace は textLines / effects を自前で持つため CardDefinition 相当として扱う
        def: card.backFace as unknown as CardDefinition,
      });
    }
  }
  return units;
}

type Violation = { where: string; reason: string };

function auditTextRefs(): Violation[] {
  const violations: Violation[] = [];
  for (const { cardNo, def } of auditUnits()) {
    const lines = def.textLines ?? [];
    for (const { label, effects } of collectEffectContainers(def)) {
      effects.forEach((effect, index) => {
        const ref = effect.textRef;
        if (!ref || ref.length === 0) return;
        const where = `${cardNo} ${label}[${index}] textRef=[${ref.join(",")}]`;

        // (1) 範囲外 = 常に空文字へ解決される死んだ索引
        const outOfRange = ref.filter((i) => i < 0 || i >= lines.length);
        if (outOfRange.length > 0) {
          violations.push({
            where,
            reason: `textLines(len=${lines.length}) の範囲外を指している: [${outOfRange.join(",")}]`,
          });
        }

        // (2) 空行 = 情報を持たない索引 (ほぼ確実に off-by-one)
        const blank = ref.filter(
          (i) => i >= 0 && i < lines.length && (lines[i] ?? "").trim() === ""
        );
        if (blank.length > 0) {
          violations.push({
            where,
            reason: `空行を指している: [${blank.join(",")}]`,
          });
        }

        // (3) 見出し行しか指しておらず、同ブロックに未参照の本文行がある
        //     = 効果キューに「何が起きるか」が出ない
        const resolved = ref.filter(
          (i) => i >= 0 && i < lines.length && (lines[i] ?? "").trim() !== ""
        );
        if (resolved.length === 0) return;
        if (!resolved.every((i) => isHeadingOnlyLine(lines[i] ?? ""))) return;

        // 参照行を含む「空行で区切られた連続ブロック」を復元する
        const block = new Set<number>();
        for (const i of resolved) {
          for (let j = i; j >= 0 && (lines[j] ?? "").trim() !== ""; j--)
            block.add(j);
          for (
            let j = i;
            j < lines.length && (lines[j] ?? "").trim() !== "";
            j++
          )
            block.add(j);
        }
        const missingBody = [...block]
          .sort((a, b) => a - b)
          .filter(
            (j) => !ref.includes(j) && !isHeadingOnlyLine(lines[j] ?? "")
          );
        if (missingBody.length > 0) {
          violations.push({
            where,
            reason: `見出し行しか指していない。同ブロックの本文行 [${missingBody.join(",")}] が抜けている: ${missingBody
              .map((j) => `"${(lines[j] ?? "").slice(0, 40)}"`)
              .join(" / ")}`,
          });
        }
      });
    }
  }
  return violations;
}

describe("card-data textRef 整合性", () => {
  it("全カードの textRef が範囲内かつ空行を指さず、本文行を必ず含む", () => {
    const violations = auditTextRefs();
    const report = violations.map((v) => `- ${v.where}\n    ${v.reason}`);
    expect(
      report,
      `textRef 不整合 ${violations.length} 件:\n${report.join("\n")}`
    ).toEqual([]);
  });
});
