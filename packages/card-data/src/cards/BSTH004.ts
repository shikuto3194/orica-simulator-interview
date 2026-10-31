import type { CardDefinition } from "@orica/rules-core";

export const BSTH004_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH004-X03",
    orikaId: 53,
    orikaIndex: 43,
    name: "幻月",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 8,
    reductionSymbols: ["red", "red", "red", "red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 16000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 24000,
      },
    ],
    symbolColors: ["red", "red"],
    textLines: [
      "【転召：3／幻想＆コスト6以上／ボイド】",
      "召喚コスト支払い後、対象の自分のスピリット1体の上のコアすべて（最低3個）をボイドに置かなければならない。",
      "",
      "Lv1-Lv2-Lv3",
      "自分の「夢月」がいるとき、このスピリットは相手の効果を受けない。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "自分の創界神ネクサス/導界者ネクサスがなければ、相手の転醒ネクサス/創界神ネクサス1つを破壊する。この効果で相手は転醒できない。さらに、自分のカウント0のとき、このスピリットは回復する。",
    ],
    keywordTags: [],
    tribe: "幻想・夜族",
    image: "images/BSTH004-X03.webp",
    rarity: "X",
    pack: "BSTH004 東方幻想郷",
    maxDeckCount: 0,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【転召：3／幻想＆コスト6以上／ボイド】召喚コスト支払い後、対象スピのコア全（最低3個）をボイドへ。
    // 召喚時効果ではなく召喚手順内ステップ（裁定 2026-06-14, 10_rules/07b）。対象不在なら召喚宣言不可。
    tenshoSummon: {
      targetFilter: {
        category: ["spirit"],
        tribesRequired: ["幻想"],
        minCost: 6,
      },
      minCores: 3,
      destination: "void",
    },
    effects: [
      // Lv1-Lv2-Lv3 自分の「夢月」がいるとき、相手の効果を受けない。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "夢月" }],
          },
        ],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3『アタック時』創界神/導界者ネクサスがなければ、相手の転醒ネクサス/創界神ネクサス1つ破壊。
      // 対象は「転醒ネクサス」(hasMechanic:rebirth) OR 「創界神ネクサス」(targetsGrandwalker) の
      // いずれか (filterOr)。相手の転醒だけを現在の効果中に禁止し、その他の離脱誘発は残す。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            condition: [
              { kind: "field_lacks", player: "self", grandwalkerKind: "any" },
            ],
            action: {
              kind: "restrict_manifest",
              player: "opponent",
              filter: {},
              effectFilter: { containsActionKinds: ["rebirth"] },
              duration: { scope: "current_effect" },
            },
          },
          {
            condition: [
              { kind: "field_lacks", player: "self", grandwalkerKind: "any" },
            ],
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["nexus"], hasMechanic: ["rebirth"] },
                    { category: ["nexus"], targetsGrandwalker: "only" },
                  ],
                },
                count: 1,
              },
            },
          },
          {
            connector: "simultaneous",
            condition: [{ kind: "count_value", player: "self", max: 0 }],
            action: { kind: "recover", target: { kind: "self" } },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
];
