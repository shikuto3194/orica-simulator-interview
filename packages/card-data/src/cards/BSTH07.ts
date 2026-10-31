import type { CardDefinition } from "@orica/rules-core";

export const BSTH07_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH07-C01",
    orikaId: 179,
    orikaIndex: 188,
    name: "ナズーリン",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 2000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 3000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚/アタック時』",
      "ターンに1回、自分のデッキを上から3枚オープンできる。その中の系統：「起幻」を持つ青の導界者ネクサスカード1枚と、系統：「幻想」と「起幻」を持つ青のカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2『自分のメインステップ』",
      "このスピリットを疲労させることで、ボイドからコア1個を自分のリザーブに置く。この効果はターンに1回しか使えない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・星蓮",
    image: "images/BSTH07-C01.webp",
    rarity: "C",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このスピリットの召喚/アタック時』ターンに1回、デッキ上3枚オープン、起幻の青導界者ネクサス1枚と
      // 幻想＆起幻の青カード1枚を手札に加える。残りはデッキの下へ。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    colors: ["blue"],
                    tribes: ["起幻"],
                    targetsGrandwalker: true,
                    hasMechanic: ["guided"],
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    colors: ["blue"],
                    tribes: ["幻想", "起幻"],
                    tribesLogic: "and",
                  },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2『自分のメインステップ』疲労させることで、ボイドからコア1個をリザーブへ。ターンに1回。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              target: { kind: "self" },
              state: "exhausted",
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH07-C02",
    orikaId: 180,
    orikaIndex: 189,
    name: "多々良 小傘",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 2000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 3000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚/アタック時』",
      "ターンに1回、自分のデッキを上から3枚オープンできる。その中の系統：「起幻」を持つ青の導界者ネクサスカード1枚と、系統：「幻想」と「起幻」を持つ青のカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2『自分のメインステップ』",
      "このスピリットを疲労させることで、ボイドからコア1個を自分のリザーブに置く。この効果はターンに1回しか使えない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・星蓮",
    image: "images/BSTH07-C02.webp",
    rarity: "C",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このスピリットの召喚/アタック時』ターンに1回、デッキ上3枚オープン、起幻の青導界者ネクサス1枚と
      // 幻想＆起幻の青カード1枚を手札に加える。残りはデッキの下へ。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    colors: ["blue"],
                    tribes: ["起幻"],
                    targetsGrandwalker: true,
                    hasMechanic: ["guided"],
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    colors: ["blue"],
                    tribes: ["幻想", "起幻"],
                    tribesLogic: "and",
                  },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2『自分のメインステップ』疲労させることで、ボイドからコア1個をリザーブへ。ターンに1回。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              target: { kind: "self" },
              state: "exhausted",
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH07-M01",
    orikaId: 181,
    orikaIndex: 190,
    name: "[星蓮船]東風谷 早苗",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 6,
    reductionSymbols: ["blue", "blue", "blue", "guide"],
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
        bp: 11000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "【バースト：相手の効果によって相手の手札が増えた後】",
      "自分は、デッキの上から3枚ドローする。ドロー後、自分は手札1枚を破棄する。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "コスト6以下の相手のスピリット1体を破壊する。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・星蓮",
    image: "images/BSTH07-M01.webp",
    rarity: "M",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：相手の効果によって相手の手札が増えた後】3ドロー→手札1破棄→コストを支払わず召喚。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "hand_increase", player: "opponent" },
          cause: ["self_effect"],
        },
        steps: [
          { action: { kind: "draw", count: 3 } },
          {
            action: { kind: "discard", count: 1, player: "self" },
            connector: "sequential",
          },
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』コスト6以下の相手のスピリット1体を破壊する。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                  maxCost: 6,
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH07-M02",
    orikaId: 182,
    orikaIndex: 191,
    name: "[星蓮船]霧雨 魔理沙",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 7,
    reductionSymbols: ["blue", "blue", "blue", "guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 8000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 12000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "【バースト：相手によって自分のスピリットがフィールドを離れた後】",
      "効果の記述を持つ相手のスピリット/アルティメット1体を破壊する。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "コスト6以下の相手のスピリット/アルティメット1体を破壊する。この効果で破壊したとき、自分はデッキの上から1枚ドローする。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・星蓮",
    image: "images/BSTH07-M02.webp",
    rarity: "M",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：相手によって自分のスピリットがフィールドを離れた後】効果記述を持つ相手1体破壊→召喚。
      // spirit_destroyed (= leave_field event) + cause:["opponent_effect","battle"] で
      // 「相手によって」(効果＋バトル) を絞り、破壊以外 (バウンス/消滅) も含めて発動する。
      {
        // triggerFilter category:["spirit"] で「自分のスピリット」限定（BSTH03-M01 の
        // category:["ultimate"] と同型。spirit_destroyed は leave_field family に丸められ
        // ネクサス等の離脱も拾ってしまうため明示除外が必要）。
        timing: {
          kind: "burst",
          trigger: { kind: "spirit_destroyed", player: "self" },
          triggerFilter: { category: ["spirit"] },
          cause: ["opponent_effect", "battle"],
        },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  hasEffectText: true,
                },
                count: 1,
              },
            },
          },
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3『このスピリットのアタック時』コスト6以下の相手1体破壊。破壊したとき、デッキ1ドロー。
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"], maxCost: 6 },
                count: 1,
              },
            },
          },
          {
            action: { kind: "draw", count: 1 },
            connector: "conditional_result",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH07-M03",
    orikaId: 183,
    orikaIndex: 192,
    name: "[星蓮船]博麗 霊夢",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 6,
    reductionSymbols: ["blue", "blue", "blue", "guide"],
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
        bp: 11000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "【バースト：相手の『このスピリット／アルティメットの召喚時』発揮後】",
      "相手の創界神ネクサス1つのコアすべてをボイドに置く。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "自分は、デッキの上から1枚ドローする。さらに、自分のカウント2以上のとき、ターンに1回、このスピリットは回復する。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・星蓮",
    image: "images/BSTH07-M03.webp",
    rarity: "M",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：相手の『召喚時』発揮後】相手の創界神ネクサス1つのコアすべてをボイドへ→召喚。
      // 単一対象コアシュート (target+from:target_card+amount:"all"+targetsGrandwalker) は
      // BSTH001-X02 effects[0] と同型 (10_rules/03c §50 創界神耐性 → targetsGrandwalker:true、
      // 10_rules/07 §55 で導界者ネクサスも対象)。
      // 「その後」を connector:"sequential" で表現し、コア除去後に自身を burst から召喚。
      {
        timing: {
          kind: "burst",
          trigger: {
            kind: "effect_activated",
            player: "opponent",
            activatedTimings: ["summon"],
          },
          triggerFilter: { category: ["spirit", "ultimate"] },
        },
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  tribes: ["導界者", "創界神"],
                  targetsGrandwalker: true,
                },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "void", player: "opponent" },
              amount: "all",
            },
          },
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』1ドロー。さらにカウント2以上のときターン1回回復。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        steps: [
          { action: { kind: "draw", count: 1 } },
          {
            action: { kind: "recover", target: { kind: "self" } },
            connector: "simultaneous",
            condition: [{ kind: "count_value", player: "self", min: 2 }],
            usageLimit: { kind: "per_instance", duration: "turn" },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH07-R01",
    orikaId: 184,
    orikaIndex: 193,
    name: "雲居 一輪",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 4000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 6000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "自分は、デッキの上から2枚ドローできる。ドロー後、自分は手札1枚を破棄する。",
      "",
      "Lv1-Lv2-Lv3",
      'このスピリットは、コスト2、カード名：「雲山」、系統：「入道」、合体中BP+2000、シンボル0、"【合体中】『このスピリットのアタック時』ターンに1回、このスピリットは回復する。"を持つプレイグと合体しているものとして扱う。',
    ],
    keywordTags: [],
    tribe: "起幻・幻想・星蓮",
    image: "images/BSTH07-R01.webp",
    rarity: "R",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』2ドローできる。ドロー後、手札1破棄。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        steps: [
          { action: { kind: "draw", count: 2 } },
          {
            action: { kind: "discard", count: 1, player: "self" },
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3 雲山（プレイグ）と合体しているものとして扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: {
                combined: true,
                virtualAttachedBraves: [
                  {
                    cardName: "雲山",
                    tribes: ["入道"],
                    cost: 2,
                    symbols: [],
                    combinedBoost: 2000,
                    countsTowardLimit: true,
                  },
                ],
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // 引用符内の【合体中】能力(本来は仮想ブレイヴ「雲山」自身の印字テキスト)を
      // 本体(雲居一輪)の effect として登録している。engine-virtual-brave-combine-bsth07-r01:
      // sourceDefinitionId/sourceInstanceId は雲居一輪のまま(雲山の実体は無いため合成しない)。
      // 系統「入道」を発生源スコープにした negate/suppress/trigger は現行カードプールに
      // 存在しないため実害は無い(根拠+回帰テスト: legal-actions-shared.ts
      // getEffectiveTribes 直上コメント、bsth07-cards.test.ts の source-boundary テスト参照)。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH07-R02",
    orikaId: 185,
    orikaIndex: 194,
    name: "村紗 水蜜",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue", "blue", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 5000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 7000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分は、デッキの上から3枚ドローできる。ドロー後、自分は手札2枚を破棄する。",
      "",
      "Lv2-Lv3 スタック『相手のアタックステップ』",
      "このスピリットを疲労させることで、相手のスピリット/アルティメット1体は、このターンの間、アタックできない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・星蓮",
    image: "images/BSTH07-R02.webp",
    rarity: "R",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『このスピリットの召喚時』3ドローできる。ドロー後、手札2破棄。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          { action: { kind: "draw", count: 3 } },
          {
            action: { kind: "discard", count: 2, player: "self" },
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3 スタック『相手のアタックステップ』疲労させることで、相手1体はこのターンアタックできない。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "stack" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          { action: { kind: "exhaust", target: { kind: "self" } } },
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              restriction: ["attack"],
              duration: { scope: "turn" },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
        timingScope: { player: "opponent", period: "attack" },
      },
    ],
  },
  {
    cardNo: "BSTH07-R10",
    orikaId: 186,
    orikaIndex: 195,
    name: "習合「垂迹大日如来」",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue", "blue", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「起幻」を持つ。",
      "",
      "フラッシュ",
      "自分の青のネクサスがあるとき、このターンの間、効果の記述を持つ相手のスピリット/アルティメットのアタックでは自分のライフは1しか減らない。",
      "",
      "スタック",
      "このバトルの間、相手の効果で自分のライフは減らない。",
    ],
    keywordTags: [],
    tribe: "幻想・起幻",
    image: "images/BSTH07-R10.webp",
    rarity: "R",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」/「起幻」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "起幻"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ：自分の青のネクサスがあるとき、効果記述を持つ相手のアタックで自分のライフは1しか減らない。
      // = life_damage_interception(replace, cap:1)＋attackerFilter（効果記述を持つ相手スピ/アル）。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["nexus"],
            colors: ["blue"],
          },
        ],
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "replace",
              cap: 1,
              attackerFilter: {
                category: ["spirit", "ultimate"],
                hasEffectText: true,
              },
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [2, 3],
      },
      // スタック：このバトルの間、相手の効果で自分のライフは減らない。
      // life_damage_interception(cause:"opponent_effect", mode:"replace", duration:battle)
      // で「相手の効果による」ライフ減少のみを置換（バトル/自効果は通常解決）。
      {
        timing: { kind: "activated", mode: "stack" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "opponent_effect",
              mode: "replace",
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH07-R11",
    orikaId: 187,
    orikaIndex: 196,
    name: "鵺符「アンディファインドダークネス」",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「起幻」/「星蓮」を持つ。",
      "",
      "メイン",
      "自分のカウント3以下のとき、系統：「星蓮」を持つ自分の転醒前スピリット1体を裏返す。",
      "",
      "フラッシュ",
      "自分は、デッキの上から2枚ドローする。その後、手札のカード2枚か、系統：「起幻」を持つ青のカード1枚を破棄する。",
    ],
    keywordTags: [],
    tribe: "幻想・起幻・星蓮",
    image: "images/BSTH07-R11.webp",
    rarity: "R",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」/「起幻」/「星蓮」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "起幻", "星蓮"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // メイン：カウント3以下のとき、星蓮の自分の転醒前スピリット1体を裏返す。
      // 外部転醒 primitive（rebirth.target + hasMechanic:["rebirth"] filter）で表現。
      // 原文に「転醒条件を満たしたものとして」等の明示句が無い（BSSA01-XX01 神技4 と異なる）
      // ため forceTriggerCondition は付与しない。対象自身の card_event:"attack" 等の
      // トリガー効果は経由せず executeRebirth を直接呼ぶ（rebirth.target の構造上の性質）。
      {
        timing: { kind: "activated", mode: "main" },
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [
          {
            action: {
              kind: "rebirth",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["星蓮"],
                  hasMechanic: ["rebirth"],
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      // フラッシュ：2ドロー。その後、手札2枚か、起幻の青カード1枚を破棄。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "draw", count: 2 } },
          {
            targetSelectionTiming: "on_step",
            label: "手札2枚を破棄",
            // choiceIndex 0 = 手札2枚破棄, 1 = 起幻の青カード1枚破棄
            connector: "sequential",
            action: { kind: "discard", count: 2, player: "self" },
            choice: [
              {
                label: "青の起幻1枚を破棄",
                action: {
                  kind: "discard",
                  count: 1,
                  player: "self",
                  filter: { colors: ["blue"], tribes: ["起幻"] },
                },
              },
            ],
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH07-X01",
    orikaId: 188,
    orikaIndex: 197,
    name: "[導界者]聖 白蓮",
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
        requiredCores: 4,
        bp: 0,
      },
    ],
    symbolColors: ["guide"],
    textLines: [
      "このネクサスは導界者ネクサス／創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス／創界神ネクサス対象の効果しか受けず移動できない。また、導託・転者・導域は、神託・転神・神域としても扱う。",
      "",
      "【導託：〔星蓮／闘神＆コスト3以上〕〔転醒ネクサス〕】",
      "◆対象の自分のスピリット／ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、青としても扱う。",
      "",
      "【転者：2】Lv1-Lv2 フラッシュ『自分のアタックステップ』",
      "〔このネクサスのコア2個をボイドに置く〕このターンの間、このネクサスは、Lv1/Lv2BP4000のスピリットとしても扱い、導界者ネクサス/創界神ネクサス以外では破壊されない。",
      "",
      "Lv2『自分のアタックステップ』",
      "系統：「星蓮」/「闘神」を持つ自分の導界者ネクサス/コスト5以上のスピリットすべてに青のシンボル1つずつを追加する。この効果は重複しない。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    // 本体ルール [0]（導界者/創界神対象の効果しか受けない・導託/導界者対象効果でしかコア配置不可・
    // 導託/転者/導域=神託/転神/神域読み替え）と【導託】[2,3,4]（対象召喚/煌臨/配置時コア+1、
    // 配置時デッキ上3枚トラッシュ→対象カード1枚につきコア+1=標準 placementOracle）は
    // grandwalkerData 基盤 + enter_field_core_placement_forbidden で表現（stub effect から移行）。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        // 〔星蓮／闘神＆コスト3以上〕は bullet1「対象の自分のスピリット／ネクサス」に
        // 合わせ categories で spirit/nexus に限定（マジックカードを対象外にする）。
        {
          tribes: ["星蓮", "闘神"],
          minCost: 3,
          categories: ["spirit", "nexus"],
        },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ],
      // 【転者：2】Lv1-Lv2 フラッシュ『自分のアタックステップ』〔コア2個をボイドに置く〕。
      // 転者=転神扱い。コスト(コア2個→ボイド)・Lv ゲートは divineSkills 経路でエンジン検査
      //（ターン制限は原文になし＝無制限）。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 2,
          timing: { step: "attack", whose: "own", mode: "flash" },
          minLevel: 1,
          maxLevel: 2,
          // このターンの間 Lv1/Lv2 BP4000 のスピリットとしても扱い、導界者/創界神以外では
          // 破壊されない（divine_transform はターン終了時に自動リセット）。
          effects: [
            {
              textRef: [8, 9],
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "divine_transform",
                    target: { kind: "self" },
                    bpByLevel: [
                      { level: 1, bp: 4000 },
                      { level: 2, bp: 4000 },
                    ],
                    protectedFromNonGrandwalker: true,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    tribe: "導界者・起幻・闘神",
    image: "images/BSTH07-X01.webp",
    rarity: "X",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
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
      // 【転者：2】(flash) は grandwalkerData.divineSkills で表現（上記参照）。
      // Lv2『自分のアタックステップ』星蓮/闘神の自分の導界者ネクサス/コスト5以上スピリットすべてに青シンボル+1。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  filterOr: [
                    {
                      category: ["nexus"],
                      tribes: ["星蓮", "闘神"],
                      targetsGrandwalker: true,
                      hasMechanic: ["guided"],
                    },
                    {
                      category: ["spirit"],
                      tribes: ["星蓮", "闘神"],
                      minCost: 5,
                    },
                  ],
                },
                count: "all",
              },
              symbol: "blue",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [11, 12],
        timingScope: { player: "self", period: "attack" },
      },
    ],
  },
  {
    cardNo: "BSTH07-転醒R01(A)",
    orikaId: 189,
    orikaIndex: 198,
    name: "聖蓮船",
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
      {
        level: 2,
        requiredCores: 1,
        bp: 0,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "自分のライフが減ったか、このネクサス以外の自分の系統：「起幻」を持つ効果でドローしたとき、このネクサスを裏返せる。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分は、デッキの上から2枚ドローできる。ドロー後、自分は手札1枚を破棄する。この効果は、系統：「星蓮」を持つ。",
      "",
      "Lv2",
      "お互い、カードを召喚/配置/使用するとき、創界神ネクサス/導界者ネクサスでは、1つしか軽減シンボルを満たせない。",
    ],
    keywordTags: ["double_sided"],
    tribe: "起幻・幻想",
    image: "images/BSTH07-転醒R01(A).webp",
    rarity: "TR",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2【転醒：自分のカウント3以下（転醒は同時に使えない）】自分のライフが減った
      // とき、このネクサスを裏返せる。BSTH04-転醒R02(A) 同型の2エントリ分割
      // (game_event reduce_life + game_event increase_hand) を踏襲。
      {
        timing: { kind: "game_event", player: "self", event: "reduce_life" },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [0, 1],
      },
      // Lv1-Lv2【転醒：自分のカウント3以下】このネクサス以外の自分の系統：「起幻」を持つ
      // 効果でドローしたとき、このネクサスを裏返せる。「このネクサス以外」=
      // trigger_tribes.excludeSelfSource（カード自身が印字系統 起幻 を持つため必須）。
      {
        timing: { kind: "game_event", player: "self", event: "after_draw" },
        executionMode: "optional",
        condition: [
          { kind: "trigger_tribes", tribes: ["起幻"], excludeSelfSource: true },
          { kind: "trigger_source_player", player: "self" },
          { kind: "count_value", player: "self", max: 3 },
        ],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [0, 1],
      },
      // Lv1-Lv2『このネクサスの配置時』2ドローできる。ドロー後、手札1破棄。（この効果は系統：「星蓮」を持つ）
      {
        timing: { kind: "card_event", event: "place" },
        effectTribes: { tribes: ["星蓮"] },
        executionMode: "optional",
        steps: [
          { action: { kind: "draw", count: 2 } },
          {
            action: { kind: "discard", count: 1, player: "self" },
            connector: "sequential",
          },
        ],
        textRef: [3, 4],
      },
      // Lv2 お互い、召喚/配置/使用時、創界神/導界者ネクサスでは1つしか軽減シンボルを満たせない。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "limit_cost_reduction",
              player: "self",
              sourceFilter: { targetsGrandwalker: "only" },
              maxSymbols: 1,
              restrictedKinds: [
                "summon",
                "place_nexus",
                "magic",
                "accel",
                "change",
              ],
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "limit_cost_reduction",
              player: "opponent",
              sourceFilter: { targetsGrandwalker: "only" },
              maxSymbols: 1,
              restrictedKinds: [
                "summon",
                "place_nexus",
                "magic",
                "accel",
                "change",
              ],
              duration: { scope: "while_on_field" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "命蓮寺",
      printedCategory: "nexus",
      colors: ["blue"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 0,
        },
      ],
      symbolColors: ["blue"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1『このネクサスの転醒時』",
        "本来のコストが6以下の相手のスピリット/アルティメット1体を破壊する。このネクサス以外の自分の青シンボルがあるとき、この「コスト破壊効果」の上限を+2する。",
        "",
        "Lv1",
        "系統：「星蓮」/「闘神」を持つ自分のスピリットがアタックしたとき、このネクサスを裏返して配置できる。この効果は、ターンに1回しか使えない。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想",
      image: "images/BSTH07-転醒R01(B).webp",
      rarity: "TR",
      pack: "BSTH07 東方星蓮船",
      cardNo: "BSTH07-転醒R01(B)",
      effects: [
        // 『このネクサスの転醒時』本来のコストが 6 以下の相手のスピリット/アルティメット 1 体を破壊する。
        // card_event:"rebirth" は trigger-system dispatch + 裏面レジストリ登録
        // (expandCardDefinitionsWithBackFaces) 済みで production 発火する (旧 stub を除去)。
        {
          timing: { kind: "card_event", event: "rebirth" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit", "ultimate"],
                    maxCost: 6,
                    costBasis: "printed",
                  },
                  count: 1,
                },
              },
            },
          ],
          textRef: [3],
        },
        // このネクサス以外の自分の青シンボルがあるとき、この「コスト破壊効果」の上限を+2する。
        // P3-14 A-7 effect_param_modify。field_has.symbolColors:["blue"] で
        // getEffectiveSymbols ベースに「青シンボルを 1 つ以上持つカード 1 枚以上 (このネクサス除く)」
        // を厳密判定する（colors:["blue"] は『青色のカード』を拾うが、ここの原文「青シンボル」は
        // 実効シンボルに青を含むカードに限る）。
        {
          timing: { kind: "continuous" },
          condition: [
            {
              kind: "field_has",
              player: "self",
              symbolColors: ["blue"],
              minCount: 1,
              excludeSelf: true,
            },
          ],
          steps: [
            {
              action: {
                kind: "effect_param_modify",
                effectClass: "cost_destroy",
                scope: "self",
                addLimitAmount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [3],
        },
        // [5,6] Lv1 系統:「星蓮」/「闘神」を持つ自分のスピリットがアタックしたとき、
        //   このネクサスを裏返して配置できる。ターンに1回。
        //   逆転醒（B面→A面 裏返して配置）= reverse_rebirth mode:"summon"（P3-98、10_rules/08a
        //   §逆転醒 パターン2）。「コストを支払わず」明記が無いため通常配置（コスト支払い+維持コア）。
        //   アタックトリガー = game_event:attack（星蓮/闘神の自分スピリット、第三者観測）。
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "attack",
            triggerFilter: {
              category: ["spirit"],
              tribes: ["星蓮", "闘神"],
            },
          },
          executionMode: "optional",
          usageLimit: { kind: "per_card_name", duration: "turn" },
          steps: [{ action: { kind: "reverse_rebirth", mode: "summon" } }],
          textRef: [5, 6],
        },
      ],
    },
  },
  {
    cardNo: "BSTH07-転醒X01(A)",
    orikaId: 190,
    orikaIndex: 199,
    name: "Unknown",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 6,
    reductionSymbols: ["blue", "blue", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 8000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分は、デッキの上から3枚ドローできる。ドロー後、自分は手札1枚を破棄する。そうしたとき、このターンの間、相手はバースト効果を発揮できない。",
      "",
      "Lv2【転醒：自分のカウント5以下（転醒は同時に使えない）】",
      "このスピリットがアタックしたとき、このスピリットを裏返せる。",
    ],
    keywordTags: ["burst", "double_sided"],
    tribe: "起幻・幻想・星蓮",
    image: "images/BSTH07-転醒X01(A).webp",
    rarity: "TX",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このスピリットの召喚時』3ドローできる。ドロー後、手札1破棄。そうしたとき、このターン相手はバースト効果を発揮できない。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          { action: { kind: "draw", count: 3 } },
          {
            action: { kind: "discard", count: 1, player: "self" },
            connector: "sequential",
          },
          {
            // 「このターンの間、相手はバースト効果を発揮できない」= negate(opponent_burst,
            // cannot_activate)。duration 既定 { scope:"turn" }。consumer 配線済み
            // (isBurstEffectNullifiedByOpponent, P3-77 Step C)。
            action: {
              kind: "negate",
              negateTarget: "opponent_burst",
              burstSuppressKind: "cannot_activate",
            },
            connector: "conditional_result",
          },
        ],
        textRef: [0, 1],
      },
      // Lv2【転醒：自分のカウント5以下】このスピリットがアタックしたとき裏返せる。
      // 転醒トリガー = card_event:attack の任意誘発。executeRebirth が
      // カウント条件 (maxCount) ・同時転醒不可・Lv不足消滅・アタック中BP再計算を内包し、
      // A→B flip 後に B 面『転醒時』(card_event:rebirth) を trigger-system が自動収集する。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        applicability: { level: { min: 2 } },
        steps: [{ action: { kind: "rebirth", maxCount: 5 } }],
        textRef: [3, 4],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "封獣 ぬえ",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 8,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 1,
          bp: 8000,
        },
        {
          level: 2,
          requiredCores: 3,
          bp: 12000,
        },
        {
          level: 3,
          requiredCores: 4,
          bp: 15000,
        },
      ],
      symbolColors: ["red", "blue"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒時』",
        "自分の青1色のネクサスがあるとき、相手の手札すべてを破棄できる。そうしたとき、相手はデッキの上から3枚ドローし、自分は、相手のトラッシュのカードすべてを好きな順番でデッキの下に戻す。",
        "",
        "Lv2-Lv3『このスピリットのアタック時』",
        "このスピリットはブロックされない。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想・星蓮",
      image: "images/BSTH07-転醒X01(B).webp",
      rarity: "TX",
      pack: "BSTH07 東方星蓮船",
      cardNo: "BSTH07-転醒X01(B)",
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1-Lv2-Lv3『このスピリットの転醒時』自分の青1色のネクサスがあるとき、
        //   相手の手札すべてを破棄できる。そうしたとき、相手はデッキの上から3枚ドローし、
        //   自分は、相手のトラッシュのカードすべてを好きな順番でデッキの下に戻す。
        // 「青1色のネクサス」= field_has colorCount:"mono" + colors:["blue"]（単色青）。
        // 「相手のトラッシュ→デッキの下」= search_zone player:"opponent" destination:"deck"
        //   （state はデッキ順を保持しないため「好きな順番」は deckCount 加算で表現）。
        // 「相手はデッキの上から3枚ドロー」= draw player:"opponent"。
        {
          timing: { kind: "card_event", event: "rebirth" },
          executionMode: "optional",
          condition: [
            {
              kind: "field_has",
              player: "self",
              category: ["nexus"],
              colors: ["blue"],
              colorCount: "mono",
            },
          ],
          steps: [
            {
              action: {
                kind: "discard",
                player: "opponent",
                count: "all",
                unseen: true,
              },
            },
            {
              connector: "sequential",
              action: { kind: "draw", player: "opponent", count: 3 },
            },
            {
              connector: "sequential",
              action: {
                kind: "search_zone",
                zone: "trash",
                player: "opponent",
                count: -1,
                destination: "deck",
                destinationPosition: "bottom",
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5,6] Lv2-Lv3『このスピリットのアタック時』このスピリットはブロックされない。
        {
          timing: { kind: "card_event", event: "attack" },
          condition: [{ kind: "min_level", value: 2 }],
          steps: [
            {
              action: {
                kind: "unblockable",
                target: { kind: "self" },
                duration: { scope: "battle" },
              },
            },
          ],
          textRef: [5, 6],
        },
      ],
    },
  },
  {
    cardNo: "BSTH07-転醒X02(A)",
    orikaId: 191,
    orikaIndex: 200,
    name: "毘沙門天の宝塔",
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: [],
    textLines: [
      "このネクサスは創界石ネクサス対象の効果しか受けない。このネクサスには解封と創界石ネクサス対象の効果でしかコアを置けず、そのコアは創界石ネクサス対象の効果しか受けず移動できない。",
      "",
      "【解封：〔系統：「起幻」を持つ自分の青の効果による自分の手札の増加〕】",
      "◆解封条件を満たしたとき、ボイドからコア1個をこのネクサスに置ける。",
      "",
      "Lv1【転醒：自分のカウント5以下（転醒は同時に使えない）】",
      "このネクサスのコアが4個以上になったとき、このネクサスを裏返せる。（置かれているコアは1個を残してボイドに置く。）このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【神秘】Lv1",
      "自分が系統：「星蓮」/「闘神」を持つ効果で手札を増やしたとき、自分の手札は、相手のスピリット/ネクサスの効果を受けない。",
    ],
    keywordTags: ["double_sided", "enter_field_core_placement_forbidden"],
    tribe: "創界石・起幻・幻想",
    image: "images/BSTH07-転醒X02(A).webp",
    rarity: "TX",
    pack: "BSTH07 東方星蓮船",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 創界石ネクサス本体ルール [0] + 【解封】[2,3]（起幻の自分の青の効果による手札増加）
    // + 転醒 [5,6]（コア4個以上・カウント5以下・1個残してボイド・フィールド/リザーブの
    // コアを転醒後スピリットに好きなだけ）は grandstoneData + エンジン基盤で表現する。
    grandstoneData: {
      unsealConditions: [
        {
          events: ["hand_increase"],
          causeFilter: { tribes: ["起幻"], colors: ["blue"] },
        },
      ],
      rebirthCoreThreshold: 4,
      rebirthMaxCount: 5,
      rebirthRetainCores: 1,
      postRebirth: "charge_cores_from_field_reserve",
    },
    effects: [
      // 【神秘】Lv1 自分が系統：「星蓮」/「闘神」を持つ効果で手札を増やしたとき、
      // 自分の手札は相手のスピリット/ネクサスの効果を受けない
      // (P3-129 ENGINE-triggered-hand-zone-immunity-dynamic-scope)。
      // 裁定 (needs-ruling.jsonl BSTH07-転醒X02(A)): 免疫は永続ラッチではなく、この手札増加
      // event に対して相手側に登録された誘発効果が未解決の間だけ有効な動的スコープ。
      // トリガー検出 (game_event:increase_hand + trigger_tribes) で解決中 pending の
      // pendingId を correlate_pending_trigger により記録し、別の continuous 効果を
      // correlated_pending_trigger_active でゲートして effect_immunity
      // (target.zone:["hand"]) を登録する。相手側誘発が解決/消滅すれば自動的に免疫も切れる。
      // 「自分が…効果で」= 原因効果のコントローラーも自分限定 (adversarial verifier
      // round1 指摘で訂正: grandstoneData.unsealConditions の causeFilter 型自体は
      // player 非限定だが、姉妹能力【解封】の実 enforcement は
      // grandstone-system.ts checkAndQueueUnsealChoicesForHandIncrease
      // 「causeCard.controllerPlayerId !== growerPlayerId なら return state」で
      // コントローラー一致を呼び出し側が担保している。汎用 game_event 経路には同型の
      // 暗黙ゲートが無いため trigger_source_player を明示する)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "increase_hand",
        },
        condition: [
          { kind: "trigger_tribes", tribes: ["星蓮", "闘神"] },
          { kind: "trigger_source_player", player: "self" },
        ],
        steps: [
          {
            action: {
              kind: "correlate_pending_trigger",
              key: "mystery_hand_immunity",
            },
          },
        ],
        textRef: [8, 9],
      },
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "correlated_pending_trigger_active",
            key: "mystery_hand_immunity",
          },
        ],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: {},
                count: "all",
                zone: ["hand"],
              },
              duration: { scope: "while_on_field" },
              sourceScope: { categories: ["spirit", "nexus"] },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "寅丸 星",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 8,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 1,
          bp: 8000,
        },
        {
          level: 2,
          requiredCores: 3,
          bp: 13000,
        },
        {
          level: 3,
          requiredCores: 5,
          bp: 16000,
        },
      ],
      symbolColors: ["red", "blue"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』",
        "ターンに1回、効果の記述を持つ相手のスピリット/アルティメット2体を破壊する。この効果で破壊したスピリットはフィールドに残らず、これらの効果は、系統：「星蓮」/「闘神」を持たない効果では防げない。",
        "",
        "Lv2-Lv3『このスピリットのアタック時』",
        "ターンに1回、このスピリットは回復する。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想・星蓮",
      image: "images/BSTH07-転醒X02(B).webp",
      rarity: "TX",
      pack: "BSTH07 東方星蓮船",
      cardNo: "BSTH07-転醒X02(B)",
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』ターンに1回、効果の記述を持つ
        //   相手のスピリット/アルティメット2体を破壊する。この効果で破壊したスピリットは
        //   フィールドに残らず、これらの効果は、系統:「星蓮」/「闘神」を持たない効果では防げない。
        //   - 「効果の記述を持つ」対象限定 = CardFilter.hasEffectText:true（印字テキストベース）。
        //   - 「フィールドに残らない」= suppressDestroyedEffects:"destroyed_only"（残留置換抑止）。
        //   - 「系統:星蓮/闘神を持たない効果では防げない」= preventionRestriction の系統スコープ
        //     onlyPreventableByTribes（一致しない cannot_*/defense_immune を scoped 貫通）。
        {
          timing: { kind: "card_event", event: ["rebirth", "attack"] },
          usageLimit: { kind: "per_instance", duration: "turn" },
          preventionRestriction: {
            onlyPreventableByTribes: ["星蓮", "闘神"],
          },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit", "ultimate"],
                    hasEffectText: true,
                  },
                  count: 2,
                },
                suppressDestroyedEffects: "destroyed_only",
                suppressDestroyedEffectsByCategory: ["spirit"],
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5,6] Lv2-Lv3『このスピリットのアタック時』ターンに1回、このスピリットは回復する。
        {
          timing: { kind: "card_event", event: "attack" },
          condition: [{ kind: "min_level", value: 2 }],
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
          textRef: [5, 6],
        },
      ],
    },
  },
];
