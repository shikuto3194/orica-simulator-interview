import type { CardDefinition } from "@orica/rules-core";

export const BSTH08_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH08-C01",
    orikaId: 205,
    orikaIndex: 214,
    name: "神光「逆らう事なきを宗とせよ」",
    printedCategory: "magic",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュにあるこのカードは一切の効果を受けない。",
      "このカードは、系統：「起幻」/「幻想」を持つ。",
      "",
      "フラッシュ",
      "このターンの間、自分のライフは1しか減らない。",
      "",
      "スタック",
      "相手のスピリット/アルティメット1体を手札に戻す。この効果は、お互いのアタックステップしか使えない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想",
    image: "images/BSTH08-C01.webp",
    rarity: "C",
    pack: "BSTH08 東方神霊廟",
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
      // このカードは、系統：「起幻」/「幻想」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["起幻", "幻想"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [1],
      },
      // フラッシュ：このターンの間、自分のライフは1しか減らない。
      // 裁定 2026-06-15（10_rules/05 §ライフ減少の上限キャップ）= ターン累積上限。
      //   そのターンの自分ライフ減少の合計を最大1に頭打ち（全原因合算 / 自ターン開始リセット）。
      //   mode:"turn_cap" + cap:1 で lifeReductionCappedThisTurn を消費しながらクランプする。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "turn_cap",
              cap: 1,
              duration: { scope: "turn" },
            },
          },
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
    cardNo: "BSTH08-C02",
    orikaId: 206,
    orikaIndex: 215,
    name: "[神霊廟]西行寺 幽々子",
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
      "このカード/スピリットのシンボルは青としても扱う。",
      "",
      "Lv1-Lv2『自分のメインステップ』",
      "ゲーム中に1回、このスピリットを疲労させることで、自分のデッキを上から3枚オープンする。その中の系統：「起幻」を持つ白/青の導界者ネクサスカード1枚と、カード名：「[神霊廟]西行寺 幽々子」/「幽谷 響子」以外の系統：「起幻」を持つ白/青のカード1枚を手札に加える。残ったカードは破棄する。この効果は、ターンに1回しか使えない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・冥主",
    image: "images/BSTH08-C02.webp",
    rarity: "C",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカード/スピリットのシンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『自分のメインステップ』ゲーム中1回、疲労させ、デッキ3オープン、起幻の白/青導界者ネクサス1枚と
      // 「西行寺 幽々子」/「幽谷 響子」以外の起幻の白/青カード1枚を手札に。残りは破棄。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        usageLimit: [
          { kind: "per_card_name", duration: "turn" },
          { kind: "per_instance", duration: "game" },
        ],
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
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    colors: ["white", "blue"],
                    tribes: ["起幻"],
                    targetsGrandwalker: true,
                    hasMechanic: ["guided"],
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    colors: ["white", "blue"],
                    tribes: ["起幻"],
                    exclude: {
                      cardName: [
                        { exact: "[神霊廟]西行寺 幽々子" },
                        { exact: "幽谷 響子" },
                      ],
                    },
                  },
                  mandatory: true,
                },
              ],
              remainder: "trash",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH08-C03",
    orikaId: 207,
    orikaIndex: 216,
    name: "幽谷 響子",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue"],
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
    symbolColors: ["blue"],
    textLines: [
      "このカード/スピリットのシンボルは白としても扱う。",
      "",
      "Lv1-Lv2『自分のメインステップ』",
      "ゲーム中に1回、このスピリットを疲労させることで、自分のデッキを上から3枚オープンする。その中の系統：「起幻」を持つ白/青の導界者ネクサスカード1枚と、カード名：「[神霊廟]西行寺 幽々子」/「幽谷 響子」以外の系統：「起幻」を持つ白/青のカード1枚を手札に加える。残ったカードは破棄する。この効果は、ターンに1回しか使えない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・闘神",
    image: "images/BSTH08-C03.webp",
    rarity: "C",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカード/スピリットのシンボルは白としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: "white",
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『自分のメインステップ』ゲーム中1回、疲労させ、デッキ3オープン、起幻の白/青導界者ネクサス1枚と
      // 「西行寺 幽々子」/「幽谷 響子」以外の起幻の白/青カード1枚を手札に。残りは破棄。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        usageLimit: [
          { kind: "per_card_name", duration: "turn" },
          { kind: "per_instance", duration: "game" },
        ],
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
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    colors: ["white", "blue"],
                    tribes: ["起幻"],
                    targetsGrandwalker: true,
                    hasMechanic: ["guided"],
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    colors: ["white", "blue"],
                    tribes: ["起幻"],
                    exclude: {
                      cardName: [
                        { exact: "[神霊廟]西行寺 幽々子" },
                        { exact: "幽谷 響子" },
                      ],
                    },
                  },
                  mandatory: true,
                },
              ],
              remainder: "trash",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH08-C04",
    orikaId: 208,
    orikaIndex: 217,
    name: "[五欲の巫女]博麗 霊夢",
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
      "このカード/スピリットのシンボルは白/青としても扱う。",
      "",
      "【バースト：相手のスピリット/アルティメットのアタック後】",
      "相手の創界神ネクサスのコアすべてをボイドに置く。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "相手の創界神ネクサスのコア4個をボイドに置き、ターンに1回、このスピリットは回復する。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・博麗",
    image: "images/BSTH08-C04.webp",
    rarity: "C",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカード/スピリットのシンボルは白/青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: "white",
            },
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
        textRef: [0],
      },
      // 【バースト：相手のスピリット/アルティメットのアタック後】相手創界神コア全ボイド→召喚。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "attack_finished", player: "opponent" },
        },
        steps: [
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
              to: { kind: "void", player: "opponent" },
              amount: "all",
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
        textRef: [2, 3],
      },
      // Lv2-Lv3『このスピリットのアタック時』相手創界神コア4ボイド + ターン1回回復。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "opponent",
                filter: { category: ["nexus"], targetsGrandwalker: "only" },
              },
              to: { kind: "void", player: "opponent" },
              amount: 4,
            },
          },
          {
            action: { kind: "recover", target: { kind: "self" } },
            connector: "sequential",
            usageLimit: { kind: "per_instance", duration: "turn" },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH08-C05",
    orikaId: 209,
    orikaIndex: 218,
    name: "[強欲の魔法使い]霧雨 魔理沙",
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
      "アタックしている相手のスピリット/アルティメットすべてを手札に戻す。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットは系統：「導魔」を持つブレイヴ3つまでと合体できる。",
      "",
      "Lv2-Lv3『このスピリットのアタック/ブロック時』",
      "このターンの間、このスピリットとバトルしていない相手のスピリット/アルティメット3体をBP-5000し、BPが0になった相手のスピリット/アルティメットを破壊する。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・楽族",
    image: "images/BSTH08-C05.webp",
    rarity: "C",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：相手のスピリット/アルティメットのアタック後】アタック中の相手全てを手札に戻し→召喚。
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
                filter: {
                  category: ["spirit", "ultimate"],
                  battleState: "attacking",
                },
                count: "all",
              },
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
      {
        // Lv1-Lv2-Lv3: 系統「導魔」ブレイヴ3つまで合体可能。maxCombinedBraves で表現 (P3-16)。
        timing: { kind: "continuous" },
        applicability: { level: { min: 1, max: 3 } },
        steps: [],
        textRef: [3, 4],
      },
      // Lv2-Lv3『アタック/ブロック時』バトルしていない相手3体をBP-5000、BP0で破壊。
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
                filter: {
                  category: ["spirit", "ultimate"],
                  // 「このスピリットとバトルしていない」= not_in_battle 対象限定。
                  battleState: "not_in_battle",
                },
                count: 3,
              },
              amount: -5000,
              duration: { scope: "turn" },
            },
          },
          {
            // BP0 になった相手スピリット/アルティメットを破壊。
            action: {
              kind: "destroy",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
            },
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH08-C06",
    orikaId: 210,
    orikaIndex: 219,
    name: "[我欲の巫女]東風谷 早苗",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "green", "guide", "guide"],
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
      "疲労状態/アタックしている相手のスピリット/アルティメット1体をデッキの下に戻す。この効果は系統：「起幻」を持たない効果では防げない。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv2『自分のアタックステップ』",
      "相手がマジックカードのスタック効果を使うとき、そのコストは、フィールドから支払えない。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・風神",
    image: "images/BSTH08-C06.webp",
    rarity: "C",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：相手によって自分のスピリットがフィールドを離れた後】
      // 疲労状態/アタックしている相手のスピリット/アルティメット1体をデッキの下に戻す。
      // この効果は系統：「起幻」を持たない効果では防げない。その後、このカードをコストを支払わずに召喚する。
      // - spirit_destroyed (=leave_field) + cause:[opponent_effect, battle] で「相手によって離れた後」を表現
      //   (10_rules/04b §burst trigger / structured-effect-registrations.ts mapBurstTriggerToCause)
      // - filterOr で「疲労状態 or アタックしている」を表現
      // - preventionRestriction.onlyPreventableByTribes:["起幻"] で「起幻を持たない効果では防げない」
      {
        // triggerFilter category:["spirit"] で「自分のスピリット」限定（BSTH03-M01 の
        // category:["ultimate"] と同型。spirit_destroyed は leave_field family に丸められ
        // ネクサス等の離脱も拾ってしまうため明示除外が必要）。
        timing: {
          kind: "burst",
          trigger: { kind: "spirit_destroyed", player: "self" },
          triggerFilter: { category: ["spirit"] },
          cause: ["opponent_effect", "battle"],
        },
        preventionRestriction: { onlyPreventableByTribes: ["起幻"] },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                // category は filterOr の各枝内へ複製する。matchesCardFilter の filterOr 分岐
                // (card-filter.ts:397-439) は各 sub を outer フィールドとマージせず単独評価するため、
                // outer sibling に置くと無視され非spirit/ultimateまで対象化してしまう
                // (ENGINE-destroy-suppresses-target-rebirth-response 検証中に発見した同型バグ、
                // BSTH004-X03 と同一修正パターン)。
                filter: {
                  filterOr: [
                    {
                      category: ["spirit", "ultimate"],
                      exhaustState: "exhausted",
                    },
                    {
                      category: ["spirit", "ultimate"],
                      battleState: "attacking",
                    },
                  ],
                },
                count: 1,
              },
              position: "bottom",
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
      // Lv2『自分のアタックステップ』相手のマジックのスタック効果コストをフィールドから払えない。
      // restrict_field_cost_payment (ENGINE-restrict-field-cost-payment) は
      // restrict_reserve_cost_payment (BSSL01-R03) と対称の player-scoped CE。
      // effectModes:["stack"] でマジックのスタック効果コストのみを制限対象に絞る
      // (本体の召喚/使用コストは制限しない)。timingScope で「自分のアタックステップ」
      // 限定を表現 (BSTH08-C06 同ファイル L1494-1520 の override_properties 継続効果と同型)。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "restrict_field_cost_payment",
              player: "opponent",
              duration: { scope: "while_on_field" },
              effectModes: ["stack"],
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH08-C07",
    orikaId: 211,
    orikaIndex: 220,
    name: "[死欲の半霊]魂魄 妖夢",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 6,
    reductionSymbols: ["white", "white", "white", "guide"],
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
      "【バースト：自分のライフ減少後】",
      "相手のスピリット/アルティメット1体をデッキの下に戻す。この効果は系統：「起幻」を持たない効果では防げない。",
      "",
      "Lv1-Lv2『自分のメインステップ』",
      "このスピリットに青のシンボル1つを追加する。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・戦姫",
    image: "images/BSTH08-C07.webp",
    rarity: "C",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：自分のライフ減少後】相手のスピリット/アルティメット1体をデッキの下に戻す。
      // 「この効果は系統：「起幻」を持たない効果では防げない」=
      // preventionRestriction.onlyPreventableByTribes:["起幻"]
      // (10_rules/04b §効果防止の優先順位 / dsl-types.ts preventionRestriction)
      {
        timing: {
          kind: "burst",
          trigger: { kind: "life_decrease", player: "self" },
        },
        preventionRestriction: { onlyPreventableByTribes: ["起幻"] },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2『自分のメインステップ』このスピリットに青のシンボル1つを追加する。
      // ルーミア型の継続効果。activated + permanent だと起動毎に永続シンボルが累積するため continuous 化。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { level: { min: 1, max: 2 } },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "blue",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH08-M01",
    orikaId: 212,
    orikaIndex: 221,
    name: "物部 布都",
    printedCategory: "spirit",
    colors: ["white", "blue"],
    cost: 7,
    reductionSymbols: ["white", "white", "blue", "blue"],
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
    symbolColors: ["white"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "相手のスピリット/アルティメット1体をデッキの下に戻す。",
      "",
      "Lv1-Lv2-Lv3【超重装甲：赤/緑/白】",
      "このスピリットは、相手の赤/緑/白の効果を受けない。",
      "",
      "Lv2-Lv3 フラッシュ『お互いのアタックステップ』",
      "ターンに1回、このスピリットは回復できる。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・武装",
    image: "images/BSTH08-M01.webp",
    rarity: "M",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『このスピリットのアタック時』相手のスピリット/アルティメット1体をデッキの下に戻す。
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      // 【超重装甲：赤/緑/白】このスピリットは、相手の赤/緑/白の効果を受けない。
      // sourceScope.colors=["red","green","white"] で発生源 colors のいずれか一致時のみ免疫成立
      // （10_rules/03c §発生源帰属、external-qa BS36 L482「指定された色の相手の効果すべてを受けなくする」）。
      // 無色効果（神シンボル等）はスコープ不一致＝免疫不成立で通る。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
              sourceScope: { colors: ["red", "green", "white"] },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3 フラッシュ『お互いのアタックステップ』ターンに1回、このスピリットは回復できる。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH08-M02",
    orikaId: 213,
    orikaIndex: 222,
    name: "蘇我 屠自古",
    printedCategory: "spirit",
    colors: ["white", "blue"],
    cost: 7,
    reductionSymbols: ["white", "white", "blue", "blue"],
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
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "このスピリット以外の自分の青シンボルがあるとき、相手のデッキを上から7枚破棄できる。そうしたとき、このターンの間、自分によって相手のライフは減らない。",
      "",
      "Lv1-Lv2-Lv3 【超重装甲：紫/黄/青】",
      "このスピリットは、相手の紫/黄/青の効果を受けない。",
      "",
      "Lv2-Lv3 フラッシュ『お互いのアタックステップ』",
      "ターンに1回、このスピリットは回復できる。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・闘神",
    image: "images/BSTH08-M02.webp",
    rarity: "M",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『アタック時』このスピリット以外の青シンボルがあるとき相手デッキ7破棄。そうしたらこのターン自分により相手ライフは減らない。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        condition: [
          {
            kind: "field_has",
            player: "self",
            symbolColors: ["blue"],
            minCount: 1,
            excludeSelf: true,
          },
        ],
        steps: [
          {
            id: "deck_discard",
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "opponent", position: "top" },
              to: { zone: "trash" },
              count: 7,
              deckDiscard: true,
            },
          },
          {
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "deck_discard",
            },
            action: {
              kind: "life_damage_interception",
              player: "opponent",
              cause: "opponent",
              mode: "replace",
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // 【超重装甲：紫/黄/青】このスピリットは、相手の紫/黄/青の効果を受けない。
      // sourceScope.colors=["purple","yellow","blue"]（external-qa BS36 L482 同上）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
              sourceScope: { colors: ["purple", "yellow", "blue"] },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3 フラッシュ ターンに1回、このスピリットは回復できる。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH08-R01",
    orikaId: 214,
    orikaIndex: 223,
    name: "[神霊廟]多々良 小傘",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "blue"],
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
    ],
    symbolColors: ["white"],
    textLines: [
      "Lv1-Lv2『自分のメインステップ』",
      "このスピリットを疲労させることで、自分は、自分の手札が相手と同じ枚数になるようデッキの上からドローする。この効果は、ゲーム中に1回しか使えない。",
      "",
      "Lv2",
      '系統：「起幻」を持つ自分の青/白のスピリットすべてに"【超重装甲：赤/緑】このスピリットは、相手の赤/緑のスピリット/アルティメット/ネクサス/マジックの効果を受けない。"を与える。',
    ],
    keywordTags: [],
    tribe: "起幻・幻想・機巧",
    image: "images/BSTH08-R01.webp",
    rarity: "R",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『自分のメインステップ』ゲーム中1回、疲労させ、手札が相手と同枚数になるようドロー。
      // ドロー数 = 相手手札 − 自分手札（差分、負なら 0＝手札が相手以上ならドローしない）。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        usageLimit: { kind: "per_card_name", duration: "game" },
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
              kind: "draw",
              count: {
                source: {
                  kind: "cards_in_zone",
                  zone: "hand",
                  player: "opponent",
                },
                subtract: {
                  kind: "cards_in_zone",
                  zone: "hand",
                  player: "self",
                },
              },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
      },
      // Lv2 起幻の自分の青/白スピリットすべてに【超重装甲：赤/緑】を付与。
      // BSTH02-XX01 effects[1] と同型: effect_immunity を kind:"filter" + count:"all" で
      // フィールド上の対象群へ一括登録 ([[project_immunity_source_scope_effective]]、
      // sourceScope.colors / categories は発生源カード実効値で照合)。原文「相手の赤/緑の
      // スピリット/アルティメット/ネクサス/マジックの効果」は発生源カテゴリを4種に限定する
      // (brave は除外)。while_on_field で R01 離脱と同時に CE 失効。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["起幻"],
                  colors: ["blue", "white"],
                },
                count: "all",
              },
              sourceScope: {
                categories: ["spirit", "ultimate", "nexus", "magic"],
                colors: ["red", "green"],
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH08-X01",
    orikaId: 215,
    orikaIndex: 224,
    name: "[導界者]霍 青娥",
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 2,
    reductionSymbols: ["blue"],
    // 公開本文JSONにはLv欄がないためカード画像の0/4を採用。
    levelDefs: [
      { level: 1, requiredCores: 0, bp: 0 },
      { level: 2, requiredCores: 4, bp: 0 },
    ],
    symbolColors: ["guide"],
    textLines: [
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・導技・導域は、神託・神技・神域としても扱う。",
      "",
      "【導託：〔幻想＆コスト3以上〕〔転醒ネクサス〕】",
      "◆対象の自分のスピリット/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、青/白としても扱う。",
      "",
      "【導域】Lv1-Lv2",
      "自分のトラッシュに系統：「幻想」を持つ青/白のカードが3枚以上ある間、『このスピリット/アルティメットの召喚時』効果は発揮されない。",
      "",
      "【導技】Lv2 フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回、このネクサスのコア4個をボイドに置く〕コスト6以下の相手のスピリット/アルティメット1体を破壊する。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    tribe: "導界者・起幻・邪仙",
    image: "images/BSTH08-X01.webp",
    rarity: "X",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 導界者ネクサス本体ルール (textLines[0]) ＋【導託：〔幻想＆コスト3以上〕〔転醒ネクサス〕】
    // (textLines[2-4]) は grandwalkerData 基盤で表現（BSTH04-X01 と同文・同変換）。
    // 配置時導託は標準動作（同名導界者なし条件＋デッキ上3枚）のため placementOracle 省略。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        // 〔幻想＆コスト3以上〕は bullet1「対象の自分のスピリット/ネクサス」に
        // 合わせ categories で spirit/nexus に限定（マジックカードを対象外にする）。
        { tribes: ["幻想"], minCost: 3, categories: ["spirit", "nexus"] },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ],
      // 【導技】Lv2 フラッシュ『お互いのアタックステップ』〔ターンに1回、コア4個をボイドに置く〕。
      // 導技=神技扱い。コスト・Lv2 ゲート・ターン制限は divineSkills 経路でエンジン検査。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 4,
          timing: { step: "attack", whose: "both", mode: "flash" },
          minLevel: 2,
          turnLimit: "once",
          // コスト6以下の相手スピリット/アルティメット1体を破壊。
          effects: [
            {
              textRef: [11, 12],
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "destroy",
                    target: {
                      kind: "filter",
                      player: "opponent",
                      filter: { category: ["spirit", "ultimate"], maxCost: 6 },
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
    effects: [
      // Lv1-Lv2 このネクサスのシンボルは、青/白としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "blue" },
          },
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "white" },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【導域】Lv1-Lv2 トラッシュに幻想の青/白カードが3枚以上ある間、『召喚時』効果は発揮されない。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            zone: "trash",
            tribes: ["幻想"],
            colors: ["blue", "white"],
            minCount: 3,
          },
        ],
        steps: [
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
              },
              effectFilter: {
                sourceKinds: ["spirit", "ultimate"],
                timingKind: "card_event",
                eventAction: "summon",
              },
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
              },
              effectFilter: {
                sourceKinds: ["spirit", "ultimate"],
                timingKind: "card_event",
                eventAction: "summon",
              },
              duration: { scope: "while_on_field" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [8, 9],
      },
      // 【導技】(flash) は grandwalkerData.divineSkills で表現（上記参照）。
    ],
  },
  {
    cardNo: "BSTH08-X02",
    orikaId: 216,
    orikaIndex: 225,
    name: "[神霊廟]封獣 ぬえ",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 8,
    reductionSymbols: ["blue", "blue", "guide", "guide"],
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
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "自分のカウント1につき、相手のデッキを上から5枚破棄する（最大15枚）。",
      "",
      "Lv2-Lv3 スタック『自分のアタックステップ』",
      "ターンに1回、相手のスタック効果1つを無効にできる。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・闘神",
    image: "images/BSTH08-X02.webp",
    rarity: "X",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『アタック時』自分のカウント1につき相手デッキ上5枚破棄（最大15枚）。
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "opponent", position: "top" },
              to: { zone: "trash" },
              count: {
                source: { kind: "count_value", player: "self" },
                multiplier: 5,
                cap: 15,
              },
              deckDiscard: true,
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3 スタック『自分のアタックステップ』ターン1回、相手のスタック効果1つを無効にできる。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "self", period: "attack" },
        executionMode: "optional",
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "effect",
              targetEffectTiming: "stack",
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH08-X03",
    orikaId: 217,
    orikaIndex: 226,
    name: "二ツ岩 マミゾウ",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 8,
    reductionSymbols: ["white", "white", "guide", "guide"],
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
        requiredCores: 4,
        bp: 16000,
      },
    ],
    symbolColors: ["white", "white"],
    textLines: [
      "Lv1-Lv2-Lv3【超重装甲：赤/紫/緑/白/黄/青】",
      "このスピリットは、相手の赤/紫/緑/白/黄/青の効果を受けない。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "自分のカウント1につき、相手のスピリット/アルティメット1体をデッキの下に戻す（最大3体）。この効果は、【超重装甲】以外では防げない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・武装",
    image: "images/BSTH08-X03.webp",
    rarity: "X",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3【超重装甲：赤/紫/緑/白/黄/青】このスピリットは、相手の全色の効果を受けない。
      // sourceScope.colors=6色（印字通り）。無色効果は不一致＝免疫不成立で通る
      // （external-qa BS36 L482「指定された色の相手の効果すべてを受けなくする」、
      // BS44 L711 等の「無色の神シンボル」がスコープ外）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
              sourceScope: {
                colors: ["red", "purple", "green", "white", "yellow", "blue"],
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『このスピリットのアタック時』自分のカウント1につき相手1体をデッキ下（最大3体）。
      //   「【超重装甲】以外では防げない」= preventionRestriction のキーワードスコープ
      //   （防止できるのは【超重装甲】を持つ効果のみ）。一致しない cannot_*/defense_immune を
      //   scoped 貫通する（[03c:27-28]）。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        preventionRestriction: { onlyPreventableByKeywords: ["超重装甲"] },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: {
                  source: { kind: "count_value", player: "self" },
                  cap: 3,
                },
              },
              position: "bottom",
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH08-XX01",
    orikaId: 218,
    orikaIndex: 227,
    name: "[導界者]豊聡耳 神子",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 2,
    reductionSymbols: ["white"],
    // 公開本文JSONにはLv欄がないためカード画像の0/4を採用。
    levelDefs: [
      { level: 1, requiredCores: 0, bp: 0 },
      { level: 2, requiredCores: 4, bp: 0 },
    ],
    symbolColors: ["guide"],
    textLines: [
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・導技・導域は、神託・神技・神域としても扱う。",
      "",
      "【導託：〔幻想＆コスト3以上〕〔転醒ネクサス〕】",
      "◆対象の自分のスピリット/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、白/青としても扱う。",
      "",
      "【導技：4】Lv1-Lv2 フラッシュ『相手のアタックステップ』",
      "〔このネクサスのコア4個をボイドに置く〕トラッシュにある系統：「幻想」を持つ白/青のカード1枚を除外することで、このバトルの間、自分のライフは減らない。この効果はターンに1回しか使えない。",
      "",
      "【導域】Lv2『自分のアタックステップ』",
      "系統：「起幻」を持つ本来のコストが7以上の自分の白のスピリットすべては、白のシンボル3つになる。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    tribe: "導界者・起幻・聖人",
    image: "images/BSTH08-XX01.webp",
    rarity: "XX",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 導界者ネクサス本体ルール (textLines[0]) ＋【導託：〔幻想＆コスト3以上〕〔転醒ネクサス〕】
    // (textLines[2-4]) は grandwalkerData 基盤で表現（BSTH04-X01 と同文・同変換）。
    // 配置時導託は標準動作（同名導界者なし条件＋デッキ上3枚）のため placementOracle 省略。
    // 【導技：4】Lv1-Lv2 フラッシュ『相手のアタックステップ』〔コア4個ボイド〕トラッシュの幻想白/青1枚を
    // 除外することで、このバトルの間ライフは減らない。ターンに1回。
    // 導技=神技扱い (memory project_divine_skill_model_target_maxuses)。コスト・Lv/ターン制限・
    // タイミング制限は divineSkills 経路でエンジン検査。
    // timing は { step:"attack", whose:"opponent" } = 「相手のアタックステップ」。
    //   ('opponent' は 2026-06-28 lane で DivineSkillTiming に追加した新枝)。
    // 効果は search_zone trash→removed_from_game (terminating 「除外する」 mandatory:true)
    //   と prevent_life_damage(battle) の連結。コスト 4 コア消費は divineSkills レベルで処理。
    // destination:"removed_from_game" は 2026-06-28 lane で executeReturnFromTrash と
    // PendingZoneSelection / return_from_trash apply に追加した新枝。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        // 〔幻想＆コスト3以上〕は bullet1「対象の自分のスピリット/ネクサス」に
        // 合わせ categories で spirit/nexus に限定（マジックカードを対象外にする）。
        { tribes: ["幻想"], minCost: 3, categories: ["spirit", "nexus"] },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ],
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 4,
          timing: { step: "attack", whose: "opponent", mode: "flash" },
          minLevel: 1,
          maxLevel: 2,
          // 「この効果はターンに1回しか使えない」は本文規約どおり同名共有。
          // divine skill の同名共有 usage key を通す。
          turnLimit: "once_per_name",
          effects: [
            {
              executionMode: "optional",
              textRef: [8, 9],
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "search_zone",
                    zone: "trash",
                    player: "self",
                    filter: { tribes: ["幻想"], colors: ["white", "blue"] },
                    count: 1,
                    destination: "removed_from_game",
                    mandatory: true,
                  },
                },
                {
                  // 「このバトルの間、自分のライフは減らない」=
                  // life_damage_interception(cause:"any", mode:"replace", duration:battle)。
                  // prevent_life_damage は consumer 未配線 silent disabled
                  // (BSTH04-C11 / BSTH02.7-TX01(A) / BSTH07-R10 先例)。
                  action: {
                    kind: "life_damage_interception",
                    player: "self",
                    cause: "any",
                    mode: "replace",
                    duration: { scope: "battle" },
                  },
                  connector: "conditional_cost",
                },
              ],
            },
          ],
        },
      ],
    },
    effects: [
      // Lv1-Lv2 このネクサスのシンボルは、白/青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "white" },
          },
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "blue" },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【導技：4】(flash, 相手のアタックステップ) は grandwalkerData.divineSkills で表現
      // （上記参照）。effects[] には placeholder を残し、textRef だけ維持する。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [8, 9],
      },
      // 【導域】Lv2『自分のアタックステップ』起幻の本来コスト7以上の自分の白スピリットすべては白シンボル3つになる。
      // 「本来のコスト7以上」= minCost:7（BSDB01-X04 と同じ規約: card-filter は印字 def.cost 基準）。
      // 「白のシンボル3つになる」= override_properties.symbols + symbolCountFixed による固定。
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
                  colors: ["white"],
                  tribes: ["起幻"],
                  minCost: 7,
                  costBasis: "printed",
                },
                count: "all",
              },
              properties: {
                symbols: ["white", "white", "white"],
                symbolCountFixed: true,
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
  {
    cardNo: "BSTH08-転醒R01(A)",
    orikaId: 219,
    orikaIndex: 228,
    name: "宮古 芳香",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 5,
    reductionSymbols: ["blue", "white"],
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
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2『このスピリットのアタック時』",
      "コスト4以下の相手のスピリット1体を破壊できる。その後、ボイドからコア1個をこのスピリットに置ける。",
      "",
      "Lv2【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "このスピリットがアタックしたとき、このスピリットを裏返せる。",
    ],
    keywordTags: ["double_sided"],
    tribe: "起幻・幻想・無魔",
    image: "images/BSTH08-転醒R01(A).webp",
    rarity: "TR",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このスピリットのアタック時』コスト4以下の相手スピリット1体を破壊できる。その後、ボイドからコア1個を置ける。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], maxCost: 4 },
                count: 1,
              },
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [0, 1],
      },
      // Lv2【転醒：自分のカウント3以下】このスピリットがアタックしたとき裏返せる。
      // 転醒トリガー = card_event:attack の任意誘発。executeRebirth が
      // カウント条件 (maxCount) ・同時転醒不可・Lv不足消滅・アタック中BP再計算を内包し、
      // A→B flip 後に B 面『転醒時』(card_event:rebirth) を trigger-system が自動収集する。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        applicability: { level: { min: 2 } },
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [3, 4],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "霍 青娥",
      printedCategory: "spirit",
      colors: ["white"],
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
          requiredCores: 2,
          bp: 10000,
        },
        {
          level: 3,
          requiredCores: 4,
          bp: 14000,
        },
      ],
      symbolColors: ["white"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』",
        "相手のスピリット/アルティメット/ネクサス1つをデッキの下に戻し、その効果を発揮させない。その後、ターンに1回、ボイドからコア1個をこのスピリットに置ける。",
        "",
        "Lv2-Lv3【重装甲：赤/緑】",
        "このスピリットは、相手の赤/緑のスピリット/ブレイヴ/ネクサス/マジックの効果を受けない。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想・闘神",
      image: "images/BSTH08-転醒R01(B).webp",
      rarity: "TR",
      pack: "BSTH08 東方神霊廟",
      cardNo: "BSTH08-転醒R01(B)",
      effects: [
        {
          timing: { kind: "card_event", event: ["rebirth", "attack"] },
          steps: [
            {
              id: "bottom-deck",
              action: {
                kind: "send_to_deck",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate", "nexus"] },
                  count: 1,
                },
                position: "bottom",
              },
            },
            {
              connector: "sequential",
              action: {
                kind: "suppress_pending_leave_effects",
                target: { kind: "ref", stepId: "bottom-deck" },
                suppressDestroyedEffects: "destroyed_only",
              },
            },
            {
              connector: "sequential",
              executionMode: "optional",
              usageLimit: {
                kind: "per_instance",
                duration: "turn",
                maxCount: 1,
              },
              action: {
                kind: "core_move",
                from: { kind: "void", player: "self" },
                to: { kind: "this_card" },
                amount: 1,
              },
            },
          ],
          textRef: [2, 3],
        },
        {
          timing: { kind: "continuous" },
          applicability: { level: { min: 2 } },
          steps: [
            {
              action: {
                kind: "effect_immunity",
                target: { kind: "self" },
                sourceScope: {
                  categories: ["spirit", "brave", "nexus", "magic"],
                  colors: ["red", "green"],
                },
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5, 6],
        },
      ],
    },
  },
  {
    cardNo: "BSTH08-転醒R02(A)",
    orikaId: 220,
    orikaIndex: 229,
    name: "夢殿大祀廟",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "このカード/ネクサスのシンボルは、青としても扱う。",
      "",
      "Lv1【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "系統：「起幻」を持つ自分の白/青のスピリットが疲労/効果で回復したとき、このネクサスを裏返せる。",
      "",
      "Lv1",
      "自分のカウント3以下の間、『このスピリット/アルティメットの召喚時』効果は発揮されない。",
      "",
      "Lv1『自分のアタックステップ開始時』",
      "ボイドからコア1個を自分のスピリット/ネクサスに置ける。",
    ],
    keywordTags: ["double_sided"],
    tribe: "起幻・幻想",
    image: "images/BSTH08-転醒R02(A).webp",
    rarity: "TR",
    pack: "BSTH08 東方神霊廟",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカード/ネクサスのシンボルは、青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      // Lv1【転醒：自分のカウント3以下】起幻の白/青スピリットが疲労/効果回復したとき裏返せる。
      // P3-14 C-3 拡張: exhaust/recover の game_event 観測（他カードの状態変化を監視）で転醒機会を誘発。
      // P3-14 完了履歴どおり、「疲労/効果で回復」はリフレッシュステップの疲労回復も誘発対象として扱う。
      // 転醒条件（カウント3以下）は rebirth.maxCount、「裏返せる」任意は executionMode: optional。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["exhaust", "recover"],
          triggerFilter: {
            category: ["spirit"],
            colors: ["white", "blue"],
            tribes: ["起幻"],
          },
        },
        executionMode: "optional",
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [2, 3],
      },
      // Lv1 自分のカウント3以下の間、『召喚時』効果は発揮されない。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
              },
              effectFilter: {
                sourceKinds: ["spirit", "ultimate"],
                timingKind: "card_event",
                eventAction: "summon",
              },
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
              },
              effectFilter: {
                sourceKinds: ["spirit", "ultimate"],
                timingKind: "card_event",
                eventAction: "summon",
              },
              duration: { scope: "while_on_field" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
      // Lv1『自分のアタックステップ開始時』ボイドからコア1個を自分のスピリット/ネクサスに置ける。
      {
        timing: {
          kind: "phase",
          step: "attack",
          whose: "self",
          subPhase: "start",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_distribute",
              from: { kind: "void", player: "self" },
              to: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "nexus"] },
                count: 1,
              },
              amount: 1,
              mode: "even",
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "神霊廟",
      printedCategory: "nexus",
      colors: ["blue"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 0,
        },
      ],
      symbolColors: ["blue"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1『このネクサスの転醒時』",
        "自分のデッキを上から2枚オープンできる。その中の系統：「起幻」を持つ青/白のカード1枚を手札に加える。残ったカードは破棄する。",
        "",
        "Lv1",
        "自分のメインステップ終了時、このネクサスを裏返して配置できる。この効果は、ターンに1回しか使えない。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想",
      image: "images/BSTH08-転醒R02(B).webp",
      rarity: "TR",
      pack: "BSTH08 東方神霊廟",
      cardNo: "BSTH08-転醒R02(B)",
      effects: [
        // Lv1『転醒時』デッキ上2枚を公開し、起幻を持つ青/白カード1枚を手札へ。
        // 残りは破棄する。B面の『転醒時』は A→B の rebirth 完了後に trigger-system
        // が収集する card_event:rebirth で表す（10_rules/08a §2 の処理順）。
        {
          timing: { kind: "card_event", event: "rebirth" },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 2,
                picks: [
                  {
                    count: 1,
                    filter: { colors: ["blue", "white"], tribes: ["起幻"] },
                    mandatory: true,
                    destination: "hand",
                  },
                ],
                remainder: "trash",
              },
            },
          ],
          textRef: [2, 3],
        },
        // Lv1『自分のメインステップ終了時』B面→A面の「裏返して配置」は逆転醒
        // pattern 2。コスト無償の記載が無いため通常配置パイプラインを通す。
        {
          timing: {
            kind: "phase",
            step: "main",
            whose: "self",
            subPhase: "end",
          },
          executionMode: "optional",
          usageLimit: { kind: "per_card_name", duration: "turn" },
          steps: [{ action: { kind: "reverse_rebirth", mode: "summon" } }],
          textRef: [5, 6],
        },
      ],
    },
  },
];
