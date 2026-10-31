import type { CardDefinition } from "@orica/rules-core";

export const BSTH03_CARDS: CardDefinition[] = [
  {
    summonCondition: [{ kind: "count_value", player: "self", min: 0, max: 0 }],
    cardNo: "BSTH03-C01",
    orikaId: 97,
    orikaIndex: 106,
    name: "レイセン",
    printedCategory: "ultimate",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple", "yellow", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 4000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 7000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分のカウント0》",
      "",
      "このカードの召喚コストは、0にならない。",
      "",
      "Lv3-Lv4『このアルティメットの召喚/アタック時』",
      "ターンに1回、自分のデッキを上から4枚オープンできる。その中の黄/紫の導界者ネクサスカード1枚と、系統：「想獣」/「魔影」を持つ黄/紫のスピリットカード/アルティメットカード1枚と、系統：「蓬莱」を持つブレイヴカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "Lv3-Lv4『自分のメインステップ』",
      "このアルティメットに、黄/紫として扱うシンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "月人・魔影",
    image: "images/BSTH03-C01.webp",
    rarity: "C",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの召喚コストは0にならない。（コスト軽減下限 floor:1、BSTH05.5-C01/BSTH06 precedent）
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { floor: 1 },
            },
          },
        ],
        textRef: [2],
      },
      {
        limitGroupId: "C01-summon-attack",
        timing: {
          kind: "card_event",
          event: "summon",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    colors: ["yellow", "purple"],
                    tribes: ["導界者"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["spirit", "ultimate"],
                    colors: ["yellow", "purple"],
                    tribes: ["想獣", "魔影"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["brave"],
                    tribes: ["蓬莱"],
                  },
                },
              ],
              remainder: "trash",
            },
          },
        ],
        textRef: [4, 5],
      },
      {
        limitGroupId: "C01-summon-attack",
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    colors: ["yellow", "purple"],
                    tribes: ["導界者"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["spirit", "ultimate"],
                    colors: ["yellow", "purple"],
                    tribes: ["想獣", "魔影"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["brave"],
                    tribes: ["蓬莱"],
                  },
                },
              ],
              remainder: "trash",
            },
          },
        ],
        textRef: [4, 5],
      },
      {
        // Lv3-Lv4『自分のメインステップ』のシンボル追加は、ルーミア型の
        // 継続効果。activated にすると同一 main step 内で同じ永続 CE を何度でも
        // 宣言でき、self-play が no-op を繰り返す。
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { level: { min: 3, max: 4 } },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: ["yellow", "purple"],
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSTH03-C02",
    orikaId: 98,
    orikaIndex: 107,
    name: "因幡 てゐ",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow", "purple"],
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
        requiredCores: 3,
        bp: 5000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、自分のデッキを上から4枚オープンできる。その中の黄/紫の導界者ネクサスカード1枚と、系統：「想獣」/「魔影」を持つ黄/紫のスピリットカード/アルティメットカード1枚と、系統：「蓬莱」を持つブレイヴカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "Lv1-Lv2-Lv3『自分のメインステップ』",
      "このスピリットに紫/究極として扱うシンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "幻想・想獣",
    image: "images/BSTH03-C02.webp",
    rarity: "C",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        limitGroupId: "C02-summon-attack",
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    colors: ["yellow", "purple"],
                    tribes: ["導界者"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["spirit", "ultimate"],
                    colors: ["yellow", "purple"],
                    tribes: ["想獣", "魔影"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["brave"],
                    tribes: ["蓬莱"],
                  },
                },
              ],
              remainder: "trash",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        limitGroupId: "C02-summon-attack",
        timing: {
          kind: "card_event",
          event: "attack",
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    colors: ["yellow", "purple"],
                    tribes: ["導界者"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["spirit", "ultimate"],
                    colors: ["yellow", "purple"],
                    tribes: ["想獣", "魔影"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["brave"],
                    tribes: ["蓬莱"],
                  },
                },
              ],
              remainder: "trash",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        // Lv1-Lv3『自分のメインステップ』のシンボル追加は、C01 と同じ
        // ルーミア型の継続効果。activated にすると同じ action を無制限に
        // 列挙して self-play が停止しない。
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { level: { min: 1, max: 3 } },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: ["purple", "ultimate_symbol"],
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH03-C03",
    orikaId: 99,
    orikaIndex: 108,
    name: "ミスティア・ローレライ",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "purple"],
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
        requiredCores: 3,
        bp: 6000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "メイン【アクセル：コスト3<黄>（この効果は手札から使用できる）】",
      "自分のトラッシュにあるカード名：「ミスティア・ローレライ」以外の系統：「想獣」/「魔影」/「歌鳥」/「蓬莱」を持つカード2枚までを手札に戻す。",
      "",
      "Lv2-Lv3『このスピリットの召喚/アタック時』",
      "自分のカウント0のとき、自分のライフが5以下なら、ターンに1回、ボイドからコア1個を自分のライフに置ける。相手のカウント1以上のとき、この効果は系統：「蓬莱」を持つ。",
    ],
    keywordTags: [],
    tribe: "幻想・想獣・歌鳥",
    image: "images/BSTH03-C03.webp",
    rarity: "C",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    accelData: {
      timing: "main",
      cost: 3,
      reduction: ["yellow"],
      effects: [
        {
          timing: {
            kind: "activated",
            mode: "main",
          },
          steps: [
            {
              action: {
                kind: "search_zone",
                zone: "trash",
                filter: {
                  tribes: ["想獣", "魔影", "歌鳥", "蓬莱"],
                  excludeCardName: "self",
                },
                count: { min: 0, max: 2 },
                destination: "hand",
              },
            },
          ],
          textRef: [0, 1],
        },
      ],
    },
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
          {
            kind: "count_value",
            player: "self",
            max: 0,
          },
          {
            kind: "life_value",
            player: "self",
            max: 5,
          },
        ],
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        // 相手のカウント1以上のとき、この効果は系統：「蓬莱」を持つ（効果メタ属性、
        // カード自身の tribe とは別軸。BSTH03-X02「自分の系統：「蓬莱」を持つ効果で、
        // 自分のライフが増えたとき」の trigger_tribes 条件から観測される）。
        effectTribes: {
          tribes: ["蓬莱"],
          condition: [{ kind: "count_value", player: "opponent", min: 1 }],
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
                kind: "life",
                player: "self",
              },
              amount: 1,
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH03-C04",
    orikaId: 100,
    orikaIndex: 109,
    name: "［幻想の蛍］リグル・ナイトバグ",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["green"],
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
    symbolColors: ["green"],
    textLines: [
      "このカード/スピリットのシンボルは赤としても扱う。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個をこのスピリットに置ける。自分のデッキを上から3枚オープンできる。その中の系統：「起幻」を持つ赤/緑の導界者ネクサスカード1枚と、系統：「幻想」と「起幻」を持つ赤/緑のカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2『相手のメインステップ』",
      "相手は、スピリット/アルティメットの効果で合計で2つ以上シンボルを追加できない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・殻人",
    image: "images/BSTH03-C04.webp",
    rarity: "C",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "red",
              appliesToCard: true,
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        steps: [
          {
            executionMode: "optional",
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
            executionMode: "optional",
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    category: ["nexus"],
                    colors: ["red", "green"],
                    tribes: ["起幻"],
                    targetsGrandwalker: true,
                    hasMechanic: ["guided"],
                  },
                },
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    colors: ["red", "green"],
                    tribes: ["幻想", "起幻"],
                    tribesLogic: "and",
                  },
                },
              ],
              remainder: "bottom",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv1-Lv2『相手のメインステップ』相手はスピリット/アルティメットの効果で
      // 合計2つ以上シンボルを追加できない = 相手player-scoped restrict_symbol_addition
      // (maxTotal:1, sourceFilter:category spirit/ultimate)。BSKB01-C02[5,6]
      // timing:continuous+timingScope(period:"main") precedent と同型。
      {
        timing: {
          kind: "continuous",
        },
        timingScope: { player: "opponent", period: "main" },
        steps: [
          {
            action: {
              kind: "restrict_symbol_addition",
              player: "opponent",
              maxTotal: 1,
              sourceFilter: { category: ["spirit", "ultimate"] },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH03-C11",
    orikaId: 101,
    orikaIndex: 110,
    name: "神宝「ライフスプリングインフィニティ」",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "purple", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュにあるこのカードは、このカード以外の効果を受けない。",
      "自分の系統：「蓬莱」/「想獣」/「魔影」を持つ効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられ、トラッシュから手札に加えたとき、ボイドからコア1個を系統：「蓬莱」を持つ自分の導界者ネクサスに置く。",
      "",
      "フラッシュ",
      "このターンの間、自分のライフは0にならない。",
    ],
    keywordTags: [],
    image: "images/BSTH03-C11.webp",
    rarity: "C",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // トラッシュにあるこのカードは、このカード以外の効果を受けない。
      // while_in_trash 束縛の effect_immunity（BSTH002-M01 等と同型、trash-zone-effect-immunity.test.ts
      // 参照）。「このカード以外の」＝自分/相手の他カード起因を防ぎ、このカード自身を
      // 発生源とする効果だけは通すため、sourcePlayerScope:"any" + sourceScope.excludeSelf で
      // 表現する。
      {
        applicability: { zone: "trash" },
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_in_trash" },
              sourcePlayerScope: "any",
              sourceScope: { excludeSelf: true },
            },
          },
        ],
        textRef: [0],
      },
      // 自分の系統：「蓬莱」/「想獣」/「魔影」を持つ効果でデッキからオープンされたか、トラッシュに
      // 置かれたこのカードは手札に加えられ（可能形＝任意）、トラッシュから手札に加えたとき、
      // ボイドからコア1個を系統：「蓬莱」を持つ自分の導界者ネクサスに置く。
      // BSTH02-R11/BSFT01-C02 の trigger_tribes 型 card_event 自動回収と同型（07b §6 裁定
      // 2026-06-11）。trigger_tribes 単独は発生源系統一致のみでコントローラーを絞らないため
      // trigger_source_player を併記する（BSTH03-C31 と同型パターン、line 2560 付近参照）。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          { kind: "trigger_tribes", tribes: ["蓬莱", "想獣", "魔影"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [
          { action: { kind: "move_self", destination: "hand" } },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["蓬莱", "導界者"],
                  tribesLogic: "and",
                },
              },
              amount: 1,
            },
          },
        ],
        executionMode: "optional",
        textRef: [1],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        // このターンの間、自分のライフは0にならない（ライフ下限保護 floor:1）。
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "floor",
              floor: 1,
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH03-C12",
    orikaId: 102,
    orikaIndex: 111,
    name: "神脳「オモイカネブレイン」",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "yellow", "ultimate_symbol"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」を持つ。",
      "自分の系統：「蓬莱」/「想獣」/「魔影」を持つ効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられ、トラッシュから手札に加えたとき、ボイドからコア1個を系統：「蓬莱」を持つ自分の導界者ネクサスに置く。",
      "",
      "メイン",
      "自分は、デッキの上から2枚ドローする。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH03-C12.webp",
    rarity: "C",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // BSTH03-C11 effects[1] と同型（trigger_tribes 型 card_event 自動回収）。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          { kind: "trigger_tribes", tribes: ["蓬莱", "想獣", "魔影"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [
          { action: { kind: "move_self", destination: "hand" } },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["蓬莱", "導界者"],
                  tribesLogic: "and",
                },
              },
              amount: 1,
            },
          },
        ],
        executionMode: "optional",
        textRef: [1],
      },
      {
        timing: {
          kind: "activated",
          mode: "main",
        },
        steps: [
          {
            action: {
              kind: "draw",
              count: 2,
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH03-C21",
    combinedBoost: 1000,
    orikaId: 103,
    orikaIndex: 112,
    name: "蓬莱の玉の枝",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "purple", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 4000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "スピリット状態のこのブレイヴは、アタック/ブロックできず、合体しているこのブレイヴのコストは0になる。",
      "",
      "【合体条件：コスト6以上＆アルティメット】",
      "【合体中】『自分のアタックステップ』",
      "系統：「幻想」と「想獣」/「魔影」を持つアルティメットとの合体中、このアルティメットは、系統：「蓬莱」を持ち、自分の黄/紫の効果でライフにコアを置いたとき、回復する。",
    ],
    keywordTags: [],
    tribe: "幻想・蓬莱",
    image: "images/BSTH03-C21.webp",
    rarity: "C",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【合体条件：コスト6以上＆アルティメット】(textLines[2])。
    braveCondition: { categories: ["ultimate"], minCost: 6 },
    effects: [
      // [0a] スピリット状態(非合体)のこのブレイヴはアタック/ブロックできない。
      //   applicability.combined=false で「スピリット状態」に限定 (BSES01/BSAZ02 precedent,
      //   [[project_brave_spirit_state_battle_ban]])。
      {
        timing: {
          kind: "continuous",
        },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
        textRef: [0],
      },
      // [0b] 合体しているこのブレイヴのコストは0になる。
      //   applicability.combined=true で「合体中」に限定し、override_properties.cost で
      //   getEffectiveCost の実効コストを 0 に固定する。テキストは「このスピリット」ではなく
      //   「このブレイヴ」明記のため target は host へリダイレクトしない source_card を使う
      //   (dsl-types.ts TargetSpec の self/source_card 区別、bsft01-tr-rebirth precedent と同型)。
      {
        timing: {
          kind: "continuous",
        },
        applicability: { combined: true },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "source_card" },
              properties: { cost: 0 },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // [2a] 【合体中】『自分のアタックステップ』系統「幻想」と「想獣」/「魔影」を持つ
      //   アルティメットとの合体中、そのアルティメットは系統「蓬莱」を持つ。
      //   ホスト系統条件 = 「幻想」AND（「想獣」OR「魔影」）。combined_host_tribes の
      //   tribesLogic は単一 AND/OR セットのみのため、OR は any_of (OR-of-AND) で
      //   2グループを包む。timingScope（自分のアタックステップ）は見出し行の直後に続く
      //   本文全体へのスコープ (BSKB01-R03「宝剣ギャラクシア」/BSAZ02-C12「ザーツバルム」の
      //   『合体中』『自分のアタックステップ』見出し + continuous 本文 precedent と同型)。
      //   付与先は「このアルティメット」= host。target:{kind:"self"} は合体中ブレイヴなら
      //   resolveSelfReferenceCard が自動的に host へリダイレクトする (dsl-types.ts TargetSpec)。
      {
        timing: { kind: "continuous" },
        applicability: { combined: true },
        condition: [
          {
            kind: "any_of",
            groups: [
              [
                {
                  kind: "combined_host_tribes",
                  tribes: ["幻想", "想獣"],
                  tribesLogic: "and",
                },
              ],
              [
                {
                  kind: "combined_host_tribes",
                  tribes: ["幻想", "魔影"],
                  tribesLogic: "and",
                },
              ],
            ],
          },
        ],
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["蓬莱"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // [2b] 同条件下、自分の黄/紫の効果でライフにコアを置いたとき、このアルティメット
      //   (host) が回復する。トリガーは core_placed_on_life game_event (P3-14 C-2、
      //   model.ts の CardEventType コメントが本カードを名指しで想定)。原因効果の
      //   コントローラは trigger_source_player、色は trigger_colors で絞る
      //   (BSTH03.ts 内「自分の系統：「蓬莱」を持つ効果でライフが増えたとき」姉妹実装と同型、
      //   色版は trigger_tribes の代わりに trigger_colors を使う)。どちらのライフへの
      //   配置かは原文が限定していないため game_event.player は "either"。
      {
        timing: {
          kind: "game_event",
          player: "either",
          event: "core_placed_on_life",
        },
        applicability: { combined: true },
        condition: [
          {
            kind: "any_of",
            groups: [
              [
                {
                  kind: "combined_host_tribes",
                  tribes: ["幻想", "想獣"],
                  tribesLogic: "and",
                },
              ],
              [
                {
                  kind: "combined_host_tribes",
                  tribes: ["幻想", "魔影"],
                  tribesLogic: "and",
                },
              ],
            ],
          },
          { kind: "trigger_source_player", player: "self" },
          { kind: "trigger_colors", colors: ["yellow", "purple"] },
        ],
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: { kind: "recover", target: { kind: "self" } },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH03-C31",
    orikaId: 104,
    orikaIndex: 113,
    name: "永遠亭",
    printedCategory: "nexus",
    colors: ["yellow", "purple"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow", "purple", "purple"],
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
    symbolColors: ["yellow"],
    textLines: [
      "このカード／ネクサスのシンボルは、紫としても扱う。",
      "自分の黄／紫の効果でデッキからオープンされたか、トラッシュに置かれたこのカードは、コストを支払わずに配置できる。",
      "",
      "Lv1-Lv2",
      "お互いのネクサスは破壊されず、デッキは破棄されない。また、お互い『このスピリットの召喚時』効果でボイドからコアを増やせない。",
      "",
      "Lv2",
      "自分の手札は、6枚以下の間、相手の効果を受けない。",
    ],
    keywordTags: [],
    image: "images/BSTH03-C31.webp",
    rarity: "C",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "purple",
              appliesToCard: true,
            },
          },
        ],
        textRef: [0],
      },
      // 07b の確定済み観測裁定に従い、「デッキからオープンされたか、トラッシュに置かれた」
      // は revealed/moved_to_trash ともに deck 起点を要求する同一 card_event として扱う。
      // ただし公式 Q16858 により、オープン済みカードを後から破棄した物理移動は除く。
      {
        timing: {
          kind: "card_event",
          event: ["revealed", "moved_to_trash"],
        },
        executionMode: "optional",
        condition: [
          {
            kind: "trigger_source_player",
            player: "self",
          },
          {
            kind: "trigger_colors",
            colors: ["yellow", "purple"],
          },
          {
            kind: "trigger_from_zone",
            zones: ["deck"],
          },
          {
            kind: "trigger_physical_from_zone",
            zones: ["deck"],
          },
        ],
        cardEventDisposition: {
          kind: "move",
          destination: "field",
        },
        steps: [
          {
            action: {
              kind: "move_self",
              destination: "field",
            },
          },
        ],
        textRef: [1],
      },
      // Lv1-Lv2（levelDefs は Lv1/Lv2 のみのため常時）: お互いのネクサスは破壊されず
      // (effect_resistance category:nexus/player:either/source:"all"、因不問)、
      // デッキは破棄されず (prevent_deck_discard player:either)、
      // お互い『このスピリットの召喚時』効果でボイドからコアを増やせない
      // (restrict_core_placement scope:from_void_self + sourceTimingScope:"summon"
      // + sourceFilter:category spirit。アルティメットや召喚時以外は制限しない)。
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "filter",
                player: "either",
                filter: { category: ["nexus"] },
                count: "all",
              },
              resistsOutcome: "destroy",
              source: "all",
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "prevent_deck_discard",
              player: "either",
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "restrict_core_placement",
              player: "either",
              scope: "from_void_self",
              sourceTimingScope: "summon",
              sourceFilter: { category: ["spirit"] },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2 自分の手札は6枚以下の間、相手の効果を受けない。
      // effect_immunity(target.zone:["hand"], count:"all", while_on_field) =
      // hand_count 条件付きゾーン免疫 (BSDB01-C06/BSTH02.7-C03/BSGE01-C04 と同型)。
      {
        timing: {
          kind: "continuous",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
          { kind: "hand_count", player: "self", max: 6 },
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
        textRef: [6, 7],
      },
    ],
  },
  {
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        symbolColors: ["red", "green"],
        minCount: 1,
      },
    ],
    cardNo: "BSTH03-M01",
    orikaId: 105,
    orikaIndex: 114,
    name: "[永夜抄]博麗 霊夢",
    printedCategory: "ultimate",
    colors: ["red"],
    cost: 7,
    reductionSymbols: ["red", "red", "red", "guide"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 11000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 18000,
      },
      {
        level: 5,
        requiredCores: 6,
        bp: 23000,
      },
    ],
    symbolColors: ["red", "ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の赤/緑のシンボル1つ以上》",
      "",
      "【バースト：相手によって自分のアルティメットがフィールドを離れた後】",
      "BP15000以下の相手のスピリットすべてを破壊する。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv5『このアルティメットのアタック時』",
      "このアルティメットはブロックされず、アルティメットとして扱わない。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・博麗",
    image: "images/BSTH03-M01.webp",
    rarity: "M",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: "相手によって自分のアルティメットがフィールドを離れた後",
          triggerFilter: { category: ["ultimate"] },
        },
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
                count: "all",
              },
            },
          },
          {
            // 「その後、このカードをコストを支払わずに召喚する」=自己召喚
            // (バースト本体を burst→field へ。BSTH003-X02 と同型)。
            action: {
              costModifier: "free",
              kind: "summon",
              target: { kind: "self" },
            },
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 5,
          },
        ],
        steps: [
          {
            action: {
              kind: "unblockable",
              target: { kind: "self" },
              duration: {
                scope: "battle",
              },
            },
          },
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { excludeCategory: "ultimate" },
              duration: {
                scope: "battle",
              },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        symbolColors: ["red", "green"],
        minCount: 1,
      },
    ],
    cardNo: "BSTH03-M02",
    orikaId: 106,
    orikaIndex: 115,
    name: "[永夜抄]八雲 紫",
    printedCategory: "ultimate",
    colors: ["green"],
    cost: 8,
    reductionSymbols: ["green", "green", "red", "red"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 12000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 19000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の赤/緑のシンボル1つ以上》",
      "",
      "【バースト：相手の『このスピリット/アルティメットの召喚時』発揮後】",
      "ボイドからコア2個を自分のリザーブに置く。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv3-Lv4『このアルティメットのアタック時』",
      "相手のスピリット/アルティメット1体を手札に戻せる。自分のカウント2以上のとき、ターンに1回、このアルティメットは回復する。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・妖戒",
    image: "images/BSTH03-M02.webp",
    rarity: "M",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: {
            kind: "effect_activated",
            player: "opponent",
            activatedTimings: ["summon"],
          },
          triggerFilter: { category: ["spirit", "ultimate"] },
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
                kind: "reserve",
                player: "self",
              },
              amount: 2,
            },
          },
          {
            // 「その後、このカードをコストを支払わずに召喚する」= burst→self-summon パターン
            // (10_rules/04b_burst-rules.md:34、先例 BSTS01-M01[4,5])。バースト解決中の
            // 発動元 zone は "burst" であり "hand" ではないため from_zone:hand は不一致/誤爆する
            // (target:{kind:"self"} は zone 制約なし=旧 summon_self 互換で costToPay=0)。
            // 「その後」= sequential (dsl-types.ts:1148、先例 BSTH03-M03/M07/M08)。
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
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
          {
            kind: "count_value",
            player: "self",
            min: 2,
          },
        ],
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "recover",
              target: { kind: "self" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH03-M03",
    orikaId: 107,
    orikaIndex: 116,
    name: "[永夜抄]レミリア・スカーレット",
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
      "【バースト：自分のライフ減少後】",
      "相手の創界神ネクサスのコアすべてをボイドに置く。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "ターンに1回、系統：「起幻」を持たない相手の創界神ネクサス1つを破壊する。この効果で破壊したとき、このスピリットは回復する。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・紅魔",
    image: "images/BSTH03-M03.webp",
    rarity: "M",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: { kind: "life_decrease", player: "self" },
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
            // 「その後、このカードをコストを支払わずに召喚する」= burst→self-summon パターン
            // (10_rules/04b_burst-rules.md:34、先例 BSTS01-M01[4,5])。BSTH03-M02 と同型修正。
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
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            id: "m03-destroy",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                  excludeTribeSubstring: ["起幻"],
                },
                count: 1,
              },
            },
          },
          {
            connector: "sequential",
            action: { kind: "recover", target: { kind: "self" } },
            stepCondition: { kind: "ref_succeeded", stepId: "m03-destroy" },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH03-M04",
    orikaId: 108,
    orikaIndex: 117,
    name: "[永夜抄]十六夜 咲夜",
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
      "疲労状態の相手のスピリット/アルティメット1体をデッキの下に戻す。この効果は系統：「起幻」を持たない効果では防げない。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv2『自分のアタックステップ』",
      "相手がマジックカードのスタック効果を使うとき、そのコストは、リザーブだけから支払わなければならない。",
    ],
    keywordTags: ["burst"],
    tribe: "起幻・幻想・紅魔",
    image: "images/BSTH03-M04.webp",
    rarity: "M",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: "相手によって自分のスピリットがフィールドを離れた後",
          triggerFilter: { category: ["spirit"] },
        },
        // 疲労状態フィルタは exhaustState で表現（重疲労も「疲労状態」に含む = recovered 以外）。
        // 「系統：「起幻」を持たない効果では防げない」= preventionRestriction.
        //   onlyPreventableByTribes:["起幻"]（effect 全体に適用、BSTH08-C06/C07 と同じ
        //   convention。stale な maxPreventable:0 単独表現は撤去 — engine-claude 2026-07-24）。
        // 「このカードを召喚」= バーストゾーンからの self-summon（from_zone hand は誤り）。
        preventionRestriction: { onlyPreventableByTribes: ["起幻"] },
        steps: [
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
                count: 1,
              },
              position: "bottom",
            },
          },
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
              costModifier: "free",
            },
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      // Lv2『自分のアタックステップ』相手のマジックのスタック効果コストをリザーブだけから
      // 支払わせる = リザーブ以外（フィールドのカード上）からの支払いを禁じる。
      // restrict_field_cost_payment (ENGINE-restrict-field-cost-payment、BSTH08-C06と同型)。
      // effectModes:["stack"] でマジックのスタック効果コストのみを制限対象に絞る
      // (本体の召喚/使用コストは制限しない)。timingScope で「自分のアタックステップ」限定。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
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
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        symbolColors: ["yellow"],
        minCount: 1,
      },
    ],
    cardNo: "BSTH03-M05",
    orikaId: 109,
    orikaIndex: 118,
    name: "[永夜抄]霧雨 魔理沙",
    printedCategory: "ultimate",
    colors: ["yellow"],
    cost: 6,
    reductionSymbols: [
      "yellow",
      "yellow",
      "yellow",
      "ultimate_symbol",
      "ultimate_symbol",
    ],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 12000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 15000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の黄のシンボル１つ以上》",
      "",
      "【バースト：相手の効果によって相手の手札が増えた後】",
      "このカードをコストを支払わずに召喚する。",
      "",
      "Lv3-Lv4-Lv5",
      "このアルティメットは、系統：「導魔」を持つブレイヴ3つまでと合体条件を無視して合体でき、それらの効果の「このスピリット」すべては、「このアルティメット」に変更する。",
      "",
      "Lv5『このアルティメットのアタック時』",
      "相手のライフから移動するコアすべてをボイドに置く。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・想獣・導魔",
    image: "images/BSTH03-M05.webp",
    rarity: "M",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    maxCombinedBraves: {
      count: 3,
      condition: { tribes: ["導魔"] },
      ignoreIncomingBraveCondition: true,
      selfReferenceRewrite: {
        fromText: "this_spirit",
        toHostCategory: "ultimate",
        executionMode: "mandatory",
      },
      effectIndex: 1,
    },
    effects: [
      // 【バースト：相手の効果によって相手の手札が増えた後】このカードをコストを支払わずに召喚する。
      // hand_increase trigger + cause:[self_effect] (P3-68: grower-relative self_effect で、
      // 所有者自身のバウンス等で相手手札が増えた場合は発動しない)。召喚 step は burst spirit の
      // 標準パターン target:self + costModifier:"free" (BSTH01-M13[1] / BSLH01-T01[0] と同型)。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "hand_increase", player: "opponent" },
          cause: ["self_effect"],
        },
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        // Lv3-Lv4-Lv5: 系統「導魔」ブレイヴ3つまでを、incoming 側 braveCondition を
        // 無視して受け入れる部分は maxCombinedBraves が表現する。合体中の導魔ブレイヴ
        // 効果内「このスピリット」→「このアルティメット」必須書換は rules-core の
        // 共通資格判定が effectIndex:1 の active 状態を見て継続適用する。
        timing: {
          kind: "continuous",
        },
        applicability: { level: { min: 3, max: 5 } },
        steps: [],
        textRef: [5, 6],
      },
      // Lv5『このアルティメットのアタック時』相手のライフから移動するコアすべてをボイドに置く。
      // このアタック中 (duration:attack) の core_move_destination_replacement CE を登録する。
      // 発生源限定なし (matchCausingSourceOnly 省略) = このアタック中の戦闘ダメージ等
      // 原因不問で、相手ライフ発のコア移動すべてをボイドへ強制置換する。
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 5,
          },
        ],
        steps: [
          {
            action: {
              kind: "core_move_destination_replacement",
              fromOwner: "opponent",
              fromZone: "life",
              toZone: "void",
              duration: { scope: "attack" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    summonCondition: [
      {
        kind: "field_has",
        player: "opponent",
        category: ["spirit", "ultimate"],
        minCount: 1,
      },
    ],
    cardNo: "BSTH03-M06",
    orikaId: 110,
    orikaIndex: 119,
    name: "[永夜抄]アリス・マーガトロイド",
    printedCategory: "ultimate",
    colors: ["yellow"],
    cost: 8,
    reductionSymbols: [
      "yellow",
      "yellow",
      "yellow",
      "ultimate_symbol",
      "ultimate_symbol",
    ],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 12000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 20000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：相手のスピリット／アルティメット１体以上》",
      "",
      "【バースト：相手のアタックステップ開始後】",
      "相手のスピリット/アルティメット1体を指定する。このターンの間、指定したスピリット/アルティメットはアタックできず、その効果すべては発揮されない。この効果発揮後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv3-Lv4『このアルティメットの召喚/アタック時』",
      "ターンに1回、ボイドからコア1個を自分のライフに置ける。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・想獣・導魔",
    image: "images/BSTH03-M06.webp",
    rarity: "M",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: {
            kind: "step_timing",
            player: "opponent",
            step: "attack",
            subPhase: "start",
          },
        },
        steps: [
          {
            id: "designate",
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
              restriction: ["attack"],
              duration: {
                scope: "turn",
              },
            },
          },
          {
            // 「その効果すべては発揮されない」= 指定した対象1体への blanket suppress_effect
            // (effectFilter 省略、先例 BSTH02.7-C01 effects[0])。designate step の解決対象を
            // target:{kind:"ref",stepId:"designate"} で共有し、再フィルタによる別対象選択を防ぐ。
            action: {
              kind: "suppress_effect",
              target: { kind: "ref", stepId: "designate" },
              duration: {
                scope: "turn",
              },
            },
            connector: "simultaneous",
          },
          {
            // 「この効果発揮後、このカードをコストを支払わずに召喚する」= burst→self-summon
            // パターン (10_rules/04b_burst-rules.md:34、先例 BSTS01-M01[4,5])。target:{kind:"self"}
            // は zone 制約なしのとき costToPay=0 (旧 summon_self 互換、structured-summon.ts:690-705)。
            // from_zone:hand は誤り（任意の手札カードを選んでしまい、コストも課される。バースト
            // 解決中の発動元 zone は "hand" ではなく "burst" のため本来一致すらしない）。
            // 「この効果発揮後」= sequential (dsl-types.ts:1148、先例 BSTH05-M02/BSTH09-M02)。
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
            connector: "after_triggers",
          },
        ],
        textRef: [2, 3],
      },
      {
        limitGroupId: "M06-summon-attack",
        timing: {
          kind: "card_event",
          event: "summon",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
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
                kind: "life",
                player: "self",
              },
              amount: 1,
            },
          },
        ],
        textRef: [5, 6],
      },
      {
        limitGroupId: "M06-summon-attack",
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
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
                kind: "life",
                player: "self",
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
    summonCondition: [{ kind: "count_value", player: "self", min: 0, max: 0 }],
    cardNo: "BSTH03-M07",
    orikaId: 111,
    orikaIndex: 120,
    name: "[永夜抄]西行寺 幽々子",
    printedCategory: "ultimate",
    colors: ["purple"],
    cost: 6,
    reductionSymbols: ["purple", "purple", "ultimate_symbol", "guide"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 16000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分のカウント０》",
      "",
      "【バースト：相手の効果によって相手の手札が増えた後】",
      "自分は、デッキの上か下だけから2枚ドローする。この効果で発動した相手のバースト効果は発揮されない。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv3-Lv4『このアルティメットの召喚/破壊時』",
      "相手のスピリットのコア２個を相手のリザーブに置く。または、相手の手札1枚を内容を見ないで破棄する。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・魔影・冥主",
    image: "images/BSTH03-M07.webp",
    rarity: "M",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: { kind: "hand_increase", player: "opponent" },
          // 「相手の効果によって」= 手札が増えたプレイヤー自身の効果 (grower-relative
          // self_effect)。所有者自身のバウンス等で相手手札が増えた場合は発動しない (P3-68)。
          cause: ["self_effect"],
        },
        steps: [
          {
            // 「デッキの上か下だけから2枚ドロー」= draw(position) + choice プリミティブ
            // (BSTH003-C33/M01/R02 と同型)。
            action: {
              kind: "draw",
              count: 2,
              position: "top",
            },
            choice: [
              { action: { kind: "draw", count: 2, position: "bottom" } },
            ],
          },
          // この解決に直接起因する相手の反応だけを抑止する。
          {
            action: {
              kind: "negate",
              negateTarget: "opponent_burst",
              causedByThisEffect: true,
            },
            connector: "sequential",
          },
          {
            // 「このカードをコストを支払わずに召喚する」= target:self + costModifier:"free"
            // (BSTH03-M05 effects[0] 同文言と同型)。「その後」= sequential。
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
      // Lv3-Lv4『召喚/破壊時』二択（コントローラ選択）:
      //   選択肢1 (choiceIndex 0): 相手のスピリット1体のコア2個を相手のリザーブへ
      //     （単一対象コアシュート core_move.target + from:target_card、BSTH001-転醒R02(A) 同型）。
      //   選択肢2 (choiceIndex 1): 相手の手札1枚を内容を見ないで破棄（opponent random discard）。
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              from: { kind: "target_card" },
              to: {
                kind: "reserve",
                player: "opponent",
              },
              amount: 2,
            },
            choice: [
              {
                action: {
                  kind: "discard",
                  player: "opponent",
                  count: 1,
                  unseen: true,
                },
              },
            ],
          },
        ],
        textRef: [5, 6],
      },
      // 『破壊時』も同じ二択（召喚時と同構造）。
      {
        timing: {
          kind: "card_event",
          event: "destroy",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              from: { kind: "target_card" },
              to: {
                kind: "reserve",
                player: "opponent",
              },
              amount: 2,
            },
            choice: [
              {
                action: {
                  kind: "discard",
                  player: "opponent",
                  count: 1,
                  unseen: true,
                },
              },
            ],
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    summonCondition: [{ kind: "count_value", player: "self", min: 0, max: 0 }],
    cardNo: "BSTH03-M08",
    orikaId: 112,
    orikaIndex: 121,
    name: "[永夜抄]魂魄 妖夢",
    printedCategory: "ultimate",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "ultimate_symbol", "guide"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 9000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分のカウント０》",
      "",
      "【バースト：相手の『このスピリット／アルティメットの召喚時』発揮後】",
      "相手は、相手の手札が2枚になるように破棄する。その後、自分のライフが5以下なら、このカードをコストを支払わずに召喚する。",
      "",
      "Lv3-Lv4",
      "このアルティメットが相手によってフィールドを離れるとき、相手のカウントが1以上なら、回復状態でフィールドに残ることができる。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・魔影・冥主",
    image: "images/BSTH03-M08.webp",
    rarity: "M",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: {
            kind: "effect_activated",
            player: "opponent",
            activatedTimings: ["summon"],
          },
          triggerFilter: { category: ["spirit", "ultimate"] },
        },
        steps: [
          {
            action: {
              kind: "discard",
              player: "opponent",
              count: -1,
              targetHandSize: 2,
            },
          },
          {
            condition: [{ kind: "life_value", player: "self", max: 5 }],
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
      {
        // Lv3-Lv4「このアルティメットが相手によってフィールドを離れるとき、相手のカウントが1以上
        //   なら、回復状態でフィールドに残ることができる。」SSOT流用: BSSG01-M01[6]/BSTH02-X05[1]
        //   と同型の card_event(leave_field, cause opponent) + stay_on_field。コスト無しの単純
        //   任意選択のため conditional_cost 連結は使わず executionMode:"optional" のみで表現。
        //   「相手によって」= cause:["opponent_effect","battle"]（BSTH02-X05 comment 参照）。
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
          {
            kind: "count_value",
            player: "opponent",
            min: 1,
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "stay_on_field",
              target: { kind: "self" },
              newExhaustState: "recovered",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    summonCondition: [{ kind: "count_value", player: "self", min: 0, max: 0 }],
    cardNo: "BSTH03-R01",
    orikaId: 113,
    orikaIndex: 122,
    name: "鈴仙・優曇華院・イナバ",
    printedCategory: "ultimate",
    colors: ["purple"],
    cost: 6,
    reductionSymbols: ["purple", "yellow", "ultimate_symbol", "guide"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 14000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分のカウント０》",
      "",
      "Lv3-Lv4『相手のアタックステップ開始時』",
      'このターンの間、相手のスピリット3体に"『このスピリットのアタック時』このスピリットを破壊する。"を与える。',
      "",
      "Lv4『このアルティメットのアタック時』",
      "相手のスピリット1体を指定する。このターンの間、そのスピリットはブロックできず、効果すべては発揮されない。自分の紫の導界者ネクサスがあるとき、自分のトラッシュのコア1個を自分のライフに置ける。",
    ],
    keywordTags: [],
    tribe: "幻想・魔影",
    image: "images/BSTH03-R01.webp",
    rarity: "R",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [2,3] 相手のスピリット3体に"『このスピリットのアタック時』このスピリットを破壊する。"を
      //   与える。grant_effect (P3-99、template=BSTH05-X01) で card_event:attack を
      //   grantedEffect として登録し、duration:turn = 「このターンの間」。
      {
        timing: {
          whose: "opponent",
          kind: "phase",
          step: "attack",
          subPhase: "start",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
        steps: [
          {
            action: {
              kind: "grant_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 3,
              },
              duration: { scope: "turn" },
              grantedEffect: {
                timing: { kind: "card_event", event: "attack" },
                executionMode: "mandatory",
                steps: [
                  { action: { kind: "destroy", target: { kind: "self" } } },
                ],
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 4,
          },
        ],
        steps: [
          {
            id: "designate",
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
              restriction: ["block"],
              duration: {
                scope: "turn",
              },
            },
          },
          {
            // 「効果すべては発揮されない」= blanket suppress_effect、designate step の
            // 解決対象を ref で共有 (BSTH03-M06 effects[0] 同型)。
            action: {
              kind: "suppress_effect",
              target: { kind: "ref", stepId: "designate" },
              duration: {
                scope: "turn",
              },
            },
            connector: "simultaneous",
          },
          {
            // 「自分の紫の導界者ネクサスがあるとき、自分のトラッシュのコア1個を自分のライフに
            // 置ける」= field_has (grandwalkerKind:"guided"、先例 BSTH02.ts core_move
            // filter と同型) ゲート + 任意 core_move（「置ける」= optional、project_kuwaerareru_optional）。
            condition: [
              {
                kind: "field_has",
                player: "self",
                category: ["nexus"],
                colors: ["purple"],
                tribes: ["導界者"],
                grandwalkerKind: "guided",
              },
            ],
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 1,
            },
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH03-R02",
    orikaId: 114,
    orikaIndex: 123,
    name: "フェニックス再誕",
    printedCategory: "magic",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "green", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「起幻」を持つ。",
      "",
      "メイン",
      "自分は、デッキの上から2枚ドローする。",
      "",
      "スタック",
      "1コスト支払うことで、このバトルの間、相手は手札1枚を破棄しなければフラッシュ効果を発揮できない。",
    ],
    keywordTags: [],
    tribe: "幻想・起幻",
    image: "images/BSTH03-R02.webp",
    rarity: "R",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // このカードは系統：「幻想」/「起幻」を持つ（textLine[0]）。
        // 静的な系統付与は tribe フィールド ("幻想・起幻") が表現する（def.tribe.split("・")）。
        timing: {
          kind: "continuous",
        },
        steps: [],
        textRef: [0],
      },
      {
        timing: {
          kind: "activated",
          mode: "main",
        },
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
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "stack",
        },
        steps: [
          {
            action: {
              kind: "pay_cost",
              amount: 1,
            },
          },
          {
            connector: "conditional_cost",
            action: {
              kind: "gate_flash_stack_hand_discard",
              player: "opponent",
              count: 1,
              targetEffectLabels: ["flash"],
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH03-R03",
    orikaId: 115,
    orikaIndex: 124,
    name: "産霊「ファーストピラミッド」",
    printedCategory: "magic",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「起幻」を持つ。",
      "このカードは、『お互いのアタックステップ』にしか使えない。",
      "",
      "フラッシュ",
      "相手のスピリット/アルティメット2体を重疲労させる。",
      "",
      "スタック",
      "相手のスピリット2体を疲労させる。",
    ],
    keywordTags: [],
    tribe: "幻想・起幻",
    image: "images/BSTH03-R03.webp",
    rarity: "R",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // このカードは系統：「幻想」/「起幻」を持つ（textLine[0]）。
        // 静的な系統付与は tribe フィールド ("幻想・起幻") が表現する（def.tribe.split("・")）。
        timing: {
          kind: "continuous",
        },
        steps: [],
        textRef: [0],
      },
      {
        // 『お互いのアタックステップ』にしか使えない（textLine[1]）。
        // 使用制限はフラッシュ/スタック効果の timingScope で表現する。
        timing: {
          kind: "continuous",
        },
        steps: [],
        textRef: [1],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        // カード使用制限『お互いのアタックステップ』（textLine[1]）。
        timingScope: { player: "both", period: "attack" },
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
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "activated",
          mode: "stack",
        },
        // カード使用制限『お互いのアタックステップ』（textLine[1]）。
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 2,
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        symbolColors: ["yellow", "purple"],
        minCount: 1,
      },
    ],
    cardNo: "BSTH03-X01",
    orikaId: 116,
    orikaIndex: 125,
    name: "蓬莱山 輝夜",
    printedCategory: "ultimate",
    colors: ["yellow"],
    cost: 8,
    reductionSymbols: [
      "yellow",
      "yellow",
      "purple",
      "purple",
      "ultimate_symbol",
      "ultimate_symbol",
    ],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 12000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 19000,
      },
      {
        level: 5,
        requiredCores: 7,
        bp: 24000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の黄／紫のシンボル1つ以上》",
      "",
      "Lv3-Lv4-Lv5",
      "このアルティメットは、フィールドを離れず、コアがLv3コストより少なくならない。この効果は一切の効果を受けない。",
      "",
      "Lv4-Lv5『このアルティメットのアタック時』",
      "自分の黄の導界者ネクサスのコア1個を自分のライフに置ける。そうしたとき、相手のスピリット/ネクサス1つをデッキの下に戻す。この効果は黄の効果以外では防げない。",
    ],
    keywordTags: [],
    tribe: "幻想・蓬莱・想獣",
    image: "images/BSTH03-X01.webp",
    rarity: "X",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        preventionLevel: "immune",
        timing: {
          kind: "continuous",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
        steps: [
          {
            // フィールドを離れず、コアはLv3コストより少なくならない。この効果は一切の
            // 効果を受けない（source:"all"＝自分/相手いずれの効果でも防げない。BSTH03-X02の
            // 同型「フィールドを離れず」source:"all"パターンを踏襲。coreMinimumSource は
            // BSTH08.5 面霊スピリット level:1 版と同型）。
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: ["leave_field", "core_below_min"],
              coreMinimumSource: { kind: "own_level_required_cores", level: 3 },
              source: "all",
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 4,
          },
        ],
        executionMode: "optional",
        // 「この効果は黄の効果以外では防げない」= preventionRestriction.onlyPreventableByColors
        // (BSTH01-C?? flash bp_modify 型、BSTH03.ts:3312 notPreventableByTribes と同型 precedent)。
        preventionRestriction: { onlyPreventableByColors: ["yellow"] },
        steps: [
          {
            // 「自分の黄の導界者ネクサスのコア1個」= core_move.from:field_card（単一カード源、
            // BSTH07.8.ts:1616-1629【界放：3】precedent と同型）+ tribes/colors/targetsGrandwalker。
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  colors: ["yellow"],
                  tribes: ["導界者"],
                  targetsGrandwalker: true,
                },
              },
              to: {
                kind: "life",
                player: "self",
              },
              amount: 1,
            },
          },
          {
            // 「そうしたとき」= conditional_result（前段の任意実行成否が後段の前提。
            // BSAZ02.ts:3600-3616 precedent と同型）。後段は「戻す」(戻せる、ではない) なので
            // executionMode は指定しない = 前段成立時は強制。
            connector: "conditional_result",
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "nexus"],
                },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH03-X02",
    orikaId: 117,
    orikaIndex: 126,
    name: "[導界者]八意 永琳",
    printedCategory: "nexus",
    colors: ["yellow", "purple"],
    cost: 2,
    reductionSymbols: ["yellow", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
      {
        level: 2,
        requiredCores: 5,
        bp: 0,
      },
    ],
    symbolColors: ["guide"],
    textLines: [
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・導技・導域は、・神託・神技・神域としても扱う。",
      "",
      "【導託：〔想獣／魔影＆コスト3以上〕〔想獣／魔影＆アルティメット〕】",
      "◆対象の自分のスピリット/アルティメットを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "このカードの配置コスト0にならない。このネクサスは、フィールドを離れず、シンボルは黄/紫/究極としても扱う。",
      "",
      "【導技：3】Lv1-Lv2 フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回、このネクサスのコア3個をボイドに置く〕疲労状態の相手のスピリット/アルティメット1体を消滅させる。消滅するスピリット/アルティメットのコアはリザーブに置かれる。",
      "",
      "【導域】Lv2『自分のアタックステップ』",
      "自分の系統：「蓬莱」を持つ効果で、自分のライフが増えたとき、相手のライフのコア1個を相手のリザーブに置く。この効果は重複しない。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    tribe: "導界者・蓬莱",
    image: "images/BSTH03-X02.webp",
    rarity: "X",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 本体ルール [0] + 導託 [2,3,4] は grandwalkerData + エンジン基盤
    // (oracle-system / 対象除外 / コア配置制限) で表現。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        // 〔想獣／魔影＆コスト3以上〕は素のカード種別 = スピリット
        // （〔想獣／魔影＆アルティメット〕が別掲のため。BSAZ02-X05 と同じ折り込み規約）。
        { tribes: ["想獣", "魔影"], categories: ["spirit"], minCost: 3 },
        { tribes: ["想獣", "魔影"], categories: ["ultimate"] },
      ],
      // 【導技：3】Lv1-Lv2 フラッシュ『お互いのアタックステップ』
      //   〔ターンに1回、コア3個をボイドに置く〕。導技=神技扱い。
      //   コスト・ターン制限は divineSkills 経路でエンジン検査（BSTH04-X01 と同型）。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 3,
          timing: { step: "attack", whose: "both", mode: "flash" },
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          // 疲労状態の相手スピリット/アルティメット1体を消滅（コアはリザーブ=vanish 既定）。
          effects: [
            {
              textRef: [8, 9],
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "vanish",
                    target: {
                      kind: "filter",
                      player: "opponent",
                      filter: {
                        category: ["spirit", "ultimate"],
                        exhaustState: "exhausted",
                      },
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
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "yellow",
            },
          },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "ultimate_symbol",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "self",
              },
              resistsOutcome: "leave_field",
              source: "all",
              duration: {
                scope: "while_on_field",
              },
            },
            connector: "simultaneous",
          },
          {
            // このカードの配置コスト0にならない。（コスト軽減下限 floor:1）
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { floor: 1 },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【導技：3】(flash) は grandwalkerData.divineSkills で表現（上記参照）。
      // 【導域】Lv2『自分のアタックステップ』自分の系統：「蓬莱」を持つ効果で自分のライフが
      // 増えたとき、相手のライフのコア1個を相手のリザーブに置く。ライフ増加検知は
      // core_placed_on_life（P3-14 C-2、reduce_life 対称の game_event）を再利用し、
      // 増加原因効果の「自分の」を trigger_source_player:self、系統フィルタを
      // trigger_tribes 条件 + engine-effect-tribe-tag-life-increase-trigger の
      // 効果メタ系統タグ primitive (Effect.effectTribes → TriggerContext.sourceTribes)
      // で表現する（trigger_tribes 単独は発生源の系統一致しか見ずコントローラーを
      // 絞らないため、trigger_source_player 併記が必須。BSTH03-C31 と同型パターン）。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "core_placed_on_life",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
          {
            kind: "trigger_source_player",
            player: "self",
          },
          {
            kind: "trigger_tribes",
            tribes: ["蓬莱"],
          },
        ],
        timingScope: { player: "self", period: "attack" },
        usageLimit: {
          kind: "no_duplicate",
        },
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "life",
                player: "opponent",
              },
              to: {
                kind: "reserve",
                player: "opponent",
              },
              amount: 1,
            },
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
  {
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        symbolColors: ["red", "green"],
        minCount: 1,
      },
    ],
    cardNo: "BSTH03-X04",
    orikaId: 118,
    orikaIndex: 127,
    name: "藤原 妹紅",
    printedCategory: "ultimate",
    colors: ["red"],
    cost: 8,
    reductionSymbols: ["red", "red", "red", "green", "green"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 12000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 20000,
      },
      {
        level: 5,
        requiredCores: 6,
        bp: 25000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の赤／緑のシンボル1つ以上》",
      "",
      "このカード／アルティメットは、系統：「起幻」を持つ。",
      "",
      "Lv3-Lv4-Lv5",
      "このアルティメットは、フィールドを離れず、コアがLv3コストより少なくならない。この効果は一切の効果を受けない。",
      "",
      "Lv4-Lv5『このアルティメットのアタック時』",
      "ゲーム中に1回、自分のカウント1につき、相手のライフのコア1個をリザーブに置く。（最大3個）",
    ],
    keywordTags: [],
    tribe: "幻想・蓬莱・空牙・起幻",
    image: "images/BSTH03-X04.webp",
    rarity: "X",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        preventionLevel: "immune",
        timing: {
          kind: "continuous",
        },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
        steps: [
          {
            // BSTH03-X01 と同型（フィールドを離れず、コアはLv3コストより少なくならない。
            // この効果は一切の効果を受けない）。
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: ["leave_field", "core_below_min"],
              coreMinimumSource: { kind: "own_level_required_cores", level: 3 },
              source: "all",
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [4, 5],
      },
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 4,
          },
        ],
        usageLimit: {
          kind: "per_instance",
          duration: "game",
        },
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "life",
                player: "opponent",
              },
              to: {
                kind: "reserve",
                player: "opponent",
              },
              amount: {
                source: {
                  kind: "count_value",
                  player: "self",
                },
                cap: 3,
              },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSTH03-転醒R01(A)",
    orikaId: 119,
    orikaIndex: 128,
    name: "人里",
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
      "スピリット／アルティメットが疲労したか、このネクサスが相手によってフィールドを離れるとき、このネクサスを裏返せる。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分は、デッキの上から1枚ドローする。",
      "",
      "Lv2",
      "このネクサスのシンボルは、赤としても扱う。",
    ],
    keywordTags: ["double_sided"],
    tribe: "起幻・幻想",
    image: "images/BSTH03-転醒R01(A).webp",
    rarity: "TR",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2【転醒：自分のカウント3以下】スピリット／アルティメットが疲労したか、
      //   このネクサスが相手によってフィールドを離れるとき、このネクサスを裏返せる。
      //   転醒トリガーは誘発（game_event:exhaust / card_event:leave_field cause:opponent_effect）。
      //   両トリガーとも count_value max:3 でゲートし rebirth ステップが flip する。
      //   leave_field 経路は executeRebirth が pendingLeave を解除しフィールドに残す
      //   （08a:83 + 04:14 離脱待機状態での置換）。BSTH06-転醒R01(A) と同型。
      {
        timing: {
          kind: "game_event",
          player: "either",
          event: "exhaust",
          triggerFilter: { category: ["spirit", "ultimate"] },
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
          cause: "opponent_effect",
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 3 }],
        steps: [{ action: { kind: "rebirth", maxCount: 3 } }],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "card_event",
          event: "place",
        },
        steps: [
          {
            action: {
              kind: "draw",
              count: 1,
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "continuous",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "red",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "里跡の荒野",
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
        "この面に裏返ったとき、フィールドに残りカウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1『このネクサスの転醒時』",
        "合体していない相手のスピリット1体を破壊する。",
        "",
        "Lv1",
        "自分のカウントが減ったとき、このネクサスを裏返して配置できる。この効果はターンに1回しか使えない。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想",
      image: "images/BSTH03-転醒R01(B).webp",
      rarity: "TR",
      pack: "BSTH03 東方永夜抄",
      cardNo: "BSTH03-転醒R01(B)",
      effects: [
        // [0] この面に裏返ったとき、フィールドに残りカウント+1する。
        //   この行はルール (08a_advent-rebirth-contract.md §2 手順3、効果ではない) —
        //   executeRebirth が countValue+1 を適用済みのため effects に書かない
        //   (効果化すると二重計上＋効果無効の影響を受ける)。
        // [2,3] Lv1『このネクサスの転醒時』合体していない相手のスピリット1体を破壊する。
        //   「合体していない」= CardFilter.combined:false（card-filter.ts、Applicability.combined と同正準）。
        //   転醒時 = card_event:"rebirth"（executeRebirth が flip 後に発火、BSTH06-転醒R01(B) と同型）。
        {
          timing: { kind: "card_event", event: "rebirth" },
          textRef: [2, 3],
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit"],
                    combined: false,
                  },
                  count: 1,
                },
              },
            },
          ],
        },
        // [5,6] Lv1 自分のカウントが減ったとき、このネクサスを裏返して配置できる。ターンに1回。
        //   逆転醒（B面→A面 裏返して配置）= reverse_rebirth mode:"summon"（10_rules/08a §逆転醒
        //   パターン2、BSTH06/07-転醒R01(B) と同型）。「コストを支払わず」明記が無いため通常配置。
        //   発火トリガー = game_event:count_decrease（自分のカウント減少を観測、player 値イベント）。
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "count_decrease",
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
    cardNo: "BSTH03-転醒X01(A)",
    orikaId: 120,
    orikaIndex: 129,
    name: "上白沢 慧音",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 5,
    reductionSymbols: ["green", "red", "guide"],
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
    ],
    symbolColors: ["green"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア2個をこのスピリットに置ける。",
      "",
      "Lv1-Lv2",
      "このスピリットのシンボルは、赤としても扱う。",
      "",
      "Lv2【転醒：自分のカウント5以下（転醒は同時に使えない）】",
      "このスピリットがアタックしたとき、このスピリットに自分の《ソウルコア》を置いて裏返せる。",
    ],
    keywordTags: ["double_sided"],
    tribe: "起幻・幻想・剣獣",
    image: "images/BSTH03-転醒X01(A).webp",
    rarity: "TX",
    pack: "BSTH03 東方永夜抄",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
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
              amount: 2,
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "continuous",
        },
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
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        executionMode: "optional",
        applicability: {
          level: {
            min: 2,
          },
        },
        condition: [
          {
            kind: "count_value",
            player: "self",
            max: 5,
          },
        ],
        steps: [
          {
            id: "keine-place-field-soul-core",
            stepCondition: { kind: "rebirth_precheck", maxCount: 5 },
            action: {
              kind: "core_move",
              from: {
                kind: "field",
                player: "self",
              },
              to: {
                kind: "this_card",
              },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            id: "keine-place-reserve-soul-core",
            stepCondition: { kind: "rebirth_precheck", maxCount: 5 },
            action: {
              kind: "core_move",
              from: {
                kind: "reserve",
                player: "self",
              },
              to: {
                kind: "this_card",
              },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            id: "keine-place-trash-soul-core",
            stepCondition: { kind: "rebirth_precheck", maxCount: 5 },
            action: {
              kind: "core_move",
              from: {
                kind: "trash",
                player: "self",
              },
              to: {
                kind: "this_card",
              },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            id: "keine-place-life-soul-core",
            stepCondition: { kind: "rebirth_precheck", maxCount: 5 },
            action: {
              kind: "core_move",
              from: {
                kind: "life",
                player: "self",
              },
              to: {
                kind: "this_card",
              },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            action: {
              kind: "rebirth",
              maxCount: 5,
              vanishAfterFlipOnLvDeficit: true,
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "上白沢 慧音-白澤-",
      printedCategory: "spirit",
      colors: ["green"],
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
          bp: 10000,
        },
        {
          level: 3,
          requiredCores: 4,
          bp: 14000,
        },
      ],
      symbolColors: ["green"],
      textLines: [
        "この面に裏返ったとき、フィールドに残りカウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』",
        "ターンに1回、相手のスピリット/アルティメット/ネクサス1つを除外する。この効果は系統：「蓬莱」を持つ一切の効果で防げず、フィールドに残らない。",
        "",
        "Lv2-Lv3『このスピリットのアタック時』",
        "自分のカウント3以上のとき、相手は手札のカードを使用できない。",
        "",
        "Lv3『このスピリットのアタック時』",
        "バトル終了時、自分のカウント-1する（自分のカウントエリアからコア1個をボイドに置く）ことで、このスピリットは回復する。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想・剣獣",
      image: "images/BSTH03-転醒X01(B).webp",
      rarity: "TX",
      pack: "BSTH03 東方永夜抄",
      cardNo: "BSTH03-転醒X01(B)",
      effects: [
        // [0] この面に裏返ったとき、フィールドに残りカウント+1する。
        //   この行はルール (08a_advent-rebirth-contract.md §2 手順3、効果ではない) —
        //   executeRebirth が countValue+1 を適用済みのため effects に書かない
        //   (効果化すると二重計上＋効果無効の影響を受ける)。
        {
          timing: { kind: "card_event", event: ["rebirth", "attack"] },
          textRef: [2, 3],
          usageLimit: { kind: "per_instance", duration: "turn" },
          preventionRestriction: { notPreventableByTribes: ["蓬莱"] },
          steps: [
            {
              action: {
                kind: "remove_from_game",
                pierceCannotLeaveField: true,
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit", "ultimate", "nexus"],
                  },
                  count: 1,
                },
              },
            },
          ],
        },
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [5, 6],
          condition: [
            { kind: "min_level", value: 2 },
            { kind: "count_value", player: "self", min: 3 },
          ],
          steps: [
            {
              action: {
                kind: "restrict_use",
                player: "opponent",
                filter: { zone: ["hand"] },
                duration: { scope: "attack" },
              },
            },
          ],
        },
        {
          // 『このスピリットのアタック時』バトル終了時、自分のカウント-1することで回復する
          // (「ことで」構文＝conditional_cost、BSTH01-C?? 同型の
          // card_event:attack + deferredTo:"battle_end" precedent)。
          timing: {
            kind: "card_event",
            event: "attack",
            deferredTo: "battle_end",
          },
          textRef: [8, 9],
          condition: [{ kind: "min_level", value: 3 }],
          executionMode: "optional",
          steps: [
            { action: { kind: "count_decrease", player: "self", amount: 1 } },
            {
              action: {
                kind: "recover",
                target: {
                  kind: "self",
                },
              },
              connector: "conditional_cost",
            },
          ],
        },
      ],
    },
  },
];
