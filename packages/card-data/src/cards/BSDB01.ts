import type { CardDefinition } from "@orica/rules-core";

// 全21面の原文対照・出典: manual/ai-reference/00_meta/source-findings-bsdb01-fidelity.md (2026-09-13)。
// C06のドロー/回収にも孫悟空が必要（2026-09-13ユーザー確認）。既存条件を維持する。

export const BSDB01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSDB01-C01",
    orikaId: 476,
    orikaIndex: 474,
    name: "孫悟空",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 7000,
      },
    ],
    printedOverCount: { minCount: 2, bpBonus: 3000 },
    symbolColors: ["red"],
    textLines: [
      "フラッシュ【契約煌臨：「孫悟空」『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットのアタック時』",
      "自分のカウント+2し、自分はデッキの上から1枚ドローできる。その後、ターンに1回、このスピリットのBP以下の相手のスピリット/アルティメット1体を破壊できる。",
      "",
      "【OC条件：カウント2以上】",
      "【OC中】 Lv1-Lv2【超・激突】『このスピリットのアタック時』",
      "相手のスピリット/アルティメットは、可能ならブロックする。この効果は相手の効果では防げない。",
    ],
    keywordTags: ["advent"],
    tribe: "サイヤ人",
    image: "images/BSDB01-C01.webp",
    rarity: "C",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「孫悟空」『自分のターン』】。
    // 煌臨は CardDefinition.adventData で宣言する（08a L48-59 / 11 L149: AdventData + executeAdvent
    // Phase C 完了）。契約煌臨は getContractAdventTargets で魂状態の契約スピリットも対象に含む。
    // 自分のターン限定 = own_turn（自ターンのメイン/フラッシュ窓）。
    // 煌臨先の名前条件は AdventCondition.cardNames で表現済み（engine-drain）。
    adventData: {
      adventCondition: {
        cardNames: [
          {
            contains: "孫悟空",
          },
        ],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
    },
    overCount: { minCount: 2, bpBonus: 3000 },
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 2 } },
          {
            action: { kind: "draw", count: 1 },
            executionMode: "optional",
            connector: "simultaneous",
          },
          {
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
            },
            connector: "sequential",
            executionMode: "optional",
            usageLimit: { kind: "per_instance", duration: "turn" },
            targetSelectionTiming: "on_step",
          },
        ],
        textRef: [3, 4],
      },
      // [6,7,8]【OC条件：カウント2以上】【OC中】超・激突『アタック時』相手は可能ならブロック、相手の効果で防げない。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "count_value", player: "self", min: 2 }],
        preventionLevel: "unpreventable",
        steps: [
          {
            action: {
              kind: "require_block_if_able",
              player: "self",
              blockerFilter: { category: ["spirit", "ultimate"] },
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [6, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSDB01-C02",
    orikaId: 477,
    orikaIndex: 475,
    name: "ベジータ",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue", "blue"],
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
    ],
    printedOverCount: { minCount: 2, bpBonus: 4000 },
    symbolColors: ["blue"],
    textLines: [
      "フラッシュ【契約煌臨：「ベジータ」『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/アタック時』",
      "自分のカウント+1する。その後、ターンに1回、自分はデッキの上から2枚ドローできる。ドロー後、自分は手札1枚を破棄する。",
      "",
      "【OC条件：カウント2以上】",
      "【OC中】 Lv1-Lv2『このスピリットのアタック時』",
      "ターンに1回、自分のカウント以下のコストの相手のスピリット1体を破壊し、破壊できなかったとき、自分のカウント+1する。",
    ],
    keywordTags: ["advent"],
    tribe: "サイヤ人",
    image: "images/BSDB01-C02.webp",
    rarity: "C",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「ベジータ」『自分のターン』】 → adventData（08a/11 L149）。
    // 煌臨先の名前条件は AdventCondition.cardNames で表現済み（engine-drain）。
    adventData: {
      adventCondition: {
        cardNames: [
          {
            contains: "ベジータ",
          },
        ],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
    },
    overCount: { minCount: 2, bpBonus: 4000 },
    effects: [
      // [3,4] カウント増加→任意のターン1回ドロー→ドロー後の破棄は1つの効果。
      // 「その後」は同じ本文を継続し、後段だけの回数制限を step に持たせる。
      {
        timing: { kind: "card_event", event: ["advent", "attack"] },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
          {
            id: "draw",
            connector: "sequential",
            executionMode: "optional",
            usageLimit: { kind: "per_instance", duration: "turn" },
            action: { kind: "draw", count: 2 },
          },
          {
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "draw" },
            action: { kind: "discard", player: "self", count: 1 },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "count_value", player: "self", min: 2 }],
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            id: "oc-destroy",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], maxCostSource: "self_count" },
                count: 1,
              },
            },
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "oc-destroy",
              not: true,
            },
            action: { kind: "count_increase", player: "self", amount: 1 },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSDB01-C03",
    orikaId: 478,
    orikaIndex: 476,
    name: "超サイヤ人 孫悟空",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 10000,
      },
    ],
    printedOverCount: { minCount: 7, bpBonus: 10000 },
    symbolColors: ["red"],
    textLines: [
      "フラッシュ【契約煌臨：「孫悟空」『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/アタック時』",
      "自分のカウント+1する。その後、ターンに1回、相手のネクサス2つを破壊でき、自分はデッキの上から2枚ドローできる。",
      "",
      "【OC条件：カウント7以上】",
      "【OC中】 Lv1-Lv2 フラッシュ『相手のアタックステップ』",
      "〔ターンに1回:同名〕ただちにバトルを終了できる。そうしたとき、このターンの間、BP20000以下の相手のスピリット/アルティメットがアタックしたとき、その対象を破壊できる。",
    ],
    keywordTags: ["advent"],
    tribe: "サイヤ人",
    image: "images/BSDB01-C03.webp",
    rarity: "C",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「孫悟空」『お互いのアタックステップ』】 → adventData。
    // 『お互いのアタックステップ』= both_attack_step。
    // 煌臨先の名前条件は AdventCondition.cardNames で表現済み（engine-drain）。
    adventData: {
      adventCondition: {
        cardNames: [
          {
            contains: "孫悟空",
          },
        ],
        targetCategory: ["spirit"],
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventVariant: "contract",
    },
    overCount: { minCount: 7, bpBonus: 10000 },
    effects: [
      {
        timing: { kind: "card_event", event: ["advent", "attack"] },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
          {
            id: "once-followup",
            usageGroupId: "nexus-and-draw",
            label: "ネクサス破壊",
            connector: "sequential",
            executionMode: "optional",
            usageLimit: { kind: "per_instance", duration: "turn" },
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"] },
                count: 2,
              },
            },
          },
          {
            connector: "simultaneous",
            executionMode: "optional",
            usageLimit: { kind: "per_instance", duration: "turn" },
            usageGroupId: "nexus-and-draw",
            action: { kind: "draw", count: 2 },
          },
        ],
        textRef: [3, 4],
      },
      // [7,8]【OC条件：カウント7以上】【OC中】 フラッシュ『相手のアタックステップ』〔ターンに1回:同名〕
      // ただちにバトル終了。そうしたとき、このターンの間、相手の BP20000以下の
      // スピリット/アルティメットがアタックしたとき、その対象を破壊できる。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [
          { kind: "count_value", player: "self", min: 7 },
          { kind: "step_phase", step: "attack", whose: "opponent" },
        ],
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          { id: "end-battle", action: { kind: "end_single_battle" } },
          {
            id: "destroy-next-attacker",
            connector: "conditional_result",
            stepCondition: { kind: "ref_succeeded", stepId: "end-battle" },
            action: {
              kind: "destroy",
              target: { kind: "trigger_related_instance" },
            },
            retrigger: {
              event: "attack",
              triggerPlayer: "opponent",
              triggerFilter: {
                category: ["spirit", "ultimate"],
                maxBp: 20000,
                battleState: "attacking",
              },
              duration: { scope: "turn" },
              fireExecutionMode: "optional",
              autoResolveOptional: false,
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSDB01-C04",
    orikaId: 479,
    orikaIndex: 477,
    name: "超サイヤ人 ベジータ",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 5,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 10000,
      },
    ],
    printedOverCount: { minCount: 5, bpBonus: 6000 },
    symbolColors: ["blue"],
    textLines: [
      "フラッシュ【契約煌臨：「ベジータ」『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/ブロック時』",
      "最もコストの低い相手のスピリット1体を破壊できる。その後、ターンに1回、自分のカウント+2できる。",
      "",
      "【OC条件：カウント5以上】",
      "【OC中＆煌臨中】 Lv1-Lv2『相手のターン』",
      "このスピリットの効果を受けない相手のスピリットすべての効果は発揮されない。この効果は相手の効果では防げない。",
    ],
    keywordTags: ["advent"],
    tribe: "サイヤ人",
    image: "images/BSDB01-C04.webp",
    rarity: "C",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「ベジータ」『お互いのアタックステップ』】 → adventData。
    // 煌臨先の名前条件は AdventCondition.cardNames で表現済み（engine-drain）。
    adventData: {
      adventCondition: {
        cardNames: [
          {
            contains: "ベジータ",
          },
        ],
        targetCategory: ["spirit"],
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventVariant: "contract",
    },
    overCount: { minCount: 5, bpBonus: 6000 },
    effects: [
      {
        timing: { kind: "card_event", event: ["advent", "block"] },
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
                  extremal: { metric: "cost", mode: "lowest" },
                },
                count: 1,
              },
            },
            executionMode: "optional",
          },
          {
            action: { kind: "count_increase", player: "self", amount: 2 },
            connector: "sequential",
            executionMode: "optional",
            usageLimit: { kind: "per_instance", duration: "turn" },
          },
        ],
        textRef: [3, 4],
      },
      // [7,8]【OC条件：カウント5以上】【OC中＆煌臨中】『相手のターン』このスピリットの効果を受けない相手スピ全ての効果は発揮されない、防げない。
      {
        applicability: { level: { min: 1, max: 2 } },
        timing: { kind: "continuous" },
        timingScope: { player: "opponent", period: "turn" },
        condition: [
          { kind: "count_value", player: "self", min: 5 },
          { kind: "self_state", state: "advented" },
        ],
        preventionLevel: "unpreventable",
        steps: [
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: "all",
              },
              targetAffectGate: "blocked_by_source_immunity",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSDB01-C05",
    orikaId: 480,
    orikaIndex: 478,
    name: "クリリン",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 2000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 5000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のカウント+1する。その後、自分のデッキを上から3枚オープンできる。その中の系統：「サイヤ人」を持つカード1枚か、赤のネクサスカード1枚を手札に加える。残ったカードはデッキの下に戻す。",
      "",
      "Lv1-Lv2",
      "このスピリットのシンボルは青としても扱う。",
    ],
    keywordTags: [],
    tribe: "地球人",
    image: "images/BSDB01-C05.webp",
    rarity: "C",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
          {
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    filterOr: [
                      { tribes: ["サイヤ人"] },
                      { category: ["nexus"], colors: ["red"] },
                    ],
                  },
                  destination: "hand",
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
            executionMode: "optional",
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv1-Lv2 このスピリットのシンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSDB01-C06",
    orikaId: 481,
    orikaIndex: 479,
    name: "カメハウス",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "red"],
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
      "このカード/ネクサスのシンボル/軽減シンボルは青としても扱う。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分の手札の契約スピリットカードの「孫悟空」1枚を軽減シンボルすべてを満たして召喚できる。その後、魂状態を含む自分の「孫悟空」がいるとき、自分のカウント+1できる。さらに、自分はデッキの上から1枚ドローするか、自分のトラッシュにある「かめはめ波」1枚を手札に戻せる。",
      "",
      "Lv2",
      "自分の手札は、7枚以下の間、相手の効果を受けない。",
    ],
    keywordTags: ["soul_state"],
    image: "images/BSDB01-C06.webp",
    rarity: "C",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/ネクサスのシンボル/軽減シンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] Lv1-Lv2『配置時』手札の契約スピリット「孫悟空」1枚を軽減全満たして召喚。
      //   その後、魂状態を含む自分の「孫悟空」がいればカウント+1し、さらにドロー1 or
      //   トラッシュの「かめはめ波」1枚を手札に戻す。full_reduction / cardName + isContract
      //   / includeSoulState は既存 primitive (BSTS01-C04/C05, BSDB01-C08) を流用。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        steps: [
          {
            id: "summon-contract-goku",
            executionMode: "optional",
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                filter: {
                  category: ["spirit"],
                  cardName: { contains: "孫悟空" },
                  requiredKeywordTags: ["contract"],
                },
                count: 1,
              },
              costModifier: "full_reduction",
            },
          },
          {
            id: "count-if-goku",
            connector: "sequential",
            executionMode: "optional",
            condition: [
              {
                kind: "field_has",
                player: "self",
                cardNames: [{ contains: "孫悟空" }],
                includeSoulState: true,
              },
            ],
            action: { kind: "count_increase", player: "self", amount: 1 },
          },
          {
            id: "draw-or-kamehameha",
            connector: "simultaneous",
            executionMode: "optional",
            condition: [
              {
                kind: "field_has",
                player: "self",
                cardNames: [{ contains: "孫悟空" }],
                includeSoulState: true,
              },
            ],
            action: { kind: "draw", count: 1 },
            choice: [
              {
                label: "かめはめ波回収",
                condition: [
                  {
                    kind: "field_has",
                    player: "self",
                    cardNames: [{ contains: "孫悟空" }],
                    includeSoulState: true,
                  },
                ],
                action: {
                  kind: "search_zone",
                  zone: "trash",
                  player: "self",
                  filter: { cardName: { contains: "かめはめ波" } },
                  count: 1,
                  mandatory: true,
                  destination: "hand",
                },
              },
            ],
          },
        ],
        textRef: [2, 3],
      },
      // [5] Lv2 自分の手札は7枚以下の間、相手の効果を受けない。
      // effect_immunity(target.zone:[hand], count:all) = ゾーン単位免疫
      // (ENGINE-effect-immunity-hand-zone-scope、BSTH02.7-C03 で実装した primitive を流用)。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "hand_count", player: "self", max: 7 },
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
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSDB01-C07",
    orikaId: 482,
    orikaIndex: 480,
    name: "カプセルコーポレーション",
    printedCategory: "nexus",
    colors: ["red", "blue"],
    cost: 3,
    reductionSymbols: ["red", "blue"],
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
      "系統:「地球人」/「サイヤ人」を持つ効果でデッキからオープンされたこのカードは、手札1枚と入れ替えられる。",
      "",
      "Lv1-Lv2",
      "このネクサスのシンボルは赤としても扱い、〔ターンに1回：同名〕自分の「孫悟空」/「ベジータ」が【契約煌臨】したとき、自分はデッキの上から1枚ドローできる。ドロー後、自分は手札1枚を破棄する。自分のカウント5以上のとき、この効果でドローする枚数を+1する。",
      "",
      "Lv2",
      "系統：「サイヤ人」を持つ自分のスピリットがアタックしている間、相手はバースト効果を発揮できない。",
    ],
    keywordTags: ["burst"],
    image: "images/BSDB01-C07.webp",
    rarity: "C",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 系統「地球人」/「サイヤ人」効果でオープンされたこのカードは手札1枚と入れ替えられる。
      //     swap 型 disposition（07b §鍵/星霊デッキオープン置換 line 40）。可能形語尾 = 任意。
      //     受理時このカードを手札へ加え、手札1枚を「このカード」の行き先（オープン由来=デッキ下）へ送る。
      {
        timing: { kind: "card_event", event: ["revealed"] },
        cardEventDisposition: { kind: "swap" },
        condition: [
          { kind: "trigger_tribes", tribes: ["地球人", "サイヤ人"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [],
        executionMode: "optional",
        textRef: [0],
      },
      {
        timing: { kind: "continuous" },
        steps: [
          { action: { kind: "treat_as", aspects: ["symbol"], asColor: "red" } },
        ],
        textRef: [2, 3],
      },
      // [2,3] 〔重複不可〕自分の「孫悟空」/「ベジータ」が【契約煌臨】したとき、デッキ上1枚ドロー（任意）→手札1枚破棄。
      // カウント5以上なら、この効果でドローする枚数を+1（=2枚ドロー）する。
      // 煌臨は card_event:"advent"（11 L149 / registrations L443）を発火するので、他カードの
      // game_event:advent + triggerFilter で観測できる。ドロー枚数の +1 分岐は count_value で
      // 排他ゲートした2効果で決定的に表現し、〔重複不可〕は limitGroupId で両者に1回制限を共有させる。
      {
        // カウント4以下: 1枚ドロー → 手札1枚破棄。
        timing: {
          kind: "game_event",
          player: "self",
          event: "advent",
          effectScope: "contract_advent",
          triggerFilter: {
            cardName: [{ contains: "孫悟空" }, { contains: "ベジータ" }],
          },
        },
        condition: [{ kind: "count_value", player: "self", max: 4 }],
        executionMode: "optional",
        // errata 2026-04-27: 〔重複不可〕→〔ターンに1回：同名〕。limitGroupId は per_card_name 共有ラベルとして維持し、
        // <=4 と >=5 の排他 effect で合計ターン1回（同名共有）に絞る。
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        limitGroupId: "BSDB01-C07-advent-draw",
        steps: [
          { action: { kind: "draw", count: 1 } },
          {
            action: { kind: "discard", player: "self", count: 1 },
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      {
        // カウント5以上: ドロー枚数+1 = 2枚ドロー → 手札1枚破棄。
        timing: {
          kind: "game_event",
          player: "self",
          event: "advent",
          effectScope: "contract_advent",
          triggerFilter: {
            cardName: [{ contains: "孫悟空" }, { contains: "ベジータ" }],
          },
        },
        condition: [{ kind: "count_value", player: "self", min: 5 }],
        executionMode: "optional",
        // errata 2026-04-27: 〔重複不可〕→〔ターンに1回：同名〕。limitGroupId は per_card_name 共有ラベルとして維持。
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        limitGroupId: "BSDB01-C07-advent-draw",
        steps: [
          { action: { kind: "draw", count: 2 } },
          {
            action: { kind: "discard", player: "self", count: 1 },
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      // [5] Lv2 系統「サイヤ人」スピリットがアタックしている間、相手はバースト効果を発揮できない。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "min_level", value: 2 },
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            tribes: ["サイヤ人"],
            battleState: "attacking",
          },
        ],
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "opponent_burst",
              burstSuppressKind: "cannot_activate",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSDB01-C08",
    orikaId: 483,
    orikaIndex: 481,
    name: "界王神界",
    printedCategory: "nexus",
    colors: ["red", "blue"],
    cost: 3,
    reductionSymbols: ["red"],
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
      "このカード/ネクサスのシンボル/軽減シンボルは青としても扱う。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "〔ターンに1回:同名〕魂状態/煌臨元を含む自分の「孫悟空＆ベジータ」がいるとき、自分のカウント+2でき、自分はデッキの上から2枚ドローできる。ドロー後、自分は手札1枚を破棄する。",
      "",
      "Lv2『自分のメインステップ終了時』",
      "〔重複不可〕自分のトラッシュにある《ソウルコア》以外のコア4個までを自分の赤/青のネクサス/「孫悟空」/「ベジータ」に置ける。1個以上置いたとき、このターンの間、相手のトラッシュにあるカードは相手の効果を受けず、その効果を使えない。",
    ],
    keywordTags: ["soul_state"],
    image: "images/BSDB01-C08.webp",
    rarity: "C",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/ネクサスのシンボル/軽減シンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: { kind: "card_event", event: "place" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ exact: "孫悟空＆ベジータ" }],
            includeSoulState: true,
            includeAdventSource: true,
          },
        ],
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 2 },
            executionMode: "optional",
          },
          {
            action: { kind: "draw", count: 2 },
            connector: "simultaneous",
            id: "draw",
            executionMode: "optional",
          },
          {
            action: { kind: "discard", player: "self", count: 1 },
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "draw" },
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv2『自分のメインステップ終了時』〔重複不可〕トラッシュの非ソウルコア4個までを赤/青ネクサス/孫悟空/ベジータへ。
      // 1個以上置いたときの後段は、core_distribute が resume 時に記録する実配置数を
      // ref_count(min:1) で参照する。03d:9-16 により「相手のトラッシュにあるカード」は
      // player target でなくカード/ゾーン target なので、restrict_use は targetScope:"card"。
      {
        timing: { kind: "phase", step: "main", whose: "self", subPhase: "end" },
        condition: [{ kind: "min_level", value: 2 }],
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
                filter: {
                  filterOr: [
                    { category: ["nexus"], colors: ["red"] },
                    { category: ["nexus"], colors: ["blue"] },
                    { cardName: [{ contains: "孫悟空" }] },
                    { cardName: [{ contains: "ベジータ" }] },
                  ],
                },
                count: "all",
              },
              amount: 4,
              effectKind: "normal_only",
              mode: "player_choice",
            },
          },
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {},
                count: "all",
                zone: "trash",
              },
              sourcePlayerScope: "self",
              duration: { scope: "turn" },
            },
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "place-trash-cores",
              result: "numeric_amount",
              min: 1,
            },
          },
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {},
                count: "all",
                zone: "trash",
              },
              duration: { scope: "turn" },
            },
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "place-trash-cores",
              result: "numeric_amount",
              min: 1,
            },
          },
          {
            action: {
              kind: "restrict_use",
              player: "opponent",
              filter: { zone: ["trash"] },
              targetScope: "card",
              duration: { scope: "turn" },
            },
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "place-trash-cores",
              result: "numeric_amount",
              min: 1,
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSDB01-C09",
    orikaId: 484,
    orikaIndex: 482,
    name: "かめはめ波",
    printedCategory: "magic",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ゲームに1回:同名〕トラッシュにあるこのカードは、相手のアタックステップ中、2コスト支払ってスタック効果を使用できる。そうしたとき、このカードを除外する。",
      "",
      "フラッシュ",
      "自分の「孫悟空」1体と相手のスピリット/アルティメット1体のBPを比べる。（BPが同じか低い対象が破壊される）または、相手のフィールドにあるマジックカード1枚を破棄する。",
      "",
      "スタック",
      "次のバトル終了後まで、相手は、相手のスピリット/アルティメット1体を破壊しなければ、アタック/ブロックできない。",
    ],
    keywordTags: [],
    tribe: "サイヤ人",
    image: "images/BSDB01-C09.webp",
    rarity: "C",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 〔ゲームに1回:同名〕トラッシュのこのカードは相手アタックステップ中2コスト払いスタック効果使用→除外。
      //   コスト2は「手札からの使用(printed cost 4)」とは別枠のトラッシュ限定コストのため、
      //   通常コスト payment 経路に requiredPayCostAmount を上乗せする(pay_cost step)のではなく、
      //   applicability.zone:"trash" 限定の continuous cost_modify(override) で表現する
      //   （BSDB01-R03「トラッシュからも使用できる」と同型 precedent、engine-magic-trash-use-permission）。
      //   printedCategory:"magic" のため下の [0]+[5,6] トラッシュ variant 含め
      //   generateMagicRegistrations 経路（getAvailableMagicLegalActions が trash zone を既に走査、
      //   isRegisteredMagicSourceZoneAllowed で許可）に乗る。field-card-effect 経路は不使用。
      {
        applicability: { zone: ["trash"] },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { override: 2 },
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "bp_compare_destroy",
              comparer: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit", "ultimate"],
                  cardName: [{ contains: "孫悟空" }],
                },
                count: 1,
              },
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
            choice: [
              {
                label: "マジック破棄",
                action: {
                  kind: "move_card",
                  from: { zone: "field", player: "opponent" },
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["magic"] },
                    count: 1,
                  },
                  to: { zone: "trash" },
                  count: 1,
                },
              },
            ],
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] スタック: 次のバトル終了後まで、相手は相手スピ/アル1体を破壊しなければアタック/ブロックできない。
      //   「相手は、相手の〜」= 相手自身の場を対象にする自己言及パターン
      //   (BSKB01-M?「相手は、相手のスピリット/アルティメット1体をトラッシュに置く」等と同型)。
      //   ENGINE-battle-destroy-cost-gate: require_attack_exhaust_cost の破壊版として新設した
      //   require_battle_destroy_cost (対象自身と同じ controller の costTargetFilter.category
      //   合致カード1体を破壊しなければアタック/ブロック不可)。restriction は require_battle_cost
      //   と同じく attack/block を選べる。「次のバトル終了後まで」(ターン限定語なし) =
      //   duration:{scope:"battle", nextBattleEnd:true}（model.ts:790-797 の正規セマンティクス。
      //   scope:"battle" 単体はこのバトル中のみで失効するため round1 で refute。
      //   untilTurnEnd:true は「このターン中の次のバトル終了後まで」専用で、原文に
      //   「このターン中の」が無い本カードに適用するとターン境界で早期消滅するため
      //   round2 で refute。両 refute を受け、ターン境界を跨いで次バトル終了まで
      //   生存する nextBattleEnd を新設）。
      {
        timing: { kind: "activated", mode: "stack" },
        steps: [
          {
            action: {
              kind: "require_battle_destroy_cost",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
              },
              restriction: ["attack", "block"],
              costTargetFilter: { category: ["spirit", "ultimate"] },
              duration: { scope: "battle", nextBattleEnd: true },
            },
          },
        ],
        textRef: [5, 6],
      },
      // [0]+[5,6] トラッシュ使用 variant: 「相手のアタックステップ中」timingScope 限定 +
      //   〔ゲームに1回:同名〕usageLimit。ステップは [5,6] と同一の require_battle_destroy_cost に
      //   加え、使用後「このカードを除外する」を後段に追加する。selfCard 経由の
      //   remove_from_game は候補ゾーンが field/in_use/set_aside 限定
      //   (collectTargetCardCandidates) でトラッシュ上の自分自身を解決できないため、
      //   ゾーン非依存で sourceInstanceId を直接引く move_self(destination:removed_from_game)
      //   を使う (BSAZ02-C06 と同型)。コスト(2)は上の [0] continuous cost_modify(override) が
      //   trash zone 限定で適用する。
      {
        applicability: { zone: ["trash"] },
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "opponent", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "game" },
        steps: [
          {
            action: {
              kind: "require_battle_destroy_cost",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
              },
              restriction: ["attack", "block"],
              costTargetFilter: { category: ["spirit", "ultimate"] },
              duration: { scope: "battle", nextBattleEnd: true },
            },
          },
          {
            action: { kind: "move_self", destination: "removed_from_game" },
            connector: "sequential",
          },
        ],
        textRef: [0, 5, 6],
      },
    ],
  },
  {
    cardNo: "BSDB01-C10",
    orikaId: 485,
    orikaIndex: 483,
    name: "仙豆",
    printedCategory: "magic",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔重複不可〕系統：「地球人」を持つ自分の効果でデッキからオープンされたこのカードは手札に加えられる。",
      "",
      "フラッシュ",
      "自分のスピリット1体を回復させることで、このターンの間、自分のライフはコスト5以上の相手のスピリット/アルティメットのアタックでは1しか減らない。",
    ],
    keywordTags: [],
    image: "images/BSDB01-C10.webp",
    rarity: "C",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: ["revealed"] },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_tribes", tribes: ["地球人"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
          { kind: "trigger_source_player", player: "self" },
        ],
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        executionMode: "optional",
        textRef: [0],
        usageLimit: { kind: "no_duplicate" },
      },
      // [2,3] フラッシュ: 自分スピ1体回復→このターン、コスト5以上の相手アタックではライフは1しか減らない。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "recover",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              battleOnly: true,
              mode: "replace",
              cap: 1,
              attackerFilter: {
                category: ["spirit", "ultimate"],
                minCost: 5,
              },
              duration: { scope: "turn" },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSDB01-CX01",
    orikaId: 486,
    orikaIndex: 484,
    name: "孫悟空＆ベジータ",
    printedCategory: "spirit",
    colors: ["red", "blue"],
    cost: 3,
    reductionSymbols: ["red", "red", "blue", "blue"],
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
    symbolColors: ["red"],
    textLines: [
      "【真バディ：「孫悟空」/「ベジータ」】",
      "魂状態/煌臨元を含むこのカードには、対象を右左に1体ずつ【契約煌臨】できる。このとき、このカードが魂状態/煌臨元なら煌臨するカードに自分のフィールド/リザーブのコアを好きなだけ置く。また、〔ターンに1回:同名〕自分は、《ソウルコア》をトラッシュに置いたものとして【契約煌臨】できる。（煌臨元のこのカードは疲労せず、重なったカードを含むこれらには対象以外を合体/煌臨/入れ替えできない）",
      "",
      "【契約煌臨元】",
      "自分が「破壊効果」を発揮したとき、自分のカウント+1する。また、自分の系統：「サイヤ人」によって相手のカードがフィールドを離れるとき、〔ターンに1回:同名〕ボイドからコア1個を自分のフィールドに置くことができ、自分のスピリット1体を回復できる。",
    ],
    keywordTags: ["soul_state", "contract"],
    tribe: "サイヤ人",
    image: "images/BSDB01-CX01.webp",
    rarity: "CX",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1]【真バディ：「孫悟空」/「ベジータ」】= host 側 (被煌臨側) 同時2体煌臨許可
    //   (hostDualAdventGrant、mechanics/host-dual-advent.ts)。このカード自身は他カードへ
    //   煌臨しない (adventData 不要)。「魂状態/煌臨元を含むこのカードには」= 08a 名前参照の
    //   包含スコープ裁定 (通常フィールド現在面 ∪ 魂状態 ∪ 煌臨元) と同じ3状態で発動可能
    //   (isHostDualAdventGrantUsable)。
    //   裁定確定 (2026-07-13、issues/P3-117、公式【バディ】base裁定との突き合わせ後ユーザー
    //   確認): 「対象を右左に1体ずつ」= **1宣言=1体**。slots[0]「孫悟空」/slots[1]「ベジータ」
    //   を含む手札カードはそれぞれ**別々の宣言**で host へ契約煌臨し、host は2枚の occupant を
    //   host→A、host→B の**並行/分岐**で保持する (host→A→B の直列チェーンではない、旧実装
    //   commit 80a24a07 は反証済み)。片方の occupant が単独でフィールドを離れても host は
    //   魂状態に戻らず、もう一方の occupant の煌臨元としてそのまま残る (host が手放されるのは
    //   両方の occupant が離れたときのみ、state-based-actions.ts の「煌臨元カード一括移動」が
    //   他の現存カードからまだ参照されているかを確認してから道連れにする)。各スロットの充足
    //   状況は既存の underCards を都度走査して導出する (getHostDualAdventOpenSlotIndices、
    //   専用フィールド不要)。
    //   常時の許可自体にターン制限はない。main_and_flash と煌臨カード自身の印字タイミングを
    //   両方満たす宣言に適用する。擬制支払いはタイミングを無視する効果ではない (08a6)。
    //   「このとき、このカードが魂状態/煌臨元なら…コアを好きなだけ置く」=
    //   hostCoreDistributionOnAdvent (host が当該宣言の前から既に魂状態/煌臨元だった場合のみ
    //   gate。host が通常フィールド現在面から始まった宣言では発生しないが、反対側スロットが
    //   既に埋まっている状態での2枚目宣言は host が既にその occupant の煌臨元なので発生する)。
    //   「〔ターンに1回:同名〕…ソウルコアをトラッシュに置いたものとして【契約煌臨】できる」=
    //   alternateCost (擬制消費、usedAlternateCostAdventKeysThisTurn は許可元側
    //   printed name で gate。常時の許可元で回数を共有する)。
    //   「煌臨元のこのカードは疲労せず」= executeAdvent が煌臨元化時に exhaustState を
    //   無条件で "recovered" に強制する (advent-system.ts、全煌臨元共通の既存挙動) ため
    //   追加実装不要 (adversarial verifier round1 lens1 で誤指摘、advent-system.ts:639/1017
    //   で反証済み)。
    //   「重なったカードを含むこれらには対象以外を合体/煌臨/入れ替えできない」= host+スタック
    //   への第三者 (孫悟空/ベジータ以外) の合体/煌臨/入れ替えを一般に禁止する restriction。
    //   煌臨側は hostDualAdventGrant.exclusiveToSlots (model.ts) で実装:
    //   advent-system.ts の isExcludedByHostExclusiveLock が host+adventSourceIdsOf スタック
    //   全体を走査し、grant.slots (孫悟空/ベジータ) の cardNames に一致しない第三者の
    //   煌臨カードを getAdventTargets/getContractAdventTargets/getFContractAdventTargets の
    //   候補列挙 (declare 時) と executeAdvent 再検証 (resolve 時) の双方で除外する。
    //   合体/入れ替え側も同じ SSOT (isExcludedByHostExclusiveLock) を再利用し、
    //   5 subsystem 横断で除外判定を共有する (bsdb01-cx01-shinbuddy-brave-swap-lock で実装。
    //   adversarial verifier round1 lens1 指摘: 「合体/入れ替え」は brave_combine/change-swap
    //   に限定されないため contract_combine/brave_swap も含めて対応):
    //   legal-actions-availability.ts の getAvailableBraveCombineLegalActions (通常合体+
    //   異魔神右スロット双方) / getAvailableContractCombineLegalActions (自己完結型+
    //   プロキシ起動型双方) / getAvailableBraveSwapLegalActions (入れ替え先 toHost) と、
    //   accel-change-system.ts の getChangeSwapCandidates (changeCardDef 追加パラメータ経由)。
    // [2,3]【契約煌臨元】= 「煌臨元の間」継続ゲート self_state.in_advent_source を前提に実装済み:
    //   (a)「自分が『破壊効果』を発揮したとき、自分のカウント+1」(2026-06-22 着地)。
    //   (b)「自分の系統:「サイヤ人」によって相手のカードがフィールドを離れるとき、
    //       〔ターンに1回:同名〕ボイドからコア1個を自分のフィールドに置き、自分のスピリット1体
    //       回復」= triggerSourceFilter.tribesRequired + causedByEffectSourceInstanceId →
    //       leave_field family への effectSourceInstanceId 公開で実装 (engine-drain)。
    // needs-dsl.w1.jsonl: BSDB01-CX01 [0,1,2,3] すべて resolved
    //   (真バディ本体/契約煌臨元/host exclusive-lock 3subsystem)。
    hostDualAdventGrant: {
      includeSoulStateOrAdventSource: true,
      slots: [
        { cardNames: [{ contains: "孫悟空" }] },
        { cardNames: [{ contains: "ベジータ" }] },
      ],
      timing: "main_and_flash",
      hostCoreDistributionOnAdvent: true,
      alternateCost: { timing: "main_and_flash" },
      exclusiveToSlots: true,
    },
    effects: [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "effect_steps_resolved",
          actionKinds: ["destroy"],
        },
        condition: [{ kind: "self_state", state: "in_advent_source" }],
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [3, 4],
        applicability: {
          adventSourceHostVariants: ["contract", "f_contract"],
          zone: "advent_source",
        },
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "leave_field",
          triggerSourceFilter: { tribesRequired: ["サイヤ人"] },
          cause: ["opponent_effect", "battle", "opponent_bp_compare"],
          sourceWhose: "either",
        },
        condition: [{ kind: "self_state", state: "in_advent_source" }],
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            id: "void_core_place",
            executionMode: "optional",
            prompt: {
              sourceText:
                "また、自分の系統：「サイヤ人」によって相手のカードがフィールドを離れるとき、〔ターンに1回:同名〕ボイドからコア1個を自分のフィールドに置くことができ、自分のスピリット1体を回復できる。",
            },
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "field_card", player: "self", filter: {} },
              amount: 1,
            },
          },
          {
            connector: "simultaneous",
            executionMode: "optional",
            prompt: {
              sourceText:
                "また、自分の系統：「サイヤ人」によって相手のカードがフィールドを離れるとき、〔ターンに1回:同名〕ボイドからコア1個を自分のフィールドに置くことができ、自分のスピリット1体を回復できる。",
            },
            action: {
              kind: "recover",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [3, 4],
        applicability: {
          adventSourceHostVariants: ["contract", "f_contract"],
          zone: "advent_source",
        },
        executionMode: "optional",
      },
    ],
  },
  {
    cardNo: "BSDB01-M01",
    orikaId: 487,
    orikaIndex: 485,
    name: "超サイヤ人2 孫悟空 -天使-",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 8,
    reductionSymbols: ["red", "red", "red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 14000,
      },
    ],
    printedOverCount: { minCount: 5, bpBonus: 7000 },
    symbolColors: ["red"],
    textLines: [
      "フラッシュ【契約煌臨：「孫悟空」＆カウント5以上『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨時』",
      "このターンの間、このスピリットは相手の効果を受けず、疲労状態でブロックできる。",
      "",
      "【OC条件：カウント5以上】",
      "【OC中】 Lv1-Lv2『お互いのアタックステップ』",
      "このスピリットは相手によって破壊されない。また、バトル終了時、自分のカウント+1する。",
    ],
    keywordTags: ["advent"],
    tribe: "サイヤ人",
    image: "images/BSDB01-M01.webp",
    rarity: "M",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「孫悟空」＆カウント5以上『お互いのアタックステップ』】。
    // 煌臨は CardDefinition.adventData で宣言する（08a L48-59 / 11 L149: AdventData + executeAdvent /
    // declare_advent legal action 配線済み）。契約煌臨は getContractAdventTargets で魂状態の契約スピリットも対象に含む。
    // 『お互いのアタックステップ』= both_attack_step（双方のアタックステップのフラッシュ窓）。
    // 「カウント5以上」の宣言ゲートは AdventData.declareCondition (count_value) で表現する
    // （engine-drain advent-count-gated-declare-condition）。
    // 煌臨先の名前条件「「孫悟空」」は AdventCondition.cardNames で表現する（declareCondition と
    // 独立した field。engine-drain-claude-explore: 名前+カウントゲート併発ギャップ解消）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "孫悟空" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 5 }],
    },
    overCount: { minCount: 5, bpBonus: 7000 },
    effects: [
      // [3,4] Lv1-Lv2『煌臨時』このターン、このスピリットは相手の効果を受けず（effect_immunity）、
      // 疲労状態でブロックできる（allow_block_while_exhausted）。
      // 煌臨宣言は未発火だが、card_event:"advent" 誘発自体は煌臨発生時に発火する経路（11 L149 /
      // registrations）なので、誘発効果としては忠実に配線する。
      {
        timing: { kind: "card_event", event: "advent" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "turn" },
            },
          },
          {
            action: {
              kind: "allow_block_while_exhausted",
              target: { kind: "self" },
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "count_value", player: "self", min: 5 }],
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "destroy",
              source: "opponent",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7, 8],
      },
      // [6,7,8]【OC中】Lv1-Lv2『お互いのアタックステップ』...また、バトル終了時、自分のカウント+1（強制）。
      // 形式4 (10_rules/02:176): game_event:battle_end + player:"either" +
      // requireRelatedInstanceOnField:false。P3-108 dedup 着地済みなので、ブロック成立時も
      // source 1 件につき 1 回だけ発火する。
      {
        timing: {
          kind: "game_event",
          player: "either",
          event: "battle_end",
          requireRelatedInstanceOnField: false,
        },
        condition: [{ kind: "count_value", player: "self", min: 5 }],
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
          },
        ],
        textRef: [6, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSDB01-M02",
    orikaId: 488,
    orikaIndex: 486,
    name: "ピッコロ",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "red", "red"],
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
      {
        level: 3,
        requiredCores: 4,
        bp: 12000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "このカード/スピリットは相手のスタックタイミング元にならない",
      "",
      "〔ターンに1回:同名〕手札にあるこのカードは、自分の「孫悟空」/「ベジータ」が相手の効果の対象になるとき、ただちにコストを支払わずに召喚できる。そうしたとき、その対象をこのスピリットのみにする。または、その効果がスタック効果のとき、アタックステップなら、このターン中の次のバトル終了後まで、相手はスタック効果を発揮できない。",
      "",
      "Lv2-Lv3",
      "〔ゲームに2回:同名〕このスピリットが相手の効果でフィールドを離れるとき、このスピリットを手札に戻すことで、ボイドからコア1個を自分のライフに置くか、自分のトラッシュにある《ソウルコア》を自分のリザーブに置く。",
    ],
    keywordTags: [],
    tribe: "魔人",
    image: "images/BSDB01-M02.webp",
    rarity: "M",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0]「このカード/スピリットは相手のスタックタイミング元にならない」。
    //   場のスピリットは suppress_stack_source CE、自カード側の宣言済み stack source は
    //   applicability: hand/in_use を legal action 側で参照して相手の stack 応答元から除外する。
    // [2]〔ターンに1回:同名〕「手札にあるこのカードは、自分の『孫悟空』/『ベジータ』が相手の効果の
    //   対象になるとき、ただちにコストを支払わずに召喚できる。そうしたとき、その対象をこのスピリットの
    //   みにする。または、その効果がスタック効果のとき、アタックステップなら、このターン中の次の
    //   バトル終了後まで、相手はスタック効果を発揮できない」。targeted disclosure の
    //   continuation に対し redirect_target(mode:"all_current_effect_targets") を適用し、
    //   召喚後のこのスピリットだけへ元効果 target を差し替える。stack 抑止分岐は
    //   choice variant の triggerEffectTiming:"stack" + step_phase attack で同一ターン1回の
    //   二択として提示する。後段は P3-75 implementation notes と同じ読点なし文言なので、
    //   player-scoped ではなく stack 発揮元カード側の effect_source gate として扱う。
    // [5,6,7] Lv2-Lv3〔ゲームに2回:同名〕「このスピリットが相手の効果でフィールドを離れるとき、
    //   このスピリットを手札に戻すことで、ボイドからコア1個を自分のライフに置くか、自分のトラッシュに
    //   ある《ソウルコア》を自分のリザーブに置く」。effect_resistance.replacement(move_to)は
    //   付随ベネフィットを連結できないため使わず、card_event(leave_field, cause:opponent_effect)の
    //   通常 triggered steps で表現: stay_on_field(離脱pending撤回)→move_self(hand)→
    //   core_move二択(void→life 1個 / trash→reserve 1個 effectKind:"explicit_soul_core")。
    //   trash→reserve のソウルコア専用移動は新設 handleTrashToReserve/partitionTrashMoveWithSoul
    //   (structured-core-move.ts) で対応 (2026-07-10, engine-claude,
    //   engine-effect-resistance-replacement-followup-benefit cluster)。
    effects: [
      {
        // [0] このカード/スピリットは相手のスタックタイミング元にならない（継続抑止）。
        timing: { kind: "continuous" },
        applicability: { zone: ["hand", "in_use", "field"] },
        steps: [
          {
            action: {
              kind: "suppress_stack_source",
              target: "self",
              player: "opponent",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "targeted",
          triggerFilter: {
            cardName: [{ contains: "孫悟空" }, { contains: "ベジータ" }],
          },
          cause: ["opponent_effect"],
        },
        applicability: { zone: "hand" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        limitGroupId: "BSDB01-M02-targeted-branch",
        executionMode: "optional",
        steps: [
          {
            id: "piccolo-targeted-branch-summon",
            label: "対象付け替え",
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
            choice: [
              {
                label: "スタック抑止",
                triggerEffectTiming: "stack",
                condition: [
                  { kind: "step_phase", step: "attack", whose: "either" },
                ],
                action: {
                  kind: "summon",
                  target: { kind: "self" },
                  costModifier: "free",
                },
              },
            ],
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_choice",
                  stepId: "piccolo-targeted-branch-summon",
                  choiceIndex: 0,
                },
                {
                  kind: "ref_succeeded",
                  stepId: "piccolo-targeted-branch-summon",
                },
              ],
            },
            action: {
              kind: "redirect_target",
              from: { kind: "trigger_related_instance" },
              to: { kind: "self" },
              mode: "all_current_effect_targets",
            },
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_choice",
                  stepId: "piccolo-targeted-branch-summon",
                  choiceIndex: 1,
                },
                {
                  kind: "ref_succeeded",
                  stepId: "piccolo-targeted-branch-summon",
                },
              ],
            },
            action: {
              kind: "restrict_stack",
              player: "opponent",
              duration: {
                scope: "battle",
                nextBattleEnd: true,
                untilTurnEnd: true,
              },
              targetScope: "effect_source",
              effectFilter: { activatedMode: ["stack"] },
            },
          },
        ],
        textRef: [2],
      },
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: "opponent_effect",
        },
        applicability: { level: { min: 2 } },
        usageLimit: { kind: "per_card_name", duration: "game", maxCount: 2 },
        executionMode: "optional",
        steps: [
          { action: { kind: "stay_on_field", target: { kind: "self" } } },
          {
            action: { kind: "move_self", destination: "hand" },
            id: "return-self",
            connector: "conditional_cost",
          },
          {
            label: "ボイド→ライフ",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 1,
            },
            choice: [
              {
                label: "ソウルコア回収",
                action: {
                  kind: "core_move",
                  from: { kind: "trash", player: "self" },
                  to: { kind: "reserve", player: "self" },
                  amount: 1,
                  effectKind: "explicit_soul_core",
                },
              },
            ],
            connector: "conditional_cost",
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSDB01-R01",
    orikaId: 489,
    orikaIndex: 487,
    name: "超サイヤ人2 孫悟空",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 8,
    reductionSymbols: ["red", "red", "red", "red"],
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
    ],
    printedOverCount: { minCount: 5, bpBonus: 10000 },
    symbolColors: ["red"],
    textLines: [
      "フラッシュ【契約煌臨：「孫悟空」＆カウント2以上『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/アタック時』",
      "〔ターンに1回:同名〕手札にある「ベジータ」1枚を《ソウルコア》をトラッシュに置いたものとして、このスピリットの隣に【契約煌臨】できる。そうしたとき、自分はデッキの上から2枚ドローできる。",
      "",
      "【OC条件：カウント5以上】",
      "【OC中】 Lv1-Lv2『このスピリットのアタック時』",
      "相手のネクサス/創界神ネクサス2つまでを破壊できる。",
    ],
    keywordTags: ["advent"],
    tribe: "サイヤ人",
    image: "images/BSDB01-R01.webp",
    rarity: "R",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「孫悟空」＆カウント2以上『自分のターン』】。
    // 煌臨は CardDefinition.adventData で宣言する（08a / Phase C / declare_advent 配線済み）。
    // 『自分のターン』= own_turn（自ターンのメイン/フラッシュ窓）。adventVariant: contract。
    // 「カウント2以上」の宣言ゲートは AdventData.declareCondition (count_value) で表現する
    // （engine-drain advent-count-gated-declare-condition）。
    // 煌臨先の名前条件「孫悟空」は AdventCondition.cardNames で表現する（declareCondition と
    // 独立した field。engine-drain-claude-explore: 名前+カウントゲート併発ギャップ解消）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "孫悟空" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 2 }],
    },
    overCount: { minCount: 5, bpBonus: 10000 },
    effects: [
      // [3,4] Lv1-Lv2『煌臨/アタック時』〔ターン1回:同名〕手札の「ベジータ」1枚を《ソウルコア》を
      // トラッシュに置いたものとして共有CX01の反対側に【契約煌臨】→成立時デッキ上2枚ドロー (08a6)。
      // ENGINE-effect-triggered-advent-declare primitive (advent step action) を使用。
      // 発揮有無は effect.executionMode、成立後の2ドロー可否は後続 step.executionMode で表す。
      // 「そうしたとき」= 煌臨成立が前提の conditional_result のため
      // stepCondition:ref_succeeded で後続ドローを gate する。
      {
        timing: { kind: "card_event", event: ["advent", "attack"] },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            id: "advent-vegeta",
            action: {
              kind: "advent",
              placement: "adjacent",
              target: {
                kind: "filter",
                player: "self",
                zone: "hand",
                filter: { cardName: { contains: "ベジータ" } },
                count: 1,
              },
              useAlternateCost: true,
            },
          },
          {
            id: "draw-after-advent",
            connector: "sequential",
            executionMode: "optional",
            stepCondition: { kind: "ref_succeeded", stepId: "advent-vegeta" },
            action: { kind: "draw", count: 2 },
          },
        ],
        textRef: [3, 4],
      },
      // [7,8]【OC条件:カウント5以上】【OC中】『アタック時』相手のネクサス/創界神ネクサス2つまでを破壊（任意）。
      // 「2つまで」= count {min:0,max:2}。創界神ネクサスを対象に含むため targetsGrandwalker:true。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "count_value", player: "self", min: 5 }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"], targetsGrandwalker: true },
                count: { min: 0, max: 2 },
              },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSDB01-R02",
    orikaId: 490,
    orikaIndex: 488,
    name: "超サイヤ人2 ベジータ",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 7,
    reductionSymbols: ["blue", "blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 12000,
      },
    ],
    printedOverCount: { minCount: 5, bpBonus: 8000 },
    symbolColors: ["blue"],
    textLines: [
      "フラッシュ【契約煌臨：「ベジータ」＆カウント2以上『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/アタック時』",
      "〔ターンに1回:同名〕自分はデッキの上から3枚ドローできる。ドロー後、自分は手札2枚を破棄する。その後、トラッシュにある「孫悟空」1枚をこのスピリットの隣に【契約煌臨】できる。",
      "",
      "【OC条件：カウント5以上】",
      "【OC中】 Lv1-Lv2『このスピリットのアタック時』",
      "このスピリットのコスト以下の相手のスピリット1体を破壊できる。",
    ],
    keywordTags: ["advent"],
    tribe: "サイヤ人",
    image: "images/BSDB01-R02.webp",
    rarity: "R",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「ベジータ」＆カウント2以上『自分のターン』】。
    // 煌臨は CardDefinition.adventData で宣言する（08a / Phase C / declare_advent 配線済み）。
    // 『自分のターン』= own_turn。adventVariant: contract。
    // 「カウント2以上」の宣言ゲートは AdventData.declareCondition (count_value) で表現する
    // （engine-drain advent-count-gated-declare-condition）。
    // 煌臨先の名前条件「ベジータ」は AdventCondition.cardNames で表現する（declareCondition と
    // 独立した field。engine-drain-claude-explore: 名前+カウントゲート併発ギャップ解消）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "ベジータ" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 2 }],
    },
    overCount: { minCount: 5, bpBonus: 8000 },
    effects: [
      {
        timing: { kind: "card_event", event: ["advent", "attack"] },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: { kind: "draw", count: 3 },
            id: "draw",
            executionMode: "optional",
          },
          {
            action: { kind: "discard", player: "self", count: 2 },
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "draw" },
          },
          {
            id: "advent-goku",
            connector: "sequential",
            executionMode: "optional",
            action: {
              kind: "advent",
              placement: "adjacent",
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                filter: { cardName: { contains: "孫悟空" } },
                count: 1,
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      // [7,8]【OC条件:カウント5以上】【OC中】『アタック時』このスピリットのコスト以下の相手スピ1体破壊（任意）。
      //   「このスピリットのコスト以下」= 動的 maxCost=自身の実効コスト（印字 def.cost=7 と
      //   作用中の additional_cost CE「コストはXとしても扱う」の最大値）を
      //   maxCostSource:"self_effective_cost" で解決時に注入する（resolveSelfCostThreshold）。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "count_value", player: "self", min: 5 }],
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
                  maxCostSource: "self_effective_cost",
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSDB01-R03",
    orikaId: 491,
    orikaIndex: 489,
    name: "ファイナルフラッシュ",
    printedCategory: "magic",
    colors: ["red", "blue"],
    cost: 7,
    reductionSymbols: ["red", "red", "blue", "blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "手札/トラッシュにあるこのカードは、自分の「ベジータ」がアタックしている間、コスト3になり、トラッシュからも使用できる。",
      "",
      "フラッシュ",
      "〔ターンに1回:同名〕このターンの間、自分の「ベジータ」すべてに、“『このスピリットのアタック時』バトル終了時、自分のカウント9以上で、相手のフィールドに魂状態以外のカードがあれば、相手のライフのコア2個をトラッシュに置く。”を与える。",
    ],
    keywordTags: ["soul_state"],
    tribe: "サイヤ人",
    image: "images/BSDB01-R03.webp",
    rarity: "R",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // ファイナルフラッシュ。[0][2,3] とも表現済み。
    effects: [
      // [0]「手札/トラッシュにあるこのカードは、自分の『ベジータ』がアタックしている間、
      //   コスト3になり、トラッシュからも使用できる」。
      //   コスト固定は continuous cost_modify 自己上書き（BSSL01-X03 と同型パターン、
      //   engine-magic-trash-use-permission）。手札/トラッシュいずれでも、条件成立中は
      //   コストが一律3になる（下の [2,3] 通常/トラッシュ両 registration に等しく適用）。
      {
        applicability: { zone: ["hand", "trash"] },
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "ベジータ" }],
            battleState: "attacking",
          },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { override: 3 },
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            // 〔ターンに1回:同名〕はこのマジックの発揮を制限する。引用符内は各
            // ベジータへ付与する独立誘発なので、その本文範囲を明示して親制限を
            // grantedEffect に継承させない（fidelity constraint carrier）。
            prompt: {
              sourceText:
                "『このスピリットのアタック時』バトル終了時、自分のカウント9以上で、相手のフィールドに魂状態以外のカードがあれば、相手のライフのコア2個をトラッシュに置く。",
            },
            action: {
              kind: "grant_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { cardName: [{ contains: "ベジータ" }] },
                count: "all",
              },
              duration: { scope: "turn" },
              grantedEffect: {
                timing: { kind: "card_event", event: "battle_end" },
                condition: [
                  { kind: "in_battle", state: "attacking" },
                  { kind: "count_value", player: "self", min: 9 },
                  { kind: "field_has", player: "opponent", minCount: 1 },
                ],
                executionMode: "mandatory",
                steps: [
                  {
                    action: {
                      kind: "core_move",
                      from: { kind: "life", player: "opponent" },
                      to: { kind: "trash", player: "opponent" },
                      amount: 2,
                    },
                  },
                ],
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        applicability: { zone: ["trash"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "ベジータ" }],
            battleState: "attacking",
          },
        ],
        timing: { kind: "activated", mode: "flash" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            // トラッシュ使用 variant でも、使用制限は外側のマジックだけに属する。
            prompt: {
              sourceText:
                "『このスピリットのアタック時』バトル終了時、自分のカウント9以上で、相手のフィールドに魂状態以外のカードがあれば、相手のライフのコア2個をトラッシュに置く。",
            },
            action: {
              kind: "grant_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { cardName: [{ contains: "ベジータ" }] },
                count: "all",
              },
              duration: { scope: "turn" },
              grantedEffect: {
                timing: { kind: "card_event", event: "battle_end" },
                condition: [
                  { kind: "in_battle", state: "attacking" },
                  { kind: "count_value", player: "self", min: 9 },
                  { kind: "field_has", player: "opponent", minCount: 1 },
                ],
                executionMode: "mandatory",
                steps: [
                  {
                    action: {
                      kind: "core_move",
                      from: { kind: "life", player: "opponent" },
                      to: { kind: "trash", player: "opponent" },
                      amount: 2,
                    },
                  },
                ],
              },
            },
          },
        ],
        textRef: [0, 2, 3],
      },
    ],
  },
  {
    cardNo: "BSDB01-R04",
    orikaId: 492,
    orikaIndex: 490,
    name: "超元気玉",
    printedCategory: "magic",
    colors: ["red", "blue"],
    cost: 3,
    reductionSymbols: ["red", "blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュにあるこのカードはセットできる。",
      "",
      "【ミラージュ：コスト1（このカードは手札からセットできる）】",
      "",
      "【セット中】『相手のエンドステップ』",
      "〔ゲームに1回:同名〕本来のコスト9以上の自分の「ベジータ」がいるとき、自分のカウント21以上なら、相手のフィールドのスピリット/アルティメット/ネクサス/創界神ネクサス/マジックすべてをデッキの下に戻せる。この効果で戻した対象はフィールドに残せず、この効果は相手の効果では防げない。",
      "",
      "フラッシュ",
      "自分はデッキの上から1枚ドローし、セットしている自分のミラージュがなければ、このカードをコストを支払わずにセットする。",
    ],
    keywordTags: [],
    tribe: "サイヤ人",
    image: "images/BSDB01-R04.webp",
    rarity: "R",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    mirageData: { cost: 1, reduction: [], canSetFromTrash: true },
    // 超元気玉。[0] トラッシュからも通常ミラージュセット可能、[2]【ミラージュ：コスト1】。
    // [4,5]【セット中】『相手のエンドステップ』〔ゲーム1回:同名〕「本来のコスト9以上の自分の『ベジータ』が
    //   いるとき、自分のカウント21以上なら、相手のフィールドのスピリット/アルティメット/ネクサス/
    //   創界神ネクサス/マジックすべてをデッキの下に戻せる。戻した対象はフィールドに残せず、相手の効果で
    //   防げない」。対象をデッキ下へ戻し、フィールド残留耐性だけを貫通する。
    // [7,8] フラッシュ: ドロー1枚後、セットしている自分のミラージュがなければこのカードをコストなしでセット。
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "draw", count: 1 } },
          {
            action: {
              kind: "set_self_as_mirage",
              onlyIfNoMirage: true,
            },
          },
        ],
        textRef: [7, 8],
      },
      {
        timing: {
          kind: "phase",
          step: "end",
          whose: "opponent",
          subPhase: "end",
        },
        applicability: { zone: "mirage_set" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "game", maxCount: 1 },
        preventionLevel: "unpreventable",
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "ベジータ" }],
            minCost: 9,
            costBasis: "printed",
          },
          { kind: "count_value", player: "self", min: 21 },
        ],
        steps: [
          {
            id: "bottom-deck-all",
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate", "nexus", "magic"],
                  targetsGrandwalker: true,
                },
                count: "all",
              },
              position: "bottom",
              pierceCannotLeaveField: true,
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSDB01-TX01(A)",
    orikaId: 495,
    orikaIndex: 491,
    name: "超サイヤ人3 孫悟空＆超サイヤ人2 ベジータ-天使-",
    printedCategory: "spirit",
    colors: ["red", "blue"],
    cost: 9,
    reductionSymbols: ["red", "red", "red", "blue", "blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 9000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 15000,
      },
    ],
    printedOverCount: { minCount: 10, bpBonus: 9000 },
    symbolColors: ["red", "blue"],
    textLines: [
      "フラッシュ【契約煌臨：「孫悟空」/「ベジータ」＆カウント10以上『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2",
      "このスピリットはアタックするかわりに裏返せる。このとき、自分のカウント+3する。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/アタック時』",
      "このスピリットのコスト以下の相手のスピリット/アルティメット2体までを破壊できる。",
      "",
      "【OC条件：カウント10以上】",
      "Lv2『自分のアタックステップ』",
      "自分のカウント10以上の間、アタックしているこのスピリットは、ブロックされず、相手の効果を受けず、シンボルを赤2つと青2つに固定する。",
    ],
    keywordTags: ["double_sided", "advent"],
    tribe: "サイヤ人",
    image: "images/BSDB01-TX01(A).webp",
    rarity: "TX",
    pack: "BSDB01 ドラゴンボールZ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「孫悟空」/「ベジータ」＆カウント10以上『自分のターン』】。
    // 煌臨は CardDefinition.adventData で宣言する（08a / Phase C / declare_advent 配線済み）。
    // 『自分のターン』= own_turn。adventVariant: contract。
    // 「カウント10以上」の宣言ゲートは AdventData.declareCondition (count_value) で表現する
    // （engine-drain advent-count-gated-declare-condition）。
    // 煌臨先の名前条件「孫悟空」/「ベジータ」は AdventCondition.cardNames（OR 配列）で表現する
    // （declareCondition と独立した field。engine-drain-claude-explore: 名前+カウントゲート併発ギャップ解消）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "孫悟空" }, { contains: "ベジータ" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 10 }],
    },
    // [3,4] Lv1-Lv2「このスピリットはアタックするかわりに裏返せる。このとき、自分のカウント+3する」。
    //   アタック宣言の代替宣言 (CardDefinition.attackAlternativeFlip、legal-actions-availability.ts
    //   getAvailableFlipInsteadOfAttackLegalActions / LegalActionKind "flip_instead_of_attack")。
    //   カウント+3のみを適用し、転醒(RebirthAction)のB面共通印字文言由来の自動+1は適用しない
    //   （このカードのB面 textLines にその定型文が無いため。needs-ruling.jsonl:BSDB01-TX01(A)）。
    attackAlternativeFlip: {
      countIncreaseAmount: 3,
    },
    overCount: { minCount: 10, bpBonus: 9000 },
    effects: [
      // [6,7] Lv1-Lv2『煌臨/アタック時』このスピリットのコスト以下の相手のスピリット/アルティメット2体までを破壊。
      //   「このスピリットのコスト以下」= 動的 maxCost=自身の実効コスト（印字 def.cost=9 と
      //   作用中の additional_cost CE の最大値）を maxCostSource:"self_effective_cost" で
      //   解決時に注入する（resolveSelfCostThreshold）。
      //   「2体まで」= count {min:0,max:2}。
      {
        timing: { kind: "card_event", event: ["advent", "attack"] },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxCostSource: "self_effective_cost",
                },
                count: { min: 0, max: 2 },
              },
            },
          },
        ],
        textRef: [6, 7],
      },
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "count_value", player: "self", min: 10 },
          {
            kind: "self_state",
            reference: "self",
            battleState: "attacking",
            state: "on_field",
          },
        ],
        steps: [
          {
            action: {
              kind: "unblockable",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: {
                symbols: ["red", "red", "blue", "blue"],
                symbolCountFixed: true,
              },
              duration: { scope: "while_on_field" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [9, 10, 11],
        timingScope: { player: "self", period: "attack" },
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "孫悟空＆ベジータ",
      printedCategory: "spirit",
      colors: ["red", "blue"],
      cost: 9,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 1,
          bp: 12000,
        },
        {
          level: 2,
          requiredCores: 3,
          bp: 15000,
        },
      ],
      printedOverCount: { minCount: 14, bpBonus: 20000 },
      symbolColors: ["red", "blue"],
      textLines: [
        "Lv1-Lv2",
        "このスピリットはアタックできず、《ソウルコア》以外のコアを取り除けない。また、このスピリットは「ブロックされない」相手のスピリット/アルティメットすべてをブロックできる。",
        "",
        "Lv1-Lv2",
        "自分のカウント14以上の間、自分によって相手のスピリット/アルティメット/ネクサスがフィールドを離れたとき、",
        "このスピリットを回復させるか、〔ステップに1回:同名〕自分はデッキの上から2枚ドローできる。",
        "この効果発揮後、相手のフィールドにカードがないとき、このスピリットを裏返せる。",
      ],
      keywordTags: [],
      tribe: "サイヤ人",
      image: "images/BSDB01-TX01(B).webp",
      rarity: "TX",
      pack: "BSDB01 ドラゴンボールZ",
      cardNo: "BSDB01-TX01(B)",
      effects: [
        {
          timing: { kind: "continuous" },
          condition: [{ kind: "min_level", value: 1 }],
          steps: [
            {
              action: {
                kind: "prevent_battle",
                target: { kind: "self" },
                restriction: ["attack"],
                duration: { scope: "while_on_field" },
              },
            },
            {
              connector: "simultaneous",
              action: {
                kind: "prevent_normal_core_move",
                target: { kind: "self" },
                duration: { scope: "while_on_field" },
              },
            },
            {
              connector: "simultaneous",
              action: {
                kind: "block_unblockable",
                target: { kind: "self" },
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [0, 1],
        },
        {
          timing: {
            kind: "game_event",
            player: "opponent",
            event: "leave_field",
            triggerFilter: { category: ["spirit", "ultimate", "nexus"] },
            cause: ["opponent_effect", "battle", "opponent_bp_compare"],
            sourceWhose: "either",
            exactEventKind: true,
          },
          condition: [
            { kind: "min_level", value: 1 },
            { kind: "count_value", player: "self", min: 14 },
          ],
          steps: [
            {
              id: "recover_or_draw",
              label: "回復",
              action: { kind: "recover", target: { kind: "self" } },
              choice: [
                {
                  label: "2枚ドロー",
                  prompt: {
                    sourceText:
                      "〔ステップに1回:同名〕自分はデッキの上から2枚ドローできる。",
                  },
                  usageLimit: { kind: "per_card_name", duration: "step" },
                  action: { kind: "draw", player: "self", count: 2 },
                },
              ],
            },
            {
              connector: "after_triggers",
              executionMode: "optional",
              condition: [
                { kind: "field_card_count", player: "opponent", max: 0 },
              ],
              action: { kind: "reverse_rebirth", mode: "flip" },
            },
          ],
          textRef: [3, 4, 5, 6],
        },
      ],
      overCount: { minCount: 14, bpBonus: 20000 },
    },
  },
  {
    cardNo: "BSDB01-X01",
    orikaId: 493,
    orikaIndex: 492,
    name: "超サイヤ人3 孫悟空",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 9,
    reductionSymbols: ["red", "red", "red", "red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 9000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 17000,
      },
    ],
    printedOverCount: { minCount: 9, bpBonus: 17000 },
    symbolColors: ["red", "red"],
    textLines: [
      "フラッシュ【契約煌臨：「孫悟空」＆カウント7以上『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2",
      "自分のカウント1につき、自分の「孫悟空」すべてをBP+1000する。自分のターン中、自分の「孫悟空」すべては、相手の効果で破壊されない。",
      "",
      "【煌臨中】Lv1-Lv2『このスピリットのアタック時』",
      "相手のフィールドに魂状態以外のカードがあるとき、BP合計(このスピリットのBP)まで相手のスピリット/アルティメットを好きなだけ破壊する。1体以上破壊したとき、ターンに1回、自分のカウント9以上でこのスピリットがLv2かつBP40000以上なら、相手のライフのコア1個をリザーブに置ける。",
    ],
    keywordTags: ["advent", "soul_state"],
    tribe: "サイヤ人",
    image: "images/BSDB01-X01.webp",
    rarity: "X",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「孫悟空」＆カウント7以上『自分のターン』】。
    // 煌臨は CardDefinition.adventData で宣言する（08a / Phase C / declare_advent 配線済み）。
    // 『自分のターン』= own_turn。adventVariant: contract。
    // 「カウント7以上」の宣言ゲートは AdventData.declareCondition (count_value) で表現する
    // （engine-drain advent-count-gated-declare-condition）。
    // 煌臨先の名前条件「孫悟空」は AdventCondition.cardNames で表現する（declareCondition と
    // 独立した field。engine-drain-claude-explore: 名前+カウントゲート併発ギャップ解消）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "孫悟空" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 7 }],
    },
    overCount: { minCount: 9, bpBonus: 17000 },
    effects: [
      // [3,4] Lv1-Lv2 前段「自分のカウント1につき、自分の『孫悟空』すべてをBP+1000する」=
      //   count_value に比例した *継続* BP 増加。bp_modify の amount に DynamicCount
      //   (count_value × 1000) を載せ、while_on_field の「すべて」(count:-1) CE として登録する。
      //   modifierAmountDynamic で BP 計算時に live 評価される（カウント変動に追従）。
      //   後段「自分のターン中、自分の『孫悟空』すべては、相手の効果で破壊されない」=
      //   timingScope self/turn の effect_resistance。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "self",
                filter: { cardName: [{ contains: "孫悟空" }] },
                count: "all",
              },
              amount: {
                source: { kind: "count_value", player: "self" },
                multiplier: 1000,
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "turn" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "filter",
                player: "self",
                filter: { cardName: [{ contains: "孫悟空" }] },
                count: "all",
              },
              resistsOutcome: "destroy",
              source: "opponent_effect",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [
          { kind: "self_state", state: "advented" },
          { kind: "field_has", player: "opponent", minCount: 1 },
        ],
        executionMode: "optional",
        steps: [
          {
            id: "bp-budget-destroy",
            targetSelectionTiming: "on_step",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: { min: 0 },
                budget: {
                  metric: "bp",
                  amount: { source: { kind: "source_effective_bp" } },
                },
              },
            },
          },
          {
            connector: "after_state_check",
            stepCondition: {
              kind: "ref_count",
              stepId: "bp-budget-destroy",
              min: 1,
            },
            condition: [
              { kind: "count_value", player: "self", min: 9 },
              { kind: "min_level", value: 2 },
              { kind: "self_state", state: "on_field" },
              { kind: "self_bp", min: 40000 },
            ],
            usageLimit: { kind: "per_instance", duration: "turn" },
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSDB01-X02",
    orikaId: 494,
    orikaIndex: 493,
    name: "超サイヤ人2 ベジータ -天使-",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 7,
    reductionSymbols: ["blue", "blue", "blue", "blue"],
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
    ],
    printedOverCount: { minCount: 7, bpBonus: 8000 },
    symbolColors: ["blue"],
    textLines: [
      "フラッシュ【契約煌臨：「ベジータ」＆カウント4以上『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/アタック時』",
      "本来のコスト8以下の相手のスピリット/アルティメット2体までを破壊できる。自分のカウント7以上のとき、この効果は相手の効果では防げない。",
      "",
      "【OC条件：カウント7以上】",
      "【OC中＆煌臨中】 Lv1-Lv2『自分のアタックステップ』",
      "自分の「孫悟空」がいる間、相手は、自分のカウント7につき3コスト余分に支払わなければ、スタックタイミング以外でマジックカードを使用できない。",
    ],
    keywordTags: ["advent"],
    tribe: "サイヤ人",
    image: "images/BSDB01-X02.webp",
    rarity: "X",
    pack: "BSDB01 ドラゴンボールZ",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「ベジータ」＆カウント4以上『お互いのアタックステップ』】。
    // 煌臨は CardDefinition.adventData で宣言する（08a / Phase C / declare_advent 配線済み）。
    // 『お互いのアタックステップ』= both_attack_step。adventVariant: contract。
    // 「カウント4以上」の宣言ゲートは AdventData.declareCondition (count_value) で表現する
    // （engine-drain advent-count-gated-declare-condition）。
    // 煌臨先の名前条件「ベジータ」は AdventCondition.cardNames で表現する（declareCondition と
    // 独立した field。engine-drain-claude-explore: 名前+カウントゲート併発ギャップ解消）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "ベジータ" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 4 }],
    },
    overCount: { minCount: 7, bpBonus: 8000 },
    effects: [
      // [3,4] Lv1-Lv2『煌臨/アタック時』本来のコスト8以下の相手のスピリット/アルティメット2体までを破壊（任意）。
      //   「本来のコスト8以下」= 印字コストの静的閾値 maxCost:8（card-filter は def.cost を見るので
      //   「本来のコスト」に一致）。「2体まで」= count {min:0,max:2}。
      //   後段「自分のカウント7以上のとき、この効果は相手の効果では防げない」= 条件付き防止不可。
      //   preventionLevel:"unpreventable" + preventionLevelCondition（count_value self>=7）で表現。
      //   解決時にカウント7以上なら cannot_*/defense_immune を貫通、未満なら通常の防止可能破壊。
      {
        timing: { kind: "card_event", event: ["advent", "attack"] },
        executionMode: "optional",
        preventionLevel: "unpreventable",
        preventionLevelCondition: [
          { kind: "count_value", player: "self", min: 7 },
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
                  maxCost: 8,
                  costBasis: "printed",
                },
                count: { min: 0, max: 2 },
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      // [6,7,8]【OC条件:カウント7以上】【OC中＆煌臨中】『自分のアタックステップ』孫悟空がいる間、相手は
      //   カウント7につき3コスト余分に支払わなければスタックタイミング以外でマジックを使用できない。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 1, max: 2 } },
        timingScope: { player: "self", period: "attack" },
        condition: [
          { kind: "count_value", player: "self", min: 7 },
          { kind: "self_state", state: "advented" },
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "孫悟空" }],
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "opponent",
              additionalPayment: true,
              cardFilter: {
                category: ["magic"],
                usingEffectMode: ["main", "flash"],
              },
              modifier: {
                additionalCostValue: {
                  source: { kind: "count_value", player: "self" },
                  divisor: 7,
                  groupMultiplier: 3,
                },
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7, 8],
      },
    ],
  },
];
