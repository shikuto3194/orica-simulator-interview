import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
} from "../src/legal/legal-actions-shared";

const phrase = /重複不可|重複(?:しない|できない|出来ない|せず)/;
const entries = ALL_CARDS.flatMap((card) =>
  card.textLines.flatMap((text, line) =>
    phrase.test(text) ? [{ card, text, line }] : []
  )
);
// フィールド合体/召喚前処理の機構。誘発/継続効果ではない。
const intrinsic = new Set(["BSAZ01-C18:1"]);
const limited = ALL_CARDS.flatMap((card) =>
  (card.effects ?? []).flatMap((effect, index) => {
    const limits = effect.usageLimit
      ? Array.isArray(effect.usageLimit)
        ? effect.usageLimit
        : [effect.usageLimit]
      : [];
    return limits.some((limit) => limit.kind === "no_duplicate")
      ? [{ card, effect, index }]
      : [];
  })
);

describe("重複不可の全カード監査", () => {
  it.each(
    entries.map((entry) => ({
      ...entry,
      label: `${entry.card.cardNo}:${entry.line}`,
    }))
  )("$label: 本文を重複不可または機構で表現する", ({ card, line, label }) => {
    if (label === "BSTH002-C01:0") {
      expect(card.mirageData?.exemptSetCountLimits).toBe(true);
      return;
    }
    if (intrinsic.has(label)) {
      expect(
        card.effects?.some(
          (e) =>
            e.textRef?.includes(line) &&
            e.timing.kind === "continuous" &&
            e.steps.length === 0
        )
      ).toBe(true);
      return;
    }
    expect(
      limited.some((e) => e.card === card && e.effect.textRef?.includes(line)),
      label
    ).toBe(true);
  });
  it.each(
    limited.map((entry) => ({
      ...entry,
      label: `${entry.card.cardNo} effect:${entry.index}`,
    }))
  )(
    "$label: 本文根拠・同名別個体・相手・別イベントを照合する",
    ({ card, effect, index }) => {
      expect(
        effect.textRef?.some((line) =>
          phrase.test(card.textLines[line] ?? "")
        ) ||
          card.textLines.some((line) =>
            /このネクサスの効果は重複せず/.test(line)
          )
      ).toBe(true);
      let state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: ["used", "other", "opponent"].map((instanceId) =>
          createCardInstance(card, {
            instanceId,
            ownerPlayerId: instanceId === "opponent" ? "bob" : "alice",
            zone: "field",
            normalCoreCount: 1,
          })
        ),
      });
      const base = {
        sourceDefinitionId: card.cardNo,
        effectLabel: `effect:${index}`,
        usageLimit: { kind: "no_duplicate" as const },
        ...(effect.limitGroupId ? { groupId: effect.limitGroupId } : {}),
        getCardDefinitionById: (id: string) =>
          ALL_CARDS.find((c) => c.cardNo === id),
      };
      state = recordEffectUsageIfLimited({
        state,
        ...base,
        sourceInstanceId: "used",
        triggerEventScopeKey: "event-a",
      });
      expect(
        canUseEffectByUsageLimit({
          state,
          ...base,
          sourceInstanceId: "other",
          triggerEventScopeKey: "event-a",
        })
      ).toBe(false);
      expect(
        canUseEffectByUsageLimit({
          state,
          ...base,
          sourceInstanceId: "opponent",
          triggerEventScopeKey: "event-a",
        })
      ).toBe(true);
      expect(
        canUseEffectByUsageLimit({
          state,
          ...base,
          sourceInstanceId: "other",
          triggerEventScopeKey: "event-b",
        })
      ).toBe(true);
    }
  );
});
