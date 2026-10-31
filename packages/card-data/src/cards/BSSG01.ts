import type { CardDefinition } from "@orica/rules-core";

export const BSSG01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSSG01-C01",
    orikaId: 355,
    orikaIndex: 372,
    name: "暁 切歌",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 3000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "待機状態を含まない自分の「暁 切歌」は、フィールドに1体しか存在できない。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個をこのスピリットに置ける。さらに、〔ターンに1回：同名〕自分のデッキを上から3枚オープンできる。その中の系統：「装者」を持つカード1枚を手札に加える。残ったカードはデッキの下に戻す。",
      "",
      "Lv1-Lv2",
      "このスピリットは、相手の効果を受けず、アタック/ブロックできない。",
      "",
      "【聖詠】Lv1-Lv2『お互いのアタックステップ開始時』",
      "このスピリットを自分の手札にあるコスト4/5の「暁 切歌」と入れ替えられる。自分の「月読 調」がいるとき、回復状態で入れ替えられる。",
    ],
    keywordTags: [],
    tribe: "制服・装者",
    image: "images/BSSG01-C01.webp",
    rarity: "C",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 待機状態を含まない自分の「暁 切歌」は1体しか存在できない。
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
      // [3] 召喚時: ボイド→このスピリットにコア1個。さらに〔ターン1回:同名〕デッキ3オープン→装者1枚を手札、残りデッキ下。
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
                kind: "this_card",
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
      // [8] 聖詠: お互いのアタックステップ開始時、手札のコスト4/5「暁 切歌」と入れ替えられる。
      //   「月読 調」がいるとき回復状態で入れ替え(queue_field_hand_swap、BSSG02-C01 同型)。
      //   相方の有無は field_has の minCount/maxCount で presence/absence を排他分岐する
      //   2 step (choice ではなく通常 steps の条件分岐、CLAUDE.md 専用フィールド追加禁止に
      //   従い enterRecovered 自体は静的 boolean のまま既存 DSL で表現)。
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
            condition: [
              {
                kind: "field_has",
                player: "self",
                cardNames: [
                  {
                    contains: "月読 調",
                  },
                ],
              },
            ],
          },
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
              enterRecovered: false,
            },
            condition: [
              {
                kind: "field_has",
                player: "self",
                cardNames: [
                  {
                    contains: "月読 調",
                  },
                ],
                minCount: 0,
                maxCount: 0,
              },
            ],
            connector: "sequential",
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSG01-C02",
    orikaId: 356,
    orikaIndex: 373,
    name: "月読 調",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["green"],
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
    symbolColors: ["red"],
    textLines: [
      "待機状態を含まない自分の「月読 調」は、フィールドに1体しか存在できない。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分はデッキの上から1枚ドローできる。さらに、〔ターンに1回：同名〕自分のデッキを上から3枚オープンできる。その中の系統：「装者」を持つカード1枚を手札に加える。残ったカードはデッキの下に戻す。",
      "",
      "Lv1-Lv2",
      "このスピリットは、相手の効果を受けず、アタック/ブロックできない。",
      "",
      "【聖詠】Lv1-Lv2『お互いのアタックステップ開始時』",
      "このスピリットを自分の手札にあるコスト4/5の「月読 調」と入れ替えられる。自分の「暁 切歌」がいるとき、回復状態で入れ替えられる。",
    ],
    keywordTags: [],
    tribe: "制服・装者",
    image: "images/BSSG01-C02.webp",
    rarity: "C",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 待機状態を含まない自分の「月読 調」は1体しか存在できない。
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
      // [3] 召喚時: デッキ1ドロー。さらに〔ターン1回:同名〕デッキ3オープン→装者1枚を手札、残りデッキ下。
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "draw",
              count: 1,
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
      // [8] 聖詠: お互いのアタックステップ開始時、手札のコスト4/5「月読 調」と入れ替えられる。
      //   「暁 切歌」がいるとき回復状態で入れ替え。BSSG01-C01 と対称同型。
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
            condition: [
              {
                kind: "field_has",
                player: "self",
                cardNames: [
                  {
                    contains: "暁 切歌",
                  },
                ],
              },
            ],
          },
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
              enterRecovered: false,
            },
            condition: [
              {
                kind: "field_has",
                player: "self",
                cardNames: [
                  {
                    contains: "暁 切歌",
                  },
                ],
                minCount: 0,
                maxCount: 0,
              },
            ],
            connector: "sequential",
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSG01-C03",
    orikaId: 357,
    orikaIndex: 374,
    name: "暁 切歌「イガリマ-GX-」",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green", "red"],
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
      "待機状態を含まない自分の「暁 切歌」は、フィールドに1体しか存在できない。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個をこのスピリットに置ける。自分の「月読 調」がいるとき、コスト5以下の相手のスピリット/アルティメット1体を疲労させられる。この効果は、手札から入れ替えたときにも発揮できる。",
      "",
      "Lv1-Lv2",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットに自分のフィールド/リザーブのコアを好きなだけ置いて同じ状態で残せる。",
      "",
      "Lv2『このスピリットのアタック/ブロック時』",
      "ボイドからコア1個をこのスピリットに置く。",
    ],
    keywordTags: [],
    tribe: "装者",
    image: "images/BSSG01-C03.webp",
    rarity: "C",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 待機状態を含まない自分の「暁 切歌」は1体しか存在できない。
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
      // [3] 召喚時: ボイド→このスピリットにコア1個。「月読 調」がいるときコスト5以下の相手1体を疲労。
      //   「この効果は、手札から入れ替えたときにも発揮できる」= event に field_hand_swap を追加
      //   (ENGINE-field-hand-swap-trigger、BSSG01-C01/C02 の聖詠入れ替えで場に入ったときも
      //   card_event 自己誘発として再発揮する)。
      {
        timing: {
          kind: "card_event",
          event: ["summon", "field_hand_swap"],
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
                kind: "this_card",
              },
              amount: 1,
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxCost: 5,
                },
                count: 1,
              },
            },
            condition: [
              {
                kind: "field_has",
                player: "self",
                cardNames: [
                  {
                    contains: "月読 調",
                  },
                ],
              },
            ],
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [3],
      },
      // [6] 相手によってフィールドを離れるとき、フィールド/リザーブのコアを好きなだけ置いて
      //   同じ状態で残せる（任意）。BSSG01-M01 [5] と同構造。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "stay_on_field",
              target: {
                kind: "self",
              },
            },
          },
          {
            action: {
              kind: "core_distribute",
              from: {
                kind: "field_and_reserve_self",
              },
              to: {
                kind: "self",
              },
              amount: "all",
              mode: "player_choice",
            },
            connector: "sequential",
          },
        ],
        textRef: [5, 6],
      },
      // [9] Lv2『アタック/ブロック時』ボイドからコア1個をこのスピリットに置く。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSG01-C04",
    orikaId: 358,
    orikaIndex: 375,
    name: "月読 調「シャルシャガナ-GX-」",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "green"],
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
    symbolColors: ["red"],
    textLines: [
      "待機状態を含まない自分の「月読 調」は、フィールドに1体しか存在できない。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分はデッキの上から1枚ドローできる。自分の「暁 切歌」がいるとき、BP7000以下の相手のスピリット/アルティメット1体を破壊できる。この効果は、手札から入れ替えたときにも発揮できる。",
      "",
      "Lv1-Lv2",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットに自分のフィールド/リザーブのコアを好きなだけ置いて同じ状態で残せる。",
      "",
      "Lv2『このスピリットのアタック/ブロック時』",
      "自分はデッキの上から1枚ドローする。",
    ],
    keywordTags: [],
    tribe: "装者",
    image: "images/BSSG01-C04.webp",
    rarity: "C",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 待機状態を含まない自分の「月読 調」は1体しか存在できない。
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
      // [3] 召喚時: デッキ1ドロー。「暁 切歌」がいるときBP7000以下の相手1体を破壊。
      //   「この効果は、手札から入れ替えたときにも発揮できる」= event に field_hand_swap を追加
      //   (ENGINE-field-hand-swap-trigger、BSSG01-C01/C02 の聖詠入れ替えで場に入ったときも
      //   card_event 自己誘発として再発揮する)。
      {
        timing: {
          kind: "card_event",
          event: ["summon", "field_hand_swap"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "draw",
              count: 1,
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxBp: 7000,
                },
                count: 1,
              },
            },
            condition: [
              {
                kind: "field_has",
                player: "self",
                cardNames: [
                  {
                    contains: "暁 切歌",
                  },
                ],
              },
            ],
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [3],
      },
      // [6] 相手によってフィールドを離れるとき、フィールド/リザーブのコアを好きなだけ置いて
      //   同じ状態で残せる（任意）。BSSG01-M01 [5] と同構造。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "stay_on_field",
              target: {
                kind: "self",
              },
            },
          },
          {
            action: {
              kind: "core_distribute",
              from: {
                kind: "field_and_reserve_self",
              },
              to: {
                kind: "self",
              },
              amount: "all",
              mode: "player_choice",
            },
            connector: "sequential",
          },
        ],
        textRef: [5, 6],
      },
      // [9] Lv2『アタック/ブロック時』自分はデッキの上から1枚ドローする。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSG01-C05",
    orikaId: 359,
    orikaIndex: 376,
    name: "ギアペンダント",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/黄としても扱う。",
      "",
      "【ミラージュ：コスト2（このカードは手札からセットできる）】",
      "【セット中】",
      "自分が【聖詠】を発揮したとき、ボイドからコア1個を自分のリザーブに置き、自分はデッキの上から1枚ドローする。",
      "",
      "メイン",
      "トラッシュにある系統：「装者」を持つカード2枚を手札に戻す。",
    ],
    keywordTags: [],
    tribe: "装者",
    image: "images/BSSG01-C05.webp",
    rarity: "C",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【ミラージュ：コスト2（このカードは手札からセットできる）】= mirageData 宣言。
    // 軽減シンボル指定なし (原文にコスト以外の色指定なし、BSTS01-C06 同型)。
    mirageData: { cost: 2, reduction: [] },
    effects: [
      // [0] 軽減シンボルは赤/紫/緑/白/黄としても扱う（treat_as ×5、各 asColor 1色）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // [2-4]【セット中】自分が【聖詠】を発揮したとき、ボイド→自分のリザーブにコア1個 +
      //   デッキ上から1枚ドロー（終止形=強制）。applicability.zone:"mirage_set" でセット中のみ
      //   起動し、game_event:field_hand_swap(player:"self") で聖詠発揮者本人を観測する
      //   (ENGINE-field-hand-swap-trigger、BSSG01-C01/C02 の queue_field_hand_swap → swap_field_hand
      //   が発火元)。
      {
        applicability: { zone: "mirage_set" },
        timing: {
          kind: "game_event",
          event: "field_hand_swap",
          player: "self",
          effectScope: "shouei",
        },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
          },
          {
            action: { kind: "draw", count: 1 },
            connector: "sequential",
          },
        ],
        textRef: [2, 3, 4],
      },
      // [7] メイン: トラッシュの系統:「装者」2枚を手札に戻す。
      //   原文「2枚を手札に戻す」(終止形=強制) → search_zone(mandatory:true) 経路で
      //   候補>2 のとき pendingZoneSelection(canSkip:false) を発行しプレイヤーに選ばせる。
      //   旧 move_card 経路は target を持たないため engine が candidates.slice(0,2) を
      //   自動採用していた (ENGINE-step-optional-zone-pick-pending-selection-NARROW)。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              player: "self",
              filter: { tribes: ["装者"] },
              count: 2,
              destination: "hand",
              mandatory: true,
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSSG01-C06",
    orikaId: 360,
    orikaIndex: 377,
    name: "生きるのを諦めるな！",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/青としても扱う。",
      "",
      "フラッシュ",
      "このバトル終了時、アタックステップを終了する。",
      "",
      "スタック",
      "相手のスピリット/アルティメット1体を指定する。このターンの間、そのスピリット/アルティメットによって自分のライフは減らない。この効果は、お互いのアタックステップしか使用できない。",
    ],
    keywordTags: [],
    tribe: "装者",
    image: "images/BSSG01-C06.webp",
    rarity: "C",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 軽減シンボルは赤/紫/緑/白/青としても扱う（treat_as ×5、各 asColor 1色）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // [2-3] フラッシュ: このバトル終了時、アタックステップを終了する。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [{ action: { kind: "end_attack_step" }, deferTo: "battle_end" }],
        textRef: [2, 3],
      },
      // [5-6] スタック: 相手スピリット/アルティメット1体を指定、このターンの間、
      // そのスピリット/アルティメットによって自分のライフは減らない。
      // life_damage_interception(replace) + attackerSelectedTarget で、解決時に選ばれた
      // 対象 instanceId を CE metadata.attackerInstanceIds に格納し per-participant 防止。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "replace",
              attackerSelectedTarget: true,
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSSG01-C07",
    orikaId: 361,
    orikaIndex: 378,
    name: "SONG司令室",
    printedCategory: "nexus",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 3,
    reductionSymbols: ["red", "purple", "green", "white", "yellow", "blue"],
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
    symbolColors: ["red"],
    textLines: [
      "系統：「装者」/「錬金術師」を持つ効果でデッキからオープンされたこのカードは、手札1枚と入れ替えられる。",
      "",
      "Lv1-Lv2",
      "このネクサスのシンボルは、紫/緑/白/黄/青としても扱う。",
      "",
      "Lv1-Lv2『自分のメインステップ』",
      "〔ターンに1回：同名〕手札の系統：「装者」/「錬金術師」を持つカード1枚を破棄することで、自分はデッキの上から2枚ドローする。",
      "",
      "Lv2『自分のアタックステップ』",
      "自分の系統：「装者」を持つスピリット/アルティメットがいる間、相手はスタック効果を発揮できない。",
    ],
    keywordTags: [],
    tribe: "装者",
    image: "images/BSSG01-C07.webp",
    rarity: "C",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 系統:装者/錬金術師効果でデッキからオープンされたこのカードは手札1枚と入れ替えられる。
      //     swap 型 disposition（07b §鍵/星霊デッキオープン置換 line 40）。可能形語尾 = 任意。
      {
        timing: { kind: "card_event", event: ["revealed"] },
        cardEventDisposition: { kind: "swap" },
        condition: [
          { kind: "trigger_tribes", tribes: ["装者", "錬金術師"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [],
        executionMode: "optional",
        textRef: [0],
      },
      // [3-4] Lv1-Lv2 このネクサスのシンボルは紫/緑/白/黄/青としても扱う（treat_as ×5、各 asColor 1色）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: "purple",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [2, 3],
      },
      // [6-7] Lv1-Lv2 メイン: 〔ターン1回:同名〕手札の装者/錬金術師1枚を破棄して2枚ドロー。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "discard",
              count: 1,
              player: "self",
              fromZone: "hand",
              filter: { tribes: ["装者", "錬金術師"], tribesLogic: "or" },
            },
          },
          {
            action: { kind: "draw", count: 2 },
            connector: "conditional_cost",
          },
        ],
        usageLimit: { kind: "per_card_name", duration: "turn" },
        textRef: [5, 6],
      },
      // [9-10] Lv2『自分のアタックステップ』装者がいる間、相手はスタック効果を発揮できない。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [
          { kind: "min_level", value: 2 },
          {
            kind: "field_has",
            player: "self",
            tribes: ["装者"],
            category: ["spirit", "ultimate"],
          },
        ],
        steps: [
          {
            action: {
              kind: "restrict_stack",
              player: "opponent",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSG01-C08",
    orikaId: 362,
    orikaIndex: 379,
    name: "エルフナイン",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow"],
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
      "デッキからオープンされたこのカードは、トラッシュに置ける。",
      "",
      "トラッシュにあるこのカードは、自分のメインステップに配置できる。",
      "",
      "このカード/ネクサスのシンボル/軽減シンボルは、赤/紫/緑/白/青としても扱う。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "〔ターンに1回：同名〕自分のデッキを上から4枚オープンできる。その中の系統：「装者」を持つコスト5以下のスピリット1枚をコストを支払わずに召喚できる。残ったカードはデッキの下に戻す。",
      "",
      "Lv2",
      "自分のスピリット/アルティメットが相手の効果でフィールドを離れるとき、そのスピリット/アルティメットの煌臨元のコスト4/5の系統：「装者」を持つカードすべてをコストを支払わずに召喚できる。",
    ],
    keywordTags: [],
    tribe: "錬金術師",
    image: "images/BSSG01-C08.webp",
    rarity: "C",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] デッキからオープンされたこのカードは任意でトラッシュに置ける。
      {
        timing: { kind: "card_event", event: "revealed" },
        cardEventDisposition: { kind: "move", destination: "trash" },
        condition: [{ kind: "trigger_from_zone", zones: ["deck"] }],
        steps: [{ action: { kind: "move_self", destination: "trash" } }],
        executionMode: "optional",
        textRef: [0],
      },
      // [2] Q54 型: トラッシュにあるこのカードを自分のメインステップに通常配置できる。
      // normalActionPermission が通常 place_nexus legal action 許可の明示的な正源。
      {
        applicability: { zone: ["trash"] },
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        steps: [
          {
            action: {
              kind: "summon",
              normalActionPermission: true,
              target: { kind: "self" },
            },
          },
        ],
        executionMode: "optional",
        textRef: [2],
      },
      // [4] このカード/ネクサスのシンボル/軽減シンボルは赤/紫/緑/白/青としても扱う（treat_as ×5、各 asColor 1色）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [4],
      },
      // [6-7] Lv1-Lv2 配置時: 〔ターン1回:同名〕デッキ4オープン→装者コスト5以下スピリット1枚をコストなし召喚、残りデッキ下。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["spirit"],
                    tribes: ["装者"],
                    maxCost: 5,
                  },
                  destination: "field",
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        usageLimit: { kind: "per_card_name", duration: "turn" },
        textRef: [6, 7],
      },
      // [9-10] Lv2: 自分のスピリット/アルティメットが相手効果で離れるとき、
      // pending leave 中の煌臨元のコスト4/5装者すべてをコストなし召喚。
      // 第三者 game_event:leave_field 観測 (cause:"opponent_effect") だが「離れたとき」
      // ではないため exactEventKind は使わない。pre-flush の destroy/vanish/bounce 等に
      // leave_field umbrella として反応し、trigger-system.ts が host の underCards を
      // adventSourceInstanceIds にスナップショットする。SummonAction は includeAdventSource
      // + restrictToTriggerLeaveAdventSource で、その pending 中の煌臨元だけを参照する
      // (engine-advent-source-leave-summon)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          cause: "opponent_effect",
          triggerFilter: { category: ["spirit", "ultimate"] },
        },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "trash",
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  tribes: ["装者"],
                  minCost: 4,
                  maxCost: 5,
                },
                count: "all",
                includeAdventSource: true,
                restrictToTriggerLeaveAdventSource: true,
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSSG01-M01",
    orikaId: 363,
    orikaIndex: 380,
    name: "暁 切歌「イガリマ-XV-」",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 5,
    reductionSymbols: ["green", "green", "red"],
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
      "待機状態を含まない自分の「暁 切歌」は、フィールドに1体しか存在できない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック/ブロック時』",
      "ボイドからコア1個をこのスピリットに置く。さらに、「月読 調」がいるとき、相手のスピリット/アルティメット1体を疲労させる。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットに自分のフィールド/リザーブのコアを好きなだけ置いて同じ状態で残せる。",
      "",
      "Lv1-Lv2-Lv3",
      "自分は、「暁 切歌」を《ソウルコア》をトラッシュに置いたものとしてこのスピリットに【煌臨】できる。",
    ],
    keywordTags: ["advent"],
    tribe: "装者",
    image: "images/BSSG01-M01.webp",
    rarity: "M",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [8] 自分は「暁 切歌」を《ソウルコア》をトラッシュに置いたものとしてこのスピリットに
    //   【煌臨】できる = host 側 (被煌臨側) 煌臨許可付与 (hostDualAdventGrant、
    //   mechanics/host-dual-advent.ts、BSDB01-CX01【真バディ】と同型 SSOT、1 スロットのみ
    //   使用)。「暁 切歌」= 部分一致 (M03 adventData の同一引用と同じ contains 規約)。
    //   裁定確定 (2026-07-25、needs-ruling.jsonl cardNo BSSG01-M01/M02、案A):
    //   原文通りに実装する。(1) 通常 (ソウルコア消費) 経路の記述が無いため
    //   normalPathDisabled:true (擬制消費のみが唯一の入口。実消費経路は別途 M03 の
    //   adventData が「暁 切歌＆コスト4以上」条件で提供済みのため重複不要)。
    //   (2)「ターンに1回」の明記が無いため alternateCost.turnLimitDisabled:true
    //   (1ターンに複数回可。field_name_uniqueness [0] による同名1体制限が実質的な歯止め)。
    //   常時の支払い置換にターン制限はなく、煌臨カード自身の印字タイミングに従う (08a6)。
    //   「このとき…コアを好きなだけ置く」節が無いため hostCoreDistributionOnAdvent は付与しない。
    hostDualAdventGrant: {
      slots: [{ cardNames: [{ contains: "暁 切歌" }] }],
      timing: "main_and_flash",
      normalPathDisabled: true,
      alternateCost: { timing: "main_and_flash", turnLimitDisabled: true },
    },
    effects: [
      // [0] 待機状態を含まない自分の「暁 切歌」は1体しか存在できない。
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
      // [2-3] Lv1-3 アタック/ブロック時: ボイド→このスピリットにコア1個。「月読 調」がいるとき相手1体を疲労。
      {
        timing: {
          kind: "card_event",
          event: ["attack", "block"],
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
                kind: "this_card",
              },
              amount: 1,
            },
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
                count: 1,
              },
            },
            condition: [
              {
                kind: "field_has",
                player: "self",
                cardNames: [
                  {
                    contains: "月読 調",
                  },
                ],
              },
            ],
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      // [5] 相手によってフィールドを離れるとき、フィールド/リザーブのコアを好きなだけ置いて
      //   同じ状態で残せる（任意=「残せる」）。離脱待機後に stay_on_field（newExhaustState 省略=
      //   同じ状態）でフィールドに残し、core_distribute（any_movable_self→this_card,
      //   player_choice）で 0〜任意個のコアをこのスピリットへ配置する。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "stay_on_field",
              target: {
                kind: "self",
              },
            },
          },
          {
            action: {
              kind: "core_distribute",
              from: {
                kind: "field_and_reserve_self",
              },
              to: {
                kind: "self",
              },
              amount: "all",
              mode: "player_choice",
            },
            connector: "sequential",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSSG01-M02",
    orikaId: 364,
    orikaIndex: 381,
    name: "月読 調「シャルシャガナ-XV-」",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "green"],
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
    symbolColors: ["red"],
    textLines: [
      "待機状態を含まない自分の「月読 調」は、フィールドに1体しか存在できない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック/ブロック時』",
      "自分はデッキの上から1枚ドローする。さらに、「暁 切歌」がいるとき、シンボル1つの相手のスピリット/アルティメット1体を破壊する。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットに自分のフィールド/リザーブのコアを好きなだけ置いて同じ状態で残せる。",
      "",
      "Lv1-Lv2-Lv3",
      "自分は、「月読 調」を《ソウルコア》をトラッシュに置いたものとしてこのスピリットに【煌臨】できる。",
    ],
    keywordTags: ["advent"],
    tribe: "装者",
    image: "images/BSSG01-M02.webp",
    rarity: "M",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [8] 自分は「月読 調」を《ソウルコア》をトラッシュに置いたものとしてこのスピリットに
    //   【煌臨】できる = host 側煌臨許可付与。BSSG01-M01 [8] と同構造・同裁定
    //   (needs-ruling.jsonl cardNo BSSG01-M01/M02、案A)。実消費経路は M04 の adventData
    //   (「月読 調＆コスト4以上」) が提供済み。
    hostDualAdventGrant: {
      slots: [{ cardNames: [{ contains: "月読 調" }] }],
      timing: "main_and_flash",
      normalPathDisabled: true,
      alternateCost: { timing: "main_and_flash", turnLimitDisabled: true },
    },
    effects: [
      // [0] 待機状態を含まない自分の「月読 調」は1体しか存在できない。
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
      // [2-3] Lv1-3 アタック/ブロック時: デッキ1ドロー。「暁 切歌」がいるときシンボル1つの相手1体を破壊。
      {
        timing: {
          kind: "card_event",
          event: ["attack", "block"],
        },
        steps: [
          {
            action: {
              kind: "draw",
              count: 1,
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
                  symbolCount: 1,
                },
                count: 1,
              },
            },
            condition: [
              {
                kind: "field_has",
                player: "self",
                cardNames: [
                  {
                    contains: "暁 切歌",
                  },
                ],
              },
            ],
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      // [5] 相手によってフィールドを離れるとき、フィールド/リザーブのコアを好きなだけ置いて
      //   同じ状態で残せる（任意）。BSSG01-M01 [5] と同構造。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "stay_on_field",
              target: {
                kind: "self",
              },
            },
          },
          {
            action: {
              kind: "core_distribute",
              from: {
                kind: "field_and_reserve_self",
              },
              to: {
                kind: "self",
              },
              amount: "all",
              mode: "player_choice",
            },
            connector: "sequential",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSSG01-M03",
    orikaId: 365,
    orikaIndex: 382,
    name: "暁 切歌「イガリマ-IGNITE-」",
    printedCategory: "spirit",
    colors: ["green", "purple"],
    cost: 7,
    reductionSymbols: ["green", "green", "red", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 10000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 13000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ【煌臨：「暁 切歌＆コスト4以上」『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "待機状態を含まない自分の「暁 切歌」はフィールドに1体しか存在できない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの煌臨/アタック時』",
      "ターンに1回、ボイドからコア2個をこのスピリットに置くことができ、相手のスピリット/アルティメット1体を重疲労できる。その後、疲労状態の相手のスピリット/アルティメット1体のコア4個をリザーブに置ける。",
      "",
      "Lv2-Lv3 フラッシュ『このスピリットのアタック時』",
      "ターンに1回、自分の「月読 調」がいるとき、相手の創界神ネクサス1つを破壊でき、このスピリットを回復できる。",
    ],
    keywordTags: ["advent"],
    tribe: "装者",
    image: "images/BSSG01-M03.webp",
    rarity: "M",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【煌臨：「暁 切歌＆コスト4以上」『お互いのアタックステップ』】。
    // 煌臨宣言は CardDefinition.adventData で表現する（AdventData + executeAdvent、P2-07 Phase C 完了、
    // 11 L149 / 08a §1）。『お互いのアタックステップ』= both_attack_step、ソウルコア→トラッシュ。
    // 煌臨先の名前条件は AdventCondition.cardNames で表現済み（engine-drain）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "暁 切歌" }],
        targetCategory: ["spirit"],
        minCost: 4,
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
    },
    effects: [
      // [3] 待機状態を含まない自分の「暁 切歌」は1体しか存在できない。
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
        textRef: [3],
      },
      // [5,6] Lv1-3『煌臨/アタック時』ターンに1回、ボイド→自身コア2個＋相手1体重疲労。その後、疲労状態の相手1体のコア4個をリザーブへ。
      {
        timing: {
          kind: "card_event",
          event: ["advent", "attack"],
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
                kind: "void",
                player: "self",
              },
              to: {
                kind: "this_card",
              },
              amount: 2,
            },
            executionMode: "optional",
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
                count: 1,
              },
              degree: "heavy_exhaust",
            },
            connector: "simultaneous",
            executionMode: "optional",
          },
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  exhaustState: "exhausted",
                  minCores: 4,
                },
                count: 1,
              },
              from: {
                kind: "target_card",
              },
              to: {
                kind: "reserve",
                player: "opponent",
              },
              amount: 4,
            },
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [5, 6],
      },
      // [8,9] Lv2-3 フラッシュ『アタック時』ターンに1回、「月読 調」がいるとき相手の創界神ネクサス1つ破壊＋自身回復。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        condition: [
          {
            kind: "self_state",
            state: "on_field",
            reference: "self",
            battleState: "attacking",
          },
          {
            kind: "min_level",
            value: 2,
          },
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "月読 調",
              },
            ],
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
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                },
                count: 1,
              },
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "recover",
              target: {
                kind: "self",
              },
            },
            connector: "simultaneous",
            executionMode: "optional",
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSG01-M04",
    orikaId: 366,
    orikaIndex: 383,
    name: "月読 調「シャルシャガナ-IGNITE-」",
    printedCategory: "spirit",
    colors: ["red", "purple"],
    cost: 7,
    reductionSymbols: ["red", "red", "green", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 10000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 13000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "フラッシュ【煌臨：「月読 調＆コスト4以上」『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "待機状態を含まない自分の「月読 調」はフィールドに1体しか存在できない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの煌臨/アタック時』",
      "ターンに1回、自分はデッキの上から2枚ドローでき、コア3個以下の相手のスピリット/アルティメット1体を破壊できる。この効果で破壊したとき、相手の創界神ネクサスのコア3個をボイドに置く。",
      "",
      "Lv2-Lv3 フラッシュ『このスピリットのアタック時』",
      "ターンに1回、自分の「暁 切歌」がいるとき、相手のネクサス1つを破壊でき、このスピリットを回復できる。",
    ],
    keywordTags: ["advent"],
    tribe: "装者",
    image: "images/BSSG01-M04.webp",
    rarity: "M",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] 煌臨宣言は CardDefinition.adventData で表現する（11 L149 / 08a §1）。
    //   名前条件「月読 調」は AdventCondition.cardNames、コスト4以上は minCost:4 で表現（engine-drain）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "月読 調" }],
        targetCategory: ["spirit"],
        minCost: 4,
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
    },
    effects: [
      // [3] 待機状態を含まない自分の「月読 調」は1体しか存在できない。
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
        textRef: [3],
      },
      // [5,6] Lv1-3『煌臨/アタック時』ターンに1回、デッキ2ドロー＋相手1体破壊。破壊したとき、相手の創界神ネクサスのコア3個をボイドへ。
      {
        timing: {
          kind: "card_event",
          event: ["advent", "attack"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "draw",
              count: 2,
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxCores: 3,
                },
                count: 1,
              },
            },
            connector: "simultaneous",
            executionMode: "optional",
          },
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                },
              },
              to: {
                kind: "void",
                player: "opponent",
              },
              amount: 3,
            },
            connector: "conditional_result",
          },
        ],
        textRef: [5, 6],
      },
      // [8,9] Lv2-3 フラッシュ『アタック時』ターンに1回、「暁 切歌」がいるとき相手のネクサス1つ破壊＋自身回復。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        condition: [
          {
            kind: "self_state",
            state: "on_field",
            reference: "self",
            battleState: "attacking",
          },
          {
            kind: "min_level",
            value: 2,
          },
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "暁 切歌",
              },
            ],
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
                  category: ["nexus"],
                },
                count: 1,
              },
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "recover",
              target: {
                kind: "self",
              },
            },
            connector: "simultaneous",
            executionMode: "optional",
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSG01-R01",
    orikaId: 367,
    orikaIndex: 384,
    name: "ポリフィリム錵恋夢",
    printedCategory: "magic",
    colors: ["red", "green"],
    cost: 7,
    reductionSymbols: ["red", "green", "ultimate_symbol"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュにあるこのカードは、一切の効果を受けない。",
      "",
      "フラッシュ",
      "相手のスピリット/アルティメットすべてを重疲労させる。または、自分のターンなら、相手のネクサス/創界神ネクサスすべてを破壊できる。",
      "",
      "スタック",
      "相手のスピリット/アルティメット4体を疲労させる。この効果は、お互いのアタックステップしか使用できない。",
    ],
    keywordTags: [],
    tribe: "装者",
    image: "images/BSSG01-R01.webp",
    rarity: "R",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] トラッシュにあるこのカードは、一切の効果を受けない。
      // while_in_trash 束縛の effect_immunity (defense_immune)。トラッシュ滞在中のみ登録される。
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
      // [2,3] フラッシュ: 二択。
      //   choices[0] 既定: 相手のスピリット/アルティメットすべてを重疲労。
      //   choices[1]: 自分のターンなら、相手のネクサス/創界神ネクサスすべてを破壊。
      // 択一は既存 choice プリミティブ (P3-24)、self-turn ゲートは turn_player 条件。
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
                count: "all",
              },
              degree: "heavy_exhaust",
            },
            choice: [
              {
                // 「自分のターンなら、相手のネクサス/創界神ネクサスすべてを破壊できる」。
                condition: [{ kind: "turn_player", player: "self" }],
                action: {
                  kind: "destroy",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["nexus"], targetsGrandwalker: true },
                    count: "all",
                  },
                },
              },
            ],
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] スタック: 相手4体を疲労。お互いのアタックステップしか使用できない。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 4,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSSG01-R02",
    orikaId: 368,
    orikaIndex: 385,
    name: "絶唱",
    printedCategory: "magic",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 8,
    reductionSymbols: ["red", "purple", "green", "white", "yellow", "blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "デッキからオープンされたこのカードは、手札1枚と入れ替えられる。",
      "",
      "系統：「装者」を持つ自分のスピリット/アルティメットがいるとき、手札にあるこのカードのコストを4にする。",
      "",
      "フラッシュ",
      "相手のスピリット/アルティメットすべてを疲労させ、このターンの間、相手のネクサス/創界神ネクサスすべての効果は発揮されない。この効果は、自分のターンしか発揮されない。その後、このカードを除外する。",
      "",
      "スタック",
      "このターンの間、相手の『このスピリット/アルティメットのアタック時』効果1つを発揮させない。この効果は、お互いのアタックステップしか使用できない。",
    ],
    keywordTags: [],
    tribe: "装者",
    image: "images/BSSG01-R02.webp",
    rarity: "R",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] デッキからオープンされたこのカードは、手札1枚と入れ替えられる。
      //     swap 型 disposition（07b §鍵/星霊デッキオープン置換 line 40）。系統限定なし=どの効果で
      //     オープンされても発火。可能形語尾 = 任意。
      {
        timing: { kind: "card_event", event: ["revealed"] },
        cardEventDisposition: { kind: "swap" },
        condition: [{ kind: "trigger_from_zone", zones: ["deck"] }],
        steps: [],
        executionMode: "optional",
        textRef: [0],
      },
      // [2] 系統:「装者」を持つ自分のスピリット/アルティメットがいるとき、手札のこのカードのコストを4にする。
      {
        applicability: { zone: ["hand"] },
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["spirit", "ultimate"],
            tribes: ["装者"],
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { override: 4 },
            },
          },
        ],
        textRef: [2],
      },
      // [4,5] フラッシュ: 全体疲労＋相手ネクサス/創界神ネクサス効果抑止＋このカード除外。
      // 「この効果は自分のターンしか発揮されない」は turn_player 条件で gate。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [{ kind: "turn_player", player: "self" }],
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
              },
            },
          },
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"], targetsGrandwalker: true },
                count: "all",
              },
              duration: { scope: "turn" },
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "remove_from_game",
              target: { kind: "self" },
            },
            connector: "sequential",
          },
        ],
        textRef: [4, 5],
      },
      // [7,8] スタック: 相手の『アタック時』効果1つを発揮させない。お互いのアタックステップしか使用できない。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "effect",
              targetController: "opponent",
              targetEffectFilter: {
                sourceKinds: ["spirit", "ultimate"],
                effectLabels: ["spirit_attack_time", "ultimate_attack_time"],
                timingKind: "card_event",
                eventAction: "attack",
              },
              suppressMatchedEffect: true,
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSSG01-X01",
    orikaId: 369,
    orikaIndex: 386,
    name: "暁 切歌「イガリマ-エクスドライブ-」",
    printedCategory: "spirit",
    colors: ["green", "white"],
    cost: 8,
    reductionSymbols: ["green", "green", "red", "red", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 15000,
      },
      {
        level: 3,
        requiredCores: 5,
        bp: 21000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ【煌臨：「暁 切歌＆コスト4以上」『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "待機状態を含まない自分の「暁 切歌」はフィールドに1体しか存在できない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの煌臨/アタック時』",
      "ターンに1回、相手のスピリット/アルティメット2体を重疲労できる。その後、疲労状態の相手のスピリット/アルティメット2体をデッキの下に戻せる。この効果は、相手の効果では防げない。",
      "",
      "Lv2-Lv3 フラッシュ『このスピリットのアタック時』",
      "自分の「月読 調」がいるとき、ターンに1回、このスピリットは回復できる。",
    ],
    keywordTags: ["advent"],
    tribe: "装者",
    image: "images/BSSG01-X01.webp",
    rarity: "X",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] 煌臨宣言は CardDefinition.adventData で表現する（11 L149 / 08a §1）。
    //   名前条件「暁 切歌」は AdventCondition.cardNames、コスト4以上は minCost:4 で表現（engine-drain）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "暁 切歌" }],
        targetCategory: ["spirit"],
        minCost: 4,
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
    },
    effects: [
      // [3] 待機状態を含まない自分の「暁 切歌」は1体しか存在できない。
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
        textRef: [3],
      },
      // [5,6] Lv1-3『煌臨/アタック時』ターンに1回、相手2体を重疲労＋疲労状態の相手2体をデッキの下へ。相手の効果では防げない。
      {
        timing: {
          kind: "card_event",
          event: ["advent", "attack"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
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
                count: 2,
              },
              degree: "heavy_exhaust",
              maxPreventable: 0,
            },
            executionMode: "optional",
          },
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
                count: 2,
              },
              position: "bottom",
              maxPreventable: 0,
            },
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [5, 6],
      },
      // [8,9] Lv2-3 フラッシュ『アタック時』「月読 調」がいるとき、ターンに1回、このスピリット回復。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        condition: [
          {
            kind: "self_state",
            state: "on_field",
            reference: "self",
            battleState: "attacking",
          },
          {
            kind: "min_level",
            value: 2,
          },
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "月読 調",
              },
            ],
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
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSG01-X02",
    orikaId: 370,
    orikaIndex: 387,
    name: "月読 調「シャルシャガナ-エクスドライブ-」",
    printedCategory: "spirit",
    colors: ["red", "white"],
    cost: 8,
    reductionSymbols: ["red", "red", "green", "green", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 15000,
      },
      {
        level: 3,
        requiredCores: 5,
        bp: 21000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "フラッシュ【煌臨：「月読 調＆コスト4以上」『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "待機状態を含まない自分の「月読 調」はフィールドに1体しか存在できない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの煌臨/ブロック時』",
      "ターンに1回、相手のスピリット/アルティメット2体を破壊でき、その効果を発揮させず、このスピリットは回復できる。この効果は相手の効果で防げない。",
      "",
      "Lv1-Lv2-Lv3",
      "自分の「暁 切歌」がいるとき、このスピリットは「ブロックされない」相手のスピリット/アルティメットをブロックできる。",
    ],
    keywordTags: ["advent"],
    tribe: "装者",
    image: "images/BSSG01-X02.webp",
    rarity: "X",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] 煌臨宣言は CardDefinition.adventData で表現する（11 L149 / 08a §1）。
    //   名前条件「月読 調」は AdventCondition.cardNames、コスト4以上は minCost:4 で表現（engine-drain）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "月読 調" }],
        targetCategory: ["spirit"],
        minCost: 4,
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
    },
    effects: [
      // [3] 待機状態を含まない自分の「月読 調」は1体しか存在できない。
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
        textRef: [3],
      },
      // [5,6] Lv1-3『煌臨/ブロック時』ターンに1回、相手2体を破壊しその効果を発揮させず、自身回復。相手の効果で防げない。
      {
        timing: {
          kind: "card_event",
          event: ["advent", "block"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        preventionLevel: "unpreventable",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 2,
              },
              suppressDestroyedEffects: "destroyed_only",
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "recover",
              target: {
                kind: "self",
              },
            },
            connector: "simultaneous",
            executionMode: "optional",
          },
        ],
        textRef: [5, 6],
      },
      // [8,9] Lv1-3: 「暁 切歌」がいるとき、「ブロックされない」相手をブロックできる。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "暁 切歌" }],
          },
        ],
        steps: [
          {
            action: {
              kind: "block_unblockable",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSG01-X03",
    orikaId: 371,
    orikaIndex: 388,
    name: "暁 切歌＆月読 調「アマルガム」",
    printedCategory: "ultimate",
    colors: ["red", "green"],
    cost: 13,
    reductionSymbols: ["red", "red", "red", "green", "green", "green"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 13000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 21000,
      },
      {
        level: 5,
        requiredCores: 5,
        bp: 26000,
      },
      {
        level: 6,
        requiredCores: 7,
        bp: 30000,
      },
    ],
    symbolColors: ["red", "green", "ultimate_symbol"],
    textLines: [
      "フラッシュ【煌臨：「暁 切歌」1体＆「月読 調」1体＆どちらもコスト4以上『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリット2体に手札から重ねる。",
      "",
      "《召喚条件：「暁 切歌」1体＆「月読 調」1体》",
      "",
      "待機状態を含まない自分の「暁 切歌」/「月読 調」は、フィールドに1体しか存在できない。",
      "",
      "Lv3-Lv4-Lv5-Lv6『このアルティメットのアタック時』",
      "ゲーム中に1回、このアルティメットの降臨元に「暁 切歌」と「月読 調」があるとき、相手のスピリット/アルティメット4体までと相手のネクサス/創界神ネクサス3つまでを破壊し、破壊したスピリット/アルティメット/ネクサス/創界神ネクサスのシンボル2つにつき、相手のライフのコア1個をボイドに置く（最大3個）。",
    ],
    keywordTags: ["advent"],
    tribe: "装者・黄金",
    image: "images/BSSG01-X03.webp",
    rarity: "X",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【煌臨：「暁 切歌」1体＆「月読 調」1体＆どちらもコスト4以上『自分の
    //   ターン』】= 多重煌臨 (declare_dual_host_advent、P3-133、裁定確定 2026-08-01)。
    //   通常の煌臨宣言と同様、declare 系は CardDefinition 直下の宣言的フィールド
    //   (dualHostAdventData) で表現し effects[].steps には現れない (adventData ヘッダと
    //   同型、cards-fidelity-audit.mjs の ADVENT_HEADER exemption を dualHostAdventData
    //   にも適用)。対象2体はそれぞれのスロット条件(名前＋コスト4以上)を1体ずつ満たす必要
    //   があり、実行 (mechanics/multi-host-advent.ts) は既存 executeAdvent (「上」側)
    //   + attachAsAdventSource (「下」側、コア統合合算) の SSOT 再利用。
    dualHostAdventData: {
      hostSlotConditions: [
        {
          cardNames: [{ contains: "暁 切歌" }],
          minCost: 4,
          targetCategory: ["spirit"],
        },
        {
          cardNames: [{ contains: "月読 調" }],
          minCost: 4,
          targetCategory: ["spirit"],
        },
      ],
      adventTiming: "own_turn",
      soulCoreDest: "trash",
    },
    effects: [
      // [5] 待機状態を含まない自分の「暁 切歌」/「月読 調」は1体しか存在できない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "field_name_uniqueness",
              names: ["暁 切歌", "月読 調"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5],
      },
      // [7,8] Lv3-6『アタック時』〔ゲーム中1回〕降臨元に「暁 切歌」と「月読 調」があるとき、
      //   相手のスピリット/アルティメット4体まで＋ネクサス/創界神ネクサス3つまでを破壊し、
      //   破壊したカードのシンボル2つにつき相手のライフのコア1個をボイドに置く（最大3個）。
      //   「降臨元にAとBがある」= self_advent_source_names(logic:"and")。多重煌臨
      //   (dualHostAdventData) 実装により本カードの underCards(role='advent_source') が
      //   populate されるようになったため到達可能 (P3-133 解消)。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [
          {
            kind: "self_advent_source_names",
            names: [{ contains: "暁 切歌" }, { contains: "月読 調" }],
            logic: "and",
          },
        ],
        usageLimit: { kind: "per_instance", duration: "game" },
        steps: [
          {
            id: "destroy-spirit-ultimate",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: { min: 0, max: 4 },
              },
            },
          },
          {
            id: "destroy-nexus",
            connector: "simultaneous",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"], targetsGrandwalker: true },
                count: { min: 0, max: 3 },
              },
            },
          },
          {
            connector: "sequential",
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "void", player: "opponent" },
              amount: {
                source: {
                  kind: "symbol_count_from_ref",
                  stepIds: ["destroy-spirit-ultimate", "destroy-nexus"],
                },
                divisor: 2,
                cap: 3,
              },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],

    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["spirit", "ultimate"],
        cardNames: [{ contains: "暁 切歌" }],
        minCount: 1,
      },
      {
        kind: "field_has",
        player: "self",
        category: ["spirit", "ultimate"],
        cardNames: [{ contains: "月読 調" }],
        minCount: 1,
      },
    ],
  },
  {
    cardNo: "BSSG01-X04",
    orikaId: 372,
    orikaIndex: 389,
    name: "月読 調「シャルシャガナ-アマルガム-」",
    printedCategory: "ultimate",
    colors: ["red", "yellow"],
    cost: 8,
    reductionSymbols: ["red", "red", "green", "green", "yellow"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 12000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 18000,
      },
      {
        level: 5,
        requiredCores: 5,
        bp: 23000,
      },
    ],
    symbolColors: ["red", "ultimate_symbol"],
    textLines: [
      "フラッシュ【煌臨：「月読 調」＆コスト4以上『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "《召喚条件：「暁 切歌」1体以上》",
      "",
      "Lv3-Lv4-Lv5『このアルティメットのアタック時』",
      "本来のBPが15000以下の相手のスピリット/アルティメットすべてを破壊する。この効果で破壊した相手のスピリット/アルティメット3体につき相手のライフのコア1個をリザーブに置く。バトル終了時、相手のスピリット/アルティメットがいるとき、このアルティメットは回復する。",
    ],
    keywordTags: ["advent"],
    tribe: "装者・黄金",
    image: "images/BSSG01-X04.webp",
    rarity: "X",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] 煌臨宣言は CardDefinition.adventData で表現する（11 L149 / 08a §1）。
    //   名前条件「月読 調」は AdventCondition.cardNames、コスト4以上は minCost:4 で表現（engine-drain）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "月読 調" }],
        targetCategory: ["spirit"],
        minCost: 4,
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
    },
    // [3] 《召喚条件：「暁 切歌」1体以上》。宣言前チェックを CardDefinition.summonCondition
    //   （ConditionClause 配列・evaluateCondition で判定。10_rules/04 L190-194）で表現する。
    //   「暁 切歌」は 「X」=部分一致（[[project_card_name_reference_matching]]）→ contains。
    //   「1体」= スピリット/アルティメット 1 体以上。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["spirit", "ultimate"],
        cardNames: [{ contains: "暁 切歌" }],
        minCount: 1,
      },
    ],
    effects: [
      // [5,6] Lv3-5『アタック時』本来のBP15000以下の相手すべて破壊。破壊数3体につき相手ライフの
      // コア1個をリザーブへ（floor）。バトル終了時、相手がいれば自身回復。
      // 「本来のBP」= bpBasis:"printed"（BSGE01-TX03/TX04 backFace 型と同型、card-filter.ts L829-838
      // SSOT）。破壊数比例のコア移動は destroy step の実際の破壊数を
      // step_numeric_amount(stepId) + divisor:3 の floor 除算で参照する
      // （DynamicCount.divisor は既存、effect-interpreter.ts recordStepResult に
      // destroy 用 numericAmount(=affected.length、耐性込み実破壊数) を新設）。
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            id: "x04destroy",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxBp: 15000,
                  bpBasis: "printed",
                },
                count: "all",
              },
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: {
                source: { kind: "step_numeric_amount", stepId: "x04destroy" },
                divisor: 3,
              },
            },
            connector: "sequential",
          },
          {
            action: { kind: "recover", target: { kind: "self" } },
            deferTo: "battle_end",
            condition: [
              {
                kind: "field_has",
                player: "opponent",
                category: ["spirit", "ultimate"],
              },
            ],
            connector: "sequential",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSSG01-X05",
    orikaId: 373,
    orikaIndex: 390,
    name: "暁 切歌「イガリマーアマルガム-」",
    printedCategory: "ultimate",
    colors: ["green", "yellow"],
    cost: 8,
    reductionSymbols: ["green", "green", "red", "red", "yellow"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 12000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 18000,
      },
      {
        level: 5,
        requiredCores: 5,
        bp: 23000,
      },
    ],
    symbolColors: ["green", "ultimate_symbol"],
    textLines: [
      "フラッシュ【煌臨：「暁 切歌」＆コスト4以上『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "《召喚条件：「月読 調」1体以上》",
      "",
      "Lv3-Lv4-Lv5『このアルティメットの煌臨/ブロック時』",
      "ターンに1回、相手のスピリット/アルティメットすべてをBP-10000できる。そうしたとき、BP0になった相手のスピリット/アルティメットすべてをデッキの下に戻す。自分の「月読 調」がいるとき、この効果を「BP-20000」に変更する。その後、2コスト支払うことで、自分のスピリット/アルティメット2体を回復させる。",
    ],
    keywordTags: ["advent"],
    tribe: "装者・黄金",
    image: "images/BSSG01-X05.webp",
    rarity: "X",
    pack: "BSSG01 戦姫絶唱シンフォギア-切歌＆調-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] 煌臨宣言は CardDefinition.adventData で表現する（11 L149 / 08a §1）。
    //   名前条件「暁 切歌」は AdventCondition.cardNames、コスト4以上は minCost:4 で表現（engine-drain）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "暁 切歌" }],
        targetCategory: ["spirit"],
        minCost: 4,
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
    },
    // [3] 《召喚条件：「月読 調」1体以上》。宣言前チェックを CardDefinition.summonCondition
    //   （ConditionClause 配列・evaluateCondition で判定。10_rules/04 L190-194）で表現する。
    //   「月読 調」は 「X」=部分一致（[[project_card_name_reference_matching]]）→ contains。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["spirit", "ultimate"],
        cardNames: [{ contains: "月読 調" }],
        minCount: 1,
      },
    ],
    effects: [
      // [5,6] Lv3-5『煌臨/ブロック時』ターンに1回、相手すべてBP-10000→BP0をデッキの下。
      // 「自分の『月読 調』がいるとき、この効果を『BP-20000』に変更する」は、field_has /
      // field_lacks の cardNames で排他ゲートした2効果で決定的に表現する（BSDB01-C07 と同型）。
      // 〔ターンに1回〕は per_instance + limitGroupId で両者に1回制限を共有させる。「月読 調」は 「X」=部分一致
      // （[[project_card_name_reference_matching]]）。BP0 デッキ下送りは P3-104 の遷移参照
      // (bp_became_zero) で表現。
      // 「その後、2コスト支払うことで、自分のスピリット/アルティメット2体を回復」は
      // ことで構文（10_rules/03c L76-L80）の任意サブ効果: choice で「支払わない /
      // 2コスト支払う」を選び、支払った分岐だけ conditional_cost で回復へ進める。
      // 月読 調 在場: BP-20000。
      {
        timing: {
          kind: "card_event",
          event: ["advent", "block"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        limitGroupId: "BSSG01-X05-advent-bp-down",
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "月読 調",
              },
            ],
          },
        ],
        steps: [
          {
            executionMode: "optional",
            id: "bp0",
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
              amount: -20000,
              duration: {
                scope: "turn",
              },
            },
          },
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "ref",
                stepId: "bp0",
                result: "bp_became_zero",
              },
              position: "bottom",
            },
            connector: "conditional_result",
          },
          {
            targetSelectionTiming: "on_step",
            id: "recover_choice",
            action: {
              kind: "noop",
            },
            connector: "sequential",
            choice: [
              {
                action: {
                  kind: "pay_cost",
                  amount: 2,
                },
              },
            ],
          },
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "recover",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit", "ultimate"],
                  exhaustState: "exhausted",
                },
                count: 2,
              },
            },
            stepCondition: {
              kind: "ref_choice",
              stepId: "recover_choice",
              choiceIndex: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
      // 月読 調 不在: BP-10000。
      {
        timing: {
          kind: "card_event",
          event: ["advent", "block"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        limitGroupId: "BSSG01-X05-advent-bp-down",
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            cardNames: [
              {
                contains: "月読 調",
              },
            ],
          },
        ],
        steps: [
          {
            executionMode: "optional",
            id: "bp0",
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
              amount: -10000,
              duration: {
                scope: "turn",
              },
            },
          },
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "ref",
                stepId: "bp0",
                result: "bp_became_zero",
              },
              position: "bottom",
            },
            connector: "conditional_result",
          },
          {
            targetSelectionTiming: "on_step",
            id: "recover_choice",
            action: {
              kind: "noop",
            },
            connector: "sequential",
            choice: [
              {
                action: {
                  kind: "pay_cost",
                  amount: 2,
                },
              },
            ],
          },
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "recover",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit", "ultimate"],
                  exhaustState: "exhausted",
                },
                count: 2,
              },
            },
            stepCondition: {
              kind: "ref_choice",
              stepId: "recover_choice",
              choiceIndex: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
];
