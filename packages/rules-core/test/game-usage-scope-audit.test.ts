import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
} from "../src/legal/legal-actions-shared";
import type { EffectUsageLimit } from "../src/dsl-types";
import type { CardDefinition } from "../src/model";

// 文言の解釈は 10_rules/03e の 2026-09-10 ユーザー確認。DSL 自体を期待値にしない。
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/\s/g, "")
    .replace(/ゲーム1に回/g, "ゲームに1回")
    // BSTS01-C01: 2026-09-13 ユーザー裁定。ゲート中1回は個体ごとのゲーム1回。
    .replace(/ゲート中に1回/g, "ゲーム中に1回");
const gamePhrase =
  /ゲーム(?:中)?に(\d+)回(?:ずつ)?(?:(しか使えない)|(:?同名))?/;
const sameNameTurnPhrase = /ターンに(\d+)回(?::同名|しか使えない)/;
type Entry = {
  card: CardDefinition;
  path: string;
  text: string;
  limits: EffectUsageLimit[];
  groupId?: string;
};
const entries: Entry[] = [];
for (const card of ALL_CARDS) {
  const walk = (value: unknown, path: string, inheritedText = "") => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((child, i) => walk(child, `${path}[${i}]`, inheritedText));
      return;
    }
    const obj = value as Record<string, unknown>;
    const text = Array.isArray(obj.textRef)
      ? obj.textRef.map((index) => card.textLines[Number(index)]).join("\n")
      : inheritedText;
    if (obj.usageLimit) {
      const limits = (
        Array.isArray(obj.usageLimit) ? obj.usageLimit : [obj.usageLimit]
      ) as EffectUsageLimit[];
      if (limits.some((limit) => limit.duration === "game")) {
        entries.push({
          card,
          path,
          text,
          limits,
          groupId:
            typeof obj.limitGroupId === "string" ? obj.limitGroupId : undefined,
        });
      }
    }
    for (const [key, child] of Object.entries(obj)) {
      if (key !== "textLines") walk(child, path ? `${path}.${key}` : key, text);
    }
  };
  walk(card, "");
}

describe("ゲーム回数制限: 全カードの本文・定義・使用可否", () => {
  it("ゲーム回数文言のある本文は制限付きDSLから参照される", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const card of ALL_CARDS) {
      for (const line of card.textLines) {
        if (!gamePhrase.test(normalize(line))) continue;
        expect
          .soft(
            entries.some(
              (entry) => entry.card === card && entry.text.includes(line)
            ),
            `${card.cardNo}: ${line}`
          )
          .toBe(true);
      }
    }
  });

  it.each(
    entries.map((entry) => ({
      ...entry,
      label: `${entry.card.cardNo} ${entry.path}`,
    }))
  )(
    "$label: 文言に合う共有範囲と全制限を保持する",
    ({ card, path, text, limits, groupId }) => {
      const phrase = normalize(text).match(gamePhrase);
      expect(phrase, `${card.cardNo} ${path}: ${text}`).not.toBeNull();
      const maxCount = Number(phrase![1]);
      const shared = Boolean(phrase![2] || phrase![3]);
      const game = limits.find((limit) => limit.duration === "game")!;
      expect.soft(game.kind).toBe(shared ? "per_card_name" : "per_instance");
      expect.soft(game.maxCount ?? 1).toBe(maxCount);
      const turn = normalize(text).match(sameNameTurnPhrase);
      if (turn) {
        const turnLimit = limits.find((limit) => limit.duration === "turn");
        expect.soft(turnLimit?.kind).toBe("per_card_name");
        expect.soft(turnLimit?.maxCount ?? 1).toBe(Number(turn[1]));
      }

      const sourceIds = ["used", "same-name", "opponent"];
      let state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: sourceIds.map((instanceId) =>
          createCardInstance(card, {
            instanceId,
            ownerPlayerId: instanceId === "opponent" ? "bob" : "alice",
            zone: "field",
            normalCoreCount: 2,
          })
        ),
      });
      if (turn) {
        const combined = {
          sourceDefinitionId: card.cardNo,
          effectLabel: path,
          usageLimit: limits,
          groupId,
        };
        const used = recordEffectUsageIfLimited({
          ...combined,
          state,
          sourceInstanceId: "used",
        });
        expect(
          canUseEffectByUsageLimit({
            ...combined,
            state: used,
            sourceInstanceId: "used",
          })
        ).toBe(false);
        expect(
          canUseEffectByUsageLimit({
            ...combined,
            state: used,
            sourceInstanceId: "same-name",
          })
        ).toBe(false);
        expect(
          canUseEffectByUsageLimit({
            ...combined,
            state: used,
            sourceInstanceId: "opponent",
          })
        ).toBe(true);
        const laterTurn = { ...used, turnNumber: used.turnNumber + 2 };
        expect(
          canUseEffectByUsageLimit({
            ...combined,
            state: laterTurn,
            sourceInstanceId: "used",
          })
        ).toBe(false);
        expect(
          canUseEffectByUsageLimit({
            ...combined,
            state: laterTurn,
            sourceInstanceId: "same-name",
          })
        ).toBe(true);
      }
      const context = {
        sourceDefinitionId: card.cardNo,
        effectLabel: path,
        usageLimit: game,
        groupId,
      };
      for (let i = 0; i < maxCount; i++) {
        expect(
          canUseEffectByUsageLimit({
            ...context,
            state,
            sourceInstanceId: "used",
          })
        ).toBe(true);
        state = recordEffectUsageIfLimited({
          ...context,
          state,
          sourceInstanceId: "used",
        });
      }
      expect
        .soft(
          canUseEffectByUsageLimit({
            ...context,
            state,
            sourceInstanceId: "used",
          })
        )
        .toBe(false);
      expect
        .soft(
          canUseEffectByUsageLimit({
            ...context,
            state,
            sourceInstanceId: "same-name",
          })
        )
        .toBe(!shared);
      expect
        .soft(
          canUseEffectByUsageLimit({
            ...context,
            state,
            sourceInstanceId: "opponent",
          })
        )
        .toBe(true);
    }
  );
});
