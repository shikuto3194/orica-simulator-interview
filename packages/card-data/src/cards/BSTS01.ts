import type { CardDefinition } from "@orica/rules-core";

export const BSTS01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTS01-C01",
    orikaId: 443,
    orikaIndex: 458,
    name: "［受け継いだ想い］リムル=テンペスト",
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
    ],
    printedOverCount: { minCount: 4, bpBonus: 7000 },
    overCount: { minCount: 4, bpBonus: 7000 },
    symbolColors: ["blue"],
    textLines: [
      "フラッシュ【契約煌臨：「リムル=テンペスト」『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの召喚/煌臨時』",
      "自分はデッキの上から2枚ドローできる。ドロー後、自分は手札が5枚以下になるように破棄する。",
      "",
      "【OC条件：カウント4以上】",
      "【OC中】Lv1-Lv2『自分のメインステップ』",
      "〔ターンに1回:同名〕ゲート中に1回、自分のトラッシュにある青のネクサスカード1枚をコストを支払わずに配置できる。",
    ],
    keywordTags: ["advent"],
    tribe: "暴嵐・幽魔",
    image: "images/BSTS01-C01.webp",
    rarity: "C",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「リムル=テンペスト」『自分のターン』】。
    // 煌臨は CardDefinition.adventData で宣言する（08a / Phase C / declare_advent 配線済み）。
    // 『自分のターン』= own_turn。adventVariant: contract。
    // 名前条件「リムル=テンペスト」は AdventCondition.cardNames で表現（engine-drain 型 SSOT 適用）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "リムル=テンペスト" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
    },
    effects: [
      // [3,4] Lv1-Lv2『召喚/煌臨時』デッキ上2枚ドロー（任意）→ドロー後、手札が5枚以下になるよう破棄（強制）。
      //   discard targetHandSize:5 がエンジン配線済み（structured-effect-interpreter.ts effectiveCount =
      //   max(0, handCount - targetHandSize)）。発揮有無は effect.executionMode、
      //   「ドロー後」の依存は conditional_result で表現する。
      {
        timing: { kind: "card_event", event: ["summon", "advent"] },
        executionMode: "optional",
        steps: [
          {
            id: "drew",
            action: { kind: "draw", count: 2 },
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
        textRef: [3, 4],
      },
      // [6,7,8]【OC条件:カウント4以上】【OC中】Lv1-Lv2『自分のメインステップ』〔ターンに1回:同名〕
      //   自分のトラッシュの青のネクサスカード1枚をコストを支払わず配置（任意）。
      //   トラッシュ→フィールド配置は search_zone(zone:trash, destination:field) で表現（配置時誘発は
      //   呼び出し側差分検出で自動発火）。OC中=カウント4以上を count_value で、自分メインを activated/main で表現。
      // 2026-09-13 ユーザー裁定: 同名ごとターン1回、かつ個体ごとゲーム1回。
      {
        timing: { kind: "activated", mode: "main" },
        condition: [{ kind: "count_value", player: "self", min: 4 }],
        usageLimit: [
          { kind: "per_card_name", duration: "turn" },
          { kind: "per_instance", duration: "game" },
        ],
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: { category: ["nexus"], colors: ["blue"] },
              count: 1,
              mandatory: true,
              destination: "field",
            },
          },
        ],
        textRef: [6, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSTS01-C02",
    orikaId: 444,
    orikaIndex: 459,
    name: "［警備隊隊長］リグル",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["green"],
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
    symbolColors: ["green"],
    textLines: [
      "このカード/スピリットのシンボル/軽減シンボルは青としても扱う。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "ボイドからコア1個ずつをこのスピリットと自分のトラッシュに置ける。",
      "",
      "Lv1-Lv2",
      "〔ターンに1回:同名〕このスピリットが相手によってフィールドを離れるとき、自分のトラッシュの《ソウルコア》以外のコア3個を自分のリザーブに置ける。",
    ],
    keywordTags: [],
    tribe: "暴嵐・華兵",
    image: "images/BSTS01-C02.webp",
    rarity: "C",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/スピリットのシンボル/軽減シンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] Lv1-Lv2『召喚時』ボイドからコア1個ずつをこのスピリットと自分のトラッシュに置ける（任意）。
      // 「1個ずつを A と B に」= void→this_card 1 + void→trash 1 の同時実行。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "this_card" },
              amount: 1,
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "trash", player: "self" },
              amount: 1,
            },
            connector: "simultaneous",
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv1-Lv2〔ターンに1回:同名〕このスピリットが相手によってフィールドを離れるとき、
      // 自分のトラッシュの《ソウルコア》以外のコア3個を自分のリザーブに置ける（任意）。
      // 「相手によって」= cause:['opponent_effect','battle'] (memory project_core_removal_vanish_opponent_cause:
      // バトル原因も「相手による」に含む)。trash→reserve は effectKind 省略時も
      // handleTrashToReserve が汎用フォールバック (moveNormalCores、ソウル不可侵) に委譲する
      // ため実害は無いが (soul-core-exclusion-scan.mjs 監査対応)、印字の「《ソウルコア》以外」を
      // 明示するため effectKind:"normal_only" を付与する。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 3,
              effectKind: "normal_only",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTS01-C03",
    orikaId: 445,
    orikaIndex: 460,
    name: "［行政担当］リグルド",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["green", "green"],
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
    symbolColors: ["green"],
    textLines: [
      "このカード/スピリットのシンボル/軽減シンボルは青としても扱う。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分のデッキの上から3枚内容を見れる。それらのカードを好きなようにデッキの上か下に戻す。",
      "",
      "Lv1-Lv2",
      "〔ターンに1回:同名〕自分の「カウント+効果」で増やすカウントを+1する。",
    ],
    keywordTags: [],
    tribe: "暴嵐・華兵",
    image: "images/BSTS01-C03.webp",
    rarity: "C",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/スピリットのシンボル/軽減シンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      // [3,4] Lv1-Lv2『召喚時』デッキ上3枚の内容を見れる→好きなようにデッキの上か下に戻す（任意）。
      // 手札追加を伴わない閲覧＋上/下への並べ替えは deck_reveal(picks:[], remainder:player_choice)
      // （BSTH01 picks:[] precedent）で表現。
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
              picks: [],
              remainder: "top_bottom_split",
              revealTo: "self",
            },
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv1-Lv2〔ターンに1回:同名〕自分の「カウント+効果」で増やすカウントを+1する。
      //   count_gain_modifier 継続効果として登録し、executeCountIncrease がそのターン最初に
      //   解決する自分の count_increase 1 件のみへ +1 を自動加算する（終止形=強制 /
      //   〔ターンに1回:同名〕は first-opportunity 消費 / 範囲=自分の count_increase 全般）。
      //   裁定: 10_rules/08a §カウント＋ メタ修飾（裁定 2026-06-14, 案A）。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "count_gain_modifier",
              player: "self",
              amount: 1,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTS01-C04",
    orikaId: 446,
    orikaIndex: 461,
    name: "ゴブタ",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["green", "green"],
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
    symbolColors: ["green"],
    textLines: [
      "このカード/スピリットのシンボル/軽減シンボルは青としても扱う。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分はデッキの上から2枚ドローできる。ドロー後、自分は手札2枚を破棄する。",
      "",
      "Lv2『このスピリットのアタック/ブロック時』",
      "手札にある系統：「剣獣」を持つスピリットカード1枚を軽減シンボルすべてを満たして召喚できる。",
    ],
    keywordTags: [],
    tribe: "暴嵐・華兵",
    image: "images/BSTS01-C04.webp",
    rarity: "C",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/スピリットのシンボル/軽減シンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] 召喚時: 2ドローできる。ドロー後、手札2枚を破棄する。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            id: "drew",
            action: { kind: "draw", count: 2 },
          },
          {
            action: { kind: "discard", player: "self", count: 2 },
            connector: "conditional_result",
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv2 アタック/ブロック時: 手札の剣獣スピリット1枚を軽減全充足で召喚。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                filter: { category: ["spirit"], tribes: ["剣獣"] },
                count: 1,
              },
              costModifier: "full_reduction",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTS01-C05",
    orikaId: 447,
    orikaIndex: 462,
    name: "ジュラ・テンペスト連邦国",
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
    symbolColors: ["blue"],
    textLines: [
      "Lv1-Lv2",
      "相手のトラッシュにあるカードすべては、相手の効果を受けず、その効果を使えない。",
      "",
      "Lv1-Lv2『このネクサスの配置時』",
      "トラッシュ/魂状態の契約カードの「リムル=テンペスト」1枚をコストを支払わずに召喚できる。",
      "",
      "Lv2",
      "自分の手札は5枚以下の間、相手の効果を受けない。",
    ],
    keywordTags: ["soul_state"],
    tribe: "暴嵐",
    image: "images/BSTS01-C05.webp",
    rarity: "C",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] 相手トラッシュのカードは相手効果を受けず、効果を使えない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {},
                count: "all",
                zone: ["trash"],
              },
              sourcePlayerScope: "self",
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "restrict_use",
              player: "opponent",
              filter: { zone: ["trash"] },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] 配置時: トラッシュ/魂状態の契約「リムル=テンペスト」をコストなし召喚。
      // 召喚元の違いは同じ候補集合に含め、効果分岐を作らない。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "trash",
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  cardName: { contains: "リムル=テンペスト" },
                  isContract: true,
                },
                count: 1,
                includeSoulState: true,
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [3, 4],
      },
      // [6,7] Lv2: 自分の手札は5枚以下の間、相手の効果を受けない。
      // effect_immunity(target.zone:[hand], count:all) = ゾーン単位免疫
      // (ENGINE-effect-immunity-hand-zone-scope、BSTH02.7-C03 で実装した primitive を流用)。
      {
        timing: { kind: "continuous" },
        condition: [
          { kind: "min_level", value: 2 },
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
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTS01-C06",
    orikaId: 448,
    orikaIndex: 463,
    name: "ユニークスキル『大賢者』",
    printedCategory: "magic",
    colors: ["red", "purple", "green", "white", "yellow", "blue"],
    cost: 4,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "【ミラージュ：コスト2（このカードは手札からセットできる）】",
      "",
      "【セット中】『自分のメインステップ』",
      "〔ターンに1回:同名〕相手の手札2枚の内容を見れる。",
      "",
      "メイン",
      "自分はデッキの上から3枚ドローする。ドロー後、手札が5枚以下になるように破棄する。",
    ],
    keywordTags: [],
    tribe: "暴嵐",
    image: "images/BSTS01-C06.webp",
    rarity: "C",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    mirageData: { cost: 2, reduction: [] },
    // [0]【ミラージュ：コスト2（このカードは手札からセットできる）】= mirageData 宣言。
    // [2,3]【セット中】『自分のメインステップ』〔ターンに1回:同名〕相手の手札2枚の内容を見れる。
    //   applicability.zone:"mirage_set" により、セット中のミラージュゾーンからだけ起動する。
    // [5,6] メイン: デッキ上3枚ドロー（強制）→ドロー後、手札が5枚以下になるよう破棄（強制）。
    //   discard targetHandSize:5 がエンジン配線済みのため忠実に表現する。マジックの「メイン」は
    //   activated/main 効果として通常使用経路に乗る。
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        applicability: { zone: "mirage_set" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "reveal_hand",
              player: "opponent",
              revealTo: "self",
              count: 2,
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "draw", count: 3 } },
          {
            action: {
              kind: "discard",
              player: "self",
              count: -1,
              targetHandSize: 5,
            },
            connector: "sequential",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTS01-CX01",
    orikaId: 449,
    orikaIndex: 464,
    name: "リムル=テンペスト",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 2,
    reductionSymbols: ["six"],
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
    symbolColors: ["blue"],
    textLines: [
      "魂状態のこのカードには【契約煌臨】できる。このとき、煌臨するカードに自分のフィールド/リザーブのコアを好きなだけ置く。",
      "",
      "ゲーム開始時、自分がこのカードと契約しているとき、このゲームの間、自分は、系統：「暴嵐」を持たないカードを召喚/煌臨/配置できず、出せない。",
      "",
      "【魂状態】/【契約煌臨元】/【スピリット】Lv1-Lv2",
      "〔重複不可〕このスピリットの召喚以外で系統「暴嵐」を持つ自分のカードを召喚/煌臨/配置したとき、自分のカウント+1する。",
      "",
      "【契約煌臨元】/【スピリット】Lv1-Lv2『自分のターン』",
      "〔重複不可〕この「リムル」の効果で自分のカウントが増えたとき、自分はデッキの上から1枚ドローできる。ドロー後、自分は手札が5枚以下になるように破棄する。",
    ],
    keywordTags: ["soul_state", "contract"],
    tribe: "暴嵐・幽魔",
    image: "images/BSTS01-CX01.webp",
    rarity: "CX",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    // 契約カード。[2]/[4,5,6]/[7,8] は実装済み、[0] は engine intrinsic で解消。
    // [0]「魂状態のこのカードには【契約煌臨】できる。このとき、煌臨するカードに自分のフィールド/
    //   リザーブのコアを好きなだけ置く」= 契約煌臨の被煌臨側（このカードを煌臨元にする側）。
    //   被煌臨の宣言は declare_advent main 配線済みで、契約煌臨カードの adventData +
    //   getContractAdventTargets が魂状態の契約「リムル=テンペスト」を煌臨先に含めるため production で
    //   機能する。煌臨時の任意コア配置は契約煌臨で魂状態へ煌臨したときの intrinsic 処理
    //   として engine 側で表現される（このカード自身は煌臨しないので adventData 不要）。
    // [2]「ゲーム開始時、自分がこのカードと契約しているとき、このゲームの間、自分は、系統：
    //   「暴嵐」を持たないカードを召喚/煌臨/配置できず、出せない」= 実装済み。
    //   game_event(game_start) + restrict_use(duration:permanent, exclude 暴嵐)。
    // [4,5,6]【魂状態】/【契約煌臨元】/【スピリット】〔重複不可〕「このスピリットの召喚以外で系統
    //   「暴嵐」を持つ自分のカードを召喚/煌臨/配置したとき、自分のカウント+1」= 実装済み。
    //   game_event(self, [summon,advent,place], triggerFilter tribes:[暴嵐]) + count_increase。
    //   「このスピリットの召喚以外で」= excludeTriggerSelf:true（model.ts game_event Timing）で
    //   イベントを起こしたカードがこのリスナー自身の instance なら誘発しない（自召喚で誤発火しない）。
    // [7,8]【契約煌臨元】/【スピリット】Lv1-Lv2『自分のターン』〔重複不可〕「この『リムル』の
    //   効果で自分のカウントが増えたとき、デッキ上1枚ドロー→手札5枚以下になるよう破棄」
    //   = 実装済み。状態ORは engine の ConditionClause に OR を足さず、同一処理を
    //   契約煌臨元版 / フィールドスピリット版の2 effect に分ける。
    //   - 「この『リムル』の効果で」= requireTriggerSelf:true（game_event Timing）で
    //     count_increase event.relatedInstanceId (= causedBySourceInstanceId) が
    //     listener 自身の instance と一致する場合のみ反応 (自己ソース帰属)。
    //   - 【契約煌臨元】版 = applicability.zone: advent_source
    //     （collectUnderCardScopeIds SSOT、自身が他カードの underCards role='advent_source'
    //     に登録されている間のみ true）。【スピリット】Lv1-Lv2 版 = self_state:on_field
    //     + min_level:1。
    //   - 「『自分のターン』〔重複不可〕」= timingScope:turn(self) + usageLimit:no_duplicate。
    //   - 「デッキ上1枚ドロー」= draw, 「手札が5枚以下になるよう破棄」= discard targetHandSize:5。
    effects: [
      {
        // [0]「魂状態のこのカードには【契約煌臨】できる。このとき、煌臨するカードに自分の
        //   フィールド/リザーブのコアを好きなだけ置く」。被煌臨側の宣言は declare_advent main
        //   配線済み（魂状態の契約「リムル=テンペスト」を煌臨先に含む）。煌臨時の任意コア配置は
        //   契約煌臨で魂状態へ煌臨したときの intrinsic 処理として engine 側で表現される
        //   （legal-actions-apply: buildChargeCoresPendingCoreDistribution、08a:180）。
        //   このカード自身は煌臨しないので adventData/steps 不要。textRef のみで帰属。
        timing: { kind: "continuous" },
        steps: [],
        textRef: [0],
      },
      {
        // [2] ゲーム開始時、非暴嵐カードの召喚/煌臨/配置をこのゲーム中禁止。
        timing: { kind: "game_event", player: "self", event: "game_start" },
        condition: [{ kind: "owns_contract_card", player: "self" }],
        steps: [
          {
            action: {
              kind: "restrict_use",
              player: "self",
              filter: { exclude: { tribes: ["暴嵐"] } },
              restrictedKinds: [
                "summon",
                "place_nexus",
                "advent",
                "put_on_field",
              ],
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [2],
      },
      {
        applicability: {
          zone: ["field", "soul_state", "advent_source"],
          adventSourceHostVariants: ["contract", "f_contract"],
        },
        // [4,5,6]〔重複不可〕召喚以外で系統「暴嵐」を召喚/煌臨/配置でカウント+1。
        // 「このスピリットの召喚以外で」= excludeTriggerSelf:true で自カード自身の
        // 召喚/煌臨/配置を除外（自召喚で誤発火させない）。
        timing: {
          kind: "game_event",
          player: "self",
          event: ["summon", "advent", "place"],
          triggerFilter: { tribes: ["暴嵐"] },
          excludeTriggerSelf: true,
        },
        usageLimit: { kind: "no_duplicate" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [4, 5],
      },
      {
        applicability: {
          zone: "advent_source",
          adventSourceHostVariants: ["contract", "f_contract"],
        },
        // [7,8]【契約煌臨元】『自分のターン』〔重複不可〕リムルの効果でカウント増→ドロー→手札5枚以下破棄。
        // requireTriggerSelf:true で count_increase の発生源が listener 自身（このリムル）
        // である場合のみ反応（自己ソース帰属）。applicability で【契約煌臨元】の
        // 「煌臨元の間」継続ゲート（自身が他カードの advent_source 役にある間のみ true）。
        timing: {
          kind: "game_event",
          player: "self",
          event: "count_increase",
          requireTriggerSelf: true,
        },
        timingScope: { player: "self", period: "turn" },
        usageLimit: { kind: "no_duplicate" },
        executionMode: "optional",
        steps: [
          { action: { kind: "draw", player: "self", count: 1 } },
          {
            action: {
              kind: "discard",
              player: "self",
              count: -1,
              targetHandSize: 5,
            },
          },
        ],
        textRef: [7, 8],
      },
      {
        applicability: { adventSourceHostVariants: ["contract", "f_contract"] },
        // [7,8]【スピリット】Lv1-Lv2『自分のターン』〔重複不可〕。
        // 上の【契約煌臨元】版と同一処理だが、フィールド上の通常スピリット状態でも発揮する。
        timing: {
          kind: "game_event",
          player: "self",
          event: "count_increase",
          requireTriggerSelf: true,
        },
        timingScope: { player: "self", period: "turn" },
        usageLimit: { kind: "no_duplicate" },
        executionMode: "optional",
        condition: [
          { kind: "self_state", state: "on_field" },
          { kind: "min_level", value: 1 },
        ],
        steps: [
          { action: { kind: "draw", player: "self", count: 1 } },
          {
            action: {
              kind: "discard",
              player: "self",
              count: -1,
              targetHandSize: 5,
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSTS01-M01",
    orikaId: 450,
    orikaIndex: 465,
    name: "［黒風星狼］ランガ",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 6,
    reductionSymbols: ["green", "green", "green", "green"],
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
    ],
    symbolColors: ["green"],
    textLines: [
      "このカード/スピリットのシンボル/軽減シンボルは青としても扱う。",
      "",
      "〔ゲームに1回:同名〕手札にあるこのカードは、バースト条件を満たしたとき、自分のカウント5以上なら発動できる。",
      "",
      "【バースト:相手のスピリット/アルティメットのアタック後】",
      "相手のスピリット/アルティメット2体を手元に置く。この効果発揮後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2『このスピリットの召喚/アタック時』",
      "ターンに1回、相手の手元のカード1枚を除外できる。さらに、魂状態を含む自分の「リムル」/「ゴブタ」がいるとき、ボイドからコア2個をこのスピリットに置ける。",
    ],
    keywordTags: ["burst", "soul_state"],
    tribe: "暴嵐・剣獣",
    image: "images/BSTS01-M01.webp",
    rarity: "M",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/スピリットのシンボル/軽減シンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      // [2]〔ゲームに1回:同名〕「手札にあるこのカードは、バースト条件を満たしたとき、
      //   自分のカウント5以上なら発動できる」= 手札からの直接バースト発動（裁定 2026-06-16,
      //   10_rules/04b §手札からの直接バースト発動）。バーストエリア事前セットを経ず、手札の
      //   このカードを直接バーストとして発動する。timing.handSource:true で発動源を手札ゾーンに
      //   許可し、handSourceCondition（カウント5以上）を発動宣言時に評価する。発動後はバースト
      //   効果本体（[4,5] と同じ bounce→自己召喚）でフィールドへ出る。
      //   ［ゲームに1回:同名］= per_card_name / duration:"game"。トリガー・steps は [4,5] と同一。
      {
        timing: {
          kind: "burst",
          trigger: "相手のスピリット／アルティメットのアタック後",
          handSource: true,
          handSourceCondition: [
            { kind: "count_value", player: "self", min: 5 },
          ],
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "game",
          maxCount: 1,
        },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 2,
              },
              destination: "set_aside",
            },
          },
          {
            connector: "after_triggers",
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
          },
        ],
        textRef: [2],
      },
      // [4,5]【バースト:相手のスピリット/アルティメットのアタック後】
      //   相手のスピリット/アルティメット2体を手元に置く→この効果発揮後、このカードをコストなし召喚。
      //   バースト「アタック後」トリガーは文字列で attack_after にマップされ engine が発火する
      //   （structured-effect-registrations.ts mapBurstTriggerToEventKind L377 / legal-actions-apply
      //   attack_after 経路）。「手元に置く」はフィールド→手元(set_aside)への移動 = bounce の移動先差
      //   （SBR バウンスは手札/デッキ/手元。10_rules/04_state-based-rules.md）。
      //   bounce destination:"set_aside" で表現し、続けて自カードのコストなし召喚を行う。
      {
        timing: {
          kind: "burst",
          trigger: "相手のスピリット／アルティメットのアタック後",
        },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 2,
              },
              destination: "set_aside",
            },
          },
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
          },
        ],
        textRef: [4, 5],
      },
      // [7,8] Lv1-Lv2『召喚/アタック時』ターンに1回、相手の手元のカード1枚を除外できる。
      //   さらに、魂状態を含む自分の「リムル」/「ゴブタ」がいるとき、ボイドからコア2個をこのスピリットに置ける。
      //   「相手の手元」= set_aside ゾーン対象の remove_from_game（zone:set_aside、BSLH01 の zone:trash と同経路）。
      //   後段の「さらに」(simultaneous) は field_has(self, cardNames リムル/ゴブタ、含む=部分一致) でゲート。
      //   「魂状態を含む」= 通常フィールド ∪ 魂状態（裁定 2026-06-13・10_rules/08a）。無印 field_has は魂状態
      //   （soulStateInstanceIds）を数えないため includeSoulState:true で opt-in し、void→this_card 2 を任意付与する。
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
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {},
                count: 1,
                zone: "set_aside",
              },
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
                kind: "this_card",
              },
              amount: 2,
            },
            executionMode: "optional",
            connector: "simultaneous",
            condition: [
              {
                kind: "field_has",
                player: "self",
                cardNames: [
                  {
                    contains: "リムル",
                  },
                  {
                    contains: "ゴブタ",
                  },
                ],
                includeSoulState: true,
              },
            ],
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSTS01-M02",
    orikaId: 451,
    orikaIndex: 466,
    name: "［侍大将］ベニマル",
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
        bp: 11000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 15000,
      },
    ],
    symbolColors: ["red", "red"],
    textLines: [
      "このカード/スピリットのシンボル/軽減シンボルは青としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "BP20000以下の相手のスピリット/アルティメット1体と相手のネクサス1つを破壊でき、それらの効果を発揮させない。",
      "",
      "Lv2-Lv3『自分のアタックステップ』",
      "〔重複不可〕自分の効果で相手のスピリット/アルティメット/ネクサスがフィールドを離れるとき、相手のライフのコア1個をリザーブに置ける。",
    ],
    keywordTags: [],
    tribe: "暴嵐・呪鬼",
    image: "images/BSTS01-M02.webp",
    rarity: "M",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/スピリットのシンボル/軽減シンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] Lv1-Lv2-Lv3『召喚/アタック時』BP20000以下の相手スピリット/アルティメット1体と
      //   相手のネクサス1つを破壊でき、それらの効果を発揮させない。
      //   別カテゴリの2対象＝2つの destroy（simultaneous）。「それらの効果を発揮させない」=
      //   suppressDestroyedEffects:"destroyed_only"（破壊カード自身の効果のみ抑制）。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"], maxBp: 20000 },
                count: 1,
              },
              suppressDestroyedEffects: "destroyed_only",
            },
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"] },
                count: 1,
              },
              suppressDestroyedEffects: "destroyed_only",
            },
            connector: "simultaneous",
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv2-Lv3『自分のアタックステップ』〔重複不可〕自分の効果で相手のスピリット/アルティメット/
      //   ネクサスがフィールドを離れるとき、相手のライフのコア1個をリザーブに置ける。
      //   「自分の効果で相手が離れるとき」= 離れるカードの controller (opponent) 視点で cause=opponent_effect。
      //   trigger-system は離脱カード controller を基準に cause を正規化するため、自分(ALICE)の効果による
      //   相手(BOB)カードの離脱は対象カード視点で opponent_effect になる (verifier round 12 指摘 2026-06-21)。
      //   leave_field は game_event で対応（registrations META leave_field cardEvent:true）、cause 絞り込みも配線済み。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "leave_field",
          cause: "opponent_effect",
          triggerFilter: { category: ["spirit", "ultimate", "nexus"] },
          sourceWhose: "either",
        },
        condition: [{ kind: "min_level", value: 2 }],
        timingScope: { player: "self", period: "attack" },
        executionMode: "optional",
        usageLimit: { kind: "no_duplicate" },
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
    cardNo: "BSTS01-M03",
    orikaId: 452,
    orikaIndex: 467,
    name: "［鬼神］シオン",
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
      "このカード/スピリットのシンボル/軽減シンボルは青としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "〔ターンに1回:同名〕自分のアルティメットの「リムル」がいるとき、相手のスピリット/アルティメットのコア3個をトラッシュに置ける。",
      "",
      "Lv2-Lv3『自分のアタックステップ』",
      "〔重複不可〕相手はフィールド/リザーブのコア1個をトラッシュに置かなければ、フラッシュ/スタック効果を発揮できない。",
    ],
    keywordTags: [],
    tribe: "暴嵐・呪鬼",
    image: "images/BSTS01-M03.webp",
    rarity: "M",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/スピリットのシンボル/軽減シンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      // [3,4] Lv1-Lv2-Lv3『召喚/アタック時』〔ターンに1回:同名〕自分のアルティメットの「リムル」が
      //   いるとき、相手のスピリット/アルティメットのコア3個をトラッシュに置ける。
      //   コア除去対象を spirit/ult に限定: core_move の field 源 ({kind:"field"}) に
      //   filter:{category:["spirit","ultimate"]} を渡す（engine batch2-5、coreshoot 対象限定）。
      //   ネクサスのコアは候補から除外される。「置ける」= optional。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["ultimate"],
            cardNames: [{ contains: "リムル" }],
          },
        ],
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
              },
              to: { kind: "trash", player: "opponent" },
              amount: 3,
            },
          },
        ],
        textRef: [2, 3],
      },
      // [6,7] Lv2-Lv3『自分のアタックステップ』〔重複不可〕相手はフィールド/リザーブのコア1個を
      //   トラッシュに置かなければ、フラッシュ/スタック効果を発揮できない。
      //   10_rules/03c §「○○しなければ△△を発揮できない」: これは追加コスト(pay-to-act)ではなく、
      //   相手のフラッシュ/スタック効果を解決する直前(対象選択前)に相手へコア除去(移動)を課す
      //   継続ゲート効果。耐性が効くので gate_flash_stack_core CE で表現する（コスト経路でない）。
      //   〔重複不可〕= no_duplicate は同名ゲートの重複登録のみ抑止（別カード名は各加算）。
      //   Lv2-Lv3 = condition min_level 2 で rebuild add/remove。『自分のアタックステップ』=
      //   timingScope self/attack（発揮解決時に isCEActiveForScope で動的判定）。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        timingScope: { player: "self", period: "attack" },
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "gate_flash_stack_core",
              player: "opponent",
              source: ["field", "reserve"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTS01-R01",
    orikaId: 453,
    orikaIndex: 468,
    name: "［姫巫女］シュナ",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 5,
    reductionSymbols: ["yellow", "yellow", "yellow"],
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
        requiredCores: 5,
        bp: 9000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "このカード/スピリットのシンボル/軽減シンボルは青としても扱う。",
      "",
      "Lv1-Lv2-Lv3",
      "系統：「呪鬼」/「暴嵐」を持つ自分のスピリット/アルティメットは相手の効果でコアが1個より少なくならない。",
      "",
      "Lv2-Lv3",
      "系統：「呪鬼」/「暴嵐」を持つ自分のスピリット/アルティメットは相手の効果でフィールドから手札/手元/デッキに戻らない。",
      "",
      "Lv3",
      "系統：「呪鬼」/「暴嵐」を持つ自分のスピリット/アルティメットは相手の効果で破壊されない。",
    ],
    keywordTags: [],
    tribe: "暴嵐・呪鬼",
    image: "images/BSTS01-R01.webp",
    rarity: "R",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/スピリットのシンボル/軽減シンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] 呪鬼/暴嵐の自分スピリット/アルティメットは相手効果でコア1個未満にならない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "filter",
                player: "self",
                // category は filterOr の各枝内へ複製する。matchesCardFilter の filterOr 分岐
                // (card-filter.ts:397-439) は各 sub を outer フィールドとマージせず単独評価するため、
                // outer sibling に置くと無視され非spirit/ultimateまで対象化してしまう
                // (BSTH004-X03 で発見・修正した同型バグ)。
                filter: {
                  filterOr: [
                    { category: ["spirit", "ultimate"], tribes: ["呪鬼"] },
                    { category: ["spirit", "ultimate"], tribes: ["暴嵐"] },
                  ],
                },
                count: "all",
              },
              resistsOutcome: "core_below_min",
              source: "opponent_effect",
              coreMinimum: 1,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv2-Lv3: 呪鬼/暴嵐の自分スピリット/アルティメットは相手効果で手札/手元/デッキに戻らない。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "filter",
                player: "self",
                // category は filterOr の各枝内へ複製する。matchesCardFilter の filterOr 分岐
                // (card-filter.ts:397-439) は各 sub を outer フィールドとマージせず単独評価するため、
                // outer sibling に置くと無視され非spirit/ultimateまで対象化してしまう
                // (BSTH004-X03 で発見・修正した同型バグ)。
                filter: {
                  filterOr: [
                    { category: ["spirit", "ultimate"], tribes: ["呪鬼"] },
                    { category: ["spirit", "ultimate"], tribes: ["暴嵐"] },
                  ],
                },
                count: "all",
              },
              resistsOutcome: ["bounce", "send_to_deck"],
              source: "opponent_effect",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
      // [8,9] Lv3: 呪鬼/暴嵐の自分スピリット/アルティメットは相手効果で破壊されない。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 3 }],
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "filter",
                player: "self",
                // category は filterOr の各枝内へ複製する。matchesCardFilter の filterOr 分岐
                // (card-filter.ts:397-439) は各 sub を outer フィールドとマージせず単独評価するため、
                // outer sibling に置くと無視され非spirit/ultimateまで対象化してしまう
                // (BSTH004-X03 で発見・修正した同型バグ)。
                filter: {
                  filterOr: [
                    { category: ["spirit", "ultimate"], tribes: ["呪鬼"] },
                    { category: ["spirit", "ultimate"], tribes: ["暴嵐"] },
                  ],
                },
                count: "all",
              },
              resistsOutcome: "destroy",
              source: "opponent_effect",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSTS01-R02",
    orikaId: 454,
    orikaIndex: 469,
    name: "［隠密統領］ソウエイ",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 6,
    reductionSymbols: ["blue", "blue", "blue", "blue", "blue"],
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
        bp: 11000,
      },
    ],
    symbolColors: ["blue"],
    textLines: [
      "【バースト:相手の効果によって相手の手札が増えた後】",
      "ボイドからコア2個を自分のリザーブに置く。この効果発揮後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分はデッキの上から2枚ドローできる。ドロー後、手札1枚を破棄する。",
      "",
      "Lv2-Lv3 フラッシュ/スタック『お互いのアタックステップ』",
      "ターンに1回、自分のスピリット/アルティメット1体を回復できる。",
    ],
    keywordTags: ["burst"],
    tribe: "暴嵐・呪鬼",
    image: "images/BSTS01-R02.webp",
    rarity: "R",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1]【バースト:相手の効果によって相手の手札が増えた後】ボイドからコア2個を自分のリザーブに置く→
      //   この効果発揮後、このカードをコストなし召喚。
      //   「相手の効果によって相手の手札が増えた後」= hand_increase バースト（文字列「手札...増え」が
      //   hand_increase にマップ、whose=opponent）。engine 配線済み（trigger-system hand_increase）。
      {
        timing: {
          kind: "burst",
          trigger: "相手の効果によって相手の手札が増えた後",
        },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: 2,
            },
          },
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
            connector: "after_triggers",
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv1-Lv2-Lv3『召喚時』デッキ上2枚ドロー（任意）→手札1枚を破棄（固定枚数）。
      // 固定 count:1 の破棄なので targetHandSize 不要で忠実に表現できる。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          { action: { kind: "draw", count: 2 } },
          {
            action: { kind: "discard", player: "self", count: 1 },
            connector: "sequential",
          },
        ],
        textRef: [3, 4],
      },
      // [6,7] Lv2-Lv3 フラッシュ/スタック『お互いのアタックステップ』ターンに1回、自分のスピリット/
      //   アルティメット1体を回復できる。
      //   activated mode は単一値のため「フラッシュ/スタック」はモード別に2効果へ展開し、
      //   「ターンに1回」を limitGroupId で両モード共有させる（どちらで撃ってもターン1回）。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [{ kind: "min_level", value: 2 }],
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        limitGroupId: "BSTS01-R02-recover",
        steps: [
          {
            action: {
              kind: "recover",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [6, 7],
      },
      {
        timing: { kind: "activated", mode: "stack" },
        condition: [{ kind: "min_level", value: 2 }],
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        limitGroupId: "BSTS01-R02-recover",
        steps: [
          {
            action: {
              kind: "recover",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTS01-R03",
    orikaId: 455,
    orikaIndex: 470,
    name: "アルティメットスキル『暴食之王』",
    printedCategory: "magic",
    colors: ["blue", "blue"],
    cost: 6,
    reductionSymbols: ["blue", "blue", "ultimate_symbol", "ultimate_symbol"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "手札にあるこのカードは、相手によって自分のライフが減ったとき、コストを支払わずに使用できる。",
      "",
      "フラッシュ",
      "相手のスピリット/アルティメット1体を消滅させ、その効果を発揮させない。消滅する対象のコアすべてはリザーブに置かれる。この効果でブレイヴはフィールドに残せない。",
    ],
    keywordTags: [],
    tribe: "暴嵐",
    image: "images/BSTS01-R03.webp",
    rarity: "R",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] ENGINE-conditional-free-magic-use-on-event: 手札にあるこのカードは、相手によって
      // 自分のライフが減ったとき、コストを支払わずに使用できる。先例 BSTH02.7-TX01(A)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "reduce_life",
          cause: ["opponent_effect", "battle"],
        },
        applicability: { zone: "hand" },
        executionMode: "optional",
        steps: [
          {
            action: { kind: "use_magic_without_cost", magicTiming: "flash" },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ: 相手のスピリット/アルティメット1体を消滅させ、その効果を発揮させない。
      //   消滅する対象のコアすべてはリザーブに置かれる。この効果でブレイヴはフィールドに残せない。
      //   vanish はルール上コア→リザーブが既定（structured-effect-interpreter.ts L3831「消滅（コアは
      //   リザーブに置かれる）」）なので「コアすべてはリザーブに置かれる」は忠実。
      {
        timing: { kind: "activated", mode: "flash" },
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
              // 「その効果を発揮させない」= 消滅対象の離脱誘発効果を抑止（Q19/P3-74）。
              suppressDestroyedEffects: "destroyed_only",
              // 「この効果でブレイヴはフィールドに残せない」= 消滅対象が合体スピリットのとき
              //   ブレイヴ残存（10_rules/05 選択肢1）を禁じ、ブレイヴもホストと同じ場所へ移動。
              braveCannotRemain: true,
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTS01-X01",
    orikaId: 456,
    orikaIndex: 471,
    name: "［神之怒］リムル=テンペスト",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 7,
    reductionSymbols: ["blue", "blue", "blue", "blue", "blue", "blue"],
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
    ],
    printedOverCount: { minCount: 5, bpBonus: 9000 },
    overCount: { minCount: 5, bpBonus: 9000 },
    symbolColors: ["blue"],
    textLines: [
      "フラッシュ【契約煌臨：「リムル=テンペスト」&C3以上『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの召喚/煌臨時』",
      "〔ターンに1回:同名〕自分のカウント2につき、本来のコスト8以下の相手のスピリット/アルティメット1体までを破壊できる。この効果で破壊した対象1体につき、自分は、ボイドからコア1個までをリザーブに置き、デッキの上から1枚までドローできる。",
    ],
    keywordTags: ["advent"],
    tribe: "暴嵐・幽魔",
    image: "images/BSTS01-X01.webp",
    rarity: "X",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「リムル=テンペスト」&C3以上『お互いのアタックステップ』】=煌臨宣言。
    // 煌臨は CardDefinition.adventData で宣言する（08a / Phase C / declare_advent 配線済み）。
    // 『お互いのアタックステップ』= both_attack_step。adventVariant: contract。
    // 名前条件「リムル=テンペスト」は cardNames、「C3以上」は
    //   declareCondition count_value で表現（煌臨先コスト条件ではない）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "リムル=テンペスト" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 3 }],
    },
    effects: [
      // [3,4] Lv1-Lv2『召喚/煌臨時』〔ターンに1回:同名〕自分のカウント2につき、本来のコスト8以下の
      //   相手のスピリット/アルティメット1体までを破壊できる。破壊した対象1体につき、ボイドからコア1個
      //   までをリザーブに置き、デッキ上1枚までドローできる。
      //   「カウント2につき1体まで」= 動的*上限*レンジ count:{min:0, max:{source:count_value, divisor:2}}
      //   （資源 = floor(カウント/2)。窓クローズ後の deferred 対象選択で resolveCountBound 数値化、
      //   正源 test: target-count-dynamic-max）。「本来のコスト8以下」= filter.maxCost:8（印字コスト）。
      //   per-target 報酬「破壊1体につき…まで」= 破壊 step に id:"destroyed" を付け、後段の core_move /
      //   draw 量を cards_from_ref(destroyed) で連動（正源 BSSL01 discard→draw / 10_rules cards_from_ref）。
      //   「まで」= optional 各 step。
      {
        timing: { kind: "card_event", event: ["summon", "advent"] },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            id: "destroyed",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxCost: 8,
                  costBasis: "printed",
                },
                count: {
                  min: 0,
                  max: {
                    source: { kind: "count_value", player: "self" },
                    divisor: 2,
                  },
                },
              },
            },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: {
                source: { kind: "cards_from_ref", stepId: "destroyed" },
              },
            },
            executionMode: "optional",
          },
          {
            action: {
              kind: "draw",
              count: {
                source: { kind: "cards_from_ref", stepId: "destroyed" },
              },
            },
            executionMode: "optional",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTS01-X02",
    orikaId: 457,
    orikaIndex: 472,
    name: "［覚醒魔王］リムル=テンペスト",
    printedCategory: "ultimate",
    colors: ["blue"],
    cost: 9,
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
        bp: 14000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 20000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 24000,
      },
    ],
    printedOverCount: { minCount: 8, bpBonus: 12000 },
    overCount: { minCount: 8, bpBonus: 12000 },
    symbolColors: ["ultimate_symbol", "ultimate_symbol", "ultimate_symbol"],
    textLines: [
      "フラッシュ【契約煌臨：「リムル=テンペスト」&C8以上『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリット/アルティメットに手札から重ねる。",
      "",
      "《召喚条件：魂状態を含む自分の「リムル=テンペスト」1枚以上》",
      "",
      "Lv3-Lv4-Lv5『このアルティメットの煌臨時』",
      "〔ターンに1回:同名〕ライフと《ソウルコア》以外の自分のコアすべてをこのアルティメットに置ける。そうしたとき、置いたコア3個につき、トラッシュの系統:「暴嵐」を持つスピリットカード1枚までをコストを支払わずに召喚する。(最大5体)",
      "",
      "Lv3-Lv4-Lv5『このアルティメットのアタック時』",
      "相手のスピリット/アルティメット/ネクサス/創界神ネクサス2つまでを破壊する。自分のカウント10以上で、このアルティメットがLv4以上のとき、この効果は相手の効果では防げない。",
    ],
    keywordTags: ["soul_state", "advent"],
    tribe: "暴嵐・幽魔・魔王",
    image: "images/BSTS01-X02.webp",
    rarity: "X",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【契約煌臨：「リムル=テンペスト」&C8以上『自分のターン』】=煌臨宣言。
    // 煌臨は CardDefinition.adventData で宣言する（08a / Phase C / declare_advent 配線済み）。
    // 『自分のターン』= own_turn。adventVariant: contract。targetCategory は spirit+ultimate
    //   （テキスト[1]「自分のスピリット/アルティメットに重ねる」）。契約煌臨はソウルコアをトラッシュへ
    //   （08a:147-148、テキスト[1]も「トラッシュに置くことで」と明記）→ soulCoreDest: "trash"。
    // 名前条件「リムル=テンペスト」は cardNames、「C8以上」は
    //   declareCondition count_value で表現（煌臨先コスト条件ではない）。
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "リムル=テンペスト" }],
        targetCategory: ["spirit", "ultimate"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 8 }],
    },
    // [3]《召喚条件：魂状態を含む自分の「リムル=テンペスト」1枚以上》。
    //   declarative summonCondition（ConditionClause 配列・canSummonUltimate が evaluateCondition で
    //   宣言前判定。10_rules/04 L190-194）で表現。「リムル=テンペスト」は「X」=部分一致
    //   （[[project_card_name_reference_matching]]）→ contains。「魂状態を含む」= 通常フィールド ∪ 魂状態
    //   （裁定 2026-06-13・10_rules/08a）。魂状態カードは zone:"field" のまま soulStateInstanceIds に入るが、
    //   無印スコープでは数えないため includeSoulState:true で opt-in する。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "リムル=テンペスト" }],
        minCount: 1,
        includeSoulState: true,
      },
    ],
    // [5,6] Lv3-Lv4-Lv5『煌臨時』ライフと《ソウルコア》以外の自分のコアすべてをこのアルティメットに
    //   置ける→置いたコア3個につきトラッシュの「暴嵐」スピリット1枚までをコストなし召喚(最大5)。
    //   non_life_normal_self は reserve/trash/自分field の通常コアだけを source にし、life と soul core は
    //   除外する。移動元・全数・配置先が固定なので選択せず移動し、全数未達なら後段のみ不発。
    //   後段は core_distribute の実配置数 StepResult.numericAmount を step_numeric_amount で読み、
    //   divisor:3 + cap:5 の動的上限として on_step 対象選択に渡す。
    effects: [
      {
        timing: { kind: "card_event", event: "advent" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        condition: [{ kind: "min_level", value: 3 }],
        steps: [
          {
            id: "x02-awaken-core-gather",
            action: {
              kind: "core_distribute",
              from: { kind: "non_life_normal_self" },
              to: { kind: "source_card" },
              amount: "all",
              mode: "player_choice",
              effectKind: "normal_only",
            },
          },
          {
            id: "x02-awaken-tempest-summon",
            connector: "conditional_result",
            targetSelectionTiming: "on_step",
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "trash",
                filter: { category: ["spirit"], tribes: ["暴嵐"] },
                count: {
                  min: 0,
                  max: {
                    source: {
                      kind: "step_numeric_amount",
                      stepId: "x02-awaken-core-gather",
                    },
                    divisor: 3,
                    cap: 5,
                  },
                },
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [5, 6],
      },
      // [8,9] Lv3-Lv4-Lv5『アタック時』相手のスピリット/アルティメット/ネクサス/創界神ネクサス2つまでを破壊。
      //   「2つまで」= count{min:0,max:2}。創界神ネクサスを含むため targetsGrandwalker:true。
      //   後段「自分のカウント10以上で、このアルティメットがLv4以上のとき相手の効果で防げない」=
      //   条件付き防止不可。preventionLevel:"unpreventable" + preventionLevelCondition
      //   （count_value self>=10 ∧ min_level 4）で表現。両条件成立時のみ cannot_*/defense_immune 貫通。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        preventionLevel: "unpreventable",
        preventionLevelCondition: [
          { kind: "count_value", player: "self", min: 10 },
          { kind: "min_level", value: 4 },
        ],
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate", "nexus"],
                  targetsGrandwalker: true,
                },
                count: { min: 0, max: 2 },
              },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSTS01-X03",
    orikaId: 458,
    orikaIndex: 473,
    name: "［暴風竜］ヴェルドラ",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 9,
    reductionSymbols: ["green", "green", "green", "green", "green", "green"],
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
        bp: 19000,
      },
      {
        level: 4,
        requiredCores: 6,
        bp: 25000,
      },
    ],
    symbolColors: ["green", "green"],
    textLines: [
      "このカード/スピリットのシンボル/軽減シンボルは青としても扱う。",
      "",
      "【バースト：相手によって自分のスピリットがフィールドを離れた後】",
      "相手のスピリット/アルティメット2体を重疲労させる。その後、疲労状態のスピリット/アルティメット1体をデッキの下に戻せる。",
      "この効果発揮後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3-Lv4『このスピリットのアタック時』",
      "このスピリットのバースト効果を発揮できる。",
    ],
    keywordTags: ["burst"],
    tribe: "暴嵐・古竜",
    image: "images/BSTS01-X03.webp",
    rarity: "X",
    pack: "BSTS01 転生したらスライムだった件",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] このカード/スピリットのシンボル/軽減シンボルは青としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["symbol", "reduction_symbol"],
              asColor: "blue",
            },
          },
        ],
        textRef: [0],
      },
      // [2,3,4]【バースト：相手によって自分のスピリットがフィールドを離れた後】相手のスピリット/
      //   アルティメット2体を重疲労させる。その後、疲労状態のスピリット/アルティメット1体をデッキの下に
      //   戻せる。この効果発揮後、このカードをコストなし召喚。
      //   トリガー文字列「相手によって自分のスピリットがフィールドを離れた後」は leave_field（「離れ」）
      //   ＋ whose=self（「自分」優先、structured-effect-registrations mapBurstTriggerToWhose）にマップ。
      //   「疲労状態の」送デッキ対象限定は filter.exhaustState:"exhausted" で強制（重疲労も疲労状態に含む）。
      {
        timing: {
          kind: "burst",
          trigger: "相手によって自分のスピリットがフィールドを離れた後",
        },
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
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "either",
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
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
              costModifier: "free",
            },
            connector: "after_triggers",
          },
        ],
        textRef: [2, 3, 4],
      },
      // [6,7] Lv1-Lv2-Lv3-Lv4『このスピリットのアタック時』このスピリットのバースト効果を発揮できる。
      //   「自身のバースト効果を発揮する」= バースト効果の steps をアタック誘発として複製する
      //   （召喚時効果のメイン再発揮と同じく新規 primitive 不要。[[project_summon_effect_reactivation_pattern]]）。
      //   全 Lv 対象なので applicability 不要。executionMode:"optional"（「発揮できる」=任意）。
      //   末尾の summon{self} は本体が既に場にいるため executeSummonSelf の場在チェックで no-op
      //   （structured-effect-interpreter executeSummonSelf: card.zone==="field" で return）。
      {
        timing: {
          kind: "card_event",
          event: "attack",
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
                  category: ["spirit", "ultimate"],
                },
                count: 2,
              },
              degree: "heavy_exhaust",
            },
          },
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "either",
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
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
            },
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
];
