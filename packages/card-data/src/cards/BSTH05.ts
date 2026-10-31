import type { CardDefinition } from "@orica/rules-core";

export const BSTH05_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH05-C01",
    orikaId: 136,
    orikaIndex: 145,
    name: "[ゴッドシーカー/紅葉の神]秋 静葉",
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
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個をこのスピリットに置ける。自分のデッキを上から3枚オープンできる。その中の系統：「アシハラ」を持つ緑の創界神ネクサスカード1枚と、系統：「幻想」/「風神」を持つ緑のカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
    ],
    keywordTags: [],
    tribe: "神渡・幻想・樹魔",
    image: "images/BSTH05-C01.webp",
    rarity: "C",
    pack: "BSTH05 東方風神録",
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
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "this_card",
              },
              amount: 1,
            },
          },
          {
            executionMode: "optional",
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    hasMechanic: ["grandwalker"],
                    category: ["nexus"],
                    colors: ["green"],
                    tribes: ["アシハラ"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    colors: ["green"],
                    tribes: ["幻想", "風神"],
                  },
                },
              ],
              remainder: "bottom",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0, 1],
      },
    ],
  },
  {
    cardNo: "BSTH05-C02",
    orikaId: 137,
    orikaIndex: 146,
    name: "[ゴッドシーカー/豊穣の神]秋 穣子",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["green"],
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
    symbolColors: ["green"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個をこのスピリットに置ける。自分のデッキを上から3枚オープンできる。その中の系統：「アシハラ」を持つ緑の創界神ネクサスカード1枚と、系統：「幻想」/「風神」を持つ緑のカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv2",
      "このスピリットの『このスピリットの召喚時』効果は、相手のネクサスの効果を受けない。",
    ],
    keywordTags: [],
    tribe: "神渡・幻想・樹魔",
    image: "images/BSTH05-C02.webp",
    rarity: "C",
    pack: "BSTH05 東方風神録",
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
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "this_card",
              },
              amount: 1,
            },
          },
          {
            executionMode: "optional",
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    hasMechanic: ["grandwalker"],
                    category: ["nexus"],
                    colors: ["green"],
                    tribes: ["アシハラ"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    colors: ["green"],
                    tribes: ["幻想", "風神"],
                  },
                },
              ],
              remainder: "bottom",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0, 1],
      },
      {
        // 「このスピリットの『召喚時』効果は相手のネクサスの効果を受けない」。
        // 召喚時効果だけを保護する。カード自身への除去・疲労耐性は与えない。
        timing: {
          kind: "continuous",
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
              kind: "grant_effect_source_prevention_immunity",
              player: "self",
              sourceScope: {
                source: "self",
                effectFilter: {
                  timingKind: "card_event",
                  eventAction: "summon",
                },
              },
              preventionBypass: {
                kind: "preventing_effect_filter",
                filter: { categories: ["nexus"] },
              },
              appliesTo: ["prevention", "stack_negate"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH05-C11",
    orikaId: 138,
    orikaIndex: 147,
    name: "蛙狩「蛙は口ゆえ蛇に呑まるる」",
    printedCategory: "magic",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」を持つ。",
      "自分の緑の効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられ、トラッシュから手札に加えたとき、ボイドからコア1個を自分の緑の創界神ネクサスに置く。",
      "",
      "フラッシュ",
      "相手のスピリット2体を手札に戻す。系統：「アシハラ」を持つ自分の緑の創界神ネクサスのコア3個をボイドに置くことで、この効果の対象を相手のスピリット/アルティメット3体にする。相手は、これらの効果を2体以上防げない。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH05-C11.webp",
    rarity: "C",
    pack: "BSTH05 東方風神録",
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
            colors: ["green"],
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
            // P3-137 現状維持: コア「置く」効果 (qa-002「創界神ネクサスにコア+1する」
            // などの効果でコアを置けず」= 明示除外例) のため tribes:["創界神"] のまま
            // 導界者ネクサスを対象外にする。破壊/コア除去系(作用系)とは逆の分類。
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["創界神"],
                  colors: ["green"],
                },
              },
              amount: 1,
            },
          },
        ],
        textRef: [1],
        executionMode: "optional",
      },
      // フラッシュ: 基本=相手スピリット2体バウンス /
      // 拡張=アシハラ緑創界神のコア3個ボイド(ことで)→相手スピリット/アルティメット3体バウンス。
      // P3-14 D-6: choice(基本/コスト) + ref_choice + conditional_cost で二択を表現。
      // 「2体以上防げない」= maxPreventable:1 (両モード共通)。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        steps: [
          {
            id: "mode",
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 2,
              },
              maxPreventable: 1,
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
                      colors: ["green"],
                      tribesRequired: ["アシハラ", "創界神"],
                    },
                  },
                  to: { kind: "void", player: "self" },
                  amount: 3,
                },
              },
            ],
          },
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 3,
              },
              maxPreventable: 1,
            },
            stepCondition: {
              kind: "ref_choice",
              stepId: "mode",
              choiceIndex: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH05-C12",
    orikaId: 139,
    orikaIndex: 148,
    name: "神祭「エクスパンデッド・オンバシラ」",
    printedCategory: "magic",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green", "green"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」を持つ。",
      "自分の緑の効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられ、トラッシュから手札に加えたとき、ボイドからコア1個を自分の緑の創界神ネクサスに置く。",
      "",
      "フラッシュ",
      "相手のスピリット2体を疲労させる。系統：「アシハラ」を持つ自分の緑の創界神ネクサスのコア3個をボイドに置くことで、この効果の対象を相手のスピリット/アルティメット3体にする。相手は、これらの効果を2体以上防げない。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH05-C12.webp",
    rarity: "C",
    pack: "BSTH05 東方風神録",
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
            colors: ["green"],
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
            // P3-137 現状維持: コア「置く」効果 (qa-002「創界神ネクサスにコア+1する」
            // などの効果でコアを置けず」= 明示除外例) のため tribes:["創界神"] のまま
            // 導界者ネクサスを対象外にする。破壊/コア除去系(作用系)とは逆の分類。
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["創界神"],
                  colors: ["green"],
                },
              },
              amount: 1,
            },
          },
        ],
        textRef: [1],
        executionMode: "optional",
      },
      // フラッシュ: 基本=相手スピリット2体疲労 /
      // 拡張=アシハラ緑創界神のコア3個ボイド(ことで)→相手スピリット/アルティメット3体疲労。
      // P3-14 D-6: choice(基本/コスト) + ref_choice + conditional_cost で二択を表現。
      // 「2体以上防げない」= maxPreventable:1 (両モード共通)。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        steps: [
          {
            id: "mode",
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 2,
              },
              maxPreventable: 1,
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
                      colors: ["green"],
                      tribesRequired: ["アシハラ", "創界神"],
                    },
                  },
                  to: { kind: "void", player: "self" },
                  amount: 3,
                },
              },
            ],
          },
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 3,
              },
              maxPreventable: 1,
            },
            stepCondition: {
              kind: "ref_choice",
              stepId: "mode",
              choiceIndex: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH05-C13",
    orikaId: 140,
    orikaIndex: 149,
    name: "神籤「乱れおみくじ連続引き」",
    printedCategory: "magic",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green", "green"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」を持つ。",
      "自分の緑の効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられ、トラッシュから手札に加えたとき、ボイドからコア1個を自分の緑の創界神ネクサスに置く。",
      "",
      "メイン",
      "自分は、手札すべて（最低1枚以上）を破棄することで、デッキの上から4枚ドローする。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH05-C13.webp",
    rarity: "C",
    pack: "BSTH05 東方風神録",
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
            colors: ["green"],
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
            // P3-137 現状維持: コア「置く」効果 (qa-002「創界神ネクサスにコア+1する」
            // などの効果でコアを置けず」= 明示除外例) のため tribes:["創界神"] のまま
            // 導界者ネクサスを対象外にする。破壊/コア除去系(作用系)とは逆の分類。
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["創界神"],
                  colors: ["green"],
                },
              },
              amount: 1,
            },
          },
        ],
        textRef: [1],
        executionMode: "optional",
      },
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "main",
        },
        // SSOT 流用: BSTH02-R01/R02/R03 effects[0] (発動コストが手札破棄) と同型の
        // discard(cost) → conditional_cost draw(payoff)。count:-1 (手札すべて) で
        // 候補0枚 (手札0枚) のとき discard は no-op (succeeded:false) となり、
        // conditional_cost が draw をロールバックする＝「最低1枚以上」＝手札0枚では
        // 発揮できない、を新規primitive無しで表現する。
        steps: [
          {
            action: {
              kind: "discard",
              count: -1,
              player: "self",
            },
          },
          {
            action: {
              kind: "draw",
              count: 4,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH05-M01",
    orikaId: 141,
    orikaIndex: 150,
    name: "ヒソウテンソク",
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
        bp: 10000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "Lv1-Lv2『このスピリットのアタック時』",
      "相手のスピリット/アルティメット1体を重疲労させる。",
      "",
      "Lv2『このスピリットのアタック/ブロック時』",
      "相手のスピリット/アルティメットだけを破壊したとき、このスピリットは回復する。",
    ],
    keywordTags: [],
    tribe: "幻想・風神",
    image: "images/BSTH05-M01.webp",
    rarity: "M",
    pack: "BSTH05 東方風神録",
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
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        // SSOT 流用: BSFT01-TR05(B) と同型の battle_destroy_opponent_only card_event
        // (このカードがバトルの勝者側で、破壊したカードが全て相手所有のとき自己発火。
        // アタック/ブロックどちらの勝利でも同一イベントが発火するため on_block 用の
        // 別 timing は不要)。
        timing: {
          kind: "card_event",
          event: "battle_destroy_opponent_only",
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
              kind: "recover",
              target: {
                kind: "self",
              },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH05-M02",
    orikaId: 142,
    orikaIndex: 151,
    name: "鍵山 雛",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "green", "god", "guide"],
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
    ],
    symbolColors: ["green"],
    textLines: [
      "自分のトラッシュに系統：「風神」を持つカードがあるとき、セットしているこのカードは相手の効果を受けない。",
      "",
      "【バースト：相手によって自分のスピリットがフィールドを離れた後】",
      "相手のスピリット/アルティメット2体を手札とデッキの下に1体ずつ戻す。この効果は【超重装甲】以外では防げない。この効果発揮後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv2『このスピリットのアタック時』",
      "ターンに1回、このスピリットは回復できる。",
    ],
    keywordTags: ["burst"],
    tribe: "神渡・幻想・風神",
    image: "images/BSTH05-M02.webp",
    rarity: "M",
    pack: "BSTH05 東方風神録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 自分のトラッシュに系統：「風神」を持つカードがあるとき、セットしているこのカードは
      // 相手の効果を受けない。10_rules/04b L68-69 節①型（セット中=zone 束縛耐性）。
      // 既存 BSTH05.5-M04 と同型: applicability.zone="burst_set" + condition trash tribes。
      {
        applicability: { zone: "burst_set" },
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            zone: "trash",
            tribes: ["風神"],
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
        textRef: [0],
      },
      // 【バースト：相手によって自分のスピリットがフィールドを離れた後】
      //   相手のスピリット/アルティメット2体を手札とデッキの下に1体ずつ戻す→自己召喚。
      //   「【超重装甲】以外では防げない」= preventionRestriction.onlyPreventableByKeywords:
      //     ["超重装甲"]（effect 全体に適用、一致しない防止元だけを scoped 貫通）。
      //   「1体ずつ」= bounce/send_to_deck それぞれ count:1 を simultaneous で並べ、プレイヤーが
      //     どちらの 1 体を手札/デッキ下に振り分けるかを選ぶ（既存 simultaneous step が
      //     対象を独立に選ばせる SSOT、別途「振り分け選択」primitive は不要）。
      //   「このカードを召喚」= バーストゾーンからの self-summon。
      {
        timing: {
          kind: "burst",
          trigger: "相手によって自分のスピリットがフィールドを離れた後",
        },
        preventionRestriction: { onlyPreventableByKeywords: ["超重装甲"] },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
            },
          },
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
              position: "bottom",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
            connector: "after_triggers",
          },
        ],
        textRef: [2, 3],
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
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "recover",
              target: {
                kind: "self",
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH05-M03",
    orikaId: 143,
    orikaIndex: 152,
    name: "[風神録]霧雨 魔理沙",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 7,
    reductionSymbols: ["green", "green", "green", "god", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 9000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "自分のトラッシュに系統：「風神」/「導魔」を持つカードがあるとき、セットしているこのカードは相手の効果を受けない。",
      "",
      "【バースト：自分のライフ減少後】",
      "疲労状態の相手のスピリット/アルティメット1体をデッキの下に戻す。この効果は【超重装甲】以外では防げない。この効果発揮後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv2『このスピリットのアタック時』",
      "ボイドからコア2個を系統：「アシハラ」を持つ自分の創界神ネクサスに置く。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・風神・導魔",
    image: "images/BSTH05-M03.webp",
    rarity: "M",
    pack: "BSTH05 東方風神録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 自分のトラッシュに系統：「風神」/「導魔」を持つカードがあるとき、セットしているこのカードは
      // 相手の効果を受けない。10_rules/04b L68-69 節①型（セット中=zone 束縛耐性）。
      {
        applicability: { zone: "burst_set" },
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            zone: "trash",
            tribes: ["風神", "導魔"],
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
        textRef: [0],
      },
      {
        timing: {
          kind: "burst",
          trigger: "自分のライフ減少後",
        },
        // 疲労状態フィルタは exhaustState で表現（重疲労も「疲労状態」に含む = recovered 以外）。
        // 「【超重装甲】以外では防げない」= preventionRestriction.onlyPreventableByKeywords:
        //   ["超重装甲"]（effect 全体に適用、BSTH05-M02/X04 と同じ convention。
        //   stale な maxPreventable:0 単独表現は撤去 — engine-claude 2026-07-24）。
        // 「このカードを召喚」= バーストゾーンからの self-summon（from_zone hand は誤り）。
        preventionRestriction: { onlyPreventableByKeywords: ["超重装甲"] },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  exhaustState: "exhausted",
                },
                count: 1,
              },
              position: "bottom",
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
            connector: "after_triggers",
          },
        ],
        textRef: [2, 3],
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
                kind: "void",
                player: "self",
              },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["アシハラ"],
                  targetsGrandwalker: "only",
                  grandwalkerKind: "grandwalker",
                },
              },
              amount: 2,
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH05-M04",
    orikaId: 144,
    orikaIndex: 153,
    name: "[風神録]博麗 霊夢",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "green", "god", "guide"],
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
    ],
    symbolColors: ["green"],
    textLines: [
      "自分のトラッシュに系統：「幻想」を持つカードがあるとき、セットしているこのカードは相手の効果を受けない。",
      "",
      "【バースト：相手の「このスピリット／アルティメットの召喚時」発揮後】",
      "ボイドからコア2個を自分のリザーブに置く。この効果発揮後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv2『このスピリットのアタック時』",
      "このスピリットは、ブロックされない。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・風神",
    image: "images/BSTH05-M04.webp",
    rarity: "M",
    pack: "BSTH05 東方風神録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 自分のトラッシュに系統：「幻想」を持つカードがあるとき、セットしているこのカードは
      // 相手の効果を受けない。10_rules/04b L68-69 節①型（セット中=zone 束縛耐性）。
      {
        applicability: { zone: "burst_set" },
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            zone: "trash",
            tribes: ["幻想"],
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
        textRef: [0],
      },
      {
        timing: {
          kind: "burst",
          trigger: "相手の「このスピリット／アルティメットの召喚時」発揮後",
        },
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
              amount: 2,
            },
          },
          {
            // burst→self-summon パターン (10_rules/04b_burst-rules.md:34、先例 BSTS01-M01[4,5])。
            // from_zone:hand は誤り（BSTH03-M02/M03/M06 同型バグ修正）。「この効果発揮後」=
            // sequential (dsl-types.ts:1148、先例 BSTH05-M02/BSTH09-M02)。
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
            connector: "after_triggers",
          },
        ],
        textRef: [2, 3],
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
              kind: "unblockable",
              target: {
                kind: "self",
              },
              duration: {
                scope: "battle",
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH05-M11",
    combinedBoost: 4000,
    orikaId: 148,
    orikaIndex: 154,
    name: "諏訪の装",
    printedCategory: "brave",
    colors: ["green"],
    cost: 5,
    reductionSymbols: ["green", "green", "green"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 4000,
      },
    ],
    symbolColors: [],
    textLines: [
      "このブレイヴは疲労せず、スピリット状態のとき、アタック/ブロックできない。",
      "",
      "【左右合体条件：風神＆コスト5以上】",
      "【スピリット左/右合体中】『このスピリットのアタック時』",
      "このスピリットのシンボルを緑のシンボル2つにする。",
      "",
      "【左右合体条件：アシハラ＆創界神ネクサス】",
      "【ネクサス左/右合体中】【神域】『自分のメインステップ』",
      "系統：「風神」を持つスピリットが召喚されたとき、ボイドからコア2個を自分のリザーブに置く。この効果はターンに1回しか使えない。",
    ],
    keywordTags: [],
    tribe: "異魔神・神話・風神",
    image: "images/BSTH05-M11.webp",
    rarity: "M",
    pack: "BSTH05 東方風神録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【左右合体条件：風神＆コスト5以上】/【左右合体条件：アシハラ＆創界神ネクサス】は
    // BraveCondition.alternatives（BSTH003-M02 と同型パターン）で表現する。
    // primary: 系統「風神」かつコスト5以上のスピリット/アルティメット。
    // alternatives: 系統「アシハラ」かつ「創界神」を両方持つネクサス。
    braveCondition: {
      tribes: ["風神"],
      minCost: 5,
      alternatives: [
        {
          categories: ["nexus"],
          tribes: ["アシハラ", "創界神"],
          tribesLogic: "and",
        },
      ],
    },
    effects: [
      // [0] 「このブレイヴは疲労せず、スピリット状態のとき、アタック/ブロックできない。」
      // 異魔神ブレイヴ class (10_rules/07b §71) のルール強度耐性。スピリット状態 (combined:false)
      // で発揮:
      //   - 「疲労せず」= effect_resistance(exhaust) ruleStrength:true (相手の「防げない」
      //     疲労効果でも貫通させない。effect-resistance-check.ts isExhaustBlockedByResistance
      //     が ruleStrength CE を unpreventable 短絡前に評価する)。
      //   - 「アタック/ブロックできない」= prevent_battle restriction:["attack","block"]
      //     ruleStrength:true (成立済み battle entity cleanup でもルール強度扱い)。
      // 2026-08-15 ユーザー確認: マジック兼用/アルドノア系を含むスピリット状態
      // ブレイヴ制限も同じ ruleStrength class に揃える。
      {
        timing: { kind: "continuous" },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "exhaust",
              source: "all",
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
            connector: "sequential",
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        applicability: { combined: true },
        condition: [
          {
            kind: "combined_host_category",
            categories: ["spirit", "ultimate"],
          },
        ],
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "self",
              },
              properties: {
                symbols: ["green", "green"],
                symbolCountFixed: true,
              },
              // 見出し「アタック時」のみ・本文に「このターンの間」等の明示的期間指定が無いため
              // scope:"turn" ではなく "battle"（10_rules/03e §『このスピリットのアタック時』
              // 見出しでの性質/キーワード付与、BSTH03-M01/BSTH01-XX02(Lv4) precedent 準拠）。
              duration: {
                scope: "battle",
              },
            },
          },
        ],
        textRef: [2, 3, 4],
      },
      {
        // 「系統：「風神」を持つスピリットが召喚されたとき」= 人称(自分の/相手の)無し
        // → 自分/相手いずれの召喚でも良い (project_player_target_vs_card_target)。
        // BSAZ02-M03/BSAZ02-C07 (トラッシュ常駐リスナー、game_event:place player:"either"+
        // sourceWhose:"either") と同型の第三者観測パターン。
        // アシハラ＆創界神ネクサス合体中(alternatives 側)限定 = combined_host_category:["nexus"]
        // (effects[1] の combined_host_category:["spirit","ultimate"] と対の判定、
        // BSTH003-M02 precedent)。
        // 見出し『自分のメインステップ』= timingScope:{player:"self",period:"main"}
        // (BSTH04-C?? [6,7] game_event:attack + timingScope:{player:"self",period:"attack"}
        // と同型。timingScope 省略時は isTimingScopeActive が無条件 true を返し、
        // 相手ターン/他ステップでの召喚でも誤発火するため必須、adversarial verifier round1 refute)。
        timing: {
          kind: "game_event",
          player: "either",
          event: "summon",
          triggerFilter: { category: ["spirit"], tribes: ["風神"] },
          sourceWhose: "either",
        },
        timingScope: { player: "self", period: "main" },
        condition: [
          {
            kind: "combined_host_category",
            categories: ["nexus"],
          },
        ],
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
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
              amount: 2,
            },
          },
        ],
        textRef: [6, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSTH05-R01",
    orikaId: 145,
    orikaIndex: 155,
    name: "河城 にとり",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green", "guide"],
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
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個ずつを系統：「幻想」/「風神」を持つ自分の緑のスピリット2体に置ける。その後、手札/手元/トラッシュにある系統：「幻想」/「風神」を持つ緑のコスト6以下のカード1枚を1コスト支払って召喚できる。この効果は、ターンに1回しか使えない。",
      "",
      "Lv2",
      "系統：「風神」を持つ自分のコスト4/5/6のスピリットが相手の効果でフィールドを離れるとき、コストを支払うことで、支払ったコスト1につきそのスピリット1体は同じ状態でフィールドに残る。",
    ],
    keywordTags: [],
    tribe: "幻想・風神・妖戒",
    image: "images/BSTH05-R01.webp",
    rarity: "R",
    pack: "BSTH05 東方風神録",
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
            executionMode: "optional",
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
                  tribes: ["幻想", "風神"],
                  category: ["spirit"],
                  colors: ["green"],
                },
                count: 2,
              },
              amount: 2,
              mode: "one_each",
            },
          },
          {
            executionMode: "optional",
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "set_aside", "trash"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  colors: ["green"],
                  tribes: ["幻想", "風神"],
                  maxCost: 6,
                },
                count: 1,
              },
              costModifier: { fixedPayment: 1 },
            },
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv2 系統「風神」のコスト4/5/6の自分のスピリットが相手の効果でフィールドを
      //   離れるとき、コストを支払うことで同じ状態でフィールドに残る。
      //   flushPendingLeaves は PendingLeaveEntity ごとに離脱イベントを発火する
      //   ([[project_pending_leave_owner_chain_model]] 系、state-based-actions.ts の
      //   `for (const pendingLeave of pendingLeaves)`) ため、同時に複数体が離れても
      //   game_event が対象ごとに独立して誘発し、「支払ったコスト1につきそのスピリット
      //   1体は…残る」は各対象へ pay_cost(1)+conditional_cost の個別発火として自然に成立する
      //   （BSLH01-R01「駆動」card_event(leave_field)+stay_on_field(self) と同型、対象を
      //   自分の他スピリットも含む game_event(player:"self")+triggerFilter に拡張）。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          triggerFilter: {
            category: ["spirit"],
            tribes: ["風神"],
            minCost: 4,
            maxCost: 6,
          },
          cause: ["opponent_effect"],
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        executionMode: "optional",
        steps: [
          { id: "r01-stay-cost", action: { kind: "pay_cost", amount: 1 } },
          {
            action: {
              kind: "stay_on_field",
              target: {
                kind: "trigger_related_instance",
                includePendingLeave: true,
              },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH05-R02",
    orikaId: 146,
    orikaIndex: 156,
    name: "豊符「オヲトシハーベスター」",
    printedCategory: "magic",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green", "god"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」を持つ。",
      "",
      "フラッシュ",
      "相手のスピリット1体を重疲労させる。",
      "",
      "スタック",
      "相手のバースト効果1つを無効にする。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想",
    image: "images/BSTH05-R02.webp",
    rarity: "R",
    pack: "BSTH05 東方風神録",
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
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "activated",
          mode: "stack",
        },
        steps: [
          {
            action: {
              targetEffectFilter: { timingKind: "burst" },
              targetController: "opponent",
              kind: "negate",
              negateTarget: "effect",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH05-R03",
    orikaId: 147,
    orikaIndex: 157,
    name: "犬走 椛",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green", "guide"],
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
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア2個をこのスピリットに置ける。その後、手札にある系統：「天狗」を持つコスト6以下のカード1枚を1コスト支払って召喚できる。この効果は、ターンに1回しか使えない。",
      "",
      "Lv2『自分のアタックステップ』",
      "系統：「天狗」を持つ自分のスピリットは、そのスピリットが持つ最高Lvとして扱う。",
    ],
    keywordTags: [],
    tribe: "幻想・風神・天狗",
    image: "images/BSTH05-R03.webp",
    rarity: "R",
    pack: "BSTH05 東方風神録",
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
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "this_card",
              },
              amount: 2,
            },
          },
          {
            executionMode: "optional",
            action: {
              costModifier: { fixedPayment: 1 },
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  tribes: ["天狗"],
                  maxCost: 6,
                },
                count: 1,
              },
            },
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "continuous",
        },
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
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], tribes: ["天狗"] },
                count: "all",
              },
              properties: { level: "max" },
              duration: { scope: "step", whose: "self", step: "attack" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH05-X01",
    orikaId: 149,
    orikaIndex: 158,
    name: "[創界神]八坂 神奈子",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 2,
    reductionSymbols: ["green"],
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
    symbolColors: ["green"],
    textLines: [
      "このネクサスは創界神ネクサス対象の効果しか受けない。このネクサスには神託と創界神ネクサス対象の効果でしかコアを置けず、そのコアは創界神ネクサス対象の効果しか受けず移動できない。",
      "",
      "【神託：〔風神／化神／神渡＆コスト3以上〕〔アシハラ＆ネクサス〕】",
      "◆対象の自分のスピリット/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、緑/導としても扱う。",
      "",
      "【転神：5】Lv1-Lv2 フラッシュ『自分のアタックステップ』",
      '〔このネクサスのコア5個をボイドに置く〕このターンの間、系統：「アシハラ」を持つ自分の創界神ネクサスすべては、Lv1/Lv2/BP3000、"『このスピリットのアタック時』相手のスピリット/アルティメット1体を疲労させる。"を持つスピリットとしても扱い、創界神ネクサス以外では破壊されない。',
      "",
      "【神域】Lv2『自分のアタックステップ』",
      "系統：「風神」/「アシハラ」を持つ自分のスピリット/創界神ネクサスをBP+5000する。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        // 〔風神／化神／神渡＆コスト3以上〕は bullet1「対象の自分のスピリット/ネクサス」に
        // 合わせ categories で spirit/nexus に限定（マジックカードを対象外にする）。
        {
          tribes: ["風神", "化神", "神渡"],
          minCost: 3,
          categories: ["spirit", "nexus"],
        },
        { tribes: ["アシハラ"], categories: ["nexus"] },
      ],
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 5,
          timing: { step: "attack", whose: "own", mode: "flash" },
          minLevel: 1,
          maxLevel: 2,
          effects: [
            {
              textRef: [8, 9],
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "divine_transform",
                    target: {
                      kind: "filter",
                      player: "self",
                      filter: {
                        category: ["nexus"],
                        tribes: ["アシハラ"],
                        targetsGrandwalker: "only",
                      },
                      count: "all",
                    },
                    bpByLevel: [
                      { level: 1, bp: 3000 },
                      { level: 2, bp: 3000 },
                    ],
                    protectedFromNonGrandwalker: true,
                  },
                },
                // 「"『このスピリットのアタック時』相手のスピリット/アルティメット1体を疲労させる。"を
                //   持つスピリットとしても扱い」= divine_transform 対象と同じ filter へ
                //   grant_effect (P3-99, template=BSDB01-R03) で attack-time exhaust を付与。
                //   duration:turn = 「このターンの間」(divineTransformState と同じ即時型持続)。
                {
                  action: {
                    kind: "grant_effect",
                    target: {
                      kind: "filter",
                      player: "self",
                      filter: {
                        category: ["nexus"],
                        tribes: ["アシハラ"],
                        targetsGrandwalker: "only",
                      },
                      count: "all",
                    },
                    duration: { scope: "turn" },
                    grantedEffect: {
                      timing: { kind: "card_event", event: "attack" },
                      executionMode: "mandatory",
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
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    tribe: "創界神・アシハラ",
    image: "images/BSTH05-X01.webp",
    rarity: "X",
    pack: "BSTH05 東方風神録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // textLines[0] 創界神ネクサス共通ルール（対象効果しか受けない・コア配置/移動制限）と
    //   textLines[2-4]【神託】(対象召喚/煌臨/配置時コア+1・配置時デッキ3枚トラッシュ→対象毎コア) は
    //   grandwalkerData + keywordTags(enter_field_core_placement_forbidden) で engine が表現する
    //   （checkAndQueueOracleChoices / checkAndQueuePlacementOracle, effect-resolution.ts 774/785）。
    //   DSL effect は不要なため effects[] には持たない。
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
              // 「緑/導としても扱う」: 印字は緑単色なので 導 (guide) 特殊シンボルを
              //   多色 treat_as で追加する（asColor 配列の全色を modifierSymbol に格納し、
              //   getEffectiveSymbols が既存シンボルへ緑・導を加算）。Lv1-Lv2 = 全レベルのため無条件。
              asColor: ["green", "guide"],
            },
          },
        ],
        textRef: [6],
      },
      // 【転神：5】本体は grandwalkerData.divineSkills[0] が実装 (use_divine_skill 経路、
      //   card.effects は経由しない)。このエントリは textLines[8,9] の audit bookkeeping 専用
      //   (steps:[] は inert — 起動効果として legal action 化されない。card.effects スキャンで
      //   activated/flash を legal action 化する経路は use_magic/hand-summon-permission のみで
      //   本カードは magic ではないため対象外)。divineSkills[0].effects[0] で
      //   divine_transform + grant_effect (attack-time exhaust) 両方を配線済み。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: { player: "self", period: "attack" },
        steps: [],
        textRef: [8, 9],
      },
      // 【神域】Lv2『自分のアタックステップ』系統:風神/アシハラの自分のスピリット/創界神ネクサスをBP+5000。
      //   timingScope:self.attack で「自分のアタックステップ中」継続を BSTH08-XX01 effects[2] と同型で表現。
      //   対象は filterOr 2 枝:
      //     枝A: spirit (通常スピリット)
      //     枝B: 創界神/導界者ネクサスのみ (通常ネクサス除外、BSTH05-X02 effects[1] と同型の
      //          targetsGrandwalker:"only" approximation。テキストは「創界神ネクサス」だが
      //          set 内既存規約に合わせる。ENGINE-card-filter-grandwalker-exclusive 2026-06-23 着地)。
      //   tribes は枝ごとに付け直す必要あり (filterOr 設定時は外側の直接フィールドは無視される。
      //   dsl-types.ts:271 / card-filter.ts:277-315)。
      {
        timing: {
          kind: "continuous",
        },
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
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  filterOr: [
                    {
                      category: ["spirit"],
                      tribes: ["風神", "アシハラ"],
                    },
                    {
                      category: ["nexus"],
                      tribes: ["風神", "アシハラ"],
                      targetsGrandwalker: "only",
                    },
                  ],
                },
                count: "all",
              },
              amount: 5000,
              // duration: while_on_field — KANAKO が場を離れた時点で per-target CE を
              //   recomputeContinuousEffects / legal-actions-shared.ts:1113-1118 が掃除する。
              //   BSTH08-XX01 effects[2] override_properties / BSDB01-X04 bp_modify と同型。
              //   旧 stub の "permanent" は source 不在後も BP+5000 を残す silent bug だった。
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
  {
    cardNo: "BSTH05-X02",
    orikaId: 150,
    orikaIndex: 159,
    name: "[創界神]洩矢 諏訪子",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 2,
    reductionSymbols: ["green"],
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
    symbolColors: ["green"],
    textLines: [
      "このネクサスは創界神ネクサス対象の効果しか受けない。このネクサスには神託と創界神ネクサス対象の効果でしかコアを置けず、そのコアは創界神ネクサス対象の効果しか受けず移動できない。",
      "",
      "【神託：〔風神／化神／神渡＆コスト3以上〕〔風神＆ブレイヴ〕】",
      "◆対象の自分のスピリット/ブレイヴを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、緑/導としても扱う。",
      "",
      "【神技：4】Lv1-Lv2 フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回、このネクサスのコア4個をボイドに置く〕自分の手札/手元にある系統：「風神」を持つスピリットカード1枚を軽減すべて満たしたものとして召喚する。",
      "",
      "【神域】Lv2『自分のアタックステップ』",
      "系統：「風神」/「アシハラ」を持つ自分のスピリット/創界神ネクサスは、バトル終了時、ターンに1回ずつ回復できる。この効果は重複しない。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        // bullet1「対象の自分のスピリット/ブレイヴ」はネクサスを含まない
        // （ブレイヴは下の条件で別掲）ため categories は spirit のみに限定する。
        {
          tribes: ["風神", "化神", "神渡"],
          minCost: 3,
          categories: ["spirit"],
        },
        { tribes: ["風神"], categories: ["brave"] },
      ],
      // 【神技：4】Lv1-Lv2 フラッシュ『お互いのアタックステップ』
      //   〔ターンに1回、コア4個をボイドに置く〕。コスト・ターン制限は divineSkills 経路。
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 4,
          timing: { step: "attack", whose: "both", mode: "flash" },
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          // 手札/手元から風神スピリット1枚を軽減すべて満たしたものとして召喚。
          effects: [
            {
              textRef: [8, 9],
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    costModifier: "full_reduction",
                    kind: "summon",
                    target: {
                      kind: "from_zone",
                      zone: ["hand", "set_aside"],
                      filter: {
                        category: ["spirit"],
                        tribes: ["風神"],
                      },
                      count: 1,
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    tribe: "創界神・アシハラ",
    image: "images/BSTH05-X02.webp",
    rarity: "X",
    pack: "BSTH05 東方風神録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // textLines[0] 創界神ネクサス共通ルールと textLines[2-4]【神託】は grandwalkerData +
    //   keywordTags(enter_field_core_placement_forbidden) で engine が表現する
    //   （checkAndQueueOracleChoices / checkAndQueuePlacementOracle）。DSL effect は不要。
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
              // 「緑/導としても扱う」: 印字は緑単色なので 導 (guide) 特殊シンボルを
              //   多色 treat_as で追加する（asColor 配列の全色を modifierSymbol に格納し、
              //   getEffectiveSymbols が既存シンボルへ緑・導を加算）。Lv1-Lv2 = 全レベルのため無条件。
              asColor: ["green", "guide"],
            },
          },
        ],
        textRef: [6],
      },
      // 【神技：4】(flash) は grandwalkerData.divineSkills で表現（上記参照）。
      // 【神域】Lv2『自分のアタックステップ』系統「風神」/「アシハラ」を持つ自分の
      //   スピリット/創界神ネクサスは、バトル終了時、ターンに1回ずつ回復できる。
      //   この効果は重複しない。
      // 第三者 game_event:battle_end 観測。参加側(action)と発揮期間(timingScope)は別軸。
      // triggerFilter で主語 Y を絞り、
      //   target=trigger_related_instance で Y 自身を回復する。
      // usageLimit:
      //   - per_trigger_related_instance turn: 「ターンに1回ずつ」(Y 別に独立 turn 1 回)
      //   - no_duplicate: 「この効果は重複しない」(同名創界神ネクサスが複数いても 1 回)
      // category:["spirit","nexus"] + targetsGrandwalker:"only" で通常ネクサスを除外し
      //   創界神/導界者ネクサスのみ admit (ENGINE-card-filter-grandwalker-exclusive 着地済)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "battle_end",
          triggerFilter: {
            // 「系統：「風神」/「アシハラ」を持つ自分のスピリット/創界神ネクサス」
            // = filterOr の両枝に系統 OR 条件を置く。matchesCardFilter は filterOr
            // がある場合、外側フィールドを評価しないため、ここへ共有条件を置かない。
            // 枝A = spirit、枝B = 創界神/導界者 nexus。
            //   枝A: spirit (通常スピリット)
            //   枝B: 創界神/導界者ネクサスのみ (通常ネクサス除外)
            //   通常ネクサスは枝A の category mismatch + 枝B の "only" 拒否で除外される。
            //   ENGINE-card-filter-grandwalker-exclusive 2026-06-23 着地パターン。
            filterOr: [
              {
                category: ["spirit"],
                tribes: ["風神", "アシハラ"],
                tribesLogic: "or",
              },
              {
                category: ["nexus"],
                targetsGrandwalker: "only",
                tribes: ["風神", "アシハラ"],
                tribesLogic: "or",
              },
            ],
          },
        },
        condition: [{ kind: "min_level", value: 2 }],
        timingScope: { player: "self", period: "attack" },
        executionMode: "optional",
        usageLimit: [
          // 「ターンに1回ずつ」= 主語 Y 別に独立 turn 1 回
          //   (ENGINE-usagelimit-per-trigger-related-instance-turn 着地パターン)。
          { kind: "per_trigger_related_instance", duration: "turn" },
          // 「この効果は重複しない」= 同名創界神ネクサスが複数いても 1 回 (no_duplicate)。
          { kind: "no_duplicate" },
        ],
        steps: [
          {
            action: {
              kind: "recover",
              // 主語 Y (バトル終了の triggerFilter にマッチした自スピリ/グランドウォーカー
              //   ネクサス) 自身を回復対象にする。
              target: { kind: "trigger_related_instance" },
            },
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
  {
    cardNo: "BSTH05-X03",
    orikaId: 151,
    orikaIndex: 160,
    name: "東風谷 早苗",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "green", "guide"],
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
        requiredCores: 5,
        bp: 11000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "ボイドからコア1個ずつを系統：「幻想」/「風神」を持つ自分の緑のスピリット3体に置ける。",
      "",
      "Lv2-Lv3『自分のアタックステップ開始時』",
      "自分のトラッシュのコアすべてを系統：「風神」を持つ自分のスピリットに好きなように置ける。そうしたとき、置いたコア3個につき相手のスピリット/アルティメット1体を手札に戻す。",
      "",
      "Lv3『このスピリットのアタック時』",
      "バトル終了時、ターンに1回、相手のライフのコア1個を相手のリザーブに置く。",
    ],
    keywordTags: [],
    tribe: "神渡・幻想・風神",
    image: "images/BSTH05-X03.webp",
    rarity: "X",
    pack: "BSTH05 東方風神録",
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
              kind: "core_distribute",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "filter",
                player: "self",
                filter: {
                  tribes: ["幻想", "風神"],
                  category: ["spirit"],
                  colors: ["green"],
                },
                count: 3,
              },
              amount: 3,
              mode: "one_each",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          whose: "self",
          kind: "phase",
          step: "attack",
          subPhase: "start",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        executionMode: "optional",
        steps: [
          {
            id: "trashCoreDistribute",
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              target: {
                kind: "filter",
                player: "self",
                filter: { tribes: ["風神"], category: ["spirit"] },
                count: "all",
              },
              to: {
                kind: "field_card",
                player: "self",
                filter: { tribes: ["風神"], category: ["spirit"] },
              },
              amount: "all",
            },
          },
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: {
                  source: {
                    kind: "step_numeric_amount",
                    stepId: "trashCoreDistribute",
                  },
                  divisor: 3,
                },
              },
            },
            targetSelectionTiming: "on_step",
            connector: "conditional_result",
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
                kind: "reserve",
                player: "opponent",
              },
              amount: 1,
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH05-X04",
    orikaId: 152,
    orikaIndex: 161,
    name: "御社宮神",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 9,
    reductionSymbols: ["green", "green", "green", "god", "god"],
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
        bp: 18000,
      },
    ],
    symbolColors: ["green", "green"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "相手のスピリット/アルティメット3体を重疲労させる。この効果は【超重装甲】以外では防げない。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "系統：「アシハラ」を持つ自分の創界神ネクサスが2つ以上あるとき、相手はバースト/フラッシュ効果を発揮できない。",
      "",
      "Lv3『このスピリットのアタック時』",
      "バトル終了時、このスピリットのアタックで相手のライフが減っていないとき、ターンに1回、相手のライフのコア2個を相手のリザーブに置く。",
    ],
    keywordTags: ["burst"],
    tribe: "化神・神渡・風神",
    image: "images/BSTH05-X04.webp",
    rarity: "X",
    pack: "BSTH05 東方風神録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』相手のスピリット/アルティメット3体を重疲労させる。
      // 「【超重装甲】以外では防げない」= preventionRestriction.onlyPreventableByKeywords:
      //   ["超重装甲"]（dsl-types.ts §preventionRestriction）。一致しない防止元だけを
      //   scoped 貫通する（10_rules/04b §効果防止の優先順位 L56-57）。BSTH08-X03（同型）。
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        preventionRestriction: { onlyPreventableByKeywords: ["超重装甲"] },
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 3,
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『アタック時』アシハラ創界神ネクサス≧2のとき相手はバースト/フラッシュ効果を
      // 発揮できない（このバトルの間）。field_has の minCount で 2 個以上、grandwalkerKind で
      // 創界神に限定。フラッシュは restrict_flash、バーストは negate(opponent_burst,
      // cannot_activate)（P3-77 Step B/C: バースト効果発揮できない CE）。
      // P3-134分類: この field_has は「アシハラ創界神ネクサス≧2のとき」という存在/カウント
      // 条件のため、grandwalkerKind:"grandwalker" narrowing は現状維持が正当
      // (10_rules/07:56「創界神ネクサスがあるとき、のような条件では創界神ネクサスとして
      // 数えない」＝導界者ネクサスをこのカウントに含めない)。
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
          {
            kind: "field_has",
            player: "self",
            category: ["nexus"],
            tribes: ["アシハラ"],
            grandwalkerKind: "grandwalker",
            minCount: 2,
          },
        ],
        steps: [
          {
            action: {
              kind: "restrict_flash",
              player: "opponent",
              duration: {
                scope: "battle",
              },
            },
          },
          {
            action: {
              kind: "negate",
              negateTarget: "opponent_burst",
              burstSuppressKind: "cannot_activate",
              duration: {
                scope: "battle",
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
        // 「このスピリットのアタックで相手のライフが減っていないとき」= condition
        // kind:"battle_life_reduced" + negate:true。fireBattleEndDeferrals が
        // executeBattleResolution で算出した appliedLifeDamage(>0か) を
        // TriggerContext.battleLifeReduced 経由で運び、この deferredTo:"battle_end"
        // 効果の condition 評価時にのみ参照する(通常評価では常に false=安全側)。
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
          {
            kind: "battle_life_reduced",
            negate: true,
          },
        ],
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
];
