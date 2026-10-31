/**
 * P3-143 残タスク3: card-data 横断 sweep。
 *
 * 原文に「一切の効果で防げない」を含む effect は、target lock
 * （`対象にできず、含めない`、BSTH06-X02 / BSAZ02-C04 型）まで貫通する
 * `targetLockBypass:{kind:"all_effects"}` rider を持つべき（裁定:
 * issues/P3-143_blanket-unpreventable-target-lock-penetration.md 「裁定（確定済み）」節）。
 *
 * 「お互いの効果で防げない」(BSAZ02-C14 型) は文言が違う語尾かつ別軸
 * （affect immunity 限定、target lock は貫通しない）なので、このマッチには含めない。
 * 「系統：「蓬莱」を持つ一切の効果で防げず」(BSTH03-X02) のようなスコープ内強調の
 * 「一切の」は語尾が「防げず」で「一切の効果で防げない」の完全一致に掛からないため
 * 自然に除外される。
 *
 * 現状 rider を持たない1枚は明示 allowlist で除外する。新規カードでこの文言が出た場合は、
 * まず targetLockBypass の付与を試みること。
 *  - BSTH05.5-M01: `grant_effect_source_prevention_immunity` で合体ホスト
 *    (BSTH05.5-X01) の cost_destroy 効果（実際に対象を取る destroy）へ動的付与するため、
 *    この effect 自体は対象を取らず rider を乗せる先が無い。付与先の
 *    `effectSourceTargetLockBypass` 計算（`effect-interpreter.ts`）へ
 *    `dynamicEffectSourcePreventionBypass` / `dynamicEffectClassSourcePreventionBypass`
 *    を merge していなかった engine gap は [P3-150](../../../issues/archive/P3-150/index.md)
 *    で解消済み（盤面テスト: `bsth05_5-cards.test.ts` の P3-150 ケース）。本カードが実際に通る
 *    経路（`effect-interpreter.ts` の `resolveTargets()` 呼び出し →
 *    `native-target-resolution.ts` の `filterTargetsByTargetAcquisitionGate`、詳細は P3-150
 *    「修正内容」節参照）は今回の修正で閉じるが、`legal-actions-availability.ts` 側の
 *    **別経路**（プレイヤー宣言時に対象を選ぶ型のアビリティ向け候補列挙）は同型 gap が
 *    未修正のまま残る（P3-150 の「残留懸念」節参照、現時点で該当する実在カードは無し）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import type { CardDefinition } from "../src/model";

const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);

const ALL_EFFECTS_PHRASE = "一切の効果で防げない";
const MUTUAL_PHRASE = "お互いの効果で防げない";

/**
 * rider 無しが正しい既知の例外。理由は card-data 側コメントを参照。
 *  - BSTH05.5-M01: grant_effect_source_prevention_immunity で合体ホストの
 *    cost_destroy 効果へ動的付与するため、この effect 自体には乗らない
 *    (BSTH05.5.ts の当該 effect 直上コメント参照)。
 */
const KNOWN_NO_RIDER_EXEMPTIONS = new Set<string>(["BSTH05.5-M01"]);

function joinEffectText(
  def: CardDefinition,
  textRef: number[] | undefined
): string {
  if (!textRef) return "";
  return textRef.map((i) => def.textLines?.[i] ?? "").join("");
}

describe("P3-143: 「一切の効果で防げない」targetLockBypass rider 機械検知 sweep", () => {
  it("原文に『一切の効果で防げない』を含む effect は targetLockBypass:{kind:'all_effects'} を持つ（例外は allowlist 明記のみ）", () => {
    const missing: string[] = [];
    for (const def of expanded) {
      const effects = def.effects ?? [];
      effects.forEach((effect, idx) => {
        const text = joinEffectText(def, effect.textRef);
        if (!text.includes(ALL_EFFECTS_PHRASE)) return;
        if (KNOWN_NO_RIDER_EXEMPTIONS.has(def.cardNo)) return;
        if (effect.targetLockBypass?.kind !== "all_effects") {
          missing.push(`${def.cardNo}[${idx}]`);
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it("allowlist は現状の2枚から増減していない（増えたら精査要、減ったら記述を消し忘れ）", () => {
    const stillPresentAndUnrided = [...KNOWN_NO_RIDER_EXEMPTIONS].filter(
      (cardNo) => {
        const def = expanded.find((c) => c.cardNo === cardNo);
        if (!def) return false;
        return (def.effects ?? []).some((effect) =>
          joinEffectText(def, effect.textRef).includes(ALL_EFFECTS_PHRASE)
        );
      }
    );
    expect(stillPresentAndUnrided.sort()).toEqual(
      [...KNOWN_NO_RIDER_EXEMPTIONS].sort()
    );
  });

  it("『お互いの効果で防げない』を含む effect には all_effects rider を付けない（BSAZ02-C14、target lock 非貫通の裁定維持）", () => {
    const wronglyRided: string[] = [];
    for (const def of expanded) {
      const effects = def.effects ?? [];
      effects.forEach((effect, idx) => {
        const text = joinEffectText(def, effect.textRef);
        if (!text.includes(MUTUAL_PHRASE)) return;
        if (effect.targetLockBypass?.kind === "all_effects") {
          wronglyRided.push(`${def.cardNo}[${idx}]`);
        }
      });
    }
    expect(wronglyRided).toEqual([]);
  });
});
