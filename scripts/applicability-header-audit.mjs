import {
  collectCardFaces,
  collectEffectContainers,
} from "./card-text-accountability-core.mjs";

const zonesOf = (effect) => [effect.applicability?.zone].flat().filter(Boolean);
const supportsZone = (effect, zone) =>
  zonesOf(effect).includes(zone) ||
  (zone === "soul_state" && effect.applicability?.soulState === true);

/** 本文の明示ヘッダーと構造化された資格を照合する。実行時の本文推定には使わない。 */
export function auditApplicabilityHeaders(cards) {
  const issues = [];
  let effects = 0;
  for (const { face } of cards.flatMap(collectCardFaces)) {
    for (const container of collectEffectContainers(face)) {
      for (const [index, effect] of container.effects.entries()) {
        effects++;
        const issue = (line, field) =>
          issues.push({
            cardNo: face.cardNo,
            path: `${container.path}[${index}]`,
            line,
            field,
          });
        for (const line of effect.textRef ?? []) {
          const text = (face.textLines?.[line] ?? "").normalize("NFKC");
          // 本文中の対象条件（「相手のLv2...」）と、発揮元の見出しを区別する。
          if (!/^(?:フラッシュ\s*)?(?:【|Lv\d)/.test(text)) continue;
          for (const [marker, zone] of [
            [/【(?:契約)?煌臨元】/, "advent_source"],
            [/【魂状態】/, "soul_state"],
          ]) {
            if (!marker.test(text)) continue;
            // 通常状態/魂状態を別 Effect に分割した定義は、同じ本文・同じ処理ごとに照合する。
            // 単に同じ textRef を持つ別処理があるだけでは、欠落を隠せない。
            const providers = container.effects.filter(
              (other) =>
                other.textRef?.includes(line) && supportsZone(other, zone)
            );
            for (const kind of new Set(
              effect.steps.map((step) => step.action.kind)
            )) {
              if (
                !providers.some((other) =>
                  other.steps.some((step) => step.action.kind === kind)
                )
              )
                issue(line, `${zone}:${kind}`);
            }
            if (
              zone === "advent_source" &&
              /【契約煌臨元】/.test(text) &&
              supportsZone(effect, zone) &&
              !effect.applicability?.adventSourceHostVariants?.length
            )
              issue(line, "adventSourceHostVariants");
          }
          // 行頭の発揮Lvのみを読む。本文中の対象Lvや引用された付与効果は混ぜない。
          const levelHeader = /^Lv(\d+)/.exec(text);
          if (levelHeader) {
            const min = Number(levelHeader[1]);
            const baseMin = Math.min(
              ...(face.levelDefs ?? []).map((def) => def.level)
            );
            const conditionMin = (effect.condition ?? [])
              .filter((clause) => clause.kind === "min_level")
              .map((clause) => clause.value);
            if (
              min > baseMin &&
              (effect.applicability?.level?.min ?? 0) < min &&
              !conditionMin.some((value) => value >= min)
            )
              issue(line, "level.min");
          }
          if (
            /【左右合体中】/.test(text) &&
            effect.applicability?.imaginDualCombined !== true
          )
            issue(line, "imaginDualCombined");
          if (
            /【合体中】/.test(text) &&
            effect.applicability?.combined !== true &&
            !(effect.condition ?? []).some(
              (clause) => clause.kind === "combined"
            )
          )
            issue(line, "combined");
          if (
            /【セット中】/.test(text) &&
            !zonesOf(effect).some(
              (zone) => zone === "burst_set" || zone === "mirage_set"
            ) &&
            !effect.steps.some(
              (step) => step.action.duration?.scope === "while_set"
            )
          )
            issue(line, "set_zone");
        }
      }
    }
  }
  return { cards: cards.length, effects, issues };
}
