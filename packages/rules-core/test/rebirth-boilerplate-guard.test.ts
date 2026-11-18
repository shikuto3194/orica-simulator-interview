/**
 * DATA LINT GUARD: 転醒 flip ルール文（B 面 boilerplate）を効果として表現しない。
 *
 * ルール正源: manual/ai-reference/10_rules/08a_advent-rebirth-contract.md §2 処理手順 3
 *   B面「この面に裏返ったとき、フィールドに残り、カウント+1する」（**効果ではない**ため
 *   効果無効の影響外）。
 *
 * エンジン側: executeRebirth (structured-effect-interpreter.ts) が転醒成功時に
 * countValue+1 をルールとして適用済み。この行を card_event:"rebirth" の count_increase
 * 効果として二重に書くと、production では「ルール +1 → 誘発効果解決でさらに +1」の
 * 二重計上になり、かつ効果無効で抑止可能になってしまう（08a が明示的に除外する挙動）。
 *
 * このガードは ALL_CARDS（backFace 合成定義を含む production と同じ展開）を走査し、
 *  (1) いかなる効果も textRef で flip ルール文の textLine を指してはならない
 *  (2) rebirth タイミング × count_increase の効果は textRef 必須
 *      （textRef 省略で (1) を迂回して boilerplate を再導入する経路を塞ぐ）
 * を機械的に強制する。印字された純正の『転醒時』カウント増加効果（flip ルール文とは
 * 別の textLine を参照するもの）は禁止しない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import type { CardDefinition } from "../src/model";

/**
 * flip ルール文（カウント+1 boilerplate）の判定。データ中の表記ゆれを全て吸収する:
 *  - 「この面に裏返ったとき、フィールドに残り、カウント+1する。」
 *  - 「この面に裏返ったとき、フィールドに残りカウント+1する（…）。」（読点なし）
 *  - 「この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する。」
 *  - 「…フィールドに残り、カウント1する。」（+ 脱字の誤記も boilerplate として扱う）
 * 「フィールドに残る。」のみ／「カウントを0にする」変種はカウント+1 ルールではないため対象外。
 */
const FLIP_RULE_BOILERPLATE =
  /裏返ったとき、フィールドに残り、?カウント\+?1する/;

type Effect = NonNullable<CardDefinition["effects"]>[number];

function timingIncludesRebirth(timing: Effect["timing"]): boolean {
  if (timing.kind !== "card_event" && timing.kind !== "game_event") {
    return false;
  }
  const events: readonly string[] = Array.isArray(timing.event)
    ? timing.event
    : [timing.event];
  return events.includes("rebirth");
}

function hasCountIncreaseStep(effect: Effect): boolean {
  return effect.steps.some((s) => s.action.kind === "count_increase");
}

const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);

describe("GUARD: 転醒 flip ルール文 (カウント+1 boilerplate) は効果化禁止", () => {
  it("sanity: boilerplate 正規表現はデータ中の flip ルール文に現にマッチする", () => {
    // 正規表現が表記ゆれの変化で空振りし、ガードが形骸化していないことの自衛。
    const matchingLines = expanded.flatMap((def) =>
      (def.textLines ?? []).filter((line) => FLIP_RULE_BOILERPLATE.test(line))
    );
    expect(matchingLines.length).toBeGreaterThanOrEqual(20);
  });

  it("どの効果も textRef で flip ルール文の textLine を参照しない", () => {
    const violations: string[] = [];
    for (const def of expanded) {
      const textLines = def.textLines ?? [];
      (def.effects ?? []).forEach((effect, effectIndex) => {
        for (const refIndex of effect.textRef ?? []) {
          const line = textLines[refIndex] ?? "";
          if (FLIP_RULE_BOILERPLATE.test(line)) {
            violations.push(
              `${def.cardNo} effects[${effectIndex}] textRef[${refIndex}] がルール文を効果として参照: "${line}" — ` +
                "flip 時のカウント+1 は executeRebirth がルールとして適用済み (08a §2 手順3)。effects から除去すること。"
            );
          }
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("rebirth タイミング × count_increase の効果は textRef 必須（boilerplate 迂回防止）", () => {
    const violations: string[] = [];
    for (const def of expanded) {
      (def.effects ?? []).forEach((effect, effectIndex) => {
        if (
          timingIncludesRebirth(effect.timing) &&
          hasCountIncreaseStep(effect) &&
          (effect.textRef === undefined || effect.textRef.length === 0)
        ) {
          violations.push(
            `${def.cardNo} effects[${effectIndex}] は rebirth × count_increase なのに textRef が無い — ` +
              "印字された純正の『転醒時』カウント増加効果なら該当 textLine を textRef で指すこと。flip ルール文の効果化は禁止。"
          );
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
