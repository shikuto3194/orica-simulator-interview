import type { CardDefinition } from "@orica/rules-core";

export const BSSG02_CARDS: CardDefinition[] = [
  {
    cardNo: "BSSG02-C01",
    orikaId: 374,
    orikaIndex: 391,
    name: "マリア・カデンツァヴナ・イヴ",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 3000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "待機状態を含まない自分の「マリア・カデンツァヴナ・イヴ」は、フィールドに1体しか存在できない。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個を自分のリザーブに置ける。さらに、〔ターンに1回：同名〕自分のデッキを上から3枚オープンできる。その中の系統：「装者」を持つカード1枚を手札に加える。残ったカードはデッキの下に戻す。",
      "",
      "Lv1-Lv2",
      "このスピリットは、相手の効果を受けず、アタック/ブロックできない。",
      "",
      "【聖詠】Lv1-Lv2『お互いのアタックステップ開始時』",
      "このスピリットを自分の手札にあるコスト4/5の「マリア・カデンツァヴナ・イヴ」と回復状態で入れ替えられる。",
    ],
    keywordTags: [],
    tribe: "制服・装者",
    image: "images/BSSG02-C01.webp",
    rarity: "C",
    pack: "BSSG02 戦姫絶唱シンフォギア-追加パック-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 待機状態を含まない自分の「マリア・カデンツァヴナ・イヴ」は1体しか存在できない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "field_name_uniqueness",
              names: "self",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0],
      },
      // [3] 召喚時: ボイド→自分のリザーブにコア1個。さらに〔ターン1回:同名〕デッキ3オープン→装者1枚を手札、残りデッキ下。
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "reserve",
                player: "self",
              },
              amount: 1,
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    tribes: ["装者"],
                  },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
            usageLimit: {
              kind: "per_card_name",
              duration: "turn",
            },
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [3],
      },
      // [6] このスピリットは相手の効果を受けず、アタック/ブロックできない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "while_on_field" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
      // [8] 聖詠: アタックステップ開始時、手札のコスト4/5「マリア・カデンツァヴナ・イヴ」と入れ替えられる。
      {
        timing: {
          kind: "phase",
          step: "attack",
          subPhase: "start",
          whose: "either",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "queue_field_hand_swap",
              effectScope: "shouei",
              incomingFilter: {
                category: ["spirit"],
                cardName: "self",
                minCost: 4,
                maxCost: 5,
              },
              enterRecovered: true,
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
];
