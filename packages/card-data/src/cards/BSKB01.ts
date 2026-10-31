import type { CardDefinition } from "@orica/rules-core";

export const BSKB01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSKB01-C01",
    orikaId: 553,
    orikaIndex: 551,
    name: "[メタナイトの逆襲]メタナイト",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "purple"],
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
    printedOverCount: { minCount: 3, bpBonus: 5000 },
    overCount: { minCount: 3, bpBonus: 5000 },
    symbolColors: ["purple"],
    textLines: [
      "フラッシュ【契約煌臨：「メタナイト」＆C1以上『自分のターン』】",
      "自分の≪ソウルコア≫をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/アタック時』",
      "自分のカウント+1する。さらに、ターンに1回、自分は、デッキを上から2枚破棄し、デッキの上から2枚ドローできる。その後、自分のカウント5につき、自分のトラッシュにある系統:「鋼騎士」を持つスピリットカード1枚までをデッキの下に戻せる。",
      "",
      "Lv1-Lv2『このスピリットのアタック時』",
      "相手のスピリット/アルティメット1体のコア2個をリザーブに置ける。この効果発揮後、このスピリットは、相手のスピリット/アルティメット1体に指定してアタックできる。",
    ],
    keywordTags: [],
    tribe: "鋼騎士・剣使",
    image: "images/BSKB01-C01.webp",
    rarity: "C",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    // フラッシュ【契約煌臨：「メタナイト」＆C1以上『自分のターン』】
    // 契約煌臨宣言は declare_advent エンジン経路で処理される (advent-system / legal-actions)。
    // 『自分のターン』は自分ターンのメイン/フラッシュ窓で使用可 → own_turn で表現。
    // 煌臨条件「メタナイト」(カード名部分一致) は AdventCondition.cardNames で表現
    //   （engine-drain 型 SSOT 適用）。
    // 「C1以上」は煌臨先コストではなく自分のカウント閾値のため declareCondition で表現。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "メタナイト" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 1 }],
    },
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『煌臨/アタック時』カウント+1。
      //   さらに、ターンに1回、デッキ上2枚破棄→2枚ドロー。
      //   その後、カウント5につき1枚までトラッシュの鋼騎士スピリットをデッキ下へ戻せる。
      //   「その後」は前段を実行しなくても後段へ進むため、返却 step は
      //   mill/draw の ref_executed ではなく、ターン1回グループの entry に縛る。
      //   ただし、デッキ破棄で発生した moved_to_trash は「その後」返却後まで
      //   割り込ませないため、discard では遅延し最後に明示処理する。
      //   「Nにつき」= DynamicCount count_value/divisor、「1枚まで」= {min:0,max:N} の
      //   search_zone 選択 (0 枚可) で表現する。
      {
        timing: { kind: "card_event", event: ["advent", "attack"] },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
          {
            id: "mill-draw-return-once",
            action: { kind: "noop" },
            executionMode: "optional",
            usageLimit: { kind: "per_instance", duration: "turn" },
            connector: "sequential",
          },
          {
            id: "mill-draw-choice",
            action: { kind: "noop" },
            executionMode: "optional",
            connector: "sequential",
            stepCondition: {
              kind: "ref_executed",
              stepId: "mill-draw-return-once",
            },
          },
          {
            id: "mill-deck",
            action: {
              kind: "discard",
              player: "self",
              fromZone: "deck",
              count: 2,
              deferMovedToTrashEffects: true,
            },
            connector: "sequential",
            stepCondition: {
              kind: "ref_executed",
              stepId: "mill-draw-choice",
            },
          },
          {
            action: { kind: "draw", count: 2 },
            connector: "sequential",
            stepCondition: {
              kind: "ref_executed",
              stepId: "mill-draw-choice",
            },
          },
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: { category: ["spirit"], tribes: ["鋼騎士"] },
              count: {
                min: 0,
                max: {
                  source: { kind: "count_value", player: "self" },
                  divisor: 5,
                },
              },
              destination: "deck",
              destinationPosition: "bottom",
            },
            connector: "sequential",
            stepCondition: {
              kind: "ref_executed",
              stepId: "mill-draw-return-once",
            },
          },
          {
            action: {
              kind: "process_moved_to_trash",
              source: { stepId: "mill-deck" },
              fromZone: "deck",
            },
            connector: "sequential",
            stepCondition: {
              kind: "ref_executed",
              stepId: "mill-deck",
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2『アタック時』相手のスピリット/アルティメット1体のコア2個をリザーブへ→
      // この効果発揮後、指定アタック可。単一対象コアシュート: target で1体選択→
      // from:target_card（memory project_single_target_coreshoot、BSTH03.ts:1701-1713
      // 同型 amount:2）。「この効果発揮後」= conditional_result（前ステップ成功時のみ後続
      // 指定アタックは現在の攻撃先を設定する。追加アタック権は付与しない。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "mandatory",
        steps: [
          {
            executionMode: "optional",
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
            action: {
              kind: "designate_attack",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
            connector: "after_triggers",
            executionMode: "optional",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSKB01-C02",
    orikaId: 554,
    orikaIndex: 552,
    name: "水兵ワドルディ",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 3000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "手札にあるこのカードは、自分のメインステップ終了時に魂状態を含む自分の「メタナイト」がいれば、破棄できる。そうしたとき、お互い、デッキの上から1枚破棄できる。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の「宝剣ギャラクシア」/「戦艦ハルバード」/系統:「鋼騎士」を持つカード合計2枚までを手札に加える。残ったカードは破棄する。",
      "",
      "Lv2『自分のメインステップ』",
      "このスピリットに紫のシンボル2つを追加する。",
    ],
    keywordTags: ["soul_state"],
    tribe: "鋼騎士",
    image: "images/BSKB01-C02.webp",
    rarity: "C",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 手札にあるこのカードは、自分のメインステップ終了時に条件付きで破棄できる。
      // そうしたとき、お互い、デッキの上から1枚破棄できる。
      {
        applicability: { zone: "hand" },
        timing: { kind: "phase", step: "main", whose: "self", subPhase: "end" },
        executionMode: "optional",
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "メタナイト" }],
            includeSoulState: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "move_card",
              target: { kind: "self" },
              from: { zone: "hand", player: "self" },
              to: { zone: "trash", player: "self" },
              count: 1,
            },
            id: "discard-self",
          },
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "self", position: "top" },
              to: { zone: "trash", player: "self" },
              count: 1,
              deckDiscard: true,
            },
            executionMode: "optional",
            stepCondition: { kind: "ref_succeeded", stepId: "discard-self" },
          },
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "opponent", position: "top" },
              to: { zone: "trash", player: "opponent" },
              count: 1,
              deckDiscard: true,
            },
            executionMode: "optional",
            chooser: "opponent",
            connector: "simultaneous",
            stepCondition: { kind: "ref_succeeded", stepId: "discard-self" },
          },
        ],
        textRef: [0],
      },
      // [2,3] 召喚時: デッキ上3枚をオープンし、対象カード合計2枚までを手札、残り破棄。
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
                  count: 2,
                  filter: {
                    filterOr: [
                      { cardName: { contains: "宝剣ギャラクシア" } },
                      { cardName: { contains: "戦艦ハルバード" } },
                      { tribes: ["鋼騎士"] },
                    ],
                  },
                },
              ],
              remainder: "trash",
            },
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv2『自分のメインステップ』紫シンボル2つを追加。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        timingScope: { player: "self", period: "main" },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "purple",
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "purple",
              duration: { scope: "while_on_field" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSKB01-C03",
    orikaId: 555,
    orikaIndex: 553,
    name: "ソードナイト＆ブレードナイト",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "purple"],
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
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から2枚トラッシュに置ける。その後、自分の手札/トラッシュにある「戦艦ハルバード」1枚をコストを支払わずに配置できる。",
      "",
      "Lv1-Lv2『このスピリットのアタック時』",
      "相手のスピリット/アルティメット2体のコア1個ずつをリザーブに置ける。",
    ],
    keywordTags: [],
    tribe: "鋼騎士",
    image: "images/BSKB01-C03.webp",
    rarity: "C",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] 召喚時: デッキ上2枚をトラッシュに置ける。その後、手札/トラッシュのハルバード1枚をコストなし配置できる。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            id: "mill-deck",
            action: {
              kind: "discard",
              player: "self",
              fromZone: "deck",
              count: 2,
              deferMovedToTrashEffects: true,
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "search_zone",
              zone: ["hand", "trash"],
              filter: {
                category: ["nexus"],
                cardName: [{ contains: "戦艦ハルバード" }],
              },
              count: { min: 0, max: 1 },
              destination: "field",
            },
            targetSelectionTiming: "on_step",
            connector: "sequential",
          },
          {
            action: {
              kind: "process_moved_to_trash",
              source: { stepId: "mill-deck" },
              fromZone: "deck",
            },
            connector: "sequential",
            stepCondition: {
              kind: "ref_executed",
              stepId: "mill-deck",
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] アタック時: 相手2体のコア1個ずつをリザーブへ。
      //   target_card 単一対象コアシュートを repeat で2回発揮し、各対象から1個ずつ移動する。
      //   本文は「2体」なので repeat 登録の重複対象選択を禁止する。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
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
            repeat: { additional: 1, allowDuplicateTargets: false },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSKB01-C04",
    orikaId: 556,
    orikaIndex: 554,
    name: "戦艦ハルバード",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "purple"],
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
      "Lv1-Lv2 フラッシュ",
      "魂状態/煌臨元を含む自分の「[仮面の騎士]メタナイト」がいるとき、ターンに1回、自分のトークンの「ヘビーロブスター」1体を自分のカウントエリアのコア1個を置いて出せる。このとき、追加でコアを置けない。",
      "",
      "Lv2『自分のアタックステップ』",
      "魂状態/煌臨元を含む自分の「[仮面の騎士]メタナイト」がいるとき、相手がマジックカード/【アクセル】/スタック効果を使用したとき/発揮するとき、その効果発揮前に、このネクサスを破壊することで、その効果を無効にする。この効果は相手のスタックタイミング元にならない。",
    ],
    keywordTags: ["accel", "soul_state"],
    tribe: "鋼騎士",
    image: "images/BSKB01-C04.webp",
    rarity: "C",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSKB01-T01"],
    effects: [
      // Lv1-Lv2 フラッシュ: メタナイトがいるとき、ターンに1回、トークン「ヘビーロブスター」1体をカウントエリアのコア1個で出す。
      // 追加でコアを置けない = disableAutoReserveFieldCores でリザーブからの自動維持コア
      // 充当を止め、後続 core_move(from:count_area) だけが唯一の維持コア源になる。
      {
        timing: { kind: "activated", mode: "flash" },
        usageLimit: { kind: "per_instance", duration: "turn" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "[仮面の騎士]メタナイト" }],
            includeSoulState: true,
            includeAdventSource: true,
          },
        ],
        steps: [
          {
            id: "c04-token-summon",
            action: {
              kind: "put",
              target: { kind: "from_token_pool", count: 1 },
              costModifier: "free",
              disableAutoReserveFieldCores: true,
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "count_area", player: "self" },
              to: { kind: "ref", stepId: "c04-token-summon" },
              amount: 1,
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2『自分のアタックステップ』相手のマジック/アクセル/スタック効果を、このネクサス破壊で無効化。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 2 } },
        timingScope: { player: "self", period: "attack" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "[仮面の騎士]メタナイト" }],
            includeSoulState: true,
            includeAdventSource: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "suppress_stack_source",
              target: "self",
              player: "opponent",
              duration: { scope: "while_on_field" },
              effectFilter: { effectIndex: [2, 3, 4] },
            },
          },
        ],
        textRef: [4],
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "effect_declaration",
          triggerEffectActionKind: "magic",
          triggerEffectTiming: "flash",
        },
        timingScope: { player: "self", period: "attack" },
        applicability: { level: { min: 2 } },
        executionMode: "optional",
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "[仮面の騎士]メタナイト" }],
            includeSoulState: true,
            includeAdventSource: true,
          },
        ],
        steps: [
          {
            id: "c04-negate-cost",
            action: { kind: "destroy", target: { kind: "self" } },
            choice: [
              {
                label: "バル艦長を除外",
                action: {
                  kind: "remove_from_game",
                  target: {
                    kind: "filter",
                    player: "self",
                    filter: {
                      category: ["nexus"],
                      cardName: { exact: "バル艦長" },
                      minLevel: 2,
                    },
                    count: 1,
                  },
                },
              },
            ],
          },
          {
            action: { kind: "negate", negateTarget: "use" },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "effect_declaration",
          triggerEffectActionKind: "accel",
        },
        timingScope: { player: "self", period: "attack" },
        applicability: { level: { min: 2 } },
        executionMode: "optional",
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "[仮面の騎士]メタナイト" }],
            includeSoulState: true,
            includeAdventSource: true,
          },
        ],
        steps: [
          {
            id: "c04-negate-cost",
            action: { kind: "destroy", target: { kind: "self" } },
            choice: [
              {
                label: "バル艦長を除外",
                action: {
                  kind: "remove_from_game",
                  target: {
                    kind: "filter",
                    player: "self",
                    filter: {
                      category: ["nexus"],
                      cardName: { exact: "バル艦長" },
                      minLevel: 2,
                    },
                    count: 1,
                  },
                },
              },
            ],
          },
          {
            action: { kind: "negate", negateTarget: "effect" },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "effect_declaration",
          triggerEffectActionKind: [
            "magic",
            "field_card_effect",
            "hand_card_effect",
            "triggered_effect",
            "battle_immediate_effect",
            "divine_skill",
            "change",
          ],
          triggerEffectTiming: "stack",
        },
        timingScope: { player: "self", period: "attack" },
        applicability: { level: { min: 2 } },
        executionMode: "optional",
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "[仮面の騎士]メタナイト" }],
            includeSoulState: true,
            includeAdventSource: true,
          },
        ],
        steps: [
          {
            id: "c04-negate-cost",
            action: { kind: "destroy", target: { kind: "self" } },
            choice: [
              {
                label: "バル艦長を除外",
                action: {
                  kind: "remove_from_game",
                  target: {
                    kind: "filter",
                    player: "self",
                    filter: {
                      category: ["nexus"],
                      cardName: { exact: "バル艦長" },
                      minLevel: 2,
                    },
                    count: 1,
                  },
                },
              },
            ],
          },
          {
            action: {
              kind: "negate",
              negateTarget: "effect",
              targetEffectTiming: "stack",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSKB01-C05",
    orikaId: 557,
    orikaIndex: 555,
    name: "バル艦長",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple", "purple"],
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
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2",
      "自分の系統：「鋼騎士」によって相手のスピリット/アルティメット/ネクサスを破壊/消滅したとき、自分のカウント+1する。また、自分のカウント1につき、系統：「鋼騎士」を持つ自分のスピリットすべてをBP+1000する。",
      "",
      "Lv2『自分のアタックステップ』",
      "自分の「戦艦ハルバード」のLv2効果で、自分のネクサスを破壊するとき、かわりに、このネクサスを除外することで、その効果を発揮できる。この効果は相手のスタックタイミング元にならない。",
    ],
    keywordTags: [],
    tribe: "クルー・鋼騎士",
    image: "images/BSKB01-C05.webp",
    rarity: "C",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2 前段: 自分の系統「鋼騎士」によって、相手のカードが破壊/消滅したとき count+1。
      // BSDB01-CX01 / BSLH01-C05 と同じ第三者離脱観測:
      // player:"opponent" + cause:["opponent_effect","battle"] + sourceWhose:"either" で「自分起因」を表し、
      // triggerSourceFilter で離脱を引き起こした発生源カードの系統を絞る。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: ["destroy", "vanish"],
          triggerFilter: { category: ["spirit", "ultimate", "nexus"] },
          triggerSourceFilter: { tribes: ["鋼騎士"] },
          cause: ["opponent_effect", "battle"],
          sourceWhose: "either",
        },
        usageLimit: { kind: "per_trigger_activation" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2 後段: 自分のカウント1につき、鋼騎士スピリットすべてを BP+1000。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], tribes: ["鋼騎士"] },
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
        textRef: [0, 1],
      },
      // Lv2『自分のアタックステップ』戦艦ハルバードのLv2でネクサス破壊するかわりに、このネクサスを除外して発揮。
      // 実処理は BSKB01-C04 の Lv2 無効化 cost choice に畳み、C05 自身は textRef coverage と
      // 発生条件の正源として保持する。この置換は C04 効果解決中のコスト選択なので追加の stack source を作らない。
      {
        timing: { kind: "continuous" },
        executionMode: "optional",
        condition: [{ kind: "min_level", value: 2 }],
        steps: [{ action: { kind: "noop" } }],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSKB01-C06",
    orikaId: 558,
    orikaIndex: 556,
    name: "ギャラクシアダークネス",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "purple"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュにあるこのカードは、自分の効果を受けない。",
      "",
      "フラッシュ",
      "相手のスピリット/アルティメット1体を指定する。コスト合計(指定した対象のコスト)まで、指定した対象以外の相手のスピリット/アルティメットを好きなだけ消滅させる。消滅する対象のコアすべてはリザーブに置かれる。",
    ],
    keywordTags: [],
    tribe: "鋼騎士",
    image: "images/BSKB01-C06.webp",
    rarity: "C",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // トラッシュにあるこのカードは、自分の効果を受けない。
      {
        applicability: { zone: "trash" },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_in_trash" },
              sourcePlayerScope: "self",
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ: 相手1体を指定し、コスト合計(指定対象のコスト)まで他の相手スピ/アルを好きなだけ消滅。コアはリザーブへ。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "designated-target",
            targetSelectionTiming: "on_step",
            action: {
              kind: "noop",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
          {
            id: "cost-budget-vanish",
            targetSelectionTiming: "on_step",
            action: {
              kind: "vanish",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: { min: 0 },
                excludeStepId: "designated-target",
                budget: {
                  metric: "cost",
                  amount: {
                    source: {
                      kind: "cost_from_ref",
                      stepId: "designated-target",
                      costBasis: "effective_or_additional",
                    },
                  },
                },
              },
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSKB01-CX01",
    orikaId: 559,
    orikaIndex: 557,
    name: "[仮面の騎士]メタナイト",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: ["purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 6000,
      },
    ],
    printedOverCount: { minCount: 3, bpBonus: 5000 },
    overCount: { minCount: 3, bpBonus: 5000 },
    symbolColors: ["purple"],
    textLines: [
      "魂状態のこのカードには【契約煌臨】できる。このとき、煌臨するカードに自分のフィールド/リザーブのコアを好きなだけ置く。",
      "",
      "【契約煌臨元】 / 【スピリット】Lv1-Lv2『お互いのメインステップ終了時』",
      "相手のリザーブのコア1個を相手のスピリット/アルティメットに置ける。そうしたとき、自分のカウント+1し、コアを置いた対象とこのスピリットのBPを比べられる。(BPが同じか低い対象が破壊される)",
      "",
      "【契約煌臨元】 / 【スピリット】Lv1-Lv2『このスピリットのアタック時』",
      "自分のカウント+2する。その後、相手のスピリット/アルティメット1体のコアを、自分のカウント2につき、1個リザーブに置ける。",
    ],
    keywordTags: ["soul_state", "contract"],
    tribe: "鋼騎士・剣使",
    image: "images/BSKB01-CX01.webp",
    rarity: "CX",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 魂状態への【契約煌臨】許可＋煌臨時のコア任意配置。
      //   被煌臨の宣言（魂状態の契約「メタナイト」を煌臨先に含める）は declare_advent main /
      //   getContractAdventTargets 配線済み。「煌臨するカードに任意コア配置」は契約煌臨で
      //   魂状態へ煌臨したときの intrinsic 処理として engine 側で表現
      //   （legal-actions-apply: buildChargeCoresPendingCoreDistribution、08a:180）。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [0],
      },
      // 【契約煌臨元】/【スピリット】Lv1-Lv2『お互いのメインステップ終了時』相手リザーブのコア1個を相手のスピリット/アルティメット1体へ→カウント+1→BP比べ破壊。
      //   「相手のリザーブのコア1個を相手のスピリット/アルティメットに置ける」= 単一対象コア移送
      //   （target で相手1体選択 → from: 相手リザーブ → to: target_card）。BSSL01-C05 が from:target_card
      //   の precedent、本効果は逆方向で to:target_card（resolvedTargetIds 束縛は effect-interpreter で対応）。
      //   「そうしたとき、自分のカウント+1」= conditional_result（コアを置けたときのみ）。
      //   「コアを置いた対象とこのスピリットのBPを比べ、BPが同じか低い対象が破壊される」= bp_compare_destroy
      //   （源=このスピリット = Pattern 1 / 対象 = コアを置いた相手1体を ref 参照）。BP比べは対称
      //   （同値・源が同じか低いときは源も破壊される）＝ BSKB01-X05[7,8] と同じ正源挙動。
      {
        applicability: {
          zone: ["field", "advent_source"],
          adventSourceHostVariants: ["contract", "f_contract"],
        },
        timing: {
          kind: "phase",
          step: "main",
          whose: "either",
          subPhase: "end",
        },
        executionMode: "optional",
        steps: [
          {
            id: "place-core",
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
              from: {
                kind: "reserve",
                player: "opponent",
              },
              to: {
                kind: "target_card",
              },
              amount: 1,
            },
          },
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
            connector: "conditional_result",
          },
          {
            connector: "conditional_result",
            action: {
              kind: "bp_compare_destroy",
              target: {
                kind: "ref",
                stepId: "place-core",
              },
            },
            executionMode: "optional",
          },
        ],
        textRef: [2, 3],
      },
      // 【契約煌臨元】/【スピリット】Lv1-Lv2『アタック時』カウント+2。
      //   その後、相手のスピリット/アルティメット1体のコアを、自分のカウント2につき1個まで
      //   リザーブに置ける。単一対象コアシュート（core_move.target で1体選択 → from: target_card）。
      //   個数は範囲 {min:0, max: floor(count/2)} で pendingCoreCountSelection をプレイヤーに提示。
      //   count_increase が先に解決されるため、max は +2 後のカウントを 1/2 した値（BSSL01-C05 と同型）。
      {
        applicability: {
          zone: ["field", "advent_source"],
          adventSourceHostVariants: ["contract", "f_contract"],
        },
        timing: {
          kind: "card_event",
          event: "attack",
        },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
            },
          },
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
              from: {
                kind: "target_card",
              },
              to: {
                kind: "reserve",
                player: "opponent",
              },
              amount: {
                min: 0,
                max: {
                  source: {
                    kind: "count_value",
                    player: "self",
                  },
                  divisor: 2,
                },
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSKB01-M01",
    orikaId: 560,
    orikaIndex: 558,
    name: "[銀河に願いを]メタナイト",
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
        bp: 12000,
      },
    ],
    printedOverCount: { minCount: 5, bpBonus: 5000 },
    overCount: { minCount: 5, bpBonus: 5000 },
    symbolColors: ["purple"],
    textLines: [
      "フラッシュ【契約煌臨：「メタナイト」＆C5以上『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/アタック時』",
      "ターンに1回、自分のデッキを上から3枚オープンできる。その中の、系統：「鋼騎士」を持つカード1枚を1コスト支払って召喚/配置でき、カード1枚をトラッシュに置ける。残ったカードはデッキの下に戻す。",
      "",
      "Lv1-Lv2『このスピリットのアタック/ブロック時』",
      "このターンの間、相手のネクサス1つのLvコストを+2できる。その後、自分のカウント5以上のとき、相手のスピリット/アルティメットのコア3個をリザーブに置ける。",
    ],
    keywordTags: [],
    tribe: "鋼騎士・剣使",
    image: "images/BSKB01-M01.webp",
    rarity: "M",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    // フラッシュ【契約煌臨：「メタナイト」＆C5以上『お互いのアタックステップ』】
    // 契約煌臨宣言は declare_advent エンジン経路で処理される。
    // 『お互いのアタックステップ』→ both_attack_step (08a:17 タイミング表)。
    // 煌臨条件「メタナイト」(カード名部分一致) は AdventCondition.cardNames で表現
    //   （engine-drain 型 SSOT 適用）。
    // 「C5以上」は煌臨先コストではなく自分のカウント閾値のため declareCondition で表現。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "メタナイト" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 5 }],
    },
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["advent", "attack"],
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
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["spirit", "ultimate", "brave", "nexus"],
                    tribes: ["鋼騎士"],
                  },
                  destination: "field",
                  costGate: 1,
                  exclusiveGroup: "kb01m01_field",
                },
                {
                  count: 1,
                  destination: "trash",
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "card_event",
          event: ["attack", "block"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                },
                count: 1,
              },
              properties: {
                levelCostDelta: 2,
              },
              duration: {
                scope: "turn",
              },
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
              },
              to: {
                kind: "reserve",
                player: "opponent",
              },
              amount: 3,
            },
            executionMode: "optional",
            condition: [
              {
                kind: "count_value",
                player: "self",
                min: 5,
              },
            ],
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSKB01-M02",
    orikaId: 565,
    orikaIndex: 559,
    name: "[伝説の騎士]ギャラクティックナイト",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 7,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 20000,
      },
    ],
    symbolColors: ["white", "white"],
    textLines: [
      "このカードは系統：「鋼騎士」を持つ。",
      "",
      "手札にあるこのカードは、自分のメインステップに、自分のカウント9以上のとき、煌臨元を含む自分の契約スピリットの「メタナイト」がいれば、自分のカウントを0にすることでコストを支払わずに召喚できる。そうしたとき、減った自分のカウント2につき、相手のカウント-1する。",
      "",
      "Lv1-Lv2『このスピリットのアタック時』",
      "自分のライフが1になるように自分のライフのコアをリザーブに置ける。そうしたとき、置いたコア1につき、相手のライフのコア1個をボイドに置く。",
      "",
      "Lv1-Lv2『このスピリットのアタック時』",
      "相手のスピリット/アルティメット2体までをデッキの下に戻し、フィールドに残させない。",
    ],
    keywordTags: [],
    tribe: "鋼騎士・剣使",
    image: "images/BSKB01-M02.webp",
    rarity: "M",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 系統「鋼騎士」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["鋼騎士"] },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0],
      },
      // [2] Q54 型: カウント9以上で通常召喚行動を許可し、宣言時にカウントを0にする。
      // 「煌臨元を含む契約スピリットの『メタナイト』」は field_has の
      // category + requiredKeywordTags + includeAdventSource で、同名の契約煌臨カードを除外する。
      // normalActionPermission が分類の明示的な正源。normalActionDeclarationSteps は
      // stack window より前に count-to-zero と相手 count 減少を実行し、召喚/維持コア配置は
      // 通常 summon legal action の stack 解決後に行う。
      {
        applicability: { zone: "hand" },
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        executionMode: "optional",
        condition: [
          { kind: "count_value", player: "self", min: 9 },
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            cardNames: [{ contains: "メタナイト" }],
            requiredKeywordTags: ["contract"],
            includeAdventSource: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "summon",
              normalActionPermission: true,
              normalActionDeclarationSteps: [
                {
                  id: "count-to-zero",
                  action: {
                    kind: "count_decrease",
                    player: "self",
                    amount: {
                      source: { kind: "count_value", player: "self" },
                    },
                  },
                },
                {
                  action: {
                    kind: "count_decrease",
                    player: "opponent",
                    amount: {
                      source: {
                        kind: "step_numeric_amount",
                        stepId: "count-to-zero",
                      },
                      divisor: 2,
                    },
                  },
                  connector: "conditional_result",
                },
              ],
              target: { kind: "self" },
              costModifier: "free",
            },
          },
        ],
        textRef: [2],
      },
      // [4,5] アタック時: 自分のライフを1にし、置いた数だけ相手ライフをボイドへ。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        steps: [
          {
            id: "self-life-to-one",
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: {
                source: {
                  kind: "cores_on",
                  location: { kind: "life", player: "self" },
                },
                offset: -1,
                minValue: 0,
              },
            },
          },
          {
            stepCondition: {
              kind: "ref_count",
              stepId: "self-life-to-one",
              result: "numeric_amount",
              min: 1,
            },
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "void", player: "opponent" },
              amount: {
                source: {
                  kind: "step_numeric_amount",
                  stepId: "self-life-to-one",
                },
              },
            },
          },
        ],
        textRef: [4, 5],
      },
      // [7,8] アタック時: 相手のスピリット/アルティメット2体までをデッキ下に戻す。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: { min: 0, max: 2 },
              },
              position: "bottom",
              pierceCannotLeaveField: true,
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSKB01-R01",
    orikaId: 566,
    orikaIndex: 560,
    name: "アックスナイト＆ジャベリンナイト＆メイスナイト＆トライデントナイト",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 6,
    reductionSymbols: ["purple", "purple", "purple", "purple"],
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
    symbolColors: ["purple"],
    textLines: [
      "〔重複不可〕自分のメインステップ終了時、自分のカウント5以上で、魂状態を含む自分の「メタナイト」がいれば、手札にある、このカードと「メタナイト」1枚を破棄できる。そうしたとき、このターンの間、自分の「コア除去効果」で移動するコアの数を+2する。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分はデッキの上から3枚ドローできる。その後、自分は手札3枚までを破棄できる。",
      "",
      "Lv2『このスピリットのアタック時』",
      "自分のトラッシュにある系統：「鋼騎士」を持つカード1枚を手札に戻せる。",
    ],
    keywordTags: ["soul_state"],
    tribe: "鋼騎士",
    image: "images/BSKB01-R01.webp",
    rarity: "R",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 〔重複不可〕手札からのメインステップ終了時起動：カウント5以上＋魂状態を含む
      //   「メタナイト」存在 (field_has includeSoulState) が前提条件。破棄用の
      //   「メタナイト」が手札になくても可能な分を破棄する（公式Q19491、03c1）。
      //   自己＋「メタナイト」1枚を手札から破棄→このターンの間、自分の「コア除去効果」で
      //   移動するコアの数+2 (core_move_amount_modifier scope:self_player、
      //   BSTH001-転醒R02(A) と同型 precedent)。
      {
        timing: { kind: "phase", step: "main", whose: "self", subPhase: "end" },
        applicability: { zone: "hand" },
        executionMode: "optional",
        usageLimit: { kind: "no_duplicate" },
        condition: [
          { kind: "count_value", player: "self", min: 5 },
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "メタナイト" }],
            includeSoulState: true,
          },
        ],
        steps: [
          {
            id: "discard-self",
            action: {
              kind: "move_card",
              target: { kind: "self" },
              from: { zone: "hand", player: "self" },
              to: { zone: "trash", player: "self" },
              count: 1,
            },
          },
          {
            id: "discard-partner",
            targetSelectionTiming: "on_step",
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "self",
                zone: "hand",
                filter: { cardName: { contains: "メタナイト" } },
                count: 1,
              },
              from: {
                zone: "hand",
                player: "self",
                filter: { cardName: { contains: "メタナイト" } },
              },
              to: { zone: "trash", player: "self" },
              count: 1,
              requireFullCount: true,
            },
            connector: "simultaneous",
          },
          {
            action: {
              kind: "core_move_amount_modifier",
              scope: "self_player",
              amount: 2,
              duration: { scope: "turn", whose: "self" },
            },
            connector: "conditional_result",
            stepCondition: {
              kind: "all",
              conditions: [
                { kind: "ref_count", stepId: "discard-self", min: 1 },
                { kind: "ref_count", stepId: "discard-partner", min: 1 },
              ],
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『召喚時』デッキ上3枚ドロー→手札3枚まで破棄。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          { executionMode: "optional", action: { kind: "draw", count: 3 } },
          {
            action: {
              kind: "discard",
              player: "self",
              count: { min: 0, max: 3 },
            },
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      // Lv2『アタック時』トラッシュの鋼騎士1枚を手札に戻す。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: { tribes: ["鋼騎士"] },
              count: 1,
              mandatory: true,
              destination: "hand",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSKB01-R02",
    orikaId: 567,
    orikaIndex: 561,
    name: "[虚ろなる鏡の騎士]ダークメタナイト",
    printedCategory: "spirit",
    colors: ["purple", "yellow"],
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
        requiredCores: 3,
        bp: 8000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "このカード/スピリットは【契約煌臨】を持っているものとして扱う。",
      "",
      "フラッシュ【コントラクトチェンジ：コスト4<紫><紫>】",
      "相手のフィールドのコア4個までを相手のスピリット/アルティメット/ネクサスに好きなように置ける。この効果でスピリット/アルティメットのコアを0個にできない。その後、このターンの間、コア2個以下の相手のスピリット/アルティメットのアタックでは自分のライフは減らない。この効果発揮後、このカードを破棄するか、煌臨中の自分のスピリットと回復状態で入れ替える。このとき、煌臨元の「[仮面の騎士]メタナイト」はこのスピリットの煌臨元にする。",
      "",
      "Lv1-Lv2『このスピリットの召喚/アタック時』",
      "ターンに1回、自分はデッキの下から2枚ドローできる。",
    ],
    keywordTags: [],
    tribe: "鋼騎士・剣使",
    image: "images/BSKB01-R02.webp",
    rarity: "R",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // qa-038 により【コントラクトチェンジ】は【チェンジ】として扱う。
    // 既存 ChangeData 経路に載せることで、手札からフラッシュ使用→コスト支払い→
    // stack 窓→効果解決→破棄 or 入れ替え cleanup を既存チェンジ pipeline で処理する。
    changeData: {
      cost: 4,
      reduction: ["purple", "purple"],
      swapCondition: { adventState: "advented" },
      transferAdventSourcesOnSwap: {
        cardNames: [{ contains: "[仮面の騎士]メタナイト" }],
      },
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "core_distribute",
                from: {
                  kind: "field",
                  player: "opponent",
                  minRemainingPerCandidateByFilter: [
                    {
                      filter: { category: ["spirit", "ultimate"] },
                      minRemaining: 1,
                    },
                  ],
                },
                to: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate", "nexus"] },
                  count: "all",
                },
                amount: 4,
                mode: "player_choice",
              },
            },
            {
              action: {
                kind: "life_damage_interception",
                player: "self",
                cause: "opponent",
                mode: "replace",
                battleOnly: true,
                attackerFilter: {
                  category: ["spirit", "ultimate"],
                  maxCores: 2,
                },
                duration: { scope: "turn" },
              },
            },
          ],
          textRef: [2, 3],
        },
      ],
    },
    effects: [
      // このカード/スピリットは【契約煌臨】を持っているものとして扱う。
      //   本来の契約煌臨対象資格は player.contractCardNo 一致 (isPlayersContractCard、
      //   自分のデッキの契約カード = BSKB01-CX01) のみで判定される
      //   (advent-system.ts getContractAdventTargets 魂状態分岐)。このカードは
      //   keywordTags に "contract" を持たず contractCardNo にもならないため、その判定を
      //   override_properties CE の properties.grantsContractAdventEligibility:true 付与で
      //   拡張し、魂状態のこのカードも他カードの契約煌臨宣言の対象になれるようにする
      //   (SSOT: hasContractAdventEligibilityGrant、advent-system.ts。宣言時
      //   getContractAdventTargets / 解決時 executeAdvent 再検証の両方で参照)。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { grantsContractAdventEligibility: true },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2『召喚/アタック時』ターンに1回、デッキの下から2枚ドロー。
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "draw",
              count: 2,
              position: "bottom",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSKB01-R03",
    combinedBoost: 6000,
    orikaId: 568,
    orikaIndex: 562,
    name: "宝剣ギャラクシア",
    printedCategory: "brave",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1『このブレイヴの召喚時』",
      "自分はデッキの上から2枚ドローできる。その後、煌臨中の自分のスピリットがいるとき、相手のフィールドのコア1個をリザーブに置ける。",
      "",
      "【合体条件：剣使＆鋼騎士】",
      "【合体中】『自分のアタックステップ』",
      "このスピリットの効果で移動する相手のコアすべてはトラッシュに置かれる。",
      "",
      "【合体中】『このスピリットのアタック時』",
      "自分のデッキを上から2枚まで破棄できる。その中のカード1枚のコスト3につき、自分のカウント+1できる。",
    ],
    keywordTags: [],
    tribe: "剣刃・鋼騎士",
    image: "images/BSKB01-R03.webp",
    rarity: "R",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1『このブレイヴの召喚時』デッキ上2枚ドロー → その後、煌臨中の自分のスピリットが
      // いるとき、相手のフィールドのコア1個をリザーブに置ける（field_has adventState で 【煌臨中】判定）。
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
            executionMode: "optional",
          },
          {
            condition: [
              {
                kind: "field_has",
                player: "self",
                adventState: "advented",
              },
            ],
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: {
                kind: "field",
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
        textRef: [0, 1],
      },
      // 【合体中】『自分のアタックステップ』このスピリットの効果で移動する相手コアをすべてトラッシュへ。
      // 常駐置換 (core_move_destination_replacement CE、duration:while_on_field)。condition
      // (combined) は applicability recompute add/remove、timingScope (自分のアタック
      // ステップ) は消費時 isCEActiveForScope で動的評価 (BSTH09.2-転醒R03(B) 先例と同型)。
      {
        timing: { kind: "continuous" },
        applicability: { combined: true },
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "core_move_destination_replacement",
              fromOwner: "opponent",
              matchCausingSourceOnly: true,
              toZone: "trash",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4, 5],
      },
      // 【合体中】『このスピリットのアタック時』デッキ上2枚まで破棄→その中の1枚を選び、
      // そのコスト3につきカウント+1。裁定(A)1枚選択型 (needs-ruling.jsonl BSKB01-R03
      // resolved 2026-07-29): 破棄カードから1枚を選択(target.stepId で mill 限定)し、
      // その1枚のコストのみを3で割ってカウント+1する（複数枚合算ではない）。
      // select step は count:{min:0,max:1} で「できる」= 選択自体も任意（milled 0枚時は
      // 候補0で自動 no-op）。
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { combined: true },
        executionMode: "optional",
        steps: [
          {
            id: "mill",
            action: {
              kind: "discard",
              player: "self",
              fromZone: "deck",
              count: { min: 0, max: 2 },
            },
          },
          {
            id: "selectOne",
            targetSelectionTiming: "on_step",
            action: {
              kind: "noop",
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                filter: {},
                count: { min: 0, max: 1 },
                stepId: "mill",
              },
            },
          },
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: {
                source: {
                  kind: "cost_from_ref",
                  stepId: "selectOne",
                  costBasis: "printed",
                },
                divisor: 3,
              },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],

    braveCondition: { tribes: ["剣使", "鋼騎士"], tribesLogic: "and" },
  },
  {
    cardNo: "BSKB01-R04",
    orikaId: 561,
    orikaIndex: 563,
    name: "メタナイトが夜な夜なこっそり食べてるパフェ",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "purple"],
    mirageData: { cost: 3, reduction: ["purple", "purple"] },
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュにあるこのカードは、一切の効果を受けない。",
      "",
      "手札/手元からフラッシュ効果を使用したこのカードは、効果発揮後まで、相手の効果を受けない。",
      "",
      "【ミラージュ：コスト3<紫><紫>(このカードは手札からセットできる)】",
      "【セット中】『自分の各ステップ終了時』",
      "トラッシュにある《ソウルコア》以外のコア1個を自分のリザーブに置ける。",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕魂状態を含む自分の「メタナイト」がいるとき、このターンの間、相手によって自分のライフが減ったとき、減った数1につき、ボイドからコア1個を自分のライフに置ける。",
    ],
    keywordTags: ["soul_state"],
    tribe: "鋼騎士",
    image: "images/BSKB01-R04.webp",
    rarity: "R",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // トラッシュにあるこのカードは、一切の効果を受けない。
      // while_in_trash 束縛の effect_immunity (defense_immune)。トラッシュ滞在中のみ登録される。
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
      // 手札/手元からフラッシュ使用したこのカードは、効果発揮後まで、相手の効果を受けない。
      // ENGINE-effect-immunity-own-pending-resolution: 「発揮後まで」の一時耐性は宣言と
      // 同時に登録しないと、相手が発揮前 (`effect_declaration`) 無効化を試みる窓に間に合わない
      // (このカード自身の解決 steps 内で耐性を張るのでは既に窓が閉じた後になる)。
      // よって game_event:"effect_declaration" の自己観測 (requireTriggerSelf, player:"self")
      // として宣言時点で即時 mandatory 発動し、宣言元ゾーンを
      // triggerActivationZone:["hand","set_aside"] で絞る (手元/手札からのフラッシュ使用のみ、
      // ミラージュセット状態からの発動は対象外)。duration.scope
      // "while_own_declaration_pending" は宣言者自身の effect_activated (効果発揮完了直後、
      // = 「効果発揮後」) まで有効で、そこで自動失効する (removeUntilEventContinuousEffects)。
      {
        // effect_declaration 発火時点でこのカード自身は宣言に伴い既に in_use ゾーンへ
        // 移動済み (sourceZone 省略時の既定 "field" では自己候補が解決できない、
        // ENGINE-magic-activation-source-zone-condition の in_use スナップショットと同型)。
        applicability: { zone: "in_use" },
        timing: {
          kind: "game_event",
          player: "self",
          event: "effect_declaration",
          requireTriggerSelf: true,
          triggerEffectActionKind: "magic",
          triggerEffectTiming: "flash",
          triggerActivationZone: ["hand", "set_aside"],
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_own_declaration_pending" },
            },
          },
        ],
        textRef: [2],
      },
      // 【ミラージュ：コスト3紫紫】【セット中】『自分の各ステップ終了時』トラッシュのソウルコア以外のコア1個を自分のリザーブへ。
      // trash→reserve は effectKind 省略時も handleTrashToReserve が汎用フォールバック
      // (moveNormalCores、ソウル不可侵) に委譲するため実害は無いが (soul-core-exclusion-scan.mjs
      // 監査対応)、印字の「《ソウルコア》以外」を明示するため effectKind:"normal_only" を付与する。
      {
        applicability: { zone: "mirage_set" },
        timing: { kind: "phase", whose: "self", subPhase: "end" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
              effectKind: "normal_only",
            },
          },
        ],
        textRef: [4, 5, 6],
      },
      // フラッシュ〔ターンに1回：同名〕メタナイトがいるとき、このターン相手にライフを減らされた数だけボイドからライフへコア。
      // engine-player-scoped-turn-reservation: 「使用後もこのターン中反復」= grant_effect の
      // turnReservation variant (grant-effect-system.ts) で表現。使用後トラッシュへ行く
      // このカード自身 (target:{kind:"self"}) へ duration:{scope:"turn"} で自己付与し、
      // 通常の grant_effect lifecycle (grantee の zone===field 要求) をバイパスする。
      // 「魂状態を含む自分の「メタナイト」がいるとき」は登録時 (flash 使用時) の一度きりの
      // 起動ゲート (= 効果発揮の legal-action 条件) であり、以後トラッシュへ移動した後は
      // continuous-effect-rebuild の provenance 再検証で再評価されない
      // (isContinuousEffectStillValid の turnReservation 分岐、10_rules 該当なし=
      // BSSL01-C02 restrict_core_placement 先例と同型の「起動条件は一度きり」規約)。
      // 反応先 reduce_life は BSTH02.7-TX01(A) 先例と同型の cause:["opponent_effect","battle"]
      // に、実加害者を照合する triggerCausedBy:"opponent" を重ねる。「自分のアタックで
      // 自分のライフを減らした」ケースを相手バトルと誤認しない (BS48 Q22983)。
      // 「減った数1につき」は event_amount (P3-14 C-5、matchedEvent.amount を
      // PendingTriggeredEffect.amount へ転写→ executeEffect eventAmount → DynamicCount)。
      {
        timing: { kind: "activated", mode: "flash" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "メタナイト" }],
            includeSoulState: true,
          },
        ],
        steps: [
          {
            // usageLimit はフラッシュでこの予約を登録する発揮全体に属する。
            // 内側の grantedEffect は「このターンの間」の反復反応だけを担うため、
            // sourceText で原文の担当範囲を分離する（fidelity constraint audit の
            // nested Effect 所属 carrier も兼ねる）。
            prompt: {
              sourceText:
                "このターンの間、相手によって自分のライフが減ったとき、減った数1につき、ボイドからコア1個を自分のライフに置ける。",
            },
            action: {
              kind: "grant_effect",
              target: { kind: "self" },
              turnReservation: true,
              duration: { scope: "turn" },
              grantedEffect: {
                timing: {
                  kind: "game_event",
                  player: "self",
                  event: "reduce_life",
                  cause: ["opponent_effect", "battle"],
                  triggerCausedBy: "opponent",
                },
                executionMode: "optional",
                steps: [
                  {
                    action: {
                      kind: "core_move",
                      from: { kind: "void", player: "self" },
                      to: { kind: "life", player: "self" },
                      amount: { source: { kind: "event_amount" } },
                    },
                  },
                ],
              },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSKB01-T01",
    orikaId: 562,
    orikaIndex: 564,
    name: "ヘビーロブスター",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 8000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "このカードはデッキに入れられない。",
      "",
      "このカード/スピリットはコアを、出すとき以外で置けず、移動するとき/このスピリットがフィールドを離れるとき、ボイドに置かなければならない。",
      "",
      "Lv1『このスピリットのアタック時』",
      "自分はデッキの上から1枚ドローでき、自分のカウント以下のコアの相手のスピリット/アルティメット1体を破壊できる。",
      "",
      "Lv1",
      "このスピリットが相手によってフィールドを離れるとき、自分のスピリット/アルティメット1体をトラッシュに置ける。そうしたとき、相手は、相手のスピリット/アルティメット1体をトラッシュに置く。この効果は相手の効果では防げない。",
    ],
    keywordTags: ["token"],
    tribe: "鋼騎士・機獣",
    image: "images/BSKB01-T01.webp",
    rarity: "T",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 0,
    maxTokenDeckCount: 6,
    sourceUrls: [],
    sourceConfidence: "C",
    // textLines[2] (コア配置・移動・離脱時のボイド行き特殊ルール) は tokenIndependentCoreManagement
    // (model.ts) のエンジン基盤 (moveNormalCores の choke point redirect + handleFieldCoreShoot
    // のソース別振替、通常コア対応 ENGINE-token-independent-core-void-redirect) で自動処理される
    // ため、専用 effects エントリは不要 (BSAZ02 grandwalkerData precedent と同型)。ソウルコア分は
    // 10_rules/06 の硬制約「ボイドは常に不可。explicit 指定でも soul をボイドに置けない」により
    // そもそも void 行きが起こらない (genericSoulDestination SSOT が void を常に除外)。この
    // 硬制約に反してソウルコアも強制ボイド振替する誤実装 (ENGINE-void-soul-core-count) は
    // adversarial verifier round1 lens1/6 で refute 済み。
    tokenIndependentCoreManagement: {
      redirectCoresToVoid: true,
      placementRestrictedToEnterField: true,
    },
    effects: [
      // [4,5] アタック時: 1ドロー + カウント以下のコア数の相手1体破壊。
      {
        timing: {
          kind: "card_event",
          event: "attack",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "draw",
              count: 1,
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxCoresSource: "self_count",
                },
                count: 1,
              },
            },
            connector: "simultaneous",
            executionMode: "optional",
          },
        ],
        textRef: [4, 5],
      },
      // [7,8] 相手による離脱時: 自分1体をトラッシュに置ける。達成時だけ相手1体もトラッシュへ。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        preventionLevel: "unpreventable",
        steps: [
          {
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              from: { zone: "field", player: "self" },
              to: { zone: "trash" },
              count: 1,
            },
          },
          {
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              from: { zone: "field", player: "opponent" },
              to: { zone: "trash" },
              count: 1,
            },
            connector: "conditional_result",
            chooser: "opponent",
            targetSelectionTiming: "on_step",
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSKB01-TX01(A)",
    orikaId: 564,
    orikaIndex: 565,
    name: "[光の騎士]淵源を巡る英雄",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 7,
    reductionSymbols: ["white", "white", "white", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 12000,
      },
      {
        level: 3,
        requiredCores: 5,
        bp: 16000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "このカードは系統：「鋼騎士」を持ち、このカード/スピリットのシンボル/軽減シンボルは紫としても扱う。",
      "",
      "Lv1-Lv2-Lv3【転醒：自分のカウント1以上(転醒は同時に使えない)】",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットを回復状態にして裏返せる。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "このスピリット以外のスピリット/アルティメットすべてのコア1個ずつをリザーブに置ける。この効果で消滅した対象1体につき、ボイドからコア1個をこのスピリットに置ける。",
    ],
    keywordTags: ["double_sided"],
    tribe: "鋼騎士・剣使",
    image: "images/BSKB01-TX01(A).webp",
    rarity: "TX",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは系統「鋼騎士」を持ち、シンボル/軽減シンボルは紫としても扱う。
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
      // Lv1-Lv2-Lv3【転醒：自分のカウント1以上】相手によってフィールドを離れるとき、回復状態にして裏返せる。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", min: 1 }],
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              state: "recovered",
              target: { kind: "self" },
            },
          },
          { action: { kind: "rebirth" }, connector: "sequential" },
        ],
        textRef: [2, 3],
      },
      // Lv1-Lv2-Lv3『召喚/アタック時』自分以外のスピ/アル全てのコア1個ずつをリザーブへ。消滅対象1体につきボイドからこのスピリットにコア1個。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        steps: [
          {
            id: "tx01-drain-all",
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "either",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
                excludeSelf: true,
              },
              from: { kind: "target_card" },
              toTargetController: { kind: "reserve" },
              amount: 1,
            },
          },
          {
            id: "tx01-fill-vanished",
            connector: "after_state_check",
            stepCondition: {
              kind: "ref_leave_established",
              stepId: "tx01-drain-all",
              leaveKind: "vanish",
            },
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: {
                source: {
                  kind: "cards_from_ref",
                  stepId: "tx01-drain-all",
                  establishedLeaveKind: "vanish",
                },
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "[闇の騎士]淵源を巡る英雄",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 12,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 1,
          bp: 13000,
        },
        {
          level: 2,
          requiredCores: 3,
          bp: 17000,
        },
        {
          level: 3,
          requiredCores: 5,
          bp: 24000,
        },
      ],
      symbolColors: ["purple", "purple"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』",
        "ターンに1回、自分のカウントエリアのコア3個までをボイドに置ける。置いたコアの数により以下の効果を発揮する。",
        "1個以上：相手のスピリット/アルティメットのコア2個をトラッシュに置ける。",
        "2個以上：相手の手札の内容を見て、その中のスピリットカード1枚を破棄する。",
        "3個：このターンの間、このスピリットは相手の効果を受けない。",
        "",
        "Lv3『このスピリットのアタック時』",
        "相手のライフ/フィールド/リザーブのコア1個ずつをトラッシュに置ける。",
      ],
      keywordTags: [],
      tribe: "剣使",
      image: "images/BSKB01-TX01(B).webp",
      rarity: "TX",
      pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
      cardNo: "BSKB01-TX01(B)",
      effects: [
        // Lv1-Lv3『転醒/アタック時』。カウントエリアから実際に置いたコア数を
        // StepResult.numericAmount で受け、閾値ごとの任意効果を順に発揮する。
        {
          timing: { kind: "card_event", event: ["rebirth", "attack"] },
          usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
          executionMode: "optional",
          steps: [
            {
              id: "pay-count-cores",
              action: {
                kind: "core_move",
                from: { kind: "count_area", player: "self" },
                to: { kind: "void", player: "self" },
                amount: { min: 0, max: 3 },
              },
            },
            {
              connector: "sequential",
              executionMode: "optional",
              stepCondition: {
                kind: "ref_count",
                stepId: "pay-count-cores",
                result: "numeric_amount",
                min: 1,
              },
              action: {
                kind: "core_move",
                // 「相手の…からコア2個」は対象を1体に固定しない。field source の
                // total range 選択で、複数のスピリット/アルティメットから合計2個までを選ぶ。
                from: {
                  kind: "field",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"] },
                },
                to: { kind: "trash", player: "opponent" },
                amount: { min: 0, max: 2 },
              },
            },
            {
              connector: "sequential",
              stepCondition: {
                kind: "ref_count",
                stepId: "pay-count-cores",
                result: "numeric_amount",
                min: 2,
              },
              action: {
                kind: "reveal_hand",
                player: "opponent",
                revealTo: "self",
              },
            },
            {
              connector: "sequential",
              stepCondition: {
                kind: "ref_count",
                stepId: "pay-count-cores",
                result: "numeric_amount",
                min: 2,
              },
              action: {
                kind: "discard",
                player: "opponent",
                count: 1,
                filter: { category: ["spirit"] },
                // 「内容を見て、その中の…1枚を破棄する」は効果の発揮者が
                // 公開された相手の手札から選ぶ。既定の「相手は…捨てる」とは別。
                selectionPlayer: "effect_controller",
              },
            },
            {
              connector: "sequential",
              stepCondition: {
                kind: "ref_count",
                stepId: "pay-count-cores",
                result: "numeric_amount",
                min: 3,
              },
              action: {
                kind: "effect_immunity",
                target: { kind: "self" },
                duration: { scope: "turn" },
              },
            },
          ],
          textRef: [2, 3, 4, 5, 6],
        },
        // Lv3『アタック時』。各ゾーンから1個ずつの任意コア移動。
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { level: { min: 3 } },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "life", player: "opponent" },
                to: { kind: "trash", player: "opponent" },
                amount: 1,
              },
            },
            {
              connector: "sequential",
              action: {
                kind: "core_move",
                from: {
                  kind: "field",
                  player: "opponent",
                  includeReserve: true,
                  eachZone: true,
                },
                to: { kind: "trash", player: "opponent" },
                amount: 1,
              },
            },
          ],
          textRef: [8, 9],
        },
      ],
    },
  },
  {
    cardNo: "BSKB01-X01",
    orikaId: 563,
    orikaIndex: 566,
    name: "[英雄を討ち倒し者]メタナイト",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 9,
    reductionSymbols: ["purple", "purple", "purple", "purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 9000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 16000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 21000,
      },
    ],
    printedOverCount: { minCount: 7, bpBonus: 8000 },
    overCount: { minCount: 7, bpBonus: 8000 },
    symbolColors: ["purple", "purple"],
    textLines: [
      "フラッシュ【契約煌臨：「メタナイト」＆C7以上『お互いのターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "【OC条件：カウント7以上】",
      "【OC中＆煌臨中】Lv1-Lv2-Lv3『このスピリットの煌臨/アタック時』",
      "ターンに1回、相手のフィールドのコア3個までをトラッシュに置ける。自分のトラッシュにある系統：「鋼騎士」を持つカード3枚を除外することで、この効果は相手の効果では防げない。",
      "",
      "【OC中＆煌臨中】Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "バトル終了時、相手のスピリット/アルティメット1体とこのスピリットのBPを比べられる。(BPが同じか低い対象が破壊される)相手の対象だけを破壊したとき、相手のライフのコア1個をリザーブに置ける。",
    ],
    keywordTags: [],
    tribe: "鋼騎士・剣使",
    image: "images/BSKB01-X01.webp",
    rarity: "X",
    pack: "BSKB01 星のカービィシリーズ-メタナイト編-",
    maxDeckCount: 3,
    // フラッシュ【契約煌臨：「メタナイト」＆C7以上『お互いのターン』】
    // 契約煌臨宣言は declare_advent エンジン経路で処理される。
    // 『お互いのターン』はメイン/フラッシュ窓で使用可 → main_and_flash で表現。
    // 煌臨条件「メタナイト」(カード名部分一致) は AdventCondition.cardNames で表現
    //   （engine-drain 型 SSOT 適用）。
    // 「C7以上」は煌臨先コストではなく自分のカウント閾値のため declareCondition で表現。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "メタナイト" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "main_and_flash",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 7 }],
    },
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【OC中＆煌臨中】Lv1-Lv2-Lv3『煌臨/アタック時』ターンに1回、相手フィールドのコア3個までをトラッシュへ。
      {
        timing: {
          kind: "card_event",
          event: ["advent", "attack"],
        },
        condition: [
          {
            kind: "count_value",
            player: "self",
            min: 7,
          },
          {
            kind: "self_state",
            state: "advented",
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
                kind: "field",
                player: "opponent",
              },
              to: {
                kind: "trash",
                player: "opponent",
              },
              amount: {
                min: 0,
                max: 3,
              },
            },
          },
        ],
        textRef: [3, 4, 5],
      },
      // 【OC中＆煌臨中】Lv1-Lv2-Lv3『アタック時』バトル終了時のBP比較破壊→相手ライフのコア除去。
      //   『このスピリットのアタック時』効果でバトル終了時に解決 → timing.deferredTo:"battle_end"
      //   （BSTH001 等の precedent）。「相手1体とこのスピリットのBPを比べ、同じか低い対象が破壊」=
      //   bp_compare_destroy（源=このスピリット、対象=相手スピリット/アルティメット1体）。「比べられる」=
      //   任意なので executionMode:"optional"。「相手の対象だけを破壊したとき、相手のライフのコア1個を
      //   リザーブに置ける」= 相手対象が場を離れた（ref_left_field）∧ 源が場に残っている
      //   （self_state:"on_field"。相討ち＝両破壊のときは「だけ」が成立しないため除外）ときに任意で
      //   core_move（相手ライフ→相手リザーブ）。ref_left_field は after_triggers で破壊解決後に判定する。
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        // OC = count_value(self,min:7) / 煌臨中 = self_state.advented（effects[0] と同型、
        // 10_rules/08a L34 / BSRK01-X02 effects[1] precedent。adversarial verifier 反証で
        // effects[1] のみ self_state 節が欠落していたことが判明 — engine-claude 2026-07-24）。
        condition: [
          { kind: "count_value", player: "self", min: 7 },
          { kind: "self_state", state: "advented" },
        ],
        executionMode: "optional",
        steps: [
          {
            id: "bp-compare",
            action: {
              kind: "bp_compare_destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
          {
            connector: "after_state_check",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_leave_established",
                  stepId: "bp-compare",
                  leaveKind: "destroy",
                },
                {
                  kind: "ref_leave_established",
                  stepId: "bp-compare",
                  leaveKind: "destroy",
                  subject: "source",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
        textRef: [7, 8],
      },
      // 「自分のトラッシュにある系統：「鋼騎士」を持つカード3枚を除外することで、この効果は
      // 相手の効果では防げない」(ENGINE-paid-prevention-immunity-card-cost Step4)。
      // 「この効果」= effects[0]（コア3個までトラッシュ）1つのみへのスコープのため、
      // grant_paid_prevention_immunity の scope.effectIndex:0 で限定する
      // （BSGE01-R04 型のカード全体スコープとは異なる、単一 effect スコープの precedent。
      // 本 effect 自体は末尾に置く — effects[1] の bp-compare-destroy を直接参照する既存
      // テスト (bskb01-x01-bp-compare-battle-end.test.ts REAL_EFFECT_INDEX) の index を
      // ずらさないため、配列途中への挿入を避けている）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "grant_paid_prevention_immunity",
              target: { kind: "self" },
              cost: {
                resource: "card",
                amount: 3,
                zone: "trash",
                filter: { tribes: ["鋼騎士"] },
              },
              scope: { effectIndex: 0 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5],
      },
    ],
  },
];
