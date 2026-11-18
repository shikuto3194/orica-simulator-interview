import type { CardDefinition } from "@orica/rules-core";
import { ALL_CARDS } from "@orica/card-data";
import { z } from "zod";
import type { ToolDef } from "./types.js";

export interface CardLookupOptions {
  cards?: CardDefinition[];
}

const CardLookupSchema = z.object({ cardNo: z.string() });

export function makeLookupCardTool(
  options: CardLookupOptions = {}
): ToolDef<typeof CardLookupSchema, CardDefinition | null> {
  const cards = options.cards ?? ALL_CARDS;
  return {
    name: "lookup_card",
    description:
      "カード番号 (例: BSTH01-C01) からカード定義を取得する。存在しなければ null。",
    schema: CardLookupSchema,
    jsonSchema: {
      type: "object",
      required: ["cardNo"],
      properties: {
        cardNo: { type: "string", description: "カード番号 (BSTH01-C01 など)" },
      },
    },
    execute: ({ cardNo }) => cards.find((c) => c.cardNo === cardNo) ?? null,
  };
}

const CardFilterSchema = z
  .object({
    pack: z.string().optional(),
    tribe: z.string().optional(),
    color: z.string().optional(),
    printedCategory: z.string().optional(),
    limit: z.number().int().positive().max(20).optional(),
  })
  .strict();

export function makeFilterCardsTool(
  options: CardLookupOptions = {}
): ToolDef<typeof CardFilterSchema, CardDefinition[]> {
  const cards = options.cards ?? ALL_CARDS;
  return {
    name: "filter_cards",
    description:
      "パック / 系統 / 色 / 種別でカードを絞り込む。返却件数は最大 20 件 (limit で更に制限可)。",
    schema: CardFilterSchema,
    jsonSchema: {
      type: "object",
      properties: {
        pack: { type: "string", description: "パック名の部分一致" },
        tribe: { type: "string", description: "系統 (例: 楽族)" },
        color: {
          type: "string",
          enum: ["red", "blue", "green", "yellow", "purple", "white", "black"],
        },
        printedCategory: {
          type: "string",
          enum: ["spirit", "magic", "brave", "nexus", "ultimate"],
        },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
    execute: (args) => {
      const filtered = cards.filter((c) => {
        if (args.pack && !(c.pack ?? "").includes(args.pack)) return false;
        if (args.tribe && !(c.tribe ?? "").includes(args.tribe)) return false;
        if (args.color && !c.colors.includes(args.color as never)) return false;
        if (
          args.printedCategory &&
          c.printedCategory !== args.printedCategory
        ) {
          return false;
        }
        return true;
      });
      const cap = Math.min(args.limit ?? 20, 20);
      return filtered.slice(0, cap);
    },
  };
}
