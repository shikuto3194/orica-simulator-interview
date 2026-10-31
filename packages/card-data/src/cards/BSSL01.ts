import type { CardDefinition } from "@orica/rules-core";

// キバのアタック誘発とフラッシュは同じ「下の効果」を発揮し、使用回数も共有する。
const kibaCoreMoveSteps: NonNullable<
  CardDefinition["effects"]
>[number]["steps"] = [
  {
    action: {
      kind: "core_move",
      from: {
        kind: "field",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
      },
      to: { kind: "reserve", player: "opponent" },
      amount: {
        min: 0,
        max: {
          source: {
            kind: "cards_in_zone",
            zone: "field",
            player: "self",
            filter: { category: ["spirit"], tribes: ["影"] },
          },
        },
      },
    },
  },
];

export const BSSL01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSSL01-C01",
    orikaId: 410,
    orikaIndex: 427,
    name: "再覚醒者 水篠 旬",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "purple"],
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
    printedOverCount: { minCount: 4, bpBonus: 7000 },
    overCount: { minCount: 4, bpBonus: 7000 },
    symbolColors: ["purple"],
    textLines: [
      "フラッシュ 【契約煌臨：「水篠 旬」『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの召喚/煌臨時』",
      "〔ターンに1回：同名〕手札にある系統：「影」/「プレイヤー」を持つカード2枚までを破棄できる。そうしたとき、破棄したカード1枚につき、自分はデッキの上から2枚ドローする。",
      "",
      "【OC条件：カウント4以上】",
      "【OC中】 Lv1-Lv2『このスピリットのアタック時』",
      "最もコアの少ない相手のスピリット/アルティメット1体のコアすべてをトラッシュに置ける。",
    ],
    keywordTags: [],
    tribe: "プレイヤー",
    image: "images/BSSL01-C01.webp",
    rarity: "C",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「水篠 旬」『自分のターン』】= 煌臨宣言。
    // 煌臨は CardDefinition.adventData で宣言する（declare_advent は main 配線済み）。
    // 『自分のターン』= own_turn（自ターンの main/flash 窓を許可）。adventVariant: contract。
    // テキスト[1]「自分のスピリットに手札から重ねる」→ targetCategory: ["spirit"]、
    // 契約煌臨はソウルコアをトラッシュへ（テキスト[1]も「トラッシュに置くことで」）→ soulCoreDest: "trash"。
    // 名前条件「水篠 旬」は AdventCondition.cardNames で表現（engine-drain 型 SSOT 適用）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "水篠 旬" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
    },
    effects: [
      // [3,4] Lv1-Lv2『召喚/煌臨時』〔ターンに1回:同名〕手札の系統:「影」/「プレイヤー」カード2枚までを
      // 破棄できる。そうしたとき、破棄1枚につきデッキ上から2枚ドロー。
      //   「2枚まで」= 任意の上限付き範囲破棄 discard count:{min:0,max:2}（optionalUpTo で
      //   pendingZoneSelection を生成、0..2 枚を任意選択）。filter:tribes で系統「影」/「プレイヤー」
      //   のみを候補に絞る。破棄枚数連動ドローは draw count = cards_from_ref(disc)×2
      //   （ZoneSelectionContinuation d797869 で discard 後の後続ステップ再開を成立。
      //   正源 test: zone-selection-continuation）。
      {
        timing: { kind: "card_event", event: ["summon", "advent"] },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            id: "disc",
            action: {
              kind: "discard",
              player: "self",
              count: { min: 0, max: 2 },
              filter: { tribes: ["影", "プレイヤー"] },
            },
          },
          {
            action: {
              kind: "draw",
              count: {
                source: { kind: "cards_from_ref", stepId: "disc" },
                multiplier: 2,
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      // [7,8] 【OC条件：カウント4以上】【OC中】Lv1-Lv2『このスピリットのアタック時』
      //   最もコアの少ない相手のスピリット/アルティメット1体のコアすべてをトラッシュに置ける。
      //   【OC中】= OC 条件（カウント4以上）成立中 → アタック時 trigger 時点で count>=4 を検査。
      //   「最もコアの少ない…1体」= 単一対象コアシュート（target で1体選択 → from:target_card）。
      //   極値選択は CardFilter.extremal {metric:"core", mode:"lowest"}（target-resolution /
      //   候補列挙の両経路で selectExtremalInstanceIds が honor。BSDB01-C04 の destroy が precedent）。
      //   「コアすべて」= amount:"all"（card_instance 源は normalCoreCount 全量を移送）→ コア欠損で
      //   SBA 破壊。任意（「置ける」）なので executionMode:optional。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "count_value", player: "self", min: 4 }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  extremal: { metric: "core", mode: "lowest" },
                },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "trash", player: "opponent" },
              amount: "all",
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSSL01-C02",
    orikaId: 411,
    orikaIndex: 428,
    name: "タンク",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple"],
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
    ],
    symbolColors: ["purple"],
    textLines: [
      "〔ターンに1回：同名〕手札/トラッシュにあるこのカードは、相手が相手の効果でボイドからコアを増やしたとき、コストを支払わずに召喚できる。そうしたとき、このターンの間、相手は相手の効果でボイドからコアを増やせず、相手のスピリット/アルティメットのコア2個までをトラッシュに置ける。",
      "",
      "Lv1-Lv2 このスピリットが相手によってフィールドを離れるとき、このスピリットを、自分の「水篠 旬」の煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない。",
      "",
      "Lv1-Lv2『このスピリットの召喚/アタック時』",
      "自分はデッキの上から1枚ドローできる。",
    ],
    keywordTags: [],
    tribe: "影・甲獣",
    image: "images/BSSL01-C02.webp",
    rarity: "C",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 〔ターンに1回:同名〕手札/トラッシュのこのカードは、相手が相手の効果でボイドからコアを
      //   増やしたとき、コストを支払わず召喚できる。そうしたとき、このターン相手はボイドからコアを
      //   増やせず、相手のスピリット/アルティメットのコア2個までをトラッシュに置ける。
      //   ENGINE-void-core-decrease-trigger: game_event(opponent, void_core_decrease,
      //   cause:self_effect) = 「相手が相手の効果でボイドからコアを増やしたとき」
      //   (voidNormalCoreCount 減少を検出)。costModifier:"free" 召喚は BSDB01-M02 effects[2]
      //   と同型。「そうしたとき」の restrict_core_placement(scope:"from_void_self") は
      //   BSTH02.7-C01 effects[2] choice[0] の to_life 版と対称の新設 scope。「2個まで」は
      //   from:{kind:"field",filter}+amount:{min:0,max:2} (P3-88、BSLH01-C0? 型と同型)。
      //   「そうしたとき」= 召喚成立が前提 (BSDB01-M02 effects[2] precedent と同型)。
      //   steps[1,2] は stepCondition:ref_succeeded で steps[0] の召喚成立をゲートする
      //   (召喚不成立時に制限/コアシュートが誤発火しないよう防止。adversarial verifier
      //   round1 lens1 指摘)。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "void_core_decrease",
          cause: ["self_effect"],
        },
        applicability: { zone: ["hand", "trash"] },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        executionMode: "optional",
        steps: [
          {
            id: "c02-summon",
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
          },
          {
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "c02-summon" },
            action: {
              kind: "restrict_core_placement",
              player: "opponent",
              scope: "from_void_self",
              duration: { scope: "turn" },
            },
          },
          {
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "c02-summon" },
            action: {
              kind: "core_move",
              from: {
                kind: "field",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
              },
              to: { kind: "trash", player: "opponent" },
              amount: { min: 0, max: 2 },
            },
          },
        ],
        textRef: [0],
      },
      // [2] Lv1-Lv2 このスピリットが相手によってフィールドを離れるとき、自分の「水篠 旬」の
      //   煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない。
      //   FieldExitReplacement の advent_source 変種 (engine batch2-2): 相手起因離脱を
      //   「水篠 旬」の煌臨元への追加 (or トラッシュ) に置換する。「この効果は相手の効果を
      //   受けない」= 置換効果自体が静的耐性で発火する（source:"opponent"）。
      {
        timing: { kind: "continuous" },
        preventionLevel: "immune",
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent",
              duration: { scope: "while_on_field" },
              replacement: {
                kind: "advent_source",
                target: { cardName: { contains: "水篠 旬" } },
                orTrash: true,
              },
            },
          },
        ],
        textRef: [2],
      },
      // [4,5] Lv1-Lv2『このスピリットの召喚/アタック時』自分はデッキの上から1枚ドローできる。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSSL01-C03",
    orikaId: 412,
    orikaIndex: 429,
    name: "カルテノン神殿",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple", "purple"],
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
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2『このネクサスの配置時』",
      "自分のカウント+1できる。その後、自分はデッキの上から1枚ドローできる。",
      "",
      "Lv2『自分のドローステップ』",
      "〔重複不可〕自分の手札にある系統：「影」/「プレイヤー」を持つカード1枚を破棄することで、ドロー枚数を+1する。",
    ],
    keywordTags: [],
    tribe: "影",
    image: "images/BSSL01-C03.webp",
    rarity: "C",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] Lv1-Lv2『このネクサスの配置時』自分のカウント+1できる。その後、デッキ上から1枚ドローできる。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            executionMode: "optional",
          },
          {
            action: { kind: "draw", count: 1 },
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv2『自分のドローステップ』〔重複不可〕手札の系統:「影」/「プレイヤー」1枚を破棄することで
      //   ドロー枚数を+1する。
      // コスト先払い型ドロー枚数修正（model A, 裁定 2026-06-15 / 10_rules/02 §コスト先払い型）:
      //   システムドロー前に任意の破棄判断を解決し、支払えた場合のみ +1 を確定する。
      //   inline:true で turn-system.ts のドローステップ処理が prepaidCost を検出して
      //   pendingDrawStepCostChoice を立て、解決後に +1 込みでシステムドローする。
      //   〔重複不可〕= usageLimit per_card_name turn（同名スピリット間の重複発揮抑止）。
      {
        timing: {
          kind: "phase",
          step: "draw",
          whose: "self",
          subPhase: "start",
        },
        inline: true,
        condition: [{ kind: "min_level", value: 2 }],
        // inline draw-step のイベントスコープを使い、同じドロー処理内だけ重複を抑止する。
        usageLimit: {
          kind: "no_duplicate",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "draw_modify",
              amount: 1,
              duration: {
                scope: "step",
                step: "draw",
              },
              prepaidCost: {
                kind: "discard_hand",
                cardFilter: {
                  tribes: ["影", "プレイヤー"],
                },
              },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSSL01-C04",
    orikaId: 413,
    orikaIndex: 430,
    name: "ペナルティエリア",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple"],
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
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2『このネクサスの配置時』",
      "〔ターンに1回：同名〕自分のカウント+2できる。その後、自分は手札の系統：「影」/「プレイヤー」を持つカード1枚を破棄することで、デッキの上から2枚ドローする。",
      "",
      "Lv2 フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回：同名〕バトルしている本来のコストが3以下の相手のスピリット/アルティメット1体のコアすべてをトラッシュに置ける。",
    ],
    keywordTags: [],
    tribe: "影",
    image: "images/BSSL01-C04.webp",
    rarity: "C",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] Lv1-Lv2『配置時』〔ターンに1回:同名〕カウント+2できる。その後、手札の系統:「影」/
      //   「プレイヤー」1枚を破棄することで、デッキの上から2枚ドローする。
      // count+2（任意）→ さらに 破棄を支払えれば 2枚ドロー（discard コスト + conditional_cost draw）。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 2 },
            executionMode: "optional",
          },
          {
            action: {
              kind: "discard",
              count: 1,
              player: "self",
              fromZone: "hand",
              filter: { tribes: ["影", "プレイヤー"], tribesLogic: "or" },
            },
            connector: "sequential",
            executionMode: "optional",
          },
          {
            action: { kind: "draw", count: 2 },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv2 フラッシュ『お互いのアタックステップ』〔ターンに1回:同名〕バトルしている本来の
      //   コストが3以下の相手のスピリット/アルティメット1体のコアすべてをトラッシュに置ける。
      //   対象を battleState:in_battle + maxCost:3 + spirit/ult に限定した coreshoot
      //   (engine batch2-5)。「1体のコアすべて」= amount:"all"（単一候補なら全取り、複数候補は
      //   pendingCoreShootSelection で 1 体選択）。「置ける」= optional。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  battleState: "in_battle",
                  maxCost: 3,
                  costBasis: "printed",
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "trash", player: "opponent" },
              amount: "all",
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSSL01-C05",
    braveCondition: { tribes: ["プレイヤー"] },
    combinedBoost: 2000,
    orikaId: 414,
    orikaIndex: 431,
    name: "短剣",
    printedCategory: "brave",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
    ],
    symbolColors: [],
    textLines: [
      "Lv1『このブレイヴの召喚時』",
      "〔ターンに1回：同名〕自分のカウント+1できる。さらに、自分はデッキの上から1枚ドローするか、魂状態の「水篠 旬」1枚をコスト0として召喚できる。",
      "",
      "【合体条件：プレイヤー】",
      "【合体中】『このスピリットのアタック時』",
      "相手のスピリット/アルティメット1体のコアを、自分のカウント2につき1個までリザーブに置ける。",
    ],
    keywordTags: ["soul_state"],
    tribe: "影",
    image: "images/BSSL01-C05.webp",
    rarity: "C",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] Lv1『このブレイヴの召喚時』〔ターンに1回:同名〕自分のカウント+1できる。
      // さらに、デッキの上から1枚ドローするか、魂状態の「水篠 旬」1枚をコスト0として召喚できる。
      // 後段の択一は EffectStep.choice (choiceIndex 0=ドロー / 1=魂状態召喚)。
      // 魂状態召喚は summon from_zone (zone:"field" + filter.soulState:"only") で
      // executeSoulStateSummon 経路に分岐する (rule 08a:152)。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            executionMode: "optional",
          },
          {
            action: { kind: "draw", count: 1 },
            executionMode: "optional",
            choice: [
              {
                action: {
                  kind: "summon",
                  target: {
                    kind: "from_zone",
                    zone: "field",
                    filter: {
                      category: ["spirit", "ultimate", "brave"],
                      soulState: "only",
                      cardName: [{ contains: "水篠 旬" }],
                    },
                    count: 1,
                  },
                  costModifier: { override: 0 },
                },
              },
            ],
          },
        ],
        textRef: [0, 1],
      },
      // [3,4,5] 【合体条件：プレイヤー】【合体中】『このスピリットのアタック時』
      //   相手のスピリット/アルティメット1体のコアを、自分のカウント2につき1個までリザーブに置ける。
      //   単一対象コアシュート（core_move.target で1体選択 → from: target_card）。
      //   個数は範囲 {min:0, max: floor(count/2)} で pendingCoreCountSelection をプレイヤーに提示。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "reserve", player: "opponent" },
              amount: {
                min: 0,
                max: {
                  source: { kind: "count_value", player: "self" },
                  divisor: 2,
                },
              },
            },
          },
        ],
        textRef: [3, 4, 5],
      },
    ],
  },
  {
    cardNo: "BSSL01-C06",
    orikaId: 415,
    orikaIndex: 432,
    name: "影の召喚",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "purple"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "フラッシュ",
      "魂状態/煌臨元を含む契約スピリットの「水篠 旬」がいるとき、相手のアタックステップなら、自分のトークンの「影の兵士」2体までを出す。このとき、トラッシュのコアも1個まで置ける。この効果で出した対象はこのステップの間、相手の効果でフィールドを離れない。",
    ],
    keywordTags: ["soul_state"],
    tribe: "影",
    image: "images/BSSL01-C06.webp",
    rarity: "C",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSSL01-T01"],
    // [0] フラッシュ「魂状態/煌臨元を含む契約スピリットの「水篠 旬」がいるとき、相手のアタック
    //   ステップなら、自分のトークンの「影の兵士」2体までを出す。このとき、トラッシュのコアも
    //   1個まで置ける。この効果で出した対象はこのステップの間、相手の効果でフィールドを離れない」。
    //   put.target:"from_token_pool" を使用。
    //   「魂状態/煌臨元を含む」= field_has の includeSoulState/includeAdventSource。
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "水篠 旬" }],
            isContract: true,
            includeSoulState: true,
            includeAdventSource: true,
          },
        ],
        timingScope: { player: "opponent", period: "attack" },
        executionMode: "optional",
        steps: [
          {
            id: "c06-token-summon",
            action: {
              kind: "split_field_entry_choice",
              totalCount: 2,
              tokenAction: {
                kind: "put",
                target: { kind: "from_token_pool", count: 1 },
                trashCoreMax: 1,
                trashCoreKind: "generic",
              },
            },
          },
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "ref",
                stepId: "c06-token-summon",
                result: "affected",
              },
              resistsOutcome: "leave_field",
              source: "opponent_effect",
              duration: { scope: "step", step: "attack" },
            },
          },
        ],
        textRef: [0, 1],
      },
    ],
  },
  {
    cardNo: "BSSL01-CX01",
    orikaId: 416,
    orikaIndex: 433,
    name: "水篠 旬",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: ["purple"],
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
    printedOverCount: { minCount: 3, bpBonus: 6000 },
    overCount: { minCount: 3, bpBonus: 6000 },
    symbolColors: ["purple"],
    textLines: [
      "魂状態のこのカードには【契約煌臨】できる。このとき、煌臨するカードに自分のフィールド/リザーブのコアを好きなだけ置く。",
      "",
      "【契約煌臨元】/【スピリット】 Lv1-Lv2 『お互いのアタックステップ』",
      "〔ターンに1回:同名〕このスピリットが相手の効果でフィールドを離れるとき、2コスト支払うことで、フィールド/リザーブのコアを好きなだけ置いて同じ状態で残す。",
      "",
      "【魂状態】/【契約煌臨元】/【スピリット】 Lv1-Lv2 フラッシュ",
      "ターンに1回、自分のカウント+1する。アタックステップなら、さらに、自分のカウント+1し、このスピリットがいるなら、手札1枚を破棄できる。そうしたとき、デッキから2枚ドローする。",
    ],
    keywordTags: ["soul_state", "contract"],
    tribe: "プレイヤー",
    image: "images/BSSL01-CX01.webp",
    rarity: "CX",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 魂状態のこのカードには【契約煌臨】できる。このとき、煌臨するカードに自分のフィールド/
      //   リザーブのコアを好きなだけ置く。
      //   被煌臨側（このカードを煌臨元にする側）の宣言は declare_advent main 配線済みで、
      //   契約煌臨カードの adventData + getContractAdventTargets が魂状態の契約「水篠 旬」を
      //   煌臨先に含めるため production で機能する（このカード自身は煌臨しないので adventData 不要）。
      //   「煌臨するカードに任意コア配置」は契約煌臨で魂状態へ煌臨したときの intrinsic 処理として
      //   engine 側で表現（legal-actions-apply: buildChargeCoresPendingCoreDistribution、08a:180）。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [0],
      },
      // [2,3] 【契約煌臨元】/【スピリット】Lv1-Lv2『お互いのアタックステップ』〔ターンに1回:同名〕
      //   このスピリットが相手の効果でフィールドを離れるとき、2コスト支払うことで、フィールド/リザーブの
      //   コアを好きなだけ置いて同じ状態で残す。
      //   「ことで」構文: pay_cost(2) → conditional_cost stay_on_field（双方向ロールバック, 03c）。
      //   その後の「コアを好きなだけ置いて」= core_distribute from:field_and_reserve_self
      //   mode:player_choice minTotal:0（「フィールド/リザーブの」限定＝trash/life を含まない
      //   any_movable_self の縮小版、BSFT01 TR系【転醒】許可窓と同型 primitive）。
      {
        applicability: {
          zone: ["field", "advent_source"],
          adventSourceHostVariants: ["contract", "f_contract"],
        },
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: "opponent_effect",
        },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          { id: "cost", action: { kind: "pay_cost", amount: 2 } },
          {
            action: { kind: "stay_on_field", target: { kind: "self" } },
            connector: "conditional_cost",
          },
          {
            action: {
              kind: "core_distribute",
              from: { kind: "field_and_reserve_self" },
              to: { kind: "self" },
              amount: "all",
              mode: "player_choice",
              minTotal: 0,
            },
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] 【魂状態】/【契約煌臨元】/【スピリット】Lv1-Lv2 フラッシュ:
      //   ターンに1回、自分のカウント+1する。アタックステップなら、さらに、自分のカウント+1し、
      //   このスピリットがいるなら、手札1枚を破棄できる。そうしたとき、デッキから2枚ドローする。
      // 前段カウント+1は無条件。後段は step_phase:attack（『お互いのアタックステップ』= whose:either）
      //   でゲートする。「このスピリットがいるなら」は実体のスピリットを参照し、魂状態は含まない。
      //   手札1枚破棄(optional)→ そうしたとき(conditional_result)2枚ドロー。
      {
        applicability: {
          zone: ["field", "soul_state", "advent_source"],
          adventSourceHostVariants: ["contract", "f_contract"],
        },
        timing: { kind: "activated", mode: "flash" },
        // 〔ターンに1回〕(「:同名」無し) = per_instance（10_rules/03c 表）。同名カード共有の
        // per_card_name とは別 scope。
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            condition: [
              { kind: "step_phase", step: "attack", whose: "either" },
            ],
            connector: "sequential",
          },
          {
            action: {
              kind: "discard",
              count: 1,
              player: "self",
              fromZone: "hand",
            },
            executionMode: "optional",
            condition: [
              { kind: "step_phase", step: "attack", whose: "either" },
              {
                kind: "self_state",
                state: "on_field",
                reference: "self",
                filter: { category: ["spirit"] },
              },
            ],
            connector: "sequential",
          },
          {
            action: { kind: "draw", count: 2 },
            // 破棄を実行しなかった場合は「そうしたとき」以降だけを省略する。
            connector: "conditional_result",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSSL01-M01",
    orikaId: 417,
    orikaIndex: 434,
    name: "キバ",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: ["purple", "purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 11000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 16000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "〔ターンに1回：同名〕手札/トラッシュ/煌臨元にあるこのカードは、自分のメインステップに、自分のカウント5以上なら、コスト4として召喚できる。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットを、自分の「水篠 旬」の煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない。自分の系統：「影」/「プレイヤー」を持つスピリットがアタックしたとき、このスピリットがLv2以上なら下の効果を発揮できる。",
      "",
      "Lv2-Lv3 フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回：同名〕自分の系統：「影」を持つスピリット1体につき、相手のスピリット/アルティメットのコア1個をリザーブに置ける。",
    ],
    keywordTags: [],
    tribe: "影・呪鬼",
    image: "images/BSSL01-M01.webp",
    rarity: "M",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 〔ターンに1回:同名〕手札/トラッシュ/煌臨元のこのカードは、自分のメインステップに、
      //   自分のカウント5以上なら、コスト4として召喚できる。
      //   Q54 の通常召喚行動許可。コスト4の通常召喚を宣言し、コスト支払い後に
      //   stack window を開き、窓後に維持コアを配置する。
      //   「自分のメインステップに」は timingScope(period:"main") で明示的にゲートする。
      {
        applicability: { zone: ["hand", "trash", "advent_source"] },
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        condition: [{ kind: "count_value", player: "self", min: 5 }],
        steps: [
          {
            action: {
              kind: "summon",
              normalActionPermission: true,
              target: { kind: "self" },
              costModifier: { override: 4 },
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] 前段: Lv1-3 相手によってフィールドを離れるとき → 自分の「水篠 旬」の煌臨元へ追加
      //   or トラッシュ。この効果は相手の効果を受けない。
      //   FieldExitReplacement の advent_source 変種 (engine batch2-2)。
      {
        timing: { kind: "continuous" },
        preventionLevel: "immune",
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent",
              duration: { scope: "while_on_field" },
              replacement: {
                kind: "advent_source",
                target: { cardName: { contains: "水篠 旬" } },
                orTrash: true,
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      // [2,3] 後段: 「自分の系統:「影」/「プレイヤー」を持つスピリットがアタックしたとき、
      //   このスピリットがLv2以上なら下の効果を発揮できる」は別の誘発経路（末尾）。
      // [5,6] Lv2-3 フラッシュ『お互いのアタックステップ』〔ターンに1回:同名〕自分の系統:「影」を持つ
      //   スピリット1体につき、相手のスピリット/アルティメットのコア1個をリザーブに置ける。
      // 「1体」は自分の影の参照数。コアの移動元は相手の複数体から選べる。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        textRef: [5, 6],
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        limitGroupId: "BSSL01-M01:core-move",
        steps: kibaCoreMoveSteps,
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "attack",
          triggerFilter: { category: ["spirit"], tribes: ["影", "プレイヤー"] },
        },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        limitGroupId: "BSSL01-M01:core-move",
        steps: kibaCoreMoveSteps,
        textRef: [2, 3, 5, 6],
      },
    ],
  },
  {
    cardNo: "BSSL01-M02",
    orikaId: 418,
    orikaIndex: 435,
    name: "ベル",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 9,
    reductionSymbols: ["purple", "purple", "purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 9000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 14000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 20000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "フラッシュ【烈神憑・影】『お互いのアタックステップ』",
      "〔ターンに1回：同名〕手札にあるこのカードは、自分の煌臨中の「水篠 旬」がいるとき、自分のカウント5以上なら、自分のトラッシュのコア5個以上をフィールド/リザーブに置くことで、コストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットを、自分の「水篠 旬」の煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない。",
      "",
      "Lv2-Lv3『自分のアタックステップ』",
      "相手はスタック効果を発揮できない。",
    ],
    keywordTags: [],
    tribe: "影・殻人",
    image: "images/BSSL01-M02.webp",
    rarity: "M",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] フラッシュ【烈神憑・影】『お互いのアタックステップ』
      //   〔ターンに1回：同名〕手札にあるこのカードは、自分の煌臨中の「水篠 旬」がいるとき、
      //   自分のカウント5以上なら、自分のトラッシュのコア5個以上をフィールド/リザーブに置くことで、
      //   コストを支払わずに召喚する。Q54 の通常行動許可ではなく、use_hand_card_effect の
      //   宣言窓後にコア移動コストと効果内召喚を続ける即時効果。
      //   (A) 本 activated effect = applicability.zone:[hand] の summon self。
      //   (B) 次の continuous effect = 解決時に参照する cost_modify +
      //       useCostPayment.kind:"core_move" (トラッシュのコア5個以上→フィールド/リザーブ、
      //       modifier:"free" でコスト変更後も無償召喚)。
      //   条件は両 effect に同一付与: field_has(「水篠 旬」+advented) + count_value(min:5)。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        applicability: { zone: ["hand"] },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "水篠 旬" }],
            adventState: "advented",
            minCount: 1,
          },
          { kind: "count_value", player: "self", min: 5 },
        ],
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [0, 1],
      },
      // [0,1] 続き: 上記即時効果内召喚の支払い方法「自分のトラッシュのコア5個以上をフィールド/リザーブに
      //   置くことで、コストを支払わずに召喚する」。cost_modify + useCostPayment.core_move
      //   (sourceZone:"trash", minCount:5) = 必須代替支払い（通常コストへのフォールバックなし。
      //   移動可能コアが5個未満なら上の即時 effect 自体を legal action に出さない）。
      //   modifier:"free"。コスト下限と別途の余分支払いは通常どおり残す。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "水篠 旬" }],
            adventState: "advented",
            minCount: 1,
          },
          { kind: "count_value", player: "self", min: 5 },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: "free",
              useCostPayment: {
                kind: "core_move",
                sourceZone: "trash",
                minCount: 5,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv1-Lv2-Lv3 このスピリットが相手によってフィールドを離れるとき、
      //   自分の「水篠 旬」の煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない。
      {
        timing: { kind: "continuous" },
        preventionLevel: "immune",
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent",
              duration: { scope: "while_on_field" },
              replacement: {
                kind: "advent_source",
                target: { cardName: { contains: "水篠 旬" } },
                orTrash: true,
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      // [6,7] Lv2-Lv3『自分のアタックステップ』相手はスタック効果を発揮できない。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
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
  },
  {
    cardNo: "BSSL01-M03",
    orikaId: 419,
    orikaIndex: 436,
    name: "カイセル",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 6,
    reductionSymbols: ["purple", "purple", "purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 12000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットを、自分の「水篠 旬」の煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない。",
      "",
      "Lv1-Lv2 フラッシュ『自分のアタックステップ』",
      "〔バトルに1回：同名〕このスピリットを自分のアタックしている「水篠 旬」と同じ状態で右隣に並べることで、このバトルの間、相手はブロックするスピリットのコア1個をトラッシュに置かなければブロックできない。",
    ],
    keywordTags: [],
    tribe: "影・翼竜",
    image: "images/BSSL01-M03.webp",
    rarity: "M",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] Lv1-Lv2 このスピリットが相手によってフィールドを離れるとき、自分の「水篠 旬」の
      //   煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない。
      //   FieldExitReplacement の advent_source 変種 (engine batch2-2)。
      {
        timing: { kind: "continuous" },
        preventionLevel: "immune",
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent",
              duration: { scope: "while_on_field" },
              replacement: {
                kind: "advent_source",
                target: { cardName: { contains: "水篠 旬" } },
                orTrash: true,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv1-Lv2 フラッシュ『自分のアタックステップ』〔バトルに1回:同名〕このスピリットを
      //   自分のアタックしている「水篠 旬」と同じ状態で右隣に並べることで、このバトルの間、
      //   相手はブロックするスピリットのコア1個をトラッシュに置かなければブロックできない。
      //   同状態化と右隣への配置を対価として完了した場合だけ、後段を発揮する。
      //   pay-to-block ゲートは BSAZ01-C09 と同型の require_battle_cost 継続ゲートを流用。
      //   〔バトルに1回:同名〕は EffectUsageLimitDuration "battle" (今回新設、
      //   state.activeAttack.attackId スコープ) で表現。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "self", period: "attack" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "battle" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            cardNames: [{ contains: "水篠 旬" }],
            battleState: "attacking",
          },
        ],
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              target: { kind: "self" },
              placement: "right",
              matchExhaustStateOf: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  cardName: { contains: "水篠 旬" },
                  battleState: "attacking",
                },
                count: 1,
              },
            },
          },
          {
            connector: "conditional_cost",
            action: {
              kind: "require_battle_cost",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: "all",
              },
              restriction: ["block"],
              costAmount: 1,
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSSL01-R01",
    orikaId: 420,
    orikaIndex: 437,
    name: "イグリット",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 9000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットを、自分の「水篠 旬」の煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない。",
      "",
      "Lv1-Lv2『このスピリットの召喚/アタック時』",
      "ターンに1回、このターンの間、相手のスピリット/アルティメット/ネクサス1つのLvコストを自分のカウント2につき+1できる。",
    ],
    keywordTags: [],
    tribe: "影・魔影",
    image: "images/BSSL01-R01.webp",
    rarity: "R",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] Lv1-Lv2 このスピリットが相手によってフィールドを離れるとき、自分の「水篠 旬」の
      //   煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない。
      //   FieldExitReplacement の advent_source 変種 (engine batch2-2)。
      {
        timing: { kind: "continuous" },
        preventionLevel: "immune",
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent",
              duration: { scope: "while_on_field" },
              replacement: {
                kind: "advent_source",
                target: { cardName: { contains: "水篠 旬" } },
                orTrash: true,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv1-Lv2『このスピリットの召喚/アタック時』ターンに1回、このターンの間、相手の
      //   スピリット/アルティメット/ネクサス1つのLvコストを自分のカウント2につき+1できる。
      //   override_properties.levelCostDelta が Amount(DynamicCount) を取れるよう拡張し
      //   (BSKB01-M01/BSLH01-M04 の固定+2型と同 primitive)、
      //   { source: { kind: "count_value", player: "self" }, divisor: 2 } で
      //   「カウント2につき+1」を発動時点でスナップショット解決する。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate", "nexus"] },
                count: 1,
              },
              properties: {
                levelCostDelta: {
                  source: { kind: "count_value", player: "self" },
                  divisor: 2,
                },
              },
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSSL01-R02",
    orikaId: 421,
    orikaIndex: 438,
    name: "アイアン",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "purple", "purple"],
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
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2-Lv3",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットを、自分の「水篠 旬」の煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック/ブロック時』",
      "このスピリットのBP以下の相手のスピリット/アルティメット1体のコアすべてをリザーブに置ける。",
      "",
      "Lv2-Lv3",
      "ターンに1回、系統：「影」/「プレイヤー」を持つ自分のスピリットが効果の対象になるとき、その対象をこのスピリットのみにできる。",
    ],
    keywordTags: [],
    tribe: "影・闘神",
    image: "images/BSSL01-R02.webp",
    rarity: "R",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] Lv1-Lv2-Lv3 相手による離脱時、「水篠 旬」の煌臨元に追加するかトラッシュへ。
      {
        timing: { kind: "continuous" },
        preventionLevel: "immune",
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent",
              duration: { scope: "while_on_field" },
              replacement: {
                kind: "advent_source",
                target: { cardName: { contains: "水篠 旬" } },
                orTrash: true,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] アタック/ブロック時、自身BP以下の相手スピリット/アルティメット1体のコアすべてをリザーブへ。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxBpSource: "self_effective_bp",
                },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "reserve", player: "opponent" },
              amount: "all",
            },
          },
        ],
        textRef: [3, 4],
      },
      // [6,7] 自分の影/プレイヤーが効果対象になったとき、対象をこのスピリットのみに変更。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "targeted",
          triggerFilter: {
            category: ["spirit"],
            tribes: ["影", "プレイヤー"],
          },
        },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            action: {
              kind: "redirect_target",
              from: { kind: "trigger_related_instance" },
              to: { kind: "self" },
              mode: "all_current_effect_targets",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSSL01-R03",
    braveCondition: { cardNameContains: ["水篠 旬"] },
    combinedBoost: 4000,
    orikaId: 422,
    orikaIndex: 439,
    name: "光の破片の短剣",
    printedCategory: "brave",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1『このブレイヴの召喚時』",
      "〔ターンに1回:同名〕トラッシュにある系統：「影」/「プレイヤー」を持つカード1枚を手札に戻せる。",
      "",
      "【合体条件：「水篠 旬」】",
      "【合体中】『このスピリットのアタック時』",
      "自分の手札とデッキの上から合計2枚までを破棄できる。その中に系統：「影」/「プレイヤー」を持つカードがあるとき、自分のカウント7以上なら、このバトルの間、相手はリザーブからコストが支払えない。",
    ],
    keywordTags: [],
    tribe: "影",
    image: "images/BSSL01-R03.webp",
    rarity: "R",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] Lv1『このブレイヴの召喚時』〔ターンに1回:同名〕トラッシュの系統:「影」/「プレイヤー」を
      //   持つカード1枚を手札に戻せる。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: { tribes: ["影", "プレイヤー"], tribesLogic: "or" },
              count: 1,
              mandatory: true,
              destination: "hand",
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4,5] 【合体条件：「水篠 旬」】【合体中】『このスピリットのアタック時』
      //   自分の手札とデッキの上から合計2枚までを破棄できる。その中に系統:「影」/「プレイヤー」を持つ
      //   カードがあるとき、自分のカウント7以上なら、このバトルの間、相手はリザーブからコストが支払えない。
      //   「合計2枚まで」= 手札破棄(handDisc, 0..2の候補選択・discard count:{min:0,max:2})→
      //   残り予算をデッキ上部から(deckDisc, count:cards_from_ref(handDisc)を2から引いた
      //   step-level optionalQuantity 数量選択・fromZone:"deck" は不可視/位置固定の強制確定経路)。
      //   「その中に...があれば」= De Morgan 変形の OR (kind:"all",not:true で
      //   NOT(handDiscに一致無し AND deckDiscに一致無し) = いずれかに一致)。
      //   「相手はリザーブからコストが支払えない」= 新設 restrict_reserve_cost_payment primitive
      //   (ENGINE-restrict-reserve-cost-payment、restrict_advent と同型)。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        executionMode: "optional",
        steps: [
          {
            id: "handDisc",
            action: {
              kind: "discard",
              player: "self",
              count: { min: 0, max: 2 },
            },
          },
          {
            id: "deckDisc",
            action: {
              kind: "discard",
              player: "self",
              fromZone: "deck",
              count: {
                source: { kind: "cards_from_ref", stepId: "handDisc" },
                multiplier: -1,
                offset: 2,
              },
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "restrict_reserve_cost_payment",
              player: "opponent",
              duration: { scope: "battle" },
            },
            condition: [{ kind: "count_value", player: "self", min: 7 }],
            stepCondition: {
              kind: "all",
              not: true,
              conditions: [
                {
                  kind: "ref_has_match",
                  stepId: "handDisc",
                  filter: { tribes: ["影", "プレイヤー"], tribesLogic: "or" },
                  not: true,
                },
                {
                  kind: "ref_has_match",
                  stepId: "deckDisc",
                  filter: { tribes: ["影", "プレイヤー"], tribesLogic: "or" },
                  not: true,
                },
              ],
            },
          },
        ],
        textRef: [3, 4, 5],
      },
    ],
  },
  {
    cardNo: "BSSL01-T01",
    orikaId: 423,
    orikaIndex: 440,
    name: "影の兵士",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "このカードはデッキに入れられない。",
      "",
      "Lv1『このスピリットのアタック/破壊時』",
      "ターンに1回、相手のフィールドのコア1個をリザーブに置ける。または、自分の手札にある系統：「影」/「プレイヤー」を持つカード1枚を破棄することで、自分はデッキの上から1枚ドローする。",
    ],
    keywordTags: ["token"],
    tribe: "影",
    image: "images/BSSL01-T01.webp",
    rarity: "T",
    pack: "BSSL01 俺だけレベルアップな件",
    maxTokenDeckCount: 9,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // [2,3] Lv1『このスピリットのアタック/破壊時』〔ターンに1回〕
        //   相手のフィールドのコア1個をリザーブに置ける。または、自分の手札にある
        //   系統：「影」/「プレイヤー」を持つカード1枚を破棄することで、1枚ドローする。
        // choice[0]（デフォルト）= core_move、choice[1] = discard→(ref_choice+conditional_cost)draw。
        // discard 分岐は RequiredDiscardCost (legal-actions-types.ts, RequiredCoreMoveCost の破棄版)
        // で choice variant 単位に pre-gate される: 手札に系統:影/プレイヤーが1枚も無ければ
        // canPayRequiredDiscardCost が false を返し、この choiceIndex の legal action 自体を
        // 抑止する（10_rules/03c L53-L55「ことで」構文の双方向コスト完遂チェックを宣言前に適用）。
        timing: { kind: "card_event", event: ["attack", "destroy"] },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            id: "t01-choice",
            action: {
              kind: "core_move",
              from: { kind: "field", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
            choice: [
              {
                action: {
                  kind: "discard",
                  count: 1,
                  player: "self",
                  filter: { tribes: ["影", "プレイヤー"] },
                },
              },
            ],
          },
          {
            stepCondition: {
              kind: "ref_choice",
              stepId: "t01-choice",
              choiceIndex: 1,
            },
            action: { kind: "draw", count: 1 },
            connector: "conditional_cost",
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSSL01-X01",
    orikaId: 424,
    orikaIndex: 441,
    name: "影の君主 水篠 旬",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: ["purple", "purple", "purple"],
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
    printedOverCount: { minCount: 7, bpBonus: 8000 },
    overCount: { minCount: 7, bpBonus: 8000 },
    symbolColors: ["purple"],
    textLines: [
      "フラッシュ【契約煌臨：「水篠 旬」＆C5以上『お互いのターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "〔ターンに1回:同名〕相手のアタックステップ中、自分のトラッシュが5枚以上のとき、このカードは、《ソウルコア》をトラッシュに置いたものとして【契約煌臨】できる。",
      "",
      "Lv1-Lv2【影の軍団】『このスピリットの煌臨時』",
      "〔ターンに1回：【影の軍団】〕合計2体まで、自分のトークンの「影の兵士」をボイドからコア1個ずつまでを置いて出すか、手札/トラッシュ/煌臨元にある系統：「影」を持つスピリットカードをコストを支払わずに召喚できる。自分のカウント7以上のとき、この効果の対象を+1する。",
      "",
      "【OC条件：カウント7以上】",
      "【OC中＆煌臨中】Lv1-Lv2『このスピリットのアタック時』",
      "このスピリットのシンボルを紫シンボル3つに固定する。",
    ],
    keywordTags: ["advent"],
    tribe: "プレイヤー・主君",
    image: "images/BSSL01-X01.webp",
    rarity: "X",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSSL01-T01"],
    // [0,1] フラッシュ【契約煌臨：「水篠 旬」＆C5以上『お互いのターン』】= 煌臨宣言。
    // 煌臨は CardDefinition.adventData で宣言する（declare_advent は main 配線済み）。
    // 『お互いのターン』= main_and_flash で近似（双方のターンの main/flash 窓を許可。both_attack_step は
    //   アタックステップ限定で狭すぎ、own_attack_step は自ターン限定のため不適。main_and_flash が最も近い）。
    // adventVariant: contract。テキスト[1]「自分のスピリットに手札から重ねる」→ targetCategory: ["spirit"]、
    //   契約煌臨はソウルコアをトラッシュへ（テキスト[1]「トラッシュに置くことで」）→ soulCoreDest: "trash"。
    // 名前条件「水篠 旬」は AdventCondition.cardNames、「C5以上」は
    //   declareCondition count_value で表現（煌臨先コスト条件ではない）。
    // [3] 〔ターンに1回:同名〕相手のアタックステップ中、自分のトラッシュが5枚以上のとき、このカードは
    //   《ソウルコア》をトラッシュに置いたものとして【契約煌臨】できる（代替コスト煌臨）。
    //   adventData.alternateCostAdvent で表現（[0,1]の通常経路と対象条件/ソウルコア行き先を共有し、
    //   タイミング/宣言条件/ソウルコア消費のみ差し替える）。effects[] には現れない
    //   （adventData ヘッダと同型、cards:fidelity ADVENT_HEADER 特例と同じ扱い）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "水篠 旬" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "main_and_flash",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 5 }],
      alternateCostAdvent: {
        condition: [
          { kind: "cards_in_zone", player: "self", zone: "trash", min: 5 },
        ],
        timing: "opponent_attack_step",
      },
    },
    effects: [
      // [5,6] Lv1-Lv2【影の軍団】『このスピリットの煌臨時』〔ターンに1回:【影の軍団】〕合計2体まで、
      //   トークン「影の兵士」をボイドからコア配置で出すか、手札/トラッシュ/煌臨元の系統:「影」スピリットを
      //   コストなし召喚。自分のカウント7以上で対象+1。
      {
        timing: { kind: "card_event", event: "advent" },
        executionMode: "optional",
        // 2026-09-13 ユーザー裁定: X02による取得も含め、自分の【影の軍団】全体で共有。
        usageLimit: { kind: "per_group", duration: "turn" },
        limitGroupId: "影の軍団",
        steps: [
          {
            action: {
              kind: "split_field_entry_choice",
              // 合計2体、カウント7以上で3体 (ENGINE-sequential-slot-choice、
              // {source:count_value(self), divisor:7, offset:2, cap:3}
              // = 0-6件目:2、7件目以降:3(閾値クランプ))。
              totalCount: {
                source: { kind: "count_value", player: "self" },
                divisor: 7,
                offset: 2,
                cap: 3,
              },
              // トークン「影の兵士」をボイドからコア1個ずつまで置いて出す
              // (voidCoreMaxPerCard、target.count は split_field_entry_choice が
              // プレイヤー選択体数で上書きするため未使用)。
              tokenAction: {
                kind: "put",
                target: { kind: "from_token_pool", count: 1 },
                voidCoreMaxPerCard: 1,
              },
              // 手札/トラッシュ/煌臨元にある系統：「影」を持つスピリットカードをコストなし召喚
              // (target.count は split_field_entry_choice が具体カード集合で上書きするため未使用)。
              zoneAction: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: ["hand", "trash"],
                  includeAdventSource: true,
                  filter: { category: ["spirit"], tribes: ["影"] },
                  count: 1,
                },
                costModifier: "free",
              },
            },
          },
        ],
        textRef: [5, 6],
      },
      // [8,9]【OC条件:カウント7以上】【OC中＆煌臨中】Lv1-Lv2『このスピリットのアタック時』
      //   このスピリットのシンボルを紫シンボル3つに固定する。
      //   【OC中＆煌臨中】= count_value(self,min:7) AND self_state:advented（[5,6,7] と同型2条件AND）。
      //   「シンボルを紫3つに固定」= override_properties.symbols + symbolCountFixed + duration:{scope:"attack"}。
      //   旧stubは duration:{scope:"attack"} CE が battle_end で失効しない実装バグ
      //   (ENGINE-attack-scope-ce-expiry、legal-actions-shared.ts の
      //   removeExpiredContinuousEffects/recomputeContinuousEffects が scope:"battle" のみ処理し
      //   scope:"attack" を恒久 CE として素通りさせていた) を「表現不能」と誤認していたもの。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [
          { kind: "count_value", player: "self", min: 7 },
          { kind: "self_state", state: "advented" },
        ],
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: {
                symbols: ["purple", "purple", "purple"],
                symbolCountFixed: true,
              },
              duration: { scope: "attack" },
            },
          },
        ],
        textRef: [8, 9, 10],
      },
    ],
  },
  {
    cardNo: "BSSL01-X02",
    orikaId: 425,
    orikaIndex: 442,
    name: "真なる影の君主 水篠 旬",
    // 取得する【影の軍団】で使用するトークンも、このカードの効果候補に含める。
    relatedTokenCardNos: ["BSSL01-T01"],
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 10,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 15000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 18000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 22000,
      },
    ],
    printedOverCount: { minCount: 7, bpBonus: 13000 },
    overCount: { minCount: 7, bpBonus: 13000 },
    symbolColors: ["purple"],
    textLines: [
      "フラッシュ【超契約煌臨：「水篠 旬」＆契約スピリット＆C7以上『自分のターン』】",
      "〔ターンに1回:同名〕このカードを手札から魂状態/煌臨元を含む対象に重ねることで、自分の《ソウルコア》をこのスピリットに置く。",
      "",
      "このカードを【煌臨】するとき、手札/トラッシュにある系統：「プレイヤー」を持つカードを好きなだけ魂状態を含む煌臨元スピリットの下に追加できる。",
      "",
      "【OC条件：カウント7以上】",
      "【OC中＆煌臨中】Lv1-Lv2-Lv3",
      "このスピリットはこのスピリットの煌臨元にあるカード名の異なる「水篠 旬」すべての効果を得る。〔重複不可〕自分のスピリットすべてに紫シンボル1つを追加する。",
      "",
      "【OC中＆煌臨中】Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "このバトルの間、自分の系統：「影」を持つ効果は、相手の効果では防げない。",
    ],
    keywordTags: ["advent", "soul_state"],
    tribe: "主君・影",
    image: "images/BSSL01-X02.webp",
    rarity: "X",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【超契約煌臨：「水篠 旬」＆契約スピリット＆C7以上『自分のターン』】= 煌臨宣言。
    // 超契約煌臨は煌臨の変種（08a §3 契約系）。AdventData.adventVariant には専用値が無いため、対象列挙
    //   （魂状態の契約カードを含む）の観点で contract として扱う（getContractAdventTargets 経路）。
    // 『自分のターン』= own_turn。テキスト[1]「魂状態/煌臨元を含む対象に重ねる」→ targetCategory:
    //   ["spirit"]（このカードは spirit、契約スピリットに重ねる）+ includeAdventSourceTarget:true。
    //   テキスト[1]「自分のソウルコアを
    //   このスピリットに置く」はカード固有効果で標準ルール（契約煌臨のソウルコア消費先=トラッシュ）を
    //   上書きし、消費したソウルコアを煌臨後のこのカード自身に置く → soulCoreDest: "this_card"。
    // 名前条件「水篠 旬」は cardNames、「契約スピリット」は isContract、「C7以上」は
    //   declareCondition count_value で表現（煌臨先コスト条件ではない）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "水篠 旬" }],
        isContract: true,
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "this_card",
      adventVariant: "contract",
      includeAdventSourceTarget: true,
      declareUsageLimit: { kind: "per_card_name", duration: "turn" },
      declareCondition: [{ kind: "count_value", player: "self", min: 7 }],
      beforeAdventSourceAddition: {
        fromZones: ["hand", "trash"],
        filter: { tribes: ["プレイヤー"] },
        textRef: [3],
      },
    },
    effects: [
      // [5,6,7]【OC条件:カウント7以上】【OC中＆煌臨中】Lv1-Lv2-Lv3
      //   このスピリットは煌臨元のカード名の異なる「水篠 旬」すべての効果を得る。〔重複不可〕
      //   自分のスピリットすべてに紫シンボル1つを追加する。
      //   grant_effect 集約 variant（P3-99、native-ce-registration-handlers.ts
      //   executeRegisterGrantedEffectFromSource）。target:{kind:"self"} の煌臨元
      //   (adventSourceIdsOf、多重煌臨で BSSL01-C01/CX01/X01 等の旧ホストも flat に含む) を
      //   nameFilter:「水篠 旬」で絞り名前 dedupe した各定義の effects[] を、通常の
      //   grantedEffect 登録（誘発/起動権 variant 共に無改修で消費）へ展開する。
      //   symbol_add と別 effect に分離（下記 effects[1]）: 〔重複不可〕は原文で symbol_add
      //   文にのみ係る。grant_effect 集約側は usageLimit を持たず (子 CE 単位 dedup を
      //   grantedEffectChildKey で行う、native-ce-registration-handlers.ts 参照)、
      //   continuous-effect-rebuild.ts の isGrantEffectAggregatorDeclaration が host 単位の
      //   早期 skip をバイパスして毎 rebuild サイクル再実行する — 初回登録後に新しい煌臨元
      //   カードが追加されても次サイクルで新規子 CE として展開される
      //   (issues/P3-99_grant-effect-primitive.md §残留懸念、解消)。
      //   【OC中＆煌臨中】= count_value(self,min:7) AND self_state:advented（08a:34 表向き
      //   煌臨元≧1、BSRK01-X02 textRef[7,8] と同型2条件AND、10_rules/08a 参照）。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "count_value", player: "self", min: 7 },
          { kind: "self_state", state: "advented" },
        ],
        steps: [
          {
            action: {
              kind: "grant_effect",
              target: { kind: "self" },
              grantedEffectSource: {
                kind: "advent_source_effects",
                nameFilter: { contains: "水篠 旬" },
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6, 7],
      },
      // [5,6,7] 後段〔重複不可〕自分のスピリットすべてに紫シンボル1つを追加する
      //   （usageLimit:no_duplicate、10_rules/03c §〔重複不可〕= 同名ホストが複数いても
      //   シンボル付与は1回、symbol_add target:{filter, player:self, category:spirit,
      //   count:"all"}、BSLH01-X05 クォーツセット効果と同型）。上記 effects[1] (grant_effect
      //   集約) から分離: no_duplicate は毎サイクル再実行される集約側にかけると新規煌臨元の
      //   再展開自体を止めてしまうため、symbol_add 側にのみ付す。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "count_value", player: "self", min: 7 },
          { kind: "self_state", state: "advented" },
        ],
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: "all",
              },
              symbol: "purple",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6, 7],
      },
      // [9,10]【OC中＆煌臨中】Lv1-Lv2-Lv3『このスピリットのアタック時』
      //   このバトルの間、自分の系統:「影」を持つ効果は、相手の効果では防げない。
      //   engine-effect-prevention-immunity-tribes: grant_effect_source_prevention_immunity
      //   （player-scoped CE、duration:battle）で「今後発揮される」自分の効果のうち発生源
      //   カードの実効系統が「影」を含むものを宣言時に unpreventable へ動的昇格する。
      //   preventionRestriction（author-time・その効果自身にのみ付与）とは異なり、
      //   発生源カードの実効系統で照合する点が本質（対応スコープ: 誘発効果宣言時
      //   resolve_pending_triggered_effect、既存 grant_paid_prevention_immunity と同経路）。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [
          { kind: "count_value", player: "self", min: 7 },
          { kind: "self_state", state: "advented" },
        ],
        steps: [
          {
            action: {
              kind: "grant_effect_source_prevention_immunity",
              player: "self",
              sourceScope: { tribes: ["影"] },
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSSL01-X03",
    orikaId: 426,
    orikaIndex: 443,
    name: "ベリオン",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 10,
    reductionSymbols: ["purple", "purple", "purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 13000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 16000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 22000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "自分のカウント5以上のとき、手札/トラッシュ/煌臨元にあるこのカードをコスト5にする。",
      "",
      "フラッシュ",
      "〔ターンに1回:同名〕自分のカウント7以上のとき、自分の「水篠 旬」がいれば、手札/トラッシュ/煌臨元にあるこのカードは、召喚できる。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットを、自分の「水篠 旬」の煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない。さらに、〔重複不可〕自分のターン中、このスピリットがLv2以上の間、相手のスピリット/アルティメットすべてのLvコスト+2する。この「Lvコスト変更効果」は相手の効果で防げない。",
    ],
    keywordTags: [],
    tribe: "影・天霊",
    image: "images/BSSL01-X03.webp",
    rarity: "X",
    pack: "BSSL01 俺だけレベルアップな件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0]「自分のカウント5以上のとき、手札/トラッシュ/煌臨元にあるこのカードをコスト5にする」。
      //   盤面条件(カウント5以上)付きで複数ゾーン(手札/トラッシュ/煌臨元)にある自カードの
      //   召喚コストを固定する継続自己修飾。cost_modify 自己対象 modifier:{override:5}。
      //   cost-system.getEffectiveBaseCostOverride が card.effects 直接読みで applicability
      //   (zone:[hand,trash,advent_source])+condition(count_value≥5) を評価し、成立時に
      //   印字コスト6を5へ上書きする（軽減/floor/追加コストは override 後の値に適用。
      //   03a §コスト軽減下限 L22）。煌臨元は runtime Zone 上 "field" のままホストの下に
      //   重なるため、ApplicabilityZone に "advent_source" を追加し evaluateApplicability
      //   側で collectUnderCardScopeIds().adventSource による別チェックとして解決する。
      {
        applicability: { zone: ["hand", "trash", "advent_source"] },
        timing: { kind: "continuous" },
        condition: [{ kind: "count_value", player: "self", min: 5 }],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { override: 5 },
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ〔ターンに1回:同名〕「自分のカウント7以上のとき、自分の「水篠 旬」が
      //   いれば、手札/トラッシュ/煌臨元にあるこのカードは、召喚できる」。
      //   条件付き複数ゾーン(手札/トラッシュ/煌臨元)フラッシュ自己召喚起動効果
      //   (engine-advent-source-summon-permission)。applicability.zone に "advent_source" を
      //   追加し、getAvailableHandActivatedEffectLegalActions + collectUnderCardScopeIds
      //   ベースの候補列挙で煌臨元カードも起動効果 action 候補に合流する
      //   （[0]のコスト override と同じ zone 判定）。
      {
        applicability: { zone: ["hand", "trash", "advent_source"] },
        timing: { kind: "activated", mode: "flash" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        condition: [
          { kind: "count_value", player: "self", min: 7 },
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "水篠 旬" }],
            minCount: 1,
          },
        ],
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [5,6,7] Lv1-Lv2-Lv3 前段:「このスピリットが相手によってフィールドを離れるとき、自分の
      //   「水篠 旬」の煌臨元に追加するか、トラッシュに置く。この効果は相手の効果を受けない」。
      //   FieldExitReplacement の advent_source 変種 (engine batch2-2)。BSSL01-C02[2]/R02[1] と同型。
      {
        timing: { kind: "continuous" },
        preventionLevel: "immune",
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent",
              duration: { scope: "while_on_field" },
              replacement: {
                kind: "advent_source",
                target: { cardName: { contains: "水篠 旬" } },
                orTrash: true,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
      // [5,6,7] 後段「〔重複不可〕自分のターン中、このスピリットがLv2以上の間、相手の
      //   スピリット/アルティメットすべてのLvコスト+2する。この『Lvコスト変更効果』は相手の
      //   効果で防げない」。override_properties.levelCostDelta（Lv コスト加算修飾）を相手の
      //   スピリット/アルティメット全体（filter target = 動的メンバーシップ global CE）へ +2 する。
      //   発揮ゲートは timingScope『自分のターン』＋ min_level 2（このスピリットが Lv2 以上）。
      //   〔重複不可〕= usageLimit no_duplicate（同名コントローラー単位で 1 CE のみ活性、
      //   effect-interpreter.ts 継続効果 dedup、10_rules/03c §〔重複不可〕）。
      //   「相手の効果で防げない」= 効果原文がスコープ指定の無い blanket 防止不可のため
      //   preventionLevel:"unpreventable"（Effect 直配、derivePreventionLevel SSOT、10_rules/03c L27）。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "turn" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "no_duplicate" },
        preventionLevel: "unpreventable",
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
              },
              properties: { levelCostDelta: 2 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
];
