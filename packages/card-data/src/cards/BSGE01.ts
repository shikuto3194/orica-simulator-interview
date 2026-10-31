import type { CardDefinition, Effect, EffectStep } from "@orica/rules-core";

const BSGE01_SPIRIT_STATE_EVENT_BRAVE_COMBINE_EFFECT: Effect = {
  timing: {
    kind: "game_event",
    player: "self",
    event: ["summon", "soul_state_to_spirit_state"],
    triggerFilter: { category: ["spirit"] },
    exactEventKind: true,
  },
  applicability: { combined: false },
  executionMode: "optional",
  steps: [
    {
      action: {
        kind: "brave_combine_effect",
        target: { kind: "trigger_related_instance" },
      },
    },
  ],
  textRef: [3],
};

/**
 * BSGE01-M03『雨宮ツバキ』【バースト：自分のライフ減少後】本体の steps。
 * 裁定 2026-07-23 (10_rules/04b_burst-rules.md §セット中バーストの追加発動条件) により
 * 「セットしているこのカードは、自分のスピリットがアタックしたときに発動できる」型は
 * 同じバースト本体への追加発動条件のため、通常条件 (life_decrease) の effect と
 * own_attack trigger の effect の2エントリで steps を共有する。
 */
const BSGE01_M03_BURST_STEPS: EffectStep[] = [
  {
    action: {
      kind: "core_move",
      target: {
        kind: "filter",
        player: "opponent",
        filter: {
          filterOr: [{ category: ["spirit"] }, { category: ["ultimate"] }],
        },
        count: 1,
      },
      from: { kind: "target_card" },
      to: { kind: "reserve", player: "opponent" },
      amount: "all",
    },
  },
  {
    action: { kind: "noop" },
    choice: [
      {
        action: {
          kind: "move_card",
          target: {
            kind: "filter",
            player: "self",
            zone: "trash",
            filter: {
              filterOr: [
                { category: ["brave"], colors: ["red", "purple"] },
                { category: ["nexus"], colors: ["red", "purple"] },
              ],
            },
            count: 1,
          },
          from: {
            zone: "trash",
            player: "self",
            filter: {
              filterOr: [
                { category: ["brave"], colors: ["red", "purple"] },
                { category: ["nexus"], colors: ["red", "purple"] },
              ],
            },
          },
          to: { zone: "hand" },
          count: 1,
        },
      },
    ],
    connector: "simultaneous",
  },
];

/**
 * BSGE01-M04『竹田ヒバリ』【バースト：フィールドを離れた自分のスピリットが魂状態になった後】
 * 本体の steps。M03 と同様、own_attack 追加発動条件 (effects[1]) と通常条件 (enter_soul_state,
 * effects[2]) の2エントリで steps を共有する。
 */
const BSGE01_M04_BURST_STEPS: EffectStep[] = [
  {
    action: {
      kind: "exhaust",
      target: {
        kind: "filter",
        player: "opponent",
        filter: {
          filterOr: [{ category: ["spirit"] }, { category: ["ultimate"] }],
        },
        count: 1,
      },
      degree: "heavy_exhaust",
    },
  },
  {
    action: {
      kind: "deck_reveal",
      revealCount: 5,
      picks: [
        {
          count: 1,
          filter: { colors: ["green", "blue"], hasMechanic: ["mirage"] },
          mandatory: true,
          destination: "mirage_set",
        },
        {
          count: 1,
          filter: { category: ["brave"], colors: ["green", "blue"] },
          mandatory: true,
          destination: "hand",
        },
      ],
      remainder: "bottom",
    },
  },
];

export const BSGE01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSGE01-C01",
    orikaId: 272,
    orikaIndex: 282,
    name: "ティアーストーン",
    printedCategory: "magic",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red", "red"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "【ミラージュ：コスト2<赤>（このカードは手札からセットできる）】",
      "【セット中】",
      "魂状態を含む自分の「神薙 ユウ」がいるとき、自分の系統：「神喰」を持つ効果で自分のカウントが増えた/減ったとき、自分の手札が5枚以下なら、自分はデッキの上から1枚ドローできる。",
      "",
      "メイン",
      "自分の創界神ネクサス/導界者ネクサスがないとき、自分は、デッキの上から2枚ドローするか、トラッシュにある契約カード1枚を手札に戻す。",
    ],
    keywordTags: ["soul_state"],
    tribe: "神喰",
    image: "images/BSGE01-C01.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【ミラージュ：コスト2<赤>】は mirageData 宣言（BSGE01-C04 同型）。
    mirageData: { cost: 2, reduction: ["red"] },
    effects: [
      // 【セット中】魂状態を含む「神薙 ユウ」がいるとき、自分の系統：「神喰」を持つ効果で
      // カウントが増減したとき、手札5枚以下ならデッキ上から1枚ドローできる。BSGE01-C04
      // effects[1] と同型 (game_event + applicability.zone:["mirage_set"]) だが、条件が
      // 「そうしたとき破棄」ではなく事前の hand_count ゲート (draw 前提条件) な点が異なる。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["count_increase", "count_decrease"],
          triggerFilter: { tribes: ["神喰"] },
        },
        applicability: { zone: ["mirage_set"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "神薙 ユウ" }],
            includeSoulState: true,
          },
          { kind: "hand_count", player: "self", max: 5 },
        ],
        executionMode: "optional",
        steps: [
          {
            action: { kind: "draw", count: 1 },
          },
        ],
        textRef: [0, 1, 2],
      },
      // メイン 創界神/導界者がないとき、デッキ2ドロー or トラッシュの契約カードを手札に戻す。
      {
        timing: { kind: "activated", mode: "main" },
        condition: [
          { kind: "field_lacks", player: "self", grandwalkerKind: "any" },
        ],
        steps: [
          {
            action: { kind: "draw", count: 2 },
            choice: [
              {
                // 原文「契約カード1枚を手札に戻す」(終止形=強制) → mandatory:true で
                // pendingZoneSelection.canSkip:false を伝搬し、空選択 (0 枚) を拒否する。
                action: {
                  kind: "search_zone",
                  zone: "trash",
                  player: "self",
                  filter: { isContract: true },
                  count: 1,
                  destination: "hand",
                  mandatory: true,
                },
              },
            ],
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSGE01-C02",
    orikaId: 273,
    orikaIndex: 283,
    name: "剛属性バックラー真",
    printedCategory: "magic",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green", "green"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "【ミラージュ：コスト2<緑>（このカードは手札からセットできる）】",
      "【セット中】『自分のアタックステップ』",
      "魂状態を含む自分の「霊代 アキ」がいるとき、系統：「神喰」を持つ自分のスピリットのアタック宣言からバトル終了後まで、相手のバースト/スタック効果を無効にする。",
      "",
      "フラッシュ",
      "相手のスピリット/アルティメット1体を重疲労させる。または、系統：「GE」を持つ自分のスピリット1体を回復させる。",
    ],
    keywordTags: ["burst", "soul_state"],
    tribe: "神喰",
    image: "images/BSGE01-C02.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【ミラージュ：コスト2<緑>】は mirageData 宣言（BSGE01-C01/C04 同型）。
    mirageData: { cost: 2, reduction: ["green"] },
    effects: [
      // 【ミラージュ】【セット中】『自分のアタックステップ』霊代アキ(魂状態含む)がいるとき、
      // 系統：神喰の自分のスピリットのアタック宣言〜バトル終了後まで、相手のバースト/スタック
      // 効果を無効にする。「相手の…効果を無効にする」= 読点なし card/effect-target 文言
      // (project_player_target_vs_card_target)。「アタック宣言〜バトル終了後まで」は
      // field_has.battleState:"attacking" が activeAttack 解消まで真であることを利用した
      // 動的スコープ (BSTH09.2-転醒R03(B) 同型、continuousEffectDependsOnBattleState /
      // recomputeAndRebuildBattleStateContinuousEffects が宣言/バトル終了で再評価する)。
      // バースト側は negate(negateTarget:"opponent_burst", 既定 burstSuppressKind:"nullify")、
      // スタック効果は使用を認めて解決だけを無効化する。duration は while_set。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        applicability: { zone: ["mirage_set"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "霊代 アキ" }],
            includeSoulState: true,
          },
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            tribes: ["神喰"],
            battleState: "attacking",
          },
        ],
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "opponent_burst",
              duration: { scope: "while_set" },
            },
          },
          {
            action: {
              kind: "negate",
              negateTarget: "effect",
              targetEffectTiming: "stack",
              duration: { scope: "while_set" },
            },
          },
        ],
        textRef: [0, 1, 2],
      },
      // フラッシュ 相手スピ/アルティ1体を重疲労 or GE 自スピリット1体を回復。
      {
        timing: { kind: "activated", mode: "flash" },
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
                count: 1,
              },
              degree: "heavy_exhaust",
            },
            choice: [
              {
                action: {
                  kind: "recover",
                  target: {
                    kind: "filter",
                    player: "self",
                    filter: { category: ["spirit"], tribes: ["GE"] },
                    count: 1,
                  },
                },
              },
            ],
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSGE01-C03",
    orikaId: 274,
    orikaIndex: 284,
    name: "ディソレイト",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["purple", "purple"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "【ミラージュ：コスト2<紫>（このカードは手札からセットできる）】",
      "【セット中】『自分のメインステップ』",
      "魂状態を含む自分の「空木 レンカ」がいるとき、このターン、自分がミラージュ効果でドローしていなければ、自分は手札の系統：「神喰」を持つカード1枚を破棄することで、デッキの上から3枚ドローする。",
      "",
      "フラッシュ",
      "魂状態を含む自分の「空木 レンカ」がいるとき、このターンの間、自分の魂状態のカードすべての【リンクエイド】を「フィールド/リザーブから1コスト支払って、フィールド/リザーブのコアを好きなだけ置いてスピリット状態にする」に変更する。",
    ],
    keywordTags: ["soul_state"],
    tribe: "神喰",
    image: "images/BSGE01-C03.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【ミラージュ：コスト2<紫>】は mirageData 宣言（BSGE01-C02/C11 同型）。
    mirageData: { cost: 2, reduction: ["purple"] },
    effects: [
      // 【ミラージュ】【セット中】『自分のメインステップ』空木レンカ(魂状態含む)がいるとき、
      // このターン未ドロー(mirage_draw_occurred negate)なら、手札の系統:「神喰」1枚破棄
      // することで(conditional_cost)、デッキ上から3枚ドロー。BSTS01-C06 と同型の
      // timing:activated mode:"main" + applicability.zone:"mirage_set"（timingScope 併記不要、
      // BSTS01-C06 確認済み前例）。discard→draw は BSSG01-C07 同型 conditional_cost connector。
      {
        timing: { kind: "activated", mode: "main" },
        applicability: { zone: ["mirage_set"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "空木 レンカ" }],
            includeSoulState: true,
          },
          {
            kind: "mirage_draw_occurred",
            scope: "turn",
            player: "self",
            negate: true,
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
              filter: { tribes: ["神喰"] },
            },
          },
          {
            action: { kind: "draw", count: 3 },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1, 2],
      },
      // フラッシュ 空木レンカ(魂状態含む)がいるとき、このターンの間、自分の魂状態カード
      // すべての【リンクエイド】を「フィールド/リザーブから1コスト支払って、フィールド/
      // リザーブのコアを好きなだけ置いてスピリット状態にする」に変更する。
      // grant_link_aid_cost_override player-scoped CE (bsge01-c03-linkaid-rewrite) を
      // 登録するのみ。消費側 (getAvailableLinkAidLegalActions /
      // resolveDeferredLinkAidStack、mechanics/link-aid-system.ts
      // isLinkAidCostOverrideActive) が起動コスト源の costSourceTribes/zoneRoleName 制限を
      // 撤廃してフィールド/リザーブ全体へ、charge の sourceScope を reserve_only から
      // field_and_reserve へ拡張する。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "空木 レンカ" }],
            includeSoulState: true,
          },
        ],
        steps: [
          {
            action: {
              kind: "grant_link_aid_cost_override",
              player: "self",
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSGE01-C04",
    orikaId: 275,
    orikaIndex: 285,
    name: "剛属性バックラー堅",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "【ミラージュ：コスト2<青>（このカードは手札からセットできる）】",
      "【セット中】",
      "魂状態を含む自分の「加賀美 リョウ」がいるとき、自分の手札は5枚以下の間、相手の効果を受けない。自分の系統：「神喰」を持つ効果で自分のカウントが増えた/減ったとき、自分はデッキの上から1枚ドローできる。そうしたとき、自分は手札が5枚以下になるように破棄する。",
      "",
      "フラッシュ",
      "自分はデッキの上から3枚ドローし、ドロー後、手札2枚を破棄する。",
    ],
    keywordTags: ["soul_state"],
    tribe: "神喰",
    image: "images/BSGE01-C04.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    mirageData: { cost: 2, reduction: ["blue"] },
    effects: [
      // 【ミラージュ：コスト2<青>】は mirageData 宣言（BSDB01-R04/BSKB01-R04 同型）。
      // 【セット中】加賀美リョウ(魂状態含む)がいるとき、手札5枚以下の間、相手の効果を
      // 受けない = 手札という「人称+読点」を伴わないゾーン/カード対象の耐性
      // (project_player_target_vs_card_target: 「自分の手札は」は読点を伴わず「手札」を
      // 主語化するためカード/ゾーン対象。プレイヤー対象ではない)。BSDB01-C06/BSTS01-C05/
      // BSTH02.7-C03 と同型の effect_immunity target.zone:["hand"] ゾーン全体免疫
      // (ENGINE-effect-immunity-hand-zone-scope) だが、ソースがミラージュ滞在中限定な点が
      // 異なる。duration:{scope:"while_set"} はミラージュ/バースト【セット中】専用の
      // ゾーン束縛 (legal-actions-shared.ts recomputeContinuousEffects 除去判定と対称、
      // BSTH08.5-C21 の while_set 用途と同型) で、通常の while_on_field (フィールド常駐)
      // の代わりに使う。structured-continuous-effects.ts の動的 targetFilter 生成条件を
      // while_on_field 限定から while_set も含むよう拡張した。
      {
        timing: { kind: "continuous" },
        applicability: { zone: ["mirage_set"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "加賀美 リョウ" }],
            includeSoulState: true,
          },
          { kind: "hand_count", player: "self", max: 5 },
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
              duration: { scope: "while_set" },
            },
          },
        ],
        textRef: [0, 1, 2],
      },
      // (2) 自分の系統：「神喰」を持つ効果でカウントが増減したとき、デッキ上から1枚
      // ドローできる(任意)。ドローが実際に成立したときのみ、手札5枚以下になるよう破棄
      // (BSTS01 summon/advent ドロー→discard targetHandSize:5 と同じ conditional_result
      // 連結。発揮有無は effect.executionMode、後続依存は conditional_result で表現)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["count_increase", "count_decrease"],
          triggerFilter: { tribes: ["神喰"] },
        },
        applicability: { zone: ["mirage_set"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "加賀美 リョウ" }],
            includeSoulState: true,
          },
        ],
        executionMode: "optional",
        steps: [
          {
            id: "drew",
            action: { kind: "draw", count: 1 },
          },
          {
            action: {
              kind: "discard",
              player: "self",
              count: -1,
              targetHandSize: 5,
            },
            connector: "conditional_result",
          },
        ],
        textRef: [0, 1, 2],
      },
      // フラッシュ デッキ3ドロー後、手札2枚を破棄する。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "draw", count: 3 } },
          {
            action: { kind: "discard", count: 2, player: "self" },
            connector: "sequential",
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSGE01-C05",
    combinedBoost: 6000,
    orikaId: 276,
    orikaIndex: 286,
    name: "第一世代神機 ブラッドサージ",
    printedCategory: "brave",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 5000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "フラッシュ【契約合体：GE＆赤／紫『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から合体する。（合体していたブレイヴは破棄する。）",
      "",
      "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された/スピリット状態になった自分のスピリットに合体できる。",
      "",
      "『このブレイヴの召喚/契約合体時』",
      "自分は、手札1枚を破棄することで、デッキの上から3枚ドローする。",
      "",
      "【合体条件：GE＆系統名に「O」を含まない】",
      "【合体中】『このスピリットのアタック時』",
      "自分のカウント+3する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
    ],
    keywordTags: [],
    tribe: "神喰・神機・1G",
    image: "images/BSGE01-C05.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【合体条件：GE＆系統名に「O」を含まない】([8]) は【契約合体：GE＆赤/紫】ヘッダー([0])とは
    // 別の、標準の合体条件キーワード。10_rules/05:30「合体中のスピリットが合体条件を満たさなく
    // なった場合、ただちに分離する」の継続チェックは state-based-actions.ts が CardDefinition
    // 直下の braveCondition (top-level) を見る既存 SSOT のため、ここにも配線する
    // (contractCombineData.braveCondition は合体アクション自体の対象ゲート用で別物)。
    braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O"] },
    contractCombineData: {
      braveCondition: {
        tribes: ["GE"],
        colors: ["red", "purple"],
        excludeTribeSubstring: ["O"],
      },
      timingScope: { player: "self", period: "turn" },
    },
    effects: [
      // スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず（BSTH05-M11/
      // BSAZ02-C10 同型: continuous + applicability.combined:false + effect_resistance
      // (exhaust) + prevent_battle、ruleStrength:true）。「召喚された/スピリット状態になった
      // 自分のスピリットに合体できる」は通常合体を消す制限ではなく追加タイミング許可
      // として、末尾の game_event + brave_combine_effect で trigger_related_instance に固定する。
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
        textRef: [3],
      },
      // 『召喚/契約合体時』手札1枚を破棄することで、デッキ3ドロー。
      // 通常召喚側は trigger 'summon'、契約合体側は登録生成時に
      // brave_combined cause:"contract_combine" へ展開する。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          { action: { kind: "discard", count: 1, player: "self" } },
          {
            action: { kind: "draw", count: 3 },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
      // 【合体中】『アタック時』自分のカウント+3する。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 3,
              protectedFromNonTribe: "神喰",
            },
          },
        ],
        textRef: [9, 10],
      },
      BSGE01_SPIRIT_STATE_EVENT_BRAVE_COMBINE_EFFECT,
    ],
  },
  {
    cardNo: "BSGE01-C06",
    combinedBoost: 6000,
    orikaId: 277,
    orikaIndex: 287,
    name: "第一世代神機 ステラスウォーム",
    printedCategory: "brave",
    colors: ["green"],
    cost: 5,
    reductionSymbols: ["green", "green", "green"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 5000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "フラッシュ【契約合体：GE＆青／緑『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から合体する。（合体していたブレイヴは破棄する。）",
      "",
      "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された/スピリット状態になった自分のスピリットに合体できる。",
      "",
      "【合体条件：GE＆系統名に「O」を含まない】",
      "【合体中】『このブレイヴ/スピリットの契約合体/アタック時』",
      "自分のカウント-2することで、相手のスピリット/アルティメット2体まで重疲労させる。その後、疲労状態の相手のスピリット/アルティメット1体をデッキの下に戻せる。",
    ],
    keywordTags: [],
    tribe: "神喰・神機・1G",
    image: "images/BSGE01-C06.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 合体条件キーワード ([8]) は契約合体ヘッダー ([0]) と別。10_rules/05:30 の継続分離チェック
    // (state-based-actions.ts) 用に top-level braveCondition へ配線する。
    braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O"] },
    contractCombineData: {
      braveCondition: {
        tribes: ["GE"],
        colors: ["blue", "green"],
        excludeTribeSubstring: ["O"],
      },
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず（BSGE01-C05 と
      // 同型: continuous + applicability.combined:false + effect_resistance(exhaust) +
      // prevent_battle、ruleStrength:true。「合体できる」は末尾の game_event 効果で
      // そのイベント主語に固定する。
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
        textRef: [3],
      },
      // 【合体中】『このブレイヴ/スピリットの契約合体/アタック時』
      // 自分のカウント-2することで、相手のスピリット/アルティメット2体まで重疲労させる。
      // その後、疲労状態の相手のスピリット/アルティメット1体をデッキの下に戻せる。
      //   effect 全体は「ことで」構文 (10_rules/03c §78-80) で任意発揮 = executionMode:"optional"。
      //   cost gate: count_decrease(2) を「ことで」連結 (connector:"conditional_cost") で
      //     0..2 体の重疲労対象選択へ。0 体選択時はコスト不払い rollback (10_rules/03c §14
      //     「○○することで△△する」双方向)。
      //   その後の send_to_deck (bottom) は executionMode:"optional"、疲労状態 (exhausted/
      //     heavily_exhausted 両方) を CardFilter.exhaustState で強制。
      //   P3-111 S3: 「契約合体時」と「アタック時」は別 effect に分離する。
      //   cause:["contract_combine"] は brave_combined イベントのうち contract_combine
      //   legal action 由来の attach 遷移にのみ付与される (trigger-system.ts
      //   braveCombinedCause)。召喚時合体/直接合体では cause 未付与のため一致しない。
      //   単一 eventKind の Timing を維持する理由: 複数 eventKind (brave_combined と attack)
      //   を1つの Timing.event 配列にまとめると、family が異なる (brave_link vs
      //   battle_declaration) 2 種のイベントに同じ cause フィルタが誤って合成されてしまう
      //   (structured-effect-registrations.ts の eventMatcher は effect 単位で1つ)。
      {
        timing: {
          kind: "card_event",
          event: "brave_combined",
          cause: ["contract_combine"],
        },
        condition: [{ kind: "combined" }],
        executionMode: "optional",
        steps: [
          {
            executionMode: "optional",
            action: { kind: "count_decrease", player: "self", amount: 2 },
          },
          {
            targetSelectionTiming: "on_step",
            id: "heavy-exhaust-up-to-2",
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: { min: 0, max: 2 },
              },
              degree: "heavy_exhaust",
            },
            connector: "conditional_cost",
          },
          {
            id: "send-to-deck-exhausted",
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
            executionMode: "optional",
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
      // 【合体中】『このスピリットのアタック時』(同上、trigger:attack 側)。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        executionMode: "optional",
        steps: [
          {
            executionMode: "optional",
            action: { kind: "count_decrease", player: "self", amount: 2 },
          },
          {
            targetSelectionTiming: "on_step",
            id: "heavy-exhaust-up-to-2",
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: { min: 0, max: 2 },
              },
              degree: "heavy_exhaust",
            },
            connector: "conditional_cost",
          },
          {
            id: "send-to-deck-exhausted",
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
            executionMode: "optional",
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
      BSGE01_SPIRIT_STATE_EVENT_BRAVE_COMBINE_EFFECT,
    ],
  },
  {
    cardNo: "BSGE01-C07",
    combinedBoost: 6000,
    orikaId: 278,
    orikaIndex: 288,
    name: "第二世代神機 イーヴィルワン",
    printedCategory: "brave",
    colors: ["blue"],
    cost: 5,
    reductionSymbols: ["blue", "blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 5000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "フラッシュ【契約合体：GE＆青／緑『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から合体する。（合体していたブレイヴは破棄する。）",
      "",
      "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された/スピリット状態になった自分のスピリットに合体できる。",
      "",
      "『このブレイヴの召喚／契約合体時』",
      "自分は、デッキの上から3枚ドローでき、ドロー後手札1枚を破棄する。自分がゲーム開始時に提示した契約カードが緑のとき、かわりにボイドからコア2個を自分のリザーブに置く。",
      "",
      "【合体条件：GE＆系統名に「O」を含まない】",
      "【合体中】『このスピリットのアタック時』",
      "自分のカウント+3する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
    ],
    keywordTags: [],
    tribe: "神喰・神機・1G",
    image: "images/BSGE01-C07.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 合体条件キーワード ([8]) は契約合体ヘッダー ([0]) と別。10_rules/05:30 の継続分離チェック
    // (state-based-actions.ts) 用に top-level braveCondition へ配線する。
    braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O"] },
    contractCombineData: {
      braveCondition: {
        tribes: ["GE"],
        colors: ["blue", "green"],
        excludeTribeSubstring: ["O"],
      },
      timingScope: { player: "self", period: "turn" },
    },
    effects: [
      // スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず（BSGE01-C05 と
      // 同型: continuous + applicability.combined:false + effect_resistance(exhaust) +
      // prevent_battle、ruleStrength:true。「合体できる」は末尾の game_event 効果で
      // そのイベント主語に固定する。
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
        textRef: [3],
      },
      // 『召喚/契約合体時』（通常召喚側は trigger 'summon'、契約合体側は登録生成時に
      // brave_combined cause:"contract_combine" へ展開する。C05 と同型）。
      // 提示契約カードが緑以外: デッキ3ドロー→手札1破棄（「でき」= executionMode:optional）。
      {
        timing: { kind: "card_event", event: "summon" },
        condition: [
          {
            kind: "presented_contract_color",
            player: "self",
            color: "green",
            negate: true,
          },
        ],
        executionMode: "optional",
        steps: [
          { action: { kind: "draw", count: 3 } },
          {
            action: { kind: "discard", count: 1, player: "self" },
            connector: "sequential",
          },
        ],
        textRef: [5, 6],
      },
      // 提示契約カードが緑: かわりにボイドからコア2個をリザーブに置く（「置く」終止形=強制、
      // memory project_kuwaerareru_optional）。BSES01 同型 core_move（void→reserve）primitive。
      {
        timing: { kind: "card_event", event: "summon" },
        condition: [
          { kind: "presented_contract_color", player: "self", color: "green" },
        ],
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
        textRef: [5, 6],
      },
      // 【合体中】『アタック時』自分のカウント+3する。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 3,
              protectedFromNonTribe: "神喰",
            },
          },
        ],
        textRef: [9, 10],
      },
      BSGE01_SPIRIT_STATE_EVENT_BRAVE_COMBINE_EFFECT,
    ],
  },
  {
    cardNo: "BSGE01-C08",
    combinedBoost: 6000,
    orikaId: 279,
    orikaIndex: 289,
    name: "第一世代神機 モウスィブロウ",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 5,
    reductionSymbols: ["yellow", "purple", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 5000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "フラッシュ【契約合体：GE＆赤／紫／黄『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から合体する。（合体していたブレイヴは破棄する。）",
      "",
      "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された/スピリット状態になった自分のスピリットに合体できる。",
      "",
      "【合体条件：GE＆系統名に「O」を含まない】",
      "【合体中】『このブレイヴ/スピリットの契約合体/アタック時』",
      "自分のカウント-1することで、相手のスピリット/アルティメット1体をBP-10000する。追加で自分のカウントを減らすことで、減らしたカウント1につき、この効果を追加で1回発揮する。その後、BP0になった相手のスピリット/アルティメットすべてを破壊する。",
    ],
    keywordTags: [],
    tribe: "神喰・神機・1G",
    image: "images/BSGE01-C08.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 合体条件キーワード ([5]) は契約合体ヘッダー ([0]) と別。10_rules/05:30 の継続分離チェック
    // (state-based-actions.ts) 用に top-level braveCondition へ配線する。
    braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O"] },
    contractCombineData: {
      braveCondition: {
        tribes: ["GE"],
        colors: ["red", "purple", "yellow"],
        excludeTribeSubstring: ["O"],
      },
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず（BSGE01-C05 と
      // 同型: continuous + applicability.combined:false + effect_resistance(exhaust) +
      // prevent_battle、ruleStrength:true。「合体できる」は末尾の game_event 効果で
      // そのイベント主語に固定する。
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
        textRef: [3],
      },
      // 【合体中】『契約合体/アタック時』カウント支払い回数連動 BP-10000→BP0破壊。
      // P3-111 S3: 「契約合体時」と「アタック時」は別 effect に分離する（BSGE01-C06 と同型。
      // family 混在 (brave_link vs battle_declaration) を1つの eventMatcher に合成しないため）。
      {
        timing: {
          kind: "card_event",
          event: "brave_combined",
          cause: ["contract_combine"],
        },
        condition: [{ kind: "combined" }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "count_decrease",
              player: "self",
              amount: {
                source: { kind: "selected_targets", stepId: "bp0" },
              },
            },
          },
          {
            id: "bp0",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                },
                count: 1,
              },
              amount: -10000,
              duration: { scope: "turn" },
            },
            connector: "conditional_cost",
            // 「追加で…この効果を追加で1回発揮」は、各発揮時点の候補集合から対象を
            // 選び直す。選択回数だけを先取りして対象を一括確定してはならない。
            targetSelectionTiming: "on_step",
            repeat: {
              additional: {
                source: { kind: "count_value", player: "self" },
                offset: -1,
              },
              executionAdditional: {
                source: { kind: "selected_targets", stepId: "bp0" },
                offset: -1,
              },
              optional: true,
            },
          },
          {
            action: {
              kind: "destroy",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
            },
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "count_decrease",
              player: "self",
              amount: {
                source: { kind: "selected_targets", stepId: "bp0" },
              },
            },
          },
          {
            id: "bp0",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                },
                count: 1,
              },
              amount: -10000,
              duration: { scope: "turn" },
            },
            connector: "conditional_cost",
            // 契約合体時効果と同じく、追加発揮ごとに対象を独立に選び直す。
            targetSelectionTiming: "on_step",
            repeat: {
              additional: {
                source: { kind: "count_value", player: "self" },
                offset: -1,
              },
              executionAdditional: {
                source: { kind: "selected_targets", stepId: "bp0" },
                offset: -1,
              },
              optional: true,
            },
          },
          {
            action: {
              kind: "destroy",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
            },
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
      BSGE01_SPIRIT_STATE_EVENT_BRAVE_COMBINE_EFFECT,
    ],
  },
  {
    cardNo: "BSGE01-C09",
    orikaId: 280,
    orikaIndex: 290,
    name: "愚者の空母",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "red"],
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
      "【ミラージュ：コスト2<赤>（このカードは手札からセットできる）】",
      "【セット中】",
      "魂状態を含む自分の「神薙 ユウ」がいるとき、自分の系統：「神喰」を持つ効果で自分のカウントが増えた/減ったとき、自分の手札が5枚以下なら、自分はデッキの上から1枚ドローできる。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分のカウント+2する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
      "",
      "Lv2",
      "〔ターンに1回：同名〕自分は、魂状態を含む「神薙 ユウ」に《ソウルコア》をトラッシュに置いたものとして【契約合体】できる。",
    ],
    keywordTags: ["soul_state"],
    tribe: "神喰",
    image: "images/BSGE01-C09.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // Lv2〔ターンに1回：同名〕「神薙 ユウ」への契約合体プロキシ起動（P3-111 S4）。
    // engine が汎用的に処理する（getAvailableContractCombineLegalActions のプロキシ枠）ため
    // カード固有の DSL steps は不要。対象は魂状態を含む（S3.5 の soulStateContractTargets
    // 経由で自動的に取り込まれる）。
    contractCombineProxyData: {
      requiredLevel: 2,
      targetCardNames: [{ contains: "神薙 ユウ" }],
    },
    // 【ミラージュ：コスト2<赤>】は mirageData 宣言（BSGE01-C01/C04 同型）。
    mirageData: { cost: 2, reduction: ["red"] },
    effects: [
      // 【セット中】BSGE01-C01 effects[0] と同型 (game_event count_increase/decrease
      // + applicability.zone:["mirage_set"] + hand_count<=5 事前ゲート + 任意ドロー)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["count_increase", "count_decrease"],
          triggerFilter: { tribes: ["神喰"] },
        },
        applicability: { zone: ["mirage_set"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "神薙 ユウ" }],
            includeSoulState: true,
          },
          { kind: "hand_count", player: "self", max: 5 },
        ],
        executionMode: "optional",
        steps: [
          {
            action: { kind: "draw", count: 1 },
          },
        ],
        textRef: [0, 1, 2],
      },
      // Lv1-Lv2『このネクサスの配置時』自分のカウント+2する。
      {
        timing: { kind: "card_event", event: "place" },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
              protectedFromNonTribe: "神喰",
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSGE01-C10",
    orikaId: 281,
    orikaIndex: 291,
    name: "鎮魂の廃寺",
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
        requiredCores: 1,
        bp: 0,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "【ミラージュ：コスト2<紫>（このカードは手札からセットできる）】",
      "【セット中】『自分のメインステップ』",
      "魂状態を含む自分の「空木 レンカ」がいるとき、このターン、自分がミラージュ効果でドローしていなければ、自分は手札の系統：「神喰」を持つカード1枚を破棄することで、デッキの上から3枚ドローする。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分のカウント+2する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
      "",
      "Lv2",
      "〔ターンに1回：同名〕自分は、魂状態を含む「空木 レンカ」に《ソウルコア》をトラッシュに置いたものとして【契約合体】できる。",
    ],
    keywordTags: ["soul_state"],
    tribe: "神喰",
    image: "images/BSGE01-C10.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【ミラージュ：コスト2<紫>】は mirageData 宣言（BSGE01-C02/C03/C11 同型）。
    mirageData: { cost: 2, reduction: ["purple"] },
    // Lv2〔ターンに1回：同名〕「空木 レンカ」への契約合体プロキシ起動（P3-111 S4）。
    // BSGE01-C09 と同型（engine 側の一般規則としてすでに表現済み）。
    contractCombineProxyData: {
      requiredLevel: 2,
      targetCardNames: [{ contains: "空木 レンカ" }],
    },
    effects: [
      // 【ミラージュ】【セット中】『自分のメインステップ』空木レンカ(魂状態含む)がいるとき、
      // このターン未ドロー(mirage_draw_occurred negate)なら、手札の系統:「神喰」1枚破棄
      // することで(conditional_cost)、デッキ上から3枚ドロー。BSGE01-C03 effects[0] と同型
      // (詳細コメントは同カード参照)。
      {
        timing: { kind: "activated", mode: "main" },
        applicability: { zone: ["mirage_set"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "空木 レンカ" }],
            includeSoulState: true,
          },
          {
            kind: "mirage_draw_occurred",
            scope: "turn",
            player: "self",
            negate: true,
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
              filter: { tribes: ["神喰"] },
            },
          },
          {
            action: { kind: "draw", count: 3 },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1, 2],
      },
      // Lv1-Lv2『このネクサスの配置時』自分のカウント+2する。
      {
        timing: { kind: "card_event", event: "place" },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
              protectedFromNonTribe: "神喰",
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSGE01-C11",
    orikaId: 282,
    orikaIndex: 292,
    name: "贖罪の街",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["green", "green"],
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
      "【ミラージュ：コスト2<緑>（このカードは手札からセットできる）】",
      "【セット中】『自分のアタックステップ』",
      "魂状態を含む自分の「霊代 アキ」がいるとき、系統：「神喰」を持つ自分のスピリットのアタック宣言からバトル終了後まで、相手のバースト/スタック効果を無効にする。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分のカウント+2する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
      "",
      "Lv2",
      "〔ターンに1回：同名〕自分は、魂状態を含む「霊代 アキ」に《ソウルコア》をトラッシュに置いたものとして【契約合体】できる。",
    ],
    keywordTags: ["burst", "soul_state"],
    tribe: "神喰",
    image: "images/BSGE01-C11.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // Lv2〔ターンに1回：同名〕「霊代 アキ」への契約合体プロキシ起動（P3-111 S4）。
    // BSGE01-C09 と同型（engine 側の一般規則としてすでに表現済み）。
    // 【ミラージュ：コスト2<緑>】は mirageData 宣言（BSGE01-C01/C04 同型）。
    mirageData: { cost: 2, reduction: ["green"] },
    contractCombineProxyData: {
      requiredLevel: 2,
      targetCardNames: [{ contains: "霊代 アキ" }],
    },
    effects: [
      // 【ミラージュ】【セット中】『自分のアタックステップ』霊代アキ(魂状態含む)がいるとき、
      // 系統：神喰の自分のスピリットのアタック宣言〜バトル終了後まで、相手のバースト/スタック
      // 効果を無効にする。BSGE01-C02 effects[0] と同型 (詳細コメントは同カード参照)。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        applicability: { zone: ["mirage_set"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "霊代 アキ" }],
            includeSoulState: true,
          },
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            tribes: ["神喰"],
            battleState: "attacking",
          },
        ],
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "opponent_burst",
              duration: { scope: "while_set" },
            },
          },
          {
            action: {
              kind: "negate",
              negateTarget: "effect",
              targetEffectTiming: "stack",
              duration: { scope: "while_set" },
            },
          },
        ],
        textRef: [0, 1, 2],
      },
      // Lv1-Lv2『このネクサスの配置時』自分のカウント+2する。
      {
        timing: { kind: "card_event", event: "place" },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
              protectedFromNonTribe: "神喰",
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSGE01-C12",
    orikaId: 283,
    orikaIndex: 293,
    name: "鉄塔の森",
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["blue", "blue"],
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
      "【ミラージュ：コスト2<青>（このカードは手札からセットできる）】",
      "【セット中】",
      "魂状態を含む自分の「加賀美 リョウ」がいるとき、自分の手札は5枚以下の間、相手の効果を受けない。自分の系統：「神喰」を持つ効果で自分のカウントが増えた/減ったとき、デッキの上から1枚ドローでき、ドロー後、手札が5枚以下になるように破棄する。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分のカウント+2する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
      "",
      "Lv2",
      "〔ターンに1回：同名〕自分は、魂状態を含む「加賀美 リョウ」に《ソウルコア》をトラッシュに置いたものとして【契約合体】できる。",
    ],
    keywordTags: ["soul_state"],
    tribe: "神喰",
    image: "images/BSGE01-C12.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // Lv2〔ターンに1回：同名〕「加賀美 リョウ」への契約合体プロキシ起動（P3-111 S4）。
    // BSGE01-C09 と同型（engine 側の一般規則としてすでに表現済み）。
    contractCombineProxyData: {
      requiredLevel: 2,
      targetCardNames: [{ contains: "加賀美 リョウ" }],
    },
    // 【ミラージュ：コスト2<青>】は mirageData 宣言（BSGE01-C04 同型）。
    mirageData: { cost: 2, reduction: ["blue"] },
    effects: [
      // 【セット中】BSGE01-C04 effects[0] と同型 (加賀美リョウ + hand_count<=5 の間、
      // 手札ゾーン全体が相手の効果を受けない。effect_immunity + duration:while_set)。
      {
        timing: { kind: "continuous" },
        applicability: { zone: ["mirage_set"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "加賀美 リョウ" }],
            includeSoulState: true,
          },
          { kind: "hand_count", player: "self", max: 5 },
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
              duration: { scope: "while_set" },
            },
          },
        ],
        textRef: [0, 1, 2],
      },
      // BSGE01-C04 effects[1] と同型 (game_event count_increase/decrease + 任意ドロー
      // → conditional_result で手札5枚以下になるよう破棄)。C04 と違い事前 hand_count
      // ゲートは無く、ドロー成立後の事後破棄のみで手札上限を調整するテキスト構造。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["count_increase", "count_decrease"],
          triggerFilter: { tribes: ["神喰"] },
        },
        applicability: { zone: ["mirage_set"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "加賀美 リョウ" }],
            includeSoulState: true,
          },
        ],
        executionMode: "optional",
        steps: [
          {
            id: "drew",
            action: { kind: "draw", count: 1 },
          },
          {
            action: {
              kind: "discard",
              player: "self",
              count: -1,
              targetHandSize: 5,
            },
            connector: "conditional_result",
          },
        ],
        textRef: [0, 1, 2],
      },
      // Lv1-Lv2『このネクサスの配置時』自分のカウント+2する。
      {
        timing: { kind: "card_event", event: "place" },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
              protectedFromNonTribe: "神喰",
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSGE01-C13",
    orikaId: 284,
    orikaIndex: 294,
    name: "フェンリル極東支部",
    printedCategory: "nexus",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 3,
    reductionSymbols: ["red", "purple", "green", "white", "yellow", "blue"],
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
      "Lv1-Lv2",
      "このネクサスは、自分がゲーム開始時に提示した契約カードの色のシンボル1つを持つ。このネクサスが相手の効果の対象になるとき、相手が相手のカウント-4しなければ、その効果を受けない。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分のカウント+2する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
      "",
      "Lv2",
      "〔ターンに1回：同名〕自分は、《ソウルコア》をトラッシュに置いたものとして【契約合体】できる。",
    ],
    keywordTags: [],
    tribe: "神喰",
    image: "images/BSGE01-C13.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // Lv2〔ターンに1回：同名〕対象カード名の制限なしの契約合体プロキシ起動（P3-111 S4）。
    // BSGE01-C09〜C12 と同型だが targetCardNames を指定しない（無制限）。
    contractCombineProxyData: {
      requiredLevel: 2,
    },
    effects: [
      // Lv1-Lv2 契約色シンボル付与。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbolSource: {
                kind: "presented_contract_colors",
                player: "self",
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [1],
      },
      // Lv1-Lv2 このネクサスが相手効果の対象になるとき、
      // 相手がカウント-4しなければ、その効果を受けない。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "targeted",
          requireTriggerSelf: true,
          triggerFilter: {
            category: ["nexus"],
            cardName: [{ exact: "フェンリル極東支部" }],
          },
          cause: ["opponent_effect"],
        },
        steps: [
          {
            id: "opponent-count-payment",
            executionMode: "optional",
            chooser: "opponent",
            action: {
              kind: "count_decrease",
              player: "opponent",
              amount: 4,
            },
          },
          {
            connector: "unless_previous_succeeded",
            action: {
              kind: "effect_immunity",
              target: { kind: "trigger_related_instance" },
              duration: { scope: "current_effect" },
            },
          },
        ],
        textRef: [1],
      },
      // Lv1-Lv2『このネクサスの配置時』自分のカウント+2する。
      {
        timing: { kind: "card_event", event: "place" },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
              protectedFromNonTribe: "神喰",
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSGE01-C14",
    orikaId: 285,
    orikaIndex: 295,
    name: "ブレイク・ショット",
    printedCategory: "magic",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "red", "red", "red"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "フラッシュ",
      "相手のスピリット/アルティメット1体を破壊する。",
      "",
      "スタック",
      "〔自分のアタックステップ〕自分が赤1色以外と契約していなければ、相手の白のマジックカード1枚の使用を無効にする。",
    ],
    keywordTags: [],
    image: "images/BSGE01-C14.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // フラッシュ 相手のスピリット/アルティメット1体を破壊する。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // スタック 自分が赤1色以外と契約していなければ、相手の白のマジックカード1枚の使用を無効にする。
      // errata 2026-06-26: 契約色ゲートを追加 (デッキ採用レベル判定)。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "self", period: "attack" },
        condition: [
          { kind: "contracts_only_mono_color", player: "self", color: "red" },
        ],
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "use",
              targetFilter: { category: ["magic"], colors: ["white"] },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSGE01-C15",
    orikaId: 286,
    orikaIndex: 296,
    name: "龍虎の牙",
    printedCategory: "magic",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["green"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "フラッシュ",
      "相手のスピリット/アルティメット2体を重疲労させる。",
      "",
      "スタック",
      "〔自分のアタックステップ〕自分が緑1色以外と契約していなければ、相手のマジックカード1枚のフラッシュ効果の使用を無効にする。",
    ],
    keywordTags: [],
    image: "images/BSGE01-C15.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // フラッシュ 相手のスピリット/アルティメット2体を重疲労させる。
      {
        timing: { kind: "activated", mode: "flash" },
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
      // スタック 自分が緑1色以外と契約していなければ、相手のマジックカード1枚のフラッシュ効果の使用を無効にする。
      // errata 2026-06-26: 契約色ゲートを追加 (デッキ採用レベル判定)。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "self", period: "attack" },
        condition: [
          { kind: "contracts_only_mono_color", player: "self", color: "green" },
        ],
        steps: [
          {
            action: {
              kind: "negate",
              negateTarget: "use",
              targetFilter: { category: ["magic"] },
              targetEffectTiming: "flash",
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSGE01-C16",
    orikaId: 287,
    orikaIndex: 297,
    name: "魂の家",
    printedCategory: "magic",
    colors: ["purple"],
    cost: 4,
    reductionSymbols: ["purple", "purple", "purple"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "手札にあるこのカードは、相手の効果を受けない。",
      "",
      "フラッシュ",
      "トラッシュ/魂状態のコスト4以下の紫のスピリットカード1枚をコストを支払わずに召喚する。",
      "",
      "スタック",
      "最低Lvコスト1の相手のスピリット/アルティメット2体のコアが1個になるようにリザーブに置く。この効果は、お互いのアタックステップにしか使えない。",
    ],
    keywordTags: ["soul_state"],
    image: "images/BSGE01-C16.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 手札にあるこのカードは、相手の効果を受けない。
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
        textRef: [0],
      },
      // フラッシュ トラッシュ/魂状態のコスト4以下の紫スピリット1枚をコストなし召喚。
      // 召喚元の違いは includeSoulState で同じ候補集合に含める。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "trash",
                filter: {
                  category: ["spirit"],
                  colors: ["purple"],
                  maxCost: 4,
                },
                count: 1,
                includeSoulState: true,
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [2, 3],
      },
      // スタック 最低Lvコスト1の相手スピ/アルティ2体のコアが1個になるようリザーブに置く（お互いのアタックステップ限定）。
      // 対象を1体ずつ独立解決する repeat（additional:1）で2体分を表現し、各回 core_move の
      // amount は cores_on(target_card) - 1（現在コア数から1個になるまで除去）で動的算出する。
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
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSGE01-C17",
    orikaId: 288,
    orikaIndex: 298,
    name: "デッド・プルーフ",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "スタック効果を使用するとき、このカードのコストを3にする。",
      "",
      "フラッシュ",
      "このターンの間、効果の記述を持つ相手のスピリット/アルティメットによって自分のライフは1しか減らない。",
      "",
      "スタック",
      "［ゲームに1回：同名］相手の『このスピリット/ブレイヴの召喚/契約合体時』効果1つを無効にし、そのスピリット/ブレイヴ1つを破壊する。",
    ],
    keywordTags: [],
    image: "images/BSGE01-C17.webp",
    rarity: "C",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // スタック効果を使用するとき、このカードのコストを3にする。
      {
        timing: { kind: "continuous" },
        applicability: { zone: ["hand", "set_aside"] },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { override: 3 },
              whenUsingEffectMode: "stack",
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ このターン、効果持ち相手スピ/アルティでライフは1しか減らない。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "opponent",
              mode: "turn_cap",
              cap: 1,
              attackerFilter: {
                category: ["spirit", "ultimate"],
                hasEffectText: true,
              },
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [2, 3],
      },
      // スタック ［ゲーム1回］相手の召喚/契約合体時効果1つを無効にし、そのスピリット/ブレイヴ1つを破壊。
      {
        timing: { kind: "activated", mode: "stack" },
        usageLimit: { kind: "per_card_name", duration: "game", maxCount: 1 },
        steps: [
          {
            id: "negate-summon-or-contract-combine",
            action: {
              kind: "negate",
              negateTarget: "effect",
              targetController: "opponent",
              targetEffectFilter: {
                filterOr: [
                  {
                    sourceKinds: ["spirit"],
                    timingKind: "card_event",
                    eventAction: "summon",
                    triggerPhrase: "召喚時",
                  },
                  {
                    sourceKinds: ["spirit"],
                    timingKind: "card_event",
                    eventAction: "brave_combined",
                    triggerPhrase: "契約合体時",
                  },
                ],
              },
            },
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "ref",
                stepId: "negate-summon-or-contract-combine",
              },
            },
            connector: "sequential",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSGE01-CX01",
    orikaId: 289,
    orikaIndex: 299,
    name: "神薙 ユウ",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: ["red", "red"],
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
      {
        level: 3,
        requiredCores: 4,
        bp: 9000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "魂状態のこのカードには【契約合体】できる。このとき、このカードに自分のフィールド/リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "【リンクエイド】フラッシュ『お互いのアタックステップ』",
      "魂状態のこのカードは、系統：「GE」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "【魂状態】/【スピリット】Lv1-Lv2-Lv3【バレットエディット】",
      "ゲーム中に1回、手札1枚をこのカード/スピリットの下に置ける。そうしたとき、デッキの上から1枚ドローする。（下のカードは、フラッシュタイミングで手札1枚と入れ替えられ、フィールドを離れるとき、破棄する。）",
    ],
    keywordTags: ["soul_state", "contract"],
    tribe: "神喰・GE・2G",
    image: "images/BSGE01-CX01.webp",
    rarity: "CX",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【リンクエイド】(P3-111 S6): 魂状態のこのカードは GE スピリットのコア1個を
    // 起動コストとしてリザーブのコアを好きなだけ置いてスピリット状態になる
    // (10_rules/07b §リンクエイド、engine 汎用規則 getAvailableLinkAidLegalActions)。
    linkAidData: {
      costSourceTribes: ["GE"],
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // 魂状態のこのカードには【契約合体】できる（フィールド/リザーブのコアでスピリット状態化）。
      // このカードは契約カード（player.contractCardNo）であるため、engine が汎用的に
      // 魂状態を契約合体の対象に含める（getAvailableContractCombineLegalActions の
      // soulStateContractTargets）。合体実行時に buildChargeCoresPendingCoreDistribution
      // で任意コア配置を開く（P3-111 S4/S5、08a:180 契約煌臨と同型）。カード固有の DSL
      // steps は不要（engine 側の一般規則としてすでに表現済み）。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [0],
      },
      // 【リンクエイド】フラッシュ GE スピリットから1コストでスピリット状態化
      // (linkAidData で engine 汎用規則としてすでに表現済み。カード固有 DSL steps 不要)。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [2, 3],
      },
      // 【バレットエディット】ゲーム中に1回、手札1枚を下に置きデッキ1ドロー (P3-116
      // SSOT是正: 専用 LegalAction kind + 専用 executor を廃止し、place_star_garment と
      // 同型の DSL Action (bullet_edit) + use_field_card_effect 汎用経路へ移行)。
      // ドローは「そうしたとき」= 直前 step 成否ゲート (ref_succeeded) で表現する。
      {
        applicability: { zone: ["field", "soul_state"] },
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "game" },
        steps: [
          {
            id: "bullet-edit-place",
            action: {
              kind: "bullet_edit",
              target: {
                kind: "filter",
                zone: "hand",
                player: "self",
                filter: {},
                count: 1,
              },
            },
          },
          {
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "bullet-edit-place",
            },
            action: { kind: "draw", player: "self", count: 1 },
          },
        ],
        textRef: [5, 6],
      },
      // 「下のカードは、フラッシュタイミングで手札1枚と入れ替えられ」(P3-111 S11、
      // swap_star_garment と同型の DSL Action。使用制限/ドローは無い独立操作)。
      {
        timing: { kind: "activated", mode: "flash" },
        activationLabel: "none",
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "swap_bullet_edit",
              target: {
                kind: "filter",
                zone: "hand",
                player: "self",
                filter: {},
                count: 1,
              },
            },
            prompt: {
              sourceText:
                "下のカードは、フラッシュタイミングで手札1枚と入れ替えられ、フィールドを離れるとき、破棄する。",
            },
          },
        ],
        textRef: [6],
      },
    ],
  },
  {
    cardNo: "BSGE01-CX02",
    orikaId: 290,
    orikaIndex: 300,
    name: "霊代 アキ",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 2,
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
      {
        level: 3,
        requiredCores: 4,
        bp: 9000,
      },
    ],
    symbolColors: ["green"],
    textLines: [
      "魂状態のこのカードには【契約合体】できる。このとき、このカードに自分のフィールド/リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "【リンクエイド】フラッシュ『お互いのアタックステップ』",
      "魂状態のこのカードは、系統：「GE」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "【魂状態】/【スピリット】Lv1-Lv2-Lv3【バレットエディット】",
      "ゲーム中に1回、手札1枚をこのカード/スピリットの下に置ける。そうしたとき、デッキの上から1枚ドローする。（下のカードは、フラッシュタイミングで手札1枚と入れ替えられ、フィールドを離れるとき、破棄する。）",
    ],
    keywordTags: ["soul_state", "contract"],
    tribe: "神喰・GE・2G",
    image: "images/BSGE01-CX02.webp",
    rarity: "CX",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【リンクエイド】(P3-111 S6): BSGE01-CX01 と同型。engine 汎用規則
    // getAvailableLinkAidLegalActions（10_rules/07b §リンクエイド）。
    linkAidData: {
      costSourceTribes: ["GE"],
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // 魂状態のこのカードには【契約合体】できる（BSGE01-CX01 と同型。P3-111 S4/S5。
      // engine 側の一般規則としてすでに表現済みのため DSL steps は不要）。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [0],
      },
      // 【リンクエイド】(BSGE01-CX01 と同型。linkAidData で表現済みのため DSL steps 不要)。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [2, 3],
      },
      // 【バレットエディット】(BSGE01-CX01 と同型。P3-116 SSOT是正: bullet_edit DSL Action
      // + use_field_card_effect 汎用経路)。
      {
        applicability: { zone: ["field", "soul_state"] },
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "game" },
        steps: [
          {
            id: "bullet-edit-place",
            action: {
              kind: "bullet_edit",
              target: {
                kind: "filter",
                zone: "hand",
                player: "self",
                filter: {},
                count: 1,
              },
            },
          },
          {
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "bullet-edit-place",
            },
            action: { kind: "draw", player: "self", count: 1 },
          },
        ],
        textRef: [5, 6],
      },
      // 「下のカードは、フラッシュタイミングで手札1枚と入れ替えられ」(BSGE01-CX01 と同型。
      // swap_bullet_edit DSL Action)。
      {
        timing: { kind: "activated", mode: "flash" },
        activationLabel: "none",
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "swap_bullet_edit",
              target: {
                kind: "filter",
                zone: "hand",
                player: "self",
                filter: {},
                count: 1,
              },
            },
            prompt: {
              sourceText:
                "下のカードは、フラッシュタイミングで手札1枚と入れ替えられ、フィールドを離れるとき、破棄する。",
            },
          },
        ],
        textRef: [6],
      },
    ],
  },
  {
    cardNo: "BSGE01-CX03",
    orikaId: 291,
    orikaIndex: 301,
    name: "空木 レンカ",
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
        bp: 5000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 8000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "魂状態のこのカードには【契約合体】できる。このとき、このカードに自分のフィールド/リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "【リンクエイド】フラッシュ『お互いのアタックステップ』",
      "魂状態のこのカードは、系統：「GE」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "【魂状態】/【スピリット】Lv1-Lv2-Lv3【バレットエディット】",
      "ゲーム中に1回、手札1枚をこのカード/スピリットの下に置ける。そうしたとき、デッキの上から1枚ドローする。（下のカードは、フラッシュタイミングで手札1枚と入れ替えられ、フィールドを離れるとき、破棄する。）",
    ],
    keywordTags: ["soul_state", "contract"],
    tribe: "神喰・GE・2G",
    image: "images/BSGE01-CX03.webp",
    rarity: "CX",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【リンクエイド】(P3-111 S6): BSGE01-CX01 と同型。engine 汎用規則
    // getAvailableLinkAidLegalActions（10_rules/07b §リンクエイド）。
    linkAidData: {
      costSourceTribes: ["GE"],
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // 魂状態のこのカードには【契約合体】できる（BSGE01-CX01 と同型。P3-111 S4/S5。
      // engine 側の一般規則としてすでに表現済みのため DSL steps は不要）。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [0],
      },
      // 【リンクエイド】(BSGE01-CX01 と同型。linkAidData で表現済みのため DSL steps 不要)。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [2, 3],
      },
      // 【バレットエディット】(BSGE01-CX01 と同型。P3-116 SSOT是正: bullet_edit DSL Action
      // + use_field_card_effect 汎用経路)。
      {
        applicability: { zone: ["field", "soul_state"] },
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "game" },
        steps: [
          {
            id: "bullet-edit-place",
            action: {
              kind: "bullet_edit",
              target: {
                kind: "filter",
                zone: "hand",
                player: "self",
                filter: {},
                count: 1,
              },
            },
          },
          {
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "bullet-edit-place",
            },
            action: { kind: "draw", player: "self", count: 1 },
          },
        ],
        textRef: [5, 6],
      },
      // 「下のカードは、フラッシュタイミングで手札1枚と入れ替えられ」(BSGE01-CX01 と同型。
      // swap_bullet_edit DSL Action)。
      {
        timing: { kind: "activated", mode: "flash" },
        activationLabel: "none",
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "swap_bullet_edit",
              target: {
                kind: "filter",
                zone: "hand",
                player: "self",
                filter: {},
                count: 1,
              },
            },
            prompt: {
              sourceText:
                "下のカードは、フラッシュタイミングで手札1枚と入れ替えられ、フィールドを離れるとき、破棄する。",
            },
          },
        ],
        textRef: [6],
      },
    ],
  },
  {
    cardNo: "BSGE01-CX04",
    orikaId: 292,
    orikaIndex: 302,
    name: "加賀美 リョウ",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 2,
    reductionSymbols: ["blue", "blue"],
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
      {
        level: 3,
        requiredCores: 4,
        bp: 8000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "魂状態のこのカードには【契約合体】できる。このとき、このカードに自分のフィールド/リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "【リンクエイド】フラッシュ『お互いのアタックステップ』",
      "魂状態のこのカードは、系統：「GE」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "【魂状態】/【スピリット】Lv1-Lv2-Lv3【バレットエディット】",
      "ゲーム中に1回、手札1枚をこのカード/スピリットの下に置ける。そうしたとき、デッキの上から1枚ドローする。（下のカードは、フラッシュタイミングで手札1枚と入れ替えられ、フィールドを離れるとき、破棄する。）",
    ],
    keywordTags: ["soul_state", "contract"],
    tribe: "神喰・GE・2G",
    image: "images/BSGE01-CX04.webp",
    rarity: "CX",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【リンクエイド】(P3-111 S6): BSGE01-CX01 と同型。engine 汎用規則
    // getAvailableLinkAidLegalActions（10_rules/07b §リンクエイド）。
    linkAidData: {
      costSourceTribes: ["GE"],
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // 魂状態のこのカードには【契約合体】できる（BSGE01-CX01 と同型。P3-111 S4/S5。
      // engine 側の一般規則としてすでに表現済みのため DSL steps は不要）。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [0],
      },
      // 【リンクエイド】(BSGE01-CX01 と同型。linkAidData で表現済みのため DSL steps 不要)。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [2, 3],
      },
      // 【バレットエディット】(BSGE01-CX01 と同型。P3-116 SSOT是正: bullet_edit DSL Action
      // + use_field_card_effect 汎用経路)。
      {
        applicability: { zone: ["field", "soul_state"] },
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "game" },
        steps: [
          {
            id: "bullet-edit-place",
            action: {
              kind: "bullet_edit",
              target: {
                kind: "filter",
                zone: "hand",
                player: "self",
                filter: {},
                count: 1,
              },
            },
          },
          {
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "bullet-edit-place",
            },
            action: { kind: "draw", player: "self", count: 1 },
          },
        ],
        textRef: [5, 6],
      },
      // 「下のカードは、フラッシュタイミングで手札1枚と入れ替えられ」(BSGE01-CX01 と同型。
      // swap_bullet_edit DSL Action)。
      {
        timing: { kind: "activated", mode: "flash" },
        activationLabel: "none",
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "swap_bullet_edit",
              target: {
                kind: "filter",
                zone: "hand",
                player: "self",
                filter: {},
                count: 1,
              },
            },
            prompt: {
              sourceText:
                "下のカードは、フラッシュタイミングで手札1枚と入れ替えられ、フィールドを離れるとき、破棄する。",
            },
          },
        ],
        textRef: [6],
      },
    ],
  },
  {
    cardNo: "BSGE01-M01",
    orikaId: 293,
    orikaIndex: 303,
    name: "ヨハネス・フォン・シックザール",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 9,
    reductionSymbols: ["red", "red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 9000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 18000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "トラッシュにあるこのカードは、フラッシュタイミングで自分のカウント-1することで手札に戻る。",
      "",
      "【バースト：相手の『このスピリット/ネクサスの召喚/配置時』発揮後】",
      "相手のスピリット/ネクサス1つを破壊する。この効果で破壊したとき、自分はデッキの上から2枚ドローする。",
      "",
      "【神楽：スラスタ―】（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
      // 「神種 ユウ」は「神薙 ユウ」(BSGE01-CX01 の実際の name。同ファイル内 line 18/875/
      // 881/897/3089 等すべて「神薙」表記) の誤記と判断し訂正 (種/薙 は字形が近い OCR 起因
      // の入力ミス)。
      "このスピリットが「神薙 ユウ」/「霊代 アキ」のとき、自分のアタックステップのフラッシュタイミングで、自分のカウント-2することで、相手の創界神ネクサス1つを破壊する。",
    ],
    keywordTags: ["burst"],
    tribe: "神喰",
    image: "images/BSGE01-M01.webp",
    rarity: "M",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // トラッシュのこのカードは、フラッシュタイミングでカウント-1することで手札に戻る
      // (engine-trash-zone-flash-activated-recovery: 手札起動効果パイプライン
      // generateHandActivatedEffectRegistrations / getAvailableHandActivatedEffectLegalActions
      // の zone gate を hand 単一値から HAND_ACTIVATED_EFFECT_ZONES(hand/trash) へ一般化して対応。
      // move_self(zone非依存) + count_decrease conditional_cost は既存 primitive の組み合わせ)。
      {
        executionMode: "optional",
        applicability: { zone: ["trash"] },
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 1 } },
          {
            action: { kind: "move_self", destination: "hand" },
            connector: "conditional_cost",
          },
        ],
        textRef: [0],
      },
      // 【バースト：相手の召喚/配置時発揮後】相手スピ/ネクサス1つ破壊→ドロー2。
      {
        timing: {
          kind: "burst",
          trigger: {
            kind: "effect_activated",
            player: "opponent",
            activatedTimings: ["summon", "place"],
          },
        },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [{ category: ["spirit"] }, { category: ["nexus"] }],
                },
                count: 1,
              },
            },
          },
          {
            action: { kind: "draw", count: 2 },
            connector: "conditional_result",
          },
        ],
        textRef: [2, 3],
      },
      // 【神楽：スラスター】(P3-111): バレットエディットでスピリットの下にあるとき、
      // host が「神薙 ユウ」/「霊代 アキ」なら、自分のアタックステップのフラッシュ
      // タイミングでカウント-2することで相手の創界神ネクサス1つを破壊できる。
      // requiredSourceRole:"text_role_under" は generateFieldCardEffectRegistrations の
      // inferRequiredTextRoleUnderSourceRole が textRef のヘッダー行から自動推論
      // (roleTag 不問、雷鎚：ショット等と同型)。host 名条件は新規 ConditionClause
      // self_name（sourceInstanceId=host のカード自身の名前を見る、field_has とは別物）
      // で表現し、legal-actions-availability.ts の text_role under 起動効果ゲート
      // (evaluateCondition(..., sourceCard.instanceId=host, ...)) で判定される。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "self", period: "attack" },
        condition: [
          {
            kind: "self_name",
            names: [{ contains: "神薙 ユウ" }, { contains: "霊代 アキ" }],
          },
        ],
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 2 } },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                },
                count: 1,
              },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSGE01-M02",
    orikaId: 294,
    orikaIndex: 304,
    name: "ペイラー・榊",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 7,
    reductionSymbols: ["blue", "blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 7000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 8000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 16000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "トラッシュにあるこのカードは、フラッシュタイミングで自分のカウント-1することで手札に戻る。",
      "",
      "【バースト：相手の『このスピリット/アルティメットの召喚時』発揮後】",
      "コスト4以下の相手のスピリット3体を破壊し、破壊したとき、ボイドからコア2個を自分のリザーブに置く。",
      "",
      "【荒天：スプレッド】（自分の【バレットエディット】でスピリットの下にあるカードは以下の効果を発揮する。）",
      "このスピリットが「空木 レンカ」/「加賀美 リョウ」のとき、このスピリットがアタックしたとき、自分のカウントを好きなだけ減らせる。そうしたとき、このターンの間、減らしたカウント1につき、相手の手札/手元のカードのコストを+1する。",
    ],
    keywordTags: ["burst"],
    tribe: "神喰",
    image: "images/BSGE01-M02.webp",
    rarity: "M",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // engine-trash-zone-flash-activated-recovery（BSGE01-M01 参照）。
      {
        executionMode: "optional",
        applicability: { zone: ["trash"] },
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 1 } },
          {
            action: { kind: "move_self", destination: "hand" },
            connector: "conditional_cost",
          },
        ],
        textRef: [0],
      },
      // 【バースト：相手の召喚時発揮後】コスト4以下相手スピリット3体破壊→ボイド2→リザーブ。
      {
        timing: {
          kind: "burst",
          trigger: {
            kind: "effect_activated",
            player: "opponent",
            activatedTimings: ["summon"],
          },
        },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], maxCost: 4 },
                count: 3,
              },
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
            connector: "conditional_result",
          },
        ],
        textRef: [2, 3],
      },
      // 【荒天：スプレッド】(P3-111、ENGINE-cost-modify-additional-cost-value-dynamic-amount
      // Step3): バレットエディット下にあり host が「空木 レンカ」/「加賀美 リョウ」のとき、
      // このスピリットがアタックしたとき自分のカウントを好きなだけ減らせる（effect-level
      // optional + count_decrease amount:{min:0}、pendingCountSelection で 0〜countValue を選択）。
      // 減らした量が0なら
      // 「そうしたとき」ゲート (connector: conditional_result) で後続がスキップされ、1以上なら
      // その量を stepId 参照 (step_numeric_amount) して相手の手札/手元 (zone:["hand","set_aside"])
      // のコストをこのターン+その量する。requiredSourceRole:"text_role_under" は M01 神楽：
      // スラスターと同じ自動推論経路 (textRef にヘッダー行[5]を含むため)。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [
          {
            kind: "self_name",
            names: [{ contains: "空木 レンカ" }, { contains: "加賀美 リョウ" }],
          },
        ],
        executionMode: "optional",
        steps: [
          {
            id: "cd",
            action: {
              kind: "count_decrease",
              player: "self",
              amount: { min: 0 },
            },
          },
          {
            action: {
              kind: "cost_modify",
              player: "opponent",
              cardFilter: { zone: ["hand", "set_aside"] },
              modifier: {
                additionalCostValue: {
                  source: { kind: "step_numeric_amount", stepId: "cd" },
                },
              },
              duration: { scope: "turn" },
            },
            connector: "conditional_result",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSGE01-M03",
    orikaId: 295,
    orikaIndex: 305,
    name: "雨宮 ツバキ",
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
      "トラッシュにあるこのカードは、フラッシュタイミングで自分のカウント-1することで手札に戻る。",
      "",
      "セットしているこのカードは、自分のスピリットがアタックしたときに発動できる。",
      "",
      "【バースト：自分のライフ減少後】",
      "相手のスピリット/アルティメット1体のコアすべてをリザーブに置く、さらに、トラッシュの赤/紫のブレイヴカード/ネクサスカード1枚を手札に戻せる。",
      "",
      "【奇霊：ショット】（自分の【バレットエディット】でスピリットの下にあるカードは以下の効果を発揮する。）",
      "〔ターンに1回：同名〕自分のターン中、フラッシュタイミングで、自分のカウント-2することで、相手の創界神ネクサスすべてのコアすべてをボイドに置く。",
    ],
    keywordTags: ["burst"],
    tribe: "神喰",
    image: "images/BSGE01-M03.webp",
    rarity: "M",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // engine-trash-zone-flash-activated-recovery（BSGE01-M01 参照）。
      {
        executionMode: "optional",
        applicability: { zone: ["trash"] },
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 1 } },
          {
            action: { kind: "move_self", destination: "hand" },
            connector: "conditional_cost",
          },
        ],
        textRef: [0],
      },
      // [1] セットしているこのカードは、自分のスピリットがアタックしたときに発動できる。
      // 裁定 2026-07-23 (needs-ruling.jsonl BSGE01-M03/M04, resolved): ミラージュ機構では
      // なく、下記【バースト】効果本体 (effects[2]) への追加発動条件。通常条件
      // (自分のライフ減少後) を待たず、自分の「スピリット」のアタック時にも発動宣言できる
      // (アルティメットのアタックは対象外、triggerFilter.category:["spirit"] で絞る。
      // adversarial verifier 2026-07-23 round1 指摘)。
      // BurstTrigger.own_attack + maybeQueueOwnAttackBurstCheck (attack-burst-flow.ts) で
      // 攻撃側向け pendingBurstCheck を積み、steps は effects[2] と共有 (BSGE01_M03_BURST_STEPS)。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "own_attack", player: "self" },
          triggerFilter: { category: ["spirit"] },
        },
        steps: BSGE01_M03_BURST_STEPS,
        textRef: [2],
      },
      // 【バースト：自分のライフ減少後】相手1体のコア全部リザーブ＋トラッシュの赤/紫ブレイヴ/ネクサスを手札。
      // 単一対象コアシュート: 相手スピリット/アルティメット**1体**を選び、その対象のコアをすべてリザーブへ
      //   (memory project_single_target_coreshoot)。BSGE01-M01[1] burst destroy と同 shape。
      //   wiring: burst registration の target metadata 伝搬は engine 拡張
      //   ENGINE-burst-target-metadata-propagation (audit-bsge01-followup) で別 park。
      // 「さらに、…手札に戻せる」は「戻さない」noop default と「戻す」move_card choice で表現する。
      // steps は effects[1] (own_attack 追加発動条件) と共有 (BSGE01_M03_BURST_STEPS)。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "life_decrease", player: "self" },
        },
        steps: BSGE01_M03_BURST_STEPS,
        textRef: [4, 5],
      },
      // 【奇霊：ショット】(P3-111): バレットエディットでスピリットの下にあるとき、
      // 自分のターン中フラッシュタイミングで〔ターンに1回：同名〕カウント-2することで、
      // 相手の創界神ネクサスすべてのコアすべてをボイドに置く（対象選択なしの一括ドレイン、
      // BSTH01-C?? 型の core_move field_card + amount:'all' と同型）。requiredSourceRole
      // は M01 神楽：スラスターと同じ自動推論経路。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "self", period: "turn" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 2 } },
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
            connector: "conditional_cost",
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSGE01-M04",
    orikaId: 296,
    orikaIndex: 306,
    name: "竹田 ヒバリ",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "green"],
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
      "トラッシュにあるこのカードは、フラッシュタイミングで自分のカウント-1することで手札に戻る。",
      "セットしているこのカードは、自分のスピリットがアタックしたときに発動できる。",
      "",
      "【バースト：フィールドを離れた自分のスピリットが魂状態になった後】",
      "相手のスピリット/アルティメット1体を重疲労させる。さらに、自分のデッキを上から5枚オープンする。その中のミラージュ効果を持つ緑/青のカードをコストを支払わずにセットし、緑/青のブレイヴカード1枚を手札に加える。残ったカードはデッキの下に戻す。",
      "",
      "【奇霊：ショット】（自分の【バレットエディット】でスピリットの下にあるカードは以下の効果を発揮する。）",
      "〔ターンに1回：同名〕自分のターン中、フラッシュタイミングで自分のカウント-2することで、相手の創界神ネクサスすべてのコアすべてをボイドに置く。",
    ],
    keywordTags: ["burst", "soul_state"],
    tribe: "神喰",
    image: "images/BSGE01-M04.webp",
    rarity: "M",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // engine-trash-zone-flash-activated-recovery（BSGE01-M01 参照）。
      {
        executionMode: "optional",
        applicability: { zone: ["trash"] },
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 1 } },
          {
            action: { kind: "move_self", destination: "hand" },
            connector: "conditional_cost",
          },
        ],
        textRef: [0],
      },
      // [1] セットしているこのカードは、自分のスピリットがアタックしたときに発動できる。
      // 裁定 2026-07-23 (needs-ruling.jsonl BSGE01-M03/M04, resolved): ミラージュ機構では
      // なく、直後の【バースト】効果本体 (effects[2]) への追加発動条件。BSGE01-M03 effects[1]
      // と同型。「自分の**スピリット**」限定(アルティメット対象外、triggerFilter で絞る。
      // adversarial verifier 2026-07-23 round1 指摘)。steps は effects[2] と共有
      // (BSGE01_M04_BURST_STEPS)。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "own_attack", player: "self" },
          triggerFilter: { category: ["spirit"] },
        },
        steps: BSGE01_M04_BURST_STEPS,
        textRef: [1],
      },
      // 【バースト：フィールドを離れた自分のスピリットが魂状態になった後】相手1体重疲労＋
      // デッキ5オープン→ミラージュ緑/青コストなしセット＋緑/青ブレイヴ1枚手札、残りデッキ下。
      // トリガーは既存 card_event enter_soul_state (F2, ENIGMA「魂状態になったとき」) と同じ
      // diff-detection を burst 経路に流用した BurstTrigger.enter_soul_state（新設、
      // 10_rules/04b_burst-rules.md §セット中バーストの追加発動条件）。「フィールドを離れた」
      // (field-exit-replacement 経由、zone は "field" のまま不変) 限定であり、BSLH01-CX01型の
      // 手札/手元からの直接魂状態化 (zone が hand/set_aside→field へ変わる) は対象外
      // (CollectedTriggerEvent.fromZone==="field" ゲート、adversarial verifier 2026-07-23
      // round1 指摘で追加)。「自分の**スピリット**」限定も同様に triggerFilter で絞る。
      // relatedInstanceId (対象カード) はチェック評価時点で既に魂状態化済みのため、
      // triggerFilter.soulState:"include" が必須 (matchesCardFilter は既定で魂状態カードを
      // 除外する、card-filter.ts:264-270)。省略すると常に不一致になり発動条件が死ぬ
      // (own-attack-burst-trigger 系との違い: あちらの対象は魂状態化していないため不要)。
      // ミラージュ無償セットは DeckRevealPick.destination:"mirage_set"（新設、
      // mirage-system.ts applyFreeMirageSetBookkeeping）で表現。複数該当時は pick count:1 で
      // 1枚のみセットする。既存の免除個体は常に0枠とし、効果解決中に
      // 追加または既存1枚との合法な個別交換を選ぶ（2026-10-24ユーザー訂正）。
      // steps は effects[1] (own_attack 追加発動条件) と共有 (BSGE01_M04_BURST_STEPS)。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "enter_soul_state", player: "self" },
          triggerFilter: { category: ["spirit"], soulState: "include" },
        },
        steps: BSGE01_M04_BURST_STEPS,
        textRef: [3, 4],
      },
      // 【奇霊：ショット】(P3-111、BSGE01-M03 と同型テキスト)。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "self", period: "turn" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 2 } },
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
            connector: "conditional_cost",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSGE01-R01",
    orikaId: 297,
    orikaIndex: 307,
    name: "アリサ・イリーニチナ・アミエーラ",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
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
        bp: 5000,
      },
      {
        level: 3,
        requiredCores: 3,
        bp: 7000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "相手によってフィールドを離れたこのスピリットは魂状態にできる。",
      "",
      "【リンクエイド】フラッシュ『お互いのアタックステップ』",
      "魂状態のこのカードは、系統：「GE」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回：同名〕手札にあるこのカードは、1コスト支払って召喚できる。そうしたとき、ボイドからコア1個をこのスピリットに置き、自分はデッキの上から1枚ドローする。",
      "",
      "【火炎：Hレーザー】（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
      "このスピリットをBP+7000する。",
    ],
    keywordTags: ["soul_state"],
    tribe: "神喰・GE・2G",
    image: "images/BSGE01-R01.webp",
    rarity: "R",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【リンクエイド】(P3-111 S6): engine 汎用規則 getAvailableLinkAidLegalActions
    // (10_rules/07b §リンクエイド)。
    linkAidData: {
      costSourceTribes: ["GE"],
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // [0] 相手によってフィールドを離れたこのスピリットは魂状態にできる（GE 魂状態化）。
      //   FieldExitReplacement の soul_state 変種 (08a L158-159)。離脱を魂状態化選択に置換。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent_effect",
              duration: { scope: "while_on_field" },
              replacement: { kind: "soul_state" },
            },
          },
        ],
        textRef: [0],
      },
      // 【リンクエイド】(linkAidData で表現済みのため DSL steps 不要)。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [2, 3],
      },
      // フラッシュ〔ターン1回:同名〕手札のこのカードを1コスト召喚→コア1置き＋ドロー1。
      {
        applicability: { zone: "hand" },
        timing: { kind: "activated", mode: "flash" },
        activationLabel: "flash",
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        executionMode: "optional",
        steps: [
          {
            id: "r01-self-summon",
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: { fixedPayment: 1 },
            },
          },
          {
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "r01-self-summon",
            },
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
          },
          {
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "r01-self-summon",
            },
            action: { kind: "draw", count: 1 },
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
      // 【火炎：Hレーザー】(P3-111): バレットエディットでスピリットの下にあるとき、
      // host を BP+7000。text_role アンダーカード継続効果集約
      // (continuous-effect-rebuild.ts の textRoleUnderEffectEntries、神威：ノーマルと同型) で表現。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: { kind: "self" },
              amount: 7000,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSGE01-R02",
    orikaId: 298,
    orikaIndex: 308,
    name: "雨宮 リンドウ",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 2,
    reductionSymbols: ["purple", "red"],
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
      {
        level: 3,
        requiredCores: 4,
        bp: 9000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "相手によってフィールドを離れたこのスピリットは魂状態にできる。",
      "",
      "【リンクエイド】フラッシュ『お互いのアタックステップ』",
      "魂状態のこのカードは、系統：「GE」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、自分はカウント+1し、デッキの上から1枚ドローできる。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
      "",
      "【毒牙：モルター】（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
      "このスピリットが効果を発揮するとき、自分のカウント-1することで、それによってフィールドを離れるスピリット/アルティメット/ネクサスの効果は発揮されない。",
    ],
    keywordTags: ["soul_state"],
    tribe: "神喰・GE・1G",
    image: "images/BSGE01-R02.webp",
    rarity: "R",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【リンクエイド】(P3-111 S6): engine 汎用規則 getAvailableLinkAidLegalActions
    // (10_rules/07b §リンクエイド)。
    linkAidData: {
      costSourceTribes: ["GE"],
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // [0] 相手によってフィールドを離れたこのスピリットは魂状態にできる（GE 魂状態化、08a L158-159）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent_effect",
              duration: { scope: "while_on_field" },
              replacement: { kind: "soul_state" },
            },
          },
        ],
        textRef: [0],
      },
      // 【リンクエイド】(linkAidData で表現済みのため DSL steps 不要)。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [2, 3],
      },
      // Lv1-3『召喚/アタック時』ターン1回、カウント+1＋デッキ1ドロー。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "mandatory",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
              protectedFromNonTribe: "神喰",
            },
          },
          {
            executionMode: "optional",
            action: { kind: "draw", count: 1 },
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
      // 【毒牙：モルター】(engine-generic-effect-activation-causal-trigger cluster):
      // このスピリットが効果を発揮するとき、自分のカウント-1することで、それによって
      // フィールドを離れるスピリット/アルティメット/ネクサスの効果は発揮されない。
      // grant_paid_leave_suppression_immunity CE は host (このカード) に権利を付与し、
      // stack 窓後・対象選択前の pendingStepChoice で対価支払いを選ぶ。
      // アンダーカード (バレットエディット) 判定自体は未対応のため、常時発揮可能な
      // 権利として表現する (R04 呪縛：モルター同型)。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "grant_paid_leave_suppression_immunity",
              target: { kind: "self" },
              cost: { resource: "count", amount: 1 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSGE01-R03",
    orikaId: 299,
    orikaIndex: 309,
    name: "橘 サクヤ",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 2,
    reductionSymbols: ["green", "blue"],
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
      "相手によってフィールドを離れたこのスピリットは魂状態にできる。",
      "",
      "【リンクエイド：フラッシュ『お互いのアタックステップ』】",
      "魂状態のこのカードは、系統：「GE」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、自分のカウント+1し、ボイドからコア1個をこのスピリットに置ける。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
      "",
      "【雷鎚：ショット】（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
      "このスピリットがアタックしたとき、自分のカウント-2することで、相手のライフのコア1個をトラッシュに置く。",
    ],
    keywordTags: ["soul_state"],
    tribe: "神喰・GE・1G",
    image: "images/BSGE01-R03.webp",
    rarity: "R",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【リンクエイド】(P3-111 S6): engine 汎用規則 getAvailableLinkAidLegalActions
    // (10_rules/07b §リンクエイド)。
    linkAidData: {
      costSourceTribes: ["GE"],
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // [0] 相手によってフィールドを離れたこのスピリットは魂状態にできる（GE 魂状態化、08a L158-159）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent_effect",
              duration: { scope: "while_on_field" },
              replacement: { kind: "soul_state" },
            },
          },
        ],
        textRef: [0],
      },
      // 【リンクエイド】(linkAidData で表現済みのため DSL steps 不要)。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [2, 3],
      },
      // Lv1-3『召喚/アタック時』ターン1回、カウント+1＋ボイドからコア1個をこのスピリットに置く。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "mandatory",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
              protectedFromNonTribe: "神喰",
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
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
      // 【雷鎚：ショット】(P3-111): バレットエディットでスピリットの下にあるとき、
      // host がアタックしたとき、自分のカウント-2することで、相手のライフのコア1個を
      // トラッシュに置く。card_event:"attack" は battle-immediate 系専用
      // (structured-effect-registrations.ts の CARD_EVENT_TO_BATTLE_IMMEDIATE、cardEvent
      // フラグなし) のため、requiredSourceRole の解決は
      // battle-immediate-effect-system.ts 側 (queueRegisteredBattleImmediateEffects /
      // isActiveTextRoleUnderEffectSource、roleTag 不問化済み) を経由する。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        steps: [
          { action: { kind: "count_decrease", player: "self", amount: 2 } },
          {
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "trash", player: "opponent" },
              amount: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSGE01-R04",
    orikaId: 300,
    orikaIndex: 310,
    name: "ソーマ・シックザール",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 2,
    reductionSymbols: ["blue", "green"],
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
    symbolColors: ["blue"],
    textLines: [
      "相手によってフィールドを離れたこのスピリットは魂状態にできる。",
      "",
      "【リンクエイド】フラッシュ『お互いのアタックステップ』",
      "魂状態のこのカードは、系統：「GE」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、自分のカウント+1し、ボイドからコア1個をこのスピリットに置ける。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
      "",
      "【呪縛：モルター】（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
      "このスピリットが効果を発揮するとき、自分のカウント-1することで、その効果は相手の効果で防げない。",
    ],
    keywordTags: ["soul_state"],
    tribe: "神喰・GE・1G",
    image: "images/BSGE01-R04.webp",
    rarity: "R",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【リンクエイド】(P3-111 S6): engine 汎用規則 getAvailableLinkAidLegalActions
    // (10_rules/07b §リンクエイド)。
    linkAidData: {
      costSourceTribes: ["GE"],
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // [0] 相手によってフィールドを離れたこのスピリットは魂状態にできる（GE 魂状態化、08a L158-159）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent_effect",
              duration: { scope: "while_on_field" },
              replacement: { kind: "soul_state" },
            },
          },
        ],
        textRef: [0],
      },
      // 【リンクエイド】(linkAidData で表現済みのため DSL steps 不要)。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [2, 3],
      },
      // Lv1-3『召喚/アタック時』ターン1回、カウント+1＋ボイドからコア1個をこのスピリットに置く。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "mandatory",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
              protectedFromNonTribe: "神喰",
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
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
      // 【呪縛：モルター】(P3-111 S5 継続, ENGINE-bsge01-r04-paid-prevention-immunity):
      // このスピリットが効果を発揮するとき、自分のカウント-1することで、その効果は
      // 相手の効果で防げない。grant_paid_prevention_immunity CE は host (このカード) に
      // 権利を付与し、stack 窓後・対象選択前の pendingStepChoice で対価支払いを選ぶ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "grant_paid_prevention_immunity",
              target: { kind: "self" },
              cost: { resource: "count", amount: 1 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSGE01-R05",
    orikaId: 301,
    orikaIndex: 311,
    name: "藤木 コウタ",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: ["yellow", "red", "purple"],
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
      {
        level: 3,
        requiredCores: 3,
        bp: 6000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "このスピリットは、赤としても扱い、相手によってフィールドを離れたとき、魂状態にできる。",
      "",
      "【リンクエイド】フラッシュ『お互いのアタックステップ』",
      "魂状態のこのカードは、系統：「GE」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、自分はカウント+1し、デッキの下から1枚ドローできる。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
      "",
      "【神威：ノーマル】（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
      "このスピリットに黄のシンボル1つを追加する。",
    ],
    keywordTags: ["soul_state"],
    tribe: "神喰・GE・1G",
    image: "images/BSGE01-R05.webp",
    rarity: "R",
    pack: "BSGE01 ゴッドイーター",
    sourceUrls: [],
    sourceConfidence: "C",
    // 【リンクエイド】(P3-111 S6): engine 汎用規則 getAvailableLinkAidLegalActions
    // (10_rules/07b §リンクエイド)。
    linkAidData: {
      costSourceTribes: ["GE"],
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // このスピリットは、赤としても扱い、相手による離脱で魂状態化できる（08a L158-159）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["color"],
              asColor: "red",
            },
          },
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent_effect",
              duration: { scope: "while_on_field" },
              replacement: { kind: "soul_state" },
            },
          },
        ],
        textRef: [0],
      },
      // 【リンクエイド】(linkAidData で表現済みのため DSL steps 不要)。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [2, 3],
      },
      // Lv1-3『召喚/アタック時』ターン1回、カウント+1＋ドロー1。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "mandatory",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
              protectedFromNonTribe: "神喰",
            },
          },
          {
            // 「デッキの下から1枚ドローできる」。position:"bottom" で末尾から引く。
            executionMode: "optional",
            action: { kind: "draw", count: 1, position: "bottom" },
            connector: "simultaneous",
          },
        ],
        textRef: [5, 6],
      },
      // 【神威：ノーマル】(P3-111): バレットエディットでスピリットの下にあるとき、
      // host に黄シンボル1つ追加。text_role アンダーカード継続効果集約
      // (continuous-effect-rebuild.ts の textRoleUnderEffectEntries、星霊衣と同型) で表現。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "yellow",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSGE01-TR01(A)",
    orikaId: 302,
    orikaIndex: 312,
    name: "第二世代神機 アヴェンジャー",
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 6000,
      },
    ],
    combinedBoost: 7000,
    symbolColors: ["red"],
    textLines: [
      "フラッシュ【契約合体：GE＆系統名に「O」/「1」を含まない『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から合体する。（合体していたブレイヴは破棄する。）",
      "",
      "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された/スピリット状態になった自分のスピリットに合体できる。合体しているこのブレイヴは、フラッシュタイミングで裏返せる。",
      "",
      "【合体条件：GE＆系統名に「O」/「1」を含まない】",
      "【合体中】『このブレイヴ/スピリットの契約合体/アタック時』",
      "自分のカウント+2する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。その後、このブレイヴをただちに裏返せる。",
    ],
    keywordTags: ["double_sided"],
    tribe: "神喰・神機・2G",
    image: "images/BSGE01-TR01(A).webp",
    rarity: "TR",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 合体条件キーワード ([5]) は契約合体ヘッダー ([0]) と同一条件 (ともに GE＆「O」/「1」
    // 非含有)。BSGE01-C05〜C08 と同じく top-level braveCondition (10_rules/05:30 継続分離
    // チェック用) と contractCombineData.braveCondition (契約合体アクション対象ゲート用) を
    // 並存配線する (P3-111 S5、TR01(A) は亜種1と同型のタイミングスコープ違い)。
    braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O", "1"] },
    contractCombineData: {
      braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O", "1"] },
      timingScope: { player: "both", period: "attack" },
    },
    effects: [
      // スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず（BSGE01-C05 と
      // 同型: continuous + applicability.combined:false + effect_resistance(exhaust) +
      // prevent_battle、ruleStrength:true。「合体できる」は末尾の game_event 効果で
      // そのイベント主語に固定する。
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
        textRef: [3],
      },
      // 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」(P3-111 S5)。
      // B面に「この面に裏返ったとき...カウント+1する」定型文が無いため、
      // 10_rules/08a §2 の射程確定 (2026-07-30) に従い、裏返し自体では count を増やさない。
      // 通常の転醒トリガー (count 条件による自動判定) とは異なり、本カードは合体状態を
      // 条件に、任意のフラッシュタイミングで能動的に転醒を宣言できる (=activated ability)。
      // generateFieldCardEffectRegistrations が timing:{kind:"activated",mode:"flash"}
      // を持つ field カードの効果を汎用的に legal action 化するため、専用の
      // CardDefinition フィールド/legal action は不要 (applicability.combined:true で
      // 合体中のみ有効化)。
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { combined: true },
        steps: [{ action: { kind: "rebirth", countBonusMode: "none" } }],
        textRef: [3],
      },
      // 【合体中】『契約合体/アタック時』カウント+2、その後ただちに裏返せる。
      // P3-111 S3: 「契約合体時」と「アタック時」は別 effect に分離する
      // (BSGE01-C06/C08 と同型)。brave_combined 側だけ cause:["contract_combine"]
      // で契約合体由来の合体成立に限定する。
      {
        timing: {
          kind: "card_event",
          event: "brave_combined",
          cause: ["contract_combine"],
        },
        condition: [{ kind: "combined" }],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
              protectedFromNonTribe: "神喰",
            },
          },
          {
            action: { kind: "rebirth", countBonusMode: "none" },
            executionMode: "optional",
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
      // 【合体中】『契約合体/アタック時』の attack 側。
      // 「その後、ただちに裏返せる」は既存 rebirth action を step 単位 optional
      // (ENGINE-step-optional-target-step-pending-selection 系の pendingStepOptionalChoice
      // 汎用機構、BSGE01-C06 effects[1] の send_to_deck optional step と同型) で表現する。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
              protectedFromNonTribe: "神喰",
            },
          },
          {
            action: { kind: "rebirth", countBonusMode: "none" },
            executionMode: "optional",
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
      BSGE01_SPIRIT_STATE_EVENT_BRAVE_COMBINE_EFFECT,
    ],
    isDoubleSided: true,
    backFace: {
      name: "第二世代神機 レイジングロア",
      printedCategory: "brave",
      colors: ["red"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 6000,
        },
      ],
      symbolColors: ["red"],
      textLines: [
        "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、ただちに裏返す。合体しているこのブレイヴは、フラッシュタイミングで裏返せる。",
        "",
        "【合体条件：GE＆系統名に「O」/「1」を含まない】",
        "【合体中】『このスピリット/ブレイヴの転醒/アタック時』",
        "ターンに1回、自分のカウント-2することで、本来のBPが15000以下の相手のスピリット/アルティメット2体までを破壊する。",
      ],
      keywordTags: [],
      tribe: "神喰・神機・2G",
      image: "images/BSGE01-TR01(B).webp",
      rarity: "TR",
      pack: "BSGE01 ゴッドイーター",
      cardNo: "BSGE01-TR01(B)",
      combinedBoost: 7000,
      // 【合体条件：GE＆「O」/「1」非含有】([2]) は (A) 面 braveCondition と同一条件
      // (P3-111 残り、backFace.braveCondition は state-based-actions.ts の合体分離継続
      // チェックが (A)/(B) 面共通で参照する)。
      braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O", "1"] },
      // textLines[0]「ただちに裏返す」: 分離してスピリット状態単独になった瞬間に SBA で
      // 自動的に A 面へ裏返る (P3-111 残り、cluster bsge01-backface-auto-revert-on-separation)。
      revertToFrontOnSeparation: true,
      effects: [
        // B面先頭ヘッダー「疲労せず、アタック/ブロックできず」はルール強度。
        // 「ただちに裏返す」は revertToFrontOnSeparation の SBA で扱う。
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
          textRef: [0],
        },
        // 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」。(A) 面は rebirth
        // ((A)→(B))、(B) 面は reverse_rebirth mode:"flip" ((B)→(A)、既存テスト済プリミティブ
        // reverse-rebirth.test.ts 参照。cluster bsge01-backface-header-line-audit)。
        {
          timing: { kind: "activated", mode: "flash" },
          applicability: { combined: true },
          steps: [{ action: { kind: "reverse_rebirth", mode: "flip" } }],
          textRef: [0],
        },
        // 【合体中】『このスピリット/ブレイヴの転醒/アタック時』ターンに1回、自分のカウント-2
        // することで、本来のBPが15000以下の相手のスピリット/アルティメット2体までを破壊する。
        // (P3-111 残り、backFace.effects 初着地)。フラッシュ表記なしのため R03/雷鎚：ショット
        // (S9) と同型の battle-immediate card_event (BSGE01.ts:3365-3379 参照)。
        // 「本来のBP」は bpBasis:"printed" (今回新設、costBasis:"printed" と同型) で表現し、
        // BSSG01-X04 のような実効 BP 近似を避ける。
        {
          // 2026-09-04 ユーザー裁定: 転醒の主語はブレイヴ、アタックの主語はhost。
          // 単一effectのままにして、両タイミングのターン1回制限を共有する。
          timing: {
            kind: "card_event",
            event: ["rebirth", "attack"],
            effectSourceEvents: ["rebirth"],
          },
          condition: [{ kind: "combined" }],
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
          steps: [
            { action: { kind: "count_decrease", player: "self", amount: 2 } },
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit", "ultimate"],
                    maxBp: 15000,
                    bpBasis: "printed",
                  },
                  count: { min: 0, max: 2 },
                },
              },
              connector: "conditional_cost",
            },
          ],
          textRef: [3, 4],
        },
      ],
    },
  },
  {
    cardNo: "BSGE01-TX01(A)",
    orikaId: 303,
    orikaIndex: 313,
    name: "第二世代神機 クレメンサー",
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 6000,
      },
    ],
    combinedBoost: 7000,
    symbolColors: ["red"],
    textLines: [
      "フラッシュ【契約合体：「神薙 ユウ」『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から合体する。（合体していたブレイヴは破棄する。）",
      "",
      "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された/スピリット状態になった自分のスピリットに合体できる。合体しているこのブレイヴは、フラッシュタイミングで裏返せる。",
      "",
      "『このブレイヴの召喚/契約合体時』",
      "自分は、デッキの上から2枚ドローできる。",
      "",
      "【合体条件：GE＆系統名に「O」/「1」を含まない】",
      "【合体中】『このスピリットのアタック時』",
      "自分のカウント+2する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
    ],
    keywordTags: ["double_sided"],
    tribe: "神喰・神機・2G",
    image: "images/BSGE01-TX01(A).webp",
    rarity: "TX",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【合体条件：GE＆「O」/「1」非含有】([8]) は契約合体ヘッダーのカード名指定([0]) とは
    // 別条件 (前者=通常合体/合体維持の継続チェック、後者=契約合体アクション専用ゲート)。
    // top-level braveCondition は系統条件、contractCombineData.braveCondition はカード名
    // 指定で並存させる (P3-111 S5、C05〜C08 と条件の種類が違う点に注意)。
    braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O", "1"] },
    contractCombineData: {
      braveCondition: { cardNameContains: ["神薙 ユウ"] },
      timingScope: { player: "self", period: "turn" },
    },
    effects: [
      // スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず（BSGE01-C05 と
      // 同型、ruleStrength:true）。
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
        textRef: [3],
      },
      // 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」(P3-111 S5、
      // BSGE01-TR01(A) と同型。詳細コメントは TR01(A) 参照)。
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { combined: true },
        steps: [{ action: { kind: "rebirth", countBonusMode: "none" } }],
        textRef: [3],
      },
      // 『召喚/契約合体時』デッキ2ドロー。
      // 通常召喚側は trigger 'summon'、契約合体側は登録生成時に
      // brave_combined cause:"contract_combine" へ展開する。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 2 } }],
        textRef: [5, 6],
      },
      // 【合体中】『アタック時』カウント+2。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
              protectedFromNonTribe: "神喰",
            },
          },
        ],
        textRef: [9, 10],
      },
      BSGE01_SPIRIT_STATE_EVENT_BRAVE_COMBINE_EFFECT,
    ],
    isDoubleSided: true,
    backFace: {
      name: "第二世代神機 サイレントクライ",
      printedCategory: "brave",
      colors: ["red"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 6000,
        },
      ],
      symbolColors: ["red"],
      textLines: [
        "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、ただちに裏返す。合体しているこのブレイヴは、フラッシュタイミングで裏返せる。",
        "",
        "【合体条件：GE＆系統名に「O」/「1」を含まない】",
        "【合体中】フラッシュ『このスピリットのアタック時』",
        "自分のカウント-1することで、このスピリットのBP以下の相手のスピリット/アルティメット1体か、相手のネクサス1つを破壊する。",
      ],
      keywordTags: [],
      tribe: "神喰・神機・2G",
      image: "images/BSGE01-TX01(B).webp",
      rarity: "TX",
      pack: "BSGE01 ゴッドイーター",
      cardNo: "BSGE01-TX01(B)",
      combinedBoost: 7000,
      braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O", "1"] },
      // textLines[0]「ただちに裏返す」(P3-111 残り、TR01(B) と同型)。
      revertToFrontOnSeparation: true,
      effects: [
        // B面先頭ヘッダー「疲労せず、アタック/ブロックできず」はルール強度。
        // 「ただちに裏返す」は revertToFrontOnSeparation の SBA で扱う。
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
          textRef: [0],
        },
        // 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」。(A) 面は rebirth
        // ((A)→(B))、(B) 面は reverse_rebirth mode:"flip" ((B)→(A)、既存テスト済プリミティブ
        // reverse-rebirth.test.ts 参照。cluster bsge01-backface-header-line-audit)。
        {
          timing: { kind: "activated", mode: "flash" },
          applicability: { combined: true },
          steps: [{ action: { kind: "reverse_rebirth", mode: "flip" } }],
          textRef: [0],
        },
        // 【合体中】フラッシュ『このスピリットのアタック時』自分のカウント-1することで、
        // このスピリットのBP以下の相手のスピリット/アルティメット1体か、相手のネクサス1つを
        // 破壊する。(P3-111 残り、backFace.effects 初着地)。フラッシュ表記ありのため
        // BSAZ01-CX01/BSGE01-M01【神楽：スラスター】と同型の activated(flash)+timingScope
        // (BSGE01.ts 内 M01 参照)。「このスピリットのBP以下」は maxBpSource:"self_effective_bp"
        // (BSDB01-C01 等と同型)。「1体か...1つ」= filterOr で spirit/ultimate と nexus を
        // 単一 count:1 に束ねる (BSGE01-M01 burst 効果と同型)。
        {
          executionMode: "optional",
          timing: { kind: "activated", mode: "flash" },
          timingScope: { player: "self", period: "attack" },
          applicability: { combined: true },
          // 「このスピリット」= 合体先自身のアタック中。自分のアタックステップだけでは不足。
          condition: [
            {
              kind: "self_state",
              state: "on_field",
              reference: "self",
              battleState: "attacking",
            },
          ],
          steps: [
            { action: { kind: "count_decrease", player: "self", amount: 1 } },
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    filterOr: [
                      {
                        category: ["spirit", "ultimate"],
                        maxBpSource: "self_effective_bp",
                      },
                      { category: ["nexus"] },
                    ],
                  },
                  count: 1,
                },
              },
              connector: "conditional_cost",
            },
          ],
          textRef: [3, 4],
        },
      ],
    },
  },
  {
    cardNo: "BSGE01-TX02(A)",
    orikaId: 304,
    orikaIndex: 314,
    name: "第二世代神機 ブレード極",
    printedCategory: "brave",
    colors: ["green"],
    cost: 5,
    reductionSymbols: ["green", "green"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 6000,
      },
    ],
    combinedBoost: 7000,
    symbolColors: ["green"],
    // textLines[0] のカード名は「霊代 アキ」の誤字 (BSGE01-CX02 の name/他5箇所の参照が
    // すべて「霊代」表記。P3-111 S5 で判明、契約合体対象名の実効照合には「霊代 アキ」を使う)。
    textLines: [
      "フラッシュ【契約合体：「霊代 アキ」『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から合体する。（合体していたブレイヴは破棄する。）",
      "",
      "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された/スピリット状態になった自分のスピリットに合体できる。合体しているこのブレイヴは、フラッシュタイミングで裏返せる。",
      "",
      "『このブレイヴの召喚/契約合体時』",
      "ボイドからコア2個を自分のリザーブに置ける。",
      "",
      "【合体条件：GE＆系統名に「O」/「1」を含まない】",
      "【合体中】『このスピリットのアタック時』",
      "自分のカウント+2する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
    ],
    keywordTags: ["double_sided"],
    tribe: "神喰・神機・2G",
    image: "images/BSGE01-TX02(A).webp",
    rarity: "TX",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O", "1"] },
    contractCombineData: {
      braveCondition: { cardNameContains: ["霊代 アキ"] },
      timingScope: { player: "self", period: "turn" },
    },
    effects: [
      // スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず（BSGE01-C05/TX01(A)
      // と同型、ruleStrength:true）。
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
        textRef: [3],
      },
      // 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」(P3-111 S5、
      // BSGE01-TR01(A) と同型。詳細コメントは TR01(A) 参照)。
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { combined: true },
        steps: [{ action: { kind: "rebirth", countBonusMode: "none" } }],
        textRef: [3],
      },
      // 『召喚/契約合体時』ボイドからコア2個をリザーブに置く。
      // 通常召喚側は trigger 'summon'、契約合体側は登録生成時に
      // brave_combined cause:"contract_combine" へ展開する。
      {
        timing: { kind: "card_event", event: "summon" },
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
        textRef: [5, 6],
      },
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 2,
              protectedFromNonTribe: "神喰",
            },
          },
        ],
        textRef: [9, 10],
      },
      BSGE01_SPIRIT_STATE_EVENT_BRAVE_COMBINE_EFFECT,
    ],
    isDoubleSided: true,
    backFace: {
      name: "第二世代神機 ファランクス極",
      printedCategory: "brave",
      colors: ["green"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 6000,
        },
      ],
      symbolColors: ["green"],
      textLines: [
        "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、ただちに裏返す。合体しているこのブレイヴは、フラッシュタイミングで裏返せる。",
        "",
        "【合体条件：GE＆系統名に「O」/「1」を含まない】",
        "【合体中】フラッシュ『このスピリットのアタック時』",
        "自分のカウント-1することで、相手のスピリット/アルティメット/ネクサス1つを重疲労させる。その後、疲労状態の相手のスピリット/アルティメット/ネクサス1つをデッキの下に戻せる。",
      ],
      keywordTags: [],
      tribe: "神喰・神機・2G",
      image: "images/BSGE01-TX02(B).webp",
      rarity: "TX",
      pack: "BSGE01 ゴッドイーター",
      cardNo: "BSGE01-TX02(B)",
      combinedBoost: 7000,
      braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O", "1"] },
      // textLines[0]「ただちに裏返す」(P3-111 残り、TR01(B) と同型)。
      revertToFrontOnSeparation: true,
      effects: [
        // B面先頭ヘッダー「疲労せず、アタック/ブロックできず」はルール強度。
        // 「ただちに裏返す」は revertToFrontOnSeparation の SBA で扱う。
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
          textRef: [0],
        },
        // 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」。(A) 面は rebirth
        // ((A)→(B))、(B) 面は reverse_rebirth mode:"flip" ((B)→(A)、既存テスト済プリミティブ
        // reverse-rebirth.test.ts 参照。cluster bsge01-backface-header-line-audit)。
        {
          timing: { kind: "activated", mode: "flash" },
          applicability: { combined: true },
          steps: [{ action: { kind: "reverse_rebirth", mode: "flip" } }],
          textRef: [0],
        },
        // 【合体中】フラッシュ『このスピリットのアタック時』自分のカウント-1することで、
        // 相手のスピリット/アルティメット/ネクサス1つを重疲労させる。その後、疲労状態の
        // 相手のスピリット/アルティメット/ネクサス1つをデッキの下に戻せる。
        // (P3-111 残り、backFace.effects 初着地)。BSGE01-C06 の重疲労+デッキ下送り送りと同型
        // (BSGE01.ts:610-671 参照、count/cost 量とカテゴリ nexus 追加が差分)。
        {
          executionMode: "optional",
          timing: { kind: "activated", mode: "flash" },
          timingScope: { player: "self", period: "attack" },
          applicability: { combined: true },
          // 「このスピリット」= 合体先自身のアタック中。自分のアタックステップだけでは不足。
          condition: [
            {
              kind: "self_state",
              state: "on_field",
              reference: "self",
              battleState: "attacking",
            },
          ],
          steps: [
            {
              executionMode: "optional",
              action: { kind: "count_decrease", player: "self", amount: 1 },
            },
            {
              targetSelectionTiming: "on_step",
              id: "heavy-exhaust-1",
              action: {
                kind: "exhaust",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate", "nexus"] },
                  count: 1,
                },
                degree: "heavy_exhaust",
              },
              connector: "conditional_cost",
            },
            {
              id: "send-to-deck-exhausted",
              action: {
                kind: "send_to_deck",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit", "ultimate", "nexus"],
                    exhaustState: "exhausted",
                  },
                  count: 1,
                },
                position: "bottom",
              },
              executionMode: "optional",
              connector: "sequential",
            },
          ],
          textRef: [3, 4],
        },
      ],
    },
  },
  {
    cardNo: "BSGE01-TX03(A)",
    orikaId: 305,
    orikaIndex: 315,
    name: "第二世代神機 リベリオン",
    printedCategory: "brave",
    colors: ["purple"],
    cost: 5,
    reductionSymbols: ["purple", "purple"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 5000,
      },
    ],
    combinedBoost: 6000,
    symbolColors: ["purple"],
    textLines: [
      "フラッシュ【契約合体：「空木 レンカ」『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から合体する。（合体していたブレイヴは破棄する。）",
      "",
      "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された/スピリット状態になった自分のスピリットに合体できる。合体しているこのブレイヴは、フラッシュタイミングで裏返せる。",
      "",
      "『このブレイヴの召喚/契約合体時』",
      "自分は手札1枚を破棄することで、デッキの上から3枚ドローする。",
      "",
      "【合体条件：GE＆系統名に「O」/「1」を含まない】",
      "【合体中】『このスピリットのアタック時』",
      "自分のカウント+3する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
    ],
    keywordTags: ["double_sided"],
    tribe: "神喰・神機・2G",
    image: "images/BSGE01-TX03(A).webp",
    rarity: "TX",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O", "1"] },
    contractCombineData: {
      braveCondition: { cardNameContains: ["空木 レンカ"] },
      timingScope: { player: "self", period: "turn" },
    },
    effects: [
      // スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず（BSGE01-C05/TX01(A)
      // と同型、ruleStrength:true）。
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
        textRef: [3],
      },
      // 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」(P3-111 S5、
      // BSGE01-TR01(A) と同型。詳細コメントは TR01(A) 参照)。
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { combined: true },
        steps: [{ action: { kind: "rebirth", countBonusMode: "none" } }],
        textRef: [3],
      },
      // 『召喚/契約合体時』手札1枚を破棄することで、デッキ3ドロー。
      // 通常召喚側は trigger 'summon'、契約合体側は登録生成時に
      // brave_combined cause:"contract_combine" へ展開する。
      {
        executionMode: "optional",
        timing: { kind: "card_event", event: "summon" },
        steps: [
          { action: { kind: "discard", count: 1, player: "self" } },
          {
            action: { kind: "draw", count: 3 },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 3,
              protectedFromNonTribe: "神喰",
            },
          },
        ],
        textRef: [9, 10],
      },
      BSGE01_SPIRIT_STATE_EVENT_BRAVE_COMBINE_EFFECT,
    ],
    isDoubleSided: true,
    backFace: {
      name: "第二世代神機 ストライバー",
      printedCategory: "brave",
      colors: ["purple"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 5000,
        },
      ],
      symbolColors: ["purple"],
      textLines: [
        "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、ただちに裏返す。合体しているこのブレイヴは、フラッシュタイミングで裏返せる。",
        "",
        "【合体条件：GE＆系統名に「O」/「1」を含まない】",
        "【合体中】フラッシュ『お互いのアタックステップ』",
        "自分のカウント-1することで、相手のスピリット/アルティメット1体のコア1個をリザーブに置く。このとき、追加で自分のカウントを減らすことで、減らしたカウント1につき、この効果で移動するコアの数を+1する。",
      ],
      keywordTags: [],
      tribe: "神喰・神機・2G",
      image: "images/BSGE01-TX03(B).webp",
      rarity: "TX",
      pack: "BSGE01 ゴッドイーター",
      cardNo: "BSGE01-TX03(B)",
      combinedBoost: 6000,
      braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O", "1"] },
      // textLines[0]「ただちに裏返す」(P3-111 残り、TR01(B) と同型)。
      revertToFrontOnSeparation: true,
      effects: [
        // B面先頭ヘッダー「疲労せず、アタック/ブロックできず」はルール強度。
        // 「ただちに裏返す」は revertToFrontOnSeparation の SBA で扱う。
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
          textRef: [0],
        },
        // 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」。(A) 面は rebirth
        // ((A)→(B))、(B) 面は reverse_rebirth mode:"flip" ((B)→(A)、既存テスト済プリミティブ
        // reverse-rebirth.test.ts 参照。cluster bsge01-backface-header-line-audit)。
        {
          timing: { kind: "activated", mode: "flash" },
          applicability: { combined: true },
          steps: [{ action: { kind: "reverse_rebirth", mode: "flip" } }],
          textRef: [0],
        },
        // 【合体中】フラッシュ『お互いのアタックステップ』自分のカウント-1することで、
        // 相手のスピリット/アルティメット1体のコア1個をリザーブに置く。このとき、追加で
        // 自分のカウントを減らすことで、減らしたカウント1につき、この効果で移動するコアの
        // 数を+1する。(P3-111 残り、backFace.effects、
        // cluster bsge01-tx03-tx04-backface-scaling-cost)。
        // count_decrease(id:"cd", amount:{min:1}、「追加で好きなだけ減らせる」=
        // pendingCountSelection で min1〜現在カウント値を選択) → core_move(単一対象
        // コアシュート、BSSL01-C05 と同型の target:{kind:filter}/from:target_card) で、
        // 移動コア数を DynamicCount(source:step_numeric_amount stepId:"cd") として直接
        // 参照する。基礎1減少→コア1個、追加1減少毎+1個の1:1対応のため multiplier/offset
        // 不要（総減少量がそのまま移動コア数）。
        {
          executionMode: "optional",
          timing: { kind: "activated", mode: "flash" },
          timingScope: { player: "both", period: "attack" },
          applicability: { combined: true },
          steps: [
            {
              id: "cd",
              action: {
                kind: "count_decrease",
                player: "self",
                amount: { min: 1 },
              },
            },
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
                amount: {
                  source: { kind: "step_numeric_amount", stepId: "cd" },
                },
              },
              connector: "conditional_cost",
            },
          ],
          textRef: [3, 4],
        },
      ],
    },
  },
  {
    cardNo: "BSGE01-TX04(A)",
    orikaId: 306,
    orikaIndex: 316,
    name: "第二世代神機 放電ブレード極",
    printedCategory: "brave",
    colors: ["blue"],
    cost: 5,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 5000,
      },
    ],
    combinedBoost: 6000,
    symbolColors: ["blue"],
    textLines: [
      "フラッシュ【契約合体：「加賀美 リョウ」『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から合体する。（合体していたブレイヴは破棄する。）",
      "",
      "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、召喚された/スピリット状態になった自分のスピリットに合体できる。合体しているこのブレイヴは、フラッシュタイミングで裏返せる。",
      "",
      "『このブレイヴの召喚/契約合体時』",
      "自分は、デッキの上から3枚ドローでき、ドロー後、手札1枚を破棄する。",
      "",
      "【合体条件：GE＆系統名に「O」/「1」を含まない】",
      "【合体中】『このスピリットのアタック時』",
      "自分のカウント+3する。追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない。",
    ],
    keywordTags: ["double_sided"],
    tribe: "神喰・神機・2G",
    image: "images/BSGE01-TX04(A).webp",
    rarity: "TX",
    pack: "BSGE01 ゴッドイーター",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O", "1"] },
    contractCombineData: {
      braveCondition: { cardNameContains: ["加賀美 リョウ"] },
      timingScope: { player: "self", period: "turn" },
    },
    effects: [
      // スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず（BSGE01-C05/TX01(A)
      // と同型、ruleStrength:true）。
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
        textRef: [3],
      },
      // 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」(P3-111 S5、
      // BSGE01-TR01(A) と同型。詳細コメントは TR01(A) 参照)。
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { combined: true },
        steps: [{ action: { kind: "rebirth", countBonusMode: "none" } }],
        textRef: [3],
      },
      // 『召喚/契約合体時』デッキ3ドロー→手札1枚を破棄。
      // 通常召喚側は trigger 'summon'、契約合体側は登録生成時に
      // brave_combined cause:"contract_combine" へ展開する。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          { action: { kind: "draw", count: 3 } },
          {
            action: { kind: "discard", count: 1, player: "self" },
            connector: "sequential",
          },
        ],
        textRef: [5, 6],
      },
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 3,
              protectedFromNonTribe: "神喰",
            },
          },
        ],
        textRef: [9, 10],
      },
      BSGE01_SPIRIT_STATE_EVENT_BRAVE_COMBINE_EFFECT,
    ],
    isDoubleSided: true,
    backFace: {
      name: "第二世代神機 EXガトリング砲極",
      printedCategory: "brave",
      colors: ["blue"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 5000,
        },
      ],
      symbolColors: ["blue"],
      textLines: [
        "スピリット状態のこのブレイヴは、疲労せず、アタック/ブロックできず、ただちに裏返す。合体しているこのブレイヴは、フラッシュタイミングで裏返せる。",
        "",
        "【合体条件：GE＆系統名に「O」/「1」を含まない】",
        "【合体中】フラッシュ『お互いのアタックステップ』",
        "自分のカウント-1することで、本来のコストが6以下の相手のスピリット/アルティメット1体を破壊する。このとき、追加で自分のカウントを減らすことで、減らしたカウント1につき、この効果の破壊上限コストを+2する。",
      ],
      keywordTags: [],
      tribe: "神喰・神機・2G",
      image: "images/BSGE01-TX04(B).webp",
      rarity: "TX",
      pack: "BSGE01 ゴッドイーター",
      cardNo: "BSGE01-TX04(B)",
      combinedBoost: 6000,
      braveCondition: { tribes: ["GE"], excludeTribeSubstring: ["O", "1"] },
      // textLines[0]「ただちに裏返す」(P3-111 残り、TR01(B) と同型)。
      revertToFrontOnSeparation: true,
      effects: [
        // B面先頭ヘッダー「疲労せず、アタック/ブロックできず」はルール強度。
        // 「ただちに裏返す」は revertToFrontOnSeparation の SBA で扱う。
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
          textRef: [0],
        },
        // 「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」。(A) 面は rebirth
        // ((A)→(B))、(B) 面は reverse_rebirth mode:"flip" ((B)→(A)、既存テスト済プリミティブ
        // reverse-rebirth.test.ts 参照。cluster bsge01-backface-header-line-audit)。
        {
          timing: { kind: "activated", mode: "flash" },
          applicability: { combined: true },
          steps: [{ action: { kind: "reverse_rebirth", mode: "flip" } }],
          textRef: [0],
        },
        // 【合体中】フラッシュ『お互いのアタックステップ』自分のカウント-1することで、
        // 本来のコストが6以下の相手のスピリット/アルティメット1体を破壊する。このとき、
        // 追加で自分のカウントを減らすことで、減らしたカウント1につき、この効果の破壊
        // 上限コストを+2する。(P3-111 残り、backFace.effects、
        // cluster bsge01-tx03-tx04-backface-scaling-cost)。
        //
        // 基本1と任意追加分のカウントを先に支払い、その実額で上限を確定してから対象を選ぶ。
        {
          executionMode: "optional",
          timing: { kind: "activated", mode: "flash" },
          timingScope: { player: "both", period: "attack" },
          applicability: { combined: true },
          condition: [{ kind: "count_value", player: "self", min: 1 }],
          steps: [
            {
              id: "cd",
              action: {
                kind: "count_decrease",
                player: "self",
                amount: { min: 1 },
              },
            },
            {
              connector: "conditional_cost",
              action: {
                kind: "effect_param_modify",
                effectClass: "cost_destroy",
                scope: "self",
                addLimitAmount: {
                  source: { kind: "step_numeric_amount", stepId: "cd" },
                  multiplier: 2,
                  offset: -2,
                },
                duration: { scope: "current_effect" },
              },
            },
            {
              targetSelectionTiming: "on_step",
              stepCondition: { kind: "ref_succeeded", stepId: "cd" },
              connector: "conditional_cost",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit", "ultimate"],
                    costBasis: "printed",
                    maxCost: 6,
                  },
                  count: 1,
                },
              },
            },
          ],
          textRef: [3, 4],
        },
      ],
    },
  },
];
