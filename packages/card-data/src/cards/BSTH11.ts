import type { CardDefinition, EffectStep } from "@orica/rules-core";

const X02_LV123_STEPS: EffectStep[] = [
  {
    id: "x02-core-distribute",
    executionMode: "optional",
    action: {
      kind: "core_distribute",
      from: { kind: "void", player: "self" },
      to: {
        kind: "filter",
        player: "self",
        filter: {
          category: ["nexus"],
          colors: ["green"],
          targetsGrandwalker: "only",
          grandwalkerKind: "any",
        },
        count: "all",
      },
      amount: 2,
      mode: "player_choice",
    },
  },
  {
    targetSelectionTiming: "on_step",
    id: "x02-exile-opponent-trash",
    connector: "sequential",
    action: {
      kind: "search_zone",
      player: "opponent",
      zone: "trash",
      filter: {},
      count: {
        min: 0,
        max: {
          source: { kind: "cards_in_zone", zone: "trash", player: "opponent" },
        },
      },
      destination: "removed_from_game",
    },
  },
  {
    targetSelectionTiming: "on_step",
    connector: "sequential",
    action: {
      kind: "search_zone",
      player: "self",
      zone: "trash",
      filter: {},
      count: {
        source: {
          kind: "cards_from_ref",
          stepId: "x02-exile-opponent-trash",
        },
      },
      destination: "deck",
      destinationPosition: "bottom",
      mandatory: true,
    },
  },
  {
    connector: "sequential",
    executionMode: "optional",
    action: {
      kind: "deck_reveal",
      revealCount: 2,
      picks: [
        {
          count: 1,
          filter: {
            category: ["spirit", "ultimate", "brave", "nexus"],
            tribes: ["天璋", "秘神"],
            maxCost: 7,
          },
          destination: "field",
        },
      ],
      remainder: "bottom",
    },
  },
];

export const BSTH11_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH11-C01",
    orikaId: 569,
    orikaIndex: 267,
    name: "[溶けない炎天下の氷精]チルノ",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["green"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 5000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。",
      "",
      "Lv1-2『このスピリットの召喚/アタック時』",
      "ゲーム中に1回、ボイドからコア1個を自分のスピリットに置くことができ、自分のデッキを上から3枚オープンできる。その中の系統：「秘神」を持つ創界神ネクサスカード1枚と、系統：「天璋」を持つカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-2：フラッシュ",
      "〔ターンに1回：同名〕系統：「幻想」を持つコスト3/4以外の自分のスピリット1体を手札/手元に戻せる。",
    ],
    keywordTags: [],
    tribe: "幻想・天璋・妖精",
    image: "images/BSTH11-C01.webp",
    rarity: "C",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self", zone: ["hand", "set_aside"] },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "game" },
        steps: [
          {
            id: "c01-void-core",
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: { category: ["spirit"] },
              },
              amount: 1,
            },
          },
          {
            connector: "simultaneous",
            executionMode: "optional",
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    category: ["nexus"],
                    tribes: ["秘神"],
                    targetsGrandwalker: true,
                    hasMechanic: ["grandwalker"],
                  },
                },
                { count: 1, mandatory: true, filter: { tribes: ["天璋"] } },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["幻想"],
                  excludeCosts: [3, 4],
                },
                count: 1,
              },
              destination: "hand",
            },
            choice: [
              {
                action: {
                  kind: "bounce",
                  target: {
                    kind: "filter",
                    player: "self",
                    filter: {
                      category: ["spirit"],
                      tribes: ["幻想"],
                      excludeCosts: [3, 4],
                    },
                    count: 1,
                  },
                  destination: "set_aside",
                },
              },
            ],
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH11-C02",
    orikaId: 570,
    orikaIndex: 268,
    name: "[紅葉を散らす天狗]射命丸文 文",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["green"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 5000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。",
      "",
      "Lv1-2『このスピリットの召喚/ブロック時』",
      "ゲーム中に1回、ボイドからコア1個を自分のスピリットに置くことができ、自分のデッキを上から3枚オープンできる。その中の系統：「秘神」を持つ創界神ネクサスカード1枚と、系統：「天璋」を持つカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-2：フラッシュ",
      "〔ターンに1回：同名〕系統：「幻想」を持つコスト3/4以外の自分のスピリット1体を手札/手元に戻せる。",
    ],
    keywordTags: [],
    tribe: "幻想・天璋・爪鳥",
    image: "images/BSTH11-C02.webp",
    rarity: "C",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self", zone: ["hand", "set_aside"] },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "card_event", event: ["summon", "block"] },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "game" },
        steps: [
          {
            id: "c02-void-core",
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: { category: ["spirit"] },
              },
              amount: 1,
            },
          },
          {
            connector: "simultaneous",
            executionMode: "optional",
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    category: ["nexus"],
                    tribes: ["秘神"],
                    targetsGrandwalker: true,
                    hasMechanic: ["grandwalker"],
                  },
                },
                { count: 1, mandatory: true, filter: { tribes: ["天璋"] } },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["幻想"],
                  excludeCosts: [3, 4],
                },
                count: 1,
              },
              destination: "hand",
            },
            choice: [
              {
                action: {
                  kind: "bounce",
                  target: {
                    kind: "filter",
                    player: "self",
                    filter: {
                      category: ["spirit"],
                      tribes: ["幻想"],
                      excludeCosts: [3, 4],
                    },
                    count: 1,
                  },
                  destination: "set_aside",
                },
              },
            ],
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH11-C03",
    orikaId: 571,
    orikaIndex: 269,
    name: "[天空章]リリーホワイト",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green", "green", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 6000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 8000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。",
      "",
      "Lv1-2-3『このスピリットの召喚時』",
      "ボイドからコア1個を系統：「幻想」を持つ自分のスピリットに置ける。さらに、〔ターンに1回：同名〕自分が契約していなければ、自分のデッキを上から4枚オープンできる。その中の系統：「幻想」/「秘神」を持つ緑のカード2枚を手札に加える。残ったカードはデッキの下に戻す。",
      "",
      "Lv1-2-3：スタック『相手のメインステップ』",
      "〔ターンに1回：同名〕相手が契約していれば、相手の契約カード以外のネクサスカード1枚の配置を無効にする。",
    ],
    keywordTags: [],
    tribe: "幻想・天璋・妖精",
    image: "images/BSTH11-C03.webp",
    rarity: "C",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self", zone: ["hand", "set_aside"] },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            id: "c03-void-core",
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: { category: ["spirit"], tribes: ["幻想"] },
              },
              amount: 1,
            },
          },
          {
            connector: "simultaneous",
            executionMode: "optional",
            condition: [{ kind: "no_contract_card" }],
            usageLimit: {
              kind: "per_card_name",
              duration: "turn",
              maxCount: 1,
            },
            action: {
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  count: 2,
                  mandatory: true,
                  filter: { tribes: ["幻想", "秘神"], colors: ["green"] },
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "opponent", period: "main" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        condition: [
          { kind: "no_contract_card", player: "opponent", negate: true },
        ],
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "place",
              targetFilter: { category: ["nexus"], isContract: false },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH11-C04",
    orikaId: 572,
    orikaIndex: 270,
    name: "後符「絶対秘神の後光」",
    printedCategory: "magic",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、スタック効果を使用するとき、軽減シンボル<神>1つを追加する。",
      "",
      "フラッシュ",
      "相手のスピリット/アルティメット2体を重疲労させる。",
      "",
      "スタック",
      "〔相手のターン〕〔ターンに1回：同名〕自分が契約していなければ、相手のスピリット/アルティメット/ネクサス1つを重疲労させる。この効果で疲労した対象は、このターン終了時、疲労状態になる。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH11-C04.webp",
    rarity: "C",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "god",
              whenUsingEffectMode: "stack",
              addsReductionSymbol: true,
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 2,
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "opponent", period: "turn" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        condition: [{ kind: "no_contract_card" }],
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate", "nexus"] },
                count: 1,
              },
              degree: "heavy_exhaust",
              downgradeAtTurnEnd: true,
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH11-C05",
    orikaId: 573,
    orikaIndex: 271,
    name: "バックドア",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["seven", "seven"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
      },
      {
        level: 2,
        requiredCores: 2,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ/スタック",
      "手札/手元にあるこのカードは配置できる。",
      "",
      "Lv1-2",
      "〔重複不可〕系統:「幻想」を持つ自分のスピリット/アルティメットすべてをBP+3000する。",
      "",
      "Lv2",
      "〔重複不可〕系統:「幻想」を持つ自分のスピリット/アルティメットすべてをBP+4000する。",
    ],
    keywordTags: [],
    tribe: "幻想・天璋",
    image: "images/BSTH11-C05.webp",
    rarity: "C",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { zone: ["hand", "set_aside"] },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "activated", mode: "stack" },
        applicability: { zone: ["hand", "set_aside"] },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "continuous" },
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit", "ultimate"],
                  tribes: ["幻想"],
                },
                count: "all",
              },
              amount: 3000,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "continuous" },
        usageLimit: { kind: "no_duplicate" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit", "ultimate"],
                  tribes: ["幻想"],
                },
                count: "all",
              },
              amount: 4000,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH11-M01",
    orikaId: 574,
    orikaIndex: 272,
    name: "矢田寺 成美",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "green", "green", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 9000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 12000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。このとき、手札/手元にある系統:「天璋」/「秘神」を持つカード1枚を除外することで、このカードの軽減シンボルすべてを満たす。",
      "",
      "Lv1-2-3『このスピリットの召喚時』",
      "ボイドからコア2個を系統：「天璋」を持つ自分のスピリットに置ける。その後、〔ターンに1回：同名〕手札/手元にある系統：「天璋」を持つコスト7以下のカード1枚を1コスト支払って召喚できる。",
      "",
      "Lv1-2-3",
      "系統：「天璋」を持つ自分のスピリットすべてのLvを1つ上のものとして扱う。",
    ],
    keywordTags: [],
    tribe: "幻想・天璋・造兵",
    image: "images/BSTH11-M01.webp",
    rarity: "M",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self", zone: ["hand", "set_aside"] },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "card_event", event: ["summon"] },
        executionMode: "optional",
        steps: [
          {
            id: "m01-void-core",
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: { category: ["spirit"], tribes: ["天璋"] },
              },
              amount: 2,
            },
          },
          {
            connector: "sequential",
            executionMode: "optional",
            usageLimit: { kind: "per_card_name", duration: "turn" },
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "set_aside"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  tribes: ["天璋"],
                  maxCost: 7,
                },
                count: 1,
              },
              costModifier: { fixedPayment: 1 },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], tribes: ["天璋"] },
                count: "all",
              },
              properties: { level: { delta: 1 } },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { additionalCostValue: 0 },
              useCostPayment: {
                kind: "exclude",
                sourceZone: "hand_or_set_aside",
                maxCount: 1,
                filter: { tribes: ["天璋", "秘神"] },
                fullReduction: true,
                effectSummonEffectIndex: 0,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
    ],
  },
  {
    cardNo: "BSTH11-R01",
    orikaId: 575,
    orikaIndex: 273,
    name: "エタニティ・ラルバ",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green", "green"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 6000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 9000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。",
      "",
      "Lv1-2-3『このスピリットの召喚/アタック/ブロック時』",
      "ボイドからコア1個を自分のスピリットに置ける。さらに、自分が契約していなければ、相手のスピリット/ネクサス1つを重疲労できる。",
      "",
      "Lv2-3",
      "このスピリットのコストは5として扱う。",
      "",
      "Lv3『このスピリットのアタック/ブロック時』",
      "相手のトラッシュにあるカード2枚を除外できる。そうしたとき、ターンに1回、自分が契約していなければ、このスピリットは回復できる。",
    ],
    keywordTags: [],
    tribe: "幻想・天璋・妖精",
    image: "images/BSTH11-R01.webp",
    rarity: "R",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self", zone: ["hand", "set_aside"] },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "card_event", event: ["summon", "attack", "block"] },
        executionMode: "optional",
        steps: [
          {
            id: "r01-void-core",
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: { category: ["spirit"] },
              },
              amount: 1,
            },
          },
          {
            connector: "simultaneous",
            executionMode: "optional",
            condition: [{ kind: "no_contract_card" }],
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "nexus"] },
                count: 1,
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { cost: 5 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        condition: [{ kind: "min_level", value: 3 }],
        executionMode: "optional",
        steps: [
          {
            id: "r01-exile-opponent-trash",
            action: {
              kind: "search_zone",
              zone: "trash",
              player: "opponent",
              filter: {},
              count: 2,
              destination: "removed_from_game",
              mandatory: true,
            },
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "r01-exile-opponent-trash",
              min: 2,
            },
            condition: [{ kind: "no_contract_card" }],
            executionMode: "optional",
            usageLimit: { kind: "per_instance", duration: "turn" },
            action: { kind: "recover", target: { kind: "self" } },
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSTH11-R02",
    orikaId: 576,
    orikaIndex: 274,
    name: "坂田 ネムノ",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 5,
    reductionSymbols: ["green", "green", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 7000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 9000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。",
      "",
      "Lv1-2-3『このスピリットの召喚時』",
      "自分が契約していなければ、ボイドからコア2個を系統：「天璋」を持つ自分のスピリットに置ける。",
      "",
      "Lv2-3『相手のアタックステップ』",
      "自分が契約していなければ、重疲労状態の相手のスピリット/アルティメットすべてのシンボルを0に固定し、対象のシンボルはこの効果以外の効果を受けない。",
    ],
    keywordTags: [],
    tribe: "幻想・天璋・山姥",
    image: "images/BSTH11-R02.webp",
    rarity: "R",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self", zone: ["hand", "set_aside"] },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        condition: [{ kind: "no_contract_card" }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: { category: ["spirit"], tribes: ["天璋"] },
              },
              amount: 2,
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "continuous" },
        timingScope: { player: "opponent", period: "attack" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "no_contract_card" },
        ],
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  exhaustState: "heavily_exhausted",
                },
                count: "all",
              },
              properties: { symbols: [], symbolCountFixed: true },
              duration: { scope: "while_on_field" },
            },
          },
          {
            connector: "sequential",
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  exhaustState: "heavily_exhausted",
                },
                count: "all",
              },
              duration: { scope: "while_on_field" },
              sourceScope: {
                restrictedAspects: ["symbols"],
                excludeSelf: true,
              },
              sourcePlayerScope: "any",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH11-R03",
    orikaId: 577,
    orikaIndex: 275,
    name: "高麗野 あうん",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 5,
    reductionSymbols: ["green", "green", "god", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 8000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 10000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。",
      "",
      "Lv1-2-3『このスピリットの召喚時』",
      "〔ターンに1回：同名〕ボイドからコアを系統：「幻想」/「秘神」/「博麗」/「風神」/「アシハラ」/「神渡」を持つ自分のスピリット/アルティメット/創界神ネクサスに各系統1個ずつまで置ける。その後、自分が契約していなければ、自分のトラッシュのコア3個をボイドに置くことで、自分はデッキの上から2枚ドローする。",
      "",
      "Lv2-3『このスピリットのアタック/ブロック時』",
      "自分が契約していなければ、相手のスピリット/アルティメット1体を重疲労できる。",
    ],
    keywordTags: [],
    tribe: "幻想・天璋・剣獣",
    image: "images/BSTH11-R03.webp",
    rarity: "R",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self", zone: ["hand", "set_aside"] },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "card_event", event: "summon" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        executionMode: "optional",
        steps: [
          {
            id: "r03-tribe-core-placement",
            executionMode: "optional",
            action: {
              kind: "core_distribute",
              from: { kind: "void", player: "self" },
              to: {
                kind: "filter",
                player: "self",
                count: "all",
                filter: {
                  filterOr: [
                    {
                      category: ["spirit", "ultimate"],
                      tribes: [
                        "幻想",
                        "秘神",
                        "博麗",
                        "風神",
                        "アシハラ",
                        "神渡",
                      ],
                    },
                    {
                      category: ["nexus"],
                      tribes: [
                        "幻想",
                        "秘神",
                        "博麗",
                        "風神",
                        "アシハラ",
                        "神渡",
                      ],
                      targetsGrandwalker: "only",
                      grandwalkerKind: "grandwalker",
                    },
                  ],
                },
              },
              amount: 6,
              mode: "player_choice",
              maxPerCandidate: 1,
              allocationGroups: [
                {
                  filter: { tribes: ["幻想"], targetsGrandwalker: true },
                  maxCount: 1,
                },
                {
                  filter: { tribes: ["秘神"], targetsGrandwalker: true },
                  maxCount: 1,
                },
                {
                  filter: { tribes: ["博麗"], targetsGrandwalker: true },
                  maxCount: 1,
                },
                {
                  filter: { tribes: ["風神"], targetsGrandwalker: true },
                  maxCount: 1,
                },
                {
                  filter: { tribes: ["アシハラ"], targetsGrandwalker: true },
                  maxCount: 1,
                },
                {
                  filter: { tribes: ["神渡"], targetsGrandwalker: true },
                  maxCount: 1,
                },
              ],
            },
          },
          {
            id: "r03-trash-to-void",
            connector: "sequential",
            executionMode: "optional",
            condition: [{ kind: "no_contract_card" }],
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "void", player: "self" },
              amount: 3,
              requireFullCount: true,
            },
          },
          {
            action: { kind: "draw", count: 2 },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "no_contract_card" },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH11-X01",
    orikaId: 578,
    orikaIndex: 276,
    name: "[創界神]摩多羅 隠岐奈",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 2,
    reductionSymbols: ["green"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
      },
      {
        level: 2,
        requiredCores: 2,
      },
    ],
    symbolColors: ["green", "god"],
    symbolColorEntries: [["green", "god"]],
    textLines: [
      "【神託：天璋】",
      "◆対象の自分のスピリットを召喚/煌臨したとき、このネクサスにコア+1できる。",
      "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につき、このネクサスにコア+1する。",
      "",
      "自分の効果でトラッシュに置かれたこのカードは手元に置ける。",
      "",
      "フラッシュ",
      "手札/手元にあるこのカードは配置できる。",
      "",
      "【神域】Lv1-2",
      "自分のフィールドに系統：「幻想」/「秘神」を持たないカードがない間、相手のバースト効果を無効にし、煌臨元を含む契約カードとその煌臨先以外の重疲労状態の相手のスピリット/アルティメット/ネクサスは回復できず、その効果は発揮されない。",
      "",
      "【神技：2～6】Lv2：フラッシュ/スタック",
      "〔このネクサスのコアを-2~-6する〕減らしたコア2個につき、系統：「天璋」/「秘神」を持つコスト3/4以外の自分のスピリット/創界神ネクサス1つを手札/手元に戻せる。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    tribe: "創界神・幻想・秘神",
    image: "images/BSTH11-X01.webp",
    rarity: "X",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    grandwalkerData: {
      kind: "grandwalker",
      oracleConditions: [{ tribes: ["天璋"], categories: ["spirit"] }],
      oracleTriggerKinds: ["summon", "advent"],
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: { min: 2, max: 6 },
          timing: "flash_or_stack",
          minLevel: 2,
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  targetSelectionTiming: "on_step",
                  action: {
                    kind: "bounce",
                    target: {
                      kind: "filter",
                      player: "self",
                      filter: {
                        filterOr: [
                          {
                            category: ["spirit"],
                            tribes: ["天璋", "秘神"],
                            excludeCosts: [3, 4],
                          },
                          {
                            category: ["nexus"],
                            tribes: ["天璋", "秘神"],
                            targetsGrandwalker: "only",
                            excludeCosts: [3, 4],
                          },
                        ],
                      },
                      count: {
                        min: 0,
                        max: {
                          source: { kind: "cost_paid_this_effect" },
                          divisor: 2,
                        },
                      },
                    },
                    destination: "hand_or_set_aside_choice",
                  },
                },
              ],
              textRef: [12, 13],
            },
          ],
        },
      ],
    },
    effects: [
      {
        timing: { kind: "card_event", event: ["moved_to_trash"] },
        cardEventDisposition: { kind: "move", destination: "set_aside" },
        condition: [{ kind: "trigger_source_player", player: "self" }],
        steps: [{ action: { kind: "move_self", destination: "set_aside" } }],
        executionMode: "optional",
        textRef: [4],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { zone: ["hand", "set_aside"] },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [6, 7],
      },
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_all_match",
            player: "self",
            filter: { tribes: ["幻想", "秘神"] },
          },
        ],
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "opponent_burst",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [9, 10],
      },
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_all_match",
            player: "self",
            filter: { tribes: ["幻想", "秘神"] },
          },
        ],
        steps: [
          {
            action: {
              kind: "restrict_recovery",
              player: "opponent",
              filter: {
                category: ["spirit", "ultimate", "nexus"],
                exhaustState: "heavily_exhausted",
                exclude: {
                  filterOr: [
                    { isContract: true },
                    { isContractAdventDestination: true },
                  ],
                },
              },
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate", "nexus"],
                  exhaustState: "heavily_exhausted",
                  exclude: {
                    filterOr: [
                      { isContract: true },
                      { isContractAdventDestination: true },
                    ],
                  },
                },
                count: "all",
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSTH11-X02",
    orikaId: 579,
    orikaIndex: 277,
    name: "摩多羅 隠岐奈",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 9,
    reductionSymbols: ["green", "green", "green", "green", "god", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 17000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 22000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ【現界：「秘神」＆創界神ネクサス『お互いのアタックステップ』】",
      "自分の対象があるとき、自分の≪ソウルコア≫をトラッシュに置くことで、手札から出す。",
      "",
      "Lv1-2-3『このスピリットの現界/アタック/ブロック時』",
      "自分の緑の創界神ネクサス/導界者ネクサスにコア合計+2できる。その後、相手のトラッシュにあるカードを好きなだけ除外できる。除外したカード1枚につき、自分のトラッシュにあるカード1枚をデッキの下に戻す。その後、自分のデッキを上から2枚オープンできる。その中の系統：「天璋」/「秘神」を持つコスト7以下のカード1枚をコストを支払わずに召喚/配置できる。残ったカードはデッキの下に戻す。",
      "",
      "Lv2-3『このスピリットのアタック/ブロック時』",
      "相手のスピリット/アルティメット/ネクサス/創界神ネクサス2つを重疲労できる。",
    ],
    keywordTags: [],
    tribe: "幻想・天璋・秘神",
    image: "images/BSTH11-X02.webp",
    rarity: "X",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        applicability: { zone: "hand" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["nexus"],
            grandwalkerKind: "grandwalker",
            tribes: ["秘神"],
          },
        ],
        executionMode: "optional",
        steps: [
          {
            id: "x02-genkai-soul-core-cost",
            action: {
              kind: "core_move",
              from: {
                kind: "union",
                sources: [
                  { kind: "field", player: "self", includeReserve: true },
                  { kind: "life", player: "self" },
                ],
              },
              to: { kind: "trash", player: "self" },
              amount: 1,
              effectKind: "explicit_soul_core",
              requireFullCount: true,
            },
          },
          {
            connector: "conditional_cost",
            action: {
              kind: "put",
              target: { kind: "self" },
              costModifier: "free",
              effectScope: "genkai",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "card_event",
          event: "put",
          effectScope: "genkai",
        },
        executionMode: "optional",
        steps: X02_LV123_STEPS,
        textRef: [3, 4],
      },
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        executionMode: "optional",
        steps: X02_LV123_STEPS,
        textRef: [3, 4],
      },
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate", "nexus"],
                  targetsGrandwalker: true,
                },
                count: 2,
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH11-X03",
    orikaId: 580,
    orikaIndex: 278,
    name: "丁礼田 舞",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 7,
    reductionSymbols: ["green", "green", "green"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 10000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 14000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは、自分が契約しておらず、自分のフィールドに系統：「幻想」/「秘神」を持たないカードか緑以外のカードがなれば、軽減シンボルすべてを満たして召喚できる。",
      "",
      "Lv1-2-3『このスピリットの召喚/アタック時』",
      "このバトルの間、系統：「天璋」/「秘神」を持つ効果は相手の効果では防げない。その後、自分の手札/手元にある系統：「天璋」/「秘神」を持つカード2枚をデッキの下に戻すか、自分の創界神ネクサスの「隠岐奈」のコア-4することで、相手のスピリット/アルティメット/ネクサス/創界神ネクサス2つまでを重疲労させる。",
    ],
    keywordTags: [],
    tribe: "幻想・天璋・童子",
    image: "images/BSTH11-X03.webp",
    rarity: "X",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        condition: [
          { kind: "no_contract_card", player: "self" },
          {
            kind: "field_all_match",
            player: "self",
            filter: { tribes: ["幻想", "秘神"], colors: ["green"] },
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "full_reduction",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        steps: [
          {
            action: {
              kind: "grant_effect_source_prevention_immunity",
              player: "self",
              sourceScope: { tribes: ["天璋", "秘神"] },
              duration: { scope: "battle" },
            },
          },
          {
            targetSelectionTiming: "on_step",
            connector: "sequential",
            executionMode: "optional",
            action: {
              kind: "move_card",
              from: {
                zone: ["hand", "set_aside"],
                player: "self",
                filter: { tribes: ["天璋", "秘神"] },
              },
              to: { zone: "deck", player: "self", position: "bottom" },
              count: 2,
              requireFullCount: true,
            },
            choice: [
              {
                action: {
                  kind: "core_move",
                  from: {
                    kind: "field_card",
                    player: "self",
                    filter: {
                      category: ["nexus"],
                      cardName: { contains: "隠岐奈" },
                      targetsGrandwalker: "only",
                    },
                  },
                  to: { kind: "void", player: "self" },
                  amount: 4,
                  requireFullCount: true,
                },
              },
            ],
          },
          {
            targetSelectionTiming: "on_step",
            connector: "conditional_cost",
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate", "nexus"],
                  targetsGrandwalker: true,
                },
                count: { min: 0, max: 2 },
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH11-X04",
    orikaId: 581,
    orikaIndex: 279,
    name: "爾子田 里乃",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 7,
    reductionSymbols: ["green", "green", "green", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 10000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 14000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは、自分が契約しておらず、自分のフィールドに系統：「幻想」/「秘神」を持たないカードか緑以外のカードがなれば、軽減シンボルすべてを満たして召喚できる。",
      "",
      "Lv1-2-3『このスピリットの召喚/アタック/ブロック時』",
      "相手のスピリット/アルティメット/ネクサス1つを重疲労させる。さらに、〔ターンに1回：同名〕ボイドからコア3個を自分のスピリットに置ける。",
      "",
      "Lv2-3：フラッシュ『お互いのアタックステップ』",
      "2コスト支払うことで、系統：「天璋」/「秘神」を持つ自分のスピリット/創界神ネクサス1つを回復させる。",
    ],
    keywordTags: [],
    tribe: "幻想・天璋・童子",
    image: "images/BSTH11-X04.webp",
    rarity: "X",
    pack: "BSTH11 東方天空璋",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        condition: [
          { kind: "no_contract_card", player: "self" },
          {
            kind: "field_all_match",
            player: "self",
            filter: { tribes: ["幻想", "秘神"], colors: ["green"] },
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "full_reduction",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "card_event", event: ["summon", "attack", "block"] },
        steps: [
          {
            id: "x04-heavy-exhaust",
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate", "nexus"] },
                count: 1,
              },
              degree: "heavy_exhaust",
            },
          },
          {
            connector: "simultaneous",
            executionMode: "optional",
            usageLimit: { kind: "per_card_name", duration: "turn" },
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: { category: ["spirit"] },
              },
              amount: 3,
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [{ kind: "min_level", value: 2 }],
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [
          { id: "x04-recover-cost", action: { kind: "pay_cost", amount: 2 } },
          {
            connector: "conditional_cost",
            action: {
              kind: "recover",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  filterOr: [
                    { category: ["spirit"], tribes: ["天璋", "秘神"] },
                    {
                      category: ["nexus"],
                      tribes: ["天璋", "秘神"],
                      targetsGrandwalker: "only",
                    },
                  ],
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
];
