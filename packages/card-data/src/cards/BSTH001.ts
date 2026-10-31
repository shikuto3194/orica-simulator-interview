import type { CardDefinition } from "@orica/rules-core";

export const BSTH001_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH001-C01",
    orikaId: 10,
    orikaIndex: 0,
    name: "シンギョク♀",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
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
      "このカード/スピリットのシンボル/軽減シンボルは、紫としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、自分のデッキを上から4枚オープンできる。その中のカード名：「幻想郷」、または系統：「創界神」/「靈異」を持つ赤/紫のネクサスカード1枚をコストを支払わずに配置し、系統：「靈異」を持つコスト4以上のスピリットカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2-Lv3",
      "お互いの創界神ネクサスのシンボルを0にする。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・靈異",
    image: "images/BSTH001-C01.webp",
    rarity: "C",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカード/スピリットのシンボル/軽減シンボルは、紫としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "purple",
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2-Lv3『召喚/アタック時』ターン1回、デッキ4オープン、ネクサス配置+靈異スピ1枚手札。残りデッキ下。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    filterOr: [
                      {
                        category: ["nexus"],
                        colors: ["red", "purple"],
                        cardName: { exact: "幻想郷" },
                      },
                      {
                        category: ["nexus"],
                        colors: ["red", "purple"],
                        tribes: ["創界神", "靈異"],
                      },
                    ],
                  },
                  destination: "field",
                },
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    category: ["spirit"],
                    tribes: ["靈異"],
                    minCost: 4,
                  },
                  destination: "hand",
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv1-Lv2-Lv3 お互いの創界神ネクサスのシンボルを0にする。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "either",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                },
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
    cardNo: "BSTH001-C02",
    orikaId: 11,
    orikaIndex: 1,
    name: "シンギョク♂",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
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
      "このカード/スピリットのシンボル/軽減シンボルは、赤としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、自分のデッキを上から4枚オープンできる。その中のカード名：「幻想郷」、または系統：「創界神」/「靈異」を持つ赤/紫のネクサスカード1枚をコストを支払わずに配置し、系統：「靈異」を持つコスト4以上のスピリットカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2-Lv3",
      "お互いの創界神ネクサスのシンボルを0にする。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・靈異",
    image: "images/BSTH001-C02.webp",
    rarity: "C",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカード/スピリットのシンボル/軽減シンボルは、赤としても扱う。
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
        ],
        textRef: [0],
      },
      // Lv1-Lv2-Lv3『召喚/アタック時』ターン1回、デッキ4オープン、ネクサス配置+靈異スピ1枚手札。残りデッキ下。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    filterOr: [
                      {
                        category: ["nexus"],
                        colors: ["red", "purple"],
                        cardName: { exact: "幻想郷" },
                      },
                      {
                        category: ["nexus"],
                        colors: ["red", "purple"],
                        tribes: ["創界神", "靈異"],
                      },
                    ],
                  },
                  destination: "field",
                },
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    category: ["spirit"],
                    tribes: ["靈異"],
                    minCost: 4,
                  },
                  destination: "hand",
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv1-Lv2-Lv3 お互いの創界神ネクサスのシンボルを0にする。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "either",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                },
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
    cardNo: "BSTH001-C03",
    orikaId: 12,
    orikaIndex: 2,
    name: "魔界",
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
      "このカード/ネクサスは、系統：「幻想」/「靈異」を持つ。",
      "",
      "Lv1-Lv2『自分のドローステップ』",
      "ドローの枚数を+1する。ドロー後、自分は、手札のカード2枚か、系統：「靈異」を持つカード1枚か、系統：「起幻」を持つネクサスカード1枚を破棄する。この効果は重複しない。",
      "",
      "Lv2『自分のアタックステップ』",
      "系統：「靈異」を持つ自分の紫のスピリットがアタックしている間、相手は3コスト余分に支払わなければマジックカードのフラッシュ効果を使用できない。",
    ],
    keywordTags: [],
    tribe: "幻想・靈異",
    image: "images/BSTH001-C03.webp",
    rarity: "C",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカード/ネクサスは、系統：「幻想」/「靈異」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "靈異"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『自分のドローステップ』ドロー枚数+1。ドロー後、手札2枚 or 靈異1枚 or 起幻ネクサス1枚を破棄。
      // inline draw-step pre/post: draw_modify でプレ加算 → システムドロー →
      // discard(手札2枚) + choice(靈異1枚 / 起幻ネクサス1枚) でポスト破棄。
      // 「この効果は重複しない」= no_duplicate (03e §〔重複不可〕vs〔ターンに1回:同名〕、
      // per-card_name/turn とは別 keyword/scope。BSTH001-C04/転醒R01(A) 同型)。
      {
        timing: {
          kind: "phase",
          step: "draw",
          subPhase: "start",
          whose: "self",
        },
        inline: true,
        usageLimit: {
          kind: "no_duplicate",
        },
        executionMode: "mandatory",
        steps: [
          {
            action: {
              kind: "draw_modify",
              amount: 1,
              duration: {
                scope: "step",
                step: "draw",
              },
            },
          },
          {
            action: {
              kind: "discard",
              count: 2,
            },
            choice: [
              {
                action: {
                  kind: "discard",
                  count: 1,
                  filter: {
                    tribes: ["靈異"],
                  },
                },
              },
              {
                action: {
                  kind: "discard",
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    tribes: ["起幻"],
                  },
                },
              },
            ],
          },
        ],
        textRef: [2, 3],
      },
      // Lv2『自分のアタックステップ』靈異の紫スピがアタック中、相手は3コスト余分でなければマジックのフラッシュを使えない。
      // field_has.battleState:"attacking" (BSAZ02-C17 同型) + cost_modify player:opponent
      // cardFilter.usingEffectMode:["flash"] (BSDB01-X02 同型 additional_cost CE) の
      // 既存プリミティブ組み合わせで表現可能（新規プリミティブ不要）。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "step_phase", step: "attack", whose: "self" },
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            colors: ["purple"],
            tribes: ["靈異"],
            battleState: "attacking",
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "opponent",
              additionalPayment: true,
              cardFilter: { category: ["magic"], usingEffectMode: ["flash"] },
              modifier: { additionalCostValue: 3 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH001-C04",
    orikaId: 13,
    orikaIndex: 3,
    name: "地獄",
    printedCategory: "nexus",
    colors: ["red"],
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
      "このカード/ネクサスは、系統：「幻想」/「靈異」を持つ。",
      "",
      "Lv1-Lv2 フラッシュ",
      "このネクサスを疲労させることで、自分はデッキの上から1枚ドローする。この効果は、ターンに1回しか使えない。",
      "",
      "Lv2『自分のアタックステップ』",
      "系統：「靈異」を持つコスト5以上の自分の赤のスピリットのバトル終了時、相手のライフのコア1個をリザーブに置く。この効果は重複しない。",
    ],
    keywordTags: [],
    tribe: "幻想・靈異",
    image: "images/BSTH001-C04.webp",
    rarity: "C",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカード/ネクサスは、系統：「幻想」/「靈異」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "靈異"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2 フラッシュ：このネクサスを疲労させることで、デッキ1枚ドロー。ターンに1回。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        // 「このネクサスを疲労させることで」は回復状態からのみ支払える。
        // deck 0 では発揮不可。公式 Q22385（BS16:745-748）の「ドローできないため
        // 手札も破棄できない」裁定を、同型「Aすることで、1枚ドロー」へ適用する。
        // Q27333（【オンステージ】）の直接適用ではない。根拠は 02_turn-flow の Draw Step。
        // いずれも欠くと conditional_cost rollback が usageLimit を返却し、
        // effect-debug の auto-controller が同じ no-op 宣言を反復する。
        condition: [
          { kind: "self_state", state: "recovered" },
          { kind: "field_has", player: "self", zone: "deck", minCount: 1 },
        ],
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              target: { kind: "self" },
              state: "exhausted",
            },
          },
          { action: { kind: "draw", count: 1 }, connector: "conditional_cost" },
        ],
        textRef: [2, 3],
      },
      // Lv2『自分のアタックステップ』系統：「靈異」を持つコスト5以上の自分の赤のスピリットの
      // バトル終了時、相手のライフのコア1個をリザーブに置く。この効果は重複しない。
      // 第三者 game_event:battle_end 観測 (action:"attack" で『自分のアタックステップ』= 自分の
      // スピリットがアタック側で参加したバトルに限定)。〔重複しない〕は同名複数の 地獄 が
      // 同一バトル終了で多重発火しないよう no_duplicate で 1 回に畳む。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "battle_end",
          action: "attack",
          triggerFilter: {
            category: ["spirit"],
            colors: ["red"],
            tribesRequired: ["靈異"],
            minCost: 5,
          },
        },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "no_duplicate" },
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
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH001-C05",
    orikaId: 14,
    orikaIndex: 4,
    name: "死なばもろとも",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "purple"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「靈異」を持つ。",
      "自分の系統：「靈異」を持つ効果でデッキからオープンされたこのカードは手札に加えられる。",
      "",
      "フラッシュ",
      "疲労状態の相手のスピリット1体を破壊する。自分のカウント2以上のとき、破壊したスピリットは、フィールドに残らない。",
      "",
      "スタック",
      "最低Lvコスト1の相手のスピリット/アルティメット2体のコアが1個ずつになるようにリザーブに置く。この効果は、お互いのアタックステップにしか使えない。",
    ],
    keywordTags: [],
    tribe: "幻想・靈異",
    image: "images/BSTH001-C05.webp",
    rarity: "C",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」/「靈異」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "靈異"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // 靈異効果でオープンされたこのカードは手札に加えられる。
      //   BSFT01-C02 add 型（07b §6 裁定 2026-06-11）の trigger_tribes 版。
      //   テキストは「オープンされた」のみ（トラッシュ行きは含まない）ため event は revealed のみ。
      {
        timing: { kind: "card_event", event: "revealed" },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_tribes", tribes: ["靈異"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
          { kind: "trigger_source_player", player: "self" },
        ],
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        executionMode: "optional",
        textRef: [1],
      },
      // フラッシュ：疲労状態の相手スピリット1体を破壊。カウント2以上なら残らない。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], exhaustState: "exhausted" },
                count: 1,
              },
            },
            condition: [{ kind: "count_value", player: "self", max: 1 }],
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], exhaustState: "exhausted" },
                count: 1,
              },
              suppressDestroyedEffects: "destroyed_only",
            },
            condition: [{ kind: "count_value", player: "self", min: 2 }],
          },
        ],
        textRef: [3, 4],
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
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH001-C06",
    orikaId: 15,
    orikaIndex: 5,
    name: "星幽剣士",
    printedCategory: "magic",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red", "purple"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「靈異」を持つ。",
      "自分の系統：「靈異」を持つ効果でデッキからオープンされたこのカードは手札に加えられる。",
      "",
      "フラッシュ",
      "自分の創界神ネクサス/導界者ネクサスがなければ、自分は、デッキの上から2枚ドローする。",
      "",
      "スタック",
      "1コスト支払うことで、ブロック宣言するスピリット1体を破壊する。",
    ],
    keywordTags: [],
    tribe: "幻想・靈異",
    image: "images/BSTH001-C06.webp",
    rarity: "C",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」/「靈異」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "靈異"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // 靈異効果でオープンされたこのカードは手札に加えられる。
      //   BSFT01-C02 add 型（07b §6 裁定 2026-06-11）の trigger_tribes 版。
      //   テキストは「オープンされた」のみ（トラッシュ行きは含まない）ため event は revealed のみ。
      {
        timing: { kind: "card_event", event: "revealed" },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_tribes", tribes: ["靈異"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
          { kind: "trigger_source_player", player: "self" },
        ],
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        executionMode: "optional",
        textRef: [1],
      },
      // フラッシュ：創界神/導界者ネクサスがなければ、デッキ2枚ドロー。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [
          { kind: "field_lacks", player: "self", grandwalkerKind: "any" },
        ],
        steps: [{ action: { kind: "draw", count: 2 } }],
        textRef: [3, 4],
      },
      // スタック：1コスト支払うことで、ブロック宣言するスピリット1体を破壊する。
      // 「ことで」構文: pay_cost(1) → conditional_cost destroy（双方向ロールバック, 03c）。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "stack" },
        steps: [
          { action: { kind: "pay_cost", amount: 1 } },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], battleState: "blocking" },
                count: 1,
              },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH001-M01",
    orikaId: 16,
    orikaIndex: 6,
    name: "博麗 靈夢",
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
        bp: 12000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分の赤の導界者ネクサスすべてがLv2になるようにボイドからコアを置ける。この効果は、ゲーム中に1回しか使えない。",
      "",
      "Lv2-Lv3『このスピリットの召喚/アタック時』",
      "相手のスピリット/アルティメット1体を破壊する。この効果は、一切の効果で防げない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・博麗",
    image: "images/BSTH001-M01.webp",
    rarity: "M",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』自分の赤の導界者ネクサスすべてがLv2になるようコア配置。ゲーム1回。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "game" },
        steps: [
          {
            action: {
              kind: "core_set_to_level",
              from: { kind: "void", player: "self" },
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["nexus"],
                  colors: ["red"],
                  targetsGrandwalker: "only",
                  grandwalkerKind: "guided",
                },
                count: "all",
              },
              level: 2,
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『召喚/アタック時』相手のスピリット/アルティメット1体を破壊。一切の効果で防げない。
      // 「一切の効果で防げない」= affect immunity・target lock の両軸を貫通する真の blanket
      // （4段構造の最終行、P3-143 の done-definition）。kind:"all_effects" は元々両軸を
      // 貫通する既存 primitive なので、qa-020 XX02 marker (P3-141) の bypass 判定
      // （canSourceBypassResistanceCE）もこの値のまま満たす。新設 kind
      // blanket_affect_immunity は「お互い」(BSAZ02-C14) 専用。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        condition: [{ kind: "min_level", value: 2 }],
        preventionLevel: "unpreventable",
        targetLockBypass: { kind: "all_effects" },
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
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH001-R01",
    orikaId: 17,
    orikaIndex: 7,
    name: "魅魔",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red", "red"],
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
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "相手のネクサス1つを破壊する。",
      "",
      "Lv1-Lv2-Lv3 フラッシュ",
      "ターンに1回、1コスト支払うことで、自分はデッキの上から1枚ドローする。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・靈異",
    image: "images/BSTH001-R01.webp",
    rarity: "R",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚/アタック時』相手のネクサス1つを破壊する。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        steps: [
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
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3 フラッシュ：ターン1回、1コスト支払うことで、デッキ1枚ドロー。
      // 「ことで」構文: pay_cost(1) → conditional_cost draw（支払い不能/対象不能で双方向ロールバック, 03c）。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        // deck 0 では発揮不可。公式 Q22385（BS16:745-748）を同型
        // 「Aすることで、1枚ドロー」へ適用し、宣言前に候補外とする。
        // conditional_cost rollback による同一 no-op action の反復も防ぐ。
        condition: [
          { kind: "field_has", player: "self", zone: "deck", minCount: 1 },
        ],
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            action: {
              kind: "pay_cost",
              amount: 1,
              allowFieldCorePayment: true,
            },
          },
          {
            action: { kind: "draw", count: 1 },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH001-R02",
    orikaId: 18,
    orikaIndex: 8,
    name: "キクリ",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 5,
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
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "BP10000以下の相手のスピリット/アルティメット1体を破壊できる。破壊したスピリットは、フィールドに残らない。",
      "",
      "Lv2-Lv3『このスピリットのアタック/ブロック時』",
      "ターンに1回、このスピリットは回復する。",
      "",
      "Lv2-Lv3 スタック『自分のアタックステップ』",
      "ターンに1回、相手の白のマジックカード1枚のフラッシュ効果の使用を無効にできる。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・靈異",
    image: "images/BSTH001-R02.webp",
    rarity: "R",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『アタック時』BP10000以下の相手1体を破壊できる。残らない。
      // 残置抑制 (suppressDestroyedEffects) は『破壊したスピリットは…残らない』
      // の文言通り spirit に限定 (ultimate には適用しない)。
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
                filter: { category: ["spirit", "ultimate"], maxBp: 10000 },
                count: 1,
              },
              suppressDestroyedEffects: "destroyed_only",
              suppressDestroyedEffectsByCategory: ["spirit"],
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『アタック/ブロック時』ターン1回、このスピリットは回復する。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [3, 4],
      },
      // Lv2-Lv3 スタック『自分のアタックステップ』ターン1回、相手の白マジック1枚のフラッシュ効果使用を無効。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "self", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "use",
              targetFilter: { category: ["magic"], colors: ["white"] },
              targetEffectTiming: "flash",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH001-X01",
    orikaId: 19,
    orikaIndex: 9,
    name: "サリエル",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: ["purple", "purple", "purple", "purple"],
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
    symbolColors: ["purple", "purple"],
    textLines: [
      "【転召：1／幻想＆コスト3以上／ボイド】",
      "召喚コスト支払い後、対象の自分のスピリット1体の上のコアすべて（最低1個）をボイドに置かなければならない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "自分のカウント2以上のとき、相手のフィールド/リザーブのコア2個をボイドに置ける。",
      "",
      "Lv2-Lv3『自分のターン』",
      "自分の創界神ネクサス/導界者ネクサスがないとき、このスピリットは相手の効果を受けない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・靈異",
    image: "images/BSTH001-X01.webp",
    rarity: "X",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【転召：1／幻想＆コスト3以上／ボイド】召喚コスト支払い後、対象スピのコア全（最低1個）をボイドへ。
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
      // Lv1-Lv2-Lv3『アタック時』カウント2以上のとき、相手のフィールド/リザーブのコア2個をボイドへ。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", min: 2 }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "field", player: "opponent", includeReserve: true },
              to: { kind: "void", player: "opponent" },
              amount: 2,
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3『自分のターン』創界神/導界者ネクサスがないとき、このスピリットは相手の効果を受けない。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "field_lacks", player: "self", grandwalkerKind: "any" },
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
    cardNo: "BSTH001-X02",
    orikaId: 20,
    orikaIndex: 10,
    name: "コンガラ",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 7,
    reductionSymbols: ["red", "red", "red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
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
    symbolColors: ["red", "red"],
    textLines: [
      "【転召：1／幻想＆コスト3以上／ボイド】",
      "召喚コスト支払い後、対象の自分のスピリット1体の上のコアすべて（最低1個）をボイドに置かなければならない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "相手の創界神ネクサス1つのコアすべてをボイドに置く。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "このスピリットは、相手の効果を受けず、バトル終了時、ターンに1回、回復する。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・靈異",
    image: "images/BSTH001-X02.webp",
    rarity: "X",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【転召：1／幻想＆コスト3以上／ボイド】召喚コスト支払い後、対象スピのコア全（最低1個）をボイドへ。
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
      // Lv1-Lv2-Lv3『アタック時』相手の創界神ネクサス1つのコアすべてをボイドに置く。
      // 単一対象コアシュート: target で相手の創界神ネクサス1つ選択 → from:target_card →
      // amount:"all" で当該カード上の全コア (ソウルコア含む normalCoreCount) を相手ボイドへ。
      // 創界神は素で耐性 (10_rules/03c §50) のため targetsGrandwalker:true で明示。
      // 10_rules/07 §55 「導界者ネクサスは、創界神ネクサス対象の破壊/コア移動系の効果を受ける」
      // により tribes は ["導界者", "創界神"] (OR)。
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  tribes: ["導界者", "創界神"],
                  targetsGrandwalker: true,
                },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "void", player: "opponent" },
              amount: "all",
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2-Lv3『アタック時』このスピリットは相手の効果を受けない (バトル中)。
      //
      // 効果分離 (effect_immunity duration:battle / recover deferTo:battle_end) を 2026-06-23 に試行
      // したが、`effect_immunity duration:battle` を battle_end の pendingTriggeredEffects (separate
      // queue) 経路で保持できないギャップで verifier round 4-8 に繰り返し refute され revert。
      // ENGINE-battle-end-pending-triggered-vs-scope-battle-ce (finalizeBattleEndScopeExpirations を
      // pendingTriggeredEffects drain まで遅延) の着地後、本 commit で再分離。
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [6, 7],
      },
      // Lv1-Lv2-Lv3『アタック時』このスピリットはバトル終了時、ターンに1回、回復する。
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH001-転醒R01(A)",
    orikaId: 21,
    orikaIndex: 11,
    name: "陰陽玉",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: [],
    textLines: [
      "このネクサスは創界石ネクサス対象の効果しか受けない。このネクサスには解放と創界石ネクサス対象の効果でしかコアを置けず、そのコアは創界石ネクサス対象の効果しか受けず移動できない。",
      "",
      "【解封：〔カード名に「博麗」を含む／系統：「靈異」を持つ自分のスピリットの召喚／アタック〕】",
      "◆解放条件を満たしたとき、ボイドからコア1個をこのネクサスに置ける。",
      "",
      "このカードの軽減シンボルは、紫としても扱う。",
      "",
      "Lv1【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "このネクサスのコアが3個以上になったとき、このネクサスを裏返せる。（置かれているコアすべてをボイドに置く。）このとき、この転醒後ブレイヴは自分のスピリットに合体できる。",
      "",
      "【神秘】Lv1",
      "自分が系統：「博麗」/「靈異」/「賢者」を持つカードを召喚/配置/使用するとき、その軽減シンボル2つを満たす。この効果は重複しない。",
    ],
    keywordTags: ["double_sided", "enter_field_core_placement_forbidden"],
    tribe: "創界石・起幻・幻想",
    image: "images/BSTH001-転醒R01(A).webp",
    rarity: "TR",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 創界石ネクサス本体ルール [0]（創界石対象の効果しか受けない / 解封・創界石対象
    // でしかコア配置不可）+ 【解封】[2,3] + 転醒 [7,8]（コア3個以上・カウント3以下・
    // 全コアボイド・転醒後ブレイヴ合体可）は grandstoneData + エンジン基盤で表現する。
    grandstoneData: {
      unsealConditions: [
        {
          events: ["summon", "attack"],
          cardFilter: { nameContains: ["博麗"], categories: ["spirit"] },
        },
        {
          events: ["summon", "attack"],
          cardFilter: { tribes: ["靈異"], categories: ["spirit"] },
        },
      ],
      rebirthCoreThreshold: 3,
      rebirthMaxCount: 3,
      rebirthRetainCores: 0,
      postRebirth: "combine_with_own_spirit",
    },
    effects: [
      // このカードの軽減シンボルは、紫としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
          },
        ],
        textRef: [5],
      },
      // 【神秘】Lv1 博麗/靈異/賢者カードの召喚/配置/使用時、軽減シンボル2つを満たす。
      // BSTH09.2-転醒R03(A) 先例と同型 (whenPayingForFilter + waivesReductionRequirement)。
      // count:2 で「軽減シンボル2つを満たす」を表現。「重複しない」= usageLimit no_duplicate
      // (BSTH07-X01 symbol_add 先例と同型、getPayingForReductionWaiverCount 側で
      // definitionId+effectIndex 単位 dedup を消費する)。同名カード(このカード)が複数枚
      // フィールドにいても加算は 1 回分に留まる。
      {
        timing: { kind: "continuous" },
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["reduction_symbol"],
              whenPayingForFilter: { tribes: ["博麗", "靈異", "賢者"] },
              waivesReductionRequirement: true,
              count: 2,
            },
          },
        ],
        textRef: [10, 11],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "玄爺",
      printedCategory: "brave",
      colors: ["red"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 10000,
        },
      ],
      symbolColors: ["red"],
      textLines: [
        "この面に裏返ったとき、フィールドに残りカウント+1する（ボイドからコア1個を自分のカウントエリアに置く）。",
        "",
        "Lv1『このブレイヴの転醒時』",
        "相手のスピリット1体を破壊できる。",
        "",
        "【合体条件：博麗／靈異】",
        "【左右合体中】『このスピリットのアタック時』",
        "このスピリットは、ブロックされない。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想・異魔神",
      // 【合体条件：博麗／靈異】（系統 OR）
      braveCondition: { tribes: ["博麗", "靈異"] },
      // 異魔神ブレイヴ (10_rules/08c §7)。左右とも同一の系統OR条件（形式B: 左右共通の
      // 合体条件+【左右合体中】）のため sharedCondition のみで表現する。左スロットは
      // 既存の braveCondition/汎用単一合体をそのまま使い、右スロットは
      // engine-imagin-brave-dual-combine (legal-actions-availability.ts) が
      // sharedCondition を右合体条件として参照する。
      imaginBraveData: { sharedCondition: { tribes: ["博麗", "靈異"] } },
      image: "images/BSTH001-転醒R01(B).webp",
      rarity: "TR",
      pack: "BSTH001 東方靈異伝",
      cardNo: "BSTH001-転醒R01(B)",
      combinedBoost: 6000,
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1『このブレイヴの転醒時』相手のスピリット1体を破壊できる。
        {
          timing: { kind: "card_event", event: "rebirth" },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5,6,7]【合体条件：博麗／靈異】【左右合体中】『このスピリットのアタック時』
        //   このスピリットは、ブロックされない。
        // 【左右合体中】= 異魔神ブレイヴが左右両合体スロットで同時合体中
        // (isImaginBraveDualCombined, 10_rules/08c §7)。engine-imagin-brave-dual-combine
        // で新設した imaginDualCombined applicability + CardInstance.imaginRightCombinedWith
        // (右スロット、左スロットは既存の汎用単一合体 attachedToInstanceId を流用)。
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { imaginDualCombined: true },
          steps: [
            {
              action: {
                kind: "unblockable",
                target: { kind: "self" },
                duration: { scope: "battle" },
              },
            },
          ],
          textRef: [5, 6, 7],
        },
      ],
    },
  },
  {
    cardNo: "BSTH001-転醒R02(A)",
    orikaId: 22,
    orikaIndex: 12,
    name: "ユウゲンマガン",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "purple", "purple"],
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
      "相手のスピリット/アルティメット1体のコア1個をリザーブに置く。",
      "",
      "Lv2-Lv3",
      "自分のスピリットの「コア除去効果」で移動するコアの数を+1する。",
      "",
      "Lv2-Lv3 【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "自分が相手のスピリット/アルティメットを消滅/破壊したとき、このスピリットを裏返せる",
    ],
    keywordTags: ["double_sided"],
    tribe: "起幻・幻想・靈異",
    image: "images/BSTH001-転醒R02(A).webp",
    rarity: "TR",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』相手のスピリット/アルティメット1体のコア1個をリザーブに置く。
      //   単一対象コアシュート（core_move.target で相手1体を選択 → from: target_card、固定1個）。
      //   選んだ1体のコアのみを源にし、相手リザーブへ移す（BSSL01-C05 と同型）。
      {
        timing: { kind: "card_event", event: "summon" },
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
              amount: 1,
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3 自分のスピリットの「コア除去効果」で移動するコア数を+1する。
      //   core_move_amount_modifier 継続効果として登録し、executeCoreMove が対象
      //   コアシュート (相手カード源かつ source が自分のスピリット) の amount に
      //   +1 を加算する。終止形=強制、while_on_field で自動消滅。
      //   ライフ↔リザーブは「コア除去効果」と別扱い (10_rules/06 line 120) のため
      //   bonus を加算しない (executeCoreMove の card_instance パス限定で適用)。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "core_move_amount_modifier",
              scope: "self_player_spirits",
              amount: 1,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3【転醒：自分のカウント3以下】自分が相手のスピリット/アルティメットを消滅/破壊したとき裏返せる。
      //   10_rules/08a §2 line 93 写像: 「自分が相手を消滅/破壊したとき」=
      //   相手スピリット/アルティメットの離脱イベントを listener(自分側)で観測する
      //   game_event:[destroy,vanish] (player:opponent / triggerFilter:[spirit,ultimate])。
      //   cause:[battle, opponent_effect] = 離脱した相手カード視点で「自分以外による」破壊/消滅。
      //   battle=バトル討ち取り（討ち取った側=listener）、
      //   opponent_effect=destroyedCardController(=相手) と異なる causePlayerId=listener。
      //   self_effect は相手自身の自破壊効果のため「自分が」に該当せず除外。
      //   (deriveTriggerEventCauseFromPendingLeave: trigger-system.ts line 398-414)。
      //   sourceWhose:"either": leave_field/destroy family の actingPlayerId は「離脱した
      //   相手カードのコントローラ」を指し、listener(このカード)自身のコントローラとは
      //   一致しないため、既定 whose:"self" の自己コントローラ一致要求
      //   (getTriggeredEffectSourceUseBlockReason) では常に候補から除外されてしまう。
      //   player/cause で絞り込み済みのため明示的に外す (ENGINE-leave-field-third-party-
      //   opponent-source-whose 同型。ENGINE-cause-polarity-self-effect-opponent-effect-audit
      //   横断調査で本カードにも同型ギャップを検出)。
      //   転醒条件: Lv2 以上 + 自分のカウント3以下 (rebirth.maxCount で count_value 評価)。
      //   executeRebirth は自カードの flip。executionMode:optional=「裏返せる」(可能形)。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: ["destroy", "vanish"],
          triggerFilter: { category: ["spirit", "ultimate"] },
          cause: ["battle", "opponent_effect"],
          sourceWhose: "either",
        },
        executionMode: "optional",
        condition: [{ kind: "min_level", value: 2 }],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "幽幻魔眼",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 6,
      reductionSymbols: [],
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
        {
          level: 3,
          requiredCores: 4,
          bp: 8000,
        },
      ],
      symbolColors: ["purple"],
      textLines: [
        "この面に裏返ったとき、フィールドに残りカウント+1する（ボイドからコア1個を自分のカウントエリアに置く）。",
        "",
        "Lv1-Lv2-Lv3『このスピリットのアタック時』",
        "ターンに１回、相手のスピリット/アルティメット1体のコア2個をリザーブに置く。この効果で消滅したとき、自分はデッキの上から１枚ドローする。",
        "",
        "Lv2-Lv3『このスピリットのアタック時』",
        "バトル終了時、ターンに1回、このスピリットは回復する。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想・靈異",
      image: "images/BSTH001-転醒R02(B).webp",
      rarity: "TR",
      pack: "BSTH001 東方靈異伝",
      cardNo: "BSTH001-転醒R02(B)",
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1-Lv2-Lv3『このスピリットのアタック時』ターンに１回、相手のスピリット/
        //   アルティメット1体のコア2個をリザーブに置く。この効果で消滅したとき、ドロー1。
        //   単一対象コアシュート（target で1体選択 → from: target_card、固定 amount:2）。
        //   後段ドローは ref_leave_established（このコア移動で消滅が成立した）を発火条件にし、
        //   after_state_check で状態チェックだけ行い、誘発より先に同一効果を続ける。
        {
          timing: { kind: "card_event", event: "attack" },
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [
            {
              id: "r02b-coreshoot",
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
                amount: 2,
              },
            },
            {
              connector: "after_state_check",
              stepCondition: {
                kind: "ref_leave_established",
                stepId: "r02b-coreshoot",
                leaveKind: "vanish",
              },
              action: { kind: "draw", count: 1 },
            },
          ],
          textRef: [2, 3],
        },
        // [5,6] Lv2-Lv3『このスピリットのアタック時』バトル終了時、ターンに1回、
        //   このスピリットは回復する。
        {
          timing: {
            kind: "card_event",
            event: "attack",
            deferredTo: "battle_end",
          },
          condition: [{ kind: "min_level", value: 2 }],
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
          textRef: [5, 6],
        },
      ],
    },
  },
  {
    cardNo: "BSTH001-転醒R03(A)",
    orikaId: 23,
    orikaIndex: 13,
    name: "エリス（蝙蝠形態）",
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
        bp: 6000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 8000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分は、デッキの上から2枚ドローできる。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "相手のスピリット/アルティメット1体のコア2個までをリザーブに置く。",
      "",
      "Lv2-Lv3 【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "このスピリットがアタックしたか、このスピリットが相手によってフィールドを離れるとき、このスピリットを裏返せる。",
    ],
    keywordTags: ["double_sided"],
    tribe: "起幻・幻想・靈異",
    image: "images/BSTH001-転醒R03(A).webp",
    rarity: "TR",
    pack: "BSTH001 東方靈異伝",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』自分は、デッキの上から2枚ドローできる。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 2 } }],
        textRef: [0, 1],
      },
      // Lv2-Lv3『アタック時』相手のスピリット/アルティメット1体のコア2個までをリザーブに置く。
      //   単一対象コアシュート（core_move.target で相手1体を選択 → from: target_card、
      //   amount {min:0,max:2} で pendingCoreCountSelection、BSKB01 M02 と同型、P3-88）。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
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
              amount: { min: 0, max: 2 },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3【転醒：自分のカウント3以下（転醒は同時に使えない）】このスピリットがアタック
      //   したか、相手によってフィールドを離れるとき裏返せる。トリガーが2種(自分のアタック /
      //   相手起因の離脱)のため BSTH001-転醒R02(A) 型の rebirth ステップを2つの独立した
      //   effect（card_event:attack / card_event:leave_field cause:opponent）に分ける
      //   （BSSA01 の leave_field cause:["opponent_effect","battle"] 型と同型）。
      //   転醒条件「カウント3以下」は rebirth.maxCount で表現（R02(A) 同型）。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        condition: [{ kind: "min_level", value: 2 }],
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
        condition: [{ kind: "min_level", value: 2 }],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "エリス（人形態）",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 7,
      reductionSymbols: [],
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
          bp: 13000,
        },
      ],
      symbolColors: ["purple"],
      textLines: [
        "この面に裏返ったとき、フィールドに残りカウント+1する（ボイドからコア1個を自分のカウントエリアに置く）。",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』",
        "コア3個以下の相手のスピリット/アルティメット1体を破壊する。この効果で破壊したとき、相手のライフのコア1個をリザーブに置く。",
        "",
        "Lv2-Lv3",
        "疲労状態のこのスピリットは、相手の効果を受けない。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想・靈異",
      image: "images/BSTH001-転醒R03(B).webp",
      rarity: "TR",
      pack: "BSTH001 東方靈異伝",
      cardNo: "BSTH001-転醒R03(B)",
      effects: [
        // [0] flip 時カウント+1 はルール (08a §2 手順3) — executeRebirth が適用、効果化しない。
        // [2,3] Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』コア3個以下の相手の
        //   スピリット/アルティメット1体を破壊する。この効果で破壊したとき、
        //   相手のライフのコア1個をリザーブに置く。
        //   maxCores:3 で対象を「コア3個以下」に限定（soul 含む合計コア、engine batch2-1）。
        {
          timing: { kind: "card_event", event: ["rebirth", "attack"] },
          steps: [
            {
              id: "eris-doll-destroy",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"], maxCores: 3 },
                  count: 1,
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
                stepId: "eris-doll-destroy",
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5,6] Lv2-Lv3 疲労状態のこのスピリットは、相手の効果を受けない。
        {
          timing: { kind: "continuous" },
          condition: [
            { kind: "min_level", value: 2 },
            { kind: "self_state", state: "exhausted" },
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
          textRef: [5, 6],
        },
      ],
    },
  },
];
