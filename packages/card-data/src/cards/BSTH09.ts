import type { CardDefinition } from "@orica/rules-core";

export const BSTH09_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH09-C01",
    orikaId: 234,
    orikaIndex: 243,
    name: "[輝針城]チルノ",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["six"],
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
      "Lv1-Lv2『自分のメインステップ』",
      "このスピリットを疲労させることで、自分のデッキを上から4枚オープンできる。その中のカード名：「柱斧」1枚までと、カード名：「少名 針妙丸」1枚までと、系統：「妖戒」を持つカード1枚までを手札/手元と入れ替えられる。オープンしたカードはデッキの下に戻す。",
      "",
      "Lv1-Lv2",
      "このスピリットが疲労したか、相手によってフィールドを離れるとき、自分のカウント+1できる。",
    ],
    keywordTags: [],
    tribe: "幻想・妖精・妖戒",
    image: "images/BSTH09-C01.webp",
    rarity: "C",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『自分のメインステップ』疲労させ、デッキ4オープン、柱斧/針妙丸/妖戒を手札/手元と入れ替え。残りデッキ下。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
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
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  count: 1,
                  filter: { cardName: { exact: "柱斧" } },
                  destination: "hand_or_set_aside_swap",
                },
                {
                  count: 1,
                  filter: { cardName: { exact: "少名 針妙丸" } },
                  destination: "hand_or_set_aside_swap",
                },
                {
                  count: 1,
                  filter: { tribes: ["妖戒"] },
                  destination: "hand_or_set_aside_swap",
                },
              ],
              remainder: "bottom",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2 「疲労したとき」分: cause 制限なし（自他いずれの疲労原因でも発火）。
      {
        timing: { kind: "card_event", event: "exhaust" },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2 「相手によってフィールドを離れるとき」分:
      // cause=["opponent_effect","battle"] (memory project_core_removal_vanish_opponent_cause)。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH09-C02",
    orikaId: 235,
    orikaIndex: 244,
    name: "わかさぎ姫",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["six"],
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
      "Lv1-Lv2『自分のメインステップ』",
      "このスピリットを疲労させることで、自分のデッキを上から4枚オープンできる。その中のカード名：「柱斧」1枚までと、カード名：「少名 針妙丸」1枚までと、系統：「妖戒」を持つカード1枚までを手札/手元と入れ替えられる。オープンしたカードはデッキの下に戻す。",
      "",
      "Lv1-Lv2",
      "このスピリットが疲労したか、相手によってフィールドを離れるとき、自分のカウント+1できる。",
    ],
    keywordTags: [],
    tribe: "幻想・溶魚・妖戒",
    image: "images/BSTH09-C02.webp",
    rarity: "C",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『自分のメインステップ』疲労させ、デッキ4オープン、柱斧/針妙丸/妖戒を手札/手元と入れ替え。残りデッキ下。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
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
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  count: 1,
                  filter: { cardName: { exact: "柱斧" } },
                  destination: "hand_or_set_aside_swap",
                },
                {
                  count: 1,
                  filter: { cardName: { exact: "少名 針妙丸" } },
                  destination: "hand_or_set_aside_swap",
                },
                {
                  count: 1,
                  filter: { tribes: ["妖戒"] },
                  destination: "hand_or_set_aside_swap",
                },
              ],
              remainder: "bottom",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2 「疲労したとき」分: cause 制限なし（自他いずれの疲労原因でも発火）。
      {
        timing: { kind: "card_event", event: "exhaust" },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2 「相手によってフィールドを離れるとき」分:
      // cause=["opponent_effect","battle"] (memory project_core_removal_vanish_opponent_cause)。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH09-C03",
    orikaId: 236,
    orikaIndex: 245,
    name: "赤 蓮奇",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "six"],
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
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のカウント+1できる。自分のデッキを上から5枚オープンできる。その中のカード名：「柱斧」1枚までとカード名：「少名 針妙丸」1枚までと系統：「妖戒」を持つカード1枚までを手札/手元と入れ替えられる。オープンしたカードはデッキの下に戻す。",
      "",
      "Lv1-Lv2-Lv3",
      "ターンに1回、このスピリットは、疲労せずにアタック/ブロックできる。さらに、相手によってフィールドを離れるとき、ターンに1回、同じ状態でフィールドに残せる。",
    ],
    keywordTags: [],
    tribe: "幻想・妖戒",
    image: "images/BSTH09-C03.webp",
    rarity: "C",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』カウント+1できる。デッキ5オープン、柱斧/針妙丸/妖戒を手札/手元と入れ替え。残りデッキ下。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            executionMode: "optional",
          },
          {
            action: {
              kind: "deck_reveal",
              revealCount: 5,
              picks: [
                {
                  count: 1,
                  filter: { cardName: { exact: "柱斧" } },
                  destination: "hand_or_set_aside_swap",
                },
                {
                  count: 1,
                  filter: { cardName: { exact: "少名 針妙丸" } },
                  destination: "hand_or_set_aside_swap",
                },
                {
                  count: 1,
                  filter: { tribes: ["妖戒"] },
                  destination: "hand_or_set_aside_swap",
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
      // Lv1-Lv2-Lv3 ターンに1回 疲労せずアタック/ブロック（タップ無しアタック、
      //   allow_tapless_battle_declare、engine-attack-declare-exhaust-override）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "allow_tapless_battle_declare",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2-Lv3「さらに、相手によってフィールドを離れるとき、ターンに1回、同じ状態で
      //   フィールドに残せる。」SSOT流用: BSTH03-X01[5,6]/BSTH02-X05 と同型の
      //   card_event(leave_field, cause opponent) + stay_on_field。newExhaustState省略=
      //   「同じ状態で」。「ターンに1回」は上のタップ無しアタック/ブロックとは別予算のため
      //   occurrenceGate(duration:turn, targetCount:1) (ENGINE-nth-occurrence-trigger-gate)
      //   で1ターン目の観測のみに限定する（generic tally、専用フィールド不要）。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        usageLimit: { kind: "per_instance", duration: "turn" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "stay_on_field",
              target: { kind: "self" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH09-C04",
    orikaId: 237,
    orikaIndex: 246,
    name: "今泉 影狼",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "six"],
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
    symbolColors: ["red"],
    textLines: [
      "v1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のカウント+1できる。自分のデッキを上から5枚オープンできる。その中のカード名：「柱斧」1枚までとカード名：「少名 針妙丸」1枚までと系統：「妖戒」を持つカード1枚までを手札/手元と入れ替えられる。オープンしたカードはデッキの下に戻す。",
      "",
      "Lv1-Lv2-Lv3【追撃】『自分のアタックステップ』",
      "疲労状態のこのスピリットは、重疲労させることでアタックできる。",
    ],
    keywordTags: [],
    tribe: "幻想・妖戒",
    image: "images/BSTH09-C04.webp",
    rarity: "C",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』カウント+1できる。デッキ5オープン、柱斧/針妙丸/妖戒を手札/手元と入れ替え。残りデッキ下。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            executionMode: "optional",
          },
          {
            action: {
              kind: "deck_reveal",
              revealCount: 5,
              picks: [
                {
                  count: 1,
                  filter: { cardName: { exact: "柱斧" } },
                  destination: "hand_or_set_aside_swap",
                },
                {
                  count: 1,
                  filter: { cardName: { exact: "少名 針妙丸" } },
                  destination: "hand_or_set_aside_swap",
                },
                {
                  count: 1,
                  filter: { tribes: ["妖戒"] },
                  destination: "hand_or_set_aside_swap",
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
      // Lv1-Lv2-Lv3【追撃】『自分のアタックステップ』疲労状態のこのスピリットは
      //   重疲労させることでアタックできる（allow_attack_while_exhausted、
      //   engine-attack-declare-exhaust-override）。同時アタックへの join 経路は
      //   カード文言が想定する単体アタック宣言の範囲外のため対象外（今後別 cluster）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "allow_attack_while_exhausted",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH09-C05",
    orikaId: 238,
    orikaIndex: 247,
    name: "輝針城",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "six"],
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
      "Lv1-Lv2『このネクサスの配置時』",
      "自分のカウント+1できる。自分のデッキを上から5枚オープンできる。その中のカード名：「柱斧」1枚までとカード名：「少名 針妙丸」1枚までと系統：「妖戒」を持つカード1枚までを手札/手元と入れ替えられる。オープンしたカードはデッキの下に戻す。",
      "",
      "Lv2『自分のメインステップ』",
      "〔ターンに1回：同名〕トラッシュにある系統：「勇傑」/「付喪」/「妖戒」を持つカード1枚をデッキの下に戻せる。そうしたとき、このターンの間、自分はデッキの上からしかドロー/オープンできない。",
    ],
    keywordTags: [],
    tribe: "幻想・勇傑",
    image: "images/BSTH09-C05.webp",
    rarity: "C",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このネクサスの配置時』カウント+1できる。デッキ5オープン、柱斧/針妙丸/妖戒を手札/手元と入れ替え。残りデッキ下。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            executionMode: "optional",
          },
          {
            action: {
              kind: "deck_reveal",
              revealCount: 5,
              picks: [
                {
                  count: 1,
                  filter: { cardName: { exact: "柱斧" } },
                  destination: "hand_or_set_aside_swap",
                },
                {
                  count: 1,
                  filter: { cardName: { exact: "少名 針妙丸" } },
                  destination: "hand_or_set_aside_swap",
                },
                {
                  count: 1,
                  filter: { tribes: ["妖戒"] },
                  destination: "hand_or_set_aside_swap",
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
      // Lv2『自分のメインステップ』ターン1回(同名)、トラッシュの勇傑/付喪/妖戒1枚をデッキ下へ。そうしたらこのターンは上からのみドロー/オープン。
      {
        timing: { kind: "activated", mode: "main" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "move_card",
              from: {
                zone: "trash",
                player: "self",
                filter: { tribes: ["勇傑", "付喪", "妖戒"] },
              },
              to: { zone: "deck", position: "bottom" },
              count: 1,
            },
          },
          {
            connector: "conditional_result",
            action: {
              kind: "restrict_draw_to_top",
              player: "self",
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH09-M01",
    orikaId: 239,
    orikaIndex: 248,
    name: "[紅い悪魔のメイド]十六夜咲夜",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 6,
    reductionSymbols: ["white", "white", "white", "six"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 11000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "系統：「勇傑」/「妖戒」を持つ効果でデッキからオープンされたこのカードは、自分のバーストがセットされていなければ、セットできる。",
      "",
      "【バースト：自分のライフ減少後】",
      "このカードをコストを支払わずに召喚する。その後、このバトル終了時、アタックステップを終了する。",
      "",
      "Lv1-Lv2『自分のメインステップ』",
      "このスピリットに赤のシンボル1つを追加する。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・戦姫",
    image: "images/BSTH09-M01.webp",
    rarity: "M",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 勇傑/妖戒効果でオープンされたこのカードは、バースト未セットならセットできる。
      // 「セットできる」可能形=任意。card_event 系 default 非対称回避のため per-effect 明示
      // (10_rules/03c ruling C 2026-06-24)。trigger_tribes は BSFT01-C02 と同型
      // （オープンを引き起こした効果側の系統判定・07b §6）。set_as_burst は revealed_choice
      // 経由で手札を経由せずバーストゾーンへ直行する新規 disposition (engine-burst-set-runtime-transition)。
      {
        timing: { kind: "card_event", event: "revealed" },
        cardEventDisposition: { kind: "set_as_burst" },
        condition: [
          { kind: "trigger_tribes", tribes: ["勇傑", "妖戒"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
          { kind: "burst_set_count", player: "self", max: 0 },
        ],
        executionMode: "optional",
        steps: [],
        textRef: [0],
      },
      // 【バースト：自分のライフ減少後】コストを支払わず召喚→このバトル終了時アタックステップ終了。
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
          // 「その後、このバトル終了時、アタックステップを終了する」= step 単位 deferTo:battle_end。
          // 召喚は即実行、end_attack_step のみ当該バトル解決完了後へ遅延 (10_rules/05 L87
          // 「バトル終了時 はバトル1件ごとの終了」)。
          {
            action: { kind: "end_attack_step" },
            connector: "sequential",
            deferTo: "battle_end",
          },
        ],
        textRef: [2, 3],
      },
      // Lv1-Lv2『自分のメインステップ』このスピリットに赤のシンボル1つを追加する。
      // ルーミア(BSTH01-C04)型の継続効果。activated + permanent だと起動するたびに
      // 永続の symbol_addition CE が増え、continuous-effect が無制限累積して各ステップが
      // 超線形に重くなる(self-play で数千ステップ走ると事実上ハング)。continuous +
      // timingScope(period:main) で表現すると provenance 重複排除で 1 個に保たれる。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { level: { min: 1, max: 2 } },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "red",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH09-M02",
    orikaId: 240,
    orikaIndex: 249,
    name: "[普通の魔法使い]霧雨 魔理沙",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 7,
    reductionSymbols: [
      "yellow",
      "yellow",
      "yellow",
      "yellow",
      "yellow",
      "yellow",
    ],
    maxCombinedBraves: {
      count: 3,
      effectIndex: 1,
      condition: { tribes: ["導魔"] },
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
        bp: 10000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "【バースト：相手のスピリット/アルティメットのアタック後】",
      "相手のスピリット/アルティメット2体を手札に戻す。この効果発揮後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットは系統：「導魔」を持つブレイヴ3つまでと合体できる。",
      "",
      "Lv2-Lv3『このスピリットのアタック/ブロック時』",
      "このターンの間、相手のスピリット/アルティメット2体をBP-15000し、BPが0になった相手のスピリット/アルティメットを破壊する。この効果発揮後、このスピリットの合体中、魂状態の相手のカードすべてを手札に戻す。",
    ],
    keywordTags: ["burst", "soul_state"],
    tribe: "幻想・導魔・楽族",
    image: "images/BSTH09-M02.webp",
    rarity: "M",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：相手のスピリット/アルティメットのアタック後】相手2体を手札に戻す→召喚。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "attack_finished", player: "opponent" },
        },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 2,
              },
            },
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
        textRef: [0, 1],
      },
      {
        // Lv1-Lv2-Lv3: 系統「導魔」ブレイヴ3つまで合体可能。maxCombinedBraves で表現 (P3-16)。
        timing: { kind: "continuous" },
        applicability: { level: { min: 1, max: 3 } },
        steps: [],
        textRef: [3, 4],
      },
      // Lv2-Lv3『アタック/ブロック時』相手2体BP-15000→BP0で破壊
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            id: "bp0",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 2,
              },
              amount: -15000,
              duration: { scope: "turn" },
            },
          },
          {
            action: {
              kind: "destroy",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
            },
            connector: "sequential",
          },
          {
            // 同じ効果の破壊誘発を解決した後、合体中だけ魂状態を戻す。
            connector: "after_triggers",
            condition: [{ kind: "combined" }],
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { soulState: "only" },
                count: "all",
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH09-M03",
    orikaId: 241,
    orikaIndex: 250,
    name: "[空飛ぶ不思議な巫女]博麗 霊夢",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "red", "red"],
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
        bp: 10000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "【バースト：相手のスピリット/アルティメットのアタック後】",
      "相手の創界神ネクサス1つのコアすべてをボイドに置き、相手のネクサス1つを破壊する。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "ターンに1回、このスピリットは回復する。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・博麗",
    image: "images/BSTH09-M03.webp",
    rarity: "M",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：相手のスピリット/アルティメットのアタック後】創界神コア全ボイド+ネクサス1破壊→召喚。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "attack_finished", player: "opponent" },
        },
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  hasMechanic: ["grandwalker", "guided"],
                  targetsGrandwalker: true,
                },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "void", player: "opponent" },
              amount: "all",
            },
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"] },
                count: 1,
              },
            },
            connector: "sequential",
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
      // Lv2-Lv3『このスピリットのアタック時』ターンに1回、このスピリットは回復する。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH09-R01",
    orikaId: 242,
    orikaIndex: 251,
    name: "九十九 弁々",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "red", "six", "six"],
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
        bp: 12000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "このカードが効果で召喚されたとき、相手のスピリット/アルティメット1体を破壊できる。",
      "",
      "Lv1-Lv2-Lv3",
      "〔重複不可〕自分の「八橋」がいるとき、自分の「弁々」と自分の「八橋」をBP+5000する。",
      "",
      "Lv2-Lv3『自分のアタックステップ』",
      "相手は効果でアタックステップを終了できない。",
    ],
    keywordTags: [],
    tribe: "幻想・付喪",
    image: "images/BSTH09-R01.webp",
    rarity: "R",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードが効果で召喚されたとき、相手のスピリット/アルティメット1体を破壊できる。
      {
        timing: {
          kind: "card_event",
          event: "summon",
          cause: ["self_effect", "opponent_effect"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2-Lv3 〔重複不可〕自分の「八橋」がいるとき、自分の「弁々」と「八橋」をBP+5000する。
      {
        timing: { kind: "continuous" },
        usageLimit: { kind: "no_duplicate" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "八橋" }],
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
                  cardName: [{ contains: "弁々" }, { contains: "八橋" }],
                },
                count: "all",
              },
              amount: 5000,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        // Lv2-Lv3『自分のアタックステップ』相手は効果でアタックステップを終了できない。
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        applicability: { level: { min: 2, max: 3 } },
        steps: [
          {
            action: {
              kind: "restrict_end_attack_step",
              player: "opponent",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH09-R02",
    orikaId: 243,
    orikaIndex: 252,
    name: "九十九 八橋",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "red", "six", "six"],
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
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3",
      "〔重複不可〕自分の「弁々」がいるとき、自分の「八橋」と自分の「弁々」をBP+5000する。",
      "",
      "Lv2-Lv3『自分のアタックステップ』",
      "〔重複不可〕相手が手札/手元から使用したフラッシュ/スタック効果を発揮するとき、自分の系統：「付喪」/「勇傑」/「妖戒」を持つスピリット/系統：「幻想」を持つブレイヴ2つにつき、相手は手札1枚を破棄しなければ、その効果を発揮できない。",
    ],
    keywordTags: [],
    tribe: "幻想・付喪",
    image: "images/BSTH09-R02.webp",
    rarity: "R",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3 〔重複不可〕自分の「弁々」がいるとき、自分の「八橋」と「弁々」をBP+5000する。
      {
        timing: { kind: "continuous" },
        usageLimit: { kind: "no_duplicate" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "弁々" }],
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
                  cardName: [{ contains: "八橋" }, { contains: "弁々" }],
                },
                count: "all",
              },
              amount: 5000,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『自分のアタックステップ』相手の手札/手元フラッシュ/スタック効果に手札破棄コストを課す。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "gate_flash_stack_hand_discard",
              player: "opponent",
              count: {
                source: {
                  kind: "cards_in_zone",
                  player: "self",
                  zone: "field",
                  filter: {
                    filterOr: [
                      {
                        category: ["spirit"],
                        tribes: ["付喪", "勇傑", "妖戒"],
                      },
                      {
                        category: ["brave"],
                        tribes: ["幻想"],
                      },
                    ],
                  },
                },
                divisor: 2,
              },
              targetEffectLabels: ["flash", "stack"],
              sourceActivationZones: ["hand", "set_aside"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH09-R03",
    orikaId: 244,
    orikaIndex: 253,
    name: "「進撃の小人」",
    printedCategory: "magic",
    colors: ["red", "white"],
    cost: 4,
    reductionSymbols: ["red", "six"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ターンに1回：同名〕系統：「勇傑」/「妖戒」を持つ効果でデッキからオープンされたこのカードは、自分の手札が5枚以下のとき、手札に加えられる。",
      "",
      "フラッシュ",
      "このターンの間、コスト4以上の相手のスピリット/アルティメットのアタックでは、自分のライフは1しか減らない。",
    ],
    keywordTags: [],
    image: "images/BSTH09-R03.webp",
    rarity: "R",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 〔ターンに1回：同名〕勇傑/妖戒効果でオープンされたこのカードは、手札5枚以下なら手札に加えられる。
      //   BSFT01-C04 add 型（07b §6 裁定 2026-06-11）の trigger_tribes 版＋hand_count(max 5) ゲート。
      //   テキストは「オープンされた」のみ（トラッシュ行きは含まない）ため event は revealed のみ。
      //   〔ターンに1回：同名〕は per_card_name usageLimit で表現。
      {
        timing: { kind: "card_event", event: "revealed" },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_tribes", tribes: ["勇傑", "妖戒"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
          { kind: "hand_count", player: "self", max: 5 },
        ],
        usageLimit: { kind: "per_card_name", maxCount: 1, duration: "turn" },
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        executionMode: "optional",
        textRef: [0],
      },
      // フラッシュ：このターン、コスト4以上の相手のアタックでは自分のライフは1しか減らない。
      // = life_damage_interception(replace, cap:1)＋attackerFilter（コスト4以上の相手スピ/アル）。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "replace",
              cap: 1,
              attackerFilter: {
                category: ["spirit", "ultimate"],
                minCost: 4,
              },
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH09-TR01(A)",
    orikaId: 248,
    orikaIndex: 254,
    name: "柱斧",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "six"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "Lv1【転醒：自分のカウント1以上（転醒は同時に使えない）】",
      "系統：「勇傑」を持つ自分のスピリットが召喚されたか、効果を発揮したとき、このネクサスを裏返せる。このとき、この転醒後ブレイヴを自分のスピリットに合体できる。",
      "",
      "Lv1『このネクサスの配置時』",
      "最もBPの低い相手のスピリット/アルティメット1体を破壊できる。",
      "",
      "Lv1『自分のメインステップ』",
      "ターンに1回、自分はデッキの上から1枚ドローできる。",
    ],
    keywordTags: ["double_sided"],
    tribe: "幻想",
    image: "images/BSTH09-TR01(A).webp",
    rarity: "TR",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1【転醒：自分のカウント1以上】系統「勇傑」を持つ自分のスピリットが召喚されたか、
      // 効果を発揮したとき裏返せる。このときの転醒後ブレイヴ任意合体は【転醒】内蔵の
      // postRebirthChoice として扱い、B 面 card_event:"rebirth" へは分離しない。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["summon", "effect_activated"],
          triggerFilter: { category: ["spirit"], tribes: ["勇傑"] },
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", min: 1 }],
        steps: [
          {
            action: {
              kind: "rebirth",
              postRebirthChoice: { kind: "brave_combine", optional: true },
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1『このネクサスの配置時』最もBPの低い相手のスピリット/アルティメット1体を破壊できる。
      {
        timing: { kind: "card_event", event: "place" },
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
                  extremal: { metric: "bp", mode: "lowest" },
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1『自分のメインステップ』ターンに1回、自分はデッキの上から1枚ドローできる。
      {
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "打ち出の小槌",
      printedCategory: "brave",
      colors: ["red"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 1000,
        },
      ],
      symbolColors: [],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く）",
        "",
        "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできない。",
        "",
        "【合体条件：勇傑＆コスト5以上】",
        "【合体中】『このスピリットのアタック時』",
        "〔ターンに1回：同名〕自分のデッキを上から4枚オープンできる。その中の転醒カード以外のコスト7以下のカード1枚をコストを支払わずに召喚/配置できる。残ったカードはデッキの下に戻す。この効果を自分のカウント1につき1回発揮できる。召喚/配置したカード／創界神ネクサスの『召喚/配置時』効果は発揮されない。",
      ],
      keywordTags: [],
      tribe: "幻想",
      image: "images/BSTH09-TR01(B).webp",
      rarity: "TR",
      pack: "BSTH09 東方輝針城",
      cardNo: "BSTH09-TR01(B)",
      combinedBoost: 2000,
      braveCondition: { tribes: ["勇傑"], minCost: 5 },
      effects: [
        // [2] スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできない。
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
          textRef: [2],
        },
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { combined: true },
          executionMode: "optional",
          // 〔ターンに1回：同名〕は効果全体の共有発揮制限であり、解決中の反復数ではない。
          // 「カウント1につき1回」は count N ならこの deck_reveal 一連を N 回行う。
          // repeat.additional は基本1回に対する追加数なので N-1 を指定し、count 0 は
          // 発揮できない gate として別途 condition に置く。
          condition: [{ kind: "count_value", player: "self", min: 1 }],
          usageLimit: {
            kind: "per_card_name",
            duration: "turn",
            maxCount: 1,
          },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 4,
                picks: [
                  {
                    count: 1,
                    filter: {
                      category: ["spirit", "ultimate", "brave", "nexus"],
                      maxCost: 7,
                      exclude: { hasMechanic: ["rebirth"] },
                    },
                    destination: "field",
                  },
                ],
                remainder: "bottom",
                suppressFieldEntryEffects: true,
              },
              repeat: {
                additional: {
                  source: { kind: "count_value", player: "self" },
                  offset: -1,
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
    cardNo: "BSTH09-X01",
    orikaId: 245,
    orikaIndex: 255,
    name: "少名 針妙丸",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "six"],
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
      {
        level: 3,
        requiredCores: 4,
        bp: 10000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3『自分のアタックステップ』",
      "このスピリットのアタック宣言からバトル終了後まで、相手がスタック効果を発揮するとき、その効果発揮前にこのスピリットの『このスピリットのアタック時』効果1つを発揮でき、その効果解決後まで、相手のスタック効果は発揮されない。",
      "",
      "Lv2-Lv3『自分のメインステップ終了時』",
      "自分のトラッシュのコアすべてをこのスピリットに置ける。そうしたとき、相手のネクサス/ミラージュ/バースト3つまでを破壊/破棄し、その効果を発揮させない。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・勇傑",
    image: "images/BSTH09-X01.webp",
    rarity: "X",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『自分のアタックステップ』アタック中、相手スタック効果に割り込んで
      // 自身が持つ『このスピリットのアタック時』効果1つを先に発揮し、相手スタックを
      // 発揮させない。effect_declaration(triggerEffectLabel:"stack") + borrow_card_event_effect
      // suppressResponseStack で、発揮前 checkpoint から現 pending stack 効果を借用効果の
      // 解決後まで待機させる（不発にはしない）。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "effect_declaration",
          triggerEffectTiming: "stack",
          triggerEffectLabel: "stack",
        },
        condition: [
          { kind: "min_level", value: 1 },
          { kind: "step_phase", step: "attack", whose: "self" },
          {
            kind: "self_state",
            state: "on_field",
            battleState: "attacking",
            pendingDeclaration: "attack",
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "borrow_card_event_effect",
              target: { kind: "self" },
              borrowEvents: ["attack"],
              suppressResponseStack: true,
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『自分のメインステップ終了時』トラッシュのコア全→自身。そうしたとき、
      // 相手のネクサス/ミラージュ/バースト3つまで破壊/破棄し発揮させない。
      // 3種類を合算して0〜3つを一度に選び、選んだ集合だけを各ゾーンの処理へ渡す。
      {
        timing: { kind: "phase", step: "main", whose: "self", subPhase: "end" },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        steps: [
          {
            id: "trashCoreMove",
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
            },
          },
          {
            id: "removalTargets",
            connector: "conditional_result",
            targetSelectionTiming: "on_step",
            action: {
              kind: "noop",
              target: {
                kind: "filter",
                player: "opponent",
                zone: ["field", "mirage", "burst"],
                filter: {
                  filterOr: [
                    { zone: ["field"], category: ["nexus"] },
                    { zone: ["mirage", "burst"] },
                  ],
                },
                count: { min: 0, max: 3 },
              },
            },
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                zone: "field",
                filter: { category: ["nexus"] },
                count: "all",
                stepId: "removalTargets",
              },
              suppressDestroyedEffects: "destroyed_only",
            },
          },
          {
            id: "discardMirage",
            stepCondition: { kind: "ref_succeeded", stepId: "trashCoreMove" },
            action: {
              kind: "discard",
              player: "opponent",
              fromZone: "mirage",
              suppressMovedToTrashEffects: true,
              count: "all",
              target: {
                kind: "filter",
                player: "opponent",
                zone: "mirage",
                filter: {},
                count: "all",
                stepId: "removalTargets",
              },
            },
          },
          {
            stepCondition: { kind: "ref_succeeded", stepId: "trashCoreMove" },
            action: {
              kind: "discard_set_burst",
              player: "opponent",
              count: "all",
              target: {
                kind: "filter",
                player: "opponent",
                zone: "burst",
                filter: {},
                count: "all",
                stepId: "removalTargets",
              },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH09-X02",
    orikaId: 246,
    orikaIndex: 256,
    name: "鬼人 正邪",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "six"],
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
      {
        level: 3,
        requiredCores: 4,
        bp: 11000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3『自分のアタックステップ』",
      "系統：「勇傑」/「妖戒」/「付喪」を持つ本来のコストが7以下の自分のスピリットすべては、相手の効果でフィールドを離れるとき、フィールド/リザーブのコアを好きなだけ置いて同じ状態で残せる。",
      "",
      "Lv2-Lv3『自分のアタックステップ』",
      "系統：「勇傑」/「妖戒」/「付喪」を持つ本来のコストが7以下の自分のスピリットすべては、そのスピリットが持つ最高Lvとして扱う。",
    ],
    keywordTags: [],
    tribe: "幻想・妖戒",
    image: "images/BSTH09-X02.webp",
    rarity: "X",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『自分のアタックステップ』勇傑/妖戒/付喪のコスト7以下スピリットは相手離脱時コアを置いて残せる。
      //   grant_effect(target:filter count:"all", duration:自分アタックstep限定) + 被付与Effectは
      //   BSSG01-C03「相手によってフィールドを離れるとき、コアを好きなだけ置いて同じ状態で残せる」
      //   (BSSG01.ts:423-446) と同型 (stay_on_field + core_distribute(any_movable_self→self,
      //   amount:"all", mode:"player_choice"))。新規プリミティブ不要。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "grant_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["勇傑", "妖戒", "付喪"],
                  maxCost: 7,
                  costBasis: "printed",
                },
                count: "all",
              },
              duration: { scope: "step", whose: "self", step: "attack" },
              grantedEffect: {
                timing: {
                  kind: "card_event",
                  event: "leave_field",
                  cause: "opponent_effect",
                },
                executionMode: "optional",
                steps: [
                  {
                    action: { kind: "stay_on_field", target: { kind: "self" } },
                  },
                  {
                    action: {
                      kind: "core_distribute",
                      // 原文「フィールド/リザーブのコアを好きなだけ」= trash/life を含まない
                      // 縮小版マーカー (any_movable_self ではなく field_and_reserve_self、
                      // dsl-types.ts:918)。
                      from: { kind: "field_and_reserve_self" },
                      to: { kind: "self" },
                      amount: "all",
                      mode: "player_choice",
                    },
                    connector: "sequential",
                  },
                ],
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『自分のアタックステップ』勇傑/妖戒/付喪のコスト7以下スピリットすべてを最高Lv扱い。
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
                filter: {
                  category: ["spirit"],
                  tribes: ["勇傑", "妖戒", "付喪"],
                  maxCost: 7,
                  costBasis: "printed",
                },
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
    cardNo: "BSTH09-X03",
    orikaId: 247,
    orikaIndex: 257,
    name: "堀川 雷鼓",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 7,
    reductionSymbols: ["red", "red", "six", "six"],
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
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3",
      "自分の「弁々」と「八橋」がいるとき、このスピリットをBP+10000する。",
      "",
      "Lv2-Lv3『自分のアタックステップ』",
      "〔重複不可〕系統：「付喪」/「勇傑」/「妖戒」を持つ自分のスピリットがアタックしたとき、相手のライフのコア1個をリザーブに置くか、そのバトルの間、そのスピリットに赤のシンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "幻想・付喪",
    image: "images/BSTH09-X03.webp",
    rarity: "X",
    pack: "BSTH09 東方輝針城",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3 自分の「弁々」と「八橋」がいるとき、このスピリットをBP+10000する。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "弁々" }],
          },
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "八橋" }],
          },
        ],
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: { kind: "self" },
              amount: 10000,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『自分のアタックステップ』付喪/勇傑/妖戒スピがアタックしたとき、相手ライフ→リザーブ、またはそのスピに赤シンボル+1。
      // 他カードアタック誘発は game_event(event:"attack") + triggerFilter(tribes) で表現
      // (BSFT01-C04[5,6]「自分の『ルーシィ』がアタック/ブロックしたとき」と同型、host≠trigger card)。
      // 択一は choice、赤シンボル付与は symbol_add(target:trigger_related_instance) で対象の
      // アタックした個体を直接指す (BSES01[2]の trigger_related_instance 前例と同型)。
      // 〔重複不可〕= usageLimit:{kind:"no_duplicate"} (同名複数ソースの同時発揮を1体に畳む、
      // 10_rules/03c §重複不可)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "attack",
          triggerFilter: {
            category: ["spirit"],
            tribes: ["付喪", "勇傑", "妖戒"],
          },
        },
        condition: [{ kind: "min_level", value: 2 }],
        timingScope: { player: "self", period: "attack" },
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
            choice: [
              {
                label: "赤シンボル+1",
                action: {
                  kind: "symbol_add",
                  target: { kind: "trigger_related_instance" },
                  symbol: "red",
                  duration: { scope: "battle" },
                },
              },
            ],
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
];
