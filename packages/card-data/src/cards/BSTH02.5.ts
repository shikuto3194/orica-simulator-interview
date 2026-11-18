import type { CardDefinition } from "@orica/rules-core";

export const BSTH02_5_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH02.5-X01",
    orikaId: 96,
    orikaIndex: 89,
    name: "伊吹 萃香",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 9000,
      },
      {
        level: 3,
        requiredCores: 5,
        bp: 13000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "このカード/スピリットは、系統：「地霊」を持ち、2コスト以上支払わなければ召喚できない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "ボイドからコア1個ずつを系統：「遊精」/「皇獣」を持つ自分のスピリットすべてに置ける。",
      "",
      "Lv2-Lv3【三歩壊廃】『このスピリットのアタック時』",
      "ゲーム中に1回、相手のスピリット/アルティメット/ネクサス/創界神ネクサス3つを破壊する。",
      "",
      "Lv3『このスピリットのアタック時』",
      "このスピリットは、ブロックされない。",
    ],
    keywordTags: [],
    tribe: "幻想・遊精・皇獣・地霊",
    image: "images/BSTH02.5-X01.webp",
    rarity: "X",
    pack: "BSTH02.5 東方萃夢想",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 系統「地霊」追加は printedTribe ("幻想・遊精・皇獣・地霊") に既に含まれるため
      // 追加配線不要 (override_properties.addTribes は noop となる)。
      // 「2コスト以上支払わなければ召喚できない」= コスト軽減下限 floor:2。
      // BSTH06-X03 effects[0] 同型。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { floor: 2 },
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_distribute",
              from: { kind: "void", player: "self" },
              to: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["遊精", "皇獣"],
                },
                count: "all",
              },
              amount: 99,
              mode: "one_each",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv2-Lv3【三歩壊廃】『アタック時』ゲーム中1回、相手のスピリット/アルティメット/ネクサス/
      // 創界神ネクサス3つを破壊する。「創界神ネクサス」を含むため targetsGrandwalker:true。
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        usageLimit: {
          kind: "per_instance",
          duration: "game",
        },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate", "nexus"],
                  targetsGrandwalker: true,
                },
                count: 3,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
        steps: [
          {
            action: {
              kind: "unblockable",
              target: { kind: "self" },
              duration: {
                scope: "battle",
              },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
];
