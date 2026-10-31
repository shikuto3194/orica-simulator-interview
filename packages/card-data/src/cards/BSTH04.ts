import type { CardDefinition } from "@orica/rules-core";

export const BSTH04_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH04-C01",
    orikaId: 122,
    orikaIndex: 130,
    name: "[花映塚]チルノ",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple", "yellow"],
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
      {
        level: 3,
        requiredCores: 4,
        bp: 4000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "このカード/スピリットのシンボルは黄としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の系統：「起幻」を持つ黄/紫の導界者ネクサスカード1枚と、系統：「幻想」と「起幻」を持つ黄/紫のカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "Lv1-Lv2-Lv3 スタック『相手のターン』",
      "このスピリットを疲労させることで、相手の6色のスピリットカードの召喚を無効にする。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・冥主",
    image: "images/BSTH04-C01.webp",
    rarity: "C",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol", "reduction_symbol"],
              asColor: "yellow",
              appliesToCard: true,
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
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    category: ["nexus"],
                    colors: ["yellow", "purple"],
                    tribes: ["起幻"],
                    hasMechanic: ["guided"],
                  },
                },
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    colors: ["yellow", "purple"],
                    tribes: ["幻想", "起幻"],
                    tribesLogic: "and",
                  },
                },
              ],
              remainder: "trash",
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "stack",
        },
        timingScope: { player: "opponent", period: "turn" },
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
              kind: "negate",
              negateTarget: "summon",
              targetFilter: {
                category: ["spirit"],
                colors: ["red", "purple", "green", "white", "yellow", "blue"],
                colorsLogic: "and",
                colorCount: { min: 6, max: 6 },
              },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH04-C02",
    orikaId: 121,
    orikaIndex: 131,
    name: "メディスン・メランコリー",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow", "purple"],
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
        requiredCores: 3,
        bp: 5000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "このカード/スピリットのシンボルは紫としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の系統：「起幻」を持つ黄/紫の導界者ネクサスカード1枚と、系統：「幻想」と「起幻」を持つ黄/紫のカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "Lv1-Lv2-Lv3 スタック『相手のターン』",
      "このスピリットを疲労させることで、相手の6色のネクサスカードの配置を無効にする。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・楽族",
    image: "images/BSTH04-C02.webp",
    rarity: "C",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol", "reduction_symbol"],
              asColor: "purple",
              appliesToCard: true,
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
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    category: ["nexus"],
                    colors: ["yellow", "purple"],
                    tribes: ["起幻"],
                    hasMechanic: ["guided"],
                  },
                },
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    colors: ["yellow", "purple"],
                    tribes: ["幻想", "起幻"],
                    tribesLogic: "and",
                  },
                },
              ],
              remainder: "trash",
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "stack",
        },
        timingScope: { player: "opponent", period: "turn" },
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
              kind: "negate",
              negateTarget: "place",
              targetFilter: {
                category: ["nexus"],
                colors: ["red", "purple", "green", "white", "yellow", "blue"],
                colorsLogic: "and",
                colorCount: { min: 6, max: 6 },
              },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH04-C03",
    orikaId: 123,
    orikaIndex: 132,
    name: "[花映塚]因幡 てゐ",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "yellow", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
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
    symbolColors: ["purple"],
    textLines: [
      "このカード/スピリットのシンボルは黄としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のデッキを上から2枚破棄できる。その後、トラッシュにある系統：「起幻」を持つ黄/紫のカード1枚を手札に加える。この効果はターンに1回しか使えない。",
      "",
      "Lv1-Lv2-Lv3『自分のメインステップ』",
      "自分の導シンボルがないとき、このスピリットに導シンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・冥主",
    image: "images/BSTH04-C03.webp",
    rarity: "C",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol", "reduction_symbol"],
              asColor: "yellow",
              appliesToCard: true,
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
        executionMode: "mandatory",
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            executionMode: "optional",
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "self", position: "top" },
              to: { zone: "trash" },
              count: 2,
              deckDiscard: true,
            },
          },
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: {
                colors: ["yellow", "purple"],
                tribes: ["起幻"],
              },
              count: 1,
              destination: "hand",
              mandatory: true,
            },
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      {
        // ルーミア型の継続効果。activated + permanent だと起動毎に永続シンボルが累積するため continuous 化。
        // 「このスピリットに」=self（旧 filter 近似を是正）。
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { level: { min: 1, max: 3 } },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            symbolColors: ["guide"],
          },
        ],
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "guide",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH04-C11",
    orikaId: 124,
    orikaIndex: 133,
    name: "審判「ラストジャッジメント」",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "purple"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュにあるこのカードは、一切の効果を受けない。",
      "このカードは、系統：「起幻」/「幻想」を持つ。",
      "",
      "フラッシュ",
      "このターンの間、相手のスピリット/アルティメットすべてはアタックできない。自分のカウント2以上のとき、この効果は相手の効果では防げない。",
      "",
      "スタック",
      "次のバトル終了後まで、相手によって自分のライフは減らない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想",
    image: "images/BSTH04-C11.webp",
    rarity: "C",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // トラッシュにあるこのカードは一切の効果を受けない。
      // while_in_trash 束縛の effect_immunity (defense_immune)。トラッシュ滞在中のみ登録され、
      // トラッシュを離れると recomputeContinuousEffects が除去する (10_rules/03b §常在効果)。
      {
        applicability: { zone: "trash" },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_in_trash" },
              sourcePlayerScope: "any",
            },
          },
        ],
        textRef: [0],
      },
      // このカードは、系統：「起幻」/「幻想」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["起幻", "幻想"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [1],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        preventionLevel: "unpreventable",
        preventionLevelCondition: [
          { kind: "count_value", player: "self", min: 2 },
        ],
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: "all",
              },
              restriction: ["attack"],
              duration: {
                scope: "turn",
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        // [6,7] スタック: 次のバトル終了後まで、相手によって自分のライフは減らない。
        // 相手の効果/バトルによる減少だけを防ぎ、ターンを跨いでも次のバトル終了まで持続する。
        timing: {
          kind: "activated",
          mode: "stack",
        },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "opponent",
              mode: "replace",
              duration: {
                scope: "battle",
                nextBattleEnd: true,
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH04-C12",
    orikaId: 125,
    orikaIndex: 134,
    name: "投銭「宵越しの銭」",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "yellow", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「起幻」/「幻想」/「冥主」を持つ。",
      "",
      "メイン",
      "自分は、デッキの上から2枚ドローする。または、〔ターンに1回：同名〕トラッシュにある系統：「起幻」を持つ黄/紫のカード1枚を手札に戻す。",
      "",
      "スタック",
      "相手のスピリット/アルティメットのコア1個をリザーブに置く。この効果で、コアを0個にできず、相手のアタックステップしか使えない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・冥主",
    image: "images/BSTH04-C12.webp",
    rarity: "C",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "activated",
          mode: "main",
        },
        steps: [
          {
            // choiceIndex 0 = デフォルト action (2枚ドロー)
            // choiceIndex 1 = 〔ターンに1回：同名〕トラッシュから系統:「起幻」の黄/紫1枚を手札へ
            action: {
              kind: "draw",
              count: 2,
            },
            choice: [
              {
                usageLimit: {
                  kind: "per_card_name",
                  duration: "turn",
                },
                action: {
                  kind: "search_zone",
                  zone: "trash",
                  filter: {
                    colors: ["yellow", "purple"],
                    tribes: ["起幻"],
                  },
                  count: 1,
                  destination: "hand",
                  mandatory: true,
                },
              },
            ],
          },
        ],
        textRef: [2, 3],
      },
      // スタック『相手のアタックステップ』相手のスピリット/アルティメットのコア1個をリザーブに置く。
      //   コアを0個にできない。
      // timingScope:{opponent,attack} で「相手のアタックステップしか使えない」を表現
      //   (BSTH04-XX01 effects[5] = bsth04-xx01 と同型: magic stack 経路でも
      //    legal-actions-availability.ts L3709 isTimingScopeActive が registration の
      //    timingScope を尊重する)。
      // from.filter.category:["spirit","ultimate"] で対象を限定し、
      //   minRemainingPerCandidate:1 で「コア0個にできない」(BSTH04-転醒R02(B) と同型)。
      {
        timing: {
          kind: "activated",
          mode: "stack",
        },
        timingScope: { player: "opponent", period: "attack" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                minRemainingPerCandidate: 1,
              },
              to: {
                kind: "reserve",
                player: "opponent",
              },
              amount: 1,
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH04-M01",
    orikaId: 126,
    orikaIndex: 135,
    name: "[花映塚]射命丸 文",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow", "purple", "purple"],
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
        requiredCores: 3,
        bp: 5000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "このカード/スピリットのシンボルは紫としても扱う。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットは、相手の効果を受けず、アタックできない。",
      "",
      "Lv1-Lv2-Lv3『自分のアタックステップ』",
      "系統：「起幻」と「楽族」/「冥主」を持つコスト5以上の自分の黄/紫のスピリットのバトル終了時、自分のライフが5以下なら、ボイドからコア1個を自分のライフに置ける。この効果は重複しない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・楽族",
    image: "images/BSTH04-M01.webp",
    rarity: "M",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol", "reduction_symbol"],
              asColor: "purple",
              appliesToCard: true,
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              // 「このスピリット」= BSTH04-M01 自身。filter経由だと自分側スピリット
              // 全体から選ばれて他カードへ付与され得るため self に限定する
              // (verifier 2026-06-22 round 4 lens 1 補正)。
              target: { kind: "self" },
              duration: {
                scope: "permanent",
              },
            },
          },
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack"],
              duration: {
                scope: "permanent",
              },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [2, 3],
      },
      // Lv1-Lv2-Lv3『自分のアタックステップ』系統「起幻」と「楽族」/「冥主」を持つコスト5以上の
      // 自分の黄/紫スピリットのバトル終了時、自分のライフが5以下なら、ボイドからコア1個を自分の
      // ライフに置ける。この効果は重複しない。
      // 第三者 game_event:battle_end 観測 (action:"attack"=『自分のアタックステップ』)。
      // BSTH001-C04 effects[2] 同型。no_duplicate legal-actions-apply 経路は
      // game-event-no-duplicate-multi-source.test.ts で検証済 (ENGINE-no-duplicate-game-event-pending-e2e-test)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "battle_end",
          action: "attack",
          triggerFilter: {
            category: ["spirit"],
            colors: ["yellow", "purple"],
            tribesRequired: ["起幻"],
            tribes: ["楽族", "冥主"],
            tribesLogic: "or",
            minCost: 5,
          },
        },
        condition: [{ kind: "life_value", player: "self", max: 5 }],
        executionMode: "optional",
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 1,
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH04-R01",
    orikaId: 127,
    orikaIndex: 136,
    name: "[花映塚]十六夜 咲夜",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 7,
    reductionSymbols: [
      "purple",
      "purple",
      "purple",
      "yellow",
      "yellow",
      "yellow",
    ],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 8000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 11000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "トラッシュにあるこのカードは、一切の効果を受けない。",
      "",
      "【バースト：自分のライフ減少後】",
      "このカードをコストを支払わずに召喚する。その後、このバトル終了時、アタックステップを終了する。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットは相手のスピリット/ネクサスの効果を受けない。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・楽族",
    image: "images/BSTH04-R01.webp",
    rarity: "R",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: "trash" },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_in_trash" },
              sourcePlayerScope: "any",
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "burst",
          trigger: { kind: "life_decrease", player: "self" },
        },
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
          },
          {
            action: {
              kind: "end_attack_step",
            },
            deferTo: "battle_end",
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      {
        applicability: { level: { min: 1, max: 3 } },
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: {
                scope: "while_on_field",
              },
              sourceScope: { categories: ["spirit", "nexus"] },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH04-R02",
    orikaId: 128,
    orikaIndex: 137,
    name: "[花映塚]魂魄 妖夢",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: [
      "purple",
      "purple",
      "purple",
      "yellow",
      "yellow",
      "yellow",
    ],
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
        bp: 12000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "【バースト：相手の『このスピリット／ネクサスの召喚／配置時』発揮後】",
      "相手のスピリット/ネクサス1つを消滅させ、その効果を発揮させない。消滅するスピリット/ネクサスのコアはリザーブに置く。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "相手のフィールドのコア2個をリザーブに置く。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・冥主",
    image: "images/BSTH04-R02.webp",
    rarity: "R",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: {
            kind: "effect_activated",
            player: "opponent",
            activatedTimings: ["summon", "place"],
          },
          triggerFilter: { category: ["spirit", "nexus"] },
        },
        steps: [
          {
            action: {
              kind: "vanish",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "nexus"],
                },
                count: 1,
              },
              // 「その効果を発揮させない」= 消滅した対象自身の離脱誘発効果を抑止（Q19/P3-74）。
              suppressDestroyedEffects: "destroyed_only",
            },
          },
          {
            // burst→self-summon パターン (10_rules/04b_burst-rules.md:34、先例 BSTS01-M01[4,5])。
            // from_zone:hand は誤り（BSTH03-M02/M03/M06 同型バグ修正）。「その後」= sequential
            // (dsl-types.ts:1148)。
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
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field",
                player: "opponent",
              },
              to: {
                kind: "reserve",
                player: "opponent",
              },
              amount: 2,
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH04-X01",
    orikaId: 129,
    orikaIndex: 138,
    name: "[導界者]西行寺 幽々子",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: ["purple"],
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
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・導技・導域は、神託・神技・神域としても扱う。",
      "",
      "【導託：〔幻想＆コスト3以上〕〔転醒ネクサス〕】",
      "◆対象の自分のスピリット/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、黄/紫としても扱う。",
      "",
      "【導技：4】Lv1-Lv2 フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回、このネクサスのコア4個をボイドに置く〕疲労状態の相手のスピリット/アルティメット1体を消滅させる。消滅するスピリット/アルティメットのコアはリザーブに置かれる。",
      "",
      "【導域】Lv2『自分のアタックステップ』",
      "系統:「起幻」を持つ自分の黄/紫のスピリットすべては、相手の効果でフィールドを離れるとき、疲労状態でフィールドに残ることができる。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    tribe: "導界者・起幻・冥主",
    image: "images/BSTH04-X01.webp",
    rarity: "X",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        // 〔幻想＆コスト3以上〕は bullet1「対象の自分のスピリット/ネクサス」に
        // 合わせ categories で spirit/nexus に限定（マジックカードを対象外にする）。
        { tribes: ["幻想"], minCost: 3, categories: ["spirit", "nexus"] },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ],
      // 【導技：4】Lv1-Lv2 フラッシュ『お互いのアタックステップ』
      //   〔ターンに1回、コア4個をボイドに置く〕。導技=神技扱い（textLines[0]）。
      //   コスト(コア4個→ボイド)・ターン制限は divineSkills 経路でエンジンが検査・支払い。
      //   precedent: BSTH05-X02（同型 フラッシュ『お互いのアタックステップ』）。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 4,
          timing: { step: "attack", whose: "both", mode: "flash" },
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          // 疲労状態の相手のスピリット/アルティメット1体を消滅させる
          //（コアはリザーブ＝vanish 既定）。
          effects: [
            {
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "vanish",
                    target: {
                      kind: "filter",
                      player: "opponent",
                      filter: {
                        category: ["spirit", "ultimate"],
                        exhaustState: "exhausted",
                      },
                      count: 1,
                    },
                  },
                },
              ],
              textRef: [8, 9],
            },
          ],
        },
      ],
    },
    // textLines[0] 導界者ネクサス共通ルール（対象効果限定・コア配置制限・導託/導技/導域=
    //   神託/神技/神域扱い）と textLines[2-3]【導託】は grandwalkerData(kind:"guided") +
    //   keywordTags で engine が表現する（DSL effect 不要）。
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "yellow",
            },
          },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【導技：4】(flash) は grandwalkerData.divineSkills で表現（上記参照）。
      {
        timing: {
          kind: "game_event",
          event: "leave_field",
          player: "self",
          cause: "opponent_effect",
          triggerFilter: {
            category: ["spirit"],
            colors: ["yellow", "purple"],
            tribes: ["起幻"],
          },
        },
        timingScope: { player: "self", period: "attack" },
        executionMode: "optional",
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        // 残留を認めるのはこのネクサスの効果。離脱対象自身への効果付与ではないため、
        // 対象の効果を発揮させない除去でも、この導域による任意残留は失われない。
        steps: [
          {
            action: {
              kind: "stay_on_field",
              target: {
                kind: "trigger_related_instances",
                includePendingLeave: true,
                count: { min: 1 },
              },
              newExhaustState: "exhausted",
            },
            targetSelectionTiming: "on_step",
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
  {
    cardNo: "BSTH04-X02",
    orikaId: 130,
    orikaIndex: 139,
    name: "風見幽香",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 8,
    reductionSymbols: ["yellow", "yellow", "purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 12000,
      },
      {
        level: 3,
        requiredCores: 3,
        bp: 16000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "このターンの間、相手のスピリット/アルティメット1体をBP-10000する。この効果を自分のカウント1につき追加で発揮し、BPが0になったスピリット/アルティメットをすべて破壊する。",
      "【C連鎖】（自分のカウントの数につき、下の効果を続けて発揮する。）",
      "1以上: 破壊したスピリット/アルティメットの効果は発揮されない。",
      "2以上: 相手のライフのコア1個をトラッシュに置く。",
      "3以上: お互い手札/手元の黄以外のカードを使えない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・楽族",
    image: "images/BSTH04-X02.webp",
    rarity: "X",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        steps: [
          {
            id: "bp0",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
              amount: -10000,
              duration: {
                scope: "turn",
              },
            },
            // 「この効果を自分のカウント1につき追加で発揮し」= 基本 1 回 + カウント回。
            // 各発揮はその時点の候補集合から対象を選び直す。
            targetSelectionTiming: "on_step",
            repeat: {
              additional: {
                source: { kind: "count_value", player: "self" },
              },
            },
          },
          {
            action: {
              kind: "destroy",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
            },
            condition: [
              {
                kind: "count_value",
                player: "self",
                max: 0,
              },
            ],
            connector: "simultaneous",
          },
          {
            action: {
              kind: "destroy",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
              suppressDestroyedEffects: "destroyed_only",
            },
            condition: [
              {
                kind: "count_value",
                player: "self",
                min: 1,
              },
            ],
            connector: "simultaneous",
          },
          {
            condition: [{ kind: "count_value", player: "self", min: 2 }],
            connector: "sequential",
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "trash", player: "opponent" },
              amount: 1,
            },
          },
          {
            condition: [{ kind: "count_value", player: "self", min: 3 }],
            connector: "sequential",
            action: {
              kind: "restrict_use",
              player: "self",
              targetScope: "card",
              filter: {
                zone: ["hand", "set_aside"],
                excludeColors: ["yellow"],
              },
              duration: { scope: "attack" },
            },
          },
          {
            condition: [{ kind: "count_value", player: "self", min: 3 }],
            action: {
              kind: "restrict_use",
              player: "opponent",
              targetScope: "card",
              filter: {
                zone: ["hand", "set_aside"],
                excludeColors: ["yellow"],
              },
              duration: { scope: "attack" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0, 1, 2, 3, 4, 5],
      },
    ],
  },
  {
    cardNo: "BSTH04-X03",
    orikaId: 131,
    orikaIndex: 140,
    name: "小野塚 小町",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "yellow"],
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
      {
        level: 3,
        requiredCores: 4,
        bp: 10000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、自分のカウント+1できる。（ボイドからコア1個を自分のカウントエリアに置く）そうしたとき、このターンの間、相手のスピリット/アルティメット/ネクサス1つのLvコストを+2する。この効果で消滅したとき、ボイドからコア2個をこのスピリットに置く。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "ターン1回、ボイドからコア1個ずつを系統:「起幻」を持つ自分の導界者ネクサス2つに置き、このスピリットは回復する。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・冥主",
    image: "images/BSTH04-X03.webp",
    rarity: "X",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        // カウント+1 → そうしたとき相手1体のLvコスト+2（このターンの間、BSSL01-R01/BSKB01-M01
        // precedent同型 override_properties.levelCostDelta target count:1）→ その対象が
        // この効果 (levelCostDelta 発動ステップ) でコア不足消滅したとき、ボイドからコア2個を
        // 自身に置く。after_state_check で消滅成立を確認し、誘発・魂状態選択より先に続行する。
        steps: [
          {
            id: "count-up",
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
          },
          {
            id: "lv-cost-up",
            connector: "conditional_result",
            stepCondition: { kind: "ref_succeeded", stepId: "count-up" },
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate", "nexus"] },
                count: 1,
              },
              properties: { levelCostDelta: 2 },
              duration: { scope: "turn" },
            },
          },
          {
            connector: "after_state_check",
            stepCondition: {
              kind: "ref_leave_established",
              stepId: "lv-cost-up",
              leaveKind: "vanish",
            },
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: 2,
            },
          },
        ],
        textRef: [0, 1],
      },
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
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "core_distribute",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["起幻"],
                  targetsGrandwalker: "only",
                  grandwalkerKind: "guided",
                },
                count: 2,
              },
              amount: 2,
              mode: "one_each",
            },
          },
          {
            action: {
              kind: "recover",
              target: { kind: "self" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH04-XX01",
    orikaId: 132,
    orikaIndex: 141,
    name: "[導界者]四季映姫・ヤマザナドゥ",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: ["yellow"],
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
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・導技・導域は、神託・神技・神域としても扱う。",
      "",
      "【導託：〔幻想＆コスト3以上〕〔転醒ネクサス〕】",
      "◆対象の自分のスピリット/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、黄/紫としても扱う。",
      "",
      "【導技：4】Lv1-Lv2『自分のメインステップ』",
      "〔ターンに1回、このネクサスのコア4個をボイドに置く〕自分のデッキを上と下から1枚ずつトラッシュに置く。その後、トラッシュにある系統:「幻想」を持つスピリットカード/ネクサスカード1枚を手札に戻す。",
      "",
      "【導域】Lv2『自分のアタックステップ』",
      "系統:「起幻」を持つ本来のコストが5以上の自分の黄/紫のスピリットすべては、黄と紫シンボル1つずつになり、ブロックされない。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    tribe: "導界者・起幻・楽族",
    image: "images/BSTH04-XX01.webp",
    rarity: "XX",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        // 〔幻想＆コスト3以上〕は bullet1「対象の自分のスピリット/ネクサス」に
        // 合わせ categories で spirit/nexus に限定（マジックカードを対象外にする）。
        { tribes: ["幻想"], minCost: 3, categories: ["spirit", "nexus"] },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ],
      // 【導技：4】Lv1-Lv2『自分のメインステップ』〔ターンに1回、コア4個をボイドに置く〕。
      // 導技=神技扱い（textLines[0]）。コスト(コア4個→ボイド)・ターン制限は divineSkills
      // 経路でエンジンが検査・支払いするため、effects はコスト後の本体のみ。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 4,
          timing: "main",
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          // 自分のデッキを上と下から1枚ずつトラッシュに置く。その後、トラッシュにある
          // 系統:「幻想」を持つスピリットカード/ネクサスカード1枚を手札に戻す。
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    kind: "move_card",
                    from: { zone: "deck", player: "self", position: "top" },
                    to: { zone: "trash" },
                    count: 1,
                  },
                },
                {
                  action: {
                    kind: "move_card",
                    from: { zone: "deck", player: "self", position: "bottom" },
                    to: { zone: "trash" },
                    count: 1,
                  },
                  connector: "simultaneous",
                },
                {
                  targetSelectionTiming: "on_step",
                  action: {
                    kind: "search_zone",
                    zone: "trash",
                    filter: {
                      category: ["spirit", "nexus"],
                      tribes: ["幻想"],
                    },
                    count: 1,
                    destination: "hand",
                    mandatory: true,
                  },
                  connector: "sequential",
                },
              ],
              textRef: [8, 9],
            },
          ],
        },
      ],
    },
    // textLines[0] 導界者ネクサス共通ルール（対象効果限定・コア配置制限・導託/導技/導域=
    //   神託/神技/神域扱い）と textLines[2-3]【導託】は grandwalkerData(kind:"guided") +
    //   keywordTags で engine が表現する（DSL effect 不要）。
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "yellow",
            },
          },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【導技：4】(main) は grandwalkerData.divineSkills で表現（上記参照）。
      // 【導域】Lv2『自分のアタックステップ』 系統:「起幻」を持つ本来のコスト5以上の自分の
      //   黄/紫スピリットすべては「黄と紫シンボル1つずつ」になり、ブロックされない。
      //   - 「シンボル1つずつ になり」= 既存シンボルを置換する set 意味（追加ではない）。
      //     `override_properties.symbols: ["yellow", "purple"]` + symbolCountFixed で
      //     2 個のシンボル(黄1+紫1)に固定し、追加/合体分も抑止する。
      //   - 「ブロックされない」= 既存の `unblockable`。
      //   - 適用範囲は filter 一致 + count:"all" + while_on_field + timingScope
      //     （自分のアタックステップ中のみ CE 消費）。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        steps: [
          {
            action: {
              kind: "unblockable",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  colors: ["yellow", "purple"],
                  tribes: ["起幻"],
                  minCost: 5,
                  costBasis: "printed",
                },
                count: "all",
              },
              duration: {
                scope: "while_on_field",
              },
            },
          },
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  colors: ["yellow", "purple"],
                  tribes: ["起幻"],
                  minCost: 5,
                  costBasis: "printed",
                },
                count: "all",
              },
              properties: {
                symbols: ["yellow", "purple"],
                symbolCountFixed: true,
              },
              duration: { scope: "while_on_field" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
  {
    cardNo: "BSTH04-転醒R01(A)",
    orikaId: 133,
    orikaIndex: 142,
    name: "浄玻璃の鏡",
    printedCategory: "nexus",
    colors: ["yellow", "purple"],
    cost: 3,
    reductionSymbols: ["yellow", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: [],
    textLines: [
      "このネクサスは創界石ネクサス対象の効果しか受けない。このネクサスには解放と創界石ネクサス対象の効果でしかコアを置けず、そのコアは創界石ネクサス対象の効果しか受けず移動できない。",
      "",
      "【解封：〔系統：「楽族」／「冥主」を持つ自分の効果による自分の手札の増加〕】",
      "◆解放条件を満たしたとき、ボイドからコア1個をこのネクサスに置ける。",
      "",
      "Lv1【転醒：自分のカウント5以下（転醒は同時に使えない）】",
      "このネクサスのコアが4個以上になったとき、このネクサスを裏返せる。（置かれているコアは1個を残してボイドに置く。）",
      "",
      "Lv1『このネクサスの配置時』",
      "自分のデッキを上から2枚トラッシュに置ける。その中の系統：「起幻」を持つ黄/紫のカード1枚を手札に加えられる。",
      "",
      "【神秘】Lv1",
      "自分のトラッシュに系統：「起幻」を持つカードがある間、フィールドの6色のスピリット/アルティメット/ネクサス/創界神ネクサスの効果は発揮されない。",
    ],
    keywordTags: ["double_sided", "enter_field_core_placement_forbidden"],
    tribe: "創界石・起幻・幻想",
    image: "images/BSTH04-転醒R01(A).webp",
    rarity: "TR",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 創界石ネクサス本体ルール [0] + 【解封】[2,3]（楽族/冥主の自分の効果による手札増加）
    // + 転醒 [5,6]（コア4個以上・カウント5以下・1個残してボイド）は
    // grandstoneData + エンジン基盤で表現する。
    grandstoneData: {
      unsealConditions: [
        {
          events: ["hand_increase"],
          causeFilter: { tribes: ["楽族", "冥主"] },
        },
      ],
      rebirthCoreThreshold: 4,
      rebirthMaxCount: 5,
      rebirthRetainCores: 1,
    },
    effects: [
      // Lv1『このネクサスの配置時』デッキ上2枚をトラッシュ、その中の起幻 黄/紫1枚を手札へ。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        steps: [
          {
            id: "mirror-mill",
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "self", position: "top" },
              to: { zone: "trash" },
              count: 2,
            },
          },
          {
            executionMode: "optional",
            connector: "sequential",
            action: {
              kind: "search_zone",
              zone: "trash",
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                stepId: "mirror-mill",
                count: 1,
                filter: { colors: ["yellow", "purple"], tribes: ["起幻"] },
              },
              filter: { colors: ["yellow", "purple"], tribes: ["起幻"] },
              count: 1,
              mandatory: true,
              destination: "hand",
            },
          },
        ],
        textRef: [8, 9],
      },
      // 【神秘】Lv1 トラッシュに起幻がある間、6色のスピ/アル/ネクサス/創界神の効果は発揮されない。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            zone: "trash",
            tribes: ["起幻"],
          },
        ],
        steps: [
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit", "ultimate", "nexus"],
                  colors: ["red", "purple", "green", "white", "yellow", "blue"],
                  colorsLogic: "and",
                  colorCount: { min: 6, max: 6 },
                  targetsGrandwalker: true,
                },
                count: "all",
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
                  colors: ["red", "purple", "green", "white", "yellow", "blue"],
                  colorsLogic: "and",
                  colorCount: { min: 6, max: 6 },
                  targetsGrandwalker: true,
                },
                count: "all",
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [11, 12],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "金龍",
      printedCategory: "spirit",
      colors: ["purple", "yellow"],
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
          requiredCores: 2,
          bp: 11000,
        },
        {
          level: 3,
          requiredCores: 4,
          bp: 15000,
        },
      ],
      symbolColors: ["yellow", "purple"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』",
        "トラッシュのコア2個をこのスピリットに置ける。そうしたとき、ボイドからコア1個を自分のライフに置き、ターンに1回、このスピリットは回復できる。",
        "",
        "Lv1-Lv2-Lv3",
        "相手のフィールドの6色の効果は発揮されない。この効果は一切の効果で防げない。",
      ],
      keywordTags: [],
      tribe: "起幻・冥主・楽族",
      image: "images/BSTH04-転醒R01(B).webp",
      rarity: "TR",
      pack: "BSTH04 東方花映塚",
      cardNo: "BSTH04-転醒R01(B)",
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』トラッシュのコア2個をこの
        //   スピリットに置ける。そうしたとき、ボイドからコア1個を自分のライフに置き、
        //   ターンに1回、このスピリットは回復できる。
        {
          timing: { kind: "card_event", event: ["rebirth", "attack"] },
          executionMode: "optional",
          steps: [
            {
              id: "kinryu-trash-cores",
              action: {
                kind: "core_move",
                from: { kind: "trash", player: "self" },
                to: { kind: "this_card" },
                amount: 2,
              },
            },
            {
              action: {
                kind: "core_move",
                from: { kind: "void", player: "self" },
                to: { kind: "life", player: "self" },
                amount: 1,
              },
              connector: "conditional_result",
            },
            {
              action: { kind: "recover", target: { kind: "self" } },
              connector: "sequential",
              executionMode: "optional",
              stepCondition: {
                kind: "ref_succeeded",
                stepId: "kinryu-trash-cores",
              },
              usageLimit: { kind: "per_instance", duration: "turn" },
            },
          ],
          textRef: [2, 3],
        },
        // [5,6] Lv1-Lv2-Lv3 相手のフィールドの6色の効果は発揮されない。
        //   この効果は一切の効果で防げない。
        // 6色 = 赤/紫/緑/白/黄/青（black は7色目で対象外）。colorsLogic:"and" で
        // 6色すべてを併せ持つカードのみ抑止。count:"all" + filter で
        // ENGINE-dynamic-filter-suppress（動的フィルタ continuous suppress）を起動し、
        // 登録後に場へ出た6色カードも消費側 (effect_suppression 再評価) で動的に止める。
        // 六色は七色と別物（qa-028）。発揮抑止自体の防止不可も保持する。
        {
          timing: { kind: "continuous" },
          preventionLevel: "unpreventable",
          targetLockBypass: { kind: "all_effects" },
          steps: [
            {
              action: {
                kind: "suppress_effect",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    colors: [
                      "red",
                      "purple",
                      "green",
                      "white",
                      "yellow",
                      "blue",
                    ],
                    colorsLogic: "and",
                    colorCount: { min: 6, max: 6 },
                  },
                  count: "all",
                },
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5, 6],
        },
      ],
    },
  },
  {
    cardNo: "BSTH04-転醒R02(A)",
    orikaId: 134,
    orikaIndex: 143,
    name: "太陽の畑",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow", "purple"],
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
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "ライフが増えた/減ったか、このネクサスが相手によってフィールドを離れるとき、このネクサスを裏返せる。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "相手のスピリット1体をBP-5000でき、BPが0になったスピリットを破壊する。",
      "",
      "Lv2『自分のアタックステップ』",
      "系統：「楽族」/「冥主」を持つ自分のスピリットのターン最初のアタック宣言からバトル終了後まで、相手はスタック効果を発揮できない。",
    ],
    keywordTags: ["double_sided"],
    tribe: "起幻・幻想",
    image: "images/BSTH04-転醒R02(A).webp",
    rarity: "TR",
    pack: "BSTH04 東方花映塚",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2【転醒：自分のカウント3以下（転醒は同時に使えない）】ライフ増減 or
      // このネクサスが相手によってフィールドを離れるとき、このネクサスを裏返せる。
      // ライフ増加 = core_placed_on_life（P3-14 C-2）、ライフ減少 = reduce_life。
      // 人称指定がないため、自分・相手どちらのライフ増減でも誘発する。
      // BSTH005-TX01(A)/BSTH09.2-転醒R03(A) 先例と同型の2エントリ分割
      // (game_event + card_event leave_field) を踏襲。
      {
        timing: {
          kind: "game_event",
          player: "either",
          event: ["reduce_life", "core_placed_on_life"],
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [0, 1],
      },
      // Lv1-Lv2【転醒：自分のカウント3以下】このネクサスが相手によってフィールドを離れるとき裏返せる。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: "opponent_effect",
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [0, 1],
      },
      // Lv1-Lv2『このネクサスの配置時』相手のスピリット1体をBP-5000でき、BP0破壊。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        steps: [
          {
            id: "bp0",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              amount: -5000,
              duration: { scope: "turn" },
            },
          },
          {
            action: {
              kind: "destroy",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2『自分のアタックステップ』楽族/冥主スピリットのターン最初のアタック宣言〜
      // バトル終了後まで、相手はスタック効果を発揮できない。
      // 常時効果。対象系統全体で最初の宣言窓から、そのバトルの終了後まで有効。
      // qa-024: effect_source 制限はネクサス耐性で防げる。窓自体は閉じない。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        applicability: { level: { min: 2 } },
        condition: [
          {
            kind: "attack_occurred",
            scope: "turn",
            player: "self",
            cardFilter: { category: ["spirit"], tribes: ["楽族", "冥主"] },
            currentBattleOrdinal: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "restrict_stack",
              player: "opponent",
              duration: { scope: "while_on_field" },
              targetScope: "effect_source",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "彼岸",
      printedCategory: "nexus",
      colors: ["purple"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 0,
        },
      ],
      symbolColors: ["purple"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1『このネクサスの転醒時』",
        "トラッシュの系統：「楽族」/「冥主」を持つコスト5以下のスピリットカード1枚をコストを支払わずに召喚できる。召喚するスピリットのコアは、トラッシュからも1個まで置ける。",
        "",
        "Lv1 スタック『相手のアタックステップ』",
        "アタック宣言する相手のスピリットのコア1個をトラッシュに置く。この効果でコアを0個にできない。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想",
      image: "images/BSTH04-転醒R02(B).webp",
      rarity: "TR",
      pack: "BSTH04 東方花映塚",
      cardNo: "BSTH04-転醒R02(B)",
      effects: [
        // [0] この面に裏返ったとき、フィールドに残り、カウント+1する。
        //   この行はルール (08a_advent-rebirth-contract.md §2 手順3、効果ではない) —
        //   executeRebirth が countValue+1 を適用済みのため effects に書かない
        //   (効果化すると二重計上＋効果無効の影響を受ける)。
        //   旧変換は表面 (太陽の畑) の『配置時』BP-5000/破壊と Lv2 スタック抑止 stub を
        //   そのまま B 面へ誤コピーしていた (B 面の印字テキストに存在しない効果)。
        //   2026-06-10 監査で除去し、印字どおりの 2 効果に置換。
        // [2,3] Lv1『このネクサスの転醒時』トラッシュの系統:「楽族」/「冥主」を持つ
        //   コスト5以下のスピリットカード1枚をコストを支払わずに召喚できる。
        //   summon(from_zone trash, free) = executeSummonOther 経由。召喚時コア配置
        //   (リザーブ→最低Lvコア) まで行う正規召喚パイプライン
        //   (search_zone destination:field は配置プリミティブでコア配置が無く、
        //    コア0のまま SBA コア不足消滅するため使わない)。
        {
          timing: { kind: "card_event", event: "rebirth" },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: {
                    category: ["spirit"],
                    tribes: ["楽族", "冥主"],
                    maxCost: 5,
                  },
                  count: 1,
                },
                costModifier: "free",
                // 後段「召喚するスピリットのコアは、トラッシュからも1個まで置ける」=
                // 維持コア配置のうち最大1個をトラッシュ源で充当 (SummonAction.trashCoreMax)。
                // 「《ソウルコア》以外」の明示がないため generic として扱う。
                trashCoreMax: 1,
                trashCoreKind: "generic",
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5,6] Lv1 スタック『相手のアタックステップ』アタック宣言する相手のスピリットの
        //   コア1個をトラッシュに置く。この効果でコアを0個にできない。
        //   未成立のアタック宣言のスピリットだけを対象にする。成立後の別スタックでは使わない。
        //   「コアを0個にできない」= minRemainingPerCandidate:1（コア1個のカードは候補外）。
        //   「置く」= 強制（min-remaining により取れる対象が無ければ no-op）。
        {
          timing: { kind: "activated", mode: "stack" },
          timingScope: { player: "opponent", period: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: {
                  kind: "field",
                  player: "opponent",
                  filter: {
                    pendingDeclaration: "attack",
                    category: ["spirit"],
                  },
                  minRemainingPerCandidate: 1,
                },
                to: { kind: "trash", player: "opponent" },
                amount: 1,
              },
            },
          ],
          textRef: [5, 6],
        },
      ],
    },
  },
];
