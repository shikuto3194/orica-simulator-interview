import type { CardDefinition } from "@orica/rules-core";

export const BSTH002_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH002-C01",
    orikaId: 24,
    orikaIndex: 14,
    name: "化け化け",
    printedCategory: "spirit",
    colors: ["purple"],
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
      {
        level: 3,
        requiredCores: 4,
        bp: 3000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "セットしている/手札にあるこのカードは、自分のセット可能枚数に数えない。この効果は重複せず、ターンに1回しか使えない。",
      "",
      "【ミラージュ：コスト2<紫>（このカードは手札からセットできる）】",
      "",
      "【セット中】『自分のメインステップ』",
      "ターンに1回、手札1枚を手元に置くことで、自分はデッキの上から1枚ドローする。この効果は、ターンに1回しか使えない。",
      "",
      "【セット中】",
      "自分が系統：「封魔」を持つカードの召喚/配置/使用、効果の使用をするとき、その軽減シンボル1つを満たす。",
    ],
    keywordTags: [],
    tribe: "幻想・封魔・無魔",
    image: "images/BSTH002-C01.webp",
    rarity: "C",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0] mirageData.exemptSetCountLimits で表現（ENGINE-mirage-set-count-exemption、
    //   BSDB01-R04 canSetFromTrash 同様 effects エントリ不要）。[2]【ミラージュ：コスト2<紫>】
    //   も mirageData.cost/reduction で表現。
    mirageData: { cost: 2, reduction: ["purple"], exemptSetCountLimits: true },
    effects: [
      // [4,5]【セット中】『自分のメインステップ』ターンに1回、手札1枚を手元に置くことで
      // デッキの上から1枚ドロー。BSGE01-C03 と同型 (timing:activated mode:"main" +
      // applicability.zone:["mirage_set"] + move_card→draw conditional_cost)。
      // 「手札1枚」= 印字フィルタ無しのため player 選択 (target:{kind:"filter"})。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        applicability: { zone: ["mirage_set"] },
        // 「ターンに1回」(発揮元個体ごと) と「この効果は、ターンに1回しか
        // 使えない」(同名共有) は独立して併記されている。前者を後者へ縮約しない。
        usageLimit: [
          { kind: "per_instance", duration: "turn" },
          { kind: "per_card_name", duration: "turn" },
        ],
        steps: [
          {
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "self",
                zone: "hand",
                filter: {},
                count: 1,
              },
              from: { zone: "hand", player: "self" },
              to: { zone: "set_aside", player: "self" },
              count: 1,
            },
          },
          {
            action: { kind: "draw", count: 1 },
            connector: "conditional_cost",
          },
        ],
        textRef: [4, 5],
      },
      // [7,8]【セット中】自分が系統：「封魔」を持つカードの召喚/配置/使用、効果の使用を
      // するとき、その軽減シンボル1つを満たす。BSTH09.2-転醒R03(A) effects[2] と同型
      // (treat_as reduction_symbol + whenPayingForFilter.tribes + waivesReductionRequirement:true。
      // whenUsingEffectMode 未指定のため召喚/配置/使用/効果の使用いずれの支払い文脈にも適用)。
      {
        timing: { kind: "continuous" },
        applicability: { zone: ["mirage_set"] },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["reduction_symbol"],
              whenPayingForFilter: { tribes: ["封魔"] },
              waivesReductionRequirement: true,
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSTH002-C02",
    orikaId: 25,
    orikaIndex: 15,
    name: "里香",
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
        bp: 4000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個を自分のリザーブに置ける。自分のデッキを上から3枚オープンできる。その中の系統：「封魔」を持つミラージュ効果を持つカード1枚と、カード名：「里香」/「呪い子」以外の系統：「封魔」を持つカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2",
      "このスピリットのシンボルは紫としても扱う。このスピリットは、相手のネクサスの効果を受けない。",
    ],
    keywordTags: [],
    tribe: "幻想・封魔・職人",
    image: "images/BSTH002-C02.webp",
    rarity: "C",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『召喚時』ボイドからコア1個をリザーブへ。デッキ3オープン、封魔ミラージュ1枚と里香/呪い子以外の封魔1枚を手札。残りデッキ下。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
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
                  filter: { tribes: ["封魔"], hasMechanic: ["mirage"] },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    tribes: ["封魔"],
                    exclude: {
                      cardName: [{ exact: "里香" }, { exact: "呪い子" }],
                    },
                  },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2 シンボルは紫としても扱う。相手のネクサスの効果を受けない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: false,
              aspects: ["symbol"],
              asColor: "purple",
            },
          },
        ],
        textRef: [3, 4],
      },
      // 「相手のネクサスの効果を受けない」(発生源カテゴリ限定)。
      // sourceScope.categories=["nexus"] で発生源が相手のネクサスのときのみ免疫成立。
      // 発生源は実効カテゴリ (getEffectiveCategory) で照合 (immunitySourceScope, 10_rules/03c)。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { categories: ["nexus"] },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH002-C03",
    orikaId: 26,
    orikaIndex: 16,
    name: "呪い子",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple", "white"],
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
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の系統：「封魔」を持つミラージュ効果を持つカード1枚と、カード名：「里香」/「呪い子」以外の系統：「封魔」を持つカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットのシンボルは白としても扱う。このスピリットは、相手のネクサスの効果を受けない。",
    ],
    keywordTags: [],
    tribe: "幻想・封魔・無魔",
    image: "images/BSTH002-C03.webp",
    rarity: "C",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』デッキ3オープン、封魔ミラージュ1枚と里香/呪い子以外の封魔1枚を手札。残りデッキ下。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: { tribes: ["封魔"], hasMechanic: ["mirage"] },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    tribes: ["封魔"],
                    exclude: {
                      cardName: [{ exact: "里香" }, { exact: "呪い子" }],
                    },
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
      // Lv1-Lv2-Lv3 シンボルは白としても扱う。相手のネクサスの効果を受けない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: false,
              aspects: ["symbol"],
              asColor: "white",
            },
          },
        ],
        textRef: [3, 4],
      },
      // 「相手のネクサスの効果を受けない」(発生源カテゴリ限定)。
      // sourceScope.categories=["nexus"] で発生源が相手のネクサスのときのみ免疫成立。
      // 発生源は実効カテゴリ (getEffectiveCategory) で照合 (immunitySourceScope, 10_rules/03c)。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { categories: ["nexus"] },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH002-C04",
    orikaId: 27,
    orikaIndex: 17,
    name: "封魔録三面道中",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple", "white"],
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
      "【ミラージュ：コスト2<紫>（このカードは手札からセットできる）】",
      "",
      "【セット中】『このカードのセット時』",
      "自分はデッキの上から1枚ドローする。",
      "",
      "【セット中】",
      "お互い、ボイドからコアをライフに置けない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分はデッキの上から1枚ドローできる。",
    ],
    keywordTags: [],
    tribe: "幻想・封魔・無魔",
    image: "images/BSTH002-C04.webp",
    rarity: "C",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【ミラージュ：コスト2<紫>】は mirageData 宣言（BSGE01-C04 同型precedent）。
    mirageData: { cost: 2, reduction: ["purple"] },
    effects: [
      // 【セット中】お互い、ボイドからコアをライフに置けない。
      // restrict_core_placement(scope:"to_life", fromZone:"void", duration:"while_set") で表現
      // （fromZone は「ライフにコアを置けない」全面禁止 (BSTH02.7-C01) と区別する新設 field。
      // 原文の禁止対象は「ボイドから」限定で移動元不問の全面禁止ではないため既存 scope 未使用値
      // を再利用せず fromZone で絞る、ENGINE-restrict-core-placement-from-zone）。
      {
        timing: { kind: "continuous" },
        applicability: { zone: ["mirage_set"] },
        steps: [
          {
            action: {
              kind: "restrict_core_placement",
              player: "either",
              duration: { scope: "while_set" },
              scope: "to_life",
              fromZone: "void",
            },
          },
        ],
        textRef: [0, 5, 6],
      },
      // 【セット中】『このカードのセット時』自分はデッキの上から1枚ドローする(強制)。
      // ENGINE-mirage-set-card-event-trigger で新設した card_event "mirage_set" で表現。
      {
        timing: { kind: "card_event", event: "mirage_set" },
        applicability: { zone: ["mirage_set"] },
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [0, 2, 3],
      },
      // Lv1-Lv2-Lv3『このスピリットの召喚時』自分はデッキの上から1枚ドローできる。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSTH002-C05",
    orikaId: 28,
    orikaIndex: 18,
    name: "封魔録三面 固定砲台",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "【ミラージュ：コスト3<白>（このカードは手札からセットできる）】",
      "",
      "【セット中】『自分のメインステップ』",
      "系統：「封魔」を持つ自分のコスト3以上のスピリットが召喚されたとき、相手のスピリット/アルティメット1体を手札に戻せる。",
      "",
      "Lv1『相手のターン』",
      "相手の効果によって相手の手札が増えたとき、増えたカード1枚につき、相手は相手の手札1枚を破棄する。この効果で相手の手札は0にならない。",
    ],
    keywordTags: [],
    tribe: "幻想・封魔",
    image: "images/BSTH002-C05.webp",
    rarity: "C",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【ミラージュ：コスト3<白>】は mirageData 宣言（BSTH002-C04 / BSGE01-C04 同型precedent）。
    mirageData: { cost: 3, reduction: ["white"] },
    effects: [
      // 【セット中】『自分のメインステップ』自分の封魔コスト3以上スピリット召喚時、
      // 相手スピリット/アルティメット1体を手札に戻せる。
      // game_event:summon + triggerFilter(category/spirit + tribes + minCost) と
      // applicability.zone:["mirage_set"] でミラージュセット中だけ反応。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "summon",
          triggerFilter: {
            category: ["spirit"],
            tribes: ["封魔"],
            minCost: 3,
          },
        },
        timingScope: { player: "self", period: "main" },
        applicability: { zone: ["mirage_set"] },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [0, 2, 3],
      },
      // Lv1『相手のターン』相手の効果で手札が増えたとき、増えた枚数分 相手は手札を破棄（0にならない）。
      // BSLH01-C10(BSLH01.ts:1478-1507) と同型 (draw step 無し版)。game_event:increase_hand +
      // cause:[self_effect] + turn_player:opponent 条件。discard count/capCount を event_amount
      // 参照にすることで「増えた枚数分」「手札は0にならない」を同時に表現する。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "increase_hand",
          cause: ["self_effect"],
        },
        executionMode: "mandatory",
        condition: [{ kind: "turn_player", player: "opponent" }],
        steps: [
          {
            action: {
              kind: "discard",
              player: "opponent",
              count: { source: { kind: "event_amount" } },
              targetHandSize: 1,
              capCount: { source: { kind: "event_amount" } },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH002-M01",
    orikaId: 29,
    orikaIndex: 19,
    name: "戦車むすめのみるゆめ",
    printedCategory: "magic",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "purple"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュにあるこのカードは、一切の効果を受けない。",
      "このカードは、系統：「幻想」/「封魔」を持つ。",
      "",
      "フラッシュ",
      "このバトルの間、自分のライフは0にならず、バトル終了時、アタックステップを終了する。",
      "",
      "スタック",
      "相手のスピリット/アルティメット1体を手札に戻す。この効果は、お互いのアタックステップしか使えない。",
    ],
    keywordTags: [],
    tribe: "幻想・封魔",
    image: "images/BSTH002-M01.webp",
    rarity: "M",
    pack: "BSTH002 東方封魔録",
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
      // このカードは、系統：「幻想」/「封魔」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "封魔"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [1],
      },
      // フラッシュ：このバトル中、自分ライフは0にならず、バトル終了時アタックステップ終了。
      // 前段=ライフ下限保護 life_damage_interception(floor:1, battle scope)、
      // 後段=バトル終了時に end_attack_step を deferTo:battle_end で発火。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "floor",
              floor: 1,
              duration: { scope: "battle" },
            },
          },
          { action: { kind: "end_attack_step" }, deferTo: "battle_end" },
        ],
        textRef: [3, 4],
      },
      // スタック：相手のスピリット/アルティメット1体を手札に戻す。（お互いのアタックステップ限定）
      {
        timing: { kind: "activated", mode: "stack" },
        // この効果は『お互いのアタックステップ』しか使えない（textLine[7]）。
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH002-M02",
    orikaId: 30,
    orikaIndex: 20,
    name: "Complete Darkness",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "purple", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「封魔」を持つ。",
      "",
      "フラッシュ",
      "疲労状態の相手のスピリット1体を破壊する。または、疲労状態の相手のアルティメット1体をデッキの下に戻す。",
      "",
      "スタック",
      "最低Lvコスト1の相手のスピリット/アルティメット2体のコアが1個ずつになるようにリザーブに置く。この効果は、お互いのアタックステップにしか使えない。",
    ],
    keywordTags: [],
    tribe: "幻想・封魔",
    image: "images/BSTH002-M02.webp",
    rarity: "M",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」/「封魔」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "封魔"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ：疲労状態の相手スピリット1体を破壊、または疲労状態の相手アルティメット1体をデッキ下へ。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            // choiceIndex 0 = スピリット破壊, 1 = アルティメットをデッキ下へ
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], exhaustState: "exhausted" },
                count: 1,
              },
            },
            choice: [
              {
                action: {
                  kind: "send_to_deck",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: {
                      category: ["ultimate"],
                      exhaustState: "exhausted",
                    },
                    count: 1,
                  },
                  position: "bottom",
                },
              },
            ],
          },
        ],
        textRef: [2, 3],
      },
      // スタック：最低Lvコスト1の相手2体のコアが1個ずつになるようリザーブへ（お互いのアタックステップ限定）。
      // BSGE01-C16 と同型: 対象1体ずつ独立解決する repeat（additional:1）+ cores_on(target_card)-1。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  lv1RequiredCores: 1,
                },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "reserve", player: "opponent" },
              amount: {
                source: { kind: "cores_on", location: { kind: "target_card" } },
                offset: -1,
              },
            },
            repeat: { additional: 1, allowDuplicateTargets: false },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH002-R01",
    orikaId: 31,
    orikaIndex: 21,
    name: "明羅",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "purple"],
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
    symbolColors: ["white"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "相手のネクサス/創界神ネクサス1つをデッキの下に戻せる。",
      "",
      "Lv1-Lv2-Lv3『相手のターン』",
      "回復状態のこのスピリットは、相手のスピリット/ネクサスの効果を受けない。相手の効果で相手の手札が増えたとき、自分はデッキの上から1枚ドローするか、ボイドからコア1個を自分のリザーブに置く。",
      "",
      "Lv2-Lv3『自分のメインステップ』",
      "自分の創界神ネクサス/導界者ネクサスがないとき、このスピリットに紫のシンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "幻想・封魔・戦姫",
    image: "images/BSTH002-R01.webp",
    rarity: "R",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』相手のネクサス/創界神ネクサス1つをデッキの下に戻せる。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"], targetsGrandwalker: true },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3『相手のターン』回復状態のこのスピリットは、相手のスピリット/ネクサスの
      // 効果を受けない。self_state:"recovered" + turn_player:"opponent" condition で
      // 回復状態かつ相手ターン中だけ effect_immunity(sourceScope:categories) を継続登録する
      // (BSTH002-R01 自身の紫シンボル効果 [textRef 6,7] と同型の continuous+condition パターン)。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "self_state", state: "recovered" },
          { kind: "turn_player", player: "opponent" },
        ],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              sourceScope: { categories: ["spirit", "nexus"] },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2-Lv3『相手のターン』相手の効果で相手の手札が増えたとき、自分はデッキの上から
      // 1枚ドローするか、ボイドからコア1個を自分のリザーブに置く。BSTH002-C05 (同ファイル
      // 上記effects[1]) と同型の game_event:increase_hand + cause:["self_effect"] トリガー。
      // draw/core_move choice は BSSA01.ts [9] と同型 (choice ステップは effect レベルへ昇格)。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "increase_hand",
          cause: ["self_effect"],
        },
        executionMode: "mandatory",
        condition: [{ kind: "turn_player", player: "opponent" }],
        steps: [
          {
            action: { kind: "draw", player: "self", count: 1 },
            choice: [
              {
                action: {
                  kind: "core_move",
                  from: { kind: "void", player: "self" },
                  to: { kind: "reserve", player: "self" },
                  amount: 1,
                },
              },
            ],
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3『自分のメインステップ』創界神/導界者ネクサスがないとき、紫シンボル1つを追加。
      // ルーミア型の継続効果。activated + permanent だと起動毎に永続シンボルが累積するため continuous 化。
      // Lv 判定は applicability へ、field_lacks は condition に残す。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { level: { min: 2, max: 3 } },
        condition: [
          { kind: "field_lacks", player: "self", grandwalkerKind: "any" },
        ],
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "purple",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH002-R02",
    orikaId: 32,
    orikaIndex: 22,
    name: "ふらわ～戦車",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white", "purple"],
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
      "このカードは、系統：「封魔」を持つ。",
      "【ミラージュ：コスト3<白><紫>（このカードは手札からセットできる）】",
      "",
      "【セット中】",
      "お互い、ライフは増やせず、1ターンに1つしか減らない。自分のライフが減ったターンのエンドステップにこのカードを破棄する。",
      "",
      "Lv1-Lv2『自分のターン』",
      "このネクサスに紫シンボル1つを追加する。",
      "",
      "Lv2",
      "このネクサスがフィールドを離れるとき、自分のデッキを上から2枚トラッシュに置くことでフィールドに残る。",
    ],
    keywordTags: [],
    tribe: "封魔",
    image: "images/BSTH002-R02.webp",
    rarity: "R",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【ミラージュ：コスト3<白><紫>】は mirageData 宣言（BSGE01-C01 同型）。通常配置コスト
    // (cost:4, reductionSymbols:白白紫) とは別枠のミラージュ専用コスト。
    mirageData: { cost: 3, reduction: ["white", "purple"] },
    effects: [
      // このカードは、系統：「封魔」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["封魔"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // 【セット中】お互い、ライフは増やせず(life_gain_prevention)、1ターンに1つしか
      // 減らない(life_damage_interception mode:"turn_cap" cap:1、裁定2026-06-15
      // 10_rules/05 §ライフ減少の上限キャップ)。「お互い」は self/opponent の2entry分割
      // (BSLH01-C11 先例)。duration:while_set は mirage_set 滞在中限定 (BSGE01-C01 同型)。
      {
        timing: { kind: "continuous" },
        applicability: { zone: ["mirage_set"] },
        steps: [
          {
            action: {
              kind: "life_gain_prevention",
              player: "self",
              duration: { scope: "while_set" },
            },
          },
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "turn_cap",
              cap: 1,
              duration: { scope: "while_set" },
            },
          },
        ],
        textRef: [1, 3, 4],
      },
      {
        timing: { kind: "continuous" },
        applicability: { zone: ["mirage_set"] },
        steps: [
          {
            action: {
              kind: "life_gain_prevention",
              player: "opponent",
              duration: { scope: "while_set" },
            },
          },
          {
            action: {
              kind: "life_damage_interception",
              player: "opponent",
              cause: "any",
              mode: "turn_cap",
              cap: 1,
              duration: { scope: "while_set" },
            },
          },
        ],
        textRef: [1, 3, 4],
      },
      // 自分のライフが減ったターンのエンドステップにこのカードを破棄する。原文は
      // ターン主体を「自分の」に限定していない (自分/相手いずれのターンでも自分のライフが
      // 減ればそのターンの end_step で破棄) ため whose:"either" (BSLH01.ts:369 先例)。
      // life_reduced_this_turn (lifeReductionCappedThisTurn 再利用、上記 turn_cap CE が
      // 毎ターン無条件発揮中のため「1点でも減ったか」の判定として成立する)。
      {
        timing: { kind: "phase", step: "end", whose: "either" },
        applicability: { zone: ["mirage_set"] },
        condition: [{ kind: "life_reduced_this_turn", player: "self" }],
        steps: [
          {
            action: {
              kind: "move_card",
              target: { kind: "self" },
              from: { zone: "mirage", player: "self" },
              to: { zone: "trash" },
              count: 1,
              requireFullCount: true,
            },
          },
        ],
        textRef: [4],
      },
      // Lv1-Lv2『自分のターン』このネクサスに紫シンボル1つを追加する。
      // ルーミア型の継続効果。『自分のターン』なので timingScope period=turn。
      // activated + permanent だと起動毎に永続シンボルが累積するため continuous 化。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "turn" },
        applicability: { level: { min: 1, max: 2 } },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "purple",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
      // Lv2 このネクサスが離れるとき、デッキ2枚トラッシュでフィールドに残る。
      {
        executionMode: "optional",
        timing: { kind: "card_event", event: "leave_field" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "self", position: "top" },
              to: { zone: "trash" },
              count: 2,
              requireFullCount: true,
            },
          },
          {
            action: { kind: "stay_on_field", target: { kind: "self" } },
            connector: "conditional_cost",
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSTH002-R03",
    orikaId: 33,
    orikaIndex: 23,
    name: "魔天使",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "white"],
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
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "相手のネクサス/創界神ネクサス1つを破壊できる。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットが相手によってフィールドを離れるとき、ボイドからコア2個を自分のリザーブに置くか、自分はデッキの上から2枚ドローする。",
      "",
      "Lv2-Lv3 フラッシュ",
      "このスピリットを疲労させることで、ボイドからコア1個を自分のリザーブに置くか、自分はデッキの上から1枚ドローする。この効果は、ターンに1回しか使えない。",
    ],
    keywordTags: [],
    tribe: "幻想・封魔・無魔",
    image: "images/BSTH002-R03.webp",
    rarity: "R",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』相手のネクサス/創界神ネクサス1つを破壊できる。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"], targetsGrandwalker: true },
                count: 1,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3 相手による離脱時、ボイドからコア2個をリザーブ、または2枚ドロー。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        steps: [
          {
            // choiceIndex 0 = ボイド→リザーブ2, 1 = 2ドロー
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
            choice: [{ action: { kind: "draw", count: 2 } }],
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3 フラッシュ：疲労させ、ボイドからコア1個をリザーブ、または1ドロー。ターン1回。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          { action: { kind: "exhaust", target: { kind: "self" } } },
          {
            connector: "conditional_cost",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
            choice: [{ action: { kind: "draw", count: 1 } }],
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH002-X01",
    orikaId: 34,
    orikaIndex: 24,
    name: "里香(EX)＆イビルアイΣ",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 7,
    reductionSymbols: ["white", "white", "white", "purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 13000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 16000,
      },
    ],
    symbolColors: ["white", "white"],
    textLines: [
      "【転召：1／幻想＆コスト3以上／ボイド】",
      "召喚コスト支払い後、対象の自分のスピリット1体の上のコアすべて（最低1個）をボイドに置かなければならない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "自分の手札にあるミラージュ効果を持つ白/紫のカード1枚をコストを支払わずにセットすることで、相手のスピリット/アルティメット2体までをデッキの下に戻し、ターンに1回、このスピリットは回復できる。この効果は白以外の効果では防げない。",
      "",
      "Lv2-Lv3『自分のターン』",
      "このスピリットは相手の効果を受けない。",
    ],
    keywordTags: [],
    tribe: "幻想・封魔・戦姫",
    image: "images/BSTH002-X01.webp",
    rarity: "X",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【転召：1／幻想＆コスト3以上／ボイド】召喚コスト支払い後、対象スピのコア全をボイドへ。
    // 召喚時効果ではなく召喚手順内ステップ（裁定 2026-06-14, 10_rules/07b）。対象不在なら召喚宣言不可。
    tenshoSummon: {
      targetFilter: {
        category: ["spirit"],
        tribesRequired: ["幻想"],
        minCost: 3,
      },
      minCores: 1,
      destination: "void",
    },
    effects: [
      // Lv1-Lv2-Lv3『アタック時』手札のミラージュ白/紫1枚をコスト無しセットすることで、
      // 相手2体までデッキ下＋ターン1回回復できる。選択→無償セット→conditional_cost
      // により、対象不在時はミラージュセットを含めて不発に戻す。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        preventionRestriction: {
          onlyPreventableByColors: ["white"],
          colorMatchMode: "exact",
        },
        steps: [
          {
            id: "selectMirage",
            action: {
              kind: "noop",
              target: {
                kind: "filter",
                player: "self",
                zone: "hand",
                filter: { colors: ["white", "purple"], hasMirageData: true },
                count: { min: 0, max: 1 },
              },
            },
          },
          {
            id: "mirage-cost",
            action: {
              kind: "set_self_as_mirage",
              target: { kind: "ref", stepId: "selectMirage" },
            },
          },
          {
            id: "rika-ex-bottom-deck-targets",
            stepCondition: { kind: "ref_executed", stepId: "mirage-cost" },
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: { min: 0, max: 2 },
              },
              position: "bottom",
            },
            connector: "conditional_cost",
            conditionalCostAlternativeStepIds: ["rika-ex-recover"],
          },
          {
            id: "rika-ex-recover",
            stepCondition: { kind: "ref_executed", stepId: "mirage-cost" },
            action: { kind: "recover", target: { kind: "self" } },
            executionMode: "optional",
            usageLimit: { kind: "per_instance", duration: "turn" },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3『自分のターン』このスピリットは相手の効果を受けない。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "turn_player", player: "self" },
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
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH002-転醒R01(A)",
    orikaId: 35,
    orikaIndex: 25,
    name: "魔界",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple", "white"],
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
      "Lv1-Lv2【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "自分の紫/白の効果で相手のカードがフィールドを離れたか、このネクサスが相手によってフィールドを離れるとき、このネクサスを裏返せる。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分は、手札1枚を破棄することで、デッキの上から1枚ドローする。",
      "",
      "Lv2『お互いのアタックステップ』",
      "コア1個以下の相手のスピリット/アルティメットはアタック/ブロックできない。",
    ],
    keywordTags: ["double_sided"],
    tribe: "幻想・封魔",
    image: "images/BSTH002-転醒R01(A).webp",
    rarity: "TR",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2【転醒：自分のカウント3以下】紫/白効果で相手離脱 or このネクサスが相手離脱時、裏返せる。
      //   OR の2分岐は player が異なるため (branch1=相手カードの離脱を観測、branch2=このネクサス
      //   自身の離脱を観測) 単一 timing では表現できず、同じ textRef を指す2つの effect entry に
      //   分ける（BSLH01-TR03(A) の filterOr は同一 player 内 OR のみ対応、今回は player 跨ぎ）。
      //   branch1: 「自分の紫/白の効果で相手のカードがフィールドを離れる」= 第三者(opponent)
      //   離脱観測 + triggerSourceFilter.colors（発生源カードの色）+ cause:opponent_effect
      //   （2人対戦では「相手カードの離脱が相手自身以外の効果由来」=自分の効果由来と同値、
      //   BSDB01-CX01 の tribesRequired 版と同型）+ sourceWhose:"either"
      //   （ENGINE-leave-field-third-party-opponent-source-whose、leave_field の
      //   actingPlayerId は離脱カードのコントローラ=相手を指すため既定 whose:"self" を明示解除）。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "leave_field",
          triggerSourceFilter: { colors: ["purple", "white"] },
          cause: ["opponent_effect"],
          sourceWhose: "either",
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [0, 1],
      },
      //   branch2: 「このネクサスが相手によってフィールドを離れる」= 自己 card_event leave_field
      //   （BSLH01-TR01(A) と同型、ENIGMA ゲート無し）。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [0, 1],
      },
      // Lv1-Lv2『このネクサスの配置時』手札1枚を破棄することで、デッキ1枚ドロー。
      {
        executionMode: "optional",
        timing: { kind: "card_event", event: "place" },
        steps: [
          { action: { kind: "discard", count: 1, player: "self" } },
          { action: { kind: "draw", count: 1 }, connector: "conditional_cost" },
        ],
        textRef: [3, 4],
      },
      // Lv2『お互いのアタックステップ』コア1個以下の相手はアタック/ブロックできない。
      //   コア数連動の継続的戦闘制限。target.count "all" + filter.maxCores:1 で動的フィルタ
      //   CE（targetFilter）として登録され、battle-availability が評価時点のコア数で判定する
      //   （後からコアが増減しても自動反映）。timingScope=both/attack でアタックステップ限定。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 2 } },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"], maxCores: 1 },
                count: "all",
              },
              restriction: ["attack", "block"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "現世",
      printedCategory: "nexus",
      colors: ["white"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 0,
        },
      ],
      symbolColors: ["white"],
      textLines: [
        "この面に裏返ったとき、フィールドに残りカウント+1する（ボイドからコア1個を自分のカウントエリアに置く）。",
        "",
        "Lv1『このネクサスの転醒時』",
        "自分のスピリット1体を指定する。そのスピリットは、このターン中に1回、フラッシュタイミングで回復できる。",
        "",
        "Lv1 スタック『自分のアタックステップ』",
        "ターンに1回、ブロック宣言する相手のスピリット1体を手札に戻せる。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想",
      image: "images/BSTH002-転醒R01(B).webp",
      rarity: "TR",
      pack: "BSTH002 東方封魔録",
      cardNo: "BSTH002-転醒R01(B)",
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1『このネクサスの転醒時』自分のスピリット1体を指定する。そのスピリットは、
        //   このターン中に1回、フラッシュタイミングで回復できる。
        //   = grant_effect 起動権 variant（P3-99 §3）。付与は「このターン中」指定の即時型持続
        //   （duration:turn）なので、付与元ネクサスが離脱しても当ターン中は残る（03b §付与の持続タイプ）。
        //   被付与スピリットは flash 起動効果として自身を recover（ターンに1回）。
        {
          timing: { kind: "card_event", event: "rebirth" },
          steps: [
            {
              action: {
                kind: "grant_effect",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
                duration: { scope: "turn" },
                grantedEffect: {
                  timing: { kind: "activated", mode: "flash" },
                  executionMode: "optional",
                  usageLimit: { kind: "per_instance", duration: "turn" },
                  // 親の転醒時効果とは別scopeの、被付与スピリット自身の起動権。
                  // constraint監査もこの本文を child Effect の回数制限へ帰属する。
                  textRef: [3],
                  steps: [
                    { action: { kind: "recover", target: { kind: "self" } } },
                  ],
                },
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5,6] Lv1 スタック『自分のアタックステップ』ターンに1回、ブロック宣言する
        //   相手のスピリット1体を手札に戻せる。
        {
          timing: { kind: "activated", mode: "stack" },
          timingScope: { player: "self", period: "attack" },
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [
            {
              action: {
                kind: "bounce",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"], battleState: "blocking" },
                  count: 1,
                },
              },
            },
          ],
          textRef: [5, 6],
        },
      ],
    },
  },
  {
    cardNo: "BSTH002-転醒X01(A)",
    orikaId: 36,
    orikaIndex: 26,
    name: "霧雨魔梨沙",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "white"],
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
        bp: 8000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、相手のフィールドのコア2個をリザーブに置ける。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "相手のスピリットを破壊/消滅させたとき、ターンに1回、相手のライフのコア1個をリザーブに置く。",
      "",
      "Lv1-Lv2-Lv3【転醒：自分のカウント5以下（転醒は同時に使えない）】",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットを裏返せる。",
    ],
    keywordTags: ["double_sided"],
    tribe: "幻想・封魔・導魔",
    image: "images/BSTH002-転醒X01(A).webp",
    rarity: "TX",
    pack: "BSTH002 東方封魔録",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚/アタック時』ターン1回、相手のフィールドのコア2個をリザーブへ。
      // 原文に per-card 分配制約（「N体1個ずつ」等）が無いため、core_move
      // from:field（filter省略=全フィールドカード対象）amount合計2で厳密に表現できる
      // （BSKB01-C03 とは異なりこのカードは近似ではなく完全実装。BSKB01-C03 は
      // 「2体1個ずつ」制約があり per-target 分配未配線のため stub 残存＝別ケース）。
      // 候補が複数枚（合計コア>amount）のときは analyzeCoreShootCandidates が
      // pendingCoreShootSelection を生成しプレイヤーが分配先を選ぶ
      // （BSTH001-X01 同型・単一候補/合計<=amount のみ自動解決）。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "field", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: 2,
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3『このスピリットのアタック時』相手スピを破壊/消滅させたとき、
      // ターン1回、相手ライフ1コアをリザーブへ。
      // BSTH01-X08 同型「アタック中スコープの即時効果」: 破壊/消滅を観測する誘発
      // (game_event:destroy / vanish) を in_battle:attacking でゲートする。
      // cause=[battle, opponent_effect]: 「効果で」限定が無いためバトル討ち取りも自分の破壊効果も
      // 対象（相手自身の自壊 self_effect は「自分が破壊した」に当たらず除外）。
      // deriveTriggerEventCauseFromPendingLeave は離脱カード(=相手, player:"opponent")自身の
      // コントローラ基準で cause を導出するため、「自分が」破壊した場合は causePlayerId(=自分)が
      // 離脱カードのコントローラ(相手)と異なる=opponent_effect 側になる (ENGINE-cause-polarity-
      // self-effect-opponent-effect-audit、adversarial verifier 2026-07-12 lens1/2/4 指摘の
      // 極性誤りパターンを本カードでも検出・修正)。
      // sourceWhose:"either": 同 family の actingPlayerId は「離脱した相手カードのコントローラ」
      // を指し、listener(このカード)自身のコントローラとは一致しないため、既定 whose:"self"
      // (getTriggeredEffectSourceUseBlockReason) では常に候補から除外される。player/cause で
      // 絞り込み済みのため明示的に外す (ENGINE-leave-field-third-party-opponent-source-whose 同型)。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: ["destroy", "vanish"],
          triggerFilter: { category: ["spirit"] },
          cause: ["battle", "opponent_effect"],
          sourceWhose: "either",
        },
        condition: [{ kind: "in_battle", state: "attacking" }],
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2-Lv3【転醒：自分のカウント5以下】相手による離脱時、裏返せる。
      //   転醒トリガー写像 (10_rules/08a §2 line 93): スピリットの相手離脱
      //   = card_event:leave_field cause:["opponent_effect","battle"]・
      //   condition count_value(max:5)・steps:[rebirth]。離脱トリガーでの転醒は
      //   executeRebirth が pendingLeave* 解除＋pendingLeaveEntities 除去で
      //   フィールドに残す (08a:83 + 04:14 離脱待機状態での置換)。
      //   正源例 BSTH03/06/09.2-転醒R01(A) (同型 nexus)、本カードは spirit 版。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 5 }],
        steps: [{ action: { kind: "rebirth", maxCount: 5 } }],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "魅魔",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 7,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 1,
          bp: 7000,
        },
        {
          level: 2,
          requiredCores: 3,
          bp: 11000,
        },
        {
          level: 3,
          requiredCores: 4,
          bp: 15000,
        },
      ],
      symbolColors: ["purple"],
      textLines: [
        "この面に裏返ったとき、フィールドに残りカウント+1する（ボイドからコア1個を自分のカウントエリアに置く）。",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』",
        "コア3個以下の相手のスピリット/アルティメット2体を破壊する。1体以上破壊したとき、相手のライフのコア1個をリザーブに置く。",
        "",
        "Lv2-Lv3『このスピリットのアタック時』",
        "自分の紫/白のカードをセットしているとき、ターンに1回、このスピリットは回復する。",
        "",
        "Lv3",
        "このスピリットに白のシンボル1つを追加する。",
      ],
      keywordTags: [],
      tribe: "幻想・封魔・導魔",
      image: "images/BSTH002-転醒X01(B).webp",
      rarity: "TX",
      pack: "BSTH002 東方封魔録",
      cardNo: "BSTH002-転醒X01(B)",
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』コア3個以下の相手の
        //   スピリット/アルティメット2体を破壊する。1体以上破壊したとき、
        //   相手のライフのコア1個をリザーブに置く。
        //   maxCores:3 で対象を「コア3個以下」に限定（soul 含む合計コア、engine batch2-1）。
        //   ref_succeeded（1枚以上処理された）が「1体以上破壊したとき」に対応。
        {
          timing: { kind: "card_event", event: ["rebirth", "attack"] },
          steps: [
            {
              id: "mima-destroy",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"], maxCores: 3 },
                  count: 2,
                },
              },
            },
            {
              action: {
                kind: "core_move",
                from: { kind: "life", player: "opponent" },
                to: { kind: "reserve", player: "opponent" },
                amount: 1,
              },
              connector: "conditional_result",
              stepCondition: {
                kind: "ref_succeeded",
                stepId: "mima-destroy",
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5,6] Lv2-Lv3『このスピリットのアタック時』自分の紫/白のカードをセットしているとき、
        //   ターンに1回、このスピリットは回復する。
        {
          timing: { kind: "card_event", event: "attack" },
          condition: [
            { kind: "min_level", value: 2 },
            {
              kind: "any_of",
              groups: [
                [
                  {
                    kind: "field_has",
                    player: "self",
                    zone: "burst",
                    colors: ["purple", "white"],
                    minCount: 1,
                  },
                ],
                [
                  {
                    kind: "field_has",
                    player: "self",
                    zone: "mirage",
                    colors: ["purple", "white"],
                    minCount: 1,
                  },
                ],
              ],
            },
          ],
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
          textRef: [5, 6],
        },
        // [8,9] Lv3 このスピリットに白のシンボル1つを追加する。
        {
          timing: { kind: "continuous" },
          condition: [{ kind: "min_level", value: 3 }],
          steps: [
            {
              action: {
                kind: "symbol_add",
                target: { kind: "self" },
                symbol: "white",
                duration: { scope: "permanent" },
              },
            },
          ],
          textRef: [8, 9],
        },
      ],
    },
  },
];
