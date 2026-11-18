import { z } from "zod";
import type { ToolDef } from "./types.js";

export interface LegalActionsResult {
  note: string;
  count: number;
  sampled: unknown[];
}

const LegalActionsSchema = z.object({ snapshot: z.unknown().optional() });

export interface LegalActionsOptions {
  /** セッションに紐付けられた GameSnapshot。引数で snapshot が来なければこちらを使う。 */
  boundSnapshot?: unknown;
}

export function makeLegalActionsTool(
  options: LegalActionsOptions = {}
): ToolDef<typeof LegalActionsSchema, LegalActionsResult> {
  const bound = options.boundSnapshot;
  const hasBound = bound !== undefined;
  return {
    name: "legal_actions",
    description: hasBound
      ? "セッションに紐付いた GameSnapshot から合法アクション一覧を返す。snapshot 引数は省略可。"
      : "現在の GameSnapshot から合法アクション一覧を返す。GUI チャットで盤面を見せたい時は orica-snapshot-*.json を添付するとセッションに紐付き、snapshot 引数なしで使えるようになる。",
    schema: LegalActionsSchema,
    jsonSchema: {
      type: "object",
      properties: {
        snapshot: {
          type: "object",
          description: hasBound
            ? "省略可。指定しなければセッションの紐付き snapshot を使う。"
            : "GameSnapshot オブジェクト",
        },
      },
    },
    execute: async ({ snapshot }) => {
      const snap = snapshot ?? bound;
      if (snap === undefined) {
        throw new Error(
          "snapshot is required: pass an object or attach an orica-snapshot-*.json file (then it auto-binds)."
        );
      }
      const mod = (await import("@orica/rules-core")) as {
        listLegalActions?: (s: unknown) => unknown[];
      };
      const lister = mod.listLegalActions;
      if (typeof lister !== "function") {
        return {
          note: "rules-core does not expose listLegalActions; returning empty.",
          count: 0,
          sampled: [],
        };
      }
      const actions = lister(snap);
      return {
        note: "Truncated to first 20 entries.",
        count: actions.length,
        sampled: actions.slice(0, 20),
      };
    },
  };
}
