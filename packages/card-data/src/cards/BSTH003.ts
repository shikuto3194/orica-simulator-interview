import type { CardDefinition } from "@orica/rules-core";

export const BSTH003_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH003-C01",
    orikaId: 37,
    orikaIndex: 27,
    name: "H̶M̶X̶-̶1̶2̶マ○チ",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 2000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 3000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 5000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "このカードの赤の軽減シンボルは、黄としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の系統：「導魔」/「秘封」を持つ導界者ネクサスカード1枚と、系統：「導魔」/「空牙」を持つコスト4以上のスピリットカード1枚と、系統：「導魔」/「動器」を持つブレイヴカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2-Lv3『自分のメインステップ』",
      "このスピリットに黄/導として扱うシンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "秘封・動器",
    image: "images/BSTH003-C01.webp",
    rarity: "C",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの赤の軽減シンボルは、黄としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
              reductionSymbolBaseColors: ["red"],
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2-Lv3『召喚時』デッキ3オープン、導魔/秘封の導界者ネクサス1枚、導魔/空牙のコスト4以上スピ1枚、導魔/動器のブレイヴ1枚を手札。残りデッキ下。
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
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    tribes: ["導魔", "秘封"],
                    targetsGrandwalker: true,
                    hasMechanic: ["guided"],
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    category: ["spirit"],
                    tribes: ["導魔", "空牙"],
                    minCost: 4,
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: { category: ["brave"], tribes: ["導魔", "動器"] },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv1-Lv2-Lv3『自分のメインステップ』このスピリットに黄/導として扱うシンボル1つを追加。
      // ルーミア型の継続効果。activated + permanent だと起動毎に永続シンボルが累積するため continuous 化。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { level: { min: 1, max: 3 } },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: ["yellow", "guide"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH003-C02",
    orikaId: 38,
    orikaIndex: 28,
    name: "る〜こと",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 2000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 3000,
      },
      {
        level: 3,
        requiredCores: 3,
        bp: 4000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "このカードの黄の軽減シンボルは、赤としても扱う。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分のデッキを上から3枚オープンできる。その中の系統：「導魔」/「秘封」を持つ導界者ネクサスカード1枚と、系統：「導魔」/「空牙」を持つコスト4以上のスピリットカード1枚と、系統：「導魔」/「動器」を持つブレイヴカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。",
      "",
      "Lv1-Lv2-Lv3『自分のメインステップ』",
      "このスピリットに赤/導として扱うシンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "幻想・秘封・動器",
    image: "images/BSTH003-C02.webp",
    rarity: "C",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの黄の軽減シンボルは、赤としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
              reductionSymbolBaseColors: ["yellow"],
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-Lv2-Lv3『召喚時』デッキ3オープン、導魔/秘封の導界者ネクサス1枚、導魔/空牙のコスト4以上スピ1枚、導魔/動器のブレイヴ1枚を手札。残りデッキ下。
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
                  count: 1,
                  filter: {
                    category: ["nexus"],
                    tribes: ["導魔", "秘封"],
                    targetsGrandwalker: true,
                    hasMechanic: ["guided"],
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    category: ["spirit"],
                    tribes: ["導魔", "空牙"],
                    minCost: 4,
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: { category: ["brave"], tribes: ["導魔", "動器"] },
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv1-Lv2-Lv3『自分のメインステップ』このスピリットに赤/導として扱うシンボル1つを追加。
      // ルーミア型の継続効果。activated + permanent だと起動毎に永続シンボルが累積するため continuous 化。
      {
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "main" },
        applicability: { level: { min: 1, max: 3 } },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: ["red", "guide"],
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH003-C31",
    combinedBoost: 4000,
    orikaId: 39,
    orikaIndex: 29,
    name: "魔法使い達の杖",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "red", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "【合体条件：導魔＆コスト5以上】",
      "【スピリット合体中】『このスピリットのアタック時』",
      "このスピリットの効果で相手のスピリット/アルティメットを破壊したとき、相手のライフのコア1個をリザーブに置く。",
      "",
      "【合体条件：導魔＆導界者ネクサス】",
      "【ネクサス合体中】『自分のメインステップ』",
      "自分が系統：「導魔」/「楽族」/「空牙」/「動器」を持つカードを召喚/配置するとき、その軽減シンボル赤/黄2つまでを満たす。",
    ],
    keywordTags: [],
    tribe: "導話・導魔",
    image: "images/BSTH003-C31.webp",
    rarity: "C",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // ENGINE-brave-combine-nexus-host alternatives: 基本条件(導魔＆コスト5以上)はスピリット向け、
    // alternatives は「導魔＆導界者ネクサス」(textLines[4])。基本条件は
    // categories:["spirit"] で非導界者ネクサス/アルティメットを除外し、alternatives 側だけ
    // categories:["nexus"] を明示しネクサスもホスト候補に含める(braveConditionAllowsNexusHost)。
    // 「導界者ネクサス」= 系統「導界者」を持つネクサス（例: [導界者]魅魔 tribe:"導界者・導魔"）。
    // 「導魔＆導界者ネクサス」は「導魔」と「導界者」の両系統を同時に持つことを要求するため
    // tribesLogic:"and" で AND 判定する（tribes 既定の OR とは別軸、CardFilter.tribesLogic 同型）。
    braveCondition: {
      categories: ["spirit"],
      tribes: ["導魔"],
      minCost: 5,
      alternatives: [
        {
          categories: ["nexus"],
          tribes: ["導魔", "導界者"],
          tribesLogic: "and",
          targetsGrandwalker: "only",
          grandwalkerKind: "guided",
        },
      ],
    },
    effects: [
      // 【スピリット合体中】『このスピリットのアタック時』このスピリットの効果で
      // 相手スピ/アルティを破壊したとき、相手ライフ1コアをリザーブへ。
      // 「アタック中スコープの即時効果」(BSTH01-X08 同型): 破壊そのものを観測する誘発
      // (game_event:destroy) を in_battle:attacking でゲートする。『アタック時』は上位
      // フィルター（発揮枠）であり effectCondition ではない (10_rules/05)。
      // cause=opponent_effect のみ: テキスト「このスピリットの効果で」= バトル討ち取り (battle) は
      // 対象外。deriveTriggerEventCauseFromPendingLeave は離脱カード(=相手, player:"opponent")
      // 自身のコントローラ基準で cause を導出するため、「自分(このスピリット)の効果で」相手が
      // 破壊された場合は causePlayerId(=自分)が離脱カードのコントローラ(相手)と異なる=
      // opponent_effect 側になる (self_effect は「相手が相手自身を自壊させた」を指し取り違え。
      // ENGINE-cause-polarity-self-effect-opponent-effect-audit、adversarial verifier
      // 2026-07-12 lens1/2/4 指摘の極性誤りパターンを本カードでも検出・修正)。
      // sourceWhose:"either": 同 family の actingPlayerId は「離脱した相手カードのコントローラ」
      // を指し、listener(このカード)自身のコントローラとは一致しないため、既定 whose:"self"
      // (getTriggeredEffectSourceUseBlockReason) では常に候補から除外される。player/cause で
      // 絞り込み済みのため明示的に外す (ENGINE-leave-field-third-party-opponent-source-whose 同型)。
      // combined_host_category:["spirit","ultimate"]: braveCondition が alternatives でネクサスも
      // 受け付けるようになったため、applicability.combined:true だけでは「スピリット合体中」見出し
      // をネクサス合体時にも誤発火させてしまう(BSAZ02-C11 precedent と同型)。ホスト種別で明示的に
      // 絞る。
      {
        applicability: { combined: true },
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "destroy",
          triggerFilter: { category: ["spirit", "ultimate"] },
          cause: ["opponent_effect"],
          sourceWhose: "either",
        },
        condition: [
          { kind: "in_battle", state: "attacking" },
          {
            kind: "combined_host_category",
            categories: ["spirit", "ultimate"],
          },
          { kind: "trigger_source_is_combined_host" },
        ],
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
        textRef: [1, 2],
      },
      // 【ネクサス合体中】『メイン』導魔/楽族/空牙/動器カードの軽減シンボル赤/黄2つまで補助。
      // combined_host_category:["nexus"] でホストがネクサスのときのみ発揮
      // (BSAZ02-C11/BSTH05.5-C20 combined_host_category precedent と同型)。
      // treat_as waivesReductionRequirement + waiverColors:["red","yellow"] で「軽減シンボル
      // 赤/黄2つまでを満たす」を表現 (BSTH001-転醒R01(A) の色不問版に対する色限定拡張)。
      {
        timing: { kind: "continuous" },
        applicability: { combined: true },
        condition: [{ kind: "combined_host_category", categories: ["nexus"] }],
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["reduction_symbol"],
              whenPayingForFilter: { tribes: ["導魔", "楽族", "空牙", "動器"] },
              waivesReductionRequirement: true,
              waiverColors: ["red", "yellow"],
              count: 2,
            },
          },
        ],
        textRef: [4, 5, 6],
        timingScope: { player: "self", period: "main" },
      },
    ],
  },
  {
    cardNo: "BSTH003-C32",
    combinedBoost: 2000,
    orikaId: 40,
    orikaIndex: 30,
    name: "ミミちゃん",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "red", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: [],
    textLines: [
      "このカード/ブレイヴは、系統：「導魔」を持つ自分のスピリット/導界者ネクサスの合体可能体数に数えない。",
      "",
      "手札にあるこのカードは、系統：「導魔」を持つ自分のスピリット/導界者ネクサスが相手の効果の対象になったとき、コストを支払わずに直接合体するように召喚できる。そうしたとき、その効果を無効にするか、受けず、このターンの間、このスピリット/導界者ネクサスは、相手によってフィールドを離れない。",
      "",
      "【合体条件：導魔＆コスト5以上】",
      "",
      "【合体条件：導魔＆導界者ネクサス】",
    ],
    keywordTags: [],
    tribe: "導話・動器",
    image: "images/BSTH003-C32.webp",
    rarity: "C",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: {
      categories: ["spirit"],
      tribes: ["導魔"],
      minCost: 5,
      alternatives: [
        {
          categories: ["nexus"],
          tribes: ["導魔", "導界者"],
          tribesLogic: "and",
          targetsGrandwalker: "only",
          grandwalkerKind: "guided",
        },
      ],
    },
    braveLimitExemption: {
      hostCondition: {
        categories: ["spirit"],
        tribes: ["導魔"],
        alternatives: [
          {
            categories: ["nexus"],
            tribes: ["導魔", "導界者"],
            tribesLogic: "and",
            targetsGrandwalker: "only",
            grandwalkerKind: "guided",
          },
        ],
      },
    },
    effects: [
      // [0] 合体可能体数に数えない: CardDefinition.braveLimitExemption で表現。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [0],
      },
      // [2] 手札からの防御合体: 系統「導魔」の自分のスピリット/導界者ネクサスが相手の効果の
      //   対象になったとき、手札のこのカードをコスト無しで直接合体するように召喚できる。
      //   そうしたとき、その効果を無効にするか受けず、このターンの間その対象は相手による
      //   フィールド離脱を受けない。「対象化誘発」(P3-76, game_event:"targeted") と
      //   「手札からの直接合体召喚」(brave_combine_effect の source 省略時デフォルトである
      //   sourceInstanceId 自身をブレイヴとして扱う経路。executeBraveCombine は brave の現
      //   ゾーンを検査せず強制的に zone:"field" へ更新するため手札カードでもそのまま動作する)
      //   のいずれも既存プリミティブの組み合わせで表現可能（stale stub 判定だった）。
      //   合体先は braveCondition と同じ tribes:"導魔"(+ nexus 側は"導界者"併記 and) の
      //   トリガー元カード自身に `target:{kind:"trigger_related_instance"}` で固定する。
      //   「無効にする」/「受けず」選択は BSLH01-CX02(negate単発, L5602) /
      //   BSGE01(effect_immunity+duration:current_effect, L1713) の precedent と同型。
      //   triggerFilter は braveCondition(minCost:5 の合体条件見出し[4]/[6]) と同じ host
      //   適格性に揃える（executeBraveCombine が braveCondition を無条件適用するため、
      //   trigger 側だけ広いと「宣言できるが合体は失敗し保護も発動しない」不整合になる。
      //   adversarial verifier round1 refute で判明）。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "targeted",
          triggerFilter: {
            filterOr: [
              { category: ["spirit"], tribes: ["導魔"], minCost: 5 },
              {
                category: ["nexus"],
                tribes: ["導魔", "導界者"],
                tribesLogic: "and",
                targetsGrandwalker: "only",
                grandwalkerKind: "guided",
              },
            ],
          },
          cause: ["opponent_effect"],
        },
        applicability: { zone: "hand" },
        executionMode: "optional",
        steps: [
          {
            id: "mimi-defensive-combine",
            action: {
              kind: "brave_combine_effect",
              asSummon: true,
              target: { kind: "trigger_related_instance" },
            },
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "mimi-defensive-combine",
            },
            label: "無効にする",
            action: {
              kind: "negate",
              negateTarget: "effect",
              targetController: "opponent",
            },
            choice: [
              {
                label: "受けず",
                action: {
                  kind: "effect_immunity",
                  target: { kind: "trigger_related_instance" },
                  duration: { scope: "current_effect" },
                },
              },
            ],
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "mimi-defensive-combine",
            },
            action: {
              kind: "effect_resistance",
              target: { kind: "trigger_related_instance" },
              resistsOutcome: "leave_field",
              source: "opponent",
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [2],
      },
    ],
  },
  {
    cardNo: "BSTH003-C33",
    orikaId: 41,
    orikaIndex: 31,
    name: "Strawberry Crisis!!",
    printedCategory: "magic",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "yellow", "guide"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」を持つ。",
      "",
      "フラッシュ",
      "自分は、デッキの上か下から2枚ドローする。",
      "",
      "スタック",
      "1コスト支払うことで、相手のブロック宣言するスピリット1体を破壊する。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH003-C33.webp",
    rarity: "C",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // フラッシュ：自分は、デッキの上か下から2枚ドローする。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: { kind: "draw", count: 2, position: "top" },
            choice: [
              { action: { kind: "draw", count: 2, position: "bottom" } },
            ],
          },
        ],
        textRef: [2, 3],
      },
      // スタック：1コスト支払うことで、相手のブロック宣言するスピリット1体を破壊する。
      // 「ことで」構文: pay_cost(1) → conditional_cost destroy（双方向ロールバック, 03c）。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "stack" },
        steps: [
          { action: { kind: "pay_cost", amount: 1 } },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], battleState: "blocking" },
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
    cardNo: "BSTH003-M01",
    orikaId: 42,
    orikaIndex: 32,
    name: "カナ・アナベラル",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 5,
    reductionSymbols: ["yellow", "red", "guide"],
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
      {
        level: 3,
        requiredCores: 4,
        bp: 9000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分はデッキの上か下から2枚ドローできる。その後、手札/トラッシュにある系統：「導魔」/「動器」を持つブレイヴカード1枚を、コストを支払わずに召喚できる。",
      "",
      "Lv2-Lv3 フラッシュ『このスピリットのアタック時』",
      "ターンに1回、このターンの間、相手のスピリット1体をBP-8000でき、BPが0になったスピリットを破壊する。",
    ],
    keywordTags: [],
    tribe: "幻想・導魔・騒霊",
    image: "images/BSTH003-M01.webp",
    rarity: "M",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』2ドローできる。その後、手札/トラッシュの導魔/動器ブレイヴ1枚をコスト無し召喚。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: { kind: "draw", count: 2, position: "top" },
            choice: [
              { action: { kind: "draw", count: 2, position: "bottom" } },
            ],
            executionMode: "optional",
          },
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "trash"],
                filter: { category: ["brave"], tribes: ["導魔", "動器"] },
                count: 1,
              },
              costModifier: "free",
            },
            connector: "sequential",
            executionMode: "optional",
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3 フラッシュ『アタック時』ターン1回、相手スピ1体をBP-8000、BP0で破壊。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "in_battle", state: "attacking" },
        ],
        usageLimit: { kind: "per_instance", duration: "turn" },
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
              amount: -8000,
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
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH003-M02",
    combinedBoost: 4000,
    orikaId: 43,
    orikaIndex: 33,
    name: "可能性空間移動船",
    printedCategory: "brave",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "yellow", "guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "【合体条件：導魔／空牙／秘封＆コスト5以上】",
      "【スピリット合体中】『このスピリットのアタック時』",
      "このスピリットの効果で相手のスピリット/アルティメットを破壊したとき、このスピリットは回復する。",
      "",
      "【合体条件：導魔／秘封＆導界者ネクサス】",
      "【ネクサス合体中】『自分のメインステップ』",
      "自分が系統：「導魔」/「空牙」/「動器」/「秘封」を持つカードを召喚/配置するとき、その軽減シンボル赤/黄2つまでを満たす。",
    ],
    keywordTags: [],
    tribe: "導話・動器",
    image: "images/BSTH003-M02.webp",
    rarity: "M",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // ENGINE-brave-combine-nexus-host alternatives: alt条件「導魔／秘封＆導界者ネクサス」は
    // 「(導魔 または 秘封) かつ 導界者」の入れ子論理（AND の内側に OR）で、単一 tribesLogic では
    // 表せない。alternatives 配列自体で OR を取り、各要素で「Xの系統＆導界者」を AND 判定する
    // (= (導魔∧導界者) ∨ (秘封∧導界者) = 導界者∧(導魔∨秘封)、BSTH003-C31 と同じ「導界者ネクサス」
    // = 系統「導界者」を持つネクサス、例 [導界者]魅魔 tribe:"導界者・導魔")。
    braveCondition: {
      categories: ["spirit"],
      tribes: ["導魔", "空牙", "秘封"],
      minCost: 5,
      alternatives: [
        {
          categories: ["nexus"],
          tribes: ["導魔", "導界者"],
          tribesLogic: "and",
          targetsGrandwalker: "only",
          grandwalkerKind: "guided",
        },
        {
          categories: ["nexus"],
          tribes: ["秘封", "導界者"],
          tribesLogic: "and",
          targetsGrandwalker: "only",
          grandwalkerKind: "guided",
        },
      ],
    },
    effects: [
      // 【スピリット合体中】『このスピリットのアタック時』このスピリットの効果で
      // 相手スピ/アルティを破壊したとき、このスピリットは回復する。
      // BSTH01-X08 / BSTH003-C31 同型: game_event:destroy を in_battle:attacking でゲート。
      // cause=opponent_effect のみ（テキスト「このスピリットの効果で」。極性根拠は
      // BSTH003-C31 effects[0] コメント参照。ENGINE-cause-polarity-self-effect-opponent-effect-audit）。
      // sourceWhose:"either" も C31 effects[0] と同根拠 (ENGINE-leave-field-third-party-
      // opponent-source-whose 同型) で必須。
      // combined_host_category:["spirit","ultimate"]: C31 effects[0] と同根拠。alternatives で
      // ネクサスも合体先候補になったため、見出し「スピリット合体中」をホスト種別で明示的に絞る。
      {
        applicability: { combined: true },
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "destroy",
          triggerFilter: { category: ["spirit", "ultimate"] },
          cause: ["opponent_effect"],
          sourceWhose: "either",
        },
        condition: [
          { kind: "in_battle", state: "attacking" },
          {
            kind: "combined_host_category",
            categories: ["spirit", "ultimate"],
          },
          { kind: "trigger_source_is_combined_host" },
        ],
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [1, 2],
      },
      // 【ネクサス合体中】『メイン』導魔/空牙/動器/秘封カードの軽減シンボル赤/黄2つまで補助。
      // C31 effects[1] と同型 (combined_host_category:["nexus"] + treat_as waivesReductionRequirement
      // + waiverColors)。
      {
        timing: { kind: "continuous" },
        applicability: { combined: true },
        condition: [{ kind: "combined_host_category", categories: ["nexus"] }],
        steps: [
          {
            action: {
              kind: "treat_as",
              aspects: ["reduction_symbol"],
              whenPayingForFilter: { tribes: ["導魔", "空牙", "動器", "秘封"] },
              waivesReductionRequirement: true,
              waiverColors: ["red", "yellow"],
              count: 2,
            },
          },
        ],
        textRef: [4, 5, 6],
        timingScope: { player: "self", period: "main" },
      },
    ],
  },
  {
    cardNo: "BSTH003-M03",
    orikaId: 44,
    orikaIndex: 34,
    name: "[夢時空]博麗 靈夢",
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
      "このカードの軽減シンボルは黄としても扱う。",
      "",
      "【バースト：相手のスピリット／アルティメットのアタック後】",
      "相手の創界神ネクサス2つのコア6個ずつをボイドに置く。その後、このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "BP8000以下の相手のスピリット1体を破壊できる。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・空牙",
    image: "images/BSTH003-M03.webp",
    rarity: "M",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの軽減シンボルは黄としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
            },
          },
        ],
        textRef: [0],
      },
      // 【バースト：相手のスピリット/アルティメットのアタック後】相手創界神2つのコア6個ずつボイド→召喚。
      // attack_finished trigger は BSTH09-M03/BSTH05.5-M03 等で実例あり (旧 stub note は stale)。
      // count:1 + repeat(additional:1, allowDuplicateTargets:false) で「2つ・各6個」を表現
      // (BSKB01-C04 の「相手2体のコア1個ずつ」と同型、amount のみ 6 に変更)。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "attack_finished", player: "opponent" },
        },
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"], targetsGrandwalker: "only" },
                count: 1,
              },
              from: { kind: "target_card" },
              to: { kind: "void", player: "opponent" },
              amount: 6,
            },
            repeat: { additional: 1, allowDuplicateTargets: false },
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
      // Lv1-Lv2-Lv3『このスピリットのアタック時』BP8000以下の相手のスピリット1体を破壊できる。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"], maxBp: 8000 },
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
    cardNo: "BSTH003-R01",
    orikaId: 45,
    orikaIndex: 35,
    name: "小兎姫",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "yellow", "guide"],
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
        bp: 6000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "相手のネクサス2つを破壊でき、その効果を発揮させない。",
      "",
      "Lv1-Lv2-Lv3 フラッシュ",
      "このスピリットを疲労させることで、自分のトラッシュにある系統：「導魔」を持つ導界者ネクサスカード1枚をコストを支払わずに配置する。",
    ],
    keywordTags: [],
    tribe: "幻想・空牙・戦姫",
    image: "images/BSTH003-R01.webp",
    rarity: "R",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』相手のネクサス2つを破壊でき、その効果を発揮させない。
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
                filter: { category: ["nexus"] },
                count: 2,
              },
              suppressDestroyedEffects: "destroyed_only",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3 フラッシュ：疲労させ、トラッシュの導魔の導界者ネクサス1枚をコスト無し配置。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "exhaust", target: { kind: "self" } } },
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: {
                category: ["nexus"],
                tribes: ["導魔"],
                targetsGrandwalker: true,
                hasMechanic: ["guided"],
              },
              count: 1,
              mandatory: true,
              destination: "field",
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH003-R02",
    orikaId: 46,
    orikaIndex: 36,
    name: "エレン",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "red", "guide"],
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
      "トラッシュにある黄/赤のマジックカード/ブレイヴカード1枚を手札に戻せる。",
      "",
      "Lv1-Lv2-Lv3 フラッシュ",
      "このスピリットを疲労させることで、自分はデッキの上か下から1枚ドローする。",
    ],
    keywordTags: [],
    tribe: "幻想・導魔・夜族",
    image: "images/BSTH003-R02.webp",
    rarity: "R",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』トラッシュの黄/赤のマジック/ブレイヴ1枚を手札に戻せる。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: {
                category: ["magic", "brave"],
                colors: ["yellow", "red"],
              },
              count: 1,
              mandatory: true,
              destination: "hand",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3 フラッシュ：疲労させ、デッキの上か下から1枚ドロー。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "exhaust", target: { kind: "self" } } },
          {
            action: { kind: "draw", count: 1, position: "top" },
            choice: [
              { action: { kind: "draw", count: 1, position: "bottom" } },
            ],
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH003-R03",
    orikaId: 47,
    orikaIndex: 37,
    name: "Reincarnation",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "red"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、系統：「幻想」を持つ。",
      "自分の黄／赤の効果でデッキからオープンされたか、トラッシュに置かれたこのカードは手札に加えられる。",
      "",
      "フラッシュ",
      "このターンの間、相手のスピリット／アルティメット2体はアタックできない。",
      "",
      "スタック",
      "このターンの間、相手のスピリット／アルティメット1体はアタックできない。この効果はお互いのアタックステップしか使えない。",
    ],
    keywordTags: [],
    tribe: "幻想",
    image: "images/BSTH003-R03.webp",
    rarity: "R",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードは、系統：「幻想」を持つ。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["幻想"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // 黄/赤効果でオープン/トラッシュ行きのこのカードは手札に加えられる。
      //   BSFT01-C02 add 型（07b §6 裁定 2026-06-11）の trigger_colors 版。
      //   trigger_from_zone は ["deck"]（trash 経路の fromZone も "deck"）。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_colors", colors: ["yellow", "red"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        executionMode: "optional",
        textRef: [1],
      },
      // フラッシュ：このターン、相手のスピリット/アルティメット2体はアタックできない。
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 2,
              },
              restriction: ["attack"],
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // スタック：このターン、相手のスピリット/アルティメット1体はアタックできない。
      {
        timing: { kind: "activated", mode: "stack" },
        // この効果は『お互いのアタックステップ』しか使えない（textLine[7]）。
        timingScope: { player: "both", period: "attack" },
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
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH003-X01",
    orikaId: 48,
    orikaIndex: 38,
    name: "[導界者]魅魔",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: ["yellow"],
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
    symbolColors: ["guide"],
    textLines: [
      "このネクサス/スピリットは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサス/スピリットには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・転者・導域は、神託・転神・神域としても扱う。",
      "",
      "【導託：［導魔／楽族／空牙／動器＆コスト3以上］［導魔／動器＆ブレイヴ］】",
      "◆対象の自分のスピリット/ブレイヴを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "【転者：3】Lv1-Lv2『自分のアタックステップ開始時』",
      '〔このネクサスのコア3個をボイドに置く〕このターンの間、このネクサスはLv1BP3000、Lv2BP6000、"『このスピリットのアタック時』このターンの間、相手のスピリット/アルティメット1体をBP-20000し、BPが0になったスピリット/アルティメットを破壊する。"を持つスピリットとしても扱い、導界者ネクサス／創界神ネクサス以外では破壊されない。',
      "",
      "【導域】Lv2『自分のドローステップ』",
      "このネクサスのコア4個につき、ドローの枚数を+1する。この効果は重複しない。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        {
          tribes: ["導魔", "楽族", "空牙", "動器"],
          categories: ["spirit"],
          minCost: 3,
        },
        { tribes: ["導魔", "動器"], categories: ["brave"] },
      ],
    },
    tribe: "導界者・導魔",
    image: "images/BSTH003-X01.webp",
    rarity: "X",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // textLines[0] 導界者ネクサス共通ルールと textLines[2-4]【導託】(対象召喚/煌臨時コア配置・
      //   配置時デッキ3枚トラッシュ→対象毎コア) は grandwalkerData(kind:"guided") + keywordTags で
      //   engine が表現する（checkAndQueueOracleChoices / checkAndQueuePlacementOracle）。DSL effect 不要。
      // 【転者：3】Lv1-Lv2『アタックステップ開始時』コア3個ボイドで BP3000/6000 スピリット化
      // （BP-20000破壊持ち）。
      // grandwalkerData.divineSkills を使わない理由 (adversarial verifier 指摘への回答、
      // 2026-07-25): divineSkills は getAvailableDivineSkillLegalActions
      // (legal-actions-availability.ts) が毎 getLegalActions 呼び出しで走査する
      // **常時ポーリング型** (state.step==="attack" である間ずっと legal action として出現)。
      // 既存の全 divineSkills precedent (BSTH07-X01「フラッシュ『アタックステップ』」/
      // BSTH03-X02「フラッシュ『お互いのアタックステップ』」/ BSTH01-XX01「『自分のメインステップ』」)
      // は原文に「開始時」を含まず、ステップ中いつでも使える前提と一致する。
      // 対して本カードの原文は「アタックステップ開始時」= ステップ開始の一瞬だけの機会window。
      // これは timing.kind:"phase"+subPhase:"start" → resolveTriggerEvents() で
      // "start_step" TriggerEventKind に解決される **一過性トリガー配信** (BSTH03-R01
      // 「相手のアタックステップ開始時」と同型 phase-start + grant_effect、
      // bsth03-r01-attack-self-destroy-grant.test.ts 参照) であり、continuous polling の
      // divineSkills とは別の既存 SSOT 経路。「開始時」を divineSkills(常時ポーリング) で
      // 表現すると発揮可能ウィンドウが誤って全ステップへ広がる（原文より緩い近似になる）ため、
      // 既存の phase-start トリガー経路を採用する。コスト充足チェックは self_core_count
      // （不足時は選択肢自体を出さない、core_move の部分成功で過小支払いのまま発揮されるのを防ぐ）。
      {
        timing: {
          kind: "phase",
          step: "attack",
          whose: "self",
          subPhase: "start",
        },
        condition: [{ kind: "self_core_count", min: 3 }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "this_card" },
              to: { kind: "void", player: "self" },
              amount: 3,
            },
          },
          {
            action: {
              kind: "divine_transform",
              target: { kind: "self" },
              bpByLevel: [
                { level: 1, bp: 3000 },
                { level: 2, bp: 6000 },
              ],
              protectedFromNonGrandwalker: true,
            },
            connector: "sequential",
          },
          {
            action: {
              kind: "grant_effect",
              target: { kind: "self" },
              duration: { scope: "turn" },
              grantedEffect: {
                timing: { kind: "card_event", event: "attack" },
                executionMode: "mandatory",
                steps: [
                  {
                    id: "bp0",
                    action: {
                      kind: "bp_modify",
                      target: {
                        kind: "filter",
                        player: "opponent",
                        filter: { category: ["spirit", "ultimate"] },
                        count: 1,
                      },
                      amount: -20000,
                      duration: { scope: "turn" },
                    },
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
                    connector: "sequential",
                  },
                ],
              },
            },
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
      // 【導域】Lv2『自分のドローステップ』このネクサスのコア4個につき、ドロー枚数+1。
      // BSTH01-C12/BSTH02(discard cost)と同型のinline(phase:draw,subPhase:start,whose:self)
      // draw_modifyパターンを、cores_on(this_card)+divisor:4の動的量で流用（新規primitive不要）。
      // 「重複しない」= turn-system.ts のdraw_modify definitionId単位dedup(既存機構)で表現。
      {
        timing: {
          kind: "phase",
          step: "draw",
          whose: "self",
          subPhase: "start",
        },
        inline: true,
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "draw_modify",
              amount: {
                source: { kind: "cores_on", location: { kind: "this_card" } },
                divisor: 4,
              },
              duration: { scope: "step", step: "draw" },
            },
          },
        ],
        textRef: [9, 10],
        usageLimit: { kind: "no_duplicate" },
      },
    ],
  },
  {
    cardNo: "BSTH003-X02",
    orikaId: 49,
    orikaIndex: 39,
    name: "[夢時空]霧雨 魔梨沙",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 12,
    reductionSymbols: [
      "yellow",
      "yellow",
      "yellow",
      "yellow",
      "yellow",
      "yellow",
    ],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 12000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 18000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 22000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "このカードの軽減シンボルは、赤としても扱う。",
      "",
      "【バースト：相手のスピリット／アルティメットのアタック後】",
      "このカードをコストを支払わずに召喚する。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットは疲労状態でブロックでき、自分の系統：「導魔」を持つ導界者ネクサスがある間、相手の効果を受けない。",
      "",
      "Lv2-Lv3『このスピリットのアタック/ブロック時』",
      "このターンの間、このスピリットとバトルしていない相手のスピリット/アルティメット2体をBP-10000し、BPが0になった相手のスピリット/アルティメットを破壊する。",
    ],
    keywordTags: ["burst"],
    tribe: "幻想・導魔",
    image: "images/BSTH003-X02.webp",
    rarity: "X",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // このカードの軽減シンボルは、赤としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              cardStateOnly: true,
              aspects: ["reduction_symbol"],
              asColor: "red",
            },
          },
        ],
        textRef: [0],
      },
      // 【バースト：相手のスピリット/アルティメットのアタック後】コストを支払わず召喚する。
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
          },
        ],
        textRef: [2, 3],
      },
      // Lv1-Lv2-Lv3 疲労状態でブロックできる。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "allow_block_while_exhausted",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [5, 6],
      },
      // 導魔の導界者ネクサスがある間、相手の効果を受けない。
      {
        timing: { kind: "continuous" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["nexus"],
            tribes: ["導魔"],
            grandwalkerKind: "guided",
          },
        ],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [5, 6],
      },
      // Lv2-Lv3『アタック/ブロック時』バトルしていない相手2体をBP-10000、BP0で破壊。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        condition: [{ kind: "min_level", value: 2 }],
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
                  battleState: "not_in_battle",
                },
                count: 2,
              },
              amount: -10000,
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
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSTH003-X03",
    orikaId: 50,
    orikaIndex: 40,
    name: "[導界者]岡崎 夢美",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 2,
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
    symbolColors: ["guide"],
    textLines: [
      "このネクサス/スピリットは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサス/スピリットには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・転者・導域は、神託・転神・神域としても扱う。",
      "",
      "【導託：［秘封／空牙／動器／導魔＆コスト3以上］［動器／導魔＆ブレイヴ］】",
      "◆対象の自分のスピリット/ブレイヴを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "【転者：3】Lv1-Lv2『自分のアタックステップ開始時』",
      '〔このネクサスのコア3個をボイドに置く〕このターンの間、このネクサスはLv1BP3000、Lv2BP6000、"『このスピリットのアタック時』シンボル2つ以下の相手のスピリット/アルティメット1体を破壊する。"を持つスピリットとして扱い、導界者ネクサス/創界神ネクサス以外では破壊されない。',
      "",
      "【導域】Lv2『自分のアタックステップ』",
      "相手は、効果でアタックステップを終了できない。",
    ],
    keywordTags: ["guided_nexus", "enter_field_core_placement_forbidden"],
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        {
          tribes: ["秘封", "空牙", "動器", "導魔"],
          categories: ["spirit"],
          minCost: 3,
        },
        { tribes: ["動器", "導魔"], categories: ["brave"] },
      ],
    },
    tribe: "導界者・秘封・導魔",
    image: "images/BSTH003-X03.webp",
    rarity: "X",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // textLines[0] 導界者ネクサス共通ルールと textLines[2-4]【導託】は grandwalkerData(kind:"guided")
      //   + keywordTags で engine が表現する（checkAndQueueOracleChoices / checkAndQueuePlacementOracle）。
      //   DSL effect 不要。
      // 【転者：3】Lv1-Lv2『アタックステップ開始時』コア3個ボイドで BP3000/6000 スピリット化
      // （シンボル2つ以下の相手1体破壊持ち）。BSTH003-X01 と同型 (phase-start + grant_effect)。
      // divineSkills を使わない理由は BSTH003-X01 effects[0] のコメント参照
      // （divineSkills は continuous polling、本カード原文「開始時」は一過性の
      // phase-start トリガー配信で表現するのが正確）。
      // 「シンボル2つ以下」は CardFilter.maxSymbolCount (本 commit で新設、minSymbolCount の
      // 対称版) で表現する。
      {
        timing: {
          kind: "phase",
          step: "attack",
          whose: "self",
          subPhase: "start",
        },
        condition: [{ kind: "self_core_count", min: 3 }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "this_card" },
              to: { kind: "void", player: "self" },
              amount: 3,
            },
          },
          {
            action: {
              kind: "divine_transform",
              target: { kind: "self" },
              bpByLevel: [
                { level: 1, bp: 3000 },
                { level: 2, bp: 6000 },
              ],
              protectedFromNonGrandwalker: true,
            },
            connector: "sequential",
          },
          {
            action: {
              kind: "grant_effect",
              target: { kind: "self" },
              duration: { scope: "turn" },
              grantedEffect: {
                timing: { kind: "card_event", event: "attack" },
                executionMode: "mandatory",
                steps: [
                  {
                    action: {
                      kind: "destroy",
                      target: {
                        kind: "filter",
                        player: "opponent",
                        filter: {
                          category: ["spirit", "ultimate"],
                          maxSymbolCount: 2,
                        },
                        count: 1,
                      },
                    },
                  },
                ],
              },
            },
            connector: "sequential",
          },
        ],
        textRef: [6, 7],
      },
      {
        // 【導域】Lv2『自分のアタックステップ』相手は効果でアタックステップを終了できない。
        // 注: 導域 (導界者 passive) の発動可否そのものは未実装。Lv2 + 自分のアタックステップ
        // スコープで近似せず、レベル/タイミングスコープで gating する。
        timing: { kind: "continuous" },
        timingScope: { player: "self", period: "attack" },
        applicability: { level: { min: 2, max: 2 } },
        steps: [
          {
            action: {
              kind: "restrict_end_attack_step",
              player: "opponent",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSTH003-X04",
    orikaId: 51,
    orikaIndex: 41,
    name: "北白河 ちゆり",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 6,
    reductionSymbols: ["yellow", "red", "guide", "guide"],
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
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "ボイドからコア3個ずつを系統：「導魔」/「秘封」を持つ自分の導界者ネクサス2つに置ける。",
      "",
      "Lv1-Lv2-Lv3『自分のアタックステップ』",
      "バトル終了時、自分の赤/黄の導界者ネクサスのコア3個をボイドに置くことで、系統：「導魔」/「秘封」を持つ自分のスピリット/導界者ネクサス1つを回復させる。",
      "",
      "Lv3『このスピリットのアタック時』",
      "このターンの間、相手のスピリット1体をBP-10000でき、BPが0になったスピリットを破壊する。",
    ],
    keywordTags: [],
    tribe: "幻想・秘封・導魔",
    image: "images/BSTH003-X04.webp",
    rarity: "X",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2-Lv3『召喚時』ボイドからコア3個ずつを導魔/秘封の自分の導界者ネクサス2つに置ける。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["導魔", "秘封"],
                  targetsGrandwalker: true,
                  hasMechanic: ["guided"],
                },
                count: 1,
              },
              from: { kind: "void", player: "self" },
              to: { kind: "target_card" },
              amount: 3,
            },
            repeat: { additional: 1, allowDuplicateTargets: false },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1-Lv2-Lv3『アタックステップ』バトル終了時、自分の赤/黄導界者ネクサスのコア3個をボイドに
      //   置くことで、導魔/秘封の自分のスピリット/導界者ネクサス1つを回復。
      //   timing/timingScope は自分のアタックステップ + game_event:battle_end。バトル参加カード
      //   離場後も、発揮元が場に残っていれば観測できる bystander 型。
      //   コスト源は既存 core_move(from:field_card) + conditional_cost（BSRK01-X01[5] 型）。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "battle_end",
          requireRelatedInstanceOnField: false,
        },
        timingScope: { player: "self", period: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  colors: ["red", "yellow"],
                  tribes: ["導界者"],
                  targetsGrandwalker: true,
                },
              },
              to: { kind: "void", player: "self" },
              amount: 3,
            },
          },
          {
            action: {
              kind: "recover",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  filterOr: [
                    { category: ["spirit"], tribes: ["導魔", "秘封"] },
                    {
                      category: ["nexus"],
                      tribes: ["導魔", "秘封"],
                      targetsGrandwalker: true,
                      hasMechanic: ["guided"],
                    },
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
      // Lv3『このスピリットのアタック時』相手スピ1体をBP-10000、BP0で破壊。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        condition: [{ kind: "min_level", value: 3 }],
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
              amount: -10000,
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
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSTH003-X05",
    orikaId: 52,
    orikaIndex: 42,
    name: "朝倉 理香子",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 7,
    reductionSymbols: ["red", "red", "yellow", "yellow", "guide", "guide"],
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
    symbolColors: ["red", "red"],
    textLines: [
      "【転召：1／幻想＆コスト3以上／ボイド】",
      "召喚コスト支払い後、対象の自分のスピリット1体の上のコアすべて（最低1個）をボイドに置かなければならない。",
      "",
      "Lv1-Lv2-Lv3『このスピリットのアタック時』",
      "相手のスピリット/アルティメット1体を破壊でき、その効果を発揮させない。",
    ],
    keywordTags: [],
    tribe: "幻想・導魔・空牙",
    image: "images/BSTH003-X05.webp",
    rarity: "X",
    pack: "BSTH003 東方夢時空",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【転召：1／幻想＆コスト3以上／ボイド】召喚コスト支払い後、対象スピのコア全をボイドへ。
    // 召喚時効果ではなく召喚手順内ステップ（裁定 2026-06-14, 10_rules/07b）。対象不在なら召喚宣言不可。
    tenshoSummon: {
      targetFilter: {
        category: ["spirit"],
        tribesRequired: ["幻想"],
        minCost: 3,
      },
      minCores: 1,
      destination: "void",
    },
    effects: [
      // Lv1-Lv2-Lv3『このスピリットのアタック時』相手のスピリット/アルティメット1体を破壊でき、その効果を発揮させない。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              suppressDestroyedEffects: "destroyed_only",
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
];
