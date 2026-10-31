import type { CardDefinition } from "@orica/rules-core";

export const BSAZ03_CARDS: CardDefinition[] = [
  {
    cardNo: "BSAZ03-C01",
    orikaId: 441,
    orikaIndex: 370,
    name: "「また来る」",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: ["yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ターンに1回:同名〕トラッシュにあるこのカードは、相手のエンドステップに自分の手札1枚を破棄することで手札に戻す。",
      "",
      "【タイプ:フィールド】（フィールドに置かれている間、次の効果を発揮する。）",
      "■自分のアタックステップ中、合体中を含む自分の「界塚伊奈帆」がいる間、相手は効果でアタックステップを終了できず、相手の「バトル終了」効果は発揮されない。",
      "",
      "フラッシュ",
      "自分のデッキを上から1枚破棄する。または、魂状態の「界塚伊奈帆」1枚をコストを支払わずに召喚する。または、合体中の「界塚伊奈帆」1つを分離する。その後、このカードをフィールドに置ける。",
    ],
    keywordTags: ["soul_state"],
    tribe: "地球",
    image: "images/BSAZ03-C01.webp",
    rarity: "C",
    pack: "BSAZ03 アルドノア・ゼロ(Re+)",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0]〔ターン1回:同名〕トラッシュのこのカードは相手エンドステップに手札1枚破棄で手札へ戻す。
      //   2026-07-10 (engine-claude) 初回試行は adversarial verifier round1 で refute
      //   (needs-dsl.w1.jsonl 参照)。再調査 (engine-triggered-effect-chooser-default-source-
      //   controller cluster) の結果、真因は当初診断の「resolve chooser 既定値」ではなく、
      //   trigger-system.ts getAvailableTriggeredEffectSourceChoices の whose 再判定にあった:
      //   ENGINE-phase-whose-either-source-controller-actingplayerid (2026-06-25) により
      //   PendingTriggeredEffect.actingPlayerId は構築時に「ターンプレイヤー」から「候補カードの
      //   controller」へ既に上書き済みなのに、resolve 時の候補再スキャンが whose:"opponent" 判定に
      //   同じ actingPlayerId を isSelf 基準として再利用していたため、常に
      //   sourceCard.controllerPlayerId と一致し (=isSelf 常時true)、opponent 判定が自己ブロック
      //   していた。trigger-system.ts で該当 whose 判定の基準を relatedPlayerId
      //   (fork の影響を受けない、そのイベント発生時の真のターンプレイヤー) に是正して解禁。
      //   discard(cost) → move_card(self trash→hand, conditional_cost) は BSLH01 Lv2 flash
      //   「手札1枚破棄することで回復する」と同型 (BSLH01.ts:111-123)。
      {
        applicability: { zone: ["trash"] },
        timing: { kind: "phase", step: "end", whose: "opponent" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          { action: { kind: "discard", count: 1, player: "self" } },
          {
            action: {
              kind: "move_card",
              target: { kind: "self" },
              from: { zone: "trash", player: "self" },
              to: { zone: "hand" },
              count: 1,
              requireFullCount: true,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [0],
      },
      // [2,3]【タイプ:フィールド】自分のアタックステップ中、合体含む「界塚伊奈帆」がいる間、相手はアタックステップ終了不可・「バトル終了」効果不発。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "界塚伊奈帆" }],
          },
        ],
        steps: [
          {
            action: {
              kind: "restrict_end_attack_step",
              player: "opponent",
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate", "nexus", "brave", "magic"],
                },
                count: "all",
              },
              effectFilter: { triggerPhrase: "バトル終了" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 3],
      },
      // [5] フラッシュ三択: デッキ上1枚破棄 / 魂状態「界塚伊奈帆」コストなし召喚 / 合体中「界塚伊奈帆」分離。
      //   choiceIndex 0=デッキ破棄(デフォルト action)、1=魂状態召喚、2=合体分離
      //   (BSLH01-R03 3択と同型構造、engine-field-magic-self-placement)。
      //   カード名は原文テキストでは「界塚伊奈帆」表記だが、card-data 全走査でその cardName の
      //   カードは存在せず、実在するのは BSAZ01-CX01「界塚伊奈帆」のみ（原文側 OCR 誤字と判断、
      //   feedback_card_name_from_data_only）。表記ゆれ(界/貝)に依存しない部分一致
      //   cardName:{contains:"伊奈帆"} で候補を絞る。
      //   合体分離は新規 primitive brave_separate_effect (dsl-types.ts、engine-field-magic-
      //   self-placement 新設) を使う。GUI 基本操作の brave_separate と異なりカード効果発動の
      //   ため維持コア補填はリザーブ→自軍フィールド自動補填のみ（コア配分選択 UI 無し）。
      //   3択本体は終止形「する」(kuwaerareru_optional: 強制)のため effect 単位では optional に
      //   しない。末尾「置ける」(可能形)のみ step 単位 executionMode:"optional" (BSES01-C01[4,5] 同型)。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        steps: [
          {
            id: "mode",
            action: {
              kind: "discard",
              player: "self",
              fromZone: "deck",
              count: 1,
            },
            choice: [
              {
                action: {
                  kind: "summon",
                  target: {
                    kind: "from_zone",
                    zone: "field",
                    filter: {
                      category: ["spirit", "ultimate", "brave"],
                      soulState: "only",
                      cardName: {
                        contains: "界塚伊奈帆",
                      },
                    },
                    count: 1,
                  },
                  costModifier: "free",
                },
              },
              {
                action: {
                  kind: "brave_separate_effect",
                  target: {
                    kind: "filter",
                    player: "self",
                    filter: {
                      category: ["brave"],
                      cardName: {
                        contains: "界塚伊奈帆",
                      },
                      combined: true,
                    },
                    count: 1,
                  },
                },
              },
            ],
          },
          {
            id: "place-on-field",
            action: {
              kind: "move_self",
              destination: "field",
            },
            executionMode: "optional",
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSAZ03-M01",
    orikaId: 442,
    orikaIndex: 371,
    name: "雨の断章",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 5,
    reductionSymbols: ["yellow", "yellow", "yellow", "white", "white", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ターンに1回:同名〕トラッシュにあるこのカードは、本来のコスト6以上の自分のスピリットが相手によってフィールドを離れるとき、手札に戻せる。",
      "このカードを使用するとき、フィールドのマジックカード1枚につき、軽減シンボル黄1つを満たし、手札を5枚まで破棄できる。破棄した枚数1につき、このカードのコストを-1する。破棄したカードの効果は発揮されない。",
      "",
      "フラッシュ／スタック",
      "〔ターンに1回:同名〕自分のトラッシュにあるコスト6以下の系統:「地球」/「火星」を持つマジックカードの、フラッシュタイミングならメイン／フラッシュ効果1つを、スタックタイミングならスタック効果1つを発揮する。その効果発揮後、そのカードをフィールドに置く。",
    ],
    keywordTags: [],
    tribe: "地球・火星",
    image: "images/BSAZ03-M01.webp",
    rarity: "M",
    pack: "BSAZ03 アルドノア・ゼロ(Re+)",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0]〔ターン1回:同名〕トラッシュのこのカードは、本来コスト6以上の自分のスピリットが相手によって離れるとき手札に戻せる。
      // 単一の「同型」先例カードは無い（applicability.zone:["trash"]+timing.kind:"game_event"の
      // 組み合わせは本カードが初）が、構成要素はそれぞれ既存実装済みの primitive を組み合わせただけ:
      //   - applicability.zone で常駐ゾーンを絞る第三者観測 = BSDB01-M02 effects[2]
      //     (applicability.zone:"hand" + game_event player:self + triggerFilter + cause + usageLimit
      //     per_card_name + executionMode optional。BSDB01.ts:1217-1231)。
      //   - triggerFilter.costBasis:"printed" で「本来のコスト」= 印字コストのみ判定。
      //   - cause:["opponent_effect","battle"] は「相手によって」の SSOT
      //     (structured-effect-registrations.ts mapBurstTriggerToCause 参照)。
      // 第三者トラッシュ常駐リスナーの実配線 (sourceZone=trash 候補列挙) は新規プリミティブ追加なしに
      // 動作することを bsaz03-m01-trash-recovery.test.ts で実証した。
      {
        applicability: { zone: ["trash"] },
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          triggerFilter: {
            category: ["spirit"],
            costBasis: "printed",
            minCost: 6,
          },
          cause: ["opponent_effect", "battle"],
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
      // [1a] 使用時コスト軽減 (前半): フィールドのマジックカード1枚につき軽減シンボル黄1つを満たす。
      // 原文「フィールド」は両プレイヤーのフィールドを数える。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
              waivesReductionRequirement: true,
              waiverColors: ["yellow"],
              count: {
                source: {
                  kind: "cards_in_zone",
                  zone: "field",
                  player: "self",
                  filter: { category: ["magic"] },
                },
              },
            },
          },
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
              waivesReductionRequirement: true,
              waiverColors: ["yellow"],
              count: {
                source: {
                  kind: "cards_in_zone",
                  zone: "field",
                  player: "opponent",
                  filter: { category: ["magic"] },
                },
              },
            },
          },
        ],
        textRef: [1],
      },
      // [1b] 使用時コスト軽減 (後半): 手札を5枚まで破棄、破棄1枚につきこのカードのコストを-1
      // (破棄したカードの効果は発揮されない)。BSAZ02.ts:774-779 の return_to_deck_top_bottom
      // (固定2枚・trash由来) と同じ useCostPayment + zone_discount 経路を、可変枚数
      // (0〜maxCount) ・hand由来の新規 kind:"discard_hand" で拡張する (SSOT: 新規 pending
      // 機構は起こさず、既存 selectedZoneCardIds 単発選択パイプラインに費用計算を追加するのみ)。
      // 破棄は applyMagicZoneCostPayment 内で moveCardZone を直接呼ぶため moved_to_trash
      // 自動効果は発火しない (pendingDrawStepCostChoice の手札破棄と同じ扱い。原文
      // 「破棄したカードの効果は発揮されない」と整合する)。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { additionalCostValue: -1 },
              useCostPayment: {
                kind: "discard_hand",
                sourceZone: "hand",
                maxCount: 5,
              },
            },
          },
        ],
        textRef: [1],
      },
      // [2,3] フラッシュ／スタック:〔ターン1回:同名〕自分のトラッシュにあるコスト6以下・
      // 系統:「地球」/「火星」を持つマジックカード1枚を選び、フラッシュタイミングなら
      // メイン／フラッシュ効果1つを、スタックタイミングならスタック効果1つを借用発揮する。
      // その後、そのカードをフィールドに置く (borrow_magic_effect, effect-borrowing.ts)。
      // 初のカード横断効果借用 primitive (BSRK01-X01/BSFT01-TR03(A) 等、同型ギミックを持つ
      // 他カードは本 primitive 実装時点では未着手のため stub のまま)。
      //
      // 借用元候補の絞り込みは CardFilter.hasActivatedEffectMode で「対象が
      // main/flash (または stack) の printed activated 効果を持つか」を判定する。
      // stub/steps 実装状態には非依存 (cardHasPrintedEffectText と同じ「印字属性・実装状態
      // 非依存」原則、card-filter.ts)。2026-07-04 時点のカードプール (BSAZ01〜03 の
      // コスト6以下・地球/火星マジック19枚) では main/flash 候補が2枚 (BSAZ02-C15,
      // BSAZ03-C01)。BSAZ02-C15 は flash 効果本体 (相手のコスト6以下スピリット/
      // アルティメット3体までをデッキの下に戻す) が実装済みのため借用すると実際に
      // 発動する (stub なのは「ライフが減ったとき無償使用」という別の副条件のみ、
      // BSAZ02.ts:832-857)。BSAZ03-C01 は自身の効果が stub のため借用しても no-op。
      // stack 候補は0枚。
      //
      // フラッシュ/スタックの2枠は同一 limitGroupId で「ターンに1回:同名」を共有する
      // (どちらを使っても同名カードの二重発動を抑止)。
      {
        timing: { kind: "activated", mode: "flash" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        limitGroupId: "bsaz03-m01-borrow",
        steps: [
          {
            action: {
              kind: "borrow_magic_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                filter: {
                  category: ["magic"],
                  maxCost: 6,
                  tribes: ["地球", "火星"],
                  tribesLogic: "or",
                  hasActivatedEffectMode: ["main", "flash"],
                },
                count: 1,
              },
              borrowModes: ["main", "flash"],
              thenMove: { zone: "field", player: "self", afterTriggers: true },
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        timing: { kind: "activated", mode: "stack" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        limitGroupId: "bsaz03-m01-borrow",
        steps: [
          {
            action: {
              kind: "borrow_magic_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                filter: {
                  category: ["magic"],
                  maxCost: 6,
                  tribes: ["地球", "火星"],
                  tribesLogic: "or",
                  hasActivatedEffectMode: ["stack"],
                },
                count: 1,
              },
              borrowModes: ["stack"],
              thenMove: { zone: "field", player: "self", afterTriggers: true },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
];
