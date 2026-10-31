import type { CardDefinition } from "@orica/rules-core";

export const BSTH01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH01-C01",
    orikaId: 1,
    orikaIndex: 45,
    name: "毛玉",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 2000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "このカード/スピリットのコストは3としても扱う。ただし、召喚コストは変化しない。",
    ],
    keywordTags: [],
    tribe: "幻想・楽族",
    image: "images/BSTH01-C01.webp",
    rarity: "C",
    pack: "BSTH01 東方紅魔郷",
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
              kind: "cost_modify",
              target: {
                kind: "self",
              },
              modifier: {
                additionalCostValue: 3,
              },
            },
          },
        ],
        textRef: [0],
      },
    ],
  },
  {
    cardNo: "BSTH01-C02",
    orikaId: 54,
    orikaIndex: 46,
    name: "[スターシーカー/幼き光]霧雨 魔理沙",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 2000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から4枚オープンできる。その中の黄の導界者ネクサスカード1枚と、系統：「幻想」を持つ黄のスピリットカード1枚と、系統：「導魔」を持つブレイヴカード2枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2",
      "相手のスピリット/アルティメットすべてをBP-2000する。",
    ],
    keywordTags: [],
    tribe: "幻想・楽族",
    image: "images/BSTH01-C02.webp",
    rarity: "C",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
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
              revealCount: 4,
              picks: [
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    colors: ["yellow"],
                    tribes: ["導界者"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["spirit"],
                    colors: ["yellow"],
                    tribes: ["幻想"],
                  },
                },
                {
                  mandatory: true,
                  count: 2,
                  filter: {
                    category: ["brave"],
                    tribes: ["導魔"],
                  },
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: "all",
              },
              amount: -2000,
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH01-C04",
    orikaId: 55,
    orikaIndex: 47,
    name: "ルーミア",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
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
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の系統：「紅魔」/「夜族」を持つスピリットカード1枚と、系統：「紅魔」を持つカード1枚を手札に加える。残ったカードは好きな順番でデッキの上か下だけに戻す。",
      "",
      "Lv2-Lv3『自分のメインステップ』",
      "自分の創界神ネクサス/導界者ネクサスがないとき、このスピリットに赤のシンボル2つを追加する。この効果は重複しない。",
    ],
    keywordTags: [],
    tribe: "幻想・紅魔",
    image: "images/BSTH01-C04.webp",
    rarity: "C",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
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
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["spirit"],
                    tribes: ["紅魔", "夜族"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    tribes: ["紅魔"],
                  },
                },
              ],
              remainder: "top_or_bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "continuous",
        },
        timingScope: {
          player: "self",
          period: "main",
        },
        applicability: {
          level: { min: 2, max: 3 },
        },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            tribes: ["導界者", "創界神"],
          },
        ],
        usageLimit: {
          kind: "no_duplicate",
        },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: {
                kind: "self",
              },
              symbol: "red",
              duration: {
                scope: "while_on_field",
              },
            },
          },
          {
            action: {
              kind: "symbol_add",
              target: {
                kind: "self",
              },
              symbol: "red",
              duration: {
                scope: "while_on_field",
              },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH01-C05",
    orikaId: 56,
    orikaIndex: 48,
    name: "[紅魔郷]チルノ",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white"],
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
    ],
    symbolColors: ["white"],
    textLines: [
      "このカード/スピリットのシンボル/軽減シンボルは赤としても扱う。",
      "",
      "Lv1-Lv2『このスピリットの召喚/アタック時』",
      "相手のスピリット1体を手札に戻せる。または、自分の創界神ネクサス/導界者ネクサスがなければ、自分はデッキから2枚ドローできる。これらの効果はターンに1回ずつしか使えない。",
    ],
    keywordTags: [],
    tribe: "幻想・紅魔・妖精",
    image: "images/BSTH01-C05.webp",
    rarity: "C",
    pack: "BSTH01 東方紅魔郷",
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
              asColor: "red",
              appliesToCard: true,
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
            },
            usageLimit: {
              kind: "per_instance",
              duration: "turn",
            },
            choice: [
              {
                action: {
                  kind: "draw",
                  count: 2,
                },
                usageLimit: {
                  kind: "per_instance",
                  duration: "turn",
                },
                condition: [
                  {
                    kind: "field_lacks",
                    player: "self",
                    category: ["nexus"],
                    tribes: ["導界者", "創界神"],
                  },
                ],
              },
            ],
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH01-C11",
    orikaId: 57,
    orikaIndex: 49,
    name: "霧雨魔法店",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 0,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "自分の黄の効果でデッキからオープンされたこのカードは、手札に加えられる。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "トラッシュにある系統：「幻想」/「導魔」/「楽族」を持つ黄1色のカード2枚を手札に戻す。",
      "",
      "Lv2",
      "相手の効果で自分のライフが1ターンで2以上減るとき、減るライフの数1につき、ボイドからコア1個を自分のライフに置く。",
    ],
    keywordTags: [],
    image: "images/BSTH01-C11.webp",
    rarity: "C",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "revealed",
        },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          {
            kind: "trigger_colors",
            colors: ["yellow"],
          },
          {
            kind: "trigger_from_zone",
            zones: ["deck"],
          },
        ],
        steps: [
          {
            action: {
              kind: "move_self",
              destination: "hand",
            },
          },
        ],
        executionMode: "optional",
        textRef: [0],
      },
      {
        timing: {
          kind: "card_event",
          event: "place",
        },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: {
                colors: ["yellow"],
                // 原文「黄1色のカード2枚」= 黄単色（多色含まず）。
                // card-filter.ts: colors は既定 OR 一致、colorCount:"mono" で
                // 「色を1つしか持たないカード」に絞る (verifier round 2 指摘)。
                colorCount: "mono",
                tribes: ["幻想", "導魔", "楽族"],
              },
              count: 2,
              destination: "hand",
              mandatory: true,
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          level: { min: 2 },
        },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "opponent_effect",
              mode: "before",
              turnThreshold: 2,
              coreAction: {
                from: {
                  kind: "void",
                  player: "self",
                },
                to: {
                  kind: "life",
                  player: "self",
                },
                amount: {
                  source: {
                    kind: "event_amount",
                  },
                },
              },
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH01-C12",
    orikaId: 58,
    orikaIndex: 50,
    name: "ヴワル魔法図書館",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "purple", "red", "red"],
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
    symbolColors: [],
    textLines: [
      "このカード/ネクサスは、系統：「幻想」/「紅魔」を持つ。",
      "",
      "Lv1-Lv2『自分のドローステップ』",
      "ドローの枚数を+2する。ドロー後、自分は、手札のカード3枚か、系統：「紅魔」を持つカード1枚を破棄する。この効果は重複しない。",
      "",
      "Lv2『自分のメインステップ』",
      "自分のライフのコア1個をトラッシュに置くことで、このステップの間、このネクサスに赤/紫として扱うシンボル2つを追加する。この効果はターンに1回しか使えない。",
    ],
    keywordTags: [],
    tribe: "幻想・紅魔",
    image: "images/BSTH01-C12.webp",
    rarity: "C",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // Lv1-Lv2『自分のドローステップ』ドロー +2 → そのまま破棄選択。
        // inline: true により誘発キューを経由せず turn-system.ts のドローステップ処理が
        // 直接プレ (draw_modify amount を加算) → システムドロー → ポスト (discard) を実行する。
        timing: {
          kind: "phase",
          step: "draw",
          subPhase: "start",
          whose: "self",
        },
        inline: true,
        usageLimit: {
          kind: "no_duplicate",
        },
        executionMode: "mandatory",
        steps: [
          {
            // プレ: ドロー枚数 +2 (inline 集計、CE 登録なし)
            action: {
              kind: "draw_modify",
              amount: 2,
              duration: {
                scope: "step",
                step: "draw",
              },
            },
          },
          {
            // ポスト: 手札3枚 or 紅魔1枚を破棄
            action: {
              kind: "discard",
              count: 3,
            },
            choice: [
              {
                action: {
                  kind: "discard",
                  count: 1,
                  filter: {
                    tribes: ["紅魔"],
                  },
                },
              },
            ],
          },
        ],
        textRef: [2, 3],
      },
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "main",
        },
        applicability: {
          level: { min: 2 },
        },
        usageLimit: {
          // 「この効果はターンに1回しか使えない」は同名カード全体の共有制限。
          // 同名の別ネクサスから同一ターンに重ねて発揮することはできない。
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            // コスト: 自分のライフのコア1個をトラッシュに置く
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "trash", player: "self" },
              amount: 1,
            },
          },
          {
            // 一つの対価に対する2シンボルを一つの結果として追加する。
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: ["red", "purple"],
              count: 2,
              duration: { scope: "step", step: "main" },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH01-C21",
    orikaId: 59,
    orikaIndex: 51,
    name: "彗星「ブレイジングスター」",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」を持つ。",
      "自分の黄の効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられ、トラッシュから手札に加えたとき、ボイドからコア1個を自分の黄の導界者ネクサスに置く。",
      "",
      "フラッシュ",
      "このバトルの間、系統：「幻想」と「導魔」/「楽族」を持つ自分の黄のスピリット1体はブロックされない。または、ただちにアタックステップを終了する。これらの効果が相手の効果を受けなかったとき、ゲーム中に1回ずつしか使えない。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH01-C21.webp",
    rarity: "C",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["revealed", "moved_to_trash"],
        },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          {
            kind: "trigger_colors",
            colors: ["yellow"],
          },
          {
            kind: "trigger_from_zone",
            zones: ["deck"],
          },
        ],
        steps: [
          {
            action: {
              kind: "move_self",
              destination: "hand",
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["導界者"],
                  colors: ["yellow"],
                  targetsGrandwalker: "only",
                  grandwalkerKind: "guided",
                },
              },
              amount: 1,
            },
          },
        ],
        executionMode: "optional",
        textRef: [1],
      },
      // フラッシュ:「ブロックされない」**または**「ただちにアタックステップを終了」の二択
      // (choice で表現)。「これらの効果が相手の効果を受けなかったとき、ゲーム中に1回ずつ
      // しか使えない」= usageLimit.unlessAffectedByOpponent (P3-14 C-2 effect_resisted)。
      // 相手の「終了できない」妨害 (restrict_end_attack_step) を受けた使用は制限を消費しない。
      // 「1回ずつ」= 選択肢ごとに独立したゲーム1回。step.usageLimit (デフォルト変種) と
      // choice[0].usageLimit (変種1) に per-entry で付け、変種別ラベルで独立に封鎖される。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "unblockable",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  colors: ["yellow"],
                  tribes: ["導魔", "楽族"],
                  tribesRequired: ["幻想"],
                },
                count: 1,
              },
              duration: {
                scope: "battle",
              },
            },
            usageLimit: {
              kind: "per_card_name",
              duration: "game",
              unlessAffectedByOpponent: true,
            },
            choice: [
              {
                action: {
                  kind: "end_attack_step",
                },
                usageLimit: {
                  kind: "per_card_name",
                  duration: "game",
                  unlessAffectedByOpponent: true,
                },
              },
            ],
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH01-C22",
    orikaId: 60,
    orikaIndex: 52,
    name: "土符「レイジィトリリトン」",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "purple"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「紅魔」/「導魔」を持つ。",
      "このカードの軽減シンボルは、赤としても扱う。",
      "",
      "メイン",
      "自分は、デッキの上から3枚ドローする。この効果はターンに1回しか使えない。",
      "",
      "フラッシュ",
      "相手のフィールドのコア2個を相手のリザーブに置く。",
    ],
    keywordTags: [],
    tribe: "紅魔・導魔",
    image: "images/BSTH01-C22.webp",
    rarity: "C",
    pack: "BSTH01 東方紅魔郷",
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
              aspects: ["reduction_symbol"],
              asColor: "red",
              appliesToCard: true,
              cardStateOnly: true,
            },
          },
        ],
        textRef: [1],
      },
      {
        timing: {
          kind: "activated",
          mode: "main",
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "draw",
              count: 3,
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
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
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH01-M01",
    orikaId: 61,
    orikaIndex: 53,
    name: "パチュリー・ノーレッジ",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: ["purple", "purple", "purple", "red", "red"],
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
        bp: 11000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "このカード/スピリットの色とシンボルは赤としても扱う。",
      "手札にあるこのカードは、同じカード名の自分のスピリットがいなければ、『自分のスタートステップ』に1枚のみ1コスト支払って召喚できる。",
      "",
      "Lv1-Lv2-Lv3",
      "回復状態のこのスピリットは、相手の効果を受けない。自分は、系統：「紅魔」/「導魔」を持つマジックカードをコストを支払わずに使用できる。",
      "",
      "Lv2-Lv3『自分のアタックステップ開始時』",
      "系統：「紅魔」を持つ自分のスピリットすべてを回復状態にし、トラッシュにあるコアすべてをそれらのスピリットに置ける。",
    ],
    keywordTags: [],
    tribe: "幻想・紅魔・導魔",
    image: "images/BSTH01-M01.webp",
    rarity: "M",
    pack: "BSTH01 東方紅魔郷",
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
              aspects: ["color", "symbol"],
              asColor: "red",
              appliesToCard: true,
            },
          },
        ],
        textRef: [0],
      },
      {
        // Q54 型「常時効果が通常召喚を許可」: 発揮宣言を持つ即時効果ではなく、
        // 通常 summon legal action を追加する。normalActionPermission が分類の明示的な正源。
        // 1 コスト支払い → stack window → 維持コア配置の通常召喚順序を使う。
        applicability: {
          zone: "hand",
        },
        timing: { kind: "continuous" },
        timingScope: {
          player: "self",
          period: "start",
          subPhase: "start",
        },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            cardName: "self",
            excludeSelf: true,
          },
        ],
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              normalActionPermission: true,
              target: {
                kind: "self",
              },
              costModifier: {
                fixedPayment: 1,
              },
            },
          },
        ],
        textRef: [1],
      },
      {
        timing: {
          kind: "continuous",
        },
        condition: [
          {
            kind: "self_state",
            state: "recovered",
          },
        ],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "self",
              },
              duration: {
                scope: "permanent",
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "self",
              cardFilter: {
                category: ["magic"],
                tribes: ["紅魔", "導魔"],
              },
              modifier: "free",
              duration: {
                scope: "permanent",
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "phase",
          step: "attack",
          subPhase: "start",
        },
        applicability: {
          level: { min: 2, max: 3 },
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              state: "recovered",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["紅魔"],
                },
                count: "all",
              },
            },
          },
          {
            action: {
              kind: "core_move",
              from: {
                kind: "trash",
                player: "self",
              },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["紅魔"],
                },
              },
              amount: "all",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH01-M03",
    orikaId: 62,
    orikaIndex: 54,
    name: "森近 霖之助",
    printedCategory: "spirit",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 6,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 4000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "自分の手札が6枚以下の間、このカードの召喚コストを3にする。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から5枚オープンできる。その中の導界者ネクサスカードすべてか、1コスト支払うことで、系統：「幻想」を持つスピリットカード2枚までを手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "【界放:1】 Lv2『このスピリットのアタック時』",
      "相手のデッキを上から1枚オープンし、デッキの上に戻す。 または、自分の導界者ネクサスのコア1個をこのスピリットに置くことで、デッキの下に戻す。",
    ],
    keywordTags: [],
    tribe: "幻想・道具屋",
    image: "images/BSTH01-M03.webp",
    rarity: "M",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        condition: [
          {
            kind: "hand_count",
            player: "self",
            max: 6,
          },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: {
                kind: "self",
              },
              modifier: {
                override: 3,
              },
              duration: {
                scope: "permanent",
              },
            },
          },
        ],
        textRef: [0],
      },
      // 確定裁定 2026-07-12: 公開内容を見てから二択。公開自体は任意。
      // 07c_card-observed-mechanics-extra.md。霖之助の「2枚まで」は0枚でも支払う。
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        steps: [
          {
            id: "reveal",
            action: {
              kind: "deck_reveal",
              revealCount: 5,
              picks: [],
              beforePickSteps: [
                {
                  id: "mode",
                  label: "導界者ネクサスすべてを手札に加える",
                  targetSelectionTiming: "on_step",
                  action: {
                    kind: "move_card",
                    target: {
                      kind: "filter",
                      player: "self",
                      zone: "revealed",
                      stepId: "reveal",
                      filter: {
                        category: ["nexus"],
                        tribes: ["導界者"],
                      },
                      count: "all",
                    },
                    from: {
                      zone: "revealed",
                      player: "self",
                    },
                    to: {
                      zone: "hand",
                    },
                    count: "all",
                  },
                  choice: [
                    {
                      label:
                        "1コスト支払って幻想スピリット2枚までを手札に加える",
                      action: {
                        kind: "pay_cost",
                        amount: 1,
                      },
                    },
                  ],
                },
                {
                  targetSelectionTiming: "on_step",
                  action: {
                    kind: "move_card",
                    target: {
                      kind: "filter",
                      player: "self",
                      zone: "revealed",
                      stepId: "reveal",
                      filter: {
                        category: ["spirit"],
                        tribes: ["幻想"],
                      },
                      count: {
                        min: 0,
                        max: 2,
                      },
                    },
                    from: {
                      zone: "revealed",
                      player: "self",
                    },
                    to: {
                      zone: "hand",
                    },
                    count: "all",
                  },
                  stepCondition: {
                    kind: "all",
                    conditions: [
                      {
                        kind: "ref_choice",
                        stepId: "mode",
                        choiceIndex: 1,
                      },
                      {
                        kind: "ref_succeeded",
                        stepId: "mode",
                      },
                    ],
                  },
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        // 【界放:1】 Lv2『このスピリットのアタック時』
        // 「相手のデッキを上から1枚オープンし、デッキの上に戻す。または、自分の導界者ネクサス
        //   のコア1個をこのスピリットに置くことで、デッキの下に戻す。」
        // アタック時は choice + ref_choice + conditional_cost で 2 variant 排他化。
        // - mode 0 (default, free): 相手デッキ 1 枚オープン → 上 (top)
        // - mode 1 (alt cost = 界放:1): 自分の導界者ネクサスのコア 1 個 → このスピリット
        //   を支払い、相手デッキ 1 枚オープン → 下 (bottom)
        // 既存 choice 排他基盤 (P3-14 D-6) を使い、pay_cost ではなく core_move
        // from:field_card filter (自分の導界者ネクサス) → to:this_card amount:1 を alt cost と
        // して扱う。choice pre-gate は requiredCoreMoveCost を見る canPayRequiredEffectCosts
        // (legal-actions-availability) が、候補ネクサスの可動コア合計が 1 未満のとき variant 1 を抑止する。
        timing: {
          kind: "card_event",
          event: "attack",
        },
        applicability: {
          level: { min: 2 },
        },
        executionMode: "optional",
        steps: [
          {
            id: "mode",
            action: {
              kind: "deck_reveal",
              player: "opponent",
              revealCount: 1,
              picks: [],
              remainder: "top",
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
                      tribes: ["導界者"],
                      targetsGrandwalker: true,
                    },
                  },
                  to: { kind: "this_card" },
                  amount: 1,
                },
              },
            ],
          },
          {
            action: {
              kind: "deck_reveal",
              player: "opponent",
              revealCount: 1,
              picks: [],
              remainder: "bottom",
            },
            stepCondition: {
              kind: "ref_choice",
              stepId: "mode",
              choiceIndex: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH01-M13",
    orikaId: 63,
    orikaIndex: 55,
    name: "大妖精",
    printedCategory: "spirit",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 6,
    reductionSymbols: ["red", "purple", "green", "white", "yellow", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 10000,
      },
    ],
    symbolColors: [],
    textLines: [
      "セットしている/トラッシュにあるこのカードは、一切の効果を受けない。",
      "",
      "【バースト：自分のライフ減少後】",
      "このスピリットカードをコストを支払わずに召喚する。その後、このバトル終了時、アタックステップを終了する。この効果は、相手の「バースト効果を発揮できない」効果を無視して発揮できる。",
      "",
      "Lv1-Lv2",
      "このスピリットは、自分のフィールドにあるすべてのシンボルとして扱うシンボル1つを得る。このスピリットは、このスピリット以外の系統：「妖精」を持つ自分のスピリット/アルティメットがいないとき、アタック/ブロックできない。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・妖精",
    image: "images/BSTH01-M13.webp",
    rarity: "M",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // セットしている/トラッシュにあるこのカードは「一切の効果を受けない」=
      // sourcePlayerScope:"any" で自分起因の効果も含めて gate する (BSTH04-R01 等と同型、
      // ただし zone 束縛は burst_set + trash の dual)。permanent + applicability:
      // ["burst_set","trash"] により rebuild が burst/trash 滞在中のみ CE 登録、recompute が
      // それ以外のゾーンへ遷移したら除去する。
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          zone: ["burst_set", "trash"],
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "self",
              },
              duration: {
                scope: "permanent",
              },
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
        // 「この効果は、相手の『バースト効果を発揮できない』効果を無視して発揮できる」(P3-77)。
        // 「発揮できない」(cannot_activate) のみ能動バイパス。「無効にする」(nullify) は受ける。
        // セット中の「一切の効果を受けない」は zone 束縛(節①型)で、発揮(解決)時点には及ばない。
        ignoresOpponentCannotActivateBurst: true,
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
              costModifier: "free",
            },
          },
          {
            action: {
              kind: "end_attack_step",
            },
            connector: "sequential",
            // 原文「その後、このバトル終了時、アタックステップを終了する」= 発揮即終了ではなく
            // 当該バトル終了時に予約。summon は即時、本 step のみ遅延 (step 単位 deferTo)。
            deferTo: "battle_end",
          },
        ],
        textRef: [2, 3],
      },
      {
        // 「自分のフィールドにあるすべてのシンボルとして扱うシンボル1つを得る」= 1シンボルが
        // 複数色として機能する dual-color bundle (modifierSymbol[] 既存モデル) を、
        // symbolSource:"field_colors_present" で live 評価する（自分のフィールド上の各カードの
        // base symbolColors を union）。field 構成の変化に応じて getEffectiveSymbols 参照時に
        // 毎回再評価されるため、CE 側の再登録は不要。
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: {
                kind: "self",
              },
              symbolSource: {
                kind: "field_colors_present",
                player: "self",
              },
              duration: {
                scope: "permanent",
              },
            },
          },
        ],
        textRef: [5, 6],
      },
      {
        timing: {
          kind: "continuous",
        },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            tribes: ["妖精"],
            excludeSelf: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "self",
              },
              restriction: ["attack", "block"],
              duration: {
                scope: "permanent",
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH01-R02",
    combinedBoost: 4000,
    orikaId: 64,
    orikaIndex: 56,
    name: "魔理沙の箒",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 6,
    reductionSymbols: ["yellow", "yellow", "yellow", "yellow"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["yellow"],
    braveCondition: {
      tribes: ["導魔"],
      minCost: 6,
    },
    textLines: [
      "【合体条件：導魔＆コスト6以上】",
      "【合体中】『このスピリットのアタック時』",
      "バトル終了時、このバトルで破壊した相手のスピリット/アルティメット1体につき、相手のライフのコア1個を相手のリザーブに置く。",
    ],
    keywordTags: [],
    tribe: "幻想・導魔",
    image: "images/BSTH01-R02.webp",
    rarity: "R",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【合体中】『このスピリットのアタック時』バトル終了時、このバトルで破壊した
      // 相手のスピリット/アルティメット1体につき、相手のライフのコア1個をリザーブへ。
      // P3-14 C-5: amount は battle_end イベントの event_amount
      // (ActiveAttack.battleDestroyedRecords 由来) で動的解決。
      // action:"attack" でアタック側参加時のみ誘発（ブロック時は発揮しない）。
      {
        timing: {
          kind: "card_event",
          event: "battle_end",
          action: "attack",
        },
        applicability: {
          combined: true,
        },
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "life",
                player: "opponent",
              },
              to: {
                kind: "reserve",
                player: "opponent",
              },
              amount: {
                source: { kind: "event_amount" },
              },
            },
          },
        ],
        textRef: [1, 2],
      },
    ],
  },
  {
    cardNo: "BSTH01-R03",
    combinedBoost: 2000,
    orikaId: 65,
    orikaIndex: 57,
    name: "ミニ八卦炉",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["yellow"],
    braveCondition: {
      tribes: ["導魔"],
      minCost: 6,
    },
    textLines: [
      "【合体条件：導魔＆コスト6以上】",
      "【合体中】『このスピリットのアタック時』",
      "このターンの間、相手のスピリット/アルティメット1体をBP-10000し、BPが0になったスピリット/アルティメットを破壊する。",
    ],
    keywordTags: [],
    tribe: "幻想・導魔",
    image: "images/BSTH01-R03.webp",
    rarity: "R",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        applicability: {
          combined: true,
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
          },
          {
            action: {
              kind: "destroy",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [1, 2],
      },
    ],
  },
  {
    cardNo: "BSTH01-R04",
    orikaId: 66,
    orikaIndex: 58,
    name: "紅 美鈴",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
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
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のデッキを上から4枚オープンできる。その中の系統：「紅魔」を持つカード2枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。この効果はターンに1回しか使えない。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットは、アタックできず、相手の効果でフィールドを離れない。",
      "",
      "Lv2-Lv3『自分のメインステップ』",
      "自分の創界神ネクサス/導界者ネクサスがなければ、このスピリットに赤/紫として扱うシンボル2つを追加する。",
    ],
    keywordTags: [],
    tribe: "幻想・紅魔・竜渡",
    image: "images/BSTH01-R04.webp",
    rarity: "R",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  mandatory: true,
                  count: 2,
                  filter: {
                    tribes: ["紅魔"],
                  },
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "self",
              },
              restriction: ["attack"],
              duration: {
                scope: "permanent",
              },
            },
          },
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "self",
              },
              resistsOutcome: "leave_field",
              source: "opponent_effect",
              duration: {
                scope: "permanent",
              },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          level: { min: 2, max: 3 },
        },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            tribes: ["導界者", "創界神"],
          },
        ],
        timingScope: {
          player: "self",
          period: "main",
        },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: {
                kind: "self",
              },
              symbol: ["red", "purple"],
              duration: {
                scope: "while_on_field",
              },
            },
          },
          {
            action: {
              kind: "symbol_add",
              target: {
                kind: "self",
              },
              symbol: ["red", "purple"],
              duration: {
                scope: "while_on_field",
              },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH01-R05",
    orikaId: 67,
    orikaIndex: 59,
    name: "小悪魔",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red", "red"],
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
        bp: 6000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "このカード/スピリットのシンボル/軽減シンボルは紫としても扱う。",
      "",
      "メイン【アクセル：コスト3<赤>（この効果は手札から使用できる）】",
      "〔ターンに1回：同名〕自分のデッキを上から3枚トラッシュに置く。その中の系統：「紅魔」を持つカード1枚につき、ボイドからコア1個を自分のリザーブ/トラッシュに置く。(リザーブに置ける数は、この効果の使用コストでトラッシュに置かれたコアの数まで)",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "トラッシュにある系統：「紅魔」を持つカード1枚を手札に戻す。",
    ],
    keywordTags: ["accel"],
    tribe: "幻想・紅魔・夜族",
    image: "images/BSTH01-R05.webp",
    rarity: "R",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    accelData: {
      timing: "main",
      cost: 3,
      reduction: ["red"],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          usageLimit: { kind: "per_card_name", duration: "turn" },
          steps: [
            {
              id: "discardedTop3",
              action: {
                kind: "move_card",
                from: { zone: "deck", player: "self", position: "top" },
                to: { zone: "trash" },
                count: 3,
              },
            },
            {
              action: {
                kind: "core_move",
                from: { kind: "void", player: "self" },
                amount: {
                  source: {
                    kind: "cards_from_ref",
                    stepId: "discardedTop3",
                    filter: { tribes: ["紅魔"] },
                  },
                },
                splitDestinations: {
                  destinations: [
                    {
                      location: { kind: "reserve", player: "self" },
                      cap: { source: { kind: "cost_paid_this_effect" } },
                    },
                    { location: { kind: "trash", player: "self" } },
                  ],
                },
              },
            },
          ],
          textRef: [2, 3],
        },
      ],
    },
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
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: {
                tribes: ["紅魔"],
              },
              count: 1,
              destination: "hand",
              mandatory: true,
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH01-R11",
    orikaId: 68,
    orikaIndex: 60,
    name: "星符「サテライトイリュージョン」",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」を持つ。",
      "",
      "フラッシュ",
      "このターンの間、系統：「幻想」と「導魔」/「楽族」を持つ自分のスピリットがアタックしたとき、相手のスピリット/アルティメットすべてをBP-2000する（上限：6回）。この効果は白の効果では防げない。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH01-R11.webp",
    rarity: "R",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: "all",
              },
              amount: -2000,
              duration: {
                scope: "turn",
              },
            },
            retrigger: {
              event: "attack",
              triggerPlayer: "self",
              triggerFilter: {
                category: ["spirit"],
                tribesRequired: ["幻想"],
                tribes: ["導魔", "楽族"],
              },
              maxCount: 6,
              duration: {
                scope: "turn",
              },
            },
          },
        ],
        // 「この効果は白の効果では防げない」= 「Xの効果では防げない」型（X以外が防げる、
        // Q9751/P3-140）。colorMatchMode:"exact" は BSTH002-X01 と同じ convention
        // （色一致は単色一致で判定、他色混在の白カードは対象外）。
        preventionRestriction: {
          notPreventableByColors: ["white"],
          colorMatchMode: "exact",
        },
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH01-R12",
    orikaId: 72,
    orikaIndex: 61,
    name: "幻象「ルナクロック」",
    printedCategory: "magic",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "purple", "red"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「紅魔」を持つ。",
      "自分の白/紫/赤の効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられる。",
      "",
      "フラッシュ",
      "このバトル終了時、自分の創界神ネクサス/導界者ネクサスがなければ、アタックステップを終了する。この効果は、相手の「アタックステップを終了できない」効果を受けない。",
    ],
    keywordTags: [],
    tribe: "幻想・紅魔",
    image: "images/BSTH01-R12.webp",
    rarity: "R",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["revealed", "moved_to_trash"],
        },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          {
            kind: "trigger_colors",
            colors: ["white", "purple", "red"],
          },
          {
            kind: "trigger_from_zone",
            zones: ["deck"],
          },
        ],
        steps: [
          {
            action: {
              kind: "move_self",
              destination: "hand",
            },
          },
        ],
        executionMode: "optional",
        textRef: [1],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
          deferredTo: "battle_end",
        },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            tribes: ["導界者", "創界神"],
          },
        ],
        steps: [
          {
            action: {
              kind: "end_attack_step",
              // 「この効果は、相手の『アタックステップを終了できない』効果を受けない」(効果耐性/防御)。
              unaffectedByRestriction: true,
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH01-R21",
    orikaId: 69,
    orikaIndex: 62,
    name: "紅魔館",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "red"],
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
    symbolColors: ["red"],
    textLines: [
      "このカード/ネクサスは、系統：「幻想」/「紅魔」を持つ。",
      "",
      "Lv1-Lv2 フラッシュ『お互いのアタックステップ』",
      "ターンに1回、このネクサスを疲労させることで、BP5000以下のスピリット/BP1000以下のアルティメット1体を破壊する。",
      "",
      "Lv2",
      "系統：「紅魔」を持つ自分のネクサスは、相手の効果では破壊されない。系統：「夜族」を持つコスト8以上の自分の赤のスピリットが召喚されたとき、〔ターンに1回：同名〕 自分のライフが5になるようにボイドからコアを置ける。",
    ],
    keywordTags: [],
    tribe: "幻想・紅魔",
    image: "images/BSTH01-R21.webp",
    rarity: "R",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: { player: "both", period: "attack" },
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
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
              kind: "destroy",
              target: {
                kind: "filter",
                player: "either",
                filter: {
                  filterOr: [
                    { category: ["spirit"], maxBp: 5000 },
                    { category: ["ultimate"], maxBp: 1000 },
                  ],
                },
                count: 1,
              },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          level: { min: 2 },
        },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["紅魔"],
                },
                count: "all",
              },
              resistsOutcome: "destroy",
              source: "opponent_effect",
              duration: {
                scope: "permanent",
              },
            },
          },
        ],
        textRef: [5, 6],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "summon",
          triggerFilter: {
            category: ["spirit"],
            colors: ["red"],
            tribes: ["夜族"],
            minCost: 8,
          },
        },
        applicability: {
          level: { min: 2 },
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            action: {
              // 「ボイドから」なので、reserve を先に使う life_fill では表さない。
              // 現在のライフとの差分だけを、共通 core_move の void→life 経路で移動する。
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "life", player: "self" },
              amount: {
                source: {
                  kind: "cores_on",
                  location: { kind: "life", player: "self" },
                },
                multiplier: -1,
                offset: 5,
                minValue: 0,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH01-X02",
    orikaId: 70,
    orikaIndex: 63,
    name: "霧雨 魔理沙",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 6,
    reductionSymbols: ["yellow", "yellow", "yellow", "guide", "guide"],
    // Lv1-Lv2-Lv3「「ミニ八卦炉」2つまでと「魔理沙の箒」1つと合体できる」。名前は「カード名：」
    // 接頭辞が無い引用のため部分一致 (SSOT: 「X」=部分一致)。count は合計上限 (2+1)、
    // condition でこの2名以外の導魔ブレイヴを排除、nameLimits でカード名ごとの内訳上限を課す
    // (P3-16 多重合体 maxCombinedBraves の nameLimits 拡張、engine-claude iteration 2026-07-18)。
    maxCombinedBraves: {
      count: 3,
      effectIndex: 1,
      condition: { cardNameContains: ["ミニ八卦炉", "魔理沙の箒"] },
      nameLimits: [
        { cardNameContains: "ミニ八卦炉", maxCount: 2 },
        { cardNameContains: "魔理沙の箒", maxCount: 1 },
      ],
    },
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 9000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 11000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のデッキを上から6枚オープンする。その中/手札/手元/トラッシュにあるカード名：「ミニ八卦炉」1枚と、カード名：「魔理沙の箒」1枚を召喚コストを0として召喚する。残ったオープンしたカードは破棄する。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットは「ミニ八卦炉」2つまでと「魔理沙の箒」1つと合体できる。",
      "",
      "Lv3『このスピリットのアタック時』",
      "このターンの間、相手のスピリット/アルティメット1体をBP-3000する。この効果を、このスピリットのブレイヴ1つにつき追加でもう1度発揮し、BPが0のスピリット/アルティメットすべてを破壊する。",
    ],
    keywordTags: [],
    tribe: "幻想・導魔・楽族",
    image: "images/BSTH01-X02.webp",
    rarity: "X",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        // deck_reveal(picks:[], remainder:'trash') は残り全枚を即時 trash へ送るため、後続
        // summon の from_zone に "trash" を含めればオープンした6枚も候補に入る (revealed zone
        // 専用対応は不要と判明済み)。1体目の「ミニ八卦炉」がブレイヴ合体選択
        // (pendingBraveCombineChoice.effectSummon) を開いても、ENGINE-brave-combine-multistep-
        // continuation (2026-07-18) で2体目の「魔理沙の箒」summon step へ解決後に再開する。
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 6,
              picks: [],
              remainder: "trash",
            },
          },
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "set_aside", "trash"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  cardName: { exact: "ミニ八卦炉" },
                },
                count: 1,
              },
              // 本文は「支払わず」ではなく「召喚コストを0として」なので、
              // CostModifier の基準コスト override で表す。
              costModifier: { override: 0 },
            },
          },
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "set_aside", "trash"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  cardName: { exact: "魔理沙の箒" },
                },
                count: 1,
              },
              // 1体目と同じ本文上のコスト指定を、それぞれの召喚へ適用する。
              costModifier: { override: 0 },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        // maxCombinedBraves (CardDefinition トップレベル) で表現。P3-16 多重合体 SSOT。
        timing: {
          kind: "continuous",
        },
        applicability: { level: { min: 1, max: 3 } },
        steps: [],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        applicability: {
          level: { min: 3 },
        },
        steps: [
          {
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
              amount: -3000,
              duration: {
                scope: "turn",
              },
            },
            // 「追加でもう1度発揮」は各巡の解決時点で対象を取り直す。
            // 宣言時に全巡分を一括選択せず、repeat continuation ごとに pending を開く。
            targetSelectionTiming: "on_step",
            repeat: {
              additional: { source: { kind: "braves_on_source" } },
            },
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxBp: 0,
                },
                count: "all",
              },
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxBp: 0,
                },
                count: "all",
              },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH01-X03",
    orikaId: 71,
    orikaIndex: 64,
    name: "レミリア・スカーレット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 8,
    reductionSymbols: ["red", "red", "red", "red", "red"],
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
        requiredCores: 4,
        bp: 16000,
      },
    ],
    symbolColors: ["red", "red"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、自分の創界神ネクサス/導界者ネクサスがないとき、相手の創界神ネクサス1つを破壊できる。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "BP20000以下の相手のスピリット/アルティメット1体を破壊する。この効果で破壊したスピリット/アルティメットの効果は発揮されない。この効果で破壊したとき、このスピリットは回復する。",
    ],
    keywordTags: [],
    tribe: "幻想・紅魔・夜族",
    image: "images/BSTH01-X03.webp",
    rarity: "X",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            tribes: ["導界者", "創界神"],
          },
        ],
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [0, 1],
        limitGroupId: "nexus_destroy",
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            tribes: ["導界者", "創界神"],
          },
        ],
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [0, 1],
        limitGroupId: "nexus_destroy",
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
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxBp: 20000,
                },
                count: 1,
              },
              suppressDestroyedEffects: "destroyed_only",
            },
          },
          {
            action: {
              kind: "recover",
              target: {
                kind: "self",
              },
            },
            connector: "conditional_result",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH01-X04",
    orikaId: 73,
    orikaIndex: 65,
    name: "フランドール・スカーレット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 8,
    reductionSymbols: ["red", "red", "red", "red", "red"],
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
        bp: 18000,
      },
    ],
    symbolColors: ["red", "red"],
    textLines: [
      "Lv1-Lv2-Lv3 フラッシュ『お互いのアタックステップ』",
      "1コスト支払うことで、BP10000以下の相手のスピリット1体を破壊する。",
      "",
      "【フォーオブアカインド】Lv2-Lv3 フラッシュ",
      '〔ターンに1回：同名〕自分の創界神ネクサス/導界者ネクサスがないとき、ゲーム中に1回、自分のデッキを上から3枚裏向きでフィールドに置き、自分のコア1個以上をそれらのカードに置くことで、フィールドにある間、それらのカードは、このスピリットと同じコスト、シンボル、系統、Lv、BPを持つLvコスト1、カード名：「フランドール・スカーレット」の"このスピリットは合体できない。"を持つスピリットとして扱い、このスピリットが相手の効果の対象になったとき、その効果の対象をそれらのスピリットに変更できる。',
    ],
    keywordTags: [],
    tribe: "幻想・紅魔・夜族",
    image: "images/BSTH01-X04.webp",
    rarity: "X",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "pay_cost",
              amount: 1,
            },
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                  maxBp: 10000,
                },
                count: 1,
              },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
      },
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "flash",
        },
        applicability: {
          level: { min: 2, max: 3 },
        },
        // 自分の創界神ネクサス/導界者ネクサスがないとき + デッキ ≥ 3 枚
        // (裁定 #4: デッキ < 3 枚は「ことで」コスト効果のため発動不可)
        condition: [
          { kind: "field_lacks", player: "self", grandwalkerKind: "any" },
          { kind: "field_has", player: "self", zone: "deck", minCount: 3 },
        ],
        usageLimit: [
          { kind: "per_card_name", duration: "turn" },
          { kind: "per_instance", duration: "game" },
        ],
        steps: [
          // 1. デッキ上 3 枚を裏向きでフィールドへ
          {
            id: "place_face_down",
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "self", position: "top" },
              to: { zone: "field", player: "self" },
              count: 3,
              faceDown: true,
            },
          },
          // 2. 自分の通常移動可能な全ゾーン (リザーブ / トラッシュ / ライフ / 自分 field
          //    カード) からコア 1 個以上をそれらのカードに置く (P3-47 F-5 multi-source)。
          //    裁定 (2026-05-05): 「自分のコア1個以上をそれらのカードに置く」は、
          //    通常移動可能なすべての自分のゾーンのコアを好きな数”それら”に置くという
          //    意味。創界神 / 導界者 / 創界石ネクサス、ボイド、カウントは除外。
          {
            id: "core_distribute",
            action: {
              kind: "core_distribute",
              from: { kind: "any_movable_self" },
              to: { kind: "ref", stepId: "place_face_down" },
              amount: "all",
              mode: "player_choice",
              minTotal: 1,
            },
          },
          // 3. それらのカードをスピリット扱い (live_copy_from_source = フランドール本体)
          //    カード本文「同じコスト、シンボル、系統、Lv、BPを持つ」に従い軽減は付与しない
          //    (reductionSymbols は aspects に含めない)。
          {
            id: "register_token",
            action: {
              kind: "register_act_as_spirit",
              target: { kind: "ref", stepId: "place_face_down" },
              statBlueprint: {
                kind: "live_copy_from_source",
                aspects: [
                  "cost",
                  "symbolColors",
                  "tribes",
                  "levelDefs",
                  "currentLv",
                ],
              },
              overrides: {
                cardName: "フランドール・スカーレット",
                // Lvコスト 1: 1 コアで Lv1 達成 (本体 BP/Lv は live_copy で host 追従)
                levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
                keywords: ["cannot_combine"],
              },
            },
          },
          // 4. 「相手効果の対象になったとき token に変更できる」CE 登録
          {
            action: {
              kind: "register_redirect_effect_target",
              protectedTarget: { kind: "self" },
              sourcePlayerRef: "opponent",
              redirectCandidate: { kind: "associated_act_as_spirit" },
              optional: true,
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH01-X05",
    orikaId: 74,
    orikaIndex: 66,
    name: "十六夜 咲夜",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 6,
    reductionSymbols: ["white", "white", "white", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 11000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "このカード/スピリットのシンボル/軽減シンボルは赤としても扱う。",
      "",
      "『自分のアタックステップ』中、相手が手札/手元のフラッシュ効果を使用したとき、自分の創界神ネクサス/導界者ネクサスがなく、自分がゲーム開始時に契約カードを提示していなければ、その効果発揮前に手札にあるこのカードをコストを支払わずに召喚することで、その効果を無効にする。",
      "",
      "Lv2『このスピリットのアタック時』",
      "ターンに1回、相手のスピリット/ライフにアタックし、ただちにバトルを解決する。",
    ],
    keywordTags: [],
    tribe: "幻想・紅魔・戦姫",
    image: "images/BSTH01-X05.webp",
    rarity: "X",
    pack: "BSTH01 東方紅魔郷",
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
              asColor: "red",
              appliesToCard: true,
            },
          },
        ],
        textRef: [0],
      },
      {
        // P3-73: 「相手が手札/手元のフラッシュ効果を使用したとき」反応する誘発効果。
        // source が手札のため非公開キュー (pendingPrivateDeclarations) 経由で宣言→公開化。
        // timingScope『自分のアタックステップ』中のみ。executionMode:"optional" で private 化。
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "flash",
        },
        timingScope: {
          player: "self",
          period: "attack",
        },
        applicability: {
          zone: "hand",
        },
        executionMode: "optional",
        condition: [
          {
            kind: "trigger_from_zone",
            zones: ["hand", "set_aside"],
          },
          {
            kind: "field_lacks",
            player: "self",
            tribes: ["導界者", "創界神"],
          },
          {
            kind: "no_presented_contract_card",
          },
        ],
        steps: [
          {
            // 手札にあるこのカードをコストを支払わずに召喚する（「ことで」コスト）。
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
              costModifier: "free",
            },
          },
          {
            // その効果（相手の使用したフラッシュ効果）を発揮前に無効にする。
            action: {
              kind: "negate",
              negateTarget: "effect",
              targetEffectTiming: "flash",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [2],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        applicability: {
          level: { min: 2 },
        },
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "additional_attack",
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSTH01-X07",
    orikaId: 75,
    orikaIndex: 67,
    name: "宵闇を司る妖怪 EXルーミア",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 9,
    reductionSymbols: ["red", "red", "red"],
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
        bp: 21000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "セットしているこのカードは相手の効果を受けず、このカードが発動している間、このカードと自分は相手の効果を受けない。",
      "",
      "【バースト：自分のライフ減少後】",
      "自分の創界神ネクサス/導界者ネクサスがないとき、相手の創界神ネクサスのコアすべてをボイドに置き、このカードをコストを支払わずに召喚する。",
      "",
      "Lv3『このスピリットのアタック時』",
      "BP15000以下の相手のスピリット/アルティメット1体を除外する。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・夜族",
    image: "images/BSTH01-X07.webp",
    rarity: "X",
    pack: "BSTH01 東方紅魔郷",
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
              kind: "effect_immunity",
              target: {
                kind: "self",
              },
              // 節①: セット中(burst zone)のみ有効。発動後 field スピリットでは消滅し永続耐性を持たない。
              duration: {
                scope: "while_set",
              },
            },
          },
        ],
        textRef: [0],
        burstActivationWindowImmunity: "self_and_controller",
        // 確定裁定 (2026-06-01): 節①セット中=このカードのみ保護(バースト破棄も防ぐ)。
        // 節②発動中(発動成立〜バースト効果の「解決後」まで。「発揮後」ではない)=このカード+自分(プレイヤー)を保護。
        // 自身のバースト効果が誘発させた効果(例:コア減少誘発/相手召喚誘発)は、解決時点で発動中が終了済→受ける(耐性対象外)。
        // プレイヤー耐性は「人称+読点」でプレイヤー対象と判定される効果のみブロック(手札破棄/コア奪取は防がない)。
      },
      {
        timing: {
          kind: "burst",
          trigger: { kind: "life_decrease", player: "self" },
        },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            tribes: ["導界者", "創界神"],
          },
        ],
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  hasMechanic: ["grandwalker", "guided"],
                  targetsGrandwalker: true,
                },
              },
              to: {
                kind: "void",
                player: "opponent",
              },
              amount: "all",
            },
          },
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
              costModifier: "free",
            },
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        applicability: {
          level: { min: 3 },
        },
        steps: [
          {
            action: {
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxBp: 15000,
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH01-X08",
    combinedBoost: 5000,
    orikaId: 76,
    orikaIndex: 68,
    name: "神槍「スピア・ザ・グングニル」",
    printedCategory: "brave",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "red", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
    ],
    symbolColors: ["red"],
    braveCondition: {
      cardNameContains: ["レミリア・スカーレット"],
    },
    textLines: [
      "【合体条件：「レミリア・スカーレット」】",
      "【合体中】『このスピリットのアタック時』",
      "相手のスピリット/アルティメットを破壊したとき、ターンに1回、相手のライフのコア2個までをボイドに置く。",
    ],
    keywordTags: [],
    tribe: "紅魔",
    image: "images/BSTH01-X08.webp",
    rarity: "X",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // 『このスピリットのアタック時』相手のスピリット/アルティメットを破壊したとき。
        // 「アタック中スコープの即時効果」: 破壊そのものを観測する誘発 (game_event:destroy)
        // を in_battle:attacking でゲートする。『アタック時』は上位フィルター (発揮枠)であり
        // effectCondition ではない点に注意 (10_rules/05 参照)。
        // 破壊の帰属 = 自分起因のみ: バトル討ち取り (battle) または自分の破壊効果 (opponent_effect)。
        // deriveTriggerEventCauseFromPendingLeave は離脱カード(=相手, player:"opponent")自身の
        // コントローラ基準で cause を導出するため、cause は離脱カード視点になる:
        // self_effect=相手自身の効果で相手が自壊、opponent_effect=causePlayerId(=自分)が
        // 離脱カードのコントローラ(相手)と異なる=自分の効果由来。「自分が破壊した」は
        // opponent_effect 側 (adversarial verifier 2026-07-12 lens1/2/4 指摘の極性誤りパターンを
        // 本カードでも検出・修正。ENGINE-cause-polarity-self-effect-opponent-effect-audit)。
        // sourceWhose:"either": 同 family の actingPlayerId は「離脱した相手カードのコントローラ」
        // を指し、listener(このカード)自身のコントローラとは一致しないため、既定 whose:"self"
        // (getTriggeredEffectSourceUseBlockReason) では常に候補から除外される。player/cause で
        // 絞り込み済みのため明示的に外す (ENGINE-leave-field-third-party-opponent-source-whose
        // 同型。cause 監査の end-to-end 検証で本カードの未配線を検出)。
        // 誘発収集は battle reset 前 (in_battle=true) に走るため、解決が reset 後でも gate は成立する。
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "destroy",
          triggerFilter: {
            category: ["spirit", "ultimate"],
          },
          cause: ["battle", "opponent_effect"],
          sourceWhose: "either",
        },
        condition: [
          {
            kind: "in_battle",
            state: "attacking",
          },
        ],
        applicability: {
          combined: true,
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "life",
                player: "opponent",
              },
              to: {
                kind: "void",
                player: "opponent",
              },
              // 「2個まで」: amount {min,max} で 0〜2 のプレイヤー数選択を表現
              // (P3-88 pendingCoreCountSelection)。相手ライフ減少バースト回避のため
              // あえて少なく置く選択も可能。available 未満なら max を自動で丸める。
              amount: { min: 0, max: 2 },
            },
          },
        ],
        textRef: [1, 2],
      },
    ],
  },
  {
    cardNo: "BSTH01-X09",
    combinedBoost: 5000,
    orikaId: 77,
    orikaIndex: 69,
    name: "禁忌「レーヴァテイン」",
    printedCategory: "brave",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "red", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
    ],
    symbolColors: ["red"],
    braveCondition: {
      cardNameContains: ["フランドール・スカーレット"],
    },
    textLines: [
      "【合体条件：「フランドール・スカーレット」】",
      "【合体中】『自分のアタックステップ』",
      "このスピリットの「BP破壊効果」の上限を+5000し、その対象を相手のアルティメットにもできる。",
    ],
    keywordTags: [],
    tribe: "紅魔",
    image: "images/BSTH01-X09.webp",
    rarity: "X",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          combined: true,
        },
        // 「BP破壊効果」の上限+5000 + 対象にアルティメットを追加。
        // P3-14 A-7 の effect_param_modify メタ効果プリミティブで表現。
        // scope: "combined_unit" により、合体相手 (ホスト) の destroy 効果にも適用される。
        steps: [
          {
            action: {
              kind: "effect_param_modify",
              effectClass: "bp_destroy",
              scope: "combined_unit",
              addLimitAmount: 5000,
              addTargetCategories: ["ultimate"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [1, 2],
      },
    ],
  },
  {
    cardNo: "BSTH01-XX01",
    orikaId: 78,
    orikaIndex: 70,
    name: "[導界者]八雲 紫",
    printedCategory: "nexus",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 4,
    reductionSymbols: ["guide", "guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
      {
        level: 2,
        requiredCores: 10,
        bp: 0,
      },
    ],
    symbolColors: ["guide"],
    textLines: [
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず、移動できない。",
      "",
      "【導託：[幻想] [幻想＆アルティメット/ブレイヴ] [賢者＆ネクサス]】",
      "◆対象の自分のスピリット/アルティメット/ブレイヴ/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは赤/紫/緑/白/黄/青/究極としても扱う。",
      "",
      "【導技:2】Lv1-Lv2『自分のメインステップ』",
      "〔ターンに2回、このネクサスのコア2個をボイドに置く〕自分のデッキを2枚オープンする。その中の系統：「幻想」を持つカード1枚を手札に加える。残ったカードは好きな順番でデッキの上か下だけに戻す。",
      "",
      "Lv2『自分のアタックステップ』",
      "系統：「幻想」を持つ自分のスピリット/アルティメットすべてはブロックされない。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    tribe: "導界者・賢者",
    image: "images/BSTH01-XX01.webp",
    rarity: "XX",
    pack: "BSTH01 東方紅魔郷",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 本体ルール [0] + 導託 [2,3,4] は grandwalkerData + エンジン基盤
    // (oracle-system / 対象除外 / コア配置制限) で表現。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        // 〔幻想〕は素のカード種別 = スピリット
        // （〔幻想＆アルティメット/ブレイヴ〕が別掲のため。BSTH003-X01 と同じ折り込み規約）。
        { tribes: ["幻想"], categories: ["spirit"] },
        { tribes: ["幻想"], categories: ["ultimate", "brave"] },
        { tribes: ["賢者"], categories: ["nexus"] },
      ],
      // 【導技:2】Lv1-Lv2『自分のメインステップ』〔ターンに2回、コア2個をボイドに置く〕。
      // 導技=神技扱い。コスト(コア2個→ボイド)・ターン回数は divineSkills 経路でエンジン検査。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 2,
          timing: "main",
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          maxUsesPerTurn: 2,
          // 自分のデッキを2枚オープンし、その中の幻想カード1枚を手札に加える。
          // 残りは好きな順番でデッキの上か下だけに戻す。
          effects: [
            {
              textRef: [8, 9],
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    kind: "deck_reveal",
                    revealCount: 2,
                    picks: [
                      {
                        mandatory: true,
                        count: 1,
                        filter: { tribes: ["幻想"] },
                      },
                    ],
                    remainder: "top_or_bottom",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
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
              asColor: "red",
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
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "ultimate_symbol",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【導技:2】(main, ターンに2回) は grandwalkerData.divineSkills で表現（上記参照）。
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          level: { min: 2 },
        },
        steps: [
          {
            action: {
              kind: "unblockable",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit", "ultimate"],
                  tribes: ["幻想"],
                },
                count: "all",
              },
              duration: {
                scope: "step",
                step: "attack",
                whose: "self",
              },
            },
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
  {
    cardNo: "BSTH01-XX02",
    orikaId: 3,
    orikaIndex: 71,
    name: "博麗 霊夢",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 9,
    reductionSymbols: ["red", "red", "red", "red", "god", "guide"],
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
        requiredCores: 3,
        bp: 18000,
      },
      {
        level: 4,
        requiredCores: 6,
        bp: 30000,
      },
    ],
    symbolColors: ["red", "red"],
    textLines: [
      "フラッシュ【煌臨：博麗＆コスト6以上『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2-Lv3-Lv4",
      "このスピリットは、相手の効果を受けず、相手の効果を受けるとき、相手の効果が指定する効果/条件で防いだものとする。",
      "",
      "【解放：Lv4】Lv2-Lv3『このスピリットのアタック時』",
      "このスピリットがLv4になるように自分の赤の導界者ネクサスのコアを置くことで、相手のスピリット/アルティメット1体を破壊する。この効果の破壊によって相手の一切の効果は発揮されない。",
      "",
      "Lv4『このスピリットのアタック時』",
      "このスピリットはブロックされず、スピリットとして扱わない。",
    ],
    keywordTags: ["advent"],
    tribe: "起幻・幻想・博麗",
    image: "images/BSTH01-XX02.webp",
    rarity: "XX",
    pack: "BSTH01 東方紅魔郷",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【煌臨：博麗＆コスト6以上『自分のターン』】。
    // 煌臨宣言は CardDefinition.adventData で表現する（11 L149 / 08a §1, declare_advent 配線済み）。
    // 『自分のターン』= own_turn、ソウルコア→トラッシュ、adventVariant: normal。
    // コスト6以上は minCost:6 で忠実に表現する。
    // 「博麗」はクォート無し=系統条件（名前なら「博麗」と表記）。tribes:["博麗"] で表現する。
    adventData: {
      adventCondition: {
        targetCategory: ["spirit"],
        tribes: ["博麗"],
        minCost: 6,
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "normal",
    },
    effects: [
      // [3,4] textLines[4] 後半「相手の効果を受けるとき、相手の効果が指定する効果/条件で
      // 防いだものとする」は公式裁定 qa-020 準拠のイディオム（10_rules/04b2）。
      // 防げる条件が1つでも存在するなら自動的にそれを満たす（お互い/一切の真の blanket
      // だけが貫通する）wildcard 耐性 = satisfiesPreventionRestriction (P3-141)。
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "self",
              },
              duration: {
                scope: "permanent",
              },
              satisfiesPreventionRestriction: true,
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        executionMode: "optional",
        timing: {
          kind: "card_event",
          event: "attack",
        },
        applicability: {
          level: { min: 2, max: 3 },
        },
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  colors: ["red"],
                  tribes: ["導界者"],
                  targetsGrandwalker: true,
                },
              },
              to: { kind: "this_card" },
              // 動的 amount = Lv4維持コア数(6) − 現在のコア数。multiplier:0 で
              // base を無効化し offset:6 を定数化した上で subtract に現在コア数を
              // 引かせる (resolveDynamicCount の subtract は結果を 0 未満へ
              // クランプする。P3-88 系と同じ「N未満なら0」安全側)。
              amount: {
                source: { kind: "cores_on", location: { kind: "this_card" } },
                multiplier: 0,
                offset: 6,
                subtract: {
                  kind: "cores_on",
                  location: { kind: "this_card" },
                },
              },
            },
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
              suppressDestroyedEffects: "all_opponent",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [6, 7],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        applicability: {
          level: { min: 4 },
        },
        steps: [
          {
            action: {
              kind: "unblockable",
              target: {
                kind: "self",
              },
              duration: {
                scope: "battle",
              },
            },
          },
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { excludeCategory: "spirit" },
              duration: {
                scope: "battle",
              },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
];
