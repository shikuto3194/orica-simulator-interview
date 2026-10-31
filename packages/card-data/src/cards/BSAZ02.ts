import type { CardDefinition } from "@orica/rules-core";

export const BSAZ02_CARDS: CardDefinition[] = [
  {
    cardNo: "BSAZ02-C01",
    orikaId: 324,
    orikaIndex: 338,
    name: "アルギュレ",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 9000,
      },
      {
        level: 4,
        requiredCores: 3,
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
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3-Lv4-Lv5『このアルティメットのアタック/ブロック時』",
      "このアルティメットのBP以下の相手のスピリット/アルティメット1体を破壊する。自分のアタックステップにこの効果で破壊したとき、相手のライフのコア1個をリザーブに置く。これらの効果は相手の効果で防げない。",
      "",
      "Lv3-Lv4-Lv5【一騎打】『相手のアタックステップ開始時』",
      "このアルティメットと相手のスピリット1体のBPを比べ、BPが同じか低いスピリット/アルティメットが破壊され、相手のスピリットだけを破壊したとき、自分はデッキの上から1枚ドローする。",
    ],
    keywordTags: [],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-C01.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0]《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》。declarative summonCondition
    //   （canSummonUltimate が evaluateCondition で宣言前判定、BSFT01-precedent）。
    //   「0体」= exact-zero field_has。minCount 省略時は既定 1
    //   (structured-condition-eval.ts:393 `clause.minCount ?? 1`) となり count=0 で
    //   常に false 化する罠があるため、minCount:0 を明示して指定する。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [2]【アルドノアドライブ：1】host 側キーワード宣言 (engine-aldnoah-drive-under-card-keyword、
    //   BSAZ02-C07/C10 precedent と同型)。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,4,5]【アルドノアドライブ：1】「あるとき」ゲート付き Lv3-Lv4-Lv5『このアルティメットの
      //   アタック時』。「BP以下の相手1体破壊」= maxBpSource:self_effective_bp destroy filter
      //   （BSDB01.ts:88 precedent）。「自分のアタックステップにこの効果で破壊したとき、相手の
      //   ライフのコア1個をリザーブに置く」= destroy 成功(ref_succeeded) ゲートの後続 core_move
      //   （BSDB01.ts:207-215 precedent）。「相手の効果で防げない」= preventionLevel:"unpreventable"
      //   （BSAZ02-M04 precedent、本ファイル内）。ブロック時は同じ破壊のみでコア移動が無いため
      //   effect を分割する（BSDB01-C01 の「毎回発揮」「ターンに1回」分割と同型）。
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { level: { min: 3, max: 5 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        preventionLevel: "unpreventable",
        steps: [
          {
            id: "atk-destroy",
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
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "atk-destroy" },
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
            condition: [{ kind: "turn_player", player: "self" }],
          },
        ],
        textRef: [2, 4, 5],
      },
      // [2,4,5]『このアルティメットのブロック時』の同一破壊（コア移動は付随しない、
      //   attack 版との分割は上記コメント参照）。
      {
        timing: { kind: "card_event", event: "block" },
        applicability: { level: { min: 3, max: 5 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        preventionLevel: "unpreventable",
        steps: [
          {
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
        ],
        textRef: [2, 4, 5],
      },
      // [2,7,8]【一騎打】Lv3-Lv4-Lv5『相手のアタックステップ開始時』。
      //   bp_compare_destroy（源=このアルティメット自身 Pattern1、対象=相手のスピリット1体）。
      //   「相手のスピリットだけを破壊したとき、ドロー1」= 対象が場を離れた (ref_left_field) ∧
      //   源が場に残っている (self_state:"on_field")。相討ち（同値で両破壊）は「だけ」不成立で
      //   除外される。BSKB01-X01 effects[1] が全く同型の precedent
      //   （bskb01-x01-bp-compare-battle-end.test.ts で相手のみ破壊/相討ちの両分岐を検証済み）。
      {
        timing: {
          kind: "phase",
          step: "attack",
          whose: "opponent",
          subPhase: "start",
        },
        applicability: { level: { min: 3, max: 5 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            id: "duel-bp-compare",
            action: {
              kind: "bp_compare_destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
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
                  stepId: "duel-bp-compare",
                  leaveKind: "destroy",
                },
                {
                  kind: "ref_leave_established",
                  stepId: "duel-bp-compare",
                  leaveKind: "destroy",
                  subject: "source",
                  not: true,
                },
              ],
            },
            action: { kind: "draw", count: 1 },
          },
        ],
        textRef: [2, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C02",
    orikaId: 325,
    orikaIndex: 339,
    name: "エリシウム",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 5,
    reductionSymbols: ["white", "white", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 5000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3",
      "このアルティメットは、アタックできず、相手のコスト5以下の効果を受けない。",
      "",
      "Lv3『各ステップ開始時』",
      "このアルティメット以外のスピリット/アルティメット/相手のネクサスすべてを指定する。このターンの間、指定したスピリット/アルティメット/ネクサスすべてのLvコスト+1する。",
    ],
    keywordTags: [],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-C02.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0] 《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》。BSAZ02-C01 precedent と同型
    //   （exact-zero field_has、minCount:0 明示必須）。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [2]【アルドノアドライブ：1】host 側キーワード宣言（BSAZ02-C01/C07/C10 precedent）。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,4,5] Lv3「アタックできず、相手のコスト5以下の効果を受けない」。
      //   prevent_battle(attack) + effect_immunity(sourceScope:maxCost:5)
      //   （BSLH01-C08「相手のコスト5以下の効果を受けない」precedent 同型）。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack"],
              duration: { scope: "permanent" },
            },
          },
          {
            connector: "sequential",
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
              sourceScope: { maxCost: 5 },
            },
          },
        ],
        textRef: [2, 4, 5],
      },
      // [2,7,8] Lv3『各ステップ開始時』このアルティメット以外のスピリット/アルティメット/
      //   相手のネクサスすべてを指定し、このターンの間 Lv コスト+1。単一 TargetSpec は
      //   player 軸1つのみのため、(スピリット/アルティメット=either, excludeSelf) と
      //   (ネクサス=opponent) の2 step に分割して同時適用する（BSKB01-M01/BSLH01-M04
      //   override_properties.levelCostDelta precedent、count:"all" は BSFT01.ts precedent）。
      //   「各ステップ開始時」= timing.phase の step 省略（全ステップ）+ whose:"either"
      //   （BSKB01-M01 の subPhase:"end" 全ステップ precedent と同型、start/either 版）。
      {
        timing: { kind: "phase", whose: "either", subPhase: "start" },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "either",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
                excludeSelf: true,
              },
              properties: { levelCostDelta: 1 },
              duration: { scope: "turn" },
            },
          },
          {
            connector: "sequential",
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"] },
                count: "all",
              },
              properties: { levelCostDelta: 1 },
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [2, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C03",
    orikaId: 326,
    orikaIndex: 340,
    name: "シレーン",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 8000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3『このアルティメットの召喚時』",
      "ボイドからコア1個をこのアルティメットに置ける。",
      "",
      "Lv3",
      "コスト6以下の相手のスピリット/アルティメットは、アタック/ブロックできず、相手の「デッキオープン効果」は発揮されない。",
    ],
    keywordTags: [],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-C03.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0] 《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》。BSAZ02-C01/C02/C04 precedent
    //   と同型（exact-zero field_has、minCount:0 明示必須）。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [2]【アルドノアドライブ：1】host 側キーワード宣言（BSAZ02-C01/C02/C04/C07/C10 precedent）。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,4,5]【アルドノアドライブ：1】「あるとき」ゲート付き Lv3『このアルティメットの召喚時』
      //   ボイドからコア1個を置ける（可能形＝任意、BSGE01-TX02(A) precedent と同型の
      //   card_event:summon + executionMode:optional + core_move(void→this_card)）。
      {
        timing: { kind: "card_event", event: "summon" },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
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
        ],
        textRef: [2, 4, 5],
      },
      // [2,7,8]【アルドノアドライブ：1】Lv3「コスト6以下の相手のスピリット/アルティメットは、
      //   アタック/ブロックできず、相手の「デッキオープン効果」は発揮されない」。
      //   prevent_battle(filter, maxCost:6) は BSAZ02-C02「相手のコスト5以下の効果を受けない」
      //   /BSSA01「本来のコスト7以下」precedent と同型の field-wide 継続制限。
      //   「デッキオープン効果」= deck_reveal action を含む効果 (10_rules/07b
      //   「デッキオープン」= card_event:revealed 系の慣用表現) の一般的な発揮抑止。
      //   EffectTargetFilter.containsActionKinds (新設、effect.steps を choice 分岐込みで
      //   再帰走査した action.kind 集合と照合、SSOT: deriveSuppressionEffectDescriptor) で
      //   個別カード名指定なしに「deck_reveal を含む効果」を汎用的に特定する
      //   (BSTH08「召喚時効果」timingKind+eventAction precedent の action-kind 版)。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"], maxCost: 6 },
                count: "all",
              },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
            },
          },
          {
            connector: "simultaneous",
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                zone: [
                  "field",
                  "hand",
                  "deck",
                  "trash",
                  "set_aside",
                  "in_use",
                  "mirage",
                  "burst",
                ],
                filter: {},
                count: "all",
              },
              effectFilter: { containsActionKinds: ["deck_reveal"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [2, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C04",
    orikaId: 327,
    orikaIndex: 341,
    name: "スカンディア",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 12000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3-Lv4",
      "このアルティメットは、ブロックされず、合体スピリット/マジック以外の効果を受けない。",
      "",
      "Lv3-Lv4 フラッシュ『お互いのアタックステップ』",
      "ターンに1回、コスト4以下の相手のスピリット/ネクサス1つをデッキの下に戻せる。そうしたとき、相手の手札1枚を内容を見ないで破棄する。",
    ],
    keywordTags: [],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-C04.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0] 《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》。BSAZ02-C01/C02 precedent と同型
    //   （exact-zero field_has、minCount:0 明示必須）。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [2]【アルドノアドライブ：1】host 側キーワード宣言（BSAZ02-C01/C02/C07/C10 precedent）。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,4,5] Lv3-4「ブロックされず、合体スピリット/マジック以外の効果を受けない」。
      //   「ブロックされず」= unblockable（BSDB01.ts:2011-2018 precedent、被ブロック不可）。
      //   「合体スピリット/マジック以外の効果を受けない」= 除外方向の免疫スコープ。
      //   immunitySourceScope は従来 categories/colors/maxCost の**包含**方向のみだったため、
      //   「合体状態の発生源は categories 一致に関わらず対象外」を表現する
      //   `excludeCombined` を新設（model.ts ContinuousEffect.immunitySourceScope /
      //   dsl-types.ts EffectImmunityAction.sourceScope、effect-resistance-check.ts
      //   immunitySourceMatches）。categories はマジックを除く全カテゴリ (spirit/brave/
      //   ultimate/nexus) を列挙し、`excludeCombined:true` で合体スピリット発生源を
      //   scope から除外する（合体状態は card-filter.ts CardFilter.combined と同一判定
      //   `attachedToInstanceId !== null || attachedChildrenIds.length > 0`）。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 3, max: 4 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "unblockable",
              target: { kind: "self" },
              duration: { scope: "permanent" },
            },
          },
          {
            connector: "sequential",
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
              sourcePlayerScope: "any",
              sourceScope: {
                categories: ["spirit", "brave", "ultimate", "nexus"],
                excludeCombined: true,
                excludeCombinedCategories: ["spirit"],
              },
            },
          },
        ],
        textRef: [2, 4, 5],
      },
      // [2,7,8] Lv3-4 フラッシュ『お互いのアタックステップ』ターンに1回、コスト4以下の
      //   相手スピリット/ネクサス1つをデッキ下へ戻せる（send_to_deck、BSAZ02-C02
      //   precedent）。そうしたとき (ref_succeeded ゲート) 相手の手札1枚を内容を見ないで
      //   破棄する (discard_hand unseen:true、BSTH03-M07 precedent)。
      //   timingScope 未指定だと isTimingScopeActive が無制限扱いになるため
      //   (ce-lookup.ts、BSAZ01.ts 既存コメント同旨) お互いのアタックステップに明示的に絞る。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        applicability: { level: { min: 3, max: 4 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            id: "return-deck",
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "nexus"], maxCost: 4 },
                count: 1,
              },
              position: "bottom",
            },
          },
          {
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "return-deck" },
            action: {
              kind: "discard",
              player: "opponent",
              count: 1,
              unseen: true,
            },
          },
        ],
        textRef: [2, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C05",
    orikaId: 328,
    orikaIndex: 342,
    name: "オクタンティス",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 13000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札にあるこのカードは、召喚できる。",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3-Lv4『このアルティメットのアタック/ブロック時』",
      "BP15000以下の相手のスピリット/アルティメットか相手のバースト1つをデッキの下に戻す。この効果は相手の効果で防げない。",
      "",
      "Lv4",
      "このアルティメットは相手のスピリットの効果を受けない。",
    ],
    keywordTags: ["burst"],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-C05.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0] 《召喚条件：ＣＦアルティメット0体》。BSAZ02-C01 precedent と同型
    //   （exact-zero field_has、minCount:0 明示必須）。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [5,6]【アルドノアドライブ：1】host 側キーワード宣言（BSAZ02-C01/C07/C10 precedent）。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,3] フラッシュ『お互いのアタックステップ』手札にあるこのカードは召喚できる。
      //   BSAZ02-C07（同ファイル内）/ BSES01-C02 precedent と同型（timingScope:{player:"both",
      //   period:"attack"} + applicability.zone:"hand" + summon target:self）。「ターンに1回」
      //   限定が無いため usageLimit は付けない（C07 との差異）。
      {
        applicability: { zone: "hand" },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [7,8]【アルドノアドライブ：1】ゲート付き Lv3-4『このアルティメットのアタック/ブロック時』。
      //   「BP15000以下の相手1体 か 相手のバースト1つをデッキの下に戻す」= choice で二択表現
      //   （P3-14 choice DSL）。バースト分岐は discard_set_burst の新設 destination:"deck_bottom"
      //   （BSES01-M01 の zone:"burst" ターゲット指定 precedent + DiscardAction.destination の
      //   deck_bottom reset パターンを discard_set_burst 側にも拡張、ENGINE-discard-set-burst-
      //   deck-bottom-destination）。「相手の効果で防げない」は effect 側 preventionLevel
      //   （send_to_deck 分岐）と action 側 unpreventable（discard_set_burst は独自に
      //   action.unpreventable を読む、effect-level とは独立）の両方を明示する必要がある。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        applicability: { level: { min: 3, max: 4 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        preventionLevel: "unpreventable",
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"], maxBp: 15000 },
                count: 1,
              },
              position: "bottom",
            },
            choice: [
              {
                action: {
                  kind: "discard_set_burst",
                  player: "opponent",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: {},
                    count: 1,
                    zone: "burst",
                  },
                  count: 1,
                  destination: "deck_bottom",
                  unpreventable: true,
                },
              },
            ],
          },
        ],
        textRef: [7, 8],
      },
      // [10,11] Lv4 このアルティメットは相手のスピリットの効果を受けない。
      //   BSLH01-C08 precedent と同型（sourceScope: categories:["spirit"]、発生源カテゴリ限定）。
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          level: {
            min: 4,
            max: 4,
          },
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
        textRef: [10, 11],
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C06",
    orikaId: 329,
    orikaIndex: 343,
    name: "スカイキャリア",
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
    ],
    symbolColors: ["white"],
    textLines: [
      "Lv1『このスピリットの召喚時』",
      "〔ターンに1回：同名〕自分のデッキを上から5枚オープンできる。その中の系統：「ＣＦ」を持つアルティメットカード1枚を手札に加える。残ったカードはデッキの下に戻す。",
      "",
      "【アルドノアドライブ：1】（このスピリットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv1 フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回：同名〕手札にある系統：「ＣＦ」を持つアルティメットカード1枚を軽減シンボルすべてを満たして召喚できる。そうしたとき、このスピリットの下の「アルドノアドライブ」を召喚したアルティメットの下に加え、このスピリットをトラッシュに置く。",
    ],
    keywordTags: [],
    tribe: "火星・アルドノア",
    image: "images/BSAZ02-C06.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1『召喚時』デッキ5枚オープン→ＣＦアルティメット1枚を手札、残りデッキ下。
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
              kind: "deck_reveal",
              revealCount: 5,
              picks: [
                {
                  count: 1,
                  filter: {
                    tribes: ["ＣＦ"],
                    category: ["ultimate"],
                  },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
      // 【アルドノアドライブ：1】Lv1 フラッシュ『お互いのアタックステップ』〔ターンに1回：同名〕
      //   手札の系統「ＣＦ」を持つアルティメットカード1枚を軽減シンボルすべてを満たして召喚できる。
      //   そうしたとき、このスピリットの下の「アルドノアドライブ」(BSAZ02-C10 インスタンス) を
      //   召喚したアルティメットの下に加え、このスピリットをトラッシュに置く。
      // 召喚が成立すれば後半を可能な限り実行する。付け替え失敗は本体の離場を止めない。
      // move_self は非破壊の共通離場処理で、残った下カードとコアも処理する。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            id: "summon-cf",
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                filter: { category: ["ultimate"], tribes: ["ＣＦ"] },
                count: 1,
              },
              costModifier: "full_reduction",
            },
          },
          {
            id: "reparent-drive",
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "summon-cf" },
            action: {
              kind: "place_text_role_under_card",
              hostTarget: { kind: "ref", stepId: "summon-cf" },
              roleTag: "アルドノアドライブ",
              moveFrom: "self_under_card",
            },
          },
          {
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "summon-cf" },
            action: {
              kind: "move_self",
              destination: "trash",
            },
          },
        ],
        textRef: [3, 5, 6],
      },
    ],

    underCardSlots: [
      {
        roleTag: "アルドノアドライブ",
        maxCount: 1,
      },
    ],
  },
  {
    cardNo: "BSAZ02-C07",
    orikaId: 330,
    orikaIndex: 344,
    name: "ステイギス",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 2000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 4000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回：同名〕手札にあるこのカードは召喚できる。",
      "",
      "【アルドノアドライブ：1】（このスピリットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv1-Lv2【分身:2】『このスピリットの召喚時』",
      '〔ターンに1回：同名〕自分のデッキの上から2枚まで裏向きでフィールドに置き、フィールド/リザーブからコア1個以上を置く。ゲーム終了時まで、それらのカードを"「スティギス」/コスト3/系統：「火星」・「アルドノア」Lv1 BP2000/［白］"、"このスピリットによって相手のライフは減らない。"を持つ白の分身スピリットとして扱う。（分身スピリットは、煌臨/入れ替えできず、手札/手元/デッキに戻るとき破棄される。）',
    ],
    keywordTags: [],
    tribe: "火星・アルドノア",
    image: "images/BSAZ02-C07.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【アルドノアドライブ：1】host 側キーワード宣言 (engine-aldnoah-drive-under-card-keyword)。
    // 「このスピリットの下に『アルドノアドライブ』を1枚まで置ける」の枠数上限。実際の下カード
    // 配置は BSAZ02-C10 側の place_text_role_under_card 効果 (host=trigger_related_instance)
    // が担い、こちらは host の枠数宣言のみ (declaresUnderCardSlot CardFilter / underCardSlots
    // 経由の maxCount 参照)。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [3,5,6] 【アルドノアドライブ：1】「あるとき、以下の効果を得る」ゲート付き
      //   Lv1-Lv2【分身:2】『このスピリットの召喚時』〔ターンに1回：同名〕。
      //   engine-deck-derived-clone-spirit primitive (BSAZ01-C12 と共通基盤、詳細は
      //   同 primitive の初出コメント参照)。デッキ上から2枚まで裏向きでフィールドに置き、
      //   フィールド/リザーブのコア1個以上を配分して「スティギス」分身スピリットとして
      //   扱う (公式分身ルール Q782、07b §5、信頼度A)。「ゲーム終了時まで」は
      //   act_as_spirit の lifecycle 規約上 while_on_field 既定のままでよい
      //   (token フィールド離脱で discard_on_leave によりトラッシュ確定 → CE も同時消滅、
      //   ターン経過による自然失効が無いという点で "ゲーム終了時まで" と実質等価)。
      //   「（分身スピリットは、煌臨/入れ替えできず...）」の煌臨禁止は BSAZ01-C12 の
      //   reminder text には無い C07 固有の制約 (overrides.keywords "cannot_advent" で表現、
      //   advent-system.ts の matchesAdventCondition から参照)。
      //   engine-aldnoah-drive-under-card-keyword (本 cluster): 【アルドノアドライブ：1】の
      //   「あるとき」ゲートを condition:self_under_card_count で追加。textRef[6]後半
      //   「このスピリットによって相手のライフは減らない」を分身2体へ life_damage_interception
      //   (attackerSelectedTarget + place_face_down 参照) で付与。
      {
        timing: { kind: "card_event", event: "summon" },
        applicability: { level: { min: 1, max: 2 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        usageLimit: [{ kind: "per_card_name", duration: "turn" }],
        steps: [
          {
            id: "place_face_down",
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "self", position: "top" },
              to: { zone: "field", player: "self" },
              count: { min: 0, max: 2 },
              faceDown: true,
            },
          },
          {
            id: "core_distribute",
            action: {
              kind: "core_distribute",
              from: { kind: "field_and_reserve_self" },
              to: { kind: "ref", stepId: "place_face_down" },
              amount: "all",
              mode: "player_choice",
              minTotal: 1,
            },
          },
          {
            action: {
              kind: "register_act_as_spirit",
              target: { kind: "ref", stepId: "place_face_down" },
              statBlueprint: {
                kind: "static_copy",
                snapshot: {
                  cost: 3,
                  reductionSymbols: [],
                  symbolColors: ["white"],
                  tribes: ["火星", "アルドノア"],
                  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
                  colors: ["white"],
                },
              },
              overrides: {
                cardName: "スティギス",
                keywords: [
                  "discard_on_leave",
                  "cannot_combine",
                  "cannot_advent",
                ],
              },
            },
          },
          {
            action: {
              kind: "life_damage_interception",
              player: "opponent",
              cause: "any",
              mode: "replace",
              attackerSelectedTarget: true,
              target: { kind: "ref", stepId: "place_face_down" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 5, 6],
      },
      // [0,1] フラッシュ『お互いのアタックステップ』〔ターンに1回：同名〕手札にあるこの
      //   カードは召喚できる。BSES01-C02 (timingScope:{player:"both",period:"attack"}) 同型。
      {
        applicability: { zone: "hand" },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [0, 1],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C08",
    orikaId: 331,
    orikaIndex: 345,
    name: "月面基地",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white"],
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
    symbolColors: ["white", "white"],
    textLines: [
      "Lv1-Lv2",
      "相手の効果で自分のライフは0にならない。",
      "",
      "Lv2『お互いのアタックステップ』",
      "自分がスピリットカード/アルティメットカードを召喚するとき、このネクサスを疲労できる。そうしたとき、そのアルティメットカードの召喚条件を無視し、そのカードの軽減シンボルすべてを満たす。",
    ],
    keywordTags: [],
    tribe: "火星・アルドノア",
    image: "images/BSAZ02-C08.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0,1] Lv1-2「相手の効果で自分のライフは0にならない」= ライフ下限保護
      //   life_damage_interception(cause:"opponent_effect", mode:"floor", floor:1,
      //   duration:{scope:"while_on_field"})。既存 flash-activated 版
      //   (BSTH002/BSTH03/BSTH05.5) は duration:{scope:"battle"|"turn"} だが、本カードは
      //   継続効果として場にある間ずっと保護するため while_on_field を使う
      //   （BSAZ01 offer_magic_pre_cost_trigger 等の continuous+while_on_field 一般 precedent）。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 1, max: 2 } },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "opponent_effect",
              mode: "floor",
              floor: 1,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv2『お互いのアタックステップ』自分がスピリット/アルティメットカードを
      //   召喚するとき、このネクサスを疲労させることを選べば、その召喚のアルティメット
      //   召喚条件を無視し軽減シンボルすべてを満たす代替コストを得る
      //   (grant_declared_summon_alt_cost CE、ENGINE-declared-summon-optional-exhaust-cost-bypass)。
      //   timingScope:{player:both,period:attack} により、実際にこの選択肢が legal action
      //   として現れるのは対応する攻撃ステップのフラッシュ窓のみ (getDeclaredSummonAltCostGrant
      //   が getCEsForTarget 経由で自動フィルタする)。プレイヤーは疲労させず通常経路の
      //   召喚を選ぶこともできる (任意の代替コスト、強制ではない)。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 2, max: 2 } },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "grant_declared_summon_alt_cost",
              player: "self",
              filter: { category: ["spirit", "ultimate"] },
              benefits: { ignoreSummonCondition: true, fullReduction: true },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C09",
    orikaId: 332,
    orikaIndex: 346,
    name: "エデルリッゾ",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white", "white"],
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
    symbolColors: ["white"],
    textLines: [
      "手札にあるこのカードは、自分の「ヴァース」が配置されたとき、コストを支払わずに配置できる。",
      "",
      "Lv1-Lv2",
      "〔ターンに1回：同名〕自分のスピリット/アルティメット/ネクサスの下に「アルドノアドライブ」が置かれたとき、ボイドからコア1個ずつをこのネクサスと自分の「ヴァース」を含む導界者ネクサスに置く。",
      "",
      "Lv2",
      "自分の「ヴァース」があるとき、このネクサスは相手の効果を受けない。",
      'さらに、相手のスピリット/アルティメットすべてに"『このスピリット/アルティメットのアタック時』相手は相手の創界神ネクサス1つを指定できる。このターンの間、指定された創界神ネクサスは、破壊されない。"を与える。',
    ],
    keywordTags: [],
    tribe: "火星",
    image: "images/BSAZ02-C09.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: ["images/BSAZ02-C09.png"],
    sourceConfidence: "B",
    effects: [
      // [0] 手札にあるこのカードは、自分の「ヴァース」が配置されたとき、コストを支払わずに
      //   配置できる。名前の参照なので、導界者/創界神だけに限定しない。
      {
        applicability: { zone: ["hand"] },
        timing: {
          kind: "game_event",
          player: "self",
          event: ["place"],
          triggerFilter: {
            category: ["nexus"],
            cardName: [{ contains: "ヴァース" }],
          },
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] Lv1-Lv2〔ターンに1回：同名〕自分のスピリット/アルティメット/ネクサスの下に
      //   「アルドノアドライブ」が置かれたとき、ボイドからコア1個ずつをこのネクサスと自分の
      //   「ヴァース」を含む導界者ネクサスに置く。保存カード画像
      //   images/BSAZ02-C09.png（SHA-256:
      //   1097829dec27a018b3fa47b66749e52337733729e859b57f3ecd9b1d4ac8dcb4）で
      //   raw 転記の「創界神」を「導界者」へ訂正済み。原文証跡は
      //   manual/ai-reference/00_meta/fidelity-audit-2026-09-13/crossover-BSAZ02.md。
      //   ENGINE-c09-text-role-under-card-third-party-trigger (第三者観測 game_event、host 側の実配置
      //   成立で発火) + core_distribute(mode:"one_each")。
      {
        applicability: {
          level: {
            min: 1,
            max: 2,
          },
        },
        timing: {
          kind: "game_event",
          player: "self",
          event: ["text_role_under_card_placed"],
          triggerFilter: {
            category: ["spirit", "ultimate", "nexus"],
            hasUnderCardRoleTag: "アルドノアドライブ",
          },
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        steps: [
          {
            id: "core_self",
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
              kind: "core_distribute",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                  grandwalkerKind: "guided",
                  cardName: [{ contains: "ヴァース" }],
                },
                count: "all",
              },
              amount: 99,
              mode: "one_each",
            },
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv2 自分の「ヴァース」があるとき、このネクサスは相手の効果を受けない。
      //   BSTH06 precedent (effect_resistance resistsOutcome:["targeted","included"]
      //   source:"opponent_effect")。
      {
        applicability: {
          level: {
            min: 2,
            max: 2,
          },
        },
        timing: {
          kind: "continuous",
        },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [
              {
                contains: "ヴァース",
              },
            ],
          },
        ],
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
            },
          },
        ],
        textRef: [5, 6],
      },
      // [5,7] Lv2 さらに、相手のスピリット/アルティメットすべてに"『このスピリット/アルティメット
      //   のアタック時』相手は相手の創界神ネクサス1つを指定できる。このターンの間、指定された
      //   創界神ネクサスは、破壊されない。"を与える。grant_effect (P3-99, template=BSDB01-R03)。
      //   引用テキスト内の「相手」は被付与カード(相手のスピリット/アルティメット)自身の視点
      //   基準の二重反転で、このカードのコントローラ(自分)を指す (verifier round1 指摘)。
      //   grantPlayerRef:"opponent" (ENGINE-grant-effect-player-ref-wiring、grant-effect-system.ts
      //   resolveGrantPendingActingPlayerId) で誘発解決の actingPlayerId を被付与カードの
      //   相手(=自分)に固定し、grantedEffect 内の "self"/"opponent" を自分視点で解決させる。
      {
        applicability: { level: { min: 2, max: 2 } },
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "ヴァース" }],
          },
        ],
        steps: [
          {
            action: {
              kind: "grant_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
              },
              duration: { scope: "while_on_field" },
              grantPlayerRef: "opponent",
              grantedEffect: {
                timing: { kind: "card_event", event: "attack" },
                executionMode: "optional",
                steps: [
                  {
                    action: {
                      kind: "effect_resistance",
                      target: {
                        kind: "filter",
                        player: "self",
                        filter: {
                          category: ["nexus"],
                          targetsGrandwalker: "only",
                        },
                        count: 1,
                      },
                      resistsOutcome: "destroy",
                      source: "all",
                      duration: { scope: "turn" },
                    },
                  },
                ],
              },
            },
          },
        ],
        textRef: [5, 7],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C10",
    combinedBoost: 1000,
    orikaId: 333,
    orikaIndex: 347,
    name: "アルドノアドライブ",
    printedCategory: "brave",
    colors: ["white"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "このカードは、20枚までデッキに入れられる。",
      "",
      "スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできない。",
      "",
      "【アルドノアドライブ】を持つ自分のカードを召喚/配置/転醒したとき、手札/フィールドのこのカード/ブレイヴをただちにそのカードの下に置ける。そうしたとき、自分はデッキの上から1枚ドローし、ボイドからコア1個を自分のフィールドに置く。",
      "",
      "Lv1『このブレイヴの召喚時』",
      "〔ターンに1回：同名〕自分はデッキの上から1枚ドローできる。ドロー後、手札1枚をデッキの下に戻す。",
      "",
      "【合体条件：合体不可】",
    ],
    // textLines[8] 【合体条件：合体不可】。cannot_combine は act_as_spirit token 専用
    // 供給源 (hasActAsSpiritKeyword) から印字カード定義へ一般化済み (hasCannotCombineRestriction
    // が definition.keywordTags も参照)。needs-dsl.audit.jsonl:BSAZ02-C10 解消。
    keywordTags: ["cannot_combine"],
    tribe: "アルドノア",
    image: "images/BSAZ02-C10.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 20,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // text[2] 「スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできない。」
      // BSTH05-M11 [0] / BSES01-C02 [0] precedent: applicability.combined=false +
      // continuous (prevent_battle attack/block + effect_resistance exhaust)、ruleStrength:true。
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
        textRef: [2],
      },
      // [4] 【アルドノアドライブ】を持つ自分のカードを召喚/配置/転醒したとき、手札/フィールドの
      //   このカードをただちにそのカードの下に置ける。そうしたとき、デッキの上から1枚ドロー＋
      //   ボイドからコア1個を自分のフィールドに置く。engine-aldnoah-drive-under-card-keyword。
      //   第三者観測トリガー (game_event、triggerFilter:declaresUnderCardSlot で host 側の
      //   【アルドノアドライブ：N】宣言を絞り込む)。host の枠上限は host 定義の
      //   underCardSlots(roleTag一致)を参照 (place_text_role_under_card 側で解決)。
      //   置くカード自身は常にこのカード (sourceInstanceId) — 選択式ターゲットではない。
      //   ドロー/コア配置は ref_succeeded で配置成功時のみ発揮 (host枠が埋まっている/host不在
      //   なら配置自体が no-op になり後続も発揮しない)。
      //   「ただちに」は triggerPriority:"immediate" で通常誘発より先に解決する。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["summon", "place", "rebirth"],
          triggerFilter: { declaresUnderCardSlot: "アルドノアドライブ" },
        },
        applicability: { zone: ["hand", "field"] },
        executionMode: "optional",
        triggerPriority: "immediate",
        steps: [
          {
            id: "place_under",
            action: {
              kind: "place_text_role_under_card",
              hostTarget: { kind: "trigger_related_instance" },
              roleTag: "アルドノアドライブ",
              fallbackMaxCount: 1,
            },
          },
          {
            action: { kind: "draw", count: 1 },
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "place_under" },
          },
          {
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "field_card", player: "self", filter: {} },
              amount: 1,
            },
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "place_under" },
          },
        ],
        textRef: [4],
      },
      // textLines[0]「20枚までデッキに入れられる」は maxDeckCount=20、textLines[8]
      // 【合体条件：合体不可】は keywordTags:["cannot_combine"] (hasCannotCombineRestriction
      // 経由) でそれぞれ宣言的に表現済みのため、effects エントリは不要 (残 stub 無し)。
      // Lv1『このブレイヴの召喚時』デッキ1ドロー→手札1枚をデッキの下に戻す。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          { action: { kind: "draw", count: 1 } },
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "self",
                filter: {},
                count: 1,
                zone: "hand",
              },
              position: "bottom",
            },
            connector: "sequential",
            targetSelectionTiming: "on_step",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C11",
    combinedBoost: 4000,
    orikaId: 334,
    orikaIndex: 348,
    name: "スレイン・トロイヤード",
    printedCategory: "brave",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず、自分の系統：「火星」を持つアルティメット/ネクサスがあるとき、相手によってフィールドを離れない。",
      "",
      "Lv1『自分のメインステップ』",
      "〔ゲームに1回：同名〕自分のデッキを上から7枚破棄できる。その中の系統：「火星」を持つ導界者ネクサスカード2枚までをコストを支払わずに配置できる。",
      "",
      "【合体条件：火星＆スピリット/アルティメット】",
      "【アルティメット合体中】",
      "自分が系統：「火星」と「ＣＦ」を持つアルティメットカードを召喚するとき、召喚条件を無視して召喚できる。",
    ],
    keywordTags: [],
    tribe: "火星・アルドノア",
    image: "images/BSAZ02-C11.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [5]【合体条件：火星＆スピリット/アルティメット】。braveCondition は合体先候補の
    //   絞り込みに使われる CardDefinition 宣言フィールドのため、effects[] にステップを
    //   要しない（BSAZ02-C12 braveCondition precedent と同型、textRef 不要）。
    braveCondition: { tribes: ["火星"], categories: ["spirit", "ultimate"] },
    effects: [
      // [0]「スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず」。
      //   BSAZ02-C10/C12 precedent と同型 (applicability.combined:false +
      //   effect_resistance(exhaust) + prevent_battle、ruleStrength:true)。
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
      // [0]「自分の系統：「火星」を持つアルティメット/ネクサスがあるとき、相手によって
      //   フィールドを離れない」。BSAZ02-C12 precedent と同型 (effect_resistance
      //   source:"opponent" + field_has 条件、continuous 効果は effect-level condition
      //   のみが live 再評価されるため独立 effect に分割)。
      {
        timing: { kind: "continuous" },
        applicability: { combined: false },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["ultimate", "nexus"],
            tribes: ["火星"],
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent",
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] Lv1『自分のメインステップ』〔ゲームに1回：同名〕デッキ上7枚破棄→その中の
      //   系統：「火星」を持つ導界者ネクサスカード2枚までをコスト不要配置。
      //   破棄したカードだけをstepIdで参照して配置し、その後に破棄時効果を処理する。
      {
        timing: { kind: "activated", mode: "main" },
        usageLimit: { kind: "per_card_name", duration: "game" },
        steps: [
          {
            id: "mill",
            action: {
              kind: "discard",
              player: "self",
              fromZone: "deck",
              count: 7,
              deferMovedToTrashEffects: true,
            },
          },
          {
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                filter: {
                  category: ["nexus"],
                  tribes: ["火星", "導界者"],
                  tribesLogic: "and",
                },
                count: { min: 0, max: 2 },
                stepId: "mill",
              },
              from: { zone: "trash", player: "self" },
              to: { zone: "field", player: "self" },
              count: 2,
            },
            executionMode: "optional",
            connector: "sequential",
          },
          {
            action: {
              kind: "process_moved_to_trash",
              source: { stepId: "mill" },
              fromZone: "deck",
            },
            connector: "sequential",
          },
        ],
        textRef: [2, 3],
        executionMode: "optional",
      },
      // [6,7]【アルティメット合体中】「自分が系統：「火星」と「ＣＦ」を持つアルティメット
      //   カードを召喚するとき、召喚条件を無視して召喚できる」。新設 allow_ignore_summon_condition
      //   CE (engine-summon-condition-ignore-grant)。canSummonUltimate が
      //   hasIgnoreSummonConditionGrant 経由でバイパスを確認する
      //   （executeSummonOther など効果駆動の召喚は元々 summonCondition を検査しないため、
      //   この許可が効くのは player 側の通常召喚 legal action のみ）。
      //   braveCondition (categories:["spirit","ultimate"]) は火星スピリット/アルティメット
      //   いずれとも合体可能だが、見出しラベルは「アルティメット合体中」限定
      //   (BSAZ02-C12 の host 非限定「合体中」/BSTH003-C31「スピリット合体中」との対比、
      //   adversarial verifier round1 lens1 指摘)。applicability.combined はホスト種別を
      //   区別しないため、新設 condition combined_host_category でホストが
      //   category:ultimate のときのみに絞る。
      {
        timing: { kind: "continuous" },
        applicability: { combined: true },
        condition: [
          { kind: "combined_host_category", categories: ["ultimate"] },
        ],
        steps: [
          {
            action: {
              kind: "allow_ignore_summon_condition",
              player: "self",
              filter: {
                category: ["ultimate"],
                tribes: ["火星", "ＣＦ"],
                tribesLogic: "and",
              },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C12",
    combinedBoost: 4000,
    orikaId: 335,
    orikaIndex: 349,
    name: "ザーツバルム",
    printedCategory: "brave",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white", "white"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず、自分の系統：「火星」を持つアルティメット/ネクサスがあるとき、相手によってフィールドを離れない。",
      "",
      "Lv1『このブレイヴの召喚時』",
      "〔ターンに1回：同名〕自分のデッキを上から4枚オープンできる。その中の系統：「火星」を持つカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "【合体条件：火星＆アルティメット】",
      "【合体中】『自分のアタックステップ』",
      "相手の手札のマジックカード/【アクセル】のコストを+3する。",
    ],
    keywordTags: ["accel"],
    tribe: "火星",
    image: "images/BSAZ02-C12.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [5]【合体条件：火星＆アルティメット】。braveCondition は合体先候補の絞り込みに
    //   使われる CardDefinition 宣言フィールドのため、effects[] にステップを要しない
    //   （BSAZ01-C?? cardNameContains precedent と同型、textRef 不要）。
    braveCondition: { tribes: ["火星"], categories: ["ultimate"] },
    effects: [
      // Lv1『このブレイヴの召喚時』デッキ4枚オープン→火星カード1枚を手札、残り破棄。
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
              kind: "deck_reveal",
              revealCount: 4,
              picks: [
                {
                  count: 1,
                  filter: {
                    tribes: ["火星"],
                  },
                  mandatory: true,
                },
              ],
              remainder: "trash",
            },
          },
        ],
        textRef: [2, 3],
      },
      // [0]「スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできず」。
      //   BSAZ02-C10 precedent と同型 (applicability.combined:false + effect_resistance
      //   (exhaust) + prevent_battle、ruleStrength:true)。
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
      // [0]「自分の系統：「火星」を持つアルティメット/ネクサスがあるとき、相手によって
      //   フィールドを離れない」。上記スピリット状態効果とは条件が異なる (火星アルティメット/
      //   ネクサス存在時のみ) ため、continuous 効果を分割する（effect_resistance の
      //   source:"opponent"、BSSL01 precedent と同型。continuous 効果は effect-level
      //   condition のみが live 再評価される (continuous-effect-rebuild.ts:1236) ため、
      //   step-level condition ではなく effect 自体を分ける）。
      {
        timing: { kind: "continuous" },
        applicability: { combined: false },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["ultimate", "nexus"],
            tribes: ["火星"],
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "leave_field",
              source: "opponent",
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // [6,7]【合体中】『自分のアタックステップ』相手の手札のマジックカード/【アクセル】の
      //   コストを+3する。cost_modify(player:"opponent", cardFilter) の player+cardFilter 版
      //   （BSGE01-M02 precedent、opponent の hand ゾーンカードへの additionalCostValue）。
      //   「自分のアタックステップ」中のみ有効 = continuous + condition:step_phase(attack, self)
      //   で live ゲート。マジック/【アクセル】= category:magic OR hasMechanic:accel の filterOr。
      //   filterOr が設定されている CardFilter は他の直接フィールド（zone 等）が無視される
      //   （matchesCardFilter/matchesCostCEFilterClause 共通の filterOr 意味論、
      //   「filterOr内のいずれかに合致すればマッチ、他フィールドは無視」）ため、
      //   zone:["hand"] は filterOr の外側ではなく各枝に複製する（adversarial verifier
      //   round2 lens3 指摘: 兄弟フィールドの silent-drop）。
      {
        timing: { kind: "continuous" },
        applicability: { combined: true },
        condition: [{ kind: "step_phase", step: "attack", whose: "self" }],
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "opponent",
              cardFilter: {
                filterOr: [
                  { category: ["magic"], zone: ["hand"] },
                  { hasMechanic: ["accel"], zone: ["hand"] },
                ],
              },
              modifier: { additionalCostValue: 3 },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C13",
    orikaId: 336,
    orikaIndex: 350,
    name: "超古代化学の発見",
    printedCategory: "magic",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ターンに1回：同名〕マジックカード以外の自分の白の効果でデッキからオープンされた/トラッシュに置かれたこのカードは手札に加えられる。",
      "",
      "メイン",
      "〔ターンに1回：同名〕自分のデッキを上から6枚オープンし、その中のカード名：「アルドノアドライブ」すべてと系統：「ＣＦ」持つアルティメットカード1枚を手札に加え、残ったカードはデッキの下に戻す。または、トラッシュにあるカード名：「アルドノアドライブ」1枚と系統：「ＣＦ」を持つアルティメットカード1枚を手札に戻す。",
    ],
    keywordTags: [],
    tribe: "火星・アルドノア",
    image: "images/BSAZ02-C13.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0]〔ターンに1回：同名〕マジック以外の自分の白の効果でオープン/トラッシュ行き時、
      //   このカードを手札に加えられる。BSES01-C01 effects[0] / BSTH01-R12 / BSFT01-C02
      //   precedent と同型 (trigger_source_player/trigger_source_category/
      //   trigger_from_zone:deck) に「白の効果」限定を trigger_colors で追加する。
      //   「デッキからオープンされたか、トラッシュに置かれた」は鍵/星霊デッキオープン
      //   置換裁定 (2026-06-11、10_rules/07b) の一般形で、両分岐ともデッキ由来
      //   (revealed=ピック、moved_to_trash=同一オープンの残り) に限定するのが正源解釈。
      //   zones配列に "trash" を含めるのは誤り (fromZoneに"trash"を渡す呼び出しが
      //   存在しないdead branch、adversarial verifier round1 lens1 指摘) だが、
      //   trigger_from_zone 自体を削除するのは precedent/裁定と矛盾する
      //   (adversarial verifier round2 lens1/6 指摘)。zones:["deck"] のみ残す。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          { kind: "trigger_source_category", exclude: ["magic"] },
          { kind: "trigger_colors", colors: ["white"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        usageLimit: { kind: "per_card_name", duration: "turn" },
        executionMode: "optional",
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        textRef: [0],
      },
      // [2,3] メイン〔ターンに1回：同名〕。二択 (P3-14 choice DSL、BSGE01系 precedent
      //   packages/card-data/src/cards/BSGE01.ts:2801-2834 と同型の
      //   choice + move_card(target:{kind:"filter"}) 構成):
      //   choice[0] (デフォルト) = デッキ上6枚オープンし、カード名：「アルドノアドライブ」
      //     すべて (count:revealCount の上限ピック＝「すべて」を表現、BSTH02.7.ts:548-568
      //     の複数 picks precedent) + 系統：「ＣＦ」アルティメット1枚を手札、残りデッキ下。
      //   choice[1] = トラッシュのカード名：「アルドノアドライブ」1枚を手札に戻す
      //     (ref_choice choiceIndex:1 で後続 step を条件付け、BSSL01-T01 precedent と同型)。
      //     後続 step でトラッシュの系統：「ＣＦ」アルティメット1枚を追加で手札に戻す。
      {
        timing: {
          kind: "activated",
          mode: "main",
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            id: "c13-mode",
            action: {
              kind: "deck_reveal",
              revealCount: 6,
              picks: [
                {
                  count: 6,
                  filter: {
                    cardName: {
                      exact: "アルドノアドライブ",
                    },
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    category: ["ultimate"],
                    tribes: ["ＣＦ"],
                  },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
            choice: [
              {
                action: {
                  kind: "move_card",
                  target: {
                    kind: "filter",
                    player: "self",
                    zone: "trash",
                    filter: {
                      cardName: {
                        exact: "アルドノアドライブ",
                      },
                    },
                    count: 1,
                  },
                  from: {
                    zone: "trash",
                    player: "self",
                    filter: {
                      cardName: {
                        exact: "アルドノアドライブ",
                      },
                    },
                  },
                  to: {
                    zone: "hand",
                  },
                  count: 1,
                },
              },
            ],
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "c13-mode",
              choiceIndex: 1,
            },
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                filter: {
                  category: ["ultimate"],
                  tribes: ["ＣＦ"],
                },
                count: 1,
              },
              from: {
                zone: "trash",
                player: "self",
                filter: {
                  category: ["ultimate"],
                  tribes: ["ＣＦ"],
                },
              },
              to: {
                zone: "hand",
              },
              count: 1,
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C14",
    orikaId: 337,
    orikaIndex: 351,
    name: "ヘブンズフォール",
    printedCategory: "magic",
    colors: ["white"],
    cost: 10,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "自分の系統：「ＣＦ」を持つアルティメットがいるとき、このカードのコストを6にする。さらに、このカードを使用するとき、トラッシュにある系統：「ＣＦ」を持つアルティメットカードをデッキの上と下に1枚ずつ戻すことで、コストを-3する。",
      "",
      "フラッシュ",
      "お互いのスピリット/アルティメットすべてを破壊し、その効果を発揮させない。この効果は、お互いの効果で防げない。",
    ],
    keywordTags: [],
    tribe: "火星・アルドノア",
    image: "images/BSAZ02-C14.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 自分の系統：「ＣＦ」を持つアルティメットがいるとき、このカードのコストを6にする。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["ultimate"],
            tribes: ["ＣＦ"],
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { override: 6 },
            },
          },
        ],
        textRef: [0],
      },
      // 使用時、トラッシュのＣＦアルティメットカード2枚をデッキ上下へ戻すことでコスト-3。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "cards_in_zone",
            player: "self",
            zone: "trash",
            filter: { category: ["ultimate"], tribes: ["ＣＦ"] },
            min: 2,
          },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { additionalCostValue: -3 },
              useCostPayment: {
                kind: "return_to_deck_top_bottom",
                sourceZone: "trash",
                count: 2,
                filter: { category: ["ultimate"], tribes: ["ＣＦ"] },
              },
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ: お互いのスピリット/アルティメットすべてを破壊し、その効果を発揮させない。
      // 「この効果は、お互いの効果で防げない」= 真の blanket（affect immunity 軸限定、
      // target lock は貫通しない。P3-141）。target lock 側 (P3-143) とは別軸なので
      // targetLockBypass:{kind:"all_effects"} は付与しない。
      {
        timing: { kind: "activated", mode: "flash" },
        preventionLevel: "unpreventable",
        targetLockBypass: { kind: "blanket_affect_immunity" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "either",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
              },
              suppressDestroyedEffects: "destroyed_only",
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C15",
    orikaId: 338,
    orikaIndex: 352,
    name: "隕石爆撃",
    printedCategory: "magic",
    colors: ["white"],
    cost: 6,
    reductionSymbols: ["white", "white", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "手札にあるこのカードは、自分のライフが減ったとき、コストを支払わずに使用できる。",
      "",
      "フラッシュ",
      "本来のコスト6以下の相手のスピリット/アルティメット3体までをデッキの下に戻す。",
    ],
    keywordTags: [],
    tribe: "火星",
    image: "images/BSAZ02-C15.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] ENGINE-conditional-free-magic-use-on-event: 手札にあるこのカードは、自分のライフが
      // 減ったとき、コストを支払わずに使用できる。原文は「相手によって」の限定が無いため
      // cause は絞り込まない（自傷含む全原因で誘発）。先例 BSTS01-R03。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "reduce_life",
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
      // [2,3] フラッシュ：本来コスト6以下の相手スピリット/アルティメット3体までをデッキの下に戻す。
      {
        timing: { kind: "activated", mode: "flash" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  maxCost: 6,
                  costBasis: "printed",
                },
                count: { min: 0, max: 3 },
              },
              position: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C16",
    orikaId: 339,
    orikaIndex: 353,
    name: "我は地球人というだけで憎いがな",
    printedCategory: "magic",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ターンに1回：同名〕トラッシュにあるこのカードは、自分のエンドステップに、手札の系統：「火星」を持つカードと入れ替えられる。",
      "",
      "手札にあるこのカードは、自分の導界者ネクサスが相手の効果の対象になるとき、コストを支払わずに使用できる。",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕自分の「ヴァース」を含む創界神ネクサス1つを破壊することで、自分のデッキを上から5枚オープンする。その中の、「アルドノアドライブ」1枚を手札に加え、アルティメットカード1枚を召喚条件を無視してコストを支払わずに召喚する。残ったカードはデッキの下に戻す。",
    ],
    keywordTags: [],
    tribe: "火星",
    image: "images/BSAZ02-C16.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0]〔ターンに1回：同名〕トラッシュにあるこのカードは、自分のエンドステップに、
      //   手札の系統：「火星」を持つカードと入れ替えられる。
      //   engine-atomic-hand-trash-swap-legal-action (BSTH02.7-TR03(A) precedent) を
      //   applicability.zone:"trash" (トラッシュ常駐) + timing.kind:"phase"/step:"end"/
      //   whose:"self" (自分のエンドステップ限定) へ適用。「このカード」は発揮元の個体。
      {
        applicability: { zone: ["trash"] },
        timing: { kind: "phase", step: "end", whose: "self" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        condition: [
          {
            kind: "cards_in_zone",
            player: "self",
            zone: ["hand"],
            filter: { tribes: ["火星"] },
            min: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "queue_hand_trash_swap",
              outgoingFilter: { tribes: ["火星"] },
              outgoingZones: ["hand"],
              incomingFilter: {},
              incomingFrom: "source_card",
            },
          },
        ],
        textRef: [0],
      },
      // [2] 手札にあるこのカードは、自分の導界者ネクサスが相手の効果の対象になるとき、
      //   コストを支払わずに使用できる。BSAZ02-M02 effects[1] precedent と同型
      //   (targetsGrandwalker:"only"+hasMechanic:["guided"]+cause:opponent_effect+
      //   use_magic_without_cost)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "targeted",
          triggerFilter: {
            category: ["nexus"],
            targetsGrandwalker: "only",
            hasMechanic: ["guided"],
          },
          cause: ["opponent_effect"],
        },
        applicability: { zone: "hand" },
        executionMode: "optional",
        steps: [
          { action: { kind: "use_magic_without_cost", magicTiming: "flash" } },
        ],
        textRef: [2],
      },
      // [4,5] フラッシュ〔ターンに1回：同名〕自分の「ヴァース」を含む創界神ネクサス1つを
      //   破壊することで、自分のデッキを上から5枚オープンする。その中の、
      //   「アルドノアドライブ」1枚を手札に加え、アルティメットカード1枚を召喚条件を無視して
      //   コストを支払わずに召喚する。残ったカードはデッキの下に戻す。
      //   「破壊することで」= conditional_cost（BSAZ02-M02 effects[2] destroy→summon
      //   precedent と同型）。destroy 側フィルタ targetsGrandwalker:"only"+cardName「ヴァース」は
      //   本文の「ヴァース」を含む創界神ネクサス破壊を表す。C09 のコア配置先は導界者
      //   ネクサスであり grandwalkerKind:"guided" まで要する別の裁定軸なので、ここでは
      //   同型と扱わない。導界者ネクサスも創界神ネクサス対象の作用効果を受けるため
      //   targetsGrandwalker:"only" は維持するが、本文どおり cardName の「ヴァース」限定も要る。
      //   deck_reveal destination:"field" ピックはコスト不要 (deck_reveal 自体がコスト支払いを
      //   経由しない) + isEffectSummonFieldEntry 判定でカテゴリ:ultimate は自動的に
      //   card_event "summon" として扱われる (pending-action-handlers.ts finalizeDeckReveal)。
      //   「召喚条件を無視して」は effect駆動summon (deck_reveal 経由の field entry含む) が
      //   元々 summonCondition を検査しないため追加実装不要 (BSAZ02-C11 effects[6,7] コメント
      //   参照)。維持コアは ENGINE-deck-reveal-field-entry-core-fill
      //   (pending-action-handlers.ts finalizeDeckReveal、本カードの adversarial verifier
      //   round1 で判明した BSAZ01-CX01 由来の既存ギャップの解消) により、通常 summon action の
      //   「fallback: 自動経路」(structured-summon.ts) と同型の deterministic 補填でリザーブから
      //   自動配置される。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                  cardName: [{ contains: "ヴァース" }],
                },
                count: 1,
              },
            },
          },
          {
            action: {
              kind: "deck_reveal",
              revealCount: 5,
              picks: [
                {
                  count: 1,
                  filter: {
                    cardName: {
                      contains: "アルドノアドライブ",
                    },
                  },
                  destination: "hand",
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    category: ["ultimate"],
                  },
                  destination: "field",
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C17",
    orikaId: 340,
    orikaIndex: 354,
    name: "青い薔薇の花言葉",
    printedCategory: "magic",
    colors: ["white"],
    cost: 6,
    reductionSymbols: ["white", "white", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "系統：「火星」を持つ自分のアルティメットがアタック/ブロックしている間、手札にあるこのカードのコストを4にする。",
      "",
      "フラッシュ",
      "シンボル1つの相手のスピリット/アルティメットを1体をデッキの下に戻す。その後、自分のトラッシュの系統：「火星」を持つネクサスカード1枚をコストを支払わずに配置する。配置した導界者ネクサスの「配置したとき」の【導託】は発揮されない。",
    ],
    keywordTags: [],
    tribe: "火星",
    image: "images/BSAZ02-C17.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 系統：「火星」を持つ自分のアルティメットがアタック/ブロックしている間、手札にある
      //   このカードのコストを4にする。field_has.battleState:"in_battle" (アタック中/
      //   ブロック中いずれか、本カードで新設) + applicability.zone:["hand"] + cost_modify
      //   override (BSAZ02-C18 precedent と同型)。
      {
        applicability: { zone: ["hand"] },
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["ultimate"],
            tribes: ["火星"],
            battleState: "in_battle",
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { override: 4 },
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ シンボル1つの相手のスピリット/アルティメットを1体をデッキの下に
      //   戻す。その後、自分のトラッシュの系統：「火星」を持つネクサスカード1枚をコストを
      //   支払わずに配置する。配置した導界者ネクサスの配置時【導託】は発揮されない
      //   (SummonAction.suppressPlacementOracle、本カードで新設)。
      {
        timing: { kind: "activated", mode: "flash" },
        executionMode: "optional",
        steps: [
          {
            id: "bounce",
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
                  symbolCount: 1,
                },
                count: 1,
              },
              position: "bottom",
            },
          },
          {
            targetSelectionTiming: "on_step",
            connector: "sequential",
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["trash"],
                filter: { category: ["nexus"], tribes: ["火星"] },
                count: 1,
              },
              costModifier: "free",
              suppressPlacementOracle: true,
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSAZ02-C18",
    orikaId: 341,
    orikaIndex: 355,
    name: "旋転する罠",
    printedCategory: "magic",
    colors: ["white"],
    cost: 7,
    reductionSymbols: ["white", "white", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "系統：「火星」を持つ自分のアルティメットがいるとき、手札にあるこのカードのコストを5にする。",
      "",
      "フラッシュ",
      "スピリット/アルティメット1体をデッキの下に戻す。この効果で系統：「アルドノア」持つ自分のアルティメットを戻したとき、〔ゲームに1回：同名〕そのアルティメットの本来のコスト1につき、ボイドからコア1個を自分のリザーブに置く。",
    ],
    keywordTags: [],
    tribe: "火星",
    image: "images/BSAZ02-C18.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0]「系統：火星を持つ自分のアルティメットがいるとき、手札にあるこのカードの
      //   コストを5にする」。条件付き複数ゾーン自カードコスト固定 (BSSL01-X03 precedent
      //   と同型、applicability.zone:["hand"]+condition(field_has)+cost_modify
      //   modifier:{override:5}。cost-system.getEffectiveBaseCostOverride が
      //   card.effects 直接読みで評価する)。
      {
        applicability: { zone: ["hand"] },
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["ultimate"],
            tribes: ["火星"],
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { override: 5 },
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ：スピリット/アルティメット1体をデッキの下に戻す。この効果で
      //   系統「アルドノア」持つ自分のアルティメットを戻したとき、〔ゲームに1回：同名〕
      //   そのアルティメットの本来のコスト1につきボイドからコア1個をリザーブに置く。
      //   「自分の」は結果成立時のコントローラー、系統は付与を含む実効値で照合する。
      //   「本来のコスト1につき」は DynamicCountSource.cost_from_ref を新設し、
      //   send_to_deck ステップの affected カードの printed cost を合算する
      //   (ENGINE-dynamic-count-cost-from-ref)。
      {
        timing: { kind: "activated", mode: "flash" },
        executionMode: "optional",
        steps: [
          {
            id: "bounce",
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "either",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                  ],
                },
                count: 1,
              },
              position: "bottom",
            },
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_has_match",
              stepId: "bounce",
              filter: { category: ["ultimate"], tribes: ["アルドノア"] },
              controllerRelation: "self",
            },
            // 〔ゲームに1回：同名〕は「戻す」全体ではなく、この条件付きコア移動だけを
            // 制限する。sourceText で後段 step への本文帰属を明示し、fidelity 監査でも
            // effect 全体の使用制限として誤認しないようにする。
            prompt: {
              sourceText:
                "この効果で系統：「アルドノア」持つ自分のアルティメットを戻したとき、〔ゲームに1回：同名〕そのアルティメットの本来のコスト1につき、ボイドからコア1個を自分のリザーブに置く。",
            },
            usageLimit: { kind: "per_card_name", duration: "game" },
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "reserve", player: "self" },
              amount: {
                source: {
                  kind: "cost_from_ref",
                  stepId: "bounce",
                  filter: { category: ["ultimate"], tribes: ["アルドノア"] },
                  costBasis: "printed",
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
    cardNo: "BSAZ02-M01",
    orikaId: 342,
    orikaIndex: 356,
    name: "揚陸城",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white"],
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
    symbolColors: ["white"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札にあるこのカードは配置でき、そうしたとき、スピリットすべてを疲労させる。",
      "",
      "【アルドノアドライブ：1】（このネクサスの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る。）",
      "",
      "Lv1-Lv2【弾幕：コスト5以下】",
      "このネクサスは、コスト5以下の相手の効果を受けない。",
      "",
      "Lv2『お互いのアタックステップ』",
      "系統：「火星」を持つ自分のアルティメットが1体の間、自分のライフは0にならない。",
      "自分のライフが1のとき、相手は系統：「火星」を持つ自分のアルティメットに指定アタックできる。そうした相手のターン終了時、自分の 「揚陸城」すべての下にある「アルドノアドライブ」すべてを破棄する。",
    ],
    keywordTags: [],
    tribe: "火星・アルドノア",
    image: "images/BSAZ02-M01.webp",
    rarity: "M",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【アルドノアドライブ：1】host 側キーワード宣言（BSAZ02-C07/R01 precedent）。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
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
          zone: ["hand"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "self",
              },
            },
            id: "place-self",
          },
          {
            connector: "conditional_result",
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "either",
                filter: {
                  category: ["spirit"],
                },
                count: "all",
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          level: {
            min: 1,
            max: 2,
          },
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
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
              sourceScope: {
                maxCost: 5,
              },
            },
          },
        ],
        textRef: [3, 5, 6],
      },
      {
        timing: {
          kind: "continuous",
        },
        applicability: {
          level: {
            min: 2,
            max: 2,
          },
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
          {
            kind: "field_has",
            player: "self",
            category: ["ultimate"],
            tribes: ["火星"],
            minCount: 1,
            maxCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "floor",
              floor: 1,
              duration: {
                scope: "permanent",
              },
            },
          },
        ],
        textRef: [8, 9],
        timingScope: {
          player: "both",
          period: "attack",
        },
      },
      {
        timing: {
          kind: "phase",
          step: "end",
          whose: "opponent",
        },
        applicability: {
          level: {
            min: 2,
            max: 2,
          },
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
          {
            kind: "attack_occurred",
            scope: "turn",
            player: "opponent",
            targetFilter: {
              category: ["ultimate"],
              tribes: ["火星"],
            },
            targetControllerLifeAtDeclaration: {
              min: 1,
              max: 1,
            },
          },
        ],
        steps: [
          {
            action: {
              kind: "move_card",
              from: {
                zone: "field",
                player: "self",
                hostFilter: {
                  cardName: {
                    contains: "揚陸城",
                  },
                },
                hostUnderCardRoleTag: "アルドノアドライブ",
              },
              to: {
                zone: "trash",
              },
              count: -1,
            },
          },
        ],
        textRef: [8, 10],
      },
    ],
  },
  {
    cardNo: "BSAZ02-M02",
    orikaId: 343,
    orikaIndex: 357,
    name: "アセイラム姫暗殺事件",
    printedCategory: "magic",
    colors: ["white", "yellow"],
    cost: 3,
    reductionSymbols: ["white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ターンに1回：同名〕トラッシュにあるこのカードは、系統：「火星」を持つネクサスが配置されたとき、手札に戻せる。",
      "",
      "手札にあるこのカードは、自分の導界者ネクサスが相手の効果の対象になるとき、コストを支払わずに使用できる。",
      "",
      "フラッシュ",
      "〔ターンに1回:同名〕自分の「ヴァース」を含む導界者ネクサス1つを破壊することで、手札のコスト7以下のアルティメットカード1枚を召喚条件を無視してコストを支払わずに召喚する。",
    ],
    keywordTags: [],
    tribe: "火星",
    image: "images/BSAZ02-M02.webp",
    rarity: "M",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0]〔ターンに1回：同名〕トラッシュにあるこのカードは、系統「火星」ネクサスが配置された
      //   とき（自分/相手いずれの配置でも良い、BSAZ02-M03 effects[0] 同型の第三者トラッシュ常駐
      //   リスナー。player:"either"+sourceWhose:"either"）手札に戻せる。M03 との差分は
      //   usageLimit.duration が turn（M03 は game）。
      {
        applicability: { zone: ["trash"] },
        timing: {
          kind: "game_event",
          player: "either",
          event: "place",
          triggerFilter: { category: ["nexus"], tribes: ["火星"] },
          sourceWhose: "either",
        },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "move_card",
              target: { kind: "self" },
              from: { zone: "trash", player: "self" },
              to: { zone: "hand" },
              count: 1,
              requireFullCount: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2] 手札にあるこのカードは、自分の導界者ネクサスが相手の効果の対象になるとき、コストを
      //   支払わずに使用できる。BSES01-C01 effects[2] precedent（targetsGrandwalker:"only"+
      //   hasMechanic:["guided"]で導界者ネクサスのみに絞り、cause:["opponent_effect"]で
      //   相手発の対象化に限定）+ BSAZ02-C15 effects[0] precedent（use_magic_without_cost）。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "targeted",
          triggerFilter: {
            category: ["nexus"],
            targetsGrandwalker: "only",
            hasMechanic: ["guided"],
          },
          cause: ["opponent_effect"],
        },
        applicability: { zone: "hand" },
        executionMode: "optional",
        steps: [
          {
            action: { kind: "use_magic_without_cost", magicTiming: "flash" },
          },
        ],
        textRef: [2],
      },
      // [4,5] フラッシュ〔ターンに1回:同名〕自分の「ヴァース」を含む導界者ネクサス1つを破壊
      //   することで、手札のコスト7以下のアルティメットカード1枚を召喚条件を無視してコストを
      //   支払わずに召喚する。「破壊することで」= conditional_cost（BSAZ01-C? destroy→destroy
      //   precedent と同型、支払い不能ならロールバック）。「召喚条件を無視して」は
      //   SummonAction.ignoreSummonCondition でこの summon action 単発の gate をバイパスする。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: "only",
                  hasMechanic: ["guided"],
                  cardName: { contains: "ヴァース" },
                },
                count: 1,
              },
            },
          },
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand"],
                filter: {
                  category: ["ultimate"],
                  maxCost: 7,
                },
                count: 1,
              },
              costModifier: "free",
              ignoreSummonCondition: true,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSAZ02-M03",
    orikaId: 344,
    orikaIndex: 358,
    name: "情報分断",
    printedCategory: "magic",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "［ゲームに1回：同名］トラッシュにあるこのカードは、系統：「火星」を持つネクサスが配置されたとき、手札に戻せる。",
      "",
      "スタック",
      "［ゲームに2回：同名］系統：「火星」を持つ自分のネクサスがあるとき、このターンの間、相手のデッキ/トラッシュは、【神託】/【導託】以外の相手のスピリット/ネクサスの効果を受けない。",
    ],
    keywordTags: ["oracle"],
    tribe: "火星",
    image: "images/BSAZ02-M03.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0]［ゲームに1回：同名］トラッシュのこのカードは、系統「火星」ネクサスが配置された
      //   とき（自分/相手いずれの配置でも良い＝「自分の」限定が無い、BSAZ02-M04 effects[0]
      //   との差分）手札に戻せる。M04 effects[0] と同型の第三者トラッシュ常駐リスナー
      //   (applicability.zone:"trash" + game_event event:"place")。player:"either" で
      //   両プレイヤーのネクサス配置を観測する。sourceWhose:"either" も必須
      //   (ENGINE-leave-field-third-party-opponent-source-whose 系と同型: game_event の
      //   whose は既定 "self" のため、相手の配置イベントで isSelf=false となり誤ブロックされる。
      //   BSDB01-CX01/BSTH001-C04/BSTH002-C? 等の第三者 opponent 観測 precedent と同じ opt-in)。
      {
        applicability: { zone: ["trash"] },
        timing: {
          kind: "game_event",
          player: "either",
          event: "place",
          triggerFilter: { category: ["nexus"], tribes: ["火星"] },
          sourceWhose: "either",
        },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "game" },
        steps: [
          {
            action: {
              kind: "move_card",
              target: { kind: "self" },
              from: { zone: "trash", player: "self" },
              to: { zone: "hand" },
              count: 1,
              requireFullCount: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] スタック［ゲームに2回：同名］系統「火星」を持つ自分のネクサスがあるとき、この
      //   ターンの間、相手のデッキ/トラッシュは【神託】/【導託】以外の相手のスピリット/ネクサス
      //   の効果を受けない。神託/導託は mechanic の専用経路で解決するため、このカード効果への
      //   免疫の対象外。創界神/導界者自身の通常効果には免疫を適用する。zone 全体免疫は
      //   effect_immunity の target.zone (ENGINE-effect-immunity-hand-zone-scope と同型) で
      //   従来対応済みだが、duration:"turn" の zone-wide 動的免疫 (ソースのゾーン滞在ではなく
      //   経過ターン数で寿命管理) は while_on_field/while_set 限定だった dynamicTargetFilter
      //   分岐に "turn" を追加して解禁した (ENGINE-effect-immunity-turn-scope-zone-filter、
      //   structured-continuous-effects.ts executeEffectImmunity)。
      //   sourcePlayerScope:"self" は「(対象カードの持ち主=相手) 自身が発動した効果」を阻止する
      //   ("自分の効果を受けない"型、isCardImmuneToOpponentEffect の sourcePlayerRelation 判定)。
      {
        timing: { kind: "activated", mode: "stack" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["nexus"],
            tribes: ["火星"],
          },
        ],
        usageLimit: {
          kind: "per_card_name",
          duration: "game",
          maxCount: 2,
        },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {},
                count: "all",
                zone: ["deck", "trash"],
              },
              duration: { scope: "turn" },
              sourcePlayerScope: "self",
              sourceScope: {
                categories: ["spirit", "nexus"],
                excludedAspects: ["oracle"],
              },
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSAZ02-M04",
    orikaId: 345,
    orikaIndex: 359,
    name: "眠れる月の少女",
    printedCategory: "magic",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ターンに1回：同名〕トラッシュにあるこのカードは、系統：「火星」を持つ自分のネクサスがフィールドを離れたとき、手札に戻せる。",
      "",
      "フラッシュ",
      "〔ターンに1回：同名〕トラッシュにある系統：「火星」を持つネクサスカード2枚までをコストを支払わずに配置する。この効果で配置したとき、フィールド/リザーブのコア1個を自分のライフに置ける。",
    ],
    keywordTags: [],
    tribe: "火星",
    image: "images/BSAZ02-M04.webp",
    rarity: "C",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0]〔ターンに1回：同名〕トラッシュのこのカードは、自分の火星ネクサスがフィールドを
      //   離れたとき手札に戻せる。BSAZ03-M01 effects[0] と同型 (applicability.zone:"trash" +
      //   game_event leave_field + 第三者トラッシュ常駐リスナー、既存プリミティブのみ)。
      //   原文に「相手によって」の限定が無いため cause は指定しない (全 cause で誘発)。
      {
        applicability: { zone: ["trash"] },
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          exactEventKind: true,
          triggerFilter: { category: ["nexus"], tribes: ["火星"] },
        },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "move_card",
              target: { kind: "self" },
              from: { zone: "trash", player: "self" },
              to: { zone: "hand" },
              count: 1,
              requireFullCount: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ〔ターンに1回：同名〕: トラッシュの火星ネクサス2枚までをコスト不要
      //   配置する。BSLH01-M系 (packages/card-data/src/cards/BSLH01.ts:2049) と同型の
      //   summon target:{kind:"from_zone", count:{min:0,max:2}} + costModifier:"free"。
      //   「この効果で配置したとき」= conditional_result 接続 (前段成功が前提、BSTH02.7 Lv2-3
      //   アタック時 deck→trash→life と同型) で「フィールド/リザーブのコア1個をライフに
      //   置ける」= core_move from:{kind:"field", includeReserve:true} (BSTH001-X01 SSOT)。
      {
        timing: { kind: "activated", mode: "flash" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "trash",
                filter: { category: ["nexus"], tribes: ["火星"] },
                count: { min: 0, max: 2 },
              },
              costModifier: "free",
            },
          },
          {
            connector: "conditional_result",
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self", includeReserve: true },
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
    cardNo: "BSAZ02-R01",
    orikaId: 346,
    orikaIndex: 360,
    name: "エレクトリス",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 6,
    reductionSymbols: ["white", "white", "white", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 15000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 17000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3-Lv4『このアルティメットの召喚/アタック/ブロック時』",
      "ターンに1回、本来のコスト7以下の相手のスピリット/ネクサス3つまでをデッキの下に戻せる。",
      "",
      "Lv3-Lv4",
      "このアルティメットは、相手のスピリット／ネクサスの効果を受けない。",
      "",
      "Lv3-Lv4『このアルティメットのアタック時』",
      "相手は手札のスピリットカード/アルティメットカード/ネクサスカードを使用できない。",
    ],
    keywordTags: [],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-R01.webp",
    rarity: "R",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0]《召喚条件：ＣＦアルティメット0体》。BSAZ02-C01/C02/R03 precedent と同型
    //   （exact-zero field_has、minCount:0 明示必須）。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [2]【アルドノアドライブ：1】host 側キーワード宣言（BSAZ02-C01/C02/R03 precedent）。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,4,5] Lv3-4『召喚/アタック/ブロック時』ターンに1回、本来のコスト7以下の相手の
      //   スピリット/ネクサス3つまでをデッキ下に戻せる。閾値は needs-ruling.jsonl
      //   BSAZ02-R01 2026-07-15 ユーザー裁定で7と確定済み（BSAZ02-C15「本来のコスト6以下」
      //   とは別値）。send_to_deck + maxCost:7/costBasis:"printed" + count:{min:0,max:3} は
      //   BSAZ02-C15 precedent と同型。「召喚/アタック/ブロック時」複数イベントトリガーは
      //   BSES01-M04 effects[2] precedent、「ターンに1回」(同名指定なし) は per_instance
      //   （BSAZ02-C02 effects[1] precedent）。
      {
        timing: { kind: "card_event", event: ["summon", "attack", "block"] },
        applicability: { level: { min: 3, max: 4 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "nexus"],
                  maxCost: 7,
                  costBasis: "printed",
                },
                count: { min: 0, max: 3 },
              },
              position: "bottom",
            },
          },
        ],
        textRef: [2, 4, 5],
      },
      // [2,7,8] Lv3-4 このアルティメットは、相手のスピリット／ネクサスの効果を受けない。
      //   effect_immunity(sourceScope:categories) は BSAZ02-C05「相手のスピリットの効果を
      //   受けない」(sourceScope:{categories:["spirit"]}) precedent と同型、nexus を追加。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 3, max: 4 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
              sourceScope: { categories: ["spirit", "nexus"] },
            },
          },
        ],
        textRef: [2, 7, 8],
      },
      // [2,10,11] Lv3-4『このアルティメットのアタック時』相手は手札のスピリットカード/
      //   アルティメットカード/ネクサスカードを使用できない。restrict_use +
      //   自身の攻撃中の常時効果。読点なしの「相手は」はカード対象で、手札だけを制限する。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 3, max: 4 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
          {
            kind: "self_state",
            state: "on_field",
            reference: "self",
            battleState: "attacking",
          },
        ],
        steps: [
          {
            action: {
              kind: "restrict_use",
              player: "opponent",
              targetScope: "card",
              filter: {
                category: ["spirit", "ultimate", "nexus"],
                zone: ["hand"],
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 10, 11],
      },
    ],
  },
  {
    cardNo: "BSAZ02-R02",
    orikaId: 347,
    orikaIndex: 361,
    name: "ニロケラス",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 5,
    reductionSymbols: ["white", "white", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 8000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3『このアルティメットの召喚/アタック時』",
      "ターンに1回、自分のターンなら、創界神ネクサス2つまでを破壊する。この効果で「ヴァース」を破壊したとき、［ゲームに1回同名］自分はデッキの上から3枚ドローする。",
      "",
      "Lv3",
      "自分のカウント5以下のとき、このアルティメットは、相手の効果を受けない。相手がカードを召喚/配置/使用したとき、自分のカウント+1する。さらにこのアルティメットとバトルしたスピリット/アルティメットは、ただちに除外される。この除外効果は相手の効果で防げない。",
    ],
    keywordTags: [],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-R02.webp",
    rarity: "R",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0]《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》。BSAZ02-C01 precedent と同型。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [2]【アルドノアドライブ：1】host 側キーワード宣言 (BSAZ02-C07/C10 precedent と同型)。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,4,5]【アルドノアドライブ：1】ゲート付き Lv3『召喚/アタック時』〔ターンに1回〕自分の
      //   ターンなら創界神ネクサス2つまで破壊。「創界神ネクサス」= targetsGrandwalker:true
      //   （BSDB01-R01[7,8] 同型、「2つまで」= count{min:0,max:2}）。「自分のターンなら」=
      //   turn_player primitive（BSSG01-R01 同型）。「この効果で『ヴァース』を破壊したとき」=
      //   destroy step id 参照 + StepCondition.ref_has_match(filter.cardNames)（BSAZ02-C18
      //   precedent、dsl-types.ts:794-813）。「ゲームに1回同名」ドローは destroy 側の
      //   〔ターンに1回〕(usageLimit:per_instance/turn、effect 全体) とは独立スコープのため
      //   draw step 側に usageLimit:per_card_name/game を個別指定（EffectStep.usageLimit、
      //   dsl-types.ts:3679）。
      {
        timing: { kind: "card_event", event: ["summon", "attack"] },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
          { kind: "turn_player", player: "self" },
        ],
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            id: "destroy-grandwalker",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "either",
                // targetsGrandwalker:"only" 必須。true(非"only") は既定除外の opt-in に
                // すぎず「創界神ネクサスのみ」への絞り込みにはならない
                // (card-filter.ts の既定除外/only 分岐、BSES01-CX01 precedent)。
                filter: { category: ["nexus"], targetsGrandwalker: "only" },
                count: { min: 0, max: 2 },
              },
            },
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_has_match",
              stepId: "destroy-grandwalker",
              // targetsGrandwalker:true (bypass 用) 必須。既定では創界神/導界者ネクサスは
              // card-filter.ts の既定除外に掛かり、名前一致条件だけでは拾えない。
              // (destroy-grandwalker 側は targetsGrandwalker:"only" で候補を絞り込み済みの
              // ため、ここでの affected は既に創界神ネクサスのみ。true で十分)。
              filter: {
                cardName: { contains: "ヴァース" },
                targetsGrandwalker: true,
              },
            },
            usageLimit: {
              kind: "per_card_name",
              duration: "game",
              maxCount: 1,
            },
            // ［ゲームに1回同名］は直前の「ヴァース」を破壊したときのドローだけを
            // 制限する。親Effectのターン個体制限とは別軸なので、本文範囲を後段stepへ
            // 明示して constraint 監査でも独立した制限として照合する。
            prompt: {
              sourceText:
                "この効果で「ヴァース」を破壊したとき、［ゲームに1回同名］自分はデッキの上から3枚ドローする。",
            },
            action: { kind: "draw", count: 3 },
          },
        ],
        textRef: [2, 4, 5],
      },
      // [7,8]【アルドノアドライブ：1】ゲート付き Lv3 継続: 自分のカウント5以下のとき相手の
      //   効果を受けない。count_value(max)+effect_immunity（BSRK01-X02[7,8] 同型）。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
          { kind: "count_value", player: "self", max: 5 },
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
      // [7,8] 召喚/配置/マジック使用と派生効果の解決完了を一度だけ観測する。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "card_used",
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
        textRef: [7, 8],
      },
      // [7,8]「このアルティメットとバトルしたスピリット/アルティメットは、ただちに除外される。
      //   この除外効果は相手の効果で防げない。」card_event:battle_end（自己観測）+
      //   TargetSpec.trigger_related_instances。queueBattleEndTriggers
      //   (trigger-system.ts) を拡張し、battle_end イベントの relatedInstanceIds に
      //   対戦相手側参加体 (アタック側/ブロック側の反対サイド) を積むようにした
      //   (engine-battle-partner-target、既存カードは未設定のため純粋加算・回帰なし)。
      //   「除外」= remove_from_game（vanish ではなく Q19/P3-74 系の実除外、BSTH02-M01 precedent）。
      //   「防げない」= preventionLevel:"unpreventable"（BSAZ02-C01 precedent、本ファイル内）。
      {
        timing: { kind: "card_event", event: "battle_end" },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        preventionLevel: "unpreventable",
        steps: [
          {
            action: {
              kind: "remove_from_game",
              target: { kind: "trigger_related_instances" },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSAZ02-R03",
    orikaId: 348,
    orikaIndex: 362,
    name: "ハーシェル",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 5,
    reductionSymbols: ["white", "white", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 12000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 14000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札にあるこのカードは、召喚できる。",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3-Lv4-Lv5『このアルティメットの召喚時』",
      "ボイドからコア1個をこのアルティメットに置ける。",
      "",
      "Lv4-Lv5 フラッシュ『お互いのアタックステップ』",
      "ターンに2回、BP合計12000まで相手のスピリット/アルティメットを好きなだけデッキの下に戻せる。",
    ],
    keywordTags: [],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-R03.webp",
    rarity: "R",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0]《召喚条件：ＣＦアルティメット0体》。BSAZ02-C01/C05 precedent と同型
    //   （exact-zero field_has、minCount:0 明示必須）。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [5,7,8,10,11]【アルドノアドライブ：1】host 側キーワード宣言（BSAZ02-C01/C05 precedent）。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,3] フラッシュ『お互いのアタックステップ』手札にあるこのカードは召喚できる。
      //   BSAZ02-C05 effects[0] precedent と同型（AldnoahDrive 宣言 [5] より前の行のため
      //   ゲート対象外、C05 と同じく「ターンに1回」限定が無いため usageLimit は付けない）。
      {
        applicability: { zone: "hand" },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [5,7,8]【アルドノアドライブ：1】ゲート付き Lv3-Lv4-Lv5『召喚時』ボイドからコア1個を
      //   このアルティメットに置ける（任意）。BSTH06.ts precedent（core_move from:void→this_card,
      //   executionMode:"optional"）と同型。
      {
        timing: { kind: "card_event", event: "summon" },
        applicability: { level: { min: 3, max: 5 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
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
        ],
        textRef: [5, 7, 8],
      },
      // [5,10,11]【アルドノアドライブ：1】ゲート付き Lv4-Lv5 フラッシュ『お互いのアタックステップ』
      //   ターンに2回、BP合計12000まで相手のスピリット/アルティメットを好きなだけデッキの下に
      //   戻せる。TargetSpec.budget（BSAZ01-C11/BSFT01-TR01(B) precedent、count:{min:0}+
      //   budget:{metric:"bp",amount:<静的値>}）で表現。「ターンに2回」= usageLimit
      //   kind:"per_instance" duration:"turn" maxCount:2（BSTH05.5.ts precedent）。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        applicability: { level: { min: 4, max: 5 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 2 },
        steps: [
          {
            id: "budget_send_to_deck",
            targetSelectionTiming: "on_step",
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: { min: 0 },
                budget: { metric: "bp", amount: 12000 },
              },
              position: "bottom",
            },
          },
        ],
        textRef: [5, 10, 11],
      },
    ],
  },
  {
    cardNo: "BSAZ02-TR01(A)",
    orikaId: 349,
    orikaIndex: 363,
    name: "ヘラス",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 6,
    reductionSymbols: ["white", "white", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 4,
        requiredCores: 2,
        bp: 13000,
      },
      {
        level: 5,
        requiredCores: 3,
        bp: 15000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3-Lv4-Lv5『自分のアタックステップ』",
      "このアルティメットは相手によって破壊されない。",
      "",
      "Lv3-Lv4-Lv5『このアルティメットのアタック/ブロック時』",
      "ターンに1回、このアルティメットは回復できる。そうしたとき、相手のネクサス1つをデッキの下に戻せる。",
      "",
      "Lv4-Lv5【転醒：自分のライフ1以上（転醒は同時に使えない）】",
      "このアルティメットは、フラッシュタイミングで裏返せる。",
    ],
    keywordTags: ["double_sided"],
    // [0]《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》。BSAZ02-C01 precedent と同型。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [2]【アルドノアドライブ：1】host 側キーワード宣言（BSAZ02-C01/C02/C04/C05/C07/C10 precedent）。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,4,5] Lv3-5『自分のアタックステップ』相手によって破壊されない。
      //   effect_resistance(destroy, source:"opponent") + timingScope:{player:"self",
      //   period:"attack"}（BSDB01.ts:1263-1281 precedent と同型）。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        applicability: { level: { min: 3, max: 5 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "destroy",
              source: "opponent",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 4, 5],
      },
      // [2,7,8] Lv3-5『このアルティメットのアタック/ブロック時』ターンに1回、回復できる。
      //   そうしたとき (conditional_result) 相手のネクサス1つをデッキの下に戻せる。
      //   card_event.event 配列 (["attack","block"]) で1本の usageLimit を共有する
      //   （BSAZ02-C05/C07 precedent と同型）。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        applicability: { level: { min: 3, max: 5 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: { kind: "recover", target: { kind: "self" } },
          },
          {
            connector: "conditional_result",
            executionMode: "optional",
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"] },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [2, 7, 8],
      },
      // [2,10,11] Lv4-5【転醒：自分のライフ1以上（転醒は同時に使えない）】フラッシュタイミングで
      //   裏返せる。rebirth + condition:life_value（BSFT01-TR01(A) precedent と同型、
      //   「この効果使用後」ゲートが無い分シンプル）。B面は「フィールドに残る」のみで
      //   カウント増減文言が無いため countBonusMode:"none"。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        applicability: {
          level: {
            min: 4,
            max: 5,
          },
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            condition: [
              {
                kind: "life_value",
                player: "self",
                min: 1,
              },
            ],
            action: {
              kind: "rebirth",
              countBonusMode: "none",
            },
          },
        ],
        textRef: [2, 10, 11],
        activationLabel: "none",
        executionMode: "optional",
      },
    ],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-TR01(A).webp",
    rarity: "TR",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    isDoubleSided: true,
    backFace: {
      name: "ヘラス-本体変形-",
      printedCategory: "ultimate",
      colors: ["white"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 3,
          requiredCores: 1,
          bp: 18000,
        },
      ],
      symbolColors: ["ultimate_symbol"],
      textLines: [
        "この面に裏返ったとき、フィールドに残る。",
        "",
        "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）",
        "",
        "Lv3",
        "このアルティメットは、破壊されず、疲労状態でブロックできる。",
      ],
      keywordTags: [],
      // [2]【アルドノアドライブ：1】host 側キーワード宣言。B 面でも前面と同じ
      // text_role 下カード枠を持ち、BSAZ02-C10 の配置トリガーが転醒後もこの面を
      // host として解決する（engine-aldnoah-drive-under-card-keyword）。
      underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
      tribe: "火星・ＣＦ・アルドノア",
      image: "images/BSAZ02-TR01(B).webp",
      rarity: "TR",
      pack: "BSAZ02 アルドノア・ゼロ-火星-",
      cardNo: "BSAZ02-TR01(B)",
      effects: [
        {
          timing: {
            kind: "continuous",
          },
          condition: [
            {
              kind: "self_under_card_count",
              roleTag: "アルドノアドライブ",
              minCount: 1,
            },
          ],
          steps: [
            {
              action: {
                kind: "effect_resistance",
                target: {
                  kind: "self",
                },
                resistsOutcome: "destroy",
                source: "all",
                duration: {
                  scope: "while_on_field",
                },
              },
            },
            {
              connector: "sequential",
              action: {
                kind: "allow_block_while_exhausted",
                target: {
                  kind: "self",
                },
                duration: {
                  scope: "while_on_field",
                },
              },
            },
          ],
          textRef: [4, 5],
        },
      ],
    },
  },
  {
    cardNo: "BSAZ02-TX01(A)",
    orikaId: 9,
    orikaIndex: 364,
    name: "ディオスクリア-コアロボット-",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 8,
    reductionSymbols: [
      "white",
      "white",
      "white",
      "ultimate_symbol",
      "ultimate_symbol",
      "ultimate_symbol",
    ],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 10000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 12000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札にあるこのカードは、召喚できる。",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下にアルドノアドライブを1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3-Lv4『このアルティメットの召喚時』",
      "自分は、デッキの上から5枚オープンでき、その中のマジックカード以外の系統：「アルドノア」を持つカードすべてを手札に加える。残ったカードは破棄する。",
      "",
      "Lv4【転醒：自分のライフ1以上（転醒は同時に使えない）】",
      "このアルティメットは、自分のメインステップとお互いのアタックステップのフラッシュ/スタックタイミングに裏返せる。",
    ],
    keywordTags: ["double_sided"],
    // [0]《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》。BSAZ02-X01 precedent と同型の
    //   declarative summonCondition（「0体」= exact-zero field_has、minCount:0 明示）。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [5]【アルドノアドライブ：1】host 側キーワード宣言（BSAZ02-C01/X01 precedent）。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,3] フラッシュ『お互いのアタックステップ』手札にあるこのカードは、召喚できる。
      //   BSAZ02-R03/C05 effects[0] precedent と同型（原文が一致、AldnoahDrive宣言[5]より
      //   前の行のためゲート対象外、「ターンに1回」限定が無いため usageLimit は付けない）。
      //   X01 と異なり「ヴァース」条件分岐は無い。
      {
        applicability: { zone: "hand" },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [5,7,8]【アルドノアドライブ：1】ゲート付き Lv3-Lv4『召喚時』デッキ上から5枚
      //   オープンでき、マジック以外の系統：「アルドノア」を持つカードすべてを手札に加え、
      //   残りは破棄する。deck_reveal(picks:[{count:-1,...}], remainder:"trash") の
      //   「count:-1」＝オープン中の一致カードすべてを手札に加える型 (BSTH01.ts:1172
      //   precedent)。「マジック以外」はカテゴリ列挙 (spirit/ultimate/nexus/brave) で表現する。
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        applicability: {
          level: {
            min: 3,
            max: 4,
          },
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 5,
              picks: [
                {
                  count: -1,
                  filter: {
                    tribes: ["アルドノア"],
                    category: ["spirit", "ultimate", "nexus", "brave"],
                  },
                  mandatory: true,
                },
              ],
              remainder: "trash",
            },
          },
        ],
        textRef: [5, 7, 8],
      },
      // [5,10,11]【アルドノアドライブ：1】ゲート付き Lv4【転醒：自分のライフ1以上
      //   （転醒は同時に使えない）】。rebirth + condition:life_value（BSAZ02-TR01(A)
      //   precedent と同型）。TR01(A) は「フラッシュタイミング」＝mode:"flash"のみだが、
      //   本カードの原文は「フラッシュ/スタックタイミング」と両方明記しているため、
      //   mode:"flash"/mode:"stack"（model.ts:406 EffectActivationTiming）をそれぞれ
      //   宣言する。さらに窓が「自分のメインステップとお互いのアタックステップ」の2つ
      //   なので、timingScope 違いと合わせて計4 effect に分割する（BSAZ02-X01 の
      //   スタートステップ自分/相手2分割 precedent の直交軸拡張）。「転醒は同時に
      //   使えない」は engine 側の排他制御（TR01(A) 同様 DSL 表現不要）。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: {
          player: "self",
          period: "main",
        },
        applicability: {
          level: {
            min: 4,
            max: 4,
          },
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            condition: [
              {
                kind: "life_value",
                player: "self",
                min: 1,
              },
            ],
            action: {
              kind: "rebirth",
              countBonusMode: "reset_to_zero",
            },
          },
        ],
        textRef: [5, 10, 11],
        activationLabel: "none",
        executionMode: "optional",
      },
      {
        timing: {
          kind: "activated",
          mode: "stack",
        },
        timingScope: {
          player: "self",
          period: "main",
        },
        applicability: {
          level: {
            min: 4,
            max: 4,
          },
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            condition: [
              {
                kind: "life_value",
                player: "self",
                min: 1,
              },
            ],
            action: {
              kind: "rebirth",
              countBonusMode: "reset_to_zero",
            },
          },
        ],
        textRef: [5, 10, 11],
        activationLabel: "none",
        executionMode: "optional",
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
        applicability: {
          level: {
            min: 4,
            max: 4,
          },
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            condition: [
              {
                kind: "life_value",
                player: "self",
                min: 1,
              },
            ],
            action: {
              kind: "rebirth",
              countBonusMode: "reset_to_zero",
            },
          },
        ],
        textRef: [5, 10, 11],
        activationLabel: "none",
        executionMode: "optional",
      },
      {
        timing: {
          kind: "activated",
          mode: "stack",
        },
        timingScope: {
          player: "both",
          period: "attack",
        },
        applicability: {
          level: {
            min: 4,
            max: 4,
          },
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            condition: [
              {
                kind: "life_value",
                player: "self",
                min: 1,
              },
            ],
            action: {
              kind: "rebirth",
              countBonusMode: "reset_to_zero",
            },
          },
        ],
        textRef: [5, 10, 11],
        activationLabel: "none",
        executionMode: "optional",
      },
    ],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-TX01(A).webp",
    rarity: "TX",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    isDoubleSided: true,
    backFace: {
      name: "ディオスクリア",
      printedCategory: "ultimate",
      colors: ["white"],
      cost: 12,
      reductionSymbols: [],
      levelDefs: [
        {
          level: 3,
          requiredCores: 1,
          bp: 15000,
        },
        {
          level: 4,
          requiredCores: 3,
          bp: 25000,
        },
        {
          level: 5,
          requiredCores: 5,
          bp: 30000,
        },
      ],
      symbolColors: ["ultimate_symbol", "ultimate_symbol"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウントを0にする。（自分のカウントエリアのコアすべてをボイドに置く。）",
        "",
        "【アルドノアドライブ：3】（このアルティメットの下にアルドノアドライブを3枚まで置ける。あるとき、以下の効果を得る）",
        "",
        "Lv3-Lv4-Lv5『このアルティメットの転醒時』",
        "このアルティメットの下の「アルドノアドライブ」の数まで、手札/トラッシュの系統：「ＣＦ」を持つコスト6以下のアルティメットカードをこのアルティメットの下に加えられる。",
        "",
        "Lv4-Lv5",
        "このアルティメットは、このアルティメットの下にあるアルティメットカードすべてのシンボルと【アルドノアドライブ】をLvを無視して得る。さらに、このアルティメットがLv5のとき、このアルティメットの『このアルティメットのアタック時』効果を『このアルティメットのアタック/ブロック時』に変更する。",
      ],
      keywordTags: [],
      // [2]【アルドノアドライブ：3】host 側キーワード宣言。CardBackFace.underCardSlots
      //   (ENGINE-tx01b-backface-under-card-slots で新設) 経由で synthesizeBackFaceDefinition が
      //   合成定義へ伝播する。前面 maxCount:1 (行3759) から転醒後は3に拡張。
      underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 3 }],
      // [0] この面に裏返ったとき、フィールドに残り、カウントを0にする。
      //   これは B面定型文由来の転醒ルール処理であり、効果ではない。
      //   A面の rebirth action が countBonusMode:"reset_to_zero" を明示し、executeRebirth が
      //   転醒成功時点で countValue/protectedCounts を 0 相当に戻す。
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "rebirth",
          },
          condition: [
            {
              kind: "min_level",
              value: 3,
            },
            {
              kind: "self_under_card_count",
              roleTag: "アルドノアドライブ",
              minCount: 1,
            },
          ],
          steps: [
            {
              action: {
                kind: "move_card",
                target: {
                  kind: "filter",
                  player: "self",
                  zone: ["hand", "trash"],
                  filter: {
                    category: ["ultimate"],
                    tribes: ["ＣＦ"],
                    maxCost: 6,
                  },
                  count: {
                    min: 0,
                    max: {
                      source: {
                        kind: "self_under_card_count",
                        roleTag: "アルドノアドライブ",
                      },
                    },
                  },
                },
                from: {
                  zone: ["hand", "trash"],
                  player: "self",
                },
                to: {
                  zone: "field",
                  sourceUnderCardRole: "text_role",
                  textRoleTag: "ＣＦアルティメット",
                },
                count: "all",
              },
            },
          ],
          textRef: [4, 5],
        },
        {
          timing: {
            kind: "continuous",
          },
          applicability: {
            level: {
              min: 4,
              max: 5,
            },
          },
          steps: [
            {
              action: {
                kind: "symbol_add",
                target: {
                  kind: "self",
                },
                symbolSource: {
                  kind: "under_card_symbols",
                  roleTag: "ＣＦアルティメット",
                  filter: { category: ["ultimate"] },
                },
                duration: {
                  scope: "permanent",
                },
              },
            },
          ],
          textRef: [2, 7],
          condition: [
            {
              kind: "self_under_card_count",
              roleTag: "アルドノアドライブ",
              minCount: 1,
            },
          ],
        },
        {
          timing: {
            kind: "continuous",
          },
          applicability: {
            level: {
              min: 4,
              max: 5,
            },
          },
          steps: [
            {
              action: {
                kind: "under_card_slot_capacity_grant",
                target: {
                  kind: "self",
                },
                hostRoleTag: "アルドノアドライブ",
                childRoleTag: "ＣＦアルティメット",
                childFilter: { category: ["ultimate"] },
                duration: {
                  scope: "permanent",
                },
              },
            },
          ],
          textRef: [7, 8],
          condition: [
            {
              kind: "self_under_card_count",
              roleTag: "アルドノアドライブ",
              minCount: 1,
            },
          ],
        },
        {
          timing: {
            kind: "continuous",
          },
          applicability: {
            level: {
              min: 4,
              max: 5,
            },
          },
          condition: [
            {
              kind: "self_under_card_count",
              roleTag: "アルドノアドライブ",
              minCount: 1,
            },
          ],
          steps: [
            {
              action: {
                kind: "grant_effect",
                target: {
                  kind: "self",
                },
                grantedEffectSource: {
                  kind: "card_effects",
                  from: {
                    kind: "under_cards",
                    filter: {
                      category: ["ultimate"],
                    },
                  },
                  afterTextHeader: "【アルドノアドライブ",
                  ignoreLevel: true,
                  additionalEvents: {
                    source: "attack",
                    events: ["block"],
                    condition: [
                      {
                        kind: "min_level",
                        value: 5,
                      },
                    ],
                  },
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
      tribe: "火星・ＣＦ・アルドノア",
      image: "images/BSAZ02-TX01(B).webp",
      rarity: "TX",
      pack: "BSAZ02 アルドノア・ゼロ-火星-",
      cardNo: "BSAZ02-TX01(B)",
    },
  },
  {
    cardNo: "BSAZ02-X01",
    orikaId: 350,
    orikaIndex: 365,
    name: "タルシス",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 7,
    reductionSymbols: [
      "white",
      "white",
      "white",
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
        requiredCores: 2,
        bp: 15000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 21000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回：同名〕手札にあるこのカードは召喚できる。このとき、「ヴァース」があるとき、召喚条件を無視し、軽減シンボルすべてを満たす。",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下にアルドノアドライブを1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3-Lv4-Lv5",
      "相手は、このアルティメットをマジック以外の効果の対象にできず、含めない。",
      "",
      "Lv4-Lv5『お互いのスタートステップ』",
      "〔重複不可〕自分は、ターンプレイヤーのデッキの上から5枚内容を見る。その後、好きなようにデッキの上と下に戻す。",
    ],
    keywordTags: [],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-X01.webp",
    rarity: "X",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0]《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》。BSAZ02-C01 precedent と同型
    //   declarative summonCondition（「0体」= exact-zero field_has、minCount:0 明示）。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [5]【アルドノアドライブ：1】host 側キーワード宣言（BSAZ02-C01/C07/C10 precedent）。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,3] フラッシュ『お互いのアタックステップ』〔ターンに1回：同名〕手札にあるこのカードは
      //   召喚できる。「このとき、「ヴァース」があるとき、召喚条件を無視し、軽減シンボルすべてを
      //   満たす」＝この flash summon 実行時に限定されたバイパス（「このとき」）。
      //   allow_ignore_summon_condition CE（BSAZ02-C11 precedent、permanent な player 単位許可）は
      //   canSummonUltimate が通常メインフェイズ召喚の legal action 列挙 (getAvailableHandCardLegalActions)
      //   からも無条件消費するため、この flash 効果に限定したバイパスには使えない（許可が漏れて
      //   ヴァースがあるだけで通常召喚まで条件無視になってしまう）。代わりに SummonAction 単発の
      //   ignoreSummonCondition フラグ (dsl-types.ts、suppressPlacementOracle と同型) で
      //   executeSummonSelf 実行時にのみ召喚条件をバイパスする。
      //   ヴァースの有無で ignoreSummonCondition/fullReduction を条件分岐できないため
      //   （SummonAction は boolean フラグでしか表現できない）、field_has/field_lacks で排他ゲート
      //   した2 effect に分割し、「ターンに1回：同名」は limitGroupId で両者に共有させる
      //   （BSDB01.ts:684-704 precedent）。
      {
        applicability: { zone: "hand" },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "ヴァース" }],
          },
        ],
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        limitGroupId: "BSAZ02-X01-flash-summon",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "full_reduction",
              ignoreSummonCondition: true,
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        applicability: { zone: "hand" },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        condition: [
          {
            kind: "field_lacks",
            player: "self",
            cardNames: [{ contains: "ヴァース" }],
          },
        ],
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        limitGroupId: "BSAZ02-X01-flash-summon",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [5,7,8]【アルドノアドライブ：1】ゲート付き Lv3-Lv4-Lv5「相手は、このアルティメットを
      //   マジック以外の効果の対象にできず、含めない」。発揮元カテゴリ付きの対象取得制限。
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 3, max: 5 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              duration: { scope: "permanent" },
              source: "opponent_effect",
              resistsOutcome: ["targeted", "included"],
              targetLockSourceFilter: {
                categories: ["spirit", "brave", "ultimate", "nexus"],
              },
            },
          },
        ],
        textRef: [5, 7, 8],
      },
      // [5,10,11]【アルドノアドライブ：1】ゲート付き Lv4-Lv5〔重複不可〕自分のスタートステップに、
      //   自分のデッキの上から5枚内容を見て好きなように上/下に戻す (BSLH01.ts:1502-1510
      //   `timing:{kind:"phase",step:"start",whose:"self"}` precedent + deck_reveal
      //   `revealCount+picks:[]+remainder:"top_or_bottom"` precedent、BSLH01/BSTH01-C04/
      //   BSTH05.5 の「デッキ上N枚を見て上か下に戻す」と同型)。「ターンプレイヤーのデッキ」は
      //   EffectPlayerRef に turn_player が存在しないため、`whose:"self"`（自分視点で自分が
      //   ターンプレイヤー）と `whose:"opponent"`（相手視点で相手がターンプレイヤー）の
      //   2 effect に分割し、それぞれ自分のデッキ/相手のデッキを対象にする等価変換で表現する。
      //   〔重複不可〕は limitGroupId で両 effect に共有させる。
      {
        timing: {
          kind: "phase",
          step: "start",
          whose: "self",
        },
        applicability: {
          level: {
            min: 4,
            max: 5,
          },
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        usageLimit: {
          kind: "no_duplicate",
        },
        limitGroupId: "BSAZ02-X01-start-peek",
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 5,
              picks: [],
              remainder: "top_bottom_split",
              revealTo: "self",
            },
          },
        ],
        textRef: [5, 10, 11],
      },
      {
        timing: {
          kind: "phase",
          step: "start",
          whose: "opponent",
        },
        applicability: {
          level: {
            min: 4,
            max: 5,
          },
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        usageLimit: {
          kind: "no_duplicate",
        },
        limitGroupId: "BSAZ02-X01-start-peek",
        steps: [
          {
            action: {
              kind: "deck_reveal",
              player: "opponent",
              revealCount: 5,
              picks: [],
              remainder: "top_bottom_split",
              revealTo: "self",
            },
          },
        ],
        textRef: [5, 10, 11],
      },
    ],
  },
  {
    cardNo: "BSAZ02-X02",
    orikaId: 351,
    orikaIndex: 366,
    name: "ソリス",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 7,
    reductionSymbols: [
      "white",
      "white",
      "white",
      "ultimate_symbol",
      "ultimate_symbol",
    ],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 16000,
      },
      {
        level: 4,
        requiredCores: 3,
        bp: 18000,
      },
      {
        level: 5,
        requiredCores: 4,
        bp: 22000,
      },
    ],
    symbolColors: ["ultimate_symbol", "ultimate_symbol"],
    textLines: [
      "《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下にアルドノアドライブを1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3-Lv4-Lv5 フラッシュ『お互いのアタックステップ』",
      "ターンに1回、コスト5以下の相手のスピリットすべてを破壊できる。",
      "",
      "Lv4-Lv5『このアルティメットのアタック時』",
      "自分は相手の手札を、内容を見ないで、3枚破棄するか、3枚になるように破棄する。その後、相手のライフのコア1個をトラッシュに置ける。",
      "",
      "Lv5『自分のアタックステップ』",
      "ターンの最初のバトル終了後まで、相手はスタック効果を発揮できない。",
    ],
    keywordTags: [],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-X02.webp",
    rarity: "X",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0]《召喚条件：自分の系統：「ＣＦ」のアルティメット0体》。declarative summonCondition
    //   (BSAZ02-C01 precedent、exact-zero は minCount:0/maxCount:0 明示)。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
      },
    ],
    // [2]【アルドノアドライブ：1】host 側キーワード宣言 (BSAZ02-C01/C07 precedent と同型)。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      // [2,4,5] Lv3-5 フラッシュ『お互いのアタックステップ』ターンに1回、コスト5以下の
      //   相手スピリットすべてを破壊できる。timing:activated/mode:flash + timingScope
      //   (player:both, period:attack) はお互いのアタックステップ限定フラッシュ窓の既存表現
      //   (本ファイル内 BSAZ02-C02 precedent)。「すべて」= count:"all"（BSAZ01 precedent）。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        applicability: { level: { min: 3, max: 5 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], maxCost: 5 },
                count: "all",
              },
            },
          },
        ],
        textRef: [2, 4, 5],
      },
      // [2,7,8] 2026-09-13 ユーザー裁定「発揮側が2つから選ぶ」。
      // 固定3枚破棄と手札3枚になるまでの破棄を発揮側が選択。その後のライフ移動は独立した任意文。
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { level: { min: 4, max: 5 } },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "discard",
              player: "opponent",
              count: 3,
              unseen: true,
            },
            choice: [
              {
                action: {
                  kind: "discard",
                  player: "opponent",
                  count: -1,
                  targetHandSize: 3,
                  unseen: true,
                },
              },
            ],
          },
          {
            connector: "sequential",
            executionMode: "optional",
            action: {
              kind: "core_move",
              from: { kind: "life", player: "opponent" },
              to: { kind: "trash", player: "opponent" },
              amount: 1,
            },
          },
        ],
        textRef: [2, 7, 8],
      },
      // [2,10,11] Lv5『自分のアタックステップ』ターンの最初のバトル終了後まで、
      //   相手はスタック効果を発揮できない。常時効果で、終了処理待ちのバトルは完了に数えない。
      //   読点なしの「相手は」なので effect_source 対象（創界神等の既定除外を維持）。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        applicability: { level: { min: 5, max: 5 } },
        condition: [
          { kind: "completed_battle_count", max: 0 },
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "restrict_stack",
              player: "opponent",
              targetScope: "effect_source",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 10, 11],
      },
    ],
  },
  {
    cardNo: "BSAZ02-X03",
    orikaId: 352,
    orikaIndex: 367,
    name: "オルテュギア",
    printedCategory: "ultimate",
    colors: ["white"],
    cost: 7,
    reductionSymbols: ["white", "white", "white", "ultimate_symbol"],
    levelDefs: [
      {
        level: 3,
        requiredCores: 1,
        bp: 3000,
      },
    ],
    symbolColors: ["ultimate_symbol"],
    textLines: [
      "《召喚条件：「オルテュギア」以外の自分の系統：「ＣＦ」のアルティメット0体》",
      "",
      "【アルドノアドライブ：1】（このアルティメットの下にアルドノアドライブを1枚まで置ける。あるとき、以下の効果を得る）",
      "",
      "Lv3【分身：1】『このアルティメットの召喚/アタック/ブロック時』",
      '自分のデッキを1枚裏向きまでフィールドに置き、ボイドからコア1個を置く。ゲーム終了時まで、そのカードを"「オルテュギア」/コスト7/系統：「火星」・「ＣＦ」・「アルドノア」/<1>Lv3 BP3000/[究極]"、"Lv3 フィールド/トラッシュの「オルテュギア」の【アルドノアドライブ】1つをこのアルティメットの下に「アルドノアドライブ」があるものとして得る。"を持つ白の分身アルティメットとして扱う。（分身アルティメットは、入れ替えできず、自分はコアを1個より少なくできず、手札/手元/デッキに戻るとき破棄される。）',
    ],
    keywordTags: [],
    tribe: "火星・ＣＦ・アルドノア",
    image: "images/BSAZ02-X03.webp",
    rarity: "X",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // [0]《召喚条件：「オルテュギア」以外の自分の系統：「ＣＦ」のアルティメット0体》。
    //   exact-zero field_has (BSAZ02-C01 precedent) に加え、自分自身が生成した「オルテュギア」
    //   分身トークン (下記 effects[0] で category:ultimate 化) が summonCondition の 0 体
    //   カウントを自己ブロックしないよう excludeCardNames を新設 (field_has.cardNames の否定版、
    //   CardFilter.excludeColors/excludeTribeSubstring と同型パターン、model.ts +
    //   structured-condition-eval.ts)。
    summonCondition: [
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["ＣＦ"],
        minCount: 0,
        maxCount: 0,
        excludeCardNames: [{ contains: "オルテュギア" }],
      },
    ],
    // [2]【アルドノアドライブ：1】host 側キーワード宣言 (BSAZ02-C01/C07/R01 precedent と同型)。
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack", "block"],
        },
        condition: [
          {
            kind: "self_under_card_count",
            roleTag: "アルドノアドライブ",
            minCount: 1,
          },
        ],
        steps: [
          {
            id: "place_face_down",
            action: {
              kind: "move_card",
              from: {
                zone: "deck",
                player: "self",
                position: "top",
              },
              to: {
                zone: "field",
                player: "self",
              },
              count: 1,
              faceDown: true,
            },
          },
          {
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "place_face_down",
            },
            action: {
              kind: "core_move",
              from: {
                kind: "void",
                player: "self",
              },
              to: {
                kind: "ref",
                stepId: "place_face_down",
              },
              amount: 1,
            },
          },
          {
            action: {
              kind: "register_act_as_spirit",
              target: {
                kind: "ref",
                stepId: "place_face_down",
              },
              statBlueprint: {
                kind: "static_copy",
                snapshot: {
                  cost: 7,
                  reductionSymbols: [],
                  symbolColors: ["ultimate_symbol"],
                  tribes: ["火星", "ＣＦ", "アルドノア"],
                  levelDefs: [
                    {
                      level: 3,
                      requiredCores: 1,
                      bp: 3000,
                    },
                  ],
                  colors: ["white"],
                },
              },
              overrides: {
                cardName: "オルテュギア",
                keywords: ["discard_on_leave"],
              },
              duration: {
                scope: "while_target_on_field",
              },
            },
          },
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "ref",
                stepId: "place_face_down",
              },
              properties: {
                treatAsCategory: "ultimate",
              },
              duration: {
                scope: "while_target_on_field",
              },
            },
          },
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "ref",
                stepId: "place_face_down",
              },
              resistsOutcome: "core_below_min",
              coreMinimum: 1,
              source: "self",
              duration: {
                scope: "while_target_on_field",
              },
            },
          },
          {
            action: {
              kind: "under_card_role_grant",
              target: {
                kind: "ref",
                stepId: "place_face_down",
              },
              roleTag: "アルドノアドライブ",
              virtualCount: 1,
              duration: {
                scope: "while_target_on_field",
              },
            },
          },
          {
            action: {
              kind: "grant_effect",
              target: {
                kind: "ref",
                stepId: "place_face_down",
              },
              grantedEffectSource: {
                kind: "card_effects",
                from: {
                  kind: "zones",
                  player: "either",
                  zones: ["field", "trash"],
                  filter: {
                    cardName: {
                      contains: "オルテュギア",
                    },
                  },
                  maxCards: 1,
                },
                afterTextHeader: "【アルドノアドライブ",
              },
              duration: {
                scope: "while_target_on_field",
              },
            },
          },
        ],
        textRef: [2, 4, 5],
        executionMode: "optional",
      },
    ],
  },
  {
    cardNo: "BSAZ02-X04",
    orikaId: 353,
    orikaIndex: 368,
    name: "[導界者]アセイラム・ヴァース・アリューシア",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 2,
    reductionSymbols: ["white"],
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
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・導技・導域は、神託・神技・神域としても扱う。",
      "",
      "【導託：〔火星／地球＆コスト3以上〕〔火星＆アルティメット〕〔火星／地球＆ブレイヴ〕】",
      "◆対象の自分のスピリット/アルティメット/ブレイヴを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは白/究極としても扱い、このネクスの【導託】でトラッシュに置かれた「アルドノアドライブ」すべてを手札に加える。",
      "",
      "【導域】Lv1-Lv2",
      "自分のスピリット/アルティメット/ネクサスの下にある裏向きのカードを「アルドノアドライブ」として扱う。自分が【アルドノアドライブ】を持つカードを召喚/配置したとき、ただちにトラッシュにある「アルドノアドライブ」を裏向きで下における。",
      "",
      "【導技：2】Lv2 フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回：同名〕このネクサスのコア2個をボイドに置く〕トラッシュのコア1個を自分のライフに置く。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    // textLines[0] (導界者ネクサス本体ルール・コア配置制約) は keywordTags
    // (guided_nexus + enter_field_core_placement_forbidden) + isGrandwalkerOrGuidedNexus
    // 経由のエンジン基盤で表現済み。textLines[2,3,4] (【導託】召喚/煌臨時コア+1・配置時神託)
    // は grandwalkerData.oracleConditions/placementOracle のエンジン基盤 (oracle-system.ts)
    // で自動処理されるため、いずれも専用 effects エントリは不要 (BSTH03-X02/BSLH01-X01 precedent)。
    grandwalkerData: {
      kind: "guided",
      // textLines[3] は「召喚/煌臨したとき」だけ。配置/使用イベントでは導託しない。
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        { tribes: ["火星", "地球"], categories: ["spirit"], minCost: 3 },
        { tribes: ["火星"], categories: ["ultimate"] },
        { tribes: ["火星", "地球"], categories: ["brave"] },
      ],
      // textLines[6] 後半「このネクスの【導託】でトラッシュに置かれた『アルドノアドライブ』
      //   すべてを手札に加える」。engine-placement-oracle-return-by-name。
      placementOracleReturnToHand: {
        cardName: { contains: "アルドノアドライブ" },
      },
      // textLines[10,11]【導技：2】Lv2 フラッシュ『お互いのアタックステップ』
      //   〔ターンに1回：同名〕コア2個をボイドに置く→トラッシュのコア1個をライフに置く。
      //   導技=神技扱い、コスト・ターン制限は divineSkills 経路 (BSTH03-X02 precedent)。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 2,
          timing: { step: "attack", whose: "both", mode: "flash" },
          minLevel: 2,
          maxLevel: 2,
          turnLimit: "once_per_name",
          effects: [
            {
              textRef: [11, 12],
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "core_move",
                    from: { kind: "trash", player: "self" },
                    to: { kind: "life", player: "self" },
                    amount: 1,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    tribe: "導界者・火星・アルドノア",
    image: "images/BSAZ02-X04.webp",
    rarity: "X",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
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
              asColor: "white",
            },
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
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["summon", "place"],
          triggerFilter: {
            declaresUnderCardSlot: "アルドノアドライブ",
          },
        },
        executionMode: "optional",
        triggerPriority: "immediate",
        steps: [
          {
            action: {
              kind: "place_text_role_under_card",
              hostTarget: {
                kind: "trigger_related_instance",
              },
              roleTag: "アルドノアドライブ",
              fallbackMaxCount: 1,
              moveFrom: "trash_by_card_name",
              cardName: {
                contains: "アルドノアドライブ",
              },
              placeFaceDown: true,
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
              kind: "under_card_role_grant",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit", "ultimate", "nexus"],
                  targetsGrandwalker: true,
                },
                count: "all",
              },
              roleTag: "アルドノアドライブ",
              faceDownCards: true,
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
    cardNo: "BSAZ02-X05",
    orikaId: 354,
    orikaIndex: 369,
    name: "[導界者]レムリナ・ヴァース・エンヴァース",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 2,
    reductionSymbols: ["white"],
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
    symbolColors: ["guide"],
    textLines: [
      "このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサスには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・導技・導域は、神託・神技・神域としても扱う。",
      "",
      "【導託：〔火星＆コスト3以上〕〔火星＆アルティメット〕〔火星＆ブレイヴ〕】",
      "◆対象の自分のスピリット/アルティメット/ブレイヴを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクスのシンボルは白/究極としても扱い、このネクサスの【導託】でトラッシュに置かれた「アルドノアドライブ」すべてを手札に加える。",
      "",
      "【導域】Lv1-Lv2",
      "自分のスピリット/アルティメット/ネクサスの下にある裏向きのカードを「アルドノアドライブ」として扱う。自分が【アルドノアドライブ】を持つカードを召喚/配置したとき、ただちにトラッシュにある「アルドノアドライブ」を裏向きで下における。",
      "",
      "【導技：3】Lv2 フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回：同名〕〔このネクサスのコア3個をボイドに置く〕手札の系統：「アルドノア」を持つカード1枚をコストを支払わずに召喚/配置する。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    // textLines[0,2,3,4] は BSAZ02-X04 と同型: keywordTags + grandwalkerData
    // (oracleConditions/placementOracle) のエンジン基盤で自動処理され、専用 effects 不要。
    grandwalkerData: {
      kind: "guided",
      // textLines[3] は「召喚/煌臨したとき」だけ。配置/使用イベントでは導託しない。
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        { tribes: ["火星"], categories: ["spirit"], minCost: 3 },
        { tribes: ["火星"], categories: ["ultimate"] },
        { tribes: ["火星"], categories: ["brave"] },
      ],
      // textLines[6] 後半「このネクサスの【導託】でトラッシュに置かれた『アルドノアドライブ』
      //   すべてを手札に加える」。engine-placement-oracle-return-by-name (BSAZ02-X04 と同型)。
      placementOracleReturnToHand: {
        cardName: { contains: "アルドノアドライブ" },
      },
      // textLines[10,11]【導技：3】Lv2 フラッシュ『お互いのアタックステップ』
      //   〔ターンに1回：同名〕コア3個をボイドに置く→手札の「アルドノア」系統カード1枚を
      //   コスト不要召喚/配置。導技=神技扱い (BSAZ02-X04 と同型)。
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 3,
          timing: { step: "attack", whose: "both", mode: "flash" },
          minLevel: 2,
          maxLevel: 2,
          turnLimit: "once_per_name",
          effects: [
            {
              textRef: [11, 12],
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "summon",
                    target: {
                      kind: "from_zone",
                      zone: ["hand"],
                      filter: {
                        category: ["spirit", "ultimate", "brave", "nexus"],
                        tribes: ["アルドノア"],
                      },
                      count: 1,
                    },
                    costModifier: "free",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    tribe: "導界者・火星・アルドノア",
    image: "images/BSAZ02-X05.webp",
    rarity: "X",
    pack: "BSAZ02 アルドノア・ゼロ-火星-",
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
              asColor: "white",
            },
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
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["summon", "place"],
          triggerFilter: {
            declaresUnderCardSlot: "アルドノアドライブ",
          },
        },
        executionMode: "optional",
        triggerPriority: "immediate",
        steps: [
          {
            action: {
              kind: "place_text_role_under_card",
              hostTarget: {
                kind: "trigger_related_instance",
              },
              roleTag: "アルドノアドライブ",
              fallbackMaxCount: 1,
              moveFrom: "trash_by_card_name",
              cardName: {
                contains: "アルドノアドライブ",
              },
              placeFaceDown: true,
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
              kind: "under_card_role_grant",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit", "ultimate", "nexus"],
                  targetsGrandwalker: true,
                },
                count: "all",
              },
              roleTag: "アルドノアドライブ",
              faceDownCards: true,
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
];
