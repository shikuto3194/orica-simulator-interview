import { z } from "zod";
import type { ToolDef } from "./types.js";

export interface GameStateInspectResult {
  query: { kind: "field_summary" | "hand_summary" | "raw"; player?: string };
  text: string;
}

const QuerySchema = z.union([
  z.object({
    kind: z.literal("field_summary"),
    player: z.enum(["self", "opponent", "both"]).optional(),
  }),
  z.object({
    kind: z.literal("hand_summary"),
    player: z.enum(["self", "opponent", "both"]).optional(),
  }),
  z.object({ kind: z.literal("raw") }),
]);

const InspectSchema = z.object({
  snapshot: z.unknown().optional(),
  query: QuerySchema,
});

export interface InspectGameStateOptions {
  /** セッションに紐付けられた GameSnapshot。引数で snapshot が来なければこちらを使う。 */
  boundSnapshot?: unknown;
}

export function makeInspectGameStateTool(
  options: InspectGameStateOptions = {}
): ToolDef<typeof InspectSchema, GameStateInspectResult> {
  const bound = options.boundSnapshot;
  const hasBound = bound !== undefined;
  return {
    name: "inspect_game_state",
    description: hasBound
      ? "セッションに紐付いた GameSnapshot (添付 JSON から自動ロード済み) を要約する。snapshot 引数は省略可、query だけ渡せばよい。"
      : "GameSnapshot を受け取り、フィールド / 手札 / 全体を要約する (読み取り専用)。GUI チャットで盤面を見せたい時は orica-snapshot-*.json を添付するとセッションに紐付き、snapshot 引数なしで使えるようになる。",
    schema: InspectSchema,
    jsonSchema: {
      type: "object",
      required: ["query"],
      properties: {
        snapshot: {
          type: "object",
          description: hasBound
            ? "省略可。指定しなければセッションの紐付き snapshot を使う。"
            : "GameSnapshot オブジェクト",
        },
        query: { type: "object" },
      },
    },
    execute: async (args) => {
      const snap = args.snapshot ?? bound;
      if (snap === undefined) {
        throw new Error(
          "snapshot is required: pass an object or attach an orica-snapshot-*.json file (then it auto-binds)."
        );
      }
      return summarize({ snapshot: snap, query: args.query });
    },
  };
}

type InspectArgs = z.infer<typeof InspectSchema>;

function summarize(args: InspectArgs): GameStateInspectResult {
  const { query, snapshot } = args;
  if (query.kind === "raw") {
    return { query: { kind: "raw" }, text: safeStringify(snapshot, 4_000) };
  }
  if (query.kind === "field_summary") {
    return {
      query: {
        kind: "field_summary",
        ...(query.player !== undefined ? { player: query.player } : {}),
      },
      text: pluckPath(snapshot, ["players", "field"], 4_000),
    };
  }
  return {
    query: {
      kind: "hand_summary",
      ...(query.player !== undefined ? { player: query.player } : {}),
    },
    text: pluckPath(snapshot, ["players", "hand"], 4_000),
  };
}

function safeStringify(value: unknown, max: number): string {
  try {
    const s = JSON.stringify(value, null, 2);
    return s.length > max ? s.slice(0, max) + "…(truncated)" : s;
  } catch {
    return "<unserializable>";
  }
}

function pluckPath(value: unknown, hint: string[], max: number): string {
  if (value === null || typeof value !== "object")
    return safeStringify(value, max);
  return safeStringify({ hint, value }, max);
}
