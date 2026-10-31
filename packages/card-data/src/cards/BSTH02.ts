import type { CardDefinition } from "@orica/rules-core";

export const BSTH02_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH02-C01",
    orikaId: 79,
    orikaIndex: 72,
    name: "リリーホワイト",
    printedCategory: "spirit",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 1,
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
        bp: 2000,
      },
    ],
    symbolColors: ["guide"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "このスピリットの召喚で【導託】していないとき、ボイドからコア1個を自分の導界者ネクサスに置ける。この効果はターンに1回しか使えない。",
      "",
      "Lv1-Lv2",
      "このスピリットのシンボルは、赤/紫/緑/白/黄/青としても扱う。",
      "",
      "Lv2『このスピリットのアタック時』",
      "手札にある系統：「妖精」を持つコスト3以下のカード1枚をコストを支払わずに召喚できる。",
    ],
    keywordTags: [],
    tribe: "幻想・妖精",
    image: "images/BSTH02-C01.webp",
    rarity: "C",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        // 「このスピリットの召喚で【導託】していないとき」= このスピリットの召喚が
        // 自分のいずれの導界者ネクサスの神託も発火させない場合限定 (oracle_would_trigger,
        // oracle-system.wouldQueueOracleChoices が SSOT)。
        condition: [
          {
            kind: "oracle_would_trigger",
            triggerKind: "summon",
            negate: true,
          },
        ],
        executionMode: "optional",
        usageLimit: {
          kind: "per_card_name",
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
              // 「自分の導界者ネクサスに」= targetsGrandwalker で創界神/導界者ネクサスの
              // 既定除外を外した上で、hasMechanic:["guided"] (grandwalkerKindMatches SSOT)
              // で導界者ネクサス限定に絞る (創界神ネクサスは除外)。
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: true,
                  hasMechanic: ["guided"],
                },
              },
              amount: 1,
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
              asColor: ["red", "purple", "green", "white", "yellow", "blue"],
            },
          },
        ],
        textRef: [3, 4],
      },
      // 手札の系統:「妖精」コスト3以下1枚をコストを支払わずに召喚。summon(from_zone) +
      // costModifier:"free" は BSFT01-C04 effects[2]「手札の鍵ブレイヴ1枚コストなし召喚」と同型 SSOT
      // (ENGINE-from-zone-summon-target-selection 経由で複数候補時プレイヤー選択に乗る)。
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
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  tribes: ["妖精"],
                  maxCost: 3,
                },
                count: 1,
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH02-C02",
    orikaId: 80,
    orikaIndex: 73,
    name: "レティ・ホワイトロック",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white", "guide"],
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
      "このカードの軽減シンボル<白>は紫としても扱う。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の紫/白の導界者ネクサスカード1枚と、系統：「幻想」を持つ紫/白のスピリットカード1枚か、系統：「幻想」と「冥主」を持つカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2",
      "このスピリットのシンボルは紫としても扱う。相手がバースト効果以外の効果でスピリットカードを召喚するとき、3コスト余分に支払わなければ召喚できない。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・冥主",
    image: "images/BSTH02-C02.webp",
    rarity: "C",
    pack: "BSTH02 東方妖々夢",
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
              aspects: ["reduction_symbol"],
              asColor: "purple",
              reductionSymbolBaseColors: ["white"],
              appliesToCard: true,
              cardStateOnly: true,
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
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    colors: ["purple", "white"],
                    tribes: ["導界者"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    filterOr: [
                      {
                        category: ["spirit"],
                        colors: ["purple", "white"],
                        tribes: ["幻想"],
                      },
                      {
                        tribes: ["幻想", "冥主"],
                        tribesLogic: "and",
                      },
                    ],
                  },
                },
              ],
              remainder: "bottom",
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
              asColor: "purple",
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
              kind: "cost_modify",
              player: "opponent",
              additionalPayment: true,
              cardFilter: {
                category: ["spirit"],
                summonCause: ["effect"],
              },
              modifier: {
                additionalCostValue: 3,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH02-C03",
    orikaId: 81,
    orikaIndex: 74,
    name: "橙",
    printedCategory: "spirit",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 3,
    reductionSymbols: ["guide"],
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
    symbolColors: ["guide"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキを上から4枚オープンできる。その中の系統：「妖戒」を持つスピリットカード2枚、または、1コスト支払うことでネクサスカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv2",
      "系統：「幻想」と「妖戒」を持つコスト4以下のスピリットすべては、自分が【煌臨】するとき、コスト5としても扱う。",
    ],
    keywordTags: ["advent"],
    tribe: "幻想・妖戒",
    image: "images/BSTH02-C03.webp",
    rarity: "C",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 確定裁定 2026-07-12: 公開内容を見てから二択。公開自体は任意。
      // 07c_card-observed-mechanics-extra.md。霖之助の「2枚まで」は0枚でも支払う。
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        steps: [
          {
            id: "reveal",
            action: {
              kind: "deck_reveal",
              revealCount: 4,
              picks: [],
              beforePickSteps: [
                {
                  id: "mode",
                  label: "妖戒スピリット2枚を手札に加える",
                  targetSelectionTiming: "on_step",
                  action: {
                    kind: "move_card",
                    target: {
                      kind: "filter",
                      player: "self",
                      zone: "revealed",
                      stepId: "reveal",
                      filter: {
                        category: ["spirit"],
                        tribes: ["妖戒"],
                      },
                      count: 2,
                    },
                    from: {
                      zone: "revealed",
                      player: "self",
                    },
                    to: {
                      zone: "hand",
                    },
                    count: "all",
                  },
                  choice: [
                    {
                      label: "1コスト支払ってネクサス1枚を手札に加える",
                      action: {
                        kind: "pay_cost",
                        amount: 1,
                      },
                    },
                  ],
                },
                {
                  targetSelectionTiming: "on_step",
                  action: {
                    kind: "move_card",
                    target: {
                      kind: "filter",
                      player: "self",
                      zone: "revealed",
                      stepId: "reveal",
                      filter: {
                        category: ["nexus"],
                      },
                      count: 1,
                    },
                    from: {
                      zone: "revealed",
                      player: "self",
                    },
                    to: {
                      zone: "hand",
                    },
                    count: "all",
                  },
                  stepCondition: {
                    kind: "ref_choice",
                    stepId: "mode",
                    choiceIndex: 1,
                  },
                  connector: "conditional_cost",
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        // BSTH02-C03 Lv2:「系統：「幻想」と「妖戒」を持つコスト4以下のスピリットすべては、
        // 自分が【煌臨】するとき、コスト5としても扱う」。advent_cost_override (P3-105後判定
        // audit-open BSTH02-C03) = AdventCondition.minCost 判定専用の対象限定コスト付与。
        // additional_cost (自分自身・全コスト判定に影響) と異なり target filter で
        // 自分以外のカード群へも付与でき、煌臨条件以外のコスト判定には波及しない。
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
              kind: "advent_cost_override",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["幻想", "妖戒"],
                  tribesLogic: "and",
                  maxCost: 4,
                },
                count: "all",
              },
              costTreatedAs: 5,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH02-C21",
    orikaId: 82,
    orikaIndex: 75,
    name: "白玉楼",
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
        requiredCores: 3,
        bp: 0,
      },
    ],
    symbolColors: ["purple", "purple"],
    textLines: [
      "このカードは、系統：「幻想」/「冥主」を持つ。",
      "",
      "Lv1-Lv2『自分のドローステップ』",
      "手札にある系統：「幻想」を持つ紫のカードか、系統：「幻想」/「導界者」と「冥主」を持つカード1枚を破棄することで、ドローの枚数を+2する。",
      "",
      "Lv2",
      "自分の「西行妖」があるとき、相手のネクサスと、ゲーム中にコア1個以上を置かれた相手の創界神ネクサスのLv1コストを1にする。",
    ],
    keywordTags: [],
    tribe: "幻想・冥主",
    image: "images/BSTH02-C21.webp",
    rarity: "C",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        executionMode: "optional",
        // 発動コストが手札破棄（系統「幻想」の紫カード OR 系統「幻想」/「導界者」かつ「冥主」の
        // カード、フィルタ2枝のOR）。SSOT 流用: BSSL01-C03 effects[1]（コスト先払い型ドロー枚数
        // 修正、10_rules/02 §コスト先払い型ドロー枚数修正 model A）と同型の
        // inline + draw_modify.prepaidCost パターン。2枝OR は CardFilter.filterOr
        // （matchesCardFilter 側で解決、card-filter.ts:272 既存機構）で新規primitiveゼロ。
        timing: {
          kind: "phase",
          step: "draw",
          whose: "self",
          subPhase: "start",
        },
        inline: true,
        steps: [
          {
            action: {
              kind: "draw_modify",
              amount: 2,
              duration: {
                scope: "step",
                step: "draw",
              },
              prepaidCost: {
                kind: "discard_hand",
                cardFilter: {
                  filterOr: [
                    { colors: ["purple"], tribes: ["幻想"] },
                    {
                      tribes: ["幻想", "導界者"],
                      tribesLogic: "or",
                      tribesRequired: ["冥主"],
                    },
                  ],
                },
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        // Lv2「自分の『西行妖』があるとき」= field_has(self, cardNames:「」部分一致)。
        // 「Lv1コスト」は 10_rules/03a_cost-payment.md §「Lvコスト」の対象フィルタとしての
        // 用法 (levelDefs[0].requiredCores、召喚/使用コスト card.cost とは別概念) の SSOT に
        // 従い、override_properties.levelCost で levelDefs[0].requiredCores を上書きする
        // (engine-bsth02-c21-cumulative-core-cost-fix)。「相手のネクサス」と「ゲーム中に
        // コア1個以上を置かれた相手の創界神ネクサス」を 2 branch の target:{kind:"filter"} で
        // 表現する:
        // - branch1: category:["nexus"] のみ。matchesCardFilter の既定除外
        //   (targetsGrandwalker 未指定時は場の創界神/導界者ネクサスを対象から外す) により、
        //   通常ネクサスのみが対象になる（原文の「相手のネクサス」= 創界神を含まないスコープ）。
        // - branch2: targetsGrandwalker:"only" + everHadCorePlaced:true (grandwalkerKind は
        //   指定しない="any"、導界者ネクサスも対象に含める)。[P3-134修正 2026-08-02]
        //   qa-002 (external-qa/qaData.js)「このネクサス/スピリット/アルティメットは導界者
        //   ネクサス/創界神ネクサス対象の効果しか受けない」＋「創界神ネクサスのコア1個を
        //   このスピリットに置く、などの効果を受けますが、『創界神ネクサスにコア+1する』
        //   などの効果でコアを置けず、『創界神ネクサスがあるとき』などの効果で創界神
        //   ネクサスとして数えられません」により、コア供給系(+N付与)/存在条件以外の
        //   「創界神ネクサス対象」効果（本branchのLv1コスト書き換えを含む）は導界者ネクサスも
        //   受ける。以前の `grandwalkerKind:"grandwalker"` 絞り込みは印字テキストが
        //   「導界者ネクサス」を含まないという字面一致だけで確定した誤り（旧issue P3-134参照）。
        //   `CardInstance.everHadCorePlaced`（コア配置の一方向ラッチ、
        //   updateNormalCoreCountAtLocation/updateSoulCoreCountAtLocation が更新）で
        //   「ゲーム中にコア1個以上を置かれた」を判定する。
        //
        // 両 branch とも count:"all" filter target の動的メンバーシップ CE 経路
        // (executeOverrideProperties の isAllScopeFilter+dynamicKeys、levelCost も対象)
        // を使う。登録時点で既に一致する対象が存在する場合も targetFilter ベースの
        // global CE として保持し、以後の新規対象にも追従する (P3-124)。
        timing: {
          kind: "continuous",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "西行妖" }],
          },
        ],
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"] },
                count: "all",
              },
              properties: { levelCost: { lv1: 1 } },
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                  everHadCorePlaced: true,
                },
                count: "all",
              },
              properties: { levelCost: { lv1: 1 } },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH02-M01",
    orikaId: 84,
    orikaIndex: 76,
    name: "[妖々夢]十六夜 咲夜",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: ["purple", "purple", "purple"],
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
        bp: 12000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "トラッシュに置かれたこのカードは除外する。",
      "",
      "【バースト：相手のスピリット／アルティメットのアタック後】",
      "自分の手札にある系統：「冥主」を持つカード1枚を破棄することで、自分のターンを行う。ただし、追加したターンで『コアステップ』、『アタックステップ』は行えない。この効果は相手のライフが3以下か、自分のフィールドにカードが3枚以上あれば発揮できず、『相手のアタックステップ』でしか発揮できない。追加したターン終了時、『相手のアタックステップ』のバトル中に戻る。このバースト効果はゲーム中に1回しか使えない。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・冥主・紅魔",
    image: "images/BSTH02-M01.webp",
    rarity: "M",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // 「除外する」終止形=強制。card_event 系 default 非対称 (revealed=optional /
        // moved_to_trash=mandatory) 回避のため per-effect 明示 (10_rules/03c ruling C 2026-06-24)。
        timing: {
          kind: "card_event",
          event: "moved_to_trash",
        },
        executionMode: "mandatory",
        steps: [
          {
            action: {
              kind: "remove_from_game",
              target: { kind: "self" },
            },
          },
        ],
        textRef: [0],
      },
      {
        executionMode: "optional",
        // P3-63: 追加ターン burst の DSL 化。
        // condition: 相手ライフ4以上 & 自フィールド2枚以下。
        //   「相手のアタックステップでしか発揮できない」は burst event_kind
        //   `attack_after` が attack step でしか発火しないため registration 側で担保。
        // step 0 (cost): 冥主カード 1 枚を手札から破棄。
        // step 1 (effect, conditional_cost): grant_extra_turn (skip core/attack,
        //   returnPoint=previous_attack_battle で相手のアタックステップのバトル中に戻る)。
        timing: {
          kind: "burst",
          trigger: "相手のスピリット／アルティメットのアタック後",
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "game",
        },
        condition: [
          { kind: "life_value", player: "opponent", min: 4 },
          { kind: "field_card_count", player: "self", max: 2 },
        ],
        steps: [
          {
            id: "cost",
            action: {
              kind: "discard",
              player: "self",
              fromZone: "hand",
              count: 1,
              filter: {
                tribes: ["冥主"],
              },
            },
          },
          {
            id: "effect",
            action: {
              kind: "grant_extra_turn",
              player: "self",
              skipSteps: ["core", "attack"],
              returnPoint: "previous_attack_battle",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH02-M02",
    orikaId: 85,
    orikaIndex: 77,
    name: "[妖々夢]アリス・マーガトロイド",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 7,
    reductionSymbols: [
      "yellow",
      "yellow",
      "yellow",
      "purple",
      "purple",
      "purple",
    ],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 8000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 11000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "【バースト：相手の効果によって相手の手札が増えた後】",
      "相手の手札が6枚以上のとき、相手は手札をすべて破棄し、2枚ドローする。5枚以下のとき、自分はデッキから3枚ドローする。この効果で相手の効果は発揮されない。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットは相手のスピリット/ネクサスの効果を受けない。",
      "",
      "Lv2-Lv3『お互いのアタックステップ』",
      "相手はライフのコア2個をボイドに置かなければ、バーストを発動できない。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・冥主・導魔",
    image: "images/BSTH02-M02.webp",
    rarity: "M",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：相手の効果によって相手の手札が増えた後】
      // 「相手の手札が6枚以上のとき、相手は手札をすべて破棄し、2枚ドローする。
      //  5枚以下のとき、自分はデッキから3枚ドローする。」
      // = 相手手札枚数で 2 分岐 (>=6: 全破棄+相手2ドロー / <=5: 自分3ドロー)。
      // 各分岐は排他のため、Branch A は step.condition で hand_count opponent min:6 を、
      // Branch A 内の draw は stepCondition: ref_count(discardAll, min:1) で
      // 「実際に 1 枚以上 trash に行ったとき」だけ連動させる (ref_executed では
      // prevent_hand_discard 耐性で 0 枚 discard でも log が伸びて true 化し、
      // 連言「破棄し 2 ドローする」の意味と矛盾する)。Branch B (自分3ドロー) は
      // 同じ ref_count を not:true で反転し「discard が 1 枚も起きなかった」をゲートする。
      // 最終 summon は target:self + costModifier:"free" (BSTH03-M05 等と同型の SSOT)。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "hand_increase", player: "opponent" },
          // 「相手の効果によって」= 手札が増えたプレイヤー自身の効果 (grower-relative
          // self_effect)。所有者自身のバウンス等で相手手札が増えた場合は発動しない (P3-68)。
          cause: ["self_effect"],
        },
        steps: [
          // Branch A: 相手手札 >=6 のとき、相手は手札をすべて破棄。
          {
            id: "discardAll",
            action: {
              kind: "discard",
              player: "opponent",
              count: -1,
            },
            condition: [{ kind: "hand_count", player: "opponent", min: 6 }],
          },
          // Branch A 続: 相手は 2 枚ドローする。実 discard 件数 >=1 が条件
          // (prevent_hand_discard で 0 枚化したケースを除外)。
          {
            action: {
              kind: "draw",
              count: 2,
              player: "opponent",
            },
            stepCondition: {
              kind: "ref_count",
              stepId: "discardAll",
              min: 1,
            },
            connector: "conditional_result",
          },
          // Branch B: 自分はデッキから 3 枚ドローする
          // (Branch A の discard が 1 枚も起きなかったとき = 相手手札 <=5 もしくは
          //  >=6 でも prevent_hand_discard 耐性で 0 枚化したとき)。
          {
            action: {
              kind: "draw",
              count: 3,
            },
            stepCondition: {
              kind: "ref_count",
              stepId: "discardAll",
              min: 1,
              not: true,
            },
            connector: "sequential",
          },
          // この解決に直接起因する相手の反応だけを抑止する。
          {
            action: {
              kind: "negate",
              negateTarget: "effect",
              targetController: "opponent",
              causedByThisEffect: true,
            },
            connector: "sequential",
          },
          // 同じ原因のバーストも発動後の発揮を抑止する。
          {
            action: {
              kind: "negate",
              negateTarget: "opponent_burst",
              causedByThisEffect: true,
            },
            connector: "sequential",
          },
          // その後、このカード (= バースト本体) をコストを支払わずに召喚する。
          // target:self + costModifier:"free" が canonical (BSTH03-M05 等の SSOT)。
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
      // Lv1-Lv2-Lv3 このスピリットは相手のスピリット/ネクサスの効果を受けない。
      // sourceScope.categories=["spirit","nexus"] で発生源カテゴリ限定（10_rules/03c §発生源帰属、
      // immunitySourceScope 実装）。マジック/ブレイヴ/バースト発生源は通常どおり通る。
      // 発生源は実効カテゴリ (getEffectiveCategory) で照合。
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: {
                scope: "while_on_field",
              },
              sourceScope: { categories: ["spirit", "nexus"] },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3『お互いのアタックステップ』相手はライフのコア2個をボイドに置かなければ、
      // バーストを発動できない。restrict_burst_activation の cost:{resource:"life_core",
      // amount:2} 拡張 (engine-burst-activation-paid-cost-gate)。isBurstActivationRestricted
      // が「対価 (ライフの通常コア2個) を支払えないときのみ禁止」へ資力判定し、
      // resolve_pending_burst_check 宣言時に強制支払い (life→void) する。
      {
        timing: {
          kind: "continuous",
        },
        timingScope: { player: "both", period: "attack" },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        steps: [
          {
            action: {
              kind: "restrict_burst_activation",
              player: "opponent",
              duration: { scope: "while_on_field" },
              cost: { resource: "life_core", amount: 2 },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH02-M03",
    orikaId: 86,
    orikaIndex: 78,
    name: "[妖々夢]博麗 霊夢",
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
      "このカードの軽減シンボルは紫としても扱う。",
      "",
      "【バースト：相手のスピリット／アルティメットのアタック後】",
      "相手の創界神ネクサス1つのコアすべてをボイドに置く。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "相手の創界神ネクサスのコア4個をボイドに置く。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・冥主",
    image: "images/BSTH02-M03.webp",
    rarity: "M",
    pack: "BSTH02 東方妖々夢",
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
              aspects: ["reduction_symbol"],
              asColor: "purple",
              appliesToCard: true,
              cardStateOnly: true,
            },
          },
        ],
        textRef: [0],
      },
      // 【バースト：相手のスピリット／アルティメットのアタック後】
      // 相手の創界神ネクサス1つのコアすべてをボイドに置く。その後、このカードをコストを支払わずに召喚する。
      //   単一対象 grandwalker コアシュート: target で相手の創界神ネクサス1つを選択 →
      //   from:target_card / amount:"all" で当該カード上の全コア (ソウルコア含む) を相手ボイドへ。
      //   BSTH001-X02 effects[0] / BSTH03-M03 effects[0] と同型 SSOT。
      //   創界神は素で耐性 (10_rules/03c §50) のため targetsGrandwalker:true で明示。
      //   10_rules/07 §55「導界者ネクサスは、創界神ネクサス対象の破壊/コア移動系の効果を受ける」
      //   により tribes は ["導界者", "創界神"] (OR)。SSOT 同型 BSTH001-X02 effects[0]。
      //   召喚 step は target:self + connector:sequential (burst→self-summon パターン、
      //   10_rules/04b_burst-rules.md:34、先例 BSTS01-M01[4,5])。バースト解決中の発動元 zone は
      //   "burst" で "hand" ではないため from_zone:hand は誤り (BSTH03-M02/M03/M06 同型バグ修正)。
      //   costModifier:"free" で「コストを支払わずに」を明示する。
      {
        timing: {
          kind: "burst",
          trigger: "相手のスピリット／アルティメットのアタック後",
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
              to: {
                kind: "void",
                player: "opponent",
              },
              amount: 4,
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH02-R01",
    orikaId: 83,
    orikaIndex: 79,
    name: "リリカ・プリズムリバー",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "purple", "guide"],
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
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分は、手札1枚を破棄することで、2枚ドローする。ネクサスがあるとき、相手のフィールドのコア1個をリザーブに置く。",
      "",
      "Lv2-Lv3",
      "系統：「冥主」を持つ自分のスピリットすべてをBP+2000する。",
      "",
      "Lv3",
      "自分の「プリズムリバー」すべてをBP+3000する。",
    ],
    keywordTags: [],
    tribe: "幻想・冥主",
    image: "images/BSTH02-R01.webp",
    rarity: "R",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        // 発動コストが手札1枚破棄（フィルタ無し=任意のカード）。SSOT 流用:
        // BSGE01「召喚/契約合体時」効果(BSGE01.ts:4109-4118)と同型の
        // discard(cost) → conditional_cost で gate された draw(payoff) パターン。
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "discard",
              count: 1,
              player: "self",
              fromZone: "hand",
            },
            connector: "conditional_cost",
          },
          {
            action: { kind: "draw", count: 2 },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        // 「ネクサスがあるとき」= 自分/相手いずれかのネクサス
        // (needs-ruling.jsonl:BSTH02-R01/R02/R03 裁定C、2026-07-17)。
        condition: [
          {
            kind: "field_has",
            player: "either",
            category: ["nexus"],
          },
        ],
        steps: [
          {
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
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["冥主"],
                },
                count: "all",
              },
              amount: 2000,
              duration: {
                scope: "while_on_field",
              },
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
            value: 3,
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
                  cardName: [
                    {
                      contains: "プリズムリバー",
                    },
                  ],
                },
                count: "all",
              },
              amount: 3000,
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH02-R02",
    orikaId: 87,
    orikaIndex: 80,
    name: "メルラン・プリズムリバー",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "purple", "guide"],
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
        bp: 7000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分は、手札1枚を破棄することで、2枚ドローする。ネクサスがあるとき、相手のリザーブのコア1個をトラッシュに置く。",
      "",
      "Lv2-Lv3",
      "自分の手札は相手の効果を受けない。",
      "",
      "Lv3",
      "自分の「プリズムリバー」すべてに紫のシンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "幻想・冥主",
    image: "images/BSTH02-R02.webp",
    rarity: "R",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        // 発動コストが手札1枚破棄（フィルタ無し=任意のカード）。SSOT 流用:
        // BSGE01「召喚/契約合体時」効果(BSGE01.ts:4109-4118)と同型の
        // discard(cost) → conditional_cost で gate された draw(payoff) パターン。
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "discard",
              count: 1,
              player: "self",
              fromZone: "hand",
            },
            connector: "conditional_cost",
          },
          {
            action: { kind: "draw", count: 2 },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        // 「ネクサスがあるとき」= 自分/相手いずれかのネクサス
        // (needs-ruling.jsonl:BSTH02-R01/R02/R03 裁定C、2026-07-17)。
        condition: [
          {
            kind: "field_has",
            player: "either",
            category: ["nexus"],
          },
        ],
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "reserve",
                player: "opponent",
              },
              to: {
                kind: "trash",
                player: "opponent",
              },
              amount: 1,
            },
          },
        ],
        textRef: [0, 1],
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
        textRef: [3, 4],
      },
      {
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
            action: {
              kind: "symbol_add",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  cardName: [
                    {
                      contains: "プリズムリバー",
                    },
                  ],
                },
                count: "all",
              },
              symbol: "purple",
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH02-R03",
    orikaId: 88,
    orikaIndex: 81,
    name: "ルナサ・プリズムリバー",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "purple", "guide"],
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
      "自分は、手札1枚を破棄することで、2枚ドローする。ネクサスがあるとき、相手のトラッシュのコア1個をボイドに置く。",
      "",
      "Lv2-Lv3",
      "系統：「冥主」を持つ自分のスピリットすべては、相手のバースト効果を持つスピリット/アルティメットの効果を受けない。",
      "",
      "Lv3『自分のアタックステップ』",
      "自分は、「プリズムリバー」3体まで同時にアタックできる。相手は、その内の2体までしかブロックできず、バトルは同時に解決する。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・冥主",
    image: "images/BSTH02-R03.webp",
    rarity: "R",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        // 発動コストが手札1枚破棄（フィルタ無し=任意のカード）。SSOT 流用:
        // BSGE01「召喚/契約合体時」効果(BSGE01.ts:4109-4118)と同型の
        // discard(cost) → conditional_cost で gate された draw(payoff) パターン。
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "discard",
              count: 1,
              player: "self",
              fromZone: "hand",
            },
            connector: "conditional_cost",
          },
          {
            action: { kind: "draw", count: 2 },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        // 「ネクサスがあるとき」= 自分/相手いずれかのネクサス
        // (needs-ruling.jsonl:BSTH02-R01/R02/R03 裁定C、2026-07-17)。
        condition: [
          {
            kind: "field_has",
            player: "either",
            category: ["nexus"],
          },
        ],
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "trash",
                player: "opponent",
              },
              to: {
                kind: "void",
                player: "opponent",
              },
              amount: 1,
            },
          },
        ],
        textRef: [0, 1],
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
        // 系統：「冥主」を持つ自分のスピリットすべては、相手のバースト効果を持つ
        // スピリット/アルティメットの効果を受けない。immunitySourceScope.hasBurstEffect
        // で発生源を category:spirit/ultimate かつ印字バースト系ヘッダ持ちに限定する。
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["冥主"],
                },
                count: "all",
              },
              duration: {
                scope: "while_on_field",
              },
              sourceScope: {
                categories: ["spirit", "ultimate"],
                hasBurstEffect: true,
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv3『自分のアタックステップ』「プリズムリバー」3体まで同時アタック、
      // 相手は2体までブロック可、同時解決 (P2-05 allow_simultaneous_attack)。
      // 「プリズムリバー」(鉤括弧のみ) = 部分一致 [[project_card_name_reference_matching]]。
      // 同時解決は battleResolutionGroup の group 解決 (既存) が担う。
      {
        timing: {
          kind: "continuous",
        },
        timingScope: { player: "self", period: "attack" },
        condition: [
          {
            kind: "min_level",
            value: 3,
          },
        ],
        steps: [
          {
            action: {
              kind: "allow_simultaneous_attack",
              player: "self",
              filter: {
                category: ["spirit"],
                cardName: { contains: "プリズムリバー" },
              },
              maxCount: 3,
              blockerCapacity: 2,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH02-R11",
    orikaId: 89,
    orikaIndex: 82,
    name: "六道剣「一念無量劫」",
    printedCategory: "magic",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "purple", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」/「冥主」を持つ。",
      "自分の白/紫の効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられ、トラッシュから手札に加えたとき、ボイドからコア1個を自分の白/紫の導界者ネクサスに置く。",
      "",
      "フラッシュ",
      "このターンの間、コスト4以上の相手のスピリット/アルティメットによって自分のライフは減らず、自分のデッキは相手の効果を受けない。",
    ],
    keywordTags: [],
    tribe: "幻想・冥主",
    image: "images/BSTH02-R11.webp",
    rarity: "R",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["revealed", "moved_to_trash"],
        },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          {
            kind: "trigger_colors",
            colors: ["white", "purple"],
          },
          {
            kind: "trigger_from_zone",
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
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["導界者"],
                  colors: ["white", "purple"],
                  targetsGrandwalker: "only",
                },
              },
              amount: 1,
            },
          },
        ],
        executionMode: "optional",
        textRef: [1],
      },
      // フラッシュ: このターン、コスト4以上の相手スピリット/アルティメットによって
      //   自分のライフは減らず、自分のデッキは相手の効果を受けない。
      //   前段「～によって」は battle / effect 双方の cause を含む広い因果として
      //   life_damage_interception + attackerFilter で表現する。
      //   後段「自分のデッキは相手の効果を受けない」は BSAZ02-M03 と同型の
      //   effect_immunity target.zone:["deck"] + duration:turn で表現する。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "opponent",
              mode: "replace",
              attackerFilter: {
                category: ["spirit", "ultimate"],
                minCost: 4,
              },
              duration: { scope: "turn" },
            },
          },
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: {},
                count: "all",
                zone: ["deck"],
              },
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH02-X01",
    orikaId: 90,
    orikaIndex: 83,
    name: "西行妖",
    printedCategory: "nexus",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: ["purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: ["guide"],
    textLines: [
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・導域は、神託・神域としても扱う。",
      "",
      "【導託：[幻想＆冥主＆コスト5以上]】",
      "◆対象の自分のスピリットを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは紫としても扱う。",
      "",
      "【導域:1】Lv1-Lv2『お互いのターン』",
      "〔このネクサスのコア1個以上〕「西行妖」が1つのとき、創界神ネクサス/導界者ネクサス/創界石ネクサス以外のフィールド/リザーブのコアの合計がお互いどちらも5個以上のとき、「西行妖」以外の創界神ネクサスを含むフィールド/リザーブのコア1個をボイドに置く。この効果を各『ステップ開始時』に発揮し、この効果で消滅したスピリット/アルティメット/ネクサス1つにつき、ボイドからコア1個をこのネクサスに置く。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    tribe: "導界者・冥主",
    image: "images/BSTH02-X01.webp",
    rarity: "X",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 本体ルール [0] + 導託 [2,3,4]（〔幻想＆冥主＆コスト5以上〕= 系統 AND +
    // 配置時デッキ上3枚の標準神託）は grandwalkerData + エンジン基盤で表現。
    // 系統 AND は OracleCondition.tribesLogic: "and"（2026-06-10 拡張）。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        {
          tribes: ["幻想", "冥主"],
          tribesLogic: "and",
          categories: ["spirit"],
          minCost: 5,
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
              asColor: "purple",
            },
          },
        ],
        textRef: [6],
      },
      {
        // 各『ステップ開始時』= step 省略 + subPhase:"start"（BSAZ02.ts:287 precedent）。
        timing: { kind: "phase", whose: "either", subPhase: "start" },
        condition: [
          { kind: "grandwalker_core_count", min: 1 },
          {
            // [確定 2026-08-02, ユーザー確認] 「西行妖」が1つ = お互いの合計がちょうど1体
            // (自己包含)。`sumAcrossPlayers:true` で自分/相手の場を合算してカウントする
            // (`player:"either"` 単独は「自分/相手いずれかが単独で満たせば true」という
            // OR 判定であり合算にならない。BSTH02-R01/R02/R03 裁定Cとの区別、
            // adversarial verifier で発見・修正: 自分1体+相手1体(合計2体)を誤ってtrue化
            // していた)。
            kind: "field_has",
            player: "either",
            sumAcrossPlayers: true,
            cardNames: [{ contains: "西行妖" }],
            minCount: 1,
            maxCount: 1,
          },
          {
            kind: "field_core_sum_both_players",
            min: 5,
            excludeGrandwalker: true,
            excludeGrandstone: true,
          },
        ],
        // 両者のフィールド/リザーブを一つのコア候補集合にする。
        // 創界神対象は導界者も含む。カード名「西行妖」は所属によらず除外する。
        steps: [
          {
            id: "x01-void-shoot",
            action: {
              kind: "core_move",
              from: {
                kind: "union",
                sources: [
                  {
                    kind: "field",
                    player: "self",
                    includeReserve: true,
                    filter: {
                      targetsGrandwalker: true,
                      excludeCardName: { contains: "西行妖" },
                    },
                  },
                  {
                    kind: "field",
                    player: "opponent",
                    includeReserve: true,
                    filter: {
                      targetsGrandwalker: true,
                      excludeCardName: { contains: "西行妖" },
                    },
                  },
                ],
              },
              to: { kind: "void", player: "self" },
              amount: 1,
            },
          },
          // この効果で消滅したスピリット/アルティメット/ネクサス1つにつき、ボイドからコア
          // 1個をこのネクサスに置く（DynamicCountSource.cards_from_ref、BSKB01.ts:2080
          // precedent と同型）。
          {
            id: "x01-fill-vanished",
            connector: "after_state_check",
            stepCondition: {
              kind: "ref_leave_established",
              stepId: "x01-void-shoot",
              leaveKind: "vanish",
            },
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: {
                source: {
                  kind: "cards_from_ref",
                  stepId: "x01-void-shoot",
                  establishedLeaveKind: "vanish",
                },
              },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSTH02-X02",
    orikaId: 91,
    orikaIndex: 84,
    name: "西行寺 幽々子",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: ["purple", "purple", "purple", "guide"],
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
    symbolColors: ["purple"],
    textLines: [
      "Lv2-Lv3",
      "このスピリットが相手によってフィールドを離れるとき、相手のライフのコア1個をこのスピリットに置くことで、回復状態でフィールドに残る。",
      "",
      "【界放：3】Lv2-Lv3『このスピリットのアタック時』",
      "相手のスピリット/アルティメット1体を消滅させる。この効果で消滅するスピリット/アルティメットのコアは、相手がリザーブ/トラッシュに置く。さらに、自分の紫の導界者ネクサスのコア3個をこのスピリットに置くことで、このターンの間、このスピリットに紫のシンボル2つを追加する。",
    ],
    keywordTags: [],
    tribe: "幻想・冥主",
    image: "images/BSTH02-X02.webp",
    rarity: "X",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv2-Lv3 「このスピリットが相手によってフィールドを離れるとき、相手のライフのコア1個を
      //   このスピリットに置くことで、回復状態でフィールドに残る。」
      // SSOT 流用: BSLH01-R01 effects[0] (相手によって離脱→ボイドコア1個→回復状態で残る) と同型。
      //   cost を「ボイドからのコア」→「相手のライフからのコア」へ差し替えただけで構造は同じ。
      //   「相手によって」= cause:["opponent_effect","battle"]（BSTH02-X05 effects[1] の cause:"opponent_effect"
      //   との対比＝あちらは「相手の効果で」限定）。
      // executionMode:"optional" + conditional_cost で「置くことで〜残る」のプレイヤー選択を表現。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "life",
                player: "opponent",
              },
              to: {
                kind: "this_card",
              },
              amount: 1,
            },
          },
          {
            action: {
              kind: "stay_on_field",
              target: { kind: "self" },
              newExhaustState: "recovered",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
        // 相手ライフが soul のみ (lifeNormalCoreCount=0 + soulCoreLocation.kind='life') のとき
        // cross-player soul 移転は ownership 未モデル化のため normal-only (ENGINE-core-move-
        // from-life-to-this_card-soul-cross-player 解消。ENGINE-core-move-soul-cross-player-
        // destination option b と同じ SSOT: cross-player destination は soul を除外する設計を
        // 踏襲、同一プレイヤー宛の life→this_card は soul auto-pick 対応済)。実害は edge case
        // のみ (相手のライフが 0 + soul のみの稀状態)。
      },
      // Lv2-Lv3『このスピリットのアタック時』vanish 1 + 界放:3 (紫の導界者ネクサスのコア3個→このスピリット
      //   による this_turn 紫シンボル+2)。
      // SSOT 流用: BSTH01-XX02 effects[1] (BSTH01.ts:3322-3361) と同型の
      //   core_move from:field_card 自分の導界者ネクサス → to:this_card amount:N → 後段
      //   conditional_cost で benefit を gate するパターン。
      // 「さらに」= 前段 vanish と独立の同タイミング副節 (simultaneous)、その内部で
      //   「Xすることで Y」= 界放:3 を conditional_cost で表現。
      // 紫シンボル+2 は単色 symbol_add x2 (precedent BSTH01-C04 line 263-287 / BSLH01)。
      // 消滅時のコア destination 「相手がリザーブ/トラッシュに置く」= VanishAction.coreDestinationChoice
      //   (ENGINE-vanish-action-core-destination-opponent-choice) で配線。対象のコントローラー
      //   (=このカードの「相手」) が pendingCoreSplitSelection で reserve/trash へ自由配分する。
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
        steps: [
          {
            action: {
              kind: "vanish",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
              coreDestinationChoice: {
                options: ["reserve", "trash"],
              },
            },
          },
          // 界放:3 cost — 自分の紫の導界者ネクサスのコア3個をこのスピリットに置く。
          {
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  colors: ["purple"],
                  tribes: ["導界者"],
                  targetsGrandwalker: true,
                },
              },
              to: { kind: "this_card" },
              amount: 3,
            },
            connector: "simultaneous",
          },
          // benefit 1: 紫シンボル+1 (このターン中)
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "purple",
              duration: { scope: "turn" },
            },
            connector: "conditional_cost",
          },
          // benefit 2: 紫シンボル+1 (合計+2)。conditional_cost を直前 benefit step に
          //   chain することで、cost (step1) → benefit1 (step2) → benefit2 (step3) のうち
          //   step1 が失敗 (insufficient 3 cores) のときに step2 が rollback され、step2 の
          //   rollback が step3 を gate する (連鎖 conditional_cost)。
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "purple",
              duration: { scope: "turn" },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH02-X03",
    orikaId: 92,
    orikaIndex: 85,
    name: "魂魄 妖夢",
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
      "このカードの軽減シンボル<白>は紫としても扱う。",
      "",
      "Lv1-Lv2",
      'このスピリットと系統：「幻想」を持つ自分のコスト6以上の紫のスピリットすべてに"【超重装甲：紫/緑/白】このスピリットは相手の紫/緑/白の効果を受けない。"を与える。',
      "",
      "Lv1-Lv2",
      "このスピリットは相手の効果で破壊されず、疲労状態でブロックできる。",
      "",
      "Lv2『自分のターン』",
      "このスピリットに紫のシンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "幻想・冥主・戦姫",
    image: "images/BSTH02-X03.webp",
    rarity: "X",
    pack: "BSTH02 東方妖々夢",
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
              aspects: ["reduction_symbol"],
              asColor: "purple",
              reductionSymbolBaseColors: ["white"],
              appliesToCard: true,
              cardStateOnly: true,
            },
          },
        ],
        textRef: [0],
      },
      // 【超重装甲：紫/緑/白】このスピリットと系統:「幻想」を持つ自分のコスト6以上の紫スピリット
      // すべてに「相手の紫/緑/白の効果を受けない」を付与する (BSTH08-M01/M02 同型の
      // sourceScope.colors 配線、[[project_immunity_source_scope_effective]] で発生源カード実効値で
      // 照合)。「このスピリット」は self target、他スピリットは filter count:"all" の 2 effect 構造。
      // 妖夢自身は colors=["white"] のため第2 effect のフィルタ (colors:["purple"]) には自動で
      // 含まれない (このスピリットを self で別途登録する設計理由)。
      // duration:while_on_field で本カード離脱と同時に両 CE 失効。
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              sourceScope: { colors: ["purple", "green", "white"] },
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
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["幻想"],
                  colors: ["purple"],
                  minCost: 6,
                },
                count: "all",
                excludeSelf: true,
              },
              sourceScope: { colors: ["purple", "green", "white"] },
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
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "destroy",
              source: "opponent_effect",
              duration: {
                scope: "while_on_field",
              },
            },
          },
          // 「疲労状態でブロックできる」(block-while-exhausted)。
          // 通常ブロックは回復状態が必要だが本効果で疲労状態でも宣言可
          // (allow_block_while_exhausted, battle-availability 配線済み)。
          {
            action: {
              kind: "allow_block_while_exhausted",
              target: {
                kind: "self",
              },
              duration: {
                scope: "while_on_field",
              },
            },
            connector: "sequential",
          },
        ],
        textRef: [5, 6],
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
          // 『自分のターン』限定 (turn_player primitive, engine-drain 2026-06-12)。
          {
            kind: "turn_player",
            player: "self",
          },
        ],
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "purple",
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSTH02-X04",
    orikaId: 93,
    orikaIndex: 86,
    name: "[妖々夢]霧雨 魔理沙",
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
      "このターンの間、相手のスピリット/アルティメット1体をBP-12000し、BPが0になったスピリット/アルティメットをデッキの下に戻す。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットは系統：「導魔」を持つブレイヴ3つまで合体できる。",
      "",
      "Lv2-Lv3『このスピリットのアタック/ブロック時』",
      "このターンの間、このスピリットとバトルしていない相手のスピリット/アルティメット1体をBP-10000し、BPが0になった相手のスピリット/アルティメットをデッキの下に戻すまたは破壊する。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・冥主・導魔",
    image: "images/BSTH02-X04.webp",
    rarity: "X",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: "相手のスピリット／アルティメットのアタック後",
        },
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
                },
                count: 1,
              },
              amount: -12000,
              duration: {
                scope: "turn",
              },
            },
          },
          {
            // BP0 になった相手スピリット/アルティメットをデッキの下に戻す。
            action: {
              kind: "send_to_deck",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
              position: "bottom",
            },
            connector: "sequential",
          },
          {
            // burst→self-summon パターン (10_rules/04b_burst-rules.md:34、先例 BSTS01-M01[4,5])。
            // from_zone:hand は誤り（BSTH03-M02/M03/M06 同型バグ修正）。
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
        timing: {
          kind: "continuous",
        },
        applicability: { level: { min: 1, max: 3 } },
        steps: [],
        textRef: [3, 4],
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
                  // 「このスピリットとバトルしていない」= not_in_battle
                  // (BSTH003 と同型の対象限定)。
                  battleState: "not_in_battle",
                },
                count: 1,
              },
              amount: -10000,
              duration: {
                scope: "turn",
              },
            },
          },
          {
            // BP0 になった相手を「デッキの下に戻すまたは破壊する」二択。
            action: {
              kind: "send_to_deck",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
              position: "bottom",
            },
            choice: [
              {
                action: {
                  kind: "destroy",
                  target: {
                    kind: "ref",
                    stepId: "bp0",
                    result: "bp_became_zero",
                  },
                },
              },
            ],
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
      {
        timing: {
          kind: "card_event",
          event: "block",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
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
                  // 「このスピリットとバトルしていない」= not_in_battle
                  // (BSTH003 と同型の対象限定)。
                  battleState: "not_in_battle",
                },
                count: 1,
              },
              amount: -10000,
              duration: {
                scope: "turn",
              },
            },
          },
          {
            // BP0 になった相手を「デッキの下に戻すまたは破壊する」二択。
            action: {
              kind: "send_to_deck",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
              position: "bottom",
            },
            choice: [
              {
                action: {
                  kind: "destroy",
                  target: {
                    kind: "ref",
                    stepId: "bp0",
                    result: "bp_became_zero",
                  },
                },
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
    cardNo: "BSTH02-X05",
    orikaId: 94,
    orikaIndex: 87,
    name: "八雲 藍",
    printedCategory: "spirit",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 8,
    reductionSymbols: ["guide", "guide", "guide", "guide"],
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
        bp: 18000,
      },
    ],
    symbolColors: ["guide"],
    textLines: [
      "フラッシュ【煌臨：幻想＆コスト5以上『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの煌臨/アタック時』",
      "相手のスピリット/アルティメット1体をデッキの下に戻せる。さらに、このバトルの間、このスピリットに導シンボル1つを追加する。その後、自分のトラッシュにある《ソウルコア》をこのスピリットに置ける。",
      "",
      "Lv2-Lv3",
      "このスピリットが相手の効果でフィールドを離れるとき、自分の手札1枚を破棄することで、疲労状態でフィールドに残る。",
    ],
    keywordTags: ["advent"],
    tribe: "幻想・妖戒",
    image: "images/BSTH02-X05.webp",
    rarity: "X",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【煌臨：幻想＆コスト5以上『お互いのアタックステップ』】。
    // 煌臨宣言は CardDefinition.adventData で表現する（11 L149 / 08a §1, declare_advent 配線済み）。
    // 『お互いのアタックステップ』= both_attack_step、ソウルコア→トラッシュ、adventVariant: normal。
    // 「幻想」は系統条件 → adventCondition.tribes、「コスト5以上」= minCost:5 で忠実に表現する
    //   （matchesAdventCondition が tribes/minCost を enforce、advent-system.ts L103-115）。
    adventData: {
      adventCondition: {
        targetCategory: ["spirit"],
        tribes: ["幻想"],
        minCost: 5,
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventVariant: "normal",
    },
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["advent", "attack"],
        },
        executionMode: "mandatory",
        steps: [
          {
            executionMode: "optional",
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 1,
              },
              position: "bottom",
            },
          },
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "guide",
              duration: {
                scope: "battle",
              },
            },
            connector: "simultaneous",
          },
          {
            // 「その後」= 前段の戻す/シンボル付与とは独立の任意行動 (BSDB01 系の
            // 「その後、〜できる」precedent と同型、per-step executionMode:"optional")。
            // 《ソウルコア》明記 = effectKind:"explicit_soul_core"（通常コアは動かさない、
            // trash→this_card ハンドラ新設 ENGINE-core-move-trash-to-this-card-soul）。
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
              effectKind: "explicit_soul_core",
            },
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3 「このスピリットが相手の効果でフィールドを離れるとき、自分の手札1枚を破棄することで、
      //   疲労状態でフィールドに残る。」
      // SSOT 流用: BSLH01-R01 effects[0] / BSTH05.5-C02 effects[1] / BSSG01 §1101 同型 (cost + stay_on_field
      //   conditional_cost)。cost は discard 1 (player:self)、conditional_cost connector で stay_on_field
      //   (newExhaustState:"exhausted") を縛る。executionMode:"optional" でプレイヤーは破棄を辞退可能。
      // 「相手の効果で」= cause:"opponent_effect" 単独（"battle" は含まない、BSTH02-X02 effects[0] の
      //   「相手によって」との対比）。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: "opponent_effect",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "discard",
              count: 1,
              player: "self",
              fromZone: "hand",
            },
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
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH02-XX01",
    orikaId: 95,
    orikaIndex: 88,
    name: "八雲 紫",
    printedCategory: "spirit",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 9,
    reductionSymbols: ["guide", "guide", "guide", "guide"],
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
      {
        level: 3,
        requiredCores: 5,
        bp: 30000,
      },
    ],
    symbolColors: ["guide", "guide"],
    textLines: [
      "フラッシュ【煌臨：幻想＆煌臨中『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの煌臨/アタック時』",
      "相手のスピリット/アルティメット2体をデッキの下に戻せる。さらに、自分の手札1枚をこのスピリットの下に煌臨元カードとして追加することで、このスピリットは回復し、ブロックされない。",
      "",
      "Lv2-Lv3『お互いのアタックステップ』",
      "相手がフラッシュ効果を発揮するとき、その効果発揮前に、このスピリットの煌臨元カード2枚を破棄することで、その効果を無効にする。",
    ],
    keywordTags: ["advent"],
    tribe: "幻想・妖戒・賢者",
    image: "images/BSTH02-XX01.webp",
    rarity: "XX",
    pack: "BSTH02 東方妖々夢",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【煌臨：幻想＆煌臨中『お互いのアタックステップ』】。
    // 煌臨宣言は CardDefinition.adventData で表現する（11 L149 / 08a §1, declare_advent 配線済み）。
    // 『お互いのアタックステップ』= both_attack_step、ソウルコア→トラッシュ、adventVariant: normal。
    // 「幻想」は系統条件 → adventCondition.tribes、「煌臨中」= adventState:"advented"
    // で忠実に表現する。
    adventData: {
      adventCondition: {
        targetCategory: ["spirit"],
        tribes: ["幻想"],
        adventState: "advented",
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventVariant: "normal",
    },
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["advent", "attack"],
        },
        executionMode: "optional",
        steps: [
          {
            id: "bottom_deck_targets",
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 2,
              },
              position: "bottom",
            },
          },
          {
            id: "add_advent_source_cost",
            executionMode: "optional",
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "self",
                filter: {},
                count: 1,
                zone: "hand",
              },
              from: {
                zone: "hand",
                player: "self",
              },
              to: {
                zone: "field",
                sourceUnderCardRole: "advent_source",
              },
              count: 1,
              requireFullCount: true,
            },
          },
          {
            action: {
              kind: "unblockable",
              target: { kind: "self" },
              duration: { scope: "battle" },
            },
            connector: "conditional_cost",
          },
          {
            action: { kind: "recover", target: { kind: "self" } },
            connector: "conditional_result",
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "effect_declaration",
          triggerEffectTiming: "flash",
        },
        executionMode: "optional",
        timingScope: { player: "both", period: "attack" },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        steps: [
          {
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "self",
                filter: {},
                count: 2,
                zone: "field",
              },
              from: {
                zone: "field",
                player: "self",
                sourceUnderCardRole: "advent_source",
              },
              to: { zone: "trash" },
              count: 2,
              requireFullCount: true,
            },
          },
          {
            action: {
              kind: "negate",
              negateTarget: "effect",
              targetEffectTiming: "flash",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
];
