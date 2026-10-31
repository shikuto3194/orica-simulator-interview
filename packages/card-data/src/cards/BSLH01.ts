import type {
  CardDefinition,
  ConditionClause,
  EffectStep,
  QuartzAttribute,
} from "@orica/rules-core";

/**
 * 【アーツ】属性値ゲート用の quartz_attribute 単項 ConditionClause（BSLH01-T07〜T17）。
 * 各アーツの閾値プロファイルは複数の AND グループを any_of (OR) で束ねる
 * （例 T08「地4風1 / 水4地1 / ...」）。
 */
function artsAttr(attribute: QuartzAttribute, min: number): ConditionClause {
  return { kind: "quartz_attribute", player: "self", attribute, min };
}

function c07SetAsideOpponentHandSteps(
  primaryStepId: string,
  bonusStepId: string,
  primaryStepOptions: Pick<
    EffectStep,
    "connector" | "executionMode" | "stepCondition" | "usageLimit"
  > = {}
): EffectStep[] {
  return [
    {
      id: primaryStepId,
      ...primaryStepOptions,
      action: {
        kind: "move_card",
        from: { zone: "hand", player: "opponent" },
        to: { zone: "set_aside", player: "opponent" },
        count: 1,
        unseen: true,
      },
    },
    {
      action: {
        kind: "move_card",
        target: { kind: "ref", stepId: primaryStepId },
        from: { zone: "set_aside", player: "opponent" },
        to: { zone: "trash", player: "opponent" },
        count: 1,
      },
      stepCondition: {
        kind: "ref_has_match",
        stepId: primaryStepId,
        filter: { category: ["magic"] },
      },
    },
    {
      action: { kind: "count_increase", player: "self", amount: 2 },
      stepCondition: {
        kind: "ref_has_match",
        stepId: primaryStepId,
        filter: { category: ["magic"] },
      },
    },
    {
      action: { kind: "count_increase", player: "self", amount: 1 },
      stepCondition: {
        kind: "ref_has_match",
        stepId: primaryStepId,
        filter: { category: ["spirit"] },
      },
    },
    {
      id: bonusStepId,
      action: {
        kind: "move_card",
        from: { zone: "hand", player: "opponent" },
        to: { zone: "set_aside", player: "opponent" },
        count: 1,
        unseen: true,
      },
      executionMode: "optional",
      stepCondition: {
        kind: "ref_has_match",
        stepId: primaryStepId,
        filter: { category: ["spirit"] },
      },
    },
    {
      action: {
        kind: "move_card",
        target: { kind: "ref", stepId: bonusStepId },
        from: { zone: "set_aside", player: "opponent" },
        to: { zone: "trash", player: "opponent" },
        count: 1,
      },
      stepCondition: {
        kind: "ref_has_match",
        stepId: bonusStepId,
        filter: { category: ["magic"] },
      },
    },
    {
      action: { kind: "count_increase", player: "self", amount: 2 },
      stepCondition: {
        kind: "ref_has_match",
        stepId: bonusStepId,
        filter: { category: ["magic"] },
      },
    },
    {
      action: { kind: "count_increase", player: "self", amount: 1 },
      stepCondition: {
        kind: "ref_has_match",
        stepId: bonusStepId,
        filter: { category: ["spirit"] },
      },
    },
  ];
}

function x10SoulDriveSteps(afterBurst = false): EffectStep[] {
  const steps: EffectStep[] = [
    {
      id: "x10-soul-drive-s-cost",
      action: {
        kind: "core_move",
        from: {
          kind: "field",
          player: "self",
          includeReserve: true,
        },
        to: {
          kind: "removed_from_game",
          player: "self",
        },
        amount: 1,
        effectKind: "explicit_soul_core",
      },
    },
    {
      action: {
        kind: "destroy",
        target: {
          kind: "filter",
          player: "opponent",
          filter: {
            filterOr: [
              {
                category: ["spirit"],
              },
              {
                category: ["ultimate"],
              },
            ],
          },
          count: {
            min: 0,
            max: 3,
          },
        },
        suppressDestroyedEffects: "all_opponent",
      },
      stepCondition: {
        kind: "ref_succeeded",
        stepId: "x10-soul-drive-s-cost",
      },
    },
    {
      action: {
        kind: "symbol_add",
        target: {
          kind: "self",
        },
        symbol: "red",
        duration: {
          scope: "turn",
        },
      },
      connector: "simultaneous",
      stepCondition: {
        kind: "ref_succeeded",
        stepId: "x10-soul-drive-s-cost",
      },
    },
  ];
  if (afterBurst && steps[0])
    steps[0] = {
      ...steps[0],
      connector: "after_triggers",
      executionMode: "optional",
    };
  return steps;
}

export const BSLH01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSLH01-C01",
    quartzData: {
      quartzName: "双魚珠",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 時: 5 },
    },
    orikaId: 496,
    orikaIndex: 494,
    name: "[零の軌跡]ロイド・バニングス",
    printedCategory: "spirit",
    colors: ["black"],
    cost: 3,
    reductionSymbols: ["black", "black"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 6000,
      },
    ],
    symbolColors: ["black"],
    textLines: [
      "Lv1-Lv2『自分のメインステップ』",
      "このスピリットに黒のシンボル1つを追加する。〔ターンに2回：同名〕このスピリットを疲労させることで、自分のカウント+1する。そうしたとき、自分のスピリットの『このスピリットの召喚時』効果1つを発揮でき、系統:「ＣＢ」を持つ自分の創界神ネクサス/導界者ネクサスにコア+1できる。",
      "",
      "Lv2 フラッシュ",
      "ターンに1回、自分の手札1枚を破棄することで、このスピリットは回復する。",
      "",
      "【クォーツ：双魚珠｜コストC2｜属性値：<時>5（手札から対象にセットできる）】",
      "ターンに1回、系統：「CB」を持つ自分のスピリットが相手のマジック/アルティメットの効果の対象になるとき、自分のデッキを上から1枚オープンできる。それがスピリットカードのとき、その効果を受けない。オープンしたカードはデッキの下に戻す。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-C01.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『自分のメインステップ』このスピリットに黒のシンボル1つを追加する。
      // ルーミア(BSTH01-C04)型の継続効果。activated + permanent だと起動毎に永続 symbol_addition CE が
      // 累積し continuous-effect が無制限増加する(self-play で perf cliff)。continuous + timingScope で表現。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { level: { min: 1, max: 2 } },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "black",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2『自分のメインステップ』〔ターンに2回：同名〕疲労させ、自分のカウント+1。そうしたとき召喚時効果1つ発揮＋CB創界神/導界者にコア+1。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 2 },
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              target: { kind: "self" },
              state: "exhausted",
            },
          },
          {
            id: "count",
            action: { kind: "count_increase", player: "self", amount: 1 },
            connector: "conditional_cost",
          },
          {
            executionMode: "optional",
            action: {
              kind: "borrow_card_event_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  hasCardEventEffect: ["summon"],
                },
                count: 1,
              },
              borrowEvents: ["summon"],
              attributeToBorrowedCard: true,
            },
            stepCondition: { kind: "ref_succeeded", stepId: "count" },
          },
          // 「そうしたとき」(=count+1 成功時) 系統:「CB」を持つ自分の創界神/導界者ネクサスに
          // ボイドからコア+1できる。直前の借用効果ではなく count 成功を明示参照する。
          // targetsGrandwalker:"only" で通常ネクサスを除外し、tribes:["CB"] で CB 限定。
          {
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["CB"],
                  targetsGrandwalker: "only",
                },
              },
              amount: 1,
            },
            stepCondition: { kind: "ref_succeeded", stepId: "count" },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2 フラッシュ ターンに1回、自分の手札1枚を破棄することで、このスピリットは回復する。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          { action: { kind: "discard", count: 1, player: "self" } },
          {
            action: { kind: "recover", target: { kind: "self" } },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      // 【クォーツ：双魚珠】セット中効果: ターンに1回、系統:CBを持つ自分のスピリットが
      // 相手のマジック/アルティメットの効果の対象になるとき、自分のデッキ上1枚を
      // オープンできる。それがスピリットカードなら対象化された効果を受けない
      // (trigger_related_instance + duration:current_effect、BSGE01-C13/このファイル内の
      // ネクサス版 targeted precedent と同型)。オープンしたカードは常にデッキの下へ戻す
      // (pick 無し、BSLH01-M04 と同型の deck_reveal(picks:[])。「スピリットカードか」の
      // 判定は手札に加わらないため affectedCardInstanceIds(既定) では拾えず、
      // ref_has_match(result:"revealed") で revealed 全体を参照する
      // (needs-dsl.audit BSLH01-C01/BSLH01-R06 で判明した disclosure continuation 消失
      // ギャップ修正 + StepCondition.ref_has_match.result:"revealed" 新設で解消)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "targeted",
          triggerFilter: { category: ["spirit"], tribes: ["CB"] },
          triggerSourceFilter: { category: ["magic", "ultimate"] },
          cause: ["opponent_effect"],
        },
        applicability: { soulState: true },
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        executionMode: "optional",
        steps: [
          {
            id: "c01reveal",
            action: {
              kind: "deck_reveal",
              revealCount: 1,
              picks: [],
              remainder: "bottom",
              beforePickSteps: [
                {
                  action: {
                    kind: "effect_immunity",
                    target: { kind: "trigger_related_instance" },
                    duration: { scope: "current_effect" },
                  },
                  stepCondition: {
                    kind: "ref_has_match",
                    stepId: "c01reveal",
                    filter: { category: ["spirit"] },
                    result: "revealed",
                  },
                },
              ],
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-C02",
    orikaId: 497,
    orikaIndex: 495,
    name: "フラン・シーカー",
    printedCategory: "nexus",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 2,
    reductionSymbols: ["seven"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "Lv1",
      "このネクサスの効果は重複せず、系統：「CB」を持つ自分のスピリットがいる間、このネクサスのシンボルは赤/紫/緑/黄/青/黒としても扱う。",
      "",
      "Lv1『お互いのエンドステップ』",
      "魂状態の自分の「ENIGMA」があるとき、このターン中に自分が召喚した系統：「CB」を持つスピリットの色の合計の数により以下の効果を発揮できる。",
      "2色以上：ボイドからコア1個を自分のリザーブに置ける。",
      "3色以上：自分はデッキの上から1枚ドローできる。",
      "5色以上：トラッシュのコア4個を自分のリザーブに置ける。",
      "7色以上：ゲーム外から<ソウルコア>1個を自分のリザーブに置ける。",
    ],
    keywordTags: ["soul_state"],
    tribe: "CB",
    image: "images/BSLH01-C02.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "continuous",
        },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            tribes: ["CB"],
          },
        ],
        usageLimit: {
          kind: "no_duplicate",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: ["red", "purple", "green", "yellow", "blue", "black"],
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "phase",
          step: "end",
          whose: "either",
        },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "ENIGMA",
              },
            ],
            soulStateOnly: true,
          },
        ],
        steps: [
          {
            executionMode: "optional",
            condition: [
              {
                kind: "summoned_this_turn_color_count",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["CB"],
                },
                min: 2,
              },
            ],
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
          },
          {
            executionMode: "optional",
            condition: [
              {
                kind: "summoned_this_turn_color_count",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["CB"],
                },
                min: 3,
              },
            ],
            action: {
              kind: "draw",
              player: "self",
              count: 1,
            },
          },
          {
            executionMode: "optional",
            condition: [
              {
                kind: "summoned_this_turn_color_count",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["CB"],
                },
                min: 5,
              },
            ],
            action: {
              kind: "core_move",
              from: {
                kind: "trash",
                player: "self",
              },
              to: {
                kind: "reserve",
                player: "self",
              },
              amount: 4,
            },
          },
          {
            executionMode: "optional",
            condition: [
              {
                kind: "summoned_this_turn_color_count",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["CB"],
                },
                min: 7,
              },
            ],
            action: {
              kind: "core_move",
              from: {
                kind: "outside_game",
              },
              to: {
                kind: "reserve",
                player: "self",
              },
              amount: 1,
            },
          },
        ],
        textRef: [3, 4, 5, 6, 7, 8],
        usageLimit: {
          kind: "no_duplicate",
        },
        executionMode: "optional",
      },
    ],
  },
  {
    cardNo: "BSLH01-C03",
    orikaId: 498,
    orikaIndex: 496,
    name: "シャイニングポム",
    printedCategory: "spirit",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
    ],
    symbolColors: [],
    textLines: [
      "このカードはデッキに1枚しか入れられない。",
      "手札/トラッシュにあるこのカードは一切の効果を受けない。",
      "",
      "Lv1『自分のメインステップ』",
      "このスピリット以外の自分のスピリット1体を疲労させることで、このスピリットを破壊する。",
      "",
      "Lv1『このスピリットの破壊時』",
      "〔ゲームに1回：同名〕魂状態の自分の系統：「導力器」を持つブレイヴカードがあるとき、自分のカウント+4し、ボイドからコア4個を自分のトラッシュに置く。",
    ],
    keywordTags: ["soul_state"],
    image: "images/BSLH01-C03.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 手札/トラッシュにあるこのカードは一切の効果を受けない。
      {
        applicability: { zone: ["hand", "trash"] },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
              sourcePlayerScope: "any",
            },
          },
        ],
        textRef: [1],
      },
      // Lv1『自分のメインステップ』このスピリット以外の自分のスピリット1体を疲労させ、このスピリットを破壊する。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: 1,
                excludeSelf: true,
              },
              state: "exhausted",
            },
          },
          {
            action: { kind: "destroy", target: { kind: "self" } },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      // Lv1『このスピリットの破壊時』〔ゲームに1回：同名〕導力器ブレイヴ(魂状態)があれば、カウント+4＋ボイド4個をトラッシュ。
      // 条件「魂状態の自分の系統:「導力器」を持つブレイヴカードがあるとき」を
      // category:["brave"] + tribes:["導力器"] + soulStateOnly で忠実化。
      {
        timing: { kind: "card_event", event: "destroy" },
        usageLimit: { kind: "per_card_name", duration: "game", maxCount: 1 },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["brave"],
            tribes: ["導力器"],
            soulStateOnly: true,
          },
        ],
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 4 } },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "trash", player: "self" },
              amount: 4,
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-C04",
    quartzData: {
      quartzName: "処女珠",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 風: 5 },
    },
    orikaId: 499,
    orikaIndex: 497,
    name: "[零の軌跡]エリィ・マクダエル",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 2000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 5000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のカウント+1できる。自分はボイドからコア1個を自分のスピリットに置くことができ、デッキの上から1枚オープンできる。その中の系統：「CB」を持つカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "Lv2『このスピリットのアタック時』",
      "相手のスピリット1体を重疲労させる。",
      "",
      "【クォーツ：処女珠｜コストC2｜属性値：<風>5（手札から対象にセットできる）】",
      "系統:「ＣＢ」/「導力器」を持つ自分の効果で疲労した相手のスピリット/アルティメット/ネクサス/創界神ネクサスは、次の相手のリフレッシュステップでは回復できない。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-C04.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        steps: [
          {
            executionMode: "optional",
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
          },
          {
            executionMode: "optional",
            action: {
              kind: "core_distribute",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                },
                count: "all",
              },
              amount: 1,
              mode: "player_choice",
            },
            connector: "simultaneous",
          },
          {
            executionMode: "optional",
            action: {
              kind: "deck_reveal",
              revealCount: 1,
              picks: [
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    tribes: ["CB"],
                  },
                },
              ],
              remainder: "trash",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0, 1],
        executionMode: "optional",
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
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "exhaust",
          triggerFilter: {
            category: ["spirit", "ultimate", "nexus"],
            targetsGrandwalker: true,
          },
          triggerSourceFilter: {
            tribes: ["CB", "導力器"],
          },
          cause: ["opponent_effect"],
          sourceWhose: "either",
        },
        applicability: {
          soulState: true,
        },
        steps: [
          {
            action: {
              kind: "prevent_next_recovery",
              target: {
                kind: "trigger_related_instance",
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-C05",
    quartzData: {
      quartzName: "獅子珠",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 火: 5 },
    },
    orikaId: 500,
    orikaIndex: 498,
    name: "[零の軌跡]ランディ・オルランド",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 7000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 9000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、自分のカウント+1できる。相手のBP8000以下のスピリット/コスト4以下のネクサス1つを破壊するか、バースト1つを破棄できる。破壊/破棄したとき、トラッシュの<ソウルコア>以外のコア3個を自分のリザーブに置き、自分のカウント+1する。",
      "",
      "Lv2-Lv3『自分のエンドステップ』",
      "自分は、自分の手札が5枚になるまでドローできる。",
      "",
      "【クォーツ：獅子珠｜コストC2｜属性値：<火>5（手札から対象にセットできる）】",
      "系統：「CB」を持つ自分のスピリットの効果で、ターンに2回目に相手のカードがフィールドを離れたとき、ゲーム外から<ソウルコア>1個を自分のリザーブに置ける。",
    ],
    keywordTags: ["burst"],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-C05.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        executionMode: "optional",
        steps: [
          {
            usageLimit: {
              kind: "per_instance",
              duration: "turn",
              maxCount: 1,
            },
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
            executionMode: "optional",
            prompt: {
              sourceText: "ターンに1回、自分のカウント+1できる。",
            },
          },
          {
            id: "destroy_or_discard",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    {
                      category: ["spirit"],
                      maxBp: 8000,
                    },
                    {
                      category: ["nexus"],
                      maxCost: 4,
                    },
                  ],
                },
                count: 1,
              },
            },
            executionMode: "optional",
            prompt: {
              sourceText:
                "相手のBP8000以下のスピリット/コスト4以下のネクサス1つを破壊するか、バースト1つを破棄できる。",
              question: "破壊／バースト破棄を発揮しますか？",
            },
            choice: [
              {
                action: {
                  kind: "discard_set_burst",
                  player: "opponent",
                  count: 1,
                },
              },
            ],
          },
          {
            action: {
              kind: "core_move",
              from: {
                kind: "trash",
                player: "self",
              },
              to: {
                kind: "reserve",
                player: "self",
              },
              amount: 3,
              effectKind: "normal_only",
            },
            connector: "conditional_result",
          },
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
            connector: "sequential",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "destroy_or_discard",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "phase",
          step: "end",
          whose: "self",
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
              kind: "draw",
              count: 0,
              targetHandSize: 5,
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "leave_field",
          exactEventKind: true,
          triggerSourceFilter: {
            category: ["spirit"],
            tribes: ["CB"],
          },
          cause: ["opponent_effect"],
          sourceWhose: "either",
        },
        applicability: {
          soulState: true,
        },
        occurrenceGate: {
          duration: "turn",
          targetCount: 2,
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "outside_game",
              },
              to: {
                kind: "reserve",
                player: "self",
              },
              amount: 1,
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-C06",
    quartzData: {
      quartzName: "魔防2",
      cost: 0,
      reduction: [],
      countCost: 1,
      attributeValues: { 水: 3 },
    },
    orikaId: 501,
    orikaIndex: 499,
    name: "[零の軌跡]ティオ・プラトー",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 2000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 5000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "〔重複不可〕手札にあるこのカードは、自分の「みっしぃ」が破壊されたとき、自分が「エンジョ〜イ、みっしぃ！」と宣言することで、召喚する。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分はデッキの上から2枚ドローできる。ドロー後、手札2枚を破棄する。この効果で相手のネクサスの効果は発揮されず、系統：「CB」を持つカードを破棄したとき、自分のカウント+1する。",
      "",
      "【クォーツ：魔防2｜コストC1｜属性値：<水>3（手札から対象にセットできる）】",
      "相手のアルティメット/マジックの効果で系統：「CB」を持つ自分のスピリットがフィールドを離れるとき、ターンに1回、対象1体を同じ状態でフィールドに残せる。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S・みっしぃ",
    image: "images/BSLH01-C06.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: {
          zone: ["hand"],
        },
        timing: {
          kind: "game_event",
          player: "self",
          event: "destroy",
          triggerFilter: {
            cardName: [
              {
                contains: "みっしぃ",
              },
            ],
          },
        },
        executionMode: "optional",
        usageLimit: {
          kind: "no_duplicate",
        },
        steps: [
          {
            action: {
              kind: "declare_gimmick",
              player: "self",
            },
          },
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
            },
            connector: "conditional_cost",
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
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                },
                count: "all",
              },
              duration: {
                scope: "current_effect",
              },
            },
          },
          {
            action: {
              kind: "draw",
              count: 2,
            },
            connector: "sequential",
          },
          {
            id: "discard-cb-check",
            action: {
              kind: "discard",
              count: 2,
              player: "self",
            },
            connector: "sequential",
          },
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
            connector: "conditional_result",
            stepCondition: {
              kind: "ref_has_match",
              stepId: "discard-cb-check",
              filter: {
                tribes: ["CB"],
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          triggerFilter: {
            category: ["spirit"],
            tribes: ["CB"],
          },
          triggerSourceFilter: {
            category: ["ultimate", "magic"],
          },
          cause: ["opponent_effect"],
        },
        applicability: {
          soulState: true,
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "stay_on_field",
              target: {
                kind: "trigger_related_instance",
                includePendingLeave: true,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-C07",
    quartzData: {
      quartzName: "冥王珠",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 時: 5 },
    },
    orikaId: 502,
    orikaIndex: 500,
    name: "[碧の軌跡]アレックス・ダドリー",
    printedCategory: "spirit",
    colors: ["black"],
    cost: 4,
    reductionSymbols: ["black", "black"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 7000,
      },
    ],
    symbolColors: ["black"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "相手の手札1枚を内容を見ずに手元に置ける。置いたカードがマジックカードのとき、破棄し、自分のカウント+2する。スピリットカードのとき、自分のカウント+1し、この効果を追加で1回だけ発揮できる。",
      "",
      "Lv2『このスピリットのアタック時』",
      "相手のスピリット1体を手札に戻せる。さらに、この効果発揮後、〔ターンに1回：同名〕このスピリットの『このスピリットの召喚時』効果を発揮できる。",
      "",
      "【クォーツ：冥王珠｜コストC2｜属性値：<時>5（手札から対象にセットできる）】",
      "ターンの最初の自分の「防げない」状態ではない【ソウルドライブ・S】でフィールドを離れる相手のスピリット/アルティメットはフィールドに残せない。",
    ],
    keywordTags: [],
    tribe: "CB",
    image: "images/BSLH01-C07.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
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
        steps: c07SetAsideOpponentHandSteps(
          "c07-set-aside-opponent-hand",
          "c07-bonus-set-aside-opponent-hand",
          {}
        ),
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
        executionMode: "optional",
        steps: [
          {
            id: "c07-bounce-opponent-spirit",
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
            executionMode: "optional",
          },
          ...c07SetAsideOpponentHandSteps(
            "c07-refire-set-aside-opponent-hand",
            "c07-refire-bonus-set-aside-opponent-hand",
            {
              connector: "after_triggers",
              executionMode: "optional",
              usageLimit: {
                kind: "per_card_name",
                duration: "turn",
                maxCount: 1,
              },
            }
          ),
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          soulState: true,
        },
        steps: [
          {
            action: {
              kind: "grant_effect_source_prevention_immunity",
              player: "self",
              sourceScope: {
                soulDriveDeparture: true,
              },
              usageLimit: {
                kind: "per_instance",
                duration: "turn",
                maxCount: 1,
              },
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
    cardNo: "BSLH01-C08",
    quartzData: {
      quartzName: "天秤珠",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 幻: 5 },
    },
    orikaId: 503,
    orikaIndex: 501,
    name: "[零の軌跡]レン",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple", "purple"],
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
      {
        level: 3,
        requiredCores: 5,
        bp: 9000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2-Lv3",
      "このスピリットは、相手のスピリットの効果を受けない。自分の系統：「導力器」を持つトークンマジックカードの使用コストを-1する。また、〔ターンに1回：同名〕自分の系統：「導力器」を持つトークンマジックカードの効果発揮後、自分はデッキの上から1枚ドローできる。",
      "",
      "Lv3『このスピリットのブロック時』",
      "このスピリットとバトルしている相手のスピリットのコアすべてをトラッシュに置ける。",
      "",
      "【クォーツ：天秤珠｜コストC2｜属性値：<幻>5（手札から対象にセットできる）】",
      "自分のマジックの効果で相手のカードがフィールドを離れるとき、ボイドからコア1個を自分のリザーブに置ける。",
    ],
    keywordTags: [],
    tribe: "CB・ウロボロス",
    image: "images/BSLH01-C08.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
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
              kind: "effect_immunity",
              target: {
                kind: "self",
              },
              duration: {
                scope: "while_on_field",
              },
              sourceScope: {
                categories: ["spirit"],
              },
            },
          },
        ],
        textRef: [1],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "self",
              cardFilter: {
                category: ["magic"],
                tribes: ["導力器"],
                isToken: true,
              },
              modifier: {
                additionalCostValue: -1,
              },
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [1],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "effect_completed",
          triggerFilter: {
            category: ["magic"],
            tribes: ["導力器"],
            isToken: true,
          },
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "draw",
              count: 1,
            },
          },
        ],
        textRef: [1],
      },
      {
        timing: {
          kind: "card_event",
          event: "block",
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
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "opponent",
                filter: {
                  battleState: "in_battle",
                  category: ["spirit"],
                },
              },
              to: {
                kind: "trash",
                player: "opponent",
              },
              amount: "all",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "leave_field",
          triggerSourceFilter: {
            category: ["magic"],
          },
          cause: ["opponent_effect"],
          sourceWhose: "either",
        },
        applicability: {
          soulState: true,
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
                kind: "reserve",
                player: "self",
              },
              amount: 1,
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-C09",
    quartzData: {
      quartzName: "金牛珠",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 空: 5 },
    },
    orikaId: 504,
    orikaIndex: 502,
    name: "[創の軌跡]ユウナ・クロフォード",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow", "yellow"],
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
      {
        level: 3,
        requiredCores: 3,
        bp: 4000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のカウント+1できる。自分のデッキを上から3枚オープンできる。その中の系統：「CB」を持つネクサスカード1枚か、系統：「CB」/「EE」を持つコスト4以上のスピリットカード1枚を手札に加える。残ったカードはデッキの下に戻す。",
      "",
      "Lv1-Lv2-Lv3『自分のメインステップ』",
      "〔重複不可〕このスピリットに黄のシンボル1つを追加する。",
      "",
      "【クォーツ：金牛珠｜コストC2｜属性値：<空>5（手札から対象にセットできる）】",
      "系統：「CB」を持つ自分のスピリットのアタックによって相手のライフを減らしたとき、ターンに1回、ボイドからコア1個を自分のライフに置ける。",
    ],
    keywordTags: [],
    tribe: "CB・EE",
    image: "images/BSLH01-C09.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        steps: [
          {
            executionMode: "optional",
            action: {
              kind: "count_increase",
              player: "self",
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
                    filterOr: [
                      {
                        category: ["nexus"],
                        tribes: ["CB"],
                      },
                      {
                        category: ["spirit"],
                        tribes: ["CB", "EE"],
                        minCost: 4,
                      },
                    ],
                  },
                },
              ],
              remainder: "bottom",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0, 1],
        executionMode: "optional",
      },
      {
        timing: {
          kind: "continuous",
        },
        usageLimit: {
          kind: "no_duplicate",
        },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: {
                kind: "self",
              },
              symbol: "yellow",
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [3, 4],
        timingScope: {
          player: "self",
          period: "main",
        },
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "reduce_life",
          cause: ["battle"],
          triggerFilter: {
            tribes: ["CB"],
            category: ["spirit"],
          },
        },
        applicability: {
          soulState: true,
        },
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
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
                kind: "life",
                player: "self",
              },
              amount: 1,
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-C10",
    quartzData: {
      quartzName: "機功",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 地: 3, 水: 2, 時: 1 },
    },
    orikaId: 505,
    orikaIndex: 503,
    name: "[創の軌跡]ガルシア・ロッシ",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 5,
    reductionSymbols: ["white", "white", "white", "white"],
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
      {
        level: 3,
        requiredCores: 5,
        bp: 11000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "相手のスピリット/ネクサス1つをデッキの下に戻せる。",
      "",
      "Lv2-Lv3『相手のターン』",
      "相手の手札が相手の効果で増えたとき、自分はデッキの上から1枚ドローでき、増えたカード1枚につき相手は手札1枚を破棄する。この効果で相手の手札は0にならない。",
      "",
      "Lv3",
      "このスピリットはコスト5以下の相手の効果を受けない。",
      "",
      "【クォーツ：機功｜コストC2｜属性値：<地>3　<水>2　<時>1（手札から対象にセットできる）】",
      "自分のエンドステップ、自分の魂状態の「ENIGMA」の【クォーツ】の属性値の<地>の合計が10以上のとき、ボイドからコア2個を自分のリザーブに置ける。",
    ],
    keywordTags: ["soul_state"],
    tribe: "CB",
    image: "images/BSLH01-C10.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-3『召喚/アタック時』相手のスピリット/ネクサス1つをデッキの下に戻す。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [{ category: ["spirit"] }, { category: ["nexus"] }],
                },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『相手のターン』相手の手札が相手の効果で増えたとき、任意ドロー＋増分だけ相手は破棄。
      // hand_increase amount は event_amount で参照し、targetHandSize:1 + 動的 capCount で
      // 「増えたカード1枚につき」かつ「この効果で相手の手札は0にならない」を同時に表す。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "increase_hand",
          cause: ["self_effect"],
        },
        executionMode: "mandatory",
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "turn_player", player: "opponent" },
        ],
        steps: [
          {
            action: { kind: "draw", count: 1 },
            executionMode: "optional",
          },
          {
            action: {
              kind: "discard",
              player: "opponent",
              count: { source: { kind: "event_amount" } },
              targetHandSize: 1,
              capCount: { source: { kind: "event_amount" } },
            },
            connector: "sequential",
          },
        ],
        textRef: [3, 4],
      },
      // Lv3 このスピリットはコスト5以下の相手の効果を受けない。
      // sourceScope: maxCost=5 で発生源コスト≤5 限定。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 3 }],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { maxCost: 5 },
            },
          },
        ],
        textRef: [6, 7],
      },
      // 【クォーツ：機功】セット中効果: 自分エンドステップ、ENIGMA の<地>属性値合計10以上で
      // ボイドからコア2個を自分のリザーブに置ける。applicability.soulState でセット中のみ発火。
      {
        timing: { kind: "phase", step: "end", whose: "self" },
        applicability: { soulState: true },
        condition: [
          {
            kind: "quartz_attribute",
            player: "self",
            attribute: "地",
            min: 10,
          },
        ],
        executionMode: "optional",
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
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSLH01-C11",
    orikaId: 506,
    orikaIndex: 504,
    name: "セルゲイ・ロウ",
    printedCategory: "nexus",
    colors: ["black"],
    cost: 3,
    reductionSymbols: ["seven", "seven"],
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
    symbolColors: ["black"],
    textLines: [
      "Lv1-Lv2",
      "このネクサスのシンボルは赤/紫/緑/白/黄/青としても扱う。自分が系統：「S.S.S」を持つスピリットを召喚したとき、自分のデッキの上から1枚内容を見れる。それをデッキの上か下に戻す。",
      "",
      "Lv2『お互いのアタックステップ』",
      "自分のスピリット/アルティメットがアタックしたとき、自分のフィールド/リザーブに<ソウルコア>が無ければ、自分のライフのコア1個をボイドに置く。相手のスピリット/アルティメットがアタックしたとき、相手のフィールド/リザーブに<ソウルコア>がなければ、相手のライフのコア1個をトラッシュに置く。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-C11.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
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
              asColor: ["red", "purple", "green", "white", "yellow", "blue"],
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "summon",
          triggerFilter: {
            tribes: ["S.S.S"],
            category: ["spirit"],
          },
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 1,
              picks: [],
              remainder: "top_or_bottom",
              revealTo: "self",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "attack",
          triggerFilter: {
            category: ["spirit", "ultimate"],
          },
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
          {
            kind: "soul_core_zone",
            player: "self",
            zones: ["field", "reserve"],
            negate: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "life",
                player: "self",
              },
              to: {
                kind: "void",
                player: "self",
              },
              amount: 1,
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "attack",
          triggerFilter: {
            category: ["spirit", "ultimate"],
          },
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
          {
            kind: "soul_core_zone",
            player: "opponent",
            zones: ["field", "reserve"],
            negate: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "life",
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
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSLH01-C12",
    orikaId: 507,
    orikaIndex: 505,
    name: "ミシュラムワンダーランド",
    printedCategory: "nexus",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 4,
    reductionSymbols: ["seven", "seven"],
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
    symbolColors: ["blue", "blue"],
    textLines: [
      "Lv1-Lv2",
      "このネクサスのシンボルは赤/紫/緑/白/黄/黒としても扱う。",
      "",
      "Lv1-Lv2『お互いのアタックステップ』",
      "お互い、「エンジョ〜イ、みっしぃ！」と宣言しなければアタック/ブロックできない。このネクサスがLv2のとき、お互い、ライフが減るとき、ターンに1回ずつ、「エンジョ〜イ、みっしぃ！」と宣言することで、減るコアの数を-1する。",
      "",
      "Lv2『自分のメインステップ』",
      "ターンに1回、2コスト支払うことで、自分のフィールドにいないトークンの「みっしぃ」/「みーしぇ」/「メカみっしぃ」1体ずつを出す。",
    ],
    keywordTags: [],
    tribe: "CB",
    image: "images/BSLH01-C12.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSLH01-T01", "BSLH01-T02", "BSLH01-T03"],
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
              asColor: ["red", "purple", "green", "white", "yellow", "black"],
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "continuous",
        },
        timingScope: {
          player: "both",
          period: "attack",
        },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  declaredThisTurn: false,
                },
                count: "all",
              },
              restriction: ["attack", "block"],
              duration: {
                scope: "while_on_field",
              },
            },
          },
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  declaredThisTurn: false,
                },
                count: "all",
              },
              restriction: ["attack", "block"],
              duration: {
                scope: "while_on_field",
              },
            },
            connector: "sequential",
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
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "replace",
              declareGimmickGate: {
                reduceBy: 1,
              },
              duration: {
                scope: "while_on_field",
              },
            },
          },
          {
            action: {
              kind: "life_damage_interception",
              player: "opponent",
              cause: "any",
              mode: "replace",
              declareGimmickGate: {
                reduceBy: 1,
              },
              duration: {
                scope: "while_on_field",
              },
            },
            connector: "sequential",
          },
        ],
        textRef: [3, 4],
        timingScope: {
          player: "both",
          period: "attack",
        },
      },
      {
        timing: {
          kind: "activated",
          mode: "main",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
        },
        steps: [
          {
            id: "c12-token-cost",
            action: {
              kind: "pay_cost",
              amount: 2,
            },
          },
          {
            connector: "conditional_cost",
            action: {
              kind: "put",
              target: {
                kind: "from_token_pool",
                count: 1,
                allRelatedTokens: true,
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-C13",
    orikaId: 508,
    orikaIndex: 506,
    name: "零の軌跡",
    printedCategory: "magic",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 4,
    reductionSymbols: ["seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュにあるこのカードは、一切の効果を受けない。",
      "手札にあるこのカードは、相手の効果を受けず、相手によって自分のライフが減ったとき、コストを支払わずに使用できる。",
      "",
      "【タイプ：フィールド（フィールドにある間、次の効果を発揮する。）】",
      "■自分の創界神ネクサス/導界者ネクサスが相手の効果の対象になるとき、このカードを破棄することで、対象1つは、その効果を受けない。",
      "",
      "フラッシュ",
      "このバトル終了時、アタックステップを終了する。その後、このカードをフィールドに置ける。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-C13.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // トラッシュにあるこのカードは、一切の効果を受けない。
      {
        applicability: { zone: ["trash"] },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
              sourcePlayerScope: "any",
            },
          },
        ],
        textRef: [0],
      },
      // 手札にあるこのカードは相手の効果を受けない。
      {
        applicability: { zone: ["hand"] },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [1],
      },
      // ENGINE-conditional-free-magic-use-on-event: 手札にあるこのカードは、相手によって
      // 自分のライフが減ったとき、コストを支払わずに使用できる。先例 BSTS01-R03。
      {
        applicability: { zone: "hand" },
        timing: {
          kind: "game_event",
          player: "self",
          event: "reduce_life",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        steps: [
          {
            action: { kind: "use_magic_without_cost", magicTiming: "flash" },
          },
        ],
        textRef: [1],
      },
      // 【タイプ：フィールド】創界神/導界者ネクサスが相手効果の対象時、破棄で対象1つは効果を受けない。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "targeted",
          triggerFilter: {
            category: ["nexus"],
            targetsGrandwalker: "only",
          },
          cause: ["opponent_effect"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "move_card",
              target: { kind: "self" },
              from: { zone: "field", player: "self" },
              to: { zone: "trash" },
              count: 1,
              requireFullCount: true,
            },
          },
          {
            connector: "conditional_cost",
            action: {
              kind: "effect_immunity",
              target: { kind: "trigger_related_instance" },
              duration: { scope: "current_effect" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // フラッシュ このバトル終了時、アタックステップを終了する。その後、このカードをフィールドに置ける。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: { kind: "end_attack_step" },
            deferTo: "battle_end",
          },
          {
            id: "place-on-field",
            action: { kind: "move_self", destination: "field" },
            executionMode: "optional",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-C14",
    orikaId: 509,
    orikaIndex: 507,
    name: "碧の軌跡",
    printedCategory: "magic",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 5,
    reductionSymbols: ["seven", "seven", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュにあるこのカードは、このカード以外の効果を受けず、〔ゲームに1回：同名〕系統：「CB」を持つ自分の創界神ネクサス/導界者ネクサスが配置されたとき、手札に戻せる。",
      "",
      "フラッシュ",
      "〔ターンに1回:同名〕自分のデッキを上から3枚オープンする。その中のスピリットカード1枚につき、自分の創界神ネクサス/導界者ネクサスにコア+1する。その後、その中のカード1枚までを手札に加え、残ったカードはデッキの下に戻す。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-C14.webp",
    rarity: "C",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: {
          zone: ["trash"],
        },
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "self",
              },
              sourcePlayerScope: "any",
              sourceScope: {
                excludeSelf: true,
              },
              duration: {
                scope: "while_in_trash",
              },
            },
          },
        ],
        textRef: [0],
      },
      {
        applicability: {
          zone: ["trash"],
        },
        timing: {
          kind: "game_event",
          player: "self",
          event: "place",
          triggerFilter: {
            category: ["nexus"],
            tribes: ["CB"],
            targetsGrandwalker: "only",
          },
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_card_name",
          duration: "game",
        },
        steps: [
          {
            action: {
              kind: "move_card",
              target: {
                kind: "self",
              },
              from: {
                zone: "trash",
                player: "self",
              },
              to: {
                zone: "hand",
              },
              count: 1,
              requireFullCount: true,
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
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            id: "c14reveal",
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                },
              ],
              remainder: "bottom",
              beforePickSteps: [
                {
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
                        targetsGrandwalker: "only",
                      },
                    },
                    amount: {
                      source: {
                        kind: "cards_from_ref",
                        stepId: "c14reveal",
                        filter: {
                          category: ["spirit"],
                        },
                        result: "revealed",
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSLH01-CX01",
    quartzHostData: {
      slots: { left: 3, center: 1, right: 3 },
      inheritsSetQuartzEffects: true,
    },
    // 【アーツ】自己配置トークンの候補プール。SBA が魂状態 host 経由でこの一覧を発見し、
    // 各トークンの summonCondition (属性値閾値) を継続監視して自動配置する。
    relatedTokenCardNos: [
      "BSLH01-T07",
      "BSLH01-T08",
      "BSLH01-T09",
      "BSLH01-T10",
      "BSLH01-T11",
      "BSLH01-T12",
      "BSLH01-T13",
      "BSLH01-T14",
      "BSLH01-T15",
      "BSLH01-T16",
      "BSLH01-T17",
    ],
    orikaId: 510,
    orikaIndex: 508,
    name: "ENIGMA[戦術オーブメント]",
    printedCategory: "brave",
    colors: ["blue", "white"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに1枚しか入れられず、魂状態以外でフィールドに存在できない。",
      "魂状態のこのカードには、クォーツ名の異なるカードを右左に3枚ずつまでと中央に1枚までセットできる。（セット中のカードは魂状態として扱う。）",
      "手札/手元にあるこのカードは、自分のメインステップに魂状態にできる。",
      "",
      "【魂状態】",
      "このカードが魂状態になったときと、自分のスタートステップに、自分のカウント+2する。また、自分のクォーツがセットされたとき、〔ターンに2回：同名〕自分はデッキの上から1枚ドローできる。",
      "",
      "【魂状態】",
      "このカードは、このカードにセット中のカードの【クォーツ】すべてを得て、発揮する。自分が系統：「CB」を持つカードを召喚/配置するとき、その軽減シンボルを<七>として扱う。",
      "",
      "【セット条件：【クォーツ】を持つカード】",
    ],
    keywordTags: ["soul_state", "contract"],
    tribe: "導力器",
    image: "images/BSLH01-CX01.webp",
    rarity: "CX",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "phase",
          step: "start",
          whose: "self",
        },
        applicability: {
          soulState: true,
        },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
            },
          },
        ],
        textRef: [4, 5],
      },
      {
        timing: {
          kind: "card_event",
          event: "enter_soul_state",
        },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
            },
          },
        ],
        textRef: [4, 5],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "quartz_set",
        },
        applicability: {
          soulState: true,
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 2,
        },
        steps: [
          {
            prompt: {
              sourceText:
                "自分のクォーツがセットされたとき、〔ターンに2回：同名〕自分はデッキの上から1枚ドローできる。",
            },
            action: {
              kind: "draw",
              count: 1,
            },
          },
        ],
        textRef: [4, 5],
      },
      {
        timing: {
          kind: "activated",
          mode: "main",
        },
        applicability: {
          zone: ["hand", "set_aside"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "enter_soul_state",
              target: {
                kind: "self",
              },
            },
          },
        ],
        textRef: [2],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [],
        textRef: [0],
      },
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          soulState: true,
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["reduction_symbol"],
              asColor: ["seven"],
              whenPayingForFilter: {
                tribes: ["CB"],
                category: ["spirit", "ultimate", "brave", "nexus"],
              },
              overridesRequiredColor: true,
            },
          },
        ],
        textRef: [1, 7, 8, 10],
      },
    ],
  },
  {
    cardNo: "BSLH01-M01",
    quartzData: {
      quartzName: "精神3",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 幻: 5 },
    },
    orikaId: 511,
    orikaIndex: 509,
    name: "[碧の軌跡]リーシャ・マオ",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 6,
    reductionSymbols: ["purple", "purple", "purple"],
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
        bp: 12000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "手札/手元にあるこのカードは、自分か相手のライフが減ったとき、1コスト支払って召喚できる。",
      "",
      "Lv1-Lv2-Lv3 フラッシュ『お互いのアタックステップ』",
      "3コストまで支払うことで、支払ったコストにより以下の効果を発揮する。",
      "1コスト以上：支払ったコスト1につき、相手のスピリット/アルティメットのコア1個をリザーブに置く。",
      "2コスト以上：相手の創界神ネクサス1つのコアすべてをボイドに置く。",
      "3コスト：〔ターンに1回：同名〕このスピリットを手札に戻し、自分のトラッシュにある系統：「CB」を持つカード1枚を手札に戻す。",
      "",
      "【クォーツ：精神3｜コストC2｜属性値：<幻>5（手札から対象にセットできる）】",
      "自分のトークンマジックの「破壊効果」/「疲労効果」のコスト上限を+3する。",
    ],
    keywordTags: [],
    tribe: "CB・CR・S.S.S",
    image: "images/BSLH01-M01.webp",
    rarity: "M",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: {
          zone: ["hand", "set_aside"],
        },
        timing: {
          kind: "game_event",
          player: "either",
          event: "reduce_life",
          sourceWhose: "either",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
              costModifier: {
                fixedPayment: 1,
              },
            },
          },
        ],
        textRef: [0],
      },
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: {
          player: "both",
          period: "attack",
        },
        steps: [
          {
            id: "m01-pay-choice",
            action: {
              kind: "noop",
            },
            choice: [
              {
                action: {
                  kind: "pay_cost",
                  amount: 1,
                },
              },
              {
                action: {
                  kind: "pay_cost",
                  amount: 2,
                },
              },
              {
                action: {
                  kind: "pay_cost",
                  amount: 3,
                },
              },
            ],
          },
          {
            id: "m01-core-1",
            connector: "conditional_cost",
            conditionalCostAlternativeStepIds: [
              "m01-core-2",
              "m01-core-3",
              "m01-guide-core",
              "m01-pay3-bounce-self",
              "m01-return-trash",
            ],
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_choice",
                  stepId: "m01-pay-choice",
                  choiceIndex: 0,
                  not: true,
                },
                {
                  kind: "ref_succeeded",
                  stepId: "m01-pay-choice",
                },
              ],
            },
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    {
                      category: ["spirit"],
                    },
                    {
                      category: ["ultimate"],
                    },
                  ],
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
              amount: 1,
            },
          },
          {
            id: "m01-core-2",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_choice",
                  stepId: "m01-pay-choice",
                  choiceIndex: 0,
                  not: true,
                },
                {
                  kind: "ref_choice",
                  stepId: "m01-pay-choice",
                  choiceIndex: 1,
                  not: true,
                },
                {
                  kind: "ref_succeeded",
                  stepId: "m01-pay-choice",
                },
              ],
            },
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    {
                      category: ["spirit"],
                    },
                    {
                      category: ["ultimate"],
                    },
                  ],
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
              amount: 1,
            },
          },
          {
            id: "m01-core-3",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_choice",
                  stepId: "m01-pay-choice",
                  choiceIndex: 3,
                },
                {
                  kind: "ref_succeeded",
                  stepId: "m01-pay-choice",
                },
              ],
            },
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    {
                      category: ["spirit"],
                    },
                    {
                      category: ["ultimate"],
                    },
                  ],
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
              amount: 1,
            },
          },
          {
            id: "m01-guide-core",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_choice",
                  stepId: "m01-pay-choice",
                  choiceIndex: 0,
                  not: true,
                },
                {
                  kind: "ref_choice",
                  stepId: "m01-pay-choice",
                  choiceIndex: 1,
                  not: true,
                },
                {
                  kind: "ref_succeeded",
                  stepId: "m01-pay-choice",
                },
              ],
            },
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                },
                count: 1,
              },
              from: {
                kind: "target_card",
              },
              to: {
                kind: "void",
                player: "opponent",
              },
              amount: "all",
            },
          },
          {
            id: "m01-pay3-bounce-self",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_choice",
                  stepId: "m01-pay-choice",
                  choiceIndex: 3,
                },
                {
                  kind: "ref_succeeded",
                  stepId: "m01-pay-choice",
                },
              ],
            },
            action: {
              kind: "bounce",
              target: {
                kind: "self",
              },
            },
            usageLimit: {
              kind: "per_card_name",
              duration: "turn",
              maxCount: 1,
            },
          },
          {
            id: "m01-return-trash",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_choice",
                  stepId: "m01-pay-choice",
                  choiceIndex: 3,
                },
                {
                  kind: "ref_succeeded",
                  stepId: "m01-pay3-bounce-self",
                },
              ],
            },
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                filter: {
                  tribes: ["CB"],
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [2, 3, 4, 5, 6],
      },
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          soulState: true,
        },
        steps: [
          {
            action: {
              kind: "effect_param_modify",
              effectClass: "cost_destroy",
              scope: "player_cards",
              cardFilter: {
                category: ["magic"],
                isToken: true,
              },
              addLimitAmount: 3,
              duration: {
                scope: "while_on_field",
              },
            },
          },
          {
            action: {
              kind: "effect_param_modify",
              effectClass: "cost_exhaust",
              scope: "player_cards",
              cardFilter: {
                category: ["magic"],
                isToken: true,
              },
              addLimitAmount: 3,
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
    cardNo: "BSLH01-M02",
    orikaId: 512,
    orikaIndex: 510,
    name: "ツァイト",
    printedCategory: "spirit",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 4,
    reductionSymbols: ["seven"],
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
    symbolColors: ["black"],
    textLines: [
      "このカードはデッキに1枚しか入れられない。",
      "トラッシュにあるこのカードは一切の効果を受けない。",
      "",
      "フラッシュ",
      "手札にあるこのカードは召喚できる。このとき、自分のフィールドにスピリット/アルティメットがいないとき、このカードをコスト2にする。この効果で召喚したとき、相手のスピリット2体を疲労させる。",
      "",
      "Lv1-Lv2『お互いのエンドステップ』",
      "このスピリット以外の自分のスピリットがいるとき、このスピリットをデッキに戻す。そうしたとき、自分は、自分のデッキをシャッフルし、その後、デッキの上から1枚までドローする。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-M02.webp",
    rarity: "M",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: {
          zone: ["trash"],
        },
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "self",
              },
              duration: {
                scope: "permanent",
              },
              sourcePlayerScope: "any",
            },
          },
        ],
        textRef: [1],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        applicability: {
          zone: "hand",
        },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["spirit", "ultimate"],
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        applicability: {
          zone: "hand",
        },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            category: ["spirit", "ultimate"],
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
              costModifier: {
                override: 2,
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "card_event",
          event: "summon",
          sourceEffectIndex: [1, 2],
        },
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 2,
              },
              state: "exhausted",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        applicability: {
          level: {
            min: 1,
            max: 2,
          },
        },
        timing: {
          kind: "phase",
          step: "end",
          whose: "either",
        },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            excludeSelf: true,
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "self",
              },
              position: "bottom",
            },
            id: "m02-return-self",
          },
          {
            action: {
              kind: "shuffle_zone",
              zone: "deck",
            },
            connector: "conditional_result",
          },
          {
            action: {
              kind: "draw",
              count: 1,
            },
            executionMode: "optional",
            connector: "sequential",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "m02-return-self",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-M03",
    quartzData: {
      quartzName: "双児珠",
      cost: 0,
      reduction: [],
      countCost: 2,
      replacementProhibitedFromZones: ["hand"],
      attributeValues: { 幻: 5 },
    },
    orikaId: 513,
    orikaIndex: 511,
    name: "[碧の軌跡]ヨシュア・ブライト",
    printedCategory: "spirit",
    colors: ["black"],
    cost: 6,
    reductionSymbols: ["black", "black", "black", "black"],
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
    symbolColors: ["black"],
    textLines: [
      "クォーツとしてセット中のこのカードは、手札から入れ替えてセットできない。",
      "",
      "【バースト：相手のスピリット/アルティメットのアタック後】",
      "このカードをコストを支払わずに召喚するか、自分の魂状態の対象にコストを支払わずにセットする。その後、スピリット/アルティメット2体までを除外する。この効果発揮後、除外した対象を持ち主のフィールドに疲労状態でコストを支払わずに召喚する。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "このスピリットはブロックされない。さらに、ターンに1回、このスピリットは回復できる。",
      "",
      "【クォーツ：双児珠｜コストC2｜属性値：<幻>5（手札から対象にセットできる）】",
      "ターンに1回、自分は、フィールドにあるコスト6以下のトークンマジックカードのフラッシュ効果を、スタックタイミングにスタック効果として使用できる。",
    ],
    keywordTags: ["burst", "soul_state"],
    tribe: "LK・CB・遊撃士",
    image: "images/BSLH01-M03.webp",
    rarity: "M",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：相手のスピリット/アルティメットのアタック後】召喚/セット（BSLH01-M04[0,1]と
      // 同型 choice: summon(self,free) / quartz_set(self,free)）→スピリット/アルティメット
      // 2体まで除外→除外した対象を持ち主のフィールドに疲労状態でコストなし再召喚。
      // attack_finished trigger は BSTH003-X02 等で実例あり (旧 stub note は stale。
      // 「アタックするのは常にスピリット/アルティメットのため category フィルタは不要」
      // model.ts BurstTrigger.attack_finished コメントどおり triggerFilter 省略)。
      // 除外→再召喚連鎖は summon target.kind:"ref" (engine-exclude-owner-resummon-exhausted
      // 新設primitive) で表現: 直前 remove_from_game step の affectedCardInstanceIds を
      // そのまま召喚対象にし、toOwnerField:true で各対象をその持ち主のフィールドへ、
      // entersExhausted:true で疲労状態にする。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "attack_finished", player: "opponent" },
        },
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
            choice: [
              {
                action: {
                  kind: "quartz_set",
                  target: { kind: "self" },
                  free: true,
                },
              },
            ],
          },
          {
            targetSelectionTiming: "on_step",
            id: "exclude-targets",
            action: {
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "either",
                filter: { category: ["spirit", "ultimate"] },
                count: { min: 0, max: 2 },
              },
            },
            connector: "sequential",
          },
          {
            // remove_from_game は pendingLeave 経由のため、直前 step 直後の時点では対象の
            // zone はまだ "field" のまま（実際の "removed_from_game" への移動は SBA flush
            // 時）。structured-summon.ts executeRefSummon の `card.zone === "field"` skip
            // ガード（既にフィールドにいる対象を二重召喚しないためのもの）がこれを
            // 誤って「フィールド在」と見なして skip してしまうため、"after_triggers"
            // (native-condition-connector.ts の flushPendingLeaves 相当処理) で先に
            // pendingLeave を実ゾーン移動へ確定させてから本 step を実行する。
            // ("affectedCardInstanceIds" 自体は resolvedTargetIds 経由で即時確定するため
            // flush 前後で値は変わらない — 影響するのは対象カードの実 zone のみ)。
            action: {
              kind: "summon",
              target: { kind: "ref", stepId: "exclude-targets" },
              toOwnerField: true,
              entersExhausted: true,
              costModifier: "free",
            },
            connector: "after_triggers",
          },
        ],
        textRef: [0, 2, 3],
      },
      // Lv2-Lv3『アタック時』このスピリットはブロックされず、ターンに1回回復できる。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "unblockable",
              target: { kind: "self" },
              duration: { scope: "attack" },
            },
          },
          {
            action: { kind: "recover", target: { kind: "self" } },
            executionMode: "optional",
            usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
      // 【クォーツ：双児珠】セット効果: ターンに1回、フィールドのコスト6以下のトークンマジック
      // カードのフラッシュ効果をスタックタイミングにスタック効果として使用できる。
      // borrow_magic_effect (BSAZ03-M01 precedent) で表現。BSAZ03-M01 は zone:"trash" から
      // 借用するが、本カードは「フィールドにある」トークンマジックが対象のため zone:"field"
      // (TargetSpec.filter の zone 省略時デフォルト) を明示する。hasActivatedEffectMode:["flash"]
      // で対象カードが flash モード効果を持つことを絞り込み、borrowModes:["flash"] で
      // 借用実行時にその flash 効果を発揮する（このスタック効果自体は mode:"stack"）。
      // applicability.soulState:true でセット中のみ register。
      {
        timing: { kind: "activated", mode: "stack" },
        applicability: { soulState: true },
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "borrow_magic_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: "field",
                filter: {
                  category: ["magic"],
                  isToken: true,
                  maxCost: 6,
                  hasActivatedEffectMode: ["flash"],
                },
                count: 1,
              },
              borrowModes: ["flash"],
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSLH01-M04",
    quartzData: {
      quartzName: "龍眼",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 幻: 5, 火: 2, 空: 2 },
    },
    orikaId: 514,
    orikaIndex: 512,
    name: "[碧の軌跡]シャーリー・オルランド",
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
        requiredCores: 2,
        bp: 9000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 12000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "【バースト：相手によって自分のスピリットがフィールドを離れた後】",
      "このカードをコストを支払わずに召喚するか、自分の魂状態の対象にコストを支払わずにセットする。その後、相手のスピリット/アルティメット2体を消滅させる。消滅する対象のコアすべてはリザーブに置かれる。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "このターンの間、相手のスピリット/ネクサスの1つのLvコスト+2できる。この効果で消滅したとき、自分はデッキの上から2枚ドローできる。",
      "",
      "【クォーツ：龍眼｜コストC2｜属性値：<幻>5 <火>2 <空>2（手札から対象にセットできる）】",
      "ターンに1回、自分のスピリットの効果で、相手のスピリット/アルティメットがフィールドを離れたとき、対象1体につき、相手のデッキを上から1枚内容を見る。それらを好きなようにデッキの上か下に戻す。",
    ],
    keywordTags: ["burst", "soul_state"],
    tribe: "CB",
    image: "images/BSLH01-M04.webp",
    rarity: "M",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：相手によって自分のスピリットがフィールドを離れた後】コストなし召喚 or 魂状態対象へ
      // コストなしクォーツセット（BSLH01-R05[0,1] と同型 choice: summon(self,free) / quartz_set(self,free)）
      // →相手スピ/アルティ2体消滅。vanish はコアがリザーブに置かれる既定挙動
      // （VanishAction コメント「消滅: 破壊と異なりコアはリザーブに置かれる」）でそのまま満たす。
      // burst trigger は「相手によって自分のスピリットがフィールドを離れた後」の既存表現
      // （BSTH06-M01/BSTH07/BSTH08 前例と同一の spirit_destroyed+triggerFilter+cause）。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "spirit_destroyed", player: "self" },
          triggerFilter: { category: ["spirit"] },
          cause: ["opponent_effect", "battle"],
        },
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
            choice: [
              {
                action: {
                  kind: "quartz_set",
                  target: { kind: "self" },
                  free: true,
                },
              },
            ],
          },
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "vanish",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 2,
              },
            },
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-3『アタック時』相手のスピリット/ネクサス1つのLvコスト+2（このターン）、
      // この効果で消滅したらドロー2。
      // override_properties.levelCostDelta（Lv コスト加算修飾）で対象 1 体の最低 Lv コストを
      // +2 する。加算で最低コアを満たせなくなった対象は SBA で消滅 → ref_leave_established で
      // 消滅成立を観測して任意で 2 ドロー（after_state_check。誘発は割り込まない）。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        steps: [
          {
            id: "lv-cost-up",
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "nexus"] },
                count: 1,
              },
              properties: { levelCostDelta: 2 },
              duration: { scope: "turn" },
            },
          },
          {
            connector: "after_state_check",
            stepCondition: {
              kind: "ref_leave_established",
              stepId: "lv-cost-up",
              leaveKind: "vanish",
            },
            executionMode: "optional",
            action: { kind: "draw", count: 2 },
          },
        ],
        textRef: [3, 4],
      },
      // 【クォーツ：龍眼】セット中効果: ターンに1回、自分のスピリットの効果で相手のスピリット/
      // アルティメットがフィールドを離れたとき、対象1体につき、相手のデッキ上1枚の内容を見て、
      // 好きなように上か下に戻す。第三者離脱観測は BSLH01-C08 天秤珠と同型 (game_event
      // leave_field + triggerSourceFilter:spirit + sourceWhose:"either")。「見て上か下に戻す」は
      // deck_reveal(picks:[], remainder:"top_bottom_split") で表現（カード別に上/下を選び、順序も指定）。
      // sourceWhose は leave_field family の観測対象 ownership を緩めるために either が必要。
      // 発生源プレイヤーの「自分のスピリットの効果」は condition:trigger_source_player(self) で
      // effectSourceInstanceId(s) 側を評価する。
      // 「対象1体につき」: 自分のスピリットの単一効果で相手のスピリット/アルティメット2体以上が
      // 「同時に」離脱した場合、各離脱は独立 event として push されるが (trigger-system.ts
      // queueReactionsInternal が同一 simultaneousGroupId 内で related instance を
      // relatedInstanceIdsBySourceRegistrationKey に集約済み)、
      // revealCount: { source: { kind: "trigger_related_instances_count" } } が
      // その集約件数を動的に読むため、1回の発揮で対象数ぶん reveal する
      // (usageLimit:{kind:"per_instance",duration:"turn",maxCount:1} は「ターンに1回」の
      // 起動可否ゲートのみを担い、2件目以降の同時離脱 event は同じ発揮の中で吸収済みのため
      // 独立起動しない=意図通り)。単体離脱時は集約件数1で従来どおり revealCount:1 相当。
      // ENGINE-simultaneous-leave-field-batch-trigger 着地、needs-dsl.audit.jsonl:
      // BSLH01-M04 参照。
      // 原文「見る。」「戻す。」はいずれも終止形(可能形「見れる」「戻せる」ではない)のため
      // 発揮自体は強制 (executionMode 省略=mandatory、10_rules 可能形/終止形裁定)。
      // 戻す位置(上/下)の選択のみ deck_reveal.remainder:"top_bottom_split" で表現。
      // applicability.soulState でセット中のみ発火。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "leave_field",
          exactEventKind: true,
          triggerFilter: { category: ["spirit", "ultimate"] },
          triggerSourceFilter: { category: ["spirit"] },
          cause: ["opponent_effect"],
          sourceWhose: "either",
        },
        applicability: { soulState: true },
        condition: [{ kind: "trigger_source_player", player: "self" }],
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              player: "opponent",
              revealCount: {
                source: { kind: "trigger_related_instances_count" },
              },
              revealTo: "self",
              picks: [],
              remainder: "top_bottom_split",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-M05",
    orikaId: 515,
    orikaIndex: 513,
    name: "創の軌跡",
    printedCategory: "magic",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 4,
    reductionSymbols: ["seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "系統：「CB」を持つ自分の効果でデッキからオープンされた/トラッシュに置かれたこのカードは手札1枚と入れ替えられる。",
      "",
      "手札にあるこのカードは、アタックステップ中、相手の効果で自分のライフが減るとき、コストを支払わずに使用することで自分のライフは減らない。",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕〔アタックステップ〕待機状態を含む自分のスピリット/アルティメットがいないとき、自分のトラッシュにある系統：「CB」を持つスピリットカード2枚までをコストを支払わずに召喚する。",
      "このカードの効果で使用していたとき、「待機状態を含む自分のスピリット/アルティメットがいないとき」を無視して発揮できる。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-M05.webp",
    rarity: "M",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // CB の自分効果でオープン/トラッシュされたこのカードは手札1枚と入れ替え。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "swap" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          { kind: "trigger_tribes", tribes: ["CB"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [],
        executionMode: "optional",
        textRef: [0],
      },
      // 手札にあるこのカードは、アタックステップ中、相手の効果で自分のライフが減るとき、
      // コストを支払わずに使用することで自分のライフは減らない。
      // = life_damage_interception(replace, cause:opponent_effect,
      // useCostGate:{zones:[hand]})。discardCostGate (BSTH02.7-C05[1] 等) の使用版兄弟
      // パターン: 支払いは破棄ではなく「このカードの使用」(最終的にトラッシュへ置かれる点は
      // discardCostGate と同じ)。「アタックステップ中」限定は ConditionClause ではなく
      // timingScope（continuous 効果限定の構造フィールド）で表現する
      // (collectDirectLifeDamageCostGateEntries が isTimingScopeActive で判定。手札ゾーンの
      // continuous 効果は condition 付きだと評価不能という既存制約を timingScope 経由で回避)。
      // pay 確定時 lifeDamageInterceptionUseCostGateUsedThisTurn に記録され、effects[2] の
      // 条件がこれを any_of で参照して textLines[6] の条件無視を表現する。
      {
        applicability: { zone: "hand" },
        timing: { kind: "continuous" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "opponent_effect",
              mode: "replace",
              useCostGate: { zones: ["hand"], effectIndex: 2 },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [2],
      },
      // フラッシュ〔ターンに1回:同名〕〔アタックステップ〕待機状態を含む自分のスピ/
      // アルティメットがいないとき、トラッシュの CB スピリット2枚までをコストなし召喚。
      // field_lacks は field 上の pendingLeave 個体を除外しないため、「待機状態を含む」を満たす。
      // textLines[6]「このカードの効果で使用していたとき、条件を無視して発揮できる」は
      // any_of で field_lacks と OR 結合する: effects[1] の useCostGate pay 確定時に立つ
      // life_damage_interception_use_cost_gate_paid_this_turn フラグが真なら
      // field_lacks の成否に関わらず発揮できる。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        condition: [
          {
            kind: "any_of",
            groups: [
              [
                {
                  kind: "field_lacks",
                  player: "self",
                  category: ["spirit", "ultimate"],
                },
              ],
              [
                {
                  kind: "life_damage_interception_use_cost_gate_paid_this_turn",
                  player: "self",
                },
              ],
            ],
          },
        ],
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "trash",
                filter: { category: ["spirit"], tribes: ["CB"] },
                count: { min: 0, max: 2 },
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [4, 5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-R01",
    quartzData: {
      quartzName: "駆動",
      cost: 0,
      reduction: [],
      countCost: 1,
      attributeValues: { 時: 3 },
    },
    orikaId: 516,
    orikaIndex: 514,
    name: "[碧の軌跡]ロイド・バニングス",
    printedCategory: "spirit",
    colors: ["black"],
    cost: 5,
    reductionSymbols: ["black", "black", "black"],
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
      {
        level: 3,
        requiredCores: 4,
        bp: 10000,
      },
    ],
    symbolColors: ["black"],
    textLines: [
      "Lv1-Lv2-Lv3",
      "ターンに1回、このスピリットが相手によってフィールドを離れるとき、ボイドからコア1個をこのスピリットに置くことで、回復状態でフィールドに残す。",
      "",
      "Lv2-Lv3 フラッシュ",
      "ターンに1回、このスピリットを疲労させることで、自分の手札/トラッシュにある【クォーツ】を持つカード1枚までを魂状態の対象にセットする。その後、セットした系統：「CB」を持つカードの『このスピリットの召喚時』/『このスピリットのアタック時』効果1つをLvを無視して発揮する。",
      "",
      "【クォーツ：駆動｜コストC1｜属性値：<時>3（手札から対象にセットできる）】",
      "ターンに1回、自分はフィールドにあるコスト5以下のトークンマジックカードのフラッシュ効果を、スタックタイミングにスタック効果として使用できる。",
    ],
    keywordTags: ["soul_state"],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-R01.webp",
    rarity: "R",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
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
                kind: "this_card",
              },
              amount: 1,
            },
          },
          {
            action: {
              kind: "stay_on_field",
              target: {
                kind: "self",
              },
              newExhaustState: "recovered",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
      },
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "flash",
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
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              target: {
                kind: "self",
              },
              state: "exhausted",
            },
          },
          {
            id: "r01-quartz-set",
            targetSelectionTiming: "on_step",
            action: {
              kind: "quartz_set",
              target: {
                kind: "filter",
                player: "self",
                zone: ["hand", "trash"],
                filter: {
                  hasQuartzData: true,
                },
                count: {
                  min: 0,
                  max: 1,
                },
              },
            },
            connector: "conditional_cost",
          },
          {
            action: {
              kind: "borrow_card_event_effect",
              target: {
                kind: "ref",
                stepId: "r01-quartz-set",
              },
              borrowEvents: ["summon", "attack"],
              ignoreLevelCondition: true,
              requiredTribes: ["CB"],
              attributeToBorrowedCard: true,
            },
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "r01-quartz-set",
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
        applicability: {
          soulState: true,
        },
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "borrow_magic_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: "field",
                filter: {
                  category: ["magic"],
                  isToken: true,
                  maxCost: 5,
                  hasActivatedEffectMode: ["flash"],
                },
                count: 1,
              },
              borrowModes: ["flash"],
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-R02",
    quartzData: {
      quartzName: "美臭",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 風: 4, 空: 1, 水: 1, 火: 2 },
    },
    orikaId: 517,
    orikaIndex: 515,
    name: "[碧の軌跡]エリィ・マクダエル",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green", "green"],
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
    symbolColors: ["green"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚/アタック時』",
      "自分のカウント+1でき、ボイドからコア1個を自分のスピリットに置ける。その後、自分のカウント4以上のとき、相手のスピリット1体を重疲労させる。自分の魂状態の「ENIGMA」の【クォーツ】の属性値の<風>の合計が6以上のとき、相手の創界神ネクサスのコア4個をボイドに置く。",
      "",
      "Lv2 フラッシュ/スタック『お互いのアタックステップ』",
      "ターンに1回、自分のスピリット1体を回復させる。",
      "",
      "【クォーツ：美臭｜コストC2｜属性値：<風>4 <空>1 <水>1 <火>2（手札から対象にセットできる）】",
      "ターンに1回、自分のスピリットが相手のスピリットの効果の対象になるとき、その対象を自分が選ぶ自分のスピリット1体のみに変更できる。",
    ],
    keywordTags: ["soul_state"],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-R02.webp",
    rarity: "R",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "core_distribute",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
              amount: 1,
              mode: "player_choice",
            },
            connector: "simultaneous",
            executionMode: "optional",
          },
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
              degree: "heavy_exhaust",
            },
            condition: [
              {
                kind: "count_value",
                player: "self",
                min: 4,
              },
            ],
            connector: "sequential",
          },
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                },
                count: 1,
              },
              from: {
                kind: "target_card",
              },
              to: {
                kind: "void",
                player: "opponent",
              },
              amount: 4,
            },
            condition: [
              {
                kind: "quartz_attribute",
                player: "self",
                attribute: "風",
                min: 6,
              },
            ],
            connector: "sequential",
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        timingScope: {
          player: "both",
          period: "attack",
        },
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
        },
        limitGroupId: "BSLH01-R02-recover",
        steps: [
          {
            action: {
              kind: "recover",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
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
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        timingScope: {
          player: "both",
          period: "attack",
        },
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
        },
        limitGroupId: "BSLH01-R02-recover",
        steps: [
          {
            action: {
              kind: "recover",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
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
        applicability: {
          soulState: true,
        },
        steps: [
          {
            action: {
              kind: "register_redirect_effect_target",
              protectedTarget: {
                kind: "owned_filter",
                filter: {
                  category: ["spirit"],
                },
              },
              sourcePlayerRef: "opponent",
              sourceFilter: {
                category: ["spirit"],
              },
              redirectCandidate: {
                kind: "owned_filter",
                filter: {
                  category: ["spirit"],
                },
              },
              optional: true,
              usageLimit: {
                kind: "per_instance",
                duration: "turn",
                maxCount: 1,
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-R03",
    quartzData: {
      quartzName: "練気",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 火: 3, 風: 2, 水: 1 },
    },
    orikaId: 518,
    orikaIndex: 516,
    name: "[碧の軌跡]ランディ・オルランド",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "red"],
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
        requiredCores: 6,
        bp: 13000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、相手のバースト1つを破棄できる。この破棄効果は相手の効果で防げない。または、相手の、BP12000以下のスピリット/ネクサス1つを破壊するか、創界神ネクサス1つのコアすべてをボイドに置く。",
      "",
      "Lv1-Lv2-Lv3 フラッシュ『自分のアタックステップ』",
      "〔ターンに1回：同名〕魂状態の自分の「ENIGMA」があるとき、自分のライフのコア1個をボイドに置くことで、ゲーム外から<ソウルコア>1個を自分のリザーブに置く。",
      "",
      "【クォーツ：練気｜コストC2｜属性値：<火>3 <風>2 <水>1（手札から対象にセットできる）】",
      "相手のメインステップ中、相手がカードを召喚/配置/使用したとき、4回目なら、ゲーム外から<ソウルコア>1個を自分のリザーブに置ける。",
    ],
    keywordTags: ["burst", "soul_state"],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-R03.webp",
    rarity: "R",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            prompt: {
              question: "発揮する効果を選んでください",
              sourceText:
                "ターンに1回、相手のバースト1つを破棄できる。この破棄効果は相手の効果で防げない。または、相手の、BP12000以下のスピリット/ネクサス1つを破壊するか、創界神ネクサス1つのコアすべてをボイドに置く。",
            },
            action: {
              kind: "discard_set_burst",
              player: "opponent",
              count: 1,
              unpreventable: true,
            },
            choice: [
              {
                prompt: {
                  sourceText:
                    "相手の、BP12000以下のスピリット/ネクサス1つを破壊する",
                },
                action: {
                  kind: "destroy",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: {
                      filterOr: [
                        {
                          category: ["spirit"],
                          maxBp: 12000,
                        },
                        {
                          category: ["nexus"],
                        },
                      ],
                    },
                    count: 1,
                  },
                },
              },
              {
                prompt: {
                  sourceText: "創界神ネクサス1つのコアすべてをボイドに置く。",
                },
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
                  amount: "all",
                },
              },
            ],
          },
        ],
        textRef: [0, 1],
      },
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: {
          player: "self",
          period: "attack",
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "ENIGMA",
              },
            ],
            includeSoulState: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "life",
                player: "self",
              },
              to: {
                kind: "void",
                player: "self",
              },
              amount: 1,
            },
          },
          {
            action: {
              kind: "core_move",
              from: {
                kind: "outside_game",
              },
              to: {
                kind: "reserve",
                player: "self",
              },
              amount: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "card_used",
          sourceWhose: "opponent",
        },
        timingScope: {
          player: "opponent",
          period: "main",
        },
        applicability: {
          soulState: true,
        },
        occurrenceGate: {
          duration: "turn",
          targetCount: 4,
          groupId: "BSLH01-R03:quartz-nth-summon-place-use",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "outside_game",
              },
              to: {
                kind: "reserve",
                player: "self",
              },
              amount: 1,
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-R04",
    quartzData: {
      quartzName: "治癒",
      cost: 0,
      reduction: [],
      countCost: 1,
      attributeValues: { 水: 3, 幻: 2 },
    },
    orikaId: 519,
    orikaIndex: 517,
    name: "[碧の軌跡]ティオ・プラトー",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 7000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 9000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2-Lv3『自分のメインステップ』",
      "〔ゲームに1回：同名〕自分はデッキの上から6枚オープンできる。その中の系統：「CB」を持つカード2枚を手札に加える。残ったカードはデッキの下に戻す。",
      "",
      "Lv2-Lv3『お互いのアタックステップ』",
      "〔重複不可〕自分の系統：「みっしぃ」を持つ自分のスピリットすべてに、自分がこのターン中に効果で「エンジョ〜イ、みっしぃ！」と宣言した回数1につき、青シンボル1つを追加する。",
      "",
      "【クォーツ：治癒｜コストC1｜属性値：<水>3 <幻>2（手札から対象にセットできる）】",
      "自分のエンドステップ、自分のライフが4以下で魂状態の「ENIGMA」の【クォーツ】の属性値の<水>の合計が10以上のとき、ボイドからコア1個を自分のライフに置ける。",
    ],
    keywordTags: ["soul_state"],
    tribe: "CB・S.S.S・みっしぃ",
    image: "images/BSLH01-R04.webp",
    rarity: "R",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-3『自分のメインステップ』〔ゲーム1回:同名〕デッキ6オープン→CB 2枚を手札、残りデッキ下。
      {
        timing: { kind: "activated", mode: "main" },
        usageLimit: { kind: "per_card_name", duration: "game", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 6,
              picks: [
                { count: 2, mandatory: true, filter: { tribes: ["CB"] } },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『お互いのアタックステップ』〔重複不可〕自分の系統：「みっしぃ」を持つ
      // 自分のスピリットすべてに、自分がこのターン中に効果で宣言した回数1につき青シンボル
      // 1つを追加する。symbol_add.count に DynamicCount(declaration_count_this_turn) を
      // 指定し消費時 live 評価（宣言回数が増えるたびシンボル数も追従）。
      // usageLimit:no_duplicate = 同名ホストが複数いてもシンボル付与は1系統分のみ
      // (BSSL01-C01 効果[2] / BSLH01-X05 クォーツセット効果と同型)。
      // filter.tribes:["みっしぃ"] は raw/by-pack/BSLH01.js の印字 tribe 直読み: R04/C06/X06
      // (3種の「ティオ・プラトー」print) は共通で tribe:"CB・S.S.S・みっしぃ" を持つ
      // 同一アーキタイプ内シナジー（複数 print 同時展開バフ）。T01/T02/T03 みっしぃ系
      // トークンの印字 tribe は "CB" のみで「みっしぃ」系統を持たない
      // (raw/by-pack/BSLH01.js:764,789,814) ため対象外＝カード名の偶然一致であり誤りではない。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], tribes: ["みっしぃ"] },
                count: "all",
              },
              symbol: "blue",
              count: {
                source: {
                  kind: "declaration_count_this_turn",
                  player: "self",
                },
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // 【クォーツ：治癒】セット中効果: 自分エンドステップ、自分のライフ4以下かつ ENIGMA の
      // <水>属性値合計10以上で、ボイドからコア1個を自分のライフに置ける。
      {
        timing: { kind: "phase", step: "end", whose: "self" },
        applicability: { soulState: true },
        condition: [
          { kind: "life_value", player: "self", max: 4 },
          {
            kind: "quartz_attribute",
            player: "self",
            attribute: "水",
            min: 10,
          },
        ],
        executionMode: "optional",
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
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-R05",
    quartzData: {
      quartzName: "丹精",
      cost: 0,
      reduction: [],
      countCost: 1,
      attributeValues: { 水: 3, 空: 2 },
    },
    orikaId: 520,
    orikaIndex: 518,
    name: "[碧の軌跡]エステル・ブライト",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 6,
    reductionSymbols: ["blue", "blue", "blue"],
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
        bp: 12000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "【バースト：相手の『このスピリットの召喚/煌臨時』発揮後】",
      "このカードをコストを支払わずに召喚するか、自分の魂状態の対象にコストを支払わずにセットする。その後、相手のスピリット1体を破壊する。破壊したとき、自分はデッキの上から2枚ドローでき、自分の魂状態の「ENIGMA」があるとき、自分のカウント+2できる。",
      "",
      "Lv2-Lv3",
      "自分の【クォーツ】を持つスピリットすべてを最高Lvとして扱う。また、自分の手札/デッキ/トラッシュは相手の効果を受けない。",
      "",
      "【クォーツ：丹精｜コストC1｜属性値：<水>3 <空>2（手札から対象にセットできる）】",
      "ターンに1回、系統：「CB」を持つ自分のスピリットが相手によってフィールドを離れるとき、自分のスピリット1体を疲労させることで、対象1体を同じ状態で残す。",
    ],
    keywordTags: ["burst", "soul_state"],
    tribe: "LK・CB・遊撃士",
    image: "images/BSLH01-R05.webp",
    rarity: "R",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
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
            activatedTimings: ["summon", "advent"],
          },
        },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
              costModifier: "free",
            },
            choice: [
              {
                action: {
                  kind: "quartz_set",
                  target: {
                    kind: "self",
                  },
                  free: true,
                },
              },
            ],
          },
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
            },
            connector: "sequential",
            id: "r05-destroy",
          },
          {
            action: {
              kind: "draw",
              count: 2,
            },
            connector: "conditional_result",
            executionMode: "optional",
          },
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
            },
            executionMode: "optional",
            connector: "sequential",
            condition: [
              {
                kind: "field_has",
                player: "self",
                soulStateOnly: true,
                cardNames: [
                  {
                    contains: "ENIGMA",
                  },
                ],
              },
            ],
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "r05-destroy",
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
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  hasQuartzData: true,
                },
                count: "all",
              },
              properties: {
                level: "max",
              },
              duration: {
                scope: "while_on_field",
              },
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
                zone: ["hand", "deck", "trash"],
              },
              duration: {
                scope: "while_on_field",
              },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          triggerFilter: {
            category: ["spirit"],
            tribes: ["CB"],
          },
          cause: ["opponent_effect", "battle"],
        },
        applicability: {
          soulState: true,
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
              state: "exhausted",
            },
          },
          {
            action: {
              kind: "stay_on_field",
              target: {
                kind: "trigger_related_instance",
                includePendingLeave: true,
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
    cardNo: "BSLH01-R06",
    quartzData: {
      quartzName: "回避3",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 風: 5 },
    },
    orikaId: 521,
    orikaIndex: 519,
    name: "[碧の軌跡]アリオス・マクレイン",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "green", "green", "green"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 6000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 10000,
      },
      {
        level: 3,
        requiredCores: 5,
        bp: 15000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札のこのカードは、魂状態の自分の「ENIGMA」があるとき、リザーブから2コスト支払うか、自分の創界神ネクサスから2コスト支払って召喚できる。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック/ブロック時』",
      "相手のスピリット/アルティメット1体を重疲労でき、相手のトラッシュにあるカード1枚を除外できる。この効果発揮後、このスピリットがLv2以上でバトル中のとき〔ターンに1回：同名〕このスピリットを手札に戻せる。",
      "",
      "【クォーツ：回避3｜コストC2｜属性値：<風>5（手札から対象にセットできる）】",
      "ターンに1回、自分の系統：「CB」を持つスピリットが相手のスピリット/ネクサスの効果の対象になるとき、自分のデッキを上から1枚オープンできる。それがスピリットカードのとき、その効果を受けない。オープンしたカードは手札に加える。",
    ],
    keywordTags: ["soul_state"],
    tribe: "CB・遊撃士",
    image: "images/BSLH01-R06.webp",
    rarity: "R",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: {
          zone: ["hand"],
        },
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: {
          player: "both",
          period: "attack",
        },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "ENIGMA",
              },
            ],
            soulStateOnly: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
              costModifier: {
                fixedPayment: 2,
              },
              onBoardCoreSourceFilter: {
                targetsGrandwalker: "only",
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack", "block"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    {
                      category: ["spirit"],
                    },
                    {
                      category: ["ultimate"],
                    },
                  ],
                },
                count: 1,
              },
              degree: "heavy_exhaust",
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {},
                count: 1,
                zone: "trash",
              },
            },
            connector: "simultaneous",
            executionMode: "optional",
          },
          {
            action: {
              kind: "bounce",
              target: {
                kind: "self",
              },
            },
            executionMode: "optional",
            usageLimit: {
              kind: "per_card_name",
              duration: "turn",
              maxCount: 1,
            },
            condition: [
              {
                kind: "min_level",
                value: 2,
              },
              {
                kind: "self_state",
                state: "on_field",
                battleState: "in_battle",
              },
            ],
            connector: "after_triggers",
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "targeted",
          triggerFilter: {
            category: ["spirit"],
            tribes: ["CB"],
          },
          triggerSourceFilter: {
            category: ["spirit", "nexus"],
          },
          cause: ["opponent_effect"],
        },
        applicability: {
          soulState: true,
        },
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
        },
        executionMode: "optional",
        steps: [
          {
            id: "r06reveal",
            action: {
              kind: "deck_reveal",
              revealCount: 1,
              picks: [
                {
                  count: 1,
                  mandatory: true,
                },
              ],
              remainder: "bottom",
              beforeMoveSteps: [
                {
                  action: {
                    kind: "effect_immunity",
                    target: {
                      kind: "trigger_related_instance",
                    },
                    duration: {
                      scope: "current_effect",
                    },
                  },
                  stepCondition: {
                    kind: "ref_has_match",
                    stepId: "r06reveal",
                    filter: {
                      category: ["spirit"],
                    },
                  },
                },
              ],
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-T01",
    orikaId: 522,
    orikaIndex: 520,
    name: "みっしぃ",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "このカードはデッキに入れられない。",
      "",
      "Lv1 フラッシュ『お互いのアタックステップ』",
      "このスピリットを破壊できる。",
      "",
      "Lv1『このスピリットの破壊時』",
      "自分が「エンジョ〜イ、みっしぃ！」と宣言することで、自分のカウント+1する。",
    ],
    keywordTags: ["token"],
    tribe: "CB",
    image: "images/BSLH01-T01.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
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
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "self",
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "card_event",
          event: "destroy",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "declare_gimmick",
              player: "self",
            },
          },
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T02",
    orikaId: 523,
    orikaIndex: 521,
    name: "みーしぇ",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "このカードはデッキに入れられない。",
      "",
      "Lv1 フラッシュ『お互いのアタックステップ』",
      "このスピリットを破壊できる。",
      "",
      "Lv1『このスピリットの破壊時』",
      "自分が「エンジョ〜イ、みっしぃ！」と宣言することで、自分のカウント+1する。",
    ],
    keywordTags: ["token"],
    tribe: "CB",
    image: "images/BSLH01-T02.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
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
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "self",
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "card_event",
          event: "destroy",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "declare_gimmick",
              player: "self",
            },
          },
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T03",
    orikaId: 524,
    orikaIndex: 522,
    name: "メカみっしぃ",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 1000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "このカードはデッキに入れられない。",
      "",
      "Lv1 フラッシュ『お互いのアタックステップ』",
      "このスピリットを破壊できる。",
      "",
      "Lv1『このスピリットの破壊時』",
      "自分が「エンジョ〜イ、みっしぃ！」と宣言することで、自分のカウント+1する。",
    ],
    keywordTags: ["token"],
    tribe: "CB",
    image: "images/BSLH01-T03.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
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
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "self",
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "card_event",
          event: "destroy",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "declare_gimmick",
              player: "self",
            },
          },
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T04",
    orikaId: 525,
    orikaIndex: 523,
    name: "アイオーンα",
    printedCategory: "ultimate",
    colors: ["black"],
    cost: 9,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 15000,
      },
    ],
    symbolColors: ["ultimate_symbol", "ultimate_symbol"],
    textLines: [
      "このカードはデッキに入れられない。",
      "",
      "Lv3",
      "このアルティメットと系統：「CB」を持つ自分の創界神ネクサスは相手の効果を受けない。さらに、自分の手札とライフは相手の効果を受けない。",
      "",
      "Lv3『このアルティメットのアタック時』",
      "ターンに1回、相手のスピリット/アルティメット/ネクサス1つを除外できる。",
      "",
      "Lv3『自分のエンドステップ』",
      "このアルティメットを回復できる。",
    ],
    keywordTags: ["token"],
    tribe: "CB",
    image: "images/BSLH01-T04.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv3 このアルティメット / CB 創界神ネクサス / 自分の手札 / ライフは相手の効果を受けない。
      // 免疫付与も対象に作用する効果のため targetsGrandwalker:"only"のみ(grandwalkerKind は
      // 指定しない="any"、CBの導界者ネクサスも対象に含める、qa-002/P3-134 2026-08-02修正)。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 3 }],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["CB"],
                  targetsGrandwalker: "only",
                },
                count: "all",
                zone: ["field"],
              },
              duration: { scope: "while_on_field" },
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
                zone: ["hand"],
              },
              duration: { scope: "while_on_field" },
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
                zone: ["life"],
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv3『アタック時』ターンに1回、相手のスピリット/アルティメット/ネクサス1つを除外する。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 3 }],
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                    { category: ["nexus"] },
                  ],
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
      // Lv3『自分のエンドステップ』このアルティメットを回復できる。
      {
        timing: { kind: "phase", step: "end", whose: "self" },
        condition: [{ kind: "min_level", value: 3 }],
        executionMode: "optional",
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSLH01-T05",
    orikaId: 526,
    orikaIndex: 524,
    name: "アイオーンβ",
    printedCategory: "ultimate",
    colors: ["red"],
    cost: 9,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 13000,
      },
    ],
    symbolColors: ["ultimate_symbol", "ultimate_symbol"],
    textLines: [
      "このカードはデッキに入れられない。",
      "",
      "Lv3『お互いのアタックステップ』",
      "このアルティメットはブロックされず、「ブロックされない」相手のスピリット/アルティメットすべてをブロックできる。",
      "",
      "Lv3『自分のエンドステップ』",
      "このアルティメットを回復できる。",
    ],
    keywordTags: ["token"],
    tribe: "CB",
    image: "images/BSLH01-T05.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv3 このアルティメットはブロックされず、「ブロックされない」相手をブロックできる。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "min_level", value: 3 }],
        steps: [
          {
            action: {
              kind: "unblockable",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: { kind: "continuous" },
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "min_level", value: 3 }],
        steps: [
          {
            action: {
              kind: "block_unblockable",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv3『自分のエンドステップ』このアルティメットを回復できる。
      {
        timing: { kind: "phase", step: "end", whose: "self" },
        condition: [{ kind: "min_level", value: 3 }],
        executionMode: "optional",
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T06",
    orikaId: 527,
    orikaIndex: 525,
    name: "アイオーンγ",
    printedCategory: "ultimate",
    colors: ["blue"],
    cost: 9,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 14000,
      },
    ],
    symbolColors: ["ultimate_symbol", "ultimate_symbol"],
    textLines: [
      "このカードはデッキに入れられない。",
      "",
      "Lv3 【大粉砕】『このアルティメットのアタック時』",
      "相手のデッキを上から、このアルティメットのLv1につき、5枚破棄し、バースト効果を持つカードが破棄されたとき、相手のスピリット1体を破壊する。",
      "",
      "Lv3『自分のエンドステップ』",
      "このアルティメットを回復できる。",
    ],
    keywordTags: ["burst", "token"],
    tribe: "CB",
    image: "images/BSLH01-T06.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv3【大粉砕】『アタック時』相手デッキを Lv1につき5枚破棄(Lv3=15)。
      // 破棄 step が affected に記録したカードに印字バースト系ヘッダが含まれるときだけ
      // 後続 destroy を実行する (ref_has_match + hasBurstEffect)。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 3 }],
        steps: [
          {
            id: "t06-grand-mill",
            action: {
              kind: "discard",
              count: {
                source: { kind: "source_effective_level" },
                multiplier: 5,
              },
              player: "opponent",
              fromZone: "deck",
            },
          },
          {
            connector: "conditional_result",
            stepCondition: {
              kind: "ref_has_match",
              stepId: "t06-grand-mill",
              filter: { hasBurstEffect: true },
            },
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                zone: "field",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv3『自分のエンドステップ』このアルティメットを回復できる。
      {
        timing: { kind: "phase", step: "end", whose: "self" },
        condition: [{ kind: "min_level", value: 3 }],
        executionMode: "optional",
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T07",
    // 【アーツ】配置ゲート。continuousSummonCondition により条件成立時の自動配置と
    // フィールドにある間ずっとの存在条件を一体で判定する。
    continuousSummonCondition: true,
    summonCondition: [
      {
        kind: "any_of",
        groups: [
          [artsAttr("地", 1)],
          [artsAttr("火", 1)],
          [artsAttr("水", 1)],
          [artsAttr("風", 1)],
          [artsAttr("時", 1)],
          [artsAttr("空", 1)],
          [artsAttr("幻", 1)],
        ],
      },
    ],
    orikaId: 528,
    orikaIndex: 526,
    name: "初級攻撃アーツ",
    printedCategory: "magic",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 5,
    reductionSymbols: ["seven", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。",
      "",
      "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
      "〔<地>1〕/〔<火>1〕/〔<水>1〕/〔<風>1〕/〔<時>1〕/〔<空>1〕/〔<幻>1〕",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕コスト4以下の相手のスピリット/アルティメット1体を疲労させる。",
    ],
    keywordTags: ["soul_state", "token"],
    tribe: "導力器",
    image: "images/BSLH01-T07.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 系統：「CB」/「導力器」を持たない自分の効果を受けない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { excludeTribes: ["CB", "導力器"] },
              sourcePlayerScope: "self",
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ〔ターン1回:同名〕コスト4以下の相手スピ/アルティ1体を疲労させる。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "set_exhaust_state",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"], maxCost: 4 },
                    { category: ["ultimate"], maxCost: 4 },
                  ],
                },
                count: 1,
              },
              state: "exhausted",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T08",
    // 【アーツ】配置ゲート（F2.4b⑤、qa-033 派生）。T07 と同型の継続ゲート。
    continuousSummonCondition: true,
    summonCondition: [
      {
        kind: "any_of",
        groups: [
          [artsAttr("地", 4), artsAttr("風", 1)],
          [artsAttr("水", 4), artsAttr("地", 1)],
          [artsAttr("火", 4), artsAttr("地", 1)],
          [artsAttr("風", 4), artsAttr("幻", 1)],
          [artsAttr("時", 6), artsAttr("空", 2), artsAttr("幻", 2)],
          [artsAttr("空", 6)],
          [artsAttr("幻", 6), artsAttr("時", 2), artsAttr("空", 2)],
        ],
      },
    ],
    orikaId: 529,
    orikaIndex: 527,
    name: "中級攻撃アーツ",
    printedCategory: "magic",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 7,
    reductionSymbols: ["seven", "seven", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。",
      "",
      "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
      "〔<地>4 <風>1〕/〔<水>4 <地>1〕/〔<火>4 <地>1〕/〔<風>4 <幻>1〕〔<時>6 <空>2 <幻>2〕/〔<空>6〕/〔<幻>6 <時>2 <空>2〕",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕コスト7以下の相手のスピリット/アルティメット1体を破壊する。",
    ],
    keywordTags: ["soul_state", "token"],
    tribe: "導力器",
    image: "images/BSLH01-T08.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 系統：「CB」/「導力器」を持たない自分の効果を受けない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { excludeTribes: ["CB", "導力器"] },
              sourcePlayerScope: "self",
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ〔ターン1回:同名〕コスト7以下の相手スピ/アルティ1体を破壊する。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"], maxCost: 7 },
                    { category: ["ultimate"], maxCost: 7 },
                  ],
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T09",
    // 【アーツ】配置ゲート（F2.4b⑤、qa-033 派生）。T07 と同型の継続ゲート。
    continuousSummonCondition: true,
    summonCondition: [
      {
        kind: "any_of",
        groups: [
          [artsAttr("地", 6), artsAttr("空", 2)],
          [artsAttr("水", 8), artsAttr("風", 1), artsAttr("時", 1)],
          [artsAttr("火", 8), artsAttr("風", 3)],
          [artsAttr("風", 6), artsAttr("空", 2)],
          [artsAttr("時", 10), artsAttr("空", 3), artsAttr("幻", 3)],
          [artsAttr("空", 12), artsAttr("幻", 8)],
          [artsAttr("幻", 12), artsAttr("時", 4), artsAttr("空", 4)],
        ],
      },
    ],
    orikaId: 530,
    orikaIndex: 528,
    name: "上級攻撃アーツ",
    printedCategory: "magic",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 10,
    reductionSymbols: ["seven", "seven", "seven", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。",
      "",
      "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
      "〔<地>6 <空>2〕/〔<水>8 <風>1 <時>1〕/〔<火>8 <風>3〕〔<風>6 <空>2〕/〔<時>10 <空>3 <幻>3〕/〔<空>12 <幻>8〕〔<幻>12 <時>4 <空>4〕",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕相手のスピリット/アルティメット3体を消滅させる。消滅する対象のコアすべてはリザーブに置かれる。これらの効果は相手の効果では防げない。",
    ],
    keywordTags: ["soul_state", "token"],
    tribe: "導力器",
    image: "images/BSLH01-T09.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 系統：「CB」/「導力器」を持たない自分の効果を受けない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { excludeTribes: ["CB", "導力器"] },
              sourcePlayerScope: "self",
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ〔ターン1回:同名〕相手スピ/アルティ3体を消滅させる。コアはリザーブ。防げない。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        // 「これらの効果は相手の効果では防げない」= P3-43 unpreventable。消滅は相手の
        // cannot_be_vanished/cannot_leave_field・defense_immune を貫通する。
        // 消滅対象のコアがリザーブに置かれるのは vanish の標準挙動に委譲。
        preventionLevel: "unpreventable",
        steps: [
          {
            action: {
              kind: "vanish",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                },
                count: 3,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T10",
    // 【アーツ】配置ゲート（F2.4b⑤、qa-033 派生）。T07 と同型の継続ゲート。
    continuousSummonCondition: true,
    summonCondition: [
      {
        kind: "any_of",
        groups: [
          [artsAttr("地", 12), artsAttr("水", 4), artsAttr("風", 4)],
          [artsAttr("水", 15)],
          [artsAttr("火", 15)],
          [artsAttr("風", 12), artsAttr("時", 4), artsAttr("空", 4)],
          [artsAttr("時", 21), artsAttr("幻", 11)],
          [artsAttr("空", 21), artsAttr("時", 11)],
          [artsAttr("幻", 21), artsAttr("空", 11)],
        ],
      },
    ],
    orikaId: 531,
    orikaIndex: 529,
    name: "最上級攻撃アーツ",
    printedCategory: "magic",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 12,
    reductionSymbols: ["seven", "seven", "seven", "seven", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。",
      "",
      "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
      "〔<地>12 <水>4 <風>4〕/〔<水>15〕/〔<火>15〕〔<風>12 <時>4 <空>4〕/〔<時>21 <幻>11〕/〔<空>21 <時>11〕〔<幻>21 <空>11〕",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕相手のスピリット/アルティメット4体を除外する。この効果で離れた対象はフィールドに残せない。",
    ],
    keywordTags: ["soul_state", "token"],
    tribe: "導力器",
    image: "images/BSLH01-T10.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 系統：「CB」/「導力器」を持たない自分の効果を受けない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { excludeTribes: ["CB", "導力器"] },
              sourcePlayerScope: "self",
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ〔ターン1回:同名〕相手スピ/アルティ4体を除外する。残せない。
      // pierceCannotLeaveField: 「この効果で離れた対象はフィールドに残せない」=
      //   相手の cannot_leave_field 常時効果を貫通（Q19/P3-74 と同機構）。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                },
                count: 4,
              },
              pierceCannotLeaveField: true,
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T11",
    // 【アーツ】配置ゲート（F2.4b⑤、qa-033 派生）。T07 と同型の継続ゲート。
    continuousSummonCondition: true,
    summonCondition: [
      {
        kind: "any_of",
        groups: [[artsAttr("地", 8), artsAttr("空", 3)]],
      },
    ],
    orikaId: 532,
    orikaIndex: 530,
    name: "アダマスガード",
    printedCategory: "magic",
    colors: ["white"],
    cost: 5,
    reductionSymbols: ["white", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。",
      "",
      "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
      "〔<地>8 <空>3〕",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕自分のスピリット/アルティメット1体は、このターンの間、相手のスピリット/アルティメットの効果を受けない。",
    ],
    keywordTags: ["soul_state", "token"],
    tribe: "導力器",
    image: "images/BSLH01-T11.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 系統：「CB」/「導力器」を持たない自分の効果を受けない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { excludeTribes: ["CB", "導力器"] },
              sourcePlayerScope: "self",
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ〔ターン1回:同名〕自分のスピ/アルティ1体は、このターン相手スピ/アルティの効果を受けない。
      // sourceScope: categories=["spirit","ultimate"] で発生源限定（マジック/ネクサス/バースト
      // 等の効果は通る）。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                },
                count: 1,
              },
              duration: { scope: "turn" },
              sourceScope: { categories: ["spirit", "ultimate"] },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T12",
    // 【アーツ】配置ゲート（F2.4b⑤、qa-033 派生）。T07 と同型の継続ゲート。
    continuousSummonCondition: true,
    summonCondition: [
      {
        kind: "any_of",
        groups: [[artsAttr("水", 10)]],
      },
    ],
    orikaId: 533,
    orikaIndex: 531,
    name: "アセラス",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 7,
    reductionSymbols: ["blue", "blue", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。",
      "",
      "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
      "〔<水>10〕",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕自分のトラッシュにある系統：「CB」を持つスピリットカード1枚をコストを支払わずに召喚する。",
    ],
    keywordTags: ["soul_state", "token"],
    tribe: "導力器",
    image: "images/BSLH01-T12.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 系統：「CB」/「導力器」を持たない自分の効果を受けない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { excludeTribes: ["CB", "導力器"] },
              sourcePlayerScope: "self",
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ〔ターン1回:同名〕トラッシュの CB スピリット1枚をコストなし召喚する。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "trash",
                filter: { category: ["spirit"], tribes: ["CB"] },
                count: 1,
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T13",
    // 【アーツ】配置ゲート（F2.4b⑤、qa-033 派生）。T07 と同型の継続ゲート。
    continuousSummonCondition: true,
    summonCondition: [
      {
        kind: "any_of",
        groups: [[artsAttr("火", 9), artsAttr("空", 3), artsAttr("幻", 3)]],
      },
    ],
    orikaId: 534,
    orikaIndex: 532,
    name: "メルティライズ",
    printedCategory: "magic",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "seven", "seven", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。",
      "",
      "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
      "〔<火>9 <空>3 <幻>3〕",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕次の自分のスタートステップまで、自分が系統：「CB」を持つスピリットカードを召喚するとき、対象に置くコアはトラッシュからも<ソウルコア>以外のコアを1個ずつまで置ける。",
    ],
    keywordTags: ["soul_state", "token"],
    tribe: "導力器",
    image: "images/BSLH01-T13.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 系統：「CB」/「導力器」を持たない自分の効果を受けない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { excludeTribes: ["CB", "導力器"] },
              sourcePlayerScope: "self",
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ〔ターンに1回:同名〕次の自分のスタートステップまで、自分の CB スピリット
      // 召喚時に対象へトラッシュからも<ソウルコア>以外のコアを1個まで置ける
      // (grant_summon_trash_core_placement、ENGINE-summon-trash-core-placement-grant)。
      // T07 と同型のアーツ共通テンプレ (timingScope:attack + usageLimit per_card_name/turn)。
      // 「次の自分のスタートステップまで」= duration:{scope:"step", step:"start", whose:"self"}
      // (BSES01/BSTH02.7 precedent、next:true 不要 — 登録ターンの start step は既に経過済みの
      // ため次巡目の start step_end まで自然に生存する)。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "grant_summon_trash_core_placement",
              player: "self",
              filter: { category: ["spirit"], tribes: ["CB"] },
              amount: 1,
              duration: { scope: "step", step: "start", whose: "self" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T14",
    // 【アーツ】配置ゲート（F2.4b⑤、qa-033 派生）。T07 と同型の継続ゲート。
    continuousSummonCondition: true,
    summonCondition: [
      {
        kind: "any_of",
        groups: [[artsAttr("風", 6)]],
      },
    ],
    orikaId: 535,
    orikaIndex: 533,
    name: "レキュリア",
    printedCategory: "magic",
    colors: ["green"],
    cost: 5,
    reductionSymbols: ["green", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。",
      "",
      "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
      "〔<風>6〕",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕フィールド以外で発揮中の自分の系統：「CB」を持つスピリットを対象とした相手の効果すべてを無効にする。",
    ],
    keywordTags: ["soul_state", "token"],
    tribe: "導力器",
    image: "images/BSLH01-T14.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
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
              kind: "effect_immunity",
              target: {
                kind: "self",
              },
              duration: {
                scope: "while_on_field",
              },
              sourceScope: {
                excludeTribes: ["CB", "導力器"],
              },
              sourcePlayerScope: "self",
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
        timingScope: {
          player: "both",
          period: "attack",
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "negate_ongoing_effects",
              sourcePlayer: "opponent",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["CB"],
                },
                count: "all",
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T15",
    // 【アーツ】配置ゲート（F2.4b⑤、qa-033 派生）。T07 と同型の継続ゲート。
    continuousSummonCondition: true,
    summonCondition: [
      {
        kind: "any_of",
        groups: [[artsAttr("時", 8)]],
      },
    ],
    orikaId: 536,
    orikaIndex: 534,
    name: "カラミティクロウ",
    printedCategory: "magic",
    colors: ["black"],
    cost: 6,
    reductionSymbols: ["black", "black", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。",
      "",
      "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
      "〔<時>8〕",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕このターンの間、自分は、フラッシュタイミングを2回ずつまで続けて行える。",
    ],
    keywordTags: ["soul_state", "token"],
    tribe: "導力器",
    image: "images/BSLH01-T15.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 系統：「CB」/「導力器」を持たない自分の効果を受けない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { excludeTribes: ["CB", "導力器"] },
              sourcePlayerScope: "self",
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ〔ターンに1回:同名〕このターンの間、自分はフラッシュタイミングを2回ずつ
      // まで続けて行える (grant_flash_consecutive_use、
      // ENGINE-flash-priority-consecutive-use-grant)。T13/T07 と同型のアーツ共通テンプレ
      // (timingScope:attack + usageLimit per_card_name/turn)。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "grant_flash_consecutive_use",
              player: "self",
              limit: 2,
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T16",
    // 【アーツ】配置ゲート（F2.4b⑤、qa-033 派生）。T07 と同型の継続ゲート。
    continuousSummonCondition: true,
    summonCondition: [
      {
        kind: "any_of",
        groups: [[artsAttr("空", 6)]],
      },
    ],
    orikaId: 537,
    orikaIndex: 535,
    name: "A-リフレックス",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 5,
    reductionSymbols: ["yellow", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。",
      "",
      "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
      "〔<空>6〕",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕このターンの間、系統：「CB」を持つ自分のスピリット1体に、“このスピリットが相手のマジックカードの効果の対象になるとき、その効果の「相手」を「自分」に変更でき、相手が対象を選びなおす。”を与える。",
    ],
    keywordTags: ["soul_state", "token"],
    tribe: "導力器",
    image: "images/BSLH01-T16.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 系統：「CB」/「導力器」を持たない自分の効果を受けない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
              sourceScope: { excludeTribes: ["CB", "導力器"] },
              sourcePlayerScope: "self",
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ CB スピリット1体に redirect（相手マジック対象の選び直し）をターン中付与する。
      // 「その効果の『相手』を『自分』に変更」は、相手マジックの target slice を
      // 相手側の場のカードへ差し替え、相手が選びなおす redirect として表現する。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "register_redirect_effect_target",
              protectedTarget: {
                kind: "target",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["spirit"], tribes: ["CB"] },
                  count: 1,
                },
              },
              sourcePlayerRef: "opponent",
              sourceFilter: { category: ["magic"] },
              redirectCandidate: {
                kind: "owned_filter",
                filter: { category: ["spirit", "ultimate", "brave", "nexus"] },
                player: "opponent",
                preserveOriginalTargetSpec: { player: "self" },
              },
              promptedPlayerRef: "self",
              candidateChooserPlayerRef: "opponent",
              optional: true,
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-T17",
    // 【アーツ】配置ゲート（F2.4b⑤、qa-033 派生）。T07 と同型の継続ゲート。
    continuousSummonCondition: true,
    summonCondition: [
      {
        kind: "any_of",
        groups: [[artsAttr("幻", 5), artsAttr("水", 3), artsAttr("風", 3)]],
      },
    ],
    orikaId: 538,
    orikaIndex: 536,
    name: "ホロウスフィア",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "seven"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられず、系統：「CB」/「導力器」を持たない自分の効果を受けない。",
      "",
      "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
      "〔<幻>5 <水>3 <風>3〕",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕アタック/ブロック中ではない系統：「CB」を持つ自分のスピリット1体を指定する。このターンの間、指定した対象がアタック/ブロックするか、【ソウルドライブ・S】を発揮するまで、相手は,指定した対象を効果の対象にできず、含めない。",
    ],
    keywordTags: ["soul_state", "token"],
    tribe: "導力器",
    image: "images/BSLH01-T17.webp",
    rarity: "T",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 0,
    maxTokenDeckCount: 1,
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
              kind: "effect_immunity",
              target: {
                kind: "self",
              },
              duration: {
                scope: "while_on_field",
              },
              sourceScope: {
                excludeTribes: ["CB", "導力器"],
              },
              sourcePlayerScope: "self",
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
        timingScope: {
          player: "both",
          period: "attack",
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["CB"],
                  battleState: "not_in_battle",
                },
                count: 1,
              },
              duration: {
                scope: "turn",
                untilEvents: ["attack", "block", "soul_drive_activated"],
              },
              resistsOutcome: ["targeted", "included"],
              source: "opponent_effect",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSLH01-TR01(A)",
    quartzData: {
      quartzName: "耀脈",
      cost: 0,
      reduction: [],
      countCost: 1,
      attributeValues: { 地: 3, 水: 2 },
    },
    orikaId: 539,
    orikaIndex: 537,
    name: "[碧の軌跡]ノエル・シーカー",
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
        requiredCores: 3,
        bp: 6000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のカウント+1できる。自分のデッキを上から3枚オープンできる。その中の系統：「CB」を持つカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "Lv1-Lv2【転醒：自分のカウント5以下（転醒は同時に使えない）】",
      "このスピリットが相手によってフィールドを離れるとき、魂状態の自分の「ENIGMA」があれば、裏返せる。",
      "",
      "【クォーツ：耀脈｜コストC1｜属性値：<地>3 <水>2（手札から対象にセットできる）】",
      "アタックステップ中、ターンに1回、自分のカウントが増えるとき、ボイドからコア1個を自分のリザーブに置ける。",
    ],
    keywordTags: ["soul_state", "double_sided"],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-TR01(A).webp",
    rarity: "TR",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
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
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    tribes: ["CB"],
                  },
                },
              ],
              remainder: "trash",
            },
            connector: "simultaneous",
            executionMode: "optional",
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        condition: [
          {
            kind: "count_value",
            player: "self",
            max: 5,
          },
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "ENIGMA",
              },
            ],
            includeSoulState: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "rebirth",
              maxCount: 5,
              countBonusMode: "none",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "count_increase",
        },
        applicability: {
          soulState: true,
        },
        timingScope: {
          player: "both",
          period: "attack",
        },
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
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
                kind: "reserve",
                player: "self",
              },
              amount: 1,
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "[クロスベル国防軍]ノエル・シーカー",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 3,
      reductionSymbols: [],
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
        "この面に裏返ったとき、フィールドに残る。",
        "",
        "Lv1-Lv2『このスピリットの転醒/ブロック時』",
        "このターンの間、相手のスピリット1体はアタック/ブロックできない。",
        "",
        "Lv1-Lv2",
        "このスピリットが相手の破壊効果/「手札/デッキに戻す」効果でフィールドを離れるとき、自分の手札/フィールド/トラッシュに「ロイド・バニングス」があれば（手札にある場合は内容を見せる）、自分の魂状態の対象に裏面でセットするか、裏返してコストを支払わずに召喚できる。",
        "",
        "【クォーツ：虎威｜属性値：<地>5 <火>2 <時>2（効果以外でセットできない）】",
        "系統：「CB」を持つ自分のスピリットがアタックしている間、コスト4以下の相手のスピリットは、ブロックできない。",
      ],
      keywordTags: ["soul_state"],
      tribe: "CB",
      image: "images/BSLH01-TR01(B).webp",
      rarity: "TR",
      pack: "BSLH01 英雄伝説 軌跡シリーズ",
      cardNo: "BSLH01-TR01(B)",
      quartzData: {
        quartzName: "虎威",
        cost: 0,
        reduction: [],
        attributeValues: { 地: 5, 火: 2, 時: 2 },
      },
      effects: [
        {
          timing: {
            kind: "card_event",
            event: ["rebirth", "block"],
            effectSourceEvents: ["rebirth"],
          },
          steps: [
            {
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
                restriction: ["attack", "block"],
                duration: {
                  scope: "turn",
                },
              },
            },
          ],
          textRef: [2, 3],
        },
        {
          timing: {
            kind: "card_event",
            event: ["destroy", "bounce"],
            cause: "opponent_effect",
          },
          executionMode: "optional",
          condition: [
            {
              kind: "cards_in_zone",
              player: "self",
              zone: ["hand", "field", "trash"],
              filter: {
                cardName: {
                  contains: "ロイド・バニングス",
                },
              },
              min: 1,
            },
          ],
          steps: [
            {
              condition: [
                {
                  kind: "cards_in_zone",
                  player: "self",
                  zone: ["field", "trash"],
                  filter: {
                    cardName: {
                      contains: "ロイド・バニングス",
                    },
                  },
                  max: 0,
                },
              ],
              action: {
                kind: "reveal_hand",
                player: "self",
                revealTo: "both",
                filter: {
                  cardName: {
                    contains: "ロイド・バニングス",
                  },
                },
                count: 1,
              },
            },
            {
              action: {
                kind: "quartz_set",
                target: {
                  kind: "self",
                },
              },
              choice: [
                {
                  action: {
                    kind: "reverse_rebirth",
                    mode: "summon",
                    withoutCost: true,
                  },
                },
              ],
            },
          ],
          textRef: [5, 6],
        },
        {
          timing: {
            kind: "continuous",
          },
          applicability: {
            soulState: true,
          },
          condition: [
            {
              kind: "field_has",
              player: "self",
              category: ["spirit"],
              tribes: ["CB"],
              battleState: "attacking",
            },
          ],
          steps: [
            {
              action: {
                kind: "prevent_battle",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit"],
                    maxCost: 4,
                  },
                  count: "all",
                },
                restriction: ["block"],
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
  },
  {
    cardNo: "BSLH01-TR02(A)",
    quartzData: {
      quartzName: "範囲",
      cost: 0,
      reduction: [],
      countCost: 1,
      attributeValues: { 空: 3 },
    },
    orikaId: 540,
    orikaIndex: 538,
    name: "[碧の軌跡]ワジ・ヘミスフィア",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow"],
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
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のカウント+2できる。このターンの間、相手のスピリット1体をBP-8000でき、BP0になった対象を破壊できる。この効果で破壊したとき、自分はデッキの下から2枚ドローできる。",
      "",
      "Lv1-Lv2【転醒：自分のカウント9以下（転醒は同時に使えない）】",
      "自分のスピリットが相手によってフィールドを離れるとき、自分の魂状態の「ENIGMA」があれば、このスピリットに自分のトラッシュの<ソウルコア>以外のコア1個を置いて裏返せる。",
      "",
      "【クォーツ：範囲｜コストC1｜属性値：<空>3（手札から対象にセットできる）】",
      "自分がトークンマジックの効果で相手のスピリット/アルティメット/ネクサスを対象にするとき、ターンに1回、その対象を+1する。",
    ],
    keywordTags: ["soul_state", "double_sided"],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-TR02(A).webp",
    rarity: "TR",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
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
              kind: "count_increase",
              player: "self",
              amount: 2,
            },
            executionMode: "optional",
          },
          {
            id: "bp0",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
              amount: -8000,
              duration: {
                scope: "turn",
              },
            },
            connector: "simultaneous",
            executionMode: "optional",
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "ref",
                stepId: "bp0",
                result: "bp_became_zero",
              },
            },
            executionMode: "optional",
            connector: "sequential",
          },
          {
            action: {
              kind: "draw",
              count: 2,
              position: "bottom",
            },
            connector: "conditional_result",
            executionMode: "optional",
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          triggerFilter: {
            category: ["spirit"],
          },
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        condition: [
          {
            kind: "count_value",
            player: "self",
            max: 9,
          },
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "ENIGMA",
              },
            ],
            includeSoulState: true,
          },
        ],
        steps: [
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
              amount: 1,
              effectKind: "normal_only",
            },
          },
          {
            action: {
              kind: "rebirth",
              maxCount: 9,
              countBonusMode: "none",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          soulState: true,
        },
        steps: [
          {
            action: {
              kind: "register_expand_effect_target_count",
              player: "self",
              sourceFilter: {
                category: ["magic"],
                isToken: true,
              },
              targetFilter: {
                category: ["spirit", "ultimate", "nexus"],
              },
              targetPlayer: "opponent",
              bonusAmount: 1,
              usageLimit: {
                kind: "per_instance",
                duration: "turn",
                maxCount: 1,
              },
              duration: {
                scope: "while_on_field",
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "[碧の聖典]ワジ・ヘミスフィア",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 6,
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
          bp: 8000,
        },
        {
          level: 3,
          requiredCores: 4,
          bp: 12000,
        },
      ],
      symbolColors: ["yellow"],
      textLines: [
        "この面に裏返ったとき、フィールドに残る。",
        "",
        "Lv1-Lv2『このスピリットの転醒/アタック時』",
        "このターンの間、相手のスピリット/アルティメット/ネクサス1つの効果を発揮させない。",
        "",
        "Lv1-Lv2",
        "お互いのアタックステップの自分のフラッシュタイミングか、このスピリットが相手によってフィールドを離れるとき、このスピリットを自分の魂状態の対象に裏面でセットできる。",
        "",
        "【クォーツ：妨害3｜属性値：<空>5 <時>1 <幻>3（効果以外でセットできない）】",
        "アタックステップ中、相手は自分の系統：「CB」を持つコスト6以上のスピリットをスタックタイミング元にして、スタック効果を使用できない。",
      ],
      keywordTags: ["soul_state"],
      tribe: "CB・SC・S.S.S",
      image: "images/BSLH01-TR02(B).webp",
      rarity: "TR",
      pack: "BSLH01 英雄伝説 軌跡シリーズ",
      cardNo: "BSLH01-TR02(B)",
      effects: [
        {
          timing: {
            kind: "card_event",
            event: ["rebirth", "attack"],
          },
          steps: [
            {
              action: {
                kind: "suppress_effect",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit", "ultimate", "nexus"],
                  },
                  count: 1,
                },
                duration: {
                  scope: "turn",
                },
              },
            },
          ],
          textRef: [2, 3],
        },
        {
          timing: {
            kind: "activated",
            mode: "flash",
          },
          timingScope: {
            player: "both",
            period: "attack",
          },
          activationLabel: "none",
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "quartz_set",
                target: {
                  kind: "self",
                },
              },
            },
          ],
          textRef: [5, 6],
        },
        {
          timing: {
            kind: "card_event",
            event: "leave_field",
            cause: ["opponent_effect", "battle"],
          },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "quartz_set",
                target: {
                  kind: "self",
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
          applicability: {
            soulState: true,
          },
          timingScope: {
            player: "both",
            period: "attack",
          },
          steps: [
            {
              action: {
                kind: "restrict_stack",
                player: "opponent",
                targetScope: "effect_source",
                sourceCardFilter: {
                  category: ["spirit"],
                  tribes: ["CB"],
                  minCost: 6,
                },
                duration: {
                  scope: "while_set",
                },
              },
            },
          ],
          textRef: [8, 9],
        },
      ],
      quartzData: {
        quartzName: "妨害3",
        cost: 0,
        reduction: [],
        attributeValues: { 空: 5, 時: 1, 幻: 3 },
      },
    },
  },
  {
    cardNo: "BSLH01-TR03(A)",
    quartzData: {
      quartzName: "情報",
      cost: 0,
      reduction: [],
      countCost: 1,
      attributeValues: { 幻: 3 },
    },
    orikaId: 541,
    orikaIndex: 539,
    name: "[零の軌跡]リーシャ・マオ",
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
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1『このネクサスの配置時』",
      "手札から配置していたとき、自分のデッキを上から2枚トラッシュに置ける。その中の系統：「CB」を持つカード1枚を手札に加える。",
      "",
      "Lv1【転醒：自分のカウント8以下（転醒は同時に使えない）】",
      "自分のスピリット/このネクサスが相手によってフィールドを離れるとき、このネクサスにトラッシュの<ソウルコア>以外のコア1個を置いて裏返せる。",
      "",
      "【クォーツ：情報｜コストC1｜属性値：<幻>3（手札から対象にセットできる）】",
      "自分のメインステップ中、ターンに1回、相手の手札1枚の内容を見れる。",
    ],
    keywordTags: ["double_sided"],
    tribe: "CB・CR",
    image: "images/BSLH01-TR03(A).webp",
    rarity: "TR",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "place",
        },
        condition: [
          {
            kind: "trigger_from_zone",
            zones: ["hand"],
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "move_card",
              from: {
                zone: "deck",
                player: "self",
                position: "top",
              },
              to: {
                zone: "trash",
              },
              count: 2,
            },
            id: "trashTop2",
          },
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              target: {
                kind: "ref",
                stepId: "trashTop2",
              },
              filter: {
                tribes: ["CB"],
              },
              count: 1,
              destination: "hand",
              mandatory: true,
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          triggerFilter: {
            filterOr: [
              {
                category: ["spirit"],
              },
              {
                cardName: "self",
              },
            ],
          },
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        condition: [
          {
            kind: "count_value",
            player: "self",
            max: 8,
          },
        ],
        steps: [
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
              amount: 1,
              effectKind: "normal_only",
            },
          },
          {
            action: {
              kind: "rebirth",
              maxCount: 8,
              countBonusMode: "none",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "activated",
          mode: "main",
        },
        applicability: {
          soulState: true,
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "reveal_hand",
              player: "opponent",
              revealTo: "self",
              count: 1,
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "[零の軌跡]銀",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 6,
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
          bp: 12000,
        },
      ],
      symbolColors: ["purple"],
      textLines: [
        "この面に裏返ったとき、フィールドに残る。",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』",
        "ターンに1回、相手のフィールドのコア2個までをリザーブに置ける。消滅させたとき、トラッシュの<ソウルコア>以外のコア1個をこのスピリットに置ける。",
        "",
        "Lv2-Lv3『お互いのエンドステップ』",
        "自分のカウント+1する。その後、このスピリットを自分の魂状態の対象に裏面でセットするか、裏返してコストを支払わずに配置できる。",
        "",
        "【クォーツ：幻惑｜属性値：<幻>3 <風>1 <空>2（効果以外でセットできない）】",
        "相手のアタックステップ開始時、相手のスピリット/アルティメット1体を指定できる。指定した対象がこのステップの最初にアタックするなら、その対象からコア2個をトラッシュに置かなければアタックできない。",
      ],
      keywordTags: ["soul_state"],
      tribe: "CB・CR",
      image: "images/BSLH01-TR03(B).webp",
      rarity: "TR",
      pack: "BSLH01 英雄伝説 軌跡シリーズ",
      cardNo: "BSLH01-TR03(B)",
      effects: [
        {
          timing: {
            kind: "card_event",
            event: ["rebirth", "attack"],
          },
          executionMode: "optional",
          usageLimit: {
            kind: "per_instance",
            duration: "turn",
            maxCount: 1,
          },
          steps: [
            {
              id: "move-opponent-cores",
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
                amount: {
                  min: 0,
                  max: 2,
                },
              },
            },
            {
              connector: "after_state_check",
              executionMode: "optional",
              stepCondition: {
                kind: "ref_leave_established",
                stepId: "move-opponent-cores",
                leaveKind: "vanish",
              },
              action: {
                kind: "core_move",
                from: {
                  kind: "trash",
                  player: "self",
                },
                to: {
                  kind: "this_card",
                },
                amount: 1,
                effectKind: "normal_only",
              },
            },
          ],
          textRef: [2, 3],
        },
        {
          timing: {
            kind: "phase",
            step: "end",
            whose: "either",
          },
          applicability: {
            level: {
              min: 2,
            },
          },
          steps: [
            {
              id: "increase-count",
              action: {
                kind: "count_increase",
                player: "self",
                amount: 1,
              },
            },
            {
              targetSelectionTiming: "on_step",
              connector: "sequential",
              executionMode: "optional",
              choice: [
                {
                  label: "魂状態にセット",
                  action: {
                    kind: "quartz_set",
                    target: {
                      kind: "self",
                    },
                  },
                },
                {
                  label: "裏返して無償配置",
                  action: {
                    kind: "reverse_rebirth",
                    mode: "summon",
                    withoutCost: true,
                  },
                },
              ],
              action: {
                kind: "noop",
              },
            },
          ],
          textRef: [5, 6],
        },
        {
          timing: {
            kind: "phase",
            step: "attack",
            whose: "opponent",
            subPhase: "start",
          },
          applicability: {
            soulState: true,
          },
          executionMode: "optional",
          steps: [
            {
              id: "designate-attacker",
              action: {
                kind: "noop",
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
            {
              connector: "sequential",
              action: {
                kind: "require_battle_cost",
                target: {
                  kind: "ref",
                  stepId: "designate-attacker",
                },
                restriction: ["attack"],
                costAmount: 2,
                firstAttackOnly: true,
                duration: {
                  scope: "step",
                },
              },
            },
          ],
          textRef: [8, 9],
        },
      ],
      quartzData: {
        quartzName: "幻惑",
        cost: 0,
        reduction: [],
        attributeValues: { 幻: 3, 風: 1, 空: 2 },
      },
    },
  },
  {
    cardNo: "BSLH01-TR04(A)",
    quartzData: {
      quartzName: "封技の刃",
      cost: 0,
      reduction: [],
      countCost: 1,
      attributeValues: { 火: 3 },
    },
    orikaId: 542,
    orikaIndex: 540,
    name: "[碧の軌跡]ヴァルド・ヴァレス",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 4000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚/アタック時』",
      "相手のスピリット/アルティメット1体とこのスピリットのBPを比べられる。（BPが同じか低い方が破壊される）そうしたとき、この効果発揮後、Lv2のこのスピリットがいれば、相手のネクサス1つを破壊できる。",
      "",
      "Lv1-Lv2【転醒：自分のカウント9以下（転醒は同時に使えない）】",
      "このスピリットが相手によってフィールドを離れるとき、魂状態の自分の「ENIGMA」があれば裏返せる。",
      "",
      "【クォーツ：封技の刃｜コストC1｜属性値：<火>3（手札から対象にセットできる）】",
      "相手のアタックステップ開始時、相手のスピリット1体を指定できる。このターンの間、指定した対象の『このスピリットのアタック時』効果は発揮されない。",
    ],
    keywordTags: ["soul_state", "double_sided"],
    tribe: "CB",
    image: "images/BSLH01-TR04(A).webp",
    rarity: "TR",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        executionMode: "optional",
        steps: [
          {
            id: "bp-compare",
            action: {
              kind: "bp_compare_destroy",
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
          {
            connector: "after_triggers",
            stepCondition: {
              kind: "ref_executed",
              stepId: "bp-compare",
            },
            condition: [
              {
                kind: "self_state",
                state: "on_field",
              },
              {
                kind: "min_level",
                value: 2,
              },
            ],
            executionMode: "optional",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        condition: [
          {
            kind: "count_value",
            player: "self",
            max: 9,
          },
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "ENIGMA",
              },
            ],
            includeSoulState: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "rebirth",
              maxCount: 9,
              countBonusMode: "none",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "phase",
          step: "attack",
          whose: "opponent",
          subPhase: "start",
        },
        applicability: {
          soulState: true,
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
              effectFilter: {
                timingKind: "card_event",
                eventAction: "attack",
              },
              duration: {
                scope: "turn",
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "[創の軌跡]ヴァルド・ヴァレス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 4,
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
      symbolColors: [],
      textLines: [
        "この面に裏返ったとき、フィールドに残る。",
        "",
        "Lv1-Lv2",
        "この面に裏返ったときか、お互いのアタックステップの自分のフラッシュタイミングか、このネクサスが相手によってフィールドを離れるとき、このネクサスを自分の魂状態の対象に裏面でセットできる。",
        "",
        "Lv2『自分のメインステップ終了時』",
        "トラッシュの<ソウルコア>以外のコア3個を系統：「CB」を持つ自分のスピリットに置ける。",
        "",
        "【クォーツ：必殺｜属性値：<火>3（効果以外でセットできない）】",
        "系統：「CB」を持つコスト6以上の自分のスピリットの「防げない」状態ではない効果でフィールドを離れる相手のスピリット/アルティメットの効果は発揮されない。",
      ],
      keywordTags: ["soul_state"],
      tribe: "CB・SC",
      image: "images/BSLH01-TR04(B).webp",
      rarity: "TR",
      pack: "BSLH01 英雄伝説 軌跡シリーズ",
      cardNo: "BSLH01-TR04(B)",
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "rebirth",
          },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "quartz_set",
                target: {
                  kind: "self",
                },
              },
            },
          ],
          textRef: [2, 3],
        },
        {
          timing: {
            kind: "activated",
            mode: "flash",
          },
          timingScope: {
            player: "both",
            period: "attack",
          },
          activationLabel: "none",
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "quartz_set",
                target: {
                  kind: "self",
                },
              },
            },
          ],
          textRef: [2, 3],
        },
        {
          timing: {
            kind: "card_event",
            event: "leave_field",
            cause: ["opponent_effect", "battle"],
          },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "quartz_set",
                target: {
                  kind: "self",
                },
              },
            },
          ],
          textRef: [2, 3],
        },
        {
          timing: {
            kind: "phase",
            step: "main",
            whose: "self",
            subPhase: "end",
          },
          applicability: {
            level: {
              min: 2,
            },
          },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "core_distribute",
                from: {
                  kind: "trash",
                  player: "self",
                },
                to: {
                  kind: "filter",
                  player: "self",
                  filter: {
                    category: ["spirit"],
                    tribes: ["CB"],
                  },
                  count: 1,
                },
                amount: 3,
                mode: "even",
                effectKind: "normal_only",
              },
            },
          ],
          textRef: [5, 6],
        },
        {
          timing: {
            kind: "game_event",
            player: "opponent",
            event: "leave_field",
            triggerFilter: {
              category: ["spirit", "ultimate"],
            },
            triggerSourceFilter: {
              category: ["spirit"],
              tribes: ["CB"],
              minCost: 6,
            },
            triggerSourcePreventionLevels: ["none", "suppress", "immune"],
            cause: "opponent_effect",
            sourceWhose: "either",
          },
          applicability: {
            soulState: true,
          },
          steps: [
            {
              action: {
                kind: "suppress_pending_leave_effects",
                target: {
                  kind: "trigger_related_instance",
                  includePendingLeave: true,
                },
                suppressDestroyedEffects: "destroyed_only",
              },
            },
          ],
          textRef: [8, 9],
        },
      ],
      quartzData: {
        quartzName: "必殺",
        cost: 0,
        reduction: [],
        attributeValues: { 火: 3 },
      },
    },
  },
  {
    cardNo: "BSLH01-X01",
    orikaId: 543,
    orikaIndex: 541,
    name: "[導界者]キーア",
    printedCategory: "nexus",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 2,
    reductionSymbols: ["seven"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
      {
        level: 2,
        requiredCores: 7,
        bp: 0,
      },
    ],
    symbolColors: ["guide"],
    textLines: [
      "【導託：〔CB＆コスト3以上〕〔召喚／煌臨での導託はステップに1回〕】",
      "◆対象の自分のスピリットを召喚/煌臨したとき、このネクサスにコア+1できる。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきこのネクサスにコア+1する。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、赤/紫/緑/白/黄/青/黒としても扱う。",
      "",
      "【導技：2】Lv1-Lv2 フラッシュ",
      "〔ターンに1回、このネクサスのコア-2する〕自分のデッキを上から2枚オープンし、その中のクォーツ効果を持つカード1枚をコストを支払わずに魂状態の対象にセットする。残ったカードはデッキの下に戻す。",
      "",
      "【導技：7】Lv2『自分のアタックステップ終了時』",
      "〔ターンに1回：同名〕〔このネクサスのコア-7する〕自分のスピリットが4体になるまで、手札/トラッシュの系統：「S.S.S」を持つスピリットカードをコストを支払わずに自分のスピリット/アルティメットのコアを0個にせずに召喚できる。このステップ終了後、自分は、リフレッシュステップとアタックステップを1回ずつ行える。",
    ],
    keywordTags: [
      "soul_state",
      "guided_nexus",
      "enter_field_core_placement_forbidden",
    ],
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent"],
      oracleTriggerLimit: "step_once",
      oracleConditions: [
        { tribes: ["CB"], categories: ["spirit"], minCost: 3 },
      ],
      // 【導技：2】Lv1-Lv2 フラッシュ〔ターンに1回、コア-2〕。コスト(コア2個→ボイド)・
      // ターン制限は divineSkills 経路でエンジンが検査・支払う
      // (project_divine_skill_model_target_maxuses: effects[] 自己コストは legal-actions が
      // 検査せずコア不足でも発揮可能になるバグを踏むため禁止)。
      // 効果本体はデッキ2オープン→クォーツ効果カード1枚選択(候補あれば強制)→
      // free:true quartz_set (既存 host/スロット自動解決、cluster 135 R01/R05 precedent)。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 2,
          timing: "flash",
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          effects: [
            {
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  id: "x01reveal",
                  action: {
                    kind: "deck_reveal",
                    revealCount: 2,
                    picks: [],
                    beforePickSteps: [
                      {
                        targetSelectionTiming: "on_step",
                        action: {
                          kind: "quartz_set",
                          target: {
                            kind: "filter",
                            player: "self",
                            zone: "revealed",
                            filter: { hasQuartzData: true },
                            count: 1,
                          },
                          free: true,
                        },
                      },
                    ],
                    remainder: "bottom",
                  },
                },
              ],
              textRef: [6, 7],
            },
          ],
        },
        // 【導技：7】Lv2『自分のアタックステップ終了時』〔ターンに1回：同名、コア-7〕。
        // subPhase:end の導技は attack の step_end 窓だけで発揮できる。
        // 効果本体: (1) 自分のスピリットが4体になるまで、手札/トラッシュの系統：「S.S.S」
        //   スピリットカードをコストを支払わずに召喚 (count.max は BSLH01-M03 と同型の
        //   「4 − 現在フィールドスピリット数」動的上限、multiplier:-1 + offset:4)。
        // (2) grant_extra_steps でリフレッシュ→アタックの順に1回ずつステップを挿入
        //   (ENGINE-extra-turn-step-insertion primitive、turn-system.ts advanceStep 参照)。
        //   原文「行える」= 任意 (project_kuwaerareru_optional)。前段 summon は強制実行・
        //   後段のみ任意という頻出構造 (executionMode:"optional" 定義コメント参照) のため、
        //   本 step だけ execute/decline を選べる resolve_pending_step_optional_choice を通す。
        {
          label: "guided_skill",
          coreCost: 7,
          timing: { step: "attack", whose: "own", subPhase: "end" },
          minLevel: 2,
          maxLevel: 2,
          turnLimit: "once_per_name",
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    fieldCoreSourceMinimum: {
                      categories: ["spirit", "ultimate"],
                      minimum: 1,
                    },
                    kind: "summon",
                    target: {
                      kind: "from_zone",
                      zone: ["hand", "trash"],
                      filter: { category: ["spirit"], tribes: ["S.S.S"] },
                      count: {
                        min: 0,
                        max: {
                          source: {
                            kind: "cards_in_zone",
                            zone: "field",
                            player: "self",
                            filter: { category: ["spirit"] },
                          },
                          multiplier: -1,
                          offset: 4,
                        },
                      },
                    },
                    costModifier: "free",
                  },
                },
                {
                  executionMode: "optional",
                  action: {
                    kind: "grant_extra_steps",
                    steps: ["refresh", "attack"],
                  },
                },
              ],
              textRef: [9, 10],
            },
          ],
        },
      ],
    },
    tribe: "導界者・CB・S.S.S",
    image: "images/BSLH01-X01.webp",
    rarity: "X",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // textLines[0-2]【導託：CB＆コスト3以上】(対象スピリット召喚/煌臨時コア+1・配置時デッキ3枚
      //   トラッシュ→対象毎コア+1) は grandwalkerData(kind:"guided") +
      //   keywordTags(enter_field_core_placement_forbidden) で engine が表現する
      //   （checkAndQueueOracleChoices / checkAndQueuePlacementOracle）。
      //   召喚/煌臨での導託はステップに1回制約を oracleTriggerLimit が表現する。
      // Lv1-Lv2 シンボルを赤/紫/緑/白/黄/青/黒としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: [
                "red",
                "purple",
                "green",
                "white",
                "yellow",
                "blue",
                "black",
              ],
            },
          },
        ],
        textRef: [4],
      },
      // 【導技：2】は grandwalkerData.divineSkills[0] で表現する(textRef:[6,7])。
      // 【導技：7】は grandwalkerData.divineSkills[1] で表現する(textRef:[9,10])。
    ],
  },
  {
    cardNo: "BSLH01-X02",
    orikaId: 544,
    orikaIndex: 542,
    name: "[創界神]キーア-零の至宝",
    printedCategory: "nexus",
    colors: ["red", "purple", "green", "white", "yellow", "blue", "black"],
    cost: 9,
    reductionSymbols: [],
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
    symbolColors: ["god"],
    textLines: [
      "【神託：〔CB＆コスト3以上〕】",
      "◆対象の自分のスピリットを召喚/煌臨したとき、このネクサスにコア+1できる。",
      "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきこのネクサスにコア+1する。",
      "",
      "手札/手元/トラッシュにあるこのカードは、このカード以外の自分の効果を受けず、自分のメインステップにコア8個以上の自分の導界者ネクサスの「キーア」1つを破壊することで、コストを支払わずに配置できる。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、赤/紫/緑/白/黄/青/黒としても扱う。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分のフィールドにいないトークンの「アイオーンα」/「アイオーンβ」/「アイオーンγ」1体ずつまでを出す。",
      "",
      "【神技：3】Lv2『自分のメインステップ』",
      "〔ターンに1回：同名〕〔このネクサスのコア-3する〕このネクサスの『このネクサスの配置時』効果を発揮する。",
    ],
    keywordTags: ["grandwalker", "enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        { tribes: ["CB"], categories: ["spirit"], minCost: 3 },
      ],
      // 【神技：3】Lv2『自分のメインステップ』〔ターンに1回：同名、コア-3〕。コスト
      // (コア3個→ボイド)・ターン制限は divineSkills 経路でエンジンが検査・支払う
      // (project_divine_skill_model_target_maxuses)。効果本体は『このネクサスの配置時』
      // 効果 (effects[2], textRef:[8,9]) の steps をそのまま複製する self 再発揮
      // (project_summon_effect_reactivation_pattern、BSLH01-X01 divineSkills precedent)。
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 3,
          timing: "main",
          minLevel: 2,
          turnLimit: "once_per_name",
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    kind: "put",
                    target: {
                      kind: "from_token_pool",
                      count: 1,
                      allRelatedTokens: true,
                    },
                  },
                },
              ],
              textRef: [11, 12],
            },
          ],
        },
      ],
    },
    tribe: "創界神・CB",
    image: "images/BSLH01-X02.webp",
    rarity: "X",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSLH01-T04", "BSLH01-T05", "BSLH01-T06"],
    effects: [
      // textLines[0-2]【神託：CB＆コスト3以上】(対象スピリット召喚/煌臨時コア+1・配置時デッキ3枚
      //   トラッシュ→対象毎コア+1) は grandwalkerData(kind:"grandwalker") +
      //   keywordTags(enter_field_core_placement_forbidden) で engine が表現する
      //   （checkAndQueueOracleChoices / checkAndQueuePlacementOracle）。DSL effect 不要。
      // 手札/手元/トラッシュにあるこのカードは、このカード以外の自分の効果を受けない。
      {
        timing: { kind: "continuous" },
        applicability: { zone: ["hand", "set_aside", "trash"] },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
              sourcePlayerScope: "self",
              sourceScope: { excludeSelf: true },
            },
          },
        ],
        textRef: [4],
      },
      // Q54: 自分のメインステップに、コア8個以上の自分の導界者ネクサス「キーア」1つを
      // 宣言コストとして破壊し、stack window 後にこのカードを無償配置する。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { zone: ["hand", "set_aside", "trash"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["nexus"],
            cardNames: [{ contains: "キーア" }],
            grandwalkerKind: "guided",
            minCores: 8,
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "summon",
              normalActionPermission: true,
              target: {
                kind: "self",
                zone: ["hand", "set_aside", "trash"],
              },
              costModifier: "free",
              normalActionDeclarationSteps: [
                {
                  id: "destroy-keya",
                  action: {
                    kind: "destroy",
                    target: {
                      kind: "filter",
                      player: "self",
                      filter: {
                        category: ["nexus"],
                        targetsGrandwalker: "only",
                        hasMechanic: ["guided"],
                        cardName: { contains: "キーア" },
                        minCores: 8,
                      },
                      count: 1,
                    },
                  },
                },
              ],
            },
          },
        ],
        textRef: [4],
      },
      // Lv1-Lv2 シンボルを赤/紫/緑/白/黄/青/黒としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: [
                "red",
                "purple",
                "green",
                "white",
                "yellow",
                "blue",
                "black",
              ],
            },
          },
        ],
        textRef: [6],
      },
      // Lv1-Lv2『配置時』自分のフィールドにいないトークン アイオーンα/β/γ を1体ずつ出す
      // (engine-multi-token-pool-put)。コストの記述が無いため無償。「フィールドにいない」は
      // put(from_token_pool, allRelatedTokens:true) の maxTokenDeckCount 残数チェックで
      // 自動的に表現される。
      {
        timing: { kind: "card_event", event: "place" },
        steps: [
          {
            action: {
              kind: "put",
              target: {
                kind: "from_token_pool",
                count: 1,
                allRelatedTokens: true,
              },
            },
          },
        ],
        textRef: [8, 9],
      },
      // 【神技：3】は grandwalkerData.divineSkills[0] で表現する(textRef:[11,12])。
    ],
  },
  {
    cardNo: "BSLH01-X03",
    quartzData: {
      quartzName: "行動力",
      cost: 0,
      reduction: [],
      countCost: 1,
      attributeValues: { 時: 3 },
    },
    orikaId: 545,
    orikaIndex: 543,
    name: "[創の軌跡]ロイド・バニングス",
    printedCategory: "spirit",
    colors: ["black"],
    cost: 7,
    reductionSymbols: ["black", "black", "black", "black"],
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
        requiredCores: 3,
        bp: 12000,
      },
    ],
    symbolColors: ["black"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットのアタック/ブロック時』",
      "このスピリットに黒シンボル1つを追加する。さらに、ステップに1回、このスピリットは回復できる。",
      "",
      "Lv2-Lv3『自分のターン』",
      "相手のマジックの「このターンの間」を「次のバトル終了後まで」に変更する。",
      "",
      "Lv2-Lv3 フラッシュ『お互いのアタックステップ』",
      "【ソウルドライブ・S】自分のフィールド/リザーブの<ソウルコア>1個を除外すると、相手のスピリット/アルティメット2体までをデッキの下に戻し、自分のスピリットすべてを回復させる。この効果は相手の効果では防げない。",
      "",
      "【クォーツ：行動力｜コストC1｜属性値：<時>3（手札から対象にセットできる）】",
      "ターンに1回、自分のスピリットが疲労したとき、その対象1体を回復できる。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-X03.webp",
    rarity: "X",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-3『アタック/ブロック時』即時部分: ステップ1回の任意回復。
      // 黒シンボル追加は同じ本文に属する常時部分として末尾で定義する。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        executionMode: "optional",
        steps: [
          {
            action: { kind: "recover", target: { kind: "self" } },
            usageLimit: { kind: "per_instance", duration: "step", maxCount: 1 },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『自分のターン』相手マジックの「このターンの間」を「次のバトル終了後まで」に変更。
      // duration_override CE (ENGINE-continuous-effect-duration-rewrite) が、失効判定の
      // 都度、相手のマジック発揮元の scope:"turn" CE を scope:"battle"+nextBattleEnd:true
      // へ実効的に読み替える (生成順序に非依存)。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "turn" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "duration_override",
              fromScope: "turn",
              player: "opponent",
              cardFilter: { category: ["magic"] },
              toDuration: { scope: "battle", nextBattleEnd: true },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-3 フラッシュ【ソウルドライブ・S】相手スピ/アルティ2体までデッキ下＋自スピリット全回復。
      // 発動コスト=自分のフィールド/リザーブの<ソウルコア>1個をゲームから除外
      // (P3-125 Step1、CoreLocation.removed_from_game 新設 + effectKind:explicit_soul_core、
      // soul は player 単一ポインタのため候補選択不要)。send_to_deck の対象は元々 count:
      // {min:0,max:2} で「相手候補が居ない/0体選択」を許容する設計のため、connector:
      // conditional_cost (0体選択=コスト不払い扱いにする「ことで」双方向汎用ゲート、
      // isConditionalCostTargetShortage) は誤爆する。send_to_deck/recover 両方に
      // stepCondition:ref_succeeded でコスト step 自体を直接参照させ、コスト成否のみで
      // ゲートする。「相手の効果では防げない」= preventionLevel:"unpreventable"
      // (BSSL01-X02 同型)。timingScope:{player:"both",period:"attack"} は「お互いの
      // アタックステップ」の明示 (省略時 isTimingScopeActive は無制限扱いになる罠、
      // BSAZ01.ts:1197-1205 precedent。P3-125 Step8 adversarial verifier round3 で
      // Step1 時点の見落としと判明し追加)。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        preventionLevel: "unpreventable",
        steps: [
          {
            id: "x03-soul-drive-s-cost",
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self", includeReserve: true },
              to: { kind: "removed_from_game", player: "self" },
              amount: 1,
              effectKind: "explicit_soul_core",
            },
          },
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                },
                count: { min: 0, max: 2 },
              },
              position: "bottom",
            },
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x03-soul-drive-s-cost",
            },
          },
          {
            action: {
              kind: "recover",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: "all",
              },
            },
            connector: "simultaneous",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x03-soul-drive-s-cost",
            },
          },
        ],
        textRef: [6, 7],
      },
      // 【クォーツ：行動力】セット中効果: ターンに1回、自分のスピリットが疲労したとき、
      // その対象1体を回復できる。第三者 game_event:exhaust 観測 (BSTH03-転醒R01(A) 同型の
      // triggerFilter) + target:trigger_related_instance で主語Y自身を回復
      // (project_battle_end_third_party_observation と同系統パターン、BSTH05-X02 precedent)。
      // 「ターンに1回」= per_instance duration:turn (発揮元=このクォーツカード自身)。
      // applicability.soulState:true でセット中のみ発火。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "exhaust",
          triggerFilter: { category: ["spirit"] },
        },
        applicability: { soulState: true },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "recover",
              target: { kind: "trigger_related_instance" },
            },
          },
        ],
        textRef: [9, 10],
      },
      // 同じアタック/ブロック時本文の常時部分。回復の実行/辞退と独立して、
      // このスピリットが参加している間だけ黒シンボル1つを追加する。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "in_battle" }],
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "black",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0, 1],
      },
    ],
  },
  {
    cardNo: "BSLH01-X04",
    quartzData: {
      quartzName: "脱兎",
      cost: 0,
      reduction: [],
      countCost: 1,
      attributeValues: { 風: 3 },
    },
    orikaId: 546,
    orikaIndex: 544,
    name: "[創の軌跡]エリィ・マクダエル",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "green", "green"],
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
        requiredCores: 3,
        bp: 10000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "〔ターンに1回：同名〕ボイドからコア1個ずつを系統：「CB」を持つ自分のスピリット4体までに置ける。その後、トラッシュのコア1個を自分のライフに置ける。",
      "",
      "Lv2-Lv3 フラッシュ『お互いのアタックステップ』",
      "【ソウルドライブ・S】〔ターンに1回：同名〕自分のフィールド/リザーブの<ソウルコア>1個を除外すると、ボイドからコア3個までを自分のライフに置き（ライフは最大5）、自分のスピリットが4体になるまでトラッシュにある系統：「CB」を持つスピリットカードをコストを支払わずに自分のスピリット/アルティメットのコアを0個にせずに召喚できる。",
      "",
      "【クォーツ：脱兎｜コストC1｜属性値：<風>3（手札から対象にセットできる）】",
      "ターンに1回、フラッシュタイミングで、自分のスピリット1体をデッキの下に戻せる。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-X04.webp",
    rarity: "X",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
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
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "core_distribute",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["CB"],
                },
                count: "all",
              },
              amount: 4,
              mode: "player_choice",
              maxPerCandidate: 1,
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "core_move",
              from: {
                kind: "trash",
                player: "self",
              },
              to: {
                kind: "life",
                player: "self",
              },
              amount: 1,
            },
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: {
          player: "both",
          period: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            id: "x04-soul-drive-s-cost",
            action: {
              kind: "core_move",
              from: {
                kind: "field",
                player: "self",
                includeReserve: true,
              },
              to: {
                kind: "removed_from_game",
                player: "self",
              },
              amount: 1,
              effectKind: "explicit_soul_core",
            },
          },
          {
            id: "x04-soul-drive-s-life",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x04-soul-drive-s-cost",
            },
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
              amount: {
                min: 0,
                max: {
                  source: {
                    kind: "cores_on",
                    location: {
                      kind: "life",
                      player: "self",
                    },
                  },
                  multiplier: -1,
                  offset: 5,
                  cap: 3,
                },
              },
            },
          },
          {
            connector: "simultaneous",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x04-soul-drive-s-cost",
            },
            action: {
              fieldCoreSourceMinimum: {
                categories: ["spirit", "ultimate"],
                minimum: 1,
              },
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "trash",
                filter: {
                  category: ["spirit"],
                  tribes: ["CB"],
                },
                count: {
                  min: 0,
                  max: {
                    source: {
                      kind: "cards_in_zone",
                      zone: "field",
                      player: "self",
                      filter: {
                        category: ["spirit"],
                      },
                    },
                    multiplier: -1,
                    offset: 4,
                  },
                },
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        activationLabel: "none",
        applicability: {
          soulState: true,
        },
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-X05",
    quartzData: {
      quartzName: "攻撃2",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 火: 3 },
    },
    orikaId: 547,
    orikaIndex: 545,
    name: "[創の軌跡]ランディ・オルランド",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 7,
    reductionSymbols: ["red", "red", "red", "red"],
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
      "Lv1-Lv2-Lv3 フラッシュ『自分のアタックステップ』",
      "〔ターンに1回：同名〕魂状態の自分の「ENIGMA」があるとき、自分のライフのコア1個をボイドに置くことで、ゲーム外から<ソウルコア>1個を自分のリザーブに置く。",
      "",
      "Lv2-Lv3 フラッシュ『お互いのアタックステップ』",
      "【ソウルドライブ・S】〔ターンに1回：同名〕自分のフィールド/リザーブの<ソウルコア>1個を除外すると、シンボル合計5つまで相手のスピリット/アルティメット/ネクサスを破壊する。この効果は相手の効果では防げない。",
      "",
      "【クォーツ：攻撃2｜コストC2｜属性値：<火>3（手札から対象にセットできる）】",
      "合体していない本来のコスト6以上の系統：「CB」を持つ自分のスピリットすべてに赤シンボル1つずつを追加する。",
    ],
    keywordTags: ["soul_state"],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-X05.webp",
    rarity: "X",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-3 フラッシュ〔ターン1回:同名〕ENIGMA時、ライフ1ボイド→ゲーム外<ソウルコア>をリザーブ。
      // BSLH01-R03 effects[1] と同一テキスト・同型実装 (conditional_cost +
      // generateSoulCoreOutsideGame primitive)。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "self", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "ENIGMA" }],
            includeSoulState: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "void", player: "self" },
              amount: 1,
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "outside_game" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-3 フラッシュ『お互いのアタックステップ』【ソウルドライブ・S】〔ターンに1回:同名〕
      // シンボル合計5つまで相手スピ/アルティ/ネクサスを破壊。発動コスト = X03 と同型
      // (P3-125 Step1、CoreLocation.removed_from_game + effectKind:explicit_soul_core)。
      // 「シンボル合計5つまで」= 新設 budget.metric:"symbol"
      // (ENGINE-cumulative-symbol-budget-destroy、BSAZ01-C11 の budget.metric:"bp" 型と同型、
      // getCombinedUnitSymbolCount 基準)。count:{min:0} + budget で「好きなだけ、ただし
      // シンボル合計Xまで」を表す。「相手の効果では防げない」= preventionLevel:"unpreventable"
      // (X03 precedent)。コストの成否は stepCondition:ref_succeeded で destroy 側にゲートする。
      // timingScope:{player:"both",period:"attack"} は「お互いのアタックステップ」の明示
      // (省略時 isTimingScopeActive は無制限扱いになる罠、BSAZ01.ts:1197-1205 precedent)。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        preventionLevel: "unpreventable",
        steps: [
          {
            id: "x05-soul-drive-s-cost",
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self", includeReserve: true },
              to: { kind: "removed_from_game", player: "self" },
              amount: 1,
              effectKind: "explicit_soul_core",
            },
          },
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                    { category: ["nexus"] },
                  ],
                },
                count: { min: 0 },
                budget: { metric: "symbol", amount: 5 },
              },
            },
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x05-soul-drive-s-cost",
            },
          },
        ],
        textRef: [3, 4],
      },
      // 【クォーツ：攻撃2】セット中効果（継続）: 合体していない本来コスト6以上の CB 自スピリット
      // すべてに赤シンボル1つずつ追加。applicability.soulState でセット中のみ。
      {
        timing: { kind: "continuous" },
        applicability: { soulState: true },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["CB"],
                  minCost: 6,
                  costBasis: "printed",
                  combined: false,
                },
                count: "all",
              },
              symbol: "red",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-X06",
    quartzData: {
      quartzName: "封技の刃",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 水: 6 },
    },
    orikaId: 548,
    orikaIndex: 546,
    name: "[創の軌跡]ティオ・プラトー",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 6,
    reductionSymbols: ["blue", "blue", "blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
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
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、相手のスピリット/アルティメット2体を重疲労できる。",
      "",
      "Lv1-Lv2-Lv3",
      "〔重複不可〕自分の系統：「導力器」を持つトークンマジックカードの使用コストを-2する。",
      "",
      "Lv2-Lv3 フラッシュ/スタック",
      "【ソウルドライブ・S】自分のフィールド/リザーブの<ソウルコア>1個を除外すると、次の自分のスタートステップまで、系統：「CB」を持つ自分のスピリットすべては相手の効果を受けない。",
      "",
      "【クォーツ：封技の刃｜コストC2｜属性値：<水>6（手札から対象にセットできる）】",
      "自分のアタックステップ中、相手の手札のマジックカードのコストを+1する。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S・みっしぃ",
    image: "images/BSLH01-X06.webp",
    rarity: "X",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-3『召喚/アタック時』ターン1回、相手スピ/アルティ2体を重疲労できる。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                },
                count: 2,
              },
              degree: "heavy_exhaust",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-3〔重複不可〕導力器トークンマジックの使用コストを-2する。
      // isToken:true で「トークンマジック」限定を系統フィルタと独立に絞り込む
      // (CardFilter.isToken、SSOT = isCardDefinitionToken)。
      {
        timing: { kind: "continuous" },
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "self",
              cardFilter: {
                category: ["magic"],
                tribes: ["導力器"],
                isToken: true,
              },
              modifier: { additionalCostValue: -2 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-3 フラッシュ/スタック【ソウルドライブ・S】次の自分スタートまで CB 自スピリット全体が相手効果を受けない。
      // 発動コスト=P3-125 Step1 と同型 (from:field+includeReserve, effectKind:explicit_soul_core,
      // to:removed_from_game)。「次の自分のスタートステップまで」=
      // duration:{scope:"step", step:"start", whose:"self"} (BSTH02.7-C01 choice 枝 precedent)。
      // 「系統：「CB」を持つ自分のスピリットすべては相手の効果を受けない」=
      // effect_immunity(target:filter tribes:["CB"] category:["spirit"] zone:["field"],
      // sourcePlayerScope 既定"opponent"のblanket免疫)。target.zone を明示することで
      // dynamicTargetFilterFromEffectTarget (structured-continuous-effects.ts) の動的
      // targetFilter 登録経路に乗せ、宣言後に新規召喚された CB スピリットも次の自分の
      // スタートステップまで保護対象に含める(「すべて」= 継続的な全体保護。zone省略のまま
      // だと dynamicTargetFilterFromEffectTarget が null を返し宣言時点の静的スナップショット
      // に縮退し、後から召喚された対象が漏れる)。フラッシュ/スタック両ウィンドウで
      // 使用可能なため mode 別に 2 entry (R02 recover precedent同型)。頻度制限が原文に
      // 無いため limitGroupId 不要 (ソウルコア消費が自然な使用回数上限)。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            id: "x06-soul-drive-s-cost-flash",
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self", includeReserve: true },
              to: { kind: "removed_from_game", player: "self" },
              amount: 1,
              effectKind: "explicit_soul_core",
            },
          },
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], tribes: ["CB"] },
                count: "all",
                zone: ["field"],
              },
              duration: { scope: "step", step: "start", whose: "self" },
            },
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x06-soul-drive-s-cost-flash",
            },
          },
        ],
        textRef: [6, 7],
      },
      {
        timing: { kind: "activated", mode: "stack" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            id: "x06-soul-drive-s-cost-stack",
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self", includeReserve: true },
              to: { kind: "removed_from_game", player: "self" },
              amount: 1,
              effectKind: "explicit_soul_core",
            },
          },
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], tribes: ["CB"] },
                count: "all",
                zone: ["field"],
              },
              duration: { scope: "step", step: "start", whose: "self" },
            },
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x06-soul-drive-s-cost-stack",
            },
          },
        ],
        textRef: [6, 7],
      },
      // 【クォーツ：封技の刃】セット中効果（継続）: 自分のアタックステップ中、相手の手札の
      // マジックカードのコストを+1する。cost_modify(player:"opponent", cardFilter:zone:hand)
      // (BSGE01-M02/BSAZ02-C12 precedent)。「自分のアタックステップ中」= continuous +
      // condition:step_phase(attack, self) で live ゲート (BSAZ02-C12 同型)。
      // applicability.soulState でセット中のみ発火。
      {
        timing: { kind: "continuous" },
        applicability: { soulState: true },
        condition: [{ kind: "step_phase", step: "attack", whose: "self" }],
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "opponent",
              cardFilter: { category: ["magic"], zone: ["hand"] },
              modifier: { additionalCostValue: 1 },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSLH01-X07",
    quartzData: {
      quartzName: "防御3",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 地: 5 },
    },
    orikaId: 549,
    orikaIndex: 547,
    name: "[創の軌跡]ノエル・シーカー",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 6,
    reductionSymbols: ["white", "white", "white"],
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
    symbolColors: ["white"],
    textLines: [
      "手札にあるこのカードは、自分のスピリットが相手の効果でフィールドを離れるとき、その対象1体を手札に戻し、軽減シンボルすべてを満たして召喚できる。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "手札にある系統：「CB」を持つカード1枚をコストを支払わずに召喚できる。",
      "",
      "Lv3 フラッシュ",
      "【ソウルドライブ・S】〔ターンに1回：同名〕自分のフィールド/リザーブの<ソウルコア>1個を除外すると、自分のデッキを上から6枚オープンする。その中の系統：「CB」を持つカード3枚までをコストを支払わずに召喚し、残りはデッキの下に戻す。",
      "",
      "【クォーツ：防御3｜コストC2｜属性値：<地>5（手札から対象にセットできる）】",
      "ターンに1回、系統：「CB」を持つ自分のスピリットが相手のスピリット/ネクサスの効果でフィールドを離れるとき、同じ状態でフィールドに残せる。",
    ],
    keywordTags: [],
    tribe: "CB・S.S.S",
    image: "images/BSLH01-X07.webp",
    rarity: "X",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 手札のこのカードは、自スピリットが相手効果で離れるとき、対象を手札に戻し軽減満たして召喚できる。
      // 10_rules/04_state-based-rules: 待機状態は「フィールドを離れるとき」効果から参照可能。
      // 離脱 pending の主語を直接 bounce→hand へ遷移し、成功時だけ
      // costModifier:"full_reduction" の self summon へ進む（10_rules/03a_cost-payment）。
      {
        applicability: { zone: ["hand"] },
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          triggerFilter: { category: ["spirit"] },
          cause: "opponent_effect",
        },
        executionMode: "optional",
        steps: [
          {
            id: "x07-leave-target-to-hand",
            stepCondition: {
              kind: "summon_precheck",
              target: { kind: "self", zone: "hand" },
              costModifier: "full_reduction",
            },
            action: {
              kind: "bounce",
              target: {
                kind: "trigger_related_instance",
                includePendingLeave: true,
              },
              destination: "hand",
            },
          },
          {
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x07-leave-target-to-hand",
            },
            action: {
              kind: "summon",
              target: { kind: "self", zone: "hand" },
              costModifier: "full_reduction",
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-3『召喚時』手札の CB カード1枚をコストなし召喚できる。
      {
        timing: { kind: "card_event", event: "summon" },
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
                  tribes: ["CB"],
                },
                count: 1,
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv3 フラッシュ【ソウルドライブ・S】デッキ6オープン→CB 3枚までコストなし召喚、残りデッキ下。
      // 発動コスト=P3-125 Step1 と同型 (from:field+includeReserve, effectKind:explicit_soul_core,
      // to:removed_from_game)。「Lv3」= 発動条件そのものが Lv3 限定なため timingScope 不要
      // (原文に「アタックステップ」等のステップ限定が無い、他 BSLH01-X* との差異)。
      // 「デッキ上から6枚オープン→CB 3枚までコストを支払わずに召喚→残りはデッキの下」=
      // deck_reveal(revealCount:6, picks:[{count:3,filter:tribes:CB,destination:"field"}],
      // remainder:"bottom")。destination:"field" は
      // ENGINE-deck-reveal-field-entry-core-fill (pending-action-handlers.ts
      // finalizeDeckReveal) 経由で spirit/ultimate/brave を `effect:summon:` ログとして
      // 扱い、召喚時トリガーの発火と維持コア自動補填の両方を行う既存汎用プリミティブ
      // (return_from_trash/search_deck の "配置" 専用パスとは異なり、deck_reveal の
      // destination:"field" は既に「召喚」として実装済み)。pick count はデフォルトで
      // 0..count (「まで」) のため mandatory 指定不要。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [{ kind: "min_level", value: 3 }],
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            id: "x07-soul-drive-s-cost",
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self", includeReserve: true },
              to: { kind: "removed_from_game", player: "self" },
              amount: 1,
              effectKind: "explicit_soul_core",
            },
          },
          {
            action: {
              kind: "deck_reveal",
              revealCount: 6,
              picks: [
                {
                  count: 3,
                  filter: {
                    category: ["spirit", "ultimate", "brave"],
                    tribes: ["CB"],
                  },
                  destination: "field",
                },
              ],
              remainder: "bottom",
            },
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x07-soul-drive-s-cost",
            },
          },
        ],
        textRef: [5, 6],
      },
      // 【クォーツ：防御3】セット中効果: ターンに1回、系統：「CB」を持つ自分のスピリットが
      // 相手のスピリット/ネクサスの効果でフィールドを離れるとき、対象を同じ状態で残せる。
      // triggerSourceFilter を spirit/nexus に絞る以外は BSLH01-C06 魔防2と同型
      // (game_event leave_field 第三者観測 + stay_on_field(trigger_related_instance))。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          triggerFilter: { category: ["spirit"], tribes: ["CB"] },
          triggerSourceFilter: { category: ["spirit", "nexus"] },
          cause: ["opponent_effect"],
        },
        applicability: { soulState: true },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "stay_on_field",
              target: {
                kind: "trigger_related_instance",
                includePendingLeave: true,
              },
            },
          },
        ],
        // textRef は【クォーツ：防御3】見出し行[8]＋本文行[9]。見出し行を含めることで
        // inferRequiredQuartzInheritedSourceRole が requiredSourceRole:"quartz_inherited" を
        // 推論する（BSLH01-C06 [5,6] / X08 [6,7] / R01 [6,7] と同じ規約）。
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSLH01-X08",
    quartzData: {
      quartzName: "省EP2",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 空: 3, 時: 1, 幻: 2 },
    },
    orikaId: 550,
    orikaIndex: 548,
    name: "[創の軌跡]ワジ・ヘミスフィア",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 7,
    reductionSymbols: ["yellow", "yellow", "yellow"],
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
        bp: 14000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック/ブロック時』",
      "このターンの間、相手のスピリット/アルティメット/ネクサス1つの効果を発揮させず、相手のスピリット/アルティメット/ネクサス1つをデッキの下に戻す。自分のターンなら、この効果で創界神ネクサスも対象にできる。",
      "",
      "Lv2-Lv3 フラッシュ『自分のアタックステップ』",
      "【ソウルドライブ・S】〔ターンに1回：同名〕自分のフィールド/リザーブの<ソウルコア>1個を除外すると、このターンの間、系統：「CB」を持つ自分のスピリットによるライフの減少は相手の効果では防げない。",
      "",
      "【クォーツ：省EP2｜コストC2｜属性値：<空>3 <時>1 <幻>2（手札から対象にセットできる）】",
      "自分が系統：「導力器」を持つトークンマジックカードを使用するとき、そのコストを-1する。",
    ],
    keywordTags: [],
    tribe: "CB・SC・S.S.S",
    image: "images/BSLH01-X08.webp",
    rarity: "X",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-3『召喚/アタック/ブロック時』相手スピ/アルティ/ネクサス1つの効果を抑止＋1つをデッキ下。
      // 自分のターンだけ創界神/導界者ネクサスも対象に含めるため、turn_player で2登録に分ける。
      {
        timing: { kind: "card_event", event: ["summon", "attack", "block"] },
        condition: [{ kind: "turn_player", player: "opponent" }],
        executionMode: "mandatory",
        allowDuplicateTargets: true,
        steps: [
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                    { category: ["nexus"] },
                  ],
                },
                count: 1,
              },
              scope: "entire",
              duration: { scope: "turn" },
            },
          },
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                    { category: ["nexus"] },
                  ],
                },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: { kind: "card_event", event: ["summon", "attack", "block"] },
        condition: [{ kind: "turn_player", player: "self" }],
        executionMode: "mandatory",
        allowDuplicateTargets: true,
        steps: [
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                    { category: ["nexus"] },
                    {
                      category: ["nexus"],
                      targetsGrandwalker: "only",
                    },
                  ],
                },
                count: 1,
              },
              scope: "entire",
              duration: { scope: "turn" },
            },
          },
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                    { category: ["nexus"] },
                    {
                      category: ["nexus"],
                      targetsGrandwalker: "only",
                    },
                  ],
                },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-3 フラッシュ『自分のアタックステップ』【ソウルドライブ・S】〔ターンに1回:同名〕
      // 発動コスト=P3-125 Step1 と同型 (from:field+includeReserve, effectKind:explicit_soul_core,
      // to:removed_from_game)。「自分のアタックステップ」= timingScope:{player:"self",
      // period:"attack"} (BSLH01-C01 effects[1] 先例と同型)。「このターンの間、系統：「CB」を
      // 持つ自分のスピリットによるライフの減少は相手の効果では防げない」= P3-125 Step3 新設
      // grant_life_damage_source_prevention_immunity (player-scoped CE、sourceFilter で発生源
      // カードを判定。消費側は core-system.ts applyLifeDamageInterception(効果起因) /
      // battle-actions.ts getUnblockedLifeDamage(バトル起因、参加体単位))。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "self", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            id: "x08-soul-drive-s-cost",
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self", includeReserve: true },
              to: { kind: "removed_from_game", player: "self" },
              amount: 1,
              effectKind: "explicit_soul_core",
            },
          },
          {
            action: {
              kind: "grant_life_damage_source_prevention_immunity",
              player: "self",
              sourceFilter: { category: ["spirit"], tribes: ["CB"] },
              duration: { scope: "turn" },
            },
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x08-soul-drive-s-cost",
            },
          },
        ],
        textRef: [3, 4],
      },
      // 【クォーツ：省EP2】セット中効果: 自分の導力器トークンマジック使用コストを-1。
      // applicability.soulState でセット中のみ発火 (先例: BSLH01-C08/X06 の cost_modify、
      // gate は BSLH01-X05 攻撃2 と同型)。
      {
        timing: { kind: "continuous" },
        applicability: { soulState: true },
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "self",
              cardFilter: {
                category: ["magic"],
                tribes: ["導力器"],
                isToken: true,
              },
              modifier: { additionalCostValue: -1 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSLH01-X09",
    quartzData: {
      quartzName: "練刃",
      cost: 0,
      reduction: [],
      countCost: 1,
      attributeValues: { 幻: 2, 地: 1 },
    },
    orikaId: 551,
    orikaIndex: 549,
    name: "[創の軌跡]リーシャ・マオ",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: ["purple", "purple", "purple", "purple", "purple"],
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
        requiredCores: 5,
        bp: 15000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "〔ターンに1回：同名〕手札/トラッシュにあるこのカードは、系統：「CB」を持つ自分のスピリットが相手の効果でフィールドを離れるとき、召喚できる。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、相手のフィールドのコア2個までをトラッシュに置く。",
      "",
      "Lv2-Lv3 フラッシュ『お互いのアタックステップ』",
      "【ソウルドライブ・S】〔ターンに1回：同名〕自分のフィールド/リザーブの<ソウルコア>1個を除外すると、このスピリットのLv1につき、相手のスピリット/アルティメットのコア2個をトラッシュに置き、消滅した対象1体につき自分のトラッシュにある系統：「CB」を持つカード1枚を手札に戻す。",
      "",
      "【クォーツ：練刃｜コストC1｜属性値：<幻>2 <地>1（手札から対象にセットできる）】",
      "自分がスピリットの効果でデッキをオープン/破棄するとき、枚数を+1できる。",
    ],
    keywordTags: [],
    tribe: "CB・CR・S.S.S",
    image: "images/BSLH01-X09.webp",
    rarity: "X",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: {
          zone: ["hand", "trash"],
        },
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          triggerFilter: {
            category: ["spirit"],
            tribes: ["CB"],
          },
          cause: "opponent_effect",
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
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
                max: 2,
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: {
          player: "both",
          period: "attack",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
        ],
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        allowDuplicateTargets: true,
        steps: [
          {
            id: "x09-soul-drive-s-cost",
            action: {
              kind: "core_move",
              from: {
                kind: "field",
                player: "self",
                includeReserve: true,
              },
              to: {
                kind: "removed_from_game",
                player: "self",
              },
              amount: 1,
              effectKind: "explicit_soul_core",
            },
          },
          {
            id: "x09-soul-drive-cores",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x09-soul-drive-s-cost",
            },
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
                kind: "trash",
                player: "opponent",
              },
              amount: 2,
            },
            repeat: {
              additional: {
                source: {
                  kind: "source_effective_level",
                },
                offset: -1,
              },
            },
          },
          {
            connector: "after_state_check",
            stepCondition: {
              kind: "ref_leave_established",
              stepId: "x09-soul-drive-cores",
              leaveKind: "vanish",
            },
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                filter: {
                  tribes: ["CB"],
                },
                count: {
                  source: {
                    kind: "cards_from_ref",
                    stepId: "x09-soul-drive-cores",
                    establishedLeaveKind: "vanish",
                  },
                },
              },
              from: {
                zone: "trash",
                player: "self",
                filter: {
                  tribes: ["CB"],
                },
              },
              to: {
                zone: "hand",
              },
              count: {
                source: {
                  kind: "cards_from_ref",
                  stepId: "x09-soul-drive-cores",
                  establishedLeaveKind: "vanish",
                },
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
        applicability: {
          soulState: true,
        },
        steps: [
          {
            action: {
              kind: "grant_optional_deck_reveal_count_boost",
              player: "self",
              sourceFilter: {
                category: ["spirit"],
              },
              bonusAmount: 1,
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
    cardNo: "BSLH01-X10",
    quartzData: {
      quartzName: "天穹珠",
      cost: 0,
      reduction: [],
      countCost: 2,
      attributeValues: { 火: 5 },
    },
    orikaId: 552,
    orikaIndex: 550,
    name: "[碧の軌跡]シグムント・オルランド",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 8,
    reductionSymbols: ["red", "red", "red", "red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 12000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 18000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "【バースト：相手による自分のライフ減少後】",
      "このカードを、コストを支払わずに召喚するか、自分の魂状態の対象にセットする。その後、自分の魂状態の「ENIGMA」の【クォーツ】の属性値のいずれか1種の合計が6以上のとき、ゲーム外から<ソウルコア>1個を自分のスピリット/リザーブに置く。この効果発揮後、このスピリットの【ソウルドライブ・S】を発揮できる。",
      "",
      "Lv1-Lv2-Lv3 フラッシュ『お互いのアタックステップ』",
      "【ソウルドライブ・S】自分のフィールド/リザーブの<ソウルコア>1個を除外すると、相手のスピリット/アルティメット3体までを破壊し、その効果を発揮させず、このターンの間、このスピリットに赤のシンボル1つを追加する。",
      "",
      "【クォーツ：天穹珠｜コストC2｜属性値：<火>5（手札から対象にセットできる）】",
      "コスト5以下の相手のスピリットのバトル終了時、その対象を破壊できる。",
    ],
    keywordTags: ["burst", "soul_state"],
    tribe: "CB",
    image: "images/BSLH01-X10.webp",
    rarity: "X",
    pack: "BSLH01 英雄伝説 軌跡シリーズ",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: {
            kind: "life_decrease",
            player: "self",
          },
        },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
              costModifier: "free",
            },
            choice: [
              {
                action: {
                  kind: "quartz_set",
                  target: {
                    kind: "self",
                  },
                },
              },
            ],
          },
          {
            action: {
              kind: "core_move",
              from: {
                kind: "outside_game",
              },
              amount: 1,
              splitDestinations: {
                destinations: [
                  {
                    location: {
                      kind: "field_card",
                      player: "self",
                      filter: {
                        category: ["spirit"],
                      },
                    },
                  },
                  {
                    location: {
                      kind: "reserve",
                      player: "self",
                    },
                  },
                ],
              },
            },
            connector: "sequential",
            condition: [
              {
                kind: "quartz_attribute",
                player: "self",
                attribute: "any",
                min: 6,
              },
            ],
          },
          ...x10SoulDriveSteps(true),
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: {
          player: "both",
          period: "attack",
        },
        steps: x10SoulDriveSteps(),
        textRef: [3, 4],
      },
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "battle_end",
          triggerFilter: {
            category: ["spirit"],
            maxCost: 5,
          },
        },
        applicability: {
          soulState: true,
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "trigger_related_instance",
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
];
