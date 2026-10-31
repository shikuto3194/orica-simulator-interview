import type { CardDefinition } from "@orica/rules-core";

export const BSTH05_5_CARDS: CardDefinition[] = [
  {
    summonCondition: [{ kind: "life_value", player: "self", min: 2 }],
    cardNo: "BSTH05.5-C01",
    orikaId: 153,
    orikaIndex: 162,
    name: "要石",
    printedCategory: "ultimate",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue", "blue", "ultimate_symbol", "blue"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 4000,
      },
      {
        level: 4,
        requiredCores: 2,
        bp: 6000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分のライフ2以上》",
      "",
      "このカードの召喚コストは0にならない。",
      "",
      "Lv3-Lv4『このアルティメットの召喚時』",
      "相手のデッキを上から2枚除外する。",
      "",
      "Lv3-Lv4『自分のアタックステップ』",
      "系統：「緋想」/「竜渡」を持つ自分のスピリット/アルティメットがアタックしたとき、相手のデッキを上から2枚除外する。",
      "",
      "Lv4『自分のメインステップ』",
      "このアルティメットに青のシンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "幻想・緋想",
    image: "images/BSTH05.5-C01.webp",
    rarity: "C",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの召喚コストは0にならない。（コスト軽減下限 floor:1）
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
        textRef: [2],
      },
      // Lv3-Lv4『このアルティメットの召喚時』相手のデッキを上から2枚除外する。
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "opponent", position: "top" },
              to: { zone: "removed_from_game" },
              count: 2,
            },
          },
        ],
        textRef: [4, 5],
      },
      // Lv3-Lv4『自分のアタックステップ』系統：「緋想」/「竜渡」を持つ自分のスピリット/
      // アルティメットがアタックしたとき、相手のデッキを上から2枚除外する。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "attack",
          triggerFilter: {
            category: ["spirit", "ultimate"],
            tribes: ["緋想", "竜渡"],
          },
        },
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "opponent", position: "top" },
              to: { zone: "removed_from_game" },
              count: 2,
            },
          },
        ],
        textRef: [7, 8],
      },
      // Lv4『自分のメインステップ』このアルティメットに青のシンボル1つを追加する。
      // ルーミア型の継続効果。activated + permanent だと起動毎に永続シンボルが累積するため continuous 化。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { level: { min: 4, max: 4 } },
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
        textRef: [10, 11],
      },
    ],
  },
  {
    cardNo: "BSTH05.5-C02",
    orikaId: 154,
    orikaIndex: 163,
    name: "[緋想天]魂魄 妖夢",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue", "guide"],
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
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の系統：「竜渡」/「幻想」を持つ青のネクサスカード1枚と、系統：「緋想」を持つカード1枚を手札に加える。残ったカードは好きな順番でデッキの上か下だけに戻す。",
      "",
      "Lv1-Lv2",
      "このスピリットが相手によってフィールドを離れるとき、相手のデッキ1枚破棄する。その後、ボイドからコア1個をこのスピリットに置くことで、このスピリットは疲労状態でフィールドに残る。",
    ],
    keywordTags: [],
    tribe: "幻想・緋想・戦姫",
    image: "images/BSTH05.5-C02.webp",
    rarity: "C",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このスピリットの召喚時』デッキ上3枚オープン、竜渡/幻想の青ネクサス1枚と
      // 緋想カード1枚を手札に加える。残りは上か下に戻す。
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
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    colors: ["blue"],
                    tribes: ["竜渡", "幻想"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: { tribes: ["緋想"] },
                },
              ],
              remainder: "top_or_bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2 相手によってフィールドを離れるとき、相手のデッキ1枚破棄。その後、ボイドから
      // コア1個をこのスピリットに置くことで、疲労状態でフィールドに残る。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "opponent", position: "top" },
              to: { zone: "trash" },
              count: 1,
              deckDiscard: true,
            },
          },
          {
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
            connector: "sequential",
          },
          {
            action: {
              kind: "stay_on_field",
              target: { kind: "self" },
              newExhaustState: "exhausted",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH05.5-C03",
    orikaId: 155,
    orikaIndex: 164,
    name: "比那名居 地子",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue", "guide"],
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
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から4枚オープンできる。その中の系統：「竜渡」/「幻想」を持つ青のネクサスカード1枚と、系統：「緋想」/「竜渡」を持つアルティメットカード1枚と、系統：「緋想」を持つブレイヴカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv2『自分のメインステップ』",
      "このスピリットに青/究極として扱うシンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "幻想・緋想",
    image: "images/BSTH05.5-C03.webp",
    rarity: "C",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このスピリットの召喚時』デッキ上4枚オープン、竜渡/幻想の青ネクサス1枚、
      // 緋想/竜渡のアルティメット1枚、緋想のブレイヴ1枚を手札に加える。残りはデッキの下へ。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
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
                    colors: ["blue"],
                    tribes: ["竜渡", "幻想"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["ultimate"],
                    tribes: ["緋想", "竜渡"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["brave"],
                    tribes: ["緋想"],
                  },
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2『自分のメインステップ』このスピリットに青/究極として扱うシンボル1つを追加する。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { level: { min: 2, max: 2 } },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: ["blue", "ultimate_symbol"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH05.5-C04",
    orikaId: 156,
    orikaIndex: 165,
    name: "[緋想天]アリス・マーガトロイド",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue", "ultimate_symbol"],
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
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分はデッキの上から2枚ドローできる。ドロー後、自分は手札1枚を破棄する。",
      "",
      "Lv1-Lv2",
      "このスピリットは、アタックできず、相手の効果を受けない。このスピリットと、自分の青の導界者ネクサスは系統：「起幻」を持つ。",
    ],
    keywordTags: [],
    tribe: "幻想・緋想・導魔",
    image: "images/BSTH05.5-C04.webp",
    rarity: "C",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『このスピリットの召喚時』
      // 自分はデッキの上から2枚ドローできる。ドロー後、自分は手札1枚を破棄する。
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "draw",
              count: 2,
            },
          },
          {
            action: {
              kind: "discard",
              count: 1,
              player: "self",
            },
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2 このスピリットは、アタックできず、
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack"],
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2 相手の効果を受けない。
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2 このスピリットは系統：「起幻」を持つ
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["起幻"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2 自分の青の導界者ネクサスは系統：「起幻」を持つ
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["nexus"],
                  colors: ["blue"],
                  tribes: ["導界者"],
                  targetsGrandwalker: true,
                },
                count: "all",
              },
              properties: { addTribes: ["起幻"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH05.5-C10",
    orikaId: 157,
    orikaIndex: 166,
    name: "羽衣「羽衣は空の如く」",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue", "blue", "god"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「竜渡」/「緋想」を持つ。",
      "",
      "メイン",
      "自分は、デッキの上から3枚ドローする。その後、手札すべてまたは系統：「緋想」/「竜渡」/「幻想」を持つ青のカード1枚を破棄する。これらの効果で、相手の効果は発揮されない。",
    ],
    keywordTags: [],
    tribe: "幻想・竜渡・緋想",
    image: "images/BSTH05.5-C10.webp",
    rarity: "C",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」/「竜渡」/「緋想」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "竜渡", "緋想"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // メイン：デッキの上から3枚ドロー。その後、手札すべて、または系統：「緋想」/「竜渡」/
      // 「幻想」を持つ青のカード1枚を破棄する。これらの効果で、相手の効果は発揮されない。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          // 破棄方法の選択待ちより前に、原因効果全体の反応抑止を登録する。
          // 「これらの効果で、相手の効果は発揮されない」= needs-ruling.jsonl
          // (BSTH03-M07,BSTH02-M02、裁定B確定 2026-07-26) と同一idiom。対象はこのカード自身の
          // 解決（ドロー+破棄）が原因で新たに発動する相手側の効果で、バーストに限らない通常の
          // 誘発効果も含む。negateTarget:"effect"（非バースト反応）と negateTarget:
          // "opponent_burst"（バースト反応）の2ステップを両方登録し、両ケースを網羅する
          // （BSTH02-M02 と同型）。
          {
            action: {
              kind: "negate",
              negateTarget: "effect",
              targetController: "opponent",
              causedByThisEffect: true,
            },
            connector: "sequential",
          },
          {
            action: {
              kind: "negate",
              negateTarget: "opponent_burst",
              causedByThisEffect: true,
            },
            connector: "sequential",
          },
          { action: { kind: "draw", count: 3 } },
          // 「手札すべて」（primary, count:-1=全破棄） または「緋想/竜渡/幻想の青1枚」
          // （choice[0]）の選択 = discard + choice プリミティブ（BSTH03-M07 draw(position)+
          // choice と同型）。
          {
            targetSelectionTiming: "on_step",
            label: "手札すべてを破棄",
            action: {
              kind: "discard",
              count: -1,
              player: "self",
            },
            choice: [
              {
                label: "青の緋想/竜渡/幻想1枚を破棄",
                action: {
                  kind: "discard",
                  count: 1,
                  player: "self",
                  filter: {
                    colors: ["blue"],
                    tribes: ["緋想", "竜渡", "幻想"],
                  },
                },
              },
            ],
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH05.5-C20",
    orikaId: 158,
    orikaIndex: 167,
    name: "天界",
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue", "blue", "god"],
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
      "このカード/ネクサスは、系統：「幻想」/「緋想」を持ち、アルティメットカード/アルティメットとして【導託】できる。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "ボイドからコア2個を自分のリザーブに置く。この効果は、ターンに1回しか使えない。",
      "",
      "Lv2『自分のアタックステップ』",
      "このネクサスは、自分の効果で、導界者ネクサスとして疲労させることができる。",
    ],
    keywordTags: [],
    tribe: "幻想・緋想",
    image: "images/BSTH05.5-C20.webp",
    rarity: "C",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカード/ネクサスは、系統：「幻想」/「緋想」を持ち、アルティメットとして【導託】できる。
      // 系統付与 (addTribes) に加え、actsAsUltimateForOracleTrigger opt-in
      // (SSOT: hasOracleUltimateOptIn, mechanics/oracle-ultimate-opt-in.ts) で
      // OracleCondition.categories:["ultimate"] 判定にのみ一致させる（グローバル
      // getEffectiveCategory は書き換えない、effects[2] の
      // actsAsGuidedNexusForOwnExhaustEffects と同型の局所 opt-in）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: {
                addTribes: ["幻想", "緋想"],
                actsAsUltimateForOracleTrigger: true,
              },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『このネクサスの配置時』ボイドからコア2個を自分のリザーブに置く。ターンに1回。
      {
        timing: { kind: "card_event", event: "place" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
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
        textRef: [2, 3],
      },
      // Lv2『自分のアタックステップ』このネクサスは、自分の効果で、導界者ネクサスとして疲労できる。
      // isGrandwalkerOrGuidedNexus (SSOT, 12箇所超から参照) は拡張せず、
      // override_properties.actsAsGuidedNexusForOwnExhaustEffects の opt-in を付与する
      // (CardFilter.includesGrandwalkerExhaustOptIn を明示した消費側フィルタのみが admit する
      // 局所的 bypass。SSOT: hasGrandwalkerExhaustOptIn, mechanics/grandwalker-exhaust-opt-in.ts)。
      // 「自分の効果で」= actingPlayerId 一致判定でこの opt-in を付与したプレイヤー限定。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "step_phase", step: "attack", whose: "self" },
        ],
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { actsAsGuidedNexusForOwnExhaustEffects: true },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH05.5-M01",
    combinedBoost: 4000,
    orikaId: 159,
    orikaIndex: 168,
    name: "緋想の剣・布都御魂",
    printedCategory: "brave",
    colors: ["blue"],
    cost: 5,
    reductionSymbols: ["blue", "blue", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: [],
    textLines: [
      "【合体条件：天人＆コスト6以上＆アルティメット】",
      "",
      "【合体中】【超重装甲：∞】",
      "このアルティメットは、相手のフィールドにあるシンボルの色の効果を受けない。",
      "",
      "【合体中】『このアルティメットのアタック時』",
      "このアルティメットが最高Lvのとき、このアルティメットの「コスト破壊効果」は一切の効果で防げない。",
    ],
    keywordTags: [],
    tribe: "剣刃・緋想",
    image: "images/BSTH05.5-M01.webp",
    rarity: "M",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【合体条件：天人＆コスト6以上＆アルティメット】
    braveCondition: {
      categories: ["ultimate"],
      tribes: ["天人"],
      minCost: 6,
    },
    effects: [
      // 【合体中】【超重装甲：∞】このアルティメットは、相手のフィールドにあるシンボルの色の効果を受けない。
      // ∞ = 相手フィールドの実効シンボル色すべてを動的な色集合として使う
      // (colorsFromOpponentFieldSymbols、BSTH02-X03 の静的 colors 版と同型の effect_immunity)。
      {
        applicability: { combined: true },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              sourceScope: { colorsFromOpponentFieldSymbols: true },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 3],
      },
      // 【合体中】『このアルティメットのアタック時』最高Lvのとき「コスト破壊効果」は一切の効果で防げない。
      // 合体ブレイヴ発の継続 CE として、合体先自身のアタック中にホストの cost_destroy 効果だけを
      // unpreventable 化する。最高Lvは合体先の定義と実効Lvから判定する。
      {
        applicability: { combined: true },
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [
          {
            kind: "self_state",
            state: "on_field",
            reference: "self",
            battleState: "attacking",
            filter: { atOwnMaximumLevel: true },
          },
        ],
        steps: [
          {
            action: {
              kind: "grant_effect_source_prevention_immunity",
              player: "self",
              sourceScope: {
                effectClass: "cost_destroy",
                source: "combined_host",
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
    summonCondition: [{ kind: "life_value", player: "opponent", min: 2 }],
    cardNo: "BSTH05.5-M02",
    orikaId: 160,
    orikaIndex: 169,
    name: "リュウグウノツカイ",
    printedCategory: "ultimate",
    colors: ["blue"],
    cost: 6,
    reductionSymbols: ["blue", "blue", "ultimate_symbol", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 13000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 16000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：相手のライフ2以上》",
      "",
      "Lv3-Lv4-Lv5『このアルティメットの召喚時』",
      "コスト6以下の相手のスピリット/アルティメット1体を破壊する。さらに、自分の青の導界者ネクサスがあるとき、相手のデッキを6枚破棄する。",
      "",
      "Lv3-Lv4-Lv5",
      "このアルティメットは相手の効果で破壊されない。",
      "",
      "Lv4-Lv5『このアルティメットのアタック時』",
      "相手のデッキを7枚破棄する。",
    ],
    keywordTags: [],
    tribe: "天渡・竜渡・異合",
    image: "images/BSTH05.5-M02.webp",
    rarity: "M",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv3-Lv4-Lv5『このアルティメットの召喚時』コスト6以下の相手のスピリット/アルティメット
      // 1体を破壊する。さらに、自分の青の導界者ネクサスがあるとき、相手のデッキを6枚破棄する。
      {
        timing: { kind: "card_event", event: "summon" },
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
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "opponent", position: "top" },
              to: { zone: "trash" },
              count: 6,
              deckDiscard: true,
            },
            connector: "simultaneous",
            condition: [
              {
                kind: "field_has",
                player: "self",
                category: ["nexus"],
                colors: ["blue"],
                tribes: ["導界者"],
              },
            ],
          },
        ],
        textRef: [2, 3],
      },
      // Lv3-Lv4-Lv5 このアルティメットは相手の効果で破壊されない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "destroy",
              source: "opponent_effect",
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [5, 6],
      },
      // Lv4-Lv5『このアルティメットのアタック時』相手のデッキを7枚破棄する。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 4 }],
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "opponent", position: "top" },
              to: { zone: "trash" },
              count: 7,
              deckDiscard: true,
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSTH05.5-M03",
    orikaId: 161,
    orikaIndex: 170,
    name: "[緋想天]小野塚 小町",
    printedCategory: "ultimate",
    colors: ["blue"],
    cost: 6,
    reductionSymbols: ["blue", "blue", "ultimate_symbol", "ultimate_symbol"],
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
      "《召喚条件：自分のライフ2以上》",
      "",
      "【バースト：相手のスピリット/アルティメットのアタック後】",
      "相手の創界神ネクサス/導界者ネクサス1つずつのコアを6個ずつボイドに置く。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv4『このアルティメットのアタック/ブロック時』",
      "相手のスピリット/アルティメット1体を消滅させる。この効果で消滅するスピリット/アルティメットのコアはリザーブに置かれる。さらに、自分の導界者ネクサスがあるとき、相手のデッキを5枚破棄する。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・緋想・冥主",
    image: "images/BSTH05.5-M03.webp",
    rarity: "M",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    summonCondition: [{ kind: "life_value", player: "self", min: 2 }],
    effects: [
      // 【バースト：相手のスピリット/アルティメットのアタック後】相手の創界神/導界者ネクサス
      // 1つずつのコアを6個ずつボイドに置く。その後、このカードをコストを支払わずに召喚する。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "attack_finished", player: "opponent" },
          triggerFilter: { category: ["spirit", "ultimate"] },
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
                  hasMechanic: ["grandwalker"],
                  targetsGrandwalker: "only",
                },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "void", player: "opponent" },
              amount: 6,
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
                  hasMechanic: ["guided"],
                  targetsGrandwalker: "only",
                },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "void", player: "opponent" },
              amount: 6,
            },
            connector: "sequential",
          },
          {
            action: {
              costModifier: "free",
              kind: "summon",
              target: { kind: "self" },
            },
            connector: "sequential",
          },
        ],
        allowDuplicateTargets: true,
        textRef: [2, 3],
      },
      // Lv4『このアルティメットのアタック/ブロック時』相手のスピリット/アルティメット1体を消滅させる
      // （コアはリザーブ）。さらに、自分の導界者ネクサスがあるとき、相手のデッキを5枚破棄する。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        condition: [{ kind: "min_level", value: 4 }],
        steps: [
          {
            action: {
              kind: "vanish",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "opponent", position: "top" },
              to: { zone: "trash" },
              count: 5,
              deckDiscard: true,
            },
            connector: "simultaneous",
            condition: [
              {
                kind: "field_has",
                player: "self",
                category: ["nexus"],
                tribes: ["導界者"],
              },
            ],
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    summonCondition: [{ kind: "life_value", player: "opponent", min: 2 }],
    cardNo: "BSTH05.5-M04",
    orikaId: 162,
    orikaIndex: 171,
    name: "[緋想天]射命丸 文",
    printedCategory: "ultimate",
    colors: ["blue"],
    cost: 8,
    reductionSymbols: ["blue", "blue", "ultimate_symbol", "ultimate_symbol"],
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
      "《召喚条件：相手のライフ2以上》",
      "",
      "自分のトラッシュに系統：「緋想」/「風神」を持つカードがあるとき、セットしているこのカードは相手の効果を受けない。",
      "",
      "【バースト：自分のライフ減少後】",
      "このカードをコストを支払わずに召喚する。",
      "",
      "Lv3-Lv4『このアルティメットの召喚/アタック時』",
      "相手のスピリット/アルティメット1体を重疲労させる。さらに、自分の青の導界者ネクサスがあるとき、相手のデッキを上から4枚除外する。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・緋想・風神",
    image: "images/BSTH05.5-M04.webp",
    rarity: "M",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 自分のトラッシュに系統：「緋想」/「風神」を持つカードがあるとき、セットしているこのカードは
      // 相手の効果を受けない。
      {
        applicability: { zone: "burst_set" },
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            zone: "trash",
            tribes: ["緋想", "風神"],
          },
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
        textRef: [2],
      },
      // 【バースト：自分のライフ減少後】このカードをコストを支払わずに召喚する。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "life_decrease", player: "self" },
        },
        steps: [
          {
            action: {
              costModifier: "free",
              kind: "summon",
              target: { kind: "self" },
            },
          },
        ],
        textRef: [4, 5],
      },
      // Lv3-Lv4『このアルティメットの召喚/アタック時』相手のスピリット/アルティメット1体を重疲労させる。
      // さらに、自分の青の導界者ネクサスがあるとき、相手のデッキを上から4枚除外する。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        steps: [
          {
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
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "opponent", position: "top" },
              to: { zone: "removed_from_game" },
              count: 4,
            },
            connector: "simultaneous",
            condition: [
              {
                kind: "field_has",
                player: "self",
                category: ["nexus"],
                colors: ["blue"],
                tribes: ["導界者"],
              },
            ],
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSTH05.5-R10",
    orikaId: 163,
    orikaIndex: 172,
    name: "気符「無念無想の境地」",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue", "blue", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「緋想」を持つ。",
      "",
      "自分の青の効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられ、トラッシュから手札に加えたとき、ボイドからコア1個を自分の青の導界者ネクサスに置く。",
      "",
      "フラッシュ",
      "このターンの間、効果の記述を持つ相手のスピリット/アルティメットのアタックでは自分のライフは1以下にならない。",
    ],
    keywordTags: [],
    tribe: "幻想・緋想",
    image: "images/BSTH05.5-R10.webp",
    rarity: "R",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」/「緋想」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想", "緋想"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // 自分の青の効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられ、
      // トラッシュから手札に加えたとき、ボイドからコア1個を自分の青の導界者ネクサスに置く。
      // BSTH02-R11 と同型 (revealed/moved_to_trash 統合 card_event + trigger_colors +
      // trigger_from_zone:deck)。core_move ボーナス step は findRevealedEffect が
      // disposition のみ抽出し bonus step を捨てる一方、findMovedToTrashAutoEffect は
      // bonusSteps として抽出する非対称性により、trash 由来時のみ発火する
      // (revealed 由来は disposition のみで自然に無効化される、新規分岐不要)。
      {
        // 「手札に加えられ」可能形=任意 (10_rules/03c ruling C 2026-06-24)。
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_colors", colors: ["blue"] },
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
                  tribes: ["導界者"],
                  colors: ["blue"],
                },
              },
              amount: 1,
            },
          },
        ],
        executionMode: "optional",
        textRef: [2],
      },
      // フラッシュ：このターンの間、効果の記述を持つ相手のスピリット/アルティメットのアタックでは
      // 自分のライフは1以下にならない。
      // = life_damage_interception(floor:2)＋attackerFilter（効果記述を持つ相手スピ/アル）。
      //   「1以下にならない」= ライフ下限 2（floor 一致アタッカー由来のバトルライフ減少を
      //   getUnblockedLifeDamage が残ライフ ≥ 2 になるようクランプ）。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "floor",
              floor: 2,
              attackerFilter: {
                category: ["spirit", "ultimate"],
                hasEffectText: true,
              },
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    summonCondition: [{ kind: "life_value", player: "opponent", min: 2 }],
    cardNo: "BSTH05.5-X01",
    orikaId: 164,
    orikaIndex: 173,
    name: "比那名居 天子",
    printedCategory: "ultimate",
    colors: ["blue"],
    cost: 8,
    reductionSymbols: [
      "blue",
      "blue",
      "blue",
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
        requiredCores: 4,
        bp: 22000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：相手のライフ2以上》",
      "",
      "Lv4-Lv5『このアルティメットのアタック時』",
      "このアルティメットのコスト以下の相手のスピリット/アルティメット1体を破壊する。さらに、自分の青の導界者ネクサスがあるとき、相手のデッキを10枚破棄する。",
      "",
      "Lv5『このアルティメットのアタック時』",
      "系統：「緋想」を持つブレイヴとの合体中、ターンに2回まで、自分の青の導界者ネクサス1つを疲労させることで、このアルティメットは回復する。",
    ],
    keywordTags: [],
    tribe: "幻想・緋想・天人",
    image: "images/BSTH05.5-X01.webp",
    rarity: "X",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv4-Lv5『このアルティメットのアタック時』このアルティメットのコスト以下の相手のスピリット/
      // アルティメット1体を破壊する。さらに、自分の青の導界者ネクサスがあるとき、相手のデッキを10枚破棄する。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 4 }],
        steps: [
          {
            action: {
              kind: "destroy",
              // 「このアルティメットのコスト以下」= 印字コスト 8。合体等によるコスト増加の動的反映は未対応。
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxCostSource: "self_effective_cost",
                },
                count: 1,
              },
            },
          },
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "opponent", position: "top" },
              to: { zone: "trash" },
              count: 10,
              deckDiscard: true,
            },
            connector: "simultaneous",
            condition: [
              {
                kind: "field_has",
                player: "self",
                category: ["nexus"],
                colors: ["blue"],
                tribes: ["導界者"],
              },
            ],
          },
        ],
        textRef: [2, 3],
      },
      // Lv5『このアルティメットのアタック時』系統：「緋想」を持つブレイヴとの合体中、ターンに2回まで、
      // 自分の青の導界者ネクサス1つを疲労させることで、このアルティメットは回復する。
      // コスト = set_exhaust_state(自分の青/導界者ネクサス1つ) を先頭 step、
      // 効果本体 (recover) を connector:"conditional_cost" で結線（BSLH01-C03 precedent と同型、
      // 「自分の別カードを疲労させることをコストにする」汎用パイプライン）。
      // targetsGrandwalker:"only"+grandwalkerKind:"guided"+includesGrandwalkerExhaustOptIn:true で
      // 実際の導界者ネクサスに加え、BSTH05.5-C20 の opt-in カードも対象候補に含める。
      // 「系統：「緋想」を持つブレイヴとの合体中」は combined_guest_tribes（combined_host_category
      // の逆方向、engine-claude explore 追加）でホスト側から合体中ブレイヴの系統を照合する。
      {
        executionMode: "optional",
        timing: { kind: "card_event", event: "attack" },
        condition: [
          { kind: "min_level", value: 5 },
          { kind: "combined_guest_tribes", tribes: ["緋想"] },
        ],
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 2 },
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["nexus"],
                  colors: ["blue"],
                  targetsGrandwalker: "only",
                  grandwalkerKind: "guided",
                  includesGrandwalkerExhaustOptIn: true,
                },
                count: 1,
              },
              state: "exhausted",
            },
          },
          {
            action: { kind: "recover", target: { kind: "self" } },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH05.5-X02",
    orikaId: 165,
    orikaIndex: 174,
    name: "[導界者]永江 衣玖",
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 2,
    reductionSymbols: ["blue", "god"],
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
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス対象の効果しか受けず移動できない。また、導託・導技・導域は、神域・神技・神域としても扱う。",
      "",
      "【導託：〔緋想／竜渡＆コスト3以上〕〔緋想／竜渡＆アルティメット〕】",
      "◆対象の自分のスピリット/アルティメットを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、青/究極としても扱う。",
      "",
      "【導技：3】Lv1-Lv2 フラッシュ『お互いのアタックステップ』",
      "〔このネクサスのコア3個をボイドに置く〕最もコストの低い相手のスピリット/アルティメット1体を破壊する。または、相手のネクサス1つを破壊する。",
      "",
      "Lv2【導域】『自分のアタックステップ』",
      "相手への「デッキ破棄効果」すべてを「デッキ除外効果」にする。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    // 本体ルール [0]（導界者/創界神対象の効果しか受けない・導託/導界者対象効果でしかコア配置不可・
    // 導託/導技/導域=神託/神技/神域読み替え）と【導託】[2,3,4]（対象召喚/煌臨時コア+1、
    // 配置時デッキ上3枚トラッシュ→対象カード1枚につきコア+1=標準 placementOracle）は
    // grandwalkerData 基盤 + enter_field_core_placement_forbidden で表現（stub effect から移行）。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        // bullet1「対象の自分のスピリット/アルティメット」はネクサスを含まない
        // （アルティメットは下の条件で別掲）ため categories は spirit のみに限定する。
        {
          tribes: ["緋想", "竜渡"],
          minCost: 3,
          categories: ["spirit"],
        },
        { tribes: ["緋想", "竜渡"], categories: ["ultimate"] },
      ],
      // 【導技：3】Lv1-Lv2 フラッシュ『お互いのアタックステップ』〔コア3個ボイド〕
      // 「最もコストの低い相手のスピリット/アルティメット1体を破壊」または
      // 「相手のネクサス1つを破壊」。導技=神技扱いのため divineSkills 経路（BSTH03 と同型）。
      // 極値選択は CardFilter.extremal（BSDB01-C04 precedent）、二択は choice ステップ
      // （BSLH01-R03 precedent）。coreCost/timing/level 判定はエンジンが検査する。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 3,
          timing: { step: "attack", whose: "both", mode: "flash" },
          minLevel: 1,
          maxLevel: 2,
          effects: [
            {
              textRef: [8, 9],
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "destroy",
                    target: {
                      kind: "filter",
                      player: "opponent",
                      filter: {
                        category: ["spirit", "ultimate"],
                        extremal: { metric: "cost", mode: "lowest" },
                      },
                      count: 1,
                    },
                  },
                  choice: [
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
                },
              ],
            },
          ],
        },
      ],
    },
    tribe: "導界者・竜渡",
    image: "images/BSTH05.5-X02.webp",
    rarity: "X",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2 このネクサスのシンボルは、青/究極としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "blue" },
          },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "ultimate_symbol",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【導技：3】は grandwalkerData.divineSkills で表現（上記参照。textLines[8]
      // ヘッダ行は DIVINE_SKILL_HEADER が auto-cover。textLines[9] 本文行は
      // LINE_MARKER 対象外のため uncovered_line 化しない、BSTH03 と同型）。
      // Lv2【導域】『自分のアタックステップ』相手への「デッキ破棄効果」すべてを「デッキ除外効果」にする。
      // = redirect_deck_discard_to_exclude CE（ENGINE-deck-discard-to-exclude-redirect）。
      // 「自分のアタックステップ」限定は effect.timingScope に委譲し (isCEActiveForScope が
      // 自動判定)、消費側 (move_card / discard primitive) が真のデッキ破棄の移動先を
      // removed_from_game へ差し替える (prevent_deck_discard と同型の block ではなく redirect)。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "redirect_deck_discard_to_exclude",
              player: "opponent",
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
  {
    cardNo: "BSTH05.5-XX01",
    orikaId: 166,
    orikaIndex: 175,
    name: "龍神",
    printedCategory: "nexus",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 4,
    reductionSymbols: ["guide", "guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
      {
        level: 2,
        requiredCores: 8,
        bp: 0,
      },
    ],
    symbolColors: ["god"],
    textLines: [
      "このネクサスは創界神ネクサス/導界者ネクサス対象の効果しか受けない。このネクサスには神託と創界神ネクサス/導界者ネクサス対象の効果でしかコアを置けず、そのコアは創界神ネクサス/導界者ネクサス対象の効果しか受けず移動できない。また、神託・神技・神域は、導託・導技・導域としても扱う。",
      "",
      "【神託：〔竜渡／博麗／賢者／幻想＆アルティメット〕〔導界者ネクサス〕】",
      "◆対象の自分のアルティメット/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中のカード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、赤/紫/緑/白/黄/青/究極/導としても扱う。",
      "",
      "【神技：2】Lv1-Lv2『自分のメインステップ』",
      "〔ターンに2回、このネクサスのコア2個をボイドに置く〕自分は、デッキの上から2枚を見る。その中のカード1枚までを手札に加え、残りを好きなようにデッキの上か下に戻す。",
      "",
      "【神域】Lv2『自分のエンドステップ』",
      "このネクサスのコアすべてをボイドに置ける。そうしたとき、自分は、次の『自分のエンドステップ』までゲームに敗北しない。",
    ],
    keywordTags: [
      "grandwalker",
      "guided_nexus",
      "enter_field_core_placement_forbidden",
    ],
    // 本体ルール [0]（創界神/導界者対象の効果しか受けない・神託/創界神/導界者対象効果でしか
    // コア配置不可・神託/神技/神域=導託/導技/導域読み替え）と【神託】[2,3]（対象召喚/煌臨/配置時
    // コア+1）は grandwalkerData 基盤 + enter_field_core_placement_forbidden で表現
    // （stub effect から移行）。tribe「創界神・導界者」の両タイプは kind + alsoCountsAs。
    // 配置時神託 [4] は「その中の“カード”1枚につき」＝対象カード限定でない独自亜種で、
    // 標準 placementOracle（対象カードのみ計数）では表現できないため placementOracle: false で
    // 標準動作を抑止し、effects の card_event:place 効果（DSL）で正確に実装する。
    grandwalkerData: {
      kind: "grandwalker",
      alsoCountsAs: "guided",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        { tribes: ["竜渡", "博麗", "賢者", "幻想"], categories: ["ultimate"] },
        { categories: ["nexus"], hasMechanic: ["guided"] },
      ],
      placementOracle: false,
      // 【神技：2】Lv1-Lv2『自分のメインステップ』〔ターンに2回、コア2個をボイドに置く〕。
      // コスト・ターン回数(2)は divineSkills 経路でエンジン検査。
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 2,
          timing: "main",
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          maxUsesPerTurn: 2,
          // デッキの上から2枚を見て1枚までを手札に加え、残りをデッキの上か下に戻す。
          // 注: 残りの1枚ごとの上下振り分けは未表現（top_or_bottom は一括）。
          effects: [
            {
              textRef: [8, 9],
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    revealTo: "self",
                    kind: "deck_reveal",
                    revealCount: 2,
                    picks: [{ count: 1 }],
                    remainder: "top_bottom_split",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    tribe: "創界神・導界者・幻想",
    image: "images/BSTH05.5-XX01.webp",
    rarity: "XX",
    pack: "BSTH05.5 東方緋想天",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [4] 配置時神託（独自亜種）: 同じカード名の自分の創界神ネクサスがなければ、
      // デッキの上から3枚をトラッシュに置ける（任意）。その中の「カード1枚につき」
      // （対象カード限定なし＝置いた枚数分）ボイドからコア1個をこのネクサスに置く。
      // P3-134分類: この field_lacks(cardName:"self") は「同じカード名の自分の創界神ネクサス
      // がなければ」という存在条件(重複配置チェック)のため、grandwalkerKind:"grandwalker"
      // narrowing は現状維持が正当(10_rules/07:56)。このカード自身は grandwalkerData:
      // {kind:"grandwalker",alsoCountsAs:"guided"}の両属性持ちだが、原文は「創界神ネクサス」
      // とだけ書いており導界者側の重複は数えない。
      {
        timing: { kind: "card_event", event: "place" },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            category: ["nexus"],
            cardName: "self",
            excludeSelf: true,
            grandwalkerKind: "grandwalker",
          },
        ],
        executionMode: "optional",
        steps: [
          {
            id: "ryujinPlacementTrash",
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "self", position: "top" },
              to: { zone: "trash", player: "self" },
              count: 3,
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: {
                source: {
                  kind: "cards_from_ref",
                  stepId: "ryujinPlacementTrash",
                },
              },
            },
            connector: "sequential",
          },
        ],
        textRef: [4],
      },
      // Lv1-Lv2 このネクサスのシンボルは、赤/紫/緑/白/黄/青/究極/導としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          { action: { kind: "treat_as", aspects: ["symbol"], asColor: "red" } },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "green" },
            connector: "simultaneous",
          },
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "white" },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "blue" },
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
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "guide" },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【神技：2】(main, ターンに2回) は grandwalkerData.divineSkills で表現（上記参照）。
      // 【神域】Lv2『自分のエンドステップ』このネクサスのコアすべてをボイドに置ける。
      // そうしたとき、自分は、次の『自分のエンドステップ』までゲームに敗北しない。
      // 「ゲームに敗北しない」= immune_to_game_loss CE (grant_game_loss_immunity, 新設)。
      // ライフ0/デッキ0敗北判定 (applyLifeZeroDefeat / turn-system.ts デッキ0チェック x2) が
      // isPlayerImmuneToGameLoss 経由で参照する。持続「次の『自分のエンドステップ』まで」は
      // duration.scope="step"+next:true（scope="turn" の next と同型の意味論を拡張、初出）。
      {
        timing: { kind: "phase", step: "end", whose: "self" },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "this_card" },
              to: { kind: "void", player: "self" },
              amount: "all",
            },
          },
          {
            connector: "conditional_result",
            action: {
              kind: "grant_game_loss_immunity",
              player: "self",
              duration: {
                scope: "step",
                step: "end",
                whose: "self",
                next: true,
              },
            },
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
];
