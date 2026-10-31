import type { CardDefinition } from "@orica/rules-core";

export const BSTH10_5_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH10.5-R21",
    orikaId: 254,
    orikaIndex: 264,
    name: "財禍「ブラックピジョン」",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue", "god"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」を持つ。",
      "",
      "メイン",
      "自分はデッキの上から3枚ドローした後、手札1枚を破棄する。",
      "",
      "スタック",
      "相手のコスト4以下のスピリットカード/ネクサスカード1枚の召喚/配置を無効にする。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH10.5-R21.webp",
    rarity: "R",
    pack: "BSTH10.5 東方憑依花",
    maxDeckCount: 0,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // メイン：3ドロー後、手札1枚を破棄する。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "draw",
              count: 3,
            },
          },
          {
            action: {
              kind: "discard",
              count: 1,
            },
          },
        ],
        textRef: [2, 3],
      },
      // スタック：相手のコスト4以下のスピリット/ネクサスカード1枚の召喚/配置を無効にする。
      {
        timing: { kind: "activated", mode: "stack" },
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "summon",
              targetFilter: { category: ["spirit"], maxCost: 4 },
            },
          },
          {
            action: {
              kind: "negate",
              negateTarget: "place",
              targetFilter: { category: ["nexus"], maxCost: 4 },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH10.5-R22",
    orikaId: 255,
    orikaIndex: 265,
    name: "貧符「超貧乏玉」",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」を持つ。",
      "",
      "メイン",
      "自分はデッキの上から2枚ドローした後、手札1枚を破棄する。",
      "",
      "スタック",
      "相手のスピリットカード/アルティメットカード1枚の召喚を無効にする。この効果は、自分のライフが5以上のとき、使用できない。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH10.5-R22.webp",
    rarity: "R",
    pack: "BSTH10.5 東方憑依花",
    maxDeckCount: 0,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // メイン：2ドロー後、手札1枚を破棄する。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "draw",
              count: 2,
            },
          },
          {
            action: {
              kind: "discard",
              count: 1,
            },
          },
        ],
        textRef: [2, 3],
      },
      // スタック：相手のスピリット/アルティメットカード1枚の召喚を無効にする。ライフ5以上のとき使用不可。
      {
        timing: { kind: "activated", mode: "stack" },
        condition: [{ kind: "life_value", player: "self", max: 4 }],
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "summon",
              targetFilter: { category: ["spirit", "ultimate"] },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH10.5-X01",
    orikaId: 256,
    orikaIndex: 266,
    name: "[創界神]依神 紫苑",
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 2,
    reductionSymbols: ["blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 0,
      },
    ],
    symbolColors: ["god"],
    textLines: [
      "このネクサスは創界神ネクサス対象の効果しか受けない。このネクサスには神託と創界神ネクサス対象の効果でしかコアを置けず、そのコアは創界神ネクサス対象の効果しか受けず移動できない。",
      "",
      "【神託：〔依神＆ネクサス〕〔スタック効果＆マジック〕】",
      "◆対象の自分のネクサス/マジックを配置/使用したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、青としても扱う。",
      "",
      "【導域】Lv1-Lv2",
      "自分の青のマジックカードの使用コストは、このネクサスからボイドに支払うこともできる。",
      "",
      "【導域】Lv2",
      "自分の青のマジックカードのスタック効果が発揮されたとき、相手のデッキを上から4枚破棄し、ボイドからコア1個をこのネクサスに置く。",
    ],
    keywordTags: ["grandwalker", "enter_field_core_placement_forbidden"],
    // 創界神ネクサス本体ルール (textLines[0]) と【神託】条件〔依神＆ネクサス〕/〔スタック効果＆マジック〕の
    // 対象ネクサス/マジック配置/使用時コア+1＋配置時デッキ上3枚トラッシュ標準文
    // (textLines[2-4]) は grandwalkerData + oracle 基盤 (oracle-system) で表現。
    // 〔スタック効果＆マジック〕の使用時神託は 10_rules/08c の裁定どおり
    // 「マジックカードのスタック効果を使用した」イベントに限る。
    // 【導域】Lv1-Lv2 青マジックの使用コストをこのネクサスからボイドに支払える効果と
    // Lv2 青マジックのスタック効果発揮時誘発は magic-system / oracle-system の導域 hook が表現。
    grandwalkerData: {
      kind: "grandwalker",
      oracleConditions: [
        { tribes: ["依神"], categories: ["nexus"] },
        { categories: ["magic"], hasMechanic: ["stack_effect"] },
      ],
      oracleTriggerKinds: ["place", "use_magic"],
      domainHooks: ["blue_magic_void_payment", "blue_magic_stack_domain"],
    },
    tribe: "創界神・依神",
    image: "images/BSTH10.5-X01.webp",
    rarity: "X",
    pack: "BSTH10.5 東方憑依花",
    maxDeckCount: 0,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2 このネクサスのシンボルは、青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "blue" },
          },
        ],
        textRef: [6],
      },
    ],
  },
];
