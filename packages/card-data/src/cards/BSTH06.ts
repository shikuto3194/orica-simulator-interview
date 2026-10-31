import type { CardDefinition } from "@orica/rules-core";

export const BSTH06_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH06-C01",
    orikaId: 167,
    orikaIndex: 176,
    name: "[地底の釣瓶落とし]キスメ",
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
      "自分のデッキを上から3枚オープンできる。その中の系統：「地霊」を持つ導界者ネクサスカード1枚と系統：「地霊」を持つカード1枚を手札に加える。残ったカードは、好きな順番でデッキの下に戻す。",
      "",
      "Lv2『このスピリットの召喚時』",
      "BP1000以下の相手のスピリット1体を破壊できる。",
    ],
    keywordTags: [],
    tribe: "幻想・地霊・皇獣",
    image: "images/BSTH06-C01.webp",
    rarity: "C",
    pack: "BSTH06 東方地霊殿",
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
      // Lv1-Lv2『このスピリットの召喚時』デッキ上3枚オープン、地霊の導界者ネクサス1枚と
      // 地霊カード1枚を手札に加える。残りはデッキの下へ。
      // 原文「系統：「地霊」を持つ導界者ネクサスカード1枚」= 地霊 AND 導界者。
      // targetsGrandwalker は創界神/導界者を対象解禁するのみで「導界者だけ」に絞らない。
      // hasMechanic:["guided"] を独立 conjunct で追加して非導界者(転醒/創界石ネクサス等)を弾く。
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
                    tribes: ["地霊"],
                    targetsGrandwalker: true,
                    hasMechanic: ["guided"],
                  },
                  mandatory: true,
                },
                { count: 1, filter: { tribes: ["地霊"] }, mandatory: true },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv2『このスピリットの召喚時』BP1000以下の相手のスピリット1体を破壊できる。
      {
        timing: { kind: "card_event", event: "summon" },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                  maxBp: 1000,
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
    cardNo: "BSTH06-C02",
    orikaId: 168,
    orikaIndex: 177,
    name: "[地底の土蜘蛛]黒谷 ヤマメ",
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
        requiredCores: 2,
        bp: 4000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "このカード/スピリットのシンボルは赤としても扱う。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個をこのスピリットに置ける。自分のデッキを上から3枚オープンできる。その中の系統：「地霊」を持つ導界者ネクサスカード1枚と、系統：「地霊」を持つカード1枚を手札に加える。残ったカードは、好きな順番でデッキの下に戻す。",
      "",
      "Lv2『このスピリットの召喚時』",
      "BP2000以下の相手のスピリット1体を重疲労させる。",
    ],
    keywordTags: [],
    tribe: "幻想・地霊・遊精",
    image: "images/BSTH06-C02.webp",
    rarity: "C",
    pack: "BSTH06 東方地霊殿",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカード/スピリットのシンボルは赤としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: "red",
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『このスピリットの召喚時』ボイドからコア1個を置き、デッキ上3枚オープン、
      // 地霊の導界者ネクサス1枚と地霊カード1枚を手札に加える。残りはデッキの下へ。
      // 原文「系統：「地霊」を持つ導界者ネクサスカード1枚」= 地霊 AND 導界者。
      // targetsGrandwalker は創界神/導界者を対象解禁するのみで「導界者だけ」に絞らない。
      // hasMechanic:["guided"] を独立 conjunct で追加して非導界者(転醒/創界石ネクサス等)を弾く。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
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
                    category: ["nexus"],
                    tribes: ["地霊"],
                    targetsGrandwalker: true,
                    hasMechanic: ["guided"],
                  },
                  mandatory: true,
                },
                { count: 1, filter: { tribes: ["地霊"] }, mandatory: true },
              ],
              remainder: "bottom",
            },
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [2, 3],
      },
      // Lv2『このスピリットの召喚時』BP2000以下の相手のスピリット1体を重疲労させる。
      {
        timing: { kind: "card_event", event: "summon" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], maxBp: 2000 },
                count: 1,
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH06-C03",
    orikaId: 169,
    orikaIndex: 178,
    name: "水橋 パルスィ",
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
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個ずつを系統：「遊精」/「皇獣」を持つ自分のスピリット2体に置ける。その後、手札/手元/トラッシュにある系統：「遊精」/「皇獣」を持つ、コスト4以下のカード1枚を1コスト、または、コスト6以下のカード1枚を2コスト支払って召喚できる。この効果は、ターンに1回しか使えない。",
      "",
      "Lv2『自分のアタックステップ』",
      "系統：「地霊」を持つ自分のスピリットは、そのスピリットが持つ最高Lvとして扱う。",
    ],
    keywordTags: [],
    tribe: "幻想・地霊・遊精",
    image: "images/BSTH06-C03.webp",
    rarity: "C",
    pack: "BSTH06 東方地霊殿",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このスピリットの召喚時』ボイドからコア1個ずつを遊精/皇獣の自分のスピリット2体に置ける。
      // その後、手札/手元/トラッシュの遊精/皇獣のコスト4以下を1コストまたはコスト6以下を2コストで召喚できる。ターンに1回。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "core_distribute",
              from: { kind: "void", player: "self" },
              to: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], tribes: ["遊精", "皇獣"] },
                count: 2,
              },
              amount: 2,
              mode: "one_each",
            },
            executionMode: "optional",
          },
          // 「その後、手札/手元/トラッシュの遊精/皇獣のコスト4以下を1コスト、または
          //   コスト6以下を2コストで召喚できる」= choice(index0=辞退/index1=コスト4以下枠
          //   /index2=コスト6以下枠)。「1コスト、または…2コスト支払って」は
          //   軽減後の総コストではなく固定の支払い額であるため、通常の軽減を通さない
          //   costModifier.fixedPayment で表す。既存 SummonAction.target.filter.maxCost と
          //   costModifier:{fixedPayment} の組み合わせで足りる。
          {
            targetSelectionTiming: "on_step",
            connector: "sequential",
            id: "c03-summon-choice",
            action: { kind: "noop" },
            choice: [
              {
                action: {
                  kind: "summon",
                  target: {
                    kind: "from_zone",
                    zone: ["hand", "set_aside", "trash"],
                    filter: {
                      category: ["spirit", "ultimate", "brave"],
                      tribes: ["遊精", "皇獣"],
                      maxCost: 4,
                    },
                    count: 1,
                  },
                  costModifier: { fixedPayment: 1 },
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
                      tribes: ["遊精", "皇獣"],
                      maxCost: 6,
                    },
                    count: 1,
                  },
                  costModifier: { fixedPayment: 2 },
                },
              },
            ],
          },
        ],
        textRef: [0, 1],
      },
      // Lv2『自分のアタックステップ』系統：「地霊」を持つ自分のスピリットは、最高Lvとして扱う。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], tribes: ["地霊"] },
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
    cardNo: "BSTH06-C04",
    orikaId: 170,
    orikaIndex: 179,
    name: "火焔猫 燐",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red", "green"],
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
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "相手のネクサス/創界神ネクサス1つを破壊できる。",
      "",
      "Lv1-Lv2-Lv3 フラッシュ",
      "このスピリットを疲労させることで、自分はデッキの上から1枚ドローするか、トラッシュにある系統：「地霊」を持つネクサスカード1枚をコストを支払わずに配置する。",
    ],
    keywordTags: [],
    tribe: "幻想・地霊・皇獣",
    image: "images/BSTH06-C04.webp",
    rarity: "C",
    pack: "BSTH06 東方地霊殿",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『このスピリットの召喚時』相手のネクサス/創界神ネクサス1つを破壊できる。
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
      // Lv1-Lv2-Lv3 フラッシュ：このスピリットを疲労させることで、デッキ1枚ドロー、または
      // トラッシュの地霊ネクサスカード1枚をコストを支払わずに配置する。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: { kind: "exhaust", target: { kind: "self" } },
          },
          {
            connector: "conditional_cost",
            // choiceIndex 0 = デフォルト action (ドロー), 1 = トラッシュから地霊ネクサスを配置
            action: { kind: "draw", count: 1 },
            choice: [
              {
                action: {
                  kind: "search_zone",
                  zone: "trash",
                  filter: { category: ["nexus"], tribes: ["地霊"] },
                  count: 1,
                  mandatory: true,
                  destination: "field",
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
    cardNo: "BSTH06-M01",
    orikaId: 171,
    orikaIndex: 180,
    name: "[地霊殿]東風谷 早苗",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "green", "red", "red"],
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
      "【バースト：相手によって自分のスピリットがフィールドを離れた後】",
      "相手のスピリット/アルティメット2体を重疲労させる。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2『自分のアタックステップ』",
      "相手がマジックカードのスタック効果を使うとき、そのコストを+1する。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・地霊・遊精",
    image: "images/BSTH06-M01.webp",
    rarity: "M",
    pack: "BSTH06 東方地霊殿",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：相手によって自分のスピリットがフィールドを離れた後】
      // 相手のスピリット/アルティメット2体を重疲労させる。その後、コストを支払わずに召喚する。
      {
        // 「相手によって」= opponent_effect + battle（バトル討ち取りも相手による離脱）。
        // spirit_destroyed trigger は BurstEventKind="leave_field" にマップされ破壊以外の
        // 離脱（バウンス/消滅/コア不足）も拾う。cause で自分起因の離脱を除外する。
        // triggerFilter category:["spirit"] で「自分のスピリット」限定（ネクサス等の離脱は
        // spirit_destroyed の名称に反して leave_field family に丸められるため明示除外が必要。
        // BSTH03-M01 の category:["ultimate"] と同型）。
        timing: {
          kind: "burst",
          trigger: { kind: "spirit_destroyed", player: "self" },
          triggerFilter: { category: ["spirit"] },
          cause: ["opponent_effect", "battle"],
        },
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 2,
              },
              degree: "heavy_exhaust",
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
      // Lv1-Lv2『自分のアタックステップ』相手がマジックのスタック効果を使うとき、そのコストを+1する。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "opponent",
              cardFilter: { category: ["magic"], usingEffectMode: ["stack"] },
              modifier: { additionalCostValue: 1 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH06-R01",
    orikaId: 172,
    orikaIndex: 181,
    name: "「サブタレイニアンローズ」",
    printedCategory: "magic",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「地霊」を持つ。",
      "このカードは、『お互いのアタックステップ』にしか使えない。",
      "",
      "フラッシュ",
      "相手のスピリット2体を重疲労させる。",
      "",
      "スタック",
      "相手のスピリット2体/アルティメット1体を疲労させる。",
    ],
    keywordTags: [],
    tribe: "幻想・地霊",
    image: "images/BSTH06-R01.webp",
    rarity: "R",
    pack: "BSTH06 東方地霊殿",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」/「地霊」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "地霊"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ：相手のスピリット2体を重疲労させる。（『お互いのアタックステップ』限定）
      {
        timing: { kind: "activated", mode: "flash" },
        // カード使用制限『お互いのアタックステップ』（textLine[1]）。
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 2,
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [3, 4],
      },
      // スタック：相手のスピリット2体/アルティメット1体を疲労させる。
      {
        timing: { kind: "activated", mode: "stack" },
        // カード使用制限『お互いのアタックステップ』（textLine[1]）。
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            // choiceIndex 0 = スピリット2体疲労, 1 = アルティメット1体疲労
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 2,
              },
            },
            choice: [
              {
                action: {
                  kind: "exhaust",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["ultimate"] },
                    count: 1,
                  },
                },
              },
            ],
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH06-R02",
    orikaId: 173,
    orikaIndex: 182,
    name: "「サブタレイニアンサン」",
    printedCategory: "magic",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "green", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「地霊」を持つ。",
      "",
      "メイン",
      "自分は、デッキの上から2枚ドローする。",
      "",
      "フラッシュ",
      "ボイドからコア1個を系統：「地霊」を持つ自分の創界石ネクサスに置く。この効果はお互いのアタックステップでターンに1回しか使えない。",
    ],
    keywordTags: [],
    tribe: "幻想・地霊",
    image: "images/BSTH06-R02.webp",
    rarity: "R",
    pack: "BSTH06 東方地霊殿",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」/「地霊」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "地霊"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // メイン：自分は、デッキの上から2枚ドローする。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "draw",
              count: 2,
            },
          },
        ],
        textRef: [2, 3],
      },
      // フラッシュ『お互いのアタックステップ』ターンに1回、ボイドからコア1個を
      // 系統:「地霊」を持つ自分の創界石ネクサスに置く。
      //
      // 創界石ネクサスへのコア配置 = CardFilter.targetsGrandstone:true で対象に
      // 含めるだけで通常の void→field_card pipeline が動く（matchesCardFilter が
      // grandstone-only ガードを bypass する）。コア配置後の解封/転醒判定は
      // grandstone-system の既存配線で完結する
      // ([[project_grandstone_unseal_rebirth]])。targetsGrandstone を立てないと
      // matchesCardFilter が grandstone nexus を素で除外する点に注意。
      //
      // タイミング『お互いのアタックステップ』= timingScope player:"both"/period:"attack"
      // (BSTH01-M01 等の同型 SSOT)。
      // usageLimit per_card_name:turn: マジックは cast 後トラッシュへ移り別コピーは
      // 別 instanceId のため per_instance では枠を共有せず実質 no-op になる。
      // 「ターンに1回」をマジック全コピーで共有するには per_card_name が SSOT
      // (BSFT01 鍵マジック群 同型)。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["地霊", "創界石"],
                  tribesLogic: "and",
                  targetsGrandstone: true,
                },
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
    cardNo: "BSTH06-X01",
    orikaId: 174,
    orikaIndex: 183,
    name: "[導界者]古明地 さとり",
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 2,
    reductionSymbols: ["red", "green"],
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
    symbolColors: ["guide"],
    textLines: [
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・導技・導域は、神託・神技・神域としても扱う。",
      "",
      "【導託：〔地霊＆コスト3以上〕】",
      "◆対象の自分のスピリットを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "このカードの配置コストは0にならない。このネクサスのシンボルは赤/緑としても扱う。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分のトラッシュに系統：「地霊」を持つカードがあるとき、相手の手札すべてを手元に置く。この効果は、ターンに1回しか使えない。",
      "",
      "【導域】Lv2『自分のメインステップ』",
      "系統：「地霊」を持つ自分のスピリットが召喚されたとき、このネクサスの『このネクサスの配置時』効果を発揮する。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    // 本体ルール [0]（導界者/創界神対象の効果しか受けない・導託/導界者対象効果でしかコア配置不可・
    // 導託/導技/導域=神託/神技/神域読み替え）と【導託】[2,3,4]（対象召喚/煌臨時コア+1、
    // 配置時デッキ上3枚トラッシュ→対象カード1枚につきコア+1=標準 placementOracle）は
    // grandwalkerData 基盤 + enter_field_core_placement_forbidden で表現（stub effect から移行）。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent"],
      // bullet1「対象の自分のスピリット」はネクサスを含まないため spirit のみに限定する。
      oracleConditions: [
        { tribes: ["地霊"], minCost: 3, categories: ["spirit"] },
      ],
    },
    tribe: "導界者・地霊",
    image: "images/BSTH06-X01.webp",
    rarity: "X",
    pack: "BSTH06 東方地霊殿",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このネクサスのシンボルは赤/緑としても扱う。
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
      // このカードの配置コストは0にならない。（コスト軽減下限 floor:1）
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { floor: 1 },
            },
          },
        ],
        textRef: [6],
      },
      // Lv1-Lv2『このネクサスの配置時』トラッシュに地霊カードがあるとき、相手の手札すべてを手元に置く。ターンに1回。
      // 「ターンに1回」は【導域】経由の発揮（下の game_event 効果）と共有 → limitGroupId。
      {
        timing: { kind: "card_event", event: "place" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            zone: "trash",
            tribes: ["地霊"],
          },
        ],
        usageLimit: { kind: "per_card_name", duration: "turn" },
        limitGroupId: "BSTH06-X01-place-effect",
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "hand", player: "opponent" },
              to: { zone: "set_aside", player: "opponent" },
              count: "all",
            },
          },
        ],
        textRef: [8, 9],
      },
      // 【導域】Lv2『自分のメインステップ』系統:「地霊」を持つ自分のスピリットが召喚されたとき、
      // このネクサスの『このネクサスの配置時』効果を発揮する。
      // = 配置時効果と同内容（条件・steps・ターン1回制限を limitGroupId で共有）を
      //   game_event:summon（自分の地霊スピリット）で発揮する。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "summon",
          triggerFilter: { category: ["spirit"], tribes: ["地霊"] },
        },
        timingScope: { player: "self", period: "main" },
        condition: [
          { kind: "min_level", value: 2 },
          {
            kind: "field_has",
            player: "self",
            zone: "trash",
            tribes: ["地霊"],
          },
        ],
        usageLimit: { kind: "per_card_name", duration: "turn" },
        limitGroupId: "BSTH06-X01-place-effect",
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "hand", player: "opponent" },
              to: { zone: "set_aside", player: "opponent" },
              count: "all",
            },
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
  {
    cardNo: "BSTH06-X02",
    orikaId: 175,
    orikaIndex: 184,
    name: "古明地 こいし",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 8,
    reductionSymbols: ["green", "green", "red", "red"],
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
    symbolColors: ["green", "green"],
    textLines: [
      "Lv1-Lv2-Lv3『自分のアタックステップ』",
      "このスピリットは、ブロックされず、相手は、このスピリットを効果の対象にできず、含めない。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "相手の手元のスピリットカード/ネクサスカード/白のマジックカード1枚を破棄することで、このスピリットは回復する。",
    ],
    keywordTags: [],
    tribe: "幻想・地霊・遊精",
    image: "images/BSTH06-X02.webp",
    rarity: "X",
    pack: "BSTH06 東方地霊殿",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『自分のアタックステップ』このスピリットは、ブロックされない。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "unblockable",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3 相手はこのスピリットを効果の対象にできず、含めない。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: ["targeted", "included"],
              source: "opponent_effect",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『このスピリットのアタック時』相手の手元のスピリット/ネクサス/白マジック1枚を破棄することで回復。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "discard",
              count: 1,
              player: "opponent",
              fromZone: "set_aside",
              selectionPlayer: "effect_controller",
              filter: {
                filterOr: [
                  { category: ["spirit", "nexus"] },
                  { category: ["magic"], colors: ["white"] },
                ],
              },
            },
          },
          {
            action: { kind: "recover", target: { kind: "self" } },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH06-X03",
    orikaId: 176,
    orikaIndex: 185,
    name: "星熊 勇儀",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "green"],
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
        bp: 16000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "このカードは、2コスト以上支払わなければ召喚できない。",
      "",
      "Lv1-Lv2-Lv3【三歩必殺】『このスピリットのアタック時』",
      "ターンに1回、このスピリットは、3回まで連続でバトルできる（バトル終了前に2回までブロック前のフラッシュタイミングから、続けてバトルを行える）。",
      "",
      "Lv2-Lv3 フラッシュ『このスピリットのアタック時』",
      "バトルに1回、このスピリットのBP以下の相手のスピリット/アルティメット1体を破壊し、その効果を発揮させない。この効果で破壊したとき、相手のライフのコア1個をリザーブに置く。",
      "",
      "Lv3『このスピリットのアタック時』",
      "このスピリットをBP+10000する。",
    ],
    keywordTags: [],
    tribe: "幻想・地霊・皇獣",
    image: "images/BSTH06-X03.webp",
    rarity: "X",
    pack: "BSTH06 東方地霊殿",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、2コスト以上支払わなければ召喚できない。（コスト軽減下限 floor:2）
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { floor: 2 },
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2-Lv3【三歩必殺】『このスピリットのアタック時』3回まで連続でバトル。ターンに1回。
      // 10_rules/05c_connect-battle.md (信頼度C・類推適用・ユーザー確認済み)。
      // maxUses は「継続回数」(2回まで続けてバトルを行える) であり総バトル回数(3回)ではない。
      // 初回バトル+継続2回=合計3回 (adversarial verifier 2026-08-02 round1 lens1 指摘の修正)。
      {
        timing: { kind: "card_event", event: "attack" },
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            action: { kind: "connect_battle", maxUses: 2 },
          },
        ],
        textRef: [2, 3],
      },
      // Lv2-Lv3 フラッシュ『このスピリットのアタック時』BP以下の相手1体を破壊し効果を発揮させない。破壊時、相手ライフのコア1個をリザーブへ。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "self", period: "attack" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "in_battle", state: "attacking" },
        ],
        usageLimit: { kind: "per_instance", duration: "battle" },
        steps: [
          {
            id: "x03-destroy",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxBpSource: "self_effective_bp",
                },
                count: 1,
              },
              suppressDestroyedEffects: "destroyed_only",
            },
          },
          {
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "x03-destroy" },
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
        textRef: [5, 6],
      },
      // Lv3『このスピリットのアタック時』このスピリットをBP+10000する。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 3 }],
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: { kind: "self" },
              amount: 10000,
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSTH06-転醒R01(A)",
    orikaId: 177,
    orikaIndex: 186,
    name: "旧地獄街道",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["green", "red"],
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
    symbolColors: ["green"],
    textLines: [
      "Lv1-Lv2【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "スピリットがアタック／疲労したか、このネクサスが相手によってフィールドを離れるとき、このネクサスを裏返せる。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分は、デッキの上から1枚ドローできる。",
      "",
      "Lv2",
      "このネクサスのシンボルは、赤としても扱う。",
    ],
    keywordTags: ["double_sided"],
    tribe: "幻想・地霊",
    image: "images/BSTH06-転醒R01(A).webp",
    rarity: "TR",
    pack: "BSTH06 東方地霊殿",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2【転醒：自分のカウント3以下】スピリットがアタック／疲労したか、
      //   このネクサスが相手によってフィールドを離れるとき、このネクサスを裏返せる。
      //   転醒トリガーは誘発（game_event:attack / game_event:exhaust / card_event:leave_field）。
      //   いずれも count_value max:3 でゲートし rebirth ステップが flip する。leave_field
      //   経路は executeRebirth が pendingLeave を解除しフィールドに残す（08a:83 + 04:14）。
      {
        timing: {
          kind: "game_event",
          player: "either",
          event: "attack",
          triggerFilter: { category: ["spirit"] },
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "game_event",
          player: "either",
          event: "exhaust",
          triggerFilter: { category: ["spirit"] },
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [0, 1],
      },
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
      // Lv1-Lv2『このネクサスの配置時』自分は、デッキの上から1枚ドローできる。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [3, 4],
      },
      // Lv2 このネクサスのシンボルは、赤としても扱う。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          { action: { kind: "treat_as", aspects: ["symbol"], asColor: "red" } },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "地霊殿",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 0,
        },
      ],
      symbolColors: ["red"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1『このネクサスの転醒時』",
        "本来のシンボルが1つの相手のスピリット1体を破壊する。",
        "",
        "Lv1",
        "系統：「地霊」を持つコスト8の自分のスピリットが召喚されたとき、このネクサスを裏返して配置できる。この効果はターンに1回しか使えない。",
      ],
      keywordTags: [],
      tribe: "幻想・地霊",
      image: "images/BSTH06-転醒R01(B).webp",
      rarity: "TR",
      pack: "BSTH06 東方地霊殿",
      cardNo: "BSTH06-転醒R01(B)",
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1『このネクサスの転醒時』本来のシンボルが1つの相手のスピリット1体を破壊する。
        //   「本来のシンボル」= 印字 symbolColors。CardFilter.printedSymbolCount は
        //   def.symbolColors.length のみで完全一致判定し effectiveSymbolCount 注入の影響を
        //   受けない (2026-06-27 ENGINE-card-filter-effective-symbol-count 着地後の区別)。
        {
          timing: { kind: "card_event", event: "rebirth" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"], printedSymbolCount: 1 },
                  count: 1,
                },
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5,6] Lv1 系統:「地霊」を持つコスト8の自分のスピリットが召喚されたとき、
        //   このネクサスを裏返して配置できる。ターンに1回。
        //   逆転醒（B面→A面 裏返して配置）= reverse_rebirth mode:"summon"（P3-98、10_rules/08a
        //   §逆転醒 パターン2）。「コストを支払わず」明記が無いため通常配置（コスト支払い+維持コア）。
        //   召喚トリガー = game_event:summon（地霊コスト8の自分スピリット、第三者観測）。
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "summon",
            triggerFilter: {
              category: ["spirit"],
              tribes: ["地霊"],
              minCost: 8,
              maxCost: 8,
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
    cardNo: "BSTH06-転醒X01(A)",
    orikaId: 178,
    orikaIndex: 187,
    name: "核融合炉",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "green"],
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
      "【解封：〔系統：「地霊」を持つ自分のスピリットのアタック〕】",
      "◆解封条件を満たしたとき、ボイドからコア1個をこのネクサスに置ける。",
      "",
      "Lv1【転醒：自分のカウント5以下（転醒は同時に使えない）】",
      "このネクサスのコアが4個以上になったとき、このネクサスを裏返せる。（置かれているコアは1個を残してボイドに置く。）このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【神秘】Lv1",
      "系統：「地霊」を持つ自分のスピリットがアタックしている間、相手は効果でアタックステップを終了できない。",
    ],
    keywordTags: ["double_sided", "enter_field_core_placement_forbidden"],
    tribe: "創界石・幻想・地霊",
    image: "images/BSTH06-転醒X01(A).webp",
    rarity: "TX",
    pack: "BSTH06 東方地霊殿",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 創界石ネクサス本体ルール [0] + 【解封】[2,3]（地霊スピリットのアタック）+
    // 転醒 [5,6]（コア4個以上・カウント5以下・1個残してボイド・フィールド/リザーブの
    // コアを転醒後スピリットに好きなだけ）は grandstoneData + エンジン基盤で表現する。
    grandstoneData: {
      unsealConditions: [
        {
          events: ["attack"],
          cardFilter: { tribes: ["地霊"], categories: ["spirit"] },
        },
      ],
      rebirthCoreThreshold: 4,
      rebirthMaxCount: 5,
      rebirthRetainCores: 1,
      postRebirth: "charge_cores_from_field_reserve",
    },
    effects: [
      {
        // 【神秘】Lv1 系統：「地霊」を持つ自分のスピリットがアタックしている間、
        // 相手は効果でアタックステップを終了できない。
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            tribes: ["地霊"],
            battleState: "attacking",
            category: ["spirit"],
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
        textRef: [8, 9],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "霊烏路 空",
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
          bp: 18000,
        },
      ],
      symbolColors: ["red", "green"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒時』",
        "このスピリット以外のスピリット/アルティメットすべてを破壊し、その効果を発揮させない。この効果はスピリット/アルティメットの効果では防げない。",
        "",
        "Lv2-Lv3『このスピリットのアタック時』",
        "ターンに1回、このスピリットは回復する。",
      ],
      keywordTags: [],
      tribe: "幻想・遊精・空牙",
      image: "images/BSTH06-転醒X01(B).webp",
      rarity: "TX",
      pack: "BSTH06 東方地霊殿",
      cardNo: "BSTH06-転醒X01(B)",
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1-Lv2-Lv3『このスピリットの転醒時』このスピリット以外のスピリット/
        //   アルティメットすべてを破壊し、その効果を発揮させない。
        //   「その効果を発揮させない」= 破壊されたカード自身の効果抑制
        //   (suppressDestroyedEffects: "destroyed_only")。
        //   両プレイヤー全破壊: filter の player:"either" は resolvePlayerRef が相手側に
        //   解決するため使えない。相手側 + 自分側 (excludeSelf) の 2 step 同時実行で表現。
        {
          timing: { kind: "card_event", event: "rebirth" },
          // 後段「この効果はスピリット/アルティメットの効果では防げない」= 「Xの効果では
          // 防げない」型（X以外が防げる、Q9751/P3-140）。防げないのはスピリット/
          // アルティメット側、防げるのはブレイヴ（非合体・非スピリット状態）/ネクサス/
          // マジック側。一致する cannot_*/defense_immune を scoped 貫通する。
          preventionRestriction: {
            notPreventableByCategories: ["spirit", "ultimate"],
          },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"] },
                  count: "all",
                },
                suppressDestroyedEffects: "destroyed_only",
              },
            },
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["spirit", "ultimate"] },
                  count: "all",
                  excludeSelf: true,
                },
                suppressDestroyedEffects: "destroyed_only",
              },
              connector: "simultaneous",
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
