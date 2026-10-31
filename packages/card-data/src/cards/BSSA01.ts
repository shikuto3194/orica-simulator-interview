import type { CardDefinition, CardFilter } from "@orica/rules-core";

/**
 * 転醒トリガー(系統/カード名スピリット召喚・煌臨 or このネクサスが相手によってフィールドを
 * 離れるとき)。BSSA01-転醒X01(A)/転醒X04(A) 共通。トリガーが2系統(ally summon/advent の
 * game_event + このカード自身の leave_field(cause:opponent_effect))ある。
 * 転醒後ブレイヴの合体/コア1個スピリット状態化選択は、【転醒】本文に内蔵された
 * 「このとき」処理なので、B 面の card_event:"rebirth" には分離しない。
 * 実カードは合体/コア配置が確定するまで A 面に留まり、engine は postRebirthChoice
 * による仮想転醒 pending として扱う（裁定 2026-08-14）。
 */
function transcendenceFlipTriggerEffects(options: {
  allyTriggerFilter: CardFilter;
  maxCount: number;
  textRef: number[];
}): NonNullable<CardDefinition["effects"]> {
  const { allyTriggerFilter, maxCount, textRef } = options;
  return [
    {
      timing: {
        kind: "game_event",
        player: "self",
        event: ["summon", "advent"],
        triggerFilter: allyTriggerFilter,
      },
      executionMode: "optional",
      condition: [{ kind: "count_value", player: "self", max: maxCount }],
      steps: [
        {
          action: {
            kind: "rebirth",
            maxCount,
            postRebirthChoice: {
              kind: "brave_combine_or_core",
              coreCount: 1,
            },
          },
        },
      ],
      textRef,
    },
    {
      timing: {
        kind: "card_event",
        event: "leave_field",
        cause: "opponent_effect",
      },
      executionMode: "optional",
      condition: [{ kind: "count_value", player: "self", max: maxCount }],
      steps: [
        {
          action: {
            kind: "rebirth",
            maxCount,
            postRebirthChoice: {
              kind: "brave_combine_or_core",
              coreCount: 1,
            },
          },
        },
      ],
      textRef,
    },
  ];
}

export const BSSA01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSSA01-C01",
    orikaId: 257,
    orikaIndex: 267,
    name: "アリス・ツーベルク",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow"],
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
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分はデッキの下から1枚ドローできる。自分のカウント0のとき、自分のカウント+1できる。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "〔ターンに1回：同名〕自分のライフが5以下のとき、トラッシュの《ソウルコア》以外のコア1個を自分のライフに置くことで、ボイドからコア1個をこのスピリットに置く。",
      "",
      "Lv1-Lv2-Lv3",
      "自分が系統：「夜錆」を持つカードを召喚/配置するとき、このスピリットのシンボルを白/紫としても扱う。",
    ],
    keywordTags: [],
    tribe: "UW・人界・夜錆",
    image: "images/BSSA01-C01.webp",
    rarity: "C",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] 召喚時: 1枚ドロー（任意）。カウント0なら自分のカウント+1（任意）。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          { action: { kind: "draw", count: 1, position: "bottom" } },
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            condition: [{ kind: "count_value", player: "self", max: 0 }],
            connector: "simultaneous",
            executionMode: "optional",
            prompt: {
              sourceText: "自分のカウント0のとき、自分のカウント+1できる。",
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] 召喚時: ターンに1回:同名、ライフ5以下ならトラッシュの《ソウルコア》以外のコア1個をライフに置くことで、ボイドからコア1個をこのスピリットへ。
      // 「ことで」構文全体が任意のため effect-level optional。step-level optional は重ねない。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        condition: [{ kind: "life_value", player: "self", max: 5 }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 1,
              // 印字「《ソウルコア》以外の」明示。省略すると trash に通常+ソウル両方
              // ある場合に pendingLifeCoreSelection でソウルコアも選択候補に出てしまう。
              effectKind: "normal_only",
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      // [6,7] 常時: 夜錆を召喚/配置するときシンボルを白/紫としても扱う。
      //   支払い文脈限定 treat_as。普段の実効シンボルは紫のまま（BP・表示・色判定に影響なし）、
      //   系統:「夜錆」カードを召喚/配置するためのコスト軽減時に限り白/紫としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: ["white", "purple"],
              whenPayingForFilter: { tribes: ["夜錆"] },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSSA01-C02",
    orikaId: 258,
    orikaIndex: 268,
    name: "ユージオ",
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
        bp: 5000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個を自分のリザーブに置ける。自分のデッキを上から3枚オープンできる。その中の系統：「夜錆」を持つカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。自分のカウント0のとき、自分のカウント+1できる。",
      "",
      "Lv1-Lv2",
      "自分が系統：「夜錆」を持つカードを召喚/配置するとき、このスピリットのシンボルを黄/紫としても扱う。",
    ],
    keywordTags: [],
    tribe: "UW・人界・夜錆",
    image: "images/BSSA01-C02.webp",
    rarity: "C",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] 召喚時: void→reserve + デッキ3枚オープン夜錆1枚手札 + カウント0なら+1。
      // 最初の「置ける」が任意で、後続の pick/remainder は「オープンできる」の実行に依存するため effect 全体も任意。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            executionMode: "optional",
            prompt: {
              sourceText: "ボイドからコア1個を自分のリザーブに置ける。",
            },
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
          },
          {
            executionMode: "optional",
            prompt: {
              sourceText: "自分のデッキを上から3枚オープンできる。",
            },
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                { mandatory: true, count: 1, filter: { tribes: ["夜錆"] } },
              ],
              remainder: "bottom",
            },
            connector: "simultaneous",
          },
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            condition: [{ kind: "count_value", player: "self", max: 0 }],
            connector: "simultaneous",
            executionMode: "optional",
            prompt: {
              sourceText: "自分のカウント0のとき、自分のカウント+1できる。",
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] 夜錆カード召喚/配置の支払い時、シンボルを黄/紫としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: ["yellow", "purple"],
              whenPayingForFilter: { tribes: ["夜錆"] },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSSA01-C03",
    orikaId: 259,
    orikaIndex: 269,
    name: "キリト",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 3,
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
        bp: 4000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 5000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分はデッキの上から1枚ドローできる。手札2枚までを破棄することで、破棄したカード1枚につき、ドロー枚数を+1する。自分のカウント0のとき、自分のカウント+1できる。",
      "",
      "Lv1-Lv2-Lv3",
      "自分が系統：「夜錆」を持つカードを召喚/配置するとき、このスピリットのシンボルを白/黄としても扱う。",
    ],
    keywordTags: [],
    tribe: "UW・人界・夜錆",
    image: "images/BSSA01-C03.webp",
    rarity: "C",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] 召喚時: 破棄0枚なら基本の1ドロー。有償の追加枚数は破棄→ドローを双方向に結ぶ。
      // 独立した任意のカウント増加は、ドローの不発でも残す。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            id: "discarded",
            executionMode: "optional",
            action: {
              kind: "discard",
              player: "self",
              count: { min: 0, max: 2 },
            },
          },
          {
            stepCondition: { kind: "ref_count", stepId: "discarded", min: 1 },
            action: {
              kind: "draw",
              count: {
                source: { kind: "cards_from_ref", stepId: "discarded" },
                offset: 1,
              },
            },
            connector: "conditional_cost",
          },
          {
            stepCondition: {
              kind: "ref_count",
              stepId: "discarded",
              min: 0,
              max: 0,
            },
            action: { kind: "draw", count: 1 },
            connector: "sequential",
            executionMode: "optional",
          },
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            condition: [{ kind: "count_value", player: "self", max: 0 }],
            connector: "simultaneous",
            executionMode: "optional",
            prompt: {
              sourceText: "自分のカウント0のとき、自分のカウント+1できる。",
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] 夜錆カード召喚/配置の支払い時、シンボルを白/黄としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol"],
              asColor: ["white", "yellow"],
              whenPayingForFilter: { tribes: ["夜錆"] },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSSA01-C04",
    orikaId: 260,
    orikaIndex: 270,
    name: "ロニエ・アラベル",
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 4,
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
        bp: 4000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 5000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分はデッキの上から1枚ドローでき、相手の導界者ネクサス1つを破壊できる。",
      "",
      "Lv2-Lv3『自分のメインステップ』",
      "〔ターンに1回：同名〕このスピリットを疲労させることで、このスピリットの『このスピリットの召喚時』効果を発揮する。",
    ],
    keywordTags: [],
    tribe: "UW・人界・夜錆",
    image: "images/BSSA01-C04.webp",
    rarity: "C",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] 召喚時: 1枚ドロー＋相手の導界者ネクサス1つを破壊（任意）。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          { executionMode: "optional", action: { kind: "draw", count: 1 } },
          {
            executionMode: "optional",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                // 「導界者ネクサス」限定（創界神ネクサスは除く）: targetsGrandwalker で
                // 創界神/導界者を対象可能にしたうえで hasMechanic:["guided"] で導界者のみに絞る。
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: true,
                  hasMechanic: ["guided"],
                },
                count: 1,
              },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv2-Lv3『自分のメインステップ』〔ターンに1回:同名〕このスピリットを疲労させることで、
      //   このスピリットの『召喚時』効果（[0,1]）を再発揮する。コスト(自己疲労)＋同一 payload で表現。
      {
        timing: { kind: "activated", mode: "main" },
        applicability: { level: { min: 2, max: 3 } },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          // コスト: このスピリットを疲労させる（既疲労なら conditional_cost ロールバックで不発）。
          {
            action: {
              kind: "set_exhaust_state",
              target: { kind: "self" },
              state: "exhausted",
            },
          },
          // 現在の召喚時効果を再発揮する。本文の任意選択や効果への抑制も共有する。
          {
            action: {
              kind: "borrow_card_event_effect",
              target: { kind: "self" },
              borrowEvents: ["summon"],
              attributeToBorrowedCard: true,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSSA01-C05",
    orikaId: 261,
    orikaIndex: 271,
    name: "ティーゼ・シュトリーネン",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white"],
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
    symbolColors: ["white"],
    textLines: [
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個を自分のリザーブに置くことができ、相手の導界者ネクサス1つをデッキの下に戻せる。",
      "",
      "Lv2『自分のメインステップ』",
      "〔ターンに1回：同名〕このスピリットを疲労させることで、このスピリットの『このスピリットの召喚時』効果を発揮する。",
    ],
    keywordTags: [],
    tribe: "UW・人界・夜錆",
    image: "images/BSSA01-C05.webp",
    rarity: "C",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] 召喚時: ボイドからコア1個を自分のリザーブへ＋相手の導界者ネクサス1つをデッキ下へ（任意）。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
          },
          {
            executionMode: "optional",
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                // 「導界者ネクサス」限定（創界神ネクサスは除く）: targetsGrandwalker＋hasMechanic:["guided"]。
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: true,
                  hasMechanic: ["guided"],
                },
                count: 1,
              },
              position: "bottom",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv2『自分のメインステップ』〔ターンに1回:同名〕このスピリットを疲労させることで、
      //   このスピリットの『召喚時』効果（[0,1]）を再発揮する。コスト(自己疲労)＋同一 payload で表現。
      {
        timing: { kind: "activated", mode: "main" },
        applicability: { level: { min: 2, max: 2 } },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          // コスト: このスピリットを疲労させる（既疲労なら conditional_cost ロールバックで不発）。
          {
            action: {
              kind: "set_exhaust_state",
              target: { kind: "self" },
              state: "exhausted",
            },
          },
          // 現在の召喚時効果を再発揮する。
          {
            action: {
              kind: "borrow_card_event_effect",
              target: { kind: "self" },
              borrowEvents: ["summon"],
              attributeToBorrowedCard: true,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSSA01-C06",
    orikaId: 262,
    orikaIndex: 272,
    name: "Find Your Sword in this Land",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "【タイプ：歌／Yuki Kajiura】",
      "このカードの軽減シンボルは、紫/白としても扱う。",
      "このカードは、使用したとき、フィールドに置く。",
      "",
      "フラッシュ",
      "このターンの間、コスト4以上の相手のスピリットのアタックでは自分のライフは減らない。",
      "",
      "スタック",
      "相手のスピリット1体を指定する。次のバトル終了後まで、そのスピリットはアタック/ブロックできない。この効果は、お互いのアタックステップしか使えない。",
    ],
    keywordTags: [],
    tribe: "夜錆",
    image: "images/BSSA01-C06.webp",
    rarity: "C",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [1] 軽減シンボル紫/白扱い。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: ["purple", "white"],
            },
          },
        ],
        textRef: [1],
      },
      // [4,5] フラッシュ: このターン、コスト4以上の相手スピリットのアタックで自分のライフは減らない。
      // attackerFilter 付き life_damage_interception(replace) で攻撃者限定防止を表現する。
      // [2] 使用後のフィールド残置は、このカード自身を field へ動かす trailing step で表現する。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              battleOnly: true,
              mode: "replace",
              attackerFilter: { category: ["spirit"], minCost: 4 },
              duration: { scope: "turn" },
            },
          },
          {
            action: { kind: "move_self", destination: "field" },
            connector: "sequential",
          },
        ],
        textRef: [2, 4, 5],
      },
      // [7,8] スタック: 相手スピリット1体を次のバトル終了後までアタック/ブロック不可。お互いのアタックステップのみ。
      // 正源: manual/ai-reference/10_rules/02_turn-flow-and-timing.md:181-185
      // （宣言前スタック解決後に宣言合法性を再確認し、不正なら宣言キャンセル）。
      // nextBattleEnd:true で、宣言前のスタックからでも次に閉じるバトル終了まで保持する。
      // [2] スタック使用後も同じくフィールドに置く。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              restriction: ["attack", "block"],
              duration: { scope: "battle", nextBattleEnd: true },
            },
          },
          {
            action: { kind: "move_self", destination: "field" },
            connector: "sequential",
          },
        ],
        textRef: [2, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSSA01-R01",
    orikaId: 263,
    orikaIndex: 273,
    name: "ソルティリーナ・セルルト",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 5,
    reductionSymbols: ["yellow", "purple", "white"],
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
        bp: 9000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "相手の導界者ネクサス1つを破壊できる。",
      "",
      "Lv1-Lv2-Lv3『自分のメインステップ』",
      "［ゲーム1に回：同名］このスピリットを疲労させることで、自分のデッキを上から8枚オープンする。その中の系統：「夜錆」を持つカード3枚までを手札に加える。残ったカードは好きなようにデッキの上と下に戻す。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットのシンボルは、紫/白としても扱う。",
    ],
    keywordTags: [],
    tribe: "UW・人界・夜錆",
    image: "images/BSSA01-R01.webp",
    rarity: "R",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] 召喚時: 相手の導界者ネクサス1つを破壊。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: true,
                  hasMechanic: ["guided"],
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] メイン: ゲーム1回、自己疲労でデッキ8枚オープンし夜錆3枚まで手札へ。
      // 残りはカードごとにデッキの上/下と順序を選ぶ（ユーザー裁定 2026-08-09）。
      {
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "game", maxCount: 1 },
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
              revealCount: 8,
              picks: [{ count: 3, filter: { tribes: ["夜錆"] } }],
              remainder: "top_bottom_split",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      // [6,7] シンボルを紫/白としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["symbol"],
              asColor: ["purple", "white"],
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSSA01-X01",
    orikaId: 264,
    orikaIndex: 274,
    name: "修剣士キリト",
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
        bp: 11000,
      },
      {
        level: 3,
        requiredCores: 3,
        bp: 15000,
      },
    ],
    symbolColors: ["purple"],
    textLines: [
      "このカードの軽減シンボルは、白/黄としても扱う。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットは「夜空の剣」1つと「赤薔薇の剣」1つと合体できる。",
      "",
      "Lv1-Lv2-Lv3『自分のアタックステップ』",
      "相手がフラッシュ/スタック効果を発揮するとき、相手は相手の手札1枚を破棄しなければその効果を発揮できない。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "相手のスピリットのコア3個までをリザーブに置ける。このスピリットのコアが3個以上のとき、このスピリットの効果の「リザーブ」を「トラッシュ」に変更できる。",
    ],
    keywordTags: [],
    tribe: "UW・人界・夜錆",
    image: "images/BSSA01-X01.webp",
    rarity: "X",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    // Lv1-Lv2-Lv3「このスピリットは「夜空の剣」1つと「赤薔薇の剣」1つと合体できる」。
    // BSTH01-X02 と同型の名指し合体許可。condition でこの2名以外を排除し、
    // nameLimits で名前ごとの内訳上限を課す。
    maxCombinedBraves: {
      count: 2,
      condition: { cardNameContains: ["夜空の剣", "赤薔薇の剣"] },
      effectIndex: 1,
      nameLimits: [
        { cardNameContains: "夜空の剣", maxCount: 1 },
        { cardNameContains: "赤薔薇の剣", maxCount: 1 },
      ],
    },
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 軽減シンボル白/黄扱い。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["reduction_symbol"],
              asColor: ["white", "yellow"],
              appliesToCard: true,
              cardStateOnly: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] 「夜空の剣」「赤薔薇の剣」と合体できる。CardDefinition.maxCombinedBraves
      //   (top-level 宣言フィールド) が表現するため steps は空。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 1, max: 3 } },
        steps: [],
        textRef: [2, 3],
      },
      // [5,6] Lv『自分のアタックステップ』相手のフラッシュ/スタック発揮に手札1枚破棄を課す。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        steps: [
          {
            action: {
              kind: "gate_flash_stack_hand_discard",
              player: "opponent",
              count: 1,
              targetEffectLabels: ["flash", "stack"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
      // [8,9] Lv2-Lv3『このスピリットのアタック時』相手のスピリットのコア3個までをリザーブへ。
      // このスピリットのコア3個以上なら、任意で移動先をトラッシュへ変更できる。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field",
                player: "opponent",
                filter: { category: ["spirit"] },
              },
              to: { kind: "reserve", player: "opponent" },
              amount: { min: 0, max: 3 },
            },
          },
        ],
        textRef: [8, 9],
      },
      // このスピリットのアタック中、合体中効果を含む自身の効果にだけ適用する。
      // 2026-09-12 ユーザー確認。各コア移動の解決時にリザーブ/トラッシュを選ぶ。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "self_core_count", min: 3 },
          { kind: "in_battle", state: "attacking" },
        ],
        steps: [
          {
            action: {
              kind: "core_move_destination_replacement",
              fromOwner: "either",
              matchCausingSourceOnly: true,
              matchToZone: "reserve",
              toZone: "trash",
              optional: true,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSA01-X02",
    orikaId: 265,
    orikaIndex: 275,
    name: "反逆者アリス",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 7,
    reductionSymbols: ["yellow", "yellow", "yellow", "yellow"],
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
        bp: 14000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "このカードの軽減シンボルは、紫/白としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "〔ターンに1回：同名〕ゲーム中に1回、手札/手元にある系統：「夜錆」を持つカード2枚までをコストを支払わずに召喚できる。",
      "",
      "Lv2-Lv3『このスピリットの召喚/アタック時』",
      "自分のライフが6以下のとき、トラッシュの《ソウルコア》以外のコア1個を自分のライフに置くことで、ボイドからコア1個を自分のスピリットに置く。",
      "",
      "Lv2-Lv3『お互いのアタックステップ』",
      "このスピリットが疲労したとき、相手のライフのコア1個をリザーブに置ける。",
    ],
    keywordTags: [],
    tribe: "UW・人界・夜錆",
    image: "images/BSSA01-X02.webp",
    rarity: "X",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 軽減シンボル紫/白扱い。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["reduction_symbol"],
              asColor: ["purple", "white"],
              appliesToCard: true,
              cardStateOnly: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] 召喚/アタック時: 個体ごとゲーム中1回 AND 同名ターンに1回、手札/手元の夜錆カード2枚までをコストなしで召喚。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        usageLimit: [
          { kind: "per_card_name", duration: "turn" },
          { kind: "per_instance", duration: "game" },
        ],
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "set_aside"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  tribes: ["夜錆"],
                },
                count: { min: 0, max: 2 },
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv2-Lv3 召喚/アタック時: ライフ6以下ならトラッシュの《ソウルコア》以外のコア1個をライフへ置き、ボイドからコア1個を自分のスピリットへ。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "life_value", player: "self", max: 6 },
        ],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 1,
              effectKind: "normal_only",
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: { category: ["spirit"] },
              },
              amount: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [5, 6],
      },
      // [8,9] Lv2-Lv3 お互いのアタックステップ: このスピリットが疲労したとき、相手のライフのコア1個をリザーブへ。
      {
        timing: { kind: "card_event", event: "exhaust" },
        executionMode: "optional",
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
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
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSA01-X03",
    orikaId: 266,
    orikaIndex: 276,
    name: "アリス・シンセシス・サーティ",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 8,
    reductionSymbols: ["god", "god", "god", "god"],
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
        requiredCores: 3,
        bp: 16000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "このカードの軽減シンボルは、<六>としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "自分のライフが6以下のとき、トラッシュの《ソウルコア》以外のコア1個を自分のライフに置くことで、ボイドからコア1個を自分のスピリットに置く。",
      "",
      "Lv2-Lv3『お互いのエンドステップ』",
      "ゲーム中に1回、このスピリットは回復できる。",
      "",
      "Lv2-Lv3『お互いのアタックステップ』",
      "このスピリットが疲労したとき、相手のライフのコア1個をリザーブに置ける。",
    ],
    keywordTags: [],
    tribe: "UW・人界・公理",
    image: "images/BSSA01-X03.webp",
    rarity: "X",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 0,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 軽減シンボルを<六>としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "six",
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] 召喚/アタック時: ライフ6以下なら trash(《ソウルコア》以外)→life をコストに void→自分スピリット。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        condition: [{ kind: "life_value", player: "self", max: 6 }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 1,
              effectKind: "normal_only",
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: { category: ["spirit"] },
              },
              amount: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] お互いのエンドステップ: ゲーム中1回、Lv2-Lv3で回復。
      {
        timing: { kind: "phase", step: "end", whose: "either" },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "game" },
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [5, 6],
      },
      // [8,9] お互いのアタックステップ: 疲労時、相手ライフ1個をリザーブへ。
      {
        timing: { kind: "card_event", event: "exhaust" },
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
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
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSSA01-XX01",
    orikaId: 267,
    orikaIndex: 277,
    name: "[創界神]カーディナル",
    printedCategory: "nexus",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 2,
    reductionSymbols: ["god"],
    levelDefs: [
      { level: 1, requiredCores: 0, bp: 0 },
      { level: 2, requiredCores: 4, bp: 0 },
    ],
    symbolColors: ["god"],
    textLines: [
      "このネクサスは創界神ネクサス対象の効果しか受けない。このネクサスには神託と創界神ネクサス対象の効果でしかコアを置けず、そのコアは創界神ネクサス対象の効果しか受けず移動できない。",
      "",
      "【神託：〔夜錆〕〔夜錆＆ネクサス〕】",
      "◆対象の自分のスピリット/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "このカード/ネクサスのシンボル/軽減シンボルは紫/白/黄としても扱う。",
      "",
      "【神技：2】Lv1-Lv2『自分のメインステップ』",
      "〔ターンに1回、このネクサスのコア2個をボイドに置く〕自分は、デッキの上から1枚ドローするか、ボイドからコア1個を自分のリザーブに置く。",
      "",
      "【神技：4】フラッシュ Lv2『お互いのアタックステップ』",
      "〔このネクサスのコア4個をボイドに置く〕系統：「夜錆」を持つ自分の転醒前スピリット/転醒前ブレイヴ/転醒前ネクサス1つの【転醒】を転醒条件を満たしたものとして発揮する。",
    ],
    keywordTags: [
      "rebirth",
      "grandwalker",
      "enter_field_core_placement_forbidden",
    ],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        // 〔夜錆〕（無印）は素のカード種別 = スピリット。ネクサスは下の条件で別掲のため
        // categories は spirit のみに限定する（BSAZ02-X05 と同じ折り込み規約）。
        { tribes: ["夜錆"], categories: ["spirit"] },
        { tribes: ["夜錆"], categories: ["nexus"] },
      ],
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 2,
          timing: "main",
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          // [9] デッキの上から1枚ドローするか、ボイドからコア1個を自分のリザーブに置く。
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              executionMode: "optional",
              steps: [
                {
                  action: { kind: "draw", count: 1 },
                  choice: [
                    {
                      action: {
                        kind: "core_move",
                        from: { kind: "void", player: "self" },
                        to: { kind: "reserve", player: "self" },
                        amount: 1,
                      },
                    },
                  ],
                },
              ],
              textRef: [9],
            },
          ],
        },
        {
          label: "divine_skill",
          coreCost: 4,
          timing: { step: "attack", whose: "both", mode: "flash" },
          minLevel: 2,
          // [12]【神技：4】系統:「夜錆」を持つ自分の転醒前スピリット/ブレイヴ/ネクサス1つの
          //   【転醒】を「転醒条件を満たしたものとして」発揮する。
          //   外部転醒 primitive（rebirth.target + forceTriggerCondition + hasMechanic:["rebirth"]
          //   filter）+ divine_skill 解決後の finalizeEffectResolution 配線
          //   （ENGINE-external-rebirth-finalize）は engine-claude 2026-06-25 で着地済み。
          //   対象カード側の「このとき」合体/コア配置選択は、対象の rebirth action
          //   postRebirthChoice から実行時に引き継ぐ。B 面 card_event:"rebirth" へは分離しない。
          effects: [
            {
              timing: { kind: "activated", mode: "flash" },
              executionMode: "optional",
              steps: [
                {
                  action: {
                    kind: "rebirth",
                    target: {
                      kind: "filter",
                      player: "self",
                      filter: {
                        category: ["spirit", "brave", "nexus"],
                        tribes: ["夜錆"],
                        hasMechanic: ["rebirth"],
                      },
                      count: 1,
                    },
                    forceTriggerCondition: true,
                  },
                },
              ],
              textRef: [12],
            },
          ],
        },
      ],
    },
    tribe: "創界神・UW・夜錆",
    image: "images/BSSA01-XX01.webp",
    rarity: "XX",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // textLines[0] 創界神ネクサス共通ルール（神託/創界神対象効果のみコア配置・移動）と
      //   textLines[3-4]【神託：夜錆／夜錆＆ネクサス】(対象召喚/煌臨/配置時コア+1・配置時デッキ3枚
      //   トラッシュ→対象毎コア+1) は grandwalkerData(kind:"grandwalker") + keywordTags
      //   (enter_field_core_placement_forbidden) で engine が表現する
      //   （checkAndQueueOracleChoices / checkAndQueuePlacementOracle）。DSL effect 不要。
      // [6] シンボル/軽減シンボルを紫/白/黄としても扱う。
      //   多色 treat_as（asColor 配列）で 3 色を 1 効果で付与（engine batch2-1）。
      //   「このカード/」はフィールド外でも有効（2026-08-07 ユーザー裁定）なので
      //   appliesToCard:true で自身のシンボル/軽減要求枠にも適用する。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: ["purple", "white", "yellow"],
            },
          },
        ],
        textRef: [6],
      },
      // [12]【神技：4】夜錆の転醒前スピリット/ブレイヴ/ネクサス1つの【転醒】を転醒条件達成として発揮。
      //   divineSkills[1].effects に配線済み（対象選択→外部転醒 primitive→対象の
      //   postRebirthChoice 仮想転醒 pending まで一貫）。
      //   DSL effect はここには重複させない（神技2 [9] と同型、divineSkills 側が正源）。
    ],
  },
  {
    cardNo: "BSSA01-転醒X01(A)",
    orikaId: 268,
    orikaIndex: 278,
    name: "悪魔の樹 ギガスシダー",
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
      "このカード/ネクサスのシンボル/軽減シンボルは、白/黄としても扱う。",
      "",
      "Lv1【転醒：自分のカウント5以下（転醒は同時に使えない）】",
      "系統：「夜錆」を持つ自分のスピリットを召喚/煌臨したか、このネクサスが相手によってフィールドを離れるとき、このネクサスを裏返せる。このとき、この転醒後ブレイヴは、自分のスピリットに合体するか、自分のフィールド/リザーブのコア1個を置いてスピリット状態にする。",
      "",
      "Lv1『このネクサスの配置時』",
      "自分はデッキの上から1枚ドローする。",
      "",
      "Lv1『相手のアタックステップ』",
      "コア1個以下の相手のスピリットはアタックできない。",
    ],
    keywordTags: ["double_sided"],
    tribe: "UW・人界・夜錆",
    image: "images/BSSA01-転醒X01(A).webp",
    rarity: "TX",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/ネクサスのシンボル/軽減シンボルは、白/黄としても扱う。
      //   多色 treat_as（asColor 配列）。「このカード/」= 手札でも有効 → appliesToCard。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: ["white", "yellow"],
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] Lv1【転醒：自分のカウント5以下】夜錆スピリット召喚/煌臨 or このネクサスが相手離脱時、裏返せる。
      //   転醒後ブレイヴは自分のスピリットに合体するか、コア1個を置いてスピリット状態にする。
      ...transcendenceFlipTriggerEffects({
        allyTriggerFilter: { category: ["spirit"], tribes: ["夜錆"] },
        maxCount: 5,
        textRef: [2, 3],
      }),
      // [5,6] Lv1『このネクサスの配置時』デッキの上から1枚ドロー。
      {
        timing: { kind: "card_event", event: "place" },
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [5, 6],
      },
      // [8,9] Lv1『相手のアタックステップ』コア1個以下の相手のスピリットはアタックできない。
      //   コア数連動の継続的アタック制限。target.count "all" + filter.maxCores:1 で動的フィルタ
      //   CE として登録（評価時点のコア数で判定）。timingScope=opponent/attack で相手の
      //   アタックステップ限定。スピリットのみ（アルティメット非対象）・アタックのみ。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "opponent", period: "attack" },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], maxCores: 1 },
                count: "all",
              },
              restriction: ["attack"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "夜空の剣",
      printedCategory: "brave",
      colors: ["purple"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 1,
          bp: 6000,
        },
      ],
      symbolColors: ["purple"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く）",
        "",
        "【合体条件：C2以上＆コスト7以上】",
        "【合体中】【武装完全支配術】",
        "このスピリットのコア除去効果で移動するコアの数を+1し、このスピリットによって減る相手のライフの数を+1する。",
        "",
        "【合体中】【記憶開放術】『このスピリットのアタック時』",
        "ターンに1回、この「キリト」の効果で相手のスピリットを消滅させたとき、自分のカウント3以上なら相手のライフのコア1個をリザーブに置く。",
      ],
      keywordTags: [],
      tribe: "夜錆・剣刃",
      image: "images/BSSA01-転醒X01(B).webp",
      rarity: "TX",
      pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
      cardNo: "BSSA01-転醒X01(B)",
      combinedBoost: 7000,
      braveCondition: { minCount: 2, minCost: 7 },
      effects: [
        // [0] この面に裏返ったとき、フィールドに残り、カウント+1する。
        //   この行はルール (08a_advent-rebirth-contract.md §2 手順3、効果ではない) —
        //   executeRebirth が countValue+1 を適用済みのため effects に書かない
        //   (効果化すると二重計上＋効果無効の影響を受ける)。
        // [3,4]【合体中】【武装完全支配術】コア除去効果で移動するコア数を+1＋減る相手ライフを+1。
        //   core_move_amount_modifier 継続効果 (scope: self_card = このスピリット自身が
        //   ソースのコア除去効果限定, self_card_opponent_life_reduction = このスピリット
        //   自身が source となって相手ライフを減らすとき限定) を2件登録する。
        //   前者は BSTH001-転醒R02(A) の self_player_spirits と同型 (自分のスピリット全体
        //   ではなく「このスピリット」限定な点のみ異なる)。後者はライフ↔リザーブが
        //   「コア除去効果」と別扱い (10_rules/06 line 120) のため独立に加算する新規スコープ。
        //   終止形=強制、while_on_field で自動消滅 (condition:combined が外れれば rebuild で消滅)。
        {
          timing: { kind: "continuous" },
          condition: [{ kind: "combined" }],
          steps: [
            {
              action: {
                kind: "core_move_amount_modifier",
                scope: "self_card",
                amount: 1,
                duration: { scope: "while_on_field" },
              },
            },
            {
              action: {
                kind: "core_move_amount_modifier",
                scope: "self_card_opponent_life_reduction",
                amount: 1,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [3, 4],
        },
        // [6,7]【合体中】【記憶開放術】『アタック時』ターンに1回、消滅させたとき自分のカウント3以上なら相手ライフのコア1個をリザーブへ。
        {
          timing: {
            kind: "game_event",
            player: "opponent",
            event: "vanish",
            triggerFilter: { category: ["spirit"] },
            cause: ["opponent_effect"],
            sourceWhose: "either",
          },
          timingScope: { player: "self", period: "attack" },
          condition: [
            { kind: "combined" },
            {
              kind: "combined_host_card_name",
              cardNames: [{ contains: "キリト" }],
            },
            { kind: "trigger_source_is_combined_host" },
            { kind: "in_battle", state: "attacking" },
            { kind: "count_value", player: "self", min: 3 },
          ],
          usageLimit: { kind: "per_instance", duration: "turn" },
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
          textRef: [6, 7],
        },
      ],
    },
  },
  {
    cardNo: "BSSA01-転醒X02(A)",
    orikaId: 269,
    orikaIndex: 279,
    name: "青薔薇の剣",
    printedCategory: "brave",
    colors: ["white"],
    cost: 5,
    reductionSymbols: ["white", "white", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
      },
    ],
    combinedBoost: 6000,
    symbolColors: ["white"],
    textLines: [
      "このカードの軽減シンボルは、黄/紫としても扱う。",
      "",
      "【合体条件：C1以上＆コスト7以上】",
      "",
      "【合体中】【武装完全支配術】『自分のアタックステップ』",
      "系統：「夜錆」を持つ自分の合体スピリットがアタックしたとき、本来のコストが7以下の相手のスピリット2体を指定する。そのスピリットは、このターンの間、ブロックできず、効果もすべて発揮されない。",
      "",
      "【合体中】【記憶開放術】『自分のアタックステップ』",
      "自分のカウント3以上のとき、このブレイヴの効果の条件を「本来のコスト9以下」に変更する。",
      "",
      "【合体中】【転醒：自分のカウント5以下（転醒は同時に使えない。）】",
      "この「ユージオ」が相手によってフィールドを離れるとき、このスピリットをこのブレイヴの煌臨元カードとして追加することで、このブレイヴを分離し裏返せる。",
    ],
    keywordTags: ["double_sided"],
    tribe: "夜錆・剣刃",
    image: "images/BSSA01-転醒X02(A).webp",
    rarity: "TX",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    braveCondition: { minCount: 1, minCost: 7 },
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカードの軽減シンボルは、黄/紫としても扱う。
      //   多色 treat_as（asColor 配列）。「このカードの」= カード状態の軽減枠のみで、
      //   「このカード/ブレイヴ」のような実体種類併記ではないためブレイヴ状態には CE 登録しない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: ["yellow", "purple"],
            },
          },
        ],
        textRef: [0],
      },
      // [4,5]【合体中】【武装完全支配術】系統「夜錆」の自分の合体スピリットがアタックしたとき、
      //   本来のコスト7以下の相手のスピリット2体を指定する。そのスピリットは、このターンの間、
      //   ブロックできず、効果もすべて発揮されない。
      //   この効果の source は合体中の青薔薇の剣だが、誘発主語は「自分の夜錆合体スピリット」
      //   全体なので card_event ではなく game_event の triggerFilter で第三者アタックを観測する。
      //   step "lock": maxCost7 の相手スピリット 2 体を選び prevent_battle(block, turn)。
      //   後段: 同じ 2 体 (ref) に blanket suppress_effect (effectFilter 省略 = 全効果抑止、
      //   engine batch2-1)。dat target は detectAffectedCards が resolvedTargetIds を返すため一致。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "attack",
          triggerFilter: {
            category: ["spirit"],
            combined: true,
            tribes: ["夜錆"],
          },
        },
        condition: [{ kind: "combined" }],
        steps: [
          {
            id: "lock",
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit"],
                  maxCost: 7,
                  costBasis: "printed",
                },
                count: 2,
              },
              restriction: ["block"],
              duration: { scope: "turn" },
            },
          },
          {
            action: {
              kind: "suppress_effect",
              target: { kind: "ref", stepId: "lock" },
              duration: { scope: "turn" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [4, 5],
      },
      // [7,8]【合体中】【記憶開放術】カウント3以上のとき上記効果(【武装完全支配術】lock step)の
      //   「本来のコスト7以下」を「9以下」に変更。effect_param_modify(cost_prevent_battle) メタ修飾
      //   (P3-14 A-7 の拡張、BSTH07-転醒R01(B) cost_destroy と同型)。addLimitAmount:+2 で 7→9 を表現。
      //   scope:"self" = 同じブレイヴ自身が発揮する prevent_battle 効果のみ修飾対象。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "combined" },
          { kind: "count_value", player: "self", min: 3 },
        ],
        steps: [
          {
            action: {
              kind: "effect_param_modify",
              effectClass: "cost_prevent_battle",
              scope: "self",
              addLimitAmount: 2,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [7, 8],
      },
      // [10,11]【合体中】【転醒：自分のカウント5以下】この「ユージオ」が相手離脱時、煌臨元追加で分離し裏返せる。
      //   第三者観測 (game_event player:"self" event:"leave_field", BSAZ01-C? 型トラッシュ常駐
      //   リスナーと同型プラミング) + cardName フィルタで合体先「ユージオ」限定。
      //   rebirth foldCombinedPartnerToAdventSource:true (target 省略 = sourceInstanceId
      //   自身=このブレイヴを flip)。executeRebirth が card.attachedToInstanceId (=host) を
      //   attachAsAdventSource でこのブレイヴの煌臨元へ畳む（BSSA01-転醒X03(A) の逆パターン、
      //   同じ primitive を host/brave 双方から利用。test=transmute-fold-advent-source.test.ts 追加ケース）。
      //   separatesFromHost:true: 印字テキスト「分離し裏返せる」に対応する
      //   印字駆動フラグ。分離時のコアHUDでLv1以上になる任意数を配置してから転醒する。
      //   同じ「青薔薇の剣」転醒能力を外部転醒(X03(B)[8,9])から発火する
      //   ケースとも同一フラグを共有する。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
          triggerFilter: { cardName: { contains: "ユージオ" } },
        },
        executionMode: "optional",
        condition: [
          { kind: "combined" },
          { kind: "count_value", player: "self", max: 5 },
        ],
        steps: [
          {
            action: {
              kind: "rebirth",
              maxCount: 5,
              foldCombinedPartnerToAdventSource: true,
              separatesFromHost: true,
            },
          },
        ],
        textRef: [10, 11],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "赤薔薇の剣",
      printedCategory: "brave",
      colors: ["red"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 1,
          bp: 6000,
        },
      ],
      symbolColors: ["red", "white"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く）",
        "",
        "Lv1『このブレイヴの転醒時』",
        "このブレイヴを自分の「キリト」に合体させることができる。そうしたとき、このスピリットを回復状態にする。",
        "",
        "【合体条件：C3以上＆コスト7以上】",
        "【合体中】『このスピリットのアタック時』",
        "相手の創界神ネクサスすべてを破壊する。バトル終了時、このブレイヴを破壊する。",
      ],
      keywordTags: [],
      tribe: "夜錆・剣刃",
      image: "images/BSSA01-転醒X02(B).webp",
      rarity: "TX",
      pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
      cardNo: "BSSA01-転醒X02(B)",
      combinedBoost: 7000,
      braveCondition: { minCount: 3, minCost: 7 },
      effects: [
        // [0] この面に裏返ったとき、フィールドに残り、カウント+1する。
        //   この行はルール (08a_advent-rebirth-contract.md §2 手順3、効果ではない) —
        //   executeRebirth が countValue+1 を適用済みのため effects に書かない
        //   (効果化すると二重計上＋効果無効の影響を受ける)。
        // [2,3] Lv1『このブレイヴの転醒時』このブレイヴを「キリト」に合体できる。
        //   そうしたとき、このスピリットを回復状態にする。
        //   brave_combine_effect(target: cardName contains「キリト」の自分のスピリット/
        //   アルティメット) は braveCondition (backFace 自身の宣言、minCount:3/minCost:7) を
        //   自動導出して候補を絞り込む (targetRequiresBraveCombineHostEligibility、
        //   BSAZ01-C? combine_host stepと同型)。「合体させることができる」= 任意選択なので
        //   executionMode:"optional"。「そうしたとき」= ref_succeeded ゲート付き後続 recover
        //   (BSAZ01-C? combine_host/lock stepの stepCondition:ref_succeeded と同一パターン)。
        //   合体先が resolvedTargetIds として解決できなければ combine step 自体が no-op、
        //   recover もゲートにより発揮されない (BSTH01-X01 named-brave-combine の候補0件時と同型)。
        {
          timing: { kind: "card_event", event: "rebirth" },
          executionMode: "optional",
          steps: [
            {
              id: "combine",
              action: {
                kind: "brave_combine_effect",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: {
                    category: ["spirit", "ultimate"],
                    cardName: { contains: "キリト" },
                  },
                  count: 1,
                },
              },
            },
            {
              action: {
                kind: "set_exhaust_state",
                state: "recovered",
                target: { kind: "ref", stepId: "combine" },
              },
              connector: "sequential",
              stepCondition: { kind: "ref_succeeded", stepId: "combine" },
            },
          ],
          textRef: [2, 3],
        },
        // [6,7]【合体中】『このスピリットのアタック時』相手の創界神ネクサスすべて破壊＋バトル終了時このブレイヴを破壊。
        {
          timing: { kind: "card_event", event: "attack" },
          condition: [{ kind: "combined" }],
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    // 導界者ネクサスは創界神ネクサス対象の破壊を受ける
                    // (manual/ai-reference/10_rules/07_custom-orica-mechanics.md:55)。
                    targetsGrandwalker: "only",
                  },
                  count: "all",
                },
              },
            },
            {
              action: { kind: "destroy", target: { kind: "source_card" } },
              connector: "sequential",
              deferTo: "battle_end",
            },
          ],
          textRef: [6, 7],
        },
      ],
    },
  },
  {
    cardNo: "BSSA01-転醒X03(A)",
    orikaId: 270,
    orikaIndex: 280,
    name: "修剣士ユージオ",
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
        requiredCores: 2,
        bp: 10000,
      },
      {
        level: 3,
        requiredCores: 3,
        bp: 14000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "このカードの軽減シンボルは、黄／紫としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "ボイドからコア3個を自分のスピリットに置ける。そうしたとき、手札にある「青薔薇の剣」1枚をコストを支払わずに召喚できる。",
      "",
      "Lv1-Lv2-Lv3【転醒：自分のカウント5以下（転醒は同時に使えない。）】",
      "このスピリットが相手によってフィールドを離れるとき、このスピリットに合体している「青薔薇の剣」1つをこのスピリットの煌臨元カードとして追加することで、このスピリットを裏返せる。",
      "",
      "Lv2-Lv3 フラッシュ『お互いのアタックステップ』",
      "ターンに1回、このスピリットは回復できる。",
    ],
    keywordTags: ["double_sided"],
    tribe: "UW・人界・夜錆",
    image: "images/BSSA01-転醒X03(A).webp",
    rarity: "TX",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカードの軽減シンボルは、黄／紫としても扱う。
      //   多色 treat_as（asColor 配列）。「このカードの」= カード状態の軽減枠のみで、
      //   「このカード/スピリット」のような実体種類併記ではないためスピリット状態には CE 登録しない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: ["yellow", "purple"],
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] 召喚時: ボイドからコア3個を自分のスピリットへ。そうしたとき手札の「青薔薇の剣」1枚をコストなし召喚。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            id: "summon-core-boost",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: {
                kind: "field_card",
                player: "self",
                filter: { category: ["spirit"] },
              },
              amount: 3,
            },
          },
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  cardName: { contains: "青薔薇の剣" },
                },
                count: 1,
              },
              costModifier: "free",
            },
            connector: "conditional_result",
            stepCondition: {
              kind: "ref_count",
              stepId: "summon-core-boost",
              result: "numeric_amount",
              min: 3,
            },
            executionMode: "optional",
            prompt: {
              sourceText:
                "手札にある「青薔薇の剣」1枚をコストを支払わずに召喚できる。",
            },
          },
        ],
        textRef: [2, 3],
      },
      // [5-6] Lv1-Lv3【転醒：自分のカウント5以下】このスピリットが相手によってフィールドを離れるとき、
      //   合体している「青薔薇の剣」を煌臨元として追加することで裏返せる。
      //   転醒トリガー（08a L93）: スピリットの相手離脱 = card_event:leave_field
      //   合体相手の名前・枚数は既存move_cardの対象選択と全量移動で保証する。
      //   煌臨元追加→転醒をconditional_costで結び、不発なら合体/煌臨元の状態も復元する。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 5 }],
        steps: [
          {
            id: "fold-blue-rose-sword",
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["brave"],
                  cardName: { contains: "青薔薇の剣" },
                  attachedToSource: true,
                },
                count: 1,
              },
              from: { zone: "field", player: "self" },
              to: {
                zone: "field",
                player: "self",
                sourceUnderCardRole: "advent_source",
              },
              count: 1,
              requireFullCount: true,
            },
          },
          {
            connector: "conditional_cost",
            action: {
              kind: "rebirth",
              maxCount: 5,
            },
          },
        ],
        textRef: [5, 6],
      },
      // [8-9] Lv2-Lv3 フラッシュ『お互いのアタックステップ』ターンに1回、このスピリットは回復できる。
      {
        timing: { kind: "activated", mode: "flash" },
        executionMode: "optional",
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [8, 9],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "ユージオ-物質変換-",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 7,
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
          bp: 16000,
        },
        {
          level: 3,
          requiredCores: 5,
          bp: 20000,
        },
      ],
      symbolColors: ["white"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "【煌臨中】【記憶開放術】Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』",
        "ターンに1回、相手のスピリット/アルティメット1体をデッキの下に戻し、その効果を発揮させない。この効果は相手の効果では防げない。",
        "",
        "Lv1-Lv2-Lv3",
        "このスピリットは合体できない。",
        "",
        "Lv1-Lv2-Lv3",
        "このスピリットが相手によってフィールドを離れるとき、このスピリットの煌臨元にある「青薔薇の剣」1つの【転醒】をこのスピリットに合体していたものとして発揮できる。",
      ],
      // textLines[6]「このスピリットは合体できない。」は BSAZ02-C10 の
      // 【合体条件：合体不可】のような印字静的条件ではない。公式 Q24907 により
      // 「このスピリットの効果を発揮させない」間は制約を失い、効果回復後には
      // 合体中のブレイヴをただちに分離するため、effects[0] の抑制可能 CE で表す。
      keywordTags: ["advent", "rebirth"],
      tribe: "UW・人界・夜錆",
      image: "images/BSSA01-転醒X03(B).webp",
      rarity: "TX",
      pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
      cardNo: "BSSA01-転醒X03(B)",
      effects: [
        // [5,6] Lv1-Lv2-Lv3 このスピリットは合体できない。
        // Lv 適用範囲を明示して「発揮できない」効果抑止の対象にする。keywords は
        // hasCannotCombineRestriction / SBA が共通で参照し、復帰時は強制分離する。
        {
          timing: { kind: "continuous" },
          applicability: { level: { min: 1, max: 3 } },
          steps: [
            {
              action: {
                kind: "override_properties",
                target: { kind: "self" },
                properties: { keywords: ["cannot_combine"] },
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5, 6],
        },
        // [0] この面に裏返ったとき、フィールドに残り、カウント+1する。
        //   この行はルール (08a_advent-rebirth-contract.md §2 手順3、効果ではない) —
        //   executeRebirth が countValue+1 を適用済みのため effects に書かない
        //   (効果化すると二重計上＋効果無効の影響を受ける)。
        // [2,3]【煌臨中】【記憶開放術】『転醒/アタック時』ターンに1回、相手1体をデッキ下＋効果発揮させない＋相手の効果で防げない。
        //   [2026-07-11、adversarial verifier round2 lens2 指摘反映] 発揮ゲート【煌臨中】=
        //   condition:[{kind:"self_state",state:"advented"}] (structured-condition-eval.ts:99)。
        //   「相手の効果では防げない」= effect直下 preventionLevel:"unpreventable" (BSAZ02-C14 先例)。
        //   「その効果を発揮させない」= send_to_deck の field→deck 直接移動は
        //   direct field leave 検出 (trigger-system.ts:2717-2753, directBounceDestinationZones
        //   に "deck" を含む) で eventKind:"bounce" (leave_field family) として検出されるが、
        //   この検出は「全 effect step 解決後」ではなく connector:"after_triggers" が挟まれた
        //   その場で collectAndQueueTriggerReactions を呼ぶ (native-condition-connector.ts:339)
        //   ため、後続 step で suppress_pending_leave_effects (target:{kind:"ref"} で send step
        //   を参照、native-move-core-handlers.ts の eventKind==="bounce" 分岐が pendingLeaveEntities
        //   非依存で state.pendingTriggeredEffects を直接フィルタ) を繋げば同一 effect 内で抑制できる
        //   (BSFT01.ts 等で実運用中の after_triggers パターンの新規組合せ、新規 primitive 不要)。
        {
          timing: { kind: "card_event", event: ["rebirth", "attack"] },
          // 「戻し」「発揮させない」「防げない」は終止形 (可能形語尾なし) = 強制。
          // executionMode:"optional" は誤り (adversarial verifier round1 lens1 指摘、
          // 10_rules/03c_effect-text-interpretation.md「可能形語尾=任意、終止形=強制」)。
          usageLimit: { kind: "per_instance", duration: "turn" },
          condition: [{ kind: "self_state", state: "advented" }],
          preventionLevel: "unpreventable",
          steps: [
            {
              id: "send_to_deck_bottom",
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
            {
              connector: "after_state_check",
              action: {
                kind: "suppress_pending_leave_effects",
                target: { kind: "ref", stepId: "send_to_deck_bottom" },
                suppressDestroyedEffects: "destroyed_only",
              },
            },
          ],
          textRef: [2, 3],
        },
        // [8,9] Lv1-Lv3 相手による離脱時、煌臨元の「青薔薇の剣」1つの【転醒】を合体していたものとして発揮できる。
        //   「合体していたものとして」の相手を保持し、剣の選択後に分離のコアHUDを開く。
        //   確定時はユージオを剣の煌臨元へ追加してB面へ転醒する（2026-09-08 ユーザー再確認）。
        //   sourceUnderCardRoleで発揮源自身の煌臨元に限定。カウント5以下は通常どおり評価する。
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
                kind: "rebirth",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: {
                    cardName: { contains: "青薔薇の剣" },
                    adventSourceScope: "include",
                  },
                  sourceUnderCardRole: "advent_source",
                  count: 1,
                },
                maxCount: 5,
                separatesFromHost: true,
                foldCombinedPartnerToAdventSource: true,
                asIfCombinedWithSource: true,
              },
            },
          ],
          textRef: [8, 9],
        },
      ],
    },
  },
  {
    cardNo: "BSSA01-転醒X04(A)",
    orikaId: 271,
    orikaIndex: 281,
    name: "最古の金木犀",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["god", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "このカード/ネクサスのシンボル/軽減シンボルは赤/紫/緑/白/黄/青としても扱う。",
      "",
      "Lv1【転醒：自分のカウント5以下（転醒は同時に使えない）】",
      "自分の「アリス」を召喚/煌臨したか、このネクサスが相手によってフィールドを離れるとき、このネクサスを裏返せる。このとき、この転醒後ブレイヴは、自分のスピリットに合体するか、自分のフィールド/リザーブのコア1個を置いてスピリット状態にする。",
      "",
      "Lv1『このネクサスの配置時』",
      "このターンの間、相手のスピリット1体をBP-6000し、BPが0になったスピリットを破壊する。",
    ],
    keywordTags: ["double_sided"],
    tribe: "人界・公理・夜錆",
    image: "images/BSSA01-転醒X04(A).webp",
    rarity: "TX",
    pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/ネクサスのシンボル/軽減シンボルは赤/紫/緑/白/黄/青としても扱う。
      //   多色 treat_as（asColor 配列）で 6 色を 1 効果で付与（engine batch2-1）。
      //   「このカード/」= 手札でも有効 → appliesToCard。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: ["red", "purple", "green", "white", "yellow", "blue"],
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] Lv1【転醒：自分のカウント5以下】「アリス」召喚/煌臨 or このネクサスが相手離脱時、裏返せる。
      //   転醒後ブレイヴは自分のスピリットに合体するか、コア1個を置いてスピリット状態にする。
      //   「アリス」= カード名部分一致（無印なので完全一致ではない、project_card_name_reference_matching）。
      ...transcendenceFlipTriggerEffects({
        allyTriggerFilter: { cardName: { contains: "アリス" } },
        maxCount: 5,
        textRef: [2, 3],
      }),
      // [5,6] Lv1『このネクサスの配置時』このターン相手スピリット1体をBP-6000、BP0になったスピリットを破壊。
      {
        timing: { kind: "card_event", event: "place" },
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
              amount: -6000,
              duration: { scope: "turn" },
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
        textRef: [5, 6],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "金木犀の剣",
      printedCategory: "brave",
      colors: ["yellow"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 1,
          bp: 6000,
        },
      ],
      symbolColors: ["yellow"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く）",
        "",
        "【合体条件：C2以上＆コスト7以上】",
        "",
        "【合体中】【武装完全支配術】スタック『相手のアタックステップ』",
        "〔ターンに1回：同名〕この「アリス」を回復状態から重疲労させることで、相手のスピリット/アルティメット2体までを指定する。このターンの間、そのスピリット/アルティメットはアタックできない。",
        "",
        "【合体中】【記憶開放術】",
        "自分のカウント3以上のとき、このスピリットは、相手のスピリット/ネクサス/マジックの効果を受けない。",
      ],
      keywordTags: [],
      tribe: "公理・夜錆・神器",
      image: "images/BSSA01-転醒X04(B).webp",
      rarity: "TX",
      pack: "BSSA01 ソードアートオンライン-アリシゼーション-公理協会編",
      cardNo: "BSSA01-転醒X04(B)",
      combinedBoost: 7000,
      braveCondition: { minCount: 2, minCost: 7 },
      effects: [
        // [0] この面に裏返ったとき、フィールドに残り、カウント+1する。
        //   この行はルール (08a_advent-rebirth-contract.md §2 手順3、効果ではない) —
        //   executeRebirth が countValue+1 を適用済みのため effects に書かない
        //   (効果化すると二重計上＋効果無効の影響を受ける)。
        // [4,5]【合体中】【武装完全支配術】スタック『相手のアタックステップ』〔ターンに1回:同名〕
        //   「アリス」を回復状態から重疲労させて相手2体までこのターンアタック不可。
        //   合体中ブレイヴ source の target/self_name/self_state reference:"self" は
        //   rules-core resolveSelfReferenceCard で合体先 host (=「この『アリス』」) へ解決される。
        {
          executionMode: "optional",
          timing: { kind: "activated", mode: "stack" },
          condition: [
            { kind: "combined" },
            {
              kind: "self_name",
              reference: "self",
              names: [{ contains: "アリス" }],
            },
            { kind: "self_state", reference: "self", state: "recovered" },
          ],
          timingScope: { player: "opponent", period: "attack" },
          usageLimit: { kind: "per_card_name", duration: "turn" },
          steps: [
            {
              action: {
                kind: "set_exhaust_state",
                target: { kind: "self" },
                state: "heavily_exhausted",
              },
            },
            {
              id: "alice-attack-lock",
              action: {
                kind: "prevent_battle",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"] },
                  count: { min: 0, max: 2 },
                },
                restriction: ["attack"],
                duration: { scope: "turn" },
              },
              connector: "conditional_cost",
            },
          ],
          textRef: [4, 5],
        },
        // [7,8]【合体中】【記憶開放術】自分のカウント3以上のとき、相手のスピリット/ネクサス/マジックの効果を受けない。
        {
          timing: { kind: "continuous" },
          condition: [
            { kind: "combined" },
            { kind: "count_value", player: "self", min: 3 },
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
          textRef: [7, 8],
        },
      ],
    },
  },
];
