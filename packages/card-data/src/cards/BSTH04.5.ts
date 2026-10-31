import type { CardDefinition } from "@orica/rules-core";

export const BSTH04_5_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH04.5-X01",
    orikaId: 135,
    orikaIndex: 144,
    name: "射命丸 文",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "green", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 10000,
      },
      {
        level: 3,
        requiredCores: 5,
        bp: 14000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "相手のスピリット/アルティメット3体を疲労させる。相手は、この効果を2体以上防げない。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "コア4個以上の自分の緑の導界者ネクサス/創界神ネクサスがある間、相手は手札のフラッシュ効果を使用できない。",
      "",
      "Lv3『このスピリットのアタック時』",
      "バトル終了時、自分の緑の創界神ネクサスのコア2個をボイドに置くことで、このスピリットは回復する。",
    ],
    keywordTags: [],
    tribe: "幻想・風神・天狗",
    image: "images/BSTH04.5-X01.webp",
    rarity: "X",
    pack: "BSTH04.5 東方文花帖",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        steps: [
          {
            action: {
              maxPreventable: 1,
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 3,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timingScope: { player: "self", period: "attack" },
        timing: { kind: "continuous" },
        condition: [
          { kind: "min_level", value: 2 },
          {
            kind: "self_state",
            state: "on_field",
            reference: "self",
            battleState: "attacking",
          },
          {
            kind: "field_has",
            player: "self",
            category: ["nexus"],
            colors: ["green"],
            grandwalkerKind: "any",
            minCores: 4,
          },
        ],
        steps: [
          {
            action: {
              source: "hand",
              kind: "restrict_flash",
              player: "opponent",
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  colors: ["green"],
                  targetsGrandwalker: "only",
                },
              },
              to: { kind: "void", player: "self" },
              amount: 2,
            },
          },
          {
            action: {
              kind: "recover",
              target: {
                kind: "self",
              },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
];
