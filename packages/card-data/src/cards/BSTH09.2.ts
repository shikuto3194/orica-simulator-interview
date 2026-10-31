import type { CardDefinition } from "@orica/rules-core";

export const BSTH09_2_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH09.2-C01",
    orikaId: 249,
    orikaIndex: 258,
    name: "[貸本屋の看板娘]本居 小鈴",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "green"],
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
    symbolColors: ["red"],
    textLines: [
      "このカード/スピリットのシンボルは緑としても扱う。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の系統：「起幻」を持つ赤/緑の導界者ネクサスカード1枚と系統：「幻想」と「起幻」を持つ赤/緑のカード1枚を手札に加える。残ったカードは、好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2",
      "相手のLv1のネクサスのシンボルを0にする。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想",
    image: "images/BSTH09.2-C01.webp",
    rarity: "C",
    pack: "BSTH09.2 東方求聞史記",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカード/スピリットのシンボルは緑としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: "green",
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『召喚時』デッキ3オープン、起幻の赤/緑導界者ネクサス1枚と幻想＆起幻の赤/緑カード1枚を手札。残りデッキ下。
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
                  filter: {
                    category: ["nexus"],
                    colors: ["red", "green"],
                    tribes: ["起幻"],
                    targetsGrandwalker: true,
                    hasMechanic: ["guided"],
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    colors: ["red", "green"],
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
        textRef: [2, 3],
      },
      // Lv1-Lv2 相手のLv1のネクサスのシンボルを0にする。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 1, max: 2 } },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"], minLevel: 1, maxLevel: 1 },
                count: "all",
              },
              properties: { symbols: [], symbolCountFixed: true },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH09.2-C02",
    orikaId: 250,
    orikaIndex: 259,
    name: "朱鷺子",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red", "green"],
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
      "相手のネクサスか、系統「起幻」を持たない相手の創界神ネクサス1つを破壊する。",
      "",
      "Lv1-Lv2-Lv3 フラッシュ",
      "このスピリットを疲労させることで、自分はデッキの上から1枚ドローする。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・空牙",
    image: "images/BSTH09.2-C02.webp",
    rarity: "C",
    pack: "BSTH09.2 東方求聞史記",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』相手のネクサスか、起幻を持たない相手の創界神ネクサス1つを破壊する。
      // 枝A: 通常ネクサス（grandwalker は既定除外）。枝B: 創界神/導界者ネクサスのみ。
      // exclude は枝B が拾った grandwalker のうち系統「起幻」を持つものを除く（枝A 通常ネクサスは
      // grandwalker でないため exclude にマッチせず、起幻通常ネクサスは破壊対象として残る）。
      // 「targetsGrandwalker:'only' + filterOr 枝」は BSTH05-X02 効果先例 (ENGINE-card-filter-grandwalker-exclusive)。
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["nexus"] },
                    { category: ["nexus"], targetsGrandwalker: "only" },
                  ],
                  exclude: {
                    category: ["nexus"],
                    targetsGrandwalker: "only",
                    tribesRequired: ["起幻"],
                  },
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3 フラッシュ：このスピリットを疲労させることで、デッキ1枚ドロー。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "exhaust", target: { kind: "self" } } },
          { action: { kind: "draw", count: 1 }, connector: "conditional_cost" },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH09.2-X01",
    orikaId: 251,
    orikaIndex: 260,
    name: "[導界者]森近 霖之助",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 2,
    reductionSymbols: ["green"],
    // Lv コアはカード画像 (orika-react images/BSTH09.2-X01.png) 直読: Lv1=0個 / Lv2=4個
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
      "◆対象の自分のスピリット/アルティメット/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、赤/緑としても扱う。",
      "",
      "【導技：4】Lv1-Lv2 フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回、このネクサスのコア4個をボイドに置く〕疲労状態のコスト8以下の相手のスピリット/アルティメット1体をデッキの下に戻す。",
      "",
      "【導域】Lv2『自分のアタックステップ』",
      "系統：「起幻」を持つ本来のコストが5以上の自分の赤/緑のスピリット/アルティメットのバトル終了時、相手のライフのコア1個をリザーブに置く。この効果は重複しない。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    // 導界者ネクサス本体ルール (textLines[0]) と【導託：〔幻想＆コスト3以上〕〔転醒ネクサス〕】
    // 対象召喚/煌臨/配置時コア+1＋配置時デッキ上3枚トラッシュ標準文 (textLines[2-4]) は
    // grandwalkerData + oracle 基盤 (oracle-system) で表現（旧 stub effect は削除済み）。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        // 〔幻想＆コスト3以上〕は bullet1「対象の自分のスピリット/アルティメット/ネクサス」に
        // 合わせ categories で spirit/ultimate/nexus に限定（マジックカードを対象外にする）。
        {
          tribes: ["幻想"],
          minCost: 3,
          categories: ["spirit", "ultimate", "nexus"],
        },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ],
      // 【導技：4】Lv1-Lv2 フラッシュ『お互いのアタックステップ』〔ターンに1回、コア4個をボイドに置く〕。
      // 導技=神技扱い。コスト・ターン制限は divineSkills 経路でエンジン検査。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 4,
          timing: { step: "attack", whose: "both", mode: "flash" },
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          // 疲労状態のコスト8以下の相手スピリット/アルティメット1体をデッキの下へ。
          effects: [
            {
              textRef: [8, 9],
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "send_to_deck",
                    target: {
                      kind: "filter",
                      player: "opponent",
                      filter: {
                        category: ["spirit", "ultimate"],
                        maxCost: 8,
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
        },
      ],
    },
    tribe: "導界者・起幻",
    image: "images/BSTH09.2-X01.webp",
    rarity: "X",
    pack: "BSTH09.2 東方求聞史記",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2 このネクサスのシンボルは、赤/緑としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          { action: { kind: "treat_as", aspects: ["symbol"], asColor: "red" } },
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "green" },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【導技：4】(flash) は grandwalkerData.divineSkills で表現（上記参照）。
      // 【導域】Lv2『自分のアタックステップ』系統「起幻」本来コスト5以上の自分の赤/緑スピ/アルの
      //   バトル終了時、相手ライフコア1個をリザーブへ。重複しない。
      //   第三者 game_event:battle_end 観測 (BSTH001-C04 同型)。本来コスト判定は costBasis:"printed"。
      //   no_duplicate legal-actions-apply 経路は game-event-no-duplicate-multi-source.test.ts で検証済
      //   (ENGINE-no-duplicate-game-event-pending-e2e-test)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "battle_end",
          triggerFilter: {
            category: ["spirit", "ultimate"],
            colors: ["red", "green"],
            tribesRequired: ["起幻"],
            minCost: 5,
            costBasis: "printed",
          },
        },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "no_duplicate" },
        timingScope: { player: "self", period: "attack" },
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
        textRef: [11, 12],
      },
    ],
  },
  {
    cardNo: "BSTH09.2-XX01",
    orikaId: 252,
    orikaIndex: 261,
    name: "[導界者]稗田 阿求",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["red"],
    // Lv コアはカード画像 (orika-react images/BSTH09.2-XX01.png) 直読: Lv1=0個 / Lv2=4個
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
      "◆対象の自分のスピリット/アルティメット/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、赤/緑としても扱う。",
      "",
      "【導技：4】Lv1-Lv2『自分のメインステップ』",
      "〔このネクサスのコア4個をボイドに置く〕トラッシュにある系統：「幻想」を持つ赤/緑のスピリット/アルティメットカード1枚を召喚する。この効果はターンに1回しか使えない。",
      "",
      "【導域】Lv2",
      "系統：「起幻」を持つ本来のコストが5以上の自分の赤/緑のスピリット/アルティメットすべてに赤のシンボル1つを追加する。この効果は重複しない。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    // 導界者ネクサス本体ルール (textLines[0]) と【導託：〔幻想＆コスト3以上〕〔転醒ネクサス〕】
    // 対象召喚/煌臨/配置時コア+1＋配置時デッキ上3枚トラッシュ標準文 (textLines[2-4]) は
    // grandwalkerData + oracle 基盤 (oracle-system) で表現（旧 stub effect は削除済み）。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        // 〔幻想＆コスト3以上〕は bullet1「対象の自分のスピリット/アルティメット/ネクサス」に
        // 合わせ categories で spirit/ultimate/nexus に限定（マジックカードを対象外にする）。
        {
          tribes: ["幻想"],
          minCost: 3,
          categories: ["spirit", "ultimate", "nexus"],
        },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ],
      // 【導技：4】Lv1-Lv2『自分のメインステップ』〔コア4個をボイドに置く〕。
      // 文末「この効果はターンに1回しか使えない」は同名共有の制限。
      // 導技=神技扱い。コスト・ターン制限は divineSkills 経路でエンジン検査。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 4,
          timing: "main",
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once_per_name",
          // トラッシュの幻想の赤/緑スピリット/アルティメット1枚を召喚（効果召喚＝コスト支払いなし）。
          effects: [
            {
              textRef: [8, 9],
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    kind: "summon",
                    target: {
                      kind: "from_zone",
                      zone: "trash",
                      filter: {
                        category: ["spirit", "ultimate"],
                        colors: ["red", "green"],
                        tribes: ["幻想"],
                      },
                      count: 1,
                    },
                    costModifier: "free",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    tribe: "導界者・起幻・幻想",
    image: "images/BSTH09.2-XX01.webp",
    rarity: "XX",
    pack: "BSTH09.2 東方求聞史記",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2 このネクサスのシンボルは、赤/緑としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          { action: { kind: "treat_as", aspects: ["symbol"], asColor: "red" } },
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "green" },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【導技：4】(main) は grandwalkerData.divineSkills で表現（上記参照）。
      // 【導域】Lv2 起幻＆本来コスト5以上の赤/緑スピ/アルすべてに赤シンボル+1（重複しない）。
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
                  category: ["spirit", "ultimate"],
                  colors: ["red", "green"],
                  tribes: ["起幻"],
                  minCost: 5,
                  costBasis: "printed",
                },
                count: "all",
              },
              symbol: "red",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
  {
    cardNo: "BSTH09.2-転醒R01(A)",
    orikaId: 253,
    orikaIndex: 262,
    name: "[捕らぬ狸]二ツ岩 マミゾウ",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green", "red"],
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
    symbolColors: ["green"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚/アタック時』",
      "ボイドからコア1個をこのスピリットに置ける。",
      "",
      "Lv1-Lv2",
      "このスピリットのシンボルは、赤としても扱う。",
      "",
      "Lv2【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "スピリット/アルティメットが疲労したか、このスピリットが相手によってフィールドを離れるとき、このスピリットを裏返せる。",
    ],
    keywordTags: ["double_sided"],
    tribe: "起幻・幻想・剣獣",
    image: "images/BSTH09.2-転醒R01(A).webp",
    rarity: "TR",
    pack: "BSTH09.2 東方求聞史記",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『召喚/アタック時』ボイドからコア1個をこのスピリットに置ける。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
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
        textRef: [0, 1],
      },
      // Lv1-Lv2 このスピリットのシンボルは、赤としても扱う。
      // 「このスピリットの」= 場のスピリット状態に限定 (手札/カード状態には適用しない)。
      // appliesToCard:true は「このカード」スコープ (手札含む) の継続効果用。本効果は印字
      // 「このスピリット」のためスピリット状態限定で appliesToCard を付けない。
      // (verifier 2026-06-24 round 1 lens 1: appliesToCard:true を手札にも赤シンボルとして
      //  漏らす silent regression として refute)
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "red",
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2【転醒：自分のカウント3以下】スピリット/アルティメットが疲労したか、
      //   このスピリットが相手によってフィールドを離れるとき、このスピリットを裏返せる。
      //   転醒トリガーは誘発（game_event:exhaust / card_event:leave_field）。いずれも
      //   count_value max:3 でゲートし rebirth ステップが flip する。このカードは
      //   スピリットなので「相手によって離れる」は相手効果（opponent_effect）に加え
      //   相手アタックによるバトル破壊（battle）も含む。leave_field 経路は executeRebirth
      //   が pendingLeave を解除しフィールドに残す（08a:83 + 04:14 離脱待機状態での置換）。
      //   印字「Lv2【転醒...】」のため宣言時に min_level:2 必須。同じアタック時/疲労時の
      //   同時誘発解決中にLv2になれば発揮できる（公式Q30857）。完了した疲労は再利用しない。
      {
        timing: {
          kind: "game_event",
          player: "either",
          event: "exhaust",
          triggerFilter: { category: ["spirit", "ultimate"] },
        },
        executionMode: "optional",
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "count_value", player: "self", max: 3 },
        ],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [6, 7],
      },
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "count_value", player: "self", max: 3 },
        ],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "[ディスガイザー]二ツ岩 マミゾウ",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 6,
      reductionSymbols: [],
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
      symbolColors: ["green"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』",
        "相手のスピリット/アルティメット1体を重疲労させる。この効果で疲労したスピリットは『リフレッシュステップ』で回復できない。",
        "",
        "Lv2-Lv3",
        "このスピリットは、BP比べでは破壊されない。",
        "",
        "Lv3『このスピリットのアタック時』",
        "バトル終了時、ターンに1回、このスピリットは回復する。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想・剣獣",
      image: "images/BSTH09.2-転醒R01(B).webp",
      rarity: "TR",
      pack: "BSTH09.2 東方求聞史記",
      cardNo: "BSTH09.2-転醒R01(B)",
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』相手のスピリット/
        //   アルティメット1体を重疲労させる。
        // 重疲労と、疲労させたスピリットに残るリフレッシュ時限定の回復禁止は別処理。
        {
          timing: { kind: "card_event", event: ["rebirth", "attack"] },
          steps: [
            {
              id: "r01-heavy-exhaust",
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
            {
              connector: "sequential",
              action: {
                kind: "restrict_recovery",
                player: "opponent",
                target: {
                  kind: "filter",
                  player: "opponent",
                  stepId: "r01-heavy-exhaust",
                  filter: { category: ["spirit"] },
                  count: "all",
                },
                duration: { scope: "while_target_on_field" },
                timingScope: { player: "both", period: "refresh" },
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5,6] Lv2-Lv3 このスピリットは、BP比べでは破壊されない。
        // バトルの BP比べ (queueBattleResolutionDestroys) と効果の bp_compare_destroy の
        // 両 BP比較破壊サイトで cannot_be_destroyed_by_bp_compare CE を参照して阻止する。
        // 通常の効果破壊・離脱には影響しない (04_state-based-rules.md §BP比べ破壊)。
        {
          timing: { kind: "continuous" },
          condition: [{ kind: "min_level", value: 2 }],
          steps: [
            {
              action: {
                kind: "effect_resistance",
                target: { kind: "self" },
                resistsOutcome: "bp_compare_destroy",
                source: "all",
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5, 6],
        },
        // [8,9] Lv3『このスピリットのアタック時』バトル終了時、ターンに1回、回復する。
        {
          timing: {
            kind: "card_event",
            event: "attack",
            deferredTo: "battle_end",
          },
          condition: [{ kind: "min_level", value: 3 }],
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
          textRef: [8, 9],
        },
      ],
    },
  },
  {
    cardNo: "BSTH09.2-転醒R03(A)",
    orikaId: 4,
    orikaIndex: 263,
    name: "幻想郷",
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
        requiredCores: 1,
        bp: 0,
      },
    ],
    symbolColors: [],
    textLines: [
      "Lv1-Lv2【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "ライフが減ったか、このネクサスが相手によってフィールドを離れるとき、このネクサスに《ソウルコア》を置いて裏返せる。",
      "",
      "Lv1-Lv2",
      "自分が系統：「幻想」/「導界者」を持つカードを召喚/配置/使用するとき、その軽減シンボル1つを満たす。",
      "",
      "Lv2『自分のアタックステップ』",
      "系統：「起幻」を持つ自分のスピリット/アルティメットがアタックしている間、相手のコスト6以下のバースト効果を無効にする。",
    ],
    keywordTags: ["burst", "double_sided"],
    tribe: "起幻・幻想",
    image: "images/BSTH09.2-転醒R03(A).webp",
    rarity: "TR",
    pack: "BSTH09.2 東方求聞史記",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2【転醒：自分のカウント3以下】自分のライフが減ったとき裏返せる。
      // BSSA01-転醒X01(A)/転醒X04(A) 先例 (transcendenceFlipTriggerEffects) と同型の
      // 2エントリ分割 (game_event reduce_life + card_event leave_field) を踏襲。
      {
        timing: { kind: "game_event", player: "either", event: "reduce_life" },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 3 },
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 3 },
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 3 },
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 3 },
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            action: {
              kind: "rebirth",
              maxCount: 3,
              vanishAfterFlipOnLvDeficit: true,
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2【転醒：自分のカウント3以下】このネクサスが相手によってフィールドを離れるとき裏返せる。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 3 },
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 3 },
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 3 },
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 3 },
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            action: {
              kind: "rebirth",
              maxCount: 3,
              vanishAfterFlipOnLvDeficit: true,
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2 幻想/導界者カードを召喚/配置/使用時、軽減シンボル1つを満たす。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["reduction_symbol"],
              whenPayingForFilter: { tribes: ["幻想", "導界者"] },
              waivesReductionRequirement: true,
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2『自分のアタックステップ』起幻スピ/アルのアタック中、相手のコスト6以下のバースト効果を無効にする。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [
          { kind: "min_level", value: 2 },
          {
            kind: "field_has",
            player: "self",
            category: ["spirit", "ultimate"],
            tribes: ["起幻"],
            battleState: "attacking",
          },
        ],
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "opponent_burst",
              targetFilter: { maxCost: 6 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "幻想の守り神 龍神",
      printedCategory: "spirit",
      colors: ["red", "purple", "green", "white", "yellow", "blue"],
      cost: 7,
      reductionSymbols: [],
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
          requiredCores: 5,
          bp: 10000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント1する。",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒時』",
        "ボイドからコア1個を自分のスピリット/アルティメットに置き、自分はデッキの上から1枚ドローする。",
        "",
        "Lv1-Lv2-Lv3『自分のアタックステップ』",
        "自分のカウント2以上のとき、相手のバースト効果を無効にする。",
        "",
        "Lv1-Lv2-Lv3",
        "このスピリットのシンボルは、赤/紫/緑/白/黄/青/究極/神としても扱う。",
      ],
      keywordTags: ["burst"],
      tribe: "起幻・化神・幻想",
      image: "images/BSTH09.2-転醒R03(B).webp",
      rarity: "TR",
      pack: "BSTH09.2 東方求聞史記",
      cardNo: "BSTH09.2-転醒R03(B)",
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1-Lv2-Lv3『このスピリットの転醒時』ボイドからコア1個を自分のスピリット/
        //   アルティメットに置き、自分はデッキの上から1枚ドローする。
        {
          timing: { kind: "card_event", event: "rebirth" },
          steps: [
            // ボイドからコア1個を、選択した自分のスピリット/アルティメットに置く。
            // player_choice + from void: 候補は自分の全スピリット/アルティメット（count:"all"）、
            // 配分総数は amount=1。プレイヤーが置き先1体を選んでコアを置く。「置き」＝強制 → minTotal:1。
            {
              action: {
                kind: "core_distribute",
                from: { kind: "void", player: "self" },
                to: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["spirit", "ultimate"] },
                  count: "all",
                },
                amount: 1,
                mode: "player_choice",
                minTotal: 1,
              },
            },
            // 自分はデッキの上から1枚ドローする（continuation で配分解決後に再開）。
            { action: { kind: "draw", count: 1 }, connector: "simultaneous" },
          ],
          textRef: [2, 3],
        },
        // [5,6] Lv1-Lv2-Lv3『自分のアタックステップ』自分のカウント2以上のとき、
        //   相手のバースト効果を無効にする。
        {
          // 常駐無効化: while_on_field の negate(opponent_burst) CE を登録する。
          // condition (カウント2以上) は recompute add/remove、timingScope (自分のアタック
          // ステップ) は消費時 isCEActiveForScope で動的に評価される (P3-75 continuous negate)。
          timing: { kind: "continuous" },
          timingScope: { player: "self", period: "attack" },
          condition: [{ kind: "count_value", player: "self", min: 2 }],
          steps: [
            {
              action: {
                kind: "negate",
                negateTarget: "opponent_burst",
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5, 6],
        },
        // [8,9] Lv1-Lv2-Lv3 このスピリットのシンボルは、赤/紫/緑/白/黄/青/究極/神としても扱う。
        //   多色 treat_as（asColor 配列）で 8 色を 1 効果で付与（engine batch2-1）。
        //   「このスピリットの」= 場のスピリット限定（appliesToCard なし）。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "treat_as",
                aspects: ["symbol"],
                asColor: [
                  "red",
                  "purple",
                  "green",
                  "white",
                  "yellow",
                  "blue",
                  "ultimate_symbol",
                  "god",
                ],
              },
            },
          ],
          textRef: [8, 9],
        },
      ],
    },
  },
];
