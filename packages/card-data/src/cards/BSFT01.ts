import type { CardDefinition } from "@orica/rules-core";

const LUCY_BRAVE_CONDITION = {
  categories: ["spirit"],
  cardNameContains: ["ルーシィ・ハートフィリア"],
} satisfies NonNullable<CardDefinition["braveCondition"]>;

function keyBraveDualityEffect(
  textRef: number[],
  _includesBraveLimitExclusion = false
): NonNullable<CardDefinition["effects"]>[number] {
  return {
    timing: { kind: "continuous" },
    applicability: { combined: false, soulState: false },
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
    textRef,
  };
}

export const BSFT01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSFT01-C01",
    orikaId: 375,
    orikaIndex: 392,
    name: "ウラノ・メトリア",
    printedCategory: "magic",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 5,
    reductionSymbols: ["guide", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "系統：「鍵」/「星霊」を持つ効果でデッキからオープンされたか、トラッシュに置かれたこのカードは、手札1枚と入れ替えられる。",
      "",
      "フラッシュ",
      "魂状態を含む自分の合体中のブレイヴ2つにつき、相手のスピリット/アルティメット1体を破壊する。自分のカウント5以上のとき、破壊したスピリット/アルティメットの効果を発揮させず、これらの効果は相手の効果で防げない。",
      "",
      "スタック",
      "ブロック宣言する相手のスピリット/アルティメットと同じ系統を持つ他の相手のスピリット/アルティメット/ネクサス2つを疲労させる。",
    ],
    keywordTags: ["soul_state"],
    tribe: "光導・星霊",
    image: "images/BSFT01-C01.webp",
    rarity: "C",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0] は DSL ギャップで stub。詳細は needs-dsl.w1.jsonl 参照。
    // [0]  鍵/星霊効果でのデッキオープン/トラッシュ行き時の手札入替（swap 型 displacement・自己回収
    //      primitive 未対応＋入替で手札を出る札の行き先が未確定で OPEN ruling、needs-ruling）。
    // [2,3] フラッシュ: 実装済（下記）。「魂状態を含む自分の合体中のブレイヴ2つにつき相手の
    //      スピリット/アルティメット1体を破壊」= count を DynamicCount(cards_in_zone field /
    //      category:brave / combined:true / soulState:include, divisor:2) で floor(合体ブレイヴ数/2)
    //      体の強制破壊。「カウント5以上のとき破壊した対象の効果を発揮させない」=
    //      suppressDestroyedEffects:"destroyed_only" を count_value>=5 条件付きの第2 destroy step に
    //      分岐（条件未充足時は素の破壊）。後段「これらの効果は相手の効果で防げない」=
    //      preventionLevel:"unpreventable"（blanket 防げない）で配線済み。
    // [5,6] スタック: ブロック宣言する相手と同じ系統を持つ他カードを疲労。
    //      CardFilter.tribesMatchRef:"declared_blocker" (ENGINE-tribes-match-ref) で
    //      maxBpSource 等と同型の動的参照解決 (SSOT: resolveTribesMatchRefFilter,
    //      card-filter.ts)。参照カードの実効系統は
    //      resolveDeclaredBlockerTribes(legal-actions-shared.ts, getEffectiveTribes 経由)で
    //      算出。「他の」= 参照カード自身の除外は既存 exclude:{battleState:"blocking"} に
    //      委ねる（新規 exclusion 機構を設けない）。
    effects: [
      // [0] 鍵/星霊効果でのオープン/トラッシュ行き時の手札入替（swap 型 disposition）。
      //     07b §鍵/星霊デッキオープン置換 line 40（needs-ruling BSFT01-C01 resolved）。可能形語尾 = 任意。
      //     trigger_from_zone は BSFT01-C02 add 型と同じ ["deck"]（trash 経路の fromZone も "deck"）。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "swap" },
        condition: [
          { kind: "trigger_tribes", tribes: ["鍵", "星霊"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [],
        executionMode: "optional",
        textRef: [0],
      },
      // [2,3] フラッシュ: 合体中ブレイヴ floor(/2) 体を強制破壊。カウント5以上なら破壊した
      //   対象の効果を発揮させない（条件付き destroy 分岐）。
      //   後段「これらの効果は相手の効果で防げない」(ユーザー裁定 2026-06-19) = 「これらの効果」は
      //   『カウント5以上のとき』節限定。preventionLevel:"unpreventable" を
      //   preventionLevelCondition で count>=5 にゲートし、count<=4 の素破壊は通常防止可能のまま、
      //   count>=5 の suppressDestroyedEffects 付き破壊だけが相手の cannot_*/defense_immune を
      //   貫通する（[03c:27-28]）。
      {
        timing: { kind: "activated", mode: "flash" },
        preventionLevel: "unpreventable",
        preventionLevelCondition: [
          { kind: "count_value", player: "self", min: 5 },
        ],
        steps: [
          // カウント5未満: 素の破壊。
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: {
                  source: {
                    kind: "cards_in_zone",
                    zone: "field",
                    player: "self",
                    filter: {
                      category: ["brave"],
                      combined: true,
                      soulState: "include",
                    },
                  },
                  divisor: 2,
                },
              },
            },
            condition: [{ kind: "count_value", player: "self", max: 4 }],
          },
          // カウント5以上: 破壊した対象の効果を発揮させない。
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: {
                  source: {
                    kind: "cards_in_zone",
                    zone: "field",
                    player: "self",
                    filter: {
                      category: ["brave"],
                      combined: true,
                      soulState: "include",
                    },
                  },
                  divisor: 2,
                },
              },
              suppressDestroyedEffects: "destroyed_only",
            },
            condition: [{ kind: "count_value", player: "self", min: 5 }],
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] スタック: ブロック宣言する相手と同じ系統を持つ他の相手のスピリット/
      //   アルティメット/ネクサス2つを疲労させる。
      {
        timing: { kind: "activated", mode: "stack" },
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate", "nexus"],
                  tribesMatchRef: "declared_blocker",
                  exclude: {
                    filterOr: [
                      { battleState: "blocking" },
                      { pendingDeclaration: "block" },
                    ],
                  },
                },
                count: 2,
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSFT01-C02",
    orikaId: 376,
    orikaIndex: 393,
    name: "ルーシィキック",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["guide", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "系統：「鍵」/「星霊」を持つ効果でデッキからオープンされたか、トラッシュに置かれたこのカードは、手札に加えられる。",
      "",
      "フラッシュ",
      "自分の「ルーシィ」1体と相手のスピリット/アルティメット1体のBPを比べ、BPが同じか低いスピリット/アルティメットが破壊される。このとき、合体中の自分のブレイヴ1つにつき、自分の「ルーシィ」1体をBP+2000する。",
    ],
    keywordTags: [],
    tribe: "光導・星霊",
    image: "images/BSFT01-C02.webp",
    rarity: "C",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 系統:「鍵」/「星霊」効果でデッキからオープン/トラッシュ行き時、このカードを手札に加える。
      //     BSTH01-R12 同型（trigger_tribes 版・07b §6 裁定 2026-06-11）。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_tribes", tribes: ["鍵", "星霊"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        executionMode: "optional",
        textRef: [0],
      },
      // [2,3] フラッシュ: 自分の「ルーシィ」1体と相手1体の BP を比べ「同じか低い」側を破壊。
      //   「このとき、合体中の自分のブレイヴ1つにつき、自分の『ルーシィ』1体を BP+2000」=
      //   先に選んだ「ルーシィ」を、合体中の自分のブレイヴ数 × 2000 BP 強化（比較効果中）してから
      //   比較する（bp_modify の amount に cards_in_zone(field/self/brave/combined) DynamicCount）。
      //   step[0] で強化対象「ルーシィ」を選択 → step[1] の bp_compare_destroy.comparer が
      //   その選択を ref 参照し、強化後 BP で相手1体と比較する（Pattern 2 = 源を場の別カードから選ぶ）。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "luchy_boost",
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit", "ultimate"],
                  cardName: [{ contains: "ルーシィ" }],
                },
                count: 1,
              },
              amount: {
                source: {
                  kind: "cards_in_zone",
                  zone: "field",
                  player: "self",
                  filter: { category: ["brave"], combined: true },
                },
                multiplier: 2000,
              },
              duration: { scope: "current_effect" },
            },
          },
          {
            action: {
              kind: "bp_compare_destroy",
              comparer: { kind: "ref", stepId: "luchy_boost" },
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSFT01-C03",
    orikaId: 377,
    orikaIndex: 394,
    name: "星霊界",
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 3,
    reductionSymbols: ["guide"],
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
    symbolColors: ["guide"],
    textLines: [
      "自分の系統：「鍵」/「星霊」を持つ効果でデッキからオープンされたか、トラッシュに置かれたこのカードは、手札1枚と入れ替えられる。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "自分のデッキを上から3枚トラッシュに置ける。",
      "",
      "Lv1-Lv2",
      "このネクサスのコアが1個以上のとき、自分の手札は5枚以下の間、相手によって破棄されない。",
      "",
      "Lv2『自分のメインステップ』",
      "〔ターンに1回：同名〕1コスト支払うことで、魂状態の「ルーシィ」1枚をコスト支払わずに召喚するか、トラッシュにある系統：「光導」を持つ鍵ブレイヴカード1枚を手札に戻す。",
    ],
    keywordTags: ["soul_state"],
    image: "images/BSFT01-C03.webp",
    rarity: "C",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 鍵/星霊効果でのオープン/トラッシュ行き時の手札入替（swap 型 disposition）。
      //     07b §鍵/星霊デッキオープン置換 line 40。可能形語尾 = 任意。受理時このカードを手札へ
      //     加え、手札1枚を「このカード」の行き先（オープン由来=デッキ下 / トラッシュ由来=トラッシュ）へ送る。
      //     原文「**自分の**系統:「鍵」/「星霊」」 = トリガー原因の効果ソースが自分の場合に限る
      //     (trigger_source_player player:"self")。相手の鍵/星霊効果による開示/トラッシュ行きでは
      //     誘発しない。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "swap" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          { kind: "trigger_tribes", tribes: ["鍵", "星霊"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [],
        executionMode: "optional",
        textRef: [0],
      },
      // [2,3] Lv1-Lv2『配置時』自分のデッキ上3枚をトラッシュに置ける（任意）。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "discard",
              fromZone: "deck",
              player: "self",
              count: 3,
            },
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv1-Lv2 コア1個以上のとき、自分の手札は5枚以下の間、相手によって破棄されない。
      // prevent_hand_discard CE: minSourceCores=1 (このネクサスのコア1個以上) + handCountMax=5
      // (手札5枚以下の間) を解決直前に再評価する動的ゲート。Lv1-Lv2 は applicability.level。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 1, max: 2 } },
        steps: [
          {
            action: {
              kind: "prevent_hand_discard",
              player: "self",
              minSourceCores: 1,
              handCountMax: 5,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
      // [8,9] Lv2『メイン』1コスト支払い、魂状態「ルーシィ」をコストなし召喚 or トラッシュの光導鍵ブレイヴを手札戻し。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "main" },
        applicability: { level: { min: 2, max: 2 } },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            id: "cost",
            action: { kind: "pay_cost", amount: 1 },
          },
          {
            connector: "conditional_cost",
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "field",
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  soulState: "only",
                  cardName: [{ contains: "ルーシィ" }],
                },
                count: 1,
              },
              costModifier: "free",
            },
            choice: [
              {
                action: {
                  kind: "search_zone",
                  zone: "trash",
                  player: "self",
                  filter: {
                    category: ["brave"],
                    tribesRequired: ["光導", "鍵"],
                  },
                  count: 1,
                  destination: "hand",
                  mandatory: true,
                },
              },
            ],
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSFT01-C04",
    orikaId: 378,
    orikaIndex: 395,
    name: "ハートフィリア財閥",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["guide", "guide"],
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
      "〔重複不可〕自分の系統：「鍵」/「星霊」を持つ効果でデッキからオープンされたか、トラッシュに置かれたこのカードは、自分の手札が5枚以下のとき、手札に加えられる。",
      "",
      "Lv1-Lv2",
      "系統を持たない自分のネクサスは、相手の効果を受けず、相手によってフィールドを離れるとき、同じ状態で残せる。",
      "",
      "Lv2『お互いのアタックステップ』",
      "〔ターンに1回：同名〕自分の「ルーシィ」がアタック/ブロックしたとき、手札にある鍵ブレイヴカード1枚をコストを支払わずに召喚できる。",
    ],
    keywordTags: [],
    image: "images/BSFT01-C04.webp",
    rarity: "C",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 〔重複不可〕系統:「鍵」/「星霊」効果でデッキからオープン/トラッシュ行き＆手札5枚以下時、このカードを手札に加える。
      //     BSTH01-R12 同型（trigger_tribes 版）に hand_count(max 5) ゲートを足したもの。〔重複不可〕は受動回収のため非モデル化。
      //     原文「**自分の**系統:「鍵」/「星霊」」 = トリガー原因の効果ソースが自分の場合に限る
      //     (trigger_source_player player:"self")。BSFT01-C03[0] と同型。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          { kind: "trigger_tribes", tribes: ["鍵", "星霊"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
          { kind: "hand_count", player: "self", max: 5 },
        ],
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        executionMode: "optional",
        textRef: [0],
        usageLimit: { kind: "no_duplicate" },
      },
      // [2,3] 系統を持たない自分のネクサスへ「相手効果耐性＋相手起因離脱時に同じ状態で残す」を付与。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                count: "all",
                filter: { category: ["nexus"], noTribes: true },
              },
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "grant_effect",
              target: {
                kind: "filter",
                player: "self",
                count: "all",
                filter: { category: ["nexus"], noTribes: true },
              },
              duration: { scope: "while_on_field" },
              grantedEffect: {
                timing: {
                  kind: "card_event",
                  event: "leave_field",
                  cause: ["opponent_effect", "battle"],
                },
                executionMode: "optional",
                steps: [
                  {
                    action: {
                      kind: "stay_on_field",
                      target: { kind: "self" },
                    },
                  },
                ],
              },
            },
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv2: 自分の「ルーシィ」アタック/ブロック時、手札の鍵ブレイヴ1枚をコストなし召喚。
      //   game_event:[attack,block] (player:self) + triggerFilter cardName:「ルーシィ」部分一致 +
      //   from_zone(hand) filter category:brave tribes:鍵 + costModifier:"free" + executionMode:optional +
      //   usageLimit per_card_name turn-once + condition min_level:2。
      //   ENGINE-from-zone-summon-target-selection (commit f52de8f3, 2026-06-22) で
      //   from_zone summon の複数候補は pendingEffectTargetSelection 経路に乗るため
      //   手札に複数の鍵ブレイヴがあるときはプレイヤー選択できる。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["attack", "block"],
          triggerFilter: { cardName: [{ contains: "ルーシィ" }] },
        },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                filter: { category: ["brave"], tribes: ["鍵"] },
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
    cardNo: "BSFT01-CX01",
    orikaId: 2,
    orikaIndex: 396,
    name: "ルーシィ・ハートフィリア",
    printedCategory: "spirit",
    colors: ["blue"],
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
        bp: 5000,
      },
    ],
    printedOverCount: { minCount: 2, bpBonus: 5000 },
    overCount: { minCount: 2, bpBonus: 5000 },
    symbolColors: ["guide"],
    textLines: [
      "魂状態のこのカードは、自分が系統：「鍵」を持つカードを使用後、コスト1として召喚できる。",
      "",
      "【魂状態】/【スピリット】 Lv1-Lv2",
      "〔ターンに1回：同名〕手札/合体している系統：「鍵」を持つカード/ブレイヴは、マジックカードとして1コスト支払って使用できる。この効果で使用する合体しているブレイヴは分離し、再度合体できない。自分のカウント4につき、この効果を1ターンに発揮できる回数を+1する。",
      "",
      "【魂状態】/【スピリット】 Lv1-Lv2 【星霊衣】",
      "ゲーム中に1回、自分のカウント3以上のとき、このスピリットのブレイヴ1つを分離してこのカード/スピリットの下に裏面で置ける。自分のカウント5以上のときこの効果をゲーム中にに発揮できる回数を+1する。（下のカードは、フラッシュタイミングでこのスピリットのブレイヴ1つと入れ替えられ、フィールドを離れたとき、破棄する。）",
    ],
    keywordTags: ["soul_state", "star_garment", "contract"],
    tribe: "星霊魔導士・FT",
    image: "images/BSFT01-CX01.webp",
    rarity: "CX",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // CX01 自身の needs-dsl.w1.jsonl 行は解消済み。TR 背面個別残は各 TR 行で管理する。
    effects: [
      // [0] 自分の鍵カード使用完了に反応する。元のカードが裏返っても使用時の系統を参照する。
      {
        timing: {
          kind: "game_event",
          event: "card_used",
          player: "self",
          triggerSourceFilter: { tribes: ["鍵"] },
        },
        executionMode: "optional",
        applicability: { zone: "soul_state" },
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: { override: 1 },
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] 手札/合体中の鍵カード/ブレイヴをマジックとして1コスト使用。
      {
        applicability: { zone: ["field", "soul_state"] },
        timing: { kind: "continuous" },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
          maxCountAdditionalDynamic: {
            source: { kind: "count_value", player: "self" },
            divisor: 4,
          },
        },
        limitGroupId: "BSFT01-CX01-key-magic-use",
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "self",
                count: "all",
                filter: {
                  category: ["brave"],
                  tribesRequired: ["鍵"],
                  combined: true,
                },
              },
              properties: { treatAsCategory: "magic" },
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "cost_modify",
              player: "self",
              cardFilter: { tribes: ["鍵"] },
              modifier: { override: 1 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] 【星霊衣】ブレイヴをスピリット下に裏面で置く host-subcard 機構。
      //   S1/S4 は place_star_garment / swap_star_garment で配線済み。
      {
        timing: { kind: "activated", mode: "flash" },
        activationLabel: "none",
        applicability: { level: { min: 1, max: 2 }, soulState: false },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", min: 3 }],
        usageLimit: {
          kind: "per_instance",
          duration: "game",
          maxCount: 1,
          maxCountOverrides: [
            {
              when: [{ kind: "count_value", player: "self", min: 5 }],
              maxCount: 2,
            },
          ],
        },
        limitGroupId: "BSFT01-CX01-star-garment-place",
        steps: [
          {
            prompt: {
              sourceText:
                "ゲーム中に1回、自分のカウント3以上のとき、このスピリットのブレイヴ1つを分離してこのカード/スピリットの下に裏面で置ける。自分のカウント5以上のときこの効果をゲーム中にに発揮できる回数を+1する。",
            },
            action: {
              kind: "place_star_garment",
              target: {
                kind: "filter",
                player: "self",
                count: 1,
                filter: { category: ["brave"], soulState: "include" },
              },
            },
          },
        ],
        textRef: [5, 6],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        activationLabel: "none",
        applicability: { soulState: true },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", min: 3 }],
        usageLimit: {
          kind: "per_instance",
          duration: "game",
          maxCount: 1,
          maxCountOverrides: [
            {
              when: [{ kind: "count_value", player: "self", min: 5 }],
              maxCount: 2,
            },
          ],
        },
        limitGroupId: "BSFT01-CX01-star-garment-place",
        steps: [
          {
            prompt: {
              sourceText:
                "ゲーム中に1回、自分のカウント3以上のとき、このスピリットのブレイヴ1つを分離してこのカード/スピリットの下に裏面で置ける。自分のカウント5以上のときこの効果をゲーム中にに発揮できる回数を+1する。",
            },
            action: {
              kind: "place_star_garment",
              target: {
                kind: "filter",
                player: "self",
                count: 1,
                filter: { category: ["brave"], soulState: "include" },
              },
            },
          },
        ],
        textRef: [5, 6],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        activationLabel: "none",
        applicability: { level: { min: 1, max: 2 }, soulState: false },
        executionMode: "optional",
        steps: [
          {
            prompt: {
              sourceText:
                "下のカードは、フラッシュタイミングでこのスピリットのブレイヴ1つと入れ替えられ、フィールドを離れたとき、破棄する。",
            },
            action: {
              kind: "swap_star_garment",
              target: {
                kind: "filter",
                player: "self",
                count: 1,
                filter: { category: ["brave"], soulState: "include" },
              },
            },
          },
        ],
        textRef: [6],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        activationLabel: "none",
        applicability: { soulState: true },
        executionMode: "optional",
        steps: [
          {
            prompt: {
              sourceText:
                "下のカードは、フラッシュタイミングでこのスピリットのブレイヴ1つと入れ替えられ、フィールドを離れたとき、破棄する。",
            },
            action: {
              kind: "swap_star_garment",
              target: {
                kind: "filter",
                player: "self",
                count: 1,
                filter: { category: ["brave"], soulState: "include" },
              },
            },
          },
        ],
        textRef: [6],
      },
    ],
  },
  {
    cardNo: "BSFT01-TR01(A)",
    orikaId: 379,
    orikaIndex: 397,
    name: "宝瓶宮の鍵",
    printedCategory: "brave",
    colors: ["blue"],
    cost: 5,
    reductionSymbols: ["guide", "guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "フラッシュ",
      "このターンの間、自分の系統：「星霊」/「鍵」を持つ効果すべては相手の効果で無効にされず、ネクサス/アルティメットの効果では防げない。",
      "",
      "【転醒:自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのフラッシュ効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: ["soul_state", "double_sided", "magic_compatible"],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・光導",
    image: "images/BSFT01-TR01(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2]),
      // [4,5] フラッシュ: このターン、自分の星霊/鍵効果は相手効果で無効化されず、
      // nexus/ultimate 起源の防止を貫通する。
      // P3-105: 通常の「防げない」は target lock bypass ではない。
      // 対象不可/含めない貫通は preventionBypass ではなく targetLockBypass DSL で表す。
      // [7,8] 【転醒:自分のライフ1以上】フラッシュ効果使用後、裏返せる＋任意コア配置
      // または合体できる (bsft01-tr-rebirth-permission-window)。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "flash_body",
            action: {
              kind: "grant_effect_source_prevention_immunity",
              player: "self",
              sourceScope: { tribes: ["星霊", "鍵"] },
              appliesTo: ["stack_negate", "prevention"],
              preventionBypass: {
                kind: "preventing_effect_filter",
                filter: { categories: ["nexus", "ultimate"] },
              },
              duration: { scope: "turn" },
            },
          },
          {
            id: "rebirth_window",
            connector: "after_triggers",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            executionMode: "optional",
            action: {
              kind: "rebirth",
              separatesFromHost: true,
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            id: "combine_window",
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  cardName: { contains: "ルーシィ・ハートフィリア" },
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "アクエリアス",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 8,
      reductionSymbols: [],
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
      symbolColors: ["guide"],
      textLines: [
        "この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        '"『このスピリットのアタック時』〔重複不可〕このスピリットのコスト合計まで相手のスピリット/アルティメットをデッキの下に戻せる。この効果で戻したとき、ボイドからコア1個をこのスピリットに置く。"',
        "",
        "待機状態を含まない系統：「光導」と「星霊」を持つ自分のスピリットはフィールドに1体しか存在できない。自分のカウント4以上のとき、この効果を「2体まで」にする。",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒時』",
        "相手のスピリット/アルティメット1体をデッキの下に戻す。",
      ],
      keywordTags: ["star_garment", "magic_compatible"],
      tribe: "光導・星霊",
      image: "images/BSFT01-TR01(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR01(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2,3] 【星霊衣】アタック時、コスト合計まで相手をデッキ下、戻したらコア+1。needs-dsl.w1.jsonl。
        {
          timing: { kind: "card_event", event: "attack" },
          executionMode: "optional",
          usageLimit: { kind: "no_duplicate" },
          steps: [
            {
              id: "send_cost_budget",
              targetSelectionTiming: "on_step",
              action: {
                kind: "send_to_deck",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"] },
                  count: { min: 0 },
                  budget: {
                    metric: "cost",
                    amount: {
                      source: { kind: "source_effective_cost" },
                    },
                  },
                },
                position: "bottom",
              },
            },
            {
              action: {
                kind: "core_move",
                from: { kind: "void", player: "self" },
                to: { kind: "this_card" },
                amount: 1,
              },
              stepCondition: {
                kind: "ref_succeeded",
                stepId: "send_cost_budget",
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5] 光導と星霊スピリットはフィールドに1体制限、カウント4以上で2体まで。needs-dsl.w1.jsonl。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "field_name_uniqueness",
                filter: {
                  tribesRequired: ["光導", "星霊"],
                  category: ["spirit"],
                },
                maxCount: 1,
                boostCondition: [
                  { kind: "count_value", player: "self", min: 4 },
                ],
                boostedMaxCount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
        // [7,8] Lv1-Lv3『転醒時』相手のスピリット/アルティメット1体をデッキの下に戻す。
        {
          timing: { kind: "card_event", event: "rebirth" },
          steps: [
            {
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
          ],
          textRef: [7, 8],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-TR02(A)",
    orikaId: 380,
    orikaIndex: 398,
    name: "時計座の鍵",
    printedCategory: "brave",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "スタック",
      "〔ターンに1回：同名〕次のバトル終了後まで、自分の「ルーシィ」1体は、相手の効果を受けない。この効果はお互いのアタックステップしか使えない。",
      "",
      "【転醒:自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのスタック効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・星魂",
    image: "images/BSFT01-TR02(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] スタック〔ターンに1回:同名〕次のバトル終了後まで、自分の「ルーシィ」1体は相手の効果を受けない。アタックステップ限定。
      // [7,8] 【転醒:自分のライフ1以上】スタック効果使用後、裏返せる＋任意コア配置 (bsft01-tr-rebirth-permission-window)。
      // 「使用されたとき」は本文対象の有無や処理件数に依存しない（03b空撃ち、公式Q25496）。
      // after_triggers で使用した本文の派生効果を待ち、ライフ1以上の転醒/合体を提示する。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            id: "stack_body",
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: { cardName: { contains: "ルーシィ" } },
                count: 1,
              },
              duration: { scope: "battle", nextBattleEnd: true },
            },
          },
          {
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。executionMode:optional +
            // choice variant は resolve_pending_step_optional_choice に choiceIndex 経路が
            // 無いため、2 本の相互排他な optional ステップとして表現する）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "ホロロギウム",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 3,
      reductionSymbols: [],
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
          requiredCores: 3,
          bp: 4000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "このカードは、【星霊衣】で自分のスピリットの下に置けない。",
        "",
        "Lv1-Lv2-Lv3",
        "〔重複不可〕相手が自分の「ルーシィ」/系統：「星霊」を持つスピリットを対象に含む効果を発揮するとき、可能ならこのスピリットを対象に含めなければならない。",
        "",
        "Lv1-Lv2-Lv3",
        "このスピリットによって相手のライフは減らない。",
      ],
      keywordTags: [
        "star_garment",
        "star_garment_cannot_be_under",
        "magic_compatible",
      ],
      tribe: "星霊",
      image: "images/BSFT01-TR02(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR02(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2] 【星霊衣】で自分のスピリット下に置けない。
        //   keywordTags:star_garment_cannot_be_under で place/swap 側が拒否する。
        // [4,5] Lv1-Lv3 〔重複不可〕相手がルーシィ/星霊スピリットを対象に含む効果発揮時、可能ならこのスピリットを対象に含めなければならない。
        // forced_target_inclusion primitive (forced-target-inclusion-taunt cluster): このカード自身が
        // 「ルーシィ」/系統:「星霊」に該当するため、相手の対象選択候補プールにこのカードが
        // 含まれる (=当該フィルタに一致し得る) 間だけ、その選択に本カードの選択を強制する。
        {
          timing: { kind: "continuous" },
          usageLimit: { kind: "no_duplicate" },
          steps: [
            {
              action: {
                kind: "forced_target_inclusion",
                target: "self",
              },
            },
          ],
          textRef: [4, 5],
        },
        // [7] このスピリットによって相手のライフは減らない。
        // attackerSelf 付き life_damage_interception(replace): 相手プレイヤーを保護対象とし、
        // このスピリットがアタッカーであるバトルのライフ減少のみを 0 にする（自己防止）。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "life_damage_interception",
                player: "opponent",
                cause: "any",
                mode: "replace",
                attackerSelf: true,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [7, 8],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-TR03(A)",
    orikaId: 381,
    orikaIndex: 399,
    name: "双児宮の鍵",
    printedCategory: "brave",
    colors: ["blue"],
    cost: 5,
    reductionSymbols: ["guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "スタック",
      "［ゲームに1回：同名］相手の『このスピリット/アルティメットの召喚時』効果1つを発揮させず、かわりにその効果を自分の効果として発揮する。",
      "",
      "【転醒:自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのスタック効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・光導",
    image: "images/BSFT01-TR03(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] スタック［ゲームに1回:同名］相手の『召喚時』効果1つを発揮させず、その効果を自分の効果として発揮。
      // borrow_card_event_effect(borrowEvents:["summon"]) の suppressBorrowedEffect:true で、
      // 借用実行と同時に借用元 (targetId, borrowedEffectIndex) へ effect_suppression CE
      // (while_target_on_field = 借用元の在場に紐づく寿命) を登録し、以後の同一 effectIndex
      // の自然発揮 (再召喚等) を止める (bsft01-tr03-effect-steal-rebirth cluster)。
      // [7,8] 【転醒:自分のライフ1以上】スタック効果使用後、合体させるか裏返せる＋任意コア配置
      // (BSFT01-TR02(A) と同型の rebirth_window/combine_window/core_distribute。
      // ライフ1以上は常に真 [vacuous] のため rebirth.maxCount は意図的に省略)。
      {
        timing: { kind: "activated", mode: "stack" },
        usageLimit: { kind: "per_card_name", duration: "game" },
        steps: [
          {
            id: "stack_body",
            action: {
              kind: "borrow_card_event_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  hasCardEventEffect: ["summon"],
                },
                count: 1,
              },
              borrowEvents: ["summon"],
              suppressBorrowedEffect: true,
            },
          },
          {
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。TR02(A) と同型）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "ジェミニ",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 6,
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
          bp: 5000,
        },
        {
          level: 3,
          requiredCores: 3,
          bp: 8000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        "“自分の効果で「ルーシィ」を数えるとき、1体につき2体として数えられる。”",
        "",
        "待機状態を含まない系統：「光導」と「星霊」を持つ自分のスピリットはフィールドに1体しか存在できない。自分のカウント4以上のとき、この効果を「2体まで」にする。",
        "",
        "Lv1-Lv2-Lv3",
        "このスピリットのカード名を「ルーシィ・ハートフィリア」として扱う。",
        "",
        "Lv1-Lv2-Lv3『このスピリットのアタック時』",
        "相手のスピリット/アルティメットの『このスピリットのアタック時』効果1つをこのスピリットの効果として発揮できる。",
      ],
      keywordTags: ["star_garment", "magic_compatible"],
      tribe: "光導・星霊",
      image: "images/BSFT01-TR03(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR03(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2,3] 【星霊衣】「ルーシィ」を1体につき2体として数えられる（通常の1体も選べる）。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "count_as_multiple",
                optionalCount: true,
                player: "self",
                filter: { cardName: { contains: "ルーシィ" } },
                multiplier: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5] 光導と星霊スピリットの1体制限、カウント4以上で2体まで。needs-dsl.w1.jsonl。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "field_name_uniqueness",
                filter: {
                  tribesRequired: ["光導", "星霊"],
                  category: ["spirit"],
                },
                maxCount: 1,
                boostCondition: [
                  { kind: "count_value", player: "self", min: 4 },
                ],
                boostedMaxCount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
        // [7,8] Lv1-Lv3 このスピリットのカード名を「ルーシィ・ハートフィリア」として扱う。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "override_properties",
                target: { kind: "self" },
                properties: { cardName: "ルーシィ・ハートフィリア" },
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [7, 8],
        },
        // [2,10,11] 【星霊衣】Lv1-Lv3『アタック時』相手の『アタック時』効果1つをこのスピリットの効果として発揮できる。needs-dsl.w1.jsonl。
        {
          timing: { kind: "card_event", event: "attack" },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "borrow_card_event_effect",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit", "ultimate"],
                    hasCardEventEffect: ["attack"],
                  },
                  count: 1,
                },
                borrowEvents: ["attack"],
              },
            },
          ],
          textRef: [2, 10, 11],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-TR04(A)",
    orikaId: 382,
    orikaIndex: 400,
    name: "人馬宮の鍵",
    printedCategory: "brave",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["guide", "guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "フラッシュ",
      "相手のネクサス3つまでを破壊し、相手の創界神ネクサスすべてのコアすべてをボイドに置く。",
      "",
      "【転醒：自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのフラッシュ効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・光導",
    image: "images/BSFT01-TR04(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] フラッシュ: 相手のネクサス3つまで破壊＋創界神ネクサスすべてのコアをボイド。
      // [7,8] 【転醒:自分のライフ1以上】フラッシュ効果使用後、裏返せる＋任意コア配置
      // (bsft01-tr-rebirth-permission-window。設計は BSFT01-TR02(A) と同型、注記省略)。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"] },
                count: { min: 0, max: 3 },
              },
            },
          },
          {
            id: "flash_body",
            action: {
              kind: "core_move",
              from: {
                kind: "field",
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
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。executionMode:optional +
            // choice variant は resolve_pending_step_optional_choice に choiceIndex 経路が
            // 無いため、2 本の相互排他な optional ステップとして表現する）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "サジタリウス",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 8,
      reductionSymbols: [],
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
          bp: 17000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        "“『このスピリットのアタック時』このスピリットをBP+6000する。その後、このスピリットのBP以下の相手のスピリット/アルティメット1体を破壊し、破壊したとき、相手のライフのコア1個をトラッシュに置き、このバトルの間、このスピリットに導シンボル1つを追加する。”",
        "",
        "待機状態を含まない系統：「光導」と「星霊」を持つ自分のスピリットはフィールドに1体しか存在できない。自分のカウント4以上のとき、この効果を「2体まで」にする。",
        "",
        "Lv1-Lv2-Lv3『このスピリットのアタック時』",
        "BP15000以下の相手のスピリット/アルティメット1体を破壊する。",
      ],
      keywordTags: ["star_garment", "magic_compatible"],
      tribe: "光導・星霊",
      image: "images/BSFT01-TR04(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR04(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2,3] 【星霊衣】アタック時 BP+6000→BP以下破壊→ライフ除去＋導シンボル付与。
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              id: "boost_self",
              action: {
                kind: "bp_modify",
                target: { kind: "self" },
                amount: 6000,
                duration: { scope: "battle" },
              },
            },
            {
              id: "destroy_by_bp",
              targetSelectionTiming: "on_step",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit", "ultimate"],
                    maxBpSource: "self_effective_bp",
                  },
                  count: 1,
                },
              },
            },
            {
              action: {
                kind: "core_move",
                from: { kind: "life", player: "opponent" },
                to: { kind: "trash", player: "opponent" },
                amount: 1,
              },
              stepCondition: { kind: "ref_succeeded", stepId: "destroy_by_bp" },
            },
            {
              action: {
                kind: "symbol_add",
                target: { kind: "self" },
                symbol: "guide",
                duration: { scope: "battle" },
              },
              stepCondition: { kind: "ref_succeeded", stepId: "destroy_by_bp" },
            },
          ],
          textRef: [2, 3],
        },
        // [5] 光導と星霊スピリットの1体制限。needs-dsl.w1.jsonl。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "field_name_uniqueness",
                filter: {
                  tribesRequired: ["光導", "星霊"],
                  category: ["spirit"],
                },
                maxCount: 1,
                boostCondition: [
                  { kind: "count_value", player: "self", min: 4 },
                ],
                boostedMaxCount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
        // [7,8] Lv1-Lv3『アタック時』BP15000以下の相手のスピリット/アルティメット1体を破壊。
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"], maxBp: 15000 },
                  count: 1,
                },
              },
            },
          ],
          textRef: [7, 8],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-TR05(A)",
    orikaId: 383,
    orikaIndex: 401,
    name: "金牛宮の鍵",
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["guide", "guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "スタック",
      "アタックステップ中、次のバトル終了後まで、自分の「ルーシィ」と系統：「光導」を持つスピリットすべては相手によってフィールドを離れるとき、同じ状態でフィールドに残せる。",
      "",
      "【転醒:自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのスタック効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・光導",
    image: "images/BSFT01-TR05(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] スタック: アタックステップ中、次のバトル終了後まで、自分の「ルーシィ」と光導スピリットすべては
      //   相手によって離れるとき同じ状態で残せる。grant_effect で対象群に leave_field 残置誘発を付与する。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            id: "stack_body",
            action: {
              kind: "grant_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  filterOr: [
                    {
                      category: ["spirit"],
                      cardName: { contains: "ルーシィ" },
                    },
                    { category: ["spirit"], tribes: ["光導"] },
                  ],
                },
                count: "all",
              },
              duration: { scope: "battle", nextBattleEnd: true },
              grantedEffect: {
                timing: {
                  kind: "card_event",
                  event: "leave_field",
                  cause: ["opponent_effect", "battle"],
                },
                executionMode: "optional",
                steps: [
                  {
                    action: {
                      kind: "stay_on_field",
                      target: { kind: "self" },
                    },
                  },
                ],
              },
            },
          },
          // [7,8] 【転醒:自分のライフ1以上】許可窓 (bsft01-tr-rebirth-permission-window)。
          {
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。executionMode:optional +
            // choice variant は resolve_pending_step_optional_choice に choiceIndex 経路が
            // 無いため、2 本の相互排他な optional ステップとして表現する）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "タウロス",
      printedCategory: "spirit",
      colors: ["red"],
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
          bp: 15000,
        },
        {
          level: 3,
          requiredCores: 4,
          bp: 20000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        "“このスピリットがバトルによって相手のスピリット/アルティメットだけを破壊したとき、そのスピリット/アルティメットと同じ状態でフィールドに残すことで、このスピリットを回復させ、バトル終了時、次のバトル終了時まで、このスピリットに導シンボル1つを追加する。”",
        "",
        "待機状態を含まない系統：「光導」と「星霊」を持つ自分のスピリットはフィールドに1体しか存在できない。自分のカウント4以上のとき、この効果を「2体まで」にする。",
        "",
        "Lv2-Lv3",
        "このスピリットと自分の「ルーシィ」は、バトル以外でフィールドを離れない。",
      ],
      keywordTags: ["star_garment", "magic_compatible"],
      tribe: "光導・星霊",
      image: "images/BSFT01-TR05(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR05(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2,3] 【星霊衣】バトルで相手だけ破壊時、残すことで回復＋導シンボル付与。
        {
          timing: {
            kind: "card_event",
            event: "battle_destroy_opponent_only",
          },
          executionMode: "optional",
          steps: [
            {
              id: "stay_destroyed_opponents",
              action: {
                kind: "stay_on_field",
                target: {
                  kind: "trigger_related_instances",
                  includePendingLeave: true,
                },
              },
            },
            {
              action: { kind: "recover", target: { kind: "self" } },
              connector: "conditional_cost",
              stepCondition: {
                kind: "ref_succeeded",
                stepId: "stay_destroyed_opponents",
              },
            },
            {
              deferTo: "battle_end",
              action: {
                kind: "symbol_add",
                target: { kind: "self" },
                symbol: "guide",
                duration: { scope: "battle", nextBattleEnd: true },
              },
              stepCondition: {
                kind: "ref_succeeded",
                stepId: "stay_destroyed_opponents",
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5] 光導と星霊スピリットの1体制限。needs-dsl.w1.jsonl。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "field_name_uniqueness",
                filter: {
                  tribesRequired: ["光導", "星霊"],
                  category: ["spirit"],
                },
                maxCount: 1,
                boostCondition: [
                  { kind: "count_value", player: "self", min: 4 },
                ],
                boostedMaxCount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
        // [7,8] Lv2-Lv3 このスピリットと自分の「ルーシィ」は、バトル以外でフィールドを離れない。
        {
          timing: { kind: "continuous" },
          condition: [{ kind: "min_level", value: 2 }],
          steps: [
            {
              action: {
                kind: "effect_resistance",
                target: { kind: "self" },
                resistsOutcome: "leave_field",
                source: "all",
                excludedCauses: ["battle"],
                duration: { scope: "while_on_field" },
              },
            },
            {
              action: {
                kind: "effect_resistance",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { cardName: { contains: "ルーシィ" } },
                  count: "all",
                },
                resistsOutcome: "leave_field",
                source: "all",
                excludedCauses: ["battle"],
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [7, 8],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-TR06(A)",
    orikaId: 384,
    orikaIndex: 402,
    name: "巨蟹宮の鍵",
    printedCategory: "brave",
    colors: ["green"],
    cost: 5,
    reductionSymbols: ["guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "スタック",
      "〔ターンに1回：同名〕相手のスピリット/アルティメット2体までを疲労させる。この効果はお互いのアタックステップしか使えない。",
      "",
      "【転醒:自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのスタック効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・光導",
    image: "images/BSFT01-TR06(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] スタック〔ターンに1回:同名〕相手のスピリット/アルティメット2体までを疲労。お互いのアタックステップ限定。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            id: "stack_body",
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: { min: 0, max: 2 },
              },
            },
          },
          // [7,8] 【転醒:自分のライフ1以上】許可窓 (bsft01-tr-rebirth-permission-window)。
          {
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。executionMode:optional +
            // choice variant は resolve_pending_step_optional_choice に choiceIndex 経路が
            // 無いため、2 本の相互排他な optional ステップとして表現する）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "キャンサー",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 6,
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
          bp: 6000,
        },
        {
          level: 3,
          requiredCores: 3,
          bp: 8000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        "“フラッシュ　ターンに1回、1コスト支払うことで、このスピリットのコスト以下の相手のスピリット/アルティメット1体を疲労させる。”",
        "",
        "待機状態を含まない系統：「光導」と「星霊」を持つ自分のスピリットはフィールドに1体しか存在できない。自分のカウント4以上のとき、この効果を「2体まで」にする。",
        "",
        "Lv2-Lv3",
        "系統：「星霊」/「星霊魔導士」を持つ自分のスピリット/アルティメットがアタックしたとき、相手はブロックするとき、スピリット2体でないとブロックできず。ブロックされたとき、それらと同時にバトルする。",
      ],
      keywordTags: ["star_garment", "magic_compatible"],
      tribe: "光導・星霊",
      image: "images/BSFT01-TR06(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR06(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2,3] 【星霊衣】フラッシュ ターンに1回 1コスト→自身コスト以下の相手1体疲労。
        {
          executionMode: "optional",
          timing: { kind: "activated", mode: "flash" },
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [
            { id: "cost", action: { kind: "pay_cost", amount: 1 } },
            {
              connector: "conditional_cost",
              action: {
                kind: "exhaust",
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
          ],
          textRef: [2, 3],
        },
        // [5] 光導と星霊スピリットの1体制限、カウント4以上で2体まで。needs-dsl.w1.jsonl。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "field_name_uniqueness",
                filter: {
                  tribesRequired: ["光導", "星霊"],
                  category: ["spirit"],
                },
                maxCount: 1,
                boostCondition: [
                  { kind: "count_value", player: "self", min: 4 },
                ],
                boostedMaxCount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
        // [7] Lv2-Lv3 星霊/星霊魔導士がアタックしたとき、相手はスピリット2体でないとブロックできず、ブロック時同時バトル。
        // BP比較方式は個別比較を採用(裁定2026-07-12,信頼度B・類推適用、公式【連刃】先例Q5331/Q30118)。
        // 10_rules/05b §複数体ブロック強制 参照。実装は require_multi_block CE (P2-05 Phase 5)。
        {
          timing: { kind: "continuous" },
          condition: [{ kind: "min_level", value: 2 }],
          steps: [
            {
              action: {
                kind: "require_multi_block",
                player: "self",
                filter: {
                  tribes: ["星霊", "星霊魔導士"],
                  category: ["spirit", "ultimate"],
                },
                requiredBlockerCount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [7, 8],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-TR07(A)",
    orikaId: 385,
    orikaIndex: 403,
    name: "処女宮の鍵",
    printedCategory: "brave",
    colors: ["green"],
    cost: 4,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "フラッシュ",
      "相手のスピリット/アルティメット/ネクサス1つを疲労させ、ただちにバトルを終了する。",
      "",
      "【転醒：自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのフラッシュ効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・光導",
    image: "images/BSFT01-TR07(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] フラッシュ: 相手のスピリット/アルティメット/ネクサス1つを疲労し、ただちにバトル終了。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "flash_body",
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate", "nexus"] },
                count: 1,
              },
            },
          },
          {
            connector: "sequential",
            action: { kind: "end_battle" },
          },
          // [7,8] 【転醒:自分のライフ1以上】許可窓 (bsft01-tr-rebirth-permission-window)。
          {
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。executionMode:optional +
            // choice variant は resolve_pending_step_optional_choice に choiceIndex 経路が
            // 無いため、2 本の相互排他な optional ステップとして表現する）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "バルゴ",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 6,
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
          bp: 6000,
        },
        {
          level: 3,
          requiredCores: 3,
          bp: 8000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        "“『このスピリットのアタック時』〔ターンに1回：同名〕ボイドからコア1個を自分のフィールド/リザーブに置くことで、このバトルの間、このスピリットはブロックされない。”",
        "",
        "待機状態を含まない系統：「光導」と「星霊」を持つ自分のスピリットはフィールドに1体しか存在できない。自分のカウント4以上のとき、この効果を「2体まで」にする。",
        "",
        "Lv2-Lv3",
        "相手のスピリット/アルティメットがアタックするとき、相手は相手のスピリット/アルティメット1体を疲労させなければアタックできない。",
      ],
      keywordTags: ["star_garment", "magic_compatible"],
      tribe: "光導・星霊",
      image: "images/BSFT01-TR07(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR07(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2,3] 【星霊衣】アタック時 ターンに1回 ボイドからコア1個配置→このバトルブロックされない。
        {
          timing: { kind: "card_event", event: "attack" },
          executionMode: "optional",
          usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
          steps: [
            {
              id: "place_core",
              action: {
                kind: "core_move",
                from: { kind: "void", player: "self" },
                amount: 1,
                splitDestinations: {
                  destinations: [
                    { location: { kind: "field", player: "self" } },
                    { location: { kind: "reserve", player: "self" } },
                  ],
                },
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
          ],
          textRef: [2, 3],
        },
        // [5] 光導と星霊スピリットの1体制限。needs-dsl.w1.jsonl。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "field_name_uniqueness",
                filter: {
                  tribesRequired: ["光導", "星霊"],
                  category: ["spirit"],
                },
                maxCount: 1,
                boostCondition: [
                  { kind: "count_value", player: "self", min: 4 },
                ],
                boostedMaxCount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
        // [7] Lv2-Lv3 相手がアタックするとき、相手は相手1体を疲労させなければアタックできない。
        {
          timing: { kind: "continuous" },
          timingScope: { player: "opponent", period: "attack" },
          condition: [{ kind: "min_level", value: 2 }],
          steps: [
            {
              action: {
                kind: "require_attack_exhaust_cost",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"] },
                  count: "all",
                },
                costTargetFilter: { category: ["spirit", "ultimate"] },
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [7, 8],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-TR08(A)",
    orikaId: 386,
    orikaIndex: 404,
    name: "磨羯宮の鍵",
    printedCategory: "brave",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "フラッシュ",
      "このターンの間、自分の「ルーシィ」すべては、疲労状態でブロックできる。",
      "",
      "【転醒:自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのフラッシュ効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・光導",
    image: "images/BSFT01-TR08(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] フラッシュ: このターン、自分の「ルーシィ」すべては疲労状態でブロックできる。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "flash_body",
            action: {
              kind: "allow_block_while_exhausted",
              target: {
                kind: "filter",
                player: "self",
                filter: { cardName: { contains: "ルーシィ" } },
                count: "all",
              },
              duration: { scope: "turn" },
            },
          },
          // [7,8] 【転醒:自分のライフ1以上】許可窓 (bsft01-tr-rebirth-permission-window)。
          {
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。executionMode:optional +
            // choice variant は resolve_pending_step_optional_choice に choiceIndex 経路が
            // 無いため、2 本の相互排他な optional ステップとして表現する）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "カプリコーン",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 6,
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
          bp: 5000,
        },
        {
          level: 3,
          requiredCores: 3,
          bp: 8000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        "“『このスピリットのブロック時』相手のスピリット/アルティメット1体を手札に戻す。”",
        "",
        "待機状態を含まない系統：「光導」と「星霊」を持つ自分のスピリットはフィールドに1体しか存在できない。自分のカウント4以上のとき、この効果を「2体まで」にする。",
        "",
        "Lv2-Lv3『相手のアタックステップ』",
        "このスピリットは、BP+3000され、疲労状態でブロックでき、「ブロックされない」相手のスピリット/アルティメットすべてをブロックできる。",
      ],
      keywordTags: ["star_garment", "magic_compatible"],
      tribe: "光導・星霊",
      image: "images/BSFT01-TR08(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR08(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2,3] 【星霊衣】ブロック時 相手1体を手札に戻す（battle_immediate）。
        {
          timing: { kind: "card_event", event: "block" },
          steps: [
            {
              action: {
                kind: "bounce",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"] },
                  count: 1,
                },
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5] 光導と星霊スピリットの1体制限。needs-dsl.w1.jsonl。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "field_name_uniqueness",
                filter: {
                  tribesRequired: ["光導", "星霊"],
                  category: ["spirit"],
                },
                maxCount: 1,
                boostCondition: [
                  { kind: "count_value", player: "self", min: 4 },
                ],
                boostedMaxCount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
        // [7,8] Lv2-Lv3『相手のアタックステップ』BP+3000＋疲労ブロック可＋ブロックされない相手すべてブロック可。
        // 同時アタックでは 10_rules/05 Q26724 に従い group 全体のブロック数上限を増やさない。
        {
          timing: { kind: "continuous" },
          timingScope: { player: "opponent", period: "attack" },
          condition: [{ kind: "min_level", value: 2 }],
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: { kind: "self" },
                amount: 3000,
                duration: { scope: "while_on_field" },
              },
            },
            {
              action: {
                kind: "allow_block_while_exhausted",
                target: { kind: "self" },
                duration: { scope: "while_on_field" },
              },
            },
            {
              action: {
                kind: "block_unblockable",
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
  {
    cardNo: "BSFT01-TR09(A)",
    orikaId: 387,
    orikaIndex: 405,
    name: "白羊宮の鍵",
    printedCategory: "brave",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "スタック",
      "アタックステップ中、魂状態を含む自分の「ルーシィ」がいるとき、次のバトル終了後まで、相手のスピリット/アルティメットのアタックでは自分のライフは減らない。",
      "",
      "【転醒：自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのスタック効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・光導",
    image: "images/BSFT01-TR09(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] スタック: 魂状態を含む自分の「ルーシィ」がいるとき、次のバトル終了後まで
      //   「相手のスピリット/アルティメットのアタックでは」自分のライフは減らない。
      //   「魂状態を含む自分の「ルーシィ」」= 通常フィールド ∪ 魂状態（裁定 2026-06-13・10_rules/08a）。
      //   無印 field_has は魂状態（soulStateInstanceIds）を数えないため includeSoulState:true。
      //   原文は「相手のスピリット/アルティメットのアタックでは」とアタッカー限定なので
      //   life_damage_interception(replace) + attackerFilter:[spirit,ultimate] で表現する
      //   （旧 blanket prevent_life_damage はマジック/その他原因まで巻き込む過剰防止だった）。
      //   pre_declaration_stack で登録される duration:battle CE の null attackId 失効バグは
      //   2026-06-25 fix(8ab0360c) 解消済み。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "ルーシィ" }],
            includeSoulState: true,
          },
        ],
        steps: [
          {
            id: "stack_body",
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              battleOnly: true,
              mode: "replace",
              attackerFilter: { category: ["spirit", "ultimate"] },
              duration: { scope: "battle", nextBattleEnd: true },
            },
          },
          // [7,8] 【転醒:自分のライフ1以上】許可窓 (bsft01-tr-rebirth-permission-window)。
          {
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。executionMode:optional +
            // choice variant は resolve_pending_step_optional_choice に choiceIndex 経路が
            // 無いため、2 本の相互排他な optional ステップとして表現する）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "アリエス",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 6,
      reductionSymbols: [],
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
          requiredCores: 3,
          bp: 8000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        "“『このスピリットのブロック時』相手のスピリット2体を疲労させ、このスピリットをBP+5000する。”",
        "",
        "待機状態を含まない系統：「光導」と「星霊」を持つ自分のスピリットはフィールドに1体しか存在できない。自分のカウント4以上のとき、この効果を「2体まで」にする。",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒時』",
        "魂状態を含む自分の「ルーシィ」がいるとき、相手のアタックステップなら、このターンの間、自分のライフは2しか減らない。",
      ],
      keywordTags: ["soul_state", "star_garment", "magic_compatible"],
      tribe: "光導・星霊",
      image: "images/BSFT01-TR09(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR09(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2,3] 【星霊衣】ブロック時 相手2体疲労＋このスピリットBP+5000。
        {
          timing: { kind: "card_event", event: "block" },
          steps: [
            {
              action: {
                kind: "exhaust",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: 2,
                },
              },
            },
            {
              action: {
                kind: "bp_modify",
                target: { kind: "self" },
                amount: 5000,
                duration: { scope: "battle" },
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5] 光導と星霊スピリットの1体制限。needs-dsl.w1.jsonl。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "field_name_uniqueness",
                filter: {
                  tribesRequired: ["光導", "星霊"],
                  category: ["spirit"],
                },
                maxCount: 1,
                boostCondition: [
                  { kind: "count_value", player: "self", min: 4 },
                ],
                boostedMaxCount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
        // [7,8] Lv1-Lv3『転醒時』魂状態ルーシィがいて相手アタックステップなら、このターン自分のライフは2しか減らない。
        // 裁定 2026-06-15（10_rules/05 §ライフ減少の上限キャップ）= ターン累積上限。
        //   そのターンの自分ライフ減少の合計を最大2に頭打ち（全原因合算 / 自ターン開始リセット）。
        //   mode:"turn_cap" + cap:2 で lifeReductionCappedThisTurn を消費しながらクランプする。
        //   ゲート: 魂状態を含む自分「ルーシィ」(field_has includeSoulState) ∧ 相手アタックステップ
        //   (step_phase whose:"opponent")。
        {
          timing: { kind: "card_event", event: "rebirth" },
          condition: [
            {
              kind: "field_has",
              player: "self",
              cardNames: [{ contains: "ルーシィ" }],
              includeSoulState: true,
            },
            { kind: "step_phase", step: "attack", whose: "opponent" },
          ],
          steps: [
            {
              action: {
                kind: "life_damage_interception",
                player: "self",
                cause: "any",
                mode: "turn_cap",
                cap: 2,
                duration: { scope: "turn" },
              },
            },
          ],
          textRef: [7, 8],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-TR10(A)",
    orikaId: 389,
    orikaIndex: 406,
    name: "天蠍宮の鍵",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "スタック",
      "相手のスピリット/アルティメット1体を指定し、次のバトル終了後まで効果を発揮させない。この効果はお互いのアタックステップしか使えない。",
      "",
      "【転醒:自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのスタック効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・光導",
    image: "images/BSFT01-TR10(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] スタック: 相手1体を指定し次のバトル終了後まで効果を発揮させない。お互いのアタックステップ限定。needs-dsl.w1.jsonl。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            id: "stack_body",
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              duration: { scope: "battle", nextBattleEnd: true },
            },
          },
          // [7,8] 【転醒:自分のライフ1以上】許可窓 (bsft01-tr-rebirth-permission-window)。
          {
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。executionMode:optional +
            // choice variant は resolve_pending_step_optional_choice に choiceIndex 経路が
            // 無いため、2 本の相互排他な optional ステップとして表現する）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "スコーピオン",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 6,
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
          bp: 7000,
        },
        {
          level: 3,
          requiredCores: 3,
          bp: 9000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        '"『このスピリットのアタック時』自分のカウント2につき、相手のスピリット/アルティメット1体はブロックできない。"',
        "",
        "待機状態を含まない系統：「光導」と「星霊」を持つ自分のスピリットはフィールドに1体しか存在できない。自分のカウント4以上のとき、この効果を「2体まで」にする。",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒時』",
        "このターンの間、相手のスピリット/アルティメット1体はアタックできない。さらに、自分のカウント4以上のとき、トラッシュにある系統：「光導」を持つ鍵ブレイヴカード1枚を手札に戻せる。",
      ],
      keywordTags: ["star_garment", "magic_compatible"],
      tribe: "光導・星霊",
      image: "images/BSFT01-TR10(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR10(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2,3] 【星霊衣】アタック時 カウント2につき相手1体ブロックできない。
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "prevent_battle",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"] },
                  count: {
                    source: { kind: "count_value", player: "self" },
                    divisor: 2,
                  },
                },
                restriction: ["block"],
                duration: { scope: "battle" },
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5] 光導と星霊スピリットの1体制限。needs-dsl.w1.jsonl。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "field_name_uniqueness",
                filter: {
                  tribesRequired: ["光導", "星霊"],
                  category: ["spirit"],
                },
                maxCount: 1,
                boostCondition: [
                  { kind: "count_value", player: "self", min: 4 },
                ],
                boostedMaxCount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
        // [7,8] Lv1-Lv3『転醒時』このターン相手1体アタックできない。さらにカウント4以上なら
        //   トラッシュの系統:「光導」鍵ブレイヴ1枚を手札に戻せる（任意）。
        //   card_event:"rebirth" 発火点は配線済み。後段は count_value>=4 ゲートの任意 search_zone(trash→hand)。
        {
          timing: { kind: "card_event", event: "rebirth" },
          steps: [
            {
              action: {
                kind: "prevent_battle",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"] },
                  count: 1,
                },
                restriction: ["attack"],
                duration: { scope: "turn" },
              },
            },
            {
              // 「さらに、自分のカウント4以上のとき、トラッシュにある系統:「光導」を持つ
              //   鍵ブレイヴカード1枚を手札に戻せる。」可能形「戻せる」= 任意。
              executionMode: "optional",
              condition: [{ kind: "count_value", player: "self", min: 4 }],
              action: {
                kind: "search_zone",
                zone: "trash",
                filter: { category: ["brave"], tribesRequired: ["光導", "鍵"] },
                count: 1,
                destination: "hand",
              },
            },
          ],
          textRef: [7, 8],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-TR11(A)",
    orikaId: 390,
    orikaIndex: 407,
    name: "獅子宮の鍵",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 5,
    reductionSymbols: ["guide", "guide", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕相手のスピリット/アルティメットがいるとき、ボイドからコア1個を自分のライフに置く。",
      "",
      "【転醒：自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのフラッシュ効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・光導",
    image: "images/BSFT01-TR11(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] フラッシュ〔ターンに1回:同名〕相手スピリット/アルティメットがいるとき、ボイドからコア1個を自分のライフに置く。
      {
        timing: { kind: "activated", mode: "flash" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        condition: [
          {
            kind: "field_has",
            player: "opponent",
            category: ["spirit", "ultimate"],
          },
        ],
        steps: [
          {
            id: "flash_body",
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "life", player: "self" },
              amount: 1,
            },
          },
          // [7,8] 【転醒:自分のライフ1以上】許可窓 (bsft01-tr-rebirth-permission-window)。
          {
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。executionMode:optional +
            // choice variant は resolve_pending_step_optional_choice に choiceIndex 経路が
            // 無いため、2 本の相互排他な optional ステップとして表現する）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "ロキ",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 9,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 1,
          requiredCores: 1,
          bp: 9000,
        },
        {
          level: 2,
          requiredCores: 2,
          bp: 13000,
        },
        {
          level: 3,
          requiredCores: 3,
          bp: 15000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この転醒後スピリットに裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "（自分の【星霊衣】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        "“『自分のアタックステップ』〔重複不可〕相手は、自分のカウント3につき、1コスト余分に支払わなければ、手札のカードを使用できない。”",
        "",
        "待機状態を含まない系統：「光導」と「星霊」を持つ自分のスピリットはフィールドに1体しか存在できない。自分のカウント4以上のとき、この効果を「2体まで」にする。",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒時』",
        "相手のトラッシュにあるマジックカード1枚をデッキの下に戻せる。自分のカウント3につき、戻す枚数を+1する。",
      ],
      keywordTags: ["star_garment", "magic_compatible"],
      tribe: "光導・星霊",
      image: "images/BSFT01-TR11(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR11(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2,3] 【星霊衣】自分のアタックステップ〔重複不可〕相手はカウント3につき1コスト余分に支払わなければ手札を使用できない。
        {
          timing: { kind: "continuous" },
          timingScope: { player: "self", period: "attack" },
          usageLimit: { kind: "no_duplicate" },
          steps: [
            {
              action: {
                kind: "cost_modify",
                player: "opponent",
                additionalPayment: true,
                cardFilter: { zone: ["hand"] },
                modifier: {
                  additionalCostValue: {
                    source: { kind: "count_value", player: "self" },
                    divisor: 3,
                  },
                },
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [2, 3],
        },
        // [5] 光導と星霊スピリットの1体制限。needs-dsl.w1.jsonl。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "field_name_uniqueness",
                filter: {
                  tribesRequired: ["光導", "星霊"],
                  category: ["spirit"],
                },
                maxCount: 1,
                boostCondition: [
                  { kind: "count_value", player: "self", min: 4 },
                ],
                boostedMaxCount: 2,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
        // [7,8] Lv1-Lv3『転醒時』相手トラッシュのマジック1枚をデッキ下へ。カウント3につき+1。
        {
          timing: { kind: "card_event", event: "rebirth" },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "search_zone",
                zone: "trash",
                player: "opponent",
                filter: { category: ["magic"] },
                count: {
                  source: { kind: "count_value", player: "self" },
                  divisor: 3,
                  offset: 1,
                },
                destination: "deck",
                destinationPosition: "bottom",
                mandatory: true,
              },
            },
          ],
          textRef: [7, 8],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-TR12(A)",
    orikaId: 391,
    orikaIndex: 408,
    name: "仔犬座の鍵",
    printedCategory: "brave",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "メイン",
      "自分のデッキを上から3枚オープンする。その中の系統：「光導」を持つ鍵ブレイヴカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "【転醒：自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのメイン効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・星魂",
    image: "images/BSFT01-TR12(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] メイン: デッキ上3枚オープン→系統:「光導」鍵ブレイヴ1枚を手札に加える→残りは破棄。
      // 原文「系統：「光導」を持つ鍵ブレイヴカード1枚」= 光導 AND 鍵（07b §63-71 鍵ブレイヴ二面性）。
      // tribes:[光導] では単独 or 既定で『鍵』を欠落させ、非鍵 光導 ブレイヴが誤って候補化する。
      // SSOT: 同弾 BSFT01.ts:2141 が同一原文を tribesRequired で表現済み。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            id: "main_body",
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  mandatory: true,
                  filter: {
                    category: ["brave"],
                    tribesRequired: ["光導", "鍵"],
                  },
                  destination: "hand",
                },
              ],
              remainder: "trash",
            },
          },
          // [7,8] 【転醒:自分のライフ1以上】許可窓 (bsft01-tr-rebirth-permission-window)。
          {
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。executionMode:optional +
            // choice variant は resolve_pending_step_optional_choice に choiceIndex 経路が
            // 無いため、2 本の相互排他な optional ステップとして表現する）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "ニコラ（ブルー）",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 3,
      reductionSymbols: [],
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
          requiredCores: 3,
          bp: 4000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "このカードは、【星霊衣】で自分のスピリットの下に置けない。",
        "",
        "Lv1-Lv2-Lv3",
        "このスピリットによって相手のライフは減らない。",
      ],
      keywordTags: [
        "star_garment",
        "star_garment_cannot_be_under",
        "magic_compatible",
      ],
      tribe: "星霊",
      image: "images/BSFT01-TR12(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR12(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2] 【星霊衣】で自分のスピリット下に置けない。
        //   keywordTags:star_garment_cannot_be_under で place/swap 側が拒否する。
        // [5] Lv1-Lv3 このスピリットによって相手のライフは減らない。
        // attackerSelf 付き life_damage_interception(replace): TR02(B)[7] と同型の自己防止。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "life_damage_interception",
                player: "opponent",
                cause: "any",
                mode: "replace",
                attackerSelf: true,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-TR13(A)",
    orikaId: 392,
    orikaIndex: 409,
    name: "南十字座の鍵",
    printedCategory: "brave",
    colors: ["purple"],
    cost: 3,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    combinedBoost: 0,
    symbolColors: [],
    textLines: [
      "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。",
      "",
      "このカードは、マジックカードとしても扱い、自分の「ルーシィ」の合体可能なブレイヴ数に数えない。スピリット状態のこのブレイヴは、アタック/ブロックできず、疲労しない。",
      "",
      "メイン",
      "自分のデッキを上から3枚破棄する。その後、自分のトラッシュにある系統：「光導」を持つ鍵ブレイヴカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "【転醒:自分のライフ1以上（転醒は同時に使えない）】",
      "このカードのメイン効果が使用されたとき、効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。",
      "",
      "【合体条件：「ルーシィ・ハートフィリア」】",
    ],
    keywordTags: [
      "soul_state",
      "double_sided",
      "magic_compatible",
      "brave_limit_exempt_lucy",
    ],
    braveCondition: LUCY_BRAVE_CONDITION,
    tribe: "鍵・星魂",
    image: "images/BSFT01-TR13(A).webp",
    rarity: "TR",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,2] 鍵ブレイヴ共通のうち、スピリット状態の攻防不可・疲労しない（ruleStrength）を実装。
      keyBraveDualityEffect([0, 2], true),
      // [4,5] メイン: デッキ上3枚破棄→その後トラッシュの系統:「光導」鍵ブレイヴ1枚を手札に加える。
      // 原文「系統：「光導」を持つ鍵ブレイヴカード1枚」= 光導 AND 鍵（07b §63-71 鍵ブレイヴ二面性）。
      // tribes:[光導] では既定 or で単独要素扱いになり『鍵』を欠落させ、非鍵 光導 ブレイヴが誤って候補化する。
      // SSOT: 同弾 BSFT01.ts:2141 が同一原文を tribesRequired で表現済み。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            id: "discard_deck",
            action: {
              kind: "discard",
              fromZone: "deck",
              player: "self",
              count: 3,
              deferMovedToTrashEffects: true,
            },
          },
          {
            targetSelectionTiming: "on_step",
            id: "main_body",
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: { category: ["brave"], tribesRequired: ["光導", "鍵"] },
              count: 1,
              destination: "hand",
              mandatory: true,
            },
          },
          {
            action: {
              kind: "process_moved_to_trash",
              source: { stepId: "discard_deck" },
            },
          },
          // [7,8] 【転醒:自分のライフ1以上】許可窓 (bsft01-tr-rebirth-permission-window)。
          {
            id: "rebirth_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "after_triggers",
            executionMode: "optional",
            action: {
              kind: "rebirth",
              allowPostRebirthCorePlacementForLvDeficit: true,
              postRebirthChoice: {
                kind: "core_distribute",
                minimum: "back_face_lv",
              },
            },
          },
          {
            // 合体分岐: rebirth_window (裏返す) が発揮されなかったときのみ提示する
            // 独立した任意ステップ（「合体させるか、裏返せる」の択一。executionMode:optional +
            // choice variant は resolve_pending_step_optional_choice に choiceIndex 経路が
            // 無いため、2 本の相互排他な optional ステップとして表現する）。
            id: "combine_window",
            condition: [{ kind: "life_value", player: "self", min: 1 }],
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                {
                  kind: "ref_executed",
                  stepId: "rebirth_window",
                  not: true,
                },
              ],
            },
            executionMode: "optional",
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [4, 5, 7, 8],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "クルックス",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 3,
      reductionSymbols: [],
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
          requiredCores: 3,
          bp: 4000,
        },
      ],
      symbolColors: ["guide"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。（ボイドからコア1個を自分のカウントエリアに置く。）",
        "",
        "このカードは、【星霊衣】で自分のスピリットの下に置けない。",
        "",
        "Lv1-Lv2-Lv3",
        "このスピリットによって相手のライフは減らない。",
      ],
      keywordTags: [
        "star_garment",
        "star_garment_cannot_be_under",
        "magic_compatible",
      ],
      tribe: "星霊",
      image: "images/BSFT01-TR13(B).webp",
      rarity: "TR",
      pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
      cardNo: "BSFT01-TR13(B)",
      effects: [
        // [0] 裏返ったとき、フィールドに残りカウント+1 — この行はルール
        //   (08a_advent-rebirth-contract.md §2 手順3、効果ではない)。executeRebirth が
        //   countValue+1 を適用済みのため effects に書かない (効果化すると二重計上＋
        //   効果無効の影響を受ける)。
        // [2] 【星霊衣】で自分のスピリット下に置けない。
        //   keywordTags:star_garment_cannot_be_under で place/swap 側が拒否する。
        // [5] Lv1-Lv3 このスピリットによって相手のライフは減らない。
        // attackerSelf 付き life_damage_interception(replace): TR02(B)[7] と同型の自己防止。
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "life_damage_interception",
                player: "opponent",
                cause: "any",
                mode: "replace",
                attackerSelf: true,
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [5],
        },
      ],
    },
  },
  {
    cardNo: "BSFT01-X01",
    orikaId: 393,
    orikaIndex: 410,
    name: "星霊王",
    printedCategory: "ultimate",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 12,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 20000,
      },
      {
        level: 4,
        requiredCores: 2,
        bp: 30000,
      },
    ],
    symbolColors: [
      "ultimate_symbol",
      "ultimate_symbol",
      "ultimate_symbol",
      "ultimate_symbol",
      "ultimate_symbol",
    ],
    textLines: [
      "《召喚条件：C5以上＆魂状態を含む自分の「ルーシィ」1体以上》",
      "",
      "手札/トラッシュにあるこのカードは、自分のメインステップに、同名の自分のアルティメットがいなければ、合体中の自分の鍵ブレイヴ1つを除外することで、召喚コストすべてを支払ったものとして召喚できる。",
      "",
      "Lv3-Lv4『自分のアタックステップ』",
      "相手は、スタック効果を発揮できず、【煌臨】できない。",
      "",
      "Lv4『このアルティメットのアタック時』",
      "相手のネクサス/創界神ネクサス/創界石ネクサス1つを破壊できる。さらに、相手のスピリット/アルティメット1体を指定してアタックでき、ブロックされたバトルの終了時、このアルティメットは回復できる。",
    ],
    keywordTags: ["advent", "soul_state"],
    tribe: "光導・星霊",
    image: "images/BSFT01-X01.webp",
    rarity: "X",
    pack: "BSFT01 フェアリーテイル-ルーシィ・ハートフィリア-",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0]《召喚条件：C5以上＆魂状態を含む自分の「ルーシィ」1体以上》。declarative summonCondition
    //   （canSummonUltimate が evaluateCondition で宣言前判定。10_rules/04 L190-194）。
    //   C5以上 = count_value self>=5。「魂状態を含む自分の「ルーシィ」」= 通常フィールド ∪ 魂状態
    //   （裁定 2026-06-13・10_rules/08a）。無印スコープは魂状態を数えないため includeSoulState:true で opt-in。
    //   「ルーシィ」=「X」=部分一致 → contains。
    summonCondition: [
      { kind: "count_value", player: "self", min: 5 },
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "ルーシィ" }],
        minCount: 1,
        includeSoulState: true,
      },
    ],
    effects: [
      // [2] 手札/トラッシュにあるこのカードを、自分のメインステップに、同名の自分の
      //   アルティメットがいなければ、合体中の自分の鍵ブレイヴ1つを除外することで召喚コスト
      //   すべてを支払ったものとして召喚できる (engine-alt-cost-summon-multizone)。
      //   Q54 の通常召喚行動許可。通常召喚の宣言時に鍵ブレイヴの除外コストを支払い、
      //   その後に stack window を開き、窓後に維持コアを配置する。
      //   「同名の自分のアルティメットがいなければ」= field_lacks(cardName:"self",
      //   category:ultimate)。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { zone: ["hand", "trash"] },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            category: ["ultimate"],
            cardName: "self",
          },
        ],
        steps: [
          {
            action: {
              kind: "summon",
              normalActionPermission: true,
              target: { kind: "self" },
            },
          },
        ],
        textRef: [2],
      },
      // 上記通常召喚の宣言時支払い方法: 合体中の自分の鍵ブレイヴ(系統:「鍵」)1体を除外することで
      //   変更後の召喚コスト全額を支払い済みとする。別途の追加支払いは残す。cost_modify +
      //   useCostPayment.exclude(sourceZone:"field", minCount:1) = 除外候補
      //   (合体中の自分の「鍵」系統ブレイヴ)が無ければ上の summon legal action 自体を
      //   出さない(通常コストへのフォールバックなし)。同名の自分のアルティメットがいる間は、
      //   汎用の通常手札召喚経路
      //   (getAvailableHandCardLegalActions) からもこの割引を提示させないため、上の許可
      //   effect と同じ field_lacks condition をここにも付ける。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            category: ["ultimate"],
            cardName: "self",
          },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { additionalCostValue: 0 },
              useCostPayment: {
                kind: "exclude",
                fullCostPaid: true,
                sourceZone: "field",
                maxCount: 1,
                minCount: 1,
                normalActionPermissionEffectIndex: 0,
                filter: {
                  category: ["brave"],
                  combined: true,
                  tribes: ["鍵"],
                },
              },
            },
          },
        ],
        textRef: [2],
      },
      // [4,5] Lv3-Lv4『自分のアタックステップ』相手はスタック効果を発揮できず、煌臨できない。
      //   duration は『自分のアタックステップ中』限定 = step:"attack" whose:"self"。
      //   timingScope と duration の両軸で「自分のアタックステップ中のみ有効」をゲートする
      //   （CE 寿命も attack ステップ終了で自動 purge）。『煌臨できない』= 新設
      //   restrict_advent（ENGINE-restrict-advent、restrict_stack と同型 player-scoped CE。
      //   getAvailableAdventLegalActions が isAdventRestricted で declare_advent legal action
      //   自体を非生成にする）。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [{ kind: "min_level", value: 3 }],
        steps: [
          {
            action: {
              kind: "restrict_stack",
              player: "opponent",
              duration: { scope: "step", whose: "self", step: "attack" },
            },
          },
          {
            action: {
              kind: "restrict_advent",
              player: "opponent",
              duration: { scope: "step", whose: "self", step: "attack" },
            },
          },
        ],
        textRef: [4, 5],
      },
      // [7,8] Lv4アタック時の単一効果。破壊・指定はそれぞれ任意。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "min_level", value: 4 }],
        steps: [
          {
            executionMode: "optional",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: true,
                  targetsGrandstone: true,
                },
                count: 1,
              },
            },
          },
          {
            executionMode: "optional",
            action: {
              kind: "designate_attack",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
          {
            deferTo: "battle_end",
            action: { kind: "noop" },
          },
          {
            condition: [{ kind: "battle_was_blocked" }],
            executionMode: "optional",
            action: { kind: "recover", target: { kind: "self" } },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
];
