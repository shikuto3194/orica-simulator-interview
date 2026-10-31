import type { CardDefinition } from "@orica/rules-core";

export const BSRK01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSRK01-C01",
    orikaId: 427,
    orikaIndex: 444,
    name: "飛天御剣流『龍槌閃』",
    printedCategory: "magic",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white", "red"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "メイン",
      "自分のデッキを上から3枚内容を見る。その中の1枚を手札1枚と入れ替えられる。自分の手札が4枚以下のとき、かわりに手札に加えられる。残ったカードは好きなようにデッキの上と下に戻す。",
      "",
      "フラッシュ",
      "手札/手元/トラッシュ/魂状態/煌臨元のコスト3以下の契約スピリットカード1枚をコストを支払わずに召喚できる。",
    ],
    keywordTags: ["soul_state"],
    image: "images/BSRK01-C01.webp",
    rarity: "C",
    pack: "BSRK01 るろうに剣心",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // メイン: デッキ上3枚を見て1枚を手札と入れ替え（手札4枚以下なら手札に加える）、残りはデッキ上下に戻す。
      // 手札4枚以下/5枚以上は効果解決時点の手札枚数で排他分岐させる。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            condition: [{ kind: "hand_count", player: "self", min: 5 }],
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              revealTo: "self",
              picks: [{ count: 1, destination: "hand_swap" }],
              remainder: "top_bottom_split",
            },
          },
          {
            condition: [{ kind: "hand_count", player: "self", max: 4 }],
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              revealTo: "self",
              picks: [{ count: 1 }],
              remainder: "top_bottom_split",
            },
          },
        ],
        textRef: [0, 1],
      },
      // フラッシュ: コスト3以下の契約スピリットカード1枚をコストを支払わずに召喚。
      {
        timing: { kind: "activated", mode: "flash" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "set_aside", "trash"],
                filter: {
                  category: ["spirit"],
                  maxCost: 3,
                  requiredKeywordTags: ["contract"],
                },
                count: 1,
                includeAdventSource: true,
                includeSoulState: true,
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSRK01-C02",
    orikaId: 428,
    orikaIndex: 445,
    name: "神谷 薫",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white", "red"],
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
    symbolColors: ["white"],
    textLines: [
      "Lv1-Lv2『このネクサスの配置時』",
      "〔ターンに1回:同名〕自分のデッキを上から2枚内容を見れる。その中の1枚を手札に加えられる。残ったカードはデッキの下に戻す。",
      "",
      "Lv1-Lv2『相手のターン』",
      "〔重複不可〕相手は、1コスト支払わなければ、相手の効果でデッキ/トラッシュ/オープンしたカードから手札を増やせない。",
      "",
      "Lv2",
      "自分の手札が5枚以下の間、自分の「剣心」がいれば、このネクサスと自分の手札は相手の効果を受けない。",
    ],
    keywordTags: [],
    tribe: "明治",
    image: "images/BSRK01-C02.webp",
    rarity: "C",
    pack: "BSRK01 るろうに剣心",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『配置時』〔ターンに1回:同名〕デッキ上2枚を見て1枚を手札に加える。残りはデッキの下に戻す。
      {
        timing: {
          kind: "card_event",
          event: "place",
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
              revealCount: 2,
              picks: [
                {
                  count: 1,
                },
              ],
              remainder: "bottom",
              revealTo: "self",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2『相手のターン』相手は1コスト払わなければ効果でデッキ/トラッシュ/オープンから手札を増やせない。
      // require_hand_gain_cost (engine-opponent-hand-gain-paid-tax-gate): 相手プレイヤーに
      // hand_gain_cost_gate CE を登録する。hand-gain-cost.ts を正源として、公開回収・
      // 効果ドロー・search_zone・move_card の各手札取得経路で対価を要求する。
      // プレイヤー対象なので効果元カードの耐性では免除しない。timingScope は相手ターン。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "opponent", period: "turn" },
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "require_hand_gain_cost",
              player: "opponent",
              costAmount: 1,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2 手札5枚以下＆「剣心」がいれば、このネクサスと自分の手札は相手の効果を受けない。
      // effect_immunity を self (このネクサス) と filter(zone:hand) の2本 simultaneous 登録
      // (ENGINE-effect-immunity-hand-zone-scope、BSTH02.7-C03 の zone 対応 primitive を流用)。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "hand_count", player: "self", max: 5 },
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "剣心" }],
          },
        ],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
          {
            connector: "simultaneous",
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
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSRK01-C03",
    orikaId: 429,
    orikaIndex: 446,
    name: "飛天御剣流『双龍閃』",
    printedCategory: "magic",
    colors: ["red", "white"],
    cost: 5,
    reductionSymbols: ["red", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、メイン効果を使用するとき、赤の軽減シンボル1つを追加する。",
      "",
      "メイン",
      "自分はデッキの上から3枚ドローする。ドロー後、自分は手札が5枚以下になるように内容を見せずにデッキの下に戻す。",
      "",
      "スタック",
      "〔アタックステップ〕魂状態を含む自分の「剣心」がいるとき、BP15000以下の相手のスピリット1体を破壊する。この効果発揮後、相手のスピリット/アルティメット1体を手札に戻す。",
    ],
    keywordTags: ["soul_state"],
    image: "images/BSRK01-C03.webp",
    rarity: "C",
    pack: "BSRK01 るろうに剣心",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、メイン効果を使用するとき、赤の軽減シンボル1つを追加する。
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
              whenUsingEffectMode: "main",
              addsReductionSymbol: true,
            },
          },
        ],
        textRef: [0],
      },
      // メイン: デッキ3枚ドロー後、手札5枚以下になるよう内容を見せずにデッキの下に戻す。
      // 「5枚以下になるように」= discard targetHandSize:5（effectiveCount = max(0, handCount-5)）。
      // 「デッキの下に戻す」= destination:"deck_bottom"（破棄ではなくデッキ末尾へ）。
      // 「内容を見せずに」= 自分の手札の自己選択は元々秘匿（pendingZoneSelection の所有者選択）。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "draw", count: 3 } },
          {
            action: {
              kind: "discard",
              player: "self",
              count: -1,
              targetHandSize: 5,
              destination: "deck_bottom",
            },
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      // スタック〔アタックステップ〕魂状態を含む「剣心」がいるとき、BP15000以下の相手スピリット1体を破壊→相手スピリット/アルティメット1体を手札に戻す。
      // 〔アタックステップ〕限定 → timingScope。「魂状態を含む」= 通常フィールド ∪ 魂状態（裁定
      // 2026-06-13・10_rules/08a）。無印 field_has は魂状態（soulStateInstanceIds）を数えないため
      // includeSoulState:true で opt-in する。
      {
        timing: {
          kind: "activated",
          mode: "stack",
        },
        timingScope: {
          player: "both",
          period: "attack",
        },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "剣心",
              },
            ],
            includeSoulState: true,
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
                  category: ["spirit"],
                  maxBp: 15000,
                },
                count: 1,
              },
            },
          },
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    {
                      category: ["spirit"],
                    },
                    {
                      category: ["ultimate"],
                    },
                  ],
                },
                count: 1,
              },
            },
            connector: "after_triggers",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSRK01-C04",
    orikaId: 430,
    orikaIndex: 447,
    name: "[黒笠編]緋村 剣心",
    printedCategory: "spirit",
    colors: ["red", "white"],
    cost: 4,
    reductionSymbols: ["red", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 7000,
      },
    ],
    printedOverCount: { minCount: 6, bpBonus: 7000 },
    overCount: { minCount: 6, bpBonus: 7000 },
    symbolColors: ["red"],
    textLines: [
      "フラッシュ【契約煌臨：「緋村 剣心」『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨時』",
      "ボイドからコア2個を自分のリザーブに置ける。",
      "",
      "Lv1-Lv2【回帰の抜刀斎】",
      "自分の「薫」がいない間、自分の【不殺のるろうに】は発揮されない。",
      "",
      "【OC条件：カウント6以上】",
      "【OC中】自分の【回帰の抜刀斎】は発揮されない。",
    ],
    keywordTags: [],
    tribe: "明治・剣士",
    image: "images/BSRK01-C04.webp",
    rarity: "C",
    pack: "BSRK01 るろうに剣心",
    // フラッシュ【契約煌臨：「緋村 剣心」『自分のターン』】
    // 契約煌臨宣言は declare_advent エンジン経路で処理される (advent-system / legal-actions)。
    // 『自分のターン』は自分ターンのメイン/フラッシュ窓で使用可 → own_turn で表現。
    // 煌臨先「緋村 剣心」(カード名部分一致) は AdventCondition.cardNames で表現
    //   ([[project_card_name_reference_matching]]、engine-drain 型 SSOT 適用)。
    //   コスト条件の印字は無いため minCost は設定せず (任意コストの契約スピリット先)。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "緋村 剣心" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
    },
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このスピリットの煌臨時』ボイドからコア2個を自分のリザーブに置ける。
      {
        timing: { kind: "card_event", event: "advent" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2【回帰の抜刀斎】「薫」がいない間【不殺のるろうに】は発揮されない／【OC中】【回帰の抜刀斎】は発揮されない。
      {
        heading: "回帰の抜刀斎",
        applicability: { level: { min: 1, max: 2 } },
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            cardNames: [{ contains: "薫" }],
          },
        ],
        steps: [
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "self",
                // 魂状態/煌臨元は runtime zone が field のままなので、
                // zone:"field" + CardFilter の opt-in で論理スコープを広げる。
                zone: "field",
                filter: {
                  soulState: "include",
                  adventSourceScope: "include",
                },
                count: "all",
              },
              effectFilter: { heading: "不殺のるろうに" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
      {
        applicability: { level: { min: 1, max: 2 } },
        timing: { kind: "continuous" },
        condition: [{ kind: "count_value", player: "self", min: 6 }],
        steps: [
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: "field",
                filter: {},
                count: "all",
              },
              effectFilter: { heading: "回帰の抜刀斎" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSRK01-C05",
    orikaId: 431,
    orikaIndex: 448,
    name: "飛天御剣流『龍咬閃』",
    printedCategory: "magic",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "フラッシュ",
      "このバトル終了時、アタックステップを終了する。",
      "",
      "スタック",
      "〔相手のアタック宣言〕相手のスピリット/アルティメット1体を指定し、可能なら指定した対象がアタックする。（スタックタイミング元のアタック宣言はなかったものになる。）このとき、自分の「剣心」1体に指定してアタックさせ、ただちにブロックする。",
    ],
    keywordTags: [],
    image: "images/BSRK01-C05.webp",
    rarity: "C",
    pack: "BSRK01 るろうに剣心",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // フラッシュ: このバトル終了時、アタックステップを終了する。
      // 効果全体を当該バトル解決完了後へ遅延 (timing.deferredTo:battle_end)。
      // 10_rules/05 L87「バトル終了時 はバトル1件ごとの終了、アタック終了時 は
      // アタックステップ全体の終了」。フラッシュは相手アタック中に使用するため activeAttack 在。
      {
        timing: { kind: "activated", mode: "flash", deferredTo: "battle_end" },
        steps: [{ action: { kind: "end_attack_step" } }],
        textRef: [0, 1],
      },
      // スタック〔相手のアタック宣言〕アタック対象の指定置換＋自分の「剣心」でブロック。
      // ENGINE-attack-declaration-replacement-primitive: replace_attack_declaration が
      // state.preDeclarationStackWindow(kind:"attack").sourceInstanceId を差し替え、
      // 「可能なら」= 合法な差し替え候補が無ければ no-op (元の宣言のまま進行、10_rules
      // 「可能なら」既存裁定と同型: ForceFirstAttackerAction コメント参照)。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "opponent", period: "attack" },
        steps: [
          {
            action: {
              kind: "replace_attack_declaration",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                  exhaustState: "recovered",
                },
                count: 1,
              },
              forcedBlocker: {
                kind: "filter",
                player: "self",
                filter: { cardName: { contains: "剣心" } },
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
    cardNo: "BSRK01-C06",
    orikaId: 432,
    orikaIndex: 449,
    name: "飛天御剣流『飛龍閃』",
    printedCategory: "magic",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "スタック",
      "〔アタックステップ〕相手のスピリット/アルティメット1体を手札に戻す。",
      "",
      "スタック",
      "〔自分のメインステップ/お互いのアタックステップ〕相手のバースト1つを破棄する。",
    ],
    keywordTags: [],
    image: "images/BSRK01-C06.webp",
    rarity: "C",
    pack: "BSRK01 るろうに剣心",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // スタック〔アタックステップ〕相手のスピリット/アルティメット1体を手札に戻す。
      // 〔アタックステップ〕= お互いのアタックステップ限定 → timingScope。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // スタック〔自分のメインステップ/お互いのアタックステップ〕相手のバースト1つを破棄する。
      // TimingScope は単一 player/period しか持てないため、テキストの OR 集合
      // 「自分のメインステップ｜お互いのアタックステップ」を 2 件の effect として分割登録する。
      // 単に timingScope を省略すると全ステップ素通しになるため、各ステップを明示する。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "self", period: "main" },
        steps: [
          {
            action: {
              kind: "discard_set_burst",
              player: "opponent",
              count: 1,
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "discard_set_burst",
              player: "opponent",
              count: 1,
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSRK01-C07",
    orikaId: 433,
    orikaIndex: 450,
    name: "明神 弥彦",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "white"],
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
      "Lv1-Lv2『自分のメインステップ終了時』",
      "〔重複不可〕魂状態を含む自分の「剣心」がいるとき、トラッシュにある《ソウルコア》以外のコア3個までを系統：「明治」を持つ自分のスピリット/ネクサスに置ける。1個以上置いたとき、自分はデッキの上から1枚ドローでき、ドロー後、手札が5枚以下になるよう内容を見せずにデッキの下に戻す。",
      "",
      "Lv2『自分のアタックステップ』",
      "自分の「剣心」がいる間、相手は効果でアタックステップを終了できない。",
    ],
    keywordTags: ["soul_state"],
    tribe: "明治・剣士",
    image: "images/BSRK01-C07.webp",
    rarity: "C",
    pack: "BSRK01 るろうに剣心",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] Lv1-Lv2『自分のメインステップ終了時』〔重複不可〕魂状態を含む自分の「剣心」がいるとき、
      // トラッシュの《ソウルコア》以外のコア3個までを系統「明治」を持つ自分のスピリット/ネクサスに
      // 配分（player_choice、BSDB01-C08 effects[2] と同型）。1個以上置いたとき、デッキ上1枚
      // ドロー（任意）→ドロー後、手札5枚以下になるよう内容を見せずデッキ下へ（BSRK01-C03
      // effects[1] の discard destination:"deck_bottom" と同型）。「1個以上置いたとき」は
      // ref_count(stepId, result:"numeric_amount", min:1) で core_distribute の実配置数を参照する。
      {
        timing: { kind: "phase", step: "main", whose: "self", subPhase: "end" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "剣心" }],
            includeSoulState: true,
          },
        ],
        executionMode: "optional",
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            id: "place-trash-cores",
            action: {
              kind: "core_distribute",
              from: { kind: "trash", player: "self" },
              to: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "nexus"], tribes: ["明治"] },
                count: "all",
              },
              amount: 3,
              effectKind: "normal_only",
              mode: "player_choice",
            },
          },
          {
            id: "drew",
            connector: "sequential",
            executionMode: "optional",
            stepCondition: {
              kind: "ref_count",
              stepId: "place-trash-cores",
              result: "numeric_amount",
              min: 1,
            },
            action: { kind: "draw", count: 1 },
          },
          {
            connector: "conditional_result",
            action: {
              kind: "discard",
              player: "self",
              count: -1,
              targetHandSize: 5,
              destination: "deck_bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        // Lv2『自分のアタックステップ』自分の「剣心」がいる間、相手は効果でアタックステップを終了できない。
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        applicability: { level: { min: 2, max: 2 } },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "剣心" }],
          },
        ],
        steps: [
          {
            action: {
              kind: "restrict_end_attack_step",
              player: "opponent",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSRK01-CX01",
    orikaId: 434,
    orikaIndex: 451,
    name: "緋村 剣心",
    printedCategory: "spirit",
    colors: ["red", "white"],
    cost: 2,
    reductionSymbols: ["red", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 6000,
      },
    ],
    printedOverCount: { minCount: 3, bpBonus: 5000 },
    overCount: { minCount: 3, bpBonus: 5000 },
    symbolColors: ["red"],
    textLines: [
      "魂状態のこのカードには【契約煌臨】できる。このとき、煌臨するカードに自分のフィールド/リザーブのコアを好きなだけ置く。",
      "",
      "【魂状態】/【契約煌臨元】/【スピリット】Lv1-Lv2【不殺のるろうに】",
      "自分によって相手のスピリット/アルティメット/ネクサスを破壊したとき、その対象をデッキの下に戻す。",
      "",
      "【魂状態】/【契約煌臨元】/【スピリット】Lv1-Lv2",
      "このスピリットのシンボルは白としても扱う。〔重複不可〕自分が「飛天御剣流」を含むマジックを使用するとき、その軽減シンボルすべてを満たし、その効果発揮後、このスピリットがいれば、自分のカウント2する。",
    ],
    keywordTags: ["soul_state", "contract"],
    tribe: "明治・剣士",
    image: "images/BSRK01-CX01.webp",
    rarity: "CX",
    pack: "BSRK01 るろうに剣心",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 魂状態のこのカードには【契約煌臨】できる。煌臨するカードにフィールド/リザーブのコアを好きなだけ置く。
      //   被煌臨の宣言（魂状態の契約「緋村 剣心」を煌臨先に含める）は declare_advent /
      //   getContractAdventTargets 配線済み。「煌臨するカードに任意コア配置」は契約煌臨で
      //   魂状態へ煌臨したときの intrinsic 処理として engine 側で表現する。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [0],
      },
      // 【不殺のるろうに】自分によって相手のスピリット/アルティメット/ネクサスを破壊したとき、その対象をデッキの下に戻す。
      {
        heading: "不殺のるろうに",
        applicability: {
          adventSourceHostVariants: ["contract", "f_contract"],
          zone: "field",
          level: { min: 1, max: 2 },
          soulState: false,
        },
        timing: {
          kind: "game_event",
          event: "destroy",
          player: "opponent",
          cause: ["opponent_effect", "battle", "opponent_bp_compare"],
          sourceWhose: "either",
          triggerFilter: {
            category: ["spirit", "ultimate", "nexus"],
          },
        },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "trigger_related_instances",
                includePendingLeave: true,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        heading: "不殺のるろうに",
        applicability: {
          adventSourceHostVariants: ["contract", "f_contract"],
          zone: ["soul_state", "advent_source"],
        },
        timing: {
          kind: "game_event",
          event: "destroy",
          player: "opponent",
          cause: ["opponent_effect", "battle", "opponent_bp_compare"],
          sourceWhose: "either",
          triggerFilter: {
            category: ["spirit", "ultimate", "nexus"],
          },
        },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "trigger_related_instances",
                includePendingLeave: true,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv1-Lv2 このスピリットのシンボルは白としても扱う。
      {
        applicability: {
          adventSourceHostVariants: ["contract", "f_contract"],
          zone: "field",
          level: {
            min: 1,
            max: 2,
          },
          soulState: false,
        },
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "white",
            },
          },
        ],
        textRef: [5, 6],
      },
      // 〔重複不可〕自分が「飛天御剣流」を含むマジックを使用するとき、その軽減シンボルすべてを満たし、その効果発揮後、このスピリットがいれば、自分のカウント2する。
      {
        applicability: {
          adventSourceHostVariants: ["contract", "f_contract"],
          zone: "field",
          level: { min: 1, max: 2 },
          soulState: false,
        },
        timing: { kind: "continuous" },
        usageLimit: { kind: "no_duplicate" },
        limitGroupId: "BSRK01-CX01-hiten-magic-reduction",
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["reduction_symbol"],
              whenPayingForFilter: {
                category: ["magic"],
                cardName: { contains: "飛天御剣流" },
              },
              waivesReductionRequirement: "all",
            },
          },
        ],
        textRef: [5, 6],
      },
      {
        applicability: {
          adventSourceHostVariants: ["contract", "f_contract"],
          zone: ["soul_state", "advent_source"],
        },
        timing: { kind: "continuous" },
        usageLimit: { kind: "no_duplicate" },
        limitGroupId: "BSRK01-CX01-hiten-magic-reduction",
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["reduction_symbol"],
              whenPayingForFilter: {
                category: ["magic"],
                cardName: { contains: "飛天御剣流" },
              },
              waivesReductionRequirement: "all",
            },
          },
        ],
        textRef: [5, 6],
      },
      {
        applicability: {
          adventSourceHostVariants: ["contract", "f_contract"],
          zone: "field",
          level: { min: 1, max: 2 },
          soulState: false,
        },
        timing: {
          kind: "game_event",
          event: "effect_completed",
          player: "self",
          latchSourceAtEffectActivationStart: true,
          triggerFilter: {
            category: ["magic"],
            cardName: { contains: "飛天御剣流" },
            reductionSymbolsSatisfied: "all",
          },
        },
        usageLimit: { kind: "no_duplicate" },
        limitGroupId: "BSRK01-CX01-hiten-magic-count",
        steps: [
          {
            // 軽減の適用資格と、効果発揮後に「このスピリットがいれば」は別条件。
            condition: [
              {
                kind: "self_state",
                state: "on_field",
                reference: "self",
                filter: { category: ["spirit"] },
              },
            ],
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
            },
          },
        ],
        textRef: [5, 6],
      },
      {
        applicability: {
          adventSourceHostVariants: ["contract", "f_contract"],
          zone: ["soul_state", "advent_source"],
        },
        timing: {
          kind: "game_event",
          event: "effect_completed",
          player: "self",
          latchSourceAtEffectActivationStart: true,
          triggerFilter: {
            category: ["magic"],
            cardName: { contains: "飛天御剣流" },
            reductionSymbolsSatisfied: "all",
          },
        },
        usageLimit: { kind: "no_duplicate" },
        limitGroupId: "BSRK01-CX01-hiten-magic-count",
        steps: [
          {
            // 契約煌臨元では上のスピリットを参照し、魂状態のカード自身は数えない。
            condition: [
              {
                kind: "self_state",
                state: "on_field",
                reference: "self",
                filter: { category: ["spirit"] },
              },
            ],
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
            },
          },
        ],
        textRef: [5, 6],
      },
      // 魂状態/契約煌臨元でも白として扱う。既存効果の index を維持して追加する。
      {
        applicability: {
          adventSourceHostVariants: ["contract", "f_contract"],
          zone: ["soul_state", "advent_source"],
        },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "white",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSRK01-M01",
    orikaId: 435,
    orikaIndex: 452,
    name: "[最後の修行]緋村 剣心",
    printedCategory: "spirit",
    colors: ["red", "white"],
    cost: 6,
    reductionSymbols: ["red", "red", "white"],
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
    ],
    printedOverCount: { minCount: 6, bpBonus: 5000 },
    overCount: { minCount: 6, bpBonus: 5000 },
    symbolColors: ["red"],
    textLines: [
      "フラッシュ【契約煌臨：「緋村 剣心」＆C4以上『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "〔ターンに1回：同名〕このカードは、相手のアタックステップで自分のカウント6以上なら、《ソウルコア》をトラッシュに置いたものとして【契約煌臨】できる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/ブロック時』",
      "手札/トラッシュの「飛天御剣流」を含むマジックカード1枚をオープンでき、そのフラッシュ/スタック効果1つをこのスピリットの『このスピリットの煌臨/ブロック時』効果として発揮できる。その後、オープンしたカードは破棄する。",
    ],
    keywordTags: [],
    tribe: "明治・剣士",
    image: "images/BSRK01-M01.webp",
    rarity: "M",
    pack: "BSRK01 るろうに剣心",
    // フラッシュ【契約煌臨：「緋村 剣心」＆C4以上『お互いのアタックステップ』】
    // 契約煌臨宣言は declare_advent エンジン経路で処理される。
    // 『お互いのアタックステップ』→ both_attack_step (08a:17 タイミング表)。
    // 煌臨先「緋村 剣心」(カード名部分一致) は AdventCondition.cardNames で表現
    //   ([[project_card_name_reference_matching]]、engine-drain 型 SSOT 適用)。
    // 「C4以上」は煌臨先コストではなく自分のカウント閾値のため declareCondition で表現。
    // [3] 〔ターンに1回:同名〕相手のアタックステップで自分のカウント6以上なら、《ソウルコア》を
    //   トラッシュに置いたものとして【契約煌臨】できる（代替コスト煌臨）。
    //   adventData.alternateCostAdvent で表現（[0,1]の通常経路と対象条件/ソウルコア行き先を共有し、
    //   タイミング/宣言条件/ソウルコア消費のみ差し替える、BSSL01-X01[3] と同型）。effects[] には
    //   現れない（adventData ヘッダと同型、cards:fidelity ADVENT_HEADER 特例と同じ扱い）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "緋村 剣心" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 4 }],
      alternateCostAdvent: {
        condition: [{ kind: "count_value", player: "self", min: 6 }],
        timing: "opponent_attack_step",
      },
    },
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このスピリットの煌臨/ブロック時』手札/トラッシュの「飛天御剣流」マジック1枚をオープンし、そのフラッシュ/スタック効果1つを発揮、その後破棄。
      // borrow_magic_effect (effect-borrowing.ts、BSAZ03-M01 が初出) を再利用。「オープンでき」＝
      // 可能形語尾＝任意 (10_rules/03c) のため executionMode:"optional"。thenMove.fromZone を
      // ["hand","trash"] にして「その後、オープンしたカードは破棄する」を発揮元ゾーン非依存で表現。
      {
        timing: { kind: "card_event", event: ["advent", "block"] },
        executionMode: "optional",
        applicability: { level: { min: 1, max: 2 } },
        steps: [
          {
            action: {
              kind: "borrow_magic_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: ["hand", "trash"],
                filter: {
                  category: ["magic"],
                  cardName: { contains: "飛天御剣流" },
                  hasActivatedEffectMode: ["flash", "stack"],
                },
                count: 1,
              },
              borrowModes: ["flash", "stack"],
              thenMove: { zone: "trash", fromZone: ["hand", "trash"] },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSRK01-R01",
    orikaId: 436,
    orikaIndex: 453,
    name: "飛天御剣流『九頭龍閃』",
    printedCategory: "magic",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "red", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "フラッシュ",
      "このターンの間、自分の「剣心」すべては、BP+20000され、疲労状態でブロックできる。",
      "",
      "スタック",
      "〔アタックステップ〕魂状態を含む自分の「剣心」がいるとき、BP20000以下の相手のスピリット2体を破壊する。",
    ],
    keywordTags: ["soul_state"],
    image: "images/BSRK01-R01.webp",
    rarity: "R",
    pack: "BSRK01 るろうに剣心",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // フラッシュ: このターンの間、自分の「剣心」すべては BP+20000 され、疲労状態でブロックできる。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "self",
                filter: { cardName: { contains: "剣心" } },
                count: "all",
              },
              amount: 20000,
              duration: { scope: "turn" },
            },
          },
          {
            action: {
              kind: "allow_block_while_exhausted",
              target: {
                kind: "filter",
                player: "self",
                filter: { cardName: { contains: "剣心" } },
                count: "all",
              },
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // スタック〔アタックステップ〕魂状態を含む自分の「剣心」がいるとき、BP20000以下の相手のスピリット2体を破壊する。
      // 〔アタックステップ〕限定 → timingScope。「魂状態を含む」= 通常フィールド ∪ 魂状態（裁定
      // 2026-06-13・10_rules/08a）。無印 field_has は魂状態を数えないため includeSoulState:true で opt-in。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "剣心" }],
            includeSoulState: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], maxBp: 20000 },
                count: 2,
              },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSRK01-R02",
    orikaId: 437,
    orikaIndex: 454,
    name: "飛天御剣流『天翔龍閃』",
    printedCategory: "magic",
    colors: ["red"],
    cost: 7,
    reductionSymbols: ["red", "red", "white", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "フラッシュ",
      "自分のターンなら、相手のネクサス2つまでを破壊し、相手の創界神ネクサス2つのコアすべてをボイドに置く。自分の煌臨中の「剣心」がいるとき、自分のカウント6以上なら、この効果は相手の効果では防げない。",
      "",
      "スタック",
      "〔アタックステップ〕魂状態を含む自分の「剣心」がいるとき、相手のスピリット/アルティメット2体を破壊する。",
    ],
    keywordTags: ["soul_state"],
    image: "images/BSRK01-R02.webp",
    rarity: "R",
    pack: "BSRK01 るろうに剣心",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // フラッシュ: 自分のターンなら相手ネクサス2つまで破壊＋創界神2つのコア全ボイド／煌臨「剣心」かつカウント6以上で防げない。
      // 「相手のネクサス2つまで」= 無印 category:["nexus"] (targetsGrandwalker 省略で創界神/導界者を除外、
      // 通常ネクサスのみが対象、BSDB01-X02[3,4] 同型の count:{min:0,max:2})。
      // 「相手の創界神ネクサス2つのコアすべてをボイド」= targetsGrandwalker:"only" (grandwalkerKind は
      // 指定しない="any"、導界者ネクサスも対象に含める。qa-002「創界神ネクサス1つのコアすべてをボイドに
      // 置く」型のコア移動系は導界者ネクサスも無条件で受ける、P3-134) で2体を選び、
      // core_move(target+from:target_card+amount:"all") の multi-target 化
      // (engine-coreshoot-multi-target-void, 2026-07-27 landed) で各対象のコアを個別に全てボイドへ。
      // 「煌臨中の「剣心」+カウント6以上で防げない」= preventionLevelCondition (BSDB01-X02[3,4] 同型)
      // に field_has(cardNames「剣心」+adventState:"advented") を追加した AND 条件。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [{ kind: "turn_player", player: "self" }],
        preventionLevel: "unpreventable",
        preventionLevelCondition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "剣心" }],
            adventState: "advented",
          },
          { kind: "count_value", player: "self", min: 6 },
        ],
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"] },
                count: { min: 0, max: 2 },
              },
            },
          },
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                },
                count: 2,
              },
              from: { kind: "target_card" },
              to: { kind: "void", player: "opponent" },
              amount: "all",
            },
          },
        ],
        textRef: [0, 1],
      },
      // スタック〔アタックステップ〕魂状態を含む自分の「剣心」がいるとき、相手のスピリット/アルティメット2体を破壊する。
      // 〔アタックステップ〕限定 → timingScope。「魂状態を含む」= 通常フィールド ∪ 魂状態（裁定
      // 2026-06-13・10_rules/08a）。無印 field_has は魂状態を数えないため includeSoulState:true で opt-in。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "剣心" }],
            includeSoulState: true,
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
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                },
                count: 2,
              },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSRK01-R03",
    orikaId: 438,
    orikaIndex: 455,
    name: "[御庭番衆編]緋村 剣心",
    printedCategory: "spirit",
    colors: ["red", "white"],
    cost: 5,
    reductionSymbols: ["red", "red", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 9000,
      },
    ],
    printedOverCount: { minCount: 2, bpBonus: 3000 },
    overCount: { minCount: 2, bpBonus: 3000 },
    symbolColors: ["red"],
    textLines: [
      "フラッシュ【契約煌臨：「緋村 剣心」＆C2以上『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/アタック時』",
      "［ターンに1回：同名］自分のデッキを上から3枚オープンできる。その中の「飛天御剣流」を含むマジックカード1枚のメイン/フラッシュ効果を発揮できる。残ったカードは破棄し、効果を発揮したカードは手札に加える。",
      "",
      "【OC条件：カウント2以上】",
      "【OC中】Lv1-Lv2 フラッシュ",
      "〔ターンに1回:同名〕トラッシュにある「逆刃刀」かコスト8の「剣心」1枚を手札と入れ替えられる。",
    ],
    keywordTags: [],
    tribe: "明治・剣士",
    image: "images/BSRK01-R03.webp",
    rarity: "R",
    pack: "BSRK01 るろうに剣心",
    // フラッシュ【契約煌臨：「緋村 剣心」＆C2以上『お互いのアタックステップ』】
    // 契約煌臨宣言は declare_advent エンジン経路で処理される。
    // 『お互いのアタックステップ』→ both_attack_step (08a:17 タイミング表)。
    // 煌臨先「緋村 剣心」(カード名部分一致) は AdventCondition.cardNames で表現
    //   ([[project_card_name_reference_matching]]、engine-drain 型 SSOT 適用)。
    // 「C2以上」は煌臨先コストではなく自分のカウント閾値のため declareCondition で表現。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "緋村 剣心" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 2 }],
    },
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このスピリットの煌臨/アタック時』［ターンに1回：同名］デッキ上3枚オープン→「飛天御剣流」マジック1枚のメイン/フラッシュ効果発揮、残り破棄、発揮カードは手札。
      // deck_reveal (pick destination既定=hand) + borrow_magic_effect(target:{kind:"ref",stepId})
      // の組み合わせ (engine-field-magic-self-placement 型、BSAZ01 先例)。ピック元がデッキという
      // 非同期経路のため、後続 step は filter 再マッチではなく deck_reveal の pick 結果を直接参照し、
      // 「効果解決前から手札にあった別の飛天御剣流マジックを誤って借用する」リスクを排除する。
      // 「オープンできる」＝可能形語尾＝任意 (10_rules/03c) のため executionMode:"optional"。
      {
        timing: { kind: "card_event", event: ["advent", "attack"] },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        applicability: { level: { min: 1, max: 2 } },
        steps: [
          {
            id: "reveal",
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["magic"],
                    cardName: { contains: "飛天御剣流" },
                    hasActivatedEffectMode: ["main", "flash"],
                  },
                },
              ],
              remainder: "trash",
              beforeMoveSteps: [
                {
                  action: {
                    kind: "borrow_magic_effect",
                    target: { kind: "ref", stepId: "reveal" },
                    borrowModes: ["main", "flash"],
                  },
                },
              ],
            },
          },
        ],
        textRef: [3, 4],
      },
      // 【OC中】Lv1-Lv2 フラッシュ〔ターンに1回:同名〕トラッシュの「逆刃刀」かコスト8の「剣心」1枚を手札と入れ替え。
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { level: { min: 1, max: 2 } },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        condition: [
          { kind: "count_value", player: "self", min: 2 },
          { kind: "cards_in_zone", player: "self", zone: ["hand"], min: 1 },
          {
            kind: "cards_in_zone",
            player: "self",
            zone: ["trash"],
            filter: {
              filterOr: [
                { cardName: { contains: "逆刃刀" } },
                { cardName: { contains: "剣心" }, minCost: 8, maxCost: 8 },
              ],
            },
            min: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "queue_hand_trash_swap",
              outgoingFilter: {},
              outgoingZones: ["hand"],
              incomingFilter: {
                filterOr: [
                  { cardName: { contains: "逆刃刀" } },
                  { cardName: { contains: "剣心" }, minCost: 8, maxCost: 8 },
                ],
              },
            },
          },
        ],
        textRef: [6, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSRK01-X01",
    braveCondition: { cardNameContains: ["緋村 剣心"] },
    combinedBoost: 4000,
    orikaId: 439,
    orikaIndex: 456,
    name: "逆刃刀",
    printedCategory: "brave",
    colors: ["red", "white"],
    cost: 4,
    reductionSymbols: ["red", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "【合体条件：「緋村 剣心」】",
      "",
      "【合体結誓：「緋村 剣心」が煌臨元の契約煌臨スピリット】",
      "〔ゲームに1回:同名〕対象と合体したとき、次の効果を発揮できる。",
      "■ 相手は、相手の手札が4枚以下になるように破棄する。その後、次の自分のスタートステップまで、相手は、相手の効果で手札を増やせず、ライフにコアを置けない。",
      "",
      "【合体中】『自分のメインステップ終了時』",
      "〔ターンに1回:同名〕トラッシュにある「飛天御剣流」を含むマジックカード1枚を手札に戻せる。そうしたとき、自分は手札が5枚以下になるように内容を見せずにデッキの下に戻す。",
    ],
    keywordTags: [],
    tribe: "明治・剣刃",
    image: "images/BSRK01-X01.webp",
    rarity: "X",
    pack: "BSRK01 るろうに剣心",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【合体結誓：「緋村 剣心」が煌臨元の契約煌臨スピリット】〔ゲームに1回:同名〕対象と合体したとき、
      // 次の効果を発揮できる。相手は手札4枚以下になるよう破棄。その後、次の自分のスタートステップまで、
      // 相手は相手の効果で手札を増やせず、ライフにコアを置けない。
      // 「煌臨元の契約煌臨スピリット」= host の煌臨元 (underCards role:"advent_source") が
      // 「緋村 剣心」を含み、かつ host 自身が adventVariant:"contract" で場に出た (契約煌臨)、の
      // 両方を combined_host_advent_source_card_name (新設 ConditionClause、
      // requireContractAdventVariant:true) で判定する。ホスト自身の印字名を見る
      // combined_host_card_name だと、BSRK01-CX01「緋村 剣心」を煌臨元を伴わず通常召喚しただけの
      // ホストにも誤って一致してしまう (adversarial verifier round1 refute で発見・修正)。
      // 手札破棄は既存 discard action、ライフコア配置禁止は既存 restrict_core_placement (scope 省略時
      // "to_life" 相当)、手札増加禁止は本 cluster で新設した hand_gain_prevention primitive。
      // duration「次の自分のスタートステップまで」= {scope:"step",step:"start",whose:"self"}
      // (BSLH01.ts 同型表現の既存 SSOT)。
      {
        timing: { kind: "card_event", event: "brave_combined" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "game" },
        condition: [
          {
            kind: "combined_host_advent_source_card_name",
            cardNames: [{ contains: "緋村 剣心" }],
            requireContractAdventVariant: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "discard",
              player: "opponent",
              count: -1,
              targetHandSize: 4,
            },
          },
          {
            action: {
              kind: "restrict_core_placement",
              player: "opponent",
              duration: { scope: "step", step: "start", whose: "self" },
            },
          },
          {
            action: {
              kind: "hand_gain_prevention",
              player: "opponent",
              duration: { scope: "step", step: "start", whose: "self" },
            },
          },
        ],
        textRef: [2, 3, 4],
      },
      // 【合体中】『自分のメインステップ終了時』〔ターンに1回:同名〕トラッシュの「飛天御剣流」マジック1枚を手札に戻し、手札5枚以下になるようデッキの下に戻す。
      {
        timing: { kind: "phase", step: "main", whose: "self", subPhase: "end" },
        applicability: { combined: true },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            id: "return_hiten_magic",
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: {
                category: ["magic"],
                cardName: { contains: "飛天御剣流" },
              },
              count: 1,
              destination: "hand",
              mandatory: true,
            },
          },
          {
            action: {
              kind: "discard",
              player: "self",
              count: -1,
              targetHandSize: 5,
              destination: "deck_bottom",
            },
            connector: "sequential",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "return_hiten_magic",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSRK01-X02",
    orikaId: 440,
    orikaIndex: 457,
    name: "[京都動乱編]緋村 剣心",
    printedCategory: "spirit",
    colors: ["red", "white"],
    cost: 8,
    reductionSymbols: ["red", "red", "red", "white", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 20000,
      },
    ],
    printedOverCount: { minCount: 8, bpBonus: 8000 },
    overCount: { minCount: 8, bpBonus: 8000 },
    symbolColors: ["red", "white"],
    textLines: [
      "フラッシュ【契約煌臨：「緋村 剣心」＆C8以上『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "【OC条件：カウント8以上】",
      "【OC中＆煌臨中】Lv1-Lv2『このスピリットのアタック時』",
      "手札/トラッシュの「飛天御剣流」を含むマジックカードのメイン/フラッシュ/スタック効果1つを発揮できる。この効果で発揮するメイン/フラッシュ/スタック効果は、相手の効果を受けない。その後、効果を発揮したカードは破棄する。さらに、バトル終了時、Lv2以上なら、手札/トラッシュのマジックカード1枚を除外することでこのスピリットは回復する。",
      "",
      "【OC中＆煌臨中】Lv1-Lv2",
      "このスピリットは相手の効果を受けない。",
    ],
    keywordTags: [],
    tribe: "明治・剣士",
    image: "images/BSRK01-X02.webp",
    rarity: "X",
    pack: "BSRK01 るろうに剣心",
    // フラッシュ【契約煌臨：「緋村 剣心」＆C8以上『自分のターン』】
    // 契約煌臨宣言は declare_advent エンジン経路で処理される。
    // 『自分のターン』は自分ターンのメイン/フラッシュ窓で使用可 → own_turn で表現。
    // 煌臨先「緋村 剣心」(カード名部分一致) は AdventCondition.cardNames で表現
    //   ([[project_card_name_reference_matching]]、engine-drain 型 SSOT 適用)。
    // 「C8以上」は煌臨先コストではなく自分のカウント閾値のため declareCondition で表現。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "緋村 剣心" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 8 }],
    },
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【OC中＆煌臨中】Lv1-Lv2『アタック時』手札/トラッシュの「飛天御剣流」マジック効果1つを発揮
      // （相手効果受けない）→破棄。borrow_magic_effect (effect-borrowing.ts、BSAZ03-M01 初出)。
      // 「この効果で発揮する…効果は、相手の効果を受けない」の主語は借用先の被借用効果のみ
      // (このborrow_magic_effect自体の発動可否ではない)。effect直下のpreventionLevelは
      // 効果全体(=借用宣言自体)まで unpreventable 化してしまい主語が広すぎるため
      // (adversarial verifier 2026-07-26 refute)、action.borrowedEffectPreventionLevel で
      // 借用先実行にだけ範囲を絞って委譲する。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        applicability: { level: { min: 1, max: 2 } },
        condition: [
          { kind: "count_value", player: "self", min: 8 },
          { kind: "self_state", state: "advented" },
        ],
        steps: [
          {
            action: {
              kind: "borrow_magic_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: ["hand", "trash"],
                filter: {
                  category: ["magic"],
                  cardName: { contains: "飛天御剣流" },
                  hasActivatedEffectMode: ["main", "flash", "stack"],
                },
                count: 1,
              },
              borrowModes: ["main", "flash", "stack"],
              thenMove: { zone: "trash", fromZone: ["hand", "trash"] },
              borrowedEffectPreventionLevel: "unpreventable",
            },
          },
        ],
        textRef: [3, 4, 5],
      },
      // 【OC中＆煌臨中】Lv1-Lv2「さらに、バトル終了時、Lv2以上なら、手札/トラッシュのマジック
      // カード1枚を除外することでこのスピリットは回復する。」観測スコープ裁定確定
      // (ruling-researcher 2026-07-28、信頼度B、10_rules/02_turn-flow-and-timing.md「形式5」):
      // 直前の『このスピリットのアタック時』トリガーブロック内に「さらに」で接続されるため、
      // そのアタック(自分参加バトル)限定の battle_end 観測。BSTH03-転醒X01(B) 同型先例で
      // card_event:"attack" + deferredTo:"battle_end" (count_decrease→recover conditional_cost)。
      // 本カードは cost が remove_from_game(手札/トラッシュから1枚選択必須) な点のみ異なる。
      // ENGINE-battle-end-deferral-target-carry: PendingBattleEndDeferral (model.ts) に
      // targetInstanceIds/targetStepId を持たせ、fireBattleEndDeferrals 再発火時に
      // ExecuteEffectOptions.targetInstanceIds/targetStepId として forward する (options に
      // 既にあれば宣言時点で捕捉、無ければ fire 時の通常 pendingStepOptionalTargetSelection
      // 経路へフォールバック)。「Lv2以上」は条件節 (min_level) で表現、OC/煌臨中条件は
      // effects[0] と共有。
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        executionMode: "optional",
        condition: [
          { kind: "count_value", player: "self", min: 8 },
          { kind: "self_state", state: "advented" },
          { kind: "min_level", value: 2 },
        ],
        steps: [
          {
            action: {
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "self",
                zone: ["hand", "trash"],
                filter: { category: ["magic"] },
                count: 1,
              },
            },
          },
          {
            action: { kind: "recover", target: { kind: "self" } },
            connector: "conditional_cost",
          },
        ],
        textRef: [5],
      },
      // 【OC中＆煌臨中】Lv1-Lv2 このスピリットは相手の効果を受けない。
      // OC中 = count_value(self,min:8) / 煌臨中 = self_state.advented (08a:34 表向き煌臨元≧1)
      // Lv1-Lv2 = applicability.level / 「相手の効果を受けない」= effect_immunity(self, while_on_field)
      // 既存プリミティブだけで表現可能。スタブ注記は stale。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 1, max: 2 } },
        condition: [
          { kind: "count_value", player: "self", min: 8 },
          { kind: "self_state", state: "advented" },
        ],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
];
