import type { CardDefinition } from "@orica/rules-core";

export const BSTH10_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH10-C01",
    orikaId: 582,
    name: "[地上の月兎]鈴仙・優曇華院・イナバ",
    printedCategory: "ultimate",
    colors: ["black"],
    cost: 3,
    reductionSymbols: ["black"],
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
      "【召喚条件：自分が契約していない】",
      "",
      "Lv3-Lv4『このアルティメットの召喚時』",
      "自分のフィールドが黒1色のとき、相手の手札の内容を見れる。その中の契約カード以外のコスト3以下のカード1枚を破棄する。その後、相手の手札が5枚以上のとき、自分はデッキの上から2枚ドローできる。",
      "",
      "Lv3-Lv4",
      "このアルティメットのシンボルは黒としても扱う。",
    ],
    keywordTags: [],
    tribe: "幻想・玄影",
    image: "images/BSTH10-C01.webp",
    rarity: "C",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
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
              kind: "reveal_hand",
              player: "opponent",
              revealTo: "self",
            },
            id: "see",
          },
          {
            action: {
              kind: "discard",
              player: "opponent",
              count: 1,
              filter: {
                maxCost: 3,
                isContract: false,
              },
              selectionPlayer: "effect_controller",
            },
            connector: "conditional_result",
            id: "discard",
          },
          {
            action: {
              kind: "draw",
              count: 2,
            },
            connector: "sequential",
            condition: [
              {
                kind: "hand_count",
                player: "opponent",
                min: 5,
              },
            ],
            executionMode: "optional",
          },
        ],
        textRef: [2, 3],
        condition: [
          {
            kind: "field_all_match",
            player: "self",
            filter: {
              colors: ["black"],
              colorCount: "mono",
              targetsGrandwalker: true,
              targetsGrandstone: true,
            },
          },
        ],
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
              asColor: "black",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
    summonCondition: [
      {
        kind: "no_contract_card",
        player: "self",
      },
    ],
  },
  {
    cardNo: "BSTH10-C02",
    orikaId: 583,
    name: "[宇宙と不思議な巫女]博麗 霊夢",
    printedCategory: "spirit",
    colors: ["black"],
    cost: 3,
    reductionSymbols: ["black"],
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
    symbolColors: ["black"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のフィールドが黒1色のとき、自分が契約していなければ、相手の手札の内容を見れる。その中の契約カード以外のコスト4/5のカード1枚を破棄する。その後、破棄できなかったとき、トラッシュの<ソウルコア>以外のコア2個をこのスピリットに置ける。",
      "",
      "Lv1-Lv2",
      "このスピリットはスピリットとして扱わない。",
    ],
    keywordTags: [],
    tribe: "幻想・穹牙",
    image: "images/BSTH10-C02.webp",
    rarity: "C",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
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
              kind: "reveal_hand",
              player: "opponent",
              revealTo: "self",
            },
            id: "see",
          },
          {
            action: {
              kind: "discard",
              player: "opponent",
              count: 1,
              filter: {
                isContract: false,
                minCost: 4,
                maxCost: 5,
              },
              selectionPlayer: "effect_controller",
            },
            connector: "conditional_result",
            id: "discard",
          },
          {
            action: {
              kind: "core_move",
              from: {
                kind: "trash",
                player: "self",
              },
              to: {
                kind: "this_card",
              },
              amount: 2,
              effectKind: "normal_only",
            },
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "discard",
              max: 0,
              min: 0,
            },
            executionMode: "optional",
          },
        ],
        textRef: [0, 1],
        condition: [
          {
            kind: "field_all_match",
            player: "self",
            filter: {
              colors: ["black"],
              colorCount: "mono",
              targetsGrandwalker: true,
              targetsGrandstone: true,
            },
          },
          {
            kind: "no_contract_card",
            player: "self",
          },
        ],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "self",
              },
              properties: {
                excludeCategory: "spirit",
              },
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
    cardNo: "BSTH10-C03",
    orikaId: 584,
    name: "[奇跡の現人神]東風谷 早苗",
    printedCategory: "spirit",
    colors: ["black"],
    cost: 3,
    reductionSymbols: ["black", "black"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 2000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 4000,
      },
    ],
    symbolColors: ["black"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。そうしたとき、自分の手札2枚をオープンする。それら5枚のカードの状態により以下の効果を発揮する。オープンしたカードは、デッキからならデッキの下に戻し、手札からなら手札に戻す。",
      "同じコスト1組：ボイドからコア1個を自分のトラッシュに置く。",
      "同じコスト2組：ボイドからコア1個ずつを自分のリザーブ/トラッシュに置く。",
      "同じコスト3枚：ボイドからコア1個を自分のリザーブに置き、自分はデッキの上から1枚ドローする。",
      "5枚すべて連続した異なるコスト：ボイドからコア2個を自分のリザーブに置き、自分はデッキの上から2枚ドローする。",
    ],
    keywordTags: [],
    tribe: "幻想・風神",
    image: "images/BSTH10-C03.webp",
    rarity: "C",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        textRef: [0, 1, 2, 3, 4, 5],
        steps: [
          {
            id: "opened",
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [],
              remainder: "bottom",
              beforePickSteps: [
                {
                  id: "hand-opened",
                  action: {
                    kind: "reveal_hand",
                    player: "self",
                    revealTo: "both",
                    open: true,
                    target: {
                      kind: "filter",
                      player: "self",
                      zone: "hand",
                      filter: {},
                      count: 2,
                    },
                  },
                  targetSelectionTiming: "on_step",
                },
                {
                  action: {
                    kind: "core_move",
                    from: {
                      kind: "void",
                      player: "self",
                    },
                    to: {
                      kind: "trash",
                      player: "self",
                    },
                    amount: 1,
                  },
                  stepCondition: {
                    kind: "ref_cost_pattern",
                    stepIds: ["opened", "hand-opened"],
                    patterns: [
                      {
                        groups: [2],
                      },
                      {
                        groups: [2, 2],
                      },
                      {
                        groups: [3],
                      },
                      {
                        consecutive: 5,
                      },
                    ],
                    matchIndex: 0,
                  },
                },
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
                    amount: 1,
                  },
                  stepCondition: {
                    kind: "ref_cost_pattern",
                    stepIds: ["opened", "hand-opened"],
                    patterns: [
                      {
                        groups: [2],
                      },
                      {
                        groups: [2, 2],
                      },
                      {
                        groups: [3],
                      },
                      {
                        consecutive: 5,
                      },
                    ],
                    matchIndex: 1,
                  },
                },
                {
                  action: {
                    kind: "core_move",
                    from: {
                      kind: "void",
                      player: "self",
                    },
                    to: {
                      kind: "trash",
                      player: "self",
                    },
                    amount: 1,
                  },
                  stepCondition: {
                    kind: "ref_cost_pattern",
                    stepIds: ["opened", "hand-opened"],
                    patterns: [
                      {
                        groups: [2],
                      },
                      {
                        groups: [2, 2],
                      },
                      {
                        groups: [3],
                      },
                      {
                        consecutive: 5,
                      },
                    ],
                    matchIndex: 1,
                  },
                },
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
                    amount: 1,
                  },
                  stepCondition: {
                    kind: "ref_cost_pattern",
                    stepIds: ["opened", "hand-opened"],
                    patterns: [
                      {
                        groups: [2],
                      },
                      {
                        groups: [2, 2],
                      },
                      {
                        groups: [3],
                      },
                      {
                        consecutive: 5,
                      },
                    ],
                    matchIndex: 2,
                  },
                },
                {
                  action: {
                    kind: "draw",
                    count: 1,
                  },
                  stepCondition: {
                    kind: "ref_cost_pattern",
                    stepIds: ["opened", "hand-opened"],
                    patterns: [
                      {
                        groups: [2],
                      },
                      {
                        groups: [2, 2],
                      },
                      {
                        groups: [3],
                      },
                      {
                        consecutive: 5,
                      },
                    ],
                    matchIndex: 2,
                  },
                },
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
                  stepCondition: {
                    kind: "ref_cost_pattern",
                    stepIds: ["opened", "hand-opened"],
                    patterns: [
                      {
                        groups: [2],
                      },
                      {
                        groups: [2, 2],
                      },
                      {
                        groups: [3],
                      },
                      {
                        consecutive: 5,
                      },
                    ],
                    matchIndex: 3,
                  },
                },
                {
                  action: {
                    kind: "draw",
                    count: 2,
                  },
                  stepCondition: {
                    kind: "ref_cost_pattern",
                    stepIds: ["opened", "hand-opened"],
                    patterns: [
                      {
                        groups: [2],
                      },
                      {
                        groups: [2, 2],
                      },
                      {
                        groups: [3],
                      },
                      {
                        consecutive: 5,
                      },
                    ],
                    matchIndex: 3,
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    cardNo: "BSTH10-C04",
    orikaId: 585,
    name: "[宇宙の魔法使い]霧雨 魔理沙",
    printedCategory: "spirit",
    colors: ["black"],
    cost: 3,
    reductionSymbols: ["black", "black"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 2000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 4000,
      },
    ],
    symbolColors: ["black"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から5枚内容を見れる。それらを好きなようにデッキの上と下に戻す。",
      "",
      "Lv1-Lv2【歪曲：赤＆スピリット】",
      "相手は、このスピリットを、赤のスピリットの効果の対象にできず、含めない。",
    ],
    keywordTags: [],
    tribe: "幻想・昊魔",
    image: "images/BSTH10-C04.webp",
    rarity: "C",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
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
              kind: "deck_reveal",
              revealCount: 5,
              revealTo: "self",
              picks: [],
              remainder: "top_bottom_split",
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
              kind: "effect_resistance",
              target: {
                kind: "self",
              },
              resistsOutcome: ["targeted", "included"],
              source: "opponent_effect",
              targetLockSourceFilter: {
                categories: ["spirit"],
                colors: ["red"],
              },
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
    cardNo: "BSTH10-M01",
    orikaId: 586,
    name: "クラウンピース",
    printedCategory: "ultimate",
    colors: ["black"],
    cost: 5,
    reductionSymbols: ["guide", "guide", "guide"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 4,
        requiredCores: 2,
        bp: 9000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 12000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "【召喚条件：自分が契約していない】",
      "",
      "このカード/アルティメットの、軽減シンボルは<七>、シンボルは黒/導としても扱う。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札にあるこのカードは召喚できる。このとき、自分の手札にある黒1色のカード1枚か、自分の手札/トラッシュにある黒1色/系統：「妖精」を持つカード3枚を除外することで、このカードのコストを3にする。",
      "",
      "Lv3-Lv4-Lv5【純化：1】『このアルティメットの召喚/アタック時』",
      "〔ターンに1回：同名〕相手のスピリット/アルティメット1体を裏向きにできる。（相手は、対象に含まれた契約カードを魂状態にでき、裏向きになったカードはコアすべてをリザーブに置き、その内容すべてを持たない。）",
    ],
    keywordTags: [],
    tribe: "妖精",
    image: "images/BSTH10-M01.webp",
    rarity: "M",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "turn_face_down",
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
        textRef: [7, 8],
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["reduction_symbol"],
              asColor: "seven",
              appliesToCard: true,
            },
          },
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: ["black", "guide"],
              appliesToCard: true,
            },
          },
        ],
        textRef: [2],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        applicability: {
          zone: "hand",
        },
        timingScope: {
          player: "both",
          period: "attack",
        },
        condition: [
          {
            kind: "no_contract_card",
            player: "self",
          },
        ],
        steps: [
          {
            id: "exile",
            label: "通常コストで召喚",
            stepCondition: {
              kind: "summon_precheck",
              target: {
                kind: "self",
                zone: "hand",
              },
              costModifier: {
                override: 3,
              },
            },
            action: {
              kind: "noop",
            },
            choice: [
              {
                label: "手札の黒1色1枚を除外",
                action: {
                  kind: "move_card",
                  target: {
                    kind: "filter",
                    player: "self",
                    zone: "hand",
                    filter: {
                      colors: ["black"],
                      colorCount: "mono",
                    },
                    count: 1,
                    excludeSelf: true,
                  },
                  from: {
                    zone: "hand",
                    player: "self",
                    filter: {
                      colors: ["black"],
                      colorCount: "mono",
                    },
                  },
                  to: {
                    zone: "removed_from_game",
                    player: "self",
                  },
                  count: 1,
                  requireFullCount: true,
                },
              },
              {
                label: "手札/トラッシュの黒1色/妖精3枚を除外",
                action: {
                  kind: "move_card",
                  target: {
                    kind: "filter",
                    player: "self",
                    zone: ["hand", "trash"],
                    filter: {
                      filterOr: [
                        {
                          colors: ["black"],
                          colorCount: "mono",
                        },
                        {
                          tribes: ["妖精"],
                        },
                      ],
                    },
                    count: 3,
                    excludeSelf: true,
                  },
                  from: {
                    zone: ["hand", "trash"],
                    player: "self",
                    filter: {
                      filterOr: [
                        {
                          colors: ["black"],
                          colorCount: "mono",
                        },
                        {
                          tribes: ["妖精"],
                        },
                      ],
                    },
                  },
                  to: {
                    zone: "removed_from_game",
                    player: "self",
                  },
                  count: 3,
                  requireFullCount: true,
                },
              },
            ],
          },
          {
            connector: "conditional_cost",
            action: {
              kind: "summon",
              target: {
                kind: "self",
                zone: "hand",
              },
              costModifier: {
                override: 3,
              },
            },
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_choice",
                  stepId: "exile",
                  choiceIndex: 0,
                  not: true,
                },
                {
                  kind: "ref_succeeded",
                  stepId: "exile",
                },
              ],
            },
          },
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
                zone: "hand",
              },
            },
            stepCondition: {
              kind: "ref_choice",
              stepId: "exile",
              choiceIndex: 0,
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
    summonCondition: [
      {
        kind: "no_contract_card",
        player: "self",
      },
    ],
  },
  {
    cardNo: "BSTH10-M02",
    orikaId: 595,
    name: "ドレミー・スイート",
    printedCategory: "ultimate",
    colors: ["black"],
    cost: 5,
    reductionSymbols: ["black", "black", "black"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 4,
        requiredCores: 2,
        bp: 9000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 12000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "【召喚条件：自分が契約していない】",
      "",
      "〔ゲームに1回：同名〕手札/トラッシュにあるこのカードは、系統：「幻想」/「月人」/「神霊」/「妖精」を持つ自分の黒のスピリット/アルティメットが相手の効果でフィールドを離れたとき、軽減シンボルすべてを満たして召喚できる。",
      "",
      "Lv3-Lv4-Lv5【純化：1+】『このアルティメットの召喚時』",
      "相手のスピリット/アルティメット1体を裏向きにできる。効果で召喚していたとき、この効果の対象を+1できる。（相手は、対象に含まれた契約カードを魂状態にでき、裏向きになったカードは、コアすべてをリザーブに置き、その内容すべてを持たない。）",
    ],
    keywordTags: [],
    tribe: "幻想・獏",
    image: "images/BSTH10-M02.webp",
    rarity: "M",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
    effects: [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          afterPhysicalLeave: true,
          cause: "opponent_effect",
          triggerFilter: {
            category: ["spirit", "ultimate"],
            colors: ["black"],
            tribes: ["幻想", "月人", "神霊", "妖精"],
          },
        },
        applicability: {
          zone: ["hand", "trash"],
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "game",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
                zone: ["hand", "trash"],
              },
              costModifier: "full_reduction",
            },
          },
        ],
        textRef: [2],
      },
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "turn_face_down",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
            },
            label: "相手1体を純化",
            choice: [
              {
                label: "効果で召喚したため相手2体を純化",
                condition: [
                  {
                    kind: "trigger_cause",
                    causes: ["self_effect", "opponent_effect"],
                  },
                ],
                action: {
                  kind: "turn_face_down",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: {
                      category: ["spirit", "ultimate"],
                    },
                    count: 2,
                  },
                },
              },
            ],
          },
        ],
        textRef: [4, 5],
      },
    ],
    summonCondition: [
      {
        kind: "no_contract_card",
        player: "self",
      },
    ],
  },
  {
    cardNo: "BSTH10-R01",
    orikaId: 587,
    name: "[浅葱色のイーグルラヴィ]清蘭",
    printedCategory: "ultimate",
    colors: ["black"],
    cost: 4,
    reductionSymbols: ["black", "black"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 5000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 8000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 10000,
      },
    ],
    symbolColors: ["black"],
    textLines: [
      "【召喚条件：自分が契約していない】",
      "",
      "Lv3-Lv4-Lv5【純化：１／コスト4以下】『このアルティメットの召喚時』",
      "コスト4以下の相手のスピリット/アルティメット1体を裏向きにできる。（相手は、対象に含まれた契約カードを魂状態にでき、裏向きになったカードはコアすべてをリザーブに置き、その内容すべてを持たない。）",
      "",
      "Lv3-Lv4-Lv5",
      "お互い、1コスト支払わなければ、黒1色ではない『このスピリット/アルティメットの召喚/アタック時』効果を発揮できない。",
      "",
      "Lv3-Lv4-Lv5",
      "このアルティメットのシンボルは黒としても扱う。",
    ],
    keywordTags: [],
    tribe: "月人・玄影",
    image: "images/BSTH10-R01.webp",
    rarity: "R",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
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
              kind: "turn_face_down",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxCost: 4,
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [2, 3],
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
              asColor: "black",
            },
          },
        ],
        textRef: [8, 9],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "require_effect_cost",
              player: "either",
              amount: 1,
              events: ["summon", "attack"],
              categories: ["spirit", "ultimate"],
              sourceFilter: {
                exclude: {
                  colors: ["black"],
                  colorCount: "mono",
                },
              },
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
    summonCondition: [
      {
        kind: "no_contract_card",
        player: "self",
      },
    ],
  },
  {
    cardNo: "BSTH10-R02",
    orikaId: 588,
    name: "[橘色のイーグルラヴィ]鈴瑚",
    printedCategory: "ultimate",
    colors: ["black"],
    cost: 4,
    reductionSymbols: ["black", "black", "black"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 5000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 9000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 10000,
      },
    ],
    symbolColors: ["black"],
    textLines: [
      "【召喚条件：自分が契約していない】",
      "",
      "Lv3-Lv4-Lv5『このアルティメットの召喚時』",
      "自分のフィールドが黒1色のとき、自分のデッキを上から4枚内容を見れる。その中のカード2枚までを手札/手元と入れ替えられる。内容を見たカードはデッキの下に戻す。",
      "",
      "Lv3-Lv4-Lv5",
      "〔重複不可〕お互い、2コスト支払わなければ、黒1色ではない『このスピリット/ネクサスの煌臨/配置時』効果を発揮できない。",
      "",
      "Lv3-Lv4-Lv5",
      "このアルティメットのシンボルは黒としても扱う。",
    ],
    keywordTags: [],
    tribe: "月人・霄獣",
    image: "images/BSTH10-R02.webp",
    rarity: "R",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
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
              kind: "deck_reveal",
              revealCount: 4,
              revealTo: "self",
              picks: [
                {
                  count: 2,
                  destination: "hand_or_set_aside_swap",
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [2, 3],
        condition: [
          {
            kind: "field_all_match",
            player: "self",
            filter: {
              colors: ["black"],
              colorCount: "mono",
              targetsGrandwalker: true,
              targetsGrandstone: true,
            },
          },
        ],
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
              asColor: "black",
            },
          },
        ],
        textRef: [8, 9],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "require_effect_cost",
              player: "either",
              amount: 2,
              events: ["advent", "place"],
              categories: ["spirit", "nexus"],
              sourceFilter: {
                exclude: {
                  colors: ["black"],
                  colorCount: "mono",
                },
              },
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [5, 6],
        usageLimit: {
          kind: "no_duplicate",
        },
      },
    ],
    summonCondition: [
      {
        kind: "no_contract_card",
        player: "self",
      },
    ],
  },
  {
    cardNo: "BSTH10-R03",
    orikaId: 589,
    name: "「最初で最後の無名の弾幕」",
    printedCategory: "magic",
    colors: ["black"],
    cost: 4,
    reductionSymbols: ["black", "black"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "自分の黒の効果でデッキからオープンされた/トラッシュに置かれたこのカードは手札に加えられる。トラッシュから手札に加えたとき、自分の黒の創界神ネクサス/導界者ネクサスにコア+1できる。",
      "",
      "フラッシュ",
      "〔アタックステップ〕自分が契約していなければ、自分の手札/手元/トラッシュにある黒のネクサスカード1枚をコストを支払わずに配置できる。この効果で創界神ネクサス/導界者ネクサスを配置したとき、対象がLv2になるようにコアを+できる。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH10-R03.webp",
    rarity: "R",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["revealed", "moved_to_trash"],
        },
        cardEventDisposition: {
          kind: "move",
          destination: "hand",
        },
        executionMode: "optional",
        condition: [
          {
            kind: "trigger_source_player",
            player: "self",
          },
          {
            kind: "trigger_colors",
            colors: ["black"],
          },
          {
            // 「デッキから」の到着元は、手札扱いの対象選択中でも物理ゾーンで判定する。
            // deck_reveal 後の revealed → trash は Q16858 と同じく含めない。
            kind: "trigger_physical_from_zone",
            zones: ["deck"],
          },
        ],
        steps: [
          {
            action: {
              kind: "move_self",
              destination: "hand",
            },
          },
          {
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  colors: ["black"],
                  targetsGrandwalker: "only",
                  grandwalkerKind: "any",
                },
              },
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["nexus"],
                  colors: ["black"],
                  targetsGrandwalker: "only",
                  grandwalkerKind: "any",
                },
                count: 1,
              },
              amount: 1,
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        condition: [
          {
            kind: "no_contract_card",
            player: "self",
          },
        ],
        timingScope: {
          player: "both",
          period: "attack",
        },
        steps: [
          {
            id: "placed",
            executionMode: "optional",
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "set_aside", "trash"],
                filter: {
                  category: ["nexus"],
                  colors: ["black"],
                },
                count: 1,
              },
              costModifier: "free",
            },
          },
          {
            executionMode: "optional",
            connector: "conditional_result",
            action: {
              kind: "core_set_to_level",
              from: {
                kind: "void",
                player: "self",
              },
              target: {
                kind: "filter",
                player: "self",
                stepId: "placed",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                  grandwalkerKind: "any",
                },
                count: 1,
              },
              level: 2,
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH10-X01",
    orikaId: 590,
    name: "[創界神]ヘカーティア・ラピスラズリ",
    printedCategory: "nexus",
    colors: ["black"],
    cost: 2,
    reductionSymbols: ["black"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
      },
      {
        level: 2,
        requiredCores: 3,
      },
    ],
    symbolColors: ["black", "god"],
    symbolColorEntries: [["black", "god"]],
    textLines: [
      "【神託：〔黒1色〕〔黒1色＆アルティメット/ネクサス〕】",
      "◆対象の自分のスピリット/アルティメット/ネクサスを召喚/煌臨/配置したとき、このネクサスにコア+1できる。",
      "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきこのネクサスにコア+1する。",
      "",
      "【神技：5】【純化：１／+ネクサス】Lv1-Lv2：フラッシュ",
      "〔ターンに1回、このネクサスのコア-5する〕相手のスピリット/アルティメット/ネクサス1つを裏向きにできる。",
      "",
      "【神域】Lv2",
      "自分が契約しておらず、自分のフィールドが黒1色の間、自分のデッキの上から3枚を表向きにする。自分はそれらの中の系統：「幻想」/「玄影」/「霄獣」/「妖精」/「神霊」/「創界神」/「導界者」を持つカードを召喚/配置/使用/セットでき、それらのカードは、自分の効果で、手札にあるものとして扱える。（上3枚ではなくなったデッキのカードはただちに裏向きにする）",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    tribe: "創界神・幻想",
    image: "images/BSTH10-X01.webp",
    rarity: "X",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          level: {
            min: 2,
          },
        },
        condition: [
          {
            kind: "no_contract_card",
            player: "self",
          },
          {
            kind: "field_all_match",
            player: "self",
            filter: {
              colors: ["black"],
              colorCount: "mono",
              targetsGrandwalker: true,
              targetsGrandstone: true,
            },
          },
        ],
        steps: [
          {
            action: {
              kind: "grant_deck_hand_access",
              player: "self",
              count: 3,
              filter: {
                tribes: [
                  "幻想",
                  "玄影",
                  "霄獣",
                  "妖精",
                  "神霊",
                  "創界神",
                  "導界者",
                ],
              },
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
    grandwalkerData: {
      kind: "grandwalker",
      oracleConditions: [
        {
          colors: ["black"],
          colorCount: "mono",
          categories: ["spirit", "ultimate", "nexus"],
        },
      ],
      oracleTriggerKinds: ["summon", "advent", "place"],
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 5,
          timing: "flash",
          turnLimit: "once",
          minLevel: 1,
          effects: [
            {
              timing: {
                kind: "activated",
                mode: "flash",
              },
              executionMode: "optional",
              steps: [
                {
                  action: {
                    kind: "turn_face_down",
                    target: {
                      kind: "filter",
                      player: "opponent",
                      filter: {
                        category: ["spirit", "ultimate", "nexus"],
                      },
                      count: 1,
                    },
                  },
                  executionMode: "optional",
                },
              ],
              textRef: [4, 5],
            },
          ],
        },
      ],
    },
  },
  {
    cardNo: "BSTH10-X02",
    orikaId: 591,
    name: "純狐",
    printedCategory: "ultimate",
    colors: ["black"],
    cost: 8,
    reductionSymbols: ["black", "black", "black", "black", "black", "black"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 4,
        requiredCores: 2,
        bp: 18000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 24000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "【召喚条件：自分が契約していない】",
      "",
      "Lv3-Lv4-Lv5【歪曲：スピリット/アルティメット/ネクサス】",
      "相手は、このアルティメットを、スピリット/アルティメット/ネクサスの効果の対象にできず、含めない。",
      "",
      "Lv3-Lv4-Lv5【純化：1】『このアルティメットのアタック/ブロック時』",
      "相手のスピリット/アルティメット1体を裏向きにできる。",
      "",
      "Lv4-Lv5『お互いのアタックステップ』",
      "バトル終了時、相手のスピリット/アルティメットがいれば、このアルティメットは回復できる。",
    ],
    keywordTags: [],
    tribe: "神霊",
    image: "images/BSTH10-X02.webp",
    rarity: "X",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "self",
              },
              resistsOutcome: ["targeted", "included"],
              source: "opponent_effect",
              targetLockSourceFilter: {
                categories: ["spirit", "ultimate", "nexus"],
              },
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
          event: ["attack", "block"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "turn_face_down",
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
          kind: "game_event",
          event: "battle_end",
          player: "either",
        },
        condition: [
          {
            kind: "min_level",
            value: 4,
          },
          {
            kind: "field_has",
            player: "opponent",
            category: ["spirit", "ultimate"],
          },
        ],
        timingScope: {
          player: "both",
          period: "attack",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "recover",
              target: {
                kind: "self",
              },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
    summonCondition: [
      {
        kind: "no_contract_card",
        player: "self",
      },
    ],
  },
  {
    cardNo: "BSTH10-X03",
    orikaId: 592,
    name: "[創界神]稀神 サグメ",
    printedCategory: "nexus",
    colors: ["black"],
    cost: 2,
    reductionSymbols: ["black"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
      },
      {
        level: 2,
        requiredCores: 5,
      },
    ],
    symbolColors: ["black", "god"],
    symbolColorEntries: [["black", "god"]],
    textLines: [
      "【神託：〔月人＆アルティメット〕〔黒1色＆スピリット/アルティメット〕】",
      "◆対象の自分のスピリット/アルティメットを召喚/煌臨したとき、このネクサスにコア+1できる。",
      "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきこのネクサスにコア+1する。",
      "",
      "【神技：3】Lv1-Lv2 フラッシュ",
      "〔ステップに1回、このネクサスのコア-3する〕自分が契約していなければ、系統:「幻想」/「月人」/「神霊」/「獏」/「妖精」を持つ自分のスピリット/アルティメット1体を回復させる。",
      "",
      "【神域】Lv2『自分のスタートステップ』",
      "系統：「月人」/「神霊」/「獏」を持つ自分のアルティメットがいるとき、自分が契約していなければ、このステップ終了後、自分は追加でアタックステップを行う。追加したステップ終了後、自分のコアステップになる。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    tribe: "創界神・神霊",
    image: "images/BSTH10-X03.webp",
    rarity: "X",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
    effects: [
      {
        timing: {
          kind: "phase",
          step: "start",
          whose: "self",
        },
        applicability: { level: { min: 2 } },
        condition: [
          {
            kind: "no_contract_card",
            player: "self",
          },
          {
            kind: "field_has",
            player: "self",
            category: ["ultimate"],
            tribes: ["月人", "神霊", "獏"],
          },
        ],
        steps: [
          {
            action: {
              kind: "grant_extra_steps",
              steps: ["attack"],
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
    grandwalkerData: {
      kind: "grandwalker",
      oracleConditions: [
        {
          tribes: ["月人"],
          categories: ["ultimate"],
        },
        {
          colors: ["black"],
          colorCount: "mono",
          categories: ["spirit", "ultimate"],
        },
      ],
      oracleTriggerKinds: ["summon", "advent"],
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 3,
          timing: "flash",
          minLevel: 1,
          usageLimit: {
            kind: "per_instance",
            duration: "step",
          },
          effects: [
            {
              timing: {
                kind: "activated",
                mode: "flash",
              },
              condition: [
                {
                  kind: "no_contract_card",
                  player: "self",
                },
              ],
              steps: [
                {
                  action: {
                    kind: "recover",
                    target: {
                      kind: "filter",
                      player: "self",
                      filter: {
                        category: ["spirit", "ultimate"],
                        tribes: ["幻想", "月人", "神霊", "獏", "妖精"],
                      },
                      count: 1,
                    },
                  },
                },
              ],
              textRef: [4, 5],
            },
          ],
        },
      ],
    },
  },
  {
    cardNo: "BSTH10-X04",
    orikaId: 593,
    name: "[創界神]ドレミー・スイート",
    printedCategory: "nexus",
    colors: ["black"],
    cost: 2,
    reductionSymbols: ["black"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
      },
      {
        level: 2,
        requiredCores: 3,
      },
    ],
    symbolColors: ["black", "god"],
    symbolColorEntries: [["black", "god"]],
    textLines: [
      "【神託：〔月人＆アルティメット〕〔黒1色＆スピリット/アルティメット〕】",
      "◆対象の自分のスピリット/アルティメットを召喚/煌臨したとき、このネクサスにコア+1できる。",
      "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきこのネクサスにコア+1する。",
      "",
      "【神技：3】Lv1-Lv2『自分のメインステップ』",
      "〔ターンに1回：同名〕〔このネクサスのコア-3する〕自分のデッキを上から3枚内容を見れる。その中のカード1枚までを手札/手元と入れ替える。内容を見たカードは好きなようにデッキの上と下に戻す。その後、このステップの間、自分のスピリット/アルティメット/創界神ネクサスすべてに黒のシンボル1つずつを追加する。",
      "",
      "【神域】Lv2『お互いのエンドステップ』",
      "お互い、デッキの上を含まない手札が6枚以上なら、デッキの上を含まない手札が5枚になるように破棄する。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    tribe: "創界神・獏",
    image: "images/BSTH10-X04.webp",
    rarity: "X",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
    effects: [
      {
        timing: {
          kind: "phase",
          step: "end",
          whose: "either",
        },
        applicability: { level: { min: 2 } },
        steps: [
          {
            action: {
              kind: "discard",
              player: "self",
              count: 0,
              targetHandSize: 5,
              physicalHandOnly: true,
            },
          },
          {
            action: {
              kind: "discard",
              player: "opponent",
              count: 0,
              targetHandSize: 5,
              physicalHandOnly: true,
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
    grandwalkerData: {
      kind: "grandwalker",
      oracleConditions: [
        {
          tribes: ["月人"],
          categories: ["ultimate"],
        },
        {
          colors: ["black"],
          colorCount: "mono",
          categories: ["spirit", "ultimate"],
        },
      ],
      oracleTriggerKinds: ["summon", "advent"],
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 3,
          timing: "main",
          turnLimit: "once_per_name",
          minLevel: 1,
          effects: [
            {
              timing: {
                kind: "activated",
                mode: "main",
              },
              steps: [
                {
                  action: {
                    kind: "deck_reveal",
                    revealCount: 3,
                    revealTo: "self",
                    picks: [
                      {
                        count: 1,
                        destination: "hand_or_set_aside_swap",
                      },
                    ],
                    remainder: "top_bottom_split",
                  },
                  executionMode: "optional",
                },
                {
                  action: {
                    kind: "symbol_add",
                    symbol: "black",
                    target: {
                      kind: "filter",
                      player: "self",
                      filter: {
                        filterOr: [
                          {
                            category: ["spirit", "ultimate"],
                          },
                          {
                            category: ["nexus"],
                            targetsGrandwalker: "only",
                          },
                        ],
                      },
                      count: "all",
                    },
                    duration: {
                      scope: "step",
                    },
                  },
                  connector: "sequential",
                },
              ],
              textRef: [4, 5],
            },
          ],
        },
      ],
    },
  },
  {
    cardNo: "BSTH10-X05",
    orikaId: 594,
    name: "ヘカーティア・ラピスラズリ",
    printedCategory: "ultimate",
    colors: ["black"],
    cost: 6,
    reductionSymbols: ["black", "black", "black", "black", "black"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 4,
        requiredCores: 2,
        bp: 12000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 18000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "フラッシュ【現界：黒1色＆創界神ネクサス『お互いのアタックステップ』】",
      "自分の対象があるとき、自分の《ソウルコア》をトラッシュに置くことで、手札から出す。",
      "",
      "【召喚／現界条件：自分が契約していない】",
      "",
      "Lv3-Lv4-Lv5【歪曲：マジック/ネクサス】",
      "相手は、このアルティメットを、マジック/ネクサスの効果の対象にできず、含めない。",
      "",
      "Lv4-Lv5『お互いのアタックステップ』",
      "〔重複不可〕系統：「幻想」/「神霊」/「妖精」を持つコスト5以上で黒1色の自分のアルティメットすべてに黒のシンボル1つずつを追加し、相手は、相手のスピリット/アルティメット1体をデッキの下に戻さなければ、アタック/ブロックできない。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH10-X05.webp",
    rarity: "X",
    pack: "BSTH10 東方紺珠伝",
    maxDeckCount: 3,
    sourceUrls: ["manual/ai-reference/00_meta/source-findings-bsth10.md"],
    sourceConfidence: "A",
    effects: [
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: {
          player: "both",
          period: "attack",
        },
        applicability: {
          zone: "hand",
        },
        condition: [
          {
            kind: "no_contract_card",
            player: "self",
          },
          {
            kind: "field_has",
            player: "self",
            category: ["nexus"],
            grandwalkerKind: "grandwalker",
            colors: ["black"],
            colorCount: "mono",
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "union",
                sources: [
                  {
                    kind: "field",
                    player: "self",
                    includeReserve: true,
                  },
                  {
                    kind: "life",
                    player: "self",
                  },
                ],
              },
              to: {
                kind: "trash",
                player: "self",
              },
              amount: "all",
              effectKind: "explicit_soul_core",
              requireFullCount: true,
            },
          },
          {
            action: {
              kind: "put",
              target: {
                kind: "self",
              },
              costModifier: "free",
              effectScope: "genkai",
            },
            connector: "conditional_cost",
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
              kind: "effect_resistance",
              target: {
                kind: "self",
              },
              resistsOutcome: ["targeted", "included"],
              source: "opponent_effect",
              targetLockSourceFilter: {
                categories: ["magic", "nexus"],
              },
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [5, 6],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "symbol_add",
              symbol: "black",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["ultimate"],
                  tribes: ["幻想", "神霊", "妖精"],
                  minCost: 5,
                  colors: ["black"],
                  colorCount: "mono",
                },
                count: "all",
              },
              duration: {
                scope: "while_on_field",
              },
            },
          },
          {
            action: {
              kind: "require_battle_destroy_cost",
              destination: "deck_bottom",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {},
                count: "all",
              },
              restriction: ["attack", "block"],
              costTargetFilter: {
                category: ["spirit", "ultimate"],
              },
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [8, 9],
        condition: [
          {
            kind: "min_level",
            value: 4,
          },
        ],
        timingScope: {
          player: "both",
          period: "attack",
        },
        usageLimit: {
          kind: "no_duplicate",
        },
      },
    ],
    summonCondition: [
      {
        kind: "no_contract_card",
        player: "self",
      },
    ],
  },
];
