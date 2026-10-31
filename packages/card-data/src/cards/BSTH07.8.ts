import type { CardDefinition } from "@orica/rules-core";

export const BSTH07_8_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH07.8-C01",
    orikaId: 192,
    orikaIndex: 201,
    name: "妖精",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 2,
    reductionSymbols: ["guide", "guide"],
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
    ],
    symbolColors: ["green"],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "",
      "Lv1-Lv2『自分のメインステップ』",
      "自分の導界者ネクサスがないとき、このスピリットを疲労させることで、自分のデッキを上から3枚オープンする。その中の系統：「妖精」を持つ導界者ネクサスカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。この効果は、ターンに1回しか使えない。",
    ],
    keywordTags: [],
    tribe: "幻想・妖精",
    image: "images/BSTH07.8-C01.webp",
    rarity: "C",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『自分のメインステップ』導界者ネクサスがないとき、疲労させることで、デッキ上3枚オープン、
      // 妖精の導界者ネクサス1枚を手札に。残りはデッキの下へ。ターンに1回。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        condition: [
          { kind: "field_lacks", player: "self", grandwalkerKind: "guided" },
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
          {
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    tribes: ["妖精"],
                    targetsGrandwalker: true,
                    grandwalkerKind: "guided",
                  },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH07.8-C02",
    orikaId: 193,
    orikaIndex: 202,
    name: "メイド妖精",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["guide", "guide"],
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
    symbolColors: ["red"],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "",
      "Lv1-Lv2『自分のメインステップ』",
      "自分の導界者ネクサスがないとき、このスピリットを疲労させることで、自分のデッキを上から3枚オープンする。その中の系統：「妖精」を持つ導界者ネクサスカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。この効果は、ターンに1回しか使えない。",
    ],
    keywordTags: [],
    tribe: "幻想・妖精",
    image: "images/BSTH07.8-C02.webp",
    rarity: "C",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『自分のメインステップ』導界者ネクサスがないとき、疲労させることで、デッキ上3枚オープン、
      // 妖精の導界者ネクサス1枚を手札に。残りはデッキの下へ。ターンに1回。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        condition: [
          { kind: "field_lacks", player: "self", grandwalkerKind: "guided" },
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
          {
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    tribes: ["妖精"],
                    targetsGrandwalker: true,
                    grandwalkerKind: "guided",
                  },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH07.8-C03",
    orikaId: 194,
    orikaIndex: 203,
    name: "[妖精大戦争]リリーホワイト",
    printedCategory: "spirit",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 2,
    reductionSymbols: ["guide"],
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
    symbolColors: ["guide"],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の系統：「妖精」を持つ導界者ネクサスカード1枚と系統：「妖精」を持つコスト3以上のカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。この効果は、ターンに1回しか使えない。",
      "",
      "Lv2",
      "相手はネクサスを配置するとき、軽減できない。",
    ],
    keywordTags: [],
    tribe: "幻想・妖精",
    image: "images/BSTH07.8-C03.webp",
    rarity: "C",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『このスピリットの召喚時』デッキ上3枚オープン、妖精の導界者ネクサス1枚と妖精コスト3以上1枚を手札に。ターン1回。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
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
                    tribes: ["妖精"],
                    targetsGrandwalker: true,
                    grandwalkerKind: "guided",
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: { tribes: ["妖精"], minCost: 3 },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv2 相手はネクサスを配置するとき、軽減できない。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "prevent_cost_reduction",
              player: "opponent",
              filter: {},
              restrictedKinds: ["place_nexus"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH07.8-C04",
    orikaId: 195,
    orikaIndex: 204,
    name: "ひまわり妖精",
    printedCategory: "spirit",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 2,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 3000,
      },
    ],
    symbolColors: ["guide"],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の系統：「妖精」を持つ導界者ネクサスカード1枚と系統：「妖精」を持つコスト3以上のカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。この効果は、ターンに1回しか使えない。",
      "",
      "Lv1-Lv2",
      "このスピリットは、相手のネクサスの効果を受けない。",
    ],
    keywordTags: [],
    tribe: "幻想・妖精",
    image: "images/BSTH07.8-C04.webp",
    rarity: "C",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『このスピリットの召喚時』デッキ上3枚オープン、妖精の導界者ネクサス1枚と妖精コスト3以上1枚を手札に。ターン1回。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
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
                    tribes: ["妖精"],
                    targetsGrandwalker: true,
                    grandwalkerKind: "guided",
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: { tribes: ["妖精"], minCost: 3 },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv1-Lv2 このスピリットは、相手のネクサスの効果を受けない。
      // sourceScope.categories=["nexus"] で発生源が相手のネクサスのときのみ免疫成立
      // (immunitySourceScope, 10_rules/03c §発生源帰属)。発生源は実効カテゴリ照合。
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
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH07.8-C05",
    orikaId: 196,
    orikaIndex: 205,
    name: "霧の湖",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "自分の系統：「妖精」を持つ効果でデッキからオープンされたか、トラッシュに置かれたこのカードは、手札に加えられる。",
      "",
      "Lv1『このネクサスの配置時』",
      "自分のデッキを上から4枚オープンできる。その中の系統：「妖精」を持つ導界者ネクサスカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1 フラッシュ",
      "系統：「妖精」を持つ自分の導界者ネクサスがLv2のとき、自分のライフのコア1個をボイドに置くことで、手札/トラッシュの系統：「妖精」を持つカード1枚を召喚できる。",
    ],
    keywordTags: [],
    image: "images/BSTH07.8-C05.webp",
    rarity: "C",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // 自分の妖精効果でオープン/トラッシュ行きのこのカードは手札に加えられる。
      //   BSFT01-C02 add 型（07b §6 裁定 2026-06-11）の trigger_tribes 版。
      //   trigger_from_zone は ["deck"]（trash 経路の fromZone も "deck"）。ネクサスでも回収先は手札。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          { kind: "trigger_tribes", tribes: ["妖精"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        executionMode: "optional",
        textRef: [1],
      },
      // Lv1『このネクサスの配置時』デッキ上4枚オープン、妖精の導界者ネクサス1枚を手札に。残りはデッキの下へ。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    tribes: ["妖精"],
                    targetsGrandwalker: true,
                    grandwalkerKind: "guided",
                  },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1 フラッシュ：妖精の導界者ネクサスがLv2のとき、ライフコア1個ボイドで手札/トラッシュの妖精カードを召喚。
      // condition: field_has(minLevel/maxLevel:2, grandwalkerKind:"guided", tribes:"妖精")
      // (本cluster新設、BSTH01-C21 Lv2 min_level は self 限定のため他カード参照には流用不可)。
      // コスト(自分ライフのコア1個→ボイド)→conditional_cost で summon(from_zone:[hand,trash])
      // へ連結。BSTH01-C12[5,6] life→trash conditional_cost precedent と同型。
      {
        timing: { kind: "activated", mode: "flash" },
        executionMode: "optional",
        condition: [
          {
            kind: "field_has",
            player: "self",
            tribes: ["妖精"],
            grandwalkerKind: "guided",
            minLevel: 2,
            maxLevel: 2,
          },
        ],
        steps: [
          {
            // コスト: 自分のライフのコア1個をボイドに置く
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "void", player: "self" },
              amount: 1,
            },
          },
          {
            // 結果: 手札/トラッシュの系統「妖精」を持つカード1枚を召喚
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "trash"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  tribes: ["妖精"],
                },
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
    cardNo: "BSTH07.8-M01",
    orikaId: 197,
    orikaIndex: 206,
    name: "[妖精大戦争]大妖精",
    printedCategory: "spirit",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 4,
    reductionSymbols: ["guide"],
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
    symbolColors: ["guide"],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "",
      "Lv1-Lv2『自分のメインステップ』",
      "このスピリットを疲労させることで、ボイドからコア2個をこのスピリットに置き、自分のデッキを上から7枚オープンする。その中の系統：「妖精」を持つ導界者ネクサスカード1枚とカード名：「チルノ」1枚を手札に加える。残ったカードは破棄する。この効果はゲーム中に1回しか使えない。",
      "",
      "Lv2",
      "系統：「妖精」を持つ自分のスピリットは、相手の効果で破壊/消滅したとき、手札に戻る。",
    ],
    keywordTags: [],
    tribe: "幻想・妖精",
    image: "images/BSTH07.8-M01.webp",
    rarity: "M",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『自分のメインステップ』疲労させ、コア2個を置き、デッキ7枚オープン、妖精導界者ネクサス1+チルノ1を手札、残り破棄。ゲーム1回。
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
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: 2,
            },
            connector: "conditional_cost",
          },
          {
            action: {
              kind: "deck_reveal",
              revealCount: 7,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    tribes: ["妖精"],
                    targetsGrandwalker: true,
                    grandwalkerKind: "guided",
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: { cardName: { exact: "チルノ" } },
                  mandatory: true,
                },
              ],
              remainder: "trash",
            },
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      // Lv2 妖精スピリットは、相手の効果で破壊/消滅したとき、手札に戻る。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          // 破壊/消滅を別 step に分ける (継続効果 rebuild の provenance ベース dedup が
          // 同一 step 内の resistsOutcome 配列 + replacement を 1 件に潰してしまうため)。
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], tribes: ["妖精"] },
                count: "all",
              },
              resistsOutcome: "destroy",
              source: "opponent_effect",
              duration: { scope: "while_on_field" },
              replacement: { kind: "move_to", zone: "hand" },
            },
          },
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], tribes: ["妖精"] },
                count: "all",
              },
              resistsOutcome: "vanish",
              source: "opponent_effect",
              duration: { scope: "while_on_field" },
              replacement: { kind: "move_to", zone: "hand" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH07.8-R01",
    orikaId: 198,
    orikaIndex: 207,
    name: "サニーミルク",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["guide", "guide", "guide"],
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
    symbolColors: ["red"],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "トラッシュの《ソウルコア》以外のコア1個をこのスピリットに置く。",
    ],
    keywordTags: [],
    tribe: "幻想・妖精",
    image: "images/BSTH07.8-R01.webp",
    rarity: "R",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // Lv2-Lv3『このスピリットのアタック時』トラッシュの《ソウルコア》以外のコア1個をこのスピリットに置く。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
              effectKind: "normal_only",
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH07.8-R02",
    orikaId: 199,
    orikaIndex: 208,
    name: "ルナチャイルド",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["guide", "guide", "guide"],
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
    symbolColors: ["yellow"],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "自分のライフが3以下のとき、ボイドからコア1個を自分のライフに置く。",
    ],
    keywordTags: [],
    tribe: "幻想・妖精",
    image: "images/BSTH07.8-R02.webp",
    rarity: "R",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // Lv2-Lv3『このスピリットのアタック時』自分のライフが3以下のとき、ボイドからコア1個を自分のライフに置く。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "life_value", player: "self", max: 3 },
        ],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 1,
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH07.8-R03",
    orikaId: 200,
    orikaIndex: 209,
    name: "スターサファイア",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["guide", "guide", "guide"],
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
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "相手のリザーブのコア1個をトラッシュに置く。",
    ],
    keywordTags: [],
    tribe: "幻想・妖精",
    image: "images/BSTH07.8-R03.webp",
    rarity: "R",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // Lv2-Lv3『このスピリットのアタック時』相手のリザーブのコア1個をトラッシュに置く。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "opponent" },
              to: { kind: "trash", player: "opponent" },
              amount: 1,
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH07.8-R04",
    orikaId: 201,
    orikaIndex: 210,
    name: "凍符「パーフェクトフリーズ」",
    printedCategory: "magic",
    colors: ["white"],
    cost: 5,
    reductionSymbols: ["guide", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "",
      "自分の「霧の湖」/系統：「妖精」を持つ効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられる。",
      "",
      "アタック/ブロックしている系統：「妖精」を持つ自分のスピリット1体につき、このカードのコストを-1する。",
      "",
      "フラッシュ",
      "相手のスピリット/アルティメット2体を指定する。このターンの間、そのスピリット/アルティメットは、アタック/ブロックできない。",
    ],
    keywordTags: [],
    image: "images/BSTH07.8-R04.webp",
    rarity: "R",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // 「霧の湖」/妖精効果でオープン/トラッシュ行きのこのカードは手札に加えられる。
      // 「加えられる」可能形=任意。card_event 系 default 非対称回避のため per-effect 明示
      // (10_rules/03c ruling C 2026-06-24)。名前「霧の湖」/系統:妖精は trigger_source_match の OR。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          {
            kind: "trigger_source_match",
            cardNames: [{ contains: "霧の湖" }],
            tribes: ["妖精"],
          },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        executionMode: "optional",
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        textRef: [2],
      },
      // アタック/ブロックしている妖精スピリット1体につき、このカードのコストを-1する。
      {
        applicability: { zone: ["hand"] },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: {
                additionalCostValue: {
                  source: {
                    kind: "cards_in_zone",
                    zone: "field",
                    player: "self",
                    filter: {
                      category: ["spirit"],
                      tribes: ["妖精"],
                      battleState: "in_battle",
                    },
                  },
                  multiplier: -1,
                },
              },
            },
          },
        ],
        textRef: [4],
      },
      // フラッシュ：相手のスピリット/アルティメット2体を指定。このターン、アタック/ブロックできない。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 2,
              },
              restriction: ["attack", "block"],
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH07.8-X01",
    orikaId: 202,
    orikaIndex: 211,
    name: "チルノ",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 5,
    reductionSymbols: ["guide", "guide"],
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
        requiredCores: 3,
        bp: 10000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "アタック/ブロックしている系統：「妖精」を持つ自分のスピリット/アルティメット1体につき、このカードのコストを-1する。",
      "",
      "【界放：3】フラッシュ『お互いのアタックステップ』",
      "手札にあるこのカードは、自分の導界者ネクサスのコア3個をこのスピリットに置くことで、召喚コストを支払って召喚できる。",
      "",
      "Lv2-Lv3『自分のアタックステップ』",
      "このスピリットは、相手のネクサス/マジックの効果を受けない。",
    ],
    keywordTags: [],
    tribe: "幻想・妖精",
    image: "images/BSTH07.8-X01.webp",
    rarity: "X",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0],
      },
      // アタック/ブロック中の妖精スピリット/アルティメット1体につき、このカードのコストを-1する。
      {
        applicability: { zone: ["hand"] },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: {
                additionalCostValue: {
                  source: {
                    kind: "cards_in_zone",
                    zone: "field",
                    player: "self",
                    filter: {
                      category: ["spirit", "ultimate"],
                      tribes: ["妖精"],
                      battleState: "in_battle",
                    },
                  },
                  multiplier: -1,
                },
              },
            },
          },
        ],
        textRef: [1],
      },
      // 【界放：3】フラッシュ『お互いのアタックステップ』手札にあるこのカードは、自分の導界者
      //   ネクサスのコア3個をこのスピリットに置くことで、召喚コストを支払って召喚できる。
      //   BSAZ02-C07/C05 precedent と同型 (applicability.zone:"hand" + timingScope:{player:"both",
      //   period:"attack"} + executionMode:"optional" + summon target:self)。
      //   界放:3 cost は BSTH02-X02 effects[1] precedent (core_move from:field_card 導界者ネクサス
      //   → to:this_card amount:3) をそのまま流用、色フィルタは印字に色指定が無いため未指定。
      //   engine-summon-target-self-paid-cost: cost step (無connector=既定sequential) →
      //   benefit=summon(connector:conditional_cost) で「Xすることで Y」を表現。手札のこのカードへ
      //   コアを直接置く点が X02 と異なる (X02は既にフィールド上の自分自身、こちらは召喚前の
      //   手札カード自身) が、`core_move to:this_card` の書き込み経路は宛先カードのゾーンを
      //   問わないため同じ DSL で成立する。召喚時は `summon.target.zone:"hand"`
      //   (通常コスト支払いトリガー) + `carryOverExistingCores:true`
      //   (界放で乗せた3コアをフィールド進入時の維持コアへ持ち越す、
      //   Lv1 requiredCores=1 は既に満たされるため追加のリザーブ配置は発生しない) を指定する。
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { zone: "hand" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["導界者"],
                  targetsGrandwalker: true,
                },
              },
              to: { kind: "this_card" },
              amount: 3,
            },
          },
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
                zone: "hand",
                carryOverExistingCores: true,
              },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3『自分のアタックステップ』このスピリットは、相手のネクサス/マジックの効果を受けない。
      // sourceScope.categories=["nexus","magic"] で発生源カテゴリ限定（10_rules/03c §発生源帰属、
      // immunitySourceScope 実装）。スピリット/ブレイヴ/バースト発生源は通常どおり通る。
      // 「自分のアタックステップ」限定は timingScope:{player:self,period:"attack"} で表現
      // （isCEActiveForScope が消費時に判定）。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { categories: ["nexus", "magic"] },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH07.8-X02",
    orikaId: 203,
    orikaIndex: 212,
    name: "[妖精大戦争]霧雨 魔理沙",
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
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 9000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 12000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "デッキからオープンされたこのカードは、系統：「妖精」を持つ。",
      "",
      "【バースト：相手によって自分のスピリットがフィールドを離れた後】",
      "このターンの間、相手のスピリット1体をBP-5000する。この効果を3回発揮し、BPが0になったスピリットは破壊する。その後、このカードをコストを支払わずに召喚できる。",
      "",
      "Lv3『このスピリットのアタック時』",
      "相手のライフのコア1個をリザーブに置く。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・導魔",
    image: "images/BSTH07.8-X02.webp",
    rarity: "X",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // デッキからオープンされたこのカードは、系統：「妖精」を持つ。
      // override_properties.addTribes + applicability.zone:"revealed" +
      // duration.scope:"while_revealed" (ENGINE-revealed-zone-continuous-effect-applicability
      // で新設した zone 束縛 duration。while_set/while_in_trash と対称) で
      // 「デッキオープン中のみ系統を得る」を表現する。
      {
        timing: { kind: "continuous" },
        applicability: { zone: "revealed" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["妖精"] },
              duration: { scope: "while_revealed" },
            },
          },
        ],
        textRef: [0],
      },
      // 【バースト：相手によって自分のスピリットが離れた後】相手スピリット1体BP-5000（3回）。BP0で破壊。その後任意召喚。
      {
        timing: {
          kind: "burst",
          trigger: "相手によって自分のスピリットがフィールドを離れた後",
          triggerFilter: { category: ["spirit"] },
          cause: ["opponent_effect", "battle"],
        },
        steps: [
          {
            id: "bp0",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              amount: -5000,
              duration: { scope: "turn" },
            },
            repeat: { additional: 2 },
          },
          {
            action: {
              kind: "destroy",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
            },
            connector: "sequential",
          },
          {
            targetSelectionTiming: "on_step",
            action: { kind: "noop" },
            choice: [
              {
                action: {
                  kind: "summon",
                  target: { kind: "self" },
                  costModifier: "free",
                },
              },
            ],
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      // Lv3『このスピリットのアタック時』相手のライフのコア1個をリザーブに置く。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 3 }],
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
    cardNo: "BSTH07.8-XX01",
    orikaId: 204,
    orikaIndex: 213,
    name: "[導界者]リリーブラック",
    printedCategory: "nexus",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 2,
    reductionSymbols: ["guide"],
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
    symbolColors: ["guide"],
    textLines: [
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・導域は、神託・神域としても扱う。",
      "",
      "【導託：〔妖精〕〔妖精＆アルティメット〕】",
      "◆対象の自分のスピリット/アルティメットを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "",
      "【導域】Lv1-Lv2『自分のアタックステップ』",
      "自分は、系統：「妖精」を持つスピリット5体まで同時にアタックでき、バトルは同時に解決する。召喚した系統：「妖精」を持つ自分のスピリットは、相手のブロック宣言前なら、ただちにアタックできる。また、相手はマジックカードを1コストで使用できる。ターンの最初のバトル終了時、自分のアタックステップは終了する。",
      "",
      "【導域】Lv2『自分のターン』",
      "自分が系統：「妖精」を持つスピリットを手札から召喚したとき、自分は、デッキの上から1枚ドローする。この効果は重複しない。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    tribe: "導界者・幻想・妖精",
    image: "images/BSTH07.8-XX01.webp",
    rarity: "XX",
    pack: "BSTH07.8 妖精大戦争",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 導界者ネクサス本体ルール (textLines[0]) ＋【導託】(textLines[2-4]) は grandwalkerData 基盤で表現。
    // 〔妖精〕= 妖精スピリット、〔妖精＆アルティメット〕= 妖精アルティメット
    // （◆行がスピリット/アルティメット限定、BSTH003-X01 と同じ読み）。
    // 配置時導託の本文は同名不在条件を持たないため、同名が場にいても発揮できる。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent"],
      placementOracle: { sameNameGate: false },
      oracleConditions: [
        { tribes: ["妖精"], categories: ["spirit"] },
        { tribes: ["妖精"], categories: ["ultimate"] },
      ],
    },
    effects: [
      // このカードの軽減シンボルは、赤/紫/緑/白/黄/青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "purple",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "green",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "white",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "blue",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【導域】Lv1-Lv2『自分のアタックステップ』妖精スピリット5体まで同時アタック等。
      // (1) 同時アタック許可: allow_simultaneous_attack CE (P2-05 Phase 1)。
      // ブロック数は同時アタック数まで＝blockerCapacity "participant_count"
      // (独自裁定 qa-022、Phase 2 で容量ゲート配線済)。バトル同時解決は
      // battleResolutionGroup の group 解決 (既存) が担う。
      // (3) 相手マジック1コスト: cost_modify {override:1} → cost_override CE。
      // 消費は use_magic costMode "override" (P2-05 Phase 4a)。任意 (「できる」) なので
      // 通常コスト版 use_magic も並行して legal に残る。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "allow_simultaneous_attack",
              player: "self",
              filter: { tribes: ["妖精"], category: ["spirit"] },
              maxCount: 5,
              blockerCapacity: "participant_count",
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "cost_modify",
              player: "opponent",
              cardFilter: { category: ["magic"] },
              modifier: { override: 1 },
              duration: { scope: "while_on_field" },
            },
            connector: "simultaneous",
          },
          // (4) ターンの最初のバトル終了時、自分のアタックステップは終了する
          // (P2-05 Phase 4b)。1体アタックのバトルでも発動する (5体同時アタックの代償制限)。
          {
            action: {
              kind: "force_attack_step_end_after_first_battle",
              player: "self",
              duration: { scope: "while_on_field" },
            },
            connector: "simultaneous",
          },
          // (2) 召喚した系統:妖精を持つ自分のスピリットは、相手のブロック宣言前なら
          // ただちにアタックできる (P2-05 Phase 5)。allow_mid_battle_join CE +
          // join_active_attack legal action (joinActiveAttackAsAction のプレイヤー action 化)。
          {
            action: {
              kind: "allow_mid_battle_join",
              player: "self",
              filter: { tribes: ["妖精"], category: ["spirit"] },
              duration: { scope: "while_on_field" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [8, 9],
      },
      // 【導域】Lv2『自分のターン』妖精スピリットを手札召喚時、1ドロー。重複しない。
      // game_event:summon + triggerFilter(妖精/spirit) で自分の妖精スピリット召喚を観測。
      // 「手札から」は condition trigger_from_zone (場入り前ゾーン) で判別する
      // (triggerContext.fromZone 注入済み)。〔重複しない〕= usageLimit no_duplicate。
      // 【導域】Lv2 ゲートは condition min_level 2。『自分のターン』は player:"self" の
      // 召喚＝自ターン中に限られるため別ゲート不要。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "summon",
          triggerFilter: { tribes: ["妖精"], category: ["spirit"] },
        },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "trigger_from_zone", zones: ["hand"] },
          { kind: "turn_player", player: "self" },
        ],
        executionMode: "mandatory",
        usageLimit: { kind: "no_duplicate" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
        textRef: [11, 12],
      },
    ],
  },
];
